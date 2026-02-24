import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createLogger } from "../lib/structuredLogger";
import { getSkillPlatformService } from "../services/skillPlatform";
import { skillScopeSchema, type SkillScope } from "@shared/schema/skillPlatform";

const ALLOWED_IDENTIFIER_RE = /^[a-zA-Z0-9._-]{1,80}$/;
const ALLOWED_REQUEST_ID_RE = /^[a-zA-Z0-9._-]{6,140}$/;
const SAFE_FILE_NAME_RE = /^[^<>:"/\\|?*\u0000-\u001f]{1,220}$/;
const SAFE_MIME_TYPE_RE = /^[a-zA-Z0-9][a-zA-Z0-9.+-\/]*$/;
const SKILL_PLATFORM_MAX_ALLOWED_SCOPES = 12;
const SKILL_PLATFORM_MAX_ATTACHMENTS = 12;
const DEFAULT_SKILL_SCOPES: SkillScope[] = ["storage.read", "files", "code_interpreter"];
const SKILL_PLATFORM_EXECUTE_RATE_LIMIT = 60;
const SKILL_PLATFORM_EXECUTE_RATE_WINDOW_MS = 60_000;
const SKILL_PLATFORM_RATE_CLEANUP_MS = 300_000;
const SKILL_PLATFORM_RESPONSE_TRACE_LIMIT = 48;

interface SkillPlatformRateBucket {
  count: number;
  resetAt: number;
}
const skillPlatformRateBuckets = new Map<string, SkillPlatformRateBucket>();

function makeRateLimitKey(req: Request, fallbackUserId?: string | null): string {
  if (typeof fallbackUserId === "string" && ALLOWED_IDENTIFIER_RE.test(fallbackUserId)) {
    return `user:${fallbackUserId}`;
  }
  const forwarded = typeof req.headers["x-forwarded-for"] === "string"
    ? req.headers["x-forwarded-for"].split(",")[0]?.trim()
    : null;
  const remoteIp = typeof forwarded === "string" && forwarded.length
    ? forwarded
    : (req.ip || req.socket?.remoteAddress || "anonymous");
  return `ip:${remoteIp}`;
}

function takeRateSlot(key: string, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
  const bucket = skillPlatformRateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + SKILL_PLATFORM_EXECUTE_RATE_WINDOW_MS;
    skillPlatformRateBuckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: Math.max(0, SKILL_PLATFORM_EXECUTE_RATE_LIMIT - 1),
      resetAt,
    };
  }
  if (bucket.count >= SKILL_PLATFORM_EXECUTE_RATE_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: bucket.resetAt,
    };
  }
  bucket.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, SKILL_PLATFORM_EXECUTE_RATE_LIMIT - bucket.count),
    resetAt: bucket.resetAt,
  };
}

function pruneRateBuckets(now = Date.now()): void {
  for (const [key, bucket] of skillPlatformRateBuckets.entries()) {
    if (bucket.resetAt <= now) {
      skillPlatformRateBuckets.delete(key);
    }
  }
}

setInterval(() => pruneRateBuckets(), SKILL_PLATFORM_RATE_CLEANUP_MS).unref?.();

const skillExecuteSchema = z.object({
  userMessage: z.string().min(1).max(4000),
  conversationId: z.string().max(80).regex(ALLOWED_IDENTIFIER_RE, "Invalid conversationId").nullable().optional(),
  runId: z.string().max(80).regex(ALLOWED_IDENTIFIER_RE, "Invalid runId").optional(),
  userId: z.string().max(80).regex(ALLOWED_IDENTIFIER_RE, "Invalid userId").optional(),
  attachments: z.array(
    z.object({
      id: z.string().max(160).optional(),
      name: z.string().max(220).regex(SAFE_FILE_NAME_RE, "Invalid attachment name").optional(),
      mimeType: z.string().max(120).regex(SAFE_MIME_TYPE_RE, "Invalid mimeType").optional(),
      size: z.number().int().min(0).max(200_000_000).optional(),
    }).strict()
  ).max(SKILL_PLATFORM_MAX_ATTACHMENTS).optional(),
  allowedScopes: z.array(skillScopeSchema).max(SKILL_PLATFORM_MAX_ALLOWED_SCOPES).optional(),
  autoCreate: z.boolean().optional().default(true),
  maxRetries: z.number().int().min(0).max(6).optional(),
  intentHint: z.object({
    intent: z.string().max(120).optional(),
    confidence: z.number().min(0).max(1).optional(),
    output_format: z.string().max(120).optional(),
    language_detected: z.string().max(40).optional(),
  }).partial().optional(),
});

