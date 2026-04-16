import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import pino from "pino";

const logger = pino({ name: "AgentCheckpoint" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckpointTrigger =
  | "manual"
  | "pre_action"
  | "post_action"
  | "periodic"
  | "pre_risky_action"
  | "completion";

export interface AgentState {
  agentId: string;
  sessionId: string;
  goal: string;
  context: string;
  /** Current plan (HierarchicalPlan-compatible) */
  plan?: Record<string, unknown>;
  /** Completed step results */
  stepResults: Record<string, unknown>;
  /** Memory snapshots */
  memory?: {
    episodic?: unknown[];
    semantic?: unknown[];
    procedural?: unknown[];
    workingMemory?: Record<string, unknown>;
  };
  /** Conversation history */
  messages: Array<{ role: string; content: unknown }>;
  /** Custom key-value state */
  custom: Record<string, unknown>;
  /** Metadata for restoration */
  metadata: {
    toolCallCount: number;
    totalTokensUsed: number;
    totalCostUSD: number;
    startedAt: number;
    lastActionAt?: number;
  };
}

export interface CheckpointRecord {
  checkpointId: string;
  agentId: string;
  sessionId: string;
  version: number;
  trigger: CheckpointTrigger;
  stateHash: string; // SHA-256 of serialized state
  state: AgentState;
  sizeBytes: number;
  createdAt: number;
  /** If not null, this checkpoint was restored from */
  restoredFrom?: string;
  tags: string[];
  description?: string;
}

export interface RestoreResult {
  checkpoint: CheckpointRecord;
  state: AgentState;
  restoredAt: number;
  staleMsAgo: number; // how old the checkpoint is
}

export interface CheckpointQuery {
  agentId?: string;
  sessionId?: string;
  trigger?: CheckpointTrigger;
  tags?: string[];
  fromVersion?: number;
  toVersion?: number;
  limit?: number;
}

export interface CheckpointConfig {
  maxCheckpointsPerAgent?: number; // default 50 — prune oldest beyond this
  maxCheckpointsPerSession?: number; // default 20
  autoCheckpointIntervalMs?: number; // default 60_000 (1 minute)
  compressState?: boolean; // future: gzip JSONB
  persistenceDriver?: CheckpointPersistenceDriver;
}

// ─── Persistence interface ────────────────────────────────────────────────────

export interface CheckpointPersistenceDriver {
  save(record: CheckpointRecord): Promise<void>;
  load(checkpointId: string): Promise<CheckpointRecord | null>;
  loadLatest(agentId: string, sessionId?: string): Promise<CheckpointRecord | null>;
  loadAll(query: CheckpointQuery): Promise<CheckpointRecord[]>;
  delete(checkpointId: string): Promise<void>;
  deleteSession(agentId: string, sessionId: string): Promise<void>;
  count(agentId: string): Promise<number>;
}

// ─── In-memory driver (default) ───────────────────────────────────────────────

class InMemoryDriver implements CheckpointPersistenceDriver {
  private store = new Map<string, CheckpointRecord>();

  async save(record: CheckpointRecord): Promise<void> {
    this.store.set(record.checkpointId, record);
  }

  async load(checkpointId: string): Promise<CheckpointRecord | null> {
    return this.store.get(checkpointId) ?? null;
  }

  async loadLatest(
    agentId: string,
    sessionId?: string
  ): Promise<CheckpointRecord | null> {
    const records = Array.from(this.store.values())
      .filter(
        (r) =>
          r.agentId === agentId &&
          (!sessionId || r.sessionId === sessionId)
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    return records[0] ?? null;
  }

  async loadAll(query: CheckpointQuery): Promise<CheckpointRecord[]> {
    let records = Array.from(this.store.values());

    if (query.agentId) records = records.filter((r) => r.agentId === query.agentId);
    if (query.sessionId) records = records.filter((r) => r.sessionId === query.sessionId);
    if (query.trigger) records = records.filter((r) => r.trigger === query.trigger);
    if (query.tags?.length)
      records = records.filter((r) => query.tags!.some((t) => r.tags.includes(t)));
    if (query.fromVersion !== undefined)
      records = records.filter((r) => r.version >= query.fromVersion!);
    if (query.toVersion !== undefined)
      records = records.filter((r) => r.version <= query.toVersion!);

    records.sort((a, b) => b.createdAt - a.createdAt);
    return query.limit ? records.slice(0, query.limit) : records;
  }

  async delete(checkpointId: string): Promise<void> {
    this.store.delete(checkpointId);
  }

  async deleteSession(agentId: string, sessionId: string): Promise<void> {
    for (const [id, record] of this.store.entries()) {
      if (record.agentId === agentId && record.sessionId === sessionId) {
        this.store.delete(id);
      }
    }
  }

  async count(agentId: string): Promise<number> {
    return Array.from(this.store.values()).filter((r) => r.agentId === agentId).length;
  }
}

// ─── PostgreSQL driver (production) ───────────────────────────────────────────

export class PostgreSQLDriver implements CheckpointPersistenceDriver {
  private pool: unknown; // drizzle-orm or pg pool

  constructor(connectionString: string) {
    // Lazy import to avoid hard dependency
    logger.info("[PostgreSQLDriver] Configured for PostgreSQL persistence");
    this.pool = connectionString; // Store for lazy init
  }

  private async getPool() {
    if (typeof this.pool === "string") {
      // Lazy initialize actual pg pool
      const { default: pg } = await import("pg");
      this.pool = new pg.Pool({ connectionString: this.pool as string });
      await (this.pool as { query: (sql: string) => Promise<void> }).query(`
        CREATE TABLE IF NOT EXISTS agent_checkpoints (
          checkpoint_id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          trigger TEXT NOT NULL,
          state_hash TEXT NOT NULL,
          state JSONB NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          created_at BIGINT NOT NULL,
          restored_from TEXT,
          tags TEXT[] DEFAULT '{}',
          description TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_checkpoints_agent ON agent_checkpoints(agent_id);
        CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON agent_checkpoints(agent_id, session_id);
        CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON agent_checkpoints(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_checkpoints_state ON agent_checkpoints USING GIN(state);
      `);
    }
    return this.pool as { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
  }

  private rowToRecord(row: Record<string, unknown>): CheckpointRecord {
    return {
      checkpointId: row["checkpoint_id"] as string,
      agentId: row["agent_id"] as string,
      sessionId: row["session_id"] as string,
      version: row["version"] as number,
      trigger: row["trigger"] as CheckpointTrigger,
      stateHash: row["state_hash"] as string,
      state: row["state"] as AgentState,
      sizeBytes: row["size_bytes"] as number,
      createdAt: Number(row["created_at"]),
      restoredFrom: row["restored_from"] as string | undefined,
      tags: (row["tags"] as string[]) ?? [],
      description: row["description"] as string | undefined,
    };
  }

  async save(record: CheckpointRecord): Promise<void> {
    const pool = await this.getPool();
    await pool.query(
      `INSERT INTO agent_checkpoints
       (checkpoint_id, agent_id, session_id, version, trigger, state_hash, state, size_bytes, created_at, restored_from, tags, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)
       ON CONFLICT (checkpoint_id) DO UPDATE SET state = EXCLUDED.state, state_hash = EXCLUDED.state_hash`,
      [
        record.checkpointId,
        record.agentId,
        record.sessionId,
        record.version,
        record.trigger,
        record.stateHash,
        JSON.stringify(record.state),
        record.sizeBytes,
        record.createdAt,
        record.restoredFrom ?? null,
        record.tags,
        record.description ?? null,
      ]
    );
  }

  async load(checkpointId: string): Promise<CheckpointRecord | null> {
    const pool = await this.getPool();
    const result = await pool.query(
      "SELECT * FROM agent_checkpoints WHERE checkpoint_id = $1",
      [checkpointId]
    );
    return result.rows[0] ? this.rowToRecord(result.rows[0]) : null;
  }

  async loadLatest(
    agentId: string,
    sessionId?: string
  ): Promise<CheckpointRecord | null> {
    const pool = await this.getPool();
    const [sql, params] = sessionId
      ? [
          "SELECT * FROM agent_checkpoints WHERE agent_id = $1 AND session_id = $2 ORDER BY created_at DESC LIMIT 1",
          [agentId, sessionId],
        ]
      : [
          "SELECT * FROM agent_checkpoints WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1",
          [agentId],
        ];

    const result = await pool.query(sql, params);
    return result.rows[0] ? this.rowToRecord(result.rows[0]) : null;
  }

  async loadAll(query: CheckpointQuery): Promise<CheckpointRecord[]> {
    const pool = await this.getPool();
    let sql = "SELECT * FROM agent_checkpoints WHERE 1=1";
    const params: unknown[] = [];
    let idx = 1;

    if (query.agentId) { sql += ` AND agent_id = $${idx++}`; params.push(query.agentId); }
    if (query.sessionId) { sql += ` AND session_id = $${idx++}`; params.push(query.sessionId); }
    if (query.trigger) { sql += ` AND trigger = $${idx++}`; params.push(query.trigger); }
    if (query.fromVersion !== undefined) { sql += ` AND version >= $${idx++}`; params.push(query.fromVersion); }
    if (query.toVersion !== undefined) { sql += ` AND version <= $${idx++}`; params.push(query.toVersion); }

    sql += " ORDER BY created_at DESC";
    if (query.limit) { sql += ` LIMIT $${idx++}`; params.push(query.limit); }

    const result = await pool.query(sql, params);
    return result.rows.map((r) => this.rowToRecord(r));
  }

  async delete(checkpointId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.query("DELETE FROM agent_checkpoints WHERE checkpoint_id = $1", [checkpointId]);
  }

  async deleteSession(agentId: string, sessionId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.query(
      "DELETE FROM agent_checkpoints WHERE agent_id = $1 AND session_id = $2",
      [agentId, sessionId]
    );
  }

  async count(agentId: string): Promise<number> {
    const pool = await this.getPool();
    const result = await pool.query(
      "SELECT COUNT(*) as cnt FROM agent_checkpoints WHERE agent_id = $1",
      [agentId]
    );
    return Number(result.rows[0]?.["cnt"] ?? 0);
  }
}

// ─── AgentCheckpoint ──────────────────────────────────────────────────────────

export class AgentCheckpoint extends EventEmitter {
  private driver: CheckpointPersistenceDriver;
  private versionCounters = new Map<string, number>(); // agentId → version
  private autoCheckpointTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly config: CheckpointConfig = {}) {
    super();
    this.driver = config.persistenceDriver ?? new InMemoryDriver();
    logger.info("[AgentCheckpoint] Initialized");
  }

  // ── Saving ────────────────────────────────────────────────────────────────────

  async save(
    state: AgentState,
    trigger: CheckpointTrigger = "manual",
    opts: { tags?: string[]; description?: string } = {}
  ): Promise<CheckpointRecord> {
    const serialized = JSON.stringify(state);
    const stateHash = createHash("sha256").update(serialized).digest("hex");

    const version = this.nextVersion(state.agentId);
    const record: CheckpointRecord = {
      checkpointId: randomUUID(),
      agentId: state.agentId,
      sessionId: state.sessionId,
      version,
      trigger,
      stateHash,
      state,
      sizeBytes: Buffer.byteLength(serialized, "utf8"),
      createdAt: Date.now(),
      tags: opts.tags ?? [],
      description: opts.description,
    };

    await this.driver.save(record);
    await this.pruneOldCheckpoints(state.agentId);

    logger.info(
      {
        checkpointId: record.checkpointId,
        agentId: state.agentId,
        version,
        trigger,
        sizeKB: (record.sizeBytes / 1024).toFixed(1),
      },
      "[AgentCheckpoint] Checkpoint saved"
    );

    this.emit("checkpoint:saved", {
      checkpointId: record.checkpointId,
      agentId: state.agentId,
      version,
      trigger,
    });

    return record;
  }

  // ── Restoration ───────────────────────────────────────────────────────────────

  async restore(checkpointId: string): Promise<RestoreResult> {
    const checkpoint = await this.driver.load(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint '${checkpointId}' not found`);
    }

    // Verify integrity
    const serialized = JSON.stringify(checkpoint.state);
    const computedHash = createHash("sha256").update(serialized).digest("hex");

    if (computedHash !== checkpoint.stateHash) {
      throw new Error(
        `Checkpoint integrity check failed: hash mismatch for '${checkpointId}'`
      );
    }

    const restoredAt = Date.now();
    const staleMsAgo = restoredAt - checkpoint.createdAt;

    logger.info(
      {
        checkpointId,
        agentId: checkpoint.agentId,
        version: checkpoint.version,
        staleMsAgo,
      },
      "[AgentCheckpoint] Checkpoint restored"
    );

    this.emit("checkpoint:restored", {
      checkpointId,
      agentId: checkpoint.agentId,
      staleMsAgo,
    });

    return {
      checkpoint,
      state: checkpoint.state,
      restoredAt,
      staleMsAgo,
    };
  }

  async restoreLatest(
    agentId: string,
    sessionId?: string
  ): Promise<RestoreResult | null> {
    const checkpoint = await this.driver.loadLatest(agentId, sessionId);
    if (!checkpoint) return null;
    return this.restore(checkpoint.checkpointId);
  }

  // ── Auto-checkpoint ───────────────────────────────────────────────────────────

  enableAutoCheckpoint(
    agentId: string,
    stateProvider: () => AgentState | null
  ): void {
    const intervalMs = this.config.autoCheckpointIntervalMs ?? 60_000;

    const timer = setInterval(async () => {
      const state = stateProvider();
      if (!state) return;

      try {
        await this.save(state, "periodic", {
          description: `Auto-checkpoint at ${new Date().toISOString()}`,
        });
      } catch (err) {
        logger.error({ err, agentId }, "[AgentCheckpoint] Auto-checkpoint failed");
      }
    }, intervalMs);

    this.autoCheckpointTimers.set(agentId, timer);
    logger.info({ agentId, intervalMs }, "[AgentCheckpoint] Auto-checkpoint enabled");
  }

  disableAutoCheckpoint(agentId: string): void {
    const timer = this.autoCheckpointTimers.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.autoCheckpointTimers.delete(agentId);
      logger.info({ agentId }, "[AgentCheckpoint] Auto-checkpoint disabled");
    }
  }

  // ── Diff between checkpoints ──────────────────────────────────────────────────

  async diff(
    checkpointIdA: string,
    checkpointIdB: string
  ): Promise<{
    added: string[];
    removed: string[];
    changed: string[];
    stepsDiff: { added: string[]; removed: string[]; changed: string[] };
  }> {
    const [a, b] = await Promise.all([
      this.driver.load(checkpointIdA),
      this.driver.load(checkpointIdB),
    ]);

    if (!a || !b) throw new Error("One or both checkpoints not found");

    const stepsA = new Set(Object.keys(a.state.stepResults));
    const stepsB = new Set(Object.keys(b.state.stepResults));

    const added = [...stepsB].filter((k) => !stepsA.has(k));
    const removed = [...stepsA].filter((k) => !stepsB.has(k));
    const changed = [...stepsA]
      .filter(
        (k) =>
          stepsB.has(k) &&
          JSON.stringify(a.state.stepResults[k]) !==
            JSON.stringify(b.state.stepResults[k])
      );

    const customA = new Set(Object.keys(a.state.custom));
    const customB = new Set(Object.keys(b.state.custom));

    return {
      added: [...customB].filter((k) => !customA.has(k)),
      removed: [...customA].filter((k) => !customB.has(k)),
      changed: [...customA].filter(
        (k) =>
          customB.has(k) &&
          JSON.stringify(a.state.custom[k]) !== JSON.stringify(b.state.custom[k])
      ),
      stepsDiff: { added, removed, changed },
    };
  }

  // ── Pruning ───────────────────────────────────────────────────────────────────

  private async pruneOldCheckpoints(agentId: string): Promise<void> {
    const max = this.config.maxCheckpointsPerAgent ?? 50;
    const count = await this.driver.count(agentId);

    if (count <= max) return;

    const all = await this.driver.loadAll({ agentId, limit: count });
    // Sort oldest first; keep newest `max` records
    const toDelete = all.slice(max);

    for (const record of toDelete) {
      await this.driver.delete(record.checkpointId);
    }

    logger.debug(
      { agentId, deleted: toDelete.length },
      "[AgentCheckpoint] Old checkpoints pruned"
    );
  }

  // ── Version management ────────────────────────────────────────────────────────

  private nextVersion(agentId: string): number {
    const next = (this.versionCounters.get(agentId) ?? 0) + 1;
    this.versionCounters.set(agentId, next);
    return next;
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  async list(query: CheckpointQuery): Promise<CheckpointRecord[]> {
    return this.driver.loadAll(query);
  }

  async get(checkpointId: string): Promise<CheckpointRecord | null> {
    return this.driver.load(checkpointId);
  }

  async delete(checkpointId: string): Promise<void> {
    await this.driver.delete(checkpointId);
    this.emit("checkpoint:deleted", { checkpointId });
  }

  async deleteSession(agentId: string, sessionId: string): Promise<void> {
    await this.driver.deleteSession(agentId, sessionId);
    this.disableAutoCheckpoint(agentId);
    this.emit("session:deleted", { agentId, sessionId });
  }

  /** Serialize current agent state snapshot */
  static buildState(
    partial: Partial<AgentState> & { agentId: string; sessionId: string; goal: string }
  ): AgentState {
    return {
      context: "",
      stepResults: {},
      messages: [],
      custom: {},
      metadata: {
        toolCallCount: 0,
        totalTokensUsed: 0,
        totalCostUSD: 0,
        startedAt: Date.now(),
      },
      ...partial,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: AgentCheckpoint | null = null;

export function getAgentCheckpoint(config?: CheckpointConfig): AgentCheckpoint {
  if (!_instance) _instance = new AgentCheckpoint(config);
  return _instance;
}
