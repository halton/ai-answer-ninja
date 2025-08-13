# AI Phone System - E2E Test Suite

Comprehensive end-to-end test suite for the AI Phone Answering System, providing automated testing across all service integrations and user workflows.

## Features

### 🔧 Test Scenarios
- **Call Processing E2E**: Complete incoming call workflow from reception to AI response
- **User Management E2E**: User registration, authentication, profile management, and GDPR compliance
- **Whitelist Management E2E**: Manual and smart whitelist operations with ML-driven filtering

### 🚀 Execution Capabilities
- **Parallel Execution**: Run multiple test suites simultaneously with configurable concurrency
- **Environment Isolation**: Data and service isolation between test runs
- **Dependency Management**: Automatic test ordering based on service dependencies
- **Health Monitoring**: Pre-execution validation and real-time service health checks

### 📊 Reporting & Analytics
- **Multiple Formats**: HTML, JSON, JUnit XML, and CSV reports
- **Performance Metrics**: Response times, throughput, SLA compliance
- **Coverage Analysis**: Endpoint and service coverage tracking
- **Trend Analysis**: Historical performance comparison
- **Real-time Dashboard**: Live execution monitoring via WebSocket

### 🛠️ Developer Experience
- **CLI Interface**: Command-line tool with rich options
- **Programmatic API**: Use as a library in other projects
- **Test Data Factory**: Realistic test data generation
- **Retry Logic**: Automatic retry for transient failures
- **Notifications**: Slack, Teams, and email integration

## Quick Start

### Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Generate sample configuration
npm run config:generate
```

### Basic Usage

```bash
# Run all E2E tests
npm test

# Run specific test suites
npm run test:suites CallProcessing,UserManagement

# Run with parallel execution
npm run test:parallel

# Run with real-time monitoring
npm run test:realtime

# Check execution plan
npm run plan

# Health check all services
npm run health
```

### Configuration

Create `e2e-config.json`:

```json
{
  "services": {
    "userManagement": "http://localhost:3005",
    "smartWhitelist": "http://localhost:3006",
    "conversationEngine": "http://localhost:3003",
    "realtimeProcessor": "http://localhost:3002",
    "profileAnalytics": "http://localhost:3004",
    "phoneGateway": "http://localhost:3001"
  },
  "environment": "development",
  "testSuites": [],
  "execution": {
    "parallel": true,
    "maxConcurrency": 4,
    "timeout": 300000,
    "retries": 2
  },
  "reporting": {
    "formats": ["html", "json", "junit"],
    "outputDir": "./test-results",
    "realtime": false
  },
  "notifications": {
    "slack": {
      "webhook": "https://hooks.slack.com/services/..."
    }
  }
}
```

## CLI Reference

### Commands

#### `run` - Execute E2E Tests
```bash
ai-ninja-e2e run [options]

Options:
  -c, --config <file>      Configuration file path
  -s, --suites <suites>    Comma-separated test suites to run
  -e, --environment <env>  Test environment (development|staging|production)
  --parallel               Run tests in parallel (default)
  --no-parallel           Run tests sequentially
  --concurrency <num>      Maximum concurrent execution (default: 4)
  --timeout <ms>           Test timeout in milliseconds (default: 300000)
  --output <dir>           Output directory for reports (default: ./test-results)
  --format <formats>       Report formats: html,json,junit,csv
  --realtime              Enable real-time monitoring
  --slack-webhook <url>    Slack webhook for notifications
  --verbose               Verbose logging
```

#### `plan` - Show Execution Plan
```bash
ai-ninja-e2e plan [options]

Shows estimated execution time, resource requirements, and test ordering.
```

#### `health` - Service Health Check
```bash
ai-ninja-e2e health [options]

Checks health status of all configured services.
```

#### `generate-config` - Generate Configuration
```bash
ai-ninja-e2e generate-config [options]

Options:
  -o, --output <file>      Output file path (default: ./e2e-config.json)
```

## Test Suite Details

### Call Processing E2E Test

Tests the complete call processing workflow:

1. **Complete Call Processing Workflow**: End-to-end call handling
2. **Concurrent Call Processing**: High-volume parallel call handling
3. **Edge Cases**: Invalid data, timeouts, error conditions

**Key Metrics:**
- Whitelist check time: < 200ms
- Profile analysis time: < 300ms  
- AI processing time: < 800ms
- Total latency: < 1500ms
- Response accuracy: > 85%

### User Management E2E Test

Tests user lifecycle and management:

1. **User Registration Flow**: Complete onboarding process
2. **Authentication & Sessions**: Login, MFA, session management
3. **GDPR Compliance**: Data export, rectification, deletion

**Key Metrics:**
- Registration time: < 2000ms
- Authentication time: < 1000ms
- Data export completion: < 60s
- GDPR compliance: 100%

### Whitelist Management E2E Test

Tests whitelist functionality:

1. **Basic CRUD Operations**: Add, update, remove contacts
2. **Smart Automation**: ML-driven whitelist decisions
3. **Bulk Operations**: High-volume contact management

**Key Metrics:**
- Lookup time: < 100ms
- ML accuracy: > 85%
- False positive rate: < 5%
- Bulk operation time: < 5000ms

## Architecture

### Component Overview

```
E2ETestOrchestrator
├── TestApiClient           # HTTP client with circuit breakers
├── ServiceHealthChecker    # Service dependency validation
├── TestExecutor           # Parallel execution management
├── TestReporter           # Multi-format reporting
├── TestDataFactory        # Realistic test data generation
└── Test Scenarios
    ├── CallProcessingE2ETest
    ├── UserManagementE2ETest
    └── WhitelistManagementE2ETest
