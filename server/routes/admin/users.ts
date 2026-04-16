import { Request, Router } from "express";
import { storage } from "../../storage";
import { db } from "../../db";
import { apiLogs, users } from "@shared/schema";
import { hashPassword } from "../../utils/password";
import { validateBody } from "../../middleware/validateRequest";
import { asyncHandler } from "../../middleware/errorHandler";
import { createUserBodySchema } from "../../schemas/apiSchemas";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { requireRecentAuth } from "../../middleware/jitElevation";
import { usageQuotaService } from "../../services/usageQuotaService";
import { queryAdminUsers } from "../../services/adminProjection";
import { sql } from "drizzle-orm";

export const usersRouter = Router();
const USER_ID_PARAM_PATTERN = /^[a-zA-Z0-9_-]{4,128}$/;
const RESERVED_USER_ID_SEGMENTS = new Set(["stats", "export", "probe"]);
const MAX_USER_LIST_LIMIT = 100;
const MAX_USER_EXPORT_LIMIT = 2000;
const MAX_SEARCH_LENGTH = 200;
const MAX_TEXT_INPUT_LENGTH = 500;
const MAX_ROLE_LENGTH = 32;
const MAX_SORT_FIELD_LENGTH = 24;
const MAX_ENUM_INPUT_LENGTH = 64;
const USER_MUTATION_LOCK_TTL_MS = 30_000;
const MAX_USER_ID_LENGTH = 128;
const EMAIL_MAX_LENGTH = 254;
const MAX_CSV_CELL_LENGTH = 4096;
const MAX_CONVERSATIONS_VIEW = 500;

type SortOrder = "asc" | "desc";
type UserSortField = "createdAt" | "email" | "queryCount" | "tokensConsumed" | "openclawTokensConsumed" | "dailyTokensUsed" | "lastLoginAt";
type ConversationRecord = { id: string; [key: string]: unknown };
type RequestWithActor = Request & { user?: { id?: string; email?: string } };

const VALID_SORT_FIELDS = new Set<UserSortField>([
  "createdAt",
  "email",
  "queryCount",
  "tokensConsumed",
  "openclawTokensConsumed",
  "dailyTokensUsed",
  "lastLoginAt",
]);
const VALID_USER_ROLES = new Set(["user", "admin", "moderator", "editor", "viewer", "api_only"]);
const VALID_USER_STATUS = new Set(["active", "blocked", "suspended", "pending", "inactive", "pending_verification"]);
const VALID_USER_PLANS = new Set(["free", "pro", "enterprise", "unlimited"]);
const VALID_USER_EXPORT_FORMATS = new Set(["json", "csv"]);
const LOCK_GUARD = new Map<string, Promise<void>>();

const USER_MUTATION_LOCKS_METADATA = new Map<string, number>();
const LOCK_CLEANUP_INTERVAL_MS = 60_000;

function nowMs(): number {
  return Date.now();
}

/** Per-user mutation queue to avoid concurrent destructive updates on same principal. */
function withUserMutationLock<T>(userId: string, action: () => Promise<T>): Promise<T> {
  const canonicalId = String(userId || "").trim().toLowerCase();
  if (!canonicalId) {
    return Promise.reject(new Error("Missing userId"));
  }

  const previous = LOCK_GUARD.get(canonicalId) ?? Promise.resolve();
  const running = (async () => {
    await previous;
    return action();
  })();

  const marker = running.then(
    () => undefined,
    () => undefined
  );
  LOCK_GUARD.set(canonicalId, marker);
  USER_MUTATION_LOCKS_METADATA.set(canonicalId, nowMs());

  running.finally(() => {
    const markerOrElse = marker;
    if (LOCK_GUARD.get(canonicalId) === markerOrElse) {
      LOCK_GUARD.delete(canonicalId);
    }
  });

  return running;
}

