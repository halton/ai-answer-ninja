export declare class Logger {
    private context;
    private static logLevel;
    constructor(context: string);
    static setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void;
    debug(message: string, data?: any): void;
    info(message: string, data?: any): void;
    warn(message: string, data?: any): void;
    error(message: string, error?: Error | any, data?: any): void;
    private shouldLog;
    private getTimestamp;
}
//# sourceMappingURL=Logger.d.ts.map