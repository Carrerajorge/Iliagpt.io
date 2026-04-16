/**
 * Encoder/Decoder layers and the full Transformer stack.
 *
 * Section 3.1 of the paper:
 *
 *   Encoder layer:
 *     1. multi-head self-attention
 *     2. residual + layer norm  ── LayerNorm(x + Dropout(Sublayer(x)))
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
 *
 * Paper-faithful details wired here:
 *
 *   • Residual dropout (section 5.4):
 *       "We apply dropout to the output of each sub-layer, before it is
 *        added to the sub-layer input and normalized."
 *     Each sub-layer output goes through `dropout()` before the residual
 *     `add()`. Dropout on the sums of embeddings + positional encodings is
 *     exposed separately via `embeddingDropout()` so callers running
 *     inference can skip it cheaply.
 *
 *   • Learnable LayerNorm parameters (Ba et al. 2016, referenced by the
 *     paper as its normalization of choice):
 *       LN(x) = γ · (x - μ) / √(σ² + ε) + β
 *     Each `Add & Norm` in the stack owns its own γ and β, initialized to
 *     1 and 0 respectively. They are learnable parameters of the model.
 */

import {
  type Matrix,
  add,
  layerNorm,
  causalMask,
  ones,
  zeros,
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
  type FFNActivation,
  feedForward,
  initFFNWeights,
} from "./feedForward";
import { type DropoutConfig, dropout, identityDropout } from "./dropout";

// ---------------------------------------------------------------------------
// LayerNorm parameters (learnable γ, β per feature)
// ---------------------------------------------------------------------------

/**
 * One `Add & Norm` layer's learnable parameters. γ (gain) is initialized
 * to 1, β (bias) to 0 — the identity transform, so at step 0 the model
 * behaves exactly like a γ=1, β=0 fixed normalizer.
 *
 * Stored as `Matrix` (shape 1 × d_model) so the training loop's gradient
 * collector can treat them uniformly with every other parameter tensor.
 */
export interface LayerNormParams {
  /** γ ∈ R^(1 × d_model) — per-feature scale, initialized to 1. */
  gamma: Matrix;
  /** β ∈ R^(1 × d_model) — per-feature shift, initialized to 0. */
  beta: Matrix;
}

function initLayerNormParams(dModel: number): LayerNormParams {
  return { gamma: ones(1, dModel), beta: zeros(1, dModel) };
}

/**
 * Apply LayerNorm with the learnable parameters stored as Matrix rows.
 * Wraps the primitive `layerNorm()` which takes raw Float64Arrays.
 */
function applyLearnableLayerNorm(x: Matrix, params: LayerNormParams): Matrix {
  return layerNorm(x, params.gamma.data, params.beta.data);
}

// ---------------------------------------------------------------------------
// Encoder layer
// ---------------------------------------------------------------------------

export interface EncoderLayerWeights {
  /** Self-attention weights. */
  selfAttn: MultiHeadWeights;
  /** Feed-forward weights. */
  ffn: FFNWeights;
  /** LayerNorm params for `Add & Norm` after self-attention. */
  norm1: LayerNormParams;
  /** LayerNorm params for `Add & Norm` after the FFN. */
  norm2: LayerNormParams;
}

export function initEncoderLayerWeights(
  config: MultiHeadConfig,
  dFF: number,
  seed = 100,
): EncoderLayerWeights {
  return {
    selfAttn: initMultiHeadWeights(config, seed),
    ffn: initFFNWeights(config.dModel, dFF, seed + 500),
    norm1: initLayerNormParams(config.dModel),
    norm2: initLayerNormParams(config.dModel),
  };
}

