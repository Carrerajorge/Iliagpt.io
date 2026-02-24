/**
 * Health Check System (#30)
 * Comprehensive health monitoring for all dependencies
 */

import { Router, Request, Response } from 'express';
import { db } from '../db';
import { sql } from 'drizzle-orm';

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface ComponentHealth {
    status: HealthStatus;
    latency?: number;
    message?: string;
    lastChecked: Date;
    details?: Record<string, any>;
}

interface HealthReport {
    status: HealthStatus;
    version: string;
    uptime: number;
    timestamp: Date;
    components: Record<string, ComponentHealth>;
}

// Cache for health check results
let lastHealthCheck: HealthReport | null = null;
let lastCheckTime = 0;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Check database connection
 */
async function checkDatabase(): Promise<ComponentHealth> {
    const start = Date.now();

    try {
        await db.execute(sql`SELECT 1`);
        return {
            status: 'healthy',
            latency: Date.now() - start,
            lastChecked: new Date(),
        };
    } catch (error: any) {
        return {
            status: 'unhealthy',
            latency: Date.now() - start,
            message: error.message,
            lastChecked: new Date(),
        };
    }
}

/**
 * Check Redis connection (if available)
 */
async function checkRedis(): Promise<ComponentHealth> {
    const start = Date.now();

    try {
        // If Redis client is available
        // await redisClient.ping();
        return {
            status: 'healthy',
            latency: Date.now() - start,
            message: 'Redis not configured',
            lastChecked: new Date(),
        };
    } catch (error: any) {
        return {
            status: 'degraded',
            latency: Date.now() - start,
            message: error.message,
            lastChecked: new Date(),
        };
    }
}

/**
 * Check external LLM API
 */
async function checkLLMService(): Promise<ComponentHealth> {
    const start = Date.now();

    try {
        // Just verify API key is configured
        const hasGrok = !!process.env.XAI_API_KEY;
        const hasGemini = !!process.env.GOOGLE_API_KEY;
        const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

        const configured = [hasGrok, hasGemini, hasAnthropic].filter(Boolean).length;

        if (configured === 0) {
            return {
                status: 'unhealthy',
                latency: Date.now() - start,
                message: 'No LLM API keys configured',
                lastChecked: new Date(),
            };
        }

        return {
            status: 'healthy',
            latency: Date.now() - start,
            lastChecked: new Date(),
            details: {
                grok: hasGrok,
                gemini: hasGemini,
                anthropic: hasAnthropic,
            },
        };
    } catch (error: any) {
        return {
            status: 'degraded',
            latency: Date.now() - start,
            message: error.message,
            lastChecked: new Date(),
        };
    }
}

/**
 * Check file storage
 */
async function checkStorage(): Promise<ComponentHealth> {
    const start = Date.now();

    try {
        // Check if storage is accessible
        const hasObjectStorage = !!process.env.OBJECT_STORAGE_BUCKET;

        return {
            status: hasObjectStorage ? 'healthy' : 'degraded',
            latency: Date.now() - start,
            message: hasObjectStorage ? undefined : 'Using local filesystem',
            lastChecked: new Date(),
        };
    } catch (error: any) {
        return {
            status: 'unhealthy',
            latency: Date.now() - start,
            message: error.message,
            lastChecked: new Date(),
        };
    }
}

/**
 * Check memory usage
 */
function checkMemory(): ComponentHealth {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
    const usagePercent = Math.round((used.heapUsed / used.heapTotal) * 100);

    let status: HealthStatus = 'healthy';
    if (usagePercent > 90) status = 'unhealthy';
    else if (usagePercent > 75) status = 'degraded';

    return {
        status,
        lastChecked: new Date(),
        details: {
            heapUsedMB,
            heapTotalMB,
            usagePercent,
            rssMB: Math.round(used.rss / 1024 / 1024),
        },
    };
}

/**
 * Full health check
 */
async function performHealthCheck(): Promise<HealthReport> {
    // Use cache if available
    if (lastHealthCheck && Date.now() - lastCheckTime < CACHE_TTL) {
        return lastHealthCheck;
    }

    const [database, redis, llm, storage] = await Promise.all([
        checkDatabase(),
        checkRedis(),
        checkLLMService(),
        checkStorage(),
    ]);

    const memory = checkMemory();

    const components: Record<string, ComponentHealth> = {
        database,
        redis,
        llm,
        storage,
        memory,
    };

    // Determine overall status
    const statuses = Object.values(components).map(c => c.status);
    let overallStatus: HealthStatus = 'healthy';

    if (statuses.includes('unhealthy')) {
        // Check if critical components are unhealthy
        if (database.status === 'unhealthy') {
            overallStatus = 'unhealthy';
        } else {
            overallStatus = 'degraded';
        }
    } else if (statuses.includes('degraded')) {
        overallStatus = 'degraded';
    }

    const report: HealthReport = {
        status: overallStatus,
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        timestamp: new Date(),
        components,
    };

    // Cache the result
    lastHealthCheck = report;
    lastCheckTime = Date.now();

    return report;
}

/**
 * Health check router
 */
export function createHealthRouter(): Router {
    const router = Router();

    // Simple liveness probe
    router.get('/live', (_req: Request, res: Response) => {
        res.status(200).json({ status: 'ok' });
    });

    // Readiness probe (for Kubernetes)
    router.get('/ready', async (_req: Request, res: Response) => {
        try {
            const health = await performHealthCheck();

            if (health.components.database.status === 'unhealthy') {
                return res.status(503).json({ status: 'not_ready', reason: 'database' });
            }

            res.status(200).json({ status: 'ready' });
        } catch (error) {
            res.status(503).json({ status: 'not_ready', reason: 'check_failed' });
        }
    });

    // Full health report
    router.get('/', async (_req: Request, res: Response) => {
        const health = await performHealthCheck();
        const statusCode = health.status === 'healthy' ? 200 :
            health.status === 'degraded' ? 200 : 503;

        res.status(statusCode).json(health);
    });

    // Individual component check
    router.get('/:component', async (req: Request, res: Response) => {
        const { component } = req.params;
        const health = await performHealthCheck();

        if (!health.components[component]) {
            return res.status(404).json({ error: 'Component not found' });
        }

        res.json(health.components[component]);
    });

    return router;
}

/**
 * Startup checks - verify all dependencies before accepting traffic
 */
export async function performStartupChecks(): Promise<boolean> {
    console.log('🔍 Running startup health checks...');

    const health = await performHealthCheck();

    for (const [name, component] of Object.entries(health.components)) {
        const icon = component.status === 'healthy' ? '✅' :
            component.status === 'degraded' ? '⚠️' : '❌';
        console.log(`  ${icon} ${name}: ${component.status}${component.message ? ` - ${component.message}` : ''}`);
    }

    if (health.status === 'unhealthy') {
        console.error('❌ Startup checks failed. Critical components are unhealthy.');
        return false;
    }

    console.log(`✅ Startup checks passed. Status: ${health.status}`);
    return true;
}
