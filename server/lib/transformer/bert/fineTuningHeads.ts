/**
 * BERT fine-tuning heads (Figure 4 of Devlin et al. 2018).
 *
 * The paper's §3.2 thesis is that one pre-trained BERT model can be
 * adapted to an enormous range of downstream tasks by plugging in a
 * trivially small task head on top of the final hidden states. Figure 4
 * enumerates the four canonical patterns:
 *
 *   (a) Sentence Pair Classification — MNLI, QQP, QNLI, STS-B, MRPC,
 *       RTE, SWAG. Task head: Dense(H → K) on the pooled [CLS] vector.
 *
 *   (b) Single Sentence Classification — SST-2, CoLA. Same mechanical
 *       shape as (a); they differ only in how the input is packed.
 *
 *   (c) Question Answering (SQuAD v1.1 / v2.0) — learn two vectors
 *       S ∈ R^H and E ∈ R^H; the start probability for position i is
 *       softmax_i(T_i · S), and analogously for the end. The training
 *       loss is the sum of the start and end NLLs at the gold positions.
 *
 *   (d) Single Sentence Tagging — CoNLL-2003 NER. Task head:
 *       Dense(H → K) applied to every T_i independently. Cross-entropy
 *       loss summed over non-pad positions.
 *
 * Each head lives here as a tiny trio of functions: `init*`, forward
 * logits, and loss. They operate on the outputs of `bertForward()` and
 * are completely independent — you can use any combination without
 * touching the pre-training heads (MLM, NSP).
 */

import { type Matrix, zeros, truncatedNormal, matmul, addBias } from "../matrix";
import { logSoftmax } from "../loss";
import type { BertConfig } from "./types";

// ---------------------------------------------------------------------------
// (a) + (b) Classification head: pooled [CLS] → K logits
// ---------------------------------------------------------------------------

export interface BertClassificationHeadWeights {
  /** Dense W, shape (hiddenSize, numLabels). */
  weight: Matrix;
  /** Dense bias, shape (1, numLabels). */
  bias: Matrix;
  /** Number of output classes K. */
  numLabels: number;
}

/**
 * Initialize a fresh classification head for `numLabels` classes. Uses
 * BERT's paper-exact TruncatedNormal(σ=config.initStdDev) init.
 */
export function initBertClassificationHead(
  config: BertConfig,
  numLabels: number,
  seed = 30000,
): BertClassificationHeadWeights {
  if (numLabels < 1) {
    throw new Error(`initBertClassificationHead: numLabels must be ≥ 1, got ${numLabels}`);
  }
  return {
    weight: truncatedNormal(config.hiddenSize, numLabels, config.initStdDev, seed),
    bias: zeros(1, numLabels),
    numLabels,
  };
}

/**
 * Classification logits:
 *
 *   logits = pooled · W + b         shape (1, K)
 *
 * Pooled comes from `bertForward(...).pooledOutput`.
 */
export function bertClassificationLogits(
  pooled: Matrix,
  head: BertClassificationHeadWeights,
): Matrix {
  if (pooled.rows !== 1) {
    throw new Error(
      `bertClassificationLogits: expected pooled shape (1, H), got (${pooled.rows}, ${pooled.cols})`,
    );
  }
  return addBias(matmul(pooled, head.weight), head.bias);
}

export interface ClassificationLossResult {
  loss: number;
  prediction: number;
  goldLogProb: number;
}

/**
 * Cross-entropy loss for a single example. `label` is the integer class id.
 * Uses the numerically stable `logSoftmax` from the shared loss module.
 */
export function bertClassificationLoss(
  pooled: Matrix,
  head: BertClassificationHeadWeights,
  label: number,
): ClassificationLossResult {
  if (!Number.isInteger(label) || label < 0 || label >= head.numLabels) {
    throw new Error(
      `bertClassificationLoss: label ${label} out of range [0, ${head.numLabels})`,
    );
  }
  const logits = bertClassificationLogits(pooled, head);
  const logP = logSoftmax(logits);
  const goldLogProb = logP.data[label];
  const loss = -goldLogProb;
  // Argmax
  let best = 0;
  let bestVal = logits.data[0];
  for (let k = 1; k < head.numLabels; k++) {
    if (logits.data[k] > bestVal) {
      bestVal = logits.data[k];
      best = k;
    }
  }
  return { loss, prediction: best, goldLogProb };
}

