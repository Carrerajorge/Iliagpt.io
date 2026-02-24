import { sql } from "drizzle-orm";
import { pgTable, varchar, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Telemetry events table — stores all DashboardEvents emitted by the
 * telemetry pipeline. Idempotency key is unique to enable at-least-once
 * delivery with deduplication via ON CONFLICT DO NOTHING.
 */
export const telemetryEvents = pgTable("telemetry_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: varchar("event_id", { length: 64 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  correlationIds: jsonb("correlation_ids").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
  uniqueIndex("telemetry_events_idempotency_idx").on(table.idempotencyKey),
  index("telemetry_events_category_idx").on(table.category),
  index("telemetry_events_created_idx").on(table.createdAt),
  index("telemetry_events_correlation_trace_idx").using(
    "btree",
    sql`((correlation_ids->>'traceId'))`,
  ),
]);

export const insertTelemetryEventSchema = createInsertSchema(telemetryEvents);

export type InsertTelemetryEvent = z.infer<typeof insertTelemetryEventSchema>;
export type TelemetryEvent = typeof telemetryEvents.$inferSelect;
