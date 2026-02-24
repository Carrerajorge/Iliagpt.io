/**
 * Request Gating Middleware
 *
 * This is the orchestration layer that enforces the mandatory
 * Request-Understanding Agent step before ANY downstream processing.
 *
 * Flow:
 *   1. User sends message (text + optional docs + optional images)
 *   2. [VLM] Analyze any attached images → VLMAnalysisResult[]
 *   3. [Parser] Parse any attached documents with layout awareness → LayoutAwareDocument[]
 *   4. [Chunker] Chunk documents context-aware → ContextualChunk[]
 *   5. [Understanding] Build canonical brief → CanonicalBrief
 *   6. [Gate] If hard_blocker → return clarification question
 *   7. [RAG] If brief.routingHints.requiresRAG → hybrid retrieval
 *   8. [GraphRAG] If multiple docs with connected info → build graph, retrieve subgraph
 *   9. [Route] Send brief + context to appropriate pipeline (chat/production/agent)
 *  10. [Verify] Run Verifier/QA on the response
 *  11. [Telemetry] Record full trace
 *  12. [Judge] Optionally run LLM-as-a-judge for quality scoring
 *
 * This middleware can be used:
 *   - As Express middleware (req.brief populated before route handler)
 *   - As a standalone function (for testing/direct calls)
 */

import { withSpan } from '../../lib/tracing';
import { understandRequest, type UnderstandingInput, type UnderstandingResult } from './requestUnderstandingAgent';
import { analyzeImages, type VLMInput, type VLMAnalysisResult } from './visionLanguageModel';
import { parseDocumentLayoutAware, type LayoutAwareDocument } from './layoutAwareParser';
import { chunkDocuments, type ContextualChunk } from './contextAwareChunker';
import { buildKnowledgeGraph, type KnowledgeGraph } from './graphRAG';
import { hybridRetrieve, type HybridRAGResult } from './hybridRAGEngine';
import { verifyResponse, type VerificationResult } from './verifierQA';
import {
  createTrace,
  recordStageStart,
  recordStageComplete,
  recordBriefMetrics,
  recordRetrievalMetrics,
  recordVerificationMetrics,
  recordOutcome,
  saveTrace,
  type PipelineTrace,
} from './pipelineTelemetry';
import type { CanonicalBrief } from './briefSchema';

// ============================================================================
// Types
// ============================================================================

export interface GatingInput {
  /** User's message text */
  userText: string;
  /** Conversation history */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Attached file buffers with metadata */
  attachedFiles?: Array<{
    buffer: Buffer;
    mimeType: string;
    fileName: string;
    fileId?: string;
  }>;
  /** Attached image buffers */
  attachedImages?: Array<{
    buffer: Buffer;
    mimeType: string;
    fileName?: string;
  }>;
  /** User ID */
  userId?: string;
  /** Chat/Session ID */
  chatId?: string;
  /** Skip verification (for speed on simple queries) */
  skipVerification?: boolean;
  /** Skip GraphRAG (for speed) */
  skipGraphRAG?: boolean;
}

export interface GatingResult {
  /** The canonical brief */
  brief: CanonicalBrief;
  /** Whether the request needs clarification before proceeding */
  needsClarification: boolean;
  /** Parsed documents (layout-aware) */
  documents: LayoutAwareDocument[];
  /** Image analyses */
  imageAnalyses: VLMAnalysisResult[];
  /** Context-aware chunks (from all documents) */
  chunks: ContextualChunk[];
  /** Knowledge graph (if built) */
  knowledgeGraph?: KnowledgeGraph;
  /** RAG results (if retrieval was performed) */
  ragResults?: HybridRAGResult;
  /** Verification result (if response was verified) */
  verification?: VerificationResult;
  /** Full pipeline trace */
  trace: PipelineTrace;
  /** Suggested pipeline for downstream processing */
  suggestedPipeline: 'chat' | 'production' | 'agent' | 'rag_only' | 'hybrid';
  /** Processing time */
  totalProcessingTimeMs: number;
}

// ============================================================================
// Main Gating Function
// ============================================================================

/**
 * Process a user request through the full gating pipeline.
 * This is the main entry point that should be called before any response generation.
 */
