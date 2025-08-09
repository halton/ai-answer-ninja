# AI Phone Answering System - Production Kubernetes Deployment

## Overview

This directory contains production-ready Kubernetes configurations for deploying the AI Phone Answering System. The deployment includes comprehensive security policies, monitoring, autoscaling, and high availability configurations.

## Architecture

### Components Deployed

1. **Core Services** (6 microservices)
   - User Management Service (Port 3005)
   - Smart Whitelist Service (Port 3006)
   - Realtime Processor Service (Port 3002)
   - Conversation Engine Service (Port 3003)
   - Profile Analytics Service (Port 3004)
   - Conversation Analyzer Service (Port 3007)

2. **Infrastructure Components**
   - PostgreSQL Database with HA configuration
   - Redis Cache with persistence
   - NGINX Ingress Controller with SSL termination
   - Prometheus + Grafana monitoring stack
   - Jaeger distributed tracing

3. **Security & Compliance**
   - Network policies with default deny-all
   - Pod Security Standards enforcement
   - RBAC with principle of least privilege
   - TLS encryption for all communications
   - Secret management with external integrations

## Prerequisites

### Required Kubernetes Features
- Kubernetes 1.21+ cluster
- StorageClasses for persistent volumes (fast-ssd, standard-ssd, bulk-storage)
- NGINX Ingress Controller
- cert-manager for SSL certificate management
- Metrics Server for autoscaling
- CNI with NetworkPolicy support

### Required CLI Tools
- kubectl
- helm (optional, for cert-manager setup)

