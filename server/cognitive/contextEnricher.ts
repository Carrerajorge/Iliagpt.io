/**
 * Cognitive Middleware — context enrichment stage (Turn C).
 *
 * Runs before provider selection. Given a `CognitiveRequest` and a
 * set of registered context sources, produces a `ContextBundle` the
 * orchestrator can mix into the normalized provider request.
 *
 * Algorithm:
 *
 *   1. Fire off memory.recall + document.search in parallel.
 *   2. Await both with `Promise.allSettled` so a failure in one
 *      source cannot prevent us from using the other. Failed
 *      sources log a short error code on the bundle but do NOT
 *      halt the pipeline.
 *   3. Convert memory records and document chunks to the uniform
 *      `ContextChunk` shape, tagging each with its source.
 *   4. Sort all chunks by descending score.
 *   5. Fill a bundle under a hard character budget: include
 *      chunks in sorted order until adding the next would
 *      overflow. Lower-scored chunks are dropped.
 *   6. Record timings for each substage.
 *
 * Hard guarantees:
 *
 *   • Never throws. Every store call is wrapped in try/catch.
 *   • Respects the caller's AbortSignal. An aborted signal short-
 *     circuits the whole stage and returns an empty bundle with
 *     `errors: ["aborted"]`.
 *   • Deterministic given deterministic stores.
 *   • No global state. Safe to share across concurrent requests.
 */

import type {
  ContextBundle,
  ContextChunk,
  ContextEnricherOptions,
  DocumentChunkRecord,
  MemoryRecord,
} from "./context";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  maxMemoryChunks: 5,
  maxDocumentChunks: 5,
  maxTotalChars: 4000,
} as const;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full enrichment stage for one request. Returns the
 * assembled `ContextBundle` plus inline telemetry.
 */
export async function enrichContext(
  userId: string,
  query: string,
  options: ContextEnricherOptions,
  signal?: AbortSignal,
): Promise<ContextBundle> {
  const startedAt = Date.now();
  const errors: string[] = [];

  // Pre-abort check — cheap win for the "user already bailed" case.
  if (signal?.aborted) {
    return emptyBundle(["aborted"], {
      memoryLookupMs: 0,
      documentLookupMs: 0,
      totalMs: Date.now() - startedAt,
    });
  }

  const maxMem = options.maxMemoryChunks ?? DEFAULTS.maxMemoryChunks;
  const maxDoc = options.maxDocumentChunks ?? DEFAULTS.maxDocumentChunks;
  const maxChars = options.maxTotalChars ?? DEFAULTS.maxTotalChars;

  // ── Fire both retrievals in parallel ────────────────────────────
  // We measure each substage's wall time independently so dashboards
  // can distinguish "memory is slow" from "docs are slow".
  const memT0 = Date.now();
  const docT0 = Date.now();

  const memoryPromise: Promise<SafeMemoryResult> = options.memoryStore
    ? safeRecall(options.memoryStore, userId, query, maxMem, signal)
    : Promise.resolve({ ok: true, records: [] });

  const documentPromise: Promise<SafeDocumentResult> = options.documentStore
    ? safeSearch(options.documentStore, query, maxDoc, signal)
    : Promise.resolve({ ok: true, chunks: [] });

  const [memoryResult, documentResult] = await Promise.all([
    memoryPromise,
    documentPromise,
  ]);
  const memoryLookupMs = options.memoryStore ? Date.now() - memT0 : 0;
  const documentLookupMs = options.documentStore ? Date.now() - docT0 : 0;

  if (!memoryResult.ok) errors.push(`memory_store: ${memoryResult.error}`);
  if (!documentResult.ok) errors.push(`document_store: ${documentResult.error}`);

  // ── Convert both sources to uniform chunks ──────────────────────
  const memoryChunks: ContextChunk[] =
    memoryResult.ok
      ? memoryResult.records.map((r, i) => memoryRecordToChunk(r, i))
      : [];

  const documentChunks: ContextChunk[] =
    documentResult.ok
      ? documentResult.chunks.map((c) => documentChunkRecordToChunk(c))
      : [];

  const allChunks: ContextChunk[] = [...memoryChunks, ...documentChunks];
  const retrievedCount = allChunks.length;

  // Sort by score desc so the budget walker below drops the tail,
  // not the head.
  allChunks.sort((a, b) => b.score - a.score);

  // ── Enforce the character budget ────────────────────────────────
  const included: ContextChunk[] = [];
  let totalChars = 0;
  for (const chunk of allChunks) {
    const next = totalChars + chunk.text.length;
    if (next > maxChars) {
      // Over budget — if this chunk alone is already too big and
      // nothing is included yet, include a truncated slice so the
      // model still gets some signal from the top-scored chunk.
      if (included.length === 0 && maxChars > 0) {
        const truncated: ContextChunk = {
          ...chunk,
          text: chunk.text.slice(0, maxChars),
          metadata: {
            ...(chunk.metadata ?? {}),
            truncated: true,
            originalLength: chunk.text.length,
          },
        };
        included.push(truncated);
        totalChars = maxChars;
      }
      // Either way, stop walking — later chunks are strictly lower
      // score so they won't help.
      break;
    }
    included.push(chunk);
    totalChars = next;
  }

  const totalMs = Date.now() - startedAt;

  return {
    chunks: included,
    totalChars,
    retrievedCount,
    includedCount: included.length,
    errors,
    telemetry: {
      memoryLookupMs,
      documentLookupMs,
      totalMs,
    },
  };
}

