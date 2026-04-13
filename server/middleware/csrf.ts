import crypto from "crypto";
import { timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";
import { parse } from "cookie";
import { isAllowedOrigin } from "./cors";
import { getUserId } from "../types/express";
import { getSecureUserId } from "../lib/anonUserHelper";
import { createLogger } from "../lib/structuredLogger";

const CSRF_COOKIE_NAME = "XSRF-TOKEN";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const CSRF_HEADER_ALIASES = ["x-csrftoken", "x-csrf-token"];
const IGNORED_METHODS = ["GET", "HEAD", "OPTIONS"];
const CSRF_TOKEN_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
const CSRF_TOKEN_BYTES = 16;
const logger = createLogger("csrf");
const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/admin-login",
  "/api/auth/logout",
  "/api/auth/google",
  "/api/auth/google/callback",
  "/api/auth/microsoft",
  "/api/auth/microsoft/callback",
  "/api/auth/magic-link/send",
  "/api/auth/magic-link/verify",
  "/api/auth/phone/send-code",
  "/api/auth/phone/verify",
  "/api/auth/phone/resend",
  "/api/callback",
  "/api/login",
  "/api/webhooks",
  "/api/stripe/webhook",
  "/webhook",
]);

/**
 * Helper to ensure req.cookies exists
 */
const ensureCookies = (req: Request) => {
    if (!req.cookies && req.headers.cookie) {
        req.cookies = parse(req.headers.cookie);
    }
    return req.cookies || {};
};

function isCrossSiteRequest(req: Request): boolean {
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  if (!origin && !referer) {
    return false;
  }

  if (origin && !isAllowedOrigin(String(origin))) {
    return true;
  }

  if (referer) {
    try {
      const refererOrigin = new URL(String(referer)).origin;
      if (!isAllowedOrigin(refererOrigin)) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

export function issueCsrfCookie(
  req: Request,
  res: Response,
  isReplitDeployment: boolean,
  isProduction: boolean
) {
  const token = crypto.randomBytes(CSRF_TOKEN_BYTES).toString("base64url");

  const crossSite = isCrossSiteRequest(req);
  const isSecure = isProduction || crossSite;
  const sameSite = crossSite || isReplitDeployment ? "none" : "lax";

  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Must be readable by client JS to header-ize it
    secure: isSecure,
    sameSite,
    maxAge: CSRF_TOKEN_MAX_AGE_MS,
    path: "/",
  });

  return token;
}

export function isCsrfToken(value: unknown): value is string {
  return typeof value === "string" && CSRF_TOKEN_PATTERN.test(value);
}

export { CSRF_COOKIE_NAME, CSRF_TOKEN_PATTERN };

/**
 * Generates a CSRF token and sets it as a cookie readable by the client.
 * This implements the "Double Submit Cookie" pattern.
 * The client reads this cookie and sends it back in the X-CSRF-Token header.
 */
export const csrfTokenMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const cookies = ensureCookies(req);
    const isReplitDeployment = !!process.env.REPL_SLUG;
    const isProduction = process.env.NODE_ENV === "production" || isReplitDeployment;

    // Only set the token if it doesn't exist or we want to rotate it
    if (!res.headersSent && (!cookies[CSRF_COOKIE_NAME] || !CSRF_TOKEN_PATTERN.test(cookies[CSRF_COOKIE_NAME]))) {
        issueCsrfCookie(req, res, isReplitDeployment, isProduction);
    }
    next();
};

function extractCsrfHeader(req: Request): string | undefined {
    const value = req.headers[CSRF_HEADER_NAME.toLowerCase()] || req.headers[CSRF_HEADER_NAME];
    if (typeof value === "string") {
        return value;
    }

    for (const headerName of CSRF_HEADER_ALIASES) {
      const aliasValue = req.headers[headerName];
      if (typeof aliasValue === "string") {
        return aliasValue;
      }
    }

    return undefined;
}

function isStatelessAuthRequest(req: Request): boolean {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ilgpt_")) {
        return true;
    }

    return !!(req as any).apiKey;
}

function isAllowedCsrfPrincipal(req: Request): boolean {
    return typeof (req as any).apiKey !== "undefined" || getSecureUserId(req) !== null;
}

/**
 * Validates the CSRF token on state-changing requests.
 */
