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
  applyGpt2ResidualScaling,
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
  // §2.4 dynamic K selection (fifth audit pass)
  type InContextExamplePair,
  type PickExamplesInput,
  type PickExamplesResult,
  inContextModeOf,
  assertInContextMode,
  buildInContextPrompt,
  validateInContextPrompt,
  pickExamplesThatFit,
} from "./inContextLearning";

// §3.9 + §G task templates
export {
  type TokenizeFn,
  type ArithmeticOp,
  type ArithmeticExample,
  type ArithmeticTemplateInput,
  type WordScramblingExample,
  type WordScramblingTemplateInput,
  type ClozeExample,
  type ClozeTemplateInput,
  type TranslationExample,
  type TranslationTemplateInput,
  // Fifth audit pass: §3.9.3–§3.9.6
  type SatAnalogyChoice,
  type SatAnalogyExample,
  type SatAnalogyTemplateInput,
  type NewsArticleExample,
  type NewsArticleTemplateInput,
  type NovelWordExample,
  type NovelWordTemplateInput,
  type GrammarCorrectionExample,
  type GrammarCorrectionTemplateInput,
  arithmeticPrompt,
  wordScramblingPrompt,
  clozePrompt,
  translationPrompt,
  satAnalogyPrompt,
  newsArticlePrompt,
  novelWordPrompt,
  grammarCorrectionPrompt,
} from "./taskTemplates";

// §D training compute formulas (fifth audit pass)
export {
  type TrainingFlopsInput,
  type PerStepFlopsInput,
  type TotalFlopsFromStepsInput,
  FLOPS_PER_PF_DAY,
  FORWARD_FLOPS_PER_PARAM_PER_TOKEN,
  BACKWARD_FLOPS_PER_PARAM_PER_TOKEN,
  TRAINING_FLOPS_PER_PARAM_PER_TOKEN,
  estimateTrainingFlops,
  estimateTrainingPfDays,
  estimateFlopsPerStep,
  estimateTotalFlopsFromSteps,
  flopsToPfDays,
  pfDaysToFlops,
} from "./computeFormulas";

// ─── GPT-4 technical report additions (arXiv:2303.08774) ───────────────────

// Chat format (§2 canonical ChatML-style transcript)
export {
  type ChatRole,
  type ChatMessage,
  type ChatMarkers,
  type BuildChatPromptOptions,
  type BuiltChatPrompt,
  defaultChatMarkers,
  buildChatPrompt,
  validateChatStructure,
  inContextModeOfChat,
} from "./chatFormat";

// Predictable scaling laws (§2.1)
export {
  type ScalingObservation,
  type ScalingLawParams,
  type ScalingLawFit,
  type FitScalingLawOptions,
  fitScalingLaw,
  predictLoss,
  extrapolationError,
} from "./scalingLaws";

// RLHF primitives (§2.3)
export {
  type GptRewardHeadWeights,
  type PreferenceLossResult,
  type ReinforceStepInput,
  type ReinforceStepResult,
  initGptRewardHead,
  gptReward,
  bradleyTerryLoss,
  batchBradleyTerryLoss,
  reinforceStep,
} from "./rlhf";

// Evaluation + calibration (§3, Figure 8)
export {
  type MultipleChoiceResult,
  type CalibrationPrediction,
  type CalibrationResult,
  CHAIN_OF_THOUGHT_PREAMBLE,
  sequenceLogLikelihood,
  multipleChoiceEval,
  expectedCalibrationError,
  withChainOfThought,
} from "./evaluation";
