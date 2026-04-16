# IliaGPT Architecture

## System Overview

```mermaid
graph TB
    subgraph Client["Frontend (React 19 + Vite)"]
        UI[Chat UI] --> Store[Zustand Stores]
        UI --> Artifacts[Artifact Panel]
        UI --> Search[Search Modal]
        Store --> WS[WebSocket Client]
        Store --> SSE[SSE Client]
    end

    subgraph API["API Layer (Express.js)"]
        Routes[Route Handlers] --> Auth[Auth Middleware]
        Auth --> CSRF[CSRF Protection]
        V1["/v1/* OpenAI Compat"] --> ApiAuth[API Key Auth]
    end

    subgraph Core["Core Services"]
        Router[Smart Router] --> Gateway[LLM Gateway]
        Gateway --> CB[Circuit Breakers]
        Gateway --> Providers
        Pipeline[Agent Pipeline] --> Planner[Plan Mode]
        Pipeline --> Tools[Tool Registry 100+]
        Memory[Long-Term Memory] --> Embed[Embedding Service]
        SearchSvc[Unified Search] --> FTS[Full-Text tsvector]
        SearchSvc --> Semantic[Semantic pgvector]
    end

    subgraph Providers["LLM Providers"]
        OpenAI[OpenAI]
        Anthropic[Anthropic]
        Gemini[Google Gemini]
        XAI[xAI/Grok]
        DeepSeek[DeepSeek]
        Cerebras[Cerebras]
        OpenRouter[OpenRouter]
    end

    subgraph Realtime["Real-Time"]
        Presence[Presence Manager]
        SSEMgr[SSE Stream Manager]
        RedisPub[Redis Pub/Sub]
    end

    subgraph Storage["Data Layer"]
        PG[(PostgreSQL 16)]
        PGVector[(pgvector)]
        Redis[(Redis)]
        S3[(S3/Object Storage)]
    end

    Client --> API
    API --> Core
    Core --> Storage
    WS --> Presence
    SSE --> SSEMgr
    Presence --> RedisPub
```

## Chat Pipeline

```mermaid
sequenceDiagram
    participant User
    participant Client
    participant ChatRouter
    participant SmartRouter
    participant LLMGateway
    participant Provider
    participant Memory
    participant DB

    User->>Client: Send message
    Client->>ChatRouter: POST /api/chat/stream
    ChatRouter->>SmartRouter: selectModel(message, complexity)
    SmartRouter-->>ChatRouter: {model, provider, reason}
    ChatRouter->>Memory: buildMemoryContext(userId, message)
    Memory-->>ChatRouter: relevant memories
    ChatRouter->>LLMGateway: streamChat(messages + memory)
    LLMGateway->>Provider: API call (with circuit breaker)

    alt Provider fails
        LLMGateway->>SmartRouter: recordFailure()
        SmartRouter-->>LLMGateway: fallback provider
        LLMGateway->>Provider: Retry with fallback
    end

    Provider-->>LLMGateway: Stream tokens
    LLMGateway-->>ChatRouter: AsyncGenerator<chunk>
    ChatRouter-->>Client: SSE events
    Client-->>User: Render streaming response

    ChatRouter->>DB: Persist message
    ChatRouter->>Memory: extractFacts(conversation) [async]
```

## Agent Pipeline

```mermaid
stateDiagram-v2
    [*] --> Routing: User message
    Routing --> SimpleChat: No tools needed
    Routing --> Planning: Complex task detected

    Planning --> Draft: Generate plan
    Draft --> Approved: User approves
    Draft --> Rejected: User rejects
    Rejected --> [*]

    Approved --> Executing
    Executing --> StepN: For each step
    StepN --> ToolCall: If tools needed
    ToolCall --> StepN: Tool result
    StepN --> Verifying: All steps done

    Verifying --> Completed: Quality OK
    Verifying --> Executing: Retry needed
    Completed --> [*]
    SimpleChat --> [*]
```

