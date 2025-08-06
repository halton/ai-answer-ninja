import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();
const PORT = process.env.PORT || 3002;

// 安全中间件
app.use(helmet());
app.use(cors());
app.use(express.json());

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'realtime-processor',
    version: '1.0.0'
  });
});

// API信息端点
app.get('/api/info', (req, res) => {
  res.json({
    name: 'AI Answer Ninja - Real-time Processor',
    version: '1.0.0',
    description: 'Real-time audio processing service',
    endpoints: {
      health: '/health',
      info: '/api/info',
      metrics: '/metrics'
    }
  });
});

// 指标端点 (简化版)
app.get('/metrics', (req, res) => {
  const metrics = {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    timestamp: new Date().toISOString()
  };
  res.json(metrics);
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Real-time Processor Service started successfully`);
  console.log(`🌐 Server running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`📋 API info: http://0.0.0.0:${PORT}/api/info`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});