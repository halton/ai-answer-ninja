# Speech Services

Azure Speech Services integration for AI Phone Answering System. This service provides real-time speech-to-text (STT) and text-to-speech (TTS) capabilities with intelligent caching and performance optimization.

## Features

### Core Capabilities
- **Azure STT Integration**: Real-time streaming speech recognition with < 350ms latency
- **Azure TTS Integration**: Neural voice synthesis with < 300ms latency
- **Custom Voice Support**: Azure Custom Neural Voice for personalized responses
- **Intelligent Caching**: Multi-layer cache with Redis and LRU memory cache
- **WebSocket Streaming**: Real-time bidirectional audio streaming
- **Performance Monitoring**: Comprehensive metrics and latency tracking

### Audio Processing Pipeline
- Voice Activity Detection (VAD)
- Echo Cancellation
- Noise Reduction
- Audio Format Conversion
- Stream Processing

### Performance Targets

| Stage | MVP (<1500ms) | Optimized (<1000ms) | Production (<800ms) |
|-------|---------------|---------------------|---------------------|
| STT | 350ms | 250ms | 180ms |
| TTS | 300ms | 200ms | 120ms |
| Cache Hit Rate | 60% | 75% | 90% |

## Installation

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Configure Azure credentials in .env
```

## Configuration

### Required Environment Variables
```env
# Azure Speech Services
AZURE_SPEECH_KEY=your_speech_key
AZURE_SPEECH_REGION=eastasia

# Service Configuration
SERVICE_PORT=3010
WS_PORT=3011

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Performance Settings
MAX_CONCURRENT_STT=10
MAX_CONCURRENT_TTS=10
CACHE_TTL_SECONDS=3600
```

## Usage

### Starting the Service
```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### WebSocket Connection
```javascript
const ws = new WebSocket('ws://localhost:3011');

// Initialize connection
ws.send(JSON.stringify({
  type: 'connection_init',
  callId: 'unique-call-id',
  data: {
    userId: 'user-id',
    language: 'zh-CN'
  }
}));

// Send audio chunks
ws.send(audioBuffer); // Raw binary audio
// or
ws.send(JSON.stringify({
  type: 'audio_chunk',
  callId: 'unique-call-id',
  data: {
    audioData: base64AudioData
  }
}));

// Receive STT results
ws.on('message', (data) => {
  const message = JSON.parse(data);
  if (message.type === 'stt_result') {
    console.log('Transcription:', message.data.text);
  }
});
```

### REST API Endpoints

#### Health Check
```http
GET /health
```

#### Speech-to-Text
```http
POST /api/stt
Content-Type: application/json

{
  "audio": "base64_encoded_audio",
  "language": "zh-CN"
}
```

#### Text-to-Speech
```http
POST /api/tts
Content-Type: application/json

{
  "text": "你好，有什么可以帮助你的吗？",
  "voice": "zh-CN-XiaoxiaoNeural",
  "language": "zh-CN"
}
```

#### Get Available Voices
```http
GET /api/voices?locale=zh-CN
```

#### Pre-generate Response
```http
POST /api/pregenerate
Content-Type: application/json

{
  "intent": "sales_call",
  "text": "我现在不方便，谢谢",
  "voice": "zh-CN-XiaoxiaoNeural"
}
```

#### Get Metrics
```http
GET /api/metrics
```

## Architecture

### Service Components
```
Speech Services
├── Azure STT Service (Real-time streaming recognition)
├── Azure TTS Service (Neural voice synthesis)
├── Intelligent Cache (Multi-layer caching)
├── Audio Pipeline (VAD, Echo cancellation, Noise reduction)
├── WebSocket Handler (Real-time communication)
└── Performance Monitor (Metrics and alerting)
```

### Data Flow
```
Audio Input → Audio Pipeline → Azure STT → Cache → Result
Text Input → Cache Check → Azure TTS → Cache Store → Audio Output
```

## Performance Optimization

### Caching Strategy
1. **L1 Cache (Memory)**: LRU cache for hot data (< 1ms)
2. **L2 Cache (Redis)**: Distributed cache (< 10ms)
3. **Pre-generated Responses**: Common responses pre-synthesized (< 50ms)

### Latency Reduction Techniques
- Parallel processing of audio chunks
- Predictive response generation
- Connection pooling
- Audio stream pipelining
- Adaptive bitrate encoding

## Monitoring

### Prometheus Metrics
- `speech_stt_latency_ms`: STT processing latency
- `speech_tts_latency_ms`: TTS synthesis latency
- `speech_total_latency_ms`: End-to-end latency
- `speech_cache_hit_rate`: Cache effectiveness
- `speech_active_connections`: WebSocket connections

### Health Monitoring
The service provides comprehensive health checks including:
- Azure service connectivity
- Redis availability
- Latency measurements
- Error rates

## Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## Docker Support

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3010 3011
CMD ["npm", "start"]
```

## Troubleshooting

### Common Issues

1. **High Latency**
   - Check Azure region proximity
   - Verify cache hit rates
   - Monitor network conditions

2. **Connection Issues**
   - Verify WebSocket port is open
   - Check firewall settings
   - Ensure Redis is running

3. **Audio Quality Issues**
   - Verify audio format (16kHz, 16-bit, mono)
   - Check VAD sensitivity settings
   - Adjust noise reduction parameters

## API Documentation

For detailed API documentation, see the OpenAPI specification at `/docs/openapi.yaml`.

## License

Proprietary - AI Answer Ninja

## Support

For issues and questions, contact the development team.