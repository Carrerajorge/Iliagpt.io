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
} from "./model";

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
