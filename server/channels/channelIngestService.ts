import { createHash } from "crypto";

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type { ChannelIngestJob, ConversationKey, ExternalChannel, MessageEnvelope } from "./types";
import {
  normalizeMessengerMessages,
  normalizeTelegramMessages,
  normalizeWhatsAppMessages,
  normalizeWeChatMessage,
  withConversationKeyDefaults,
} from "./inboundNormalization";
import {
  evaluateChannelPolicy,
  getConversationPolicy,
  getConversationWindowState,
  parseChannelPairingCodeFromMessage,
} from "./channelPolicyEngine";
import {
  consumeChannelPairingCode,
  findAnyActiveTelegramAccount,
  findMessengerAccountByPageId,
  findTelegramAccountByUserId,
  findWeChatAccountByAppId,
  findWhatsAppCloudAccountByPhoneNumberId,
  getOrCreateChannelConversation,
  patchConversationMetadata,
  setConversationOwnerIdentity,
  touchChannelConversationHeartbeat,
} from "./channelStore";
import { parseWeChatXml, wechatSendDocument, wechatSendText } from "./wechat/wechatApi";
import { sendWhatsAppCloudDocument, sendWhatsAppCloudText } from "./whatsappCloud/whatsappCloudApi";
import { messengerSendDocument, messengerSendText } from "./messenger/messengerApi";
import { telegramSendDocument, telegramSendMessage } from "./telegram/telegramApi";
import {
  buildResponseStyleSystemPrompt,
  parseRuntimeConfig,
  resolveRuntimeConfig,
} from "./runtimeConfig";
import type { ChatMessage } from "../../shared/schema/chat";
import { Logger } from "../lib/logger";
import { llmGateway } from "../lib/llmGateway";
import { storage } from "../storage";

type ChannelAccount = {
  id: string;
  userId: string;
  accessToken: string | null;
  metadata: Record<string, unknown> | null;
};

type InboundProcessingContext = {
  jobChannel: ExternalChannel;
  envelope: MessageEnvelope;
  account: ChannelAccount;
  conversation: Awaited<ReturnType<typeof getOrCreateChannelConversation>>;
  runtimeConfig: ReturnType<typeof resolveRuntimeConfig>;
  runAbort?: AbortController;
  skipQueueDuplicateCheck?: boolean;
};

type SendRequest = {
  text: string;
  requestId: string;
  runId: string;
  conversationKey: ConversationKey;
  senderId: string;
  traceId: string;
};

type InFlightRunState = {
  runAbort: AbortController;
  requestId: string;
  runId: string;
  channel: ExternalChannel;
  traceId: string;
  startedAt: number;
};

