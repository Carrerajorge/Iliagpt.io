/**
 * Evaluation utilities for language models (GPT-4 Technical Report,
 * §3 and Figure 8).
 *
 *   §3: "We evaluated GPT-4 on a diverse set of benchmarks, including
 *    simulating exams originally designed for humans."
 *
 *   Figure 8: calibration curves showing that raw log-probabilities
 *    from the pre-trained model are well-calibrated, and RLHF
 *    fine-tuning hurts calibration — a finding that motivates
 *    tracking calibration explicitly in production.
 *
 * This module provides three things:
 *
 *   1. **Multiple-choice evaluation** — for every candidate answer,
 *      compute the sequence log-likelihood under the model; pick the
 *      argmax. This is the protocol used by MMLU, ARC, HellaSwag,
 *      the SAT / LSAT / Uniform Bar items the GPT-4 paper reports,
 *      and most other exam-style benchmarks in the literature.
 *
 *   2. **Expected Calibration Error (ECE)** — Naeini et al. 2015, used
 *      by the GPT-4 paper in §3 to quantify the gap between predicted
 *      probability and observed accuracy. Lower is better.
 *
 *   3. **Chain-of-thought prompt** (Wei et al. 2022) — wraps an
 *      `ArithmeticTemplateInput` with the "Let's think step by step"
 *      preamble that the GPT-4 paper uses for multi-step reasoning
 *      benchmarks.
 */

import { logSoftmax } from "../loss";
import type { Matrix } from "../matrix";

// ---------------------------------------------------------------------------
// Multiple-choice evaluation
// ---------------------------------------------------------------------------

/**
 * Compute the sum of log-probabilities a language model assigns to a
 * target token sequence given a prompt logit matrix.
 *
 * The convention matches everything in the literature: the model
 * processed `[prompt ++ target]` and produced `logits` of shape
 * `(len(prompt) + len(target), vocabSize)`. We score only the
 * positions that predict the TARGET tokens — i.e. rows
 * `[len(prompt) − 1 .. len(prompt) + len(target) − 2]` — and sum
 * their individual log-probabilities at the gold token id.
 *
 *   seqLogLikelihood = Σ_t log P(target_t | prompt, target_{<t})
 *
 * Returns the sum (not mean) so callers can combine across tokens
 * and examples without accumulating floating-point drift.
 */
export function sequenceLogLikelihood(
  logits: Matrix,
  promptLength: number,
  targetTokens: number[],
): number {
  if (targetTokens.length === 0) {
    throw new Error("sequenceLogLikelihood: targetTokens is empty");
  }
  if (promptLength < 1) {
    throw new Error(`sequenceLogLikelihood: promptLength ${promptLength} must be ≥ 1`);
  }
  const expectedRows = promptLength + targetTokens.length;
  if (logits.rows !== expectedRows) {
    throw new Error(
      `sequenceLogLikelihood: logits has ${logits.rows} rows but prompt+target needs ${expectedRows}`,
    );
  }
  const logP = logSoftmax(logits);
  let total = 0;
  for (let i = 0; i < targetTokens.length; i++) {
    // Row `promptLength - 1 + i` is the row whose softmax distribution
    // predicts `target_i` (next-token conditioning).
    const row = promptLength - 1 + i;
    const tok = targetTokens[i];
    if (!Number.isInteger(tok) || tok < 0 || tok >= logits.cols) {
      throw new Error(
        `sequenceLogLikelihood: target[${i}] = ${tok} out of vocab [0, ${logits.cols})`,
      );
    }
    total += logP.data[row * logits.cols + tok];
  }
  return total;
}

export interface MultipleChoiceResult {
  /** Argmax index: the chosen answer. */
  prediction: number;
  /** Per-candidate sum log-likelihood. */
  logLikelihoods: number[];
  /** Softmax of the log-likelihoods → probabilities over candidates. */
  probabilities: number[];
}

/**
 * Score K multiple-choice candidates against a prompt and return the
 * argmax + full probability distribution.
 *
 * The caller is responsible for having already run the model forward
 * on each `[prompt ++ candidate_k]` and for providing the resulting
 * logits matrix per candidate. We keep this function purely numerical
 * so it works unchanged with GPT-3, BERT, and any future decoder.
 *
 *   Inputs:
 *     promptLength     — shared prompt length (e.g. 42 for "Question: ...?")
 *     candidates       — K arrays of gold token ids (one per answer choice)
 *     logitsPerChoice  — K logits matrices, shape (promptLength+len(cand_k), V)
 *
 * The probabilities are computed over CANDIDATES, not over the vocab:
 * they encode which answer the model prefers, and they sum to 1
 * across the K choices.
 */
