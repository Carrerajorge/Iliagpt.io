# IliaGPT

## Overview
IliaGPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation. The ambition is for IliaGPT to become a leading AI assistant for productivity.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
IliaGPT is built with a monorepo structure, separating client, server, and shared components, ensuring type safety with Zod schemas. The frontend uses React, TypeScript, Vite, shadcn/ui, and Tailwind CSS for a modern, themable interface with light/dark mode support. It features chat management, prompt templates, PWA, keyboard shortcuts, and renders Markdown, code, and mathematical expressions. Data visualization is handled by Recharts, ECharts, and TanStack Table, supporting SVG, Canvas 2D, and 3D. Performance is optimized with virtualization, memoization, lazy loading, and streaming UX. Security includes DOMPurify, frontend rate limiting, and MIME type validation. A file preview system supports various document types.

The backend uses Node.js and Express.js, featuring an LLM Gateway for AI model interactions with multi-provider fallback, caching, token tracking, and circuit breakers. Agentic tool calling is supported, including OpenAI-compatible function calling and an ETL Agent for economic data. A Multi-Intent Pipeline handles complex prompts, and a PARE System processes documents with per-document citations. A Document Generation System uses LLM orchestration for Excel and Word files. The Spreadsheet Analyzer Module provides AI-powered analysis and a secure Python sandbox.

Integrated agentic tools from OpenClaw v2026.3.1 include `bash` (hardened), `web_fetch`, `web_search` (DuckDuckGo), file operations, `run_code` (isolated Python/Node), process management, and RAG indexing. The agent executor uses OpenAI-compatible API calls via OpenRouter.

The AGENTOS-ASI Cerebro Pipeline is a neuro-symbolic hierarchical agent with Planner, Executor, Critic, and Judge stages. A WorldModel tracks environment state. A Multi-Model Router handles policy-based routing across model tiers with circuit breakers. A Token Budget Manager tracks token usage and costs. Prompt Injection Hardening detects and mitigates various injection attacks. Capability Discovery maps tasks to tool combinations. The agent loop includes exponential backoff retries, circuit breakers for tools, parallel tool execution, high-risk action detection, and memory persistence via RAG.

The File-Plane is a secure file gateway with multi-format parsing, access control, audit logging, and RAG chunk generation. The Computer-Control-Plane provides terminal/command governance with risk classification, a kill switch, and session recording. A Skills Kernel offers enhanced tool management with RBAC/ABAC, idempotency, compensation/rollback, and skill composition. An Enhanced Memory System combines episodic and project memory with privacy controls. Event Sourcing uses a CQRS pattern with deterministic replay for agent runs. OpenTelemetry Tracing provides lightweight, OTel-compatible tracing for agent execution. A RAG++ Service offers enhanced document understanding with hybrid scoring, query rewriting, LLM-based reranking, multi-hop retrieval, and evidence packs.

Frontend components provide live streaming tool output, real-time DAG visualization of agent execution, replay of agent runs, plan diff viewing, and budget dashboards. The system supports Super-Agent Proactive Behavior with intent detection, the CEREBRO pipeline for non-chat intents, and an AGENTOS-ASI system prompt emphasizing tool-first behavior. An Agent Soul & Personality system manages identity, human bonding, and initiative. A Deep Research Agent provides multi-phase research capabilities. Continuous Self-Improvement tracks performance, evolves skills, and extracts lessons. MCP Auto-Discovery & Skill Acquisition manages external tool integration. A Parallel Sub-Agent Orchestrator spawns and manages sub-agents.

The core Agent Infrastructure features a modular plugin architecture, StateMachine, Typed Contracts, Event Sourcing, a PolicyEngine, and an ExecutionEngine with circuit breakers. A Tool Registry provides 103 sandboxed agent tools. Agent Orchestration uses a Manus-like architecture and LangGraph for workflow management with human-in-the-loop approvals. A GPT Session Contract System ensures immutable, secure GPT configurations. A Python Agent Tools System (FastAPI microservice) and a TypeScript Tool Execution Engine provide unified tool execution. An Enhanced AI Excel Router offers production-grade Excel AI operations.

