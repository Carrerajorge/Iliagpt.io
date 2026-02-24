/**
 * ConnectorCostTracker — API cost estimation and budget enforcement.
 *
 * Tracks per-user, per-connector spending with daily and monthly budget
 * limits.  All data is in-memory with a periodic flush hook for
 * persistence.  No external dependencies.
 *
 * Cost estimates are based on typical SaaS API pricing tiers and are
 * intentionally conservative (slightly over-count) so budget enforcement
 * never surprises users.
 */

// ─── Public Types ──────────────────────────────────────────────────

export interface CostEstimate {
  connectorId: string;
  operationId: string;
  estimatedCostUsd: number;
  costBasis: string; // e.g. "per_request", "per_record", "per_mb"
}

export interface BudgetCheck {
  withinBudget: boolean;
  dailyUsed: number;
  dailyLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
}

export interface UserBudget {
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
}

export interface SpendEntry {
  userId: string;
  totalUsd: number;
}

export interface CostRecord {
  connectorId: string;
  operationId: string;
  userId: string;
  costUsd: number;
  timestamp: number;
}

// ─── Internal Accumulators ─────────────────────────────────────────

interface UserAccumulator {
  /** Running total for the current UTC day (resets at midnight). */
  dailyUsd: number;
  /** Running total for the current UTC month (resets on the 1st). */
  monthlyUsd: number;
  /** Day-of-year when dailyUsd was last reset. */
  dayMark: number;
  /** Month (0-11) when monthlyUsd was last reset. */
  monthMark: number;
}

interface ConnectorAccumulator {
  dailyUsd: number;
  monthlyUsd: number;
  dayMark: number;
  monthMark: number;
}

// ─── Cost Rules ────────────────────────────────────────────────────

interface OperationCost {
  costUsd: number;
  basis: string;
}

/**
 * Hardcoded cost tables per connector.  Keys are operation-ID suffixes
 * (after the connector prefix, e.g. "send_email" for "gmail_send_email").
 * A `__default__` entry is used when no specific match is found.
 */
const COST_RULES: Record<string, Record<string, OperationCost>> = {
  gmail: {
    send: { costUsd: 0.001, basis: "per_request" },
    send_email: { costUsd: 0.001, basis: "per_request" },
    read: { costUsd: 0.0001, basis: "per_request" },
    read_email: { costUsd: 0.0001, basis: "per_request" },
    search: { costUsd: 0.0005, basis: "per_request" },
    search_email: { costUsd: 0.0005, basis: "per_request" },
    __default__: { costUsd: 0.0005, basis: "per_request" },
  },
  slack: {
    post: { costUsd: 0.0005, basis: "per_request" },
    post_message: { costUsd: 0.0005, basis: "per_request" },
    read: { costUsd: 0.0001, basis: "per_request" },
    read_message: { costUsd: 0.0001, basis: "per_request" },
    search: { costUsd: 0.001, basis: "per_request" },
    search_messages: { costUsd: 0.001, basis: "per_request" },
    __default__: { costUsd: 0.0005, basis: "per_request" },
  },
  notion: {
    create: { costUsd: 0.001, basis: "per_request" },
    create_page: { costUsd: 0.001, basis: "per_request" },
    read: { costUsd: 0.0001, basis: "per_request" },
    read_page: { costUsd: 0.0001, basis: "per_request" },
    search: { costUsd: 0.0005, basis: "per_request" },
    search_pages: { costUsd: 0.0005, basis: "per_request" },
    __default__: { costUsd: 0.0005, basis: "per_request" },
  },
  github: {
    create_issue: { costUsd: 0.001, basis: "per_request" },
    read: { costUsd: 0.0001, basis: "per_request" },
    read_issue: { costUsd: 0.0001, basis: "per_request" },
    search: { costUsd: 0.0005, basis: "per_request" },
    search_issues: { costUsd: 0.0005, basis: "per_request" },
    __default__: { costUsd: 0.0003, basis: "per_request" },
  },
  hubspot: {
    create_contact: { costUsd: 0.002, basis: "per_request" },
    create_deal: { costUsd: 0.002, basis: "per_request" },
    read: { costUsd: 0.0001, basis: "per_request" },
    read_contact: { costUsd: 0.0001, basis: "per_request" },
    list: { costUsd: 0.0005, basis: "per_request" },
    list_contacts: { costUsd: 0.0005, basis: "per_request" },
    __default__: { costUsd: 0.0005, basis: "per_request" },
  },
  google_drive: {
    upload: { costUsd: 0.005, basis: "per_mb" },
    upload_file: { costUsd: 0.005, basis: "per_mb" },
    read: { costUsd: 0.0001, basis: "per_request" },
    read_file: { costUsd: 0.0001, basis: "per_request" },
    search: { costUsd: 0.0005, basis: "per_request" },
    search_files: { costUsd: 0.0005, basis: "per_request" },
    __default__: { costUsd: 0.0003, basis: "per_request" },
  },
};

