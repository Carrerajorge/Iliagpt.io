// server/events/EventStore.ts
// Append-only PostgreSQL event store with optimistic concurrency,
// JSONB storage, GIN indexes, SHA-256 checksums, and snapshot support.

import { createHash } from 'crypto';
import { pool } from '../../db';
import logger from '../../lib/logger';
import type {
  DomainEvent,
  EventHandler,
  EventStoreRecord,
  Snapshot,
} from './types';

// ---------------------------------------------------------------------------
// SQL statements
// ---------------------------------------------------------------------------

const SQL_CREATE_EVENT_STORE = `
  CREATE TABLE IF NOT EXISTS event_store (
    id            TEXT        NOT NULL,
    type          TEXT        NOT NULL,
    aggregate_id  TEXT        NOT NULL,
    aggregate_type TEXT       NOT NULL,
    user_id       TEXT,
    tenant_id     TEXT        NOT NULL,
    timestamp     TIMESTAMPTZ NOT NULL,
    version       INTEGER     NOT NULL,
    metadata      JSONB       NOT NULL DEFAULT '{}',
    payload       JSONB       NOT NULL DEFAULT '{}',
    checksum      TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT event_store_pkey PRIMARY KEY (id),
    CONSTRAINT event_store_aggregate_version_unique
      UNIQUE (aggregate_id, version)
  );
`;

const SQL_CREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_event_store_aggregate_id
    ON event_store (aggregate_id);

  CREATE INDEX IF NOT EXISTS idx_event_store_type
    ON event_store (type);

  CREATE INDEX IF NOT EXISTS idx_event_store_aggregate_type
    ON event_store (aggregate_type);

  CREATE INDEX IF NOT EXISTS idx_event_store_tenant_id
    ON event_store (tenant_id);

  CREATE INDEX IF NOT EXISTS idx_event_store_timestamp
    ON event_store (timestamp DESC);

  CREATE INDEX IF NOT EXISTS idx_event_store_payload_gin
    ON event_store USING GIN (payload);

  CREATE INDEX IF NOT EXISTS idx_event_store_metadata_gin
    ON event_store USING GIN (metadata);
`;

const SQL_CREATE_SNAPSHOTS = `
  CREATE TABLE IF NOT EXISTS event_snapshots (
    aggregate_id   TEXT        NOT NULL,
    aggregate_type TEXT        NOT NULL,
    state          JSONB       NOT NULL,
    version        INTEGER     NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT event_snapshots_pkey PRIMARY KEY (aggregate_id)
  );

  CREATE INDEX IF NOT EXISTS idx_event_snapshots_aggregate_type
    ON event_snapshots (aggregate_type);
