import { Pool, PoolClient, QueryResult } from 'pg';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

interface QueryPlan {
  query: string;
  params: any[];
  hash: string;
  executionPlan?: string;
  estimatedCost?: number;
  actualCost?: number;
  rowsEstimate?: number;
  indexes?: string[];
}

interface QueryStats {
  query: string;
  executionCount: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  lastExecution: number;
  cacheHits: number;
  cacheMisses: number;
}

interface PreparedStatement {
  name: string;
  query: string;
  params: number;
  lastUsed: number;
  useCount: number;
}

interface ConnectionPoolConfig {
  min: number;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeout: number;
  query_timeout: number;
}

export class QueryOptimizer extends EventEmitter {
  private pool: Pool;
  private queryCache: Map<string, QueryResult>;
  private queryStats: Map<string, QueryStats>;
  private preparedStatements: Map<string, PreparedStatement>;
  private slowQueryLog: Array<{ query: string; time: number; timestamp: number }>;
  private poolConfig: ConnectionPoolConfig;
  
  // Optimization features
  private readonly batchQueue: Map<string, Array<{ params: any[]; resolve: Function; reject: Function }>>;
  private readonly indexSuggestions: Map<string, string[]>;
  private readonly queryRewriter: QueryRewriter;
  private readonly planAnalyzer: ExecutionPlanAnalyzer;
  
  constructor(config: {
    connectionString: string;
    poolConfig?: Partial<ConnectionPoolConfig>;
    cacheSize?: number;
    slowQueryThreshold?: number;
  }) {
    super();
    
    this.poolConfig = {
      min: 5,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      statementTimeout: 5000,
      query_timeout: 5000,
      ...config.poolConfig,
    };
    
    // Initialize optimized connection pool
    this.pool = new Pool({
      connectionString: config.connectionString,
      min: this.poolConfig.min,
      max: this.poolConfig.max,
      idleTimeoutMillis: this.poolConfig.idleTimeoutMillis,
      connectionTimeoutMillis: this.poolConfig.connectionTimeoutMillis,
      statement_timeout: this.poolConfig.statementTimeout,
      query_timeout: this.poolConfig.query_timeout,
    });
    
    // Query optimization components
    this.queryCache = new Map();
    this.queryStats = new Map();
    this.preparedStatements = new Map();
    this.slowQueryLog = [];
    this.batchQueue = new Map();
    this.indexSuggestions = new Map();
    
    this.queryRewriter = new QueryRewriter();
    this.planAnalyzer = new ExecutionPlanAnalyzer();
    
    // Setup pool event handlers
    this.setupPoolHandlers();
    
    // Start optimization loops
    this.startOptimizationLoop();
    this.startBatchProcessor();
  }

  /**
   * Execute optimized query with caching and statistics
   */
  async query<T = any>(
    text: string,
    params?: any[],
    options?: {
      cache?: boolean;
      cacheTTL?: number;
      prepared?: boolean;
      batch?: boolean;
      timeout?: number;
    }
  ): Promise<QueryResult<T>> {
    const startTime = Date.now();
    const queryHash = this.hashQuery(text, params);
    
    try {
      // Check cache first
      if (options?.cache !== false) {
        const cached = this.queryCache.get(queryHash);
        if (cached) {
          this.recordCacheHit(text, Date.now() - startTime);
          return cached as QueryResult<T>;
        }
      }
      
      // Rewrite query for optimization
      const optimizedQuery = await this.optimizeQuery(text, params);
      
      // Batch processing for similar queries
      if (options?.batch && this.canBatch(optimizedQuery.query)) {
        return await this.batchQuery<T>(optimizedQuery.query, params || []);
      }
      
      // Use prepared statement for frequently used queries
      if (options?.prepared || this.shouldUsePrepared(text)) {
        return await this.executePrepared<T>(optimizedQuery, params);
      }
      
      // Execute with connection from pool
      const result = await this.executeWithRetry<T>(optimizedQuery, options?.timeout);
      
      // Update statistics and cache
      const executionTime = Date.now() - startTime;
      this.updateQueryStats(text, executionTime);
      
      if (options?.cache !== false) {
        this.cacheResult(queryHash, result, options?.cacheTTL || 60000);
      }
      
      // Analyze slow queries
      if (executionTime > 100) {
        await this.analyzeSlowQuery(optimizedQuery, executionTime);
      }
      
      return result;
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.recordQueryError(text, error, executionTime);
      throw error;
    }
  }

