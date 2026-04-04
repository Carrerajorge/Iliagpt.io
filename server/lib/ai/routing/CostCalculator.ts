/**
 * Cost Calculator
 * Real-time cost estimation and budget tracking for LLM requests.
 *
 * Features:
 *   - Pre-request cost estimation (from token count + model pricing)
 *   - Post-request actual cost recording
 *   - Rolling budget windows (per-minute, per-hour, per-day)
 *   - Per-provider and aggregate spend tracking
 *   - Budget alert thresholds
 */

import { EventEmitter } from 'events';
import { IModelInfo, ITokenUsage, IChatRequest } from '../providers/core/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CostEstimate {
  provider: string;
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  breakdown: {
    inputCost: number;
    outputCost: number;
  };
}

export interface CostRecord {
  id: string;
  provider: string;
  model: string;
  usage: ITokenUsage;
  costUsd: number;
  timestamp: Date;
  requestId?: string;
}

export interface BudgetConfig {
  dailyLimitUsd?: number;
  hourlyLimitUsd?: number;
  minuteLimitUsd?: number;
  perProviderDailyLimitUsd?: Record<string, number>;
  alertThreshold?: number; // 0-1, default 0.8 (alert at 80% of limit)
}

export interface BudgetStatus {
  daily: { spent: number; limit?: number; pct?: number; exceeded: boolean };
  hourly: { spent: number; limit?: number; pct?: number; exceeded: boolean };
  minute: { spent: number; limit?: number; pct?: number; exceeded: boolean };
  perProvider: Record<string, { daily: number; limit?: number }>;
  totalAllTime: number;
}

// ─── Rolling window ───────────────────────────────────────────────────────────

class RollingWindow {
  private _records: Array<{ ts: number; cost: number }> = [];

  add(cost: number): void {
    this._records.push({ ts: Date.now(), cost });
  }

  sum(windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    this._records = this._records.filter((r) => r.ts > cutoff);
    return this._records.reduce((s, r) => s + r.cost, 0);
  }
}

// ─── Calculator ───────────────────────────────────────────────────────────────

export class CostCalculator extends EventEmitter {
  private _records: CostRecord[] = [];
  private _window = new RollingWindow();
  private _budgetConfig: BudgetConfig = {};
  private _totalSpend = 0;
  private _providerSpend: Record<string, number> = {};
  private static _MAX_RECORDS = 10_000; // cap in-memory history

  configureBudget(config: BudgetConfig): void {
    this._budgetConfig = config;
  }

  // ── Estimation ───────────────────────────────────────────────────────────────

  estimate(request: IChatRequest, modelInfo: IModelInfo, avgOutputTokens = 512): CostEstimate {
    // Rough input token count from message lengths
    const inputTokens = request.messages.reduce((sum, msg) => {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.map((c) => c.text ?? '').join(' ');
      return sum + Math.ceil(text.length / 4) + 4;
    }, 0);

    const outputTokens = request.maxTokens
      ? Math.min(request.maxTokens, avgOutputTokens)
      : avgOutputTokens;

    const inputCost = (inputTokens / 1_000_000) * modelInfo.pricing.inputPerMillion;
    const outputCost = (outputTokens / 1_000_000) * modelInfo.pricing.outputPerMillion;

    return {
      provider: modelInfo.provider,
      model: modelInfo.id,
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedCostUsd: inputCost + outputCost,
      breakdown: { inputCost, outputCost },
    };
  }

  estimateFromTokens(
    inputTokens: number,
    outputTokens: number,
    modelInfo: IModelInfo,
  ): number {
    return (inputTokens / 1_000_000) * modelInfo.pricing.inputPerMillion
      + (outputTokens / 1_000_000) * modelInfo.pricing.outputPerMillion;
  }

  // ── Recording ────────────────────────────────────────────────────────────────

  record(provider: string, model: string, usage: ITokenUsage, modelInfo: IModelInfo, requestId?: string): CostRecord {
    const costUsd = this.estimateFromTokens(usage.promptTokens, usage.completionTokens, modelInfo);

