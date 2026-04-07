export interface UserUsage {
  tokens: { input: number; output: number; total: number };
  messages: number;
  documents: number;
  costs: number;
}

export interface ModelStats {
  model: string;
  requests: number;
  avgDuration: number;
  totalTokens: number;
}

export interface CostEstimate {
  totalUsd: number;
  breakdown: { model: string; tokens: number; costUsd: number }[];
}

export interface QuotaAlert {
  userId: string;
  level: 'warning' | 'exceeded';
  usedTokens: number;
  maxTokens: number;
  percentage: number;
}

interface TokenRecord {
  userId: string;
  orgId: string;
  model: string;
  input: number;
  output: number;
  ts: number;
}

interface MessageRecord { userId: string; orgId: string; role: string; ts: number }
interface DocRecord { userId: string; orgId: string; type: string; ts: number }
interface ToolRecord { userId: string; toolName: string; ts: number }
interface ErrorRecord { errorType: string; provider?: string; ts: number }
interface LatencyRecord { model: string; durationMs: number; ts: number }

const MODEL_COST_PER_1K: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'gemini-pro': { input: 0.00025, output: 0.0005 },
};

function periodStart(period: 'day' | 'week' | 'month'): number {
  const d = new Date();
  if (period === 'day') d.setHours(0, 0, 0, 0);
  else if (period === 'week') { d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); }
  else { d.setDate(1); d.setHours(0, 0, 0, 0); }
  return d.getTime();
}

function costFor(model: string, input: number, output: number): number {
  const rate = MODEL_COST_PER_1K[model] || { input: 0.001, output: 0.002 };
  return (input / 1000) * rate.input + (output / 1000) * rate.output;
}

export class UsageTracker {
  private tokens: TokenRecord[] = [];
  private messages: MessageRecord[] = [];
  private docs: DocRecord[] = [];
  private tools: ToolRecord[] = [];
  private errors: ErrorRecord[] = [];
  private latencies: LatencyRecord[] = [];

  trackTokens(userId: string, orgId: string, model: string, inputTokens: number, outputTokens: number): void {
    this.tokens.push({ userId, orgId, model, input: inputTokens, output: outputTokens, ts: Date.now() });
  }

  trackMessage(userId: string, orgId: string, role: 'user' | 'assistant'): void {
    this.messages.push({ userId, orgId, role, ts: Date.now() });
  }

  trackDocGeneration(userId: string, orgId: string, type: 'word' | 'excel' | 'ppt' | 'pdf'): void {
    this.docs.push({ userId, orgId, type, ts: Date.now() });
  }

  trackToolUsage(userId: string, toolName: string): void {
    this.tools.push({ userId, toolName, ts: Date.now() });
  }

  trackError(errorType: string, provider?: string): void {
    this.errors.push({ errorType, provider, ts: Date.now() });
  }

  trackResponseTime(model: string, durationMs: number): void {
    this.latencies.push({ model, durationMs, ts: Date.now() });
  }

  getUsageByUser(userId: string, period: 'day' | 'week' | 'month'): UserUsage {
    const start = periodStart(period);
    const toks = this.tokens.filter((r) => r.userId === userId && r.ts >= start);
    const input = toks.reduce((s, r) => s + r.input, 0);
    const output = toks.reduce((s, r) => s + r.output, 0);
    const msgs = this.messages.filter((r) => r.userId === userId && r.ts >= start).length;
    const docCount = this.docs.filter((r) => r.userId === userId && r.ts >= start).length;
    const costs = toks.reduce((s, r) => s + costFor(r.model, r.input, r.output), 0);
    return { tokens: { input, output, total: input + output }, messages: msgs, documents: docCount, costs };
  }

  getUsageByOrg(orgId: string, period: 'day' | 'week' | 'month'): UserUsage {
    const start = periodStart(period);
    const toks = this.tokens.filter((r) => r.orgId === orgId && r.ts >= start);
    const input = toks.reduce((s, r) => s + r.input, 0);
    const output = toks.reduce((s, r) => s + r.output, 0);
    const msgs = this.messages.filter((r) => r.orgId === orgId && r.ts >= start).length;
    const docCount = this.docs.filter((r) => r.orgId === orgId && r.ts >= start).length;
    const costs = toks.reduce((s, r) => s + costFor(r.model, r.input, r.output), 0);
    return { tokens: { input, output, total: input + output }, messages: msgs, documents: docCount, costs };
  }

  getModelStats(): ModelStats[] {
    const map = new Map<string, { requests: number; totalDuration: number; totalTokens: number }>();
    for (const r of this.tokens) {
      const e = map.get(r.model) || { requests: 0, totalDuration: 0, totalTokens: 0 };
      e.requests++;
      e.totalTokens += r.input + r.output;
      map.set(r.model, e);
    }
    for (const r of this.latencies) {
      const e = map.get(r.model) || { requests: 0, totalDuration: 0, totalTokens: 0 };
      e.totalDuration += r.durationMs;
      map.set(r.model, e);
    }
    return [...map.entries()].map(([model, e]) => ({
      model,
      requests: e.requests,
      avgDuration: e.requests ? Math.round(e.totalDuration / e.requests) : 0,
      totalTokens: e.totalTokens,
    }));
  }

  getCostEstimate(userId: string, period: 'day' | 'week' | 'month'): CostEstimate {
    const start = periodStart(period);
    const toks = this.tokens.filter((r) => r.userId === userId && r.ts >= start);
    const byModel = new Map<string, { tokens: number; cost: number }>();
    for (const r of toks) {
      const e = byModel.get(r.model) || { tokens: 0, cost: 0 };
      e.tokens += r.input + r.output;
      e.cost += costFor(r.model, r.input, r.output);
      byModel.set(r.model, e);
    }
    const breakdown = [...byModel.entries()].map(([model, e]) => ({ model, tokens: e.tokens, costUsd: Math.round(e.cost * 10000) / 10000 }));
    return { totalUsd: Math.round(breakdown.reduce((s, b) => s + b.costUsd, 0) * 10000) / 10000, breakdown };
  }

  checkQuotaAlert(userId: string, limits: { maxTokens: number }): QuotaAlert | null {
    const usage = this.getUsageByUser(userId, 'month');
    const pct = (usage.tokens.total / limits.maxTokens) * 100;
    if (pct >= 100) return { userId, level: 'exceeded', usedTokens: usage.tokens.total, maxTokens: limits.maxTokens, percentage: Math.round(pct) };
    if (pct >= 80) return { userId, level: 'warning', usedTokens: usage.tokens.total, maxTokens: limits.maxTokens, percentage: Math.round(pct) };
    return null;
  }
}

export const usageTracker = new UsageTracker();