/**
 * Apply one encoder layer.
 *
 * Two conventions are supported via the `preNorm` flag:
 *
 *   Post-norm (Vaswani et al. 2017, default):
 *       x → LayerNorm(x + Dropout(SelfAttention(x)); γ1, β1)
 *         → LayerNorm(_ + Dropout(FFN(_));            γ2, β2)
 *
 *   Pre-norm (GPT-2 / GPT-3, Brown et al. 2020 §2.1):
 *       x → x + Dropout(SelfAttention(LayerNorm(x; γ1, β1)))
 *         → _ + Dropout(FFN(LayerNorm(_; γ2, β2)))
 *
 * The paper of GPT-2 explains the switch: "Layer normalization was
 * moved to the input of each sub-block, similar to a pre-activation
 * residual network". Pre-norm is what makes very deep transformers
 * (GPT-3 has L=96) trainable without warmup tricks.
 *
 * Dropout is applied to the output of each sub-layer BEFORE the
 * residual in both conventions — that matches the paper in both
 * cases.
 *
 * @param preNorm  false = Vaswani/BERT post-norm (default, backward
 *                 compatible), true = GPT-2/GPT-3 pre-norm.
 */
export function encoderLayer(
  x: Matrix,
  weights: EncoderLayerWeights,
  config: MultiHeadConfig,
  srcPaddingMask?: boolean[][],
  dropoutConfig?: DropoutConfig,
  ffnActivation: FFNActivation = "relu",
  preNorm = false,
): Matrix {
  const drop = (m: Matrix, salt: number): Matrix =>
    dropoutConfig
      ? dropout(m, { ...dropoutConfig, seed: (dropoutConfig.seed ?? 0) + salt })
      : identityDropout(m);

  if (preNorm) {
    // ── GPT-2 / GPT-3 pre-norm ──────────────────────────────────────
    // Sublayer 1: x + Dropout(SelfAttention(LayerNorm(x)))
    const normed1 = applyLearnableLayerNorm(x, weights.norm1);
    const attn = multiHeadAttention(
      normed1,
      normed1,
      normed1,
      config,
      weights.selfAttn,
      srcPaddingMask,
    );
    const afterAttn = add(x, drop(attn.output, 1));
    // Sublayer 2: _ + Dropout(FFN(LayerNorm(_)))
    const normed2 = applyLearnableLayerNorm(afterAttn, weights.norm2);
    const ffnOut = feedForward(normed2, weights.ffn, ffnActivation);
    return add(afterAttn, drop(ffnOut, 2));
  }

  // ── Vaswani / BERT post-norm (default, unchanged) ──────────────────
  // 1. Multi-head self-attention (Q = K = V = x)
  const attn = multiHeadAttention(x, x, x, config, weights.selfAttn, srcPaddingMask);
  // 2. Residual + LayerNorm (Add & Norm #1)
  const afterAttn = applyLearnableLayerNorm(add(x, drop(attn.output, 1)), weights.norm1);
  // 3. Position-wise feed-forward (ReLU for Vaswani, GELU for BERT)
  const ffnOut = feedForward(afterAttn, weights.ffn, ffnActivation);
  // 4. Residual + LayerNorm (Add & Norm #2)
  return applyLearnableLayerNorm(add(afterAttn, drop(ffnOut, 2)), weights.norm2);
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
  /** LayerNorm params for `Add & Norm` after the masked self-attention. */
  norm1: LayerNormParams;
  /** LayerNorm params for `Add & Norm` after the cross-attention. */
  norm2: LayerNormParams;
  /** LayerNorm params for `Add & Norm` after the FFN. */
  norm3: LayerNormParams;
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
    norm1: initLayerNormParams(config.dModel),
    norm2: initLayerNormParams(config.dModel),
    norm3: initLayerNormParams(config.dModel),
  };
}

/**
 * Apply one decoder layer.
 *
 *   x → LayerNorm(x + Dropout(MaskedSelfAttention(x, x, x, causal_mask)); γ1, β1)
 *     → LayerNorm(_ + Dropout(CrossAttention(_, encOut, encOut));          γ2, β2)
 *     → LayerNorm(_ + Dropout(FFN(_));                                     γ3, β3)
 *
 * `encoderOutput` is the full encoder output (n_src, d_model). The causal
 * mask is built from the decoder input length. Dropout and learnable
 * LayerNorm params match section 5.4 + Ba et al. 2016.
 */
