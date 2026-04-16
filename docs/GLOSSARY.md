# IliaGPT Glossary

This glossary defines terms used throughout the IliaGPT codebase, documentation, and issue tracker. Terms are listed in alphabetical order.

---

## A

### Agent

A software entity that autonomously plans and executes multi-step tasks by calling LLMs and tools in a loop. In IliaGPT, agents are implemented as LangGraph DAGs (`server/agent/langgraph/`) and orchestrated by the `autonomousAgentBrain.ts` reasoning engine. Each agent has a system prompt, a set of available tools, a memory context, and an execution budget. Specialized agents exist for deep research, code generation, and browser automation.

### Agentic Loop

The iterative cycle an agent performs to complete a task: (1) receive user input, (2) reason about the next action, (3) call a tool, (4) observe the result, (5) reason again — repeating until the task is complete or the step budget is exhausted. The loop is implemented in `server/agent/pipeline/`. A maximum step count (`AGENT_MAX_STEPS`) prevents infinite loops.

### Artifact

A rich, structured output produced during a conversation that is displayed in the artifact panel rather than inline in the chat. IliaGPT auto-detects artifacts from LLM output: HTML (rendered in a sandboxed iframe), Mermaid diagrams (rendered via the Mermaid library), data tables (sortable/filterable), and large code blocks (rendered with Shiki syntax highlighting). Artifacts support version history — users can navigate between prior versions of the same artifact. The artifact system lives in `client/src/components/artifacts/` and is backed by `artifactStore.ts`.

---

## B

### Budget Enforcement

A per-user daily spending cap denominated in USD, applied at the LLM gateway layer. Each LLM request has an estimated token cost; once a user's cumulative cost for the calendar day reaches their tier's limit, further requests are rejected with HTTP 429. Budgets are configured via `FREE_DAILY_BUDGET_USD`, `PRO_DAILY_BUDGET_USD`, and `ENTERPRISE_DAILY_BUDGET_USD` environment variables. Spend tracking resets at midnight UTC and is stored in PostgreSQL.

---

## C

### Circuit Breaker

A fault-tolerance pattern applied to each LLM provider in the smart router. After 3 consecutive failures for a provider, the circuit opens and all traffic to that provider is blocked for 5 minutes (the cooldown period). After the cooldown, the circuit enters half-open state and allows a single probe request. If the probe succeeds, the circuit closes and normal routing resumes. If it fails, the cooldown resets. This prevents cascading failures from degraded providers from affecting overall system availability.

### Cognitive Kernel

The internal reasoning core of an agent — the combination of system prompt, current context window, tool definitions, and memory injections that determines how the agent thinks and acts. In IliaGPT's architecture, the cognitive kernel is assembled in `autonomousAgentBrain.ts` before each agentic loop iteration. The term is also used to describe the per-turn structured reasoning trace added in recent capability development work.

### Cowork Project

A multi-user collaborative workspace within IliaGPT where team members share chats, agents, integrations, and scheduled tasks. Cowork Projects have their own RBAC settings, shared long-term memory, and a unified audit log. The feature is built on top of the workspace model in the database schema and exposed via the Cowork section of the UI.

---

## E

### Embedding

A dense numerical vector (1536 dimensions by default, using OpenAI `text-embedding-3-small`) that encodes the semantic meaning of a piece of text. Embeddings enable similarity search: two pieces of text that are semantically similar will have vectors with a small cosine distance. IliaGPT stores embeddings in PostgreSQL via the pgvector extension and uses them for long-term memory retrieval and hybrid semantic search. Embeddings are generated asynchronously after messages are stored.

---

## F

### Fallback Chain

An ordered list of LLM providers and models that the smart router tries in sequence when the primary provider is unavailable or has an open circuit breaker. For example, a fallback chain for a complex task might be: `claude-3-7-sonnet → gpt-4o → gemini-2.0-flash → deepseek-v3`. The chain is defined per complexity tier in `server/llm/smartRouter.ts` and can be customized via environment variables.

### Function Calling

The mechanism by which an LLM indicates that it wants to invoke a tool by returning a structured JSON response (rather than prose). IliaGPT normalizes function calling across all providers — providers that use different naming conventions (OpenAI `tool_calls`, Anthropic `tool_use`, Gemini `functionCall`) are mapped to a unified internal format in the provider adapters. Function calling is the primary mechanism by which agents take actions.

---

## G

### Gateway

The LLM Gateway (`server/llm/gateway.ts`) is the central entry point for all outbound LLM requests. It applies the smart router to select the appropriate provider and model, enforces per-user budgets, checks the circuit breaker state, handles streaming responses, deduplicates identical concurrent requests via Redis, and records token usage and cost to the database. All LLM calls — whether from the chat router, an agent, or the memory extraction job — flow through the gateway.

---

## H

### Hybrid Search

