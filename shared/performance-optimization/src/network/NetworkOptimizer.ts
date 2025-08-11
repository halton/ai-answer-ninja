import { EventEmitter } from 'events';
import * as zlib from 'zlib';
import { promisify } from 'util';
import * as msgpack from 'msgpackr';
import * as http from 'http';
import * as https from 'https';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

interface NetworkConfig {
  compression: CompressionConfig;
  connectionPool: ConnectionPoolConfig;
  batchConfig: BatchConfig;
  protocolConfig: ProtocolConfig;
}

interface CompressionConfig {
  enabled: boolean;
  algorithm: 'gzip' | 'brotli' | 'zstd';
  level: number;
  threshold: number;
  adaptiveCompression: boolean;
}

interface ConnectionPoolConfig {
  maxSockets: number;
  maxFreeSockets: number;
  timeout: number;
  keepAliveTimeout: number;
  scheduling: 'fifo' | 'lifo';
}

interface BatchConfig {
  enabled: boolean;
  maxBatchSize: number;
  maxWaitTime: number;
  compression: boolean;
}

interface ProtocolConfig {
  preferHttp2: boolean;
  multiplexing: boolean;
  pipelining: boolean;
  tcpNoDelay: boolean;
  keepAlive: boolean;
}

interface RequestMetrics {
  requestId: string;
  startTime: number;
  endTime?: number;
  bytesIn: number;
  bytesOut: number;
  compressionRatio?: number;
  latency?: number;
  protocol: string;
}

export class NetworkOptimizer extends EventEmitter {
  private config: NetworkConfig;
  private agents: Map<string, http.Agent | https.Agent>;
  private batchQueues: Map<string, BatchQueue>;
  private metrics: Map<string, RequestMetrics>;
  private compressionStats: CompressionStats;
  private connectionStats: ConnectionStats;
  
  // Optimization components
  private readonly protocolOptimizer: ProtocolOptimizer;
  private readonly compressionEngine: CompressionEngine;
  private readonly connectionManager: ConnectionManager;
  private readonly batchProcessor: BatchProcessor;
  
  constructor(config?: Partial<NetworkConfig>) {
    super();
    
    this.config = {
      compression: {
        enabled: true,
        algorithm: 'brotli',
        level: 6,
        threshold: 1024, // 1KB
        adaptiveCompression: true,
        ...config?.compression,
      },
      connectionPool: {
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 30000,
        keepAliveTimeout: 60000,
        scheduling: 'lifo',
        ...config?.connectionPool,
      },
      batchConfig: {
        enabled: true,
        maxBatchSize: 100,
        maxWaitTime: 10,
        compression: true,
        ...config?.batchConfig,
      },
      protocolConfig: {
        preferHttp2: true,
        multiplexing: true,
        pipelining: true,
        tcpNoDelay: true,
        keepAlive: true,
        ...config?.protocolConfig,
      },
    };
    
    // Initialize components
    this.agents = new Map();
    this.batchQueues = new Map();
    this.metrics = new Map();
    
    this.compressionStats = new CompressionStats();
    this.connectionStats = new ConnectionStats();
    
    this.protocolOptimizer = new ProtocolOptimizer(this.config.protocolConfig);
    this.compressionEngine = new CompressionEngine(this.config.compression);
    this.connectionManager = new ConnectionManager(this.config.connectionPool);
    this.batchProcessor = new BatchProcessor(this.config.batchConfig);
    
    this.initialize();
  }

  private initialize(): void {
    // Create optimized HTTP agents
    this.createOptimizedAgents();
    
    // Start background optimization
    this.startOptimizationLoop();
    this.startMetricsCollection();
  }

