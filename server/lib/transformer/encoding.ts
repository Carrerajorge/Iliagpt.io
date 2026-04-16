/**
 * Positional encoding and token embedding — sections 3.4 and 3.5 of the paper.
 *
 * ── Positional Encoding (section 3.5) ──
 *
 *   PE(pos, 2i)   = sin( pos / 10000^(2i / d_model) )
 *   PE(pos, 2i+1) = cos( pos / 10000^(2i / d_model) )
 *
 * Chosen because "for any fixed offset k, PE_{pos+k} can be represented as
 * a linear function of PE_pos" — a property we verify mathematically in
 * the test suite.
 *
 * ── Token Embedding (section 3.4) ──
 *
 * Learned embedding lookup that maps token ids → d_model-dimensional vectors,
 * with the values scaled by sqrt(d_model) per the paper ("In the embedding
 * layers, we multiply those weights by sqrt(d_model)").
 */

import { type Matrix, zeros, xavier } from "./matrix";

// ---------------------------------------------------------------------------
// Positional Encoding
// ---------------------------------------------------------------------------

/**
 * Sinusoidal positional encoding of shape `(seqLen, dModel)`.
 * Deterministic — same inputs always yield the same tensor.
 */
export function positionalEncoding(seqLen: number, dModel: number): Matrix {
  if (seqLen < 0 || !Number.isInteger(seqLen)) {
    throw new Error(`positionalEncoding: seqLen ${seqLen} must be a non-negative integer`);
  }
  if (dModel <= 0 || !Number.isInteger(dModel)) {
    throw new Error(`positionalEncoding: dModel ${dModel} must be a positive integer`);
  }

  const pe = zeros(seqLen, dModel);
  for (let pos = 0; pos < seqLen; pos++) {
    for (let i = 0; i < dModel; i++) {
      // The paper indexes by `2i` for sin and `2i+1` for cos. In practice
      // both even and odd `i` share the same denominator bucket — the
      // frequency at position `i` is determined by `2 * floor(i / 2)`.
      const twoI = 2 * Math.floor(i / 2);
      const denom = Math.pow(10000, twoI / dModel);
      const angle = pos / denom;
      pe.data[pos * dModel + i] = i % 2 === 0 ? Math.sin(angle) : Math.cos(angle);
    }
  }
  return pe;
}

/**
 * Add the positional encoding to an embedding matrix in place-conscious
 * fashion (returns a new matrix). Shapes must match exactly.
 */
export function addPositional(embeddings: Matrix, pe: Matrix): Matrix {
  if (embeddings.rows !== pe.rows || embeddings.cols !== pe.cols) {
    throw new Error(
      `addPositional: shape mismatch ${embeddings.rows}x${embeddings.cols} vs ${pe.rows}x${pe.cols}`,
    );
  }
  const out = zeros(embeddings.rows, embeddings.cols);
  for (let i = 0; i < embeddings.data.length; i++) {
    out.data[i] = embeddings.data[i] + pe.data[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Token Embedding
// ---------------------------------------------------------------------------

export interface EmbeddingTable {
  /** Shape: (vocabSize, dModel). Row `k` is the embedding for token id `k`. */
  weights: Matrix;
  vocabSize: number;
  dModel: number;
}

export function initEmbeddingTable(vocabSize: number, dModel: number, seed = 4242): EmbeddingTable {
  return {
    weights: xavier(vocabSize, dModel, seed),
    vocabSize,
    dModel,
  };
}

/**
 * Look up a sequence of token ids and return their d_model-dimensional
 * embeddings, scaled by sqrt(d_model) per the paper.
 *
 *   Input:  tokenIds length = seq_len
 *   Output: shape (seq_len, d_model)
 */
export function embedTokens(table: EmbeddingTable, tokenIds: number[]): Matrix {
  const seqLen = tokenIds.length;
  const out = zeros(seqLen, table.dModel);
  const scaleFactor = Math.sqrt(table.dModel);

  for (let i = 0; i < seqLen; i++) {
    const id = tokenIds[i];
    if (id < 0 || id >= table.vocabSize || !Number.isInteger(id)) {
      throw new Error(`embedTokens: token id ${id} out of range [0, ${table.vocabSize})`);
    }
    for (let j = 0; j < table.dModel; j++) {
      out.data[i * table.dModel + j] = table.weights.data[id * table.dModel + j] * scaleFactor;
    }
  }
  return out;
}
