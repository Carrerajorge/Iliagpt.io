/**
 * Cognitive Middleware — bridge from cognitive `MemoryStore` to the
 * project's existing `PgVectorMemoryStore` (Turn G).
 *
 * The cognitive layer defines a small, cognitive-focused memory
 * contract (`MemoryRecord` + `recall(userId, query, limit)`). The
 * production database already has a richer, full-featured
 * `PgVectorMemoryStore` class at `server/memory/PgVectorMemoryStore.ts`
 * with `store(opts)` and `search(opts)` methods, importance scoring,
 * temporal decay, and access counting.
 *
 * Rather than duplicate a pgvector implementation in the cognitive
 * layer OR change the existing production class's API, this adapter
 * BRIDGES one to the other:
 *
 *   cognitive.recall(userId, query, limit)
 *       → pg.search({ queryText, userId, limit, type: "semantic" })
 *       → map each returned Memory into our MemoryRecord shape
 *
 *   cognitive.remember({ userId, text, importance })
 *       → pg.store({ content, userId, importance, memoryType })
 *
 * Both directions preserve the "never throws" cognitive contract:
 * production class errors become empty arrays (recall) or thrown
 * errors (remember — callers expect this one to throw).
 *
 * The adapter takes the production store as a DEPENDENCY so tests
 * can inject a shape-compatible mock without pulling in the full
 * pgvector module.
 */

import type {
  MemoryRecord,
  MemoryStore,
} from "./context";

// ---------------------------------------------------------------------------
// Minimal structural subset of PgVectorMemoryStore the adapter needs
// ---------------------------------------------------------------------------

/**
 * One memory returned by the production store. Only the fields
 * this adapter actually uses are listed — the real class has more
 * but we treat them as opaque metadata.
 */
export interface PgMemoryLike {
  id: string;
  userId?: string | null;
  content: string;
  importance?: number | null;
  createdAt?: Date | string | null;
  memoryType?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PgMemorySearchOptions {
  queryText: string;
  userId?: string;
  limit?: number;
  type?: "semantic" | "text" | "hybrid";
}

export interface PgMemoryStoreOptions {
  content: string;
  userId?: string;
  importance?: number;
  memoryType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Structural interface covering the two methods the adapter uses.
 * The production `PgVectorMemoryStore` class already conforms.
 */
export interface PgVectorMemoryStoreLike {
  search(options: PgMemorySearchOptions): Promise<PgMemoryLike[]>;
  store(options: PgMemoryStoreOptions): Promise<string>;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface PgMemoryStoreAdapterOptions {
  /** Adapter name override. Default "pgvector-memory-adapter". */
  name?: string;
  /** The production vector store to wrap. */
  pgStore: PgVectorMemoryStoreLike;
  /**
   * Default importance for memories written via `remember` when
   * the caller doesn't supply one. Default 0.5.
   */
  defaultImportance?: number;
  /**
   * Memory type tag applied to every write. Default "cognitive".
   * Lets dashboards filter memories produced by the cognitive
   * middleware from other sources.
   */
  memoryType?: string;
}

export class PgMemoryStoreAdapter implements MemoryStore {
  readonly name: string;
  private readonly pgStore: PgVectorMemoryStoreLike;
  private readonly defaultImportance: number;
  private readonly memoryType: string;

  constructor(options: PgMemoryStoreAdapterOptions) {
    if (!options.pgStore) {
      throw new Error("PgMemoryStoreAdapter: options.pgStore is required");
    }
    this.name = options.name ?? "pgvector-memory-adapter";
    this.pgStore = options.pgStore;
    this.defaultImportance = options.defaultImportance ?? 0.5;
    this.memoryType = options.memoryType ?? "cognitive";
  }

  async recall(
    userId: string,
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<MemoryRecord[]> {
    // Pre-abort fast path — match the InMemoryMemoryStore contract.
    if (signal?.aborted) return [];
    if (limit <= 0) return [];
    if (query.length === 0) return [];

    let results: PgMemoryLike[];
    try {
      results = await this.pgStore.search({
        queryText: query,
        userId,
        limit,
        type: "semantic",
      });
    } catch {
      // Never throws — cognitive contract. Errors get surfaced
      // by the enricher's own `errors[]` array. We intentionally
      // do NOT log here; the production store already logs.
      return [];
    }

    if (!Array.isArray(results)) return [];

    const out: MemoryRecord[] = [];
    for (const mem of results) {
      // Filter to the requested user defensively — `pgStore.search`
      // already filters by userId, but the type allows a nullable
      // userId column and we should never leak cross-user memories.
      if (mem.userId && mem.userId !== userId) continue;
      out.push(convertPgMemoryToCognitive(mem, userId));
    }
    return out;
  }

  async remember(
    record: Omit<MemoryRecord, "id" | "createdAt">,
  ): Promise<MemoryRecord> {
    const id = await this.pgStore.store({
      content: record.text,
      userId: record.userId,
      importance: record.importance ?? this.defaultImportance,
      memoryType: this.memoryType,
      metadata: record.metadata,
    });
    return {
      id,
      userId: record.userId,
      text: record.text,
      importance: record.importance,
      createdAt: Date.now(),
      metadata: record.metadata,
    };
  }
}

// ---------------------------------------------------------------------------
// Shape conversion
// ---------------------------------------------------------------------------

/**
 * Map one production `PgMemoryLike` row into our cognitive
 * `MemoryRecord` shape. Exposed so tests can pin the exact
 * mapping without wiring the full adapter.
 */
export function convertPgMemoryToCognitive(
  mem: PgMemoryLike,
  fallbackUserId: string,
): MemoryRecord {
  const createdAt =
    mem.createdAt instanceof Date
      ? mem.createdAt.getTime()
      : typeof mem.createdAt === "string"
        ? Date.parse(mem.createdAt)
        : Date.now();
  return {
    id: mem.id,
    userId: mem.userId ?? fallbackUserId,
    text: mem.content,
    importance:
      typeof mem.importance === "number" && !Number.isNaN(mem.importance)
        ? mem.importance
        : 0.5,
    createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
    metadata: mem.metadata ?? undefined,
  };
}
