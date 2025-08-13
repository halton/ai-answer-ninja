# Profile Analytics Service

Advanced Profile Analytics Service with ML-powered insights, real-time processing, and intelligent recommendations for AI Answer Ninja platform.

## 🎯 Features

### Core Analytics
- **Advanced User Profiling**: Deep behavioral analysis and pattern recognition
- **Caller Intelligence**: Comprehensive caller profiling with spam detection
- **Real-time Processing**: High-throughput stream processing with sub-second latency
- **Trend Analysis**: Time series analysis with seasonality and anomaly detection
- **Predictive Modeling**: ML-powered predictions and recommendations

### Intelligence Engines
- **Behavioral Pattern Recognition**: Automated detection of user interaction patterns
- **Anomaly Detection**: Real-time identification of unusual activities
- **Intelligent Recommendations**: Context-aware suggestions for optimization
- **Risk Assessment**: Continuous security and privacy risk evaluation

### Machine Learning
- **Multiple Algorithm Support**: Random Forest, Neural Networks, LSTM, Isolation Forest
- **Auto-ML Pipeline**: Automated model training and optimization
- **Feature Engineering**: Advanced feature extraction and selection
- **Model Performance Monitoring**: Real-time accuracy tracking and alerts

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Data Input    │───▶│  Stream Processor │───▶│  ML Pipeline    │
│   (Events)      │    │  (Real-time)     │    │  (Predictions)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Trend         │◀───│   Advanced       │◀───│  Recommendation │
│   Analyzer      │    │   Profile        │    │  Engine         │
│                 │    │   Service        │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- Redis 6+
- PostgreSQL 12+
- TypeScript 4.5+

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd services/profile-analytics

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Build the project
npm run build

# Start the service
npm start
```

### Development Mode

```bash
# Start with hot reload
npm run dev

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint
```

### Docker Deployment

```bash
# Build Docker image
docker build -t profile-analytics-service .

# Run container
docker run -p 3004:3004 profile-analytics-service

# Or use Docker Compose
docker-compose up profile-analytics
```

## 📡 API Endpoints

### User Profiles
```
GET    /api/profiles/:userId              # Get user profile
GET    /api/profiles/caller/:phoneNumber  # Get caller profile  
GET    /api/profiles/:userId/patterns     # Analyze behavior patterns
GET    /api/profiles/:userId/anomalies    # Detect anomalies
POST   /api/profiles/interactions         # Record interaction
```

### Analytics
```
GET    /api/analytics/:userId/summary     # Analytics summary
GET    /api/analytics/metrics             # System metrics
```

### Recommendations
```
GET    /api/recommendations/:userId                        # Get recommendations
POST   /api/recommendations/:userId/:id/implement          # Mark as implemented
POST   /api/recommendations/:userId/:id/feedback           # Provide feedback
GET    /api/recommendations/stats                          # Statistics
```

### Real-time Processing
```
POST   /api/realtime/events               # Add real-time event
GET    /api/realtime/metrics              # Processing metrics
GET    /api/realtime/processors           # Processor status
```

### Trend Analysis
```
GET    /api/trends/:userId/summary        # Trend summary
POST   /api/trends/:userId/monitor        # Start monitoring
```

### Machine Learning
```
GET    /api/models                        # Available models
GET    /api/models/:name/performance      # Model performance
POST   /api/models/:name/predict          # Make prediction
```

## 🧠 Machine Learning Models

### Built-in Models

1. **Spam Classifier**
   - Algorithm: Random Forest
   - Purpose: Classify incoming calls as spam/legitimate
   - Features: Phone patterns, timing, frequency
   - Accuracy: 95%+

2. **Behavior Predictor**
   - Algorithm: Neural Network
   - Purpose: Predict user behavior patterns
   - Features: Interaction history, preferences
   - Accuracy: 85%+

3. **Anomaly Detector**
   - Algorithm: Isolation Forest
   - Purpose: Detect unusual activities
   - Features: Call patterns, timing anomalies
   - Sensitivity: Configurable

4. **Time Series Forecaster**
   - Algorithm: LSTM
   - Purpose: Predict future trends
   - Features: Historical time series data
   - Horizon: 48 hours

### Model Training

```javascript
// Train a new model
const trainingData = {
  features: [[...], [...]],
  labels: [0, 1, ...]
};

await predictiveModels.trainModel('spam_classifier', trainingData);
```

### Custom Models

```javascript
// Register custom model
const customModel = {
  modelType: 'classification',
  algorithm: 'custom_algorithm',
  hyperparameters: { ... },
  trainingConfig: { ... }
};

predictiveModels.registerModel('my_model', customModel);
```

## 📊 Analytics & Insights

### User Behavior Analysis
- **Interaction Patterns**: Call frequency, timing preferences
- **Response Patterns**: Answer rates, duration analysis  
- **Preference Learning**: Adaptive whitelist strategies
- **Risk Profiling**: Spam exposure assessment

### Caller Intelligence
- **Spam Detection**: Multi-factor classification
- **Network Analysis**: Related number identification
- **Behavioral Profiling**: Persistence and aggression metrics
- **Campaign Detection**: Coordinated attack identification

### Real-time Insights
- **Live Monitoring**: Real-time event processing
- **Instant Alerts**: Anomaly and threat detection
- **Performance Tracking**: System health monitoring
- **Adaptive Learning**: Continuous model improvement

## 🔧 Configuration

### Environment Variables

```env
# Service Configuration
PORT=3004
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=INFO

