#!/bin/bash

# AI Answer Ninja - Local E2E Test Environment Setup
# 本地E2E测试环境启动脚本（绕过Docker问题）

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node >/dev/null 2>&1; then
        print_error "Node.js is not installed. Please install Node.js 18+"
        exit 1
    fi
    
    NODE_VERSION=$(node --version | sed 's/v//')
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d. -f1)
    if [ "$MAJOR_VERSION" -lt 18 ]; then
        print_error "Node.js version $NODE_VERSION detected. Please upgrade to Node.js 18+"
        exit 1
    fi
    
    print_success "Node.js $NODE_VERSION detected"
    
    # Check npm
    if ! command -v npm >/dev/null 2>&1; then
        print_error "npm is not installed"
        exit 1
    fi
    
    # Check .env file
    if [ ! -f .env ]; then
        print_warning ".env file not found. Creating from .env.example..."
        if [ -f .env.example ]; then
            cp .env.example .env
            print_success ".env file created"
        else
            print_error ".env.example file not found"
            exit 1
        fi
    fi
}

# Install dependencies for core services
install_dependencies() {
    print_status "Installing dependencies for core services..."
    
    # Core services for E2E testing
    CORE_SERVICES=(
        "services/user-management"
        "services/realtime-processor" 
        "services/smart-whitelist-node"
        "tests/mocks"
    )
    
    for service in "${CORE_SERVICES[@]}"; do
        if [ -d "$service" ] && [ -f "$service/package.json" ]; then
            print_status "Installing dependencies for $service..."
            cd "$service"
            npm install --silent
            cd - > /dev/null
            print_success "Dependencies installed for $service"
        else
            print_warning "Service $service not found or no package.json"
        fi
    done
}

# Start PostgreSQL (using local installation or Docker if available)
start_database() {
    print_status "Starting database services..."
    
    # Try to start PostgreSQL locally first
    if command -v pg_ctl >/dev/null 2>&1; then
        print_status "Starting local PostgreSQL..."
        pg_ctl start -D /usr/local/var/postgres/ 2>/dev/null || print_warning "PostgreSQL may already be running"
    else
        # Try Docker for database only
        if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
            print_status "Starting PostgreSQL and Redis via Docker..."
            docker run -d --name ai-ninja-postgres-e2e \
                -p 5433:5432 \
                -e POSTGRES_PASSWORD=test123 \
                -e POSTGRES_DB=ai_ninja_test \
                postgres:15-alpine >/dev/null 2>&1 || print_warning "PostgreSQL container may already be running"
            
            docker run -d --name ai-ninja-redis-e2e \
                -p 6380:6379 \
                redis:7-alpine >/dev/null 2>&1 || print_warning "Redis container may already be running"
            
            sleep 5
        else
            print_error "No PostgreSQL or Docker available. Please install PostgreSQL or fix Docker."
            exit 1
        fi
    fi
}

# Create Azure Mock Services
create_azure_mocks() {
    print_status "Creating Azure Mock Services..."
    
    mkdir -p tests/mocks/azure
    
    # Create package.json for mocks
    cat > tests/mocks/package.json << 'EOF'
{
  "name": "azure-mocks",
  "version": "1.0.0",
  "description": "Azure Services Mock for E2E Testing",
  "main": "index.js",
  "scripts": {
    "start": "node src/mock-server.js",
    "dev": "nodemon src/mock-server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "body-parser": "^1.20.2",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
EOF

    # Create Azure Mock Server
    cat > tests/mocks/src/mock-server.js << 'EOF'
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.AZURE_MOCK_PORT || 4000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: 'audio/*' }));