IliaGPT's search system combines two retrieval methods and merges their results. Full-text search uses PostgreSQL's `tsvector` indexing and `ts_headline` for result highlighting — fast and exact for keyword matches. Semantic search uses pgvector cosine similarity on embeddings — slower but finds results based on meaning rather than literal text. The two result lists are merged using Reciprocal Rank Fusion (RRF, k=60), which interleaves results by their rank in each list. The unified search endpoint is `GET /api/search` and the implementation is in `server/search/unifiedSearch.ts`.

---

## L

### LangGraph

An open-source Python/TypeScript library from LangChain Inc. for building stateful, graph-based agent workflows. IliaGPT uses LangGraph to define multi-agent DAGs (directed acyclic graphs) in `server/agent/langgraph/`. Each node in the graph is an agent or a tool execution step; edges define the control flow between nodes. LangGraph handles state persistence between node executions and supports conditional branching and parallel node execution.

### LLM Provider

A third-party API service that hosts and serves large language models. IliaGPT abstracts over 16+ providers through a unified adapter interface (`server/llm/types.ts`). Each provider adapter handles authentication, request formatting, response parsing, and streaming normalization specific to that provider's API. Providers are selected at runtime by the smart router based on task complexity, cost, availability, and configured fallback chains.

### Long-Term Memory

Cross-session persistent storage of facts about users, extracted from conversations by a background LLM job. After a conversation ends, an extraction prompt processes the chat history and identifies notable facts (user preferences, professional context, recurring topics). These facts are stored in the `user_long_term_memories` PostgreSQL table with embeddings. On subsequent conversations, semantically relevant memories are retrieved by cosine similarity and injected into the system prompt so that the agent has persistent context across sessions.

---

## M

### MCP (Model Context Protocol)

An open protocol specification for connecting AI models to external tools, data sources, and services. IliaGPT implements MCP connectors in `server/mcp/connectors/` — each connector exposes a set of tools the agent can invoke to interact with an external service (Slack, Notion, GitHub, Jira, etc.). The MCP registry discovers available connectors at startup and makes them available to the agent tool registry. Users authenticate connectors via OAuth or API key in the Settings UI.

### Memory Injection

The process of prepending retrieved long-term memory facts to the system prompt before sending a request to the LLM gateway. Memory injection happens synchronously in the chat request handler, after retrieving relevant memories via pgvector similarity search. The injected memories are formatted as a structured list in the system prompt, clearly marked as "recalled context," so the model knows to treat them as background information rather than the user's current message.

---

## P

### Parallel Agent

An agent execution pattern where multiple specialized sub-agents are dispatched simultaneously to handle independent subtasks of a larger goal. In IliaGPT's LangGraph architecture, parallel agents are represented as parallel branches in the DAG. Results from all branches are collected and synthesized by a coordinator agent. Parallel execution reduces total task latency for workloads that can be decomposed into independent units (e.g., researching multiple topics simultaneously).

### pgvector

A PostgreSQL extension that adds vector data types and similarity search operators to the database. IliaGPT uses pgvector to store 1536-dimensional embedding vectors in the `user_long_term_memories` and `messages` tables, and to perform cosine similarity queries for semantic search and memory retrieval. The `<=>` operator computes cosine distance; an IVFFLAT index accelerates approximate nearest-neighbor queries at scale.

### Plan Mode

An agent interaction pattern in which the agent explicitly generates a structured, human-readable execution plan before taking any actions. The plan lists numbered steps with descriptions of what each step will do. The user reviews the plan and can approve all steps, edit individual steps, or reject the plan entirely. Approved plans are executed with per-step progress indicators. Plan Mode is surfaced in the chat toolbar and in the `planMode.ts` module in `server/agent/`.

### Plugin

A self-contained extension module that adds new tools, UI panels, or behaviors to IliaGPT without modifying core code. Plugins follow a manifest-based registration pattern and can be installed from the community marketplace (planned for v2.0.0) or added manually to the `server/plugins/` directory. Unlike MCP connectors (which focus on external service integrations), plugins can modify any aspect of the system including the agent pipeline, artifact renderers, and UI components.

### Provider Health

The real-time status of each configured LLM provider, tracked by the smart router. Health data includes: current circuit breaker state (closed / open / half-open), last failure timestamp, failure count in the current window, and P50/P95/P99 request latency percentiles. The router runs health checks every 60 seconds for providers in degraded state. Provider health is exposed to admins at `GET /api/admin/provider-health`.

---

## R

### RAG (Retrieval-Augmented Generation)

A technique that improves LLM response quality by retrieving relevant documents or facts from a knowledge base and including them in the prompt, rather than relying solely on what the model has memorized during training. IliaGPT uses RAG in two ways: (1) long-term memory injection (retrieved user facts), and (2) document Q&A (retrieved chunks from uploaded files via pgvector semantic search). Advanced graph-based RAG with multi-hop retrieval is on the v1.2.0 roadmap.

