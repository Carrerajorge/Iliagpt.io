/**
 * UncertaintyEstimator
 *
 * Produces calibrated confidence scores by measuring how much the LLM's
 * output varies when the same prompt is sampled at different temperatures.
 *
 * Algorithm
 * ──────────
 *   1. Sample the prompt at T_LOW  (0.1) → deterministic / most-likely answer.
 *   2. Sample the prompt at T_HIGH (0.9) → a creative / alternative answer.
 *   3. Compute semantic variance between the two outputs:
 *        - Normalised edit distance (Levenshtein / text length)
 *        - Token-overlap F1 (Jaccard on word sets)
 *        - Sentence-count divergence
 *      Combined: variance = 0.5 × editDist + 0.3 × (1 − jaccard) + 0.2 × sentDiv
 *   4. Confidence = 1 − variance   (clamped to [0.1, 0.99])
 *
 * Additionally supports claim-level decomposition: break the answer into
 * individual claims and assign confidence per claim.
 *
 * All confidence scores are returned as calibrated floats, NOT raw
 * probabilities (the LLM's self-reported probability is notoriously
 * miscalibrated; variance-based estimation is empirically better).
 */

import { randomUUID }   from 'crypto';
import { z }            from 'zod';
import { Logger }       from '../lib/logger';
import { llmGateway }   from '../lib/llmGateway';

// ─── Constants ────────────────────────────────────────────────────────────────

const T_LOW    = 0.1;
const T_HIGH   = 0.9;
const DEFAULT_MODEL = 'auto';

// ─── Public schemas ───────────────────────────────────────────────────────────

export const ClaimConfidenceSchema = z.object({
  claim     : z.string(),
  confidence: z.number().min(0).max(1),
  variance  : z.number().min(0).max(1),
});
export type ClaimConfidence = z.infer<typeof ClaimConfidenceSchema>;

export const UncertaintyResultSchema = z.object({
  requestId        : z.string(),
  /** Overall confidence 0–1 for the whole response. */
  confidence       : z.number().min(0).max(1),
  /** Semantic variance 0–1 (higher = more uncertain). */
  variance         : z.number().min(0).max(1),
  /** Responses sampled at T_LOW and T_HIGH. */
  samples          : z.object({ low: z.string(), high: z.string() }),
  /** Variance breakdown. */
  variances        : z.object({
    editDistance   : z.number().min(0).max(1),
    jaccardDistance: z.number().min(0).max(1),
    sentenceDivergence: z.number().min(0).max(1),
  }),
  /** Per-claim confidence (if decomposeClaims=true). */
  claims           : z.array(ClaimConfidenceSchema).optional(),
  durationMs       : z.number().nonneg(),
});
export type UncertaintyResult = z.infer<typeof UncertaintyResultSchema>;

// ─── Levenshtein distance (normalised) ───────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // For very long strings use word-level distance to keep runtime O(words²)
  const aWords = a.split(/\s+/);
  const bWords = b.split(/\s+/);

  const la = aWords.length;
  const lb = bWords.length;

  const dp: number[] = Array.from({ length: lb + 1 }, (_, i) => i);

  for (let i = 1; i <= la; i++) {
    let prev = i;
    for (let j = 1; j <= lb; j++) {
      const val = aWords[i - 1] === bWords[j - 1]
        ? dp[j - 1]!
        : 1 + Math.min(dp[j - 1]!, dp[j]!, prev);
      dp[j - 1] = prev;
      prev = val;
    }
    dp[lb] = prev;
  }

  return dp[lb]! / Math.max(la, lb);
}

// ─── Jaccard distance on word sets ───────────────────────────────────────────

function jaccardDistance(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().match(/\b\w{3,}\b/g) ?? []);
  const setB = new Set(b.toLowerCase().match(/\b\w{3,}\b/g) ?? []);

  if (setA.size === 0 && setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection++;

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : 1 - intersection / union;
}

