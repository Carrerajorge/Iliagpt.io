import { NextFunction, Request, Response } from "express";
import { validateJSONDepth } from "../services/advancedSecurity";

const MAX_PATH_LENGTH = 2048;
const MAX_JSON_DEPTH = 12;
const MAX_QUERY_VALUE_LENGTH = 2048;
const MAX_QUERY_KEY_LENGTH = 128;
const MAX_QUERY_PARAMS_COUNT = 100;
const MAX_PATH_SEGMENT_COUNT = 64;
const MAX_REQUEST_PATH_BYTES = Number(process.env.MAX_REQUEST_PATH_BYTES || 0);
const MAX_OBJECT_KEYS = 200;
const MAX_ARRAY_ITEMS = 200;

const DEFAULT_MAX_BODY_BYTES = 1 * 1024 * 1024;
const CHAT_STREAM_MAX_BODY_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_MULTIPART_BYTES = 100 * 1024 * 1024;
const MAX_MULTIPART_BYTES = Number(process.env.MAX_MULTIPART_BYTES || DEFAULT_MAX_MULTIPART_BYTES);

const KNOWN_SAFE_PATH_PATTERNS = [
  /^\/api\/chat\/stream(?:\/|$)/,
  /^\/api\/health(?:\/|$)/,
  /^\/api\/ready(?:\/|$)/,
  /^\/api\/auth(?:\/|$)/,
  /^\/api\/webhooks(?:\/|$)/,
  /^\/api\/files(?:\/|$)/,
  /^\/api\/packages(?:\/|$)/,
];

const MAX_BYTES_BY_ROUTE: ReadonlyArray<{ pattern: RegExp; maxBytes: number }> = [
  { pattern: /^\/api\/chat\/stream(?:\/|$)/, maxBytes: CHAT_STREAM_MAX_BODY_BYTES },
  { pattern: /^\/api\/chats(?:\/|$)/, maxBytes: CHAT_STREAM_MAX_BODY_BYTES },
  { pattern: /^\/api\/files(?:\/|$)/, maxBytes: MAX_MULTIPART_BYTES },
  { pattern: /^\/api\/local-upload(?:\/|$)/, maxBytes: MAX_MULTIPART_BYTES },
  { pattern: /^\/api\/objects\/upload(?:\/|$)/, maxBytes: MAX_MULTIPART_BYTES },
  { pattern: /^\/api\/spreadsheet\/upload(?:\/|$)/, maxBytes: MAX_MULTIPART_BYTES },
];

