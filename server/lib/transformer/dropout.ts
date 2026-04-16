/**
 * Residual Dropout (section 5.4 of the paper).
 *
 *   "We apply dropout to the output of each sub-layer, before it is
 *    added to the sub-layer input and normalized. In addition, we
 *    apply dropout to the sums of the embeddings and the positional
 *    encodings in both the encoder and decoder stacks. For the base
 *    model, we use a rate of P_drop = 0.1."
 *
 * At training time: each entry is zeroed with probability p, and the
 * remaining entries are scaled by 1/(1-p) so the expected value is
 * preserved ("inverted dropout"). At inference time: identity (no-op).
 *
 * Determinism: the caller supplies a seed so tests are reproducible.
 */

import { type Matrix, zeros } from "./matrix";

export interface DropoutConfig {
  /** Dropout probability in [0, 1). Paper base model: 0.1. */
  rate: number;
  /** If true, dropout is applied; if false, identity. */
  training: boolean;
  /** Seed for the PRNG. Defaults to a fixed value for reproducibility. */
  seed?: number;
}

/**
 * Mulberry32 PRNG — tiny, fast, deterministic, same as the one used by the
 * matrix Xavier init. Used here so dropout masks are reproducible across
 * runs when the same seed is provided.
 */
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

/**
 * Apply inverted dropout to a matrix.
 *
 *   mask ~ Bernoulli(1 - p)
 *   output = x * mask / (1 - p)   // only during training
 *   output = x                    // during inference
 *
 * Returns a NEW matrix; never mutates the input.
 */
export function dropout(x: Matrix, config: DropoutConfig): Matrix {
  if (config.rate < 0 || config.rate >= 1) {
    throw new Error(`dropout: rate ${config.rate} must be in [0, 1)`);
  }
  if (!config.training || config.rate === 0) {
    // Inference path (or rate=0): identity (shallow copy so callers can
    // treat the result as their own buffer).
    const out = zeros(x.rows, x.cols);
    out.data.set(x.data);
    return out;
  }
  const rand = makeRand(config.seed ?? 0xcafebabe);
  const keepProb = 1 - config.rate;
  const scale = 1 / keepProb;
  const out = zeros(x.rows, x.cols);
  for (let i = 0; i < x.data.length; i++) {
    if (rand() < keepProb) {
      out.data[i] = x.data[i] * scale;
    }
    // else: already 0 from `zeros` init
  }
  return out;
}

/**
 * Convenience: dropout at inference time with rate=0. Pure identity.
 * Matches the paper's "at inference, all connections are used".
 */
export function identityDropout(x: Matrix): Matrix {
  return dropout(x, { rate: 0, training: false });
}

/**
 * Compute the "effective keep rate" from a mask (useful for tests).
 * Counts how many entries are non-zero and divides by total.
 */
export function observedKeepRate(x: Matrix): number {
  let kept = 0;
  for (let i = 0; i < x.data.length; i++) {
    if (x.data[i] !== 0) kept++;
  }
  return kept / x.data.length;
}
