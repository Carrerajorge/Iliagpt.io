import crypto from "node:crypto";
import { domainToASCII } from "node:url";
import net from "node:net";
import { isInternalIP, sanitizeSensitiveData } from "../lib/securityUtils";
import {
  checkIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  computePayloadHash,
  type IdempotencyCheckResult,
} from "../lib/idempotencyStore";
import { createLogger } from "../lib/structuredLogger";
import { createServiceCircuitBreaker, type CircuitState } from "../lib/circuitBreaker";
import { withToolSpan, addAttributes } from "../lib/tracing";
import { storage } from "../storage";
import { logToolCall } from "./integrationPolicyService";
import {
  recordGptActionRequest,
  recordGptActionRateLimit,
  recordGptActionRetry,
  recordGptActionValidationError,
  setGptActionCircuitBreakerState,
} from "../lib/parePrometheusMetrics";
import { type GptAction } from "@shared/schema/gpt";

const GPT_ACTION_IDENTIFIER_RE = /^[a-zA-Z0-9._-]{1,140}$/;
const SAFE_HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$/;
const SAFE_IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9._-]{6,140}$/;
const MAX_HEADERS = 50;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_REQUEST_PAYLOAD_BYTES = 50000;
const MAX_RESPONSE_PAYLOAD_BYTES = 50000;
const MAX_REQUEST_BODY_BYTES = 80_000;
const MAX_FETCH_RESPONSE_BYTES = 256_000;
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_ENDPOINT_PATH_BYTES = 1_024;
const MAX_ENDPOINT_QUERY_BYTES = 4_096;
const MAX_ENDPOINT_QUERY_PARAMS = 128;
const MAX_ENDPOINT_QUERY_KEY_BYTES = 256;
const MAX_ENDPOINT_QUERY_VALUE_BYTES = 1_024;
const MAX_ENDPOINT_FRAGMENT_BYTES = 512;
const DEFAULT_CONVERSATION_RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_BUFFER = 2;
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_FETCH_RETRY_LIMIT = 3;
const MAX_RETRY_ATTEMPTS = 10;
const CONCURRENCY_KEY_RE = /^[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$/;
const BACKOFF_JITTER_RATIO = 0.2;
const MAX_SCHEMA_VALIDATION_DEPTH = 64;
const MAX_REQUEST_DEPTH = 12;
const MAX_RESPONSE_DEPTH = 48;
const MAX_REQUEST_OBJECT_KEYS = 128;
const MAX_RESPONSE_OBJECT_KEYS = 512;
const MAX_REQUEST_ARRAY_LENGTH = 256;
const MAX_RESPONSE_ARRAY_LENGTH = 1_024;
const MAX_REQUEST_STRING_BYTES = 8_192;
const MAX_RESPONSE_STRING_BYTES = 32_768;
const MAX_SAFE_STRUCTURE_KEY_BYTES = 64;
const SAFE_DOMAIN_LABEL_RE = /^(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const FORBIDDEN_STRUCTURE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_DOMAIN_ALLOWLIST_ENTRIES = 40;
const MAX_DOMAIN_ALLOWLIST_ITEM_BYTES = 255;
const MAX_DOMAIN_LABEL_LENGTH = 63;
const MAX_DOMAIN_LABELS = 127;
const MAX_TOTAL_HEADER_BYTES = 16_384;
const ALLOWED_RESPONSE_MIME_PREFIXES = ["application/json", "text/", "application/problem+"];
const MAX_HEADER_VALUE_BYTES = 2_048;
const MAX_SAFE_HEADER_NAME_BYTES = 80;
const MAX_URL_DECODE_ITERATIONS = 4;
const MAX_QUERY_SEGMENT_BYTES = 4_096;
const MAX_LOG_VALUE_DEPTH = 64;
const MAX_LOG_VALUE_BYTES = 8_192;
const MAX_LOG_ARRAY_ITEMS = 120;
const FORBIDDEN_LOG_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const LOG_DANGEROUS_BLOCK_SANITIZER =
  /<\s*(?:script|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|iframe|object|embed|svg|math)\s*>/gi;
const LOG_TAG_SANITIZER = /<\s*\/?\s*(?:script|iframe|object|embed|img|svg|math)\b[^>]*>/gi;
const LOG_URL_SCHEME_SANITIZER = /\b(?:javascript|vbscript|data)\s*:/gi;
const ALLOWED_HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const FORBIDDEN_HEADER_NAMES = new Set([
  "host",
  "connection",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "keep-alive",
  "expect",
  "cookie",
  "set-cookie",
  "content-length",
  "referer",
  "origin",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "forwarded",
  "__proto__",
  "constructor",
  "prototype",
]);

interface GptActionExecuteInput {
  action: GptAction;
  gptId: string;
  conversationId: string;
  request: Record<string, unknown>;
  userId?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
  headers?: Record<string, string | number | boolean>;
}

interface GptActionExecutionPayload {
  success: boolean;
  actionId: string;
  actionName: string;
  gptId: string;
  status: "success" | "failure" | "validation_error" | "rate_limited" | "blocked" | "timeout";
  stage: "preflight" | "auth" | "validation" | "execution";
  statusCode?: number;
  data?: unknown;
  raw?: unknown;
  mappedData?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    retryAfter?: number;
  };
  latencyMs: number;
  retryCount: number;
  circuitState: CircuitState;
  fromIdempotencyCache?: boolean;
  requestId: string | null;
  idempotencyKey?: string | null;
}

interface RuntimeDependencies {
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
}

interface ConcurrencyEntry {
  active: number;
  waiters: Array<() => void>;
  lastAccess: number;
}

interface RateWindow {
  windowStart: number;
  used: number;
  maxRequests: number;
  lastAccess: number;
}

class ConversationActionLimiter {
  private readonly activeMap = new Map<string, ConcurrencyEntry>();

  constructor(
    private readonly maxConcurrentPerConversation: number,
    private readonly queueTimeoutMs: number,
    private readonly now: () => number
  ) {}

  async acquire(key: string): Promise<{ release: () => void }> {
    if (!CONCURRENCY_KEY_RE.test(key)) {
      throw new Error("Invalid conversation/action lock key");
    }

    const now = this.now();
    const nextEntry: ConcurrencyEntry = this.activeMap.get(key) || {
      active: 0,
      waiters: [],
      lastAccess: now,
    };
    this.activeMap.set(key, nextEntry);

    if (nextEntry.active < this.maxConcurrentPerConversation) {
      nextEntry.active += 1;
      nextEntry.lastAccess = now;
      return {
        release: () => this.release(key),
      };
    }

    return new Promise((resolve, reject) => {
      const waitEntry: ConcurrencyEntry = nextEntry;
      const timeout = setTimeout(() => {
        waitEntry.waiters = waitEntry.waiters.filter((waiter) => waiter !== onRelease);
        this.cleanupIfIdle(key);
        reject(new Error("Action execution queue timeout"));
      }, this.queueTimeoutMs);

      const onRelease = () => {
        clearTimeout(timeout);
        const found = this.activeMap.get(key);
        if (!found) {
          reject(new Error("Action execution queue invalid state"));
          return;
        }

        found.active += 1;
        found.lastAccess = this.now();
        resolve({
          release: () => this.release(key),
        });
      };

      waitEntry.waiters.push(onRelease);
    });
  }

  private release(key: string): void {
    const entry = this.activeMap.get(key);
    if (!entry) {
      return;
    }

    if (entry.active > 0) {
      entry.active -= 1;
    }
    entry.lastAccess = this.now();

    if (entry.waiters.length > 0) {
      const nextWaiter = entry.waiters.shift();
      nextWaiter?.();
    }

    this.cleanupIfIdle(key);
  }

  private cleanupIfIdle(key: string): void {
    const entry = this.activeMap.get(key);
    if (!entry) return;

    if (entry.active === 0 && entry.waiters.length === 0 && this.now() - entry.lastAccess > DEFAULT_RATE_BUFFER * 1000) {
      this.activeMap.delete(key);
    }
  }
}

class ActionRateLimiter {
  private readonly buckets = new Map<string, RateWindow>();
  constructor(private readonly windowMs: number) {}

  consume(key: string, limit: number): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    this.cleanup(now);
    const existing = this.buckets.get(key);
    const windowStart = now - this.windowMs;

    if (!existing || existing.windowStart < windowStart) {
      const next: RateWindow = {
        windowStart: now,
        used: 1,
        maxRequests: limit,
        lastAccess: now,
      };
      this.buckets.set(key, next);
      return {
        allowed: limit >= 1,
        remaining: Math.max(0, limit - 1),
        resetAt: now + this.windowMs,
      };
    }

    if (existing.used >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: existing.windowStart + this.windowMs,
      };
    }

    if (existing.maxRequests !== limit) {
      existing.maxRequests = limit;
    }

    existing.used += 1;
    existing.lastAccess = now;
    return {
      allowed: true,
      remaining: Math.max(0, existing.maxRequests - existing.used),
      resetAt: existing.windowStart + this.windowMs,
    };
  }

  private cleanup(now: number): void {
    const staleThreshold = now - this.windowMs * 2;
    for (const [entryKey, entry] of this.buckets.entries()) {
      const lastAccess = entry.lastAccess ?? entry.windowStart;
      if (lastAccess < staleThreshold) {
        this.buckets.delete(entryKey);
      }
    }
  }
}

interface JsonSchemaLike {
  type?: string | string[];
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  items?: JsonSchemaLike;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  enum?: Array<string | number | boolean | null>;
  anyOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
  additionalProperties?: boolean;
}

