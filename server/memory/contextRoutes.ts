/**
 * Context Validation API Routes
 * 
 * Provides endpoints for context health checks and client-server sync validation.
 */

import { Router, Request, Response } from "express";
import { contextOrchestrator } from "./ContextOrchestrator";

const router = Router();

/**
 * GET /api/context/:chatId/validate
 * 
 * Validate client context against server-side truth
 */
router.get("/:chatId/validate", async (req: Request, res: Response) => {
    try {
        const { chatId } = req.params;
        const clientMessages = req.body?.messages || [];

        // Initialize orchestrator if needed
        await contextOrchestrator.initialize();

        const validation = await contextOrchestrator.validateContext(chatId, clientMessages);

        res.json({
            valid: validation.valid,
            server_message_count: validation.serverMessageCount,
            client_message_count: validation.clientMessageCount,
            missing_ids: validation.missingIds,
            sync_required: validation.syncRequired
        });
    } catch (error: any) {
        console.error("[ContextAPI] Validation error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/context/:chatId/health
 * 
 * Get context health metrics for a conversation
 */
router.get("/:chatId/health", async (req: Request, res: Response) => {
    try {
        const { chatId } = req.params;

        await contextOrchestrator.initialize();

        const context = await contextOrchestrator.getContext(chatId, []);
        const metrics = contextOrchestrator.getMetrics();

        res.json({
            chat_id: chatId,
            message_count: context.messages.length,
            token_count: context.tokenCount,
            entity_count: context.entities.length,
            cache_level: context.cacheLevel,
            latency_ms: context.latencyMs,
            cache_metrics: {
                hit_rate: metrics.hitRate,
                l0_hits: metrics.l0Hits,
                l1_hits: metrics.l1Hits,
                db_fetches: metrics.dbFetches,
                avg_latency_ms: metrics.avgLatencyMs
            },
            entities: context.entities.slice(0, 10) // Top 10 entities
        });
    } catch (error: any) {
        console.error("[ContextAPI] Health check error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/context/metrics
 * 
 * Get global context orchestrator metrics
 */
router.get("/metrics", async (req: Request, res: Response) => {
    try {
        await contextOrchestrator.initialize();
        const metrics = contextOrchestrator.getMetrics();

        res.json({
            cache_size: metrics.cacheSize,
            hit_rate: metrics.hitRate,
            l0_hits: metrics.l0Hits,
            l0_misses: metrics.l0Misses,
            l1_hits: metrics.l1Hits,
            l1_misses: metrics.l1Misses,
            db_fetches: metrics.dbFetches,
            avg_latency_ms: metrics.avgLatencyMs,
            compression_ratio: metrics.compressionRatio
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/context/:chatId/invalidate
 * 
 * Force invalidate context cache for a conversation
 */
router.post("/:chatId/invalidate", async (req: Request, res: Response) => {
    try {
        const { chatId } = req.params;

        await contextOrchestrator.initialize();
        await contextOrchestrator.invalidateContext(chatId);

        res.json({ success: true, chat_id: chatId, message: "Context cache invalidated" });
    } catch (error: any) {
        console.error("[ContextAPI] Invalidation error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/context/:chatId/sync
 * 
 * Sync client with server context (returns full context)
 */
router.post("/:chatId/sync", async (req: Request, res: Response) => {
    try {
        const { chatId } = req.params;
        const { force_refresh = false } = req.body;

        await contextOrchestrator.initialize();

        const context = await contextOrchestrator.getContext(chatId, [], {
            forceRefresh: force_refresh
        });

        res.json({
            chat_id: chatId,
            messages: context.messages,
            entities: context.entities,
            token_count: context.tokenCount,
            cache_level: context.cacheLevel
        });
    } catch (error: any) {
        console.error("[ContextAPI] Sync error:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
