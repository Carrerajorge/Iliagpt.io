import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { db } from "../db";
import { chatMessages, chats } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { optionalAuth } from "../middleware/auth";

const messageSendSchema = z.object({
  clientMessageId: z.string().min(1),
  conversationId: z.string().nullable().optional(),
  text: z.string().min(1),
  attachments: z.array(z.object({
    id: z.string(),
    name: z.string(),
    mimeType: z.string(),
    size: z.number(),
    storagePath: z.string().optional(),
  })).optional(),
  requestId: z.string().optional(),
});

const pendingMessages = new Map<string, {
  clientMessageId: string;
  conversationId: string | null;
  text: string;
  attachments: any[];
  serverMessageId: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "accepted";
}>();

const PENDING_TTL_MS = 60 * 1000;
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingMessages.entries()) {
    if (value.expiresAt < now) {
      pendingMessages.delete(key);
    }
  }
}, 30000);
cleanupInterval.unref?.();

function getPendingKey(userId: string, clientMessageId: string): string {
  return `${userId}:${clientMessageId}`;
}

export const messageLifecycleRouter = Router();

function buildAcceptedResponse(serverMessageId: string, conversationId: string | null, dedupeHit: boolean) {
  return {
    accepted: true,
    id: serverMessageId,
    serverMessageId,
    streamId: serverMessageId,
    chatId: conversationId,
    conversationId,
    dedupeHit,
  };
}

async function handleSendMessage(req: Request, res: Response) {
  try {
    const parseResult = messageSendSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        accepted: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.errors[0]?.message || "Invalid request",
          retryable: false,
        },
      });
    }

    const { clientMessageId, conversationId, text, attachments, requestId } = parseResult.data;
    const userId = (req as any).user?.id || (req as any).session?.userId || "anonymous";
    const pendingKey = getPendingKey(userId, clientMessageId);

    const existing = pendingMessages.get(pendingKey);
    if (existing) {
      return res.json(buildAcceptedResponse(existing.serverMessageId, existing.conversationId, true));
    }

    const serverMessageId = randomUUID();
    const effectiveConversationId = conversationId || randomUUID();

    pendingMessages.set(pendingKey, {
      clientMessageId,
      conversationId: effectiveConversationId,
      text,
      attachments: attachments || [],
      serverMessageId,
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_TTL_MS,
      status: "pending",
    });

    let chatExists = false;
    if (conversationId) {
      const [existingChat] = await db.select().from(chats).where(eq(chats.id, conversationId)).limit(1);
      chatExists = !!existingChat;
    }

    if (!chatExists) {
      await db.insert(chats).values({
        id: effectiveConversationId,
        userId,
        title: text.slice(0, 60) || "Nueva conversación",
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoNothing();
    }

    await db.insert(chatMessages).values({
      id: serverMessageId,
      chatId: effectiveConversationId,
      role: "user",
      content: text,
      status: "pending",
      requestId: requestId || randomUUID(),
      attachments: attachments || null,
      createdAt: new Date(),
    });

    pendingMessages.set(pendingKey, {
      ...pendingMessages.get(pendingKey)!,
      status: "accepted",
    });

    return res.json(buildAcceptedResponse(serverMessageId, effectiveConversationId, false));
  } catch (error: any) {
    console.error("[MessageLifecycle] Error in /send:", error);
    return res.status(500).json({
      accepted: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error?.message || "Internal server error",
        retryable: true,
      },
    });
  }
}

messageLifecycleRouter.post("/", optionalAuth, handleSendMessage);
messageLifecycleRouter.post("/send", optionalAuth, handleSendMessage);

messageLifecycleRouter.get("/status/:clientMessageId", optionalAuth, async (req, res) => {
  try {
    const { clientMessageId } = req.params;
    const userId = (req as any).user?.id || (req as any).session?.userId || "anonymous";
    const pendingKey = getPendingKey(userId, clientMessageId);

    const pending = pendingMessages.get(pendingKey);
    if (pending) {
      return res.json({
        found: true,
        status: pending.status,
        serverMessageId: pending.serverMessageId,
        conversationId: pending.conversationId,
      });
    }

    return res.json({ found: false });
  } catch (error: any) {
    console.error("[MessageLifecycle] Error in /status:", error);
    return res.status(500).json({ error: error?.message || "Internal error" });
  }
});

messageLifecycleRouter.delete("/pending/:clientMessageId", optionalAuth, async (req, res) => {
  try {
    const { clientMessageId } = req.params;
    const userId = (req as any).user?.id || (req as any).session?.userId || "anonymous";
    const pendingKey = getPendingKey(userId, clientMessageId);

    const deleted = pendingMessages.delete(pendingKey);
    return res.json({ deleted });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message });
  }
});

export function getPendingMessage(userId: string, clientMessageId: string) {
  return pendingMessages.get(getPendingKey(userId, clientMessageId));
}

export function acceptPendingMessage(userId: string, clientMessageId: string) {
  const key = getPendingKey(userId, clientMessageId);
  const pending = pendingMessages.get(key);
  if (pending) {
    pending.status = "accepted";
    pendingMessages.set(key, pending);
  }
  return pending;
}
