import { Client } from '@elastic/elasticsearch';
import { EventEmitter } from 'events';
import { LogEntry } from '../types';
import logger from '../utils/logger';
import { RedisService } from './redisService';
import config from '../config';
import fs from 'fs';
import path from 'path';
import { Transform, Readable } from 'stream';

interface LogQuery {
  services?: string[];
  levels?: ('error' | 'warn' | 'info' | 'debug')[];
  startTime: Date;
  endTime: Date;
  searchText?: string;
  userId?: string;
  callId?: string;
  traceId?: string;
  limit?: number;
  offset?: number;
}

interface LogAggregation {
  field: string;
  interval?: string; // For time-based aggregations
  size?: number;
}

interface LogPattern {
  id: string;
  name: string;
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high';
  description: string;
  actions: string[];
  enabled: boolean;
}

export class LogAggregationService extends EventEmitter {
  private esClient: Client | null = null;
  private logBuffer: LogEntry[] = [];
  private maxBufferSize = 1000;
  private flushInterval = 30000; // 30 seconds
  private logPatterns: Map<string, LogPattern> = new Map();
  private logStats = {
    totalLogs: 0,
    errorLogs: 0,
    warnLogs: 0,
    lastFlush: new Date()
  };

  constructor(private redis: RedisService) {
    super();
    this.initializeElasticsearch();
    this.setupLogPatterns();
    this.startBufferFlush();
    this.setupEventHandlers();
  }

  private initializeElasticsearch(): void {
    if (!config.features.logAggregation || !config.elasticsearch.node) {
      logger.info('Log aggregation disabled or Elasticsearch not configured');
      return;
    }

    try {
      this.esClient = new Client({
        node: config.elasticsearch.node,
        maxRetries: config.elasticsearch.maxRetries,
        requestTimeout: config.elasticsearch.requestTimeout,
        sniffOnStart: config.elasticsearch.sniffOnStart,
        auth: config.elasticsearch.auth,
      });

      // Test connection
      this.esClient.ping().then(() => {
        logger.info('Connected to Elasticsearch', {
          node: config.elasticsearch.node
        });
        this.createIndexTemplate();
      }).catch((error) => {
        logger.error('Failed to connect to Elasticsearch', { error });
        this.esClient = null;
      });

    } catch (error) {
      logger.error('Failed to initialize Elasticsearch client', { error });
    }
  }

  private async createIndexTemplate(): Promise<void> {
    if (!this.esClient) return;

    try {
      const template = {
        index_patterns: ['ai-ninja-logs-*'],
        template: {
          settings: {
            number_of_shards: 2,
            number_of_replicas: 1,
            'index.lifecycle.name': 'ai-ninja-logs-policy',
            'index.lifecycle.rollover_alias': 'ai-ninja-logs'
          },
          mappings: {
            properties: {
              '@timestamp': { type: 'date' },
              level: { type: 'keyword' },
              service: { type: 'keyword' },
              message: { 
                type: 'text',
                fields: {
                  keyword: { type: 'keyword', ignore_above: 256 }
                }
              },
              metadata: { type: 'object', dynamic: true },
              traceId: { type: 'keyword' },
              spanId: { type: 'keyword' },
              userId: { type: 'keyword' },
              callId: { type: 'keyword' },
              error: { type: 'object', dynamic: true },
              performance: { type: 'object', dynamic: true },
              business: { type: 'object', dynamic: true }
            }
          }
        }
      };

      await this.esClient.indices.putIndexTemplate({
        name: 'ai-ninja-logs-template',
        body: template
      });

      logger.info('Elasticsearch index template created');
    } catch (error) {
      logger.error('Failed to create Elasticsearch index template', { error });
    }
  }

