import { Router } from 'express';
import type { Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { whatsappWebManager, type WhatsAppMediaAttachment } from '../integrations/whatsappWeb';
import { whatsappWebSseHub } from '../integrations/whatsappWebSse';
import { chunkText, isGroupJid, MemorySseResponse } from '../integrations/whatsappWebAutoReply';
import type { AuthenticatedRequest } from '../types/express';
import { getSecureUserId } from '../lib/anonUserHelper';
import { storage } from '../storage';
import { OpenAI } from 'openai';
import { MultimodalResponseSender } from '../channels/multimodalResponseSender';
import { executeChannelAgent } from '../channels/channelAgentExecutor';

// Auto-reply timeout: 120 seconds max (document generation needs extra time)
const AUTO_REPLY_TIMEOUT_MS = 120_000;

const MAX_AUTO_REPLY_PROMPT_LENGTH = 800;

function requireUserId(req: AuthenticatedRequest): string {
  return getSecureUserId(req as any) || '';
}

function safePromptText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\u0000/g, '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .trim()
    .slice(0, MAX_AUTO_REPLY_PROMPT_LENGTH);
}

function safeChatId(userId: string, remoteJid: string): string {
  const raw = `wa_${userId}_${remoteJid}`;
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 200);
}

/** Run a promise with a timeout. Rejects if the promise doesn't resolve in time. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);
    timer.unref?.();
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export function createWhatsAppWebRouter(): Router {
  const router = Router();

  // Server-Sent Events for live WhatsApp status + mirrored messages.
  router.get('/events', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    whatsappWebSseHub.subscribe(userId, res);

    // Send initial status snapshot.
    const status = whatsappWebManager.getStatus(userId);
    whatsappWebSseHub.broadcast(userId, 'wa_status', { status });
  });

  router.get('/status', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const status = whatsappWebManager.getStatus(userId);
    const autoReply = whatsappWebManager.isAutoReplyEnabled(userId);
    res.json({ success: true, status, autoReply });
  });

  // Start connection — waits for QR to be ready before responding
  router.post('/connect/start', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    try {
      const status = await whatsappWebManager.startWithOptions(userId);
      res.json({ success: true, status });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al iniciar conexión' });
    }
  });

  // Force restart — kills existing connection and starts fresh
  router.post('/connect/restart', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    try {
      const { phone } = (req.body || {}) as { phone?: string };
      const status = await whatsappWebManager.restart(userId, phone ? { phone: String(phone) } : undefined);
      res.json({ success: true, status });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al reiniciar conexión' });
    }
  });

  // Generate pairing code (link by phone number)
  router.post('/connect/pairing-code', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { phone } = (req.body || {}) as { phone?: string };
    if (!phone) return res.status(400).json({ success: false, error: 'Se requiere número de teléfono' });

    try {
      const status = await whatsappWebManager.restart(userId, { phone: String(phone) });
      res.json({ success: true, status });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e?.message || 'No se pudo generar el código de vinculación' });
    }
  });

  router.post('/connect/disconnect', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    try {
      await whatsappWebManager.disconnect(userId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al desconectar' });
    }
  });

  // Toggle auto-reply on/off
  router.post('/auto-reply', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { enabled, autoReplyToContacts } = (req.body || {}) as { enabled?: boolean, autoReplyToContacts?: boolean };
    let hasChanges = false;
    if (typeof enabled === 'boolean') {
      whatsappWebManager.setAutoReply(userId, enabled);
      hasChanges = true;
    }
    if (typeof autoReplyToContacts === 'boolean') {
      whatsappWebManager.setAutoReplyToContacts(userId, autoReplyToContacts);
      hasChanges = true;
    }

    if (!hasChanges) {
      return res.status(400).json({ success: false, error: 'No settings provided to update' });
    }

    res.json({ success: true, autoReply: whatsappWebManager.isAutoReplyEnabled(userId), autoReplyToContacts: whatsappWebManager.isAutoReplyToContactsEnabled(userId) });
  });

  // Optional: customize how the bot should respond in WhatsApp auto-replies.
  router.get('/settings', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    return res.json({
      success: true,
      settings: {
        autoReply: whatsappWebManager.isAutoReplyEnabled(userId),
        autoReplyToContacts: whatsappWebManager.isAutoReplyToContactsEnabled(userId),
        customPrompt: whatsappWebManager.getAutoReplyPrompt(userId),
      },
    });
  });

  router.put('/settings', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const raw = (req.body || {}) as { customPrompt?: unknown, autoReplyToContacts?: boolean };

    let customPrompt = whatsappWebManager.getAutoReplyPrompt(userId);
    if (raw.customPrompt !== undefined) {
      customPrompt = safePromptText(raw.customPrompt);
      whatsappWebManager.setAutoReplyPrompt(userId, customPrompt);
    }
    if (typeof raw.autoReplyToContacts === 'boolean') {
      whatsappWebManager.setAutoReplyToContacts(userId, raw.autoReplyToContacts);
    }

    return res.json({
      success: true,
      settings: {
        autoReply: whatsappWebManager.isAutoReplyEnabled(userId),
        autoReplyToContacts: whatsappWebManager.isAutoReplyToContactsEnabled(userId),
        customPrompt,
      },
    });
  });

  // Send a test message to the user's own WhatsApp number
  router.post('/test', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const status = whatsappWebManager.getStatus(userId);
    if (status.state !== 'connected' || !status.me?.id) {
      return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' });
    }

    // The me.id from Baileys is like "51918714054:42@s.whatsapp.net" — extract the base JID
    const myJid = status.me.id.includes(':')
      ? status.me.id.split(':')[0] + '@s.whatsapp.net'
      : status.me.id;

    const testMessage = `Hola desde ILIAGPT! Tu WhatsApp está conectado correctamente.\n\nPuedes enviarme mensajes aquí y te responderé con IA. Prueba escribiéndome algo!`;

    try {
      await whatsappWebManager.sendText(userId, myJid, testMessage);
      res.json({ success: true, sentTo: myJid });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al enviar mensaje de prueba' });
    }
  });

  // Basic send endpoint (used for testing from the web UI)
  router.post('/send', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ success: false, error: 'Se requiere destinatario y texto' });

    try {
      await whatsappWebManager.sendText(userId, String(to), String(text));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al enviar mensaje' });
    }
  });

  return router;
}

async function autoReplyFromWhatsApp(opts: {
  userId: string;
  fromJid: string;
  chatId: string;
  inboundText: string;
  chatTitle?: string;
  media?: WhatsAppMediaAttachment;
}): Promise<void> {
  const { userId, fromJid, chatId, chatTitle, inboundText, media } = opts;

  console.log(`[WhatsApp AutoReply] Processing message from ${fromJid} for user ${userId}${media ? ` [media: ${media.type}]` : ''}`);

  // Safety: don't reply to groups automatically.
  if (isGroupJid(fromJid)) {
    console.log('[WhatsApp AutoReply] Skipping group message');
    return;
  }

  // Check if auto-reply is enabled for this user
  if (!whatsappWebManager.isAutoReplyEnabled(userId)) {
    console.log('[WhatsApp AutoReply] Auto-reply is disabled for this user');
    return;
  }

  const status = whatsappWebManager.getStatus(userId);
  const myJid = status.state === 'connected' ? status.me?.id : undefined;
  const myLid = status.state === 'connected' ? status.me?.lid : undefined;

  const myBaseJid = myJid?.includes(':') ? myJid.split(':')[0] + '@s.whatsapp.net' : myJid;
  const myBaseLid = myLid?.includes(':') ? myLid.split(':')[0] + '@lid' : myLid;

  // Extraer solo los números para la comparación owner
  const myPhoneNumbers = (myBaseJid || '').replace(/[^0-9]/g, '');
  const fromPhoneNumbers = (fromJid || '').replace(/[^0-9]/g, '');

  // Es dueño si los números de teléfono principales coinciden (self-chat) o si es el alias LID
  const isOwner = Boolean(myPhoneNumbers && fromPhoneNumbers && myPhoneNumbers === fromPhoneNumbers) || Boolean(myBaseLid && myBaseLid === fromJid);

  console.log(`[WhatsApp AutoReply] Validation: from=${fromJid} (nums: ${fromPhoneNumbers}), baseLid=${myBaseLid}, isOwner=${isOwner}, replyContacts=${whatsappWebManager.isAutoReplyToContactsEnabled(userId)}`);

  if (!isOwner && !whatsappWebManager.isAutoReplyToContactsEnabled(userId)) {
    console.log(`[WhatsApp AutoReply] Skipping message from contact ${fromJid} (Mirror mode only is ON)`);
    return;
  }

  const customPrompt = whatsappWebManager.getAutoReplyPrompt(userId).trim();

  // Initialize unified multi-model sender
  const sender = new MultimodalResponseSender(whatsappWebManager);

  // Execute unified channel agent completely abstracted
  await executeChannelAgent({
    userId,
    chatId,
    chatTitle,
    inboundText,
    media,
    sender,
    sendTarget: {
      channel: 'whatsapp_web',
      userId,
      recipientId: fromJid,
    },
    customPrompt: customPrompt || undefined,
    accessLevel: isOwner ? 'owner' : 'trusted',
  });
}

// Wire inbound WhatsApp messages into IliaGPT chats (in-app inbox) and auto-reply.
whatsappWebManager.on('inbound_message', async (userId: string, msg: { from: string; text: string; messageId?: string; timestamp?: number; media?: WhatsAppMediaAttachment }) => {
  try {
    const mediaTag = msg.media ? ` [${msg.media.type}: ${msg.media.fileName || msg.media.mimetype}]` : '';
    console.log(`[WhatsAppWebRouter] inbound_message from=${msg.from} text="${msg.text.slice(0, 80)}..."${mediaTag} msgId=${msg.messageId}`);

    // Deduplicate: skip if already processed
    if (msg.messageId && whatsappWebManager.markMessageProcessed(msg.messageId)) {
      console.log(`[WhatsAppWebRouter] Skipping duplicate message ${msg.messageId}`);
      return;
    }

    const chatId = safeChatId(userId, msg.from);

    // Format a clean title: "WhatsApp: +51918714054" instead of raw JID
    const phoneNumber = msg.from.replace(/@s\.whatsapp\.net$/, '').replace(/@lid$/, '');
    const chatTitle = /^\d+$/.test(phoneNumber) ? `WhatsApp: +${phoneNumber}` : `WhatsApp: ${phoneNumber}`;

    let chat = await storage.getChat(chatId);
    if (!chat) {
      chat = await storage.createChat({
        id: chatId,
        userId,
        title: chatTitle,
        archived: 'false',
        hidden: 'false',
        pinned: 'false',
      } as any);
    }

    // Build message content — include media info in metadata
    const messageMetadata: Record<string, any> = {
      channel: 'whatsapp_web',
      from: msg.from,
      timestamp: msg.timestamp,
    };
    if (msg.media) {
      messageMetadata.media = {
        type: msg.media.type,
        mimetype: msg.media.mimetype,
        fileName: msg.media.fileName,
        localPath: msg.media.localPath,
      };
    }

    const savedUserMessage = await storage.createChatMessage({
      chatId,
      role: 'user',
      content: msg.text,
      status: 'done',
      requestId: msg.messageId ? `wa_${msg.messageId}` : undefined,
      metadata: messageMetadata,
      createdAt: msg.timestamp ? new Date(msg.timestamp) : new Date(),
    } as any);

    await storage.updateChat(chatId, { lastMessageAt: new Date() } as any);

    whatsappWebSseHub.broadcast(userId, 'wa_message', {
      chat: {
        id: chatId,
        title: chat.title,
        channel: 'whatsapp_web',
        archived: chat.archived === 'true',
        hidden: chat.hidden === 'true',
        pinned: chat.pinned === 'true',
        pinnedAt: chat.pinnedAt instanceof Date ? chat.pinnedAt.toISOString() : chat.pinnedAt,
        updatedAt: new Date().toISOString(),
      },
      message: {
        id: savedUserMessage.id,
        role: savedUserMessage.role,
        content: savedUserMessage.content,
        createdAt: savedUserMessage.createdAt instanceof Date ? savedUserMessage.createdAt.toISOString() : savedUserMessage.createdAt,
        requestId: savedUserMessage.requestId,
        userMessageId: savedUserMessage.userMessageId,
        metadata: savedUserMessage.metadata,
      },
    });

    // Fire-and-forget auto-reply.
    void autoReplyFromWhatsApp({
      userId,
      fromJid: msg.from,
      chatId,
      inboundText: msg.text,
      chatTitle: chat.title,
      media: msg.media,
    }).catch((e) => {
      console.error('[WhatsAppWebRouter] autoReply failed:', (e as any)?.message || e);
    });
  } catch (e) {
    console.error('[WhatsAppWebRouter] inbound_message persist failed:', (e as any)?.message || e);
  }
});

whatsappWebManager.on('status', (userId: string, status: any) => {
  whatsappWebSseHub.broadcast(userId, 'wa_status', { status });
});