### External Dependencies
- Azure KeyVault (for secret management)
- DNS provider supporting automatic records
- SSL certificate provider (Let's Encrypt configured)

## Configuration Files

| File | Description |
|------|-------------|
| `namespace.yaml` | Namespace and resource quotas |
| `core-services.yaml` | Main application deployments |
| `services.yaml` | Service definitions and load balancers |
| `storage.yaml` | Storage classes and persistent volumes |
| `autoscaling.yaml` | HPA, VPA, and Pod Disruption Budgets |
| `ingress.yaml` | Ingress controllers and SSL configuration |
| `monitoring.yaml` | Prometheus, Grafana, and Jaeger setup |
| `config-security.yaml` | ConfigMaps, Secrets, RBAC, and Network Policies |
| `deploy.sh` | Automated deployment script |

## Quick Start

### 1. Environment Setup

```bash
# Set your Kubernetes context
kubectl config use-context production-cluster

# Verify cluster access
kubectl cluster-info

# Check required components
kubectl get storageclass
kubectl get namespace ingress-nginx
```

### 2. Configuration

Update the following files with your environment-specific values:

**config-security.yaml:**
```yaml
# Update database connection details
DB_HOST: "your-postgresql-host"
DB_NAME: "your-database-name"

# Update Azure service endpoints
AZURE_SPEECH_REGION: "your-region"
AZURE_OPENAI_ENDPOINT: "your-openai-endpoint"
```

**ingress.yaml:**
```yaml
# Update domain names
spec:
  tls:
  - hosts:
    - api.your-domain.com
    - ws.your-domain.com
```

### 3. Deploy

```bash
# Full deployment
./deploy.sh

# Dry run to validate
./deploy.sh --dry-run

# Deploy specific component
./deploy.sh --component core

# Deploy with custom context
./deploy.sh --context staging
```

## Deployment Components

### Core Services Configuration

Each microservice is configured with:
- **Resource Limits**: CPU and memory limits per service requirements
- **Health Checks**: Liveness and readiness probes
- **Security Context**: Non-root user, read-only filesystem
- **Anti-Affinity**: Pod distribution across nodes
- **Service Mesh Ready**: Istio sidecar injection enabled

### Storage Configuration

Three storage tiers are configured:
- **fast-ssd**: High-performance SSD for databases and caching
- **standard-ssd**: Standard SSD for application data
- **bulk-storage**: Cost-effective storage for logs and backups

### Autoscaling Configuration

Comprehensive autoscaling setup:
- **HPA**: CPU, memory, and custom metrics-based scaling
- **VPA**: Automatic resource recommendation and adjustment
- **PDB**: Ensures minimum availability during updates

### Network Security

Multi-layered network security:
- **Default Deny**: All traffic blocked by default
- **Service-to-Service**: Explicit allow rules for required communication
- **Database Access**: Restricted to core services only
- **External Access**: HTTPS/WSS through ingress only

## Monitoring and Observability

### Prometheus Metrics

Key metrics collected:
- Application performance (latency, throughput, errors)
- Resource utilization (CPU, memory, storage)
- Business metrics (call volume, AI response quality)
- Security metrics (failed logins, suspicious activity)

### Grafana Dashboards

Pre-configured dashboards:
- System Overview: High-level health and performance
- Service Performance: Individual service metrics  
- Infrastructure: Node and cluster health
- Business Metrics: Call analytics and AI performance

### Alerting Rules

Critical alerts configured:
- High response latency (>800ms P95)
- High error rate (>5%)
- Resource exhaustion (>90% memory/CPU)
- AI response quality degradation (<0.7 score)

### Distributed Tracing

Jaeger tracing for:
- Cross-service request tracking
- Performance bottleneck identification
- Error propagation analysis
- Service dependency mapping

## Security Considerations

### Network Security
- All inter-service communication encrypted with mTLS
- Network policies enforce zero-trust networking
- External access only through authenticated ingress
- Database and cache access restricted to application services

### Authentication & Authorization
- JWT-based authentication with refresh tokens
- Role-based access control (RBAC) at Kubernetes and application levels
- Multi-factor authentication support
- Session management with device fingerprinting

### Data Protection
- Secrets encrypted at rest using Kubernetes secrets
- External secret management integration (Azure KeyVault)
- Data encryption in transit and at rest
- Audit logging for all sensitive operations

### Compliance Features
- GDPR compliance with data retention policies
- Audit trail for all data access and modifications
- Data anonymization for analytics
- Right to be forgotten implementation

## Performance Characteristics

### Latency Targets
- **MVP Phase**: < 1500ms end-to-end processing
- **Optimization Phase**: < 1000ms end-to-end processing  
- **Production Phase**: < 800ms end-to-end processing

### Scalability
- **Minimum Configuration**: 3-5 replicas per service
- **Auto-scaling**: Up to 20 replicas for critical services
- **Resource Allocation**: CPU and memory limits based on profiling
- **Load Balancing**: Round-robin with session affinity for WebSocket

## Operational Procedures

### Deployment

```bash
# Standard deployment
./deploy.sh

# Rolling update of specific service
kubectl set image deployment/realtime-processor realtime-processor=new-image:tag -n ai-ninja

# Rollback deployment
kubectl rollout undo deployment/realtime-processor -n ai-ninja
```

### Scaling

```bash
# Manual scaling
kubectl scale deployment realtime-processor --replicas=10 -n ai-ninja

# Check HPA status
kubectl get hpa -n ai-ninja

# Update HPA configuration
kubectl patch hpa realtime-processor-hpa -p '{"spec":{"maxReplicas":30}}' -n ai-ninja
```

### Monitoring

```bash
# Check cluster status
kubectl get all -n ai-ninja

# View logs
kubectl logs -f deployment/realtime-processor -n ai-ninja

# Check metrics
kubectl top pods -n ai-ninja
kubectl top nodes
```

### Troubleshooting

```bash
# Check pod status
kubectl describe pod <pod-name> -n ai-ninja

# Check service endpoints
kubectl get endpoints -n ai-ninja

# Check ingress
kubectl describe ingress ai-ninja-ingress -n ai-ninja

# Check certificates
kubectl get certificates -n ai-ninja

# Check network policies
kubectl get networkpolicy -n ai-ninja
```

### Backup and Recovery

```bash
# Backup persistent data
kubectl get pvc -n ai-ninja
# Use your storage provider's backup solution

# Export configurations
kubectl get all -n ai-ninja -o yaml > backup.yaml

# Disaster recovery
./deploy.sh --rollback  # Remove everything
./deploy.sh            # Redeploy from configurations
# Restore data from backups
```

## Environment Variables

### Required Secrets
Create these secrets before deployment:

```yaml
# ai-ninja-secrets
DB_USERNAME: <base64-encoded-username>
DB_PASSWORD: <base64-encoded-password>
JWT_ACCESS_SECRET: <base64-encoded-jwt-secret>
AZURE_SPEECH_KEY: <base64-encoded-speech-key>
AZURE_OPENAI_KEY: <base64-encoded-openai-key>
```

### Configuration Values
Update these in ConfigMaps:

```yaml
# Performance settings
MAX_CONCURRENT_CALLS: "1000"
WEBSOCKET_TIMEOUT: "300000"
PROCESSING_PIPELINE_TIMEOUT: "1500"

# Feature flags
FEATURE_MFA_REQUIRED: "true"
FEATURE_RATE_LIMITING_ENABLED: "true"
FEATURE_AUDIT_LOGGING_ENABLED: "true"
```

## Cost Optimization

### Resource Requests vs Limits
- Requests set to 70% of typical usage
- Limits set to 150% of typical usage
- Burstable QoS class for cost efficiency

### Storage Optimization
- Appropriate storage classes for different data types
- Automated cleanup of old logs and temporary data
- Compression enabled for bulk storage

### Compute Optimization
- Node affinity to prefer cost-effective instance types
- Horizontal pod autoscaling to match demand
- Vertical pod autoscaling to optimize resource allocation

## High Availability

### Multi-Zone Deployment
- Services distributed across availability zones
- Anti-affinity rules prevent single points of failure
- Load balancing across multiple replicas

### Data Persistence
- Database replication with automatic failover
- Redis persistence with AOF and RDB snapshots
- Regular backups to remote storage

### Service Resilience
- Circuit breakers for external API calls
- Retry logic with exponential backoff
- Graceful degradation for non-critical features

## Maintenance

### Regular Tasks
- Certificate renewal (automated via cert-manager)
- Log rotation and cleanup
- Security patch updates
- Performance metric review

### Update Procedures
1. Test changes in staging environment
2. Deploy during maintenance window
3. Monitor key metrics post-deployment
4. Have rollback plan ready
5. Document changes and lessons learned

## Support and Troubleshooting

### Common Issues

**Pods Not Starting**
```bash
kubectl describe pod <pod-name> -n ai-ninja
kubectl logs <pod-name> -n ai-ninja
```

**Services Not Accessible**
```bash
kubectl get endpoints -n ai-ninja
kubectl describe service <service-name> -n ai-ninja
```

**SSL Certificate Issues**
```bash
kubectl describe certificate -n ai-ninja
kubectl describe certificaterequest -n ai-ninja
```

**High Latency**
```bash
# Check HPA status
kubectl get hpa -n ai-ninja

# Check resource usage
kubectl top pods -n ai-ninja

# Check Prometheus metrics
curl http://prometheus-url/api/v1/query?query=histogram_quantile(0.95,rate(http_request_duration_seconds_bucket[5m]))
```

### Emergency Procedures

**Service Outage**
1. Check service status: `kubectl get pods -n ai-ninja`
2. Review recent changes: `kubectl rollout history deployment/<service>`
3. Rollback if needed: `kubectl rollout undo deployment/<service>`
4. Scale up if capacity issue: `kubectl scale deployment <service> --replicas=<number>`

**Database Issues**
1. Check database pod status
2. Review persistent volume status
3. Check backup availability
4. Contact database administrator if needed

**Complete System Failure**
1. Verify cluster connectivity
2. Check ingress controller status
3. Review infrastructure provider status
4. Execute disaster recovery plan

## License

This deployment configuration is part of the AI Phone Answering System project. See the main project LICENSE file for terms and conditions.