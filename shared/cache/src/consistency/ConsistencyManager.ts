/**
 * 分布式缓存一致性管理器 - 保证多节点间缓存数据的一致性
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { CacheKey, ConsistencyPolicy, CacheValue, CacheEvent } from '../types';
import { RedisClusterManager } from '../redis/RedisClusterManager';
import { Logger } from '../utils/Logger';

interface ConsistencyConfig {
  policy: ConsistencyPolicy;
  syncBatchSize: number;
  syncInterval: number;
  conflictRetryAttempts: number;
  enableVersioning: boolean;
  enableEventualConsistency: boolean;
}

interface VersionedCacheValue<T = any> extends CacheValue<T> {
  version: number;
  vectorClock?: VectorClock;
  lastModified: number;
  nodeId: string;
}

interface VectorClock {
  [nodeId: string]: number;
}

interface SyncOperation {
  id: string;
  type: 'set' | 'delete' | 'clear';
  key: CacheKey;
  value?: any;
  version: number;
  timestamp: number;
  sourceNode: string;
  targetNodes: string[];
  status: 'pending' | 'success' | 'failed' | 'conflict';
  retryCount: number;
}

interface ConflictResolution {
  strategy: 'last-write-wins' | 'version-based' | 'vector-clock';
  resolver: (local: VersionedCacheValue, remote: VersionedCacheValue) => VersionedCacheValue;
}

/**
 * 分布式缓存一致性管理器
 */
export class ConsistencyManager extends EventEmitter {
  private config: ConsistencyConfig;
  private logger: Logger;
  private redisManager: RedisClusterManager;
  private nodeId: string;
  private vectorClock: VectorClock = {};
  
  // 同步队列和状态
  private syncQueue: Map<string, SyncOperation> = new Map();
  private pendingOperations: Map<string, SyncOperation> = new Map();
  private conflictResolver: ConflictResolution;
  
  // 监听和通知
  private syncInterval?: NodeJS.Timeout;
  private isRunning = false;
  
  // 统计信息
  private stats = {
    syncOperations: 0,
    conflictsDetected: 0,
    conflictsResolved: 0,
    syncFailures: 0,
    lastSyncTime: 0
  };

  constructor(
    redisManager: RedisClusterManager,
    config: ConsistencyConfig,
    nodeId?: string
  ) {
    super();
    this.redisManager = redisManager;
    this.config = config;
    this.nodeId = nodeId || this.generateNodeId();
    this.logger = new Logger(`ConsistencyManager-${this.nodeId}`);
    
    this.initializeVectorClock();
    this.setupConflictResolver();
  }

  /**
   * 启动一致性管理器
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      this.logger.info('Starting consistency manager...');
      
      // 启动同步任务
      this.startSyncProcess();
      
      // 启动事件监听
      this.setupEventListeners();
      
      // 注册节点
      await this.registerNode();
      
      this.isRunning = true;
      this.logger.info('Consistency manager started');
      this.emit('started');
      
    } catch (error) {
      this.logger.error('Failed to start consistency manager:', error);
      throw error;
    }
  }

  /**
   * 停止一致性管理器
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      this.logger.info('Stopping consistency manager...');
      
      // 停止同步任务
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
      }
      
      // 完成待处理的同步操作
      await this.flushPendingOperations();
      
      // 注销节点
      await this.unregisterNode();
      
      this.isRunning = false;
      this.logger.info('Consistency manager stopped');
      this.emit('stopped');
      
    } catch (error) {
      this.logger.error('Error stopping consistency manager:', error);
      throw error;
    }
  }

  /**
   * 同步设置操作到其他节点
   */
  async syncSet<T>(key: CacheKey, value: T, ttl?: number): Promise<boolean> {
    try {
      const versionedValue = this.createVersionedValue(value, ttl);
      const operation: SyncOperation = {
        id: this.generateOperationId(),
        type: 'set',
        key,
        value: versionedValue,
        version: versionedValue.version,
        timestamp: Date.now(),
        sourceNode: this.nodeId,
        targetNodes: await this.getActiveNodes(),
        status: 'pending',
        retryCount: 0
      };

      return await this.executeSync(operation);
    } catch (error) {
      this.logger.error(`Sync set failed for key ${this.serializeKey(key)}:`, error);
      return false;
    }
  }

