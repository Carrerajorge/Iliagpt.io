/**
 * Semantic Memory API Routes
 * 
 * Provides endpoints for semantic memory search and management.
 * Uses embeddings for similarity-based memory retrieval.
 */

import { Router, Request, Response } from "express";
import { semanticMemoryStore } from "./SemanticMemoryStore";

const router = Router();

/**
 * POST /api/memory/search
 * 
 * Semantic search through user memories
 */
router.post("/search", async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const {
            query,
            limit = 10,
            min_score,
            threshold,
            types,
            hybrid = true
        } = req.body;

        const minScore = min_score ?? threshold ?? 0.3;

        if (!query || typeof query !== "string") {
            return res.status(400).json({ error: "Query string required" });
        }

        await semanticMemoryStore.initialize();

        const results = await semanticMemoryStore.search(userId, query, {
            limit,
            minScore,
            types,
            hybridSearch: hybrid
        });

        res.json({
            query,
            results: results.map(r => ({
                id: r.chunk.id,
                content: r.chunk.content,
                type: r.chunk.type,
                score: Math.round(r.score * 1000) / 1000,
                match_type: r.matchType,
                metadata: {
                    source: r.chunk.metadata.source,
                    created_at: r.chunk.metadata.createdAt,
                    confidence: Math.round(r.chunk.metadata.confidence * 100)
                }
            })),
            count: results.length
        });
    } catch (error: any) {
        console.error("[MemoryAPI] Search error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/memory/remember
 * 
 * Store a new memory with semantic embedding
 */
router.post("/remember", async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const {
            content,
            type = "note",
            source = "explicit",
            confidence = 0.8,
            tags
        } = req.body;

        if (!content || typeof content !== "string") {
            return res.status(400).json({ error: "Content string required" });
        }

        if (!["fact", "preference", "conversation", "instruction", "note"].includes(type)) {
            return res.status(400).json({ 
                error: "Invalid type. Must be: fact, preference, conversation, instruction, or note" 
            });
        }

        await semanticMemoryStore.initialize();

        const memory = await semanticMemoryStore.remember(userId, content, type, {
            source,
            confidence,
            tags
        });

        res.json({
            success: true,
            memory: {
                id: memory.id,
                content: memory.content,
                type: memory.type,
                metadata: memory.metadata
            }
        });
    } catch (error: any) {
        console.error("[MemoryAPI] Remember error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/memory/recall
 * 
 * Get all memories for the current user
 */
router.get("/recall", async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const {
            types,
            limit = "50",
            sort_by = "recent"
        } = req.query as Record<string, string>;

        await semanticMemoryStore.initialize();

        const memories = await semanticMemoryStore.recall(userId, {
            types: types ? types.split(",") as any[] : undefined,
            limit: parseInt(limit, 10) || 50,
            sortBy: sort_by as any
        });

        res.json({
            memories: memories.map(m => ({
                id: m.id,
                content: m.content,
                type: m.type,
                metadata: {
                    ...m.metadata,
                    confidence: Math.round(m.metadata.confidence * 100),
                }
            })),
            count: memories.length
        });
    } catch (error: any) {
        console.error("[MemoryAPI] Recall error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/memory/:memoryId
 * 
 * Delete a specific memory
 */
router.delete("/:memoryId", async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const { memoryId } = req.params;

        await semanticMemoryStore.initialize();
        const deleted = await semanticMemoryStore.forget(userId, memoryId);

        if (deleted) {
            res.json({ success: true, deleted_id: memoryId });
        } else {
            res.status(404).json({ error: "Memory not found" });
        }
    } catch (error: any) {
        console.error("[MemoryAPI] Delete error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/memory/stats
 * 
 * Get memory statistics for the current user
 */
router.get("/stats", async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        await semanticMemoryStore.initialize();
        const stats = await semanticMemoryStore.getStats(userId);

        res.json(stats);
    } catch (error: any) {
        console.error("[MemoryAPI] Stats error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/memory/extract
 * 
 * Extract memories from a conversation
 */
router.post("/extract", async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const { messages } = req.body;

        if (!Array.isArray(messages)) {
            return res.status(400).json({ error: "Messages array required" });
        }

        await semanticMemoryStore.initialize();
        const extracted = await semanticMemoryStore.extractFromConversation(userId, messages);

        res.json({
            success: true,
            extracted_count: extracted
        });
    } catch (error: any) {
        console.error("[MemoryAPI] Extract error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/memory/context
 * 
 * Build relevant context from memory based on a query
 */
router.post("/context", async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const { query, max_tokens = 500 } = req.body;

        if (!query || typeof query !== "string") {
            return res.status(400).json({ error: "Query string required" });
        }

        await semanticMemoryStore.initialize();
        const context = await semanticMemoryStore.buildContextFromQuery(userId, query, max_tokens);

        res.json({
            context: context || "",
            has_relevant_memory: context !== null
        });
    } catch (error: any) {
        console.error("[MemoryAPI] Context error:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