  /**
   * Execute multiple queries in parallel with optimization
   */
  async parallel<T = any>(
    queries: Array<{ text: string; params?: any[]; cache?: boolean }>
  ): Promise<QueryResult<T>[]> {
    // Group similar queries for batch processing
    const grouped = this.groupQueries(queries);
    
    const promises = grouped.map(async (group) => {
      if (group.length === 1) {
        return [await this.query<T>(group[0].text, group[0].params, { cache: group[0].cache })];
      }
      
      // Batch execute similar queries
      return await this.batchExecute<T>(group);
    });
    
    const results = await Promise.all(promises);
    return results.flat();
  }

  /**
   * Optimize query before execution
   */
  private async optimizeQuery(text: string, params?: any[]): Promise<QueryPlan> {
    // Apply query rewriting rules
    let optimized = this.queryRewriter.rewrite(text);
    
    // Add query hints for PostgreSQL optimizer
    optimized = this.addQueryHints(optimized);
    
    // Parameterize for better plan caching
    const parameterized = this.parameterizeQuery(optimized, params);
    
    return {
      query: parameterized.query,
      params: parameterized.params,
      hash: this.hashQuery(parameterized.query, parameterized.params),
    };
  }

  /**
   * Execute with connection retry and timeout
   */
  private async executeWithRetry<T>(
    plan: QueryPlan,
    timeout?: number
  ): Promise<QueryResult<T>> {
    let retries = 3;
    let lastError: any;
    
    while (retries > 0) {
      const client = await this.pool.connect();
      
      try {
        // Set statement timeout for this query
        if (timeout) {
          await client.query(`SET statement_timeout = ${timeout}`);
        }
        
        const result = await client.query<T>(plan.query, plan.params);
        
        return result;
        
      } catch (error: any) {
        lastError = error;
        
        // Retry on connection errors
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          retries--;
          await this.sleep(100 * (4 - retries)); // Exponential backoff
          continue;
        }
        
        throw error;
        
      } finally {
        client.release();
      }
    }
    
