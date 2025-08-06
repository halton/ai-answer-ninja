# Conversation Engine Service

Advanced conversation management service for AI Answer Ninja with personalized responses, emotional intelligence, and real-time learning capabilities.

## Features

### Core Capabilities
- **Advanced AI Conversation Management**: Personalized responses using Azure OpenAI
- **Emotional Intelligence**: Real-time sentiment analysis and emotional state tracking
- **Conversation State Management**: Sophisticated state tracking and context management
- **Performance Optimization**: Response caching and <300ms response time optimization
- **Real-time Learning**: Continuous improvement through conversation outcome analysis

### Technical Features
- **High Performance**: Async/await architecture with response caching
- **Scalability**: Kubernetes-ready with horizontal pod autoscaling
- **Monitoring**: Prometheus metrics and health checks
- **Security**: JWT authentication and rate limiting
- **Reliability**: Circuit breakers and graceful error handling

## Architecture

### Service Components
```
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Application                      │
├─────────────────────────────────────────────────────────────┤
│  Conversation API  │  Analytics API  │  Health Checks      │
├─────────────────────────────────────────────────────────────┤
│  Azure OpenAI      │  Sentiment      │  State Manager      │
│  Service           │  Analyzer       │                     │
├─────────────────────────────────────────────────────────────┤
│  Learning          │  Cache          │  Database          │
│  Optimizer         │  Manager        │  Manager           │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow
1. **Incoming Request** → Conversation management endpoint
2. **Context Loading** → Retrieve conversation state and user profile
3. **Emotional Analysis** → Analyze caller's emotional state
4. **AI Response Generation** → Generate personalized response
5. **State Update** → Update conversation state and history
6. **Learning** → Record outcomes for continuous improvement

## Quick Start

### Prerequisites
- Python 3.11+
- PostgreSQL 15+
- Redis 7+
- Azure OpenAI subscription
- Azure Text Analytics subscription

### Local Development

1. **Clone and setup**:
```bash
cd services/conversation-engine
cp .env.example .env
# Edit .env with your configuration
```

2. **Install dependencies**:
```bash
pip install -r requirements.txt
```

3. **Start services**:
```bash
# Using Docker Compose (recommended)
docker-compose up -d

# Or run locally
python main.py
```

4. **Verify service**:
```bash
curl http://localhost:3003/health/
```

### Docker Deployment

```bash
# Build image
docker build -t conversation-engine .

# Run with Docker Compose
docker-compose up -d

# Check health
docker-compose exec conversation-engine curl http://localhost:3003/health/detailed
```

### Kubernetes Deployment

```bash
# Create namespace
kubectl create namespace ai-answer-ninja

# Apply configuration
kubectl apply -f k8s-deployment.yaml

# Check status
kubectl get pods -n ai-answer-ninja
kubectl get svc -n ai-answer-ninja
```

## API Documentation

### Core Endpoints

#### Conversation Management
```http
POST /api/v1/conversation/manage
Content-Type: application/json

{
    "call_id": "call-12345",
    "user_id": "user-uuid",
    "caller_phone": "+1234567890",
    "input_text": "你好，我想了解一下您的产品",
    "detected_intent": "sales_call",
    "intent_confidence": 0.9
}
```

#### Emotional Analysis
```http
POST /api/v1/conversation/emotion/analyze
Content-Type: application/json

{
    "text": "为什么还要打电话给我？",
    "call_id": "call-12345"
}
```

#### Analytics
```http
GET /api/v1/analytics/conversation/{call_id}
GET /api/v1/analytics/performance/overview
GET /api/v1/analytics/trends/{user_id}?days=7
```

### Response Format

#### Conversation Response
```json
{
    "response_text": "谢谢您的来电，但我现在不太方便了解产品信息。",
    "intent": "sales_call",
    "emotional_tone": "polite",
    "confidence": 0.87,
    "should_terminate": false,
    "next_stage": "handling_sales",
    "processing_time_ms": 245,
    "cached": false,
    "turn_number": 2,
    "conversation_id": "call-12345",
    "response_strategy": "polite_decline"
}
```

#### Emotional Analysis Response
```json
{
    "emotional_state": "annoyed",
    "confidence": 0.82,
    "persistence_score": 0.6,
    "frustration_level": 0.4,
    "emotional_intensity": 0.7,
    "processing_time_ms": 156,
    "response_recommendations": [
        "be_empathetic",
        "acknowledge_feelings",
        "offer_quick_resolution"
    ]
}
```

## Configuration

### Environment Variables

#### Core Configuration
```bash
# Service
DEBUG=false
PORT=3003
LOG_LEVEL=INFO

# Database
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/db
REDIS_URL=redis://localhost:6379/0

# Azure Services
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_KEY=your-api-key
AZURE_TEXT_ANALYTICS_ENDPOINT=https://your-analytics.cognitiveservices.azure.com/
AZURE_TEXT_ANALYTICS_KEY=your-analytics-key

