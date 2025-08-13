import { CronJob } from 'cron';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import logger from '../utils/logger';
import { BlobStorageManager } from '../azure/BlobStorageManager';
import { FileStorageService } from '../services/FileStorageService';
import {
  ArchivePolicy,
  CleanupTask,
  StorageTier,
  FileType,
  FileStatus,
  FileMetadata,
  StorageConfig,
  StorageError
} from '../types';

export interface ArchiveRule {
  name: string;
  enabled: boolean;
  schedule: string; // Cron表达式
  policy: ArchivePolicy;
  lastRun?: Date;
  nextRun?: Date;
  stats: {
    totalRuns: number;
    successfulRuns: number;
    totalFilesProcessed: number;
    totalSpaceFreed: number; // 字节
  };
}

export interface CleanupReport {
  taskId: string;
  startTime: Date;
  endTime: Date;
  status: 'completed' | 'failed' | 'partial';
  summary: {
    totalFiles: number;
    processedFiles: number;
    failedFiles: number;
    spaceFreed: number;
    errors: string[];
  };
  details: {
    archivedFiles: number;
    deletedFiles: number;
    compressedFiles: number;
    tierChanges: Record<StorageTier, number>;
  };
}

export class DataArchiveService {
  private fileService: FileStorageService;
  private blobManager: BlobStorageManager;
  private redis: Redis;
  private config: StorageConfig;
  private archiveRules: Map<string, ArchiveRule> = new Map();
  private runningTasks: Map<string, CleanupTask> = new Map();
  private cronJobs: Map<string, CronJob> = new Map();

  // 默认归档策略
  private static readonly DEFAULT_POLICIES: ArchiveRule[] = [
    {
      name: 'old_audio_archive',
      enabled: true,
      schedule: '0 2 * * 0', // 每周日凌晨2点
      policy: {
        name: 'Old Audio Archive',
        conditions: {
          fileAge: 30, // 30天
          accessCount: 0,
          lastAccessDays: 7,
          fileTypes: [FileType.AUDIO],
          sizeLargerThan: 10 * 1024 * 1024 // 10MB
        },
        actions: {
          moveToTier: StorageTier.ARCHIVE,
          compress: true,
          encrypt: true,
          notify: true
        }
      },
      stats: {
        totalRuns: 0,
        successfulRuns: 0,
        totalFilesProcessed: 0,
        totalSpaceFreed: 0
      }
    },
    {
      name: 'temp_files_cleanup',
      enabled: true,
      schedule: '0 1 * * *', // 每天凌晨1点
      policy: {
        name: 'Temporary Files Cleanup',
        conditions: {
          fileAge: 1, // 1天
          accessCount: 0,
          lastAccessDays: 1,
          fileTypes: [FileType.OTHER]
        },
        actions: {
          moveToTier: StorageTier.ARCHIVE,
          compress: false,
          encrypt: false,
          notify: false
        }
      },
      stats: {
        totalRuns: 0,
        successfulRuns: 0,
        totalFilesProcessed: 0,
        totalSpaceFreed: 0
      }
    },
    {
      name: 'large_files_cool_storage',
      enabled: true,
      schedule: '0 3 * * 1', // 每周一凌晨3点
      policy: {
        name: 'Large Files Cool Storage',
        conditions: {
          fileAge: 7, // 7天
          accessCount: 0,
          lastAccessDays: 3,
          fileTypes: [FileType.AUDIO, FileType.VIDEO],
          sizeLargerThan: 100 * 1024 * 1024 // 100MB
        },
        actions: {
          moveToTier: StorageTier.COOL,
          compress: false,
          encrypt: false,
          notify: false
        }
      },
      stats: {
        totalRuns: 0,
        successfulRuns: 0,
        totalFilesProcessed: 0,
        totalSpaceFreed: 0
      }
    }
  ];

  constructor(
    fileService: FileStorageService,
    blobManager: BlobStorageManager,
    config: StorageConfig
  ) {
    this.fileService = fileService;
    this.blobManager = blobManager;
    this.config = config;

    // 初始化Redis
    this.redis = new Redis({
      host: config.cache.redis.host,
      port: config.cache.redis.port,
      password: config.cache.redis.password
    });

    // 初始化默认策略
    this.initializeDefaultPolicies();

    // 启动定时任务
    this.startScheduledJobs();

    logger.info('DataArchiveService initialized successfully');
  }

