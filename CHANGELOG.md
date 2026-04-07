# Changelog

## [2.1.0] - 2026-04-07 — Enterprise Differentiation Features

### Artifacts System (Claude-style)
- Side panel with tabs: Code, Preview, Versions
- Code: syntax highlighted display with line numbers, copy, edit toggle
- Preview: sandboxed iframe for HTML, execution placeholder for JS/Python
- Versions: navigable version history with timestamps and content preview
- Auto-detection: code blocks > 15 lines auto-open artifact panel
- Mermaid diagram rendering (SVG) with DOMPurify sanitization
- Interactive tables: sortable columns, text filter
- Responsive: fullscreen mobile, 50vw desktop panel
- Run button, Apply to chat, Edit toggle

### Long-Term Memory (ChatGPT-style)
- LLM-powered fact extraction from conversations (preferences, personal info, work context)
- pgvector embeddings with semantic recall (cosine similarity + salience + recency decay)
- Memory decay: -5% salience after 30 days inactivity, deactivate below 0.1
- System prompt injection via `<user_context>` block
- Memories management page (/memories) with category filters, search, delete
- Color-coded badges: preference (blue), personal (purple), work (green), knowledge (amber), instruction (rose)
- API: GET/DELETE /api/memories, POST /api/memories/extract

### Smart Model Router
- Cost-aware routing: simple queries → cheapest provider, complex → most capable
- Query complexity classification (simple/moderate/complex) by tokens, code presence, patterns
- Health management: 3 failures → 5min degraded cooldown, auto-recovery
- Circuit breaker integration, routing decision logging (last 1000)

### OpenAI-Compatible Public API
- POST /v1/chat/completions (streaming SSE + non-streaming) — identical OpenAI format
- POST /v1/embeddings, GET /v1/models
- API key management: sk-iliagpt-* keys, SHA-256 validation, rate limiting (60 req/min)
- api_keys Drizzle schema table with indexes

### Agent Plan Mode
- LLM-powered query decomposition into structured steps
- Approval workflow: approve, modify, reject
- Async step-by-step execution with progress events
- Interactive checklist UI component

### Real-Time Presence
- WebSocket heartbeat user tracking per workspace
- Events: online, offline, typing, viewing_chat
- Redis SET storage, typing debounce (3s), auto-clear (5s)

### Unified Search
- PostgreSQL tsvector + pgvector hybrid search with RRF ranking
- Search highlighting, autocompletado (last 10 searches)
- Ctrl+Shift+F keyboard shortcut

### Bug Fix
- ModelAvailabilityContext: graceful degradation instead of crash (HMR fix)

### Tests: 700 passing (106 new module tests + 44 CI + 550 client)

---

## [2.0.0] - 2026-04-07

### Enterprise Architecture
- Smart Model Router: complexity detection, cost/latency tracking, provider health scoring
- Redis PubSub: multi-instance SSE coordination, distributed locks, presence tracking
- Plugin System: 5 built-in plugins with sandboxed hook execution
- GDPR Compliance: data export, right to be forgotten, retention policies, audit trail
- OpenAI-Compatible API: /v1/chat/completions, /v1/embeddings, /v1/models with API key auth

### RAG System (Knowledge Base)
- Multi-provider embeddings (OpenAI, Gemini, local fallback)
- Document processor for PDF/DOCX/XLSX/PPTX/TXT/CSV with intelligent chunking
- pgvector similarity search + hybrid BM25/vector via Reciprocal Rank Fusion
- Knowledge base collections with auto-ingestion pipeline
- Context builder with token limits and citation engine
- REST API: /api/knowledge/*

### MCP Apps Integration
- Fixed Google Drive/Calendar/Gmail with real OAuth URLs and scopes
- Multi-provider OAuth with scope merging across Google connectors
- Connector tools injected into agent for chat integration
- 58 connector manifests properly wired

### Chat Improvements
- PDF export, theme toggle in sidebar, Ctrl+/ shortcuts modal
- Schema: shareId, folderId, tags, ragEnabled, parentMessageId for branching
- Stop button fix, composer spacing fix

### Infrastructure
- ESLint/TypeScript OOM fixed (8GB heap, cache, target ES2022)
- 11 Zod/Drizzle type fixes in schema files
- scripts/with-env.cjs for type-check
- Performance DB indexes migration
- 673+ tests all passing, CI green

---

## [1.0.0] - 2024-12-27

### Added
- Agentic Engine con 70 herramientas en 13 categorías
- ComplexityAnalyzer con scoring multidimensional 1-10
- IntentMapper con soporte para 5 idiomas
- OrchestrationEngine con ejecución paralela
- CompressedMemory con atoms y decay automático
- ErrorRecovery con circuit breakers
- GapDetector con deduplicación por signature
- Dashboard visual en Admin (/admin/agentic) con 7 tabs
- Integración segura con Chat (feature flags)
- Health endpoints (/health/live, /health/ready, /health)
- Botón "Nuevo Chat" profesional con shortcuts
- Componentes UI mejorados (Card, Badge, Skeleton, EmptyState)
- Rate limiting por endpoint
- Métricas del sistema
- Documentación completa

### Security
- Feature flags para control de funcionalidades
- Circuit breakers para resiliencia
- Rate limiting distribuido
- Input sanitization
