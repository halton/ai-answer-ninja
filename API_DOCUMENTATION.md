# AI Answer Ninja - Complete API Documentation

## Overview

This document provides comprehensive API documentation for all 9 core services in the AI Answer Ninja system. Each service is designed to be production-ready with proper security, validation, monitoring, and Azure integrations.

## Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI Answer Ninja Services                     │
├─────────────────────────────────────────────────────────────────┤
│  Core Services (Business Logic)                                │
│  ├── Phone Gateway Service (3001)                              │
│  ├── Real-time Processor Service (3002)                        │
│  ├── Conversation Engine Service (3003)                        │
│  └── Profile Analytics Service (3004)                          │
├─────────────────────────────────────────────────────────────────┤
│  Support Services (Business Support)                           │
│  ├── User Management Service (3005)                            │
│  └── Smart Whitelist Service (3006)                            │
├─────────────────────────────────────────────────────────────────┤
│  Platform Services (Infrastructure)                            │
│  ├── Configuration Service (3007)                              │
│  ├── Storage Service (3008)                                    │
│  └── Monitoring Service (3009)                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Service Details

### 1. Phone Gateway Service (Port 3001)

**Purpose**: Handles incoming calls, routing, and filtering with Azure Communication Services integration.

**Key Features**:
- Azure Communication Services integration
- Intelligent call routing
- Webhook handling for incoming calls
- Real-time call state management
- Call recording and transcription

**API Endpoints**:
```
GET  /                           # Service information
GET  /health                     # Health check
GET  /metrics                    # Service metrics
POST /webhook/incoming-call      # Azure incoming call webhook
POST /webhook/azure-events       # Azure Event Grid webhook
POST /calls/:callId/answer       # Answer specific call
POST /calls/:callId/transfer     # Transfer call to real number
POST /calls/:callId/hangup       # Hang up call
GET  /calls/:callId/status       # Get call status
GET  /routing/stats              # Get routing statistics
```

**Technologies**: Express.js, Azure Communication Services, Azure Event Grid, Redis, PostgreSQL

---

### 2. Real-time Processor Service (Port 3002)

**Purpose**: Real-time audio processing, WebSocket connections, and conversation handling.

**Key Features**:
- WebSocket server for real-time communication
- Audio stream processing
- Azure Speech Services integration
- Performance optimization with circuit breakers
- Connection pooling and rate limiting

**API Endpoints**:
```
GET  /                           # Service information
GET  /health                     # Health check
GET  /metrics                    # Service metrics
GET  /connections                # WebSocket connection stats
GET  /sessions                   # Active session stats
GET  /pool                       # Connection pool stats
GET  /sessions/:sessionId        # Get specific session
DELETE /sessions/call/:callId    # Terminate session
POST /process/audio              # Process audio data (testing)
GET  /process/status/:callId     # Get processing status
WS   /realtime/conversation      # WebSocket endpoint
```

**Technologies**: Express.js, WebSocket, Azure Speech Services, Redis, FFmpeg, WebRTC

---

### 3. Conversation Engine Service (Port 3003)

**Purpose**: Advanced dialog management, personalized responses, and AI conversation handling.

**Key Features**:
- Azure OpenAI integration
- Intent recognition and classification
- Emotion analysis
- Context-aware responses
- Multi-turn conversation management
- Personalized response generation

**API Endpoints**:
```
GET  /                           # Service information
GET  /health                     # Health check
POST /conversation/manage        # Manage conversation state
POST /conversation/personalize   # Generate personalized response
POST /conversation/emotion       # Analyze emotion
POST /conversation/terminate     # Intelligent termination
GET  /conversation/history/:id   # Get conversation history
```

**Technologies**: Express.js, Azure OpenAI, Azure Text Analytics, Natural Language Processing, Redis

---

### 4. Profile Analytics Service (Port 3004)

**Purpose**: Caller profiling, analytics, and ML-powered insights.

**Key Features**:
- Real-time caller profiling
- Behavioral pattern analysis
- ML-powered spam detection
- Analytics report generation
- Trend analysis and insights
- Privacy-compliant data processing

**API Endpoints**:
```
GET  /analytics/profile/:phone     # Get caller profile
POST /analytics/profile/update     # Update profile data
POST /analytics/call/analyze       # Analyze call data
GET  /analytics/trends/:userId     # Get trend analysis
POST /analytics/learning           # ML model learning
GET  /analytics/reports/:userId    # Get analytics reports
```

**Technologies**: Python/TypeScript, scikit-learn, pandas, Azure ML, PostgreSQL, Redis

---

### 5. User Management Service (Port 3005)

**Purpose**: Authentication, authorization, and user management with advanced security.

**Key Features**:
- JWT-based authentication
- Multi-factor authentication (MFA)
- Role-based access control (RBAC)
- Session management
- Security monitoring
- GDPR compliance features

**API Endpoints**:
```
GET  /                           # Service information
GET  /health                     # Health check
POST /auth/login                 # User login
POST /auth/mfa                   # Multi-factor authentication
POST /auth/logout                # User logout
POST /auth/refresh               # Refresh JWT token
GET  /users/:id                  # Get user information
PUT  /users/:id/preferences      # Update user preferences
GET  /users/:id/permissions      # Get user permissions
POST /users/register             # User registration
```

