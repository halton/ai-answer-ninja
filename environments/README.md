# Environment Configuration Management

## Overview

This directory contains environment-specific configurations for the AI Phone Answering System. The system supports multiple deployment environments with tailored configurations for security, performance, and operational requirements.

## Environment Structure

```
environments/
├── development/          # Local development environment
│   ├── config.yaml      # Environment configuration
│   ├── secrets/         # Development secrets (safe to commit)
│   │   ├── database.env
│   │   ├── api-keys.env
│   │   └── jwt-secrets.env
│   └── k8s/            # Kubernetes ConfigMaps/Secrets
│       └── configmaps.yaml
├── staging/             # Pre-production testing environment
│   ├── config.yaml     # Staging configuration
│   ├── secrets/        # Secret templates (DO NOT commit actual secrets)
│   │   ├── database.env.template
│   │   ├── api-keys.env.template
│   │   └── jwt-secrets.env.template
│   └── k8s/           # Staging Kubernetes configs
│       └── configmaps.yaml
└── production/         # Production environment
    ├── config.yaml    # Production configuration
    ├── secrets/       # Secret templates (DO NOT commit actual secrets)
    │   ├── database.env.template
    │   ├── api-keys.env.template
    │   └── jwt-secrets.env.template
    └── k8s/          # Production Kubernetes configs
        └── configmaps.yaml
```

## Supported Environments

### Development Environment
- **Purpose**: Local development and testing
- **Infrastructure**: Docker Compose
- **Security**: Relaxed settings for ease of development
- **Performance**: Optimized for development workflow
- **Secrets**: Safe development values (can be committed)

**Key Features**:
- Mock external services (Azure Speech, OpenAI)
- Relaxed CORS policies
- Disabled rate limiting and MFA
- Debug logging enabled
- Hot reload and development tools

### Staging Environment  
- **Purpose**: Pre-production testing and validation
- **Infrastructure**: Kubernetes cluster
- **Security**: Production-like security policies
- **Performance**: Production-like performance settings
- **Secrets**: Template files (actual secrets stored securely)

**Key Features**:
- Full integration testing enabled
- Load testing capabilities
- Production-like monitoring stack
- SSL/TLS termination
- Automated deployment pipelines

### Production Environment
- **Purpose**: Live production system
- **Infrastructure**: High-availability Kubernetes cluster
- **Security**: Maximum security configuration
- **Performance**: Optimized for scale and performance
- **Secrets**: Secure external secret management

**Key Features**:
- Comprehensive monitoring and alerting
- Multi-AZ deployment with disaster recovery
- Strict security policies and compliance
- Performance optimization and caching
- Business continuity planning

## Configuration Management

### Configuration Hierarchy

1. **Base Configuration**: Common settings across all environments
2. **Environment-Specific**: Environment overrides in `config.yaml`
3. **Runtime Overrides**: Environment variables and command-line flags
4. **Kubernetes ConfigMaps**: Cluster-specific configurations

### Secret Management Strategy

#### Development
- Secrets stored in plain text files
- Safe placeholder values
- Can be committed to version control

#### Staging/Production
- Secret templates with placeholder values
- Actual secrets managed externally:
  - Azure Key Vault
  - Kubernetes Secrets
  - CI/CD pipeline variables
  - External secret operators

### Environment Variables Priority

1. Command-line arguments (highest priority)
2. Environment variables
3. Kubernetes ConfigMaps/Secrets
4. Environment config files
5. Default values (lowest priority)

## Usage

### Quick Start

```bash
# Deploy to development environment
./scripts/deploy-environment.sh --environment development --action deploy

# Deploy to staging with build
./scripts/deploy-environment.sh --environment staging --action deploy --parallel-builds

# Deploy to production with confirmation
./scripts/deploy-environment.sh --environment production --action deploy

# Rollback production deployment
./scripts/deploy-environment.sh --environment production --action rollback --force
```

### Environment-Specific Commands

#### Development
```bash
# Start development environment
./scripts/deploy-environment.sh --env development --action deploy

# Run tests only
./scripts/deploy-environment.sh --env development --action test

# Check status
./scripts/deploy-environment.sh --env development --action status
```

#### Staging
```bash
# Deploy with integration tests
./scripts/deploy-environment.sh --env staging --action deploy

# Build and push images only
./scripts/deploy-environment.sh --env staging --action build

# Dry run deployment
./scripts/deploy-environment.sh --env staging --action deploy --dry-run
```

