"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
class Logger {
    constructor(context) {
        this.context = context;
    }
    static setLogLevel(level) {
        Logger.logLevel = level;
    }
    debug(message, data) {
        if (this.shouldLog('debug')) {
            console.debug(`[${this.getTimestamp()}] [DEBUG] [${this.context}] ${message}`, data || '');
        }
    }
    info(message, data) {
        if (this.shouldLog('info')) {
            console.info(`[${this.getTimestamp()}] [INFO] [${this.context}] ${message}`, data || '');
        }
    }
    warn(message, data) {
        if (this.shouldLog('warn')) {
            console.warn(`[${this.getTimestamp()}] [WARN] [${this.context}] ${message}`, data || '');
        }
    }
    error(message, error, data) {
        if (this.shouldLog('error')) {
            console.error(`[${this.getTimestamp()}] [ERROR] [${this.context}] ${message}`, error || '', data || '');
        }
    }
    shouldLog(level) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        return levels[level] >= levels[Logger.logLevel];
    }
    getTimestamp() {
        return new Date().toISOString();
    }
}
exports.Logger = Logger;
Logger.logLevel = 'info';
//# sourceMappingURL=Logger.js.map