const RUN_QUEUE_MAX_HISTORY = 60;
const MAX_STREAM_CONTEXT = 80;
const ORCHESTRATION_TIMEOUT_MS = 120_000;
const SEND_RETRY_ATTEMPTS = 2;
const SEND_RETRY_BACKOFF_MS = 750;
const PROVIDER_ID_FALLBACK_KEY = "unknown";
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_OUTBOUND_TEXT_LENGTH = 8_000;
const MAX_ID_LENGTH = 256;
const MAX_REQUEST_ID_LENGTH = 120;
const MAX_WORKSPACE_ID_LENGTH = 200;
const MAX_ENVELOPES_PER_JOB = 12;
const MAX_RATE_BUCKET_ENTRIES = 8_000;
const MAX_MESSAGE_ID_ENTRIES = 120_000;
const INBOUND_MESSAGE_ID_TTL_MS = 15 * 60 * 1000;
const DEDUPE_LOOKUP_TIMEOUT_MS = 2_000;
const STORAGE_OPERATION_TIMEOUT_MS = 8_000;
const IN_FLIGHT_RUN_MAX_AGE_MS = 20 * 60 * 1000;
const CONVERSATION_QUEUE_TIMEOUT_MS = 180_000;
const SAFE_ID_RE = /^[A-Za-z0-9._:\-]+$/;
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9._:\-]+$/;
const DEFAULT_MEDIA_LABEL = {
  image: "[Imagen recibida]",
  audio: "[Audio recibido]",
  document: "[Documento recibido]",
};
const MAX_ASSISTANT_MESSAGE_LENGTH = 16_000;
const ABORT_REASON_PREFIX = "Run aborted";
const OUTBOUND_CIRCUIT_FAILURE_THRESHOLD = 5;
const OUTBOUND_CIRCUIT_OPEN_MS = 60_000;
const OUTBOUND_CIRCUIT_BASE_BACKOFF_MS = 2_000;
const MAX_STREAM_CHUNK_LENGTH = 4_096;
const MAX_CONVERSATION_QUEUES = 2_000;
const EVENT_TRACE_ID_LENGTH = 24;
const ORCHESTRATION_TIMEOUT_JITTER_MS = 10_000;
const MAX_INBOUND_MEDIA_URL_LENGTH = 2_048;
const MAX_INBOUND_MEDIA_HOST_LENGTH = 255;
const MAX_INBOUND_ENVELOPE_TEXT_LENGTH = 8_000;
const MAX_INBOUND_MESSAGE_TYPE_LENGTH = 24;
const MAX_INBOUND_METADATA_KEYS = 140;
const MAX_INBOUND_METADATA_BYTES = 24_000;
const INBOUND_TEXT_SANITIZE_RE = /<[^>]*>|[`*_~#>\[\]{}]/g;
const INBOUND_MALFORMED_MARKUP_RE = /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi;
const INBOUND_JS_SCHEME_RE = /\b(?:javascript|vbscript|data|file)\s*:/gi;
const INBOUND_HTML_ENTITIES_RE = /&(?:nbsp|amp|lt|gt|quot|apos);/gi;
const MAX_URI_DECODE_ITERATIONS = 3;
const POLICY_CONTROLLED_RESPONSE_LENGTH = 420;
const MAX_DEDUPE_KEY_PART_LENGTH = 128;
const MAX_DEDUPE_MESSAGE_ID_LENGTH = MAX_ID_LENGTH;
const MAX_DEDUPE_CONVERSATION_KEY_LENGTH = 512;
const MAX_CONVERSATION_RESERVATIONS = 20_000;
const CONVERSATION_RUN_RESERVATION_TTL_MS = parsePositiveInt(
  process.env.CHANNEL_RUN_RESERVATION_TTL_MS,
  90_000,
  10_000,
  15 * 60_000,
);
const OUTBOUND_SEND_TIMEOUT_MS = parsePositiveInt(
  process.env.CHANNEL_OUTBOUND_SEND_TIMEOUT_MS,
  30_000,
  1_000,
  120_000,
);
const LOCAL_HOST_SUFFIXES = [
  "localhost",
  "127.",
  "::1",
  "0.0.0.0",
  "0:0:0:0:0:0:0:1",
  "[::1]",
  ".local",
  "localhost.",
  "169.254.",
];

type TimedPromise<T> = {
  clear: () => void;
  promise: Promise<T>;
};

type ConversationRunReservation = {
  requestId: string;
  startedAt: number;
  expiresAt: number;
};

const inFlightRunsByConversation = new Map<string, InFlightRunState>();
const conversationQueues = new Map<string, Promise<void>>();
const seenProviderMessageIdsByConversation = new Map<string, number>();
const conversationRateBuckets = new Map<string, { startedAt: number; count: number }>();
const outboundCircuitState = new Map<ExternalChannel, { failures: number; openedUntil?: number; lastFailureAt: number }>();
const conversationRunReservations = new Map<string, ConversationRunReservation>();

// Test-only: clear global ledgers so unit tests don't leak state between cases.
export function __resetChannelIngestLedgersForTests(): void {
  seenProviderMessageIdsByConversation.clear();
  conversationRunReservations.clear();
}

const ENFORCED_INBOUND_MESSAGE_ID_TTL_MS = parsePositiveInt(
  process.env.CHANNEL_INBOUND_MESSAGE_ID_TTL_MS,
  INBOUND_MESSAGE_ID_TTL_MS,
  60_000,
  60 * 60_000,
);
const ENFORCED_DEDUPE_LOOKUP_TIMEOUT_MS = parsePositiveInt(
  process.env.CHANNEL_DEDUPE_LOOKUP_TIMEOUT_MS,
  DEDUPE_LOOKUP_TIMEOUT_MS,
  250,
  20_000,
);
const ENFORCED_STORAGE_OPERATION_TIMEOUT_MS = parsePositiveInt(
  process.env.CHANNEL_STORAGE_OPERATION_TIMEOUT_MS,
  STORAGE_OPERATION_TIMEOUT_MS,
  500,
  60_000,
);
const ENFORCED_IN_FLIGHT_RUN_MAX_AGE_MS = parsePositiveInt(
  process.env.CHANNEL_IN_FLIGHT_RUN_MAX_AGE_MS,
  IN_FLIGHT_RUN_MAX_AGE_MS,
  60_000,
  6 * 60 * 60 * 1000,
);

function isOutboundCircuitOpen(channel: ExternalChannel): boolean {
  const state = outboundCircuitState.get(channel);
  if (!state?.openedUntil) return false;

  const now = Date.now();
  if (now >= state.openedUntil) {
    outboundCircuitState.delete(channel);
    return false;
  }

  return true;
}

function markOutboundCircuitSuccess(channel: ExternalChannel): void {
  outboundCircuitState.delete(channel);
}

function markOutboundCircuitFailure(channel: ExternalChannel, reason: string): void {
  const state = outboundCircuitState.get(channel) || { failures: 0, lastFailureAt: 0 };
  const next: { failures: number; lastFailureAt: number; openedUntil?: number } = {
    failures: state.failures + 1,
    lastFailureAt: Date.now(),
  };

  if (next.failures >= OUTBOUND_CIRCUIT_FAILURE_THRESHOLD) {
    next.openedUntil = Date.now() + OUTBOUND_CIRCUIT_OPEN_MS;
    Logger.warn("[Channels] outbound circuit opened", {
      channel,
      failures: next.failures,
      reason,
      reopenAt: new Date(next.openedUntil).toISOString(),
    });
  }

  outboundCircuitState.set(channel, next);
}

function computeOutboundBackoff(attempt: number, jitterLimit = 250): number {
  const attemptMultiplier = Math.min(attempt, 6);
  const exponential = SEND_RETRY_BACKOFF_MS * Math.pow(2, attemptMultiplier);
  const jitter = Math.floor(Math.random() * jitterLimit);
  const max = Math.min(OUTBOUND_CIRCUIT_BASE_BACKOFF_MS * 20, exponential + jitter);
  return max;
}

function isAllowedByRateLimit(conversationKey: string, perMinute: number): { allowed: boolean; retryAfterMs?: number } {
  if (!perMinute || perMinute <= 0) return { allowed: true };

  const now = Date.now();
  const current = conversationRateBuckets.get(conversationKey);
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    conversationRateBuckets.set(conversationKey, { startedAt: now, count: 1 });
    return { allowed: true };
  }

  if (current.count < perMinute) {
    current.count += 1;
    return { allowed: true };
  }

  return { allowed: false, retryAfterMs: current.startedAt + RATE_LIMIT_WINDOW_MS - now };
}

function pruneRateBuckets(ttlMs = RATE_LIMIT_WINDOW_MS): void {
  const now = Date.now();
  for (const [key, value] of conversationRateBuckets.entries()) {
    if (now - value.startedAt > ttlMs) conversationRateBuckets.delete(key);
  }

  if (conversationRateBuckets.size > MAX_RATE_BUCKET_ENTRIES) {
    const excess = conversationRateBuckets.size - MAX_RATE_BUCKET_ENTRIES;
    let removed = 0;
    for (const key of conversationRateBuckets.keys()) {
      conversationRateBuckets.delete(key);
      removed += 1;
      if (removed >= excess) break;
    }
  }
}

function serializeConversationKey(conversationKey: ConversationKey): string {
  return [conversationKey.workspaceId, conversationKey.channel, conversationKey.channelAccountId, conversationKey.threadId]
    .map((value) => String(value ?? "").replace(/\|/g, "_"))
    .join("|");
}

function isUniqueViolation(err: unknown): boolean {
  return String((err as any)?.code || "") === "23505";
}

function nowIso(): string {
  return new Date().toISOString();
}

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function isTimeoutLikeError(error: unknown): boolean {
  const message = String((error as Error)?.message || error || "").toLowerCase();
  return message.includes("timeout");
}

type InboundEnvelopeValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

function isInboundMediaUrlSafe(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  const normalized = toCleanText(rawUrl);
  if (!normalized || normalized.length > MAX_INBOUND_MEDIA_URL_LENGTH) return false;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (parsed.username || parsed.password) return false;
    const normalizedHostname = parsed.hostname.toLowerCase();
    if (!normalizedHostname || normalizedHostname.length > MAX_INBOUND_MEDIA_HOST_LENGTH) return false;
    if (LOCAL_HOST_SUFFIXES.some((hostSuffix) => normalizedHostname === hostSuffix || normalizedHostname.endsWith(hostSuffix))) {
      return false;
    }

    const ipv4Parts = normalizedHostname.split(".").map((part) => Number.parseInt(part, 10));
    if (ipv4Parts.length === 4 && ipv4Parts.every((part) => Number.isFinite(part) && part >= 0 && part <= 255)) {
      const [a, b] = ipv4Parts;
      if (
        a === 10
        || a === 127
        || a === 0
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
      ) {
        return false;
      }
    }

    if (normalizedHostname.includes(":")) {
      const bracketed = normalizedHostname.startsWith("[") && normalizedHostname.endsWith("]")
        ? normalizedHostname.slice(1, -1)
        : normalizedHostname;
      if (bracketed === "::1" || bracketed.startsWith("fe80:")) {
        return false;
      }
    }

    if (parsed.pathname.includes("..") || parsed.search.includes("..")) return false;
    const normalizedPath = `${parsed.pathname}${parsed.search || ""}`;
    if (normalizedPath.includes("..")) return false;
    return true;
  } catch {
    return false;
  }
}

function sanitizeInboundText(value: unknown): string {
  if (typeof value !== "string") return "";
  let normalized = toCleanText(value)
    .replace(INBOUND_MALFORMED_MARKUP_RE, "")
    .replace(INBOUND_HTML_ENTITIES_RE, "")
    .replace(INBOUND_TEXT_SANITIZE_RE, "")
    .replace(INBOUND_JS_SCHEME_RE, "[filtered]");
  for (let i = 0; i < MAX_URI_DECODE_ITERATIONS; i += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) {
        break;
      }
      normalized = decoded
        .replace(INBOUND_MALFORMED_MARKUP_RE, "")
        .replace(INBOUND_HTML_ENTITIES_RE, "")
        .replace(INBOUND_TEXT_SANITIZE_RE, "")
        .replace(INBOUND_JS_SCHEME_RE, "[filtered]");
    } catch {
      break;
    }
  }

  return normalized
    .slice(0, MAX_INBOUND_ENVELOPE_TEXT_LENGTH);
}

function isInboundMetadataSafe(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  if (Object.keys(metadata as Record<string, unknown>).length > MAX_INBOUND_METADATA_KEYS) return false;

  let size = 0;
  try {
    size = JSON.stringify(metadata)?.length ?? 0;
  } catch {
    return false;
  }

  return size <= MAX_INBOUND_METADATA_BYTES;
}

function validateInboundEnvelope(envelope: MessageEnvelope): InboundEnvelopeValidationResult {
  if (!envelope.providerMessageId || !envelope.threadId || !envelope.senderId) {
    return { ok: false, reason: "missing_core_identifier" };
  }

  const conversationKey = envelope.conversationKey;
  if (!conversationKey?.workspaceId || !conversationKey.channelAccountId || !conversationKey.threadId) {
    return { ok: false, reason: "invalid_conversation_key" };
  }

  if (!sanitizeInboundText(envelope.text) && envelope.messageType !== "unsupported") {
    return { ok: false, reason: "empty_message_text" };
  }

  if (!isInboundMetadataSafe(envelope.metadata)) {
    return { ok: false, reason: "invalid_metadata_payload" };
  }

  const safeType = sanitizeInboundText(envelope.messageType);
  if (!safeType || safeType.length > MAX_INBOUND_MESSAGE_TYPE_LENGTH) return { ok: false, reason: "invalid_message_type" };

  if (!["text", "image", "audio", "document", "unsupported"].includes(envelope.messageType)) {
    return { ok: false, reason: "unsupported_message_type" };
  }

  if (envelope.media) {
    if (envelope.media.fileName && sanitizeInboundText(envelope.media.fileName).length === 0) {
      return { ok: false, reason: "invalid_media_file_name" };
    }
    if (envelope.media.url && !isInboundMediaUrlSafe(envelope.media.url)) {
      return { ok: false, reason: "invalid_media_url" };
    }
    if (envelope.media.mimeType && !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(envelope.media.mimeType)) {
      return { ok: false, reason: "invalid_media_mime" };
    }
  }

  return { ok: true };
}

function createTimeoutTask<T>(timeoutMs: number, reason: string): TimedPromise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(reason));
    }, timeoutMs);
  });

  return {
    promise,
    clear() {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
  };
}

async function withTimeoutGuard<T>(
  operationName: string,
  timeoutMs: number,
  task: () => Promise<T>,
): Promise<T> {
  const timeout = createTimeoutTask<T>(timeoutMs, `${operationName}_timeout`);
  try {
    return await Promise.race([task(), timeout.promise]);
  } finally {
    timeout.clear();
  }
}

function normalizeIdentifier(value: unknown, maxLength = MAX_ID_LENGTH): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();

  if (!normalized || normalized.length > maxLength) return null;
  if (!SAFE_ID_RE.test(normalized)) return null;
  return normalized;
}

function toCleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function sanitizeReceivedAt(value: unknown): string {
  const candidate = String(value ?? "").trim();
  if (!candidate) return nowIso();

  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) return nowIso();

  const now = Date.now();
  // Reject timestamps more than 5 minutes in the future or more than 7 days in the past
  const MAX_FUTURE_MS = 5 * 60 * 1000;
  const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;
  if (parsed > now + MAX_FUTURE_MS || parsed < now - MAX_PAST_MS) {
    return nowIso();
  }

  return new Date(parsed).toISOString();
}

function normalizeTextPayload(value: string): string {
  const trimmed = toCleanText(value);
  return trimmed.length > 0 ? trimmed : "";
}

function sanitizeMessageType(value: MessageEnvelope["messageType"] | unknown): MessageEnvelope["messageType"] {
  if (value === "text" || value === "image" || value === "audio" || value === "document" || value === "unsupported") {
    return value;
  }

  return "unsupported";
}

function buildConversationScopedRequestId(
  conversationKey: string,
  providerMessageId: string,
  senderId?: string,
): string {
  const safeSenderId = senderId
    ? senderId
      .normalize("NFKC")
      .replace(/\u0000/g, "")
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
      .replace(/\|/g, "_")
      .trim()
      .slice(0, MAX_DEDUPE_KEY_PART_LENGTH)
    : "";
  const canonical = `${conversationKey}|${safeSenderId || "sender:unknown"}|${providerMessageId}`;
  const safeCanonical = sanitizeRequestIdentifier(canonical);
  if (safeCanonical && safeCanonical.length <= MAX_REQUEST_ID_LENGTH) {
    return safeCanonical;
  }

  const digest = createHash("sha256").update(canonical).digest("hex");
  return sanitizeRequestIdentifier(`${providerMessageId.slice(0, 24)}_${digest}`).slice(0, MAX_REQUEST_ID_LENGTH);
}

function buildEventTraceId(conversationKey: string, providerMessageId: string, requestId: string): string {
  const canonical = `${conversationKey}|${providerMessageId}|${requestId}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, EVENT_TRACE_ID_LENGTH);
}

