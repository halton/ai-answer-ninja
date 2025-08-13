# AI Answer Ninja - User Management Service

Enterprise-grade user management and authentication service for the AI Answer Ninja system. This service provides comprehensive user authentication, authorization, profile management, and security monitoring capabilities.

## Features

### 🔐 Authentication & Security
- **JWT Authentication** with secure token management
- **Multi-Factor Authentication (TOTP)** with backup codes
- **Role-Based Access Control (RBAC)** with granular permissions
- **Real-time Security Monitoring** with threat detection
- **Advanced Rate Limiting** and DDoS protection
- **Brute Force Protection** with intelligent lockout
- **Session Management** with device tracking

### 👤 User Management
- **User Registration** with email verification
- **Profile Management** with preference settings
- **Password Management** with secure reset flows
- **Account Security** with audit logging
- **GDPR Compliance** with data export/deletion

### 📊 Monitoring & Analytics
- **Security Event Monitoring** with real-time alerts
- **Audit Logging** for compliance requirements
- **Performance Metrics** with health monitoring
- **Anomaly Detection** with automated response

## Architecture

### Technology Stack
- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js with comprehensive middleware
- **Database**: PostgreSQL with Prisma ORM
- **Cache**: Redis for session management and rate limiting
- **Authentication**: JWT with asymmetric signing
- **Validation**: express-validator with custom sanitization
- **Security**: Helmet, bcrypt/argon2, rate limiting

### Project Structure
```
src/
├── config/           # Application configuration
├── controllers/      # HTTP request handlers (to be implemented)
├── middleware/       # Express middleware components
│   ├── auth.ts      # Authentication middleware
│   ├── error.ts     # Error handling middleware
│   ├── security.ts  # Security middleware
│   └── validation.ts # Input validation middleware
├── models/          # Data models (Prisma-based)
├── routes/          # API route definitions (to be implemented)
├── services/        # Business logic services
│   ├── auth.ts      # Authentication service
│   ├── audit.ts     # Audit logging service
│   ├── database.ts  # Database service wrapper
│   ├── email.ts     # Email service
│   ├── mfa.ts       # Multi-factor authentication
│   ├── rbac.ts      # Role-based access control
│   ├── redis.ts     # Redis service wrapper
│   └── userProfile.ts # User profile management
├── types/           # TypeScript type definitions
├── utils/           # Utility functions and helpers
│   └── logger.ts    # Structured logging
└── server.ts        # Main application entry point
```

## Quick Start

### Prerequisites
- Node.js 18 or higher
- PostgreSQL 14 or higher
- Redis 6 or higher
- npm or yarn package manager

### Installation

1. **Clone and navigate to the service**:
```bash
cd services/user-management
```

2. **Install dependencies**:
```bash
npm install
```

3. **Setup environment variables**:
```bash
cp .env.example .env
# Edit .env with your configuration values
```

4. **Setup database**:
```bash
# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# (Optional) Seed development data
npm run db:push
```

5. **Start the service**:
```bash
# Development mode
npm run dev

# Production build
npm run build
npm start
```

### Docker Deployment

**Development**:
```bash
docker build --target development -t user-management:dev .
docker run -p 3005:3005 --env-file .env user-management:dev
```

**Production**:
```bash
docker build --target production -t user-management:prod .
docker run -p 3005:3005 --env-file .env user-management:prod
```

## Configuration

### Environment Variables

Key configuration options (see `.env.example` for complete list):

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Application environment | `development` |
| `PORT` | HTTP server port | `3005` |
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `REDIS_URL` | Redis connection string | Required |
| `JWT_ACCESS_SECRET` | JWT signing secret for access tokens | Required |
| `JWT_REFRESH_SECRET` | JWT signing secret for refresh tokens | Required |
| `EMAIL_HOST` | SMTP server hostname | Required |
| `MAX_LOGIN_ATTEMPTS` | Maximum failed login attempts | `5` |
| `PASSWORD_MIN_LENGTH` | Minimum password length | `8` |

### Security Configuration

The service includes comprehensive security configurations:

- **Rate Limiting**: 100 requests/15min per IP, 10 auth attempts/15min
- **Session Management**: 1-hour sessions with sliding expiration
- **Password Policy**: Minimum 8 chars with uppercase, lowercase, numbers
- **MFA Support**: TOTP with 30-second windows and backup codes
- **Audit Logging**: All security events with severity classification

## API Documentation

### Authentication Endpoints

```
POST /api/auth/login          # User login
POST /api/auth/logout         # User logout
POST /api/auth/register       # User registration
POST /api/auth/refresh        # Refresh access token
POST /api/auth/password-reset # Request password reset
PUT  /api/auth/password       # Change password
```

### User Management Endpoints