    const record: CostRecord = {
      id: `cost_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      provider, model, usage, costUsd,
      timestamp: new Date(),
      requestId,
    };

    this._records.push(record);
    if (this._records.length > CostCalculator._MAX_RECORDS) {
      this._records.shift(); // drop oldest
    }

    this._window.add(costUsd);
    this._totalSpend += costUsd;
    this._providerSpend[provider] = (this._providerSpend[provider] ?? 0) + costUsd;

    this._checkBudgets(provider, costUsd);
    return record;
  }

  // ── Budget status ────────────────────────────────────────────────────────────

  getBudgetStatus(): BudgetStatus {
    const now = Date.now();
    const dayMs = 86_400_000;
    const hourMs = 3_600_000;
    const minMs = 60_000;

    const dailySpent = this._records
      .filter((r) => now - r.timestamp.getTime() < dayMs)
      .reduce((s, r) => s + r.costUsd, 0);

    const hourlySpent = this._records
      .filter((r) => now - r.timestamp.getTime() < hourMs)
      .reduce((s, r) => s + r.costUsd, 0);

    const minuteSpent = this._window.sum(minMs);

    const dailyLimit = this._budgetConfig.dailyLimitUsd;
    const hourlyLimit = this._budgetConfig.hourlyLimitUsd;
    const minuteLimit = this._budgetConfig.minuteLimitUsd;

    const perProvider: BudgetStatus['perProvider'] = {};
    for (const [p, spent] of Object.entries(this._providerSpend)) {
      perProvider[p] = {
        daily: spent,
        limit: this._budgetConfig.perProviderDailyLimitUsd?.[p],
      };
    }

    return {
      daily: {
        spent: dailySpent,
        limit: dailyLimit,
        pct: dailyLimit ? dailySpent / dailyLimit : undefined,
        exceeded: dailyLimit ? dailySpent >= dailyLimit : false,
      },
      hourly: {
        spent: hourlySpent,
        limit: hourlyLimit,
        pct: hourlyLimit ? hourlySpent / hourlyLimit : undefined,
        exceeded: hourlyLimit ? hourlySpent >= hourlyLimit : false,
      },
      minute: {
        spent: minuteSpent,
        limit: minuteLimit,
        pct: minuteLimit ? minuteSpent / minuteLimit : undefined,
        exceeded: minuteLimit ? minuteSpent >= minuteLimit : false,
      },
      perProvider,
      totalAllTime: this._totalSpend,
    };
  }

  isBudgetExceeded(provider?: string): boolean {
    const status = this.getBudgetStatus();
    if (status.daily.exceeded || status.hourly.exceeded || status.minute.exceeded) return true;
    if (provider && status.perProvider[provider]?.limit) {
      return status.perProvider[provider].daily >= status.perProvider[provider].limit!;
    }
    return false;
  }

  /** Check if a new estimated cost would exceed remaining budget. */
  wouldExceedBudget(estimatedCostUsd: number): boolean {
    const status = this.getBudgetStatus();
    if (status.daily.limit && status.daily.spent + estimatedCostUsd > status.daily.limit) return true;
    if (status.hourly.limit && status.hourly.spent + estimatedCostUsd > status.hourly.limit) return true;
    return false;
  }

  // ── Analytics ────────────────────────────────────────────────────────────────

  getSpendByProvider(windowMs?: number): Record<string, number> {
    const records = windowMs
      ? this._records.filter((r) => Date.now() - r.timestamp.getTime() < windowMs)
      : this._records;

    return records.reduce((acc, r) => {
      acc[r.provider] = (acc[r.provider] ?? 0) + r.costUsd;
      return acc;
    }, {} as Record<string, number>);
  }

  getSpendByModel(windowMs?: number): Record<string, number> {
    const records = windowMs
      ? this._records.filter((r) => Date.now() - r.timestamp.getTime() < windowMs)
      : this._records;

    return records.reduce((acc, r) => {
      const key = `${r.provider}/${r.model}`;
      acc[key] = (acc[key] ?? 0) + r.costUsd;
      return acc;
    }, {} as Record<string, number>);
  }

  getRecentRecords(limit = 100): CostRecord[] {
    return this._records.slice(-limit);
  }

  reset(): void {
    this._records = [];
    this._totalSpend = 0;
    this._providerSpend = {};
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _checkBudgets(provider: string, newCostUsd: number): void {
    const status = this.getBudgetStatus();
    const threshold = this._budgetConfig.alertThreshold ?? 0.8;

    if (status.daily.limit && status.daily.pct !== undefined) {
      if (status.daily.pct >= threshold) {
        this.emit('budget:alert', { window: 'daily', pct: status.daily.pct, spent: status.daily.spent, limit: status.daily.limit });
      }
      if (status.daily.exceeded) {
        this.emit('budget:exceeded', { window: 'daily', spent: status.daily.spent, limit: status.daily.limit });
      }
    }

    if (status.hourly.limit && status.hourly.pct !== undefined && status.hourly.pct >= threshold) {
      this.emit('budget:alert', { window: 'hourly', pct: status.hourly.pct, spent: status.hourly.spent, limit: status.hourly.limit });
    }

    const providerDailyLimit = this._budgetConfig.perProviderDailyLimitUsd?.[provider];
    if (providerDailyLimit) {
      const providerSpent = (this._providerSpend[provider] ?? 0);
      const pct = providerSpent / providerDailyLimit;
      if (pct >= threshold) {
        this.emit('budget:provider:alert', { provider, pct, spent: providerSpent, limit: providerDailyLimit });
      }
    }
  }
}

export const costCalculator = new CostCalculator();
