/**
 * Safe error message utility — prevents internal error details from leaking to clients.
 * In production, always returns a generic message. In development, returns the real error.
 */

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export function safeErrorMessage(error: unknown, fallback = "Internal server error"): string {
  if (!IS_PRODUCTION && error instanceof Error) return error.message;
  return fallback;
}
