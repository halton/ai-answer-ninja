# AI Answer Ninja - Production Infrastructure

This directory contains the complete production-ready infrastructure configuration for the AI Answer Ninja system, built using Infrastructure as Code (IaC) principles with Terraform and Azure.

## 🏗️ Architecture Overview

### Multi-Region Setup
- **Primary Region**: East Asia (production workloads)
- **Secondary Region**: Southeast Asia (disaster recovery)
- **High Availability**: 99.9% SLA with automated failover

### Core Components
- **AKS Clusters**: Kubernetes orchestration with auto-scaling
- **Azure Database for PostgreSQL**: Managed database with backup & replication
- **Azure Redis Cache**: Session management and caching
- **Azure Storage**: File storage with lifecycle management
- **Traffic Manager**: Global load balancing and DNS failover
- **Application Gateway**: Layer 7 load balancing with WAF
- **Azure Monitor**: Comprehensive monitoring and alerting

## 📁 Directory Structure

```
infrastructure/
├── terraform/                    # Terraform infrastructure code
│   ├── main.tf                  # Main Terraform configuration
│   ├── variables.tf             # Variable definitions
│   ├── outputs.tf               # Output definitions
│   ├── cost-optimization.tf     # Cost management automation
│   ├── disaster-recovery.tf     # DR and failover configuration
│   ├── modules/                 # Reusable Terraform modules
│   │   ├── aks/                 # AKS cluster module
│   │   ├── networking/          # VPC and networking module
│   │   ├── storage/             # Database and storage module
│   │   ├── security/            # Security and IAM module
│   │   └── monitoring/          # Monitoring and alerting module
│   └── environments/            # Environment-specific configurations
│       ├── dev/                 # Development environment
│       ├── staging/             # Staging environment
│       └── prod/                # Production environment
├── k8s/                         # Kubernetes manifests
│   ├── base/                    # Base Kubernetes configurations
│   └── environments/            # Environment-specific overlays
├── scripts/                     # Deployment and utility scripts
│   ├── deploy.sh               # Infrastructure deployment script
│   └── destroy.sh              # Infrastructure destruction script
└── docs/                        # Documentation
    ├── OPERATIONS_HANDBOOK.md  # Complete operations guide
    └── TROUBLESHOOTING_GUIDE.md # Troubleshooting procedures
```

## 🚀 Quick Start

### Prerequisites
- Azure CLI (`az`) installed and configured
- Terraform (`>= 1.6.0`) installed
- kubectl installed for Kubernetes management
- jq installed for JSON processing

### 1. Authentication Setup
```bash
# Login to Azure
az login

# Set subscription (if you have multiple)
az account set --subscription "your-subscription-id"

# Create service principal for Terraform (if needed)
az ad sp create-for-rbac --name "ai-answer-ninja-terraform" \
  --role="Contributor" \
  --scopes="/subscriptions/your-subscription-id"
```

### 2. Environment Configuration
```bash
# Clone the repository
git clone <repository-url>
cd ai-answer-ninja/infrastructure

# Copy and customize environment configuration
cp terraform/environments/dev/terraform.tfvars.example terraform/environments/dev/terraform.tfvars

# Edit the configuration file
vim terraform/environments/dev/terraform.tfvars
```

### 3. Deploy Infrastructure
```bash
# Deploy to development environment
./scripts/deploy.sh -e dev

# Deploy to staging environment  
./scripts/deploy.sh -e staging

# Deploy to production (with confirmation prompts)
./scripts/deploy.sh -e prod

# Deploy with auto-approval (use carefully)
./scripts/deploy.sh -e prod --auto-approve
```

## 🎯 Environment Configurations

### Development Environment
- **Purpose**: Feature development and testing
- **Scale**: Minimal resources for cost optimization
- **Security**: Relaxed for development convenience
- **Cost**: ~$200/month

Key characteristics:
- Single AKS node (Standard_D2s_v3)
- Basic-tier PostgreSQL (B_Standard_B1ms)
- No high availability or geo-replication
- Open network access for development