/** Bounded cleanup of lock metadata to avoid map growth in hostile scenarios. */
setInterval(() => {
  const cutoff = nowMs() - USER_MUTATION_LOCK_TTL_MS;
  for (const [userId, createdAt] of USER_MUTATION_LOCKS_METADATA.entries()) {
    if (createdAt < cutoff) {
      USER_MUTATION_LOCKS_METADATA.delete(userId);
      LOCK_GUARD.delete(userId);
    }
  }
}, LOCK_CLEANUP_INTERVAL_MS).unref();

function safeAdminError(error: unknown): string {
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (lower.includes("not found")) return "Resource not found";
    if (lower.includes("forbidden") || lower.includes("permission")) return "Permission denied";
    if (lower.includes("unauthorized")) return "Unauthorized";
    if (lower.includes("validation") || lower.includes("invalid")) return "Invalid request";
    if (lower.includes("timeout")) return "Operation timed out";
  }
  return "Internal server error";
}

function actorId(req: Request): string | undefined {
  return (req as RequestWithActor).user?.id;
}

function actorEmail(req: Request): string | undefined {
  return (req as RequestWithActor).user?.email;
}

function sanitizeTextInput(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u001f]/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function sanitizeEmailInput(value: unknown): string | undefined {
  const candidate = sanitizeTextInput(value, EMAIL_MAX_LENGTH);
  if (!candidate) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return undefined;
  return candidate.toLowerCase();
}

function parsePositiveInt(value: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const asString = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!asString) return fallback;
  const parsed = Number.parseInt(asString, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function parseSortOrder(value: unknown): SortOrder {
  const normalized = sanitizeTextInput(value, 8)?.toLowerCase() || "desc";
  return normalized === "asc" ? "asc" : "desc";
}

function parseSortField(value: unknown): UserSortField {
  const normalized = sanitizeTextInput(value, MAX_SORT_FIELD_LENGTH)?.toLowerCase();
  return normalized && VALID_SORT_FIELDS.has(normalized as UserSortField) ? (normalized as UserSortField) : "createdAt";
}

function parseSetValue<T extends string>(value: unknown, allowed: ReadonlySet<T>): T | undefined {
  const normalized = sanitizeTextInput(value, MAX_ENUM_INPUT_LENGTH)?.toLowerCase();
  if (!normalized) return undefined;
  return allowed.has(normalized as T) ? (normalized as T) : undefined;
}

function parseBooleanInput(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function sanitizeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let raw = String(value).replace(/\r/g, " ").replace(/\n/g, " ");
  raw = raw.replace(/^\s*[@=+\-]/, " ").trim();
  const normalized = raw.slice(0, MAX_CSV_CELL_LENGTH);
  if (normalized.includes('"') || normalized.includes(",") || normalized.includes("\n")) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return `"${normalized}"`;
}

function parseNumericField(value: unknown, min = 0): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < min || !Number.isSafeInteger(parsed)) return undefined;
  return parsed;
}

function parseNullableNumericField(value: unknown, min = 0): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < min || !Number.isSafeInteger(parsed)) return undefined;
  return parsed;
}