const GLOBAL_DEFAULT_COST: OperationCost = {
  costUsd: 0.0005,
  basis: "per_request",
};

// ─── Constants ─────────────────────────────────────────────────────

const FLUSH_INTERVAL_MS = 5 * 60_000; // 5 minutes
const ALERT_DAILY_80 = 0.8;
const ALERT_DAILY_100 = 1.0;
const ALERT_MONTHLY_80 = 0.8;

// ─── Helpers ───────────────────────────────────────────────────────

function utcDayOfYear(d: Date = new Date()): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const diff = d.getTime() - start;
  return Math.floor(diff / 86_400_000);
}

function utcMonth(d: Date = new Date()): number {
  return d.getUTCMonth();
}

/**
 * Resolve an operation ID to a cost rule.  Tries exact match, then strips
 * the connector prefix (e.g. "gmail_send_email" -> "send_email"), then
 * tries each word, finally falls back to __default__.
 */
function resolveOperationCost(
  connectorId: string,
  operationId: string,
): OperationCost {
  const table = COST_RULES[connectorId];
  if (!table) return GLOBAL_DEFAULT_COST;

  // Exact match
  if (table[operationId]) return table[operationId];

  // Strip connector prefix (e.g. "gmail_send_email" -> "send_email")
  const prefix = `${connectorId}_`;
  const stripped = operationId.startsWith(prefix)
    ? operationId.slice(prefix.length)
    : operationId;

  if (table[stripped]) return table[stripped];

  // Try each part of the operation ID
  const parts = stripped.split("_");
  for (const part of parts) {
    if (table[part]) return table[part];
  }

  return table.__default__ ?? GLOBAL_DEFAULT_COST;
}

// ─── ConnectorCostTracker ──────────────────────────────────────────

export class ConnectorCostTracker {
  /** Per-user accumulators. */
  private readonly _users = new Map<string, UserAccumulator>();

  /** Per-connector accumulators. */
  private readonly _connectors = new Map<string, ConnectorAccumulator>();

  /** User budget limits. */
  private readonly _budgets = new Map<string, UserBudget>();

  /** Raw cost log (ring buffer, capped). */
  private readonly _log: CostRecord[] = [];
  private readonly _logMaxSize = 10_000;

  /** Optional DB flush callback. */
  private _flushCallback:
    | ((records: CostRecord[]) => Promise<void>)
    | null = null;
  private _pendingFlush: CostRecord[] = [];

  private _flushTimer: ReturnType<typeof setInterval> | null = null;

  /* ---------------------------------------------------------------- */
  /*  Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  constructor() {
    this._startFlushTimer();
  }

  /**
   * Stop the background flush timer (call when shutting down).
   */
  dispose(): void {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
  }

  /**
   * Register an async callback that receives accumulated cost records
   * every 5 minutes.  Best-effort: errors are logged but do not crash.
   */
  onFlush(callback: (records: CostRecord[]) => Promise<void>): void {
    this._flushCallback = callback;
  }

  /* ---------------------------------------------------------------- */
  /*  Accumulator helpers                                              */
  /* ---------------------------------------------------------------- */

  private _ensureUser(userId: string): UserAccumulator {
    const now = new Date();
    let acc = this._users.get(userId);
    if (!acc) {
      acc = {
        dailyUsd: 0,
        monthlyUsd: 0,
        dayMark: utcDayOfYear(now),
        monthMark: utcMonth(now),
      };
      this._users.set(userId, acc);
      return acc;
    }

    // Reset daily counter at midnight UTC
    const today = utcDayOfYear(now);
    if (acc.dayMark !== today) {
      acc.dailyUsd = 0;
      acc.dayMark = today;
    }

    // Reset monthly counter on the 1st
    const month = utcMonth(now);
    if (acc.monthMark !== month) {
      acc.monthlyUsd = 0;
      acc.monthMark = month;
    }

    return acc;
  }