  /**
   * 同步删除操作到其他节点
   */
  async syncDelete(key: CacheKey): Promise<boolean> {
    try {
      const operation: SyncOperation = {
        id: this.generateOperationId(),
        type: 'delete',
        key,
        version: this.incrementVectorClock(),
        timestamp: Date.now(),
        sourceNode: this.nodeId,
        targetNodes: await this.getActiveNodes(),
        status: 'pending',
        retryCount: 0
      };

      return await this.executeSync(operation);
    } catch (error) {
      this.logger.error(`Sync delete failed for key ${this.serializeKey(key)}:`, error);
      return false;
    }
  }

  /**
   * 处理来自其他节点的同步操作
   */
  async handleRemoteSync(operation: SyncOperation): Promise<boolean> {
    try {
      this.logger.debug(`Handling remote sync: ${operation.type} from ${operation.sourceNode}`);
      
      switch (operation.type) {
        case 'set':
          return await this.handleRemoteSet(operation);
        case 'delete':
          return await this.handleRemoteDelete(operation);
        case 'clear':
          return await this.handleRemoteClear(operation);
        default:
          this.logger.warn(`Unknown sync operation type: ${operation.type}`);
          return false;
      }
    } catch (error) {
      this.logger.error('Failed to handle remote sync:', error);
      return false;
    }
  }

  /**
   * 检测并解决冲突
   */
  async detectAndResolveConflicts(key: CacheKey): Promise<boolean> {
    try {
      const keyStr = this.serializeKey(key);
      
      // 获取本地值
      const localValue = await this.getLocalVersionedValue(key);
      if (!localValue) return true; // 本地没有值，无冲突
      
      // 获取其他节点的值
      const remoteValues = await this.getRemoteValues(key);
      
      // 检测冲突
      const conflicts = this.detectConflicts(localValue, remoteValues);
      
      if (conflicts.length === 0) return true; // 无冲突
      
      this.stats.conflictsDetected++;
      this.logger.info(`Detected ${conflicts.length} conflicts for key: ${keyStr}`);
      
      // 解决冲突
      for (const remoteValue of conflicts) {
        const resolvedValue = await this.resolveConflict(localValue, remoteValue);
        
        if (resolvedValue !== localValue) {
          // 应用解决方案
          await this.applyResolvedValue(key, resolvedValue);
          this.stats.conflictsResolved++;
        }
      }
      
      return true;
    } catch (error) {
      this.logger.error(`Conflict resolution failed for key ${this.serializeKey(key)}:`, error);
      return false;
    }
  }

  /**
   * 获取一致性状态
   */
  async getConsistencyStatus(): Promise<{
    isConsistent: boolean;
    inconsistentKeys: string[];
    lastSyncTime: number;
    pendingOperations: number;
    stats: typeof this.stats;
  }> {
    const inconsistentKeys = await this.findInconsistentKeys();
    
    return {
      isConsistent: inconsistentKeys.length === 0,
      inconsistentKeys,
      lastSyncTime: this.stats.lastSyncTime,
      pendingOperations: this.pendingOperations.size,
      stats: { ...this.stats }
    };
  }

  /**
   * 强制全量同步
   */
  async forceFullSync(): Promise<void> {
    try {
      this.logger.info('Starting full sync...');
      
      const allKeys = await this.getAllCacheKeys();
      
      for (const key of allKeys) {
        await this.detectAndResolveConflicts(key);
      }
      
      this.logger.info('Full sync completed');
      this.emit('fullSyncCompleted', { keyCount: allKeys.length });
      
    } catch (error) {
      this.logger.error('Full sync failed:', error);
      throw error;
    }
  }

  // Private methods

