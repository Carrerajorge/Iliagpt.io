import type { Request } from "express";
import { randomBytes } from "crypto";
import { verifyAnonToken } from "./anonToken";

export function getSecureUserId(req: Request): string | null {
  const user = (req as any).user;
  const authUserId = user?.claims?.sub || user?.id;
  if (authUserId) {
    return authUserId;
  }

  const session = (req as any).session as any | undefined;

  if (session?.authUserId) {
    return session.authUserId;
  }

  const passportUser = session?.passport?.user;
  if (typeof passportUser === "string" && passportUser) {
    return passportUser;
  }
  if (passportUser?.claims?.sub) {
    return passportUser.claims.sub;
  }
  if (passportUser?.id) {
    return passportUser.id;
  }

  const headerUserId = req.headers['x-anonymous-user-id'];
  if (headerUserId && typeof headerUserId === 'string') {
    if (session?.anonUserId && headerUserId === session.anonUserId) {
      return headerUserId;
    }
    const headerToken = req.headers['x-anonymous-token'];
    if (
      typeof headerToken === 'string' &&
      headerToken &&
      verifyAnonToken(headerUserId, headerToken)
    ) {
      if (session) {
        session.anonUserId = headerUserId;
      }
      return headerUserId;
    }
  }

  if (session && !session.anonUserId) {
    const sessionId = (req as any).sessionID;
    if (sessionId) {
      session.anonUserId = `anon_${sessionId}`;
    }
  }

  return session?.anonUserId || null;
}

/**
 * Gets or creates a user ID, ensuring one is always returned.
 * Falls back to a timestamp-based ID if no session is available.
 * 
 * @param req - Express request object
 * @returns User ID string (never null)
 */
export function getOrCreateSecureUserId(req: Request): string {
  const userId = getSecureUserId(req);
  if (userId) {
    return userId;
  }
  
  // Last resort fallback for edge cases where session isn't available.
  // Use crypto.randomBytes instead of Math.random for unpredictable IDs (CodeQL: insecure-randomness).
  return `anon_${randomBytes(16).toString("hex")}`;
}

/**
 * Checks if the current user is authenticated (not anonymous).
 * 
 * @param req - Express request object
 * @returns true if user is authenticated, false if anonymous
 */
export function isAuthenticated(req: Request): boolean {
  const user = (req as any).user;
  if (user?.claims?.sub || user?.id) {
    return true;
  }
  
  // Also check session workaround
  const session = req.session as any;
  if (session?.authUserId) {
    return true;
  }
  const passportUser = session?.passport?.user;
  if (typeof passportUser === "string" && passportUser) {
    return true;
  }
  if (passportUser?.claims?.sub || passportUser?.id) {
    return true;
  }
  
  return false;
}

/**
 * Gets the authenticated user's email if available.
 * 
 * @param req - Express request object
 * @returns Email string or null if anonymous/unavailable
 */
export function getAuthEmail(req: Request): string | null {
  const user = (req as any).user;
  return user?.claims?.email || null;
}
