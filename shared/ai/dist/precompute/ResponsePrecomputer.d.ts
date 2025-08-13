import { UserProfile } from '../types';
import { SmartCache } from '../cache/SmartCache';
import { ResponsePredictor } from '../prediction/ResponsePredictor';
export declare class ResponsePrecomputer {
    private cache;
    private predictor;
    private logger;
    private jobQueue;
    constructor(cache: SmartCache, predictor: ResponsePredictor);
    precomputeUserResponses(userId: string, userProfile: UserProfile): Promise<void>;
    smartPrecompute(userId: string): Promise<void>;
    getJobStats(): {
        total: number;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
    };
    stopWorker(): void;
}
//# sourceMappingURL=ResponsePrecomputer.d.ts.map