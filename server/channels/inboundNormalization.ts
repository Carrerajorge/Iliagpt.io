import type { ConversationKey, ExternalChannel, MessageEnvelope } from "./types";

const MAX_TEXT_LENGTH = 4000;
const MAX_ID_LENGTH = 80;
const MAX_FILE_NAME_LENGTH = 180;
const MAX_IDENTIFIER_TEXT_LENGTH = 120;
const MAX_METADATA_TEXT_LENGTH = 280;
const MAX_MEDIA_URL_LENGTH = 2_048;
const MAX_CHANNEL_PAYLOAD_LENGTH = 10_000;
const MAX_ARRAY_LENGTH = 1_200;
const MAX_CHAT_ID_LENGTH = 160;
const MAX_TEXT_MESSAGE_LENGTH = 3_000;
const SAFE_HOSTNAME_LENGTH = 255;
const MAX_OBJECT_KEYS = 320;
const MAX_TIMESTAMP_FUTURE_MS = 15 * 60_000;
const MAX_BIDI_CHARS = /[\u202A-\u202E\u2066-\u2069]/g;
const MAX_CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
const HTML_TAG_RE = /<[^>]*?>/g;
const SCRIPT_TAG_RE = /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi;
const HTML_ENTITY_RE = /&(?:nbsp|amp|lt|gt|quot|apos);/gi;

const ALLOWED_MIME_TYPES: Record<MessageEnvelope["messageType"], ReadonlySet<string>> = {
  text: new Set([]),
  image: new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]),
  audio: new Set(["audio/ogg", "audio/mpeg", "audio/mp3", "audio/wav", "audio/webm"]),
  document: new Set([
    "application/pdf",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/csv",
    "application/zip",
    "application/json",
    "application/octet-stream",
  ]),
  unsupported: new Set([]),
};

const ALLOWED_CHANNEL_SCHEME = /^https?:$/i;
const SAFE_ID_RE = /^[A-Za-z0-9._:@+\-]+$/;

function isIpV4InRange(hostname: string, prefix: string): boolean {
  return hostname.startsWith(prefix);
}

function isIpV4Private(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname.startsWith("10.") ||
    isIpV4InRange(hostname, "172.16.") ||
    isIpV4InRange(hostname, "172.17.") ||
    isIpV4InRange(hostname, "172.18.") ||
    isIpV4InRange(hostname, "172.19.") ||
    isIpV4InRange(hostname, "172.20.") ||
    isIpV4InRange(hostname, "172.21.") ||
    isIpV4InRange(hostname, "172.22.") ||
    isIpV4InRange(hostname, "172.23.") ||
    isIpV4InRange(hostname, "172.24.") ||
    isIpV4InRange(hostname, "172.25.") ||
    isIpV4InRange(hostname, "172.26.") ||
    isIpV4InRange(hostname, "172.27.") ||
    isIpV4InRange(hostname, "172.28.") ||
    isIpV4InRange(hostname, "172.29.") ||
    isIpV4InRange(hostname, "172.30.") ||
    isIpV4InRange(hostname, "172.31.") ||
    isIpV4InRange(hostname, "192.168.") ||
    isIpV4InRange(hostname, "169.254.") ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    hostname === "localhost"
  );
}

function isUrlHostUnsafe(parsedUrl: URL): boolean {
  const host = parsedUrl.hostname.toLowerCase();
  return host.length > SAFE_HOSTNAME_LENGTH || isIpV4Private(host);
}