### Staging Environment  
- **Purpose**: Pre-production testing and QA
- **Scale**: Medium resources mimicking production
- **Security**: Production-like with some relaxations
- **Cost**: ~$800/month

Key characteristics:
- 3 AKS nodes (Standard_D4s_v3) with auto-scaling
- General Purpose PostgreSQL with backup
- Redis Standard tier
- Private cluster with controlled access

### Production Environment
- **Purpose**: Live customer-facing services
- **Scale**: High availability with auto-scaling
- **Security**: Maximum security and compliance
- **Cost**: ~$3000/month

Key characteristics:
- 6+ AKS nodes (Standard_D8s_v3) with extensive auto-scaling
- High-performance PostgreSQL with geo-replication
- Redis Premium with clustering
- Multi-region deployment with disaster recovery
- Advanced monitoring and alerting

## 🔧 Infrastructure Features

### Auto-Scaling Configuration
```yaml
AKS Auto-scaling:
  - Cluster Autoscaler: 3-50 nodes
  - Horizontal Pod Autoscaler: CPU/Memory based
  - Vertical Pod Autoscaler: Enabled (staging/prod)
  - Node Pools: Default, AI/ML (GPU), Memory-intensive, Spot instances

Database Auto-scaling:
  - PostgreSQL: Compute scaling based on load
  - Redis: Memory-based scaling
  - Storage: Auto-expand when needed
```

### Security Features
```yaml
Network Security:
  - Private AKS clusters
  - Network Security Groups (NSGs)
  - Azure Bastion for secure access
  - Web Application Firewall (WAF)

Identity & Access:
  - Azure AD integration
  - Managed Service Identity (MSI)
  - Role-Based Access Control (RBAC)
  - Key Vault for secrets management

Data Protection:
  - Encryption at rest and in transit
  - Automated backups with 35-day retention
  - Geo-redundant storage
  - Private endpoints for databases
```

### Cost Optimization
```yaml
Automated Cost Management:
  - Reserved Instances recommendations
  - Spot instances for non-critical workloads
  - Auto-shutdown for development environments
  - Storage lifecycle management
  - Budget alerts and anomaly detection

Cost Monitoring:
  - Daily cost exports and analysis
  - Resource tagging for cost allocation
  - Unused resource detection
  - Right-sizing recommendations
```

## 🔄 CI/CD Integration

### GitHub Actions Workflow
The infrastructure includes a comprehensive CI/CD pipeline:

1. **Validation**: Terraform format, validation, and security scanning
2. **Cost Estimation**: Infracost integration for cost impact analysis
3. **Planning**: Terraform plan generation and review
4. **Approval**: Manual approval process for production deployments
5. **Deployment**: Automated infrastructure provisioning
6. **Verification**: Post-deployment health checks and validation
7. **Notification**: Slack notifications for deployment status

### Pipeline Triggers
- **Push to main**: Deploys to production (with approval)
- **Push to develop**: Deploys to staging
- **Pull requests**: Runs validation and planning
- **Manual dispatch**: Deploy to any environment

## 📊 Monitoring and Alerting

### Monitoring Stack
- **Azure Monitor**: Core monitoring platform
- **Application Insights**: Application performance monitoring
- **Log Analytics**: Centralized logging and querying
- **Grafana** (optional): Custom dashboards and visualization

### Alert Categories
```yaml
Critical Alerts (P1):
  - Service unavailable
  - Database connection failures
  - SSL certificate expiration
  - High error rates (>5%)

Warning Alerts (P2):
  - High resource usage (CPU >80%, Memory >85%)
  - Slow response times (>2 seconds)
  - Pod restart loops
  - Storage space warnings

Cost Alerts:
  - Budget threshold exceeded (50%, 80%, 100%)
  - Cost anomaly detection
  - Unused resource notifications
```

### Key Metrics
- **SLA Metrics**: 99.9% uptime target
- **Performance**: Response time <1.5s (P95)
- **Reliability**: Error rate <2%
- **Scalability**: Auto-scale 2-50 nodes
- **Cost**: Monthly budget tracking and optimization

