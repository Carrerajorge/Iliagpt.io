/**
 * LLMReranker — Cross-encoder reranking using an LLM in listwise mode.
 * Sends all candidates in a single prompt to get a ranked ordering with
 * relevance scores. Caches results for repeated queries.
 *
 * Cost control: skip reranking for queries with fewer than minChunks results
 * or queries with lowStakesDetected signal.
 */

import crypto from "crypto";
import { createLogger } from "../../utils/logger";
import type { RerankStage, RetrievedChunk } from "../UnifiedRAGPipeline";

const logger = createLogger("LLMReranker");

// ─── Configuration ────────────────────────────────────────────────────────────

export interface LLMRerankerConfig {
  model: string;
  maxChunksPerBatch: number;
  /** Skip reranking if fewer than this many chunks */
  minChunksToRerank: number;
  /** 0–1 score assigned to chunks not mentioned in LLM output */
  unrankedFallbackScore: number;
  /** TTL for reranking cache in ms */
  cacheTtlMs: number;
  /** LLM temperature (low = more deterministic) */
  temperature: number;
}

const DEFAULT_CONFIG: LLMRerankerConfig = {
  model: process.env.RAG_RERANK_MODEL ?? "gpt-4o-mini",
  maxChunksPerBatch: 20,
  minChunksToRerank: 3,
  unrankedFallbackScore: 0.1,
  cacheTtlMs: 10 * 60 * 1000,
  temperature: 0.1,
};

// ─── Simple in-process cache ──────────────────────────────────────────────────

interface CacheEntry {
  rankedIds: string[];
  scores: Map<string, number>;
  expiresAt: number;
}

const rerankCache = new Map<string, CacheEntry>();

