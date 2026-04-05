# IliaGPT

## Overview
IliaGPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation. The ambition is for IliaGPT to become a leading AI assistant for productivity.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
IliaGPT employs a monorepo structure, separating client, server, and shared components, ensuring type safety with Zod schemas. The frontend uses React, TypeScript, Vite, shadcn/ui, and Tailwind CSS for a modern, themable interface with light/dark mode support, featuring chat management, prompt templates, PWA, keyboard shortcuts, and rendering of Markdown, code, and mathematical expressions. Data visualization is handled by Recharts, ECharts, and TanStack Table. Performance is optimized with virtualization, memoization, lazy loading, and streaming UX.

The backend is built with Node.js and Express.js, featuring an LLM Gateway for AI model interactions with multi-provider fallback, caching, token tracking, and circuit breakers. It supports agentic tool calling, including OpenAI-compatible function calling and an ETL Agent for economic data. A Multi-Intent Pipeline handles complex prompts, and a PARE System processes documents with per-document citations. A Document Generation System uses LLM orchestration for Excel and Word files, complemented by a Spreadsheet Analyzer Module for AI-powered analysis within a secure Python sandbox.

The system features an AGENTOS-ASI Cerebro Pipeline, a neuro-symbolic hierarchical agent with Planner, Executor, Critic, and Judge stages, and a WorldModel for tracking environment state. A Multi-Model Router handles policy-based routing across model tiers with circuit breakers. Universal Tool Calling supports over 10 model output formats and includes a Tool Execution Engine for unified execution, health monitoring, and error classification. An Agent Executor handles tool dispatch with aliasing and parameter normalization.

Authentication uses Google OAuth with a robust identity resolution process and auto-migration for user profile fields. Agentic Mode is always `true`, with intent-aware tool forcing and execution plan SSE events for structured progress tracking. The system includes a secure File-Plane, a Computer-Control-Plane for command governance, a Skills Kernel for enhanced tool management, and an Enhanced Memory System. Event Sourcing and OpenTelemetry Tracing are used for agent runs. A RAG++ Service provides enhanced document understanding.

Frontend components offer live streaming tool output, real-time DAG visualization of agent execution, run replay, plan diff viewing, and budget dashboards. The system supports Super-Agent Proactive Behavior, an Agent Soul & Personality system, a Deep Research Agent, and Continuous Self-Improvement. A modular plugin architecture, StateMachine, Typed Contracts, and a PolicyEngine form the core Agent Infrastructure. A Tool Registry provides 103 sandboxed agent tools, and Agent Orchestration uses a Manus-like architecture and LangGraph with human-in-the-loop approvals. A Python Agent Tools System (FastAPI microservice) and a TypeScript Tool Execution Engine provide unified tool execution.

The system integrates live OpenRouter API for fetching a comprehensive model catalog. Multi-provider Image and Video Generation capabilities are included, along with a Media Cost Tracker for unified cost tracking and budget enforcement. A Governance Mode System defines explicit operational modes with permissions and audit trails. Security-Plane features prompt injection detection and output sanitization.

A SuperOrchestrator v1 (EXPERIMENTAL) provides distributed agent execution with DAG scheduling and BullMQ persistent queues, including governance features like kill switches and budget auto-pause. An in-chat advertising platform, IliaADS, serves contextual ads based on conversation content. The search UX has been overhauled with URL paste fixes, intent-aware search labels, a unified source panel with academic citations, and deep search capabilities with progress tracking. Content rendering is enhanced for professional-grade markdown with citation-aware formatting. The Intent Engine has been improved with new intent types (`CITATION_FORMAT`, `ACADEMIC_SEARCH`, `FACT_CHECK`) and enhanced constraint extraction.

The system is designed for scalability, supporting 100M simultaneous users with optimized DB pools, Redis-backed rate limiting, compression, response caching, and socket hardening. Free users are restricted to specific free-tier models. Cerebras Direct Provider is integrated for faster inference when `CEREBRAS_API_KEY` is set. OCR for non-vision models extracts text from images when the active model doesn't support vision. A Workspace Agent System provides an agentic coding engine for the Codex VC workspace with SSE-streaming endpoints.