// Mock Azure Speech Services
app.post('/speech/recognition/conversation/cognitiveservices/v1', (req, res) => {
    console.log('[Azure STT Mock] Processing speech recognition request');
    
    // Simulate processing delay
    setTimeout(() => {
        const mockResponses = [
            "Hello, I am calling about great loan opportunities",
            "We have special rates just for you", 
            "This is a limited time offer",
            "Can I just have a minute of your time?",
            "I understand you're not interested",
            "Thank you for your time"
        ];
        
        const response = mockResponses[Math.floor(Math.random() * mockResponses.length)];
        
        res.json({
            RecognitionStatus: "Success",
            DisplayText: response,
            Offset: 1000000,
            Duration: 5000000,
            NBest: [{
                Confidence: 0.9,
                Lexical: response.toLowerCase(),
                ITN: response,
                MaskedITN: response,
                Display: response
            }]
        });
    }, 200);
});

// Mock Azure Text-to-Speech
app.post('/speech/synthesize', (req, res) => {
    console.log('[Azure TTS Mock] Processing text-to-speech request');
    
    res.setHeader('Content-Type', 'audio/wav');
    
    // Return mock audio data (empty WAV header)
    const mockAudioData = Buffer.alloc(1024);
    mockAudioData.write('RIFF', 0);
    mockAudioData.writeUInt32LE(1016, 4);
    mockAudioData.write('WAVE', 8);
    
    res.send(mockAudioData);
});

// Mock Azure OpenAI
app.post('/openai/deployments/*/chat/completions', (req, res) => {
    console.log('[Azure OpenAI Mock] Processing chat completion request');
    
    const { messages } = req.body;
    const lastMessage = messages[messages.length - 1]?.content || '';
    
    // Generate contextual responses based on input
    let response = "我现在不方便，谢谢。";
    
    if (lastMessage.includes('loan') || lastMessage.includes('贷款')) {
        response = "我不需要贷款服务，谢谢。";
    } else if (lastMessage.includes('investment') || lastMessage.includes('投资')) {
        response = "我对投资不感兴趣。";
    } else if (lastMessage.includes('insurance') || lastMessage.includes('保险')) {
        response = "我已经有保险了。";
    } else if (lastMessage.includes('time') || lastMessage.includes('minute')) {
        response = "不好意思，我真的没有时间。";
    }
    
    setTimeout(() => {
        res.json({
            id: `chatcmpl-${uuidv4()}`,
            object: "chat.completion",
            created: Date.now(),
            model: "gpt-4",
            choices: [{
                index: 0,
                message: {
                    role: "assistant",
                    content: response
                },
                finish_reason: "stop"
            }],
            usage: {
                prompt_tokens: 50,
                completion_tokens: 20,
                total_tokens: 70
            }
        });
    }, 300);
});

// Mock Azure Communication Services
app.post('/calling/calls/:callId/answer', (req, res) => {
    console.log(`[Azure Communication Mock] Answering call ${req.params.callId}`);
    
    res.json({
        callConnectionId: `conn-${uuidv4()}`,
        callId: req.params.callId,
        state: "connected"
    });
});

app.post('/calling/calls/:callId/transfer', (req, res) => {
    console.log(`[Azure Communication Mock] Transferring call ${req.params.callId}`);
    
    res.json({
        operationContext: uuidv4(),
        resultInfo: {
            code: 200,
            subCode: 0,
            message: "Call transferred successfully"
        }
    });
});