function parseDateField(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function normalizeRole(value: unknown, fallback: string): string | undefined {
  const normalized = sanitizeTextInput(value, MAX_ROLE_LENGTH)?.toLowerCase();
  if (!normalized) return fallback;
  return VALID_USER_ROLES.has(normalized) ? normalized : undefined;
}

function normalizePlan(value: unknown, fallback: string): string | undefined {
  const normalized = sanitizeTextInput(value, 24)?.toLowerCase();
  if (!normalized) return fallback;
  return VALID_USER_PLANS.has(normalized) ? normalized : undefined;
}

function sanitizePatchPayload(payload: unknown): { updates?: Record<string, unknown>; error?: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Payload must be a JSON object" };
  }

  const input = payload as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  if (input.email !== undefined) {
    const email = sanitizeEmailInput(input.email);
    if (!email) return { error: "Invalid email" };
    updates.email = email;
  }

  if (input.firstName !== undefined) {
    const firstName = sanitizeTextInput(input.firstName, 100);
    if (!firstName) return { error: "Invalid firstName" };
    updates.firstName = firstName;
  }

  if (input.lastName !== undefined) {
    const lastName = sanitizeTextInput(input.lastName, 100);
    if (!lastName) return { error: "Invalid lastName" };
    updates.lastName = lastName;
  }

  if (input.fullName !== undefined) {
    const fullName = sanitizeTextInput(input.fullName, 220);
    if (!fullName) return { error: "Invalid fullName" };
    updates.fullName = fullName;
  }

  if (input.role !== undefined) {
    const role = sanitizeTextInput(input.role, MAX_ROLE_LENGTH)?.toLowerCase();
    if (!role || !VALID_USER_ROLES.has(role)) return { error: "Invalid role" };
    updates.role = role;
  }

  if (input.status !== undefined) {
    const status = sanitizeTextInput(input.status, 24)?.toLowerCase();
    if (!status || !VALID_USER_STATUS.has(status)) return { error: "Invalid status" };
    updates.status = status;
  }

  if (input.plan !== undefined) {
    const plan = sanitizeTextInput(input.plan, 24)?.toLowerCase();
    if (!plan || !VALID_USER_PLANS.has(plan)) return { error: "Invalid plan" };
    updates.plan = plan;
  }

  if (input.profileImageUrl !== undefined) {
    if (input.profileImageUrl === null) {
      updates.profileImageUrl = null;
    } else {
      const profileImageUrl = sanitizeTextInput(input.profileImageUrl, 1024);
      if (!profileImageUrl) return { error: "Invalid profileImageUrl" };
      try {
        const parsed = new URL(profileImageUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          return { error: "Invalid profileImageUrl" };
        }
      } catch {
        return { error: "Invalid profileImageUrl" };
      }
      updates.profileImageUrl = profileImageUrl;
    }
  }

  if (input.blockReason !== undefined) {
    const blockReason = sanitizeTextInput(input.blockReason, MAX_TEXT_INPUT_LENGTH);
    if (!blockReason) return { error: "Invalid blockReason" };
    updates.blockReason = blockReason;
  }

  if (input.blockedAt !== undefined) {
    if (input.blockedAt === null) {
      updates.blockedAt = null;
    } else {
      const blockedAt = parseDateField(input.blockedAt);
      if (!blockedAt) return { error: "Invalid blockedAt" };
      updates.blockedAt = blockedAt;
    }
  }

  if (input.queryCount !== undefined) {
    const queryCount = parseNumericField(input.queryCount, 0);
    if (queryCount === undefined) return { error: "Invalid queryCount" };
    updates.queryCount = queryCount;
  }

  if (input.tokensConsumed !== undefined) {
    const tokensConsumed = parseNumericField(input.tokensConsumed, 0);
    if (tokensConsumed === undefined) return { error: "Invalid tokensConsumed" };
    updates.tokensConsumed = tokensConsumed;
  }

  if (input.tokensLimit !== undefined) {
    const tokensLimit = parseNumericField(input.tokensLimit, 0);
    if (tokensLimit === undefined) return { error: "Invalid tokensLimit" };
    updates.tokensLimit = tokensLimit;
  }

  if (input.dailyInputTokensLimit !== undefined) {
    const dailyInputTokensLimit = parseNullableNumericField(input.dailyInputTokensLimit, 0);
    if (dailyInputTokensLimit === undefined) return { error: "Invalid dailyInputTokensLimit" };
    updates.dailyInputTokensLimit = dailyInputTokensLimit;
  }

  if (input.dailyOutputTokensLimit !== undefined) {
    const dailyOutputTokensLimit = parseNullableNumericField(input.dailyOutputTokensLimit, 0);
    if (dailyOutputTokensLimit === undefined) return { error: "Invalid dailyOutputTokensLimit" };
    updates.dailyOutputTokensLimit = dailyOutputTokensLimit;
  }

  if (input.internalNotes !== undefined) {
    if (input.internalNotes === null) {
      updates.internalNotes = null;
    } else {
      const internalNotes = sanitizeTextInput(input.internalNotes, 4000);
      if (typeof input.internalNotes === "string" && input.internalNotes.trim() === "") {
        updates.internalNotes = null;
      } else if (!internalNotes) {
        return { error: "Invalid internalNotes" };
      } else {
        updates.internalNotes = internalNotes;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return { error: "No valid fields to update" };
  }

  return { updates };
}

usersRouter.param("id", (req, res, next, value) => {
  const userId = String(value || "").trim();
  if (userId.length > MAX_USER_ID_LENGTH) {
    res.status(400).json({
      error: "Invalid user identifier",
      code: "INVALID_USER_ID",
    });
    return;
  }
  const normalizedUserId = userId.toLowerCase();
  if (!USER_ID_PARAM_PATTERN.test(userId) || RESERVED_USER_ID_SEGMENTS.has(normalizedUserId)) {
    res.status(400).json({
      error: "Invalid user identifier",
      code: "INVALID_USER_ID",
    });
    return;
  }
  next();
});

// GET /api/admin/users - List with pagination, search, and filters
usersRouter.get("/", async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 1, 10000);
    const limit = parsePositiveInt(req.query.limit, 20, 1, MAX_USER_LIST_LIMIT);
    const search = sanitizeTextInput(req.query.search, MAX_SEARCH_LENGTH);
    const sortBy = parseSortField(req.query.sortBy);
    const sortOrder = parseSortOrder(req.query.sortOrder);
    const status = parseSetValue(req.query.status, VALID_USER_STATUS);
    const role = parseSetValue(req.query.role, VALID_USER_ROLES);
    const plan = parseSetValue(req.query.plan, VALID_USER_PLANS);
    const authProvider = sanitizeTextInput(req.query.authProvider, MAX_ENUM_INPUT_LENGTH)?.toLowerCase();

    const result = await queryAdminUsers({
      page,
      limit,
      search,
      status,
      role,
      plan,
      authProvider,
      sortBy,
      sortOrder,
    });

    res.json({
      users: result.users,
      pagination: result.pagination,
      summary: result.summary,
    });
  } catch (error: unknown) {
    res.status(500).json({ error: safeAdminError(error) });
  }
});

