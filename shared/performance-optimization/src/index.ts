import { EventEmitter } from 'events';
import { PredictiveCache } from './cache/PredictiveCache';
import { QueryOptimizer } from './database/QueryOptimizer';
import { NetworkOptimizer } from './network/NetworkOptimizer';
import * as os from 'os';
import * as v8 from 'v8';

export * from './cache/PredictiveCache';
export * from './database/QueryOptimizer';
export * from './network/NetworkOptimizer';

interface PerformanceConfig {
  cache: {
    enabled: boolean;
    maxSize: number;
    ttl: number;
    predictive: boolean;
  };
  database: {
    connectionString: string;
    poolSize: number;
    queryCache: boolean;
    slowQueryThreshold: number;
  };
  network: {
    compression: boolean;
    connectionPooling: boolean;
    batching: boolean;
    http2: boolean;
  };
  monitoring: {
    enabled: boolean;
    interval: number;
    metrics: string[];
  };
  optimization: {
    autoTune: boolean;
    targetLatency: number;
    memoryLimit: number;
    cpuLimit: number;
  };
}

interface PerformanceMetrics {
  timestamp: number;
  latency: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
  throughput: {
    requestsPerSecond: number;
    bytesPerSecond: number;
  };
  cache: {
    hitRate: number;
    missRate: number;
    evictions: number;
    size: number;
  };
  database: {
    activeConnections: number;
    queryTime: number;
    slowQueries: number;
  };
  network: {
    activeRequests: number;
    compressionRatio: number;
    connectionReuse: number;
  };
  system: {
    cpuUsage: number;
    memoryUsage: number;
    heapUsed: number;
    heapTotal: number;
    gcTime: number;
  };
}

export class PerformanceOptimizationSuite extends EventEmitter {
  private config: PerformanceConfig;
  private cache: PredictiveCache;
  private queryOptimizer: QueryOptimizer;
  private networkOptimizer: NetworkOptimizer;
  
  // Monitoring
  private metrics: PerformanceMetrics[] = [];
  private monitoringInterval?: NodeJS.Timeout;
  private gcStats: any = { count: 0, totalTime: 0 };
  
  // Optimization state
  private optimizationState = {
    lastOptimization: 0,
    optimizationCount: 0,
    currentProfile: 'balanced' as 'aggressive' | 'balanced' | 'conservative',
  };
  
  constructor(config: Partial<PerformanceConfig>) {
    super();
    
    this.config = {
      cache: {
        enabled: true,
        maxSize: 10000,
        ttl: 300000, // 5 minutes
        predictive: true,
        ...config.cache,
      },
      database: {
        connectionString: config.database?.connectionString || '',
        poolSize: 20,
        queryCache: true,
        slowQueryThreshold: 100,
        ...config.database,
      },
      network: {
        compression: true,
        connectionPooling: true,
        batching: true,
        http2: true,
        ...config.network,
      },
      monitoring: {
        enabled: true,
        interval: 10000, // 10 seconds
        metrics: ['latency', 'throughput', 'cache', 'system'],
        ...config.monitoring,
      },
      optimization: {
        autoTune: true,
        targetLatency: 1000, // 1 second
        memoryLimit: 512 * 1024 * 1024, // 512MB
        cpuLimit: 0.8, // 80%
        ...config.optimization,
      },
    };
    
    // Initialize components
    this.cache = new PredictiveCache({
      maxSize: this.config.cache.maxSize,
      ttl: this.config.cache.ttl,
      strategy: {
        aggressive: this.config.cache.predictive,
        threshold: 0.7,
        maxPrefetch: 10,
      },
    });
    
    this.queryOptimizer = new QueryOptimizer({
      connectionString: this.config.database.connectionString,
      poolConfig: {
        max: this.config.database.poolSize,
      },
      cacheSize: this.config.database.queryCache ? 1000 : 0,
      slowQueryThreshold: this.config.database.slowQueryThreshold,
    });
    
    this.networkOptimizer = new NetworkOptimizer({
      compression: {
        enabled: this.config.network.compression,
        algorithm: 'brotli',
        level: 6,
        threshold: 1024,
        adaptiveCompression: true,
      },
      connectionPool: {
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 30000,
        keepAliveTimeout: 60000,
        scheduling: 'lifo',
      },
      batchConfig: {
        enabled: this.config.network.batching,
        maxBatchSize: 100,
        maxWaitTime: 10,
        compression: true,
      },
      protocolConfig: {
        preferHttp2: this.config.network.http2,
        multiplexing: true,
        pipelining: true,
        tcpNoDelay: true,
        keepAlive: true,
      },
    });
    
    this.initialize();
  }

