# IliaGPT

## Overview
IliaGPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation. The ambition is for IliaGPT to become a leading AI assistant for productivity.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
### UI/UX
The frontend uses React with TypeScript and Vite, employing shadcn/ui (Radix UI) and Tailwind CSS for a modern, themable interface with light/dark mode. Key features include chat folders, command history, draft auto-save, suggested replies, conversation export, message favorites, prompt templates, PWA support, keyboard shortcuts, offline mode, a unified workspace, and an AI quality system with citations. Content support includes Markdown, code highlighting, and mathematical expressions. Data visualization is handled by Recharts, ECharts, and TanStack Table, with a multi-layer graphics rendering system supporting SVG (D3.js), Canvas 2D, and 3D (Three.js). Performance optimizations like message virtualization, memoization, lazy loading, streaming UX, and robust error handling are implemented. Security and accessibility are addressed through DOMPurify sanitization, frontend rate limiting, MIME type validation, and ARIA support.

### Technical Implementation
The backend is built with Node.js and Express.js. An LLM Gateway manages AI model interactions with features like multi-provider fallback, request deduplication, streaming recovery, token usage tracking, circuit breakers, response caching, and **agentic tool calling** via `streamChatWithTools()` which supports OpenAI-compatible function calling with automatic tool execution loops (up to 8 rounds per request). An ETL Agent automates economic data processing and generates ZIP bundles. The system incorporates a Multi-Intent Pipeline for complex user prompts and a PARE System (Prompt Analysis & Routing Engine) for production-grade document processing across various formats (PDF, DOCX, XLSX, PPTX, CSV, TXT), including per-document citations and a defense-in-depth architecture. A Document Generation System uses LLM orchestration to create Excel and Word files, including professional CV/Resume generation. The Spreadsheet Analyzer Module offers AI-powered analysis, an LLM agent for Python code generation (with AST-based security validation), and a secure Python sandbox.

**OpenClaw v2026.2.23 Full Source Integration** — The complete OpenClaw source code (3,532 TypeScript files, 28MB) is integrated at `server/openclaw-src/`. An adapter layer at `server/agent/openclaw/` bridges OpenClaw's standalone agent architecture with IliaGPT's web framework. Key capabilities: Tool Catalog (20 tools across 10 sections), Multi-Provider Web Search (Grok→Gemini→DuckDuckGo fallback), Web Fetch (HTML→Markdown), Browser Control (Playwright), File System Operations, Shell Commands, Code Execution, Semantic Memory Search, Conversation Compaction, Sub-Agent Spawning, Email, Document/Spreadsheet/Presentation Generation, and a Tool Policy Pipeline with subscription tier gating (Go=5 tools, Plus=17 tools, Pro=all 20). API at `/api/openclaw/*`.

The core Agent Infrastructure features a modular plugin architecture with a StateMachine, Typed Contracts (Zod schemas), Event Sourcing, a PolicyEngine for RBAC, and an ExecutionEngine with circuit breakers. A Tool Registry provides 103 agent tools across 21 categories with standardized outputs and sandboxed execution. Specialized Agents include 10 dedicated specialists for various tasks. Agent planning is organized into phases (Research → Planning → Execution → Verification → Delivery). The WebTool Module offers a layered architecture for web navigation with sandbox security.

Agent Orchestration employs a Manus-like architecture with RunController, PlannerAgent, ExecutorAgent, and VerifierAgent roles. Agent Mode features include event stream tracking, virtual workspace files, step verification with LLM-based evaluation, dynamic replanning, and error retention. A robust Agent Cancellation System is implemented, alongside a Router System for message routing between chat and agent modes. The AgentRunner provides a simplified agent loop with heuristic fallback and guardrails. Sandbox Agent V2 offers a comprehensive TypeScript agent system with phase-based execution and secure operations, complemented by a standalone Python Agent v5.0.

An enterprise-grade LangGraph Agent System uses StateGraph for workflow management, supervisor and reflection patterns, human-in-the-loop approvals, PostgreSQL checkpoint persistence, and conversation memory. The Agentic Orchestration Pipeline includes PromptAnalyzer, IntentRouter, SupervisorAgent, AgentLoopFacade, ActivityStreamPublisher (SSE streaming), and a comprehensive Memory System for execution context. The Conversation Memory System provides server-side persistence for conversation state in PostgreSQL with Redis caching, versioned state management, artifact deduplication, and image edit chain tracking, exposed via a REST API and frontend hook.

A GPT Session Contract System provides immutable session-based GPT configurations, ensuring backend authority over system_prompt, model, tool permissions, capabilities, and knowledge base. This system manages session creation, retrieval, and enforcement of policies.

A Python Agent Tools System (FastAPI microservice) provides 30+ tools across 11 categories with a StateManager, WorkflowEngine, WebSocket support, rate limiting, and security headers. The Tool Execution Engine (TypeScript) offers a unified interface for executing both Python and TypeScript tools. An Enhanced AI Excel Router provides production-grade Excel AI operations with Zod validation, rate limiting, extended data generation, formula generation, and SSE streaming. New API Endpoints support tool execution, Python tools proxy, and enhanced Excel AI operations.

