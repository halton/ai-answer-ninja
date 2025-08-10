import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';
import { RedisClient } from '../utils/redis';
import { DatabaseClient } from '../utils/database';
import { v4 as uuidv4 } from 'uuid';

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  tags: Record<string, any>;
  logs: LogEntry[];
  status: 'ok' | 'error' | 'timeout';
  metadata?: Record<string, any>;
}

export interface LogEntry {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  fields?: Record<string, any>;
}

export interface TraceTree {
  trace: Span;
  children: TraceTree[];
  totalDuration: number;
  serviceCount: number;
  errorCount: number;
}

export interface TraceAnalysis {
  traceId: string;
  totalDuration: number;
  criticalPath: Span[];
  bottlenecks: {
    span: Span;
    impact: number; // percentage of total time
    suggestion: string;
  }[];
  errors: Span[];
  serviceInteractions: {
    from: string;
    to: string;
    count: number;
    avgLatency: number;
  }[];
  performanceScore: number;
}

export interface CallFlowStep {
  step: string;
  service: string;
  operation: string;
  duration: number;
  success: boolean;
  metadata?: Record<string, any>;
}

export class EnhancedTracingService extends EventEmitter {
  private logger: Logger;
  private redis: RedisClient;
  private database: DatabaseClient;
  private activeSpans: Map<string, Span> = new Map();
  private traceBuffer: Map<string, Span[]> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  // Trace retention settings
  private readonly TRACE_BUFFER_SIZE = 10000;
  private readonly TRACE_TTL_SECONDS = 3600; // 1 hour in Redis
  private readonly TRACE_RETENTION_DAYS = 7; // 7 days in database
  
  constructor() {
    super();
    this.logger = new Logger('EnhancedTracingService');
    this.redis = new RedisClient();
    this.database = new DatabaseClient();
    
    this.startCleanupProcess();
  }
  