function isRetryableCode(code: string): boolean {
  return code === "timeout" || code === "fetch_error" || code === "execution_retryable" || code === "rate_limited";
}

interface ParsedTemplateContext {
  input: Record<string, unknown>;
  action: GptAction;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeActionId(value: string): string {
  if (GPT_ACTION_IDENTIFIER_RE.test(value)) return value;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function sanitizeHeaderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "";
  }

  const lower = trimmed.toLowerCase();
  if (!SAFE_HEADER_NAME_RE.test(trimmed) || lower.length > MAX_SAFE_HEADER_NAME_BYTES) {
    return "";
  }

  if (FORBIDDEN_HEADER_NAMES.has(lower)) {
    return "";
  }

  return lower;
}

function sanitizeHeaderValue(value: string | number | boolean): string {
  const flattened = String(value).replace(/[\r\n]+/g, " ");
  const normalized = flattened
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, "")
    .trim();
  if (Buffer.byteLength(normalized, "utf8") <= MAX_HEADER_VALUE_BYTES) {
    return normalized;
  }
  return truncateToUtf8ByteLimit(normalized, MAX_HEADER_VALUE_BYTES);
}

function truncateToUtf8ByteLimit(value: string, maxBytes: number): string {
  let bytes = 0;
  let output = "";
  for (const char of value.normalize("NFKC")) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) {
      break;
    }
    bytes += charBytes;
    output += char;
  }

  return output;
}

function isValidDomainLabel(label: string): boolean {
  if (!label || label.length > MAX_DOMAIN_LABEL_LENGTH) {
    return false;
  }

  if (label.startsWith("-") || label.endsWith("-")) {
    return false;
  }

  return SAFE_DOMAIN_LABEL_RE.test(label);
}

function normalizeHttpMethod(method: unknown): string {
  if (typeof method !== "string" || !method.trim()) {
    return "GET";
  }

  const normalized = method.trim().toUpperCase();
  if (!ALLOWED_HTTP_METHODS.has(normalized)) {
    throw toFetchError(`Unsupported HTTP method: ${normalized}`, "validation_error", false);
  }

  return normalized;
}

function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return String(value ?? "");
    }
    return serialized;
  } catch {
    return String(value ?? "");
  }
}

function truncatePayload(value: unknown, maxBytes: number): unknown {
  const serialized = safeStringify(value);
  if (Buffer.byteLength(serialized, "utf8") <= maxBytes) {
    return value;
  }

  if (typeof value === "string") {
    return truncateToUtf8ByteLimit(value, maxBytes);
  }

  return truncateToUtf8ByteLimit(serialized, maxBytes);
}

function toPathParts(path: string): string[] {
  return path.split(".").map((part) => part.trim()).filter(Boolean);
}

function isForbiddenMappingKey(key: string): boolean {
  return FORBIDDEN_STRUCTURE_KEYS.has(String(key).trim().toLowerCase());
}

function normalizeContentType(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  const normalized = value.split(";")[0]?.trim().toLowerCase();
  return normalized || null;
}

function decodeUrlComponentStrict(value: string, label: string): string {
  let decoded = value;

  for (let attempt = 0; attempt < MAX_URL_DECODE_ITERATIONS; attempt += 1) {
    if (!decoded.includes("%")) {
      break;
    }

    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      throw toFetchError(`Invalid ${label} encoding`, "validation_error", false);
    }
  }

  if (decoded.includes("\u0000")) {
    throw toFetchError(`Invalid ${label} value`, "validation_error", false);
  }

  return decoded.normalize("NFKC");
}

function validateEndpointPathAndQuery(url: URL): void {
  const pathname = decodeUrlComponentStrict(url.pathname, "path");
  if (Buffer.byteLength(pathname, "utf8") > MAX_ENDPOINT_PATH_BYTES) {
    throw toFetchError("Endpoint path is too long", "validation_error", false);
  }

  const segments = pathname.split("/").filter(Boolean);
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw toFetchError("Endpoint path traversal is not allowed", "validation_error", false);
    }
    if (Buffer.byteLength(segment, "utf8") > MAX_QUERY_SEGMENT_BYTES) {
      throw toFetchError("Endpoint path segment is too long", "validation_error", false);
    }
  }

  if (url.search.length > MAX_ENDPOINT_QUERY_BYTES) {
    throw toFetchError("query is too long", "validation_error", false);
  }

  const params = Array.from(url.searchParams.entries());
  if (params.length > MAX_ENDPOINT_QUERY_PARAMS) {
    throw toFetchError("Endpoint has too many query parameters", "validation_error", false);
  }

  for (const [name, value] of params) {
    const normalizedName = decodeUrlComponentStrict(name, "query parameter name");
    const normalizedValue = decodeUrlComponentStrict(value, "query parameter value");
    if (!normalizedName || Buffer.byteLength(normalizedName, "utf8") > MAX_ENDPOINT_QUERY_KEY_BYTES) {
      throw toFetchError("Invalid query parameter name", "validation_error", false);
    }
    if (Buffer.byteLength(normalizedValue, "utf8") > MAX_ENDPOINT_QUERY_VALUE_BYTES) {
      throw toFetchError("Invalid query parameter value", "validation_error", false);
    }
  }

  if (url.hash) {
    const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    if (fragment.length > MAX_ENDPOINT_FRAGMENT_BYTES) {
      throw toFetchError("Endpoint URL fragment is too long", "validation_error", false);
    }
    const normalizedFragment = decodeUrlComponentStrict(fragment, "URL fragment");
    if (normalizedFragment && !/^[a-zA-Z0-9._~:/?#\[\]@!$&'()*+,;=%-]*$/.test(normalizedFragment)) {
      throw toFetchError("Invalid URL fragment", "validation_error", false);
    }
  }
}

interface StructureLimits {
  maxDepth: number;
  maxObjectKeys: number;
  maxArrayLength: number;
  maxStringBytes: number;
  seen?: WeakSet<object>;
}

function sanitizeStructuredValue(
  value: unknown,
  path: string,
  limits: StructureLimits,
  depth = 0
): unknown {
  if (depth > limits.maxDepth) {
    throw toFetchError(`Input depth limit exceeded at ${path}`, "validation_error", false);
  }

  if (typeof value === "string") {
    const normalized = value.normalize("NFKC").trim();
    if (Buffer.byteLength(normalized, "utf8") > limits.maxStringBytes) {
      return truncateToUtf8ByteLimit(normalized, limits.maxStringBytes);
    }
    return normalized;
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw toFetchError(`Invalid numeric value at ${path}`, "validation_error", false);
    }
    return value;
  }

  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw toFetchError(`Unsupported value type at ${path}`, "validation_error", false);
  }

  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) {
      throw toFetchError(`Array length exceeds limit at ${path}`, "validation_error", false);
    }

    return value.map((entry, index) =>
      sanitizeStructuredValue(entry, `${path}[${index}]`, limits, depth + 1)
    );
  }

  if (typeof value === "object") {
    const container = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(container);
    if (prototype !== null && prototype !== Object.prototype) {
      throw toFetchError(`Non-plain object rejected at ${path}`, "validation_error", false);
    }
    const safeEntries = Object.entries(container);
    if (safeEntries.length > limits.maxObjectKeys) {
      throw toFetchError(`Object key count exceeds limit at ${path}`, "validation_error", false);
    }

    const seen = limits.seen || new WeakSet<object>();
    if (seen.has(container)) {
      throw toFetchError(`Cyclic structure detected at ${path}`, "validation_error", false);
    }
    seen.add(container);

    const output: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of safeEntries) {
      const sanitizedKey = String(rawKey).normalize("NFKC").trim();
      if (!sanitizedKey || sanitizedKey.length > MAX_SAFE_STRUCTURE_KEY_BYTES) {
        throw toFetchError(`Invalid object key at ${path}`, "validation_error", false);
      }

      const keyLower = sanitizedKey.toLowerCase();
      if (FORBIDDEN_STRUCTURE_KEYS.has(keyLower)) {
        throw toFetchError(`Forbidden object key at ${path}.${sanitizedKey}`, "validation_error", false);
      }

      output[sanitizedKey] = sanitizeStructuredValue(
        rawValue,
        `${path}.${sanitizedKey}`,
        { ...limits, seen },
        depth + 1
      );
    }

    return output;
  }

  throw toFetchError(`Unsupported payload structure at ${path}`, "validation_error", false);
}

function sanitizeRequestPayload(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeStructuredValue(input, "request", {
    maxDepth: MAX_REQUEST_DEPTH,
    maxObjectKeys: MAX_REQUEST_OBJECT_KEYS,
    maxArrayLength: MAX_REQUEST_ARRAY_LENGTH,
    maxStringBytes: MAX_REQUEST_STRING_BYTES,
  }) as Record<string, unknown>;
}

function sanitizeResponsePayload(input: unknown): unknown {
  return sanitizeStructuredValue(input, "response", {
    maxDepth: MAX_RESPONSE_DEPTH,
    maxObjectKeys: MAX_RESPONSE_OBJECT_KEYS,
    maxArrayLength: MAX_RESPONSE_ARRAY_LENGTH,
    maxStringBytes: MAX_RESPONSE_STRING_BYTES,
  });
}

function sanitizeRequestBodyPayload(input: unknown): unknown {
  return sanitizeStructuredValue(input, "request.body", {
    maxDepth: MAX_REQUEST_DEPTH,
    maxObjectKeys: MAX_REQUEST_OBJECT_KEYS,
    maxArrayLength: MAX_REQUEST_ARRAY_LENGTH,
    maxStringBytes: MAX_REQUEST_STRING_BYTES,
  });
}

