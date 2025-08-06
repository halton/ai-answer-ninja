# Real-time Processor Service

High-performance WebSocket server for AI Answer Ninja's real-time audio processing pipeline. This service handles audio streaming, speech recognition, AI conversation, and text-to-speech with optimized latency targeting <800ms total pipeline processing time.

## 🎯 Features

### Core Capabilities
- **Real-time Audio Processing**: WebSocket-based audio streaming with low-latency pipeline
- **Azure Speech Integration**: STT/TTS with connection pooling and caching
- **Advanced Voice Activity Detection**: Multi-feature VAD with temporal smoothing
- **Intelligent Caching**: Multi-level cache system (L1 + Redis) for performance optimization
- **Performance Monitoring**: Comprehensive metrics collection and bottleneck detection
- **Circuit Breakers**: Resilience patterns for external service failures
- **Auto-scaling Ready**: Horizontal scaling support with Redis coordination

### Performance Optimizations
- **Predictive Caching**: Pre-loads common responses and user profiles
- **Parallel Processing**: Concurrent audio processing with queue management
- **Adaptive Optimization**: Real-time performance tuning based on metrics
- **Connection Pooling**: Optimized Azure service connections
- **Compression**: Audio and message compression for bandwidth efficiency

### Production Features
- **Health Checks**: Comprehensive health monitoring with detailed status
- **Graceful Shutdown**: Clean service termination handling
- **Rate Limiting**: Advanced rate limiting with circuit breaker integration
- **Security**: JWT authentication, CORS, input validation
- **Observability**: Prometheus metrics, structured logging, distributed tracing

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   WebSocket     │    │   Audio          │    │   Azure Speech  │
│   Connections   │◄──►│   Processing     │◄──►│   Services      │
│                 │    │   Pipeline       │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Redis Pub/Sub │    │   Performance    │    │   Circuit       │
│   Coordination  │    │   Monitoring     │    │   Breakers      │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### Development Setup

1. **Clone and Install**
   ```bash
   cd services/realtime-processor
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Azure credentials and settings
   ```

3. **Start Dependencies**
   ```bash
   docker-compose up redis prometheus grafana -d
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   ```

### Production Deployment

1. **Build Docker Image**
   ```bash
   docker build -t realtime-processor:latest .
   ```

2. **Deploy with Docker Compose**
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

3. **Kubernetes Deployment**
   ```bash
   kubectl apply -f k8s/
   ```

## 📡 API Reference

### HTTP Endpoints

#### Health Check
```http
GET /health
```
Returns comprehensive health status including service dependencies.

#### Metrics
```http
GET /metrics
```
Prometheus-formatted metrics for monitoring and alerting.

#### Connection Stats
```http
GET /connections
```
Real-time WebSocket connection statistics.

#### Audio Processing (Debug)
```http
POST /process/audio
Content-Type: application/json

{
  "callId": "call-123",
  "audioData": "base64-encoded-audio",
  "userId": "user-456"
}
```

### WebSocket API

#### Connection
```javascript
const ws = new WebSocket('ws://localhost:3002/realtime/conversation?token=valid_user_call');
```

#### Message Formats

**Audio Chunk (Client → Server)**
```json
{
  "type": "audio_chunk",
  "callId": "call-123",
  "timestamp": 1640995200000,
  "audioData": "base64-encoded-pcm-data",
  "sequenceNumber": 1,
  "sampleRate": 16000,
  "channels": 1
}
```

**AI Response (Server → Client)**
```json
{
  "type": "ai_response",
  "callId": "call-123",
  "timestamp": 1640995200000,
  "data": {
    "text": "我现在不方便接听",
    "audioData": "base64-encoded-mp3",
    "shouldTerminate": false,
    "confidence": 0.95,
    "processingLatency": 650
  }
}
```

**Processing Status**
```json
{
  "type": "processing_status",
  "callId": "call-123",
  "timestamp": 1640995200000,
  "data": {
    "stage": "speech_to_text",
    "queueSize": 2,
    "processingLatency": 200
  }
}
```

