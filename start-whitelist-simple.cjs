const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3006;

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
    
    if (parsedUrl.pathname === '/ping' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            service: 'smart-whitelist',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        }));
        return;
    }
    
    if (parsedUrl.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'smart-whitelist',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        }));
        return;
    }
    
    if (parsedUrl.pathname === '/api/whitelist' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            whitelist: [],
            total: 0,
            message: 'Mock whitelist service'
        }));
        return;
    }
    
    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        error: 'Not Found',
        message: `Route ${req.method} ${parsedUrl.pathname} not found`,
        availableEndpoints: [
            'GET /ping',
            'GET /health',
            'GET /api/whitelist'
        ]
    }));
});

server.listen(PORT, () => {
    console.log(`🛡️  Smart Whitelist (Simple) running on port ${PORT}`);
    console.log('Available endpoints:');
    console.log('  - GET /ping');
    console.log('  - GET /health');
    console.log('  - GET /api/whitelist');
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