export function multipleChoiceEval(
  promptLength: number,
  candidates: number[][],
  logitsPerChoice: Matrix[],
): MultipleChoiceResult {
  if (candidates.length === 0) {
    throw new Error("multipleChoiceEval: no candidates");
  }
  if (candidates.length !== logitsPerChoice.length) {
    throw new Error(
      `multipleChoiceEval: candidates (${candidates.length}) vs logits (${logitsPerChoice.length}) length mismatch`,
    );
  }

  const logLikelihoods: number[] = candidates.map((cand, k) =>
    sequenceLogLikelihood(logitsPerChoice[k], promptLength, cand),
  );

  // Numerically stable softmax over the K log-likelihoods
  let max = -Infinity;
  for (const ll of logLikelihoods) if (ll > max) max = ll;
  let sumExp = 0;
  const exps: number[] = new Array(logLikelihoods.length);
  for (let i = 0; i < logLikelihoods.length; i++) {
    exps[i] = Math.exp(logLikelihoods[i] - max);
    sumExp += exps[i];
  }
  const probabilities = exps.map((e) => e / sumExp);

  // Argmax
  let best = 0;
  for (let k = 1; k < logLikelihoods.length; k++) {
    if (logLikelihoods[k] > logLikelihoods[best]) best = k;
  }

  return { prediction: best, logLikelihoods, probabilities };
}

// ---------------------------------------------------------------------------
// Expected Calibration Error (Naeini et al. 2015)
// ---------------------------------------------------------------------------

export interface CalibrationPrediction {
  /** Predicted probability assigned to the outcome. */
  probability: number;
  /** Whether the prediction turned out to be correct. */
  correct: boolean;
}

export interface CalibrationResult {
  /** Overall ECE: weighted average bin-level |accuracy − confidence|. */
  ece: number;
  /**
   * Per-bin breakdown. Length = numBins. Each entry has `count`,
   * `meanConfidence`, `meanAccuracy`, and `gap = |accuracy − confidence|`.
   */
  bins: Array<{
    lo: number;
    hi: number;
    count: number;
    meanConfidence: number;
    meanAccuracy: number;
    gap: number;
  }>;
}

/**
 * Expected Calibration Error over a batch of (probability, correct)
 * predictions. We bin predictions by their probability into `numBins`
 * equal-width intervals on [0, 1], then for each non-empty bin
 * compute the absolute gap between the bin's observed accuracy and
 * its mean confidence. The weighted average (weighted by bin count)
 * is the ECE.
 *
 * The GPT-4 paper reports this number in §3 / Figure 8 and uses it
 * to show that RLHF fine-tuning degrades calibration.
 *
 * Default numBins = 10, which is the Naeini et al. 2015 convention.
 */
export function expectedCalibrationError(
  predictions: CalibrationPrediction[],
  numBins = 10,
): CalibrationResult {
  if (predictions.length === 0) {
    throw new Error("expectedCalibrationError: no predictions");
  }
  if (numBins < 1) {
    throw new Error(`expectedCalibrationError: numBins ${numBins} must be ≥ 1`);
  }
  for (let i = 0; i < predictions.length; i++) {
    const p = predictions[i].probability;
    if (p < 0 || p > 1 || !Number.isFinite(p)) {
      throw new Error(
        `expectedCalibrationError: prediction[${i}].probability = ${p} out of [0, 1]`,
      );
    }
  }

  // Bin boundaries: [0, 1/B), [1/B, 2/B), ..., [(B-1)/B, 1]
  const bins = new Array(numBins).fill(0).map((_, i) => ({
    lo: i / numBins,
    hi: (i + 1) / numBins,
    count: 0,
    sumConfidence: 0,
    sumCorrect: 0,
  }));

  for (const p of predictions) {
    // Edge case: probability exactly 1 goes into the last bin.
    const idx = Math.min(numBins - 1, Math.floor(p.probability * numBins));
    const b = bins[idx];
    b.count++;
    b.sumConfidence += p.probability;
    b.sumCorrect += p.correct ? 1 : 0;
  }

  let ece = 0;
  const n = predictions.length;
  const binResult: CalibrationResult["bins"] = [];
  for (const b of bins) {
    if (b.count === 0) {
      binResult.push({
        lo: b.lo,
        hi: b.hi,
        count: 0,
        meanConfidence: 0,
        meanAccuracy: 0,
        gap: 0,
      });
      continue;
    }
    const meanConfidence = b.sumConfidence / b.count;
    const meanAccuracy = b.sumCorrect / b.count;
    const gap = Math.abs(meanAccuracy - meanConfidence);
    ece += (b.count / n) * gap;
    binResult.push({
      lo: b.lo,
      hi: b.hi,
      count: b.count,
      meanConfidence,
      meanAccuracy,
      gap,
    });
  }

  return { ece, bins: binResult };
}

// ---------------------------------------------------------------------------
// Chain-of-thought prompt wrapper
// ---------------------------------------------------------------------------

/**
 * Chain-of-thought preamble text (Wei et al. 2022, used throughout
 * the GPT-4 evaluations). This is a string, not tokens — the task
 * templates in `gpt/taskTemplates.ts` handle the tokenization.
 */
export const CHAIN_OF_THOUGHT_PREAMBLE = "Let's think step by step.";

/**
 * Wrap an arbitrary task question with the chain-of-thought preamble.
 * Returns a new string the caller can pass as the `query` field of
 * any of the task templates:
 *
 *   withChainOfThought("What is 48 plus 76?")
 *   → "What is 48 plus 76?\nLet's think step by step."
 *
 * For the GPT-4 paper's exam evaluations this preamble is placed
 * AFTER the question so that the model sees the full question first
 * and then is prompted to reason step-by-step before answering.
 */
export function withChainOfThought(question: string): string {
  return `${question}\n${CHAIN_OF_THOUGHT_PREAMBLE}`;
}
