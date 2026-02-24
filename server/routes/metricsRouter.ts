/**
 * Real-Time Performance Dashboard Endpoint
 * Task 30: Dashboard de métricas de performance en tiempo real
 */

import { Router, Request, Response } from 'express';
import { getPoolStats } from '../lib/dbInfrastructure';
import { loadMonitor, quotaManager } from '../lib/dynamicRateLimiting';
import { serviceRegistry } from '../lib/serviceMesh';
import { getDatabaseStats, getSlowQueries } from '../lib/queryOptimization';
import { getDbMetricsText } from '../db';

const metricsRouter = Router();

// ============================================================================
// Dashboard Summary Endpoint
// ============================================================================

metricsRouter.get('/dashboard', async (req: Request, res: Response) => {
    try {
        const [dbStats, slowQueries] = await Promise.all([
            getDatabaseStats().catch(() => null),
            getSlowQueries(5).catch(() => []),
        ]);

        const poolStats = getPoolStats();
        const loadMetrics = loadMonitor.getMetrics();
        const serviceHealth = serviceRegistry.getAllHealth();
        const overallStatus = serviceRegistry.getOverallStatus();

        const memoryUsage = process.memoryUsage();
        const uptime = process.uptime();

        res.json({
            timestamp: new Date().toISOString(),
            status: overallStatus.status,

            system: {
                uptime_seconds: Math.floor(uptime),
                uptime_human: formatUptime(uptime),
                memory: {
                    heap_used_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                    heap_total_mb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                    rss_mb: Math.round(memoryUsage.rss / 1024 / 1024),
                    utilization_percent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
                },
                load: loadMetrics,
            },

            database: {
                pools: poolStats,
                stats: dbStats,
                slow_queries: slowQueries,
            },

            services: {
                overall: overallStatus,
                details: serviceHealth,
            },

            performance: {
                recommendations: generateRecommendations(poolStats, loadMetrics, overallStatus),
            },
        });
    } catch (error: any) {
        res.status(500).json({
            error: 'Failed to gather metrics',
            message: error.message
        });
    }
});

// ============================================================================
// Prometheus Metrics Endpoint
// ============================================================================

metricsRouter.get('/prometheus', async (req: Request, res: Response) => {
    try {
        const dbMetrics = await getDbMetricsText();

        // Add custom application metrics
        const loadMetrics = loadMonitor.getMetrics();
        const poolStats = getPoolStats();

        const customMetrics = `
# HELP app_active_requests Current number of active HTTP requests
# TYPE app_active_requests gauge
app_active_requests ${loadMetrics.activeRequests}

# HELP app_cpu_usage_percent Current CPU usage percentage
# TYPE app_cpu_usage_percent gauge
app_cpu_usage_percent ${loadMetrics.cpuUsage}

# HELP app_memory_usage_percent Current heap memory usage percentage
# TYPE app_memory_usage_percent gauge
app_memory_usage_percent ${loadMetrics.memoryUsage}

# HELP db_pool_utilization_percent Database pool utilization
# TYPE db_pool_utilization_percent gauge
db_pool_utilization_percent{pool="write"} ${poolStats.write.utilizationPercent}
db_pool_utilization_percent{pool="read"} ${poolStats.read.utilizationPercent}

# HELP db_pool_total_connections Total connections in pool
# TYPE db_pool_total_connections gauge
db_pool_total_connections{pool="write"} ${poolStats.write.totalCount}
db_pool_total_connections{pool="read"} ${poolStats.read.totalCount}

# HELP db_pool_idle_connections Idle connections in pool
# TYPE db_pool_idle_connections gauge
db_pool_idle_connections{pool="write"} ${poolStats.write.idleCount}
db_pool_idle_connections{pool="read"} ${poolStats.read.idleCount}

# HELP db_pool_waiting_requests Requests waiting for connection
# TYPE db_pool_waiting_requests gauge
db_pool_waiting_requests{pool="write"} ${poolStats.write.waitingCount}
db_pool_waiting_requests{pool="read"} ${poolStats.read.waitingCount}
`;

        res.setHeader('Content-Type', 'text/plain');
        res.send(dbMetrics + customMetrics);
    } catch (error: any) {
        res.status(500).send(`# Error: ${error.message}`);
    }
});

// ============================================================================
// Individual Service Health
// ============================================================================

metricsRouter.get('/health/:service', (req: Request, res: Response) => {
    const { service } = req.params;
    const health = serviceRegistry.getHealth(service);

    if (!health) {
        return res.status(404).json({ error: `Service '${service}' not found` });
    }

    res.json({
        service,
        ...health,
    });
});

// ============================================================================
// Quota Status Endpoint
// ============================================================================

metricsRouter.get('/quota/:tenantId', (req: Request, res: Response) => {
    const { tenantId } = req.params;
    const usage = quotaManager.getUsage(tenantId);

    res.json({
        tenant_id: tenantId,
        usage,
    });
});

// ============================================================================
// Helpers
// ============================================================================

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    return parts.join(' ') || '< 1m';
}

function generateRecommendations(
    poolStats: ReturnType<typeof getPoolStats>,
    loadMetrics: ReturnType<typeof loadMonitor.getMetrics>,
    serviceStatus: ReturnType<typeof serviceRegistry.getOverallStatus>
): string[] {
    const recommendations: string[] = [];

    // Pool utilization
    if (poolStats.write.utilizationPercent > 80) {
        recommendations.push('⚠️ Database pool utilization high (>80%). Consider increasing pool size.');
    }
    if (poolStats.write.waitingCount > 0) {
        recommendations.push('⚠️ Requests waiting for database connections. Increase pool size or optimize queries.');
    }

    // Memory
    if (loadMetrics.memoryUsage > 85) {
        recommendations.push('⚠️ Memory usage high (>85%). Consider scaling or optimizing memory usage.');
    }

    // CPU
    if (loadMetrics.cpuUsage > 70) {
        recommendations.push('⚠️ CPU usage elevated (>70%). Review for CPU-intensive operations.');
    }

    // Services
    if (serviceStatus.unhealthy.length > 0) {
        recommendations.push(`🔴 Unhealthy services: ${serviceStatus.unhealthy.join(', ')}`);
    }
    if (serviceStatus.degraded.length > 0) {
        recommendations.push(`🟡 Degraded services: ${serviceStatus.degraded.join(', ')}`);
    }

    if (recommendations.length === 0) {
        recommendations.push('✅ All systems operating normally');
    }

    return recommendations;
}

export default metricsRouter;
