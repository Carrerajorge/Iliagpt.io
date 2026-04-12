# =============================================================================
# IliaGPT Dockerfile — Multi-stage production build
# Stage 1: builder  →  Stage 2: runtime
# =============================================================================

# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    libc6-compat \
    openssl \
    openssl-dev

WORKDIR /app

# Copy package manifests first for layer-cache efficiency
COPY package.json package-lock.json* ./

# Install ALL dependencies (including devDeps needed for build)
RUN npm ci --ignore-scripts

# Copy source files
COPY tsconfig*.json ./
COPY drizzle.config.ts ./
COPY vite.config.ts ./
COPY postcss.config.js ./
COPY components.json ./
COPY client ./client
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY migrations ./migrations

# Build TypeScript server and bundle Vite frontend
RUN npm run build

# Prune to production deps only
RUN npm ci --omit=dev --ignore-scripts

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

LABEL maintainer="IliaGPT <ops@iliagpt.io>" \
      org.opencontainers.image.title="IliaGPT" \
      org.opencontainers.image.description="Full-stack AI chat platform" \
      org.opencontainers.image.source="https://github.com/IliaGPT/iliagpt" \
      org.opencontainers.image.licenses="UNLICENSED"

# Runtime system dependencies
RUN apk add --no-cache \
    libc6-compat \
    openssl \
    ca-certificates \
    tini \
    curl \
    dumb-init \
    && update-ca-certificates

# Create non-root application user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs --shell /bin/false appuser

WORKDIR /app

# Copy only what runtime needs
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/package.json ./package.json
COPY --from=builder --chown=appuser:nodejs /app/migrations ./migrations
COPY --from=builder --chown=appuser:nodejs /app/shared ./shared

# Create runtime directories
RUN mkdir -p /app/uploads /app/logs /app/data \
    && chown -R appuser:nodejs /app/uploads /app/logs /app/data

# Drop to non-root
USER appuser

# Expose application port
EXPOSE 5000

# Environment defaults (overridden at runtime via env or secrets)
ENV NODE_ENV=production \
    PORT=5000 \
    LOG_LEVEL=info

# Health check — hits /api/health every 30s, 10s timeout, 3 retries
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -fsSL http://localhost:5000/api/health || exit 1

# Use tini as PID 1 for proper signal handling (SIGTERM, SIGINT)
# tini reaps zombie processes and forwards signals correctly
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "dist/index.cjs"]
