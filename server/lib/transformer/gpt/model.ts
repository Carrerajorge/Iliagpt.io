/**
 * GPT-3 decoder-only model forward pass (Brown et al. 2020, §2.1).
 *
 * Architecture (different from our existing Vaswani decoder):
 *
 *   input = token_embed + position_embed
 *   for each of L layers:
 *       x = LayerNorm(x + Dropout(MaskedSelfAttention(x)))   ← one sublayer
 *       x = LayerNorm(x + Dropout(FFN_GELU(x)))              ← one sublayer
 *   x = FinalLayerNorm(x)
 *   logits = x · tokenEmbeddings^T + outputBias
 *
 * The key structural difference vs. our Vaswani `decoderLayer` is the
 * absence of a cross-attention sublayer — there is no encoder to cross
 * to. So each GPT layer has exactly 2 sublayers (vs. 3 in Vaswani's
 * decoder), and we reuse our existing `encoderLayer` (which has this
 * exact shape) with a causal mask.
 *
 * Alternation (§2.1):
 *
 *   "we use alternating dense and locally banded sparse attention
 *    patterns in the layers of the transformer"
 *
 * Even-indexed layers use a full causal mask (dense). Odd-indexed
 * layers use a Sparse Transformer-style strided + local-band mask
 * (sparse). Callers can override per-layer via `config.attentionPatterns`.
 */

import {
  type Matrix,
  zeros,
  ones,
  truncatedNormal,
  matmul,
  transpose,
  addBias,
  layerNorm,
  sliceRows,
} from "../matrix";
import {
  initEncoderLayerWeights,
  encoderLayer,
  type EncoderLayerWeights,
} from "../transformer";
import { baseConfig as attentionConfig, type MultiHeadConfig } from "../attention";
import type { DropoutConfig } from "../dropout";
import type { AttentionPattern, GptConfig, GptWeights } from "./types";
import { fullCausalMask, stridedSparseMask } from "./sparseMask";

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Build a GPT-3 multi-head attention config from a GptConfig. Shares
 * the underlying `MultiHeadConfig` shape with the Vaswani encoder so
 * we can reuse `initEncoderLayerWeights` / `encoderLayer` verbatim.
 */
export function gptAttentionConfig(config: GptConfig): MultiHeadConfig {
  return attentionConfig(config.hiddenSize, config.numHeads);
}

/**
 * Initialize the decoder layer stack for a GPT-3 config. Each layer
 * gets a distinct seed offset so the weights are independent.
 *
 * After the base init, the GPT-2 modified residual init (§2.1 of
 * Brown et al. 2020, cited from the GPT-2 paper) is applied: the
 * output projections of every residual sub-layer (WO in multi-head,
 * W2 in FFN) are scaled by 1/√(2·numLayers) to counteract the
 * accumulation of variance along the residual path. Without this
 * scaling, very deep stacks diverge during training.
 */
export function initGptLayers(config: GptConfig, seed = 1000): EncoderLayerWeights[] {
  const attn = gptAttentionConfig(config);
  const layers: EncoderLayerWeights[] = [];
  for (let i = 0; i < config.numLayers; i++) {
    layers.push(
      initEncoderLayerWeights(attn, config.intermediateSize, seed + i * 100),
    );
  }
  applyGpt2ResidualScaling(layers, config.numLayers);
  return layers;
}

/**
 * Apply the GPT-2 modified residual init (§2.1 Brown 2020, referenced
 * from the GPT-2 technical report):
 *
 *   "A modified initialization which accounts for the accumulation on
 *    the residual path with model depth is used. We scale the weights
 *    of residual layers at initialization by a factor of 1/√N where
 *    N is the number of residual layers."
 *
 * The "residual layers" are the output projections of each residual
 * sub-layer — concretely, W^O in the multi-head attention and W_2 in
 * the position-wise FFN. Each encoder block has TWO residual
 * sub-layers, so the total scaling factor is `1/√(2·numLayers)`.
 *
 * This mutates the provided layer weights in place.
 */
