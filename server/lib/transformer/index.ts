/**
 * Transformer primitives — pure TypeScript implementation of "Attention Is
 * All You Need" (Vaswani et al. 2017).
 *
 * Zero external dependencies. Pure Float64Array math. Correctness-first,
 * not speed-first: the platform's runtime use case is reranking pgvector
 * search results and powering a pedagogical attention-heatmap demo — not
 * training or large-batch inference.
 *
 * Entry points:
 *
 *   import { scaledDotProductAttention, multiHeadAttention, ... } from "@/server/lib/transformer";
 *
 *   const result = scaledDotProductAttention(Q, K, V);
 *   result.output   // the attended values
 *   result.weights  // softmax(QK^T / sqrt(d_k)), rows sum to 1
 *
 * Corresponds to paper equations (1) and (2), sections 3.1–3.5.
 */

// Numerical primitives
export * from "./matrix";

// Attention (eq 1 + multi-head)
export {
  type AttentionResult,
  type MultiHeadConfig,
  type MultiHeadWeights,
  type MultiHeadResult,
  scaledDotProductAttention,
  multiHeadAttention,
  initMultiHeadWeights,
  baseConfig,
  splitHeads,
} from "./attention";

// Positional encoding + embeddings
export {
  type EmbeddingTable,
  positionalEncoding,
  addPositional,
  initEmbeddingTable,
  embedTokens,
} from "./encoding";

// Position-wise feed-forward (eq 2)
export { type FFNWeights, feedForward, initFFNWeights } from "./feedForward";

// Encoder/decoder stacks + full Transformer
export {
  type EncoderLayerWeights,
  type DecoderLayerWeights,
  type TransformerConfig,
  type TransformerWeights,
  type TransformerForwardResult,
  encoderLayer,
  decoderLayer,
  runEncoder,
  runDecoder,
  initEncoderLayerWeights,
  initDecoderLayerWeights,
  initTransformerWeights,
  baseTransformerConfig,
  tinyTransformerConfig,
  transformerForward,
} from "./transformer";
