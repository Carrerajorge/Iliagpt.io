# Changelog

All notable changes to IliaGPT are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
IliaGPT uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- feat: comprehensive multi-provider capability test suite — 532 tests across 27 files covering all 18 capability categories
- feat: Turn M — domain runtime capability matrix with per-domain runtime assertions
- feat: OpenClaw v2026.4.5 browser automation subsystem with WebSocket gateway and internet access pipeline
- docs: professional enterprise documentation suite (CHANGELOG, ROADMAP, FAQ, GLOSSARY, .env.example, GitHub templates)
- feat: agent cognitive kernel — structured reasoning traces with confidence scoring per capability turn
- feat: MCP connector health dashboard in admin UI
- test: agentic integration harness — 42 new Playwright browser tests for multi-agent flows

### Changed
- perf: smart router latency tracking now emits P50/P95/P99 percentiles to OpenTelemetry

### Fixed
- fix: SSE connection drop on Safari 18 when `X-Anonymous-User-Id` header is missing
- fix: long-term memory injection occasionally injected stale facts after user deletion

---

## [1.1.0] - 2026-03-15

### Added
- feat: Plan Mode — generate → approve/reject → execute with per-step progress indicators and rollback support
- feat: hybrid search combining PostgreSQL full-text tsvector with pgvector cosine similarity via Reciprocal Rank Fusion (k=60)
- feat: real-time presence system — online/away/offline status, typing indicators, chat focus tracking via WebSocket
- feat: support for Fireworks AI and Perplexity as LLM providers in the multi-provider gateway
- feat: Azure OpenAI provider with deployment-level routing and region-aware fallback
- feat: Ollama and LM Studio local provider support (zero cloud dependency mode)
- feat: OpenAI-compatible REST API (`/v1/chat/completions`, `/v1/embeddings`, `/v1/models`) for third-party SDK compatibility
- feat: long-term memory CRUD endpoints (`GET /api/memories`, `DELETE /api/memories/:id`) with admin bulk-delete
- feat: document artifact version history with forward/back navigation in the artifacts panel
- feat: anonymous session support via `X-Anonymous-User-Id` + HMAC-SHA256 tokens for Safari ITP compatibility

### Changed
- perf: smart router now uses circuit breakers per provider — 3 failures trigger 5-minute cooldown, then half-open probe
- perf: Redis-backed response caching for identical LLM requests reduces provider spend by ~18% in benchmarks
- refactor: agent tool registry now uses a unified descriptor format across LangGraph and pipeline execution paths
- change: `POST /api/chats/:id/messages` now returns `202 Accepted` immediately and streams via SSE — previously blocked until completion

### Fixed
- fix: Mermaid diagram renderer failed silently on cyclic graphs; now surfaces a parse error in the artifact panel
- fix: code execution sandbox timeout was not enforced for Python asyncio coroutines — added per-coroutine wall-clock limit
- fix: Google OAuth token refresh race condition caused intermittent 401s on long sessions
- fix: memory usage leak in streaming SSE handler when client disconnected without sending `Connection: close`

### Security
- security: upgraded `express-session` to 1.18.1 to patch session fixation vulnerability (CVE-2024-43799)
- security: added SSRF protection middleware blocking requests to RFC-1918 ranges on all web-retrieval tool calls
- security: CSRF tokens now rotate on each authenticated request (double-submit cookie pattern)

---

## [1.0.0] - 2026-01-20

IliaGPT 1.0.0 is the first stable production release. This version marks API stability for the `/v1/*` endpoints and the agent tool registry interface.

**Breaking changes from 0.5.0:**
- The `OPENAI_API_KEY` environment variable is no longer used as a universal fallback. Each provider now requires its own key variable. See `.env.example`.
- The `POST /api/messages` endpoint is removed. Use `POST /api/chats/:id/messages` instead.
- `shared/schema.ts`: the `agentConfig` column type changed from `text` to `jsonb`; run `npm run db:migrate` before starting.
- The `AGENT_MAX_ITERATIONS` env variable is renamed `AGENT_MAX_STEPS`.

### Added
- feat: LangGraph-based multi-agent orchestration with specialized deep-research, coding, and browser agents
- feat: multi-provider LLM gateway supporting OpenAI, Anthropic, Gemini, xAI (Grok), DeepSeek, Cerebras, Mistral, Cohere, Groq, Together AI, OpenRouter (11 providers at launch)
- feat: smart model router with complexity detection (simple / medium / complex) and cost-aware model selection
- feat: long-term memory — LLM-extracted facts stored with pgvector embeddings, injected into system prompt
- feat: artifacts system — auto-detect and render HTML, Mermaid diagrams, tables, and large code blocks in sandboxed panel
- feat: Playwright-based browser automation agent (OpenClaw v1) for web scraping and UI automation
- feat: code execution sandbox (FastAPI/Python microservice) with 30s timeout and 512 MB memory cap
- feat: Telegram and Slack channel integrations
- feat: budget enforcement — configurable daily USD budgets per user tier (free / pro / enterprise)
- feat: rate limiting backed by Redis with per-user and per-API-key counters
- feat: pgvector semantic search with 1536-dimensional OpenAI embeddings
- feat: Drizzle ORM schema with full Zod validators at API boundaries

