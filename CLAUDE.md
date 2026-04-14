# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IliaGPT is a full-stack AI chat platform with multi-agent orchestration, browser automation, document generation, and multi-channel integrations (Telegram, WhatsApp, etc.). It ships as a web app, Electron desktop app, and Chrome extension.

## Commands

### Development
```bash
npm run dev              # Start Express API server (port 5000)
npm run dev:client       # Start Vite frontend dev server (port 5000)
npm run dev:desktop      # Full desktop app (server + client + Electron)
```

### Build & Production
```bash
npm run build            # Compile server + client via script/build.ts
npm start                # NODE_ENV=production node dist/index.cjs
```

### Database
```bash
npm run db:bootstrap     # Ensure pgvector extension + run Drizzle migrations
npm run db:push          # Push schema changes (development)
npm run db:migrate       # Run Drizzle migrations
npm run db:migrate:prod  # Run migrations from compiled dist
```

### Testing
```bash
npm run test:run                     # All unit/integration tests (Vitest)
npm run test:ci:chat-core            # Core chat tests (CI subset)
npm run test:client                  # React component tests (vitest.client.config.ts)
npm run test:e2e                     # Playwright end-to-end tests
npm run test:smoke                   # Playwright smoke tests
npm run test:agentic                 # Agent system tests
npm run test:agentic:integration     # Agentic integration tests
npm run verify                       # Full verification script (scripts/agent-verify.sh)
# Single test:
npx vitest run path/to/test.ts
```

### Linting & Type Checking
```bash
npm run lint             # ESLint
npm run check            # TypeScript type check
npm run type-check       # Extended type check (8GB heap)
npm run verify:i18n      # i18n coverage check + tests
```

## Architecture

### Monorepo Layout
- **`client/`** — React 19 + Vite frontend. Routing via Wouter. State via Zustand stores (`chatStore`, `agentStore`, `streamingStore`, `superAgentStore`). UI via shadcn/ui (Radix primitives) + TailwindCSS 4.
- **`server/`** — Express.js backend. Entry point: `server/index.ts`. Route registration: `server/routes.ts`. Database access: `server/db.ts`. Storage layer: `server/storage.ts`.
- **`shared/`** — Shared types, Drizzle schemas, Zod validators. The single source of truth is `shared/schema.ts` (~3300 lines) defining all DB tables and insert schemas.
- **`migrations/`** — Drizzle-generated SQL migrations.
- **`fastapi_sse/`** — Python 3.11 microservice (FastAPI/Uvicorn) for tool execution sandbox and spreadsheet analysis.
- **`desktop/`** — Electron wrapper.
- **`extension/`** — Chrome browser extension.
- **`e2e/`** — Playwright E2E tests.

### Path Aliases
- `@/*` → `client/src/`
- `@shared/*` → `shared/`

### Agent System (server/agent/)
Multi-agent orchestration built on LangGraph + LangChain:
- **`pipeline/`** — LLM + tool execution pipeline
- **`langgraph/`** — DAG-based agent orchestration with specialized agents (deep-research, coding, browser)
- **`superAgent/`** — Proactive self-improving agent behavior
- **`autonomousAgentBrain.ts`** — Agent reasoning engine
- **`browser/`** — Playwright-based web automation agent
- **`planMode.ts`** — Agent Plan Mode: generate → approve/reject → execute with step-by-step progress
- Tool registry with 100+ sandboxed tools, universal tool calling across model providers

### Smart Model Router (server/llm/smartRouter.ts)
Cost-aware, latency-optimized model selection:
- Complexity detection: simple/medium/complex based on message patterns, length, conversation depth
- Circuit breaker per provider: 3 failures → 5min cooldown → half-open probe → recovery
- Fallback chains: tier cascade when primary provider is down
- Budget enforcement per user tier (free: $0.50/day, pro: $5/day, enterprise: $50/day)
- Health checks every 60s for degraded providers
- Latency tracking with P50/P95/P99 percentiles

### Long-Term Memory (server/memory/longTermMemory.ts)
Cross-session fact extraction and recall:
- After conversations, extracts facts via LLM (preferences, personal info, work context)
- Stores with pgvector embeddings for semantic retrieval
- Importance scoring: mention_count / 10, capped at 1.0
- Injected into system prompt before LLM calls
- CRUD API: `GET/DELETE /api/memories`

### Artifacts System (client/src/components/artifacts/)
Claude.ai-style artifact panel for rich content:
- Auto-detects: HTML, Mermaid diagrams, tables, large code blocks (>15 lines)
- Renderers: CodeArtifact (shiki), HtmlArtifact (sandboxed iframe), TableArtifact (sort/filter), DiagramArtifact (mermaid)
- Version history with navigation
- Zustand store: `client/src/stores/artifactStore.ts`

