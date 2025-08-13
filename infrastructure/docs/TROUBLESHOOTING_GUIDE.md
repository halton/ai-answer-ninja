# AI Answer Ninja - Troubleshooting Guide

## Quick Reference

### Emergency Contacts
- **On-call Engineer**: +86-138-0013-8000
- **Team Lead**: DevOps-Lead@company.com
- **Engineering Manager**: eng-manager@company.com

### Critical Commands
```bash
# Cluster health check
kubectl get nodes
kubectl get pods --all-namespaces

# Application health
curl -I https://api.ai-answer-ninja.com/health

# Database health
az postgres flexible-server show --name ai-answer-ninja-prod-psql -g ai-answer-ninja-prod-rg-primary

# Traffic Manager status
az network traffic-manager profile show --name ai-answer-ninja-prod-tm -g ai-answer-ninja-prod-rg-shared
```

## Severity Classification

### P1 - Critical (Response: <5 minutes)
- Complete service outage
- Data corruption or loss
- Security breach
- Multiple component failures

### P2 - High (Response: <30 minutes)
- Significant performance degradation
- Single component failure with workaround
- Memory/disk space critical

### P3 - Medium (Response: <2 hours)
- Minor performance issues
- Non-critical component failures
- Certificate expiration warnings

### P4 - Low (Response: <24 hours)
- Cosmetic issues
- Enhancement requests
- Documentation updates

## Common Issues

### 1. Application Unavailable (P1)

#### Symptoms
- Health check endpoint returns 503/500 errors
- Users cannot access the application
- Load balancer showing unhealthy targets

#### Immediate Diagnosis
```bash
# Check AKS cluster status
az aks show --resource-group ai-answer-ninja-prod-rg-primary --name ai-answer-ninja-prod-aks --query "powerState.code"

# Check all pods status
kubectl get pods --all-namespaces --field-selector=status.phase!=Running

# Check ingress controller
kubectl get ingress -A
kubectl describe ingress -n production

# Check application gateway
az network application-gateway show-health --resource-group ai-answer-ninja-prod-rg-primary --name ai-answer-ninja-prod-agw
```

#### Common Causes and Solutions

**1. Pod Failures**
```bash
# Check pod logs
kubectl logs -f <failing-pod-name> -n production --previous

# Check pod events
kubectl describe pod <failing-pod-name> -n production

# Restart deployment
kubectl rollout restart deployment/<deployment-name> -n production
```

**2. Resource Exhaustion**
```bash
# Check node resources
kubectl describe nodes
kubectl top nodes

# Scale out if needed
kubectl scale deployment/<deployment-name> --replicas=<new-count> -n production
```

**3. Configuration Issues**
```bash
# Check ConfigMaps and Secrets
kubectl get configmaps -n production
kubectl get secrets -n production

# Verify environment variables
kubectl describe deployment/<deployment-name> -n production
```

#### Escalation Criteria
- Issue persists >15 minutes
- Unable to identify root cause
- Requires infrastructure changes

### 2. Database Connection Issues (P1/P2)

#### Symptoms
- Database connection timeouts
- Authentication failures
- Slow database queries

#### Immediate Diagnosis
```bash
# Check PostgreSQL server status
az postgres flexible-server show --resource-group ai-answer-ninja-prod-rg-primary --name ai-answer-ninja-prod-psql

# Check server logs
az postgres flexible-server server-logs list --resource-group ai-answer-ninja-prod-rg-primary --server-name ai-answer-ninja-prod-psql

# Test connection from pod
kubectl exec -it <app-pod> -n production -- pg_isready -h ai-answer-ninja-prod-psql.postgres.database.azure.com -p 5432 -U psqladmin
```

#### Common Solutions

**1. Connection Pool Exhaustion**
```bash
# Check active connections
kubectl exec -it <app-pod> -n production -- psql -h <db-host> -U <username> -d <database> -c "SELECT count(*) FROM pg_stat_activity;"

# Restart application pods to reset connection pools
kubectl rollout restart deployment/<deployment-name> -n production
```

