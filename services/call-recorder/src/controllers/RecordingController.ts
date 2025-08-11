import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { RecordingService } from '../services/RecordingService';
import { StreamingService } from '../services/streaming/StreamingService';
import { GDPRService } from '../services/compliance/GDPRService';
import { logger } from '../utils/logger';
import { validateRequest } from '../middleware/validation';
import {
  RecordingStatus,
  RecordingFilters,
  StreamingOptions,
  ConsentUpdate
} from '../types';

export class RecordingController {
  private recordingService: RecordingService;
  private streamingService: StreamingService;
  private gdprService: GDPRService;
  private upload: multer.Multer;

  constructor(
    recordingService: RecordingService,
    streamingService: StreamingService,
    gdprService: GDPRService
  ) {
    this.recordingService = recordingService;
    this.streamingService = streamingService;
    this.gdprService = gdprService;

    // Configure multer for file uploads
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: config.storage.maxFileSize
      },
      fileFilter: (req, file, cb) => {
        const ext = file.originalname.split('.').pop()?.toLowerCase();
        if (ext && config.storage.allowedFormats.includes(ext)) {
          cb(null, true);
        } else {
          cb(new Error(`Invalid file format. Allowed: ${config.storage.allowedFormats.join(', ')}`));
        }
      }
    });
  }

  /**
   * Upload a new recording
   */
  uploadRecording = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uploadHandler = this.upload.single('audio');
      
      uploadHandler(req, res, async (err) => {
        if (err) {
          logger.error('Upload error', { error: err.message });
          res.status(400).json({ error: err.message });
          return;
        }

        if (!req.file) {
          res.status(400).json({ error: 'No audio file provided' });
          return;
        }

        const { callId, callerPhone, receiverPhone, startTime, endTime } = req.body;
        const userId = req.user?.id;

        if (!userId || !callId) {
          res.status(400).json({ error: 'Missing required fields' });
          return;
        }

        // Create recording metadata
        const recordingId = uuidv4();
        const metadata = {
          id: recordingId,
          callId,
          userId,
          callerPhone,
          receiverPhone,
          startTime: new Date(startTime),
          endTime: endTime ? new Date(endTime) : undefined,
          format: req.file.originalname.split('.').pop() || 'unknown',
          status: RecordingStatus.PROCESSING
        };

        // Process and store recording
        const result = await this.recordingService.createRecording(
          req.file.buffer,
          metadata
        );

        // Log audit
        await this.recordingService.auditLog({
          userId,
          action: 'upload',
          resourceId: recordingId,
          result: 'success'
        });

        res.status(201).json({
          success: true,
          recordingId: result.id,
          status: result.status,
          location: result.location,
          message: 'Recording uploaded successfully'
        });
      });
    } catch (error) {
      logger.error('Failed to upload recording', { error });
      next(error);
    }
  };

  /**
   * Get recording metadata
   */
  getRecording = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { recordingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Check access permission
      const hasAccess = await this.recordingService.checkAccess(userId, recordingId, 'read');
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const metadata = await this.recordingService.getRecordingMetadata(recordingId);
      
      if (!metadata) {
        res.status(404).json({ error: 'Recording not found' });
        return;
      }

      res.json({
        success: true,
        recording: metadata
      });
    } catch (error) {
      logger.error('Failed to get recording', { error });
      next(error);
    }
  };

  /**
   * List recordings with filters
   */
  listRecordings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const filters: RecordingFilters = {
        userId,
        callId: req.query.callId as string,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        status: req.query.status as RecordingStatus,
        limit: parseInt(req.query.limit as string) || 50,
        offset: parseInt(req.query.offset as string) || 0
      };

      const recordings = await this.recordingService.listRecordings(filters);

      res.json({
        success: true,
        recordings,
        count: recordings.length,
        filters
      });
    } catch (error) {
      logger.error('Failed to list recordings', { error });
      next(error);
    }
  };

  /**
   * Download recording file
   */
  downloadRecording = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { recordingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Check access permission
      const hasAccess = await this.recordingService.checkAccess(userId, recordingId, 'download');
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Get recording data
      const { data, metadata } = await this.recordingService.downloadRecording(recordingId);

      // Log audit
      await this.recordingService.auditLog({
        userId,
        action: 'download',
        resourceId: recordingId,
        result: 'success'
      });

      // Set response headers
      res.setHeader('Content-Type', `audio/${metadata.format}`);
      res.setHeader('Content-Length', data.length.toString());
      res.setHeader('Content-Disposition', `attachment; filename="${recordingId}.${metadata.format}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      res.send(data);
    } catch (error) {
      logger.error('Failed to download recording', { error });
      next(error);
    }
  };

  /**
   * Stream recording for playback
   */
  streamRecording = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { recordingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Check access permission
      const hasAccess = await this.recordingService.checkAccess(userId, recordingId, 'stream');
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const options: StreamingOptions = {
        format: req.query.format as string,
        quality: req.query.quality as 'low' | 'medium' | 'high' | 'original',
        startTime: req.query.start ? parseInt(req.query.start as string) : undefined,
        endTime: req.query.end ? parseInt(req.query.end as string) : undefined,
        seekable: req.query.seekable === 'true'
      };

      // Create streaming response
      const stream = await this.streamingService.createStream(recordingId, options);

      // Log audit
      await this.recordingService.auditLog({
        userId,
        action: 'stream',
        resourceId: recordingId,
        result: 'success'
      });

      // Set streaming headers
      res.setHeader('Content-Type', `audio/${options.format || 'mpeg'}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Handle range requests for seekable streams
      if (options.seekable && req.headers.range) {
        const range = this.parseRange(req.headers.range);
        if (range) {
          res.status(206); // Partial Content
          res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/*`);
        }
      }

      // Pipe stream to response
      stream.pipe(res);

      // Handle stream errors
      stream.on('error', (error) => {
        logger.error('Streaming error', { recordingId, error });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Streaming failed' });
        }
      });

    } catch (error) {
      logger.error('Failed to stream recording', { error });
      next(error);
    }
  };

  /**
   * Get playback URL with presigned access
   */
  getPlaybackUrl = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { recordingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Check access permission
      const hasAccess = await this.recordingService.checkAccess(userId, recordingId, 'stream');
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const expirySeconds = parseInt(req.query.expiry as string) || 3600;
      const url = await this.recordingService.getPlaybackUrl(recordingId, expirySeconds);

      res.json({
        success: true,
        url,
        expiresIn: expirySeconds
      });
    } catch (error) {
      logger.error('Failed to get playback URL', { error });
      next(error);
    }
  };

  /**
   * Delete recording
   */
  deleteRecording = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { recordingId } = req.params;
      const userId = req.user?.id;
      const { reason } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Check access permission
      const hasAccess = await this.recordingService.checkAccess(userId, recordingId, 'delete');
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      await this.recordingService.deleteRecording(recordingId, reason || 'User requested');

      // Log audit
      await this.recordingService.auditLog({
        userId,
        action: 'delete',
        resourceId: recordingId,
        result: 'success',
        details: { reason }
      });

      res.json({
        success: true,
        message: 'Recording deleted successfully'
      });
    } catch (error) {
      logger.error('Failed to delete recording', { error });
      next(error);
    }
  };

  /**
   * Get recording transcript
   */
  getTranscript = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { recordingId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Check access permission
      const hasAccess = await this.recordingService.checkAccess(userId, recordingId, 'read');
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const transcript = await this.recordingService.getTranscript(recordingId);
      
      if (!transcript) {
        res.status(404).json({ error: 'Transcript not found' });
        return;
      }

      res.json({
        success: true,
        transcript
      });
    } catch (error) {
      logger.error('Failed to get transcript', { error });
      next(error);
    }
  };

  /**
   * GDPR: Export user data
   */
  exportUserData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const format = (req.query.format as 'json' | 'csv' | 'xml') || 'json';
      const exportData = await this.gdprService.exportUserData(userId, format);

      // Log audit
      await this.recordingService.auditLog({
        userId,
        action: 'gdpr_export',
        resourceId: userId,
        result: 'success'
      });

      // Set response headers based on format
      const contentType = {
        json: 'application/json',
        csv: 'text/csv',
        xml: 'application/xml'
      }[format];

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="user-data-${userId}.${format}"`);

      res.send(exportData);
    } catch (error) {
      logger.error('Failed to export user data', { error });
      next(error);
    }
  };

  /**
   * GDPR: Delete user data
   */
  deleteUserData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const deletionReport = await this.gdprService.deleteUserData(userId);

      // Log audit
      await this.recordingService.auditLog({
        userId,
        action: 'gdpr_delete',
        resourceId: userId,
        result: 'success',
        details: deletionReport
      });

      res.json({
        success: true,
        report: deletionReport
      });
    } catch (error) {
      logger.error('Failed to delete user data', { error });
      next(error);
    }
  };

  /**
   * Update consent preferences
   */
  updateConsent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const consent: ConsentUpdate = req.body;
      await this.gdprService.updateConsent(userId, consent);

      res.json({
        success: true,
        message: 'Consent preferences updated'
      });
    } catch (error) {
      logger.error('Failed to update consent', { error });
      next(error);
    }
  };

  /**
   * Parse range header for partial content requests
   */
  private parseRange(rangeHeader: string): { start: number; end: number } | null {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      return {
        start: parseInt(match[1]),
        end: match[2] ? parseInt(match[2]) : -1
      };
    }
    return null;
  }
}