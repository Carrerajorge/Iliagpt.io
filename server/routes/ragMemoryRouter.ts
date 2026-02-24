/**
 * RAG + Persistent Memory API Router
 *
 * Exposes endpoints for the unified RAG pipeline, memory management,
 * privacy controls, and evaluation.
 */

import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/express";
import {
    ingestionPipeline,
    hybridRetriever,
    memoryService,
    promptContextBuilder,
    privacyService,
    evaluationHarness,
    executeRAGPipeline,
} from "../services/rag";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Helper: extract tenant + user
function getTenantUser(req: Request): { tenantId: string; userId: string } {
    const userId = (req as AuthenticatedRequest).user?.id || "anonymous";
    const tenantId = (req as any).tenantId || "default";
    return { tenantId, userId };
}

// =============================================================================
// 1. Ingestion
// =============================================================================

const ingestSchema = z.object({
    content: z.string().min(1),
    source: z.string().default("manual"),
    sourceId: z.string().optional(),
    title: z.string().optional(),
    mimeType: z.string().optional(),
    language: z.string().optional(),
    conversationId: z.string().optional(),
    threadId: z.string().optional(),
    tags: z.array(z.string()).optional(),
    aclTags: z.array(z.string()).optional(),
});

router.post("/ingest", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        const body = ingestSchema.parse(req.body);

        const result = await ingestionPipeline.ingest(
            {
                content: body.content,
                source: body.source,
                sourceId: body.sourceId,
                title: body.title,
                mimeType: body.mimeType,
                language: body.language,
            },
            {
                tenantId,
                userId,
                conversationId: body.conversationId,
                threadId: body.threadId,
                tags: body.tags,
                aclTags: body.aclTags,
            },
        );

        await privacyService.audit({
            tenantId, userId, action: "ingest", resourceType: "chunk",
            details: { chunksCreated: result.chunksCreated, source: body.source },
        });

        res.status(201).json({ success: true, ...result });
    } catch (error: any) {
        next(error);
    }
});

// =============================================================================
// 2. Retrieval
// =============================================================================

const retrieveSchema = z.object({
    query: z.string().min(1),
    topK: z.number().optional(),
    sources: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    aclTags: z.array(z.string()).optional(),
    conversationId: z.string().optional(),
    enableReranker: z.boolean().optional(),
    enableQueryRewrite: z.boolean().optional(),
});

router.post("/retrieve", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        const body = retrieveSchema.parse(req.body);

        const result = await hybridRetriever.retrieve(body.query, {
            tenantId,
            userId,
            conversationId: body.conversationId,
            topK: body.topK,
            sources: body.sources,
            tags: body.tags,
            aclTags: body.aclTags,
            enableReranker: body.enableReranker,
            enableQueryRewrite: body.enableQueryRewrite,
        });

        res.json({ success: true, ...result });
    } catch (error: any) {
        next(error);
    }
});

// =============================================================================
// 3. Full RAG Pipeline
// =============================================================================

const pipelineSchema = z.object({
    query: z.string().min(1),
    chatId: z.string().min(1),
    conversationId: z.string().optional(),
    topK: z.number().optional(),
    tokenBudget: z.number().optional(),
    language: z.enum(["es", "en"]).optional(),
    taskDescription: z.string().optional(),
    sources: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    redactPII: z.boolean().optional(),
    enableTracing: z.boolean().optional(),
});

router.post("/pipeline", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        const body = pipelineSchema.parse(req.body);

        const result = await executeRAGPipeline({
            tenantId,
            userId,
            chatId: body.chatId,
            conversationId: body.conversationId,
            query: body.query,
            topK: body.topK,
            tokenBudget: body.tokenBudget,
            language: body.language,
            taskDescription: body.taskDescription,
            sources: body.sources,
            tags: body.tags,
            redactPII: body.redactPII,
            enableTracing: body.enableTracing,
        });

        res.json({
            success: true,
            systemPrompt: result.prompt.systemPrompt,
            userPrompt: result.prompt.userPrompt,
            citations: result.prompt.citations,
            tokenUsage: result.prompt.tokenUsage,
            sectionsIncluded: result.prompt.sectionsIncluded,
            memoryResult: result.memoryResult,
            trace: result.trace,
        });
    } catch (error: any) {
        next(error);
    }
});

// =============================================================================
// 4. Memory Management
// =============================================================================

router.get("/memory", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        const query = (req.query.query as string) || "";
        const chatId = req.query.chatId as string;

        const context = await memoryService.getMemoryContext(query, chatId || "", {
            tenantId,
            userId,
            shortTermWindow: Number(req.query.shortTermWindow) || 20,
            longTermTopK: Number(req.query.longTermTopK) || 10,
            episodicTopK: Number(req.query.episodicTopK) || 3,
        });

        res.json({ success: true, ...context });
    } catch (error: any) {
        next(error);
    }
});

const storeMemorySchema = z.object({
    fact: z.string().min(1),
    category: z.enum(["preference", "fact", "objective", "instruction", "personality", "context"]),
    confidence: z.number().min(0).max(1).default(0.8),
    evidence: z.string().default("user_provided"),
    scope: z.enum(["global", "conversation", "topic"]).default("global"),
    conversationId: z.string().optional(),
    ttl: z.number().nullable().optional(),
});

