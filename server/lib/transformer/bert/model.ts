/**
 * Full BERT forward pass — embeddings → encoder (bidirectional, GELU FFN)
 * → pooler (tanh over [CLS]).
 *
 * The encoder stack is the SAME `runEncoder()` from the Vaswani module,
 * called with `ffnActivation="gelu"` to match BERT's Appendix A.2.
 * There is no causal mask: self-attention is fully bidirectional, which
 * is the entire point of the paper (§1 and Figure 3).
 */

import {
  type Matrix,
  zeros,
  ones,
  truncatedNormal,
  matmul,
  addBias,
  sliceRows,
} from "../matrix";
import {
  initEncoderLayerWeights,
  runEncoder,
  encoderLayer,
  type EncoderLayerWeights,
  type LayerNormParams,
} from "../transformer";
import { baseConfig as attentionConfig, type MultiHeadConfig } from "../attention";
import type { DropoutConfig } from "../dropout";
import type {
  BertConfig,
  BertWeights,
  BertPoolerWeights,
  BertForwardResult,
  BertMLMHeadWeights,
  BertNSPHeadWeights,
} from "./types";
import { initBertEmbeddingWeights, bertEmbeddingForward, bertPaddingMask } from "./embeddings";
import { BERT_SPECIAL_TOKENS } from "./types";

// ---------------------------------------------------------------------------
// Weight initialization
// ---------------------------------------------------------------------------

/**
 * Build a BERT multi-head attention config from a BertConfig. Shares the
 * underlying `MultiHeadConfig` shape with the Vaswani encoder so we can
 * reuse `initEncoderLayerWeights` / `runEncoder` verbatim.
 */
export function bertAttentionConfig(config: BertConfig): MultiHeadConfig {
  return attentionConfig(config.hiddenSize, config.numHeads);
}

/**
 * Initialize the encoder stack for a BERT config. `L` layers, each with
 * its own seed offset so every layer's weights are independent.
 */
export function initBertEncoderLayers(
  config: BertConfig,
  seed = 1000,
): EncoderLayerWeights[] {
  const attn = bertAttentionConfig(config);
  const layers: EncoderLayerWeights[] = [];
  for (let i = 0; i < config.numLayers; i++) {
    layers.push(initEncoderLayerWeights(attn, config.intermediateSize, seed + i * 100));
  }
  return layers;
}

/**
 * Initialize the pooler dense layer (W, b). γ/β are not needed — the
 * pooler is just Dense → tanh with no LayerNorm.
 *
 * Uses truncatedNormal(stddev=config.initStdDev) to match the paper's
 * exact init (§A.2 + reference impl).
 */
export function initBertPooler(config: BertConfig, seed = 9000): BertPoolerWeights {
  return {
    weight: truncatedNormal(config.hiddenSize, config.hiddenSize, config.initStdDev, seed),
    bias: zeros(1, config.hiddenSize),
  };
}

/**
 * Initialize the MLM head. `transformWeight` and `transformBias` do the
 * Dense transform; γ and β drive the post-transform LayerNorm; the
 * output projection is TIED to the token embedding table so we only
 * need to store the per-vocabulary `outputBias`.
 */
export function initBertMLMHead(config: BertConfig, seed = 12000): BertMLMHeadWeights {
  const H = config.hiddenSize;
  return {
    transformWeight: truncatedNormal(H, H, config.initStdDev, seed),
    transformBias: zeros(1, H),
    layerNormGamma: ones(1, H),
    layerNormBeta: zeros(1, H),
    outputBias: zeros(1, config.vocabSize),
  };
}

/**
 * Initialize the Next-Sentence-Prediction head (binary classifier over
 * the pooled [CLS] representation).
 */
export function initBertNSPHead(config: BertConfig, seed = 15000): BertNSPHeadWeights {
  return {
    weight: truncatedNormal(config.hiddenSize, 2, config.initStdDev, seed),
    bias: zeros(1, 2),
  };
}

/**
 * Initialize a complete BERT model from a config. Every component gets
 * a distinct seed derived from the caller's master seed so forward
 * passes are reproducible.
 */
export function initBertWeights(config: BertConfig, masterSeed = 42): BertWeights {
  return {
    config,
    embeddings: initBertEmbeddingWeights(config, masterSeed + 100),
    encoder: initBertEncoderLayers(config, masterSeed + 500),
    pooler: initBertPooler(config, masterSeed + 9000),
    mlmHead: initBertMLMHead(config, masterSeed + 12000),
    nspHead: initBertNSPHead(config, masterSeed + 15000),
  };
}

// ---------------------------------------------------------------------------
// Pooler
// ---------------------------------------------------------------------------

/**
 * Apply the BERT pooler to a sequence output:
 *
 *   pooled = tanh( dense(sequenceOutput[0]) )
 *
 * i.e. take the final hidden state at position 0 ([CLS]), push it
 * through one dense layer, then tanh. The result is a single
 * (1, hiddenSize) vector used as the aggregate sentence representation
 * for classification tasks.
 */
