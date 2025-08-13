# AI Answer Ninja - Operations Handbook

## Table of Contents
1. [System Overview](#system-overview)
2. [Infrastructure Architecture](#infrastructure-architecture)
3. [Daily Operations](#daily-operations)
4. [Monitoring and Alerting](#monitoring-and-alerting)
5. [Troubleshooting Guide](#troubleshooting-guide)
6. [Disaster Recovery](#disaster-recovery)
7. [Cost Management](#cost-management)
8. [Security Operations](#security-operations)
9. [Performance Optimization](#performance-optimization)
10. [Emergency Procedures](#emergency-procedures)

## System Overview

### Service Architecture
The AI Answer Ninja system consists of:
- **AKS Cluster**: Kubernetes cluster hosting microservices
- **PostgreSQL**: Primary database for user data and call records
- **Redis**: Cache layer for session management
- **Azure Storage**: File storage for voice recordings and logs
- **Application Gateway**: Load balancer and SSL termination
- **Traffic Manager**: Global DNS and failover management

### Environments
- **Production**: East Asia (primary), Southeast Asia (secondary)
- **Staging**: East Asia only
- **Development**: East Asia only

### Key Metrics
- **RTO**: 15 minutes (Recovery Time Objective)
- **RPO**: 5 minutes (Recovery Point Objective)
- **SLA**: 99.9% uptime
- **Response Time**: <1.5 seconds (P95)

## Infrastructure Architecture

### Azure Resources Layout
```
ai-answer-ninja-prod-rg-primary/
├── AKS Cluster (ai-answer-ninja-prod-aks)
├── PostgreSQL Server (ai-answer-ninja-prod-psql)
├── Redis Cache (ai-answer-ninja-prod-redis)
├── Storage Account (aianswerninjastorage)
├── Application Gateway + WAF
├── Key Vault (ai-answer-ninja-prod-kv-xxxx)
├── Log Analytics Workspace
└── Application Insights

ai-answer-ninja-prod-rg-secondary/ (DR)
├── AKS Cluster (ai-answer-ninja-prod-dr-aks)
├── PostgreSQL Replica (ai-answer-ninja-prod-psql-dr)
└── Storage Account (aianswerninjastoragedr)

ai-answer-ninja-prod-rg-shared/
├── Traffic Manager Profile
├── Key Vault
├── Automation Account
└── Monitoring Resources
```

### Network Architecture
```
VNet: 10.0.0.0/16
├── AKS Subnet: 10.0.1.0/24
├── Database Subnet: 10.0.2.0/24
├── Gateway Subnet: 10.0.3.0/24
└── Bastion Subnet: 10.0.4.0/27
```

## Daily Operations

### Morning Checklist (8:00 AM CST)
- [ ] Check Azure Service Health Dashboard
- [ ] Review overnight alerts and incidents
- [ ] Verify backup completion status
- [ ] Check application health endpoints
- [ ] Review cost anomalies and budget status
- [ ] Validate autoscaling metrics
- [ ] Check certificate expiration warnings

### Monitoring Dashboards
1. **Azure Portal Overview**: Overall resource health
2. **Application Insights**: Performance metrics and errors
3. **Log Analytics**: Custom queries and alerts
4. **Grafana** (if deployed): Custom metrics visualization
5. **Cost Management**: Daily cost tracking

### Health Check Commands
```bash
# Check AKS cluster health
az aks show --resource-group ai-answer-ninja-prod-rg-primary --name ai-answer-ninja-prod-aks --query "powerState"

# Check pod status
kubectl get pods --all-namespaces

# Check node resources
kubectl top nodes

# Test application endpoints
curl -I https://api.ai-answer-ninja.com/health
```

### Log Locations
- **Application Logs**: Application Insights
- **Kubernetes Logs**: Azure Monitor for containers
- **Database Logs**: PostgreSQL flexible server logs
- **Infrastructure Logs**: Azure Activity Log
- **Security Logs**: Azure Security Center

## Monitoring and Alerting

### Critical Alerts (Immediate Response Required)
- AKS cluster unavailable
- Database connection failures
- Application error rate >5%
- SSL certificate expiration <7 days
- Disk space >90% full
- Memory usage >95%

### Warning Alerts (Response Within 2 Hours)
- CPU usage >80%
- Response time >2 seconds
- Pod restart loops
- Storage account throttling
- Cost budget exceeded

### Alert Escalation
1. **Level 1**: On-call engineer (Slack/SMS)
2. **Level 2**: Team lead (Phone call after 15 minutes)
3. **Level 3**: Engineering manager (Phone call after 30 minutes)

### Monitoring Tools Access
- **Azure Portal**: https://portal.azure.com
- **Application Insights**: Direct link in Terraform outputs
- **Log Analytics**: Custom queries and dashboards
- **Grafana** (if used): Custom dashboards for metrics

## Troubleshooting Guide

### Common Issues and Solutions

#### 1. Application Not Responding
**Symptoms**: Health check failures, 503 errors
**Immediate Actions**:
```bash
# Check pod status
kubectl get pods -n production

# Check recent events
kubectl get events --sort-by='.lastTimestamp' -n production

# Check ingress controller
kubectl get ingress -n production

# Check application gateway health
az network application-gateway show-health --resource-group ai-answer-ninja-prod-rg-primary --name ai-answer-ninja-prod-agw
```

**Root Cause Analysis**:
- Pod memory/CPU limits exceeded
- Database connection pool exhausted
- External service dependencies unavailable
- SSL certificate issues

#### 2. Database Connection Issues
**Symptoms**: Connection timeout, authentication failures
**Immediate Actions**:
```bash
# Check PostgreSQL server status
az postgres flexible-server show --resource-group ai-answer-ninja-prod-rg-primary --name ai-answer-ninja-prod-psql

# Check connection from AKS
kubectl exec -it <pod-name> -n production -- psql <connection-string>

# Review PostgreSQL logs
az postgres flexible-server server-logs list --resource-group ai-answer-ninja-prod-rg-primary --server-name ai-answer-ninja-prod-psql
```

**Common Solutions**:
- Restart connection pool
- Check firewall rules
- Verify credentials in Key Vault
- Scale up database if CPU/memory constrained

#### 3. High Memory Usage
**Symptoms**: OOMKilled pods, slow response times
**Investigation**:
```bash
# Check node resource usage
kubectl top nodes

# Check pod resource usage
kubectl top pods --all-namespaces

# Check resource limits
kubectl describe pod <pod-name> -n production
```

**Solutions**:
- Increase memory limits in deployment
- Scale out horizontally
- Check for memory leaks in application
- Review garbage collection settings

#### 4. Storage Issues
**Symptoms**: File upload failures, disk space warnings
**Actions**:
```bash
# Check storage account metrics
az storage metrics show --account-name aianswerninjastorage

# Check disk usage on nodes
kubectl exec -it <pod-name> -- df -h

# Review storage lifecycle policies
az storage account management-policy show --account-name aianswerninjastorage
```

#### 5. Certificate Expiration
**Symptoms**: SSL/TLS errors, browser warnings
**Immediate Actions**:
```bash
# Check certificate expiration
az keyvault certificate show --vault-name ai-answer-ninja-prod-kv-xxxx --name ai-answer-ninja-ssl

# Renew certificate (if auto-renewal failed)
az keyvault certificate create --vault-name ai-answer-ninja-prod-kv-xxxx --name ai-answer-ninja-ssl --policy @cert-policy.json
```

### Performance Issues

#### Slow Response Times
1. **Check application metrics** in Application Insights
2. **Review database performance** - slow queries, connection pool
3. **Analyze cache hit rates** - Redis performance
4. **Check network latency** - Traffic Manager routing
5. **Review resource utilization** - CPU, memory, disk I/O

#### High Error Rates
1. **Check application logs** for stack traces
2. **Review recent deployments** for correlation
3. **Analyze error patterns** - specific endpoints or operations
4. **Check external dependencies** - third-party services
5. **Verify configuration** - connection strings, API keys

### Log Analysis Queries

#### Application Errors
```kusto
AppTraces
| where SeverityLevel >= 3
| where TimeGenerated >= ago(1h)
| summarize count() by bin(TimeGenerated, 5m), SeverityLevel
| render timechart
```

#### Performance Analysis
```kusto
AppRequests
| where TimeGenerated >= ago(1h)
| summarize avg(DurationMs), percentile(DurationMs, 95) by bin(TimeGenerated, 5m)
| render timechart
```

#### Resource Usage
```kusto
Perf
| where ObjectName == "K8SContainer"
| where CounterName == "cpuUsageNanoCores"
| summarize avg(CounterValue) by bin(TimeGenerated, 5m), InstanceName
| render timechart
```

## Disaster Recovery

### Failover Procedures

#### Automatic Failover
The system is configured for automatic failover with:
- Traffic Manager health probes (30-second intervals)
- Automatic endpoint switching on health check failures
- Database read replica in secondary region

#### Manual Failover
If manual intervention is required:

```bash
# 1. Check primary region health
az resource show --resource-group ai-answer-ninja-prod-rg-primary --name ai-answer-ninja-prod-aks --resource-type Microsoft.ContainerService/managedClusters

# 2. Execute failover runbook
az automation runbook start --automation-account-name ai-answer-ninja-prod-automation-dr --resource-group ai-answer-ninja-prod-rg-shared --name ai-answer-ninja-prod-failover-runbook

# 3. Verify secondary region is receiving traffic
dig ai-answer-ninja-prod-global.trafficmanager.net

# 4. Monitor application health in secondary region
curl -I https://secondary-endpoint/health
```

#### Failback Procedures
After primary region is restored:

```bash
# 1. Verify primary region health
curl -I https://primary-endpoint/health

# 2. Execute failback runbook
az automation runbook start --automation-account-name ai-answer-ninja-prod-automation-dr --resource-group ai-answer-ninja-prod-rg-shared --name ai-answer-ninja-prod-failback-runbook

# 3. Verify traffic routing back to primary
dig ai-answer-ninja-prod-global.trafficmanager.net
```

### Backup and Recovery

#### Database Backups
- **Automated backups**: 35-day retention
- **Point-in-time recovery**: Available
- **Geo-redundant storage**: Enabled

#### File Storage Backups
- **Geo-redundant storage**: Enabled
- **Lifecycle management**: Automatic archival
- **Cross-region replication**: Configured

#### Recovery Testing
Monthly DR tests are scheduled:
- First Sunday of each month at 02:00 UTC
- Automated via Azure Automation
- Results logged to Log Analytics

## Cost Management

### Daily Cost Monitoring
- Review Azure Cost Management dashboard
- Check budget alerts and forecasts
- Analyze cost anomalies
- Review Reserved Instance utilization

### Cost Optimization Actions
- **Non-production environments**: Auto-shutdown after hours
- **Unused resources**: Regular cleanup (IPs, disks, snapshots)
- **Right-sizing**: Monitor and adjust VM sizes based on utilization
- **Storage tiers**: Automated lifecycle management

### Budget Alerts
- 50% of monthly budget: Team notification
- 80% of monthly budget: Management escalation
- 100% forecasted: Immediate intervention required

### Cost Analysis Queries
```kusto
// Daily cost trending
AzureActivity
| where OperationNameValue contains "Microsoft.Consumption/budgets"
| summarize count() by bin(TimeGenerated, 1d)
| render timechart
```

## Security Operations

### Security Monitoring
- **Azure Security Center**: Continuous security assessment
- **Key Vault access logs**: Monitor secret access
- **Network security logs**: Review firewall and NSG logs
- **Authentication logs**: Monitor Azure AD sign-ins

### Incident Response
1. **Immediate containment**: Isolate affected resources
2. **Assessment**: Determine scope and impact
3. **Communication**: Notify stakeholders and authorities
4. **Recovery**: Restore service with security patches
5. **Post-incident review**: Document lessons learned

### Security Tools
- **Azure Defender**: Advanced threat protection
- **Azure Sentinel**: SIEM capabilities (if enabled)
- **Azure Policy**: Compliance monitoring
- **Key Vault**: Secrets and certificate management

### Security Checklist
- [ ] Regular security patches applied
- [ ] SSL certificates valid and renewed
- [ ] Access permissions reviewed quarterly
- [ ] Security baselines maintained
- [ ] Vulnerability scans completed monthly

## Performance Optimization

### Performance Metrics
- **Response Time**: Target <1.5 seconds (P95)
- **Throughput**: Requests per second
- **Error Rate**: <2% for production
- **Resource Utilization**: CPU <70%, Memory <75%

### Optimization Strategies
1. **Horizontal Pod Autoscaling**: Scale based on CPU/memory
2. **Cluster Autoscaling**: Add/remove nodes automatically
3. **Caching**: Optimize Redis usage patterns
4. **Database**: Query optimization and indexing
5. **CDN**: Content delivery optimization (if applicable)

### Performance Testing
- **Load testing**: Regular stress tests
- **Chaos engineering**: Resilience testing
- **Performance profiling**: Application-level optimization

## Emergency Procedures

### Severity 1 Incidents (Service Down)
1. **Immediate Response**: <5 minutes
2. **War Room**: Establish incident bridge
3. **Communication**: Update status page
4. **Escalation**: Notify management within 15 minutes
5. **Resolution**: Target <1 hour

### Communication Templates

#### Initial Incident Notification
```
🚨 INCIDENT ALERT - AI Answer Ninja Production

Severity: P1
Impact: Service unavailable
Start Time: [TIMESTAMP]
Status: Investigating

We are investigating reports of service unavailability. Our team is working to identify and resolve the issue.

Next Update: [TIMESTAMP + 30 minutes]
```

#### Resolution Notification
```
✅ RESOLVED - AI Answer Ninja Production

Incident Duration: [DURATION]
Resolution Time: [TIMESTAMP]
Status: Fully operational

The service has been fully restored. We will be conducting a post-incident review to prevent similar issues in the future.
```

### Contact Information
- **On-call Engineer**: [Phone/Slack]
- **Team Lead**: [Phone/Email]
- **Engineering Manager**: [Phone/Email]
- **Azure Support**: [Support case process]

### External Dependencies
- **Azure Services**: Primary cloud provider
- **DNS Provider**: For domain management
- **SSL Certificate Authority**: For certificate management
- **Third-party APIs**: AI/ML services, communication services

## Runbook Maintenance

This runbook should be reviewed and updated:
- **Monthly**: Procedures and contact information
- **Quarterly**: Architecture diagrams and dependencies  
- **After incidents**: Lessons learned and improvements
- **After deployments**: New features and changes

---

**Document Version**: 1.0
**Last Updated**: 2024-08-12
**Next Review Date**: 2024-09-12
**Owner**: DevOps Team