router.post("/memory", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        const body = storeMemorySchema.parse(req.body);

        const result = await memoryService.storeMemory(
            {
                fact: body.fact,
                confidence: body.confidence,
                evidence: body.evidence,
                scope: body.scope,
                category: body.category,
                ttl: body.ttl,
            },
            { tenantId, userId, conversationId: body.conversationId },
        );

        await privacyService.audit({
            tenantId, userId, action: "memory_write", resourceType: "memory",
            resourceId: result?.id,
        });

        res.status(201).json({ success: true, memory: result });
    } catch (error: any) {
        next(error);
    }
});

// Episodic summary
const episodicSchema = z.object({
    conversationId: z.string().min(1),
    summary: z.string().min(1),
    mainTopics: z.array(z.string()).default([]),
    keyEntities: z.array(z.string()).default([]),
    keyDecisions: z.array(z.string()).default([]),
    sentiment: z.string().optional(),
    turnCount: z.number().default(0),
});

router.post("/memory/episodic", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        const body = episodicSchema.parse(req.body);

        const result = await memoryService.upsertEpisodicSummary(body, {
            tenantId,
            userId,
            conversationId: body.conversationId,
        });

        res.status(201).json({ success: true, episodic: result });
    } catch (error: any) {
        next(error);
    }
});

// KV Store
router.get("/kv/:namespace/:key", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        const value = await memoryService.kvGet(tenantId, userId, req.params.namespace, req.params.key);
        res.json({ success: true, value });
    } catch (error: any) {
        next(error);
    }
});

router.put("/kv/:namespace/:key", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        const { value, ttl } = req.body;
        await memoryService.kvSet(tenantId, userId, req.params.namespace, req.params.key, value, ttl);
        res.json({ success: true });
    } catch (error: any) {
        next(error);
    }
});

router.delete("/kv/:namespace/:key", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        await memoryService.kvDelete(tenantId, userId, req.params.namespace, req.params.key);
        res.status(204).send();
    } catch (error: any) {
        next(error);
    }
});

// =============================================================================
// 5. Privacy & Security
// =============================================================================

router.post("/privacy/redact", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: "text is required" });

        const result = privacyService.redactPII(text);
        res.json({ success: true, ...result });
    } catch (error: any) {
        next(error);
    }
});

router.post("/privacy/consent/:feature", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        await privacyService.grantConsent(tenantId, userId, req.params.feature);
        res.json({ success: true, feature: req.params.feature, granted: true });
    } catch (error: any) {
        next(error);
    }
});

router.delete("/privacy/consent/:feature", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        await privacyService.revokeConsent(tenantId, userId, req.params.feature);
        res.json({ success: true, feature: req.params.feature, granted: false });
    } catch (error: any) {
        next(error);
    }
});

router.get("/privacy/consent/:feature", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        const granted = await privacyService.hasConsent(tenantId, userId, req.params.feature);
        res.json({ success: true, feature: req.params.feature, granted });
    } catch (error: any) {
        next(error);
    }
});

router.delete("/privacy/data", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        const result = await privacyService.deleteUserData(tenantId, userId);
        res.json({ success: true, ...result });
    } catch (error: any) {
        next(error);
    }
});

// =============================================================================
// 6. Evaluation
// =============================================================================

router.get("/eval/history", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const runId = req.query.runId as string | undefined;
        const limit = Number(req.query.limit) || 20;
        const results = await evaluationHarness.getEvalHistory(runId, limit);
        res.json({ success: true, results });
    } catch (error: any) {
        next(error);
    }
});

const evalRunSchema = z.object({
    runId: z.string().min(1),
    testCases: z.array(
        z.object({
            id: z.string(),
            query: z.string(),
            expectedChunkIds: z.array(z.string()),
            expectedAnswer: z.string().optional(),
            tags: z.array(z.string()).optional(),
        }),
    ),
    k: z.number().default(5),
});

router.post("/eval/run", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { tenantId, userId } = getTenantUser(req);
        const body = evalRunSchema.parse(req.body);

        const retrieverFn = async (query: string) => {
            const result = await hybridRetriever.retrieve(query, {
                tenantId,
                userId,
                topK: body.k,
            });
            return {
                query,
                rewrittenQuery: result.rewrittenQuery,
                retrievedChunkIds: result.chunks.map((c) => c.id),
                scores: result.chunks.map((c) => c.score),
                latencyMs: result.processingTimeMs,
                totalCandidates: result.totalCandidates,
                config: { topK: body.k, tenantId, userId },
            };
        };

        const summary = await evaluationHarness.runEvaluation(
            body.runId,
            body.testCases,
            retrieverFn,
            body.k,
        );

        res.json({ success: true, summary });
    } catch (error: any) {
        next(error);
    }
});

const regressionSchema = z.object({
    currentRunId: z.string().min(1),
    baselineRunId: z.string().min(1),
    threshold: z.number().optional(),
});

router.post("/eval/regression", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const body = regressionSchema.parse(req.body);
        const result = await evaluationHarness.detectRegression(
            body.currentRunId,
            body.baselineRunId,
            body.threshold,
        );
        res.json({ success: true, ...result });
    } catch (error: any) {
        next(error);
    }
});

export default router;
