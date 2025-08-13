import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, SpanStatusCode, SpanKind, context, propagation } from '@opentelemetry/api';
import { logger } from '@shared/utils/logger';
import fetch from 'node-fetch';

export interface TraceSpan {
  traceID: string;
  spanID: string;
  parentSpanID?: string;
  operationName: string;
  serviceName: string;
  startTime: number;
  duration: number;
  tags: Record<string, any>;
  logs: TraceLog[];
  status: 'ok' | 'error' | 'timeout';
  references?: TraceReference[];
}

export interface TraceLog {
  timestamp: number;
  fields: Record<string, any>;
  level: 'info' | 'warn' | 'error' | 'debug';
}

export interface TraceReference {
  type: 'child_of' | 'follows_from';
  traceID: string;
  spanID: string;
}

export interface TraceQuery {
  service?: string;
  operation?: string;
  tags?: Record<string, string>;
  minDuration?: string;
  maxDuration?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}

export interface TraceAnalytics {
  traceID: string;
  totalSpans: number;
  totalDuration: number;
  criticalPath: string[];
  bottlenecks: TraceBottleneck[];
  errorSpans: TraceSpan[];
  serviceMap: ServiceDependency[];
  performanceInsights: PerformanceInsight[];
}

export interface TraceBottleneck {
  spanID: string;
  operationName: string;
  serviceName: string;
  duration: number;
  percentageOfTotal: number;
  suggestedOptimizations: string[];
}

export interface ServiceDependency {
  parent: string;
  child: string;
  callCount: number;
  errorRate: number;
  avgDuration: number;
  p95Duration: number;
}

export interface PerformanceInsight {
  type: 'slow_operation' | 'high_error_rate' | 'many_calls' | 'long_tail' | 'cascading_failure';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedServices: string[];
  suggestedActions: string[];
  metrics: Record<string, number>;
}

export class JaegerIntegration {
  private sdk: NodeSDK;
  private tracer = trace.getTracer('ai-phone-system');
  private jaegerEndpoint: string;
  private jaegerQueryEndpoint: string;
  private initialized = false;
  private customSpanProcessor?: any;

  constructor(
    jaegerEndpoint: string = process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
    jaegerQueryEndpoint: string = process.env.JAEGER_QUERY_ENDPOINT || 'http://localhost:16686'
  ) {
    this.jaegerEndpoint = jaegerEndpoint;
    this.jaegerQueryEndpoint = jaegerQueryEndpoint;
    this.initializeTracing();
  }