**2. Database Performance Issues**
```bash
# Check slow queries
kubectl exec -it <app-pod> -n production -- psql -h <db-host> -U <username> -d <database> -c "SELECT query, calls, total_time, mean_time FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;"

# Check database metrics in Azure portal
az monitor metrics list --resource <postgresql-resource-id> --metric "cpu_percent,memory_percent,active_connections"
```

**3. Network Connectivity**
```bash
# Check network security group rules
az network nsg rule list --resource-group ai-answer-ninja-prod-rg-primary --nsg-name ai-answer-ninja-prod-db-nsg

# Test connectivity from AKS subnet
kubectl run test-pod --image=postgres:13 --rm -it --restart=Never -- psql -h <db-host> -U <username>
```

### 3. High Memory Usage (P2)

#### Symptoms
- Pods getting OOMKilled
- Slow application response
- High swap usage on nodes

#### Diagnosis Process
```bash
# Check memory usage by node
kubectl top nodes

# Check memory usage by pod
kubectl top pods --all-namespaces --sort-by=memory

# Check pod resource limits and requests
kubectl describe pod <pod-name> -n production

# Check for memory leaks
kubectl exec -it <pod-name> -n production -- ps aux --sort=-%mem | head -10
```

#### Solutions

**1. Increase Resource Limits**
```yaml
# Update deployment with higher memory limits
resources:
  limits:
    memory: "2Gi"
  requests:
    memory: "1Gi"
```

**2. Scale Horizontally**
```bash
kubectl scale deployment/<deployment-name> --replicas=<higher-count> -n production
```

**3. Enable Vertical Pod Autoscaling**
```bash
# Check if VPA is enabled
kubectl get vpa -n production

# Enable VPA for deployment
kubectl apply -f vpa-config.yaml
```

### 4. SSL Certificate Issues (P2)

#### Symptoms
- Browser SSL warnings
- Certificate expiration alerts
- HTTPS connection failures

#### Diagnosis
```bash
# Check certificate in Key Vault
az keyvault certificate show --vault-name ai-answer-ninja-prod-kv-xxxx --name ai-answer-ninja-ssl

# Check certificate expiration
openssl s_client -servername api.ai-answer-ninja.com -connect api.ai-answer-ninja.com:443 2>/dev/null | openssl x509 -noout -dates

# Check Application Gateway SSL settings
az network application-gateway ssl-cert show --resource-group ai-answer-ninja-prod-rg-primary --gateway-name ai-answer-ninja-prod-agw --name ssl-cert
```

#### Solutions

**1. Certificate Renewal**
```bash
# Manual certificate renewal
az keyvault certificate create --vault-name ai-answer-ninja-prod-kv-xxxx --name ai-answer-ninja-ssl --policy @cert-policy.json

# Update Application Gateway
az network application-gateway ssl-cert update --resource-group ai-answer-ninja-prod-rg-primary --gateway-name ai-answer-ninja-prod-agw --name ssl-cert --key-vault-secret-id <new-secret-id>
```

**2. Auto-renewal Configuration**
```bash
# Verify auto-renewal policy
az keyvault certificate get-default-policy --scaffold > default-policy.json
```

### 5. Storage Issues (P2/P3)

#### Symptoms
- File upload/download failures
- Disk space warnings
- Storage throttling errors

#### Diagnosis
```bash
# Check storage account metrics
az storage account show --name aianswerninjastorage --resource-group ai-answer-ninja-prod-rg-primary

# Check storage quotas and usage
az storage metrics show --account-name aianswerninjastorage

# Check persistent volume claims
kubectl get pvc -A
kubectl describe pvc <pvc-name> -n production
```

#### Solutions

**1. Storage Cleanup**
```bash
# Review lifecycle policies
az storage account management-policy show --account-name aianswerninjastorage

# Manual cleanup of old files
az storage blob delete-batch --source <container-name> --pattern "logs/2024/01/*" --account-name aianswerninjastorage
```

