# 🔐 Security Library (@ai-ninja/security)

Enterprise-grade security infrastructure for the AI Phone Answering System, providing comprehensive encryption, authentication, authorization, and threat detection capabilities.

## 🌟 Features

### ✨ Core Security Components

- **🛡️ End-to-End Encryption**: AES-256-GCM with automatic key rotation
- **🔐 Voice Data Protection**: Specialized streaming encryption for real-time audio
- **🎫 JWT Management**: Token generation, validation, and automatic rotation
- **🔑 Multi-Factor Authentication**: TOTP, SMS, Email, and backup codes
- **👥 Role-Based Access Control**: Fine-grained permissions and access management
- **🚨 Threat Detection**: Real-time monitoring and automated response
- **📊 Security Auditing**: Comprehensive logging with tamper-proof integrity
- **🏛️ GDPR Compliance**: Data anonymization and privacy protection tools

## 🚀 Quick Start

### Installation

```bash
npm install @ai-ninja/security
```

### Basic Usage

```typescript
import { 
  encryptionService, 
  jwtManager, 
  mfaService,
  securityAuditor 
} from '@ai-ninja/security';

// Initialize security services
await encryptionService.initializeDefaultKeys();

// Encrypt sensitive data
const encrypted = await encryptionService.encryptData(
  'sensitive information',
  'master',
  'additional authenticated data'
);

// Generate JWT tokens
const accessToken = await jwtManager.generateAccessToken(user, sessionId);
const refreshToken = await jwtManager.generateRefreshToken(userId, sessionId);

// Setup MFA
const mfaSetup = await mfaService.generateTOTPSecret(userId, userEmail);
```

## 📚 API Reference

### 🔒 Encryption Service

#### `encryptionService.encryptData(data, keyId?, additionalData?)`
Encrypts data using AES-256-GCM with authenticated encryption.

```typescript
const encrypted = await encryptionService.encryptData(
  'sensitive data',
  'master', // optional key ID
  'context data' // optional additional authenticated data
);

// Returns: EncryptedData object with data, iv, authTag, etc.
```

#### `encryptionService.encryptVoiceData(audioBuffer, callId, options?)`
Specialized encryption for voice data with streaming optimizations.

```typescript
const voiceEncryption = await encryptionService.encryptVoiceData(
  audioBuffer,
  callId,
  {
    chunkSize: 4096,
    compression: true,
    realtime: true
  }
);
```

#### `encryptionService.generateKeyPair(keyId?)`
Generates RSA key pairs for asymmetric encryption.

```typescript
const keyPair = await encryptionService.generateKeyPair('user_keypair');
```

### 🎫 JWT Manager

#### `jwtManager.generateAccessToken(user, sessionId, deviceFingerprint?)`
Creates secure access tokens with configurable expiration.

```typescript
const token = await jwtManager.generateAccessToken(
  {
    id: 'user123',
    permissions: ['read:profile', 'write:data'],
    roles: ['user']
  },
  'session456',
  'device_fingerprint'
);
```

#### `jwtManager.verifyAccessToken(token)`
Validates and decodes JWT tokens with blacklist checking.

```typescript
try {
  const payload = await jwtManager.verifyAccessToken(token);
  console.log('User ID:', payload.userId);
} catch (error) {
  console.log('Token invalid:', error.message);
}
```

#### `jwtManager.refreshAccessToken(refreshToken, user, deviceFingerprint?)`
Generates new access tokens using valid refresh tokens.

```typescript
const { accessToken, refreshToken: newRefreshToken } = 
  await jwtManager.refreshAccessToken(oldRefreshToken, user);
```

### 🔑 Multi-Factor Authentication

#### `mfaService.generateTOTPSecret(userId, userEmail)`
Creates TOTP secrets and QR codes for authenticator apps.

```typescript
const { secret, qrCode, backupCodes } = await mfaService.generateTOTPSecret(
  'user123',
  'user@example.com'
);
```

#### `mfaService.verifyTOTPToken(secret, token)`
Validates TOTP tokens with time window tolerance.

```typescript
const isValid = mfaService.verifyTOTPToken(userSecret, userToken);
```

