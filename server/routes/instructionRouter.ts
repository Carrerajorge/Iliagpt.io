/**
 * Instruction Management API — CRUD + detection endpoints.
 *
 * Mount: app.use("/api/instructions", createInstructionRouter())
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { type AuthenticatedRequest, getUserId } from "../types/express";
import {
  createInstruction,
  updateInstruction,
  deleteInstruction,
  toggleInstructions,
  detectAndPersist,
} from "../memory/instructionManager";
import {
  getInstructions,
  hasActiveInstructions,
  buildInstructionContext,
  invalidateInstructionCache,
} from "../memory/instructionRetriever";
import { detectInstructions } from "../memory/instructionDetector";
import { createLogger } from "../utils/logger";

const log = createLogger("instruction-router");

export function createInstructionRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /** List all active instructions for the current user. */
  router.get("/", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const instructions = await getInstructions(userId);
      const hasActive = instructions.length > 0;

      res.json({ instructions, count: instructions.length, hasActive });
    } catch (err: any) {
      log.error("List instructions failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /** Check if user has any active instructions (fast cached check). */
  router.get("/status", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const hasActive = await hasActiveInstructions(userId);
      res.json({ hasActive });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Preview how instructions would be injected for a given query. */
  router.post("/preview", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { query, tokenBudget } = req.body;
      const context = await buildInstructionContext(userId, query, tokenBudget);
      res.json(context);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Create a new instruction manually. */
  router.post("/", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { text, scope, topic } = req.body;
      if (!text || typeof text !== "string" || text.trim().length < 3) {
        return res.status(400).json({ error: "text is required (min 3 chars)" });
      }

      const id = await createInstruction(userId, text.trim(), { scope, topic });
      res.status(201).json({ id, text: text.trim() });
    } catch (err: any) {
      log.error("Create instruction failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /** Detect instructions in a message (dry-run, doesn't persist). */
  router.post("/detect", async (req: Request, res: Response) => {
    try {
      const { message, useLLM } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }

      const result = await detectInstructions(message, useLLM !== false);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Detect and persist instructions from a message. */
  router.post("/process", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { message, conversationId } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }

      const result = await detectAndPersist(userId, message, conversationId);
      res.json(result);
    } catch (err: any) {
      log.error("Process instruction failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /** Update an instruction's text. */
  router.patch("/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { text } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "text is required" });
      }

      const updated = await updateInstruction(userId, req.params.id, text.trim());
      if (!updated) return res.status(404).json({ error: "Instruction not found" });
      res.json({ success: true });
    } catch (err: any) {
      log.error("Update instruction failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /** Delete (soft) an instruction. */
  router.delete("/:id", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const deleted = await deleteInstruction(userId, req.params.id);
      if (!deleted) return res.status(404).json({ error: "Instruction not found" });
      res.json({ success: true });
    } catch (err: any) {
      log.error("Delete instruction failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /** Bulk toggle instructions on/off. */
  router.post("/toggle", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { ids, active } = req.body;
      if (!Array.isArray(ids) || typeof active !== "boolean") {
        return res.status(400).json({ error: "ids (array) and active (boolean) required" });
      }

      const count = await toggleInstructions(userId, ids, active);
      res.json({ success: true, count });
    } catch (err: any) {
      log.error("Toggle instructions failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /** Clear all instructions for the current user. */
  router.delete("/", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const instructions = await getInstructions(userId);
      const ids = instructions.map((i) => i.id);
      const count = await toggleInstructions(userId, ids, false);
      res.json({ success: true, deactivated: count });
    } catch (err: any) {
      log.error("Clear instructions failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
