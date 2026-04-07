# Changelog

All notable changes to IliaGPT are documented here.

## [2026-04-07] - Enterprise Features Release

### Smart Model Router
- **Cost-aware routing**: Classifies queries as simple/medium/complex, routes to appropriate model tier
- **Circuit breaker**: 3 consecutive failures mark provider as degraded for 5 minutes
- **Fallback chains**: Automatic cascade to next provider/tier when primary is down
- **Budget enforcement**: Per-user daily limits (free: $0.50, pro: $5, enterprise: $50)
- **Health monitoring**: 60-second health checks recover degraded providers
- **Latency optimization**: Tracks P50/P95/P99, prefers lowest-latency provider

### Artifacts Panel
- **Code artifacts**: Shiki syntax highlighting with VS Code themes, copy button
- **HTML artifacts**: Sandboxed iframe preview with source view toggle
- **Table artifacts**: Interactive sorting and filtering from JSON/CSV/markdown
- **Diagram artifacts**: Mermaid diagram rendering with error fallback
- **Auto-detection**: Automatically identifies artifact type from content patterns
- **Versioning**: Each edit creates a new version, navigate with arrows
- **Integration**: "Open as Artifact" button appears on code blocks >20 lines

### Long-Term Memory
- **Fact extraction**: LLM-powered extraction of preferences, personal info, work context
- **Semantic recall**: pgvector cosine similarity search across stored facts
- **Importance scoring**: Frequently mentioned facts get higher weight
- **Context injection**: Relevant memories injected into system prompt automatically
- **User control**: View, edit, delete memories via Settings UI and API

### Agent Plan Mode
- **Plan generation**: Agent creates step-by-step plan before executing complex tasks
- **User approval**: Approve, modify, or reject plans before execution
- **Real-time progress**: Live status updates per step (pending/in_progress/completed/failed)
- **SSE streaming**: Plan execution progress streamed to client
- **Interactive UI**: Checklist component with timeline visualization

### OpenAI-Compatible API
- **Chat completions**: `POST /v1/chat/completions` with streaming and non-streaming modes
- **Embeddings**: `POST /v1/embeddings` returning 1536-dim vectors
- **Model list**: `GET /v1/models` with all available models
- **API key auth**: SHA-256 hashed keys with rate limiting and expiration
- **Drop-in replacement**: Any OpenAI SDK client works by changing `base_url`

### Real-Time Presence
- **Online status**: Green dot indicator for active users
- **Typing indicators**: 5-second auto-clear with bounce animation
- **Chat focus**: See who's viewing which conversation
- **WebSocket broadcast**: Real-time updates via dedicated `/ws/presence` channel
- **Heartbeat**: 30-second intervals with 2-minute offline threshold

### Hybrid Search
- **Full-text search**: PostgreSQL tsvector with ts_headline highlighting
- **Semantic search**: pgvector embeddings with cosine similarity
- **Reciprocal Rank Fusion**: Combines both ranking signals (k=60)
- **Search modal**: `Ctrl+Shift+F` with dual mode (quick local + deep server)
- **Filters**: Type (message/chat/document), date range, model

### Library Integrations
- **shiki**: VS Code-quality syntax highlighting (replaced prismjs in markdown renderer)
- **sanitize-html**: Server-side HTML sanitization without JSDOM dependency
- **better-sse**: Spec-compliant SSE sessions alongside existing streaming
- **gpt-tokenizer**: Fallback tokenizer with native o200k_base for O-series models
- **cheerio**: Fast HTML extraction (~8x faster than JSDOM) for scraping
- **jose**: Modern JWT library for API authentication
- **mem0ai**: Intelligent memory layer for cross-session context

### Infrastructure Improvements
- **Pino logging**: Migrated console.log to structured pino logging in routes.ts, auth files, config
- **Sonner consolidation**: Unified dual toast system to Sonner-only via API bridge
- **Error boundaries**: React error boundaries with retry for all major sections
- **Skeleton loaders**: Shimmer loading states for chat, dashboard, settings
- **Mobile responsive**: Artifact panel full-screen on mobile, responsive layouts
- **Accessibility**: aria-labels on icon buttons, skip-to-content link, semantic roles
- **SEO metadata**: Dynamic titles, Open Graph tags, meta descriptions

### Testing
- 86+ new feature tests across 5 test suites
- Integration tests for document generation, skill dispatch, artifact detection
- Full chat flow integration tests with mocked storage
- 550/550 client tests passing
- 44/44 CI chat-core tests passing
