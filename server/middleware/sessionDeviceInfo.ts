import type { Request, Response, NextFunction } from "express";

function ipPrefixFromRequest(req: Request): string {
  const raw = String(req.ip || (req.socket as any)?.remoteAddress || "").replace("::ffff:", "");
  if (!raw) return "";

  // IPv6: keep first 4 groups. IPv4: keep first 3 octets.
  if (raw.includes(":")) return raw.split(":").slice(0, 4).join(":");
  return raw.split(".").slice(0, 3).join(".");
}

/**
 * Best-effort device metadata to help users manage active sessions.
 * Stored on the session object and persisted by connect-pg-simple.
 */
export function sessionDeviceInfoMiddleware(req: Request, _res: Response, next: NextFunction) {
  const session = (req as any)?.session as any;
  if (!session) return next();

  const now = Date.now();
  const ua = String(req.headers["user-agent"] || "");
  // Privacy-preserving IP prefix (enough to recognize a network without storing full IP).
  const ip = ipPrefixFromRequest(req);

  const device = (session.device || {}) as any;

  let changed = false;

  if (typeof device.createdAt !== "number") {
    device.createdAt = now;
    changed = true;
  }

  if (typeof device.userAgent !== "string" || device.userAgent !== ua) {
    device.userAgent = ua;
    changed = true;
  }

  if (typeof device.ip !== "string" || device.ip !== ip) {
    device.ip = ip;
    changed = true;
  }

  // Throttle lastSeenAt updates to reduce DB writes (sessions are persisted in Postgres).
  if (typeof device.lastSeenAt !== "number" || now - device.lastSeenAt > 60_000) {
    device.lastSeenAt = now;
    changed = true;
  }

  if (changed) session.device = device;

  next();
}
