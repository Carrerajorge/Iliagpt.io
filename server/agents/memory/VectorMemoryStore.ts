import { randomUUID } from 'crypto';
import { Logger } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Interfaces & Enums
// ---------------------------------------------------------------------------

export interface VectorRecord {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
  namespace: string;
  score?: number;
  createdAt: Date;
  metadata: {
    source: string;
    agentId: string;
    userId?: string;
    tags: string[];
    expiresAt?: Date;
    accessCount?: number;
    lastAccessedAt?: Date;
  };
}

export interface SearchQuery {
  vector?: number[];
  text?: string;
  namespace: string;
  topK: number;
  filter?: Record<string, unknown>;
  minScore?: number;
  hybridAlpha?: number; // 0 = pure BM25, 1 = pure semantic
}

export interface SearchResult {
  record: VectorRecord;
  score: number;
  highlights?: string[];
}

export enum VectorStoreBackend {
  PINECONE = 'PINECONE',
  WEAVIATE = 'WEAVIATE',
  QDRANT = 'QDRANT',
  CHROMADB = 'CHROMADB',
  FAISS = 'FAISS',
  MEMORY = 'MEMORY',
}

export interface VectorStoreConfig {
  backend: VectorStoreBackend;
  namespace: string;
  dimension?: number; // default 1536
  apiKey?: string;
  endpoint?: string;
  collectionName?: string;
  indexName?: string;
}

