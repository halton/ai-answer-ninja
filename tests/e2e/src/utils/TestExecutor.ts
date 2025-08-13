/**
 * Parallel Test Execution and Environment Isolation
 * 
 * Provides advanced test execution capabilities:
 * - Parallel test execution with configurable concurrency
 * - Environment isolation and cleanup
 * - Test dependencies and ordering
 * - Resource management and throttling
 * - Dynamic load balancing
 * - Failure recovery and retry strategies
 */

import { Worker } from 'worker_threads';
import { performance } from 'perf_hooks';
import { EventEmitter } from 'events';
import { TestApiClient } from './TestApiClient';
import { TestDataFactory } from '../fixtures/TestDataFactory';
import { ServiceHealthChecker } from './ServiceHealthChecker';
import { TestReporter } from './TestReporter';

export interface TestExecutorConfig {
  maxConcurrency: number;
  isolationLevel: 'none' | 'data' | 'service' | 'full';
  resourceLimits: {
    memoryMB: number;
    cpuPercent: number;
    diskMB: number;
    networkMbps: number;
  };
  retry: {
    maxRetries: number;
    backoffFactor: number;
    retryableErrors: string[];
  };
  timeouts: {
    testTimeout: number;
    setupTimeout: number;
    teardownTimeout: number;
  };
  loadBalancing: {
    strategy: 'round-robin' | 'least-loaded' | 'fastest-first';
    monitorInterval: number;
  };
  cleanup: {
    aggressive: boolean;
    retainOnFailure: boolean;
    cleanupTimeout: number;
  };
}

export interface TestJob {
  id: string;
  name: string;
  category: string;
  testFunction: string; // Serialized test function
  priority: number;
  dependencies: string[];
  tags: string[];
  estimatedDuration: number;
  resources: {
    memory: number;
    cpu: number;
    network: boolean;
    database: boolean;
  };
  isolation: TestIsolationConfig;
  data?: any;
}

export interface TestIsolationConfig {
  dataIsolation: boolean;
  serviceIsolation: boolean;
  networkIsolation: boolean;
  temporalIsolation: boolean;
  cleanupLevel: 'minimal' | 'standard' | 'aggressive';
}

export interface ExecutionResult {
  jobId: string;
  status: 'passed' | 'failed' | 'timeout' | 'cancelled';
  duration: number;
  startTime: number;
  endTime: number;
  workerId?: string;
  metrics: {
    memoryUsed: number;
    cpuUsed: number;
    networkCalls: number;
    databaseQueries: number;
  };
  output?: any;
  error?: string;
  retryCount: number;
}

export interface WorkerInfo {
  id: string;
  worker: Worker;
  status: 'idle' | 'busy' | 'error';
  currentJob?: string;
  completedJobs: number;
  failedJobs: number;
  averageExecutionTime: number;
  resourceUsage: {
    memory: number;
    cpu: number;
  };
  lastHealthCheck: number;
}

export class TestExecutor extends EventEmitter {
  private config: TestExecutorConfig;
  private workers: Map<string, WorkerInfo> = new Map();
  private jobQueue: TestJob[] = [];
  private runningJobs: Map<string, { job: TestJob; worker: WorkerInfo; startTime: number }> = new Map();
  private completedJobs: Map<string, ExecutionResult> = new Map();
  private testEnvironments: Map<string, TestEnvironment> = new Map();
  private resourceMonitor: ResourceMonitor;
  private dependencyGraph: Map<string, Set<string>> = new Map();

  constructor(config?: Partial<TestExecutorConfig>) {
    super();
    
    this.config = {
      maxConcurrency: 4,
      isolationLevel: 'data',
      resourceLimits: {
        memoryMB: 512,
        cpuPercent: 25,
        diskMB: 100,
        networkMbps: 10
      },
      retry: {
        maxRetries: 2,
        backoffFactor: 2,
        retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'TIMEOUT']
      },
      timeouts: {
        testTimeout: 300000, // 5 minutes
        setupTimeout: 60000, // 1 minute
        teardownTimeout: 30000 // 30 seconds
      },
      loadBalancing: {
        strategy: 'least-loaded',
        monitorInterval: 5000
      },
      cleanup: {
        aggressive: true,
        retainOnFailure: false,
        cleanupTimeout: 30000
      },
      ...config
    };

