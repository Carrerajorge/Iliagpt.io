/**
 * llmReranker — Phase 3 of the WebGLM pipeline.
 *
 * Candidate pool (say, top 50 from parallel retrieval) is re-scored by
 * the same LLM using a compact relevance rubric. The LLM sees title +
 * snippet of abstract only (to stay within token budget) and returns a
 * 0-10 score per candidate plus a one-sentence justification.
 *
 * Costs ~one LLM call per batch of 10 candidates. We batch rather than
 * one-per-call because a single LLM with 10 compact entries is cheaper
 * than 10 single-entry calls AND the LLM picks up relative ranking
 * signal by comparing candidates side-by-side.
 *
 * Final per-result score combines:
 *   - rerank:       LLM score (0-10) / 10
 *   - providerRank: 1 / (1 + providerRank)
 *   - citations:    log1p(citationCount) / log1p(1000)   (caps at ~1)
 *   - openAccess:   +openAccessBoost when open
 *
 * All weights come from `SearchBrainWeights` — caller tunes them.
 */

import type {
  NormalisedResult,
  SearchBrainDeps,
  SearchBrainWeights,
} from "./types";
import { DEFAULT_WEIGHTS } from "./types";

const RERANKER_SYSTEM = `You rerank academic search results for relevance to a user's query.

Output format — STRICT JSON:
{
  "scores": [
    { "idx": <1-indexed candidate number>, "score": <0..10>, "reason": "<≤ 15 word explanation>" }
  ]
}

Scoring rubric:
  10 = directly answers the query with strong evidence
  7-9 = closely related, likely useful
  4-6 = same topic but tangential
  1-3 = loose topical overlap
  0   = off-topic / irrelevant

Rules:
- Score EVERY candidate the user lists. Produce one entry per candidate.
- Use the full 0..10 range — don't cluster everything at 7.
- Only use the title + abstract snippet to decide. Do NOT speculate beyond what's shown.`;

function parseJSON(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function validateScores(raw: unknown): Array<{ idx: number; score: number; reason?: string }> {
  if (!isRecord(raw) || !Array.isArray(raw.scores)) return [];
  const out: Array<{ idx: number; score: number; reason?: string }> = [];
  for (const s of raw.scores) {
    if (!isRecord(s)) continue;
    const idx = typeof s.idx === "number" ? s.idx : Number(s.idx);
    const score = typeof s.score === "number" ? s.score : Number(s.score);
    if (!Number.isFinite(idx) || !Number.isFinite(score)) continue;
    out.push({
      idx,
      score: Math.max(0, Math.min(10, score)),
      reason: typeof s.reason === "string" ? s.reason.slice(0, 200) : undefined,
    });
  }
  return out;
}

/**
 * Truncate each candidate to the fields the reranker actually needs,
 * so a batch of 10 fits comfortably in a normal chat context window.
 */
function formatBatch(batch: NormalisedResult[]): string {
  return batch
    .map((r, i) => {
      const snippet = (r.abstract ?? "").replace(/\s+/g, " ").slice(0, 500);
      const year = r.year ? ` (${r.year})` : "";
      const authors = r.authors.slice(0, 3).join(", ");
      return `[${i + 1}] ${r.title}${year}\n    ${authors}\n    ${snippet}`;
    })
    .join("\n\n");
}

function combinedScore(
  result: NormalisedResult,
  rerankScore: number | undefined,
  weights: SearchBrainWeights
): number {
  const rerank = typeof rerankScore === "number" ? rerankScore / 10 : 0;
  const providerRankScore = 1 / (1 + (result.providerRank ?? 0));
  const citationScore = Math.min(
    1,
    Math.log1p(result.citationCount ?? 0) / Math.log1p(1000)
  );
  const oaBoost = result.openAccess ? 1 : 0;
  return (
    weights.rerank * rerank +
    weights.providerRank * providerRankScore +
    weights.citations * citationScore +
    weights.openAccessBoost * oaBoost
  );
}

export async function rerankResults(args: {
  query: string;
  results: NormalisedResult[];
  weights?: Partial<SearchBrainWeights>;
  userId?: string;
  batchSize?: number;
  deps?: SearchBrainDeps;
}): Promise<{ results: NormalisedResult[]; reranked: boolean }> {
  const batchSize = args.batchSize ?? 10;
  const weights: SearchBrainWeights = { ...DEFAULT_WEIGHTS, ...(args.weights ?? {}) };
  const pool = [...args.results];
  if (pool.length === 0) return { results: [], reranked: false };

  if (!args.deps?.callLLM) {
    // No LLM — fall back to composite score with providerRank + citations.
    for (const r of pool) {
      r.rerankScore = undefined;
    }
    pool.sort((a, b) => combinedScore(b, undefined, weights) - combinedScore(a, undefined, weights));
    return { results: pool, reranked: false };
  }

  // Run batched LLM reranking. Keep results in original order inside
  // the batch so `idx` line up.
  for (let start = 0; start < pool.length; start += batchSize) {
    const batch = pool.slice(start, start + batchSize);
    try {
      const { content } = await args.deps.callLLM({
        system: RERANKER_SYSTEM,
        user: `QUERY:\n${args.query}\n\nCANDIDATES:\n${formatBatch(batch)}`,
        userId: args.userId,
        temperature: 0,
        maxTokens: 700,
      });
      const parsed = parseJSON(content ?? "");
      const scores = validateScores(parsed);
      for (const s of scores) {
        const target = batch[s.idx - 1];
        if (target) target.rerankScore = s.score;
      }
    } catch {
      // Batch LLM error — leave those rerankScores undefined so the
      // composite score falls back to heuristics for this batch only.
    }
  }

  pool.sort(
    (a, b) =>
      combinedScore(b, b.rerankScore, weights) -
      combinedScore(a, a.rerankScore, weights)
  );
  return { results: pool, reranked: true };
}

export const RERANKER_INTERNAL = { validateScores, formatBatch, combinedScore, parseJSON };
export { RERANKER_SYSTEM };