export function applyGpt2ResidualScaling(
  layers: EncoderLayerWeights[],
  numLayers: number,
): void {
  if (numLayers < 1) {
    throw new Error(`applyGpt2ResidualScaling: numLayers ${numLayers} must be ≥ 1`);
  }
  const scale = 1 / Math.sqrt(2 * numLayers);
  for (const layer of layers) {
    // Scale W^O (multi-head output projection)
    const WO = layer.selfAttn.WO;
    for (let i = 0; i < WO.data.length; i++) WO.data[i] *= scale;
    // Scale W_2 (FFN output projection)
    const W2 = layer.ffn.W2;
    for (let i = 0; i < W2.data.length; i++) W2.data[i] *= scale;
  }
}

/**
 * Initialize a complete GPT-3 model from a config. Every component
 * gets a distinct seed derived from the caller's master seed so the
 * forward passes are reproducible.
 *
 * All weights use TruncatedNormal(σ = config.initStdDev = 0.02) —
 * same as BERT, same as the reference GPT-3 implementation.
 */
export function initGptWeights(config: GptConfig, masterSeed = 42): GptWeights {
  return {
    config,
    tokenEmbeddings: truncatedNormal(
      config.vocabSize,
      config.hiddenSize,
      config.initStdDev,
      masterSeed + 100,
    ),
    positionEmbeddings: truncatedNormal(
      config.contextWindow,
      config.hiddenSize,
      config.initStdDev,
      masterSeed + 200,
    ),
    layers: initGptLayers(config, masterSeed + 500),
    finalLayerNormGamma: ones(1, config.hiddenSize),
    finalLayerNormBeta: zeros(1, config.hiddenSize),
    outputBias: zeros(1, config.vocabSize),
  };
}

// ---------------------------------------------------------------------------
// Input embeddings
// ---------------------------------------------------------------------------

/**
 * Build the GPT input representation: `tokenEmbed + positionEmbed`,
 * with absolute positions 0..seqLen-1. No segment embeddings (GPT
 * has no sentence-pair concept) and no LayerNorm on the sum (that's
 * a BERT convention, not a GPT one; GPT applies LayerNorm inside
 * each layer's sub-layer output instead).
 */
