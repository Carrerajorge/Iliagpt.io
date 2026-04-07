/**
 * Memory Routes — CRUD + extraction for long-term user memories.
 */

import { Router, type Request, type Response } from "express";
import { longTermMemory } from "../memory/longTermMemory";
import { getUserId } from "../types/express";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { chatMessages } from "@shared/schema";

export function createMemoryRouter(): Router {
  const router = Router();

  // -----------------------------------------------------------------------
  // GET /api/memories — list the authenticated user's memories
  // -----------------------------------------------------------------------
  router.get("/memories", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    try {
      const category = typeof req.query.category === "string" ? req.query.category : undefined;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const memories = await longTermMemory.getUserMemories(userId, {
        category,
        limit,
        offset,
      });

      return res.json({ memories });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to list memories";
      return res.status(500).json({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /api/memories/:id — soft-delete a memory
  // -----------------------------------------------------------------------
  router.delete("/memories/:id", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Memory ID is required" });

    try {
      const deleted = await longTermMemory.deleteMemory(id, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Memory not found" });
      }
      return res.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to delete memory";
      return res.status(500).json({ error: message });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/memories/extract — manually trigger fact extraction
  // -----------------------------------------------------------------------
  router.post("/memories/extract", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const { conversationId } = req.body ?? {};
    if (!conversationId || typeof conversationId !== "string") {
      return res.status(400).json({ error: "conversationId is required" });
    }

    try {
      // Fetch conversation messages from DB
      const dbMessages = await db
        .select({
          role: chatMessages.role,
          content: chatMessages.content,
        })
        .from(chatMessages)
        .where(eq(chatMessages.chatId, conversationId))
        .orderBy(chatMessages.createdAt);

      if (dbMessages.length === 0) {
        return res.status(404).json({ error: "No messages found for this conversation" });
      }

      const conversationMessages = dbMessages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));

      const facts = await longTermMemory.extractFacts(conversationMessages, userId);
      await longTermMemory.storeFacts(userId, facts, conversationId);

      return res.json({
        extracted: facts.length,
        stored: facts.length,
        facts,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to extract memories";
      return res.status(500).json({ error: message });
    }
  });

  return router;
}
