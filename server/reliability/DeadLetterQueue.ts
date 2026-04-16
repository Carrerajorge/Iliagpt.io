/**
 * DeadLetterQueue — Persists failed tasks to a PostgreSQL DLQ table for
 * later inspection, retry, or alerting.
 *
 * Schema (auto-created on first use):
 *   dlq_entries (id, task_id, queue_name, payload, error_message, error_stack,
 *                attempts, created_at, last_attempt_at, status)
 *
 * Features:
 *   - Upserts on task_id so repeated failures accumulate attempt count
 *   - In-memory buffer fallback when DB is unavailable
 *   - `retry()` moves entries back to 'pending' for reprocessing
 *   - `purge()` clears entries older than N days
 *   - Exposes count/list/get for admin tooling
 */

import { Logger } from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DLQEntry {
  taskId       : string;
  queueName    : string;
  payload      : Record<string, unknown>;
  errorMessage : string;
  errorStack?  : string;
  attempts     : number;
  createdAt    : Date;
  lastAttemptAt: Date;
  status       : 'failed' | 'pending_retry' | 'resolved';
}

type DLQRow = {
  task_id        : string;
  queue_name     : string;
  payload        : string;
  error_message  : string;
  error_stack?   : string;
  attempts       : number;
  created_at     : Date;
  last_attempt_at: Date;
  status         : string;
};

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getDb() {
  const { db } = await import('../db');
  return db;
}

// ─── Main class ───────────────────────────────────────────────────────────────

class DeadLetterQueueService {
  private initialized   = false;
  private readonly memBuffer: DLQEntry[] = [];
  private readonly MAX_BUFFER = 500;

  // ── Schema bootstrap ─────────────────────────────────────────────────────────

  async init(): Promise<void> {
    try {
      const db = await getDb();
      await db.query(`
        CREATE TABLE IF NOT EXISTS dlq_entries (
          task_id          TEXT PRIMARY KEY,
          queue_name       TEXT        NOT NULL,
          payload          JSONB       NOT NULL DEFAULT '{}',
          error_message    TEXT        NOT NULL,
          error_stack      TEXT,
          attempts         INTEGER     NOT NULL DEFAULT 1,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          status           TEXT        NOT NULL DEFAULT 'failed'
        );
        CREATE INDEX IF NOT EXISTS dlq_queue_status ON dlq_entries (queue_name, status);
        CREATE INDEX IF NOT EXISTS dlq_created      ON dlq_entries (created_at DESC);
      `);
      this.initialized = true;
      Logger.info('[DLQ] table ready');

      // Flush any buffered entries
      if (this.memBuffer.length > 0) {
        const buffered = [...this.memBuffer];
        this.memBuffer.length = 0;
        for (const entry of buffered) await this._insertOrUpdate(entry);
      }
    } catch (err) {
      Logger.warn('[DLQ] DB init failed — using in-memory buffer', { error: (err as Error).message });
    }
  }

  // ── Push a failed task ───────────────────────────────────────────────────────

  async push(
    taskId   : string,
    queueName: string,
    payload  : Record<string, unknown>,
    error    : Error,
  ): Promise<void> {
    const entry: DLQEntry = {
      taskId,
      queueName,
      payload,
      errorMessage  : error.message,
      errorStack    : error.stack,
      attempts      : 1,
      createdAt     : new Date(),
      lastAttemptAt : new Date(),
      status        : 'failed',
    };

    if (!this.initialized) {
      if (this.memBuffer.length < this.MAX_BUFFER) {
        this.memBuffer.push(entry);
      } else {
        Logger.warn('[DLQ] in-memory buffer full — dropping DLQ entry', { taskId });
      }
      return;
    }

    await this._insertOrUpdate(entry);
  }

  // ── Query ────────────────────────────────────────────────────────────────────

