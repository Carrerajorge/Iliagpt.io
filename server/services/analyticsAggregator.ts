import { db } from "../db";
import { apiLogs } from "@shared/schema";
import { sql, gte, and, count, isNotNull } from "drizzle-orm";
import { storage } from "../storage";

const AGGREGATION_INTERVAL_MS = 60 * 1000;
const COST_PER_1K_TOKENS: Record<string, number> = {
  xai: 0.002,
  gemini: 0.001,
  openai: 0.003,
  anthropic: 0.0025,
  default: 0.002,
};

const DEFAULT_BUDGET_EUR = "100.00";
const TABLE_EXISTS_CACHE_TTL_MS = 5 * 60 * 1000;

let aggregatorInterval: NodeJS.Timeout | null = null;
let isRunning = false;
const tableExistsCache = new Map<string, { exists: boolean; checkedAt: number }>();

interface ProviderStats {
  provider: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  totalLatency: number;
  latencies: number[];
  tokensIn: number;
  tokensOut: number;
}

function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

function estimateCost(provider: string, tokensIn: number, tokensOut: number): number {
  const rate = COST_PER_1K_TOKENS[provider.toLowerCase()] || COST_PER_1K_TOKENS.default;
  return ((tokensIn + tokensOut) / 1000) * rate;
}

async function tableExists(tableName: string): Promise<boolean> {
  const cached = tableExistsCache.get(tableName);
  if (cached && Date.now() - cached.checkedAt < TABLE_EXISTS_CACHE_TTL_MS) {
    return cached.exists;
  }
  const result = await db.execute(sql`select to_regclass(${tableName}) as table_name`);
  const row = result.rows?.[0] as { table_name?: string | null } | undefined;
  const exists = Boolean(row?.table_name);
  tableExistsCache.set(tableName, { exists, checkedAt: Date.now() });
  return exists;
}

async function getMissingTables(tableNames: string[]): Promise<string[]> {
  const checks = await Promise.all(
    tableNames.map(async (tableName) => ({
      tableName,
      exists: await tableExists(tableName),
    }))
  );
  return checks.filter((check) => !check.exists).map((check) => check.tableName);
}

async function ensureCostBudgetExists(provider: string): Promise<void> {
  const existing = await storage.getCostBudget(provider);
  if (!existing) {
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await storage.upsertCostBudget({
      provider,
      budgetLimit: DEFAULT_BUDGET_EUR,
      alertThreshold: 80,
      currentSpend: "0.00",
      projectedMonthly: "0.00",
      periodStart: now,
      periodEnd,
    });
    console.log(`[Analytics] Created default budget for provider: ${provider}`);
  }
}

export async function runAggregation(): Promise<void> {
  if (isRunning) {
    console.log("[Analytics] Aggregation already in progress, skipping...");
    return;
  }

  isRunning = true;
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - AGGREGATION_INTERVAL_MS);

  try {
    console.log(`[Analytics] Running aggregation for window: ${windowStart.toISOString()} - ${windowEnd.toISOString()}`);

    const missingTables = await getMissingTables([
      "public.api_logs",
      "public.provider_metrics",
      "public.cost_budgets",
      "public.kpi_snapshots",
    ]);

    if (missingTables.length > 0) {
      console.warn(`[Analytics] Skipping aggregation; missing tables: ${missingTables.join(", ")}`);
      return;
    }

    const logs = await db
      .select({
        provider: apiLogs.provider,
        statusCode: apiLogs.statusCode,
        latencyMs: apiLogs.latencyMs,
        tokensIn: apiLogs.tokensIn,
        tokensOut: apiLogs.tokensOut,
      })
      .from(apiLogs)
      .where(
        and(
          gte(apiLogs.createdAt, windowStart),
          isNotNull(apiLogs.provider)
        )
      );

    const providerMap = new Map<string, ProviderStats>();

    for (const log of logs) {
      const provider = log.provider || "unknown";
      let stats = providerMap.get(provider);

      if (!stats) {
        stats = {
          provider,
          totalRequests: 0,
          successCount: 0,
          errorCount: 0,
          totalLatency: 0,
          latencies: [],
          tokensIn: 0,
          tokensOut: 0,
        };
        providerMap.set(provider, stats);
      }

      stats.totalRequests++;

      if (log.statusCode && log.statusCode >= 200 && log.statusCode < 400) {
        stats.successCount++;
      } else if (log.statusCode && log.statusCode >= 400) {
        stats.errorCount++;
      }

      if (log.latencyMs) {
        stats.latencies.push(log.latencyMs);
        stats.totalLatency += log.latencyMs;
      }

      stats.tokensIn += log.tokensIn || 0;
      stats.tokensOut += log.tokensOut || 0;
    }

    for (const [provider, stats] of providerMap) {
      await ensureCostBudgetExists(provider);

      stats.latencies.sort((a, b) => a - b);

      const avgLatency = stats.latencies.length > 0
        ? Math.round(stats.totalLatency / stats.latencies.length)
        : 0;
      const p50Latency = calculatePercentile(stats.latencies, 50);
      const p95Latency = calculatePercentile(stats.latencies, 95);
      const p99Latency = calculatePercentile(stats.latencies, 99);

      const successRate = stats.totalRequests > 0
        ? ((stats.successCount / stats.totalRequests) * 100).toFixed(2)
        : "100.00";

      const totalCost = estimateCost(provider, stats.tokensIn, stats.tokensOut);

      await storage.createProviderMetrics({
        provider,
        windowStart,
        windowEnd,
        avgLatency,
        p50Latency,
        p95Latency,
        p99Latency,
        successRate,
        totalRequests: stats.totalRequests,
        errorCount: stats.errorCount,
        tokensIn: stats.tokensIn,
        tokensOut: stats.tokensOut,
        totalCost: totalCost.toFixed(4),
      });

      const budget = await storage.getCostBudget(provider);
      if (budget) {
        const newSpend = parseFloat(budget.currentSpend || "0") + totalCost;
        const daysInMonth = new Date(windowEnd.getFullYear(), windowEnd.getMonth() + 1, 0).getDate();
        const dayOfMonth = windowEnd.getDate();
        const projectedMonthly = dayOfMonth > 0 
          ? ((newSpend / dayOfMonth) * daysInMonth).toFixed(2)
          : "0.00";

        await storage.upsertCostBudget({
          provider,
          budgetLimit: budget.budgetLimit,
          alertThreshold: budget.alertThreshold,
          currentSpend: newSpend.toFixed(4),
          projectedMonthly,
          periodStart: budget.periodStart,
          periodEnd: budget.periodEnd,
        });
      }
    }

    await calculateKpis();

    console.log(`[Analytics] Aggregation completed. Processed ${logs.length} logs from ${providerMap.size} providers.`);
  } catch (error) {
    console.error("[Analytics] Error during aggregation:", error);
  } finally {
    isRunning = false;
  }
}