## ⚙️ Configuration

### Environment Variables

Key configuration options:

```bash
# Azure Services
AZURE_SPEECH_KEY=your_speech_service_key
AZURE_SPEECH_REGION=eastus2
AZURE_OPENAI_KEY=your_openai_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/

# Performance Targets (milliseconds)
TARGET_TOTAL_PIPELINE_LATENCY=800
TARGET_AUDIO_PREPROCESSING=50
TARGET_SPEECH_TO_TEXT=200
TARGET_AI_GENERATION=300
TARGET_TEXT_TO_SPEECH=150

# Cache Configuration
CACHE_ENABLED=true
CACHE_TTL_STT_RESULTS=3600
CACHE_TTL_AI_RESPONSES=900
CACHE_TTL_TTS_AUDIO=7200

# Circuit Breaker
CIRCUIT_BREAKER_ENABLED=true
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_RESET_TIMEOUT=60000
```

See `.env.example` for all available options.

### Performance Tuning

#### Latency Optimization
```bash
# Reduce processing timeout for faster failure detection
PROCESSING_TIMEOUT=3000

# Increase concurrent processing for better throughput
MAX_CONCURRENT_PROCESSING=20

# Enable predictive caching
CACHE_PRELOADING_ENABLED=true
ENABLE_PREDICTIVE_CACHING=true
```

#### Memory Optimization
```bash
# Adjust cache sizes based on available memory
CACHE_MAX_SIZE_STT=2000
CACHE_MAX_SIZE_TTS=200
CACHE_MAX_SIZE_AI=1000

# Configure Redis memory limit
# In redis.conf: maxmemory 512mb
```

## 📊 Monitoring

### Metrics

Key performance indicators:

- **Latency Metrics**: P50, P95, P99 for each processing stage  
- **Throughput**: Messages/sec, audio chunks/sec, concurrent connections
- **Error Rates**: By stage and error type
- **Cache Performance**: Hit rates, eviction rates
- **Resource Usage**: CPU, memory, network, Redis connections

### Alerting

Recommended alert thresholds:

```yaml
# Critical Alerts
- alert: HighLatency
  expr: latency_total_pipeline_p95 > 1200
  
- alert: HighErrorRate  
  expr: error_rate > 10
  
- alert: ServiceDown
  expr: up == 0

# Warning Alerts  
- alert: DegradedPerformance
  expr: latency_total_pipeline_p95 > 900
  
- alert: LowCacheHitRate
  expr: cache_hit_rate < 0.6
```

### Dashboards

Grafana dashboards included:

- **Real-time Performance**: Live latency and throughput metrics
- **Audio Processing Pipeline**: Stage-by-stage processing analysis  
- **Cache Performance**: Hit rates, size, and efficiency metrics
- **Error Analysis**: Error patterns and failure modes
- **Resource Utilization**: System resources and capacity planning

## 🧪 Testing

### Unit Tests
```bash
npm test
npm run test:watch
npm run test:coverage
```

### Integration Tests
```bash
npm run test:integration
```

### Load Testing
```bash
# Start the service
docker-compose up -d

# Run load tests
npm run test:load

# Or with k6
docker-compose --profile testing run k6 run /scripts/websocket-load-test.js
```

### Performance Testing
```bash
# Test latency under various loads
npm run test:performance

# Test memory usage
npm run test:memory

# Test connection limits
npm run test:connections
```

## 🚀 Deployment

### Docker

```bash
# Development
docker-compose up

# Production
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Kubernetes

```bash
# Apply configurations
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml  
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml

# Check status
kubectl get pods -n realtime-processor
kubectl logs -f deployment/realtime-processor -n realtime-processor
```

### Scaling

```bash
# Horizontal scaling
kubectl scale deployment realtime-processor --replicas=5

