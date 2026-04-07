# Changelog

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