export function gptInputEmbeddings(
  weights: GptWeights,
  tokenIds: number[],
): Matrix {
  const seqLen = tokenIds.length;
  const H = weights.config.hiddenSize;
  if (seqLen === 0) throw new Error("gptInputEmbeddings: empty tokenIds");
  if (seqLen > weights.config.contextWindow) {
    throw new Error(
      `gptInputEmbeddings: seqLen ${seqLen} > contextWindow ${weights.config.contextWindow}`,
    );
  }

  const out = zeros(seqLen, H);
  for (let i = 0; i < seqLen; i++) {
    const id = tokenIds[i];
    if (!Number.isInteger(id) || id < 0 || id >= weights.config.vocabSize) {
      throw new Error(
        `gptInputEmbeddings: token id ${id} at position ${i} out of vocab [0, ${weights.config.vocabSize})`,
      );
    }
    // Token lookup
    for (let j = 0; j < H; j++) {
      out.data[i * H + j] =
        weights.tokenEmbeddings.data[id * H + j] +
        weights.positionEmbeddings.data[i * H + j];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

/**
 * Resolve a layer's attention pattern to a concrete boolean mask of
 * shape (seqLen, seqLen).
 *
 * The sparse mask uses bandSize = ⌈√seqLen⌉ and stride = ⌈√seqLen⌉
 * which is the reference recipe from the Sparse Transformer paper
 * (Child et al. 2019). The total number of allowed edges is then
 * O(n · √n) instead of the dense O(n²).
 */
function resolveMaskForLayer(
  seqLen: number,
  pattern: AttentionPattern,
): boolean[][] {
  if (pattern === "dense") return fullCausalMask(seqLen);
  // Sparse: band ≈ stride ≈ √n
  const rootN = Math.max(1, Math.ceil(Math.sqrt(seqLen)));
  return stridedSparseMask(seqLen, rootN, rootN);
}

// ---------------------------------------------------------------------------
// Full stack forward pass
// ---------------------------------------------------------------------------

/**
 * Run the GPT-3 decoder stack. Applies token+position embeddings,
 * threads the alternating dense/sparse attention masks through each
 * layer, and returns the final hidden states.
 *
 * The encoder layer implementation from the Vaswani module is reused
 * with `ffnActivation="gelu"` (GPT-3 convention, §2.1 via the GPT-2
 * paper it cites). A fresh causal-or-sparse mask is computed per
 * layer based on the alternation pattern.
 *
 * Returns the final hidden states BEFORE the final LayerNorm. Callers
 * that want logits should call `gptLogits` below.
 */
export function runGptStack(
  weights: GptWeights,
  tokenIds: number[],
  dropoutConfig?: DropoutConfig,
): Matrix {
  const config = weights.config;
  const seqLen = tokenIds.length;
  const attn = gptAttentionConfig(config);

  if (config.attentionPatterns.length !== config.numLayers) {
    throw new Error(
      `runGptStack: attentionPatterns length ${config.attentionPatterns.length} != numLayers ${config.numLayers}`,
    );
  }

  // 1. Input embeddings (token + position)
  let h = gptInputEmbeddings(weights, tokenIds);

  // 2. Run every layer with its resolved mask, GELU FFN, and
  //    pre-normalization. Pre-norm is the GPT-2/GPT-3 convention
  //    described in §2.1 of Brown et al. 2020: LayerNorm is applied
  //    at the INPUT of each sub-block, not after it like Vaswani.
  //    This is what makes very deep transformers (L=96 for GPT-3 175B)
  //    trainable without warmup tricks.
  for (let i = 0; i < config.numLayers; i++) {
    const mask = resolveMaskForLayer(seqLen, config.attentionPatterns[i]);
    const layerDropout = dropoutConfig
      ? { ...dropoutConfig, seed: (dropoutConfig.seed ?? 0) + i * 1000 }
      : undefined;
    h = encoderLayer(
      h,
      weights.layers[i],
      attn,
      mask,
      layerDropout,
      "gelu",
      /* preNorm */ true,
    );
  }
  return h;
}

/**
 * Apply the final LayerNorm + tied output projection + bias to produce
 * vocab logits of shape (seqLen, vocabSize).
 */
export function gptLogits(
  sequenceOutput: Matrix,
  weights: GptWeights,
): Matrix {
  // Final LayerNorm
  const normalized = layerNorm(
    sequenceOutput,
    weights.finalLayerNormGamma.data,
    weights.finalLayerNormBeta.data,
    weights.config.layerNormEps,
  );
  // Tied projection: sequenceOutput · tokenEmbeddings^T + outputBias
  const tokenEmbT = transpose(weights.tokenEmbeddings);
  const logits = matmul(normalized, tokenEmbT);
  return addBias(logits, weights.outputBias);
}

/**
 * Extract the logits for the LAST position of the sequence only. This
 * is the workhorse of autoregressive generation: the caller wants the
 * next-token distribution given the current prefix.
 */
export function gptNextTokenLogits(
  weights: GptWeights,
  tokenIds: number[],
  dropoutConfig?: DropoutConfig,
): Float64Array {
  const h = runGptStack(weights, tokenIds, dropoutConfig);
  const logits = gptLogits(h, weights);
  const last = logits.rows - 1;
  const vocab = logits.cols;
  const out = new Float64Array(vocab);
  for (let j = 0; j < vocab; j++) out[j] = logits.data[last * vocab + j];
  return out;
}

/**
 * Convenience wrapper: run the full stack + final LayerNorm +
 * projection and return the full (seqLen, vocabSize) logits matrix.
 */
export function gptForward(
  weights: GptWeights,
  tokenIds: number[],
  dropoutConfig?: DropoutConfig,
): { sequenceOutput: Matrix; logits: Matrix } {
  const sequenceOutput = runGptStack(weights, tokenIds, dropoutConfig);
  const logits = gptLogits(sequenceOutput, weights);
  return { sequenceOutput, logits };
}

// Suppress unused import warning (sliceRows is re-exported for callers
// that want to probe specific positions).
void sliceRows;
