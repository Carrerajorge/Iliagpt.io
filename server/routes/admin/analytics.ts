import { Router } from "express";
import { sql } from "drizzle-orm";
import { dbRead } from "../../db";
import { storage } from "../../storage";
import { llmGateway } from "../../lib/llmGateway";

export const analyticsRouter = Router();

analyticsRouter.get("/", async (req, res) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        const snapshots = await storage.getAnalyticsSnapshots(days);
        res.json(snapshots);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.post("/snapshot", async (req, res) => {
    try {
        const snapshot = await storage.createAnalyticsSnapshot(req.body);
        res.json(snapshot);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/kpi", async (req, res) => {
    try {
        const latestSnapshot = await storage.getLatestKpiSnapshot();
        const [userStats, paymentStats] = await Promise.all([
            storage.getUserStats(),
            storage.getPaymentStats()
        ]);

        const activeUsers = Number(latestSnapshot?.activeUsersNow ?? userStats.active ?? 0);
        const queriesPerMinute = Number(latestSnapshot?.queriesPerMinute ?? 0);
        const tokensConsumed = Number(latestSnapshot?.tokensConsumedToday ?? 0);
        const revenueToday = Number.parseFloat((latestSnapshot?.revenueToday ?? paymentStats.thisMonth ?? "0").toString()) || 0;
        const avgLatency = Number(latestSnapshot?.avgLatencyMs ?? 0);
        const errorRate = Number.parseFloat(latestSnapshot?.errorRatePercentage?.toString() ?? "0") || 0;

        // Map to frontend expected structure
        res.json({
            activeUsers,
            queriesPerMinute,
            tokensConsumed,
            revenueToday,
            avgLatency,
            errorRate,
            activeUsersTrend: activeUsers ? (activeUsers > 0 ? "up" : "neutral") : "neutral",
            queriesTrend: queriesPerMinute ? (queriesPerMinute > 5 ? "up" : "neutral") : "neutral",
            tokensTrend: "up",
            revenueTrend: "up",
            latencyTrend: avgLatency ? (avgLatency > 1000 ? "down" : "up") : "neutral",
            errorRateTrend: errorRate ? (errorRate > 5 ? "down" : "up") : "up",
            updatedAt: latestSnapshot?.createdAt ?? new Date()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/kpis", async (req, res) => {
    try {
        const latestSnapshot = await storage.getLatestKpiSnapshot();

        if (!latestSnapshot) {
            const [userStats, paymentStats] = await Promise.all([
                storage.getUserStats(),
                storage.getPaymentStats()
            ]);

            return res.json({
                activeUsersNow: userStats.active,
                queriesPerMinute: 0,
                tokensConsumedToday: 0,
                revenueToday: paymentStats.thisMonth || "0.00",
                avgLatencyMs: 0,
                errorRatePercentage: "0.00",
                createdAt: new Date()
            });
        }

        res.json(latestSnapshot);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/charts", async (req, res) => {
    try {
        type TimeGranularity = "1h" | "24h" | "7d" | "30d" | "90d" | "1y";

        const granularity = ((req.query.granularity as string) || "24h") as TimeGranularity;
        const validGranularities: TimeGranularity[] = ["1h", "24h", "7d", "30d", "90d", "1y"];
        if (!validGranularities.includes(granularity)) {
            return res.status(400).json({ error: `Invalid granularity. Valid values: ${validGranularities.join(", ")}` });
        }

        const intervalMap: Record<TimeGranularity, number> = {
            "1h": 1 * 60 * 60 * 1000,
            "24h": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
            "30d": 30 * 24 * 60 * 60 * 1000,
            "90d": 90 * 24 * 60 * 60 * 1000,
            "1y": 365 * 24 * 60 * 60 * 1000,
        };

        const truncMap: Record<TimeGranularity, string> = {
            "1h": "minute",
            "24h": "hour",
            "7d": "day",
            "30d": "day",
            "90d": "week",
            "1y": "month",
        };

        const startDate = new Date(Date.now() - intervalMap[granularity]);
        const endDate = new Date();
        const truncUnit = truncMap[granularity];

        const toDate = (value: unknown): Date => {
            if (value instanceof Date) return value;
            return new Date(value as any);
        };

        const formatBucketLabel = (bucket: Date): string => {
            const iso = bucket.toISOString();
            switch (granularity) {
                case "1h":
                    return iso.slice(11, 16); // HH:mm
                case "24h":
                    return `${iso.slice(5, 10)} ${iso.slice(11, 13)}:00`; // MM-DD HH:00
                case "7d":
                case "30d":
                case "90d":
                    return iso.slice(0, 10); // YYYY-MM-DD
                case "1y":
                    return iso.slice(0, 7); // YYYY-MM
                default:
                    return iso;
            }
        };

        const [userGrowthResult, revenueResult, providerAggResult, errorAggResult] = await Promise.all([
            dbRead.execute(sql`
                SELECT
                    date_trunc(${truncUnit}, created_at) as bucket,
                    COUNT(*)::int as users
                FROM users
                WHERE created_at >= ${startDate} AND created_at <= ${endDate}
                GROUP BY 1
                ORDER BY 1 ASC
            `),
            dbRead.execute(sql`
                SELECT
                    date_trunc(${truncUnit}, created_at) as bucket,
                    COALESCE(SUM(amount::numeric), 0)::float as revenue
                FROM payments
                WHERE created_at >= ${startDate} AND created_at <= ${endDate}
                  AND status = 'completed'
                GROUP BY 1
                ORDER BY 1 ASC
            `),
            dbRead.execute(sql`
                SELECT
                    date_trunc(${truncUnit}, window_start) as bucket,
                    COALESCE(provider, 'unknown') as provider,
                    COALESCE(SUM(total_requests), 0)::int as total_requests,
                    COALESCE(SUM(error_count), 0)::int as error_count,
                    COALESCE(SUM(tokens_in), 0)::int as tokens_in,
                    COALESCE(SUM(tokens_out), 0)::int as tokens_out,
                    CASE
                        WHEN COALESCE(SUM(total_requests), 0) > 0 THEN
                            ROUND(
                                SUM(COALESCE(avg_latency, 0) * COALESCE(total_requests, 0))::numeric
                                / NULLIF(SUM(total_requests), 0)
                            )::int
                        ELSE 0
                    END as avg_latency
                FROM provider_metrics
                WHERE window_start >= ${startDate} AND window_start <= ${endDate}
                GROUP BY 1, 2
                ORDER BY 1 ASC, 2 ASC
            `),
            dbRead.execute(sql`
                SELECT
                    date_trunc(${truncUnit}, window_start) as bucket,
                    COALESCE(SUM(error_count), 0)::int as error_count,
                    COALESCE(SUM(total_requests), 0)::int as total_requests
                FROM provider_metrics
                WHERE window_start >= ${startDate} AND window_start <= ${endDate}
                GROUP BY 1
                ORDER BY 1 ASC
            `),
        ]);

        const userGrowth = (userGrowthResult.rows as any[]).map((r) => {
            const bucket = toDate(r.bucket);
            return {
                date: formatBucketLabel(bucket),
                users: Number(r.users || 0),
            };
        });

        const revenueTrend = (revenueResult.rows as any[]).map((r) => {
            const bucket = toDate(r.bucket);
            return {
                date: formatBucketLabel(bucket),
                revenue: Number(r.revenue || 0),
            };
        });

        const modelUsageByBucket = new Map<string, Record<string, any>>();
        const latencyByBucket = new Map<string, Record<string, any>>();
        const tokenConsumptionByBucket = new Map<string, Record<string, any>>();

        for (const row of providerAggResult.rows as any[]) {
            const bucketDate = toDate(row.bucket);
            const key = bucketDate.toISOString();
            const label = formatBucketLabel(bucketDate);
            const provider = String(row.provider || "unknown");

            const usageEntry = modelUsageByBucket.get(key) || { date: label };
            usageEntry[provider] = Number(row.total_requests || 0);
            modelUsageByBucket.set(key, usageEntry);

            const latencyEntry = latencyByBucket.get(key) || { date: label };
            latencyEntry[provider] = Number(row.avg_latency || 0);
            latencyByBucket.set(key, latencyEntry);

            const tokenEntry = tokenConsumptionByBucket.get(key) || { date: label };
            tokenEntry[provider] = Number(row.tokens_in || 0) + Number(row.tokens_out || 0);
            tokenConsumptionByBucket.set(key, tokenEntry);
        }

        const sortByIsoKeyAsc = ([a]: [string, any], [b]: [string, any]) => a.localeCompare(b);

        const modelUsage = Array.from(modelUsageByBucket.entries())
            .sort(sortByIsoKeyAsc)
            .map(([, value]) => value);

        const latencyByProvider = Array.from(latencyByBucket.entries())
            .sort(sortByIsoKeyAsc)
            .map(([, value]) => value);

        const tokenConsumption = Array.from(tokenConsumptionByBucket.entries())
            .sort(sortByIsoKeyAsc)
            .map(([, value]) => value);

        const errorRate = (errorAggResult.rows as any[]).map((r) => {
            const bucket = toDate(r.bucket);
            const total = Number(r.total_requests || 0);
            const errors = Number(r.error_count || 0);
            return {
                date: formatBucketLabel(bucket),
                errorRate: total > 0 ? (errors / total) * 100 : 0,
            };
        });

        res.json({
            userGrowth,
            revenueTrend,
            modelUsage,
            latencyByProvider,
            errorRate,
            tokenConsumption,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/charts/:chartType", async (req, res) => {
    try {
        const { chartType } = req.params;
        const granularity = (req.query.granularity as string) || "24h";

        const validChartTypes = ["userGrowth", "revenue", "modelUsage", "latency", "errors", "tokens"];
        if (!validChartTypes.includes(chartType)) {
            return res.status(400).json({ error: `Invalid chartType. Valid types: ${validChartTypes.join(", ")}` });
        }

        const validGranularities = ["1h", "24h", "7d", "30d", "90d", "1y"];
        if (!validGranularities.includes(granularity)) {
            return res.status(400).json({ error: `Invalid granularity. Valid values: ${validGranularities.join(", ")}` });
        }

        const intervalMap: Record<string, number> = {
            "1h": 1 * 60 * 60 * 1000,
            "24h": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
            "30d": 30 * 24 * 60 * 60 * 1000,
            "90d": 90 * 24 * 60 * 60 * 1000,
            "1y": 365 * 24 * 60 * 60 * 1000,
        };

        const startDate = new Date(Date.now() - intervalMap[granularity]);
        const endDate = new Date();

        let data: any[] = [];

        switch (chartType) {
            case "userGrowth":
                data = await storage.getUserGrowthData(granularity as '1h' | '24h' | '7d' | '30d' | '90d' | '1y');
                break;

            case "revenue":
                const payments = await storage.getPayments();
                const revenueByDate = payments
                    .filter(p => new Date(p.createdAt!) >= startDate)
                    .reduce((acc: Record<string, number>, p) => {
                        const dateKey = new Date(p.createdAt!).toISOString().split("T")[0];
                        acc[dateKey] = (acc[dateKey] || 0) + parseFloat(p.amount || "0");
                        return acc;
                    }, {});
                data = Object.entries(revenueByDate).map(([date, amount]) => ({ date, amount }));
                break;

            case "modelUsage":
                const providerMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
                data = providerMetrics.map(m => ({
                    provider: m.provider,
                    date: m.windowStart,
                    totalRequests: m.totalRequests,
                    tokensIn: m.tokensIn,
                    tokensOut: m.tokensOut
                }));
                break;

            case "latency":
                const latencyMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
                data = latencyMetrics.map(m => ({
                    provider: m.provider,
                    date: m.windowStart,
                    avgLatency: m.avgLatency,
                    p50Latency: m.p50Latency,
                    p95Latency: m.p95Latency,
                    p99Latency: m.p99Latency
                }));
                break;

            case "errors":
                const errorMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
                data = errorMetrics.map(m => ({
                    provider: m.provider,
                    date: m.windowStart,
                    errorCount: m.errorCount,
                    totalRequests: m.totalRequests,
                    errorRate: m.totalRequests ? ((m.errorCount || 0) / m.totalRequests * 100).toFixed(2) : "0.00"
                }));
                break;

            case "tokens":
                const tokenMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
                data = tokenMetrics.map(m => ({
                    provider: m.provider,
                    date: m.windowStart,
                    tokensIn: m.tokensIn,
                    tokensOut: m.tokensOut,
                    totalTokens: (m.tokensIn || 0) + (m.tokensOut || 0)
                }));
                break;
        }

        res.json({
            chartType,
            granularity,
            startDate,
            endDate,
            data
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/performance", async (req, res) => {
    try {
        const latestMetrics = await storage.getLatestProviderMetrics();

        const performanceData = latestMetrics.map(m => ({
            provider: m.provider,
            avgLatency: m.avgLatency || 0,
            p50: m.p50Latency || 0,
            p95: m.p95Latency || 0,
            p99: m.p99Latency || 0,
            successRate: parseFloat(m.successRate || "100"),
            totalRequests: m.totalRequests || 0,
            errorCount: m.errorCount || 0,
            status: parseFloat(m.successRate || "100") >= 99 ? "healthy" :
                parseFloat(m.successRate || "100") >= 95 ? "degraded" : "critical",
            windowStart: m.windowStart,
            windowEnd: m.windowEnd
        }));

        res.json(performanceData);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/costs", async (req, res) => {
    try {
        const budgets = await storage.getCostBudgets();

        const costsWithAlerts = budgets.map(b => {
            const currentSpend = parseFloat(b.currentSpend || "0");
            const budgetLimit = parseFloat(b.budgetLimit || "100");
            const alertThreshold = b.alertThreshold || 80;
            const usagePercent = budgetLimit > 0 ? (currentSpend / budgetLimit) * 100 : 0;

            return {
                provider: b.provider,
                budgetLimit: b.budgetLimit,
                currentSpend: b.currentSpend,
                projectedMonthly: b.projectedMonthly,
                usagePercent: usagePercent.toFixed(2),
                alertThreshold: b.alertThreshold,
                isOverBudget: currentSpend >= budgetLimit,
                isNearThreshold: usagePercent >= alertThreshold,
                alertFlag: currentSpend >= budgetLimit ? "critical" :
                    usagePercent >= alertThreshold ? "warning" : "ok",
                periodStart: b.periodStart,
                periodEnd: b.periodEnd
            };
        });

        res.json(costsWithAlerts);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/funnel", async (req, res) => {
    try {
        const allUsers = await storage.getAllUsers();

        const eventStats = await storage.getAnalyticsEventStats();

        const visitors = eventStats["page_view"] || allUsers.length * 3;
        const signups = allUsers.length;
        const activeUsers = allUsers.filter(u => u.status === "active").length;
        const trialUsers = allUsers.filter(u => u.plan === "free" && u.status === "active").length;
        const proUsers = allUsers.filter(u => u.plan === "pro").length;
        const enterpriseUsers = allUsers.filter(u => u.plan === "enterprise").length;

        const funnel = [
            { stage: "visitors", count: visitors, percentage: 100 },
            { stage: "signups", count: signups, percentage: visitors > 0 ? ((signups / visitors) * 100).toFixed(2) : "0.00" },
            { stage: "active", count: activeUsers, percentage: visitors > 0 ? ((activeUsers / visitors) * 100).toFixed(2) : "0.00" },
            { stage: "trial", count: trialUsers, percentage: visitors > 0 ? ((trialUsers / visitors) * 100).toFixed(2) : "0.00" },
            { stage: "pro", count: proUsers, percentage: visitors > 0 ? ((proUsers / visitors) * 100).toFixed(2) : "0.00" },
            { stage: "enterprise", count: enterpriseUsers, percentage: visitors > 0 ? ((enterpriseUsers / visitors) * 100).toFixed(2) : "0.00" }
        ];

        const conversionRates = {
            visitorsToSignups: visitors > 0 ? ((signups / visitors) * 100).toFixed(2) : "0.00",
            signupsToActive: signups > 0 ? ((activeUsers / signups) * 100).toFixed(2) : "0.00",
            activeToPro: activeUsers > 0 ? ((proUsers / activeUsers) * 100).toFixed(2) : "0.00",
            proToEnterprise: proUsers > 0 ? ((enterpriseUsers / proUsers) * 100).toFixed(2) : "0.00"
        };

        res.json({ funnel, conversionRates });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/logs", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "50",
            provider,
            status,
            model,
            search,
            dateFrom,
            dateTo
        } = req.query as Record<string, string | undefined>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
        const offset = (pageNum - 1) * limitNum;

        const parseDateStart = (value: string | undefined): Date | null => {
            if (!value) return null;
            const trimmed = value.trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
                const d = new Date(`${trimmed}T00:00:00.000Z`);
                return Number.isNaN(d.getTime()) ? null : d;
            }
            const d = new Date(trimmed);
            return Number.isNaN(d.getTime()) ? null : d;
        };

        const parseDateEnd = (value: string | undefined): Date | null => {
            if (!value) return null;
            const trimmed = value.trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
                const d = new Date(`${trimmed}T23:59:59.999Z`);
                return Number.isNaN(d.getTime()) ? null : d;
            }
            const d = new Date(trimmed);
            return Number.isNaN(d.getTime()) ? null : d;
        };

        const conditions: any[] = [];

        if (provider) {
            conditions.push(sql`l.provider = ${provider}`);
        }

        if (model) {
            conditions.push(sql`l.model = ${model}`);
        }

        const startDate = parseDateStart(dateFrom);
        const endDate = parseDateEnd(dateTo);
        if (startDate) {
            conditions.push(sql`l.created_at >= ${startDate}`);
        }
        if (endDate) {
            conditions.push(sql`l.created_at <= ${endDate}`);
        }

        if (status) {
            const statusStr = status.trim();
            if (statusStr === "2xx") {
                conditions.push(sql`l.status_code >= 200 AND l.status_code < 300`);
            } else if (statusStr === "4xx") {
                conditions.push(sql`l.status_code >= 400 AND l.status_code < 500`);
            } else if (statusStr === "5xx") {
                conditions.push(sql`l.status_code >= 500`);
            } else {
                const parsed = parseInt(statusStr, 10);
                if (!Number.isNaN(parsed)) {
                    conditions.push(sql`l.status_code = ${parsed}`);
                }
            }
        }

        if (search && search.trim()) {
            const q = `%${search.trim()}%`;
            conditions.push(sql`
                (
                    COALESCE(l.endpoint, '') ILIKE ${q}
                    OR COALESCE(l.provider, '') ILIKE ${q}
                    OR COALESCE(l.model, '') ILIKE ${q}
                    OR COALESCE(l.error_message, '') ILIKE ${q}
                    OR COALESCE(l.request_preview, '') ILIKE ${q}
                    OR COALESCE(l.response_preview, '') ILIKE ${q}
                    OR COALESCE(u.email, '') ILIKE ${q}
                    OR COALESCE(l.user_id, '') ILIKE ${q}
                )
            `);
        }

        const whereSql = conditions.length
            ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
            : sql``;

        const [logsResult, countResult] = await Promise.all([
            dbRead.execute(sql`
                SELECT
                    l.id,
                    l.created_at as timestamp,
                    l.user_id as user_id,
                    u.email as user_email,
                    l.endpoint,
                    l.method,
                    l.status_code as status,
                    l.latency_ms as latency,
                    l.tokens_in as tokens_in,
                    l.tokens_out as tokens_out,
                    l.model,
                    l.provider,
                    l.request_preview as request_preview,
                    l.response_preview as response_preview,
                    l.error_message as error_message
                FROM api_logs l
                LEFT JOIN users u ON u.id = l.user_id
                ${whereSql}
                ORDER BY l.created_at DESC
                LIMIT ${limitNum}
                OFFSET ${offset}
            `),
            dbRead.execute(sql`
                SELECT COUNT(*)::int as count
                FROM api_logs l
                LEFT JOIN users u ON u.id = l.user_id
                ${whereSql}
            `)
        ]);

        const total = Number((countResult.rows as any[])?.[0]?.count || 0);
        const totalPages = Math.max(1, Math.ceil(total / limitNum));

        const logs = (logsResult.rows as any[]).map((row) => ({
            id: row.id,
            timestamp: row.timestamp,
            user: row.user_email || row.user_id || "Anonymous",
            endpoint: row.endpoint,
            method: row.method,
            status: row.status === null || row.status === undefined ? 0 : Number(row.status),
            latency: row.latency === null || row.latency === undefined ? 0 : Number(row.latency),
            tokensIn: row.tokens_in === null || row.tokens_in === undefined ? null : Number(row.tokens_in),
            tokensOut: row.tokens_out === null || row.tokens_out === undefined ? null : Number(row.tokens_out),
            model: row.model || null,
            provider: row.provider || null,
            requestPreview: row.request_preview || null,
            responsePreview: row.response_preview || null,
            errorMessage: row.error_message || null,
        }));

        res.json({
            logs,
            totalPages,
            page: pageNum,
            limit: limitNum,
            total,
            // Backwards-compatible response shape
            data: logs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages,
            },
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/heatmap", async (req, res) => {
    try {
        const periodDays = Math.max(1, Math.min(parseInt((req.query.days as string) || "7", 10) || 7, 90));
        const startDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

        const result = await dbRead.execute(sql`
            SELECT
                EXTRACT(DOW FROM created_at)::int as day_of_week,
                EXTRACT(HOUR FROM created_at)::int as hour,
                COUNT(*)::int as query_count
            FROM api_logs
            WHERE created_at >= ${startDate}
            GROUP BY 1, 2
            ORDER BY 1, 2
        `);

        const heatmapData: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

        for (const row of result.rows as any[]) {
            const day = Math.max(0, Math.min(6, Number(row.day_of_week)));
            const hour = Math.max(0, Math.min(23, Number(row.hour)));
            heatmapData[day][hour] = Number(row.query_count || 0);
        }

        const maxValue = Math.max(...heatmapData.flat(), 0);
        const normalizedData = heatmapData.map(row =>
            row.map(val => maxValue > 0 ? parseFloat((val / maxValue).toFixed(3)) : 0)
        );

        const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const hourLabels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);

        res.json({
            data: heatmapData,
            // Alias used by some clients
            heatmap: heatmapData,
            normalizedData,
            dayLabels,
            hourLabels,
            maxValue,
            periodDays,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/llm/metrics", async (req, res) => {
    try {
        const metrics = llmGateway.getMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Import analytics tracker
import { analyticsTracker } from "../../services/analyticsTracker";

// GET /api/admin/analytics/realtime - Real-time metrics
analyticsRouter.get("/realtime", async (req, res) => {
    try {
        const metrics = analyticsTracker.getRealTimeMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/analytics/sessions/active - Active sessions
analyticsRouter.get("/sessions/active", async (req, res) => {
    try {
        const minutes = parseInt(req.query.minutes as string) || 5;
        const sessions = analyticsTracker.getActiveSessions(minutes);
        res.json({
            sessions,
            count: sessions.length
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/analytics/track - Track event (for frontend)
analyticsRouter.post("/track", async (req, res) => {
    try {
        const { eventType, sessionId, page, action, metadata } = req.body;
        const userId = (req as any).user?.id;
        
        if (eventType === "page_view") {
            analyticsTracker.trackPageView(userId, sessionId, page, metadata);
        } else if (eventType === "action") {
            analyticsTracker.trackAction(userId, sessionId, action, metadata);
        } else if (eventType === "chat_query") {
            analyticsTracker.trackChatQuery(userId, sessionId, metadata);
        }
        
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