  private initialize(): void {
    // Setup event handlers
    this.setupEventHandlers();
    
    // Start monitoring
    if (this.config.monitoring.enabled) {
      this.startMonitoring();
    }
    
    // Start auto-optimization
    if (this.config.optimization.autoTune) {
      this.startAutoOptimization();
    }
    
    // Setup GC monitoring
    this.setupGCMonitoring();
  }

  /**
   * Setup event handlers for components
   */
  private setupEventHandlers(): void {
    // Cache events
    this.cache.on('frequent-eviction', (data) => {
      this.handleFrequentEviction(data);
    });
    
    this.cache.on('prefetch-suggested', (data) => {
      this.emit('prefetch-suggestion', data);
    });
    
    // Query optimizer events
    this.queryOptimizer.on('optimization-suggestion', (data) => {
      this.handleQueryOptimizationSuggestion(data);
    });
    
    this.queryOptimizer.on('slow-query', (data) => {
      this.emit('slow-query-detected', data);
    });
    
    // Network optimizer events
    this.networkOptimizer.on('pool-resized', (data) => {
      this.emit('connection-pool-adjusted', data);
    });
    
    this.networkOptimizer.on('compression-adjusted', (data) => {
      this.emit('compression-settings-changed', data);
    });
  }

  /**
   * Start performance monitoring
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.monitoring.interval);
    
    // Initial collection
    this.collectMetrics();
  }

  /**
   * Collect performance metrics
   */
  private async collectMetrics(): Promise<void> {
    const metrics: PerformanceMetrics = {
      timestamp: Date.now(),
      latency: this.calculateLatencyMetrics(),
      throughput: this.calculateThroughputMetrics(),
      cache: this.cache.getStatistics(),
      database: this.queryOptimizer.getStatistics(),
      network: this.networkOptimizer.getStatistics(),
      system: this.getSystemMetrics(),
    };
    
    this.metrics.push(metrics);
    
    // Keep only recent metrics (last hour)
    const oneHourAgo = Date.now() - 3600000;
    this.metrics = this.metrics.filter(m => m.timestamp > oneHourAgo);
    
    // Emit metrics event
    this.emit('metrics-collected', metrics);
    
    // Check for performance issues
    this.checkPerformanceThresholds(metrics);
  }

  /**
   * Calculate latency metrics
   */
  private calculateLatencyMetrics(): any {
    // This would aggregate latency data from all components
    const latencies: number[] = [];
    
    // Collect from recent metrics
    for (const metric of this.metrics.slice(-100)) {
      if (metric.database.queryTime) {
        latencies.push(metric.database.queryTime);
      }
    }
    
    if (latencies.length === 0) {
      return { p50: 0, p95: 0, p99: 0, avg: 0 };
    }
    
    latencies.sort((a, b) => a - b);
    
    return {
      p50: latencies[Math.floor(latencies.length * 0.5)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
      p99: latencies[Math.floor(latencies.length * 0.99)],
      avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    };
  }

  /**
   * Calculate throughput metrics
   */
  private calculateThroughputMetrics(): any {
    // Calculate from recent metrics
    const recentMetrics = this.metrics.slice(-10);
    
    if (recentMetrics.length < 2) {
      return { requestsPerSecond: 0, bytesPerSecond: 0 };
    }
    
    const timeSpan = (recentMetrics[recentMetrics.length - 1].timestamp - 
                     recentMetrics[0].timestamp) / 1000;
    
    const totalRequests = recentMetrics.reduce((sum, m) => 
      sum + (m.network?.activeRequests || 0), 0);
    
    return {
      requestsPerSecond: totalRequests / timeSpan,
      bytesPerSecond: 0, // Would need actual byte tracking
    };
  }

  /**
   * Get system metrics
   */
  private getSystemMetrics(): any {
    const cpus = os.cpus();
    const totalCpu = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + (1 - idle / total);
    }, 0);
    
