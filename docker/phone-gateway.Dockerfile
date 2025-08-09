# Phone Gateway Service Dockerfile - Multi-stage build
FROM node:18-alpine AS base

# Install production dependencies
RUN apk add --no-cache dumb-init tzdata curl

# Set working directory
WORKDIR /app

# Copy package files
COPY services/phone-gateway/package*.json ./

# Install dependencies
FROM base AS dependencies
RUN npm ci --only=production && npm cache clean --force

# Development stage
FROM base AS development
RUN npm ci
COPY services/phone-gateway ./
EXPOSE 3001
CMD ["npm", "run", "dev"]

# Build stage
FROM base AS build
RUN npm ci
COPY services/phone-gateway ./
RUN npm run build

# Production stage
FROM base AS production
ENV NODE_ENV=production
ENV PORT=3001

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001

# Copy production dependencies
COPY --from=dependencies /app/node_modules ./node_modules

# Copy built application
COPY --from=build --chown=appuser:nodejs /app/dist ./dist
COPY --from=build --chown=appuser:nodejs /app/package*.json ./

# Health check script
COPY --chown=appuser:nodejs <<EOF /app/healthcheck.js
const http = require('http');

const options = {
  host: 'localhost',
  port: process.env.PORT || 3001,
  path: '/health',
  timeout: 2000,
  method: 'GET'
};

const request = http.request(options, (res) => {
  console.log(\`STATUS: \${res.statusCode}\`);
  process.exitCode = (res.statusCode === 200) ? 0 : 1;
  process.exit();
});

request.on('error', (err) => {
  console.error('ERROR:', err);
  process.exit(1);
});

request.end();
EOF

# Set security headers and limits
RUN chown -R appuser:nodejs /app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD ["node", "/app/healthcheck.js"]

# Start application with dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]