    this.resourceMonitor = new ResourceMonitor(this.config.resourceLimits);
    this.initializeWorkers();
    this.startResourceMonitoring();
  }

  /**
   * Queue test jobs for execution
   */
  async queueJobs(jobs: TestJob[]): Promise<void> {
    // Build dependency graph
    this.buildDependencyGraph(jobs);
    
    // Sort jobs by priority and dependencies
    const sortedJobs = this.sortJobsByPriority(jobs);
    
    // Add to queue
    this.jobQueue.push(...sortedJobs);
    
    this.emit('jobs_queued', { count: jobs.length, totalQueued: this.jobQueue.length });
    
    // Start execution
    this.processJobQueue();
  }

  /**
   * Execute jobs in parallel with proper orchestration
   */
  async executeJobs(): Promise<Map<string, ExecutionResult>> {
    return new Promise((resolve, reject) => {
      const executionTimeout = setTimeout(() => {
        this.emit('execution_timeout');
        reject(new Error('Test execution timed out'));
      }, this.config.timeouts.testTimeout);

      this.on('all_jobs_completed', (results) => {
        clearTimeout(executionTimeout);
        resolve(results);
      });

      this.on('execution_error', (error) => {
        clearTimeout(executionTimeout);
        reject(error);
      });

      this.processJobQueue();
    });
  }

  /**
   * Cancel running jobs
   */
  async cancelExecution(reason: string = 'User cancelled'): Promise<void> {
    this.emit('execution_cancelled', { reason });

    // Cancel all running jobs
    for (const [jobId, { worker }] of this.runningJobs) {
      await this.cancelJob(jobId, worker);
    }

    // Clear queue
    this.jobQueue = [];
    
    // Cleanup environments
    await this.cleanupAllEnvironments();
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(): {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    workers: {
      total: number;
      active: number;
      idle: number;
      errors: number;
    };
    resourceUsage: {
      memory: number;
      cpu: number;
      network: number;
    };
  } {
    const completedResults = Array.from(this.completedJobs.values());
    const workers = Array.from(this.workers.values());

    return {
      queued: this.jobQueue.length,
      running: this.runningJobs.size,
      completed: completedResults.filter(r => r.status === 'passed').length,
      failed: completedResults.filter(r => r.status === 'failed').length,
      workers: {
        total: workers.length,
        active: workers.filter(w => w.status === 'busy').length,
        idle: workers.filter(w => w.status === 'idle').length,
        errors: workers.filter(w => w.status === 'error').length
      },
      resourceUsage: this.resourceMonitor.getCurrentUsage()
    };
  }

  // Private methods

  private initializeWorkers(): void {
    for (let i = 0; i < this.config.maxConcurrency; i++) {
      const workerId = `worker_${i}`;
      const worker = new Worker(`
        const { parentPort } = require('worker_threads');
        
        parentPort.on('message', async (message) => {
          try {
            const { type, data } = message;
            
            switch (type) {
              case 'execute_test':
                const result = await executeTest(data);
                parentPort.postMessage({ type: 'test_result', result });
                break;
                
              case 'health_check':
                const health = await performHealthCheck();
                parentPort.postMessage({ type: 'health_status', health });
                break;
                
              case 'cleanup':
                await performCleanup(data);
                parentPort.postMessage({ type: 'cleanup_complete' });
                break;
            }
          } catch (error) {
            parentPort.postMessage({ 
              type: 'error', 
              error: { message: error.message, stack: error.stack }
            });
          }
        });
        
        async function executeTest(job) {
          const startTime = performance.now();
          
          try {
            // Setup test environment
            const env = await setupTestEnvironment(job.isolation);
            
            // Execute test function
            const testFn = eval(job.testFunction);
            const result = await testFn(job.data);
            
            // Cleanup
            await cleanupTestEnvironment(env, job.isolation);
            
            return {
              status: 'passed',
              duration: performance.now() - startTime,
              output: result,
              metrics: collectMetrics()
            };
          } catch (error) {
            return {
              status: 'failed',
              duration: performance.now() - startTime,
              error: error.message,
              metrics: collectMetrics()
            };
          }
        }
        
        async function setupTestEnvironment(isolation) {
          // Implementation would setup isolated environment
          return { id: 'env_' + Date.now() };
        }
        
        async function cleanupTestEnvironment(env, isolation) {
          // Implementation would cleanup environment
        }
        
        async function performHealthCheck() {
          return {
            memory: process.memoryUsage(),
            uptime: process.uptime(),
            status: 'healthy'
          };
        }
        
        async function performCleanup(data) {
          // Implementation would perform cleanup
        }
        
        function collectMetrics() {
          const usage = process.memoryUsage();
          return {
            memoryUsed: usage.heapUsed / 1024 / 1024, // MB
            cpuUsed: process.cpuUsage().system / 1000, // ms
            networkCalls: 0, // Would be tracked during execution
            databaseQueries: 0 // Would be tracked during execution
          };
        }
      `, { eval: true });

      worker.on('message', (message) => {
        this.handleWorkerMessage(workerId, message);
      });

      worker.on('error', (error) => {
        this.handleWorkerError(workerId, error);
      });

      worker.on('exit', (code) => {
        this.handleWorkerExit(workerId, code);
      });

      const workerInfo: WorkerInfo = {
        id: workerId,
        worker,
        status: 'idle',
        completedJobs: 0,
        failedJobs: 0,
        averageExecutionTime: 0,
        resourceUsage: { memory: 0, cpu: 0 },
        lastHealthCheck: Date.now()
      };

      this.workers.set(workerId, workerInfo);
    }

    this.emit('workers_initialized', { count: this.config.maxConcurrency });
  }

  private async processJobQueue(): Promise<void> {
    while (this.jobQueue.length > 0 && this.getAvailableWorkers().length > 0) {
      const job = this.getNextExecutableJob();
      if (!job) break; // No executable jobs (waiting for dependencies)

      const worker = this.selectOptimalWorker(job);
      if (!worker) break; // No available workers

      await this.executeJob(job, worker);
    }

    // Check if all jobs are completed
    if (this.jobQueue.length === 0 && this.runningJobs.size === 0) {
      this.emit('all_jobs_completed', this.completedJobs);
    }
  }

  private getNextExecutableJob(): TestJob | null {
    for (let i = 0; i < this.jobQueue.length; i++) {
      const job = this.jobQueue[i];
      
      // Check if all dependencies are completed
      const dependenciesCompleted = job.dependencies.every(depId =>
        this.completedJobs.has(depId) && this.completedJobs.get(depId)!.status === 'passed'
      );

      if (dependenciesCompleted) {
        return this.jobQueue.splice(i, 1)[0];
      }
    }

    return null;
  }

  private selectOptimalWorker(job: TestJob): WorkerInfo | null {
    const availableWorkers = this.getAvailableWorkers();
    if (availableWorkers.length === 0) return null;

    switch (this.config.loadBalancing.strategy) {
      case 'round-robin':
        return availableWorkers[0];
        
      case 'least-loaded':
        return availableWorkers.reduce((best, current) =>
          current.completedJobs < best.completedJobs ? current : best
        );
        
      case 'fastest-first':
        return availableWorkers.reduce((best, current) =>
          current.averageExecutionTime < best.averageExecutionTime ? current : best
        );
        
      default:
        return availableWorkers[0];
    }
  }

  private async executeJob(job: TestJob, worker: WorkerInfo): Promise<void> {
    const startTime = performance.now();
    
    worker.status = 'busy';
    worker.currentJob = job.id;
    
    this.runningJobs.set(job.id, { job, worker, startTime });
    
    this.emit('job_started', { jobId: job.id, workerId: worker.id });

    // Setup timeout
    const timeout = setTimeout(() => {
      this.handleJobTimeout(job.id, worker);
    }, this.config.timeouts.testTimeout);

    try {
      // Send job to worker
      worker.worker.postMessage({
        type: 'execute_test',
        data: job
      });

    } catch (error) {
      clearTimeout(timeout);
      this.handleJobError(job.id, worker, error as Error);
    }
  }

  private handleWorkerMessage(workerId: string, message: any): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    switch (message.type) {
      case 'test_result':
        this.handleJobResult(worker, message.result);
        break;
        
      case 'health_status':
        this.updateWorkerHealth(worker, message.health);
        break;
        
      case 'cleanup_complete':
        this.emit('worker_cleanup_complete', { workerId });
        break;
        
      case 'error':
        this.handleWorkerError(workerId, new Error(message.error.message));
        break;
    }
  }

  private handleJobResult(worker: WorkerInfo, result: any): void {
    const jobId = worker.currentJob;
    if (!jobId || !this.runningJobs.has(jobId)) return;

    const { job, startTime } = this.runningJobs.get(jobId)!;
    const endTime = performance.now();

    const executionResult: ExecutionResult = {
      jobId,
      status: result.status,
      duration: endTime - startTime,
      startTime,
      endTime,
      workerId: worker.id,
      metrics: result.metrics,
      output: result.output,
      error: result.error,
      retryCount: 0
    };

    // Update worker stats
    worker.status = 'idle';
    worker.currentJob = undefined;
    worker.completedJobs++;
    if (result.status === 'failed') {
      worker.failedJobs++;
    }
    worker.averageExecutionTime = 
      (worker.averageExecutionTime * (worker.completedJobs - 1) + executionResult.duration) / worker.completedJobs;

    // Store result
    this.completedJobs.set(jobId, executionResult);
    this.runningJobs.delete(jobId);

    this.emit('job_completed', { 
      jobId, 
      workerId: worker.id, 
      result: executionResult 
    });

    // Continue processing queue
    setTimeout(() => this.processJobQueue(), 0);
  }

  private handleJobError(jobId: string, worker: WorkerInfo, error: Error): void {
    const runningJob = this.runningJobs.get(jobId);
    if (!runningJob) return;

    const { job, startTime } = runningJob;
    
    // Check if error is retryable
    const isRetryable = this.config.retry.retryableErrors.some(retryableError =>
      error.message.includes(retryableError)
    );

    if (isRetryable && job.priority < this.config.retry.maxRetries) {
      // Retry job
      job.priority++;
      this.jobQueue.unshift(job); // Add back to front of queue
      
      this.emit('job_retry', { 
        jobId, 
        workerId: worker.id, 
        attempt: job.priority,
        error: error.message 
      });
    } else {
      // Job failed permanently
      const result: ExecutionResult = {
        jobId,
        status: 'failed',
        duration: performance.now() - startTime,
        startTime,
        endTime: performance.now(),
        workerId: worker.id,
        metrics: {
          memoryUsed: 0,
          cpuUsed: 0,
          networkCalls: 0,
          databaseQueries: 0
        },
        error: error.message,
        retryCount: job.priority
      };

      this.completedJobs.set(jobId, result);
      worker.failedJobs++;
    }

    // Reset worker
    worker.status = 'idle';
    worker.currentJob = undefined;
    this.runningJobs.delete(jobId);

    // Continue processing
    setTimeout(() => this.processJobQueue(), 0);
  }

  private handleJobTimeout(jobId: string, worker: WorkerInfo): void {
    this.handleJobError(jobId, worker, new Error('Job execution timeout'));
  }

  private handleWorkerError(workerId: string, error: Error): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    worker.status = 'error';
    
    this.emit('worker_error', { workerId, error: error.message });

    // If worker had a running job, handle it as failed
    if (worker.currentJob) {
      this.handleJobError(worker.currentJob, worker, error);
    }

    // Restart worker after delay
    setTimeout(() => this.restartWorker(workerId), 5000);
  }

  private handleWorkerExit(workerId: string, code: number): void {
    this.emit('worker_exit', { workerId, code });
    
    if (code !== 0) {
      setTimeout(() => this.restartWorker(workerId), 1000);
    }
  }

  private async restartWorker(workerId: string): Promise<void> {
    const oldWorker = this.workers.get(workerId);
    if (oldWorker) {
      try {
        await oldWorker.worker.terminate();
      } catch (error) {
        // Ignore termination errors
      }
      this.workers.delete(workerId);
    }

    // Create new worker with same ID
    this.initializeWorkers();
  }

  private getAvailableWorkers(): WorkerInfo[] {
    return Array.from(this.workers.values()).filter(worker => worker.status === 'idle');
  }

  private buildDependencyGraph(jobs: TestJob[]): void {
    this.dependencyGraph.clear();
    
    jobs.forEach(job => {
      this.dependencyGraph.set(job.id, new Set(job.dependencies));
    });
  }

  private sortJobsByPriority(jobs: TestJob[]): TestJob[] {
    return jobs.sort((a, b) => {
      // Sort by priority first, then by dependencies
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      
      // Jobs with fewer dependencies go first
      return a.dependencies.length - b.dependencies.length;
    });
  }

  private async cancelJob(jobId: string, worker: WorkerInfo): Promise<void> {
    try {
      await worker.worker.terminate();
      this.runningJobs.delete(jobId);
      
      const result: ExecutionResult = {
        jobId,
        status: 'cancelled',
        duration: 0,
        startTime: 0,
        endTime: 0,
        workerId: worker.id,
        metrics: {
          memoryUsed: 0,
          cpuUsed: 0,
          networkCalls: 0,
          databaseQueries: 0
        },
        retryCount: 0
      };
      
      this.completedJobs.set(jobId, result);
    } catch (error) {
      this.emit('cancel_error', { jobId, workerId: worker.id, error });
    }
  }

  private updateWorkerHealth(worker: WorkerInfo, health: any): void {
    worker.resourceUsage = {
      memory: health.memory.heapUsed / 1024 / 1024,
      cpu: 0 // Would be calculated from health data
    };
    worker.lastHealthCheck = Date.now();
  }

  private startResourceMonitoring(): void {
    setInterval(() => {
      this.resourceMonitor.collectMetrics();
      
      // Check resource limits
      const usage = this.resourceMonitor.getCurrentUsage();
      if (usage.memory > this.config.resourceLimits.memoryMB) {
        this.emit('resource_limit_exceeded', { resource: 'memory', usage });
      }
      
      // Perform worker health checks
      this.performWorkerHealthChecks();
    }, this.config.loadBalancing.monitorInterval);
  }

  private performWorkerHealthChecks(): void {
    this.workers.forEach(worker => {
      if (Date.now() - worker.lastHealthCheck > 30000) { // 30 seconds
        worker.worker.postMessage({ type: 'health_check' });
      }
    });
  }

  private async cleanupAllEnvironments(): Promise<void> {
    const cleanupPromises = Array.from(this.testEnvironments.values()).map(env =>
      env.cleanup()
    );

    await Promise.all(cleanupPromises);
    this.testEnvironments.clear();
  }

  /**
   * Shutdown executor and cleanup resources
   */
  async shutdown(): Promise<void> {
    this.emit('shutdown_started');

    // Cancel all running jobs
    await this.cancelExecution('Executor shutdown');

    // Terminate all workers
    const terminationPromises = Array.from(this.workers.values()).map(worker =>
      worker.worker.terminate()
    );

    await Promise.all(terminationPromises);

    // Cleanup environments
    await this.cleanupAllEnvironments();

    this.emit('shutdown_completed');
  }
}

