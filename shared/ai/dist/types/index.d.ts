export interface PredictionContext {
    userId: string;
    callerPhone: string;
    callId?: string;
    recentIntents: Intent[];
    conversationHistory: ConversationTurn[];
    userProfile?: UserProfile;
    networkQuality?: NetworkMetrics;
}
export interface Intent {
    category: string;
    confidence: number;
    subCategory?: string;
    emotionalTone?: string;
    urgency?: 'low' | 'medium' | 'high';
}
export interface ConversationTurn {
    speaker: 'user' | 'ai';
    text: string;
    timestamp: number;
    intent?: Intent;
    confidence?: number;
}
export interface UserProfile {
    name?: string;
    personality: 'polite' | 'direct' | 'humorous' | 'professional';
    speechStyle?: string;
    occupation?: string;
    preferredResponseLength?: 'short' | 'medium' | 'long';
    spamCategories: string[];
}
export interface NetworkMetrics {
    bandwidth: number;
    latency: number;
    packetLoss: number;
    quality: number;
}
export interface PredictionResult {
    intent: Intent;
    confidence: number;
    suggestedResponse: string;
    responseType: 'precomputed' | 'template' | 'generated';
    cacheable: boolean;
    ttl?: number;
}
export interface CacheEntry {
    key: string;
    value: any;
    timestamp: number;
    ttl: number;
    accessCount: number;
    lastAccess: number;
    tags: string[];
    priority: 'low' | 'medium' | 'high' | 'critical';
}
export interface CacheStrategy {
    name: string;
    ttl: number;
    maxSize: number;
    evictionPolicy: 'lru' | 'lfu' | 'fifo' | 'adaptive';
    prefetchEnabled: boolean;
    compressionEnabled: boolean;
}
export interface ResponseTemplate {
    id: string;
    intent: string;
    personality: string;
    template: string;
    variables: Record<string, any>;
    priority: number;
    usage: number;
}
export interface PrecomputeJob {
    id: string;
    type: 'response' | 'intent' | 'user_profile';
    userId?: string;
    context: Record<string, any>;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    result?: any;
    createdAt: number;
    completedAt?: number;
}
export interface OptimizationMetrics {
    totalLatency: number;
    sttLatency: number;
    aiLatency: number;
    ttsLatency: number;
    cacheHitRate: number;
    predictionAccuracy: number;
    userSatisfaction: number;
}
export interface PerformanceTarget {
    maxTotalLatency: number;
    minCacheHitRate: number;
    minPredictionAccuracy: number;
    targetThroughput: number;
}
export interface EdgeNode {
    id: string;
    region: string;
    endpoint: string;
    capacity: number;
    currentLoad: number;
    latency: number;
    status: 'online' | 'offline' | 'maintenance';
}
export interface CDNConfig {
    provider: 'cloudflare' | 'aws' | 'azure';
    regions: string[];
    cacheTtl: number;
    compressionEnabled: boolean;
    brotliEnabled: boolean;
}
export interface BehaviorPattern {
    userId: string;
    pattern: string;
    frequency: number;
    confidence: number;
    lastSeen: number;
}
export interface LatencyOptimizationResult {
    originalLatency: number;
    optimizedLatency: number;
    improvement: number;
    optimizations: string[];
    confidence: number;
}
//# sourceMappingURL=index.d.ts.map