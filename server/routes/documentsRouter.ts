import { NextFunction, Request, Response, Router } from "express";
import fs from "node:fs/promises";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import multer from "multer";
import {
  generateWordDocument,
  generateExcelDocument,
  generatePptDocument,
  normalizePptSlides,
  parseExcelFromText,
  parseSlidesFromText
} from "../services/documentGeneration";
import {
  DocumentRenderRequestSchema,
  renderDocument,
  getGeneratedDocument,
  getTemplates,
  getTemplateById,
  generateFallbackReport,
} from "../services/documentService";
import { renderExcelFromSpec } from "../services/excelSpecRenderer";
import { renderWordFromSpec } from "../services/wordSpecRenderer";
import { generateExcelFromPrompt, generateWordFromPrompt, generateCvFromPrompt, generateReportFromPrompt, generateLetterFromPrompt } from "../services/documentOrchestrator";
import { renderCvFromSpec } from "../services/cvRenderer";
import { selectCvTemplate } from "../services/documentMappingService";
import { excelSpecSchema, docSpecSchema, cvSpecSchema } from "../../shared/documentSpecs";
import { llmGateway } from "../lib/llmGateway";
import { generateAgentToolsExcel } from "../lib/agentToolsGenerator";
import { executeDocxCode } from "../services/docxCodeGenerator";
import { requireNetworkAccessEnabled } from "../middleware/networkAccessGuard";
import { aiLimiter } from "../middleware/rateLimiter";
import {
  sanitizeFilename,
  safeContentDisposition,
  validateBufferSize,
  validatePptSlides,
  sharedDocumentStore,
  canonicalizeSharedContentType,
  logDocumentEvent,
  docConcurrencyLimiter,
  shareConcurrencyLimiter,
  MAX_DOC_BODY_SIZE,
  MAX_SHARED_DOCUMENT_BYTES,
  SHARED_DOCUMENT_TTL_MS,
  validateSharedDocumentSignature,
  hashSharedDownloadToken,
  applyDocumentSecurityHeaders,
  sanitizeErrorMessage,
} from "../services/documentSecurity";
import { documentCliToolRunner } from "../toolRunner/orchestrator";
import {
  getHealthSnapshot,
  isKnownTool,
  listToolDefinitions,
  TOOL_RUNNER_COMMAND_VERSION,
  TOOL_RUNNER_PROTOCOL_VERSION,
} from "../toolRunner/toolRegistry";
import { TOOL_RUNNER_ERROR_CODES, buildToolRunnerErrorMessage } from "../toolRunner/errorContract";
import { ToolAssetRef, ToolRunnerReport } from "../toolRunner/types";
import { getCircuitBreaker } from "../utils/circuitBreaker";
import { withRetryAndTimeout } from "../utils/retry";
import { createLogger } from "../utils/logger";
import { sanitizePlainText } from "../lib/textSanitizers";

// Maximum request body size for document endpoints (1MB)
const DOC_BODY_LIMIT = "1mb";

// Maximum code length for execute-code endpoint
const MAX_EXECUTE_CODE_LENGTH = 50 * 1024;
const MAX_DOC_TITLE_LENGTH = 500;
const MAX_DOCUMENT_ID_LENGTH = 128;
const SAFE_DOCUMENT_ID = /^[a-zA-Z0-9._-]{1,128}$/;
const MAX_PROMPT_LENGTH = 16_000;
const MAX_GENERATION_TIMEOUT_MS = 30_000;
const MAX_LLM_TIMEOUT_MS = 12_000;
const MAX_LLM_JSON_BYTES = 50_000;
const MAX_PLAN_COMMANDS = 500;
const MAX_TRANSLATED_CODE_BYTES = 200_000;
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 200;
const IDEMPOTENCY_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._-]{8,128}$/;
const CORRELATION_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;
const SHARE_UPLOAD_FIELD = "file";
const SHARE_MAX_DOCUMENT_SIZE = MAX_SHARED_DOCUMENT_BYTES;
const SHARE_TTL_MS = SHARED_DOCUMENT_TTL_MS;
const SHARE_ID_LENGTH = 16;
const SHARE_ID_MAX_LENGTH = 64;
const SHARE_ID_MAX_ATTEMPTS = 12;
const SHARE_REQUIRE_DOWNLOAD_TOKEN = process.env.SHARE_REQUIRE_DOWNLOAD_TOKEN === "true";
const SHARE_DOWNLOAD_TOKEN_BYTES = 24;
const SHARE_DOWNLOAD_TOKEN_PARAM = "download_token";
const SHARE_DOWNLOAD_TOKEN_SHORT_PARAM = "t";
const SHARE_DOWNLOAD_TOKEN_RE = new RegExp(`^[a-f0-9]{${SHARE_DOWNLOAD_TOKEN_BYTES * 2}}$`);
const SHARE_DOWNLOAD_RATE_WINDOW_MS = 60_000;
const SHARE_DOWNLOAD_RATE_BLOCK_MS = 60_000;
const SHARE_DOWNLOAD_STATE_TTL_MS = 10 * 60_000;
const SHARE_DOWNLOAD_STATE_MAX_ENTRIES = 10_000;
const SHARE_DOWNLOAD_MAX_PER_WINDOW = clampPositiveInt(
  process.env.SHARE_DOWNLOAD_MAX_PER_WINDOW,
  120,
  20,
  5000
);
const SHARE_DOWNLOAD_TOKEN_INVALID_WINDOW_MS = 10 * 60_000;
const SHARE_DOWNLOAD_TOKEN_INVALID_BLOCK_MS = 15 * 60_000;
const SHARE_DOWNLOAD_TOKEN_INVALID_MAX = clampPositiveInt(
  process.env.SHARE_DOWNLOAD_TOKEN_INVALID_MAX,
  12,
  3,
  1000
);
const SHARE_HOST_HEADER_RE = /^[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/;
const SHARE_HOST_ALLOWLIST = new Set(
  (process.env.SHARE_HOST_ALLOWLIST || process.env.SHARE_HOSTS || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => Boolean(entry))
);
const SHARE_FIELD_NAME_MAX_BYTES = 256;
const SHARE_FORM_BOUNDARY_MAX_LENGTH = 70;
const SHARE_FORM_BOUNDARY_HEADER = /;\s*boundary=([A-Za-z0-9'()+_,-./:=?]+)(?=\s*;|\s*$)/i;
const SHARE_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const SHARE_ALLOWED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const SHARE_ALLOWED_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx", ".pdf"]);
const SHARE_DOCUMENT_TYPES = [
  { extension: ".docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docType: "docx" },
  { extension: ".pdf", mimeType: "application/pdf", docType: "pdf" },
  { extension: ".xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docType: "excel" },
  { extension: ".pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", docType: "pptx" },
] as const;
type ShareDocumentType = (typeof SHARE_DOCUMENT_TYPES)[number]["docType"];
const SHARE_UPLOAD_HANDLER = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, callback) => {
    const normalizedMime = file.mimetype.split(";")[0]?.trim().toLowerCase();
    const isAllowedMime = SHARE_ALLOWED_MIME_TYPES.has(normalizedMime);
    const extension = file.originalname ? getUploadedFileExtension(file.originalname) : "";

    if (!isAllowedMime || !SHARE_ALLOWED_EXTENSIONS.has(extension)) {
      callback(new Error("Unsupported document type"));
      return;
    }

    callback(null, true);
  },
  limits: {
    fileSize: SHARE_MAX_DOCUMENT_SIZE,
    files: 1,
  },
});

const ALLOWED_LOCALES = new Set(["en", "es", "fr", "pt", "de"]);
const PLAN_ALLOWED_COMMANDS = new Set([
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "heading1",
  "heading2",
  "heading3",
  "paragraph",
  "bulletList",
  "orderedList",
  "alignLeft",
  "alignCenter",
  "alignRight",
  "alignJustify",
  "insertLink",
  "insertImage",
  "insertTable",
  "blockquote",
  "codeBlock",
  "insertHorizontalRule",
  "setTextColor",
  "setHighlight",
  "insertText",
  "replaceSelection",
  "clearFormatting",
]);
const PLAN_LANG_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  pt: "Portuguese",
  de: "German",
};
const documentsLlmCircuitBreaker = getCircuitBreaker("documents.llmGateway", {
  failureThreshold: 5,
  resetTimeout: 30_000,
  halfOpenMaxCalls: 2,
});

const logger = createLogger("documents-router");

const REPLAY_HEADER_ALLOWLIST = new Set([
  "content-type",
  "content-length",
  "content-disposition",
  "cache-control",
  "x-request-id",
  "x-tool-runner-status",
  "x-tool-runner-cache-hit",
  "x-tool-runner-command",
  "x-tool-runner-validation",
  "x-tool-runner-incident-count",
  "x-tool-runner-incident-codes",
  "x-generation-attempts",
  "x-quality-warnings",
  "x-postrender-warnings",
]);

type CorrelatedRequest = Request & { correlationId?: string };

type IdempotencyRecord = {
  requestFingerprint: string;
  statusCode: number;
  headers: Record<string, string>;
  bodyBase64: string;
  bodySize: number;
  createdAt: number;
};

const idempotencyStore = new Map<string, IdempotencyRecord>();
type ShareDownloadRateState = {
  windowStart: number;
  count: number;
  blockedUntil: number;
  lastSeen: number;
};

type ShareTokenFailureState = {
  windowStart: number;
  failures: number;
  blockedUntil: number;
  lastSeen: number;
};

const shareDownloadRateStore = new Map<string, ShareDownloadRateState>();
const shareTokenFailureStore = new Map<string, ShareTokenFailureState>();

function clampPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.floor(parsed);
  if (rounded < min) {
    return min;
  }
  if (rounded > max) {
    return max;
  }
  return rounded;
}

function normalizeClientIp(raw: string | undefined): string {
  if (!raw) {
    return "unknown";
  }

  let normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  if (normalized.startsWith("::ffff:")) {
    normalized = normalized.slice(7);
  }
  if (normalized.includes("%")) {
    normalized = normalized.split("%")[0] ?? normalized;
  }
  if (normalized.length > 64) {
    normalized = normalized.slice(0, 64);
  }
  if (!/^[a-z0-9:.]+$/.test(normalized)) {
    return "unknown";
  }

  return normalized;
}

function extractClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const parsedForwarded =
    typeof firstForwarded === "string" ? firstForwarded.split(",")[0]?.trim() : undefined;
  const directIp = typeof req.ip === "string" ? req.ip : undefined;
  return normalizeClientIp(parsedForwarded || directIp);
}

function hashAuditIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function pruneShareDownloadState(now: number = Date.now()): void {
  for (const [key, state] of shareDownloadRateStore) {
    if (state.lastSeen + SHARE_DOWNLOAD_STATE_TTL_MS < now) {
      shareDownloadRateStore.delete(key);
    }
  }

  for (const [key, state] of shareTokenFailureStore) {
    if (state.lastSeen + SHARE_DOWNLOAD_STATE_TTL_MS < now) {
      shareTokenFailureStore.delete(key);
    }
  }

  if (shareDownloadRateStore.size > SHARE_DOWNLOAD_STATE_MAX_ENTRIES) {
    const byAge = [...shareDownloadRateStore.entries()].sort(([, a], [, b]) => a.lastSeen - b.lastSeen);
    const removeCount = shareDownloadRateStore.size - SHARE_DOWNLOAD_STATE_MAX_ENTRIES;
    for (let index = 0; index < removeCount; index += 1) {
      const entry = byAge[index];
      if (entry) {
        shareDownloadRateStore.delete(entry[0]);
      }
    }
  }

  if (shareTokenFailureStore.size > SHARE_DOWNLOAD_STATE_MAX_ENTRIES) {
    const byAge = [...shareTokenFailureStore.entries()].sort(([, a], [, b]) => a.lastSeen - b.lastSeen);
    const removeCount = shareTokenFailureStore.size - SHARE_DOWNLOAD_STATE_MAX_ENTRIES;
    for (let index = 0; index < removeCount; index += 1) {
      const entry = byAge[index];
      if (entry) {
        shareTokenFailureStore.delete(entry[0]);
      }
    }
  }
}

function consumeShareDownloadRate(clientIp: string): {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
  limit: number;
} {
  const now = Date.now();
  pruneShareDownloadState(now);

  const limit = SHARE_DOWNLOAD_MAX_PER_WINDOW;
  const state = shareDownloadRateStore.get(clientIp) ?? {
    windowStart: now,
    count: 0,
    blockedUntil: 0,
    lastSeen: now,
  };

  if (state.blockedUntil > now) {
    state.lastSeen = now;
    shareDownloadRateStore.set(clientIp, state);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)),
      remaining: 0,
      limit,
    };
  }

  if (state.windowStart + SHARE_DOWNLOAD_RATE_WINDOW_MS <= now) {
    state.windowStart = now;
    state.count = 0;
    state.blockedUntil = 0;
  }

  state.count += 1;
  state.lastSeen = now;
  if (state.count > limit) {
    state.blockedUntil = now + SHARE_DOWNLOAD_RATE_BLOCK_MS;
    shareDownloadRateStore.set(clientIp, state);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(SHARE_DOWNLOAD_RATE_BLOCK_MS / 1000)),
      remaining: 0,
      limit,
    };
  }

  shareDownloadRateStore.set(clientIp, state);
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(limit - state.count, 0),
    limit,
  };
}

function getShareTokenFailureKey(shareId: string, clientIp: string): string {
  return `${shareId}:${clientIp}`;
}

function registerShareTokenFailure(
  shareId: string,
  clientIp: string
): { blocked: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneShareDownloadState(now);
  const key = getShareTokenFailureKey(shareId, clientIp);
  const state = shareTokenFailureStore.get(key) ?? {
    windowStart: now,
    failures: 0,
    blockedUntil: 0,
    lastSeen: now,
  };

  if (state.blockedUntil > now) {
    state.lastSeen = now;
    shareTokenFailureStore.set(key, state);
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)),
    };
  }

  if (state.windowStart + SHARE_DOWNLOAD_TOKEN_INVALID_WINDOW_MS <= now) {
    state.windowStart = now;
    state.failures = 0;
    state.blockedUntil = 0;
  }

  state.failures += 1;
  state.lastSeen = now;
  if (state.failures >= SHARE_DOWNLOAD_TOKEN_INVALID_MAX) {
    state.blockedUntil = now + SHARE_DOWNLOAD_TOKEN_INVALID_BLOCK_MS;
    shareTokenFailureStore.set(key, state);
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil(SHARE_DOWNLOAD_TOKEN_INVALID_BLOCK_MS / 1000)),
    };
  }

  shareTokenFailureStore.set(key, state);
  return {
    blocked: false,
    retryAfterSeconds: 0,
  };
}

function clearShareTokenFailureState(shareId: string, clientIp: string): void {
  shareTokenFailureStore.delete(getShareTokenFailureKey(shareId, clientIp));
}

function canonicalizeForHash(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeForHash(entry));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const normalized: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of sortedEntries) {
      normalized[entryKey] = canonicalizeForHash(entryValue);
    }
    return normalized;
  }
  return `${value}`;
}

function buildIdempotencyFingerprint(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalizeForHash(payload))).digest("hex");
}

function readIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (!IDEMPOTENCY_KEY_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function readCorrelationId(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return randomUUID();
  }

  if (!CORRELATION_ID_RE.test(trimmed)) {
    return randomUUID();
  }

  return trimmed;
}

function getCorrelationId(req: CorrelatedRequest): string {
  return req.correlationId ?? randomUUID();
}

function enrichAuditDetails(details: Record<string, unknown>, requestId: string): Record<string, unknown> {
  return { ...details, requestId };
}

function getIdempotencyCacheKey(prefix: string, idempotencyKey: string): string {
  return `${prefix}:${idempotencyKey}`;
}

function normalizeHeaderValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return String(value[0]);
  }
  if (typeof value === "number") {
    return String(value);
  }
  return typeof value === "string" ? value : String(value);
}

function extractReplayHeaders(headers: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (!REPLAY_HEADER_ALLOWLIST.has(lowerName)) {
      continue;
    }

    const normalized = normalizeHeaderValue(value);
    if (normalized !== undefined) {
      result[lowerName] = normalized;
    }
  }
  return result;
}

function parseContentLengthHeader(rawValue: unknown, max: number): { value: number; provided: boolean; valid: boolean } {
  const normalized = normalizeHeaderValue(rawValue);
  if (normalized === undefined) {
    return { value: 0, provided: false, valid: true };
  }

  if (!/^\d+$/.test(normalized)) {
    return { value: 0, provided: true, valid: false };
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    return { value: parsed, provided: true, valid: false };
  }

  return { value: parsed, provided: true, valid: true };
}

function parseMultipartBoundary(contentType: unknown): string | null {
  if (typeof contentType !== "string") {
    return null;
  }

  const match = contentType.match(SHARE_FORM_BOUNDARY_HEADER);
  if (!match?.[1]) {
    return null;
  }

  return match[1];
}

function isSafeMultipartBoundary(boundary: string): boolean {
  const trimmed = boundary.trim();
  return Boolean(
    trimmed.length > 0 &&
      trimmed.length <= SHARE_FORM_BOUNDARY_MAX_LENGTH &&
      SHARE_FORM_BOUNDARY_HEADER.test(`; boundary=${trimmed}`)
  );
}

function normalizeUploadedMimeType(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.split(";")[0]?.trim().toLowerCase() || "";
}

const shareUploadHandler = (req: Request, res: Response, next: NextFunction): void => {
  SHARE_UPLOAD_HANDLER.single(SHARE_UPLOAD_FIELD)(req, res, (error: unknown) => {
    if (!error) {
      return next();
    }

    const requestId = getCorrelationId(req as CorrelatedRequest);
    const uploadError = error as { code?: string; message?: string };
    let statusCode = 400;
    let publicMessage = "Share upload validation failed";

    if (uploadError.code === "LIMIT_FILE_SIZE") {
      statusCode = 413;
      publicMessage = "Uploaded document exceeds maximum allowed size";
    } else if (uploadError.code === "LIMIT_FILE_COUNT" || uploadError.code === "LIMIT_UNEXPECTED_FILE") {
      statusCode = 400;
      publicMessage = "Invalid file upload payload";
    }

    logger.warn("Share upload failed in middleware", {
      requestId,
      errorCode: uploadError.code,
      errorMessage: uploadError.message,
    });

    res.status(statusCode).json({
      ...safeErrorResponseWithRequest(publicMessage, error, req as CorrelatedRequest),
      errorCode: uploadError.code || "UPLOAD_ERROR",
    });
  });
};

function normalizeUploadedFileName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  if (value.length > SHARE_FIELD_NAME_MAX_BYTES) {
    return value.slice(0, SHARE_FIELD_NAME_MAX_BYTES);
  }
  return value.trim().toLowerCase();
}

function isAllowedShareHost(host: string): boolean {
  if (SHARE_HOST_ALLOWLIST.size === 0) {
    return true;
  }

  const normalized = host.toLowerCase();
  if (SHARE_HOST_ALLOWLIST.has(normalized)) {
    return true;
  }

  const hostname = normalized.split(":")[0];
  return SHARE_HOST_ALLOWLIST.has(hostname);
}

function getUploadedFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return fileName.slice(index).toLowerCase();
}

function normalizeShareId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > SHARE_ID_MAX_LENGTH) {
    return null;
  }

  return trimmed;
}