**2. Scale Storage**
```bash
# Increase storage account limits (if applicable)
az storage account update --name aianswerninjastorage --resource-group ai-answer-ninja-prod-rg-primary --sku Standard_GRS
```

### 6. Network Connectivity Issues (P2)

#### Symptoms
- External API timeouts
- Inter-service communication failures
- DNS resolution issues

#### Diagnosis
```bash
# Test external connectivity
kubectl run test-pod --image=alpine --rm -it --restart=Never -- wget -qO- http://httpbin.org/ip

# Check DNS resolution
kubectl run test-pod --image=alpine --rm -it --restart=Never -- nslookup google.com

# Check service discovery
kubectl get svc -A
kubectl describe svc <service-name> -n production
```

#### Solutions

**1. Network Security Group Issues**
```bash
# Check NSG rules
az network nsg rule list --resource-group ai-answer-ninja-prod-rg-primary --nsg-name ai-answer-ninja-prod-aks-nsg

# Add missing rules
az network nsg rule create --resource-group ai-answer-ninja-prod-rg-primary --nsg-name ai-answer-ninja-prod-aks-nsg --name AllowHTTPS --protocol Tcp --direction Outbound --priority 1000 --source-address-prefixes '*' --destination-port-ranges 443
```

**2. DNS Configuration**
```bash
# Check CoreDNS configuration
kubectl get configmap coredns -n kube-system -o yaml

# Restart CoreDNS
kubectl rollout restart deployment/coredns -n kube-system
```

## Performance Issues

### Slow Response Times

#### Investigation Steps
1. **Application Insights Analysis**
```bash
# Open Application Insights in Azure Portal
# Navigate to Performance blade
# Analyze slow requests and dependencies
```

2. **Database Performance**
```kusto
// Query in Log Analytics
AppDependencies
| where Type == "SQL"
| where TimeGenerated >= ago(1h)
| summarize avg(DurationMs), count() by Name
| order by avg_DurationMs desc
```

3. **Cache Performance**
```bash
# Check Redis metrics
az redis show --name ai-answer-ninja-prod-redis --resource-group ai-answer-ninja-prod-rg-primary

# Check cache hit rates
kubectl exec -it <app-pod> -n production -- redis-cli -h <redis-host> info stats
```

### High Error Rates

#### Analysis Process
```kusto
// Application Insights query for errors
AppExceptions
| where TimeGenerated >= ago(1h)
| summarize count() by Type, Method
| order by count_ desc
```

```bash
# Check application logs
kubectl logs --since=1h -l app=<app-name> -n production | grep -i error

# Check recent deployments
kubectl rollout history deployment/<deployment-name> -n production
```

## Disaster Recovery Scenarios

### Primary Region Outage

#### Immediate Actions
1. **Verify outage scope**
```bash
# Check Azure Service Health
az rest --method get --url "https://management.azure.com/subscriptions/<subscription-id>/providers/Microsoft.ResourceHealth/availabilityStatuses?api-version=2018-07-01"
```

2. **Initiate manual failover if needed**
```bash
# Execute failover runbook
az automation runbook start --automation-account-name ai-answer-ninja-prod-automation-dr --resource-group ai-answer-ninja-prod-rg-shared --name ai-answer-ninja-prod-failover-runbook --parameters '{"TrafficManagerProfileName":"ai-answer-ninja-prod-tm","ResourceGroupName":"ai-answer-ninja-prod-rg-shared","FailoverReason":"Primary region outage"}'
```

3. **Verify secondary region activation**
```bash
# Check DNS resolution points to secondary
dig ai-answer-ninja-prod-global.trafficmanager.net

# Verify application health in secondary region
curl -I https://secondary-endpoint/health
```

### Database Failover

#### PostgreSQL High Availability
```bash
# Check current primary/standby status
az postgres flexible-server show --resource-group ai-answer-ninja-prod-rg-primary --name ai-answer-ninja-prod-psql --query "highAvailability"

# Force failover if needed (use with caution)
az postgres flexible-server restart --resource-group ai-answer-ninja-prod-rg-primary --name ai-answer-ninja-prod-psql --failover Forced
```

