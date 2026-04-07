/**
 * HybridRetriever — Reciprocal Rank Fusion across BM25 and vector rankers.
 * Supports an in-memory compatibility mode for unit tests plus a DB-backed
 * fallback for production-oriented callers.
 */

import { createLogger } from "../../utils/logger";
import { db } from "../../db";
import { ragChunks } from "@shared/schema/rag";
import { eq, and, inArray, sql } from "drizzle-orm";
import type {
  RetrieveStage,
  RetrievedChunk,
  RetrieveOptions,
  RetrievedQuery,
  ChunkType,
  ChunkMetadata,
} from "../UnifiedRAGPipeline";
import { cosineSimilarity } from "../UnifiedRAGPipeline";

const logger = createLogger("HybridRetriever");

export interface HybridRetrieverConfig {
  rrfK: number;
  weights: {
    bm25: number;
    vector: number;
    metadata: number;
    freshness: number;
  };
  minScore: number;
  mmrLambda: number;
  freshnessHalfLifeMs: number;
}

type RankerName = keyof HybridRetrieverConfig["weights"];

type RankerOverride = {
  name: RankerName;
  weight?: number;
  enabled?: boolean;
};

type HybridRetrieverConstructorConfig = Partial<HybridRetrieverConfig> & {
  mmr?: {
    lambda?: number;
    topK?: number;
  };
  rankers?: RankerOverride[];
};

const DEFAULT_CONFIG: HybridRetrieverConfig = {
  rrfK: 60,
  weights: { bm25: 1.0, vector: 1.0, metadata: 0.0, freshness: 0.0 },
  minScore: 0.0,
  mmrLambda: 0.7,
  freshnessHalfLifeMs: 7 * 24 * 60 * 60 * 1000,
};