// Supporting classes

class ResourceMonitor {
  private limits: TestExecutorConfig['resourceLimits'];
  private currentUsage = { memory: 0, cpu: 0, network: 0 };

  constructor(limits: TestExecutorConfig['resourceLimits']) {
    this.limits = limits;
  }

  collectMetrics(): void {
    const usage = process.memoryUsage();
    this.currentUsage = {
      memory: usage.heapUsed / 1024 / 1024, // MB
      cpu: process.cpuUsage().system / 1000, // ms
      network: 0 // Would be tracked from network calls
    };
  }

  getCurrentUsage() {
    return { ...this.currentUsage };
  }

  isWithinLimits(): boolean {
    return this.currentUsage.memory <= this.limits.memoryMB &&
           this.currentUsage.cpu <= this.limits.cpuPercent;
  }
}

class TestEnvironment {
  private id: string;
  private resources: any[] = [];

  constructor(id: string) {
    this.id = id;
  }

  async setup(isolation: TestIsolationConfig): Promise<void> {
    // Implementation would setup isolated environment
    // - Create temporary database schemas
    // - Setup network isolation
    // - Prepare test data
  }

  async cleanup(): Promise<void> {
    // Implementation would cleanup environment
    // - Drop temporary schemas
    // - Clean up test data
    // - Release resources
    await Promise.all(this.resources.map(resource => resource.cleanup?.()));
    this.resources = [];
  }

  addResource(resource: any): void {
    this.resources.push(resource);
  }
}

export default TestExecutor;