/**
 * Correlation ID Middleware
 *
 * Extracts or generates a correlation ID for every request.
 * Attaches it to the request object and response header for tracing.
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/**
 * Extract W3C Trace Context from the `traceparent` header.
 * Format: version-traceId-parentId-flags (e.g. "00-abc123...-def456...-01")
 */
function parseTraceParent(header: string | undefined): { traceId?: string; spanId?: string } {
  if (!header) return {};
  const parts = header.split("-");
  if (parts.length >= 3) {
    return { traceId: parts[1], spanId: parts[2] };
  }
  return {};
}

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function sanitizeCorrelationId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!CORRELATION_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  // Use existing correlation ID from upstream proxy/client, or generate a new one
  const correlationId =
    sanitizeCorrelationId(req.headers["x-correlation-id"]) ||
    sanitizeCorrelationId(req.headers["x-request-id"]) ||
    crypto.randomUUID();

  req.correlationId = correlationId;
  // Also stash requestId for compatibility with existing code that reads (req as any).requestId
  (req as any).requestId = (req as any).requestId || correlationId;

  // Parse W3C Trace Context if present
  const { traceId, spanId } = parseTraceParent(req.headers["traceparent"] as string);
  if (traceId) (req as any).traceId = traceId;
  if (spanId) (req as any).spanId = spanId;

  // Echo back in response for client-side correlation
  res.setHeader("x-correlation-id", correlationId);

  next();
}
