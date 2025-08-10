# Multi-stage build for Smart Whitelist Service
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S smartwhitelist -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=smartwhitelist:nodejs /app/dist ./dist

# Create logs directory
RUN mkdir -p logs && chown smartwhitelist:nodejs logs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3006/health/ready || exit 1

# Switch to non-root user
USER smartwhitelist

# Expose port
EXPOSE 3006

# Set environment
ENV NODE_ENV=production

# Start the application
CMD ["node", "dist/server.js"]