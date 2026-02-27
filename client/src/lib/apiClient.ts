import { getStoredAnonUserId, getStoredAnonToken } from "@/hooks/use-auth";
import { getCsrfToken, setInMemoryCsrfToken } from "@/lib/csrfTokenStore";

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function resolveSafeUrl(url: string): string {
  const target = new URL(url, window.location.origin);
  if (target.origin !== window.location.origin) {
    throw new Error("Cross-origin requests are not allowed");
  }
  return target.toString();
}

function isLocalHostname(hostname: string): boolean {
  const host = (hostname || "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return true;
  }
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    return false;
  }
  const a = Number(ipv4Match[1]);
  const b = Number(ipv4Match[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isLikelyNetworkFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  if (error instanceof TypeError) {
    return true;
  }
  return /failed to fetch|networkerror|load failed|request timeout|network request failed/i.test(message);
}

function buildDevApiFallbackUrls(safeUrl: string): string[] {
  if (typeof window === "undefined" || !import.meta.env.DEV) {
    return [];
  }

  const parsed = new URL(safeUrl);
  if (!parsed.pathname.startsWith("/api/")) {
    return [];
  }

  const current = new URL(window.location.href);
  if (!isLocalHostname(current.hostname)) {
    return [];
  }

  const defaultPort = current.protocol === "https:" ? "443" : "80";
  const currentPort = current.port || defaultPort;
  const pathWithQuery = `${parsed.pathname}${parsed.search}`;
  const ports = ["5000", "5002", "5050"];
  const hosts = Array.from(new Set([current.hostname, "localhost", "127.0.0.1"]));

  const urls: string[] = [];
  for (const host of hosts) {
    for (const port of ports) {
      if (host === current.hostname && port === currentPort) {
        continue;
      }
      urls.push(`${current.protocol}//${host}:${port}${pathWithQuery}`);
    }
  }
  return urls;
}

function generateRequestId(): string {
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `req_${now}_${crypto.randomUUID()}`;
  }
  return `req_${now}_${random}`;
}

export async function apiFetch(url: string, options: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const safeUrl = resolveSafeUrl(url);
  const anonUserId = getStoredAnonUserId();
  const anonToken = getStoredAnonToken();

  const { timeoutMs, headers: optionsHeaders, ...fetchOptions } = options;
  const headers = new Headers(optionsHeaders);

  if (anonUserId) {
    headers.set("X-Anonymous-User-Id", anonUserId);
  }
  if (anonToken) {
    headers.set("X-Anonymous-Token", anonToken);
  }

  const csrfToken = getCsrfToken();

  if (csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const existingRequestId = headers.get("X-Request-Id") || headers.get("x-request-id");
  const requestId = existingRequestId || generateRequestId();
  if (!existingRequestId) {
    headers.set("X-Request-Id", requestId);
  }
  if (!headers.has("X-Correlation-Id") && !headers.has("x-correlation-id")) {
    headers.set("X-Correlation-Id", requestId);
  }

  // T100-5.1: FinOps Distributed Tracing (Observabilidad de Rutas de Alto Costo)
  const highCostRoutes = ["/api/chat", "/api/agent", "/api/gemini/chat", "/api/documents/extract"];
  if (highCostRoutes.some(route => safeUrl.includes(route))) {
    console.debug(`[FinOps Trace] 💸 Red de Alto Costo Triggered -> Route: ${safeUrl} | Correlation-ID: ${requestId} | Esperando métricas de Token Ledger...`);
  }

  const finalOptions: RequestInit = {
    ...fetchOptions,
    headers,
    credentials: "include",
  };
  const fallbackUrls = buildDevApiFallbackUrls(safeUrl);
  const runFetch = async (targetUrl: string): Promise<Response> => {
    const fetchPromise = fetch(targetUrl, finalOptions);
    if (timeoutMs && timeoutMs > 0) {
      const timeoutPromise = new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new Error("Request timeout")), timeoutMs);
      });
      return Promise.race([fetchPromise, timeoutPromise]);
    }
    return fetchPromise;
  };

  try {
    const primaryResponse = await runFetch(safeUrl);
    if (!getCsrfToken()) {
      const cookieAfterResponse = getCookie("XSRF-TOKEN");
      if (cookieAfterResponse) {
        setInMemoryCsrfToken(cookieAfterResponse);
      }
    }
    const shouldRetryGatewayResponse =
      fallbackUrls.length > 0 &&
      import.meta.env.DEV &&
      primaryResponse.status >= 500;
    if (!shouldRetryGatewayResponse) {
      return primaryResponse;
    }

    for (const fallbackUrl of fallbackUrls) {
      try {
        return await runFetch(fallbackUrl);
      } catch {
        // Continue trying fallback candidates.
      }
    }

    return primaryResponse;
  } catch (primaryError) {
    if (!isLikelyNetworkFailure(primaryError) || fallbackUrls.length === 0) {
      throw primaryError;
    }

    let lastError: unknown = primaryError;
    for (const fallbackUrl of fallbackUrls) {
      try {
        return await runFetch(fallbackUrl);
      } catch (fallbackError) {
        lastError = fallbackError;
      }
    }
    throw lastError;
  }
}

export function getAnonUserIdHeader(): Record<string, string> {
  const anonUserId = getStoredAnonUserId();
  const anonToken = getStoredAnonToken();
  const headers: Record<string, string> = {};
  if (anonUserId) {
    headers["X-Anonymous-User-Id"] = anonUserId;
  }
  if (anonToken) {
    headers["X-Anonymous-Token"] = anonToken;
  }

  const csrfTokenForHeaders = getCsrfToken();

  if (csrfTokenForHeaders) {
    headers["X-CSRF-Token"] = csrfTokenForHeaders;
  }

  return headers;
}
