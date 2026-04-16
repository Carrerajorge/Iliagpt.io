import net from "node:net";
import { sanitizeFileName as sanitizeSafeFileName } from "../lib/securityUtils";

const DEFAULT_CHANNEL_FETCH_TIMEOUT_MS = 12_000;
const MIN_CHANNEL_FETCH_TIMEOUT_MS = 250;
const MAX_CHANNEL_FETCH_TIMEOUT_MS = 180_000;
const DEFAULT_CHANNEL_OUTBOUND_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CHANNEL_OUTBOUND_FILE_BYTES = 200 * 1024 * 1024;
const MAX_TEXT_LENGTH = 16_384;
const MAX_TRACE_ID_LENGTH = 120;
const MAX_HEADER_VALUE_LENGTH = 120;
const MAX_ID_LENGTH = 512;
const MAX_URL_LENGTH = 2_048;
const MAX_HOSTNAME_LENGTH = 255;
const MAX_CHANNEL_MIME_LENGTH = 255;
const MAX_CHANNEL_FILE_NAME_LENGTH = 255;

type ChannelFileKind = "image" | "audio" | "document";

const ALLOWED_MEDIA_MIME_TYPES: Record<ChannelFileKind, ReadonlySet<string>> = {
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
};

const CONTROLLED_SCHEMES = /^https?:$/i;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export type ChannelFileValidationResult =
  | { ok: true; value: { fileBuffer: Buffer; fileName: string; mimeType: string } }
  | { ok: false; reason: string };

export type ChannelFetchContext = {
  timeoutMs?: number;
  expectedHost?: string | readonly string[];
  allowedHostSuffixes?: readonly string[];
  traceId?: string;
  maxResponseChars?: number;
};

type UrlPolicy = {
  expectedHost?: string | readonly string[];
  allowedHostSuffixes?: readonly string[];
};

type FetchContext = {
  timeoutMs: number;
  policy: UrlPolicy;
  traceId: string;
  maxResponseChars?: number;
};

type FetchSignalHandle = {
  signal: AbortSignal;
  finalize: () => void;
};

type FetchTimeoutInput = number | ChannelFetchContext;

function normalizeHeaderValue(value: string, maxLength: number): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .trim()
    .slice(0, maxLength);
}

function normalizeTraceId(value: unknown): string {
  const normalized = normalizeHeaderValue(String(value || "conversation"), MAX_TRACE_ID_LENGTH)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_");
  return normalized || "conversation";
}

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

const CHANNEL_FETCH_TIMEOUT_MS = parsePositiveInt(
  process.env.CHANNEL_HTTP_TIMEOUT_MS,
  DEFAULT_CHANNEL_FETCH_TIMEOUT_MS,
  MIN_CHANNEL_FETCH_TIMEOUT_MS,
  MAX_CHANNEL_FETCH_TIMEOUT_MS,
);
const CHANNEL_OUTBOUND_MEDIA_BYTES = parsePositiveInt(
  process.env.CHANNEL_OUTBOUND_MEDIA_BYTES,
  DEFAULT_CHANNEL_OUTBOUND_FILE_BYTES,
  128 * 1024,
  MAX_CHANNEL_OUTBOUND_FILE_BYTES,
);

function normalizeForTransport(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[ \t\r\n]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parseFetchContext(raw?: FetchTimeoutInput): FetchContext {
  if (typeof raw === "number") {
    return {
      timeoutMs: raw,
      policy: {},
      traceId: normalizeTraceId("direct"),
    };
  }

  if (!raw) {
    return {
      timeoutMs: CHANNEL_FETCH_TIMEOUT_MS,
      policy: {},
      traceId: normalizeTraceId("default"),
    };
  }

  return {
    timeoutMs: parsePositiveInt(
      String(raw.timeoutMs ?? CHANNEL_FETCH_TIMEOUT_MS),
      CHANNEL_FETCH_TIMEOUT_MS,
      MIN_CHANNEL_FETCH_TIMEOUT_MS,
      MAX_CHANNEL_FETCH_TIMEOUT_MS,
    ),
    policy: {
      expectedHost: raw.expectedHost,
      allowedHostSuffixes: raw.allowedHostSuffixes,
    },
    traceId: normalizeTraceId(raw.traceId),
    maxResponseChars: typeof raw.maxResponseChars === "number" && Number.isFinite(raw.maxResponseChars)
      ? Math.max(64, Math.floor(raw.maxResponseChars))
      : undefined,
  };
}

function normalizeHostList(value: string | readonly string[]): string[] {
  return Array.isArray(value) ? [...value] : [value];
}

function isPrivateIPv4(hostname: string): boolean {
  const octets = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4) return false;
  if (octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;

  return (
    octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254)
    || octets[0] === 0
  );
}