## RAG Pipeline

```mermaid
graph LR
    Upload[File Upload] --> Extract[Text Extraction]
    Extract --> Chunk[Chunking]
    Chunk --> Embed[Embedding Generation]
    Embed --> Store[(pgvector Storage)]

    Query[User Query] --> QEmbed[Query Embedding]
    QEmbed --> Retrieve[Cosine Similarity Search]
    Store --> Retrieve
    Retrieve --> Rerank[Reciprocal Rank Fusion]
    Rerank --> Inject[Context Injection]
    Inject --> LLM[LLM Call]
```

## Directory Structure

```
iliagpt.io/
├── client/                    # React 19 + Vite frontend
│   ├── src/
│   │   ├── components/        # UI components
│   │   │   ├── artifacts/     # Artifact panel (code, html, table, diagram)
│   │   │   ├── chat/          # Chat interface, message list, plan UI
│   │   │   ├── ui/            # shadcn/ui primitives
│   │   │   └── admin/         # Admin dashboard
│   │   ├── stores/            # Zustand state (chat, agent, artifact, streaming)
│   │   ├── hooks/             # React hooks (usePresence, useShikiHighlight, etc.)
│   │   ├── lib/               # Utilities (shikiHighlighter, animations, etc.)
│   │   └── locales/           # i18n (103 locales)
│   └── index.html
├── server/                    # Express.js backend
│   ├── agent/                 # Agent system
│   │   ├── langgraph/         # DAG orchestration
│   │   ├── superAgent/        # Self-improving agent
│   │   ├── planMode.ts        # Plan generation/execution
│   │   └── browser/           # Web automation
│   ├── api/v1/                # OpenAI-compatible API
│   ├── lib/                   # Core libraries
│   │   ├── llmGateway.ts      # Multi-provider LLM gateway
│   │   ├── circuitBreaker.ts  # Per-provider circuit breakers
│   │   ├── tokenCounter.ts    # js-tiktoken + gpt-tokenizer
│   │   └── markdownSanitizer.ts # DOMPurify + sanitize-html
│   ├── llm/
│   │   └── smartRouter.ts     # Cost-aware model selection
│   ├── memory/
│   │   └── longTermMemory.ts  # Cross-session fact extraction
│   ├── search/
│   │   └── unifiedSearch.ts   # Hybrid tsvector + pgvector search
│   ├── realtime/
│   │   └── presence.ts        # Online status, typing indicators
│   ├── routes/                # Express route handlers
│   └── services/              # Business logic services
├── shared/                    # Shared types + Drizzle schemas
│   └── schema.ts              # ~3300 lines, all DB table definitions
├── migrations/                # Drizzle SQL migrations
├── fastapi_sse/               # Python microservice (tool sandbox)
├── desktop/                   # Electron wrapper
├── extension/                 # Chrome extension
└── e2e/                       # Playwright E2E tests
```

## Key Technologies

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19, Vite 7, Wouter, Zustand | SPA with streaming UI |
| UI | shadcn/ui, TailwindCSS 4, Radix | Component library |
| Syntax | Shiki (primary), Prism.js (fallback) | Code highlighting |
| Backend | Express.js, TypeScript | API server |
| Database | PostgreSQL 16 + pgvector | Relational + vector |
| Cache | Redis (ioredis) | Sessions, pub/sub, rate limits |
| Queue | BullMQ | Background jobs |
| LLM | Multi-provider gateway | 7 providers |
| Search | tsvector + pgvector + RRF | Hybrid search |
| Auth | Passport.js, Google/MS/Auth0 OAuth | Multi-provider auth |
| Docs | docx, exceljs, pptxgenjs, pdfkit | Document generation |
| Browser | Playwright | Web automation |
| Desktop | Electron | Desktop app |
| Testing | Vitest, Playwright | Unit + E2E |
| Observability | Pino, OpenTelemetry, Prometheus | Logging + tracing |
