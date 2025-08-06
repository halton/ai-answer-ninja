import { EventEmitter } from 'events';
import logger from '../utils/logger';

enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  timeout: number;
  monitoringPeriod: number;
  halfOpenMaxCalls: number;
  volumeThreshold: number;
  errorThresholdPercentage: number;
}

interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  totalCalls: number;
  lastFailureTime?: number;
  nextAttempt?: number;
  uptime: number;
  errorRate: number;
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private totalCalls = 0;
  private lastFailureTime?: number;
  private nextAttempt?: number;
  private halfOpenCalls = 0;
  private startTime = Date.now();
  
  private config: CircuitBreakerConfig;
  private name: string;
  
  // Statistics tracking
  private recentCalls: Array<{ timestamp: number; success: boolean }> = [];
  private stateHistory: Array<{ timestamp: number; state: CircuitState; reason?: string }> = [];

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    super();
    
    this.name = name;
    this.config = {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      timeout: 30000, // 30 seconds
      monitoringPeriod: 60000, // 1 minute
      halfOpenMaxCalls: 3,
      volumeThreshold: 10, // Minimum calls before circuit can open
      errorThresholdPercentage: 50, // 50% error rate
      ...config,
    };
    
    this.recordStateChange(CircuitState.CLOSED, 'initialized');
    
    logger.info(`Circuit breaker '${this.name}' initialized`, { config: this.config });
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      const error = new Error(`Circuit breaker '${this.name}' is OPEN`);
      (error as any).circuitBreakerOpen = true;
      throw error;
    }

    const startTime = Date.now();
    this.totalCalls++;

    try {
      const result = await this.executeWithTimeout(fn);
      this.onSuccess(Date.now() - startTime);
      return result;
    } catch (error) {
      this.onFailure(Date.now() - startTime, error);
      throw error;
    }
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Circuit breaker '${this.name}' timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      fn()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private canExecute(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
        
      case CircuitState.OPEN:
        if (this.shouldAttemptReset()) {
          this.transitionToHalfOpen();
          return true;
        }
        return false;
        
      case CircuitState.HALF_OPEN:
        return this.halfOpenCalls < this.config.halfOpenMaxCalls;
        
      default:
        return false;
    }
  }

  private onSuccess(latency: number): void {
    this.successes++;
    this.recordCall(true);
    
    this.emit('success', {
      name: this.name,
      state: this.state,
      latency,
      stats: this.getStats(),
    });
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenCalls++;
      
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        this.transitionToClosed();
      }
    }
    
    logger.debug(`Circuit breaker '${this.name}' success`, {
      state: this.state,
      latency,
      successes: this.successes,
    });
  }

  private onFailure(latency: number, error: any): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    this.recordCall(false);
    
    this.emit('failure', {
      name: this.name,
      state: this.state,
      latency,
      error: error.message,
      stats: this.getStats(),
    });
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionToOpen('failure_in_half_open');
    } else if (this.state === CircuitState.CLOSED && this.shouldOpenCircuit()) {
      this.transitionToOpen('failure_threshold_exceeded');
    }
    
    logger.warn(`Circuit breaker '${this.name}' failure`, {
      state: this.state,
      latency,
      error: error.message,
      failures: this.failures,
    });
  }

  private shouldOpenCircuit(): boolean {
    // Check if we have enough volume to make a decision
    if (this.totalCalls < this.config.volumeThreshold) {
      return false;
    }
    
    // Check recent error rate
    const recentErrorRate = this.calculateRecentErrorRate();
    
    // Open circuit if error rate exceeds threshold
    return recentErrorRate >= this.config.errorThresholdPercentage;
  }

  private calculateRecentErrorRate(): number {
    const cutoff = Date.now() - this.config.monitoringPeriod;
    const recentCalls = this.recentCalls.filter(call => call.timestamp >= cutoff);
    
    if (recentCalls.length === 0) return 0;
    
    const failures = recentCalls.filter(call => !call.success).length;
    return (failures / recentCalls.length) * 100;
  }

  private shouldAttemptReset(): boolean {
    if (!this.nextAttempt) {
      this.nextAttempt = Date.now() + this.config.resetTimeout;
    }
    
    return Date.now() >= this.nextAttempt;
  }

  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.halfOpenCalls = 0;
    this.nextAttempt = undefined;
    
    this.recordStateChange(CircuitState.CLOSED, 'reset_successful');
    
    this.emit('state_change', {
      name: this.name,
      state: this.state,
      previousState: this.stateHistory[this.stateHistory.length - 2]?.state,
      stats: this.getStats(),
    });
    
    logger.info(`Circuit breaker '${this.name}' transitioned to CLOSED`);
  }

  private transitionToOpen(reason: string): void {
    this.state = CircuitState.OPEN;
    this.nextAttempt = Date.now() + this.config.resetTimeout;
    
    this.recordStateChange(CircuitState.OPEN, reason);
    
    this.emit('state_change', {
      name: this.name,
      state: this.state,
      reason,
      nextAttempt: this.nextAttempt,
      stats: this.getStats(),
    });
    
    logger.warn(`Circuit breaker '${this.name}' transitioned to OPEN`, {
      reason,
      nextAttempt: new Date(this.nextAttempt).toISOString(),
    });
  }

  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.halfOpenCalls = 0;
    
    this.recordStateChange(CircuitState.HALF_OPEN, 'attempting_reset');
    
    this.emit('state_change', {
      name: this.name,
      state: this.state,
      stats: this.getStats(),
    });
    
    logger.info(`Circuit breaker '${this.name}' transitioned to HALF_OPEN`);
  }

  private recordCall(success: boolean): void {
    this.recentCalls.push({
      timestamp: Date.now(),
      success,
    });
    
    // Keep only recent calls within monitoring period
    const cutoff = Date.now() - this.config.monitoringPeriod * 2; // Keep 2x period for analysis
    this.recentCalls = this.recentCalls.filter(call => call.timestamp >= cutoff);
  }

  private recordStateChange(state: CircuitState, reason?: string): void {
    this.stateHistory.push({
      timestamp: Date.now(),
      state,
      reason,
    });
    
    // Keep only recent state changes
    if (this.stateHistory.length > 100) {
      this.stateHistory = this.stateHistory.slice(-50);
    }
  }

  // Public API methods

  public getStats(): CircuitBreakerStats {
    const uptime = Date.now() - this.startTime;
    const errorRate = this.totalCalls > 0 ? (this.failures / this.totalCalls) * 100 : 0;
    
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalCalls: this.totalCalls,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
      uptime,
      errorRate,
    };
  }

  public getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: any;
  } {
    const stats = this.getStats();
    let status: 'healthy' | 'degraded' | 'unhealthy';
    
    switch (this.state) {
      case CircuitState.CLOSED:
        status = stats.errorRate < 10 ? 'healthy' : 'degraded';
        break;
      case CircuitState.HALF_OPEN:
        status = 'degraded';
        break;
      case CircuitState.OPEN:
        status = 'unhealthy';
        break;
      default:
        status = 'unhealthy';
    }
    
    return {
      status,
      details: {
        ...stats,
        config: this.config,
        recentErrorRate: this.calculateRecentErrorRate(),
        stateHistory: this.stateHistory.slice(-10), // Last 10 state changes
      },
    };
  }

  public getName(): string {
    return this.name;
  }

  public getState(): CircuitState {
    return this.state;
  }

  public isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  public isClosed(): boolean {
    return this.state === CircuitState.CLOSED;
  }

  public isHalfOpen(): boolean {
    return this.state === CircuitState.HALF_OPEN;
  }

  // Manual control methods (for testing/debugging)

  public forceOpen(reason = 'manual_override'): void {
    logger.warn(`Circuit breaker '${this.name}' manually forced OPEN`);
    this.transitionToOpen(reason);
  }

  public forceClose(reason = 'manual_override'): void {
    logger.info(`Circuit breaker '${this.name}' manually forced CLOSED`);
    this.transitionToClosed();
  }

  public reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.totalCalls = 0;
    this.halfOpenCalls = 0;
    this.lastFailureTime = undefined;
    this.nextAttempt = undefined;
    this.recentCalls = [];
    this.stateHistory = [];
    this.startTime = Date.now();
    
    this.recordStateChange(CircuitState.CLOSED, 'reset');
    
    logger.info(`Circuit breaker '${this.name}' reset`);
  }

  // Configuration updates

  public updateConfig(newConfig: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    logger.info(`Circuit breaker '${this.name}' configuration updated`, {
      newConfig,
      fullConfig: this.config,
    });
    
    this.emit('config_updated', {
      name: this.name,
      config: this.config,
    });
  }

  // Metrics and monitoring

  public getMetrics(): {
    name: string;
    state: CircuitState;
    stats: CircuitBreakerStats;
    recentCalls: number;
    recentSuccessRate: number;
    recentErrorRate: number;
    averageLatency: number;
  } {
    const stats = this.getStats();
    const cutoff = Date.now() - this.config.monitoringPeriod;
    const recentCalls = this.recentCalls.filter(call => call.timestamp >= cutoff);
    
    const recentSuccesses = recentCalls.filter(call => call.success).length;
    const recentSuccessRate = recentCalls.length > 0 ? (recentSuccesses / recentCalls.length) * 100 : 0;
    const recentErrorRate = 100 - recentSuccessRate;
    
    // Calculate average latency (this would need to be tracked separately in a real implementation)
    const averageLatency = 0; // Placeholder
    
    return {
      name: this.name,
      state: this.state,
      stats,
      recentCalls: recentCalls.length,
      recentSuccessRate,
      recentErrorRate,
      averageLatency,
    };
  }

  // Static factory methods for common configurations

  public static createForAzureService(serviceName: string): CircuitBreaker {
    return new CircuitBreaker(`azure_${serviceName}`, {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      timeout: 10000, // 10 seconds
      volumeThreshold: 10,
      errorThresholdPercentage: 50,
    });
  }

  public static createForDatabase(dbName: string): CircuitBreaker {
    return new CircuitBreaker(`db_${dbName}`, {
      failureThreshold: 3,
      resetTimeout: 30000, // 30 seconds
      timeout: 5000, // 5 seconds
      volumeThreshold: 5,
      errorThresholdPercentage: 30,
    });
  }

  public static createForExternalAPI(apiName: string): CircuitBreaker {
    return new CircuitBreaker(`api_${apiName}`, {
      failureThreshold: 5,
      resetTimeout: 120000, // 2 minutes
      timeout: 15000, // 15 seconds
      volumeThreshold: 10,
      errorThresholdPercentage: 40,
    });
  }
}

