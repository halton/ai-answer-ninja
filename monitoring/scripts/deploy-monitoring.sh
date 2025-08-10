#!/bin/bash

# AI Answer Ninja - Production Monitoring Deployment Script
# This script deploys the complete monitoring stack for the AI Answer Ninja system

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITORING_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$MONITORING_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Configuration
ENVIRONMENT="${1:-development}"
COMPOSE_FILE="${MONITORING_DIR}/docker-compose.monitoring.yml"
ENV_FILE="${MONITORING_DIR}/.env.monitoring"

# Check if running as root (not recommended for Docker)
check_privileges() {
    if [[ $EUID -eq 0 ]]; then
        log_warning "Running as root is not recommended. Consider using a non-root user with Docker privileges."
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_error "Deployment cancelled."
            exit 1
        fi
    fi
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing_tools=()
    
    # Check for required tools
    for tool in docker docker-compose curl jq; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        log_error "Please install the missing tools and try again."
        exit 1
    fi
    
    # Check Docker daemon
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running or not accessible."
        exit 1
    fi
    
    # Check Docker Compose version
    local compose_version
    compose_version=$(docker-compose --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    local required_version="2.0.0"
    
    if [[ "$(printf '%s\n' "$required_version" "$compose_version" | sort -V | head -n1)" != "$required_version" ]]; then
        log_error "Docker Compose version $compose_version is too old. Required: $required_version or newer."
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Load environment configuration
load_environment() {
    log_info "Loading environment configuration for: $ENVIRONMENT"
    
    # Default environment file
    if [[ ! -f "$ENV_FILE" ]]; then
        log_info "Creating default environment file..."
        cat > "$ENV_FILE" << EOF
# AI Answer Ninja Monitoring Configuration

# Environment
ENVIRONMENT=$ENVIRONMENT
DEPLOY_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Grafana Configuration
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=admin123!@#
GRAFANA_API_KEY=

# Database Configuration
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=ai_ninja
POSTGRES_USER=ai_ninja
POSTGRES_PASSWORD=ai_ninja_monitoring_2025

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=redis_monitoring_2025

# SMTP Configuration for Alerts
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@company.com
SMTP_PASSWORD=
SMTP_FROM=alerts@company.com

# Slack Integration
SLACK_WEBHOOK_URL=

# Azure Monitoring Configuration
AZURE_SUBSCRIPTION_ID=
AZURE_SPEECH_ENDPOINT=
AZURE_OPENAI_ENDPOINT=

# Nginx Configuration
NGINX_HOST=nginx

# Security
MONITORING_API_KEY=$(openssl rand -hex 32)
PROMETHEUS_AUTH_TOKEN=$(openssl rand -hex 16)
GRAFANA_SECRET_KEY=$(openssl rand -hex 32)

EOF
        log_warning "Default environment file created at $ENV_FILE"
        log_warning "Please review and update the configuration before proceeding."
        log_warning "Pay special attention to passwords and API keys."
    fi
    
    # Load environment variables
    if [[ -f "$ENV_FILE" ]]; then
        set -a
        source "$ENV_FILE"
        set +a
        log_success "Environment configuration loaded"
    else
        log_error "Environment file not found: $ENV_FILE"
        exit 1
    fi
}

# Create required directories
create_directories() {
    log_info "Creating required directories..."
    
    local directories=(
        "$MONITORING_DIR/data/prometheus"
        "$MONITORING_DIR/data/grafana"
        "$MONITORING_DIR/data/alertmanager"
        "$MONITORING_DIR/data/elasticsearch"
        "$MONITORING_DIR/logs"
        "$MONITORING_DIR/backups"
        "$MONITORING_DIR/ssl"
    )
    
    for dir in "${directories[@]}"; do
        mkdir -p "$dir"
        chmod 755 "$dir"
    done
    
    # Set correct ownership for Grafana data
    if [[ -d "$MONITORING_DIR/data/grafana" ]]; then
        sudo chown -R 472:472 "$MONITORING_DIR/data/grafana" 2>/dev/null || {
            log_warning "Could not set Grafana directory ownership. This may cause issues."
        }
    fi
    
    log_success "Directories created successfully"
}

# Generate SSL certificates for monitoring services
generate_ssl_certificates() {
    log_info "Checking SSL certificates..."
    
    local ssl_dir="$MONITORING_DIR/ssl"
    local cert_file="$ssl_dir/monitoring.crt"
    local key_file="$ssl_dir/monitoring.key"
    
    if [[ ! -f "$cert_file" || ! -f "$key_file" ]]; then
        log_info "Generating self-signed SSL certificates..."
        
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$key_file" \
            -out "$cert_file" \
            -subj "/C=US/ST=State/L=City/O=AI-Ninja/CN=monitoring.ai-ninja.local" \
            -config <(
                echo '[distinguished_name]'
                echo '[req]'
                echo 'distinguished_name = distinguished_name'
                echo '[v3_req]'
                echo 'keyUsage = keyEncipherment, dataEncipherment'
                echo 'extendedKeyUsage = serverAuth'
                echo 'subjectAltName = @alt_names'
                echo '[alt_names]'
                echo 'DNS.1 = monitoring.ai-ninja.local'
                echo 'DNS.2 = localhost'
                echo 'IP.1 = 127.0.0.1'
            ) -extensions v3_req
        
        chmod 600 "$key_file"
        chmod 644 "$cert_file"
        
        log_success "SSL certificates generated"
    else
        log_success "SSL certificates already exist"
    fi
}

# Setup Grafana provisioning
setup_grafana_provisioning() {
    log_info "Setting up Grafana provisioning..."
    
    local provisioning_dir="$MONITORING_DIR/grafana/provisioning"
    
    # Create datasources configuration
    mkdir -p "$provisioning_dir/datasources"
    cat > "$provisioning_dir/datasources/prometheus.yml" << EOF
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
    jsonData:
      timeInterval: "15s"
      queryTimeout: "60s"
      httpMethod: GET
    
  - name: Jaeger
    type: jaeger
    access: proxy
    url: http://jaeger:16686
    editable: false
    
  - name: Elasticsearch-Logs
    type: elasticsearch
    access: proxy
    url: http://elasticsearch:9200
    database: logstash-*
    jsonData:
      interval: Daily
      timeField: "@timestamp"
      esVersion: "8.0.0"
    editable: false

  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    editable: false
EOF

    # Create dashboards configuration
    mkdir -p "$provisioning_dir/dashboards"
    cat > "$provisioning_dir/dashboards/default.yml" << EOF
apiVersion: 1

providers:
  - name: 'AI Ninja Dashboards'
    orgId: 1
    folder: 'AI Ninja'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
EOF

    log_success "Grafana provisioning configured"
}

# Setup Alertmanager configuration
setup_alertmanager() {
    log_info "Setting up Alertmanager configuration..."
    
    cat > "$MONITORING_DIR/alertmanager.yml" << EOF
global:
  smtp_smarthost: '${SMTP_HOST}:${SMTP_PORT}'
  smtp_from: '${SMTP_FROM}'
  smtp_auth_username: '${SMTP_USER}'
  smtp_auth_password: '${SMTP_PASSWORD}'
  slack_api_url: '${SLACK_WEBHOOK_URL}'

route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 24h
  receiver: 'web.hook'
  routes:
    - match:
        severity: critical
      receiver: 'critical-alerts'
      group_wait: 10s
      repeat_interval: 5m
    - match:
        severity: warning
      receiver: 'warning-alerts'
      group_wait: 1m
      repeat_interval: 1h
    - match:
        alertname: 'Watchdog'
      receiver: 'null'

receivers:
  - name: 'web.hook'
    webhook_configs:
      - url: 'http://monitoring-service:3009/api/alerts/webhook'
        send_resolved: true

  - name: 'critical-alerts'
    email_configs:
      - to: 'sre-team@company.com'
        subject: '🚨 CRITICAL: {{ .GroupLabels.alertname }} in {{ .GroupLabels.service }}'
        body: |
          Critical alert fired in AI Answer Ninja system.
          
          Alert: {{ .GroupLabels.alertname }}
          Service: {{ .GroupLabels.service }}
          Severity: {{ .GroupLabels.severity }}
          
          {{ range .Alerts }}
          - {{ .Annotations.summary }}
            {{ .Annotations.description }}
            Impact: {{ .Annotations.impact }}
            Action: {{ .Annotations.action }}
            Dashboard: {{ .Annotations.dashboard_url }}
          {{ end }}
    slack_configs:
      - channel: '#ai-ninja-alerts'
        color: danger
        title: '🚨 CRITICAL Alert'
        text: |
          *Alert:* {{ .GroupLabels.alertname }}
          *Service:* {{ .GroupLabels.service }}
          *Environment:* $ENVIRONMENT
          {{ range .Alerts }}
          *Summary:* {{ .Annotations.summary }}
          *Impact:* {{ .Annotations.impact }}
          {{ if .Annotations.dashboard_url }}*Dashboard:* {{ .Annotations.dashboard_url }}{{ end }}
          {{ end }}

  - name: 'warning-alerts'
    email_configs:
      - to: 'dev-team@company.com'
        subject: '⚠️  WARNING: {{ .GroupLabels.alertname }} in {{ .GroupLabels.service }}'
        body: |
          Warning alert in AI Answer Ninja system.
          
          Alert: {{ .GroupLabels.alertname }}
          Service: {{ .GroupLabels.service }}
          
          {{ range .Alerts }}
          - {{ .Annotations.summary }}
            {{ .Annotations.description }}
          {{ end }}
    slack_configs:
      - channel: '#ai-ninja-alerts'
        color: warning
        title: '⚠️  Warning Alert'
        text: |
          *Alert:* {{ .GroupLabels.alertname }}
          *Service:* {{ .GroupLabels.service }}
          {{ range .Alerts }}
          *Summary:* {{ .Annotations.summary }}
          {{ end }}

  - name: 'null'
    # Null receiver for silencing alerts

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'service', 'instance']

templates:
  - '/etc/alertmanager/templates/*.tmpl'
EOF

    log_success "Alertmanager configuration created"
}

