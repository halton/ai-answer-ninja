# WebSocket Real-time Communication System

## Overview

This document describes the complete WebSocket real-time communication system implementation for the AI Answer Ninja project. The system provides real-time audio processing, AI conversation, and response generation with support for multiple clients, heartbeat detection, reconnection mechanisms, and message queuing.

## Architecture

### Core Components

1. **WebSocketManager** - Manages multiple client connections with heartbeat and reconnection
2. **AudioStreamHandler** - Processes real-time audio data with voice activity detection
3. **RealtimeService** - Core service coordinating audio processing and AI conversation
4. **RealtimeWebSocketServer** - Enhanced WebSocket server with authentication and rate limiting

### Data Flow

```
Client Audio → WebSocket → AudioStreamHandler → Voice Activity Detection
                                ↓
Azure Speech-to-Text ← Audio Processing ← VAD Result
        ↓
Intent Recognition → AI Conversation → Response Generation
        ↓
Azure Text-to-Speech → Audio Response → WebSocket → Client
```

## Features

### ✅ Implemented Features

- **Multi-client WebSocket connections** with connection pooling
- **Heartbeat detection** and automatic timeout handling
- **Reconnection mechanism** with exponential backoff
- **Message queuing** for offline message delivery
- **Binary audio stream support** alongside JSON messages
- **Voice Activity Detection (VAD)** for efficient processing
- **Real-time audio processing** with noise reduction and AGC
- **Authentication and authorization** with JWT tokens
- **Rate limiting** and security controls
- **Performance monitoring** and metrics collection
- **Graceful shutdown** and error handling
- **Session management** with automatic cleanup

### Message Types

The system supports the following message types:

- `audio_chunk` - Binary audio data from client
- `audio_response` - Binary audio response to client
- `transcript` - Speech-to-text results
- `ai_response` - AI-generated text responses
- `heartbeat` - Connection keep-alive messages
- `connection_status` - Connection state updates
- `processing_status` - Processing pipeline status
- `metrics` - Performance metrics
- `error` - Error notifications

## Installation & Setup

### Prerequisites

- Node.js 18+
- TypeScript 5.3+
- Redis (for caching and session management)
- Azure Speech Services account
- Azure OpenAI account

### Environment Variables

Create a `.env` file in the service root:

```bash
# Server Configuration
PORT=3002
HOST=0.0.0.0
NODE_ENV=development
MAX_CONNECTIONS=1000

# Azure Services
AZURE_SPEECH_KEY=your_speech_key
AZURE_SPEECH_REGION=eastus2
AZURE_OPENAI_KEY=your_openai_key
AZURE_OPENAI_ENDPOINT=https://your-openai.openai.azure.com/

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_DB=0

# Security
JWT_SECRET=your-secret-key-change-in-production
ALLOWED_ORIGINS=localhost:3000,localhost:3001

# Performance
AUDIO_CHUNK_SIZE=4096
MAX_AUDIO_DURATION=180000
PROCESSING_TIMEOUT=5000
MAX_CONCURRENT_PROCESSING=10

# Rate Limiting
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=1000
RATE_LIMIT_MAX_CONNECTIONS=10
```

### Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the development server
npm run dev:realtime

# Or start the production server
npm run start:realtime
```

## Usage

### Starting the Server

```bash
# Development mode with auto-reload
npm run dev:realtime

# Production mode
npm run build && npm run start:realtime

# Open the test client
npm run client
```

### Server Endpoints

- **WebSocket**: `ws://localhost:3002/realtime/ws`
- **Health Check**: `GET http://localhost:3002/health`
- **Metrics**: `GET http://localhost:3002/metrics`
- **Authentication**: `POST http://localhost:3002/auth/websocket`

### Client Integration

#### 1. Connect to WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3002/realtime/ws');

ws.onopen = function() {
    console.log('Connected to realtime server');
};

ws.onmessage = function(event) {
    handleMessage(event);
};
```

#### 2. Authenticate and Start Session

```javascript
// Get authentication token
const authResponse = await fetch('/auth/websocket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        token: 'your-jwt-token',
        userId: 'user-123',
        callId: 'call-456'
    })
});

const { sessionToken } = await authResponse.json();

// Start session
const sessionMessage = {
    type: 'session_start',
    callId: 'call-456',
    timestamp: Date.now(),
    data: {
        userId: 'user-123',
        callId: 'call-456',
        authToken: sessionToken
    }
};

ws.send(JSON.stringify(sessionMessage));
```

#### 3. Send Audio Data

```javascript
// Get audio stream
const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true
    }
});

// Start recording
const mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus'
});

mediaRecorder.ondataavailable = function(event) {
    if (event.data.size > 0) {
        // Send audio as binary data
        ws.send(event.data);
    }
};

