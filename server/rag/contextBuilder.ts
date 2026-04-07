/**
 * Context Builder — Assembles RAG context for the chat prompt.
 *
 * When a user has knowledge bases or uploaded documents, this module:
 * 1. Searches relevant chunks using the vector store
 * 2. Ranks and selects the best chunks
 * 3. Builds a prompt section with the context + citations
 * 4. Respects model token limits
 */

import { search, type SearchOptions, type SearchResult } from "./vectorStore";
import { listCollections } from "./knowledgeBase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RAGContext {
  /** Whether RAG was used for this response */
  active: boolean;
  /** The assembled context text to inject into the prompt */
  contextText: string;
  /** Sources used, for citation display */
  sources: RAGSource[];
  /** Total chunks considered */
  chunksSearched: number;
  /** Chunks actually included in context */
  chunksIncluded: number;
  /** Processing time in ms */
  processingTimeMs: number;
}

export interface RAGSource {
  id: string;
  filename: string;
  pageNumber?: number;
  sectionHeading?: string;
  relevanceScore: number;
  snippet: string;
  collectionId?: string;
}

export interface ContextBuildOptions {
  userId: string;
  query: string;
  /** Max tokens to use for context (default 3000) */
  maxTokens?: number;
  /** Specific collection IDs to search (empty = all user collections) */
  collectionIds?: string[];
  /** Minimum relevance score (default 0.3) */
  minScore?: number;
  /** Number of chunks to retrieve (default 10) */
  topK?: number;
  /** Enable hybrid search (default true) */
  hybrid?: boolean;
  /** Include the RAG instruction prefix (default true) */
  includeInstruction?: boolean;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English, ~3 for Spanish
  return Math.ceil(text.length / 3.5);
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

const RAG_INSTRUCTION = `Use the following context from the user's documents to answer their question.
If the context contains relevant information, use it and cite the source.
If the context doesn't contain relevant information, answer from your general knowledge and mention that.
Always cite sources using [Source: filename, page/section] format when using document context.

--- DOCUMENT CONTEXT ---
`;

const RAG_INSTRUCTION_ES = `Usa el siguiente contexto de los documentos del usuario para responder su pregunta.
Si el contexto contiene información relevante, úsalo y cita la fuente.
Si el contexto no contiene información relevante, responde con tu conocimiento general y menciónalo.
Siempre cita las fuentes usando el formato [Fuente: nombre_archivo, página/sección] cuando uses el contexto.

--- CONTEXTO DE DOCUMENTOS ---
`;

/**
 * Build RAG context for a user query.
 * Searches all the user's knowledge base collections and returns
 * formatted context with citations for injection into the chat prompt.
 */
export async function buildRAGContext(options: ContextBuildOptions): Promise<RAGContext> {
  const startTime = Date.now();
  const {
    userId,
    query,
    maxTokens = 3000,
    collectionIds,
    minScore = 0.3,
    topK = 10,
    hybrid = true,
    includeInstruction = true,
  } = options;

  // Determine which collections to search
  let targetCollections = collectionIds;
  if (!targetCollections || targetCollections.length === 0) {
    const collections = await listCollections(userId);
    targetCollections = collections.map(c => c.id);
  }

  if (targetCollections.length === 0) {
    return {
      active: false,
      contextText: "",
      sources: [],
      chunksSearched: 0,
      chunksIncluded: 0,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // Search each collection
  const allResults: SearchResult[] = [];
  for (const collectionId of targetCollections) {
    try {
      const results = await search({
        query,
        userId,
        topK,
        minScore,
        collectionId,
        hybrid,
      });
      allResults.push(...results);
    } catch (err) {
      console.warn(`[ContextBuilder] Search failed for collection ${collectionId}:`, err);
    }
  }

  if (allResults.length === 0) {
    return {
      active: false,
      contextText: "",
      sources: [],
      chunksSearched: 0,
      chunksIncluded: 0,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // Sort by score descending, deduplicate
  const seen = new Set<string>();
  const unique = allResults
    .sort((a, b) => b.score - a.score)
    .filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

  // Build context text respecting token limit
  const instructionTokens = includeInstruction ? estimateTokens(RAG_INSTRUCTION) : 0;
  let remainingTokens = maxTokens - instructionTokens;
  const includedChunks: SearchResult[] = [];

  for (const result of unique) {
    const chunkTokens = estimateTokens(result.content);
    if (chunkTokens > remainingTokens) {
      if (includedChunks.length === 0) {
        // Include at least one chunk, even if truncated
        const truncated = result.content.slice(0, remainingTokens * 3); // rough char estimate
        includedChunks.push({ ...result, content: truncated + "..." });
      }
      break;
    }
    includedChunks.push(result);
    remainingTokens -= chunkTokens;
  }

  // Format context with source attribution
  const contextParts: string[] = [];
  const sources: RAGSource[] = [];

  for (let i = 0; i < includedChunks.length; i++) {
    const chunk = includedChunks[i];
    const filename = (chunk.metadata.filename as string) || "Unknown";
    const page = chunk.metadata.pageNumber ? `, p.${chunk.metadata.pageNumber}` : "";
    const section = chunk.metadata.sectionHeading ? `, ${chunk.metadata.sectionHeading}` : "";

    contextParts.push(
      `[Source ${i + 1}: ${filename}${page}${section}]\n${chunk.content}\n`,
    );

    sources.push({
      id: chunk.id,
      filename,
      pageNumber: chunk.metadata.pageNumber as number | undefined,
      sectionHeading: chunk.metadata.sectionHeading as string | undefined,
      relevanceScore: chunk.score,
      snippet: chunk.content.slice(0, 200),
      collectionId: chunk.metadata.collectionId as string | undefined,
    });
  }

  const contextBody = contextParts.join("\n");
  const instruction = includeInstruction ? RAG_INSTRUCTION : "";
  const contextText = instruction + contextBody + "\n--- END CONTEXT ---\n";

  return {
    active: true,
    contextText,
    sources,
    chunksSearched: allResults.length,
    chunksIncluded: includedChunks.length,
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Quick check if a user has any knowledge base content.
 * Used to decide whether to run RAG at all.
 */
export async function hasKnowledgeBase(userId: string): Promise<boolean> {
  const collections = await listCollections(userId);
  return collections.some(c => c.chunkCount > 0);
}