function buildConversationWorkspaceId(account: ChannelAccount): string {
  const userPart = normalizeIdentifier(account.userId, MAX_WORKSPACE_ID_LENGTH) || "unknown";
  return `workspace:${userPart}`;
}

function envelopeFromRaw(raw: ChannelIngestJob, channel: ExternalChannel): MessageEnvelope[] {
  if (channel === "whatsapp_cloud") {
    return normalizeWhatsAppMessages((raw as any).payload);
  }

  if (channel === "messenger") {
    return normalizeMessengerMessages((raw as any).payload);
  }

  if (channel === "wechat") {
    const parsed = parseWeChatXml(toCleanText((raw as any).payload));
    const message = parsed ? normalizeWeChatMessage(toCleanText((raw as any).payload), parsed) : null;
    return message ? [message] : [];
  }

  // telegram
  return normalizeTelegramMessages((raw as any).update);
}

function buildMessageDedupeInput(value: string, maxLength: number): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .replace(/\|/g, "_")
    .trim()
    .slice(0, maxLength);
}

function buildMessageDedupeKey(conversationKey: string, providerMessageId: string, senderId = "unknown"): string {
  const safeConversationKey = buildMessageDedupeInput(conversationKey, MAX_DEDUPE_CONVERSATION_KEY_LENGTH);
  const safeProviderMessageId = buildMessageDedupeInput(providerMessageId, MAX_DEDUPE_MESSAGE_ID_LENGTH);
  const safeSenderId = buildMessageDedupeInput(senderId, MAX_DEDUPE_KEY_PART_LENGTH);

  const normalizedConversationKey = safeConversationKey.length > 0 ? safeConversationKey : "conversation:unknown";
  const normalizedMessageId = safeProviderMessageId.length > 0 ? safeProviderMessageId : "message:unknown";
  const normalizedSenderId = safeSenderId.length > 0 ? safeSenderId : "sender:unknown";
  return `${normalizedConversationKey}|${normalizedSenderId}|${normalizedMessageId}`;
}

function isAllowedToQueue(conversationKey: string, providerMessageId: string, senderId: string): boolean {
  const dedupeKey = buildMessageDedupeKey(conversationKey, providerMessageId, senderId);
  const lastSeen = seenProviderMessageIdsByConversation.get(dedupeKey) || 0;
  if (!lastSeen) {
    seenProviderMessageIdsByConversation.set(dedupeKey, Date.now());
    return true;
  }
  return false;
}

function pruneMessageIdLedger(ttlMs = ENFORCED_INBOUND_MESSAGE_ID_TTL_MS): void {
  const now = Date.now();
  for (const [id, seenAt] of seenProviderMessageIdsByConversation.entries()) {
    if (now - seenAt > ttlMs) seenProviderMessageIdsByConversation.delete(id);
  }

  if (seenProviderMessageIdsByConversation.size > MAX_MESSAGE_ID_ENTRIES) {
    const excess = seenProviderMessageIdsByConversation.size - MAX_MESSAGE_ID_ENTRIES;
    let removed = 0;
    for (const id of seenProviderMessageIdsByConversation.keys()) {
      seenProviderMessageIdsByConversation.delete(id);
      removed += 1;
      if (removed >= excess) break;
    }
  }
}

function pruneConversationRunReservations(nowMs = Date.now()): void {
  for (const [key, reservation] of conversationRunReservations.entries()) {
    if (nowMs - reservation.startedAt >= CONVERSATION_RUN_RESERVATION_TTL_MS) {
      conversationRunReservations.delete(key);
    }
  }

  if (conversationRunReservations.size <= MAX_CONVERSATION_RESERVATIONS) {
    return;
  }

  const excess = conversationRunReservations.size - MAX_CONVERSATION_RESERVATIONS;
  let removed = 0;
  for (const key of conversationRunReservations.keys()) {
    conversationRunReservations.delete(key);
    removed += 1;
    if (removed >= excess) break;
  }
}

function acquireConversationRunReservation(
  conversationKey: string,
  requestId: string,
): boolean {
  const now = Date.now();
  pruneConversationRunReservations(now);

  const existing = conversationRunReservations.get(conversationKey);
  if (existing && existing.expiresAt > now) {
    if (existing.requestId === requestId) {
      Logger.warn("[Channels] conversation run reservation skipped duplicate event", {
        conversation: conversationKey,
        requestId,
        previousRequestId: existing.requestId,
      });
      return false;
    }

    Logger.warn("[Channels] conversation run reservation blocked by in-flight run", {
      conversation: conversationKey,
      requestId,
      previousRequestId: existing.requestId,
    });
    return false;
  }

  conversationRunReservations.set(conversationKey, {
    requestId,
    startedAt: now,
    expiresAt: now + CONVERSATION_RUN_RESERVATION_TTL_MS,
  });
  return true;
}

function releaseConversationRunReservation(
  conversationKey: string,
  requestId: string,
): void {
  const existing = conversationRunReservations.get(conversationKey);
  if (!existing || existing.requestId !== requestId) return;
  conversationRunReservations.delete(conversationKey);
}

async function resolveChannelAccount(channel: ExternalChannel, envelope: MessageEnvelope): Promise<ChannelAccount | null> {
  if (channel === "whatsapp_cloud") {
    const account = await findWhatsAppCloudAccountByPhoneNumberId(envelope.channelKey);
    if (!account) return null;
    return {
      id: account.id,
      userId: account.userId,
      accessToken: account.accessToken,
      metadata: account.metadata as Record<string, unknown> | null,
    };
  }

  if (channel === "messenger") {
    const account = await findMessengerAccountByPageId(envelope.channelKey);
    if (!account) return null;
    return {
      id: account.id,
      userId: account.userId,
      accessToken: account.accessToken,
      metadata: account.metadata as Record<string, unknown> | null,
    };
  }

  if (channel === "wechat") {
    const appId = toCleanText((envelope.metadata as any)?.appId) || envelope.channelKey;
    const account = await findWeChatAccountByAppId(appId);
    if (!account) return null;
    return {
      id: account.id,
      userId: account.userId,
      accessToken: account.accessToken,
      metadata: account.metadata as Record<string, unknown> | null,
    };
  }

  // telegram
  const accountByThread = await findTelegramAccountByUserId(envelope.channelKey || envelope.senderId);
  if (accountByThread) {
    return {
      id: accountByThread.id,
      userId: accountByThread.userId,
      accessToken: accountByThread.accessToken,
      metadata: accountByThread.metadata as Record<string, unknown> | null,
    };
  }

  const anyAccount = await findAnyActiveTelegramAccount();
  if (!anyAccount) return null;
  return {
    id: anyAccount.id,
    userId: anyAccount.userId,
    accessToken: anyAccount.accessToken,
    metadata: anyAccount.metadata as Record<string, unknown> | null,
  };
}

