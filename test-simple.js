const express = require('express');

const app = express();
const PORT = process.env.PORT || 3005;

// Basic middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'user-management-test',
    timestamp: new Date().toISOString(),
    version: '1.0.0-test',
    pid: process.pid
  });
});

// Ready check endpoint
app.get('/ready', (req, res) => {
  res.json({
    status: 'ready',
    service: 'user-management-test',
    checks: {
      database: 'mocked',
      redis: 'mocked'
    }
  });
});

// Basic API info
app.get('/', (req, res) => {
  res.json({
    service: 'AI Answer Ninja - User Management Service (Test)',
    version: '1.0.0-test',
    environment: 'test',
    status: 'running',
    endpoints: {
      health: '/health',
      ready: '/ready',
      auth: '/api/auth/test'
    }
  });
});

// Test authentication endpoint
app.post('/api/auth/test', (req, res) => {
  console.log('Auth test request received:', req.body);
  
  res.json({
    success: true,
    message: 'Test authentication endpoint working',
    data: {
      authenticated: false,
      note: 'This is a test endpoint - no real auth',
      timestamp: new Date().toISOString()
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`✅ Test User Management Service running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 Ready check: http://localhost:${PORT}/ready`);
  console.log(`📖 API info: http://localhost:${PORT}/`);
});

module.exports = { app, server };