### Router (Smart Router)

The `server/llm/smartRouter.ts` module responsible for selecting the optimal LLM provider and model for each request. The router performs complexity detection on the incoming message (simple / medium / complex, based on length, tool use requirements, and conversation depth), applies circuit breaker state, checks provider availability and latency history, enforces cost budgets, and produces a ranked list of (provider, model) pairs. The first pair from an open circuit provider is selected; subsequent pairs are the fallback chain.

---

## S

### Skill

A named, reusable agent behavior that encapsulates a common task pattern. Skills are stored as SKILL.md files in a designated directory and can be referenced by name in conversation or scheduled tasks. Unlike custom tools (which wrap external API calls), skills are prompt-based: they define the goal, required context, and expected output format for a repeated task type. Skills can be composed with other skills or tools by the agent during task decomposition.

### SSE (Server-Sent Events)

A web standard for unidirectional server-to-client streaming over HTTP. IliaGPT uses SSE to stream LLM token output to the browser in real time. The SSE endpoint is `GET /api/chats/:id/messages/stream`. Each event carries a chunk of the response text. The connection has a 60-second idle timeout. In multi-instance deployments, Redis pub/sub is used so that any server instance can relay tokens to any connected client. WebSocket is available as a fallback.

### Sub-Agent

A specialized agent that is spawned by a parent (coordinator) agent to handle a specific subtask. Sub-agents have their own tool set, system prompt, and execution budget, but share the parent's conversation context. Common sub-agent types in IliaGPT include: deep-research agent (web search and document analysis), coding agent (code generation and execution), and browser agent (OpenClaw-based web automation). Sub-agents communicate with the coordinator via structured message passing in the LangGraph state.

---

## T

### Task Decomposition

The process by which an agent breaks down a complex, ambiguous user request into a structured sequence of concrete subtasks that can each be handled by a tool call or sub-agent. Task decomposition happens in the reasoning step of the agentic loop and is the primary mechanism by which IliaGPT handles multi-step problems. In Plan Mode, the decomposition is surfaced to the user as the visible plan before execution.

### Tool

The fundamental unit of agent capability — a named, schema-validated function that an agent can call to interact with the world. Each tool has a name, a natural-language description (shown to the LLM), a Zod input schema, and an `execute()` handler. Tools are registered in the tool registry (`server/agent/toolRegistry.ts`) and made available to agents based on their configuration. IliaGPT ships with 100+ built-in tools covering web search, file operations, code execution, API integrations, and more.

### Tool Registry

The central catalog of all tools available to agents in IliaGPT. The registry is populated at server startup by scanning built-in tools in `server/agent/tools/`, MCP connector tools, and any installed plugins. Agents receive a filtered view of the registry based on their configuration and the user's enabled capabilities. The registry supports dynamic registration — MCP connectors and plugins can add tools at runtime when they are authenticated or activated.

### Trigger

An event that initiates a scheduled task or workflow. IliaGPT supports two trigger types: (1) **Cron triggers** — time-based schedules defined with standard 5-field cron expressions (e.g., `0 9 * * 1` for every Monday at 9am); and (2) **Webhook triggers** — HTTP POST requests to a unique URL that fire the task immediately when called. Triggers are managed in the Scheduled Tasks UI and stored in the database.

---

## V

### Vector Database

A database optimized for storing and querying high-dimensional vectors (embeddings). IliaGPT uses PostgreSQL with the pgvector extension as its vector database, avoiding the need to run a separate dedicated vector store. Vectors are stored in `vector(1536)` columns and queried with cosine similarity operators and IVFFLAT indexes. For organizations that prefer a dedicated vector database, pgvector can be replaced by Qdrant or Weaviate via an adapter in `server/search/`.

---

## W

### Workspace

The top-level organizational container in IliaGPT. Each workspace has its own set of chats, agents, integrations, scheduled tasks, API keys, and member roster. Users can belong to multiple workspaces. Workspaces are the unit of RBAC — roles (admin, member, viewer) are assigned per workspace. In the database, workspaces correspond to the `workspaces` table and all other entities have a `workspaceId` foreign key.

---

## Z

### Zod Schema

A TypeScript-first schema validation library used throughout IliaGPT to define and enforce data shapes at runtime. Zod schemas serve three purposes: (1) **API validation** — request bodies are parsed and validated against Zod schemas in route handlers, returning structured 400 errors on invalid input; (2) **Environment config** — `server/config/env.ts` uses Zod to validate all environment variables at startup, failing fast on missing or invalid configuration; (3) **Database types** — Drizzle ORM generates Zod insert schemas from the SQL table definitions in `shared/schema.ts`, ensuring database writes are type-safe. Zod schemas are the single source of truth for shared types across client, server, and shared packages.