export async function processRequestGating(input: GatingInput): Promise<GatingResult> {
  return withSpan('gating.process', async (span) => {
    const startTime = Date.now();
    const trace = createTrace(input.chatId, input.userId);

    span.setAttribute('gating.text_length', input.userText.length);
    span.setAttribute('gating.file_count', input.attachedFiles?.length || 0);
    span.setAttribute('gating.image_count', input.attachedImages?.length || 0);

    let documents: LayoutAwareDocument[] = [];
    let imageAnalyses: VLMAnalysisResult[] = [];
    let chunks: ContextualChunk[] = [];
    let knowledgeGraph: KnowledgeGraph | undefined;
    let ragResults: HybridRAGResult | undefined;

    // ── Step 1: Parallel ingestion (images + documents) ─────────────

    const ingestionPromises: Promise<void>[] = [];

    // 1a. Image Analysis (VLM)
    if (input.attachedImages && input.attachedImages.length > 0) {
      recordStageStart(trace, 'imageAnalysis');
      ingestionPromises.push(
        (async () => {
          const vlmInputs: VLMInput[] = input.attachedImages!.map(img => ({
            imageBuffer: img.buffer,
            mimeType: img.mimeType,
            fileName: img.fileName,
            userContext: input.userText.slice(0, 500),
          }));
          imageAnalyses = await analyzeImages(vlmInputs);
          recordStageComplete(trace, 'imageAnalysis', {
            llmCalls: imageAnalyses.length,
            metadata: { imageCount: imageAnalyses.length },
          });
        })()
      );
    }

    // 1b. Document Parsing (layout-aware)
    if (input.attachedFiles && input.attachedFiles.length > 0) {
      recordStageStart(trace, 'documentIngestion');
      ingestionPromises.push(
        (async () => {
          documents = await Promise.all(
            input.attachedFiles!.map(file =>
              parseDocumentLayoutAware(file.buffer, file.mimeType, file.fileName, file.fileId)
            )
          );

          // Chunk all documents
          chunks = await chunkDocuments(documents, {
            targetTokens: 512,
            maxTokens: 1024,
            overlapTokens: 64,
            includeContextPrefix: true,
          });

          recordStageComplete(trace, 'documentIngestion', {
            metadata: {
              documentCount: documents.length,
              totalChunks: chunks.length,
              totalSections: documents.reduce((s, d) => s + d.sections.length, 0),
              totalTables: documents.reduce((s, d) => s + d.tables.length, 0),
            },
          });
        })()
      );
    }

    // Wait for all ingestion to complete
    await Promise.all(ingestionPromises);

    // ── Step 2: Request Understanding Agent ──────────────────────────

    recordStageStart(trace, 'understanding');
    const understandingInput: UnderstandingInput = {
      userText: input.userText,
      conversationHistory: input.conversationHistory,
      documents,
      imageAnalyses,
      userId: input.userId,
      chatId: input.chatId,
    };

    let understandingResult: UnderstandingResult;
    try {
      understandingResult = await understandRequest(understandingInput);
    } catch (error) {
      console.error('[Gating] Understanding agent failed:', error);
      // Use a minimal fallback
      const { createEmptyBrief } = await import('./briefSchema');
      const fallbackBrief = createEmptyBrief(trace.traceId);
      fallbackBrief.primaryIntent = input.userText.slice(0, 500);
      understandingResult = {
        brief: fallbackBrief,
        needsClarification: false,
        meta: {
          model: 'fallback',
          inputTokensEstimate: 0,
          outputTokensEstimate: 0,
          retries: 0,
          latencyMs: 0,
          parseErrors: [(error as Error).message],
        },
      };
    }

    const brief = understandingResult.brief;
    recordStageComplete(trace, 'understanding', {
      tokensIn: understandingResult.meta.inputTokensEstimate,
      tokensOut: understandingResult.meta.outputTokensEstimate,
      llmCalls: 1 + understandingResult.meta.retries,
      metadata: {
        intentCategory: brief.intentCategory,
        intentConfidence: brief.intentConfidence,
        subTasks: brief.subTasks.length,
        needsClarification: understandingResult.needsClarification,
      },
    });

    recordBriefMetrics(trace, brief);

    span.setAttribute('gating.intent_category', brief.intentCategory);
    span.setAttribute('gating.intent_confidence', brief.intentConfidence);
    span.setAttribute('gating.needs_clarification', understandingResult.needsClarification);
    span.setAttribute('gating.suggested_pipeline', brief.routingHints.suggestedPipeline);

    // ── Step 3: Gate Check ───────────────────────────────────────────

    if (understandingResult.needsClarification) {
      const totalTime = Date.now() - startTime;
      recordOutcome(trace, false, true, 0, 0);
      saveTrace(trace);

      return {
        brief,
        needsClarification: true,
        documents,
        imageAnalyses,
        chunks,
        trace,
        suggestedPipeline: brief.routingHints.suggestedPipeline,
        totalProcessingTimeMs: totalTime,
      };
    }

    // ── Step 4: GraphRAG + Hybrid RAG (if needed) ────────────────────

    if ((brief.routingHints.requiresRAG || chunks.length > 0) && chunks.length > 0) {
      recordStageStart(trace, 'retrieval');

      // Build knowledge graph if multiple documents or explicitly needed
      if (!input.skipGraphRAG && documents.length >= 2 && chunks.length > 10) {
        recordStageStart(trace, 'graphBuilding');
        knowledgeGraph = await buildKnowledgeGraph(chunks, {
          maxChunksToProcess: 50,
          enableLLMExtraction: true,
        });
        recordStageComplete(trace, 'graphBuilding', {
          llmCalls: Math.ceil(Math.min(chunks.length, 50) / 5),
          metadata: {
            entities: knowledgeGraph.metadata.totalEntities,
            relations: knowledgeGraph.metadata.totalRelations,
            communities: knowledgeGraph.metadata.totalCommunities,
          },
        });
      }

      // Hybrid retrieval
      ragResults = await hybridRetrieve(input.userText, chunks, knowledgeGraph, {
        topK: 10,
        enableGraphRAG: !!knowledgeGraph,
        enableReranking: true,
        enableQueryExpansion: true,
        language: brief.rawInputFingerprint.languageDetected as 'es' | 'en' || 'es',
      });

      recordStageComplete(trace, 'retrieval', {
        llmCalls: 2, // query expansion + reranking
        metadata: {
          chunksRetrieved: ragResults.results.length,
          confidence: ragResults.confidence,
        },
      });

      recordRetrievalMetrics(trace, ragResults);
    }

    // ── Step 5: Record and return ────────────────────────────────────

    const totalTime = Date.now() - startTime;
    span.setAttribute('gating.total_time_ms', totalTime);
    span.setAttribute('gating.chunk_count', chunks.length);
    span.setAttribute('gating.rag_results', ragResults?.results.length || 0);

    return {
      brief,
      needsClarification: false,
      documents,
      imageAnalyses,
      chunks,
      knowledgeGraph,
      ragResults,
      trace,
      suggestedPipeline: brief.routingHints.suggestedPipeline,
      totalProcessingTimeMs: totalTime,
    };
  });
}

/**
 * Post-response verification step.
 * Call this AFTER generating the response to verify quality.
 */
export async function verifyAndFinalize(
  gatingResult: GatingResult,
  response: string,
  userQuery: string,
): Promise<{
  verification: VerificationResult;
  trace: PipelineTrace;
}> {
  return withSpan('gating.verify', async (span) => {
    const trace = gatingResult.trace;

    recordStageStart(trace, 'verification');
    const verification = await verifyResponse({
      response,
      brief: gatingResult.brief,
      retrievedContext: gatingResult.ragResults?.results || [],
      userQuery,
    });

    recordStageComplete(trace, 'verification', {
      llmCalls: 1,
      metadata: {
        grade: verification.grade,
        confidence: verification.overallConfidence,
        passed: verification.passed,
      },
    });

    recordVerificationMetrics(trace, verification);
    recordOutcome(
      trace,
      verification.passed,
      false,
      response.length,
      verification.citationAudit.citedClaims,
    );

    saveTrace(trace);

    span.setAttribute('gating.verification_grade', verification.grade);
    span.setAttribute('gating.verification_passed', verification.passed);

    return { verification, trace };
  });
}

export const gatingMiddleware = {
  processRequestGating,
  verifyAndFinalize,
};
