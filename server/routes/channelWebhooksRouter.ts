import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { env } from "../config/env";
import { Logger } from "../lib/logger";
import { submitChannelIngest } from "../channels/channelIngestQueue";
import {
  verifyTelegramSecretToken,
  verifyWhatsAppSignature256,
  verifyMessengerSignature256,
  verifyWeChatSignature,
  extractWebhookPayloadTimestamp,
  isWebhookTimestampFresh,
} from "../channels/webhookSecurity";
import express from "express";
import { INGEST_RUN_ID_RE, MAX_INGEST_RUN_ID_LENGTH } from "../channels/types";

const MAX_WEBHOOK_PAYLOAD_BYTES = 128 * 1024;
const MAX_WEBHOOK_QUERY_BYTES = 2048;
const MAX_WEBHOOK_QUERY_PAIRS = 80;
const MAX_WEBHOOK_QUERY_KEY_LENGTH = 128;
const MAX_WEBHOOK_QUERY_VALUE_LENGTH = 1024;
const MAX_WEBHOOK_HEADER_COUNT = 80;
const MAX_WEBHOOK_HEADER_NAME_LENGTH = 96;
const MAX_WEBHOOK_HEADER_VALUE_LENGTH = 1024;
const MAX_WEBHOOK_PATH_LENGTH = 256;
const MAX_WEBHOOK_CONTENT_TYPE_LENGTH = 128;
const MAX_WEBHOOK_RUN_ID_LENGTH = 96;
const EFFECTIVE_MAX_WEBHOOK_RUN_ID_LENGTH = Math.min(MAX_WEBHOOK_RUN_ID_LENGTH, MAX_INGEST_RUN_ID_LENGTH);
const WEBHOOK_RUN_ID_RE = INGEST_RUN_ID_RE;
const WEBHOOK_MAX_AGE_MS = 6 * 60 * 1000;
const WEBHOOK_REPLAY_TTL_MS = 10 * 60 * 1000;
const WEBHOOK_REPLAY_MAX_ENTRIES = 2000;

const ALLOWED_JSON_WEBHOOK_CONTENT_TYPES = new Set(["application/json"]);
const ALLOWED_XML_WEBHOOK_CONTENT_TYPES = new Set(["text/xml", "application/xml"]);

const webhookReplayCache = new Map<string, number>();
const REQUIRE_WEBHOOK_SECRETS = env.NODE_ENV === "production";

type WebhookBoundaryFailure = {
  status: number;
  code: string;
  reason?: string;
};

type WebhookBoundaryResult =
  | { ok: true; rawBody: Buffer }
  | { ok: false; failure: WebhookBoundaryFailure };

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizeWebhookText(raw: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof raw === "number" || typeof raw === "boolean") {
    raw = String(raw);
  }
  if (typeof raw !== "string") return null;

  const normalized = raw.normalize("NFKC").trim();
  if (!allowEmpty && normalized.length === 0) return null;
  if (normalized.length > maxLength) return null;
  if (hasControlCharacters(normalized)) return null;
  return normalized;
}

function normalizeContentType(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.length === 0 || trimmed.length > MAX_WEBHOOK_CONTENT_TYPE_LENGTH) return null;
    if (hasControlCharacters(trimmed)) return null;
    return trimmed.split(";")[0]?.trim() ?? null;
  }

  if (Array.isArray(raw)) {
    for (const value of raw) {
      const normalized = normalizeContentType(value);
      if (normalized) return normalized;
    }
  }

  return null;
}

function normalizeWebhookId(raw: unknown, maxLength = MAX_WEBHOOK_RUN_ID_LENGTH): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.normalize("NFKC").replace(/\u0000/g, "").replace(/[\x00-\x1f\x7f]/g, "").trim();
  const safeMaxLength = Math.min(maxLength, EFFECTIVE_MAX_WEBHOOK_RUN_ID_LENGTH);
  if (normalized.length === 0 || normalized.length > safeMaxLength) return null;
  if (!WEBHOOK_RUN_ID_RE.test(normalized)) return null;
  return normalized;
}

