# Multi-stage build for Storage Service
FROM node:18-alpine AS builder

# Install build dependencies for multimedia processing
RUN apk add --no-cache \
    ffmpeg-dev \
    python3 \
    make \
    g++ \
    pkgconfig \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    librsvg-dev \
    git

WORKDIR /app

# Copy package files for dependency caching
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies for build
RUN npm ci --ignore-scripts

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
    imagemagick \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Create storage directories with proper permissions
RUN mkdir -p \
    /app/storage/uploads \
    /app/storage/temp \
    /app/storage/audio \
    /app/storage/archive \
    /app/logs && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3008

# Enhanced health check with storage verification
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3008/health || exit 1

# Set environment variables
ENV NODE_ENV=production \
    PORT=3008 \
    HOST=0.0.0.0

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the storage service
CMD ["node", "dist/index.js"]