export function bertPool(
  sequenceOutput: Matrix,
  pooler: BertPoolerWeights,
): Matrix {
  if (sequenceOutput.rows === 0) {
    throw new Error("bertPool: sequenceOutput is empty");
  }
  // Pull the [CLS] row (index 0)
  const cls = sliceRows(sequenceOutput, 0, 1); // shape (1, H)
  const projected = addBias(matmul(cls, pooler.weight), pooler.bias);
  // tanh in place (new matrix to stay immutable)
  const out: Matrix = {
    rows: 1,
    cols: projected.cols,
    data: new Float64Array(projected.cols),
  };
  for (let j = 0; j < projected.cols; j++) {
    out.data[j] = Math.tanh(projected.data[j]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main forward pass
// ---------------------------------------------------------------------------

/**
 * Full BERT forward pass:
 *
 *   1. sum(token, segment, position) → LayerNorm → dropout
 *   2. runEncoder with ffnActivation="gelu" (bidirectional, padding mask
 *      derived from [PAD] tokens)
 *   3. pool([CLS]) → dense + tanh
 *
 * Returns `{ sequenceOutput, pooledOutput }` ready to be consumed by
 * downstream heads (MLM, NSP, classification, token tagging, span
 * prediction, etc.).
 *
 * Parameters:
 *   - `tokenIds`    : the packed [CLS] sentA [SEP] sentB [SEP] [PAD]... sequence.
 *   - `segmentIds`  : 0 for sentence A, 1 for sentence B. Defaults to zeros.
 *   - `dropoutConfig`: optional; pass during training, omit for inference.
 */
export function bertForward(
  weights: BertWeights,
  tokenIds: number[],
  segmentIds?: number[],
  dropoutConfig?: DropoutConfig,
): BertForwardResult {
  const config = weights.config;

  // 1. Input embeddings (token + segment + position + LN + dropout)
  const inputEmbeddings = bertEmbeddingForward(
    weights.embeddings,
    tokenIds,
    segmentIds,
    undefined,
    dropoutConfig,
  );

  // 2. Encoder stack (bidirectional self-attention, GELU FFN).
  //    Build a padding mask so [PAD] positions never get attended to.
  const paddingMask = bertPaddingMask(tokenIds, BERT_SPECIAL_TOKENS.PAD);
  const sequenceOutput = runEncoder(
    inputEmbeddings,
    weights.encoder,
    bertAttentionConfig(config),
    paddingMask,
    dropoutConfig,
    "gelu",
  );

  // 3. Pool [CLS] for sentence-level tasks
  const pooledOutput = bertPool(sequenceOutput, weights.pooler);

  return { sequenceOutput, pooledOutput };
}

// ---------------------------------------------------------------------------
// Feature-based approach (§5.3): expose per-layer hidden states
// ---------------------------------------------------------------------------

export interface BertForwardWithLayersResult extends BertForwardResult {
  /**
   * All hidden states produced by the encoder, including the input
   * embeddings at index 0 and then the output of each of the L encoder
   * layers in order. Length = L + 1.
   *
   * Paper §5.3 "Feature-based Approach with BERT" shows that combining
   * the top few layers (concat last 4, weighted sum, etc.) competes
   * with full fine-tuning on CoNLL-2003 NER — so exposing these at
   * all is the enabling primitive for that whole family of techniques.
   */
  allHiddenStates: Matrix[];
}

/**
 * Same forward pass as `bertForward` but additionally returns the
 * hidden state at EVERY layer, not just the final one. Use this when
 * you want to:
 *
 *   - Concatenate the top 4 hidden states (best BERT feature-based
 *     combination per Table 7 of the paper).
 *   - Take a weighted sum over all layers.
 *   - Probe the model layer-by-layer (what does layer 2 know vs. layer 10?).
 *
 * The returned list is `[embeddings, layer_1_out, layer_2_out, ..., layer_L_out]`,
 * so `allHiddenStates.at(-1)` is identical to `sequenceOutput`.
 */
export function bertForwardWithLayers(
  weights: BertWeights,
  tokenIds: number[],
  segmentIds?: number[],
  dropoutConfig?: DropoutConfig,
): BertForwardWithLayersResult {
  const config = weights.config;
  const attn = bertAttentionConfig(config);
  const paddingMask = bertPaddingMask(tokenIds, BERT_SPECIAL_TOKENS.PAD);

  // 1. Input embeddings
  const inputEmbeddings = bertEmbeddingForward(
    weights.embeddings,
    tokenIds,
    segmentIds,
    undefined,
    dropoutConfig,
  );

  // 2. Run layers one at a time and collect every hidden state.
  //    We deliberately do NOT call `runEncoder` here because it only
  //    returns the final state — we'd lose the intermediates.
  const allHiddenStates: Matrix[] = [inputEmbeddings];
  let h = inputEmbeddings;
  for (let i = 0; i < weights.encoder.length; i++) {
    const layerDropout = dropoutConfig
      ? { ...dropoutConfig, seed: (dropoutConfig.seed ?? 0) + i * 1000 }
      : undefined;
    h = encoderLayer(h, weights.encoder[i], attn, paddingMask, layerDropout, "gelu");
    allHiddenStates.push(h);
  }

  // 3. Pool the final layer output
  const sequenceOutput = h;
  const pooledOutput = bertPool(sequenceOutput, weights.pooler);

  return { sequenceOutput, pooledOutput, allHiddenStates };
}

// Suppress unused LayerNormParams warning — re-exported for fine-tuning
// heads that may want to build their own LayerNorm down the road.
void (null as unknown as LayerNormParams);