function parseShareToken(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.length > 0 ? parseShareToken(value[0]) : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!SHARE_DOWNLOAD_TOKEN_RE.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function verifyShareDownloadToken(expectedHash: string | undefined, token: string | null): boolean {
  if (!expectedHash || !token) {
    return false;
  }

  if (!SHARE_DOWNLOAD_TOKEN_RE.test(token)) {
    return false;
  }

  try {
    const expected = Buffer.from(expectedHash, "hex");
    const actual = Buffer.from(hashSharedDownloadToken(token), "hex");
    if (expected.length !== actual.length) {
      return false;
    }
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function generateShareId(seed: string, attempt: number): string {
  return createHash("sha256")
    .update(`${seed}:${attempt}:${Date.now()}:${randomUUID()}`)
    .digest("hex")
    .slice(0, SHARE_ID_LENGTH);
}

function resolveSharedDocumentType(input: { mimeType?: string; fileName?: string; } | undefined): {
  extension: string;
  mimeType: string;
  docType: ShareDocumentType;
} | null {
  if (!input) {
    return null;
  }

  const normalizedMime = normalizeUploadedMimeType(input.mimeType ?? "");
  const normalizedFileName = normalizeUploadedFileName(input.fileName ?? "");
  const extension = getUploadedFileExtension(normalizedFileName);

  const byMime = SHARE_DOCUMENT_TYPES.find((entry) => entry.mimeType === normalizedMime);
  const byExtension = SHARE_DOCUMENT_TYPES.find((entry) => entry.extension === extension);

  if (!byMime && !byExtension) {
    return null;
  }

  if (byMime && byExtension && byMime.docType !== byExtension.docType) {
    return null;
  }

  const resolved = byMime ?? byExtension;
  if (!resolved || !SHARE_ALLOWED_MIME_TYPES.has(resolved.mimeType) || !SHARE_ALLOWED_EXTENSIONS.has(resolved.extension)) {
    return null;
  }

  return resolved;
}

function safeShareRequestMeta(req: CorrelatedRequest): {
  requestId: string;
  contentType: string | undefined;
  contentLengthBytes: number;
  contentLengthProvided: boolean;
  hasInvalidContentLength: boolean;
  multipartBoundary: string | null;
  multipartValid: boolean;
} {
  const contentTypeHeader = req.headers["content-type"];
  const contentLengthHeader = req.headers["content-length"];
  const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
  const parsedContentLength = parseContentLengthHeader(contentLengthHeader, SHARE_MAX_DOCUMENT_SIZE);
  const boundary = parseMultipartBoundary(contentType);
  const hasBoundary = boundary !== null;
  const multipartValid = hasBoundary && isSafeMultipartBoundary(boundary);

  return {
    requestId: getCorrelationId(req),
    contentType,
    contentLengthBytes: parsedContentLength.value,
    contentLengthProvided: parsedContentLength.provided,
    hasInvalidContentLength: !parsedContentLength.valid,
    multipartBoundary: boundary,
    multipartValid,
  };
}

function parseIfNoneMatch(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .map((entry) => entry.replace(/^W\//i, "").trim())
    .filter((entry) => Boolean(entry))
    .map((entry) => entry.replace(/^\"|\"$/g, ""));
}

function parseIfModifiedSince(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

function readSafeHost(req: CorrelatedRequest): string | null {
  const rawHost = req.get("host");
  if (!rawHost) {
    return null;
  }
  const normalized = rawHost.trim().toLowerCase();
  if (!SHARE_HOST_HEADER_RE.test(normalized)) {
    return null;
  }
  if (!isAllowedShareHost(normalized)) {
    return null;
  }
  return normalized;
}

function pruneIdempotencyStore(): void {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore.entries()) {
    if (now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
      idempotencyStore.delete(key);
    }
  }

  if (idempotencyStore.size <= IDEMPOTENCY_MAX_ENTRIES) {
    return;
  }

  const byAge = [...idempotencyStore.entries()].sort(([, a], [, b]) => a.createdAt - b.createdAt);
  const removeCount = idempotencyStore.size - IDEMPOTENCY_MAX_ENTRIES;
  for (let i = 0; i < removeCount; i += 1) {
    idempotencyStore.delete(byAge[i]![0]);
  }
}

function getIdempotencyReplay(
  cacheKey: string,
  requestFingerprint: string
): IdempotencyRecord | "conflict" | null {
  pruneIdempotencyStore();

  const existing = idempotencyStore.get(cacheKey);
  if (!existing) {
    return null;
  }

  if (
    existing.requestFingerprint.length !== requestFingerprint.length ||
    !timingSafeEqual(
      Buffer.from(existing.requestFingerprint, "utf8"),
      Buffer.from(requestFingerprint, "utf8")
    )
  ) {
    return "conflict";
  }
  return existing;
}

function replayIdempotentResponse(res: Response, entry: IdempotencyRecord): void {
  for (const [name, value] of Object.entries(entry.headers)) {
    res.setHeader(name, value);
  }
  res.status(entry.statusCode).send(Buffer.from(entry.bodyBase64, "base64"));
}

function storeIdempotentResponse(cacheKey: string, requestFingerprint: string, entry: {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
}): void {
  if (entry.body.length > IDEMPOTENCY_MAX_RESPONSE_BYTES) {
    return;
  }

  idempotencyStore.set(cacheKey, {
    requestFingerprint,
    statusCode: entry.statusCode,
    headers: entry.headers,
    bodyBase64: entry.body.toString("base64"),
    bodySize: entry.body.length,
    createdAt: Date.now(),
  });
}

const GenerateDocumentRequestSchema = z.object({
  type: z.enum(["word", "excel", "ppt"]),
  title: z.string().trim().min(1).max(MAX_DOC_TITLE_LENGTH),
  content: z.string().min(1).max(MAX_DOC_BODY_SIZE),
  locale: z.string().trim().max(20).optional(),
  designTokens: z.record(z.unknown()).optional(),
  theme: z.record(z.unknown()).optional(),
  assets: z.array(z.record(z.unknown())).max(32).optional(),
  options: z.record(z.unknown()).optional(),
}).passthrough();

const PromptGenerationSchema = z.object({
  prompt: z.string().trim().min(3).max(MAX_PROMPT_LENGTH),
  returnMetadata: z.boolean().optional(),
});

const PlanRequestSchema = z.object({
  prompt: z.string().trim().min(3).max(MAX_PROMPT_LENGTH),
  selectedText: z.string().trim().max(10_000).optional(),
  documentContent: z.string().trim().max(50_000).optional(),
});

const ExecuteCodeSchema = z.object({
  code: z.string().min(1).max(MAX_EXECUTE_CODE_LENGTH),
});

const GrammarCheckSchema = z.object({
  code: z.string().min(1).max(MAX_DOC_BODY_SIZE),
});

const TranslateRequestSchema = z.object({
  code: z.string().min(1).max(MAX_DOC_BODY_SIZE),
  targetLang: z.enum(["en", "es", "fr", "pt", "de"]).default("en"),
});

const PlanCommandSchema = z.object({
  name: z.string().trim().min(1).max(64),
  payload: z.record(z.unknown()).optional(),
  description: z.string().trim().max(400).optional(),
});

const PlanResponseSchema = z.object({
  intent: z.string().trim().max(1000),
  commands: z.array(PlanCommandSchema).max(MAX_PLAN_COMMANDS),
  error: z.string().trim().max(500).optional(),
});

const GrammarCheckItemSchema = z.object({
  text: z.string().trim().max(2000),
  suggestion: z.string().trim().max(2000),
  type: z.string().trim().max(200).optional(),
});

const GrammarCheckResponseSchema = z.object({
  errors: z.array(GrammarCheckItemSchema).max(200),
});

/** Whether to expose detailed error messages in API responses */
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Build a safe error response object. In production, internal details
 * are stripped to prevent information leakage.
 */
function safeErrorResponse(publicMessage: string, error: unknown): { error: string; details?: string } {
  if (IS_PRODUCTION) {
    return { error: publicMessage };
  }
  return { error: publicMessage, details: sanitizeErrorMessage(error) };
}

function safeErrorResponseWithRequest(
  publicMessage: string,
  error: unknown,
  req: CorrelatedRequest
): { error: string; details?: string; requestId: string } {
  return {
    requestId: getCorrelationId(req),
    ...safeErrorResponse(publicMessage, error),
  };
}

function normalizeLocale(value: unknown): string {
  if (typeof value !== "string") {
    return "es";
  }
  const normalized = value.trim().toLowerCase();
  return ALLOWED_LOCALES.has(normalized) ? normalized : "es";
}

function parseValidated<T extends z.ZodTypeAny>(
  schema: T,
  payload: unknown,
  context: string
): z.infer<T> | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    logger.warn("Invalid request body", {
      context,
      issues: parsed.error.issues.slice(0, 5).map((issue) => issue.message),
    });
    return null;
  }
  return parsed.data;
}

function parseLlmJson(raw: string): unknown {
  const sanitized = raw.replace(/```json\n?/g, "").replace(/\n?```/g, "").trim();
  if (sanitized.length > MAX_LLM_JSON_BYTES) {
    throw new Error("LLM response exceeds safe size");
  }
  return JSON.parse(sanitized);
}

async function runLlmChat(
  messages: Parameters<typeof llmGateway.chat>[0],
  options: Parameters<typeof llmGateway.chat>[1]
): Promise<Awaited<ReturnType<typeof llmGateway.chat>>> {
  return withRetryAndTimeout(
    () =>
      documentsLlmCircuitBreaker.execute(() => llmGateway.chat(messages, options)),
    {
      maxRetries: 2,
      baseDelay: 350,
      maxDelay: 1_500,
    },
    MAX_LLM_TIMEOUT_MS
  );
}

function normalizeObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function isSafeDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_DOCUMENT_ID_LENGTH && SAFE_DOCUMENT_ID.test(value);
}

function normalizeTheme(value: unknown): { id?: string; name?: string; tokens?: Record<string, unknown> } | undefined {
  const normalized = normalizeObject(value);
  if (!normalized) {
    return undefined;
  }

  const normalizedTokens = normalizeObject(normalized.tokens);

  return {
    id: typeof normalized.id === "string" && normalized.id.trim().length > 0 ? normalized.id.trim() : undefined,
    name:
      typeof normalized.name === "string" && normalized.name.trim().length > 0
        ? normalized.name.trim()
        : undefined,
    tokens:
      normalizedTokens && Object.keys(normalizedTokens).length > 0 ? normalizedTokens : undefined,
  };
}

function normalizeAssets(value: unknown): ToolAssetRef[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const assets: ToolAssetRef[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const entry = candidate as Partial<ToolAssetRef>;
    if (typeof entry.name !== "string" || !entry.name.trim() || typeof entry.path !== "string" || !entry.path.trim()) {
      continue;
    }

    assets.push({
      name: entry.name.trim(),
      path: entry.path.trim(),
      mediaType: typeof entry.mediaType === "string" ? entry.mediaType : undefined,
      sha256: typeof entry.sha256 === "string" ? entry.sha256 : undefined,
    });
  }

  return assets.length > 0 ? assets : undefined;
}

function buildToolRunnerFallbackReport(
  command: "docx" | "xlsx" | "pptx",
  locale: string
): ToolRunnerReport {
  const now = new Date().toISOString();
  const sandbox = process.env.TOOL_RUNNER_SANDBOX === "docker" ? "docker" : "subprocess";
  const code = TOOL_RUNNER_ERROR_CODES.FALLBACK_FAILED;
  const message = buildToolRunnerErrorMessage({
    code,
    locale,
    details: "Tool runner did not return a report payload.",
  });

  const incident = {
    code,
    message,
    severity: "warning" as const,
    details: {
      source: "documentsRouter",
      command,
    },
  };

  return {
    protocolVersion: TOOL_RUNNER_PROTOCOL_VERSION,
    locale,
    requestHash: `fallback-${command}-${Date.now()}`,
    documentType: command,
    toolVersionPin: TOOL_RUNNER_COMMAND_VERSION,
    sandbox,
    usedFallback: true,
    cacheHit: false,
    artifactPath: "in-memory://tool-runner-no-report",
    validation: {
      valid: false,
      checks: {
        relationships: false,
        styles: false,
        fonts: false,
        images: false,
        schema: false,
      },
      metadata: {
        artifactPath: "in-memory://tool-runner-no-report",
        bytes: 0,
      },
      issues: [incident],
    },
    traces: [],
    incidents: [incident],
    metrics: {
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      retries: 0,
    },
  };
}

function sendToolRunnerHeaders(
  res: Response,
  report: ToolRunnerReport | undefined,
  command: "docx" | "xlsx" | "pptx",
  toolRunnerRequested: boolean,
  locale: string = "es"
): void {
  if (!toolRunnerRequested) {
    return;
  }

  const fallback = report ?? buildToolRunnerFallbackReport(command, locale);
  const incidentCodes = (fallback.incidents ?? []).map((incident) => incident.code);

  res.setHeader("X-Tool-Runner-Request-Hash", fallback.requestHash);
  res.setHeader("X-Tool-Runner-Status", fallback.usedFallback ? "fallback" : "success");
  res.setHeader("X-Tool-Runner-Cache-Hit", String(fallback.cacheHit));
  res.setHeader("X-Tool-Runner-Command", command);
  res.setHeader("X-Tool-Runner-Validation", fallback.validation.valid ? "valid" : "invalid");
  res.setHeader("X-Tool-Runner-Incident-Count", String(incidentCodes.length));
  res.setHeader("X-Tool-Runner-Incident-Codes", incidentCodes.join(","));
}

export function createDocumentsRouter() {
  const router = Router();

  // Apply security headers to all document routes
  router.use((_req, res, next) => {
    applyDocumentSecurityHeaders(res);
    next();
  });

  router.use((req: CorrelatedRequest, res, next) => {
    const incomingRequestId =
      req.get("X-Request-Id") ??
      req.get("x-request-id") ??
      req.get("X-Correlation-Id") ??
      req.get("X-Correlation-ID") ??
      req.get("x-correlation-id") ??
      req.get("trace-id");
    req.correlationId = readCorrelationId(incomingRequestId);
    res.setHeader("X-Request-Id", req.correlationId);
    next();
  });

  router.get("/tool-runner/capabilities", async (req, res) => {
    const command = typeof req.query.command === "string" ? req.query.command.toLowerCase() : undefined;

    if (!command) {
      const health = getHealthSnapshot();
      return res.json({
        protocolVersion: health.protocolVersion,
        commandVersion: health.commandVersion,
        tools: listToolDefinitions(),
      });
    }

    if (!isKnownTool(command)) {
      return res.status(404).json({ error: "Tool not found", tool: command });
    }

    const match = listToolDefinitions().find((tool) => tool.name === command);
    if (!match) {
      return res.status(404).json({ error: "Tool definition not found", tool: command });
    }

    res.json(match);
  });

  router.get("/tool-runner/healthcheck", async (req, res) => {
    const command = typeof req.query.command === "string" ? req.query.command.toLowerCase() : undefined;

    if (command && !isKnownTool(command)) {
      return res.status(404).json({ error: "Tool not found", tool: command });
    }

    res.json(getHealthSnapshot(command));
  });

  // ============================================
  // SIMPLE DOCUMENT GENERATION
  // ============================================

  router.post("/generate", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const parsedBody = parseValidated(GenerateDocumentRequestSchema, req.body, "generate");
      if (!parsedBody) {
        return res.status(400).json({ error: "Invalid request body for /generate" });
      }
      const rawIdempotencyKey = req.get("Idempotency-Key");
      const idempotencyKey = readIdempotencyKey(rawIdempotencyKey);
      if (rawIdempotencyKey !== undefined && !idempotencyKey) {
        return res.status(400).json({ error: "Invalid Idempotency-Key header" });
      }
      const requestFingerprint = buildIdempotencyFingerprint(parsedBody);
      if (idempotencyKey) {
        const replay = getIdempotencyReplay(
          getIdempotencyCacheKey("/generate", idempotencyKey),
          requestFingerprint
        );
        if (replay === "conflict") {
          return res.status(409).json({ error: "Idempotency key replay mismatch" });
        }
        if (replay) {
          return replayIdempotentResponse(res, replay);
        }
      }

      const type = parsedBody.type;
      const safeTitle = sanitizePlainText(parsedBody.title, { maxLen: MAX_DOC_TITLE_LENGTH, collapseWs: true });
      const safeContent = sanitizePlainText(parsedBody.content, { maxLen: MAX_DOC_BODY_SIZE, collapseWs: false });
      const runnerLocale = normalizeLocale(parsedBody.locale);
      const useToolRunner = process.env.DISABLE_TOOL_RUNNER !== "true";
      const designTokens = normalizeObject(parsedBody.designTokens);
      const theme = normalizeTheme(parsedBody.theme);
      const assets = normalizeAssets(parsedBody.assets);
      const runnerOptions = normalizeObject(parsedBody.options);
      const runnerDocumentType = type === "word" ? "docx" : type === "excel" ? "xlsx" : "pptx";
      let toolRunnerReport: ToolRunnerReport | undefined;

      if (!safeTitle.trim()) {
        return res.status(400).json({ error: "title cannot be empty" });
      }

      if (!safeContent.trim()) {
        return res.status(400).json({ error: "content cannot be empty" });
      }

      // Acquire concurrency slot
      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: type });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "generate_start", docType: type });

      let buffer: Buffer;
      let filename: string;
      let mimeType: string;
      let toolRunnerRequested = false;

      try {
        switch (type) {
          case "word":
            try {
              if (useToolRunner) {
                toolRunnerRequested = true;
                const result = await documentCliToolRunner.generate({
                  documentType: "docx",
                  title: safeTitle,
                  data: {
                    content: safeContent,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                });
                buffer = await fs.readFile(result.artifactPath);
                toolRunnerReport = result.report;
              } else {
                buffer = await generateWordDocument(safeTitle, safeContent);
              }
            } catch (error) {
              logDocumentEvent({
                timestamp: new Date().toISOString(),
                event: "generate_fallback",
                docType: "word",
                details: { error: sanitizeErrorMessage(error) },
              });
              const fallbackResult = await generateFallbackReport(
                {
                  type: "docx",
                  templateId: "legacy-fallback",
                  data: {
                    title: safeTitle,
                    content: safeContent,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                },
                "docx",
                error,
                async () => generateWordDocument(safeTitle, safeContent)
              );
              toolRunnerReport = fallbackResult.report;
              buffer = fallbackResult.buffer;
            }
            filename = sanitizeFilename(safeTitle, ".docx");
            mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            break;
          case "excel": {
            try {
              if (useToolRunner) {
                toolRunnerRequested = true;
                const result = await documentCliToolRunner.generate({
                  documentType: "xlsx",
                  title: safeTitle,
                  data: {
                    content: safeContent,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                });
                buffer = await fs.readFile(result.artifactPath);
                toolRunnerReport = result.report;
              } else {
                const excelData = parseExcelFromText(safeContent);
                buffer = await generateExcelDocument(safeTitle, excelData);
              }
            } catch (error) {
              logDocumentEvent({
                timestamp: new Date().toISOString(),
                event: "generate_fallback",
                docType: "excel",
                details: { error: sanitizeErrorMessage(error) },
              });
              const fallbackResult = await generateFallbackReport(
                {
                  type: "xlsx",
                  templateId: "legacy-fallback",
                  data: {
                    title: safeTitle,
                    content: safeContent,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                },
                "xlsx",
                error,
                async () => {
                  const excelData = parseExcelFromText(safeContent);
                  return generateExcelDocument(safeTitle, excelData);
                }
              );
              toolRunnerReport = fallbackResult.report;
              buffer = fallbackResult.buffer;
            }
            filename = sanitizeFilename(safeTitle, ".xlsx");
            mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            break;
          }
          case "ppt": {
            const slides = parseSlidesFromText(safeContent);
            const normalized = normalizePptSlides(safeTitle, slides);
            const pptReport = validatePptSlides(normalized.slides as { title: string; content: string[] }[]);

            if (!pptReport.valid) {
              logDocumentEvent({
                timestamp: new Date().toISOString(),
                event: "validation_error",
                docType: "ppt",
                details: { errors: pptReport.errors },
              });
            }

            try {
              if (useToolRunner) {
                toolRunnerRequested = true;
                const result = await documentCliToolRunner.generate({
                  documentType: "pptx",
                  title: safeTitle,
                  data: {
                    slides: normalized.slides,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                });
                buffer = await fs.readFile(result.artifactPath);
                toolRunnerReport = result.report;
              } else {
                buffer = await generatePptDocument(normalized.title, normalized.slides, {
                  trace: {
                    source: "documentsRouter",
                  },
                });
              }
            } catch (error) {
              logDocumentEvent({
                timestamp: new Date().toISOString(),
                event: "generate_fallback",
                docType: "ppt",
                details: { error: sanitizeErrorMessage(error) },
              });
              const fallbackResult = await generateFallbackReport(
                {
                  type: "pptx",
                  templateId: "legacy-fallback",
                  data: {
                    title: safeTitle,
                    slides: normalized.slides,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                },
                "pptx",
                error,
                async () =>
                  generatePptDocument(normalized.title, normalized.slides, {
                    trace: {
                      source: "documentsRouter",
                    },
                  })
              );
              toolRunnerReport = fallbackResult.report;
              buffer = fallbackResult.buffer;
            }
            filename = sanitizeFilename(safeTitle, ".pptx");
            mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            break;
          }
          default:
            return res.status(400).json({ error: "Invalid document type. Use 'word', 'excel', or 'ppt'" });
        }
      } finally {
        docConcurrencyLimiter.release();
      }

      // Validate generated buffer
      const bufferCheck = validateBufferSize(buffer, type);
      if (!bufferCheck.valid) {
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "generate_failure",
          docType: type,
          details: { error: bufferCheck.error },
        });
        return res.status(500).json({ error: bufferCheck.error });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: type,
        durationMs: Date.now() - startTime,
        details: { bufferSize: buffer.length },
      });

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      sendToolRunnerHeaders(
        res,
        toolRunnerReport,
        runnerDocumentType,
        toolRunnerRequested,
        runnerLocale
      );
      if (idempotencyKey) {
        storeIdempotentResponse(
          getIdempotencyCacheKey("/generate", idempotencyKey),
          requestFingerprint,
          {
            statusCode: 200,
            headers: extractReplayHeaders(res.getHeaders() as Record<string, unknown>),
            body: buffer,
          }
        );
      }
      res.send(buffer);
    } catch (error: any) {
      logger.error("Document generation error", {
        error: sanitizeErrorMessage(error),
      });
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_failure",
        docType: req.body?.type || "unknown",
        durationMs: Date.now() - startTime,
        details: { error: sanitizeErrorMessage(error) },
      });
      res.status(500).json(safeErrorResponse("Failed to generate document", error));
    }
  });

  // ============================================
  // AGENT TOOLS CATALOG
  // ============================================

  router.get("/agent-tools-catalog", async (req, res) => {
    try {
      const buffer = await generateAgentToolsExcel();
      const filename = sanitizeFilename(`Agent_Tools_PRO_Edition_${new Date().toISOString().split('T')[0]}`, ".xlsx");

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.send(buffer);
    } catch (error: any) {
      logger.error("Agent tools catalog generation error", {
        error: sanitizeErrorMessage(error),
      });
      res.status(500).json(safeErrorResponse("Failed to generate agent tools catalog", error));
    }
  });

  // ============================================
  // TEMPLATES
  // ============================================

  router.get("/templates", async (req, res) => {
    try {
      const templates = getTemplates();
      const type = req.query.type as string | undefined;

      if (type) {
        const filtered = templates.filter(t => t.type.includes(type as any));
        return res.json(filtered);
      }

      res.json(templates);
    } catch (error: any) {
      logger.error("Error fetching templates", {
        error: sanitizeErrorMessage(error),
      });
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  router.get("/templates/:id", async (req, res) => {
    try {
      if (!isSafeDocumentId(req.params.id)) {
        return res.status(400).json({ error: "Invalid template id" });
      }

      const template = getTemplateById(req.params.id);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(template);
    } catch (error: any) {
      logger.error("Error fetching template", {
        error: sanitizeErrorMessage(error),
      });
      res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  // ============================================
  // DOCUMENT RENDER (TEMPLATE-BASED)
  // ============================================

  router.post("/render", aiLimiter, async (req, res) => {
    try {
      const parseResult = DocumentRenderRequestSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: parseResult.error.flatten().fieldErrors
        });
      }

      const document = await renderDocument(parseResult.data);

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const downloadUrl = `${baseUrl}/api/documents/${document.id}`;

      res.json({
        id: document.id,
        fileName: document.fileName,
        mimeType: document.mimeType,
        downloadUrl,
        expiresAt: document.expiresAt.toISOString(),
        ...(document.generationReport
          ? {
              toolRunnerReport: {
                requestHash: document.generationReport.requestHash,
                documentType: document.generationReport.documentType,
                usedFallback: document.generationReport.usedFallback,
                cacheHit: document.generationReport.cacheHit,
                sandbox: document.generationReport.sandbox,
                validation: {
                  valid: document.generationReport.validation.valid,
                  checks: document.generationReport.validation.checks,
                },
                metrics: document.generationReport.metrics,
                incidents: document.generationReport.incidents,
              },
            }
          : undefined),
      });
    } catch (error: any) {
      logger.error("Document render error", {
        error: sanitizeErrorMessage(error),
      });
      res.status(500).json(safeErrorResponse("Failed to render document", error));
    }
  });

  // ============================================
  // DOCUMENT DOWNLOAD
  // ============================================

  router.get("/reports/:id", async (req, res) => {
    try {
      if (!isSafeDocumentId(req.params.id)) {
        return res.status(400).json({ error: "Invalid report id" });
      }

      const document = getGeneratedDocument(req.params.id);

      if (!document) {
        return res.status(404).json({ error: "Document not found or expired" });
      }

      if (!document.generationReport) {
        return res.status(404).json({ error: "Generation report unavailable for this document" });
      }

      res.json({
        documentId: document.id,
        toolRunnerReport: document.generationReport,
      });
    } catch (error: any) {
      logger.error("Tool runner report error", {
        error: sanitizeErrorMessage(error),
      });
      res.status(500).json({ error: "Failed to fetch generation report" });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      if (!isSafeDocumentId(req.params.id)) {
        return res.status(400).json({ error: "Invalid document id" });
      }

      const document = getGeneratedDocument(req.params.id);

      if (!document) {
        return res.status(404).json({ error: "Document not found or expired" });
      }

      res.setHeader("Content-Type", document.mimeType);
      res.setHeader("Content-Disposition", safeContentDisposition(document.fileName));
      res.setHeader("Content-Length", document.buffer.length);
      res.send(document.buffer);
    } catch (error: any) {
      logger.error("Document download error", {
        error: sanitizeErrorMessage(error),
      });
      res.status(500).json({ error: "Failed to download document" });
    }
  });

  // ============================================
  // RENDER FROM SPEC (EXCEL)
  // ============================================

  router.post("/render/excel", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const parseResult = excelSpecSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid Excel spec",
          details: parseResult.error.flatten().fieldErrors
        });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "render_start", docType: "excel" });

      const buffer = await renderExcelFromSpec(parseResult.data);

      // Validate buffer
      const bufferCheck = validateBufferSize(buffer, "excel");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      const filename = sanitizeFilename(parseResult.data.workbook_title || "workbook", ".xlsx");

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "render_success",
        docType: "excel",
        durationMs: Date.now() - startTime,
        details: { bufferSize: buffer.length },
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      logger.error("Excel render error", {
        error: sanitizeErrorMessage(error),
      });
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "render_failure",
          docType: "excel",
          durationMs: Date.now() - startTime,
          details: { error: sanitizeErrorMessage(error) },
        });
      res.status(500).json(safeErrorResponse("Failed to render Excel document", error));
    }
  });

  // ============================================
  // RENDER FROM SPEC (WORD)
  // ============================================

  router.post("/render/word", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const parseResult = docSpecSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid Word doc spec",
          details: parseResult.error.flatten().fieldErrors
        });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "render_start", docType: "word" });

      const buffer = await renderWordFromSpec(parseResult.data);

      // Validate buffer
      const bufferCheck = validateBufferSize(buffer, "word");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      const filename = sanitizeFilename(parseResult.data.title || "document", ".docx");

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "render_success",
        docType: "word",
        durationMs: Date.now() - startTime,
        details: { bufferSize: buffer.length },
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      logger.error("Word render error", {
        error: sanitizeErrorMessage(error),
      });
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "render_failure",
          docType: "word",
          durationMs: Date.now() - startTime,
          details: { error: sanitizeErrorMessage(error) },
        });
      res.status(500).json(safeErrorResponse("Failed to render Word document", error));
    }
  });

  // ============================================
  // LLM-DRIVEN GENERATION (EXCEL)
  // ============================================

  router.post("/generate/excel", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const promptBody = parseValidated(PromptGenerationSchema, req.body, "/generate/excel");
      if (!promptBody) {
        return res.status(400).json({ error: "Invalid request body for /generate/excel" });
      }

      const { prompt, returnMetadata } = promptBody;
      const sanitizedPrompt = sanitizePlainText(prompt, { maxLen: MAX_PROMPT_LENGTH, collapseWs: true });
      if (!sanitizedPrompt.trim()) {
        return res.status(400).json({ error: "prompt cannot be empty" });
      }

      // Acquire concurrency slot
      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: "excel" });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_start",
        docType: "excel",
        details: { promptLength: sanitizedPrompt.length },
      });

      let result;
      try {
        result = await withRetryAndTimeout(() => generateExcelFromPrompt(sanitizedPrompt), { maxRetries: 1 }, MAX_GENERATION_TIMEOUT_MS);
      } finally {
        docConcurrencyLimiter.release();
      }

      const { buffer, spec, qualityReport, postRenderValidation, attemptsUsed } = result;

      // Validate buffer
      const bufferCheck = validateBufferSize(buffer, "excel");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "excel",
        durationMs: Date.now() - startTime,
        details: { attemptsUsed, bufferSize: buffer.length },
      });

      if (returnMetadata === true) {
        return res.json({
          success: true,
          filename: sanitizeFilename(spec.workbook_title || "generated", ".xlsx"),
          buffer: buffer.toString("base64"),
          qualityWarnings: qualityReport.warnings,
          postRenderWarnings: postRenderValidation.warnings,
          metadata: postRenderValidation.metadata,
          attemptsUsed,
        });
      }

      const filename = sanitizeFilename(spec.workbook_title || "generated", ".xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      logger.error("Excel generation error", {
        error: sanitizeErrorMessage(error),
      });
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "generate_failure",
          docType: "excel",
          durationMs: Date.now() - startTime,
          details: { error: sanitizeErrorMessage(error) },
        });
      res.status(500).json(safeErrorResponse("Failed to generate Excel document", error));
    }
  });

  // ============================================
  // LLM-DRIVEN GENERATION (WORD)
  // ============================================

  router.post("/generate/word", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const promptBody = parseValidated(PromptGenerationSchema, req.body, "/generate/word");
      if (!promptBody) {
        return res.status(400).json({ error: "Invalid request body for /generate/word" });
      }

      const { prompt, returnMetadata } = promptBody;
      const sanitizedPrompt = sanitizePlainText(prompt, { maxLen: MAX_PROMPT_LENGTH, collapseWs: true });
      if (!sanitizedPrompt.trim()) {
        return res.status(400).json({ error: "prompt cannot be empty" });
      }

      // Acquire concurrency slot
      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: "word" });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_start",
        docType: "word",
        details: { promptLength: sanitizedPrompt.length },
      });

      let result;
      try {
        result = await withRetryAndTimeout(() => generateWordFromPrompt(sanitizedPrompt), { maxRetries: 1 }, MAX_GENERATION_TIMEOUT_MS);
      } finally {
        docConcurrencyLimiter.release();
      }

      const { buffer, spec, qualityReport, postRenderValidation, attemptsUsed } = result;

      // Validate buffer
      const bufferCheck = validateBufferSize(buffer, "word");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "word",
        durationMs: Date.now() - startTime,
        details: { attemptsUsed, bufferSize: buffer.length },
      });

      if (returnMetadata === true) {
        return res.json({
          success: true,
          filename: sanitizeFilename(spec.title || "generated", ".docx"),
          buffer: buffer.toString("base64"),
          qualityWarnings: qualityReport.warnings,
          postRenderWarnings: postRenderValidation.warnings,
          metadata: postRenderValidation.metadata,
          attemptsUsed,
        });
      }

      const filename = sanitizeFilename(spec.title || "generated", ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      logger.error("Word generation error", {
        error: sanitizeErrorMessage(error),
      });
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "generate_failure",
          docType: "word",
          durationMs: Date.now() - startTime,
          details: { error: sanitizeErrorMessage(error) },
        });
      res.status(500).json(safeErrorResponse("Failed to generate Word document", error));
    }
  });

  // ============================================
  // LLM-DRIVEN GENERATION (CV)
  // ============================================

  router.post("/generate/cv", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const promptBody = parseValidated(PromptGenerationSchema, req.body, "/generate/cv");
      if (!promptBody) {
        return res.status(400).json({ error: "Invalid request body for /generate/cv" });
      }

      const sanitizedPrompt = sanitizePlainText(promptBody.prompt, { maxLen: MAX_PROMPT_LENGTH, collapseWs: true });
      if (!sanitizedPrompt.trim()) {
        return res.status(400).json({ error: "prompt cannot be empty" });
      }

      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: "cv" });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "generate_start", docType: "cv" });

      let result;
      try {
        result = await withRetryAndTimeout(() => generateCvFromPrompt(sanitizedPrompt), { maxRetries: 1 }, MAX_GENERATION_TIMEOUT_MS);
      } finally {
        docConcurrencyLimiter.release();
      }

      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;

      const bufferCheck = validateBufferSize(buffer, "cv");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "cv",
        durationMs: Date.now() - startTime,
        details: { attemptsUsed, bufferSize: buffer.length },
      });

      const timestamp = Date.now();
      const filename = sanitizeFilename(`cv_${timestamp}`, ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      logger.error("CV generation error", {
        error: sanitizeErrorMessage(error),
      });
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "generate_failure",
          docType: "cv",
          durationMs: Date.now() - startTime,
          details: { error: sanitizeErrorMessage(error) },
        });
      res.status(500).json(safeErrorResponse("Failed to generate CV document", error));
    }
  });

  // ============================================
  // LLM-DRIVEN GENERATION (REPORT)
  // ============================================

  router.post("/generate/report", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const promptBody = parseValidated(PromptGenerationSchema, req.body, "/generate/report");
      if (!promptBody) {
        return res.status(400).json({ error: "Invalid request body for /generate/report" });
      }

      const sanitizedPrompt = sanitizePlainText(promptBody.prompt, { maxLen: MAX_PROMPT_LENGTH, collapseWs: true });
      if (!sanitizedPrompt.trim()) {
        return res.status(400).json({ error: "prompt cannot be empty" });
      }

      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: "report" });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "generate_start", docType: "report" });

      let result;
      try {
        result = await withRetryAndTimeout(() => generateReportFromPrompt(sanitizedPrompt), { maxRetries: 1 }, MAX_GENERATION_TIMEOUT_MS);
      } finally {
        docConcurrencyLimiter.release();
      }

      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;

      const bufferCheck = validateBufferSize(buffer, "report");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "report",
        durationMs: Date.now() - startTime,
        details: { attemptsUsed, bufferSize: buffer.length },
      });

      const timestamp = Date.now();
      const filename = sanitizeFilename(`report_${timestamp}`, ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      logger.error("Report generation error", {
        error: sanitizeErrorMessage(error),
      });
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "generate_failure",
          docType: "report",
          durationMs: Date.now() - startTime,
          details: { error: sanitizeErrorMessage(error) },
        });
      res.status(500).json(safeErrorResponse("Failed to generate Report document", error));
    }
  });

  // ============================================
  // LLM-DRIVEN GENERATION (LETTER)
  // ============================================

  router.post("/generate/letter", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const promptBody = parseValidated(PromptGenerationSchema, req.body, "/generate/letter");
      if (!promptBody) {
        return res.status(400).json({ error: "Invalid request body for /generate/letter" });
      }

      const sanitizedPrompt = sanitizePlainText(promptBody.prompt, { maxLen: MAX_PROMPT_LENGTH, collapseWs: true });
      if (!sanitizedPrompt.trim()) {
        return res.status(400).json({ error: "prompt cannot be empty" });
      }

      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: "letter" });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "generate_start", docType: "letter" });

      let result;
      try {
        result = await withRetryAndTimeout(() => generateLetterFromPrompt(sanitizedPrompt), { maxRetries: 1 }, MAX_GENERATION_TIMEOUT_MS);
      } finally {
        docConcurrencyLimiter.release();
      }

      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;

      const bufferCheck = validateBufferSize(buffer, "letter");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "letter",
        durationMs: Date.now() - startTime,
        details: { attemptsUsed, bufferSize: buffer.length },
      });

      const timestamp = Date.now();
      const filename = sanitizeFilename(`letter_${timestamp}`, ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      logger.error("Letter generation error", {
        error: sanitizeErrorMessage(error),
      });
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "generate_failure",
          docType: "letter",
          durationMs: Date.now() - startTime,
          details: { error: sanitizeErrorMessage(error) },
        });
      res.status(500).json(safeErrorResponse("Failed to generate Letter document", error));
    }
  });

  // ============================================
  // RENDER CV FROM SPEC
  // ============================================

  router.post("/render/cv", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const parseResult = cvSpecSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid CV spec",
          details: parseResult.error.flatten().fieldErrors
        });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "render_start", docType: "cv" });

      const spec = parseResult.data;
      const templateConfig = selectCvTemplate(spec.template_style || "modern");
      const buffer = await renderCvFromSpec(spec, templateConfig);

      const bufferCheck = validateBufferSize(buffer, "cv");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "render_success",
        docType: "cv",
        durationMs: Date.now() - startTime,
        details: { bufferSize: buffer.length },
      });

      const timestamp = Date.now();
      const filename = sanitizeFilename(`cv_${timestamp}`, ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      logger.error("CV render error", {
        error: sanitizeErrorMessage(error),
      });
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "render_failure",
          docType: "cv",
          durationMs: Date.now() - startTime,
          details: { error: sanitizeErrorMessage(error) },
        });
      res.status(500).json(safeErrorResponse("Failed to render CV document", error));
    }
  });

  // ============================================
  // EXECUTE USER CODE (SANDBOXED)
  // ============================================

  router.post("/execute-code", requireNetworkAccessEnabled(), aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const rawIdempotencyKey = req.get("Idempotency-Key");
      const executeRequest = parseValidated(ExecuteCodeSchema, req.body, "/execute-code");
      if (!executeRequest) {
        return res.status(400).json({ error: "Invalid request body for /execute-code" });
      }
      const codeFingerprint = buildIdempotencyFingerprint({ code: sanitizePlainText(executeRequest.code, { maxLen: MAX_EXECUTE_CODE_LENGTH, collapseWs: false }) });
      const parsedIdempotencyKey = readIdempotencyKey(rawIdempotencyKey);

      if (rawIdempotencyKey !== undefined && parsedIdempotencyKey === null) {
        return res.status(400).json({ error: "Invalid Idempotency-Key header" });
      }
      const idempotencyKey = parsedIdempotencyKey || codeFingerprint;
      const sanitizedCode = sanitizePlainText(executeRequest.code, { maxLen: MAX_EXECUTE_CODE_LENGTH, collapseWs: false });
      const requestFingerprint = buildIdempotencyFingerprint({ code: sanitizedCode });

      if (idempotencyKey) {
        const replay = getIdempotencyReplay(
          getIdempotencyCacheKey("/execute-code", idempotencyKey),
          requestFingerprint
        );
        if (replay === "conflict") {
          return res.status(409).json({ error: "Idempotency key replay mismatch" });
        }
        if (replay) {
          return replayIdempotentResponse(res, replay);
        }
      }

      const code = sanitizedCode;

      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "execute_code_start",
        docType: "docx-code",
        details: { codeLength: code.length },
      });

      let buffer: Buffer;
      try {
        buffer = await withRetryAndTimeout(
          () => executeDocxCode(code),
          { maxRetries: 1 },
          MAX_GENERATION_TIMEOUT_MS
        );
      } finally {
        docConcurrencyLimiter.release();
      }

      const bufferCheck = validateBufferSize(buffer, "docx");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "execute_code_success",
        docType: "docx-code",
        durationMs: Date.now() - startTime,
        details: { bufferSize: buffer.length },
      });

      const filename = sanitizeFilename("document", ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      if (idempotencyKey) {
        storeIdempotentResponse(
          getIdempotencyCacheKey("/execute-code", idempotencyKey),
          requestFingerprint,
          {
            statusCode: 200,
            headers: extractReplayHeaders(res.getHeaders() as Record<string, unknown>),
            body: buffer,
          }
        );
      }
      res.send(buffer);
    } catch (error: any) {
      logger.error("Code execution error", {
        error: sanitizeErrorMessage(error),
      });
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "execute_code_failure",
          docType: "docx-code",
          durationMs: Date.now() - startTime,
          details: { error: sanitizeErrorMessage(error) },
        });
      const response = safeErrorResponse("Failed to execute document code", error);
      if (!IS_PRODUCTION) {
        (response as any).hint = "Check your code syntax and ensure createDocument() function is defined";
      }
      res.status(500).json(response);
    }
  });

  // ============================================
  // DOCUMENT PLAN (LLM-DRIVEN)
  // ============================================

  router.post("/plan", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const request = parseValidated(PlanRequestSchema, req.body, "/plan");
      if (!request) {
        return res.status(400).json({ error: "Invalid request body for /plan" });
      }

      const sanitizedPrompt = sanitizePlainText(request.prompt, { maxLen: MAX_PROMPT_LENGTH, collapseWs: true });
      const sanitizedSelectedText = request.selectedText
        ? sanitizePlainText(request.selectedText, { maxLen: 10_000, collapseWs: true })
        : "";
      const sanitizedDocumentContent = request.documentContent
        ? sanitizePlainText(request.documentContent, { maxLen: 50_000, collapseWs: true })
        : "";

      if (!sanitizedPrompt.trim()) {
        return res.status(400).json({ error: "prompt cannot be empty" });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "plan_start",
        details: {
          promptLength: sanitizedPrompt.length,
          hasSelectedText: sanitizedSelectedText.length > 0,
          hasDocumentContent: sanitizedDocumentContent.length > 0,
        },
      });

      const userMessage = `User instruction: ${sanitizedPrompt}
${sanitizedSelectedText ? `\nSelected text: "${sanitizedSelectedText.substring(0, 2000)}"` : ""}
${sanitizedDocumentContent ? `\nDocument context (first 500 chars): "${sanitizedDocumentContent.substring(0, 500)}"` : ""}

Generate the command plan:`;

      const result = await runLlmChat([
        {
          role: "system",
          content:
            "You are a document editing assistant. Given a user's instruction, generate a plan of document editing commands.\n\n" +
            "Available commands: bold, italic, underline, strikethrough, heading1, heading2, heading3, paragraph, bulletList, orderedList, " +
            "alignLeft, alignCenter, alignRight, alignJustify, insertLink, insertImage, insertTable, blockquote, codeBlock, insertHorizontalRule, " +
            "setTextColor, setHighlight, insertText, replaceSelection, clearFormatting.\n\n" +
            "Respond with strict JSON only: {\"intent\": \"...\", \"commands\": [{\"name\": \"commandName\", \"payload\": {...}, \"description\": \"...\"}]}.",
        },
        {
          role: "user",
          content: userMessage,
        },
      ], {
        temperature: 0.3,
        maxTokens: 1024,
      });

      let response: z.infer<typeof PlanResponseSchema>;
      try {
        const parsedPlan = parseLlmJson(result.content);
        const parsed = PlanResponseSchema.parse(parsedPlan);
        const filteredCommands = parsed.commands
          .filter((command) => PLAN_ALLOWED_COMMANDS.has(command.name))
          .slice(0, MAX_PLAN_COMMANDS);

        response = {
          ...parsed,
          intent: sanitizePlainText(parsed.intent, { maxLen: 1000, collapseWs: true }) || "document edit plan",
          commands: filteredCommands,
        };
      } catch (error) {
        response = {
          intent: sanitizedPrompt.slice(0, 140),
          commands: [],
          error: "Failed to parse AI response",
        };
      }
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "plan_success",
        details: {
          durationMs: Date.now() - startTime,
          commandCount: response.commands.length,
          parseError: Boolean(response.error),
        },
      });

      res.json(response);
    } catch (error: any) {
      logger.error("Document plan error", {
        error: sanitizeErrorMessage(error),
      });
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "plan_failure",
        durationMs: Date.now() - startTime,
        details: { error: sanitizeErrorMessage(error) },
      });
      res.status(500).json(safeErrorResponse("Failed to generate document plan", error));
    }
  });

  // ============================================
  // WORD EDITOR PRO ENDPOINTS
  // ============================================

  // Import DOCX and convert to code
  router.post("/import", async (req, res) => {
    try {
      const code = `async function createDocument() {
  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      children: [
        new Paragraph({
          children: [new TextRun({ text: "Contenido importado", bold: true })]
        }),
        new Paragraph({
          children: [new TextRun({ text: "Edita este documento según tus necesidades." })]
        })
      ]
    }]
  });
  return doc;
}`;
      res.json({ code });
    } catch (error: any) {
      res.status(500).json(safeErrorResponse("Import failed", error));
    }
  });

  // Grammar check using LLM
  router.post("/grammar-check", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const request = parseValidated(GrammarCheckSchema, req.body, "/grammar-check");
      if (!request) {
        return res.status(400).json({ error: "Invalid request body for /grammar-check" });
      }

      const code = sanitizePlainText(request.code, { maxLen: MAX_DOC_BODY_SIZE, collapseWs: false });
      const textMatches = code.match(/text:\s*["'`]([^"'`]+)["'`]/g) || [];
      const texts = textMatches
        .map((m: string) => sanitizePlainText(m.replace(/text:\s*["'`]|["'`]$/g, ""), { maxLen: 2000, collapseWs: true }))
        .filter((text): text is string => Boolean(text));

      if (texts.length === 0) {
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "grammar_check_success",
          details: { durationMs: Date.now() - startTime, matches: 0 },
        });
        return res.json({ errors: [] });
      }

      const result = await runLlmChat([
        {
          role: "system",
          content: "You are a grammar assistant. Return strict JSON only: {\"errors\": [{\"text\": \"...\", \"suggestion\": \"...\", \"type\": \"...\"}]}.",
        },
        {
          role: "user",
          content: `Review these texts for grammar and spelling issues:\n${texts.join("\n")}`,
        }
      ], { temperature: 0.1, maxTokens: 500 });

      let errors: string[] = [];
      try {
        const parsed = parseLlmJson(result.content);
        const parsedPayload = GrammarCheckResponseSchema.safeParse(parsed);
        const rawItems = parsedPayload.success
          ? parsedPayload.data.errors
          : Array.isArray(parsed)
            ? parsed
            : [];
        const validItems = rawItems
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
          .slice(0, 200);

        errors = validItems
          .map((entry) => {
            const text = sanitizePlainText(entry.text, { maxLen: 1000, collapseWs: true });
            const suggestion = sanitizePlainText(entry.suggestion, { maxLen: 1000, collapseWs: true });
            const type = entry.type ? sanitizePlainText(entry.type, { maxLen: 120, collapseWs: true }) : undefined;

            if (!text || !suggestion) {
              return null;
            }

            return `${text} → ${suggestion}${type ? ` (${type})` : ""}`;
          })
          .filter((item): item is string => Boolean(item));
      } catch {
        errors = [];
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "grammar_check_success",
        details: {
          durationMs: Date.now() - startTime,
          inputLength: code.length,
          errors: errors.length,
        },
      });
      res.json({ errors });
    } catch (error: any) {
      logger.error("Grammar check failed", {
        error: sanitizeErrorMessage(error),
      });
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "grammar_check_failure",
        details: { durationMs: Date.now() - startTime, error: sanitizeErrorMessage(error) },
      });
      res.status(500).json(safeErrorResponse("Grammar check failed", error));
    }
  });

  // Translate document code
  router.post("/translate", aiLimiter, async (req, res) => {
    const startTime = Date.now();

    try {
      const request = parseValidated(TranslateRequestSchema, req.body, "/translate");
      if (!request) {
        return res.status(400).json({ error: "Invalid request body for /translate" });
      }

      const code = sanitizePlainText(request.code, { maxLen: MAX_DOC_BODY_SIZE, collapseWs: false });
      const targetLang = request.targetLang;

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "translate_start",
        details: {
          inputLength: code.length,
          targetLang,
        },
      });

      const result = await runLlmChat([
        {
          role: "system",
          content:
            `You are a document translator. Translate all text content in the docx code to ${
              PLAN_LANG_NAMES[targetLang] || targetLang
            }. Keep the code structure identical, only translate text in code strings. Return only the translated code.`,
        },
        {
          role: "user",
          content: code,
        }
      ], { temperature: 0.2, maxTokens: 4000 });

      const translatedCode = String(result.content || "").replace(/\0/g, "");
      if (translatedCode.length > MAX_TRANSLATED_CODE_BYTES) {
        return res.status(413).json({ error: "Translated output exceeds size limits" });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "translate_success",
        details: {
          durationMs: Date.now() - startTime,
          outputLength: translatedCode.length,
        },
      });
      res.json({ translatedCode });
    } catch (error: any) {
      logger.error("Translate failed", {
        error: sanitizeErrorMessage(error),
      });
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "translate_failure",
        details: { durationMs: Date.now() - startTime, error: sanitizeErrorMessage(error) },
      });
      res.status(500).json(safeErrorResponse("Translation failed", error));
    }
  });

  // ============================================
  // DOCUMENT SHARING (WITH TTL)
  // ============================================

  router.post("/share", aiLimiter, shareUploadHandler, async (req, res) => {
    try {
      const shareMeta = safeShareRequestMeta(req);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "shared_start",
        docType: "share",
        details: {
          requestId: shareMeta.requestId,
        },
      });
      if (!shareMeta.contentType?.toLowerCase().startsWith("multipart/form-data")) {
        return res.status(415).json(safeErrorResponseWithRequest("Unsupported media type", new Error("Expected multipart/form-data"), req));
      }

      if (!shareMeta.multipartValid) {
        return res.status(400).json(safeErrorResponseWithRequest("Invalid multipart boundary", new Error("Validation failed"), req));
      }

      if (shareMeta.hasInvalidContentLength) {
        return res.status(400).json(safeErrorResponseWithRequest("Invalid Content-Length header", new Error("Validation failed"), req));
      }

      const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
      if (!uploadedFile) {
        return res.status(400).json(safeErrorResponseWithRequest("No file provided", new Error("Missing file"), req));
      }

      if (shareMeta.contentLengthProvided && shareMeta.contentLengthBytes !== uploadedFile.size) {
        return res.status(400).json(safeErrorResponseWithRequest("Content-Length mismatch", new Error("Validation failed"), req));
      }

      const resolvedType = resolveSharedDocumentType({
        mimeType: uploadedFile.mimetype,
        fileName: uploadedFile.originalname,
      });
      if (!resolvedType) {
        return res.status(415).json(safeErrorResponseWithRequest("Unsupported document type", new Error("Validation failed"), req));
      }

      if (!uploadedFile.buffer.length) {
        return res.status(400).json(safeErrorResponseWithRequest("Uploaded file is empty", new Error("Validation failed"), req));
      }

      if (uploadedFile.buffer.length > SHARE_MAX_DOCUMENT_SIZE) {
        return res.status(413).json(safeErrorResponseWithRequest("Uploaded document exceeds size limit", new Error("Validation failed"), req));
      }

      const bufferCheck = validateBufferSize(uploadedFile.buffer, resolvedType.docType);
      if (!bufferCheck.valid) {
        return res.status(422).json(safeErrorResponseWithRequest("Shared document failed validation", new Error(bufferCheck.error || "Validation failed"), req));
      }

      const normalizedContentType = canonicalizeSharedContentType(uploadedFile.mimetype);
      const normalizedFileName = normalizeUploadedFileName(uploadedFile.originalname || "shared_document");
      const fileNameWithoutExt = normalizedFileName.endsWith(resolvedType.extension)
        ? normalizedFileName.slice(0, -resolvedType.extension.length)
        : normalizedFileName;
      const filename = sanitizeFilename(fileNameWithoutExt || "shared_document", resolvedType.extension);

      if (!validateSharedDocumentSignature(uploadedFile.buffer, normalizedContentType, filename)) {
        return res.status(422).json(safeErrorResponseWithRequest("Shared document signature mismatch", new Error("Invalid file signature"), req));
      }

      const checksum = createHash("sha256").update(uploadedFile.buffer).digest("hex");
      const downloadToken = SHARE_REQUIRE_DOWNLOAD_TOKEN ? randomBytes(SHARE_DOWNLOAD_TOKEN_BYTES).toString("hex") : null;
      const downloadTokenHash = downloadToken ? hashSharedDownloadToken(downloadToken) : undefined;

      const safeHost = readSafeHost(req);
      if (!safeHost) {
        return res.status(400).json(safeErrorResponseWithRequest("Invalid host header", new Error("Validation failed"), req));
      }

      const acquired = await shareConcurrencyLimiter.acquire();
      if (!acquired) {
        return res.status(429).json(safeErrorResponseWithRequest("Too many concurrent share operations. Please try again.", new Error("Concurrency limit"), req));
      }

      try {
        const rawIdempotencyKey = req.get("Idempotency-Key");
        const idempotencyKey = readIdempotencyKey(rawIdempotencyKey);
        if (rawIdempotencyKey !== undefined && !idempotencyKey) {
          return res.status(400).json(safeErrorResponseWithRequest("Invalid Idempotency-Key header", new Error("Invalid idempotency key"), req));
        }

        const requestFingerprint = buildIdempotencyFingerprint({
          mimeType: normalizedContentType,
          fileName: filename,
          size: uploadedFile.size,
          checksum,
          multipartBoundary: shareMeta.multipartBoundary,
          downloadTokenRequired: SHARE_REQUIRE_DOWNLOAD_TOKEN,
        });

        if (idempotencyKey) {
          const cacheKey = getIdempotencyCacheKey("/share", idempotencyKey);
          const replay = getIdempotencyReplay(cacheKey, requestFingerprint);
          if (replay === "conflict") {
            return res.status(409).json(safeErrorResponseWithRequest("Idempotency replay mismatch", new Error("Idempotency conflict"), req));
          }
          if (replay) {
            return replayIdempotentResponse(res, replay);
          }
        }

        let shareId = "";
        const shareSeed = `${shareMeta.requestId}:${checksum}:${filename}:${shareMeta.multipartBoundary ?? "none"}`;
        for (let attempt = 0; attempt < SHARE_ID_MAX_ATTEMPTS; attempt += 1) {
          const candidate = generateShareId(shareSeed, attempt);
          if (!SHARE_ID_RE.test(candidate)) {
            continue;
          }
          const candidateStored = sharedDocumentStore.set(candidate, {
            blob: uploadedFile.buffer,
            filename,
            contentType: resolvedType.mimeType,
            downloadTokenHash,
            createdBy: shareMeta.requestId,
          }, SHARE_TTL_MS);
          if (candidateStored) {
            shareId = candidate;
            break;
          }
        }

        if (!shareId) {
          return res.status(503).json(safeErrorResponseWithRequest("Unable to generate unique share id", new Error("Capacity exceeded"), req));
        }

        const shareUrl = `${req.protocol}://${safeHost}/api/documents/shared/${shareId}${
          downloadToken ? `?${SHARE_DOWNLOAD_TOKEN_PARAM}=${encodeURIComponent(downloadToken)}` : ""
        }`;
        const responsePayload: {
          shareId: string;
          shareUrl: string;
          expiresIn: string;
          contentType: string;
          downloadToken?: string;
        } = {
          shareId,
          shareUrl,
          expiresIn: `${Math.max(1, Math.round(SHARE_TTL_MS / (60 * 60 * 1000)))} hours`,
          contentType: normalizedContentType,
        };

        if (downloadToken) {
          responsePayload.downloadToken = downloadToken;
        }
        const responseBody = Buffer.from(JSON.stringify(responsePayload));

        if (idempotencyKey) {
          storeIdempotentResponse(getIdempotencyCacheKey("/share", idempotencyKey), requestFingerprint, {
            statusCode: 201,
            headers: extractReplayHeaders({
              "Content-Type": "application/json; charset=utf-8",
              "Content-Length": String(responseBody.length),
              "Cache-Control": "private, no-store",
              "X-Request-Id": shareMeta.requestId,
            }),
            body: responseBody,
          });
        }

        logger.info("Document shared", {
          requestId: shareMeta.requestId,
          shareId,
          fileName: filename,
          size: uploadedFile.size,
        });

        const baseResponse = { ...responsePayload, requestId: shareMeta.requestId };
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "shared_success",
          docType: "share",
          details: {
            requestId: shareMeta.requestId,
            shareId,
            filename,
            size: uploadedFile.size,
            contentType: normalizedContentType,
          },
        });
        return res.status(201).json(baseResponse);
      } finally {
        shareConcurrencyLimiter.release();
      }
    } catch (error: any) {
      logger.error("Share failed", {
        requestId: getCorrelationId(req),
        error: sanitizeErrorMessage(error),
      });
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "shared_failure",
        docType: "share",
        details: {
          requestId: getCorrelationId(req),
          error: sanitizeErrorMessage(error),
        },
      });
      return res.status(500).json(safeErrorResponseWithRequest("Share failed", error, req));
    }
  });

  router.get("/shared/:id", async (req, res) => {
    try {
      const requestId = getCorrelationId(req);
      const clientIp = extractClientIp(req);
      const clientHash = hashAuditIdentifier(clientIp);
      const quota = consumeShareDownloadRate(clientIp);
      res.setHeader("X-Share-RateLimit-Limit", String(quota.limit));
      res.setHeader("X-Share-RateLimit-Remaining", String(quota.remaining));
      if (!quota.allowed) {
        res.setHeader("Retry-After", String(quota.retryAfterSeconds));
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "shared_failure",
          docType: "share",
          details: {
            requestId,
            clientHash,
            reason: "download_rate_limited",
            retryAfterSeconds: quota.retryAfterSeconds,
          },
        });
        return res.status(429).json(
          safeErrorResponseWithRequest("Too many download requests. Please retry later.", new Error("Rate limit exceeded"), req)
        );
      }
      const shareId = normalizeShareId(req.params.id);
      if (!shareId) {
        return res.status(400).json(safeErrorResponseWithRequest("Invalid share identifier", new Error("Invalid share id"), req));
      }
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "shared_start",
        docType: "share",
        details: {
          requestId,
          shareId,
          clientHash,
        },
      });

      if (!SHARE_ID_RE.test(shareId)) {
        return res.status(400).json(safeErrorResponseWithRequest("Invalid share identifier", new Error("Invalid share id"), req));
      }

      const doc = sharedDocumentStore.get(shareId);
      if (!doc) {
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "shared_failure",
          docType: "share",
          details: {
            requestId,
            shareId,
            clientHash,
            reason: "not_found_or_expired",
          },
        });
        return res.status(404).json(safeErrorResponseWithRequest("Document not found or expired", new Error("Not found"), req));
      }

      const shareToken = parseShareToken(
        req.query[SHARE_DOWNLOAD_TOKEN_PARAM] ?? req.query[SHARE_DOWNLOAD_TOKEN_SHORT_PARAM]
      );
      if (SHARE_REQUIRE_DOWNLOAD_TOKEN && !verifyShareDownloadToken(doc.downloadTokenHash, shareToken)) {
        const penalty = registerShareTokenFailure(shareId, clientIp);
        if (penalty.blocked) {
          res.setHeader("Retry-After", String(penalty.retryAfterSeconds));
          logDocumentEvent({
            timestamp: new Date().toISOString(),
            event: "shared_failure",
            docType: "share",
            details: {
              requestId,
              shareId,
              clientHash,
              reason: "download_token_locked",
              retryAfterSeconds: penalty.retryAfterSeconds,
            },
          });
          return res.status(429).json(
            safeErrorResponseWithRequest(
              "Download token temporarily locked due to repeated invalid attempts",
              new Error("Download token lock"),
              req
            )
          );
        }

        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "shared_failure",
          docType: "share",
          details: {
            requestId,
            shareId,
            clientHash,
            reason: shareToken ? "invalid_download_token" : "missing_download_token",
          },
        });
        return res.status(403).json(
          safeErrorResponseWithRequest("Download token validation failed", new Error("Invalid share token"), req)
        );
      }
      clearShareTokenFailureState(shareId, clientIp);

      if (!validateSharedDocumentSignature(doc.blob, doc.contentType, doc.filename)) {
        sharedDocumentStore.delete(shareId);
        return res.status(410).json(safeErrorResponseWithRequest("Shared document signature mismatch", new Error("Invalid document signature"), req));
      }

      const rangeHeader = req.get("range");
      if (rangeHeader) {
        return res.status(416).json(safeErrorResponseWithRequest("Range requests are not supported for shared documents", new Error("Range not supported"), req));
      }

      const ifNoneMatch = parseIfNoneMatch(req.get("if-none-match"));
      const ifNoneMatchAny = ifNoneMatch.includes("*");
      if (ifNoneMatchAny || ifNoneMatch.includes(doc.etag)) {
        res.setHeader("ETag", doc.etag);
        res.setHeader("Last-Modified", doc.createdAt.toUTCString());
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("Content-Type", canonicalizeSharedContentType(doc.contentType));
        return res.status(304).end();
      }

      const ifModifiedSince = parseIfModifiedSince(req.get("if-modified-since"));
      if (ifModifiedSince !== null && doc.createdAt.getTime() <= ifModifiedSince) {
        res.setHeader("ETag", doc.etag);
        res.setHeader("Last-Modified", doc.createdAt.toUTCString());
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("Content-Type", canonicalizeSharedContentType(doc.contentType));
        return res.status(304).end();
      }

      const consumedDoc = sharedDocumentStore.consume(shareId);
      if (!consumedDoc) {
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "shared_failure",
          docType: "share",
          details: {
            requestId,
            shareId,
            clientHash,
            reason: "download_limit_or_expired",
          },
        });
        return res.status(410).json(
          safeErrorResponseWithRequest("Document not found, expired, or download limit reached", new Error("Download unavailable"), req)
        );
      }

      const storedFileName = normalizeUploadedFileName(consumedDoc.filename || "shared_document");
      const storedExtension = getUploadedFileExtension(storedFileName);
      const filename = sanitizeFilename(
        storedFileName.slice(0, Math.max(0, storedFileName.length - storedExtension.length)),
        storedExtension || ".docx"
      );
      const remainingDownloads = Math.max(consumedDoc.maxAccesses - consumedDoc.accessCount, 0);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "shared_success",
        docType: "share",
        details: {
          requestId,
          shareId,
          clientHash,
          filename,
          bytes: consumedDoc.blob.length,
          remainingDownloads,
        },
      });
      res.setHeader("Content-Type", canonicalizeSharedContentType(consumedDoc.contentType));
      res.setHeader("Content-Length", String(consumedDoc.byteLength));
      res.setHeader("Last-Modified", consumedDoc.createdAt.toUTCString());
      res.setHeader("ETag", consumedDoc.etag);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Accept-Ranges", "none");
      res.setHeader("X-Share-Downloads-Remaining", String(remainingDownloads));
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("X-Request-Id", requestId);
      res.send(consumedDoc.blob);
    } catch (error: any) {
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "shared_failure",
        docType: "share",
        details: {
          requestId: getCorrelationId(req),
          error: sanitizeErrorMessage(error),
        },
      });
      res.status(500).json(safeErrorResponseWithRequest("Download failed", error, req));
    }
  });

 


  // Email endpoint (placeholder)
  router.post("/email", async (req, res) => {
    try {
      res.json({ success: true, message: "Email would be sent in production" });
    } catch (error: any) {
      res.status(500).json(safeErrorResponse("Email failed", error));
    }
  });

  // PDF conversion endpoint (placeholder)
  router.post("/convert-to-pdf", async (req, res) => {
    try {
      res.status(501).json({ error: "PDF conversion requires LibreOffice installation" });
    } catch (error: any) {
      res.status(500).json(safeErrorResponse("PDF conversion failed", error));
    }
  });

  return router;
}