  /**
   * 添加归档规则
   */
  async addArchiveRule(rule: ArchiveRule): Promise<void> {
    try {
      // 验证规则
      this.validateArchiveRule(rule);

      // 添加到内存
      this.archiveRules.set(rule.name, rule);

      // 持久化到Redis
      await this.saveArchiveRule(rule);

      // 如果启用了，创建定时任务
      if (rule.enabled) {
        this.scheduleJob(rule);
      }

      logger.info(`Archive rule added: ${rule.name}`);

    } catch (error) {
      logger.error(`Failed to add archive rule ${rule.name}:`, error);
      throw new StorageError(`Failed to add archive rule: ${error.message}`, 'RULE_ADD_FAILED');
    }
  }

  /**
   * 更新归档规则
   */
  async updateArchiveRule(ruleName: string, updates: Partial<ArchiveRule>): Promise<void> {
    try {
      const existingRule = this.archiveRules.get(ruleName);
      if (!existingRule) {
        throw new StorageError('Archive rule not found', 'RULE_NOT_FOUND');
      }

      // 合并更新
      const updatedRule = { ...existingRule, ...updates };

      // 验证更新后的规则
      this.validateArchiveRule(updatedRule);

      // 更新内存
      this.archiveRules.set(ruleName, updatedRule);

      // 持久化
      await this.saveArchiveRule(updatedRule);

      // 重新调度任务
      this.unscheduleJob(ruleName);
      if (updatedRule.enabled) {
        this.scheduleJob(updatedRule);
      }

      logger.info(`Archive rule updated: ${ruleName}`);

    } catch (error) {
      logger.error(`Failed to update archive rule ${ruleName}:`, error);
      throw new StorageError(`Failed to update archive rule: ${error.message}`, 'RULE_UPDATE_FAILED');
    }
  }

  /**
   * 删除归档规则
   */
  async removeArchiveRule(ruleName: string): Promise<void> {
    try {
      // 停止定时任务
      this.unscheduleJob(ruleName);

      // 从内存移除
      this.archiveRules.delete(ruleName);

      // 从Redis移除
      await this.redis.hdel('archive_rules', ruleName);

      logger.info(`Archive rule removed: ${ruleName}`);

    } catch (error) {
      logger.error(`Failed to remove archive rule ${ruleName}:`, error);
      throw new StorageError(`Failed to remove archive rule: ${error.message}`, 'RULE_REMOVE_FAILED');
    }
  }

  /**
   * 立即执行归档任务
   */
  async executeArchiveTask(ruleName: string, dryRun: boolean = false): Promise<CleanupReport> {
    try {
      const rule = this.archiveRules.get(ruleName);
      if (!rule) {
        throw new StorageError('Archive rule not found', 'RULE_NOT_FOUND');
      }

      const taskId = uuidv4();
      const task: CleanupTask = {
        id: taskId,
        type: 'archive',
        status: 'running',
        targetFileIds: [],
        progress: 0,
        createdAt: new Date(),
        stats: {
          totalFiles: 0,
          processedFiles: 0,
          freedSpace: 0,
          errors: 0
        }
      };

      this.runningTasks.set(taskId, task);

      logger.info(`Starting archive task: ${ruleName} (${taskId})`, { dryRun });

      const report = await this.executeArchivePolicyInternal(rule.policy, task, dryRun);

      // 更新规则统计
      if (!dryRun) {
        rule.stats.totalRuns++;
        if (report.status === 'completed') {
          rule.stats.successfulRuns++;
        }
        rule.stats.totalFilesProcessed += report.summary.processedFiles;
        rule.stats.totalSpaceFreed += report.summary.spaceFreed;
        rule.lastRun = new Date();

        await this.saveArchiveRule(rule);
      }

      this.runningTasks.delete(taskId);

      logger.info(`Archive task completed: ${ruleName} (${taskId})`, {
        processedFiles: report.summary.processedFiles,
        spaceFreed: report.summary.spaceFreed,
        status: report.status
      });

      return report;

    } catch (error) {
      logger.error(`Archive task failed: ${ruleName}`, error);
      throw new StorageError(`Archive task failed: ${error.message}`, 'ARCHIVE_TASK_FAILED');
    }
  }

