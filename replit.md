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

**Image Generation** (`server/services/imageGeneration.ts`): Multi-provider image generation with priority cascade: Gemini (imagen-3.0, gemini-2.0-flash-exp) → xAI Grok (grok-2-image-1212) → OpenRouter (gemini-2.5-flash-image, gemini-3.1-flash-image-preview, gpt-5-image-mini, gpt-5-image, gemini-3-pro-image-preview). OpenRouter provider extracts base64 from response content, data URLs, or fetches linked images. All providers track costs via `mediaGenerationCostTracker`. APIs: `POST /api/image/generate`, `POST /api/image/detect`, `POST /api/video/generate`, `POST /api/video/detect`, `POST /api/media/detect`.

**Video Generation** (`server/services/videoGeneration.ts`): LLM-powered video storyboard generation using OpenRouter models (gemini-2.5-flash-preview, gemini-2.5-pro-preview). Generates structured JSON storyboards with scenes, camera movements, audio cues, color palettes, and production notes. Budget-checked before execution. Detects video requests in ES/EN (genera video, create video, animate, etc.).

**Media Cost Tracker** (`server/services/mediaGenerationCostTracker.ts`): Unified cost tracking for all media generation (image/video/audio). Per-model pricing registry. Budget enforcement: daily ($10), monthly ($100), per-request ($2) limits with configurable thresholds. APIs: `GET /api/media/cost/stats`, `POST /api/media/cost/budget` (update limits), `POST /api/media/cost/check` (pre-flight budget check). Emits `media_cost` and `budget_warning` events.

A Governance Mode System defines explicit modes (SAFE, SUPERVISED, AUTOPILOT, RESEARCH, EMERGENCY_STOP) with distinct permissions, human approval workflows, and a forensic-grade audit trail. A Security-Plane includes prompt injection detection, output sanitization, and real-time security monitoring. Budget SSE Events & Cost-Aware Routing provide real-time budget tracking and cost-optimized model routing. Admin Dashboards offer comprehensive views for governance, security, SRE, and model experiments. A Knowledge Graph extracts entities and relationships, providing graph-augmented RAG. Model A/B Testing & Provider Evaluation manages experiments, evaluates providers, and handles canary deployments. A Voice Plane provides STT/TTS abstraction, call session management, and voice guardrails. A Semantic Cache offers similarity-based response caching. Data Plane REST APIs provide event history and statistics. Enhanced Computer-Control-Plane extends capabilities with input automation, remote sessions, and screen analysis. DAG Orchestration Visualization provides a real-time, interactive view of agent task execution.

**SuperOrchestrator v1 (EXPERIMENTAL)** (`server/agent/superOrchestrator/`): Distributed agent execution with DAG scheduling and BullMQ persistent queue. Auto-initializes on first submitRun() call. Default task handler is a stub (returns stub_executed status). task:inline fallback executes tasks synchronously when queue unavailable. Core files: `index.ts` (main orchestrator class — submitRun, cancelRun, pauseRun, resumeRun, getStats), `dagScheduler.ts` (DAG execution engine with dependency resolution, concurrency limits, failure cascading), `taskExecutor.ts` (per-task execution with retry, cost tracking, artifact storage), `queue.ts` (BullMQ queue with exponential backoff, dead letter), `governance.ts` (global kill switch <2s, per-run budget auto-pause, time limits, risk approval gating for dangerous/critical tasks), `agentRoles.ts` (100 agent roles across 10 categories with risk levels safe/moderate/dangerous/critical). DB schema: `shared/schema/orchestrator.ts` — 4 tables: `orchestrator_runs`, `orchestrator_tasks`, `orchestrator_approvals`, `orchestrator_artifacts`. Admin dashboard: `client/src/components/admin/SuperOrchestrator.tsx`. API routes: `/api/orchestrator/*` (runs CRUD, cancel/pause/resume, stats, roles, kill-switch, approve/deny).

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

**Agentic Pipeline Activation (2026-03-02)**: Set `AGENTIC_CHAT_ENABLED=true` as shared env var to enable the agentic pipeline in chat. Feature flag flow: `server/config/features.ts` → `isAgenticEnabled()` → `shouldUseAgenticPipeline()` (pattern matching) → `AgentLoopFacade.execute()` → `SupervisorAgent` → `toolRegistry`. The agentic tool registry (`server/agent/registry/`) is independent from OpenClaw modules — no `ENABLE_OPENCLAW_*` vars needed. Requires `XAI_API_KEY` (already configured). Startup log added in `features.ts` to confirm flag values.

## External Dependencies
### AI Services
- **OpenRouter**: Active AI model endpoint.
- **Redis**: Caching, SSE streaming, and conversation memory.
- **LangGraph + LangChain**: Agent orchestration and workflow management.

### Database
- **PostgreSQL**: Primary relational database.
- **Drizzle Kit**: Database schema migrations.

### External APIs
- **Piston API**: Multi-language code execution.
- **World Bank API V2**: Economic data retrieval.
- **Gmail API**: Gmail chat integration.