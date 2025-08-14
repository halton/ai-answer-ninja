#!/usr/bin/env node

/**
 * Basic E2E Test for AI Answer Ninja
 * 基础端到端测试 - 验证核心服务功能
 */

const http = require('http');

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

function makeRequest(method, url, data = null, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: method.toUpperCase(),
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'E2E-Test/1.0'
            },
            timeout: timeout
        };

        if (data && method.toUpperCase() !== 'GET') {
            const jsonData = JSON.stringify(data);
            options.headers['Content-Length'] = Buffer.byteLength(jsonData);
        }

        const req = http.request(options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsed = responseData ? JSON.parse(responseData) : {};
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: parsed
                    });
                } catch (error) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: responseData
                    });
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (data && method.toUpperCase() !== 'GET') {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

// E2E Test Scenarios
const e2eTests = [
    {
        name: 'Service Health Check',
        description: '验证所有核心服务健康状态',
        test: async () => {
            const services = [
                { name: 'Azure Mock', url: 'http://localhost:4000/health' },
                { name: 'User Management', url: 'http://localhost:3005/health' },
                { name: 'Realtime Processor', url: 'http://localhost:3002/health' },
                { name: 'Smart Whitelist', url: 'http://localhost:3006/ping' }
            ];

            const results = [];
            for (const service of services) {
                try {
                    const response = await makeRequest('GET', service.url);
                    results.push({
                        name: service.name,
                        healthy: response.statusCode === 200,
                        response: response.data
                    });
                } catch (error) {
                    results.push({
                        name: service.name,
                        healthy: false,
                        error: error.message
                    });
                }
            }

            const healthyCount = results.filter(r => r.healthy).length;
            return {
                success: healthyCount === services.length,
                message: `${healthyCount}/${services.length} services healthy`,
                details: results
            };
        }
    },
    
    {
        name: 'Azure Mock API Test',
        description: '测试Azure Mock服务API功能',
        test: async () => {
            const tests = [
                {
                    name: 'OpenAI Chat Completion',
                    method: 'POST',
                    url: 'http://localhost:4000/openai/deployments/test/chat/completions',
                    data: {
                        messages: [
                            { role: 'user', content: 'Hello, I am calling about loan opportunities' }
                        ]
                    }
                },
                {
                    name: 'Incoming Call Webhook',
                    method: 'POST', 
                    url: 'http://localhost:4000/webhook/incoming-call',
                    data: {
                        eventType: 'Microsoft.Communication.CallConnected',
                        data: {
                            callLegId: 'test-call-123',
                            from: { phoneNumber: '+1234567890' },
                            to: { phoneNumber: '+0987654321' }
                        }
                    }
                }
            ];

            const results = [];
            for (const test of tests) {
                try {
                    const response = await makeRequest(test.method, test.url, test.data);
                    results.push({
                        name: test.name,
                        success: response.statusCode === 200,
                        statusCode: response.statusCode,
                        response: response.data
                    });
                } catch (error) {
                    results.push({
                        name: test.name,
                        success: false,
                        error: error.message
                    });
                }
            }

            const successCount = results.filter(r => r.success).length;
            return {
                success: successCount === tests.length,
                message: `${successCount}/${tests.length} API tests passed`,
                details: results
            };
        }
    },

    {
        name: 'Service Integration Test',
        description: '验证服务间基础通信',
        test: async () => {
            try {
                // Test basic service endpoints
                const userMgmtResponse = await makeRequest('GET', 'http://localhost:3005/health');
                const whitelistResponse = await makeRequest('GET', 'http://localhost:3006/api/whitelist');
                const realtimeResponse = await makeRequest('GET', 'http://localhost:3002/realtime/conversation');

                const allSuccessful = [userMgmtResponse, whitelistResponse, realtimeResponse]
                    .every(r => r.statusCode === 200);

                return {
                    success: allSuccessful,
                    message: allSuccessful ? 'All service integrations working' : 'Some integrations failed',
                    details: {
                        userManagement: userMgmtResponse.statusCode === 200,
                        whitelist: whitelistResponse.statusCode === 200,
                        realtime: realtimeResponse.statusCode === 200
                    }
                };
            } catch (error) {
                return {
                    success: false,
                    message: `Integration test failed: ${error.message}`,
                    error: error.message
                };
            }
        }
    }
];

async function runE2ETest(test) {
    console.log(`\nRunning: ${colorize(test.name, 'cyan')}`);
    console.log(`Description: ${test.description}`);
    
    const startTime = Date.now();
    
    try {
        const result = await test.test();
        const duration = Date.now() - startTime;
        
        const statusColor = result.success ? 'green' : 'red';
        const statusIcon = result.success ? '✅' : '❌';
        
        console.log(`${statusIcon} ${colorize(result.message, statusColor)} (${duration}ms)`);
        
        if (result.details) {
            console.log('Details:');
            if (Array.isArray(result.details)) {
                result.details.forEach(detail => {
                    const icon = detail.healthy || detail.success ? '  ✓' : '  ✗';
                    console.log(`${icon} ${detail.name}`);
                });
            } else {
                Object.entries(result.details).forEach(([key, value]) => {
                    const icon = value ? '  ✓' : '  ✗';
                    console.log(`${icon} ${key}: ${value}`);
                });
            }
        }
        
        return { 
            name: test.name, 
            success: result.success, 
            duration, 
            message: result.message 
        };
        
    } catch (error) {
        const duration = Date.now() - startTime;
        console.log(`❌ ${colorize(`Test failed: ${error.message}`, 'red')} (${duration}ms)`);
        
        return { 
            name: test.name, 
            success: false, 
            duration, 
            error: error.message 
        };
    }
}

async function runAllE2ETests() {
    console.log(colorize('🚀 AI Answer Ninja - Basic E2E Test Suite', 'blue'));
    console.log(colorize('=' * 60, 'blue'));
    
    const startTime = Date.now();
    const results = [];
    
    for (const test of e2eTests) {
        const result = await runE2ETest(test);
        results.push(result);
    }
    
    const totalDuration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;
    
    console.log('\n' + colorize('📊 E2E TEST SUMMARY', 'blue'));
    console.log(colorize('-' * 30, 'blue'));
    
    if (successCount === totalCount) {
        console.log(colorize(`🎉 All ${totalCount} tests passed!`, 'green'));
    } else {
        console.log(colorize(`⚠️ ${successCount}/${totalCount} tests passed`, 'yellow'));
        
        const failedTests = results.filter(r => !r.success);
        console.log('\n' + colorize('Failed tests:', 'red'));
        failedTests.forEach(test => {
            console.log(`  - ${test.name}: ${test.error || test.message}`);
        });
    }
    
    console.log(`\nTotal execution time: ${totalDuration}ms`);
    console.log(`Average test time: ${Math.round(totalDuration / totalCount)}ms`);
    
    console.log('\n' + colorize('🔗 Service Status:', 'cyan'));
    console.log('  Azure Mock Services:  http://localhost:4000/health');
    console.log('  User Management:      http://localhost:3005/health');
    console.log('  Realtime Processor:   http://localhost:3002/health');
    console.log('  Smart Whitelist:      http://localhost:3006/ping');
    
    if (successCount === totalCount) {
        console.log('\n' + colorize('✅ System is ready for advanced E2E testing!', 'green'));
        console.log('\nNext steps:');
        console.log('  1. Run full E2E test suite');
        console.log('  2. Test with real browser automation');
        console.log('  3. Performance and load testing');
    } else {
        console.log('\n' + colorize('⚠️ Fix failed tests before proceeding', 'yellow'));
    }
    
    return {
        success: successCount === totalCount,
        totalTests: totalCount,
        passedTests: successCount,
        failedTests: totalCount - successCount,
        duration: totalDuration,
        results
    };
}

// Run the tests
async function main() {
    try {
        const summary = await runAllE2ETests();
        process.exit(summary.success ? 0 : 1);
    } catch (error) {
        console.error(colorize(`💥 E2E test execution failed: ${error.message}`, 'red'));
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}