export async function calculateKpis(): Promise<void> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

  try {
    const requiredTables = await getMissingTables([
      "public.api_logs",
      "public.cost_budgets",
      "public.kpi_snapshots",
    ]);

    if (requiredTables.length > 0) {
      console.warn(`[Analytics] Skipping KPI calculation; missing tables: ${requiredTables.join(", ")}`);
      return;
    }

    // "Active users now" should reflect distinct accounts, not message volume.
    // We use api_logs (LLM calls) as the most reliable cross-feature activity signal.
    const [activeUsersResult] = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${apiLogs.userId})` })
      .from(apiLogs)
      .where(and(
        gte(apiLogs.createdAt, tenMinutesAgo),
        isNotNull(apiLogs.userId)
      ));
    const activeUsersNow = Number(activeUsersResult?.count || 0);

    const [queriesResult] = await db
      .select({ count: count() })
      .from(apiLogs)
      .where(gte(apiLogs.createdAt, oneMinuteAgo));
    const queriesPerMinute = queriesResult?.count || 0;

    const [tokensResult] = await db
      .select({
        totalIn: sql<number>`COALESCE(SUM(${apiLogs.tokensIn}), 0)`,
        totalOut: sql<number>`COALESCE(SUM(${apiLogs.tokensOut}), 0)`,
      })
      .from(apiLogs)
      .where(gte(apiLogs.createdAt, todayStart));
    const tokensConsumedToday = (tokensResult?.totalIn || 0) + (tokensResult?.totalOut || 0);

    const [latencyResult] = await db
      .select({
        avg: sql<number>`COALESCE(AVG(${apiLogs.latencyMs}), 0)`,
      })
      .from(apiLogs)
      .where(gte(apiLogs.createdAt, todayStart));
    const avgLatencyMs = Math.round(latencyResult?.avg || 0);

    const [errorResult] = await db
      .select({
        total: count(),
        errors: sql<number>`SUM(CASE WHEN ${apiLogs.statusCode} >= 400 THEN 1 ELSE 0 END)`,
      })
      .from(apiLogs)
      .where(gte(apiLogs.createdAt, todayStart));

    const totalToday = errorResult?.total || 0;
    const errorsToday = errorResult?.errors || 0;
    const errorRatePercentage = totalToday > 0
      ? ((errorsToday / totalToday) * 100).toFixed(2)
      : "0.00";

    const budgets = await storage.getCostBudgets();
    let revenueToday = 0;
    for (const budget of budgets) {
      revenueToday += parseFloat(budget.currentSpend || "0");
    }

    await storage.createKpiSnapshot({
      activeUsersNow,
      queriesPerMinute,
      tokensConsumedToday,
      revenueToday: revenueToday.toFixed(2),
      avgLatencyMs,
      errorRatePercentage,
    });

    console.log(`[Analytics] KPI snapshot created - Active: ${activeUsersNow}, QPM: ${queriesPerMinute}, Tokens: ${tokensConsumedToday}`);
  } catch (error) {
    console.error("[Analytics] Error calculating KPIs:", error);
  }
}

export function startAggregator(): void {
  if (aggregatorInterval) {
    console.log("[Analytics] Aggregator already running");
    return;
  }

  const intervalMs = process.env.NODE_ENV !== 'production'
    ? 5 * 60 * 1000
    : AGGREGATION_INTERVAL_MS;

  console.log(`[Analytics] Starting analytics aggregator (${intervalMs / 1000}s interval)`);

  runAggregation().catch(console.error);

  aggregatorInterval = setInterval(() => {
    runAggregation().catch(console.error);
  }, intervalMs);
}

export function stopAggregator(): void {
  if (aggregatorInterval) {
    clearInterval(aggregatorInterval);
    aggregatorInterval = null;
    console.log("[Analytics] Aggregator stopped");
  }
}

export async function getAggregatedMetrics(provider?: string, hours: number = 24) {
  const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);
  return storage.getProviderMetrics({ provider, startDate });
}
