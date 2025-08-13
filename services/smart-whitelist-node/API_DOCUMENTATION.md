# Smart Whitelist API Documentation

## Overview

The Smart Whitelist API provides comprehensive phone number whitelist management with advanced ML-based spam detection, behavioral learning, and intelligent filtering capabilities.

**Base URL:** `http://localhost:3006/api/v1`  
**Version:** 1.0.0  
**Authentication:** Bearer Token Required

---

## Table of Contents

1. [Authentication](#authentication)
2. [Core Whitelist Operations](#core-whitelist-operations)
3. [Smart Evaluation & ML Integration](#smart-evaluation--ml-integration)
4. [Import/Export Operations](#importexport-operations)
5. [User Behavior & Learning](#user-behavior--learning)
6. [Analytics & Monitoring](#analytics--monitoring)
7. [Error Handling](#error-handling)
8. [Rate Limiting](#rate-limiting)

---

## Authentication

All API endpoints require authentication using Bearer tokens.

```http
Authorization: Bearer <your-token>
```

### Authentication Errors

- `401 Unauthorized` - Missing or invalid token
- `403 Forbidden` - Token valid but insufficient permissions

---

## Core Whitelist Operations

### Get User Whitelist

Retrieve whitelist entries for a user with pagination and filtering.

```http
GET /whitelist/{userId}
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `page` | integer | Page number (1-based) | 1 |
| `limit` | integer | Items per page (max 100) | 50 |
| `active` | boolean | Filter by active status | all |
| `type` | string | Filter by whitelist type | all |
| `search` | string | Search in phone/name | - |

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "contactPhone": "+1234567890",
      "contactName": "John Doe",
      "whitelistType": "manual",
      "confidenceScore": 0.95,
      "isActive": true,
      "hitCount": 5,
      "lastHitAt": "2023-12-01T10:00:00Z",
      "createdAt": "2023-11-01T10:00:00Z",
      "updatedAt": "2023-12-01T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 100,
    "pages": 2
  },
  "meta": {
    "timestamp": "2023-12-01T10:00:00Z",
    "requestId": "req-123"
  }
}
```

### Create Whitelist Entry

Add a new phone number to the whitelist.

```http
POST /whitelist
```

**Request Body:**

```json
{
  "userId": "uuid",
  "contactPhone": "+1234567890",
  "contactName": "John Doe",
  "whitelistType": "manual",
  "confidenceScore": 1.0,
  "expiresAt": "2024-12-01T10:00:00Z"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "contactPhone": "+1234567890",
    "contactName": "John Doe",
    "whitelistType": "manual",
    "confidenceScore": 1.0,
    "isActive": true,
    "hitCount": 0,
    "createdAt": "2023-12-01T10:00:00Z",
    "updatedAt": "2023-12-01T10:00:00Z"
  }
}
```

### Update Whitelist Entry

Update an existing whitelist entry.

```http
PUT /whitelist/{id}
```

**Request Body:**

```json
{
  "contactName": "Jane Doe",
  "confidenceScore": 0.9,
  "isActive": true
}
```

### Delete Whitelist Entry

Remove a whitelist entry.

```http
DELETE /whitelist/{id}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

### Smart Add

Intelligently add a phone number with ML assistance.

```http
POST /whitelist/smart-add
```

**Request Body:**

```json
{
  "userId": "uuid",
  "contactPhone": "+1234567890",
  "contactName": "John Doe",
  "confidence": 0.8,
  "context": "user_interaction",
  "tags": ["family", "important"]
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "whitelistType": "learned",
    "confidenceScore": 0.85,
    "mlRecommendation": "auto_approved",
    "reasoning": "High confidence based on user interaction patterns"
  }
}
```

---

## Smart Evaluation & ML Integration

### Evaluate Phone Number

Comprehensive risk evaluation using ML and rules engine.

```http
POST /whitelist/evaluate
```

**Request Body:**

```json
{
  "phone": "+1234567890",
  "userId": "uuid",
  "context": {
    "callTime": "2023-12-01T10:00:00Z",
    "userLocation": "home",
    "callDuration": 30
  },
  "includeFeatures": true
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "phone": "+1234567890",
    "isWhitelisted": false,
    "isSpam": true,
    "spamType": "telemarketing",
    "confidenceScore": 0.85,
    "riskScore": 0.75,
    "riskLevel": "high",
    "classification": "spam_sales",
    "recommendation": "block",
    "reasons": [
      "High risk pattern detected",
      "Multiple spam reports",
      "Aggressive calling pattern"
    ],
    "mlFeatures": {
      "hasRepeatingDigits": false,
      "hasSequentialDigits": false,
      "digitComplexity": 0.8,
      "region": "US-Northeast",
      "isVoip": false,
      "spamIndicatorCount": 3
    },
    "processingTimeMs": 245,
    "modelVersion": "2.1.0",
    "evaluationId": "eval-abc123"
  }
}
```

### Batch Evaluation

Evaluate multiple phone numbers at once.

```http
POST /whitelist/evaluate/batch
```

**Request Body:**

```json
{
  "phones": [
    {
      "phone": "+1234567890",
      "userId": "uuid",
      "context": {}
    },
    {
      "phone": "+1987654321",
      "userId": "uuid",
      "context": {}
    }
  ],
  "options": {
    "includeFeatures": false,
    "fastMode": true
  }
}
```

### Record Learning Feedback

Provide feedback for ML model improvement.

```http
POST /whitelist/learning
```

**Request Body:**

```json
{
  "userId": "uuid",
  "phone": "+1234567890",
  "eventType": "reject",
  "feedback": "spam",
  "confidence": 0.9,
  "context": {
    "userSatisfaction": "satisfied",
    "callOutcome": "blocked_correctly"
  }
}
```

---

## Import/Export Operations

### Import Whitelist

Import whitelist entries from a file.

```http
POST /whitelist/import
Content-Type: multipart/form-data
```

**Form Data:**

- `file`: The import file (CSV, JSON, Excel, or vCard)
- `userId`: User ID
- `format`: File format (`csv`, `json`, `xlsx`, `vcf`)
- `options`: JSON string with import options

**Import Options:**

```json
{
  "allowDuplicates": false,
  "allowHighRisk": false,
  "validateWithML": true,
  "source": "manual_import"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "importId": "import_123",
    "totalEntries": 100,
    "processed": 95,
    "successful": 90,
    "failed": 5,
    "duplicates": 5,
    "errors": [
      {
        "line": 10,
        "field": "contactPhone",
        "message": "Invalid phone number format",
        "code": "INVALID_PHONE"
      }
    ],
    "processingTimeMs": 2500
  }
}
```

### Validate Import File

Validate an import file before processing.

```http
POST /whitelist/import/validate
Content-Type: multipart/form-data
```

**Form Data:**

- `file`: The file to validate
- `format`: File format

**Response:**

```json
{
  "success": true,
  "data": {
    "valid": true,
    "totalEntries": 100,
    "sampleEntries": [
      {
        "contactPhone": "+1234567890",
        "contactName": "John Doe",
        "whitelistType": "manual"
      }
    ],
    "formatValidation": {
      "valid": true,
      "errors": [],
      "warnings": ["5 entries missing contact names"]
    },
    "issues": {
      "duplicates": 2,
      "invalidPhones": 1,
      "missingRequired": 0,
      "formatErrors": 0
    },
    "estimation": {
      "expectedSuccess": 97,
      "expectedFailures": 1,
      "expectedDuplicates": 2
    },
    "recommendations": [
      "Fix invalid phone number on line 15",
      "Consider adding names for entries without them"
    ]
  }
}
```

### Export Whitelist

Export user's whitelist entries.

```http
GET /whitelist/export/{userId}
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `format` | string | Export format (`csv`, `json`, `xlsx`, `vcf`) |
| `includeInactive` | boolean | Include inactive entries |
| `includeMetadata` | boolean | Include additional metadata |
| `dateRange` | string | Date range filter (ISO format) |

**Response:**

- Content-Type varies by format
- Content-Disposition: attachment with filename
- Binary file data

---

## User Behavior & Learning

### Get User Rules

Retrieve user's whitelist rules and preferences.

```http
GET /whitelist/rules/{userId}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "autoLearnThreshold": 0.8,
    "allowTemporary": true,
    "maxTemporaryDuration": 24,
    "blockKnownSpam": true,
    "requireManualApproval": false,
    "patterns": {
      "allowedPrefixes": ["+1800", "+1888"],
      "blockedPrefixes": ["+1900"],
      "allowedKeywords": ["family", "work"],
      "blockedKeywords": ["sales", "marketing"]
    }
  }
}
```

### Update User Rules

Update user's whitelist rules.

```http
PUT /whitelist/rules/{userId}
```

**Request Body:**

```json
{
  "rules": {
    "autoLearnThreshold": 0.85,
    "blockKnownSpam": true,
    "patterns": {
      "blockedPrefixes": ["+1900", "+1976"]
    }
  }
}
```

### Get Behavior Analytics

Analyze user call handling patterns.

```http
GET /whitelist/behavior/{userId}/analytics
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `timeframe` | string | Analysis period (`day`, `week`, `month`) | `week` |

**Response:**

```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "timeframe": "week",
    "totalCalls": 45,
    "patterns": {
      "temporal": {
        "peakHours": [9, 14, 16],
        "quietHours": [22, 23, 0, 1, 2, 3, 4, 5, 6, 7],
        "weekendActivity": 0.3
      },
      "response": {
        "averageResponseTime": 3.2,
        "answerRate": 0.65,
        "blockRate": 0.25,
        "ignoreRate": 0.1
      },
      "category": {
        "spamBlocked": 12,
        "legitimateAnswered": 28,
        "uncertainHandled": 5
      }
    },
    "insights": [
      "User is most active during business hours",
      "High accuracy in spam detection (92%)",
      "Prefers to answer calls from known numbers"
    ],
    "recommendations": [
      "Consider enabling auto-block for high-confidence spam",
      "Add frequently called numbers to whitelist"
    ],
    "confidenceScore": 0.87
  }
}
```

### Predict User Response

Predict how user would respond to an incoming call.

```http
POST /whitelist/behavior/{userId}/predict
```

**Request Body:**

```json
{
  "phone": "+1234567890",
  "context": {
    "time": "2023-12-01T14:30:00Z",
    "userLocation": "office",
    "callerName": "Unknown",
    "callHistory": []
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "predictedResponse": "block",
    "confidence": 0.82,
    "reasoning": "Pattern matches previous spam calls during work hours",
    "influencingFactors": [
      "Unknown caller during business hours",
      "Similar pattern to blocked calls",
      "User typically blocks unfamiliar numbers at work"
    ],
    "alternativeResponses": [
      {
        "response": "analyze",
        "probability": 0.15
      },
      {
        "response": "allow",
        "probability": 0.03
      }
    ]
  }
}
```

---

## Analytics & Monitoring

### Get Statistics

Retrieve user whitelist statistics.

```http
GET /whitelist/stats/{userId}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "total": 150,
    "active": 145,
    "inactive": 5,
    "byType": {
      "manual": 80,
      "auto": 45,
      "temporary": 15,
      "learned": 10
    },
    "effectiveness": {
      "spamBlocked": 245,
      "falsePositives": 3,
      "accuracy": 0.94
    },
    "recentActivity": {
      "newEntriesThisWeek": 5,
      "hitsThisWeek": 28,
      "topCallers": [
        {
          "phone": "+1234567890",
          "name": "John Doe",
          "hits": 8
        }
      ]
    }
  }
}
```

### Get ML Performance

Retrieve ML model performance metrics.

```http
GET /whitelist/ml/performance
```

**Query Parameters:**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `userId` | string | User-specific metrics (optional) | global |
| `timeframe` | string | Time period | `day` |

**Response:**

```json
{
  "success": true,
  "data": {
    "timeframe": "day",
    "totalEvaluations": 1250,
    "accuracy": 0.94,
    "precision": 0.92,
    "recall": 0.96,
    "f1Score": 0.94,
    "avgConfidence": 0.87,
    "avgProcessingTime": 185,
    "modelPerformance": {
      "enhancedML": {
        "accuracy": 0.95,
        "avgTime": 150
      },
      "rulesEngine": {
        "accuracy": 0.88,
        "avgTime": 35
      }
    },
    "cacheHitRate": 0.65,
    "errorRate": 0.02
  }
}
```

### Health Check

Check service health and status.

```http
GET /health
```

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2023-12-01T10:00:00Z",
  "version": "1.0.0",
  "uptime": 86400,
  "services": {
    "database": true,
    "redis": true,
    "mlService": true,
    "importExport": true
  },
  "metrics": {
    "requestsPerMinute": 45,
    "averageResponseTime": 125,
    "activeConnections": 23,
    "memoryUsage": "512MB",
    "cpuUsage": "15%"
  }
}
```

---

## Error Handling

### Error Response Format

All error responses follow this format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {
      "field": "specific_field",
      "value": "invalid_value"
    }
  },
  "meta": {
    "timestamp": "2023-12-01T10:00:00Z",
    "requestId": "req-123"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

### Whitelist-Specific Error Codes

| Code | Description |
|------|-------------|
| `INVALID_PHONE` | Phone number format invalid |
| `PHONE_ALREADY_WHITELISTED` | Phone already in whitelist |
| `WHITELIST_ENTRY_NOT_FOUND` | Whitelist entry doesn't exist |
| `ML_EVALUATION_FAILED` | ML evaluation service error |
| `IMPORT_FAILED` | File import operation failed |
| `EXPORT_FAILED` | File export operation failed |
| `LEARNING_FAILED` | Behavior learning update failed |

---

## Rate Limiting

The API implements rate limiting to ensure fair usage:

### Rate Limits

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| Standard API | 1000 requests | 1 hour |
| ML Evaluation | 500 requests | 1 hour |
| Import/Export | 10 operations | 1 hour |
| Bulk Operations | 100 requests | 1 hour |

### Rate Limit Headers

Rate limit information is included in response headers:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1638360000
X-RateLimit-Window: 3600
```

### Rate Limit Exceeded Response

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Please try again later.",
    "details": {
      "limit": 1000,
      "windowSeconds": 3600,
      "retryAfter": 300
    }
  }
}
```

---

## SDK and Examples

### JavaScript/Node.js Example

```javascript
const WhitelistAPI = require('@ai-answer-ninja/whitelist-sdk');

const client = new WhitelistAPI({
  baseURL: 'http://localhost:3006/api/v1',
  token: 'your-bearer-token'
});

// Evaluate a phone number
const evaluation = await client.evaluatePhone({
  phone: '+1234567890',
  userId: 'user-123',
  context: {
    callTime: new Date(),
    userLocation: 'home'
  }
});

console.log('Spam risk:', evaluation.riskLevel);
console.log('Recommendation:', evaluation.recommendation);

// Add to whitelist if safe
if (evaluation.riskLevel === 'low') {
  await client.smartAdd({
    userId: 'user-123',
    contactPhone: '+1234567890',
    contactName: 'Safe Caller',
    confidence: evaluation.confidenceScore
  });
}
```

### Python Example

```python
import requests
from whitelist_client import WhitelistClient

client = WhitelistClient(
    base_url='http://localhost:3006/api/v1',
    token='your-bearer-token'
)

# Batch evaluate multiple numbers
phones = ['+1234567890', '+1987654321', '+1555123456']
results = client.evaluate_batch([
    {'phone': phone, 'userId': 'user-123'} 
    for phone in phones
])

for result in results:
    print(f"Phone: {result['phone']}")
    print(f"Risk: {result['riskLevel']}")
    print(f"Recommendation: {result['recommendation']}")
    print("---")
```

### cURL Examples

```bash
# Evaluate phone number
curl -X POST http://localhost:3006/api/v1/whitelist/evaluate \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+1234567890",
    "userId": "user-123",
    "includeFeatures": true
  }'

# Import CSV file
curl -X POST http://localhost:3006/api/v1/whitelist/import \
  -H "Authorization: Bearer your-token" \
  -F "file=@whitelist.csv" \
  -F "userId=user-123" \
  -F "format=csv" \
  -F 'options={"allowDuplicates": false, "validateWithML": true}'

# Export whitelist
curl -X GET "http://localhost:3006/api/v1/whitelist/export/user-123?format=json" \
  -H "Authorization: Bearer your-token" \
  -o whitelist-export.json
```

---

## Changelog

### Version 1.0.0 (2023-12-01)

**Initial Release**

- Complete whitelist CRUD operations
- Advanced ML-based spam detection
- Behavioral learning and adaptation
- Import/Export functionality (CSV, JSON, Excel, vCard)
- Real-time risk evaluation
- User behavior analytics
- Comprehensive API documentation
- Rate limiting and error handling
- Health monitoring and metrics

**Features:**

- ✅ Smart whitelist management
- ✅ ML-powered spam detection
- ✅ Behavioral pattern learning
- ✅ Bulk import/export operations
- ✅ Real-time evaluation API
- ✅ User preference adaptation
- ✅ Performance analytics
- ✅ Comprehensive monitoring

---

## Support

For API support, documentation updates, or feature requests:

- **Email:** api-support@ai-answer-ninja.com
- **Documentation:** [https://docs.ai-answer-ninja.com/whitelist-api](https://docs.ai-answer-ninja.com/whitelist-api)
- **GitHub Issues:** [https://github.com/ai-answer-ninja/smart-whitelist/issues](https://github.com/ai-answer-ninja/smart-whitelist/issues)
- **Status Page:** [https://status.ai-answer-ninja.com](https://status.ai-answer-ninja.com)

---

*This documentation is automatically generated and updated. Last updated: 2023-12-01T10:00:00Z*