const STOP_WORDS_EN = new Set(["the", "is", "are", "of", "and", "to", "in", "for", "with", "that", "this", "have", "it", "at", "be", "from", "or", "an", "by", "we", "you"]);
const STOP_WORDS_ES = new Set(["el", "la", "los", "las", "de", "que", "en", "un", "una", "es", "por", "con", "del", "al", "se", "no", "a", "su", "si", "más", "pero", "hay"]);
const STOP_WORDS = new Set([...STOP_WORDS_EN, ...STOP_WORDS_ES]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function bm25Score(
  queryTerms: string[],
  docTerms: string[],
  avgDocLength: number,
  docFreq: Map<string, number>,
  totalDocs: number,
  k1 = 1.5,
  b = 0.75,
): number {
  const docLength = docTerms.length;
  const termFreq = new Map<string, number>();
  for (const t of docTerms) {
    termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const tf = termFreq.get(term) ?? 0;
    if (tf === 0) continue;
    const df = docFreq.get(term) ?? 0;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
    score += idf * (numerator / denominator);
  }
  return score;
}

function metadataScore(query: string, chunk: { content: string; sectionTitle?: string | null; chunkType?: string | null }): number {
  const q = query.toLowerCase();
  let score = 0;

  if (chunk.chunkType === "heading") score += 0.3;

  if (chunk.sectionTitle) {
    const titleWords = tokenize(chunk.sectionTitle);
    const queryWords = tokenize(query);
    const overlap = queryWords.filter((w) => titleWords.includes(w)).length;
    score += overlap * 0.2;
  }

  if (chunk.chunkType === "table" && /\b(tabla|table|datos|data|total|suma|sum|average|promedio)\b/i.test(q)) {
    score += 0.4;
  }

  if (chunk.chunkType === "code" && /\b(function|code|función|clase|class|implement|ejemplo|example)\b/i.test(q)) {
    score += 0.3;
  }

  return Math.min(1, score);
}

function freshnessScore(createdAt: Date | null | undefined, halfLifeMs: number): number {
  if (!createdAt) return 0.5;
  const ageMs = Date.now() - createdAt.getTime();
  return Math.exp((-Math.log(2) * ageMs) / halfLifeMs);
}

function mmrRerank(
  candidates: Array<RetrievedChunk & { embedding?: number[] }>,
  queryEmbedding: number[],
  lambda: number,
  topK: number,
): RetrievedChunk[] {
  if (candidates.length === 0) return [];

  const selected: typeof candidates = [];
  const remaining = [...candidates];

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const relevance = cand.embedding ? cosineSimilarity(queryEmbedding, cand.embedding) : cand.score;

      let maxSim = 0;
      for (const sel of selected) {
        if (cand.embedding && sel.embedding) {
          const sim = cosineSimilarity(cand.embedding, sel.embedding);
          if (sim > maxSim) maxSim = sim;
        }
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

interface RawChunk {
  id: string;
  content: string;
  embedding: number[] | null;
  chunkType: string | null;
  sectionTitle: string | null;
  source: string;
  sourceId: string | null;
  pageNumber: number | null;
  language: string | null;
  title: string | null;
  tags: string[] | null;
  importance: number | null;
  createdAt: Date;
  metadata: Record<string, unknown>;
  chunkIndex: number;
}

interface LocalChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  tokens: number;
  source: string;
  embedding?: number[];
  chunkType?: string | null;
  sectionTitle?: string | null;
  sourceId?: string | null;
  pageNumber?: number | null;
  language?: string | null;
  importance?: number | null;
  createdAt: Date;
}

async function fetchCandidates(options: RetrieveOptions): Promise<RawChunk[]> {
  const conditions = [];

  if (options.filterUserId) {
    conditions.push(eq(ragChunks.userId, options.filterUserId));
  }
  if (options.filterSourceIds && options.filterSourceIds.length > 0) {
    conditions.push(inArray(ragChunks.sourceId, options.filterSourceIds));
  }
  if (options.filterLanguage) {
    conditions.push(eq(ragChunks.language, options.filterLanguage));
  }
  if (options.filterChunkTypes && options.filterChunkTypes.length > 0) {
    conditions.push(inArray(ragChunks.chunkType, options.filterChunkTypes));
  }

  conditions.push(eq(ragChunks.isActive, true));

  const rows = await db
    .select({
      id: ragChunks.id,
      content: ragChunks.content,
      embedding: ragChunks.embedding,
      chunkType: ragChunks.chunkType,
      sectionTitle: ragChunks.sectionTitle,
      source: ragChunks.source,
      sourceId: ragChunks.sourceId,
      pageNumber: ragChunks.pageNumber,
      language: ragChunks.language,
      title: ragChunks.title,
      tags: ragChunks.tags,
      importance: ragChunks.importance,
      createdAt: ragChunks.createdAt,
      metadata: ragChunks.metadata,
      chunkIndex: ragChunks.chunkIndex,
    })
    .from(ragChunks)
    .where(conditions.length > 0 ? and(...conditions) : sql`TRUE`)
    .limit(2000);

  return rows as RawChunk[];
}

export class HybridRetriever implements RetrieveStage {
  private readonly config: HybridRetrieverConfig;
  private readonly localChunks = new Map<string, LocalChunk>();

  constructor(config: HybridRetrieverConstructorConfig = {}) {
    const weights = { ...DEFAULT_CONFIG.weights, ...(config.weights ?? {}) };

    if (config.rankers) {
      for (const ranker of config.rankers) {
        weights[ranker.name] = ranker.enabled === false ? 0 : (ranker.weight ?? weights[ranker.name]);
      }
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      weights,
      mmrLambda: config.mmr?.lambda ?? config.mmrLambda ?? DEFAULT_CONFIG.mmrLambda,
    };
  }

  addChunk(chunk: RetrievedChunk, embedding?: number[]): void {
    const metadata = chunk.metadata ?? {};
    this.localChunks.set(chunk.id, {
      id: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      metadata,
      tokens: chunk.tokens,
      source: chunk.source,
      embedding,
      chunkType: (metadata.chunkType as string | undefined) ?? null,
      sectionTitle: (metadata.sectionTitle as string | undefined) ?? null,
      sourceId: (metadata.sourceFile as string | undefined) ?? chunk.documentId,
      pageNumber: (metadata.pageNumber as number | undefined) ?? null,
      language: (metadata.language as string | undefined) ?? null,
      importance: null,
      createdAt: new Date(),
    });
  }

  remove(id: string): void {
    this.localChunks.delete(id);
  }

  clear(): void {
    this.localChunks.clear();
  }

  getStats(): { documents: number; bm25Indexed: number } {
    return {
      documents: this.localChunks.size,
      bm25Indexed: this.localChunks.size,
    };
  }

  async retrieve(
    queryOrText: RetrievedQuery | string,
    queryEmbeddingOrOptions: number[] | RetrieveOptions = [],
    options: RetrieveOptions = {},
  ): Promise<RetrievedChunk[]> {
    const normalized = this.normalizeRequest(queryOrText, queryEmbeddingOrOptions, options);
    if (normalized.topK <= 0) {
      return [];
    }

    if (this.localChunks.size > 0 || typeof queryOrText !== "string") {
      return this.retrieveFromLocal(normalized.query, normalized.queryEmbedding, normalized.topK, normalized.minScore);
    }

    return this.retrieveFromDatabase(normalized.query, normalized.queryEmbedding, {
      ...normalized.retrieveOptions,
      topK: normalized.topK,
      minScore: normalized.minScore,
    });
  }

  private normalizeRequest(
    queryOrText: RetrievedQuery | string,
    queryEmbeddingOrOptions: number[] | RetrieveOptions,
    options: RetrieveOptions,
  ): {
    query: string;
    queryEmbedding: number[];
    topK: number;
    minScore: number;
    retrieveOptions: RetrieveOptions;
  } {
    if (typeof queryOrText === "string") {
      if (Array.isArray(queryEmbeddingOrOptions)) {
        return {
          query: queryOrText,
          queryEmbedding: queryEmbeddingOrOptions,
          topK: options.topK ?? 10,
          minScore: options.minScore ?? this.config.minScore,
          retrieveOptions: options,
        };
      }

      return {
        query: queryOrText,
        queryEmbedding: [],
        topK: queryEmbeddingOrOptions.topK ?? 10,
        minScore: queryEmbeddingOrOptions.minScore ?? this.config.minScore,
        retrieveOptions: queryEmbeddingOrOptions,
      };
    }

    return {
      query: queryOrText.text,
      queryEmbedding: Array.isArray(queryEmbeddingOrOptions) ? queryEmbeddingOrOptions : [],
      topK: queryOrText.topK ?? options.topK ?? 10,
      minScore: queryOrText.minScore ?? options.minScore ?? this.config.minScore,
      retrieveOptions: options,
    };
  }

  private buildRankMaps<T extends { id: string }>(
    scored: Array<Record<RankerName, number> & { chunk: T }>,
    queryEmbedding: number[],
    hasEmbeddings: boolean,
  ): Map<RankerName, Map<string, number>> {
    const rankMaps = new Map<RankerName, Map<string, number>>();
    const rankBy = (key: RankerName) => [...scored].sort((a, b) => b[key] - a[key]);

    const getRankMap = (ranked: typeof scored): Map<string, number> => {
      const map = new Map<string, number>();
      ranked.forEach((item, index) => map.set(item.chunk.id, index + 1));
      return map;
    };

    if (this.config.weights.bm25 > 0) {
      rankMaps.set("bm25", getRankMap(rankBy("bm25")));
    }
    if (this.config.weights.vector > 0 && queryEmbedding.length > 0 && hasEmbeddings) {
      rankMaps.set("vector", getRankMap(rankBy("vector")));
    }
    if (this.config.weights.metadata > 0) {
      rankMaps.set("metadata", getRankMap(rankBy("metadata")));
    }
    if (this.config.weights.freshness > 0) {
      rankMaps.set("freshness", getRankMap(rankBy("freshness")));
    }

    return rankMaps;
  }

  private computeRrfScore(id: string, rankMaps: Map<RankerName, Map<string, number>>): number {
    return (Object.entries(this.config.weights) as Array<[RankerName, number]>).reduce((total, [ranker, weight]) => {
      if (weight <= 0) return total;
      const rankMap = rankMaps.get(ranker);
      if (!rankMap) return total;
      const rank = rankMap.get(id);
      if (!rank) return total;
      return total + weight * (1 / (this.config.rrfK + rank));
    }, 0);
  }

  private async retrieveFromLocal(
    query: string,
    queryEmbedding: number[],
    topK: number,
    minScore: number,
  ): Promise<RetrievedChunk[]> {
    const candidates = Array.from(this.localChunks.values());
    if (candidates.length === 0) {
      return [];
    }

    const queryTerms = tokenize(query);
    const docFreq = new Map<string, number>();
    let totalTerms = 0;
    const tokenizedDocs: string[][] = candidates.map((candidate) => {
      const terms = tokenize(candidate.content);
      totalTerms += terms.length;
      for (const term of new Set(terms)) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
      return terms;
    });
    const avgDocLength = totalTerms / Math.max(1, candidates.length);

    const scored = candidates.map((chunk, index) => ({
      chunk,
      bm25: bm25Score(queryTerms, tokenizedDocs[index], avgDocLength, docFreq, candidates.length),
      vector: chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0,
      metadata: metadataScore(query, chunk),
      freshness: freshnessScore(chunk.createdAt, this.config.freshnessHalfLifeMs),
    }));

    const rankMaps = this.buildRankMaps(scored, queryEmbedding, candidates.some((candidate) => candidate.embedding !== undefined));

    const pool = scored
      .map(({ chunk }) => ({
        chunk,
        rrfScore: this.computeRrfScore(chunk.id, rankMaps),
        embedding: chunk.embedding,
      }))
      .filter((candidate) => candidate.rrfScore >= minScore)
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, topK * 3);

    const reranked = mmrRerank(
      pool.map(({ chunk, rrfScore, embedding }) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        metadata: chunk.metadata,
        tokens: chunk.tokens,
        source: chunk.source,
        score: rrfScore,
        retrievalMethod: "hybrid" as const,
        embedding,
      })),
      queryEmbedding,
      this.config.mmrLambda,
      topK,
    );

    return reranked.map((chunk) => ({
      ...chunk,
      retrievalMethod: "hybrid",
    }));
  }

  private async retrieveFromDatabase(
    query: string,
    queryEmbedding: number[],
    options: RetrieveOptions,
  ): Promise<RetrievedChunk[]> {
    let candidates: RawChunk[];
    try {
      candidates = await fetchCandidates(options);
    } catch (err) {
      const message = String(err);
      logger.error("Failed to fetch candidates from DB", { error: message });
      if (message.includes('relation "rag_chunks" does not exist')) {
        return [];
      }
      throw err;
    }

    if (candidates.length === 0) {
      return [];
    }

    const queryTerms = tokenize(query);
    const docFreq = new Map<string, number>();
    let totalTerms = 0;
    const tokenizedDocs: string[][] = candidates.map((candidate) => {
      const terms = tokenize(candidate.content);
      totalTerms += terms.length;
      for (const term of new Set(terms)) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
      return terms;
    });
    const avgDocLength = totalTerms / Math.max(1, candidates.length);

    const scored = candidates.map((chunk, index) => ({
      chunk,
      bm25: bm25Score(queryTerms, tokenizedDocs[index], avgDocLength, docFreq, candidates.length),
      vector: chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0,
      metadata: metadataScore(query, chunk),
      freshness: freshnessScore(chunk.createdAt, this.config.freshnessHalfLifeMs),
    }));

    const rankMaps = this.buildRankMaps(scored, queryEmbedding, candidates.some((candidate) => candidate.embedding !== null));

    const pool = scored
      .map(({ chunk }) => ({
        chunk,
        rrfScore: this.computeRrfScore(chunk.id, rankMaps),
        embedding: chunk.embedding ?? undefined,
      }))
      .filter((candidate) => candidate.rrfScore >= (options.minScore ?? this.config.minScore))
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, (options.topK ?? 10) * 3);

    const reranked = mmrRerank(
      pool.map(({ chunk, rrfScore, embedding }) => ({
        id: chunk.id,
        documentId: chunk.sourceId ?? chunk.id,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        metadata: {
          ...(chunk.metadata ?? {}),
          chunkType: (chunk.chunkType ?? "text") as ChunkType,
          sectionTitle: chunk.sectionTitle ?? undefined,
          sourceFile: chunk.sourceId ?? undefined,
          pageNumber: chunk.pageNumber ?? undefined,
          language: chunk.language ?? undefined,
        } satisfies ChunkMetadata & Record<string, unknown>,
        tokens: Math.max(1, chunk.content.split(/\s+/).filter(Boolean).length),
        source: chunk.source,
        score: rrfScore,
        retrievalMethod: "hybrid" as const,
        embedding,
      })),
      queryEmbedding,
      this.config.mmrLambda,
      options.topK ?? 10,
    );

    return reranked.map((chunk) => ({
      ...chunk,
      retrievalMethod: "hybrid",
    }));
  }
}
