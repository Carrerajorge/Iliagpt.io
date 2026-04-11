/**
 * OpenClaw Admin Router — Token usage and conversation management for admin panel.
 * Mounts at /api/admin/openclaw/
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { openclawTokenLedger, users } from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";
import { openclawConversationManager } from "../services/openclawConversationManager";
import { usageQuotaService } from "../services/usageQuotaService";

async function buildUserQuotaSummary(userId: string) {
  const quota = await usageQuotaService.getUnifiedQuotaSnapshot(userId);
  return {
    userId,
    totalInputTokens: quota.daily.inputUsed,
    totalOutputTokens: quota.daily.outputUsed,
    totalTokens: quota.channels.openclawUsed,
    totalConsumed: quota.channels.totalConsumed,
    sharedMonthlyUsed: quota.monthly.used,
    sharedMonthlyLimit: quota.monthly.limit,
    estimatedCostUsd: 0,
    conversationCount: 0,
    lastActivity: quota.monthly.resetAt,
    blockingState: quota.blockingState,
    byModel: {},
    byFeature: {},
    quota,
  };
}

export function createOpenClawAdminRouter(): Router {
  const router = Router();

  // ── Token Usage (Admin) ──────────────────────────────────────────────────

  /** GET /api/admin/openclaw/tokens/stats — Platform-wide stats */
  router.get("/tokens/stats", async (_req: Request, res: Response) => {
    const [row] = await db
      .select({
        totalTokens: sql<number>`COALESCE(SUM(${users.openclawTokensConsumed}), 0)`,
        totalConsumed: sql<number>`COALESCE(SUM(${users.tokensConsumed}), 0)`,
        activeUsers: sql<number>`COALESCE(COUNT(*) FILTER (WHERE ${users.openclawTokensConsumed} > 0), 0)`,
      })
      .from(users);

    res.json({
      totalTokens: Number(row?.totalTokens || 0),
      totalConsumed: Number(row?.totalConsumed || 0),
      totalCostUsd: 0,
      activeUsers: Number(row?.activeUsers || 0),
      totalConversations: 0,
      unified: true,
    });
  });

  /** GET /api/admin/openclaw/tokens/users — All user summaries */
  router.get("/tokens/users", async (_req: Request, res: Response) => {
    const rows = await db
      .select({
        id: users.id,
      })
      .from(users)
      .where(sql`${users.openclawTokensConsumed} > 0`)
      .orderBy(desc(users.openclawTokensConsumed))
      .limit(200);

    const summaries = await Promise.all(rows.map((row) => buildUserQuotaSummary(row.id)));
    res.json({ users: summaries, total: summaries.length });
  });

  /** GET /api/admin/openclaw/tokens/users/:userId — Specific user */
  router.get("/tokens/users/:userId", async (req: Request, res: Response) => {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, req.params.userId))
      .limit(1);
    if (!user) return res.status(404).json({ error: "User not found" });
    const summary = await buildUserQuotaSummary(req.params.userId);
    res.json(summary);
  });

  /** GET /api/admin/openclaw/tokens/recent — Recent usage log */
  router.get("/tokens/recent", async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const rows = await db
      .select()
      .from(openclawTokenLedger)
      .orderBy(desc(openclawTokenLedger.createdAt))
      .limit(limit);
    res.json(rows);
  });

  /** POST /api/admin/openclaw/tokens/reset/:userId — Reset user counters */
  router.post("/tokens/reset/:userId", async (req: Request, res: Response) => {
    await db
      .update(users)
      .set({ openclawTokensConsumed: 0, updatedAt: new Date() })
      .where(eq(users.id, req.params.userId));
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
  router.get("/tokens/me", async (req: Request, res: Response) => {
    const userId = (req as any).user?.id || req.headers["x-anonymous-user-id"] as string;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    const summary = await buildUserQuotaSummary(userId);
    res.json(summary);
  });

  return router;
}