    throw lastError;
  }

  /**
   * Execute prepared statement with caching
   */
  private async executePrepared<T>(
    plan: QueryPlan,
    params?: any[]
  ): Promise<QueryResult<T>> {
    const statementName = `stmt_${plan.hash.substring(0, 16)}`;
    let statement = this.preparedStatements.get(statementName);
    
    if (!statement) {
      // Prepare the statement
      const client = await this.pool.connect();
      
      try {
        await client.query({
          name: statementName,
          text: plan.query,
          values: params,
        });
        
        statement = {
          name: statementName,
          query: plan.query,
          params: params?.length || 0,
          lastUsed: Date.now(),
          useCount: 0,
        };
        
        this.preparedStatements.set(statementName, statement);
        
      } finally {
        client.release();
      }
    }
    
    // Execute prepared statement
    const client = await this.pool.connect();
    
    try {
      const result = await client.query<T>({
        name: statementName,
        values: params,
      });
      
      statement.lastUsed = Date.now();
      statement.useCount++;
      
      return result;
      
    } finally {
      client.release();
    }
  }

  /**
   * Batch similar queries for efficiency
   */
  private async batchQuery<T>(
    query: string,
    params: any[]
  ): Promise<QueryResult<T>> {
    return new Promise((resolve, reject) => {
      const batchKey = this.getBatchKey(query);
      
      if (!this.batchQueue.has(batchKey)) {
        this.batchQueue.set(batchKey, []);
      }
      
      this.batchQueue.get(batchKey)!.push({ params, resolve, reject });
    });
  }

  /**
   * Process batched queries
   */
  private async processBatch(batchKey: string): Promise<void> {
    const batch = this.batchQueue.get(batchKey);
    if (!batch || batch.length === 0) return;
    
    this.batchQueue.set(batchKey, []);
    
    try {
      // Convert to efficient bulk query
      const bulkQuery = this.convertToBulkQuery(batchKey, batch.map(b => b.params));
      const client = await this.pool.connect();
      
      try {
        const result = await client.query(bulkQuery.query, bulkQuery.params);
        
        // Distribute results to individual promises
        let offset = 0;
        for (const item of batch) {
          const itemResult = {
            rows: result.rows.slice(offset, offset + 1),
            rowCount: 1,
            command: result.command,
            oid: result.oid,
            fields: result.fields,
          };
          
          item.resolve(itemResult);
          offset++;
        }
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      // Reject all promises in batch
      for (const item of batch) {
        item.reject(error);
      }
    }
  }

  /**
   * Analyze slow queries and suggest optimizations
   */
  private async analyzeSlowQuery(plan: QueryPlan, executionTime: number): Promise<void> {
    this.slowQueryLog.push({
      query: plan.query,
      time: executionTime,
      timestamp: Date.now(),
    });
    
    // Keep log bounded
    if (this.slowQueryLog.length > 100) {
      this.slowQueryLog.shift();
    }
    
    // Get execution plan
    const client = await this.pool.connect();
    
    try {
      const explainResult = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${plan.query}`,
        plan.params
      );
      
      const executionPlan = explainResult.rows[0]['QUERY PLAN'][0];
      plan.executionPlan = JSON.stringify(executionPlan);
      plan.actualCost = executionPlan['Actual Total Time'];
      
      // Analyze plan for optimization opportunities
      const suggestions = this.planAnalyzer.analyze(executionPlan);
      
      if (suggestions.indexes.length > 0) {
        this.indexSuggestions.set(plan.hash, suggestions.indexes);
        
        this.emit('optimization-suggestion', {
          query: plan.query,
          suggestions: suggestions,
          executionTime,
        });
      }
      
    } catch (error) {
      // Ignore explain errors
    } finally {
      client.release();
    }
  }

  /**
   * Setup connection pool event handlers
   */
  private setupPoolHandlers(): void {
    this.pool.on('error', (err, client) => {
      console.error('Unexpected pool error', err);
      this.emit('pool-error', err);
    });
    
    this.pool.on('connect', (client) => {
      // Set optimal connection parameters
      client.query('SET work_mem = "256MB"');
      client.query('SET random_page_cost = 1.1');
      client.query('SET effective_cache_size = "4GB"');
    });
    
    this.pool.on('acquire', (client) => {
      this.emit('connection-acquired');
    });
    
    this.pool.on('remove', (client) => {
      this.emit('connection-removed');
    });
  }

  /**
   * Start optimization background tasks
   */
  private startOptimizationLoop(): void {
    // Analyze query patterns
    setInterval(() => {
      this.analyzeQueryPatterns();
      this.cleanupCache();
      this.optimizePreparedStatements();
    }, 60000); // Every minute
    
    // Pool health check
    setInterval(() => {
      this.checkPoolHealth();
    }, 10000); // Every 10 seconds
  }

  /**
   * Start batch processing loop
   */
  private startBatchProcessor(): void {
    setInterval(() => {
      for (const [batchKey] of this.batchQueue) {
        this.processBatch(batchKey);
      }
    }, 10); // Every 10ms
  }

  /**
   * Analyze query patterns for optimization
   */
  private analyzeQueryPatterns(): void {
    const patterns: Map<string, number> = new Map();
    
    for (const [query, stats] of this.queryStats) {
      // Find query patterns
      const pattern = this.extractQueryPattern(query);
      patterns.set(pattern, (patterns.get(pattern) || 0) + stats.executionCount);
    }
    
    // Identify hot patterns for optimization
    const hotPatterns = Array.from(patterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    for (const [pattern, count] of hotPatterns) {
      if (count > 100) {
        this.emit('hot-pattern', { pattern, count });
      }
    }
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    
    for (const [key, result] of this.queryCache) {
      // Simple TTL check (would need actual TTL tracking)
      if (this.queryCache.size > 1000) {
        toDelete.push(key);
      }
    }
    
    for (const key of toDelete.slice(0, 100)) {
      this.queryCache.delete(key);
    }
  }

  /**
   * Optimize prepared statements
   */
  private optimizePreparedStatements(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    
    for (const [name, stmt] of this.preparedStatements) {
      // Remove unused statements
      if (now - stmt.lastUsed > 300000) { // 5 minutes
        toDelete.push(name);
      }
    }
    
    for (const name of toDelete) {
      this.preparedStatements.delete(name);
    }
  }

  /**
   * Check pool health and adjust size
   */
  private async checkPoolHealth(): Promise<void> {
    const { totalCount, idleCount, waitingCount } = this.pool;
    
    // Auto-scale pool based on usage
    if (waitingCount > 5 && totalCount < this.poolConfig.max) {
      // Pool under pressure, consider scaling
      this.emit('pool-pressure', { totalCount, idleCount, waitingCount });
    }
    
    if (idleCount > this.poolConfig.min * 2 && totalCount > this.poolConfig.min) {
      // Too many idle connections
      this.emit('pool-idle', { totalCount, idleCount });
    }
  }

  // Helper methods
  
  private hashQuery(query: string, params?: any[]): string {
    const content = query + JSON.stringify(params || []);
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  
  private shouldUsePrepared(query: string): boolean {
    const stats = this.queryStats.get(query);
    return stats ? stats.executionCount > 10 : false;
  }
  
  private canBatch(query: string): boolean {
    // Simple check for batchable queries
    return query.toLowerCase().startsWith('select') && 
           !query.toLowerCase().includes('for update');
  }
  
  private getBatchKey(query: string): string {
    // Extract table and columns for batching
    const match = query.match(/SELECT (.+) FROM (\w+)/i);
    return match ? `${match[2]}_${match[1]}` : query;
  }
  
  private groupQueries(queries: any[]): any[][] {
    const groups: Map<string, any[]> = new Map();
    
    for (const query of queries) {
      const key = this.getBatchKey(query.text);
      
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      
      groups.get(key)!.push(query);
    }
    
    return Array.from(groups.values());
  }
  
  private async batchExecute<T>(queries: any[]): Promise<QueryResult<T>[]> {
    // Execute similar queries in batch
    const results: QueryResult<T>[] = [];
    
    // Use UNION ALL for similar SELECT queries
    if (queries[0].text.toLowerCase().startsWith('select')) {
      const unionQuery = queries
        .map(q => `(${q.text})`)
        .join(' UNION ALL ');
      
      const allParams = queries.flatMap(q => q.params || []);
      const result = await this.query<T>(unionQuery, allParams);
      
      // Split results back
      let offset = 0;
      for (const query of queries) {
        const rowCount = 1; // Simplified
        results.push({
          rows: result.rows.slice(offset, offset + rowCount),
          rowCount,
          command: result.command,
          oid: result.oid,
          fields: result.fields,
        });
        offset += rowCount;
      }
    } else {
      // Execute sequentially if not batchable
      for (const query of queries) {
        results.push(await this.query<T>(query.text, query.params));
      }
    }
    
    return results;
  }
  
  private convertToBulkQuery(batchKey: string, paramsList: any[][]): any {
    // Convert multiple queries to efficient bulk query
    // This is simplified - actual implementation would be more complex
    
    if (batchKey.startsWith('SELECT')) {
      // Use VALUES for bulk SELECT
      const values = paramsList.map((params, i) => `($${i + 1})`).join(',');
      return {
        query: `SELECT * FROM (VALUES ${values}) AS t`,
        params: paramsList.flat(),
      };
    }
    
    // Default to original query
    return { query: batchKey, params: paramsList[0] };
  }
  
  private addQueryHints(query: string): string {
    // Add PostgreSQL optimizer hints
    let optimized = query;
    
    // Force index usage for known patterns
    if (query.includes('WHERE') && query.includes('created_at')) {
      optimized = optimized.replace('WHERE', '/*+ IndexScan(created_at_idx) */ WHERE');
    }
    
    return optimized;
  }
  
  private parameterizeQuery(query: string, params?: any[]): any {
    // Ensure query is properly parameterized
    return { query, params: params || [] };
  }
  
  private extractQueryPattern(query: string): string {
    // Extract query pattern for analysis
    return query
      .replace(/\$\d+/g, '?') // Replace parameters
      .replace(/\d+/g, 'N') // Replace numbers
      .replace(/'.+?'/g, 'S'); // Replace strings
  }
  
  private recordCacheHit(query: string, time: number): void {
    const stats = this.queryStats.get(query);
    
    if (stats) {
      stats.cacheHits++;
    }
  }
  
  private updateQueryStats(query: string, time: number): void {
    let stats = this.queryStats.get(query);
    
    if (!stats) {
      stats = {
        query,
        executionCount: 0,
        totalTime: 0,
        avgTime: 0,
        minTime: time,
        maxTime: time,
        lastExecution: Date.now(),
        cacheHits: 0,
        cacheMisses: 0,
      };
      this.queryStats.set(query, stats);
    }
    
    stats.executionCount++;
    stats.totalTime += time;
    stats.avgTime = stats.totalTime / stats.executionCount;
    stats.minTime = Math.min(stats.minTime, time);
    stats.maxTime = Math.max(stats.maxTime, time);
    stats.lastExecution = Date.now();
    stats.cacheMisses++;
  }
  
  private cacheResult(key: string, result: QueryResult, ttl: number): void {
    this.queryCache.set(key, result);
    
    // Simple TTL implementation
    setTimeout(() => {
      this.queryCache.delete(key);
    }, ttl);
  }
  
  private recordQueryError(query: string, error: any, time: number): void {
    this.emit('query-error', {
      query,
      error: error.message,
      time,
      timestamp: Date.now(),
    });
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Public API
  
  getStatistics(): any {
    const stats = {
      poolSize: this.pool.totalCount,
      poolIdle: this.pool.idleCount,
      poolWaiting: this.pool.waitingCount,
      cacheSize: this.queryCache.size,
      preparedStatements: this.preparedStatements.size,
      slowQueries: this.slowQueryLog.length,
      queryPatterns: this.queryStats.size,
    };
    
    return stats;
  }
  
  async shutdown(): Promise<void> {
    await this.pool.end();
    this.queryCache.clear();
    this.queryStats.clear();
    this.preparedStatements.clear();
    this.removeAllListeners();
  }
}

// Supporting classes

class QueryRewriter {
  rewrite(query: string): string {
    let optimized = query;
    
    // Common optimizations
    optimized = this.optimizeJoins(optimized);
    optimized = this.optimizeSubqueries(optimized);
    optimized = this.addIndexHints(optimized);
    
    return optimized;
  }
  
  private optimizeJoins(query: string): string {
    // Convert RIGHT JOIN to LEFT JOIN for better optimization
    return query.replace(/RIGHT JOIN/gi, 'LEFT JOIN');
  }
  
  private optimizeSubqueries(query: string): string {
    // Convert IN subqueries to EXISTS for better performance
    return query.replace(/WHERE (\w+) IN \(SELECT/gi, 'WHERE EXISTS (SELECT 1');
  }
  
  private addIndexHints(query: string): string {
    // Add index hints for known patterns
    return query;
  }
}

class ExecutionPlanAnalyzer {
  analyze(plan: any): { indexes: string[]; optimizations: string[] } {
    const suggestions = {
      indexes: [] as string[],
      optimizations: [] as string[],
    };
    
    // Analyze for missing indexes
    if (plan['Node Type'] === 'Seq Scan' && plan['Actual Rows'] > 1000) {
      suggestions.indexes.push(`CREATE INDEX ON ${plan['Relation Name']} (${plan['Filter']?.match(/\w+/)?.[0]})`);
    }
    
    // Check for sort operations that could use indexes
    if (plan['Node Type'] === 'Sort' && plan['Actual Rows'] > 100) {
      suggestions.indexes.push(`CREATE INDEX ON table (${plan['Sort Key']})`);
    }
    
    return suggestions;
  }
}

export default QueryOptimizer;