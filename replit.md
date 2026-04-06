# IliaGPT

## Overview
IliaGPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation. The ambition is for IliaGPT to become a leading AI assistant for productivity.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
IliaGPT employs a monorepo structure with distinct client, server, and shared components, enforcing type safety with Zod schemas.

The frontend, built with React, TypeScript, Vite, shadcn/ui, and Tailwind CSS, provides a modern, themable interface supporting light/dark modes. Key UI features include chat management, prompt templates, PWA capabilities, keyboard shortcuts, and rich rendering of Markdown, code, and mathematical expressions. Data visualization is powered by Recharts, ECharts, and TanStack Table, with performance optimized through virtualization, memoization, lazy loading, and streaming UX.

The backend, developed with Node.js and Express.js, features a robust LLM Gateway for AI model interactions, incorporating multi-provider fallback, caching, token tracking, and circuit breakers. It supports advanced agentic capabilities like OpenAI-compatible function calling and an ETL Agent for economic data. A Multi-Intent Pipeline processes complex prompts, while a PARE System handles document processing with per-document citations. A Document Generation System orchestrates LLMs for creating Excel and Word files, augmented by a Spreadsheet Analyzer Module for AI-powered analysis within a secure Python sandbox.

The system integrates an AGENTOS-ASI Cerebro Pipeline, a neuro-symbolic hierarchical agent comprising Planner, Executor, Critic, and Judge stages, alongside a WorldModel for environmental state tracking. A Multi-Model Router manages policy-based routing across model tiers with integrated circuit breakers. Universal Tool Calling supports diverse model output formats and utilizes a Tool Execution Engine for unified execution, health monitoring, and error classification. An Agent Executor manages tool dispatching, including aliasing and parameter normalization.

Authentication is handled via Google OAuth, featuring robust identity resolution and auto-migration for user profiles. The system operates in an always-on Agentic Mode, employing intent-aware tool forcing and providing structured progress tracking through execution plan SSE events. It incorporates a secure File-Plane, a Computer-Control-Plane for command governance, a Skills Kernel for enhanced tool management, and an Enhanced Memory System. Event Sourcing and OpenTelemetry Tracing are used for agent run monitoring, and a RAG++ Service offers advanced document understanding.

Frontend enhancements include live streaming of tool outputs, real-time DAG visualizations of agent execution, run replay, plan diff viewing, and budget dashboards. The system supports Super-Agent Proactive Behavior, an Agent Soul & Personality system, a Deep Research Agent, and Continuous Self-Improvement. The core Agent Infrastructure is built upon a modular plugin architecture, StateMachine, Typed Contracts, and a PolicyEngine. A Tool Registry provides 103 sandboxed agent tools, with Agent Orchestration leveraging a Manus-like architecture and LangGraph, including human-in-the-loop approvals. Unified tool execution is facilitated by a Python Agent Tools System (FastAPI microservice) and a TypeScript Tool Execution Engine.

The system integrates live OpenRouter API for fetching a comprehensive model catalog and offers multi-provider Image and Video Generation capabilities, along with a Media Cost Tracker for unified cost and budget enforcement. A Governance Mode System defines explicit operational modes with permissions and audit trails. The Security-Plane includes prompt injection detection and output sanitization.

An experimental SuperOrchestrator v1 provides distributed agent execution with DAG scheduling and BullMQ persistent queues, including governance features like kill switches and budget auto-pause. An in-chat advertising platform, IliaADS, serves contextual ads. The search UX is enhanced with URL paste fixes, intent-aware labels, a unified source panel with academic citations, and deep search capabilities with progress tracking. Content rendering supports professional-grade markdown with citation-aware formatting. The Intent Engine has been improved with new intent types (`CITATION_FORMAT`, `ACADEMIC_SEARCH`, `FACT_CHECK`) and enhanced constraint extraction.

Web retrieval is configurable via the `WEB_RETRIEVAL_PIPELINE` environment variable, defaulting to `fast_first` in production. The system is designed for high scalability, targeting 100M simultaneous users, utilizing optimized DB pools, Redis-backed rate limiting, compression, response caching, and socket hardening. Free users are restricted to specific free-tier models. Cerebras Direct Provider is integrated for faster inference when configured. OCR extracts text from images for non-vision models. A Workspace Agent System provides an agentic coding engine for the Codex VC workspace with SSE-streaming endpoints. Anonymous users are blocked from creating chat sessions and require Google OAuth authentication. Security enhancements include IP/User-Agent tracking for authenticated users and an enhanced admin panel for security overview.

## External Dependencies
### AI Services
- **OpenRouter**: Primary AI provider for various models.
- **Redis**: Caching, SSE streaming, and conversation memory.
- **LangGraph + LangChain**: Agent orchestration and workflow management.
- **Cerebras AI**: Direct model inference.
- **OpenAI Agents SDK**: Production-grade agent orchestration.
- **LlamaIndex**: TypeScript RAG framework for document indexing, retrieval, and query engines.
- **Qdrant**: High-performance vector database client for semantic search.

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

### Session & Auth Architecture
- **Session cookie**: `SameSite=None; Secure; HttpOnly` — works in cross-origin iframes (Replit preview, embedded contexts).
- **Cookie-less fallback**: When third-party cookies are blocked (Safari ITP), the frontend sends `X-Anonymous-User-Id` + `X-Anonymous-Token` (HMAC-SHA256) headers. The server validates the token via `verifyAnonToken()` and recovers the user's identity without a cookie.
- **Identity resolution order**: `req.user.claims.sub` → `req.user.id` → `session.authUserId` → `session.passport.user` → verified header token → `session.anonUserId` → new anon ID.
- **Token generation**: `server/lib/anonToken.ts` — HMAC-SHA256 with `ANON_TOKEN_SECRET` env var (or random fallback).
- **Key files**: `server/lib/anonUserHelper.ts` (identity resolution), `server/replit_integrations/auth/replitAuth.ts` (session config), `server/routes.ts` (`/api/session/identity`).

### Runtime Integration Modules
- **Qdrant Dual-Write**: Ingestion pipeline writes to both pgvector and Qdrant (when `QDRANT_URL` env var is set). `FusedRetrieveStage` merges results via RRF fusion. Gracefully skips when Qdrant is unavailable.
- **LlamaIndex RAG**: Available at `POST /api/rag/llamaindex/query` for advanced document Q&A. Uses OpenAI embeddings and LLM via `OPENAI_API_KEY`.
- **OpenAI Agents SDK**: Auto-routes GPT-model agentic requests through the SDK. Falls back to built-in `AgenticLoop` on failure. Respects `allowedTools` restrictions.
- **Integration Health**: `GET /api/integrations/status` returns availability and latency for all three integrations.

### OpenClaw Integration (v2026.4.5)
- **OpenClaw Control UI**: Served at `/openclaw-ui` with auto-connect.
- **WebSocket Gateway**: For OpenClaw communication at `/openclaw-ws`.
- **Internet Access Library**: `server/openclaw/lib/internetAccess.ts` — programmatic web fetch and search.
  - `POST /api/openclaw/internet/fetch` — fetch and parse any URL, extract clean text and links.
  - `POST /api/openclaw/internet/search` — DuckDuckGo search with structured results.
  - `GET /api/openclaw/internet/status` — internet capability status.
  - Gateway tools: `openclaw.web.fetch`, `openclaw.web.search` available via `tools.execute` WebSocket method.
- **Fusion Features**: task-board, searxng-search, model-switch-queue, gateway-resilience, internet-access.