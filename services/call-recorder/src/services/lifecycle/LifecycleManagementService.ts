import { Queue, QueueScheduler, Worker } from 'bullmq';
import cron from 'node-cron';
import { config } from '../../config';
import {
  LifecycleManager,
  RecordingMetadata,
  RecordingStatus,
  RetentionPolicy,
  ArchivalTier
} from '../../types';
import { logger } from '../../utils/logger';
import { DatabaseService } from '../database/DatabaseService';
import { StorageProvider } from '../../types';
import { AuditService } from '../audit/AuditService';

interface LifecycleJob {
  type: 'archive' | 'delete' | 'restore' | 'retention_check';
  recordingId: string;
  userId?: string;
  reason?: string;
  scheduledDate?: Date;
  tier?: ArchivalTier;
}

export class LifecycleManagementService implements LifecycleManager {
  private queue: Queue<LifecycleJob>;
  private scheduler: QueueScheduler;
  private worker: Worker<LifecycleJob>;
  private storageProvider: StorageProvider;
  private databaseService: DatabaseService;
  private auditService: AuditService;
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();

  constructor(
    storageProvider: StorageProvider,
    databaseService: DatabaseService,
    auditService: AuditService
  ) {
    this.storageProvider = storageProvider;
    this.databaseService = databaseService;
    this.auditService = auditService;

    // Initialize queue
    const redisConnection = {
      host: config.queue.redis.host,
      port: config.queue.redis.port,
      password: config.queue.redis.password
    };

    this.queue = new Queue<LifecycleJob>('lifecycle-management', {
      connection: redisConnection,
      defaultJobOptions: config.queue.defaultJobOptions
    });

    this.scheduler = new QueueScheduler('lifecycle-management', {
      connection: redisConnection
    });

    this.worker = new Worker<LifecycleJob>(
      'lifecycle-management',
      async (job) => this.processLifecycleJob(job.data),
      {
        connection: redisConnection,
        concurrency: 5
      }
    );

    this.initializeCronJobs();
    this.setupWorkerHandlers();

    logger.info('Lifecycle management service initialized');
  }

  /**
   * Initialize scheduled cron jobs
   */
  private initializeCronJobs(): void {
    // Schedule daily retention policy enforcement
    const retentionJob = cron.schedule(
      config.lifecycle.deletion.schedule,
      async () => {
        logger.info('Running scheduled retention policy enforcement');
        await this.enforceAllRetentionPolicies();
      },
      {
        scheduled: true,
        timezone: 'UTC'
      }
    );

    this.cronJobs.set('retention-enforcement', retentionJob);

    // Schedule archival check every 6 hours
    const archivalJob = cron.schedule(
      '0 */6 * * *',
      async () => {
        logger.info('Running scheduled archival check');
        await this.checkArchivalCandidates();
      },
      {
        scheduled: true,
        timezone: 'UTC'
      }
    );

    this.cronJobs.set('archival-check', archivalJob);

    logger.info('Cron jobs scheduled', {
      jobs: Array.from(this.cronJobs.keys())
    });
  }

  /**
   * Setup worker event handlers
   */
  private setupWorkerHandlers(): void {
    this.worker.on('completed', (job) => {
      logger.info('Lifecycle job completed', {
        jobId: job.id,
        type: job.data.type,
        recordingId: job.data.recordingId
      });
    });

    this.worker.on('failed', (job, error) => {
      logger.error('Lifecycle job failed', {
        jobId: job?.id,
        type: job?.data.type,
        recordingId: job?.data.recordingId,
        error: error.message
      });
    });

    this.worker.on('stalled', (jobId) => {
      logger.warn('Lifecycle job stalled', { jobId });
    });
  }

  /**
   * Process lifecycle job
   */
  private async processLifecycleJob(job: LifecycleJob): Promise<void> {
    try {
      switch (job.type) {
        case 'archive':
          await this.executeArchival(job.recordingId, job.tier || ArchivalTier.COOL);
          break;
        case 'delete':
          await this.executeDeletion(job.recordingId, job.reason || 'Scheduled deletion');
          break;
        case 'restore':
          await this.executeRestore(job.recordingId);
          break;
        case 'retention_check':
          await this.checkRetention(job.recordingId);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }
    } catch (error) {
      logger.error('Failed to process lifecycle job', {
        job,
        error
      });
      throw error;
    }
  }

