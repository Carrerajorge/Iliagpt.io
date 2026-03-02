export type TaskComplexity = 'simple' | 'moderate' | 'complex';
export type TaskType = 'chat' | 'reasoning' | 'code' | 'research' | 'creative' | 'data_analysis' | 'web_automation' | 'document_generation';

export interface ModelTier {
  id: string;
  provider: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  maxContextTokens: number;
  strengths: TaskType[];
  speed: 'fast' | 'medium' | 'slow';
}

export interface RoutingPolicy {
  complexity: TaskComplexity;
  taskTypes: TaskType[];
  preferredTier: string;
}

export interface ProviderHealth {
  failures: number;
  lastFailure: number | null;
  circuitOpen: boolean;
  circuitOpenedAt: number | null;
  successCount: number;
}

export interface CostTracker {
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  modelUsage: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
}

export interface RouteResult {
  modelId: string;
  reason: string;
  estimatedCostPer1kTokens: number;
}

const MODEL_TIERS: Record<string, ModelTier> = {
  'minimax/minimax-m2.5': {
    id: 'minimax/minimax-m2.5',
    provider: 'openrouter',
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0003,
    maxContextTokens: 128000,
    strengths: ['chat', 'creative', 'document_generation'],
    speed: 'fast',
  },
  'openai/gpt-4o-mini': {
    id: 'openai/gpt-4o-mini',
    provider: 'openrouter',
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    maxContextTokens: 128000,
    strengths: ['chat', 'code', 'data_analysis'],
    speed: 'fast',
  },
  'openai/gpt-4o': {
    id: 'openai/gpt-4o',
    provider: 'openrouter',
    costPer1kInput: 0.0025,
    costPer1kOutput: 0.01,
    maxContextTokens: 128000,
    strengths: ['reasoning', 'code', 'research', 'data_analysis'],
    speed: 'medium',
  },
  'anthropic/claude-3.5-sonnet': {
    id: 'anthropic/claude-3.5-sonnet',
    provider: 'openrouter',
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    maxContextTokens: 200000,
    strengths: ['reasoning', 'code', 'creative', 'research'],
    speed: 'medium',
  },
  'deepseek/deepseek-chat': {
    id: 'deepseek/deepseek-chat',
    provider: 'openrouter',
    costPer1kInput: 0.00014,
    costPer1kOutput: 0.00028,
    maxContextTokens: 64000,
    strengths: ['code', 'reasoning', 'data_analysis'],
    speed: 'fast',
  },
  'google/gemini-2.5-flash': {
    id: 'google/gemini-2.5-flash',
    provider: 'openrouter',
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    maxContextTokens: 1000000,
    strengths: ['chat', 'reasoning', 'research', 'creative'],
    speed: 'fast',
  },
};

const ROUTING_POLICIES: RoutingPolicy[] = [
  { complexity: 'simple', taskTypes: ['chat'], preferredTier: 'openai/gpt-4o-mini' },
  { complexity: 'simple', taskTypes: ['creative', 'document_generation'], preferredTier: 'minimax/minimax-m2.5' },
  { complexity: 'moderate', taskTypes: ['code', 'data_analysis'], preferredTier: 'deepseek/deepseek-chat' },
  { complexity: 'moderate', taskTypes: ['research', 'web_automation'], preferredTier: 'openai/gpt-4o-mini' },
  { complexity: 'complex', taskTypes: ['reasoning', 'code', 'research'], preferredTier: 'openai/gpt-4o' },
  { complexity: 'complex', taskTypes: ['creative', 'document_generation'], preferredTier: 'anthropic/claude-3.5-sonnet' },
];

function getFallbackChain(): string[] {
  const envChain = process.env.AGENT_FALLBACK_MODELS;
  if (envChain) {
    return envChain.split(',').map(m => m.trim()).filter(Boolean);
  }
  return [
    'minimax/minimax-m2.5',
    'openai/gpt-4o-mini',
    'deepseek/deepseek-chat',
    'google/gemini-2.5-flash',
    'openai/gpt-4o',
  ];
}