// ---------------------------------------------------------------------------
// (c) SQuAD-style span prediction head
// ---------------------------------------------------------------------------

export interface BertSpanHeadWeights {
  /** Start vector S, shape (hiddenSize, 1). */
  startVector: Matrix;
  /** End vector E, shape (hiddenSize, 1). */
  endVector: Matrix;
}

/**
 * Initialize a span head. `S` and `E` are the two learned column
 * vectors from §4.2 of the paper:
 *
 *   P_i(start) = softmax_i( T_i · S )
 *   P_j(end)   = softmax_j( T_j · E )
 */
export function initBertSpanHead(config: BertConfig, seed = 35000): BertSpanHeadWeights {
  return {
    startVector: truncatedNormal(config.hiddenSize, 1, config.initStdDev, seed),
    endVector: truncatedNormal(config.hiddenSize, 1, config.initStdDev, seed + 1),
  };
}

export interface BertSpanLogits {
  /** Raw start logits, shape (seqLen,). */
  start: number[];
  /** Raw end logits, shape (seqLen,). */
  end: number[];
}

/**
 * Compute start and end logits over every position in the sequence.
 *
 *   start[i] = T_i · S
 *   end[i]   = T_i · E
 *
 * The caller then applies softmax over the sequence axis (or uses the
 * loss helper below, which already does it numerically stably).
 */
export function bertSpanLogits(
  sequenceOutput: Matrix,
  head: BertSpanHeadWeights,
): BertSpanLogits {
  const startMat = matmul(sequenceOutput, head.startVector); // (seqLen, 1)
  const endMat = matmul(sequenceOutput, head.endVector); // (seqLen, 1)
  const start = Array.from(startMat.data);
  const end = Array.from(endMat.data);
  return { start, end };
}

export interface SpanLossResult {
  /** Total loss = start NLL + end NLL. */
  loss: number;
  /** Negative-log-likelihood of the gold start position. */
  startLoss: number;
  /** Negative-log-likelihood of the gold end position. */
  endLoss: number;
  /** Predicted start/end positions via joint argmax (best span where j ≥ i). */
  predictedStart: number;
  predictedEnd: number;
}

/**
 * Result of a SQuAD v2.0 prediction — distinguishes between the
 * "has an answer" and "no answer" cases.
 */
export interface SpanPredictionV2 {
  /** Whether the model predicts that an answer exists. */
  hasAnswer: boolean;
  /** Predicted start position (1 ≤ start ≤ seqLen-1), meaningless if !hasAnswer. */
  start: number;
  /** Predicted end position, meaningless if !hasAnswer. */
  end: number;
  /** s_null = S·C + E·C — the score of the "no answer" hypothesis. */
  nullScore: number;
  /** ŝ_{i,j} = max_{j≥i, i≥1} S·T_i + E·T_j — best non-null span score. */
  bestSpanScore: number;
  /** Decision margin: bestSpanScore - nullScore. Positive iff hasAnswer (when τ=0). */
  margin: number;
}

/**
 * SQuAD v2.0 span prediction (§4.3 of Devlin et al. 2018).
 *
 *   "We treat questions that do not have an answer as having an
 *    answer span with start and end at the [CLS] token. The
 *    probability space for the start and end answer span positions
 *    is extended to include the position of the [CLS] token. For
 *    prediction, we compare the score of the no-answer span:
 *        s_null = S·C + E·C
 *    to the score of the best non-null span:
 *        ŝ_{i,j} = max_{j≥i} S·T_i + E·T_j
 *    We predict a non-null answer when ŝ_{i,j} > s_null + τ."
 *
 * We enforce `i ≥ 1` when scanning for the best non-null span so
 * that [CLS] itself (position 0) is never returned as an answer
 * start/end — otherwise the "best span" could trivially equal the
 * null span by spanning [CLS] to [CLS].
 *
 * @param tau Threshold selected on the dev set to maximize F1. At
 *            τ=0 (the default) the decision is a pure score comparison;
 *            positive τ makes the model more conservative about
 *            predicting answers.
 */
