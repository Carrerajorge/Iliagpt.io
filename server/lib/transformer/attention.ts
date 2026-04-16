/**
 * Scaled Dot-Product Attention and Multi-Head Attention.
 *
 * Direct implementation of section 3.2 of Vaswani et al. 2017.
 *
 *   Equation (1):
 *     Attention(Q, K, V) = softmax( Q K^T / sqrt(d_k) ) V
 *
 *   Multi-Head (section 3.2.2):
 *     head_i = Attention(Q W_i^Q, K W_i^K, V W_i^V)
 *     MultiHead(Q, K, V) = Concat(head_1, ..., head_h) W^O
 *
 * Where:
 *   - W_i^Q ∈ R^(d_model × d_k)
 *   - W_i^K ∈ R^(d_model × d_k)
 *   - W_i^V ∈ R^(d_model × d_v)
 *   - W^O   ∈ R^(h*d_v × d_model)
 *
 * For the paper's base model: d_model=512, h=8, d_k=d_v=64.
 *
 * This implementation is exact: no approximations, no sparse tricks. The
 * correctness tests in `server/__tests__/transformer.attention.test.ts`
 * hand-compute small cases to verify the math.
 */

import {
  type Matrix,
  matmul,
  transpose,
  scale,
  softmax,
  applyMask,
  concatCols,
  sliceCols,
} from "./matrix";

// ---------------------------------------------------------------------------
// Equation (1): Scaled Dot-Product Attention
// ---------------------------------------------------------------------------

export interface AttentionResult {
  /** The attended output, shape (n_queries, d_v). */
  output: Matrix;
  /** The attention weights (post-softmax), shape (n_queries, n_keys). */
  weights: Matrix;
  /** The pre-softmax scores (post-scaling), shape (n_queries, n_keys). */
  scaledScores: Matrix;
}

/**
 * Compute scaled dot-product attention for a set of queries against a set
 * of key/value pairs.
 *
 *   - Q has shape (n_q, d_k)  — the queries
 *   - K has shape (n_kv, d_k) — the keys
 *   - V has shape (n_kv, d_v) — the values
 *   - mask (optional) has shape (n_q, n_kv) — `true` = attend, `false` = mask out
 *
 * Returns the attended output `(n_q, d_v)`, the attention weights
 * `(n_q, n_kv)` (each row sums to 1), and the pre-softmax scaled scores
 * (useful for tests and visualization).
 */
export function scaledDotProductAttention(
  Q: Matrix,
  K: Matrix,
  V: Matrix,
  mask?: boolean[][],
): AttentionResult {
  if (Q.cols !== K.cols) {
    throw new Error(
      `scaledDotProductAttention: Q.cols (${Q.cols}) must equal K.cols (${K.cols}) — both are d_k`,
    );
  }
  if (K.rows !== V.rows) {
    throw new Error(
      `scaledDotProductAttention: K.rows (${K.rows}) must equal V.rows (${V.rows}) — same n_kv`,
    );
  }

  const d_k = K.cols;
  const scoreScale = 1 / Math.sqrt(d_k);

  // QK^T — raw scores, shape (n_q, n_kv)
  const scores = matmul(Q, transpose(K));

  // Scale by 1/sqrt(d_k) (section 3.2.1 — prevents softmax saturation for
  // large d_k values where the dot products grow in magnitude)
  let scaled = scale(scores, scoreScale);

  // Apply mask (decoder causal mask or encoder padding mask)
  if (mask) {
    scaled = applyMask(scaled, mask);
  }

  // Softmax over the key axis (per-query normalization, rows sum to 1)
  const weights = softmax(scaled);

  // Weighted sum of values
  const output = matmul(weights, V);

  return { output, weights, scaledScores: scaled };
}

// ---------------------------------------------------------------------------
// Equation (5) (multi-head): section 3.2.2
// ---------------------------------------------------------------------------

export interface MultiHeadConfig {
  /** Number of parallel attention heads. Paper uses h=8 for the base model. */
  heads: number;
  /** Model dimension (d_model). Paper: 512. Must be divisible by `heads`. */
  dModel: number;
  /** Per-head key dimension d_k = d_model / heads (paper: 64). */
  dK: number;
  /** Per-head value dimension d_v = d_model / heads (paper: 64). */
  dV: number;
}

export interface MultiHeadWeights {
  /** W_i^Q for each head, shape (d_model, d_k). Length = heads. */
  WQ: Matrix[];
  /** W_i^K for each head, shape (d_model, d_k). Length = heads. */
  WK: Matrix[];
  /** W_i^V for each head, shape (d_model, d_v). Length = heads. */
  WV: Matrix[];
  /** Output projection W^O, shape (h*d_v, d_model). */
  WO: Matrix;
}

