# SearchBrain

WebGLM-inspired academic + web search orchestrator for IliaGPT.

## What it is

SearchBrain is the module at `server/services/searchBrain/` that turns the
existing multi-source academic retrieval (`unifiedAcademicSearch`) plus a
small web-search layer (`webProviders`) into a single WebGLM-style
pipeline:

1. **Query Decomposition** — the connected LLM rewrites the user's raw
   query into 3-5 retrieval-friendly sub-queries (Spanish + English
   mix). Degrades to the original query if the LLM is unavailable.
2. **Parallel Multi-Source Retrieval** — `Promise.allSettled` over every
   enabled provider × sub-query with per-provider timeouts, normalised
   into a uniform `NormalisedResult` shape, then deduped by DOI first
   and normalised title second.
3. **LLM Re-ranking** — top candidates are batched to the LLM with a
   0-10 relevance rubric; final score combines rerank + providerRank +
   log-scaled citations + open-access boost.

For the web side there is a leaner two-step fan-out (SearXNG rotation /
DuckDuckGo / Wikipedia → URL-dedup), and a `/deep` endpoint fuses
academic + web + LLM synthesis with APA 7 citations.

A PostgreSQL-backed cache with exact-hit + semantic-hit (pgvector
cosine ≥ 0.92) sits in front of the whole pipeline.

## "Cerebro vs cuerpo" philosophy

IliaGPT is the **body**:
- HTTP surface, auth, rate limiting
- Provider connectors + parsers
- Parallel retrieval, dedupe, beam search
- pgvector cache + Redis (future)
- React UI panel

The connected LLM (through `llmGateway`, which routes OpenAI /
Anthropic / Gemini / OpenRouter / etc.) is the **brain**:
- Query decomposition
- Relevance re-ranking
- Synthesised answer with citations

This split keeps the infrastructure stable — you can swap models
without touching SearchBrain, and the heuristic fallbacks mean the
pipeline still answers when no LLM is available.

## Sources

