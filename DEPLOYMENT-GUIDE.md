# AI Answer Ninja - Comprehensive Deployment Guide

## Overview

This guide covers the complete containerization and Kubernetes deployment of the AI Answer Ninja system, including Docker containers, Kubernetes manifests, Helm charts, Service Mesh configuration, and monitoring setup.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Docker Containers](#docker-containers)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [Helm Charts](#helm-charts)
6. [Service Mesh (Istio)](#service-mesh-istio)
7. [Monitoring and Logging](#monitoring-and-logging)
8. [Auto-scaling](#auto-scaling)
9. [Security](#security)
10. [Deployment Procedures](#deployment-procedures)
11. [Troubleshooting](#troubleshooting)
12. [Maintenance](#maintenance)

## Prerequisites

### Software Requirements

- **Kubernetes**: v1.25.0 or later
- **Helm**: v3.10.0 or later
- **Docker**: v20.10.0 or later
- **kubectl**: Compatible with your Kubernetes version
- **Istio**: v1.18.0 or later (optional)

### Infrastructure Requirements

- **Minimum Cluster**: 6 nodes (2 vCPUs, 8GB RAM each)
- **Recommended Cluster**: 12 nodes (4 vCPUs, 16GB RAM each)
- **Storage**: 500GB+ persistent storage
- **Network**: Load balancer and ingress controller
- **DNS**: External DNS management

### Node Types and Taints

```yaml
Node Types:
  - general: Mixed workloads
  - compute: CPU-intensive services
  - compute-optimized: Real-time processing
  - memory-optimized: AI/ML and caching
  - storage-optimized: Database workloads
```

## Architecture Overview

### Service Architecture

```
┌─────────────────────┬─────────────────────┬─────────────────────┐
│   Core Services     │  Support Services   │ Platform Services   │
├─────────────────────┼─────────────────────┼─────────────────────┤
│ Phone Gateway       │ User Management     │ Configuration       │
│ Realtime Processor  │ Smart Whitelist     │ Storage Service     │
│ Conversation Engine │                     │ Monitoring          │
│ Profile Analytics   │                     │                     │
└─────────────────────┴─────────────────────┴─────────────────────┘
                                │
                    ┌─────────────────────┐
                    │   Data Layer        │
                    ├─────────────────────┤
                    │ PostgreSQL          │
                    │ Redis               │
                    └─────────────────────┘
```

### Network Architecture

```
Internet
    │
┌───▼────┐      ┌──────────────┐      ┌─────────────┐
│ ALB    │ ──── │ Istio Gateway│ ──── │ Services    │
└────────┘      └──────────────┘      └─────────────┘
                        │
                ┌───────▼────────┐
                │ Service Mesh   │
                │ (mTLS, Routing)│
                └────────────────┘
```

## Docker Containers

### Multi-stage Build Strategy

All services use optimized multi-stage builds:

1. **Builder Stage**: Install dependencies and build
2. **Production Stage**: Minimal runtime with security hardening
3. **Development Stage**: Development tools and hot-reload
4. **Testing Stage**: Test runners and coverage tools

### Image Optimization Features

- **Security**: Non-root user, minimal base images
- **Performance**: Layer caching, dependency optimization
- **Size**: Multi-stage builds, unused package removal
- **Health**: Built-in health checks and signal handling
- **Debugging**: Development variants with debugging tools

### Build Script

```bash
# Build all images
./scripts/build-docker-images.sh

# Build specific service
docker build -t ai-ninja/phone-gateway:latest services/phone-gateway/

# Build with specific target
docker build --target production -t ai-ninja/realtime-processor:latest services/realtime-processor/
```

## Kubernetes Deployment

### Deployment Structure

```
k8s/manifests/
├── namespace.yaml                 # Namespace and resource quotas
├── core-services/                 # Core business services
│   ├── phone-gateway.yaml
│   ├── realtime-processor.yaml
│   └── conversation-engine.yaml
├── support-services/              # Business support services
│   ├── user-management.yaml
│   └── smart-whitelist.yaml
├── platform-services/            # Infrastructure services
│   ├── configuration-service.yaml
│   ├── storage-service.yaml
│   └── monitoring.yaml
├── data-layer/                    # Data services
│   ├── postgres.yaml
│   └── redis.yaml
├── networking/                    # Network configurations
│   ├── ingress.yaml
│   ├── istio-config.yaml
│   └── hpa.yaml
└── security/                      # Security configurations
    ├── configmaps.yaml
    └── secrets.yaml
```

### Key Features

- **Rolling Updates**: Zero-downtime deployments
- **Health Checks**: Liveness, readiness, and startup probes
- **Resource Management**: Requests and limits for all containers
- **Security**: Pod security contexts, RBAC, network policies
- **Persistence**: StatefulSets for databases with persistent volumes
- **Monitoring**: Prometheus metrics and service discovery

### Deployment Commands

```bash
# Deploy entire stack
kubectl apply -f k8s/manifests/

# Deploy specific component
kubectl apply -f k8s/manifests/core-services/

# Check deployment status
kubectl get pods -n ai-ninja -w

# Scale deployment
kubectl scale deployment phone-gateway --replicas=5 -n ai-ninja
```

## Helm Charts

### Chart Structure

```
helm-charts/ai-ninja/
├── Chart.yaml                     # Chart metadata
├── values.yaml                    # Default configuration
├── templates/
│   ├── _helpers.tpl              # Template helpers
│   ├── namespace.yaml            # Namespace management
│   ├── core-services/            # Core service templates
│   ├── support-services/         # Support service templates
│   ├── platform-services/        # Platform service templates
│   ├── data-layer/               # Data service templates
│   ├── networking/               # Network templates
│   └── security/                 # Security templates
└── charts/                        # Sub-charts
```

### Deployment with Helm

```bash
# Add required repositories
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install dependencies
helm dependency update helm-charts/ai-ninja

# Deploy to production
helm install ai-ninja helm-charts/ai-ninja \
  --namespace ai-ninja \
  --create-namespace \
  --values helm-charts/ai-ninja/values-production.yaml

# Upgrade deployment
helm upgrade ai-ninja helm-charts/ai-ninja \
  --namespace ai-ninja \
  --values helm-charts/ai-ninja/values-production.yaml

# Rollback if needed
helm rollback ai-ninja 1 --namespace ai-ninja
```

### Environment-specific Values

```bash
# Development
helm install ai-ninja helm-charts/ai-ninja -f values-dev.yaml

# Staging
helm install ai-ninja helm-charts/ai-ninja -f values-staging.yaml

# Production
helm install ai-ninja helm-charts/ai-ninja -f values-prod.yaml
```

## Service Mesh (Istio)

### Features Enabled

- **Traffic Management**: Intelligent routing and load balancing
- **Security**: mTLS, RBAC, and authentication policies
- **Observability**: Distributed tracing and metrics
- **Resilience**: Circuit breakers, retries, and timeouts

### Configuration Components

1. **Gateway**: External traffic entry point
2. **VirtualService**: Request routing rules
3. **DestinationRule**: Load balancing and circuit breaker policies
4. **ServiceEntry**: External service integration
5. **PeerAuthentication**: mTLS configuration
6. **AuthorizationPolicy**: Access control

### Istio Installation

```bash
# Install Istio
istioctl install --set values.defaultRevision=default

# Enable injection for namespace
kubectl label namespace ai-ninja istio-injection=enabled

# Apply Istio configurations
kubectl apply -f k8s/manifests/networking/istio-config.yaml

# Verify mesh status
istioctl proxy-status
```

### Traffic Routing

- **API Traffic**: Routed through `api.ai-ninja.com`
- **WebSocket**: Dedicated route through `ws.ai-ninja.com`
- **Internal**: Service-to-service mTLS communication
- **External**: Secure connections to Azure services

## Monitoring and Logging

### Monitoring Stack

- **Prometheus**: Metrics collection and alerting
- **Grafana**: Visualization and dashboards
- **Jaeger**: Distributed tracing (via Istio)
- **AlertManager**: Alert routing and management

### Key Metrics

```yaml
Business Metrics:
  - Call success/failure rates
  - AI response accuracy
  - Conversation abandonment rates
  - User satisfaction scores

Technical Metrics:
  - Response times (p50, p95, p99)
  - Error rates by service
  - Resource utilization
  - Database performance

Infrastructure Metrics:
  - Pod CPU/Memory usage
  - Network throughput
  - Storage IOPS
  - Node health
```

### Dashboard Access

```bash
# Grafana (username: admin)
kubectl port-forward svc/grafana-service 3000:3000 -n ai-ninja

# Prometheus
kubectl port-forward svc/prometheus-service 9090:9090 -n ai-ninja

# Jaeger (if using Istio)
istioctl dashboard jaeger
```

### Log Aggregation

- **Application Logs**: Structured JSON logging
- **Access Logs**: Nginx/Istio access logs
- **Audit Logs**: Security and compliance events
- **Error Tracking**: Centralized error reporting

## Auto-scaling

### Horizontal Pod Autoscaler (HPA)

Each service has custom HPA configuration:

```yaml
Phone Gateway:
  Min/Max: 3-20 replicas
  CPU Target: 70%
  Memory Target: 80%
  Custom: concurrent_connections < 100

Realtime Processor:
  Min/Max: 5-50 replicas
  CPU Target: 60%
  Memory Target: 75%
  Custom: websocket_connections < 20
```

### Vertical Pod Autoscaler (VPA)

- **PostgreSQL**: Auto-adjust memory based on workload
- **Redis**: Dynamic memory allocation
- **ML Services**: CPU/Memory optimization for AI workloads

### Cluster Autoscaler

- **Node Scaling**: Automatic node addition/removal
- **Cost Optimization**: Scale down during low traffic
- **Resource Planning**: Predictive scaling based on patterns

## Security

### Multi-layered Security

1. **Container Security**:
   - Non-root user execution
   - Read-only root filesystem
   - Minimal base images
   - Security scanning

2. **Network Security**:
   - Network policies
   - Service mesh mTLS
   - Ingress TLS termination
   - Pod-to-pod encryption

3. **Access Control**:
   - RBAC for services
   - ServiceAccount isolation
   - Pod security standards
   - Secret management

4. **Data Security**:
   - Encryption at rest
   - Encryption in transit
   - Key rotation
   - Backup encryption

### Secret Management

```bash
# Create secrets
kubectl create secret generic app-secrets \
  --from-literal=jwt-secret=your-jwt-secret \
  --from-literal=redis-password=your-redis-password \
  --namespace ai-ninja

# Azure Key Vault integration (optional)
kubectl apply -f k8s/manifests/security/external-secrets.yaml
```

## Deployment Procedures

### Automated Deployment Script

```bash
# Full deployment
./k8s/deploy.sh

# Environment-specific deployment
./k8s/deploy.sh -e staging -t v1.0.0

# Dry run
./k8s/deploy.sh --dry-run

# Skip image building
./k8s/deploy.sh --skip-build
```

### Manual Deployment Steps

1. **Prepare Environment**:
   ```bash
   # Create namespace
   kubectl create namespace ai-ninja
   
   # Apply secrets
   kubectl apply -f k8s/manifests/security/secrets.yaml
   ```

2. **Deploy Data Layer**:
   ```bash
   kubectl apply -f k8s/manifests/data-layer/
   ```

3. **Deploy Core Services**:
   ```bash
   kubectl apply -f k8s/manifests/core-services/
   ```

4. **Deploy Support Services**:
   ```bash
   kubectl apply -f k8s/manifests/support-services/
   ```

5. **Configure Networking**:
   ```bash
   kubectl apply -f k8s/manifests/networking/
   ```

6. **Verify Deployment**:
   ```bash
   kubectl get pods -n ai-ninja
   kubectl get svc -n ai-ninja
   ```

### Rolling Update Strategy

```bash
# Update image
kubectl set image deployment/phone-gateway phone-gateway=ai-ninja/phone-gateway:v1.1.0 -n ai-ninja

# Monitor rollout
kubectl rollout status deployment/phone-gateway -n ai-ninja

# Rollback if needed
kubectl rollout undo deployment/phone-gateway -n ai-ninja
```

## Troubleshooting

### Common Issues

1. **Pod Startup Failures**:
   ```bash
   # Check pod logs
   kubectl logs -f deployment/phone-gateway -n ai-ninja
   
   # Check events
   kubectl get events -n ai-ninja --sort-by=.metadata.creationTimestamp
   
   # Describe pod
   kubectl describe pod <pod-name> -n ai-ninja
   ```

2. **Service Connectivity**:
   ```bash
   # Test service connectivity
   kubectl exec -it deployment/phone-gateway -n ai-ninja -- curl http://redis-service:6379
   
   # Check service endpoints
   kubectl get endpoints -n ai-ninja
   
   # Test DNS resolution
   kubectl exec -it deployment/phone-gateway -n ai-ninja -- nslookup redis-service
   ```

3. **Resource Issues**:
   ```bash
   # Check resource usage
   kubectl top pods -n ai-ninja
   kubectl top nodes
   
   # Check resource quotas
   kubectl describe quota -n ai-ninja
   
   # Check limits
   kubectl describe limitrange -n ai-ninja
   ```

4. **Istio Issues**:
   ```bash
   # Check proxy status
   istioctl proxy-status
   
   # Check configuration
   istioctl proxy-config cluster <pod-name> -n ai-ninja
   
   # Check logs
   kubectl logs <pod-name> -c istio-proxy -n ai-ninja
   ```

### Health Check Commands

```bash
# Overall system health
kubectl get pods,svc,ing -n ai-ninja

# Database connectivity
kubectl exec -it statefulset/postgres -n ai-ninja -- psql -h localhost -U ai_ninja_user -d ai_ninja_main -c "SELECT 1"

# Redis connectivity
kubectl exec -it statefulset/redis -n ai-ninja -- redis-cli ping

# Service health endpoints
services=("phone-gateway" "realtime-processor" "conversation-engine" "profile-analytics" "user-management" "smart-whitelist")
for service in "${services[@]}"; do
  kubectl exec -it deployment/$service -n ai-ninja -- curl -f http://localhost:300X/health
done
```

## Maintenance

### Regular Maintenance Tasks

1. **Weekly**:
   - Review resource utilization
   - Check for pod restarts
   - Review error logs
   - Update security patches

2. **Monthly**:
   - Update dependencies
   - Review and rotate secrets
   - Backup verification
   - Performance optimization

3. **Quarterly**:
   - Kubernetes version updates
   - Major dependency updates
   - Security audit
   - Disaster recovery testing

### Backup and Recovery

```bash
# Database backup
kubectl exec -it statefulset/postgres -n ai-ninja -- pg_dump ai_ninja_main > backup.sql

# Redis backup
kubectl exec -it statefulset/redis -n ai-ninja -- redis-cli --rdb /data/backup.rdb

# Persistent volume snapshots (cloud-specific)
kubectl get pv
# Create snapshots using cloud provider tools
```

### Scaling Operations

```bash
# Scale individual services
kubectl scale deployment phone-gateway --replicas=10 -n ai-ninja

# Update HPA settings
kubectl patch hpa phone-gateway-hpa -n ai-ninja -p '{"spec":{"maxReplicas":30}}'

# Add cluster nodes
# Use cloud provider's node group scaling
```

### Monitoring and Alerting

```yaml
Critical Alerts:
  - Service down (>1 minute)
  - High error rate (>5%)
  - High response time (>2s p95)
  - Database connection failures
  - Memory/CPU exhaustion

Warning Alerts:
  - High resource utilization (>80%)
  - Increased error rate (>1%)
  - Pod restarts
  - Slow response times (>1s p95)
```

## Performance Tuning

### Optimization Areas

1. **Database**:
   - Connection pooling optimization
   - Query performance monitoring
   - Index optimization
   - Partition management

2. **Caching**:
   - Redis memory optimization
   - Cache hit rate monitoring
   - TTL optimization
   - Cache warming strategies

3. **Application**:
   - JVM/Node.js memory tuning
   - Connection pool sizing
   - Async processing optimization
   - Resource request/limit tuning

4. **Network**:
   - Service mesh optimization
   - Load balancer configuration
   - CDN integration
   - Connection keep-alive settings

### Cost Optimization

- **Resource Right-sizing**: Regular review and adjustment
- **Node Efficiency**: Mixed instance types for workload optimization
- **Auto-scaling**: Aggressive scale-down policies
- **Reserved Instances**: Long-term cost savings
- **Storage Optimization**: Lifecycle policies for data archival

## Support and Documentation

### Additional Resources

- [Kubernetes Official Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)
- [Istio Documentation](https://istio.io/latest/docs/)
- [Prometheus Documentation](https://prometheus.io/docs/)

### Contact Information

For deployment issues or questions:
- **Technical Support**: support@ai-ninja.com
- **DevOps Team**: devops@ai-ninja.com
- **Emergency**: Use on-call rotation

---

This comprehensive deployment guide ensures successful containerization and Kubernetes deployment of the AI Answer Ninja system with production-ready configurations, monitoring, security, and operational procedures.