  private initializeTracing() {
    // Configure Jaeger exporter
    const jaegerExporter = new JaegerExporter({
      endpoint: this.jaegerEndpoint
    });

    // Initialize SDK with auto-instrumentations
    this.sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'ai-phone-system',
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.SERVICE_VERSION || '1.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development'
      }),
      traceExporter: jaegerExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-http': {
            enabled: true,
            requestHook: this.httpRequestHook.bind(this),
            responseHook: this.httpResponseHook.bind(this)
          },
          '@opentelemetry/instrumentation-express': { enabled: true },
          '@opentelemetry/instrumentation-redis': { enabled: true },
          '@opentelemetry/instrumentation-pg': { enabled: true }
        })
      ]
    });

    // Start the SDK
    this.sdk.start();
    this.initialized = true;
    
    logger.info('Jaeger tracing initialized successfully', {
      jaegerEndpoint: this.jaegerEndpoint,
      serviceName: 'ai-phone-system'
    });

    // Setup graceful shutdown
    process.on('SIGTERM', () => {
      this.shutdown();
    });
  }

  private httpRequestHook(span: any, request: any) {
    // Add custom attributes to HTTP spans
    span.setAttributes({
      'http.user_agent': request.headers?.['user-agent'] || 'unknown',
      'http.x_forwarded_for': request.headers?.['x-forwarded-for'] || '',
      'custom.request_id': request.headers?.['x-request-id'] || '',
      'custom.user_id': request.headers?.['x-user-id'] || ''
    });
  }

  private httpResponseHook(span: any, response: any) {
    // Add response attributes
    span.setAttributes({
      'http.response.content_length': response.headers?.['content-length'] || 0,
      'http.response.content_type': response.headers?.['content-type'] || ''
    });
  }

  // High-level tracing methods for business operations
  public async tracePhoneCall<T>(
    callId: string,
    callerPhone: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      'phone_call_processing',
      {
        kind: SpanKind.SERVER,
        attributes: {
          'call.id': callId,
          'call.caller_phone': this.hashPhoneNumber(callerPhone),
          'call.service': 'phone-gateway'
        }
      },
      async (span) => {
        try {
          const result = await operation();
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            'call.status': 'completed',
            'call.duration_ms': Date.now() - span.startTime[0] * 1000
          });
          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message
          });
          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  public async traceAIProcessing<T>(
    callId: string,
    intent: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      'ai_processing',
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'ai.call_id': callId,
          'ai.intent': intent,
          'ai.service': 'ai-conversation'
        }
      },
      async (span) => {
        try {
          const startTime = Date.now();
          const result = await operation();
          const processingTime = Date.now() - startTime;
          
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            'ai.processing_time_ms': processingTime,
            'ai.status': 'success'
          });

          // Log processing milestone
          span.addEvent('ai_processing_completed', {
            'processing_time': processingTime,
            'intent': intent
          });

          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message
          });
          
          span.setAttributes({
            'ai.error': true,
            'ai.error_type': (error as Error).name
          });

          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  public async traceWhitelistCheck<T>(
    userId: string,
    callerPhone: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      'whitelist_check',
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'whitelist.user_id': userId,
          'whitelist.caller_phone': this.hashPhoneNumber(callerPhone),
          'whitelist.service': 'smart-whitelist'
        }
      },
      async (span) => {
        try {
          const result = await operation();
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            'whitelist.result': result ? 'hit' : 'miss',
            'whitelist.check_type': 'automated'
          });
          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message
          });
          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  public async traceSpamDetection<T>(
    callerPhone: string,
    spamCategory: string,
    confidence: number,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      'spam_detection',
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'spam.caller_phone': this.hashPhoneNumber(callerPhone),
          'spam.category': spamCategory,
          'spam.confidence': confidence,
          'spam.service': 'profile-analytics'
        }
      },
      async (span) => {
        try {
          const result = await operation();
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            'spam.detection_result': 'completed',
            'spam.final_confidence': confidence
          });

          // Add event for high-confidence spam detection
          if (confidence > 0.8) {
            span.addEvent('high_confidence_spam_detected', {
              'confidence': confidence,
              'category': spamCategory
            });
          }

          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message
          });
          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  public async traceVoiceProcessing<T>(
    audioId: string,
    processingType: 'stt' | 'tts' | 'voice_clone',
    operation: () => Promise<T>
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      `voice_${processingType}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'voice.audio_id': audioId,
          'voice.processing_type': processingType,
          'voice.service': 'real-time-processor'
        }
      },
      async (span) => {
        try {
          const startTime = Date.now();
          const result = await operation();
          const processingTime = Date.now() - startTime;
          
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            'voice.processing_time_ms': processingTime,
            'voice.status': 'completed'
          });

          // Log performance milestone
          if (processingTime > 1000) {
            span.addEvent('slow_voice_processing', {
              'processing_time': processingTime,
              'threshold_exceeded': 1000
            });
          }

          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message
          });
          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  public async traceDatabaseOperation<T>(
    operation: string,
    table: string,
    dbOperation: () => Promise<T>
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      `db_${operation}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'db.operation': operation,
          'db.table': table,
          'db.system': 'postgresql'
        }
      },
      async (span) => {
        try {
          const startTime = Date.now();
          const result = await dbOperation();
          const queryTime = Date.now() - startTime;
          
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttributes({
            'db.query_time_ms': queryTime,
            'db.rows_affected': Array.isArray(result) ? result.length : 1
          });

          // Log slow queries
          if (queryTime > 500) {
            span.addEvent('slow_database_query', {
              'query_time': queryTime,
              'table': table,
              'operation': operation
            });
          }

          return result;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message
          });
          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  // Trace query and analysis methods
  public async queryTraces(query: TraceQuery): Promise<TraceSpan[]> {
    try {
      const params = new URLSearchParams();
      
      if (query.service) params.append('service', query.service);
      if (query.operation) params.append('operation', query.operation);
      if (query.minDuration) params.append('minDuration', query.minDuration);
      if (query.maxDuration) params.append('maxDuration', query.maxDuration);
      if (query.startTime) params.append('start', query.startTime.getTime().toString() + '000'); // microseconds
      if (query.endTime) params.append('end', query.endTime.getTime().toString() + '000');
      if (query.limit) params.append('limit', query.limit.toString());

      // Add tag filters
      if (query.tags) {
        Object.entries(query.tags).forEach(([key, value]) => {
          params.append('tags', `${key}:${value}`);
        });
      }

      const response = await fetch(
        `${this.jaegerQueryEndpoint}/api/traces?${params.toString()}`,
        { timeout: 10000 } as any
      );

      if (!response.ok) {
        throw new Error(`Jaeger query failed: ${response.statusText}`);
      }

      const data = await response.json();
      return this.transformJaegerResponse(data);
    } catch (error) {
      logger.error('Error querying traces from Jaeger:', error);
      throw error;
    }
  }

  public async getTrace(traceID: string): Promise<TraceSpan[] | null> {
    try {
      const response = await fetch(
        `${this.jaegerQueryEndpoint}/api/traces/${traceID}`,
        { timeout: 10000 } as any
      );

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Jaeger trace query failed: ${response.statusText}`);
      }

      const data = await response.json();
      return this.transformJaegerResponse(data);
    } catch (error) {
      logger.error(`Error fetching trace ${traceID} from Jaeger:`, error);
      throw error;
    }
  }

  public async analyzeTrace(traceID: string): Promise<TraceAnalytics | null> {
    const spans = await this.getTrace(traceID);
    if (!spans || spans.length === 0) return null;

    const analytics: TraceAnalytics = {
      traceID,
      totalSpans: spans.length,
      totalDuration: Math.max(...spans.map(s => s.startTime + s.duration)) - Math.min(...spans.map(s => s.startTime)),
      criticalPath: this.calculateCriticalPath(spans),
      bottlenecks: this.identifyBottlenecks(spans),
      errorSpans: spans.filter(s => s.status === 'error'),
      serviceMap: this.buildServiceMap(spans),
      performanceInsights: this.generatePerformanceInsights(spans)
    };

    return analytics;
  }

  public async getServiceDependencies(
    serviceName: string,
    timeRange: { start: Date; end: Date }
  ): Promise<ServiceDependency[]> {
    const traces = await this.queryTraces({
      service: serviceName,
      startTime: timeRange.start,
      endTime: timeRange.end,
      limit: 1000
    });

    const dependencies = new Map<string, ServiceDependency>();
    
    traces.forEach(span => {
      const parentService = span.serviceName;
      
      // Find child service calls
      traces
        .filter(childSpan => childSpan.parentSpanID === span.spanID)
        .forEach(childSpan => {
          const key = `${parentService}->${childSpan.serviceName}`;
          const existing = dependencies.get(key) || {
            parent: parentService,
            child: childSpan.serviceName,
            callCount: 0,
            errorRate: 0,
            avgDuration: 0,
            p95Duration: 0
          };

          existing.callCount++;
          if (childSpan.status === 'error') {
            existing.errorRate = (existing.errorRate * (existing.callCount - 1) + 1) / existing.callCount;
          }
          existing.avgDuration = (existing.avgDuration * (existing.callCount - 1) + childSpan.duration) / existing.callCount;

          dependencies.set(key, existing);
        });
    });

    // Calculate P95 durations
    for (const [key, dep] of dependencies.entries()) {
      const durations = traces
        .filter(span => 
          span.serviceName === dep.child && 
          traces.some(parent => parent.spanID === span.parentSpanID && parent.serviceName === dep.parent)
        )
        .map(span => span.duration)
        .sort((a, b) => a - b);
      
      const p95Index = Math.ceil(durations.length * 0.95) - 1;
      dep.p95Duration = durations[p95Index] || dep.avgDuration;
    }

    return Array.from(dependencies.values());
  }

  private transformJaegerResponse(jaegerData: any): TraceSpan[] {
    const traces = jaegerData.data || [];
    const spans: TraceSpan[] = [];

    traces.forEach((trace: any) => {
      trace.spans?.forEach((span: any) => {
        spans.push({
          traceID: span.traceID,
          spanID: span.spanID,
          parentSpanID: span.parentSpanID,
          operationName: span.operationName,
          serviceName: span.process?.serviceName || 'unknown',
          startTime: span.startTime,
          duration: span.duration,
          tags: this.transformTags(span.tags || []),
          logs: this.transformLogs(span.logs || []),
          status: this.determineSpanStatus(span),
          references: this.transformReferences(span.references || [])
        });
      });
    });

    return spans;
  }

  private transformTags(tags: any[]): Record<string, any> {
    const tagMap: Record<string, any> = {};
    tags.forEach(tag => {
      tagMap[tag.key] = tag.value;
    });
    return tagMap;
  }

  private transformLogs(logs: any[]): TraceLog[] {
    return logs.map(log => ({
      timestamp: log.timestamp,
      fields: this.transformTags(log.fields || []),
      level: this.determineLoglevel(log.fields || [])
    }));
  }

  private transformReferences(references: any[]): TraceReference[] {
    return references.map(ref => ({
      type: ref.refType === 'CHILD_OF' ? 'child_of' : 'follows_from',
      traceID: ref.traceID,
      spanID: ref.spanID
    }));
  }

  private determineSpanStatus(span: any): 'ok' | 'error' | 'timeout' {
    const tags = span.tags || [];
    const errorTag = tags.find((tag: any) => tag.key === 'error' && tag.value === true);
    const httpStatusTag = tags.find((tag: any) => tag.key === 'http.status_code');
    
    if (errorTag) return 'error';
    if (httpStatusTag && parseInt(httpStatusTag.value) >= 400) return 'error';
    
    // Check for timeout indicators
    const timeoutIndicators = tags.some((tag: any) => 
      tag.key.includes('timeout') || tag.value?.toString().includes('timeout')
    );
    
    if (timeoutIndicators) return 'timeout';
    return 'ok';
  }

  private determineLoglevel(fields: any[]): 'info' | 'warn' | 'error' | 'debug' {
    const levelField = fields.find(field => field.key === 'level' || field.key === 'severity');
    if (levelField) {
      const level = levelField.value.toLowerCase();
      if (level.includes('error')) return 'error';
      if (level.includes('warn')) return 'warn';
      if (level.includes('debug')) return 'debug';
    }
    return 'info';
  }

  private calculateCriticalPath(spans: TraceSpan[]): string[] {
    // Find the root span
    const rootSpan = spans.find(span => !span.parentSpanID);
    if (!rootSpan) return [];

    const path: string[] = [rootSpan.operationName];
    
    // Build the longest duration path
    let currentSpan = rootSpan;
    while (true) {
      const children = spans.filter(span => span.parentSpanID === currentSpan.spanID);
      if (children.length === 0) break;
      
      // Find child with longest duration
      const longestChild = children.reduce((longest, child) => 
        child.duration > longest.duration ? child : longest
      );
      
      path.push(longestChild.operationName);
      currentSpan = longestChild;
    }

    return path;
  }

  private identifyBottlenecks(spans: TraceSpan[]): TraceBottleneck[] {
    const totalDuration = spans.reduce((sum, span) => sum + span.duration, 0);
    
    return spans
      .map(span => ({
        spanID: span.spanID,
        operationName: span.operationName,
        serviceName: span.serviceName,
        duration: span.duration,
        percentageOfTotal: (span.duration / totalDuration) * 100,
        suggestedOptimizations: this.getSuggestedOptimizations(span)
      }))
      .filter(bottleneck => bottleneck.percentageOfTotal > 10) // Only significant bottlenecks
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5); // Top 5 bottlenecks
  }

  private buildServiceMap(spans: TraceSpan[]): ServiceDependency[] {
    const dependencies = new Map<string, ServiceDependency>();

    spans.forEach(span => {
      if (!span.parentSpanID) return;

      const parentSpan = spans.find(s => s.spanID === span.parentSpanID);
      if (!parentSpan || parentSpan.serviceName === span.serviceName) return;

      const key = `${parentSpan.serviceName}->${span.serviceName}`;
      const existing = dependencies.get(key) || {
        parent: parentSpan.serviceName,
        child: span.serviceName,
        callCount: 0,
        errorRate: 0,
        avgDuration: 0,
        p95Duration: 0
      };

      existing.callCount++;
      if (span.status === 'error') {
        existing.errorRate = (existing.errorRate * (existing.callCount - 1) + 1) / existing.callCount;
      }
      existing.avgDuration = (existing.avgDuration * (existing.callCount - 1) + span.duration) / existing.callCount;

      dependencies.set(key, existing);
    });

    return Array.from(dependencies.values());
  }

  private generatePerformanceInsights(spans: TraceSpan[]): PerformanceInsight[] {
    const insights: PerformanceInsight[] = [];

    // Slow operation detection
    const slowSpans = spans.filter(span => span.duration > 5000); // 5 seconds
    if (slowSpans.length > 0) {
      insights.push({
        type: 'slow_operation',
        severity: slowSpans.length > 5 ? 'critical' : 'high',
        description: `Found ${slowSpans.length} slow operations (>5s)`,
        affectedServices: [...new Set(slowSpans.map(s => s.serviceName))],
        suggestedActions: [
          '检查数据库查询性能',
          '优化算法复杂度',
          '考虑添加缓存层'
        ],
        metrics: {
          slowSpanCount: slowSpans.length,
          avgSlowSpanDuration: slowSpans.reduce((sum, s) => sum + s.duration, 0) / slowSpans.length
        }
      });
    }

    // High error rate detection
    const errorSpans = spans.filter(span => span.status === 'error');
    const errorRate = errorSpans.length / spans.length;
    if (errorRate > 0.05) { // 5% error rate
      insights.push({
        type: 'high_error_rate',
        severity: errorRate > 0.2 ? 'critical' : 'high',
        description: `High error rate detected: ${(errorRate * 100).toFixed(1)}%`,
        affectedServices: [...new Set(errorSpans.map(s => s.serviceName))],
        suggestedActions: [
          '检查错误日志',
          '验证服务依赖',
          '检查网络连接'
        ],
        metrics: {
          errorRate: errorRate,
          errorCount: errorSpans.length,
          totalSpans: spans.length
        }
      });
    }

    return insights;
  }

  private getSuggestedOptimizations(span: TraceSpan): string[] {
    const optimizations: string[] = [];

    if (span.operationName.includes('database') || span.operationName.includes('db')) {
      optimizations.push('优化数据库查询');
      optimizations.push('考虑添加数据库索引');
    }

    if (span.operationName.includes('http') || span.operationName.includes('api')) {
      optimizations.push('检查网络延迟');
      optimizations.push('考虑添加重试机制');
    }

    if (span.serviceName.includes('ai') || span.operationName.includes('ai')) {
      optimizations.push('优化AI模型推理时间');
      optimizations.push('考虑模型缓存');
    }

    return optimizations.length > 0 ? optimizations : ['分析具体操作逻辑'];
  }

  private hashPhoneNumber(phone: string): string {
    // Simple hash for privacy - in production, use a proper hash function
    return phone.replace(/\d(?=\d{4})/g, '*');
  }

  // Utility methods for trace correlation
  public injectTraceContext(headers: Record<string, string> = {}): Record<string, string> {
    propagation.inject(context.active(), headers);
    return headers;
  }

  public extractTraceContext(headers: Record<string, string>): void {
    const extractedContext = propagation.extract(context.active(), headers);
    context.with(extractedContext);
  }

  // Service status and metrics
  public async getJaegerHealth(): Promise<{ status: string; details: any }> {
    try {
      const response = await fetch(`${this.jaegerQueryEndpoint}/api/health`, {
        timeout: 5000
      } as any);
      
      return {
        status: response.ok ? 'healthy' : 'unhealthy',
        details: {
          jaegerEndpoint: this.jaegerEndpoint,
          queryEndpoint: this.jaegerQueryEndpoint,
          sdkInitialized: this.initialized
        }
      };
    } catch (error) {
      return {
        status: 'error',
        details: {
          error: (error as Error).message,
          jaegerEndpoint: this.jaegerEndpoint,
          queryEndpoint: this.jaegerQueryEndpoint
        }
      };
    }
  }

  public async getTracingMetrics(): Promise<any> {
    // Get tracing statistics
    try {
      const services = await fetch(`${this.jaegerQueryEndpoint}/api/services`);
      const servicesData = await services.json();
      
      return {
        trackedServices: servicesData.data?.length || 0,
        tracingEnabled: this.initialized,
        exporterEndpoint: this.jaegerEndpoint
      };
    } catch (error) {
      return {
        trackedServices: 0,
        tracingEnabled: this.initialized,
        error: (error as Error).message
      };
    }
  }

  // Cleanup
  public async shutdown(): Promise<void> {
    try {
      await this.sdk.shutdown();
      logger.info('Jaeger tracing shutdown completed');
    } catch (error) {
      logger.error('Error during Jaeger tracing shutdown:', error);
    }
  }
}