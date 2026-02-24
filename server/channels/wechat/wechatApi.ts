import {
  channelFetch,
  normalizeChannelId,
  normalizeChannelText,
  readResponseTextSafe,
  sanitizeOutboundFilePayload,
} from "../channelTransport";

const WECHAT_API_BASE = "https://api.weixin.qq.com";
const WECHAT_API_HOST = "api.weixin.qq.com";
const WECHAT_MAX_TEXT_LEN = 600;
const WECHAT_MAX_RETRY_ATTEMPTS = 2;
const WECHAT_RETRY_BASE_MS = 650;
const WECHAT_RETRY_JITTER_MS = 250;
const MAX_RESPONSE_TEXT_LEN = 2048;
const WECHAT_TOKEN_TTL_MS = 6_900_000;

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function chunkText(text: string, maxLen = WECHAT_MAX_TEXT_LEN): string[] {
  const cleaned = normalizeChannelText(text, 4_000).trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += maxLen) {
    parts.push(cleaned.slice(i, i + maxLen));
  }
  return parts;
}

function normalizeToken(raw: unknown): string {
  return normalizeChannelText(raw, 512).replace(/\s+/g, "");
}

function normalizeId(value: unknown, fallback = 64): string {
  return normalizeChannelId(value, fallback);
}

