import { NextFunction, Request, Response } from "express";

const MAX_HEADER_SIZE_BYTES = 12_000;
const MAX_QUERY_PAIRS = 240;
const MAX_QUERY_KEY_LENGTH = 128;
const MAX_QUERY_VALUE_LENGTH = 1_024;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/;

const cleanupStore = new Map<string, number>();
let cleanupHandle: ReturnType<typeof setInterval> | undefined;

function isControlSafe(value: string): boolean {
  return !CONTROL_CHARS_RE.test(value);
}

function normalizeHeaderValue(value: string): string {
  return value.normalize("NFKC").replace(/\r\n|\r|\n/g, " ").slice(0, 2048);
}

function scoreRequestIntegrity(req: Request): number {
  let risk = 0;
  const userAgent = req.headers["user-agent"];
  if (typeof userAgent === "string" && !isControlSafe(userAgent)) {
    risk += 4;
  }
  if (typeof req.headers["x-requested-with"] === "string" && req.headers["x-requested-with"].length > 96) {
    risk += 2;
  }
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const contentLength = Number(req.get("content-length") || 0);
    if (!Number.isFinite(contentLength) || contentLength > 25 * 1024 * 1024) {
      risk += 3;
    }
  }

  if (req.headers["cookie"] && req.headers["cookie"].length > 16_000) {
    risk += 1;
  }

  if ((req.get("x-forwarded-for") || "").length > 512) {
    risk += 1;
  }

  return risk;
}

function validateQuery(req: Request): { ok: boolean; reason?: string; code?: string } {
  const queryCount = Object.keys(req.query || {}).length;
  if (queryCount > MAX_QUERY_PAIRS) {
    return { ok: false, reason: "Too many query parameters", code: "QUERY_PARAMS_LIMIT" };
  }

  const totalBytes = JSON.stringify(req.query || {}).length;
  if (totalBytes > MAX_HEADER_SIZE_BYTES) {
    return { ok: false, reason: "Query payload too large", code: "QUERY_SIZE_LIMIT" };
  }

  for (const key of Object.keys(req.query || {})) {
    if (key.length > MAX_QUERY_KEY_LENGTH || !isControlSafe(key)) {
      return { ok: false, reason: "Invalid query key", code: "QUERY_KEY_INVALID" };
    }
    const value = req.query[key];
    const stringValue = Array.isArray(value) ? value.join(",") : String(value ?? "");
    if (stringValue.length > MAX_QUERY_VALUE_LENGTH || !isControlSafe(stringValue)) {
      return { ok: false, reason: "Invalid query value", code: "QUERY_VALUE_INVALID" };
    }
  }

  return { ok: true };
}

function runCleanupTick(): void {
  const now = Date.now();
  const cutoff = now - 10 * 60_000;
  for (const [k, ts] of cleanupStore.entries()) {
    if (ts < cutoff) {
      cleanupStore.delete(k);
    }
  }
}

export function stopIntegrityCleanup(): void {
  if (cleanupHandle) {
    clearInterval(cleanupHandle);
    cleanupHandle = undefined;
  }
}

export function requestIntegrity() {
  if (!cleanupHandle && process.env.NODE_ENV !== "test") {
    cleanupHandle = setInterval(runCleanupTick, 60_000);
  }

  return function requestIntegrityMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const headerValidation = Object.entries(req.headers).some(([key, value]) => {
      if (typeof value === "undefined") return false;
      if (Array.isArray(value)) {
        return value.some((item) => String(item).length > MAX_QUERY_VALUE_LENGTH);
      }
      return String(value).length > MAX_HEADER_SIZE_BYTES || !isControlSafe(String(value));
    });
    if (headerValidation) {
      res.status(400).json({ error: "Invalid header format", code: "INVALID_HEADER" });
      return;
    }

    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") {
        req.headers[key] = normalizeHeaderValue(value) as any;
      }
    }

    const queryCheck = validateQuery(req);
    if (!queryCheck.ok) {
      const key = `${req.method}:${req.originalUrl || req.path || "/"}`;
      cleanupStore.set(key, Date.now());
      res.status(400).json({ error: queryCheck.reason, code: queryCheck.code });
      return;
    }

    const risk = scoreRequestIntegrity(req);
    const maxRisk = Number(process.env.INTEGRITY_MAX_RISK || 8);
    if (risk >= maxRisk) {
      res.status(429).json({ error: "Request integrity score exceeded", code: "INTEGRITY_REJECTED" });
      return;
    }

    if (risk > 0) {
      res.setHeader("X-Request-Integrity-Risk", String(risk));
    }

    next();
  };
}

