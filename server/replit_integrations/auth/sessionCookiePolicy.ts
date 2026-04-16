const LOOPBACK_SESSION_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopbackSessionBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl?.trim()) {
    return false;
  }
  try {
    const parsed = new URL(baseUrl);
    return LOOPBACK_SESSION_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveSessionCookieSettings(nodeEnv = process.env.NODE_ENV, baseUrl = process.env.BASE_URL) {
  const isProduction = nodeEnv === "production";
  const isLoopbackProductionLike = isProduction && isLoopbackSessionBaseUrl(baseUrl);

  return {
    httpOnly: true,
    secure: isProduction && !isLoopbackProductionLike,
    sameSite: (isProduction && !isLoopbackProductionLike ? "none" : "lax") as const,
  };
}