  /**
   * 立即执行清理任务
   */
  async executeCleanupTask(
    conditions: {
      fileAge?: number;
      fileTypes?: FileType[];
      storageTier?: StorageTier;
      status?: FileStatus;
    },
    action: 'delete' | 'archive',
    dryRun: boolean = false
  ): Promise<CleanupReport> {
    try {
      const taskId = uuidv4();
      const task: CleanupTask = {
        id: taskId,
        type: action,
        status: 'running',
        targetFileIds: [],
        progress: 0,
        createdAt: new Date(),
        stats: {
          totalFiles: 0,
          processedFiles: 0,
          freedSpace: 0,
          errors: 0
        }
      };

      this.runningTasks.set(taskId, task);

      logger.info(`Starting cleanup task: ${action} (${taskId})`, { conditions, dryRun });

      const report = await this.executeCleanupInternal(conditions, action, task, dryRun);

      this.runningTasks.delete(taskId);

      logger.info(`Cleanup task completed: ${action} (${taskId})`, {
        processedFiles: report.summary.processedFiles,
        status: report.status
      });

      return report;

    } catch (error) {
      logger.error(`Cleanup task failed: ${action}`, error);
      throw new StorageError(`Cleanup task failed: ${error.message}`, 'CLEANUP_TASK_FAILED');
    }
  }

