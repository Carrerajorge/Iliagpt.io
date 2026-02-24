import type { Request, Response, NextFunction } from "express";
import { getSettingValue } from "../services/settingsConfigService";

// Applies the configured session timeout to the current session cookie.
// Note: The session store TTL may be higher; the cookie maxAge is the effective
// client-side expiration. This middleware allows runtime changes without restart.
export async function sessionTimeoutMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const anyReq = req as any;
    const session = anyReq.session as any;
    if (!session?.cookie) return next();

    const minutesRaw = await getSettingValue<number>("session_timeout_minutes", 1440);
    const minutes = Number.isFinite(minutesRaw) ? Math.max(5, Math.floor(minutesRaw)) : 1440;
    session.cookie.maxAge = minutes * 60 * 1000;
  } catch {
    // If settings are unavailable (e.g. DB down), keep existing session defaults.
  }

  next();
}

