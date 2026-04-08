import { db } from "../db";
import { sql } from "drizzle-orm";
import { createLogger } from "../utils/logger";

const logger = createLogger("cron:userJobs");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns milliseconds until the next occurrence of a given UTC hour/minute.
 */
function msUntilUtcHour(hour: number, minute: number = 0): number {
  const now = new Date();
  const target = new Date(now);
  target.setUTCHours(hour, minute, 0, 0);
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - now.getTime();
}

/**
 * Reset daily request and token counters for all users.
 * Runs at 00:00 UTC.
 */
async function resetDailyCounters(): Promise<void> {
  try {
    const result = await db.execute(sql`
      UPDATE users
      SET daily_requests_used = 0,
          daily_input_tokens_used = 0,
          daily_output_tokens_used = 0,
          daily_requests_reset_at = NOW(),
          daily_token_usage_reset_at = NOW()
      WHERE daily_requests_used > 0
         OR daily_input_tokens_used > 0
         OR daily_output_tokens_used > 0
    `);

    const count = (result as any).rowCount ?? 0;
    logger.info("Daily counters reset", { usersReset: count });
  } catch (err) {
    logger.error("Failed to reset daily counters", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

/**
 * Log a usage summary of today's activity.
 * Runs at 00:05 UTC (captures the day that just ended before reset).
 */
async function logUsageSummary(): Promise<void> {
  try {
    const [summary] = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE daily_requests_used > 0) AS active_users,
        COALESCE(SUM(daily_requests_used), 0)           AS total_requests,
        COALESCE(SUM(daily_input_tokens_used), 0)       AS total_input_tokens,
        COALESCE(SUM(daily_output_tokens_used), 0)      AS total_output_tokens
      FROM users
    `) as any[];

    logger.info("Daily usage summary", {
      activeUsers: Number(summary.active_users),
      totalRequests: Number(summary.total_requests),
      totalInputTokens: Number(summary.total_input_tokens),
      totalOutputTokens: Number(summary.total_output_tokens),
    });
  } catch (err) {
    logger.error("Failed to log usage summary", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

/**
 * Identify stale anonymous users (>30 days inactive).
 * Logs count only — does not delete without admin approval.
 * Runs at 04:00 UTC.
 */
async function cleanupStaleAnonymousUsers(): Promise<void> {
  try {
    const [result] = await db.execute(sql`
      SELECT COUNT(*) AS stale_count
      FROM users
      WHERE id LIKE 'anon_%'
        AND COALESCE(last_login_at, created_at) < NOW() - INTERVAL '30 days'
    `) as any[];

    const staleCount = Number(result.stale_count);

    if (staleCount > 0) {
      logger.warn("Stale anonymous users detected (no deletion without admin approval)", {
        staleAnonymousUsers: staleCount,
        inactiveDaysThreshold: 30,
      });
    } else {
      logger.info("No stale anonymous users found");
    }
  } catch (err) {
    logger.error("Failed to check stale anonymous users", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

/**
 * Schedule a job: wait until the target UTC time, run immediately, then repeat daily.
 */
function scheduleDaily(
  name: string,
  hour: number,
  minute: number,
  job: () => Promise<void>,
): void {
  const delay = msUntilUtcHour(hour, minute);
  const targetTime = new Date(Date.now() + delay).toISOString();
  logger.info(`Scheduling "${name}"`, { firstRunAt: targetTime, intervalMs: ONE_DAY_MS });

  setTimeout(() => {
    job();
    setInterval(job, ONE_DAY_MS);
  }, delay);
}

/**
 * Start all user-related cron jobs.
 * Call once during server startup.
 */
export function startUserCronJobs(): void {
  logger.info("Initializing user cron jobs");

  // Usage summary runs BEFORE reset so it captures the previous day's data
  scheduleDaily("usageSummary", 0, 5, logUsageSummary);
  scheduleDaily("dailyCounterReset", 0, 0, resetDailyCounters);
  scheduleDaily("anonymousUserCleanup", 4, 0, cleanupStaleAnonymousUsers);

  logger.info("User cron jobs initialized", { jobs: 3 });
}
