/**
 * Real-time Metrics Service
 * Provides live dashboard metrics via WebSocket and polling
 */

import { storage } from "../storage";
import { db } from "../db";
import { llmGateway } from "../lib/llmGateway";

export interface RealtimeMetrics {
  timestamp: number;
  activeUsers: number;
  queriesPerMinute: number;
  tokensConsumedToday: number;
  avgLatencyMs: number;
  errorRate: number;
  systemHealth: {
    xai: boolean;
    gemini: boolean;
    openai: boolean;
    database: boolean;
  };
  recentActivity: {
    action: string;
    user: string;
    time: string;
    resource?: string;
  }[];
}

// In-memory metrics cache (refreshed every 30 seconds)
let cachedMetrics: RealtimeMetrics | null = null;
let lastMetricsUpdate = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

export async function getRealtimeMetrics(): Promise<RealtimeMetrics> {
  const now = Date.now();
  
  // Return cached if still valid
  if (cachedMetrics && (now - lastMetricsUpdate) < CACHE_TTL_MS) {
    return cachedMetrics;
  }
  
  try {
    // Parallel fetch for performance
    const [
      userStats,
      kpiSnapshot,
      recentLogs,
      healthStatus
    ] = await Promise.all([
      storage.getUserStats(),
      storage.getLatestKpiSnapshot().catch(() => null),
      storage.getAuditLogs(10),
      llmGateway.healthCheck().catch(() => ({ xai: { available: false }, gemini: { available: false }, openai: { available: false } }))
    ]);
    
    // Calculate active users (active in last 24 hours)
    const activeUsers = userStats.active || 0;
    
    // QPM from latest snapshot or calculate
    const queriesPerMinute = kpiSnapshot?.queriesPerMinute || 0;
    
    // Tokens consumed today
    const tokensConsumedToday = kpiSnapshot?.tokensConsumedToday || 0;
    
    // Average latency
    const avgLatencyMs = kpiSnapshot?.avgLatencyMs || 0;
    
    // Error rate
    const errorRate = kpiSnapshot?.errorRatePercentage 
      ? parseFloat(kpiSnapshot.errorRatePercentage) 
      : 0;
    
    // Format recent activity
    const recentActivity = recentLogs.slice(0, 5).map(log => ({
      action: log.action,
      user: log.userId || "system",
      time: log.createdAt.toISOString(),
      resource: log.resource || undefined
    }));
    
    cachedMetrics = {
      timestamp: now,
      activeUsers,
      queriesPerMinute,
      tokensConsumedToday,
      avgLatencyMs,
      errorRate,
      systemHealth: {
        xai: (healthStatus as any)?.xai?.available ?? false,
        gemini: (healthStatus as any)?.gemini?.available ?? false,
        openai: (healthStatus as any)?.openai?.available ?? false,
        database: true // Assume healthy if we got here
      },
      recentActivity
    };
    
    lastMetricsUpdate = now;
    return cachedMetrics;
    
  } catch (error) {
    console.error("[RealtimeMetrics] Failed to fetch metrics:", error);
    
    // Return stale cache or empty metrics
    return cachedMetrics || {
      timestamp: now,
      activeUsers: 0,
      queriesPerMinute: 0,
      tokensConsumedToday: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      systemHealth: {
        xai: false,
        gemini: false,
        openai: false,
        database: false
      },
      recentActivity: []
    };
  }
}

/**
 * Calculate a month-over-month trend as a formatted percentage string.
 * Returns "+0%" when there is no previous data to compare against.
 */
function calculateTrend(current: number, previous: number): string {
  if (previous === 0) {
    return current > 0 ? "+100%" : "+0%";
  }
  const pctChange = ((current - previous) / previous) * 100;
  const rounded = Math.round(pctChange);
  const sign = rounded >= 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

/**
 * Get extended dashboard statistics
 */
export async function getExtendedDashboardStats() {
  const [
    userStats,
    paymentStats,
    allModels,
    invoices,
    recentLogs,
    settings
  ] = await Promise.all([
    storage.getUserStats(),
    storage.getPaymentStats(),
    storage.getAiModels(),
    storage.getInvoices(),
    storage.getAuditLogs(50),
    storage.getSettings()
  ]);
  
  // Calculate month-over-month trends
  const userTrend = calculateTrend(userStats.newThisMonth, userStats.newLastMonth);
  const revenueTrend = calculateTrend(
    parseFloat(paymentStats.thisMonth),
    parseFloat(paymentStats.previousMonth)
  );

  // Action breakdown
  const actionCounts = recentLogs.reduce((acc, log) => {
    acc[log.action] = (acc[log.action] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  // Top actions
  const topActions = Object.entries(actionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([action, count]) => ({ action, count }));
  
  // Security events
  const securityEvents = recentLogs.filter(log => 
    log.action.includes("login_failed") || 
    log.action.includes("blocked") ||
    log.action.includes("security") ||
    log.action.includes("denied")
  );
  
  // Model usage breakdown
  const activeModels = allModels.filter(m => m.status === "active");
  const modelsByProvider = activeModels.reduce((acc, m) => {
    acc[m.provider] = (acc[m.provider] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  return {
    users: {
      total: userStats.total,
      active: userStats.active,
      newThisMonth: userStats.newThisMonth,
      trend: userTrend
    },
    revenue: {
      total: paymentStats.total,
      thisMonth: paymentStats.thisMonth,
      transactions: paymentStats.count,
      trend: revenueTrend
    },
    models: {
      total: allModels.length,
      active: activeModels.length,
      byProvider: modelsByProvider
    },
    invoices: {
      total: invoices.length,
      pending: invoices.filter(i => i.status === "pending").length,
      paid: invoices.filter(i => i.status === "paid").length,
      overdue: invoices.filter(i => i.status === "overdue").length
    },
    activity: {
      total: recentLogs.length,
      topActions,
      securityEvents: securityEvents.length
    },
    settings: {
      total: settings.length,
      categories: [...new Set(settings.map(s => s.category))].length
    }
  };
}

/**
 * Force refresh metrics cache
 */
export function invalidateMetricsCache(): void {
  lastMetricsUpdate = 0;
  cachedMetrics = null;
}
