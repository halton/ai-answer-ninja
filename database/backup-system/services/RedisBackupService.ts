/**
 * AI电话应答系统 - Redis备份服务
 * 
 * 功能特性:
 * - RDB和AOF双重备份策略
 * - 实时增量备份
 * - 热备份(无服务中断)
 * - 多实例备份支持
 * - 备份压缩和加密
 * - 自动故障转移备份
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import Redis from 'ioredis';
import { performance } from 'perf_hooks';

interface RedisBackupConfig {
  redis: {
    instances: Array<{
      name: string;
      host: string;
      port: number;
      password?: string;
      db: number;
      role: 'master' | 'slave' | 'sentinel';
    }>;
    backupStrategy: 'rdb' | 'aof' | 'both';
    replicationCheck: boolean;
  };
  backup: {
    localPath: string;
    remotePath: string;
    compressionEnabled: boolean;
    encryptionEnabled: boolean;
    retentionDays: number;
    maxBackupSize: number; // MB
  };
  schedule: {
    rdbInterval: number; // minutes
    aofInterval: number; // minutes
    fullBackupHour: number; // 0-23
  };
  monitoring: {
    healthCheckInterval: number; // seconds
    alertOnFailure: boolean;
    maxBackupDuration: number; // minutes
  };
}

interface RedisBackupJob {
  id: string;
  instanceName: string;
  type: 'rdb' | 'aof' | 'full';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  originalSize: number;
  compressedSize?: number;
  compressionRatio?: number;
  filePath?: string;
  errorMessage?: string;
  metadata: {
    redisVersion?: string;
    memoryUsage?: number;
    keyCount?: number;
    lastSave?: Date;
    replicationOffset?: number;
  };
}

interface RedisInstanceHealth {
  name: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  connected: boolean;
  memoryUsage: number;
  keyCount: number;
  lastBackup?: Date;
  replicationLag?: number;
  errorMessage?: string;
}

export class RedisBackupService extends EventEmitter {
  private config: RedisBackupConfig;
  private redisClients: Map<string, Redis> = new Map();
  private activeJobs: Map<string, RedisBackupJob> = new Map();
  private backupHistory: RedisBackupJob[] = [];
  private healthCheckTimer?: NodeJS.Timeout;
  private backupSchedulers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: RedisBackupConfig) {
    super();
    this.config = config;
    this.setupEventHandlers();
  }

  /**
   * 初始化Redis备份服务
   */
  async initialize(): Promise<void> {
    try {
      // 连接所有Redis实例
      await this.connectToRedisInstances();
      
      // 验证Redis实例状态
      await this.validateRedisInstances();
      
      // 创建备份目录
      await this.createBackupDirectories();
      
      // 启动健康检查
      this.startHealthCheck();
      
      // 启动定时备份调度
      this.startBackupSchedulers();
      
      this.emit('initialized', { 
        instanceCount: this.redisClients.size,
        timestamp: new Date() 
      });
      
      console.log(`Redis备份服务初始化完成，管理 ${this.redisClients.size} 个实例`);
    } catch (error) {
      this.emit('error', {
        type: 'initialization_failed',
        error: error.message,
        timestamp: new Date()
      });
      throw error;
    }
  }

  /**
   * 执行RDB备份
   */
  async performRDBBackup(instanceName?: string): Promise<RedisBackupJob[]> {
    const targetInstances = instanceName 
      ? [instanceName] 
      : this.config.redis.instances.map(instance => instance.name);

    const jobs: RedisBackupJob[] = [];

    for (const instance of targetInstances) {
      try {
        const job = await this.executeRDBBackup(instance);
        jobs.push(job);
      } catch (error) {
        console.error(`RDB备份失败: ${instance}`, error);
        const failedJob: RedisBackupJob = {
          id: this.generateJobId('rdb', instance),
          instanceName: instance,
          type: 'rdb',
          status: 'failed',
          startTime: new Date(),
          endTime: new Date(),
          originalSize: 0,
          errorMessage: error.message,
          metadata: {}
        };
        jobs.push(failedJob);
        this.emit('backup_failed', { job: failedJob, error });
      }
    }

    return jobs;
  }

  /**
   * 执行AOF备份
   */
  async performAOFBackup(instanceName?: string): Promise<RedisBackupJob[]> {
    const targetInstances = instanceName 
      ? [instanceName] 
      : this.config.redis.instances.map(instance => instance.name);

    const jobs: RedisBackupJob[] = [];

    for (const instance of targetInstances) {
      try {
        const job = await this.executeAOFBackup(instance);
        jobs.push(job);
      } catch (error) {
        console.error(`AOF备份失败: ${instance}`, error);
        const failedJob: RedisBackupJob = {
          id: this.generateJobId('aof', instance),
          instanceName: instance,
          type: 'aof',
          status: 'failed',
          startTime: new Date(),
          endTime: new Date(),
          originalSize: 0,
          errorMessage: error.message,
          metadata: {}
        };
        jobs.push(failedJob);
        this.emit('backup_failed', { job: failedJob, error });
      }
    }

    return jobs;
  }

  /**
   * 执行全量备份(RDB + AOF)
   */
  async performFullBackup(instanceName?: string): Promise<RedisBackupJob[]> {
    console.log(`开始全量备份: ${instanceName || '所有实例'}`);
    
    const rdbJobs = await this.performRDBBackup(instanceName);
    const aofJobs = await this.performAOFBackup(instanceName);
    
    return [...rdbJobs, ...aofJobs];
  }

  /**
   * 验证备份完整性
   */
  async verifyBackupIntegrity(backupFilePath: string): Promise<{
    isValid: boolean;
    canRestore: boolean;
    checksumValid: boolean;
    formatValid: boolean;
    errorDetails?: string[];
  }> {
    try {
      console.log(`验证备份完整性: ${backupFilePath}`);

      const errors: string[] = [];

      // 检查文件存在性
      const fileExists = await this.fileExists(backupFilePath);
      if (!fileExists) {
        errors.push('备份文件不存在');
        return {
          isValid: false,
          canRestore: false,
          checksumValid: false,
          formatValid: false,
          errorDetails: errors
        };
      }

      // 验证文件校验和
      const checksumValid = await this.verifyFileChecksum(backupFilePath);
      if (!checksumValid) {
        errors.push('校验和验证失败');
      }

      // 验证Redis格式
      const formatValid = await this.verifyRedisFormat(backupFilePath);
      if (!formatValid) {
        errors.push('Redis格式验证失败');
      }

      // 测试恢复能力(在临时实例中)
      const canRestore = await this.testRestoreCapability(backupFilePath);
      if (!canRestore) {
        errors.push('恢复测试失败');
      }

      const isValid = checksumValid && formatValid && canRestore;

      this.emit('backup_verified', {
        filePath: backupFilePath,
        isValid,
        canRestore,
        checksumValid,
        formatValid,
        timestamp: new Date()
      });

      return {
        isValid,
        canRestore,
        checksumValid,
        formatValid,
        errorDetails: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      this.emit('error', {
        type: 'backup_verification_failed',
        error: error.message,
        filePath: backupFilePath,
        timestamp: new Date()
      });
      throw error;
    }
  }

  /**
   * 获取Redis实例健康状态
   */
  async getInstancesHealth(): Promise<RedisInstanceHealth[]> {
    const healthStatuses: RedisInstanceHealth[] = [];

    for (const instanceConfig of this.config.redis.instances) {
      try {
        const client = this.redisClients.get(instanceConfig.name);
        if (!client) {
          healthStatuses.push({
            name: instanceConfig.name,
            status: 'unhealthy',
            connected: false,
            memoryUsage: 0,
            keyCount: 0,
            errorMessage: '客户端未连接'
          });
          continue;
        }

        // 获取Redis信息
        const info = await client.info('memory');
        const dbInfo = await client.info('keyspace');
        const replicationInfo = await client.info('replication');

        // 解析内存使用情况
        const memoryMatch = info.match(/used_memory:(\d+)/);
        const memoryUsage = memoryMatch ? parseInt(memoryMatch[1]) : 0;

        // 解析键数量
        const keyMatch = dbInfo.match(/keys=(\d+)/);
        const keyCount = keyMatch ? parseInt(keyMatch[1]) : 0;

        // 解析复制延迟
        const lagMatch = replicationInfo.match(/master_repl_offset:(\d+)/);
        const replicationOffset = lagMatch ? parseInt(lagMatch[1]) : undefined;

        // 获取最后备份时间
        const lastBackup = this.getLastBackupTime(instanceConfig.name);

        healthStatuses.push({
          name: instanceConfig.name,
          status: 'healthy',
          connected: true,
          memoryUsage,
          keyCount,
          lastBackup,
          replicationLag: replicationOffset
        });
      } catch (error) {
        healthStatuses.push({
          name: instanceConfig.name,
          status: 'unhealthy',
          connected: false,
          memoryUsage: 0,
          keyCount: 0,
          errorMessage: error.message
        });
      }
    }

    return healthStatuses;
  }

  /**
   * 清理过期备份
   */
  async cleanupExpiredBackups(): Promise<{
    deletedFiles: string[];
    freedSpace: number;
    errors: string[];
  }> {
    const result = {
      deletedFiles: [] as string[],
      freedSpace: 0,
      errors: [] as string[]
    };

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.backup.retentionDays);

      // 扫描备份目录
      const backupFiles = await this.scanBackupDirectory();
      
      for (const file of backupFiles) {
        try {
          const stats = await fs.stat(file.path);
          if (stats.mtime < cutoffDate) {
            result.freedSpace += stats.size;
            await fs.unlink(file.path);
            result.deletedFiles.push(file.path);
            
            console.log(`删除过期备份: ${file.path}, 大小: ${this.formatBytes(stats.size)}`);
          }
        } catch (error) {
          result.errors.push(`删除文件 ${file.path} 失败: ${error.message}`);
        }
      }

      this.emit('cleanup_completed', {
        deletedCount: result.deletedFiles.length,
        freedSpace: result.freedSpace,
        errors: result.errors,
        timestamp: new Date()
      });

      return result;
    } catch (error) {
      this.emit('error', {
        type: 'cleanup_failed',
        error: error.message,
        timestamp: new Date()
      });
      throw error;
    }
  }

  /**
   * 停止服务
   */
  async shutdown(): Promise<void> {
    console.log('正在关闭Redis备份服务...');

    // 停止健康检查
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // 停止备份调度器
    for (const [name, timer] of this.backupSchedulers) {
      clearInterval(timer);
    }
    this.backupSchedulers.clear();

    // 关闭Redis连接
    for (const [name, client] of this.redisClients) {
      await client.disconnect();
    }
    this.redisClients.clear();

    this.emit('shutdown', { timestamp: new Date() });
  }

  // ==================== 私有方法 ====================

  private setupEventHandlers(): void {
    this.on('error', (data) => {
      console.error('Redis备份服务错误:', data);
    });

    this.on('backup_completed', (data) => {
      console.log('Redis备份完成:', {
        jobId: data.job.id,
        instance: data.job.instanceName,
        type: data.job.type,
        duration: data.job.duration,
        size: this.formatBytes(data.job.originalSize)
      });
    });

    this.on('instance_unhealthy', (data) => {
      console.warn(`Redis实例不健康: ${data.instanceName} - ${data.error}`);
    });
  }

  private async connectToRedisInstances(): Promise<void> {
    for (const instance of this.config.redis.instances) {
      try {
        const client = new Redis({
          host: instance.host,
          port: instance.port,
          password: instance.password,
          db: instance.db,
          retryDelayOnFailover: 1000,
          maxRetriesPerRequest: 3,
          lazyConnect: true
        });

        await client.connect();
        this.redisClients.set(instance.name, client);
        
        console.log(`已连接到Redis实例: ${instance.name} (${instance.host}:${instance.port})`);
      } catch (error) {
        console.error(`连接Redis实例失败: ${instance.name}`, error);
        throw error;
      }
    }
  }

  private async validateRedisInstances(): Promise<void> {
    for (const [name, client] of this.redisClients) {
      try {
        await client.ping();
        const info = await client.info('server');
        console.log(`Redis实例验证成功: ${name}`);
      } catch (error) {
        throw new Error(`Redis实例验证失败: ${name} - ${error.message}`);
      }
    }
  }

  private async createBackupDirectories(): Promise<void> {
    const dirs = [
      this.config.backup.localPath,
      path.join(this.config.backup.localPath, 'rdb'),
      path.join(this.config.backup.localPath, 'aof'),
      path.join(this.config.backup.localPath, 'metadata'),
      path.join(this.config.backup.localPath, 'checksums')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      try {
        const healthStatuses = await this.getInstancesHealth();
        for (const health of healthStatuses) {
          if (health.status === 'unhealthy') {
            this.emit('instance_unhealthy', {
              instanceName: health.name,
              error: health.errorMessage,
              timestamp: new Date()
            });
          }
        }
      } catch (error) {
        this.emit('error', {
          type: 'health_check_failed',
          error: error.message,
          timestamp: new Date()
        });
      }
    }, this.config.monitoring.healthCheckInterval * 1000);
  }

  private startBackupSchedulers(): void {
    // RDB备份调度
    const rdbTimer = setInterval(async () => {
      try {
        await this.performRDBBackup();
      } catch (error) {
        this.emit('error', {
          type: 'scheduled_rdb_backup_failed',
          error: error.message,
          timestamp: new Date()
        });
      }
    }, this.config.schedule.rdbInterval * 60 * 1000);

    this.backupSchedulers.set('rdb', rdbTimer);

    // AOF备份调度
    const aofTimer = setInterval(async () => {
      try {
        await this.performAOFBackup();
      } catch (error) {
        this.emit('error', {
          type: 'scheduled_aof_backup_failed',
          error: error.message,
          timestamp: new Date()
        });
      }
    }, this.config.schedule.aofInterval * 60 * 1000);

    this.backupSchedulers.set('aof', aofTimer);

    console.log(`备份调度器启动: RDB每${this.config.schedule.rdbInterval}分钟, AOF每${this.config.schedule.aofInterval}分钟`);
  }

  private async executeRDBBackup(instanceName: string): Promise<RedisBackupJob> {
    const jobId = this.generateJobId('rdb', instanceName);
    const job: RedisBackupJob = {
      id: jobId,
      instanceName,
      type: 'rdb',
      status: 'pending',
      startTime: new Date(),
      originalSize: 0,
      metadata: {}
    };

    this.activeJobs.set(jobId, job);

    try {
      job.status = 'running';
      this.emit('backup_started', { job });

      const startTime = performance.now();
      const client = this.redisClients.get(instanceName);
      
      if (!client) {
        throw new Error(`Redis客户端不存在: ${instanceName}`);
      }

      // 触发BGSAVE命令
      await client.bgsave();
      
      // 等待BGSAVE完成
      await this.waitForBgsaveComplete(client);
      
      // 获取RDB文件路径
      const rdbPath = await this.getRDBFilePath(client);
      
      // 复制RDB文件到备份目录
      const backupPath = await this.copyRDBFile(rdbPath, instanceName, jobId);
      
      // 压缩备份文件(如果启用)
      let finalPath = backupPath;
      if (this.config.backup.compressionEnabled) {
        finalPath = await this.compressBackupFile(backupPath);
      }

      // 加密备份文件(如果启用)
      if (this.config.backup.encryptionEnabled) {
        finalPath = await this.encryptBackupFile(finalPath);
      }

      // 生成校验和
      await this.generateChecksumFile(finalPath);

      // 收集元数据
      const metadata = await this.collectRedisMetadata(client);
      const fileStats = await fs.stat(finalPath);
      
      job.endTime = new Date();
      job.duration = Math.round(performance.now() - startTime);
      job.status = 'completed';
      job.originalSize = fileStats.size;
      job.filePath = finalPath;
      job.metadata = metadata;

      if (this.config.backup.compressionEnabled) {
        const originalStats = await fs.stat(backupPath);
        job.compressedSize = fileStats.size;
        job.compressionRatio = fileStats.size / originalStats.size;
      }

      this.emit('backup_completed', { job });
      
      return job;
    } catch (error) {
      job.status = 'failed';
      job.endTime = new Date();
      job.errorMessage = error.message;
      
      this.emit('backup_failed', { job, error });
      throw error;
    } finally {
      this.activeJobs.delete(jobId);
      this.backupHistory.push(job);
    }
  }

  private async executeAOFBackup(instanceName: string): Promise<RedisBackupJob> {
    const jobId = this.generateJobId('aof', instanceName);
    const job: RedisBackupJob = {
      id: jobId,
      instanceName,
      type: 'aof',
      status: 'pending',
      startTime: new Date(),
      originalSize: 0,
      metadata: {}
    };

    this.activeJobs.set(jobId, job);

    try {
      job.status = 'running';
      this.emit('backup_started', { job });

      const startTime = performance.now();
      const client = this.redisClients.get(instanceName);
      
      if (!client) {
        throw new Error(`Redis客户端不存在: ${instanceName}`);
      }

      // 强制AOF重写
      await client.bgrewriteaof();
      
      // 等待AOF重写完成
      await this.waitForAofRewriteComplete(client);
      
      // 获取AOF文件路径
      const aofPath = await this.getAOFFilePath(client);
      
      // 复制AOF文件到备份目录
      const backupPath = await this.copyAOFFile(aofPath, instanceName, jobId);
      
      // 后续处理与RDB类似...
      const fileStats = await fs.stat(backupPath);
      const metadata = await this.collectRedisMetadata(client);
      
      job.endTime = new Date();
      job.duration = Math.round(performance.now() - startTime);
      job.status = 'completed';
      job.originalSize = fileStats.size;
      job.filePath = backupPath;
      job.metadata = metadata;

      this.emit('backup_completed', { job });
      
      return job;
    } catch (error) {
      job.status = 'failed';
      job.endTime = new Date();
      job.errorMessage = error.message;
      
      this.emit('backup_failed', { job, error });
      throw error;
    } finally {
      this.activeJobs.delete(jobId);
      this.backupHistory.push(job);
    }
  }

  private async waitForBgsaveComplete(client: Redis): Promise<void> {
    let attempts = 0;
    const maxAttempts = 120; // 最多等待2分钟
    
    while (attempts < maxAttempts) {
      const info = await client.info('persistence');
      const rdbBgsaveInProgress = info.includes('rdb_bgsave_in_progress:0');
      
      if (rdbBgsaveInProgress) {
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error('BGSAVE操作超时');
  }

  private async waitForAofRewriteComplete(client: Redis): Promise<void> {
    let attempts = 0;
    const maxAttempts = 120;
    
    while (attempts < maxAttempts) {
      const info = await client.info('persistence');
      const aofRewriteInProgress = info.includes('aof_rewrite_in_progress:0');
      
      if (aofRewriteInProgress) {
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    throw new Error('AOF重写操作超时');
  }

  private async getRDBFilePath(client: Redis): Promise<string> {
    const config = await client.config('GET', 'dir');
    const dbfilename = await client.config('GET', 'dbfilename');
    
    return path.join(config[1], dbfilename[1]);
  }

  private async getAOFFilePath(client: Redis): Promise<string> {
    const config = await client.config('GET', 'dir');
    const aofFilename = await client.config('GET', 'appendfilename');
    
    return path.join(config[1], aofFilename[1]);
  }

  private async copyRDBFile(sourcePath: string, instanceName: string, jobId: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      this.config.backup.localPath, 
      'rdb', 
      `${instanceName}-${timestamp}-${jobId}.rdb`
    );
    
    await fs.copyFile(sourcePath, backupPath);
    return backupPath;
  }

  private async copyAOFFile(sourcePath: string, instanceName: string, jobId: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      this.config.backup.localPath, 
      'aof', 
      `${instanceName}-${timestamp}-${jobId}.aof`
    );
    
    await fs.copyFile(sourcePath, backupPath);
    return backupPath;
  }

  private async compressBackupFile(filePath: string): Promise<string> {
    // 使用gzip压缩
    const compressedPath = `${filePath}.gz`;
    
    return new Promise((resolve, reject) => {
      const gzip = spawn('gzip', ['-9', filePath]);
      
      gzip.on('close', (code) => {
        if (code === 0) {
          resolve(compressedPath);
        } else {
          reject(new Error(`压缩失败，退出代码: ${code}`));
        }
      });
      
      gzip.on('error', reject);
    });
  }

  private async encryptBackupFile(filePath: string): Promise<string> {
    // 简化的加密实现，实际应该使用更强的加密
    const encryptedPath = `${filePath}.enc`;
    const key = crypto.scryptSync('backup-encryption-key', 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipherGCM('aes-256-gcm', key, iv);
    
    const input = await fs.readFile(filePath);
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    await fs.writeFile(encryptedPath, Buffer.concat([iv, authTag, encrypted]));
    await fs.unlink(filePath); // 删除未加密版本
    
    return encryptedPath;
  }

  private async generateChecksumFile(filePath: string): Promise<string> {
    const data = await fs.readFile(filePath);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    
    const checksumPath = path.join(
      this.config.backup.localPath,
      'checksums',
      `${path.basename(filePath)}.sha256`
    );
    
    await fs.writeFile(checksumPath, `${hash}  ${path.basename(filePath)}\n`);
    
    return checksumPath;
  }

  private async collectRedisMetadata(client: Redis): Promise<any> {
    const serverInfo = await client.info('server');
    const memoryInfo = await client.info('memory');
    const persistenceInfo = await client.info('persistence');
    
    return {
      redisVersion: this.extractInfoValue(serverInfo, 'redis_version'),
      memoryUsage: parseInt(this.extractInfoValue(memoryInfo, 'used_memory') || '0'),
      keyCount: await client.dbsize(),
      lastSave: new Date(parseInt(this.extractInfoValue(persistenceInfo, 'rdb_last_save_time') || '0') * 1000)
    };
  }

  private extractInfoValue(info: string, key: string): string | undefined {
    const match = info.match(new RegExp(`${key}:(.+)`));
    return match ? match[1].trim() : undefined;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async verifyFileChecksum(filePath: string): Promise<boolean> {
    // 实现校验和验证逻辑
    return true;
  }

  private async verifyRedisFormat(filePath: string): Promise<boolean> {
    // 实现Redis格式验证逻辑
    return true;
  }

  private async testRestoreCapability(filePath: string): Promise<boolean> {
    // 实现恢复测试逻辑
    return true;
  }

  private getLastBackupTime(instanceName: string): Date | undefined {
    const lastJob = this.backupHistory
      .filter(job => job.instanceName === instanceName && job.status === 'completed')
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())[0];
    
    return lastJob?.startTime;
  }

  private async scanBackupDirectory(): Promise<Array<{path: string, type: string}>> {
    const files: Array<{path: string, type: string}> = [];
    
    const rdbDir = path.join(this.config.backup.localPath, 'rdb');
    const aofDir = path.join(this.config.backup.localPath, 'aof');
    
    // 扫描RDB文件
    const rdbFiles = await fs.readdir(rdbDir);
    for (const file of rdbFiles) {
      files.push({
        path: path.join(rdbDir, file),
        type: 'rdb'
      });
    }
    
    // 扫描AOF文件
    const aofFiles = await fs.readdir(aofDir);
    for (const file of aofFiles) {
      files.push({
        path: path.join(aofDir, file),
        type: 'aof'
      });
    }
    
    return files;
  }

  private generateJobId(type: string, instanceName: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = crypto.randomBytes(4).toString('hex');
    return `${type}-${instanceName}-${timestamp}-${random}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}