function buildIncomingTextForHistory(envelope: MessageEnvelope): string {
  const text = normalizeTextPayload(envelope.text);
  if (text) return text;

  const media = envelope.media;
  if (!media) return "[Mensaje sin texto]";

  if (media.providerAssetId || media.url || media.fileName) {
    const kind = envelope.messageType;
    const label = DEFAULT_MEDIA_LABEL[kind as keyof typeof DEFAULT_MEDIA_LABEL] || "[Archivo recibido]";
    const details: string[] = [label];
    if (media.fileName) details.push(`nombre=${media.fileName}`);
    if (media.mimeType) details.push(`mime=${media.mimeType}`);
    return details.join(" ");
  }

  return "[Mensaje recibido]";
}

function buildMessageAttachments(envelope: MessageEnvelope) {
  if (!envelope.media) return [] as Array<Record<string, unknown>>;

  return [{
    type: envelope.messageType,
    mediaProviderId: envelope.media.providerAssetId || null,
    fileName: envelope.media.fileName || null,
    mimeType: envelope.media.mimeType || null,
    url: envelope.media.url || null,
    raw: envelope.media.raw || null,
    sourceChannel: envelope.channel,
    messageId: envelope.providerMessageId,
  }];
}

function withConversationDefaults(conversation: { userId: string }, envelope: MessageEnvelope): MessageEnvelope {
  return withConversationKeyDefaults(
    envelope,
    buildConversationWorkspaceId({ id: "", userId: conversation.userId, accessToken: null, metadata: null }),
    envelope.channelKey || PROVIDER_ID_FALLBACK_KEY,
    envelope.threadId || envelope.senderId,
  );
}

function mergeRuntimeConfig(
  accountMetadata: Record<string, unknown> | null | undefined,
  conversationMetadata: Record<string, unknown> | null | undefined,
) {
  const accountRuntime = parseRuntimeConfig((accountMetadata as Record<string, unknown> | null)?.runtime || accountMetadata || {});
  const conversationRuntime = parseRuntimeConfig(
    (conversationMetadata as Record<string, unknown> | null)?.runtime || conversationMetadata || {},
  );

  return resolveRuntimeConfig({
    ...accountRuntime,
    ...conversationRuntime,
  });
}

function getExplicitRuntimeMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const parsed = parseRuntimeConfig((metadata as Record<string, unknown> | null)?.runtime || metadata || {});

  const runtime: Record<string, unknown> = {};

  if (parsed.responder_enabled !== undefined) runtime.responder_enabled = parsed.responder_enabled;
  if (parsed.owner_only !== undefined) runtime.owner_only = parsed.owner_only;
  if (parsed.owner_external_ids !== undefined) runtime.owner_external_ids = parsed.owner_external_ids;
  if (parsed.response_style !== undefined) runtime.response_style = parsed.response_style;
  if (parsed.custom_prompt !== undefined) runtime.custom_prompt = parsed.custom_prompt;
  if (parsed.allowlist !== undefined) runtime.allowlist = parsed.allowlist;
  if (parsed.rate_limit_per_minute !== undefined) runtime.rate_limit_per_minute = parsed.rate_limit_per_minute;

  return runtime;
}

function asAttachmentFromEnvelope(envelope: MessageEnvelope): { name?: string; contentType?: string; url?: string } | null {
  if (!envelope.media) return null;
  return {
    name: envelope.media.fileName || undefined,
    contentType: envelope.media.mimeType || undefined,
    url: envelope.media.url || undefined,
  };
}

function isAbortSignalActive(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const rawMessage = String((error as Error)?.message || error || "").toLowerCase();
  return rawMessage.includes("aborted") || rawMessage.includes("abort");
}

function registerInFlightRun(
  conversationKey: string,
  state: InFlightRunState,
): void {
  const now = Date.now();
  for (const [key, entry] of inFlightRunsByConversation.entries()) {
    if (now - entry.startedAt <= ENFORCED_IN_FLIGHT_RUN_MAX_AGE_MS) continue;
    try {
      entry.runAbort.abort("Stale run evicted");
    } catch {
      // best effort
    }
    inFlightRunsByConversation.delete(key);
    Logger.warn("[Channels] evicted stale in-flight run", {
      conversation: key,
      runId: entry.runId,
      requestId: entry.requestId,
      channel: entry.channel,
      traceId: entry.traceId,
      startedAt: entry.startedAt,
      maxAgeMs: ENFORCED_IN_FLIGHT_RUN_MAX_AGE_MS,
    });
  }
  inFlightRunsByConversation.set(conversationKey, state);
}

function unregisterInFlightRun(conversationKey: string, state: Pick<InFlightRunState, "requestId" | "runId">): void {
  const current = inFlightRunsByConversation.get(conversationKey);
  if (!current) return;

  if (current.requestId === state.requestId && current.runId === state.runId) {
    inFlightRunsByConversation.delete(conversationKey);
  }
}

function enforceSafeLimit(value: string | undefined | null, limit: number): string {
  if (value == null) return "";
  if (!Number.isFinite(limit) || limit <= 0) return value;
  return value.slice(0, limit);
}

function sanitizeStreamChunk(value: string, limit = MAX_STREAM_CHUNK_LENGTH): string {
  return enforceSafeLimit(
    value
      .normalize("NFKC")
      .replace(/\u0000/g, "")
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, ""),
    limit,
  );
}

function waitForAbortSignal(signal?: AbortSignal): Promise<never> {
  if (!signal) {
    return new Promise<never>(() => { });
  }

  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new Error(ABORT_REASON_PREFIX));
      return;
    }

    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(ABORT_REASON_PREFIX));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function sleepWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }

      reject(new Error(ABORT_REASON_PREFIX));
    };

    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }

      resolve();
    }, delayMs);

    if (!signal) return;
    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function sendTextWithRetries(
  channel: ExternalChannel,
  account: ChannelAccount,
  conversation: InboundProcessingContext["conversation"],
  envelope: MessageEnvelope,
  payload: SendRequest,
  maxRetries = SEND_RETRY_ATTEMPTS,
  abortSignal?: AbortSignal,
): Promise<void> {
  if (abortSignal?.aborted) {
    throw new Error("Run aborted before send");
  }
  const normalizedText = enforceSafeLimit(payload.text, MAX_OUTBOUND_TEXT_LENGTH);
  const safeRecipient = normalizeIdentifier(envelope.threadId, MAX_ID_LENGTH);
  const safeChannelAccount = normalizeIdentifier(conversation.channelKey, MAX_ID_LENGTH);
  if (!safeRecipient || !safeChannelAccount || !normalizedText) {
    throw new Error("Invalid outbound envelope metadata");
  }

  if (isOutboundCircuitOpen(channel)) {
    throw new Error(`Outbound circuit open for ${channel}`);
  }

  let attempt = 0;

  while (true) {
    try {
      let sender: (() => Promise<void>) | null = null;

      if (channel === "whatsapp_cloud") {
        sender = async () => {
          await sendWhatsAppCloudText({
            phoneNumberId: safeChannelAccount,
            to: safeRecipient,
            text: normalizedText,
            accessToken: account.accessToken || "",
          });
        };
      }

      if (channel === "telegram") {
        sender = async () => {
          await telegramSendMessage(safeRecipient, normalizedText);
        };
      }

      if (channel === "messenger") {
        sender = async () => {
          if (!account.accessToken) {
            throw new Error("Missing Messenger access token");
          }
          await messengerSendText({
            recipientId: safeRecipient,
            text: normalizedText,
            accessToken: account.accessToken,
          });
        };
      }

      if (channel === "wechat") {
        sender = async () => {
          const appSecret = toCleanText(account.accessToken || "");
          const appId = toCleanText((conversation.metadata as any)?.appId as string) || conversation.channelKey;
          if (!appId || !appSecret) {
            throw new Error("Missing WeChat credentials");
          }

          await wechatSendText({
            openId: safeRecipient,
            text: normalizedText,
            appId,
            appSecret,
          });
        };
      }

      if (!sender) {
        throw new Error(`Unsupported channel '${channel}'`);
      }

      await withTimeoutGuard(
        `channel_send_${channel}`,
        OUTBOUND_SEND_TIMEOUT_MS,
        async () => Promise.race([sender(), waitForAbortSignal(abortSignal)]),
      );
      markOutboundCircuitSuccess(channel);
      return;
    } catch (error: unknown) {
      if (abortSignal?.aborted) {
        throw new Error("Run aborted before retry");
      }
      if (isAbortSignalActive(error, abortSignal)) {
        throw error;
      }

      markOutboundCircuitFailure(channel, String((error as Error)?.message || error));

      attempt += 1;
      Logger.warn(`[Channels] outbound send failed (attempt ${attempt}/${maxRetries + 1})`, {
        conversation: payload.conversationKey,
        channel,
        senderId: payload.senderId,
        runId: payload.runId,
        requestId: payload.requestId,
        traceId: payload.traceId,
        reason: String((error as Error)?.message || error),
      });

      if (attempt > maxRetries) throw error;

      const backoffMs = computeOutboundBackoff(attempt);
      await sleepWithAbort(backoffMs, abortSignal);
    }
  }
}

