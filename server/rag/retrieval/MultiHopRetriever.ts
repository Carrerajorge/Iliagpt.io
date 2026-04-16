/**
 * MultiHopRetriever — Chain-of-retrieval where each hop generates a sub-query
 * based on previously retrieved information.
 *
 * Design: iterative deepening — start with the original query, then use
 * retrieved content to identify missing information for the next hop.
 * Stop when convergence detected (no new chunks) or maxHops reached.
 */

import { createLogger } from "../../utils/logger";
import type {
  RetrieveStage,
  RetrievedChunk,
  RetrieveOptions,
} from "../UnifiedRAGPipeline";

const logger = createLogger("MultiHopRetriever");

// ─── Configuration ────────────────────────────────────────────────────────────

export interface MultiHopConfig {
  maxHops: number;
  minNewChunksPerHop: number;
  subQueryModel: string;
  subQueryMaxTokens: number;
  /** Score weight for chunks found in later hops (slight penalty to prefer direct evidence) */
  hopPenaltyFactor: number;
}

const DEFAULT_CONFIG: MultiHopConfig = {
  maxHops: 3,
  minNewChunksPerHop: 1,
  subQueryModel: "gpt-4o-mini",
  subQueryMaxTokens: 120,
  hopPenaltyFactor: 0.05,
};

// ─── Evidence chain ───────────────────────────────────────────────────────────

export interface HopResult {
  hopIndex: number;
  subQuery: string;
  chunksFound: number;
  newChunksFound: number;
}

export interface MultiHopResult {
  chunks: RetrievedChunk[];
  subQueries: string[];
  hops: HopResult[];
  hopsUsed: number;
  converged: boolean;
}

// ─── Sub-query generation ─────────────────────────────────────────────────────