function parseActionTemplateJson(raw: string): unknown {
  const marker = "__iliagpt_forbidden_template_key__";
  if (hasForbiddenTemplateObjectKeyLiteral(raw)) {
    throw toFetchError("Forbidden object key in body template", "validation_error", false);
  }

  try {
    const parsed = JSON.parse(raw, (key, value) => {
      if (key && FORBIDDEN_STRUCTURE_KEYS.has(key.toLowerCase())) {
        throw new Error(marker);
      }
      return value;
    });

    if (containsForbiddenTemplateObjectKey(parsed)) {
      throw toFetchError("Forbidden object key in body template", "validation_error", false);
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message === marker) {
      throw toFetchError("Forbidden object key in body template", "validation_error", false);
    }

    if (error instanceof Error && (error as { code?: string }).code === "validation_error") {
      throw error;
    }

    return raw;
  }
}

function hasForbiddenTemplateObjectKeyLiteral(raw: string): boolean {
  if (!raw.includes("__proto__") && !raw.includes("prototype") && !raw.includes("constructor")) {
    return false;
  }

  const keyPattern = /(^|[,{]\s*)\"((?:\\.|[^"\\])+)\"\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(raw)) !== null) {
    const quotedKey = match[2];
    let decodedKey: string;
    try {
      decodedKey = JSON.parse(`"${quotedKey}"`);
    } catch {
      continue;
    }
    if (FORBIDDEN_STRUCTURE_KEYS.has(decodedKey.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function containsForbiddenTemplateObjectKey(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenTemplateObjectKey(entry));
  }

  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, nested] of entries) {
    if (FORBIDDEN_STRUCTURE_KEYS.has(key.toLowerCase())) {
      return true;
    }
    if (containsForbiddenTemplateObjectKey(nested)) {
      return true;
    }
  }
  return false;
}

function isAllowedResponseMimeType(value: string | null | undefined): boolean {
  const normalized = normalizeContentType(value);
  if (!normalized) {
    return false;
  }

  return ALLOWED_RESPONSE_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isStructuredResponseSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") {
    return false;
  }

  const candidate = schema as JsonSchemaLike;
  const schemaType = candidate.type;

  if (schemaType === "object" || schemaType === "array") {
    return true;
  }

  if (Array.isArray(schemaType)) {
    return schemaType.includes("object") || schemaType.includes("array");
  }

  if (candidate.properties || candidate.required || candidate.items || candidate.additionalProperties === false || candidate.oneOf || candidate.anyOf) {
    return true;
  }

  return false;
}

function sanitizeLogValue(raw: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (depth > MAX_LOG_VALUE_DEPTH) {
    return "[redacted-depth]";
  }

  if (typeof raw === "string") {
    let sanitized = raw
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
      .replace(LOG_DANGEROUS_BLOCK_SANITIZER, "[redacted]")
      .replace(LOG_TAG_SANITIZER, "[redacted]")
      .replace(LOG_URL_SCHEME_SANITIZER, "[redacted]");

    for (let i = 0; i < MAX_URL_DECODE_ITERATIONS; i += 1) {
      try {
        const decoded = decodeURIComponent(sanitized);
        if (decoded === sanitized) {
          break;
        }
        sanitized = decoded
          .replace(LOG_DANGEROUS_BLOCK_SANITIZER, "[redacted]")
          .replace(LOG_TAG_SANITIZER, "[redacted]")
          .replace(LOG_URL_SCHEME_SANITIZER, "[redacted]");
      } catch {
        break;
      }
    }

    return truncateToUtf8ByteLimit(sanitized, MAX_LOG_VALUE_BYTES);
  }

  if (Array.isArray(raw)) {
    return raw
      .slice(0, MAX_LOG_ARRAY_ITEMS)
      .map((item) => sanitizeLogValue(item, seen, depth + 1));
  }

  if (raw && typeof raw === "object") {
    if (seen.has(raw)) {
      return "[redacted-cyclic]";
    }

    seen.add(raw);
    const output: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (isForbiddenMappingKey(key)) {
        continue;
      }
      if (FORBIDDEN_LOG_KEYS.has(key) || key.includes("__")) {
        continue;
      }
      output[key] = sanitizeLogValue(value, seen, depth + 1);
    }
    return output;
  }

  return raw;
}

function getValueByPath(value: unknown, path: string): unknown {
  if (!path) return undefined;

  let current: unknown = value;
  const normalized = path.trim();
  const normalizedPath = normalized.startsWith("$.") ? normalized.slice(2) : normalized;

  for (const part of toPathParts(normalizedPath)) {
    if (!part || isForbiddenMappingKey(part)) {
      return undefined;
    }

    if (current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current as Record<string, unknown>, part)) {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }

  return current;
}

function setValueByPath(output: Record<string, unknown>, path: string, value: unknown): void {
  const parts = toPathParts(path);
  if (parts.length === 0) return;

  let cursor = output as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const segment = parts[i];
    if (isForbiddenMappingKey(segment)) {
      return;
    }

    if (!(segment in cursor) || typeof cursor[segment] !== "object" || cursor[segment] === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  const terminal = parts[parts.length - 1];
  if (isForbiddenMappingKey(terminal)) {
    return;
  }
  cursor[terminal] = value;
}

function interpolateTemplate(value: unknown, context: ParsedTemplateContext): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, token) => {
      const resolved = getValueByPath(context.input, String(token).trim());
      if (typeof resolved === "undefined") {
        return "";
      }
      if (typeof resolved === "string") return resolved;
      return safeStringify(resolved);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateTemplate(item, context));
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, candidate] of Object.entries(source)) {
      output[key] = interpolateTemplate(candidate, context);
    }
    return output;
  }

  return value;
}

function normalizePiiKeys(config: unknown): Set<string> {
  const defaults = new Set([
    "token",
    "access_token",
    "refresh_token",
    "authorization",
    "api_key",
    "apikey",
    "secret",
    "password",
    "credential",
    "private_key",
    "session",
    "cookie",
    "phone",
    "email",
  ]);

  if (!config || typeof config !== "object") {
    return defaults;
  }

  for (const key of Object.keys(config as Record<string, unknown>)) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      const raw = (config as Record<string, unknown>)[key];
      if (raw !== false) {
        defaults.add(key.toLowerCase());
      }
    }
  }

  return defaults;
}

function redactSensitiveFields(value: unknown, keys: Set<string>): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item, keys));
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      if (keys.has(key.toLowerCase()) || key.toLowerCase().includes("token") || key.toLowerCase().includes("secret")) {
        output[key] = "[REDACTED]";
        continue;
      }
      output[key] = redactSensitiveFields(item, keys);
    }
    return output;
  }

  return value;
}

function validateJsonSchema(
  schema: JsonSchemaLike | undefined,
  value: unknown,
  path: string[] = [],
  depth = 0
): string[] {
  const errors: string[] = [];

  if (depth > MAX_SCHEMA_VALIDATION_DEPTH) {
    errors.push("Schema validation depth exceeded");
    return errors;
  }

  if (!schema || typeof schema !== "object") {
    return errors;
  }

  const pathLabel = path.join(".") || "root";
  const schemaType = schema.type;

  if (schemaType === "string") {
    if (typeof value !== "string") {
      errors.push(`Expected string at ${pathLabel}`);
      return errors;
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`String too short at ${pathLabel}: ${value.length}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`String too long at ${pathLabel}: ${value.length}`);
    }
    return errors;
  }

  if (schemaType === "number" || schemaType === "integer") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push(`Expected number at ${pathLabel}`);
      return errors;
    }
    return errors;
  }

  if (schemaType === "boolean") {
    if (typeof value !== "boolean") {
      errors.push(`Expected boolean at ${pathLabel}`);
    }
    return errors;
  }

  if (schemaType === "array") {
    if (!Array.isArray(value)) {
      errors.push(`Expected array at ${pathLabel}`);
      return errors;
    }

    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`Array too short at ${pathLabel}: ${value.length}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`Array too long at ${pathLabel}: ${value.length}`);
    }

    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateJsonSchema(schema.items as JsonSchemaLike, item, [...path, String(index)], depth + 1));
      });
    }
    return errors;
  }

  if (schemaType === "object" || schema.properties) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`Expected object at ${pathLabel}`);
      return errors;
    }

    const record = value as Record<string, unknown>;
    const required = schema.required || [];
    const properties = schema.properties || {};

    for (const requiredProperty of required) {
      if (!(requiredProperty in record)) {
        errors.push(`Missing required property ${requiredProperty} at ${pathLabel}`);
      }
    }

    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      if (propertyName in record) {
        errors.push(...validateJsonSchema(propertySchema, record[propertyName], [...path, propertyName], depth + 1));
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) {
          errors.push(`Unexpected property ${key} at ${pathLabel}`);
        }
      }
    }

    return errors;
  }

  if (Array.isArray(schemaType)) {
    const primitiveMatches = schemaType.includes(typeof value);
    if (!primitiveMatches) {
      errors.push(`Type mismatch at ${pathLabel}`);
    }
    return errors;
  }

  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    errors.push(`Invalid enum value at ${pathLabel}`);
    return errors;
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.some((candidate) => validateJsonSchema(candidate, value, path, depth + 1).length === 0);
    if (!matched) {
      errors.push(`No oneOf match at ${pathLabel}`);
    }
    return errors;
  }

  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.some((candidate) => validateJsonSchema(candidate, value, path, depth + 1).length === 0);
    if (!matched) {
      errors.push(`No anyOf match at ${pathLabel}`);
    }
    return errors;
  }

  return errors;
}