function isPrivateIPv6(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1" || lower === "::") return true;

  if (/^(fc|fd|fe8|fe9|fea|feb|fec|fed|fee|fef)/i.test(lower)) return true;

  if (!lower.startsWith("::ffff:") && !lower.startsWith("0:0:0:0:ffff:")) return false;
  const ipv4Part = lower.replace(/^::ffff:/, "").replace(/^0:0:0:0:ffff:/, "");
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ipv4Part) && isPrivateIPv4(ipv4Part);
}

function isUnsafeHost(hostname: string): boolean {
  const normalized = normalizeForTransport(hostname, MAX_HOSTNAME_LENGTH).toLowerCase();
  if (!normalized) return true;
  if (
    normalized === "localhost"
    || normalized === "0.0.0.0"
    || normalized === "::1"
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".lan")
    || normalized.includes("..")
  ) {
    return true;
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) return isPrivateIPv4(normalized);
  if (ipVersion === 6) return isPrivateIPv6(normalized);

  return false;
}

function hasExpectedHost(hostname: string, expected: string[]): boolean {
  if (!expected.length) return true;
  const current = hostname.toLowerCase();
  return expected.some((candidate) => {
    const normalized = normalizeForTransport(candidate, MAX_HOSTNAME_LENGTH).toLowerCase();
    if (!normalized) return false;
    return current === normalized || current.endsWith(`.${normalized}`);
  });
}

function hasAllowedSuffix(hostname: string, suffixes: readonly string[]): boolean {
  if (!suffixes.length) return true;
  const current = hostname.toLowerCase();
  return suffixes.some((suffix) => {
    const normalized = normalizeForTransport(suffix, MAX_HOSTNAME_LENGTH).toLowerCase();
    return Boolean(normalized) && (current === normalized || current.endsWith(`.${normalized}`));
  });
}

function normalizeSafeUrl(raw: string, policy: UrlPolicy): string {
  const normalizedRaw = normalizeForTransport(raw, MAX_URL_LENGTH);
  if (!normalizedRaw || CONTROL_CHARS.test(normalizedRaw)) throw new Error("Invalid request URL");
  if (normalizedRaw.includes("..")) throw new Error("Invalid request URL");

  const parsed = new URL(normalizedRaw);
  if (!CONTROLLED_SCHEMES.test(parsed.protocol)) {
    throw new Error("Invalid request scheme");
  }
  if (parsed.pathname.length > MAX_URL_LENGTH || (parsed.search?.length || 0) > MAX_URL_LENGTH) {
    throw new Error("Request URL too long");
  }
  if (parsed.hostname.length > MAX_HOSTNAME_LENGTH || isUnsafeHost(parsed.hostname)) {
    throw new Error("Request host blocked");
  }

  const expected = normalizeHostList(policy.expectedHost || []);
  const suffixes = policy.allowedHostSuffixes || [];
  if (!hasExpectedHost(parsed.hostname, expected) || !hasAllowedSuffix(parsed.hostname, suffixes)) {
    throw new Error("Request host not allowed");
  }

  return parsed.toString();
}

function createTimeoutSignal(timeoutMs: number): FetchSignalHandle {
  const timeout = parsePositiveInt(
    String(timeoutMs),
    CHANNEL_FETCH_TIMEOUT_MS,
    MIN_CHANNEL_FETCH_TIMEOUT_MS,
    MAX_CHANNEL_FETCH_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("channel_request_timeout"));
  }, timeout);
  return {
    signal: controller.signal,
    finalize: () => clearTimeout(timer),
  };
}