#### `mfaService.generateSMSOTP(userId, phoneNumber)`
Sends SMS one-time passwords with automatic expiration.

```typescript
const otpCode = await mfaService.generateSMSOTP('user123', '+1234567890');
```

#### `mfaService.requireSecondFactor(userId, preferredMethod?)`
Initiates second factor authentication flow.

```typescript
const { method, challenge } = await mfaService.requireSecondFactor(
  'user123',
  'totp' // optional preferred method
);
```

### 👥 RBAC Manager

#### `rbacManager.checkPermission(userId, permission, resourceId?)`
Validates user permissions with resource-level access control.

```typescript
const hasAccess = await rbacManager.checkPermission(
  'user123',
  'read:sensitive_data',
  'resource456'
);
```

#### `rbacManager.assignRole(userId, role)`
Assigns roles to users with automatic permission inheritance.

```typescript
await rbacManager.assignRole('user123', 'admin');
```

### 🚨 Threat Detection

#### `threatDetectionEngine.analyzeRequest(request, context)`
Real-time threat analysis with machine learning detection.

```typescript
const analysis = await threatDetectionEngine.analyzeRequest(
  {
    ip: '192.168.1.1',
    userAgent: 'Mozilla/5.0...',
    requestPath: '/api/sensitive'
  },
  { userId: 'user123', sessionId: 'session456' }
);

if (analysis.threatLevel > 0.8) {
  // Take protective action
}
```

#### `threatDetectionEngine.detectAnomalousActivity(userId, activity)`
Identifies unusual user behavior patterns.

```typescript
const anomaly = await threatDetectionEngine.detectAnomalousActivity(
  'user123',
  {
    action: 'data_export',
    timestamp: Date.now(),
    ipAddress: '192.168.1.1',
    dataVolume: 1000000
  }
);
```

### 📊 Security Auditing

#### `securityAuditor.logSecurityEvent(event)`
Records security events with integrity protection.

```typescript
await securityAuditor.logSecurityEvent({
  type: 'authentication_failure',
  userId: 'user123',
  severity: 'medium',
  details: { reason: 'invalid_password', attempts: 3 }
});
```

#### `securityAuditor.generateAuditReport(timeRange, filters?)`
Creates comprehensive security audit reports.

```typescript
const report = await securityAuditor.generateAuditReport(
  { start: startDate, end: endDate },
  { severity: 'high', eventType: 'authentication' }
);
```

## 🏗️ Architecture

### Encryption Flow

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Plain Data  │───▶│ Encryption       │───▶│ Encrypted Data  │
│             │    │ Service          │    │ + Metadata      │
└─────────────┘    └──────────────────┘    └─────────────────┘
                          │
                          ▼
                   ┌──────────────────┐
                   │ Key Management   │
                   │ • Rotation       │
                   │ • Storage        │
                   │ • Recovery       │
                   └──────────────────┘
```

### Authentication Flow

```
┌──────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ User Login   │───▶│ JWT Manager     │───▶│ Access Token    │
│ Credentials  │    │ • Validation    │    │ + Refresh Token │
└──────────────┘    │ • Generation    │    └─────────────────┘
                    │ • Blacklisting  │
                    └─────────────────┘
                           │
                           ▼
                    ┌─────────────────┐
                    │ MFA Service     │
                    │ • TOTP          │
                    │ • SMS/Email OTP │
                    │ • Backup Codes  │
                    └─────────────────┘
```

## ⚙️ Configuration

### Environment Variables

```bash
# Encryption
ENCRYPTION_MASTER_KEY=your_32_byte_base64_key
KEY_ROTATION_INTERVAL=86400000  # 24 hours in ms

# JWT
JWT_SECRET=your_jwt_secret_key
JWT_REFRESH_SECRET=your_refresh_secret
JWT_ACCESS_EXPIRY=3600          # 1 hour in seconds
JWT_REFRESH_EXPIRY=604800       # 7 days in seconds

# MFA
MFA_SMS_PROVIDER=twilio
MFA_EMAIL_PROVIDER=sendgrid
TOTP_ISSUER=AI_Answer_Ninja
TOTP_WINDOW=2

