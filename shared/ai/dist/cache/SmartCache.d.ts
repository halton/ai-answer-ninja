import { PredictionContext } from '../types';
export declare class SmartCache {
    private l1Cache;
    private logger;
    constructor(redisClient?: any, dbClient?: any);
    get(key: string): Promise<any>;
    set(key: string, value: any, ttl?: number): Promise<void>;
    warmupCache(userId: string, context: PredictionContext): Promise<void>;
    getStats(): {
        l1Size: number;
        hitRate: number;
        hotDataCount: number;
        averageResponseTime: number;
    };
}
//# sourceMappingURL=SmartCache.d.ts.map