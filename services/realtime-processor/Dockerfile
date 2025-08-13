# Multi-stage build for production optimization
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies including audio processing libs
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    libc6-compat \
    ffmpeg-dev \
    sox-dev

# Copy package files for dependency caching
COPY package.json ./
COPY tsconfig.json ./
COPY package-lock*.json ./

# Install all dependencies for build
RUN npm ci --ignore-scripts || npm install

# Copy source code
COPY src/ ./src/

# Build the application with optimizations
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install security updates and runtime dependencies
RUN apk update && apk upgrade && \
    apk add --no-cache \
    dumb-init \
    ca-certificates \
    tzdata \
    curl \
    ffmpeg \
    sox \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package.json ./
COPY package-lock*.json ./
RUN npm ci --only=production --ignore-scripts || npm install --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Create necessary directories with proper permissions
RUN mkdir -p /app/logs /app/storage/audio /app/temp && \
    chown -R nodejs:nodejs /app

# Copy health check script
COPY --chown=nodejs:nodejs scripts/healthcheck.sh ./healthcheck.sh
RUN chmod +x ./healthcheck.sh

# Switch to non-root user
USER nodejs

# Expose ports (HTTP API and WebSocket)
EXPOSE 3002 8080

# Enhanced health check for realtime service
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD ./healthcheck.sh || exit 1

# Set environment variables
ENV NODE_ENV=production \
    PORT=3002 \
    HOST=0.0.0.0 \
    WS_PORT=8080

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the realtime server
CMD ["node", "dist/realtimeServer.js"]

# Development stage
FROM node:18-alpine AS development

WORKDIR /app

# Install development dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    libc6-compat

# Copy package files
COPY package.json tsconfig.json ./
COPY package-lock*.json ./

# Install all dependencies
RUN npm ci || npm install

# Copy source code
COPY . .

# Create directories
RUN mkdir -p logs storage/audio

# Expose port
EXPOSE 3002

# Environment
ENV NODE_ENV=development

# Start with hot reload
CMD ["npm", "run", "dev"]

# Testing stage
FROM development AS testing

# Copy test files
COPY tests/ ./tests/
COPY jest.config.js ./

# Run tests
RUN npm test

# Linting
RUN npm run lint

# Security audit
RUN npm audit --audit-level=moderate