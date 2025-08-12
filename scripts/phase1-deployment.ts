#!/usr/bin/env ts-node

/**
 * Phase 1 Deployment Script
 * Coordinates the deployment and testing of core services for AI Answer Ninja
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { ServiceIntegrationTest, ServiceEndpoints } from '../shared/service-communication/src/testing/ServiceIntegrationTest';

interface ServiceConfig {
  name: string;
  directory: string;
  port: number;
  buildCommand?: string;
  startCommand: string;
  healthEndpoint: string;
  dependencies?: string[];
  environment?: Record<string, string>;
}

class Phase1Deployment {
  private services: ServiceConfig[] = [
    {
      name: 'phone-gateway',
      directory: 'services/phone-gateway',
      port: 3001,
      buildCommand: 'npm run build',
      startCommand: 'npm run dev',
      healthEndpoint: '/health',
      environment: {
        NODE_ENV: 'development',
        PORT: '3001'
      }
    },
    {
      name: 'realtime-processor',
      directory: 'services/realtime-processor',
      port: 3002,
      buildCommand: 'npm run build',
      startCommand: 'npm run dev',
      healthEndpoint: '/health',
      environment: {
        NODE_ENV: 'development',
        PORT: '3002'
      }
    },
    {
      name: 'profile-analytics',
      directory: 'services/profile-analytics',
      port: 3004,
      startCommand: 'python main.py',
      healthEndpoint: '/api/v1/health',
      environment: {
        PYTHONPATH: '.',
        HOST: '0.0.0.0',
        PORT: '3004'
      }
    },
    {
      name: 'configuration-service',
      directory: 'services/configuration-service',
      port: 3007,
      buildCommand: 'npm run build',
      startCommand: 'npm run dev',
      healthEndpoint: '/health',
      environment: {
        NODE_ENV: 'development',
        PORT: '3007'
      }
    }
  ];

  private runningProcesses: Map<string, ChildProcess> = new Map();
  private serviceStatus: Map<string, 'starting' | 'running' | 'failed' | 'stopped'> = new Map();

  async deploy(): Promise<void> {
    console.log('🚀 Starting Phase 1 Deployment for AI Answer Ninja');
    console.log('=====================================');

    try {
      // Step 1: Pre-deployment checks
      await this.preDeploymentChecks();

      // Step 2: Install dependencies
      await this.installDependencies();

      // Step 3: Build services
      await this.buildServices();

      // Step 4: Start services
      await this.startServices();

      // Step 5: Wait for services to be ready
      await this.waitForServices();

      // Step 6: Run integration tests
      await this.runIntegrationTests();

      console.log('✅ Phase 1 Deployment completed successfully!');
      console.log('\nServices running:');
      this.services.forEach(service => {
        console.log(`  - ${service.name}: http://localhost:${service.port}${service.healthEndpoint}`);
      });

    } catch (error) {
      console.error('❌ Deployment failed:', error);
      await this.cleanup();
      process.exit(1);
    }
  }

  private async preDeploymentChecks(): Promise<void> {
    console.log('\n📋 Running pre-deployment checks...');

    // Check if required directories exist
    for (const service of this.services) {
      const servicePath = path.join(process.cwd(), service.directory);
      if (!fs.existsSync(servicePath)) {
        throw new Error(`Service directory not found: ${servicePath}`);
      }

      const packageJsonPath = path.join(servicePath, 'package.json');
      const pythonMainPath = path.join(servicePath, 'main.py');
      
      if (!fs.existsSync(packageJsonPath) && !fs.existsSync(pythonMainPath)) {
        throw new Error(`No package.json or main.py found in: ${servicePath}`);
      }
    }

    // Check if required tools are installed
    await this.checkCommand('node', '--version');
    await this.checkCommand('npm', '--version');
    
    // Check if Python services can run
    try {
      await this.checkCommand('python', '--version');
    } catch (error) {
      console.warn('⚠️  Python not found, Python services may not start');
    }

    // Check port availability
    for (const service of this.services) {
      await this.checkPortAvailable(service.port);
    }

    console.log('✅ Pre-deployment checks passed');
  }

  private async checkCommand(command: string, ...args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'pipe' });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command ${command} failed with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  private async checkPortAvailable(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const net = require('net');
      const server = net.createServer();

      server.listen(port, () => {
        server.close(() => resolve());
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use`));
        } else {
          reject(err);
        }
      });
    });
  }

  private async installDependencies(): Promise<void> {
    console.log('\n📦 Installing dependencies...');

    for (const service of this.services) {
      const servicePath = path.join(process.cwd(), service.directory);
      const packageJsonPath = path.join(servicePath, 'package.json');

      if (fs.existsSync(packageJsonPath)) {
        console.log(`  Installing dependencies for ${service.name}...`);
        await this.runCommand('npm', ['install'], { cwd: servicePath });
      }

      // For Python services, you might want to install requirements
      const requirementsPath = path.join(servicePath, 'requirements.txt');
      if (fs.existsSync(requirementsPath)) {
        console.log(`  Installing Python requirements for ${service.name}...`);
        try {
          await this.runCommand('pip', ['install', '-r', 'requirements.txt'], { cwd: servicePath });
        } catch (error) {
          console.warn(`⚠️  Failed to install Python requirements for ${service.name}: ${error}`);
        }
      }
    }

    console.log('✅ Dependencies installed');
  }

  private async buildServices(): Promise<void> {
    console.log('\n🔨 Building services...');

    for (const service of this.services) {
      if (service.buildCommand) {
        console.log(`  Building ${service.name}...`);
        const servicePath = path.join(process.cwd(), service.directory);
        await this.runCommand('npm', ['run', 'build'], { cwd: servicePath });
      }
    }

    console.log('✅ Services built');
  }

  private async startServices(): Promise<void> {
    console.log('\n🎬 Starting services...');

    // Start services in dependency order (if specified)
    const sortedServices = this.topologicalSort();

    for (const service of sortedServices) {
      console.log(`  Starting ${service.name}...`);
      await this.startService(service);
      
      // Give each service a moment to start
      await this.delay(2000);
    }

    console.log('✅ All services started');
  }

  private topologicalSort(): ServiceConfig[] {
    // For now, just return services in original order
    // In a more complex setup, you'd implement proper dependency sorting
    return [...this.services];
  }

  private async startService(service: ServiceConfig): Promise<void> {
    const servicePath = path.join(process.cwd(), service.directory);
    const [command, ...args] = service.startCommand.split(' ');

    const childProcess = spawn(command, args, {
      cwd: servicePath,
      env: {
        ...process.env,
        ...service.environment
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.runningProcesses.set(service.name, childProcess);
    this.serviceStatus.set(service.name, 'starting');

    // Handle process output
    childProcess.stdout?.on('data', (data) => {
      console.log(`[${service.name}] ${data.toString().trim()}`);
    });

    childProcess.stderr?.on('data', (data) => {
      console.error(`[${service.name}] ERROR: ${data.toString().trim()}`);
    });

    childProcess.on('close', (code) => {
      console.log(`[${service.name}] Process exited with code ${code}`);
      this.serviceStatus.set(service.name, code === 0 ? 'stopped' : 'failed');
      this.runningProcesses.delete(service.name);
    });

    childProcess.on('error', (error) => {
      console.error(`[${service.name}] Failed to start: ${error}`);
      this.serviceStatus.set(service.name, 'failed');
    });
  }

  private async waitForServices(): Promise<void> {
    console.log('\n⏳ Waiting for services to be ready...');

    const maxWaitTime = 60000; // 1 minute
    const checkInterval = 2000; // 2 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      let allReady = true;

      for (const service of this.services) {
        const isReady = await this.checkServiceHealth(service);
        
        if (isReady) {
          if (this.serviceStatus.get(service.name) !== 'running') {
            console.log(`  ✅ ${service.name} is ready`);
            this.serviceStatus.set(service.name, 'running');
          }
        } else {
          allReady = false;
        }
      }

      if (allReady) {
        console.log('✅ All services are ready');
        return;
      }

      await this.delay(checkInterval);
    }

    throw new Error('Services did not become ready within the timeout period');
  }

  private async checkServiceHealth(service: ServiceConfig): Promise<boolean> {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`http://localhost:${service.port}${service.healthEndpoint}`, {
        timeout: 5000
      });
      
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  private async runIntegrationTests(): Promise<void> {
    console.log('\n🧪 Running integration tests...');

    const endpoints: ServiceEndpoints = {
      userManagement: 'http://localhost:3005', // Not started in Phase 1
      smartWhitelist: 'http://localhost:3006',  // Not started in Phase 1
      conversationEngine: 'http://localhost:3003', // Not started in Phase 1
      realtimeProcessor: 'http://localhost:3002',
      profileAnalytics: 'http://localhost:3004',
      phoneGateway: 'http://localhost:3001',
      configurationService: 'http://localhost:3007'
    };

    try {
      const integrationTest = new ServiceIntegrationTest(endpoints);
      const report = await integrationTest.generateReport();

      console.log('\n📊 Integration Test Results:');
      console.log(`  Total Services: ${report.summary.totalServices}`);
      console.log(`  Healthy: ${report.summary.healthyServices}`);
      console.log(`  Degraded: ${report.summary.degradedServices}`);
      console.log(`  Unhealthy: ${report.summary.unhealthyServices}`);

      if (report.recommendations.length > 0) {
        console.log('\n💡 Recommendations:');
        report.recommendations.forEach(rec => console.log(`  - ${rec}`));
      }

      // Save detailed report
      const reportPath = path.join(process.cwd(), 'phase1-integration-report.json');
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(`\n📄 Detailed report saved to: ${reportPath}`);

    } catch (error) {
      console.warn(`⚠️  Integration tests failed: ${error}`);
      console.log('Services are running but integration tests could not complete');
    }
  }

  private async runCommand(
    command: string, 
    args: string[], 
    options: { cwd: string }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        stdio: 'inherit'
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with code ${code}: ${command} ${args.join(' ')}`));
        }
      });

      child.on('error', reject);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up...');

    for (const [serviceName, process] of this.runningProcesses) {
      console.log(`  Stopping ${serviceName}...`);
      process.kill('SIGTERM');
      
      // Give process time to shut down gracefully
      await this.delay(2000);
      
      if (!process.killed) {
        console.log(`  Force killing ${serviceName}...`);
        process.kill('SIGKILL');
      }
    }

    this.runningProcesses.clear();
    console.log('✅ Cleanup completed');
  }

  // Graceful shutdown handling
  setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}, shutting down...`);
      await this.cleanup();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// Main execution
async function main() {
  const deployment = new Phase1Deployment();
  deployment.setupGracefulShutdown();

  try {
    await deployment.deploy();

    // Keep the script running to maintain services
    console.log('\n🎯 Phase 1 services are running. Press Ctrl+C to stop all services.');
    
    // Keep process alive
    setInterval(() => {
      // Check service status periodically
    }, 30000);

  } catch (error) {
    console.error('Deployment failed:', error);
    process.exit(1);
  }
}

// Check if script is run directly
if (require.main === module) {
  main().catch(console.error);
}

export { Phase1Deployment };