export class ModelRouter {
  private providerHealth: Map<string, ProviderHealth> = new Map();
  private costTracker: CostTracker = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedCostUsd: 0,
    modelUsage: {},
  };
  private circuitBreakerThreshold = 3;
  private circuitRecoveryMs = 60_000;
  private perRunCostCeilingUsd = parseFloat(process.env.AGENT_COST_CEILING_USD || '0.50');

  getModelTiers(): Record<string, ModelTier> {
    return { ...MODEL_TIERS };
  }

  classifyComplexity(intent: string, messageLength: number, toolCount: number): TaskComplexity {
    if (intent === 'chat' && messageLength < 200 && toolCount === 0) return 'simple';
    if (['research', 'multi_step_task'].includes(intent)) return 'complex';
    if (['code_generation', 'data_analysis'].includes(intent) && messageLength > 500) return 'complex';
    if (toolCount > 5) return 'complex';
    if (messageLength > 300 || toolCount > 2) return 'moderate';
    return 'simple';
  }

  mapIntentToTaskType(intent: string): TaskType {
    const mapping: Record<string, TaskType> = {
      'chat': 'chat',
      'research': 'research',
      'code_generation': 'code',
      'data_analysis': 'data_analysis',
      'document_generation': 'document_generation',
      'presentation_creation': 'document_generation',
      'spreadsheet_creation': 'data_analysis',
      'web_automation': 'web_automation',
      'multi_step_task': 'reasoning',
      'creative': 'creative',
    };
    return mapping[intent] || 'chat';
  }

  route(intent: string, messageLength: number, toolCount: number): RouteResult {
    const envModel = process.env.AGENT_MODEL;
    if (envModel && !this.isCircuitOpen(envModel)) {
      const tier = MODEL_TIERS[envModel];
      return {
        modelId: envModel,
        reason: 'env_override',
        estimatedCostPer1kTokens: tier ? (tier.costPer1kInput + tier.costPer1kOutput) / 2 : 0,
      };
    }

    const complexity = this.classifyComplexity(intent, messageLength, toolCount);
    const taskType = this.mapIntentToTaskType(intent);

    const matchedPolicy = ROUTING_POLICIES.find(
      p => p.complexity === complexity && p.taskTypes.includes(taskType)
    );

    if (matchedPolicy && !this.isCircuitOpen(matchedPolicy.preferredTier)) {
      const tier = MODEL_TIERS[matchedPolicy.preferredTier];
      if (tier) {
        return {
          modelId: matchedPolicy.preferredTier,
          reason: `policy:${complexity}/${taskType}`,
          estimatedCostPer1kTokens: (tier.costPer1kInput + tier.costPer1kOutput) / 2,
        };
      }
    }

    const fallbackChain = getFallbackChain();
    for (const modelId of fallbackChain) {
      if (!this.isCircuitOpen(modelId)) {
        const tier = MODEL_TIERS[modelId];
        return {
          modelId,
          reason: 'fallback_chain',
          estimatedCostPer1kTokens: tier ? (tier.costPer1kInput + tier.costPer1kOutput) / 2 : 0,
        };
      }
    }

    const defaultModel = 'minimax/minimax-m2.5';
    return {
      modelId: defaultModel,
      reason: 'last_resort',
      estimatedCostPer1kTokens: 0.0002,
    };
  }

  recordSuccess(modelId: string): void {
    const health = this.getOrCreateHealth(modelId);
    health.successCount++;
    health.failures = 0;
    if (health.circuitOpen) {
      health.circuitOpen = false;
      health.circuitOpenedAt = null;
      console.log(`[ModelRouter] Circuit closed for ${modelId} after success`);
    }
  }

  recordFailure(modelId: string): void {
    const health = this.getOrCreateHealth(modelId);
    health.failures++;
    health.lastFailure = Date.now();
    if (health.failures >= this.circuitBreakerThreshold && !health.circuitOpen) {
      health.circuitOpen = true;
      health.circuitOpenedAt = Date.now();
      console.warn(`[ModelRouter] Circuit OPENED for ${modelId} after ${health.failures} failures`);
    }
  }

  isCircuitOpen(modelId: string): boolean {
    const health = this.providerHealth.get(modelId);
    if (!health || !health.circuitOpen) return false;
    if (health.circuitOpenedAt && Date.now() - health.circuitOpenedAt > this.circuitRecoveryMs) {
      health.circuitOpen = false;
      health.failures = 0;
      console.log(`[ModelRouter] Circuit half-open for ${modelId}, allowing retry`);
      return false;
    }
    return true;
  }

  trackUsage(modelId: string, inputTokens: number, outputTokens: number): void {
    const tier = MODEL_TIERS[modelId];
    const inputCost = tier ? (inputTokens / 1000) * tier.costPer1kInput : 0;
    const outputCost = tier ? (outputTokens / 1000) * tier.costPer1kOutput : 0;
    const callCost = inputCost + outputCost;

    this.costTracker.totalInputTokens += inputTokens;
    this.costTracker.totalOutputTokens += outputTokens;
    this.costTracker.estimatedCostUsd += callCost;

    if (!this.costTracker.modelUsage[modelId]) {
      this.costTracker.modelUsage[modelId] = { inputTokens: 0, outputTokens: 0, calls: 0 };
    }
    const usage = this.costTracker.modelUsage[modelId];
    usage.inputTokens += inputTokens;
    usage.outputTokens += outputTokens;
    usage.calls++;
  }

  isBudgetExceeded(): boolean {
    return this.costTracker.estimatedCostUsd >= this.perRunCostCeilingUsd;
  }

  getBudgetWarning(): string | null {
    const pct = (this.costTracker.estimatedCostUsd / this.perRunCostCeilingUsd) * 100;
    if (pct >= 100) return `Cost budget exceeded: $${this.costTracker.estimatedCostUsd.toFixed(4)} / $${this.perRunCostCeilingUsd.toFixed(2)}`;
    if (pct >= 80) return `Cost budget at ${pct.toFixed(0)}%: $${this.costTracker.estimatedCostUsd.toFixed(4)} / $${this.perRunCostCeilingUsd.toFixed(2)}`;
    return null;
  }

  getCostSummary(): CostTracker {
    return { ...this.costTracker };
  }

  getHealthStatus(): Record<string, ProviderHealth> {
    const result: Record<string, ProviderHealth> = {};
    for (const [key, val] of this.providerHealth) {
      result[key] = { ...val };
    }
    return result;
  }

  resetCostTracker(): void {
    this.costTracker = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      estimatedCostUsd: 0,
      modelUsage: {},
    };
  }

  private getOrCreateHealth(modelId: string): ProviderHealth {
    let health = this.providerHealth.get(modelId);
    if (!health) {
      health = { failures: 0, lastFailure: null, circuitOpen: false, circuitOpenedAt: null, successCount: 0 };
      this.providerHealth.set(modelId, health);
    }
    return health;
  }
}

export const modelRouter = new ModelRouter();
