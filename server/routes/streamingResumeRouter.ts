/**
 * Streaming Resume Router - ILIAGPT PRO 3.0
 * 
 * API endpoints for streaming reconnection support.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import {
    getLastSeq,
    saveStreamingProgress,
    getStreamingProgress,
    clearStreamingProgress,
    getActiveStreamingSessions,
} from "../lib/streamingSeq";

const router = Router();

// Schema for saving progress
const SaveProgressSchema = z.object({
    chatId: z.string().min(1),
    lastSeq: z.number().int().min(0),
    content: z.string(),
    status: z.enum(["streaming", "completed", "failed"]),
});

/**
 * GET /api/streaming/seq/:chatId
 * Get the last processed sequence number for a chat
 */
router.get("/seq/:chatId", async (req: Request, res: Response) => {
    const { chatId } = req.params;

    try {
        const lastSeq = await getLastSeq(chatId);
        return res.json({ chatId, lastSeq });
    } catch (error) {
        console.error("[StreamingResume] Error getting seq:", error);
        return res.status(500).json({ error: "Failed to get sequence" });
    }
});

/**
 * GET /api/streaming/progress/:chatId
 * Get full streaming progress (for resume)
 */
router.get("/progress/:chatId", async (req: Request, res: Response) => {
    const { chatId } = req.params;

    try {
        const progress = await getStreamingProgress(chatId);

        if (!progress) {
            return res.status(404).json({ error: "No streaming progress found" });
        }

        return res.json(progress);
    } catch (error) {
        console.error("[StreamingResume] Error getting progress:", error);
        return res.status(500).json({ error: "Failed to get progress" });
    }
});

/**
 * POST /api/streaming/progress
 * Save streaming progress
 */
router.post("/progress", async (req: Request, res: Response) => {
    try {
        const validation = SaveProgressSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({ error: validation.error.message });
        }

        const { chatId, lastSeq, content, status } = validation.data;

        await saveStreamingProgress(chatId, lastSeq, content, status);

        return res.json({ success: true, chatId, lastSeq });
    } catch (error) {
        console.error("[StreamingResume] Error saving progress:", error);
        return res.status(500).json({ error: "Failed to save progress" });
    }
});

/**
 * DELETE /api/streaming/progress/:chatId
 * Clear streaming progress when done
 */
router.delete("/progress/:chatId", async (req: Request, res: Response) => {
    const { chatId } = req.params;

    try {
        await clearStreamingProgress(chatId);
        return res.json({ success: true, chatId });
    } catch (error) {
        console.error("[StreamingResume] Error clearing progress:", error);
        return res.status(500).json({ error: "Failed to clear progress" });
    }
});

/**
 * GET /api/streaming/active
 * List all active streaming sessions (for debugging)
 */
router.get("/active", async (_req: Request, res: Response) => {
    try {
        const sessions = await getActiveStreamingSessions();
        return res.json({ sessions, count: sessions.length });
    } catch (error) {
        console.error("[StreamingResume] Error getting active sessions:", error);
        return res.status(500).json({ error: "Failed to get active sessions" });
    }
});

export default router;