usersRouter.get("/stats", async (req, res) => {
  try {
    const stats = await storage.getUserStats();
    res.json(stats);
  } catch (error: unknown) {
    res.status(500).json({ error: safeAdminError(error) });
  }
});

usersRouter.get("/export", async (req, res) => {
  try {
    const rawFormat = sanitizeTextInput(req.query.format, 16)?.toLowerCase();
    const format = (rawFormat && VALID_USER_EXPORT_FORMATS.has(rawFormat as "json" | "csv"))
      ? (rawFormat as "json" | "csv")
      : "json";
    const page = parsePositiveInt(req.query.page, 1, 1, 10000);
    const limit = parsePositiveInt(req.query.limit, MAX_USER_EXPORT_LIMIT, 1, MAX_USER_EXPORT_LIMIT);
    const search = sanitizeTextInput(req.query.search, MAX_SEARCH_LENGTH);
    const sortBy = parseSortField(req.query.sortBy);
    const sortOrder = parseSortOrder(req.query.sortOrder);
    const status = parseSetValue(req.query.status, VALID_USER_STATUS);
    const role = parseSetValue(req.query.role, VALID_USER_ROLES);
    const plan = parseSetValue(req.query.plan, VALID_USER_PLANS);
    const authProvider = sanitizeTextInput(req.query.authProvider, MAX_ENUM_INPUT_LENGTH)?.toLowerCase();
    const result = await queryAdminUsers({
      page,
      limit,
      search,
      status,
      role,
      plan,
      authProvider,
      sortBy,
      sortOrder,
    });
    const rows = result.users;
    const filenameBase = `users_${actorId(req) || "admin"}_${new Date().toISOString().replace(/[:.]/g, "-")}`;

    if (format === "csv") {
      const headers = [
        "id",
        "email",
        "fullName",
        "plan",
        "role",
        "status",
        "queryCount",
        "tokensConsumed",
        "openclawTokensConsumed",
        "dailyInputTokensUsed",
        "dailyOutputTokensUsed",
        "dailyTotalTokensUsed",
        "dailyInputTokensLimit",
        "dailyOutputTokensLimit",
        "dailyLimitReached",
        "createdAt",
        "lastLoginAt",
      ];
      const csvRows = [headers.map(sanitizeCsvField).join(",")];
      rows.forEach((u) => {
        const fullName = [u.fullName || "", u.firstName || "", u.lastName || ""]
          .map((value) => String(value).trim())
          .join(" ")
          .trim();
        csvRows.push([
          u.id,
          u.email || "",
          fullName,
          u.plan || "",
          u.role || "",
          u.status || "",
          u.queryCount || 0,
          u.tokensConsumed || 0,
          (u as any).openclawTokensConsumed || 0,
          (u as any).dailyInputTokensUsed || 0,
          (u as any).dailyOutputTokensUsed || 0,
          (u as any).dailyTotalTokensUsed || 0,
          (u as any).dailyInputTokensLimit ?? "",
          (u as any).dailyOutputTokensLimit ?? "",
          (u as any).dailyLimitReached ? "true" : "false",
          u.createdAt instanceof Date ? u.createdAt.toISOString() : String(u.createdAt || ""),
          u.lastLoginAt instanceof Date ? u.lastLoginAt.toISOString() : String(u.lastLoginAt || ""),
        ].map(sanitizeCsvField).join(","));
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=${filenameBase}.csv`);
      res.send(csvRows.join("\n"));
      return;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${filenameBase}.json`);
    res.json({
      users: rows,
      pagination: {
        ...result.pagination,
        returned: rows.length,
      },
      summary: result.summary,
    });
  } catch (error: unknown) {
    res.status(500).json({ error: safeAdminError(error) });
  }
});

usersRouter.post("/", requireRecentAuth(), validateBody(createUserBodySchema), asyncHandler(async (req, res) => {
    const { email, password, plan, role } = req.body;
    const normalizedEmail = sanitizeEmailInput(email);
    if (!normalizedEmail) {
        return res.status(400).json({ error: "Invalid email address" });
    }

    const existingUser = await storage.getUserByEmail(normalizedEmail);
    if (existingUser) {
        return res.status(409).json({ error: "A user with this email already exists" });
    }

    const normalizedRole = normalizeRole(role, "user");
    const normalizedPlan = normalizePlan(plan, "free");
    if (!normalizedRole || !normalizedPlan) {
      return res.status(400).json({ error: "Invalid role or plan" });
    }

    const hashedPassword = await hashPassword(password);
    const [user] = await db.insert(users).values({
        email: normalizedEmail,
        password: hashedPassword,
        plan: normalizedPlan,
        role: normalizedRole,
        status: "active"
    }).returning();
    
    // Enhanced audit log with full context
    await auditLog(req, {
        action: AuditActions.USER_CREATED,
        resource: "users",
        resourceId: user.id,
        details: { email: normalizedEmail, plan: normalizedPlan, role: normalizedRole, createdBy: actorEmail(req) },
        category: "admin",
        severity: "info"
    });
    
    res.json(user);
}));

usersRouter.patch("/:id", requireRecentAuth(), async (req, res) => {
    try {
        const parsed = sanitizePatchPayload(req.body);
        if (!parsed.updates) {
          return res.status(400).json({ error: parsed.error });
        }

        const result = await withUserMutationLock(req.params.id, async () => {
            const previousUser = await storage.getUser(req.params.id);
            const user = await storage.updateUser(req.params.id, parsed.updates);
            if (!user) {
                return null;
            }

            await auditLog(req, {
                action: AuditActions.USER_UPDATED,
                resource: "users",
                resourceId: req.params.id,
                details: {
                    changes: parsed.updates,
                    previousValues: previousUser ? {
                        email: previousUser.email,
                        role: previousUser.role,
                        plan: previousUser.plan,
                        status: previousUser.status
                    } : null,
                    updatedBy: actorEmail(req),
                },
                category: "admin",
                severity: "info"
            });

            return user;
        });

        if (!result) {
            return res.status(404).json({ error: "User not found" });
        }
        res.json(result);
  } catch (error: unknown) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

usersRouter.delete("/:id", requireRecentAuth(), async (req, res) => {
    try {
        const userId = req.params.id;
        const result = await withUserMutationLock(userId, async () => {
            const userToDelete = await storage.getUser(userId);
            if (!userToDelete) {
                return null;
            }

            await storage.deleteUser(userId);
            return userToDelete;
        });

        if (!result) {
            return res.status(404).json({ error: "User not found" });
        }
        
        // Enhanced audit log with deleted user info
        await auditLog(req, {
            action: AuditActions.USER_DELETED,
            resource: "users",
            resourceId: req.params.id,
            details: {
                deletedUser: result ? {
                    email: result.email,
                    role: result.role,
                    plan: result.plan
                } : null,
                deletedBy: actorEmail(req)
            },
            category: "admin",
            severity: "warning"
        });
        
        res.json({ success: true });
    } catch (error: unknown) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

usersRouter.get("/:id/token-report", async (req, res) => {
  try {
    const user = await storage.getUser(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const quota = await usageQuotaService.getDailyTokenQuotaStatus(req.params.id, 0);
    const historyStart = new Date();
    historyStart.setHours(0, 0, 0, 0);
    historyStart.setDate(historyStart.getDate() - 6);

    const historyResult = await db.execute(sql`
      SELECT
        TO_CHAR(DATE(${apiLogs.createdAt}), 'YYYY-MM-DD') AS day,
        COALESCE(SUM(${apiLogs.tokensIn}), 0)::int AS input_tokens,
        COALESCE(SUM(${apiLogs.tokensOut}), 0)::int AS output_tokens,
        COUNT(*)::int AS request_count
      FROM ${apiLogs}
      WHERE ${apiLogs.userId} = ${req.params.id}
        AND ${apiLogs.createdAt} >= ${historyStart}
      GROUP BY DATE(${apiLogs.createdAt})
      ORDER BY DATE(${apiLogs.createdAt}) DESC
    `);

    const rawHistory = Array.isArray(historyResult.rows) ? historyResult.rows : [];
    const historyByDay = new Map<string, { inputTokens: number; outputTokens: number; requestCount: number }>();

    for (const row of rawHistory as Array<Record<string, unknown>>) {
      const day = String(row.day || "");
      if (!day) continue;
      const inputTokens = Number(row.input_tokens || 0);
      const outputTokens = Number(row.output_tokens || 0);
      const requestCount = Number(row.request_count || 0);
      historyByDay.set(day, {
        inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
        outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
        requestCount: Number.isFinite(requestCount) ? requestCount : 0,
      });
    }

    const dailyHistory: Array<{
      day: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      requestCount: number;
    }> = [];

    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(historyStart);
      day.setDate(historyStart.getDate() + offset);
      const key = day.toISOString().slice(0, 10);
      const entry = historyByDay.get(key) || { inputTokens: 0, outputTokens: 0, requestCount: 0 };
      dailyHistory.push({
        day: key,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        totalTokens: entry.inputTokens + entry.outputTokens,
        requestCount: entry.requestCount,
      });
    }

    dailyHistory.reverse();

    res.json({
      today: {
        inputTokensUsed: quota.inputUsed,
        outputTokensUsed: quota.outputUsed,
        totalTokensUsed: quota.totalUsed,
        inputTokensLimit: quota.inputLimit,
        outputTokensLimit: quota.outputLimit,
        inputTokensRemaining: quota.inputRemaining,
        outputTokensRemaining: quota.outputRemaining,
        withinLimits:
          (quota.inputLimit === null || (quota.inputRemaining ?? 0) > 0) &&
          (quota.outputLimit === null || (quota.outputRemaining ?? 0) > 0),
        resetAt: quota.resetAt,
      },
      lifetime: {
        totalTokensUsed: user.tokensConsumed || 0,
        openclawTokensUsed: (user as any).openclawTokensConsumed || 0,
      },
      dailyHistory,
    });
  } catch (error: unknown) {
    res.status(500).json({ error: safeAdminError(error) });
  }
});

// GET /api/admin/users/:id - Get single user details
usersRouter.get("/:id", async (req, res) => {
    try {
        const user = await storage.getUser(req.params.id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        res.json(user);
    } catch (error: unknown) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// POST /api/admin/users/:id/block - Block a user
usersRouter.post("/:id/block", requireRecentAuth(), async (req, res) => {
    try {
        const reasonRaw = sanitizeTextInput(req.body?.reason, MAX_TEXT_INPUT_LENGTH) || "Blocked by admin";
        const userId = req.params.id;
        const user = await withUserMutationLock(userId, async () => {
            const previousUser = await storage.getUser(userId);
            if (!previousUser) {
                return null;
            }
            return storage.updateUser(userId, {
                status: "blocked",
                blockedAt: new Date(),
                blockReason: reasonRaw,
            });
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        await auditLog(req, {
            action: AuditActions.USER_BLOCKED,
            resource: "users",
            resourceId: user.id,
            details: { 
                reason: reasonRaw,
                userEmail: user.email,
                blockedBy: actorEmail(req)
            },
            category: "security",
            severity: "warning"
        });
        res.json({ success: true, user });
    } catch (error: unknown) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// POST /api/admin/users/:id/unblock - Unblock a user
usersRouter.post("/:id/unblock", requireRecentAuth(), async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await withUserMutationLock(userId, async () => {
            const previousUser = await storage.getUser(userId);
            if (!previousUser) {
                return null;
            }

            return storage.updateUser(userId, {
                status: "active",
                blockedAt: null,
                blockReason: null,
            });
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        await auditLog(req, {
            action: AuditActions.USER_UNBLOCKED,
            resource: "users",
            resourceId: req.params.id,
            details: {
                userEmail: user.email,
                unblockedBy: actorEmail(req)
            },
            category: "security",
            severity: "info"
        });
        res.json({ success: true, user });
    } catch (error: unknown) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// PATCH /api/admin/users/:id/role - Update user role
usersRouter.patch("/:id/role", requireRecentAuth(), async (req, res) => {
    try {
        const role = parseSetValue(req.body?.role, VALID_USER_ROLES);
        if (!role) {
            return res.status(400).json({ error: `Invalid role. Allowed: ${[...VALID_USER_ROLES].join(", ")}` });
        }

        const userId = req.params.id;
        const user = await withUserMutationLock(userId, async () => {
            const previousUser = await storage.getUser(userId);
            if (!previousUser) {
                return null;
            }
            return storage.updateUser(userId, { role });
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        await auditLog(req, {
            action: AuditActions.USER_ROLE_CHANGED,
            resource: "users",
            resourceId: req.params.id,
            details: { role },
            category: "admin",
            severity: "info"
        });
        res.json({ success: true, user });
  } catch (error: unknown) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// GET /api/admin/users/:id/conversations - Get all conversations of a user (admin monitoring)
usersRouter.get("/:id/conversations", async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await storage.getUser(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const conversations = await storage.getConversationsByUserId(userId);
        const truncated = conversations.length > MAX_CONVERSATIONS_VIEW;
        const conversationsWindow = conversations.slice(0, MAX_CONVERSATIONS_VIEW);
        
        // Get message counts for each conversation
        const conversationsWithStats = await Promise.all(
            conversationsWindow.map(async (conv: ConversationRecord) => {
                const messages = await storage.getMessagesByConversationId(conv.id);
                return {
                    ...conv,
                    messageCount: messages?.length || 0,
                    lastMessage: messages?.[messages.length - 1] || null
                };
            })
        );

        await storage.createAuditLog({
            action: "admin_view_user_conversations",
            resource: "users",
            resourceId: userId,
            details: { conversationCount: conversations.length, truncated }
        });

        res.json({
            user: { id: user.id, email: user.email, fullName: user.fullName },
            conversations: conversationsWithStats,
            total: conversations.length,
            truncated,
            shown: conversationsWithStats.length,
        });
  } catch (error: unknown) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// DELETE /api/admin/users/:id/conversations - Delete all conversations of a user
usersRouter.delete("/:id/conversations", requireRecentAuth(), async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await storage.getUser(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const deletedCount = await withUserMutationLock(userId, async () => {
            const conversations = await storage.getConversationsByUserId(userId);
            const BATCH_SIZE = 20;
            let totalDeleted = 0;

            for (let index = 0; index < conversations.length; index += BATCH_SIZE) {
                const chunk = conversations.slice(index, index + BATCH_SIZE);
                await Promise.all(
                    chunk.map(async (conv: ConversationRecord) => {
                        await storage.deleteConversation(conv.id);
                        return;
                    })
                );
                totalDeleted += chunk.length;
            }

            return totalDeleted;
        });

        await storage.createAuditLog({
            action: "admin_delete_user_conversations",
            resource: "users",
            resourceId: userId,
            details: { deletedCount }
        });

        res.json({ success: true, deletedCount });
    } catch (error: unknown) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// POST /api/admin/users/:id/impersonate - Intentionally disabled until a secure session-scoped flow exists
usersRouter.post("/:id/impersonate", requireRecentAuth(), async (req, res) => {
    try {
        const userId = req.params.id;
        const adminId = actorId(req);
        if (!adminId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        await storage.createAuditLog({
            action: "admin_impersonation_blocked",
            resource: "users",
            resourceId: userId,
            details: {
              adminId,
              reason: "disabled_until_secure_session_scoped_implementation",
            }
        });

        return res.status(403).json({
            error: "Admin impersonation is disabled until a secure session-scoped implementation is available.",
            code: "IMPERSONATION_DISABLED",
        });
    } catch (error: unknown) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// POST /api/admin/users/:id/reset - Reset user to clean state
usersRouter.post("/:id/reset", requireRecentAuth(), async (req, res) => {
    try {
        const userId = req.params.id;
        const deleteConversations = parseBooleanInput(req.body?.deleteConversations);
        const resetStats = parseBooleanInput(req.body?.resetStats);
        const finalDeleteConversations = deleteConversations === undefined ? true : deleteConversations;
        const finalResetStats = resetStats === undefined ? false : resetStats;

        const user = await storage.getUser(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        let deletedConversations = 0;

        await withUserMutationLock(userId, async () => {
            if (finalDeleteConversations) {
                const conversations = await storage.getConversationsByUserId(userId);
                const BATCH_SIZE = 20;
                for (let index = 0; index < conversations.length; index += BATCH_SIZE) {
                    const chunk = conversations.slice(index, index + BATCH_SIZE);
                    await Promise.all(
                        chunk.map(async (conv: ConversationRecord) => {
                            await storage.deleteConversation(conv.id);
                            return;
                        })
                    );
                    deletedConversations += chunk.length;
                }
            }

            if (finalResetStats) {
                await storage.updateUser(userId, {
                    queryCount: 0,
                    tokensConsumed: 0
                });
            }
        });

        await storage.createAuditLog({
            action: "admin_reset_user",
            resource: "users",
            resourceId: userId,
            details: { deleteConversations: finalDeleteConversations, resetStats: finalResetStats, deletedConversations }
        });

        res.json({ 
            success: true, 
            deletedConversations,
            statsReset: finalResetStats
        });
  } catch (error: unknown) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});
