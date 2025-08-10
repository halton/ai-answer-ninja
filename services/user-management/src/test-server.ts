import express from 'express';

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
    version: '1.0.0-test'
  });
});

// Ready check endpoint
app.get('/ready', (req, res) => {
  res.json({
    status: 'ready',
    service: 'user-management-test'
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
      ready: '/ready'
    }
  });
});

// Test authentication endpoint
app.post('/api/auth/test', (req, res) => {
  res.json({
    success: true,
    message: 'Test authentication endpoint',
    data: {
      authenticated: false,
      note: 'This is a test endpoint'
    }
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
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

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Test User Management Service running on port ${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  });
}

export default app;