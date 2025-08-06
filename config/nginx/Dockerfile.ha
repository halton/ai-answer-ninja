# Enhanced Nginx with Consul Template for Service Discovery
FROM nginx:alpine

# Install curl and consul-template
RUN apk add --no-cache curl consul-template

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/ /etc/nginx/conf.d/
COPY templates/ /etc/nginx/templates/

# Create directories for logs and SSL
RUN mkdir -p /var/log/nginx /etc/nginx/ssl

# Copy startup script
COPY start-nginx.sh /start-nginx.sh
RUN chmod +x /start-nginx.sh

# Health check script
COPY healthcheck.sh /healthcheck.sh
RUN chmod +x /healthcheck.sh

# Expose ports
EXPOSE 80 443 8080

# Set health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD /healthcheck.sh

# Start nginx with consul-template
CMD ["/start-nginx.sh"]