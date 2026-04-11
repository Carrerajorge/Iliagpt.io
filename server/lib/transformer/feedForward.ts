/**
 * Position-wise Feed-Forward Network (section 3.3 of the paper).
 *
 *   Equation (2):
 *     FFN(x) = max(0, x W_1 + b_1) W_2 + b_2
 *
 * "While the linear transformations are the same across different
 * positions, they use different parameters from layer to layer. Another
 * way of describing this is as two convolutions with kernel size 1."
 *
 * Paper dimensions (base model):
 *   - input/output: d_model = 512
 *   - inner layer:  d_ff = 2048
 */

import { type Matrix, matmul, addBias, relu, xavier } from "./matrix";

export interface FFNWeights {
  /** W_1 ∈ R^(d_model × d_ff) */
  W1: Matrix;
  /** b_1 ∈ R^(1 × d_ff) */
  b1: Matrix;
  /** W_2 ∈ R^(d_ff × d_model) */
  W2: Matrix;
  /** b_2 ∈ R^(1 × d_model) */
  b2: Matrix;
}

/**
 * Build a deterministic set of FFN weights using the seeded PRNG.
 *
 *   d_model: input/output dim (paper: 512)
 *   d_ff:    inner layer dim  (paper: 2048)
 */
export function initFFNWeights(dModel: number, dFF: number, seed = 7): FFNWeights {
  return {
    W1: xavier(dModel, dFF, seed + 0),
    b1: xavier(1, dFF, seed + 1),
    W2: xavier(dFF, dModel, seed + 2),
    b2: xavier(1, dModel, seed + 3),
  };
}

/**
 * Apply the position-wise feed-forward network.
 *
 *   Input:  x shape (seq_len, d_model)
 *   Output: shape (seq_len, d_model)
 *
 * The same W/b are applied to every position in the sequence; this is
 * the "applied to each position separately and identically" clause from
 * section 3.3.
 */
export function feedForward(x: Matrix, weights: FFNWeights): Matrix {
  if (x.cols !== weights.W1.rows) {
    throw new Error(
      `feedForward: x.cols (${x.cols}) must equal W1.rows (${weights.W1.rows}) — both are d_model`,
    );
  }
  if (weights.W1.cols !== weights.W2.rows) {
    throw new Error(
      `feedForward: W1.cols (${weights.W1.cols}) must equal W2.rows (${weights.W2.rows}) — both are d_ff`,
    );
  }
  if (weights.b1.rows !== 1 || weights.b1.cols !== weights.W1.cols) {
    throw new Error(
      `feedForward: b1 must be 1x${weights.W1.cols}, got ${weights.b1.rows}x${weights.b1.cols}`,
    );
  }
  if (weights.b2.rows !== 1 || weights.b2.cols !== weights.W2.cols) {
    throw new Error(
      `feedForward: b2 must be 1x${weights.W2.cols}, got ${weights.b2.rows}x${weights.b2.cols}`,
    );
  }

  // max(0, x W_1 + b_1)
  const hidden = relu(addBias(matmul(x, weights.W1), weights.b1));
  // ... W_2 + b_2
  return addBias(matmul(hidden, weights.W2), weights.b2);
}
