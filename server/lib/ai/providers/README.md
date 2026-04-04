# Universal LLM Provider System

Enterprise-grade multi-provider AI infrastructure with hot-swap, intelligent routing, consensus voting, and universal streaming.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Application Layer                            │
│         (routes, websocket handlers, API endpoints)                 │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│                    UniversalStreamAdapter                           │
│   Normalizes streams from all providers → unified SSE events        │
│   Auto-reconnect │ StreamBuffer (smooth delivery) │ StreamMetrics   │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
┌────────▼───────┐ ┌────────▼───────┐ ┌────────▼──────────┐
│ IntelligentRouter│ │ ConsensusEngine│ │ Direct Provider   │
│                │ │                │ │ Access             │
│ Complexity     │ │ Multi-model    │ │                    │
│ analysis       │ │ vote/fuse      │ │ registry.get(id)   │
│                │ │                │ │ .chat(messages)    │
│ Strategy:      │ │ Unanimous /    │ │                    │
│ cost/quality/  │ │ Majority /     │ │                    │
│ speed/balanced │ │ Fusion         │ │                    │
└────────┬───────┘ └────────┬───────┘ └────────────────────┘
         │                  │
         └──────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────────────┐
│                       ProviderRegistry (singleton)                  │
│   Hot-swap │ Health monitoring │ Event emission │ Capability lookup │
└──────┬──────────┬──────────┬────────┬────────┬────────┬─────────────┘
       │          │          │        │        │        │
  ┌────▼──┐  ┌────▼──┐  ┌───▼──┐ ┌───▼──┐ ┌───▼──┐ ┌──▼────┐
  │OpenAI │  │Anthro-│  │Google│ │ xAI  │ │Groq  │ │Ollama │
  │       │  │  pic  │  │      │ │      │ │      │ │(local)│
  └───────┘  └───────┘  └──────┘ └──────┘ └──────┘ └───────┘
  + Mistral, Cohere, DeepSeek, Together, Perplexity, Fireworks,
    OpenRouter, LM Studio, Azure OpenAI
```

## Quick Start

```typescript
import { initializeProviders } from "./providers/core/index.js";
import { IntelligentRouter } from "./routing/IntelligentRouter.js";
import { UniversalStreamAdapter } from "./streaming/UniversalStreamAdapter.js";

// 1. Initialize (reads from environment variables)
const registry = initializeProviders();

// 2. Direct provider access
const openai = registry.getProvider("openai");
const response = await openai.chat([
  { role: "user", content: "Hello!" }
]);

// 3. Intelligent routing (auto-selects best model)
const router = new IntelligentRouter(registry);
const { response, routingDecision } = await router.routeAndExecute([
  { role: "user", content: "Write a recursive fibonacci function in Rust" }
]);
console.log(`Routed to: ${routingDecision.primary.providerId}/${routingDecision.primary.modelId}`);
console.log(`Cost: $${response.cost?.toFixed(6)}`);

// 4. Streaming
const adapter = new UniversalStreamAdapter(registry);
const session = await adapter.startSession("anthropic", "claude-sonnet-4-6", messages);
for await (const event of session.events) {
  if (event.type === "token") process.stdout.write(event.content ?? "");
  if (event.type === "done") break;
}

