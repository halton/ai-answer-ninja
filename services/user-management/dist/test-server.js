"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var app = (0, express_1.default)();
var PORT = process.env.PORT || 3005;
// Basic middleware
app.use(express_1.default.json());
// Health check endpoint
app.get('/health', function (req, res) {
    res.json({
        status: 'ok',
        service: 'user-management-test',
        timestamp: new Date().toISOString(),
        version: '1.0.0-test'
    });
});
// Ready check endpoint
app.get('/ready', function (req, res) {
    res.json({
        status: 'ready',
        service: 'user-management-test'
    });
});
// Basic API info
app.get('/', function (req, res) {
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
app.post('/api/auth/test', function (req, res) {
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
app.use(function (err, req, res, next) {
    console.error('Error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: err.message
    });
});
// 404 handler
app.use('*', function (req, res) {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found',
        path: req.originalUrl
    });
});
// Start server
if (require.main === module) {
    app.listen(PORT, function () {
        console.log("\u2705 Test User Management Service running on port ".concat(PORT));
        console.log("\uD83C\uDFE5 Health check: http://localhost:".concat(PORT, "/health"));
    });
}
exports.default = app;
