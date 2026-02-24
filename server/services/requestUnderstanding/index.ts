/**
 * Request Understanding Pipeline — Barrel Export
 *
 * This module provides the complete request understanding pipeline:
 *
 *   1. Brief Schema — Canonical structured output definition
 *   2. Understanding Agent — Intent analysis & brief generation
 *   3. Layout-Aware Parser — Structure-preserving document parsing
 *   4. Context-Aware Chunker — Header-propagating chunking
 *   5. Vision Language Model — Image content extraction
 *   6. GraphRAG — Entity-relation knowledge graph
 *   7. Hybrid RAG — Vector + BM25 + Graph retrieval with reranking
 *   8. Verifier/QA — Coherence checks, citation validation, confidence
 *   9. Pipeline Telemetry — Traces, metrics, evaluation
 *  10. LLM Judge — Automated quality scoring & regression testing
 *  11. Gating Middleware — Orchestration layer
 */

// Core schemas
export {
  CanonicalBriefSchema,
  type CanonicalBrief,
  type SubTask,
  type DeliverableSpec,
  type AudienceTone,
  type DataClassification,
  type SuccessCriterion,
  type RiskAmbiguity,
  type ClarificationQuestion,
  type ImageAnalysis,
  parseBrief,
  createEmptyBrief,
  getBriefJsonSchema,
} from './briefSchema';

// Understanding Agent
export {
  understandRequest,
  type UnderstandingInput,
  type UnderstandingResult,
  requestUnderstandingAgent,
} from './requestUnderstandingAgent';

// Layout-Aware Parser
export {
  parseDocumentLayoutAware,
  type LayoutAwareDocument,
  type DocumentSection,
  type DocumentTable,
  layoutAwareParser,
} from './layoutAwareParser';

// Context-Aware Chunker
export {
  chunkDocument,
  chunkDocuments,
  type ContextualChunk,
  type ChunkingOptions,
  contextAwareChunker,
} from './contextAwareChunker';

// Vision Language Model
export {
  analyzeImage,
  analyzeImages,
  type VLMInput,
  type VLMAnalysisResult,
  visionLanguageModel,
} from './visionLanguageModel';

// GraphRAG
export {
  buildKnowledgeGraph,
  retrieveSubgraph,
  type KnowledgeGraph,
  type GraphEntity,
  type GraphRelation,
  type SubgraphResult,
  graphRAGEngine,
} from './graphRAG';

// Hybrid RAG Engine
export {
  hybridRetrieve,
  type HybridRAGOptions,
  type HybridRAGResult,
  type RetrievedResult,
  hybridRAGEngine,
} from './hybridRAGEngine';

// Verifier/QA
export {
  verifyResponse,
  type VerificationInput,
  type VerificationResult,
  type ClaimVerification,
  type CoherenceCheck,
  type CitationAudit,
  verifierQA,
} from './verifierQA';

// Pipeline Telemetry
export {
  createTrace,
  recordStageStart,
  recordStageComplete,
  recordBriefMetrics,
  recordRetrievalMetrics,
  recordVerificationMetrics,
  recordOutcome,
  saveTrace,
  computeMetrics,
  addEvaluationCase,
  getEvaluationCases,
  getTraces,
  type PipelineTrace,
  type StageTrace,
  type EvaluationCase,
  type EvaluationMetrics,
  pipelineTelemetry,
} from './pipelineTelemetry';

// LLM Judge
export {
  evaluateCase,
  runRegressionSuite,
  generateSyntheticCases,
  type JudgeEvaluation,
  type RegressionResult,
  llmJudge,
} from './llmJudge';

// Gating Middleware (Main Entry Point)
export {
  processRequestGating,
  verifyAndFinalize,
  type GatingInput,
  type GatingResult,
  gatingMiddleware,
} from './gatingMiddleware';
