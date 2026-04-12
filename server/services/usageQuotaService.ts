import { db } from "../db";
import { apiLogs, users } from "@shared/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";

import { consumeBillingCredits, getBillingCreditSummary } from "./billingCreditLedgerService";

export interface UsageCheckResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date | null;
  plan: string;
  message?: string;
  isAdmin?: boolean;
  isPaid?: boolean;
}

export interface PlanLimits {
  dailyRequests: number;
  model: string;
}

export interface DailyTokenQuotaStatus {
  allowed: boolean;
  resetAt: Date | null;
  inputUsed: number;
  outputUsed: number;
  totalUsed: number;
  inputLimit: number | null;
  outputLimit: number | null;
  inputRemaining: number | null;
  outputRemaining: number | null;
  message?: string;
}

export interface MonthlyTokenQuotaStatus {
  allowed: boolean;
  resetAt: Date | null;
  used: number;
  limit: number | null;
  remaining: number | null;
  extraCredits: number;
  plan: string;
  isAdmin: boolean;
  isPaid: boolean;
  message?: string;
}

export interface UnifiedQuotaSnapshot {
  unified: true;
  userId: string;
  plan: string;
  isAdmin: boolean;
  isPaid: boolean;
  blockingState: "ok" | "request_limit" | "daily_token_limit" | "monthly_token_limit";
  billing: {
    statusUrl: string;
    upgradeUrl: string;
  };
  requests: UsageCheckResult;
  daily: DailyTokenQuotaStatus;
  monthly: MonthlyTokenQuotaStatus;
  channels: {
    totalConsumed: number;
    openclawUsed: number;
    creditsBalance: number;
  };
}

export interface UnifiedQuotaErrorPayload {
  ok: false;
  code: "TOKEN_QUOTA_EXCEEDED" | "DAILY_TOKEN_LIMIT_EXCEEDED" | "QUOTA_EXCEEDED";
  message: string;
  statusCode: 402;
  quota: {
    unified: true;
    resetAt: string | null;
    monthlyAllowed: boolean;
    dailyAllowed: boolean;
    requestAllowed: boolean;
  };
  billing: {
    unified: true;
    statusUrl: string;
    upgradeUrl: string;
  };
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { dailyRequests: 3, model: "grok-4-1-fast-non-reasoning" },
  go: { dailyRequests: 50, model: "grok-4-1-fast-non-reasoning" },
  plus: { dailyRequests: 200, model: "grok-4-1-fast-non-reasoning" },
  pro: { dailyRequests: -1, model: "grok-4-1-fast-non-reasoning" },
  admin: { dailyRequests: -1, model: "grok-4-1-fast-non-reasoning" },
};

// SECURITY: Admin email moved to environment variable
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_ROLE_SET = new Set(["admin", "superadmin"]);

const DEFAULT_MONTHLY_TOKEN_LIMITS: Record<string, number | null> = {
  free: 100_000,
  go: 1_000_000,
  plus: 5_000_000,
  pro: null,
  business: null,
  enterprise: null,
  admin: null,
};

function normalizeRole(value: unknown): string {
  return String(value || "").toLowerCase().trim();
}

function isSystemAdminUser(user: typeof users.$inferSelect): boolean {
  const email = String(user.email || "").toLowerCase().trim();
  const role = normalizeRole((user as any).role);
  return (ADMIN_EMAIL && email === ADMIN_EMAIL.toLowerCase()) || ADMIN_ROLE_SET.has(role);
}

