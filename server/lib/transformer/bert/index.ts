/**
 * In-house BERT — Bidirectional Encoder Representations from Transformers.
 *
 * Devlin, Chang, Lee, Toutanova 2018 (arXiv:1810.04805).
 *
 * A paper-faithful, zero-dependency TypeScript implementation built on
 * top of our existing Vaswani et al. Transformer primitives. Reuses
 * `runEncoder` with GELU + bidirectional attention to avoid code
 * duplication while staying exact on both papers.
 */

export {
  BERT_SPECIAL_TOKENS,
  type BertSpecialTokenId,
  type BertConfig,
  type BertEmbeddingWeights,
  type BertPoolerWeights,
  type BertMLMHeadWeights,
  type BertNSPHeadWeights,
  type BertWeights,
  type BertForwardResult,
} from "./types";

export {
  bertBaseConfig,
  bertLargeConfig,
  bertTinyConfig,
  allBertPresets,
  bertPreset,
  estimateBertParams,
  BERT_PRE_TRAINING_HYPERS,
  BERT_FINE_TUNING_HYPERS,
  bertFineTuningGrid,
} from "./configs";

export {
  initBertEmbeddingWeights,
  bertEmbeddingForward,
  bertPaddingMask,
} from "./embeddings";

export {
  bertAttentionConfig,
  initBertEncoderLayers,
  initBertPooler,
  initBertMLMHead,
  initBertNSPHead,
  initBertWeights,
  bertPool,
  bertForward,
  bertForwardWithLayers,
  type BertForwardWithLayersResult,
} from "./model";

export {
  // (a) + (b) classification
  type BertClassificationHeadWeights,
  type ClassificationLossResult,
  initBertClassificationHead,
  bertClassificationLogits,
  bertClassificationLoss,
  // (c) span prediction — SQuAD v1.1 and v2.0
  type BertSpanHeadWeights,
  type BertSpanLogits,
  type SpanLossResult,
  type SpanPredictionV2,
  initBertSpanHead,
  bertSpanLogits,
  bertSpanLoss,
  bertSpanLossV2,
  bertSpanPredictV2,
  // (d) token tagging
  type BertTokenTaggingHeadWeights,
  type TokenTaggingLossResult,
  initBertTokenTaggingHead,
  bertTokenTaggingLogits,
  bertTokenTaggingLoss,
  // SWAG / multiple-choice (§4.4)
  type BertMultipleChoiceHeadWeights,
  type MultipleChoiceLossResult,
  initBertMultipleChoiceHead,
  bertMultipleChoiceScores,
  bertMultipleChoiceLoss,
} from "./fineTuningHeads";

// §5.3 feature-based approach utilities
export {
  concatLastKLayers,
  concatLastFourHidden,
  sumLastKLayers,
  weightedSumLayers,
  secondToLastHidden,
} from "./layerCombination";

export {
  type BertPreTrainingBatch,
  type BertPreTrainingResult,
  bertPreTrainingLoss,
} from "./pretraining";

export {
  type MaskedLMLossResult,
  bertMLMLogits,
  maskedLMLoss,
  bertMLMTopK,
} from "./maskedLM";

export {
  NSP_IS_NEXT,
  NSP_NOT_NEXT,
  type NSPLabel,
  type NSPLossResult,
  bertNSPLogits,
  bertNSPProbabilities,
  nextSentenceLoss,
} from "./nsp";

export {
  type MaskingConfig,
  type MaskedBatch,
  defaultMaskingConfig,
  applyMaskingProcedure,
} from "./masking";