function mergeSignals(timeoutSignal: AbortSignal, externalSignal?: AbortSignal) {
  if (!externalSignal) return { signal: timeoutSignal, detach: () => {} };

  const merged = new AbortController();
  const forward = () => {
    if (merged.signal.aborted) return;
    merged.abort(externalSignal.reason || new Error("request_aborted"));
  };
  const onTimeout = () => {
    if (merged.signal.aborted) return;
    merged.abort(timeoutSignal.reason || new Error("channel_request_timeout"));
  };

  timeoutSignal.addEventListener("abort", onTimeout, { once: true });
  externalSignal.addEventListener("abort", forward, { once: true });
  if (timeoutSignal.aborted) onTimeout();
  if (externalSignal.aborted) forward();

  return {
    signal: merged.signal,
    detach: () => {
      timeoutSignal.removeEventListener("abort", onTimeout);
      externalSignal.removeEventListener("abort", forward);
    },
  };
}

export function normalizeChannelText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .trim()
    .slice(0, maxLength);
}

export function normalizeChannelId(value: unknown, maxLength = MAX_ID_LENGTH): string {
  return normalizeChannelText(value, maxLength).replace(/\s+/g, "").slice(0, maxLength);
}

export function sanitizeOutboundFilePayload(input: {
  kind: ChannelFileKind;
  fileBuffer: Buffer | Uint8Array;
  fileName: string;
  mimeType: string;
}): ChannelFileValidationResult {
  const buffer = input.fileBuffer;
  if (!buffer || buffer.byteLength === 0) {
    return { ok: false, reason: "empty_file_buffer" };
  }
  if (buffer.byteLength > CHANNEL_OUTBOUND_MEDIA_BYTES) {
    return {
      ok: false,
      reason: `file_too_large_${buffer.byteLength}_gt_${CHANNEL_OUTBOUND_MEDIA_BYTES}`,
    };
  }

  const mimeType = normalizeChannelText(input.mimeType, MAX_CHANNEL_MIME_LENGTH).toLowerCase();
  if (!mimeType || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType)) {
    return { ok: false, reason: "invalid_mime_type" };
  }
  if (!ALLOWED_MEDIA_MIME_TYPES[input.kind].has(mimeType)) {
    return { ok: false, reason: "mime_type_not_allowed" };
  }

  const fileName = sanitizeSafeFileName(
    normalizeChannelText(input.fileName, MAX_CHANNEL_FILE_NAME_LENGTH),
    MAX_CHANNEL_FILE_NAME_LENGTH,
  ) || `document_${Date.now()}`;

  return {
    ok: true,
    value: {
      fileBuffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
      fileName,
      mimeType,
    },
  };
}

export function createTimeoutSignalForTest(timeoutMs: number): FetchSignalHandle {
  return createTimeoutSignal(timeoutMs);
}

export async function channelFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutOrContext?: FetchTimeoutInput,
): Promise<Response> {
  const context = parseFetchContext(timeoutOrContext);
  const safeInput = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const safeUrl = normalizeSafeUrl(safeInput, context.policy);
  const headers = new Headers(init.headers || {});
  headers.set("x-request-id", normalizeHeaderValue(context.traceId, MAX_HEADER_VALUE_LENGTH));
  if (!headers.has("x-channel-trace-id")) {
    headers.set("x-channel-trace-id", normalizeHeaderValue(context.traceId, MAX_HEADER_VALUE_LENGTH));
  }
  if (!headers.has("user-agent")) {
    headers.set("user-agent", "AppsWebChat/1.0");
  }
  if (!headers.has("accept")) {
    headers.set("accept", "application/json, text/plain, */*");
  }

  const timeoutSignal = createTimeoutSignal(context.timeoutMs);
  const merged = mergeSignals(timeoutSignal.signal, init.signal);
  try {
    return await fetch(safeUrl, {
      ...init,
      headers,
      signal: merged.signal,
    });
  } finally {
    merged.detach();
    timeoutSignal.finalize();
  }
}

export async function readResponseTextSafe(response: Response, limit = MAX_TEXT_LENGTH): Promise<string> {
  try {
    const body = await response.text();
    return normalizeChannelText(body, limit);
  } catch {
    return "";
  }
}
