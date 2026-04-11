/**
 * Cognitive Middleware — run persistence layer (Turn G).
 *
 * Every run that completes (or fails gracefully) produces a
 * structured `CognitiveResponse`. Turn G adds a persistence seam
 * so production deployments can store those runs + their tool
 * execution history in whatever backend they use. Tests, dev,
 * and smoke runs use an in-memory repo; production wires a
 * Postgres-backed one.
 *
 * Design principles:
 *
 *   1. **Repository interface only.** No ORM coupling in the
 *      shape layer. Every backend just implements `RunRepository`
 *      with four methods (`save`, `get`, `listByUser`,
 *      `deleteByRunId`). The middleware only ever calls `save`.
 *
 *   2. **Never throws.** Production repos can fail (DB down,
 *      constraint violation, JSON encoder blow-up). The
 *      middleware's save hook catches every error and records it
 *      on the response's `errors[]` array so the user still sees
 *      a healthy reply. A failed save NEVER poisons a successful
 *      model call.
 *
 *   3. **Fire-and-forget by default.** The middleware saves the
 *      run WITHOUT awaiting the repo's promise. The response
 *      reaches the user immediately; persistence happens in the
 *      background. Tests that need deterministic ordering can
 *      pass `awaitSave: true` so `run()` doesn't return until
 *      the save resolves.
 *
 *   4. **Serializable records.** `CognitiveRunRecord` is a plain
 *      object that JSON round-trips cleanly. No Dates, no
 *      Buffers, no class instances. This lets repos store it as
 *      a single JSONB column without extra work.
 *
 *   5. **Stable id.** Each run gets a monotonic-ish id at save
 *      time (`run_${userId}_${ts}_${counter}`). Users pass it
 *      back on subsequent requests so dashboards can chain
 *      related runs. Repos that want UUIDs can override the
 *      `generateRunId` option.
 */

import type {
  CognitiveRequest,
  CognitiveResponse,
  ToolExecutionOutcomeLike,
} from "./types";

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

/**
 * The serializable audit record for one completed run. Mirrors
 * `CognitiveResponse` but with a `runId` + persistence timestamps
 * + the original request fields needed to reconstruct the full
 * interaction (so dashboards can show the user prompt alongside
 * the assistant reply).
 */
export interface CognitiveRunRecord {
  /** Stable id assigned at save time. */
  runId: string;
  /** Unix ms when the run finished. */
  persistedAt: number;

  // Original request snapshot (what the user asked)
  userId: string;
  conversationId?: string;
  userMessage: string;
  intentHint?: string;
  preferredProvider?: string;

  // Final outcome mirrored from CognitiveResponse
  ok: boolean;
  text: string;
  toolCallCount: number;
  /**
   * Per-tool execution history across every iteration of the
   * agentic loop. Empty when no registry was configured or the
   * model didn't pick any tools.
   */
  toolExecutions: ToolExecutionOutcomeLike[];

  // Routing + validation snapshots
  intent: string;
  providerName: string;
  providerReason: string;
  validationOk: boolean;
  validationIssueCount: number;
  refusalDetected: boolean;

  // Telemetry summary
  durationMs: number;
  providerCallMs: number;
  toolTotalMs: number;
  contextEnrichmentMs: number;
  agenticIterations: number;
  rateLimitAllowed: boolean;
  circuitBreakerState: string;

