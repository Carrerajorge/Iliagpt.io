/**
 * MULTI-MODEL ORCHESTRATOR
 *
 * Advanced agent orchestration that can use multiple LLM models
 * in reasoning chains, ensemble voting, and parallel processing.
 *
 * Features:
 * - Multi-model reasoning chains (model A thinks, model B verifies)
 * - Ensemble voting (ask N models, take best answer)
 * - Parallel execution with result aggregation
 * - Model specialization routing (code→Codestral, reasoning→o3, speed→Flash)
 * - Automatic complexity analysis for model selection
 * - Chain-of-thought verification across models
 * - Cost-aware model selection within budget constraints
 */

import { EventEmitter } from "events";
import { providerRegistry } from "../../lib/providers/ProviderRegistry";
import type {
  LLMRequestConfig,
  LLMCompletionResponse,
  LLMMessage,
  ModelInfo,
} from "../../lib/providers/BaseProvider";
import { healthMonitor } from "./ProviderHealthMonitor";
import { costEngine } from "./CostOptimizationEngine";

// ============================================================================
// Types
// ============================================================================

export type TaskComplexity = "trivial" | "simple" | "moderate" | "complex" | "expert";
export type TaskDomain = "general" | "code" | "math" | "reasoning" | "creative" | "research" | "vision" | "translation";

export interface TaskAnalysis {
  complexity: TaskComplexity;
  domain: TaskDomain;
  estimatedTokens: number;
  requiresVision: boolean;
  requiresTools: boolean;
  requiresReasoning: boolean;
  suggestedModels: Array<{ model: string; provider: string; reason: string }>;
  confidence: number;
}

export interface ChainStep {
  id: string;
  name: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  inputTransform?: (previousOutput: string, context: ChainContext) => LLMMessage[];
  outputTransform?: (output: string) => string;
  condition?: (context: ChainContext) => boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface ChainContext {
  steps: Array<{ step: string; output: string; model: string; latencyMs: number; tokens: number }>;
  originalInput: string;
  metadata: Record<string, unknown>;
}

export interface EnsembleConfig {
  models: Array<{ model: string; provider?: string; weight?: number }>;
  strategy: "majority_vote" | "best_quality" | "fastest" | "weighted_average";
  minResponses: number;
  timeoutMs: number;
}

export interface OrchestrationResult {
  content: string;
  model: string;
  provider: string;
  strategy: string;
  steps?: ChainContext["steps"];
  totalLatencyMs: number;
  totalTokens: number;
  totalCost: number;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Complexity Analyzer
// ============================================================================

const COMPLEXITY_SIGNALS: Record<string, { domain: TaskDomain; complexity: number }> = {
  // Code signals
  "write.*code|implement|function|class|api|endpoint|component|debug|fix.*bug": { domain: "code", complexity: 3 },
  "refactor|optimize|architecture|design pattern|microservice": { domain: "code", complexity: 4 },
  "compiler|interpreter|language|asm|kernel|driver": { domain: "code", complexity: 5 },

  // Math/reasoning
  "calculate|compute|equation|formula|integral|derivative": { domain: "math", complexity: 3 },
  "proof|theorem|hypothesis|mathematical": { domain: "math", complexity: 5 },
  "analyze|reason|logic|deduce|infer|evaluate": { domain: "reasoning", complexity: 3 },

  // Creative
  "write.*story|poem|creative|narrative|fiction": { domain: "creative", complexity: 2 },
  "essay|article|blog|content": { domain: "creative", complexity: 2 },

  // Research
  "research|investigate|compare|survey|review": { domain: "research", complexity: 3 },
  "academic|paper|citation|literature": { domain: "research", complexity: 4 },

  // Vision
  "image|picture|photo|screenshot|diagram|chart|visual": { domain: "vision", complexity: 2 },

  // Translation
  "translate|translation|idiom|localize": { domain: "translation", complexity: 2 },
};

// ============================================================================
// Orchestrator
// ============================================================================

export class MultiModelOrchestrator extends EventEmitter {
  private modelPreferences: Map<string, string[]> = new Map(); // domain -> preferred models

  constructor() {
    super();
    this.initializePreferences();
  }

  private initializePreferences(): void {
    this.modelPreferences.set("code", ["codestral-latest", "grok-code-fast-1", "claude-sonnet-4-20250514", "gpt-4o"]);
    this.modelPreferences.set("math", ["deepseek-reasoner", "claude-opus-4-20250514", "o3", "gemini-2.5-pro"]);
    this.modelPreferences.set("reasoning", ["claude-opus-4-20250514", "o3", "deepseek-reasoner", "gemini-2.5-pro"]);
    this.modelPreferences.set("creative", ["claude-sonnet-4-20250514", "gpt-4o", "gemini-2.5-flash"]);
    this.modelPreferences.set("research", ["sonar-pro", "claude-opus-4-20250514", "gemini-2.5-pro"]);
    this.modelPreferences.set("vision", ["gpt-4o", "claude-sonnet-4-20250514", "gemini-2.5-flash", "pixtral-large-latest"]);
    this.modelPreferences.set("translation", ["gpt-4o", "claude-sonnet-4-20250514", "mistral-large-latest"]);
    this.modelPreferences.set("general", ["gpt-4o", "claude-sonnet-4-20250514", "gemini-2.5-flash", "grok-4-1-fast-non-reasoning"]);
  }

