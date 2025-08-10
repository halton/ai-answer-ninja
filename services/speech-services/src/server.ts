import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer } from 'http';
import { SERVICE_INFO, validateConfig } from './config';
import logger from './utils/logger';
import WebSocketHandler from './services/websocketHandler';
import AzureSTTService from './services/azureSTT';
import AzureTTSService from './services/azureTTS';
import IntelligentCacheService from './cache/intelligentCache';
import PerformanceMonitor from './services/performanceMonitor';
import { SpeechServiceError, ErrorCode, HealthStatus } from './types';

// Validate configuration on startup
validateConfig();

// Create Express app
const app: Express = express();
const server = createServer(app);

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      ip: req.ip,
    });
  });
  
  next();
});

// Initialize WebSocket handler
const wsHandler = new WebSocketHandler(server);

// API Routes

// Health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  try {
    const health: HealthStatus = {
      service: SERVICE_INFO.name,
      status: 'healthy',
      timestamp: Date.now(),
      latency: {
        stt: 0,
        tts: 0,
      },
      errors: 0,
      uptime: process.uptime(),
      dependencies: {
        azure: true,
        redis: true,
      },
    };

    // Check STT service
    try {
      const testAudio = Buffer.alloc(1600); // 100ms of silence
      const sttStart = Date.now();
      await AzureSTTService.recognizeOnce(testAudio);
      health.latency.stt = Date.now() - sttStart;
    } catch (error) {
      health.dependencies.azure = false;
      health.status = 'degraded';
    }

    // Check TTS service
    try {
      const ttsStart = Date.now();
      await AzureTTSService.synthesize('test');
      health.latency.tts = Date.now() - ttsStart;
    } catch (error) {
      health.dependencies.azure = false;
      health.status = 'degraded';
    }

    // Check cache service
    try {
      await IntelligentCacheService.getSTTCache('test');
    } catch (error) {
      health.dependencies.redis = false;
      health.status = 'degraded';
    }

    res.json(health);
  } catch (error) {
    res.status(500).json({
      service: SERVICE_INFO.name,
      status: 'unhealthy',
      error: (error as Error).message,
    });
  }
});

// Service info endpoint
app.get('/info', (req: Request, res: Response) => {
  res.json({
    ...SERVICE_INFO,
    connections: wsHandler.getStats(),
    cache: IntelligentCacheService.getStats(),
    metrics: Object.fromEntries(PerformanceMonitor.getMetrics()),
  });
});

// STT endpoint (for one-shot recognition)
app.post('/api/stt', async (req: Request, res: Response, next: NextFunction) => {
  const operationId = `stt_${Date.now()}`;
  PerformanceMonitor.startOperation(operationId);

  try {
    const { audio, format, language } = req.body;
    
    if (!audio) {
      throw new SpeechServiceError(
        'Audio data is required',
        ErrorCode.INVALID_CONFIG,
        400
      );
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audio, 'base64');
    
    // Check cache
    const audioHash = IntelligentCacheService.calculateAudioHash(audioBuffer);
    let result = await IntelligentCacheService.getSTTCache(audioHash);
    
    if (!result) {
      // Perform recognition
      result = await AzureSTTService.recognizeOnce(audioBuffer, { language });
      
      // Cache result
      await IntelligentCacheService.setSTTCache(audioHash, result);
    }

    PerformanceMonitor.endOperation(operationId, 'stt', true);
    res.json(result);
  } catch (error) {
    PerformanceMonitor.endOperation(operationId, 'stt', false);
    PerformanceMonitor.recordError('stt', error as Error);
    next(error);
  }
});

