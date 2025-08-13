import { PredictionContext, PredictionResult } from '../types';
import { SmartCache } from '../cache/SmartCache';
export declare class ResponsePredictor {
    private cache;
    private logger;
    private templates;
    private behaviorPatterns;
    constructor(cache: SmartCache);
    predictResponse(context: PredictionContext): Promise<PredictionResult>;
    private predictIntent;
    private keywordBasedClassification;
    private patternBasedPrediction;
    private selectResponseStrategy;
    private generateResponse;
    private initializeTemplates;
    private loadBehaviorPatterns;
    private calculateKeywordScore;
    private generateCacheKey;
    private calculateOverallConfidence;
    private getFallbackResponse;
    private getDefaultResponse;
    private adjustIntentByProfile;
    updateBehaviorPattern(userId: string, context: PredictionContext, actualResponse: string): Promise<void>;
}
//# sourceMappingURL=ResponsePredictor.d.ts.map