# Setup Blackbox exporter configuration
setup_blackbox_exporter() {
    log_info "Setting up Blackbox exporter configuration..."
    
    cat > "$MONITORING_DIR/blackbox.yml" << EOF
modules:
  http_2xx:
    prober: http
    timeout: 5s
    http:
      valid_http_versions: ["HTTP/1.1", "HTTP/2.0"]
      valid_status_codes: [200]
      method: GET
      follow_redirects: true
      preferred_ip_protocol: "ip4"

  http_post_2xx:
    prober: http
    timeout: 5s
    http:
      valid_http_versions: ["HTTP/1.1", "HTTP/2.0"]
      valid_status_codes: [200]
      method: POST
      headers:
        Content-Type: application/json

  tcp_connect:
    prober: tcp
    timeout: 5s

  dns_query:
    prober: dns
    timeout: 5s
    dns:
      query_name: "ai-ninja.local"
      query_type: "A"
EOF

    log_success "Blackbox exporter configuration created"
}

# Setup Logstash pipeline
setup_logstash_pipeline() {
    log_info "Setting up Logstash pipeline..."
    
    local pipeline_dir="$MONITORING_DIR/logstash/pipeline"
    local config_dir="$MONITORING_DIR/logstash/config"
    
    mkdir -p "$pipeline_dir" "$config_dir"
    
    # Main Logstash configuration
    cat > "$config_dir/logstash.yml" << EOF
http.host: "0.0.0.0"
xpack.monitoring.elasticsearch.hosts: ["http://elasticsearch:9200"]
pipeline.workers: 2
pipeline.batch.size: 125
pipeline.batch.delay: 50
EOF

    # Pipeline configuration
    cat > "$pipeline_dir/ai-ninja-logs.conf" << EOF
input {
  beats {
    port => 5044
  }
  
  tcp {
    port => 5000
    codec => json
  }
  
  http {
    port => 8080
    codec => json
  }
}

filter {
  # Parse JSON logs
  if [message] =~ /^\{/ {
    json {
      source => "message"
    }
  }
  
  # Add common fields
  mutate {
    add_field => { "environment" => "$ENVIRONMENT" }
    add_field => { "system" => "ai-ninja" }
  }
  
  # Parse AI service logs
  if [service] =~ /^(phone-gateway|realtime-processor|conversation-engine|profile-analytics)$/ {
    mutate {
      add_tag => ["ai-core-service"]
    }
  }
  
  # Parse error logs
  if [level] == "error" or [log_level] == "ERROR" {
    mutate {
      add_tag => ["error"]
      add_field => { "alert_priority" => "high" }
    }
  }
  
  # Parse performance logs
  if [response_time] {
    mutate {
      convert => { "response_time" => "float" }
    }
    
    if [response_time] > 1000 {
      mutate {
        add_tag => ["slow-response"]
      }
    }
  }
  
  # GeoIP for external requests
  if [client_ip] {
    geoip {
      source => "client_ip"
      target => "geoip"
    }
  }
}

output {
  elasticsearch {
    hosts => ["http://elasticsearch:9200"]
    index => "ai-ninja-logs-%{+YYYY.MM.dd}"
    template_name => "ai-ninja"
    template_pattern => "ai-ninja-*"
    template => {
      "mappings" => {
        "properties" => {
          "@timestamp" => { "type" => "date" }
          "level" => { "type" => "keyword" }
          "service" => { "type" => "keyword" }
          "message" => { "type" => "text" }
          "response_time" => { "type" => "float" }
          "user_id" => { "type" => "keyword" }
          "call_id" => { "type" => "keyword" }
          "trace_id" => { "type" => "keyword" }
        }
      }
    }
  }
  
  # Output errors to separate index
  if "error" in [tags] {
    elasticsearch {
      hosts => ["http://elasticsearch:9200"]
      index => "ai-ninja-errors-%{+YYYY.MM.dd}"
    }
  }
  
  # Debug output (remove in production)
  # stdout { codec => rubydebug }
}
EOF

    log_success "Logstash pipeline configured"
}

# Setup monitoring proxy
setup_monitoring_proxy() {
    log_info "Setting up monitoring proxy..."
    
    local nginx_dir="$MONITORING_DIR/nginx"
    mkdir -p "$nginx_dir"
    
    cat > "$nginx_dir/monitoring.conf" << EOF
# AI Answer Ninja - Monitoring Proxy Configuration

upstream prometheus {
    server prometheus:9090;
}

upstream grafana {
    server grafana:3000;
}

upstream alertmanager {
    server alertmanager:9093;
}

upstream jaeger {
    server jaeger:16686;
}

upstream kibana {
    server kibana:5601;
}

upstream monitoring_service {
    server monitoring-service:3009;
}

# Health check endpoint
server {
    listen 80;
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}

# Main monitoring interface
server {
    listen 80;
    listen 443 ssl http2;
    server_name monitoring.ai-ninja.local localhost;

    # SSL configuration
    ssl_certificate /etc/nginx/ssl/monitoring.crt;
    ssl_certificate_key /etc/nginx/ssl/monitoring.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";

    # Root - Monitoring dashboard
    location / {
        return 302 /grafana/;
    }

    # Grafana
    location /grafana/ {
        proxy_pass http://grafana/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Prometheus
    location /prometheus/ {
        proxy_pass http://prometheus/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Alertmanager
    location /alertmanager/ {
        proxy_pass http://alertmanager/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Jaeger
    location /jaeger/ {
        proxy_pass http://jaeger/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Kibana
    location /kibana/ {
        proxy_pass http://kibana/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Increase timeouts for Kibana
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Monitoring Service API
    location /api/ {
        proxy_pass http://monitoring_service/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # API-specific headers
        proxy_set_header Content-Type application/json;
        
        # CORS headers
        add_header Access-Control-Allow-Origin "*";
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS";
        add_header Access-Control-Allow-Headers "DNT,X-CustomHeader,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization";
    }
}
EOF

    log_success "Monitoring proxy configured"
}

# Deploy monitoring stack
deploy_stack() {
    log_info "Deploying monitoring stack..."
    
    # Pull latest images
    log_info "Pulling Docker images..."
    docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull
    
    # Start core infrastructure first
    log_info "Starting core infrastructure..."
    docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d \
        elasticsearch \
        consul \
        prometheus \
        pushgateway
    
    # Wait for Elasticsearch to be ready
    log_info "Waiting for Elasticsearch to be ready..."
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -sf http://localhost:9200/_cluster/health &>/dev/null; then
            log_success "Elasticsearch is ready"
            break
        fi
        
        log_info "Attempt $attempt/$max_attempts: Waiting for Elasticsearch..."
        sleep 10
        ((attempt++))
    done
    
    if [[ $attempt -gt $max_attempts ]]; then
        log_error "Elasticsearch failed to start within expected time"
        exit 1
    fi
    
    # Start remaining services
    log_info "Starting remaining services..."
    docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
    
    log_success "Monitoring stack deployed"
}

# Wait for services to be ready
wait_for_services() {
    log_info "Waiting for services to be ready..."
    
    local services=(
        "http://localhost:9090/-/ready:Prometheus"
        "http://localhost:3000/api/health:Grafana"
        "http://localhost:9093/-/ready:Alertmanager"
        "http://localhost:16686/:Jaeger"
        "http://localhost:5601/api/status:Kibana"
        "http://localhost:3009/health:Monitoring Service"
    )
    
    local max_wait=300 # 5 minutes
    local start_time=$(date +%s)
    
    for service_info in "${services[@]}"; do
        local url="${service_info%:*}"
        local name="${service_info#*:}"
        
        log_info "Checking $name..."
        
        while true; do
            local current_time=$(date +%s)
            local elapsed=$((current_time - start_time))
            
            if [[ $elapsed -gt $max_wait ]]; then
                log_error "Timeout waiting for $name to be ready"
                exit 1
            fi
            
            if curl -sf "$url" &>/dev/null; then
                log_success "$name is ready"
                break
            fi
            
            sleep 5
        done
    done
    
    log_success "All services are ready"
}

# Setup initial data and dashboards
setup_initial_data() {
    log_info "Setting up initial data and dashboards..."
    
    # Import Grafana dashboards
    local dashboard_files=(
        "$MONITORING_DIR/grafana/dashboards/executive-overview.json"
        "$MONITORING_DIR/grafana/dashboards/real-time-operations.json"
        "$MONITORING_DIR/grafana/dashboards/infrastructure-deep-dive.json"
    )
    
    for dashboard_file in "${dashboard_files[@]}"; do
        if [[ -f "$dashboard_file" ]]; then
            local dashboard_name=$(basename "$dashboard_file" .json)
            log_info "Importing dashboard: $dashboard_name"
            
            # Import via API (requires Grafana to be ready)
            curl -sf -X POST \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer ${GRAFANA_API_KEY:-admin:admin123}" \
                -d @"$dashboard_file" \
                "http://localhost:3000/api/dashboards/db" &>/dev/null || {
                log_warning "Failed to import dashboard: $dashboard_name"
            }
        fi
    done
    
    log_success "Initial data setup completed"
}

# Run health checks
run_health_checks() {
    log_info "Running health checks..."
    
    local failed_checks=()
    
    # Check service health endpoints
    local health_checks=(
        "http://localhost:9090/-/healthy:Prometheus"
        "http://localhost:3000/api/health:Grafana"
        "http://localhost:9093/-/healthy:Alertmanager"
        "http://localhost:9200/_cluster/health:Elasticsearch"
        "http://localhost:3009/health:Monitoring Service"
    )
    
    for check in "${health_checks[@]}"; do
        local url="${check%:*}"
        local name="${check#*:}"
        
        if curl -sf "$url" &>/dev/null; then
            log_success "$name health check passed"
        else
            log_error "$name health check failed"
            failed_checks+=("$name")
        fi
    done
    
    # Check Docker containers
    local containers=$(docker-compose -f "$COMPOSE_FILE" ps --services)
    for container in $containers; do
        local status
        status=$(docker-compose -f "$COMPOSE_FILE" ps "$container" --format "table {{.Status}}" | tail -n +2)
        
        if [[ "$status" == *"Up"* ]]; then
            log_success "Container $container is running"
        else
            log_error "Container $container is not running properly: $status"
            failed_checks+=("$container")
        fi
    done
    
    if [[ ${#failed_checks[@]} -gt 0 ]]; then
        log_error "Health checks failed for: ${failed_checks[*]}"
        log_error "Please check the logs: docker-compose -f $COMPOSE_FILE logs [service_name]"
        exit 1
    else
        log_success "All health checks passed"
    fi
}

# Display deployment information
show_deployment_info() {
    log_success "Monitoring stack deployment completed successfully!"
    
    echo
    echo "============================================"
    echo "     AI Answer Ninja Monitoring Stack     "
    echo "============================================"
    echo
    echo "Environment: $ENVIRONMENT"
    echo "Deployed at: $(date)"
    echo
    echo "📊 Monitoring Interfaces:"
    echo "  • Main Portal:    http://localhost:8080"
    echo "  • Grafana:        http://localhost:3000 (admin/${GRAFANA_ADMIN_PASSWORD:-admin123})"
    echo "  • Prometheus:     http://localhost:9090"
    echo "  • Alertmanager:   http://localhost:9093"
    echo "  • Jaeger:         http://localhost:16686"
    echo "  • Kibana:         http://localhost:5601"
    echo "  • Elasticsearch:  http://localhost:9200"
    echo
    echo "🔧 Management:"
    echo "  • Consul:         http://localhost:8500"
    echo "  • Monitoring API: http://localhost:3009"
    echo
    echo "📈 Key Dashboards:"
    echo "  • Executive Overview:     http://localhost:3000/d/executive-overview"
    echo "  • Real-time Operations:   http://localhost:3000/d/real-time-operations" 
    echo "  • Infrastructure:         http://localhost:3000/d/infrastructure-deep-dive"
    echo
    echo "🔔 Alert Channels:"
    echo "  • Slack:    ${SLACK_WEBHOOK_URL:+✓ Configured}"
    echo "  • Email:    ${SMTP_USER:+✓ Configured}"
    echo "  • Webhook:  ✓ Configured"
    echo
    echo "📁 Important Paths:"
    echo "  • Configuration: $MONITORING_DIR"
    echo "  • Data:          $MONITORING_DIR/data"
    echo "  • Logs:          $MONITORING_DIR/logs"
    echo "  • Backups:       $MONITORING_DIR/backups"
    echo
    echo "🔧 Useful Commands:"
    echo "  • View logs:     docker-compose -f $COMPOSE_FILE logs [service]"
    echo "  • Restart:       docker-compose -f $COMPOSE_FILE restart [service]"
    echo "  • Scale:         docker-compose -f $COMPOSE_FILE up -d --scale [service]=N"
    echo "  • Stop all:      docker-compose -f $COMPOSE_FILE down"
    echo "  • Update:        ./deploy-monitoring.sh $ENVIRONMENT"
    echo
    echo "⚠️  Remember to:"
    echo "  • Update default passwords in $ENV_FILE"
    echo "  • Configure notification channels"
    echo "  • Set up SSL certificates for production"
    echo "  • Schedule regular backups"
    echo "  • Monitor disk space usage"
    echo
}

# Cleanup function
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        log_error "Deployment failed with exit code $exit_code"
        log_info "Cleaning up partial deployment..."
        
        # Stop any running containers
        docker-compose -f "$COMPOSE_FILE" down &>/dev/null || true
        
        log_info "Partial cleanup completed"
        log_info "Check logs for more details: docker-compose -f $COMPOSE_FILE logs"
    fi
    exit $exit_code
}

# Set trap for cleanup
trap cleanup EXIT

# Main deployment flow
main() {
    echo "============================================"
    echo "  AI Answer Ninja Monitoring Deployment   "
    echo "============================================"
    echo
    echo "Environment: $ENVIRONMENT"
    echo "Started at: $(date)"
    echo
    
    check_privileges
    check_prerequisites
    load_environment
    create_directories
    generate_ssl_certificates
    setup_grafana_provisioning
    setup_alertmanager
    setup_blackbox_exporter
    setup_logstash_pipeline
    setup_monitoring_proxy
    deploy_stack
    wait_for_services
    setup_initial_data
    run_health_checks
    show_deployment_info
    
    log_success "Deployment completed successfully! 🎉"
}

# Run main function
main "$@"