mediaRecorder.start(100); // 100ms chunks
```

#### 4. Handle Responses

```javascript
function handleMessage(event) {
    if (typeof event.data === 'string') {
        // JSON message
        const message = JSON.parse(event.data);
        
        switch (message.type) {
            case 'transcript':
                console.log('Transcript:', message.data.text);
                break;
                
            case 'ai_response':
                console.log('AI Response:', message.data.text);
                break;
                
            case 'heartbeat':
                // Respond to heartbeat
                ws.send(JSON.stringify({
                    type: 'heartbeat',
                    callId: '',
                    timestamp: Date.now(),
                    data: { pong: true }
                }));
                break;
        }
    } else {
        // Binary audio response
        playAudioResponse(event.data);
    }
}
```

### Test Client

The system includes a comprehensive test client at `examples/realtime-client.html`. Features:

- **Connection Management** - Connect/disconnect with status monitoring
- **Session Control** - Start/end sessions with authentication
- **Audio Recording** - Real-time audio capture and streaming
- **Audio Visualization** - Real-time frequency analysis display
- **Conversation View** - Display of transcripts and AI responses
- **Performance Metrics** - Real-time latency and throughput monitoring
- **System Logs** - Detailed logging of all system events

## Configuration

### WebSocket Options

```typescript
const server = new RealtimeWebSocketServer({
    enableCors: true,
    enableCompression: true,
    enableRateLimit: true,
    enableAuth: true,
    maxConnections: 1000,
    heartbeatInterval: 30000,
    reconnectTimeout: 60000
});
```

### Heartbeat Configuration

```typescript
server.updateHeartbeatConfig({
    interval: 30000,      // 30 seconds
    timeout: 60000,       // 60 seconds
    maxMissed: 3,         // Max missed heartbeats
    enabled: true
});
```

### Reconnection Configuration

```typescript
server.updateReconnectionConfig({
    enabled: true,
    maxAttempts: 5,
    baseDelay: 1000,      // 1 second
    maxDelay: 30000,      // 30 seconds
    backoffFactor: 2.0
});
```

### Audio Processing Options

```typescript
audioHandler.startStream(callId, {
    enableVAD: true,
    vadThreshold: 0.3,
    maxChunkSize: 4096,
    bufferDuration: 3000,
    enableDenoising: true,
    enableAGC: true,
    sampleRate: 16000,
    channels: 1
});
```

## Performance Monitoring

### Metrics Available

- **Connection Metrics**
  - Total connections
  - Active connections
  - Messages sent/received
  - Bytes transferred
  - Reconnections
  - Errors

- **Processing Metrics**
  - Audio chunks processed
  - Speech-to-text latency
  - Intent recognition latency
  - AI generation latency
  - Text-to-speech latency
  - Total pipeline latency

- **System Metrics**
  - CPU usage
  - Memory usage
  - Network usage
  - Redis connections

### Accessing Metrics

```bash
# Get metrics via HTTP
curl http://localhost:3002/metrics

# Get health status
curl http://localhost:3002/health
```

## Security Features

### Authentication

- JWT token-based authentication
- Session token generation
- Token validation and expiration

### Rate Limiting

- IP-based rate limiting
- Per-connection message limits
- Configurable time windows

### CORS Protection

- Configurable allowed origins
- Secure cross-origin requests

### Input Validation

- Message format validation
- Audio data validation
- Connection parameter validation

## Error Handling

### Connection Errors

- Automatic reconnection with exponential backoff
- Connection timeout detection
- Graceful connection cleanup

### Processing Errors

- Robust error recovery
- Partial processing support
- Error notification to clients

### Service Errors

- Circuit breaker patterns
- Fallback mechanisms
- Graceful degradation

## Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
npm run test:communication
```

### Load Testing

The system includes load testing capabilities:

```bash
# Run performance tests
npm run test:performance
```

## Deployment

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY examples/ ./examples/

EXPOSE 3002
CMD ["npm", "run", "start:realtime"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: realtime-processor
spec:
  replicas: 3
  selector:
    matchLabels:
      app: realtime-processor
  template:
    metadata:
      labels:
        app: realtime-processor
    spec:
      containers:
      - name: realtime-processor
        image: ai-ninja/realtime-processor:latest
        ports:
        - containerPort: 3002
        env:
        - name: PORT
          value: "3002"
        - name: REDIS_URL
          value: "redis://redis-service:6379"
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
```

## Troubleshooting

### Common Issues

1. **Connection Refused**
   - Check if server is running
   - Verify port configuration
   - Check firewall settings

2. **Authentication Failed**
   - Verify JWT secret configuration
   - Check token format and expiration
   - Validate user permissions

3. **Audio Processing Errors**
   - Check Azure Speech Services configuration
   - Verify audio format and codec
   - Monitor processing latency

4. **High Latency**
   - Check network connectivity
   - Monitor Azure service response times
   - Optimize audio chunk size

### Debugging

Enable debug logging:

```bash
LOG_LEVEL=debug npm run dev:realtime
```

Monitor Redis connections:

```bash
redis-cli monitor
```

Check health status:

```bash
curl http://localhost:3002/health
```

## Roadmap

### Future Enhancements

- [ ] WebRTC peer-to-peer connection support
- [ ] Advanced audio codec support (Opus, AAC)
- [ ] Real-time collaboration features
- [ ] Advanced voice activity detection
- [ ] Machine learning-based noise reduction
- [ ] Distributed session management
- [ ] Advanced analytics and reporting
- [ ] Multi-language support
- [ ] Edge computing deployment

### Performance Optimizations

- [ ] Connection pooling optimization
- [ ] Message compression
- [ ] Audio streaming optimization
- [ ] Caching improvements
- [ ] Load balancing enhancements

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Update documentation
5. Submit a pull request

## License

This project is part of the AI Answer Ninja system. See the main project license for details.

---

*Last updated: 2025-08-12*
*Version: 2.0.0*