function mapResponse(response: unknown, mapping: unknown): unknown {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    return response;
  }

  const output: Record<string, unknown> = {};
  for (const [targetKey, sourcePath] of Object.entries(mapping)) {
    if (isForbiddenMappingKey(targetKey)) {
      continue;
    }

    if (typeof sourcePath === "string") {
      const mapped = getValueByPath(response, sourcePath);
      if (typeof mapped !== "undefined") {
        output[targetKey] = mapped;
      }
      continue;
    }

    if (sourcePath === undefined || sourcePath === null) {
      continue;
    }

    output[targetKey] = sourcePath;
  }

  return Object.keys(output).length > 0 ? output : response;
}

function toFetchError(message: string, code: string, retryable: boolean, retryAfter?: number): Error & { code: string; retryable: boolean; retryAfter?: number } {
  const error = new Error(message) as Error & { code: string; retryable: boolean; retryAfter?: number };
  error.code = code;
  error.retryable = retryable;
  if (retryAfter !== undefined) {
    error.retryAfter = retryAfter;
  }
  return error;
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw toFetchError("endpoint is required", "validation_error", false);
  }
  if (trimmed.includes("\u0000")) {
    throw toFetchError("Invalid endpoint characters", "validation_error", false);
  }
  if (/%(?![0-9a-fA-F]{2})/.test(trimmed)) {
    throw toFetchError("Invalid percent-encoded endpoint", "validation_error", false);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw toFetchError("Invalid endpoint URL", "validation_error", false);
  }

  if (parsed.username || parsed.password) {
    throw toFetchError("Endpoint credentials are not allowed", "security_blocked", false);
  }

  validateEndpointPathAndQuery(parsed);

  if (trimmed.length > MAX_ENDPOINT_LENGTH) {
    throw toFetchError("endpoint too long", "validation_error", false);
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw toFetchError("Only http/https endpoints are allowed", "security_blocked", false);
  }

  if (parsed.port) {
    const port = Number.parseInt(parsed.port, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw toFetchError("Invalid endpoint port", "validation_error", false);
    }
  }

  const rawHostname = parsed.hostname;
  if (!rawHostname) {
    throw toFetchError("Invalid endpoint hostname", "validation_error", false);
  }

  let canonicalHost: string;
  const canonicalHostInput = rawHostname.startsWith("[") && rawHostname.endsWith("]")
    ? rawHostname.slice(1, -1)
    : rawHostname;

  if (net.isIP(canonicalHostInput)) {
    canonicalHost = canonicalHostInput.toLowerCase();
  } else {
    try {
      canonicalHost = domainToASCII(rawHostname);
    } catch {
      throw toFetchError("Invalid endpoint hostname", "validation_error", false);
    }
    canonicalHost = canonicalHost.endsWith(".") ? canonicalHost.slice(0, -1) : canonicalHost;
  }

  if (!canonicalHost) {
    throw toFetchError("Invalid endpoint hostname", "validation_error", false);
  }

  if (canonicalHost.length > 255) {
    throw toFetchError("Endpoint hostname is invalid", "validation_error", false);
  }

  if (canonicalHost === "localhost" || canonicalHost === "127.0.0.1") {
    throw toFetchError("Localhost access is denied", "security_blocked", false);
  }

  const hostname = canonicalHost.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.startsWith("::1") || hostname.startsWith("127.")) {
    throw toFetchError("Internal host access is denied", "security_blocked", false);
  }

  const ipLike = net.isIP(hostname);
  if (ipLike && isInternalIP(hostname)) {
    throw toFetchError("Private IP targets are denied", "security_blocked", false);
  }
  if (!ipLike) {
    const labels = canonicalHost.split(".");
    if (labels.length === 0 || labels.length > MAX_DOMAIN_LABELS || !labels.every(isValidDomainLabel)) {
      throw toFetchError("Endpoint hostname is invalid", "validation_error", false);
    }
  }

  parsed.hash = "";

  return parsed.toString();
}

function normalizeDomainPattern(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_DOMAIN_ALLOWLIST_ITEM_BYTES) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  if (/\s/.test(trimmed)) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  const wildcardCount = (trimmed.match(/\*/g) || []).length;
  if (wildcardCount > 1) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  const hasWildcard = trimmed.startsWith("*.") && trimmed.length > 2;
  if (trimmed.includes("*") && !hasWildcard) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  const candidate = hasWildcard ? trimmed.slice(2) : trimmed;
  if (!candidate) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  if (candidate.includes("/") || candidate.includes("?") || candidate.includes("#") || candidate.includes("\\") || candidate.includes(":")) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  if (candidate.includes("*")) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  if (candidate.startsWith(".") || candidate.endsWith(".") || candidate.includes("..")) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  let normalized: string;
  try {
    normalized = domainToASCII(candidate);
  } catch {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  if (!normalized || normalized.length > MAX_DOMAIN_ALLOWLIST_ITEM_BYTES) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  const canonical = normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
  if (!canonical) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  const labels = canonical.split(".");
  if (labels.length === 0 || labels.length > MAX_DOMAIN_LABELS) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  if (hasWildcard && labels.length < 2) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  if (!labels.every(isValidDomainLabel)) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  const sanitized = canonical.toLowerCase();
  return hasWildcard ? `*.${sanitized}` : sanitized;
}

function checkDomainAllowlist(urlValue: string, allowlist: unknown): void {
  if (allowlist === undefined || allowlist === null) {
    return;
  }

  if (!Array.isArray(allowlist)) {
    throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
  }

  if (allowlist.length === 0) {
    return;
  }

  if (allowlist.length > MAX_DOMAIN_ALLOWLIST_ENTRIES) {
    throw toFetchError("Domain allowlist is too long", "validation_error", false);
  }

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw toFetchError("Invalid URL", "validation_error", false);
  }

  let hostname = url.hostname;
  try {
    hostname = domainToASCII(url.hostname).toLowerCase();
  } catch {
    throw toFetchError("Invalid endpoint hostname", "validation_error", false);
  }
  hostname = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;

  const normalizedAllowlist = Array.from(
    new Set((allowlist as string[]).map((raw) => {
      if (typeof raw !== "string") {
        throw toFetchError("Invalid domain allowlist entry", "validation_error", false);
      }
      return normalizeDomainPattern(raw);
    }))
  );

  if (normalizedAllowlist.length === 0) {
    return;
  }

  const allowed = normalizedAllowlist.some((candidate) => {
    if (candidate.startsWith("*.") && candidate.length > 2) {
      const base = candidate.slice(2);
      return hostname === base ? false : hostname.endsWith(`.${base}`);
    }
    return candidate === hostname;
  });

  if (!allowed) {
    throw toFetchError(
      `Host ${hostname} is not in allowed domains for this action`,
      "security_blocked",
      false
    );
  }
}

function normalizeEndpointHeaders(actionHeaders: unknown, requestHeaders: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};

  const sanitized: Record<string, string> = {
    "content-type": "application/json",
  };
  output["content-type"] = "application/json";
  let headerBytes = Buffer.byteLength("content-type", "utf8") + Buffer.byteLength("application/json", "utf8");

  const sourceEntries = [
    ...toSafeHeaderEntries(actionHeaders),
    ...toSafeHeaderEntries(requestHeaders),
  ];

  if (sourceEntries.length > MAX_HEADERS) {
    throw toFetchError("Too many request headers configured", "validation_error", false);
  }

  let validHeaderCount = 1;
  for (const [name, rawValue] of sourceEntries) {
    if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
      throw toFetchError(`Unsupported header value type for ${name}`, "validation_error", false);
    }
    if (typeof rawValue === "undefined") continue;

    const safeName = sanitizeHeaderName(name);
    if (!safeName) {
      throw toFetchError(`Unsupported header name: ${name}`, "validation_error", false);
    }
    if (output[safeName]) continue;
    const safeValue = sanitizeHeaderValue(rawValue);
    const headerContribution = Buffer.byteLength(safeName, "utf8") + Buffer.byteLength(safeValue, "utf8");
    headerBytes += headerContribution;
    if (headerBytes > MAX_TOTAL_HEADER_BYTES) {
      throw toFetchError("Request headers are too large", "validation_error", false);
    }

    sanitized[safeName] = safeValue;
    output[safeName] = safeValue;
    validHeaderCount += 1;
    if (validHeaderCount > MAX_HEADERS) {
      throw toFetchError("Too many request headers configured", "validation_error", false);
    }
  }

  return sanitized;
}

function toSafeHeaderEntries(headers: unknown): Array<[string, string | number | boolean]> {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return [];
  }

  const values = headers as Record<string, unknown>;
  const entries: Array<[string, string | number | boolean]> = [];
  for (const name of Object.getOwnPropertyNames(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(values, name);
    if (!descriptor || !("value" in descriptor)) {
      throw toFetchError(`Unsupported header value type for ${name}`, "validation_error", false);
    }

    const rawValue = descriptor.value;
    if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
      throw toFetchError(`Unsupported header value type for ${name}`, "validation_error", false);
    }
    entries.push([name, rawValue]);
  }

  return entries;
}