# Feature Flags
ENABLE_CACHING=true
ENABLE_REALTIME=true

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/analytics
REDIS_URL=redis://localhost:6379

# Machine Learning
ML_MODEL_PATH=/app/models
ML_TRAINING_BATCH_SIZE=1000
ML_PREDICTION_CACHE_TTL=300

# Security
JWT_SECRET=your-secret-key
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=1000
```

### Service Configuration

```json
{
  "trendAnalyzer": {
    "windowSize": 24,
    "seasonalityThreshold": 0.7,
    "anomalyThreshold": 3.0,
    "forecastHorizon": 48
  },
  "realtimeProcessor": {
    "batchSize": 100,
    "flushInterval": 5000,
    "maxRetries": 3,
    "parallelProcessors": 4
  },
  "cache": {
    "defaultTTL": 3600,
    "maxSize": 104857600,
    "checkPeriod": 60000
  }
}
```

## 📈 Performance Metrics

### Target Performance
- **API Response Time**: < 100ms (P95)
- **Stream Processing Latency**: < 50ms (P95)
- **ML Prediction Time**: < 200ms (P95)
- **Throughput**: 10,000 events/second
- **Cache Hit Rate**: > 90%

### Monitoring
- **Health Checks**: `/health` endpoint
- **Metrics**: Prometheus-compatible metrics
- **Logging**: Structured JSON logs
- **Tracing**: Request correlation IDs

## 🔒 Security

### Data Protection
- **Encryption**: AES-256 for sensitive data
- **Access Control**: JWT-based authentication
- **Rate Limiting**: Request throttling
- **Input Validation**: Comprehensive sanitization

### Privacy Compliance
- **Data Minimization**: Collect only necessary data
- **Anonymization**: Automatic PII removal
- **Retention Policies**: Configurable data lifecycle
- **Audit Logging**: Complete access tracking

## 🧪 Testing

### Test Coverage
```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# Performance tests
npm run test:performance

# Coverage report
npm run test:coverage
```

### Performance Testing
```bash
# Load testing
npm run benchmark

# Memory profiling
npm run profile:memory

# CPU profiling  
npm run profile:cpu
```

## 📚 Documentation

### API Documentation
- **OpenAPI Spec**: Available at `/api/docs`
- **Postman Collection**: `docs/postman/`
- **Integration Examples**: `docs/examples/`

### Development Guide
- **Contributing**: See `CONTRIBUTING.md`
- **Architecture**: See `docs/architecture.md`
- **Deployment**: See `docs/deployment.md`

## 🚀 Deployment

### Production Deployment

```bash
# Build production image
docker build -t profile-analytics:latest .

# Deploy with Docker Compose
docker-compose -f docker-compose.prod.yml up -d

# Or deploy to Kubernetes
kubectl apply -f k8s/
```

### Scaling Considerations
- **Horizontal Scaling**: Stateless design enables easy scaling
- **Database Partitioning**: Time-based partitioning for large datasets
- **Cache Clustering**: Redis cluster for high availability
- **Load Balancing**: Round-robin with health checks

## 🔄 Data Flow

### Input Data Sources
1. **Call Events**: Incoming/outgoing call metadata
2. **User Interactions**: UI interactions and feedback
3. **Security Events**: Authentication and authorization events
4. **System Metrics**: Performance and health data

### Processing Pipeline
1. **Ingestion**: Real-time event streaming
2. **Validation**: Data quality checks
3. **Enrichment**: Context addition and feature extraction
4. **Analysis**: ML model inference and trend analysis
5. **Storage**: Structured data persistence
6. **Insights**: Recommendation generation

### Output Destinations
1. **API Responses**: Real-time query results
2. **Recommendations**: Personalized suggestions
3. **Alerts**: Anomaly and threat notifications
4. **Reports**: Scheduled analysis summaries

## 🤝 Integration

### Service Dependencies
- **User Management**: User authentication and profiles
- **Phone Gateway**: Call routing and metadata
- **Real-time Processor**: Audio processing results
- **Configuration Service**: Feature flags and settings

### Event Contracts
```typescript
// Call Event
interface CallEvent {
  userId: string;
  callerPhone: string;
  callType: 'incoming' | 'outgoing';
  outcome: 'answered' | 'rejected' | 'ai_handled';
  timestamp: Date;
  duration?: number;
  metadata: Record<string, any>;
}

// User Interaction Event
interface InteractionEvent {
  userId: string;
  action: string;
  context: Record<string, any>;
  timestamp: Date;
}
```

## 📞 Support

### Getting Help
- **Documentation**: Complete API and integration docs
- **Issues**: GitHub issue tracker
- **Contact**: team@ai-answer-ninja.com

### Troubleshooting
- **Health Check**: `GET /health`
- **Logs**: Structured logs with correlation IDs
- **Metrics**: Prometheus metrics endpoint
- **Debug Mode**: Set `LOG_LEVEL=DEBUG`

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🎉 Acknowledgments

- Built with TypeScript and Node.js
- Powered by advanced ML algorithms
- Designed for high-performance real-time analytics
- Optimized for AI Answer Ninja platform integration