  /**
   * 获取存储使用统计
   */
  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    tierDistribution: Record<StorageTier, { count: number; size: number }>;
    typeDistribution: Record<FileType, { count: number; size: number }>;
    archiveOpportunities: Array<{
      ruleName: string;
      estimatedFiles: number;
      estimatedSavings: number;
    }>;
  }> {
    try {
      // 这里应该从数据库或缓存获取统计数据
      // 暂时返回模拟数据
      const stats = {
        totalFiles: 0,
        totalSize: 0,
        tierDistribution: {
          [StorageTier.HOT]: { count: 0, size: 0 },
          [StorageTier.COOL]: { count: 0, size: 0 },
          [StorageTier.ARCHIVE]: { count: 0, size: 0 }
        },
        typeDistribution: {
          [FileType.AUDIO]: { count: 0, size: 0 },
          [FileType.IMAGE]: { count: 0, size: 0 },
          [FileType.VIDEO]: { count: 0, size: 0 },
          [FileType.DOCUMENT]: { count: 0, size: 0 },
          [FileType.OTHER]: { count: 0, size: 0 }
        },
        archiveOpportunities: []
      };

      // 计算归档机会
      for (const rule of this.archiveRules.values()) {
        if (rule.enabled) {
          const opportunity = await this.estimateArchiveOpportunity(rule.policy);
          stats.archiveOpportunities.push({
            ruleName: rule.name,
            estimatedFiles: opportunity.fileCount,
            estimatedSavings: opportunity.spaceSavings
          });
        }
      }

      return stats;

    } catch (error) {
      logger.error('Failed to get storage stats:', error);
      throw new StorageError(`Failed to get storage stats: ${error.message}`, 'STATS_FAILED');
    }
  }

  /**
   * 获取所有归档规则
   */
  getArchiveRules(): ArchiveRule[] {
    return Array.from(this.archiveRules.values());
  }

  /**
   * 获取运行中的任务
   */
  getRunningTasks(): CleanupTask[] {
    return Array.from(this.runningTasks.values());
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    // 停止所有定时任务
    for (const job of this.cronJobs.values()) {
      job.stop();
    }
    this.cronJobs.clear();

    // 关闭Redis连接
    await this.redis.disconnect();

    logger.info('DataArchiveService stopped');
  }

  // 私有方法

  private initializeDefaultPolicies(): void {
    for (const defaultRule of DataArchiveService.DEFAULT_POLICIES) {
      this.archiveRules.set(defaultRule.name, { ...defaultRule });
    }
  }

  private startScheduledJobs(): void {
    for (const rule of this.archiveRules.values()) {
      if (rule.enabled) {
        this.scheduleJob(rule);
      }
    }
  }

  private scheduleJob(rule: ArchiveRule): void {
    try {
      const job = new CronJob(
        rule.schedule,
        async () => {
          try {
            await this.executeArchiveTask(rule.name, false);
          } catch (error) {
            logger.error(`Scheduled archive task failed: ${rule.name}`, error);
          }
        },
        null,
        true,
        'UTC'
      );

      this.cronJobs.set(rule.name, job);
      
      // 计算下次运行时间
      rule.nextRun = job.nextDate().toDate();

      logger.info(`Scheduled archive job: ${rule.name}`, {
        schedule: rule.schedule,
        nextRun: rule.nextRun
      });

    } catch (error) {
      logger.error(`Failed to schedule job for rule ${rule.name}:`, error);
    }
  }

  private unscheduleJob(ruleName: string): void {
    const job = this.cronJobs.get(ruleName);
    if (job) {
      job.stop();
      this.cronJobs.delete(ruleName);
      logger.info(`Unscheduled archive job: ${ruleName}`);
    }
  }

  private validateArchiveRule(rule: ArchiveRule): void {
    if (!rule.name || rule.name.trim().length === 0) {
      throw new ValidationError('Archive rule name is required');
    }

    if (!rule.schedule) {
      throw new ValidationError('Archive rule schedule is required');
    }

    if (!rule.policy) {
      throw new ValidationError('Archive rule policy is required');
    }

    // 验证Cron表达式
    try {
      new CronJob(rule.schedule, () => {}, null, false);
    } catch (error) {
      throw new ValidationError(`Invalid cron schedule: ${rule.schedule}`);
    }
  }

  private async saveArchiveRule(rule: ArchiveRule): Promise<void> {
    try {
      await this.redis.hset('archive_rules', rule.name, JSON.stringify(rule));
    } catch (error) {
      logger.error(`Failed to save archive rule ${rule.name}:`, error);
    }
  }

  private async executeArchivePolicyInternal(
    policy: ArchivePolicy,
    task: CleanupTask,
    dryRun: boolean
  ): Promise<CleanupReport> {
    const startTime = new Date();
    const report: CleanupReport = {
      taskId: task.id,
      startTime,
      endTime: new Date(),
      status: 'completed',
      summary: {
        totalFiles: 0,
        processedFiles: 0,
        failedFiles: 0,
        spaceFreed: 0,
        errors: []
      },
      details: {
        archivedFiles: 0,
        deletedFiles: 0,
        compressedFiles: 0,
        tierChanges: {
          [StorageTier.HOT]: 0,
          [StorageTier.COOL]: 0,
          [StorageTier.ARCHIVE]: 0
        }
      }
    };

    try {
      // 查找符合条件的文件
      const candidateFiles = await this.findCandidateFiles(policy.conditions);
      
      report.summary.totalFiles = candidateFiles.length;
      task.stats.totalFiles = candidateFiles.length;

      logger.info(`Found ${candidateFiles.length} candidate files for policy: ${policy.name}`);

      // 处理每个文件
      for (let i = 0; i < candidateFiles.length; i++) {
        const file = candidateFiles[i];
        
        try {
          if (!dryRun) {
            await this.processFileForArchive(file, policy.actions);
          }

          // 更新统计
          report.summary.processedFiles++;
          report.summary.spaceFreed += file.size;

          if (policy.actions.moveToTier !== file.storageTier) {
            report.details.tierChanges[policy.actions.moveToTier]++;
          }

          if (policy.actions.moveToTier === StorageTier.ARCHIVE) {
            report.details.archivedFiles++;
          }

          if (policy.actions.compress) {
            report.details.compressedFiles++;
          }

          // 更新进度
          task.progress = Math.round((i + 1) / candidateFiles.length * 100);
          task.stats.processedFiles = report.summary.processedFiles;
          task.stats.freedSpace = report.summary.spaceFreed;

        } catch (error) {
          logger.error(`Failed to process file ${file.id}:`, error);
          report.summary.failedFiles++;
          report.summary.errors.push(`File ${file.id}: ${error.message}`);
          task.stats.errors++;
        }
      }

      task.status = 'completed';
      report.status = report.summary.failedFiles > 0 ? 'partial' : 'completed';

    } catch (error) {
      logger.error('Archive policy execution failed:', error);
      task.status = 'failed';
      report.status = 'failed';
      report.summary.errors.push(error.message);
    }

    report.endTime = new Date();
    task.completedAt = report.endTime;

    return report;
  }

  private async executeCleanupInternal(
    conditions: any,
    action: 'delete' | 'archive',
    task: CleanupTask,
    dryRun: boolean
  ): Promise<CleanupReport> {
    const startTime = new Date();
    const report: CleanupReport = {
      taskId: task.id,
      startTime,
      endTime: new Date(),
      status: 'completed',
      summary: {
        totalFiles: 0,
        processedFiles: 0,
        failedFiles: 0,
        spaceFreed: 0,
        errors: []
      },
      details: {
        archivedFiles: 0,
        deletedFiles: 0,
        compressedFiles: 0,
        tierChanges: {
          [StorageTier.HOT]: 0,
          [StorageTier.COOL]: 0,
          [StorageTier.ARCHIVE]: 0
        }
      }
    };

    try {
      // 查找符合条件的文件
      const candidateFiles = await this.findFilesForCleanup(conditions);
      
      report.summary.totalFiles = candidateFiles.length;
      task.stats.totalFiles = candidateFiles.length;

      // 处理每个文件
      for (let i = 0; i < candidateFiles.length; i++) {
        const file = candidateFiles[i];
        
        try {
          if (!dryRun) {
            if (action === 'delete') {
              await this.fileService.deleteFile(file.id);
              report.details.deletedFiles++;
            } else if (action === 'archive') {
              await this.fileService.changeStorageTier(file.id, StorageTier.ARCHIVE);
              report.details.archivedFiles++;
              report.details.tierChanges[StorageTier.ARCHIVE]++;
            }
          }

          report.summary.processedFiles++;
          report.summary.spaceFreed += file.size;

          // 更新进度
          task.progress = Math.round((i + 1) / candidateFiles.length * 100);
          task.stats.processedFiles = report.summary.processedFiles;
          task.stats.freedSpace = report.summary.spaceFreed;

        } catch (error) {
          logger.error(`Failed to process file ${file.id}:`, error);
          report.summary.failedFiles++;
          report.summary.errors.push(`File ${file.id}: ${error.message}`);
          task.stats.errors++;
        }
      }

      task.status = 'completed';
      report.status = report.summary.failedFiles > 0 ? 'partial' : 'completed';

    } catch (error) {
      logger.error('Cleanup execution failed:', error);
      task.status = 'failed';
      report.status = 'failed';
      report.summary.errors.push(error.message);
    }

    report.endTime = new Date();
    task.completedAt = report.endTime;

    return report;
  }

  private async findCandidateFiles(conditions: ArchivePolicy['conditions']): Promise<FileMetadata[]> {
    // 这里应该查询数据库找到符合条件的文件
    // 暂时返回空数组，实际实现需要集成数据库查询
    return [];
  }

  private async findFilesForCleanup(conditions: any): Promise<FileMetadata[]> {
    // 这里应该查询数据库找到符合条件的文件
    // 暂时返回空数组，实际实现需要集成数据库查询
    return [];
  }

  private async processFileForArchive(
    file: FileMetadata,
    actions: ArchivePolicy['actions']
  ): Promise<void> {
    try {
      // 更改存储层级
      if (actions.moveToTier !== file.storageTier) {
        await this.fileService.changeStorageTier(file.id, actions.moveToTier);
      }

      // 如果需要压缩或加密，这里可以添加相应的处理逻辑
      // 注意：这些操作可能需要重新上传文件

    } catch (error) {
      logger.error(`Failed to process file for archive ${file.id}:`, error);
      throw error;
    }
  }

  private async estimateArchiveOpportunity(policy: ArchivePolicy): Promise<{
    fileCount: number;
    spaceSavings: number;
  }> {
    try {
      const candidateFiles = await this.findCandidateFiles(policy.conditions);
      
      return {
        fileCount: candidateFiles.length,
        spaceSavings: candidateFiles.reduce((total, file) => {
          // 估算空间节省（基于压缩和存储层级变化）
          let savings = 0;
          
          // 如果移动到更便宜的存储层级，计算成本节省
          if (policy.actions.moveToTier === StorageTier.ARCHIVE) {
            savings += file.size * 0.5; // 估算50%的成本节省
          } else if (policy.actions.moveToTier === StorageTier.COOL) {
            savings += file.size * 0.3; // 估算30%的成本节省
          }
          
          // 如果压缩，估算空间节省
          if (policy.actions.compress) {
            savings += file.size * 0.3; // 估算30%的空间节省
          }
          
          return total + savings;
        }, 0)
      };

    } catch (error) {
      logger.error('Failed to estimate archive opportunity:', error);
      return { fileCount: 0, spaceSavings: 0 };
    }
  }
}