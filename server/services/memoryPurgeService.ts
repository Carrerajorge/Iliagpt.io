/**
 * Periodic job to purge old agent memories.
 * Without a TTL/purge, `agent_memories` grows indefinitely, degrading pgvector
 * index performance and increasing storage costs.
 *
 * Configurable via env:
 *   MEMORY_PURGE_AGE_DAYS   - records older than this are deleted (default 90)
 *   MEMORY_PURGE_CRON       - cron expression (default "0 3 * * *" — 3am daily)
 */
import cron from "node-cron";
import { lt, sql } from "drizzle-orm";
import { db } from "../db";
import { agentMemories } from "@shared/schema";
import { Logger } from "../lib/logger";
import { env } from "../config/env";

let started = false;

export function startMemoryPurgeJob(): void {
  if (started) return;
  if (process.env.NODE_ENV === "test") return;
  started = true;

  const ageDays = env.MEMORY_PURGE_AGE_DAYS;
  const cronExpression = env.MEMORY_PURGE_CRON;

  if (!cron.validate(cronExpression)) {
    Logger.warn("[MemoryPurge] Invalid MEMORY_PURGE_CRON expression; purge job not started", { cronExpression });
    return;
  }

  Logger.info(`[MemoryPurge] Scheduling purge job — cron="${cronExpression}", olderThan=${ageDays} days`);

  cron.schedule(cronExpression, async () => {
    try {
      const cutoff = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
      const result = await db
        .delete(agentMemories)
        .where(lt(agentMemories.createdAt, cutoff));

      const rowCount = (result as any)?.rowCount ?? 0;
      Logger.info(`[MemoryPurge] Deleted ${rowCount} agent_memories older than ${ageDays} days`, { cutoff });
    } catch (err: any) {
      Logger.error("[MemoryPurge] Failed to purge old memories", { error: err?.message });
    }
  });
}