  private setupLogPatterns(): void {
    const patterns: LogPattern[] = [
      {
        id: 'auth-failure',
        name: 'Authentication Failures',
        pattern: /(authentication|auth|login).*fail/i,
        severity: 'high',
        description: 'Detect authentication failures that might indicate attacks',
        actions: ['alert', 'block_ip'],
        enabled: true
      },
      {
        id: 'rate-limit-exceeded',
        name: 'Rate Limit Exceeded',
        pattern: /rate.limit.*exceed/i,
        severity: 'medium',
        description: 'Detect when rate limits are exceeded',
        actions: ['alert'],
        enabled: true
      },
      {
        id: 'database-error',
        name: 'Database Errors',
        pattern: /(database|db|sql).*error/i,
        severity: 'high',
        description: 'Detect database connectivity or query errors',
        actions: ['alert', 'auto_remediate'],
        enabled: true
      },
      {
        id: 'ai-service-error',
        name: 'AI Service Errors',
        pattern: /(azure.*openai|speech.*service|ai.*generation).*error/i,
        severity: 'high',
        description: 'Detect AI service failures',
        actions: ['alert', 'failover'],
        enabled: true
      },
      {
        id: 'memory-leak',
        name: 'Memory Leak Detection',
        pattern: /(out of memory|memory.*leak|heap.*overflow)/i,
        severity: 'high',
        description: 'Detect potential memory leaks',
        actions: ['alert', 'restart_service'],
        enabled: true
      },
      {
        id: 'slow-request',
        name: 'Slow Requests',
        pattern: /request.*timeout|response.*time.*exceed/i,
        severity: 'medium',
        description: 'Detect slow requests that might indicate performance issues',
        actions: ['alert'],
        enabled: true
      },
      {
        id: 'security-violation',
        name: 'Security Violations',
        pattern: /(security|injection|xss|csrf|unauthorized)/i,
        severity: 'high',
        description: 'Detect potential security violations',
        actions: ['alert', 'block_ip', 'notify_security'],
        enabled: true
      }
    ];

    patterns.forEach(pattern => {
      this.logPatterns.set(pattern.id, pattern);
    });

    logger.info(`Loaded ${patterns.length} log patterns for analysis`);
  }

  private setupEventHandlers(): void {
    this.on('log-pattern-match', this.handlePatternMatch.bind(this));
    this.on('log-anomaly-detected', this.handleLogAnomaly.bind(this));
  }

  public ingestLog(log: LogEntry): void {
    try {
      // Add timestamp if not present
      if (!log.timestamp) {
        log.timestamp = new Date();
      }

      // Analyze log for patterns
      this.analyzeLogPatterns(log);

      // Add to buffer
      this.logBuffer.push(log);
      this.logStats.totalLogs++;

      if (log.level === 'error') {
        this.logStats.errorLogs++;
      } else if (log.level === 'warn') {
        this.logStats.warnLogs++;
      }

      // Flush buffer if it's getting too large
      if (this.logBuffer.length >= this.maxBufferSize) {
        this.flushBuffer();
      }

    } catch (error) {
      logger.error('Failed to ingest log', { error, log });
    }
  }

  public ingestLogs(logs: LogEntry[]): void {
    logs.forEach(log => this.ingestLog(log));
  }

  private analyzeLogPatterns(log: LogEntry): void {
    const message = log.message.toLowerCase();

    for (const [patternId, pattern] of this.logPatterns) {
      if (!pattern.enabled) continue;

      if (pattern.pattern.test(message)) {
        this.emit('log-pattern-match', {
          patternId,
          pattern,
          log,
          timestamp: new Date()
        });
      }
    }
  }

  private async handlePatternMatch(event: {
    patternId: string;
    pattern: LogPattern;
    log: LogEntry;
    timestamp: Date;
  }): Promise<void> {
    try {
      logger.warn('Log pattern match detected', {
        patternId: event.patternId,
        patternName: event.pattern.name,
        severity: event.pattern.severity,
        service: event.log.service,
        message: event.log.message
      });

      // Execute configured actions
      for (const action of event.pattern.actions) {
        await this.executePatternAction(action, event);
      }

      // Store pattern match for analysis
      await this.storePatternMatch(event);

    } catch (error) {
      logger.error('Failed to handle pattern match', { error, event });
    }
  }

