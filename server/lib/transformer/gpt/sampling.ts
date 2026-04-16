/**
 * Autoregressive sampling strategies used by GPT-3 and friends.
 *
 * The paper itself (Brown et al. 2020) doesn't introduce new sampling
 * methods — it uses the three standard techniques that emerged around
 * the GPT-2/GPT-3 era:
 *
 *   • Temperature (T > 0):
 *       Divides the logits by T before softmax. T < 1 sharpens the
 *       distribution toward the argmax, T > 1 flattens it. T = 1 is
 *       pure softmax. T → 0⁺ is effectively greedy decoding.
 *
 *   • Top-k (Fan et al. 2018):
 *       Sort tokens by logit descending, zero out everything below
 *       the K-th. k = 0 or k = vocab means "no top-k filter".
 *
 *   • Top-p / nucleus (Holtzman et al. 2019):
 *       Sort tokens by probability descending and keep the smallest
 *       prefix whose cumulative probability ≥ p. Then renormalize
 *       and sample. p = 1 means "no nucleus filter".
 *
 * All three can be combined: the convention used by GPT-3 and the
 * OpenAI API is "temperature first, then top-k, then top-p". We follow
 * that exact order.
 *
 * Every function in this file is deterministic when a `seed` is
 * provided — the same inputs + seed always yield the same token. This
 * is necessary for finite-difference tests, reproducible generation,
 * and paper-faithful regression suites.
 */

import type { SamplingConfig } from "./types";

// ---------------------------------------------------------------------------
// PRNG (Mulberry32, same as everywhere else in the math library)
// ---------------------------------------------------------------------------

function makeRand(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * Apply temperature: `logits[j] /= T`. In place-conscious (returns a
 * new Float64Array) so callers can reuse the original logits.
 *
 * When `T ≤ 0` we fall back to argmax-only behavior: the function
 * returns a copy where the maximum entry is 0 and everything else is
 * −Infinity, guaranteeing that any downstream softmax picks that entry
 * with probability 1.
 */
export function applyTemperature(
  logits: Float64Array | number[],
  temperature: number,
): Float64Array {
  const n = logits.length;
  const out = new Float64Array(n);
  if (temperature <= 0) {
    // Greedy / argmax fallback
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let i = 0; i < n; i++) {
      if (logits[i] > maxVal) {
        maxVal = logits[i];
        maxIdx = i;
      }
    }
    for (let i = 0; i < n; i++) out[i] = -Infinity;
    out[maxIdx] = 0;
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = logits[i] / temperature;
  return out;
}

/**
 * Numerically stable softmax over a flat logits vector. Handles
 * −Infinity entries correctly: they contribute 0 to the sum and map to
 * probability 0 — which is exactly what we want after top-k / top-p
 * filtering.
 */
export function softmaxVector(logits: Float64Array | number[]): Float64Array {
  const n = logits.length;
  let max = -Infinity;
  for (let i = 0; i < n; i++) if (logits[i] > max) max = logits[i];
  const out = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.exp(logits[i] - max);
    out[i] = e;
    sum += e;
  }
  if (sum > 0) {
    for (let i = 0; i < n; i++) out[i] /= sum;
  }
  return out;
}

/**
 * Keep only the top-K highest-scoring logits; replace everything else
 * with −Infinity. When k ≥ logits.length or k ≤ 0, returns a copy of
 * the input (no filtering).
 *
 * O(n log n) via a full sort. For the vocab sizes we care about
 * (≤ 50k) this is fine — the full forward pass dominates by orders
 * of magnitude.
 */
export function topKFilter(
  logits: Float64Array | number[],
  k: number,
): Float64Array {
  const n = logits.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = logits[i];
  if (k <= 0 || k >= n) return out;

  // Find the K-th largest logit via a full sort (simple, correct, fast
  // enough for our vocab sizes). Quickselect would be O(n) but the
  // constants are bad for small n.
  const sorted = Array.from(out).sort((a, b) => b - a);
  const threshold = sorted[k - 1];

  // Mask out anything strictly below the threshold. Entries exactly
  // equal to the threshold are kept — this may retain more than k
  // tokens on ties, which is the standard convention.
  for (let i = 0; i < n; i++) {
    if (out[i] < threshold) out[i] = -Infinity;
  }
  return out;
}

