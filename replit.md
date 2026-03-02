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

A Governance Mode System defines explicit modes (SAFE, SUPERVISED, AUTOPILOT, RESEARCH, EMERGENCY_STOP) with distinct permissions, human approval workflows, and a forensic-grade audit trail. A Security-Plane includes prompt injection detection, output sanitization, and real-time security monitoring. Budget SSE Events & Cost-Aware Routing provide real-time budget tracking and cost-optimized model routing. Admin Dashboards offer comprehensive views for governance, security, SRE, and model experiments. A Knowledge Graph extracts entities and relationships, providing graph-augmented RAG. Model A/B Testing & Provider Evaluation manages experiments, evaluates providers, and handles canary deployments. A Voice Plane provides STT/TTS abstraction, call session management, and voice guardrails. A Semantic Cache offers similarity-based response caching. Data Plane REST APIs provide event history and statistics. Enhanced Computer-Control-Plane extends capabilities with input automation, remote sessions, and screen analysis. DAG Orchestration Visualization provides a real-time, interactive view of agent task execution.

Infrastructure security includes bcrypt, multi-tenant validation, authentication middleware, and robust security headers. Scalability is achieved via Redis SSE, memory caching, response caching, request deduplication, compression, circuit breakers, rate limiting, and graceful shutdown. Robust production-grade systems manage large documents, dialogue, memory leaks, and provide self-healing capabilities.

PostgreSQL with Drizzle ORM is used for persistent data storage. Client-side persistence uses `localStorage` and IndexedDB.

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