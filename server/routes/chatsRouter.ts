import { Router } from "express";
import express from "express";
import { storage } from "../storage";
import { performance } from "perf_hooks";
import { sendShareNotificationEmail } from "../services/emailService";
import { getSecureUserId, getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { sanitizeMessageContent } from "../lib/markdownSanitizer";
import { isTitlePlaceholder } from "../lib/chatTitleGenerator";
import {
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENT_SIZE_BYTES,
} from "@shared/chatLimits";
import { buildAssistantMessage, buildAssistantMessageMetadata } from "@shared/assistantMessage";

// Higher body limit middleware for message creation endpoints.
// The global limit is 1MB, but messages with attachment metadata can be larger.
// Actual file data is uploaded separately via presigned URLs, so this only
// covers JSON metadata (storagePath, fileId, etc.) — typically well under 5MB.
const messageBodyLimit = express.json({ limit: '100mb' });

function deduplicateAssistantMessages<T extends { role: string; userMessageId?: string | null; content?: string | null; createdAt?: Date | string | null }>(messages: T[]): T[] {
  const seenAssistantForUser = new Map<string, number>();
  const result: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.userMessageId) {
      const key = msg.userMessageId;
      if (seenAssistantForUser.has(key)) {
        const existingIdx = seenAssistantForUser.get(key)!;
        const existing = result[existingIdx];
        const existingLen = (existing?.content || '').length;
        const currentLen = (msg.content || '').length;
        if (currentLen > existingLen) {
          result[existingIdx] = msg;
        }
        continue;
      }
      seenAssistantForUser.set(key, result.length);
    }
    result.push(msg);
  }
  return result;
}

// SECURITY FIX #44: Message content length limits
const MAX_MESSAGE_LENGTH = 5000000; // 5MB max message for 1M context window
const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGES_PER_CREATE = 100;
const MAX_ATTACHMENTS_PER_MESSAGE = MAX_CHAT_ATTACHMENTS;
const MAX_ATTACHMENT_SIZE_BYTES = MAX_CHAT_ATTACHMENT_SIZE_BYTES;
const MAX_ATTACHMENT_NAME_LENGTH = 200;
const MAX_SHARE_PARTICIPANTS = 50;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_SHARE_ROLE_LENGTH = 20;
const MAX_VALIDATED_MESSAGE_IDS = 300;
const MAX_ARTIFACT_URL_LENGTH = 2048;
const MAX_ARTIFACT_NAME_LENGTH = 255;
const ALLOWED_MESSAGE_ROLES = new Set(["user", "assistant", "system"]);
const ALLOWED_SHARE_ROLES = new Set(["viewer", "editor"]);
const ALLOWED_ARTIFACT_TYPES = new Set(["image", "document", "spreadsheet", "presentation", "pdf"]);
const CHAT_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,120}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SECURITY FIX #45: Validate and sanitize message content
function validateMessageContent(content: any): { valid: boolean; error?: string; sanitized?: string } {
  if (typeof content !== 'string') {
    return { valid: false, error: 'Content must be a string' };
  }
  if (content.length > MAX_MESSAGE_LENGTH) {
    return { valid: false, error: `Content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` };
  }
  // Remove null bytes which can cause issues
  const sanitized = content.replace(/\0/g, '');
  return { valid: true, sanitized };
}

function sanitizeChatTitle(title: unknown): string | undefined {
  if (typeof title !== 'string') return undefined;
  return title.trim().slice(0, MAX_TITLE_LENGTH);
}

function validateMessageRole(role: unknown): role is "user" | "assistant" | "system" {
  return typeof role === 'string' && ALLOWED_MESSAGE_ROLES.has(role.toLowerCase());
}

function normalizeRenderableMessageContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function isRecentAssistantDuplicate(
  message: { role?: string | null; content?: string | null; createdAt?: Date | string | null } | null | undefined,
  normalizedContent: string,
): boolean {
  if (!message || message.role !== "assistant") return false;
  if (!normalizedContent) return false;

  const candidateContent = normalizeRenderableMessageContent(String(message.content || ""));
  if (!candidateContent || candidateContent !== normalizedContent) return false;

  const createdAtMs = message.createdAt ? new Date(message.createdAt).getTime() : Number.NaN;
  if (!Number.isFinite(createdAtMs)) return true;

  return Math.abs(Date.now() - createdAtMs) <= 10 * 60 * 1000;
}

