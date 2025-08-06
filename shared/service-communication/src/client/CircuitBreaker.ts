/**
 * Circuit Breaker implementation for service resilience
 */

import { CircuitBreakerOptions } from '../types';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  nextAttemptTime?: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private nextAttemptTime?: number;

  private readonly options: Required<CircuitBreakerOptions>;

  constructor(
    private readonly name: string,
    options?: Partial<CircuitBreakerOptions>
  ) {
    this.options = {
      threshold: options?.threshold || 5,
      timeout: options?.timeout || 60000, // 1 minute
      monitoringPeriod: options?.monitoringPeriod || 300000, // 5 minutes
      resetTimeout: options?.resetTimeout || 30000 // 30 seconds
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new Error(`Circuit breaker is OPEN for service: ${this.name}. Next attempt at: ${new Date(this.nextAttemptTime!)}`);
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.successes++;
    this.lastSuccessTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      this.failures = 0;
    }

    // Reset failures count after successful period
    if (this.shouldResetFailures()) {
      this.failures = 0;
    }
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.options.threshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.options.resetTimeout;
    }
  }

  /**
   * Check if we should attempt to reset from OPEN to HALF_OPEN
   */
  private shouldAttemptReset(): boolean {
    if (!this.nextAttemptTime) {
      return false;
    }
    return Date.now() >= this.nextAttemptTime;
  }

  /**
   * Check if we should reset the failures count based on monitoring period
   */
  private shouldResetFailures(): boolean {
    if (!this.lastFailureTime || !this.lastSuccessTime) {
      return false;
    }

    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    return timeSinceLastFailure >= this.options.monitoringPeriod;
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime
    };
  }

  /**
   * Reset circuit breaker to initial state
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.nextAttemptTime = undefined;
  }

  /**
   * Force circuit breaker to OPEN state
   */
  forceOpen(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = Date.now() + this.options.resetTimeout;
  }

  /**
   * Force circuit breaker to CLOSED state
   */
  forceClosed(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.nextAttemptTime = undefined;
  }

  /**
   * Check if circuit breaker is currently allowing requests
   */
  isAllowingRequests(): boolean {
    if (this.state === CircuitState.CLOSED || this.state === CircuitState.HALF_OPEN) {
      return true;
    }

    if (this.state === CircuitState.OPEN && this.shouldAttemptReset()) {
      return true;
    }

    return false;
  }

  /**
   * Get failure rate within monitoring period
   */
  getFailureRate(): number {
    const total = this.failures + this.successes;
    if (total === 0) {
      return 0;
    }
    return this.failures / total;
  }

  /**
   * Get service name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get circuit breaker options
   */
  getOptions(): CircuitBreakerOptions {
    return { ...this.options };
  }
}