    const memUsage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    
    return {
      cpuUsage: totalCpu / cpus.length,
      memoryUsage: memUsage.rss / os.totalmem(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      gcTime: this.gcStats.totalTime,
    };
  }

  /**
   * Setup GC monitoring
   */
  private setupGCMonitoring(): void {
    // Monitor garbage collection
    const originalGc = global.gc;
    
    if (originalGc && typeof originalGc === 'function') {
      global.gc = (...args: any[]) => {
        const startTime = Date.now();
        const result = originalGc.apply(global, args);
        const gcTime = Date.now() - startTime;
        
        this.gcStats.count++;
        this.gcStats.totalTime += gcTime;
        
        if (gcTime > 50) {
          this.emit('long-gc', { duration: gcTime });
        }
        
        return result;
      };
    }
  }

  /**
   * Start auto-optimization loop
   */
  private startAutoOptimization(): void {
    setInterval(() => {
      this.performAutoOptimization();
    }, 60000); // Every minute
  }

  /**
   * Perform automatic optimization
   */
  private async performAutoOptimization(): Promise<void> {
    const currentMetrics = this.metrics[this.metrics.length - 1];
    
    if (!currentMetrics) return;
    
    // Check if optimization is needed
    const needsOptimization = this.checkOptimizationNeeded(currentMetrics);
    
    if (!needsOptimization) return;
    
    this.optimizationState.lastOptimization = Date.now();
    this.optimizationState.optimizationCount++;
    
    // Determine optimization profile
    const profile = this.determineOptimizationProfile(currentMetrics);
    this.optimizationState.currentProfile = profile;
    
    // Apply optimizations based on profile
    await this.applyOptimizations(profile, currentMetrics);
    
    this.emit('auto-optimization-performed', {
      profile,
      metrics: currentMetrics,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if optimization is needed
   */
  private checkOptimizationNeeded(metrics: PerformanceMetrics): boolean {
    // Don't optimize too frequently
    if (Date.now() - this.optimizationState.lastOptimization < 30000) {
      return false;
    }
    
    // Check various thresholds
    const checks = [
      metrics.latency.p95 > this.config.optimization.targetLatency,
      metrics.cache.hitRate < 0.5,
      metrics.system.cpuUsage > this.config.optimization.cpuLimit,
      metrics.system.heapUsed > this.config.optimization.memoryLimit,
      metrics.database.slowQueries > 10,
    ];
    
    return checks.some(check => check);
  }

  /**
   * Determine optimization profile based on metrics
   */
  private determineOptimizationProfile(metrics: PerformanceMetrics): 
    'aggressive' | 'balanced' | 'conservative' {
    
    // High latency - be aggressive
    if (metrics.latency.p95 > this.config.optimization.targetLatency * 1.5) {
      return 'aggressive';
    }
    
    // High resource usage - be conservative
    if (metrics.system.cpuUsage > 0.9 || 
        metrics.system.heapUsed > this.config.optimization.memoryLimit * 0.9) {
      return 'conservative';
    }
    
    return 'balanced';
  }

  /**
   * Apply optimizations based on profile
   */
  private async applyOptimizations(
    profile: 'aggressive' | 'balanced' | 'conservative',
    metrics: PerformanceMetrics
  ): Promise<void> {
    switch (profile) {
      case 'aggressive':
        await this.applyAggressiveOptimizations(metrics);
        break;
      case 'conservative':
        await this.applyConservativeOptimizations(metrics);
        break;
      default:
        await this.applyBalancedOptimizations(metrics);
    }
  }

  /**
   * Apply aggressive optimizations for low latency
   */
  private async applyAggressiveOptimizations(metrics: PerformanceMetrics): Promise<void> {
    // Increase cache size and prefetching
    this.cache = new PredictiveCache({
      maxSize: this.config.cache.maxSize * 1.5,
      ttl: this.config.cache.ttl,
      strategy: {
        aggressive: true,
        threshold: 0.5,
        maxPrefetch: 20,
      },
    });
    
    // Increase database connection pool
    // This would need to recreate the query optimizer with new settings
    
    // Enable more aggressive network batching
    // This would need to update network optimizer settings
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Apply conservative optimizations for resource savings
   */
  private async applyConservativeOptimizations(metrics: PerformanceMetrics): Promise<void> {
    // Reduce cache size
    this.cache.clear();
    
    // Reduce prefetching aggressiveness
    // This would need to update cache settings
    
    // Reduce connection pool size
    // This would need to update database settings
    
    // Clear query cache
    // This would need to access query optimizer internals
  }

  /**
   * Apply balanced optimizations
   */
  private async applyBalancedOptimizations(metrics: PerformanceMetrics): Promise<void> {
    // Clear old cache entries
    if (metrics.cache.hitRate < 0.6) {
      this.cache.clear();
    }
    
    // Adjust based on specific issues
    if (metrics.database.slowQueries > 5) {
      // Would trigger query optimization
    }
    
    if (metrics.network.compressionRatio > 0.9) {
      // Would adjust compression settings
    }
  }

  /**
   * Check performance thresholds and emit warnings
   */
  private checkPerformanceThresholds(metrics: PerformanceMetrics): void {
    const warnings: string[] = [];
    
    if (metrics.latency.p95 > this.config.optimization.targetLatency) {
      warnings.push(`High latency detected: ${metrics.latency.p95}ms (target: ${this.config.optimization.targetLatency}ms)`);
    }
    
    if (metrics.cache.hitRate < 0.5) {
      warnings.push(`Low cache hit rate: ${(metrics.cache.hitRate * 100).toFixed(1)}%`);
    }
    
    if (metrics.system.cpuUsage > this.config.optimization.cpuLimit) {
      warnings.push(`High CPU usage: ${(metrics.system.cpuUsage * 100).toFixed(1)}%`);
    }
    
    if (metrics.system.heapUsed > this.config.optimization.memoryLimit) {
      warnings.push(`High memory usage: ${(metrics.system.heapUsed / 1024 / 1024).toFixed(1)}MB`);
    }
    
    if (warnings.length > 0) {
      this.emit('performance-warning', {
        warnings,
        metrics,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle frequent cache evictions
   */
  private handleFrequentEviction(data: any): void {
    // Increase cache size if possible
    const currentMemUsage = process.memoryUsage().heapUsed;
    
    if (currentMemUsage < this.config.optimization.memoryLimit * 0.7) {
      // Have room to increase cache
      this.emit('cache-resize-suggested', {
        currentSize: this.config.cache.maxSize,
        suggestedSize: this.config.cache.maxSize * 1.5,
        reason: 'frequent-evictions',
      });
    }
  }

  /**
   * Handle query optimization suggestions
   */
  private handleQueryOptimizationSuggestion(data: any): void {
    this.emit('query-optimization-needed', data);
    
    // Could automatically create indexes if configured
    if (this.config.optimization.autoTune && data.suggestions?.indexes?.length > 0) {
      // Would need database admin permissions
      this.emit('index-creation-suggested', {
        indexes: data.suggestions.indexes,
        query: data.query,
      });
    }
  }

  // Public API
  
  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics | null {
    return this.metrics[this.metrics.length - 1] || null;
  }
  
  /**
   * Get historical metrics
   */
  getHistoricalMetrics(duration: number = 3600000): PerformanceMetrics[] {
    const since = Date.now() - duration;
    return this.metrics.filter(m => m.timestamp > since);
  }
  
  /**
   * Get optimization state
   */
  getOptimizationState(): any {
    return {
      ...this.optimizationState,
      cacheStats: this.cache.getStatistics(),
      dbStats: this.queryOptimizer.getStatistics(),
      networkStats: this.networkOptimizer.getStatistics(),
    };
  }
  
  /**
   * Manually trigger optimization
   */
  async optimize(): Promise<void> {
    await this.performAutoOptimization();
  }
  
  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.cache.clear();
    // Would also clear query cache
    this.emit('caches-cleared', { timestamp: Date.now() });
  }
  
  /**
   * Shutdown optimization suite
   */
  async shutdown(): Promise<void> {
    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    // Shutdown components
    this.cache.shutdown();
    await this.queryOptimizer.shutdown();
    this.networkOptimizer.shutdown();
    
    // Clear metrics
    this.metrics = [];
    
    this.removeAllListeners();
  }
}

export default PerformanceOptimizationSuite;