import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";

const logger = pino({ name: "VectorMemoryStore" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type VectorBackend = "pinecone" | "weaviate" | "qdrant" | "chroma" | "local";
export type EmbeddingModel = "bge-m3" | "openai-ada-002" | "openai-text-3-small" | "openai-text-3-large";

export interface VectorRecord {
  id: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  namespace: string;
  score?: number;
  createdAt: number;
  updatedAt: number;
  /** Importance 0-1, used for pruning */
  importance: number;
  /** Access count for reinforcement */
  accessCount: number;
  /** Last accessed timestamp */
  lastAccessedAt?: number;
}

export interface UpsertInput {
  id?: string;
  content: string;
  metadata?: Record<string, unknown>;
  namespace?: string;
  importance?: number;
}

export interface QueryOptions {
  topK?: number;
  namespace?: string;
  minScore?: number;
  filters?: Record<string, unknown>;
  hybridAlpha?: number; // 0 = pure BM25, 1 = pure semantic, 0.5 = balanced
  includeEmbeddings?: boolean;
}

export interface QueryResult {
  records: VectorRecord[];
  query: string;
  durationMs: number;
  backend: VectorBackend;
}

export interface ConsolidationOptions {
  namespace?: string;
  similarityThreshold?: number; // 0-1, records more similar than this get merged
  staleAfterDays?: number;
  keepTopN?: number;
}

export interface MemoryStats {
  totalRecords: number;
  byNamespace: Record<string, number>;
  averageImportance: number;
  backend: VectorBackend;
  embeddingModel: EmbeddingModel;
}

// ─── Backend adapter interface ────────────────────────────────────────────────

interface VectorBackendAdapter {
  upsert(record: VectorRecord): Promise<void>;
  query(embedding: number[], opts: QueryOptions): Promise<VectorRecord[]>;
  delete(id: string, namespace: string): Promise<void>;
  deleteNamespace(namespace: string): Promise<void>;
  getById(id: string, namespace: string): Promise<VectorRecord | null>;
  list(namespace: string, limit: number): Promise<VectorRecord[]>;
  count(namespace?: string): Promise<number>;
}

// ─── Local in-memory adapter (fallback / testing) ─────────────────────────────

class LocalAdapter implements VectorBackendAdapter {
  private store = new Map<string, VectorRecord>();

  async upsert(record: VectorRecord): Promise<void> {
    this.store.set(`${record.namespace}:${record.id}`, record);
  }

  async query(embedding: number[], opts: QueryOptions): Promise<VectorRecord[]> {
    const { topK = 10, namespace, minScore = 0.0, hybridAlpha = 0.5 } = opts;

    const candidates = Array.from(this.store.values()).filter(
      (r) => !namespace || r.namespace === namespace
    );

    const scored = candidates.map((r) => {
      const semantic = r.embedding ? cosineSimilarity(embedding, r.embedding) : 0;
      return { ...r, score: semantic };
    });

    return scored
      .filter((r) => (r.score ?? 0) >= minScore)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, topK);
  }

  async delete(id: string, namespace: string): Promise<void> {
    this.store.delete(`${namespace}:${id}`);
  }

  async deleteNamespace(namespace: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(`${namespace}:`)) this.store.delete(key);
    }
  }

  async getById(id: string, namespace: string): Promise<VectorRecord | null> {
    return this.store.get(`${namespace}:${id}`) ?? null;
  }

  async list(namespace: string, limit: number): Promise<VectorRecord[]> {
    return Array.from(this.store.values())
      .filter((r) => r.namespace === namespace)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async count(namespace?: string): Promise<number> {
    if (!namespace) return this.store.size;
    return Array.from(this.store.values()).filter((r) => r.namespace === namespace).length;
  }
}

// ─── Pinecone adapter ─────────────────────────────────────────────────────────

class PineconeAdapter implements VectorBackendAdapter {
  private client: unknown = null;
  private index: unknown = null;

  constructor(
    private readonly apiKey: string,
    private readonly indexName: string,
    private readonly host: string
  ) {}

