/**
 * OpenClaw Token Tracker
 * Tracks per-user token consumption from OpenClaw interactions
 * and exposes summaries for the admin panel.
 */

// --- Types ---

export interface OpenClawTokenUsage {
  userId: string;
  conversationId: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  timestamp: Date;
  feature: "chat" | "document" | "agent" | "browser" | "code";
}

export interface UserTokenSummary {
  userId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  conversationCount: number;
  lastActivity: Date;
  byModel: Record<string, { input: number; output: number }>;
  byFeature: Record<string, { input: number; output: number }>;
}

// Average pricing across models: input $0.003/1K, output $0.015/1K
const INPUT_COST_PER_TOKEN = 0.003 / 1000;
const OUTPUT_COST_PER_TOKEN = 0.015 / 1000;

function estimateCost(inputTokens: number, outputTokens: number): number {
  return inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN;
}

function createEmptySummary(userId: string): UserTokenSummary {
  return {
    userId,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    conversationCount: 0,
    lastActivity: new Date(),
    byModel: {},
    byFeature: {},
  };
}

// --- Tracker ---

export class OpenClawTokenTracker {
  private usageLog: OpenClawTokenUsage[] = [];
  private userSummaries = new Map<string, UserTokenSummary>();
  private conversationsSeen = new Map<string, Set<string>>(); // userId -> Set<conversationId>

  /** Record token usage from an OpenClaw interaction */
  recordUsage(usage: OpenClawTokenUsage): void {
    if (!usage.userId || usage.inputTokens < 0 || usage.outputTokens < 0) {
      return;
    }

    this.usageLog.push({ ...usage, timestamp: usage.timestamp ?? new Date() });

    let summary = this.userSummaries.get(usage.userId);
    if (!summary) {
      summary = createEmptySummary(usage.userId);
      this.userSummaries.set(usage.userId, summary);
    }

    summary.totalInputTokens += usage.inputTokens;
    summary.totalOutputTokens += usage.outputTokens;
    summary.totalTokens = summary.totalInputTokens + summary.totalOutputTokens;
    summary.estimatedCostUsd = estimateCost(summary.totalInputTokens, summary.totalOutputTokens);
    summary.lastActivity = usage.timestamp ?? new Date();

    // Track unique conversations per user
    let userConvs = this.conversationsSeen.get(usage.userId);
    if (!userConvs) {
      userConvs = new Set();
      this.conversationsSeen.set(usage.userId, userConvs);
    }
    userConvs.add(usage.conversationId);
    summary.conversationCount = userConvs.size;

    // Aggregate by model
    const modelEntry = summary.byModel[usage.model] ?? { input: 0, output: 0 };
    modelEntry.input += usage.inputTokens;
    modelEntry.output += usage.outputTokens;
    summary.byModel[usage.model] = modelEntry;

    // Aggregate by feature
    const featureEntry = summary.byFeature[usage.feature] ?? { input: 0, output: 0 };
    featureEntry.input += usage.inputTokens;
    featureEntry.output += usage.outputTokens;
    summary.byFeature[usage.feature] = featureEntry;
  }

  /** Get summary for a specific user */
  getUserSummary(userId: string): UserTokenSummary | null {
    return this.userSummaries.get(userId) ?? null;
  }

  /** Get summaries for all users (admin panel) */
  getAllSummaries(): UserTokenSummary[] {
    return Array.from(this.userSummaries.values());
  }

  /** Get total platform usage */
  getPlatformStats(): {
    totalTokens: number;
    totalCostUsd: number;
    activeUsers: number;
    totalConversations: number;
  } {
    let totalInput = 0;
    let totalOutput = 0;
    let totalConversations = 0;

    for (const summary of this.userSummaries.values()) {
      totalInput += summary.totalInputTokens;
      totalOutput += summary.totalOutputTokens;
      totalConversations += summary.conversationCount;
    }

    return {
      totalTokens: totalInput + totalOutput,
      totalCostUsd: estimateCost(totalInput, totalOutput),
      activeUsers: this.userSummaries.size,
      totalConversations,
    };
  }

  /** Get recent usage log entries */
  getRecentUsage(limit = 50): OpenClawTokenUsage[] {
    if (limit <= 0) return [];
    return this.usageLog.slice(-limit);
  }

  /** Reset counters for a user */
  resetUser(userId: string): void {
    this.userSummaries.delete(userId);
    this.conversationsSeen.delete(userId);
    this.usageLog = this.usageLog.filter((entry) => entry.userId !== userId);
  }
}

export const openclawTokenTracker = new OpenClawTokenTracker();
