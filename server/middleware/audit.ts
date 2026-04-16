import { Request, Response, NextFunction } from "express";
import { db } from "../db";

import { auditLogs } from "../../shared/schema";
import { getSecureUserId } from "../lib/anonUserHelper";
import { Logger } from "../lib/logger";
import { redactSensitiveData } from "./redactionHelper";

let auditDisabledReason: string | null = null;

function isMissingAuditLogsTableError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const anyErr = err as any;
    const code = anyErr.code;
    const msg = String(anyErr.message || "");

    // Postgres: 42P01 = undefined_table
    if (code === "42P01" && msg.includes("audit_logs")) return true;
    if (msg.includes('relation "audit_logs" does not exist')) return true;
    return false;
}

function maybeDisableAudit(err: unknown) {
    if (auditDisabledReason) return;
    if (!isMissingAuditLogsTableError(err)) return;
    auditDisabledReason = "audit_logs table missing";
    Logger.warn(`[Audit] Disabled audit logging (${auditDisabledReason}). Run migrations to enable audit logs.`);
}

export const auditMiddleware = (action: string, resourceExtractor: (req: Request) => string) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        // Capture the original end function to log after response is sent (optional, but standard for audit)
        // For simplicity, we log on entry or success. Let's log on success (finish).

        res.on("finish", async () => {
            if (res.statusCode >= 200 && res.statusCode < 400) {
                if (auditDisabledReason) return;
                try {
                    const userId = getSecureUserId(req);
                    const resource = resourceExtractor(req);
                    const ipAddress = req.ip || req.socket.remoteAddress;
                    const userAgent = req.get("user-agent");

                    await db.insert(auditLogs).values({
                        userId: userId || null, // Allow anonymous or system actions if needed, or null if not logged in
                        action,
                        resource,
                        details: {
                            method: req.method,
                            url: req.originalUrl,
                            body: req.method !== "GET" ? redactSensitiveData(req.body) : undefined,
                        },
                        ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress,
                        userAgent,
                        createdAt: new Date(),
                    });
                } catch (err) {
                    maybeDisableAudit(err);
                    if (!auditDisabledReason) {
                        Logger.error("Failed to log audit event", err);
                    }
                }
            }
        });

        next();
    };
};

export const logAudit = async (
    userId: string | undefined,
    action: string,
    resource: string,
    details: any = {},
    req?: Request
) => {
    if (auditDisabledReason) return;
    try {
        let ipAddress, userAgent;
        if (req) {
            ipAddress = req.ip || req.socket.remoteAddress;
            userAgent = req.get("user-agent");
        }

        await db.insert(auditLogs).values({
            userId: userId || null,
            action,
            resource,
            details,
            ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress,
            userAgent,
            createdAt: new Date(),
        });
    } catch (err) {
        maybeDisableAudit(err);
        if (!auditDisabledReason) {
            Logger.error("Failed to log manual audit event", err);
        }
    }
};

export const globalAuditMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    // Only log mutations (non-GET)
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
        return next();
    }

    res.on("finish", async () => {
        try {
            if (auditDisabledReason) return;
            const userId = getSecureUserId(req);
            const ipAddress = req.ip || req.socket.remoteAddress;
            const userAgent = req.get("user-agent");

            // We use a safe substring of URL as resource identifier
            const resource = req.baseUrl + req.path;
            const statusCode = res.statusCode;
            const severity =
                statusCode >= 500 ? "error" :
                statusCode >= 400 ? "warning" :
                "info";

            const category =
                resource.startsWith("/api/admin") ? "admin" :
                resource.startsWith("/api/auth") ? "auth" :
                resource.startsWith("/api/stripe") ? "payment" :
                resource.startsWith("/api/payments") ? "payment" :
                resource.startsWith("/api/invoices") ? "payment" :
                resource.startsWith("/api/chats") || resource.startsWith("/api/chat") ? "chat" :
                "user";

            const anyReq = req as any;
            const actorEmail =
                anyReq.user?.claims?.email ||
                anyReq.user?.email ||
                anyReq.session?.passport?.user?.claims?.email ||
                anyReq.session?.passport?.user?.email ||
                null;
            const actorRole = anyReq.user?.role || anyReq.session?.passport?.user?.role || null;
            const requestId = anyReq.requestId || (req.headers["x-request-id"] as string) || null;
            const sessionId = anyReq.sessionID || null;

            await db.insert(auditLogs).values({
                userId: userId || null,
                action: `HTTP_${req.method}`,
                resource: resource.substring(0, 255), // Truncate to fit if needed, though text type is usually fine
                details: {
                    method: req.method,
                    url: req.originalUrl,
                    statusCode,
                    severity,
                    category,
                    actorEmail,
                    actorRole,
                    requestId,
                    sessionId,
                },
                ipAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress,
                userAgent,
                createdAt: new Date(),
            });
        } catch (err) {
            maybeDisableAudit(err);
            if (!auditDisabledReason) {
                Logger.error("Failed to log global audit event", err);
            }
        }
    });
    next();
};