All providers are reached with free-tier access. No paid API keys are
required; the ones that benefit from an optional email (for "polite
pool" headers) read it from the user's Settings.

| Provider | Type | License | Notes |
|---|---|---|---|
| **OpenAlex** | API | CC0 | Polite pool via `mailto=`. No key. |
| **Semantic Scholar** | API | Open | Free tier ~100 req / 5 min per IP. |
| **CrossRef** | API | Open | Polite pool via `User-Agent: ...; mailto=...`. |
| **arXiv** | API | Open | Atom XML. Please throttle to 1 req / 3 s. |
| **PubMed (E-utilities)** | API | Open | 3 req/s anon, 10 req/s with key. |
| **SciELO** | API | Open | Public LatAm index. |
| **DOAJ** | API | Open | Open-access directory. |
| **CORE** | API | Requires key | Free key at [core.ac.uk](https://core.ac.uk). |
| **BASE** | API | Open | Bielefeld Academic Search Engine. |
| **Redalyc** | Scraping | Public HTML | Low-volume cheerio scrape. |
| **Scopus** | Scraping | Opt-in | Puppeteer under user's own IP. Phase 1c+. |
| **Web of Science** | Scraping | Opt-in | Puppeteer under user's own IP. Phase 1c+. |
| **SearXNG** | API | Public instances | Rotates across `searx.be`, `priv.au`, etc. |
| **DuckDuckGo** | Scraping | Public HTML | lite endpoint. |
| **Wikipedia** | API | Open | REST summary + OpenSearch. |

Scopus and Web of Science explicitly **do not** ship a free tier.
Their official APIs require an institutional subscription. SearchBrain
gates those behind `enableScrapingProviders: true` in Settings and
will launch Puppeteer **only** when the user has toggled that flag,
documenting in the UI that the scrape runs under their own IP.

## Endpoints

All mounted at `/api/search-brain/*`. Existing `/api/academic` routes
are unchanged.

### `GET /providers`
Lists academic + web providers with rate-limit notes.

```bash
curl -s https://iliagpt.io/api/search-brain/providers | jq
```

### `POST /academic`
WebGLM 3-phase pipeline over academic sources.

```bash
curl -s -X POST https://iliagpt.io/api/search-brain/academic \
  -H "Content-Type: application/json" \
  -d '{
    "query": "efectos de la melatonina en el sueño de adolescentes",
    "sources": ["openalex","semantic","crossref","scielo","pubmed"],
    "maxResults": 10,
    "rerank": true
  }' | jq
```

Body:
- `query` (string, required)
- `sources` (string[], optional) — subset of the academic catalog
- `maxResults` (number, default 10)
- `rerank` (boolean, default true)
- `language` (`"es" | "en" | "auto"`)
- `enableScrapingProviders` (boolean, default false) — needed for `scopus` / `wos`
- `mailto` (string) — polite-pool override

### `POST /web`
Parallel web search across SearXNG + DuckDuckGo + Wikipedia.

```bash
curl -s -X POST https://iliagpt.io/api/search-brain/web \
  -H "Content-Type: application/json" \
  -d '{"query": "next-generation lithium-iron-phosphate batteries", "maxResults": 10}' | jq
```

### `POST /deep`
Academic + web + LLM synthesis with APA 7 citations.

```bash
curl -s -X POST https://iliagpt.io/api/search-brain/deep \
  -H "Content-Type: application/json" \
  -d '{
    "query": "what is the role of melatonin in circadian entrainment?",
    "maxAcademic": 8,
    "maxWeb": 4
  }' | jq
```

Response shape (abbreviated):
```json
{
  "query": "...",
  "academic": { "results": [...], "providers": [...], "timings": {...} },
  "web":      { "results": [...], "providers": [...], "totalMs": 420 },
  "synthesis": {
    "answer": "Melatonin is the primary hormone... [1]. Studies show... [2].",
    "references": [
      { "number": 1, "apa": "García, J. (2023). ... *Rev. Med.* https://doi.org/...", "type": "academic", "url": "...", "doi": "..." },
      { "number": 2, "apa": "Melatonin. (n.d.). *en.wikipedia.org*. https://en.wikipedia.org/wiki/Melatonin", "type": "web", "url": "..." }
    ],
    "usedCitations": [1, 2],
    "synthesised": true
  }
}
```

### `GET /settings` · `POST /settings`
Per-user preferences. Requires an authenticated session for writes.

```bash
# Set your polite-pool email + enable Scopus/WoS scraping under your own IP
curl -s -X POST https://iliagpt.io/api/search-brain/settings \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{"mailto":"you@example.com","enableScrapingProviders":true}'
```

## Cache layer

`search_brain_cache` (migration `migrations/0104_add_search_brain_cache.sql`)
stores response payloads keyed by `(query_hash, kind)` where `kind` is
`'academic' | 'web' | 'deep'`. The table also keeps a `vector(1536)`
embedding column so a near-miss query can reuse a recent result via
cosine similarity (`embedding <=> $1`) ≥ `0.92`.

TTL defaults:
- Academic: **30 days** — papers don't churn
- Web: **24 hours**
- Deep: **24 hours** (bounded by the cheaper branch)

`searchCache.lookup()` is called before the retrieval fan-out. When a
hit is found the orchestrator short-circuits and returns
`{ ...cachedPayload, cache: { hit: true, matchedBy: "exact" | "semantic" } }`.
When nothing hits, the result of the live fan-out is written back to
the cache on success.

Redis is not yet wired in. The Postgres path is already fast and the
project's current Redis helper is disabled in development; a future
commit will add an opt-in `REDIS_URL`-gated fast-path.

## IP tradeoff (residential vs server)

SearchBrain runs on Node.js, so HTTP calls go out from the interface
of whatever machine hosts Express. In practice:

- **Self-hosted / Electron / local dev** → outbound IP is the user's
  home ISP. Providers that rate-limit per IP (Semantic Scholar, the
  Redalyc scraper) see "one user = one IP" which matches the system's
  intent.
- **Shared cloud deployment** → outbound IP is the server's IP. All
  users share the same rate-limit bucket per provider. In this mode
  we recommend:
  - setting a `mailto` per-tenant (OpenAlex / CrossRef polite pools
    become per-email, not per-IP)
  - enabling the cache layer (default in Phase 1c) so repeat queries
    don't re-hit providers
  - disabling Scopus / WoS scraping unless the deployment is on a
    dedicated residential proxy.

The UI surfaces this to the user in the Settings panel as "Your
searches go out from: `<local IP>` (self-hosted) / `<server IP>`
(hosted)."

## Dependency-injection seams (for tests)

Every LLM + fetch + DB call in SearchBrain is reachable through an
injectable dependency. `SearchBrainOptions.__deps` accepts
`{ callLLM, retrieveFrom, now }`, `extractContent` accepts
`{ fetcher, pdfParser, htmlExtractor }`, `searchCache.lookup/write`
accept a `CacheStore`, and every web provider accepts a `fetcher`.
Tests run without network, without Postgres, and without pdf-parse /
jsdom / @mozilla/readability loaded at import time.

## Roadmap

Phase 1c remaining:
- React `SearchBrainPanel` component with multi-chip source selector,
  streaming result cards, APA 7 "Copy citation" buttons, synthesis
  panel with clickable [N] markers.
- Puppeteer Scopus / WoS scrapers (behind `enableScrapingProviders`).
- Redis fast-path for exact-hit cache reads.
- End-to-end Playwright smoke.