  private _ensureConnector(connectorId: string): ConnectorAccumulator {
    const now = new Date();
    let acc = this._connectors.get(connectorId);
    if (!acc) {
      acc = {
        dailyUsd: 0,
        monthlyUsd: 0,
        dayMark: utcDayOfYear(now),
        monthMark: utcMonth(now),
      };
      this._connectors.set(connectorId, acc);
      return acc;
    }

    const today = utcDayOfYear(now);
    if (acc.dayMark !== today) {
      acc.dailyUsd = 0;
      acc.dayMark = today;
    }

    const month = utcMonth(now);
    if (acc.monthMark !== month) {
      acc.monthlyUsd = 0;
      acc.monthMark = month;
    }

    return acc;
  }

  /* ---------------------------------------------------------------- */
  /*  Core: recordCost                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Record an actual cost incurred by an operation.
   */
  recordCost(
    connectorId: string,
    userId: string,
    operationId: string,
    costUsd: number,
  ): void {
    if (costUsd <= 0) return;

    // User accumulator
    const userAcc = this._ensureUser(userId);
    userAcc.dailyUsd += costUsd;
    userAcc.monthlyUsd += costUsd;

    // Connector accumulator
    const connAcc = this._ensureConnector(connectorId);
    connAcc.dailyUsd += costUsd;
    connAcc.monthlyUsd += costUsd;

    // Log record
    const record: CostRecord = {
      connectorId,
      operationId,
      userId,
      costUsd,
      timestamp: Date.now(),
    };
    this._log.push(record);
    if (this._log.length > this._logMaxSize) {
      this._log.splice(0, this._log.length - this._logMaxSize);
    }
    this._pendingFlush.push(record);

    // Budget alerts
    this._checkAlerts(userId);
  }