#### Production
```bash
# Production deployment (requires confirmation)
./scripts/deploy-environment.sh --env production --action deploy

# Production deployment with force flag
./scripts/deploy-environment.sh --env production --action deploy --force

# Check production status
./scripts/deploy-environment.sh --env production --action status
```

## Configuration Details

### Key Configuration Categories

#### Database Configuration
```yaml
# Development
DB_HOST: postgres-dev
DB_SSL: false
DB_MAX_CONNECTIONS: 10

# Staging
DB_HOST: postgresql-staging.internal
DB_SSL: true
DB_MAX_CONNECTIONS: 15

# Production
DB_HOST: postgresql-production.internal
DB_SSL: true
DB_SSL_REQUIRE: true
DB_MAX_CONNECTIONS: 25
DB_READ_REPLICA_ENABLED: true
```

#### Performance Settings
```yaml
# Development
MAX_CONCURRENT_CALLS: 100
PROCESSING_PIPELINE_TIMEOUT: 3000
WEBSOCKET_TIMEOUT: 600000

# Staging
MAX_CONCURRENT_CALLS: 500
PROCESSING_PIPELINE_TIMEOUT: 1500
WEBSOCKET_TIMEOUT: 300000

# Production
MAX_CONCURRENT_CALLS: 2000
PROCESSING_PIPELINE_TIMEOUT: 800
WEBSOCKET_TIMEOUT: 180000
```

#### Security Features
```yaml
# Development
FEATURE_MFA_REQUIRED: false
FEATURE_RATE_LIMITING_ENABLED: false
FEATURE_SECURITY_HEADERS_ENABLED: false

# Staging
FEATURE_MFA_REQUIRED: false
FEATURE_RATE_LIMITING_ENABLED: true
FEATURE_SECURITY_HEADERS_ENABLED: true

# Production
FEATURE_MFA_REQUIRED: true
FEATURE_RATE_LIMITING_ENABLED: true
FEATURE_SECURITY_HEADERS_ENABLED: true
```

### Scaling Configuration

#### Horizontal Pod Autoscaling
```yaml
# Development: Single replica
MIN_REPLICAS: 1
MAX_REPLICAS: 3

# Staging: Small scale
MIN_REPLICAS: 2
MAX_REPLICAS: 10

# Production: Production scale
MIN_REPLICAS_CRITICAL: 5
MIN_REPLICAS_STANDARD: 3
MAX_REPLICAS_CRITICAL: 25
MAX_REPLICAS_STANDARD: 15
```

## Secret Management

### Development Secrets (Safe)
Located in `environments/development/secrets/`:
- `database.env`: Development database credentials
- `api-keys.env`: Mock API keys for development
- `jwt-secrets.env`: Development JWT secrets

### Staging/Production Secrets (Secure)
Located in `environments/{staging,production}/secrets/*.template`:
- Template files with placeholder values
- Actual secrets stored in secure external systems
- Never committed to version control

### Secret Template Usage

1. **Copy template files**:
```bash
# For staging
cp environments/staging/secrets/database.env.template environments/staging/secrets/database.env

# For production
cp environments/production/secrets/database.env.template environments/production/secrets/database.env
```

2. **Replace placeholder values**:
```bash
# Generate secure keys
openssl rand -base64 64  # For JWT secrets
openssl rand -base64 32  # For encryption keys

# Update files with actual values
sed -i 's/REPLACE_WITH_STAGING_PASSWORD/actual_password/g' environments/staging/secrets/database.env
```

3. **Apply to Kubernetes**:
```bash
kubectl create secret generic ai-ninja-secrets \
  --from-env-file=environments/staging/secrets/database.env \
  --from-env-file=environments/staging/secrets/api-keys.env \
  --from-env-file=environments/staging/secrets/jwt-secrets.env \
  --namespace=ai-ninja-staging
```

### External Secret Management

For production environments, integrate with external secret management:

#### Azure Key Vault Integration
```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: azure-keyvault
spec:
  provider:
    azurekv:
      vaultUrl: "https://ai-ninja-keyvault.vault.azure.net/"
      authSecretRef:
        clientId:
          name: azure-secret-creds
          key: ClientID
        clientSecret:
          name: azure-secret-creds
          key: ClientSecret
```

