/**
 * EventStore: Append-only event store backed by PostgreSQL
 * Improvement 10 – Event-Driven Architecture with CQRS
 *
 * Uses raw `pg` Pool (not drizzle) for maximum control over the SQL.
 */

import pkg from "pg";
const { Pool } = pkg;
import crypto from "crypto";
import { Logger } from "../lib/logger";
import {
  AppEvent,
  EventFilter,
  Snapshot,
} from "./types";

// ---------------------------------------------------------------------------
// DDL – tables are created lazily on first use
// ---------------------------------------------------------------------------

const CREATE_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        TEXT NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  source          TEXT NOT NULL,
  aggregate_id    TEXT,
  aggregate_type  TEXT,
  user_id         TEXT,
  tenant_id       TEXT,
  correlation_id  TEXT,
  payload         JSONB NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}',
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  version         INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT events_event_id_unique UNIQUE (event_id)
);
CREATE INDEX IF NOT EXISTS events_type_idx          ON events (event_type);
CREATE INDEX IF NOT EXISTS events_aggregate_idx     ON events (aggregate_id, aggregate_type);
CREATE INDEX IF NOT EXISTS events_user_idx          ON events (user_id);
CREATE INDEX IF NOT EXISTS events_tenant_idx        ON events (tenant_id);
CREATE INDEX IF NOT EXISTS events_timestamp_idx     ON events (timestamp DESC);
CREATE INDEX IF NOT EXISTS events_correlation_idx   ON events (correlation_id);
`;

const CREATE_SNAPSHOTS_TABLE = `
CREATE TABLE IF NOT EXISTS event_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id    TEXT NOT NULL,
  aggregate_type  TEXT NOT NULL,
  version         INTEGER NOT NULL,
  state           JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT snapshots_unique UNIQUE (aggregate_id, aggregate_type)
);
CREATE INDEX IF NOT EXISTS snapshots_lookup_idx ON event_snapshots (aggregate_id, aggregate_type);
`;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RawEventRow {
  event_id: string;
  event_type: string;
  source: string;
  aggregate_id: string | null;
  aggregate_type: string | null;
  user_id: string | null;
  tenant_id: string | null;
  correlation_id: string | null;
  payload: Record<string, any>;
  metadata: Record<string, any>;
  timestamp: Date;
  version: number;
}

// ---------------------------------------------------------------------------
// EventStore
// ---------------------------------------------------------------------------

export class EventStore {
  private pool: InstanceType<typeof Pool>;
  private initialised = false;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString ?? process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "iliagpt_event_store",
    });

    this.pool.on("error", (err) => {
      Logger.error("EventStore pool error", err);
    });
  }

  // -------------------------------------------------------------------------
  // Lazy initialisation
  // -------------------------------------------------------------------------

  private async ensureInit(): Promise<void> {
    if (this.initialised) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(CREATE_EVENTS_TABLE);
      await client.query(CREATE_SNAPSHOTS_TABLE);
      await client.query("COMMIT");
      this.initialised = true;
      Logger.info("EventStore: tables initialised");
    } catch (err) {
      await client.query("ROLLBACK");
      Logger.error("EventStore.ensureInit failed", err);
      throw err;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Append
  // -------------------------------------------------------------------------

  async append(event: AppEvent): Promise<void> {
    await this.ensureInit();

    const payload = (event as any).payload ?? {};
    const aggregateId: string | null =
      payload.chatId ?? payload.taskId ?? payload.documentId ?? payload.userId ?? null;
    const aggregateType: string | null = aggregateId
      ? event.type.split(".")[0]
      : null;

    try {
      await this.pool.query(
        `INSERT INTO events
           (event_id, event_type, source, aggregate_id, aggregate_type,
            user_id, tenant_id, correlation_id, payload, metadata, timestamp, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          event.id,
          event.type,
          event.source,
          aggregateId,
          aggregateType,
          event.userId ?? null,
          event.tenantId ?? null,
          event.correlationId ?? null,
          JSON.stringify(payload),
          JSON.stringify(event.metadata ?? {}),
          event.timestamp,
          1,
        ]
      );
      Logger.debug("EventStore.append", { eventId: event.id, type: event.type });
    } catch (err) {
      Logger.error("EventStore.append failed", { err, eventId: event.id });
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Get events (with filtering and pagination)
  // -------------------------------------------------------------------------

  async getEvents(filter: EventFilter = {}): Promise<AppEvent[]> {
    await this.ensureInit();

    const conditions: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (filter.types && filter.types.length > 0) {
      conditions.push(`event_type = ANY($${i++})`);
      params.push(filter.types);
    }
    if (filter.userId) {
      conditions.push(`user_id = $${i++}`);
      params.push(filter.userId);
    }
    if (filter.tenantId) {
      conditions.push(`tenant_id = $${i++}`);
      params.push(filter.tenantId);
    }
    if (filter.aggregateId) {
      conditions.push(`aggregate_id = $${i++}`);
      params.push(filter.aggregateId);
    }
    if (filter.aggregateType) {
      conditions.push(`aggregate_type = $${i++}`);
      params.push(filter.aggregateType);
    }
    if (filter.fromTimestamp) {
      conditions.push(`timestamp >= $${i++}`);
      params.push(filter.fromTimestamp);
    }
    if (filter.toTimestamp) {
      conditions.push(`timestamp <= $${i++}`);
      params.push(filter.toTimestamp);
    }
    if (filter.correlationId) {
      conditions.push(`correlation_id = $${i++}`);
      params.push(filter.correlationId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const sql = `
      SELECT * FROM events
      ${where}
      ORDER BY timestamp ASC
      LIMIT $${i++} OFFSET $${i++}
    `;
    params.push(limit, offset);

    try {
      const result = await this.pool.query<RawEventRow>(sql, params);
      return result.rows.map(this.rowToEvent);
    } catch (err) {
      Logger.error("EventStore.getEvents failed", err);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Get all events for an aggregate
  // -------------------------------------------------------------------------

  async getAggregate(
    aggregateId: string,
    aggregateType: string
  ): Promise<AppEvent[]> {
    await this.ensureInit();
    try {
      const result = await this.pool.query<RawEventRow>(
        `SELECT * FROM events
         WHERE aggregate_id = $1 AND aggregate_type = $2
         ORDER BY timestamp ASC`,
        [aggregateId, aggregateType]
      );
      return result.rows.map(this.rowToEvent);
    } catch (err) {
      Logger.error("EventStore.getAggregate failed", err);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Snapshot management
  // -------------------------------------------------------------------------

  async createSnapshot(
    aggregateId: string,
    aggregateType: string,
    state: any,
    version: number
  ): Promise<void> {
    await this.ensureInit();
    try {
      await this.pool.query(
        `INSERT INTO event_snapshots (aggregate_id, aggregate_type, version, state)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (aggregate_id, aggregate_type)
         DO UPDATE SET version = $3, state = $4, created_at = now()`,
        [aggregateId, aggregateType, version, JSON.stringify(state)]
      );
      Logger.debug("EventStore.createSnapshot", { aggregateId, aggregateType, version });
    } catch (err) {
      Logger.error("EventStore.createSnapshot failed", err);
      throw err;
    }
  }

  async getSnapshot(
    aggregateId: string,
    aggregateType: string
  ): Promise<Snapshot | null> {
    await this.ensureInit();
    try {
      const result = await this.pool.query(
        `SELECT * FROM event_snapshots
         WHERE aggregate_id = $1 AND aggregate_type = $2
         LIMIT 1`,
        [aggregateId, aggregateType]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        aggregateId: row.aggregate_id,
        aggregateType: row.aggregate_type,
        version: row.version,
        state: row.state,
        createdAt: row.created_at,
      };
    } catch (err) {
      Logger.error("EventStore.getSnapshot failed", err);
      throw err;
    }
  }

  async rebuildFromSnapshot(
    aggregateId: string,
    aggregateType: string
  ): Promise<{ snapshot: Snapshot; events: AppEvent[] }> {
    const snapshot = await this.getSnapshot(aggregateId, aggregateType);
    if (!snapshot) {
      const events = await this.getAggregate(aggregateId, aggregateType);
      return {
        snapshot: {
          id: crypto.randomUUID(),
          aggregateId,
          aggregateType,
          version: 0,
          state: null,
          createdAt: new Date(),
        },
        events,
      };
    }

    // Get events that occurred after the snapshot was taken
    const result = await this.pool.query<RawEventRow>(
      `SELECT * FROM events
       WHERE aggregate_id = $1
         AND aggregate_type = $2
         AND version > $3
       ORDER BY timestamp ASC`,
      [aggregateId, aggregateType, snapshot.version]
    );

    return {
      snapshot,
      events: result.rows.map(this.rowToEvent),
    };
  }

  // -------------------------------------------------------------------------
  // Count helper
  // -------------------------------------------------------------------------

  async getEventCount(filter: EventFilter = {}): Promise<number> {
    await this.ensureInit();

    const conditions: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (filter.types && filter.types.length > 0) {
      conditions.push(`event_type = ANY($${i++})`);
      params.push(filter.types);
    }
    if (filter.userId) {
      conditions.push(`user_id = $${i++}`);
      params.push(filter.userId);
    }
    if (filter.fromTimestamp) {
      conditions.push(`timestamp >= $${i++}`);
      params.push(filter.fromTimestamp);
    }
    if (filter.toTimestamp) {
      conditions.push(`timestamp <= $${i++}`);
      params.push(filter.toTimestamp);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT COUNT(*)::INTEGER AS cnt FROM events ${where}`;

    try {
      const result = await this.pool.query(sql, params);
      return result.rows[0]?.cnt ?? 0;
    } catch (err) {
      Logger.error("EventStore.getEventCount failed", err);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Row mapper
  // -------------------------------------------------------------------------

  private rowToEvent = (row: RawEventRow): AppEvent => {
    return {
      id: row.event_id,
      type: row.event_type,
      source: row.source,
      timestamp: new Date(row.timestamp),
      userId: row.user_id ?? undefined,
      tenantId: row.tenant_id ?? undefined,
      correlationId: row.correlation_id ?? undefined,
      metadata: row.metadata,
      payload: row.payload,
    } as unknown as AppEvent;
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const eventStore = new EventStore();
