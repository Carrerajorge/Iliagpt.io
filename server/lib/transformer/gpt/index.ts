/**
 * In-house GPT-3 — Language Models are Few-Shot Learners.
 *
 * Brown et al. 2020 (arXiv:2005.14165).
 *
 * A paper-faithful, zero-dependency TypeScript implementation of the
 * decoder-only autoregressive Transformer described in §2.1 and
 * Table 2.1 of the paper, built on top of our existing Vaswani
 * primitives. Shares:
 *
 *   • `encoderLayer` (reused with a causal mask and GELU FFN)
 *   • `multiHeadAttention` (uniformly applied)
 *   • `truncatedNormal` init (σ = 0.02)
 *
 * And adds:
 *
 *   • Decoder-only stack (no cross-attention, no encoder).
 *   • Alternating dense / locally banded sparse attention patterns.
 *   • Top-k, top-p (nucleus), and temperature sampling.
 *   • In-context learning prompt builder (zero/one/few-shot).
 *   • All 8 Table 2.1 model presets + a tiny test config.
 *   • GPT3_ADAM (β2 = 0.95) + cosine LR schedule.
 */

export type {
  AttentionPattern,
  GptConfig,
  GptWeights,
  SamplingConfig,
} from "./types";

export {
  gpt3SmallConfig,
  gpt3MediumConfig,
  gpt3LargeConfig,
  gpt3XLConfig,
  gpt3_2_7BConfig,
  gpt3_6_7BConfig,
  gpt3_13BConfig,
  gpt3_175BConfig,
  gptTinyConfig,
  allGptPresets,
  gptPreset,
  defaultAlternatingPattern,
} from "./configs";

export {
  localBandMask,
  stridedSparseMask,
  fullCausalMask,
  maskDensity,
} from "./sparseMask";

export {
  applyTemperature,
  softmaxVector,
  topKFilter,
  topPFilter,
  sampleFromLogits,
  countSurvivors,
} from "./sampling";

export {
  gptAttentionConfig,
  initGptLayers,
  initGptWeights,
  gptInputEmbeddings,
  runGptStack,
  gptLogits,
  gptNextTokenLogits,
  gptForward,
} from "./model";

export {
  type GptGenerateConfig,
  type GptGenerateResult,
  gptGenerate,
} from "./generate";

export {
  type InContextExample,
  type InContextMode,
  type InContextPromptSpec,
  type BuiltInContextPrompt,
  inContextModeOf,
  assertInContextMode,
  buildInContextPrompt,
  validateInContextPrompt,
} from "./inContextLearning";