// TTS endpoint
app.post('/api/tts', async (req: Request, res: Response, next: NextFunction) => {
  const operationId = `tts_${Date.now()}`;
  PerformanceMonitor.startOperation(operationId);

  try {
    const { text, voice, language, format } = req.body;
    
    if (!text) {
      throw new SpeechServiceError(
        'Text is required',
        ErrorCode.INVALID_CONFIG,
        400
      );
    }

    // Check cache
    let result = await IntelligentCacheService.getTTSCache(text, voice || 'default');
    
    if (!result) {
      // Perform synthesis
      result = await AzureTTSService.synthesize(text, {
        voiceName: voice,
        language,
        outputFormat: format,
      });
      
      // Cache result
      await IntelligentCacheService.setTTSCache(text, voice || 'default', result);
    }

    PerformanceMonitor.endOperation(operationId, 'tts', true, {
      cached: result.cached,
      voice,
    });

    // Return audio as base64
    res.json({
      audio: result.audioData.toString('base64'),
      duration: result.duration,
      format: result.format,
      cached: result.cached,
    });
  } catch (error) {
    PerformanceMonitor.endOperation(operationId, 'tts', false);
    PerformanceMonitor.recordError('tts', error as Error);
    next(error);
  }
});

// Get available voices
app.get('/api/voices', async (req: Request, res: Response) => {
  const { locale } = req.query;
  const voices = AzureTTSService.getAvailableVoices(locale as string);
  res.json(voices);
});

// Pre-generate response
app.post('/api/pregenerate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { intent, text, voice, language } = req.body;
    
    if (!intent || !text) {
      throw new SpeechServiceError(
        'Intent and text are required',
        ErrorCode.INVALID_CONFIG,
        400
      );
    }

    // Generate audio
    const result = await AzureTTSService.synthesize(text, {
      voiceName: voice,
      language,
    });

    // Store as pre-generated response
    await IntelligentCacheService.addPreGeneratedResponse(intent, {
      intent,
      text,
      audioData: result.audioData,
      voiceName: voice || 'default',
      language: language || 'zh-CN',
      createdAt: new Date(),
      usage: 0,
    });

    res.json({ success: true, intent });
  } catch (error) {
    next(error);
  }
});

// Get metrics
app.get('/api/metrics', (req: Request, res: Response) => {
  const metrics = PerformanceMonitor.getMetrics();
  const latencyReport = PerformanceMonitor.getLatencyReport();
  
  res.json({
    metrics: Object.fromEntries(metrics),
    latency: Object.fromEntries(latencyReport),
    cache: IntelligentCacheService.getStats(),
    connections: wsHandler.getStats(),
  });
});

// Clear cache
app.post('/api/cache/clear', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pattern } = req.body;
    await IntelligentCacheService.clearCache(pattern);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Warm up cache
app.post('/api/cache/warmup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { predictions, voice } = req.body;
    
    if (!predictions || !Array.isArray(predictions)) {
      throw new SpeechServiceError(
        'Predictions array is required',
        ErrorCode.INVALID_CONFIG,
        400
      );
    }

    await IntelligentCacheService.warmupCache(predictions, voice || 'default');
    res.json({ success: true, count: predictions.length });
  } catch (error) {
    next(error);
  }
});

// Error handling middleware
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Request error:', error);
  
  if (error instanceof SpeechServiceError) {
    res.status(error.statusCode || 500).json({
      error: {
        message: error.message,
        code: error.code,
        details: error.details,
      },
    });
  } else {
    res.status(500).json({
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
    });
  }
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: {
      message: 'Endpoint not found',
      code: 'NOT_FOUND',
    },
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, starting graceful shutdown');
  
  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
  });

  // Clean up services
  await wsHandler.destroy();
  await AzureSTTService.destroy();
  await AzureTTSService.destroy();
  await IntelligentCacheService.destroy();
  PerformanceMonitor.destroy();
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, starting graceful shutdown');
  process.emit('SIGTERM' as any);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', reason);
});

// Start server
server.listen(SERVICE_INFO.port, () => {
  logger.info(`
    ========================================
    Speech Services Server Started
    ========================================
    Service: ${SERVICE_INFO.name}
    Port: ${SERVICE_INFO.port}
    WebSocket Port: ${SERVICE_INFO.wsPort}
    Environment: ${SERVICE_INFO.environment}
    Version: ${SERVICE_INFO.version}
    ========================================
  `);
});

export default app;