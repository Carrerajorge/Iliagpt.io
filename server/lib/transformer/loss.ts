/**
 * Cross-entropy loss + label smoothing (section 5.4 of the paper).
 *
 *   "During training, we employed label smoothing of value ε_ls = 0.1.
 *    This hurts perplexity, as the model learns to be more unsure, but
 *    improves accuracy and BLEU score."
 *
 * Label smoothing replaces the hard one-hot target with a soft
 * distribution:
 *
 *   q_smooth(k) = (1 - ε_ls) * 1{k = y}  +  ε_ls / V
 *
 * where y is the true token id and V is the vocabulary size. The loss
 * is then the KL-divergence (equivalently, cross-entropy plus a
 * constant) between the model's predicted distribution and q_smooth.
 *
 * All losses in this module take LOGITS, not probabilities, to get the
 * full numerical benefit of log-softmax (avoids computing exp + log
 * separately which loses precision).
 */

import { type Matrix } from "./matrix";

export interface LabelSmoothingConfig {
  /** ε_ls in the paper. 0.0 = hard targets (classic CE), 0.1 = paper default. */
  epsilon: number;
  /** Size of the vocabulary. Required so we can distribute ε uniformly. */
  vocabSize: number;
  /**
   * Optional padding token id — positions whose target equals this id
   * are skipped entirely (no loss contribution, no gradient). Paper's
   * training ignores padding tokens.
   */
  paddingId?: number;
}

export interface LossResult {
  /** Scalar loss averaged over non-padding tokens. */
  loss: number;
  /** Number of non-padding tokens contributing to the loss. */
  tokenCount: number;
  /** Per-position loss values, shape (seq_len,). Useful for debugging. */
  perToken: number[];
}

// ---------------------------------------------------------------------------
// Log-softmax (numerically stable, per row)
// ---------------------------------------------------------------------------

/**
 * Numerically stable row-wise log-softmax.
 *
 *   log_softmax(x)_i = x_i - max(x) - log(sum_j exp(x_j - max(x)))
 */