## Log Analysis

### Key Log Queries

#### Application Errors
```kusto
AppTraces
| where SeverityLevel >= 3
| where TimeGenerated >= ago(1h)
| project TimeGenerated, SeverityLevel, Message, OperationName
| order by TimeGenerated desc
```

#### Performance Issues
```kusto
AppRequests
| where DurationMs > 2000
| where TimeGenerated >= ago(1h)
| project TimeGenerated, Name, DurationMs, ResultCode, OperationId
| order by DurationMs desc
```

#### Resource Usage
```kusto
Perf
| where ObjectName == "K8SContainer" and CounterName == "memoryWorkingSetBytes"
| where TimeGenerated >= ago(1h)
| summarize avg(CounterValue), max(CounterValue) by bin(TimeGenerated, 5m), InstanceName
| render timechart
```

#### Security Events
```kusto
AzureActivity
| where CategoryValue == "Security"
| where TimeGenerated >= ago(24h)
| project TimeGenerated, OperationNameValue, ActivityStatusValue, Caller, ResourceGroup
| order by TimeGenerated desc
```

## Automation Scripts

### Health Check Script
```bash
#!/bin/bash
# health-check.sh - Quick system health verification

echo "=== AI Answer Ninja Health Check ==="
echo "Timestamp: $(date)"

# Check AKS cluster
echo "Checking AKS cluster..."
kubectl get nodes --no-headers | awk '{print $1 ": " $2}'

# Check critical pods
echo "Checking critical pods..."
kubectl get pods -n production -o wide | grep -E "(api|worker|scheduler)"

# Check ingress
echo "Checking ingress..."
kubectl get ingress -A --no-headers

# Check application endpoint
echo "Checking application endpoint..."
curl -s -o /dev/null -w "HTTP Status: %{http_code}, Response Time: %{time_total}s\n" https://api.ai-answer-ninja.com/health

# Check database connectivity
echo "Checking database..."
kubectl exec -n production deployment/api -- pg_isready -h ai-answer-ninja-prod-psql.postgres.database.azure.com -p 5432 -U psqladmin

echo "=== Health Check Complete ==="
```

### Recovery Script Template
```bash
#!/bin/bash
# recovery-template.sh - Template for incident recovery

INCIDENT_ID="${1:-$(date +%Y%m%d-%H%M%S)}"
SEVERITY="${2:-P2}"

echo "Starting recovery for incident: $INCIDENT_ID (Severity: $SEVERITY)"

# Log incident start
echo "$(date): Recovery started for incident $INCIDENT_ID" >> /var/log/incident-recovery.log

# Add recovery steps here based on incident type
case "$SEVERITY" in
  "P1")
    echo "Critical incident - implementing emergency procedures"
    # Add P1 recovery steps
    ;;
  "P2") 
    echo "High priority incident - implementing standard recovery"
    # Add P2 recovery steps
    ;;
  *)
    echo "Standard incident recovery"
    # Add standard recovery steps
    ;;
esac

# Verify recovery
echo "Verifying system health post-recovery..."
./health-check.sh

echo "Recovery completed for incident: $INCIDENT_ID"
```

## Escalation Matrix

### Internal Escalation
1. **Level 1**: On-call Engineer (0-15 min)
2. **Level 2**: Team Lead (15-30 min)
3. **Level 3**: Engineering Manager (30-60 min)
4. **Level 4**: VP Engineering (60+ min)

### External Escalation
- **Azure Support**: Create support case for P1 incidents
- **Vendor Support**: Contact third-party vendors for dependency issues
- **Customer Communication**: Update status page and send notifications

### Escalation Triggers
- **P1 incidents** unresolved after 30 minutes
- **P2 incidents** unresolved after 2 hours
- **Multiple component failures**
- **Security incidents**
- **Data loss or corruption**

---

**Document Version**: 1.0
**Last Updated**: 2024-08-12
**Author**: DevOps Team
**Next Review**: 2024-09-12