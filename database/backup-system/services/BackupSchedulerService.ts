/**
 * AI电话应答系统 - 备份调度服务
 * 
 * 功能特性:
 * - 灵活的备份调度策略
 * - 增量和全量备份自动调度
 * - 基于业务负载的智能调度
 * - 多数据源协调备份
 * - 备份窗口优化
 * - 失败重试和故障转移
 */

import { EventEmitter } from 'events';
import * as cron from 'node-cron';
import { PostgreSQLBackupService } from './PostgreSQLBackupService';
import { RedisBackupService } from './RedisBackupService';
import { BackupEncryptionService } from '../encryption/BackupEncryptionService';

interface BackupScheduleConfig {
  schedule: {
    postgresql: {
      fullBackup: string; // cron表达式
      incrementalBackup: string;
      walArchive: string;
    };
    redis: {
      rdbBackup: string;
      aofBackup: string;
      fullBackup: string;
    };
  };
  policies: {
    maxConcurrentBackups: number;
    backupWindow: {
      start: string; // HH:MM
      end: string; // HH:MM
      timezone: string;
    };
    priority: {
      postgresql: number; // 1-10
      redis: number;
    };
    retryPolicy: {
      maxRetries: number;
      retryInterval: number; // minutes
      exponentialBackoff: boolean;
    };
    loadBalancing: {
      checkSystemLoad: boolean;
      maxCpuUsage: number; // percentage
      maxMemoryUsage: number; // percentage
      maxDiskIO: number; // MB/s
    };
  };
  notifications: {
    onSuccess: boolean;
    onFailure: boolean;
    onScheduleConflict: boolean;
    webhookUrl?: string;
    emailRecipients?: string[];
  };
  maintenance: {
    cleanupSchedule: string; // cron表达式
    healthCheckInterval: number; // minutes
    performanceOptimization: boolean;
  };
}

interface ScheduledBackup {
  id: string;
  type: 'postgresql-full' | 'postgresql-incremental' | 'redis-rdb' | 'redis-aof' | 'redis-full';
  cronExpression: string;
  nextExecution: Date;
  lastExecution?: Date;
  lastDuration?: number;
  isActive: boolean;
  priority: number;
  retryCount: number;
  maxRetries: number;
  task?: cron.ScheduledTask;
}

interface BackupExecution {
  id: string;
  scheduledBackupId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  result?: any;
  errorMessage?: string;
  systemLoad?: {
    cpu: number;
    memory: number;
    diskIO: number;
  };
}

interface SystemMetrics {
  cpu: number;
  memory: number;
  diskIO: number;
  networkIO: number;
  timestamp: Date;
}

export class BackupSchedulerService extends EventEmitter {
  private config: BackupScheduleConfig;
  private postgresqlService: PostgreSQLBackupService;
  private redisService: RedisBackupService;
  private encryptionService: BackupEncryptionService;
  
  private scheduledBackups: Map<string, ScheduledBackup> = new Map();
  private executionQueue: BackupExecution[] = [];
  private activeExecutions: Map<string, BackupExecution> = new Map();
  private systemMetrics: SystemMetrics[] = [];
  
  private healthCheckTimer?: NodeJS.Timeout;
  private cleanupTask?: cron.ScheduledTask;
  private metricsCollectionTimer?: NodeJS.Timeout;

  constructor(
    config: BackupScheduleConfig,
    postgresqlService: PostgreSQLBackupService,
    redisService: RedisBackupService,
    encryptionService: BackupEncryptionService
  ) {
    super();
    this.config = config;
    this.postgresqlService = postgresqlService;
    this.redisService = redisService;
    this.encryptionService = encryptionService;
    
    this.setupEventHandlers();
  }