### OpenAI-Compatible API (server/api/v1/)
Drop-in replacement for the OpenAI SDK:
- `POST /v1/chat/completions` — streaming + non-streaming
- `POST /v1/embeddings` — 1536-dim vectors
- `GET /v1/models` — available model list
- API key auth via `Authorization: Bearer ilgpt_...`
- Rate limiting per API key

### Real-Time Presence (server/realtime/presence.ts)
- Online/away/offline status with 2min timeout
- Typing indicators (5s auto-clear)
- Chat focus tracking (who's viewing what)
- WebSocket broadcast at `/ws/presence`
- React hook: `usePresence()`

### Hybrid Search (server/search/unifiedSearch.ts)
- Full-text: PostgreSQL tsvector with ts_headline highlighting
- Semantic: pgvector cosine similarity on embeddings
- Hybrid: Reciprocal Rank Fusion (k=60) combining both
- `GET /api/search?q=text&type=all|message|chat|document`
- Search modal: `Ctrl+Shift+F` with dual-mode (quick local + deep server)

### OpenClaw Integration (server/openclaw-src/)
Browser control subsystem (v2026.4.5) with WebSocket gateway, agents, and internet access pipeline.

### Data Flow (Chat)
1. Client → `POST /api/chats/:id/messages`
2. `chatAiRouter` → Smart Router (complexity → model selection) → LLM Gateway
3. LLM Gateway → Multi-provider (OpenAI, Anthropic, Gemini, xAI, DeepSeek, OpenRouter)
4. Agent system invoked if tools needed (LangGraph orchestration)
5. Response streamed back via SSE (`/messages/stream`) or WebSocket
6. Messages persisted in PostgreSQL
7. Long-term memory extraction runs async post-response

### Database
PostgreSQL 16 + pgvector (1536-dim embeddings). Drizzle ORM with Zod schemas for runtime validation. Key tables: `users`, `sessions`, `chats`, `messages`, `documents`, `agents`, `tools`, `user_long_term_memories`, `api_keys`. Read replica support via `DATABASE_READ_URL`.

### Authentication
Passport.js with Google OAuth (primary), Microsoft OAuth, Auth0. Session via `express-session` + `connect-pg-simple`. Safari/ITP fallback: `X-Anonymous-User-Id` + `X-Anonymous-Token` headers with HMAC-SHA256. CSRF protection on all mutations. API key auth for `/v1/*` endpoints.

### Multi-Provider LLM Gateway
Supports OpenAI, Anthropic, Google Gemini, xAI (Grok), DeepSeek, Cerebras, OpenRouter with:
- Smart routing via `smartRouter.ts` (complexity-based model selection)
- Circuit breakers per provider with automatic recovery
- Fallback chains across providers and model tiers
- Token tracking, budget enforcement, and cost recording
- Request deduplication and response caching (Redis)

## Key Conventions

- **Type safety**: Zod schemas for runtime validation at API boundaries, Drizzle for DB types. All shared contracts live in `shared/`.
- **ESLint rules**: Unused vars warned (except `_` prefix), `any` warned. Conventional commits enforced via commitlint + husky.
- **Environment config**: Validated via Zod in `server/config/env.ts` (~100+ vars). Critical: `DATABASE_URL`, `SESSION_SECRET`, plus at least one LLM API key.
- **i18n**: 103 locales in `client/src/locales/`. Coverage checked via `npm run verify:i18n`.
- **Frontend state**: Zustand stores in `client/src/stores/`. TanStack Query for server data. Hooks in `client/src/hooks/`.
- **Security middleware**: Helmet, CSRF, rate limiting (Redis-backed), SSRF protection on web retrieval, prompt injection detection, DOMPurify output sanitization.
- **Streaming**: SSE with 60s idle timeout, WebSocket fallback. Redis pub/sub for multi-instance coordination.
- **CI** (`.github/workflows/ci.yml`): Node 22, runs `test:ci:chat-core` + `test:client` tests. 25min timeout.

## REGLAS OBLIGATORIAS DE DEPLOY (SIEMPRE)

### Al finalizar CUALQUIER tarea:
1. git add -A
2. git commit -m "descripción clara del cambio"
3. git push origin main
4. gh run watch --exit-status (esperar CI)
5. Si CI falla: leer error, corregir, push de nuevo
6. REPETIR hasta CI verde
7. NUNCA dejar CI en rojo
8. NUNCA crear branches ni PRs — todo directo a main

### Antes de cada push verificar:
- npm run lint (0 errores)
- npm run check 2>&1 | grep "error TS" (0 errores en client/src/)
- npm run test:ci:chat-core (tests pasan)

### Si el contexto se llena: /compact y continuar
### NO preguntar, trabajar autónomo