const rollbackSchema = z.object({
  targetVersion: z.number().int().positive(),
});

const logger = createLogger("skill-platform-router");

function resolveRequestId(rawRequestId: unknown): string | null {
  if (typeof rawRequestId !== "string") return null;
  const trimmed = rawRequestId.trim();
  return ALLOWED_REQUEST_ID_RE.test(trimmed) ? trimmed : null;
}

function resolveOptionalId(rawId: unknown): string | null {
  if (typeof rawId !== "string") return null;
  const trimmed = rawId.trim();
  return trimmed && ALLOWED_IDENTIFIER_RE.test(trimmed) ? trimmed : null;
}

function normalizeSkillScopes(rawScopes: unknown): SkillScope[] {
  if (!Array.isArray(rawScopes)) return [...DEFAULT_SKILL_SCOPES];
  const scopeSet = new Set<SkillScope>();
  for (const candidate of rawScopes) {
    if (typeof candidate !== "string") continue;
    const parsed = skillScopeSchema.safeParse(candidate.trim());
    if (parsed.success && !scopeSet.has(parsed.data)) {
      scopeSet.add(parsed.data);
      if (scopeSet.size >= SKILL_PLATFORM_MAX_ALLOWED_SCOPES) break;
    }
  }
  return scopeSet.size ? Array.from(scopeSet) : [...DEFAULT_SKILL_SCOPES];
}

