export class Logger {
  private context: string;
  private static logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info';

  constructor(context: string) {
    this.context = context;
  }

  static setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    Logger.logLevel = level;
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog('debug')) {
      console.debug(`[${this.getTimestamp()}] [DEBUG] [${this.context}] ${message}`, data || '');
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog('info')) {
      console.info(`[${this.getTimestamp()}] [INFO] [${this.context}] ${message}`, data || '');
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog('warn')) {
      console.warn(`[${this.getTimestamp()}] [WARN] [${this.context}] ${message}`, data || '');
    }
  }

  error(message: string, error?: Error | any, data?: any): void {
    if (this.shouldLog('error')) {
      console.error(`[${this.getTimestamp()}] [ERROR] [${this.context}] ${message}`, error || '', data || '');
    }
  }

  private shouldLog(level: string): boolean {
    const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[Logger.logLevel];
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }
}