// 5. Consensus (multi-model voting)
const engine = new ConsensusEngine(registry);
const consensus = await engine.query(messages, [
  { providerId: "openai", modelId: "gpt-4o" },
  { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
  { providerId: "google", modelId: "gemini-2.5-flash" },
]);
console.log(`Confidence: ${consensus.confidence}`);
console.log(`Strategy: ${consensus.strategy}`);
```

## Environment Variables

| Variable | Provider | Required |
|----------|----------|----------|
| `OPENAI_API_KEY` | OpenAI | Optional |
| `ANTHROPIC_API_KEY` | Anthropic | Optional |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google | Optional |
| `XAI_API_KEY` | xAI (Grok) | Optional |
| `MISTRAL_API_KEY` | Mistral | Optional |
| `COHERE_API_KEY` | Cohere | Optional |
| `DEEPSEEK_API_KEY` | DeepSeek | Optional |
| `GROQ_API_KEY` | Groq | Optional |
| `TOGETHER_API_KEY` | Together AI | Optional |
| `PERPLEXITY_API_KEY` | Perplexity | Optional |
| `FIREWORKS_API_KEY` | Fireworks AI | Optional |
| `OPENROUTER_API_KEY` | OpenRouter | Optional |
| `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` | Azure OpenAI | Optional |
| `OLLAMA_HOST` | Ollama (default: localhost:11434) | Optional |
| `LM_STUDIO_HOST` | LM Studio (default: localhost:1234) | Optional |

Set any variable to activate that provider. At least one provider must be configured.

## Supported Providers (15 total)

| Provider | Models | Specialties |
|----------|--------|-------------|
| OpenAI | GPT-4o, GPT-4.1, o1, o3-mini | Best all-around, vision, function calling |
| Anthropic | Claude Opus/Sonnet/Haiku 4.x | Safety, long context, coding |
| Google | Gemini 2.5 Pro/Flash | Multimodal, 1M+ context |
| xAI | Grok 4.1 Fast, Grok 3 | 2M context window |
| Mistral | Mistral Large/Medium, Codestral | European, code, embeddings |
| Cohere | Command R+, Command R | RAG, search, embeddings |
| DeepSeek | DeepSeek V3, R1 | Coding, reasoning, cheap |
| Groq | Llama, Mixtral, Gemma | Ultra-fast inference (<100ms TTFT) |
| Together AI | Llama, Qwen, Mistral | Open source models |
| Perplexity | Sonar Pro, Sonar | Real-time web search |
| Fireworks | Llama, Firefunction | Function calling specialists |
| OpenRouter | 200+ models | Access to everything |
| Ollama | Any local model | Privacy, no API cost |
| LM Studio | Any GGUF model | GUI-managed local models |
| Azure OpenAI | GPT-4o, GPT-4.1 | Enterprise, compliance |

## Routing Strategies

```typescript
import { RoutingStrategy } from "./providers/core/types.js";

// Available strategies:
RoutingStrategy.COST_OPTIMIZED  // Minimize cost, accept good-enough quality
RoutingStrategy.QUALITY_FIRST   // Best capability regardless of cost
RoutingStrategy.BALANCED        // Default: weighted balance (recommended)
RoutingStrategy.SPEED_FIRST     // Minimize TTFT and total latency
```

The `ComplexityAnalyzer` automatically detects:
- Code blocks → routes to code-capable models
- Vision content → requires vision capability
- Reasoning depth → tier: `flash` / `pro` / `ultra`
- Long context → requires sufficient context window
- Real-time queries → Perplexity (search) models
- Token count → selects adequate context window

## Hot-Swap Providers at Runtime

```typescript
// Add a new provider without restart
registry.register(new GroqProvider({ apiKey: newKey }));

// Remove a provider
registry.unregister("mistral");

// Temporarily disable (keeps in registry, skips for routing)
registry.disable("together");
registry.enable("together");

// Listen for events
registry.on("provider_event", (event) => {
  console.log(event.type, event.providerId);
});
```

## Health Monitoring

```typescript
// All provider health
const status = registry.getHealthStatus();

// Summary counts
const summary = registry.getHealthySummary();
// { total: 12, healthy: 10, degraded: 1, unavailable: 1, disabled: 0 }

// Trigger immediate health checks
await registry.runHealthChecks();
```

## Cost Tracking & Budget

```typescript
import { costCalculator } from "./routing/CostCalculator.js";

// Budget enforcement
const router = new IntelligentRouter(registry, {
  budgetConfig: {
    userId: "user-123",
    dailyLimitUsd: 1.00,
    perRequestLimitUsd: 0.05,
  }
});

// Get spending report
const breakdown = costCalculator.getBreakdown(new Date("2026-04-01"), "user-123");
// { total: 0.234, byProvider: { openai: 0.18, ... }, ... }

// Monthly projection
const projected = costCalculator.projectMonthlySpend("user-123");
```

## Consensus Engine

Use for high-stakes queries where quality matters more than cost:

```typescript
const engine = new ConsensusEngine(registry);

const result = await engine.query(messages, [], {}, {
  minModels: 3,
  maxModels: 5,
  timeoutMs: 20_000,
  qualityThreshold: 0.5,
  fusionEnabled: true,  // Merge best sections from multiple responses
});

// result.strategy: "unanimous" | "majority" | "fusion" | "best_available"
// result.confidence: 0-1
// result.responses: per-model scores and content
```

## Streaming Metrics

```typescript
import { streamMetrics } from "./streaming/StreamMetrics.js";

// Aggregate stats per provider
const stats = streamMetrics.getAggregateStats("openai");
// [{ avgTtftMs: 320, p95TtftMs: 890, avgTokensPerSecond: 45, ... }]

// Detect anomalies in active streams
const anomalies = streamMetrics.detectAnomalies();

// Listen for events
streamMetrics.on("first_token", ({ streamId, ttftMs }) => {
  console.log(`TTFT: ${ttftMs}ms`);
});
streamMetrics.on("stall", ({ streamId, stallCount }) => {
  console.warn(`Stream stalled ${stallCount} times`);
});
```

## Adding a New Provider

1. Extend `BaseProvider` in a new file under `implementations/`
2. Implement `_chat()`, `_stream()`, `_embed()`, `_listModels()`
3. Define your model catalog with pricing
4. Register in `core/index.ts` with the env var check
5. The provider is automatically available for routing

```typescript
export class MyProvider extends BaseProvider {
  readonly id = "myprovider";
  readonly name = "My Provider";

  constructor(config: { apiKey: string }) {
    super({ id: "myprovider", name: "My Provider", ...config });
    this._models = MY_MODELS;
  }

  isCapable(cap: ModelCapability) {
    return [ModelCapability.CHAT, ModelCapability.CODE].includes(cap);
  }

  protected async _chat(messages, options) { /* ... */ }
  protected async *_stream(messages, options) { /* ... */ }
  protected async _embed(texts, options) { /* ... */ }
  protected async _listModels() { return MY_MODELS; }
}
```