export interface MultiHeadResult {
  /** Output of the multi-head layer, shape (n_q, d_model). */
  output: Matrix;
  /** Per-head attention weights, shape (n_q, n_kv). Length = heads. */
  perHeadWeights: Matrix[];
}

/**
 * Build the config for the paper's base model:
 *
 *   d_model = 512, h = 8, d_k = d_v = 64
 */
export function baseConfig(dModel = 512, heads = 8): MultiHeadConfig {
  if (dModel % heads !== 0) {
    throw new Error(`baseConfig: d_model (${dModel}) must be divisible by heads (${heads})`);
  }
  const dK = dModel / heads;
  return { heads, dModel, dK, dV: dK };
}

/**
 * Multi-head attention.
 *
 * Projects Q/K/V to `heads` independent subspaces, runs scaled dot-product
 * attention in each, concatenates the outputs, and applies a final output
 * projection. This is section 3.2.2 of the paper verbatim.
 *
 *   Inputs:
 *     Q shape (n_q,  d_model)
 *     K shape (n_kv, d_model)
 *     V shape (n_kv, d_model)
 *     W  per-head projections and the output projection
 *     mask (optional) shape (n_q, n_kv)
 *
 *   Output: (n_q, d_model), same shape as Q.
 */
export function multiHeadAttention(
  Q: Matrix,
  K: Matrix,
  V: Matrix,
  config: MultiHeadConfig,
  weights: MultiHeadWeights,
  mask?: boolean[][],
): MultiHeadResult {
  if (Q.cols !== config.dModel) {
    throw new Error(`multiHeadAttention: Q.cols (${Q.cols}) != d_model (${config.dModel})`);
  }
  if (weights.WQ.length !== config.heads || weights.WK.length !== config.heads || weights.WV.length !== config.heads) {
    throw new Error(
      `multiHeadAttention: expected ${config.heads} heads, got WQ=${weights.WQ.length} WK=${weights.WK.length} WV=${weights.WV.length}`,
    );
  }
  if (weights.WO.rows !== config.heads * config.dV || weights.WO.cols !== config.dModel) {
    throw new Error(
      `multiHeadAttention: WO shape should be (${config.heads * config.dV}, ${config.dModel}), got (${weights.WO.rows}, ${weights.WO.cols})`,
    );
  }

  const perHeadOutputs: Matrix[] = [];
  const perHeadWeights: Matrix[] = [];

  for (let h = 0; h < config.heads; h++) {
    // Q W_i^Q, K W_i^K, V W_i^V
    const Qh = matmul(Q, weights.WQ[h]); // (n_q, d_k)
    const Kh = matmul(K, weights.WK[h]); // (n_kv, d_k)
    const Vh = matmul(V, weights.WV[h]); // (n_kv, d_v)

    const att = scaledDotProductAttention(Qh, Kh, Vh, mask);
    perHeadOutputs.push(att.output);
    perHeadWeights.push(att.weights);
  }

  // Concat(head_1, ..., head_h) — shape (n_q, h*d_v)
  const concat = concatCols(perHeadOutputs);

  // ... W^O — shape (n_q, d_model)
  const output = matmul(concat, weights.WO);

  return { output, perHeadWeights };
}

// ---------------------------------------------------------------------------
// Weight initialization helpers
// ---------------------------------------------------------------------------

import { xavier } from "./matrix";

/**
 * Build a deterministic set of multi-head weights for a given config.
 * Uses the same seeded PRNG as `xavier` so tests are reproducible.
 */
export function initMultiHeadWeights(config: MultiHeadConfig, seed = 42): MultiHeadWeights {
  const WQ: Matrix[] = [];
  const WK: Matrix[] = [];
  const WV: Matrix[] = [];
  for (let h = 0; h < config.heads; h++) {
    WQ.push(xavier(config.dModel, config.dK, seed + h * 3 + 0));
    WK.push(xavier(config.dModel, config.dK, seed + h * 3 + 1));
    WV.push(xavier(config.dModel, config.dV, seed + h * 3 + 2));
  }
  const WO = xavier(config.heads * config.dV, config.dModel, seed + 1000);
  return { WQ, WK, WV, WO };
}

// ---------------------------------------------------------------------------
// Convenience: extract the per-head Q/K/V slices (used by visualizations)
// ---------------------------------------------------------------------------

/**
 * Given a (seq, d_model) projected block, return the `h` per-head slices
 * each of shape (seq, d_model/h). Used by the demo page to inspect what
 * each head is computing.
 */
export function splitHeads(m: Matrix, heads: number): Matrix[] {
  if (m.cols % heads !== 0) {
    throw new Error(`splitHeads: cols ${m.cols} not divisible by heads ${heads}`);
  }
  const perHead = m.cols / heads;
  const out: Matrix[] = [];
  for (let h = 0; h < heads; h++) {
    out.push(sliceCols(m, h * perHead, (h + 1) * perHead));
  }
  return out;
}