#### Kubernetes External Secrets
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: ai-ninja-external-secrets
spec:
  refreshInterval: 300s
  secretStoreRef:
    name: azure-keyvault
    kind: SecretStore
  target:
    name: ai-ninja-secrets
    creationPolicy: Owner
  data:
  - secretKey: AZURE_SPEECH_KEY
    remoteRef:
      key: azure-speech-api-key
  - secretKey: AZURE_OPENAI_KEY
    remoteRef:
      key: azure-openai-api-key
```

## Environment-Specific Features

### Development Environment Features
- **Mock Services**: Azure services mocked locally
- **Hot Reload**: Automatic code reloading
- **Debug Tools**: Enhanced debugging capabilities
- **Test Endpoints**: Additional API endpoints for testing
- **Relaxed Security**: Easier development workflow

### Staging Environment Features
- **Integration Testing**: Full end-to-end testing
- **Load Testing**: Performance validation
- **Security Testing**: Vulnerability scanning
- **Monitoring Stack**: Full Prometheus/Grafana setup
- **SSL Certificates**: Let's Encrypt staging certificates

### Production Environment Features
- **High Availability**: Multi-zone deployment
- **Disaster Recovery**: Backup and recovery procedures
- **Compliance**: GDPR and audit logging
- **Performance Optimization**: Caching and CDN
- **Security Hardening**: Maximum security configuration

## Monitoring and Observability

### Development
- Basic health checks
- Console logging
- Optional metrics collection

### Staging
- Full monitoring stack (Prometheus, Grafana, Jaeger)
- Integration with CI/CD pipelines
- Performance benchmarking
- Security scanning

### Production
- Comprehensive monitoring and alerting
- Business metrics and SLA tracking
- Incident response integration
- Compliance monitoring and audit trails

## Troubleshooting

### Common Issues

#### Configuration Not Loading
```bash
# Check environment variables
./scripts/deploy-environment.sh --env development --action status

# Verify configuration files
cat environments/development/config.yaml

# Check Kubernetes ConfigMaps
kubectl get configmaps -n ai-ninja-dev
kubectl describe configmap ai-ninja-dev-config -n ai-ninja-dev
```

#### Secrets Not Available
```bash
# Check secret templates
ls -la environments/staging/secrets/

# Verify Kubernetes secrets
kubectl get secrets -n ai-ninja-staging
kubectl describe secret ai-ninja-secrets -n ai-ninja-staging

# Check external secret operator
kubectl get externalsecrets -n ai-ninja-staging
```

#### Environment Mismatch
```bash
# Check current context
kubectl config current-context

# Verify environment configuration
export ENVIRONMENT=staging
./scripts/deploy-environment.sh --env staging --action status

# Check service endpoints
kubectl get endpoints -n ai-ninja-staging
```

### Best Practices

1. **Always use dry-run first** for staging and production deployments
2. **Verify secrets** before deploying to new environments
3. **Test configuration changes** in development first
4. **Monitor deployments** during and after deployment
5. **Have rollback plan ready** for production deployments

### Emergency Procedures

#### Rollback Environment
```bash
# Immediate rollback
./scripts/deploy-environment.sh --env production --action rollback --force

# Check rollback status
./scripts/deploy-environment.sh --env production --action status
```

#### Emergency Configuration Update
```bash
# Update ConfigMap directly
kubectl patch configmap ai-ninja-production-config \
  -n ai-ninja \
  --patch '{"data":{"EMERGENCY_MODE":"true"}}'

# Restart affected services
kubectl rollout restart deployment/realtime-processor -n ai-ninja
```

## Security Considerations

### Development
- Use mock credentials only
- Never use production keys in development
- Local network access only

### Staging
- Use separate Azure subscriptions/resources
- Implement basic access controls
- Regular security testing

### Production  
- Zero-trust security model
- Multi-factor authentication required
- Regular security audits and compliance checks
- Encrypted secrets and communications
- Network policies and service mesh

## Contributing

When adding new environment configurations:

1. Update all three environments (development, staging, production)
2. Add appropriate security levels for each environment
3. Update ConfigMap templates
4. Document new configuration options
5. Test deployment in development first
6. Update this README with new features

## License

This environment configuration system is part of the AI Phone Answering System project. See the main project LICENSE file for terms and conditions.