function mapToLlmMessages(
  history: ChatMessage[],
  userContent: string | object[],
  stylePrompt: string | null,
): ChatCompletionMessageParam[] {
  const mapped: ChatCompletionMessageParam[] = [];

  if (stylePrompt) {
    mapped.push({ role: "system", content: stylePrompt });
  }

  const bounded = history.slice(-MAX_STREAM_CONTEXT);
  for (const message of bounded) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (!message.content) continue;
    mapped.push({ role: message.role, content: message.content as string });
  }

  mapped.push({ role: "user", content: userContent as any });

  return mapped;
}

async function createRunForMessage(
  chatId: string,
  requestId: string,
  userMessageId: string,
) {
  try {
    return await withTimeoutGuard(
      "channel_create_chat_run",
      ENFORCED_STORAGE_OPERATION_TIMEOUT_MS,
      async () => await storage.createChatRun({
        chatId,
        clientRequestId: requestId,
        userMessageId,
        status: "pending",
      }),
    );
  } catch (error) {
    if (!isUniqueViolation(error) && !isTimeoutLikeError(error)) {
      throw error;
    }

    const fallback = await withTimeoutGuard(
      "channel_get_chat_run_by_request_id",
      ENFORCED_STORAGE_OPERATION_TIMEOUT_MS,
      async () => await storage.getChatRunByClientRequestId(chatId, requestId),
    );
    if (fallback) return fallback;
    throw error;
  }
}

function timeoutMsForChannel(channel: ExternalChannel): number {
  if (channel === "telegram") return 90_000;
  return ORCHESTRATION_TIMEOUT_MS;
}

async function safeQueue<T>(key: string, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // Prevent unbounded growth of the conversation queue map
  if (!conversationQueues.has(key) && conversationQueues.size >= MAX_CONVERSATION_QUEUES) {
    Logger.warn("[Channels] conversation queue map at capacity, rejecting", {
      key: key.slice(0, 40),
      queueSize: conversationQueues.size,
    });
    throw new Error("Conversation queue at capacity");
  }

  const previous = conversationQueues.get(key) || Promise.resolve();
  const queueAbort = new AbortController();
  const timeoutError = new Error("Conversation queue timeout");
  const wrapped = previous
    .catch((error) => {
      Logger.warn(`[Channels] previous job for conversation failed: ${String(error?.message || error)}`);
    })
    .then(async () => {
      return await new Promise<T>((resolve, reject) => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const onAbort = () => {
          if (timeoutId) clearTimeout(timeoutId);
          queueAbort.signal.removeEventListener("abort", onAbort);
          reject(timeoutError);
        };

        timeoutId = setTimeout(() => {
          queueAbort.abort(timeoutError);
        }, CONVERSATION_QUEUE_TIMEOUT_MS);
        queueAbort.signal.addEventListener("abort", onAbort, { once: true });

        task(queueAbort.signal)
          .then(resolve)
          .catch(reject)
          .finally(() => {
            if (timeoutId) clearTimeout(timeoutId);
            queueAbort.signal.removeEventListener("abort", onAbort);
          });
      });
    });

  const queueTail = wrapped.catch(() => undefined) as Promise<void>;
  conversationQueues.set(key, queueTail);

  try {
    return await wrapped;
  } finally {
    if (conversationQueues.get(key) === queueTail) {
      conversationQueues.delete(key);
    }
  }
}

async function abortPreviousRunForConversation(conversationKey: string): Promise<void> {
  const existing = inFlightRunsByConversation.get(conversationKey);
  if (!existing) return;

  Logger.warn("[Channels] aborting in-flight run for conversation", {
    conversation: conversationKey,
    channel: existing.channel,
    runId: existing.runId,
    requestId: existing.requestId,
    traceId: existing.traceId,
  });

  try {
    existing.runAbort.abort("Superseded by newer inbound message");
  } catch (error) {
    // best effort
  } finally {
    inFlightRunsByConversation.delete(conversationKey);
  }
}

async function runOutboundDecision(
  context: InboundProcessingContext,
  assistantContent: string,
  userMessageId: string,
  runId: string,
  requestId: string,
  options?: {
    assistantMessageId?: string;
    skipRunStatusUpdate?: boolean;
    abortSignal?: AbortSignal;
    traceId?: string;
  },
): Promise<void> {
  if (options?.abortSignal?.aborted) {
    throw new Error(ABORT_REASON_PREFIX);
  }

  const safeRequestId = sanitizeRequestIdentifier(requestId);
  if (!safeRequestId) {
    throw new Error("Invalid outbound requestId");
  }

  const safeRunId = sanitizeRequestIdentifier(runId) || safeRequestId;
  const safeTraceId = sanitizeRequestIdentifier(options?.traceId || safeRequestId);
  if (!safeTraceId) {
    throw new Error("Invalid outbound traceId");
  }
  const safeAssistantContent = enforceSafeLimit(
    String(assistantContent ?? "")
      .normalize("NFKC")
      .replace(/[\x00-\x1f\x7f]/g, "")
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
      .trim(),
    MAX_OUTBOUND_TEXT_LENGTH,
  );
  const payload: SendRequest = {
    text: safeAssistantContent,
    requestId: safeRequestId,
    runId: safeRunId,
    conversationKey: context.envelope.conversationKey,
    senderId: context.envelope.threadId,
    traceId: safeTraceId,
  };

  if (!safeAssistantContent) {
    throw new Error("Outbound content empty after sanitization");
  }

  await sendTextWithRetries(
    context.jobChannel,
    context.account,
    context.conversation,
    context.envelope,
    payload,
    SEND_RETRY_ATTEMPTS,
    options?.abortSignal,
  );

  await touchChannelConversationHeartbeat(context.conversation.id, {
    lastOutboundAt: nowIso(),
    lastInboundAt: nowIso(),
  });

  if (options?.assistantMessageId) {
    await storage.updateChatMessageContent(
      options.assistantMessageId,
      safeAssistantContent,
      "done",
      {
        runId: safeRunId,
        requestId: safeRequestId,
        sourceChannel: context.jobChannel,
        conversationKey: context.envelope.conversationKey,
        traceId: safeTraceId,
      }
    ).catch(() => null);
  }

  if (!options?.skipRunStatusUpdate && safeRunId) {
    await storage.updateChatRunStatus(safeRunId, "done").catch(() => null);
    await storage.updateChatRunLastSeq(safeRunId, 0).catch(() => null);
  }

  Logger.info("[Channels] outbound completed", {
    runId: safeRunId || "control-plane",
    conversation: payload.conversationKey,
    channel: context.jobChannel,
    requestId: safeRequestId,
    traceId: safeTraceId,
    userMessageId,
  });
}

function sanitizeRequestIdentifier(value: string): string {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, MAX_REQUEST_ID_LENGTH);

  if (!normalized || !SAFE_REQUEST_ID_RE.test(normalized)) {
    return "";
  }

  return normalized;
}

