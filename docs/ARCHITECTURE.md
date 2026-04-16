# IliaGPT Architecture

This document is the authoritative technical reference for the IliaGPT platform architecture. It covers system design, data flows, subsystem internals, and extension points for contributors and operators.

**Last updated:** April 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Core Architecture Layers](#2-core-architecture-layers)
3. [Data Flow — Chat Request](#3-data-flow--chat-request)
4. [Smart Model Router](#4-smart-model-router)
5. [Agent Orchestration (LangGraph)](#5-agent-orchestration-langgraph)
6. [Long-Term Memory System](#6-long-term-memory-system)
7. [RAG Pipeline](#7-rag-pipeline)
8. [Real-Time Architecture](#8-real-time-architecture)
9. [Multi-Channel Integrations](#9-multi-channel-integrations)
10. [Security Architecture](#10-security-architecture)
11. [Database Schema Overview](#11-database-schema-overview)
12. [Scalability](#12-scalability)
13. [Extension Points](#13-extension-points)

---

## 1. System Overview

IliaGPT is a six-layer system. The layers are loosely coupled: each layer communicates with adjacent layers through well-defined interfaces, making it possible to replace or scale individual components independently.

```
╔══════════════════════════════════════════════════════════════════════════╗
║                         PRESENTATION LAYER                               ║
║                                                                          ║
║   ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────┐   ║
║   │  React 19 SPA   │  │  Electron App   │  │   Chrome Extension   │   ║
║   │  (Vite, Wouter) │  │  (desktop/)     │  │   (extension/)       │   ║
║   └────────┬────────┘  └────────┬────────┘  └──────────┬───────────┘   ║
╚════════════╪════════════════════╪═══════════════════════╪═══════════════╝
             │ HTTP/SSE           │ HTTP/SSE              │ HTTP
╔════════════▼════════════════════▼═══════════════════════▼═══════════════╗
║                          API GATEWAY LAYER                               ║
║                                                                          ║
║   Express.js  ─  Passport.js  ─  CSRF  ─  Helmet  ─  Rate limiter      ║
║   SSRF guard  ─  Prompt injection detection  ─  DOMPurify output        ║
║   /api/*  ─  /v1/* (OpenAI-compatible)  ─  /ws/* (WebSocket)            ║
╚════════════════════════════╤═════════════════════════════════════════════╝
                             │
╔════════════════════════════▼═════════════════════════════════════════════╗
║                          SERVICE LAYER                                   ║
║                                                                          ║
║   ChatService   AgentService   DocumentService   TaskService             ║
║   MemoryService SearchService  PresenceService   StorageService          ║
╚════════════╤════════════════════╤════════════════════════════════════════╝
             │                    │
╔════════════▼════════╗  ╔════════▼══════════════════════════════════════╗
║    LLM GATEWAY      ║  ║            AGENT ORCHESTRATION                ║
║                     ║  ║                                               ║
║  Smart Router       ║  ║  LangGraph DAG                                ║
║  16+ Providers      ║  ║  Tool Registry (100+ tools)                   ║
║  Circuit Breakers   ║  ║  Cognitive Kernel                             ║
║  Budget Enforcement ║  ║  Plan Mode                                    ║
║  Response Cache     ║  ║  Sub-agent Coordinator                        ║
╚════════════╤════════╝  ╚════════╤══════════════════════════════════════╝
             │                    │
╔════════════▼════════════════════▼══════════════════════════════════════╗
║                            DATA LAYER                                   ║
║                                                                         ║
║   PostgreSQL 16         Redis 7              File Storage               ║
║   + pgvector            ├── Rate limiting    ├── Uploads                ║
║   ├── Drizzle ORM       ├── Session cache    ├── Generated docs         ║
║   ├── Migrations        ├── Pub/sub SSE      └── Sandbox workspace      ║
║   └── Read replica      └── Job queue                                   ║
╚═════════════════════════════════════════════════════════════════════════╝
```

### Key Design Principles

**Model-agnostic by default.** Every feature — including memory, agents, file generation, and search — runs identically whether the underlying model is Claude, GPT-4o, Gemini, or a local Ollama instance. The LLM Gateway normalises provider-specific request/response formats behind a shared `LLMProvider` interface.

**Streaming first.** All chat responses and agent progress updates are delivered via Server-Sent Events (SSE). The WebSocket channel handles presence, typing indicators, and real-time collaboration features. Redis pub/sub allows multiple app instances to broadcast SSE events to the correct client.

**Type-safe end-to-end.** Zod schemas at API entry points validate all inbound data at runtime. Drizzle ORM provides compile-time type safety for all database operations. The `shared/schema.ts` file (~3300 lines) is the single authoritative source of truth for all database table shapes, insert schemas, and TypeScript types.

**Security layered in, not bolted on.** SSRF protection guards every outbound HTTP request made by agents. Prompt injection detection runs before each LLM call. VM isolation wraps every code execution. Delete protection policies prevent irreversible file operations without explicit user approval.

---

## 2. Core Architecture Layers

### 2.1 Presentation Layer

The presentation layer consists of three deployment targets that share the same core business logic through the Express.js backend.

#### React 19 SPA (client/)

The web application is a single-page app built with React 19 and bundled by Vite 6. It uses:

- **Wouter** for client-side routing. Routes are defined in `client/src/App.tsx` and match paths like `/chat/:id`, `/settings`, `/projects/:id`, and `/agents`.
- **Zustand** for synchronous client-side state across four primary stores:
  - `chatStore` — active conversation, message list, scroll position
  - `agentStore` — agent status, running tool names, plan steps
  - `streamingStore` — per-message streaming buffers and deltas
  - `superAgentStore` — proactive suggestion queue and self-improvement state
  - `artifactStore` — rendered artifact instances and version history
- **TanStack Query** for server state: chat history, document list, memory entries, user settings. All server data is fetched and cached with TanStack Query, keeping Zustand stores focused on purely ephemeral UI state.
- **shadcn/ui** (built on Radix Primitives) for accessible, composable UI components: dialogs, dropdowns, tooltips, command palette, and form controls.
- **TailwindCSS 4** for styling, using design tokens defined in `client/src/styles/globals.css`.

The Artifacts panel (`client/src/components/artifacts/`) auto-detects structured content in LLM responses and renders it in an inline panel with version history navigation:
- **CodeArtifact** — syntax-highlighted code via Shiki
- **HtmlArtifact** — sandboxed iframe for live HTML previews
- **TableArtifact** — sortable, filterable table renderer
- **DiagramArtifact** — Mermaid.js diagram renderer

#### Electron Desktop App (desktop/)

The Electron wrapper packages the Express server and the React SPA into a single installable binary for macOS and Windows. At launch it:
1. Starts the Express server on a random available port
2. Opens a `BrowserWindow` pointing to `http://localhost:{port}`
3. Configures native OS integrations: file associations, context menus, tray icon, and system notifications

The desktop build uses `electron-builder` for packaging and code signing. The `npm run dev:desktop` command starts all three processes (server, Vite, Electron) concurrently using `concurrently`.

#### Chrome Extension (extension/)

The Chrome extension injects a sidebar into any browser tab. It communicates with the IliaGPT backend via the extension's background service worker. Users can highlight text on any page and send it directly to the chat interface, trigger browser automation tasks, or use the command palette to perform actions in the context of the current page.

### 2.2 API Gateway Layer

The API gateway is an Express.js application defined in `server/index.ts` and `server/routes.ts`. All inbound HTTP traffic passes through a layered middleware pipeline before reaching route handlers.

#### Middleware Pipeline (in order)

```
Request
   │
   ▼
[1] Helmet         — security headers (CSP, HSTS, X-Frame-Options, etc.)
   │
   ▼
[2] CORS           — origin allowlist from ALLOWED_ORIGINS env var
   │
   ▼
[3] Session        — express-session + connect-pg-simple (PostgreSQL store)
   │
   ▼
[4] Passport.js    — deserialise user from session; attach to req.user
   │
   ▼
[5] CSRF           — double-submit cookie pattern; exempt /v1/* (API keys)
   │
   ▼
[6] Rate limiter   — Redis token bucket; per-user-id or per-IP
   │
   ▼
[7] SSRF guard     — blocks requests to private IP ranges in agent tools
   │
   ▼
[8] Injection det. — pattern-match + embedding similarity on user content
   │
   ▼
[9] Route handler  — chat, agent, document, memory, search, auth, v1 API
   │
   ▼
[10] DOMPurify     — sanitise any HTML in outbound responses
   │
   ▼
Response
```

#### Route Namespaces

| Prefix | Description |
|---|---|
| `/api/auth/*` | Authentication: Google OAuth, Microsoft OAuth, Auth0, logout |
| `/api/chats/*` | Chat CRUD, message creation, SSE stream |
| `/api/agents/*` | Agent status, plan mode, sub-agent coordination |
| `/api/documents/*` | Document upload, indexing, retrieval |
| `/api/memories/*` | Long-term memory CRUD |
| `/api/search` | Unified hybrid search |
| `/api/tasks/*` | Scheduled and on-demand task management |
| `/api/mcp/*` | MCP connector OAuth flows and tool proxy |
| `/v1/*` | OpenAI-compatible API (API key auth, no CSRF) |
| `/ws/presence` | WebSocket — presence, typing, focus tracking |

### 2.3 Service Layer

The service layer contains the business logic. Services are instantiated once at startup and injected into route handlers. Key services:

**ChatService** (`server/chat/chatService.ts`) — orchestrates the full chat request lifecycle: retrieves conversation history, injects long-term memory into the system prompt, invokes the LLM Gateway, streams the response back to the client via SSE, persists the completed message, and triggers async post-processing (memory extraction, analytics).

**AgentService** (`server/agent/agentService.ts`) — manages LangGraph agent execution. Accepts a task payload and returns a streaming sequence of agent events (tool calls, intermediate results, final answer). Handles Plan Mode (generate plan → user approval → step execution).

**DocumentService** (`server/documents/documentService.ts`) — manages document upload, text extraction (PDF, DOCX, XLSX, HTML), chunking, embedding generation, and vector storage. Exposes search and retrieval for the RAG pipeline.

**TaskService** (`server/tasks/taskService.ts`) — manages cron-based and on-demand scheduled tasks. Uses a Redis-backed job queue for durable scheduling. Each task stores its instructions, schedule expression, last run time, and execution history.

**MemoryService** (`server/memory/longTermMemory.ts`) — extracts facts from completed conversations, stores them with embeddings, and retrieves the most semantically relevant facts for injection into new conversations.

**SearchService** (`server/search/unifiedSearch.ts`) — provides hybrid search combining PostgreSQL full-text search (tsvector/tsquery) and pgvector cosine similarity, fused using Reciprocal Rank Fusion (RRF).

### 2.4 LLM Gateway

The LLM Gateway (`server/llm/`) provides a unified interface across 16+ providers. It normalises provider-specific APIs, handles authentication, manages circuit breakers, enforces budgets, and caches responses.

The `LLMProvider` interface that all provider adapters implement:

```typescript
interface LLMProvider {
  name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncGenerator<CompletionChunk>;
  embed(texts: string[]): Promise<number[][]>;
  isHealthy(): Promise<boolean>;
  getModels(): string[];
}
```

Provider adapters live in `server/llm/providers/`. Each adapter translates the normalised `CompletionRequest` into the provider's native format and maps the response back.

### 2.5 Agent Orchestration

The agent system is built on LangGraph, a DAG-based orchestration framework. The DAG defines nodes (LLM calls or tool executions) and edges (conditional or unconditional transitions between nodes). Agent execution is event-driven and fully streaming — every node emits progress events that are forwarded to the client in real time.

### 2.6 Data Layer

**PostgreSQL 16** is the primary data store. The pgvector extension stores 1536-dimensional embedding vectors in the `user_long_term_memories` and document chunk tables, enabling cosine similarity queries alongside standard SQL.

**Redis 7** is used for:
- Rate limiting (Redis token bucket algorithm)
- Session data cache (reduces PostgreSQL load)
- SSE pub/sub (allows multiple app instances to route events to the correct client connection)
- Background job queue (scheduled tasks and async post-processing)

**File storage** uses the local filesystem (or a configurable S3-compatible object store in production) for uploaded documents, generated files, and sandbox workspace scratch space.

---

## 3. Data Flow — Chat Request

The following trace follows a single user message through the entire system.

```
 User types message and presses Send
          │
          ▼
 [1] Client (React)
     chatStore.addOptimisticMessage()           ← immediate UI feedback
     POST /api/chats/:chatId/messages
          │
          ▼
 [2] API Gateway middleware pipeline
     Session lookup  →  CSRF verify  →  Rate limit check
     Injection detection (pattern + embedding)
          │
          ▼
 [3] chatAiRouter (server/routes.ts)
     Load conversation history from PostgreSQL
     Call MemoryService.getRelevantMemories()   ← pgvector similarity search
     Build system prompt with injected memories
          │
          ▼
 [4] Smart Router (server/llm/smartRouter.ts)
     Classify complexity: simple / medium / complex
     Select provider + model based on:
       - complexity tier
       - provider health (circuit breaker state)
       - user budget remaining
       - latency history (P50/P95)
          │
          ▼
 [5] LLM Gateway
     Translate CompletionRequest to provider format
     Send request to selected provider (Anthropic, OpenAI, etc.)
          │
          ▼
 [6] Does the LLM want to call a tool?
      │
      ├── NO ──→ [9] Stream response tokens to client via SSE
      │
      └── YES ─→ [7] Agent Orchestration (LangGraph)
                     Route to specialised agent node:
                       deep-research / coding / browser / file / data
                          │
                          ▼
                 [8] Tool Execution
                     Look up tool in registry
                     Validate tool input against Zod schema
                     Execute tool (browser, code sandbox, MCP connector, etc.)
                     Return tool result to LangGraph
                     Loop back to [5] with tool result in context
                     (may iterate multiple times before final answer)
          │
          ▼
 [9] Stream final answer tokens to client via SSE
     ChatService.persistMessage()               ← write to PostgreSQL
     Trigger async post-processing:
       MemoryService.extractFacts()             ← async LLM call
       AnalyticsService.recordUsage()           ← token counts + cost
          │
          ▼
 [10] Client receives SSE stream
      streamingStore.appendChunk() on each event
      ArtifactDetector scans completed message
      Render artifacts in panel if detected
      chatStore.finaliseMessage()
```

### SSE Event Format

Each SSE event carries a typed payload:

```
event: delta
data: {"type":"delta","content":"Hello","messageId":"msg_123"}

event: tool_call
data: {"type":"tool_call","toolName":"web_search","input":{"query":"..."}}

event: tool_result
data: {"type":"tool_result","toolName":"web_search","output":"..."}

event: done
data: {"type":"done","messageId":"msg_123","totalTokens":842}
```

---

## 4. Smart Model Router

**Source:** `server/llm/smartRouter.ts`

The Smart Router selects the optimal LLM provider and model for each request based on complexity, provider health, user budget, and observed latency.

### 4.1 Complexity Detection Algorithm

Complexity is classified as `simple`, `medium`, or `complex` using a weighted scoring function that examines:

| Signal | Weight | Description |
|---|---|---|
| Message length | High | > 500 chars nudges toward medium; > 2000 toward complex |
| Conversation depth | Medium | > 10 turns in history nudges toward complex |
| Code patterns | High | Presence of code blocks pushes toward complex |
| Mathematical notation | High | LaTeX or equation patterns push toward complex |
| Question count | Medium | Multiple questions in one message push toward complex |
| Agent tool mention | High | Tool keywords (browser, file, code) push toward complex |
| Language flags | Low | Non-English content has slight upward pressure |

Simple messages (e.g., "thanks", "what time is it in Tokyo") are routed to fast, cheap models. Complex messages (multi-step research, code generation, document analysis) are routed to the most capable available model.

### 4.2 Circuit Breaker State Machine

Each provider has an independent circuit breaker. The state machine has three states:

```
                  ┌────────────────────────────────┐
                  │           CLOSED               │
                  │   (normal operation)            │
                  │   failure_count tracks errors   │
                  └─────────────┬──────────────────┘
                                │
                   3 failures in 60 seconds
                                │
                                ▼
                  ┌────────────────────────────────┐
                  │            OPEN                │
                  │   (provider bypassed)           │◄────────────────┐
                  │   all requests → fallback       │                 │
                  │   timer: 5 minutes              │                 │
                  └─────────────┬──────────────────┘                 │
                                │                                     │
                   Timer expires (5 min)                   probe fails again
                                │                                     │
                                ▼                                     │
                  ┌────────────────────────────────┐                 │
                  │          HALF-OPEN             │                 │
                  │   (testing recovery)            │                 │
                  │   1 probe request allowed       ├─────────────────┘
                  └─────────────┬──────────────────┘
                                │
                   probe succeeds
                                │
                                ▼
                         Reset to CLOSED
                    failure_count = 0
```

Circuit breaker state is stored in Redis, so all app instances share the same view of provider health.

### 4.3 Fallback Chain Logic

When the primary provider is in OPEN state, the router walks a fallback chain. Fallback chains are tier-aware:

```
Complex tier fallback chain:
  anthropic/claude-opus-4
    → openai/gpt-4o
    → google/gemini-2.0-pro
    → openrouter/anthropic/claude-opus-4 (via OpenRouter)
    → ERROR: no provider available

Medium tier fallback chain:
  anthropic/claude-sonnet-4-5
    → openai/gpt-4o-mini
    → google/gemini-2.0-flash
    → deepseek/deepseek-chat
    → ERROR: no provider available

Simple tier fallback chain:
  anthropic/claude-haiku-3-5
    → openai/gpt-4o-mini
    → google/gemini-2.0-flash-lite
    → groq/llama-3.3-70b
    → ERROR: no provider available
```

If the user has specified a model preference in their settings, that preference is honoured unless the provider is in OPEN state.

### 4.4 Budget Enforcement

Each user tier has a daily cost budget enforced by the Smart Router before dispatching any LLM call:

| Tier | Daily budget | Behaviour at limit |
|---|---|---|
| Free | $0.50 | Hard block; display upgrade prompt |
| Pro | $5.00 | Soft warn at 80%; hard block at 100% |
| Enterprise | $50.00 | Alert to org admin; configurable per-seat override |

Cost is calculated from the token counts reported by the provider and stored per-user in Redis with a 24-hour TTL (reset at midnight UTC). Actual charges are persisted to PostgreSQL for billing.

### 4.5 Health Monitoring

A background health check runs every 60 seconds for all configured providers. Each check sends a minimal completion request (5-token prompt) and records:
- Round-trip latency in milliseconds
- Success or failure
- HTTP status code on failure

Latency measurements feed into the P50/P95/P99 percentile tracker. When two providers are both CLOSED and in the same tier, the router selects the one with the lower P50 latency.

---

## 5. Agent Orchestration (LangGraph)

**Source:** `server/agent/`

The agent orchestration layer converts an open-ended user task into a structured execution graph, coordinates specialised agent nodes, maintains working memory during the task, and streams granular progress events back to the client.

### 5.1 LangGraph DAG Structure

The core orchestration graph is defined in `server/agent/langgraph/`. The DAG has the following primary nodes:

```
                         ┌─────────────┐
                         │    START    │
                         └──────┬──────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │   Task Classifier   │
                    │   (route to agent)  │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────────────┐
              │                │                        │
              ▼                ▼                        ▼
    ┌──────────────┐  ┌──────────────┐       ┌──────────────────┐
    │Deep Research │  │    Coding    │       │    Browser       │
    │    Agent     │  │    Agent     │       │    Agent         │
    └──────┬───────┘  └──────┬───────┘       └────────┬─────────┘
           │                 │                        │
           │         ┌───────┴──────────┐             │
           │         │                  │             │
           │    ┌────▼─────┐     ┌──────▼────┐       │
           │    │   File   │     │   Data    │       │
           │    │  Agent   │     │  Agent    │       │
           │    └────┬─────┘     └──────┬────┘       │
           │         │                  │             │
           └─────────┴──────────────────┴─────────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │   Tool Executor     │
                    │   (sandboxed)       │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Response Assembler │
                    └──────────┬──────────┘
                               │
                               ▼
                           ┌───────┐
                           │  END  │
                           └───────┘
```

Each node receives the current graph state (messages, tool results, plan steps, working memory) and returns an updated state plus any events to stream to the client.

### 5.2 Specialised Agent Nodes

#### Deep Research Agent

Responsible for tasks requiring multi-source information gathering. Capabilities:
- Issue sequential or parallel web search queries
- Extract and cross-reference content from multiple URLs
- Synthesise findings into structured reports with citations
- Assess source credibility and flag conflicting information
- Generate executive summaries with key findings highlighted

Internally uses a "search → extract → synthesise → verify" loop that runs until the agent's confidence score exceeds a configurable threshold.

#### Coding Agent

Handles all code-related tasks. Capabilities:
- Write, debug, refactor, and explain code in any language
- Execute code in the Python or Node.js sandbox and observe output
- Iterate on code based on execution errors (automatic debug loop, max 5 iterations)
- Generate unit tests and assert expected behaviour
- Analyse existing codebases from uploaded files

The coding agent has access to a persistent sandbox workspace directory (`sandbox_workspace/`) that persists files between tool calls within a single agent session.

#### Browser Agent

Controls a real Playwright browser instance. Capabilities:
- Navigate to URLs and handle redirects and authentication prompts
- Click elements, fill forms, select dropdowns, handle file inputs
- Execute arbitrary JavaScript in the page context
- Capture full-page or element-level screenshots
- Extract structured data from page content (text, tables, links)
- Handle multi-step workflows (login → navigate → extract)

The browser agent uses a visual feedback loop: after each action it captures a screenshot and includes it in the LLM context to verify the action had the intended effect before proceeding.

#### File Agent

Handles document generation and file system operations. Capabilities:
- Generate Excel (.xlsx) with formulas, charts, and named ranges using the office engine
- Generate PowerPoint (.pptx) with layouts, themes, images, and speaker notes
- Generate Word (.docx) with headings, tables, lists, and styles
- Generate PDF from HTML or Markdown content
- Convert between document formats (PDF → PPT, CSV → Excel, etc.)
- Read and extract content from uploaded documents
- Organise, rename, and classify files

#### Data Agent

Handles analytical and statistical tasks. Capabilities:
- Statistical analysis (descriptive stats, regression, correlation, hypothesis testing)
- Data cleaning (null handling, outlier detection, type normalisation)
- Visualisation (generate matplotlib/seaborn charts as PNG)
- Time-series forecasting using statsmodels or Prophet
- Machine learning pipeline generation (scikit-learn)
- PDF-to-spreadsheet extraction via OCR pipeline

The data agent sends Python code to the FastAPI microservice (`fastapi_sse/`) for execution in an isolated environment with access to the full scientific Python stack.

### 5.3 Tool Registry

The tool registry (`server/agent/tools/`) contains 100+ registered tools. Tools are grouped into categories:

| Category | Example Tools |
|---|---|
| Web | `web_search`, `fetch_url`, `extract_page_content`, `screenshot_url` |
| File system | `read_file`, `write_file`, `list_directory`, `move_file`, `delete_file` |
| Code execution | `run_python`, `run_node`, `install_package`, `read_sandbox_file` |
| Document generation | `generate_excel`, `generate_pptx`, `generate_docx`, `generate_pdf`, `generate_chart` |
| Browser automation | `browser_navigate`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_eval` |
| MCP connectors | `drive_list_files`, `gmail_search`, `slack_send_message`, `jira_create_issue`, etc. |
| Memory | `search_memory`, `save_memory`, `delete_memory` |
| Data analysis | `run_analysis`, `generate_plot`, `describe_dataframe`, `clean_data` |
| System | `get_current_time`, `calculate`, `format_data`, `convert_units` |

Each tool is a TypeScript module implementing:

```typescript
interface AgentTool {
  name: string;                              // unique snake_case identifier
  description: string;                       // natural language for the LLM
  inputSchema: z.ZodType;                    // Zod schema for input validation
  execute(input: unknown): Promise<ToolResult>;
  permissions?: Permission[];                // required user permissions
  requiresApproval?: boolean;               // prompt user before executing
}
```

Tools are auto-discovered by scanning the `server/agent/tools/` directory at startup. No manual registration is required.

### 5.4 Cognitive Kernel

The cognitive kernel (`server/agent/autonomousAgentBrain.ts`) is the reasoning engine that drives agent decision-making between tool calls. It:

1. Maintains a scratchpad of observations from completed tool calls
2. Evaluates whether the current state satisfies the original task goal
3. Selects the next action (tool call, clarification question, or final answer)
4. Detects and recovers from common failure modes (tool timeout, empty result, contradictory information)
5. Manages context window: summarises earlier scratchpad entries when approaching the model's context limit

### 5.5 Plan Mode

Plan Mode is a user-facing feature that creates a checkpoint between task planning and execution.

Flow:
1. User submits a complex task
2. Agent generates a step-by-step plan (list of intended tool calls and operations) without executing any of them
3. Plan is streamed to the client and displayed for review
4. User approves, rejects, or edits individual steps
5. On approval, the agent executes each step in sequence, streaming granular progress
6. If a step fails, the agent can propose a corrective action and resume

Plan Mode is enabled per-request via the `planMode: true` flag in the chat request body or toggled globally in user settings.

---

## 6. Long-Term Memory System

**Source:** `server/memory/longTermMemory.ts`

Long-term memory gives IliaGPT the ability to remember facts about a user across separate conversations, without requiring manual note-taking.

### 6.1 Fact Extraction Pipeline

After a conversation ends (when the user closes the chat or the session times out), an async background job runs the fact extraction pipeline:

```
Completed conversation transcript
          │
          ▼
[1] Eligibility check
    - Transcript must be > 3 messages
    - At least one message from the user
    - Conversation not already processed
          │
          ▼
[2] LLM extraction call
    System prompt instructs the model to identify:
      - User preferences (e.g., "prefers Python over JavaScript")
      - Personal context (e.g., "works at Acme Corp as a senior engineer")
      - Project context (e.g., "currently building a SaaS billing system")
      - Recurring goals (e.g., "frequently asks for executive summaries")
    Returns structured JSON list of facts
          │
          ▼
[3] Deduplication
    For each new fact, run a pgvector similarity search
    against existing facts for the same user.
    Similarity threshold: cosine distance < 0.15
    If near-duplicate found: increment mention_count,
    update last_seen_at, skip embedding insertion
          │
          ▼
[4] Importance scoring
    importance = min(mention_count / 10, 1.0)
    New facts start at importance = 0.1
          │
          ▼
[5] Embedding + storage
    Generate 1536-dim embedding for the fact text
    Insert into user_long_term_memories table
    with: user_id, content, embedding, importance,
          source_chat_id, created_at, last_seen_at
```

### 6.2 Memory Retrieval and Injection

At the start of each new conversation, the most relevant memories are retrieved and injected into the system prompt before the first LLM call.

```
New user message received
          │
          ▼
[1] Generate embedding of the user message
          │
          ▼
[2] pgvector cosine similarity search
    SELECT content, importance
    FROM user_long_term_memories
    WHERE user_id = $userId
    ORDER BY embedding <=> $messageEmbedding
    LIMIT 10
          │
          ▼
[3] Score by combined relevance + importance
    score = (1 - cosine_distance) * 0.7 + importance * 0.3
    Select top 5 facts by score
          │
          ▼
[4] Format and inject into system prompt
    "The following facts are known about this user:
    - [fact 1]
    - [fact 2]
    ..."
```

### 6.3 CRUD Operations

The Memory API exposes:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/memories` | List all memories for the authenticated user |
| `GET` | `/api/memories?q=search` | Search memories by keyword |
| `DELETE` | `/api/memories/:id` | Delete a specific memory |
| `DELETE` | `/api/memories` | Delete all memories for the user |

---

## 7. RAG Pipeline

The RAG (Retrieval-Augmented Generation) pipeline enables IliaGPT to answer questions about user-provided documents with accurate citations.

### 7.1 Document Ingestion

```
User uploads document
          │
          ▼
[1] Text extraction by file type
    PDF   → pdf-parse + fallback to Tesseract OCR
    DOCX  → mammoth (preserves heading structure)
    XLSX  → xlsx (extracts sheet data as structured text)
    HTML  → cheerio (strips tags, preserves semantic structure)
    MD    → direct text
    TXT   → direct text
          │
          ▼
[2] Chunking
    Strategy selected by document type:
      - Long-form text (PDF, DOCX): recursive character splitter
        chunk_size=1000, overlap=200
      - Structured data (XLSX, CSV): row-based chunks, 50 rows each
      - Code: language-aware splitter on function/class boundaries
      - HTML: section-based splitting on <h1>/<h2> boundaries
          │
          ▼
[3] Metadata attachment
    Each chunk stores:
      - source document ID
      - page number / sheet name / section heading
      - character offset within the original document
      - chunk sequence number
          │
          ▼
[4] Embedding generation
    Batch embed chunks using configured embedding provider
    (default: OpenAI text-embedding-3-small → 1536 dims)
          │
          ▼
[5] Storage
    INSERT INTO document_chunks
    (document_id, content, embedding, metadata)
    Full-text tsvector index also created for keyword search
```

### 7.2 Hybrid Search

Search queries are answered using both full-text and semantic search, fused via Reciprocal Rank Fusion:

```sql
-- Full-text search using tsvector
SELECT chunk_id, content, ts_rank(fts_vector, query) AS text_score
FROM document_chunks, to_tsquery('english', $query) query
WHERE document_id = ANY($docIds)
  AND fts_vector @@ query
ORDER BY text_score DESC
LIMIT 20;

-- Semantic search using pgvector
SELECT chunk_id, content,
       1 - (embedding <=> $queryEmbedding) AS semantic_score
FROM document_chunks
WHERE document_id = ANY($docIds)
ORDER BY embedding <=> $queryEmbedding
LIMIT 20;
```

Reciprocal Rank Fusion combines the two ranked lists:

```
RRF_score(chunk) = 1/(k + text_rank) + 1/(k + semantic_rank)
  where k = 60 (standard RRF constant)

Final results sorted by RRF_score DESC, LIMIT 8
```

### 7.3 Context Injection

Retrieved chunks are formatted with source attribution and injected into the LLM system prompt:

```
Retrieved context from your documents:

[1] From "Q3 Financial Report.pdf" (page 4):
    "Revenue for Q3 2025 reached $14.2M, representing a 23%..."

[2] From "Strategy Deck.pptx" (slide 12):
    "Key growth initiative: expand into APAC markets by..."

Answer the user's question based on the above context.
If the context does not contain sufficient information, say so.
```

---

## 8. Real-Time Architecture

### 8.1 SSE Streaming (Chat Responses)

Chat responses are delivered via Server-Sent Events over a persistent HTTP connection. The SSE endpoint is:

```
GET /api/chats/:chatId/messages/stream
```

The server writes newline-delimited `event:` + `data:` pairs. The client uses the EventSource API (with a polyfill for Electron) to receive events.

Each message stream:
1. Opens with a `start` event carrying the `messageId`
2. Delivers a sequence of `delta` events with content tokens
3. Interleaves `tool_call` and `tool_result` events when agent tools fire
4. Closes with a `done` event carrying final token counts

The SSE connection has a 60-second idle timeout. If no tokens arrive within 60 seconds (e.g. a slow tool execution), the server sends a `heartbeat` event to keep the connection alive.

### 8.2 WebSocket — Presence and Collaboration

The WebSocket server runs at `ws://host/ws/presence` (`server/realtime/presence.ts`). It handles:

**Presence** — users broadcast their online/away/offline status. Away is triggered after 2 minutes of inactivity. The server maintains a Redis hash of `userId → {status, lastSeen, activeChatId}`. All connected clients receive presence updates for users they share chats with.

**Typing indicators** — when a user starts typing, the client sends a `typing_start` event. The server forwards this to all other participants in the same chat. Typing indicators auto-clear after 5 seconds.

**Chat focus tracking** — the client broadcasts which chat the user is currently viewing. This allows the UI to show "Alice is viewing this conversation" indicators.

### 8.3 Redis Pub/Sub for Multi-Instance SSE

When the platform runs as multiple app instances (e.g., behind a load balancer), SSE connections are distributed across instances. A user's SSE connection might be on instance A while the agent completing their task runs on instance B.

The solution uses Redis pub/sub channels:

```
Instance B completes a streaming chunk
          │
          ▼
Redis PUBLISH chat:{chatId}:stream "{...event payload...}"
          │
          ▼
All instances subscribed to that channel receive the message
          │
          ▼
Instance A finds the SSE connection for chatId in its local registry
          │
          ▼
Instance A writes the event to the SSE response stream
```

Each app instance subscribes to Redis channels for every active SSE connection it holds. Channels are cleaned up when connections close.

---

## 9. Multi-Channel Integrations

### 9.1 MCP Connector Architecture

MCP (Model Context Protocol) connectors allow IliaGPT agents to call authenticated external APIs as tools. The connector system has three parts:

**Connector registry** (`mcp_servers.json`) — declares available connectors with their OAuth configuration, tool definitions, and permission scopes.

**OAuth proxy** (`/api/mcp/oauth/`) — handles the OAuth 2.0 flow for connectors requiring user authorisation. Access tokens are stored encrypted in the `user_mcp_tokens` table.

**Tool proxy** (`/api/mcp/call/`) — routes tool calls from the agent to the appropriate connector, attaches the user's OAuth token, and returns the result. The proxy normalises error responses and handles token refresh automatically.

#### Connector Lifecycle

```
User opens connector settings
          │
          ▼
[1] User clicks "Connect Google Drive"
          │
          ▼
[2] Server redirects to Google OAuth consent screen
    with scopes: drive.readonly, drive.file
          │
          ▼
[3] User grants permission
    Google redirects to /api/mcp/oauth/callback
          │
          ▼
[4] Server exchanges auth code for access + refresh tokens
    Encrypts tokens and stores in user_mcp_tokens
          │
          ▼
[5] Connector now available to the agent
    drive_list_files, drive_read_file, drive_create_file
    tools are added to the active tool registry
```

### 9.2 Telegram and WhatsApp

IliaGPT supports receiving and responding to messages via Telegram and WhatsApp. Messages arrive through webhooks and are translated into the internal chat message format, processed by the same pipeline as web messages, and responses are delivered back through the respective messaging API.

Telegram uses the Bot API. WhatsApp uses the WhatsApp Business Cloud API. Both channels support:
- Text messages
- Document attachments (processed through the document ingestion pipeline)
- Voice messages (transcribed via Whisper API before processing)

### 9.3 Dispatch to Mobile

The mobile dispatch system allows tasks initiated on desktop to be sent to the user's mobile device for execution in a different context, or vice versa. Tasks are serialised into a persistent thread stored in PostgreSQL and can be resumed from any device.

---

## 10. Security Architecture

### 10.1 Authentication

IliaGPT supports three authentication strategies, all handled by Passport.js:

**Google OAuth 2.0** — the primary authentication method. Users are redirected to Google's consent screen and returned with a profile that maps to the `users` table by email address.

**Microsoft OAuth 2.0 (Azure AD)** — for organisations using Microsoft 365. Configured via `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`. Supports both personal accounts and tenant-restricted access.

**Auth0** — a fully managed identity provider that in turn supports SSO, SAML, LDAP, and enterprise identity federation. Used by enterprise customers who need integration with their existing identity infrastructure.

**API key auth** — for the `/v1/*` OpenAI-compatible endpoint. API keys have the format `ilgpt_...`, are stored hashed (SHA-256) in the `api_keys` table, and are verified on every request without requiring a session.

**Anonymous fallback** — for clients where cookies are blocked (Safari ITP, embedded WebViews). Uses `X-Anonymous-User-Id` + `X-Anonymous-Token` headers. The token is an HMAC-SHA256 signature of the user ID with a server-side secret, preventing forgery.

### 10.2 Session Management

Sessions are stored in PostgreSQL using `connect-pg-simple`. Session cookies are:
- `httpOnly: true` — not accessible to JavaScript
- `secure: true` in production — HTTPS only
- `sameSite: 'lax'` — protects against CSRF in cross-origin navigations
- Expiry: 7 days with rolling renewal on each request

The session secret is validated to be at least 32 characters on startup.

### 10.3 CSRF Protection

All state-mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) on the `/api/*` namespace require a CSRF token. The platform uses the synchronised token pattern:
1. The server sets a `XSRF-TOKEN` cookie on first load
2. The client reads this cookie and sends it as the `X-XSRF-TOKEN` header on every mutating request
3. The server verifies the header value matches the cookie value

The `/v1/*` namespace is exempt from CSRF checks because it uses API key authentication (not session cookies).

### 10.4 Rate Limiting

Rate limiting uses a Redis token bucket algorithm. Limits are enforced per authenticated user ID (or per IP for unauthenticated requests):

| Endpoint class | Window | Limit |
|---|---|---|
| Chat completions | 1 minute | 20 requests |
| File generation | 1 minute | 5 requests |
| Embedding generation | 1 minute | 60 requests |
| Authentication | 15 minutes | 10 requests |
| General API | 1 minute | 120 requests |

Rate limit state is stored in Redis with a TTL equal to the window duration. When Redis is unavailable, the system falls back to in-memory rate limiting (per-process, not shared across instances).

### 10.5 SSRF Protection

All outbound HTTP requests made by agent tools pass through an SSRF guard middleware that:
- Resolves the hostname to IP addresses via DNS
- Blocks requests to RFC-1918 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- Blocks requests to the link-local range (169.254.0.0/16)
- Blocks requests to the loopback range (127.0.0.0/8)
- Blocks requests to the IPv6 loopback (::1)
- Blocks requests to cloud metadata endpoints (169.254.169.254, etc.)
- Follows at most 3 redirects and re-validates each hop

### 10.6 Prompt Injection Detection

Before each LLM call, user-supplied content is scanned for prompt injection patterns:

1. **Pattern matching** — a blocklist of known injection phrases ("ignore previous instructions", "you are now", "disregard all prior", etc.)
2. **Embedding similarity** — the user message embedding is compared against a library of known injection embeddings; high similarity triggers a warning flag
3. **Structural analysis** — detects attempts to embed fake system prompts using markdown headers or XML tags

Detected injections are logged to the audit table and the message is either blocked or sanitised before being sent to the LLM.

### 10.7 Code Execution Sandboxing

Python and Node.js code execution runs in isolated environments provided by the FastAPI microservice (`fastapi_sse/`). Each execution:
- Runs in a separate process with a 30-second timeout
- Has no access to the host filesystem (only the per-session `sandbox_workspace/` mount)
- Has no outbound network access by default (configurable per-tool)
- Memory is limited to 512 MB per execution

### 10.8 Delete Protection

File and data deletion operations require:
1. The file/folder to be within an explicitly authorised path (set in user settings)
2. A confirmation approval event from the client before the operation executes
3. The operation to be logged in the audit table

These protections cannot be bypassed by agent tool calls — they are enforced at the tool executor layer.

---

## 11. Database Schema Overview

**Source:** `shared/schema.ts` (~3300 lines)

All table definitions, insert schemas, and TypeScript types live in `shared/schema.ts`. Drizzle ORM generates migration files from this schema.

### 11.1 Core Tables

**users** — authenticated user accounts
```
id            uuid PRIMARY KEY
email         text UNIQUE NOT NULL
display_name  text
avatar_url    text
tier          text DEFAULT 'free'   -- 'free' | 'pro' | 'enterprise'
created_at    timestamptz
settings      jsonb                 -- per-user preferences
```

**sessions** — express-session storage (managed by connect-pg-simple)
```
sid    text PRIMARY KEY
sess   jsonb NOT NULL
expire timestamptz NOT NULL
```

**chats** — conversation containers
```
id          uuid PRIMARY KEY
user_id     uuid REFERENCES users
title       text
created_at  timestamptz
updated_at  timestamptz
metadata    jsonb
```

**messages** — individual turns within a chat
```
id          uuid PRIMARY KEY
chat_id     uuid REFERENCES chats
role        text   -- 'user' | 'assistant' | 'system' | 'tool'
content     text
created_at  timestamptz
model       text   -- which model produced this message
tokens      integer
cost_usd    numeric(10,6)
metadata    jsonb  -- tool calls, citations, artifact refs
fts_vector  tsvector   -- for full-text search
```

**documents** — uploaded files
```
id          uuid PRIMARY KEY
user_id     uuid REFERENCES users
filename    text
mime_type   text
size_bytes  integer
storage_key text    -- path in file storage
created_at  timestamptz
metadata    jsonb
```

**document_chunks** — chunked content with embeddings for RAG
```
id          uuid PRIMARY KEY
document_id uuid REFERENCES documents
content     text
embedding   vector(1536)    -- pgvector column
chunk_index integer
metadata    jsonb
fts_vector  tsvector
```

**user_long_term_memories** — extracted facts with vector embeddings
```
id             uuid PRIMARY KEY
user_id        uuid REFERENCES users
content        text
embedding      vector(1536)
importance     numeric(4,3)    -- 0.0 to 1.0
mention_count  integer DEFAULT 1
source_chat_id uuid REFERENCES chats
created_at     timestamptz
last_seen_at   timestamptz
```

**agents** — saved agent configurations
```
id           uuid PRIMARY KEY
user_id      uuid REFERENCES users
name         text
system_prompt text
tools        text[]    -- enabled tool names
model        text
created_at   timestamptz
```

**api_keys** — OpenAI-compatible API keys
```
id          uuid PRIMARY KEY
user_id     uuid REFERENCES users
key_hash    text UNIQUE    -- SHA-256 of the raw key
name        text
created_at  timestamptz
last_used_at timestamptz
rate_limit  integer
```

**scheduled_tasks** — cron and on-demand tasks
```
id              uuid PRIMARY KEY
user_id         uuid REFERENCES users
name            text
prompt          text
cron_expression text
enabled         boolean DEFAULT true
last_run_at     timestamptz
next_run_at     timestamptz
run_count       integer DEFAULT 0
```

### 11.2 Indexes

Critical performance indexes:

```sql
-- pgvector cosine similarity index (HNSW for fast ANN search)
CREATE INDEX idx_memories_embedding
  ON user_long_term_memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_chunks_embedding
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Full-text search
CREATE INDEX idx_messages_fts ON messages USING gin(fts_vector);
CREATE INDEX idx_chunks_fts ON document_chunks USING gin(fts_vector);

-- Common query patterns
CREATE INDEX idx_messages_chat_id ON messages(chat_id, created_at DESC);
CREATE INDEX idx_chats_user_id ON chats(user_id, updated_at DESC);
CREATE INDEX idx_memories_user_id ON user_long_term_memories(user_id, importance DESC);
```

### 11.3 Read Replica Support

When `DATABASE_READ_URL` is set, read-heavy operations (search, history retrieval, memory retrieval) are routed to the read replica. Write operations always go to the primary. The routing is transparent at the service layer — callers use `db.read` or `db.write` helpers that select the correct connection.

---

## 12. Scalability

### 12.1 Horizontal Scaling

The IliaGPT application server is stateless with respect to user sessions and chat streams. Session state lives in PostgreSQL (via connect-pg-simple) and can be read by any instance. SSE streams are coordinated via Redis pub/sub, allowing the stream source (agent execution) and the stream sink (client connection) to be on different instances.

To scale horizontally:
1. Deploy multiple app instances behind a load balancer (no sticky sessions required)
2. Ensure all instances share the same `DATABASE_URL`, `REDIS_URL`, and file storage backend
3. Use an external Redis (e.g., Elasticache, Upstash) rather than a local Redis process

### 12.2 Background Job Queue

The task scheduler and async post-processing (memory extraction, analytics) use a Redis-backed job queue implemented with BullMQ. Jobs are durable — they survive app restarts. Queue consumers run in separate worker processes (configurable via `WORKER_CONCURRENCY` env var).

Job types:
- `extract_memories` — triggered after each conversation closes
- `run_scheduled_task` — triggered by cron scheduler
- `generate_document` — long-running file generation jobs
- `index_document` — chunking and embedding for uploaded documents

### 12.3 Multi-Instance SSE Coordination

```
Client A ──── SSE connection ───→ App Instance 1
                                         │
                                         │ subscribes to Redis channel
                                         │ chat:{chatId}:stream
                                         │
App Instance 2 completes agent work
         │
         ▼
Redis PUBLISH chat:{chatId}:stream {event}
         │
         ▼
App Instance 1 receives message
         │
         ▼
Writes event to Client A's SSE response stream
```

### 12.4 Database Connection Pooling

Each app instance maintains a connection pool to PostgreSQL (default: max 20 connections via pg-pool). The pool configuration is tuned via `DB_POOL_MIN`, `DB_POOL_MAX`, and `DB_POOL_IDLE_TIMEOUT` env vars. In high-scale deployments, PgBouncer can be placed in front of PostgreSQL to reduce connection overhead.

---

## 13. Extension Points

### 13.1 Adding a New LLM Provider

1. Create a new provider adapter in `server/llm/providers/yourProvider.ts` implementing the `LLMProvider` interface:

```typescript
import { LLMProvider, CompletionRequest, CompletionResponse } from '../types';

export class YourProvider implements LLMProvider {
  name = 'your_provider';

  constructor(private apiKey: string) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // translate request, call API, return normalised response
  }

  async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
    // translate request, stream API response, yield normalised chunks
  }

  async embed(texts: string[]): Promise<number[][]> {
    // call embedding API, return 1536-dim vectors
  }

  async isHealthy(): Promise<boolean> {
    // send probe request, return true/false
  }

  getModels(): string[] {
    return ['your-model-v1', 'your-model-v2'];
  }
}
```

2. Register the provider in `server/llm/providerRegistry.ts`:

```typescript
if (process.env.YOUR_PROVIDER_API_KEY) {
  registry.register(new YourProvider(process.env.YOUR_PROVIDER_API_KEY));
}
```

3. Add the API key env var to `server/config/env.ts` (optional, mark as optional with `z.string().optional()`).

4. Add the provider to the fallback chains in `server/llm/smartRouter.ts` if desired.

### 13.2 Adding a New Tool

1. Create a new tool file in `server/agent/tools/yourTool.ts`:

```typescript
import { z } from 'zod';
import { AgentTool } from '../types';

const inputSchema = z.object({
  query: z.string().describe('The query to process'),
  options: z.object({
    maxResults: z.number().optional().default(10),
  }).optional(),
});

export const yourTool: AgentTool = {
  name: 'your_tool',
  description: 'Describe what this tool does in natural language so the LLM knows when to call it.',
  inputSchema,
  async execute(rawInput) {
    const input = inputSchema.parse(rawInput);
    // perform the tool operation
    return {
      success: true,
      data: { /* result */ },
    };
  },
  // optional: requiresApproval: true,
  // optional: permissions: ['file_system_read'],
};
```

2. The tool is auto-discovered at startup — no manual registration required. The tool registry scans `server/agent/tools/` for exported `AgentTool` objects.

3. Add tests in `tests/agent/tools/yourTool.test.ts`.

### 13.3 Adding a New MCP Connector

1. Add the connector definition to `mcp_servers.json`:

```json
{
  "name": "your-service",
  "displayName": "Your Service",
  "transport": "oauth2",
  "authorizationUrl": "https://yourservice.com/oauth/authorize",
  "tokenUrl": "https://yourservice.com/oauth/token",
  "scopes": ["read", "write"],
  "tools": [
    {
      "name": "your_service_get_data",
      "description": "Retrieve data from Your Service",
      "inputSchema": {
        "type": "object",
        "properties": {
          "id": { "type": "string" }
        },
        "required": ["id"]
      },
      "httpMethod": "GET",
      "pathTemplate": "/api/data/{id}"
    }
  ]
}
```

2. The OAuth proxy and tool proxy in `server/api/mcp/` handle authentication and API calls automatically based on the connector definition. No additional server code is required for standard OAuth2 + REST connectors.

3. For connectors requiring custom logic (webhook handling, complex authentication), create a custom connector handler in `server/connectors/yourService.ts` and register it in `server/connectors/registry.ts`.

### 13.4 Plugin System

The plugin and skill system allows users to extend IliaGPT with domain-specific behaviours.

**Skills** are custom system instruction sets that modify the assistant's behaviour for a domain (e.g., "Legal Research Assistant", "Sales Email Writer"). Skills are stored in the `skills` table and applied to the system prompt when the user activates them.

**Plugins** package a combination of tools, skills, and UI components. First-party plugins live in `client/src/plugins/`. The plugin manifest format:

```typescript
interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  tools?: AgentTool[];          // additional tools to register
  skillTemplate?: string;       // system prompt addition
  uiComponents?: PluginComponent[];  // additional UI panels
  permissions: Permission[];    // required permissions
}
```

Third-party plugins can be installed from the marketplace by pointing to a manifest URL. The plugin loader validates the manifest and sandboxes any provided tool code before registration.

---

## Appendix A — File Layout Reference

```
server/
├── agent/
│   ├── autonomousAgentBrain.ts    Cognitive kernel
│   ├── browser/                   Playwright browser agent
│   ├── langgraph/                 LangGraph DAG definitions
│   ├── pipeline/                  LLM + tool pipeline
│   ├── planMode.ts                Plan Mode implementation
│   ├── superAgent/                Proactive agent behaviours
│   └── tools/                     100+ registered tools
├── api/
│   └── v1/                        OpenAI-compatible API
├── config/
│   └── env.ts                     Environment variable validation
├── connectors/                    MCP connector handlers
├── documents/                     Document ingestion pipeline
├── llm/
│   ├── providers/                 Provider adapters
│   ├── providerRegistry.ts        Provider registration
│   └── smartRouter.ts             Complexity routing + circuit breakers
├── memory/
│   └── longTermMemory.ts          Fact extraction + retrieval
├── realtime/
│   └── presence.ts                WebSocket presence server
├── search/
│   └── unifiedSearch.ts           Hybrid full-text + semantic search
├── tasks/                         Scheduled task management
├── db.ts                          Drizzle database client
├── index.ts                       Server entry point
├── routes.ts                      Route registration
└── storage.ts                     File storage abstraction
```

---

## Appendix B — Environment Variable Reference for Architecture

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | required | Primary PostgreSQL connection string |
| `DATABASE_READ_URL` | same as DATABASE_URL | Read replica connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `SESSION_SECRET` | required | 32+ char session signing secret |
| `DB_POOL_MIN` | `2` | Minimum database connection pool size |
| `DB_POOL_MAX` | `20` | Maximum database connection pool size |
| `WORKER_CONCURRENCY` | `4` | BullMQ worker concurrency |
| `SSE_IDLE_TIMEOUT_MS` | `60000` | SSE connection idle timeout |
| `CIRCUIT_BREAKER_THRESHOLD` | `3` | Failures before circuit opens |
| `CIRCUIT_BREAKER_RESET_MS` | `300000` | Time before half-open probe (5 min) |
| `EMBEDDING_PROVIDER` | `openai` | Provider for embedding generation |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model name |
| `EMBEDDING_DIMS` | `1536` | Embedding vector dimensions |
| `MEMORY_MAX_FACTS` | `5` | Max facts injected per conversation |
| `PLAN_MODE_DEFAULT` | `false` | Enable plan mode by default |
| `CODE_SANDBOX_TIMEOUT_MS` | `30000` | Code execution timeout |
| `CODE_SANDBOX_MEMORY_MB` | `512` | Code execution memory limit |
| `RATE_LIMIT_CHAT_RPM` | `20` | Chat completions per minute limit |

---

*For questions about this architecture, open a GitHub Discussion. For security concerns, follow the process in [docs/SECURITY.md](SECURITY.md).*