  private initializeVectorClock(): void {
    this.vectorClock[this.nodeId] = 0;
  }

  private setupConflictResolver(): void {
    const strategy = this.config.policy.conflictResolution;
    
    this.conflictResolver = {
      strategy,
      resolver: this.createConflictResolver(strategy)
    };
  }

  private createConflictResolver(strategy: string): ConflictResolution['resolver'] {
    switch (strategy) {
      case 'last-write-wins':
        return (local, remote) => {
          return local.lastModified > remote.lastModified ? local : remote;
        };
      
      case 'version':
        return (local, remote) => {
          return local.version > remote.version ? local : remote;
        };
      
      case 'timestamp':
        return (local, remote) => {
          return local.metadata.createdAt > remote.metadata.createdAt ? local : remote;
        };
      
      default:
        return (local, remote) => {
          // 默认使用时间戳
          return local.lastModified > remote.lastModified ? local : remote;
        };
    }
  }

  private startSyncProcess(): void {
    this.syncInterval = setInterval(async () => {
      try {
        await this.processSyncQueue();
        await this.performPeriodicSync();
      } catch (error) {
        this.logger.error('Sync process failed:', error);
      }
    }, this.config.syncInterval);
  }

  private setupEventListeners(): void {
    // 监听Redis发布/订阅消息
    this.redisManager.on('message', (channel: string, message: string) => {
      if (channel === `cache:sync:${this.nodeId}`) {
        this.handleSyncMessage(JSON.parse(message));
      }
    });

    // 监听缓存操作事件
    this.on('cacheOperation', (event: CacheEvent) => {
      this.enqueueSyncOperation(event);
    });
  }

  private async executeSync(operation: SyncOperation): Promise<boolean> {
    try {
      // 添加到同步队列
      this.syncQueue.set(operation.id, operation);
      this.pendingOperations.set(operation.id, operation);
      
      // 立即尝试同步（根据策略）
      if (this.config.policy.type === 'strong') {
        return await this.executeSyncImmediate(operation);
      } else {
        // 异步同步
        setImmediate(() => this.processSyncOperation(operation));
        return true;
      }
    } catch (error) {
      this.logger.error('Execute sync failed:', error);
      return false;
    }
  }

  private async executeSyncImmediate(operation: SyncOperation): Promise<boolean> {
    const startTime = performance.now();
    let successCount = 0;
    
    try {
      // 并行发送到所有目标节点
      const syncPromises = operation.targetNodes.map(nodeId => 
        this.sendSyncMessage(nodeId, operation)
      );
      
      const results = await Promise.allSettled(syncPromises);
      successCount = results.filter(r => r.status === 'fulfilled').length;
      
      const duration = performance.now() - startTime;
      
      if (successCount === operation.targetNodes.length) {
        operation.status = 'success';
        this.stats.syncOperations++;
      } else {
        operation.status = 'failed';
        this.stats.syncFailures++;
        
        // 强一致性要求所有节点成功
        if (this.config.policy.type === 'strong') {
          throw new Error(`Strong consistency violated: ${successCount}/${operation.targetNodes.length} nodes synced`);
        }
      }
      
      // 从待处理队列移除
      this.pendingOperations.delete(operation.id);
      
      this.emit('syncCompleted', {
        operation,
        successCount,
        totalNodes: operation.targetNodes.length,
        duration
      });
      
      return successCount > 0;
      
    } catch (error) {
      this.logger.error('Immediate sync execution failed:', error);
      operation.status = 'failed';
      this.stats.syncFailures++;
      return false;
    }
  }

  private async processSyncQueue(): Promise<void> {
    const batchSize = this.config.syncBatchSize;
    const operations = Array.from(this.syncQueue.values())
      .filter(op => op.status === 'pending')
      .slice(0, batchSize);

    if (operations.length === 0) return;

    this.logger.debug(`Processing ${operations.length} sync operations`);

    for (const operation of operations) {
      try {
        await this.processSyncOperation(operation);
      } catch (error) {
        this.logger.error(`Failed to process sync operation ${operation.id}:`, error);
      }
    }
  }