/**
 * Top-p / nucleus filter (Holtzman et al. 2019).
 *
 *   1. Compute softmax probabilities p.
 *   2. Sort tokens by p descending.
 *   3. Keep the smallest prefix whose cumulative sum ≥ p_threshold.
 *   4. Set every other token's LOGIT to −Infinity.
 *
 * Returns filtered LOGITS (not probabilities) so downstream code can
 * still apply additional transformations. When p ≥ 1 or p ≤ 0,
 * returns a copy of the input.
 */
export function topPFilter(
  logits: Float64Array | number[],
  p: number,
): Float64Array {
  const n = logits.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = logits[i];
  if (p >= 1 || p <= 0) return out;

  const probs = softmaxVector(out);
  // Index-sorted by probability descending
  const order = new Array<number>(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => probs[b] - probs[a]);

  // Accumulate until we cross the threshold; everything after that is
  // masked out.
  const keep = new Uint8Array(n);
  let cum = 0;
  let i = 0;
  while (i < n) {
    const idx = order[i];
    keep[idx] = 1;
    cum += probs[idx];
    i++;
    if (cum >= p) break;
  }
  for (let j = 0; j < n; j++) {
    if (!keep[j]) out[j] = -Infinity;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main sampling entry point
// ---------------------------------------------------------------------------

/**
 * Sample a single token id from a logits vector according to the
 * supplied `SamplingConfig`. The order of operations is:
 *
 *   1. If `greedy === true`: return argmax immediately.
 *   2. Apply temperature (if set and > 0).
 *   3. Apply top-k filter (if set).
 *   4. Apply top-p filter (if set).
 *   5. Softmax the remaining logits.
 *   6. Sample one token via inverse-CDF using a seeded PRNG.
 *
 * If every filter collapses to a single survivor, the function
 * deterministically returns that survivor regardless of the PRNG
 * state — which is the correct "temperature → 0" behavior.
 */
export function sampleFromLogits(
  logits: Float64Array | number[],
  config: SamplingConfig = {},
): number {
  const n = logits.length;
  if (n === 0) throw new Error("sampleFromLogits: logits vector is empty");

  // Greedy shortcut
  if (config.greedy) {
    let best = 0;
    let bestVal = logits[0];
    for (let i = 1; i < n; i++) {
      if (logits[i] > bestVal) {
        bestVal = logits[i];
        best = i;
      }
    }
    return best;
  }

  // 1. Temperature
  let working: Float64Array =
    config.temperature !== undefined
      ? applyTemperature(logits, config.temperature)
      : (() => {
          const out = new Float64Array(n);
          for (let i = 0; i < n; i++) out[i] = logits[i];
          return out;
        })();

  // 2. Top-k
  if (config.topK !== undefined && config.topK > 0) {
    working = topKFilter(working, config.topK);
  }

  // 3. Top-p
  if (config.topP !== undefined && config.topP < 1) {
    working = topPFilter(working, config.topP);
  }

  // 4. Softmax
  const probs = softmaxVector(working);

  // Special case: every entry is zero (all filtered out). Fall back to
  // argmax of the original logits.
  let probSum = 0;
  for (let i = 0; i < n; i++) probSum += probs[i];
  if (probSum <= 0) {
    let best = 0;
    let bestVal = logits[0];
    for (let i = 1; i < n; i++) if (logits[i] > bestVal) { bestVal = logits[i]; best = i; }
    return best;
  }

  // 5. Seeded inverse-CDF sample
  const rand = makeRand(config.seed ?? 0xdeadbeef);
  const r = rand();
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += probs[i];
    if (r <= cum) return i;
  }
  // Rounding fallback: return the last non-zero-probability token
  for (let i = n - 1; i >= 0; i--) {
    if (probs[i] > 0) return i;
  }
  return n - 1;
}

/**
 * Count how many tokens remain after a (topK, topP, temperature) filter
 * chain — a small utility used by tests to verify filter composition.
 * Returns the number of non-(-Infinity) entries in the filtered logits.
 */
export function countSurvivors(
  logits: Float64Array | number[],
  config: SamplingConfig = {},
): number {
  let working: Float64Array;
  if (config.temperature !== undefined) {
    working = applyTemperature(logits, config.temperature);
  } else {
    working = new Float64Array(logits.length);
    for (let i = 0; i < logits.length; i++) working[i] = logits[i];
  }
  if (config.topK !== undefined && config.topK > 0) {
    working = topKFilter(working, config.topK);
  }
  if (config.topP !== undefined && config.topP < 1) {
    working = topPFilter(working, config.topP);
  }
  let count = 0;
  for (const v of working) if (Number.isFinite(v)) count++;
  return count;
}
