/**
 * server/lib/ai/index.ts — Central AI system exports.
 *
 * Wires together:
 *   - ProviderRegistry + all provider implementations
 *   - IntelligentRouter (model/provider selection)
 *   - ConsensusEngine (multi-provider agreement)
 *   - UniversalStreamAdapter (stream normalization)
 *   - ReasoningEngine (chain-of-thought)
 *   - ComplexityAnalyzer + CostCalculator (routing inputs)
 *
 * Usage:
 *   import { registry, intelligentRouter, streamAdapter } from "@/lib/ai"
 */

// ── Core Provider System ────────────────────────────────────────────────────
export * from "./providers/core";

// ── Model Orchestrator (legacy compat) ──────────────────────────────────────
export {
  AIModelService,
  aiService,
  modelRouter,
  type ModelProvider,
  type ModelTier,
  type ModelConfig,
  type LatencyLane,
  type PromptRequest,
  type ModelResponse,
} from "./modelOrchestrator";

// ── Intelligent Routing ──────────────────────────────────────────────────────
export {
  IntelligentRouter,
  intelligentRouter,
} from "./routing/IntelligentRouter";

export {
  ComplexityAnalyzer,
  complexityAnalyzer,
  type ComplexityBreakdown,
} from "./routing/ComplexityAnalyzer";

export {
  CostCalculator,
} from "./routing/CostCalculator";

// ── Consensus Engine ─────────────────────────────────────────────────────────
export {
  ConsensusEngine,
  consensusEngine,
} from "./consensus/ConsensusEngine";

// ── Stream Adapter ───────────────────────────────────────────────────────────
export {
  UniversalStreamAdapter,
  streamAdapter,
  chunkToSSE,
  sseTerminator,
  tee,
  merge,
} from "./streaming/UniversalStreamAdapter";

// ── Reasoning Engine ─────────────────────────────────────────────────────────
export {
  ReasoningEngine,
  reasoningEngine,
  type ReasoningStep,
  type ReasoningTrace,
} from "./reasoningEngine";

// ── Context Manager ──────────────────────────────────────────────────────────
export {
  contextManager,
} from "./contextManager";

// ── Creative Engine ──────────────────────────────────────────────────────────
export {
  creativeEngine,
} from "./creativeEngine";

// ── Capability Types ─────────────────────────────────────────────────────────
export * from "./agentSwarm";

// ── Convenience factory: get a fully configured routing chain ─────────────────

import { ProviderRegistry, registry } from "./providers/core/ProviderRegistry";
import { IntelligentRouter, intelligentRouter } from "./routing/IntelligentRouter";
import { ConsensusEngine, consensusEngine } from "./consensus/ConsensusEngine";
import { UniversalStreamAdapter, streamAdapter } from "./streaming/UniversalStreamAdapter";
import { ReasoningEngine, reasoningEngine } from "./reasoningEngine";

export interface AISystem {
  registry: ProviderRegistry;
  router: IntelligentRouter;
  consensus: ConsensusEngine;
  stream: UniversalStreamAdapter;
  reasoning: ReasoningEngine;
}

/**
 * Returns the singleton AI system — all components share state and are
 * already initialized with env-var API keys.
 */
export function getAISystem(): AISystem {
  return {
    registry,
    router: intelligentRouter,
    consensus: consensusEngine,
    stream: streamAdapter,
    reasoning: reasoningEngine,
  };
}

export { registry };
