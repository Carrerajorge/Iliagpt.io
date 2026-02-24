import {
  channelFetch,
  normalizeChannelId,
  normalizeChannelText,
  readResponseTextSafe,
  sanitizeOutboundFilePayload,
} from "../channelTransport";

const WHATSAPP_GRAPH_BASE = "https://graph.facebook.com";
const WHATSAPP_GRAPH_HOST = "graph.facebook.com";
const WHATSAPP_API_VERSION = "v21.0";
const WHATSAPP_MAX_TEXT_LEN = 1400;
const WHATSAPP_MAX_TOKEN_LENGTH = 1024;
const WHATSAPP_MAX_RETRY_ATTEMPTS = 2;
const WHATSAPP_RETRY_BASE_MS = 600;
const WHATSAPP_RETRY_JITTER_MS = 240;
const MAX_RESPONSE_TEXT_LEN = 2048;

function chunkText(text: string, maxLen = WHATSAPP_MAX_TEXT_LEN): string[] {
  const cleaned = normalizeChannelText(text, 4_000).trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += maxLen) {
    parts.push(cleaned.slice(i, i + maxLen));
  }
  return parts;
}

function normalizeTextPart(value: unknown, maxLen = WHATSAPP_MAX_TEXT_LEN): string {
  return normalizeChannelText(value, maxLen).trim();
}