// Circuit breaker manager for handling multiple circuit breakers
export class CircuitBreakerManager extends EventEmitter {
  private breakers = new Map<string, CircuitBreaker>();
  private monitoringInterval?: NodeJS.Timeout;

  constructor() {
    super();
    this.startMonitoring();
  }

  public register(name: string, breaker: CircuitBreaker): void {
    this.breakers.set(name, breaker);
    
    // Forward events with circuit breaker name
    breaker.on('state_change', (event) => {
      this.emit('circuit_state_change', event);
    });
    
    breaker.on('failure', (event) => {
      this.emit('circuit_failure', event);
    });
    
    logger.info(`Circuit breaker '${name}' registered with manager`);
  }

  public get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  public getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  public getStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getMetrics();
    }
    
    return stats;
  }

  public getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    circuitBreakers: Record<string, any>;
    summary: {
      total: number;
      healthy: number;
      degraded: number;
      unhealthy: number;
    };
  } {
    const circuitBreakers: Record<string, any> = {};
    const summary = { total: 0, healthy: 0, degraded: 0, unhealthy: 0 };
    
    for (const [name, breaker] of this.breakers) {
      const health = breaker.getHealthStatus();
      circuitBreakers[name] = health;
      
      summary.total++;
      summary[health.status]++;
    }
    
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    
    if (summary.unhealthy > 0) {
      overallStatus = 'unhealthy';
    } else if (summary.degraded > 0) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }
    
    return {
      status: overallStatus,
      circuitBreakers,
      summary,
    };
  }

  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.emit('monitoring_update', {
        timestamp: Date.now(),
        stats: this.getStats(),
        health: this.getHealthStatus(),
      });
    }, 30000); // Every 30 seconds
  }

  public shutdown(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    
    this.breakers.clear();
    logger.info('Circuit breaker manager shutdown');
  }
}