**Live OpenRouter API Integration** (`server/services/aiModelSyncService.ts`): Fetches the complete model catalog (342+ models across 57+ providers) live from `https://openrouter.ai/api/v1/models`. Functions: `fetchOpenRouterModels()` (raw API fetch with 30s timeout), `syncFromOpenRouter(options)` (sync to DB with provider filter, free-only filter, dry-run mode, batch-optimized single DB fetch). Infers model type from architecture modality (TEXT/IMAGE/MULTIMODAL/AUDIO/EMBEDDING). Public API: `GET /api/openrouter/models?search=&provider=&free=true&page=&limit=` (paginated catalog with 5-min server cache). Admin API: `GET /api/admin/models/openrouter/catalog`, `POST /api/admin/models/openrouter/sync`. Bulk sync: `POST /api/openrouter/sync-all`. All 389 models enabled and active across 58 providers (240 text, 140 multimodal, 5 audio, 2 image).

**Image Generation** (`server/services/imageGeneration.ts`): Multi-provider image generation with priority cascade: Gemini (gemini-3.1-flash-image-preview, imagen-3.0, gemini-2.0-flash-exp) → xAI Grok (grok-2-image-1212) → OpenRouter (gemini-3.1-flash-image-preview, gemini-2.5-flash-image, gpt-5-image-mini, gpt-5-image, gemini-3-pro-image-preview). OpenRouter response parsing handles: `message.image`, `message.images[]` (objects with `{type, image_url}` format — the actual OpenRouter image return format), `content` base64 data URLs, and content array parts with `inline_data`/`image_url`. All providers track costs via `mediaGenerationCostTracker`. APIs: `POST /api/image/generate`, `POST /api/image/detect`, `POST /api/video/generate`, `POST /api/video/detect`, `POST /api/media/detect`.

**Video Generation** (`server/services/videoGeneration.ts`): LLM-powered video storyboard generation using OpenRouter models (google/gemini-2.5-flash, google/gemini-2.5-flash-lite). Generates structured JSON storyboards with scenes, camera movements, audio cues, color palettes, and production notes. Budget-checked before execution. Detects video requests in ES/EN (genera video, create video, animate, etc.).

**Media Cost Tracker** (`server/services/mediaGenerationCostTracker.ts`): Unified cost tracking for all media generation (image/video/audio). Per-model pricing registry. Budget enforcement: daily ($10), monthly ($100), per-request ($2) limits with configurable thresholds. APIs: `GET /api/media/cost/stats`, `POST /api/media/cost/budget` (update limits), `POST /api/media/cost/check` (pre-flight budget check). Emits `media_cost` and `budget_warning` events.

A Governance Mode System defines explicit modes (SAFE, SUPERVISED, AUTOPILOT, RESEARCH, EMERGENCY_STOP) with distinct permissions, human approval workflows, and a forensic-grade audit trail. A Security-Plane includes prompt injection detection, output sanitization, and real-time security monitoring. Budget SSE Events & Cost-Aware Routing provide real-time budget tracking and cost-optimized model routing. Admin Dashboards offer comprehensive views for governance, security, SRE, and model experiments. A Knowledge Graph extracts entities and relationships, providing graph-augmented RAG. Model A/B Testing & Provider Evaluation manages experiments, evaluates providers, and handles canary deployments. A Voice Plane provides STT/TTS abstraction, call session management, and voice guardrails. A Semantic Cache offers similarity-based response caching. Data Plane REST APIs provide event history and statistics. Enhanced Computer-Control-Plane extends capabilities with input automation, remote sessions, and screen analysis. DAG Orchestration Visualization provides a real-time, interactive view of agent task execution.