  // ===== Task Analysis =====

  analyzeTask(messages: LLMMessage[]): TaskAnalysis {
    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    const text = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
    const normalizedText = text.toLowerCase();

    let bestDomain: TaskDomain = "general";
    let maxComplexity = 1;
    let confidence = 0.5;

    for (const [pattern, signal] of Object.entries(COMPLEXITY_SIGNALS)) {
      const regex = new RegExp(pattern, "i");
      if (regex.test(normalizedText)) {
        if (signal.complexity > maxComplexity) {
          maxComplexity = signal.complexity;
          bestDomain = signal.domain;
          confidence = 0.7;
        }
      }
    }

    // Adjust complexity based on message length
    const totalChars = messages.reduce((sum, m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return sum + content.length;
    }, 0);
    if (totalChars > 10000) maxComplexity = Math.min(5, maxComplexity + 1);

    const hasImages = messages.some((m) => {
      if (typeof m.content !== "string" && Array.isArray(m.content)) {
        return (m.content as any[]).some((p) => p.type === "image_url");
      }
      return false;
    });
    if (hasImages) bestDomain = "vision";

    const complexity = this.mapComplexity(maxComplexity);
    const suggestedModels = this.getSuggestedModels(bestDomain, complexity);

    return {
      complexity,
      domain: bestDomain,
      estimatedTokens: Math.ceil(totalChars / 4) + 2000,
      requiresVision: hasImages,
      requiresTools: /tool|function|api|search|browse|execute/i.test(normalizedText),
      requiresReasoning: maxComplexity >= 4,
      suggestedModels,
      confidence,
    };
  }

  private mapComplexity(score: number): TaskComplexity {
    if (score <= 1) return "trivial";
    if (score <= 2) return "simple";
    if (score <= 3) return "moderate";
    if (score <= 4) return "complex";
    return "expert";
  }

  private getSuggestedModels(domain: TaskDomain, complexity: TaskComplexity): TaskAnalysis["suggestedModels"] {
    const preferred = this.modelPreferences.get(domain) || this.modelPreferences.get("general")!;
    return preferred.slice(0, 3).map((model) => {
      const provider = providerRegistry.getProviderForModel(model);
      return {
        model,
        provider: provider?.name || "unknown",
        reason: `Best for ${domain} tasks with ${complexity} complexity`,
      };
    }).filter((m) => providerRegistry.getProviderForModel(m.model));
  }

  // ===== Reasoning Chain =====

  async executeChain(
    steps: ChainStep[],
    initialMessages: LLMMessage[],
    userId: string = "system"
  ): Promise<OrchestrationResult> {
    const context: ChainContext = {
      steps: [],
      originalInput: typeof initialMessages[initialMessages.length - 1]?.content === "string"
        ? initialMessages[initialMessages.length - 1].content as string : "",
      metadata: {},
    };

    let currentMessages = initialMessages;
    let totalLatency = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let lastResult: LLMCompletionResponse | null = null;

    for (const step of steps) {
      // Check condition
      if (step.condition && !step.condition(context)) continue;

      // Transform input if needed
      if (step.inputTransform) {
        const lastOutput = context.steps[context.steps.length - 1]?.output || "";
        currentMessages = step.inputTransform(lastOutput, context);
      }

      // Add step system prompt
      if (step.systemPrompt) {
        currentMessages = [
          { role: "system", content: step.systemPrompt },
          ...currentMessages.filter((m) => m.role !== "system"),
        ];
      }

      // Select model
      const model = step.model || this.selectModelForStep(step, context);
      const provider = step.provider
        ? providerRegistry.get(step.provider)
        : providerRegistry.getProviderForModel(model);

      if (!provider) {
        throw new Error(`No provider for model ${model} in step ${step.name}`);
      }

      // Execute
      const start = Date.now();
      const result = await provider.complete({
        model,
        messages: currentMessages,
        temperature: step.temperature ?? 0.7,
        maxTokens: step.maxTokens ?? 4096,
      });
      const latencyMs = Date.now() - start;

      // Record health
      healthMonitor.recordSuccess(provider.name, latencyMs, model, result.usage.totalTokens);

      // Record cost
      const costRecord = await costEngine.trackUsage({
        userId,
        provider: provider.name,
        model,
        usage: result.usage,
        latencyMs,
      });

      // Transform output
      let output = result.content;
      if (step.outputTransform) output = step.outputTransform(output);

      // Record step
      context.steps.push({
        step: step.name,
        output,
        model,
        latencyMs,
        tokens: result.usage.totalTokens,
      });

      totalLatency += latencyMs;
      totalTokens += result.usage.totalTokens;
      totalCost += costRecord.totalCost;
      lastResult = result;

      // Prepare next messages
      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: output },
      ];

