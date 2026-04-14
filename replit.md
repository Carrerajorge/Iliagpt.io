# IliaGPT

## Overview
IliaGPT is an AI-powered chat application designed as an intelligent assistant for autonomous web browsing and document creation. Its primary purpose is to provide a versatile platform for AI-driven tasks, including economic data analysis, multi-intent prompt processing, and professional document generation. The project's vision is to become a leading AI assistant for productivity, offering advanced capabilities for various AI-driven tasks.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
IliaGPT is built with a monorepo structure, ensuring type safety with Zod schemas across client, server, and shared components.

The frontend, developed with React, TypeScript, Vite, shadcn/ui, and Tailwind CSS, offers a modern, themable interface with light/dark modes, chat management, prompt templates, PWA capabilities, and keyboard shortcuts. It supports rich rendering of Markdown, code, and mathematical expressions, with data visualization via Recharts, ECharts, and TanStack Table. Performance is optimized using virtualization, memoization, lazy loading, and streaming UX.

The backend, powered by Node.js and Express.js, includes a robust LLM Gateway for AI model interactions, featuring multi-provider fallback, caching, token tracking, and circuit breakers. It supports OpenAI-compatible function calling and an ETL Agent for economic data. A Multi-Intent Pipeline processes complex prompts, while a PARE System handles document processing with per-document citations. The Document Generation System orchestrates LLMs for creating Excel and Word files, augmented by a Spreadsheet Analyzer Module within a secure Python sandbox.

The system incorporates an AGENTOS-ASI Cerebro Pipeline, a neuro-symbolic hierarchical agent with Planner, Executor, Critic, and Judge stages, alongside a WorldModel. A Multi-Model Router manages policy-based routing with integrated circuit breakers. Universal Tool Calling supports diverse model output formats and utilizes a Tool Execution Engine for unified execution. An Agent Executor manages tool dispatching, including aliasing and parameter normalization.

Authentication is managed via Google OAuth with robust identity resolution. The system operates in an always-on Agentic Mode, employing intent-aware tool forcing and providing structured progress tracking via SSE events. It includes a secure File-Plane, Computer-Control-Plane for command governance, a Skills Kernel for tool management, and an Enhanced Memory System. Event Sourcing and OpenTelemetry Tracing are used for agent run monitoring, and a RAG++ Service offers advanced document understanding.

Frontend features include live streaming of tool outputs, real-time DAG visualizations of agent execution, run replay, plan diff viewing, and budget dashboards. The system supports Super-Agent Proactive Behavior, an Agent Soul & Personality system, a Deep Research Agent, and Continuous Self-Improvement. The core Agent Infrastructure is built upon a modular plugin architecture, StateMachine, Typed Contracts, and a PolicyEngine. A Tool Registry provides 103 sandboxed agent tools, with Agent Orchestration leveraging a Manus-like architecture and LangGraph, including human-in-the-loop approvals. Unified tool execution is facilitated by a Python Agent Tools System (FastAPI microservice) and a TypeScript Tool Execution Engine.

The system integrates the OpenRouter API for a comprehensive model catalog and offers multi-provider Image and Video Generation with a Media Cost Tracker for unified cost and budget enforcement. A Governance Mode System defines explicit operational modes with permissions and audit trails. The Security-Plane includes prompt injection detection and output sanitization.

An experimental SuperOrchestrator provides distributed agent execution with DAG scheduling and BullMQ persistent queues, including governance features like kill switches and budget auto-pause. Search UX is enhanced with URL paste fixes, intent-aware labels, a unified source panel with academic citations, and deep search capabilities with progress tracking. Content rendering supports professional-grade markdown with citation-aware formatting. The Intent Engine has been improved with new intent types and enhanced constraint extraction. Web retrieval is configurable via the `WEB_RETRIEVAL_PIPELINE` environment variable. The system is designed for high scalability, targeting 100M simultaneous users, utilizing optimized DB pools, Redis-backed rate limiting, compression, response caching, and socket hardening. Cerebras Direct Provider is integrated for faster inference. OCR extracts text from images for non-vision models. A Workspace Agent System provides an agentic coding engine for the Codex VC workspace with SSE-streaming endpoints.

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
- **Stripe**: Payment processing and subscription management.
- **Replit Connector API**: For fetching Stripe credentials.

### Audio Transcription
- **OpenAI Whisper API**: Primary audio transcription (STT) with speaker diarization and keyword extraction.
- **Google Gemini 2.0 Flash**: Fallback audio transcription when Whisper/OpenAI is unavailable.
- Supported formats: MP3, WAV, OGG, WebM, M4A, FLAC, AAC (max 25MB per file).
- Audio files uploaded to chat are automatically transcribed and the text is sent to the selected AI model.

### Runtime Integration Modules
- **OpenClaw Control UI**: For web browsing and internet access.