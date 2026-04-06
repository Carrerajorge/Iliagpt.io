import { Router } from "express";
import { storage } from "../../storage";
import { llmGateway } from "../../lib/llmGateway";
import { getRealtimeMetrics, getExtendedDashboardStats } from "../../services/realtimeMetrics";
import { getActiveAdminSessions, getAdminUserAggregateSnapshot, getRecentAdminUsers } from "../../services/adminProjection";

export const dashboardRouter = Router();

// GET /api/admin/dashboard/realtime - Real-time metrics endpoint
dashboardRouter.get("/realtime", async (req, res) => {
    try {
        const metrics = await getRealtimeMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/dashboard/extended - Extended stats with trends
dashboardRouter.get("/extended", async (req, res) => {
    try {
        const stats = await getExtendedDashboardStats();
        res.json(stats);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

dashboardRouter.get("/", async (req, res) => {
    try {
        const [
            userStats,
            userAggregate,
            paymentStats,
            aiModels,
            invoices,
            auditLogs,
            reports,
            settings,
            healthStatus
        ] = await Promise.all([
            storage.getUserStats(),
            getAdminUserAggregateSnapshot(),
            storage.getPaymentStats(),
            storage.getAiModels(),
            storage.getInvoices(),
            storage.getAuditLogs(10),
            storage.getReports(),
            storage.getSettings(),
            llmGateway.healthCheck().catch(() => ({ xai: { available: false }, gemini: { available: false } }))
        ]);

        const totalQueries = userAggregate.totalQueries;
        const pendingInvoices = invoices.filter(i => i.status === "pending").length;
        const paidInvoices = invoices.filter(i => i.status === "paid").length;
        const activeModels = aiModels.filter(m => m.status === "active").length;
        const securityAlerts = auditLogs.filter(l =>
            l.action?.includes("login_failed") || l.action?.includes("blocked")
        ).length;

        res.json({
            users: {
                total: userStats.total,
                active: userStats.active,
                newThisMonth: userStats.newThisMonth
            },
            aiModels: {
                total: aiModels.length,
                active: activeModels,
                providers: [...new Set(aiModels.map(m => m.provider))].length
            },
            payments: {
                total: paymentStats.total,
                thisMonth: paymentStats.thisMonth,
                count: paymentStats.count
            },
            invoices: {
                total: invoices.length,
                pending: pendingInvoices,
                paid: paidInvoices
            },
            analytics: {
                totalQueries,
                avgQueriesPerUser: userStats.total > 0 ? Math.round(totalQueries / userStats.total) : 0
            },
            database: {
                tables: 15,
                status: "healthy"
            },
            security: {
                alerts: securityAlerts,
                status: securityAlerts > 5 ? "warning" : "healthy"
            },
            reports: {
                total: reports.length,
                scheduled: 0 // scheduledReports not linked in storage.getReports()
            },
            settings: {
                total: settings.length,
                categories: [...new Set(settings.map(s => s.category))].length
            },
            systemHealth: {
                xai: (healthStatus as any)?.xai?.available ?? false,
                gemini: (healthStatus as any)?.gemini?.available ?? false,
                uptime: 99.9
            },
            recentActivity: auditLogs.slice(0, 5)
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/dashboard/new-users - Recent user registrations
dashboardRouter.get("/new-users", async (req, res) => {
    try {
        const { hours = "24" } = req.query;
        const hoursNum = Math.max(1, Math.min(24 * 365, parseInt(hours as string, 10) || 24));
        const since = new Date(Date.now() - hoursNum * 60 * 60 * 1000);
        const newUsers = await getRecentAdminUsers(hoursNum, 250);

        res.json({
            newUsers,
            count: newUsers.length,
            since: since.toISOString(),
            hoursAgo: hoursNum
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/dashboard/active-sessions - Currently active users
dashboardRouter.get("/active-sessions", async (req, res) => {
    try {
        const activeSessions = await getActiveAdminSessions(250);

        res.json({
            activeSessions,
            count: activeSessions.length,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/dashboard/user-activity - User activity summary
dashboardRouter.get("/user-activity", async (req, res) => {
    try {
        const { userId } = req.query;
        
        if (!userId) {
            return res.status(400).json({ error: "userId required" });
        }

        const user = await storage.getUser(userId as string);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const conversations = await storage.getConversationsByUserId(userId as string);
        const auditLogs = await storage.getAuditLogsByResourceId(userId as string);

        res.json({
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                plan: user.plan,
                status: user.status,
                createdAt: user.createdAt,
                lastLoginAt: user.lastLoginAt,
                queryCount: user.queryCount,
                tokensConsumed: user.tokensConsumed
            },
            activity: {
                conversationCount: conversations.length,
                recentAuditLogs: auditLogs.slice(0, 10)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Import admin notifications
import { adminNotifications } from "../../services/adminNotifications";

// GET /api/admin/dashboard/notifications - Get admin notifications
dashboardRouter.get("/notifications", async (req, res) => {
    try {
        const { includeRead = "true" } = req.query;
        const notifications = adminNotifications.getAll(includeRead === "true");
        res.json({
            notifications,
            unreadCount: adminNotifications.getUnreadCount()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/dashboard/notifications/:id/read - Mark notification as read
dashboardRouter.post("/notifications/:id/read", async (req, res) => {
    try {
        const success = adminNotifications.markAsRead(req.params.id);
        res.json({ success });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/dashboard/notifications/read-all - Mark all as read
dashboardRouter.post("/notifications/read-all", async (req, res) => {
    try {
        const count = adminNotifications.markAllAsRead();
        res.json({ success: true, markedRead: count });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/admin/dashboard/notifications/:id - Delete notification
dashboardRouter.delete("/notifications/:id", async (req, res) => {
    try {
        const success = adminNotifications.delete(req.params.id);
        res.json({ success });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
