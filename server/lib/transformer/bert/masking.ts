/**
 * BERT masking procedure (§3.1 Task #1 + Appendix A.1).
 *
 * The paper's rule:
 *
 *   1. Choose 15% of the WordPiece token positions at random from the
 *      input (excluding [CLS], [SEP], and [PAD] — these are never
 *      candidates for masking).
 *
 *   2. Of those chosen positions:
 *        • 80% of the time: replace the token with [MASK]
 *        • 10% of the time: replace it with a random token from the vocab
 *        • 10% of the time: keep the token unchanged
 *      (This mix mitigates the pre-train / fine-tune mismatch that the
 *      [MASK] token would otherwise introduce.)
 *
 *   3. The loss is scored ONLY at the chosen positions against the
 *      original (unmodified) token ids.
 *
 * This module returns a deterministic result under a fixed seed so the
 * test suite can verify the 80/10/10 split statistically and so the
 * training path can reproduce its masking when the training loop needs
 * finite-difference gradients.
 */

import { BERT_SPECIAL_TOKENS } from "./types";

export interface MaskingConfig {
  /** Fraction of eligible positions to mask. Paper: 0.15. */
  maskProbability: number;
  /** Among masked positions: fraction replaced with [MASK]. Paper: 0.80. */
  replaceWithMaskProbability: number;
  /** Among masked positions: fraction replaced with a random token. Paper: 0.10. */
  replaceWithRandomProbability: number;
  /** Among masked positions: fraction left unchanged. Paper: 0.10. */
  keepOriginalProbability: number;
  /** Vocabulary size — used when choosing random replacement tokens. */
  vocabSize: number;
  /** Seed for the PRNG. Caller-controlled for determinism. */
  seed: number;
}

/**
 * Default paper-exact config. Only `vocabSize` and `seed` are required
 * from the caller; the four probabilities match the paper.
 */
export function defaultMaskingConfig(vocabSize: number, seed: number): MaskingConfig {
  return {
    maskProbability: 0.15,
    replaceWithMaskProbability: 0.8,
    replaceWithRandomProbability: 0.1,
    keepOriginalProbability: 0.1,
    vocabSize,
    seed,
  };
}

// ---------------------------------------------------------------------------
// PRNG (same Mulberry32 used across the codebase)
// ---------------------------------------------------------------------------

function makeRand(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Return the set of positions that are eligible for masking: every
 * position whose token is NOT [CLS], [SEP], or [PAD]. We deliberately
 * allow [UNK] and [MASK] to be re-masked — the paper gives no special
 * treatment to them.
 */
function maskableIndices(tokenIds: number[]): number[] {
  const out: number[] = [];
  const { CLS, SEP, PAD } = BERT_SPECIAL_TOKENS;
  for (let i = 0; i < tokenIds.length; i++) {
    const t = tokenIds[i];
    if (t !== CLS && t !== SEP && t !== PAD) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface MaskedBatch {
  /** Modified input ids (with some positions replaced per the 80/10/10 rule). */
  maskedInputIds: number[];
  /** Sorted positions that were chosen for MLM prediction. */
  maskedPositions: number[];
  /** Original (pre-replacement) tokens at those positions, in the same order. */
  originalTokens: number[];
  /**
   * Per-chosen-position action log, in the same order as `maskedPositions`.
   * Useful for the test suite and for debugging the 80/10/10 split.
   */
  actions: Array<"mask" | "random" | "keep">;
}

/**
 * Apply the BERT 80/10/10 masking rule to a single token sequence.
 *
 * Deterministic under `config.seed` — a single seed drives both the
 * choice of positions AND the per-position action, so two calls with
 * the same inputs and seed produce identical output. This is what
 * makes it safe to use inside finite-difference gradient probes during
 * MLM pre-training.
 */
export function applyMaskingProcedure(
  tokenIds: number[],
  config: MaskingConfig,
): MaskedBatch {
  const {
    maskProbability,
    replaceWithMaskProbability,
    replaceWithRandomProbability,
    keepOriginalProbability,
    vocabSize,
    seed,
  } = config;

  const probSum =
    replaceWithMaskProbability + replaceWithRandomProbability + keepOriginalProbability;
  if (Math.abs(probSum - 1) > 1e-9) {
    throw new Error(
      `applyMaskingProcedure: 80/10/10 probabilities must sum to 1, got ${probSum}`,
    );
  }
  if (maskProbability < 0 || maskProbability > 1) {
    throw new Error(`applyMaskingProcedure: maskProbability ${maskProbability} out of [0, 1]`);
  }

  const rand = makeRand(seed);
  const maskableIdx = maskableIndices(tokenIds);

  // Shuffle eligible positions deterministically (Fisher-Yates with our PRNG)
  // so the "choose 15%" step is unbiased.
  const shuffled = maskableIdx.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Compute how many positions to mask; at least 1 if we have any
  // eligible positions (matches the reference implementation, which
  // always masks at least one token per sequence).
  const numToMask = Math.max(
    1,
    Math.min(maskableIdx.length, Math.round(maskableIdx.length * maskProbability)),
  );
  const chosen = shuffled.slice(0, numToMask).sort((a, b) => a - b);

  const maskedInputIds = tokenIds.slice();
  const originalTokens: number[] = [];
  const actions: Array<"mask" | "random" | "keep"> = [];

  for (const pos of chosen) {
    const original = tokenIds[pos];
    originalTokens.push(original);

    const r = rand();
    if (r < replaceWithMaskProbability) {
      // 80% → [MASK]
      maskedInputIds[pos] = BERT_SPECIAL_TOKENS.MASK;
      actions.push("mask");
    } else if (r < replaceWithMaskProbability + replaceWithRandomProbability) {
      // 10% → random vocab token (not a special token)
      // We draw from the full vocab and skip the 5 special ids; for any
      // vocab size > 5 this rejection loop terminates in ≤ 2 iterations
      // in expectation.
      let randomTok: number;
      do {
        randomTok = Math.floor(rand() * vocabSize);
      } while (
        randomTok === BERT_SPECIAL_TOKENS.PAD ||
        randomTok === BERT_SPECIAL_TOKENS.UNK ||
        randomTok === BERT_SPECIAL_TOKENS.CLS ||
        randomTok === BERT_SPECIAL_TOKENS.SEP ||
        randomTok === BERT_SPECIAL_TOKENS.MASK
      );
      maskedInputIds[pos] = randomTok;
      actions.push("random");
    } else {
      // 10% → keep original
      actions.push("keep");
    }
  }

  return { maskedInputIds, maskedPositions: chosen, originalTokens, actions };
}
