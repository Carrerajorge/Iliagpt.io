/**
 * Cognitive Middleware — in-memory context stores (Turn C).
 *
 * Zero-dependency, fully deterministic memory + document stores.
 * Used by tests and by local development when no real persistence
 * layer is wired up.
 *
 * Scoring:
 *
 *   Both stores use the same lightweight bag-of-words scorer:
 *
 *     1. Tokenize query and stored text to lowercase word bags,
 *        stripping punctuation + short stopwords.
 *     2. Score = |query_terms ∩ stored_terms| / |query_terms|,
 *        clipped to [0, 1]. Ties broken by the caller-specified
 *        importance (memories) or position (documents).
 *
 *   This is NOT a semantic scorer — it will not beat pgvector on
 *   recall quality. But it is:
 *     • Deterministic (tests can pin exact outputs)
 *     • Zero-dependency (no model, no embeddings API)
 *     • O(n) in the number of stored items
 *     • Small enough to reason about in code review
 *
 *   The plug-in interface makes it trivial to swap this for a real
 *   vector store later — the orchestrator never touches scoring
 *   internals, only the sorted results each store emits.
 *
 * Hard guarantees:
 *
 *   • `recall` / `search` never throw. On malformed input or
 *     aborted signal they return `[]`.
 *
 *   • Both stores honor the supplied `AbortSignal`. The work is
 *     synchronous (no I/O) so abort is checked at the start and
 *     once per batch of scored items.
 *
 *   • Both stores are safe to share across concurrent requests.
 *     Internal state is only mutated through `remember` / `add`;
 *     read paths only read.
 */

import type {
  DocumentChunkRecord,
  DocumentStore,
  MemoryRecord,
  MemoryStore,
} from "./context";

// ---------------------------------------------------------------------------
// Tokenization (shared by both stores)
// ---------------------------------------------------------------------------

/**
 * Very small English + Spanish stopword list. The scorer drops
 * these before intersecting query terms with document terms so
 * "hello world" matches "world hello" but is not artificially
 * boosted by shared function words.
 */
const STOPWORDS = new Set<string>([
  // English
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "of", "to", "in", "on", "at", "for", "and", "or", "but", "so", "if",
  "i", "you", "he", "she", "it", "we", "they", "this", "that", "these",
  "those", "with", "as", "by", "from", "about", "into", "over", "under",
  // Spanish
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del",
  "y", "o", "pero", "si", "que", "en", "con", "por", "para", "al",
  "es", "son", "era", "eran", "sea", "ser", "mi", "tu", "su", "yo",
  "tú", "él", "ella", "nosotros", "vosotros", "ellos", "ellas",
]);

/**
 * Deterministic, side-effect-free tokenizer. Lowercases, splits on
 * non-alphanumerics (Unicode-aware), drops stopwords and tokens
 * shorter than 2 chars.
 *
 * Exported so tests can pin tokenization independently of scoring.
 */
export function tokenizeForContext(text: string): string[] {
  if (text.length === 0) return [];
  const lowered = text.toLowerCase();
  // Unicode-aware: splits on anything that isn't a letter, digit, or
  // underscore (\p{L} + \p{N}). Requires the "u" flag.
  const raw = lowered.split(/[^\p{L}\p{N}_]+/u);
  const out: string[] = [];
  for (const tok of raw) {
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

/**
 * Score a query against a stored text. Range: [0, 1].
 *
 *   score = |intersection| / |queryTerms|
 *
 * Exported so the tests can verify scorer behavior without going
 * through the stores.
 */
export function scoreQueryAgainst(
  queryTerms: readonly string[],
  storedText: string,
): number {
  if (queryTerms.length === 0) return 0;
  const storedSet = new Set(tokenizeForContext(storedText));
  let hits = 0;
  for (const t of queryTerms) {
    if (storedSet.has(t)) hits++;
  }
  return Math.min(1, hits / queryTerms.length);
}

// ---------------------------------------------------------------------------
// In-memory MemoryStore
// ---------------------------------------------------------------------------

export interface InMemoryMemoryStoreOptions {
  /**
   * Adapter name override. Default "in-memory-memory".
   */
  name?: string;
  /**
   * Seed records. The store will make shallow copies so later
   * mutations of the input array do not affect the store.
   */
  seed?: MemoryRecord[];
}

export class InMemoryMemoryStore implements MemoryStore {
  readonly name: string;
  private readonly records: Map<string, MemoryRecord> = new Map();
  private idCounter = 0;

  constructor(options: InMemoryMemoryStoreOptions = {}) {
    this.name = options.name ?? "in-memory-memory";
    for (const r of options.seed ?? []) {
      this.records.set(r.id, { ...r });
    }
  }

  /** Expose the raw map size for tests + observability. */
  get size(): number {
    return this.records.size;
  }

  async recall(
    userId: string,
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<MemoryRecord[]> {
    if (signal?.aborted) return [];
    if (limit <= 0) return [];

    const queryTerms = tokenizeForContext(query);
    if (queryTerms.length === 0) return [];

    const scored: Array<{ record: MemoryRecord; score: number }> = [];
    for (const record of this.records.values()) {
      if (signal?.aborted) return [];
      if (record.userId !== userId) continue;
      const score = scoreQueryAgainst(queryTerms, record.text);
      if (score <= 0) continue;
      scored.push({ record, score });
    }

    // Sort by: score desc, importance desc, createdAt desc (newest
    // wins as the final tiebreaker — fresh memories are more likely
    // to reflect current user intent).
    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.record.importance !== b.record.importance) {
        return b.record.importance - a.record.importance;
      }
      return b.record.createdAt - a.record.createdAt;
    });

    return scored.slice(0, limit).map((s) => s.record);
  }

  async remember(
    record: Omit<MemoryRecord, "id" | "createdAt">,
  ): Promise<MemoryRecord> {
    this.idCounter++;
    const full: MemoryRecord = {
      id: `mem_${this.idCounter}`,
      createdAt: Date.now(),
      ...record,
    };
    this.records.set(full.id, full);
    return full;
  }

  /** Delete every record. Useful between tests. */
  clear(): void {
    this.records.clear();
    this.idCounter = 0;
  }
}