### Changed
- change: migrated frontend from React 18 to React 19 with concurrent features
- change: replaced custom CSS with TailwindCSS 4 and shadcn/ui component library
- change: agent tool registry now supports 100+ sandboxed tools with universal tool calling across providers
- perf: database connection pool increased from 10 to 25 connections; read replica routing added

### Fixed
- fix: agent reasoning loop occasionally produced duplicate tool calls when provider returned partial JSON
- fix: session cookie `SameSite=None` was not set for cross-origin embedding scenarios

### Security
- security: Helmet middleware enabled with strict Content-Security-Policy
- security: DOMPurify applied to all LLM output rendered in the browser
- security: prompt injection detection middleware added to API gateway

---

## [0.5.0] - 2025-11-10

### Added
- feat: superAgent — proactive self-improving agent that monitors capability gaps and auto-schedules improvement runs
- feat: autonomous agent brain (`autonomousAgentBrain.ts`) with multi-step reasoning and sub-task delegation
- feat: document generation engine — Word (.docx), PDF, and structured report output from agent instructions
- feat: Notion and Linear MCP connectors (read + write)
- feat: scheduled task engine with cron expression support and webhook triggers
- feat: Microsoft OAuth provider alongside existing Google OAuth

### Changed
- perf: SSE streaming now uses Redis pub/sub for multi-instance coordination — enables horizontal scaling
- refactor: agent pipeline extracted into `server/agent/pipeline/` for cleaner separation from routing logic

### Fixed
- fix: deepSeek provider returned non-standard `finish_reason` values that broke streaming termination detection
- fix: long conversations (>50 messages) caused context window overflow — added automatic summarization before threshold

### Security
- security: API key prefix changed to `ilgpt_` to prevent accidental exposure via regex scanning tools

---

## [0.4.0] - 2025-09-05

### Added
- feat: spreadsheet analysis microservice (FastAPI/Python) with pivot table, chart data, and formula evaluation support
- feat: GitHub App integration — create issues, open PRs, post PR review comments from agent instructions
- feat: Jira integration — create/update issues, transition workflow states
- feat: image understanding capability — GPT-4o and Claude vision models can process uploaded images
- feat: unified search modal (`Ctrl+Shift+F`) with dual-mode quick local search and deep server search

### Changed
- refactor: `server/storage.ts` abstracted behind a Storage interface to support S3-compatible backends
- change: default model for complex tasks changed from GPT-4-turbo to claude-3-5-sonnet for cost/quality ratio

### Fixed
- fix: table artifact sorter failed on columns with mixed numeric/string values
- fix: concurrent message submissions to the same chat caused ordering inconsistencies in the database

---

## [0.3.0] - 2025-07-12

### Added
- feat: i18n support — 103 locale files, locale auto-detection from browser `Accept-Language` header
- feat: Electron desktop app wrapper with native menu, auto-update, and offline mode detection
- feat: Chrome browser extension for in-page chat overlay
- feat: Auth0 as a third OAuth provider option alongside Google and Microsoft
- feat: Zustand `agentStore` and `streamingStore` for fine-grained streaming state management in the frontend

### Changed
- change: frontend routing migrated from React Router to Wouter for smaller bundle size
- perf: Vite build now outputs separate chunks for vendor, agent UI, and artifact renderers — 35% reduction in initial bundle

### Fixed
- fix: Safari 15 incompatibility with `ReadableStream` in the SSE client polyfill
- fix: `db:migrate` silently skipped failed migrations — now exits with code 1 on any migration error

---

## [0.2.0] - 2025-05-20

### Added
- feat: multi-chat workspace — users can create, rename, and delete named chats; conversation history persisted per chat
- feat: PostgreSQL-backed session store (`connect-pg-simple`) replacing in-memory sessions
- feat: pgvector extension support — initial semantic search over messages
- feat: Slack bot integration (read messages, post replies)
- feat: environment variable validation via Zod in `server/config/env.ts` — server fails fast on misconfiguration

### Changed
- change: all API routes migrated to Express Router modules; monolithic `server/routes.ts` split into domain sub-routers

### Fixed
- fix: Google OAuth callback redirected to wrong URL when `APP_URL` contained a trailing slash
- fix: chat history did not paginate — loading a chat with >500 messages caused UI freeze

---

## [0.1.0] - 2025-03-01

Initial alpha release of IliaGPT — a full-stack AI chat platform with multi-provider support.

### Added
- feat: Express.js API server with React 18 + Vite frontend
- feat: basic chat interface with streaming SSE responses
- feat: OpenAI and Anthropic provider support
- feat: PostgreSQL database with Drizzle ORM; Zod schema definitions in `shared/schema.ts`
- feat: Google OAuth authentication with Passport.js
- feat: basic Docker Compose setup for local development

---

[Unreleased]: https://github.com/iliagpt/iliagpt/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/iliagpt/iliagpt/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/iliagpt/iliagpt/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/iliagpt/iliagpt/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/iliagpt/iliagpt/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/iliagpt/iliagpt/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/iliagpt/iliagpt/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/iliagpt/iliagpt/releases/tag/v0.1.0
