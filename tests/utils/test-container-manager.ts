/**
 * Test Container Manager
 * 
 * Manages Docker containers for testing infrastructure including
 * PostgreSQL, Redis, and service containers for integration testing.
 */

import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import * as fs from 'fs/promises';
import * as path from 'path';

interface ContainerConfig {
  name: string;
  image: string;
  ports: { [key: number]: number };
  environment?: { [key: string]: string };
  volumes?: { [key: string]: string };
  waitStrategy?: any;
  healthCheck?: {
    command: string;
    interval: number;
    timeout: number;
    retries: number;
  };
}

export class TestContainerManager {
  private containers: Map<string, StartedTestContainer> = new Map();
  private containerConfigs: Map<string, ContainerConfig> = new Map();
  
  constructor() {
    this.setupContainerConfigs();
  }
  
  private setupContainerConfigs(): void {
    // PostgreSQL Test Database
    this.containerConfigs.set('postgresql', {
      name: 'postgresql-test',
      image: 'postgres:15-alpine',
      ports: { 5432: 5433 },
      environment: {
        POSTGRES_DB: 'ai_ninja_test',
        POSTGRES_USER: 'test_user',
        POSTGRES_PASSWORD: 'test_password',
        POSTGRES_INITDB_ARGS: '--auth-host=md5'
      },
      waitStrategy: Wait.forLogMessage('database system is ready to accept connections'),
      healthCheck: {
        command: 'pg_isready -U test_user -d ai_ninja_test',
        interval: 5000,
        timeout: 3000,
        retries: 5
      }
    });
    
    // Redis Test Cache
    this.containerConfigs.set('redis', {
      name: 'redis-test',
      image: 'redis:7-alpine',
      ports: { 6379: 6380 },
      environment: {},
      waitStrategy: Wait.forLogMessage('Ready to accept connections'),
      healthCheck: {
        command: 'redis-cli ping',
        interval: 2000,
        timeout: 1000,
        retries: 10
      }
    });
    
    // Phone Gateway Test Service
    this.containerConfigs.set('phone-gateway', {
      name: 'phone-gateway-test',
      image: 'ai-ninja/phone-gateway:test',
      ports: { 3001: 3001 },
      environment: {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://test_user:test_password@postgresql-test:5432/ai_ninja_test',
        REDIS_URL: 'redis://redis-test:6379',
        LOG_LEVEL: 'error'
      },
      waitStrategy: Wait.forHttp('/health', 3001).forStatusCode(200)
    });
    
    // User Management Test Service
    this.containerConfigs.set('user-management', {
      name: 'user-management-test',
      image: 'ai-ninja/user-management:test',
      ports: { 3005: 3005 },
      environment: {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://test_user:test_password@postgresql-test:5432/ai_ninja_test',
        REDIS_URL: 'redis://redis-test:6379',
        LOG_LEVEL: 'error'
      },
      waitStrategy: Wait.forHttp('/health', 3005).forStatusCode(200)
    });
    
    // Realtime Processor Test Service\n    this.containerConfigs.set('realtime-processor', {\n      name: 'realtime-processor-test',\n      image: 'ai-ninja/realtime-processor:test',\n      ports: { 3002: 3002 },\n      environment: {\n        NODE_ENV: 'test',\n        REDIS_URL: 'redis://redis-test:6379',\n        LOG_LEVEL: 'error'\n      },\n      waitStrategy: Wait.forHttp('/health', 3002).forStatusCode(200)\n    });\n  }\n  \n  async startAll(): Promise<void> {\n    console.log('🚀 Starting all test containers...');\n    \n    try {\n      // Start infrastructure containers first\n      await this.startInfrastructure();\n      \n      // Wait for infrastructure to be ready\n      await this.waitForInfrastructure();\n      \n      // Start application services\n      await this.startServices();\n      \n      console.log('✅ All test containers started successfully');\n      \n    } catch (error) {\n      console.error('❌ Failed to start test containers:', error);\n      await this.stopAll();\n      throw error;\n    }\n  }\n  \n  async stopAll(): Promise<void> {\n    console.log('🛑 Stopping all test containers...');\n    \n    const stopPromises = Array.from(this.containers.values())\n      .map(container => container.stop().catch(error => {\n        console.warn(`Warning: Failed to stop container: ${error.message}`);\n      }));\n    \n    await Promise.all(stopPromises);\n    \n    this.containers.clear();\n    console.log('✅ All test containers stopped');\n  }\n  \n  async startService(serviceName: string): Promise<void> {\n    const config = this.containerConfigs.get(serviceName);\n    if (!config) {\n      throw new Error(`Service configuration not found: ${serviceName}`);\n    }\n    \n    if (this.containers.has(serviceName)) {\n      console.log(`Service ${serviceName} is already running`);\n      return;\n    }\n    \n    console.log(`Starting ${serviceName} container...`);\n    \n    const container = await this.createContainer(config);\n    this.containers.set(serviceName, container);\n    \n    // Wait for service to be healthy\n    await this.waitForServiceHealth(serviceName, config);\n    \n    console.log(`✅ ${serviceName} container started`);\n  }\n  \n  async stopService(serviceName: string): Promise<void> {\n    const container = this.containers.get(serviceName);\n    if (!container) {\n      console.log(`Service ${serviceName} is not running`);\n      return;\n    }\n    \n    console.log(`Stopping ${serviceName} container...`);\n    \n    await container.stop();\n    this.containers.delete(serviceName);\n    \n    console.log(`✅ ${serviceName} container stopped`);\n  }\n  \n  async restartService(serviceName: string): Promise<void> {\n    await this.stopService(serviceName);\n    await this.startService(serviceName);\n  }\n  \n  async getServiceInfo(serviceName: string): Promise<any> {\n    const container = this.containers.get(serviceName);\n    if (!container) {\n      throw new Error(`Service ${serviceName} is not running`);\n    }\n    \n    const config = this.containerConfigs.get(serviceName);\n    \n    return {\n      name: serviceName,\n      containerId: container.getId(),\n      host: container.getHost(),\n      ports: config ? Object.fromEntries(\n        Object.entries(config.ports).map(([internal, external]) => [\n          internal,\n          container.getMappedPort(parseInt(internal))\n        ])\n      ) : {},\n      status: 'running'\n    };\n  }\n  \n  async executeInContainer(serviceName: string, command: string[]): Promise<string> {\n    const container = this.containers.get(serviceName);\n    if (!container) {\n      throw new Error(`Service ${serviceName} is not running`);\n    }\n    \n    const result = await container.exec(command);\n    return result.output;\n  }\n  \n  async getLogs(serviceName: string, options: { tail?: number; since?: Date } = {}): Promise<string> {\n    const container = this.containers.get(serviceName);\n    if (!container) {\n      throw new Error(`Service ${serviceName} is not running`);\n    }\n    \n    const logs = await container.logs();\n    return logs;\n  }\n  \n  private async startInfrastructure(): Promise<void> {\n    const infrastructureServices = ['postgresql', 'redis'];\n    \n    for (const serviceName of infrastructureServices) {\n      await this.startService(serviceName);\n    }\n  }\n  \n  private async startServices(): Promise<void> {\n    // Build service images if they don't exist\n    await this.buildServiceImages();\n    \n    const applicationServices = ['phone-gateway', 'user-management', 'realtime-processor'];\n    \n    // Start services in parallel\n    const startPromises = applicationServices.map(serviceName => \n      this.startService(serviceName).catch(error => {\n        console.warn(`Failed to start ${serviceName}: ${error.message}`);\n        throw error;\n      })\n    );\n    \n    await Promise.all(startPromises);\n  }\n  \n  private async buildServiceImages(): Promise<void> {\n    console.log('🔨 Building service Docker images...');\n    \n    const serviceBuilds = [\n      {\n        name: 'phone-gateway',\n        dockerfile: 'services/phone-gateway/Dockerfile',\n        context: 'services/phone-gateway',\n        tag: 'ai-ninja/phone-gateway:test'\n      },\n      {\n        name: 'user-management',\n        dockerfile: 'services/user-management/Dockerfile',\n        context: 'services/user-management',\n        tag: 'ai-ninja/user-management:test'\n      },\n      {\n        name: 'realtime-processor',\n        dockerfile: 'services/realtime-processor/Dockerfile',\n        context: 'services/realtime-processor',\n        tag: 'ai-ninja/realtime-processor:test'\n      }\n    ];\n    \n    // Check if images exist, build if they don't\n    for (const build of serviceBuilds) {\n      const imageExists = await this.checkImageExists(build.tag);\n      if (!imageExists) {\n        await this.buildDockerImage(build);\n      }\n    }\n    \n    console.log('✅ Service images ready');\n  }\n  \n  private async checkImageExists(tag: string): Promise<boolean> {\n    try {\n      const { spawn } = require('child_process');\n      \n      return new Promise((resolve) => {\n        const docker = spawn('docker', ['image', 'inspect', tag], { stdio: 'pipe' });\n        \n        docker.on('close', (code: number) => {\n          resolve(code === 0);\n        });\n        \n        docker.on('error', () => {\n          resolve(false);\n        });\n      });\n    } catch {\n      return false;\n    }\n  }\n  \n  private async buildDockerImage(build: { name: string; dockerfile: string; context: string; tag: string }): Promise<void> {\n    console.log(`Building ${build.name} image...`);\n    \n    const { spawn } = require('child_process');\n    \n    return new Promise((resolve, reject) => {\n      const docker = spawn('docker', [\n        'build',\n        '-f', build.dockerfile,\n        '-t', build.tag,\n        build.context\n      ], {\n        stdio: 'inherit',\n        cwd: process.cwd()\n      });\n      \n      docker.on('close', (code: number) => {\n        if (code === 0) {\n          console.log(`✅ Built ${build.name} image`);\n          resolve();\n        } else {\n          reject(new Error(`Failed to build ${build.name} image (exit code: ${code})`));\n        }\n      });\n      \n      docker.on('error', (error: Error) => {\n        reject(error);\n      });\n    });\n  }\n  \n  private async createContainer(config: ContainerConfig): Promise<StartedTestContainer> {\n    const container = new GenericContainer(config.image);\n    \n    // Configure ports\n    Object.entries(config.ports).forEach(([internal, external]) => {\n      container.withExposedPorts(parseInt(internal));\n    });\n    \n    // Configure environment variables\n    if (config.environment) {\n      Object.entries(config.environment).forEach(([key, value]) => {\n        container.withEnvironment(key, value);\n      });\n    }\n    \n    // Configure volumes\n    if (config.volumes) {\n      Object.entries(config.volumes).forEach(([host, container_path]) => {\n        container.withBindMounts([{ source: host, target: container_path }]);\n      });\n    }\n    \n    // Configure wait strategy\n    if (config.waitStrategy) {\n      container.withWaitStrategy(config.waitStrategy);\n    }\n    \n    // Configure network\n    container.withNetworkMode('bridge');\n    \n    const startedContainer = await container.start();\n    \n    return startedContainer;\n  }\n  \n  private async waitForInfrastructure(): Promise<void> {\n    console.log('⏳ Waiting for infrastructure containers to be ready...');\n    \n    const maxWaitTime = 60000; // 60 seconds\n    const checkInterval = 2000; // 2 seconds\n    const startTime = Date.now();\n    \n    while (Date.now() - startTime < maxWaitTime) {\n      try {\n        // Check PostgreSQL\n        const pgContainer = this.containers.get('postgresql');\n        if (pgContainer) {\n          await pgContainer.exec(['pg_isready', '-U', 'test_user', '-d', 'ai_ninja_test']);\n        }\n        \n        // Check Redis\n        const redisContainer = this.containers.get('redis');\n        if (redisContainer) {\n          await redisContainer.exec(['redis-cli', 'ping']);\n        }\n        \n        console.log('✅ Infrastructure containers are ready');\n        return;\n        \n      } catch (error) {\n        // Continue waiting\n        await new Promise(resolve => setTimeout(resolve, checkInterval));\n      }\n    }\n    \n    throw new Error('Infrastructure containers failed to become ready within timeout');\n  }\n  \n  private async waitForServiceHealth(serviceName: string, config: ContainerConfig): Promise<void> {\n    if (!config.healthCheck) {\n      return;\n    }\n    \n    const { command, interval, timeout, retries } = config.healthCheck;\n    const container = this.containers.get(serviceName);\n    \n    if (!container) {\n      throw new Error(`Container ${serviceName} not found`);\n    }\n    \n    let attempts = 0;\n    \n    while (attempts < retries) {\n      try {\n        const result = await container.exec(command.split(' '));\n        \n        if (result.exitCode === 0) {\n          return; // Health check passed\n        }\n        \n      } catch (error) {\n        // Health check failed\n      }\n      \n      attempts++;\n      \n      if (attempts < retries) {\n        await new Promise(resolve => setTimeout(resolve, interval));\n      }\n    }\n    \n    throw new Error(`Service ${serviceName} failed health check after ${retries} attempts`);\n  }\n  \n  // Utility methods for test data setup\n  async setupTestDatabase(): Promise<void> {\n    console.log('🔧 Setting up test database schema...');\n    \n    const pgContainer = this.containers.get('postgresql');\n    if (!pgContainer) {\n      throw new Error('PostgreSQL container not running');\n    }\n    \n    // Read and execute schema files\n    const schemaFiles = [\n      'database/schemas/01-core-tables.sql',\n      'database/schemas/02-performance-functions.sql',\n      'database/schemas/03-materialized-views.sql'\n    ];\n    \n    for (const schemaFile of schemaFiles) {\n      try {\n        const schemaPath = path.resolve(process.cwd(), schemaFile);\n        const schemaSql = await fs.readFile(schemaPath, 'utf-8');\n        \n        await pgContainer.exec([\n          'psql',\n          '-U', 'test_user',\n          '-d', 'ai_ninja_test',\n          '-c', schemaSql\n        ]);\n        \n        console.log(`✅ Executed schema: ${schemaFile}`);\n        \n      } catch (error) {\n        console.warn(`Failed to execute schema ${schemaFile}:`, error);\n      }\n    }\n  }\n  \n  async clearTestData(): Promise<void> {\n    console.log('🧹 Clearing test data...');\n    \n    const pgContainer = this.containers.get('postgresql');\n    const redisContainer = this.containers.get('redis');\n    \n    const cleanupTasks = [];\n    \n    // Clear PostgreSQL test data\n    if (pgContainer) {\n      cleanupTasks.push(\n        pgContainer.exec([\n          'psql',\n          '-U', 'test_user',\n          '-d', 'ai_ninja_test',\n          '-c', `\n            TRUNCATE TABLE conversations RESTART IDENTITY CASCADE;\n            TRUNCATE TABLE call_records RESTART IDENTITY CASCADE;\n            TRUNCATE TABLE smart_whitelists RESTART IDENTITY CASCADE;\n            TRUNCATE TABLE users RESTART IDENTITY CASCADE;\n          `\n        ]).catch(error => {\n          console.warn('Failed to clear PostgreSQL test data:', error);\n        })\n      );\n    }\n    \n    // Clear Redis test data\n    if (redisContainer) {\n      cleanupTasks.push(\n        redisContainer.exec(['redis-cli', 'FLUSHALL']).catch(error => {\n          console.warn('Failed to clear Redis test data:', error);\n        })\n      );\n    }\n    \n    await Promise.all(cleanupTasks);\n    \n    console.log('✅ Test data cleared');\n  }\n  \n  async getContainerStats(): Promise<{ [serviceName: string]: any }> {\n    const stats: { [serviceName: string]: any } = {};\n    \n    for (const [serviceName, container] of this.containers.entries()) {\n      try {\n        const info = await this.getServiceInfo(serviceName);\n        stats[serviceName] = {\n          ...info,\n          uptime: Date.now(), // Simplified - would need actual container start time\n          healthy: true\n        };\n      } catch (error) {\n        stats[serviceName] = {\n          name: serviceName,\n          status: 'error',\n          error: (error as Error).message,\n          healthy: false\n        };\n      }\n    }\n    \n    return stats;\n  }\n}\n"