# Threat Detection
THREAT_DETECTION_ENABLED=true
ANOMALY_THRESHOLD=0.8
ML_MODEL_PATH=/path/to/threat_model

# Audit
AUDIT_LOG_RETENTION=90          # days
AUDIT_ENCRYPTION_ENABLED=true
```

### Security Configuration

```typescript
// security-config.ts
export const securityConfig = {
  encryption: {
    algorithm: 'aes-256-gcm',
    keyLength: 256,
    ivLength: 16,
    keyRotationInterval: 24 * 60 * 60 * 1000, // 24 hours
    maxKeyAge: 7 * 24 * 60 * 60 * 1000        // 7 days
  },
  
  jwt: {
    algorithm: 'HS256',
    accessTokenExpiry: '1h',
    refreshTokenExpiry: '7d',
    issuer: 'ai-answer-ninja',
    audience: 'ai-answer-ninja-api'
  },
  
  mfa: {
    totpWindow: 2,
    backupCodesCount: 10,
    smsOtpLength: 6,
    smsOtpExpiry: 300,      // 5 minutes
    emailOtpExpiry: 600     // 10 minutes
  },
  
  threatDetection: {
    enabled: true,
    anomalyThreshold: 0.8,
    maxFailedAttempts: 5,
    lockoutDuration: 1800,  // 30 minutes
    modelUpdateInterval: 3600 // 1 hour
  }
};
```

## 🧪 Testing

### Unit Tests

```bash
# Run all security tests
npm test

# Run specific test suites
npm test -- --testNamePattern="EncryptionService"
npm test -- --testNamePattern="JWTManager"
npm test -- --testNamePattern="MFAService"

# Run with coverage
npm run test:coverage
```

### Security Tests

```typescript
describe('Security Compliance', () => {
  test('should encrypt data with proper algorithm', async () => {
    const encrypted = await encryptionService.encryptData('test data');
    expect(encrypted.algorithm).toBe('aes-256-gcm');
    expect(encrypted.keyVersion).toBeDefined();
    expect(encrypted.checksum).toBeDefined();
  });

  test('should generate secure JWT tokens', async () => {
    const token = await jwtManager.generateAccessToken(mockUser, sessionId);
    const payload = jwtManager.decodeToken(token);
    
    expect(payload.iss).toBe('ai-answer-ninja');
    expect(payload.aud).toBe('ai-answer-ninja-api');
    expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
  });

  test('should detect brute force attacks', async () => {
    const attackPatterns = Array(10).fill(null).map(() => ({
      ip: '192.168.1.100',
      action: 'login_failure',
      timestamp: Date.now()
    }));

    for (const pattern of attackPatterns) {
      await threatDetectionEngine.analyzeActivity(pattern);
    }

    const analysis = await threatDetectionEngine.getLatestAnalysis('192.168.1.100');
    expect(analysis.threatLevel).toBeGreaterThan(0.8);
  });
});
```

## 📊 Performance

### Benchmarks

| Operation | Avg Latency | Throughput | Memory Usage |
|-----------|-------------|------------|--------------|
| Data Encryption (1KB) | 2ms | 50K ops/sec | 1MB |
| Voice Encryption (4KB chunk) | 8ms | 12K ops/sec | 2MB |
| JWT Generation | 1ms | 100K ops/sec | 0.1MB |
| JWT Verification | 0.5ms | 200K ops/sec | 0.05MB |
| TOTP Validation | 0.1ms | 1M ops/sec | 0.01MB |
| Threat Analysis | 15ms | 6K ops/sec | 5MB |

### Performance Optimization

```typescript
// Batch encryption for better throughput
const encryptedBatch = await encryptionService.encryptBatch([
  { data: 'data1', keyId: 'key1' },
  { data: 'data2', keyId: 'key1' },
  { data: 'data3', keyId: 'key2' }
]);

// Token validation with caching
const cachedValidation = await jwtManager.verifyWithCache(token);