function applyAuthHeaders(
  actionAuthType: string,
  authConfig: Record<string, unknown> | null,
  headers: Record<string, string>,
): Record<string, string> {
  if (!actionAuthType || actionAuthType === "none") {
    return headers;
  }

  const output = { ...headers };
  const config = (authConfig && typeof authConfig === "object") ? authConfig as Record<string, unknown> : {};
  const normalizedAuthType = actionAuthType.trim().toLowerCase();

  if (normalizedAuthType === "api_key") {
    const candidate = config.apiKey || config.key || config.token || config.value;
    if (!candidate || typeof candidate !== "string" || !candidate.trim()) {
      throw toFetchError("api_key auth requires a valid api key", "auth_error", false);
    }
    const headerName = typeof config.headerName === "string" && config.headerName.trim()
      ? sanitizeHeaderName(config.headerName)
      : "x-api-key";
    if (!headerName) {
      throw toFetchError("Invalid api-key header name", "auth_error", false);
    }
    output[headerName] = sanitizeHeaderValue(candidate);
    return output;
  }

  if (normalizedAuthType === "bearer") {
    const token = config.bearerToken || config.accessToken || config.token;
    if (!token || typeof token !== "string" || !token.trim()) {
      throw toFetchError("bearer auth requires a valid token", "auth_error", false);
    }
    output.Authorization = `Bearer ${sanitizeHeaderValue(token)}`;
    return output;
  }

  if (normalizedAuthType === "basic") {
    const username = typeof config.username === "string" ? config.username : "";
    const password = typeof config.password === "string" ? config.password : "";
    if (!username || !password) {
      throw toFetchError("basic auth requires username and password", "auth_error", false);
    }
    const combined = sanitizeHeaderValue(`${username}:${password}`);
    output.Authorization = `Basic ${sanitizeHeaderValue(Buffer.from(combined).toString("base64"))}`;
    return output;
  }

  if (normalizedAuthType === "custom") {
    if (
      typeof config.headerName !== "string" ||
      !config.headerName.trim() ||
      typeof config.headerValue !== "string" ||
      !config.headerValue.trim()
    ) {
      throw toFetchError("custom auth requires headerName and headerValue", "auth_error", false);
    }

    const customHeaderName = sanitizeHeaderName(config.headerName);
    if (!customHeaderName) {
      throw toFetchError("Invalid custom auth header name", "auth_error", false);
    }
    output[customHeaderName] = sanitizeHeaderValue(config.headerValue);
    return output;
  }

  if (normalizedAuthType === "oauth") {
    const oauthToken = config.accessToken || config.token || config.bearerToken;
    if (!oauthToken || typeof oauthToken !== "string") {
      throw toFetchError("oauth auth requires access token", "auth_error", false);
    }
    output.Authorization = `Bearer ${sanitizeHeaderValue(oauthToken)}`;
    return output;
  }

  if (normalizedAuthType === "none" || normalizedAuthType === "") {
    return output;
  }

  throw toFetchError(`Unsupported auth type: ${actionAuthType}`, "auth_error", false);
}

function clampRetryLimit(actionRateLimit: unknown, maxRetries = DEFAULT_FETCH_RETRY_LIMIT): number {
  const parsedFallback =
    typeof maxRetries === "number" && Number.isFinite(maxRetries)
      ? Math.floor(maxRetries)
      : DEFAULT_FETCH_RETRY_LIMIT;

  const safeFallback = Math.max(0, Math.min(parsedFallback, MAX_RETRY_ATTEMPTS));

  if (typeof actionRateLimit === "number" && Number.isInteger(actionRateLimit)) {
    return Math.max(0, Math.min(actionRateLimit, MAX_RETRY_ATTEMPTS));
  }

  if (typeof actionRateLimit === "string") {
    const parsed = Number.parseInt(actionRateLimit, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(parsed, MAX_RETRY_ATTEMPTS));
    }
  }

  return safeFallback;
}

function buildExecutionErrorPayload(error: unknown): { code: string; message: string; retryable: boolean; retryAfter?: number } {
  const typed = error as { code?: string; message?: string; retryable?: boolean; retryAfter?: number };
  const code = typed.code || "execution_error";
  const retryAfterCandidate = typed.retryAfter;
  const retryAfter =
    typeof retryAfterCandidate === "number" && Number.isFinite(retryAfterCandidate)
      ? Math.max(1, Math.ceil(retryAfterCandidate))
      : undefined;
  return {
    code,
    message: typed.message || "Execution failed",
    retryable: typed.retryable ?? false,
    retryAfter,
  };
}

function responseFromCache(cache: Record<string, unknown>): GptActionExecutionPayload {
  if (cache.status && cache.actionId) {
    return cache as GptActionExecutionPayload;
  }

  return {
    success: true,
    actionId: String(cache.actionId || "cached"),
    actionName: String(cache.actionName || "cached"),
    gptId: String(cache.gptId || ""),
    status: "success",
    stage: "execution",
    latencyMs: Number(cache.latencyMs || 0),
    retryCount: Number(cache.retryCount || 0),
    circuitState: "CLOSED",
    requestId: (cache.requestId as string | null) ?? null,
    idempotencyKey: (cache.idempotencyKey as string | null) ?? null,
    fromIdempotencyCache: true,
    data: cache.data,
    mappedData: cache.mappedData,
    raw: cache.raw,
  };
}

export class GptActionRuntime {
  private readonly logger = createLogger("gpt-action-runtime");
  private readonly limiter: ConversationActionLimiter;
  private readonly rateLimiter: ActionRateLimiter;
  private readonly dependencies: RuntimeDependencies;
  private readonly fetcher: typeof fetch;
  private readonly random: () => number;

  constructor(
    dependencies: RuntimeDependencies = {}
  ) {
    this.dependencies = dependencies;
    this.fetcher = dependencies.fetch || globalThis.fetch;
    this.random = dependencies.random || Math.random;
    this.limiter = new ConversationActionLimiter(
      DEFAULT_MAX_CONCURRENCY,
      8_000,
      () => this.now()
    );
    this.rateLimiter = new ActionRateLimiter(DEFAULT_CONVERSATION_RATE_WINDOW_MS);
  }

  async execute(payload: GptActionExecuteInput): Promise<GptActionExecutionPayload> {
    const startedAt = this.now();
    const normalizedIdempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey);

