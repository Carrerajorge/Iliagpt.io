import { NextFunction, Request, Response } from "express";

import { Logger } from "../lib/logger";

const DEFAULT_BUDGET_MS = 5_000;
const DEFAULT_PERCENTILE_WARNING_MS = 8_000;
const MAX_BUDGET_MS = 30_000;
const BUDGET_MS = clampDuration(
  Number(process.env.RESPONSE_BUDGET_MS || DEFAULT_BUDGET_MS),
);
const WARN_PERCENTILE_MS = clampDuration(
  Number(process.env.RESPONSE_BUDGET_WARNING_MS || DEFAULT_PERCENTILE_WARNING_MS),
  1,
);

const HEALTH_PATH_RE = /^\/(?:api\/)?(?:health|ready|ping)(?:[/?#].*)?$/i;

function clampDuration(raw: number, minMs = 250, maxMs = MAX_BUDGET_MS): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_BUDGET_MS;
  }
  return Math.min(Math.max(Math.trunc(raw), minMs), maxMs);
}

function sanitizePath(value: string): string {
  return value.normalize("NFKC").replace(/[\u0000-\u001f]/g, "").slice(0, 2048);
}

function getClientIp(req: Request): string {
  const candidate = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    || req.ip
    || "";
  return sanitizePath(candidate || "unknown");
}

function safeSetHeader(res: Response, key: string, value: string): void {
  try {
    if (!res.headersSent) {
      res.setHeader(key, value);
    }
  } catch (error) {
    Logger.debug("[Observability] Could not set response budget headers", {
      header: key,
      error: (error as Error)?.message ?? String(error),
    });
  }
}

export function responseBudget() {
  return function responseBudgetMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (HEALTH_PATH_RE.test(req.path)) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    const startMs = Date.now();

    const requestPath = req.originalUrl || req.path || "/";
    const clientIp = getClientIp(req);
    res.once("finish", () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const status = res.statusCode;

      const timedHeader = `app;dur=${Math.max(0, elapsedMs).toFixed(2)}`;
      safeSetHeader(res, "Server-Timing", timedHeader);
      safeSetHeader(res, "X-Response-Time-Ms", String(Math.round(elapsedMs)));

      if (elapsedMs > WARN_PERCENTILE_MS) {
        Logger.warn("[Observability] Slow response", {
          path: sanitizePath(requestPath),
          method: req.method,
          status,
          clientIp,
          durationMs: Math.round(elapsedMs),
        });
      }

      if (elapsedMs > BUDGET_MS || Number.isNaN(elapsedMs)) {
        Logger.error("[Observability] Response budget exceeded", {
          path: sanitizePath(requestPath),
          method: req.method,
          status,
          durationMs: Math.round(elapsedMs),
          clientIp,
          startedAt: new Date(startMs).toISOString(),
        });
      }
    });

    next();
  };
}