function normalizeRole(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseShareRole(role: unknown): string | undefined {
  const normalized = normalizeRole(role);
  if (!normalized || normalized.length > MAX_SHARE_ROLE_LENGTH) return undefined;
  return ALLOWED_SHARE_ROLES.has(normalized) ? normalized : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function sanitizeAndValidateAttachment(att: any) {
  if (!att || typeof att !== 'object') return null;
  const name = typeof att.name === 'string' ? att.name.trim().slice(0, MAX_ATTACHMENT_NAME_LENGTH) : '';
  const fileId = typeof att.fileId === 'string' ? att.fileId.trim() : '';
  const type = typeof att.type === 'string' ? att.type.trim() : '';
  if (!name || !type) return null;

  const storagePath = typeof att.storagePath === 'string' ? att.storagePath.trim() : '';
  if (storagePath && !storagePath.startsWith('/objects/')) {
    return null;
  }

  const size = Number.isFinite(Number(att.size)) ? Number(att.size) : undefined;
  if (size !== undefined && (size < 0 || size > MAX_ATTACHMENT_SIZE_BYTES)) {
    return null;
  }

  const clean: Record<string, any> = {
    id: fileId || undefined,
    fileId,
    name,
    type,
    mimeType: typeof att.mimeType === 'string' ? att.mimeType.trim() : type,
    size,
    storagePath: storagePath || null
  };

  if (att.spreadsheetData && typeof att.spreadsheetData === 'object') {
    clean.spreadsheetData = {
      uploadId: typeof att.spreadsheetData.uploadId === 'string' ? att.spreadsheetData.uploadId : undefined,
      sheets: typeof att.spreadsheetData.sheets === 'number' ? att.spreadsheetData.sheets : undefined,
      analysisId: typeof att.spreadsheetData.analysisId === 'string' ? att.spreadsheetData.analysisId : undefined,
      sessionId: typeof att.spreadsheetData.sessionId === 'string' ? att.spreadsheetData.sessionId : undefined
    };
  }

  return clean;
}

function sanitizeArtifactUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_ARTIFACT_URL_LENGTH) return undefined;
  if (normalized.startsWith("/")) return normalized;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function sanitizeAssistantArtifact(rawArtifact: any) {
  if (!rawArtifact || typeof rawArtifact !== "object") return null;

  const artifactId = typeof rawArtifact.artifactId === "string" ? rawArtifact.artifactId.trim().slice(0, MAX_REQUEST_ID_LENGTH) : "";
  const artifactType = typeof rawArtifact.type === "string" ? rawArtifact.type.trim().toLowerCase() : "";
  const mimeType = typeof rawArtifact.mimeType === "string" ? rawArtifact.mimeType.trim().slice(0, 160) : "";
  const downloadUrl = sanitizeArtifactUrl(rawArtifact.downloadUrl);
  const previewUrl = sanitizeArtifactUrl(rawArtifact.previewUrl);
  const contentUrl = sanitizeArtifactUrl(rawArtifact.contentUrl);
  const filename = typeof rawArtifact.filename === "string" ? rawArtifact.filename.trim().slice(0, MAX_ARTIFACT_NAME_LENGTH) : "";
  const name = typeof rawArtifact.name === "string" ? rawArtifact.name.trim().slice(0, MAX_ARTIFACT_NAME_LENGTH) : "";
  const sizeBytes = Number.isFinite(Number(rawArtifact.sizeBytes)) ? Number(rawArtifact.sizeBytes) : undefined;

  if (!artifactId || !ALLOWED_ARTIFACT_TYPES.has(artifactType) || !mimeType || !downloadUrl) {
    return null;
  }

  return {
    artifactId,
    type: artifactType,
    mimeType,
    sizeBytes: sizeBytes !== undefined && sizeBytes >= 0 ? sizeBytes : undefined,
    downloadUrl,
    previewUrl,
    contentUrl,
    filename: filename || undefined,
    name: name || undefined,
  };
}

export function createChatsRouter() {
  const router = Router();

  router.get("/chats", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);
      if (!userId) {
        return res.json([]);
      }

      // Hide archived and deleted chats from the main list; they are managed via dedicated endpoints.
      // OPTIMIZATION: Use DB-side filtering instead of fetching all chats
      const visibleChats = await storage.getActiveChats(userId);
      res.json(visibleChats);
    } catch (error: any) {
      // Defensive fallback: if chat listing query fails (e.g., transient schema mismatch),
      // do not break the app shell after logout/anonymous transitions.
      console.error("[Chats] Failed to list chats, returning empty list fallback:", error);
      res.json([]);
    }
  });

  /**
   * @swagger
   * /chats/search:
   *   get:
   *     summary: Search chat messages
   *     description: Full-text search across all user messages using Postgres tsvector.
   *     tags: [Chats]
   *     parameters:
   *       - in: query
   *         name: q
   *         schema:
   *           type: string
   *         required: true
   *         description: Search query
   *     responses:
   *       200:
   *         description: List of matching messages
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id:
   *                     type: string
   *                   content:
   *                     type: string
   *                   role:
   *                     type: string
   *       401:
   *         description: Unauthorized
   */
  router.get("/chats/search", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }

      const messages = await storage.searchMessages(userId, q);
      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /chats:
   *   post:
   *     summary: Create a new chat
   *     tags: [Chats]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               title:
   *                 type: string
   *               messages:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     role:
   *                       type: string
   *                     content:
   *                       type: string
   *     responses:
   *       200:
   *         description: Chat created
   */
  router.post("/chats", async (req, res) => {
    try {
      const { id: rawChatId, title, messages, role } = req.body;
      const requestedChatId =
        typeof rawChatId === "string" && rawChatId.trim().length > 0
          ? rawChatId.trim()
          : undefined;

      if (requestedChatId && !CHAT_ID_REGEX.test(requestedChatId)) {
        return res.status(400).json({ error: "Invalid chat id format" });
      }

      const userId = getOrCreateSecureUserId(req);
      const chatHistoryEnabled = userId && !userId.startsWith("anon_")
        ? (await storage.getUserSettings(userId))?.privacySettings?.chatHistoryEnabled ?? true
        : true;
      const titleValue = sanitizeChatTitle(title) || "New Chat";
      const normalizedRole = normalizeRole(role);
      if (normalizedRole && !ALLOWED_MESSAGE_ROLES.has(normalizedRole)) {
        return res.status(400).json({ error: "Invalid role. Must be 'user', 'assistant', or 'system'" });
      }

      // If messages provided with requestIds, check if any already exist (reconciliation scenario)
      if (messages && Array.isArray(messages) && messages.length > 0) {
        if (messages.length > MAX_MESSAGES_PER_CREATE) {
          return res.status(400).json({ error: "Too many messages in one request" });
        }

        const sanitizedMessages = [];

        for (const rawMessage of messages) {
          const messageRole = normalizeRole(rawMessage?.role);
          if (!validateMessageRole(rawMessage?.role)) {
            return res.status(400).json({ error: "Each message role must be user|assistant|system" });
          }
          const validation = validateMessageContent(rawMessage?.content);
          if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
          }

          const attachments = Array.isArray(rawMessage?.attachments)
            ? rawMessage.attachments
              .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
              .map((att: any) => sanitizeAndValidateAttachment(att))
              .filter((att): att is Record<string, any> => att !== null)
            : null;
          if (rawMessage?.attachments && !Array.isArray(rawMessage.attachments)) {
            return res.status(400).json({ error: "attachments must be an array" });
          }
          if (Array.isArray(rawMessage?.attachments) && rawMessage.attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
            return res.status(400).json({ error: "Too many attachments" });
          }
          if (Array.isArray(rawMessage?.attachments) && attachments.length < rawMessage.attachments.length) {
            return res.status(400).json({ error: "Invalid attachment payload" });
          }

          sanitizedMessages.push({
            role: messageRole,
            content: validation.sanitized || '',
            requestId: typeof rawMessage?.requestId === 'string' && rawMessage.requestId.length <= MAX_REQUEST_ID_LENGTH ? rawMessage.requestId : null,
            userMessageId: typeof rawMessage?.userMessageId === 'string' ? rawMessage.userMessageId : null,
            attachments,
          });
        }

        // Check first message's requestId to detect duplicate reconciliation attempts
        const firstMsgWithRequestId = sanitizedMessages.find((m: any) => m.requestId);
        if (firstMsgWithRequestId?.requestId) {
          const existingMsg = await storage.findMessageByRequestId(firstMsgWithRequestId.requestId);
          if (existingMsg) {
            // Chat already exists with this message, return existing chat
            const existingChat = await storage.getChat(existingMsg.chatId);
            if (existingChat) {
              const existingMessages = await storage.getChatMessages(existingChat.id);
              return res.json({ ...existingChat, messages: existingMessages, alreadyExists: true });
            }
          }
        }

        // Create chat with messages atomically using transaction
        const result = await storage.createChatWithMessages(
          { id: requestedChatId, title: titleValue, userId },
          sanitizedMessages
        );
        if (!chatHistoryEnabled) {
          // Store the chat transiently (accessible by id) but hide it from history listings.
          await storage.softDeleteChat(result.chat.id);
        }
        return res.json({ ...result.chat, messages: result.messages });
      }

      // Simple chat creation without messages
      const chat = await storage.createChat({ id: requestedChatId, title: titleValue, userId });
      if (!chatHistoryEnabled) {
        await storage.softDeleteChat(chat.id);
      }
      res.json(chat);
    } catch (error: any) {
      // Handle duplicate key constraint gracefully
      if (error.code === '23505') {
        const requestedChatId =
          typeof req.body?.id === "string" && req.body.id.trim().length > 0
            ? req.body.id.trim()
            : undefined;
        if (requestedChatId) {
          const existingById = await storage.getChat(requestedChatId);
          if (existingById) {
            if (req.body?.messages && Array.isArray(req.body.messages)) {
              const existingMessages = await storage.getChatMessages(existingById.id);
              return res.json({ ...existingById, messages: existingMessages, alreadyExists: true });
            }
            return res.json({ ...existingById, alreadyExists: true });
          }
        }

        if (!error.constraint?.includes('request')) {
          return res.status(409).json({ error: "Chat already exists" });
        }

        // Duplicate requestId - try to find and return existing chat
        const requestId = req.body.messages?.find((m: any) => m.requestId)?.requestId;
        if (requestId) {
          const existingMsg = await storage.findMessageByRequestId(requestId);
          if (existingMsg) {
            const existingChat = await storage.getChat(existingMsg.chatId);
            if (existingChat) {
              const existingMessages = await storage.getChatMessages(existingChat.id);
              return res.json({ ...existingChat, messages: existingMessages, alreadyExists: true });
            }
          }
        }
      }
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/chats/:id", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      const userEmail = (req as any).user?.claims?.email;

      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }

      const isOwner = chat.userId && chat.userId === userId;

      let shareRole = null;
      if (!isOwner && userId) {
        const share = await storage.getChatShareByUserAndChat(userId, req.params.id);
        if (share) {
          shareRole = share.role;
        }
      }

      if (!isOwner && !shareRole) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Pagination support
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const before = req.query.before ? new Date(req.query.before as string) : undefined;
      if (limit !== undefined && (!Number.isFinite(limit) || limit < 1 || limit > 200)) {
        return res.status(400).json({ error: "Invalid limit. Must be between 1 and 200" });
      }
      if (req.query.before && (!before || Number.isNaN(before.getTime()))) {
        return res.status(400).json({ error: "Invalid before timestamp" });
      }

      const rawMessages = await storage.getChatMessages(req.params.id, { limit, before });
      const messages = deduplicateAssistantMessages(rawMessages);
      const conversationDocs = await storage.getConversationDocuments(req.params.id);
      res.json({ ...chat, messages, conversationDocuments: conversationDocs, shareRole, isOwner });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Retrieve conversation documents (uploaded file references) for a chat
  router.get("/chats/:id/conversation-documents", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      const docs = await storage.getConversationDocuments(req.params.id);
      res.json(docs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // CONTEXT VALIDATION API - Verify client-server sync
  // ============================================================================
  router.get("/chats/:id/validate", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      const { clientMessageCount, clientMessageIds } = req.query;

      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const serverMessages = await storage.getChatMessages(req.params.id);
      const serverMessageIds = serverMessages.map(m => m.id);
      const serverMessageCount = serverMessages.length;

      // Parse client message IDs if provided
      let clientIds: string[] = [];
      if (clientMessageIds) {
        if (typeof clientMessageIds === 'string') {
          const trimmedIds = clientMessageIds.trim();
          if (trimmedIds.startsWith('[')) {
            try {
              const parsed = JSON.parse(trimmedIds);
              if (!Array.isArray(parsed)) {
                return res.status(400).json({ error: "Invalid clientMessageIds" });
              }
              clientIds = parsed;
            } catch {
              return res.status(400).json({ error: "Invalid clientMessageIds" });
            }
          } else {
            clientIds = trimmedIds.length > 0 ? trimmedIds.split(',') : [];
          }
        } else if (Array.isArray(clientMessageIds)) {
          clientIds = clientMessageIds;
        } else {
          return res.status(400).json({ error: "clientMessageIds must be an array or JSON string" });
        }

        clientIds = clientIds
          .map(id => typeof id === 'string' ? id.trim() : '')
          .filter(id => id.length > 0);

        if (clientIds.length > MAX_VALIDATED_MESSAGE_IDS) {
          return res.status(400).json({ error: "clientMessageIds too large" });
        }

        if (!clientIds.every(id => typeof id === 'string' && id.length <= MAX_REQUEST_ID_LENGTH)) {
          return res.status(400).json({ error: "Invalid clientMessageIds" });
        }

        clientIds = [...new Set(clientIds)];
      }

      // Calculate sync status
      const missingOnClient = serverMessageIds.filter(id => !clientIds.includes(id));
      const extraOnClient = clientIds.filter(id => !serverMessageIds.includes(id));
      const clientCount = clientMessageCount ? parseInt(clientMessageCount as string, 10) : clientIds.length;
      if (clientMessageCount && (!Number.isFinite(clientCount) || clientCount < 0)) {
        return res.status(400).json({ error: "Invalid clientMessageCount" });
      }

      const valid = missingOnClient.length === 0 &&
        extraOnClient.length === 0 &&
        serverMessageCount === clientCount;

      res.json({
        valid,
        serverMessageCount,
        clientMessageCount: clientCount,
        difference: serverMessageCount - clientCount,
        missingOnClient: missingOnClient.slice(0, 10), // Limit to 10
        extraOnClient: extraOnClient.slice(0, 10),
        lastServerMessageId: serverMessageIds[serverMessageIds.length - 1] || null,
        syncRecommendation: !valid ? 'FULL_REFRESH' : 'NONE'
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // CONFLICT RESOLUTION - Last-Write-Wins with version tracking
  // ============================================================================
  router.post("/chats/:id/resolve-conflict", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      const { clientMessage, expectedVersion } = req.body;

      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get server version of the message if it exists
      if (clientMessage?.id) {
        const serverMessages = await storage.getChatMessages(req.params.id);
        const serverMessage = serverMessages.find(m => m.id === clientMessage.id);

        if (serverMessage) {
          // Compare timestamps for LWW
          const serverTime = new Date(serverMessage.createdAt).getTime();
          const clientTime = clientMessage.timestamp || Date.now();

          if (clientTime > serverTime) {
            // Client wins - update server
            const updated = await storage.updateMessageContent(
              clientMessage.id,
              clientMessage.content,
              { status: 'done' }
            );
            return res.json({
              resolved: true,
              strategy: 'client_wins',
              message: updated
            });
          } else {
            // Server wins - return server version
            return res.json({
              resolved: true,
              strategy: 'server_wins',
              message: serverMessage
            });
          }
        }
      }

      // No conflict - message doesn't exist on server
      res.json({
        resolved: false,
        strategy: 'no_conflict',
        message: null
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/chats/:id", async (req, res) => {
    try {
      const userId = getSecureUserId(req);

      const existingChat = await storage.getChat(req.params.id);
      if (!existingChat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!existingChat.userId || existingChat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { title, archived, hidden, pinned, pinnedAt } = req.body;
      const updates: any = {};
      if (title !== undefined) {
        const normalizedTitle = sanitizeChatTitle(title);
        if (!normalizedTitle) {
          return res.status(400).json({ error: "Invalid title" });
        }
        updates.title = normalizedTitle;
      }
      const parsedArchived = parseBoolean(archived);
      if (archived !== undefined && parsedArchived === undefined) {
        return res.status(400).json({ error: "archived must be a boolean" });
      }
      if (archived !== undefined) updates.archived = parsedArchived ? "true" : "false";

      const parsedHidden = parseBoolean(hidden);
      if (hidden !== undefined && parsedHidden === undefined) {
        return res.status(400).json({ error: "hidden must be a boolean" });
      }
      if (hidden !== undefined) updates.hidden = parsedHidden ? "true" : "false";

      const parsedPinned = parseBoolean(pinned);
      if (pinned !== undefined && parsedPinned === undefined) {
        return res.status(400).json({ error: "pinned must be a boolean" });
      }
      if (pinned !== undefined) updates.pinned = parsedPinned ? "true" : "false";

      if (pinnedAt !== undefined) updates.pinnedAt = pinnedAt;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }

      const chat = await storage.updateChat(req.params.id, updates);
      res.json(chat);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/chats/:id", async (req, res) => {
    try {
      const userId = getSecureUserId(req);

      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      await storage.deleteChat(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/chats/:id/documents", async (req, res) => {
    try {
      const userId = getSecureUserId(req);

      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { type, title, content } = req.body;
      if (!type || !title || !content) {
        return res.status(400).json({ error: "type, title and content are required" });
      }

      const message = await storage.saveDocumentToChat(req.params.id, { type, title, content });
      res.json(message);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/chats/archive-all", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const chats = await storage.getChats(userId);
      let archivedCount = 0;
      for (const chat of chats) {
        if (chat.archived !== "true") {
          await storage.updateChat(chat.id, { archived: "true" });
          archivedCount++;
        }
      }
      res.json({ success: true, archivedCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/chats/delete-all", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const chats = await storage.getChats(userId);
      let deletedCount = 0;
      for (const chat of chats) {
        await storage.deleteChat(chat.id);
        deletedCount++;
      }
      res.json({ success: true, deletedCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/chats/:id/messages", messageBodyLimit, async (req, res) => {
    const t0 = performance.now();
    const timing: Record<string, number> = {};
    const addTiming = (name: string, start: number) => {
      timing[name] = performance.now() - start;
    };
    const setServerTiming = () => {
      const total = performance.now() - t0;
      const parts = Object.entries({ ...timing, total }).map(
        ([name, dur]) => `${name};dur=${dur.toFixed(1)}`
      );
      if (parts.length > 0) {
        res.setHeader("Server-Timing", parts.join(", "));
      }
    };

    try {
      const userId = getSecureUserId(req);

      const tChat = performance.now();
      let chat = await storage.getChat(req.params.id);
      addTiming("chat_lookup", tChat);

      if (!chat) {
        const tCreateChat = performance.now();
        try {
          chat = await storage.createChat({
            id: req.params.id,
            title: "New Chat",
            userId,
          });
        } catch (chatCreateError: any) {
          // 23505 = duplicate key (race condition with concurrent creators)
          if (chatCreateError?.code !== '23505') {
            throw chatCreateError;
          }
          chat = await storage.getChat(req.params.id);
        }
        addTiming("chat_create", tCreateChat);
      }

      if (!chat) {
        setServerTiming();
        return res.status(500).json({ error: "Unable to create chat" });
      }

      if (!chat.userId || chat.userId !== userId) {
        setServerTiming();
        return res.status(403).json({ error: "Access denied" });
      }

      const {
        role,
        content,
        requestId,
        clientRequestId,
        userMessageId,
        attachments,
        sources,
        figmaDiagram,
        googleFormPreview,
        gmailPreview,
        generatedImage,
        webSources,
        searchQueries,
        totalSearches,
        followUpSuggestions,
        confidence,
        uncertaintyReason,
        retrievalSteps,
        skipRun
      } = req.body;
      const normalizedRole = normalizeRole(role);
      const sanitizedContent = sanitizeMessageContent(typeof content === 'string' ? content : "");

      const parsedSkipRun = parseBoolean(skipRun);
      if (skipRun !== undefined && parsedSkipRun === undefined) {
        setServerTiming();
        return res.status(400).json({ error: "skipRun must be a boolean" });
      }

      if (!sanitizedContent) {
        setServerTiming();
        return res.status(400).json({ error: "role and content are required" });
      }

      // Validate role is allowed value
      if (!normalizedRole || !ALLOWED_MESSAGE_ROLES.has(normalizedRole)) {
        setServerTiming();
        return res.status(400).json({ error: "Invalid role. Must be 'user', 'assistant', or 'system'" });
      }

      // Validate request identifiers to avoid oversized index values
      if (requestId && (typeof requestId !== 'string' || requestId.length > MAX_REQUEST_ID_LENGTH)) {
        setServerTiming();
        return res.status(400).json({ error: "Invalid requestId" });
      }
      if (clientRequestId && (typeof clientRequestId !== 'string' || clientRequestId.length > MAX_REQUEST_ID_LENGTH)) {
        setServerTiming();
        return res.status(400).json({ error: "Invalid clientRequestId" });
      }
      if (userMessageId && (typeof userMessageId !== 'string' || userMessageId.length > MAX_REQUEST_ID_LENGTH)) {
        setServerTiming();
        return res.status(400).json({ error: "Invalid userMessageId" });
      }
      if (attachments && !Array.isArray(attachments)) {
        setServerTiming();
        return res.status(400).json({ error: "attachments must be an array" });
      }
      if (attachments && attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        setServerTiming();
        return res.status(400).json({ error: "Too many attachments" });
      }

      // Validate and sanitize message content (defense in depth).
      const contentValidation = validateMessageContent(sanitizedContent);
      if (!contentValidation.valid) {
        setServerTiming();
        return res.status(400).json({ error: contentValidation.error });
      }
      // Prevent XSS in persisted message content
      const safeContent = sanitizeMessageContent(contentValidation.sanitized || content);

      // SERVER-SIDE ATTACHMENT SANITIZATION: Defense-in-depth
      // Strip all large data fields (imageUrl, content, thumbnail, dataUrl) that should not be
      // stored in JSONB. The actual file data lives in object storage (storagePath) and
      // conversationDocuments. Only lightweight metadata is persisted in the message JSONB.
      const sanitizedAttachments = attachments && Array.isArray(attachments)
        ? attachments
          .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
          .map((att: any) => sanitizeAndValidateAttachment(att))
          .filter((att): att is Record<string, any> => att !== null)
        : null;

      if (attachments && (!Array.isArray(attachments) || !Array.isArray(sanitizedAttachments))) {
        setServerTiming();
        return res.status(400).json({ error: "Invalid attachments payload" });
      }

      if (Array.isArray(attachments) && sanitizedAttachments && sanitizedAttachments.length < attachments.length) {
        setServerTiming();
        return res.status(400).json({ error: "Invalid attachments payload" });
      }

      const shouldCreateRun = normalizedRole === 'user' && !parsedSkipRun && !!clientRequestId;

      // Run-based idempotency for user messages when enabled.
      if (shouldCreateRun) {
        // Check if a run with this clientRequestId already exists
        const tRunLookup = performance.now();
        const existingRun = await storage.getChatRunByClientRequestId(req.params.id, clientRequestId);
        addTiming("run_lookup", tRunLookup);
        if (existingRun) {
          console.log(`[Dedup] Run with clientRequestId ${clientRequestId} already exists, returning existing`);
          // Fetch the user message that was created with this run
          const tMsgLookup = performance.now();
          const existingMessage = await storage.getChatMessage(req.params.id, existingRun.userMessageId);
          addTiming("msg_lookup", tMsgLookup);
          if (!existingMessage) {
            console.warn(`[Dedup] Missing userMessageId ${existingRun.userMessageId} for existing run ${existingRun.id}`);
          }
          setServerTiming();
          return res.json({
            message: existingMessage,
            run: existingRun,
            deduplicated: true
          });
        }

        // Create user message and run atomically
        const tCreate = performance.now();
        const { message, run } = await storage.createUserMessageAndRun(
          req.params.id,
          {
            chatId: req.params.id,
            role: 'user',
            content: safeContent,
            status: 'done',
            requestId: requestId || null,
            userMessageId: null,
            attachments: sanitizedAttachments,
            sources: sources || null,
            figmaDiagram: figmaDiagram || null,
            googleFormPreview: googleFormPreview || null,
            gmailPreview: gmailPreview || null,
            generatedImage: generatedImage || null
          },
          clientRequestId
        );
        addTiming("create_message_run", tCreate);

        // Persist conversationDocuments for each attachment so files survive reload.
        // Best-effort & non-blocking — runs in parallel without delaying the response.
        if (sanitizedAttachments && sanitizedAttachments.length > 0) {
          Promise.allSettled(
            sanitizedAttachments.map((att: any) =>
              storage.createConversationDocument({
                chatId: req.params.id,
                messageId: message.id,
                fileName: att.name || 'document',
                storagePath: att.storagePath || null,
                mimeType: att.mimeType || att.type || 'application/octet-stream',
                fileSize: att.size || null,
                extractedText: null, // Text extraction happens in the streaming endpoint
                metadata: { fileId: att.fileId || att.id },
              })
            )
          ).then(results => {
            const failures = results.filter(r => r.status === 'rejected');
            if (failures.length > 0) {
              console.warn(`[Messages] ${failures.length} conversationDocument(s) failed to persist`);
            }
          });
        }

        // Set a quick placeholder title from the user's message.
        // The AI-generated title will replace this during streaming via chatTitleGenerator.
        if (isTitlePlaceholder(chat.title)) {
          const newTitle = sanitizedContent.slice(0, 50) + (sanitizedContent.length > 50 ? "..." : "");
          void storage.updateChat(req.params.id, { title: newTitle }).catch((err) => {
            console.warn("[Chats] Failed to update placeholder title:", err);
          });
        }

        setServerTiming();
        return res.json({ message, run, deduplicated: false });
      }

      const sanitizedArtifact = normalizedRole === "assistant"
        ? sanitizeAssistantArtifact(req.body?.artifact)
        : null;
      const assistantPayload = normalizedRole === "assistant"
        ? buildAssistantMessage({
            content: safeContent,
            artifact: sanitizedArtifact,
            webSources,
            searchQueries,
            totalSearches,
            followUpSuggestions,
            confidence,
            uncertaintyReason,
            retrievalSteps,
          })
        : null;
      const assistantMetadata = assistantPayload
        ? buildAssistantMessageMetadata(assistantPayload)
        : undefined;
      const normalizedAssistantContent =
        assistantPayload?.content ? normalizeRenderableMessageContent(assistantPayload.content) : "";

      // Legacy flow for assistant messages or messages without clientRequestId
      if (normalizedRole === "assistant" && userMessageId) {
        const tDedupAssistant = performance.now();
        try {
          const existingAssistant = await storage.findAssistantResponseForUserMessage(userMessageId);
          addTiming("dedup_assistant", tDedupAssistant);
          if (existingAssistant) {
            console.log(`[Dedup] Assistant message already exists for userMessageId ${userMessageId}, returning existing (id: ${existingAssistant.id})`);
            setServerTiming();
            return res.json(existingAssistant);
          }
        } catch (e) {
          addTiming("dedup_assistant", tDedupAssistant);
          console.warn(`[Dedup] findAssistantResponseForUserMessage failed:`, (e as any)?.message);
        }
      }
      if (requestId) {
        const tDedupReq = performance.now();
        const existingMessage = await storage.findMessageByRequestId(requestId);
        addTiming("dedup_request", tDedupReq);
        if (existingMessage) {
          if (normalizedRole === "assistant" && assistantPayload) {
            const updatedMessage = await storage.updateChatMessageContent(
              existingMessage.id,
              assistantPayload.content,
              existingMessage.status || "done",
              assistantMetadata,
            );
            console.log(`[Dedup] Message with requestId ${requestId} already exists, refreshed assistant metadata`);
            setServerTiming();
            return res.json(updatedMessage || existingMessage);
          }
          console.log(`[Dedup] Message with requestId ${requestId} already exists, returning existing`);
          setServerTiming();
          return res.json(existingMessage);
        }
      }

      if (normalizedRole === "assistant" && normalizedAssistantContent) {
        if (userMessageId) {
          const existingAssistantForUser = await storage.findAssistantResponseForUserMessage(userMessageId);
          if (existingAssistantForUser) {
            const refreshedAssistant = await storage.updateChatMessageContent(
              existingAssistantForUser.id,
              assistantPayload?.content || safeContent,
              existingAssistantForUser.status || "done",
              assistantMetadata,
            );
            console.log(`[Dedup] Reused assistant message ${existingAssistantForUser.id} for userMessageId ${userMessageId}`);
            setServerTiming();
            return res.json(refreshedAssistant || existingAssistantForUser);
          }
        }

        const recentMessages = await storage.getChatMessages(req.params.id, { limit: 4, orderBy: "desc" });
        const latestRenderableMessage = recentMessages.find((message) => message.role !== "system");
        if (latestRenderableMessage && isRecentAssistantDuplicate(latestRenderableMessage, normalizedAssistantContent)) {
          const refreshedAssistant = await storage.updateChatMessageContent(
            latestRenderableMessage.id,
            assistantPayload?.content || safeContent,
            latestRenderableMessage.status || "done",
            assistantMetadata,
          );
          console.log(`[Dedup] Reused latest assistant message ${latestRenderableMessage.id} for identical content`);
          setServerTiming();
          return res.json(refreshedAssistant || latestRenderableMessage);
        }
      }

      const tCreateLegacy = performance.now();

      const message = await storage.createChatMessage({
        chatId: req.params.id,
        role: normalizedRole,
        content: safeContent,
        status: 'done',
        requestId: requestId || null,
        userMessageId: userMessageId || null,
        attachments: sanitizedAttachments,
        sources: sources || null,
        figmaDiagram: figmaDiagram || null,
        googleFormPreview: googleFormPreview || null,
        gmailPreview: gmailPreview || null,
        generatedImage: generatedImage || null,
        metadata: assistantMetadata || null,
      });
      addTiming("create_message", tCreateLegacy);

      // Set a quick placeholder title from the user's message (legacy flow).
      // The AI-generated title will replace this during streaming via chatTitleGenerator.
      if (isTitlePlaceholder(chat.title) && normalizedRole === "user") {
        const newTitle = sanitizedContent.slice(0, 50) + (sanitizedContent.length > 50 ? "..." : "");
        void storage.updateChat(req.params.id, { title: newTitle }).catch((err) => {
          console.warn("[Chats] Failed to update placeholder title:", err);
        });
      }

      setServerTiming();
      res.json(message);
    } catch (error: any) {
      // Handle unique constraint violation gracefully (duplicate clientRequestId or requestId)
      if (error.code === '23505') {
        console.log(`[Dedup] Duplicate constraint hit, fetching existing`);
        const { clientRequestId, requestId } = req.body;
        if (clientRequestId) {
          const tRunLookup2 = performance.now();
          const existingRun = await storage.getChatRunByClientRequestId(req.params.id, clientRequestId);
          addTiming("run_lookup", tRunLookup2);
          if (existingRun) {
            const tMsgLookup2 = performance.now();
            const existingMessage = await storage.getChatMessage(req.params.id, existingRun.userMessageId);
            addTiming("msg_lookup", tMsgLookup2);
            setServerTiming();
            return res.json({ message: existingMessage, run: existingRun, deduplicated: true });
          }
        }
        if (requestId) {
          const tDedupReq2 = performance.now();
          const existingMessage = await storage.findMessageByRequestId(requestId);
          addTiming("dedup_request", tDedupReq2);
          if (existingMessage) {
            setServerTiming();
            return res.json(existingMessage);
          }
        }
      }
      setServerTiming();
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/chats/:id/shares", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;

      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const shares = await storage.getChatShares(req.params.id);
      res.json(shares);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/chats/:id/shares", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      const userEmail = user?.claims?.email;

      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { participants, settings } = req.body;
      if (!participants || !Array.isArray(participants)) {
        return res.status(400).json({ error: "participants array is required" });
      }
      if (participants.length > MAX_SHARE_PARTICIPANTS) {
        return res.status(400).json({ error: "Too many participants" });
      }
      if (settings && typeof settings !== 'object') {
        return res.status(400).json({ error: "Invalid settings payload" });
      }

      const createdShares = [];
      const emailsToNotify = [];
      const seenEmails = new Set<string>();

      for (const p of participants) {
        if (!p || typeof p !== 'object') {
          return res.status(400).json({ error: "Each participant must be an object" });
        }
        if (!p.email || !p.role) {
          return res.status(400).json({ error: "Each participant needs email and role" });
        }

        const normalizedEmail = String(p.email).trim().toLowerCase();
        if (!EMAIL_REGEX.test(normalizedEmail) || normalizedEmail.length > 254) {
          return res.status(400).json({ error: `Invalid email: ${normalizedEmail}` });
        }
        if (seenEmails.has(normalizedEmail)) {
          continue;
        }
        seenEmails.add(normalizedEmail);

        const normalizedRole = parseShareRole(p.role);
        if (!normalizedRole) {
          return res.status(400).json({ error: `Invalid role for ${normalizedEmail}` });
        }

        const recipientUser = await storage.getUserByEmail(normalizedEmail);

        const existing = await storage.getChatShareByEmailAndChat(normalizedEmail, req.params.id);
        if (existing) {
          const updates: any = {};
          if (existing.role !== normalizedRole) updates.role = normalizedRole;
          if (recipientUser && existing.recipientUserId !== recipientUser.id) {
            updates.recipientUserId = recipientUser.id;
          }
          if (Object.keys(updates).length > 0) {
            await storage.updateChatShare(existing.id, updates);
          }
          continue;
        }

        const share = await storage.createChatShare({
          chatId: req.params.id,
          email: normalizedEmail,
          recipientUserId: recipientUser?.id || null,
          role: normalizedRole,
          invitedBy: userId,
          notificationSent: "false"
        });
        createdShares.push(share);
        emailsToNotify.push({ email: normalizedEmail, role: normalizedRole, shareId: share.id });
      }

      for (const notify of emailsToNotify) {
        try {
          await sendShareNotificationEmail({
            toEmail: notify.email,
            chatTitle: chat.title,
            chatId: req.params.id,
            role: notify.role,
            inviterEmail: userEmail || "Un usuario"
          });
          await storage.updateChatShare(notify.shareId, { notificationSent: "true" });
        } catch (emailError) {
          console.error("Failed to send share notification:", emailError);
        }
      }

      res.json({ success: true, created: createdShares.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/chats/:id/shares/:shareId", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;

      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const sharesForChat = await storage.getChatShares(req.params.id);
      const shareExists = sharesForChat.some(share => share.id === req.params.shareId);
      if (!shareExists) {
        return res.status(404).json({ error: "Share not found for this chat" });
      }
      await storage.deleteChatShare(req.params.shareId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/shared-chats", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;

      if (!userId) {
        return res.json([]);
      }

      const sharedChats = await storage.getSharedChatsWithDetails(userId);
      res.json(sharedChats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