  /**
   * Make optimized HTTP request
   */
  async request<T = any>(options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    timeout?: number;
    batch?: boolean;
    compress?: boolean;
  }): Promise<T> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    
    // Record metrics
    this.metrics.set(requestId, {
      requestId,
      startTime,
      bytesIn: 0,
      bytesOut: 0,
      protocol: 'http/1.1',
    });
    
    try {
      // Batch similar requests
      if (options.batch && this.config.batchConfig.enabled) {
        return await this.batchRequest<T>(options);
      }
      
      // Compress request body if needed
      let body = options.body;
      let headers = { ...options.headers };
      
      if (body && (options.compress !== false)) {
        const compressed = await this.compressData(body);
        if (compressed.compressed) {
          body = compressed.data;
          headers['Content-Encoding'] = compressed.encoding;
          headers['Content-Length'] = String(compressed.size);
        }
      }
      
      // Select optimal protocol and agent
      const agent = this.selectAgent(options.url);
      
      // Make request with optimizations
      const response = await this.executeRequest<T>({
        ...options,
        body,
        headers,
        agent,
      });
      
      // Update metrics
      const metric = this.metrics.get(requestId)!;
      metric.endTime = Date.now();
      metric.latency = metric.endTime - metric.startTime;
      
      this.connectionStats.recordRequest(metric);
      
      return response;
      
    } catch (error) {
      this.recordError(requestId, error);
      throw error;
    }
  }

  /**
   * Batch multiple requests for efficiency
   */
  async batchRequests<T = any>(
    requests: Array<{
      url: string;
      method?: string;
      body?: any;
    }>
  ): Promise<T[]> {
    // Group requests by endpoint
    const grouped = this.groupRequestsByEndpoint(requests);
    
    const promises = Array.from(grouped.entries()).map(async ([endpoint, reqs]) => {
      // Create batch request
      const batchBody = {
        requests: reqs.map(r => ({
          method: r.method || 'GET',
          path: new URL(r.url).pathname,
          body: r.body,
        })),
      };
      
      // Send batch request
      const response = await this.request<any>({
        url: endpoint + '/batch',
        method: 'POST',
        body: batchBody,
        compress: true,
      });
      
      return response.responses;
    });
    
    const results = await Promise.all(promises);
    return results.flat();
  }

  /**
   * Stream data with optimal chunking
   */
  async streamRequest(options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    onData: (chunk: Buffer) => void;
    onEnd?: () => void;
    onError?: (error: Error) => void;
  }): Promise<void> {
    const agent = this.selectAgent(options.url);
    const protocol = options.url.startsWith('https') ? https : http;
    
    return new Promise((resolve, reject) => {
      const req = protocol.request(options.url, {
        method: options.method || 'GET',
        headers: {
          ...options.headers,
          'Accept-Encoding': 'gzip, deflate, br',
        },
        agent,
      });
      
      req.on('response', (res) => {
        // Handle compression
        let stream: NodeJS.ReadableStream = res;
        
        const encoding = res.headers['content-encoding'];
        if (encoding === 'gzip') {
          stream = res.pipe(zlib.createGunzip());
        } else if (encoding === 'br') {
          stream = res.pipe(zlib.createBrotliDecompress());
        } else if (encoding === 'deflate') {
          stream = res.pipe(zlib.createInflate());
        }
        
        // Optimal chunk processing
        const chunkProcessor = new ChunkProcessor();
        
        stream.on('data', (chunk: Buffer) => {
          const optimizedChunk = chunkProcessor.process(chunk);
          options.onData(optimizedChunk);
        });
        
        stream.on('end', () => {
          options.onEnd?.();
          resolve();
        });
        
        stream.on('error', (error) => {
          options.onError?.(error);
          reject(error);
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Create optimized HTTP agents
   */
  private createOptimizedAgents(): void {
    // HTTP agent with connection pooling
    const httpAgent = new http.Agent({
      keepAlive: this.config.protocolConfig.keepAlive,
      keepAliveMsecs: 1000,
      maxSockets: this.config.connectionPool.maxSockets,
      maxFreeSockets: this.config.connectionPool.maxFreeSockets,
      timeout: this.config.connectionPool.timeout,
      scheduling: this.config.connectionPool.scheduling,
    });
    
    // HTTPS agent with additional optimizations
    const httpsAgent = new https.Agent({
      keepAlive: this.config.protocolConfig.keepAlive,
      keepAliveMsecs: 1000,
      maxSockets: this.config.connectionPool.maxSockets,
      maxFreeSockets: this.config.connectionPool.maxFreeSockets,
      timeout: this.config.connectionPool.timeout,
      scheduling: this.config.connectionPool.scheduling,
      // Additional HTTPS optimizations
      secureOptions: 0, // Enable all TLS optimizations
      sessionTimeout: 300, // 5 minutes session cache
    });
    
    // Set TCP optimizations
    if (this.config.protocolConfig.tcpNoDelay) {
      httpAgent.options = { ...httpAgent.options, noDelay: true };
      httpsAgent.options = { ...httpsAgent.options, noDelay: true };
    }
    
    this.agents.set('http', httpAgent);
    this.agents.set('https', httpsAgent);
  }

  /**
   * Compress data with optimal algorithm
   */
  private async compressData(data: any): Promise<{
    compressed: boolean;
    data: Buffer;
    encoding: string;
    size: number;
    ratio: number;
  }> {
    // Serialize if object
    let serialized: Buffer;
    
    if (typeof data === 'object') {
      // Use msgpack for efficient binary serialization
      serialized = msgpack.encode(data);
    } else if (typeof data === 'string') {
      serialized = Buffer.from(data);
    } else {
      serialized = data;
    }
    
    // Check compression threshold
    if (serialized.length < this.config.compression.threshold) {
      return {
        compressed: false,
        data: serialized,
        encoding: 'identity',
        size: serialized.length,
        ratio: 1,
      };
    }
    
    // Select compression algorithm
    let compressed: Buffer;
    let encoding: string;
    
    if (this.config.compression.adaptiveCompression) {
      // Choose best algorithm based on data characteristics
      const result = await this.compressionEngine.adaptiveCompress(serialized);
      compressed = result.data;
      encoding = result.encoding;
    } else {
      // Use configured algorithm
      switch (this.config.compression.algorithm) {
        case 'brotli':
          compressed = await brotliCompress(serialized, {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: this.config.compression.level,
            },
          });
          encoding = 'br';
          break;
        case 'gzip':
          compressed = await gzip(serialized, { level: this.config.compression.level });
          encoding = 'gzip';
          break;
        default:
          compressed = serialized;
          encoding = 'identity';
      }
    }
    
    const ratio = compressed.length / serialized.length;
    
    // Only use compression if it actually reduces size
    if (ratio < 0.9) {
      this.compressionStats.record(serialized.length, compressed.length, encoding);
      
      return {
        compressed: true,
        data: compressed,
        encoding,
        size: compressed.length,
        ratio,
      };
    }
    
    return {
      compressed: false,
      data: serialized,
      encoding: 'identity',
      size: serialized.length,
      ratio: 1,
    };
  }

  /**
   * Execute request with retries and circuit breaking
   */
  private async executeRequest<T>(options: any): Promise<T> {
    const maxRetries = 3;
    let lastError: any;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Add exponential backoff for retries
        if (attempt > 0) {
          await this.sleep(Math.pow(2, attempt) * 100);
        }
        
        const response = await this.performRequest(options);
        
        // Decompress response if needed
        let data = response.data;
        if (response.headers['content-encoding']) {
          data = await this.decompressData(data, response.headers['content-encoding']);
        }
        
        // Deserialize if msgpack
        if (response.headers['content-type']?.includes('msgpack')) {
          data = msgpack.decode(data);
        }
        
        return data;
        
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on client errors
        if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Perform actual HTTP request
   */
  private performRequest(options: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const protocol = options.url.startsWith('https') ? https : http;
      
      const req = protocol.request(options.url, {
        method: options.method || 'GET',
        headers: options.headers,
        agent: options.agent,
        timeout: options.timeout || this.config.connectionPool.timeout,
      });
      
      req.on('response', (res) => {
        const chunks: Buffer[] = [];
        
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          
          if (res.statusCode && res.statusCode >= 400) {
            const error: any = new Error(`HTTP ${res.statusCode}`);
            error.statusCode = res.statusCode;
            error.data = data;
            reject(error);
          } else {
            resolve({
              data,
              headers: res.headers,
              statusCode: res.statusCode,
            });
          }
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  }

  /**
   * Batch request handling
   */
  private async batchRequest<T>(options: any): Promise<T> {
    const batchKey = this.getBatchKey(options.url);
    
    if (!this.batchQueues.has(batchKey)) {
      this.batchQueues.set(batchKey, new BatchQueue(this.config.batchConfig));
    }
    
    const queue = this.batchQueues.get(batchKey)!;
    return await queue.add(options);
  }

  /**
   * Decompress data
   */
  private async decompressData(data: Buffer, encoding: string): Promise<Buffer> {
    switch (encoding) {
      case 'gzip':
        return await gunzip(data);
      case 'br':
        return await brotliDecompress(data);
      case 'deflate':
        return await promisify(zlib.inflate)(data);
      default:
        return data;
    }
  }

  /**
   * Select optimal agent for request
   */
  private selectAgent(url: string): http.Agent | https.Agent {
    const protocol = url.startsWith('https') ? 'https' : 'http';
    return this.agents.get(protocol)!;
  }

  /**
   * Group requests by endpoint
   */
  private groupRequestsByEndpoint(requests: any[]): Map<string, any[]> {
    const grouped = new Map<string, any[]>();
    
    for (const req of requests) {
      const url = new URL(req.url);
      const endpoint = `${url.protocol}//${url.host}`;
      
      if (!grouped.has(endpoint)) {
        grouped.set(endpoint, []);
      }
      
      grouped.get(endpoint)!.push(req);
    }
    
    return grouped;
  }

  /**
   * Start optimization background tasks
   */
  private startOptimizationLoop(): void {
    setInterval(() => {
      this.optimizeConnectionPool();
      this.analyzeCompressionEfficiency();
      this.adjustBatchingStrategy();
    }, 30000); // Every 30 seconds
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    setInterval(() => {
      this.collectMetrics();
      this.cleanupOldMetrics();
    }, 10000); // Every 10 seconds
  }

  /**
   * Optimize connection pool based on usage
   */
  private optimizeConnectionPool(): void {
    const stats = this.connectionStats.getStatistics();
    
    // Adjust pool size based on usage
    if (stats.avgActiveConnections > this.config.connectionPool.maxSockets * 0.8) {
      // Increase pool size if under pressure
      this.config.connectionPool.maxSockets = Math.min(
        this.config.connectionPool.maxSockets * 1.5,
        200
      );
      
      this.createOptimizedAgents();
      
      this.emit('pool-resized', {
        newSize: this.config.connectionPool.maxSockets,
        reason: 'high-usage',
      });
    }
  }

  /**
   * Analyze compression efficiency
   */
  private analyzeCompressionEfficiency(): void {
    const stats = this.compressionStats.getStatistics();
    
    if (stats.avgRatio > 0.9) {
      // Compression not effective, adjust threshold
      this.config.compression.threshold *= 2;
      
      this.emit('compression-adjusted', {
        newThreshold: this.config.compression.threshold,
        reason: 'poor-ratio',
      });
    }
  }

  /**
   * Adjust batching strategy
   */
  private adjustBatchingStrategy(): void {
    const batchStats = this.batchProcessor.getStatistics();
    
    if (batchStats.avgWaitTime > this.config.batchConfig.maxWaitTime * 0.8) {
      // Reduce batch size to decrease wait time
      this.config.batchConfig.maxBatchSize = Math.max(
        Math.floor(this.config.batchConfig.maxBatchSize * 0.8),
        10
      );
    }
  }

  /**
   * Collect performance metrics
   */
  private collectMetrics(): void {
    const metrics = {
      activeRequests: this.metrics.size,
      connectionPoolSize: this.config.connectionPool.maxSockets,
      compressionRatio: this.compressionStats.getStatistics().avgRatio,
      avgLatency: this.connectionStats.getStatistics().avgLatency,
    };
    
    this.emit('metrics', metrics);
  }

  /**
   * Clean up old metrics
   */
  private cleanupOldMetrics(): void {
    const now = Date.now();
    const maxAge = 60000; // 1 minute
    
    for (const [id, metric] of this.metrics) {
      if (now - metric.startTime > maxAge) {
        this.metrics.delete(id);
      }
    }
  }

  // Helper methods
  
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private getBatchKey(url: string): string {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  }
  
  private recordError(requestId: string, error: any): void {
    this.emit('request-error', {
      requestId,
      error: error.message,
      timestamp: Date.now(),
    });
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Public API
  
  getStatistics(): any {
    return {
      compression: this.compressionStats.getStatistics(),
      connections: this.connectionStats.getStatistics(),
      batching: this.batchProcessor.getStatistics(),
      activeRequests: this.metrics.size,
    };
  }
  
  shutdown(): void {
    // Close all agents
    for (const agent of this.agents.values()) {
      agent.destroy();
    }
    
    this.agents.clear();
    this.batchQueues.clear();
    this.metrics.clear();
    
    this.removeAllListeners();
  }
}

// Supporting classes

class CompressionEngine {
  private config: CompressionConfig;
  private stats: Map<string, number> = new Map();
  
  constructor(config: CompressionConfig) {
    this.config = config;
  }
  
  async adaptiveCompress(data: Buffer): Promise<{
    data: Buffer;
    encoding: string;
  }> {
    // Try multiple algorithms and choose best
    const results = await Promise.all([
      this.tryCompress(data, 'gzip'),
      this.tryCompress(data, 'brotli'),
    ]);
    
    // Select best compression
    const best = results.reduce((prev, curr) => 
      curr.size < prev.size ? curr : prev
    );
    
    return best;
  }
  
  private async tryCompress(data: Buffer, algorithm: string): Promise<any> {
    let compressed: Buffer;
    
    switch (algorithm) {
      case 'gzip':
        compressed = await gzip(data, { level: this.config.level });
        return { data: compressed, encoding: 'gzip', size: compressed.length };
      case 'brotli':
        compressed = await brotliCompress(data, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: this.config.level,
          },
        });
        return { data: compressed, encoding: 'br', size: compressed.length };
      default:
        return { data, encoding: 'identity', size: data.length };
    }
  }
}

class ConnectionManager {
  private config: ConnectionPoolConfig;
  private connections: Map<string, any> = new Map();
  
  constructor(config: ConnectionPoolConfig) {
    this.config = config;
  }
  
  getConnection(key: string): any {
    return this.connections.get(key);
  }
  
  releaseConnection(key: string): void {
    // Connection pooling logic
  }
}

class BatchProcessor {
  private config: BatchConfig;
  private stats = {
    totalBatches: 0,
    totalRequests: 0,
    avgBatchSize: 0,
    avgWaitTime: 0,
  };
  
  constructor(config: BatchConfig) {
    this.config = config;
  }
  
  getStatistics(): any {
    return { ...this.stats };
  }
}

class BatchQueue {
  private queue: any[] = [];
  private config: BatchConfig;
  private timer: NodeJS.Timeout | null = null;
  
  constructor(config: BatchConfig) {
    this.config = config;
  }
  
  async add(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      
      if (this.queue.length >= this.config.maxBatchSize) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.config.maxWaitTime);
      }
    });
  }
  
  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    const batch = this.queue.splice(0, this.config.maxBatchSize);
    
    // Process batch
    // ...
  }
}

class ChunkProcessor {
  private buffer: Buffer = Buffer.alloc(0);
  
  process(chunk: Buffer): Buffer {
    // Optimize chunk processing
    return chunk;
  }
}

class CompressionStats {
  private totalOriginal = 0;
  private totalCompressed = 0;
  private count = 0;
  
  record(original: number, compressed: number, encoding: string): void {
    this.totalOriginal += original;
    this.totalCompressed += compressed;
    this.count++;
  }
  
  getStatistics(): any {
    return {
      avgRatio: this.count > 0 ? this.totalCompressed / this.totalOriginal : 1,
      totalSaved: this.totalOriginal - this.totalCompressed,
      count: this.count,
    };
  }
}

class ConnectionStats {
  private requests: RequestMetrics[] = [];
  private activeConnections = 0;
  
  recordRequest(metric: RequestMetrics): void {
    this.requests.push(metric);
    
    // Keep only recent requests
    if (this.requests.length > 1000) {
      this.requests.shift();
    }
  }
  
  getStatistics(): any {
    const latencies = this.requests
      .filter(r => r.latency)
      .map(r => r.latency!);
    
    return {
      avgLatency: latencies.length > 0 
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
        : 0,
      avgActiveConnections: this.activeConnections,
      totalRequests: this.requests.length,
    };
  }
}

class ProtocolOptimizer {
  private config: ProtocolConfig;
  
  constructor(config: ProtocolConfig) {
    this.config = config;
  }
  
  selectProtocol(url: string): string {
    // Protocol selection logic
    return this.config.preferHttp2 ? 'http2' : 'http';
  }
}

export default NetworkOptimizer;