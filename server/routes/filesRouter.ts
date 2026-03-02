import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "../objectStorage";
import { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, FILE_UPLOAD_CONFIG, HTTP_HEADERS, LIMITS } from "../lib/constants";
import { fileProcessingQueue } from "../lib/fileProcessingQueue";
import { validateAttachmentSecurity } from "../lib/pareSecurityGuard";
import { processDocument } from "../services/documentProcessing";
import { chunkText, generateEmbeddingsBatch } from "../embeddingService";
import { sanitizeFilename } from "../services/fileValidation";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";

// SECURITY FIX #28: Path traversal prevention helper
function sanitizeFilePath(filePath: string): string | null {
  // Normalize path to resolve .. and .
  const normalized = path.normalize(filePath).replace(/\\/g, '/');

  // Block path traversal attempts
  if (normalized.includes('..') || normalized.startsWith('/') || normalized.includes('\0')) {
    console.warn(`[Security] Path traversal attempt blocked: ${filePath}`);
    return null;
  }

  return normalized;
}

// SECURITY FIX #29: Validate file names to prevent injection
function sanitizeFileName(fileName: string): string {
  // Remove path separators and null bytes
  let safe = fileName.replace(/[\/\\:\*\?"<>|\x00]/g, '_');
  // Limit length
  if (safe.length > 255) {
    const ext = path.extname(safe);
    safe = safe.substring(0, 255 - ext.length) + ext;
  }
  return safe;
}

interface MultipartUploadSession {
  uploadId: string;
  userId: string;
  conversationId?: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  totalChunks: number;
  storagePath: string;
  basePath: string;
  bucketName: string;
  uploadedParts: Map<number, string>;
  createdAt: Date;
}

interface FileRegistrationCacheEntry {
  createdAt: number;
  fingerprint: string;
  response: Record<string, unknown>;
  uploadId: string;
  conversationId?: string | null;
  userId: string;
}

interface MultipartCompletionCacheEntry {
  createdAt: number;
  status: "processing" | "done";
  response: { fileId: string; storagePath: string } | null;
  fingerprint: string;
}

interface UploadActorRateState {
  windowStart: number;
  count: number;
  blockedUntil: number;
}

interface LocalUploadIntent {
  actorId: string;
  storagePath: string;
  expiresAt: number;
}

// ============================================
// SECURITY: Multipart session limits & cleanup
// ============================================

/** Maximum concurrent multipart upload sessions */
const MAX_MULTIPART_SESSIONS = 100;
const MAX_MULTIPART_CHUNKS = Math.min(
  Number(process.env.MAX_MULTIPART_CHUNKS || "2048"),
  50000
);
const MAX_UPLOAD_RATE_PER_MINUTE = Number(process.env.MAX_UPLOAD_RATE_PER_MINUTE || 120);
const UPLOAD_RATE_WINDOW_MS = 60 * 1000;
const UPLOAD_RATE_BLOCK_MS = 30 * 1000;
const LOCAL_UPLOAD_INTENTS_TTL_MS = 10 * 60 * 1000;
const MAX_LOCAL_UPLOAD_INTENTS = Number(process.env.MAX_LOCAL_UPLOAD_INTENTS || 5000);
const MAX_LOCAL_UPLOAD_BYTES = Math.max(LIMITS.MAX_FILE_SIZE_BYTES, FILE_UPLOAD_CONFIG.CHUNK_SIZE_BYTES);

const UPLOAD_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_IDEMPOTENCY_ENTRIES = 2000;

const HEADER_UPLOAD_ID = "x-upload-id";
const HEADER_CONVERSATION_ID = "x-conversation-id";
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{5,126}$/;
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{3,255}$/;

/** Maximum session age before auto-cleanup (30 minutes) */
const SESSION_TTL_MS = 30 * 60 * 1000;

/** Cleanup interval (every 5 minutes) */
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const multipartSessions: Map<string, MultipartUploadSession> = new Map();
const fileRegistrationCache = new Map<string, FileRegistrationCacheEntry>();
const multipartCompletionCache = new Map<string, MultipartCompletionCacheEntry>();
const uploadActorRateState = new Map<string, UploadActorRateState>();
const localUploadIntents = new Map<string, LocalUploadIntent>();

const MAX_RATE_LIMIT_BOUNDARY = 10000;
const MIN_RATE_LIMIT_BOUNDARY = 20;

function resolveUploadRateLimit(rawLimit: unknown): number {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) return MAX_UPLOAD_RATE_PER_MINUTE;

  const rounded = Math.floor(parsed);
  if (rounded < MIN_RATE_LIMIT_BOUNDARY) return MIN_RATE_LIMIT_BOUNDARY;
  if (rounded > MAX_RATE_LIMIT_BOUNDARY) return MAX_RATE_LIMIT_BOUNDARY;
  return rounded;
}

function hashUploadActor(value: string): string {
  if (!value || value.length < 12) return "invalid";
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function getUploadActorId(req: Request): string {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith("ilgpt_")) {
      return `apiToken:${hashUploadActor(token)}`;
    }
    return `bearer:${hashUploadActor(token)}`;
  }

  const apiKey = (req as any).apiKey;
  if (apiKey && typeof apiKey === "object" && typeof apiKey.id === "string" && apiKey.id.length > 0) {
    return `apiKey:${apiKey.id}`;
  }

  return getOrCreateSecureUserId(req);
}

function cleanupUploadRateStates(now: number): void {
  for (const [actorId, state] of uploadActorRateState) {
    if (state.blockedUntil && state.blockedUntil < now) {
      state.blockedUntil = 0;
    }

    if (state.windowStart + UPLOAD_RATE_WINDOW_MS * 2 < now && state.count === 0) {
      uploadActorRateState.delete(actorId);
    }
  }
}

function consumeUploadQuota(req: Request, actorId: string): {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
} {
  const now = Date.now();
  const limit = resolveUploadRateLimit((req as any).apiKey?.rateLimit ?? MAX_UPLOAD_RATE_PER_MINUTE);
  const state = uploadActorRateState.get(actorId) || {
    windowStart: now,
    count: 0,
    blockedUntil: 0,
  };

  if (state.blockedUntil && state.blockedUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: state.blockedUntil - now,
      limit,
    };
  }

  if (state.windowStart + UPLOAD_RATE_WINDOW_MS <= now) {
    state.windowStart = now;
    state.count = 0;
    state.blockedUntil = 0;
  }

  state.count += 1;
  if (state.count > limit) {
    state.blockedUntil = now + UPLOAD_RATE_BLOCK_MS;
    uploadActorRateState.set(actorId, state);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: UPLOAD_RATE_BLOCK_MS,
      limit,
    };
  }

  uploadActorRateState.set(actorId, state);
  return {
    allowed: true,
    remaining: Math.max(limit - state.count, 0),
    retryAfterMs: 0,
    limit,
  };
}

function enforceUploadRateLimit(req: Request, res: Response): boolean {
  const actorId = getUploadActorId(req);
  const quota = consumeUploadQuota(req, actorId);
  if (quota.allowed) {
    res.setHeader("X-Upload-RateLimit-Limit", String(quota.limit));
    res.setHeader("X-Upload-RateLimit-Remaining", String(quota.remaining));
    return true;
  }

  const retryAfter = Math.max(1, Math.ceil(quota.retryAfterMs / 1000));
  res.setHeader("Retry-After", String(retryAfter));
  res.setHeader("X-Upload-RateLimit-Limit", String(quota.limit));
  res.setHeader("X-Upload-RateLimit-Remaining", "0");
  res.setHeader("X-Upload-RateLimit-Reset", String(Math.ceil(Date.now() / 1000) + retryAfter));
  res.status(429).json({
    error: "Upload rate limit exceeded",
    retryAfter,
  });
  return false;
}

function registerLocalUploadIntent(objectId: string, actorId: string, storagePath: string): void {
  localUploadIntents.set(objectId, {
    actorId,
    storagePath,
    expiresAt: Date.now() + LOCAL_UPLOAD_INTENTS_TTL_MS,
  });

  if (localUploadIntents.size <= MAX_LOCAL_UPLOAD_INTENTS) {
    return;
  }

  const now = Date.now();
  for (const [id, intent] of localUploadIntents) {
    if (intent.expiresAt <= now) {
      localUploadIntents.delete(id);
    }
    if (localUploadIntents.size <= MAX_LOCAL_UPLOAD_INTENTS) {
      break;
    }
  }

  if (localUploadIntents.size > MAX_LOCAL_UPLOAD_INTENTS) {
    const excess = localUploadIntents.size - MAX_LOCAL_UPLOAD_INTENTS;
    const keys = Array.from(localUploadIntents.keys()).slice(0, excess);
    keys.forEach((key) => localUploadIntents.delete(key));
  }
}

function consumeLocalUploadIntent(objectId: string, actorId: string): LocalUploadIntent | null {
  const intent = localUploadIntents.get(objectId);
  if (!intent || intent.expiresAt < Date.now() || intent.actorId !== actorId) {
    return null;
  }
  return intent;
}

function clearLocalUploadIntents(prefix: string): void {
  for (const key of localUploadIntents.keys()) {
    if (key.startsWith(prefix)) {
      localUploadIntents.delete(key);
    }
  }
}

function clearLocalUploadIntent(objectId: string): void {
  localUploadIntents.delete(objectId);
}

// Periodic cleanup of stale multipart sessions to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of multipartSessions) {
    if (now - session.createdAt.getTime() > SESSION_TTL_MS) {
      multipartSessions.delete(id);
      console.log(`[FilesRouter] Expired multipart session: ${id}`);
    }
  }
}, SESSION_CLEANUP_INTERVAL_MS).unref();

setInterval(() => {
  const now = Date.now();
  cleanupUploadRateStates(now);

  for (const [id, intent] of localUploadIntents) {
    if (intent.expiresAt < now) {
      localUploadIntents.delete(id);
    }
  }
}, SESSION_CLEANUP_INTERVAL_MS).unref();