  /* ---------------------------------------------------------------- */
  /*  Core: estimateCost                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Estimate the cost of an operation before executing it.
   *
   * If `input` is provided and the cost basis is "per_mb", the estimate
   * will be scaled by the input size.
   */
  estimateCost(
    connectorId: string,
    operationId: string,
    input?: { sizeBytes?: number },
  ): CostEstimate {
    const rule = resolveOperationCost(connectorId, operationId);
    let estimated = rule.costUsd;

    if (rule.basis === "per_mb" && input?.sizeBytes) {
      const mb = input.sizeBytes / (1024 * 1024);
      estimated = rule.costUsd * Math.max(1, mb);
    }

    return {
      connectorId,
      operationId,
      estimatedCostUsd: Math.round(estimated * 1_000_000) / 1_000_000, // 6 decimal precision
      costBasis: rule.basis,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Spend queries                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Total spending for a user within a lookback period.
   * Defaults to 24 hours.
   */
  getUserSpend(userId: string, periodMs: number = 86_400_000): number {
    const cutoff = Date.now() - periodMs;
    let total = 0;
    for (let i = this._log.length - 1; i >= 0; i--) {
      const r = this._log[i];
      if (r.timestamp < cutoff) break; // log is append-only, so we can break
      if (r.userId === userId) {
        total += r.costUsd;
      }
    }
    return Math.round(total * 1_000_000) / 1_000_000;
  }

  /**
   * Total spending for a connector within a lookback period.
   * Defaults to 24 hours.
   */
  getConnectorSpend(connectorId: string, periodMs: number = 86_400_000): number {
    const cutoff = Date.now() - periodMs;
    let total = 0;
    for (let i = this._log.length - 1; i >= 0; i--) {
      const r = this._log[i];
      if (r.timestamp < cutoff) break;
      if (r.connectorId === connectorId) {
        total += r.costUsd;
      }
    }
    return Math.round(total * 1_000_000) / 1_000_000;
  }

  /* ---------------------------------------------------------------- */
  /*  Budget management                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Set daily and monthly budget caps for a user.
   */
  setBudget(userId: string, dailyLimitUsd: number, monthlyLimitUsd: number): void {
    this._budgets.set(userId, { dailyLimitUsd, monthlyLimitUsd });
  }

  /**
   * Check whether a user is within their configured budget.
   * If no budget is set, returns unlimited (withinBudget: true, limits = Infinity).
   */
  checkBudget(userId: string): BudgetCheck {
    const budget = this._budgets.get(userId);
    const acc = this._ensureUser(userId);

    const dailyLimit = budget?.dailyLimitUsd ?? Infinity;
    const monthlyLimit = budget?.monthlyLimitUsd ?? Infinity;

    return {
      withinBudget: acc.dailyUsd < dailyLimit && acc.monthlyUsd < monthlyLimit,
      dailyUsed: Math.round(acc.dailyUsd * 1_000_000) / 1_000_000,
      dailyLimit,
      monthlyUsed: Math.round(acc.monthlyUsd * 1_000_000) / 1_000_000,
      monthlyLimit,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Leaderboard                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Return the top N spenders by monthly accumulated cost.
   */
  getTopSpenders(limit: number = 10): SpendEntry[] {
    const entries: SpendEntry[] = [];
    for (const [userId, acc] of this._users) {
      // Re-sync accumulators to handle day/month rollovers
      this._ensureUser(userId);
      entries.push({ userId, totalUsd: Math.round(acc.monthlyUsd * 1_000_000) / 1_000_000 });
    }
    entries.sort((a, b) => b.totalUsd - a.totalUsd);
    return entries.slice(0, limit);
  }

  /* ---------------------------------------------------------------- */
  /*  Alerts                                                           */
  /* ---------------------------------------------------------------- */

  private _checkAlerts(userId: string): void {
    const budget = this._budgets.get(userId);
    if (!budget) return;

    const acc = this._ensureUser(userId);

    const dailyRatio = acc.dailyUsd / budget.dailyLimitUsd;
    const monthlyRatio = acc.monthlyUsd / budget.monthlyLimitUsd;

    if (dailyRatio >= ALERT_DAILY_100) {
      console.error(
        `[ConnectorCostTracker] BUDGET EXCEEDED: User ${userId} daily spend ` +
          `$${acc.dailyUsd.toFixed(4)} >= limit $${budget.dailyLimitUsd.toFixed(2)} — ` +
          `operations should be blocked`,
      );
    } else if (dailyRatio >= ALERT_DAILY_80) {
      console.warn(
        `[ConnectorCostTracker] Budget warning: User ${userId} daily spend at ` +
          `${(dailyRatio * 100).toFixed(1)}% ($${acc.dailyUsd.toFixed(4)} / $${budget.dailyLimitUsd.toFixed(2)})`,
      );
    }

    if (monthlyRatio >= ALERT_MONTHLY_80) {
      console.warn(
        `[ConnectorCostTracker] Budget warning: User ${userId} monthly spend at ` +
          `${(monthlyRatio * 100).toFixed(1)}% ($${acc.monthlyUsd.toFixed(4)} / $${budget.monthlyLimitUsd.toFixed(2)})`,
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Periodic DB flush                                                */
  /* ---------------------------------------------------------------- */

  private _startFlushTimer(): void {
    this._flushTimer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS);
    if (this._flushTimer && typeof this._flushTimer === "object" && "unref" in this._flushTimer) {
      (this._flushTimer as NodeJS.Timeout).unref();
    }
  }

  private async _flush(): Promise<void> {
    if (!this._flushCallback || this._pendingFlush.length === 0) return;

    const batch = this._pendingFlush.splice(0);
    try {
      await this._flushCallback(batch);
    } catch (err) {
      console.error(
        `[ConnectorCostTracker] DB flush failed (${batch.length} records):`,
        err instanceof Error ? err.message : String(err),
      );
      // Re-queue failed records (prepend so they are retried first)
      this._pendingFlush.unshift(...batch);
      // Cap the pending queue to prevent unbounded growth
      if (this._pendingFlush.length > this._logMaxSize) {
        const dropped = this._pendingFlush.length - this._logMaxSize;
        this._pendingFlush.splice(0, dropped);
        console.warn(
          `[ConnectorCostTracker] Dropped ${dropped} oldest pending flush records to prevent OOM`,
        );
      }
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────

export const connectorCostTracker = new ConnectorCostTracker();
