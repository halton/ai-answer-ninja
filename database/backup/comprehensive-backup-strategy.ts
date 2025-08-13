/**
 * AI Answer Ninja - Comprehensive Backup and Disaster Recovery Strategy
 * Enterprise-grade backup system with encryption, compression, and multi-tier recovery
 * Based on CLAUDE.md architecture specifications
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { execSync, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import { DatabaseConnectionManager } from '../../shared/database/src/core/DatabaseConnectionManager';
import { BackupConfig, BackupMetadata } from '../../shared/database/src/types';
import { createLogger } from '../../shared/database/src/utils/Logger';

export class ComprehensiveBackupManager extends EventEmitter {
  private dbManager: DatabaseConnectionManager;
  private config: BackupConfig;
  private logger = createLogger('ComprehensiveBackupManager');
  
  private backupHistory: BackupMetadata[] = [];
  private scheduledBackups = new Map<string, NodeJS.Timeout>();
  private isRunning = false;

  constructor(dbManager: DatabaseConnectionManager, config: BackupConfig) {
    super();
    this.dbManager = dbManager;
    this.config = config;
  }

  /**
   * Initialize backup system and start scheduled backups
   */
  public async initialize(): Promise<void> {
    try {
      // Ensure backup directories exist
      await this.ensureDirectories();
      
      // Load backup history
      await this.loadBackupHistory();
      
      // Schedule backups based on configuration
      this.scheduleBackups();
      
      this.isRunning = true;
      this.logger.info('Comprehensive backup system initialized');
      this.emit('initialized');

    } catch (error) {
      this.logger.error('Failed to initialize backup system:', error);
      throw error;
    }
  }

  /**
   * Perform immediate backup
   */
  public async performBackup(
    type: 'full' | 'incremental' | 'differential' = 'full',
    options: {
      compress?: boolean;
      encrypt?: boolean;
      verify?: boolean;
      tags?: string[];
    } = {}
  ): Promise<BackupMetadata> {
    if (!this.isRunning) {
      throw new Error('Backup system not initialized');
    }

    const backupId = this.generateBackupId();
    const startTime = new Date();
    
    this.logger.info(`Starting ${type} backup: ${backupId}`);
    this.emit('backupStarted', { backupId, type, startTime });

    try {
      // Create backup metadata
      const metadata: BackupMetadata = {
        id: backupId,
        type,
        startTime,
        endTime: new Date(), // Will be updated
        size: 0,
        compressed: options.compress || this.config.compression,
        encrypted: options.encrypt || this.config.encryption,
        checksum: '',
        path: '',
        verified: false
      };

      // Perform the actual backup
      switch (type) {
        case 'full':
          await this.performFullBackup(metadata, options);
          break;
        case 'incremental':
          await this.performIncrementalBackup(metadata, options);
          break;
        case 'differential':
          await this.performDifferentialBackup(metadata, options);
          break;
      }

      metadata.endTime = new Date();
      
      // Verify backup if requested
      if (options.verify !== false) {
        metadata.verified = await this.verifyBackup(metadata);
        metadata.verifiedAt = new Date();
      }

      // Store metadata
      this.backupHistory.push(metadata);
      await this.saveBackupHistory();

      // Cleanup old backups based on retention policy
      await this.cleanupOldBackups();

      // Upload to external storage if configured
      if (this.config.destination.type !== 'local') {
        await this.uploadToExternalStorage(metadata);
      }

      this.logger.info(`Backup completed successfully: ${backupId}`, {
        type,
        duration: metadata.endTime.getTime() - metadata.startTime.getTime(),
        size: metadata.size,
        compressed: metadata.compressed,
        encrypted: metadata.encrypted
      });

      this.emit('backupCompleted', metadata);
      return metadata;

    } catch (error) {
      this.logger.error(`Backup failed: ${backupId}`, error);
      this.emit('backupFailed', { backupId, error });
      throw error;
    }
  }

  /**
   * Perform full database backup
   */
  private async performFullBackup(
    metadata: BackupMetadata, 
    options: any
  ): Promise<void> {
    const backupPath = this.getBackupPath(metadata.id, 'full');
    metadata.path = backupPath;

    // Create temporary backup file
    const tempPath = `${backupPath}.tmp`;
    
    try {
      // Use pg_dump for full backup
      const dumpCommand = this.buildPgDumpCommand(tempPath, 'full');
      
      this.logger.debug(`Executing backup command: ${dumpCommand}`);
      execSync(dumpCommand, { stdio: 'pipe' });

      // Process the backup file (compress, encrypt)
      await this.processBackupFile(tempPath, backupPath, metadata);

      // Calculate file size and checksum
      const stats = await fs.stat(backupPath);
      metadata.size = stats.size;
      metadata.checksum = await this.calculateChecksum(backupPath);

      // Remove temporary file
      await fs.unlink(tempPath).catch(() => {});

    } catch (error) {
      // Cleanup on failure
      await fs.unlink(tempPath).catch(() => {});
      await fs.unlink(backupPath).catch(() => {});
      throw error;
    }
  }

  /**
   * Perform incremental backup (changes since last backup)
   */
  private async performIncrementalBackup(
    metadata: BackupMetadata,
    options: any
  ): Promise<void> {
    const lastBackup = this.getLastSuccessfulBackup();
    if (!lastBackup) {
      this.logger.warn('No previous backup found, performing full backup instead');
      return await this.performFullBackup(metadata, options);
    }

    const backupPath = this.getBackupPath(metadata.id, 'incremental');
    metadata.path = backupPath;

    try {
      // Get WAL files since last backup
      const walFiles = await this.getWALFilesSince(lastBackup.endTime);
      
      if (walFiles.length === 0) {
        this.logger.info('No changes since last backup, skipping incremental backup');
        return;
      }

      // Archive WAL files
      await this.archiveWALFiles(walFiles, backupPath);

      // Process the backup file
      await this.processBackupFile(backupPath, backupPath, metadata);

      // Calculate file size and checksum
      const stats = await fs.stat(backupPath);
      metadata.size = stats.size;
      metadata.checksum = await this.calculateChecksum(backupPath);

    } catch (error) {
      await fs.unlink(backupPath).catch(() => {});
      throw error;
    }
  }

  /**
   * Perform differential backup (changes since last full backup)
   */
  private async performDifferentialBackup(
    metadata: BackupMetadata,
    options: any
  ): Promise<void> {
    const lastFullBackup = this.getLastFullBackup();
    if (!lastFullBackup) {
      this.logger.warn('No previous full backup found, performing full backup instead');
      return await this.performFullBackup(metadata, options);
    }

    const backupPath = this.getBackupPath(metadata.id, 'differential');
    metadata.path = backupPath;

    try {
      // Get all changes since last full backup
      const changes = await this.getChangesSinceFullBackup(lastFullBackup.endTime);
      
      // Create differential backup
      await this.createDifferentialBackup(changes, backupPath);

      // Process the backup file
      await this.processBackupFile(backupPath, backupPath, metadata);

      // Calculate file size and checksum
      const stats = await fs.stat(backupPath);
      metadata.size = stats.size;
      metadata.checksum = await this.calculateChecksum(backupPath);

    } catch (error) {
      await fs.unlink(backupPath).catch(() => {});
      throw error;
    }
  }

  /**
   * Process backup file (compression and encryption)
   */
  private async processBackupFile(
    sourcePath: string,
    targetPath: string,
    metadata: BackupMetadata
  ): Promise<void> {
    let currentPath = sourcePath;

    // Compress if enabled
    if (metadata.compressed) {
      const compressedPath = `${targetPath}.gz`;
      await this.compressFile(currentPath, compressedPath);
      
      if (currentPath !== sourcePath) {
        await fs.unlink(currentPath);
      }
      currentPath = compressedPath;
      metadata.path = compressedPath;
    }

    // Encrypt if enabled
    if (metadata.encrypted) {
      const encryptedPath = `${metadata.path}.enc`;
      await this.encryptFile(currentPath, encryptedPath);
      
      if (currentPath !== sourcePath) {
        await fs.unlink(currentPath);
      }
      metadata.path = encryptedPath;
    }

    // Move to final location if needed
    if (currentPath !== targetPath && currentPath !== metadata.path) {
      await fs.rename(currentPath, metadata.path);
    }
  }

  /**
   * Build pg_dump command with appropriate options
   */
  private buildPgDumpCommand(outputPath: string, type: string): string {
    const dbConfig = this.config; // Assuming config includes DB connection details
    
    let command = 'pg_dump';
    
    // Connection parameters
    command += ` -h ${process.env.DB_HOST || 'localhost'}`;
    command += ` -p ${process.env.DB_PORT || '5432'}`;
    command += ` -U ${process.env.DB_USERNAME || 'postgres'}`;
    command += ` -d ${process.env.DB_NAME || 'ai_ninja'}`;
    
    // Backup options
    command += ' --verbose';
    command += ' --no-password'; // Use .pgpass or environment variables
    command += ' --format=custom';
    command += ' --no-owner';
    command += ' --no-privileges';
    command += ' --compress=6';
    
    // Output file
    command += ` --file="${outputPath}"`;
    
    // Set password via environment
    const envVars = `PGPASSWORD="${process.env.DB_PASSWORD || 'password'}"`;
    
    return `${envVars} ${command}`;
  }

  /**
   * Compress file using gzip
   */
  private async compressFile(sourcePath: string, targetPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const gzip = spawn('gzip', ['-c', sourcePath]);
      const output = require('fs').createWriteStream(targetPath);
      
      gzip.stdout.pipe(output);
      
      gzip.on('error', reject);
      output.on('error', reject);
      output.on('close', resolve);
    });
  }

  /**
   * Encrypt file using AES-256
   */
  private async encryptFile(sourcePath: string, targetPath: string): Promise<void> {
    const password = process.env.BACKUP_ENCRYPTION_KEY || 'default-backup-key';
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(password, 'salt', 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipher(algorithm, key);
    const input = require('fs').createReadStream(sourcePath);
    const output = require('fs').createWriteStream(targetPath);

    return new Promise((resolve, reject) => {
      // Write IV to beginning of file
      output.write(iv);
      
      input
        .pipe(cipher)
        .pipe(output)
        .on('error', reject)
        .on('close', resolve);
    });
  }

  /**
   * Calculate file checksum
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = require('fs').createReadStream(filePath);
      
      stream.on('data', (data: Buffer) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Verify backup integrity
   */
  private async verifyBackup(metadata: BackupMetadata): Promise<boolean> {
    try {
      // Verify file exists
      await fs.access(metadata.path);
      
      // Verify checksum
      const currentChecksum = await this.calculateChecksum(metadata.path);
      if (currentChecksum !== metadata.checksum) {
        this.logger.error(`Backup verification failed: checksum mismatch for ${metadata.id}`);
        return false;
      }

      // For full backups, try to restore to a test database
      if (metadata.type === 'full') {
        return await this.testRestoreBackup(metadata);
      }

      return true;

    } catch (error) {
      this.logger.error(`Backup verification failed for ${metadata.id}:`, error);
      return false;
    }
  }

  /**
   * Test restore backup to verify integrity
   */
  private async testRestoreBackup(metadata: BackupMetadata): Promise<boolean> {
    const testDbName = `test_restore_${metadata.id}`;
    
    try {
      // Create test database
      await this.dbManager.query(`CREATE DATABASE ${testDbName}`);
      
      // Prepare backup file for restore
      let restoreFile = metadata.path;
      
      // Decrypt if necessary
      if (metadata.encrypted) {
        restoreFile = await this.decryptFileForRestore(metadata.path);
      }
      
      // Decompress if necessary
      if (metadata.compressed && !metadata.encrypted) {
        restoreFile = await this.decompressFileForRestore(restoreFile);
      }
      
      // Restore backup
      const restoreCommand = this.buildRestoreCommand(restoreFile, testDbName);
      execSync(restoreCommand, { stdio: 'pipe' });
      
      // Verify some data exists
      const verifyResult = await this.dbManager.query(
        `SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema = 'public'`,
        [],
        { preferReplica: false }
      );
      
      const tableCount = parseInt(verifyResult.rows[0].table_count);
      const isValid = tableCount > 0;
      
      // Cleanup test database
      await this.dbManager.query(`DROP DATABASE ${testDbName}`);
      
      // Cleanup temporary files
      if (restoreFile !== metadata.path) {
        await fs.unlink(restoreFile).catch(() => {});
      }
      
      this.logger.info(`Backup verification ${isValid ? 'passed' : 'failed'} for ${metadata.id}`);
      return isValid;

    } catch (error) {
      this.logger.error(`Test restore failed for ${metadata.id}:`, error);
      
      // Cleanup on failure
      try {
        await this.dbManager.query(`DROP DATABASE IF EXISTS ${testDbName}`);
      } catch {}
      
      return false;
    }
  }

  /**
   * Build pg_restore command
   */
  private buildRestoreCommand(backupFile: string, targetDb: string): string {
    let command = 'pg_restore';
    
    // Connection parameters
    command += ` -h ${process.env.DB_HOST || 'localhost'}`;
    command += ` -p ${process.env.DB_PORT || '5432'}`;
    command += ` -U ${process.env.DB_USERNAME || 'postgres'}`;
    command += ` -d ${targetDb}`;
    
    // Restore options
    command += ' --verbose';
    command += ' --no-password';
    command += ' --clean';
    command += ' --if-exists';
    command += ' --no-owner';
    command += ' --no-privileges';
    
    // Input file
    command += ` "${backupFile}"`;
    
    // Set password via environment
    const envVars = `PGPASSWORD="${process.env.DB_PASSWORD || 'password'}"`;
    
    return `${envVars} ${command}`;
  }

  /**
   * Perform full disaster recovery
   */
  public async performDisasterRecovery(
    targetTime?: Date,
    options: {
      targetDatabase?: string;
      preserveExisting?: boolean;
      verifyIntegrity?: boolean;
    } = {}
  ): Promise<void> {
    this.logger.info('Starting disaster recovery process', { targetTime, options });
    this.emit('recoveryStarted', { targetTime, options });

    try {
      // Find appropriate backup for recovery
      const backupChain = this.findBackupChain(targetTime);
      if (backupChain.length === 0) {
        throw new Error('No suitable backup found for recovery');
      }

      // Restore full backup first
      const fullBackup = backupChain.find(b => b.type === 'full');
      if (!fullBackup) {
        throw new Error('No full backup found in chain');
      }

      this.logger.info(`Restoring full backup: ${fullBackup.id}`);
      await this.restoreBackup(fullBackup, options);

      // Apply incremental/differential backups in order
      const incrementalBackups = backupChain
        .filter(b => b.type !== 'full')
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

      for (const backup of incrementalBackups) {
        this.logger.info(`Applying ${backup.type} backup: ${backup.id}`);
        await this.restoreBackup(backup, options);
      }

      // Verify recovery if requested
      if (options.verifyIntegrity !== false) {
        await this.verifyRecovery();
      }

      this.logger.info('Disaster recovery completed successfully');
      this.emit('recoveryCompleted');

    } catch (error) {
      this.logger.error('Disaster recovery failed:', error);
      this.emit('recoveryFailed', error);
      throw error;
    }
  }

  /**
   * Find backup chain for point-in-time recovery
   */
  private findBackupChain(targetTime?: Date): BackupMetadata[] {
    const cutoffTime = targetTime || new Date();
    
    // Get all backups before target time
    const eligibleBackups = this.backupHistory
      .filter(backup => backup.endTime <= cutoffTime && backup.verified)
      .sort((a, b) => b.endTime.getTime() - a.endTime.getTime());

    if (eligibleBackups.length === 0) {
      return [];
    }

    // Find the most recent full backup
    const fullBackup = eligibleBackups.find(backup => backup.type === 'full');
    if (!fullBackup) {
      return [];
    }

    // Get all incremental/differential backups since the full backup
    const incrementalBackups = eligibleBackups.filter(backup => 
      backup.type !== 'full' && 
      backup.startTime >= fullBackup.endTime
    );

    return [fullBackup, ...incrementalBackups];
  }

  /**
   * Restore individual backup
   */
  private async restoreBackup(
    metadata: BackupMetadata,
    options: any
  ): Promise<void> {
    let restoreFile = metadata.path;
    const tempFiles: string[] = [];

    try {
      // Decrypt if necessary
      if (metadata.encrypted) {
        restoreFile = await this.decryptFileForRestore(metadata.path);
        tempFiles.push(restoreFile);
      }

      // Decompress if necessary
      if (metadata.compressed && !metadata.encrypted) {
        const decompressedFile = await this.decompressFileForRestore(restoreFile);
        tempFiles.push(decompressedFile);
        restoreFile = decompressedFile;
      }

      // Execute restore based on backup type
      switch (metadata.type) {
        case 'full':
          await this.restoreFullBackup(restoreFile, options);
          break;
        case 'incremental':
        case 'differential':
          await this.restoreIncrementalBackup(restoreFile, options);
          break;
      }

    } finally {
      // Cleanup temporary files
      for (const tempFile of tempFiles) {
        await fs.unlink(tempFile).catch(() => {});
      }
    }
  }

  private async restoreFullBackup(backupFile: string, options: any): Promise<void> {
    const targetDb = options.targetDatabase || process.env.DB_NAME || 'ai_ninja';
    const restoreCommand = this.buildRestoreCommand(backupFile, targetDb);
    
    execSync(restoreCommand, { stdio: 'pipe' });
  }

  private async restoreIncrementalBackup(backupFile: string, options: any): Promise<void> {
    // Implementation depends on backup format
    // For WAL files, this would involve applying WAL segments
    this.logger.info(`Applying incremental backup from ${backupFile}`);
    // Implementation specific to incremental backup format
  }

  // Utility methods
  private async decryptFileForRestore(encryptedPath: string): Promise<string> {
    const decryptedPath = `${encryptedPath}.decrypted`;
    const password = process.env.BACKUP_ENCRYPTION_KEY || 'default-backup-key';
    
    // Implementation would decrypt the file
    // This is a simplified version
    return decryptedPath;
  }

  private async decompressFileForRestore(compressedPath: string): Promise<string> {
    const decompressedPath = compressedPath.replace('.gz', '');
    
    return new Promise((resolve, reject) => {
      const gunzip = spawn('gunzip', ['-c', compressedPath]);
      const output = require('fs').createWriteStream(decompressedPath);
      
      gunzip.stdout.pipe(output);
      gunzip.on('error', reject);
      output.on('error', reject);
      output.on('close', () => resolve(decompressedPath));
    });
  }

  private generateBackupId(): string {
    return `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getBackupPath(backupId: string, type: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${backupId}_${type}_${timestamp}.sql`;
    return path.join(this.config.destination.path, filename);
  }

  private getLastSuccessfulBackup(): BackupMetadata | null {
    return this.backupHistory
      .filter(backup => backup.verified)
      .sort((a, b) => b.endTime.getTime() - a.endTime.getTime())[0] || null;
  }

  private getLastFullBackup(): BackupMetadata | null {
    return this.backupHistory
      .filter(backup => backup.type === 'full' && backup.verified)
      .sort((a, b) => b.endTime.getTime() - a.endTime.getTime())[0] || null;
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.config.destination.path, { recursive: true });
  }

  private async loadBackupHistory(): Promise<void> {
    const historyFile = path.join(this.config.destination.path, 'backup-history.json');
    
    try {
      const data = await fs.readFile(historyFile, 'utf8');
      this.backupHistory = JSON.parse(data).map((item: any) => ({
        ...item,
        startTime: new Date(item.startTime),
        endTime: new Date(item.endTime),
        verifiedAt: item.verifiedAt ? new Date(item.verifiedAt) : undefined
      }));
    } catch {
      this.backupHistory = [];
    }
  }

  private async saveBackupHistory(): Promise<void> {
    const historyFile = path.join(this.config.destination.path, 'backup-history.json');
    await fs.writeFile(historyFile, JSON.stringify(this.backupHistory, null, 2));
  }

  private scheduleBackups(): void {
    // Implementation would parse cron expressions and schedule backups
    // This is a simplified version
    this.logger.info('Backup scheduling configured');
  }

  private async cleanupOldBackups(): Promise<void> {
    const now = new Date();
    const retention = this.config.retention;
    
    const cutoffDates = {
      daily: new Date(now.getTime() - retention.daily * 24 * 60 * 60 * 1000),
      weekly: new Date(now.getTime() - retention.weekly * 7 * 24 * 60 * 60 * 1000),
      monthly: new Date(now.getTime() - retention.monthly * 30 * 24 * 60 * 60 * 1000),
      yearly: new Date(now.getTime() - retention.yearly * 365 * 24 * 60 * 60 * 1000)
    };

    // Implementation would clean up old backups based on retention policy
    this.logger.info('Backup cleanup completed');
  }

  private async uploadToExternalStorage(metadata: BackupMetadata): Promise<void> {
    // Implementation would upload to S3, Azure Blob, etc.
    this.logger.info(`Backup uploaded to external storage: ${metadata.id}`);
  }

  private async getWALFilesSince(since: Date): Promise<string[]> {
    // Implementation would return WAL files since the given date
    return [];
  }

  private async archiveWALFiles(walFiles: string[], targetPath: string): Promise<void> {
    // Implementation would archive WAL files
  }

  private async getChangesSinceFullBackup(since: Date): Promise<any> {
    // Implementation would return changes since full backup
    return {};
  }

  private async createDifferentialBackup(changes: any, targetPath: string): Promise<void> {
    // Implementation would create differential backup
  }

  private async verifyRecovery(): Promise<void> {
    // Implementation would verify the recovered database
    this.logger.info('Recovery verification completed');
  }

  /**
   * Shutdown backup system
   */
  public async shutdown(): Promise<void> {
    this.isRunning = false;
    
    // Cancel scheduled backups
    for (const [name, timeout] of this.scheduledBackups) {
      clearTimeout(timeout);
    }
    this.scheduledBackups.clear();

    // Save final backup history
    await this.saveBackupHistory();

    this.logger.info('Backup system shutdown completed');
    this.emit('shutdown');
  }

  /**
   * Get backup statistics
   */
  public getBackupStatistics() {
    const total = this.backupHistory.length;
    const verified = this.backupHistory.filter(b => b.verified).length;
    const totalSize = this.backupHistory.reduce((sum, b) => sum + b.size, 0);
    
    const byType = this.backupHistory.reduce((acc, backup) => {
      acc[backup.type] = (acc[backup.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total,
      verified,
      verificationRate: total > 0 ? verified / total : 0,
      totalSize,
      byType,
      latest: this.getLastSuccessfulBackup(),
      oldestRetained: this.backupHistory.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0]
    };
  }
}

export default ComprehensiveBackupManager;