function normalizeToken(raw: unknown): string {
  return normalizeChannelText(raw, WHATSAPP_MAX_TOKEN_LENGTH).replace(/\s+/g, "");
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function buildBackoffMs(attempt: number): number {
  const multiplier = Math.min(6, Math.max(1, attempt));
  const exponential = WHATSAPP_RETRY_BASE_MS * 2 ** multiplier;
  const jitter = Math.floor(Math.random() * WHATSAPP_RETRY_JITTER_MS);
  return exponential + jitter;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMediaCaption(caption?: string): string | undefined {
  if (!caption) return undefined;
  const normalized = normalizeTextPart(caption, 1024);
  return normalized || undefined;
}

async function readJsonSafe(response: Response): Promise<Record<string, unknown>> {
  const text = await readResponseTextSafe(response, MAX_RESPONSE_TEXT_LEN);
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { raw: text };
  }
}

export async function sendWhatsAppCloudDocument(input: {
  phoneNumberId: string;
  to: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  accessToken: string;
  caption?: string;
}): Promise<void> {
  const safePhoneNumberId = normalizeChannelId(input.phoneNumberId, 128);
  const safeRecipient = normalizeChannelId(input.to, 128);
  const safeToken = normalizeToken(input.accessToken);
  const safeCaption = normalizeMediaCaption(input.caption);
  if (!safePhoneNumberId || !safeRecipient) {
    throw new Error("WhatsApp Cloud: invalid phone number or recipient");
  }
  if (!safeToken) {
    throw new Error("WhatsApp Cloud: missing access token");
  }

  const validation = sanitizeOutboundFilePayload({
    kind: "document",
    fileBuffer: input.fileBuffer,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
  if (!validation.ok) {
    throw new Error(`WhatsApp Cloud: invalid document payload (${validation.reason})`);
  }

  const file = {
    fileBuffer: validation.value.fileBuffer,
    fileName: validation.value.fileName,
    mimeType: validation.value.mimeType,
  };

  const uploadUrl = `${WHATSAPP_GRAPH_BASE}/${WHATSAPP_API_VERSION}/${encodeURIComponent(safePhoneNumberId)}/media`;
  let mediaId: string | null = null;
  let uploadError: string | null = null;

  for (let attempt = 0; attempt <= WHATSAPP_MAX_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(buildBackoffMs(attempt));

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([new Uint8Array(file.fileBuffer)], { type: file.mimeType }), file.fileName);
    form.append("type", file.mimeType);

    const uploadResponse = await channelFetch(
      uploadUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${safeToken}`,
        },
        body: form,
      },
      {
        expectedHost: WHATSAPP_GRAPH_HOST,
        allowedHostSuffixes: [WHATSAPP_GRAPH_HOST],
        timeoutMs: 45_000,
        traceId: `wa-doc-upload:${safeRecipient}`,
      },
    );

    const uploadBody = await readJsonSafe(uploadResponse);
    if (uploadResponse.ok) {
      mediaId = typeof uploadBody.id === "string" ? uploadBody.id.slice(0, 128) : "";
      uploadError = null;
      if (mediaId) break;
      uploadError = "WhatsApp Cloud upload response missing media id";
      break;
    }

    uploadError = `HTTP ${uploadResponse.status}: ${uploadBody.error || uploadBody.raw || "upload_failed"}`;
    if (!isRetryableStatus(uploadResponse.status)) {
      break;
    }
  }

  if (!mediaId) {
    throw new Error(uploadError || "WhatsApp Cloud media upload failed");
  }

  const sendUrl = `${WHATSAPP_GRAPH_BASE}/${WHATSAPP_API_VERSION}/${encodeURIComponent(safePhoneNumberId)}/messages`;
  for (let attempt = 0; attempt <= WHATSAPP_MAX_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(buildBackoffMs(attempt));
    const sendResponse = await channelFetch(
      sendUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${safeToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: safeRecipient,
          type: "document",
          document: {
            id: mediaId,
            filename: file.fileName,
            caption: safeCaption,
          },
        }),
      },
      {
        expectedHost: WHATSAPP_GRAPH_HOST,
        allowedHostSuffixes: [WHATSAPP_GRAPH_HOST],
        timeoutMs: 30_000,
        traceId: `wa-doc-send:${safeRecipient}`,
      },
    );

    if (sendResponse.ok) return;

    const bodyText = await readResponseTextSafe(sendResponse, MAX_RESPONSE_TEXT_LEN);
    if (!isRetryableStatus(sendResponse.status) || attempt >= WHATSAPP_MAX_RETRY_ATTEMPTS) {
      throw new Error(`WhatsApp Cloud send failed: HTTP ${sendResponse.status} ${bodyText}`);
    }
  }
}

export async function sendWhatsAppCloudText(input: {
  phoneNumberId: string;
  to: string;
  text: string;
  accessToken: string;
}): Promise<void> {
  const safePhoneNumberId = normalizeChannelId(input.phoneNumberId, 128);
  const safeRecipient = normalizeChannelId(input.to, 128);
  const safeToken = normalizeToken(input.accessToken);
  if (!safePhoneNumberId || !safeRecipient) {
    throw new Error("WhatsApp Cloud: invalid phone number or recipient");
  }
  if (!safeToken) {
    throw new Error("WhatsApp Cloud: missing access token");
  }

  const parts = chunkText(input.text, WHATSAPP_MAX_TEXT_LEN).map((part) => normalizeTextPart(part));
  if (parts.length === 0) return;

  const url = `${WHATSAPP_GRAPH_BASE}/${WHATSAPP_API_VERSION}/${encodeURIComponent(safePhoneNumberId)}/messages`;

  for (const [partIndex, part] of parts.entries()) {
    const safePart = normalizeTextPart(part, WHATSAPP_MAX_TEXT_LEN);
    if (!safePart) continue;
    let sendError: string | null = null;

    for (let attempt = 0; attempt <= WHATSAPP_MAX_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(buildBackoffMs(attempt));

      const resp = await channelFetch(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${safeToken}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: safeRecipient,
            type: "text",
            text: { body: safePart },
          }),
        },
        {
          expectedHost: WHATSAPP_GRAPH_HOST,
          allowedHostSuffixes: [WHATSAPP_GRAPH_HOST],
          timeoutMs: 30_000,
          traceId: `wa-text:${safeRecipient}:${partIndex}`,
        },
      );

      if (resp.ok) {
        sendError = null;
        break;
      }

      sendError = `HTTP ${resp.status} ${await readResponseTextSafe(resp, MAX_RESPONSE_TEXT_LEN)}`;
      if (!isRetryableStatus(resp.status)) break;
    }

    if (sendError) {
      throw new Error(`WhatsApp Cloud text send failed for part ${partIndex + 1}/${parts.length}: ${sendError}`);
    }
  }
}
