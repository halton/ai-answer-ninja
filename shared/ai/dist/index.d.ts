export { ResponsePredictor } from './prediction/ResponsePredictor';
export { SmartCache } from './cache/SmartCache';
export { LatencyOptimizer } from './optimization/LatencyOptimizer';
export { ResponsePrecomputer } from './precompute/ResponsePrecomputer';
export { Logger } from './utils/Logger';
export * from './types';
import { SmartCache } from './cache/SmartCache';
import { LatencyOptimizer } from './optimization/LatencyOptimizer';
import { ResponsePrecomputer } from './precompute/ResponsePrecomputer';
import { PredictionContext, PerformanceTarget } from './types';
export declare class AIPerformanceManager {
    private cache;
    private predictor;
    private optimizer;
    private precomputer;
    private logger;
    constructor(redisClient?: any, dbClient?: any, performanceTarget?: PerformanceTarget);
    generateOptimizedResponse(context: PredictionContext): Promise<{
        response: string;
        latency: number;
        optimizations: string[];
        confidence: number;
        fromCache: boolean;
    }>;
    warmupCaches(userIds: string[]): Promise<{
        successful: number;
        failed: number;
        totalTime: number;
    }>;
    getPerformanceReport(): {
        overall: {
            averageLatency: number;
            cacheHitRate: number;
            predictionAccuracy: number;
        };
        optimization: ReturnType<LatencyOptimizer['getPerformanceReport']>;
        cache: ReturnType<SmartCache['getStats']>;
        precompute: ReturnType<ResponsePrecomputer['getJobStats']>;
        recommendations: string[];
    };
    startSmartPrecompute(userIds: string[]): Promise<void>;
    healthCheck(): Promise<{
        status: 'healthy' | 'degraded' | 'unhealthy';
        components: {
            cache: 'healthy' | 'unhealthy';
            predictor: 'healthy' | 'unhealthy';
            optimizer: 'healthy' | 'unhealthy';
            precomputer: 'healthy' | 'unhealthy';
        };
        metrics: {
            averageLatency: number;
            cacheHitRate: number;
            queueSize: number;
        };
    }>;
    private getFallbackResponse;
    destroy(): void;
}
export default AIPerformanceManager;
//# sourceMappingURL=index.d.ts.map