const DISALLOWED_PATH_SEGMENTS = /(^|\/)(?:\.\.)(?=\/|$|%2e%2e|%2E%2E|..|%2e|%2E|\x00)/i;
const MALFORMED_PERCENT_ENCODING = /%(?![0-9a-fA-F]{2})/;
const DISALLOWED_CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const ALLOWED_QUERY_KEY_PATTERN = /^[A-Za-z0-9._~!$&'()*+,;=:@\-\/[\]]+$/;
const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isForbiddenRecordKey(key: string): boolean {
  return FORBIDDEN_RECORD_KEYS.has(key) || key.includes("__proto__");
}

function getMaxBodyBytes(pathname: string): number {
  const configured = Number(process.env.MAX_API_BODY_BYTES || DEFAULT_MAX_BODY_BYTES);
  const routeLimit = MAX_BYTES_BY_ROUTE.find(({ pattern }) => pattern.test(pathname));
  return routeLimit?.maxBytes ?? configured;
}

function getContentTypeValue(req: Request): string {
  const raw = req.headers["content-type"];
  if (!raw) return "";

  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : "";
}

function parseContentTypeBase(rawValue: string): string {
  return rawValue.split(";")[0].trim().toLowerCase();
}

function hasValidContentLengthHeader(contentLengthHeader: string | string[] | undefined): { ok: boolean; value?: number } {
  if (typeof contentLengthHeader === "undefined") {
    return { ok: true, value: undefined };
  }

  const raw = Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader;
  if (typeof raw !== "string" || raw.trim() === "" || /,/.test(raw) || /\s/.test(raw.trim())) {
    return { ok: false };
  }

  if (MALFORMED_PERCENT_ENCODING.test(raw)) {
    return { ok: false };
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== raw.trim()) {
    return { ok: false };
  }

  return { ok: true, value: parsed };
}

function isCanonicalPath(value: string): boolean {
  if (!value) {
    return false;
  }

  if (DISALLOWED_CONTROL_CHARS.test(value) || DISALLOWED_PATH_SEGMENTS.test(value) || MALFORMED_PERCENT_ENCODING.test(value)) {
    return false;
  }

  const segments = value.split("/").filter(Boolean);
  if (segments.length > MAX_PATH_SEGMENT_COUNT) {
    return false;
  }

  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes("..") || decoded.includes("\\") || /\x00/.test(decoded) || DISALLOWED_CONTROL_CHARS.test(decoded)) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

function isJsonOrFormRequest(contentType: string): boolean {
  if (!contentType) return false;

  const baseType = parseContentTypeBase(contentType);
  return (
    baseType === "application/json" ||
    baseType === "application/x-www-form-urlencoded" ||
    baseType === "text/plain" ||
    baseType.endsWith("+json") ||
    baseType.startsWith("multipart/")
  );
}

function hasValidCharset(contentType: string): boolean {
  const charsetMatch = /charset=([^;]+)/i.exec(contentType);
  if (!charsetMatch) {
    return true;
  }

  const charset = (charsetMatch[1] || "").trim().toLowerCase();
  return charset === "utf-8" || charset === "utf8";
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\x00/g, "")
    .replace(/[\x7f\x01-\x1f]/g, (char) => {
      return char === "\n" || char === "\r" || char === "\t" ? char : "";
    });
}

function normalizeInput(
  value: unknown,
  depth = 0,
  maxDepth = 8,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (depth > maxDepth) {
    return value;
  }

  if (typeof value === "string") {
    return normalizeText(value);
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      return value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => normalizeInput(item, depth + 1, maxDepth, seen));
    }

    return value.map((item) => normalizeInput(item, depth + 1, maxDepth, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[redacted-cyclic]";
    }

    seen.add(value);
    const normalized: Record<string, unknown> = Object.create(null);
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    for (const [key, nested] of entries) {
      if (isForbiddenRecordKey(key)) {
        continue;
      }
      normalized[key] = normalizeInput(nested, depth + 1, maxDepth, seen);
    }
    return normalized;
  }

  return value;
}

function validatePath(req: Request): { ok: boolean; status: number; message: string } {
  if (!req.path) {
    return { ok: false, status: 414, message: "Invalid request path length" };
  }

  if (req.path.length > MAX_PATH_LENGTH) {
    return { ok: false, status: 414, message: "Invalid request path length" };
  }

  if (/\x00/.test(req.path)) {
    return { ok: false, status: 400, message: "Invalid request path" };
  }

  if (!isCanonicalPath(req.path)) {
    return { ok: false, status: 400, message: "Path traversal-like request detected" };
  }

  if (MAX_REQUEST_PATH_BYTES > 0) {
    const normalizedLength = Math.max(Buffer.byteLength(req.path, "utf8"), req.path.length);
    if (normalizedLength > MAX_REQUEST_PATH_BYTES) {
      return { ok: false, status: 413, message: "Request path too large" };
    }
  }

  const knownSafePath = KNOWN_SAFE_PATH_PATTERNS.some((pattern) => pattern.test(req.originalUrl || req.path));
  if (!knownSafePath && req.path.includes("//")) {
    return { ok: false, status: 400, message: "Invalid path normalization" };
  }

  return { ok: true, status: 200, message: "ok" };
}

function validateHostHeader(req: Request): { ok: boolean; status: number; message: string } {
  const host = req.headers.host;
  if (!host) {
    return { ok: false, status: 400, message: "Missing host header" };
  }

  if (/[\r\n]/.test(host)) {
    return { ok: false, status: 400, message: "Invalid host header" };
  }

  return { ok: true, status: 200, message: "ok" };
}

