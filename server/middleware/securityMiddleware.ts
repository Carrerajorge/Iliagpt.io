/**
 * Security Middleware
 * Request validation, threat detection, and protection
 */

import { Request, Response, NextFunction } from "express";
import { securityMonitor } from "../services/securityMonitor";
import { sanitizeHtml } from "../validation/schemas";

/**
 * Extract client IP
 */
function getClientIP(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return (typeof forwarded === "string" ? forwarded : forwarded[0]).split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

/**
 * Input sanitization middleware
 */
export function sanitizeInput(req: Request, res: Response, next: NextFunction) {
  const sanitizeValue = (value: any): any => {
    if (typeof value === "string") {
      return sanitizeHtml(value);
    }
    if (Array.isArray(value)) {
      return value.map(sanitizeValue);
    }
    if (value && typeof value === "object") {
      const result: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = sanitizeValue(val);
      }
      return result;
    }
    return value;
  };

  if (req.body) {
    req.body = sanitizeValue(req.body);
  }
  if (req.query) {
    req.query = sanitizeValue(req.query) as any;
  }
  if (req.params) {
    req.params = sanitizeValue(req.params);
  }

  next();
}

/**
 * SQL Injection detection middleware
 */
export function detectSQLInjection(req: Request, res: Response, next: NextFunction) {
  const checkValue = (value: any, path: string): boolean => {
    if (typeof value === "string") {
      if (securityMonitor.detectSQLInjection(value)) {
        securityMonitor.logInputThreat(
          "sql_injection_attempt",
          value,
          req.path,
          (req as any).user?.id,
          getClientIP(req)
        );
        return true;
      }
    }
    if (Array.isArray(value)) {
      return value.some((v, i) => checkValue(v, `${path}[${i}]`));
    }
    if (value && typeof value === "object") {
      return Object.entries(value).some(([k, v]) => checkValue(v, `${path}.${k}`));
    }
    return false;
  };

  const hasThreat = 
    checkValue(req.body, "body") ||
    checkValue(req.query, "query") ||
    checkValue(req.params, "params");

  if (hasThreat) {
    return res.status(400).json({ 
      error: "Invalid input detected",
      code: "SECURITY_VIOLATION"
    });
  }

  next();
}

/**
 * XSS detection middleware
 */
export function detectXSS(req: Request, res: Response, next: NextFunction) {
  const checkValue = (value: any): boolean => {
    if (typeof value === "string") {
      if (securityMonitor.detectXSS(value)) {
        securityMonitor.logInputThreat(
          "xss_attempt",
          value,
          req.path,
          (req as any).user?.id,
          getClientIP(req)
        );
        return true;
      }
    }
    if (Array.isArray(value)) {
      return value.some(checkValue);
    }
    if (value && typeof value === "object") {
      return Object.values(value).some(checkValue);
    }
    return false;
  };

  const hasThreat = checkValue(req.body) || checkValue(req.query);

  if (hasThreat) {
    return res.status(400).json({ 
      error: "Invalid input detected",
      code: "SECURITY_VIOLATION"
    });
  }

  next();
}

/**
 * IP blocking middleware
 */
export function checkBlockedIP(req: Request, res: Response, next: NextFunction) {
  const ip = getClientIP(req);
  
  if (securityMonitor.shouldBlockIP(ip)) {
    return res.status(403).json({ 
      error: "Access denied",
      code: "IP_BLOCKED"
    });
  }

  next();
}

/**
 * Request logging middleware
 */
export function securityLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const ip = getClientIP(req);

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const userId = (req as any).user?.id;

    // Log suspicious responses
    if (res.statusCode === 401 || res.statusCode === 403) {
      securityMonitor.logEvent(
        "invalid_token",
        req.path,
        { method: req.method, statusCode: res.statusCode, duration },
        userId,
        ip,
        req.headers["user-agent"]
      );
    }
  });

  next();
}

/**
 * Session fingerprint validation
 */
export function validateSessionFingerprint(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  
  if (!session || !session.fingerprint) {
    return next();
  }

  const ip = getClientIP(req);
  const userAgent = req.headers["user-agent"] || "";
  
  // Create current fingerprint
  const crypto = require("crypto");
  const currentFingerprint = crypto
    .createHash("sha256")
    .update(`${userAgent}|${ip}`)
    .digest("hex")
    .slice(0, 16);

  if (session.fingerprint !== currentFingerprint) {
    // Potential session hijacking
    securityMonitor.logEvent(
      "session_hijack",
      req.path,
      { 
        expectedFingerprint: session.fingerprint,
        actualFingerprint: currentFingerprint
      },
      session.userId,
      ip,
      userAgent
    );

    // Invalidate session
    session.destroy?.();
    return res.status(401).json({ 
      error: "Session expired",
      code: "SESSION_INVALID"
    });
  }

  next();
}

/**
 * CORS security headers
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Strict Transport Security
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  
  // Content Security Policy
  res.setHeader("Content-Security-Policy", 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https: blob:; " +
    "connect-src 'self' https:; " +
    "frame-src 'self' blob:; " +
    "object-src 'self' blob:; " +
    "worker-src 'self' blob: https://cdnjs.cloudflare.com; " +
    "frame-ancestors 'self';"
  );
  
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  
  // Prevent MIME sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  
  // XSS Protection
  res.setHeader("X-XSS-Protection", "1; mode=block");
  
  // Referrer Policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  
  // Permissions Policy
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  next();
}

/**
 * Combined security middleware
 */
export function securityMiddleware() {
  return [
    securityHeaders,
    checkBlockedIP,
    sanitizeInput,
    detectSQLInjection,
    detectXSS,
    securityLogger
  ];
}
