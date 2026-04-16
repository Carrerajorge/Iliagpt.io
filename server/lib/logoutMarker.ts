import type { Request, Response, CookieOptions } from "express";
import { parse as parseCookie } from "cookie";

export const LOGOUT_MARKER_COOKIE = "siragpt.logged_out";
const LOGOUT_MARKER_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCookieOptions(): CookieOptions {
  const isProduction = process.env.NODE_ENV === "production" || !!process.env.REPL_SLUG;
  const isReplitDeployment = !!process.env.REPL_SLUG;

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isReplitDeployment ? "none" : "lax",
    path: "/",
  };
}

export function setLogoutMarker(res: Response): void {
  res.cookie(LOGOUT_MARKER_COOKIE, "1", {
    ...getCookieOptions(),
    maxAge: LOGOUT_MARKER_TTL_MS,
  });
}

export function clearLogoutMarker(res: Response): void {
  res.clearCookie(LOGOUT_MARKER_COOKIE, getCookieOptions());
}

export function hasLogoutMarker(req: Request): boolean {
  const reqAny = req as Request & { cookies?: Record<string, string> };
  if (reqAny.cookies?.[LOGOUT_MARKER_COOKIE] === "1") {
    return true;
  }

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return false;
  }

  try {
    const parsed = parseCookie(cookieHeader);
    return parsed[LOGOUT_MARKER_COOKIE] === "1";
  } catch {
    return false;
  }
}