function validateQuery(req: Request): { ok: boolean; status: number; message: string } {
  const rawEntries = Object.entries(req.query || {});
  if (rawEntries.length > MAX_QUERY_PARAMS_COUNT) {
    return { ok: false, status: 400, message: "Too many query parameters" };
  }

  for (const [key, value] of rawEntries) {
    if (key.length === 0 || key.length > MAX_QUERY_KEY_LENGTH) {
      return { ok: false, status: 400, message: "Invalid query parameter" };
    }

    if (!ALLOWED_QUERY_KEY_PATTERN.test(key) || DISALLOWED_CONTROL_CHARS.test(key) || MALFORMED_PERCENT_ENCODING.test(key)) {
      return { ok: false, status: 400, message: "Invalid query parameter" };
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return { ok: false, status: 400, message: "Invalid query parameter" };
    }

    const values = Array.isArray(value) ? value : [value];
    for (const queryValue of values) {
      if (queryValue === undefined || queryValue === null) {
        continue;
      }

      if (typeof queryValue !== "string" && typeof queryValue !== "number" && typeof queryValue !== "boolean") {
        return { ok: false, status: 400, message: "Invalid query parameter" };
      }

      const toStringValue = String(queryValue);
      const tooLarge = toStringValue.length > MAX_QUERY_VALUE_LENGTH;
      if (DISALLOWED_CONTROL_CHARS.test(toStringValue) || MALFORMED_PERCENT_ENCODING.test(toStringValue)) {
        return { ok: false, status: 400, message: "Invalid query parameter" };
      }

      if (tooLarge) {
        return { ok: false, status: 413, message: "Query value too large" };
      }
    }
  }

  return { ok: true, status: 200, message: "ok" };
}

function validateMethodPayload(req: Request): { ok: boolean; status: number; message: string } {
  const method = req.method.toUpperCase();
  const hasPayload = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (!hasPayload) {
    return { ok: true, status: 200, message: "ok" };
  }

  const contentType = getContentTypeValue(req);
  const contentLengthValidation = hasValidContentLengthHeader(req.headers["content-length"]);
  const contentLength = contentLengthValidation.value;

  if (!contentLengthValidation.ok) {
    return { ok: false, status: 400, message: "Invalid content-length header" };
  }

  const maxBytes = getMaxBodyBytes(req.originalUrl || req.path);
  if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, status: 413, message: `Payload too large (${contentLength} > ${maxBytes})` };
  }

  if (req.path.startsWith("/api/") && contentType && !isJsonOrFormRequest(contentType)) {
    return { ok: false, status: 415, message: "Unsupported content type" };
  }

  if (contentType && !hasValidCharset(contentType)) {
    return { ok: false, status: 415, message: "Unsupported charset" };
  }

  if (req.body && typeof req.body === "object" && !validateJSONDepth(req.body, MAX_JSON_DEPTH)) {
    return { ok: false, status: 413, message: "Request payload depth exceeded" };
  }

  return { ok: true, status: 200, message: "ok" };
}

function sendBoundaryViolation(
  res: Response,
  status: number,
  message: string,
): void {
  res.status(status).json({
    error: message,
    code: "REQUEST_BOUNDARY_VIOLATION",
    category: status === 413 ? "PAYLOAD_RESTRICTED" : "BAD_REQUEST",
  });
}

export function requestBoundaryGuard(req: Request, res: Response, next: NextFunction): void {
  const pathResult = validatePath(req);
  if (!pathResult.ok) {
    return sendBoundaryViolation(res, pathResult.status, pathResult.message);
  }

  const hostResult = validateHostHeader(req);
  if (!hostResult.ok) {
    return sendBoundaryViolation(res, hostResult.status, hostResult.message);
  }

  const queryResult = validateQuery(req);
  if (!queryResult.ok) {
    return sendBoundaryViolation(res, queryResult.status, queryResult.message);
  }

  const payloadResult = validateMethodPayload(req);
  if (!payloadResult.ok) {
    return sendBoundaryViolation(res, payloadResult.status, payloadResult.message);
  }

  req.body = normalizeInput(req.body) as typeof req.body;
  req.query = normalizeInput(req.query) as typeof req.query;
  req.params = normalizeInput(req.params) as typeof req.params;

  next();
}