function readWebhookRunId(req: Request, channel: string): string {
  const candidates = [
    req.header("x-run-id"),
    req.header("x-correlation-id"),
    req.header("x-request-id"),
    req.header("x-idempotency-key"),
    req.header("idempotency-key"),
    req.header("x-telegram-bot-api-secret-token"),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeWebhookId(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const body = getRawBodyBuffer(req);
  const bodyHash = crypto.createHash("sha256")
    .update(body ? body.toString("utf8") : "")
    .update(req.path || "")
    .update(normalizeReplayQueryFingerprint(req))
    .digest("hex")
    .slice(0, 48);

  const fallback = `${channel}_${bodyHash}`;
  return normalizeWebhookId(fallback) || `run_${crypto.createHash("sha256").update(fallback).digest("hex").slice(0, 48)}`;
}

function setWebhookCorrelationHeaders(res: Response, runId: string): void {
  const normalizedRunId = normalizeWebhookId(runId);
  if (!normalizedRunId) return;
  res.setHeader("x-correlation-id", normalizedRunId);
  res.setHeader("x-request-id", normalizedRunId);
  res.setHeader("x-run-id", normalizedRunId);
}

function extractQueryPairs(query: Request["query"]): Array<[string, string]> {
  const entries = Object.entries(query ?? {});
  const pairs: Array<[string, string]> = [];

  const pushValue = (name: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (pairs.length >= MAX_WEBHOOK_QUERY_PAIRS) return;
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          const sanitizedName = sanitizeQueryKey(name);
          const sanitizedValue = normalizeWebhookText(item, MAX_WEBHOOK_QUERY_VALUE_LENGTH);
          if (!sanitizedName || !sanitizedValue) return;
          pairs.push([sanitizedName, sanitizedValue]);
        }
      }
      return;
    }

    if (pairs.length >= MAX_WEBHOOK_QUERY_PAIRS) return;
    const sanitizedName = sanitizeQueryKey(name);
    const sanitizedValue = normalizeWebhookText(value, MAX_WEBHOOK_QUERY_VALUE_LENGTH);
    if (!sanitizedName || !sanitizedValue) return;
    pairs.push([sanitizedName, sanitizedValue]);
  };

  for (const [rawName, rawValue] of entries) {
    if (pairs.length >= MAX_WEBHOOK_QUERY_PAIRS) break;
    if (!sanitizeQueryKey(rawName)) return [];
    pushValue(rawName, rawValue);
  }

  return pairs;
}

function sanitizeQueryKey(rawName: string): string | null {
  return normalizeWebhookText(rawName, MAX_WEBHOOK_QUERY_KEY_LENGTH);
}

function validateWebhookQueryBoundary(req: Request): WebhookBoundaryFailure | null {
  const queryString = req.url.includes("?") ? req.url.substring(req.url.indexOf("?") + 1) : "";
  if (queryString.length > MAX_WEBHOOK_QUERY_BYTES) {
    return { status: 414, code: "query_too_long" };
  }

  const entries = Object.entries(req.query ?? {});
  if (entries.length > MAX_WEBHOOK_QUERY_PAIRS) {
    return { status: 400, code: "query_too_many_params" };
  }

  for (const [rawName, rawValue] of entries) {
    const name = normalizeWebhookText(rawName, MAX_WEBHOOK_QUERY_KEY_LENGTH);
    if (!name) {
      return { status: 400, code: "invalid_query_name" };
    }

    if (Array.isArray(rawValue)) {
      if (rawValue.length > MAX_WEBHOOK_QUERY_PAIRS) {
        return { status: 400, code: "query_too_many_values" };
      }
      for (const item of rawValue) {
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          const value = normalizeWebhookText(item, MAX_WEBHOOK_QUERY_VALUE_LENGTH);
          if (!value) return { status: 400, code: "invalid_query_value" };
          continue;
        }
        return { status: 400, code: "invalid_query_value" };
      }
      continue;
    }

    if (typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
      const value = normalizeWebhookText(rawValue, MAX_WEBHOOK_QUERY_VALUE_LENGTH);
      if (!value && rawValue !== "" && rawValue !== 0) {
        return { status: 400, code: "invalid_query_value" };
      }
      continue;
    }

    return { status: 400, code: "invalid_query_value" };
  }

  return null;
}

