#!/bin/sh

# Health check script for monitoring service
set -e

# Check if the service is responding
curl -f http://localhost:3009/health || exit 1

# Check if metrics endpoint is working
curl -f http://localhost:3009/metrics || exit 1

# Check if the service can connect to dependencies
curl -f http://localhost:3009/health/dependencies || exit 1

echo "Health check passed"