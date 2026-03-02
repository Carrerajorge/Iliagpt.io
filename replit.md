# IliaGPT

## Overview
IliaGPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its core purpose is to offer a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation. The ambition is for IliaGPT to become a leading AI assistant for productivity.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
IliaGPT is built with a monorepo structure, separating client, server, and shared components, ensuring type safety with Zod schemas.

### UI/UX
The frontend, developed with React, TypeScript, and Vite, utilizes shadcn/ui (Radix UI) and Tailwind CSS for a modern, themable interface supporting light/dark mode. Key features include chat folders, command history, draft auto-save, suggested replies, conversation export, message favorites, prompt templates, PWA support, and keyboard shortcuts. Content rendering supports Markdown, code highlighting, and mathematical expressions using KaTeX. Data visualization is provided by Recharts, ECharts, and TanStack Table, with a multi-layer graphics rendering system supporting SVG (D3.js), Canvas 2D, and 3D (Three.js). Performance is optimized through message virtualization, memoization, lazy loading, streaming UX, and robust error handling. Security and accessibility are addressed via DOMPurify sanitization, frontend rate limiting, MIME type validation, and ARIA support. A file preview system provides consistent styled cards for various file types (PDF, DOCX, XLSX, text) and dedicated preview modals, with PDF rendering via `react-pdf` and DOCX/XLSX/text previews served as HTML from the backend.

### Technical Implementation
The backend uses Node.js and Express.js, featuring an LLM Gateway for AI model interactions with multi-provider fallback, request deduplication, streaming recovery, token usage tracking, circuit breakers, and response caching. Agentic tool calling is supported via `streamChatWithTools()`, including OpenAI-compatible function calling with automatic tool execution loops. An ETL Agent automates economic data processing. The system incorporates a Multi-Intent Pipeline for complex user prompts and a PARE System (Prompt Analysis & Routing Engine) for production-grade document processing across various formats (PDF, DOCX, XLSX, PPTX, CSV, TXT), including per-document citations and a defense-in-depth architecture. A Document Generation System uses LLM orchestration to create Excel and Word files, including professional CV/Resume generation. The Spreadsheet Analyzer Module offers AI-powered analysis, an LLM agent for Python code generation (with AST-based security validation), and a secure Python sandbox.

Core agentic tools from OpenClaw v2026.3.1 are integrated directly, including `bash` (sandboxed shell execution), `web_fetch` (HTTP + HTML stripping), `web_search` (DuckDuckGo), `read_file`, `write_file`, `edit_file`, and `list_files` (with path traversal protection). These tools are dispatched via `executeOpenClawToolCall` and merged into the agent executor's tool array. The agent executor uses OpenAI-compatible API calls through OpenRouter, routing via `OPENAI_BASE_URL` with `minimax/minimax-m2.5` as the default model.

The complete OpenClaw v2026.3.1 source code is integrated, providing a rich set of agentic modules for tools, sandbox, skills, browser control (Playwright), memory (vector embeddings), and various providers. Key OpenClaw capabilities include a Tool Catalog, Multi-Provider Web Search, Web Fetch, Browser Control, File System Operations, Shell Commands, Code Execution, Semantic Memory Search, Conversation Compaction, Sub-Agent Spawning, TTS, Document/Spreadsheet/Presentation Generation, and a Tool Policy Pipeline.

The core Agent Infrastructure features a modular plugin architecture with a StateMachine, Typed Contracts (Zod schemas), Event Sourcing, a PolicyEngine for RBAC, and an ExecutionEngine with circuit breakers. A Tool Registry provides 103 agent tools across 21 categories with standardized outputs and sandboxed execution. Specialized Agents include 10 dedicated specialists. Agent planning is organized into Research → Planning → Execution → Verification → Delivery phases.

Agent Orchestration uses a Manus-like architecture with RunController, PlannerAgent, ExecutorAgent, and VerifierAgent roles. Agent Mode features include event stream tracking, virtual workspace files, step verification with LLM-based evaluation, dynamic replanning, and error retention, along with a robust Agent Cancellation System. A Router System handles message routing between chat and agent modes. A LangGraph Agent System uses StateGraph for workflow management, supervisor and reflection patterns, human-in-the-loop approvals, PostgreSQL checkpoint persistence, and conversation memory. The Agentic Orchestration Pipeline includes PromptAnalyzer, IntentRouter, SupervisorAgent, AgentLoopFacade, and an ActivityStreamPublisher (SSE streaming). The Conversation Memory System provides server-side persistence for conversation state in PostgreSQL with Redis caching, versioned state management, artifact deduplication, and image edit chain tracking.

A GPT Session Contract System provides immutable session-based GPT configurations, ensuring backend authority over system_prompt, model, tool permissions, capabilities, and knowledge base. A Python Agent Tools System (FastAPI microservice) provides 30+ tools across 11 categories with a StateManager, WorkflowEngine, WebSocket support, and rate limiting. The Tool Execution Engine (TypeScript) offers a unified interface for executing both Python and TypeScript tools. An Enhanced AI Excel Router provides production-grade Excel AI operations with Zod validation, rate limiting, and SSE streaming.

### Infrastructure
Security is enforced with bcrypt password hashing, multi-tenant validation, authentication middleware, agent run limits, and production-grade security headers (CSP, HSTS). Safe process execution is ensured through centralized modules with program allowlists and argument validation. SQL security for the admin query explorer includes SELECT-only validation and audit logging. Custom error classes, global Express error handling, and Zod validation middleware for APIs are implemented.

### Scalability & Performance
Enterprise-grade scalability and performance are achieved through Redis SSE Streaming for horizontal scaling, a Memory Cache Layer (LRU with optional Redis backend), Response Caching Middleware with ETag support, and Request Deduplication. Compression Middleware handles Gzip and Brotli. Circuit Breakers wrap external services with configurable timeouts and retries. Rate Limiting uses a sliding window algorithm. Graceful Shutdown ensures connection draining and WebSocket cleanup. A FastAPI SSE Backend provides a production-grade Python SSE microservice for agent tracing using Redis Streams. Robust production-grade systems include a Large Document Processor, Dialogue Manager FSM, Stage Watchdog with AbortController, Memory Leak Prevention, Tenant-Isolated Circuit Breaker, PostgreSQL Health Checks, EventStore Batch Inserts, Connection Heartbeat Manager, Context Compressor, Semantic Cache, Graceful Degradation, Self-Healing System, OpenTelemetry Distributed Tracing, Output Sanitizer, and Backtracking Manager.

### Data Storage
PostgreSQL is used as the relational database, managed with Drizzle ORM. Client-side persistence leverages `localStorage` for chat history and preferences, and IndexedDB for background tasks and the offline queue. The CSRF system uses a shared token store with cookie-first resolution and in-memory fallback.

## External Dependencies
### AI Services
- **OpenRouter**: Used as the sole active AI model endpoint (minimax/minimax-m2.5) via an OpenAI-compatible API.
- **Redis**: Used for caching, SSE streaming, and conversation memory persistence in production.
- **LangGraph + LangChain**: Frameworks for agent orchestration and workflow management.

### Database
- **PostgreSQL**: Primary relational database for persistent storage.
- **Drizzle Kit**: Used for database schema migrations.

### CDN Resources
- **Highlight.js**: For code syntax highlighting.
- **Google Fonts**: For custom font families.

### External APIs
- **Piston API**: For multi-language code execution.
- **World Bank API V2**: For economic data retrieval.
- **Gmail API**: For Gmail chat integration.