import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getUserMemories, deleteMemory, extractFacts, storeFacts } from "../memory/longTermMemory";
import { getSecureUserId } from "../lib/anonUserHelper";
import { createLogger } from "../utils/logger";
import { db } from "../db";
import { chatMessages } from "@shared/schema";
import { eq } from "drizzle-orm";

const log = createLogger("memory-api");
const router = Router();

/**
 * GET /api/memories - List user's long-term memories
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = getSecureUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const memories = await getUserMemories(String(userId), { category, limit, offset });

    res.json({ memories, count: memories.length });
  } catch (err) {
    log.error("Failed to list memories", { error: err });
    res.status(500).json({ error: "Failed to retrieve memories" });
  }
});

/**
 * DELETE /api/memories/:id - Delete a specific memory
 */
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = getSecureUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const deleted = await deleteMemory(id, String(userId));

    if (!deleted) {
      return res.status(404).json({ error: "Memory not found" });
    }

    res.json({ success: true });
  } catch (err) {
    log.error("Failed to delete memory", { error: err });
    res.status(500).json({ error: "Failed to delete memory" });
  }
});

/**
 * POST /api/memories/extract - Extract facts from a conversation
 */
router.post("/extract", requireAuth, async (req, res) => {
  try {
    const userId = getSecureUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { chatId } = req.body;
    if (!chatId) {
      return res.status(400).json({ error: "chatId is required" });
    }

    const messages = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId));

    if (!messages.length) {
      return res.json({ facts: [], stored: 0 });
    }

    const facts = await extractFacts(
      messages.map((m) => ({ role: m.role, content: m.content || "" })),
      String(userId),
    );

    await storeFacts(String(userId), facts, chatId);

    res.json({ facts, stored: facts.length });
  } catch (err) {
    log.error("Failed to extract memories", { error: err });
    res.status(500).json({ error: "Failed to extract memories" });
  }
});

export default router;
