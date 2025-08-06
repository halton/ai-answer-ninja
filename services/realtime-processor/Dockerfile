# Multi-stage build for production optimization
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    libc6-compat

# Copy package files
COPY package.json package-lock.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production --ignore-scripts

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install security updates
RUN apk update && apk upgrade

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Set working directory
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    dumb-init \
    ca-certificates \
    tzdata \
    curl \
    && rm -rf /var/cache/apk/*

# Copy package files and install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist

# Create necessary directories
RUN mkdir -p /app/logs /app/storage/audio && \
    chown -R nextjs:nodejs /app

# Copy health check script
COPY --chown=nextjs:nodejs scripts/healthcheck.sh ./healthcheck.sh
RUN chmod +x ./healthcheck.sh

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3002

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ./healthcheck.sh || exit 1

# Set environment variables
ENV NODE_ENV=production \
    PORT=3002 \
    HOST=0.0.0.0

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/server.js"]

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
COPY package.json package-lock.json tsconfig.json ./

# Install all dependencies
RUN npm ci

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