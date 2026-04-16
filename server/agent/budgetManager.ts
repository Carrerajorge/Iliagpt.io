import type { Response } from "express";

export interface ModelPricing {
  promptPer1k: number;
  completionPer1k: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "minimax/minimax-m2.5": { promptPer1k: 0.0005, completionPer1k: 0.0015 },
  "openai/gpt-4o": { promptPer1k: 0.005, completionPer1k: 0.015 },
  "openai/gpt-4o-mini": { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  "openai/gpt-4-turbo": { promptPer1k: 0.01, completionPer1k: 0.03 },
  "anthropic/claude-3.5-sonnet": { promptPer1k: 0.003, completionPer1k: 0.015 },
  "anthropic/claude-3-haiku": { promptPer1k: 0.00025, completionPer1k: 0.00125 },
  "google/gemini-pro-1.5": { promptPer1k: 0.00125, completionPer1k: 0.005 },
  "google/gemini-flash-1.5": { promptPer1k: 0.000075, completionPer1k: 0.0003 },
  "meta-llama/llama-3.1-70b-instruct": { promptPer1k: 0.00059, completionPer1k: 0.00079 },
  "deepseek/deepseek-chat": { promptPer1k: 0.00014, completionPer1k: 0.00028 },
};

const DEFAULT_PRICING: ModelPricing = { promptPer1k: 0.001, completionPer1k: 0.003 };

export interface BudgetConfig {
  maxTokens: number;
  maxCostUsd: number;
  maxIterations: number;
  warnThreshold: number;
}

export interface BudgetSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  budgetRemainingPct: number;
  iterationsUsed: number;
  iterationsRemaining: number;
  warningIssued: boolean;
  exceeded: boolean;
}

export class BudgetManager {
  private promptTokens = 0;
  private completionTokens = 0;
  private iterationsUsed = 0;
  private warningIssued = false;
  private model: string;
  private pricing: ModelPricing;
  private config: BudgetConfig;
  private runId: string;

  constructor(runId: string, model: string, config?: Partial<BudgetConfig>) {
    this.runId = runId;
    this.model = model;
    this.pricing = MODEL_PRICING[model] || DEFAULT_PRICING;

    const envMaxTokens = process.env.AGENT_BUDGET_MAX_TOKENS
      ? parseInt(process.env.AGENT_BUDGET_MAX_TOKENS, 10)
      : undefined;
    const envMaxCost = process.env.AGENT_BUDGET_MAX_COST
      ? parseFloat(process.env.AGENT_BUDGET_MAX_COST)
      : undefined;

    this.config = {
      maxTokens: config?.maxTokens ?? envMaxTokens ?? 100_000,
      maxCostUsd: config?.maxCostUsd ?? envMaxCost ?? 1.0,
      maxIterations: config?.maxIterations ?? 15,
      warnThreshold: config?.warnThreshold ?? 0.8,
    };
  }

  get totalTokens(): number {
    return this.promptTokens + this.completionTokens;
  }

  get estimatedCostUsd(): number {
    return (
      (this.promptTokens / 1000) * this.pricing.promptPer1k +
      (this.completionTokens / 1000) * this.pricing.completionPer1k
    );
  }

  get budgetRemainingPct(): number {
    const tokenPct = 1 - this.totalTokens / this.config.maxTokens;
    const costPct = 1 - this.estimatedCostUsd / this.config.maxCostUsd;
    return Math.max(0, Math.min(tokenPct, costPct));
  }

  get isExceeded(): boolean {
    return (
      this.totalTokens >= this.config.maxTokens ||
      this.estimatedCostUsd >= this.config.maxCostUsd ||
      this.iterationsUsed >= this.config.maxIterations
    );
  }

  get shouldWarn(): boolean {
    return !this.warningIssued && this.budgetRemainingPct <= (1 - this.config.warnThreshold);
  }

  recordUsage(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): void {
    if (usage.prompt_tokens) this.promptTokens += usage.prompt_tokens;
    if (usage.completion_tokens) this.completionTokens += usage.completion_tokens;
    if (!usage.prompt_tokens && !usage.completion_tokens && usage.total_tokens) {
      this.promptTokens += Math.round(usage.total_tokens * 0.7);
      this.completionTokens += Math.round(usage.total_tokens * 0.3);
    }
  }

  recordIteration(): void {
    this.iterationsUsed++;
  }

  markWarningIssued(): void {
    this.warningIssued = true;
  }

  snapshot(): BudgetSnapshot {
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.totalTokens,
      estimatedCostUsd: Math.round(this.estimatedCostUsd * 1_000_000) / 1_000_000,
      budgetRemainingPct: Math.round(this.budgetRemainingPct * 100),
      iterationsUsed: this.iterationsUsed,
      iterationsRemaining: Math.max(0, this.config.maxIterations - this.iterationsUsed),
      warningIssued: this.warningIssued,
      exceeded: this.isExceeded,
    };
  }

  buildExceededMessage(): string {
    const snap = this.snapshot();
    const reasons: string[] = [];
    if (this.totalTokens >= this.config.maxTokens) {
      reasons.push(`token limit reached (${snap.totalTokens.toLocaleString()}/${this.config.maxTokens.toLocaleString()})`);
    }
    if (this.estimatedCostUsd >= this.config.maxCostUsd) {
      reasons.push(`cost ceiling reached ($${snap.estimatedCostUsd.toFixed(4)}/$${this.config.maxCostUsd.toFixed(2)})`);
    }
    if (this.iterationsUsed >= this.config.maxIterations) {
      reasons.push(`iteration limit reached (${this.iterationsUsed}/${this.config.maxIterations})`);
    }
    return `⚠️ Agent budget exceeded: ${reasons.join(", ")}. Stopping execution to prevent runaway costs. Here's what was accomplished so far.`;
  }

  buildWarningMessage(): string {
    const snap = this.snapshot();
    return `[Budget warning] ${snap.budgetRemainingPct}% remaining — tokens: ${snap.totalTokens.toLocaleString()}, cost: $${snap.estimatedCostUsd.toFixed(4)}`;
  }

  emitBudgetUpdate(
    writeSse: (event: string, payload: Record<string, unknown>) => boolean,
  ): void {
    const snap = this.snapshot();
    writeSse("budget_update", {
      runId: this.runId,
      model: this.model,
      ...snap,
    });
  }
}
