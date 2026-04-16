import { EventEmitter } from "events";

export interface MediaCostEntry {
  id: string;
  type: "image" | "video" | "audio";
  model: string;
  inputTokens: number;
  estimatedCost: number;
  timestamp: Date;
  userId?: string;
  chatId?: string;
}

interface MediaBudgetConfig {
  maxDailyUsd: number;
  maxMonthlyUsd: number;
  maxPerRequestUsd: number;
  warnThresholdPercent: number;
}

const DEFAULT_BUDGET: MediaBudgetConfig = {
  maxDailyUsd: parseFloat(process.env.MEDIA_DAILY_BUDGET_USD || "10.00"),
  maxMonthlyUsd: parseFloat(process.env.MEDIA_MONTHLY_BUDGET_USD || "100.00"),
  maxPerRequestUsd: parseFloat(process.env.MEDIA_PER_REQUEST_LIMIT_USD || "2.00"),
  warnThresholdPercent: 80,
};

const MEDIA_PRICING: Record<string, { perRequest: number; perInputToken: number }> = {
  "google/gemini-2.5-flash-image": { perRequest: 0.003, perInputToken: 0.0000003 },
  "google/gemini-3.1-flash-image-preview": { perRequest: 0.004, perInputToken: 0.00000025 },
  "google/gemini-3-pro-image-preview": { perRequest: 0.02, perInputToken: 0.000002 },
  "openai/gpt-5-image-mini": { perRequest: 0.02, perInputToken: 0.0000025 },
  "openai/gpt-5-image": { perRequest: 0.08, perInputToken: 0.00001 },
  "gemini/imagen-3.0-generate-002": { perRequest: 0.04, perInputToken: 0 },
  "gemini/gemini-2.0-flash-exp-image-generation": { perRequest: 0.003, perInputToken: 0 },
  "xai/grok-2-image-1212": { perRequest: 0.07, perInputToken: 0 },
  "google/veo-3": { perRequest: 0.50, perInputToken: 0 },
  "openai/sora-2": { perRequest: 0.40, perInputToken: 0 },
  "default-image": { perRequest: 0.02, perInputToken: 0 },
  "default-video": { perRequest: 0.50, perInputToken: 0 },
  "default-audio": { perRequest: 0.01, perInputToken: 0 },
};

class MediaCostTracker extends EventEmitter {
  private entries: MediaCostEntry[] = [];
  private budget: MediaBudgetConfig = { ...DEFAULT_BUDGET };
  private dailyCosts = new Map<string, number>();
  private monthlyCosts = new Map<string, number>();

