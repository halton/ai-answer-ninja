export interface LogLevel {
  DEBUG: 0;
  INFO: 1;
  WARN: 2;
  ERROR: 3;
}

export interface LogEntry {
  timestamp: Date;
  level: keyof LogLevel;
  service: string;
  message: string;
  metadata?: Record<string, any>;
  traceId?: string;
  spanId?: string;
}

export class Logger {
  private serviceName: string;
  private logLevel: keyof LogLevel;
  private enableConsole: boolean;
  private enableFileLogging: boolean;
  private logQueue: LogEntry[];
  private flushInterval: NodeJS.Timeout | null;

  private readonly LOG_LEVELS: LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  };

  constructor(
    serviceName: string,
    logLevel: keyof LogLevel = 'INFO',
    enableConsole: boolean = true,
    enableFileLogging: boolean = false
  ) {
    this.serviceName = serviceName;
    this.logLevel = logLevel;
    this.enableConsole = enableConsole;
    this.enableFileLogging = enableFileLogging;
    this.logQueue = [];
    this.flushInterval = null;

    if (this.enableFileLogging) {
      this.startLogFlushing();
    }
  }

  debug(message: string, metadata?: Record<string, any>): void {
    this.log('DEBUG', message, metadata);
  }

  info(message: string, metadata?: Record<string, any>): void {
    this.log('INFO', message, metadata);
  }

  warn(message: string, metadata?: Record<string, any>): void {
    this.log('WARN', message, metadata);
  }

  error(message: string, metadata?: Record<string, any>): void {
    this.log('ERROR', message, metadata);
  }

  private log(level: keyof LogLevel, message: string, metadata?: Record<string, any>): void {
    if (this.LOG_LEVELS[level] < this.LOG_LEVELS[this.logLevel]) {
      return;
    }

    const logEntry: LogEntry = {
      timestamp: new Date(),
      level,
      service: this.serviceName,
      message,
      metadata,
      traceId: this.generateTraceId(),
      spanId: this.generateSpanId()
    };

    if (this.enableConsole) {
      this.writeToConsole(logEntry);
    }

    if (this.enableFileLogging) {
      this.logQueue.push(logEntry);
    }
  }

  private writeToConsole(entry: LogEntry): void {
    const timestamp = entry.timestamp.toISOString();
    const levelColor = this.getLevelColor(entry.level);
    const resetColor = '\x1b[0m';
    
    const baseMessage = `${timestamp} [${levelColor}${entry.level}${resetColor}] [${entry.service}] ${entry.message}`;
    
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      console.log(baseMessage, entry.metadata);
    } else {
      console.log(baseMessage);
    }
  }

  private getLevelColor(level: keyof LogLevel): string {
    const colors = {
      DEBUG: '\x1b[36m', // Cyan
      INFO: '\x1b[32m',  // Green
      WARN: '\x1b[33m',  // Yellow
      ERROR: '\x1b[31m'  // Red
    };
    return colors[level];
  }

  private generateTraceId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private generateSpanId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  private startLogFlushing(): void {
    this.flushInterval = setInterval(() => {
      this.flushLogs();
    }, 5000); // Flush every 5 seconds
  }

  private async flushLogs(): Promise<void> {
    if (this.logQueue.length === 0) {
      return;
    }

    const logsToFlush = [...this.logQueue];
    this.logQueue = [];

    try {
      await this.writeLogsToFile(logsToFlush);
    } catch (error) {
      console.error('Failed to write logs to file:', error);
      // Put logs back in queue
      this.logQueue.unshift(...logsToFlush);
    }
  }

  private async writeLogsToFile(logs: LogEntry[]): Promise<void> {
    // File logging implementation would go here
    // For now, just console log as JSON
    logs.forEach(log => {
      console.log(JSON.stringify(log));
    });
  }

  setLogLevel(level: keyof LogLevel): void {
    this.logLevel = level;
  }

  enableFileLog(enable: boolean): void {
    this.enableFileLogging = enable;
    
    if (enable && !this.flushInterval) {
      this.startLogFlushing();
    } else if (!enable && this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    // Final flush
    await this.flushLogs();
  }
}

export default Logger;