async function processAllowedMessage(context: InboundProcessingContext): Promise<void> {
  const { envelope, account, conversation, runtimeConfig, jobChannel } = context;
  const runAbort = context.runAbort ?? new AbortController();

  const safeMessageId = normalizeIdentifier(envelope.providerMessageId, MAX_ID_LENGTH);
  const safeSenderId = normalizeIdentifier(envelope.senderId, MAX_ID_LENGTH);
  const safeThreadId = normalizeIdentifier(envelope.threadId, MAX_ID_LENGTH);
  const safeChannelKey = normalizeIdentifier(envelope.channelKey, MAX_ID_LENGTH);
  const safeWorkspaceId = normalizeIdentifier(envelope.conversationKey.workspaceId, MAX_WORKSPACE_ID_LENGTH);
  if (!safeMessageId || !safeSenderId || !safeThreadId || !safeChannelKey || !safeWorkspaceId) {
    Logger.warn("[Channels] inbound message rejected due to malformed identifiers", {
      conversation: envelope.conversationKey,
      providerMessageId: envelope.providerMessageId,
      senderId: envelope.senderId,
      threadId: envelope.threadId,
      channelKey: envelope.channelKey,
      workspaceId: envelope.conversationKey.workspaceId,
    });
    return;
  }

  const safeEnvelope: MessageEnvelope = {
    ...envelope,
    providerMessageId: safeMessageId,
    senderId: safeSenderId,
    threadId: safeThreadId,
    channelKey: safeChannelKey,
    conversationKey: {
      ...envelope.conversationKey,
      workspaceId: safeWorkspaceId,
      channelAccountId: safeChannelKey,
      threadId: safeThreadId,
    },
  };

  const messageId = safeMessageId;
  const conversationKey = serializeConversationKey(safeEnvelope.conversationKey);
  const scopedRequestId = buildConversationScopedRequestId(conversationKey, messageId, safeSenderId);
  if (runAbort.signal.aborted) {
    Logger.warn("[Channels] inbound message skipped due to pre-aborted run", {
      conversation: envelope.conversationKey,
      channel: jobChannel,
    });
    return;
  }
  const safeScopedRequestId = sanitizeRequestIdentifier(scopedRequestId);
  if (!safeScopedRequestId) {
    Logger.warn("[Channels] inbound message rejected due to malformed request id", {
      conversation: safeEnvelope.conversationKey,
      providerMessageId: safeMessageId,
      runKey: conversationKey,
    });
    return;
  }

  const runReservationAcquired = acquireConversationRunReservation(conversationKey, safeScopedRequestId);
  if (!runReservationAcquired) {
    Logger.warn("[Channels] inbound message skipped due to active conversation run reservation", {
      conversation: safeEnvelope.conversationKey,
      channel: jobChannel,
      requestId: safeScopedRequestId,
    });
    return;
  }

  const safePolicyScopedRequestId = safeScopedRequestId.slice(0, MAX_REQUEST_ID_LENGTH);
  const eventTraceId = buildEventTraceId(conversationKey, messageId, safeScopedRequestId);
  Logger.debug("[Channels] inbound message accepted for processing", {
    runId: safeScopedRequestId,
    conversation: safeEnvelope.conversationKey,
    channel: jobChannel,
    providerMessageId: messageId,
    traceId: eventTraceId,
  });
  pruneMessageIdLedger();
  pruneRateBuckets();

  const dedupeKey = buildMessageDedupeKey(conversationKey, messageId, safeSenderId);
  const isQueueAllowed = context.skipQueueDuplicateCheck
    ? true
    : isAllowedToQueue(conversationKey, messageId, safeSenderId);

  if (context.skipQueueDuplicateCheck && !seenProviderMessageIdsByConversation.has(dedupeKey)) {
    seenProviderMessageIdsByConversation.set(dedupeKey, Date.now());
    Logger.warn("[Channels] Recovering missing inbound dedupe reservation", {
      conversation: safeEnvelope.conversationKey,
      messageId: safeScopedRequestId,
      channel: jobChannel,
    });
  }

  let existingMessage: Awaited<ReturnType<typeof storage.findMessageByRequestId>> | null = null;
  try {
    existingMessage = await withTimeoutGuard(
      "channel_dedupe_lookup",
      ENFORCED_DEDUPE_LOOKUP_TIMEOUT_MS,
      async () => await storage.findMessageByRequestId(safeScopedRequestId),
    );
  } catch (error) {
    Logger.warn("[Channels] persistent dedupe lookup failed, continuing with in-memory guard", {
      runId: safeScopedRequestId,
      conversation: safeEnvelope.conversationKey,
      messageId: safeScopedRequestId,
      channel: jobChannel,
      traceId: eventTraceId,
      timeoutMs: ENFORCED_DEDUPE_LOOKUP_TIMEOUT_MS,
      reason: String((error as Error)?.message || error),
    });
  }
  if (!isQueueAllowed) {
    Logger.info("[Channels] Duplicate inbound message ignored", {
      runId: safeScopedRequestId,
      conversation: safeEnvelope.conversationKey,
      messageId: safeScopedRequestId,
      channel: jobChannel,
      reason: "in_memory_dedupe_hit",
      traceId: eventTraceId,
    });
    return;
  }

  if (existingMessage) {
    Logger.info("[Channels] Duplicate inbound message ignored", {
      runId: safeScopedRequestId,
      conversation: safeEnvelope.conversationKey,
      messageId: safeScopedRequestId,
      channel: jobChannel,
      reason: "persistent_dedupe_hit",
      traceId: eventTraceId,
    });
    return;
  }

  const pairingCode = parseChannelPairingCodeFromMessage(safeEnvelope.text || "");
  if (pairingCode) {
    const consumed = await consumeChannelPairingCode({
      channel: jobChannel,
      code: pairingCode,
      consumedByExternalId: safeEnvelope.senderId,
    });

    if (consumed?.userId) {
      await setConversationOwnerIdentity(conversation.id, {
        ownerExternalId: safeEnvelope.senderId,
        owners: [safeEnvelope.senderId],
        linkedAt: nowIso(),
      });

      const ackText = `✅ Handshake confirmado. Tu cuenta está vinculada para este chat (${jobChannel}).`;

      try {
        await runOutboundDecision(
          {
            ...context,
            envelope: safeEnvelope,
          },
          ackText,
          "",
          "",
          safeScopedRequestId,
          {
            traceId: eventTraceId,
            skipRunStatusUpdate: true,
            abortSignal: runAbort.signal,
          },
        );
      } catch (error) {
        Logger.warn("[Channels] pairing confirmation response failed", {
          conversation: safeEnvelope.conversationKey,
          channel: jobChannel,
          reason: String((error as Error)?.message || error),
        });
      }

      return;
    }

    try {
      await runOutboundDecision(
        {
          ...context,
          envelope: safeEnvelope,
        },
        "❌ Código no válido o caducado. Solicita un nuevo QR/código de vinculación.",
        "",
        "",
        safeScopedRequestId,
        {
          traceId: eventTraceId,
          skipRunStatusUpdate: true,
          abortSignal: runAbort.signal,
        },
      );
    } catch (error) {
      Logger.warn("[Channels] pairing error response failed", {
        conversation: safeEnvelope.conversationKey,
        channel: jobChannel,
        reason: String((error as Error)?.message || error),
      });
    }

    return;

  }

  const policyConfig = getConversationPolicy(conversation);
  const rateControl = isAllowedByRateLimit(conversationKey, policyConfig.rateLimitPerMinute);
  const policyContext = {
    conversation,
    envelope: safeEnvelope,
    runtimeConfig,
    globalResponderEnabled: runtimeConfig.responder_enabled,
  };

  const policyResult = evaluateChannelPolicy(policyContext, getConversationWindowState(conversation), {
    allowed: rateControl.allowed,
    retryAfterIso: rateControl.retryAfterMs ? new Date(Date.now() + rateControl.retryAfterMs).toISOString() : undefined,
  });
  const policy = policyResult.ok ? policyResult.data : policyResult.data;

  if (!policy.allowed) {
    const safePolicyText = enforceSafeLimit(
      policy.replyText,
      POLICY_CONTROLLED_RESPONSE_LENGTH,
    );
    const shouldRespond = policy.shouldRespond !== false;

    Logger.warn("[Channels] inbound message blocked by policy", {
      runId: safeScopedRequestId,
      conversation: safeEnvelope.conversationKey,
      messageId: safeScopedRequestId,
      policyCode: policy.code,
      policyError: policyResult.ok ? "ok" : policyResult.error,
      channel: jobChannel,
      shouldRespond,
      senderId: safeEnvelope.senderId,
      policyTraceId: policy.policyTraceId,
      traceId: eventTraceId,
      requiresTemplate: policy.requiresTemplate ?? false,
      requiresOwnerHandshake: policy.requiresOwnerHandshake ?? false,
      throttleUntilIso: policy.throttleUntilIso,
    });

    if (!shouldRespond) {
      return;
    }

    await runOutboundDecision(
      {
        ...context,
        envelope: safeEnvelope,
      },
      safePolicyText,
      "",
      safePolicyScopedRequestId,
      safeScopedRequestId,
      {
        traceId: eventTraceId,
        skipRunStatusUpdate: true,
        abortSignal: runAbort.signal,
      },
    ).catch((error) => {
      Logger.warn("[Channels] policy-blocked response failed", {
        conversation: safeEnvelope.conversationKey,
        channel: jobChannel,
        runId: safePolicyScopedRequestId,
        policyCode: policy.code,
        reason: String((error as Error)?.message || error),
      });
    });
    return;
  }

  const userMessagePayload = {
    chatId: conversation.chatId,
    role: "user",
    content: buildIncomingTextForHistory(safeEnvelope),
    status: "done",
    requestId: safeScopedRequestId,
    attachments: buildMessageAttachments(safeEnvelope),
    metadata: {
      runSource: "channel_ingest",
      providerMessageId: messageId,
      channel: safeEnvelope.channel,
      threadId: safeThreadId,
      conversationKey: safeEnvelope.conversationKey,
      receivedAt: safeEnvelope.receivedAt,
      messageType: safeEnvelope.messageType,
      eventTraceId,
      ingestRunId: safeScopedRequestId,
      policyCode: policy.code,
      policyTraceId: policy.policyTraceId,
      sourceMetadata: asAttachmentFromEnvelope(safeEnvelope),
    },
  } as any;

  let userMessage: Awaited<ReturnType<typeof storage.createChatMessage>> | null = null;
  try {
    userMessage = await withTimeoutGuard(
      "channel_create_user_message",
      ENFORCED_STORAGE_OPERATION_TIMEOUT_MS,
      async () => await storage.createChatMessage(userMessagePayload),
    );
  } catch (error) {
    if (!isTimeoutLikeError(error)) {
      throw error;
    }

    const recovered = await withTimeoutGuard(
      "channel_recover_user_message",
      ENFORCED_STORAGE_OPERATION_TIMEOUT_MS,
      async () => await storage.findMessageByRequestId(safeScopedRequestId),
    );
    if (recovered) {
      userMessage = recovered;
      Logger.warn("[Channels] user message recovered after create timeout", {
        conversation: safeEnvelope.conversationKey,
        messageId: safeScopedRequestId,
        channel: jobChannel,
        traceId: eventTraceId,
      });
    } else {
      throw error;
    }
  }
  if (!userMessage) {
    throw new Error("Could not persist or recover inbound user message");
  }
  const run = await createRunForMessage(conversation.chatId, safeScopedRequestId, userMessage.id);
  if (!run) {
    Logger.error("[Channels] could not create chat run", {
      messageId: safeScopedRequestId,
      conversation: safeEnvelope.conversationKey,
      channel: jobChannel,
    });
    return;
  }

  const claimedRun = await withTimeoutGuard(
    "channel_claim_pending_run",
    ENFORCED_STORAGE_OPERATION_TIMEOUT_MS,
    async () => await storage.claimPendingRun(conversation.chatId, safeScopedRequestId),
  );
  if (!claimedRun) {
    const current = await withTimeoutGuard(
      "channel_get_current_run_status",
      ENFORCED_STORAGE_OPERATION_TIMEOUT_MS,
      async () => await storage.getChatRunByClientRequestId(conversation.chatId, safeScopedRequestId),
    );
    if (current && (current.status === "processing" || current.status === "done")) {
      Logger.info("[Channels] run already claimed or done, skipping", {
        messageId: safeScopedRequestId,
        runId: current?.id,
        status: current?.status,
      });
      return;
    }
  }

  const activeRun = claimedRun ?? run;
  const runId = activeRun.id;
  const safeRunId = sanitizeRequestIdentifier(runId);
  if (!safeRunId) {
    Logger.error("[Channels] invalid runId generated", {
      conversation: safeEnvelope.conversationKey,
      runId: activeRun.id,
      messageId: safeScopedRequestId,
    });
    await storage.updateChatRunStatus(runId, "failed", "Invalid runId").catch(() => null);
    return;
  }

  let assistantMessageId: string | null = null;
  const start = Date.now();

  registerInFlightRun(conversationKey, {
    runAbort,
    requestId: safeScopedRequestId,
    runId: safeRunId,
    channel: jobChannel,
    traceId: eventTraceId,
    startedAt: Date.now(),
  });

  try {
    const userPromptText = buildIncomingTextForHistory(safeEnvelope);
    const stylePrompt = buildResponseStyleSystemPrompt(runtimeConfig, safeEnvelope.channel);
    const historicalMessages = (await withTimeoutGuard(
      "channel_load_chat_history",
      ENFORCED_STORAGE_OPERATION_TIMEOUT_MS,
      async () => await storage.getChatMessages(conversation.chatId, { orderBy: "asc", limit: MAX_STREAM_CONTEXT }),
    ))
      .slice(-RUN_QUEUE_MAX_HISTORY)
      .filter((msg) => msg.role === "user" || msg.role === "assistant");

    // --- Multimodal Media Processing ---
    let llmUserContent: string | object[] = userPromptText;
    try {
      let mediaAttachment: any = undefined;

      if (safeEnvelope.channel === 'telegram' && safeEnvelope.media?.providerAssetId) {
        const { downloadTelegramMedia } = await import('./telegram/telegramApi');
        const fs = await import('fs/promises');
        const os = await import('os');
        const path = await import('path');

        const downloaded = await downloadTelegramMedia(safeEnvelope.media.providerAssetId);
        mediaAttachment = {
          type: safeEnvelope.messageType,
          mimetype: downloaded.mimeType,
          fileName: downloaded.fileName,
          buffer: downloaded.buffer,
          localPath: ''
        };

        if (['audio', 'video', 'document'].includes(mediaAttachment.type)) {
          mediaAttachment.localPath = path.join(os.tmpdir(), `tg_media_${Date.now()}_${downloaded.fileName}`);
          await fs.writeFile(mediaAttachment.localPath, downloaded.buffer);
        }
      }

      if (mediaAttachment) {
        const { processInboundMedia } = await import('./mediaProcessor');
        const processed = await processInboundMedia(mediaAttachment, safeEnvelope.text || "");
        if (processed.messages && processed.messages.length > 0) {
          // processInboundMedia returns an array of messages, we just take the last one's content which is the combined one
          llmUserContent = processed.messages[processed.messages.length - 1].content;
        }
      }
    } catch (mediaErr: any) {
      Logger.warn("[Channels] Failed to process inbound media", { error: mediaErr?.message });
    }

    const llmMessages = mapToLlmMessages(historicalMessages, llmUserContent, stylePrompt);

    const assistantPlaceholder = await withTimeoutGuard(
      "channel_create_assistant_placeholder",
      ENFORCED_STORAGE_OPERATION_TIMEOUT_MS,
      async () => await storage.createChatMessage({
        chatId: conversation.chatId,
        role: "assistant",
        content: "",
        status: "pending",
        runId: safeRunId,
        userMessageId: userMessage.id,
        requestId: `${safeRunId}:assistant`,
      }),
    );
    assistantMessageId = assistantPlaceholder.id;
    await storage.updateChatRunAssistantMessage(safeRunId, assistantMessageId);

    let output = "";
    let lastSeq = -1;
    const stream = llmGateway.streamChat(llmMessages, {
      userId: conversation.userId || account.userId,
      requestId: safeRunId,
      timeout: timeoutMsForChannel(jobChannel),
      maxTokens: 1500,
    });
    const orchestrationTimeoutMs = timeoutMsForChannel(jobChannel) + ORCHESTRATION_TIMEOUT_JITTER_MS;
    const orchestrationTimeout = createTimeoutTask<never>(orchestrationTimeoutMs, "Channel orchestration timeout");

    try {
      await Promise.race([
        (async () => {
          for await (const chunk of stream) {
            if (runAbort.signal.aborted) {
              throw new Error(ABORT_REASON_PREFIX);
            }

            const chunkText = typeof chunk.content === "string" ? sanitizeStreamChunk(chunk.content) : "";

            if (chunkText) {
              output += chunkText;
            }

            if (output.length > MAX_ASSISTANT_MESSAGE_LENGTH) {
              output = enforceSafeLimit(output, MAX_ASSISTANT_MESSAGE_LENGTH);
              Logger.warn("[Channels] assistant output length clipped", {
                runId,
                traceId: eventTraceId,
                conversation: safeEnvelope.conversationKey,
                limit: MAX_ASSISTANT_MESSAGE_LENGTH,
              });
              break;
            }

            lastSeq = chunk.sequenceId;
            if (lastSeq > -1) {
              await storage.updateChatRunLastSeq(safeRunId, lastSeq).catch(() => null);
            }
          }
        })(),
        orchestrationTimeout.promise,
        waitForAbortSignal(runAbort.signal),
      ]);
    } catch (streamError) {
      throw streamError;
    } finally {
      orchestrationTimeout.clear();
    }

    if (runAbort.signal.aborted) {
      throw new Error(ABORT_REASON_PREFIX);
    }

    const finalOutput = output.trim() || "No pude redactar una respuesta en este momento. Reintenta en unos segundos.";

    await storage.updateChatMessageContent(assistantMessageId, finalOutput, "done", {
      runId,
      requestId: safeScopedRequestId,
      sourceChannel: jobChannel,
      conversationKey: safeEnvelope.conversationKey,
      policyCode: policy.code,
      policyTraceId: policy.policyTraceId,
      traceId: eventTraceId,
    });

    await runOutboundDecision(
      {
        ...context,
        envelope: safeEnvelope,
      },
      finalOutput,
      userMessage.id,
      safeRunId,
      safeScopedRequestId,
      {
        assistantMessageId,
        traceId: eventTraceId,
        abortSignal: runAbort.signal,
      },
    );

    await touchChannelConversationHeartbeat(conversation.id, { lastOutboundAt: nowIso() });

    Logger.info("[Channels] message processed", {
      runId: safeRunId,
      conversation: safeEnvelope.conversationKey,
      channel: jobChannel,
      elapsedMs: Date.now() - start,
      traceId: eventTraceId,
    });
  } catch (err) {
    const reason = String((err as Error)?.message || err);
    const aborted = isAbortSignalActive(err, runAbort.signal);
    const fallback = "No puedo responder ahora. Reintenta en unos minutos.";

    if (assistantMessageId) {
      await storage.updateChatMessageContent(assistantMessageId, aborted ? "[Flujo cancelado por mensaje nuevo]" : fallback, "failed", {
        runId, requestId: safeScopedRequestId, error: reason, sourceChannel: jobChannel, aborted, policyCode: policy.code, policyTraceId: policy.policyTraceId, traceId: eventTraceId,
      }).catch(() => null);
    }

    await storage.updateChatRunStatus(safeRunId, "failed", reason).catch(() => null);
    try {
      await patchConversationMetadata(conversation.id, {
        lastError: reason,
        lastErrorAt: nowIso(),
        lastRunId: safeRunId,
      });
    } catch {
      // ignore
    }

    if (!aborted) {
      try {
        await sendTextWithRetries(
          jobChannel,
          account,
          conversation,
          safeEnvelope,
          {
            text: fallback,
            requestId: safeScopedRequestId,
            runId: safeRunId,
            conversationKey: safeEnvelope.conversationKey,
            senderId: safeEnvelope.threadId,
            traceId: eventTraceId,
          },
          0,
          runAbort.signal,
        );
      } catch (sendError) {
        Logger.error("[Channels] fallback send failed", {
          conversation: safeEnvelope.conversationKey,
          channel: jobChannel,
          traceId: eventTraceId,
          error: String((sendError as Error)?.message || sendError),
        });
      }
    }

    Logger[aborted ? "warn" : "error"]("[Channels] failed to process inbound message", {
      messageId: safeScopedRequestId, runId: safeRunId, conversation: safeEnvelope.conversationKey, channel:
        jobChannel, error: reason, aborted, traceId: eventTraceId,
    });
  } finally {
    releaseConversationRunReservation(conversationKey, safeScopedRequestId);
    unregisterInFlightRun(conversationKey, {
      requestId: safeScopedRequestId,
      runId: safeRunId,
    });
    try {
      await touchChannelConversationHeartbeat(conversation.id, {
        lastInboundAt: safeEnvelope.receivedAt || nowIso(),
      });
    } catch {
      // ignore
    }
  }
}

