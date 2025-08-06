#!/bin/sh

# AI Answer Ninja - Nginx Startup Script with Service Discovery
# Starts consul-template and nginx with automatic upstream updates

set -e

# Default Consul URL if not provided
CONSUL_URL=${CONSUL_URL:-http://consul:8500}

echo "Starting AI Answer Ninja Load Balancer..."
echo "Consul URL: $CONSUL_URL"

# Wait for Consul to be available
echo "Waiting for Consul to be available..."
until curl -sf $CONSUL_URL/v1/status/leader; do
  echo "Consul not available, retrying in 5 seconds..."
  sleep 5
done

echo "Consul is available. Starting service discovery..."

# Generate initial upstream configuration
consul-template \
  -consul-addr=$CONSUL_URL \
  -template="/etc/nginx/templates/upstream.conf.tpl:/etc/nginx/conf.d/upstream.conf:nginx -s reload" \
  -once

# Start nginx in the background
nginx -g "daemon off;" &
NGINX_PID=$!

# Start consul-template to watch for changes
consul-template \
  -consul-addr=$CONSUL_URL \
  -template="/etc/nginx/templates/upstream.conf.tpl:/etc/nginx/conf.d/upstream.conf:nginx -s reload" &
CONSUL_TEMPLATE_PID=$!

# Function to handle shutdown
shutdown() {
  echo "Shutting down..."
  kill $CONSUL_TEMPLATE_PID 2>/dev/null || true
  kill $NGINX_PID 2>/dev/null || true
  exit 0
}

# Trap signals
trap shutdown TERM INT

# Wait for processes
wait $NGINX_PID