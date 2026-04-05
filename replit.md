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