export function createSkillPlatformRouter() {
  const router = Router();

  router.get("/catalog", async (_req: Request, res: Response) => {
    try {
      const list = await getSkillPlatformService().listSkills();
      logger.info("skill-platform.catalog.listed", { count: list.length, method: "GET" });
      res.json({ success: true, count: list.length, data: list, timestamp: new Date().toISOString() });
    } catch (error: any) {
      logger.error("skill-platform.catalog.list_failed", { error: error?.message || String(error) });
      res.status(500).json({ success: false, error: "Failed to fetch skill catalog" });
    }
  });

  router.get("/catalog/:slugOrId/history", async (req: Request, res: Response) => {
    try {
      const { slugOrId } = req.params;
      const history = await getSkillPlatformService().getSkillHistory(slugOrId);
      if (!history.length) {
        return res.status(404).json({
          success: false,
          error: `Skill ${slugOrId} not found`,
        });
      }

      logger.info("skill-platform.catalog.history", { slugOrId, entries: history.length, method: "GET" });
      res.json({ success: true, slugOrId, count: history.length, data: history, timestamp: new Date().toISOString() });
    } catch (error: any) {
      logger.error("skill-platform.catalog.history_failed", {
        slugOrId: req.params.slugOrId,
        error: error?.message || String(error),
      });
      res.status(500).json({ success: false, error: "Failed to fetch skill history" });
    }
  });

  router.get("/metrics", async (_req: Request, res: Response) => {
    try {
      const metrics = getSkillPlatformService().getExecutionMetrics();
      res.json({
        success: true,
        metrics: {
          ...metrics,
          uptimeMs: Date.now() - metrics.startedAt,
          status: "ok",
        },
      });
    } catch (error: any) {
      logger.error("skill-platform.metrics_failed", { error: error?.message || String(error) });
      res.status(500).json({ success: false, error: "Failed to fetch skill platform metrics" });
    }
  });

  router.post("/catalog/:slugOrId/rollback", async (req: Request, res: Response) => {
    try {
      const parse = rollbackSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({ success: false, error: parse.error.issues.map((i) => i.message) });
      }

      const { slugOrId } = req.params;
      const { targetVersion } = parse.data;
      const ok = await getSkillPlatformService().rollbackSkill(slugOrId, targetVersion);
      if (!ok) {
        return res.status(404).json({
          success: false,
          error: `Unable to rollback ${slugOrId} to version ${targetVersion}`,
        });
      }

      logger.info("skill-platform.catalog.rollback", { slugOrId, targetVersion, method: "POST" });
      res.json({
        success: true,
        slugOrId,
        targetVersion,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error("skill-platform.catalog.rollback_failed", {
        slugOrId: req.params.slugOrId,
        error: error?.message || String(error),
      });
      res.status(500).json({ success: false, error: "Rollback failed" });
    }
  });

  router.post("/execute", async (req: Request, res: Response) => {
    try {
      const requestId = resolveRequestId(req.headers["x-request-id"]);
      if (!requestId) {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid x-request-id header",
        });
      }

      const parse = skillExecuteSchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({
          success: false,
          error: "Invalid execute payload",
          details: parse.error.issues.map((issue) => issue.message),
        });
      }

      const payload = parse.data;
      const idempotencyKey = resolveOptionalId(req.headers["x-idempotency-key"] || req.headers["idempotency-key"]);
      const rateLimitKey = makeRateLimitKey(req, resolveOptionalId(payload.userId) || payload.userId);
      const rate = takeRateSlot(rateLimitKey);
      res.set("x-rate-limit-limit", String(SKILL_PLATFORM_EXECUTE_RATE_LIMIT));
      res.set("x-rate-limit-remaining", String(rate.remaining));
      res.set("x-rate-limit-reset", String(Math.max(1, Math.floor((rate.resetAt - Date.now()) / 1000))));
      if (!rate.allowed) {
        res.set("retry-after", String(Math.max(1, Math.floor((rate.resetAt - Date.now()) / 1000))));
        return res.status(429).json({
          success: false,
          error: "Skill platform rate limit exceeded",
          details: {
            limit: SKILL_PLATFORM_EXECUTE_RATE_LIMIT,
            windowMs: SKILL_PLATFORM_EXECUTE_RATE_WINDOW_MS,
            resetAt: new Date(rate.resetAt).toISOString(),
          },
        });
      }

      const resolvedRunId = payload.runId || idempotencyKey || null;
      const intentHint = payload.intentHint
        ? {
          intent: payload.intentHint.intent?.trim().slice(0, 120),
          confidence: typeof payload.intentHint.confidence === "number" ? payload.intentHint.confidence : undefined,
          output_format: payload.intentHint.output_format?.trim().slice(0, 80),
          language_detected: payload.intentHint.language_detected?.trim().slice(0, 30),
        }
        : undefined;

      const result = await getSkillPlatformService().executeFromMessage({
        requestId,
        conversationId: payload.conversationId ?? null,
        runId: resolvedRunId,
        userId: resolveOptionalId(payload.userId) || null,
        userMessage: payload.userMessage,
        attachments: payload.attachments?.slice(0, SKILL_PLATFORM_MAX_ATTACHMENTS) || [],
        allowedScopes: normalizeSkillScopes(payload.allowedScopes),
        intentHint,
        autoCreate: payload.autoCreate,
        maxRetries: payload.maxRetries,
        now: new Date(),
      });

      logger.info("skill-platform.execute", {
        requestId,
        runId: resolvedRunId,
        status: result.status,
        continueWithModel: result.continueWithModel,
        autoCreated: result.autoCreated,
      });

      const traces = Array.isArray(result.traces)
        ? result.traces.slice(-SKILL_PLATFORM_RESPONSE_TRACE_LIMIT)
        : [];

      res.set("x-request-id", requestId);
      if (idempotencyKey) {
        res.set("x-idempotency-key", idempotencyKey);
      }
      res.json({
        success: true,
        requestId,
        data: {
          ...result,
          traces,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error("skill-platform.execute_failed", {
        requestId: req.headers["x-request-id"],
        error: error?.message || String(error),
      });
      res.status(500).json({ success: false, error: error?.message || "Skill execution failed" });
    }
  });

  return router;
}
