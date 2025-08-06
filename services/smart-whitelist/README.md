# Smart Whitelist Service

High-performance intelligent whitelist management service with machine learning capabilities for the AI Answer Ninja project.

## Features

- **Ultra-fast Lookup** (<5ms): Redis-backed caching with sub-5ms lookup performance
- **Machine Learning Classification**: Real-time spam/legitimate contact classification
- **Intelligent Learning**: Automatic pattern learning from user interactions
- **Concurrent Processing**: Goroutine-based worker pools for high throughput
- **Production Ready**: Comprehensive metrics, health checks, and monitoring

## Architecture

### Core Components

- **Smart Whitelist Management**: Automatic and manual whitelist entries with expiration
- **ML Classification Engine**: Feature extraction and phone number pattern analysis
- **Redis Cache Layer**: Multi-level caching for ultra-fast lookups
- **Learning System**: Background workers processing user feedback
- **HTTP API**: RESTful endpoints with validation and error handling

### Performance Targets

- Whitelist lookup: <5ms (P95)
- ML classification: <100ms (P95)
- Cache hit rate: >90%
- Concurrent requests: 1000+ RPS

## API Endpoints

### Whitelist Operations
- `GET /api/v1/whitelist/:userId` - Get whitelist entries
- `POST /api/v1/whitelist/:userId/smart-add` - Intelligently add phone number
- `DELETE /api/v1/whitelist/:userId/:phone` - Remove from whitelist
- `PUT /api/v1/whitelist/rules/:userId` - Update user rules

### Phone Evaluation
- `GET /api/v1/whitelist/evaluate/:phone` - Evaluate phone number with ML
- `POST /api/v1/whitelist/learning` - Record learning feedback

### Monitoring
- `GET /health` - Basic health check
- `GET /health/ready` - Readiness probe
- `GET /health/live` - Liveness probe
- `GET /metrics` - Prometheus metrics

## Configuration

Configuration via environment variables or `config.yaml`:

```yaml
server:
  port: 3006
  host: "0.0.0.0"

database:
  host: "localhost"
  port: 5432
  database: "ai_answer_ninja"

redis:
  host: "localhost"
  port: 6379
  whitelist_cache_ttl: "10m"

ml:
  enabled: true
  confidence_threshold: 0.7
  feature_extraction_workers: 4
```

## Development

### Local Development

1. Start dependencies:
```bash
docker-compose up postgres redis -d
```

2. Run the service:
```bash
go run cmd/main.go
```

### With Docker

```bash
# Development with debug tools
docker-compose --profile debug up

# Production mode
docker-compose up smart-whitelist postgres redis
```

### Testing

```bash
# Run tests
go test ./...

# Run with coverage
go test -cover ./...

# Integration tests
docker-compose -f docker-compose.test.yml up --build --abort-on-container-exit
```

## Machine Learning Features

### Feature Extraction

The ML system extracts 20+ features from phone numbers:

- **Pattern Analysis**: Repeated digits, sequential patterns, complexity
- **Geographic Analysis**: Area code patterns, carrier information
- **Behavioral Analysis**: Call frequency, timing patterns, duration
- **Context Analysis**: Marketing keywords, spam indicators

### Classification

- **Real-time Classification**: <100ms classification time
- **Confidence Scoring**: 0-1 confidence levels for decisions
- **Spam Type Detection**: Sales, loans, investment, insurance, scams
- **Automatic Learning**: Continuous improvement from user feedback

### Learning System

- **Background Workers**: Asynchronous learning from user interactions
- **Pattern Recognition**: Automatic pattern extraction and weight updates
- **User Adaptation**: Personalized models based on user behavior
- **Model Updates**: Periodic model retraining with new data

## Monitoring and Metrics

### Prometheus Metrics

- `smart_whitelist_lookups_total` - Total lookups with hit/miss rates
- `smart_whitelist_ml_classifications_total` - ML classification counts
- `smart_whitelist_cache_hit_rate` - Cache performance metrics
- `smart_whitelist_http_request_duration_seconds` - API latency

### Health Checks

- **Liveness**: Basic service health
- **Readiness**: Database and cache connectivity
- **Deep Health**: ML model status and performance

## Deployment

### Docker

```bash
docker build -t smart-whitelist:latest .
docker run -p 3006:3006 --env-file .env smart-whitelist:latest
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: smart-whitelist
spec:
  replicas: 3
  selector:
    matchLabels:
      app: smart-whitelist
  template:
    metadata:
      labels:
        app: smart-whitelist
    spec:
      containers:
      - name: smart-whitelist
        image: smart-whitelist:latest
        ports:
        - containerPort: 3006
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3006
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3006
```

## Performance Tuning

### Cache Optimization

- Adjust TTL values based on usage patterns
- Monitor cache hit rates and optimize key structures
- Use Redis clustering for high-volume deployments

### ML Performance

- Tune feature extraction worker count
- Adjust confidence thresholds based on accuracy metrics
- Optimize model update intervals

### Database Optimization

- Configure connection pool sizes based on load
- Monitor query performance and add indexes as needed
- Use read replicas for analytics queries

## Security

### Data Privacy

- Phone numbers are hashed for privacy protection
- PII is encrypted in transit and at rest
- Configurable data retention policies

### Access Control

- API key authentication (configurable)
- Rate limiting to prevent abuse
- Input validation and sanitization

## Troubleshooting

### Common Issues

1. **High Latency**
   - Check cache hit rates
   - Monitor database connection pool
   - Verify Redis connectivity

2. **ML Accuracy Issues**
   - Review training data quality
   - Adjust confidence thresholds
   - Monitor learning event processing

3. **Memory Usage**
   - Monitor goroutine counts
   - Check for connection leaks
   - Optimize cache sizes

### Logging

Set `SMART_WHITELIST_LOGGING_LEVEL=debug` for detailed logs.

## Contributing

1. Follow Go best practices and idioms
2. Include tests for new features
3. Update documentation for API changes
4. Monitor performance impact of changes

## License

Part of the AI Answer Ninja project.