export interface IVectorStore {
  upsert(record: VectorRecord): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult[]>;
  delete(id: string, namespace: string): Promise<boolean>;
  deleteNamespace(namespace: string): Promise<number>;
  count(namespace: string): Promise<number>;
  healthCheck(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Math utilities
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// BM25 helpers
// ---------------------------------------------------------------------------

interface BM25Index {
  // term -> { docId -> term frequency }
  termFreqs: Map<string, Map<string, number>>;
  // docId -> total terms in doc
  docLengths: Map<string, number>;
  // docId -> raw text
  docTexts: Map<string, string>;
  avgDocLength: number;
  docCount: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function buildBM25Index(records: VectorRecord[]): BM25Index {
  const termFreqs = new Map<string, Map<string, number>>();
  const docLengths = new Map<string, number>();
  const docTexts = new Map<string, string>();
  let totalLength = 0;

  for (const rec of records) {
    const text = extractText(rec);
    docTexts.set(rec.id, text);
    const tokens = tokenize(text);
    docLengths.set(rec.id, tokens.length);
    totalLength += tokens.length;

    const freqMap = new Map<string, number>();
    for (const tok of tokens) {
      freqMap.set(tok, (freqMap.get(tok) ?? 0) + 1);
    }
    for (const [term, freq] of freqMap) {
      if (!termFreqs.has(term)) termFreqs.set(term, new Map());
      termFreqs.get(term)!.set(rec.id, freq);
    }
  }

  return {
    termFreqs,
    docLengths,
    docTexts,
    avgDocLength: records.length > 0 ? totalLength / records.length : 0,
    docCount: records.length,
  };
}

function bm25Score(
  query: string,
  docId: string,
  index: BM25Index,
  k1 = 1.5,
  b = 0.75,
): number {
  const tokens = tokenize(query);
  const docLen = index.docLengths.get(docId) ?? 0;
  let score = 0;

  for (const term of tokens) {
    const df = index.termFreqs.get(term)?.size ?? 0;
    if (df === 0) continue;
    const tf = index.termFreqs.get(term)?.get(docId) ?? 0;
    const idf = Math.log((index.docCount - df + 0.5) / (df + 0.5) + 1);
    const numerator = tf * (k1 + 1);
    const denominator =
      tf + k1 * (1 - b + b * (docLen / (index.avgDocLength || 1)));
    score += idf * (numerator / denominator);
  }
  return score;
}

function extractText(record: VectorRecord): string {
  const parts: string[] = [];
  for (const val of Object.values(record.payload)) {
    if (typeof val === 'string') parts.push(val);
  }
  parts.push(...record.metadata.tags);
  return parts.join(' ');
}

function matchesFilter(
  record: VectorRecord,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith('metadata.')) {
      const metaKey = key.slice('metadata.'.length) as keyof typeof record.metadata;
      const actual = record.metadata[metaKey];
      if (Array.isArray(actual) && Array.isArray(value)) {
        const valueArr = value as unknown[];
        if (!valueArr.every((v) => (actual as unknown[]).includes(v))) return false;
      } else if (actual !== value) {
        return false;
      }
    } else {
      if (record.payload[key] !== value) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// InMemoryVectorStore
// ---------------------------------------------------------------------------

export class InMemoryVectorStore implements IVectorStore {
  private readonly records: Map<string, VectorRecord> = new Map();

  private namespaceKey(namespace: string, id: string): string {
    return `${namespace}::${id}`;
  }

  private recordsInNamespace(namespace: string): VectorRecord[] {
    const result: VectorRecord[] = [];
    for (const [key, rec] of this.records) {
      if (key.startsWith(`${namespace}::`)) result.push(rec);
    }
    return result;
  }

  async upsert(record: VectorRecord): Promise<void> {
    const key = this.namespaceKey(record.namespace, record.id);
    this.records.set(key, { ...record });
    Logger.debug(`[InMemoryVectorStore] upsert id=${record.id} ns=${record.namespace}`);
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const alpha = query.hybridAlpha ?? 1.0; // default pure semantic
    const candidates = this.recordsInNamespace(query.namespace).filter((r) => {
      // TTL check
      if (r.metadata.expiresAt && r.metadata.expiresAt <= new Date()) return false;
      // filter check
      if (query.filter && !matchesFilter(r, query.filter)) return false;
      return true;
    });

    if (candidates.length === 0) return [];

    if (alpha >= 1.0 || !query.text) {
      // Pure semantic
      return this._semanticSearch(query, candidates);
    }

    if (alpha <= 0.0 || !query.vector) {
      // Pure BM25
      return this._bm25Search(query, candidates);
    }

    return this.hybridSearch(query, candidates);
  }

  private _semanticSearch(
    query: SearchQuery,
    candidates: VectorRecord[],
  ): SearchResult[] {
    if (!query.vector) return [];
    const results: SearchResult[] = candidates
      .map((rec) => ({
        record: rec,
        score: cosineSimilarity(query.vector!, rec.vector),
      }))
      .filter((r) => r.score >= (query.minScore ?? 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.topK);
    return results;
  }

  private _bm25Search(
    query: SearchQuery,
    candidates: VectorRecord[],
  ): SearchResult[] {
    if (!query.text) return [];
    const index = buildBM25Index(candidates);
    const results: SearchResult[] = candidates
      .map((rec) => ({
        record: rec,
        score: bm25Score(query.text!, rec.id, index),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, query.topK);
    return results;
  }

  hybridSearch(
    query: SearchQuery,
    candidates?: VectorRecord[],
  ): SearchResult[] {
    const alpha = query.hybridAlpha ?? 0.5;
    const pool = candidates ?? this.recordsInNamespace(query.namespace);

    if (pool.length === 0) return [];

    const index = buildBM25Index(pool);

    // Compute raw scores
    const semanticScores = new Map<string, number>();
    const bm25Scores = new Map<string, number>();

    for (const rec of pool) {
      if (query.vector) {
        semanticScores.set(rec.id, cosineSimilarity(query.vector, rec.vector));
      }
      if (query.text) {
        bm25Scores.set(rec.id, bm25Score(query.text, rec.id, index));
      }
    }

    // Normalize BM25 scores to [0,1]
    const maxBM25 = Math.max(0.0001, ...bm25Scores.values());
    for (const [id, score] of bm25Scores) {
      bm25Scores.set(id, score / maxBM25);
    }

    const combined: SearchResult[] = pool.map((rec) => {
      const sem = semanticScores.get(rec.id) ?? 0;
      const bm = bm25Scores.get(rec.id) ?? 0;
      const score = alpha * sem + (1 - alpha) * bm;
      return { record: rec, score };
    });

    return combined
      .filter((r) => r.score >= (query.minScore ?? 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.topK);
  }

  async delete(id: string, namespace: string): Promise<boolean> {
    const key = this.namespaceKey(namespace, id);
    return this.records.delete(key);
  }

  async deleteNamespace(namespace: string): Promise<number> {
    const keys = [...this.records.keys()].filter((k) =>
      k.startsWith(`${namespace}::`),
    );
    for (const k of keys) this.records.delete(k);
    return keys.length;
  }

  async count(namespace: string): Promise<number> {
    return this.recordsInNamespace(namespace).length;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

// ---------------------------------------------------------------------------
// VectorMemoryStore — main class
// ---------------------------------------------------------------------------

export class VectorMemoryStore {
  private readonly store: IVectorStore;
  private readonly config: Required<VectorStoreConfig>;
  private readonly accessLog: Map<string, { count: number; lastAt: Date }> =
    new Map();

  private constructor(store: IVectorStore, config: VectorStoreConfig) {
    this.store = store;
    this.config = {
      backend: config.backend,
      namespace: config.namespace,
      dimension: config.dimension ?? 1536,
      apiKey: config.apiKey ?? '',
      endpoint: config.endpoint ?? '',
      collectionName: config.collectionName ?? config.namespace,
      indexName: config.indexName ?? config.namespace,
    };
  }

  static create(config: VectorStoreConfig): VectorMemoryStore {
    let store: IVectorStore;
    switch (config.backend) {
      case VectorStoreBackend.MEMORY:
        store = new InMemoryVectorStore();
        break;
      case VectorStoreBackend.PINECONE:
        // TODO: Install @pinecone-database/pinecone and initialize PineconeClient
        Logger.warn('[VectorMemoryStore] Pinecone backend not wired — falling back to MEMORY');
        store = new InMemoryVectorStore();
        break;
      case VectorStoreBackend.WEAVIATE:
        // TODO: Install weaviate-ts-client and initialize WeaviateClient
        Logger.warn('[VectorMemoryStore] Weaviate backend not wired — falling back to MEMORY');
        store = new InMemoryVectorStore();
        break;
      case VectorStoreBackend.QDRANT:
        // TODO: Install @qdrant/js-client-rest and initialize QdrantClient
        Logger.warn('[VectorMemoryStore] Qdrant backend not wired — falling back to MEMORY');
        store = new InMemoryVectorStore();
        break;
      case VectorStoreBackend.CHROMADB:
        // TODO: Install chromadb and initialize ChromaClient
        Logger.warn('[VectorMemoryStore] ChromaDB backend not wired — falling back to MEMORY');
        store = new InMemoryVectorStore();
        break;
      case VectorStoreBackend.FAISS:
        // TODO: Install faiss-node and initialize FAISS index
        Logger.warn('[VectorMemoryStore] FAISS backend not wired — falling back to MEMORY');
        store = new InMemoryVectorStore();
        break;
      default:
        store = new InMemoryVectorStore();
    }
    Logger.info(`[VectorMemoryStore] created backend=${config.backend} ns=${config.namespace}`);
    return new VectorMemoryStore(store, config);
  }

  async upsert(record: VectorRecord): Promise<void> {
    await this.store.upsert(record);
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const results = await this.store.search(query);
    // Update access log
    for (const r of results) {
      const entry = this.accessLog.get(r.record.id) ?? { count: 0, lastAt: new Date() };
      entry.count++;
      entry.lastAt = new Date();
      this.accessLog.set(r.record.id, entry);
    }
    return results;
  }

  async delete(id: string, namespace: string): Promise<boolean> {
    return this.store.delete(id, namespace);
  }

  async deleteNamespace(namespace: string): Promise<number> {
    return this.store.deleteNamespace(namespace);
  }

  async count(namespace: string): Promise<number> {
    return this.store.count(namespace);
  }

  async healthCheck(): Promise<boolean> {
    return this.store.healthCheck();
  }

  importanceScore(record: VectorRecord): number {
    const now = Date.now();
    const ageMs = now - record.createdAt.getTime();
    const ageHours = ageMs / 3_600_000;

    // Recency: exponential decay with 168-hour half-life
    const recency = Math.exp((-Math.log(2) / 168) * ageHours);

    // Access frequency from log
    const accessInfo = this.accessLog.get(record.id);
    const accessCount = accessInfo?.count ?? record.metadata.accessCount ?? 0;
    const freqScore = Math.min(1, accessCount / 20); // cap at 20 accesses = 1.0

    // Tag boost — tags starting with 'important' or 'critical' get a boost
    const importantTags = record.metadata.tags.filter(
      (t) => t.startsWith('important') || t.startsWith('critical'),
    ).length;
    const tagBoost = Math.min(0.3, importantTags * 0.1);

    return Math.min(1.0, recency * 0.5 + freqScore * 0.35 + tagBoost + 0.15);
  }

  async pruneByImportance(namespace: string, keepTopN: number): Promise<number> {
    const count = await this.store.count(namespace);
    if (count <= keepTopN) return 0;

    // We need access to raw records — only InMemoryVectorStore exposes them
    if (!(this.store instanceof InMemoryVectorStore)) {
      Logger.warn('[VectorMemoryStore] pruneByImportance only supported for MEMORY backend');
      return 0;
    }

    const memStore = this.store as InMemoryVectorStore;
    // Access private records via a search with a zero vector (returns all if no vector)
    const allResults = await memStore.search({
      namespace,
      topK: count + 1000,
      text: '',
      vector: new Array(this.config.dimension).fill(0) as number[],
      minScore: -Infinity,
    });

    const scored = allResults.map((r) => ({
      id: r.record.id,
      importance: this.importanceScore(r.record),
    }));
    scored.sort((a, b) => b.importance - a.importance);

    const toPrune = scored.slice(keepTopN);
    let pruned = 0;
    for (const item of toPrune) {
      const deleted = await this.store.delete(item.id, namespace);
      if (deleted) pruned++;
    }

    Logger.info(`[VectorMemoryStore] pruned ${pruned} records from namespace=${namespace}`);
    return pruned;
  }

  getConfig(): Readonly<Required<VectorStoreConfig>> {
    return this.config;
  }
}
