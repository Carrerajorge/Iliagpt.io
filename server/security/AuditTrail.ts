import crypto from 'crypto';
import { Request, RequestHandler, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { pool } from '../db';
import logger from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuditOutcome = 'success' | 'failure' | 'error' | 'denied';

export interface AuditEntry {
  id: string;
  timestamp: Date;
  userId: string | null;
  tenantId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  outcome: AuditOutcome;
  metadata: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export interface AuditFilter {
  userId?: string;
  tenantId?: string;
  action?: string;
  resource?: string;
  outcome?: AuditOutcome;
  fromTime?: Date;
  toTime?: Date;
  limit?: number;
  offset?: number;
}

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface VerificationResult {
  valid: boolean;
  totalChecked: number;
  breaks: Array<{
    entryId: string;
    expectedHash: string;
    actualHash: string;
    timestamp: Date;
  }>;
}

export interface AuditStats {
  totalEvents: number;
  byAction: Array<{ action: string; count: number }>;
  byUser: Array<{ userId: string; count: number }>;
  byResource: Array<{ resource: string; count: number }>;
  byOutcome: Array<{ outcome: string; count: number }>;
  timeRange: TimeRange;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const AUDIT_REDIS_CHANNEL = 'audit:events';
const AUDIT_STREAM_MAX_LEN = 10_000; // cap stream length in Redis

const HMAC_KEY = process.env.AUDIT_HMAC_KEY;
if (!HMAC_KEY) {
  throw new Error('AUDIT_HMAC_KEY environment variable is required');
}

// ─── AuditTrail ───────────────────────────────────────────────────────────────

export class AuditTrail {
  private readonly db: Pool;
  private readonly redis: Redis;
  private readonly hmacKey: string;
  private initialized = false;

  constructor(db: Pool, redis: Redis) {
    this.db = db;
    this.redis = redis;
    this.hmacKey = HMAC_KEY!;
  }

  // ── Schema bootstrap ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_id       TEXT,
        tenant_id     TEXT,
        action        TEXT        NOT NULL,
        resource      TEXT        NOT NULL,
        resource_id   TEXT,
        ip            TEXT,
        user_agent    TEXT,
        outcome       TEXT        NOT NULL CHECK (outcome IN ('success','failure','error','denied')),
        metadata      JSONB       NOT NULL DEFAULT '{}',
        previous_hash TEXT        NOT NULL,
        hash          TEXT        NOT NULL UNIQUE,
        sequence_num  BIGSERIAL
      );

      CREATE INDEX IF NOT EXISTS audit_log_user_idx      ON audit_log (user_id);
      CREATE INDEX IF NOT EXISTS audit_log_tenant_idx    ON audit_log (tenant_id);
      CREATE INDEX IF NOT EXISTS audit_log_action_idx    ON audit_log (action);
      CREATE INDEX IF NOT EXISTS audit_log_resource_idx  ON audit_log (resource);
      CREATE INDEX IF NOT EXISTS audit_log_timestamp_idx ON audit_log (timestamp DESC);
      CREATE INDEX IF NOT EXISTS audit_log_outcome_idx   ON audit_log (outcome);
      CREATE INDEX IF NOT EXISTS audit_log_seq_idx       ON audit_log (sequence_num);
    `);

    this.initialized = true;
    logger.info('audit_log table ensured');
  }

  // ── Hash chain ────────────────────────────────────────────────────────────────

  private computeHash(entry: Omit<AuditEntry, 'hash'>): string {
    const payload = JSON.stringify({
      id: entry.id,
      timestamp: entry.timestamp.toISOString(),
      userId: entry.userId,
      tenantId: entry.tenantId,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
      ip: entry.ip,
      userAgent: entry.userAgent,
      outcome: entry.outcome,
      metadata: entry.metadata,
      previousHash: entry.previousHash,
    });

    return crypto
      .createHmac('sha256', this.hmacKey)
      .update(payload)
      .digest('hex');
  }

  private async getLastHash(): Promise<string> {
    const result = await this.db.query(
      `SELECT hash FROM audit_log ORDER BY sequence_num DESC LIMIT 1`,
    );
    return result.rows.length > 0 ? result.rows[0].hash : GENESIS_HASH;
  }

  // ── Core logging ──────────────────────────────────────────────────────────────

  async log(
    entry: Omit<AuditEntry, 'id' | 'timestamp' | 'previousHash' | 'hash'>,
  ): Promise<AuditEntry> {
    await this.initialize();

    const id = crypto.randomUUID();
    const timestamp = new Date();

    // Serialize access to hash chain — use advisory lock per tenant or global
    const client = await this.db.connect();
    let fullEntry: AuditEntry;

    try {
      // Advisory lock (session-level) to serialize hash chain writes
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('audit_chain'))`);
      await client.query('BEGIN');

      const previousHash = await this.getLastHash();

      const partialEntry: Omit<AuditEntry, 'hash'> = {
        id,
        timestamp,
        userId: entry.userId ?? null,
        tenantId: entry.tenantId ?? null,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        outcome: entry.outcome,
        metadata: entry.metadata ?? {},
        previousHash,
      };

      const hash = this.computeHash(partialEntry);
      fullEntry = { ...partialEntry, hash };

      await client.query(
        `INSERT INTO audit_log
           (id, timestamp, user_id, tenant_id, action, resource, resource_id,
            ip, user_agent, outcome, metadata, previous_hash, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          fullEntry.id,
          fullEntry.timestamp,
          fullEntry.userId,
          fullEntry.tenantId,
          fullEntry.action,
          fullEntry.resource,
          fullEntry.resourceId,
          fullEntry.ip,
          fullEntry.userAgent,
          fullEntry.outcome,
          JSON.stringify(fullEntry.metadata),
          fullEntry.previousHash,
          fullEntry.hash,
        ],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err }, 'Failed to write audit log entry');
      throw err;
    } finally {
      client.release();
    }

    // Stream to Redis for real-time monitoring (fire-and-forget)
    this.streamToRedis(fullEntry).catch((err) =>
      logger.error({ err }, 'Failed to stream audit entry to Redis'),
    );

    logger.info(
      {
        auditId: fullEntry.id,
        action: fullEntry.action,
        resource: fullEntry.resource,
        outcome: fullEntry.outcome,
        userId: fullEntry.userId,
      },
      'Audit event recorded',
    );

    return fullEntry;
  }

  private async streamToRedis(entry: AuditEntry): Promise<void> {
    const payload = JSON.stringify(entry);
    const pipeline = this.redis.pipeline();
    // Pub/Sub for real-time consumers
    pipeline.publish(AUDIT_REDIS_CHANNEL, payload);
    // Also append to a Redis Stream for replay capability
    pipeline.xadd(
      `audit:stream`,
      'MAXLEN',
      '~',
      String(AUDIT_STREAM_MAX_LEN),
      '*',
      'entry',
      payload,
    );
    await pipeline.exec();
  }

  // ── Verification ──────────────────────────────────────────────────────────────

  async verify(fromId?: string): Promise<VerificationResult> {
    await this.initialize();

    let query: string;
    let params: unknown[];

    if (fromId) {
      // Get the sequence number of the starting entry
      const startResult = await this.db.query(
        `SELECT sequence_num FROM audit_log WHERE id = $1`,
        [fromId],
      );
      if (startResult.rows.length === 0) {
        throw new Error(`Starting entry not found: ${fromId}`);
      }
      const startSeq = startResult.rows[0].sequence_num;
      query = `
        SELECT id, timestamp, user_id, tenant_id, action, resource, resource_id,
               ip, user_agent, outcome, metadata, previous_hash, hash, sequence_num
        FROM audit_log
        WHERE sequence_num >= $1
        ORDER BY sequence_num ASC
      `;
      params = [startSeq];
    } else {
      query = `
        SELECT id, timestamp, user_id, tenant_id, action, resource, resource_id,
               ip, user_agent, outcome, metadata, previous_hash, hash, sequence_num
        FROM audit_log
        ORDER BY sequence_num ASC
      `;
      params = [];
    }

    const result = await this.db.query(query, params);
    const rows = result.rows;
    const breaks: VerificationResult['breaks'] = [];

    for (const row of rows) {
      const entry: Omit<AuditEntry, 'hash'> = {
        id: row.id,
        timestamp: new Date(row.timestamp),
        userId: row.user_id,
        tenantId: row.tenant_id,
        action: row.action,
        resource: row.resource,
        resourceId: row.resource_id,
        ip: row.ip,
        userAgent: row.user_agent,
        outcome: row.outcome as AuditOutcome,
        metadata: row.metadata ?? {},
        previousHash: row.previous_hash,
      };

      const expectedHash = this.computeHash(entry);
      if (expectedHash !== row.hash) {
        breaks.push({
          entryId: row.id,
          expectedHash,
          actualHash: row.hash,
          timestamp: new Date(row.timestamp),
        });
      }
    }

    const valid = breaks.length === 0;
    logger.info({ totalChecked: rows.length, valid, breaks: breaks.length }, 'Audit chain verified');

    return { valid, totalChecked: rows.length, breaks };
  }

  // ── Query ─────────────────────────────────────────────────────────────────────

  async query(filter: AuditFilter): Promise<AuditEntry[]> {
    await this.initialize();

    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (filter.userId) {
      conditions.push(`user_id = $${p++}`);
      params.push(filter.userId);
    }
    if (filter.tenantId) {
      conditions.push(`tenant_id = $${p++}`);
      params.push(filter.tenantId);
    }
    if (filter.action) {
      conditions.push(`action = $${p++}`);
      params.push(filter.action);
    }
    if (filter.resource) {
      conditions.push(`resource = $${p++}`);
      params.push(filter.resource);
    }
    if (filter.outcome) {
      conditions.push(`outcome = $${p++}`);
      params.push(filter.outcome);
    }
    if (filter.fromTime) {
      conditions.push(`timestamp >= $${p++}`);
      params.push(filter.fromTime);
    }
    if (filter.toTime) {
      conditions.push(`timestamp <= $${p++}`);
      params.push(filter.toTime);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 100, 1000);
    const offset = filter.offset ?? 0;

    const result = await this.db.query(
      `SELECT id, timestamp, user_id, tenant_id, action, resource, resource_id,
              ip, user_agent, outcome, metadata, previous_hash, hash
       FROM audit_log
       ${where}
       ORDER BY timestamp DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, limit, offset],
    );

    return result.rows.map((row) => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      userId: row.user_id,
      tenantId: row.tenant_id,
      action: row.action,
      resource: row.resource,
      resourceId: row.resource_id,
      ip: row.ip,
      userAgent: row.user_agent,
      outcome: row.outcome as AuditOutcome,
      metadata: row.metadata ?? {},
      previousHash: row.previous_hash,
      hash: row.hash,
    }));
  }

  // ── Export ────────────────────────────────────────────────────────────────────

  async export(filter: AuditFilter, format: 'json' | 'csv'): Promise<string> {
    const entries = await this.query({ ...filter, limit: 10_000 });

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }

    // CSV
    const headers = [
      'id', 'timestamp', 'userId', 'tenantId', 'action', 'resource',
      'resourceId', 'ip', 'userAgent', 'outcome', 'metadata', 'hash',
    ];

    const escape = (val: unknown): string => {
      const str = val === null || val === undefined ? '' : String(
        typeof val === 'object' ? JSON.stringify(val) : val,
      );
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = entries.map((e) =>
      [
        e.id,
        e.timestamp.toISOString(),
        e.userId,
        e.tenantId,
        e.action,
        e.resource,
        e.resourceId,
        e.ip,
        e.userAgent,
        e.outcome,
        JSON.stringify(e.metadata),
        e.hash,
      ]
        .map(escape)
        .join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  async getStats(timeRange: TimeRange): Promise<AuditStats> {
    await this.initialize();

    const [totalResult, byActionResult, byUserResult, byResourceResult, byOutcomeResult] =
      await Promise.all([
        this.db.query(
          `SELECT COUNT(*) AS count FROM audit_log
           WHERE timestamp BETWEEN $1 AND $2`,
          [timeRange.from, timeRange.to],
        ),
        this.db.query(
          `SELECT action, COUNT(*) AS count FROM audit_log
           WHERE timestamp BETWEEN $1 AND $2
           GROUP BY action ORDER BY count DESC LIMIT 20`,
          [timeRange.from, timeRange.to],
        ),
        this.db.query(
          `SELECT user_id, COUNT(*) AS count FROM audit_log
           WHERE timestamp BETWEEN $1 AND $2 AND user_id IS NOT NULL
           GROUP BY user_id ORDER BY count DESC LIMIT 20`,
          [timeRange.from, timeRange.to],
        ),
        this.db.query(
          `SELECT resource, COUNT(*) AS count FROM audit_log
           WHERE timestamp BETWEEN $1 AND $2
           GROUP BY resource ORDER BY count DESC LIMIT 20`,
          [timeRange.from, timeRange.to],
        ),
        this.db.query(
          `SELECT outcome, COUNT(*) AS count FROM audit_log
           WHERE timestamp BETWEEN $1 AND $2
           GROUP BY outcome`,
          [timeRange.from, timeRange.to],
        ),
      ]);

    return {
      totalEvents: Number(totalResult.rows[0].count),
      byAction: byActionResult.rows.map((r) => ({ action: r.action, count: Number(r.count) })),
      byUser: byUserResult.rows.map((r) => ({ userId: r.user_id, count: Number(r.count) })),
      byResource: byResourceResult.rows.map((r) => ({
        resource: r.resource,
        count: Number(r.count),
      })),
      byOutcome: byOutcomeResult.rows.map((r) => ({
        outcome: r.outcome,
        count: Number(r.count),
      })),
      timeRange,
    };
  }

  // ── Express middleware ────────────────────────────────────────────────────────

  auditRequest(action: string, resource: string): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      // Capture the original res.end to hook into response completion
      const originalEnd = res.end.bind(res);

      const started = Date.now();
      const userId =
        (req as Request & { user?: { userId?: string } }).user?.userId ?? null;
      const tenantId =
        (req as Request & { user?: { tenantId?: string } }).user?.tenantId ?? null;
      const resourceId =
        (req.params?.id ?? req.params?.resourceId ?? null) as string | null;
      const ip = req.ip ?? req.socket?.remoteAddress ?? null;
      const userAgent = req.headers['user-agent'] ?? null;

      // Override res.end so we can log after response is sent
      (res as unknown as { end: typeof res.end }).end = function (
        this: Response,
        ...args: Parameters<typeof res.end>
      ) {
        const outcome: AuditOutcome =
          res.statusCode >= 500
            ? 'error'
            : res.statusCode === 403
            ? 'denied'
            : res.statusCode >= 400
            ? 'failure'
            : 'success';

        // Fire-and-forget audit log
        auditInstance
          .log({
            userId,
            tenantId,
            action,
            resource,
            resourceId,
            ip,
            userAgent,
            outcome,
            metadata: {
              method: req.method,
              path: req.path,
              statusCode: res.statusCode,
              durationMs: Date.now() - started,
            },
          })
          .catch((err) => logger.error({ err }, 'auditRequest middleware log failed'));

        return originalEnd(...args);
      };

      next();
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: AuditTrail | null = null;
let auditInstance: AuditTrail; // reference for middleware closure

export function getAuditTrail(redis?: Redis): AuditTrail {
  if (!_instance) {
    if (!redis) {
      throw new Error('Redis instance required for first initialization of AuditTrail');
    }
    _instance = new AuditTrail(pool, redis);
    auditInstance = _instance;
  }
  return _instance;
}

export default AuditTrail;
