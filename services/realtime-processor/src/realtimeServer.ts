/**
 * Enhanced Realtime Server
 * Main server file that initializes the complete WebSocket real-time communication system
 */

import { logger } from './utils/logger';
import { config } from './config';
import RealtimeWebSocketServer from './websocket/RealtimeWebSocketServer';

/**
 * Main application class
 */
class RealtimeApplication {
  private server: RealtimeWebSocketServer;

  constructor() {
    this.server = new RealtimeWebSocketServer({
      enableCors: true,
      enableCompression: true,
      enableRateLimit: true,
      enableAuth: config.security.jwtSecret !== 'default-secret-change-in-production',
      maxConnections: config.server.maxConnections,
      heartbeatInterval: 30000,
      reconnectTimeout: 60000
    });

    this.setupSignalHandlers();
  }

  /**
   * Start the application
   */
  public async start(): Promise<void> {
    try {
      logger.info('Starting Realtime Processor Service...');
      logger.info(`Environment: ${config.server.environment}`);
      logger.info(`Port: ${config.server.port}`);
      logger.info(`Host: ${config.server.host}`);

      // Validate configuration
      this.validateConfiguration();

      // Start the server
      await this.server.start();

      logger.info('Realtime Processor Service started successfully');
      logger.info('Service endpoints:');
      logger.info(`  HTTP Health Check: http://${config.server.host}:${config.server.port}/health`);
      logger.info(`  WebSocket Endpoint: ws://${config.server.host}:${config.server.port}/realtime/ws`);
      logger.info(`  Authentication: http://${config.server.host}:${config.server.port}/auth/websocket`);
      logger.info(`  Metrics: http://${config.server.host}:${config.server.port}/metrics`);

      // Log service capabilities
      this.logServiceCapabilities();

    } catch (error) {
      logger.error('Failed to start Realtime Processor Service:', error);
      process.exit(1);
    }
  }

  /**
   * Stop the application
   */
  public async stop(): Promise<void> {
    try {
      logger.info('Stopping Realtime Processor Service...');
      await this.server.stop();
      logger.info('Realtime Processor Service stopped successfully');
    } catch (error) {
      logger.error('Error stopping Realtime Processor Service:', error);
      throw error;
    }
  }

  /**
   * Get service status
   */
  public getStatus(): any {
    return {
      service: 'realtime-processor',
      version: process.env.npm_package_version || '2.0.0',
      environment: config.server.environment,
      uptime: process.uptime(),
      statistics: this.server.getStatistics()
    };
  }

  /**
   * Private helper methods
   */
  private validateConfiguration(): void {
    const requiredEnvVars = [
      'AZURE_SPEECH_KEY',
      'AZURE_SPEECH_REGION',
      'AZURE_OPENAI_KEY',
      'AZURE_OPENAI_ENDPOINT'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      logger.error(`Missing required environment variables: ${missingVars.join(', ')}`);
      logger.error('Please check your .env file or environment configuration');
      throw new Error('Configuration validation failed');
    }

    // Validate Azure configuration
    if (!config.azure.speech.key || !config.azure.speech.region) {
      logger.error('Azure Speech configuration is incomplete');
      throw new Error('Azure Speech configuration required');
    }

    if (!config.azure.openai.key || !config.azure.openai.endpoint) {
      logger.error('Azure OpenAI configuration is incomplete');
      throw new Error('Azure OpenAI configuration required');
    }

    // Validate Redis configuration
    if (!config.redis.url) {
      logger.warn('Redis URL not configured, using default localhost');
    }

    // Security validation
    if (config.security.jwtSecret === 'default-secret-change-in-production' && 
        config.server.environment === 'production') {
      logger.error('Default JWT secret detected in production environment');
      throw new Error('JWT secret must be changed in production');
    }

    logger.info('Configuration validation passed');
  }

  private logServiceCapabilities(): void {
    logger.info('Service Capabilities:');
    logger.info('  ✓ Real-time audio processing with voice activity detection');
    logger.info('  ✓ WebSocket communication with heartbeat and reconnection');
    logger.info('  ✓ Azure Speech-to-Text integration');
    logger.info('  ✓ Azure OpenAI conversation engine');
    logger.info('  ✓ Intent recognition and response generation');
    logger.info('  ✓ Performance monitoring and metrics');
    logger.info('  ✓ Rate limiting and security controls');
    logger.info('  ✓ Automatic session management');
    logger.info('  ✓ Binary audio and JSON message support');

    const stats = this.server.getStatistics();
    logger.info(`Configuration Summary:`);
    logger.info(`  Max Connections: ${config.server.maxConnections}`);
    logger.info(`  Heartbeat Interval: ${stats.heartbeatConfig?.interval}ms`);
    logger.info(`  Connection Timeout: ${config.server.connectionTimeout}ms`);
    logger.info(`  Audio Chunk Size: ${config.performance.audioChunkSize} bytes`);
    logger.info(`  Max Audio Duration: ${config.performance.maxAudioDuration}ms`);
    logger.info(`  Processing Timeout: ${config.performance.processingTimeout}ms`);
  }

  private setupSignalHandlers(): void {
    // Graceful shutdown on SIGTERM
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM signal');
      await this.gracefulShutdown();
    });

    // Graceful shutdown on SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT signal');
      await this.gracefulShutdown();
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      this.emergencyShutdown();
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      this.emergencyShutdown();
    });
  }

  private async gracefulShutdown(): Promise<void> {
    logger.info('Starting graceful shutdown...');
    
    try {
      // Set a timeout for graceful shutdown
      const shutdownTimeout = setTimeout(() => {
        logger.error('Graceful shutdown timeout, forcing exit');
        process.exit(1);
      }, 30000); // 30 seconds timeout

      await this.stop();
      clearTimeout(shutdownTimeout);
      process.exit(0);

    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  private emergencyShutdown(): void {
    logger.error('Emergency shutdown initiated');
    process.exit(1);
  }
}

/**
 * Application entry point
 */
async function main(): Promise<void> {
  const app = new RealtimeApplication();

  try {
    await app.start();

    // Keep the process alive
    process.on('SIGTERM', async () => {
      await app.stop();
    });

    process.on('SIGINT', async () => {
      await app.stop();
    });

  } catch (error) {
    logger.error('Application startup failed:', error);
    process.exit(1);
  }
}

// Start the application if this file is run directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

export { RealtimeApplication };
export default main;