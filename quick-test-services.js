#!/usr/bin/env node

/**
 * Quick Service Health Check for AI Answer Ninja E2E Testing
 * 快速检查核心服务健康状态
 */

const http = require('http');
const https = require('https');

// Service endpoints to test
const services = [
    {
        name: 'Azure Mock Services',
        url: 'http://localhost:4000/health',
        expected: { status: 'healthy' }
    },
    {
        name: 'User Management',
        url: 'http://localhost:3005/health',
        expected: { status: 'healthy' }
    },
    {
        name: 'Realtime Processor',
        url: 'http://localhost:3002/health',
        expected: { status: 'healthy' }
    },
    {
        name: 'Smart Whitelist',
        url: 'http://localhost:3006/ping',
        expected: { status: 'ok' }
    }
];

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function colorize(text, color) {
    return `${colors[color]}${text}${colors.reset}`;
}

function makeRequest(url, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        
        const req = client.get(url, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({
                        statusCode: res.statusCode,
                        data: parsed
                    });
                } catch (error) {
                    resolve({
                        statusCode: res.statusCode,
                        data: data
                    });
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.setTimeout(timeout, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

async function testService(service) {
    console.log(`Testing ${colorize(service.name, 'cyan')}...`);
    
    try {
        const startTime = Date.now();
        const response = await makeRequest(service.url);
        const duration = Date.now() - startTime;
        
        const isHealthy = response.statusCode === 200;
        const statusColor = isHealthy ? 'green' : 'red';
        const statusText = isHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY';
        
        console.log(`  ${colorize(statusText, statusColor)} (${duration}ms)`);
        
        if (response.data && typeof response.data === 'object') {
            console.log(`  Status: ${response.data.status || 'unknown'}`);
            if (response.data.timestamp) {
                console.log(`  Last check: ${new Date(response.data.timestamp).toLocaleTimeString()}`);
            }
            if (response.data.uptime !== undefined) {
                console.log(`  Uptime: ${Math.round(response.data.uptime)}s`);
            }
        }
        
        return {
            name: service.name,
            healthy: isHealthy,
            duration,
            data: response.data
        };
        
    } catch (error) {
        console.log(`  ${colorize('❌ FAILED', 'red')} - ${error.message}`);
        
        return {
            name: service.name,
            healthy: false,
            error: error.message
        };
    }
}

async function testAllServices() {
    console.log(colorize('🚀 AI Answer Ninja - Service Health Check', 'blue'));
    console.log(colorize('=' * 50, 'blue'));
    console.log('');
    
    const results = [];
    
    for (const service of services) {
        const result = await testService(service);
        results.push(result);
        console.log('');
    }
    
    // Summary
    const healthyCount = results.filter(r => r.healthy).length;
    const totalCount = results.length;
    
    console.log(colorize('📊 SUMMARY', 'blue'));
    console.log(colorize('-' * 20, 'blue'));
    
    if (healthyCount === totalCount) {
        console.log(colorize(`✅ All ${totalCount} services are healthy!`, 'green'));
    } else {
        console.log(colorize(`⚠️ ${healthyCount}/${totalCount} services are healthy`, 'yellow'));
        
        const unhealthyServices = results.filter(r => !r.healthy);
        console.log('');
        console.log(colorize('Failed services:', 'red'));
        unhealthyServices.forEach(service => {
            console.log(`  - ${service.name}: ${service.error || 'Unknown error'}`);
        });
    }
    
    console.log('');
    console.log(colorize('🔗 Service URLs:', 'cyan'));
    services.forEach(service => {
        const status = results.find(r => r.name === service.name);
        const icon = status && status.healthy ? '✅' : '❌';
        console.log(`  ${icon} ${service.name}: ${service.url}`);
    });
    
    return {
        healthy: healthyCount === totalCount,
        total: totalCount,
        healthyCount,
        results
    };
}

// Test Azure Mock functionality
async function testAzureMockFunctions() {
    console.log('');
    console.log(colorize('🎭 Testing Azure Mock Functions', 'blue'));
    console.log(colorize('-' * 30, 'blue'));
    
    try {
        // Test OpenAI mock
        console.log('Testing OpenAI chat completion...');
        const openaiResponse = await makeRequest('http://localhost:4000/openai/deployments/test/chat/completions', 5000);
        console.log(`  Status: ${openaiResponse.statusCode}`);
        
        // Test webhook
        console.log('Testing webhook endpoint...');
        const webhookResponse = await makeRequest('http://localhost:4000/webhook/incoming-call', 5000);
        console.log(`  Status: ${webhookResponse.statusCode}`);
        
        console.log(colorize('✅ Azure Mock functions are responding', 'green'));
        
    } catch (error) {
        console.log(colorize(`❌ Azure Mock function test failed: ${error.message}`, 'red'));
    }
}

// Run the tests
async function main() {
    try {
        const summary = await testAllServices();
        await testAzureMockFunctions();
        
        console.log('');
        console.log(colorize('📋 Next Steps:', 'blue'));
        
        if (summary.healthy) {
            console.log('✅ All services are ready for E2E testing!');
            console.log('');
            console.log('You can now run:');
            console.log('  npm run test:e2e                  # Run E2E tests');
            console.log('  ./local-e2e-cleanup.sh           # Stop all services');
        } else {
            console.log('⚠️ Some services need attention before running E2E tests.');
            console.log('');
            console.log('To troubleshoot:');
            console.log('  1. Check if all dependencies are installed');
            console.log('  2. Verify database connections');
            console.log('  3. Check service logs');
            console.log('  4. Try restarting failed services');
        }
        
        process.exit(summary.healthy ? 0 : 1);
        
    } catch (error) {
        console.error(colorize(`💥 Test execution failed: ${error.message}`, 'red'));
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nTest interrupted by user');
    process.exit(1);
});

process.on('SIGTERM', () => {
    console.log('\nTest terminated');
    process.exit(1);
});

if (require.main === module) {
    main();
}