function normalizeText(value: unknown): string {
  return normalizeChannelText(value, WECHAT_MAX_TEXT_LEN).trim();
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function computeBackoffMs(attempt: number): number {
  const multiplier = Math.min(6, Math.max(1, attempt));
  const exponential = WECHAT_RETRY_BASE_MS * 2 ** multiplier;
  const jitter = Math.floor(Math.random() * WECHAT_RETRY_JITTER_MS);
  return exponential + jitter;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonSafe(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function getWeChatAccessToken(input: {
  appId: string;
  appSecret: string;
}): Promise<string> {
  const appId = normalizeId(input.appId, 64);
  const appSecret = normalizeToken(input.appSecret);
  if (!appId || !appSecret) {
    throw new Error("Invalid WeChat credentials");
  }

  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt) {
    return cachedAccessToken.token;
  }

  const tokenEndpoint = `${WECHAT_API_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const response = await channelFetch(tokenEndpoint, { method: "GET" }, {
    expectedHost: WECHAT_API_HOST,
    allowedHostSuffixes: [WECHAT_API_HOST],
    timeoutMs: 25_000,
    traceId: `wechat-token:${appId}`,
  });

  const bodyText = await readResponseTextSafe(response, MAX_RESPONSE_TEXT_LEN);
  if (!response.ok) {
    throw new Error(`WeChat token request failed: HTTP ${response.status} ${bodyText}`);
  }

  const payload = parseJsonSafe(bodyText);
  const errorCode = payload.errcode;
  if (typeof errorCode === "number" && errorCode > 0) {
    throw new Error(`WeChat token error: ${errorCode} ${payload.errmsg || "unknown"}`);
  }

  const token = typeof payload.access_token === "string" ? payload.access_token : "";
  const expires = typeof payload.expires_in === "number" && payload.expires_in > 0
    ? payload.expires_in * 1000
    : WECHAT_TOKEN_TTL_MS;
  if (!token) {
    throw new Error("WeChat token response missing access_token");
  }

  cachedAccessToken = {
    token,
    expiresAt: Date.now() + Math.max(WECHAT_TOKEN_TTL_MS, expires - 300_000),
  };

  return token;
}

export async function wechatSendText(input: {
  openId: string;
  text: string;
  appId: string;
  appSecret: string;
}): Promise<void> {
  const openId = normalizeId(input.openId, 64);
  if (!openId) throw new Error("Invalid WeChat openId");

  const accessToken = await getWeChatAccessToken({
    appId: input.appId,
    appSecret: input.appSecret,
  });

  const safeTextParts = chunkText(input.text, WECHAT_MAX_TEXT_LEN).map(normalizeText);
  const endpoint = `${WECHAT_API_BASE}/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`;
  const tracePrefix = `wechat-text:${openId}`;

  for (const [index, part] of safeTextParts.entries()) {
    let lastError: string | null = null;
    if (!part) continue;

    for (let attempt = 0; attempt <= WECHAT_MAX_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(computeBackoffMs(attempt));

      const response = await channelFetch(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            touser: openId,
            msgtype: "text",
            text: { content: part },
          }),
        },
        {
          expectedHost: WECHAT_API_HOST,
          allowedHostSuffixes: [WECHAT_API_HOST],
          timeoutMs: 20_000,
          traceId: `${tracePrefix}:${index}`,
        },
      );

      const responseText = await readResponseTextSafe(response, MAX_RESPONSE_TEXT_LEN);
      if (!response.ok) {
        lastError = `HTTP ${response.status} ${responseText}`;
        if (isRetryableStatus(response.status) && attempt < WECHAT_MAX_RETRY_ATTEMPTS) {
          continue;
        }
        break;
      }

      const payload = parseJsonSafe(responseText);
      const errorCode = typeof payload.errcode === "number" ? payload.errcode : 0;
      if (errorCode && errorCode !== 0) {
        throw new Error(`WeChat send error: ${errorCode} ${payload.errmsg || "unknown"}`);
      }

      lastError = null;
      break;
    }

    if (lastError) throw new Error(`WeChat send text failed: ${lastError}`);
  }
}

export async function wechatSendDocument(input: {
  openId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  appId: string;
  appSecret: string;
}): Promise<void> {
  const openId = normalizeId(input.openId, 64);
  if (!openId) {
    throw new Error("Invalid WeChat openId");
  }

  const accessToken = await getWeChatAccessToken({
    appId: input.appId,
    appSecret: input.appSecret,
  });

  const fileValidation = sanitizeOutboundFilePayload({
    kind: "document",
    fileBuffer: input.fileBuffer,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
  if (!fileValidation.ok) {
    throw new Error(`Invalid WeChat document payload: ${fileValidation.reason}`);
  }

  const uploadUrl = `${WECHAT_API_BASE}/cgi-bin/media/upload?access_token=${encodeURIComponent(accessToken)}&type=file`;
  const uploadContext = `wechat-upload:${openId}`;
  let mediaId: string | null = null;
  let uploadError = "media_upload_failed";

  for (let attempt = 0; attempt <= WECHAT_MAX_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(computeBackoffMs(attempt));

    const form = new FormData();
    form.append(
      "media",
      new Blob([new Uint8Array(fileValidation.value.fileBuffer)], { type: fileValidation.value.mimeType }),
      fileValidation.value.fileName,
    );

    const uploadResponse = await channelFetch(
      uploadUrl,
      { method: "POST", body: form },
      {
        expectedHost: WECHAT_API_HOST,
        allowedHostSuffixes: [WECHAT_API_HOST],
        timeoutMs: 45_000,
        traceId: `${uploadContext}:${attempt}`,
      },
    );

    const uploadText = await readResponseTextSafe(uploadResponse, MAX_RESPONSE_TEXT_LEN);
    if (!uploadResponse.ok) {
      uploadError = `HTTP ${uploadResponse.status} ${uploadText}`;
      if (isRetryableStatus(uploadResponse.status) && attempt < WECHAT_MAX_RETRY_ATTEMPTS) {
        continue;
      }
      break;
    }

    const uploadPayload = parseJsonSafe(uploadText);
    const errorCode = typeof uploadPayload.errcode === "number" ? uploadPayload.errcode : 0;
    if (errorCode && errorCode !== 0) {
      uploadError = `WeChat media upload error: ${errorCode} ${uploadPayload.errmsg || "unknown"}`;
      break;
    }

    const candidate = typeof uploadPayload.media_id === "string" ? uploadPayload.media_id : "";
    if (!candidate) {
      uploadError = "WeChat media upload did not return media_id";
      break;
    }
    mediaId = candidate;
    uploadError = "";
    break;
  }

  if (!mediaId) {
    throw new Error(uploadError || "WeChat media upload failed");
  }

  const sendUrl = `${WECHAT_API_BASE}/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`;
  const sendPayload = {
    touser: openId,
    msgtype: "file",
    file: { media_id: mediaId },
  };

  for (let attempt = 0; attempt <= WECHAT_MAX_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(computeBackoffMs(attempt));

    const sendResponse = await channelFetch(
      sendUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendPayload),
      },
      {
        expectedHost: WECHAT_API_HOST,
        allowedHostSuffixes: [WECHAT_API_HOST],
        timeoutMs: 30_000,
        traceId: `wechat-senddoc:${openId}`,
      },
    );

    if (!sendResponse.ok) {
      const body = await readResponseTextSafe(sendResponse, MAX_RESPONSE_TEXT_LEN);
      if (isRetryableStatus(sendResponse.status) && attempt < WECHAT_MAX_RETRY_ATTEMPTS) {
        continue;
      }
      throw new Error(`WeChat document send failed: HTTP ${sendResponse.status} ${body}`);
    }

    const body = await readResponseTextSafe(sendResponse, MAX_RESPONSE_TEXT_LEN);
    const data = parseJsonSafe(body);
    const errorCode = typeof data.errcode === "number" ? data.errcode : 0;
    if (errorCode && errorCode !== 0) {
      throw new Error(`WeChat document send error: ${errorCode} ${data.errmsg || "unknown"}`);
    }

    return;
  }
}

/** Parse WeChat's flat XML message into a plain object. */
export function parseWeChatXml(raw: string): Record<string, string> | null {
  if (!raw || typeof raw !== "string") return null;
  const result: Record<string, string> = {};
  const normalized = normalizeChannelText(raw, 20_000);
  const tagRegex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>|<(\w+)>(\d+)<\/\3>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(normalized)) !== null) {
    const key = match[1] || match[3];
    const value = match[2] ?? match[4];
    if (key && value !== undefined) result[key] = normalizeText(value);
  }
  return Object.keys(result).length > 0 ? result : null;
}