function addMonths(base: Date, deltaMonths: number): Date {
  const d = new Date(base);
  const day = d.getDate();
  d.setMonth(d.getMonth() + deltaMonths);
  // Preserve end-of-month behavior where possible
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

function toValidDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function getEffectivePlanKey(user: typeof users.$inferSelect, isAdmin: boolean): string {
  if (isAdmin) return "admin";
  const subscriptionStatus = String((user as any).subscriptionStatus || "").toLowerCase().trim();
  const subscriptionPlan = String((user as any).subscriptionPlan || "").toLowerCase().trim();
  const plan = String((user as any).plan || "free").toLowerCase().trim();
  if (subscriptionStatus === "active" && subscriptionPlan) return subscriptionPlan;
  return plan || "free";
}

function getMonthlyTokenLimitTokens(user: typeof users.$inferSelect, planKey: string): number | null {
  const configured = typeof (user as any).monthlyTokenLimit === "number" ? (user as any).monthlyTokenLimit : null;
  if (configured && configured > 0) return configured;
  if (planKey in DEFAULT_MONTHLY_TOKEN_LIMITS) return DEFAULT_MONTHLY_TOKEN_LIMITS[planKey] ?? null;
  return DEFAULT_MONTHLY_TOKEN_LIMITS.free;
}

function getCurrentCycleEnd(user: typeof users.$inferSelect, now: Date): Date {
  const subscriptionPeriodEnd = toValidDate((user as any).subscriptionPeriodEnd);
  let cycleEnd =
    subscriptionPeriodEnd && subscriptionPeriodEnd.getTime() > now.getTime()
      ? subscriptionPeriodEnd
      : new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Ensure the boundary is in the future (handles stale subscriptionPeriodEnd).
  while (cycleEnd.getTime() <= now.getTime()) {
    cycleEnd = addMonths(cycleEnd, 1);
  }

  return cycleEnd;
}

function getNextMidnight(): Date {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow;
}

function normalizeTokenLimit(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isTrackedQuotaUserId(userId: string): boolean {
  const normalized = String(userId || "").trim();
  if (!normalized) return false;
  if (normalized === "anonymous" || normalized === "openclaw-user") return false;
  if (normalized.startsWith("token:") || normalized.startsWith("anon_")) return false;
  return true;
}

export class UsageQuotaService {
  async validateUnifiedQuota(
    userId: string,
    estimatedInputTokens = 0,
  ): Promise<
    | { allowed: true }
    | {
        allowed: false;
        payload: UnifiedQuotaErrorPayload;
      }
  > {
    if (!isTrackedQuotaUserId(userId)) {
      return { allowed: true };
    }

    // Admin users bypass all quota checks
    const [adminCheck] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (adminCheck && isSystemAdminUser(adminCheck)) {
      return { allowed: true };
    }

    const billing = {
      unified: true as const,
      statusUrl: "/api/billing/status",
      upgradeUrl: "/workspace-settings?section=billing",
    };

    const hasMonthlyQuota = await this.hasTokenQuota(userId);
    if (!hasMonthlyQuota) {
      return {
        allowed: false,
        payload: {
          ok: false,
          code: "TOKEN_QUOTA_EXCEEDED",
          message: "Has agotado tu saldo global de tokens. Actualiza tu plan o compra más capacidad para continuar.",
          statusCode: 402,
          quota: {
            unified: true,
            resetAt: null,
            monthlyAllowed: false,
            dailyAllowed: true,
            requestAllowed: true,
          },
          billing,
        },
      };
    }

    const dailyQuota = await this.getDailyTokenQuotaStatus(userId, estimatedInputTokens);
    if (!dailyQuota.allowed) {
      return {
        allowed: false,
        payload: {
          ok: false,
          code: "DAILY_TOKEN_LIMIT_EXCEEDED",
          message:
            dailyQuota.message ||
            "Has alcanzado tu límite diario de tokens. Espera al reinicio o mejora el plan para continuar.",
          statusCode: 402,
          quota: {
            unified: true,
            resetAt: dailyQuota.resetAt?.toISOString?.() || null,
            monthlyAllowed: true,
            dailyAllowed: false,
            requestAllowed: true,
          },
          billing,
        },
      };
    }

    const requestQuota = await this.checkAndIncrementUsage(userId);
    if (!requestQuota.allowed) {
      return {
        allowed: false,
        payload: {
          ok: false,
          code: "QUOTA_EXCEEDED",
          message:
            requestQuota.message ||
            "Has alcanzado el límite operativo de tu cuenta. Actualiza tu plan para continuar.",
          statusCode: 402,
          quota: {
            unified: true,
            resetAt: requestQuota.resetAt?.toISOString?.() || null,
            monthlyAllowed: true,
            dailyAllowed: true,
            requestAllowed: false,
          },
          billing,
        },
      };
    }

    return { allowed: true };
  }

  async checkAndIncrementUsage(userId: string): Promise<UsageCheckResult> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));

    if (!user) {
      return {
        allowed: false,
        remaining: 0,
        limit: 0,
        resetAt: null,
        plan: "free",
        message: "Usuario no encontrado"
      };
    }

    // Use effective plan key (subscription-aware) to avoid free-tier limits for paying users
    const isAdmin = isSystemAdminUser(user);
    const plan = getEffectivePlanKey(user, isAdmin);
    const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    if (isAdmin || planLimits.dailyRequests === -1) {
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        resetAt: null,
        plan
      };
    }

    const now = new Date();
    const nextReset = getNextMidnight();

    // FIX: Use atomic SQL operation to prevent race condition
    // This performs the check and increment in a single atomic operation
    const result = await db.execute(sql`
      UPDATE users
      SET
        daily_requests_used = CASE
          WHEN daily_requests_reset_at IS NULL OR NOW() >= daily_requests_reset_at
          THEN 1
          ELSE COALESCE(daily_requests_used, 0) + 1
        END,
        daily_requests_reset_at = CASE
          WHEN daily_requests_reset_at IS NULL OR NOW() >= daily_requests_reset_at
          THEN ${nextReset}
          ELSE daily_requests_reset_at
        END,
        daily_requests_limit = ${planLimits.dailyRequests},
        updated_at = NOW()
      WHERE id = ${userId}
        AND (
          -- Allow if reset needed
          daily_requests_reset_at IS NULL
          OR NOW() >= daily_requests_reset_at
          -- Or if under limit
          OR COALESCE(daily_requests_used, 0) < ${planLimits.dailyRequests}
        )
      RETURNING
        daily_requests_used as used,
        daily_requests_reset_at as reset_at
    `);

    // If no rows updated, user has exceeded limit
    if (result.rows.length === 0) {
      return {
        allowed: false,
        remaining: 0,
        limit: planLimits.dailyRequests,
        resetAt: user.dailyRequestsResetAt,
        plan,
        message: "Has alcanzado el límite diario de solicitudes. Actualiza tu plan para continuar."
      };
    }

    const updatedData = result.rows[0] as { used: number; reset_at: Date };

    return {
      allowed: true,
      remaining: planLimits.dailyRequests - updatedData.used,
      limit: planLimits.dailyRequests,
      resetAt: updatedData.reset_at,
      plan
    };
  }

  async getUsageStatus(userId: string): Promise<UsageCheckResult> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));

    if (!user) {
      return {
        allowed: false,
        remaining: 0,
        limit: 0,
        resetAt: null,
        plan: "free"
      };
    }

    const isAdmin = isSystemAdminUser(user);
    const plan = getEffectivePlanKey(user, isAdmin);
    const isPaid = plan !== "free" && plan !== "admin";
    const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    if (isAdmin || planLimits.dailyRequests === -1) {
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        resetAt: null,
        plan,
        isAdmin,
        isPaid: isPaid || isAdmin
      };
    }

    const now = new Date();
    const resetAt = user.dailyRequestsResetAt;
    let currentUsed = user.dailyRequestsUsed || 0;

    if (!resetAt || now >= resetAt) {
      currentUsed = 0;
    }

    const remaining = planLimits.dailyRequests - currentUsed;

    return {
      allowed: remaining > 0,
      remaining,
      limit: planLimits.dailyRequests,
      resetAt: user.dailyRequestsResetAt,
      plan,
      isAdmin: false,
      isPaid: isPaid
    };
  }

  async updateUserPlan(userId: string, plan: string): Promise<void> {
    const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    await db.update(users)
      .set({
        plan,
        dailyRequestsLimit: planLimits.dailyRequests,
        dailyRequestsUsed: 0,
        dailyRequestsResetAt: null,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));
  }

  async getDailyTokenQuotaStatus(userId: string, estimatedInputTokens = 0): Promise<DailyTokenQuotaStatus> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return {
        allowed: false,
        resetAt: null,
        inputUsed: 0,
        outputUsed: 0,
        totalUsed: 0,
        inputLimit: null,
        outputLimit: null,
        inputRemaining: null,
        outputRemaining: null,
        message: "Usuario no encontrado",
      };
    }

    // Admin users bypass all daily token limits
    if (isSystemAdminUser(user)) {
      return {
        allowed: true,
        resetAt: null,
        inputUsed: 0,
        outputUsed: 0,
        totalUsed: 0,
        inputLimit: null,
        outputLimit: null,
        inputRemaining: null,
        outputRemaining: null,
      };
    }

    const now = new Date();
    const nextReset = getNextMidnight();
    let resetAt = user.dailyTokenUsageResetAt ?? null;
    let inputUsed = user.dailyInputTokensUsed ?? 0;
    let outputUsed = user.dailyOutputTokensUsed ?? 0;

    if (!resetAt || now.getTime() >= resetAt.getTime()) {
      await db
        .update(users)
        .set({
          dailyInputTokensUsed: 0,
          dailyOutputTokensUsed: 0,
          dailyTokenUsageResetAt: nextReset,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      resetAt = nextReset;
      inputUsed = 0;
      outputUsed = 0;
    }

    const inputLimit = normalizeTokenLimit(user.dailyInputTokensLimit);
    const outputLimit = normalizeTokenLimit(user.dailyOutputTokensLimit);
    const inputRemaining = inputLimit === null ? null : Math.max(0, inputLimit - inputUsed);
    const outputRemaining = outputLimit === null ? null : Math.max(0, outputLimit - outputUsed);
    const totalUsed = inputUsed + outputUsed;

    const exceedsInputLimit =
      inputLimit !== null && inputRemaining !== null && estimatedInputTokens > inputRemaining;
    if (exceedsInputLimit) {
      return {
        allowed: false,
        resetAt,
        inputUsed,
        outputUsed,
        totalUsed,
        inputLimit,
        outputLimit,
        inputRemaining,
        outputRemaining,
        message: "El usuario alcanzó su límite diario de tokens de entrada.",
      };
    }

    const exceedsOutputLimit =
      outputLimit !== null && outputRemaining !== null && outputRemaining <= 0;
    if (exceedsOutputLimit) {
      return {
        allowed: false,
        resetAt,
        inputUsed,
        outputUsed,
        totalUsed,
        inputLimit,
        outputLimit,
        inputRemaining,
        outputRemaining,
        message: "El usuario alcanzó su límite diario de tokens de salida.",
      };
    }

    return {
      allowed: true,
      resetAt,
      inputUsed,
      outputUsed,
      totalUsed,
      inputLimit,
      outputLimit,
      inputRemaining,
      outputRemaining,
    };
  }

  async getMonthlyTokenQuotaStatus(userId: string): Promise<MonthlyTokenQuotaStatus> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return {
        allowed: false,
        resetAt: null,
        used: 0,
        limit: 0,
        remaining: 0,
        extraCredits: 0,
        plan: "free",
        isAdmin: false,
        isPaid: false,
        message: "Usuario no encontrado",
      };
    }

    const isAdmin = isSystemAdminUser(user);
    const planKey = getEffectivePlanKey(user, isAdmin);
    const isPaid = isAdmin || !["", "free"].includes(planKey);
    const limitTokens = getMonthlyTokenLimitTokens(user, planKey);
    const now = new Date();
    const cycleEnd = getCurrentCycleEnd(user, now);
    const cycleStart = addMonths(cycleEnd, -1);

    const resetAt = toValidDate((user as any).tokensResetAt);
    let monthlyUsed =
      typeof (user as any).monthlyTokensUsed === "number" && Number.isFinite((user as any).monthlyTokensUsed)
        ? Math.max(0, (user as any).monthlyTokensUsed)
        : 0;

    if (!resetAt) {
      const [usageRow] = await db
        .select({
          tokensIn: sql<number>`COALESCE(SUM(${apiLogs.tokensIn}), 0)`,
          tokensOut: sql<number>`COALESCE(SUM(${apiLogs.tokensOut}), 0)`,
        })
        .from(apiLogs)
        .where(and(eq(apiLogs.userId, userId), gte(apiLogs.createdAt, cycleStart), lt(apiLogs.createdAt, cycleEnd)));

      monthlyUsed = Math.max(0, (usageRow?.tokensIn ?? 0) + (usageRow?.tokensOut ?? 0));

      await db
        .update(users)
        .set({ monthlyTokensUsed: monthlyUsed, tokensResetAt: cycleEnd, updatedAt: new Date() } as any)
        .where(eq(users.id, userId));
    } else if (now.getTime() >= resetAt.getTime()) {
      monthlyUsed = 0;
      await db
        .update(users)
        .set({ monthlyTokensUsed: 0, tokensResetAt: cycleEnd, updatedAt: new Date() } as any)
        .where(eq(users.id, userId));
    }

    const creditSummary = await getBillingCreditSummary(userId, now, db);
    const normalizedExtraCredits = Math.max(0, Number(creditSummary.extraCredits) || 0);
    const remaining =
      limitTokens === null
        ? null
        : Math.max(0, limitTokens + normalizedExtraCredits - monthlyUsed);
    const allowed =
      limitTokens === null ? true : monthlyUsed < limitTokens || normalizedExtraCredits > 0;

    return {
      allowed,
      resetAt: cycleEnd,
      used: monthlyUsed,
      limit: limitTokens,
      remaining,
      extraCredits: normalizedExtraCredits,
      plan: planKey,
      isAdmin,
      isPaid,
      message:
        allowed || limitTokens === null
          ? undefined
          : "Has agotado tu saldo global mensual de tokens. Actualiza tu plan o compra más capacidad.",
    };
  }

  async hasTokenQuota(userId: string): Promise<boolean> {
    const snapshot = await this.getMonthlyTokenQuotaStatus(userId);
    return snapshot.allowed;
  }

  async getUnifiedQuotaSnapshot(userId: string): Promise<UnifiedQuotaSnapshot> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return {
        unified: true,
        userId,
        plan: "free",
        isAdmin: false,
        isPaid: false,
        blockingState: "monthly_token_limit",
        billing: {
          statusUrl: "/api/billing/status",
          upgradeUrl: "/workspace-settings?section=billing",
        },
        requests: {
          allowed: false,
          remaining: 0,
          limit: 0,
          resetAt: null,
          plan: "free",
          message: "Usuario no encontrado",
        },
        daily: {
          allowed: false,
          resetAt: null,
          inputUsed: 0,
          outputUsed: 0,
          totalUsed: 0,
          inputLimit: 0,
          outputLimit: 0,
          inputRemaining: 0,
          outputRemaining: 0,
          message: "Usuario no encontrado",
        },
        monthly: {
          allowed: false,
          resetAt: null,
          used: 0,
          limit: 0,
          remaining: 0,
          extraCredits: 0,
          plan: "free",
          isAdmin: false,
          isPaid: false,
          message: "Usuario no encontrado",
        },
        channels: {
          totalConsumed: 0,
          openclawUsed: 0,
          creditsBalance: 0,
        },
      };
    }

    const [requests, daily, monthly] = await Promise.all([
      this.getUsageStatus(userId),
      this.getDailyTokenQuotaStatus(userId, 0),
      this.getMonthlyTokenQuotaStatus(userId),
    ]);

    const blockingState = !monthly.allowed
      ? "monthly_token_limit"
      : !daily.allowed
      ? "daily_token_limit"
      : !requests.allowed
      ? "request_limit"
      : "ok";

    return {
      unified: true,
      userId,
      plan: monthly.plan,
      isAdmin: monthly.isAdmin,
      isPaid: monthly.isPaid,
      blockingState,
      billing: {
        statusUrl: "/api/billing/status",
        upgradeUrl: "/workspace-settings?section=billing",
      },
      requests,
      daily,
      monthly,
      channels: {
        totalConsumed: Math.max(0, Number((user as any).tokensConsumed || 0)),
        openclawUsed: Math.max(0, Number((user as any).openclawTokensConsumed || 0)),
        creditsBalance: Math.max(0, Number((user as any).creditsBalance || 0)),
      },
    };
  }

  async recordTokenUsage(userId: string, tokens: number): Promise<void> {
    if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return;

    await db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return;

      const isAdmin = isSystemAdminUser(user);
      const planKey = getEffectivePlanKey(user, isAdmin);
      const limitTokens = getMonthlyTokenLimitTokens(user, planKey);
      const now = new Date();
      const cycleEnd = getCurrentCycleEnd(user, now);

      // Atomic: increment lifetime + monthly usage, and keep the current cycle boundary aligned.
      const usageUpdate = await tx.execute(sql`
        UPDATE users
        SET
          tokens_consumed = COALESCE(tokens_consumed, 0) + ${tokens},
          monthly_tokens_used = CASE
            WHEN tokens_reset_at IS NULL OR NOW() >= tokens_reset_at
            THEN ${tokens}
            ELSE COALESCE(monthly_tokens_used, 0) + ${tokens}
          END,
          tokens_reset_at = ${cycleEnd},
          updated_at = NOW()
        WHERE id = ${userId}
        RETURNING monthly_tokens_used as monthly_used
      `);

      if (!usageUpdate?.rows?.length) return;

      const monthlyUsedAfter = Number((usageUpdate.rows[0] as any)?.monthly_used || 0);
      const monthlyUsedBefore = Math.max(0, monthlyUsedAfter - tokens);

      // Charge only the portion of *this call* that exceeded the monthly allowance.
      let overageToCharge = 0;
      if (limitTokens !== null) {
        const overAfter = Math.max(0, monthlyUsedAfter - limitTokens);
        const overBefore = Math.max(0, monthlyUsedBefore - limitTokens);
        overageToCharge = Math.max(0, overAfter - overBefore);
      }

      if (overageToCharge <= 0) return;

      const charged = await consumeBillingCredits(tx as any, userId, overageToCharge, now);

      if (charged > 0) {
        await tx
          .update(users)
          .set({
            creditsBalance: sql<number>`GREATEST(COALESCE(${users.creditsBalance}, 0) - ${charged}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      }
    });
  }

  async recordTokenUsageDetailed(userId: string, inputTokens: number, outputTokens: number): Promise<void> {
    const normalizedInput = Math.max(0, Math.round(Number.isFinite(inputTokens) ? inputTokens : 0));
    const normalizedOutput = Math.max(0, Math.round(Number.isFinite(outputTokens) ? outputTokens : 0));
    const totalTokens = normalizedInput + normalizedOutput;

    if (totalTokens <= 0) return;

    await db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return;

      const isAdmin = isSystemAdminUser(user);
      const planKey = getEffectivePlanKey(user, isAdmin);
      const limitTokens = getMonthlyTokenLimitTokens(user, planKey);
      const now = new Date();
      const cycleEnd = getCurrentCycleEnd(user, now);
      const nextReset = getNextMidnight();

      const usageUpdate = await tx.execute(sql`
        UPDATE users
        SET
          tokens_consumed = COALESCE(tokens_consumed, 0) + ${totalTokens},
          monthly_tokens_used = CASE
            WHEN tokens_reset_at IS NULL OR NOW() >= tokens_reset_at
            THEN ${totalTokens}
            ELSE COALESCE(monthly_tokens_used, 0) + ${totalTokens}
          END,
          daily_input_tokens_used = CASE
            WHEN daily_token_usage_reset_at IS NULL OR NOW() >= daily_token_usage_reset_at
            THEN ${normalizedInput}
            ELSE COALESCE(daily_input_tokens_used, 0) + ${normalizedInput}
          END,
          daily_output_tokens_used = CASE
            WHEN daily_token_usage_reset_at IS NULL OR NOW() >= daily_token_usage_reset_at
            THEN ${normalizedOutput}
            ELSE COALESCE(daily_output_tokens_used, 0) + ${normalizedOutput}
          END,
          daily_token_usage_reset_at = CASE
            WHEN daily_token_usage_reset_at IS NULL OR NOW() >= daily_token_usage_reset_at
            THEN ${nextReset}
            ELSE daily_token_usage_reset_at
          END,
          tokens_reset_at = ${cycleEnd},
          updated_at = NOW()
        WHERE id = ${userId}
        RETURNING monthly_tokens_used as monthly_used
      `);

      if (!usageUpdate?.rows?.length) return;

      const monthlyUsedAfter = Number((usageUpdate.rows[0] as any)?.monthly_used || 0);
      const monthlyUsedBefore = Math.max(0, monthlyUsedAfter - totalTokens);

      let overageToCharge = 0;
      if (limitTokens !== null) {
        const overAfter = Math.max(0, monthlyUsedAfter - limitTokens);
        const overBefore = Math.max(0, monthlyUsedBefore - limitTokens);
        overageToCharge = Math.max(0, overAfter - overBefore);
      }

      if (overageToCharge <= 0) return;

      const charged = await consumeBillingCredits(tx as any, userId, overageToCharge, now);

      if (charged > 0) {
        await tx
          .update(users)
          .set({
            creditsBalance: sql<number>`GREATEST(COALESCE(${users.creditsBalance}, 0) - ${charged}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      }
    });
  }

  async recordOpenClawTokenUsage(userId: string, tokens: number): Promise<void> {
    if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return;
    if (!userId || userId === "openclaw-user") return;

    try {
      await db.execute(sql`
        UPDATE users
        SET
          openclaw_tokens_consumed = COALESCE(openclaw_tokens_consumed, 0) + ${Math.round(tokens)},
          updated_at = NOW()
        WHERE id = ${userId}
      `);
    } catch (err: any) {
      console.error(`[UsageQuota] Failed to record OpenClaw tokens for ${userId}:`, err?.message);
    }
  }

  async recordUnifiedOpenClawUsage(
    userId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    const normalizedInput = Math.max(0, Math.round(Number.isFinite(inputTokens) ? inputTokens : 0));
    const normalizedOutput = Math.max(0, Math.round(Number.isFinite(outputTokens) ? outputTokens : 0));
    const totalTokens = normalizedInput + normalizedOutput;

    if (totalTokens <= 0 || !isTrackedQuotaUserId(userId)) {
      return;
    }

    await Promise.allSettled([
      this.recordTokenUsageDetailed(userId, normalizedInput, normalizedOutput),
      this.recordOpenClawTokenUsage(userId, totalTokens),
    ]);
  }
}

export const usageQuotaService = new UsageQuotaService();
