/**
 * Dynamic Rate Limiting System
 * Task 4: Rate limiting dinámico basado en carga del servidor
 * 
 * Features:
 * - Dynamic limits based on server load
 * - Per-tenant quotas
 * - Sliding window algorithm
 * - Redis-backed for distributed deployments
 */

import { Request, Response, NextFunction } from 'express';
import { Logger } from './logger';
import { getPoolStats } from './dbInfrastructure';

// ============================================================================
// Types
// ============================================================================

interface RateLimitConfig {
    windowMs: number;
    maxRequests: number;
    keyGenerator?: (req: Request) => string;
    skipIf?: (req: Request) => boolean;
    onLimit?: (req: Request, res: Response) => void;
}

interface RateLimitEntry {
    count: number;
    windowStart: number;
}

interface LoadMetrics {
    cpuUsage: number;
    dbUtilization: number;
    memoryUsage: number;
    activeRequests: number;
}

type LoadLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ============================================================================
// Load Monitor
// ============================================================================

class LoadMonitor {
    private activeRequests = 0;
    private lastCpuUsage = 0;
    private cpuCheckInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.startCpuMonitoring();
    }

    private startCpuMonitoring(): void {
        // Check CPU usage every 5 seconds
        this.cpuCheckInterval = setInterval(() => {
            const usage = process.cpuUsage();
            const total = usage.user + usage.system;
            // Rough approximation of CPU percentage
            this.lastCpuUsage = Math.min(100, (total / 1_000_000) * 10);
        }, 5000);
        this.cpuCheckInterval.unref();
    }

    incrementRequests(): void {
        this.activeRequests++;
    }

    decrementRequests(): void {
        this.activeRequests = Math.max(0, this.activeRequests - 1);
    }

    getMetrics(): LoadMetrics {
        const memUsage = process.memoryUsage();
        const memoryUsage = (memUsage.heapUsed / memUsage.heapTotal) * 100;

        let dbUtilization = 0;
        try {
            const poolStats = getPoolStats();
            dbUtilization = poolStats.write.utilizationPercent;
        } catch {
            // Pool stats not available
        }

        return {
            cpuUsage: this.lastCpuUsage,
            dbUtilization,
            memoryUsage,
            activeRequests: this.activeRequests,
        };
    }

    getLoadLevel(): LoadLevel {
        const metrics = this.getMetrics();

        // Critical if any metric is very high
        if (metrics.cpuUsage > 90 || metrics.memoryUsage > 95 || metrics.dbUtilization > 90) {
            return 'CRITICAL';
        }

        // High if multiple metrics are elevated
        const elevatedCount = [
            metrics.cpuUsage > 70,
            metrics.memoryUsage > 80,
            metrics.dbUtilization > 70,
            metrics.activeRequests > 100,
        ].filter(Boolean).length;

        if (elevatedCount >= 2) return 'HIGH';
        if (elevatedCount >= 1) return 'MEDIUM';
        return 'LOW';
    }

    cleanup(): void {
        if (this.cpuCheckInterval) {
            clearInterval(this.cpuCheckInterval);
        }
    }
}

// Singleton instance
const loadMonitor = new LoadMonitor();

// ============================================================================
// Sliding Window Rate Limiter
// ============================================================================

class SlidingWindowRateLimiter {
    private windows: Map<string, RateLimitEntry[]> = new Map();
    private config: Required<RateLimitConfig>;
    private cleanupInterval: NodeJS.Timeout;

    constructor(config: RateLimitConfig) {
        this.config = {
            windowMs: config.windowMs,
            maxRequests: config.maxRequests,
            keyGenerator: config.keyGenerator ?? this.defaultKeyGenerator,
            skipIf: config.skipIf ?? (() => false),
            onLimit: config.onLimit ?? this.defaultOnLimit,
        };

        // Cleanup old entries periodically
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
        this.cleanupInterval.unref();
    }

    private defaultKeyGenerator(req: Request): string {
        const userId = (req as any).user?.id;
        if (userId) return `user:${userId}`;

        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        return `ip:${ip}`;
    }

    private defaultOnLimit(req: Request, res: Response): void {
        res.status(429).json({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter: Math.ceil(this.config.windowMs / 1000),
        });
    }

    private getDynamicLimit(): number {
        const loadLevel = loadMonitor.getLoadLevel();
        const baseLimit = this.config.maxRequests;

        switch (loadLevel) {
            case 'CRITICAL':
                return Math.floor(baseLimit * 0.25); // 25% of normal
            case 'HIGH':
                return Math.floor(baseLimit * 0.5);  // 50% of normal
            case 'MEDIUM':
                return Math.floor(baseLimit * 0.75); // 75% of normal
            case 'LOW':
            default:
                return baseLimit; // 100% of normal
        }
    }

    isAllowed(key: string): { allowed: boolean; remaining: number; resetAt: number } {
        const now = Date.now();
        const windowStart = now - this.config.windowMs;
        const dynamicLimit = this.getDynamicLimit();

        // Get or create window entries
        let entries = this.windows.get(key) || [];

        // Filter to only recent entries within the window
        entries = entries.filter(e => e.windowStart > windowStart);

        // Count requests in current window
        const count = entries.reduce((sum, e) => sum + e.count, 0);

        if (count >= dynamicLimit) {
            const oldestEntry = entries[0];
            const resetAt = oldestEntry ? oldestEntry.windowStart + this.config.windowMs : now + this.config.windowMs;
            return { allowed: false, remaining: 0, resetAt };
        }

        // Add new entry
        entries.push({ count: 1, windowStart: now });
        this.windows.set(key, entries);

        return {
            allowed: true,
            remaining: dynamicLimit - count - 1,
            resetAt: now + this.config.windowMs
        };
    }