function extractHeader(req: any, key: string): string | undefined {
  const value = req.headers?.[key] ?? req.headers?.[key.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value;
  return undefined;
}

function sanitizeUploadId(rawUploadId: string | undefined): string | null {
  if (!rawUploadId) return null;
  const trimmed = rawUploadId.trim();
  if (!UPLOAD_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function sanitizeConversationId(rawConversationId: string | undefined): string | null {
  if (!rawConversationId) return null;
  const trimmed = rawConversationId.trim();
  if (!CONVERSATION_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function getUploadId(req: Request, bodyUploadId?: unknown): string | null {
  const headerUploadId = sanitizeUploadId(extractHeader(req, HEADER_UPLOAD_ID));
  if (headerUploadId) return headerUploadId;
  if (typeof bodyUploadId === "string") return sanitizeUploadId(bodyUploadId);
  return null;
}

function getConversationId(req: Request, bodyConversationId?: unknown): string | null {
  const headerConversationId = sanitizeConversationId(extractHeader(req, HEADER_CONVERSATION_ID));
  if (headerConversationId) return headerConversationId;
  if (typeof bodyConversationId === "string") return sanitizeConversationId(bodyConversationId);
  return null;
}

export function validateHeaderBodyIdConsistency(
  req: Request,
  bodyUploadId?: unknown,
  bodyConversationId?: unknown
): { ok: true } | { ok: false; status: 400 | 409; error: string } {
  const rawHeaderUploadId = extractHeader(req, HEADER_UPLOAD_ID);
  const rawHeaderConversationId = extractHeader(req, HEADER_CONVERSATION_ID);
  const headerUploadId = sanitizeUploadId(rawHeaderUploadId);
  const headerConversationId = sanitizeConversationId(rawHeaderConversationId);
  const bodyUploadIdSanitized = typeof bodyUploadId === "string" ? sanitizeUploadId(bodyUploadId) : null;
  const bodyConversationIdSanitized = typeof bodyConversationId === "string" ? sanitizeConversationId(bodyConversationId) : null;

  if (typeof rawHeaderUploadId === "string" && rawHeaderUploadId.trim().length > 0 && !headerUploadId) {
    return { ok: false, status: 400, error: "Invalid uploadId format" };
  }
  if (typeof bodyUploadId === "string" && !bodyUploadIdSanitized) {
    return { ok: false, status: 400, error: "Invalid uploadId format" };
  }
  if (headerUploadId && bodyUploadIdSanitized && headerUploadId !== bodyUploadIdSanitized) {
    return { ok: false, status: 409, error: "Conflicting uploadId between header and body" };
  }

  if (typeof rawHeaderConversationId === "string" && rawHeaderConversationId.trim().length > 0 && !headerConversationId) {
    return { ok: false, status: 400, error: "Invalid conversationId format" };
  }
  if (typeof bodyConversationId === "string" && !bodyConversationIdSanitized) {
    return { ok: false, status: 400, error: "Invalid conversationId format" };
  }
  if (headerConversationId && bodyConversationIdSanitized && headerConversationId !== bodyConversationIdSanitized) {
    return { ok: false, status: 409, error: "Conflicting conversationId between header and body" };
  }

  return { ok: true };
}

function sanitizeStoragePath(rawStoragePath: string | undefined): string | null {
  if (!rawStoragePath || typeof rawStoragePath !== "string") return null;

  const trimmed = rawStoragePath.trim();
  if (trimmed.length > 2048) return null;
  if (!trimmed.startsWith("/objects/")) return null;
  if (trimmed.includes("\0") || trimmed.includes("%00")) return null;
  if (trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("//")) return null;

  const normalized = path.posix.normalize(trimmed);
  if (!normalized.startsWith("/objects/")) return null;
  if (normalized.includes("..")) return null;
  return normalized;
}

function buildRegistrationFingerprint(name: string, type: string, size: number, storagePath: string): string {
  return `${name}::${type}::${size}::${storagePath}`;
}

function buildRequestFingerprint(parts: unknown): string {
  try {
    return JSON.stringify(parts);
  } catch {
    return String(parts);
  }
}

function buildCompletionFingerprint(parts: { partNumber: number }[]): string {
  const normalized = parts.map((part) => part.partNumber).sort((a, b) => a - b);
  return normalized.join(",");
}

function buildUploadCacheKey(userId: string, uploadId: string, conversationId: string | null, prefix: string = ""): string {
  return `${prefix}${userId}|${conversationId || "__no_conversation__"}|${uploadId}`;
}

function canAccessFileForActor(fileUserId: string | null | undefined, actorId: string): boolean {
  if (!fileUserId) {
    return true;
  }
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  return fileUserId === actorId;
}

function removeUploadIdempotencyEntries(uploadId: string): void {
  for (const key of fileRegistrationCache.keys()) {
    if (key.endsWith(`|${uploadId}`)) {
      fileRegistrationCache.delete(key);
    }
  }
  for (const key of multipartCompletionCache.keys()) {
    if (key.endsWith(`|${uploadId}`)) {
      multipartCompletionCache.delete(key);
    }
  }
}

function cleanupIdempotencyCaches() {
  const now = Date.now();

  for (const [key, entry] of fileRegistrationCache) {
    if (now - entry.createdAt > UPLOAD_IDEMPOTENCY_TTL_MS) {
      fileRegistrationCache.delete(key);
    }
  }

  for (const [key, entry] of multipartCompletionCache) {
    if (now - entry.createdAt > UPLOAD_IDEMPOTENCY_TTL_MS) {
      multipartCompletionCache.delete(key);
    }
  }

  if (fileRegistrationCache.size > MAX_IDEMPOTENCY_ENTRIES) {
    const excess = fileRegistrationCache.size - MAX_IDEMPOTENCY_ENTRIES;
    const keys = Array.from(fileRegistrationCache.keys()).slice(0, excess);
    keys.forEach((key) => fileRegistrationCache.delete(key));
  }

  if (multipartCompletionCache.size > MAX_IDEMPOTENCY_ENTRIES) {
    const excess = multipartCompletionCache.size - MAX_IDEMPOTENCY_ENTRIES;
    const keys = Array.from(multipartCompletionCache.keys()).slice(0, excess);
    keys.forEach((key) => multipartCompletionCache.delete(key));
  }
}

setInterval(cleanupIdempotencyCaches, 10 * 60 * 1000).unref();

/** Security: validate objectId to prevent path traversal */
function isValidObjectId(objectId: string): boolean {
  if (!objectId || typeof objectId !== "string") return false;
  if (objectId.length > 512) return false;
  // Block path traversal sequences
  if (objectId.includes("..") || objectId.includes("//")) return false;
  if (objectId.includes("\0") || objectId.includes("%00")) return false;
  if (objectId.includes("%2e%2e") || objectId.includes("%2E%2E")) return false;
  // Block leading slashes to prevent absolute path references
  if (objectId.startsWith("/")) return false;
  // Only allow safe characters: alphanumeric, dash, underscore, dot, forward slash
  if (!/^[a-zA-Z0-9._\-\/]+$/.test(objectId)) return false;
  // Verify the normalized path doesn't escape the base directory
  const normalized = path.normalize(objectId);
  if (normalized.startsWith("..") || normalized.startsWith("/")) return false;
  return true;
}

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function isPrivateIpAddress(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  if (normalized.startsWith("::ffff:")) {
    const v4 = normalized.slice("::ffff:".length);
    return isPrivateIpAddress(v4);
  }

  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map(Number);
    if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return true;
    const [a, b, c] = parts;

    if (a === 0) return true; // "this host on this network"
    if (a === 10) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT

    // TEST-NET ranges and benchmarking ranges (avoid SSRF to non-routable)
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24

    if (a >= 224) return true; // multicast/reserved
    return false;
  }

  if (net.isIPv6(normalized)) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fe80:")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
    if (normalized.startsWith("2001:db8:")) return true; // documentation
    return false;
  }

  // Unknown format: be safe and block.
  return true;
}

async function assertSafeRemoteHttpUrl(rawUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsupported URL protocol");
  }

  // Strip credentials (userinfo) to avoid leaking secrets and weird auth flows.
  parsed.username = "";
  parsed.password = "";

  const hostname = (parsed.hostname || "").toLowerCase();
  if (!hostname) throw new Error("Invalid URL hostname");

  // Block obvious internal domains.
  const blocked = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
  ];
  if (blocked.includes(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Blocked internal hostname");
  }

  const ipType = net.isIP(hostname);
  if (ipType) {
    if (isPrivateIpAddress(hostname)) {
      throw new Error("Blocked private IP");
    }
    return parsed.href;
  }

  // DNS resolve and reject any private/reserved targets.
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs || addrs.length === 0) {
    throw new Error("Unable to resolve hostname");
  }
  if (addrs.some(a => isPrivateIpAddress(a.address))) {
    throw new Error("Blocked private IP (DNS)");
  }

  return parsed.href;
}

function stripContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const base = contentType.split(";")[0]?.trim().toLowerCase();
  return base || null;
}

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;

  // RFC 5987: filename*=UTF-8''...
  const filenameStarMatch = header.match(/filename\\*\\s*=\\s*([^']*)''([^;]+)/i);
  if (filenameStarMatch) {
    try {
      const encoded = filenameStarMatch[2].trim();
      return decodeURIComponent(encoded);
    } catch {
      // fall through to filename=
    }
  }

  const filenameMatch = header.match(/filename\\s*=\\s*\"?([^\";]+)\"?/i);
  if (filenameMatch) {
    return filenameMatch[1].trim();
  }
  return null;
}

function inferMimeTypeFromFileName(fileName: string): string | null {
  const ext = (path.extname(fileName || "").toLowerCase() || "").replace(".", "");
  if (!ext) return null;

  const map: Record<string, string> = {
    // documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    html: "text/html",
    htm: "text/html",
    json: "application/json",

    // images
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    webp: "image/webp",
    tif: "image/tiff",
    tiff: "image/tiff",
    svg: "image/svg+xml",
  };

  return map[ext] || null;
}

const UPLOAD_MIME_TYPE_ALIASES: Record<string, string> = {
  "application/x-pdf": "application/pdf",
  "application/acrobat": "application/pdf",
  "application/vnd.pdf": "application/pdf",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

const KNOWN_NONSTRICT_MIME_TYPES = new Set([
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
  "binary/octet-stream",
]);

function normalizeUploadIntentMimeType(rawMimeType: unknown, fileName: string = ""): string {
  if (typeof rawMimeType !== "string") return "";

  const base = stripContentType(rawMimeType) || rawMimeType.trim().toLowerCase();
  const normalized = base.trim().toLowerCase();
  if (!normalized) return "";

  if (UPLOAD_MIME_TYPE_ALIASES[normalized]) {
    return UPLOAD_MIME_TYPE_ALIASES[normalized];
  }
  if (KNOWN_NONSTRICT_MIME_TYPES.has(normalized)) {
    return inferMimeTypeFromFileName(fileName) || normalized;
  }
  return normalized;
}

type UploadIntentMetadataValidation =
  | {
    ok: true;
    hasMetadata: false;
    fileName: "";
    mimeType: "";
    fileSize: 0;
  }
  | {
    ok: true;
    hasMetadata: true;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }
  | {
    ok: false;
    status: 400 | 413 | 415;
    error: string;
  };

export function validateUploadIntentMetadata(input: {
  fileName?: unknown;
  mimeType?: unknown;
  fileSize?: unknown;
}): UploadIntentMetadataValidation {
  const hasMetadata =
    typeof input.fileName !== "undefined" ||
    typeof input.mimeType !== "undefined" ||
    typeof input.fileSize !== "undefined";

  if (!hasMetadata) {
    return {
      ok: true,
      hasMetadata: false,
      fileName: "",
      mimeType: "",
      fileSize: 0,
    };
  }

  const fileName = typeof input.fileName === "string"
    ? sanitizeFilename(input.fileName.trim().normalize("NFKC"))
    : "";
  const mimeType = normalizeUploadIntentMimeType(input.mimeType, fileName);
  const fileSize = Number(input.fileSize);

  if (!fileName || !mimeType || !Number.isFinite(fileSize) || fileSize <= 0) {
    return {
      ok: false,
      status: 400,
      error: "Missing or invalid file metadata: fileName, mimeType, fileSize",
    };
  }
  if (!ALLOWED_MIME_TYPES.includes(mimeType as any)) {
    return {
      ok: false,
      status: 415,
      error: "Unsupported file type",
    };
  }
  if (fileSize > LIMITS.MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `File too large. Maximum size is ${LIMITS.MAX_FILE_SIZE_MB}MB`,
    };
  }

  const inferredMimeType = inferMimeTypeFromFileName(fileName);
  if (inferredMimeType && inferredMimeType !== mimeType) {
    return {
      ok: false,
      status: 400,
      error: "File extension does not match mimeType",
    };
  }

  return {
    ok: true,
    hasMetadata: true,
    fileName,
    mimeType,
    fileSize,
  };
}

function ensureExtensionForMimeType(fileName: string, mimeType: string): string {
  if (!fileName) return fileName;
  if (path.extname(fileName)) return fileName;

  if (mimeType.startsWith("image/")) {
    const imageExtMap: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/bmp": ".bmp",
      "image/webp": ".webp",
      "image/tiff": ".tiff",
      "image/svg+xml": ".svg",
    };
    return fileName + (imageExtMap[mimeType] || "");
  }

  const ext = (ALLOWED_EXTENSIONS as Record<string, string>)[mimeType];
  if (ext) return fileName + ext;
  return fileName;
}

async function downloadUrlToBufferWithRedirects(
  rawUrl: string,
  {
    maxBytes,
    timeoutMs,
    maxRedirects,
  }: {
    maxBytes: number;
    timeoutMs: number;
    maxRedirects: number;
  }
): Promise<{
  finalUrl: string;
  contentType: string | null;
  contentDisposition: string | null;
  buffer: Buffer;
}> {
  let currentUrl = await assertSafeRemoteHttpUrl(rawUrl);

  for (let i = 0; i <= maxRedirects; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": HTTP_HEADERS.USER_AGENT,
          "Accept": "*/*",
          "Accept-Language": HTTP_HEADERS.ACCEPT_LANGUAGE,
        },
      });

      // Redirect handling
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect without location (status ${response.status})`);
        }
        const next = new URL(location, currentUrl).href;
        currentUrl = await assertSafeRemoteHttpUrl(next);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to download (status ${response.status})`);
      }

      const contentType = stripContentType(response.headers.get("content-type"));
      const contentDisposition = response.headers.get("content-disposition");
      const declaredLen = response.headers.get("content-length");
      const contentLength = declaredLen ? parseInt(declaredLen, 10) : NaN;
      if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
        throw new Error("File too large");
      }

      const chunks: Buffer[] = [];
      let received = 0;

      // Node/undici ReadableStream is async iterable.
      const body = response.body as any;
      if (!body) {
        throw new Error("Empty response body");
      }

      for await (const chunk of body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buf.length;
        if (received > maxBytes) {
          controller.abort();
          throw new Error("File too large");
        }
        chunks.push(buf);
      }

      return {
        finalUrl: currentUrl,
        contentType,
        contentDisposition,
        buffer: Buffer.concat(chunks),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Too many redirects");
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");
  return { bucketName, objectName };
}