**SuperOrchestrator v1 (EXPERIMENTAL)** (`server/agent/superOrchestrator/`): Distributed agent execution with DAG scheduling and BullMQ persistent queue. Auto-initializes on first submitRun() call. Default task handler is a stub (returns stub_executed status). task:inline fallback executes tasks synchronously when queue unavailable. Core files: `index.ts` (main orchestrator class — submitRun, cancelRun, pauseRun, resumeRun, getStats), `dagScheduler.ts` (DAG execution engine with dependency resolution, concurrency limits, failure cascading), `taskExecutor.ts` (per-task execution with retry, cost tracking, artifact storage), `queue.ts` (BullMQ queue with exponential backoff, dead letter), `governance.ts` (global kill switch <2s, per-run budget auto-pause, time limits, risk approval gating for dangerous/critical tasks), `agentRoles.ts` (100 agent roles across 10 categories with risk levels safe/moderate/dangerous/critical). DB schema: `shared/schema/orchestrator.ts` — 4 tables: `orchestrator_runs`, `orchestrator_tasks`, `orchestrator_approvals`, `orchestrator_artifacts`. Admin dashboard: `client/src/components/admin/SuperOrchestrator.tsx`. API routes: `/api/orchestrator/*` (runs CRUD, cancel/pause/resume, stats, roles, kill-switch, approve/deny).

**Critical Fixes Applied (2026-03-03)**:
- RequestUnderstanding: `coercePlannerBrief()` now pre-populates missing required fields (`intent`, `subtasks`, `deliverable`, `audience`, `expected_output`) via `buildHeuristicBrief()` before Zod parse, preventing Zod validation crashes on sparse LLM responses.
- RequestUnderstanding: `callPlannerWithJsonFallback()` returns heuristic brief instead of throwing when all LLM retries fail.
- Orchestrator: `buildBrief()` wrapped in try-catch with inline heuristic fallback brief.
- Critic stage: Only blocks execution when `missing_objective && score < 0.3` (was blocking on any self-check failure, preventing simple search queries from executing).
- Note: xAI API key is blocked (403 "API key leak") — affects `LLMExtractor` but heuristic fallback works. Key rotation recommended.
- Image Generation: OpenRouter `message.images[]` array parsing added — handles `{type, image_url: {url}}` object format (the actual format returned by OpenRouter for image models). Also handles `image_url` as direct string, data URIs, and HTTP URLs. Working model: `google/gemini-3.1-flash-image-preview` via OpenRouter (~10-13s per image).

**Critical Fixes Applied (2026-03-02)**:
- OpenClaw routes: Verification API at `/api/openclaw`, Runtime API at `/api/openclaw/runtime` (previously both at `/api/openclaw` causing route shadowing)
- QA Pipeline: Verification crashes now return `passed: false, score: 0` instead of false-positive `passed: true, score: 1`. Pipeline `success` reflects QA result.
- Feature Flags: Unified to `FEATURES.AGENTIC_CHAT_ENABLED` via `isAgenticEnabled()` (runtime-mutable via admin). Removed legacy `AGENTIC_PIPELINE_ENABLED` env var.
- SupervisorAgent: Lazy-init xAI client with fail-fast error on missing `XAI_API_KEY`. Base URL configurable via `XAI_BASE_URL`.
- OpenClaw Tools: Path traversal validation, shell command blocklist, dangerous code pattern detection added. `execute_code` description corrected (NOT sandboxed).
- Certification: `scripts/agent-certify.ts` now requires both exit code 0 AND zero failed tests for PASSED status.

**Browser Plane** (`server/agent/browser/`): Playwright-based browser automation with session management. API routes: `/api/browser/*` (sessions CRUD, navigate, action execution, stats). Admin dashboard: `client/src/components/admin/BrowserPlane.tsx`. Session manager supports click, type, scroll, wait, evaluate, screenshot.

**Deep Research Agent** (`server/agent/research/`): Multi-phase research engine with query decomposition, literature search, evidence extraction, cross-reference verification, and synthesis. API routes: `/api/research/*` (start, sessions list/detail, cancel, report, stats). Admin dashboard: `client/src/components/admin/DeepResearch.tsx`. In-memory session tracking with async execution.

**Observability & Tracing**: System metrics (CPU, memory, uptime, request rates), service health checks (database, redis, server), latency percentiles (p50/p95/p99), error rates. API routes: `/api/observability/*` (traces, metrics, health, stats, orchestrator). Admin dashboard: `client/src/components/admin/ObservabilityDashboard.tsx`.

