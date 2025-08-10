# AI Answer Ninja - User Management Service Dockerfile
# Multi-stage build for optimized production image

# ===========================================
# Build Stage
# ===========================================
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma/ ./prisma/

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# ===========================================
# Production Stage
# ===========================================
FROM node:18-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache \
    dumb-init \
    curl

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Copy additional configuration files
COPY --chown=nodejs:nodejs .env.example ./.env.example

# Create logs directory
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3005/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/server.js"]

# ===========================================
# Development Stage (for docker-compose)
# ===========================================
FROM node:18-alpine AS development

# Install development dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat \
    curl

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Create logs directory
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app

# Switch to non-root user  
USER nodejs

# Expose port
EXPOSE 3005

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3005/health || exit 1

# Start in development mode
CMD ["npm", "run", "dev"]

# ===========================================
# Testing Stage
# ===========================================
FROM development AS testing

# Install test dependencies and tools
RUN npm install -g jest ts-node @types/jest

# Copy test files
COPY tests/ ./tests/ 2>/dev/null || true

# Set test environment
ENV NODE_ENV=test

# Health check for testing
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3005/health || exit 1

# Start in test mode
CMD ["npm", "run", "test"]