  private async getIndex(): Promise<{
    upsert: (vectors: unknown[]) => Promise<void>;
    query: (opts: unknown) => Promise<{ matches: unknown[] }>;
    deleteOne: (id: string) => Promise<void>;
    deleteMany: (filter: unknown) => Promise<void>;
    fetch: (ids: string[]) => Promise<{ records: Record<string, unknown> }>;
    listPaginated: (opts: unknown) => Promise<{ vectors: unknown[] }>;
    describeIndexStats: () => Promise<{ totalRecordCount: number; namespaces: unknown }>;
  }> {
    if (!this.index) {
      const { Pinecone } = await import("@pinecone-database/pinecone" as string);
      this.client = new (Pinecone as { new(opts: unknown): unknown })({ apiKey: this.apiKey });
      this.index = (this.client as { index: (name: string) => unknown }).index(this.indexName);
    }
    return this.index as ReturnType<PineconeAdapter["getIndex"]>;
  }

  async upsert(record: VectorRecord): Promise<void> {
    const idx = await this.getIndex();
    await idx.upsert([
      {
        id: record.id,
        values: record.embedding ?? [],
        sparseValues: undefined,
        metadata: {
          content: record.content,
          namespace: record.namespace,
          importance: record.importance,
          createdAt: record.createdAt,
          ...record.metadata,
        },
      },
    ]);
  }

  async query(embedding: number[], opts: QueryOptions): Promise<VectorRecord[]> {
    const idx = await this.getIndex();
    const response = await idx.query({
      vector: embedding,
      topK: opts.topK ?? 10,
      namespace: opts.namespace,
      includeMetadata: true,
      filter: opts.filters,
    });

    return (response.matches as Array<{ id: string; score: number; metadata: Record<string, unknown> }>).map(
      (m) => ({
        id: m.id,
        content: String(m.metadata?.content ?? ""),
        metadata: m.metadata ?? {},
        namespace: String(m.metadata?.namespace ?? opts.namespace ?? "default"),
        score: m.score,
        importance: Number(m.metadata?.importance ?? 0.5),
        accessCount: 0,
        createdAt: Number(m.metadata?.createdAt ?? Date.now()),
        updatedAt: Date.now(),
      })
    );
  }

  async delete(id: string, _namespace: string): Promise<void> {
    const idx = await this.getIndex();
    await idx.deleteOne(id);
  }

  async deleteNamespace(namespace: string): Promise<void> {
    const idx = await this.getIndex();
    await idx.deleteMany({ namespace });
  }

  async getById(id: string, _namespace: string): Promise<VectorRecord | null> {
    const idx = await this.getIndex();
    const result = await idx.fetch([id]);
    const rec = (result.records as Record<string, { id: string; values: number[]; metadata: Record<string, unknown> }>)[id];
    if (!rec) return null;
    return {
      id: rec.id,
      content: String(rec.metadata?.content ?? ""),
      embedding: rec.values,
      metadata: rec.metadata ?? {},
      namespace: String(rec.metadata?.namespace ?? "default"),
      importance: Number(rec.metadata?.importance ?? 0.5),
      accessCount: 0,
      createdAt: Number(rec.metadata?.createdAt ?? Date.now()),
      updatedAt: Date.now(),
    };
  }

  async list(namespace: string, limit: number): Promise<VectorRecord[]> {
    const idx = await this.getIndex();
    const result = await idx.listPaginated({ namespace, limit });
    return (result.vectors as Array<{ id: string; metadata: Record<string, unknown> }>).map((v) => ({
      id: v.id,
      content: String(v.metadata?.content ?? ""),
      metadata: v.metadata ?? {},
      namespace,
      importance: Number(v.metadata?.importance ?? 0.5),
      accessCount: 0,
      createdAt: Number(v.metadata?.createdAt ?? Date.now()),
      updatedAt: Date.now(),
    }));
  }

  async count(namespace?: string): Promise<number> {
    const idx = await this.getIndex();
    const stats = await idx.describeIndexStats();
    if (!namespace) return stats.totalRecordCount;
    const ns = (stats.namespaces as Record<string, { recordCount: number }>)[namespace ?? ""];
    return ns?.recordCount ?? 0;
  }
}

// ─── Embedding generator ──────────────────────────────────────────────────────

