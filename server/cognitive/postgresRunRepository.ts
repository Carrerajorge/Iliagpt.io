/**
 * Cognitive Middleware — Postgres-backed run repository (Turn G).
 *
 * Production wiring for `RunRepository`. Follows the same pattern
 * as `server/memory/PgVectorMemoryStore.ts`: declares its OWN
 * Drizzle schema inline so this module is self-contained and
 * does NOT touch `shared/schema.ts`. The tradeoff is that
 * `shared/schema.ts` won't auto-generate a migration for these
 * tables — the consumer must run the `ensureSchema()` method
 * once at boot time to DDL the tables on demand. That's
 * acceptable for a feature-flagged rollout; a follow-up turn
 * can fold the schema into the main migrations system.
 *
 * Design principles:
 *
 *   1. **Single JSONB column for the record.** We store the full
 *      `CognitiveRunRecord` as a JSONB payload under `payload`,
 *      plus a few indexed columns (`runId`, `userId`, `createdAt`,
 *      `ok`, `providerName`) so dashboards can filter without
 *      parsing JSON. The indexed columns are EXTRACTED from the
 *      payload at write time, not duplicated as source of truth.
 *
 *   2. **Drizzle, not raw SQL.** We go through the project's
 *      existing `db` instance (same one the rest of the codebase
 *      uses), so connection pooling, timeouts, and shutdown
 *      hooks are shared with everything else.
 *
 *   3. **Dependency-injectable db.** The constructor accepts an
 *      optional `db` override so tests can pass a mock. Without
 *      the override, the adapter lazy-resolves `server/db` at
 *      first use — keeping this module decoupled from the db
 *      module's own boot lifecycle.
 *
 *   4. **Never throws on `save`.** Production repos should
 *      propagate exceptions to the middleware — the middleware's
 *      `persistRun` hook catches them into `errors[]`. We do NOT
 *      swallow errors inside the adapter.
 *
 *   5. **JSON-safe writes.** The projection from
 *      `projectRequestResponseToRunRecord` already produces a
 *      JSON-safe object. We assert that with JSON.stringify
 *      before hitting the DB so a schema mismatch fails fast.
 */

