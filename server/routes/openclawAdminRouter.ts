/**
 * OpenClaw Admin Router — Token usage and conversation management for admin panel.
 * Mounts at /api/admin/openclaw/
 */

import { Router, type Request, type Response } from "express";
import { openclawTokenTracker } from "../services/openclawTokenTracker";
import { openclawConversationManager } from "../services/openclawConversationManager";

export function createOpenClawAdminRouter(): Router {
  const router = Router();

  // ── Token Usage (Admin) ──────────────────────────────────────────────────

  /** GET /api/admin/openclaw/tokens/stats — Platform-wide stats */
  router.get("/tokens/stats", (_req: Request, res: Response) => {
    res.json(openclawTokenTracker.getPlatformStats());
  });

  /** GET /api/admin/openclaw/tokens/users — All user summaries */
  router.get("/tokens/users", (_req: Request, res: Response) => {
    const summaries = openclawTokenTracker.getAllSummaries();
    res.json({ users: summaries, total: summaries.length });
  });

  /** GET /api/admin/openclaw/tokens/users/:userId — Specific user */
  router.get("/tokens/users/:userId", (req: Request, res: Response) => {
    const summary = openclawTokenTracker.getUserSummary(req.params.userId);
    if (!summary) return res.status(404).json({ error: "User not found" });
    res.json(summary);
  });

  /** GET /api/admin/openclaw/tokens/recent — Recent usage log */
  router.get("/tokens/recent", (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    res.json(openclawTokenTracker.getRecentUsage(limit));
  });

  /** POST /api/admin/openclaw/tokens/reset/:userId — Reset user counters */
  router.post("/tokens/reset/:userId", (req: Request, res: Response) => {
    openclawTokenTracker.resetUser(req.params.userId);
    res.json({ success: true, message: `Tokens reset for ${req.params.userId}` });
  });

  // ── Conversations (Admin) ────────────────────────────────────────────────

  /** GET /api/admin/openclaw/conversations — List all conversations */
  router.get("/conversations", (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (userId) {
      const convs = openclawConversationManager.listConversations(userId);
      return res.json({ conversations: convs, total: convs.length });
    }
    // No userId filter — admin can't list ALL conversations (privacy)
    res.json({ error: "Provide ?userId= to list conversations", conversations: [] });
  });

  /** GET /api/admin/openclaw/conversations/:id — Get specific conversation */
  router.get("/conversations/:id", (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId query param required" });
    const conv = openclawConversationManager.getConversation(req.params.id, userId);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    res.json(conv);
  });

  /** DELETE /api/admin/openclaw/conversations/:id — Delete conversation */
  router.delete("/conversations/:id", (req: Request, res: Response) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId query param required" });
    const deleted = openclawConversationManager.deleteConversation(req.params.id, userId);
    res.json({ success: deleted });
  });

  return router;
}

// ── User-facing routes (non-admin) ─────────────────────────────────────────

export function createOpenClawUserRouter(): Router {
  const router = Router();

  /** POST /api/openclaw/conversations — Create new conversation */
  router.post("/conversations", (req: Request, res: Response) => {
    const userId = (req as any).user?.id || req.headers["x-anonymous-user-id"] as string;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    const { title, model } = req.body || {};
    const conv = openclawConversationManager.createConversation(userId, title, model);
    res.json(conv);
  });

  /** GET /api/openclaw/conversations — List user's conversations */
  router.get("/conversations", (req: Request, res: Response) => {
    const userId = (req as any).user?.id || req.headers["x-anonymous-user-id"] as string;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    res.json(openclawConversationManager.listConversations(userId));
  });

  /** GET /api/openclaw/conversations/:id — Get conversation */
  router.get("/conversations/:id", (req: Request, res: Response) => {
    const userId = (req as any).user?.id || req.headers["x-anonymous-user-id"] as string;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    const conv = openclawConversationManager.getConversation(req.params.id, userId);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    res.json(conv);
  });

  /** POST /api/openclaw/conversations/:id/messages — Add message */
  router.post("/conversations/:id/messages", (req: Request, res: Response) => {
    const userId = (req as any).user?.id || req.headers["x-anonymous-user-id"] as string;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    const { role, content } = req.body || {};
    if (!role || !content) return res.status(400).json({ error: "role and content required" });
    const ok = openclawConversationManager.addMessage(req.params.id, userId, role, content);
    if (!ok) return res.status(404).json({ error: "Conversation not found or access denied" });
    res.json({ success: true });
  });

  /** GET /api/openclaw/tokens/me — Current user's token usage */
  router.get("/tokens/me", (req: Request, res: Response) => {
    const userId = (req as any).user?.id || req.headers["x-anonymous-user-id"] as string;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    const summary = openclawTokenTracker.getUserSummary(userId);
    res.json(summary || { userId, totalTokens: 0, estimatedCostUsd: 0 });
  });

  return router;
}
