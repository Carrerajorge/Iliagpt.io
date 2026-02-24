import { NextFunction, Request, Response } from "express";

import { Logger } from "../lib/logger";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 200;
const DEFAULT_MAX_SCORE = 15;
const WINDOW_MS = clampWindow(Number(process.env.ABUSE_DETECTION_WINDOW_MS || DEFAULT_WINDOW_MS));
const MAX_REQUESTS_PER_WINDOW = clampThreshold(
  Number(process.env.ABUSE_DETECTION_MAX_REQUESTS || DEFAULT_MAX_REQUESTS_PER_WINDOW),
);
const MAX_ABUSE_SCORE = clampThreshold(Number(process.env.ABUSE_DETECTION_MAX_SCORE || DEFAULT_MAX_SCORE), 1, 1000);

const EXEMPT_PATH_PREFIX = new Set([
  "/api/health", "/health", "/ready", "/metrics",
  // SPA page-load endpoints (GET-only status/list calls)
  "/api/chats",
  "/api/models",
  "/api/settings",
  "/api/user/usage",
  "/api/memory",
  "/api/integrations",
  "/api/oauth",
  "/api/figma/status",
  "/api/agent/runs",
]);

interface AbuseRecord {
  count: number;
  score: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
}

interface WindowedStore {
  [identity: string]: AbuseRecord;
}

const abuseStore: WindowedStore = Object.create(null);
const CLEANUP_INTERVAL_MS = 30_000;
let cleanupInterval: ReturnType<typeof setInterval> | undefined;

function clampWindow(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_WINDOW_MS;
  }
  return Math.max(1_000, Math.min(5 * 60_000, Math.trunc(value)));
}

function clampThreshold(value: number, min = 10, max = 2_000): number {
  if (!Number.isFinite(value) || value <= 0) {
    return Math.max(min, 1);
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function getIdentity(req: Request): string {
  const raw = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    || req.ip
    || req.socket?.remoteAddress
    || "unknown";
  return String(raw).replace(/[\r\n]/g, "").slice(0, 96);
}

const ALWAYS_EXEMPT = new Set(["/api/health", "/health", "/ready", "/metrics"]);

function isExempt(req: Request): boolean {
  const path = req.path || "";
  for (const prefix of ALWAYS_EXEMPT) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  // SPA status/list endpoints are exempt only for read requests
  if (req.method === "GET" || req.method === "HEAD") {
    for (const prefix of EXEMPT_PATH_PREFIX) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        return true;
      }
    }
  }
  return false;
}

function cleanup(): void {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [identity, record] of Object.entries(abuseStore)) {
    if (record.lastSeenAtMs < cutoff) {
      delete abuseStore[identity];
      continue;
    }
    record.score = Math.max(0, Math.round(record.score * 0.5));
  }
}

function startCleanupLoop(): void {
  if (cleanupInterval) {
    return;
  }
  cleanupInterval = setInterval(cleanup, CLEANUP_INTERVAL_MS);
}

function stopCleanupLoop(): void {
  if (!cleanupInterval) {
    return;
  }
  clearInterval(cleanupInterval);
  cleanupInterval = undefined;
}

export function stopAbuseDetectionCleanup(): void {
  stopCleanupLoop();
}

export function abuseDetection() {
  startCleanupLoop();

  return function abuseDetectionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (isExempt(req)) {
      next();
      return;
    }

    const identity = getIdentity(req);
    const now = Date.now();
    const existing = abuseStore[identity];
    if (!existing) {
      abuseStore[identity] = {
        count: 1,
        score: 1,
        firstSeenAtMs: now,
        lastSeenAtMs: now,
      };
      next();
      return;
    }

    existing.count += 1;
    existing.lastSeenAtMs = now;

    const ageMs = now - existing.firstSeenAtMs;
    if (ageMs > WINDOW_MS) {
      existing.count = 1;
      existing.firstSeenAtMs = now;
      existing.score = Math.min(existing.score + 1, MAX_ABUSE_SCORE);
      next();
      return;
    }

    const requestRate = existing.count / Math.max(1, ageMs) * 1000;
    if (existing.count > MAX_REQUESTS_PER_WINDOW || requestRate > MAX_REQUESTS_PER_WINDOW / (WINDOW_MS / 1000)) {
      existing.score = Math.min(existing.score + 2, MAX_ABUSE_SCORE);
    } else {
      existing.score = Math.max(existing.score - 1, 0);
    }

    if (existing.score >= MAX_ABUSE_SCORE) {
      Logger.warn("[AbuseDetection] Abuse threshold reached", {
        identity,
        path: (req.originalUrl || req.path || "/").slice(0, 1024),
        count: existing.count,
        score: existing.score,
      });
      res.status(429).json({
        error: "Too many suspicious requests. Please retry after a short delay.",
        code: "ABUSE_DETECTED",
      });
      return;
    }

    if (req.headers["x-bot-signature"] || req.headers["x-client-fingerprint"]) {
      existing.score = Math.min(existing.score + 1, MAX_ABUSE_SCORE);
    }

    if (existing.score > 0) {
      res.setHeader("X-Abuse-Score", String(existing.score));
    }

    next();
  };
}

if (process.env.NODE_ENV === "test") {
  // Keep runtime deterministic in tests by not scheduling timers.
  stopAbuseDetectionCleanup();
}

