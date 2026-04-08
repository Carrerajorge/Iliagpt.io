import { createLogger } from '../../utils/logger';

const log = createLogger('openclaw-tasks');

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS openclaw_tasks (
  id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(50) NOT NULL DEFAULT 'subagent',
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  objective TEXT,
  result TEXT,
  error TEXT,
  user_id VARCHAR(255),
  parent_run_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_openclaw_tasks_status ON openclaw_tasks(status);
CREATE INDEX IF NOT EXISTS idx_openclaw_tasks_user ON openclaw_tasks(user_id);
`;

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    const { db } = await import('../../db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql.raw(ENSURE_TABLE_SQL));
    tableEnsured = true;
  } catch (e) {
    log.warn('Could not ensure openclaw_tasks table', { error: (e as Error).message });
  }
}

export async function persistTask(task: {
  id: string;
  status: string;
  objective?: string;
  userId?: string;
  parentRunId?: string;
}): Promise<void> {
  await ensureTable();
  try {
    const { db } = await import('../../db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      INSERT INTO openclaw_tasks (id, status, objective, user_id, parent_run_id)
      VALUES (${task.id}, ${task.status}, ${task.objective || null}, ${task.userId || null}, ${task.parentRunId || null})
      ON CONFLICT (id) DO UPDATE SET status = ${task.status}
    `);
  } catch (e) {
    log.warn('Task persist failed (non-blocking)', { error: (e as Error).message });
  }
}

export async function updateTaskStatus(
  id: string,
  status: string,
  result?: string,
  error?: string,
): Promise<void> {
  await ensureTable();
  try {
    const { db } = await import('../../db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      UPDATE openclaw_tasks SET
        status = ${status},
        result = ${result || null},
        error = ${error || null},
        completed_at = CASE WHEN ${status} IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE completed_at END
      WHERE id = ${id}
    `);
  } catch (e) {
    log.warn('Task status update failed (non-blocking)', { error: (e as Error).message });
  }
}

export async function getRecentTasks(userId?: string, limit: number = 20): Promise<any[]> {
  await ensureTable();
  try {
    const { db } = await import('../../db');
    const { sql } = await import('drizzle-orm');
    if (userId) {
      const result = await db.execute(
        sql`SELECT * FROM openclaw_tasks WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}`,
      );
      return (result as any).rows || [];
    }
    const result = await db.execute(
      sql`SELECT * FROM openclaw_tasks ORDER BY created_at DESC LIMIT ${limit}`,
    );
    return (result as any).rows || [];
  } catch {
    return [];
  }
}