**Chaos Testing Engine** (`server/agent/superOrchestrator/chaosEngine.ts`): Fault injection framework with 6 experiment types (kill-random-agent, inject-latency, fail-percentage, budget-spike, network-partition, queue-flood). Safety: auto-stop timer, production-blocked. Global chaos flags for latency/failure injection. API routes: `/api/chaos/*` (experiments CRUD, stop, stats). Admin dashboard: `client/src/components/admin/ChaosTestingDashboard.tsx`.

Infrastructure security includes bcrypt, multi-tenant validation, authentication middleware, and robust security headers. Scalability is achieved via Redis SSE, memory caching, response caching, request deduplication, compression, circuit breakers, rate limiting, and graceful shutdown. Robust production-grade systems manage large documents, dialogue, memory leaks, and provide self-healing capabilities.

PostgreSQL with Drizzle ORM is used for persistent data storage. Client-side persistence uses `localStorage` and IndexedDB.

**Performance Optimizations (2026-03-02)**: Frontend polling reduced — `/api/settings/public` refetch every 120s (staleTime 60s), `/api/models/available` refetch every 120s (staleTime 60s, gcTime 5min). Server-side in-memory caching (30s TTL) for both endpoints. Quiet logging for high-frequency polling routes (`/api/settings/public`, `/api/models/available`, `/health`) — skipped in both `requestLogger` and `requestTracer`. Default log level set to `info` (was `debug` in dev). Vite build uses manual chunks (vendor, ui) and optimizeDeps for faster cold starts.

**Scalability Architecture (2026-04-02)**: Designed for 100M simultaneous users.
- **DB Pools**: Write pool max=100 (prod), Read pool max=150 (prod) with keepAlive and tuned timeouts. Config in `server/config/scalability.ts`.
- **Rate Limiting**: Global 600 req/min, AI 120 req/min, Auth 15/15min with 5min block. Redis-backed with in-memory fallback. Config in `server/middleware/rateLimiter.ts`.
- **Redis**: connectTimeout=5s, commandTimeout=3s, keepAlive=30s, enableOfflineQueue=true. Config in `server/lib/redis.ts`.
- **Compression**: Level 6, threshold 512B, memLevel 8. Skips SSE/octet-stream/x-no-compression. Config in `server/index.ts`.
- **Response Cache**: TTL 120s (prod), max cacheable 10MB, stale-while-revalidate 60s (prod). Config in `server/middleware/responseCache.ts`.
- **Static Assets**: `/assets/*` served with 1-year immutable cache. HTML served with no-cache. Config in `server/static.ts`.
- **Socket Hardening**: maxConnectionsPerIP=500 (prod), requestTimeout=300s (prod), cleanup every 30s. Config in `server/middleware/socketHardening.ts`.
- **Vite Build**: 8-way manual chunk splitting (react-dom, react-core, ui-radix, ui-icons, ui-motion, charts, editor, vendor). Terser with drop_console, 2 passes. Config in `vite.config.ts`.

**Agentic Pipeline Activation (2026-03-02)**: Set `AGENTIC_CHAT_ENABLED=true` as shared env var to enable the agentic pipeline in chat. Feature flag flow: `server/config/features.ts` → `isAgenticEnabled()` → `shouldUseAgenticPipeline()` (pattern matching) → `AgentLoopFacade.execute()` → `SupervisorAgent` → `toolRegistry`. The agentic tool registry (`server/agent/registry/`) is independent from OpenClaw modules — no `ENABLE_OPENCLAW_*` vars needed. Requires `XAI_API_KEY` (already configured). Startup log added in `features.ts` to confirm flag values.