# Auto-scaling
kubectl apply -f k8s/hpa.yaml
```

## 🔧 Development

### Project Structure

```
src/
├── config/           # Configuration management
├── services/         # Core business logic
│   ├── audioProcessor.ts    # Audio processing pipeline
│   ├── azureSpeech.ts      # Azure Speech integration
│   ├── cacheService.ts     # Multi-level caching
│   ├── circuitBreaker.ts   # Resilience patterns
│   ├── metrics.ts          # Performance monitoring
│   ├── performanceMonitor.ts # Latency optimization
│   ├── redis.ts            # Redis operations
│   ├── voiceActivityDetector.ts # Advanced VAD
│   └── websocket.ts        # WebSocket management
├── types/            # TypeScript definitions
├── utils/            # Utility functions
└── server.ts         # Main application entry
```

### Adding Features

1. **New Audio Processing Stage**
   ```typescript
   // Add to audioProcessor.ts
   private async newProcessingStage(audioData: Buffer): Promise<ProcessedResult> {
     const startTime = performance.now();
     
     try {
       // Your processing logic
       const result = await processAudio(audioData);
       
       // Record metrics
       this.performanceMonitor.recordStageLatency(
         'new_stage', 
         performance.now() - startTime
       );
       
       return result;
     } catch (error) {
       this.performanceMonitor.recordStageError('new_stage', error.message);
       throw error;
     }
   }
   ```

2. **New Cache Layer**
   ```typescript
   // Add to cacheService.ts
   async getCustomData(key: string): Promise<any> {
     // L1 cache check
     const l1Result = this.customCache.get(key);
     if (l1Result) return l1Result;
     
     // L2 cache check
     const l2Result = await this.redis.get(key);
     if (l2Result) {
       this.customCache.set(key, l2Result);
       return l2Result;
     }
     
     return null;
   }
   ```

### Code Quality

```bash
# Linting
npm run lint
npm run lint:fix

# Type checking
npm run type-check

# Security audit
npm audit
npm run audit:fix

# Code formatting
npm run format
```

## 🐛 Troubleshooting

### Common Issues

**High Latency**
```bash
# Check performance metrics
curl http://localhost:3002/metrics | grep latency

# Check for bottlenecks
curl http://localhost:3002/health | jq '.details.recommendations'

# Review logs
docker logs realtime-processor-dev --tail 100
```

**Connection Issues**
```bash
# Check WebSocket connections
curl http://localhost:3002/connections

# Test WebSocket connectivity
wscat -c ws://localhost:3002/realtime/conversation?token=valid_test_token

# Check Redis connectivity
redis-cli -h localhost -p 6379 ping
```

**Memory Issues**  
```bash
# Monitor memory usage
docker stats realtime-processor-dev

# Check cache sizes
curl http://localhost:3002/metrics | grep cache_size

# Review cache hit rates
curl http://localhost:3002/health | jq '.details.cacheStats'
```

### Debug Mode

```bash
# Enable debug logging
DEBUG=realtime-processor:* npm run dev

# Enable performance profiling  
PROFILING_ENABLED=true npm run dev

# Enable memory leak detection
MEMORY_LEAK_DETECTION=true npm run dev
```

## 📈 Performance

### Benchmarks

Typical performance metrics on modern hardware:

- **Latency**: P95 < 800ms total pipeline
- **Throughput**: 100+ concurrent connections
- **Memory**: ~200MB base + ~5MB per connection
- **CPU**: ~15% per 10 concurrent connections

### Optimization Tips

1. **Cache Tuning**: Adjust cache sizes based on usage patterns
2. **Connection Pooling**: Optimize Azure service connections
3. **Audio Format**: Use optimal sample rates and compression
4. **Redis Tuning**: Configure Redis for your workload
5. **Circuit Breakers**: Fine-tune failure thresholds

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Update documentation
6. Submit a pull request

## 📝 License

This project is part of the AI Answer Ninja system. See the main project LICENSE file for details.

## 🆘 Support

- **Documentation**: Check this README and inline code comments
- **Issues**: Create GitHub issues for bugs and feature requests  
- **Monitoring**: Use Grafana dashboards for operational insights
- **Logs**: Check application logs for detailed error information

---

Built with ❤️ for ultra-low latency AI conversation processing.