function validateWebhookHeadersBoundary(req: Request): WebhookBoundaryFailure | null {
  const headers = Object.entries(req.headers);
  if (headers.length > MAX_WEBHOOK_HEADER_COUNT) {
    return { status: 431, code: "too_many_headers" };
  }

  for (const [name, rawValue] of headers) {
    const headerName = normalizeWebhookText(name, MAX_WEBHOOK_HEADER_NAME_LENGTH, true);
    if (!headerName) return { status: 400, code: "invalid_header_name" };

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (value === undefined || value === null) continue;
      const headerValue = normalizeWebhookText(
        typeof value === "string" ? value : String(value),
        MAX_WEBHOOK_HEADER_VALUE_LENGTH,
        true,
      );
      if (!headerValue) return { status: 400, code: "invalid_header_value" };
    }
  }

  return null;
}

function validateWebhookCommonBoundary(req: Request): WebhookBoundaryFailure | null {
  if (typeof req.path !== "string" || req.path.length > MAX_WEBHOOK_PATH_LENGTH) {
    return { status: 400, code: "invalid_path" };
  }
  const queryFailure = validateWebhookQueryBoundary(req);
  if (queryFailure) return queryFailure;
  return validateWebhookHeadersBoundary(req);
}

function validateWebhookPostBoundary(req: Request, allowedContentTypes: ReadonlySet<string>): WebhookBoundaryResult {
  const commonFailure = validateWebhookCommonBoundary(req);
  if (commonFailure) return { ok: false, failure: commonFailure };

  const contentType = normalizeContentType(req.headers["content-type"]);
  if (!contentType || !allowedContentTypes.has(contentType)) {
    return { ok: false, failure: { status: 415, code: "unsupported_media_type" } };
  }

  const rawBody = getRawBodyBuffer(req);
  if (!rawBody) return { ok: false, failure: { status: 400, code: "invalid_payload" } };
  if (rawBody.length > MAX_WEBHOOK_PAYLOAD_BYTES) return { ok: false, failure: { status: 413, code: "payload_too_large" } };

  return { ok: true, rawBody };
}

function validateWebhookGetBoundary(req: Request): WebhookBoundaryFailure | null {
  return validateWebhookCommonBoundary(req);
}

function rejectWebhookBoundary(res: Response, channel: string, req: Request, failure: WebhookBoundaryFailure) {
  Logger.warn("[Webhooks] Boundary validation rejected", {
    channel,
    path: req.path,
    status: failure.status,
    code: failure.code,
    reason: failure.reason,
  });
  return res.status(failure.status).send(failure.code);
}

function parseWebhookQueryTimestamp(raw: unknown): number | null {
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = normalizeWebhookText(raw, 13, true);
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeWebhookTimestamp(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value > 0 && value < 1_000_000_000_000 ? value * 1000 : value;
}

function normalizeReplayProviderKey(req: Request): string {
  const telegramToken = req.headers["x-telegram-bot-api-secret-token"];
  const normalizedTelegramToken = normalizeWebhookText(telegramToken, 512);
  if (normalizedTelegramToken) return normalizedTelegramToken;

  const hubSig256 = req.headers["x-hub-signature-256"];
  const normalizedHubSig256 = normalizeWebhookText(hubSig256, 512);
  if (normalizedHubSig256) return normalizedHubSig256;

  const hubSig = req.headers["x-hub-signature"];
  const normalizedHubSig = normalizeWebhookText(hubSig, 512);
  if (normalizedHubSig) return normalizedHubSig;

  return "";
}

function normalizeReplayQueryFingerprint(req: Request): string {
  const normalized = extractQueryPairs(req.query);
  if (normalized.length > MAX_WEBHOOK_QUERY_PAIRS) {
    normalized.length = MAX_WEBHOOK_QUERY_PAIRS;
  }

  normalized.sort(([aName, aValue], [bName, bValue]) => {
    const nameOrder = aName.localeCompare(bName);
    if (nameOrder !== 0) return nameOrder;
    return aValue.localeCompare(bValue);
  });

  return new URLSearchParams(normalized).toString();
}

function pruneWebhookReplayCache(nowMs: number): void {
  for (const [key, startedAt] of webhookReplayCache.entries()) {
    if (nowMs - startedAt > WEBHOOK_REPLAY_TTL_MS) {
      webhookReplayCache.delete(key);
    }
  }

  if (webhookReplayCache.size <= WEBHOOK_REPLAY_MAX_ENTRIES) {
    return;
  }

  const excess = webhookReplayCache.size - WEBHOOK_REPLAY_MAX_ENTRIES;
  const keys = Array.from(webhookReplayCache.keys()).slice(0, excess);
  for (const key of keys) {
    webhookReplayCache.delete(key);
  }
}

function buildWebhookReplayKey(channel: string, req: Request): string {
  const rawBody = getRawBodyBuffer(req);
  const body = rawBody ? rawBody.toString("utf8") : "";

  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const queryHash = crypto.createHash("sha256")
    .update(normalizeReplayQueryFingerprint(req))
    .digest("hex");

  return `${channel}|${req.path}|${normalizeReplayProviderKey(req)}|${bodyHash}|${queryHash}`;
}

function isWebhookReplay(channel: string, req: Request): boolean {
  const key = buildWebhookReplayKey(channel, req);
  const now = Date.now();
  pruneWebhookReplayCache(now);
  if (webhookReplayCache.has(key)) return true;
  webhookReplayCache.set(key, now);
  return false;
}

function isTimestampFreshOrMissing(timestampMs: number | null): boolean {
  if (timestampMs === null) return true;
  return isWebhookTimestampFresh(timestampMs, { maxSkewMs: WEBHOOK_MAX_AGE_MS });
}

function getRawBodyBuffer(req: Request): Buffer | null {
  const raw = (req as any).rawBody;
  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === "string") return Buffer.from(raw);
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body == null) return null;
  try {
    if (typeof req.body === "object" || Array.isArray(req.body) || typeof req.body === "number" || typeof req.body === "boolean") {
      return Buffer.from(JSON.stringify(req.body));
    }
  } catch {
    return null;
  }
  return null;
}