**Agentic Pipeline Fixes (2026-03-03)**: (1) `shouldUseAgenticPipeline()` patterns significantly expanded — now matches most substantive queries (search, explain, create, help, compare, analyze, recommend, etc.) and any message ≥8 words, with only simple greetings/acknowledgments excluded. (2) `realWebSearch` upgraded from Wikipedia-only to DuckDuckGo via `searchWeb()` with Wikipedia fallback. (3) Detailed console logging added at every pipeline decision point (`[ChatService:AgenticPipeline]` and `[AgentLoopFacade]` prefixes) for diagnosing activation and execution issues. Pipeline evaluation order: Gmail → Document Analysis → DeterministicPipeline → AgenticPipeline → ImmediateSearch → ProductionWorkflow → MultiIntent → LegacyRouter.

**GitHub Merge: Carrerajorge/Hola (2026-04-02)**: Merged 87+ new files including: `server/cognitive_kernel/` (9 files — bootloader, kernel, stitcher, session manager), `server/workflow/` (workflow runner), 33 new services (agentEcosystem, browser-use, browserAutomation, cognitiveKernel, dataVisualization, deepComposer, documentParser, googleGeminiCliOAuth, hardwareTelemetry, livekit, messageLifecycle, nodes, o3Reasoner, openAICodexOAuth, oracleDecisionTree, providerOAuth, ragflow, superProgrammingAgent, tenaga, workflowTrace, etc.), 11 new route files (agentEcosystemRouter, googleGeminiCliOAuthRouter, hardwareTelemetryRouter, livekitRouter, messageLifecycleRouter, nodesRouter, openAICodexOAuthRouter, providerOAuthRouter, ragflowRouter, superProgrammingAgentRouter, workflowTraceRoutes), 10 shared files, 2 new DB schemas (nodes.ts, oauthProviderTokens.ts), 5 new client components, agent subdirectories (advancedOrchestrator, context, runtime, selfExpand, tenaga). New routes use lazy dynamic `import()` to avoid crashing the app when deeper OpenClaw dependencies are missing — they log warnings and skip gracefully.

**OpenRouter Integration Fixes (2026-04-02)**:
- **API Key Priority**: When `OPENAI_BASE_URL` points to OpenRouter, `OPENROUTER_API_KEY` is now used first (over stale `OPENAI_API_KEY`). Fixed in `getOpenAICompatibleClient()`.
- **Default Model**: Changed from `minimax/minimax-m2.5` to `google/gemma-3-12b-it:free` (free tier, no credits needed). All default models (text, reasoning, vision) use this.
- **Model Names Fixed**: `google/gemini-2.5-flash-preview` → `google/gemini-2.5-flash` (valid OpenRouter ID). Video models updated similarly.
- **Provider Detection**: Slash-format models (e.g. `google/gemini-2.5-flash`) route to "openai" provider (OpenRouter). All unknowns default to "openai".
- **Max Tokens**: Fast lane capped at 800 tokens (was 1200) for cost efficiency.
- **Broken Providers**: xAI (403 blocked), Gemini (key expired). Only OpenRouter works.

## External Dependencies
### AI Services
- **OpenRouter**: Primary AI provider. Key: `OPENROUTER_API_KEY`. Default model: `google/gemma-3-12b-it:free`.
- **Redis**: Caching, SSE streaming, and conversation memory.
- **LangGraph + LangChain**: Agent orchestration and workflow management.

### Database
- **PostgreSQL**: Primary relational database.
- **Drizzle Kit**: Database schema migrations.

### External APIs
- **Piston API**: Multi-language code execution.
- **World Bank API V2**: Economic data retrieval.
- **Gmail API**: Gmail chat integration.

**IliaADS** (`server/routes/adsRouter.ts`, `client/src/pages/ilia-ads.tsx`, `client/src/components/ilia-ad-banner.tsx`): Contextual advertising system for monetizing free users. Ads are matched against user queries/response content using keyword scoring and displayed below the copy/like/dislike action toolbar on AI messages. Features: ad creation/management dashboard at `/ads`, keyword-based contextual matching (`GET /api/ads/match?q=...`), impression/click tracking, budget controls (cost per impression, daily/total budgets), geographic targeting (country, min age), Advantage+ audience mode. DB tables: `ilia_ads`, `ad_impressions`. Routes: `/api/ads/match` (public), `/api/ads/impression`, `/api/ads/click` (anonymous tracking), `/api/ads/list`, `/api/ads/create`, `/api/ads/stats`, `PATCH/DELETE /api/ads/:id` (all require auth). Sidebar entry below "Mis Memorias" as "IliaADS".

