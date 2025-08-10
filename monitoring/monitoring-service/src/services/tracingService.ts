import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { trace, context, SpanStatusCode, SpanKind, Span } from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { TraceSpan, LogEntry } from '../types';
import logger from '../utils/logger';
import { RedisService } from './redisService';
import config from '../config';
import { v4 as uuidv4 } from 'uuid';

export class TracingService {
  private sdk: NodeSDK | null = null;
  private tracer: any;
  private activeTraces = new Map<string, TraceSpan>();
  private traceBuffer: TraceSpan[] = [];
  private logBuffer: LogEntry[] = [];

  constructor(private redis: RedisService) {
    this.initializeTracing();
    this.startBufferFlushInterval();
  }

  private initializeTracing(): void {
    if (!config.features.distributedTracing) {
      logger.info('Distributed tracing disabled');
      return;
    }

    try {
      const jaegerExporter = new JaegerExporter({
        endpoint: config.jaeger.endpoint,
      });

      this.sdk = new NodeSDK({
        resource: new Resource({
          [SemanticResourceAttributes.SERVICE_NAME]: config.jaeger.serviceName,
          [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
          [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.nodeEnv,
        }),
        traceExporter: jaegerExporter,
        instrumentations: [
          new HttpInstrumentation({
            requestHook: (span, request) => {
              span.setAttributes({
                'http.request.body.size': request.headers['content-length'] || 0,
                'user_agent.original': request.headers['user-agent'] || '',
              });
            },
            responseHook: (span, response) => {
              span.setAttributes({
                'http.response.body.size': response.headers['content-length'] || 0,
              });
            },
          }),
          new ExpressInstrumentation({
            requestHook: (span, request) => {
              span.setAttributes({
                'ai_ninja.user_id': request.headers['x-user-id'] || '',
                'ai_ninja.call_id': request.headers['x-call-id'] || '',
                'ai_ninja.session_id': request.headers['x-session-id'] || '',
              });
            },
          }),
        ],
        samplerConfig: {
          ratio: config.jaeger.samplingRate,
        },
      });

      this.sdk.start();
      this.tracer = trace.getTracer(config.jaeger.serviceName);

      logger.info('Distributed tracing initialized', {
        serviceName: config.jaeger.serviceName,
        endpoint: config.jaeger.endpoint,
        samplingRate: config.jaeger.samplingRate,
      });
    } catch (error) {
      logger.error('Failed to initialize tracing', { error });
    }
  }

  public startSpan(
    name: string,
    options: {
      kind?: SpanKind;
      parentSpanId?: string;
      userId?: string;
      callId?: string;
      sessionId?: string;
      attributes?: Record<string, string | number | boolean>;
    } = {}
  ): string {
    if (!this.tracer) {
      return this.createMockSpan(name, options);
    }

    try {
      const span = this.tracer.startSpan(name, {
        kind: options.kind || SpanKind.INTERNAL,
        attributes: {
          ...options.attributes,
          'ai_ninja.user_id': options.userId || '',
          'ai_ninja.call_id': options.callId || '',
          'ai_ninja.session_id': options.sessionId || '',
        },
      });

      const spanContext = span.spanContext();
      const traceSpan: TraceSpan = {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        parentSpanId: options.parentSpanId,
        operationName: name,
        service: config.jaeger.serviceName,
        startTime: new Date(),
        status: 'ok',
        tags: {
          ...options.attributes,
          'ai_ninja.user_id': options.userId || '',
          'ai_ninja.call_id': options.callId || '',
          'ai_ninja.session_id': options.sessionId || '',
        } as Record<string, string>,
        logs: [],
      };

      this.activeTraces.set(spanContext.spanId, traceSpan);
      return spanContext.spanId;
    } catch (error) {
      logger.error('Failed to start span', { error, name });
      return this.createMockSpan(name, options);
    }
  }

  public finishSpan(
    spanId: string,
    options: {
      status?: 'ok' | 'error' | 'timeout';
      error?: Error;
      attributes?: Record<string, string | number | boolean>;
    } = {}
  ): void {
    const traceSpan = this.activeTraces.get(spanId);
    if (!traceSpan) {
      logger.warn('Attempted to finish unknown span', { spanId });
      return;
    }

    try {
      // Update trace span
      traceSpan.endTime = new Date();
      traceSpan.duration = traceSpan.endTime.getTime() - traceSpan.startTime.getTime();
      traceSpan.status = options.status || 'ok';

      if (options.attributes) {
        Object.assign(traceSpan.tags, options.attributes);
      }

      if (options.error) {
        traceSpan.status = 'error';
        traceSpan.tags.error = 'true';
        traceSpan.tags.error_message = options.error.message;
        traceSpan.tags.error_stack = options.error.stack || '';
      }

      // Finish OpenTelemetry span if available
      const span = trace.getActiveSpan();
      if (span) {
        if (options.attributes) {
          span.setAttributes(options.attributes);
        }

        if (options.error) {
          span.recordException(options.error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: options.error.message });
        } else if (options.status === 'error') {
          span.setStatus({ code: SpanStatusCode.ERROR });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        span.end();
      }

      // Move to buffer for batch processing
      this.traceBuffer.push(traceSpan);
      this.activeTraces.delete(spanId);

      logger.debug('Span finished', {
        spanId,
        traceId: traceSpan.traceId,
        duration: traceSpan.duration,
        status: traceSpan.status,
      });
    } catch (error) {
      logger.error('Failed to finish span', { error, spanId });
    }
  }

  public addSpanLog(
    spanId: string,
    level: 'error' | 'warn' | 'info' | 'debug',
    message: string,
    metadata?: Record<string, any>
  ): void {
    const traceSpan = this.activeTraces.get(spanId);
    if (!traceSpan) return;

    const logEntry: LogEntry = {
      timestamp: new Date(),
      level,
      service: config.jaeger.serviceName,
      message,
      metadata,
      traceId: traceSpan.traceId,
      spanId: traceSpan.spanId,
    };

    traceSpan.logs = traceSpan.logs || [];
    traceSpan.logs.push(logEntry);

    // Also add to log buffer for centralized logging
    this.logBuffer.push(logEntry);

    // Add log to OpenTelemetry span
    const span = trace.getActiveSpan();
    if (span) {
      span.addEvent(message, {
        level,
        ...metadata,
      });
    }
  }

  public addSpanAttribute(
    spanId: string,
    key: string,
    value: string | number | boolean
  ): void {
    const traceSpan = this.activeTraces.get(spanId);
    if (traceSpan) {
      traceSpan.tags[key] = value.toString();
    }

    // Add to OpenTelemetry span
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes({ [key]: value });
    }
  }

  public instrumentAsyncOperation<T>(
    operationName: string,
    operation: (spanId: string) => Promise<T>,
    options: {
      kind?: SpanKind;
      userId?: string;
      callId?: string;
      sessionId?: string;
      attributes?: Record<string, string | number | boolean>;
    } = {}
  ): Promise<T> {
    const spanId = this.startSpan(operationName, options);

    return operation(spanId)
      .then((result) => {
        this.finishSpan(spanId, { status: 'ok' });
        return result;
      })
      .catch((error) => {
        this.finishSpan(spanId, { status: 'error', error });
        throw error;
      });
  }

  public instrumentSyncOperation<T>(
    operationName: string,
    operation: (spanId: string) => T,
    options: {
      kind?: SpanKind;
      userId?: string;
      callId?: string;
      sessionId?: string;
      attributes?: Record<string, string | number | boolean>;
    } = {}
  ): T {
    const spanId = this.startSpan(operationName, options);

    try {
      const result = operation(spanId);
      this.finishSpan(spanId, { status: 'ok' });
      return result;
    } catch (error) {
      this.finishSpan(spanId, { 
        status: 'error', 
        error: error instanceof Error ? error : new Error(String(error)) 
      });
      throw error;
    }
  }

  // AI-specific tracing methods
  public startAIOperationSpan(
    operation: 'stt' | 'tts' | 'ai_generation' | 'intent_recognition',
    options: {
      userId?: string;
      callId?: string;
      sessionId?: string;
      modelName?: string;
      inputSize?: number;
      language?: string;
    } = {}
  ): string {
    return this.startSpan(`ai.${operation}`, {
      kind: SpanKind.INTERNAL,
      userId: options.userId,
      callId: options.callId,
      sessionId: options.sessionId,
      attributes: {
        'ai.operation': operation,
        'ai.model.name': options.modelName || '',
        'ai.input.size': options.inputSize || 0,
        'ai.language': options.language || 'zh-CN',
      },
    });
  }

  public finishAIOperationSpan(
    spanId: string,
    result: {
      status: 'ok' | 'error' | 'timeout';
      outputSize?: number;
      confidence?: number;
      tokens?: number;
      latency?: number;
      error?: Error;
    }
  ): void {
    const attributes: Record<string, string | number | boolean> = {
      'ai.output.size': result.outputSize || 0,
      'ai.confidence': result.confidence || 0,
      'ai.tokens': result.tokens || 0,
      'ai.latency': result.latency || 0,
    };

    this.finishSpan(spanId, {
      status: result.status,
      error: result.error,
      attributes,
    });
  }

  // Call flow tracing
  public startCallFlowSpan(
    callId: string,
    userId: string,
    callerPhone: string,
    operation: 'incoming_call' | 'ai_processing' | 'response_generation' | 'call_end'
  ): string {
    return this.startSpan(`call.${operation}`, {
      kind: SpanKind.SERVER,
      callId,
      userId,
      attributes: {
        'call.id': callId,
        'call.caller_phone': callerPhone,
        'call.operation': operation,
        'user.id': userId,
      },
    });
  }

  // Service communication tracing
  public startServiceCallSpan(
    targetService: string,
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    options: {
      userId?: string;
      callId?: string;
      sessionId?: string;
    } = {}
  ): string {
    return this.startSpan(`service_call.${targetService}`, {
      kind: SpanKind.CLIENT,
      userId: options.userId,
      callId: options.callId,
      sessionId: options.sessionId,
      attributes: {
        'service.target': targetService,
        'http.method': method,
        'http.url': endpoint,
      },
    });
  }

  // Database operation tracing
  public startDatabaseSpan(
    operation: 'select' | 'insert' | 'update' | 'delete',
    table: string,
    options: {
      userId?: string;
      callId?: string;
      query?: string;
    } = {}
  ): string {
    return this.startSpan(`db.${operation}`, {
      kind: SpanKind.CLIENT,
      userId: options.userId,
      callId: options.callId,
      attributes: {
        'db.operation': operation,
        'db.table': table,
        'db.query': options.query ? this.sanitizeQuery(options.query) : '',
        'db.system': 'postgresql',
      },
    });
  }

  public finishDatabaseSpan(
    spanId: string,
    result: {
      status: 'ok' | 'error' | 'timeout';
      rowsAffected?: number;
      error?: Error;
      duration?: number;
    }
  ): void {
    this.finishSpan(spanId, {
      status: result.status,
      error: result.error,
      attributes: {
        'db.rows_affected': result.rowsAffected || 0,
        'db.duration': result.duration || 0,
      },
    });
  }

  // Cache operation tracing
  public startCacheSpan(
    operation: 'get' | 'set' | 'delete' | 'exists',
    key: string,
    options: {
      userId?: string;
      callId?: string;
    } = {}
  ): string {
    return this.startSpan(`cache.${operation}`, {
      kind: SpanKind.CLIENT,
      userId: options.userId,
      callId: options.callId,
      attributes: {
        'cache.operation': operation,
        'cache.key': this.sanitizeCacheKey(key),
        'cache.system': 'redis',
      },
    });
  }

  // Trace correlation
  public correlateWithParentTrace(parentTraceId: string, parentSpanId: string): void {
    // This would be used when receiving requests with existing trace context
    logger.debug('Correlating with parent trace', {
      parentTraceId,
      parentSpanId,
    });
  }

  // Trace query and analysis
  public async getTraceById(traceId: string): Promise<TraceSpan[] | null> {
    try {
      // First check buffer
      const bufferTraces = this.traceBuffer.filter(span => span.traceId === traceId);
      if (bufferTraces.length > 0) {
        return bufferTraces;
      }

      // Check Redis cache
      const cachedTrace = await this.redis.get(`trace:${traceId}`);
      if (cachedTrace) {
        return JSON.parse(cachedTrace);
      }

      // If not found, might need to query Jaeger directly
      return null;
    } catch (error) {
      logger.error('Failed to get trace by ID', { error, traceId });
      return null;
    }
  }

  public async getTracesByCallId(callId: string, limit = 10): Promise<TraceSpan[]> {
    try {
      const traces = this.traceBuffer
        .filter(span => span.tags['call.id'] === callId || span.tags['ai_ninja.call_id'] === callId)
        .slice(0, limit);

      // Also check Redis for older traces
      const pattern = `trace:call:${callId}:*`;
      const keys = await this.redis.scan(pattern);
      
      for (const key of keys.slice(0, limit - traces.length)) {
        const trace = await this.redis.get(key);
        if (trace) {
          traces.push(...JSON.parse(trace));
        }
      }

      return traces;
    } catch (error) {
      logger.error('Failed to get traces by call ID', { error, callId });
      return [];
    }
  }

  public async getSlowTraces(minDuration = 1000, limit = 50): Promise<TraceSpan[]> {
    try {
      return this.traceBuffer
        .filter(span => (span.duration || 0) >= minDuration)
        .sort((a, b) => (b.duration || 0) - (a.duration || 0))
        .slice(0, limit);
    } catch (error) {
      logger.error('Failed to get slow traces', { error, minDuration });
      return [];
    }
  }

  public async getErrorTraces(limit = 50): Promise<TraceSpan[]> {
    try {
      return this.traceBuffer
        .filter(span => span.status === 'error')
        .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
        .slice(0, limit);
    } catch (error) {
      logger.error('Failed to get error traces', { error });
      return [];
    }
  }

  // Utility methods
  private createMockSpan(name: string, options: any): string {
    const spanId = uuidv4();
    const traceId = uuidv4();

    const mockSpan: TraceSpan = {
      traceId,
      spanId,
      parentSpanId: options.parentSpanId,
      operationName: name,
      service: config.jaeger.serviceName,
      startTime: new Date(),
      status: 'ok',
      tags: {
        mock: 'true',
        ...options.attributes,
      } as Record<string, string>,
      logs: [],
    };

    this.activeTraces.set(spanId, mockSpan);
    return spanId;
  }

  private sanitizeQuery(query: string): string {
    // Remove sensitive data from SQL queries
    return query
      .replace(/password\s*=\s*'[^']*'/gi, "password='***'")
      .replace(/token\s*=\s*'[^']*'/gi, "token='***'")
      .substring(0, 200); // Limit length
  }

  private sanitizeCacheKey(key: string): string {
    // Remove sensitive data from cache keys
    return key.replace(/(password|token|secret):[^:]+/gi, '$1:***');
  }

  private startBufferFlushInterval(): void {
    // Flush traces and logs every 30 seconds
    setInterval(async () => {
      await this.flushTraceBuffer();
      await this.flushLogBuffer();
    }, 30000);
  }

  private async flushTraceBuffer(): Promise<void> {
    if (this.traceBuffer.length === 0) return;

    try {
      const traces = this.traceBuffer.splice(0); // Move all traces
      
      // Group by trace ID for better storage
      const traceGroups = new Map<string, TraceSpan[]>();
      
      traces.forEach(span => {
        const group = traceGroups.get(span.traceId) || [];
        group.push(span);
        traceGroups.set(span.traceId, group);
      });

      // Store each trace group
      const promises: Promise<void>[] = [];
      
      for (const [traceId, spans] of traceGroups) {
        promises.push(
          this.redis.setex(`trace:${traceId}`, 3600, JSON.stringify(spans)) // 1 hour TTL
        );

        // Also index by call ID if available
        const callId = spans[0]?.tags['call.id'] || spans[0]?.tags['ai_ninja.call_id'];
        if (callId) {
          promises.push(
            this.redis.setex(`trace:call:${callId}:${traceId}`, 3600, JSON.stringify(spans))
          );
        }
      }

      await Promise.all(promises);

      logger.debug('Flushed trace buffer', {
        traceCount: traces.length,
        traceGroups: traceGroups.size,
      });
    } catch (error) {
      logger.error('Failed to flush trace buffer', { error });
    }
  }

  private async flushLogBuffer(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    try {
      const logs = this.logBuffer.splice(0); // Move all logs
      
      // Store logs by service and timestamp
      const logsByHour = new Map<string, LogEntry[]>();
      
      logs.forEach(log => {
        const hourKey = `logs:${log.service}:${Math.floor(log.timestamp.getTime() / 3600000)}`;
        const group = logsByHour.get(hourKey) || [];
        group.push(log);
        logsByHour.set(hourKey, group);
      });

      const promises: Promise<void>[] = [];
      
      for (const [key, logGroup] of logsByHour) {
        // Append to existing logs
        const existingLogs = await this.redis.get(key);
        const allLogs = existingLogs ? [...JSON.parse(existingLogs), ...logGroup] : logGroup;
        
        promises.push(
          this.redis.setex(key, 86400, JSON.stringify(allLogs)) // 24 hours TTL
        );
      }

      await Promise.all(promises);

      logger.debug('Flushed log buffer', {
        logCount: logs.length,
        logGroups: logsByHour.size,
      });
    } catch (error) {
      logger.error('Failed to flush log buffer', { error });
    }
  }

  public async getLogs(
    service: string,
    startTime: Date,
    endTime: Date,
    level?: 'error' | 'warn' | 'info' | 'debug'
  ): Promise<LogEntry[]> {
    try {
      const logs: LogEntry[] = [];
      const startHour = Math.floor(startTime.getTime() / 3600000);
      const endHour = Math.floor(endTime.getTime() / 3600000);

      for (let hour = startHour; hour <= endHour; hour++) {
        const key = `logs:${service}:${hour}`;
        const hourLogs = await this.redis.get(key);
        
        if (hourLogs) {
          const parsedLogs: LogEntry[] = JSON.parse(hourLogs);
          logs.push(...parsedLogs.filter(log => {
            const logTime = new Date(log.timestamp);
            const inTimeRange = logTime >= startTime && logTime <= endTime;
            const matchesLevel = !level || log.level === level;
            return inTimeRange && matchesLevel;
          }));
        }
      }

      return logs.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    } catch (error) {
      logger.error('Failed to get logs', { error, service, startTime, endTime });
      return [];
    }
  }

  public shutdown(): void {
    if (this.sdk) {
      this.sdk.shutdown();
      logger.info('Tracing service shut down');
    }
  }
}

// Export a singleton instance
export const tracingService = new TracingService(new RedisService());