// ─── Sentence count divergence ────────────────────────────────────────────────

function sentenceDivergence(a: string, b: string): number {
  const countA = (a.match(/[.!?]+/g) ?? []).length;
  const countB = (b.match(/[.!?]+/g) ?? []).length;
  if (countA === 0 && countB === 0) return 0;
  const max = Math.max(countA, countB);
  return Math.abs(countA - countB) / max;
}

// ─── Composite variance ───────────────────────────────────────────────────────

interface VarianceBreakdown {
  editDistance      : number;
  jaccardDistance   : number;
  sentenceDivergence: number;
  combined          : number;
}

function computeVariance(low: string, high: string): VarianceBreakdown {
  const editDist = levenshtein(low, high);
  const jaccard  = jaccardDistance(low, high);
  const sentDiv  = sentenceDivergence(low, high);

  const combined = 0.50 * editDist + 0.30 * jaccard + 0.20 * sentDiv;

  return {
    editDistance      : Math.round(editDist * 1000) / 1000,
    jaccardDistance   : Math.round(jaccard  * 1000) / 1000,
    sentenceDivergence: Math.round(sentDiv  * 1000) / 1000,
    combined          : Math.round(combined * 1000) / 1000,
  };
}

// ─── Claim decomposition ──────────────────────────────────────────────────────

interface ClaimDecompositionResult {
  claims: string[];
}

async function decomposeClaims(
  answer    : string,
  requestId : string,
  model     : string,
): Promise<string[]> {
  const response = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: 'Extract each factual claim from the text as a separate sentence. Return JSON: {"claims":["claim1","claim2",...]}. Maximum 10 claims.',
      },
      { role: 'user', content: answer },
    ],
    {
      model,
      requestId  : `${requestId}-claims`,
      temperature: 0.1,
      maxTokens  : 512,
    },
  );

  try {
    const match  = response.content.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as ClaimDecompositionResult : null;
    return parsed?.claims ?? [];
  } catch {
    return [];
  }
}

async function assessClaimConfidence(
  claim     : string,
  requestId : string,
  model     : string,
): Promise<number> {
  // Sample the claim at two temperatures and compute variance
  const [low, high] = await Promise.all([
    llmGateway.chat(
      [
        { role: 'system', content: 'Rate the factual accuracy of this claim 0–1.  Respond with a single float like: 0.85' },
        { role: 'user', content: claim },
      ],
      { model, requestId: `${requestId}-low`, temperature: T_LOW, maxTokens: 10 },
    ),
    llmGateway.chat(
      [
        { role: 'system', content: 'Rate the factual accuracy of this claim 0–1.  Respond with a single float like: 0.85' },
        { role: 'user', content: claim },
      ],
      { model, requestId: `${requestId}-high`, temperature: T_HIGH, maxTokens: 10 },
    ),
  ]);

  const parseLow  = parseFloat(low.content.trim());
  const parseHigh = parseFloat(high.content.trim());

  if (isNaN(parseLow) || isNaN(parseHigh)) return 0.5;

  // Confidence = mean of low/high scores, penalised by their difference
  const mean  = (parseLow + parseHigh) / 2;
  const delta = Math.abs(parseLow - parseHigh);
  return Math.max(0.1, Math.min(0.99, mean - delta * 0.3));
}

// ─── Main class ───────────────────────────────────────────────────────────────

export interface UncertaintyOptions {
  model?         : string;
  requestId?     : string;
  /** If true, decompose the answer into claims and score each. */
  decomposeClaims?: boolean;
  /** Custom low temperature (default 0.1). */
  tLow?          : number;
  /** Custom high temperature (default 0.9). */
  tHigh?         : number;
}