  private async processSyncOperation(operation: SyncOperation): Promise<void> {
    try {
      if (operation.retryCount >= this.config.conflictRetryAttempts) {
        operation.status = 'failed';
        this.syncQueue.delete(operation.id);
        return;
      }

      const success = await this.executeSyncImmediate(operation);
      
      if (!success) {
        operation.retryCount++;
        // 指数退避重试
        const delay = Math.min(1000 * Math.pow(2, operation.retryCount), 30000);
        setTimeout(() => this.processSyncOperation(operation), delay);
      } else {
        this.syncQueue.delete(operation.id);
      }
    } catch (error) {
      this.logger.error('Process sync operation failed:', error);
      operation.status = 'failed';
    }
  }

  private async performPeriodicSync(): Promise<void> {
    if (!this.config.enableEventualConsistency) return;

    try {
      // 随机选择一些key进行一致性检查
      const allKeys = await this.getAllCacheKeys();
      const sampleSize = Math.min(allKeys.length, 10);
      const sampleKeys = this.shuffleArray(allKeys).slice(0, sampleSize);

      for (const key of sampleKeys) {
        await this.detectAndResolveConflicts(key);
      }

      this.stats.lastSyncTime = Date.now();
    } catch (error) {
      this.logger.error('Periodic sync failed:', error);
    }
  }

  private async handleRemoteSet(operation: SyncOperation): Promise<boolean> {
    try {
      const keyStr = this.serializeKey(operation.key);
      const localValue = await this.getLocalVersionedValue(operation.key);
      
      if (localValue) {
        // 检查冲突
        const remoteValue = operation.value as VersionedCacheValue;
        if (this.hasConflict(localValue, remoteValue)) {
          // 解决冲突
          const resolvedValue = await this.resolveConflict(localValue, remoteValue);
          await this.applyResolvedValue(operation.key, resolvedValue);
          return true;
        }
      }
      
      // 应用远程更新
      await this.setLocalVersionedValue(operation.key, operation.value);
      this.updateVectorClock(operation.sourceNode, operation.version);
      
      this.logger.debug(`Applied remote set: ${keyStr}`);
      return true;
    } catch (error) {
      this.logger.error('Handle remote set failed:', error);
      return false;
    }
  }

  private async handleRemoteDelete(operation: SyncOperation): Promise<boolean> {
    try {
      const keyStr = this.serializeKey(operation.key);
      await this.deleteLocalValue(operation.key);
      this.updateVectorClock(operation.sourceNode, operation.version);
      
      this.logger.debug(`Applied remote delete: ${keyStr}`);
      return true;
    } catch (error) {
      this.logger.error('Handle remote delete failed:', error);
      return false;
    }
  }

  private async handleRemoteClear(operation: SyncOperation): Promise<boolean> {
    try {
      await this.clearLocalCache();
      this.updateVectorClock(operation.sourceNode, operation.version);
      
      this.logger.debug('Applied remote clear');
      return true;
    } catch (error) {
      this.logger.error('Handle remote clear failed:', error);
      return false;
    }
  }

  private createVersionedValue<T>(value: T, ttl?: number): VersionedCacheValue<T> {
    const now = Date.now();
    
    return {
      data: value,
      metadata: {
        createdAt: now,
        expiresAt: ttl ? now + ttl * 1000 : now + 3600000,
        accessCount: 0,
        lastAccessed: now,
        version: '1.0.0',
        compressed: false,
        size: JSON.stringify(value).length
      },
      version: this.incrementVectorClock(),
      vectorClock: { ...this.vectorClock },
      lastModified: now,
      nodeId: this.nodeId
    };
  }

  private incrementVectorClock(): number {
    this.vectorClock[this.nodeId]++;
    return this.vectorClock[this.nodeId];
  }

  private updateVectorClock(nodeId: string, version: number): void {
    if (!this.vectorClock[nodeId] || this.vectorClock[nodeId] < version) {
      this.vectorClock[nodeId] = version;
    }
  }