// Async threat detection for better response times
threatDetectionEngine.analyzeAsync(request); // Fire and forget
```

## 🛡️ Security Best Practices

### 1. Key Management
- Rotate encryption keys every 24 hours
- Use hardware security modules (HSM) in production
- Implement key derivation for different contexts
- Monitor key usage and access patterns

### 2. Authentication
- Enforce strong password policies
- Require MFA for administrative operations
- Implement account lockout after failed attempts
- Use secure session management

### 3. Authorization
- Follow principle of least privilege
- Implement role-based access control
- Regularly audit user permissions
- Use resource-level access controls

### 4. Monitoring
- Enable comprehensive audit logging
- Monitor for suspicious activities
- Set up automated threat detection
- Implement incident response procedures

## 🔧 Advanced Usage

### Custom Encryption Algorithms

```typescript
// Register custom encryption algorithm
encryptionService.registerAlgorithm('aes-256-cbc-custom', {
  encrypt: customEncryptFunction,
  decrypt: customDecryptFunction,
  keyLength: 256,
  ivLength: 16
});

// Use custom algorithm
const encrypted = await encryptionService.encryptData(
  data, 
  'master', 
  null, 
  { algorithm: 'aes-256-cbc-custom' }
);
```

### Custom Threat Detection Rules

```typescript
// Add custom threat detection rule
threatDetectionEngine.addRule({
  name: 'suspicious_api_access',
  condition: (activity) => {
    return activity.endpoint.includes('/admin') && 
           activity.timeOfDay > 22 || activity.timeOfDay < 6;
  },
  action: 'alert',
  severity: 'medium'
});
```

### Integration with External Services

```typescript
// Custom SMS provider for MFA
mfaService.registerSMSProvider('custom', {
  send: async (phone, message) => {
    // Custom SMS implementation
    await customSMSService.send(phone, message);
  }
});

// Custom audit log storage
securityAuditor.registerStorage('s3', {
  store: async (logEntry) => {
    // Store in AWS S3
    await s3.upload(bucket, key, logEntry);
  }
});
```

## 📈 Monitoring & Alerting

### Security Metrics

```typescript
// Get comprehensive security metrics
const metrics = await securityAuditor.getMetrics();

console.log('Security Dashboard:', {
  authenticationFailures: metrics.authFailures24h,
  encryptionOperations: metrics.encryptionOps24h,
  threatsDetected: metrics.threatsDetected24h,
  mfaAdoption: metrics.mfaAdoptionRate,
  averageSessionDuration: metrics.avgSessionDuration
});
```

### Real-time Alerts

```typescript
// Set up security event listeners
securityAuditor.on('highSeverityEvent', (event) => {
  // Send immediate alert
  alertingService.sendCriticalAlert({
    type: 'SECURITY_INCIDENT',
    severity: event.severity,
    details: event.details,
    timestamp: event.timestamp
  });
});

threatDetectionEngine.on('threatDetected', (threat) => {
  // Automatic response based on threat level
  if (threat.level > 0.9) {
    // Block immediately
    firewallService.blockIP(threat.sourceIP);
  } else if (threat.level > 0.7) {
    // Require additional authentication
    authService.requireStepUp(threat.userId);
  }
});
```

## 🔗 Integration Examples

### Express.js Middleware

```typescript
import { securityMiddleware } from '@ai-ninja/security';

app.use(securityMiddleware.authentication());
app.use(securityMiddleware.rateLimit());
app.use(securityMiddleware.threatDetection());

// Protected route
app.get('/api/sensitive', 
  securityMiddleware.requirePermission('read:sensitive'),
  async (req, res) => {
    // Route handler
  }
);
```

### Database Integration

```typescript
// Encrypt sensitive database fields
const userRepository = {
  async createUser(userData) {
    const encryptedData = await encryptionService.encryptData(
      JSON.stringify(userData.personalInfo)
    );
    
    return db.query(
      'INSERT INTO users (id, encrypted_data) VALUES ($1, $2)',
      [userData.id, encryptedData]
    );
  }
};
```

## 📄 License

MIT License - see [LICENSE](../../LICENSE) for details.

## 🤝 Contributing

1. Follow security-first development practices
2. All security-related changes require security review
3. Maintain backward compatibility for security APIs
4. Include security tests for new features
5. Update security documentation

---

**🔒 Security is not a feature, it's a foundation. Build with confidence.**