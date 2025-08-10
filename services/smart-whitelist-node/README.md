# Smart Whitelist Service (Node.js)

A high-performance intelligent whitelist management service with machine learning capabilities for the AI Answer Ninja project.

## Features

### Core Capabilities
- **Ultra-Fast Lookup** (<5ms): Redis-backed multi-level caching
- **Machine Learning Integration**: Real-time phone number classification
- **Intelligent Auto-Add**: ML-assisted whitelist management
- **Rules Engine**: Flexible, user-configurable filtering rules
- **Learning System**: Continuous improvement from user feedback
- **Batch Operations**: Efficient bulk management
- **Import/Export**: CSV and JSON format support

### Performance Targets
- Whitelist lookup: <5ms (P95)
- ML classification: <100ms (P95)
- API response time: <200ms (P95)
- Cache hit rate: >90%
- Concurrent requests: 1000+ RPS

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- PostgreSQL 15+
- Redis 7+
- Docker (optional)

### Development Setup

1. **Clone and navigate to the service:**
```bash
cd /Users/halton/work/ai-answer-ninja/services/smart-whitelist-node
```

2. **Install dependencies:**
```bash
npm install
```

3. **Set up environment:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Start dependencies (using Docker):**
```bash
docker-compose up postgres redis -d
```

5. **Run database migrations:**
```bash
# Ensure the parent project's database schema is applied
cd ../../database
psql -h localhost -U postgres -d ai_answer_ninja -f schemas/01-core-tables.sql
```

6. **Start the service:**
```bash
npm run dev
```

The service will be available at `http://localhost:3006`

### Docker Deployment

**Development with all services:**
```bash
docker-compose up --build
```

**Production deployment:**
```bash
docker-compose -f docker-compose.yml up --build -d
```

**With monitoring stack:**
```bash
docker-compose --profile monitoring up --build -d
```

## API Documentation

### Base URL
```
http://localhost:3006/api/v1
```

### Authentication
All API endpoints (except evaluation) require JWT authentication:
```bash
Authorization: Bearer <jwt_token>
```

### Core Endpoints

#### Whitelist Management

**Get User Whitelist**
```bash
GET /whitelist/:userId?page=1&limit=50&active=true&type=manual&search=phone

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3006/api/v1/whitelist/123e4567-e89b-12d3-a456-426614174000"
```

**Create Whitelist Entry**
```bash
POST /whitelist
Content-Type: application/json

{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "contactPhone": "1234567890",
  "contactName": "John Doe",
  "whitelistType": "manual",
  "confidenceScore": 1.0
}
```

**Smart Add (ML-Assisted)**
```bash
POST /whitelist/smart-add
Content-Type: application/json

{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "contactPhone": "1234567890",
  "contactName": "John Doe",
  "context": "user_interaction",
  "tags": ["friend", "work"]
}
```

**Evaluate Phone Number**
```bash
POST /whitelist/evaluate
Content-Type: application/json

{
  "phone": "1234567890",
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "context": {
    "callTime": "2024-01-15T10:30:00Z",
    "userInteraction": true
  },
  "includeFeatures": true
}
```

#### Batch Operations

**Batch Create**
```bash
POST /whitelist/batch
Content-Type: application/json

{
  "entries": [
    {
      "userId": "123e4567-e89b-12d3-a456-426614174000",
      "contactPhone": "1234567890",
      "contactName": "John Doe",
      "whitelistType": "manual"
    }
  ]
}
```

**Import Whitelist**
```bash
POST /whitelist/import
Content-Type: application/json

{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "entries": [
    {
      "contactPhone": "1234567890",
      "contactName": "John Doe"
    }
  ],
  "overwrite": false
}
```

**Export Whitelist**
```bash
GET /whitelist/export/:userId?format=json&includeExpired=false

# Export as CSV
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3006/api/v1/whitelist/export/123e4567-e89b-12d3-a456-426614174000?format=csv" \
  -o whitelist.csv
```

#### Rules Management

**Get User Rules**
```bash
GET /whitelist/rules/:userId
```

**Update User Rules**
```bash
PUT /whitelist/rules/:userId
Content-Type: application/json

{
  "rules": {
    "autoLearnThreshold": 0.85,
    "allowTemporary": true,
    "maxTemporaryDuration": 24,
    "blockKnownSpam": true,
    "patterns": {
      "allowedPrefixes": ["555", "800"],
      "blockedPrefixes": ["900"],
      "allowedKeywords": ["work", "family"],
      "blockedKeywords": ["spam", "telemarketer"]
    }
  }
}
```

#### Learning and Feedback

**Record Learning Event**
```bash
POST /whitelist/learning
Content-Type: application/json

{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "phone": "1234567890",
  "eventType": "accept",
  "confidence": 0.9,
  "feedback": "not_spam",
  "context": {
    "callDuration": 120,
    "timeOfDay": "morning"
  }
}
```

### Health Endpoints

```bash
GET /health              # Basic health check
GET /health/live         # Kubernetes liveness probe
GET /health/ready        # Kubernetes readiness probe
GET /health/deep         # Comprehensive health check
GET /health/performance  # Performance metrics
GET /metrics            # Prometheus metrics
```

## Configuration

### Environment Variables

**Core Configuration**
- `NODE_ENV`: Environment (development/production/test)
- `PORT`: Server port (default: 3006)
- `HOST`: Server host (default: 0.0.0.0)

**Database**
- `DB_HOST`: PostgreSQL host
- `DB_PORT`: PostgreSQL port
- `DB_NAME`: Database name
- `DB_USER`: Database user
- `DB_PASSWORD`: Database password

