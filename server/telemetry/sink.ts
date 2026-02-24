/**
 * TelemetrySink — writes batches of DashboardEvents to PostgreSQL.
 * Uses ON CONFLICT DO NOTHING on idempotency_key for at-least-once dedup.
 */

import { sql } from "drizzle-orm";
import type { DashboardEvent } from "./eventSchema";
import { createLogger } from "../utils/logger";

const logger = createLogger("telemetry-sink");

/**
 * Write a batch of events to the telemetry_events table.
 * Returns the number of rows actually inserted (after dedup).
 *
 * @param db  A Drizzle database instance (passed in to avoid circular imports)
 * @param events  Array of validated DashboardEvents
 */
export async function writeBatch(
  db: any, // drizzle instance — typed loosely to avoid import cycles
  events: DashboardEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  // Build VALUES tuples for a raw INSERT … ON CONFLICT DO NOTHING
  const values = events.map((e) => {
    const { eventId, idempotencyKey, category, correlationIds, ...rest } = e;
    return sql`(
      gen_random_uuid(),
      ${eventId},
      ${idempotencyKey},
      ${category},
      ${JSON.stringify(correlationIds)}::jsonb,
      ${JSON.stringify(rest)}::jsonb,
      NOW()
    )`;
  });

  const query = sql`
    INSERT INTO telemetry_events (id, event_id, idempotency_key, category, correlation_ids, payload, created_at)
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (idempotency_key) DO NOTHING
  `;

  try {
    const result = await db.execute(query);
    const inserted = (result as any)?.rowCount ?? events.length;
    return inserted;
  } catch (err: unknown) {
    // If the table doesn't exist yet (migration not run), log and rethrow
    // so the circuit breaker can open.
    const msg = (err as Error)?.message ?? String(err);
    logger.error("Sink writeBatch failed", { error: msg, batchSize: events.length });
    throw err;
  }
}

/**
 * Prune old events to prevent unbounded table growth.
 * Call periodically (e.g. daily via cron).
 */
export async function pruneOldEvents(db: any, retentionDays = 30): Promise<number> {
  try {
    const result = await db.execute(
      sql`DELETE FROM telemetry_events WHERE created_at < NOW() - ${retentionDays}::int * INTERVAL '1 day'`,
    );
    const deleted = (result as any)?.rowCount ?? 0;
    if (deleted > 0) {
      logger.info("Pruned old telemetry events", { deleted, retentionDays });
    }
    return deleted;
  } catch (err) {
    logger.warn("Prune telemetry failed", { error: (err as Error)?.message });
    return 0;
  }
}