export function bertSpanPredictV2(
  sequenceOutput: Matrix,
  head: BertSpanHeadWeights,
  tau = 0,
): SpanPredictionV2 {
  const n = sequenceOutput.rows;
  if (n < 2) {
    throw new Error(
      `bertSpanPredictV2: sequence too short (n=${n}); need ≥ 2 rows ([CLS] + at least one content token)`,
    );
  }
  const { start, end } = bertSpanLogits(sequenceOutput, head);

  // s_null: S·C + E·C  (C = T_0 = the [CLS] hidden state)
  const nullScore = start[0] + end[0];

  // Best non-null span: max over i ∈ [1, n-1], j ∈ [i, n-1]
  let bestStart = 1;
  let bestEnd = 1;
  let bestScore = -Infinity;
  for (let i = 1; i < n; i++) {
    for (let j = i; j < n; j++) {
      const s = start[i] + end[j];
      if (s > bestScore) {
        bestScore = s;
        bestStart = i;
        bestEnd = j;
      }
    }
  }

  const margin = bestScore - nullScore;
  return {
    hasAnswer: margin > tau,
    start: bestStart,
    end: bestEnd,
    nullScore,
    bestSpanScore: bestScore,
    margin,
  };
}

/**
 * SQuAD v2.0 training loss — extends the v1.1 loss to handle the
 * "no answer" case. When the gold span is null (`goldStart = goldEnd = 0`),
 * the loss is computed at the [CLS] position exactly like any other
 * span (§4.3: "having an answer span with start and end at the [CLS]
 * token"). For non-null questions, behavior is identical to `bertSpanLoss`.
 *
 * Passing `{ goldStart: 0, goldEnd: 0 }` is the paper-exact way to
 * encode "this question has no answer" during fine-tuning.
 */
export function bertSpanLossV2(
  sequenceOutput: Matrix,
  head: BertSpanHeadWeights,
  goldStart: number,
  goldEnd: number,
): SpanLossResult {
  // The underlying formulation is identical — the only semantic
  // difference is that (0, 0) is a legal gold span in v2.0 but was
  // effectively meaningless in v1.1.
  return bertSpanLoss(sequenceOutput, head, goldStart, goldEnd);
}

/**
 * SQuAD loss: sum of start and end negative log-likelihoods at the
 * gold positions. Uses a stable log-sum-exp.
 */
export function bertSpanLoss(
  sequenceOutput: Matrix,
  head: BertSpanHeadWeights,
  goldStart: number,
  goldEnd: number,
): SpanLossResult {
  const n = sequenceOutput.rows;
  if (goldStart < 0 || goldStart >= n) {
    throw new Error(`bertSpanLoss: goldStart ${goldStart} out of range [0, ${n})`);
  }
  if (goldEnd < 0 || goldEnd >= n) {
    throw new Error(`bertSpanLoss: goldEnd ${goldEnd} out of range [0, ${n})`);
  }
  if (goldEnd < goldStart) {
    throw new Error(
      `bertSpanLoss: goldEnd (${goldEnd}) must be ≥ goldStart (${goldStart})`,
    );
  }

  const { start, end } = bertSpanLogits(sequenceOutput, head);

  // Stable log-softmax of a flat vector
  const logSoftmaxVec = (v: number[]): number[] => {
    let max = -Infinity;
    for (const x of v) if (x > max) max = x;
    let sumExp = 0;
    for (const x of v) sumExp += Math.exp(x - max);
    const logSum = Math.log(sumExp);
    return v.map((x) => x - max - logSum);
  };

  const logPStart = logSoftmaxVec(start);
  const logPEnd = logSoftmaxVec(end);
  const startLoss = -logPStart[goldStart];
  const endLoss = -logPEnd[goldEnd];

  // Predicted span = argmax_{i≤j} ( start[i] + end[j] )
  let bestStart = 0;
  let bestEnd = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const s = start[i] + end[j];
      if (s > bestScore) {
        bestScore = s;
        bestStart = i;
        bestEnd = j;
      }
    }
  }

  return {
    loss: startLoss + endLoss,
    startLoss,
    endLoss,
    predictedStart: bestStart,
    predictedEnd: bestEnd,
  };
}

