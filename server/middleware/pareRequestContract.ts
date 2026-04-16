import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import {
  checkIdempotencyKey,
  computePayloadHash,
} from "../lib/idempotencyStore";
import { createLogger } from "../lib/structuredLogger";

export interface PareContext {
  requestId: string;
  idempotencyKey: string | null;
  payloadHash: string | null;
  isDataMode: boolean;
  attachmentsCount: number;
  startTime: number;
  clientIp: string;
  userId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      pareContext: PareContext;
    }
  }
}

const HEADER_REQUEST_ID = "x-request-id";
const HEADER_IDEMPOTENCY_KEY = "x-idempotency-key";
const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9._-]{6,140}$/;
const MAX_HEADER_VALUE_LENGTH = 256;
const MAX_PAYLOAD_HASH_BODY_BYTES = 128_000;
const logger = createLogger("pare-request-contract");

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "").trim().slice(0, MAX_HEADER_VALUE_LENGTH);
}

function obfuscateKey(key: string | null): string {
  if (!key || key.length <= 6) {
    return "[REDACTED]";
  }
  return `${key.slice(0, 3)}...${key.slice(-3)}`;
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const sanitized = Array.isArray(forwardedFor)
      ? sanitizeHeaderValue(forwardedFor[0] ?? "")
      : sanitizeHeaderValue(forwardedFor);
    const firstIp = sanitized.split(",")[0]?.trim();
    if (!firstIp || firstIp.length > 64) {
      return req.ip || req.socket.remoteAddress || "unknown";
    }
    return firstIp;
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function extractHeader(req: Request, headerName: string): string | null {
  const value = req.headers[headerName];
  if (!value) return null;
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) return null;
  return sanitizeHeaderValue(normalized);
}

function isValidUUIDv4(uuid: string): boolean {
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(uuid);
}

function countAttachments(req: Request): number {
  const { attachments } = req.body || {};
  if (!attachments || !Array.isArray(attachments)) {
    return 0;
  }
  return Math.min(attachments.length, 512);
}

function detectDataMode(attachmentsCount: number): boolean {
  return attachmentsCount > 0;
}

export function pareRequestContract(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();
  
  let requestId = extractHeader(req, HEADER_REQUEST_ID);
  if (!requestId || !isValidUUIDv4(requestId)) {
    requestId = randomUUID();
  }
  
  const idempotencyHeader = extractHeader(req, HEADER_IDEMPOTENCY_KEY);
  const idempotencyKey = idempotencyHeader && IDEMPOTENCY_KEY_REGEX.test(idempotencyHeader)
    ? idempotencyHeader
    : null;
  
  const clientIp = getClientIp(req);
  
  const user = (req as any).user;
  const userId = user?.claims?.sub || null;
  
  const attachmentsCount = countAttachments(req);
  
  const isDataMode = detectDataMode(attachmentsCount);
  
  let payloadHash: string | null = null;
  if (idempotencyKey && req.body) {
    try {
      const bodyByteLength = JSON.stringify(req.body).length;
      if (bodyByteLength <= MAX_PAYLOAD_HASH_BODY_BYTES) {
        payloadHash = computePayloadHash(req.body);
      } else {
  logger.warn("IDEMPOTENCY_PAYLOAD_TOO_LARGE", {
    requestId,
    event: "IDEMPOTENCY_PAYLOAD_TOO_LARGE",
    idempotencyKey: obfuscateKey(idempotencyKey),
    bodyByteLength,
  });
      }
    } catch (error: unknown) {
      logger.error("IDEMPOTENCY_PAYLOAD_SERIALIZE_ERROR", {
        requestId,
        event: "IDEMPOTENCY_PAYLOAD_SERIALIZE_ERROR",
        idempotencyKey: obfuscateKey(idempotencyKey),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  const pareContext: PareContext = {
    requestId,
    idempotencyKey,
    payloadHash,
    isDataMode,
    attachmentsCount,
    startTime,
    clientIp,
    userId,
  };
  
  req.pareContext = pareContext;
  
  res.setHeader("X-Request-Id", requestId);
  
  logger.info("PARE_REQUEST_RECEIVED", {
    requestId,
    event: "PARE_REQUEST_RECEIVED",
    idempotencyKey: obfuscateKey(idempotencyKey),
    isDataMode,
    attachmentsCount,
    clientIp,
    userId,
    method: req.method,
    path: req.path,
    timestamp: new Date(startTime).toISOString(),
  });
  
  next();
}

export function getPareContext(req: Request): PareContext | undefined {
  return req.pareContext;
}

export function requirePareContext(req: Request): PareContext {
  if (!req.pareContext) {
    throw new Error("PARE context not initialized - pareRequestContract middleware must be applied first");
  }
  return req.pareContext;
}

export async function pareIdempotencyGuard(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const pareContext = req.pareContext;
  
  if (!pareContext) {
    next();
    return;
  }
  
  const { idempotencyKey, payloadHash, requestId } = pareContext;
  
  if (!idempotencyKey || !payloadHash) {
    next();
    return;
  }
  
  try {
    const result = await checkIdempotencyKey(idempotencyKey, payloadHash);
    
    switch (result.status) {
      case 'new':
        next();
        return;
      
      case 'completed':
        logger.info("IDEMPOTENCY_REPLAY", {
          requestId,
          event: "IDEMPOTENCY_REPLAY",
          idempotencyKey: obfuscateKey(idempotencyKey),
          timestamp: new Date().toISOString()
        });
        res.status(200).json(result.cachedResponse);
        return;
      
      case 'processing':
        logger.warn("IDEMPOTENCY_IN_PROGRESS", {
          requestId,
          event: "IDEMPOTENCY_IN_PROGRESS",
          idempotencyKey: obfuscateKey(idempotencyKey),
          timestamp: new Date().toISOString()
        });
        res.status(409).json({
          error: "IDEMPOTENCY_IN_PROGRESS",
          message: "Request with this idempotency key is currently being processed. Please retry later.",
          requestId,
          idempotencyKey: obfuscateKey(idempotencyKey),
        });
        return;
      
      case 'conflict':
        console.log(JSON.stringify({
          level: "warn",
          event: "IDEMPOTENCY_CONFLICT",
          requestId,
          idempotencyKey: obfuscateKey(idempotencyKey),
          timestamp: new Date().toISOString()
        }));
        res.status(409).json({
          error: "IDEMPOTENCY_CONFLICT",
          message: "Request with this idempotency key exists with a different payload.",
          requestId,
          idempotencyKey: obfuscateKey(idempotencyKey),
        });
        return;
    }
  } catch (error: any) {
    logger.error("IDEMPOTENCY_GUARD_ERROR", {
      requestId,
      event: "IDEMPOTENCY_GUARD_ERROR",
      idempotencyKey: idempotencyKey ? obfuscateKey(idempotencyKey) : null,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
    next();
  }
}
