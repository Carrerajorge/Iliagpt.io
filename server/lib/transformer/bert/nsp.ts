/**
 * Next Sentence Prediction head + loss (§3.1 Task #2).
 *
 *   logits = pooledOutput · W + b     W shape (hiddenSize, 2)
 *   loss   = cross-entropy on a binary label  (0 = isNext, 1 = notNext)
 *
 * The input is the POOLED representation (1, hiddenSize) produced by
 * `bertPool`. Pre-training BERT achieves 97-98% accuracy on this task
 * (footnote 5 of the paper).
 *
 * Label convention (our internal choice, documented here once):
 *
 *   0 → isNext    (sentence B is the true successor of sentence A)
 *   1 → notNext   (sentence B is a random sentence from the corpus)
 *
 * The paper calls these `IsNext` and `NotNext`; we use 0/1 as integer
 * ids because every cross-entropy helper in this module operates on
 * integer class ids.
 */

import { type Matrix, matmul, addBias } from "../matrix";
import { logSoftmax } from "../loss";
import type { BertNSPHeadWeights } from "./types";

export const NSP_IS_NEXT = 0;
export const NSP_NOT_NEXT = 1;

export type NSPLabel = typeof NSP_IS_NEXT | typeof NSP_NOT_NEXT;

/**
 * Apply the NSP head to a pooled representation.
 *
 *   Input:  pooled (1, hiddenSize)
 *   Output: logits (1, 2)
 */
export function bertNSPLogits(
  pooled: Matrix,
  weights: BertNSPHeadWeights,
): Matrix {
  if (pooled.rows !== 1) {
    throw new Error(
      `bertNSPLogits: expected pooled shape (1, H), got (${pooled.rows}, ${pooled.cols})`,
    );
  }
  return addBias(matmul(pooled, weights.weight), weights.bias);
}

/**
 * Run the NSP head and turn its logits into class probabilities via
 * softmax. Handy for the REST endpoint.
 */
export function bertNSPProbabilities(
  pooled: Matrix,
  weights: BertNSPHeadWeights,
): { isNext: number; notNext: number } {
  const logits = bertNSPLogits(pooled, weights);
  // Softmax over the 1×2 row
  const m = Math.max(logits.data[0], logits.data[1]);
  const e0 = Math.exp(logits.data[0] - m);
  const e1 = Math.exp(logits.data[1] - m);
  const s = e0 + e1;
  return { isNext: e0 / s, notNext: e1 / s };
}

// ---------------------------------------------------------------------------
// Loss
// ---------------------------------------------------------------------------

export interface NSPLossResult {
  loss: number;
  /** Predicted class (argmax of the logits). */
  prediction: NSPLabel;
  /** Log-probability assigned to the gold label. */
  goldLogProb: number;
}

/**
 * Cross-entropy loss on a single (pooled, label) pair. We reuse the
 * numerically stable `logSoftmax` from the loss module so the result is
 * consistent with every other CE loss in the codebase.
 */
export function nextSentenceLoss(
  pooled: Matrix,
  weights: BertNSPHeadWeights,
  label: NSPLabel,
): NSPLossResult {
  if (label !== NSP_IS_NEXT && label !== NSP_NOT_NEXT) {
    throw new Error(`nextSentenceLoss: label must be 0 (isNext) or 1 (notNext), got ${label}`);
  }
  const logits = bertNSPLogits(pooled, weights);
  const logP = logSoftmax(logits);
  const goldLogProb = logP.data[label];
  const loss = -goldLogProb;
  const prediction: NSPLabel =
    logits.data[NSP_IS_NEXT] >= logits.data[NSP_NOT_NEXT] ? NSP_IS_NEXT : NSP_NOT_NEXT;
  return { loss, prediction, goldLogProb };
}
