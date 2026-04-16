# IliaGPT Deployment Guide

Complete guide for deploying IliaGPT in production environments, from a single server to Kubernetes clusters.

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Environment Variables Reference](#environment-variables-reference)
3. [Docker Deployment](#docker-deployment)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [Database Setup](#database-setup)
6. [Redis Setup](#redis-setup)
7. [SSL/TLS Configuration](#ssltls-configuration)
8. [Monitoring](#monitoring)
9. [Log Aggregation](#log-aggregation)
10. [Backup and Restore](#backup-and-restore)
11. [Blue-Green Deployment](#blue-green-deployment)
12. [Troubleshooting](#troubleshooting)

---

## System Requirements

### Minimum (Development / Small Teams)

| Resource | Minimum |
|----------|---------|
| vCPU | 2 |
| RAM | 4 GB |
| Disk | 20 GB SSD |
| Network | 100 Mbps |

### Recommended (Production)

| Resource | Recommended |
|----------|------------|
| vCPU | 4 |
| RAM | 8 GB |
| Disk | 100 GB SSD (NVMe preferred) |
| Network | 1 Gbps |

### Large Scale (Hundreds of Concurrent Users)

| Resource | Large Scale |
|----------|------------|
| App servers | 3+ nodes, 4 vCPU / 8 GB each |
| Database | Dedicated PostgreSQL instance, 8 vCPU / 32 GB, 500 GB SSD |
| Redis | Dedicated Redis instance or cluster, 4 vCPU / 16 GB |
| Load balancer | Managed (AWS ALB, GCP LB, or nginx) |

### Software Dependencies

| Dependency | Version | Notes |
|------------|---------|-------|
| Node.js | 22+ | LTS recommended |
| PostgreSQL | 16+ | pgvector extension required |
| Redis | 7+ | Streams and persistence required |
| Python | 3.11+ | For the FastAPI code execution sandbox |
| Docker | 24+ | For containerized deployments |
| Docker Compose | 2.20+ | For local and simple deployments |

---

## Environment Variables Reference

IliaGPT uses environment variables for all configuration. The server validates all variables at startup via Zod schemas in `server/config/env.ts`. Missing required variables cause the process to exit with a clear error message.

Create a `.env` file in the project root (development) or pass variables via your deployment platform's secret management system (production).

### Core Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | `development` | One of: `development`, `production`, `test` |
| `PORT` | No | `5000` | HTTP server port |
| `HOST` | No | `0.0.0.0` | Server bind address |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string. Format: `postgresql://user:pass@host:5432/dbname` |
| `DATABASE_READ_URL` | No | — | Read-replica connection string. Falls back to `DATABASE_URL` if not set |
| `DATABASE_POOL_SIZE` | No | `10` | PostgreSQL connection pool size |
| `REDIS_URL` | Yes | — | Redis connection string. Format: `redis://[:password@]host:6379[/db]` or `rediss://...` for TLS |
| `SESSION_SECRET` | Yes | — | Secret for signing session cookies and anonymous tokens. Minimum 32 characters. Use a cryptographically random value |
| `APP_URL` | Yes | — | Public-facing base URL (e.g., `https://your-domain.com`). Used for OAuth callbacks and webhook URLs |
| `CORS_ORIGINS` | No | `*` in dev | Comma-separated list of allowed CORS origins in production |
| `TRUST_PROXY` | No | `false` | Set to `true` if behind a reverse proxy (nginx, ALB). Enables correct IP detection |
| `BODY_SIZE_LIMIT` | No | `10mb` | Max JSON request body size |
| `UPLOAD_SIZE_LIMIT` | No | `50mb` | Max file upload size |
| `UPLOAD_DIR` | No | `./uploads` | Directory for file uploads. Use a persistent volume path in Docker/k8s |

### LLM Provider Keys

At least one LLM provider key must be configured. The smart router will use available providers automatically.

| Variable | Provider | Notes |
|----------|----------|-------|
| `OPENAI_API_KEY` | OpenAI | GPT-4o, GPT-4o-mini, embeddings |
| `ANTHROPIC_API_KEY` | Anthropic | Claude 3.5 Sonnet, Claude 3.5 Haiku |
| `GEMINI_API_KEY` | Google | Gemini 2.0 Flash, Gemini 1.5 Pro |
| `XAI_API_KEY` | xAI | Grok-2 |
| `DEEPSEEK_API_KEY` | DeepSeek | DeepSeek Chat, DeepSeek Reasoner |
| `CEREBRAS_API_KEY` | Cerebras | High-speed inference for Llama |
| `MISTRAL_API_KEY` | Mistral AI | Mistral Large, Codestral |
| `COHERE_API_KEY` | Cohere | Command R+, embeddings |
| `GROQ_API_KEY` | Groq | Llama 3.3, Mixtral (low latency) |
| `TOGETHER_API_KEY` | Together AI | Open-source models via Together |
| `OPENROUTER_API_KEY` | OpenRouter | Unified access to 100+ models |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI | Required with AZURE_OPENAI_ENDPOINT |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI | Format: `https://<resource>.openai.azure.com` |
| `AZURE_OPENAI_API_VERSION` | Azure OpenAI | Default: `2024-10-21` |

### Authentication

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | For Google OAuth | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | For Google OAuth | Google OAuth 2.0 client secret |
| `MICROSOFT_CLIENT_ID` | For Microsoft OAuth | Azure AD application client ID |
| `MICROSOFT_CLIENT_SECRET` | For Microsoft OAuth | Azure AD application client secret |
| `MICROSOFT_TENANT_ID` | No | Azure AD tenant ID. Default: `common` (multi-tenant) |
| `AUTH0_DOMAIN` | For Auth0 | Auth0 domain (e.g., `your-app.auth0.com`) |
| `AUTH0_CLIENT_ID` | For Auth0 | Auth0 application client ID |
| `AUTH0_CLIENT_SECRET` | For Auth0 | Auth0 application client secret |

### Integrations

| Variable | Integration | Description |
|----------|-------------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram | Secret for validating Telegram webhook requests |
| `SLACK_BOT_TOKEN` | Slack | Bot OAuth token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack | Signing secret for verifying Slack requests |
| `SLACK_APP_TOKEN` | Slack | App-level token for socket mode (`xapp-...`) |
| `WHATSAPP_TOKEN` | WhatsApp | WhatsApp Business API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp | Phone number ID from Meta developer console |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp | Webhook verification token |
| `GITHUB_TOKEN` | GitHub | Personal access token or GitHub App token |
| `NOTION_TOKEN` | Notion | Notion integration token |
| `JIRA_HOST` | Jira | Jira instance URL |
| `JIRA_EMAIL` | Jira | Jira account email |
| `JIRA_API_TOKEN` | Jira | Jira API token |
| `GOOGLE_SEARCH_API_KEY` | Web Search | Google Custom Search API key |
| `GOOGLE_SEARCH_ENGINE_ID` | Web Search | Custom Search Engine ID (cx) |
| `BRAVE_SEARCH_API_KEY` | Web Search | Brave Search API key |
| `BING_SEARCH_API_KEY` | Web Search | Bing Search API key |
| `SERPAPI_KEY` | Web Search | SerpAPI key (fallback search provider) |

### Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_PROVIDER` | `local` | One of: `local`, `s3`, `gcs`, `azure` |
| `AWS_ACCESS_KEY_ID` | — | AWS credentials for S3 storage |
| `AWS_SECRET_ACCESS_KEY` | — | AWS credentials for S3 storage |
| `AWS_REGION` | `us-east-1` | AWS region for S3 bucket |
| `S3_BUCKET` | — | S3 bucket name for file uploads |
| `S3_ENDPOINT` | — | Custom S3-compatible endpoint (e.g., MinIO) |
| `GCS_BUCKET` | — | Google Cloud Storage bucket name |
| `GCS_PROJECT_ID` | — | GCP project ID |
| `AZURE_STORAGE_CONNECTION_STRING` | — | Azure Blob Storage connection string |
| `AZURE_STORAGE_CONTAINER` | — | Azure Blob container name |

### Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_LONG_TERM_MEMORY` | `true` | Enable automatic memory extraction |
| `ENABLE_AGENT_SYSTEM` | `true` | Enable the LangGraph agent system |
| `ENABLE_BROWSER_AGENT` | `true` | Enable Playwright browser automation |
| `ENABLE_CODE_EXECUTION` | `true` | Enable Python/JS code sandbox |
| `ENABLE_DOCUMENT_PROCESSING` | `true` | Enable file upload and embedding |
| `ENABLE_WEBHOOKS` | `true` | Enable outbound webhook delivery |
| `ENABLE_PLAN_MODE` | `true` | Enable agent Plan Mode |
| `ENABLE_REAL_TIME_PRESENCE` | `true` | Enable WebSocket presence tracking |
| `MAINTENANCE_MODE` | `false` | Put the platform in maintenance mode (503 on all routes) |
| `REGISTRATION_ENABLED` | `true` | Allow new user sign-ups |

### Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_ENABLED` | `false` | Expose Prometheus metrics at `/api/metrics` |
| `METRICS_TOKEN` | — | Bearer token to protect the metrics endpoint |
| `LOG_LEVEL` | `info` | One of: `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | `json` in production, `pretty` in development | Log output format |
| `SENTRY_DSN` | — | Sentry DSN for error tracking |
| `SENTRY_ENVIRONMENT` | `NODE_ENV` value | Sentry environment tag |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OpenTelemetry collector endpoint |
| `OTEL_SERVICE_NAME` | `iliagpt` | Service name for traces |

### Security

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_ENABLED` | `true` | Enable Redis-backed rate limiting |
| `RATE_LIMIT_FREE_RPM` | `60` | Requests per minute for free tier |
| `RATE_LIMIT_PRO_RPM` | `300` | Requests per minute for pro tier |
| `HELMET_ENABLED` | `true` | Enable Helmet security headers |
| `CSRF_ENABLED` | `true` | Enable CSRF protection |
| `PROMPT_INJECTION_DETECTION` | `true` | Enable prompt injection scanning |
| `SSRF_PROTECTION_ENABLED` | `true` | Block SSRF in web retrieval tools |
| `ALLOWED_UPLOAD_MIME_TYPES` | — | Comma-separated list of additional MIME types |
| `MAX_SESSIONS_PER_USER` | `10` | Maximum concurrent sessions per user |

---

## Docker Deployment

### docker-compose.yml

The following compose file sets up the complete IliaGPT stack locally or on a single server.

```yaml
version: "3.9"

services:
  app:
    image: node:22-slim
    working_dir: /app
    command: sh -c "npm ci --omit=dev && npm run db:bootstrap && npm start"
    ports:
      - "5000:5000"
    environment:
      NODE_ENV: production
      PORT: "5000"
      DATABASE_URL: postgresql://iliagpt:${POSTGRES_PASSWORD}@postgres:5432/iliagpt
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
      SESSION_SECRET: ${SESSION_SECRET}
      APP_URL: ${APP_URL}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      TRUST_PROXY: "true"
      FASTAPI_URL: http://fastapi:8000
      UPLOAD_DIR: /app/data/uploads
      METRICS_ENABLED: "true"
    volumes:
      - .:/app
      - uploads_data:/app/data/uploads
      - node_modules_cache:/app/node_modules
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      fastapi:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/api/health/live"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    networks:
      - iliagpt_net

  fastapi:
    build:
      context: ./fastapi_sse
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      PYTHONUNBUFFERED: "1"
      LOG_LEVEL: info
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    networks:
      - iliagpt_net

  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: iliagpt
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: iliagpt
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U iliagpt -d iliagpt"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - iliagpt_net

  redis:
    image: redis:7-alpine
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --appendonly yes
      --appendfsync everysec
      --save 900 1
      --save 300 10
      --save 60 10000
      --maxmemory 1gb
      --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - iliagpt_net

  nginx:
    image: nginx:1.27-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - certbot_certs:/etc/letsencrypt:ro
      - certbot_www:/var/www/certbot:ro
    depends_on:
      - app
    restart: unless-stopped
    networks:
      - iliagpt_net

  certbot:
    image: certbot/certbot
    volumes:
      - certbot_certs:/etc/letsencrypt
      - certbot_www:/var/www/certbot
    entrypoint: /bin/sh -c "trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done"
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  uploads_data:
  certbot_certs:
  certbot_www:
  node_modules_cache:

networks:
  iliagpt_net:
    driver: bridge
```

### Nginx Configuration

Save as `nginx/conf.d/iliagpt.conf`:

```nginx
upstream iliagpt_app {
    server app:5000;
    keepalive 32;
}

server {
    listen 80;
    server_name your-domain.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:MozSSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    client_max_body_size 55m;

    # SSE streams need long timeouts
    proxy_read_timeout 120s;
    proxy_connect_timeout 10s;
    proxy_send_timeout 120s;

    location / {
        proxy_pass http://iliagpt_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Required for SSE
        proxy_buffering off;
        proxy_cache off;
    }

    # Static assets with caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://iliagpt_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### FastAPI Dockerfile

The FastAPI service needs its own Dockerfile at `fastapi_sse/Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen --no-dev

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Starting the Stack

```bash
# 1. Copy example env file and fill in your values
cp .env.example .env
# Edit .env with your API keys, passwords, and domain

# 2. Start all services
docker compose up -d

# 3. Check logs
docker compose logs -f app

# 4. Verify health
curl https://your-domain.com/api/health
```

### Updating the Application

```bash
# Pull latest code
git pull origin main

# Rebuild and restart the app container only
docker compose up -d --build app

# Run any new migrations
docker compose exec app npm run db:migrate
```

---

## Kubernetes Deployment

### Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: iliagpt
  labels:
    name: iliagpt
```

### ConfigMap

Non-sensitive configuration stored as a ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: iliagpt-config
  namespace: iliagpt
data:
  NODE_ENV: "production"
  PORT: "5000"
  TRUST_PROXY: "true"
  LOG_LEVEL: "info"
  LOG_FORMAT: "json"
  METRICS_ENABLED: "true"
  ENABLE_LONG_TERM_MEMORY: "true"
  ENABLE_AGENT_SYSTEM: "true"
  ENABLE_BROWSER_AGENT: "true"
  ENABLE_CODE_EXECUTION: "true"
  ENABLE_DOCUMENT_PROCESSING: "true"
  DATABASE_POOL_SIZE: "10"
  BODY_SIZE_LIMIT: "10mb"
  UPLOAD_SIZE_LIMIT: "50mb"
  UPLOAD_DIR: "/app/data/uploads"
```

### Secret

Sensitive values in a Secret (base64-encoded in practice; use `kubectl create secret` or a secrets manager in production):

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: iliagpt-secrets
  namespace: iliagpt
type: Opaque
stringData:
  DATABASE_URL: "postgresql://iliagpt:CHANGE_ME@postgres-service:5432/iliagpt"
  REDIS_URL: "redis://:CHANGE_ME@redis-service:6379/0"
  SESSION_SECRET: "change-this-to-a-random-64-character-string-in-production"
  APP_URL: "https://your-domain.com"
  OPENAI_API_KEY: "sk-..."
  ANTHROPIC_API_KEY: "sk-ant-..."
  GOOGLE_CLIENT_ID: "..."
  GOOGLE_CLIENT_SECRET: "..."
```

For production, use a secrets manager such as AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, or the Kubernetes External Secrets Operator rather than storing secrets directly in manifests.

### PersistentVolumeClaim

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: uploads-pvc
  namespace: iliagpt
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: standard
  resources:
    requests:
      storage: 50Gi
```

Use `ReadWriteMany` if running multiple replicas so all pods can access the same upload directory. If using object storage (S3/GCS), this PVC is not needed.

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: iliagpt-app
  namespace: iliagpt
  labels:
    app: iliagpt
    component: app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: iliagpt
      component: app
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: iliagpt
        component: app
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "5000"
        prometheus.io/path: "/api/metrics"
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          image: your-registry/iliagpt:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 5000
              name: http
          envFrom:
            - configMapRef:
                name: iliagpt-config
            - secretRef:
                name: iliagpt-secrets
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2000m"
              memory: "2Gi"
          volumeMounts:
            - name: uploads
              mountPath: /app/data/uploads
          livenessProbe:
            httpGet:
              path: /api/health/live
              port: 5000
            initialDelaySeconds: 30
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /api/health/ready
              port: 5000
            initialDelaySeconds: 20
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
            successThreshold: 1
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 5"]
      volumes:
        - name: uploads
          persistentVolumeClaim:
            claimName: uploads-pvc
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: iliagpt-service
  namespace: iliagpt
  labels:
    app: iliagpt
spec:
  type: ClusterIP
  selector:
    app: iliagpt
    component: app
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: 5000
```

### Ingress with TLS

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: iliagpt-ingress
  namespace: iliagpt
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "55m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "120"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "120"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
spec:
  tls:
    - hosts:
        - your-domain.com
      secretName: iliagpt-tls
  rules:
    - host: your-domain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: iliagpt-service
                port:
                  name: http
```

### HorizontalPodAutoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: iliagpt-hpa
  namespace: iliagpt
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: iliagpt-app
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 30
```

### Applying the Manifests

```bash
# Apply in order
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml

# Watch rollout
kubectl rollout status deployment/iliagpt-app -n iliagpt

# Run migrations once deployed
kubectl exec -n iliagpt -it deploy/iliagpt-app -- npm run db:migrate
```

---

## Database Setup

### PostgreSQL 16 Installation

**Ubuntu/Debian:**

```bash
# Add PostgreSQL apt repository
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get update
apt-get install -y postgresql-16 postgresql-16-pgvector

systemctl enable postgresql
systemctl start postgresql
```

**macOS (Homebrew):**

```bash
brew install postgresql@16
brew install pgvector
brew services start postgresql@16
```

### Initial Database Setup

```bash
# Switch to postgres user
sudo -u postgres psql

# Create database and user
CREATE USER iliagpt WITH PASSWORD 'your_secure_password';
CREATE DATABASE iliagpt OWNER iliagpt;
GRANT ALL PRIVILEGES ON DATABASE iliagpt TO iliagpt;
\c iliagpt

# Enable pgvector extension (required)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- For full-text search performance
CREATE EXTENSION IF NOT EXISTS btree_gin; -- For GIN index support

\q
```

### Running Migrations

```bash
# Set DATABASE_URL in your environment, then run:
npm run db:bootstrap

# This runs:
# 1. Ensures pgvector extension exists
# 2. Applies all pending Drizzle migrations in migrations/

# For production from compiled dist:
npm run db:migrate:prod
```

### Connection Pooling with PgBouncer

For production workloads, use PgBouncer to efficiently pool connections.

**pgbouncer.ini:**

```ini
[databases]
iliagpt = host=127.0.0.1 port=5432 dbname=iliagpt

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 5433
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt

pool_mode = transaction
max_client_conn = 200
default_pool_size = 20
reserve_pool_size = 5
reserve_pool_timeout = 3
server_idle_timeout = 600
client_idle_timeout = 0
log_connections = 0
log_disconnections = 0
log_pooler_errors = 1
stats_period = 60
ignore_startup_parameters = extra_float_digits,search_path
```

**userlist.txt:**

```
"iliagpt" "md5<md5 hash of password+username>"
```

With PgBouncer running on port 5433, set `DATABASE_URL=postgresql://iliagpt:pass@localhost:5433/iliagpt`.

### Read Replica Configuration

For high read traffic, configure a read replica and set `DATABASE_READ_URL`:

```bash
# On primary: enable replication
# postgresql.conf
wal_level = replica
max_wal_senders = 3
wal_keep_size = 512

# pg_hba.conf
host replication replicator replica_host/32 md5

# On replica: create standby.signal and postgresql.conf
primary_conninfo = 'host=primary_host port=5432 user=replicator password=xxx'
```

Then in your environment:

```bash
DATABASE_URL=postgresql://iliagpt:pass@primary:5432/iliagpt
DATABASE_READ_URL=postgresql://iliagpt:pass@replica:5432/iliagpt
```

Read-heavy operations (list endpoints, search) automatically use the read replica when `DATABASE_READ_URL` is set.

### Database Backup

**Automated daily backup script (`scripts/backup-db.sh`):**

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/var/backups/iliagpt"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/iliagpt_${DATE}.dump"
RETENTION_DAYS=30

mkdir -p "${BACKUP_DIR}"

echo "Starting backup at $(date)"
pg_dump \
  --format=custom \
  --compress=9 \
  --no-acl \
  --no-owner \
  "${DATABASE_URL}" \
  --file="${BACKUP_FILE}"

echo "Backup completed: ${BACKUP_FILE} ($(du -sh ${BACKUP_FILE} | cut -f1))"

# Upload to S3 if configured
if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
  aws s3 cp "${BACKUP_FILE}" "s3://${S3_BACKUP_BUCKET}/postgres/${DATE}.dump"
  echo "Uploaded to s3://${S3_BACKUP_BUCKET}/postgres/${DATE}.dump"
fi

# Clean up old backups
find "${BACKUP_DIR}" -name "*.dump" -mtime +${RETENTION_DAYS} -delete
echo "Cleanup complete. Removed backups older than ${RETENTION_DAYS} days."
```

Schedule with cron: `0 2 * * * /opt/scripts/backup-db.sh >> /var/log/db-backup.log 2>&1`

### Database Restoration

```bash
# Full restore from custom-format dump
pg_restore \
  --dbname=postgresql://iliagpt:pass@host:5432/iliagpt_new \
  --verbose \
  --no-acl \
  --no-owner \
  iliagpt_20260411_020000.dump

# Point-in-time recovery (requires WAL archiving setup)
# Restore base backup, then replay WAL up to target time:
recovery_target_time = '2026-04-11 12:00:00'
recovery_target_action = 'promote'
```

---

## Redis Setup

### Redis 7 Installation

**Ubuntu/Debian:**

```bash
curl -fsSL https://packages.redis.io/gpg | gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" > /etc/apt/sources.list.d/redis.list
apt-get update
apt-get install -y redis

systemctl enable redis-server
systemctl start redis-server
```

### redis.conf for Production

```conf
# Network
bind 127.0.0.1 -::1
port 6379
requirepass your_redis_password_here

# Security: disable dangerous commands
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command DEBUG ""
rename-command CONFIG "CONFIG_SECRET_abc123"

# Persistence: both AOF and RDB for safety
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb

save 900 1
save 300 10
save 60 10000
dbfilename dump.rdb
dir /var/lib/redis

# Memory
maxmemory 2gb
maxmemory-policy allkeys-lru

# Logging
loglevel notice
logfile /var/log/redis/redis-server.log

# Performance
tcp-backlog 511
timeout 0
tcp-keepalive 300
databases 16
hz 10
```

### TLS Configuration

```conf
# redis.conf TLS settings
tls-port 6380
port 0
tls-cert-file /etc/redis/tls/redis.crt
tls-key-file /etc/redis/tls/redis.key
tls-ca-cert-file /etc/redis/tls/ca.crt
tls-auth-clients yes
```

Connection string with TLS: `rediss://:password@host:6380/0`

### Redis Sentinel for High Availability

For HA with automatic failover, deploy Redis Sentinel:

**sentinel.conf:**

```conf
port 26379
sentinel monitor mymaster 10.0.1.10 6379 2
sentinel auth-pass mymaster your_redis_password
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 60000
sentinel parallel-syncs mymaster 1
```

Run at least 3 Sentinel instances on separate hosts. Update `REDIS_URL` to use the Sentinel-aware format (supported by the `ioredis` client used by IliaGPT):

```
REDIS_SENTINEL_HOSTS=10.0.1.11:26379,10.0.1.12:26379,10.0.1.13:26379
REDIS_SENTINEL_NAME=mymaster
REDIS_PASSWORD=your_redis_password
```

---

## SSL/TLS Configuration

### Certbot / Let's Encrypt with Nginx

**Install Certbot:**

```bash
apt-get install -y certbot python3-certbot-nginx
```

**Obtain a certificate:**

```bash
# Stop nginx temporarily if using standalone mode
certbot certonly \
  --nginx \
  --agree-tos \
  --email admin@your-domain.com \
  -d your-domain.com \
  -d www.your-domain.com
```

**Certificates are stored at:**

- `/etc/letsencrypt/live/your-domain.com/fullchain.pem`
- `/etc/letsencrypt/live/your-domain.com/privkey.pem`

**Auto-renewal:**

Certbot installs a systemd timer automatically. Verify it:

```bash
systemctl status certbot.timer
# Test renewal:
certbot renew --dry-run
```

For Docker, the certbot service in the compose file handles renewal in a loop.

### HSTS Configuration

Add the following header via nginx (after TLS is working):

```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

Submit your domain to the HSTS preload list at https://hstspreload.org once you confirm TLS is stable.

### Strong SSL Settings

Use Mozilla's modern TLS configuration:

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:MozSSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 8.8.4.4 valid=300s;
resolver_timeout 5s;
```

---

## Monitoring

### Prometheus Configuration

Add a scrape target in your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: iliagpt
    scrape_interval: 30s
    scrape_timeout: 10s
    metrics_path: /api/metrics
    bearer_token: your_metrics_token
    static_configs:
      - targets:
          - your-domain.com:443
    scheme: https

  - job_name: iliagpt-postgres
    static_configs:
      - targets:
          - localhost:9187
    # Assumes postgres_exporter running on the DB host

  - job_name: iliagpt-redis
    static_configs:
      - targets:
          - localhost:9121
    # Assumes redis_exporter running on the Redis host
```

### Key Metrics to Monitor

| Metric | Alert Threshold | Description |
|--------|----------------|-------------|
| `http_request_duration_seconds_p95` | > 3s | 95th percentile response latency |
| `http_requests_total{status=~"5.."}` | > 1% of total | Error rate |
| `llm_cost_dollars_total` | > daily budget | Runaway LLM spend |
| `active_sessions` | > 1000 per node | Session saturation |
| `agent_runs_total{status="failed"}` | > 10% of total | Agent failure rate |
| `circuit_breaker_state` | > 0 (open) | Provider circuit breaker opened |
| `node_memory_MemAvailable_bytes` | < 500MB | Low server memory |
| `pg_up` | == 0 | Database down |
| `redis_up` | == 0 | Redis down |

### Grafana Dashboard Panels

A complete Grafana dashboard is available in `monitoring/grafana/dashboards/iliagpt.json`. Key panels include:

**Row 1 — Traffic Overview:**
- Total requests/second (time series, split by route)
- Error rate percentage (gauge, colored green < 1%, red > 5%)
- HTTP response time P50/P95/P99 (time series)

**Row 2 — LLM Performance:**
- Tokens per second by provider (time series, stacked)
- Cost per hour (bar chart, by model)
- Circuit breaker states per provider (table)
- Model latency P95 comparison (bar chart)

**Row 3 — Agent System:**
- Agent runs per hour (counter with delta)
- Agent run success rate (gauge)
- Average agent run duration (time series)
- Active streaming connections (gauge)

**Row 4 — Infrastructure:**
- Node.js heap usage (time series)
- PostgreSQL connection pool utilization (gauge)
- Redis memory usage (time series)
- Active sessions (time series)

### Prometheus Alerting Rules

```yaml
groups:
  - name: iliagpt.rules
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m]))
          /
          sum(rate(http_requests_total[5m])) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "IliaGPT error rate above 5%"
          description: "Error rate is {{ $value | humanizePercentage }} over the last 5 minutes."

      - alert: HighP95Latency
        expr: |
          histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{route="/v1/chat/completions"}[5m])) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Chat completions P95 latency above 5s"

      - alert: DatabaseDown
        expr: pg_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL is unreachable"

      - alert: RedisDown
        expr: redis_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis is unreachable"

      - alert: CircuitBreakerOpen
        expr: circuit_breaker_state > 0
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "LLM provider circuit breaker opened for {{ $labels.provider }}"

      - alert: LowMemory
        expr: node_memory_MemAvailable_bytes < 524288000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Less than 500MB RAM available on {{ $labels.instance }}"
```

---

## Log Aggregation

### Log Format

IliaGPT emits structured JSON logs in production. Each log entry includes:

```json
{
  "timestamp": "2026-04-11T12:00:00.000Z",
  "level": "info",
  "msg": "POST /v1/chat/completions 200 1234ms",
  "method": "POST",
  "url": "/v1/chat/completions",
  "status": 200,
  "latencyMs": 1234,
  "requestId": "req_abc123",
  "userId": "user_01abc",
  "model": "gpt-4o",
  "provider": "openai",
  "tokens": 360,
  "cost": 0.00936,
  "pid": 1234,
  "hostname": "app-pod-xyz"
}
```

### Loki + Grafana Setup

If using Loki for log aggregation:

**docker-compose addition:**

```yaml
loki:
  image: grafana/loki:2.9.0
  ports:
    - "3100:3100"
  volumes:
    - loki_data:/loki
    - ./monitoring/loki/config.yml:/etc/loki/config.yml:ro
  command: -config.file=/etc/loki/config.yml

promtail:
  image: grafana/promtail:2.9.0
  volumes:
    - /var/log:/var/log:ro
    - /var/lib/docker/containers:/var/lib/docker/containers:ro
    - ./monitoring/promtail/config.yml:/etc/promtail/config.yml:ro
  command: -config.file=/etc/promtail/config.yml
```

**promtail/config.yml:**

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: iliagpt_containers
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s
    relabel_configs:
      - source_labels: [__meta_docker_container_name]
        regex: /(.*)
        target_label: container
      - source_labels: [__meta_docker_container_label_com_docker_compose_service]
        target_label: service
    pipeline_stages:
      - json:
          expressions:
            level: level
            requestId: requestId
            userId: userId
            latencyMs: latencyMs
      - labels:
          level:
          service:
      - timestamp:
          source: timestamp
          format: RFC3339
```

### ELK Stack Alternative

**Filebeat configuration for Docker containers:**

```yaml
filebeat.inputs:
  - type: container
    paths:
      - /var/lib/docker/containers/*/*.log
    processors:
      - add_docker_metadata:
          host: "unix:///var/run/docker.sock"
      - decode_json_fields:
          fields: ["message"]
          target: ""
          overwrite_keys: true

output.elasticsearch:
  hosts: ["elasticsearch:9200"]
  index: "iliagpt-logs-%{+yyyy.MM.dd}"

setup.kibana:
  host: "kibana:5601"
```

---

## Backup and Restore

### Full Backup Script

```bash
#!/bin/bash
# scripts/full-backup.sh
set -euo pipefail

BACKUP_ROOT="/var/backups/iliagpt"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_ROOT}/${DATE}"
mkdir -p "${BACKUP_DIR}"

echo "=== IliaGPT Full Backup: ${DATE} ==="

# 1. PostgreSQL
echo "Backing up PostgreSQL..."
pg_dump \
  --format=custom \
  --compress=9 \
  --no-acl \
  --no-owner \
  "${DATABASE_URL}" \
  --file="${BACKUP_DIR}/postgres.dump"
echo "PostgreSQL: $(du -sh ${BACKUP_DIR}/postgres.dump | cut -f1)"

# 2. Redis
echo "Backing up Redis..."
redis-cli -u "${REDIS_URL}" BGSAVE
sleep 3
cp /var/lib/redis/dump.rdb "${BACKUP_DIR}/redis.rdb"
echo "Redis: $(du -sh ${BACKUP_DIR}/redis.rdb | cut -f1)"

# 3. Uploads directory
echo "Backing up uploads..."
tar -czf "${BACKUP_DIR}/uploads.tar.gz" -C "${UPLOAD_DIR}" .
echo "Uploads: $(du -sh ${BACKUP_DIR}/uploads.tar.gz | cut -f1)"

# 4. Create manifest
cat > "${BACKUP_DIR}/manifest.json" << EOF
{
  "timestamp": "${DATE}",
  "version": "$(cat package.json | jq -r .version)",
  "files": ["postgres.dump", "redis.rdb", "uploads.tar.gz"]
}
EOF

# 5. Sync to S3
if [ -n "${S3_BACKUP_BUCKET:-}" ]; then
  aws s3 sync "${BACKUP_DIR}" "s3://${S3_BACKUP_BUCKET}/backups/${DATE}/"
  echo "Synced to s3://${S3_BACKUP_BUCKET}/backups/${DATE}/"
fi

echo "=== Backup complete: ${BACKUP_DIR} ==="
```

### Restore Procedure

```bash
# 1. Stop the app
docker compose stop app

# 2. Restore PostgreSQL
pg_restore \
  --dbname="${DATABASE_URL}" \
  --clean \
  --if-exists \
  --no-acl \
  --no-owner \
  --verbose \
  /var/backups/iliagpt/20260411_020000/postgres.dump

# 3. Restore Redis
redis-cli -u "${REDIS_URL}" SHUTDOWN NOSAVE
cp /var/backups/iliagpt/20260411_020000/redis.rdb /var/lib/redis/dump.rdb
chown redis:redis /var/lib/redis/dump.rdb
systemctl start redis-server

# 4. Restore uploads
tar -xzf /var/backups/iliagpt/20260411_020000/uploads.tar.gz -C "${UPLOAD_DIR}"

# 5. Run migrations to ensure schema is current
DATABASE_URL="${DATABASE_URL}" npm run db:migrate

# 6. Restart the app
docker compose start app

# 7. Verify health
curl http://localhost:5000/api/health
```

---

## Blue-Green Deployment

Blue-green deployment eliminates downtime during updates by switching traffic between two identical environments.

### Strategy

1. Two environments — "blue" (current production) and "green" (new version) — run simultaneously.
2. Deploy and validate the new version in the green environment.
3. Switch load balancer traffic to green in a single operation.
4. Keep blue running for 10-15 minutes to allow in-flight requests to complete and enable fast rollback.
5. After validation, tear down blue (or repurpose it as the next "blue").

### Implementation with Docker Compose

```bash
# Current blue is running on port 5001 behind nginx upstream "blue"
# Start green on port 5002

# Build new image
docker build -t iliagpt:green .

# Start green stack
APP_PORT=5002 COMPOSE_PROJECT_NAME=iliagpt-green docker compose up -d app

# Wait for green to be healthy
until curl -sf http://localhost:5002/api/health/ready; do
  echo "Waiting for green to be ready..."
  sleep 5
done

echo "Green is healthy. Switching traffic..."

# Update nginx to point to green
sed -i 's/server app:5001/server localhost:5002/' /etc/nginx/conf.d/upstream.conf
nginx -s reload

echo "Traffic switched to green."

# Monitor for 10 minutes
sleep 600

# Check error rate
ERRORS=$(curl -s "http://prometheus:9090/api/v1/query?query=rate(http_requests_total{status=~'5..'}[2m])" | jq '.data.result[0].value[1]')
if (( $(echo "$ERRORS > 0.05" | bc -l) )); then
  echo "ERROR RATE TOO HIGH ($ERRORS) — rolling back to blue"
  sed -i 's/server localhost:5002/server app:5001/' /etc/nginx/conf.d/upstream.conf
  nginx -s reload
  exit 1
fi

echo "Deployment successful. Stopping blue."
COMPOSE_PROJECT_NAME=iliagpt-blue docker compose stop app
```

### Health Check Gates

Before switching traffic, verify all of the following:

```bash
check_deployment_health() {
  local URL=$1

  # 1. Basic liveness
  curl -sf "${URL}/api/health/live" || return 1

  # 2. Readiness (DB + Redis connected)
  curl -sf "${URL}/api/health/ready" || return 1

  # 3. Full health check (all dependencies green)
  STATUS=$(curl -sf "${URL}/api/health" | jq -r .status)
  [ "$STATUS" = "healthy" ] || return 1

  # 4. Smoke test: can the API respond to a simple request?
  curl -sf -X POST "${URL}/v1/chat/completions" \
    -H "Authorization: Bearer ${SMOKE_TEST_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}],"max_tokens":5}' \
    | jq -e '.choices[0].message.content' > /dev/null || return 1

  return 0
}
```

### Database Migrations in Blue-Green

Always ensure migrations are backward-compatible (additive only) so both blue and green can run against the same database simultaneously during the switchover window:

- Add new columns as nullable with defaults
- Never delete or rename columns (use two-phase migration: add new, migrate data, drop old in a later release)
- New indexes should be created with `CREATE INDEX CONCURRENTLY` to avoid locking

---

## Troubleshooting

### Common Issues

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| App fails to start, exits immediately | Missing required env var | Check startup logs for `Missing required environment variable:` message |
| `ECONNREFUSED` connecting to PostgreSQL | DB not running, wrong host/port, or credentials | Verify `DATABASE_URL`; check `pg_isready`; test connection manually |
| `ECONNREFUSED` connecting to Redis | Redis not running or wrong password | Verify `REDIS_URL`; run `redis-cli ping`; check auth |
| `pgvector extension not found` | pgvector not installed | Run `CREATE EXTENSION vector;` as superuser; ensure postgresql-pgvector is installed |
| All LLM requests fail with 503 | All provider circuit breakers open | Check `GET /api/admin/models`; verify API keys are valid; check provider status pages |
| File uploads failing with 413 | nginx/proxy body size limit | Set `client_max_body_size 55m;` in nginx config |
| SSE streams disconnect immediately | nginx proxy buffering enabled | Add `proxy_buffering off;` and `proxy_cache off;` for SSE routes |
| Memory leak, process OOM | Too many concurrent agent runs | Reduce `AGENT_CONCURRENCY`; scale horizontally instead |
| Sessions not persisting across restarts | `SESSION_SECRET` changed or Redis cleared | Keep `SESSION_SECRET` stable; use Redis persistence |
| Google OAuth callback fails | Wrong callback URL configured | Ensure `APP_URL` matches the OAuth redirect URI in Google Cloud Console |
| CSRF token errors | Request from different origin, or cookie blocked | Check `CORS_ORIGINS`; ensure cookies are sent with requests; check SameSite settings |
| Embeddings failing | OpenAI embedding key invalid or quota exceeded | Check `OPENAI_API_KEY`; verify embedding model is available |
| Slow search queries | Missing pgvector index | Run `CREATE INDEX CONCURRENTLY ON user_long_term_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);` |

### Enabling Debug Mode

```bash
# Set log level to debug
LOG_LEVEL=debug npm start

# Or for a running Docker container:
docker compose exec app sh -c "LOG_LEVEL=debug node dist/index.cjs"
```

Debug mode enables:
- Full request/response logging
- LLM prompt and completion logging (may contain sensitive data — do not use in production with real users)
- Agent step-by-step reasoning traces
- Database query logging

### Log Locations

| Component | Log Location |
|-----------|-------------|
| App server (Docker) | `docker compose logs app` |
| App server (systemd) | `journalctl -u iliagpt -f` |
| PostgreSQL | `/var/log/postgresql/postgresql-16-main.log` |
| Redis | `/var/log/redis/redis-server.log` |
| Nginx | `/var/log/nginx/access.log`, `/var/log/nginx/error.log` |
| FastAPI sandbox | `docker compose logs fastapi` |

### Database Connection Issues

```bash
# Test connection from app container
docker compose exec app sh -c "node -e \"
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT NOW()', (err, res) => {
  if (err) { console.error('Connection failed:', err.message); process.exit(1); }
  console.log('Connected! Server time:', res.rows[0].now);
  pool.end();
});
\""

# Check active connections
psql "${DATABASE_URL}" -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

# Check for blocking queries
psql "${DATABASE_URL}" -c "
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes'
ORDER BY duration DESC;"
```

### LLM Provider Errors

```bash
# Check circuit breaker state via admin API
curl -s http://localhost:5000/api/admin/models \
  -H "Cookie: connect.sid=<admin-session>" \
  | jq '.models[] | {id, status, circuitBreaker}'

# Reset a circuit breaker manually (forces half-open probe)
curl -X POST http://localhost:5000/api/admin/models/gpt-4o/reset-circuit-breaker \
  -H "Cookie: connect.sid=<admin-session>"

# Test a provider key directly
curl -s https://api.openai.com/v1/models \
  -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  | jq '.data[0].id'
```

### Memory and Performance Issues

```bash
# Check Node.js heap usage
docker compose exec app sh -c "node -e \"
const v8 = require('v8');
const stats = v8.getHeapStatistics();
console.log('Heap used:', Math.round(stats.used_heap_size / 1024 / 1024), 'MB');
console.log('Heap total:', Math.round(stats.total_heap_size / 1024 / 1024), 'MB');
console.log('Heap limit:', Math.round(stats.heap_size_limit / 1024 / 1024), 'MB');
\""

# Profile memory (enable in NODE_OPTIONS)
NODE_OPTIONS="--inspect=0.0.0.0:9229" npm start
# Then connect Chrome DevTools to chrome://inspect

# Check Redis memory
redis-cli -u "${REDIS_URL}" INFO memory | grep used_memory_human

# Identify slow PostgreSQL queries
psql "${DATABASE_URL}" -c "
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;"
# Requires pg_stat_statements extension
```

### Getting Help

1. Check `GET /api/health` for a dependency status summary.
2. Search application logs for the `requestId` from a failing API response.
3. Check the `error` field in SSE streams for provider-specific error messages.
4. Review circuit breaker states via `GET /api/admin/models`.
5. For persistent issues, open an issue on GitHub with the `requestId`, timestamp, and relevant log output.

---

*Deployment Guide version 2026.4 — Last updated April 2026*
