import express from "express";
import { db } from "../db";
import { sql, eq } from "drizzle-orm";

const router = express.Router();

// ===================================================================================
// FEEDBACK API - Collect user feedback on AI responses
// ===================================================================================

interface FeedbackPayload {
    messageId: string;
    conversationId?: string;
    feedbackType: "positive" | "negative";
    timestamp: string;
    comment?: string;
    userId?: string;
}

// In-memory store for now (can be replaced with database table later)
const feedbackStore: FeedbackPayload[] = [];

// POST /api/feedback - Submit feedback for a message
router.post("/", async (req, res) => {
    try {
        const { messageId, conversationId, feedbackType, timestamp, comment } = req.body as FeedbackPayload;

        if (!messageId || !feedbackType) {
            return res.status(400).json({
                error: "INVALID_PAYLOAD",
                message: "messageId and feedbackType are required"
            });
        }

        if (!["positive", "negative"].includes(feedbackType)) {
            return res.status(400).json({
                error: "INVALID_FEEDBACK_TYPE",
                message: "feedbackType must be 'positive' or 'negative'"
            });
        }

        const feedback: FeedbackPayload = {
            messageId,
            conversationId,
            feedbackType,
            timestamp: timestamp || new Date().toISOString(),
            comment,
            userId: (req as any).user?.claims?.sub
        };

        feedbackStore.push(feedback);

        console.log(`[Feedback] Received ${feedbackType} feedback for message ${messageId}`);

        // Store feedback in audit log for persistence
        try {
            const { storage } = await import("../storage");
            await storage.createAuditLog({
                userId: feedback.userId || 'anonymous',
                action: `feedback_${feedbackType}`,
                resource: 'messages',
                resourceId: messageId,
                details: { conversationId, comment, timestamp: feedback.timestamp }
            });
        } catch (dbError) {
            console.warn('[Feedback] Failed to persist to audit log:', dbError);
            // Continue - in-memory store still has the feedback
        }

        return res.status(200).json({
            success: true,
            message: "Feedback received",
            feedbackId: `fb_${Date.now()}`
        });

    } catch (error: any) {
        console.error("[Feedback] Error processing feedback:", error);
        return res.status(500).json({
            error: "INTERNAL_ERROR",
            message: "Failed to process feedback"
        });
    }
});

// GET /api/feedback/stats - Get feedback statistics (admin only)
router.get("/stats", async (req, res) => {
    try {
        const stats = {
            total: feedbackStore.length,
            positive: feedbackStore.filter(f => f.feedbackType === "positive").length,
            negative: feedbackStore.filter(f => f.feedbackType === "negative").length,
            positiveRate: feedbackStore.length > 0
                ? (feedbackStore.filter(f => f.feedbackType === "positive").length / feedbackStore.length * 100).toFixed(1)
                : 0,
            recent: feedbackStore.slice(-10).reverse()
        };

        return res.status(200).json(stats);

    } catch (error: any) {
        console.error("[Feedback] Error fetching stats:", error);
        return res.status(500).json({
            error: "INTERNAL_ERROR",
            message: "Failed to fetch feedback stats"
        });
    }
});

export default router;