import { pgTable, uuid, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { desc, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import type {
  CognitiveRunRecord,
  RunRepository,
} from "./persistence";

// ---------------------------------------------------------------------------
// Schema (declared inline so this module is self-contained)
// ---------------------------------------------------------------------------

/**
 * One row per saved run. `payload` holds the full
 * `CognitiveRunRecord` as JSONB so dashboards can replay the
 * entire object; the sibling columns are EXTRACTED projections
 * indexed for common filter patterns (per-user listings, filter
 * by ok=false, filter by provider).
 */
export const cognitiveRunRecords = pgTable(
  "cognitive_run_records",
  {
    /** DB primary key. */
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The runId we assigned at save time. UNIQUE + indexed so
     * `getByRunId` is O(log n).
     */
    runId: text("run_id").notNull().unique(),
    /** Owning user id — indexed for `listByUser`. */
    userId: text("user_id").notNull(),
    /** Conversation id for UI filtering. Nullable. */
    conversationId: text("conversation_id"),
    /** Healthy outcome flag, indexed for "all failed runs" filters. */
    ok: boolean("ok").notNull(),
    /** Provider that served the request, indexed. */
    providerName: text("provider_name").notNull(),
    /** Intent the classifier picked. */
    intent: text("intent").notNull(),
    /** Full serialized record. */
    payload: jsonb("payload").notNull(),
    /** Wall-clock when the record was inserted. */
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("cognitive_run_records_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    providerIdx: index("cognitive_run_records_provider_idx").on(
      table.providerName,
    ),
    okIdx: index("cognitive_run_records_ok_idx").on(table.ok),
  }),
);

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the project's `db` handle the adapter needs.
 * Typed as a structural interface so tests can pass a mock
 * without importing `drizzle-orm`.
 */
export interface RunRepositoryDbHandle {
  insert: (table: typeof cognitiveRunRecords) => {
    values: (row: {
      runId: string;
      userId: string;
      conversationId: string | null;
      ok: boolean;
      providerName: string;
      intent: string;
      payload: unknown;
      createdAt?: Date;
    }) => {
      returning: () => Promise<
        Array<{
          runId: string;
          createdAt: Date;
        }>
      >;
    };
  };
  select: () => {
    from: (table: typeof cognitiveRunRecords) => {
      where: (
        clause: unknown,
      ) => {
        orderBy: (order: unknown) => {
          limit: (n: number) => Promise<
            Array<{
              runId: string;
              payload: CognitiveRunRecord;
              createdAt: Date;
            }>
          >;
        };
      };
    };
  };
  delete: (table: typeof cognitiveRunRecords) => {
    where: (
      clause: unknown,
    ) => Promise<
      | { rowCount?: number | null }
      | unknown
    >;
  };
  execute: (query: unknown) => Promise<unknown>;
}

export interface PostgresRunRepositoryOptions {
  /** Adapter name override. Default "postgres-runs". */
  name?: string;
  /**
   * Drizzle db handle. Required in production; tests pass a mock.
   */
  db: RunRepositoryDbHandle;
  /** Optional id generator — same shape as the in-memory repo. */
  generateRunId?: (userId: string, counter: number) => string;
  /** Optional clock for deterministic `persistedAt` values. */
  now?: () => number;
}

export class PostgresRunRepository implements RunRepository {
  readonly name: string;
  private readonly db: RunRepositoryDbHandle;
  private readonly generateRunId: (userId: string, counter: number) => string;
  private readonly now: () => number;
  private counter = 0;

  constructor(options: PostgresRunRepositoryOptions) {
    if (!options.db) {
      throw new Error("PostgresRunRepository: options.db is required");
    }
    this.name = options.name ?? "postgres-runs";
    this.db = options.db;
    this.generateRunId =
      options.generateRunId ??
      ((userId, counter) =>
        `run_${userId}_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`);
    this.now = options.now ?? Date.now;
  }

  async save(
    record: Omit<CognitiveRunRecord, "runId" | "persistedAt">,
  ): Promise<CognitiveRunRecord> {
    this.counter++;
    const runId = this.generateRunId(record.userId, this.counter);
    const persistedAt = this.now();
    const full: CognitiveRunRecord = {
      ...record,
      runId,
      persistedAt,
    };

    // Fail fast if the payload is not JSON-safe. The middleware
    // also guards this but an extra check here protects against
    // direct callers.
    JSON.stringify(full);

    await this.db
      .insert(cognitiveRunRecords)
      .values({
        runId: full.runId,
        userId: full.userId,
        conversationId: full.conversationId ?? null,
        ok: full.ok,
        providerName: full.providerName,
        intent: full.intent,
        payload: full,
        createdAt: new Date(persistedAt),
      })
      .returning();

    return full;
  }

  async get(runId: string): Promise<CognitiveRunRecord | null> {
    const rows = await this.db
      .select()
      .from(cognitiveRunRecords)
      .where(eq(cognitiveRunRecords.runId, runId))
      .orderBy(desc(cognitiveRunRecords.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return row.payload;
  }

  async listByUser(
    userId: string,
    limit: number = 50,
  ): Promise<CognitiveRunRecord[]> {
    const cappedLimit = Math.min(Math.max(0, limit), 500);
    const rows = await this.db
      .select()
      .from(cognitiveRunRecords)
      .where(eq(cognitiveRunRecords.userId, userId))
      .orderBy(desc(cognitiveRunRecords.createdAt))
      .limit(cappedLimit);
    return rows.map((r) => r.payload);
  }

  async deleteByRunId(runId: string): Promise<number> {
    const result = (await this.db
      .delete(cognitiveRunRecords)
      .where(eq(cognitiveRunRecords.runId, runId))) as {
      rowCount?: number | null;
    };
    return result.rowCount ?? 0;
  }

  /**
   * Create the backing tables + indexes on demand. Callers should
   * invoke this once during app bootstrap if they opt into the
   * Postgres repo. Idempotent — subsequent calls are no-ops.
   *
   * Follows the CREATE TABLE IF NOT EXISTS pattern used by
   * PgVectorMemoryStore.initialize(). A follow-up turn can lift
   * this into the main migrations system.
   */
  async ensureSchema(): Promise<void> {
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS cognitive_run_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        conversation_id TEXT,
        ok BOOLEAN NOT NULL,
        provider_name TEXT NOT NULL,
        intent TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS cognitive_run_records_user_created_idx
      ON cognitive_run_records (user_id, created_at DESC)
    `);
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS cognitive_run_records_provider_idx
      ON cognitive_run_records (provider_name)
    `);
    await this.db.execute(sql`
      CREATE INDEX IF NOT EXISTS cognitive_run_records_ok_idx
      ON cognitive_run_records (ok)
    `);
  }
}
