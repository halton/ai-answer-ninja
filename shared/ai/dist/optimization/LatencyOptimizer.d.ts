import { PredictionContext, OptimizationMetrics, PerformanceTarget, LatencyOptimizationResult } from '../types';
import { SmartCache } from '../cache/SmartCache';
import { ResponsePredictor } from '../prediction/ResponsePredictor';
export declare class LatencyOptimizer {
    private cache;
    private predictor;
    private logger;
    private performanceTarget;
    private edgeNodes;
    private cdnConfig;
    private optimizationHistory;
    constructor(cache: SmartCache, predictor: ResponsePredictor, performanceTarget?: PerformanceTarget);
    optimizeLatency(context: PredictionContext): Promise<LatencyOptimizationResult>;
    private enableParallelProcessing;
    private optimizeCaching;
    private measureCurrentPerformance;
    private calculateOptimizationConfidence;
    private initializeEdgeNodes;
    private initializeCDNConfig;
    getPerformanceReport(): {
        currentMetrics: OptimizationMetrics;
        trends: {
            latencyTrend: 'improving' | 'stable' | 'degrading';
            cacheHitTrend: 'improving' | 'stable' | 'degrading';
        };
        recommendations: string[];
    };
}
//# sourceMappingURL=LatencyOptimizer.d.ts.map