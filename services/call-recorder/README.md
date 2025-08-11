# Call Recorder Service

## Overview

The Call Recorder Service is a comprehensive solution for secure recording, storage, and playback of phone call audio with end-to-end encryption, lifecycle management, and GDPR compliance.

## Features

### Core Functionality
- **Real-time Recording**: Stream and record audio in real-time via WebSocket
- **Secure Storage**: End-to-end encryption with AES-256-GCM
- **Multi-Provider Support**: Azure Blob Storage, AWS S3, or local storage
- **Audio Processing**: Format conversion, compression, noise reduction using FFmpeg
- **Streaming Playback**: HTTP streaming with range request support
- **Lifecycle Management**: Automated archival and deletion policies

### Security & Compliance
- **End-to-End Encryption**: All recordings encrypted at rest and in transit
- **Access Control**: Role-based permissions with audit logging
- **GDPR Compliance**: Data export, deletion, and consent management
- **Legal Hold**: Prevent deletion of recordings under legal hold
- **Audit Trail**: Complete audit log of all operations

### Performance & Scalability
- **CDN Integration**: Azure CDN or CloudFront for global distribution
- **Tiered Storage**: Hot, Cool, Cold, and Archive tiers for cost optimization
- **Queue Processing**: Asynchronous processing with BullMQ
- **Caching**: Redis caching for metadata and presigned URLs
- **Horizontal Scaling**: Stateless design for easy scaling

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client     │────▶│  API Gateway │────▶│  Call        │
│   (WebRTC)   │     │   (Express)  │     │  Recorder    │
└──────────────┘     └──────────────┘     └──────────────┘
                                                  │
                            ┌─────────────────────┼─────────────────────┐
                            │                     │                     │
                      ┌─────▼─────┐        ┌─────▼─────┐        ┌─────▼─────┐
                      │Encryption │        │  Storage  │        │ Lifecycle │
                      │  Service  │        │  Service  │        │  Manager  │
                      └───────────┘        └───────────┘        └───────────┘
                            │                     │                     │
                      ┌─────▼─────────────────────▼─────────────────────▼─────┐
                      │                   Cloud Storage                        │
                      │         (Azure Blob / AWS S3 / Local)                 │
                      └────────────────────────────────────────────────────────┘
```

## API Endpoints

### Recording Management
- `POST /api/v1/recordings` - Upload a recording
- `GET /api/v1/recordings/:id` - Get recording metadata
- `GET /api/v1/recordings` - List recordings with filters
- `DELETE /api/v1/recordings/:id` - Delete a recording

### Playback
- `GET /api/v1/recordings/:id/download` - Download recording file
- `GET /api/v1/recordings/:id/stream` - Stream recording
- `GET /api/v1/recordings/:id/playback-url` - Get presigned playback URL
- `GET /api/v1/recordings/:id/transcript` - Get transcript

### Lifecycle Management
- `POST /api/v1/lifecycle/:id/archive` - Archive recording
- `POST /api/v1/lifecycle/:id/restore` - Restore from archive
- `POST /api/v1/lifecycle/:id/legal-hold` - Apply legal hold
- `DELETE /api/v1/lifecycle/:id/legal-hold` - Remove legal hold

### GDPR Compliance
- `GET /api/v1/gdpr/export` - Export user data
- `DELETE /api/v1/gdpr/data` - Delete all user data
- `GET /api/v1/gdpr/consent` - Get consent status
- `PUT /api/v1/gdpr/consent` - Update consent

### Health & Monitoring
- `GET /health` - Health check endpoint
- `GET /metrics` - Prometheus metrics

## Installation

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- FFmpeg 4+
- Azure Storage Account or AWS S3 Bucket

### Environment Variables

Create a `.env` file with the following variables:

```env
# Server Configuration
NODE_ENV=production
PORT=3010
HOST=0.0.0.0

# Storage Configuration
STORAGE_PROVIDER=azure # or 'aws' or 'local'
MAX_FILE_SIZE=104857600 # 100MB

# Azure Storage (if using Azure)
AZURE_STORAGE_CONNECTION_STRING=your_connection_string
AZURE_CONTAINER_NAME=call-recordings
AZURE_CDN_ENDPOINT=https://your-cdn.azureedge.net

# AWS S3 (if using AWS)
AWS_REGION=us-east-1
AWS_BUCKET_NAME=ai-ninja-recordings
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_CLOUDFRONT_DOMAIN=https://your-distribution.cloudfront.net

# Encryption
MASTER_ENCRYPTION_KEY=your_base64_encoded_256bit_key
ENCRYPTION_ALGORITHM=aes-256-gcm

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ai_ninja
DB_USER=postgres
DB_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password