export function logSoftmax(logits: Matrix): Matrix {
  const out: Matrix = {
    rows: logits.rows,
    cols: logits.cols,
    data: new Float64Array(logits.rows * logits.cols),
  };
  for (let i = 0; i < logits.rows; i++) {
    let rowMax = -Infinity;
    for (let j = 0; j < logits.cols; j++) {
      const v = logits.data[i * logits.cols + j];
      if (v > rowMax) rowMax = v;
    }
    let sumExp = 0;
    for (let j = 0; j < logits.cols; j++) {
      sumExp += Math.exp(logits.data[i * logits.cols + j] - rowMax);
    }
    const logSum = Math.log(sumExp);
    for (let j = 0; j < logits.cols; j++) {
      out.data[i * logits.cols + j] = logits.data[i * logits.cols + j] - rowMax - logSum;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Label smoothing
// ---------------------------------------------------------------------------

/**
 * Build a smoothed target distribution for one token.
 *
 * Returns a Float64Array of length `vocabSize`:
 *   - `trueToken` gets probability `1 - ε + ε/V`
 *   - every other id gets probability `ε/V`
 *
 * The total mass is exactly 1 (verified in tests).
 */
export function smoothTargets(
  trueToken: number,
  config: LabelSmoothingConfig,
): Float64Array {
  const { epsilon, vocabSize } = config;
  if (trueToken < 0 || trueToken >= vocabSize) {
    throw new Error(`smoothTargets: token ${trueToken} out of vocab [0, ${vocabSize})`);
  }
  if (epsilon < 0 || epsilon >= 1) {
    throw new Error(`smoothTargets: epsilon ${epsilon} must be in [0, 1)`);
  }
  const out = new Float64Array(vocabSize);
  const uniform = epsilon / vocabSize;
  for (let j = 0; j < vocabSize; j++) out[j] = uniform;
  out[trueToken] = 1 - epsilon + uniform;
  return out;
}

// ---------------------------------------------------------------------------
// Cross-entropy loss (with optional label smoothing)
// ---------------------------------------------------------------------------

/**
 * Standard cross-entropy on a batch of positions.
 *
 *   loss_i = - log p_y_i   (where p is softmax(logits) and y_i is the true token)
 *   batch  = mean over non-padding positions
 *
 * When `epsilon > 0`, label smoothing is applied — the loss becomes the
 * full cross-entropy against the smoothed distribution:
 *
 *   loss_i = - sum_j q_smooth(j) * log_softmax(logits)_{i,j}
 *
 * Shapes:
 *   logits:  (seq_len, vocab_size)   — raw logits, NOT softmaxed
 *   targets: number[] of length seq_len — true token ids
 */
export function crossEntropyLoss(
  logits: Matrix,
  targets: number[],
  config: LabelSmoothingConfig,
): LossResult {
  if (targets.length !== logits.rows) {
    throw new Error(
      `crossEntropyLoss: targets length ${targets.length} != logits.rows ${logits.rows}`,
    );
  }
  if (logits.cols !== config.vocabSize) {
    throw new Error(
      `crossEntropyLoss: logits.cols ${logits.cols} != vocabSize ${config.vocabSize}`,
    );
  }
  const logP = logSoftmax(logits);
  const perToken: number[] = [];
  let total = 0;
  let tokenCount = 0;

  for (let i = 0; i < logits.rows; i++) {
    const y = targets[i];
    if (config.paddingId !== undefined && y === config.paddingId) {
      perToken.push(0);
      continue;
    }
    if (y < 0 || y >= config.vocabSize) {
      throw new Error(`crossEntropyLoss: target[${i}] = ${y} out of vocab`);
    }

    let lossI: number;
    if (config.epsilon === 0) {
      // Hard target: - log p_y
      lossI = -logP.data[i * logits.cols + y];
    } else {
      // Label-smoothed: - sum_j q(j) * log p_j
      const uniform = config.epsilon / config.vocabSize;
      const peak = 1 - config.epsilon + uniform;
      lossI = 0;
      for (let j = 0; j < logits.cols; j++) {
        const qj = j === y ? peak : uniform;
        lossI -= qj * logP.data[i * logits.cols + j];
      }
    }

    perToken.push(lossI);
    total += lossI;
    tokenCount++;
  }

  const loss = tokenCount > 0 ? total / tokenCount : 0;
  return { loss, tokenCount, perToken };
}

/**
 * Shortcut for the paper's default: hard-target CE with label smoothing
 * ε=0.1 and no padding mask.
 */
export function paperDefaultLoss(logits: Matrix, targets: number[]): LossResult {
  return crossEntropyLoss(logits, targets, {
    epsilon: 0.1,
    vocabSize: logits.cols,
  });
}

/**
 * Compute the KL divergence from the model distribution to a reference
 * smoothed distribution for a single position. Used by tests to verify
 * label-smoothing equivalence with the closed-form expression.
 */
export function klSmoothed(
  logitsRow: Float64Array,
  trueToken: number,
  config: LabelSmoothingConfig,
): number {
  // Numerically stable row-wise log softmax
  let rowMax = -Infinity;
  for (const v of logitsRow) if (v > rowMax) rowMax = v;
  let sumExp = 0;
  for (const v of logitsRow) sumExp += Math.exp(v - rowMax);
  const logSum = Math.log(sumExp);
  const logP = Array.from(logitsRow, (v) => v - rowMax - logSum);

  const q = smoothTargets(trueToken, config);
  let kl = 0;
  for (let j = 0; j < q.length; j++) {
    // KL(q || p) = sum_j q_j * (log q_j - log p_j)
    if (q[j] > 0) {
      kl += q[j] * (Math.log(q[j]) - logP[j]);
    }
  }
  return kl;
}
