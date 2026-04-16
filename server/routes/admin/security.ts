import { Router } from "express";
import { storage } from "../../storage";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { securityAlerts } from "../../services/securityAlerts";
import { securityMonitor } from "../../agent/security/securityMonitor";

const MAX_LIMIT = 500;
const MAX_LIMIT_EXPORT = 5000;
const MAX_AUDIT_LOG_LIMIT = 1000;
const MAX_EXPORT_LIMIT = 10000;
const MAX_TEXT_FILTER_LENGTH = 200;
const MAX_IP_LENGTH = 45;
const MAX_AUDIT_EXPORT_BYTES = 5 * 1024 * 1024;

function getQueryValue(query: unknown): string {
  return typeof query === "string" ? query.trim() : "";
}

function parseQueryLimit(value: unknown, fallback: number, max: number): number {
  const parsed = parseInt(getQueryValue(value), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function parseQueryDate(value: unknown): Date | undefined {
  const raw = getQueryValue(value);
  if (!raw) return undefined;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function sanitizeTextFilter(value: unknown, maxLength = MAX_TEXT_FILTER_LENGTH): string | undefined {
  const normalized = getQueryValue(value).slice(0, maxLength);
  return normalized.length > 0 ? normalized.toLowerCase() : undefined;
}

function parsePageLimit(page: unknown, fallback = 1, max = MAX_LIMIT): number {
  return parsePositiveInt(page, fallback, 1, max);
}

const EXPORT_FORMATS = new Set(["json", "csv"]);

function parsePositiveInt(value: unknown, fallback: number, min = 1, max = MAX_LIMIT): number {
    const parsed = parseInt(String(value || ""), 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.min(parsed, max);
}

function parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    return undefined;
}

export const securityRouter = Router();

// ============================================
// SECURITY HELPERS
// ============================================

/** Security: sanitize error message for client response - never leak internal details */
function safeAdminError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("not found")) return "Resource not found";
    if (msg.includes("timeout")) return "Operation timed out";
    if (msg.includes("permission") || msg.includes("denied")) return "Permission denied";
  }
  return "Internal server error";
}

/** Security: RFC 4180 compliant CSV field escaping to prevent formula injection */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // Security: strip formula injection prefixes (=, +, -, @, \t, \r)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  // RFC 4180: fields with commas, quotes, or newlines must be quoted
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  } else {
    str = '"' + str + '"';
  }
  return str;
}