app.post('/calling/calls/:callId/hangup', (req, res) => {
    console.log(`[Azure Communication Mock] Hanging up call ${req.params.callId}`);
    
    res.json({
        operationContext: uuidv4(),
        resultInfo: {
            code: 200,
            subCode: 0,
            message: "Call ended successfully"
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        services: {
            speechToText: 'operational',
            textToSpeech: 'operational',
            openAI: 'operational',
            communication: 'operational'
        },
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🎭 Azure Mock Services running on port ${PORT}`);
    console.log('Available endpoints:');
    console.log('  - POST /speech/recognition/conversation/cognitiveservices/v1 (STT)');
    console.log('  - POST /speech/synthesize (TTS)');
    console.log('  - POST /openai/deployments/*/chat/completions (OpenAI)');
    console.log('  - POST /calling/calls/:callId/answer (Communication)');
    console.log('  - GET /health (Health Check)');
});
EOF

    mkdir -p tests/mocks/src
    
    # Install mock dependencies
    cd tests/mocks
    npm install --silent
    cd - > /dev/null
    
    print_success "Azure Mock Services created"
}

# Start core services
start_services() {
    print_status "Starting core services for E2E testing..."
    
    # Start Azure Mock Services first
    print_status "Starting Azure Mock Services on port 4000..."
    cd tests/mocks
    npm start &
    AZURE_MOCK_PID=$!
    cd - > /dev/null
    
    sleep 3
    
    # Update environment for E2E testing
    export NODE_ENV=test
    export DATABASE_URL="postgresql://postgres:test123@localhost:5433/ai_ninja_test"
    export REDIS_URL="redis://localhost:6380"
    export AZURE_SPEECH_ENDPOINT="http://localhost:4000"
    export AZURE_OPENAI_ENDPOINT="http://localhost:4000"
    export AZURE_COMMUNICATION_ENDPOINT="http://localhost:4000"
    
    # Start core services
    print_status "Starting User Management Service on port 3005..."
    cd services/user-management
    PORT=3005 npm run dev &
    USER_MGMT_PID=$!
    cd - > /dev/null
    
    print_status "Starting Realtime Processor Service on port 3002..."
    cd services/realtime-processor
    PORT=3002 npm run dev &
    REALTIME_PID=$!
    cd - > /dev/null
    
    print_status "Starting Smart Whitelist Service on port 3006..."
    cd services/smart-whitelist-node
    PORT=3006 npm run dev &
    WHITELIST_PID=$!
    cd - > /dev/null
    
    # Save PIDs for cleanup
    echo "$AZURE_MOCK_PID" > .azure-mock.pid
    echo "$USER_MGMT_PID" > .user-mgmt.pid
    echo "$REALTIME_PID" > .realtime.pid
    echo "$WHITELIST_PID" > .whitelist.pid
    
    print_status "Waiting for services to start..."
    sleep 10
}

# Test service health
test_services() {
    print_status "Testing service health..."
    
    services=(
        "4000:Azure Mock Services"
        "3005:User Management"
        "3002:Realtime Processor"
        "3006:Smart Whitelist"
    )
    
    for service_info in "${services[@]}"; do
        port=$(echo $service_info | cut -d':' -f1)
        name=$(echo $service_info | cut -d':' -f2)
        
        if curl -s -f "http://localhost:$port/health" > /dev/null || curl -s -f "http://localhost:$port/ping" > /dev/null; then
            print_success "$name is healthy on port $port"
        else
            print_warning "$name may not be ready yet on port $port"
        fi
    done
}

# Main execution
main() {
    echo "🚀 Starting AI Answer Ninja E2E Test Environment"
    echo "================================================"
    
    check_prerequisites
    install_dependencies
    start_database
    create_azure_mocks
    start_services
    test_services
    
    echo
    print_success "🎉 E2E Test Environment Started Successfully!"
    echo
    echo "=== Service URLs ==="
    echo "🎭 Azure Mock Services:     http://localhost:4000/health"
    echo "👥 User Management:         http://localhost:3005/health"
    echo "🎧 Realtime Processor:      http://localhost:3002/health"
    echo "🛡️  Smart Whitelist:        http://localhost:3006/ping"
    echo
    echo "=== Next Steps ==="
    echo "1. Run E2E tests: npm run test:e2e"
    echo "2. View logs: tail -f *.log"
    echo "3. Stop services: ./local-e2e-cleanup.sh"
    echo
    echo "=== Environment Variables Set ==="
    echo "NODE_ENV=test"
    echo "DATABASE_URL=$DATABASE_URL"
    echo "REDIS_URL=$REDIS_URL"
    echo "AZURE_*_ENDPOINT=http://localhost:4000"
}

# Run main function
main "$@"