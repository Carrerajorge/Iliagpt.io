/**
 * Encoder/Decoder layers and the full Transformer stack.
 *
 * Section 3.1 of the paper:
 *
 *   Encoder layer:
 *     1. multi-head self-attention
 *     2. residual + layer norm
 *     3. position-wise FFN
 *     4. residual + layer norm
 *
 *   Decoder layer:
 *     1. masked multi-head self-attention (causal mask)
 *     2. residual + layer norm
 *     3. encoder-decoder cross-attention
 *     4. residual + layer norm
 *     5. position-wise FFN
 *     6. residual + layer norm
 *
 * Full stack: N=6 layers each side for the paper's base model.
 */

import {
  type Matrix,
  add,
  layerNorm,
  causalMask,
} from "./matrix";
import {
  type MultiHeadConfig,
  type MultiHeadWeights,
  multiHeadAttention,
  initMultiHeadWeights,
  baseConfig,
} from "./attention";
import {
  type FFNWeights,
  feedForward,
  initFFNWeights,
} from "./feedForward";

// ---------------------------------------------------------------------------
// Encoder layer
// ---------------------------------------------------------------------------

export interface EncoderLayerWeights {
  /** Self-attention weights. */
  selfAttn: MultiHeadWeights;
  /** Feed-forward weights. */
  ffn: FFNWeights;
}

export function initEncoderLayerWeights(
  config: MultiHeadConfig,
  dFF: number,
  seed = 100,
): EncoderLayerWeights {
  return {
    selfAttn: initMultiHeadWeights(config, seed),
    ffn: initFFNWeights(config.dModel, dFF, seed + 500),
  };
}

/**
 * Apply one encoder layer.
 *
 *   x → LayerNorm(x + SelfAttention(x, x, x))
 *     → LayerNorm(_ + FFN(_))
 *
 * The paper's original recipe is "post-norm" (Add & Norm). We match it
 * exactly so any correctness test against the paper's algebra passes.
 */
export function encoderLayer(
  x: Matrix,
  weights: EncoderLayerWeights,
  config: MultiHeadConfig,
  srcPaddingMask?: boolean[][],
): Matrix {
  // 1. Multi-head self-attention (Q = K = V = x)
  const attn = multiHeadAttention(x, x, x, config, weights.selfAttn, srcPaddingMask);
  // 2. Residual + LayerNorm
  const afterAttn = layerNorm(add(x, attn.output));
  // 3. Feed-forward
  const ffnOut = feedForward(afterAttn, weights.ffn);
  // 4. Residual + LayerNorm
  return layerNorm(add(afterAttn, ffnOut));
}

// ---------------------------------------------------------------------------
// Decoder layer
// ---------------------------------------------------------------------------

export interface DecoderLayerWeights {
  /** Masked self-attention over the decoder's own output so far. */
  maskedSelfAttn: MultiHeadWeights;
  /** Cross-attention: queries from decoder, keys/values from encoder. */
  crossAttn: MultiHeadWeights;
  /** Feed-forward. */
  ffn: FFNWeights;
}

export function initDecoderLayerWeights(
  config: MultiHeadConfig,
  dFF: number,
  seed = 200,
): DecoderLayerWeights {
  return {
    maskedSelfAttn: initMultiHeadWeights(config, seed),
    crossAttn: initMultiHeadWeights(config, seed + 250),
    ffn: initFFNWeights(config.dModel, dFF, seed + 500),
  };
}

/**
 * Apply one decoder layer.
 *
 *   x → LayerNorm(x + MaskedSelfAttention(x, x, x, causal_mask))
 *     → LayerNorm(_ + CrossAttention(_, encOut, encOut))
 *     → LayerNorm(_ + FFN(_))
 *
 * `encoderOutput` is the full encoder output (n_src, d_model). The causal
 * mask is built from the decoder input length.
 */
export function decoderLayer(
  x: Matrix,
  encoderOutput: Matrix,
  weights: DecoderLayerWeights,
  config: MultiHeadConfig,
  srcPaddingMask?: boolean[][],
): Matrix {
  // 1. Masked self-attention (prevents each position from attending to
  //    subsequent positions — section 3.2.3)
  const selfMask = causalMask(x.rows);
  const selfAttn = multiHeadAttention(x, x, x, config, weights.maskedSelfAttn, selfMask);
  const afterSelf = layerNorm(add(x, selfAttn.output));

  // 2. Cross-attention: decoder queries encoder keys/values
  const cross = multiHeadAttention(
    afterSelf,
    encoderOutput,
    encoderOutput,
    config,
    weights.crossAttn,
    // The cross mask lets decoder positions see ALL encoder positions
    // (except any padded ones if a srcPaddingMask is supplied).
    srcPaddingMask ? broadcastMask(x.rows, srcPaddingMask[0]) : undefined,
  );
  const afterCross = layerNorm(add(afterSelf, cross.output));

  // 3. Feed-forward
  const ffnOut = feedForward(afterCross, weights.ffn);
  return layerNorm(add(afterCross, ffnOut));
}

