import winston from 'winston';
import { config } from '@/config';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let output = `${timestamp} [${level.toUpperCase()}] ${message}`;
    
    if (Object.keys(meta).length > 0) {
      output += ` ${JSON.stringify(meta)}`;
    }
    
    return output;
  })
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let output = `${timestamp} [${level}] ${message}`;
        
        if (Object.keys(meta).length > 0) {
          output += ` ${JSON.stringify(meta, null, 2)}`;
        }
        
        return output;
      })
    ),
  }),
];

if (config.LOG_FILE_ENABLED && config.NODE_ENV !== 'test') {
  transports.push(
    new winston.transports.File({
      filename: config.LOG_FILE_PATH,
      format: logFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    })
  );
}

export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: logFormat,
  transports,
  exitOnError: false,
  silent: config.NODE_ENV === 'test',
});

// Request ID middleware support
export const withRequestId = (requestId: string) => {
  return logger.child({ requestId });
};

// Performance logging utility
export const logPerformance = (operation: string, startTime: number, metadata?: any) => {
  const duration = Date.now() - startTime;
  logger.info(`Performance: ${operation}`, {
    operation,
    duration: `${duration}ms`,
    ...metadata,
  });
  
  if (duration > 1000) {
    logger.warn(`Slow operation detected: ${operation}`, {
      operation,
      duration: `${duration}ms`,
      ...metadata,
    });
  }
  
  return duration;
};

export default logger;