  // Errors collected during the run
  errors: string[];
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

/**
 * The single seam between the cognitive layer and any persistence
 * backend. Production wires a Postgres-backed impl; tests and dev
 * use the in-memory one below.
 *
 * Hard contract:
 *
 *   • `save` returns the full saved record (with `runId` +
 *     `persistedAt` filled in) so the caller can surface the id
 *     back to the user without a second round trip.
 *
 *   • Repos MAY throw on infrastructure errors (DB down, etc.).
 *     The middleware catches every throw — do NOT rely on the
 *     repo's own error handling.
 *
 *   • `get` returns `null` for unknown ids (not throw). `listByUser`
 *     returns `[]` for unknown users.
 *
 *   • `listByUser` returns newest-first up to `limit` entries.
 *     Implementations SHOULD cap `limit` at a sensible ceiling
 *     (e.g., 500) to protect against accidental full-table scans.
 */
export interface RunRepository {
  readonly name: string;
  /**
   * Persist a single run record. The input has every field
   * filled EXCEPT `runId` + `persistedAt` — the repo assigns
   * those and returns the completed record.
   */
  save(record: Omit<CognitiveRunRecord, "runId" | "persistedAt">): Promise<CognitiveRunRecord>;
  /** Fetch a previously-saved run by id. Returns null when not found. */
  get(runId: string): Promise<CognitiveRunRecord | null>;
  /**
   * List the most recent runs for a user, newest first. Returns
   * at most `limit` items (default 50).
   */
  listByUser(userId: string, limit?: number): Promise<CognitiveRunRecord[]>;
  /** Delete every run matching `runId`. Returns how many rows were removed. */
  deleteByRunId(runId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// In-memory repository
// ---------------------------------------------------------------------------

export interface InMemoryRunRepositoryOptions {
  /** Adapter name override. Default "in-memory-runs". */
  name?: string;
  /** Optional id generator for test determinism. */
  generateRunId?: (userId: string, counter: number) => string;
  /** Optional clock for deterministic `persistedAt` values. */
  now?: () => number;
  /**
   * Maximum retained runs per user. When exceeded, the oldest
   * runs for that user are dropped. Default: 1_000 — enough for
   * normal test + smoke usage, low enough that a runaway test
   * can't leak gigabytes of mock data. Set to `Infinity` to
   * disable the cap.
   */
  maxPerUser?: number;
}

/**
 * Lightweight in-memory implementation. Safe to share across
 * tests; use `.clear()` between cases for isolation.
 */
export class InMemoryRunRepository implements RunRepository {
  readonly name: string;
  private readonly records: Map<string, CognitiveRunRecord> = new Map();
  private readonly userIndex: Map<string, string[]> = new Map();
  private counter = 0;
  private readonly generateRunId: (userId: string, counter: number) => string;
  private readonly now: () => number;
  private readonly maxPerUser: number;

  constructor(options: InMemoryRunRepositoryOptions = {}) {
    this.name = options.name ?? "in-memory-runs";
    this.generateRunId =
      options.generateRunId ??
      ((userId, counter) => `run_${userId}_${Date.now()}_${counter}`);
    this.now = options.now ?? Date.now;
    this.maxPerUser = options.maxPerUser ?? 1_000;
  }

  async save(
    record: Omit<CognitiveRunRecord, "runId" | "persistedAt">,
  ): Promise<CognitiveRunRecord> {
    this.counter++;
    const runId = this.generateRunId(record.userId, this.counter);
    const full: CognitiveRunRecord = {
      ...record,
      runId,
      persistedAt: this.now(),
    };
    this.records.set(runId, full);

    // Update the user index (newest-first ordering).
    const existing = this.userIndex.get(record.userId) ?? [];
    existing.unshift(runId);
    // Enforce the per-user cap by evicting oldest entries.
    while (existing.length > this.maxPerUser) {
      const evicted = existing.pop();
      if (evicted) this.records.delete(evicted);
    }
    this.userIndex.set(record.userId, existing);

    return full;
  }

  async get(runId: string): Promise<CognitiveRunRecord | null> {
    return this.records.get(runId) ?? null;
  }

  async listByUser(userId: string, limit: number = 50): Promise<CognitiveRunRecord[]> {
    const ids = this.userIndex.get(userId) ?? [];
    const out: CognitiveRunRecord[] = [];
    for (const id of ids.slice(0, Math.max(0, limit))) {
      const rec = this.records.get(id);
      if (rec) out.push(rec);
    }
    return out;
  }

  async deleteByRunId(runId: string): Promise<number> {
    const rec = this.records.get(runId);
    if (!rec) return 0;
    this.records.delete(runId);
    const userList = this.userIndex.get(rec.userId);
    if (userList) {
      const idx = userList.indexOf(runId);
      if (idx >= 0) userList.splice(idx, 1);
    }
    return 1;
  }

  /** Test helper: wipe all records. */
  clear(): void {
    this.records.clear();
    this.userIndex.clear();
    this.counter = 0;
  }

  /** Test helper: total records currently stored. */
  get size(): number {
    return this.records.size;
  }
}

// ---------------------------------------------------------------------------
// Serialization helper
// ---------------------------------------------------------------------------

/**
 * Project a `CognitiveResponse` (plus the original request) into
 * the flat `CognitiveRunRecord` shape a repo can save. The
 * middleware calls this so every repo gets the same well-formed
 * input — nobody has to re-derive the projection.
 *
 * Pure function. Does NOT mutate inputs.
 */
export function projectRequestResponseToRunRecord(
  req: CognitiveRequest,
  response: CognitiveResponse,
): Omit<CognitiveRunRecord, "runId" | "persistedAt"> {
  return {
    userId: req.userId,
    conversationId: req.conversationId,
    userMessage: req.message,
    intentHint: req.intentHint,
    preferredProvider: req.preferredProvider,

    ok: response.ok,
    text: response.text,
    toolCallCount: response.toolExecutions.length,
    toolExecutions: response.toolExecutions,

    intent: response.routing.intent.intent,
    providerName: response.routing.providerName,
    providerReason: response.routing.providerReason,
    validationOk: response.validation.ok,
    validationIssueCount: response.validation.issues.length,
    refusalDetected: response.validation.refusalDetected,

    durationMs: response.telemetry.durationMs,
    providerCallMs: response.telemetry.providerCallMs,
    toolTotalMs: response.telemetry.toolTotalMs,
    contextEnrichmentMs: response.telemetry.contextEnrichmentMs,
    agenticIterations: response.telemetry.agenticIterations,
    rateLimitAllowed: response.telemetry.rateLimitAllowed,
    circuitBreakerState: response.telemetry.circuitBreakerState,

    errors: response.errors,
  };
}
