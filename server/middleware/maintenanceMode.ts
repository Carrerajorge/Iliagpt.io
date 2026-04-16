import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { getActorEmailFromRequest, getActorIdFromRequest, getSettingValue } from "../services/settingsConfigService";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();

function normalizeEmail(email: string | null): string | null {
  if (!email) return null;
  const normalized = String(email).toLowerCase().trim();
  return normalized.length > 0 ? normalized : null;
}

async function isRequestAdmin(req: Request): Promise<boolean> {
  const anyReq = req as any;
  const role =
    anyReq.user?.claims?.role ||
    anyReq.user?.role ||
    anyReq.session?.passport?.user?.claims?.role ||
    anyReq.session?.passport?.user?.role ||
    null;

  if (role === "admin") return true;

  const email = normalizeEmail(getActorEmailFromRequest(req));
  if (ADMIN_EMAIL && email && email === ADMIN_EMAIL) return true;

  const userId = getActorIdFromRequest(req);
  if (!userId && !email) return false;

  try {
    if (userId) {
      const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
      return row?.role === "admin";
    }
    if (email) {
      const [row] = await db
        .select({ role: users.role })
        .from(users)
        .where(sql`LOWER(${users.email}) = ${email}`)
        .limit(1);
      return row?.role === "admin";
    }
  } catch {
    // If DB is unavailable, fall back to session/email checks only.
  }

  return false;
}

const EXEMPT_PREFIXES = [
  // Auth must remain available so admins can log in and disable maintenance.
  "/api/auth",
  "/api/login",
  "/api/callback",

  // Public config endpoint (used by the client to show maintenance UI + branding).
  "/api/settings/public",

  // Admin APIs are still protected by requireAdmin.
  "/api/admin",

  // Keep observability endpoints accessible.
  "/api/health",
  "/api/metrics",
  "/api/status",

  // External webhooks usually rely on signature verification, not session.
  "/api/webhooks",
];

export async function maintenanceModeMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const maintenanceMode = await getSettingValue<boolean>("maintenance_mode", false);
    if (!maintenanceMode) return next();

    const url = req.originalUrl || `${req.baseUrl || ""}${req.path || ""}`;
    if (EXEMPT_PREFIXES.some((p) => url.startsWith(p))) return next();

    // Only block API routes. Static + SPA routes can still render a maintenance view.
    if (!url.startsWith("/api")) return next();

    if (await isRequestAdmin(req)) return next();

    res.status(503).json({
      error: "Maintenance mode enabled",
      code: "MAINTENANCE_MODE",
      maintenance: true,
    });
  } catch {
    // If settings cannot be loaded, do not block traffic.
    next();
  }
}