export type NormalizedInboundMessage = {
  providerMessageId: string;
  senderId: string;
  recipientId?: string;
  text: string;
  messageType: "text" | "image" | "audio" | "document";
  raw: any;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(MAX_BIDI_CHARS, "")
    .replace(MAX_CONTROL_CHARS, "")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function sanitizeTextForStorage(value: unknown): string {
  return normalizeText(value)
    .replace(SCRIPT_TAG_RE, "")
    .replace(HTML_TAG_RE, "")
    .replace(HTML_ENTITY_RE, "")
    .replace(/[`*_~#>[\]{}]/g, "")
    .slice(0, MAX_IDENTIFIER_TEXT_LENGTH);
}

function sanitizeIdentifier(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u202E/g, "")
    .replace(/\x00/g, "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/["'`]/g, "")
    .replace(/[\\\/]/g, "")
    .replace(/[<>]/g, "")
    .slice(0, MAX_ID_LENGTH);
}

function sanitizeIdentifierStrict(value: unknown): string {
  const cleaned = sanitizeIdentifier(value);
  if (!cleaned) return "";
  if (SAFE_ID_RE.test(cleaned)) return cleaned;
  return cleaned.replace(/[^A-Za-z0-9._:@+\-]+/g, "").slice(0, MAX_ID_LENGTH);
}

function normalizeTextMessage(value: unknown, limit = MAX_TEXT_MESSAGE_LENGTH): string {
  return normalizeText(value).replace(MAX_BIDI_CHARS, "").replace(MAX_CONTROL_CHARS, "").slice(0, limit);
}

function sanitizeOptionalText(value: unknown): string {
  return normalizeText(value).slice(0, MAX_IDENTIFIER_TEXT_LENGTH);
}

function sanitizeMetadataText(value: unknown): string {
  return sanitizeTextForStorage(value).slice(0, MAX_METADATA_TEXT_LENGTH);
}

function sanitizeMimeType(messageType: MessageEnvelope["messageType"], value: unknown): string {
  const normalized = sanitizeOptionalText(value).toLowerCase();
  if (!normalized) {
    return messageType === "text" ? "text/plain" : "";
  }

  const allowed = ALLOWED_MIME_TYPES[messageType] ?? ALLOWED_MIME_TYPES.unsupported;
  if (!allowed.size || allowed.has(normalized)) return normalized;
  return messageType === "text" ? "text/plain" : "";
}

function sanitizeMediaUrl(value: unknown): string | undefined {
  const normalized = sanitizeTextForStorage(value).slice(0, MAX_MEDIA_URL_LENGTH);
  if (!normalized) return undefined;

  try {
    const parsed = new URL(normalized);
    if (!ALLOWED_CHANNEL_SCHEME.test(parsed.protocol)) return undefined;
    if (isUrlHostUnsafe(parsed)) return undefined;
    if (parsed.pathname.length + (parsed.search?.length || 0) > MAX_MEDIA_URL_LENGTH) return undefined;
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return undefined;
  }
}

function sanitizeFileName(value: unknown, fallback: string): string {
  const candidate = sanitizeMetadataText(value);
  const safe = candidate
    .replace(/[\\/]|\.{2,}|\s+/g, "_")
    .replace(/[^\w.\-()]/g, "_")
    .slice(0, MAX_FILE_NAME_LENGTH);
  return safe || fallback;
}

function normalizeIncomingPayload<T>(value: unknown): T | null {
  if (typeof value === "string") {
    return value.length > MAX_CHANNEL_PAYLOAD_LENGTH ? null : (value as T);
  }
  if (typeof value !== "object" || value === null) return null;
  if (Array.isArray(value)) return value.length > MAX_ARRAY_LENGTH ? null : (value as T);
  if (Object.keys(value).length > MAX_OBJECT_KEYS) return null;
  return value as T;
}

function parseTimestamp(raw: any): string {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (Number.isFinite(n) && n > 0) {
    const ms = n < 1e12 ? n * 1000 : n;
    const now = Date.now();
    if (ms - now > MAX_TIMESTAMP_FUTURE_MS) {
      return new Date(now).toISOString();
    }
    return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

function normalizeChatId(value: unknown): string {
  const normalized = sanitizeIdentifierStrict(value) || "";
  return normalized.slice(0, MAX_CHAT_ID_LENGTH);
}

export function normalizeWhatsAppMessages(payload: any): Array<MessageEnvelope> {
  const out: MessageEnvelope[] = [];
  const safePayload = normalizeIncomingPayload<any>(payload);
  if (!safePayload) return out;

  const entries = Array.isArray(safePayload.entry) ? safePayload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const phoneNumberId = sanitizeIdentifierStrict(value?.metadata?.phone_number_id);
      if (!phoneNumberId) continue;

      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const contact = contacts[0];
      const contactName = sanitizeMetadataText(contact?.profile?.name) || null;

      for (const m of messages) {
        const providerMessageId = sanitizeIdentifierStrict(m?.id);
        if (!providerMessageId) {
          continue;
        }

        const senderId = sanitizeIdentifierStrict(m?.from);
        if (!senderId) continue;

        const envelopeBase: MessageEnvelope = {
          providerMessageId,
          channel: "whatsapp_cloud",
          channelKey: phoneNumberId,
          threadId: senderId,
          senderId,
          recipientId: sanitizeIdentifierStrict(m?.to) || undefined,
          conversationKey: {
            workspaceId: "workspace:unknown",
            channel: "whatsapp_cloud",
            channelAccountId: phoneNumberId,
            threadId: senderId,
          },
          receivedAt: parseTimestamp(m?.timestamp),
          text: "",
          messageType: "text",
          metadata: {
            rawPayload: safePayload,
            channelMessageType: sanitizeIdentifierStrict(m?.type),
            messageId: providerMessageId,
            phoneNumberId,
            contactName,
            contact: sanitizeMetadataText(contact),
          },
        };

      if (m?.type === "text") {
          const text = normalizeTextMessage(m?.text?.body);
          if (!text) continue;
          out.push({ ...envelopeBase, text, messageType: "text" });
          continue;
        }

        if (m?.type === "image") {
          const caption = sanitizeMetadataText(m?.image?.caption);
          const mimeType = sanitizeMimeType("image", m?.image?.mime_type);
          const providerAssetId = sanitizeIdentifierStrict(m?.image?.id);
          if (!mimeType || !providerAssetId) continue;

          const fileName = sanitizeFileName(m?.image?.filename, `image_${providerMessageId}.jpg`);
          out.push({
            ...envelopeBase,
            text: caption || "[Imagen recibida]",
            messageType: "image",
            media: {
              providerAssetId,
              fileName,
              mimeType,
              raw: m,
            },
            metadata: {
              ...envelopeBase.metadata,
              mediaId: providerAssetId,
              mediaMimeType: mimeType,
            },
          });
          continue;
        }

        if (m?.type === "audio") {
          const mimeType = sanitizeMimeType("audio", m?.audio?.mime_type);
          const providerAssetId = sanitizeIdentifierStrict(m?.audio?.id);
          if (!mimeType || !providerAssetId) continue;

          out.push({
            ...envelopeBase,
            text: "[Mensaje de voz recibido. Transcripción no disponible en este momento.]",
            messageType: "audio",
            media: {
              providerAssetId,
              fileName: `audio_${providerMessageId}.ogg`,
              mimeType,
              raw: m,
            },
            metadata: {
              ...envelopeBase.metadata,
              mediaId: providerAssetId,
              mediaMimeType: mimeType,
            },
          });
          continue;
        }

        if (m?.type === "document") {
          const mimeType = sanitizeMimeType("document", m?.document?.mime_type);
          const providerAssetId = sanitizeIdentifierStrict(m?.document?.id);
          if (!mimeType || !providerAssetId) continue;

          const fileName = sanitizeFileName(m?.document?.filename, `document_${providerMessageId}`);
          out.push({
            ...envelopeBase,
            text: fileName ? `[Documento recibido: ${fileName}]` : "[Documento recibido]",
            messageType: "document",
            media: {
              providerAssetId,
              fileName,
              mimeType,
              raw: m,
            },
            metadata: {
              ...envelopeBase.metadata,
              fileName: fileName || null,
              mediaMimeType: mimeType,
            },
          });
          continue;
        }

        const fallback = sanitizeMetadataText(m?.text?.body) || sanitizeMetadataText(m?.caption) || "Mensaje recibido";
        if (!fallback) continue;
        out.push({
          ...envelopeBase,
          text: normalizeTextMessage(fallback),
          messageType: "text",
        });
      }
    }
  }

  return out;
}

export function normalizeMessengerMessages(payload: any): MessageEnvelope[] {
  const out: MessageEnvelope[] = [];
  const safePayload = normalizeIncomingPayload<any>(payload);
  if (!safePayload) return out;

  const entries = Array.isArray(safePayload.entry) ? safePayload.entry : [];
  for (const entry of entries) {
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    const pageId = sanitizeIdentifierStrict(entry?.id);

    for (const event of messaging) {
      if (!event || typeof event !== "object") continue;
      if (event?.message?.is_echo || event?.delivery || event?.read) continue;

      const senderId = sanitizeIdentifierStrict(event?.sender?.id);
      const recipientId = sanitizeIdentifierStrict(event?.recipient?.id) || pageId;
      const message = event?.message;
      if (!senderId || !recipientId || !message) continue;

      const providerMessageId = sanitizeIdentifierStrict(message?.mid);
      if (!providerMessageId) {
        continue;
      }
      const envelopeBase: MessageEnvelope = {
        providerMessageId,
        channel: "messenger",
        channelKey: recipientId,
        threadId: senderId,
        senderId,
        recipientId,
        conversationKey: {
          workspaceId: "workspace:unknown",
          channel: "messenger",
          channelAccountId: recipientId,
          threadId: senderId,
        },
        receivedAt: parseTimestamp(event?.timestamp),
        text: "",
        messageType: "text",
        metadata: {
          rawPayload: safePayload,
          pageId: recipientId,
          messageMid: providerMessageId,
        },
      };

      if (typeof message?.text === "string") {
        const text = normalizeTextMessage(message.text);
        if (!text) continue;
        out.push({ ...envelopeBase, text, messageType: "text" });
        continue;
      }

      if (message?.text?.body) {
        const text = normalizeTextMessage(message.text.body);
        if (!text) continue;
        out.push({ ...envelopeBase, text, messageType: "text" });
        continue;
      }

      const firstAttachment = Array.isArray(message?.attachments) ? message.attachments[0] : null;
      if (!firstAttachment) continue;

      const type = sanitizeIdentifierStrict(firstAttachment?.type || "").toLowerCase();
      const attachmentPayload = firstAttachment?.payload || {};
      const mimeType = sanitizeMimeType(type as MessageEnvelope["messageType"], attachmentPayload?.mime_type || firstAttachment?.mime_type);

      if (type === "audio" && mimeType) {
        out.push({
          ...envelopeBase,
          text: "[Audio recibido. Transcripción no disponible.]",
          messageType: "audio",
          media: {
            fileName: sanitizeFileName(attachmentPayload?.name, `audio_${providerMessageId}.ogg`),
            mimeType,
            raw: firstAttachment,
          },
          metadata: {
            ...envelopeBase.metadata,
            attachmentType: type,
            attachmentMime: mimeType,
          },
        });
        continue;
      }

      if (type === "image" && mimeType) {
        out.push({
          ...envelopeBase,
          text: "[Imagen recibida]",
          messageType: "image",
          media: {
            fileName: sanitizeFileName(attachmentPayload?.name, `image_${providerMessageId}.jpg`),
            mimeType,
            raw: firstAttachment,
          },
          metadata: {
            ...envelopeBase.metadata,
            attachmentType: type,
            attachmentMime: mimeType,
          },
        });
        continue;
      }

      if ((type === "file" || type === "application") && mimeType) {
        const url = sanitizeMediaUrl(attachmentPayload?.url);
        const fileName = sanitizeFileName(attachmentPayload?.name, `document_${providerMessageId}`);
        out.push({
          ...envelopeBase,
          text: fileName ? `[Documento recibido: ${fileName}]` : "[Documento recibido]",
          messageType: "document",
          media: {
            fileName,
            mimeType,
            url,
            raw: firstAttachment,
          },
          metadata: {
            ...envelopeBase.metadata,
            attachmentType: type,
            attachmentMime: mimeType,
          },
        });
        continue;
      }
    }
  }

  return out;
}

export function normalizeWeChatMessage(rawXml: string, parsed: any): MessageEnvelope | null {
  if (!rawXml || typeof rawXml !== "string") return null;
  const sanitizedXml = rawXml.slice(0, MAX_CHANNEL_PAYLOAD_LENGTH);

  const msgType = sanitizeIdentifierStrict(parsed?.MsgType);
  const from = sanitizeIdentifierStrict(parsed?.FromUserName);
  const to = sanitizeIdentifierStrict(parsed?.ToUserName);
  const msgId = sanitizeIdentifierStrict(parsed?.MsgId);

  if (!from || !to) return null;
  if (!msgId) return null;

  const envelopeBase: MessageEnvelope = {
    providerMessageId: msgId,
    channel: "wechat",
    channelKey: to,
    threadId: from,
    senderId: from,
    recipientId: to,
    conversationKey: {
      workspaceId: "workspace:unknown",
      channel: "wechat",
      channelAccountId: to,
      threadId: from,
    },
    receivedAt: parseTimestamp(parsed?.CreateTime),
    text: "",
    messageType: "text",
    metadata: {
      rawPayload: sanitizedXml,
      msgType,
      event: sanitizeMetadataText(parsed?.Event),
      eventKey: sanitizeMetadataText(parsed?.EventKey),
      toUserName: to,
      fromUserName: from,
    },
  };

    if (msgType === "text") {
    const text = normalizeTextMessage(parsed?.Content);
    if (!text) return null;
    return { ...envelopeBase, text };
  }

  if (msgType === "image") {
    const mimeType = sanitizeMimeType("image", "image/jpeg");
    if (!mimeType) return null;
    return {
      ...envelopeBase,
      text: "[Imagen recibida]",
      messageType: "image",
      media: {
        fileName: `image_${msgId}.jpg`,
        mimeType,
        raw: parsed,
      },
    };
  }

  if (msgType === "voice") {
    const mimeType = sanitizeMimeType("audio", parsed?.Format || "audio/ogg");
    if (!mimeType) return null;
    return {
      ...envelopeBase,
      text: "[Mensaje de voz recibido. Transcripción no disponible.]",
      messageType: "audio",
      media: {
        fileName: `audio_${msgId}.ogg`,
        mimeType,
        raw: parsed,
      },
    };
  }

  if (msgType === "doc") {
    const mimeType = sanitizeMimeType("document", parsed?.FileMd5 || "application/octet-stream");
    const fileName = sanitizeFileName(parsed?.Title, `document_${msgId}`);
    if (!mimeType) return null;
    return {
      ...envelopeBase,
      text: `[Documento recibido: ${fileName}]`,
      messageType: "document",
      media: {
        fileName,
        mimeType,
        raw: parsed,
      },
    };
  }

  return null;
}

export function normalizeTelegramMessages(payload: any): MessageEnvelope[] {
  const out: MessageEnvelope[] = [];
  const safePayload = normalizeIncomingPayload<any>(payload);
  if (!safePayload) return out;

  const msg = safePayload?.message;
  if (!msg) return out;

  const text = sanitizeTextForStorage(msg?.text);
  const caption = sanitizeMetadataText(msg?.caption);
  const chatId = sanitizeChatId(msg?.chat?.id);
  const messageId = sanitizeIdentifierStrict(msg?.message_id);
  const from = sanitizeIdentifierStrict(msg?.from?.id);
  if (!chatId || !from || !messageId) return out;

  const conversationAccountId = "default";
  const baseEnvelope: MessageEnvelope = {
    providerMessageId: messageId,
    channel: "telegram",
    channelKey: conversationAccountId,
    threadId: chatId,
    senderId: from,
    recipientId: chatId,
    conversationKey: {
      workspaceId: "workspace:unknown",
      channel: "telegram",
      channelAccountId: conversationAccountId,
      threadId: chatId,
    },
    receivedAt: parseTimestamp(msg?.date || Date.now()),
    text: "",
    messageType: "text",
    metadata: {
      rawPayload: safePayload,
      from,
      chatId,
      fromFirstName: sanitizeMetadataText(msg?.from?.first_name),
      fromLastName: sanitizeMetadataText(msg?.from?.last_name),
      fromUsername: sanitizeMetadataText(msg?.from?.username),
    },
  };

  if (msg?.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    const photo = msg.photo[msg.photo.length - 1];
    const photoText = caption || "[Imagen recibida en Telegram]";
    const photoFileId = sanitizeIdentifierStrict(photo?.file_id);
    if (!photoFileId) return out;
    out.push({
      ...baseEnvelope,
      text: photoText,
      messageType: "image",
      metadata: {
        ...baseEnvelope.metadata,
        photoId: photoFileId,
      },
      media: {
        providerAssetId: photoFileId,
        fileName: `telegram-photo-${messageId}.jpg`,
        mimeType: "image/jpeg",
        raw: photo,
      },
    });
    return out;
  }

  if (msg?.voice) {
    const mimeType = sanitizeMimeType("audio", msg?.voice?.mime_type);
    if (!mimeType) return out;
    const voiceId = sanitizeIdentifierStrict(msg?.voice?.file_id);
    if (!voiceId) return out;

    out.push({
      ...baseEnvelope,
      text: "[Audio recibido. Transcripción no disponible.]",
      messageType: "audio",
      metadata: {
        ...baseEnvelope.metadata,
        voiceId,
      },
      media: {
        providerAssetId: voiceId,
        fileName: `telegram-voice-${messageId}.ogg`,
        mimeType,
        raw: msg?.voice,
      },
    });
    return out;
  }

  if (msg?.audio) {
    const mimeType = sanitizeMimeType("audio", msg?.audio?.mime_type || "audio/mpeg");
    const audioId = sanitizeIdentifierStrict(msg?.audio?.file_id);
    if (!mimeType || !audioId) return out;
    out.push({
      ...baseEnvelope,
      text: "[Audio recibido. Transcripción no disponible.]",
      messageType: "audio",
      metadata: {
        ...baseEnvelope.metadata,
        audioId,
      },
      media: {
        providerAssetId: audioId,
        fileName: `telegram-audio-${messageId}.mp3`,
        mimeType,
        raw: msg?.audio,
      },
    });
    return out;
  }

  if (msg?.document) {
    const mimeType = sanitizeMimeType("document", msg?.document?.mime_type);
    const documentId = sanitizeIdentifierStrict(msg?.document?.file_id);
    if (!mimeType || !documentId) return out;
    const fileName = sanitizeFileName(msg?.document?.file_name, `document_${messageId}`);
    out.push({
      ...baseEnvelope,
      text: `[Documento recibido: ${fileName}]`,
      messageType: "document",
      metadata: {
        ...baseEnvelope.metadata,
        documentId,
      },
      media: {
        providerAssetId: documentId,
        fileName,
        mimeType,
        raw: msg?.document,
      },
    });
    return out;
  }

  if (!text) return out;

  out.push({
    ...baseEnvelope,
    text,
    messageType: "text",
  });

  return out;
}

export function normalizeTelegramMessageForHandshake(payload: any): MessageEnvelope | null {
  return normalizeTelegramMessages(payload)[0] ?? null;
}

export function withConversationKeyDefaults(
  envelope: MessageEnvelope,
  workspaceId: string,
  channelKey: string,
  threadId: string,
): MessageEnvelope {
  return {
    ...envelope,
    channelKey,
    threadId,
    conversationKey: {
      workspaceId,
      channel: envelope.channel,
      channelAccountId: channelKey,
      threadId,
    },
  };
}

export function buildFallbackEnvelope(channel: ExternalChannel, base: {
  providerMessageId?: string;
  threadId: string;
  senderId: string;
  recipientId?: string;
  text?: string;
  messageType?: MessageEnvelope["messageType"];
  metadata?: Record<string, unknown>;
}): MessageEnvelope {
  const channelKey = base.recipientId || base.threadId;
  return {
    providerMessageId: base.providerMessageId || `${channel}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    channel,
    channelKey,
    threadId: base.threadId,
    senderId: base.senderId,
    recipientId: base.recipientId,
    conversationKey: {
      workspaceId: "workspace:unknown",
      channel,
      channelAccountId: channelKey,
      threadId: base.threadId,
    },
    receivedAt: new Date().toISOString(),
    text: base.text || "",
    messageType: base.messageType || "text",
    metadata: {
      rawPayload: null,
      ...base.metadata,
    },
  };
}

export { ExternalChannel as ParsedChannel, ConversationKey };