  private detectConflicts(
    localValue: VersionedCacheValue,
    remoteValues: VersionedCacheValue[]
  ): VersionedCacheValue[] {
    return remoteValues.filter(remoteValue => 
      this.hasConflict(localValue, remoteValue)
    );
  }

  private hasConflict(local: VersionedCacheValue, remote: VersionedCacheValue): boolean {
    // 基于向量时钟或版本号检测冲突
    if (this.config.enableVersioning) {
      return this.compareVectorClocks(local.vectorClock, remote.vectorClock) === 'concurrent';
    }
    
    // 简单的版本冲突检测
    return local.version !== remote.version && 
           Math.abs(local.lastModified - remote.lastModified) < 1000; // 1秒内的并发修改
  }

  private compareVectorClocks(clock1?: VectorClock, clock2?: VectorClock): 'before' | 'after' | 'concurrent' | 'equal' {
    if (!clock1 || !clock2) return 'concurrent';
    
    const allNodes = new Set([...Object.keys(clock1), ...Object.keys(clock2)]);
    let clock1Greater = false;
    let clock2Greater = false;
    
    for (const node of allNodes) {
      const v1 = clock1[node] || 0;
      const v2 = clock2[node] || 0;
      
      if (v1 > v2) clock1Greater = true;
      if (v2 > v1) clock2Greater = true;
    }
    
    if (clock1Greater && clock2Greater) return 'concurrent';
    if (clock1Greater) return 'after';
    if (clock2Greater) return 'before';
    return 'equal';
  }

  private async resolveConflict(
    local: VersionedCacheValue,
    remote: VersionedCacheValue
  ): Promise<VersionedCacheValue> {
    const resolved = this.conflictResolver.resolver(local, remote);
    
    this.logger.info(`Conflict resolved using ${this.conflictResolver.strategy} strategy`);
    this.emit('conflictResolved', { local, remote, resolved });
    
    return resolved;
  }

  // 辅助方法
  private generateNodeId(): string {
    return `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private serializeKey(key: CacheKey): string {
    return `${key.namespace}:${key.key}${key.version ? `:v${key.version}` : ''}`;
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // 这些方法需要根据实际的缓存实现来完成
  private async getLocalVersionedValue(key: CacheKey): Promise<VersionedCacheValue | null> {
    // 从本地缓存获取版本化值的实现
    return null;
  }

  private async setLocalVersionedValue(key: CacheKey, value: any): Promise<void> {
    // 设置本地版本化值的实现
  }

  private async deleteLocalValue(key: CacheKey): Promise<void> {
    // 删除本地值的实现
  }

  private async clearLocalCache(): Promise<void> {
    // 清空本地缓存的实现
  }

  private async getRemoteValues(key: CacheKey): Promise<VersionedCacheValue[]> {
    // 获取其他节点值的实现
    return [];
  }

  private async getActiveNodes(): Promise<string[]> {
    // 获取活跃节点列表的实现
    return [];
  }

  private async getAllCacheKeys(): Promise<CacheKey[]> {
    // 获取所有缓存键的实现
    return [];
  }

  private async findInconsistentKeys(): Promise<string[]> {
    // 查找不一致键的实现
    return [];
  }

  private async registerNode(): Promise<void> {
    // 节点注册实现
  }

  private async unregisterNode(): Promise<void> {
    // 节点注销实现
  }

  private async sendSyncMessage(nodeId: string, operation: SyncOperation): Promise<void> {
    // 发送同步消息的实现
  }

  private async handleSyncMessage(message: any): Promise<void> {
    // 处理同步消息的实现
  }

  private enqueueSyncOperation(event: CacheEvent): void {
    // 队列同步操作的实现
  }

  private async flushPendingOperations(): Promise<void> {
    // 刷新待处理操作的实现
  }

  private async applyResolvedValue(key: CacheKey, value: VersionedCacheValue): Promise<void> {
    // 应用解决的值的实现
  }
}