```

### Execution Flow

1. **Planning**: Analyze test dependencies and create execution plan
2. **Validation**: Verify service health and connectivity
3. **Execution**: Run tests with proper isolation and monitoring
4. **Reporting**: Generate comprehensive reports and notifications
5. **Cleanup**: Clean up test data and resources

### Parallel Execution

The test executor supports:
- **Worker Pool**: Configurable number of isolated workers
- **Job Queue**: Priority-based test scheduling
- **Load Balancing**: Optimal worker selection strategies
- **Circuit Breakers**: Fault tolerance for service failures
- **Resource Management**: Memory and CPU limit enforcement

## Environment Setup

### Development Environment

```bash
# Start all services
docker-compose up -d

# Wait for services to be ready
npm run health

# Run tests
npm test
```

### CI/CD Integration

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests
on: [push, pull_request]

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
        working-directory: tests/e2e
        
      - name: Start services
        run: docker-compose up -d
        
      - name: Wait for services
        run: npm run health
        working-directory: tests/e2e
        
      - name: Run E2E tests
        run: npm test -- --format junit,html
        working-directory: tests/e2e
        
      - name: Upload test results
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: e2e-test-results
          path: tests/e2e/test-results/
```

## API Reference

### Programmatic Usage

```typescript
import { E2ETestOrchestrator, E2ETestConfig } from '@ai-ninja/e2e-test-suite';

const config: E2ETestConfig = {
  services: {
    userManagement: 'http://localhost:3005',
    // ... other services
  },
  execution: {
    parallel: true,
    maxConcurrency: 4,
    timeout: 300000,
    retries: 2
  }
};

const orchestrator = new E2ETestOrchestrator(config);

// Execute tests
const result = await orchestrator.executeTests();

console.log(`Tests completed: ${result.success ? 'PASSED' : 'FAILED'}`);
console.log(`Pass rate: ${result.summary.passRate}%`);
```

### Custom Test Scenarios

```typescript
import { TestApiClient, TestDataFactory } from '@ai-ninja/e2e-test-suite';

class CustomE2ETest {
  private apiClient: TestApiClient;
  private dataFactory: TestDataFactory;

  constructor(apiClient: TestApiClient) {
    this.apiClient = apiClient;
    this.dataFactory = new TestDataFactory();
  }

  async testCustomWorkflow(): Promise<TestResult> {
    const user = this.dataFactory.createTestUser();
    
    // Create user
    const response = await this.apiClient.post('/api/users', user);
    
    // Verify response
    return {
      name: 'Custom Workflow Test',
      status: response.status === 201 ? 'passed' : 'failed',
      duration: 1000,
      // ... other properties
    };
  }
}
```

## Performance Benchmarks

### Typical Performance (Development Environment)

| Metric | Target | Typical | Best Case |
|--------|---------|---------|-----------|
| Total Execution Time | < 10 min | 6-8 min | 4 min |
| Call Processing Latency | < 1500ms | 800ms | 600ms |
| User Registration Time | < 2000ms | 1200ms | 800ms |
| Whitelist Lookup Time | < 100ms | 45ms | 25ms |
| ML Prediction Accuracy | > 85% | 92% | 95% |

### Scalability

- **Concurrent Users**: Up to 100 simulated users
- **Parallel Tests**: Up to 10 concurrent test suites
- **Memory Usage**: ~512MB per worker process
- **Network Throughput**: ~10 requests/second per worker

## Troubleshooting

### Common Issues

#### Service Connection Failures
```
❌ Service user-management failed health check
```
**Solution**: Check if services are running and accessible at configured URLs.

#### Test Timeouts
```
❌ Test timeout after 300000ms
```
**Solution**: Increase timeout or check for performance issues in services.

#### Memory Issues
```
❌ Worker process exceeded memory limit
```
**Solution**: Reduce concurrency or increase memory limits.

#### Data Conflicts
```
❌ User with phone +86130xxx already exists
```
**Solution**: Enable aggressive cleanup or use unique test data.

### Debug Mode

Run with verbose logging:
```bash
npm run dev:run -- --verbose
```

Enable real-time monitoring:
```bash
npm run test:realtime
```

View detailed logs:
```bash
tail -f test-results/execution-log.json
```

## Contributing

### Development Setup

1. Clone repository
2. Install dependencies: `npm install`
3. Start development: `npm run dev`
4. Run linting: `npm run lint`
5. Format code: `npm run format`

### Adding New Test Scenarios

1. Create new test class in `src/scenarios/`
2. Implement test methods returning `TestResult`
3. Register in `E2ETestOrchestrator`
4. Add CLI integration
5. Update documentation

### Test Data Guidelines

- Use `TestDataFactory` for consistent data generation
- Ensure data uniqueness across parallel executions
- Clean up test data after execution
- Avoid hard-coded values that may conflict

## License

MIT © AI Ninja Team