### Security: Anonymous User Protection (2026-04-05)
- **Anonymous users are blocked** from creating chat sessions (POST /chat, /chat/stream, /voice-chat). All chat endpoints now require Google OAuth authentication.
- **`ensureUserRowExists`** no longer creates database rows for anonymous (`anon_*`) users, preventing untraceable account proliferation.
- **IP/User-Agent tracking**: Authenticated user creation now captures `lastIp` and `userAgent` from the request.
- **50 anonymous users suspended**: Existing anonymous "Guest-anon" accounts with `authProvider: "anonymous"` were bulk-suspended.
- **Admin panel enhanced**: Security overview banner shows anonymous/no-email/verified counts; auth provider filter added; anonymous users display red shield warning indicators.

## External Dependencies
### AI Services
- **OpenRouter**: Primary AI provider for various models.
- **Redis**: Caching, SSE streaming, and conversation memory.
- **LangGraph + LangChain**: Agent orchestration and workflow management.
- **Cerebras AI**: Direct model inference (when `CEREBRAS_API_KEY` is set).

### Database
- **PostgreSQL**: Primary relational database.
- **Drizzle Kit**: Database schema migrations.

### External APIs
- **Piston API**: Multi-language code execution.
- **World Bank API V2**: Economic data retrieval.
- **Gmail API**: Gmail chat integration.
- **DuckDuckGo**: Web search functionality.
- **Playwright**: Browser automation.
- **Tesseract.js**: OCR for image text extraction.

### OpenClaw Integration
- **OpenClaw Control UI** (`openclaw@2026.4.2`): Served at `/openclaw-ui` with auto-connect boot script. A `<base href="/openclaw-ui/">` tag is injected so relative asset paths resolve correctly. The boot script calls `applySettings()` with the correct WebSocket URL (`ws://host/openclaw-ws`) and then `connect()` — no manual user interaction required.
- **WebSocket Gateway**: `server/services/openclawGateway.ts` accepts upgrades at `/openclaw-ws` (primary) and `/openclaw-ui` (fallback). Attached before routes in `server/index.ts`.
- **Key files**: `server/routes.ts` (`serveControlUiWithAutoConnect`), `server/vite.ts` (SPA fallback exclusions for `/openclaw-ui`, `/openclaw-ws`, `/openclaw-boot`), `client/src/pages/openclaw.tsx` (iframe wrapper).

### RAG Pipeline (Production-Grade)
- **File**: `server/rag/UnifiedRAGPipeline.ts` — complete production pipeline with 4 stages:
  1. **PgVectorIndexStage**: Inserts chunks into `rag_chunks` table with content-hash dedup (`ON CONFLICT (user_id, content_hash)`), updates tags/source/metadata on conflict, BM25-enriched `search_vector` with filename/heading/title boosting.
  2. **PgVectorHybridRetrieveStage**: Hybrid search combining pgvector cosine similarity + PostgreSQL `ts_rank_cd` BM25, fused via Reciprocal Rank Fusion (RRF). Supports `userId`/`tenantId` isolation for multi-tenant security. `hybridAlpha` clamped to [0,1].
  3. **ScoreBasedRerankStage**: Composite scoring (60% retrieval + 25% term overlap + proximity boost + type boost). Regex-escaped query tokens prevent adversarial injection. Configurable relevance threshold filters low-quality results.
  4. **RobustGenerateStage**: Multi-provider retry (openai → openrouter/kimi-k2.5 → gemini → xai) with explicit provider/model per attempt, `skipCache: true`, `enableFallback: false`. System prompt included. LLM response validation (empty/refusal/garbage/length checks).
- **Security**: `sanitizeRAGContent()` strips system tags; `detectPlaceholderInjection()` blocks template injection; `buildRAGPrompt()` validates template has required `[context]`/`[query]` placeholders and enforces max length.
- **Supporting files**: `server/services/rag/promptContextBuilder.ts` (sanitizes all RAG chunks), `server/services/responseQuality.ts` (per-provider response quality metrics).