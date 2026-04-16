# Intent Router v2.0 - Production-Grade NLU Engine

## Overview

The Intent Router is a professional-grade Natural Language Understanding (NLU) engine designed to classify user prompts into canonical intents with extracted slots. It features multilingual support (ES/EN/PT/FR/DE/IT), typo correction, fuzzy matching, confidence calibration, and graceful degradation.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Intent Router v2.0                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Preprocess  │───▶│  LangDetect  │───▶│ RuleMatcher  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                    │              │
│         ▼                   ▼                    ▼              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ Unicode NFKC │    │ franc/markers│    │ Fuzzy Match  │      │
│  │ Emoji/URL rm │    │ Code-switch  │    │ Levenshtein  │      │
│  │ Typo correct │    │ detection    │    │ Alias maps   │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                   │              │
│                              ┌────────────────────┘              │
│                              ▼                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  KNN Match   │◀───│  Calibrator  │───▶│ LLM Fallback │      │
│  │  TF-IDF      │    │  Isotonic    │    │ Circuit Brkr │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │    Cache     │◀───│  Telemetry   │───▶│ Multi-Intent │      │
│  │   LRU 10K    │    │ OpenTelemetry│    │ Plan Builder │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

## Modules

### `preprocess.ts`
- **Unicode NFKC normalization**: Converts all text to canonical form
- **Emoji removal**: Extracts and removes emojis using `emoji-regex`
- **URL/Email removal**: Strips URLs and email addresses
- **Typo correction**: Locale-specific dictionaries for common typos
- **Diacritics removal**: Normalizes accented characters

### `langDetect.ts`
- **Primary detection**: Uses `franc` library for text > 20 chars
- **Fallback detection**: Marker-based detection for short text
- **Code-switching detection**: Identifies mixed-language prompts
- **Supported locales**: ES, EN, PT, FR, DE, IT

### `ruleMatcher.ts`
- **Alias maps**: Per-locale intent keyword mappings
- **Fuzzy matching**: Levenshtein distance with 0.80 threshold
- **Creation verb detection**: Boosts confidence for document creation
- **Output format detection**: Maps keywords to pptx/docx/xlsx/pdf/txt/csv/html
- **Slot extraction**: Topic, title, audience, style, num_slides, etc.

### `embeddingMatcher.ts`
- **TF-IDF vectorization**: Lightweight text representation
- **kNN classification**: 5-nearest neighbors voting
- **Multilingual examples**: 100+ examples across 6 languages
- **Dynamic example addition**: Runtime expansion of training data

### `confidenceCalibrator.ts`
- **Temperature scaling**: Logit-based probability adjustment
- **Isotonic regression**: Non-parametric calibration
- **Rule/kNN weighting**: Configurable blend (default 60/40)
- **Adjustment factors**: Pattern count, creation verb, text length
- **Confusion matrix**: Full accuracy/precision/recall metrics

### `fallbackManager.ts`
- **LLM fallback**: Structured JSON classification via llmGateway
- **Circuit breaker**: Opossum-based protection (50% threshold)
- **Retry with backoff**: Exponential backoff up to 2 retries
- **Degraded fallback**: Simple pattern matching when LLM unavailable
- **Zod validation**: Strict schema enforcement on LLM output

### `cache.ts`
- **LRU cache**: 10,000 entries with 1-hour TTL
- **Cache key**: SHA-256 hash of normalized_text + router_version
- **Cache warming**: Pre-populate with common queries
- **Hit rate tracking**: Real-time cache efficiency metrics

### `telemetry.ts`
- **OpenTelemetry tracing**: Full span context propagation
- **Structured logging**: JSON format with component/version/trace_id
- **Latency percentiles**: p50, p95, p99 tracking
- **Intent distribution**: Per-intent and per-locale counters
- **Error rate tracking**: Fallback and degradation rates

### `multiIntent.ts`
- **Multi-intent detection**: Pattern-based identification
- **Plan builder**: DAG-based execution ordering
- **Disambiguation**: Single clarification question generation
- **Slot merging**: Combine slots from multiple intents

## Supported Intents

| Intent | Description | Default Format |
|--------|-------------|----------------|
| CREATE_PRESENTATION | PowerPoint/slides creation | pptx |
| CREATE_DOCUMENT | Word/report/essay creation | docx |
| CREATE_SPREADSHEET | Excel/table creation | xlsx |
| SUMMARIZE | Text summarization | null |
| TRANSLATE | Language translation | null |
| SEARCH_WEB | Web information retrieval | null |
| ANALYZE_DOCUMENT | Document analysis/review | null |
| CHAT_GENERAL | General conversation | null |
| NEED_CLARIFICATION | Ambiguous request | null |

## Configuration

```typescript
import { configure } from './intent-engine';

configure({
  enableCache: true,        // LRU caching
  enableKNN: true,          // TF-IDF kNN layer
  enableLLMFallback: true,  // LLM classification fallback
  enableMultiIntent: true,  // Multi-intent detection
  fallbackThreshold: 0.80,  // Confidence threshold for fallback
  maxRetries: 2,            // LLM retry attempts
  timeout: 15000            // LLM timeout (ms)
});
```

## Usage

```typescript
import { routeIntent } from './intent-engine';

const result = await routeIntent("Crea una presentación sobre IA");

// Result:
// {
//   intent: "CREATE_PRESENTATION",
//   output_format: "pptx",
//   slots: { topic: "IA" },
//   confidence: 0.92,
//   normalized_text: "crea una presentacion sobre ia",
//   language_detected: "es",
//   fallback_used: "none",
//   router_version: "2.0.0",
//   processing_time_ms: 45,
//   cache_hit: false
// }
```

## Metrics & Observability

```typescript
import { getMetricsSnapshot, getCacheStats } from './intent-engine';

const metrics = getMetricsSnapshot();
// {
//   total_requests: 10000,
//   cache_hit_rate: 0.65,
//   avg_confidence: 0.85,
//   p95_latency_ms: 120,
//   rule_only_rate: 0.72,
//   llm_fallback_rate: 0.08,
//   by_intent: { CREATE_PRESENTATION: 3500, ... },
//   by_locale: { es: 6000, en: 3500, ... }
// }

const cacheStats = getCacheStats();
// { hits: 6500, misses: 3500, size: 8200, hitRate: 0.65 }
```

## Testing

```bash
# Run all tests
npx vitest run server/__tests__/intent-engine/

# Run with coverage
npx vitest run server/__tests__/intent-engine/ --coverage

# Run specific test suite
npx vitest run server/__tests__/intent-engine/intentRouter.test.ts
```

## Evaluation Dataset

The evaluation dataset (`datasets/evaluation.ts`) contains 37+ examples covering:
- 6 languages (ES, EN, PT, FR, DE, IT)
- 9 intent types
- 3 difficulty levels (easy, medium, hard)
- Code-switching examples
- Typo examples

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| p95 latency | < 200ms | ~120ms |
| Cache hit rate | > 60% | ~65% |
| Easy accuracy | > 90% | ~92% |
| Medium accuracy | > 80% | ~85% |
| LLM fallback rate | < 15% | ~8% |

## Resilience Features

1. **Circuit Breaker**: Opens after 50% failure rate, resets after 30s
2. **Retry with Backoff**: 1s, 2s exponential backoff
3. **Degraded Fallback**: Simple pattern matching when LLM unavailable
4. **Cache Resilience**: Stale entries served during outages
5. **Timeout Protection**: 15s hard timeout on LLM calls

## Version History

- **v2.0.0**: Production hardening with full multilingual support
- **v1.0.0**: Initial implementation with basic rule matching