    try {
      return await withToolSpan(`gpt-action:${payload.action.name || payload.action.id}`, async () => {
        addAttributes({
          "action.id": payload.action.id,
          "gpt.id": payload.gptId,
          "conversation.id": payload.conversationId,
        });

        return await this.executeInternal(payload, startedAt);
      }, {
        requestId: payload.requestId || null,
        userId: payload.userId || null,
      } as any);
    } catch (error) {
      const endAt = this.now();
      const err = buildExecutionErrorPayload(error);
      const fallback = this.createFailureResult(
        payload,
        startedAt,
        endAt,
        0,
        "execution",
        "failure",
        undefined,
        err.message,
        err.code,
        err.retryable,
        normalizedIdempotencyKey,
        err.retryAfter
      );
      if (normalizedIdempotencyKey) {
        await this.failIdempotency(normalizedIdempotencyKey, fallback.error?.message || err.message);
      }
      await this.recordFailureLog(payload.action, payload, fallback, requestIdForLogging(payload.requestId)).catch(() => {
        // best-effort log
      });
      return fallback;
    }
  }

  private async executeInternal(
    payload: GptActionExecuteInput,
    startedAt: number
  ): Promise<GptActionExecutionPayload> {
    const action = payload.action;
    const actionId = action.id || "unknown-action";
    const gptId = payload.gptId;
    const requestId = requestIdForLogging(payload.requestId);
    const normalizedIdempotency = normalizeIdempotencyKey(payload.idempotencyKey);
    let safeRequestPayload: Record<string, unknown>;

    try {
      safeRequestPayload = sanitizeRequestPayload(payload.request);
    } catch (error) {
      recordGptActionValidationError(gptId, actionId, "requestPayload");
      const validationError = this.createFailureResult(
        payload,
        startedAt,
        this.now(),
        0,
        "validation",
        "validation_error",
        undefined,
        (error as Error).message || "Invalid request payload",
        "validation_error",
        false,
        normalizedIdempotency
      );
      await this.failIdempotencyIfEnabled(
        normalizedIdempotency,
        validationError,
        validationError.error?.message || "Invalid request payload"
      );
      return validationError;
    }

    const payloadCheck = await this.checkIdempotency(
      action,
      gptId,
      payload.conversationId,
      safeRequestPayload,
      requestId,
      payload.userId,
      normalizedIdempotency
    );

    if (payloadCheck.status !== "new") {
      return payloadCheck.result as GptActionExecutionPayload;
    }

    await this.enforceRateLimit(action, gptId, payload.conversationId);

    const conversationKey = `${payload.conversationId}:${actionId}`;
    const release = await this.limiter.acquire(conversationKey);

    try {
      const endpoint = normalizeEndpoint(action.endpoint);
      checkDomainAllowlist(endpoint, action.domainAllowlist);

      if (String(action.isActive) !== "true") {
        const blockedResult = this.createFailureResult(
          payload,
          startedAt,
          this.now(),
          0,
          "execution",
          "failure",
          undefined,
          "Action is disabled",
          "action_inactive",
          false,
          normalizedIdempotency
        );
        await this.failIdempotencyIfEnabled(
          normalizedIdempotency,
          blockedResult,
          blockedResult.error?.message || "Action is disabled"
        );
        return blockedResult;
      }

      if (action.requestSchema && action.requestSchema !== null) {
        const schemaErrors = validateJsonSchema(action.requestSchema as JsonSchemaLike, safeRequestPayload, []);
        if (schemaErrors.length > 0) {
          recordGptActionValidationError(gptId, actionId, "requestSchema");
          const validationError = this.createFailureResult(
            payload,
            startedAt,
            this.now(),
            0,
            "validation",
            "validation_error",
            undefined,
            `Request schema validation failed: ${schemaErrors.slice(0, 3).join("; ")}`,
            "validation_error",
            false,
            normalizedIdempotency
          );

          await this.failIdempotencyIfEnabled(
            normalizedIdempotency,
            validationError,
            validationError.error?.message || "Request schema validation failed"
          );

          return validationError;
        }
      }

      const method = normalizeHttpMethod(action.httpMethod);
      const contextForTemplate: ParsedTemplateContext = {
        input: safeRequestPayload,
        action,
      };

      let requestBody: unknown;
      try {
        requestBody = this.buildRequestBody(action, safeRequestPayload, contextForTemplate, method);
      } catch (error) {
        const details = buildExecutionErrorPayload(error);
        const failure = this.createFailureResult(
          payload,
          startedAt,
          this.now(),
          0,
          "validation",
          "validation_error",
          undefined,
          details.message || "Invalid request body",
          details.code || "validation_error",
          false,
          normalizedIdempotency
        );
        await this.failIdempotencyIfEnabled(normalizedIdempotency, failure, failure.error?.message || "Invalid request body");
        return failure;
      }

      if (requestBody !== undefined) {
        const rawBodyBytes = Buffer.byteLength(typeof requestBody === "string" ? requestBody : safeStringify(requestBody), "utf8");
        if (rawBodyBytes > MAX_REQUEST_BODY_BYTES) {
          return this.createFailureResult(
            payload,
            startedAt,
            this.now(),
            0,
            "validation",
            "failure",
            undefined,
            `Request body exceeds maximum allowed size: ${rawBodyBytes} > ${MAX_REQUEST_BODY_BYTES}`,
            "execution_error",
            false,
            normalizedIdempotency
          );
        }
      }

      const safeRequestBody = requestBody === undefined ? undefined : sanitizeRequestBodyPayload(requestBody);
      const headers = this.buildHeaders(action, payload.headers || {});

      const maxRetries = clampRetryLimit(payload.maxRetries, DEFAULT_FETCH_RETRY_LIMIT);

      const endpointTimeout = clampTimeout(payload.timeoutMs ?? action.timeout ?? 30000);
      const breakerName = `gpt_action_${sanitizeActionId(action.id)}_${sanitizeActionId(payload.conversationId)}`;
      const breaker = createServiceCircuitBreaker({
        name: breakerName,
        timeout: endpointTimeout,
        retries: 0,
        retryDelay: 0,
        onStateChange: (from, to) => {
          const fromValue = this.mapCircuitState(from);
          const toValue = this.mapCircuitState(to);
          setGptActionCircuitBreakerState(gptId, actionId, to, toValue);
          this.logger.warn("gpt-action.circuit_state", {
            actionId,
            gptId,
            from,
            to,
          });
        },
      });

      const executionResult = await this.executeWithRetries(
        payload,
        { action, actionId, gptId, requestId, headers, requestBody: safeRequestBody, method, endpoint, timeoutMs: endpointTimeout },
        breaker,
        isStructuredResponseSchema(action.responseSchema),
        maxRetries,
        startedAt,
        normalizedIdempotency
      );

      return executionResult;
    } finally {
      release.release();
    }
  }

  private async executeWithRetries(
    payload: GptActionExecuteInput,
    executionContext: {
      action: GptAction;
      actionId: string;
      gptId: string;
      requestId: string;
      headers: Record<string, string>;
      requestBody: unknown;
      method: string;
      endpoint: string;
      timeoutMs: number;
    },
    breaker: ReturnType<typeof createServiceCircuitBreaker>,
    enforceResponseLimits: boolean,
    maxRetries: number,
    startedAt: number,
    idempotencyKey: string | null
  ): Promise<GptActionExecutionPayload> {
    const { action, actionId, gptId, requestId, headers, requestBody, method, endpoint, timeoutMs } = executionContext;
    let lastError: Error & { retryable?: boolean; code?: string; retryAfter?: number } | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        retryCount = attempt;
        recordGptActionRetry(gptId, actionId);
        const delay = this.computeBackoff(attempt);
        await sleep(delay);
      }

      try {
        const result = await breaker.call(async () => {
          return await this.fetchAction(
            action,
            method,
            endpoint,
            headers,
            requestBody,
            timeoutMs,
            enforceResponseLimits
          );
        }, `${method} ${endpoint}`);

        if (!result.success || !result.data) {
          const message = result.error || "Execution returned empty response";
          const inferredCode = inferExecutionErrorCode(result.errorCode || message);
          const isRetryable = typeof result.retryable === "boolean" ? result.retryable : isRetryableCode(inferredCode);
          const error = this.makeNetworkError(message, inferredCode, isRetryable);
          if (typeof result.statusCode === "number") {
            (error as Error & { statusCode?: number }).statusCode = result.statusCode;
          }
          if (typeof result.responseBody !== "undefined") {
            (error as Error & { responseBody?: unknown; responseContentType?: string | null }).responseBody =
              result.responseBody;
          }
          if (typeof result.responseContentType !== "undefined") {
            (error as Error & { responseBody?: unknown; responseContentType?: string | null }).responseContentType =
              result.responseContentType;
          }
          if (typeof result.retryAfter === "number") {
            error.retryAfter = result.retryAfter;
          }
          throw error;
        }

        const statusCode = result.data.status;
        const responsePayload = result.data.body;
        const responseContentType = result.data.contentType;
        const mappedData = mapResponse(responsePayload, action.responseMapping);

        if (
          isStructuredResponseSchema(action.responseSchema)
          && responseContentType !== null
          && !isAllowedResponseMimeType(responseContentType)
        ) {
          return this.createFailureResult(
            payload,
            startedAt,
            this.now(),
            retryCount,
            "execution",
            "validation_error",
            statusCode,
            "Response content-type is not compatible with structured response schema",
            "validation_error",
            false,
            idempotencyKey,
            undefined,
            mappedData
          );
        }

        if (action.responseSchema && action.responseSchema !== null) {
          const outputErrors = validateJsonSchema(action.responseSchema as JsonSchemaLike, responsePayload, []);
          if (outputErrors.length > 0) {
            recordGptActionValidationError(gptId, actionId, "responseSchema");
            return this.createFailureResult(
              payload,
              startedAt,
              this.now(),
              retryCount,
              "execution",
              "validation_error",
              statusCode,
              `Response schema validation failed: ${outputErrors.slice(0, 3).join("; ")}`,
              "validation_error",
              false,
              idempotencyKey,
              undefined,
              mappedData
            );
          }
        }

        const piiRules = normalizePiiKeys(action.piiRedactionRules);
        const redactedMapped = redactSensitiveFields(mappedData, piiRules);
        const redactedRaw = redactSensitiveFields(responsePayload, piiRules);

        const successResult = this.createSuccessResult(
          payload,
          action,
          startedAt,
          retryCount,
          result.data.durationMs,
          statusCode,
          redactedMapped,
          redactedRaw,
          idempotencyKey
        );

        await this.markUsageAndFinalize(action);
        await this.storeToolCallLog(payload, action, true, statusCode, successResult.latencyMs, null);
        await this.completeIdempotencyIfEnabled(idempotencyKey, {
          ...successResult,
          data: redactedMapped,
          raw: redactedRaw,
        });

        recordGptActionRequest(gptId, actionId, successResult.status, successResult.latencyMs / 1000, result.data.circuitState || "closed");

        return successResult;
      } catch (error) {
        lastError = error as Error & { retryable?: boolean; code?: string; retryAfter?: number };

        const stage = retryCount > 0 ? "execution" : "execution";
        const details = buildExecutionErrorPayload(error);
        const finalStatus = details.code === "validation_error" ? "validation_error" : details.retryable ? "timeout" : "failure";
        const partialData = this.extractPartialErrorData(error, action);
        const isRetryable = typeof error.retryable === "boolean"
          ? error.retryable
          : isRetryableCode(details.code);

        if (!isRetryable || retryCount >= maxRetries || (error.message || "").includes("security_blocked")) {
          const failure = this.createFailureResult(
            payload,
            startedAt,
            this.now(),
            retryCount,
            stage,
            finalStatus,
            (error as any).statusCode,
            details.message,
            details.code,
            details.retryable,
            idempotencyKey,
            details.retryAfter,
            partialData
          );
          await this.storeToolCallLog(payload, action, false, undefined, failure.latencyMs, details.message, error);
          await this.failIdempotencyIfEnabled(idempotencyKey, failure, details.message);
          recordGptActionRequest(gptId, actionId, failure.status, failure.latencyMs / 1000, "closed");
          return failure;
        }

        this.logger.warn("gpt-action.retry", {
          actionId,
          attempt,
          error: details.message,
          retryable: isRetryable,
          code: details.code,
        });
      }
    }

    const fallback = this.createFailureResult(
      payload,
      startedAt,
      this.now(),
      retryCount,
      "execution",
      "failure",
      undefined,
      lastError?.message || "Action execution failed",
      lastError?.code || "execution_error",
      false,
      idempotencyKey,
      lastError?.retryAfter,
      this.extractPartialErrorData(lastError, action)
    );

    await this.failIdempotencyIfEnabled(idempotencyKey, fallback, fallback.error?.message || "Action execution failed");
    return fallback;
  }

  private async fetchAction(
    action: GptAction,
    method: string,
    endpoint: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs: number,
    enforceResponseLimits: boolean
  ): Promise<{ data: { status: number; body: unknown; response: Response; contentType: string | null; durationMs: number; circuitState?: "closed" | "half_open" | "open" } }> {
    const started = this.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;

    try {
      if (!ALLOWED_HTTP_METHODS.has(method)) {
        throw this.makeNetworkError(`Unsupported HTTP method: ${method}`, "validation_error", false);
      }

      const responseInit: RequestInit = {
        method,
        headers,
        redirect: "manual",
        signal: controller.signal,
      };

      if (method === "GET" || method === "HEAD") {
        if (body !== undefined) {
          throw this.makeNetworkError(
            `Request bodies are not allowed for ${method} methods`,
            "validation_error",
            false
          );
        }
      } else if (body !== undefined) {
        const content = typeof body === "string" ? body : safeStringify(body);
        const contentBytes = Buffer.byteLength(content, "utf8");
        if (contentBytes > MAX_REQUEST_BODY_BYTES) {
          throw this.makeNetworkError(
            `Request body exceeds maximum allowed size: ${contentBytes} > ${MAX_REQUEST_BODY_BYTES}`,
            "execution_error",
            false
          );
        }
        responseInit.body = content;
        responseInit.headers = {
          ...responseInit.headers,
          "Content-Type": "application/json",
        };
      }

      response = await this.fetcher(endpoint, responseInit);
      const contentType = response.headers.get("content-type");
      const durationMs = this.now() - started;
      clearTimeout(timeoutId);

      if (response.status < 100 || response.status > 599) {
        throw this.makeNetworkError(`Execution failed with invalid status ${response.status}`, "execution_error", false);
      }

      if (response.status >= 300 && response.status < 400) {
        const redirectError = this.makeNetworkError(
          `Execution returned redirect status ${response.status}`,
          "execution_not_retryable",
          false
        );
        throw redirectError;
      }

      const text = await this.readResponseBodySafe(response, MAX_FETCH_RESPONSE_BYTES);
      const rawBody = this.safeParseResponseBody(text, enforceResponseLimits);

      if (!response.ok) {
        const shouldRetry = response.status >= 500 || response.status === 429 || response.status === 408;
        const parsedRetryAfter = parseRetryAfterHeader(response.headers.get("retry-after"));
        const responseError = this.makeNetworkError(
          `Execution failed with status ${response.status}`,
          shouldRetry ? "execution_retryable" : "execution_not_retryable",
          shouldRetry,
          parsedRetryAfter
        );
        (responseError as Error & { statusCode?: number; responseBody?: unknown; responseContentType?: string | null }).statusCode =
          response.status;
        (responseError as Error & { statusCode?: number; responseBody?: unknown; responseContentType?: string | null }).responseBody =
          rawBody;
        (responseError as Error & { statusCode?: number; responseBody?: unknown; responseContentType?: string | null }).responseContentType =
          contentType;
        throw responseError;
      }

      return {
        data: {
          status: response.status,
          body: rawBody,
          response,
          contentType,
          durationMs,
          circuitState: response.ok ? "closed" : "open",
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error && typeof error === "object" && typeof (error as { code?: string }).code === "string") {
        throw error as Error & { code: string; retryable: boolean; retryAfter?: number };
      }
      if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
        throw this.makeNetworkError("Request timeout", "timeout", true);
      }
      throw this.makeNetworkError((error as Error).message || "Request failed", "fetch_error", true);
    }
  }

  private async readResponseBodySafe(response: Response, maxBytes: number): Promise<string> {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength) {
      const parsedLength = Number.parseInt(declaredLength, 10);
      if (!Number.isFinite(parsedLength) || parsedLength < 0) {
        throw this.makeNetworkError("Invalid response Content-Length header", "execution_error", false);
      }
      if (parsedLength > maxBytes) {
        throw this.makeNetworkError(
          `Response body exceeds maximum allowed size: ${parsedLength} > ${maxBytes}`,
          "execution_error",
          false
        );
      }
    }

    if (!response.body) {
      return "";
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    const chunks: string[] = [];

    let completed = false;
    try {
      while (true) {
        const readResult = await reader.read();
        if (readResult.done) {
          completed = true;
          break;
        }

        if (readResult.value) {
          totalBytes += readResult.value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            throw this.makeNetworkError(
              `Response body exceeds maximum allowed size: ${totalBytes} > ${maxBytes}`,
              "execution_error",
              false
            );
          }
        }

        const chunk = decoder.decode(readResult.value, { stream: true });
        chunks.push(chunk);
      }
    } finally {
      if (!completed) {
        await reader.cancel().catch(() => undefined);
      }
    }

    const tail = decoder.decode(undefined, { stream: false });
    return chunks.join("") + tail;
  }

  private async checkIdempotency(
    action: GptAction,
    gptId: string,
    conversationId: string,
    request: Record<string, unknown>,
    requestId: string,
    userId?: string | null,
    idempotencyKey: string | null
  ): { status: IdempotencyCheckResult["status"]; result?: GptActionExecutionPayload } {
    if (!idempotencyKey) {
      return { status: "new" };
    }

    const payloadHash = computePayloadHash({
      actionId: action.id,
      gptId,
      conversationId,
      userId: userId || "anonymous",
      request,
      requestId,
    });

    const state = await checkIdempotencyKey(idempotencyKey, payloadHash);
    if (state.status === "new") {
      return { status: "new" };
    }

    if (state.status === "processing") {
      return {
        status: "processing",
        result: this.createFailureResult(
          {
            action,
            gptId,
            conversationId,
            request,
            requestId,
            userId,
            idempotencyKey,
          },
          this.now(),
          this.now(),
          0,
          "execution",
          "failure",
          undefined,
          "Request with this idempotency key is already in progress",
          "idempotency_in_progress",
          false,
          idempotencyKey,
          1
        ),
      };
    }

    if (state.status === "conflict") {
      return {
        status: "conflict",
        result: this.createFailureResult(
          {
            action,
            gptId,
            conversationId,
            request,
            requestId,
            userId,
            idempotencyKey,
          },
          this.now(),
          this.now(),
          0,
          "validation",
          "failure",
          undefined,
          "Idempotency key conflict for different payload",
          "idempotency_conflict",
          false,
          idempotencyKey
        ),
      };
    }

    if (state.status === "completed" && state.cachedResponse) {
      return {
        status: "completed",
        result: responseFromCache(state.cachedResponse),
      };
    }

    return { status: "new" };
  }

  private async enforceRateLimit(action: GptAction, gptId: string, conversationId: string): Promise<void> {
    const actionLimit = typeof action.rateLimit === "number" && Number.isFinite(action.rateLimit) ? action.rateLimit : 100;
    const limit = Math.max(1, Math.floor(actionLimit));
    const { allowed, remaining, resetAt } = this.rateLimiter.consume(`${gptId}:${conversationId}:${action.id}`, limit);

    if (!allowed) {
      recordGptActionRateLimit(gptId, action.id);
      const retryAfter = Math.max(1, Math.ceil((resetAt - this.now()) / 1000));
      throw this.makeNetworkError(
        `Rate limit exceeded. Retry after ${retryAfter}s`,
        "rate_limited",
        true,
        retryAfter
      );
    }

    if (remaining < DEFAULT_RATE_BUFFER) {
      this.logger.warn("gpt-action.rate_limit_threshold", {
        actionId: action.id,
        gptId,
        remaining,
      });
    }
  }

  private buildRequestBody(
    action: GptAction,
    request: Record<string, unknown>,
    context: ParsedTemplateContext,
    method: string
  ): unknown {
    if (method === "GET" || method === "HEAD") {
      if (typeof action.bodyTemplate === "string") {
        throw this.makeNetworkError(`Request bodies are not allowed for ${method} methods`, "validation_error", false);
      }
      return undefined;
    }

    if (typeof action.bodyTemplate === "string") {
      const interpolated = interpolateTemplate(action.bodyTemplate, context);
      if (typeof interpolated === "string") {
        try {
          return parseActionTemplateJson(interpolated as string);
        } catch (error) {
          if (typeof (error as { code?: string }).code === "string") {
            throw error;
          }
          return interpolated;
        }
      }
      return interpolated;
    }

    if (action.bodyTemplate != null && typeof action.bodyTemplate === "object") {
      return interpolateTemplate(action.bodyTemplate, context);
    }

    return request;
  }

  private buildHeaders(action: GptAction, requestHeaders: Record<string, unknown>): Record<string, string> {
    const merged = normalizeEndpointHeaders(action.headers as Record<string, unknown> | undefined, requestHeaders);
    const authApplied = applyAuthHeaders(action.authType, action.authConfig as Record<string, unknown> | null, merged);
    return authApplied;
  }

  private makeNetworkError(
    message: string,
    code: string,
    retryable: boolean,
    retryAfter?: number
  ): Error & { code: string; retryable: boolean; retryAfter?: number } {
    return toFetchError(message, code, retryable, retryAfter);
  }

  private safeParseResponseBody(text: string, enforceLimits = false): unknown {
    try {
      const parsed = JSON.parse(text);
      if (enforceLimits) {
        return sanitizeResponsePayload(parsed);
      }
      return parsed;
    } catch (error) {
      if (enforceLimits && error && typeof error === "object" && (error as { code?: string }).code === "validation_error") {
        throw error as Error;
      }

      if (enforceLimits) {
        this.logger.warn("gpt-action.response_parse_malformed", { preview: safeStringify(text).slice(0, 240) });
      }
      return text;
    }
  }

  private async storeToolCallLog(
    payload: GptActionExecuteInput,
    action: GptAction,
    success: boolean,
    statusCode: number | undefined,
    latencyMs: number,
    error?: string,
    throwable?: Error | null
  ): Promise<void> {
    try {
      const piiRules = normalizePiiKeys(action.piiRedactionRules);
      const requestPayload = sanitizeSensitiveData({ ...payload.request, conversationId: payload.conversationId });
      const safeRequest = sanitizeLogValue(redactSensitiveFields(requestPayload, piiRules));
      const safeError = throwable ? sanitizeSensitiveData(throwable.message) : error;
      const actorId = resolveActorId(payload.userId);

      await logToolCall(
        actorId,
        action.id,
        `gpt-action:${payload.gptId}`,
        safeRequest,
        null,
        success ? "success" : "failed",
        latencyMs,
        String(safeError || "")
      );
    } catch {
      // Best-effort audit: never fail operation on log errors.
    }
  }

  private async recordFailureLog(
    action: GptAction,
    payload: GptActionExecuteInput,
    result: GptActionExecutionPayload,
    requestId?: string | null
  ): Promise<void> {
    await this.storeToolCallLog(
      payload,
      action,
      false,
      result.statusCode,
      result.latencyMs,
      result.error?.message || "Action execution failed",
      new Error(requestId || result.error?.message || "Action execution failed")
    );
  }

  private async completeIdempotencyIfEnabled(
    idempotencyKey: string | null,
    response: Record<string, unknown>
  ): Promise<void> {
    if (!idempotencyKey) return;
    await this.completeIdempotency(idempotencyKey, sanitizeSensitiveData(response));
  }

  private async failIdempotencyIfEnabled(
    idempotencyKey: string | null,
    response: GptActionExecutionPayload,
    message: string
  ): Promise<void> {
    if (!idempotencyKey) return;
    await this.failIdempotency(idempotencyKey, message);
  }

  private async completeIdempotency(idempotencyKey: string, response: Record<string, unknown>): Promise<void> {
    try {
      await completeIdempotencyKey(idempotencyKey, response);
    } catch {
      // no-op
    }
  }

  private async failIdempotency(idempotencyKey: string, error: string): Promise<void> {
    try {
      await failIdempotencyKey(idempotencyKey, error);
    } catch {
      // no-op
    }
  }

  private async markUsageAndFinalize(action: GptAction): Promise<void> {
    await storage.incrementGptActionUsage(action.id);
  }

  private createSuccessResult(
    payload: GptActionExecuteInput,
    action: GptAction,
    startedAt: number,
    retryCount: number,
    durationMs: number,
    statusCode: number,
    mappedData: unknown,
    rawData: unknown,
    idempotencyKey: string | null
  ): GptActionExecutionPayload {
    const result: GptActionExecutionPayload = {
      success: true,
      actionId: action.id,
      actionName: action.name,
      gptId: payload.gptId,
      status: "success",
      stage: "execution",
      statusCode,
      data: truncatePayload(mappedData, MAX_RESPONSE_PAYLOAD_BYTES),
      raw: truncatePayload(rawData, MAX_RESPONSE_PAYLOAD_BYTES),
      mappedData: truncatePayload(mappedData, MAX_RESPONSE_PAYLOAD_BYTES),
      latencyMs: durationMs > 0 ? durationMs : this.now() - startedAt,
      retryCount,
      circuitState: "CLOSED",
      requestId: payload.requestId || null,
      idempotencyKey,
      error: undefined,
    };

    recordGptActionRequest(
      payload.gptId,
      action.id,
      "success",
      result.latencyMs / 1000,
      "closed"
    );

    return result;
  }

  private createFailureResult(
    payload: GptActionExecuteInput,
    startedAt: number,
    finishedAt: number,
    retryCount: number,
    stage: "preflight" | "auth" | "validation" | "execution",
    status: "failure" | "validation_error" | "timeout",
    statusCode: number | undefined,
    errorMessage: string,
    errorCode: string,
    retryable: boolean,
    idempotencyKey: string | null,
    retryAfter?: number,
    partialData?: unknown
  ): GptActionExecutionPayload {
    const result: GptActionExecutionPayload = {
      success: false,
      actionId: payload.action.id,
      actionName: payload.action.name,
      gptId: payload.gptId,
      status,
      stage,
      statusCode,
      data: partialData === undefined ? undefined : truncatePayload(partialData, MAX_RESPONSE_PAYLOAD_BYTES),
      latencyMs: Math.max(0, finishedAt - startedAt),
      retryCount,
      circuitState: "CLOSED",
      requestId: payload.requestId || null,
      idempotencyKey,
      error: {
        code: errorCode,
        message: errorMessage,
        retryable,
        retryAfter,
      },
    };

    recordGptActionRequest(
      payload.gptId,
      payload.action.id,
      status,
      result.latencyMs / 1000,
      "closed"
    );

    return result;
  }

  private computeBackoff(attempt: number): number {
    const base = DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
    const capped = Math.min(8_000, base);
    const jitterSeed = this.random();
    const jitter = capped * BACKOFF_JITTER_RATIO * (jitterSeed - 0.5) * 2;
    return Math.max(DEFAULT_RETRY_DELAY_MS, Math.floor(capped + jitter));
  }

  private mapCircuitState(state: string): number {
    if (state === "OPEN" || state === "open") return 1;
    if (state === "HALF_OPEN" || state === "half_open") return 0.5;
    return 0;
  }

  private extractPartialErrorData(error: unknown, action: GptAction): unknown {
    const candidate = error as {
      responseBody?: unknown;
      responseContentType?: string | null;
      statusCode?: number;
    };

    if (typeof candidate.responseBody === "undefined") {
      return undefined;
    }

    try {
      const mapped = mapResponse(candidate.responseBody, action.responseMapping);
      return redactSensitiveFields(mapped, normalizePiiKeys(action.piiRedactionRules));
    } catch {
      return redactSensitiveFields(candidate.responseBody, normalizePiiKeys(action.piiRedactionRules));
    }
  }

  private now(): number {
    return (this.dependencies.now || Date.now)();
  }
}