securityRouter.get("/policies", async (req, res) => {
    try {
        const { type, appliedTo, isEnabled } = req.query;
        let policies = await storage.getSecurityPolicies();

        if (type) {
            policies = policies.filter(p => p.policyType === type);
        }
        if (appliedTo) {
            policies = policies.filter(p => p.appliedTo === appliedTo);
        }
        if (isEnabled !== undefined) {
            const parsedIsEnabled = parseBoolean(isEnabled);
            if (parsedIsEnabled === undefined) {
                return res.status(400).json({ error: "isEnabled must be a boolean" });
            }
            const expected = parsedIsEnabled ? "true" : "false";
            policies = policies.filter(p => String(p.isEnabled).toLowerCase() === expected);
        }

        res.json(policies);
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

securityRouter.post("/policies", async (req, res) => {
    try {
        const { policyName, policyType, rules, priority, appliedTo, createdBy } = req.body;
        if (!policyName || !policyType || !rules) {
            return res.status(400).json({ error: "policyName, policyType, and rules are required" });
        }

        const policy = await storage.createSecurityPolicy({
            policyName,
            policyType,
            rules,
            priority: priority || 0,
            appliedTo: appliedTo || "global",
            createdBy
        });

        await auditLog(req, {
            action: AuditActions.SECURITY_POLICY_CREATED,
            resource: "security_policies",
            resourceId: policy.id,
            details: { policyName, policyType, rules, priority, appliedTo, createdBy: (req as any).user?.email },
            category: "security",
            severity: "warning"
        });

        res.json(policy);
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

securityRouter.put("/policies/:id", async (req, res) => {
    try {
        const previousPolicy = await storage.getSecurityPolicy(req.params.id);
        const policy = await storage.updateSecurityPolicy(req.params.id, req.body);
        if (!policy) {
            return res.status(404).json({ error: "Policy not found" });
        }

        await auditLog(req, {
            action: AuditActions.SECURITY_POLICY_UPDATED,
            resource: "security_policies",
            resourceId: req.params.id,
            details: { 
                changes: req.body,
                previousValues: previousPolicy ? {
                    policyName: previousPolicy.policyName,
                    policyType: previousPolicy.policyType,
                    isEnabled: previousPolicy.isEnabled
                } : null,
                updatedBy: (req as any).user?.email
            },
            category: "security",
            severity: "warning"
        });

        res.json(policy);
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

securityRouter.delete("/policies/:id", async (req, res) => {
    try {
        const existing = await storage.getSecurityPolicy(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: "Policy not found" });
        }

        await storage.deleteSecurityPolicy(req.params.id);

        await auditLog(req, {
            action: AuditActions.SECURITY_POLICY_DELETED,
            resource: "security_policies",
            resourceId: req.params.id,
            details: { 
                deletedPolicy: {
                    policyName: existing.policyName,
                    policyType: existing.policyType
                },
                deletedBy: (req as any).user?.email
            },
            category: "security",
            severity: "critical"
        });

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

securityRouter.patch("/policies/:id/toggle", async (req, res) => {
    try {
        const { isEnabled } = req.body;
        const policy = await storage.toggleSecurityPolicy(req.params.id, isEnabled);
        if (!policy) {
            return res.status(404).json({ error: "Policy not found" });
        }

        await auditLog(req, {
            action: isEnabled ? "security_policy_enable" : "security_policy_disable",
            resource: "security_policies",
            resourceId: req.params.id,
            details: {
                policyName: policy.policyName,
                policyType: policy.policyType,
                appliedTo: policy.appliedTo,
                isEnabled,
            },
            category: "security",
            severity: "warning",
        });

        res.json(policy);
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

securityRouter.get("/audit-logs", async (req, res) => {
    try {
        const {
            action,
            actor,
            userId,
            user_id,
            role,
            category,
            severity,
            exclude_admin,
            excludeAdmin: excludeAdminParam,
            resource,
            date_from,
            date_to,
            status,
            page = "1",
            limit = "50"
        } = req.query;
        const pageNum = parsePageLimit(page, 1, 500);
        const limitNum = parseQueryLimit(limit, 50, 100);

        const dateFrom = parseQueryDate(date_from);
        const dateTo = parseQueryDate(date_to);
        if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
            return res.status(400).json({ error: "date_from must be before or equal to date_to" });
        }

        const parsedAction = sanitizeTextFilter(action);
        const parsedActor = sanitizeTextFilter(actor);
        const parsedUserQuery = sanitizeTextFilter(userId || user_id);
        const parsedRoleQuery = sanitizeTextFilter(role);
        const parsedCategoryQuery = sanitizeTextFilter(category);
        const parsedSeverityQuery = sanitizeTextFilter(severity);
        const normalizedStatus = sanitizeTextFilter(status);
        const excludeAdminRaw = getQueryValue(exclude_admin ?? excludeAdminParam);
        const excludeAdmins = parseBoolean(excludeAdminRaw);
        if (excludeAdminRaw && excludeAdmins === undefined) {
            return res.status(400).json({ error: "exclude_admin must be a boolean" });
        }

        let logs = await storage.getAuditLogs(MAX_AUDIT_LOG_LIMIT);

        if (parsedAction) {
            logs = logs.filter(l => l.action?.toLowerCase().includes(parsedAction));
        }
        if (parsedUserQuery) {
            logs = logs.filter(l => (l.userId ? String(l.userId) : "").toLowerCase().includes(parsedUserQuery));
        }

        if (parsedRoleQuery) {
            logs = logs.filter(l => {
                const details: any = l.details || {};
                const actorRole = details.actorRole ? String(details.actorRole).toLowerCase() : "";
                return actorRole.includes(parsedRoleQuery);
            });
        }

        if (parsedCategoryQuery) {
            logs = logs.filter(l => {
                const details: any = l.details || {};
                const cat = details.category ? String(details.category).toLowerCase() : "";
                return cat.includes(parsedCategoryQuery);
            });
        }

        if (parsedSeverityQuery) {
            logs = logs.filter(l => {
                const details: any = l.details || {};
                const sev = details.severity ? String(details.severity).toLowerCase() : "";
                return sev.includes(parsedSeverityQuery);
            });
        }

        if (excludeAdmins) {
            logs = logs.filter(l => {
                const details: any = l.details || {};
                const actorRole = details.actorRole ? String(details.actorRole).toLowerCase() : "";
                const user = l.userId ? String(l.userId) : "";
                return actorRole !== "admin" && user !== "admin-user-id";
            });
        }

        if (parsedActor) {
            const q = parsedActor;
            logs = logs.filter(l => {
                const id = l.userId ? String(l.userId).toLowerCase() : "";
                const details: any = l.details || {};
                const actorEmail = details.actorEmail || details.email;
                const email = actorEmail ? String(actorEmail).toLowerCase() : "";
                return id.includes(q) || email.includes(q);
            });
        }
        if (normalizedStatus) {
            logs = logs.filter(l => {
                const details: any = l.details || {};
                const statusValue = details.status ? String(details.status).toLowerCase() : "";
                return statusValue === normalizedStatus || String(l.action || "").toLowerCase() === normalizedStatus;
            });
        }

        const resourceQuery = sanitizeTextFilter(resource);
        if (resourceQuery) {
            logs = logs.filter(l => (l.resource || "").toLowerCase() === resourceQuery);
        }
        if (dateFrom) {
            logs = logs.filter(l => l.createdAt && new Date(l.createdAt) >= dateFrom);
        }
        if (dateTo) {
            dateTo.setHours(23, 59, 59, 999);
            logs = logs.filter(l => l.createdAt && new Date(l.createdAt) <= dateTo);
        }

        const total = logs.length;
        const paginatedLogs = logs.slice((pageNum - 1) * limitNum, pageNum * limitNum);

        res.json({
            logs: paginatedLogs,
            data: paginatedLogs, // Backwards compatibility
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

securityRouter.get("/stats", async (req, res) => {
    try {
        const [policies, auditLogs] = await Promise.all([
            storage.getSecurityPolicies(),
            storage.getAuditLogs(MAX_AUDIT_LOG_LIMIT)
        ]);

        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const activePolicies = policies.filter(p => p.isEnabled === "true").length;
        const logsToday = auditLogs.filter(l => l.createdAt && new Date(l.createdAt) >= startOfToday).length;

        const criticalActions = ["login_failed", "blocked", "unauthorized", "security_alert", "permission_denied"];
        const criticalAlerts = auditLogs.filter(l =>
            l.createdAt &&
            new Date(l.createdAt) >= twentyFourHoursAgo &&
            criticalActions.some(a => l.action?.includes(a))
        ).length;

        const severityCounts = {
            info: auditLogs.filter(l => !criticalActions.some(a => l.action?.includes(a)) && !l.action?.includes("warning")).length,
            warning: auditLogs.filter(l => l.action?.includes("warning")).length,
            critical: auditLogs.filter(l => criticalActions.some(a => l.action?.includes(a))).length
        };

        res.json({
            totalPolicies: policies.length,
            activePolicies,
            criticalAlerts24h: criticalAlerts,
            auditEventsToday: logsToday,
            severityCounts,
            policyTypeBreakdown: policies.reduce((acc: Record<string, number>, p) => {
                acc[p.policyType] = (acc[p.policyType] || 0) + 1;
                return acc;
            }, {})
        });
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

securityRouter.get("/logs", async (req, res) => {
    try {
        // Security: cap limit to prevent excessive data retrieval
        const limit = parseQueryLimit(req.query.limit, 100, 1000);
        const logs = await storage.getAuditLogs(limit);
        res.json(logs);
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// GET /api/admin/security/config - Get current security configuration
securityRouter.get("/config", async (req, res) => {
    try {
        const config = {
            csp: {
                enabled: true,
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
                    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
                    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                    imgSrc: ["'self'", "data:", "blob:", "https:"],
                    connectSrc: ["'self'", "https://api.x.ai", "https://generativelanguage.googleapis.com", "wss:", "ws:"]
                }
            },
            cors: {
                enabled: true,
                origins: process.env.CORS_ORIGINS?.split(",") || ["*"],
                credentials: true
            },
            rateLimit: {
                enabled: true,
                windowMs: 60000,
                maxRequests: 100,
                byUser: true,
                byIp: true
            },
            csrf: {
                enabled: true,
                cookieName: "XSRF-TOKEN",
                headerName: "X-CSRF-Token"
            },
            headers: {
                xFrameOptions: "SAMEORIGIN",
                xContentTypeOptions: "nosniff",
                referrerPolicy: "strict-origin-when-cross-origin"
            }
        };

        res.json(config);
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// GET /api/admin/security/threats - Get recent threat analysis
securityRouter.get("/threats", async (req, res) => {
    try {
        const auditLogs = await storage.getAuditLogs(1000);
        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const recentLogs = auditLogs.filter(l => 
            l.createdAt && new Date(l.createdAt) >= last24h
        );

        // Analyze threats
        const loginFailures = recentLogs.filter(l => l.action?.includes("login_failed"));
        const blockedRequests = recentLogs.filter(l => l.action?.includes("blocked") || l.action?.includes("rate_limit"));
        const unauthorizedAccess = recentLogs.filter(l => l.action?.includes("unauthorized") || l.action?.includes("403"));

        // Group by IP
        const ipCounts: Record<string, number> = {};
        loginFailures.forEach(l => {
            const ip = l.ipAddress || "unknown";
            ipCounts[ip] = (ipCounts[ip] || 0) + 1;
        });

        const suspiciousIps = Object.entries(ipCounts)
            .filter(([_, count]) => count >= 5)
            .map(([ip, count]) => ({ ip, failedAttempts: count }));

        res.json({
            summary: {
                loginFailures: loginFailures.length,
                blockedRequests: blockedRequests.length,
                unauthorizedAccess: unauthorizedAccess.length,
                totalThreats: loginFailures.length + blockedRequests.length + unauthorizedAccess.length
            },
            suspiciousIps,
            recentThreats: [...loginFailures, ...blockedRequests, ...unauthorizedAccess]
                .slice(0, 20)
                .map(l => ({
                    action: l.action,
                    ip: l.ipAddress,
                    timestamp: l.createdAt,
                    details: l.details
                })),
            period: "24h"
        });
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// POST /api/admin/security/ip/block - Block an IP address
securityRouter.post("/ip/block", async (req, res) => {
    try {
        const { ip, reason, duration } = req.body;
        if (!ip || typeof ip !== "string") {
            return res.status(400).json({ error: "IP address is required" });
        }

        // Security: validate IP format to prevent injection in policy names
        const trimmedIp = ip.trim();
        if (trimmedIp.length > MAX_IP_LENGTH) {
            return res.status(400).json({ error: "IP address is too long" });
        }
        if (!/^[\d.:a-fA-F]{3,45}$/.test(trimmedIp)) {
            return res.status(400).json({ error: "Invalid IP address format" });
        }

        // Create a security policy for the blocked IP
        const policy = await storage.createSecurityPolicy({
            policyName: `Block IP: ${trimmedIp}`,
            policyType: "ip_block",
            rules: { ip, blockedAt: new Date().toISOString(), duration: duration || "permanent" },
            priority: 100,
            appliedTo: "global",
            isEnabled: "true"
        });

        await storage.createAuditLog({
            action: "ip_blocked",
            resource: "security",
            details: { ip, reason, duration }
        });

        res.json({ success: true, policy });
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// DELETE /api/admin/security/ip/unblock/:ip - Unblock an IP address
securityRouter.delete("/ip/unblock/:ip", async (req, res) => {
    try {
        const ip = req.params.ip;
        const policies = await storage.getSecurityPolicies();
        const blockPolicy = policies.find(p => 
            p.policyType === "ip_block" && 
            (p.rules as any)?.ip === ip
        );

        if (!blockPolicy) {
            return res.status(404).json({ error: "IP block policy not found" });
        }

        await storage.deleteSecurityPolicy(blockPolicy.id);

        await storage.createAuditLog({
            action: "ip_unblocked",
            resource: "security",
            details: { ip }
        });

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// GET /api/admin/security/audit-logs/export - Export audit logs as CSV
securityRouter.get("/audit-logs/export", async (req, res) => {
    try {
        const { date_from, date_to, action, limit = String(MAX_LIMIT_EXPORT) } = req.query;
        const format = getQueryValue(req.query.format).toLowerCase() || "csv";
        const requestedLimit = parseQueryLimit(limit, MAX_LIMIT_EXPORT, MAX_EXPORT_LIMIT);

        if (!EXPORT_FORMATS.has(format)) {
            return res.status(400).json({ error: "format must be csv or json" });
        }

        const dateFrom = parseQueryDate(date_from);
        const dateTo = parseQueryDate(date_to);
        if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
            return res.status(400).json({ error: "date_from must be before or equal to date_to" });
        }

        const parsedAction = sanitizeTextFilter(action);
        if (action && !parsedAction) {
            return res.status(400).json({ error: "Invalid action filter" });
        }
        
        let logs = await storage.getAuditLogs(Math.min(requestedLimit, MAX_EXPORT_LIMIT));
        
        // Apply filters
        if (parsedAction) {
            logs = logs.filter(l => l.action?.includes(parsedAction));
        }
        if (dateFrom) {
            logs = logs.filter(l => l.createdAt && new Date(l.createdAt) >= dateFrom);
        }
        if (dateTo) {
            dateTo.setHours(23, 59, 59, 999);
            logs = logs.filter(l => l.createdAt && new Date(l.createdAt) <= dateTo);
        }

        if (logs.length > 0) {
            const estimatedBytes = JSON.stringify(logs).length;
            if (estimatedBytes > MAX_AUDIT_EXPORT_BYTES) {
                logs = logs.slice(0, Math.max(100, Math.floor(logs.length / 2)));
            }
        }
        
        // Log the export action
        await auditLog(req, {
            action: AuditActions.ADMIN_EXPORT_DATA,
            resource: "audit_logs",
            details: { 
                format, 
                recordCount: logs.length,
                exportedBy: (req as any).user?.email 
            },
            category: "security",
            severity: "warning"
        });
        
        if (format === "json") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=audit_logs_${new Date().toISOString().split("T")[0]}.json`);
            return res.json(logs);
        }
        
        // Default: CSV with RFC 4180 compliant quoting + formula injection prevention
        const csvHeaders = ["id", "action", "resource", "resourceId", "userId", "ipAddress", "userAgent", "createdAt", "details"];
        const csvRows = logs.map(log => [
            escapeCsvField(log.id),
            escapeCsvField(log.action),
            escapeCsvField(log.resource || ""),
            escapeCsvField(log.resourceId || ""),
            escapeCsvField(log.userId || ""),
            escapeCsvField(log.ipAddress || ""),
            escapeCsvField((log.userAgent || "").substring(0, 200)),
            escapeCsvField(log.createdAt ? new Date(log.createdAt).toISOString() : ""),
            escapeCsvField(JSON.stringify(log.details || {}).substring(0, 1000)),
        ]);

        const csv = [csvHeaders.join(","), ...csvRows.map(row => row.join(","))].join("\n");
        
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=audit_logs_${new Date().toISOString().split("T")[0]}.csv`);
        res.send(csv);
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// GET /api/admin/security/alerts - Get security alerts
securityRouter.get("/alerts", async (req, res) => {
    try {
        const { limit = "50", unresolved } = req.query;
        const resolvedLimit = parseQueryLimit(limit, 50, 500);
        const resolvedUnresolved = parseBoolean(unresolved);
        if (unresolved && resolvedUnresolved === undefined) {
            return res.status(400).json({ error: "unresolved must be a boolean" });
        }
        const alerts = securityAlerts.getAlerts(
            resolvedLimit,
            resolvedUnresolved ?? false
        );
        res.json({
            alerts,
            stats: securityAlerts.getStats()
        });
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// POST /api/admin/security/alerts/:id/resolve - Resolve an alert
securityRouter.post("/alerts/:id/resolve", async (req, res) => {
    try {
        const success = securityAlerts.resolveAlert(req.params.id);
        if (!success) {
            return res.status(404).json({ error: "Alert not found" });
        }
        
        await auditLog(req, {
            action: "security.alert_resolved",
            resource: "security_alerts",
            resourceId: req.params.id,
            details: { resolvedBy: (req as any).user?.email },
            category: "security",
            severity: "info"
        });
        
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

// GET /api/admin/security/alerts/stats - Get alert statistics
securityRouter.get("/alerts/stats", async (req, res) => {
    try {
        res.json(securityAlerts.getStats());
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

securityRouter.get("/summary", async (_req, res) => {
    try {
        res.json(securityMonitor.getSecuritySummary());
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});

securityRouter.get("/events", async (req, res) => {
    try {
        const limit = parseQueryLimit(req.query.limit, 100, 500);
        const severity = typeof req.query.severity === "string" ? req.query.severity : undefined;
        res.json(securityMonitor.getEvents(limit, severity as any));
    } catch (error: any) {
        res.status(500).json({ error: safeAdminError(error) });
    }
});