function cacheKey(query: string, chunkIds: string[]): string {
  const payload = `${query}:${chunkIds.sort().join(",")}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 20);
}

function getCached(key: string): CacheEntry | undefined {
  const entry = rerankCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    rerankCache.delete(key);
    return undefined;
  }
  return entry;
}

function setCache(key: string, entry: Omit<CacheEntry, "expiresAt">, ttlMs: number): void {
  if (rerankCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of rerankCache) {
      if (now > v.expiresAt) rerankCache.delete(k);
    }
  }
  rerankCache.set(key, { ...entry, expiresAt: Date.now() + ttlMs });
}

// ─── Prompt building ──────────────────────────────────────────────────────────

function buildRerankPrompt(query: string, chunks: RetrievedChunk[]): string {
  const candidates = chunks
    .map((c, i) => `[${i + 1}] ${c.content.slice(0, 400).replace(/\n+/g, " ")}`)
    .join("\n\n");

  return `You are a relevance ranking expert. Given a QUERY and a list of text PASSAGES, rank them by relevance to the query.

QUERY: ${query}

PASSAGES:
${candidates}

Return a JSON object with this exact structure:
{
  "rankings": [
    { "rank": 1, "passage_number": <N>, "score": <0.0-1.0>, "reason": "<one sentence>" },
    ...
  ]
}

Rules:
- Include ALL passages in the rankings
- Score 1.0 = perfectly answers the query, 0.0 = completely irrelevant
- Rank 1 is the most relevant
- Return valid JSON only`;
}

interface RankingItem {
  rank: number;
  passage_number: number;
  score: number;
  reason?: string;
}

interface RerankResponse {
  rankings: RankingItem[];
}

function parseRerankResponse(text: string, chunkCount: number): Map<number, number> {
  const scores = new Map<number, number>();

  // Try JSON extraction
  const jsonMatch = text.match(/\{[\s\S]*"rankings"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as RerankResponse;
      if (Array.isArray(parsed.rankings)) {
        for (const item of parsed.rankings) {
          if (typeof item.passage_number === "number" && typeof item.score === "number") {
            scores.set(item.passage_number, Math.max(0, Math.min(1, item.score)));
          }
        }
        return scores;
      }
    } catch { /* fall through */ }
  }

  // Fallback: look for numbered lines like "1. passage 3: 0.9" or "Rank 1: [3]"
  const lines = text.split("\n");
  for (const line of lines) {
    const m = line.match(/(\d+)[^\d]+?(\d+(?:\.\d+)?)/);
    if (m) {
      const passageNum = parseInt(m[1]);
      const score = parseFloat(m[2]);
      if (passageNum >= 1 && passageNum <= chunkCount && score >= 0 && score <= 1) {
        scores.set(passageNum, score);
      }
    }
  }

  return scores;
}

// ─── Fast fallback reranker (no LLM) ─────────────────────────────────────────

function fastRerank(query: string, chunks: RetrievedChunk[]): RetrievedChunk[] {
  const queryTerms = new Set(
    query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  );

  return chunks
    .map((chunk) => {
      let boost = chunk.score;
      const contentLower = chunk.content.toLowerCase();

      // Exact term matches
      for (const term of queryTerms) {
        if (contentLower.includes(term)) boost += 0.03;
      }
      // Title match bonus
      if (chunk.metadata.sectionTitle) {
        const titleLower = chunk.metadata.sectionTitle.toLowerCase();
        for (const term of queryTerms) {
          if (titleLower.includes(term)) boost += 0.1;
        }
      }
      // Heading bonus
      if (chunk.metadata.sectionType === "heading") boost += 0.05;

      return { ...chunk, score: boost };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── LLMReranker ─────────────────────────────────────────────────────────────

export class LLMReranker implements RerankStage {
  private readonly config: LLMRerankerConfig;

  constructor(config: Partial<LLMRerankerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async rerank(query: string, chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) return [];

    // Cost-aware skip: too few chunks don't benefit from LLM reranking
    if (chunks.length < this.config.minChunksToRerank) {
      logger.debug("Skipping LLM rerank (too few chunks)", { count: chunks.length });
      return fastRerank(query, chunks);
    }

    const ck = cacheKey(query, chunks.map((c) => c.id));
    const cached = getCached(ck);
    if (cached) {
      logger.debug("LLMReranker cache hit", { query: query.slice(0, 40) });
      return this.applyScores(chunks, cached.scores);
    }

    // Batch into groups of maxChunksPerBatch
    const batches: RetrievedChunk[][] = [];
    for (let i = 0; i < chunks.length; i += this.config.maxChunksPerBatch) {
      batches.push(chunks.slice(i, i + this.config.maxChunksPerBatch));
    }

    const allScores = new Map<string, number>();

    for (const batch of batches) {
      try {
        const batchScores = await this.rerankBatch(query, batch);
        for (const [id, score] of batchScores) {
          allScores.set(id, score);
        }
      } catch (err) {
        logger.warn("LLM rerank batch failed, using fast rerank for batch", { error: String(err) });
        // Apply fast rerank scores as fallback
        const fallback = fastRerank(query, batch);
        fallback.forEach((c, i) => {
          allScores.set(c.id, 1 - i / fallback.length);
        });
      }
    }

    setCache(ck, { rankedIds: [...allScores.keys()], scores: allScores }, this.config.cacheTtlMs);

    const result = this.applyScores(chunks, allScores);

    logger.info("LLMReranker complete", {
      query: query.slice(0, 60),
      inputChunks: chunks.length,
      batches: batches.length,
    });

    return result;
  }

  private async rerankBatch(
    query: string,
    batch: RetrievedChunk[]
  ): Promise<Map<string, number>> {
    const { llmGateway } = await import("../../lib/llmGateway");

    const prompt = buildRerankPrompt(query, batch);

    const response = await llmGateway.chat(
      [
        { role: "user", content: prompt },
      ],
      {
        model: this.config.model,
        maxTokens: 600,
        temperature: this.config.temperature,
      }
    );

    const scoresByPosition = parseRerankResponse(response.content, batch.length);
    const chunkScores = new Map<string, number>();

    for (let i = 0; i < batch.length; i++) {
      const posScore = scoresByPosition.get(i + 1);
      chunkScores.set(
        batch[i].id,
        posScore !== undefined ? posScore : this.config.unrankedFallbackScore
      );
    }

    return chunkScores;
  }

  private applyScores(
    chunks: RetrievedChunk[],
    scores: Map<string, number>
  ): RetrievedChunk[] {
    return chunks
      .map((chunk) => ({
        ...chunk,
        score: scores.get(chunk.id) ?? this.config.unrankedFallbackScore,
        rerankScore: scores.get(chunk.id),
      }))
      .sort((a, b) => b.score - a.score);
  }
}

// ─── Exported helpers ────────────────────────────────────────────────────────

export { fastRerank };
export function clearRerankCache(): void {
  rerankCache.clear();
}
export function getRerankCacheStats(): { size: number; hitRate?: number } {
  return { size: rerankCache.size };
}
