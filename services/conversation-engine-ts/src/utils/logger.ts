import winston from 'winston';
import config from '@/config';

// 自定义格式化器
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    return JSON.stringify({
      timestamp,
      level,
      service: config.serviceName,
      message,
      ...meta
    });
  })
);

// 创建 Winston logger 实例
const logger = winston.createLogger({
  level: config.logging.level,
  format: config.logging.format === 'json' ? customFormat : winston.format.simple(),
  defaultMeta: {
    service: config.serviceName,
    environment: config.environment
  },
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: config.environment === 'development' 
        ? winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        : customFormat
    })
  ]
});

// 生产环境添加文件日志
if (config.environment === 'production') {
  logger.add(new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    format: customFormat
  }));
  
  logger.add(new winston.transports.File({
    filename: 'logs/combined.log',
    format: customFormat
  }));
}

// 扩展 logger 功能
export class Logger {
  private context: string;
  
  constructor(context: string = 'App') {
    this.context = context;
  }
  
  private formatMessage(message: string, meta: any = {}) {
    return {
      message,
      context: this.context,
      ...meta
    };
  }
  
  debug(message: string, meta: any = {}) {
    logger.debug(this.formatMessage(message, meta));
  }
  
  info(message: string, meta: any = {}) {
    logger.info(this.formatMessage(message, meta));
  }
  
  warn(message: string, meta: any = {}) {
    logger.warn(this.formatMessage(message, meta));
  }
  
  error(message: string, error?: Error | any, meta: any = {}) {
    logger.error(this.formatMessage(message, {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      ...meta
    }));
  }
  
  // 性能监控日志
  performance(operation: string, duration: number, meta: any = {}) {
    logger.info(this.formatMessage(`Performance: ${operation}`, {
      operation,
      duration,
      type: 'performance',
      ...meta
    }));
  }
  
  // 业务事件日志
  business(event: string, data: any = {}) {
    logger.info(this.formatMessage(`Business Event: ${event}`, {
      event,
      type: 'business',
      ...data
    }));
  }
  
  // 安全事件日志
  security(event: string, data: any = {}) {
    logger.warn(this.formatMessage(`Security Event: ${event}`, {
      event,
      type: 'security',
      ...data
    }));
  }
}

// 创建默认 logger 实例
export const defaultLogger = new Logger('ConversationEngine');

// 性能监控装饰器
export function LogPerformance(operation?: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    const logger = new Logger(target.constructor.name);
    
    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      const operationName = operation || `${target.constructor.name}.${propertyName}`;
      
      try {
        const result = await method.apply(this, args);
        const duration = Date.now() - startTime;
        
        logger.performance(operationName, duration, {
          success: true,
          args: args.length
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        logger.performance(operationName, duration, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          args: args.length
        });
        
        throw error;
      }
    };
    
    return descriptor;
  };
}

// 错误日志装饰器
export function LogErrors(context?: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    const logger = new Logger(context || target.constructor.name);
    
    descriptor.value = async function (...args: any[]) {
      try {
        return await method.apply(this, args);
      } catch (error) {
        logger.error(`Error in ${propertyName}`, error, {
          method: propertyName,
          args: args.length
        });
        throw error;
      }
    };
    
    return descriptor;
  };
}

export default logger;