# Security
JWT_SECRET=your_jwt_secret
API_KEYS=key1,key2,key3

# FFmpeg
FFMPEG_PATH=/usr/local/bin/ffmpeg
FFMPEG_THREADS=2

# Lifecycle Management
RETENTION_DAYS_RECORDING=30
RETENTION_DAYS_TRANSCRIPT=365
ARCHIVAL_ENABLED=true
ARCHIVAL_AFTER_DAYS=7

# GDPR
GDPR_ENABLED=true

# Monitoring
PROMETHEUS_ENABLED=true
HEALTH_CHECK_ENABLED=true
```

### Installation Steps

1. Clone the repository:
```bash
cd services/call-recorder
```

2. Install dependencies:
```bash
npm install
```

3. Build the service:
```bash
npm run build
```

4. Run database migrations:
```bash
npm run migrate
```

5. Start the service:
```bash
npm start
```

## Docker Deployment

### Build Docker Image
```bash
docker build -t ai-ninja/call-recorder:latest .
```

### Run with Docker Compose
```bash
docker-compose up -d
```

## Usage Examples

### Upload a Recording
```javascript
const formData = new FormData();
formData.append('audio', audioFile);
formData.append('callId', 'call-123');
formData.append('callerPhone', '+1234567890');
formData.append('receiverPhone', '+0987654321');
formData.append('startTime', new Date().toISOString());

const response = await fetch('/api/v1/recordings', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

### Stream a Recording
```javascript
const audio = new Audio();
audio.src = `/api/v1/recordings/${recordingId}/stream?quality=high`;
audio.play();
```

### Real-time Recording via WebSocket
```javascript
const socket = io('wss://recorder.example.com', {
  auth: { token: authToken }
});

// Start recording
socket.emit('recording:start', {
  callId: 'call-123',
  format: 'webm'
});

// Send audio chunks
mediaRecorder.ondataavailable = (event) => {
  if (event.data.size > 0) {
    socket.emit('recording:chunk', {
      callId: 'call-123',
      chunk: event.data,
      sequence: chunkSequence++
    });
  }
};

// Stop recording
socket.emit('recording:stop', { callId: 'call-123' });
```

## Security Considerations

### Encryption
- All recordings are encrypted using AES-256-GCM
- Each user has a unique encryption key derived from the master key
- Keys are rotated every 30 days
- Encryption metadata stored separately from audio data

### Access Control
- JWT-based authentication required for all endpoints
- Role-based access control (RBAC)
- Per-recording access permissions
- Complete audit trail of all access attempts

### Data Protection
- Sensitive data (Level 3) classification for recordings
- Automatic anonymization after retention period
- GDPR-compliant data deletion with verification
- Legal hold mechanism to prevent accidental deletion

## Performance Optimization

### Storage Tiers
- **Hot**: Frequently accessed (< 7 days old)
- **Cool**: Occasionally accessed (7-30 days)
- **Cold**: Rarely accessed (30-90 days)
- **Archive**: Long-term retention (> 90 days)

### Caching Strategy
- Redis cache for metadata (TTL: 1 hour)
- Presigned URL cache (TTL: 15 minutes)
- CDN edge caching for frequently accessed recordings

### Scalability
- Horizontal scaling with Kubernetes
- Queue-based asynchronous processing
- Database connection pooling
- Streaming for large files

## Monitoring & Observability

### Metrics
- Recording upload/download rate
- Storage usage by tier
- Encryption/decryption performance
- Queue processing times
- API response times

### Logging
- Structured JSON logging
- Daily log rotation
- Separate audit logs
- Error tracking with stack traces

### Health Checks
- Storage connectivity
- Database health
- Redis availability
- FFmpeg functionality
- Queue status

## Testing

Run tests:
```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Coverage report
npm run test:coverage
```

## Troubleshooting

### Common Issues

1. **Upload fails with "Invalid file format"**
   - Check that the file format is in the allowed list
   - Verify FFmpeg is installed and accessible

2. **Encryption error**
   - Ensure master key is properly configured
   - Check key is base64 encoded 256-bit value

3. **Storage connection error**
   - Verify storage credentials
   - Check network connectivity to storage provider

4. **Playback issues**
   - Ensure CDN is properly configured
   - Check CORS settings
   - Verify presigned URL hasn't expired

## Contributing

Please see the main project's CONTRIBUTING.md for guidelines.

## License

MIT License - See LICENSE file for details

## Support

For issues and questions, please open an issue in the main repository or contact the AI Ninja team.