export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
    // Skip CSRF for local development or when explicitly requested
    if (process.env.NODE_ENV === "development" || process.env.BYPASS_CSRF === "true") {
        return next();
    }

    if (IGNORED_METHODS.includes(req.method)) {
        return next();
    }

    // Exempt pre-auth and webhook endpoints from CSRF.
    // Webhooks are validated with provider signatures; auth endpoints are not session-authenticated yet.
    if (CSRF_EXEMPT_PATHS.has(req.path) || CSRF_EXEMPT_PATHS.has(req.originalUrl || "")) {
        return next();
    }

    if (req.path.startsWith("/api/webhooks") || req.originalUrl.startsWith("/api/webhooks")) {
        return next();
    }

    if (req.headers.origin || req.headers.referer) {
      const origin = req.headers.origin ? String(req.headers.origin) : undefined;
      const referer = req.headers.referer ? String(req.headers.referer) : undefined;

      if (origin && !isAllowedOrigin(origin)) {
        logger.withRequest(res.locals.requestId, getUserId(req)).warn("CSRF origin validation blocked", {
          method: req.method,
          ip: req.ip,
          origin,
        });
        return res.status(403).json({
          error: "CSRF token validation failed",
          code: "CSRF_INVALID"
        });
      }

      if (referer) {
        try {
          if (!isAllowedOrigin(new URL(referer).origin)) {
            logger.withRequest(res.locals.requestId, getUserId(req)).warn("CSRF referer validation blocked", {
              method: req.method,
              ip: req.ip,
              referer,
            });
            return res.status(403).json({
              error: "CSRF token validation failed",
              code: "CSRF_INVALID"
            });
          }
        } catch {
          logger.withRequest(res.locals.requestId, getUserId(req)).warn("CSRF referer parse failure", {
            method: req.method,
            ip: req.ip,
          });
          return res.status(403).json({
            error: "CSRF token validation failed",
            code: "CSRF_INVALID"
          });
        }
      }
    }

    if (isStatelessAuthRequest(req)) {
        return next();
    }

    if (!isAllowedCsrfPrincipal(req)) {
        logger.withRequest(res.locals.requestId, getSecureUserId(req)).warn("CSRF denied: no authenticated principal", {
          method: req.method,
          ip: req.ip,
        });
        return res.status(403).json({
          error: "CSRF token validation failed",
          code: "CSRF_INVALID"
        });
    }

    const cookies = ensureCookies(req);

    // Frontend sends token in header
    const headerToken = extractCsrfHeader(req);
    // Valid token comes from the cookie (which user agent sends automatically)
    const cookieToken = cookies[CSRF_COOKIE_NAME];
    const isReplitDeployment = !!process.env.REPL_SLUG;
    const isProduction = process.env.NODE_ENV === "production" || isReplitDeployment;

    if (typeof headerToken !== "string" || typeof cookieToken !== "string") {
        if (typeof headerToken === "string" && CSRF_TOKEN_PATTERN.test(headerToken) && typeof cookieToken !== "string") {
            if (!res.headersSent) {
                issueCsrfCookie(req, res, isReplitDeployment, isProduction);
            }
            return next();
        }
        if (!res.headersSent) {
            issueCsrfCookie(req, res, isReplitDeployment, isProduction);
        }
        logger.withRequest(res.locals.requestId, getUserId(req)).warn("CSRF missing token", {
          method: req.method,
          ip: req.ip,
        });
        return res.status(403).json({
            error: "CSRF token validation failed",
            code: "CSRF_INVALID"
        });
    }

    if (!CSRF_TOKEN_PATTERN.test(cookieToken) || !CSRF_TOKEN_PATTERN.test(headerToken)) {
        if (!res.headersSent) {
            issueCsrfCookie(req, res, isReplitDeployment, isProduction);
        }
        logger.withRequest(res.locals.requestId, getSecureUserId(req)).warn("CSRF invalid token format", {
          method: req.method,
          ip: req.ip,
        });
        return res.status(403).json({
            error: "CSRF token validation failed",
            code: "CSRF_INVALID"
        });
    }

    if (cookieToken.length !== headerToken.length) {
        if (!res.headersSent) {
            issueCsrfCookie(req, res, isReplitDeployment, isProduction);
        }
        logger.withRequest(res.locals.requestId, getSecureUserId(req)).warn("CSRF token length mismatch", {
          method: req.method,
          ip: req.ip,
        });
        return res.status(403).json({
            error: "CSRF token validation failed",
            code: "CSRF_INVALID"
        });
    }

    const cookieBuf = Buffer.from(cookieToken);
    const headerBuf = Buffer.from(headerToken);

    if (!timingSafeEqual(cookieBuf, headerBuf)) {
        if (!res.headersSent) {
            issueCsrfCookie(req, res, isReplitDeployment, isProduction);
        }
        logger.withRequest(res.locals.requestId, getSecureUserId(req)).warn("CSRF token mismatch", {
          method: req.method,
          ip: req.ip,
        });
        return res.status(403).json({
            error: "CSRF token validation failed",
            code: "CSRF_INVALID"
        });
    }

    next();
};
