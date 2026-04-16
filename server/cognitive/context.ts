/**
 * Cognitive Middleware — context enrichment layer (Turn C).
 *
 * The orchestrator treats "context" as an EXPLICIT, TYPED, AUDITABLE
 * layer of the pipeline. Before the request reaches the provider
 * adapter, the enrichment stage consults every registered context
 * source (long-term memory, document stores, conversation history)
 * and assembles a `ContextBundle` that the orchestrator mixes into
 * the system prompt and/or messages.
 *
 * Why a dedicated layer:
 *
 *   1. **Provenance**. Every chunk the model sees originated from a
 *      known source. Dashboards and users can inspect exactly what
 *      the model had access to — no hidden global state, no magic
 *      strings baked into some distant helper.
 *
 *   2. **Budget enforcement**. LLM context windows are finite and
 *      cost money. The enrichment stage enforces a hard character
 *      budget and drops the lowest-scored chunks when it overflows.
 *      The `ContextBundle` records how many chunks were retrieved
 *      vs. how many survived so telemetry can spot "we lost signal
 *      to the budget" cases.
 *
 *   3. **Plug-in stores**. `MemoryStore` and `DocumentStore` are
 *      thin interfaces. The default in-memory impls are deterministic
 *      and network-free for tests. Production wiring swaps them for
 *      pgvector-backed implementations without touching the pipeline.
 *
 *   4. **Cancellation**. Every store method accepts an `AbortSignal`.
 *      The enrichment stage forwards the caller's signal so that
 *      abandoning a request also abandons the retrievals.
 *
 *   5. **Never throws**. The enrichment stage catches every store
 *      error and returns an empty-but-structured `ContextBundle`
 *      with the error code logged. The pipeline keeps going — a
 *      failed memory lookup should not take down the whole request.
 *
 * Design note on "alignment & honesty":
 *   The system card we used as inspiration emphasizes that a
 *   well-aligned model must never invent evidence about context it
 *   did not receive. By making the context layer explicit and
 *   provenance-tracked, we give the VALIDATOR something to check
 *   against: if the response cites a fact the context bundle never
 *   contained, that's a hallucination the validator can flag. This
 *   module stores the raw material; `outputValidator.ts` decides
 *   how to grade adherence.
 */

// ---------------------------------------------------------------------------
// Context chunks
// ---------------------------------------------------------------------------

export type ContextSourceKind =
  | "memory"
  | "document"
  | "conversation"
  | "system";

/**
 * One piece of retrieved context. Chunks are the smallest unit the
 * enrichment stage can include or drop when enforcing the budget.
 */
