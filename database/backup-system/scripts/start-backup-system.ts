#!/usr/bin/env node

/**
 * AI电话应答系统 - 备份系统启动脚本
 * 
 * 用途：
 * - 启动完整的备份系统
 * - 加载配置和环境变量
 * - 处理优雅关闭
 * - 健康检查端点
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as process from 'process';
import { BackupSystemManager } from '../BackupSystemManager';

interface EnvironmentConfig {
  NODE_ENV: string;
  LOG_LEVEL: string;
  CONFIG_PATH?: string;
  HEALTH_CHECK_PORT?: string;
  METRICS_PORT?: string;
  
  // Database
  POSTGRES_HOST: string;
  POSTGRES_PORT: string;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  
  // Redis
  REDIS_HOST: string;
  REDIS_PORT: string;
  REDIS_PASSWORD?: string;
  REDIS_SESSION_HOST?: string;
  REDIS_SESSION_PORT?: string;
  REDIS_SESSION_PASSWORD?: string;
  
  // Storage
  AZURE_STORAGE_ENDPOINT?: string;
  AZURE_STORAGE_ACCOUNT?: string;
  AZURE_STORAGE_KEY?: string;
  BACKUP_BUCKET?: string;
  
  // Monitoring
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  ALERT_WEBHOOK_URL?: string;
  WEBHOOK_TOKEN?: string;
  SLACK_WEBHOOK_URL?: string;
  TEAMS_WEBHOOK_URL?: string;
  
  // Notifications
  ADMIN_EMAIL?: string;
  DEVOPS_EMAIL?: string;
  TECHLEAD_EMAIL?: string;
  ESCALATION_EMAIL?: string;
  ADMIN_PHONE?: string;
  DEVOPS_PHONE?: string;
  TECHLEAD_PHONE?: string;
  
  // Disaster Recovery
  PRIMARY_POSTGRES_ENDPOINT?: string;
  PRIMARY_REDIS_ENDPOINT?: string;
  PRIMARY_STORAGE_ENDPOINT?: string;
  PRIMARY_MONITORING_ENDPOINT?: string;
  SECONDARY_POSTGRES_ENDPOINT?: string;
  SECONDARY_REDIS_ENDPOINT?: string;
  SECONDARY_STORAGE_ENDPOINT?: string;
  SECONDARY_MONITORING_ENDPOINT?: string;
  BACKUP_POSTGRES_ENDPOINT?: string;
  BACKUP_REDIS_ENDPOINT?: string;
  BACKUP_STORAGE_ENDPOINT?: string;
  BACKUP_MONITORING_ENDPOINT?: string;
  
  // External
  STATUS_PAGE_URL?: string;
  INCIDENT_API_URL?: string;
  SMS_API_KEY?: string;
}

class BackupSystemStarter {
  private backupSystem?: BackupSystemManager;
  private healthCheckServer?: any;
  private metricsServer?: any;
  
  async start(): Promise<void> {
    try {
      console.log('🚀 启动AI电话应答系统备份服务...');
      console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
      console.log(`进程ID: ${process.pid}`);
      console.log(`启动时间: ${new Date().toISOString()}`);
      
      // 验证环境变量
      await this.validateEnvironment();
      
      // 加载配置
      const config = await this.loadConfiguration();
      
      // 创建备份系统
      this.backupSystem = new BackupSystemManager(config);
      
      // 设置事件监听
      this.setupEventListeners();
      
      // 启动健康检查服务器
      await this.startHealthCheckServer();
      
      // 启动指标服务器
      await this.startMetricsServer();
      
      // 初始化备份系统
      await this.backupSystem.initialize();
      
      console.log('✅ 备份系统启动成功!');
      console.log('🔍 健康检查端点:', `http://localhost:${process.env.HEALTH_CHECK_PORT || 8080}/health`);
      console.log('📊 指标端点:', `http://localhost:${process.env.METRICS_PORT || 9090}/metrics`);
      
      // 显示系统状态
      await this.displaySystemStatus();
      
    } catch (error) {
      console.error('❌ 备份系统启动失败:', error);
      process.exit(1);
    }
  }
  
  private async validateEnvironment(): Promise<void> {
    console.log('🔍 验证环境配置...');
    
    const requiredVars: (keyof EnvironmentConfig)[] = [
      'POSTGRES_HOST',
      'POSTGRES_PORT', 
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
      'REDIS_HOST',
      'REDIS_PORT'
    ];
    
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`缺少必需的环境变量: ${missingVars.join(', ')}`);
    }
    
    console.log('✅ 环境配置验证通过');
  }
  
  private async loadConfiguration(): Promise<any> {
    console.log('📄 加载配置文件...');
    
    const configPath = process.env.CONFIG_PATH || 
      path.join(__dirname, '../config/backup-system-config.json');
    
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      let config = JSON.parse(configContent);
      
      // 替换环境变量占位符
      config = this.replaceEnvironmentVariables(config);
      
      console.log('✅ 配置文件加载成功');
      console.log(`配置文件路径: ${configPath}`);
      
      return config;
    } catch (error) {
      throw new Error(`加载配置文件失败: ${error.message}`);
    }
  }
  
  private replaceEnvironmentVariables(obj: any): any {
    if (typeof obj === 'string') {
      // 替换 ${VAR_NAME} 或 ${VAR_NAME:-default} 格式的占位符
      return obj.replace(/\$\{([^}]+)\}/g, (match, varExpr) => {
        const [varName, defaultValue] = varExpr.split(':-');
        return process.env[varName] || defaultValue || match;
      });
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.replaceEnvironmentVariables(item));
    } else if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replaceEnvironmentVariables(value);
      }
      return result;
    }
    
    return obj;
  }
  
  private setupEventListeners(): void {
    if (!this.backupSystem) return;
    
    // 系统事件监听
    this.backupSystem.on('system_initialized', (data) => {
      console.log('🎉 备份系统初始化完成:', data);
    });
    
    this.backupSystem.on('system_critical', (data) => {
      console.error('🚨 系统进入严重状态:', data.status);
    });
    
    this.backupSystem.on('system_warning', (data) => {
      console.warn('⚠️ 系统警告状态:', data.status);
    });
    
    this.backupSystem.on('manual_backup_triggered', (data) => {
      console.log('📦 手动备份触发:', data);
    });
    
    this.backupSystem.on('manual_recovery_triggered', (data) => {
      console.log('🔄 手动恢复触发:', data);
    });
    
    // 进程信号处理
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
    process.on('SIGUSR1', () => this.handleReload());
    process.on('SIGUSR2', () => this.handleStatusReport());
    
    // 未捕获异常处理
    process.on('uncaughtException', (error) => {
      console.error('❌ 未捕获异常:', error);
      this.gracefulShutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ 未处理的Promise拒绝:', reason, 'at:', promise);
    });
  }
  
  private async startHealthCheckServer(): Promise<void> {
    const port = parseInt(process.env.HEALTH_CHECK_PORT || '8080');
    
    // 使用内置的http模块创建简单的健康检查服务器
    const http = require('http');
    
    this.healthCheckServer = http.createServer(async (req: any, res: any) => {
      if (req.url === '/health' && req.method === 'GET') {
        try {
          const status = this.backupSystem ? await this.backupSystem.getSystemStatus() : null;
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: status?.overall || 'initializing',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: process.env.npm_package_version || '1.0.0',
            details: status
          }, null, 2));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
          }));
        }
      } else if (req.url === '/ready' && req.method === 'GET') {
        const isReady = this.backupSystem && this.backupSystem['isInitialized'];
        res.writeHead(isReady ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ready: isReady,
          timestamp: new Date().toISOString()
        }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    });
    
    this.healthCheckServer.listen(port, () => {
      console.log(`🔍 健康检查服务器启动在端口 ${port}`);
    });
  }
  
  private async startMetricsServer(): Promise<void> {
    const port = parseInt(process.env.METRICS_PORT || '9090');
    
    const http = require('http');
    
    this.metricsServer = http.createServer(async (req: any, res: any) => {
      if (req.url === '/metrics' && req.method === 'GET') {
        try {
          const status = this.backupSystem ? await this.backupSystem.getSystemStatus() : null;
          
          // 生成Prometheus格式的指标
          const metrics = this.generatePrometheusMetrics(status);
          
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(metrics);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`# ERROR: ${error.message}\n`);
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
    
    this.metricsServer.listen(port, () => {
      console.log(`📊 指标服务器启动在端口 ${port}`);
    });
  }
  
  private generatePrometheusMetrics(status: any): string {
    if (!status) {
      return '# Backup system not initialized\n';
    }
    
    const timestamp = Date.now();
    const metrics: string[] = [];
    
    // 系统总体状态
    metrics.push(`# HELP backup_system_healthy 备份系统健康状态`);
    metrics.push(`# TYPE backup_system_healthy gauge`);
    metrics.push(`backup_system_healthy{status="${status.overall}"} ${status.overall === 'healthy' ? 1 : 0} ${timestamp}`);
    
    // 服务状态
    Object.entries(status.services).forEach(([service, serviceStatus]: [string, any]) => {
      metrics.push(`# HELP backup_service_status 备份服务状态`);
      metrics.push(`# TYPE backup_service_status gauge`);
      metrics.push(`backup_service_status{service="${service}",status="${serviceStatus.status || serviceStatus.backup}"} 1 ${timestamp}`);
    });
    
    // 指标
    Object.entries(status.metrics).forEach(([metric, value]: [string, any]) => {
      metrics.push(`# HELP backup_${metric} 备份${metric}`);
      metrics.push(`# TYPE backup_${metric} gauge`);
      metrics.push(`backup_${metric} ${value} ${timestamp}`);
    });
    
    return metrics.join('\n') + '\n';
  }
  
  private async displaySystemStatus(): Promise<void> {
    if (!this.backupSystem) return;
    
    try {
      const status = await this.backupSystem.getSystemStatus();
      
      console.log('\n📊 系统状态概览:');
      console.log('====================');
      console.log(`总体状态: ${this.getStatusEmoji(status.overall)} ${status.overall.toUpperCase()}`);
      console.log('\n服务状态:');
      
      Object.entries(status.services).forEach(([service, serviceStatus]: [string, any]) => {
        const statusValue = serviceStatus.status || serviceStatus.backup || 'unknown';
        console.log(`  ${service}: ${this.getStatusEmoji(statusValue)} ${statusValue}`);
      });
      
      console.log('\n今日指标:');
      console.log(`  总备份数: ${status.metrics.totalBackupsToday}`);
      console.log(`  成功备份: ${status.metrics.successfulBackupsToday}`);
      console.log(`  失败备份: ${status.metrics.failedBackupsToday}`);
      console.log(`  平均耗时: ${Math.round(status.metrics.averageBackupTime / 1000)}s`);
      console.log('====================\n');
      
    } catch (error) {
      console.error('无法获取系统状态:', error.message);
    }
  }
  
  private getStatusEmoji(status: string): string {
    switch (status.toLowerCase()) {
      case 'healthy':
      case 'active':
      case 'ready':
        return '🟢';
      case 'warning':
      case 'degraded':
        return '🟡';
      case 'critical':
      case 'error':
      case 'failed':
        return '🔴';
      case 'down':
      case 'offline':
        return '⚫';
      default:
        return '🔵';
    }
  }
  
  private async gracefulShutdown(signal: string): Promise<void> {
    console.log(`\n🛑 接收到${signal}信号，开始优雅关闭...`);
    
    try {
      // 停止接受新请求
      if (this.healthCheckServer) {
        this.healthCheckServer.close();
        console.log('✅ 健康检查服务器已关闭');
      }
      
      if (this.metricsServer) {
        this.metricsServer.close();
        console.log('✅ 指标服务器已关闭');
      }
      
      // 关闭备份系统
      if (this.backupSystem) {
        console.log('🔄 正在关闭备份系统...');
        await this.backupSystem.shutdown();
        console.log('✅ 备份系统已关闭');
      }
      
      console.log('✅ 优雅关闭完成');
      process.exit(0);
    } catch (error) {
      console.error('❌ 优雅关闭失败:', error);
      process.exit(1);
    }
  }
  
  private async handleReload(): Promise<void> {
    console.log('🔄 接收到重载信号...');
    // TODO: 实现配置重载逻辑
    console.log('⚠️ 配置重载功能尚未实现');
  }
  
  private async handleStatusReport(): Promise<void> {
    console.log('📊 生成状态报告...');
    await this.displaySystemStatus();
  }
}

// 主函数
async function main(): Promise<void> {
  const starter = new BackupSystemStarter();
  await starter.start();
}

// 运行
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  });
}

export { BackupSystemStarter };