async function signObjectURLForMultipart({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}`
    );
  }
  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

import { getUploadQueue } from "../services/uploadQueue";

async function processFileAsync(fileId: string, storagePath: string, mimeType: string, filename?: string) {
  try {
    console.log(`[processFileAsync] Enqueuing processing job for file ${fileId}, storagePath: ${storagePath}`);

    // Fast-path: mark as ready immediately so UI doesn't hang in polling
    await storage.updateFileStatus(fileId, "ready");

    // Queue the heavy OCR, chunking, and embedding generation to the background worker
    const queue = getUploadQueue();
    const result = await queue.add(
      "system", // userId (system handles analysis)
      "none", // chatId not strictly needed for the raw file parsing
      {
        id: fileId,
        name: filename || "upload",
        type: mimeType,
        size: -1,
        storagePath: storagePath
      },
      { priority: "high" }
    );

    if ('error' in result) {
      console.error(`[processFileAsync] Queue rejection for file ${fileId}: ${result.error}`);
      await storage.updateFileStatus(fileId, "error");
    } else {
      console.log(`[processFileAsync] Job ${result.jobId} enqueued for file ${fileId}`);
    }

  } catch (error: any) {
    console.error(`[processFileAsync] Error enqueuing file ${fileId}:`, error.message || error);
    try {
      await storage.updateFileStatus(fileId, "error");
    } catch (updateError) {
      console.error(`[processFileAsync] Failed to update file status to error:`, updateError);
    }
  }
}

import multer from "multer";
import fsSync from "node:fs";

const fastUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(process.cwd(), "uploads");
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const id = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  },
});
const fastUpload = multer({
  storage: fastUploadStorage,
  limits: { fileSize: LIMITS.MAX_FILE_SIZE_BYTES },
});

export function createFilesRouter() {
  const router = Router();
  const objectStorageService = new ObjectStorageService();
  const uploadsDir = path.resolve(process.cwd(), "uploads");

  router.post("/api/files/fast-upload", fastUpload.single("file"), async (req: Request, res: Response) => {
    try {
      const multerFile = req.file;
      if (!multerFile) {
        return res.status(400).json({ error: "No file provided" });
      }
      const actorId = getUploadActorId(req);
      const fileName = sanitizeFileName(multerFile.originalname || "upload");
      const mimeType = normalizeUploadIntentMimeType(multerFile.mimetype, fileName) || multerFile.mimetype;

      if (!ALLOWED_MIME_TYPES.includes(mimeType as any)) {
        try { fsSync.unlinkSync(multerFile.path); } catch {}
        return res.status(400).json({ error: `Unsupported file type: ${mimeType}` });
      }
      if (multerFile.size === 0) {
        try { fsSync.unlinkSync(multerFile.path); } catch {}
        return res.status(400).json({ error: "File is empty" });
      }

      const storagePath = `/objects/uploads/${path.basename(multerFile.filename)}`;
      const conversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId.trim() : null;

      const file = await storage.createFile({
        name: fileName,
        type: mimeType,
        size: multerFile.size,
        storagePath,
        status: "ready",
        userId: actorId,
      });

      try {
        await storage.createFileJob({ fileId: file.id, status: "pending" });
      } catch {}

      processFileAsync(file.id, storagePath, mimeType, fileName);

      return res.json({
        id: file.id,
        name: fileName,
        type: mimeType,
        size: multerFile.size,
        storagePath,
        status: "ready",
        conversationId,
      });
    } catch (error: any) {
      console.error("[FastUpload] Error:", error);
      return res.status(500).json({ error: "Upload failed" });
    }
  });

  router.use((req, res, next) => {
    const requestId = String((req as any).requestId || req.correlationId || res.locals?.traceId || "").trim();
    if (requestId) {
      res.setHeader("X-Request-Id", requestId);
    }
    next();
  });

  router.get("/api/files", async (req, res) => {
    try {
      const actorId = getUploadActorId(req);
      const files = await storage.getFiles();
      res.json(files.filter((file) => canAccessFileForActor(file.userId, actorId)));
    } catch (error: any) {
      console.error("Error getting files:", error);
      res.status(500).json({ error: "Failed to get files" });
    }
  });

  router.get("/api/objects/security-contract", (req, res) => {
    const authHeader = req.headers.authorization;
    const hasBearerAuth = typeof authHeader === "string" && /^Bearer\s+\S+$/i.test(authHeader.trim());
    const hasApiKeyAuth = Boolean((req as any).apiKey);
    const authMode = hasBearerAuth || hasApiKeyAuth ? "bearer-token" : "cookie-session";
    const requiresCsrf = authMode === "cookie-session";
    const requestId = String((req as any).requestId || req.correlationId || res.locals?.traceId || "").trim();

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.json({
      requestId: requestId || undefined,
      issuedAt: new Date().toISOString(),
      authMode,
      csrf: {
        required: requiresCsrf,
        tokenEndpoint: requiresCsrf ? "/api/csrf/token" : undefined,
        cookieName: requiresCsrf ? "XSRF-TOKEN" : undefined,
        headerNames: ["X-CSRF-Token", "X-CSRFToken"],
        credentials: requiresCsrf ? "include" : "omit",
        rotateOnDemand: requiresCsrf,
      },
      cors: {
        requiresCredentials: true,
        originValidation: "strict",
        refererValidation: "strict",
      },
      upload: {
        endpoint: "/api/objects/upload",
        directUploadContentTypePolicy: "do-not-set-manually-for-multipart-or-presigned-put",
        maxFileSizeBytes: LIMITS.MAX_FILE_SIZE_BYTES,
        allowedMimeTypes: [...ALLOWED_MIME_TYPES],
      },
      idempotency: {
        uploadIdHeader: "X-Upload-Id",
        conversationIdHeader: "X-Conversation-Id",
      },
    });
  });

  router.post("/api/objects/upload", async (req, res) => {
    let actorId = "";
    let uploadId: string | null = null;
    let conversationId: string | null = null;
    let hasFileMetadata = false;
    let fileName = "";
    let safeMimeType = "";
    let fileSize = 0;

    try {
      if (!enforceUploadRateLimit(req, res)) {
        return;
      }

      actorId = getUploadActorId(req);
      const rawUploadId = req.body?.uploadId;
      const rawConversationId = req.body?.conversationId;
      const idConsistency = validateHeaderBodyIdConsistency(req, rawUploadId, rawConversationId);
      if (!idConsistency.ok) {
        return res.status(idConsistency.status).json({ error: idConsistency.error });
      }
      uploadId = getUploadId(req, rawUploadId);
      conversationId = getConversationId(req, rawConversationId);
      const metadataValidation = validateUploadIntentMetadata({
        fileName: req.body?.fileName,
        mimeType: req.body?.mimeType,
        fileSize: req.body?.fileSize,
      });
      if (!metadataValidation.ok) {
        return res.status(metadataValidation.status).json({ error: metadataValidation.error });
      }
      hasFileMetadata = metadataValidation.hasMetadata;
      fileName = metadataValidation.fileName;
      safeMimeType = metadataValidation.mimeType;
      fileSize = metadataValidation.fileSize;

      if (typeof rawUploadId === "string" && !uploadId) {
        return res.status(400).json({ error: "Invalid uploadId format" });
      }
      if (typeof rawConversationId === "string" && !conversationId) {
        return res.status(400).json({ error: "Invalid conversationId format" });
      }
      if (uploadId) {
        res.setHeader("X-Upload-Id", uploadId);
      }
      if (conversationId) {
        res.setHeader("X-Conversation-Id", conversationId);
      }

      if (uploadId) {
        const idempotencyKey = buildUploadCacheKey(actorId, uploadId, conversationId, "url|");
        const fingerprint = buildRequestFingerprint({
          route: "/api/objects/upload",
          uploadId,
          conversationId,
          hasFileMetadata,
          ...(hasFileMetadata ? { fileName, mimeType: safeMimeType, fileSize } : {}),
        });
        const existingRegistration = fileRegistrationCache.get(idempotencyKey);
        if (existingRegistration) {
          if (existingRegistration.fingerprint !== fingerprint) {
            return res.status(409).json({ error: "Upload id reused with conflicting request" });
          }
          return res.json(existingRegistration.response);
        }

        try {
          const { uploadURL, storagePath } = await objectStorageService.getObjectEntityUploadURLWithPath(uploadId);
          const response = { uploadURL, storagePath, uploadId };
          fileRegistrationCache.set(idempotencyKey, {
            createdAt: Date.now(),
            fingerprint,
            response: {
              uploadURL,
              storagePath,
              uploadId,
            },
            uploadId,
            conversationId,
            userId: actorId,
          });
          return res.json(response);
        } catch (objectStorageError: unknown) {
          console.warn("[FilesRouter] Error generating upload URL for idempotent request; using local fallback", objectStorageError);
        }
      }

      const { uploadURL, storagePath } = await objectStorageService.getObjectEntityUploadURLWithPath(uploadId || undefined);
      res.json({ uploadURL, storagePath, ...(uploadId ? { uploadId } : {}) });
    } catch (error: any) {
      // Fallback to local storage for development
      console.log("[FilesRouter] Replit object storage unavailable, using local fallback");
      try {
        const fs = await import("fs");
        const path = await import("path");
        const crypto = await import("crypto");

        const UPLOADS_DIR = path.default.join(process.cwd(), "uploads");
        if (!fs.default.existsSync(UPLOADS_DIR)) {
          fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
        }

        const objectId = uploadId || crypto.randomUUID();
        const storagePath = `/objects/uploads/${objectId}`;
        registerLocalUploadIntent(objectId, actorId, storagePath);
        const fallbackResponse: { uploadURL: string; storagePath: string; uploadId?: string; localFallback: true } = {
          uploadURL: `/api/local-upload/${objectId}`,
          storagePath,
          localFallback: true,
        };
        if (uploadId) {
          const cacheKey = buildUploadCacheKey(actorId, uploadId, conversationId, "url|");
          const existingRegistration = fileRegistrationCache.get(cacheKey);
          const fingerprint = buildRequestFingerprint({
            route: "/api/objects/upload",
            localFallback: true,
            uploadId,
            conversationId,
            hasFileMetadata,
            ...(hasFileMetadata ? { fileName, mimeType: safeMimeType, fileSize } : {}),
          });
          if (existingRegistration) {
            if (existingRegistration.fingerprint !== fingerprint) {
              return res.status(409).json({ error: "Upload id reused with conflicting request" });
            }
            return res.json(existingRegistration.response);
          }

          fileRegistrationCache.set(cacheKey, {
            createdAt: Date.now(),
            fingerprint,
            response: { uploadURL: fallbackResponse.uploadURL, storagePath },
            uploadId,
            conversationId,
            userId: actorId,
          });
        }

        if (uploadId) {
          fallbackResponse.uploadId = uploadId;
        }
        return res.json(fallbackResponse);
      } catch (localError: any) {
        console.error("Error with local fallback:", localError);
        res.status(500).json({ error: "Failed to get upload URL" });
      }
    }
  });

  router.post("/api/objects/multipart/create", async (req, res) => {
    try {
      if (!enforceUploadRateLimit(req, res)) {
        return;
      }

      const { fileName: rawFileName, mimeType, fileSize: rawFileSize, totalChunks: rawTotalChunks } = req.body as {
        fileName?: unknown;
        mimeType?: unknown;
        fileSize?: unknown;
        totalChunks?: unknown;
      };

      const fileName = sanitizeFilename(typeof rawFileName === "string" ? rawFileName : "");
      const safeMimeType = normalizeUploadIntentMimeType(mimeType, fileName);
      const fileSize = Number(rawFileSize);
      const totalChunks = Number(rawTotalChunks);
      const actorId = getUploadActorId(req);
      const idConsistency = validateHeaderBodyIdConsistency(req, req.body?.uploadId, req.body?.conversationId);
      if (!idConsistency.ok) {
        return res.status(idConsistency.status).json({ error: idConsistency.error });
      }
      const conversationId = getConversationId(req, req.body?.conversationId);
      const requestedUploadId = getUploadId(req, req.body?.uploadId);
      if (typeof req.body?.uploadId === "string" && !requestedUploadId) {
        return res.status(400).json({ error: "Invalid uploadId format" });
      }
      if (typeof req.body?.conversationId === "string" && !conversationId) {
        return res.status(400).json({ error: "Invalid conversationId format" });
      }

      if (!fileName || !safeMimeType || !Number.isFinite(fileSize) || !Number.isInteger(fileSize) || !Number.isInteger(totalChunks)) {
        return res.status(400).json({ error: "Missing or invalid required fields: fileName, mimeType, fileSize, totalChunks" });
      }
      if (fileSize <= 0 || totalChunks <= 0 || totalChunks > MAX_MULTIPART_CHUNKS) {
        return res.status(400).json({ error: "Missing or invalid required fields: fileName, mimeType, fileSize, totalChunks" });
      }

      const inferredTypeFromName = inferMimeTypeFromFileName(fileName);
      if (inferredTypeFromName && inferredTypeFromName !== safeMimeType) {
        return res.status(400).json({ error: "File extension does not match mimeType" });
      }

      if (!ALLOWED_MIME_TYPES.includes(safeMimeType as any)) {
        return res.status(400).json({ error: `Unsupported file type: ${safeMimeType}` });
      }

      if (fileSize > LIMITS.MAX_FILE_SIZE_BYTES) {
        return res.status(400).json({ error: `File size exceeds maximum limit of ${LIMITS.MAX_FILE_SIZE_MB}MB` });
      }

      // Security: limit concurrent sessions to prevent memory exhaustion
      if (multipartSessions.size >= MAX_MULTIPART_SESSIONS) {
        return res.status(429).json({ error: "Too many concurrent upload sessions. Please try again later." });
      }

      const uploadId = requestedUploadId || `multipart_${crypto.randomUUID()}`;
      res.setHeader("X-Upload-Id", uploadId);
      if (conversationId) {
        res.setHeader("X-Conversation-Id", conversationId);
      }

      let privateObjectDir: string;
      let isLocalFallback = false;
      try {
        privateObjectDir = objectStorageService.getPrivateObjectDir();
      } catch {
        // Local fallback when object storage is unavailable
        isLocalFallback = true;
        privateObjectDir = "/local";
        console.log("[FilesRouter] Multipart: using local fallback for chunked upload");
      }

      const objectId = `uploads/${uploadId}`;
      const storagePath = `/objects/${objectId}`;
      const registrationKey = buildUploadCacheKey(actorId, uploadId, conversationId, "multipart_create|");
      const fingerprint = buildRegistrationFingerprint(fileName, safeMimeType, fileSize, storagePath);

      const existingRegistration = fileRegistrationCache.get(registrationKey);
      if (existingRegistration) {
        if (existingRegistration.fingerprint === fingerprint) {
          return res.json(existingRegistration.response);
        }
        return res.status(409).json({ error: "Duplicate upload-id with conflicting multipart metadata" });
      }

      const session: MultipartUploadSession = {
        uploadId,
        conversationId,
        fileName,
        mimeType: safeMimeType,
        fileSize,
        totalChunks,
        storagePath,
        basePath: isLocalFallback ? `local/${objectId}` : `${privateObjectDir}/${objectId}`,
        bucketName: isLocalFallback ? "__local__" : (privateObjectDir.split('/')[1] || ''),
        userId: actorId,
        uploadedParts: new Map(),
        createdAt: new Date(),
      };

      multipartSessions.set(uploadId, session);
      fileRegistrationCache.set(registrationKey, {
        createdAt: Date.now(),
        fingerprint,
        response: { uploadId, storagePath },
        uploadId,
        conversationId,
        userId: actorId,
      });

      res.json({ uploadId, storagePath });
    } catch (error: any) {
      console.error("Error creating multipart upload:", error);
      res.status(500).json({ error: "Failed to create multipart upload session" });
    }
  });

  router.post("/api/objects/multipart/sign-part", async (req, res) => {
    try {
      if (!enforceUploadRateLimit(req, res)) {
        return;
      }

      const { uploadId: rawUploadId, partNumber } = req.body;
      const idConsistency = validateHeaderBodyIdConsistency(req, rawUploadId, undefined);
      if (!idConsistency.ok) {
        return res.status(idConsistency.status).json({ error: idConsistency.error });
      }
      const uploadId = getUploadId(req, rawUploadId);
      const actorId = getUploadActorId(req);
      const partNumberValue = Number(partNumber);

      if (!uploadId || !Number.isInteger(partNumberValue)) {
        return res.status(400).json({ error: "Missing required fields: uploadId, partNumber" });
      }

      const session = multipartSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ error: "Upload session not found" });
      }
      res.setHeader("X-Upload-Id", uploadId);
      if (session.conversationId) {
        res.setHeader("X-Conversation-Id", session.conversationId);
      }
      if (session.userId !== actorId) {
        return res.status(403).json({ error: "Upload session does not belong to current actor" });
      }

      if (partNumberValue < 1 || partNumberValue > session.totalChunks) {
        return res.status(400).json({ error: `Invalid part number. Must be between 1 and ${session.totalChunks}` });
      }
      if (partNumberValue > MAX_MULTIPART_CHUNKS) {
        return res.status(400).json({ error: `Invalid part number. Must be between 1 and ${Math.min(session.totalChunks, MAX_MULTIPART_CHUNKS)}` });
      }

      // Local fallback: return a local upload URL for each part
      if (session.bucketName === "__local__") {
        const partObjectId = `${uploadId}_part_${partNumberValue}`;
        registerLocalUploadIntent(partObjectId, actorId, `${session.storagePath}_part_${partNumberValue}`);
        const signedUrl = `/api/local-upload/${partObjectId}`;
        return res.json({ signedUrl });
      }

      const partPath = `${session.basePath}_part_${partNumberValue}`;
      const { bucketName, objectName } = parseObjectPath(partPath);

      const signedUrl = await signObjectURLForMultipart({
        bucketName,
        objectName,
        method: "PUT",
        ttlSec: 900,
      });

      res.json({ signedUrl });
    } catch (error: any) {
      console.error("Error signing multipart part:", error);
      res.status(500).json({ error: "Failed to get signed URL for part" });
    }
  });

  router.post("/api/objects/multipart/complete", async (req, res) => {
    try {
      if (!enforceUploadRateLimit(req, res)) {
        return;
      }

      const { uploadId: rawUploadId, parts: rawParts, conversationId: rawConversationId } = req.body as {
        uploadId?: unknown;
        parts?: unknown;
        conversationId?: unknown;
      };
      const idConsistency = validateHeaderBodyIdConsistency(req, rawUploadId, rawConversationId);
      if (!idConsistency.ok) {
        return res.status(idConsistency.status).json({ error: idConsistency.error });
      }
      const uploadId = getUploadId(req, rawUploadId);

      if (!uploadId || !rawParts || !Array.isArray(rawParts)) {
        return res.status(400).json({ error: "Missing required fields: uploadId, parts" });
      }

      const normalizedParts = rawParts
        .map((part: { partNumber?: unknown }) => {
          const partNumber = Number(part?.partNumber);
          return Number.isFinite(partNumber) && Number.isInteger(partNumber) ? partNumber : NaN;
        })
        .filter((partNumber) => partNumber > 0 && partNumber <= MAX_MULTIPART_CHUNKS);

      if (normalizedParts.length === 0) {
        return res.status(400).json({ error: "Invalid or missing part list" });
      }

      const parts = normalizedParts
        .sort((a, b) => a - b)
        .filter((partNumber, index, arr) => index === 0 || partNumber !== arr[index - 1]);

      const actorId = getUploadActorId(req);
      const sessionConversationId = getConversationId(req, rawConversationId);

      const session = multipartSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ error: "Upload session not found" });
      }
      res.setHeader("X-Upload-Id", uploadId);
      if (sessionConversationId || session.conversationId) {
        res.setHeader("X-Conversation-Id", String(sessionConversationId || session.conversationId));
      }
      if (session.userId !== actorId) {
        return res.status(403).json({ error: "Upload session does not belong to current actor" });
      }

      if (parts.some((partNumber) => partNumber > session.totalChunks)) {
        return res.status(400).json({ error: "Invalid or missing part list" });
      }
      if (parts.length !== session.totalChunks) {
        return res.status(400).json({
          error: `Incomplete part list. Expected ${session.totalChunks} parts, received ${parts.length}`,
        });
      }
      const missingPart = Array.from({ length: session.totalChunks }, (_, index) => index + 1)
        .find((partNumber, index) => parts[index] !== partNumber);
      if (typeof missingPart === "number") {
        return res.status(400).json({ error: `Missing multipart chunk: ${missingPart}` });
      }

      const completionKey = buildUploadCacheKey(
        actorId,
        uploadId,
        sessionConversationId || session.conversationId || null,
        "multipart_complete|"
      );
      const completionFingerprint = buildCompletionFingerprint(parts.map((partNumber) => ({ partNumber })));
      const existingCompletion = multipartCompletionCache.get(completionKey);
      if (existingCompletion) {
        if (existingCompletion.fingerprint === completionFingerprint) {
          if (existingCompletion.status === "processing") {
            return res.status(409).json({ error: "Multipart completion already in progress" });
          }
          return res.json(existingCompletion.response);
        }
        return res.status(409).json({ error: "Duplicate completion request with different parts" });
      }

      multipartCompletionCache.set(completionKey, {
        createdAt: Date.now(),
        status: "processing",
        response: null,
        fingerprint: completionFingerprint,
      });

      const isLocalFallback = session.bucketName === "__local__";
      let completionResponse: { success: true; storagePath: string; fileId: string } | null = null;

      if (isLocalFallback) {
        for (const partNumber of parts) {
          const partObjectId = `${uploadId}_part_${partNumber}`;
          const partIntent = consumeLocalUploadIntent(partObjectId, actorId);
          if (!partIntent || partIntent.storagePath !== `${session.storagePath}_part_${partNumber}`) {
            multipartCompletionCache.delete(completionKey);
            return res.status(403).json({ error: `Unauthorized or stale multipart part: ${partNumber}` });
          }
        }

        // Local fallback: concatenate part files into a single file
        const fs = await import("fs");
        const pathMod = await import("path");
        const crypto = await import("crypto");

        const UPLOADS_DIR = pathMod.default.join(process.cwd(), "uploads");
        if (!fs.default.existsSync(UPLOADS_DIR)) {
          fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
        }

        const finalObjectId = crypto.randomUUID();
        const finalPath = pathMod.default.join(UPLOADS_DIR, finalObjectId);

        // Concatenate all part files into the final file
        const writeStream = fs.default.createWriteStream(finalPath);
        for (const partNumber of parts) {
          const partFileName = `${uploadId}_part_${partNumber}`;
          const partPath = pathMod.default.join(UPLOADS_DIR, partFileName);

          if (!fs.default.existsSync(partPath)) {
            writeStream.destroy();
            multipartCompletionCache.delete(completionKey);
            return res.status(500).json({ error: `Missing part file: ${partNumber}` });
          }

          const partContent = await fs.promises.readFile(partPath);
          writeStream.write(partContent);
        }

        await new Promise<void>((resolve, reject) => {
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
          writeStream.end();
        });

        // Clean up part files
        for (const partNumber of parts) {
          const partFileName = `${uploadId}_part_${partNumber}`;
          const partPath = pathMod.default.join(UPLOADS_DIR, partFileName);
          try {
            await fs.promises.unlink(partPath);
          } catch {
            // Ignore cleanup errors
          }
        }
        clearLocalUploadIntents(`${uploadId}_part_`);

        const storagePath = `/objects/uploads/${finalObjectId}`;

        multipartSessions.delete(uploadId);

        const file = await storage.createFile({
          name: session.fileName,
          type: session.mimeType,
          size: session.fileSize,
          storagePath,
          status: "processing",
          userId: actorId,
        });

        processFileAsync(file.id, storagePath, session.mimeType, session.fileName);

        completionResponse = { success: true, storagePath, fileId: file.id };
      }
      else {
        // Object storage path
        const { bucketName } = parseObjectPath(session.basePath);
        const bucket = objectStorageClient.bucket(bucketName);

        const partPaths = parts
          .map((partNumber) => {
            const partPath = `${session.basePath}_part_${partNumber}`;
            const { objectName } = parseObjectPath(partPath);
            return objectName;
          });

        const { objectName: finalObjectName } = parseObjectPath(session.basePath);
        const destinationFile = bucket.file(finalObjectName);

        try {
          await bucket.combine(
            partPaths.map(p => bucket.file(p)),
            destinationFile
          );

          await destinationFile.setMetadata({ contentType: session.mimeType });

          for (const objectPath of partPaths) {
            try {
              const fileRef = bucket.file(objectPath);
              await fileRef.delete();
            } catch (cleanupErr) {
              console.warn(JSON.stringify({
                event: "multipart_cleanup_failed",
                path: objectPath
              }));
            }
          }
        } catch (composeError: any) {
          console.error("Failed to compose parts:", composeError);
          multipartCompletionCache.delete(completionKey);
          return res.status(500).json({ error: "Failed to compose file parts" });
        }

        multipartSessions.delete(uploadId);

        const file = await storage.createFile({
          name: session.fileName,
          type: session.mimeType,
          size: session.fileSize,
          storagePath: session.storagePath,
          status: "processing",
          userId: actorId,
        });

        await storage.createFileJob({
          fileId: file.id,
          status: "pending",
        });

        fileProcessingQueue.enqueue({
          fileId: file.id,
          storagePath: session.storagePath,
          mimeType: session.mimeType,
          fileName: session.fileName,
        });

        completionResponse = { success: true, storagePath: session.storagePath, fileId: file.id };
      }

      if (!completionResponse) {
        multipartCompletionCache.delete(completionKey);
        return res.status(500).json({ error: "Multipart completion failed" });
      }

      clearLocalUploadIntents(`${uploadId}_part_`);
      multipartSessions.delete(uploadId);
      multipartCompletionCache.set(completionKey, {
        createdAt: Date.now(),
        status: "done",
        response: completionResponse,
        fingerprint: completionFingerprint,
      });

      return res.json(completionResponse);
    } catch (error: any) {
      console.error("Error completing multipart upload:", error);
      const rawUploadId = req.body?.uploadId;
      if (typeof rawUploadId === "string") {
        const normalizedUploadId = sanitizeUploadId(rawUploadId);
        if (normalizedUploadId) {
          const conversationId = getConversationId(req, req.body?.conversationId);
          const completionKey = buildUploadCacheKey(getUploadActorId(req), normalizedUploadId, conversationId, "multipart_complete|");
          multipartCompletionCache.delete(completionKey);
        }
      }
      res.status(500).json({ error: "Failed to complete multipart upload" });
    }
  });

  router.post("/api/objects/multipart/abort", async (req, res) => {
    try {
      if (!enforceUploadRateLimit(req, res)) {
        return;
      }

      const { uploadId: rawUploadId } = req.body;
      const idConsistency = validateHeaderBodyIdConsistency(req, rawUploadId, undefined);
      if (!idConsistency.ok) {
        return res.status(idConsistency.status).json({ error: idConsistency.error });
      }
      const uploadId = getUploadId(req, rawUploadId);
      const actorId = getUploadActorId(req);

      if (!rawUploadId || !uploadId) {
        return res.status(400).json({ error: "Missing required field: uploadId" });
      }
      res.setHeader("X-Upload-Id", uploadId);

      const session = multipartSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ error: "Upload session not found" });
      }
      if (session.userId !== actorId) {
        return res.status(403).json({ error: "Upload session does not belong to current actor" });
      }

      const isLocalFallback = session.bucketName === "__local__";

      if (isLocalFallback) {
        // Clean up local part files
        const fs = await import("fs");
        const pathMod = await import("path");
        const UPLOADS_DIR = pathMod.default.join(process.cwd(), "uploads");
        for (let i = 1; i <= session.totalChunks; i++) {
          const partPath = pathMod.default.join(UPLOADS_DIR, `${uploadId}_part_${i}`);
          try {
            if (fs.default.existsSync(partPath)) {
              await fs.promises.unlink(partPath);
            }
          } catch {
            // Ignore cleanup errors
          }
        }
        clearLocalUploadIntents(`${uploadId}_part_`);
      } else {
        const { bucketName } = parseObjectPath(session.basePath);
        const bucket = objectStorageClient.bucket(bucketName);

        for (let i = 1; i <= session.totalChunks; i++) {
          const chunkPath = session.basePath.concat("_part_", String(i));
          const { objectName } = parseObjectPath(chunkPath);
          try {
            const fileRef = bucket.file(objectName);
            await fileRef.delete();
          } catch (cleanupErr) {
          }
        }
      }

      removeUploadIdempotencyEntries(uploadId);
      multipartSessions.delete(uploadId);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error aborting multipart upload:", error);
      res.status(500).json({ error: "Failed to abort multipart upload" });
    }
  });

  router.get("/api/files/config", (req, res) => {
    res.json({
      allowedMimeTypes: [...ALLOWED_MIME_TYPES],
      allowedExtensions: ALLOWED_EXTENSIONS,
      maxFileSize: LIMITS.MAX_FILE_SIZE_BYTES,
      maxFileSizeMB: LIMITS.MAX_FILE_SIZE_MB,
      chunkSize: FILE_UPLOAD_CONFIG.CHUNK_SIZE_BYTES,
      chunkSizeMB: FILE_UPLOAD_CONFIG.CHUNK_SIZE_MB,
      maxParallelChunks: FILE_UPLOAD_CONFIG.MAX_PARALLEL_CHUNKS,
    });
  });

  router.post("/api/files/import-url", async (req, res) => {
    try {
      if (!enforceUploadRateLimit(req, res)) {
        return;
      }

      const actorId = getUploadActorId(req);
      const { url } = req.body as { url?: unknown };
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "Missing required field: url" });
      }

      const download = await downloadUrlToBufferWithRedirects(url, {
        maxBytes: LIMITS.MAX_FILE_SIZE_BYTES,
        timeoutMs: 15000,
        maxRedirects: 5,
      });

      const fromDisposition = parseFilenameFromContentDisposition(download.contentDisposition);
      const fromUrlPath = (() => {
        try {
          const u = new URL(download.finalUrl);
          const base = path.basename(u.pathname || "");
          return base ? decodeURIComponent(base) : null;
        } catch {
          return null;
        }
      })();

      let fileName = sanitizeFilename(fromDisposition || fromUrlPath || `imported-${Date.now()}`);

      // Determine MIME type: prefer header when usable; otherwise infer from filename.
      const headerType = download.contentType;
      let claimedMimeType = headerType && headerType !== "application/octet-stream" ? headerType : null;
      if (!claimedMimeType) {
        claimedMimeType = inferMimeTypeFromFileName(fileName);
      }
      if (!claimedMimeType) {
        claimedMimeType = "application/octet-stream";
      }

      // Security validation (magic bytes, dangerous formats, zip bomb/path traversal checks).
      const security = await validateAttachmentSecurity(
        {
          filename: fileName,
          buffer: download.buffer,
          providedMimeType: claimedMimeType,
        },
        {
          strictMode: true,
          allowMimeMismatch: true,
          maxFileSizeMB: LIMITS.MAX_FILE_SIZE_MB,
        }
      );

      if (!security.safe) {
        const topViolation =
          security.violations.find(v => v.severity === "critical") ||
          security.violations.find(v => v.severity === "high") ||
          security.violations[0];
        return res.status(400).json({ error: topViolation?.message || "Archivo rechazado por seguridad" });
      }

      const detectedMimeType = security.mimeDetection?.detectedMime || claimedMimeType;
      const mimeType =
        ALLOWED_MIME_TYPES.includes(detectedMimeType as any) ? detectedMimeType :
          ALLOWED_MIME_TYPES.includes(claimedMimeType as any) ? claimedMimeType :
            null;

      if (!mimeType) {
        return res.status(400).json({ error: `Unsupported file type: ${detectedMimeType}` });
      }

      const hasAttachmentDisposition = (download.contentDisposition || "").toLowerCase().includes("attachment");
      const hasHtmlExtension = /\.html?$/i.test(fileName);
      if (mimeType === "text/html" && !hasAttachmentDisposition && !hasHtmlExtension) {
        return res.status(400).json({ error: "El enlace no parece un archivo descargable (HTML)" });
      }

      fileName = ensureExtensionForMimeType(fileName, mimeType);
      const fileSize = download.buffer.length;

      if (fileSize === 0) {
        return res.status(400).json({ error: "Downloaded file is empty" });
      }

      if (fileSize > LIMITS.MAX_FILE_SIZE_BYTES) {
        return res.status(413).json({ error: "File too large" });
      }

      // Upload to object storage (or local fallback).
      let storagePath: string;
      try {
        const { uploadURL, storagePath: sp } = await objectStorageService.getObjectEntityUploadURLWithPath();
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": mimeType },
          body: download.buffer as any,
        });
        if (!putRes.ok) {
          throw new Error(`Upload failed with status ${putRes.status}`);
        }
        storagePath = sp;
      } catch (error: any) {
        // Local fallback
        const fs = await import("node:fs/promises");
        const crypto = await import("node:crypto");

        await fs.mkdir(uploadsDir, { recursive: true });
        const objectId = crypto.randomUUID();
        const localFilePath = path.join(uploadsDir, objectId);
        await fs.writeFile(localFilePath, download.buffer);
        storagePath = `/objects/uploads/${objectId}`;
      }

      const isImage = mimeType.startsWith("image/");
      if (isImage) {
        const file = await storage.createFile({
          name: fileName,
          type: mimeType,
          size: fileSize,
          storagePath,
          status: "ready",
          userId: actorId,
        });
        const shouldInlineDataUrl = fileSize <= 15 * 1024 * 1024;
        const dataUrl = shouldInlineDataUrl
          ? `data:${mimeType};base64,${download.buffer.toString("base64")}`
          : undefined;
        return res.json({ ...file, ...(dataUrl ? { dataUrl } : {}) });
      }

      const file = await storage.createFile({
        name: fileName,
        type: mimeType,
        size: fileSize,
        storagePath,
        status: "processing",
        userId: actorId,
      });

      // Process immediately (same behavior as /api/files).
      processFileAsync(file.id, storagePath, mimeType, fileName);

      return res.json(file);
    } catch (error: any) {
      console.error("Error importing file from URL:", error);
      const msg = String(error?.message || "Failed to import file");
      const lower = msg.toLowerCase();

      if (lower.includes("file too large") || lower.includes("too large")) {
        return res.status(413).json({ error: msg });
      }
      if (lower.includes("invalid url") || lower.includes("unsupported url protocol") || lower.includes("blocked") || lower.includes("resolve hostname") || lower.includes("redirect")) {
        return res.status(400).json({ error: msg });
      }
      if (lower.includes("unsupported file type")) {
        return res.status(400).json({ error: msg });
      }

      return res.status(500).json({ error: msg });
    }
  });

  router.post("/api/files/quick", async (req, res) => {
    try {
      if (!enforceUploadRateLimit(req, res)) {
        return;
      }

      const actorId = getUploadActorId(req);
      const rawUploadId = req.body?.uploadId;
      const rawConversationId = req.body?.conversationId;
      const idConsistency = validateHeaderBodyIdConsistency(req, rawUploadId, rawConversationId);
      if (!idConsistency.ok) {
        return res.status(idConsistency.status).json({ error: idConsistency.error });
      }
      const uploadId = getUploadId(req, rawUploadId);
      const conversationId = getConversationId(req, rawConversationId);

      if (typeof rawUploadId === "string" && !uploadId) {
        return res.status(400).json({ error: "Invalid uploadId format" });
      }
      if (typeof rawConversationId === "string" && !conversationId) {
        return res.status(400).json({ error: "Invalid conversationId format" });
      }
      if (uploadId) {
        res.setHeader("X-Upload-Id", uploadId);
      }
      if (conversationId) {
        res.setHeader("X-Conversation-Id", conversationId);
      }
      // Legacy endpoint (images only). Keep for backwards-compat, but validate strictly.
      const rawName = req.body?.name;
      const rawType = req.body?.type;
      const rawSize = req.body?.size;
      const rawStoragePath = req.body?.storagePath;

      if (typeof rawName !== "string" || rawName.trim().length === 0) {
        return res.status(400).json({ error: "Missing required field: name" });
      }
      if (typeof rawType !== "string" || rawType.trim().length === 0) {
        return res.status(400).json({ error: "Missing required field: type" });
      }
      if (rawSize === undefined || rawSize === null) {
        return res.status(400).json({ error: "Missing required field: size" });
      }
      if (typeof rawStoragePath !== "string" || rawStoragePath.trim().length === 0) {
        return res.status(400).json({ error: "Missing required field: storagePath" });
      }

      const name = sanitizeFilename(rawName.trim());
      const type = normalizeUploadIntentMimeType(rawType, name);
      const size = typeof rawSize === "number" ? rawSize : Number(rawSize);
      const storagePath = sanitizeStoragePath(rawStoragePath.trim());

      if (!name) return res.status(400).json({ error: "Invalid file name" });
      if (!type) return res.status(400).json({ error: "Invalid file type" });
      if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ error: "Invalid file size" });
      if (size > LIMITS.MAX_FILE_SIZE_BYTES) return res.status(413).json({ error: "File too large" });

      if (!storagePath) {
        return res.status(400).json({ error: "Invalid storagePath" });
      }

      const inferredTypeFromName = inferMimeTypeFromFileName(name);
      if (inferredTypeFromName && inferredTypeFromName !== type) {
        return res.status(400).json({ error: "File extension does not match mimeType" });
      }
      if (!ALLOWED_MIME_TYPES.includes(type as any)) {
        return res.status(400).json({ error: `Unsupported file type: ${type}` });
      }
      if (!type.startsWith("image/")) {
        return res.status(400).json({ error: "Quick upload only supports images" });
      }

      if (uploadId) {
        const idempotencyKey = buildUploadCacheKey(actorId, uploadId, conversationId, "file_quick|");
        const fingerprint = buildRequestFingerprint({
          route: "/api/files/quick",
          uploadId,
          conversationId,
          name,
          type,
          size,
          storagePath,
        });
        const existingRegistration = fileRegistrationCache.get(idempotencyKey);
        if (existingRegistration) {
          if (existingRegistration.fingerprint === fingerprint) {
            return res.json(existingRegistration.response);
          }
          return res.status(409).json({ error: "Duplicate upload-id with conflicting payload" });
        }
      }

      const file = await storage.createFile({
        name,
        type,
        size,
        storagePath,
        status: "ready",
        userId: actorId,
      });

      if (uploadId) {
        const idempotencyKey = buildUploadCacheKey(actorId, uploadId, conversationId, "file_quick|");
        const fingerprint = buildRequestFingerprint({
          route: "/api/files/quick",
          uploadId,
          conversationId,
          name,
          type,
          size,
          storagePath,
        });
        fileRegistrationCache.set(idempotencyKey, {
          createdAt: Date.now(),
          fingerprint,
          response: file,
          uploadId,
          conversationId,
          userId: actorId,
        });
      }

      res.json(file);
    } catch (error: any) {
      console.error("Error creating quick file:", error);
      res.status(500).json({ error: "Failed to create file" });
    }
  });

  router.post("/api/files", async (req, res) => {
    try {
      if (!enforceUploadRateLimit(req, res)) {
        return;
      }

      const actorId = getUploadActorId(req);
      const rawUploadId = req.body?.uploadId;
      const rawConversationId = req.body?.conversationId;
      const idConsistency = validateHeaderBodyIdConsistency(req, rawUploadId, rawConversationId);
      if (!idConsistency.ok) {
        return res.status(idConsistency.status).json({ error: idConsistency.error });
      }
      const uploadId = getUploadId(req, rawUploadId);
      const conversationId = getConversationId(req, rawConversationId);

      if (typeof rawUploadId === "string" && !uploadId) {
        return res.status(400).json({ error: "Invalid uploadId format" });
      }
      if (typeof rawConversationId === "string" && !conversationId) {
        return res.status(400).json({ error: "Invalid conversationId format" });
      }
      if (uploadId) {
        res.setHeader("X-Upload-Id", uploadId);
      }
      if (conversationId) {
        res.setHeader("X-Conversation-Id", conversationId);
      }
      const rawName = req.body?.name;
      const rawType = req.body?.type;
      const rawSize = req.body?.size;
      const rawStoragePath = req.body?.storagePath;

      if (typeof rawName !== "string" || rawName.trim().length === 0) {
        return res.status(400).json({ error: "Missing required field: name" });
      }
      if (typeof rawType !== "string" || rawType.trim().length === 0) {
        return res.status(400).json({ error: "Missing required field: type" });
      }
      if (rawSize === undefined || rawSize === null) {
        return res.status(400).json({ error: "Missing required field: size" });
      }
      if (typeof rawStoragePath !== "string" || rawStoragePath.trim().length === 0) {
        return res.status(400).json({ error: "Missing required field: storagePath" });
      }

      const name = sanitizeFilename(rawName.trim());
      const type = normalizeUploadIntentMimeType(rawType, name);
      const size = typeof rawSize === "number" ? rawSize : Number(rawSize);
      const storagePath = sanitizeStoragePath(rawStoragePath.trim()) || "";

      if (!name) return res.status(400).json({ error: "Invalid file name" });
      if (!type) return res.status(400).json({ error: "Invalid file type" });
      if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ error: "Invalid file size" });
      if (!storagePath) return res.status(400).json({ error: "Invalid storagePath" });
      if (size > LIMITS.MAX_FILE_SIZE_BYTES) return res.status(413).json({ error: "File too large" });

      const inferredTypeFromName = inferMimeTypeFromFileName(name);
      if (inferredTypeFromName && inferredTypeFromName !== type) {
        return res.status(400).json({ error: "File extension does not match mimeType" });
      }

      if (!ALLOWED_MIME_TYPES.includes(type as any)) {
        return res.status(400).json({ error: `Unsupported file type: ${type}` });
      }

      const isImage = typeof type === "string" && type.startsWith("image/");

      if (uploadId) {
        const idempotencyKey = buildUploadCacheKey(actorId, uploadId, conversationId, "file_register|");
        const fingerprint = buildRequestFingerprint({
          route: "/api/files",
          uploadId,
          conversationId,
          name,
          type,
          size,
          storagePath,
        });
        const existingRegistration = fileRegistrationCache.get(idempotencyKey);
        if (existingRegistration) {
          if (existingRegistration.fingerprint === fingerprint) {
            return res.json(existingRegistration.response);
          }
          return res.status(409).json({ error: "Duplicate upload-id with conflicting payload" });
        }
      }

      const file = await storage.createFile({
        name,
        type,
        size,
        storagePath,
        status: "processing", // Ensure images also go to processing queue for Vision OCR
        userId: actorId,
      });

      if (uploadId) {
        const idempotencyKey = buildUploadCacheKey(actorId, uploadId, conversationId, "file_register|");
        const fingerprint = buildRequestFingerprint({
          route: "/api/files",
          uploadId,
          conversationId,
          name,
          type,
          size,
          storagePath,
        });
        fileRegistrationCache.set(idempotencyKey, {
          createdAt: Date.now(),
          fingerprint,
          response: file,
          uploadId,
          conversationId,
          userId: actorId,
        });
      }

      // Create a tracking job record and process asynchronously for all file types including images
      try {
        await storage.createFileJob({
          fileId: file.id,
          status: "pending",
        });
      } catch (jobError) {
        // Non-critical: proceed even if job tracking fails
        console.warn(`[FilesRouter] Could not create file job for ${file.id}:`, jobError);
      }

      processFileAsync(file.id, storagePath, type, name);

      res.json(file);
    } catch (error: any) {
      console.error("Error creating file:", error);
      res.status(500).json({ error: "Failed to create file" });
    }
  });

  router.delete("/api/files/:id", async (req, res) => {
    try {
      const actorId = getUploadActorId(req);
      const file = await storage.getFile(req.params.id);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      if (!canAccessFileForActor(file.userId, actorId)) {
        return res.status(403).json({ error: "File does not belong to current actor" });
      }
      await storage.deleteFile(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting file:", error);
      res.status(500).json({ error: "Failed to delete file" });
    }
  });

  router.get("/api/files/:id/status", async (req, res) => {
    try {
      const actorId = getUploadActorId(req);
      const file = await storage.getFile(req.params.id);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      if (!canAccessFileForActor(file.userId, actorId)) {
        return res.status(403).json({ error: "File does not belong to current actor" });
      }
      return res.json({
        fileId: file.id,
        name: file.name,
        status: file.status,
        processingProgress: file.processingProgress ?? 0,
        processingError: file.processingError ?? null,
        completedAt: file.completedAt ? new Date(file.completedAt).toISOString() : null,
      });
    } catch (error: any) {
      console.error("Error getting file status:", error);
      return res.status(500).json({ error: "Failed to get file status" });
    }
  });

  router.get("/api/files/:id/content", async (req, res) => {
    try {
      const actorId = getUploadActorId(req);
      const file = await storage.getFile(req.params.id);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      if (!canAccessFileForActor(file.userId, actorId)) {
        return res.status(403).json({ error: "File does not belong to current actor" });
      }
      if (file.status !== "ready") {
        return res.status(202).json({ status: file.status, content: null });
      }
      const chunks = await storage.getFileChunks(req.params.id);
      const content = chunks
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map(c => c.content)
        .join("\n");
      res.json({ status: "ready", content, fileName: file.name });
    } catch (error: any) {
      console.error("Error getting file content:", error);
      res.status(500).json({ error: "Failed to get file content" });
    }
  });

  router.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      // LOCAL FALLBACK: In development, /api/objects/upload can return storage paths like
      // /objects/uploads/<uuid> when the Replit object storage sidecar is unavailable.
      // Serve those files directly from disk so the client can preview attachments.
      if (req.path.startsWith("/objects/uploads/")) {
        const fs = await import("fs");
        const pathMod = await import("path");
        const objectId = req.path.replace("/objects/uploads/", "");

        // Security: validate objectId to prevent path traversal
        if (!isValidObjectId(objectId)) {
          return res.sendStatus(404);
        }

        const localUploadsDir = pathMod.default.resolve(process.cwd(), "uploads");
        const localFilePath = pathMod.default.resolve(localUploadsDir, objectId);
        const safePrefix = localUploadsDir + pathMod.default.sep;

        // Prevent path traversal outside uploads/.
        if (!localFilePath.startsWith(safePrefix)) {
          return res.sendStatus(404);
        }

        if (!fs.default.existsSync(localFilePath)) {
          return res.sendStatus(404);
        }

        // Security: set nosniff to prevent MIME confusion attacks
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.sendFile(localFilePath);
      }

      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      console.error("Error serving object:", error);
      return res.sendStatus(500);
    }
  });

  // Local file upload handler (development fallback)
  router.put("/api/local-upload/:objectId", async (req, res) => {
    try {
      if (!enforceUploadRateLimit(req, res)) {
        return;
      }

      const actorId = getUploadActorId(req);
      const { objectId } = req.params;
      const contentLength = parseInt(req.headers["content-length"] || "0", 10);

      // Security: validate objectId to prevent path traversal
      if (!isValidObjectId(objectId)) {
        return res.status(400).json({ error: "Invalid object ID" });
      }

      const intent = consumeLocalUploadIntent(objectId, actorId);
      if (!intent) {
        return res.status(403).json({ error: "Upload intent missing or expired" });
      }

      if (Number.isFinite(contentLength) && contentLength > MAX_LOCAL_UPLOAD_BYTES) {
        return res.status(413).json({ error: "File too large" });
      }

      const fsSync = await import("fs");
      const pathMod = await import("path");

      const UPLOADS_DIR = pathMod.default.join(process.cwd(), "uploads");
      if (!fsSync.default.existsSync(UPLOADS_DIR)) {
        fsSync.default.mkdirSync(UPLOADS_DIR, { recursive: true });
      }

      const filePath = pathMod.default.resolve(UPLOADS_DIR, objectId);
      // Security: ensure resolved path stays within uploads directory
      const resolvedPath = pathMod.default.resolve(filePath);
      const uploadsDir = pathMod.default.resolve(UPLOADS_DIR);
      if (!resolvedPath.startsWith(uploadsDir + pathMod.default.sep) && resolvedPath !== uploadsDir) {
        console.warn(`[Security] Path traversal attempt: ${objectId}`);
        clearLocalUploadIntent(objectId);
        return res.status(400).json({ error: "Invalid path" });
      }

      const writeStream = fsSync.default.createWriteStream(filePath);
      let receivedBytes = 0;
      const cleanupLocalUpload = () => {
        clearLocalUploadIntent(objectId);
        try {
          fsSync.default.unlinkSync(filePath);
        } catch {
          // Best-effort cleanup.
        }
      };

      // Idle timeout to prevent hung uploads from dropping connections
      req.setTimeout(30000, () => {
        console.warn(`[LocalStorage] Upload timeout for ${objectId}`);
        writeStream.destroy();
        cleanupLocalUpload();
        req.destroy(new Error("Upload timeout"));
      });

      req.pipe(writeStream);
      req.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_LOCAL_UPLOAD_BYTES) {
          writeStream.destroy();
          cleanupLocalUpload();
          req.destroy(new Error("File limit exceeded"));
        }
      });

      writeStream.on("finish", async () => {
        // Prevent indefinite reuse of a single intent after the upload completes.
        clearLocalUploadIntent(objectId);
        console.log(`[LocalStorage] File uploaded: ${objectId} (${receivedBytes} bytes)`);
        // Security: don't leak filesystem paths in response
        res.status(200).json({ success: true, size: receivedBytes, storagePath: intent?.storagePath || "" });
      });

      req.on("aborted", () => {
        cleanupLocalUpload();
      });

      req.on("error", () => {
        cleanupLocalUpload();
      });

      writeStream.on("error", (error: Error) => {
        console.error("Upload stream error:", error);
        cleanupLocalUpload();
        if (!res.headersSent) res.status(500).json({ error: "Upload failed" });
      });
    } catch (error: any) {
      console.error("Error handling local upload:", error);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // Serve locally uploaded files with proper content type
  router.get("/api/local-files/:objectId", async (req, res) => {
    try {
      const { objectId } = req.params;

      // Security: validate objectId to prevent path traversal
      if (!isValidObjectId(objectId)) {
        return res.status(400).json({ error: "Invalid object ID" });
      }

      const fsSync = await import("fs");
      const pathMod = await import("path");

      const uploadsDir = pathMod.default.resolve(process.cwd(), "uploads");
      const filePath = pathMod.default.resolve(uploadsDir, objectId);
      const safePrefix = uploadsDir + pathMod.default.sep;

      // Security: ensure resolved path stays within uploads directory
      if (!filePath.startsWith(safePrefix)) {
        console.warn(`[Security] Path traversal attempt in local-files: ${objectId}`);
        return res.status(400).json({ error: "Invalid path" });
      }

      if (!fsSync.default.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }

      // Try to get the file record for content type
      const file = await storage.getFileByStoragePath(`/objects/uploads/${objectId}`);
      const contentType = file?.type || "application/octet-stream";

      res.setHeader("Content-Type", contentType);
      if (!contentType.startsWith("image/") && contentType !== "application/pdf") {
        res.setHeader("Content-Disposition", "attachment");
      }
      res.setHeader("X-Content-Type-Options", "nosniff");
      const content = await fsSync.promises.readFile(filePath);
      res.send(content);
    } catch (error: any) {
      console.error("Error serving file:", error);
      res.status(500).json({ error: "Failed to serve file" });
    }
  });

  router.get("/api/files/:id/raw", async (req, res) => {
    try {
      const file = await storage.getFile(req.params.id);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      if (process.env.NODE_ENV === "production") {
        const actorId = getUploadActorId(req);
        if (!canAccessFileForActor(file.userId, actorId)) {
          return res.status(403).json({ error: "File does not belong to current actor" });
        }
      }
      if (file.storagePath) {
        const fsSync = await import("fs");
        const pathMod = await import("path");
        let filePath: string | null = null;
        if (file.storagePath.startsWith("/objects/uploads/")) {
          const objectId = file.storagePath.replace("/objects/uploads/", "");
          const uploadsDir = pathMod.default.resolve(process.cwd(), "uploads");
          filePath = pathMod.default.resolve(uploadsDir, objectId);
          if (!filePath.startsWith(uploadsDir + pathMod.default.sep)) filePath = null;
        }
        if (filePath && fsSync.default.existsSync(filePath)) {
          const contentType = file.type || "application/octet-stream";
          res.setHeader("Content-Type", contentType);
          if (contentType === "application/pdf" || contentType.startsWith("image/")) {
            res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.name || "file")}"`);
          } else {
            res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name || "file")}"`);
          }
          res.setHeader("X-Content-Type-Options", "nosniff");
          const content = await fsSync.promises.readFile(filePath);
          return res.send(content);
        }
      }
      if (file.status !== "ready") {
        return res.status(202).json({ status: file.status });
      }
      const chunks = await storage.getFileChunks(req.params.id);
      const content = chunks
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map(c => c.content)
        .join("\n");
      const contentType = file.type || "text/plain";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name || "file")}"`);
      res.send(content);
    } catch (error: any) {
      console.error("Error serving raw file:", error);
      res.status(500).json({ error: "Failed to serve file" });
    }
  });

  router.get("/api/files/:id/preview-html", async (req, res) => {
    try {
      const file = await storage.getFile(req.params.id);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      if (process.env.NODE_ENV === "production") {
        const actorId = getUploadActorId(req);
        if (!canAccessFileForActor(file.userId, actorId)) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const fsSync = await import("fs");
      const pathMod = await import("path");
      let filePath: string | null = null;

      if (file.storagePath?.startsWith("/objects/uploads/")) {
        const objectId = file.storagePath.replace("/objects/uploads/", "");
        const uploadsDir = pathMod.default.resolve(process.cwd(), "uploads");
        filePath = pathMod.default.resolve(uploadsDir, objectId);
        if (!filePath.startsWith(uploadsDir + pathMod.default.sep)) filePath = null;
      }

      if (!filePath || !fsSync.default.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found on disk" });
      }

      const ext = (file.name || "").toLowerCase().split(".").pop();
      const buffer = await fsSync.promises.readFile(filePath);

      if (ext === "docx" || file.type?.includes("wordprocessingml")) {
        const mammoth = await import("mammoth");
        const result = await mammoth.default.convertToHtml({ buffer });
        return res.json({ html: result.value, type: "docx", messages: result.messages });
      }

      if (ext === "xlsx" || ext === "xls" || file.type?.includes("spreadsheetml")) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const sheets: Record<string, any[]> = {};
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          sheets[sheetName] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        }
        return res.json({ sheets, type: "xlsx", sheetNames: workbook.SheetNames });
      }

      if (ext === "pptx" || file.type?.includes("presentationml")) {
        return res.json({ type: "pptx", message: "PowerPoint preview not supported yet" });
      }

      if (ext === "csv" || ext === "tsv") {
        const text = buffer.toString("utf-8");
        return res.json({ type: "text", content: text });
      }

      const textExtensions = ["txt", "md", "json", "xml", "log", "js", "ts", "tsx", "jsx", "py", "html", "css", "yaml", "yml", "sh", "sql", "env"];
      if (textExtensions.includes(ext || "")) {
        const text = buffer.toString("utf-8");
        return res.json({ type: "text", content: text });
      }

      return res.json({ type: "unknown", message: "Preview not available" });
    } catch (error: any) {
      console.error("Error generating preview:", error);
      res.status(500).json({ error: "Failed to generate preview" });
    }
  });

  // Serve files from /objects/uploads/ path (local storage fallback)
  router.get("/objects/uploads/:objectId", async (req, res) => {
    try {
      const { objectId } = req.params;

      // Security: validate objectId to prevent path traversal
      if (!isValidObjectId(objectId)) {
        return res.status(400).json({ error: "Invalid object ID" });
      }

      const fsSync = await import("fs");
      const pathMod = await import("path");

      const UPLOADS_DIR = pathMod.default.resolve(process.cwd(), "uploads");
      const filePath = pathMod.default.resolve(UPLOADS_DIR, objectId);
      const safePrefix = UPLOADS_DIR + pathMod.default.sep;

      // Security: ensure resolved path stays within uploads directory
      if (!filePath.startsWith(safePrefix)) {
        return res.status(404).json({ error: "File not found" });
      }

      if (!fsSync.default.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }

      // Try to get the file record for content type
      const file = await storage.getFileByStoragePath(`/objects/uploads/${objectId}`);
      const contentType = file?.type || "application/octet-stream";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      if (!contentType.startsWith("image/") && contentType !== "application/pdf") {
        res.setHeader("Content-Disposition", "attachment");
      }
      res.setHeader("X-Content-Type-Options", "nosniff");

      const content = await fsSync.promises.readFile(filePath);
      res.send(content);
    } catch (error: any) {
      console.error("Error serving local object:", error);
      res.status(500).json({ error: "Failed to serve file" });
    }
  });

  return router;
}

export { ObjectStorageService, ObjectNotFoundError };