// ---------------------------------------------------------------------------
// (d) Token tagging (NER / POS) head
// ---------------------------------------------------------------------------

export interface BertTokenTaggingHeadWeights {
  /** Dense W, shape (hiddenSize, numLabels). */
  weight: Matrix;
  /** Dense bias, shape (1, numLabels). */
  bias: Matrix;
  /** Number of output classes K (e.g. B-PER, I-PER, O, ...). */
  numLabels: number;
}

export function initBertTokenTaggingHead(
  config: BertConfig,
  numLabels: number,
  seed = 40000,
): BertTokenTaggingHeadWeights {
  if (numLabels < 1) {
    throw new Error(`initBertTokenTaggingHead: numLabels must be ≥ 1, got ${numLabels}`);
  }
  return {
    weight: truncatedNormal(config.hiddenSize, numLabels, config.initStdDev, seed),
    bias: zeros(1, numLabels),
    numLabels,
  };
}

/**
 * Compute per-token tagging logits:
 *
 *   logits[i, k] = T_i · W[:, k] + b[k]       shape (seqLen, numLabels)
 */
export function bertTokenTaggingLogits(
  sequenceOutput: Matrix,
  head: BertTokenTaggingHeadWeights,
): Matrix {
  return addBias(matmul(sequenceOutput, head.weight), head.bias);
}

export interface TokenTaggingLossResult {
  /** Mean cross-entropy loss over scored positions. */
  loss: number;
  /** Predicted label at each scored position. */
  predictions: number[];
  /** Number of positions that contributed to the loss. */
  tokenCount: number;
}

/**
 * Cross-entropy loss for a tagged sequence.
 *
 *   Input:
 *     sequenceOutput — (seqLen, hiddenSize) from `bertForward()`
 *     labels         — gold tag at each position; pass -100 (or < 0)
 *                      for positions that should be ignored (e.g. [CLS],
 *                      [SEP], [PAD], sub-word pieces after the first).
 *
 * The paper's CoNLL-2003 setup (§5.3) scores only the first WordPiece of
 * each real token and ignores everything else — this helper supports
 * that by letting the caller pass any negative value for "skip".
 */
export function bertTokenTaggingLoss(
  sequenceOutput: Matrix,
  head: BertTokenTaggingHeadWeights,
  labels: number[],
): TokenTaggingLossResult {
  if (labels.length !== sequenceOutput.rows) {
    throw new Error(
      `bertTokenTaggingLoss: labels length ${labels.length} != seqLen ${sequenceOutput.rows}`,
    );
  }
  const logits = bertTokenTaggingLogits(sequenceOutput, head);
  const logP = logSoftmax(logits);

  let total = 0;
  let count = 0;
  const predictions: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    // Per-row argmax regardless of label validity
    let best = 0;
    let bestVal = logits.data[i * head.numLabels];
    for (let k = 1; k < head.numLabels; k++) {
      const v = logits.data[i * head.numLabels + k];
      if (v > bestVal) {
        bestVal = v;
        best = k;
      }
    }
    predictions.push(best);

    const lbl = labels[i];
    if (lbl < 0) continue; // -100 style ignore
    if (!Number.isInteger(lbl) || lbl >= head.numLabels) {
      throw new Error(
        `bertTokenTaggingLoss: label[${i}] = ${lbl} out of range [0, ${head.numLabels})`,
      );
    }
    total += -logP.data[i * head.numLabels + lbl];
    count++;
  }

  return {
    loss: count > 0 ? total / count : 0,
    predictions,
    tokenCount: count,
  };
}

// ---------------------------------------------------------------------------
// Multiple-choice head (SWAG-style, §4.4)
// ---------------------------------------------------------------------------