  private startCleanupProcess(): void {
    // Clean up old traces every 15 minutes
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupOldTraces();
      } catch (error) {
        this.logger.error('Error in trace cleanup process', { error });
      }
    }, 900000); // 15 minutes
  }
  
  // ==========================================
  // Trace Creation and Management
  // ==========================================
  
  createTrace(operationName: string, serviceName: string, metadata?: Record<string, any>): Span {
    const traceId = uuidv4();
    const spanId = uuidv4();
    
    const span: Span = {
      traceId,
      spanId,
      operationName,
      serviceName,
      startTime: Date.now(),
      tags: {
        'service.name': serviceName,
        'operation.name': operationName,
        'trace.root': true
      },
      logs: [],
      status: 'ok',
      metadata
    };
    
    this.activeSpans.set(spanId, span);
    
    this.logger.debug('Created new trace', { traceId, spanId, operationName, serviceName });
    
    return span;
  }
  
  createChildSpan(parentSpan: Span, operationName: string, serviceName?: string): Span {
    const spanId = uuidv4();
    
    const childSpan: Span = {
      traceId: parentSpan.traceId,
      spanId,
      parentSpanId: parentSpan.spanId,
      operationName,
      serviceName: serviceName || parentSpan.serviceName,
      startTime: Date.now(),
      tags: {
        'service.name': serviceName || parentSpan.serviceName,
        'operation.name': operationName,
        'parent.span': parentSpan.spanId
      },
      logs: [],
      status: 'ok'
    };
    
    this.activeSpans.set(spanId, childSpan);
    
    this.logger.debug('Created child span', { 
      traceId: parentSpan.traceId, 
      spanId, 
      parentSpanId: parentSpan.spanId,
      operationName 
    });
    
    return childSpan;
  }
  
  finishSpan(span: Span, status: 'ok' | 'error' | 'timeout' = 'ok', finalTags?: Record<string, any>): void {
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    
    if (finalTags) {
      span.tags = { ...span.tags, ...finalTags };
    }
    
    // Add performance classification
    span.tags['performance.classification'] = this.classifyPerformance(span);
    
    // Remove from active spans
    this.activeSpans.delete(span.spanId);
    
    // Add to trace buffer
    if (!this.traceBuffer.has(span.traceId)) {
      this.traceBuffer.set(span.traceId, []);
    }
    this.traceBuffer.get(span.traceId)!.push(span);
    
    this.logger.debug('Finished span', { 
      traceId: span.traceId, 
      spanId: span.spanId, 
      duration: span.duration,
      status 
    });
    
    // Check if trace is complete and process it
    this.checkTraceCompletion(span.traceId);
  }
  
  addSpanLog(span: Span, level: LogEntry['level'], message: string, fields?: Record<string, any>): void {
    const logEntry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      fields
    };
    
    span.logs.push(logEntry);
    
    // Emit log event for real-time monitoring
    this.emit('spanLog', {
      traceId: span.traceId,
      spanId: span.spanId,
      log: logEntry
    });
  }
  
  addSpanTags(span: Span, tags: Record<string, any>): void {
    span.tags = { ...span.tags, ...tags };
  }
  
  // ==========================================
  // Call Flow Tracking
  // ==========================================
  
  async trackCallFlow(traceId: string): Promise<CallFlowStep[]> {
    try {
      const spans = await this.getTraceSpans(traceId);
      if (spans.length === 0) {
        return [];
      }
      
      // Sort spans by start time to create chronological flow
      const sortedSpans = spans.sort((a, b) => a.startTime - b.startTime);
      
      // Map to call flow steps
      const callFlow: CallFlowStep[] = sortedSpans.map(span => ({
        step: span.operationName,
        service: span.serviceName,
        operation: span.operationName,
        duration: span.duration || 0,
        success: span.status === 'ok',
        metadata: {
          spanId: span.spanId,
          parentSpanId: span.parentSpanId,
          tags: span.tags,
          startTime: span.startTime,
          endTime: span.endTime
        }
      }));
      
      this.logger.debug('Generated call flow', { traceId, stepCount: callFlow.length });
      
      return callFlow;
      
    } catch (error) {
      this.logger.error('Error tracking call flow', { error, traceId });
      return [];
    }
  }
  
  // ==========================================
  // AI Pipeline Specific Tracking
  // ==========================================
  
  async trackAIPipeline(callId: string): Promise<{
    traceId: string;
    pipeline: CallFlowStep[];
    totalLatency: number;
    bottlenecks: string[];
    slaViolations: string[];
  }> {
    try {
      // Find trace by call ID
      const traceId = await this.findTraceByCallId(callId);
      if (!traceId) {
        throw new Error(`No trace found for call ID: ${callId}`);
      }
      
      const callFlow = await this.trackCallFlow(traceId);
      const totalLatency = callFlow.reduce((sum, step) => sum + step.duration, 0);
      
      // Define AI pipeline steps and their SLA thresholds
      const pipelineSLAs = {
        'audio_preprocessing': 100, // 100ms
        'speech_to_text': 350,     // 350ms
        'intent_recognition': 100,  // 100ms
        'ai_generation': 450,       // 450ms
        'text_to_speech': 300,      // 300ms
        'response_delivery': 100    // 100ms
      };
      
      // Identify bottlenecks (steps taking >20% of total time)
      const bottlenecks = callFlow
        .filter(step => step.duration > (totalLatency * 0.2))
        .map(step => `${step.service}.${step.operation}`);
      
      // Identify SLA violations
      const slaViolations = callFlow
        .filter(step => {
          const threshold = pipelineSLAs[step.operation as keyof typeof pipelineSLAs];
          return threshold && step.duration > threshold;
        })
        .map(step => `${step.operation}: ${step.duration}ms > ${pipelineSLAs[step.operation as keyof typeof pipelineSLAs]}ms`);
      
      return {
        traceId,
        pipeline: callFlow,
        totalLatency,
        bottlenecks,
        slaViolations
      };
      
    } catch (error) {
      this.logger.error('Error tracking AI pipeline', { error, callId });
      throw error;
    }
  }
  
  // ==========================================
  // Trace Analysis
  // ==========================================
  
  async analyzeTrace(traceId: string): Promise<TraceAnalysis> {
    try {
      const spans = await this.getTraceSpans(traceId);
      if (spans.length === 0) {
        throw new Error(`No spans found for trace: ${traceId}`);
      }
      
      const rootSpan = spans.find(span => !span.parentSpanId);
      if (!rootSpan) {
        throw new Error(`No root span found for trace: ${traceId}`);
      }
      
      const totalDuration = rootSpan.duration || 0;
      
      // Find critical path (longest path through the trace)
      const criticalPath = this.findCriticalPath(spans);
      
      // Identify bottlenecks
      const bottlenecks = this.identifyBottlenecks(spans, totalDuration);
      
      // Find errors
      const errors = spans.filter(span => span.status === 'error');
      
      // Analyze service interactions
      const serviceInteractions = this.analyzeServiceInteractions(spans);
      
      // Calculate performance score
      const performanceScore = this.calculatePerformanceScore(spans);
      
      const analysis: TraceAnalysis = {
        traceId,
        totalDuration,
        criticalPath,
        bottlenecks,
        errors,
        serviceInteractions,
        performanceScore
      };
      
      // Store analysis for future reference
      await this.storeTraceAnalysis(analysis);
      
      this.logger.debug('Completed trace analysis', { 
        traceId, 
        totalDuration, 
        spanCount: spans.length,
        performanceScore 
      });
      
      return analysis;
      
    } catch (error) {
      this.logger.error('Error analyzing trace', { error, traceId });
      throw error;
    }
  }
  
  private findCriticalPath(spans: Span[]): Span[] {
    // Build span tree
    const spanMap = new Map<string, Span>(spans.map(span => [span.spanId, span]));
    const rootSpans = spans.filter(span => !span.parentSpanId);
    
    let longestPath: Span[] = [];
    let maxDuration = 0;
    
    const findLongestPath = (span: Span, currentPath: Span[], currentDuration: number): void => {
      const newPath = [...currentPath, span];
      const newDuration = currentDuration + (span.duration || 0);
      
      // Find children
      const children = spans.filter(s => s.parentSpanId === span.spanId);
      
      if (children.length === 0) {
        // Leaf node - check if this is the longest path
        if (newDuration > maxDuration) {
          maxDuration = newDuration;
          longestPath = [...newPath];
        }
      } else {
        // Continue with children
        children.forEach(child => findLongestPath(child, newPath, newDuration));
      }
    };
    
    // Find longest path from each root
    rootSpans.forEach(root => findLongestPath(root, [], 0));
    
    return longestPath;
  }
  
  private identifyBottlenecks(spans: Span[], totalDuration: number): TraceAnalysis['bottlenecks'] {
    return spans
      .filter(span => span.duration && span.duration > 0)
      .map(span => ({
        span,
        impact: ((span.duration! / totalDuration) * 100),
        suggestion: this.generateOptimizationSuggestion(span)
      }))
      .filter(bottleneck => bottleneck.impact > 15) // More than 15% of total time
      .sort((a, b) => b.impact - a.impact);
  }
  
  private generateOptimizationSuggestion(span: Span): string {
    const operation = span.operationName.toLowerCase();\n    const duration = span.duration || 0;\n    \n    if (operation.includes('database') || operation.includes('query')) {\n      if (duration > 500) {\n        return 'Consider adding database indexes or optimizing query';\n      }\n      return 'Review query efficiency and connection pooling';\n    }\n    \n    if (operation.includes('http') || operation.includes('api')) {\n      if (duration > 1000) {\n        return 'Consider implementing caching or request optimization';\n      }\n      return 'Review API endpoint performance and response size';\n    }\n    \n    if (operation.includes('ai') || operation.includes('ml')) {\n      if (duration > 2000) {\n        return 'Consider model optimization or request batching';\n      }\n      return 'Review AI service configuration and request complexity';\n    }\n    \n    if (operation.includes('stt') || operation.includes('speech')) {\n      if (duration > 400) {\n        return 'Consider audio preprocessing optimization or service upgrade';\n      }\n      return 'Review audio quality and service configuration';\n    }\n    \n    if (operation.includes('tts') || operation.includes('synthesis')) {\n      if (duration > 350) {\n        return 'Consider text preprocessing or voice model optimization';\n      }\n      return 'Review text length and synthesis parameters';\n    }\n    \n    return 'Consider general performance optimization techniques';\n  }\n  \n  private analyzeServiceInteractions(spans: Span[]): TraceAnalysis['serviceInteractions'] {\n    const interactions = new Map<string, {\n      count: number;\n      totalLatency: number;\n      from: string;\n      to: string;\n    }>();\n    \n    // Build service interaction graph\n    spans.forEach(span => {\n      if (span.parentSpanId) {\n        const parent = spans.find(s => s.spanId === span.parentSpanId);\n        if (parent && parent.serviceName !== span.serviceName) {\n          const key = `${parent.serviceName}->${span.serviceName}`;\n          \n          if (!interactions.has(key)) {\n            interactions.set(key, {\n              count: 0,\n              totalLatency: 0,\n              from: parent.serviceName,\n              to: span.serviceName\n            });\n          }\n          \n          const interaction = interactions.get(key)!;\n          interaction.count++;\n          interaction.totalLatency += (span.duration || 0);\n        }\n      }\n    });\n    \n    // Convert to array with average latency\n    return Array.from(interactions.values()).map(interaction => ({\n      from: interaction.from,\n      to: interaction.to,\n      count: interaction.count,\n      avgLatency: Math.round(interaction.totalLatency / interaction.count)\n    }));\n  }\n  \n  private calculatePerformanceScore(spans: Span[]): number {\n    if (spans.length === 0) return 0;\n    \n    const rootSpan = spans.find(span => !span.parentSpanId);\n    if (!rootSpan || !rootSpan.duration) return 0;\n    \n    const totalDuration = rootSpan.duration;\n    const errorCount = spans.filter(span => span.status === 'error').length;\n    const errorRate = errorCount / spans.length;\n    \n    // Performance score based on:\n    // - Total duration (target: <1500ms for MVP)\n    // - Error rate (target: 0%)\n    // - Service efficiency\n    \n    let score = 100;\n    \n    // Penalize for long duration\n    if (totalDuration > 1500) {\n      score -= Math.min(50, (totalDuration - 1500) / 50); // -1 point per 50ms over target\n    }\n    \n    // Penalize for errors\n    score -= (errorRate * 100); // -100 points for 100% error rate\n    \n    // Bonus for fast performance\n    if (totalDuration < 800) {\n      score += 10; // Bonus for excellent performance\n    }\n    \n    return Math.max(0, Math.min(100, Math.round(score)));\n  }\n  \n  private classifyPerformance(span: Span): string {\n    const duration = span.duration || 0;\n    const operation = span.operationName.toLowerCase();\n    \n    // Define performance thresholds by operation type\n    const thresholds = {\n      database: { excellent: 50, good: 200, acceptable: 500 },\n      http: { excellent: 100, good: 500, acceptable: 2000 },\n      ai: { excellent: 300, good: 1000, acceptable: 3000 },\n      stt: { excellent: 200, good: 350, acceptable: 600 },\n      tts: { excellent: 150, good: 300, acceptable: 500 },\n      default: { excellent: 100, good: 500, acceptable: 2000 }\n    };\n    \n    let threshold = thresholds.default;\n    \n    if (operation.includes('database') || operation.includes('query')) {\n      threshold = thresholds.database;\n    } else if (operation.includes('http') || operation.includes('api')) {\n      threshold = thresholds.http;\n    } else if (operation.includes('ai') || operation.includes('ml')) {\n      threshold = thresholds.ai;\n    } else if (operation.includes('stt') || operation.includes('speech')) {\n      threshold = thresholds.stt;\n    } else if (operation.includes('tts') || operation.includes('synthesis')) {\n      threshold = thresholds.tts;\n    }\n    \n    if (duration <= threshold.excellent) return 'excellent';\n    if (duration <= threshold.good) return 'good';\n    if (duration <= threshold.acceptable) return 'acceptable';\n    return 'poor';\n  }\n  \n  // ==========================================\n  // Data Persistence and Retrieval\n  // ==========================================\n  \n  private async checkTraceCompletion(traceId: string): Promise<void> {\n    try {\n      const spans = this.traceBuffer.get(traceId) || [];\n      \n      // Check if all spans in the trace are complete\n      const activeSpansInTrace = Array.from(this.activeSpans.values())\n        .filter(span => span.traceId === traceId);\n      \n      if (activeSpansInTrace.length === 0 && spans.length > 0) {\n        // Trace is complete - process and store it\n        await this.processCompleteTrace(traceId, spans);\n        this.traceBuffer.delete(traceId);\n        \n        this.logger.debug('Trace completed and processed', { \n          traceId, \n          spanCount: spans.length \n        });\n        \n        this.emit('traceCompleted', {\n          traceId,\n          spans,\n          duration: Math.max(...spans.map(s => s.endTime || 0)) - Math.min(...spans.map(s => s.startTime))\n        });\n      }\n      \n    } catch (error) {\n      this.logger.error('Error checking trace completion', { error, traceId });\n    }\n  }\n  \n  private async processCompleteTrace(traceId: string, spans: Span[]): Promise<void> {\n    try {\n      // Store trace in Redis for immediate access\n      await this.redis.setex(`trace:${traceId}`, this.TRACE_TTL_SECONDS, JSON.stringify(spans));\n      \n      // Store trace in database for long-term analysis\n      await this.storeTraceInDatabase(traceId, spans);\n      \n      // Perform analysis\n      const analysis = await this.analyzeTrace(traceId);\n      \n      // Emit events for monitoring\n      this.emit('traceAnalyzed', analysis);\n      \n      // Check for performance issues and emit alerts if necessary\n      if (analysis.performanceScore < 70) {\n        this.emit('performanceIssue', {\n          traceId,\n          performanceScore: analysis.performanceScore,\n          bottlenecks: analysis.bottlenecks,\n          errors: analysis.errors\n        });\n      }\n      \n    } catch (error) {\n      this.logger.error('Error processing complete trace', { error, traceId });\n      throw error;\n    }\n  }\n  \n  private async storeTraceInDatabase(traceId: string, spans: Span[]): Promise<void> {\n    const client = await this.database.getClient();\n    \n    try {\n      await client.query('BEGIN');\n      \n      // Store each span\n      for (const span of spans) {\n        await client.query(`\n          INSERT INTO distributed_traces \n          (trace_id, span_id, parent_span_id, operation_name, service_name, \n           start_time, end_time, duration, status, tags, logs, metadata)\n          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)\n          ON CONFLICT (span_id) DO NOTHING\n        `, [\n          span.traceId,\n          span.spanId,\n          span.parentSpanId || null,\n          span.operationName,\n          span.serviceName,\n          new Date(span.startTime),\n          span.endTime ? new Date(span.endTime) : null,\n          span.duration || null,\n          span.status,\n          JSON.stringify(span.tags),\n          JSON.stringify(span.logs),\n          span.metadata ? JSON.stringify(span.metadata) : null\n        ]);\n      }\n      \n      await client.query('COMMIT');\n      \n    } catch (error) {\n      await client.query('ROLLBACK');\n      throw error;\n    } finally {\n      client.release();\n    }\n  }\n  \n  private async storeTraceAnalysis(analysis: TraceAnalysis): Promise<void> {\n    try {\n      await this.database.query(`\n        INSERT INTO trace_analyses \n        (trace_id, total_duration, critical_path, bottlenecks, errors, \n         service_interactions, performance_score, analyzed_at)\n        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)\n        ON CONFLICT (trace_id) DO UPDATE SET\n          total_duration = EXCLUDED.total_duration,\n          critical_path = EXCLUDED.critical_path,\n          bottlenecks = EXCLUDED.bottlenecks,\n          errors = EXCLUDED.errors,\n          service_interactions = EXCLUDED.service_interactions,\n          performance_score = EXCLUDED.performance_score,\n          analyzed_at = EXCLUDED.analyzed_at\n      `, [\n        analysis.traceId,\n        analysis.totalDuration,\n        JSON.stringify(analysis.criticalPath.map(span => span.spanId)),\n        JSON.stringify(analysis.bottlenecks),\n        JSON.stringify(analysis.errors.map(span => span.spanId)),\n        JSON.stringify(analysis.serviceInteractions),\n        analysis.performanceScore,\n        new Date()\n      ]);\n      \n    } catch (error) {\n      this.logger.error('Error storing trace analysis', { error, traceId: analysis.traceId });\n      throw error;\n    }\n  }\n  \n  async getTraceSpans(traceId: string): Promise<Span[]> {\n    try {\n      // Try Redis first for recent traces\n      const cachedTrace = await this.redis.get(`trace:${traceId}`);\n      if (cachedTrace) {\n        return JSON.parse(cachedTrace);\n      }\n      \n      // Fall back to database\n      const result = await this.database.query(`\n        SELECT * FROM distributed_traces \n        WHERE trace_id = $1 \n        ORDER BY start_time\n      `, [traceId]);\n      \n      return result.rows.map(row => ({\n        traceId: row.trace_id,\n        spanId: row.span_id,\n        parentSpanId: row.parent_span_id,\n        operationName: row.operation_name,\n        serviceName: row.service_name,\n        startTime: new Date(row.start_time).getTime(),\n        endTime: row.end_time ? new Date(row.end_time).getTime() : undefined,\n        duration: row.duration,\n        tags: JSON.parse(row.tags || '{}'),\n        logs: JSON.parse(row.logs || '[]'),\n        status: row.status,\n        metadata: row.metadata ? JSON.parse(row.metadata) : undefined\n      }));\n      \n    } catch (error) {\n      this.logger.error('Error retrieving trace spans', { error, traceId });\n      return [];\n    }\n  }\n  \n  private async findTraceByCallId(callId: string): Promise<string | null> {\n    try {\n      // Look for a trace with call_id in tags or metadata\n      const result = await this.database.query(`\n        SELECT DISTINCT trace_id \n        FROM distributed_traces \n        WHERE tags::text LIKE '%\"call_id\":\"' || $1 || '\"%'\n           OR metadata::text LIKE '%\"call_id\":\"' || $1 || '\"%'\n        ORDER BY start_time DESC \n        LIMIT 1\n      `, [callId]);\n      \n      return result.rows.length > 0 ? result.rows[0].trace_id : null;\n      \n    } catch (error) {\n      this.logger.error('Error finding trace by call ID', { error, callId });\n      return null;\n    }\n  }\n  \n  // ==========================================\n  // Cleanup and Maintenance\n  // ==========================================\n  \n  private async cleanupOldTraces(): Promise<void> {\n    try {\n      // Clean up old traces from database\n      const result = await this.database.query(`\n        DELETE FROM distributed_traces \n        WHERE start_time < NOW() - INTERVAL '${this.TRACE_RETENTION_DAYS} days'\n      `);\n      \n      if (result.rowCount && result.rowCount > 0) {\n        this.logger.info('Cleaned up old traces', { deletedCount: result.rowCount });\n      }\n      \n      // Clean up old trace analyses\n      await this.database.query(`\n        DELETE FROM trace_analyses \n        WHERE analyzed_at < NOW() - INTERVAL '${this.TRACE_RETENTION_DAYS} days'\n      `);\n      \n      // Clean up in-memory buffer if it's too large\n      if (this.traceBuffer.size > this.TRACE_BUFFER_SIZE) {\n        const oldestTraces = Array.from(this.traceBuffer.keys()).slice(0, this.traceBuffer.size - this.TRACE_BUFFER_SIZE);\n        oldestTraces.forEach(traceId => this.traceBuffer.delete(traceId));\n        \n        this.logger.info('Cleaned up trace buffer', { \n          removedTraces: oldestTraces.length,\n          currentSize: this.traceBuffer.size \n        });\n      }\n      \n    } catch (error) {\n      this.logger.error('Error cleaning up old traces', { error });\n    }\n  }\n  \n  // ==========================================\n  // Reporting and Analytics\n  // ==========================================\n  \n  async getTraceReport(timeRange: { start: Date; end: Date }): Promise<{\n    totalTraces: number;\n    avgDuration: number;\n    errorRate: number;\n    topBottlenecks: string[];\n    servicePerformance: Array<{service: string; avgDuration: number; errorRate: number}>;\n  }> {\n    try {\n      const result = await this.database.query(`\n        SELECT \n          COUNT(DISTINCT trace_id) as total_traces,\n          AVG(duration) as avg_duration,\n          COUNT(CASE WHEN status = 'error' THEN 1 END)::float / COUNT(*)::float as error_rate,\n          service_name,\n          operation_name\n        FROM distributed_traces \n        WHERE start_time BETWEEN $1 AND $2\n        GROUP BY service_name, operation_name\n      `, [timeRange.start, timeRange.end]);\n      \n      const totalTraces = result.rows.length > 0 ? parseInt(result.rows[0].total_traces) : 0;\n      const avgDuration = result.rows.length > 0 ? parseFloat(result.rows[0].avg_duration) || 0 : 0;\n      const errorRate = result.rows.length > 0 ? parseFloat(result.rows[0].error_rate) || 0 : 0;\n      \n      // Aggregate service performance\n      const servicePerformance = this.aggregateServicePerformance(result.rows);\n      \n      // Get top bottlenecks from recent analyses\n      const bottlenecksResult = await this.database.query(`\n        SELECT bottlenecks \n        FROM trace_analyses \n        WHERE analyzed_at BETWEEN $1 AND $2\n        ORDER BY analyzed_at DESC\n        LIMIT 100\n      `, [timeRange.start, timeRange.end]);\n      \n      const topBottlenecks = this.extractTopBottlenecks(bottlenecksResult.rows);\n      \n      return {\n        totalTraces,\n        avgDuration: Math.round(avgDuration),\n        errorRate: Math.round(errorRate * 10000) / 10000,\n        topBottlenecks,\n        servicePerformance\n      };\n      \n    } catch (error) {\n      this.logger.error('Error generating trace report', { error });\n      throw error;\n    }\n  }\n  \n  private aggregateServicePerformance(rows: any[]): Array<{service: string; avgDuration: number; errorRate: number}> {\n    const serviceMap = new Map<string, {durations: number[]; errors: number; total: number}>();\n    \n    rows.forEach(row => {\n      const service = row.service_name;\n      if (!serviceMap.has(service)) {\n        serviceMap.set(service, {durations: [], errors: 0, total: 0});\n      }\n      \n      const stats = serviceMap.get(service)!;\n      if (row.duration) {\n        stats.durations.push(parseFloat(row.duration));\n      }\n      if (row.status === 'error') {\n        stats.errors++;\n      }\n      stats.total++;\n    });\n    \n    return Array.from(serviceMap.entries()).map(([service, stats]) => ({\n      service,\n      avgDuration: stats.durations.length > 0 ? \n        Math.round(stats.durations.reduce((sum, d) => sum + d, 0) / stats.durations.length) : 0,\n      errorRate: stats.total > 0 ? Math.round((stats.errors / stats.total) * 10000) / 10000 : 0\n    }));\n  }\n  \n  private extractTopBottlenecks(rows: any[]): string[] {\n    const bottleneckCounts = new Map<string, number>();\n    \n    rows.forEach(row => {\n      try {\n        const bottlenecks = JSON.parse(row.bottlenecks || '[]');\n        bottlenecks.forEach((bottleneck: any) => {\n          const key = `${bottleneck.span.serviceName}.${bottleneck.span.operationName}`;\n          bottleneckCounts.set(key, (bottleneckCounts.get(key) || 0) + 1);\n        });\n      } catch (error) {\n        // Ignore JSON parse errors\n      }\n    });\n    \n    return Array.from(bottleneckCounts.entries())\n      .sort(([,a], [,b]) => b - a)\n      .slice(0, 5)\n      .map(([key]) => key);\n  }\n  \n  async shutdown(): Promise<void> {\n    if (this.cleanupInterval) {\n      clearInterval(this.cleanupInterval);\n      this.cleanupInterval = null;\n    }\n    \n    // Finish any active spans with timeout status\n    Array.from(this.activeSpans.values()).forEach(span => {\n      this.finishSpan(span, 'timeout');\n    });\n    \n    // Process any remaining traces\n    const remainingTraces = Array.from(this.traceBuffer.keys());\n    await Promise.all(remainingTraces.map(async traceId => {\n      const spans = this.traceBuffer.get(traceId)!;\n      try {\n        await this.processCompleteTrace(traceId, spans);\n      } catch (error) {\n        this.logger.error('Error processing remaining trace during shutdown', { error, traceId });\n      }\n    }));\n    \n    await this.redis.disconnect();\n    await this.database.disconnect();\n    \n    this.logger.info('Enhanced Tracing Service shut down successfully');\n  }\n}"