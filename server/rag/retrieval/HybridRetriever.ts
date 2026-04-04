import { Logger } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Shared types (local definitions — not imported from UnifiedRAGPipeline)
// ---------------------------------------------------------------------------

interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  tokens: number;
  score: number;
  source: string;
  retrievalMethod: 'vector' | 'bm25' | 'hybrid' | 'metadata';
}

interface RetrievedQuery {
  text: string;
  namespace: string;
  topK: number;
  filter?: Record<string, unknown>;
  hybridAlpha?: number;
  minScore?: number;
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface RankerResult {
  chunkId: string;
  rank: number; // 1-based
  score: number;
  rankerName: string;
}

export interface RankerConfig {
  name: string;
  weight: number; // default 1.0
  enabled: boolean;
}

export interface BM25Config {
  k1: number; // default 1.5
  b: number;  // default 0.75
}

export interface MMRConfig {
  lambda: number; // default 0.5 — tradeoff relevance vs diversity
  topK: number;
}

export interface HybridRetrieverConfig {
  rankers: RankerConfig[];
  bm25: BM25Config;
  mmr: MMRConfig;
  rrfK: number; // default 60
}

// ---------------------------------------------------------------------------
// English stopwords
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'need',
  'dare', 'ought', 'used', 'a', 'an', 'and', 'but', 'or',
  'for', 'nor', 'on', 'at', 'to', 'in', 'of',
]);

// ---------------------------------------------------------------------------
// InMemoryBM25 (private)
// ---------------------------------------------------------------------------

interface BM25Document {
  id: string;
  tokens: string[];
  content: string;
}

class InMemoryBM25 {
  private documents: Map<string, BM25Document> = new Map();
  private config: BM25Config;
  private dfCache: Map<string, number> = new Map();
  private avgdl = 0;

  constructor(config: BM25Config) {
    this.config = config;
  }

  addDocument(id: string, content: string): void {
    const tokens = this._tokenize(content);
    this.documents.set(id, { id, tokens, content });
    this._rebuildDf();
  }

  search(query: string, topK: number): RankerResult[] {
    const queryTokens = this._tokenize(query).filter(t => !STOPWORDS.has(t));
    if (queryTokens.length === 0 || this.documents.size === 0) return [];

    const N = this.documents.size;
    const scores: Array<{ id: string; score: number }> = [];

    for (const [id, doc] of this.documents) {
      const tfMap = this._tfMap(doc.tokens);
      const dl = doc.tokens.length;
      let score = 0;

      for (const term of queryTokens) {
        const tf = tfMap.get(term) ?? 0;
        if (tf === 0) continue;

        const df = this.dfCache.get(term) ?? 0;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        const { k1, b } = this.config;
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (dl / (this.avgdl || 1)));
        score += idf * (numerator / denominator);
      }

      if (score > 0) scores.push({ id, score });
    }

    scores.sort((a, b) => b.score - a.score);
    const topResults = scores.slice(0, topK);

    return topResults.map((item, idx) => ({
      chunkId: item.id,
      rank: idx + 1,
      score: item.score,
      rankerName: 'bm25',
    }));
  }

  removeDocument(id: string): void {
    this.documents.delete(id);
    this._rebuildDf();
  }

  clear(): void {
    this.documents.clear();
    this.dfCache.clear();
    this.avgdl = 0;
  }

  get size(): number {
    return this.documents.size;
  }

  private _tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter(t => t.length > 1 && !STOPWORDS.has(t));
  }

  private _tfMap(tokens: string[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const t of tokens) map.set(t, (map.get(t) ?? 0) + 1);
    return map;
  }

  private _rebuildDf(): void {
    this.dfCache.clear();
    let totalTokens = 0;

    for (const doc of this.documents.values()) {
      totalTokens += doc.tokens.length;
      const unique = new Set(doc.tokens);
      for (const term of unique) {
        this.dfCache.set(term, (this.dfCache.get(term) ?? 0) + 1);
      }
    }

    this.avgdl = this.documents.size > 0
      ? totalTokens / this.documents.size
      : 0;
  }
}

// ---------------------------------------------------------------------------
// VectorRanker (private)
// ---------------------------------------------------------------------------

