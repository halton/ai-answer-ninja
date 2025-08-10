import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3005;

// Basic middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'user-management-test',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
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
    status: 'running'
  });
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🧪 Test User Management Service running on port ${PORT}`);
  });
}

export default app;