export interface ContextChunk {
  /** Stable id for deduplication and provenance tracking. */
  id: string;
  /** Where this chunk came from. */
  source: ContextSourceKind;
  /**
   * Human-readable title (document name, memory timestamp, "system
   * prompt baseline", etc.). Shown in debugging UIs.
   */
  title?: string;
  /** The actual text content. Newlines are preserved. */
  text: string;
  /**
   * Relevance score in [0, 1]. Higher = more relevant. The enrichment
   * stage sorts by this descending and drops the tail under budget
   * pressure. Stores emit their own scores — the enrichment stage
   * does NOT re-rank across sources (yet); it trusts the store.
   */
  score: number;
  /**
   * Free-form metadata. Common keys:
   *   • `docId`, `position` (document store chunks)
   *   • `createdAt`, `importance` (memory)
   *   • `messageId`, `role`     (conversation)
   */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Context bundle
// ---------------------------------------------------------------------------

/**
 * The full enriched context for one request. Produced by
 * `enrichContext` and consumed by the orchestrator when building the
 * normalized provider request.
 */
export interface ContextBundle {
  /** Included chunks, sorted by relevance descending. */
  chunks: ContextChunk[];
  /** Total character count across every included chunk. */
  totalChars: number;
  /** How many chunks every store returned before budget truncation. */
  retrievedCount: number;
  /** How many chunks survived the budget cut. */
  includedCount: number;
  /** Non-fatal error codes collected from individual store lookups. */
  errors: string[];
  /** Stage-level timings for dashboarding. */
  telemetry: ContextTelemetry;
}

export interface ContextTelemetry {
  /** ms spent inside the memory store's `recall`. 0 if no store. */
  memoryLookupMs: number;
  /** ms spent inside the document store's `search`. 0 if no store. */
  documentLookupMs: number;
  /** Total wall-clock ms for the full enrichment stage. */
  totalMs: number;
}

// ---------------------------------------------------------------------------
// Memory store
// ---------------------------------------------------------------------------

/**
 * One long-term memory record attached to a user. Memories are the
 * persistent cross-session facts the model should know about the
 * user: preferences, personal context, prior decisions, etc.
 */
export interface MemoryRecord {
  /** Stable id (UUID or ULID). */
  id: string;
  /** Which user this memory belongs to. */
  userId: string;
  /** The fact itself, in natural language. */
  text: string;
  /**
   * Importance score in [0, 1]. Stores use this as a tiebreaker
   * when two memories score equally on text relevance.
   */
  importance: number;
  /** Unix ms timestamp when this memory was written. */
  createdAt: number;
  /** Optional metadata (source conversation id, tags, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * Plug-in point for long-term memory. Production uses a pgvector-
 * backed implementation; tests use the in-memory version.
 *
 * Hard contract:
 *   • `recall` MUST NOT throw. On error return an empty array and
 *     let the enrichment stage log the silent failure.
 *   • `recall` MUST respect the `signal` and return promptly.
 *   • `remember` is allowed to throw — the caller (the post-response
 *     memory writer) is responsible for catching.
 */
export interface MemoryStore {
  /** Stable adapter name for logging. */
  readonly name: string;
  /**
   * Return memories relevant to the query, sorted by relevance
   * descending, limited to at most `limit` items.
   */
  recall(
    userId: string,
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<MemoryRecord[]>;
  /** Persist a new memory. */
  remember(
    record: Omit<MemoryRecord, "id" | "createdAt">,
  ): Promise<MemoryRecord>;
}

// ---------------------------------------------------------------------------
// Document store
// ---------------------------------------------------------------------------

/**
 * One chunk of a retrievable document (as in RAG).
 */
export interface DocumentChunkRecord {
  /** Stable id for the chunk. */
  id: string;
  /** Which document this chunk belongs to. */
  docId: string;
  /** Human-readable document title. */
  docTitle: string;
  /** The chunk's text content. */
  text: string;
  /** Chunk index within the document (0-based). */
  position: number;
  /** Score in [0, 1] — how well this chunk matches the query. */
  score: number;
  /** Optional metadata (page number, section, url, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * Plug-in point for RAG-style document retrieval.
 *
 * Hard contract:
 *   • `search` MUST NOT throw. Errors → empty array.
 *   • `search` MUST respect the `signal`.
 */
export interface DocumentStore {
  /** Stable adapter name for logging. */
  readonly name: string;
  search(
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<DocumentChunkRecord[]>;
}

// ---------------------------------------------------------------------------
// Enricher options
// ---------------------------------------------------------------------------

export interface ContextEnricherOptions {
  /** Optional memory store. Omit to disable the memory branch. */
  memoryStore?: MemoryStore;
  /** Optional document store. Omit to disable the RAG branch. */
  documentStore?: DocumentStore;
  /**
   * Maximum memory chunks to pull. Defaults to 5. Memory is
   * per-user so this is small by design.
   */
  maxMemoryChunks?: number;
  /**
   * Maximum document chunks to pull. Defaults to 5.
   */
  maxDocumentChunks?: number;
  /**
   * Hard character budget for the full bundle. The enrichment stage
   * sorts chunks by descending score and keeps including them until
   * adding the next one would overflow this budget. Default 4000.
   */
  maxTotalChars?: number;
}
