/**
 * BERT pre-training loss — the combined MLM + NSP objective.
 *
 * Devlin et al. 2018, §A.2:
 *
 *   "The training loss is the sum of the mean masked LM likelihood
 *    and the mean next sentence prediction likelihood."
 *
 * This file wraps `bertForward` + `bertMLMLogits` + the NSP head into a
 * single helper that returns the three relevant scalars:
 *
 *   {
 *     mlmLoss: number,   // mean CE over masked positions
 *     nspLoss: number,   // CE on the binary NSP label
 *     total:   number,   // mlmLoss + nspLoss
 *   }
 *
 * plus a `details` block containing the per-head intermediate results
 * so tests and visualizations can inspect them without re-running the
 * forward pass.
 */

import type { Matrix } from "../matrix";
import type { DropoutConfig } from "../dropout";
import { bertForward } from "./model";
import { bertMLMLogits, maskedLMLoss, type MaskedLMLossResult } from "./maskedLM";
import {
  nextSentenceLoss,
  type NSPLabel,
  type NSPLossResult,
} from "./nsp";
import type { BertWeights } from "./types";

export interface BertPreTrainingBatch {
  /** Full packed input: [CLS] A [SEP] B [SEP] [PAD]... */
  tokenIds: number[];
  /** Segment ids: 0 for sentence A, 1 for sentence B. */
  segmentIds: number[];
  /** Positions (after masking) at which the MLM objective is scored. */
  maskedPositions: number[];
  /** Gold token ids at those positions (the pre-mask values). */
  originalTokens: number[];
  /** Gold NSP label: NSP_IS_NEXT (0) or NSP_NOT_NEXT (1). */
  nspLabel: NSPLabel;
}

export interface BertPreTrainingResult {
  /** Mean MLM cross-entropy loss over `maskedPositions`. */
  mlmLoss: number;
  /** NSP cross-entropy loss on the gold label. */
  nspLoss: number;
  /** Combined training loss = mlmLoss + nspLoss (paper §A.2). */
  total: number;
  /** Detailed per-head outputs, in case callers want to drill in. */
  details: {
    sequenceOutput: Matrix;
    pooledOutput: Matrix;
    mlm: MaskedLMLossResult;
    nsp: NSPLossResult;
  };
}

/**
 * Compute the full BERT pre-training loss for one example. The forward
 * pass runs only ONCE even though two heads consume it, so this is the
 * efficient entry point to use inside a training loop.
 */
export function bertPreTrainingLoss(
  weights: BertWeights,
  batch: BertPreTrainingBatch,
  dropoutConfig?: DropoutConfig,
): BertPreTrainingResult {
  // Shared forward pass — both heads read from the same sequenceOutput
  // and pooledOutput. Running forward twice would be a silent ~2× cost.
  const { sequenceOutput, pooledOutput } = bertForward(
    weights,
    batch.tokenIds,
    batch.segmentIds,
    dropoutConfig,
  );

  // MLM head
  const mlmLogits = bertMLMLogits(sequenceOutput, weights);
  const mlm = maskedLMLoss(mlmLogits, batch.maskedPositions, batch.originalTokens);

  // NSP head
  const nsp = nextSentenceLoss(pooledOutput, weights.nspHead, batch.nspLabel);

  return {
    mlmLoss: mlm.loss,
    nspLoss: nsp.loss,
    total: mlm.loss + nsp.loss,
    details: { sequenceOutput, pooledOutput, mlm, nsp },
  };
}
