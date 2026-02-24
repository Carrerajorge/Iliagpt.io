import crypto from "crypto";

const DEFAULT_WEBHOOK_CLOCK_SKEW_MS = 6 * 60 * 1000;
const MAX_TRACKABLE_WEBHOOK_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_TIMESTAMP_CANDIDATES = 16;
const REQUIRE_WEBHOOK_SECRETS = process.env.NODE_ENV === "production";

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function canonicalizeHeaderValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function canonicalizeSignature(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("sha256=") ? normalized : `sha256=${normalized}`;
}

export function verifyTelegramSecretToken(input: {
  providedToken: string | undefined;
  expectedToken: string | undefined;
  requireSecret?: boolean;
}): boolean {
  const requireSecret = input.requireSecret ?? REQUIRE_WEBHOOK_SECRETS;
  if (!input.expectedToken) {
    return !requireSecret;
  }

  const providedToken = canonicalizeHeaderValue(input.providedToken);
  const expectedToken = canonicalizeHeaderValue(input.expectedToken);
  if (!providedToken || !expectedToken) return false;

  return timingSafeEqual(providedToken, expectedToken);
}

export function computeWhatsAppSignature256(input: {
  rawBody: Buffer;
  appSecret: string;
}): string {
  const mac = crypto.createHmac("sha256", input.appSecret).update(input.rawBody).digest("hex");
  return `sha256=${mac}`;
}

export function verifyWhatsAppSignature256(input: {
  rawBody: Buffer;
  headerSignature: string | undefined;
  appSecret: string | undefined;
  requireSecret?: boolean;
}): boolean {
  const requireSecret = input.requireSecret ?? REQUIRE_WEBHOOK_SECRETS;
  if (!input.appSecret) {
    return !requireSecret;
  }

  const rawHeader = canonicalizeHeaderValue(input.headerSignature);
  if (!rawHeader) return false;

  const expected = computeWhatsAppSignature256({ rawBody: input.rawBody, appSecret: input.appSecret });
  return timingSafeEqual(canonicalizeSignature(rawHeader), canonicalizeSignature(expected));
}

/** Messenger uses the same HMAC-SHA256 pattern as WhatsApp (both Meta platforms). */
export function verifyMessengerSignature256(input: {
  rawBody: Buffer;
  headerSignature: string | undefined;
  appSecret: string | undefined;
  requireSecret?: boolean;
}): boolean {
  const requireSecret = input.requireSecret ?? REQUIRE_WEBHOOK_SECRETS;
  if (!input.appSecret) {
    return !requireSecret;
  }

  const rawHeader = canonicalizeHeaderValue(input.headerSignature);
  if (!rawHeader) return false;

  const mac = crypto.createHmac("sha256", input.appSecret).update(input.rawBody).digest("hex");
  const expected = `sha256=${mac}`;
  return timingSafeEqual(canonicalizeSignature(rawHeader), canonicalizeSignature(expected));
}

/** WeChat uses SHA1 of sorted [token, timestamp, nonce]. */
export function verifyWeChatSignature(input: {
  signature: string | undefined;
  timestamp: string | undefined;
  nonce: string | undefined;
  token: string | undefined;
  requireSecret?: boolean;
}): boolean {
  const requireSecret = input.requireSecret ?? REQUIRE_WEBHOOK_SECRETS;
  const token = canonicalizeHeaderValue(input.token);
  const signature = canonicalizeHeaderValue(input.signature);
  const timestamp = canonicalizeHeaderValue(input.timestamp);
  const nonce = canonicalizeHeaderValue(input.nonce);

  if (!token) {
    return !requireSecret;
  }

  if (!signature || !timestamp || !nonce) return false;
  const arr = [token, timestamp, nonce].sort();
  const computed = crypto.createHash("sha1").update(arr.join("")).digest("hex");
  return timingSafeEqual(computed, signature);
}

function normalizeTimestampInput(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const asNumber = Number.parseInt(value, 10);
    if (Number.isFinite(asNumber)) return asNumber;
  }
  return null;
}

function toEpochMs(raw: unknown): number | null {
  const v = normalizeTimestampInput(raw);
  if (v === null) return null;
  if (v > 0 && v < 1_000_000_000_000) return v * 1000;
  return v;
}

export function extractWebhookPayloadTimestamp(payload: unknown): number | null {
  const root = payload as Record<string, unknown>;
  const candidates: number[] = [];

  const addTimestamp = (value: unknown) => {
    const ts = toEpochMs(value);
    if (ts !== null) candidates.push(ts);
  };

  const entries = Array.isArray(root?.entry) ? root.entry as unknown[] : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as any)?.changes) ? (entry as any).changes : [];
    for (const change of changes) {
      const value = (change as any)?.value;
      addTimestamp((value as any)?.timestamp);
      const messages = Array.isArray((value as any)?.messages) ? (value as any).messages : [];
      for (const msg of messages) {
        addTimestamp((msg as any)?.timestamp);
      }
    }

    const messaging = Array.isArray((entry as any)?.messaging) ? (entry as any).messaging : [];
    for (const event of messaging) {
      addTimestamp((event as any)?.timestamp);
    }
  }

  const message = (root as any)?.message;
  if (message) {
    addTimestamp(message?.date);
  }

  if (!candidates.length) return null;
  if (candidates.length > MAX_TIMESTAMP_CANDIDATES) {
    candidates.length = MAX_TIMESTAMP_CANDIDATES;
  }
  return Math.max(...candidates);
}

export function isWebhookTimestampFresh(
  timestampMs: number | null | undefined,
  options: { nowMs?: number; maxSkewMs?: number } = {},
): boolean {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return false;

  const nowMs = options.nowMs ?? Date.now();
  const maxSkewMs = options.maxSkewMs ?? DEFAULT_WEBHOOK_CLOCK_SKEW_MS;

  if (timestampMs > nowMs + 60_000 || nowMs - timestampMs > MAX_TRACKABLE_WEBHOOK_AGE_MS) return false;
  return nowMs - timestampMs <= maxSkewMs;
}