**Redis**
- `REDIS_HOST`: Redis host
- `REDIS_PORT`: Redis port
- `REDIS_DB`: Redis database number

**Machine Learning**
- `ML_ENABLED`: Enable ML features (true/false)
- `ML_CONFIDENCE_THRESHOLD`: Minimum confidence for auto-actions
- `ML_AUTO_LEARN_THRESHOLD`: Threshold for automatic learning

### Performance Tuning

**Cache TTL Settings (seconds)**
```bash
CACHE_TTL_WHITELIST=600      # 10 minutes
CACHE_TTL_SPAM_PROFILE=7200  # 2 hours
CACHE_TTL_USER_CONFIG=1800   # 30 minutes
CACHE_TTL_ML_FEATURES=3600   # 1 hour
```

**Rate Limiting**
```bash
RATE_LIMIT_WINDOW=900000  # 15 minutes
RATE_LIMIT_MAX=100        # Max requests per window
```

## Architecture

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Gateway   │────│  Smart Whitelist │────│   Rules Engine  │
│                 │    │     Service      │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │                        │
         ┌────────────────────┼────────────────────────┼────────────┐
         │                    │                        │            │
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│      Cache      │  │   PostgreSQL    │  │  ML Classifier  │  │   User Learning │
│    (Redis)      │  │   Database      │  │                 │  │     System      │
└─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Data Flow

1. **Request** → API validation & authentication
2. **Cache Check** → Ultra-fast lookup in Redis
3. **Database Query** → PostgreSQL with optimized indexes
4. **ML Processing** → Feature extraction & classification
5. **Rules Engine** → User-configurable rule evaluation
6. **Response** → Cached result with metadata

### Performance Architecture

**Multi-Level Caching**
- L1: In-memory (Node.js) - <1ms
- L2: Redis cache - <5ms
- L3: Database - <50ms

**Async Processing**
- Learning events queued for background processing
- ML model updates in separate workers
- Non-blocking cache warming

## Machine Learning Features

### Feature Extraction
The ML system extracts 20+ features from phone numbers:
- **Pattern Analysis**: Repeating digits, sequences, complexity
- **Geographic Analysis**: Area codes, regions, carriers
- **Behavioral Analysis**: Call patterns, timing, duration
- **Context Analysis**: Keywords, urgency indicators

### Classification
- **Real-time Classification**: <100ms response time
- **Confidence Scoring**: 0-1 scale for decision making
- **Spam Type Detection**: Sales, loans, investments, scams
- **Continuous Learning**: User feedback integration

### Rules Engine
- **Flexible Conditions**: Pattern matching, thresholds, lists
- **Priority System**: Rule execution order management
- **User Customization**: Personal rule definitions
- **A/B Testing**: Experimental rule deployment

## Monitoring and Observability

### Health Checks
- **Liveness**: Basic service availability
- **Readiness**: Dependency connectivity
- **Deep Health**: Comprehensive system status

### Metrics Collection
- **Performance**: Response times, throughput, error rates
- **Business**: Whitelist statistics, ML accuracy, cache hit rates
- **System**: Memory, CPU, database connections

### Monitoring Stack
```bash
# Start with monitoring
docker-compose --profile monitoring up -d

# Access monitoring tools
Grafana: http://localhost:3000 (admin/admin)
Prometheus: http://localhost:9090
```

### Key Metrics
- `smart_whitelist_total_entries`: Total whitelist entries
- `smart_whitelist_cache_hit_rate`: Cache performance
- `smart_whitelist_ml_classifications_total`: ML usage
- `smart_whitelist_db_latency_ms`: Database performance

## Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:integration
```

### Load Testing
```bash
npm run test:load
```

### Coverage Report
```bash
npm run test:coverage
```

## Security

### Authentication & Authorization
- JWT-based authentication
- Role-based access control (RBAC)
- API key support for service-to-service calls
- Request rate limiting

### Data Protection
- Phone number hashing for privacy
- Configurable data retention policies
- Audit logging for compliance
- Input validation and sanitization

### API Security
- CORS configuration
- Helmet security headers
- Request timeout protection
- SQL injection prevention

## Deployment

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
        env:
        - name: NODE_ENV
          value: "production"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3006
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3006
          initialDelaySeconds: 5
          periodSeconds: 5
```

### Production Checklist
- [ ] Configure proper environment variables
- [ ] Set up database migrations
- [ ] Configure SSL/TLS certificates
- [ ] Set up monitoring and alerting
- [ ] Configure log aggregation
- [ ] Set up backup strategies
- [ ] Configure auto-scaling policies
- [ ] Security audit and penetration testing

## Troubleshooting

### Common Issues

**High Latency**
1. Check cache hit rates in `/health/performance`
2. Monitor database connection pool
3. Verify Redis connectivity
4. Review slow query logs

**Memory Issues**
1. Monitor learning queue size
2. Check for connection leaks
3. Optimize cache TTL settings
4. Review ML model memory usage

**ML Accuracy Problems**
1. Review training data quality
2. Adjust confidence thresholds
3. Monitor user feedback processing
4. Check feature extraction pipeline

### Debugging
```bash
# Enable debug logging
LOG_LEVEL=debug npm run dev

# Monitor real-time metrics
curl http://localhost:3006/health/performance

# Check service statistics
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3006/api/v1/whitelist/stats/USER_ID
```

## Contributing

1. Follow Node.js best practices and TypeScript guidelines
2. Include comprehensive tests for new features
3. Update API documentation for endpoint changes
4. Monitor performance impact of changes
5. Follow semantic versioning for releases

## License

Part of the AI Answer Ninja project - Proprietary