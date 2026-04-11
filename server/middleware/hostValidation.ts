/**
 * Host Header Validation & DNS Rebinding Protection
 *
 * Prevents DNS rebinding attacks by validating the Host header against
 * an allowlist of known hostnames. Requests with unexpected Host headers
 * are rejected with 421 Misdirected Request.
 *
 * In development, localhost and 127.0.0.1 are always allowed.
 * In production, ALLOWED_HOSTS env var must be set.
 *
 * DNS rebinding attack:
 *  1. Attacker controls evil.com → resolves to attacker IP
 *  2. Browser caches DNS, opens page on evil.com
 *  3. Attacker changes DNS → evil.com now resolves to 127.0.0.1
 *  4. Browser JS makes requests to evil.com which now hit localhost
 *  5. Without Host validation, server accepts requests with Host: evil.com
 */

import { Request, Response, NextFunction } from "express";
import { createLogger } from "../lib/structuredLogger";

const logger = createLogger("host-validation");

// ── Configuration ──────────────────────────────────────────

const isProduction = process.env.NODE_ENV === "production";

// Build allowlist from environment
function buildAllowedHosts(): Set<string> {
  const hosts = new Set<string>();

  // Always allow health check probes (no Host header or internal)
  // Dev defaults
  if (!isProduction) {
    hosts.add("localhost");
    hosts.add("127.0.0.1");
    hosts.add("0.0.0.0");
    hosts.add("[::1]");
    // Common dev ports
    for (const port of ["5050", "5000", "5001", "3000", "8080"]) {
      hosts.add(`localhost:${port}`);
      hosts.add(`127.0.0.1:${port}`);
      hosts.add(`0.0.0.0:${port}`);
    }
  }

  // Parse ALLOWED_HOSTS env var (comma-separated)
  const envHosts = process.env.ALLOWED_HOSTS;
  if (envHosts) {
    for (const h of envHosts.split(",")) {
      const trimmed = h.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    }
  }

  // Parse canonical app URLs for the primary domain and local production-like hosts.
  for (const rawUrl of [process.env.APP_URL, process.env.BASE_URL, process.env.REPL_SLUG]) {
    if (!rawUrl) continue;
    try {
      const url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
      hosts.add(url.host.toLowerCase());
      hosts.add(url.hostname.toLowerCase());
    } catch {
      // Invalid URL, skip
    }
  }

  // Auto-include Replit deployment domains
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    for (const d of replitDomains.split(",")) {
      const trimmed = d.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    }
  }

  return hosts;
}

const allowedHosts = buildAllowedHosts();

// ── IP pattern detection ───────────────────────────────────

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
const IPV6_BRACKET_RE = /^\[[\da-fA-F:]+\](:\d+)?$/;

function isIPAddress(host: string): boolean {
  return IPV4_RE.test(host) || IPV6_BRACKET_RE.test(host);
}

function isPrivateIP(host: string): boolean {
  // Strip port
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");

  if (hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") return true;

  // 10.x.x.x
  if (hostname.startsWith("10.")) return true;
  // 172.16-31.x.x
  const m172 = hostname.match(/^172\.(\d+)\./);
  if (m172 && parseInt(m172[1]) >= 16 && parseInt(m172[1]) <= 31) return true;
  // 192.168.x.x
  if (hostname.startsWith("192.168.")) return true;
  // 169.254.x.x (link-local)
  if (hostname.startsWith("169.254.")) return true;

  return false;
}

// ── Middleware ──────────────────────────────────────────────

export interface HostValidationConfig {
  /** Additional hosts to allow beyond env-derived list. */
  extraHosts?: string[];
  /** Paths to skip validation (e.g. health probes from orchestrators). */
  exemptPaths?: string[];
  /** Allow all private IPs (for development clusters). Default: !isProduction. */
  allowPrivateIPs?: boolean;
}

export function hostValidation(config?: HostValidationConfig) {
  const extraHosts = new Set(
    (config?.extraHosts || []).map((h) => h.toLowerCase()),
  );
  const exemptPaths = config?.exemptPaths || [
    "/health",
    "/api/health",
    "/api/health/live",
    "/api/health/ready",
    "/metrics",
  ];
  const allowPrivateIPs = config?.allowPrivateIPs ?? !isProduction;

  // In non-production with no ALLOWED_HOSTS configured, skip validation entirely
  // to avoid breaking local development setups
  const hasExplicitConfig =
    (process.env.ALLOWED_HOSTS && process.env.ALLOWED_HOSTS.trim().length > 0) ||
    (process.env.APP_URL && process.env.APP_URL.trim().length > 0) ||
    (process.env.BASE_URL && process.env.BASE_URL.trim().length > 0);

  if (!isProduction && !hasExplicitConfig) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip exempt paths (health probes, metrics)
    if (exemptPaths.some((p) => req.path === p || req.path.startsWith(p + "/"))) {
      return next();
    }

    const host = req.headers.host;

    // Missing host header
    if (!host || typeof host !== "string") {
      logger.warn("Request missing Host header", {
        ip: req.ip,
        path: req.path,
      });
      res.status(421).json({
        error: "Misdirected Request",
        code: "MISSING_HOST",
      });
      return;
    }

    // Sanitize: reject CRLF injection attempts
    if (/[\r\n\0]/.test(host)) {
      logger.warn("Host header injection attempt", {
        ip: req.ip,
        path: req.path,
      });
      res.status(400).json({
        error: "Bad Request",
        code: "INVALID_HOST",
      });
      return;
    }

    const normalizedHost = host.toLowerCase().trim();

    // Check against allowlist
    if (allowedHosts.has(normalizedHost) || extraHosts.has(normalizedHost)) {
      return next();
    }

    // Check hostname without port
    const hostOnly = normalizedHost.replace(/:\d+$/, "");
    if (allowedHosts.has(hostOnly) || extraHosts.has(hostOnly)) {
      return next();
    }

    // Allow private IPs in dev
    if (allowPrivateIPs && isIPAddress(normalizedHost) && isPrivateIP(normalizedHost)) {
      return next();
    }

    // Reject: possible DNS rebinding
    logger.warn("DNS rebinding protection: rejected Host header", {
      host: normalizedHost,
      ip: req.ip,
      path: req.path,
      method: req.method,
    });

    res.status(421).json({
      error: "Misdirected Request",
      code: "HOST_NOT_ALLOWED",
    });
  };
}
