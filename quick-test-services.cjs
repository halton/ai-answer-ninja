#!/usr/bin/env node

/**
 * Quick Service Health Check for AI Answer Ninja E2E Testing
 * 快速检查核心服务健康状态
 */

const http = require('http');

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
        const req = http.get(url, (res) => {
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
    console.log(colorize('='.repeat(50), 'blue'));
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
    console.log(colorize('-'.repeat(20), 'blue'));
    
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

// Run the tests
async function main() {
    try {
        const summary = await testAllServices();
        
        console.log('');
        console.log(colorize('📋 Current Status:', 'blue'));
        
        if (summary.healthy) {
            console.log('✅ Azure Mock service is running and ready!');
            console.log('');
            console.log('Next steps:');
            console.log('  1. Start other core services');
            console.log('  2. Run this check again');
            console.log('  3. When all services are ready, run E2E tests');
        } else {
            console.log('⚠️ Some services need to be started.');
            console.log('');
            console.log('To start missing services:');
            console.log('  ./local-e2e-setup.sh    # Start all services');
        }
        
        process.exit(summary.healthy ? 0 : 1);
        
    } catch (error) {
        console.error(colorize(`💥 Test execution failed: ${error.message}`, 'red'));
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}