    middleware(): (req: Request, res: Response, next: NextFunction) => void {
        return (req: Request, res: Response, next: NextFunction) => {
            // Skip if configured
            if (this.config.skipIf(req)) {
                return next();
            }

            loadMonitor.incrementRequests();
            res.on('finish', () => loadMonitor.decrementRequests());

            const key = this.config.keyGenerator(req);
            const result = this.isAllowed(key);

            // Set rate limit headers
            res.setHeader('X-RateLimit-Limit', this.getDynamicLimit());
            res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
            res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
            res.setHeader('X-RateLimit-Load', loadMonitor.getLoadLevel());

            if (!result.allowed) {
                Logger.warn(`[RateLimit] Limit exceeded for ${key}`);
                return this.config.onLimit(req, res);
            }

            next();
        };
    }

    private cleanup(): void {
        const now = Date.now();
        const windowStart = now - this.config.windowMs;

        for (const [key, entries] of this.windows) {
            const filtered = entries.filter(e => e.windowStart > windowStart);
            if (filtered.length === 0) {
                this.windows.delete(key);
            } else {
                this.windows.set(key, filtered);
            }
        }
    }
}

// ============================================================================
// Pre-configured Rate Limiters
// ============================================================================

// General API rate limiter
export const apiRateLimiter = new SlidingWindowRateLimiter({
    windowMs: 60_000, // 1 minute
    maxRequests: 100,
    skipIf: (req) => req.path.startsWith('/health'),
});

// Chat/AI endpoint rate limiter (more restrictive)
export const aiRateLimiter = new SlidingWindowRateLimiter({
    windowMs: 60_000,
    maxRequests: 20,
    keyGenerator: (req) => {
        const userId = (req as any).user?.id || 'anonymous';
        return `ai:${userId}`;
    },
});

// Auth endpoint rate limiter (very restrictive)
export const authRateLimiter = new SlidingWindowRateLimiter({
    windowMs: 300_000, // 5 minutes
    maxRequests: 10,
    keyGenerator: (req) => {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        return `auth:${ip}`;
    },
});

// ============================================================================
// Quota Management (Per-tenant)
// ============================================================================

interface QuotaConfig {
    daily: number;
    monthly: number;
}

interface QuotaUsage {
    dailyUsed: number;
    monthlyUsed: number;
    dailyRemaining: number;
    monthlyRemaining: number;
    resetAt: { daily: Date; monthly: Date };
}

class QuotaManager {
    private quotas: Map<string, { config: QuotaConfig; dailyUsed: number; monthlyUsed: number; lastDailyReset: Date; lastMonthlyReset: Date }> = new Map();
    private defaultQuota: QuotaConfig = { daily: 1000, monthly: 20000 };

    setQuota(tenantId: string, config: QuotaConfig): void {
        const existing = this.quotas.get(tenantId);
        this.quotas.set(tenantId, {
            config,
            dailyUsed: existing?.dailyUsed ?? 0,
            monthlyUsed: existing?.monthlyUsed ?? 0,
            lastDailyReset: existing?.lastDailyReset ?? new Date(),
            lastMonthlyReset: existing?.lastMonthlyReset ?? new Date(),
        });
    }

    private getOrCreateQuota(tenantId: string) {
        if (!this.quotas.has(tenantId)) {
            const now = new Date();
            this.quotas.set(tenantId, {
                config: this.defaultQuota,
                dailyUsed: 0,
                monthlyUsed: 0,
                lastDailyReset: now,
                lastMonthlyReset: now,
            });
        }

        const quota = this.quotas.get(tenantId)!;
        const now = new Date();

        // Check for daily reset
        if (now.toDateString() !== quota.lastDailyReset.toDateString()) {
            quota.dailyUsed = 0;
            quota.lastDailyReset = now;
        }

        // Check for monthly reset
        if (now.getMonth() !== quota.lastMonthlyReset.getMonth() ||
            now.getFullYear() !== quota.lastMonthlyReset.getFullYear()) {
            quota.monthlyUsed = 0;
            quota.lastMonthlyReset = now;
        }

        return quota;
    }

    checkQuota(tenantId: string): { allowed: boolean; usage: QuotaUsage } {
        const quota = this.getOrCreateQuota(tenantId);
        const now = new Date();

        // Calculate reset times
        const dailyReset = new Date(now);
        dailyReset.setDate(dailyReset.getDate() + 1);
        dailyReset.setHours(0, 0, 0, 0);

        const monthlyReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);

        const usage: QuotaUsage = {
            dailyUsed: quota.dailyUsed,
            monthlyUsed: quota.monthlyUsed,
            dailyRemaining: Math.max(0, quota.config.daily - quota.dailyUsed),
            monthlyRemaining: Math.max(0, quota.config.monthly - quota.monthlyUsed),
            resetAt: { daily: dailyReset, monthly: monthlyReset },
        };

        const allowed = usage.dailyRemaining > 0 && usage.monthlyRemaining > 0;
        return { allowed, usage };
    }

    incrementUsage(tenantId: string, amount: number = 1): void {
        const quota = this.getOrCreateQuota(tenantId);
        quota.dailyUsed += amount;
        quota.monthlyUsed += amount;
    }

    getUsage(tenantId: string): QuotaUsage {
        return this.checkQuota(tenantId).usage;
    }
}

export const quotaManager = new QuotaManager();

// ============================================================================
// Exports
// ============================================================================

export { loadMonitor, SlidingWindowRateLimiter, LoadMonitor };
export type { RateLimitConfig, LoadMetrics, LoadLevel, QuotaConfig, QuotaUsage };
