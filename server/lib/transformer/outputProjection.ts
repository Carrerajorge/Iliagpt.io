/**
 * Output projection: decoder hidden states → vocabulary logits → softmax
 * probabilities.
 *
 * Section 3.4 of the paper:
 *
 *   "We also use the usual learned linear transformation and softmax
 *    function to convert the decoder output to predicted next-token
 *    probabilities. In our model, we share the same weight matrix
 *    between the two embedding layers and the pre-softmax linear
 *    transformation, similar to [24]. In the embedding layers, we
 *    multiply those weights by sqrt(d_model)."
 *
 * Two modes:
 *
 *   1. **Tied output projection** — the output linear uses the transpose
 *      of the shared embedding table (weight tying). This matches the
 *      paper's default and saves `vocab * d_model` parameters.
 *
 *   2. **Untied output projection** — a dedicated `(d_model, vocab)`
 *      weight matrix. Useful when you want to decouple the input and
 *      output representations (e.g. for some fine-tuning workflows).
 */

import { type Matrix, matmul, transpose, softmax, zeros, xavier } from "./matrix";
import type { EmbeddingTable } from "./encoding";

// ---------------------------------------------------------------------------
// Tied output projection
// ---------------------------------------------------------------------------

/**
 * Project decoder hidden states (n, d_model) onto the shared embedding
 * table to produce raw logits of shape (n, vocab).
 *
 *   logits = decoderHidden · E^T
 *
 * Where `E` is the embedding matrix (vocab, d_model). The transpose is
 * implied by the "weight tying" trick.
 */
export function tiedOutputLogits(decoderHidden: Matrix, embeddingTable: EmbeddingTable): Matrix {
  if (decoderHidden.cols !== embeddingTable.dModel) {
    throw new Error(
      `tiedOutputLogits: hidden.cols (${decoderHidden.cols}) != d_model (${embeddingTable.dModel})`,
    );
  }
  // (n, d_model) · (d_model, vocab) → (n, vocab)
  return matmul(decoderHidden, transpose(embeddingTable.weights));
}

// ---------------------------------------------------------------------------
// Untied output projection
// ---------------------------------------------------------------------------

export interface UntiedOutputProjection {
  /** Shape: (d_model, vocab_size). */
  W: Matrix;
  /** Optional bias, shape (1, vocab_size). */
  b?: Matrix;
}

export function initUntiedOutputProjection(
  dModel: number,
  vocabSize: number,
  seed = 777,
): UntiedOutputProjection {
  return {
    W: xavier(dModel, vocabSize, seed),
    b: zeros(1, vocabSize),
  };
}

/**
 * Untied output projection: dedicated weight matrix + optional bias.
 * Returns raw logits of shape (n, vocab).
 */
export function untiedOutputLogits(
  decoderHidden: Matrix,
  projection: UntiedOutputProjection,
): Matrix {
  const logits = matmul(decoderHidden, projection.W);
  if (!projection.b) return logits;
  const out = zeros(logits.rows, logits.cols);
  for (let i = 0; i < logits.rows; i++) {
    for (let j = 0; j < logits.cols; j++) {
      out.data[i * logits.cols + j] = logits.data[i * logits.cols + j] + projection.b.data[j];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Probabilities
// ---------------------------------------------------------------------------

/** Convert raw logits (n, vocab) into a probability distribution via softmax. */
export function logitsToProbs(logits: Matrix): Matrix {
  return softmax(logits);
}

/** Return the argmax token id for every row (greedy next-token prediction). */
export function argmaxTokens(probsOrLogits: Matrix): number[] {
  const out: number[] = [];
  for (let i = 0; i < probsOrLogits.rows; i++) {
    let best = 0;
    let bestVal = -Infinity;
    for (let j = 0; j < probsOrLogits.cols; j++) {
      const v = probsOrLogits.data[i * probsOrLogits.cols + j];
      if (v > bestVal) {
        bestVal = v;
        best = j;
      }
    }
    out.push(best);
  }
  return out;
}

/**
 * Return the top-k token ids and their probabilities for each row.
 * Used by beam search.
 */
export function topK(
  probsOrLogits: Matrix,
  k: number,
): Array<Array<{ tokenId: number; score: number }>> {
  const out: Array<Array<{ tokenId: number; score: number }>> = [];
  for (let i = 0; i < probsOrLogits.rows; i++) {
    const row: Array<{ tokenId: number; score: number }> = [];
    for (let j = 0; j < probsOrLogits.cols; j++) {
      row.push({ tokenId: j, score: probsOrLogits.data[i * probsOrLogits.cols + j] });
    }
    row.sort((a, b) => b.score - a.score);
    out.push(row.slice(0, k));
  }
  return out;
}