## 🚨 Disaster Recovery

### RTO/RPO Objectives
- **RTO (Recovery Time Objective)**: 15 minutes
- **RPO (Recovery Point Objective)**: 5 minutes

### DR Components
- **Traffic Manager**: Automatic DNS failover
- **Database Replication**: PostgreSQL read replicas in secondary region
- **Geo-Redundant Storage**: Cross-region data replication
- **Automation Runbooks**: Automated failover and failback procedures

### DR Testing
- **Monthly DR drills**: Automated testing on first Sunday of each month
- **Quarterly full simulations**: Complete disaster recovery exercises
- **Continuous monitoring**: Health probes and automated alerting

## 💰 Cost Management

### Cost Breakdown (Production)
```yaml
Monthly Cost Estimate (~$3000):
  - AKS Cluster: ~$1200 (40%)
  - PostgreSQL Database: ~$800 (27%)
  - Storage Accounts: ~$300 (10%)
  - Redis Cache: ~$400 (13%)
  - Networking/Traffic Manager: ~$200 (7%)
  - Monitoring/Logging: ~$100 (3%)
```

### Cost Optimization Strategies
1. **Reserved Instances**: 30-50% savings on predictable workloads
2. **Spot Instances**: 60-90% savings for fault-tolerant workloads
3. **Auto-scaling**: Right-size resources based on demand
4. **Storage Tiering**: Automated lifecycle management
5. **Dev Environment Shutdown**: Automatic after-hours shutdown

## 🔒 Security and Compliance

### Security Standards
- **SOC 2 Type II**: Security controls and monitoring
- **ISO 27001**: Information security management
- **GDPR**: Data protection and privacy compliance
- **Azure Security Benchmark**: Industry best practices

### Compliance Features
- **Data encryption**: AES-256 encryption for data at rest
- **Network isolation**: Private endpoints and VNet integration
- **Access logging**: Comprehensive audit trails
- **Backup and retention**: Automated backup with compliance retention
- **Vulnerability scanning**: Continuous security assessment

## 📚 Documentation

### Available Documentation
- **[Operations Handbook](docs/OPERATIONS_HANDBOOK.md)**: Complete operational procedures
- **[Troubleshooting Guide](docs/TROUBLESHOOTING_GUIDE.md)**: Issue diagnosis and resolution
- **Architecture Diagrams**: Visual system architecture reference
- **Runbooks**: Step-by-step operational procedures

### Getting Help
- **Internal Documentation**: Check the docs/ directory
- **Azure Documentation**: https://docs.microsoft.com/azure/
- **Terraform Documentation**: https://registry.terraform.io/providers/hashicorp/azurerm/
- **On-call Support**: Contact information in operations handbook

## 🤝 Contributing

### Development Workflow
1. Create feature branch from `develop`
2. Make infrastructure changes
3. Test in development environment
4. Submit pull request with:
   - Terraform plan output
   - Security scan results
   - Cost impact analysis
5. Code review and approval
6. Automated deployment to staging
7. Manual promotion to production

### Best Practices
- **Infrastructure as Code**: All changes through Terraform
- **Version Control**: Track all infrastructure changes
- **Testing**: Validate changes in lower environments first
- **Documentation**: Update documentation with changes
- **Security**: Follow security scanning and approval processes

## 📞 Support and Contacts

### Emergency Contacts
- **On-call Engineer**: +86-138-0013-8000
- **DevOps Team**: devops@company.com
- **Engineering Manager**: eng-manager@company.com

### Escalation Matrix
1. **Level 1**: On-call engineer (0-15 minutes)
2. **Level 2**: Team lead (15-30 minutes)  
3. **Level 3**: Engineering manager (30-60 minutes)
4. **Level 4**: VP Engineering (60+ minutes)

---

**Infrastructure Version**: 1.0
**Last Updated**: 2024-08-12
**Maintained by**: DevOps Team