  /**
   * Enforce retention policy for a recording
   */
  async enforceRetentionPolicy(recordingId: string): Promise<void> {
    try {
      const metadata = await this.databaseService.getRecordingMetadata(recordingId);
      if (!metadata) {
        throw new Error(`Recording ${recordingId} not found`);
      }

      const policy = metadata.retentionPolicy || this.getDefaultRetentionPolicy();

      // Check if legal hold is active
      if (policy.legalHold) {
        logger.info('Recording under legal hold, skipping retention enforcement', {
          recordingId
        });
        return;
      }

      const now = new Date();
      const recordingAge = Math.floor(
        (now.getTime() - metadata.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Check for archival
      if (
        policy.archivalEnabled &&
        policy.archivalAfterDays &&
        recordingAge >= policy.archivalAfterDays &&
        metadata.status !== RecordingStatus.ARCHIVED
      ) {
        await this.archiveRecording(recordingId);
      }

      // Check for deletion
      if (recordingAge >= policy.retentionDays) {
        await this.deleteRecording(recordingId, 'Retention policy expired');
      }

      logger.info('Retention policy enforced', {
        recordingId,
        age: recordingAge,
        policy
      });
    } catch (error) {
      logger.error('Failed to enforce retention policy', {
        recordingId,
        error
      });
      throw error;
    }
  }

  /**
   * Archive recording to cold storage
   */
  async archiveRecording(recordingId: string): Promise<void> {
    try {
      // Update status
      await this.databaseService.updateRecordingStatus(
        recordingId,
        RecordingStatus.PROCESSING
      );

      // Determine archival tier based on age
      const metadata = await this.databaseService.getRecordingMetadata(recordingId);
      const age = Math.floor(
        (Date.now() - metadata!.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      let tier: ArchivalTier;
      if (age > 180) {
        tier = ArchivalTier.ARCHIVE;
      } else if (age > 90) {
        tier = ArchivalTier.COLD;
      } else if (age > 30) {
        tier = ArchivalTier.COOL;
      } else {
        tier = ArchivalTier.HOT;
      }

      // Move to archive tier
      await this.storageProvider.archive(recordingId, tier);

      // Update metadata
      await this.databaseService.updateRecordingStatus(
        recordingId,
        RecordingStatus.ARCHIVED
      );

      // Audit log
      await this.auditService.logArchival(recordingId, tier);

      logger.info('Recording archived', {
        recordingId,
        tier,
        age
      });
    } catch (error) {
      logger.error('Failed to archive recording', {
        recordingId,
        error
      });

      // Revert status
      await this.databaseService.updateRecordingStatus(
        recordingId,
        RecordingStatus.COMPLETED
      );

      throw error;
    }
  }

  /**
   * Delete recording permanently
   */
  async deleteRecording(recordingId: string, reason: string): Promise<void> {
    try {
      // Check for legal hold
      const metadata = await this.databaseService.getRecordingMetadata(recordingId);
      if (metadata?.retentionPolicy?.legalHold) {
        throw new Error('Cannot delete recording under legal hold');
      }

      // Update status to pending deletion
      await this.databaseService.updateRecordingStatus(
        recordingId,
        RecordingStatus.PENDING_DELETION
      );

      // Delete from storage
      await this.storageProvider.delete(recordingId);

      // Delete transcript if exists
      if (metadata?.transcriptId) {
        await this.databaseService.deleteTranscript(metadata.transcriptId);
      }

      // Delete metadata
      await this.databaseService.deleteRecordingMetadata(recordingId);

      // Audit log
      await this.auditService.logDeletion(recordingId, reason);

      logger.info('Recording deleted', {
        recordingId,
        reason
      });
    } catch (error) {
      logger.error('Failed to delete recording', {
        recordingId,
        reason,
        error
      });

      // Revert status if metadata still exists
      try {
        await this.databaseService.updateRecordingStatus(
          recordingId,
          RecordingStatus.COMPLETED
        );
      } catch {
        // Metadata might already be deleted
      }

      throw error;
    }
  }

  /**
   * Schedule archival for a future date
   */
  async scheduleArchival(recordingId: string, date: Date): Promise<void> {
    const delay = date.getTime() - Date.now();
    if (delay <= 0) {
      await this.archiveRecording(recordingId);
      return;
    }

    await this.queue.add(
      'scheduled-archival',
      {
        type: 'archive',
        recordingId,
        scheduledDate: date
      },
      {
        delay,
        jobId: `archive-${recordingId}-${date.getTime()}`
      }
    );

    logger.info('Archival scheduled', {
      recordingId,
      scheduledDate: date
    });
  }

  /**
   * Schedule deletion for a future date
   */
  async scheduleDeletion(recordingId: string, date: Date): Promise<void> {
    const delay = date.getTime() - Date.now();
    if (delay <= 0) {
      await this.deleteRecording(recordingId, 'Scheduled deletion');
      return;
    }

    await this.queue.add(
      'scheduled-deletion',
      {
        type: 'delete',
        recordingId,
        reason: 'Scheduled deletion',
        scheduledDate: date
      },
      {
        delay,
        jobId: `delete-${recordingId}-${date.getTime()}`
      }
    );

    logger.info('Deletion scheduled', {
      recordingId,
      scheduledDate: date
    });
  }

  /**
   * Apply legal hold to prevent deletion
   */
  async applyLegalHold(recordingId: string, reason: string): Promise<void> {
    try {
      const metadata = await this.databaseService.getRecordingMetadata(recordingId);
      if (!metadata) {
        throw new Error(`Recording ${recordingId} not found`);
      }

      // Update retention policy
      const updatedPolicy: RetentionPolicy = {
        ...metadata.retentionPolicy!,
        legalHold: true,
        complianceFlags: [
          ...(metadata.retentionPolicy?.complianceFlags || []),
          `legal_hold:${reason}`
        ]
      };

      await this.databaseService.updateRetentionPolicy(recordingId, updatedPolicy);

      // Cancel any scheduled deletion
      await this.queue.remove(`delete-${recordingId}-*`);

      // Restore from archive if needed
      if (metadata.status === RecordingStatus.ARCHIVED) {
        await this.storageProvider.restore(recordingId);
        await this.databaseService.updateRecordingStatus(
          recordingId,
          RecordingStatus.COMPLETED
        );
      }

      // Audit log
      await this.auditService.logLegalHold(recordingId, 'apply', reason);

      logger.info('Legal hold applied', {
        recordingId,
        reason
      });
    } catch (error) {
      logger.error('Failed to apply legal hold', {
        recordingId,
        reason,
        error
      });
      throw error;
    }
  }

  /**
   * Remove legal hold
   */
  async removeLegalHold(recordingId: string): Promise<void> {
    try {
      const metadata = await this.databaseService.getRecordingMetadata(recordingId);
      if (!metadata) {
        throw new Error(`Recording ${recordingId} not found`);
      }

      // Update retention policy
      const updatedPolicy: RetentionPolicy = {
        ...metadata.retentionPolicy!,
        legalHold: false,
        complianceFlags: metadata.retentionPolicy?.complianceFlags?.filter(
          flag => !flag.startsWith('legal_hold:')
        ) || []
      };

      await this.databaseService.updateRetentionPolicy(recordingId, updatedPolicy);

      // Re-evaluate retention policy
      await this.enforceRetentionPolicy(recordingId);

      // Audit log
      await this.auditService.logLegalHold(recordingId, 'remove', 'Legal hold removed');

      logger.info('Legal hold removed', {
        recordingId
      });
    } catch (error) {
      logger.error('Failed to remove legal hold', {
        recordingId,
        error
      });
      throw error;
    }
  }

  /**
   * Execute archival operation
   */
  private async executeArchival(recordingId: string, tier: ArchivalTier): Promise<void> {
    await this.storageProvider.archive(recordingId, tier);
    await this.databaseService.updateRecordingStatus(recordingId, RecordingStatus.ARCHIVED);
  }

  /**
   * Execute deletion operation
   */
  private async executeDeletion(recordingId: string, reason: string): Promise<void> {
    await this.deleteRecording(recordingId, reason);
  }

  /**
   * Execute restore operation
   */
  private async executeRestore(recordingId: string): Promise<void> {
    await this.storageProvider.restore(recordingId);
    await this.databaseService.updateRecordingStatus(recordingId, RecordingStatus.COMPLETED);
  }

  /**
   * Check retention for a recording
   */
  private async checkRetention(recordingId: string): Promise<void> {
    await this.enforceRetentionPolicy(recordingId);
  }

  /**
   * Enforce retention policies for all recordings
   */
  private async enforceAllRetentionPolicies(): Promise<void> {
    try {
      const recordings = await this.databaseService.getRecordingsForRetentionCheck(
        config.lifecycle.deletion.batchSize
      );

      for (const recording of recordings) {
        await this.queue.add('retention-check', {
          type: 'retention_check',
          recordingId: recording.id
        });
      }

      logger.info('Retention check queued', {
        count: recordings.length
      });
    } catch (error) {
      logger.error('Failed to enforce retention policies', { error });
    }
  }

  /**
   * Check for recordings eligible for archival
   */
  private async checkArchivalCandidates(): Promise<void> {
    try {
      const candidates = await this.databaseService.getArchivalCandidates(
        config.lifecycle.archival.afterDays,
        config.lifecycle.deletion.batchSize
      );

      for (const candidate of candidates) {
        await this.queue.add('archive-check', {
          type: 'archive',
          recordingId: candidate.id,
          tier: ArchivalTier.COOL
        });
      }

      logger.info('Archival candidates queued', {
        count: candidates.length
      });
    } catch (error) {
      logger.error('Failed to check archival candidates', { error });
    }
  }

  /**
   * Get default retention policy
   */
  private getDefaultRetentionPolicy(): RetentionPolicy {
    return {
      retentionDays: config.lifecycle.retentionDays.recording,
      archivalEnabled: config.lifecycle.archival.enabled,
      archivalAfterDays: config.lifecycle.archival.afterDays,
      legalHold: false
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    // Stop cron jobs
    for (const [name, job] of this.cronJobs) {
      job.stop();
      logger.info('Cron job stopped', { name });
    }

    // Close queue connections
    await this.queue.close();
    await this.scheduler.close();
    await this.worker.close();

    logger.info('Lifecycle management service cleaned up');
  }
}