export function decoderLayer(
  x: Matrix,
  encoderOutput: Matrix,
  weights: DecoderLayerWeights,
  config: MultiHeadConfig,
  srcPaddingMask?: boolean[][],
  dropoutConfig?: DropoutConfig,
): Matrix {
  const drop = (m: Matrix, salt: number): Matrix =>
    dropoutConfig
      ? dropout(m, { ...dropoutConfig, seed: (dropoutConfig.seed ?? 0) + salt })
      : identityDropout(m);

  // 1. Masked self-attention (prevents each position from attending to
  //    subsequent positions — section 3.2.3)
  const selfMask = causalMask(x.rows);
  const selfAttn = multiHeadAttention(x, x, x, config, weights.maskedSelfAttn, selfMask);
  const afterSelf = applyLearnableLayerNorm(add(x, drop(selfAttn.output, 1)), weights.norm1);

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
  const afterCross = applyLearnableLayerNorm(add(afterSelf, drop(cross.output, 2)), weights.norm2);

  // 3. Position-wise feed-forward
  const ffnOut = feedForward(afterCross, weights.ffn);
  return applyLearnableLayerNorm(add(afterCross, drop(ffnOut, 3)), weights.norm3);
}

/**
 * Apply residual dropout to the sum of embeddings + positional encodings
 * (section 5.4, second half: "In addition, we apply dropout to the sums
 * of the embeddings and the positional encodings in both the encoder and
 * decoder stacks.").
 *
 * This is the second of the two places the paper specifies dropout. The
 * first (sub-layer output dropout) is wired inside `encoderLayer` /
 * `decoderLayer`. Call this helper after `addPositional(...)` and before
 * handing the tensor to `runEncoder` / `runDecoder`.
 */
export function embeddingDropout(
  embeddingPlusPE: Matrix,
  dropoutConfig?: DropoutConfig,
): Matrix {
  if (!dropoutConfig) return embeddingPlusPE;
  return dropout(embeddingPlusPE, dropoutConfig);
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
 *
 * Per-layer dropout seeds are derived from the caller-supplied seed so
 * repeated calls with the same config are reproducible.
 */
export function runEncoder(
  x: Matrix,
  weights: EncoderLayerWeights[],
  config: MultiHeadConfig,
  srcPaddingMask?: boolean[][],
  dropoutConfig?: DropoutConfig,
  ffnActivation: FFNActivation = "relu",
  preNorm = false,
): Matrix {
  let h = x;
  for (let i = 0; i < weights.length; i++) {
    const layerDropout = dropoutConfig
      ? { ...dropoutConfig, seed: (dropoutConfig.seed ?? 0) + i * 1000 }
      : undefined;
    h = encoderLayer(
      h,
      weights[i],
      config,
      srcPaddingMask,
      layerDropout,
      ffnActivation,
      preNorm,
    );
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
  dropoutConfig?: DropoutConfig,
): Matrix {
  let h = tgt;
  for (let i = 0; i < weights.length; i++) {
    const layerDropout = dropoutConfig
      ? { ...dropoutConfig, seed: (dropoutConfig.seed ?? 0) + 10_000 + i * 1000 }
      : undefined;
    h = decoderLayer(h, encoderOutput, weights[i], config, srcPaddingMask, layerDropout);
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
  dropoutConfig?: DropoutConfig,
): TransformerForwardResult {
  const encoderOutput = runEncoder(
    src,
    weights.encoder,
    config.attention,
    srcPaddingMask,
    dropoutConfig,
  );
  const decoderOutput = runDecoder(
    tgt,
    encoderOutput,
    weights.decoder,
    config.attention,
    srcPaddingMask,
    dropoutConfig,
  );
  return { encoderOutput, decoderOutput };
}