function normalizeIdempotencyKey(key: string | undefined): string | null {
  if (!key || !SAFE_IDEMPOTENCY_KEY_RE.test(key.trim())) {
    return null;
  }
  return key.trim();
}

function clampTimeout(timeoutMs: number | undefined): number {
  const base = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : 30000;
  if (base < 250) return 250;
  if (base > 120000) return 120_000;
  return Math.floor(base);
}

function requestIdForLogging(rawId?: string | null): string {
  if (!rawId || !GPT_ACTION_IDENTIFIER_RE.test(rawId)) {
    return `gpt_action_${Date.now()}`;
  }
  return rawId;
}

function inferExecutionErrorCode(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized === "validation_error"
    || normalized === "execution_error"
    || normalized === "fetch_error"
    || normalized === "auth_error"
    || normalized === "timeout"
    || normalized === "rate_limited"
    || normalized === "security_blocked") {
    return normalized;
  }
  if (normalized === "execution_retryable") {
    return "execution_retryable";
  }
  if (normalized === "execution_not_retryable") {
    return "execution_error";
  }

  if (normalized.includes("status 429") || normalized.includes("status 408")) {
    return "rate_limited";
  }

  if (/\b(?:status|code)\s*5\d\d\b/.test(normalized)) {
    return "execution_retryable";
  }

  if (/\b(?:status|code)\s*4\d\d\b/.test(normalized)) {
    return "execution_error";
  }

  if (/\b(?:status|code)\s*3\d\d\b/.test(normalized)) {
    return "execution_error";
  }

  if (normalized.includes("timeout")) {
    return "timeout";
  }

  if (normalized.includes("request body exceeds") || normalized.includes("response body exceeds")) {
    return "execution_error";
  }

  if (normalized.includes("invalid") || normalized.includes("validation") || normalized.includes("blocked")
    || normalized.includes("not in allowed") || normalized.includes("content-type") || normalized.includes("forbidden")) {
    return "execution_error";
  }

  return "execution_failed";
}

