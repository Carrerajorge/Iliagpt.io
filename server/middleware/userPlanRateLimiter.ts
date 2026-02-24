/**
 * User Plan Rate Limiter (Mejora #6 - Fase 2)
 *
 * Implementa límites de uso diferenciados por plan de suscripción:
 *   - free:       20 req/min  | 400 req/day
 *   - pro:        100 req/min | 5000 req/day
 *   - enterprise: 500 req/min | unlimited
 *
 * Usa Sliding Window en Redis cuando está disponible, con fallback a memoria.
 * Este limiter se aplica SOLO a endpoints de IA (/api/chat, /api/agent, etc.)
 */

import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import type { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis";
import { storage } from "../storage";

// ─── Configuración de Planes ─────────────────────────────────────────────────

interface PlanLimits {
    requestsPerMinute: number;
    requestsPerDay: number | null; // null = sin límite
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
    free: { requestsPerMinute: 20, requestsPerDay: 400 },
    pro: { requestsPerMinute: 100, requestsPerDay: 5000 },
    enterprise: { requestsPerMinute: 500, requestsPerDay: null },
    // Fallback por defecto (usuarios no autenticados comparten límite anon)
    anonymous: { requestsPerMinute: 10, requestsPerDay: 100 },
};

// ─── Cache de Limiters por Plan ──────────────────────────────────────────────

const minuteLimiters = new Map<string, RateLimiterRedis | RateLimiterMemory>();
const dayLimiters = new Map<string, RateLimiterRedis | RateLimiterMemory>();

function getLimiterForPlan(
    plan: string,
    window: "minute" | "day",
): RateLimiterRedis | RateLimiterMemory {
    const cache = window === "minute" ? minuteLimiters : dayLimiters;
    if (cache.has(plan)) return cache.get(plan)!;

    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS["free"];
    const points =
        window === "minute"
            ? limits.requestsPerMinute
            : (limits.requestsPerDay ?? 999999);
    const duration = window === "minute" ? 60 : 86400;

    let limiter: RateLimiterRedis | RateLimiterMemory;

    // Reutilizamos el cliente ioredis (ya conectado) del módulo redis.ts
    // RateLimiterRedis acepta clientes ioredis
    try {
        limiter = new RateLimiterRedis({
            storeClient: redis as any,
            keyPrefix: `plan_rl_${plan}_${window}`,
            points,
            duration,
            insuranceLimiter: new RateLimiterMemory({ points, duration }),
        });
    } catch {
        limiter = new RateLimiterMemory({ points, duration });
    }

    cache.set(plan, limiter);
    return limiter;
}

// ─── Resolución de Plan por Usuario ─────────────────────────────────────────

/** Obtiene el plan del usuario desde la DB (con caché in-memory de 5 min). */
const userPlanCache = new Map<string, { plan: string; cachedAt: number }>();
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

async function getUserPlan(userId: string | null): Promise<string> {
    if (!userId) return "anonymous";

    const cached = userPlanCache.get(userId);
    if (cached && Date.now() - cached.cachedAt < PLAN_CACHE_TTL_MS) {
        return cached.plan;
    }

    try {
        const user = await storage.getUser(userId);
        // Busca el campo plan/role en la DB (adaptar según el schema real)
        const plan = (user as any)?.plan || (user as any)?.subscriptionTier || "free";
        const normalized =
            ["free", "pro", "enterprise"].includes(plan) ? plan : "free";
        userPlanCache.set(userId, { plan: normalized, cachedAt: Date.now() });
        return normalized;
    } catch {
        return "free";
    }
}

// ─── Función de Key ─────────────────────────────────────────────────────────

function resolveUserId(req: Request): string | null {
    const session = (req as any).session;
    if (session?.authUserId) return String(session.authUserId);
    if (session?.anonUserId) return null; // anon queues into anonymous plan
    const user = (req as any).user;
    return user?.claims?.sub || user?.id || null;
}

// ─── Middleware Principal ────────────────────────────────────────────────────

/**
 * Middleware de rate limiting diferenciado por plan.
 * Para rutas de IA donde queremos granularidad por usuario.
 */
export const planBasedRateLimiter = async (
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    const userId = resolveUserId(req);
    const plan = await getUserPlan(userId);

    const keyBase = userId ? `user:${userId}` : `ip:${req.ip || "unknown"}`;
    const minuteLimiter = getLimiterForPlan(plan, "minute");
    const dayLimiter = getLimiterForPlan(plan, "day");

    try {
        await minuteLimiter.consume(keyBase);

        // Limits.requestsPerDay === null means unlimited
        const limits = PLAN_LIMITS[plan] || PLAN_LIMITS["free"];
        if (limits.requestsPerDay !== null) {
            await dayLimiter.consume(keyBase);
        }

        // Attach plan info to request for downstream use
        (req as any).userPlan = plan;
        next();
    } catch (rateLimiterRes) {
        const rl = rateLimiterRes as RateLimiterRes;
        const retryAfterSec = Math.round((rl?.msBeforeNext || 60000) / 1000);

        res.setHeader("Retry-After", String(retryAfterSec));
        res.setHeader("X-RateLimit-Plan", plan);
        res.setHeader("X-RateLimit-Remaining", "0");
        res.setHeader("X-RateLimit-Reset", String(Math.ceil(Date.now() / 1000) + retryAfterSec));

        const isDaily = retryAfterSec > 120;
        res.status(429).json({
            status: "error",
            message: isDaily
                ? `Has alcanzado el límite diario de tu plan ${plan}. Considera mejorar tu plan.`
                : `Demasiadas solicitudes. Por favor espera ${retryAfterSec}s.`,
            retryAfter: retryAfterSec,
            plan,
            upgradeHint: plan === "free" || plan === "anonymous" ? "/plans" : null,
        });
    }
};

/** Invalida la caché del plan de un usuario (llamar cuando cambia el plan). */
export function invalidateUserPlanCache(userId: string): void {
    userPlanCache.delete(userId);
}
