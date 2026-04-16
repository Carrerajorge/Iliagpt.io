import type { Request, Response, NextFunction, Express } from "express";

/**
 * Setup all security middleware on the Express app.
 * Called from server/index.ts at startup.
 */
export function setupSecurity(app: Express): void {
  app.use(securityHeaders);
  app.use(sanitizeInput);
}

// --- 1. Security Headers ---
export const securityHeaders = (_req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ws: wss: https:; font-src 'self' data:; frame-ancestors 'self'",
  );
  next();
};

// --- 2. Request Size Limiter ---
export function requestSizeLimiter(limitBytes: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    if (contentLength > limitBytes) {
      return res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", maxBytes: limitBytes } });
    }
    next();
  };
}

// --- 3. Input Sanitizer ---
function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/<[^>]*>/g, "").trim();
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeValue(v);
    }
    return out;
  }
  return value;
}

export const sanitizeInput = (req: Request, _res: Response, next: NextFunction) => {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("application/json") && req.body) {
    req.body = sanitizeValue(req.body);
  }
  next();
};

// --- 4. Audit Logger ---
export interface AuditEvent {
  action: string;
  userId: string;
  targetId?: string;
  details?: unknown;
  ip?: string;
  timestamp: Date;
}

const RING_BUFFER_MAX = 5000;
const auditBuffer: AuditEvent[] = [];

export function logAuditEvent(event: AuditEvent): void {
  if (auditBuffer.length >= RING_BUFFER_MAX) {
    auditBuffer.shift();
  }
  auditBuffer.push(event);
}

export function getAuditLog(userId?: string, limit = 100): AuditEvent[] {
  let entries = userId ? auditBuffer.filter((e) => e.userId === userId) : [...auditBuffer];
  return entries.slice(-limit);
}
