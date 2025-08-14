const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

// Basic health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'realtime-processor',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Basic ping endpoint
app.get('/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});

// WebSocket endpoint placeholder
app.get('/realtime/conversation', (req, res) => {
    res.json({
        message: 'WebSocket endpoint available',
        upgrade: 'ws://localhost:3002/realtime/conversation'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🎧 Realtime Processor (Simple) running on port ${PORT}`);
    console.log('Available endpoints:');
    console.log('  - GET /health');
    console.log('  - GET /ping');
    console.log('  - GET /realtime/conversation');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    process.exit(0);
});