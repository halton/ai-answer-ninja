const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3002;

// Simple HTTP server
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    const parsedUrl = url.parse(req.url, true);
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (parsedUrl.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'realtime-processor',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        }));
        return;
    }
    
    if (parsedUrl.pathname === '/ping' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            timestamp: Date.now()
        }));
        return;
    }
    
    if (parsedUrl.pathname === '/realtime/conversation' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            message: 'WebSocket endpoint available',
            upgrade: 'ws://localhost:3002/realtime/conversation',
            status: 'ready'
        }));
        return;
    }
    
    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        error: 'Not Found',
        message: `Route ${req.method} ${parsedUrl.pathname} not found`,
        availableEndpoints: [
            'GET /health',
            'GET /ping',
            'GET /realtime/conversation'
        ]
    }));
});

server.listen(PORT, () => {
    console.log(`🎧 Realtime Processor (Simple) running on port ${PORT}`);
    console.log('Available endpoints:');
    console.log('  - GET /health');
    console.log('  - GET /ping');  
    console.log('  - GET /realtime/conversation');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    server.close(() => process.exit(0));
});