async function generateSubQuery(
  originalQuery: string,
  context: string,
  hopIndex: number,
  previousSubQueries: string[],
  model: string,
  maxTokens: number
): Promise<string> {
  const { llmGateway } = await import("../../lib/llmGateway");

  const prevQueriesText =
    previousSubQueries.length > 0
      ? `\nPrevious sub-queries used:\n${previousSubQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
      : "";

  const response = await llmGateway.chat(
    [
      {
        role: "system",
        content:
          "You are a search query specialist. Given an original question and context retrieved so far, identify the MOST IMPORTANT piece of missing information and write ONE specific search query to find it. Return ONLY the query text — no explanations, no quotes, no numbering.",
      },
      {
        role: "user",
        content: `Original question: ${originalQuery}

Already retrieved context (summary):
${context}
${prevQueriesText}

Hop ${hopIndex + 1}: What critical information is still missing to fully answer the original question? Write a targeted search query:`,
      },
    ],
    { model, maxTokens, temperature: 0.2 }
  );

  return response.content.trim().replace(/^["']|["']$/g, "");
}

// ─── Convergence detection ────────────────────────────────────────────────────

function hasConverged(
  existingIds: Set<string>,
  newChunks: RetrievedChunk[],
  minNewChunks: number
): boolean {
  const genuinelyNew = newChunks.filter((c) => !existingIds.has(c.id));
  return genuinelyNew.length < minNewChunks;
}

function buildContextSummary(chunks: RetrievedChunk[], maxChars = 800): string {
  const sorted = [...chunks].sort((a, b) => b.score - a.score);
  let summary = "";
  for (const chunk of sorted) {
    const snippet = chunk.content.slice(0, 200).replace(/\n+/g, " ").trim();
    if (summary.length + snippet.length > maxChars) break;
    summary += `- ${snippet}\n`;
  }
  return summary || "No context retrieved yet.";
}

// ─── MultiHopRetriever ────────────────────────────────────────────────────────

export class MultiHopRetriever implements RetrieveStage {
  private readonly config: MultiHopConfig;
  private readonly baseRetriever: RetrieveStage;
  private embedQuery: (query: string) => Promise<number[]>;

  constructor(
    baseRetriever: RetrieveStage,
    embedQuery: (query: string) => Promise<number[]>,
    config: Partial<MultiHopConfig> = {}
  ) {
    this.baseRetriever = baseRetriever;
    this.embedQuery = embedQuery;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async retrieve(
    query: string,
    queryEmbedding: number[],
    options: RetrieveOptions = {}
  ): Promise<RetrievedChunk[]> {
    const startTime = Date.now();
    const multiHopResult = await this.multiHopRetrieve(query, queryEmbedding, options);

    logger.info("MultiHopRetriever complete", {
      query: query.slice(0, 60),
      hopsUsed: multiHopResult.hopsUsed,
      converged: multiHopResult.converged,
      totalChunks: multiHopResult.chunks.length,
      durationMs: Date.now() - startTime,
    });

    return multiHopResult.chunks;
  }

  async multiHopRetrieve(
    query: string,
    queryEmbedding: number[],
    options: RetrieveOptions = {}
  ): Promise<MultiHopResult> {
    const seenIds = new Set<string>();
    let accumulated: RetrievedChunk[] = [];
    const subQueries: string[] = [];
    const hops: HopResult[] = [];
    let converged = false;

    // Hop 0: original query
    let currentQuery = query;
    let currentEmbedding = queryEmbedding;

    for (let hopIdx = 0; hopIdx < this.config.maxHops; hopIdx++) {
      let hopChunks: RetrievedChunk[];
      try {
        hopChunks = await this.baseRetriever.retrieve(currentQuery, currentEmbedding, {
          ...options,
          topK: Math.max(options.topK ?? 10, 5),
        });
      } catch (err) {
        logger.error("Base retriever failed on hop", { hopIdx, error: String(err) });
        break;
      }

      // Apply hop penalty to later hops
      const penalizedChunks = hopChunks.map((c) => ({
        ...c,
        score: c.score * (1 - hopIdx * this.config.hopPenaltyFactor),
      }));

      const newChunks = penalizedChunks.filter((c) => !seenIds.has(c.id));
      for (const c of newChunks) seenIds.add(c.id);
      accumulated = [...accumulated, ...newChunks];

      const hopResult: HopResult = {
        hopIndex: hopIdx,
        subQuery: currentQuery,
        chunksFound: hopChunks.length,
        newChunksFound: newChunks.length,
      };
      hops.push(hopResult);

      if (hopIdx > 0) subQueries.push(currentQuery);

      // Check convergence (skip on last hop)
      if (hopIdx < this.config.maxHops - 1) {
        if (hasConverged(seenIds, hopChunks, this.config.minNewChunksPerHop)) {
          logger.debug("MultiHop converged", { hopIdx, newChunks: newChunks.length });
          converged = true;
          break;
        }

        // Generate next sub-query
        const context = buildContextSummary(accumulated);
        try {
          const subQuery = await generateSubQuery(
            query,
            context,
            hopIdx,
            subQueries,
            this.config.subQueryModel,
            this.config.subQueryMaxTokens
          );

          if (!subQuery || subQuery.trim() === "" || subQuery === query) {
            logger.debug("Sub-query generation returned empty or duplicate, stopping", { hopIdx });
            converged = true;
            break;
          }

          currentQuery = subQuery;
          currentEmbedding = await this.embedQuery(subQuery);
        } catch (err) {
          logger.warn("Sub-query generation failed, stopping multi-hop", {
            hopIdx,
            error: String(err),
          });
          break;
        }
      }
    }

    // Deduplicate and sort by score
    const unique = deduplicateChunks(accumulated);
    unique.sort((a, b) => b.score - a.score);

    return {
      chunks: unique,
      subQueries,
      hops,
      hopsUsed: hops.length,
      converged,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const best = new Map<string, RetrievedChunk>();
  for (const chunk of chunks) {
    const existing = best.get(chunk.id);
    if (!existing || chunk.score > existing.score) {
      best.set(chunk.id, chunk);
    }
  }
  return Array.from(best.values());
}

// ─── Graph traversal: find related chunks by source document ─────────────────

export async function expandByDocument(
  seeds: RetrievedChunk[],
  userId: string,
  windowSize = 2
): Promise<RetrievedChunk[]> {
  if (seeds.length === 0) return seeds;

  const { db } = await import("../../db");
  const { ragChunks } = await import("@shared/schema/rag");
  const { eq, and, between, sql } = await import("drizzle-orm");

  const expanded = [...seeds];
  const seenIds = new Set(seeds.map((s) => s.id));

  for (const seed of seeds.slice(0, 5)) { // Limit expansion to top-5 seeds
    const sourceId = seed.metadata?.sourceFile;
    if (!sourceId) continue;

    try {
      const neighbors = await db
        .select()
        .from(ragChunks)
        .where(
          and(
            eq(ragChunks.sourceId, sourceId),
            eq(ragChunks.userId, userId),
            sql`${ragChunks.chunkIndex} BETWEEN ${seed.chunkIndex - windowSize} AND ${seed.chunkIndex + windowSize}`
          )
        )
        .limit(windowSize * 2 + 1);

      for (const neighbor of neighbors) {
        if (!seenIds.has(neighbor.id)) {
          seenIds.add(neighbor.id);
          expanded.push({
            id: neighbor.id,
            content: neighbor.content,
            chunkIndex: neighbor.chunkIndex,
            score: seed.score * 0.6, // Context window gets lower score
            matchType: "hybrid",
            metadata: {
              chunkType: (neighbor.chunkType ?? "text") as import("../UnifiedRAGPipeline").ChunkType,
              sectionTitle: neighbor.sectionTitle ?? undefined,
              sourceFile: neighbor.sourceId ?? undefined,
              pageNumber: neighbor.pageNumber ?? undefined,
              startOffset: 0,
              endOffset: 0,
            },
          });
        }
      }
    } catch (err) {
      logger.warn("Document expansion failed for seed", { seedId: seed.id, error: String(err) });
    }
  }

  return expanded;
}
