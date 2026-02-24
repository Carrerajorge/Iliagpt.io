import type { Request } from "express";
import { randomBytes } from "crypto";

/**
 * Securely retrieves the user ID from a request.
 * 
 * For authenticated users: returns the authenticated user's ID.
 * For anonymous users: returns a session-bound anonymous ID.
 * 
 * SECURITY: The X-Anonymous-User-Id header is ONLY trusted if it matches
 * the session-bound ID. This prevents impersonation attacks where malicious
 * clients send arbitrary anon_* IDs in headers.
 * 
 * @param req - Express request object
 * @returns User ID string or null if unable to determine
 */
export function getSecureUserId(req: Request): string | null {
  // 1. Try authenticated user first (Passport puts user here after deserialize)
  const user = (req as any).user;
  const authUserId = user?.claims?.sub || user?.id;
  if (authUserId) {
    return authUserId;
  }

  // `req.session` is only present if express-session middleware has run.
  // This helper is called very early (e.g. request logger), so it must be
  // resilient to missing session middleware.
  const session = (req as any).session as any | undefined;

  // 1.5 Check session.authUserId (workaround for Passport serialization issues)
  if (session?.authUserId) {
    return session.authUserId;
  }

  // 1.6 Check session.passport.user for user info
  const passportUser = session?.passport?.user;
  // Many Passport setups serialize just the user id (string).
  if (typeof passportUser === "string" && passportUser) {
    return passportUser;
  }
  if (passportUser?.claims?.sub) {
    return passportUser.claims.sub;
  }
  if (passportUser?.id) {
    return passportUser.id;
  }

  // 2. Check X-Anonymous-User-Id header ONLY if it matches session-bound ID
  const headerUserId = req.headers['x-anonymous-user-id'];
  if (
    headerUserId &&
    typeof headerUserId === 'string' &&
    session?.anonUserId &&
    headerUserId === session.anonUserId
  ) {
    return headerUserId;
  }

  // 3. Fallback to session-bound ID or generate new one
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