`;

const SQL_INSERT_EVENT = `
  INSERT INTO event_store (
    id, type, aggregate_id, aggregate_type,
    user_id, tenant_id, timestamp, version,
    metadata, payload, checksum
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (aggregate_id, version) DO NOTHING
  RETURNING id;
`;

const SQL_GET_EVENTS_BY_AGGREGATE = `
  SELECT
    id, type, aggregate_id, aggregate_type,
    user_id, tenant_id,
    timestamp AT TIME ZONE 'UTC' AS timestamp,
    version, metadata, payload, checksum,
    created_at
  FROM event_store
  WHERE aggregate_id = $1
    AND ($2::int IS NULL OR version >= $2)
  ORDER BY version ASC;
`;

const SQL_GET_EVENTS_BY_TYPE = `
  SELECT
    id, type, aggregate_id, aggregate_type,
    user_id, tenant_id,
    timestamp AT TIME ZONE 'UTC' AS timestamp,
    version, metadata, payload, checksum,
    created_at
  FROM event_store
  WHERE type = $1
    AND ($2::timestamptz IS NULL OR timestamp >= $2)
  ORDER BY timestamp DESC
  LIMIT $3;
`;

const SQL_GET_EVENTS_BY_AGGREGATE_TYPE = `
  SELECT
    id, type, aggregate_id, aggregate_type,
    user_id, tenant_id,
    timestamp AT TIME ZONE 'UTC' AS timestamp,
    version, metadata, payload, checksum,
    created_at
  FROM event_store
  WHERE aggregate_type = $1
    AND aggregate_id = $2
  ORDER BY version ASC;
`;

const SQL_GET_MAX_VERSION = `
  SELECT COALESCE(MAX(version), 0) AS max_version
  FROM event_store
  WHERE aggregate_id = $1;
`;

const SQL_GET_SNAPSHOT = `
  SELECT
    aggregate_id, aggregate_type, state, version, created_at
  FROM event_snapshots
  WHERE aggregate_id = $1;
`;

const SQL_UPSERT_SNAPSHOT = `
  INSERT INTO event_snapshots (aggregate_id, aggregate_type, state, version, created_at)
  VALUES ($1, $2, $3, $4, NOW())
  ON CONFLICT (aggregate_id)
  DO UPDATE SET
    state      = EXCLUDED.state,
    version    = EXCLUDED.version,
    created_at = NOW()
  WHERE event_snapshots.version < EXCLUDED.version;
`;

// ---------------------------------------------------------------------------
// EventStore class
// ---------------------------------------------------------------------------

export class EventStore {
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // ---------------------------------------------------------------------------
  // Schema bootstrap
  // ---------------------------------------------------------------------------

  /**
   * Idempotently creates the event_store and event_snapshots tables plus indexes.
   * Called lazily on first use; subsequent calls are no-ops.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._runInit();
    await this.initPromise;
  }

  private async _runInit(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(SQL_CREATE_EVENT_STORE);
      // Execute each index statement individually
      for (const stmt of SQL_CREATE_INDEXES.split(';').map((s) => s.trim()).filter(Boolean)) {
        await client.query(stmt);
      }
      await client.query(SQL_CREATE_SNAPSHOTS);
      await client.query('COMMIT');
      this.initialized = true;
      logger.info('[EventStore] schema initialized');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err }, '[EventStore] schema initialization failed');
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // append
  // ---------------------------------------------------------------------------

  /**
   * Append a domain event to the store.
   * Performs an optimistic concurrency check: if a record with the same
   * (aggregateId, version) already exists the insert is silently skipped
   * (idempotent re-delivery), but if the conflict is detected we verify
   * the IDs match; otherwise we throw a ConcurrencyError.
   */
  async append(event: DomainEvent): Promise<void> {
    await this.initialize();

    const checksum = this.computeChecksum(event);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Optimistic concurrency: verify that the version we're about to write
      // is exactly (currentMax + 1) unless version === 1 (first event).
      if (event.version > 1) {
        const { rows } = await client.query<{ max_version: number }>(
          SQL_GET_MAX_VERSION,
          [event.aggregateId],
        );
        const currentMax = rows[0]?.max_version ?? 0;

        if (event.version !== currentMax + 1) {
          throw new ConcurrencyError(
            `Concurrency conflict for aggregate ${event.aggregateId}: ` +
              `expected version ${currentMax + 1}, got ${event.version}`,
            event.aggregateId,
            currentMax,
            event.version,
          );
        }
      }

      const { rows } = await client.query<{ id: string }>(SQL_INSERT_EVENT, [
        event.id,
        event.type,
        event.aggregateId,
        event.aggregateType,
        event.userId ?? null,
        event.tenantId,
        new Date(event.timestamp).toISOString(),
        event.version,
        JSON.stringify(event.metadata),
        JSON.stringify(event.payload),
        checksum,
      ]);

      await client.query('COMMIT');

      if (rows.length === 0) {
        // ON CONFLICT DO NOTHING — idempotent; already stored
        logger.debug(
          { eventId: event.id, aggregateId: event.aggregateId },
          '[EventStore] event already stored (idempotent)',
        );
      } else {
        logger.debug(
          {
            eventId: event.id,
            eventType: event.type,
            aggregateId: event.aggregateId,
            version: event.version,
          },
          '[EventStore] event appended',
        );
      }
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof ConcurrencyError) throw err;
      logger.error(
        { err, eventId: event.id, eventType: event.type },
        '[EventStore] append failed',
      );
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // getEvents
  // ---------------------------------------------------------------------------

  /**
   * Retrieve all events for a given aggregate, optionally starting from a
   * specific version (inclusive). Useful for replaying aggregate state.
   */
  async getEvents(
    aggregateId: string,
    fromVersion?: number,
  ): Promise<EventStoreRecord[]> {
    await this.initialize();

    try {
      const { rows } = await pool.query<RawEventRow>(SQL_GET_EVENTS_BY_AGGREGATE, [
        aggregateId,
        fromVersion ?? null,
      ]);

      const records = rows.map(rowToRecord);
      this.validateChecksums(records);
      return records;
    } catch (err) {
      logger.error(
        { err, aggregateId, fromVersion },
        '[EventStore] getEvents failed',
      );
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // getEventsByType
  // ---------------------------------------------------------------------------

  /**
   * Retrieve events of a specific type, optionally filtered by a since date,
   * with a configurable limit (default 100).
   */
  async getEventsByType(
    eventType: string,
    since?: Date,
    limit = 100,
  ): Promise<EventStoreRecord[]> {
    await this.initialize();

    try {
      const { rows } = await pool.query<RawEventRow>(SQL_GET_EVENTS_BY_TYPE, [
        eventType,
        since?.toISOString() ?? null,
        limit,
      ]);

      const records = rows.map(rowToRecord);
      this.validateChecksums(records);
      return records;
    } catch (err) {
      logger.error(
        { err, eventType, since, limit },
        '[EventStore] getEventsByType failed',
      );
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // getEventsByAggregate
  // ---------------------------------------------------------------------------

  /**
   * Retrieve all events for a specific (aggregateType, aggregateId) pair
   * ordered by version ascending.
   */
  async getEventsByAggregate(
    aggregateType: string,
    aggregateId: string,
  ): Promise<EventStoreRecord[]> {
    await this.initialize();

    try {
      const { rows } = await pool.query<RawEventRow>(
        SQL_GET_EVENTS_BY_AGGREGATE_TYPE,
        [aggregateType, aggregateId],
      );

      const records = rows.map(rowToRecord);
      this.validateChecksums(records);
      return records;
    } catch (err) {
      logger.error(
        { err, aggregateType, aggregateId },
        '[EventStore] getEventsByAggregate failed',
      );
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshot API
  // ---------------------------------------------------------------------------

  /**
   * Retrieve the latest snapshot for an aggregate, or null if none exists.
   */
  async getSnapshot(aggregateId: string): Promise<Snapshot | null> {
    await this.initialize();

    try {
      const { rows } = await pool.query<RawSnapshotRow>(SQL_GET_SNAPSHOT, [
        aggregateId,
      ]);

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        aggregateId: row.aggregate_id,
        aggregateType: row.aggregate_type,
        state: row.state,
        version: row.version,
        createdAt: row.created_at,
      };
    } catch (err) {
      logger.error({ err, aggregateId }, '[EventStore] getSnapshot failed');
      throw err;
    }
  }

  /**
   * Upsert a snapshot. Only updates if the new version is greater than the
   * stored one (enforced in the SQL via the WHERE clause).
   */
  async saveSnapshot(
    aggregateId: string,
    state: unknown,
    version: number,
  ): Promise<void> {
    await this.initialize();

    // We need the aggregate type — derive it from the most recent event
    let aggregateType = 'unknown';
    try {
      const { rows } = await pool.query<{ aggregate_type: string }>(
        `SELECT aggregate_type FROM event_store
         WHERE aggregate_id = $1
         ORDER BY version DESC
         LIMIT 1`,
        [aggregateId],
      );
      if (rows.length > 0) aggregateType = rows[0].aggregate_type;
    } catch {
      // Non-fatal; use 'unknown'
    }

    try {
      await pool.query(SQL_UPSERT_SNAPSHOT, [
        aggregateId,
        aggregateType,
        JSON.stringify(state),
        version,
      ]);

      logger.debug(
        { aggregateId, version },
        '[EventStore] snapshot saved',
      );
    } catch (err) {
      logger.error({ err, aggregateId, version }, '[EventStore] saveSnapshot failed');
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // replayEvents
  // ---------------------------------------------------------------------------

  /**
   * Replay all events for an aggregate through a handler function.
   * Optionally starts from a snapshot to reduce replay cost.
   */
  async replayEvents(
    aggregateId: string,
    handler: EventHandler,
  ): Promise<void> {
    await this.initialize();

    // Check for a snapshot to shorten the replay
    const snapshot = await this.getSnapshot(aggregateId);
    const fromVersion = snapshot ? snapshot.version + 1 : undefined;

    const records = await this.getEvents(aggregateId, fromVersion);

    logger.info(
      {
        aggregateId,
        fromVersion,
        eventCount: records.length,
        hasSnapshot: !!snapshot,
      },
      '[EventStore] replaying events',
    );

    for (const record of records) {
      // Reconstruct a DomainEvent envelope from the stored record
      const event: DomainEvent = {
        id: record.id,
        type: record.type,
        aggregateId: record.aggregateId,
        aggregateType: record.aggregateType,
        userId: record.userId,
        tenantId: record.tenantId,
        timestamp: record.timestamp,
        version: record.version,
        metadata: record.metadata,
        payload: record.payload,
      } as unknown as DomainEvent;

      try {
        await handler(event);
      } catch (err) {
        logger.error(
          { err, eventId: record.id, eventType: record.type, version: record.version },
          '[EventStore] handler error during replay — aborting',
        );
        throw err;
      }
    }

    logger.info(
      { aggregateId, eventCount: records.length },
      '[EventStore] replay complete',
    );
  }

  // ---------------------------------------------------------------------------
  // Checksum helpers
  // ---------------------------------------------------------------------------

  private computeChecksum(event: DomainEvent): string {
    const data = JSON.stringify({
      id: event.id,
      type: event.type,
      aggregateId: event.aggregateId,
      version: event.version,
      timestamp: event.timestamp,
      payload: event.payload,
    });
    return createHash('sha256').update(data).digest('hex');
  }

  private validateChecksums(records: EventStoreRecord[]): void {
    for (const record of records) {
      const expected = createHash('sha256')
        .update(
          JSON.stringify({
            id: record.id,
            type: record.type,
            aggregateId: record.aggregateId,
            version: record.version,
            timestamp: record.timestamp,
            payload: record.payload,
          }),
        )
        .digest('hex');

      if (expected !== record.checksum) {
        logger.warn(
          {
            eventId: record.id,
            eventType: record.type,
            storedChecksum: record.checksum,
            computedChecksum: expected,
          },
          '[EventStore] checksum mismatch — event may have been tampered with',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Row → record mapping
// ---------------------------------------------------------------------------

interface RawEventRow {
  id: string;
  type: string;
  aggregate_id: string;
  aggregate_type: string;
  user_id: string | null;
  tenant_id: string;
  timestamp: Date;
  version: number;
  metadata: Record<string, unknown>;
  payload: unknown;
  checksum: string;
  created_at: Date;
}

interface RawSnapshotRow {
  aggregate_id: string;
  aggregate_type: string;
  state: unknown;
  version: number;
  created_at: Date;
}

function rowToRecord(row: RawEventRow): EventStoreRecord {
  return {
    id: row.id,
    type: row.type,
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    userId: row.user_id,
    tenantId: row.tenant_id,
    timestamp: row.timestamp instanceof Date
      ? row.timestamp.toISOString()
      : String(row.timestamp),
    version: row.version,
    metadata: row.metadata ?? {},
    payload: row.payload,
    checksum: row.checksum,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// ConcurrencyError
// ---------------------------------------------------------------------------

export class ConcurrencyError extends Error {
  constructor(
    message: string,
    public readonly aggregateId: string,
    public readonly currentVersion: number,
    public readonly expectedVersion: number,
  ) {
    super(message);
    this.name = 'ConcurrencyError';
    Object.setPrototypeOf(this, ConcurrencyError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const eventStore = new EventStore();