/**
 * Broadcast a single row of key-mask flags across all query rows.
 * Used by cross-attention: every decoder position shares the same padding
 * mask over encoder positions.
 */
function broadcastMask(queryRows: number, keyMaskRow: boolean[]): boolean[][] {
  const out: boolean[][] = [];
  for (let i = 0; i < queryRows; i++) out.push(keyMaskRow.slice());
  return out;
}

// ---------------------------------------------------------------------------
// Full stack
// ---------------------------------------------------------------------------

export interface TransformerConfig {
  /** Number of encoder layers (paper: 6). */
  encoderLayers: number;
  /** Number of decoder layers (paper: 6). */
  decoderLayers: number;
  /** Multi-head attention config (d_model, heads, d_k, d_v). */
  attention: MultiHeadConfig;
  /** Feed-forward inner dimension (paper: 2048). */
  dFF: number;
}

export interface TransformerWeights {
  encoder: EncoderLayerWeights[];
  decoder: DecoderLayerWeights[];
}

/** Build a default config matching the paper's base model (d_model=512, h=8, N=6). */
export function baseTransformerConfig(): TransformerConfig {
  return {
    encoderLayers: 6,
    decoderLayers: 6,
    attention: baseConfig(512, 8),
    dFF: 2048,
  };
}

/**
 * Build a smaller config used by tests and the demo page so forward passes
 * finish in milliseconds instead of minutes. Same architecture, just
 * smaller dimensions.
 */
export function tinyTransformerConfig(): TransformerConfig {
  return {
    encoderLayers: 2,
    decoderLayers: 2,
    attention: baseConfig(32, 4), // d_model=32, h=4, d_k=d_v=8
    dFF: 64,
  };
}

/** Initialize a complete transformer stack deterministically. */
export function initTransformerWeights(
  config: TransformerConfig,
  seed = 1000,
): TransformerWeights {
  const encoder: EncoderLayerWeights[] = [];
  for (let i = 0; i < config.encoderLayers; i++) {
    encoder.push(initEncoderLayerWeights(config.attention, config.dFF, seed + i * 10));
  }
  const decoder: DecoderLayerWeights[] = [];
  for (let i = 0; i < config.decoderLayers; i++) {
    decoder.push(initDecoderLayerWeights(config.attention, config.dFF, seed + 5000 + i * 10));
  }
  return { encoder, decoder };
}

/**
 * Run the encoder stack. Input is the src embedding + positional encoding
 * already applied. Output shape matches the input (same seq_len, d_model).
 */
export function runEncoder(
  x: Matrix,
  weights: EncoderLayerWeights[],
  config: MultiHeadConfig,
  srcPaddingMask?: boolean[][],
): Matrix {
  let h = x;
  for (const layer of weights) {
    h = encoderLayer(h, layer, config, srcPaddingMask);
  }
  return h;
}

/**
 * Run the decoder stack. `tgt` is the decoder input (tgt embedding +
 * positional encoding). `encoderOutput` is the last layer of the encoder.
 */
export function runDecoder(
  tgt: Matrix,
  encoderOutput: Matrix,
  weights: DecoderLayerWeights[],
  config: MultiHeadConfig,
  srcPaddingMask?: boolean[][],
): Matrix {
  let h = tgt;
  for (const layer of weights) {
    h = decoderLayer(h, encoderOutput, layer, config, srcPaddingMask);
  }
  return h;
}

/**
 * One-shot forward pass of the full encoder-decoder stack. Used by tests
 * and the REST endpoint. Returns both encoder output (useful for
 * visualization) and decoder output.
 */
export interface TransformerForwardResult {
  encoderOutput: Matrix;
  decoderOutput: Matrix;
}

export function transformerForward(
  src: Matrix,
  tgt: Matrix,
  weights: TransformerWeights,
  config: TransformerConfig,
  srcPaddingMask?: boolean[][],
): TransformerForwardResult {
  const encoderOutput = runEncoder(src, weights.encoder, config.attention, srcPaddingMask);
  const decoderOutput = runDecoder(tgt, encoderOutput, weights.decoder, config.attention, srcPaddingMask);
  return { encoderOutput, decoderOutput };
}
