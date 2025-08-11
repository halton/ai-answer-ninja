export interface AudioMetadata {
  format: string;
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  duration?: number;
  size: number;
}

export interface EncryptionMetadata {
  algorithm: string;
  keyVersion: string;
  iv: string;
  authTag?: string;
  salt?: string;
  encryptedAt: Date;
}

export interface RecordingMetadata {
  id: string;
  callId: string;
  userId: string;
  callerPhone: string;
  receiverPhone: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  fileSize?: number;
  format: string;
  storageLocation: string;
  storageProvider: 'azure' | 'aws' | 'local';
  encryptionMetadata?: EncryptionMetadata;
  audioMetadata?: AudioMetadata;
  transcriptId?: string;
  status: RecordingStatus;
  retentionPolicy?: RetentionPolicy;
  tags?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export enum RecordingStatus {
  RECORDING = 'recording',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ARCHIVED = 'archived',
  DELETED = 'deleted',
  PENDING_DELETION = 'pending_deletion'
}

export interface RetentionPolicy {
  retentionDays: number;
  archivalEnabled: boolean;
  archivalAfterDays?: number;
  deletionDate?: Date;
  legalHold?: boolean;
  complianceFlags?: string[];
}

export interface StorageProvider {
  upload(file: Buffer, metadata: RecordingMetadata): Promise<StorageResult>;
  download(recordingId: string): Promise<Buffer>;
  delete(recordingId: string): Promise<void>;
  getPresignedUrl(recordingId: string, expirySeconds?: number): Promise<string>;
  archive(recordingId: string, tier: ArchivalTier): Promise<void>;
  restore(recordingId: string): Promise<void>;
  listRecordings(filters?: RecordingFilters): Promise<RecordingMetadata[]>;
}

export interface StorageResult {
  location: string;
  url?: string;
  etag?: string;
  versionId?: string;
  size: number;
  contentType: string;
}

export enum ArchivalTier {
  HOT = 'hot',
  COOL = 'cool',
  COLD = 'cold',
  ARCHIVE = 'archive'
}

export interface RecordingFilters {
  userId?: string;
  callId?: string;
  startDate?: Date;
  endDate?: Date;
  status?: RecordingStatus;
  tags?: Record<string, string>;
  limit?: number;
  offset?: number;
}

export interface AudioProcessor {
  compress(input: Buffer, options: CompressionOptions): Promise<Buffer>;
  convert(input: Buffer, targetFormat: string): Promise<Buffer>;
  extractMetadata(input: Buffer): Promise<AudioMetadata>;
  normalize(input: Buffer): Promise<Buffer>;
  removeNoise(input: Buffer): Promise<Buffer>;
  splitChannels(input: Buffer): Promise<{ left: Buffer; right: Buffer }>;
  mergeChannels(left: Buffer, right: Buffer): Promise<Buffer>;
}

export interface CompressionOptions {
  format: string;
  codec?: string;
  bitrate?: string;
  quality?: number;
  sampleRate?: number;
  channels?: number;
}

export interface EncryptionService {
  encrypt(data: Buffer, userId: string): Promise<EncryptedData>;
  decrypt(encryptedData: EncryptedData, userId: string): Promise<Buffer>;
  generateKey(userId: string): Promise<string>;
  rotateKey(userId: string): Promise<void>;
  validateIntegrity(data: EncryptedData): Promise<boolean>;
}

export interface EncryptedData {
  data: Buffer;
  metadata: EncryptionMetadata;
  checksum: string;
}

export interface StreamingOptions {
  format?: string;
  startTime?: number;
  endTime?: number;
  quality?: 'low' | 'medium' | 'high' | 'original';
  seekable?: boolean;
}

export interface PlaybackService {
  streamRecording(recordingId: string, options?: StreamingOptions): NodeJS.ReadableStream;
  getPlaybackUrl(recordingId: string, options?: StreamingOptions): Promise<string>;
  generateWaveform(recordingId: string): Promise<number[]>;
  getTranscript(recordingId: string): Promise<TranscriptData>;
}

export interface TranscriptData {
  id: string;
  recordingId: string;
  text: string;
  language: string;
  confidence?: number;
  timestamps?: TranscriptTimestamp[];
  speakers?: SpeakerData[];
}

export interface TranscriptTimestamp {
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

export interface SpeakerData {
  id: string;
  name?: string;
  segments: TranscriptTimestamp[];
}

export interface LifecycleManager {
  enforceRetentionPolicy(recordingId: string): Promise<void>;
  archiveRecording(recordingId: string): Promise<void>;
  deleteRecording(recordingId: string, reason: string): Promise<void>;
  scheduleArchival(recordingId: string, date: Date): Promise<void>;
  scheduleDeletion(recordingId: string, date: Date): Promise<void>;
  applyLegalHold(recordingId: string, reason: string): Promise<void>;
  removeLegalHold(recordingId: string): Promise<void>;
}

export interface AuditLog {
  id: string;
  timestamp: Date;
  userId: string;
  action: AuditAction;
  resourceId: string;
  resourceType: 'recording' | 'transcript' | 'metadata';
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  result: 'success' | 'failure';
  errorMessage?: string;
}

export enum AuditAction {
  UPLOAD = 'upload',
  DOWNLOAD = 'download',
  STREAM = 'stream',
  DELETE = 'delete',
  ARCHIVE = 'archive',
  RESTORE = 'restore',
  ENCRYPT = 'encrypt',
  DECRYPT = 'decrypt',
  ACCESS_DENIED = 'access_denied',
  METADATA_UPDATE = 'metadata_update',
  LEGAL_HOLD = 'legal_hold',
  GDPR_REQUEST = 'gdpr_request'
}

export interface AccessControl {
  checkPermission(userId: string, recordingId: string, action: string): Promise<boolean>;
  grantAccess(userId: string, recordingId: string, permissions: string[]): Promise<void>;
  revokeAccess(userId: string, recordingId: string): Promise<void>;
  getAccessList(recordingId: string): Promise<AccessEntry[]>;
}

export interface AccessEntry {
  userId: string;
  permissions: string[];
  grantedAt: Date;
  grantedBy: string;
  expiresAt?: Date;
}

export interface GDPRCompliance {
  exportUserData(userId: string): Promise<UserDataExport>;
  anonymizeUserData(userId: string): Promise<void>;
  deleteUserData(userId: string): Promise<DeletionReport>;
  getConsentStatus(userId: string): Promise<ConsentStatus>;
  updateConsent(userId: string, consent: ConsentUpdate): Promise<void>;
}

export interface UserDataExport {
  userId: string;
  exportDate: Date;
  recordings: RecordingMetadata[];
  transcripts: TranscriptData[];
  metadata: Record<string, any>;
  format: 'json' | 'csv' | 'xml';
}

export interface DeletionReport {
  userId: string;
  deletionDate: Date;
  recordingsDeleted: number;
  transcriptsDeleted: number;
  metadataDeleted: number;
  verificationHash: string;
}

export interface ConsentStatus {
  userId: string;
  recordingConsent: boolean;
  transcriptionConsent: boolean;
  analyticsConsent: boolean;
  retentionConsent: boolean;
  consentDate?: Date;
  withdrawalDate?: Date;
}

export interface ConsentUpdate {
  recordingConsent?: boolean;
  transcriptionConsent?: boolean;
  analyticsConsent?: boolean;
  retentionConsent?: boolean;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  components: {
    storage: ComponentHealth;
    database: ComponentHealth;
    redis: ComponentHealth;
    queue: ComponentHealth;
    ffmpeg: ComponentHealth;
  };
  metrics?: {
    uptime: number;
    requestsPerMinute: number;
    averageResponseTime: number;
    errorRate: number;
  };
}

export interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency?: number;
  error?: string;
  lastCheck: Date;
}