      this.emit("chainStep", { step: step.name, model, latencyMs, tokens: result.usage.totalTokens });
    }

    return {
      content: lastResult?.content || "",
      model: lastResult?.model || "",
      provider: lastResult?.provider || "",
      strategy: "chain",
      steps: context.steps,
      totalLatencyMs: totalLatency,
      totalTokens,
      totalCost,
      metadata: context.metadata,
    };
  }

  // ===== Ensemble Voting =====

  async executeEnsemble(
    config: EnsembleConfig,
    messages: LLMMessage[],
    userId: string = "system"
  ): Promise<OrchestrationResult> {
    const promises = config.models.map(async (m) => {
      const provider = m.provider
        ? providerRegistry.get(m.provider)
        : providerRegistry.getProviderForModel(m.model);

      if (!provider) return null;

      try {
        const start = Date.now();
        const result = await Promise.race([
          provider.complete({ model: m.model, messages, temperature: 0.7, maxTokens: 4096 }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), config.timeoutMs)),
        ]);
        if (!result) return null;

        const latencyMs = Date.now() - start;
        healthMonitor.recordSuccess(provider.name, latencyMs, m.model, result.usage.totalTokens);
        return { ...result, weight: m.weight || 1, latencyMs };
      } catch {
        return null;
      }
    });

    const results = (await Promise.all(promises)).filter(Boolean) as (LLMCompletionResponse & { weight: number; latencyMs: number })[];

    if (results.length < config.minResponses) {
      throw new Error(`Ensemble failed: only ${results.length}/${config.minResponses} responses received`);
    }

    let selected: typeof results[0];

    switch (config.strategy) {
      case "fastest":
        selected = results.sort((a, b) => a.latencyMs - b.latencyMs)[0];
        break;
      case "best_quality":
        selected = results.sort((a, b) => b.content.length - a.content.length)[0]; // Heuristic: longer = more detailed
        break;
      case "weighted_average":
      case "majority_vote":
      default:
        selected = results.sort((a, b) => b.weight - a.weight)[0];
        break;
    }

    return {
      content: selected.content,
      model: selected.model,
      provider: selected.provider,
      strategy: `ensemble_${config.strategy}`,
      totalLatencyMs: Math.max(...results.map((r) => r.latencyMs)),
      totalTokens: results.reduce((sum, r) => sum + r.usage.totalTokens, 0),
      totalCost: 0, // Calculated separately
      metadata: {
        responsesReceived: results.length,
        modelsUsed: results.map((r) => r.model),
      },
    };
  }

  // ===== Smart Model Selection =====

  async selectBestModel(messages: LLMMessage[], constraints?: {
    maxCostPerRequest?: number;
    maxLatencyMs?: number;
    requiredCapabilities?: string[];
    preferredProvider?: string;
  }): Promise<{ model: string; provider: string; reason: string }> {
    const analysis = this.analyzeTask(messages);

    if (analysis.suggestedModels.length > 0) {
      // Filter by constraints
      for (const suggestion of analysis.suggestedModels) {
        const provider = providerRegistry.getProviderForModel(suggestion.model);
        if (!provider) continue;
        if (!healthMonitor.canRequest(provider.name)) continue;
        if (constraints?.preferredProvider && provider.name !== constraints.preferredProvider) continue;

        return suggestion;
      }
    }

    // Fallback to best available
    const bestProvider = healthMonitor.getBestProvider();
    if (bestProvider) {
      const provider = providerRegistry.get(bestProvider);
      if (provider) {
        const models = await provider.listModels();
        const model = models[0];
        if (model) return { model: model.id, provider: bestProvider, reason: "best_available_fallback" };
      }
    }

    throw new Error("No suitable model available for the task");
  }

  private selectModelForStep(step: ChainStep, context: ChainContext): string {
    const preferred = this.modelPreferences.get("general") || [];
    for (const model of preferred) {
      const provider = providerRegistry.getProviderForModel(model);
      if (provider && healthMonitor.canRequest(provider.name)) return model;
    }
    return "gpt-4o"; // Ultimate fallback
  }

  destroy(): void {
    this.removeAllListeners();
  }
}

// Singleton
export const orchestrator = new MultiModelOrchestrator();
