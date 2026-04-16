import { Router, Request, Response } from "express";
import { presenceManager } from "../realtime/presence";
import { requireAuth } from "../middleware/auth";
import { getSecureUserId } from "../lib/anonUserHelper";

const router = Router();

// GET /api/presence/online - List online users
router.get("/online", requireAuth, (_req: Request, res: Response) => {
  res.json(presenceManager.getOnlineUsers());
});

// GET /api/presence/chat/:chatId - Who's viewing this chat + who's typing
router.get("/chat/:chatId", requireAuth, (req: Request, res: Response) => {
  const { chatId } = req.params;
  res.json({
    viewers: presenceManager.getChatViewers(chatId),
    typing: presenceManager.getTypingUsers(chatId),
  });
});

// POST /api/presence/heartbeat
router.post("/heartbeat", requireAuth, (req: Request, res: Response) => {
  const userId = getSecureUserId(req) || "anonymous";
  presenceManager.heartbeat(userId);
  res.json({ ok: true });
});

// POST /api/presence/typing
router.post("/typing", requireAuth, (req: Request, res: Response) => {
  const userId = getSecureUserId(req) || "anonymous";
  const { chatId, isTyping } = req.body;
  if (isTyping) {
    presenceManager.startTyping(userId, chatId);
  } else {
    presenceManager.stopTyping(userId);
  }
  res.json({ ok: true });
});

// POST /api/presence/focus
router.post("/focus", requireAuth, (req: Request, res: Response) => {
  const userId = getSecureUserId(req) || "anonymous";
  const { chatId } = req.body;
  presenceManager.focusChat(userId, chatId);
  res.json({ ok: true });
});

export default router;