function isValidActorId(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return /^[a-zA-Z0-9._-]{6,140}$/.test(value);
}

function resolveActorId(value: string | null | undefined): string | null {
  if (!isValidActorId(value)) {
    return null;
  }
  return value;
}

function normalizeRequestInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

export function parseRetryAfterHeader(rawHeader: string | null | undefined): number | undefined {
  if (!rawHeader) {
    return undefined;
  }

  const trimmed = rawHeader.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds > 0 ? Math.max(1, seconds) : undefined;
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    const delta = Math.ceil((parsedDate - Date.now()) / 1000);
    return delta > 0 ? delta : undefined;
  }

  return undefined;
}

export function normalizeGptActionRequestPayload(rawInput: Record<string, unknown>): unknown {
  const request = rawInput.request;
  const fallback = rawInput.input;
  const normalized =
    request !== undefined && request !== null
      ? normalizeRequestInput(request)
      : normalizeRequestInput(fallback);

  try {
    const rawSerialized = safeStringify(normalized);
    if (Buffer.byteLength(rawSerialized, "utf8") > MAX_REQUEST_PAYLOAD_BYTES) {
      return truncateToUtf8ByteLimit(rawSerialized, MAX_REQUEST_PAYLOAD_BYTES);
    }

    const sanitized = sanitizeRequestPayload(normalized);
    return sanitized;
  } catch {
    return {};
  }
}

export function isAllowedResponseMimeTypeForTesting(rawContentType: string | null | undefined): boolean {
  return isAllowedResponseMimeType(rawContentType);
}

export function normalizeContentTypeForTesting(rawContentType: string | null | undefined): string | null {
  return normalizeContentType(rawContentType);
}

export function sanitizeLogValueForTesting(value: unknown): unknown {
  return sanitizeLogValue(value);
}

export function mapResponseForTesting(response: unknown, mapping: unknown): unknown {
  return mapResponse(response, mapping);
}

export function isValidActorIdForTesting(value: string | null | undefined): boolean {
  return isValidActorId(value);
}

export function resolveActorIdForTesting(value: string | null | undefined): string | null {
  return resolveActorId(value);
}

export function createGptActionRuntime(): GptActionRuntime {
  return new GptActionRuntime();
}
