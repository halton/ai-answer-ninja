/**
 * 简单的日志工具类
 */

export class Logger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
      console.debug(`[DEBUG] [${this.prefix}] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    console.log(`[INFO] [${this.prefix}] ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] [${this.prefix}] ${message}`, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`[ERROR] [${this.prefix}] ${message}`, ...args);
  }
}