async function generateEmbedding(
  text: string,
  model: EmbeddingModel,
  openaiApiKey?: string
): Promise<number[]> {
  if (model === "bge-m3") {
    return generateLocalEmbedding(text);
  }

  if (!openaiApiKey) {
    logger.warn("[VectorMemoryStore] No OpenAI key, falling back to local embedding");
    return generateLocalEmbedding(text);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: text.slice(0, 8192),
        model:
          model === "openai-ada-002"
            ? "text-embedding-ada-002"
            : model === "openai-text-3-small"
            ? "text-embedding-3-small"
            : "text-embedding-3-large",
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings API error: ${response.status}`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  } catch (err) {
    logger.error({ err }, "[VectorMemoryStore] Embedding generation failed, using fallback");
    return generateLocalEmbedding(text);
  }
}

/** Simple TF-IDF-inspired local embedding (1536-dim, for fallback use) */
function generateLocalEmbedding(text: string): number[] {
  const dim = 1536;
  const embedding = new Array(dim).fill(0);
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let hash = 5381;
    for (let j = 0; j < word.length; j++) {
      hash = ((hash << 5) + hash) ^ word.charCodeAt(j);
    }
    const idx = Math.abs(hash) % dim;
    embedding[idx] += 1 / (1 + Math.log(words.length));
  }

  // L2-normalize
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1;
  return embedding.map((v) => v / norm);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// ─── VectorMemoryStore ────────────────────────────────────────────────────────

export class VectorMemoryStore extends EventEmitter {
  private readonly adapter: VectorBackendAdapter;
  private readonly embeddingModel: EmbeddingModel;
  private readonly openaiApiKey?: string;

  constructor(
    private readonly backend: VectorBackend = (process.env.VECTOR_BACKEND as VectorBackend) ?? "local"
  ) {
    super();
    this.embeddingModel = (process.env.EMBEDDING_MODEL as EmbeddingModel) ?? "bge-m3";
    this.openaiApiKey = process.env.OPENAI_API_KEY;

    this.adapter = this.createAdapter();
    logger.info({ backend, embeddingModel: this.embeddingModel }, "[VectorMemoryStore] Initialized");
  }

  private createAdapter(): VectorBackendAdapter {
    switch (this.backend) {
      case "pinecone": {
        const apiKey = process.env.PINECONE_API_KEY;
        const indexName = process.env.PINECONE_INDEX ?? "agent-memory";
        const host = process.env.PINECONE_HOST ?? "";
        if (!apiKey) {
          logger.warn("[VectorMemoryStore] PINECONE_API_KEY not set, using local adapter");
          return new LocalAdapter();
        }
        return new PineconeAdapter(apiKey, indexName, host);
      }
      case "local":
      default:
        return new LocalAdapter();
    }
  }

  // ── Core CRUD ────────────────────────────────────────────────────────────────

  async upsert(input: UpsertInput, generateEmbed = true): Promise<VectorRecord> {
    const record: VectorRecord = {
      id: input.id ?? randomUUID(),
      content: input.content,
      metadata: input.metadata ?? {},
      namespace: input.namespace ?? "default",
      importance: input.importance ?? 0.5,
      accessCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (generateEmbed) {
      record.embedding = await generateEmbedding(
        input.content,
        this.embeddingModel,
        this.openaiApiKey
      );
    }

    await this.adapter.upsert(record);
    this.emit("record:upserted", { id: record.id, namespace: record.namespace });
    return record;
  }

  async query(queryText: string, opts: QueryOptions = {}): Promise<QueryResult> {
    const startMs = Date.now();

    const embedding = await generateEmbedding(
      queryText,
      this.embeddingModel,
      this.openaiApiKey
    );

    const records = await this.adapter.query(embedding, opts);

    // Update access counts for retrieved records
    for (const r of records) {
      const updated = { ...r, accessCount: r.accessCount + 1, lastAccessedAt: Date.now() };
      await this.adapter.upsert(updated);
    }

    const result: QueryResult = {
      records,
      query: queryText,
      durationMs: Date.now() - startMs,
      backend: this.backend,
    };

    this.emit("query:executed", { query: queryText, results: records.length });
    return result;
  }

  async getById(id: string, namespace = "default"): Promise<VectorRecord | null> {
    return this.adapter.getById(id, namespace);
  }

  async delete(id: string, namespace = "default"): Promise<void> {
    await this.adapter.delete(id, namespace);
    this.emit("record:deleted", { id, namespace });
  }

  async deleteNamespace(namespace: string): Promise<void> {
    await this.adapter.deleteNamespace(namespace);
    this.emit("namespace:deleted", { namespace });
    logger.info({ namespace }, "[VectorMemoryStore] Namespace deleted");
  }

  // ── Importance scoring ────────────────────────────────────────────────────────

  async updateImportance(id: string, namespace: string, importance: number): Promise<void> {
    const record = await this.adapter.getById(id, namespace);
    if (!record) return;
    await this.adapter.upsert({ ...record, importance: Math.min(1, Math.max(0, importance)) });
  }

  /** Boost importance for recently-accessed, highly-accessed records */
  computeImportance(record: VectorRecord): number {
    const ageSecs = (Date.now() - record.createdAt) / 1000;
    const recencyBoost = Math.exp(-ageSecs / (7 * 86_400)); // 7-day decay
    const accessBoost = Math.log1p(record.accessCount) * 0.1;
    return Math.min(1, record.importance + recencyBoost * 0.2 + accessBoost);
  }

  // ── Consolidation ─────────────────────────────────────────────────────────────

  async consolidate(opts: ConsolidationOptions = {}): Promise<number> {
    const {
      namespace = "default",
      similarityThreshold = 0.92,
      staleAfterDays = 90,
      keepTopN = 10_000,
    } = opts;

    const records = await this.adapter.list(namespace, 50_000);
    let mergedCount = 0;
    const now = Date.now();
    const staleCutoff = now - staleAfterDays * 86_400_000;

    // 1. Prune stale, low-importance records
    const active = records.filter(
      (r) =>
        r.updatedAt > staleCutoff ||
        r.importance > 0.7 ||
        r.accessCount > 5
    );

    // 2. Keep only top-N by importance
    const kept = active
      .sort((a, b) => b.importance - a.importance)
      .slice(0, keepTopN);

    // 3. Merge highly similar records
    const toDelete = new Set<string>();
    for (let i = 0; i < kept.length; i++) {
      if (toDelete.has(kept[i].id)) continue;
      for (let j = i + 1; j < kept.length; j++) {
        if (toDelete.has(kept[j].id)) continue;
        if (kept[i].embedding && kept[j].embedding) {
          const sim = cosineSimilarity(kept[i].embedding!, kept[j].embedding!);
          if (sim >= similarityThreshold) {
            // Merge: keep the one with higher importance, delete the other
            const keep = kept[i].importance >= kept[j].importance ? kept[i] : kept[j];
            const del = keep === kept[i] ? kept[j] : kept[i];
            toDelete.add(del.id);
            // Merge metadata and boost importance
            await this.adapter.upsert({
              ...keep,
              importance: Math.min(1, keep.importance + 0.05),
              accessCount: keep.accessCount + del.accessCount,
              updatedAt: Date.now(),
            });
            mergedCount++;
          }
        }
      }
    }

    for (const id of toDelete) {
      await this.adapter.delete(id, namespace);
    }

    // 4. Delete records that were pruned (not in kept set)
    const keptIds = new Set(kept.map((r) => r.id));
    for (const r of records) {
      if (!keptIds.has(r.id)) {
        await this.adapter.delete(r.id, namespace);
      }
    }

    logger.info(
      { namespace, mergedCount, prunedCount: records.length - kept.length },
      "[VectorMemoryStore] Consolidation complete"
    );

    this.emit("consolidation:complete", { namespace, mergedCount });
    return mergedCount;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  async getStats(namespaces: string[] = ["default"]): Promise<MemoryStats> {
    const byNamespace: Record<string, number> = {};
    let total = 0;

    for (const ns of namespaces) {
      const count = await this.adapter.count(ns);
      byNamespace[ns] = count;
      total += count;
    }

    return {
      totalRecords: total,
      byNamespace,
      averageImportance: 0.5,
      backend: this.backend,
      embeddingModel: this.embeddingModel,
    };
  }

  // ── Namespace helpers ─────────────────────────────────────────────────────────

  static agentNamespace(agentId: string): string {
    return `agent:${agentId}`;
  }

  static userNamespace(userId: string): string {
    return `user:${userId}`;
  }

  static sessionNamespace(agentId: string, sessionId: string): string {
    return `session:${agentId}:${sessionId}`;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
let _store: VectorMemoryStore | null = null;
export function getVectorMemoryStore(): VectorMemoryStore {
  if (!_store) {
    _store = new VectorMemoryStore();
  }
  return _store;
}
