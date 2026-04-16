# WebTool Architecture Documentation

## Overview

The WebTool module is the Agent's primary interface for web information retrieval. It provides a production-grade, multi-layered system for searching, fetching, extracting, and scoring web content.

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              AGENT EXECUTION LAYER                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ToolRegistry         ExecutionEngine        PolicyEngine        SandboxSecurity│
│  ├─ register()        ├─ execute()           ├─ checkAccess()    ├─ isHostAllowed()
│  ├─ execute()         ├─ retries             ├─ rateLimit        ├─ blockedHosts
│  └─ validate()        └─ circuitBreaker      └─ permissions      └─ allowedHosts
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              WEBTOOL ENTRY POINT                                │
│                           server/agent/webtool/index.ts                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│  WebToolInputSchema (Zod)                                                       │
│  executeWebTool(input, context) → ToolResult                                    │
│  ├─ Input validation                                                            │
│  ├─ Calls RetrievalPipeline.retrieve()                                          │
│  ├─ Formats artifacts (data, documents)                                         │
│  ├─ Generates markdown preview                                                  │
│  └─ Records metrics                                                             │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                        ┌─────────────┴─────────────┐
                        ▼                           ▼
┌────────────────────────────────────┐  ┌────────────────────────────────────────┐
│     LEGACY RETRIEVAL PIPELINE      │  │     ULTRA-FAST RETRIEVAL SYSTEM        │
│   server/agent/webtool/            │  │   server/agent/webtool/                │
│   retrievalPipeline.ts             │  │   fastFirstPipeline.ts                 │
├────────────────────────────────────┤  ├────────────────────────────────────────┤
│ • Sequential execution             │  │ • RetrievalPlanner (query optimization)│
│ • Basic deduplication              │  │ • ConcurrencyPool (parallel execution) │
│ • Quality scoring                  │  │ • ResponseCache (memory-aware)         │
│ • Content extraction               │  │ • FastFirstPipeline (strategy)         │
│                                    │  │ • RelevanceFilter (chunk scoring)      │
│                                    │  │ • RetrievalMetrics (SLA tracking)      │
└────────────────────────────────────┘  └────────────────────────────────────────┘
                        │                           │
                        └─────────────┬─────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              ADAPTER LAYER                                      │
├────────────────────────┬────────────────────────┬───────────────────────────────┤
│     SearchAdapter      │     FetchAdapter       │      BrowserAdapter           │
│  ├─ search()           │  ├─ fetch()            │  ├─ browse()                  │
│  └─ searchScholar()    │  ├─ retries            │  ├─ waitStrategies            │
│                        │  └─ robotsTxt          │  └─ scrollPagination          │
└────────────────────────┴────────────────────────┴───────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              UTILITY LAYER                                      │
├───────────────────┬───────────────────┬───────────────────┬─────────────────────┤
│  canonicalizeUrl  │   hashContent     │  qualityScorer    │      types.ts       │
│  ├─ normalize     │  ├─ SHA256        │  ├─ domain score  │  ├─ Zod schemas     │
│  ├─ removeParams  │  └─ dedupe        │  ├─ recency       │  └─ TypeScript      │
│  └─ extractDomain │                   │  └─ HTTPS bonus   │                     │
└───────────────────┴───────────────────┴───────────────────┴─────────────────────┘
```

## Module Inventory

### Core Files

| File | Purpose | LOC | Dependencies |
|------|---------|-----|--------------|
| `index.ts` | Entry point, tool registration | ~212 | toolRegistry, metricsCollector, retrievalPipeline |
| `types.ts` | Zod schemas, TypeScript types | ~228 | zod |
| `retrievalPipeline.ts` | Legacy orchestration | ~613 | adapters, security, utilities |
| `fastFirstPipeline.ts` | Ultra-fast orchestration | ~543 | all new modules |

### Adapter Layer

| File | Purpose | Interface |
|------|---------|-----------|
| `searchAdapter.ts` | Web search abstraction | `ISearchAdapter` |
| `fetchAdapter.ts` | HTTP fetch with retries | `IFetchAdapter` |
| `browserAdapter.ts` | Playwright browser automation | `IBrowserAdapter` |

### Ultra-Fast Retrieval System

| File | Purpose | Key Features |
|------|---------|--------------|
| `retrievalPlanner.ts` | Query optimization | 3-6 queries, keyword extraction, entity detection |
| `concurrencyPool.ts` | Parallel execution | Configurable limits, priority queue, AsyncGenerator |
| `responseCache.ts` | Smart caching | ETag/Last-Modified, TTL, memory limits (50MB) |
| `fastFirstPipeline.ts` | Fast-first strategy | Fetch 2-4s → Browser 8s, SPA detection |
| `relevanceFilter.ts` | Content filtering | Chunk scoring, key fact extraction |
| `retrievalMetrics.ts` | SLA tracking | P95 latency, cache hit rate, success rate |

### Utility Layer

| File | Purpose |
|------|---------|
| `canonicalizeUrl.ts` | URL normalization, 50+ tracking params removed |
| `hashContent.ts` | SHA256 content hashing for deduplication |
| `qualityScorer.ts` | Multi-factor quality scoring |

## Data Flow

### Request Flow

```
User Query → WebTool.execute()
         ↓
Input Validation (Zod)
         ↓
PolicyEngine.checkAccess()
         ↓
RetrievalPipeline.retrieve() OR FastFirstPipeline.retrieve()
         ↓
SearchAdapter.search() [parallel web + scholar]
         ↓
URL Canonicalization & SandboxSecurity check
         ↓