**Free-Tier Model Lock** (`client/src/lib/planUtils.ts`, `client/src/components/chat/StandardModelSelector.tsx`, `client/src/contexts/ModelAvailabilityContext.tsx`, `server/lib/modelRegistry.ts`): Free users are restricted to `openai/gpt-oss-120b:free` (OpenRouter free tier). Constants: `FREE_MODEL_ID` in both `planUtils.ts` (frontend) and `modelRegistry.ts` (backend). `isFreeTierUser()` in `planUtils.ts` determines free status via `getEffectivePlan()` — admins are NOT treated as free. `StandardModelSelector` shows lock emoji (🔒) on non-free model options for free users; locked options are `disabled` in the native select. `ModelAvailabilityContext` forces free model selection for free users. Fallback model list in `server/routes.ts` includes `openai/gpt-oss-120b:free` with `displayOrder: -1` (sorts first). The `:free` suffix is required for OpenRouter's zero-cost routing.

**Cerebras Direct Provider** (`server/lib/llmGateway.ts`, `server/config/env.ts`): When `CEREBRAS_API_KEY` is set and the model contains `gpt-oss`, requests are routed directly to `https://api.cerebras.ai/v1` instead of OpenRouter for faster inference. Model ID is normalized: `openai/gpt-oss-120b:free` → `gpt-oss-120b`. Provider detection: `detectProviderFromModel()` returns `"cerebras"` when applicable. Both streaming and non-streaming paths use the OpenAI-compatible client.

**OCR for Non-Vision Models** (`server/services/ocrService.ts`, `server/services/chatService.ts`, `server/routes/chatAiRouter.ts`): Tesseract.js v6 OCR extracts text from images when the active model doesn't support vision (e.g., `gpt-oss-120b`, `gemma`). Both streaming (`chatAiRouter.ts`) and non-streaming (`chatService.ts`) paths detect non-vision models and process images via `performOCR()` — extracted text is injected as `[TEXTO EXTRAÍDO DE IMAGEN(ES) VÍA OCR]` context into the user message instead of sending multimodal `image_url` parts. Vision-capable models continue using the standard multimodal pipeline. The streaming path uses `effectiveModel` (not raw `model`) to correctly detect non-vision models even when the model is session-enforced or defaulted.

**Frontend Performance Optimization** (`vite.config.ts`, contexts): Vite build splits the monolithic vendor chunk (~6.7MB) into granular chunks: `react-core`, `react-dom`, `ui-radix`, `ui-icons`, `ui-motion`, `charts`, `editor`, `query` (@tanstack/react-query), `router` (wouter), `rendering` (marked/highlight.js/katex), `schema` (zod/drizzle), `utils` (date-fns/lodash/clsx/cva/tailwind-merge), `forms` (react-hook-form), `network` (axios/ky/socket.io), `i18n`, `security` (dompurify), plus a remaining `vendor` catch-all. React Query contexts use extended staleTime/refetchInterval to reduce API call waterfall on load: auth (60s stale, focus refetch), models (180s stale, 5min interval), platform settings (5min stale, 10min interval). Terser minification with `pure_funcs` for console removal.

## Navigation Flow
- **`/`** → `ProjectsDashboard` — Replit-style homepage with greeting, project input, quick-start options, recent projects grid (Spanish UI)
- **`/chat/new`** → `Home` (new chat mode) — Opens chat interface in new conversation mode
- **`/chat/:id`** → `Home` (existing chat) — Opens chat interface with a specific conversation loaded
- **Sidebar logo click** → navigates to `/` (dashboard)
- **"Nuevo chat" button** (sidebar & dashboard) → navigates to `/chat/new`
- **Ctrl/Cmd+N** → navigates to `/chat/new`
- **Project card click** (dashboard) → navigates to `/chat/:id`
- **`/ads`** → `IliaAdsPage` — IliaADS ad management dashboard (requires auth)