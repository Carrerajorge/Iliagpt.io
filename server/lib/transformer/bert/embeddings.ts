/**
 * BERT input embeddings (Figure 2 of the paper).
 *
 *   input = LayerNorm( token + segment + position ) + Dropout
 *
 * Three LEARNABLE lookup tables — critically, position embeddings are
 * learned (not sinusoidal like Vaswani et al.):
 *
 *   token    : (vocabSize,             hiddenSize)   — WordPiece embeddings
 *   segment  : (typeVocabSize = 2,     hiddenSize)   — sentence A vs B
 *   position : (maxPositionEmbeddings, hiddenSize)   — learned absolute position
 *
 * The sum is then normalized by a dedicated LayerNorm (distinct from
 * every other LayerNorm in the encoder stack) and passed through residual
 * dropout before feeding the encoder.
 */

import {
  type Matrix,
  zeros,
  xavier,
  layerNorm,
  add,
} from "../matrix";
import { dropout, identityDropout, type DropoutConfig } from "../dropout";
import type { BertConfig, BertEmbeddingWeights } from "./types";

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Build a fresh, seeded set of embedding weights for a given BERT config.
 * The three tables use distinct seeds so the forward pass is deterministic
 * per-seed but the three embeddings are independent random draws.
 *
 * LayerNorm γ is initialized to 1 and β to 0 (the Ba et al. 2016 identity
 * init — same convention the encoder uses).
 */
export function initBertEmbeddingWeights(
  config: BertConfig,
  seed = 7,
): BertEmbeddingWeights {
  const { vocabSize, typeVocabSize, maxPositionEmbeddings, hiddenSize } = config;
  return {
    tokenEmbeddings: xavier(vocabSize, hiddenSize, seed + 1),
    segmentEmbeddings: xavier(typeVocabSize, hiddenSize, seed + 2),
    positionEmbeddings: xavier(maxPositionEmbeddings, hiddenSize, seed + 3),
    layerNormGamma: fillOnes(1, hiddenSize),
    layerNormBeta: zeros(1, hiddenSize),
  };
}

function fillOnes(rows: number, cols: number): Matrix {
  const m = zeros(rows, cols);
  m.data.fill(1);
  return m;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Look up each id in `ids` against the lookup table and return the
 * stacked embedding vectors, shape (len(ids), hiddenSize).
 *
 * This is a simple row-gather — the paper's embedding layer has no
 * √d_model scaling (that was a Vaswani-only trick).
 */
function embedLookup(ids: number[], table: Matrix, label: string): Matrix {
  const out = zeros(ids.length, table.cols);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!Number.isInteger(id) || id < 0 || id >= table.rows) {
      throw new Error(
        `${label}: id ${id} at position ${i} out of range [0, ${table.rows})`,
      );
    }
    for (let j = 0; j < table.cols; j++) {
      out.data[i * table.cols + j] = table.data[id * table.cols + j];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Forward pass
// ---------------------------------------------------------------------------

/**
 * Build the BERT input representation for a single example.
 *
 * Inputs:
 *   tokenIds    — shape (seqLen,). WordPiece ids including [CLS] / [SEP] / [PAD].
 *   segmentIds  — shape (seqLen,). 0 for sentence A, 1 for sentence B.
 *                 If omitted, defaults to all zeros (single-sentence input).
 *   positionIds — shape (seqLen,). Absolute position ids. Defaults to 0..seqLen-1.
 *
 * Output:
 *   embeddings — shape (seqLen, hiddenSize), ready to feed into `runEncoder`.
 *
 * During training the caller passes a `DropoutConfig` so dropout is
 * applied to the sum, matching the paper. During inference / feature
 * extraction the config is undefined and the function is pure.
 */
export function bertEmbeddingForward(
  weights: BertEmbeddingWeights,
  tokenIds: number[],
  segmentIds?: number[],
  positionIds?: number[],
  dropoutConfig?: DropoutConfig,
): Matrix {
  const seqLen = tokenIds.length;
  if (seqLen === 0) {
    throw new Error("bertEmbeddingForward: tokenIds must be non-empty");
  }

  // Default segment ids = all 0 (single sentence input)
  const segIds = segmentIds ?? new Array<number>(seqLen).fill(0);
  if (segIds.length !== seqLen) {
    throw new Error(
      `bertEmbeddingForward: segmentIds length ${segIds.length} != tokenIds length ${seqLen}`,
    );
  }

  // Default position ids = 0, 1, 2, ..., seqLen-1
  const maxPos = weights.positionEmbeddings.rows;
  const posIds = positionIds ?? Array.from({ length: seqLen }, (_, i) => i);
  if (posIds.length !== seqLen) {
    throw new Error(
      `bertEmbeddingForward: positionIds length ${posIds.length} != tokenIds length ${seqLen}`,
    );
  }
  for (const p of posIds) {
    if (p < 0 || p >= maxPos) {
      throw new Error(
        `bertEmbeddingForward: position id ${p} exceeds maxPositionEmbeddings ${maxPos}`,
      );
    }
  }

  const tok = embedLookup(tokenIds, weights.tokenEmbeddings, "tokenEmbeddings");
  const seg = embedLookup(segIds, weights.segmentEmbeddings, "segmentEmbeddings");
  const pos = embedLookup(posIds, weights.positionEmbeddings, "positionEmbeddings");

  // Sum all three
  const summed = add(add(tok, seg), pos);

  // LayerNorm(sum) — dedicated γ/β that live on BertEmbeddingWeights, not
  // shared with any encoder layer's LayerNorm
  const normalized = layerNorm(
    summed,
    weights.layerNormGamma.data,
    weights.layerNormBeta.data,
  );

  // Dropout on the (LN'd) sum — matches §5.4 of the Vaswani paper
  // ("dropout to the sums of the embeddings") as applied by BERT's
  // implementation.
  return dropoutConfig ? dropout(normalized, dropoutConfig) : identityDropout(normalized);
}

// ---------------------------------------------------------------------------
// Attention mask utility
// ---------------------------------------------------------------------------

/**
 * Build a BERT-style attention mask from an array of token ids. Any
 * position whose token equals `padId` is marked as not-attendable; all
 * others remain attendable. The output is a square boolean mask suitable
 * for the encoder's `srcPaddingMask` argument:
 *
 *   mask[i][j] = true  if row i AND column j are non-pad
 *   mask[i][j] = false if either is pad
 *
 * (Our attention primitive expects `true` = attend, `false` = masked.)
 */
export function bertPaddingMask(tokenIds: number[], padId: number): boolean[][] {
  const n = tokenIds.length;
  const nonPad = tokenIds.map((t) => t !== padId);
  const mask: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    const row: boolean[] = new Array(n);
    for (let j = 0; j < n; j++) {
      row[j] = nonPad[i] && nonPad[j];
    }
    mask.push(row);
  }
  return mask;
}
