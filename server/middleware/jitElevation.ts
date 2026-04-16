/**
 * JIT (Just-In-Time) Elevation Middleware
 *
 * Requires re-authentication within a configurable time window
 * for destructive admin operations (user deletion, role changes, impersonation).
 *
 * If the admin hasn't authenticated recently, returns 403 with code
 * 'JIT_ELEVATION_REQUIRED', prompting the frontend to show a re-auth dialog.
 */

import { Request, Response, NextFunction } from "express";

/**
 * Create middleware that requires recent authentication.
 * @param maxAgeMinutes Maximum age of last auth verification (default 15 minutes)
 */
export function requireRecentAuth(maxAgeMinutes: number = 15) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = (req as any).session;
    if (!session) {
      return res.status(403).json({
        error: "Session required",
        code: "SESSION_REQUIRED",
      });
    }

    // Check for recent password verification (set by POST /api/admin/elevate)
    const lastPasswordVerifiedAt = session.lastPasswordVerifiedAt as number | undefined;
    // Also accept privileged session elevation timestamp (break-glass login)
    const elevatedAt = session.privilegedSession?.elevatedAt as number | undefined;

    const lastAuthAt = lastPasswordVerifiedAt || elevatedAt;
    const maxAgeMs = maxAgeMinutes * 60 * 1000;

    if (!lastAuthAt || Date.now() - lastAuthAt > maxAgeMs) {
      return res.status(403).json({
        error: "Re-authentication required for this operation",
        code: "JIT_ELEVATION_REQUIRED",
        maxAgeMinutes,
      });
    }

    next();
  };
}