interface VectorDocument {
  id: string;
  vector: number[];
  content: string;
}

class VectorRanker {
  private documents: Map<string, VectorDocument> = new Map();

  addDocument(id: string, vector: number[], content: string): void {
    this.documents.set(id, { id, vector, content });
  }

  search(queryVector: number[], topK: number): RankerResult[] {
    if (this.documents.size === 0 || queryVector.length === 0) return [];

    const scores: Array<{ id: string; score: number }> = [];

    for (const [id, doc] of this.documents) {
      const sim = this.cosineSimilarity(queryVector, doc.vector);
      scores.push({ id, score: sim });
    }

    scores.sort((a, b) => b.score - a.score);
    const topResults = scores.slice(0, topK);

    return topResults.map((item, idx) => ({
      chunkId: item.id,
      rank: idx + 1,
      score: item.score,
      rankerName: 'vector',
    }));
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const len = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  removeDocument(id: string): void {
    this.documents.delete(id);
  }

  get size(): number {
    return this.documents.size;
  }
}

// ---------------------------------------------------------------------------
// Default configs
// ---------------------------------------------------------------------------

const DEFAULT_BM25_CONFIG: BM25Config = { k1: 1.5, b: 0.75 };

const DEFAULT_MMR_CONFIG: MMRConfig = { lambda: 0.5, topK: 10 };

const DEFAULT_HYBRID_CONFIG: HybridRetrieverConfig = {
  rankers: [
    { name: 'bm25', weight: 1.0, enabled: true },
    { name: 'vector', weight: 1.0, enabled: true },
  ],
  bm25: DEFAULT_BM25_CONFIG,
  mmr: DEFAULT_MMR_CONFIG,
  rrfK: 60,
};

// ---------------------------------------------------------------------------
// HybridRetriever (exported)
// ---------------------------------------------------------------------------

export class HybridRetriever {
  private bm25: InMemoryBM25;
  private vector: VectorRanker;
  private documents: Map<string, RetrievedChunk> = new Map();
  private config: HybridRetrieverConfig;

  constructor(config?: Partial<HybridRetrieverConfig>) {
    this.config = {
      ...DEFAULT_HYBRID_CONFIG,
      ...config,
      bm25: { ...DEFAULT_BM25_CONFIG, ...(config?.bm25 ?? {}) },
      mmr: { ...DEFAULT_MMR_CONFIG, ...(config?.mmr ?? {}) },
      rankers: config?.rankers ?? DEFAULT_HYBRID_CONFIG.rankers,
    };

    this.bm25 = new InMemoryBM25(this.config.bm25);
    this.vector = new VectorRanker();

    Logger.debug('HybridRetriever initialized', { config: this.config });
  }

  addChunk(chunk: RetrievedChunk, vector?: number[]): void {
    this.documents.set(chunk.id, chunk);

    const bm25Ranker = this.config.rankers.find(r => r.name === 'bm25');
    if (bm25Ranker?.enabled !== false) {
      this.bm25.addDocument(chunk.id, chunk.content);
    }

    const vectorRanker = this.config.rankers.find(r => r.name === 'vector');
    if (vectorRanker?.enabled !== false && vector && vector.length > 0) {
      this.vector.addDocument(chunk.id, vector, chunk.content);
    }
  }

  addChunks(chunks: Array<{ chunk: RetrievedChunk; vector?: number[] }>): void {
    for (const { chunk, vector } of chunks) {
      this.addChunk(chunk, vector);
    }
    Logger.debug('HybridRetriever.addChunks', { count: chunks.length });
  }

