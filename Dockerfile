# Production Dockerfile for Porizo API and integrated web funnel

FROM node:20.19-slim AS web-funnel-builder

WORKDIR /app

COPY web-funnel/package*.json ./web-funnel/
RUN npm ci --prefix web-funnel

COPY web-funnel ./web-funnel
COPY public/styles/main.css ./public/styles/main.css
RUN npm --prefix web-funnel run build

FROM node:20.19-slim

# Install FFmpeg for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy application code
COPY . .

# The funnel is a generated runtime artifact, not a second source deployment.
RUN rm -rf web-funnel
COPY --from=web-funnel-builder /app/web-funnel/dist ./web-funnel/dist

# Create storage directory (will be overridden by S3 in production)
RUN mkdir -p storage

# Expose port (Railway uses PORT env var)
EXPOSE 3000

# Health check for Railway
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start the server
CMD ["node", "src/server.js"]
