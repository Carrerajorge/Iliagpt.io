/**
 * BERT Masked Language Model head + loss (§3.1 Task #1, §A.2).
 *
 *   transform  = Dense(H → H) + bias
 *   activation = GELU
 *   layerNorm  = LayerNorm(γ, β)
 *   logits     = transformed · tokenEmbeddings^T + outputBias
 *   loss       = cross-entropy computed ONLY at masked positions
 *
 * The projection weight is TIED to the input token embedding table —
 * i.e. the same matrix used to look up token embeddings is used,
 * transposed, to project the final hidden states back into vocab space.
 * Only the post-transform `outputBias` lives on the head itself.
 */

import { type Matrix, zeros, matmul, transpose, addBias, gelu, layerNorm } from "../matrix";
import { logSoftmax } from "../loss";
import type { BertWeights } from "./types";

/**
 * Apply the MLM head to a sequence of hidden states.
 *
 *   Input:  sequenceOutput (seqLen, hiddenSize)
 *   Output: logits (seqLen, vocabSize)
 *
 * The caller typically only cares about the rows corresponding to
 * masked positions, but we return the full matrix — downstream code
 * can slice it or use `maskedLMLoss` directly.
 */
export function bertMLMLogits(
  sequenceOutput: Matrix,
  weights: BertWeights,
): Matrix {
  // 1. Dense transform + GELU
  const projected = addBias(
    matmul(sequenceOutput, weights.mlmHead.transformWeight),
    weights.mlmHead.transformBias,
  );
  const activated = gelu(projected);

  // 2. LayerNorm (BERT uses ε=1e-12 — §A.2 reference implementation)
  const normalized = layerNorm(
    activated,
    weights.mlmHead.layerNormGamma.data,
    weights.mlmHead.layerNormBeta.data,
    1e-12,
  );

  // 3. Tied vocab projection: transformed · tokenEmbeddings^T
  const tokenEmbT = transpose(weights.embeddings.tokenEmbeddings);
  const logits = matmul(normalized, tokenEmbT);

  // 4. Add per-vocabulary output bias (broadcast)
  return addBias(logits, weights.mlmHead.outputBias);
}

// ---------------------------------------------------------------------------
// Loss
// ---------------------------------------------------------------------------

export interface MaskedLMLossResult {
  /** Mean negative log-likelihood over the masked positions. */
  loss: number;
  /** Number of positions that contributed to the loss. */
  tokenCount: number;
  /** Per-masked-position losses in the same order as `maskedPositions`. */
  perPosition: number[];
}

/**
 * Compute the MLM cross-entropy loss.
 *
 * The contract:
 *   - `logits`          : (seqLen, vocabSize), full-sequence logits from
 *                          `bertMLMLogits`.
 *   - `maskedPositions` : indices into the sequence where predictions
 *                          should be scored (ignored everywhere else).
 *   - `originalTokens`  : the gold token at each masked position, in the
 *                          same order as `maskedPositions`. Same length.
 *
 * Returns the MEAN loss over the masked positions. Unmasked positions
 * contribute nothing — they are simply skipped. This matches §3.1:
 * "we only predict the masked words rather than reconstructing the
 * entire input".
 */
export function maskedLMLoss(
  logits: Matrix,
  maskedPositions: number[],
  originalTokens: number[],
): MaskedLMLossResult {
  if (maskedPositions.length !== originalTokens.length) {
    throw new Error(
      `maskedLMLoss: maskedPositions (${maskedPositions.length}) and originalTokens (${originalTokens.length}) length mismatch`,
    );
  }
  if (maskedPositions.length === 0) {
    return { loss: 0, tokenCount: 0, perPosition: [] };
  }

  const vocabSize = logits.cols;
  const logP = logSoftmax(logits);

  let total = 0;
  const perPosition: number[] = [];
  for (let i = 0; i < maskedPositions.length; i++) {
    const pos = maskedPositions[i];
    const target = originalTokens[i];
    if (pos < 0 || pos >= logits.rows) {
      throw new Error(
        `maskedLMLoss: position ${pos} out of range [0, ${logits.rows})`,
      );
    }
    if (target < 0 || target >= vocabSize) {
      throw new Error(
        `maskedLMLoss: target ${target} at entry ${i} out of vocab [0, ${vocabSize})`,
      );
    }
    const nll = -logP.data[pos * vocabSize + target];
    perPosition.push(nll);
    total += nll;
  }
  return { loss: total / maskedPositions.length, tokenCount: maskedPositions.length, perPosition };
}

/**
 * Return the top-`k` predicted token ids at each of the given positions,
 * sorted by descending logit. Handy for visualization and the REST
 * endpoint so callers can see "which words would BERT fill in here?".
 */
export function bertMLMTopK(
  logits: Matrix,
  positions: number[],
  k: number,
): Array<Array<{ tokenId: number; score: number }>> {
  if (k < 1) throw new Error(`bertMLMTopK: k must be ≥ 1, got ${k}`);
  const vocabSize = logits.cols;
  const out: Array<Array<{ tokenId: number; score: number }>> = [];
  for (const pos of positions) {
    if (pos < 0 || pos >= logits.rows) {
      throw new Error(
        `bertMLMTopK: position ${pos} out of range [0, ${logits.rows})`,
      );
    }
    const row: Array<{ tokenId: number; score: number }> = [];
    for (let j = 0; j < vocabSize; j++) {
      row.push({ tokenId: j, score: logits.data[pos * vocabSize + j] });
    }
    row.sort((a, b) => b.score - a.score);
    out.push(row.slice(0, Math.min(k, vocabSize)));
  }
  return out;
}

// Guard against accidental tree-shaking when only the types are used.
void zeros;
