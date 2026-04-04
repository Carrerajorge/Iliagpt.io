/**
 * HybridRetriever — Reciprocal Rank Fusion across BM25, vector, metadata,
 * and freshness rankers. Applies MMR for diversity enforcement.
 *
 * RRF formula: score = Σ 1/(k + rank_i) across all rankers
 * Default k=60 (empirically robust across IR benchmarks).
 */

import { createLogger } from "../../utils/logger";
import { db } from "../../db";
import { ragChunks } from "@shared/schema/rag";
import { eq, and, inArray, sql, gte } from "drizzle-orm";
import type { RetrieveStage, RetrievedChunk, RetrieveOptions, ChunkType, PipelineChunk, ChunkMetadata } from "../UnifiedRAGPipeline";
import { cosineSimilarity } from "../UnifiedRAGPipeline";

const logger = createLogger("HybridRetriever");

// ─── Configuration ────────────────────────────────────────────────────────────

export interface HybridRetrieverConfig {
  /** RRF rank offset. Larger = smoother fusion. Default 60. */
  rrfK: number;
  /** Ranker weights for RRF score blending (purely additive) */
  weights: {
    bm25: number;
    vector: number;
    metadata: number;
    freshness: number;
  };
  /** Minimum final RRF score to include in results */
  minScore: number;
  /** MMR lambda: 0 = max diversity, 1 = max relevance */
  mmrLambda: number;
  /** Half-life for freshness decay in milliseconds */
  freshnessHalfLifeMs: number;
}

const DEFAULT_CONFIG: HybridRetrieverConfig = {
  rrfK: 60,
  weights: { bm25: 1.0, vector: 1.0, metadata: 0.5, freshness: 0.3 },
  minScore: 0.0,
  mmrLambda: 0.7,
  freshnessHalfLifeMs: 7 * 24 * 60 * 60 * 1000,
};

// ─── BM25 in-process implementation ──────────────────────────────────────────

const STOP_WORDS_EN = new Set(["the","is","are","of","and","to","in","for","with","that","this","have","it","at","be","from","or","an","by","we","you"]);
const STOP_WORDS_ES = new Set(["el","la","los","las","de","que","en","un","una","es","por","con","del","al","se","no","a","su","si","más","pero","hay"]);
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
  b = 0.75
): number {
  const docLength = docTerms.length;
  const termFreq = new Map<string, number>();
  for (const t of docTerms) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);

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

// ─── Metadata ranker ─────────────────────────────────────────────────────────

function metadataScore(query: string, chunk: { content: string; sectionTitle?: string | null; chunkType?: string | null }): number {
  const q = query.toLowerCase();
  let score = 0;

  // Boost for heading chunks
  if (chunk.chunkType === "heading") score += 0.3;

  // Section title match
  if (chunk.sectionTitle) {
    const titleWords = tokenize(chunk.sectionTitle);
    const queryWords = tokenize(query);
    const overlap = queryWords.filter((w) => titleWords.includes(w)).length;
    score += overlap * 0.2;
  }

  // Table match for data queries
  if (chunk.chunkType === "table" && /\b(tabla|table|datos|data|total|suma|sum|average|promedio)\b/i.test(q)) score += 0.4;

  // Code match for code queries
  if (chunk.chunkType === "code" && /\b(function|code|función|clase|class|implement|ejemplo|example)\b/i.test(q)) score += 0.3;

  return Math.min(1, score);
}

// ─── Freshness ranker ─────────────────────────────────────────────────────────

function freshnessScore(createdAt: Date | null | undefined, halfLifeMs: number): number {
  if (!createdAt) return 0.5;
  const ageMs = Date.now() - createdAt.getTime();
  return Math.exp(-Math.log(2) * ageMs / halfLifeMs);
}

// ─── MMR (Maximal Marginal Relevance) ────────────────────────────────────────

function mmrRerank(
  candidates: Array<RetrievedChunk & { embedding?: number[] }>,
  queryEmbedding: number[],
  lambda: number,
  topK: number
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

      // Penalty: similarity to already selected chunks
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

// ─── DB query ─────────────────────────────────────────────────────────────────

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
    .limit(2000); // Safety cap before in-process scoring

  return rows as RawChunk[];
}

// ─── HybridRetriever ──────────────────────────────────────────────────────────

export class HybridRetriever implements RetrieveStage {
  private readonly config: HybridRetrieverConfig;

