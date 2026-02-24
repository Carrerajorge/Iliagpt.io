
import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { getSecureUserId } from "../lib/anonUserHelper";
import { is2FAEnabled } from "../services/twoFactorAuth";
import { getSettingValue } from "../services/settingsConfigService";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const userId = getSecureUserId(req);
    if (!userId || String(userId).startsWith("anon_")) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
}

/**
 * Middleware to require 2FA verification for accessing sensitive routes.
 * If the user has 2FA enabled in the database, they must have a valid 2FA session.
 * For specific high-security roles (like admin), this can be enforced even if they haven't set it up (forcing them to set it up via another route).
 */
export async function require2FA(req: Request, res: Response, next: NextFunction) {
    try {
        const anyReq = req as any;
        const session = req.session as any;

        const userId = getSecureUserId(req);
        if (!userId || String(userId).startsWith("anon_")) {
            // Not authenticated at all
            return res.status(401).json({ error: "Unauthorized" });
        }

        const requireAdmins2FA = await getSettingValue<boolean>("require_2fa_admins", false);

        // Determine role (best-effort: from req, then DB fallback).
        const role =
            anyReq.user?.role ||
            session?.passport?.user?.role ||
            anyReq.user?.claims?.role ||
            (await storage.getUser(userId))?.role ||
            null;
        const isAdmin = String(role || "").toLowerCase() === "admin";

        const enabled = await is2FAEnabled(userId);
        if (isAdmin && requireAdmins2FA && !enabled) {
            return res.status(403).json({
                error: "2FA Setup Required",
                code: "2FA_SETUP_REQUIRED",
                message: "Administrators must enable 2FA to access this area."
            });
        }

        if (enabled && session?.is2FAVerified) {
            return next();
        }

        if (enabled || (isAdmin && requireAdmins2FA)) {
            return res.status(403).json({
                error: "2FA Verification Required",
                code: "2FA_REQUIRED",
                message: "You must verify your 2FA code to access this resource."
            });
        }

        // 2FA not enabled and not required, proceed.
        return next();
    } catch (error) {
        console.error("[AuthMiddleware] 2FA check error:", error);
        res.status(500).json({ error: "Internal Server Error during security check" });
    }
}

export type RBACRole = "USER" | "MOD" | "ADMIN" | "SYSTEM_AGENT";

const roleHierarchy: Record<RBACRole, number> = {
    USER: 1,
    MOD: 5,
    ADMIN: 10,
    SYSTEM_AGENT: 20
};

/**
 * Middleware to enforce ABAC Strict Role Checks on endpoints.
 */
export function requireRole(minimumRole: RBACRole) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const anyReq = req as any;
            const session = req.session as any;
            const userId = getSecureUserId(req);

            if (!userId || String(userId).startsWith("anon_")) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            let roleStr =
                anyReq.user?.role ||
                session?.passport?.user?.role ||
                anyReq.user?.claims?.role;

            if (!roleStr) {
                const userRec = await storage.getUser(userId);
                roleStr = userRec?.role;
            }

            const role = (String(roleStr || "USER").toUpperCase() as RBACRole);

            const userLevel = roleHierarchy[role] || 0;
            const requiredLevel = roleHierarchy[minimumRole];

            if (userLevel < requiredLevel) {
                return res.status(403).json({
                    error: "Forbidden",
                    message: "You do not have the required permissions to access this resource."
                });
            }

            next();
        } catch (error) {
            console.error("[AuthMiddleware] requireRole error:", error);
            res.status(500).json({ error: "Internal Server Error during permission check" });
        }
    };
}