function getWebhookTimestampFromRequest(channel: "telegram" | "whatsapp_cloud" | "messenger" | "wechat", req: Request): number | null {
  if (channel === "wechat") {
    return normalizeWebhookTimestamp(parseWebhookQueryTimestamp(req.query.timestamp));
  }

  const queryTimestamp = parseWebhookQueryTimestamp(req.query.timestamp ?? req.query["hub.timestamp"]);
  if (Number.isFinite(queryTimestamp)) {
    return normalizeWebhookTimestamp(queryTimestamp);
  }
  return extractWebhookPayloadTimestamp((req as any).body);
}

export function createChannelWebhooksRouter(): Router {
  const router = Router();

  // Telegram webhook: setWebhook(url, secret_token) makes Telegram include:
  // X-Telegram-Bot-Api-Secret-Token header on each request.
  router.post("/telegram", async (req: Request, res: Response) => {
    const boundary = validateWebhookPostBoundary(req, ALLOWED_JSON_WEBHOOK_CONTENT_TYPES);
    if (!boundary.ok) {
      return rejectWebhookBoundary(res, "telegram", req, boundary.failure);
    }
    const runId = readWebhookRunId(req, "telegram");
    setWebhookCorrelationHeaders(res, runId);

    try {
      if (isWebhookReplay("telegram", req)) {
        return res.status(200).send("ok");
      }

      const eventTimestamp = getWebhookTimestampFromRequest("telegram", req);
      if (!isTimestampFreshOrMissing(eventTimestamp)) {
        return res.status(200).send("stale");
      }

      if (req.body == null) return res.status(400).send("invalid_payload");

      const ok = verifyTelegramSecretToken({
        providedToken: req.header("x-telegram-bot-api-secret-token") || undefined,
        expectedToken: env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
        requireSecret: REQUIRE_WEBHOOK_SECRETS,
      });
      if (!ok) return res.status(403).send("forbidden");

      await submitChannelIngest({
        channel: "telegram",
        update: req.body,
        receivedAt: new Date().toISOString(),
        runId,
      });

      return res.status(200).send("ok");
    } catch (err) {
      Logger.error("[Webhooks] Telegram ingest failed", err);
      return res.status(200).send("ok"); // avoid Telegram retry storms on transient server errors
    }
  });

  // WhatsApp Cloud webhook verification (Meta)
  router.get("/whatsapp", (req: Request, res: Response) => {
    const boundary = validateWebhookGetBoundary(req);
    if (boundary) return rejectWebhookBoundary(res, "whatsapp_cloud", req, boundary);
    setWebhookCorrelationHeaders(res, readWebhookRunId(req, "whatsapp_cloud"));

    const eventTimestamp = getWebhookTimestampFromRequest("whatsapp_cloud", req);
    if (eventTimestamp && !isWebhookTimestampFresh(eventTimestamp, { maxSkewMs: WEBHOOK_MAX_AGE_MS })) {
      return res.status(403).send("stale");
    }

    const mode = normalizeWebhookText(req.query["hub.mode"], 64);
    const token = normalizeWebhookText(req.query["hub.verify_token"], 512);
    const challenge = normalizeWebhookText(req.query["hub.challenge"], 4096, true);

    if (!mode || !token || !challenge) return res.status(400).send("invalid_request");

    // Security: use timing-safe comparison to prevent token brute-force via timing analysis
    if (mode === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && token &&
        token.length === env.WHATSAPP_VERIFY_TOKEN.length &&
        crypto.timingSafeEqual(Buffer.from(token), Buffer.from(env.WHATSAPP_VERIFY_TOKEN))) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("forbidden");
  });

  router.post("/whatsapp", async (req: Request, res: Response) => {
    const boundary = validateWebhookPostBoundary(req, ALLOWED_JSON_WEBHOOK_CONTENT_TYPES);
    if (!boundary.ok) {
      return rejectWebhookBoundary(res, "whatsapp_cloud", req, boundary.failure);
    }
    const runId = readWebhookRunId(req, "whatsapp_cloud");
    setWebhookCorrelationHeaders(res, runId);

    try {
      if (isWebhookReplay("whatsapp_cloud", req)) {
        return res.status(200).send("ok");
      }

      const eventTimestamp = getWebhookTimestampFromRequest("whatsapp_cloud", req);
      if (!isTimestampFreshOrMissing(eventTimestamp)) {
        return res.status(200).send("stale");
      }

      if (req.body == null) return res.status(400).send("invalid_payload");

      const sig = req.header("x-hub-signature-256") || undefined;
      const ok = verifyWhatsAppSignature256({
        rawBody: boundary.rawBody,
        headerSignature: sig,
        appSecret: env.WHATSAPP_APP_SECRET,
        requireSecret: REQUIRE_WEBHOOK_SECRETS,
      });
      if (!ok) return res.status(403).send("forbidden");

      await submitChannelIngest({
        channel: "whatsapp_cloud",
        payload: req.body,
        receivedAt: new Date().toISOString(),
        runId,
      });

      return res.status(200).send("ok");
    } catch (err) {
      Logger.error("[Webhooks] WhatsApp ingest failed", err);
      return res.status(200).send("ok");
    }
  });

  // Messenger webhook verification (Meta — same pattern as WhatsApp)
  router.get("/messenger", (req: Request, res: Response) => {
    const boundary = validateWebhookGetBoundary(req);
    if (boundary) return rejectWebhookBoundary(res, "messenger", req, boundary);
    setWebhookCorrelationHeaders(res, readWebhookRunId(req, "messenger"));

    const eventTimestamp = getWebhookTimestampFromRequest("messenger", req);
    if (eventTimestamp && !isWebhookTimestampFresh(eventTimestamp, { maxSkewMs: WEBHOOK_MAX_AGE_MS })) {
      return res.status(403).send("stale");
    }

    const mode = normalizeWebhookText(req.query["hub.mode"], 64);
    const token = normalizeWebhookText(req.query["hub.verify_token"], 512);
    const challenge = normalizeWebhookText(req.query["hub.challenge"], 4096, true);

    if (!mode || !token || !challenge) return res.status(400).send("invalid_request");

    // Security: use timing-safe comparison to prevent token brute-force via timing analysis
    if (mode === "subscribe" && env.MESSENGER_VERIFY_TOKEN && token &&
        token.length === env.MESSENGER_VERIFY_TOKEN.length &&
        crypto.timingSafeEqual(Buffer.from(token), Buffer.from(env.MESSENGER_VERIFY_TOKEN))) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("forbidden");
  });

  router.post("/messenger", async (req: Request, res: Response) => {
    const boundary = validateWebhookPostBoundary(req, ALLOWED_JSON_WEBHOOK_CONTENT_TYPES);
    if (!boundary.ok) {
      return rejectWebhookBoundary(res, "messenger", req, boundary.failure);
    }
    const runId = readWebhookRunId(req, "messenger");
    setWebhookCorrelationHeaders(res, runId);

    try {
      if (isWebhookReplay("messenger", req)) {
        return res.status(200).send("ok");
      }

      const eventTimestamp = getWebhookTimestampFromRequest("messenger", req);
      if (!isTimestampFreshOrMissing(eventTimestamp)) {
        return res.status(200).send("stale");
      }

      if (req.body == null) return res.status(400).send("invalid_payload");

      const sig = req.header("x-hub-signature-256") || undefined;
      const ok = verifyMessengerSignature256({
        rawBody: boundary.rawBody,
        headerSignature: sig,
        appSecret: env.MESSENGER_APP_SECRET,
        requireSecret: REQUIRE_WEBHOOK_SECRETS,
      });
      if (!ok) return res.status(403).send("forbidden");

      await submitChannelIngest({
        channel: "messenger",
        payload: req.body,
        receivedAt: new Date().toISOString(),
        runId,
      });

      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      Logger.error("[Webhooks] Messenger ingest failed", err);
      return res.status(200).send("EVENT_RECEIVED");
    }
  });

  // WeChat webhook verification (SHA1 signature, echo echostr)
  router.get("/wechat", (req: Request, res: Response) => {
    const boundary = validateWebhookGetBoundary(req);
    if (boundary) return rejectWebhookBoundary(res, "wechat", req, boundary);
    setWebhookCorrelationHeaders(res, readWebhookRunId(req, "wechat"));

    const eventTimestamp = getWebhookTimestampFromRequest("wechat", req);
    if (!isWebhookTimestampFresh(eventTimestamp, { maxSkewMs: WEBHOOK_MAX_AGE_MS })) {
      return res.status(403).send("stale");
    }

    const signature = normalizeWebhookText(req.query.signature, 512);
    const timestamp = normalizeWebhookText(req.query.timestamp, 32);
    const nonce = normalizeWebhookText(req.query.nonce, 128);
    const echostr = normalizeWebhookText(req.query.echostr, 2048);
    if (!signature || !timestamp || !nonce || !echostr) {
      return res.status(400).send("invalid_request");
    }

    const ok = verifyWeChatSignature({
      signature,
      timestamp,
      nonce,
      token: env.WECHAT_TOKEN,
      requireSecret: REQUIRE_WEBHOOK_SECRETS,
    });
    if (!ok) return res.status(403).send("forbidden");
    return res.status(200).send(echostr);
  });

  // WeChat inbound messages (XML body)
  router.post(
    "/wechat",
    express.text({
      type: ["text/xml", "application/xml", "application/xml; charset=utf-8", "text/xml; charset=utf-8"],
      limit: MAX_WEBHOOK_PAYLOAD_BYTES,
    }),
    async (req: Request, res: Response) => {
    const boundary = validateWebhookPostBoundary(req, ALLOWED_XML_WEBHOOK_CONTENT_TYPES);
    if (!boundary.ok) {
      return rejectWebhookBoundary(res, "wechat", req, boundary.failure);
    }
    const runId = readWebhookRunId(req, "wechat");
    setWebhookCorrelationHeaders(res, runId);

    try {
      if (isWebhookReplay("wechat", req)) {
        return res.status(200).send("success");
      }

      const eventTimestamp = getWebhookTimestampFromRequest("wechat", req);
      if (!isTimestampFreshOrMissing(eventTimestamp)) {
        return res.status(200).send("stale");
      }

      const signature = normalizeWebhookText(req.query.signature, 512);
      const timestamp = normalizeWebhookText(req.query.timestamp, 32);
      const nonce = normalizeWebhookText(req.query.nonce, 128);
      if (!signature || !timestamp || !nonce) {
        return res.status(400).send("invalid_request");
      }

      const ok = verifyWeChatSignature({
        signature,
        timestamp,
        nonce,
        token: env.WECHAT_TOKEN,
        requireSecret: REQUIRE_WEBHOOK_SECRETS,
      });
      if (!ok) return res.status(403).send("forbidden");

      // WeChat sends XML; body is a string after express.text() middleware
      const rawXml = typeof req.body === "string" ? req.body : "";
      if (!rawXml) return res.status(400).send("invalid_payload");

      await submitChannelIngest({
        channel: "wechat",
        payload: rawXml,
        receivedAt: new Date().toISOString(),
        runId,
      });

      // WeChat expects "success" response to acknowledge receipt
      return res.status(200).send("success");
    } catch (err) {
      Logger.error("[Webhooks] WeChat ingest failed", err);
      return res.status(200).send("success");
    }
  });

  return router;
}
