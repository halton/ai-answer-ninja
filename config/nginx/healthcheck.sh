#!/bin/sh

# AI Answer Ninja - Nginx Health Check Script
# Comprehensive health check for load balancer

set -e

# Check if nginx is running
if ! pgrep nginx > /dev/null; then
    echo "FAIL: Nginx process not found"
    exit 1
fi

# Check if nginx is responding to HTTP requests
if ! curl -sf http://localhost/health > /dev/null; then
    echo "FAIL: Nginx not responding to HTTP requests"
    exit 1
fi

# Check if consul-template is running (if CONSUL_URL is set)
if [ -n "$CONSUL_URL" ]; then
    if ! pgrep consul-template > /dev/null; then
        echo "WARN: Consul-template process not found, but continuing..."
    fi
fi

# Check upstream configuration exists
if [ ! -f /etc/nginx/conf.d/upstream.conf ]; then
    echo "WARN: Upstream configuration not found, using static configuration"
fi

# All checks passed
echo "OK: All health checks passed"
exit 0