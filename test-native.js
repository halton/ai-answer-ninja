// Native Node.js Test Server - No dependencies required
const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3005;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check endpoint
  if (path === '/health' && method === 'GET') {
    const healthData = {
      status: 'ok',
      service: 'ai-ninja-test-service',
      timestamp: new Date().toISOString(),
      version: '1.0.0-test',
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development'
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthData, null, 2));
    return;
  }

  // API info endpoint
  if (path === '/' && method === 'GET') {
    const apiInfo = {
      service: 'AI Answer Ninja - Test Service',
      version: '1.0.0-test',
      environment: 'development',
      status: 'running',
      endpoints: {
        health: '/health',
        ready: '/ready',
        metrics: '/metrics',
        api: {
          users: '/api/users',
          calls: '/api/calls',
          whitelist: '/api/whitelist'
        }
      },
      timestamp: new Date().toISOString()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(apiInfo, null, 2));
    return;
  }

  // Ready check endpoint
  if (path === '/ready' && method === 'GET') {
    const readyData = {
      status: 'ready',
      service: 'ai-ninja-test-service',
      checks: {
        database: 'simulated-ok',
        redis: 'simulated-ok',
        external_services: 'simulated-ok'
      },
      timestamp: new Date().toISOString()
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(readyData, null, 2));
    return;
  }

  // Metrics endpoint (Prometheus format)
  if (path === '/metrics' && method === 'GET') {
    const metrics = `
# HELP ai_ninja_test_requests_total Total number of requests
# TYPE ai_ninja_test_requests_total counter
ai_ninja_test_requests_total{method="GET",endpoint="/health"} 42
ai_ninja_test_requests_total{method="POST",endpoint="/api/users"} 15

# HELP ai_ninja_test_response_time_seconds Response time in seconds
# TYPE ai_ninja_test_response_time_seconds histogram
ai_ninja_test_response_time_seconds_bucket{le="0.1"} 35
ai_ninja_test_response_time_seconds_bucket{le="0.5"} 55
ai_ninja_test_response_time_seconds_bucket{le="1.0"} 60
ai_ninja_test_response_time_seconds_bucket{le="+Inf"} 62
ai_ninja_test_response_time_seconds_sum 15.2
ai_ninja_test_response_time_seconds_count 62

# HELP ai_ninja_test_active_connections Current active connections
# TYPE ai_ninja_test_active_connections gauge
ai_ninja_test_active_connections 3
`.trim();

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(metrics);
    return;
  }

  // Mock API endpoints
  if (path.startsWith('/api/')) {
    const apiPath = path.replace('/api/', '');
    const mockResponse = {
      success: true,
      message: `Mock API response for ${method} ${path}`,
      data: {
        endpoint: apiPath,
        method: method,
        timestamp: new Date().toISOString(),
        mock: true
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mockResponse, null, 2));
    return;
  }

  // 404 for unknown paths
  const notFoundResponse = {
    success: false,
    message: 'Endpoint not found',
    path: path,
    method: method,
    available_endpoints: ['/health', '/ready', '/metrics', '/api/*']
  };

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(notFoundResponse, null, 2));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`✅ AI Answer Ninja Test Service running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🔧 Ready check: http://localhost:${PORT}/ready`);
  console.log(`📊 Metrics: http://localhost:${PORT}/metrics`);
  console.log(`📖 API info: http://localhost:${PORT}/`);
});

module.exports = { server };