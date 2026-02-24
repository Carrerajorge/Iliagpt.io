/**
 * Agent KPI Service
 * Tracks agent performance metrics: success rate, duration, tool usage, cost.
 */

export interface AgentKPIEntry {
  runId: string;
  agentName: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  status: "running" | "success" | "failed" | "cancelled";
  toolsUsed: string[];
  toolCallCount: number;
  tokenUsage: { input: number; output: number; total: number };
  estimatedCost: number;
  error?: string;
}

export interface KPISummary {
  totalRuns: number;
  successRate: number;
  avgDurationMs: number;
  medianDurationMs: number;
  p95DurationMs: number;
  totalTokens: number;
  totalCost: number;
  toolUsageDistribution: Record<string, number>;
  agentUsageDistribution: Record<string, number>;
  failureReasons: Array<{ reason: string; count: number }>;
  timeSeriesLast24h: Array<{ hour: string; runs: number; successes: number }>;
}

const kpiStore: AgentKPIEntry[] = [];
const MAX_ENTRIES = 10000;

/**
 * Record a new agent run.
 */
export function recordRunStart(
  runId: string,
  agentName: string
): AgentKPIEntry {
  const entry: AgentKPIEntry = {
    runId,
    agentName,
    startedAt: Date.now(),
    status: "running",
    toolsUsed: [],
    toolCallCount: 0,
    tokenUsage: { input: 0, output: 0, total: 0 },
    estimatedCost: 0,
  };

  kpiStore.push(entry);

  // Trim old entries
  if (kpiStore.length > MAX_ENTRIES) {
    kpiStore.splice(0, kpiStore.length - MAX_ENTRIES);
  }

  return entry;
}

/**
 * Record tool usage for a run.
 */
export function recordToolUsage(runId: string, toolName: string): void {
  const entry = kpiStore.find((e) => e.runId === runId);
  if (entry) {
    if (!entry.toolsUsed.includes(toolName)) {
      entry.toolsUsed.push(toolName);
    }
    entry.toolCallCount++;
  }
}

/**
 * Record token usage for a run.
 */
export function recordTokenUsage(
  runId: string,
  input: number,
  output: number
): void {
  const entry = kpiStore.find((e) => e.runId === runId);
  if (entry) {
    entry.tokenUsage.input += input;
    entry.tokenUsage.output += output;
    entry.tokenUsage.total += input + output;
    // Rough cost estimate (per 1M tokens)
    entry.estimatedCost += (input * 3 + output * 15) / 1_000_000;
  }
}

/**
 * Complete a run.
 */
export function recordRunComplete(
  runId: string,
  status: "success" | "failed" | "cancelled",
  error?: string
): void {
  const entry = kpiStore.find((e) => e.runId === runId);
  if (entry) {
    entry.completedAt = Date.now();
    entry.durationMs = entry.completedAt - entry.startedAt;
    entry.status = status;
    if (error) entry.error = error;
  }
}

/**
 * Get KPI summary.
 */
export function getKPISummary(sinceMs?: number): KPISummary {
  const cutoff = sinceMs ? Date.now() - sinceMs : 0;
  const entries = kpiStore.filter((e) => e.startedAt >= cutoff);
  const completed = entries.filter((e) => e.status !== "running");

  const successful = completed.filter((e) => e.status === "success");
  const durations = completed
    .map((e) => e.durationMs || 0)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);

  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;
  const medianDuration = durations.length > 0
    ? durations[Math.floor(durations.length / 2)]
    : 0;
  const p95Duration = durations.length > 0
    ? durations[Math.floor(durations.length * 0.95)]
    : 0;

  // Tool usage distribution
  const toolUsage: Record<string, number> = {};
  for (const entry of entries) {
    for (const tool of entry.toolsUsed) {
      toolUsage[tool] = (toolUsage[tool] || 0) + 1;
    }
  }

  // Agent usage distribution
  const agentUsage: Record<string, number> = {};
  for (const entry of entries) {
    agentUsage[entry.agentName] = (agentUsage[entry.agentName] || 0) + 1;
  }

  // Failure reasons
  const failureMap: Record<string, number> = {};
  for (const entry of completed.filter((e) => e.status === "failed")) {
    const reason = entry.error || "Unknown";
    failureMap[reason] = (failureMap[reason] || 0) + 1;
  }
  const failureReasons = Object.entries(failureMap)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Time series (last 24h, hourly)
  const now = Date.now();
  const timeSeriesLast24h: Array<{ hour: string; runs: number; successes: number }> = [];
  for (let i = 23; i >= 0; i--) {
    const hourStart = now - (i + 1) * 3600000;
    const hourEnd = now - i * 3600000;
    const hourEntries = entries.filter((e) => e.startedAt >= hourStart && e.startedAt < hourEnd);
    const hourSuccesses = hourEntries.filter((e) => e.status === "success");
    const hourLabel = new Date(hourEnd).toISOString().substring(11, 16);
    timeSeriesLast24h.push({
      hour: hourLabel,
      runs: hourEntries.length,
      successes: hourSuccesses.length,
    });
  }

  return {
    totalRuns: entries.length,
    successRate: completed.length > 0
      ? Math.round((successful.length / completed.length) * 1000) / 10
      : 0,
    avgDurationMs: Math.round(avgDuration),
    medianDurationMs: Math.round(medianDuration),
    p95DurationMs: Math.round(p95Duration),
    totalTokens: entries.reduce((sum, e) => sum + e.tokenUsage.total, 0),
    totalCost: Math.round(entries.reduce((sum, e) => sum + e.estimatedCost, 0) * 10000) / 10000,
    toolUsageDistribution: toolUsage,
    agentUsageDistribution: agentUsage,
    failureReasons,
    timeSeriesLast24h,
  };
}

/**
 * Get recent runs.
 */
export function getRecentRuns(limit: number = 20): AgentKPIEntry[] {
  return kpiStore
    .slice(-limit)
    .reverse();
}

/**
 * Get run by ID.
 */
export function getRunKPI(runId: string): AgentKPIEntry | undefined {
  return kpiStore.find((e) => e.runId === runId);
}