  private async executePatternAction(
    action: string,
    event: { patternId: string; pattern: LogPattern; log: LogEntry }
  ): Promise<void> {
    switch (action) {
      case 'alert':
        this.emit('create-alert', {
          name: `LogPattern_${event.pattern.name}`,
          severity: event.pattern.severity === 'high' ? 'critical' : 'warning',
          description: `Log pattern detected: ${event.pattern.description}`,
          service: event.log.service,
          details: {
            pattern: event.pattern.name,
            message: event.log.message,
            service: event.log.service
          }
        });
        break;

      case 'block_ip':
        if (event.log.metadata?.clientIp) {
          this.emit('block-ip', {
            ip: event.log.metadata.clientIp,
            reason: `Log pattern: ${event.pattern.name}`,
            duration: 3600 // 1 hour
          });
        }
        break;

      case 'auto_remediate':
        this.emit('trigger-remediation', {
          trigger: 'log_pattern',
          pattern: event.patternId,
          service: event.log.service,
          context: event.log
        });
        break;

      case 'restart_service':
        this.emit('restart-service', {
          service: event.log.service,
          reason: `Log pattern: ${event.pattern.name}`
        });
        break;

      case 'failover':
        this.emit('trigger-failover', {
          service: event.log.service,
          reason: `Log pattern: ${event.pattern.name}`
        });
        break;

      case 'notify_security':
        this.emit('security-notification', {
          type: 'log_pattern_security',
          pattern: event.pattern.name,
          log: event.log,
          severity: 'high'
        });
        break;
    }
  }

  private async storePatternMatch(event: {
    patternId: string;
    pattern: LogPattern;
    log: LogEntry;
    timestamp: Date;
  }): Promise<void> {
    try {
      const key = `pattern_match:${event.patternId}:${Date.now()}`;
      const data = {
        patternId: event.patternId,
        patternName: event.pattern.name,
        severity: event.pattern.severity,
        service: event.log.service,
        message: event.log.message,
        timestamp: event.timestamp,
        userId: event.log.userId,
        callId: event.log.callId,
        traceId: event.log.traceId
      };

      await this.redis.setex(key, 86400, JSON.stringify(data)); // 24 hours TTL

      // Also increment pattern counters
      const counterKey = `pattern_counter:${event.patternId}:${Math.floor(Date.now() / 3600000)}`;
      await this.redis.incr(counterKey);
      await this.redis.expire(counterKey, 86400 * 7); // 7 days TTL

    } catch (error) {
      logger.error('Failed to store pattern match', { error, event });
    }
  }

  public async queryLogs(query: LogQuery): Promise<{ logs: LogEntry[]; total: number }> {
    if (!this.esClient) {
      // Fallback to Redis/memory search
      return this.queryLogsFromCache(query);
    }

    try {
      const esQuery = this.buildElasticsearchQuery(query);
      
      const response = await this.esClient.search({
        index: 'ai-ninja-logs-*',
        body: {
          query: esQuery,
          sort: [{ '@timestamp': { order: 'desc' } }],
          size: query.limit || 100,
          from: query.offset || 0
        }
      });

      const logs = response.body.hits.hits.map((hit: any) => ({
        ...hit._source,
        timestamp: new Date(hit._source['@timestamp'])
      }));

      return {
        logs,
        total: response.body.hits.total.value || 0
      };

    } catch (error) {
      logger.error('Failed to query logs from Elasticsearch', { error, query });
      return this.queryLogsFromCache(query);
    }
  }

