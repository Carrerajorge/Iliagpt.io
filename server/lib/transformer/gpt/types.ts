/**
 * Shared types for the in-house GPT-3 implementation.
 *
 * Brown, Mann, Ryder, Subbiah, Kaplan, Dhariwal, Neelakantan, Shyam,
 * Sastry, Askell, Agarwal, Herbert-Voss, Krueger, Henighan, Child,
 * Ramesh, Ziegler, Wu, Winter, Hesse, Chen, Sigler, Litwin, Gray,
 * Chess, Clark, Berner, McCandlish, Radford, Sutskever, Amodei 2020,
 * arXiv:2005.14165 — "Language Models are Few-Shot Learners".
 *
 * GPT-3 is a *decoder-only* autoregressive Transformer, distinct from:
 *
 *   • Vaswani et al. 2017   — encoder-decoder (our existing Vaswani impl)
 *   • Devlin et al. 2018    — encoder-only bidirectional (our BERT impl)
 *   • Brown et al. 2020     — decoder-only autoregressive (this module)
 *
 * Architectural differences from our Vaswani decoder:
 *
 *   • No cross-attention (there is no encoder to cross to).
 *   • Only 2 sub-layers per block: masked self-attention and FFN.
 *     Our Vaswani decoder has 3 (masked-self, cross, FFN).
 *   • Alternating dense and locally banded sparse attention patterns
 *     in the layers, "similar to the Sparse Transformer" (§2.1).
 *
 * Shared with BERT / Vaswani:
 *
 *   • GELU activation in the FFN (via `ffnActivation="gelu"`).
 *   • Learnable γ, β LayerNorm parameters (Ba et al. 2016).
 *   • Truncated-normal initialization at σ = 0.02.
 *
 * This module reuses the existing `EncoderLayerWeights` shape for each
 * decoder block because — modulo the FFN activation and the mask — the
 * two are structurally identical (both are "masked self-attn + FFN with
 * residuals + LN"). The causal mask is injected at the `runGptStack`
 * call site, so we don't need a new layer type.
 */

import type { Matrix } from "../matrix";
import type { EncoderLayerWeights } from "../transformer";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Attention pattern for a specific GPT-3 decoder layer.
 *
 *   "dense"  — full causal mask (every position attends to everything
 *               up to and including itself).
 *   "sparse" — Sparse Transformer-style locally banded + strided mask.
 *
 * GPT-3 alternates between these two patterns across the layer stack
 * (§2.1). Callers can override the alternation by passing an explicit
 * `attentionPatterns: AttentionPattern[]` of length L on the config.
 */
export type AttentionPattern = "dense" | "sparse";

/**
 * Full GPT-3 hyperparameter record. Defaults are deliberately absent —
 * every field must be set, because the paper's 8 model sizes (Table
 * 2.1) make very different choices for each.
 */
export interface GptConfig {
  /** Name for logging / presets (e.g. "gpt3-small", "gpt3-xl", "gpt3-175b"). */
  name: string;
  /** Number of decoder layers L. Paper range: 12 (small) – 96 (175B). */
  numLayers: number;
  /** Hidden dimension d_model. Paper range: 768 – 12288. */
  hiddenSize: number;
  /** Number of self-attention heads h. Must divide `hiddenSize`. */
  numHeads: number;
  /** Per-head dimension d_head = hiddenSize / numHeads. Stored for clarity. */
  headSize: number;
  /** Inner FFN size. Paper: 4 · hiddenSize throughout Table 2.1. */
  intermediateSize: number;
  /** Vocabulary size. GPT-3 uses byte-level BPE at 50,257 tokens. */
  vocabSize: number;
  /** Maximum context window. GPT-3: 2048 tokens. */
  contextWindow: number;
  /** Dropout rate (GPT-3 §A/Appendix uses 0.1 on everything). */
  dropoutRate: number;
  /** LayerNorm ε. Reference impl uses 1e-5. */
  layerNormEps: number;
  /** Stddev for truncated-normal init. Paper: 0.02. */
  initStdDev: number;
  /** Per-layer attention pattern. Length must equal `numLayers`. */
  attentionPatterns: AttentionPattern[];
  /** Approximate parameter count in millions, for documentation. */
  approxParamsMillions: number;
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

/**
 * Complete GPT-3 weight collection.
 *
 * Reuses the existing `EncoderLayerWeights` type for each decoder block
 * because GPT-3's blocks are structurally identical to the Vaswani
 * encoder block (masked self-attention + FFN + residuals + learnable
 * LayerNorm γ/β). The causal mask and the sparse attention pattern are
 * injected at the `runGptStack` call site — they are properties of the
 * forward pass, not of the weight tensors.
 */
export interface GptWeights {
  config: GptConfig;
  /** Token embedding table, shape (vocabSize, hiddenSize). */
  tokenEmbeddings: Matrix;
  /** LEARNED position embedding table, shape (contextWindow, hiddenSize).
   *  GPT-3 uses learned position embeddings, same as BERT. */
  positionEmbeddings: Matrix;
  /** Decoder layer stack. Each entry holds one masked-self-attention and
   *  one FFN, matching the `EncoderLayerWeights` shape from the Vaswani
   *  module. Length equals `config.numLayers`. */
  layers: EncoderLayerWeights[];
  /** Final LayerNorm applied after the last layer (GPT-2/3 convention). */
  finalLayerNormGamma: Matrix;
  finalLayerNormBeta: Matrix;
  /** Tied output head bias, shape (1, vocabSize). The projection weight
   *  is tied to `tokenEmbeddings^T`, same convention as Vaswani's tied
   *  output projection. */
  outputBias: Matrix;
}

// ---------------------------------------------------------------------------
// Sampling config
// ---------------------------------------------------------------------------

/**
 * Sampling hyperparameters for autoregressive generation. Every field is
 * optional; leaving them at defaults produces greedy decoding.
 *
 *   temperature  T > 0  — divides the logits before softmax. T<1 sharpens
 *                          the distribution, T>1 flattens it. T=1 is
 *                          neutral (pure softmax). T→0 becomes greedy.
 *
 *   topK          1..V  — keep only the K highest-scoring tokens;
 *                          everything else gets −∞. K=0 (or undefined)
 *                          means "no top-k filter".
 *
 *   topP        0..1    — "nucleus sampling" (Holtzman et al. 2019).
 *                          Sort tokens by probability descending, keep
 *                          the smallest prefix whose cumulative prob ≥ p.
 *                          topP=1 (or undefined) means "no nucleus filter".
 *
 *   seed                 — PRNG seed for reproducibility. Fixed seed →
 *                          deterministic output.
 */
export interface SamplingConfig {
  temperature?: number;
  topK?: number;
  topP?: number;
  seed?: number;
  /**
   * Force greedy (argmax) regardless of the other settings. Convenient
   * for tests and reference comparisons.
   */
  greedy?: boolean;
}
