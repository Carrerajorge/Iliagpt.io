/**
 * AgentCheckpoint — Serialise and restore complete agent state.
 *
 * Saves checkpoints to PostgreSQL JSONB with versioning,
 * garbage collection of old checkpoints, and export/import.
 */

import { randomUUID } from "crypto";
import { Logger } from "../lib/logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import type { HierarchicalPlan, PlanStep } from "./AgentPlannerWithThinking";
import type { ReflectionEntry } from "./SelfReflectingAgent";
import type { AgentCostSummary } from "./ClaudeAgentBackbone";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface AgentStateSnapshot {
  sessionId: string;
  userId: string;
  chatId: string;
  taskGoal: string;
  plan?: HierarchicalPlan;
  currentStepIndex: number;
  completedStepIds: string[];
  failedStepIds: string[];
  memory: Record<string, unknown>;
  partialResults: Record<string, unknown>;
  toolHistory: ToolHistoryEntry[];
  reflections: ReflectionEntry[];
  cost: AgentCostSummary;
  iterationCount: number;
  conversationHistory: unknown[]; // MessageParam[]
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface ToolHistoryEntry {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  success: boolean;
  timestamp: Date;
  latencyMs: number;
}

export interface CheckpointRecord {
  id: string;
  sessionId: string;
  userId: string;
  version: number;
  snapshot: AgentStateSnapshot;
  checkpointedAt: Date;
  label?: string;
  sizeBytes: number;
}

export interface CheckpointRestoreResult {
  record: CheckpointRecord;
  snapshot: AgentStateSnapshot;
}

// ─── DDL helper (run once at startup or migration) ────────────────────────────
export const CHECKPOINT_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  snapshot     JSONB NOT NULL,
  label        TEXT,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  checkpointed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_session
  ON agent_checkpoints (session_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_agent_checkpoints_user
  ON agent_checkpoints (user_id, checkpointed_at DESC);
`;

// ─── AgentCheckpoint ───────────────────────────────────────────────────────────
export class AgentCheckpoint {
  private readonly maxVersionsPerSession: number;
  private readonly gcOlderThanDays: number;

  constructor(options: { maxVersionsPerSession?: number; gcOlderThanDays?: number } = {}) {
    this.maxVersionsPerSession = options.maxVersionsPerSession ?? 10;
    this.gcOlderThanDays = options.gcOlderThanDays ?? 7;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Save a checkpoint and return the checkpoint record. */
  async save(snapshot: AgentStateSnapshot, label?: string): Promise<CheckpointRecord> {
    const id = randomUUID();
    const serialised = JSON.stringify(snapshot);
    const sizeBytes = Buffer.byteLength(serialised, "utf8");

    // Determine next version for this session
    const versionRow = await db.execute(sql`
      SELECT COALESCE(MAX(version), 0) + 1 AS next_version
      FROM agent_checkpoints
      WHERE session_id = ${snapshot.sessionId}
    `);
    const version = Number((versionRow.rows[0] as any)?.next_version ?? 1);

    await db.execute(sql`
      INSERT INTO agent_checkpoints (id, session_id, user_id, version, snapshot, label, size_bytes, checkpointed_at)
      VALUES (
        ${id},
        ${snapshot.sessionId},
        ${snapshot.userId},
        ${version},
        ${serialised}::jsonb,
        ${label ?? null},
        ${sizeBytes},
        NOW()
      )
    `);

    Logger.info("[AgentCheckpoint] Checkpoint saved", {
      id,
      sessionId: snapshot.sessionId,
      version,
      sizeBytes,
      label,
    });

    // Prune old versions for this session
    await this.pruneOldVersions(snapshot.sessionId);

    return {
      id,
      sessionId: snapshot.sessionId,
      userId: snapshot.userId,
      version,
      snapshot,
      checkpointedAt: new Date(),
      label,
      sizeBytes,
    };
  }

  /** Restore the latest checkpoint for a session. */
  async restoreLatest(sessionId: string): Promise<CheckpointRestoreResult | null> {
    const rows = await db.execute(sql`
      SELECT id, session_id, user_id, version, snapshot, label, size_bytes, checkpointed_at
      FROM agent_checkpoints
      WHERE session_id = ${sessionId}
      ORDER BY version DESC
      LIMIT 1
    `);

    if (rows.rows.length === 0) return null;

    return this.rowToResult(rows.rows[0] as any);
  }

  /** Restore a specific checkpoint version for a session. */
  async restoreVersion(sessionId: string, version: number): Promise<CheckpointRestoreResult | null> {
    const rows = await db.execute(sql`
      SELECT id, session_id, user_id, version, snapshot, label, size_bytes, checkpointed_at
      FROM agent_checkpoints
      WHERE session_id = ${sessionId} AND version = ${version}
      LIMIT 1
    `);

    if (rows.rows.length === 0) return null;
    return this.rowToResult(rows.rows[0] as any);
  }

  /** Restore by checkpoint id. */
  async restoreById(checkpointId: string): Promise<CheckpointRestoreResult | null> {
    const rows = await db.execute(sql`
      SELECT id, session_id, user_id, version, snapshot, label, size_bytes, checkpointed_at
      FROM agent_checkpoints
      WHERE id = ${checkpointId}
      LIMIT 1
    `);

    if (rows.rows.length === 0) return null;
    return this.rowToResult(rows.rows[0] as any);
  }

  /** List all checkpoint versions for a session. */
  async list(sessionId: string): Promise<Omit<CheckpointRecord, "snapshot">[]> {
    const rows = await db.execute(sql`
      SELECT id, session_id, user_id, version, label, size_bytes, checkpointed_at
      FROM agent_checkpoints
      WHERE session_id = ${sessionId}
      ORDER BY version DESC
    `);

    return rows.rows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      version: row.version,
      label: row.label,
      sizeBytes: row.size_bytes,
      checkpointedAt: new Date(row.checkpointed_at),
      snapshot: undefined as any, // not loaded in list
    }));
  }

  /** Delete a specific checkpoint. */
  async delete(checkpointId: string): Promise<boolean> {
    const result = await db.execute(sql`
      DELETE FROM agent_checkpoints WHERE id = ${checkpointId}
    `);
    return (result.rowCount ?? 0) > 0;
  }

  /** Delete all checkpoints for a session. */
  async deleteSession(sessionId: string): Promise<number> {
    const result = await db.execute(sql`
      DELETE FROM agent_checkpoints WHERE session_id = ${sessionId}
    `);
    const count = result.rowCount ?? 0;
    Logger.info("[AgentCheckpoint] Session checkpoints deleted", { sessionId, count });
    return count;
  }

  /** Run garbage collection — remove checkpoints older than gcOlderThanDays. */
  async gc(): Promise<number> {
    const result = await db.execute(sql`
      DELETE FROM agent_checkpoints
      WHERE checkpointed_at < NOW() - INTERVAL '${sql.raw(String(this.gcOlderThanDays))} days'
    `);
    const count = result.rowCount ?? 0;
    if (count > 0) {
      Logger.info("[AgentCheckpoint] GC complete", { deletedCount: count, olderThanDays: this.gcOlderThanDays });
    }
    return count;
  }

  /** Export a snapshot as a JSON string (for cross-instance transfer). */
  export(snapshot: AgentStateSnapshot): string {
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), snapshot });
  }

  /** Import a snapshot from an exported JSON string. */
  import(exported: string): AgentStateSnapshot {
    const parsed = JSON.parse(exported);
    if (parsed.version !== 1 || !parsed.snapshot) {
      throw new Error("Invalid checkpoint export format");
    }
    return this.hydrateSnapshot(parsed.snapshot);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async pruneOldVersions(sessionId: string): Promise<void> {
    await db.execute(sql`
      DELETE FROM agent_checkpoints
      WHERE session_id = ${sessionId}
        AND version NOT IN (
          SELECT version FROM agent_checkpoints
          WHERE session_id = ${sessionId}
          ORDER BY version DESC
          LIMIT ${this.maxVersionsPerSession}
        )
    `);
  }

  private rowToResult(row: any): CheckpointRestoreResult {
    const rawSnapshot = typeof row.snapshot === "string" ? JSON.parse(row.snapshot) : row.snapshot;
    const snapshot = this.hydrateSnapshot(rawSnapshot);

    const record: CheckpointRecord = {
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      version: row.version,
      snapshot,
      checkpointedAt: new Date(row.checkpointed_at),
      label: row.label,
      sizeBytes: row.size_bytes,
    };

    Logger.info("[AgentCheckpoint] Checkpoint restored", {
      id: record.id,
      sessionId: record.sessionId,
      version: record.version,
    });

    return { record, snapshot };
  }

  /** Rehydrate Date fields that get serialised as strings. */
  private hydrateSnapshot(raw: any): AgentStateSnapshot {
    return {
      ...raw,
      createdAt: new Date(raw.createdAt),
      toolHistory: (raw.toolHistory ?? []).map((t: any) => ({
        ...t,
        timestamp: new Date(t.timestamp),
      })),
      reflections: (raw.reflections ?? []).map((r: any) => ({
        ...r,
        timestamp: new Date(r.timestamp),
      })),
      plan: raw.plan
        ? {
            ...raw.plan,
            createdAt: new Date(raw.plan.createdAt),
          }
        : undefined,
    };
  }
}

// ─── Singleton convenience ─────────────────────────────────────────────────────
let _instance: AgentCheckpoint | null = null;
export function getCheckpointManager(): AgentCheckpoint {
  if (!_instance) _instance = new AgentCheckpoint();
  return _instance;
}