  private buildElasticsearchQuery(query: LogQuery): any {
    const must: any[] = [
      {
        range: {
          '@timestamp': {
            gte: query.startTime.toISOString(),
            lte: query.endTime.toISOString()
          }
        }
      }
    ];

    if (query.services && query.services.length > 0) {
      must.push({
        terms: { service: query.services }
      });
    }

    if (query.levels && query.levels.length > 0) {
      must.push({
        terms: { level: query.levels }
      });
    }

    if (query.searchText) {
      must.push({
        multi_match: {
          query: query.searchText,
          fields: ['message', 'message.keyword'],
          fuzziness: 'AUTO'
        }
      });
    }

    if (query.userId) {
      must.push({ term: { userId: query.userId } });
    }

    if (query.callId) {
      must.push({ term: { callId: query.callId } });
    }

    if (query.traceId) {
      must.push({ term: { traceId: query.traceId } });
    }

    return { bool: { must } };
  }

  private async queryLogsFromCache(query: LogQuery): Promise<{ logs: LogEntry[]; total: number }> {
    // This is a fallback when Elasticsearch is not available
    // Implementation would search through Redis stored logs
    logger.warn('Using cache-based log query (Elasticsearch unavailable)');
    return { logs: [], total: 0 };
  }

  public async aggregateLogs(
    query: LogQuery,
    aggregations: LogAggregation[]
  ): Promise<Record<string, any>> {
    if (!this.esClient) {
      logger.warn('Log aggregation requires Elasticsearch');
      return {};
    }

    try {
      const esQuery = this.buildElasticsearchQuery(query);
      const aggs = this.buildAggregations(aggregations);

      const response = await this.esClient.search({
        index: 'ai-ninja-logs-*',
        body: {
          query: esQuery,
          size: 0,
          aggs
        }
      });

      return response.body.aggregations || {};

    } catch (error) {
      logger.error('Failed to aggregate logs', { error, query, aggregations });
      return {};
    }
  }

  private buildAggregations(aggregations: LogAggregation[]): Record<string, any> {
    const aggs: Record<string, any> = {};

    aggregations.forEach(agg => {
      if (agg.field === '@timestamp' && agg.interval) {
        // Time-based histogram
        aggs[`${agg.field}_histogram`] = {
          date_histogram: {
            field: agg.field,
            fixed_interval: agg.interval,
            min_doc_count: 0
          }
        };
      } else {
        // Terms aggregation
        aggs[`${agg.field}_terms`] = {
          terms: {
            field: agg.field,
            size: agg.size || 10
          }
        };
      }
    });

    return aggs;
  }

  private startBufferFlush(): void {
    setInterval(() => {
      this.flushBuffer();
    }, this.flushInterval);
  }

  private async flushBuffer(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    const logs = this.logBuffer.splice(0); // Move all logs from buffer
    this.logStats.lastFlush = new Date();

    try {
      if (this.esClient) {
        await this.bulkIndexToElasticsearch(logs);
      }

      // Also store in Redis as backup/cache
      await this.storeBatchInRedis(logs);

      logger.debug('Flushed log buffer', {
        count: logs.length,
        destination: this.esClient ? 'elasticsearch+redis' : 'redis'
      });

    } catch (error) {
      logger.error('Failed to flush log buffer', { error, logCount: logs.length });
      
      // Put logs back in buffer for retry
      this.logBuffer.unshift(...logs);
    }
  }

  private async bulkIndexToElasticsearch(logs: LogEntry[]): Promise<void> {
    if (!this.esClient) return;

    const body: any[] = [];
    const indexName = `ai-ninja-logs-${new Date().toISOString().slice(0, 10)}`;

    logs.forEach(log => {
      body.push({ index: { _index: indexName } });
      body.push({
        '@timestamp': log.timestamp,
        level: log.level,
        service: log.service,
        message: log.message,
        metadata: log.metadata,
        traceId: log.traceId,
        spanId: log.spanId,
        userId: log.userId,
        callId: log.callId
      });
    });

    await this.esClient.bulk({ body });
  }

  private async storeBatchInRedis(logs: LogEntry[]): Promise<void> {
    // Group logs by hour for efficient storage
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
  }