Deduplication by canonical URL
         ↓
FetchAdapter.fetch() OR BrowserAdapter.browse()
         ↓
Content Extraction (Readability)
         ↓
Quality Scoring & Deduplication by content hash
         ↓
Filtering & Ranking
         ↓
ToolResult (artifacts, previews, logs)
```

### Ultra-Fast Retrieval Flow

```
User Prompt → RetrievalPlanner.plan()
          ↓
QueryPlan {queries[], entities[], keywords[], recency}
          ↓
ConcurrencyPool.executeAll(searchTasks)
          ↓
WebSearchResult[] (deduplicated by canonical URL)
          ↓
FastFirstPipeline.fetchWithFastFirst()
    ├─ SandboxSecurity.isHostAllowed()
    ├─ ResponseCache.get() [cache hit?]
    │   └─ Return cached content
    └─ FetchAdapter.fetch() [2-4s timeout]
        ├─ Success → Extract content
        │   └─ needsBrowser() check
        │       └─ BrowserAdapter.browse() if SPA
        └─ Failure → BrowserAdapter.browse() [8s timeout]
          ↓
ResponseCache.set() [with ETag/Last-Modified]
          ↓
RelevanceFilter.filter() [chunk scoring]
          ↓
RetrievedSource[] {content, relevanceScore, qualityScore}
          ↓
RetrievalMetrics.record()
          ↓
FastFirstResult
```

## Coupling Points

### Internal Coupling

1. **RetrievalPipeline ↔ Adapters**: Tight coupling through interfaces (`ISearchAdapter`, `IFetchAdapter`, `IBrowserAdapter`)
2. **FastFirstPipeline ↔ Cache**: Direct dependency on `ResponseCache` singleton
3. **All modules ↔ SandboxSecurity**: URL validation before network access
4. **All modules ↔ Validation**: Zod schemas from `types.ts`

### External Coupling

1. **ToolRegistry**: Tool registration and execution routing
2. **ExecutionEngine**: Circuit breaker, retries, timeouts
3. **PolicyEngine**: Access control, rate limiting
4. **MetricsCollector**: Performance tracking

## Bottlenecks

### Identified Performance Bottlenecks

| Location | Issue | Impact | Mitigation |
|----------|-------|--------|------------|
| SearchAdapter | Sequential search calls | Latency | Parallel query execution via ConcurrencyPool |
| FetchAdapter | Slow/unresponsive sites | Pipeline stall | Fast-first strategy with timeouts |
| BrowserAdapter | Playwright cold start | 2-3s overhead | Connection pooling (future) |
| Content Extraction | Readability parsing | CPU intensive | Chunked processing |
| Cache lookup | Memory pressure | OOM risk | Memory-aware eviction (50MB cap) |

### SLA Thresholds

| Metric | Target | Current |
|--------|--------|---------|
| Fetch P95 | <3000ms | ~2000ms |
| Browser P95 | <8000ms | ~6000ms |
| Cache Hit Rate | >30% | Variable |
| Success Rate | >95% | 99%+ |

## Security Considerations

### Implemented Security Measures

1. **SandboxSecurity**: Domain allowlist with wildcard matching
2. **URL Validation**: Zod schema validation at entry points
3. **Input Sanitization**: All inputs validated via Zod schemas
4. **Memory Limits**: Cache capped at 50MB, 1MB per entry
5. **Rate Limiting**: PolicyEngine controls request rates
6. **Content Size Limits**: Large content rejected from cache

### Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| SSRF via URL | High | SandboxSecurity allowlist |
| Memory exhaustion | High | Memory-aware eviction, content size limits |
| DoS via slow URLs | Medium | Circuit breaker, timeouts |
| Content injection | Medium | DOMPurify in frontend rendering |
| Cache poisoning | Low | Per-user cache keys (future) |

## Test Coverage

### Unit Tests
- **webtool.test.ts**: 170 tests covering adapters and pipeline
- **webtool-retrieval.test.ts**: 54 tests covering ultra-fast system

### Benchmarks
- **scripts/web-bench.ts**: 13 performance benchmarks
- All components tested against SLA thresholds

## Configuration Options

### FastFirstPipeline Options

```typescript
interface FastFirstOptions {
  fetchTimeoutMs: number;      // Default: 3000
  browserTimeoutMs: number;    // Default: 8000
  maxConcurrency: number;      // Default: 6
  maxQueries: number;          // Default: 4
  maxResultsPerQuery: number;  // Default: 5
  maxTotalResults: number;     // Default: 10
  minRelevanceScore: number;   // Default: 0.15
  enableCache: boolean;        // Default: true
  enablePrefetch: boolean;     // Default: true
  streamResults: boolean;      // Default: true
}
```

### ResponseCache Options

```typescript
interface CacheOptions {
  maxEntries: number;          // Default: 500
  defaultTtlMs: number;        // Default: 5 minutes
  fetchTtlMs: number;          // Default: 10 minutes
  browserTtlMs: number;        // Default: 5 minutes
  cleanupIntervalMs: number;   // Default: 60 seconds
  maxMemoryMb: number;         // Default: 50
  maxContentSizeBytes: number; // Default: 1MB
}
```

## Future Improvements

### Short-term
- [ ] Integrate FastFirstPipeline as primary retrieval path
- [ ] Add connection pooling for BrowserAdapter
- [ ] Implement prefetch for likely next queries

### Long-term
- [ ] Redis-based distributed cache
- [ ] Multi-region edge caching
- [ ] ML-based relevance scoring
- [ ] Real-time citation verification