// ---------------------------------------------------------------------------
// In-memory DocumentStore
// ---------------------------------------------------------------------------

export interface InMemoryDocument {
  /** Stable id for the whole document. */
  docId: string;
  /** Human-readable title. */
  title: string;
  /**
   * The full text of the document. The store will split this into
   * fixed-size chunks at `chunkSize` characters (with an optional
   * overlap) and score each chunk independently at query time.
   */
  text: string;
  /** Optional metadata attached to every chunk. */
  metadata?: Record<string, unknown>;
}

export interface InMemoryDocumentStoreOptions {
  /** Adapter name override. Default "in-memory-documents". */
  name?: string;
  /** Pre-loaded documents. */
  documents?: InMemoryDocument[];
  /**
   * Chunk size in characters. Default 500. Smaller chunks give
   * more granular scoring; bigger chunks preserve more context per
   * hit. 500 is a reasonable balance for the bag-of-words scorer.
   */
  chunkSize?: number;
  /**
   * Overlap between consecutive chunks, in characters. Default 50.
   * Overlap reduces the "important phrase straddles a chunk
   * boundary" failure mode without doubling the index size.
   */
  chunkOverlap?: number;
}

/**
 * Pre-chunked in-memory document store. Chunks are computed once at
 * `addDocument` time and cached — we do NOT recompute them on every
 * search, which keeps search O(n_chunks · |queryTerms|).
 */
export class InMemoryDocumentStore implements DocumentStore {
  readonly name: string;
  private readonly chunks: DocumentChunkRecord[] = [];
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;

  constructor(options: InMemoryDocumentStoreOptions = {}) {
    this.name = options.name ?? "in-memory-documents";
    this.chunkSize = options.chunkSize ?? 500;
    this.chunkOverlap = options.chunkOverlap ?? 50;
    for (const doc of options.documents ?? []) {
      this.addDocument(doc);
    }
  }

  /** Number of chunks currently indexed. */
  get chunkCount(): number {
    return this.chunks.length;
  }

  /**
   * Add a document to the store. Chunks it at construction time so
   * later searches are cheap. Chunks carry a placeholder score of 0
   * that gets overwritten at query time.
   */
  addDocument(doc: InMemoryDocument): void {
    const { docId, title, text, metadata } = doc;
    if (text.length === 0) return;

    let position = 0;
    let cursor = 0;
    while (cursor < text.length) {
      const end = Math.min(text.length, cursor + this.chunkSize);
      const slice = text.slice(cursor, end);
      this.chunks.push({
        id: `${docId}::${position}`,
        docId,
        docTitle: title,
        text: slice,
        position,
        score: 0,
        metadata,
      });
      position++;
      if (end === text.length) break;
      cursor = end - this.chunkOverlap;
      if (cursor <= 0) cursor = end; // guard against pathological overlap
    }
  }

  async search(
    query: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<DocumentChunkRecord[]> {
    if (signal?.aborted) return [];
    if (limit <= 0) return [];

    const queryTerms = tokenizeForContext(query);
    if (queryTerms.length === 0) return [];

    const scored: DocumentChunkRecord[] = [];
    for (const chunk of this.chunks) {
      if (signal?.aborted) return [];
      const score = scoreQueryAgainst(queryTerms, chunk.text);
      if (score <= 0) continue;
      scored.push({ ...chunk, score });
    }

    // Sort by score desc, then by position asc so early chunks of
    // the same document win ties (document beginnings usually carry
    // the introduction / key claims).
    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.position - b.position;
    });

    return scored.slice(0, limit);
  }

  /** Delete every chunk. Useful between tests. */
  clear(): void {
    this.chunks.length = 0;
  }
}
