# =============================================================================
# IliaGPT.io — Multi-stage production Dockerfile
# Node 20 Alpine, non-root user, tini signal handler, health check
# =============================================================================

# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base

# Install OS-level deps needed at runtime
RUN apk add --no-cache \
    tini \
    curl \
    ca-certificates \
    openssl \
    dumb-init \
    && addgroup -g 1001 -S appgroup \
    && adduser  -u 1001 -S appuser -G appgroup

WORKDIR /app

# ── Stage 2: deps ─────────────────────────────────────────────────────────────
FROM base AS deps

# Copy manifests first — best layer-cache hit rate
COPY package.json package-lock.json* ./
COPY .npmrc* ./

# Install ALL deps (including devDeps for build)
RUN npm ci --frozen-lockfile --prefer-offline \
    && npm cache clean --force

# ── Stage 3: builder ──────────────────────────────────────────────────────────
FROM deps AS builder

# Copy source
COPY tsconfig*.json ./
COPY vite.config*.ts ./
COPY tailwind.config.ts ./
COPY postcss.config.js* ./
COPY drizzle.config.ts ./
COPY scripts/ ./scripts/
COPY shared/  ./shared/
COPY server/  ./server/
COPY client/  ./client/

# Build server + client
ENV NODE_ENV=production
RUN npm run build

# Prune devDependencies
RUN npm prune --production \
    && npm cache clean --force

# ── Stage 4: production ───────────────────────────────────────────────────────
FROM base AS production

ENV NODE_ENV=production \
    PORT=5000 \
    HOST=0.0.0.0 \
    # Node.js tuning
    NODE_OPTIONS="--max-old-space-size=512 --enable-source-maps" \
    # Disable update notifier
    NO_UPDATE_NOTIFIER=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

# Copy built artifacts + pruned node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist/          ./dist/
COPY --from=builder --chown=appuser:appgroup /app/node_modules/  ./node_modules/
COPY --from=builder --chown=appuser:appgroup /app/package.json   ./package.json
COPY --from=builder --chown=appuser:appgroup /app/shared/        ./shared/
COPY --from=builder --chown=appuser:appgroup /app/migrations/    ./migrations/
COPY --from=builder --chown=appuser:appgroup /app/drizzle.config.ts ./drizzle.config.ts

# Create required runtime directories with correct ownership
RUN mkdir -p \
    /app/uploads \
    /app/tmp \
    /app/logs \
    && chown -R appuser:appgroup /app/uploads /app/tmp /app/logs

# Drop to non-root
USER appuser

# Expose app port
EXPOSE 5000

# Health check — hits /api/health every 30s, 3 retries, 5s timeout
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fs http://localhost:5000/api/health || exit 1

# Use tini as PID 1 for proper signal forwarding and zombie reaping
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.cjs"]

# ── Stage 5: migration runner (separate target) ───────────────────────────────
FROM production AS migrate
CMD ["node", "-e", "require('./dist/index.cjs').runMigrations()"]