async function processMessageWithDirectTimeout(context: InboundProcessingContext): Promise<void> {
  const timeout = createTimeoutTask<void>(CONVERSATION_QUEUE_TIMEOUT_MS, "Conversation processing timeout");
  try {
    await Promise.race([processAllowedMessage(context), timeout.promise]);
  } finally {
    timeout.clear();
  }
}

export async function processChannelIngestJob(job: ChannelIngestJob): Promise<void> {
  const envelopes = envelopeFromRaw(job, job.channel);
  if (!envelopes.length) {
    Logger.warn(`[Channels] no normalized envelopes`, { channel: job.channel });
    return;
  }

  if (envelopes.length > MAX_ENVELOPES_PER_JOB) {
    Logger.warn("[Channels] too many inbound envelopes in one webhook payload, truncating", {
      channel: job.channel,
      envelopeCount: envelopes.length,
      maxEnvelopesPerJob: MAX_ENVELOPES_PER_JOB,
    });
    envelopes.length = MAX_ENVELOPES_PER_JOB;
  }

  for (const [envelopeIndex, rawEnvelope] of envelopes.entries()) {
    const safeChannelKey = normalizeIdentifier(rawEnvelope.channelKey, MAX_ID_LENGTH);
    const safeThreadId = normalizeIdentifier(rawEnvelope.threadId, MAX_ID_LENGTH);
    const safeSenderId = normalizeIdentifier(rawEnvelope.senderId, MAX_ID_LENGTH);
    const safeProviderMessageId = normalizeIdentifier(rawEnvelope.providerMessageId, MAX_ID_LENGTH);
    const rawWorkspaceId = rawEnvelope.conversationKey?.workspaceId;
    const safeWorkspaceId = normalizeIdentifier(rawEnvelope.conversationKey?.workspaceId, MAX_WORKSPACE_ID_LENGTH) || "workspace:unknown";
    if (rawWorkspaceId && rawWorkspaceId !== "workspace:unknown" && safeWorkspaceId === "workspace:unknown") {
      Logger.warn("[Channels] inbound envelope missing/invalid workspaceId, will be derived from account", {
        channel: job.channel,
        reason: "missing_workspace_id",
        threadId: rawEnvelope.threadId,
        channelKey: rawEnvelope.channelKey,
        providerMessageId: rawEnvelope.providerMessageId,
      });
    }

    if (!safeChannelKey || !safeThreadId || !safeSenderId || !safeProviderMessageId) {
      Logger.error("[Channels] inbound envelope rejected due to missing mandatory identifiers", {
        channel: job.channel,
        reason: "missing_mandatory_identifier",
        envelopeIndex,
        threadId: rawEnvelope.threadId,
        channelKey: rawEnvelope.channelKey,
        senderId: rawEnvelope.senderId,
        providerMessageId: rawEnvelope.providerMessageId,
      });
      continue;
    }

    const normalizedEnvelope: MessageEnvelope = {
      ...rawEnvelope,
      providerMessageId: safeProviderMessageId,
      channelKey: safeChannelKey,
      threadId: safeThreadId,
      senderId: safeSenderId,
      text: sanitizeInboundText(rawEnvelope.text),
      receivedAt: sanitizeReceivedAt(rawEnvelope.receivedAt),
      messageType: sanitizeMessageType(rawEnvelope.messageType),
      conversationKey: {
        ...rawEnvelope.conversationKey,
        channel: rawEnvelope.channel,
        workspaceId: safeWorkspaceId,
        channelAccountId: safeChannelKey,
        threadId: safeThreadId,
      },
    };

    const account = await resolveChannelAccount(job.channel, normalizedEnvelope);
    if (!account) {
      Logger.warn(`[Channels] account not found`, {
        channel: job.channel,
        threadId: normalizedEnvelope.threadId,
        channelKey: normalizedEnvelope.channelKey,
      });
      continue;
    }

    let envelope = withConversationDefaults(account, normalizedEnvelope);
    const workspaceId = buildConversationWorkspaceId(account);
    if (!workspaceId || workspaceId === "workspace:unknown" || workspaceId.length > MAX_WORKSPACE_ID_LENGTH) {
      Logger.error("[Channels] account workspace id is invalid for channel ingest", {
        channel: job.channel,
        accountId: account.id,
        threadId: normalizedEnvelope.threadId,
      });
      continue;
    }
    envelope = withConversationKeyDefaults(envelope, workspaceId, envelope.channelKey, envelope.threadId);

    const preValidation = validateInboundEnvelope(envelope);
    if (!preValidation.ok) {
      Logger.warn("[Channels] inbound envelope rejected before conversation creation", {
        channel: job.channel,
        reason: preValidation.reason,
        threadId: envelope.threadId,
        providerMessageId: envelope.providerMessageId,
      });
      continue;
    }

    const conversation = await getOrCreateChannelConversation({
      userId: account.userId,
      channel: envelope.channel,
      channelKey: envelope.channelKey,
      externalConversationId: envelope.threadId,
      title: `Canal ${envelope.channel}: ${envelope.threadId}`,
      metadata: {
        runtime: getExplicitRuntimeMetadata(account.metadata),
        createdVia: "inbound",
        channelAccountId: envelope.channelKey,
      },
    });

    const queueKey = serializeConversationKey(envelope.conversationKey);
    if (seenProviderMessageIdsByConversation.size > MAX_MESSAGE_ID_ENTRIES * 0.8) {
      pruneMessageIdLedger();
    }
    if (!isAllowedToQueue(queueKey, envelope.providerMessageId, envelope.senderId)) {
      Logger.info("[Channels] Duplicate inbound envelope ignored", {
        conversation: envelope.conversationKey,
        messageId: envelope.providerMessageId,
        channel: job.channel,
        reason: "in_memory_dedupe_hit_prequeue",
      });
      continue;
    }

    const mergedRuntimeConfig = mergeRuntimeConfig(account.metadata, conversation.metadata as Record<string, unknown> | null);

    const context: InboundProcessingContext = {
      jobChannel: job.channel,
      envelope,
      account,
      conversation,
      runtimeConfig: mergedRuntimeConfig,
      skipQueueDuplicateCheck: true,
    };

    await abortPreviousRunForConversation(queueKey);

    await safeQueue(queueKey, async (queueSignal) => {
      const runAbort = new AbortController();
      const onQueueAbort = (): void => {
        runAbort.abort(queueSignal.reason as any);
      };
      queueSignal.addEventListener("abort", onQueueAbort, { once: true });
      context.runAbort = runAbort;

      try {
        await processAllowedMessage(context);
      } finally {
        queueSignal.removeEventListener("abort", onQueueAbort);
      }
    }).catch((error) => {
      Logger.error("[Channels] conversation queue processing error", {
        error: String(error?.message || error),
        channel: job.channel,
        conversation: envelope.conversationKey,
      });
      void processMessageWithDirectTimeout(context).catch((fallbackError) => {
        Logger.error("[Channels] direct processing fallback failed", {
          channel: job.channel,
          conversation: envelope.conversationKey,
          error: String(fallbackError?.message || fallbackError),
        });
      });
    });
  }
}