# Performance
MAX_CONCURRENT_CONVERSATIONS=100
CACHE_TTL_SECONDS=300
RESPONSE_TIMEOUT_SECONDS=5
```

#### AI Model Settings
```bash
AI_TEMPERATURE=0.7
AI_MAX_TOKENS=150
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4
```

### Database Schema

The service uses PostgreSQL with the following key tables:
- `conversation_sessions` - Active conversation tracking
- `conversation_turns` - Individual conversation turns
- `user_profiles` - User personalization data
- `learning_models` - ML model storage
- `conversation_outcomes` - Learning data

## Performance Optimization

### Response Time Targets
- **Target**: <300ms for 95% of requests
- **Cache Hit Rate**: >70% for common scenarios
- **Concurrent Conversations**: Up to 100 per instance

### Optimization Strategies
1. **Multi-level Caching**: Memory → Redis → Database
2. **Response Templates**: Pre-generated responses for common intents
3. **Async Processing**: Non-blocking I/O throughout
4. **Connection Pooling**: Efficient database connections
5. **Intelligent Caching**: Context-aware cache keys

### Performance Monitoring
```bash
# Check metrics
curl http://localhost:3003/metrics

# Performance overview
curl http://localhost:3003/api/v1/analytics/performance/overview

# Health check
curl http://localhost:3003/health/detailed
```

## Advanced Features

### Real-time Learning
The service continuously learns from conversation outcomes:
- **Response Effectiveness Tracking**
- **Strategy Optimization**
- **A/B Testing Framework**
- **User-specific Adaptation**

### Emotional Intelligence
Sophisticated emotional analysis including:
- **Azure Text Analytics Integration**
- **Pattern-based Emotion Detection**
- **Conversation Context Analysis**
- **Persistence and Frustration Detection**

### Personalization
Dynamic response personalization based on:
- **User Personality Types** (polite, direct, humorous, professional)
- **Speech Styles** (formal, informal, friendly, business)
- **Historical Conversation Patterns**
- **Time-based Adaptations**

## Monitoring and Observability

### Metrics
- **Conversation Metrics**: Total, active, duration, success rate
- **Performance Metrics**: Response time, cache hit rate, error rate
- **AI Metrics**: Model accuracy, confidence scores, generation time
- **System Metrics**: Memory usage, CPU utilization, connection counts

### Health Checks
- **Liveness**: `/health/liveness` - Service is running
- **Readiness**: `/health/readiness` - Service is ready for traffic
- **Detailed**: `/health/detailed` - Component-level health status

### Logging
Structured logging with correlation IDs:
```json
{
    "timestamp": "2025-01-01T12:00:00Z",
    "level": "INFO",
    "logger": "conversation.manager",
    "call_id": "call-12345",
    "user_id": "user-uuid",
    "message": "Conversation managed successfully",
    "processing_time_ms": 245,
    "cached": false
}
```

## Security

### Authentication & Authorization
- **JWT Token Validation**
- **API Rate Limiting**
- **CORS Configuration**
- **Input Validation**

### Data Protection
- **Encrypted Data Storage**
- **PII Data Masking in Logs**
- **Secure API Communication**
- **Audit Logging**

## Troubleshooting

### Common Issues

#### High Response Times
```bash
# Check cache performance
curl http://localhost:3003/api/v1/analytics/performance/overview

# Monitor Azure OpenAI usage
# Check Redis connection
redis-cli ping
```

#### Memory Issues
```bash
# Check memory usage
curl http://localhost:3003/health/detailed

# Monitor conversation cleanup
docker-compose logs conversation-engine | grep cleanup
```

#### Database Connection Issues
```bash
# Test database connectivity
psql -h localhost -U postgres -d ai_answer_ninja -c "\\dt"

# Check connection pool
curl http://localhost:3003/health/detailed | jq .components.database
```

### Debugging
Enable debug logging:
```bash
export DEBUG=true
export LOG_LEVEL=DEBUG
python main.py
```

## Development

### Project Structure
```
conversation-engine/
├── app/
│   ├── api/v1/          # API endpoints
│   ├── core/            # Core configuration
│   ├── models/          # Data models
│   └── services/        # Business logic
├── tests/               # Test suite
├── monitoring/          # Monitoring configs
├── Dockerfile           # Container image
├── docker-compose.yml   # Local development
├── k8s-deployment.yaml  # Kubernetes deployment
└── requirements.txt     # Python dependencies
```

### Testing
```bash
# Run tests
pytest tests/ -v

# Run with coverage
pytest tests/ --cov=app --cov-report=html

# Load testing
locust -f tests/load_test.py --host=http://localhost:3003
```

### Contributing
1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

Copyright (c) 2025 AI Answer Ninja Team. All rights reserved.

---

For more information, see the [main project documentation](../../README.md).