  async retrieve(query: RetrievedQuery, queryVector?: number[]): Promise<RetrievedChunk[]> {
    Logger.info('HybridRetriever.retrieve', {
      query: query.text,
      namespace: query.namespace,
      topK: query.topK,
    });

    const rankerResultsMap = new Map<string, RankerResult[]>();
    const expandedTopK = query.topK * 4; // retrieve more candidates before MMR

    // BM25 ranker
    const bm25Config = this.config.rankers.find(r => r.name === 'bm25');
    if (bm25Config?.enabled !== false) {
      const bm25Results = this.bm25.search(query.text, expandedTopK);
      if (bm25Results.length > 0) {
        rankerResultsMap.set('bm25', bm25Results);
        Logger.debug('BM25 ranker results', { count: bm25Results.length });
      }
    }

    // Vector ranker
    const vectorConfig = this.config.rankers.find(r => r.name === 'vector');
    if (vectorConfig?.enabled !== false && queryVector && queryVector.length > 0) {
      const vectorResults = this.vector.search(queryVector, expandedTopK);
      if (vectorResults.length > 0) {
        rankerResultsMap.set('vector', vectorResults);
        Logger.debug('Vector ranker results', { count: vectorResults.length });
      }
    }

    if (rankerResultsMap.size === 0) {
      Logger.warn('HybridRetriever: no ranker produced results', { query: query.text });
      return [];
    }

    // RRF fusion
    const fusedScores = this._rrfFuse(rankerResultsMap);

    // Build candidate list sorted by fused score
    const minScore = query.minScore ?? 0;
    const candidates: RetrievedChunk[] = [];

    const sortedEntries = Array.from(fusedScores.entries())
      .sort((a, b) => b[1] - a[1]);

    for (const [chunkId, fusedScore] of sortedEntries) {
      if (fusedScore < minScore) continue;
      const chunk = this.documents.get(chunkId);
      if (!chunk) continue;

      candidates.push({
        ...chunk,
        score: fusedScore,
        retrievalMethod: 'hybrid',
      });
    }

    // Apply MMR diversity
    const mmrTopK = Math.min(query.topK, this.config.mmr.topK);
    const diverseResults = this._applyMMR([], candidates, this.config.mmr.lambda, mmrTopK);

    Logger.info('HybridRetriever.retrieve complete', {
      candidates: candidates.length,
      returned: diverseResults.length,
    });

    return diverseResults;
  }

  private _rrfFuse(rankerResults: Map<string, RankerResult[]>): Map<string, number> {
    const fusedScores = new Map<string, number>();
    const k = this.config.rrfK;

    for (const [rankerName, results] of rankerResults) {
      const rankerConfig = this.config.rankers.find(r => r.name === rankerName);
      const weight = rankerConfig?.weight ?? 1.0;

      for (const result of results) {
        const contribution = weight * (1 / (k + result.rank));
        fusedScores.set(
          result.chunkId,
          (fusedScores.get(result.chunkId) ?? 0) + contribution,
        );
      }
    }

    return fusedScores;
  }

  private _applyMMR(
    selected: RetrievedChunk[],
    candidates: RetrievedChunk[],
    lambda: number,
    topK: number,
  ): RetrievedChunk[] {
    const result: RetrievedChunk[] = [...selected];
    const remaining = [...candidates];

    while (result.length < topK && remaining.length > 0) {
      let bestIdx = -1;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const relevance = candidate.score;

        let maxSimilarityToSelected = 0;
        for (const selectedChunk of result) {
          const sim = this._jaccardSimilarity(candidate.content, selectedChunk.content);
          if (sim > maxSimilarityToSelected) maxSimilarityToSelected = sim;
        }

        const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarityToSelected;

        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) break;

      result.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    }

    return result;
  }

  private _jaccardSimilarity(textA: string, textB: string): number {
    const wordsA = new Set(textA.toLowerCase().split(/\W+/).filter(w => w.length > 1));
    const wordsB = new Set(textB.toLowerCase().split(/\W+/).filter(w => w.length > 1));

    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersectionSize = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersectionSize++;
    }

    const unionSize = wordsA.size + wordsB.size - intersectionSize;
    return unionSize === 0 ? 0 : intersectionSize / unionSize;
  }

  remove(chunkId: string): void {
    this.documents.delete(chunkId);
    this.bm25.removeDocument(chunkId);
    this.vector.removeDocument(chunkId);
    Logger.debug('HybridRetriever.remove', { chunkId });
  }

  clear(): void {
    this.documents.clear();
    this.bm25.clear();
    // Re-instantiate vector ranker since it has no clear() method
    this.vector = new VectorRanker();
    Logger.info('HybridRetriever cleared');
  }

  getStats(): { documents: number; bm25Indexed: number; vectorIndexed: number } {
    return {
      documents: this.documents.size,
      bm25Indexed: this.bm25.size,
      vectorIndexed: this.vector.size,
    };
  }
}
