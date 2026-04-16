/**
 * RAG + Persistent Memory — Barrel Export
 *
 * Unified API for the full RAG pipeline with persistent user memory.
 */

export { ingestionPipeline, type IngestionSource, type IngestionOptions, type IngestionResult } from "./ingestionPipeline";
export { hybridRetriever, type RetrievalOptions, type ScoredChunk, type RetrievalResult } from "./hybridRetriever";
export {
    memoryService,
    type ShortTermMemory,
    type LongTermMemory,
    type MemoryContext,
    type ExtractedFact,
    type MemoryServiceOptions,
} from "./memoryService";
export { promptContextBuilder, type BuiltPrompt, type PromptBuildOptions, type Citation } from "./promptContextBuilder";
export { privacyService } from "./privacyService";
export {
    evaluationHarness,
    type GoldenTestCase,
    type RetrievalTrace,
    type EvalMetrics,
    type EvalRunSummary,
    RequestTracer,
} from "./evaluationHarness";

// ---------------------------------------------------------------------------
// Convenience: Full RAG pipeline orchestrator
// ---------------------------------------------------------------------------

import { ingestionPipeline, type IngestionSource, type IngestionOptions } from "./ingestionPipeline";
import { hybridRetriever, type RetrievalOptions } from "./hybridRetriever";
import { memoryService, type MemoryServiceOptions } from "./memoryService";
import { promptContextBuilder, type PromptBuildOptions } from "./promptContextBuilder";
import { privacyService } from "./privacyService";
import { RequestTracer } from "./evaluationHarness";

export interface RAGRequestOptions {
    tenantId: string;
    userId: string;
    chatId: string;
    conversationId?: string;
    query: string;
    // Retrieval
    topK?: number;
    sources?: string[];
    aclTags?: string[];
    tags?: string[];
    // Memory
    shortTermWindow?: number;
    longTermTopK?: number;
    episodicTopK?: number;
    // Prompt
    tokenBudget?: number;
    language?: "es" | "en";
    taskDescription?: string;
    systemInstructions?: string;
    // Privacy
    redactPII?: boolean;
    // Tracing
    enableTracing?: boolean;
}

export interface RAGResponse {
    prompt: ReturnType<typeof promptContextBuilder.buildPromptContext>;
    trace?: Record<string, unknown>;
    memoryResult?: { factsExtracted: number; factsStored: number };
}

/**
 * Full RAG pipeline: retrieve context + assemble memory + build prompt
 */
export async function executeRAGPipeline(options: RAGRequestOptions): Promise<RAGResponse> {
    const tracer = options.enableTracing ? new RequestTracer("rag_pipeline") : null;

    // 1. PII redaction on input
    let query = options.query;
    if (options.redactPII) {
        tracer?.startSpan("pii_redaction");
        const { redacted, piiTypes } = privacyService.redactPII(query);
        query = redacted;
        if (piiTypes.length > 0) {
            await privacyService.audit({
                tenantId: options.tenantId,
                userId: options.userId,
                action: "pii_redact",
                resourceType: "query",
                piiDetected: true,
                piiTypes,
            });
        }
        tracer?.endSpan();
    }

    // 2. Hybrid retrieval
    tracer?.startSpan("retrieval");
    const retrievalResult = await hybridRetriever.retrieve(query, {
        tenantId: options.tenantId,
        userId: options.userId,
        conversationId: options.conversationId,
        topK: options.topK ?? 5,
        sources: options.sources,
        aclTags: options.aclTags,
        tags: options.tags,
        enableReranker: true,
        enableQueryRewrite: true,
    });
    tracer?.endSpan();

    // 3. Memory context
    tracer?.startSpan("memory_context");
    const memoryOpts: MemoryServiceOptions = {
        tenantId: options.tenantId,
        userId: options.userId,
        conversationId: options.conversationId,
        shortTermWindow: options.shortTermWindow,
        longTermTopK: options.longTermTopK,
        episodicTopK: options.episodicTopK,
    };
    const memoryContext = await memoryService.getMemoryContext(query, options.chatId, memoryOpts);
    tracer?.endSpan();

    // 4. Build prompt with token budget
    tracer?.startSpan("prompt_build");
    const prompt = promptContextBuilder.buildPromptContext(
        query,
        retrievalResult.chunks,
        memoryContext.shortTerm,
        memoryContext.longTerm,
        memoryContext.episodic,
        {
            tokenBudget: options.tokenBudget ?? 8000,
            language: options.language ?? "es",
            taskDescription: options.taskDescription,
            systemInstructions: options.systemInstructions,
            includeAntiHallucination: true,
        },
    );
    tracer?.endSpan();

    // 5. Process turn for memory extraction (async, non-blocking)
    let memoryResult: { factsExtracted: number; factsStored: number } | undefined;
    if (memoryContext.shortTerm.messages.length > 0) {
        tracer?.startSpan("memory_extraction");
        try {
            memoryResult = await memoryService.processTurn(
                memoryContext.shortTerm.messages,
                memoryOpts,
            );
        } catch (error) {
            console.error("[RAG] Memory extraction error:", error);
        }
        tracer?.endSpan();
    }

    // 6. Audit
    await privacyService.audit({
        tenantId: options.tenantId,
        userId: options.userId,
        action: "retrieve",
        resourceType: "rag_pipeline",
        details: {
            query: query.slice(0, 200),
            chunksRetrieved: retrievalResult.chunks.length,
            memoriesUsed: memoryContext.longTerm.memories.length,
            tokenUsage: prompt.tokenUsage,
        },
        durationMs: tracer ? Date.now() - (tracer as any).rootSpan?.startMs : undefined,
    });

    return {
        prompt,
        trace: tracer?.finish() as unknown as Record<string, unknown>,
        memoryResult,
    };
}