  // Log streaming for real-time monitoring
  public createLogStream(query: LogQuery): Readable {
    const stream = new Readable({ objectMode: true });
    let isStreaming = true;

    // Start streaming
    const streamLogs = async () => {
      while (isStreaming) {
        try {
          const logs = await this.queryLogs({
            ...query,
            startTime: new Date(Date.now() - 60000), // Last minute
            limit: 50
          });

          logs.logs.forEach(log => {
            if (isStreaming) {
              stream.push(log);
            }
          });

          // Wait 5 seconds before next batch
          await new Promise(resolve => setTimeout(resolve, 5000));

        } catch (error) {
          stream.emit('error', error);
          break;
        }
      }

      stream.push(null); // End stream
    };

    // Stop streaming when stream is closed
    stream.on('close', () => {
      isStreaming = false;
    });

    // Start streaming
    streamLogs();

    return stream;
  }

  // Analytics methods
  public async getLogStatistics(
    services: string[],
    timeRange: { start: Date; end: Date }
  ): Promise<{
    totalLogs: number;
    errorRate: number;
    topServices: Array<{ service: string; count: number }>;
    errorTrends: Array<{ time: string; errors: number }>;
  }> {
    if (!this.esClient) {
      return {
        totalLogs: this.logStats.totalLogs,
        errorRate: this.logStats.errorLogs / this.logStats.totalLogs || 0,
        topServices: [],
        errorTrends: []
      };
    }

    try {
      const aggs = await this.aggregateLogs(
        {
          services,
          startTime: timeRange.start,
          endTime: timeRange.end
        },
        [
          { field: 'service', size: 10 },
          { field: '@timestamp', interval: '1h' },
          { field: 'level' }
        ]
      );

      const totalLogs = aggs.level_terms?.buckets?.reduce((sum: number, bucket: any) => sum + bucket.doc_count, 0) || 0;
      const errorLogs = aggs.level_terms?.buckets?.find((bucket: any) => bucket.key === 'error')?.doc_count || 0;
      
      return {
        totalLogs,
        errorRate: totalLogs > 0 ? errorLogs / totalLogs : 0,
        topServices: aggs.service_terms?.buckets?.map((bucket: any) => ({
          service: bucket.key,
          count: bucket.doc_count
        })) || [],
        errorTrends: aggs['@timestamp_histogram']?.buckets?.map((bucket: any) => ({
          time: bucket.key_as_string,
          errors: bucket.doc_count
        })) || []
      };

    } catch (error) {
      logger.error('Failed to get log statistics', { error });
      return {
        totalLogs: 0,
        errorRate: 0,
        topServices: [],
        errorTrends: []
      };
    }
  }

  public async getPatternStatistics(): Promise<Array<{
    patternId: string;
    patternName: string;
    count: number;
    lastSeen: Date;
  }>> {
    try {
      const patterns: Array<any> = [];
      const keys = await this.redis.scan('pattern_counter:*');
      
      for (const key of keys) {
        const count = await this.redis.get(key);
        const [, patternId] = key.split(':');
        const pattern = this.logPatterns.get(patternId);
        
        if (pattern && count) {
          patterns.push({
            patternId,
            patternName: pattern.name,
            count: parseInt(count),
            lastSeen: new Date() // This could be more accurate with additional tracking
          });
        }
      }

      return patterns.sort((a, b) => b.count - a.count);

    } catch (error) {
      logger.error('Failed to get pattern statistics', { error });
      return [];
    }
  }

  public getLogBufferStatus(): {
    bufferSize: number;
    maxBufferSize: number;
    stats: typeof this.logStats;
  } {
    return {
      bufferSize: this.logBuffer.length,
      maxBufferSize: this.maxBufferSize,
      stats: this.logStats
    };
  }

  public shutdown(): void {
    // Flush remaining logs
    if (this.logBuffer.length > 0) {
      this.flushBuffer();
    }

    // Close Elasticsearch client
    if (this.esClient) {
      this.esClient.close();
    }

    logger.info('Log aggregation service shut down');
  }
}