**Technologies**: Express.js, JWT, bcrypt, Redis sessions, PostgreSQL, Nodemailer

---

### 6. Smart Whitelist Service (Port 3006)

**Purpose**: Intelligent whitelist management with ML-powered risk evaluation.

**Key Features**:
- Dynamic whitelist management
- ML-based spam detection
- Risk scoring and evaluation
- Adaptive learning from user behavior
- Bulk import/export operations
- Community-based spam reporting

**API Endpoints**:
```
GET  /                           # Service information
GET  /health                     # Health check
GET  /whitelist/:userId          # Get user whitelist
POST /whitelist/:userId/smart-add # Smart whitelist addition
GET  /whitelist/evaluate/:phone  # Evaluate phone number risk
POST /whitelist/learning         # Update learning model
PUT  /whitelist/rules/:userId    # Update custom rules
POST /whitelist/import           # Bulk import contacts
GET  /whitelist/export/:userId   # Export whitelist data
```

**Technologies**: Node.js/TypeScript, Machine Learning models, Redis, PostgreSQL

---

### 7. Configuration Service (Port 3007)

**Purpose**: Centralized configuration management and feature flag control.

**Key Features**:
- Centralized configuration management
- Feature flag management
- A/B testing support
- Configuration versioning
- Real-time configuration updates
- Environment-specific configurations

**API Endpoints**:
```
GET  /                           # Service information
GET  /health                     # Health check
GET  /config/:service/:key       # Get configuration value
POST /config/:service            # Update service configuration
GET  /config/features/:userId    # Get feature flags
POST /config/experiments         # Manage A/B experiments
GET  /config/versions/:service   # Get configuration history
POST /config/rollback/:service   # Rollback configuration
```

**Technologies**: Express.js, Redis, PostgreSQL, Configuration versioning

---

### 8. Storage Service (Port 3008)

**Purpose**: File storage, audio management, and data archival with Azure integration.

**Key Features**:
- Azure Blob Storage integration
- Audio file processing and compression
- Automatic data archival
- File versioning and backup
- Encryption at rest and in transit
- CDN integration for fast delivery

**API Endpoints**:
```
GET  /                           # Service information
GET  /health                     # Health check
POST /storage/audio/upload       # Upload audio file
GET  /storage/audio/:id          # Download audio file
POST /storage/archive            # Archive old data
DELETE /storage/cleanup          # Clean up expired data
GET  /storage/stats              # Storage statistics
POST /storage/backup             # Trigger backup
```

**Technologies**: Express.js, Azure Blob Storage, FFmpeg, File processing, Encryption

---

### 9. Monitoring Service (Port 3009)

**Purpose**: System monitoring, alerting, and observability across all services.

**Key Features**:
- Prometheus metrics collection
- Grafana dashboard integration
- Intelligent alerting system
- Distributed tracing with Jaeger
- Log aggregation and analysis
- Health monitoring for all services

**API Endpoints**:
```
GET  /                           # Service information
GET  /health                     # Health check
GET  /monitoring/metrics         # System metrics
POST /monitoring/alerts          # Configure alerts
GET  /monitoring/traces/:id      # Get trace information
GET  /monitoring/logs            # Search logs
GET  /monitoring/dashboards      # Available dashboards
POST /monitoring/incidents       # Report incidents
```

**Technologies**: Express.js, Prometheus, Grafana, Jaeger, InfluxDB, Alerting systems

---

## Common Features Across All Services

### Security
- JWT-based authentication
- CORS protection
- Rate limiting
- Input validation
- Security headers (Helmet.js)
- Environment-based configuration

### Monitoring
- Health check endpoints
- Prometheus metrics
- Structured logging
- Error tracking
- Performance monitoring

### Infrastructure
- Docker containerization
- Environment configuration (.env files)
- Graceful shutdown handling
- Database connection pooling
- Redis caching

### Development
- TypeScript/Python implementation
- Unit and integration tests
- API documentation
- Development/production configurations
- Hot reloading in development

## Service Communication

Services communicate through:
1. **HTTP APIs**: Synchronous service-to-service calls
2. **Redis Pub/Sub**: Asynchronous event messaging
3. **WebSocket**: Real-time bidirectional communication
4. **Database**: Shared data persistence

## Deployment

Each service includes:
- `Dockerfile` for containerization
- `.env.example` for environment configuration
- `package.json` with all dependencies
- Health check scripts
- Basic unit tests
- Production-ready logging and monitoring

## Getting Started

1. **Set up environment variables** for each service using the provided `.env.example` files
2. **Install dependencies** in each service directory: `npm install`
3. **Start databases**: PostgreSQL and Redis
4. **Run services** individually or use Docker Compose
5. **Configure Azure services** with your credentials
6. **Access APIs** at their respective ports

## Production Considerations

- Use environment variables for all sensitive configuration
- Set up proper SSL/TLS certificates
- Configure production databases with appropriate resources
- Set up monitoring and alerting
- Implement proper backup strategies
- Use Azure services for production scaling
- Configure load balancers for high availability

## Support

For detailed implementation of specific endpoints, refer to the individual service source code and tests. Each service includes comprehensive error handling, validation, and documentation.