  async list(queueName?: string, limit = 50): Promise<DLQEntry[]> {
    if (!this.initialized) return this.memBuffer.slice(0, limit);

    try {
      const db = await getDb();
      const where = queueName ? `WHERE queue_name = $1 ORDER BY last_attempt_at DESC LIMIT $2` : `ORDER BY last_attempt_at DESC LIMIT $1`;
      const params = queueName ? [queueName, limit] : [limit];
      const res = await db.query<DLQRow>(`SELECT * FROM dlq_entries ${where}`, params);
      return res.rows.map(this._rowToEntry);
    } catch (err) {
      Logger.warn('[DLQ] list failed', { error: (err as Error).message });
      return [];
    }
  }

  async count(queueName?: string): Promise<number> {
    if (!this.initialized) return this.memBuffer.length;

    try {
      const db = await getDb();
      const res = queueName
        ? await db.query<{ count: string }>(`SELECT COUNT(*) FROM dlq_entries WHERE queue_name = $1 AND status = 'failed'`, [queueName])
        : await db.query<{ count: string }>(`SELECT COUNT(*) FROM dlq_entries WHERE status = 'failed'`);
      return parseInt(res.rows[0]?.count ?? '0', 10);
    } catch { return 0; }
  }

  async retry(taskId: string): Promise<boolean> {
    if (!this.initialized) return false;

    try {
      const db = await getDb();
      const res = await db.query(
        `UPDATE dlq_entries SET status = 'pending_retry' WHERE task_id = $1 RETURNING task_id`,
        [taskId],
      );
      return (res.rowCount ?? 0) > 0;
    } catch { return false; }
  }

  async resolve(taskId: string): Promise<boolean> {
    if (!this.initialized) return false;

    try {
      const db = await getDb();
      const res = await db.query(
        `UPDATE dlq_entries SET status = 'resolved' WHERE task_id = $1 RETURNING task_id`,
        [taskId],
      );
      return (res.rowCount ?? 0) > 0;
    } catch { return false; }
  }

  async purge(olderThanDays = 30): Promise<number> {
    if (!this.initialized) return 0;

    try {
      const db = await getDb();
      const res = await db.query(
        `DELETE FROM dlq_entries WHERE created_at < NOW() - INTERVAL '${olderThanDays} days' AND status = 'resolved'`,
      );
      const deleted = res.rowCount ?? 0;
      Logger.info('[DLQ] purged old resolved entries', { deleted, olderThanDays });
      return deleted;
    } catch { return 0; }
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async _insertOrUpdate(entry: DLQEntry): Promise<void> {
    try {
      const db = await getDb();
      await db.query(`
        INSERT INTO dlq_entries
          (task_id, queue_name, payload, error_message, error_stack, attempts, created_at, last_attempt_at, status)
        VALUES ($1, $2, $3, $4, $5, 1, NOW(), NOW(), 'failed')
        ON CONFLICT (task_id) DO UPDATE
          SET attempts        = dlq_entries.attempts + 1,
              error_message   = EXCLUDED.error_message,
              error_stack     = EXCLUDED.error_stack,
              last_attempt_at = NOW(),
              status          = 'failed'
      `, [
        entry.taskId,
        entry.queueName,
        JSON.stringify(entry.payload),
        entry.errorMessage,
        entry.errorStack ?? null,
      ]);
    } catch (err) {
      Logger.warn('[DLQ] insert/update failed', { taskId: entry.taskId, error: (err as Error).message });
    }
  }

  private _rowToEntry(row: DLQRow): DLQEntry {
    return {
      taskId       : row.task_id,
      queueName    : row.queue_name,
      payload      : typeof row.payload === 'string' ? JSON.parse(row.payload) as Record<string, unknown> : row.payload as unknown as Record<string, unknown>,
      errorMessage : row.error_message,
      errorStack   : row.error_stack,
      attempts     : row.attempts,
      createdAt    : row.created_at,
      lastAttemptAt: row.last_attempt_at,
      status       : row.status as DLQEntry['status'],
    };
  }
}

export const deadLetterQueue = new DeadLetterQueueService();
