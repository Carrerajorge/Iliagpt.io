import {
  channelFetch,
  normalizeChannelId,
  normalizeChannelText,
  readResponseTextSafe,
  sanitizeOutboundFilePayload,
} from "../channelTransport";

const FB_GRAPH_BASE = "https://graph.facebook.com";
const FB_GRAPH_HOST = "graph.facebook.com";
const FB_API_VERSION = "v21.0";
const MESSENGER_MAX_TEXT_LEN = 2000;
const MESSENGER_MAX_RETRY_ATTEMPTS = 2;
const MESSENGER_RETRY_BASE_MS = 650;
const MESSENGER_RETRY_JITTER_MS = 250;
const MAX_RESPONSE_TEXT_LEN = 2048;

function chunkText(text: string, maxLen = MESSENGER_MAX_TEXT_LEN): string[] {
  const cleaned = normalizeChannelText(text, 4_000).trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += maxLen) {
    parts.push(cleaned.slice(i, i + maxLen));
  }
  return parts;
}

function normalizeRecipientId(value: unknown): string {
  return normalizeChannelId(value, 64);
}

function normalizeMessageText(value: unknown, maxLen = MESSENGER_MAX_TEXT_LEN): string {
  return normalizeChannelText(value, maxLen).trim();
}

function normalizeToken(raw: string): string {
  return normalizeChannelText(raw, 1024).replace(/\s+/g, "");
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function computeBackoffMs(attempt: number): number {
  const multiplier = Math.min(6, Math.max(1, attempt));
  const exponential = MESSENGER_RETRY_BASE_MS * 2 ** multiplier;
  const jitter = Math.floor(Math.random() * MESSENGER_RETRY_JITTER_MS);
  return exponential + jitter;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function messengerSendText(input: {
  recipientId: string;
  text: string;
  accessToken: string;
}): Promise<void> {
  const recipientId = normalizeRecipientId(input.recipientId);
  const accessToken = normalizeToken(input.accessToken);
  const parts = chunkText(input.text);
  if (!recipientId || !accessToken) {
    throw new Error("Invalid Messenger recipient or access token");
  }
  if (parts.length === 0) return;

  const url = `${FB_GRAPH_BASE}/${FB_API_VERSION}/me/messages`;
  const payloadBase = {
    messaging_type: "RESPONSE",
    recipient: { id: recipientId },
  };

  for (const [partIndex, part] of parts.entries()) {
    let lastError: string | null = null;

    for (let attempt = 0; attempt <= MESSENGER_MAX_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(computeBackoffMs(attempt));

      const response = await channelFetch(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            ...payloadBase,
            message: { text: normalizeMessageText(part) },
          }),
        },
        {
          expectedHost: FB_GRAPH_HOST,
          allowedHostSuffixes: [FB_GRAPH_HOST],
          traceId: `messenger-text:${recipientId}:${partIndex}`,
        },
      );

      if (response.ok) {
        lastError = null;
        break;
      }

      const responseText = await readResponseTextSafe(response, MAX_RESPONSE_TEXT_LEN);
      lastError = `HTTP ${response.status} ${responseText}`;
      if (!isRetryableStatus(response.status)) break;
    }

    if (lastError) {
      throw new Error(`Messenger text send failed (part ${partIndex + 1}/${parts.length}): ${lastError}`);
    }
  }
}

export async function messengerSendDocument(input: {
  recipientId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  accessToken: string;
}): Promise<void> {
  const recipientId = normalizeRecipientId(input.recipientId);
  const accessToken = normalizeToken(input.accessToken);
  if (!recipientId || !accessToken) {
    throw new Error("Invalid Messenger recipient or access token");
  }

  const fileValidation = sanitizeOutboundFilePayload({
    kind: "document",
    fileBuffer: input.fileBuffer,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
  if (!fileValidation.ok) {
    throw new Error(`Invalid Messenger document payload: ${fileValidation.reason}`);
  }

  const url = `${FB_GRAPH_BASE}/${FB_API_VERSION}/me/messages`;
  const formPayload = {
    messaging_type: "RESPONSE",
    recipient: { id: recipientId },
    message: { attachment: { type: "file", payload: { is_reusable: false } } },
  };

  let lastError = "unknown";
  for (let attempt = 0; attempt <= MESSENGER_MAX_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(computeBackoffMs(attempt));

    const form = new FormData();
    form.append("messaging_type", formPayload.messaging_type);
    form.append("recipient", JSON.stringify(formPayload.recipient));
    form.append("message", JSON.stringify(formPayload.message));
    form.append(
      "filedata",
      new Blob([new Uint8Array(fileValidation.value.fileBuffer)], { type: fileValidation.value.mimeType }),
      fileValidation.value.fileName,
    );

    const response = await channelFetch(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      },
      {
        expectedHost: FB_GRAPH_HOST,
        allowedHostSuffixes: [FB_GRAPH_HOST],
        timeoutMs: 45_000,
        traceId: `messenger-doc:${recipientId}`,
      },
    );

    if (response.ok) {
      return;
    }

    lastError = `HTTP ${response.status} ${await readResponseTextSafe(response, MAX_RESPONSE_TEXT_LEN)}`;
    if (!isRetryableStatus(response.status) || attempt >= MESSENGER_MAX_RETRY_ATTEMPTS) {
      break;
    }
  }

  throw new Error(`Messenger sendDocument failed: ${lastError}`);
}