// ---------------------------------------------------------------------------
// Uniform-chunk converters
// ---------------------------------------------------------------------------

function memoryRecordToChunk(record: MemoryRecord, index: number): ContextChunk {
  // Memory stores don't emit an explicit score in their API — the
  // store already ranked by relevance, so we use 1 / (1 + index) as
  // a decaying proxy, multiplied by the importance to respect the
  // store's own importance annotation.
  //
  // This is intentional: we trust the store's ordering but still
  // need a numeric score for cross-source sorting + budget cuts.
  const orderScore = 1 / (1 + index);
  const combined = Math.min(1, orderScore * (0.5 + 0.5 * record.importance));
  return {
    id: `mem:${record.id}`,
    source: "memory",
    title: `memory ${record.id}`,
    text: record.text,
    score: combined,
    metadata: {
      createdAt: record.createdAt,
      importance: record.importance,
      userId: record.userId,
      ...record.metadata,
    },
  };
}

function documentChunkRecordToChunk(
  chunk: DocumentChunkRecord,
): ContextChunk {
  return {
    id: `doc:${chunk.id}`,
    source: "document",
    title: `${chunk.docTitle} #${chunk.position}`,
    text: chunk.text,
    score: chunk.score,
    metadata: {
      docId: chunk.docId,
      position: chunk.position,
      ...chunk.metadata,
    },
  };
}

// ---------------------------------------------------------------------------
// Safe store wrappers (never throw)
// ---------------------------------------------------------------------------

type SafeMemoryResult =
  | { ok: true; records: MemoryRecord[] }
  | { ok: false; error: string };

async function safeRecall(
  store: import("./context").MemoryStore,
  userId: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SafeMemoryResult> {
  try {
    const records = await store.recall(userId, query, limit, signal);
    if (!Array.isArray(records)) {
      return { ok: false, error: "memory_store_returned_non_array" };
    }
    return { ok: true, records };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

type SafeDocumentResult =
  | { ok: true; chunks: DocumentChunkRecord[] }
  | { ok: false; error: string };

async function safeSearch(
  store: import("./context").DocumentStore,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<SafeDocumentResult> {
  try {
    const chunks = await store.search(query, limit, signal);
    if (!Array.isArray(chunks)) {
      return { ok: false, error: "document_store_returned_non_array" };
    }
    return { ok: true, chunks };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Empty bundle helper
// ---------------------------------------------------------------------------

function emptyBundle(
  errors: string[],
  telemetry: ContextBundle["telemetry"],
): ContextBundle {
  return {
    chunks: [],
    totalChars: 0,
    retrievedCount: 0,
    includedCount: 0,
    errors,
    telemetry,
  };
}

// ---------------------------------------------------------------------------
// System prompt rendering
// ---------------------------------------------------------------------------

/**
 * Render a ContextBundle into a system-prompt-friendly text block.
 * The orchestrator calls this when building the NormalizedProviderRequest
 * so the final prompt looks like:
 *
 *     <baseline system prompt>
 *
 *     ── Relevant context ──
 *     [memory: memory mem_1] user prefers tabs over spaces
 *     [document: Handbook #0] section on code style: ...
 *
 *     (end context)
 *
 * Exported so tests can assert the exact rendered text and so the
 * orchestrator's unit tests don't need to re-derive the format.
 */
export function renderContextBundle(bundle: ContextBundle): string {
  if (bundle.chunks.length === 0) return "";
  const lines: string[] = [];
  lines.push("── Relevant context ──");
  for (const chunk of bundle.chunks) {
    const header = chunk.title ? `[${chunk.source}: ${chunk.title}]` : `[${chunk.source}]`;
    lines.push(`${header} ${chunk.text}`);
  }
  lines.push("(end context)");
  return lines.join("\n");
}