  track(type: "image" | "video" | "audio", model: string, inputTokens: number, userId?: string, chatId?: string): MediaCostEntry {
    const pricing = MEDIA_PRICING[model] || MEDIA_PRICING[`default-${type}`] || { perRequest: 0.02, perInputToken: 0 };
    const estimatedCost = pricing.perRequest + (inputTokens * pricing.perInputToken);

    const entry: MediaCostEntry = {
      id: `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      model,
      inputTokens,
      estimatedCost,
      timestamp: new Date(),
      userId,
      chatId,
    };

    this.entries.push(entry);
    if (this.entries.length > 10000) this.entries = this.entries.slice(-5000);

    const dayKey = entry.timestamp.toISOString().slice(0, 10);
    const monthKey = entry.timestamp.toISOString().slice(0, 7);
    this.dailyCosts.set(dayKey, (this.dailyCosts.get(dayKey) || 0) + estimatedCost);
    this.monthlyCosts.set(monthKey, (this.monthlyCosts.get(monthKey) || 0) + estimatedCost);

    this.emit("media_cost", entry);

    const dailyTotal = this.dailyCosts.get(dayKey) || 0;
    const monthlyTotal = this.monthlyCosts.get(monthKey) || 0;
    if (dailyTotal > this.budget.maxDailyUsd * (this.budget.warnThresholdPercent / 100)) {
      this.emit("budget_warning", { level: "daily", used: dailyTotal, limit: this.budget.maxDailyUsd, percent: (dailyTotal / this.budget.maxDailyUsd) * 100 });
    }
    if (monthlyTotal > this.budget.maxMonthlyUsd * (this.budget.warnThresholdPercent / 100)) {
      this.emit("budget_warning", { level: "monthly", used: monthlyTotal, limit: this.budget.maxMonthlyUsd, percent: (monthlyTotal / this.budget.maxMonthlyUsd) * 100 });
    }

    console.log(`[MediaCost] ${type} via ${model}: $${estimatedCost.toFixed(4)} | Daily: $${dailyTotal.toFixed(4)} | Monthly: $${monthlyTotal.toFixed(4)}`);
    return entry;
  }

  checkBudget(type: "image" | "video" | "audio", model: string): { allowed: boolean; reason?: string; estimatedCost: number } {
    const pricing = MEDIA_PRICING[model] || MEDIA_PRICING[`default-${type}`] || { perRequest: 0.02, perInputToken: 0 };
    const estimatedCost = pricing.perRequest;

    if (estimatedCost > this.budget.maxPerRequestUsd) {
      return { allowed: false, reason: `Estimated cost $${estimatedCost.toFixed(4)} exceeds per-request limit of $${this.budget.maxPerRequestUsd.toFixed(2)}`, estimatedCost };
    }

    const today = new Date().toISOString().slice(0, 10);
    const dailyUsed = this.dailyCosts.get(today) || 0;
    if (dailyUsed + estimatedCost > this.budget.maxDailyUsd) {
      return { allowed: false, reason: `Daily budget exhausted: $${dailyUsed.toFixed(4)} / $${this.budget.maxDailyUsd.toFixed(2)}`, estimatedCost };
    }

    const month = new Date().toISOString().slice(0, 7);
    const monthlyUsed = this.monthlyCosts.get(month) || 0;
    if (monthlyUsed + estimatedCost > this.budget.maxMonthlyUsd) {
      return { allowed: false, reason: `Monthly budget exhausted: $${monthlyUsed.toFixed(4)} / $${this.budget.maxMonthlyUsd.toFixed(2)}`, estimatedCost };
    }

    return { allowed: true, estimatedCost };
  }

  getStats() {
    const today = new Date().toISOString().slice(0, 10);
    const month = new Date().toISOString().slice(0, 7);

    const byType = { image: 0, video: 0, audio: 0 };
    const byModel: Record<string, { count: number; cost: number }> = {};
    let totalCost = 0;

    for (const e of this.entries) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      totalCost += e.estimatedCost;
      if (!byModel[e.model]) byModel[e.model] = { count: 0, cost: 0 };
      byModel[e.model].count++;
      byModel[e.model].cost += e.estimatedCost;
    }

    return {
      totalGenerations: this.entries.length,
      totalCost: parseFloat(totalCost.toFixed(6)),
      dailyCost: parseFloat((this.dailyCosts.get(today) || 0).toFixed(6)),
      monthlyCost: parseFloat((this.monthlyCosts.get(month) || 0).toFixed(6)),
      budget: this.budget,
      dailyRemaining: parseFloat((this.budget.maxDailyUsd - (this.dailyCosts.get(today) || 0)).toFixed(6)),
      monthlyRemaining: parseFloat((this.budget.maxMonthlyUsd - (this.monthlyCosts.get(month) || 0)).toFixed(6)),
      byType,
      byModel,
      recentEntries: this.entries.slice(-50).reverse(),
    };
  }

  updateBudget(updates: Partial<MediaBudgetConfig>) {
    if (updates.maxDailyUsd !== undefined) this.budget.maxDailyUsd = updates.maxDailyUsd;
    if (updates.maxMonthlyUsd !== undefined) this.budget.maxMonthlyUsd = updates.maxMonthlyUsd;
    if (updates.maxPerRequestUsd !== undefined) this.budget.maxPerRequestUsd = updates.maxPerRequestUsd;
    if (updates.warnThresholdPercent !== undefined) this.budget.warnThresholdPercent = updates.warnThresholdPercent;
    console.log(`[MediaCost] Budget updated:`, this.budget);
    return this.budget;
  }
}

export const mediaCostTracker = new MediaCostTracker();

export function trackMediaCost(type: "image" | "video" | "audio", model: string, inputTokens: number, userId?: string, chatId?: string) {
  return mediaCostTracker.track(type, model, inputTokens, userId, chatId);
}

export function checkMediaBudget(type: "image" | "video" | "audio", model: string) {
  return mediaCostTracker.checkBudget(type, model);
}