/**
 * SWAG / multiple-choice head (Devlin et al. 2018, §4.4).
 *
 * The paper's exact description:
 *
 *   "When fine-tuning on the SWAG dataset, we construct four input
 *    sequences, each containing the concatenation of the given
 *    sentence (sentence A) and a possible continuation (sentence B).
 *    The only task-specific parameters introduced is a vector whose
 *    dot product with the [CLS] token representation C denotes a
 *    score for each choice which is normalized with a softmax layer."
 *
 * So the "head" is literally a single learned vector w ∈ R^H. The
 * caller runs `bertForward` once per candidate (K times), passes
 * each pooled output to `bertMultipleChoiceScores`, and gets a
 * vector of K raw scores. A softmax + cross-entropy over the K
 * scores gives the training loss.
 */
export interface BertMultipleChoiceHeadWeights {
  /** Learned scoring vector w, shape (hiddenSize, 1). */
  weight: Matrix;
}

export function initBertMultipleChoiceHead(
  config: BertConfig,
  seed = 50000,
): BertMultipleChoiceHeadWeights {
  return {
    weight: truncatedNormal(config.hiddenSize, 1, config.initStdDev, seed),
  };
}

/**
 * Compute the raw score for each candidate given its pooled [CLS]
 * representation.
 *
 * @param pooledPerCandidate Array of (1, H) pooled outputs, one per
 *                            candidate (K in total).
 * @returns Array of K raw scores — one per candidate, in the same order.
 */
export function bertMultipleChoiceScores(
  pooledPerCandidate: Matrix[],
  head: BertMultipleChoiceHeadWeights,
): number[] {
  if (pooledPerCandidate.length === 0) {
    throw new Error(`bertMultipleChoiceScores: need at least one candidate`);
  }
  const scores: number[] = [];
  for (let k = 0; k < pooledPerCandidate.length; k++) {
    const p = pooledPerCandidate[k];
    if (p.rows !== 1) {
      throw new Error(
        `bertMultipleChoiceScores: candidate ${k} has shape (${p.rows}, ${p.cols}), expected (1, H)`,
      );
    }
    if (p.cols !== head.weight.rows) {
      throw new Error(
        `bertMultipleChoiceScores: candidate ${k} cols (${p.cols}) != hiddenSize (${head.weight.rows})`,
      );
    }
    // Dot product: (1, H) · (H, 1) → scalar
    const dot = matmul(p, head.weight);
    scores.push(dot.data[0]);
  }
  return scores;
}

export interface MultipleChoiceLossResult {
  loss: number;
  /** Index of the argmax score. */
  prediction: number;
  /** Raw per-candidate scores before softmax. */
  scores: number[];
  /** Softmax-normalized probabilities over the K candidates. */
  probabilities: number[];
}

/**
 * Cross-entropy loss over the K candidates, with the gold choice
 * passed as an index into `pooledPerCandidate`. Numerically stable
 * log-sum-exp.
 */
export function bertMultipleChoiceLoss(
  pooledPerCandidate: Matrix[],
  head: BertMultipleChoiceHeadWeights,
  goldIndex: number,
): MultipleChoiceLossResult {
  const K = pooledPerCandidate.length;
  if (!Number.isInteger(goldIndex) || goldIndex < 0 || goldIndex >= K) {
    throw new Error(
      `bertMultipleChoiceLoss: goldIndex ${goldIndex} out of range [0, ${K})`,
    );
  }
  const scores = bertMultipleChoiceScores(pooledPerCandidate, head);

  // Stable log-softmax over a flat vector
  let max = -Infinity;
  for (const s of scores) if (s > max) max = s;
  let sumExp = 0;
  for (const s of scores) sumExp += Math.exp(s - max);
  const logSum = Math.log(sumExp);
  const logP = scores.map((s) => s - max - logSum);
  const probabilities = logP.map((lp) => Math.exp(lp));

  // Argmax prediction
  let best = 0;
  for (let k = 1; k < K; k++) {
    if (scores[k] > scores[best]) best = k;
  }

  return {
    loss: -logP[goldIndex],
    prediction: best,
    scores,
    probabilities,
  };
}
