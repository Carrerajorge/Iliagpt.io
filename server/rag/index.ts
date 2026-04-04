/**
 * server/rag/index.ts — RAG system entry point.
 *
 * Re-exports the full RAG pipeline from server/services/rag and
 * exposes top-level ragQuery() and ragIndex() convenience functions.
 *
 * Usage:
 *   import { ragQuery, ragIndex, ingestionPipeline } from "@/rag"
 */

// ── Re-export full RAG sub-system ────────────────────────────────────────────
export * from "../services/rag/index";

// ── Re-export low-level pipeline functions ───────────────────────────────────
export {
  semanticChunk,
  generateEmbeddingGemini,
  generateEmbeddingsBatch,
  indexDocument,
  type SemanticChunk,
  type RetrievedChunk,
  type RAGContext,
  type CitedResponse,
  type Citation as RAGCitation,
  type ChunkMetadata,
} from "../services/ragPipeline";

// ── Re-export advanced RAG capabilities ──────────────────────────────────────
export {
  advancedSemanticChunk,
  expandQuery,
  hybridRetrieveAdvanced,
  crossEncoderRerank,
  contextualCompression,
  multiHopRetrieval,
  generateAnswerWithCitations,
  fullRAGPipeline,
  getCachedResult,
  setCacheResult,
} from "../services/advancedRAG";

// ── Additional memory store ───────────────────────────────────────────────────
export { pgVectorMemoryStore } from "../memory/PgVectorMemoryStore";

// ── Convenience entry-points ──────────────────────────────────────────────────

import { hybridRetriever, type RetrievalOptions } from "../services/rag/hybridRetriever";
import { promptContextBuilder, type PromptBuildOptions, type BuiltPrompt } from "../services/rag/promptContextBuilder";
import { ingestionPipeline, type IngestionSource, type IngestionOptions, type IngestionResult } from "../services/rag/ingestionPipeline";
import { fullRAGPipeline } from "../services/advancedRAG";
import { createLogger } from "../utils/logger";

const logger = createLogger("RAG");

export interface RAGQueryOptions {
  query: string;
  userId?: string;
  conversationId?: string;
  tenantId?: string;
  topK?: number;
  sources?: string[];
  buildPrompt?: boolean;
  promptOptions?: Partial<PromptBuildOptions>;
}

export interface RAGQueryResult {
  context: string;
  citations: BuiltPrompt["citations"];
  chunkCount: number;
  retrievalMs: number;
}

/**
 * High-level RAG query function.
 * Retrieves relevant chunks and optionally builds a prompted context block.
 */
export async function ragQuery(options: RAGQueryOptions): Promise<RAGQueryResult> {
  const {
    query,
    userId,
    conversationId,
    tenantId = "default",
    topK = 8,
    sources,
    buildPrompt: shouldBuildPrompt = true,
    promptOptions = {},
  } = options;

  const startTime = Date.now();

  const retrievalOpts: RetrievalOptions = {
    query,
    userId,
    topK,
    sources,
    aclTags: userId ? [userId] : undefined,
  };

  const retrieved = await hybridRetriever.retrieve(retrievalOpts);
  const retrievalMs = Date.now() - startTime;

  if (!shouldBuildPrompt) {
    return {
      context: retrieved.chunks.map((c) => c.content).join("\n\n"),
      citations: [],
      chunkCount: retrieved.chunks.length,
      retrievalMs,
    };
  }

  const built = await promptContextBuilder.build({
    query,
    chunks: retrieved.chunks,
    conversationId,
    userId,
    tenantId,
    maxContextTokens: 8192,
    ...promptOptions,
  });

  logger.info(`RAG query: "${query.slice(0, 50)}" → ${retrieved.chunks.length} chunks in ${retrievalMs}ms`);

  return {
    context: built.systemContext,
    citations: built.citations,
    chunkCount: retrieved.chunks.length,
    retrievalMs,
  };
}

/**
 * High-level document indexing function.
 * Chunks, embeds, and stores a document into the vector store.
 */
export async function ragIndex(
  source: IngestionSource,
  options: Partial<IngestionOptions> = {}
): Promise<IngestionResult> {
  const result = await ingestionPipeline.ingest(source, {
    chunkSize: 512,
    chunkOverlap: 64,
    generateEmbeddings: true,
    ...options,
  });

  logger.info(`RAG indexed: ${result.chunksCreated} chunks from ${source.type} source`);
  return result;
}

/**
 * Full RAG + answer generation pipeline.
 */
export { fullRAGPipeline };