  constructor(config: Partial<HybridRetrieverConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async retrieve(
    query: string,
    queryEmbedding: number[],
    options: RetrieveOptions = {}
  ): Promise<RetrievedChunk[]> {
    const topK = options.topK ?? 10;
    const minScore = options.minScore ?? this.config.minScore;

    let candidates: RawChunk[];
    try {
      candidates = await fetchCandidates(options);
    } catch (err) {
      logger.error("Failed to fetch candidates from DB", { error: String(err) });
      throw err;
    }

    if (candidates.length === 0) {
      logger.debug("No candidates found", { options });
      return [];
    }

    logger.debug("Candidates fetched", { count: candidates.length, query: query.slice(0, 50) });

    const queryTerms = tokenize(query);

    // Compute BM25 corpus stats
    const docFreq = new Map<string, number>();
    let totalTerms = 0;
    const tokenizedDocs: string[][] = candidates.map((c) => {
      const terms = tokenize(c.content);
      totalTerms += terms.length;
      for (const t of new Set(terms)) {
        docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
      }
      return terms;
    });
    const avgDocLength = totalTerms / Math.max(1, candidates.length);

    // Score each candidate across all rankers
    const scored: Array<{
      chunk: RawChunk;
      bm25: number;
      vector: number;
      metadata: number;
      freshness: number;
    }> = candidates.map((chunk, i) => ({
      chunk,
      bm25: bm25Score(queryTerms, tokenizedDocs[i], avgDocLength, docFreq, candidates.length),
      vector: chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0,
      metadata: metadataScore(query, chunk),
      freshness: freshnessScore(chunk.createdAt, this.config.freshnessHalfLifeMs),
    }));

    // Build ranked lists per ranker (descending)
    const rankBy = (key: "bm25" | "vector" | "metadata" | "freshness") =>
      [...scored].sort((a, b) => b[key] - a[key]);

    const bm25Ranked = rankBy("bm25");
    const vectorRanked = rankBy("vector");
    const metaRanked = rankBy("metadata");
    const freshnessRanked = rankBy("freshness");

    // Build rank maps
    const getRankMap = (ranked: typeof scored): Map<string, number> => {
      const m = new Map<string, number>();
      ranked.forEach((s, i) => m.set(s.chunk.id, i + 1));
      return m;
    };

    const bm25Ranks = getRankMap(bm25Ranked);
    const vectorRanks = getRankMap(vectorRanked);
    const metaRanks = getRankMap(metaRanked);
    const freshnessRanks = getRankMap(freshnessRanked);

    const { rrfK, weights } = this.config;

    // Compute RRF scores
    const rrfScores: Array<{ chunk: RawChunk; rrfScore: number; vectorScore: number; embedding: number[] | null }> =
      scored.map(({ chunk }) => {
        const rrf =
          weights.bm25 * (1 / (rrfK + (bm25Ranks.get(chunk.id) ?? candidates.length))) +
          weights.vector * (1 / (rrfK + (vectorRanks.get(chunk.id) ?? candidates.length))) +
          weights.metadata * (1 / (rrfK + (metaRanks.get(chunk.id) ?? candidates.length))) +
          weights.freshness * (1 / (rrfK + (freshnessRanks.get(chunk.id) ?? candidates.length)));

        return {
          chunk,
          rrfScore: rrf,
          vectorScore: chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0,
          embedding: chunk.embedding,
        };
      });

    // Sort by RRF score
    rrfScores.sort((a, b) => b.rrfScore - a.rrfScore);

    // Filter by min score and take candidate pool for MMR
    const pool = rrfScores.filter((s) => s.rrfScore >= minScore).slice(0, topK * 3);

    // MMR reranking for diversity
    const diverse = mmrRerank(
      pool.map((s) => ({
        id: s.chunk.id,
        content: s.chunk.content,
        chunkIndex: s.chunk.chunkIndex,
        embedding: s.embedding ?? undefined,
        score: s.rrfScore,
        rrfScore: s.rrfScore,
        matchType: "hybrid" as const,
        metadata: {
          chunkType: (s.chunk.chunkType ?? "text") as ChunkType,
          sectionTitle: s.chunk.sectionTitle ?? undefined,
          sourceFile: s.chunk.sourceId ?? undefined,
          pageNumber: s.chunk.pageNumber ?? undefined,
          language: s.chunk.language ?? undefined,
          startOffset: 0,
          endOffset: 0,
        } satisfies ChunkMetadata,
      })),
      queryEmbedding,
      this.config.mmrLambda,
      topK
    );

    logger.info("HybridRetriever complete", {
      query: query.slice(0, 60),
      candidates: candidates.length,
      returned: diverse.length,
    });

    return diverse;
  }
}