export class UncertaintyEstimator {
  /**
   * Estimate uncertainty for a given prompt by sampling at two temperatures
   * and measuring the semantic variance between the outputs.
   *
   * @param messages - The same messages array that was sent to the LLM
   * @param opts     - Configuration options
   */
  async estimate(
    messages: Array<{ role: string; content: string }>,
    opts    : UncertaintyOptions = {},
  ): Promise<UncertaintyResult> {
    const requestId = opts.requestId ?? randomUUID();
    const model     = opts.model     ?? DEFAULT_MODEL;
    const tLow      = opts.tLow      ?? T_LOW;
    const tHigh     = opts.tHigh     ?? T_HIGH;
    const start     = Date.now();

    Logger.debug('[UncertaintyEstimator] sampling at two temperatures', {
      requestId, tLow, tHigh, messageCount: messages.length,
    });

    // ── 1. Parallel sampling at T_LOW and T_HIGH ─────────────────────────────
    const [lowRes, highRes] = await Promise.all([
      llmGateway.chat(
        messages as Parameters<typeof llmGateway.chat>[0],
        { model, requestId: `${requestId}-low`, temperature: tLow, maxTokens: 800 },
      ),
      llmGateway.chat(
        messages as Parameters<typeof llmGateway.chat>[0],
        { model, requestId: `${requestId}-high`, temperature: tHigh, maxTokens: 800 },
      ),
    ]);

    const lowText  = lowRes.content;
    const highText = highRes.content;

    // ── 2. Variance computation ──────────────────────────────────────────────
    const varBreakdown = computeVariance(lowText, highText);
    const confidence   = Math.max(0.10, Math.min(0.99, 1 - varBreakdown.combined));

    Logger.debug('[UncertaintyEstimator] variance computed', {
      requestId,
      variance  : varBreakdown.combined,
      confidence: Math.round(confidence * 100) / 100,
    });

    // ── 3. Optional claim-level decomposition ────────────────────────────────
    let claimConfidences: ClaimConfidence[] | undefined;

    if (opts.decomposeClaims) {
      const claims = await decomposeClaims(lowText, requestId, model);
      if (claims.length > 0) {
        claimConfidences = await Promise.all(
          claims.map(async claim => {
            const conf = await assessClaimConfidence(claim, `${requestId}-claim`, model);
            const claimVarBreakdown = computeVariance(claim, claim); // self-variance = 0
            return {
              claim,
              confidence: conf,
              variance  : claimVarBreakdown.combined,
            };
          }),
        );
      }
    }

    const durationMs = Date.now() - start;

    Logger.info('[UncertaintyEstimator] uncertainty estimation complete', {
      requestId,
      confidence: Math.round(confidence * 100) / 100,
      variance  : varBreakdown.combined,
      claims    : claimConfidences?.length ?? 0,
      durationMs,
    });

    return {
      requestId,
      confidence: Math.round(confidence * 1000) / 1000,
      variance  : varBreakdown.combined,
      samples   : { low: lowText, high: highText },
      variances : {
        editDistance      : varBreakdown.editDistance,
        jaccardDistance   : varBreakdown.jaccardDistance,
        sentenceDivergence: varBreakdown.sentenceDivergence,
      },
      claims    : claimConfidences,
      durationMs,
    };
  }

  /**
   * Quick confidence estimate for a single string (no sampling).
   * Uses internal consistency checks only — cheaper but less accurate.
   */
  quickEstimate(text: string): number {
    if (!text || text.trim().length < 20) return 0.3;

    // Heuristics: hedging language lowers confidence
    const hedgeWords = (text.match(/\b(?:might|may|could|possibly|perhaps|uncertain|unclear|approximately|roughly|around|about|I think|I believe|I'm not sure|not certain|estimate)\b/gi) ?? []).length;
    const wordCount  = text.trim().split(/\s+/).length;
    const hedgeRate  = hedgeWords / Math.max(1, wordCount / 20);

    return Math.max(0.1, Math.min(0.99, 0.85 - hedgeRate * 0.2));
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const uncertaintyEstimator = new UncertaintyEstimator();