```
GET    /api/users/profile     # Get user profile
PUT    /api/users/profile     # Update user profile
DELETE /api/users/profile     # Delete user account
GET    /api/users/preferences # Get user preferences
PUT    /api/users/preferences # Update user preferences
GET    /api/users/sessions    # List user sessions
DELETE /api/users/sessions/:id # Revoke session
```

### MFA Endpoints

```
POST /api/mfa/setup          # Setup TOTP MFA
POST /api/mfa/verify         # Verify MFA token
POST /api/mfa/disable        # Disable MFA
POST /api/mfa/backup-codes   # Generate backup codes
```

### Admin Endpoints

```
GET  /api/admin/users        # List users (admin only)
PUT  /api/admin/users/:id/role # Change user role
GET  /api/admin/audit        # View audit logs
GET  /api/admin/security     # Security events
```

### Health & Monitoring

```
GET /health                  # Basic health check
GET /health/deep            # Comprehensive health check
```

## Security Features

### Authentication Security
- **Secure Password Hashing**: Argon2id with fallback to bcrypt
- **JWT Security**: Short-lived access tokens (15min) and longer refresh tokens (7d)
- **Session Management**: Device tracking with suspicious activity detection
- **MFA Support**: TOTP-based with encrypted backup codes

### Input Validation & Sanitization
- **Request Validation**: Comprehensive validation using express-validator
- **SQL Injection Prevention**: Parameterized queries via Prisma ORM
- **NoSQL Injection Prevention**: Object sanitization middleware
- **XSS Prevention**: Input sanitization and CSP headers

### Rate Limiting & DDoS Protection
- **Distributed Rate Limiting**: Redis-based with sliding windows
- **Brute Force Protection**: Progressive lockouts with IP blocking
- **Request Size Limits**: Body size limits with proper error handling
- **Connection Limits**: Connection pooling and timeout management

### Monitoring & Alerting
- **Audit Logging**: All security events with structured logging
- **Security Events**: Automated detection of suspicious activities
- **Performance Monitoring**: Database and Redis health checks
- **Error Tracking**: Comprehensive error logging with stack traces

## Development

### Available Scripts

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build for production
npm run start        # Start production server
npm run test         # Run test suite
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint errors
npm run db:migrate   # Run database migrations
npm run db:generate  # Generate Prisma client
npm run db:studio    # Open Prisma Studio
```

### Database Management

**Migrations**:
```bash
# Create new migration
npx prisma migrate dev --name migration_name

# Apply migrations
npx prisma migrate deploy

# Reset database
npx prisma migrate reset
```

**Development**:
```bash
# Push schema changes without migration
npx prisma db push

# View data in Prisma Studio
npx prisma studio
```

### Testing

The service includes comprehensive testing setup:

```bash
# Run all tests
npm test

# Run specific test file
npm test auth.test.ts

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## Deployment

### Production Deployment

1. **Build the application**:
```bash
npm run build
```

2. **Set production environment variables**:
```bash
export NODE_ENV=production
export DATABASE_URL="your-production-db-url"
export REDIS_URL="your-production-redis-url"
# Set other required variables
```

3. **Run database migrations**:
```bash
npx prisma migrate deploy
```

4. **Start the service**:
```bash
npm start
```

### Docker Deployment

**Using Docker Compose** (recommended):
```bash
docker-compose up -d
```

**Manual Docker**:
```bash
# Build image
docker build -t user-management .

# Run container
docker run -d \
  --name user-management \
  -p 3005:3005 \
  --env-file .env \
  user-management
```

### Health Monitoring

The service provides health check endpoints for monitoring:

- **Basic Health**: `GET /health` - Simple uptime check
- **Deep Health**: `GET /health/deep` - Comprehensive dependency checks

Example monitoring setup with curl:
```bash
# Basic health check
curl http://localhost:3005/health

# Deep health check with dependencies
curl http://localhost:3005/health/deep
```

## Contributing

### Code Style
- **TypeScript**: Strict mode enabled with comprehensive type checking
- **ESLint**: Standard configuration with custom rules
- **Prettier**: Code formatting with consistent style
- **Naming**: camelCase for variables, PascalCase for classes

### Security Guidelines
- **Input Validation**: All user inputs must be validated and sanitized
- **Error Handling**: Never expose internal errors to clients
- **Logging**: Log security events but avoid logging sensitive data
- **Dependencies**: Regular security audits with `npm audit`

### Testing Requirements
- **Unit Tests**: All services and utilities require unit tests
- **Integration Tests**: API endpoints require integration tests
- **Security Tests**: Authentication and authorization flows must be tested
- **Coverage**: Minimum 80% code coverage required

## License

This project is proprietary software developed for AI Answer Ninja. All rights reserved.

## Support

For support and questions:
- **Documentation**: Internal wiki and API documentation
- **Issues**: Report bugs through internal issue tracking
- **Development**: Contact the development team for technical questions