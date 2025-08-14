import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { logger } from './utils/logger';
import { AzureSpeechMockService } from './services/AzureSpeechMockService';
import { AzureOpenAIMockService } from './services/AzureOpenAIMockService';
import { AzureCommunicationMockService } from './services/AzureCommunicationMockService';

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 初始化Mock服务
const speechMock = new AzureSpeechMockService();
const openaiMock = new AzureOpenAIMockService();
const communicationMock = new AzureCommunicationMockService();

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      speech: 'active',
      openai: 'active',
      communication: 'active'
    }
  });
});

// Mock服务状态端点
app.get('/mock/status', (req, res) => {
  res.json({
    services: {
      speech: {
        status: 'active',
        endpoints: [
          'POST /speech/stt',
          'POST /speech/tts',
          'GET /speech/voices'
        ]
      },
      openai: {
        status: 'active',
        endpoints: [
          'POST /openai/chat/completions',
          'POST /openai/completions'
        ]
      },
      communication: {
        status: 'active',
        endpoints: [
          'POST /communication/calling/callConnections',
          'POST /communication/calling/callConnections/:callId/answer',
          'POST /communication/calling/callConnections/:callId/hangup'
        ]
      }
    },
    totalRequests: speechMock.getRequestCount() + openaiMock.getRequestCount() + communicationMock.getRequestCount(),
    uptime: process.uptime()
  });
});

// ===========================================
// Azure Speech Services Mock
// ===========================================

// Speech-to-Text Mock
app.post('/speech/stt', (req, res) => {
  logger.info('Speech STT request received');
  const result = speechMock.speechToText(req.body);
  res.json(result);
});

// Text-to-Speech Mock
app.post('/speech/tts', (req, res) => {
  logger.info('Speech TTS request received');
  const result = speechMock.textToSpeech(req.body);
  
  if (req.headers.accept?.includes('audio/')) {
    // 返回模拟音频数据
    res.setHeader('Content-Type', 'audio/wav');
    res.send(result.audioData);
  } else {
    res.json(result);
  }
});

// 获取可用语音列表
app.get('/speech/voices', (req, res) => {
  logger.info('Speech voices list request received');
  const voices = speechMock.getVoicesList();
  res.json(voices);
});

// ===========================================
// Azure OpenAI Mock
// ===========================================

// Chat Completions Mock
app.post('/openai/chat/completions', (req, res) => {
  logger.info('OpenAI Chat Completions request received');
  const result = openaiMock.chatCompletions(req.body);
  res.json(result);
});

// Legacy Completions Mock
app.post('/openai/completions', (req, res) => {
  logger.info('OpenAI Completions request received');
  const result = openaiMock.completions(req.body);
  res.json(result);
});

// ===========================================
// Azure Communication Services Mock
// ===========================================

// 创建通话连接
app.post('/communication/calling/callConnections', (req, res) => {
  logger.info('Communication create call connection request received');
  const result = communicationMock.createCallConnection(req.body);
  res.json(result);
});

// 接听电话
app.post('/communication/calling/callConnections/:callId/answer', (req, res) => {
  logger.info(`Communication answer call request received for callId: ${req.params.callId}`);
  const result = communicationMock.answerCall(req.params.callId, req.body);
  res.json(result);
});

// 挂断电话
app.post('/communication/calling/callConnections/:callId/hangup', (req, res) => {
  logger.info(`Communication hangup call request received for callId: ${req.params.callId}`);
  const result = communicationMock.hangupCall(req.params.callId);
  res.json(result);
});

// 转接电话
app.post('/communication/calling/callConnections/:callId/transfer', (req, res) => {
  logger.info(`Communication transfer call request received for callId: ${req.params.callId}`);
  const result = communicationMock.transferCall(req.params.callId, req.body);
  res.json(result);
});

// 播放音频
app.post('/communication/calling/callConnections/:callId/play', (req, res) => {
  logger.info(`Communication play audio request received for callId: ${req.params.callId}`);
  const result = communicationMock.playAudio(req.params.callId, req.body);
  res.json(result);
});

// ===========================================
// 通用Mock工具端点
// ===========================================

// 重置所有Mock数据
app.post('/mock/reset', (req, res) => {
  logger.info('Resetting all mock services');
  speechMock.reset();
  openaiMock.reset();
  communicationMock.reset();
  
  res.json({
    status: 'success',
    message: 'All mock services have been reset',
    timestamp: new Date().toISOString()
  });
});

// 设置Mock行为
app.post('/mock/config', (req, res) => {
  const { service, config } = req.body;
  
  logger.info(`Configuring mock service: ${service}`);
  
  try {
    switch (service) {
      case 'speech':
        speechMock.configure(config);
        break;
      case 'openai':
        openaiMock.configure(config);
        break;
      case 'communication':
        communicationMock.configure(config);
        break;
      default:
        return res.status(400).json({ error: 'Unknown service' });
    }
    
    res.json({
      status: 'success',
      service,
      config,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error configuring mock service:', error);
    res.status(500).json({ error: 'Configuration failed' });
  }
});

// 获取Mock统计信息
app.get('/mock/stats', (req, res) => {
  res.json({
    services: {
      speech: speechMock.getStats(),
      openai: openaiMock.getStats(),
      communication: communicationMock.getStats()
    },
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    }
  });
});

// 错误处理中间件
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// 404处理
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  logger.info(`🎭 Azure Mock Service started on port ${port}`);
  logger.info('📍 Available endpoints:');
  logger.info('  • Health Check:     GET  /health');
  logger.info('  • Mock Status:      GET  /mock/status');
  logger.info('  • Speech STT:       POST /speech/stt');
  logger.info('  • Speech TTS:       POST /speech/tts');
  logger.info('  • OpenAI Chat:      POST /openai/chat/completions');
  logger.info('  • Communication:    POST /communication/calling/callConnections');
  logger.info('  • Mock Reset:       POST /mock/reset');
  logger.info('  • Mock Config:      POST /mock/config');
  logger.info('  • Mock Stats:       GET  /mock/stats');
});

export default app;