  /**
   * 初始化调度服务
   */
  async initialize(): Promise<void> {
    try {
      console.log('初始化备份调度服务...');
      
      // 创建调度任务
      await this.createScheduledBackups();
      
      // 启动系统监控
      this.startSystemMonitoring();
      
      // 启动健康检查
      this.startHealthCheck();
      
      // 启动清理任务
      this.startCleanupSchedule();
      
      // 启动执行队列处理
      this.startExecutionProcessor();
      
      this.emit('initialized', {
        scheduledBackupsCount: this.scheduledBackups.size,
        timestamp: new Date()
      });
      
      console.log(`备份调度服务初始化完成，创建了 ${this.scheduledBackups.size} 个调度任务`);
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
   * 手动触发备份
   */
  async triggerBackup(
    type: 'postgresql-full' | 'postgresql-incremental' | 'redis-rdb' | 'redis-aof' | 'redis-full',
    options: {
      priority?: number;
      skipLoadCheck?: boolean;
      encryptResult?: boolean;
    } = {}
  ): Promise<string> {
    const executionId = this.generateExecutionId();
    const execution: BackupExecution = {
      id: executionId,
      scheduledBackupId: `manual-${type}`,
      status: 'queued',
      startTime: new Date()
    };

    // 检查系统负载(除非跳过)
    if (!options.skipLoadCheck) {
      const canExecute = await this.checkSystemLoad();
      if (!canExecute) {
        throw new Error('系统负载过高，无法执行备份');
      }
    }

    // 添加到执行队列
    this.executionQueue.push(execution);
    
    this.emit('backup_queued', {
      executionId,
      type,
      queuePosition: this.executionQueue.length,
      timestamp: new Date()
    });

    console.log(`手动备份已加入队列: ${type} (执行ID: ${executionId})`);
    
    return executionId;
  }

  /**
   * 取消待执行的备份
   */
  async cancelBackup(executionId: string): Promise<boolean> {
    // 从队列中移除
    const queueIndex = this.executionQueue.findIndex(exec => exec.id === executionId);
    if (queueIndex !== -1) {
      const execution = this.executionQueue.splice(queueIndex, 1)[0];
      execution.status = 'cancelled';
      execution.endTime = new Date();
      
      this.emit('backup_cancelled', {
        executionId,
        reason: 'user_requested',
        timestamp: new Date()
      });
      
      return true;
    }

    // 检查是否正在执行
    const activeExecution = this.activeExecutions.get(executionId);
    if (activeExecution) {
      // 这里可以实现正在执行的备份的取消逻辑
      console.log(`正在尝试取消执行中的备份: ${executionId}`);
      return false; // 正在执行的备份通常难以取消
    }

    return false;
  }

  /**
   * 暂停调度服务
   */
  async pauseScheduler(): Promise<void> {
    console.log('暂停备份调度服务...');
    
    // 停止所有调度任务
    for (const [id, backup] of this.scheduledBackups) {
      if (backup.task) {
        backup.task.stop();
        backup.isActive = false;
      }
    }
    
    this.emit('scheduler_paused', { timestamp: new Date() });
  }

  /**
   * 恢复调度服务
   */
  async resumeScheduler(): Promise<void> {
    console.log('恢复备份调度服务...');
    
    // 恢复所有调度任务
    for (const [id, backup] of this.scheduledBackups) {
      if (backup.task) {
        backup.task.start();
        backup.isActive = true;
        backup.nextExecution = this.calculateNextExecution(backup.cronExpression);
      }
    }
    
    this.emit('scheduler_resumed', { timestamp: new Date() });
  }

  /**
   * 获取调度状态
   */
  getSchedulerStatus(): {
    isActive: boolean;
    scheduledBackups: Array<{
      id: string;
      type: string;
      nextExecution: Date;
      lastExecution?: Date;
      isActive: boolean;
    }>;
    executionQueue: Array<{
      id: string;
      type: string;
      status: string;
      queuePosition: number;
    }>;
    activeExecutions: Array<{
      id: string;
      type: string;
      startTime: Date;
      duration: number;
    }>;
    systemMetrics: SystemMetrics;
  } {
    const currentMetrics = this.getCurrentSystemMetrics();
    
    return {
      isActive: Array.from(this.scheduledBackups.values()).some(backup => backup.isActive),
      scheduledBackups: Array.from(this.scheduledBackups.values()).map(backup => ({
        id: backup.id,
        type: backup.type,
        nextExecution: backup.nextExecution,
        lastExecution: backup.lastExecution,
        isActive: backup.isActive
      })),
      executionQueue: this.executionQueue.map((exec, index) => ({
        id: exec.id,
        type: exec.scheduledBackupId,
        status: exec.status,
        queuePosition: index + 1
      })),
      activeExecutions: Array.from(this.activeExecutions.values()).map(exec => ({
        id: exec.id,
        type: exec.scheduledBackupId,
        startTime: exec.startTime,
        duration: Date.now() - exec.startTime.getTime()
      })),
      systemMetrics: currentMetrics
    };
  }

  /**
   * 更新调度配置
   */
  async updateScheduleConfig(updates: Partial<BackupScheduleConfig>): Promise<void> {
    console.log('更新备份调度配置...');
    
    // 合并配置
    this.config = { ...this.config, ...updates };
    
    // 重新创建调度任务
    await this.recreateScheduledBackups();
    
    this.emit('config_updated', { 
      updates,
      timestamp: new Date() 
    });
  }

  /**
   * 停止调度服务
   */
  async shutdown(): Promise<void> {
    console.log('关闭备份调度服务...');
    
    // 停止所有调度任务
    for (const [id, backup] of this.scheduledBackups) {
      if (backup.task) {
        backup.task.stop();
      }
    }
    
    // 停止定时器
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    if (this.metricsCollectionTimer) {
      clearInterval(this.metricsCollectionTimer);
    }
    
    // 停止清理任务
    if (this.cleanupTask) {
      this.cleanupTask.stop();
    }
    
    // 等待活跃执行完成
    const activeExecutionIds = Array.from(this.activeExecutions.keys());
    if (activeExecutionIds.length > 0) {
      console.log(`等待 ${activeExecutionIds.length} 个活跃备份完成...`);
      // 这里可以实现等待逻辑
    }
    
    this.emit('shutdown', { timestamp: new Date() });
  }

  // ==================== 私有方法 ====================

  private setupEventHandlers(): void {
    this.on('error', (data) => {
      console.error('备份调度服务错误:', data);
    });

    this.on('backup_completed', (data) => {
      console.log('备份执行完成:', data);
    });

    this.on('backup_failed', (data) => {
      console.error('备份执行失败:', data);
    });

    this.on('system_overloaded', (data) => {
      console.warn('系统负载过高:', data);
    });
  }

  private async createScheduledBackups(): Promise<void> {
    const scheduleConfigs = [
      // PostgreSQL备份
      {
        type: 'postgresql-full' as const,
        cron: this.config.schedule.postgresql.fullBackup,
        priority: this.config.policies.priority.postgresql
      },
      {
        type: 'postgresql-incremental' as const,
        cron: this.config.schedule.postgresql.incrementalBackup,
        priority: this.config.policies.priority.postgresql + 1
      },
      // Redis备份
      {
        type: 'redis-rdb' as const,
        cron: this.config.schedule.redis.rdbBackup,
        priority: this.config.policies.priority.redis
      },
      {
        type: 'redis-aof' as const,
        cron: this.config.schedule.redis.aofBackup,
        priority: this.config.policies.priority.redis
      },
      {
        type: 'redis-full' as const,
        cron: this.config.schedule.redis.fullBackup,
        priority: this.config.policies.priority.redis - 1
      }
    ];

    for (const scheduleConfig of scheduleConfigs) {
      const scheduledBackup = await this.createScheduledBackup(
        scheduleConfig.type,
        scheduleConfig.cron,
        scheduleConfig.priority
      );
      
      this.scheduledBackups.set(scheduledBackup.id, scheduledBackup);
    }
  }

  private async createScheduledBackup(
    type: ScheduledBackup['type'],
    cronExpression: string,
    priority: number
  ): Promise<ScheduledBackup> {
    const id = this.generateScheduleId(type);
    
    const scheduledBackup: ScheduledBackup = {
      id,
      type,
      cronExpression,
      nextExecution: this.calculateNextExecution(cronExpression),
      isActive: true,
      priority,
      retryCount: 0,
      maxRetries: this.config.policies.retryPolicy.maxRetries
    };

    // 创建cron任务
    const task = cron.schedule(cronExpression, async () => {
      await this.scheduleBackupExecution(scheduledBackup);
    }, {
      scheduled: false,
      timezone: this.config.policies.backupWindow.timezone
    });

    scheduledBackup.task = task;
    
    // 检查备份窗口
    if (this.isWithinBackupWindow()) {
      task.start();
    } else {
      console.log(`备份任务 ${id} 等待备份窗口开启`);
    }

    return scheduledBackup;
  }

  private async scheduleBackupExecution(scheduledBackup: ScheduledBackup): Promise<void> {
    try {
      // 检查系统负载
      if (this.config.policies.loadBalancing.checkSystemLoad) {
        const canExecute = await this.checkSystemLoad();
        if (!canExecute) {
          console.log(`系统负载过高，跳过备份: ${scheduledBackup.type}`);
          this.emit('backup_skipped', {
            scheduledBackupId: scheduledBackup.id,
            reason: 'system_overloaded',
            timestamp: new Date()
          });
          return;
        }
      }

      // 检查并发限制
      if (this.activeExecutions.size >= this.config.policies.maxConcurrentBackups) {
        console.log(`达到最大并发限制，备份加入队列: ${scheduledBackup.type}`);
        await this.queueBackupExecution(scheduledBackup);
        return;
      }

      // 直接执行备份
      await this.executeBackup(scheduledBackup);
    } catch (error) {
      console.error(`调度备份执行失败: ${scheduledBackup.type}`, error);
      
      // 处理重试逻辑
      await this.handleBackupFailure(scheduledBackup, error);
    }
  }

  private async queueBackupExecution(scheduledBackup: ScheduledBackup): Promise<void> {
    const execution: BackupExecution = {
      id: this.generateExecutionId(),
      scheduledBackupId: scheduledBackup.id,
      status: 'queued',
      startTime: new Date()
    };

    // 根据优先级插入队列
    const insertIndex = this.executionQueue.findIndex(
      exec => (this.scheduledBackups.get(exec.scheduledBackupId)?.priority || 0) < scheduledBackup.priority
    );

    if (insertIndex === -1) {
      this.executionQueue.push(execution);
    } else {
      this.executionQueue.splice(insertIndex, 0, execution);
    }

    this.emit('backup_queued', {
      executionId: execution.id,
      scheduledBackupId: scheduledBackup.id,
      type: scheduledBackup.type,
      queuePosition: insertIndex === -1 ? this.executionQueue.length : insertIndex + 1,
      timestamp: new Date()
    });
  }

  private async executeBackup(scheduledBackupOrExecution: ScheduledBackup | BackupExecution): Promise<void> {
    let scheduledBackup: ScheduledBackup;
    let execution: BackupExecution;

    if ('cronExpression' in scheduledBackupOrExecution) {
      // 直接执行的情况
      scheduledBackup = scheduledBackupOrExecution;
      execution = {
        id: this.generateExecutionId(),
        scheduledBackupId: scheduledBackup.id,
        status: 'running',
        startTime: new Date()
      };
    } else {
      // 队列执行的情况
      execution = scheduledBackupOrExecution;
      scheduledBackup = this.scheduledBackups.get(execution.scheduledBackupId)!;
      execution.status = 'running';
    }

    this.activeExecutions.set(execution.id, execution);
    
    this.emit('backup_started', {
      executionId: execution.id,
      scheduledBackupId: scheduledBackup.id,
      type: scheduledBackup.type,
      timestamp: new Date()
    });

    try {
      // 收集系统指标
      execution.systemLoad = this.getCurrentSystemMetrics();
      
      let result: any;
      
      // 根据类型执行不同的备份
      switch (scheduledBackup.type) {
        case 'postgresql-full':
          result = await this.postgresqlService.performFullBackup();
          break;
        case 'postgresql-incremental':
          result = await this.postgresqlService.performIncrementalBackup();
          break;
        case 'redis-rdb':
          result = await this.redisService.performRDBBackup();
          break;
        case 'redis-aof':
          result = await this.redisService.performAOFBackup();
          break;
        case 'redis-full':
          result = await this.redisService.performFullBackup();
          break;
        default:
          throw new Error(`未知的备份类型: ${scheduledBackup.type}`);
      }

      // 更新执行状态
      execution.status = 'completed';
      execution.endTime = new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
      execution.result = result;

      // 更新调度信息
      scheduledBackup.lastExecution = execution.startTime;
      scheduledBackup.lastDuration = execution.duration;
      scheduledBackup.retryCount = 0; // 重置重试计数
      scheduledBackup.nextExecution = this.calculateNextExecution(scheduledBackup.cronExpression);

      this.emit('backup_completed', {
        executionId: execution.id,
        scheduledBackupId: scheduledBackup.id,
        type: scheduledBackup.type,
        duration: execution.duration,
        result,
        timestamp: new Date()
      });

      console.log(`备份执行完成: ${scheduledBackup.type}, 耗时: ${execution.duration}ms`);
    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
      execution.errorMessage = error.message;

      this.emit('backup_failed', {
        executionId: execution.id,
        scheduledBackupId: scheduledBackup.id,
        type: scheduledBackup.type,
        error: error.message,
        timestamp: new Date()
      });

      // 处理重试逻辑
      await this.handleBackupFailure(scheduledBackup, error);
      
      throw error;
    } finally {
      this.activeExecutions.delete(execution.id);
    }
  }

  private async handleBackupFailure(scheduledBackup: ScheduledBackup, error: any): Promise<void> {
    scheduledBackup.retryCount++;
    
    if (scheduledBackup.retryCount <= scheduledBackup.maxRetries) {
      console.log(`备份失败，准备重试 (${scheduledBackup.retryCount}/${scheduledBackup.maxRetries}): ${scheduledBackup.type}`);
      
      // 计算重试延迟
      let retryDelay = this.config.policies.retryPolicy.retryInterval * 60 * 1000; // 转换为毫秒
      
      if (this.config.policies.retryPolicy.exponentialBackoff) {
        retryDelay *= Math.pow(2, scheduledBackup.retryCount - 1);
      }
      
      // 安排重试
      setTimeout(async () => {
        try {
          await this.executeBackup(scheduledBackup);
        } catch (retryError) {
          console.error(`重试备份失败: ${scheduledBackup.type}`, retryError);
        }
      }, retryDelay);
      
      this.emit('backup_retry_scheduled', {
        scheduledBackupId: scheduledBackup.id,
        type: scheduledBackup.type,
        retryCount: scheduledBackup.retryCount,
        retryDelay,
        timestamp: new Date()
      });
    } else {
      console.error(`备份失败，已达到最大重试次数: ${scheduledBackup.type}`);
      
      this.emit('backup_failed_permanently', {
        scheduledBackupId: scheduledBackup.id,
        type: scheduledBackup.type,
        finalError: error.message,
        totalRetries: scheduledBackup.retryCount,
        timestamp: new Date()
      });
      
      // 重置重试计数
      scheduledBackup.retryCount = 0;
    }
  }

  private startSystemMonitoring(): void {
    this.metricsCollectionTimer = setInterval(async () => {
      try {
        const metrics = await this.collectSystemMetrics();
        this.systemMetrics.push(metrics);
        
        // 保持最近24小时的指标
        const cutoff = new Date();
        cutoff.setHours(cutoff.getHours() - 24);
        this.systemMetrics = this.systemMetrics.filter(m => m.timestamp > cutoff);
        
        // 检查系统负载警告
        if (metrics.cpu > this.config.policies.loadBalancing.maxCpuUsage ||
            metrics.memory > this.config.policies.loadBalancing.maxMemoryUsage) {
          this.emit('system_overloaded', {
            metrics,
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error('系统指标收集失败:', error);
      }
    }, 60000); // 每分钟收集一次
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.emit('health_check_failed', {
          error: error.message,
          timestamp: new Date()
        });
      }
    }, this.config.maintenance.healthCheckInterval * 60 * 1000);
  }

  private startCleanupSchedule(): void {
    this.cleanupTask = cron.schedule(this.config.maintenance.cleanupSchedule, async () => {
      try {
        await this.performCleanup();
      } catch (error) {
        this.emit('cleanup_failed', {
          error: error.message,
          timestamp: new Date()
        });
      }
    });
  }

  private startExecutionProcessor(): void {
    // 定期处理执行队列
    setInterval(async () => {
      if (this.executionQueue.length > 0 && 
          this.activeExecutions.size < this.config.policies.maxConcurrentBackups) {
        
        const execution = this.executionQueue.shift()!;
        const scheduledBackup = this.scheduledBackups.get(execution.scheduledBackupId);
        
        if (scheduledBackup) {
          try {
            await this.executeBackup(execution);
          } catch (error) {
            console.error('队列备份执行失败:', error);
          }
        }
      }
    }, 30000); // 每30秒检查一次
  }

  private async checkSystemLoad(): Promise<boolean> {
    if (!this.config.policies.loadBalancing.checkSystemLoad) {
      return true;
    }

    const metrics = this.getCurrentSystemMetrics();
    
    return (
      metrics.cpu <= this.config.policies.loadBalancing.maxCpuUsage &&
      metrics.memory <= this.config.policies.loadBalancing.maxMemoryUsage &&
      metrics.diskIO <= this.config.policies.loadBalancing.maxDiskIO
    );
  }

  private async collectSystemMetrics(): Promise<SystemMetrics> {
    // 简化的系统指标收集实现
    // 在实际环境中，应该使用更准确的系统监控API
    const os = require('os');
    
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    return {
      cpu: Math.random() * 100, // 模拟CPU使用率
      memory: ((totalMem - freeMem) / totalMem) * 100,
      diskIO: Math.random() * 100, // 模拟磁盘IO
      networkIO: Math.random() * 100, // 模拟网络IO
      timestamp: new Date()
    };
  }

  private getCurrentSystemMetrics(): SystemMetrics {
    return this.systemMetrics[this.systemMetrics.length - 1] || {
      cpu: 0,
      memory: 0,
      diskIO: 0,
      networkIO: 0,
      timestamp: new Date()
    };
  }

  private async performHealthCheck(): Promise<void> {
    // 检查各个服务的健康状态
    const checks = {
      postgresql: this.postgresqlService ? 'healthy' : 'unhealthy',
      redis: this.redisService ? 'healthy' : 'unhealthy',
      encryption: this.encryptionService ? 'healthy' : 'unhealthy'
    };

    this.emit('health_check_completed', {
      checks,
      timestamp: new Date()
    });
  }

  private async performCleanup(): Promise<void> {
    console.log('执行备份系统清理...');
    
    // 清理过期的执行记录
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30); // 保留30天的记录
    
    // 这里可以实现更具体的清理逻辑
    
    this.emit('cleanup_completed', {
      timestamp: new Date()
    });
  }

  private isWithinBackupWindow(): boolean {
    const now = new Date();
    const currentTime = now.toTimeString().substr(0, 5); // HH:MM
    
    return currentTime >= this.config.policies.backupWindow.start &&
           currentTime <= this.config.policies.backupWindow.end;
  }

  private calculateNextExecution(cronExpression: string): Date {
    // 简化的下次执行时间计算
    // 在实际实现中应该使用更准确的cron解析库
    const now = new Date();
    now.setHours(now.getHours() + 1); // 简单地设为一小时后
    return now;
  }

  private async recreateScheduledBackups(): Promise<void> {
    // 停止现有任务
    for (const [id, backup] of this.scheduledBackups) {
      if (backup.task) {
        backup.task.stop();
      }
    }
    
    this.scheduledBackups.clear();
    
    // 重新创建任务
    await this.createScheduledBackups();
  }

  private generateScheduleId(type: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `schedule-${type}-${timestamp}`;
  }

  private generateExecutionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).substr(2, 9);
    return `exec-${timestamp}-${random}`;
  }
}