### Infrastructure
Security is implemented with bcrypt password hashing, multi-tenant validation, authentication middleware, max iterations/timeout for agent runs, and production-grade security headers (CSP, HSTS). Safe process execution is ensured through centralized modules with program allowlists and argument validation. SQL security for the admin query explorer includes SELECT-only validation and audit logging. Custom error classes and global Express error handling are in place, alongside Zod validation middleware for APIs. Database performance is optimized with indices.

### Scalability & Performance
Enterprise-grade scalability and performance are achieved through Redis SSE Streaming for horizontal scaling, a Memory Cache Layer (LRU with optional Redis backend), Response Caching Middleware with ETag support, and Request Deduplication. Compression Middleware handles Gzip and Brotli. Circuit Breakers wrap external services with configurable timeouts and retries. Rate Limiting uses a sliding window algorithm. Graceful Shutdown ensures connection draining and WebSocket cleanup. A FastAPI SSE Backend provides a production-grade Python SSE microservice for agent tracing using Redis Streams.

### Production Robustness Systems
The system incorporates robust production-grade systems for stability under high load, including:
- **Large Document Processor**: Handles large documents via intelligent chunking, streaming processing, backpressure control, and concurrency limiting.
- **Dialogue Manager FSM**: Manages conversational states with timeouts and session cleanup.
- **Stage Watchdog with AbortController**: Ensures real timeout propagation and proper cleanup for pipeline stages.
- **Memory Leak Prevention**: Implements automatic cleanup of completed runs, buffer eviction, proactive GC, and WeakRef-based instance tracking.
- **Tenant-Isolated Circuit Breaker**: Provides per (tenant, provider) isolation with a 5-state FSM.
- **PostgreSQL Health Checks**: Proactive database health monitoring with exponential backoff and Prometheus metrics.
- **EventStore Batch Inserts**: Optimizes database inserts for tracing events using batch operations.
- **Connection Heartbeat Manager**: Detects and cleans up zombie connections.
- **Context Compressor**: Compresses conversation context using multiple strategies with caching.
- **Semantic Cache**: Provides embedding-based similarity caching for faster lookups.
- **Graceful Degradation**: Implements 5 degradation levels with fallback chains and automatic recovery.
- **Self-Healing System**: Automates error diagnosis and applies healing actions.
- **OpenTelemetry Distributed Tracing**: Provides distributed tracing for visibility into system operations.
- **Output Sanitizer**: Detects and redacts/masks PII and secret information in outputs.
- **Backtracking Manager**: Automates checkpoints, state restoration, and re-planning for failure avoidance.

### Data Storage
PostgreSQL is used as the relational database, managed with Drizzle ORM. Client-side persistence leverages `localStorage` for chat history and preferences, and IndexedDB for background tasks and the offline queue.

### CSRF Token Architecture
The CSRF system uses a shared token store (`client/src/lib/csrfTokenStore.ts`) that both `apiClient.ts` and `uploadTransport.ts` import from. This avoids circular imports between these modules. The store provides cookie-first resolution with in-memory fallback for Safari/Replit webview environments where third-party cookies are blocked. The server CSRF middleware (`server/middleware/csrf.ts`) accepts header-only CSRF tokens when cookies are unavailable, provided the origin check passes.

### Key Design Patterns
The project utilizes a monorepo structure (`client/`, `server/`, `shared/`) and ensures type safety through Zod schemas for runtime validation.

## External Dependencies
### AI Services
- **OpenRouter (minimax/minimax-m2.5)**: Sole active AI model, accessed via OpenAI-compatible API through OpenRouter. `OPENAI_BASE_URL=https://openrouter.ai/api/v1` routes the existing OpenAI client to OpenRouter. `OPENAI_API_KEY` stores the OpenRouter API key. All default providers/models in `server/lib/modelRegistry.ts` point to `minimax/minimax-m2.5` via the `openai` provider.
- **Redis**: Bypassed in development (`NODE_ENV !== "production"`) across `redis.ts`, `cache.ts`, `rateLimiter.ts`, `redisConversationCache.ts`, and `redisSSE.ts` to avoid Upstash quota issues. In-memory fallbacks are used instead.
- **LangGraph + LangChain**: Agent orchestration framework for stateful, multi-step workflows.

### Database
- **PostgreSQL**: Relational database for persistent storage.
- **Drizzle Kit**: For database schema migrations.

### CDN Resources
- **KaTeX**: For rendering mathematical expressions.
- **Highlight.js**: For code syntax highlighting themes.
- **Google Fonts**: Custom font families.

### External APIs
- **Piston API**: For multi-language code execution.
- **World Bank API V2**: For economic data retrieval.
- **Gmail API**: For Gmail chat integration.