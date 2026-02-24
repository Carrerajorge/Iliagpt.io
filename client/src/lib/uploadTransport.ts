import type { UploadSecurityContract } from "@shared/uploadContracts";
import { apiFetch } from "@/lib/apiClient";

type UploadHeaders = Record<string, string>;

interface UploadTransportOptions {
  headers?: UploadHeaders;
  signal?: AbortSignal;
  timeoutMs?: number;
  requireCsrf?: boolean;
  skipContentType?: boolean;
}

const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
const CSRF_REFRESH_TIMEOUT_MS = 8_000;
const CSRF_REFRESH_RETRY_ATTEMPTS = 2;
const SECURITY_CONTRACT_TTL_MS = 5 * 60 * 1000;

let csrfRefreshInFlight: Promise<void> | null = null;
let uploadSecurityContractCache:
  | { fetchedAt: number; csrfRequired: boolean }
  | null = null;
let uploadSecurityContractInFlight: Promise<{ fetchedAt: number; csrfRequired: boolean } | null> | null = null;

export function resolveUploadUrlForResponse(uploadUrl: string, responseUrl?: string): string {
  if (!uploadUrl || !responseUrl || typeof window === "undefined") {
    return uploadUrl;
  }

  const isAbsolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uploadUrl);
  if (isAbsolute) {
    return uploadUrl;
  }

  try {
    const responseOrigin = new URL(responseUrl, window.location.href).origin;
    if (!responseOrigin || responseOrigin === window.location.origin) {
      return uploadUrl;
    }
    return new URL(uploadUrl, responseOrigin).toString();
  } catch {
    return uploadUrl;
  }
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && CSRF_TOKEN_PATTERN.test(value);
}

interface UrlAnalysis {
  sameOrigin: boolean;
  sameSite: boolean;
  sameSiteCookieFlow: boolean;
  includeCredentials: boolean;
  shouldIncludeCsrf: boolean;
}

function clearCsrfHeaders(headers: Headers): void {
  headers.delete("x-csrf-token");
  headers.delete("X-CSRF-Token");
  headers.delete("x-csrftoken");
  headers.delete("X-CSRFToken");
}

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function analyzeUploadUrl(rawUrl: string): UrlAnalysis {
  const current = new URL(window.location.href);
  const url = new URL(rawUrl, current.href);
  const currentHost = window.location.hostname.toLowerCase();
  const targetHost = url.hostname.toLowerCase();
  const isIp = (host: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const siteForHost = (host: string): string => {
    if (!host || isIp(host)) return host;
    if (host === "localhost" || host.endsWith(".localhost")) return "localhost";
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    return parts.slice(-2).join(".");
  };
  const currentSite = siteForHost(currentHost);
  const targetSite = siteForHost(targetHost);
  const sameSite = currentSite === targetSite;
  const sameSiteCookieFlow = sameSite && url.protocol === current.protocol;
  const sameOrigin = url.origin === current.origin;
  const includeCredentials = sameOrigin || sameSiteCookieFlow;
  const includeCsrfByContext = sameOrigin || sameSiteCookieFlow;

  return {
    sameOrigin,
    sameSite,
    sameSiteCookieFlow,
    includeCredentials,
    shouldIncludeCsrf: includeCsrfByContext,
  };
}

function buildUploadHeaders(
  rawUrl: string,
  headers: UploadHeaders = {},
  requireCsrf?: boolean
): { headers: Headers; includeCredentials: boolean; shouldIncludeCsrf: boolean } {
  const resolved = analyzeUploadUrl(rawUrl);
  const finalHeaders = new Headers(headers);
  const shouldIncludeCsrf = requireCsrf === undefined
    ? resolved.shouldIncludeCsrf
    : requireCsrf;
  if (shouldIncludeCsrf && (resolved.sameOrigin || resolved.sameSiteCookieFlow)) {
    const csrfToken = getCookieValue("XSRF-TOKEN");
    if (csrfToken) {
      finalHeaders.set("X-CSRF-Token", csrfToken);
      finalHeaders.set("X-CSRFToken", csrfToken);
    }
  }
  return {
    headers: finalHeaders,
    includeCredentials: resolved.includeCredentials,
    shouldIncludeCsrf,
  };
}

async function fetchUploadSecurityContract(): Promise<{ fetchedAt: number; csrfRequired: boolean } | null> {
  const now = Date.now();
  if (uploadSecurityContractCache && now - uploadSecurityContractCache.fetchedAt < SECURITY_CONTRACT_TTL_MS) {
    return uploadSecurityContractCache;
  }
  if (uploadSecurityContractInFlight) {
    return uploadSecurityContractInFlight;
  }

  uploadSecurityContractInFlight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await apiFetch("/api/objects/security-contract", {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return null;

      const body = await response.json().catch(() => null as UploadSecurityContract | null);
      const hasExplicitRequired = typeof body?.csrf?.required === "boolean";
      const csrfRequired = hasExplicitRequired
        ? Boolean(body?.csrf?.required)
        : true;

      const value = {
        fetchedAt: Date.now(),
        csrfRequired,
      };
      uploadSecurityContractCache = value;
      return value;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      uploadSecurityContractInFlight = null;
    }
  })();

  return uploadSecurityContractInFlight;
}

export async function ensureCsrfToken(): Promise<void> {
  const guarantee = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error("Global CSRF Token Timeout")), 15000);
  });

  return Promise.race([
    guarantee,
    (async () => {
      const securityContract = await fetchUploadSecurityContract();
      if (securityContract?.csrfRequired === false) {
        return;
      }

      const existingToken = getCookieValue("XSRF-TOKEN");
      if (isToken(existingToken)) {
        return;
      }
      if (csrfRefreshInFlight) {
        await csrfRefreshInFlight;
        return;
      }

      csrfRefreshInFlight = (async () => {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < CSRF_REFRESH_RETRY_ATTEMPTS; attempt++) {
          const abortController = new AbortController();
          const timeoutId = window.setTimeout(() => {
            abortController.abort(new DOMException("CSRF refresh timeout", "TimeoutError"));
          }, CSRF_REFRESH_TIMEOUT_MS);
          try {
            const response = await apiFetch("/api/csrf/token?rotate=1", {
              method: "GET",
              cache: "no-store",
              signal: abortController.signal,
            });
            if (!response.ok) {
              throw new Error("Failed to refresh CSRF token");
            }

            const responseBody = await response.json().catch(() => ({} as { csrfToken?: string }));
            const rotatedToken = responseBody?.csrfToken;
            const cookieToken = getCookieValue("XSRF-TOKEN");
            const effectiveToken = isToken(rotatedToken) ? rotatedToken : cookieToken;
            if (!isToken(effectiveToken)) {
              throw new Error("Invalid CSRF token after refresh");
            }
            return;
          } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error("Failed to refresh CSRF token");
            if (attempt < CSRF_REFRESH_RETRY_ATTEMPTS - 1) {
              const backoffMs = 250 * (attempt + 1) + Math.floor(Math.random() * 150);
              await new Promise((resolve) => window.setTimeout(resolve, backoffMs));
            }
          } finally {
            window.clearTimeout(timeoutId);
          }
        }
        throw lastError || new Error("Failed to refresh CSRF token");
      })();

      try {
        await csrfRefreshInFlight;
      } finally {
        csrfRefreshInFlight = null;
      }

      if (!isToken(getCookieValue("XSRF-TOKEN"))) {
        throw new Error("CSRF token missing after refresh attempt");
      }
    })()]);
}

function createAbortSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortController {
  const abortController = new AbortController();
  const externalSignal = signal;

  const onAbort = () => abortController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortController.abort(externalSignal.reason as unknown as DOMException);
    } else {
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    const timeoutId = window.setTimeout(() => {
      abortController.abort(new DOMException("Upload timeout", "TimeoutError"));
    }, timeoutMs);
    abortController.signal.addEventListener("abort", () => {
      window.clearTimeout(timeoutId);
    }, { once: true });
  }

  return abortController;
}

export async function uploadBlob(
  url: string,
  body: Blob | ArrayBuffer | Uint8Array,
  options: UploadTransportOptions = {}
): Promise<Response> {
  const securityContract = await fetchUploadSecurityContract();
  const initial = buildUploadHeaders(url, options.headers, options.requireCsrf);
  const shouldEnforceCsrf = initial.shouldIncludeCsrf && securityContract?.csrfRequired !== false;
  if (shouldEnforceCsrf) {
    await ensureCsrfToken();
  }
  const { headers, includeCredentials } = buildUploadHeaders(url, options.headers, options.requireCsrf);
  if (!shouldEnforceCsrf) {
    clearCsrfHeaders(headers);
  }
  if (shouldEnforceCsrf) {
    if (!getCookieValue("XSRF-TOKEN")) {
      throw new Error("CSRF token missing after refresh attempt");
    }
  }
  const abortController = createAbortSignal(options.signal, options.timeoutMs);

  const bodyToUpload = body instanceof Blob
    ? body
    : body instanceof Uint8Array
      ? new Blob([body as any])
      : new Blob([body as any]);
  const finalHeaders = new Headers(headers);
  if (options.skipContentType) {
    finalHeaders.delete("content-type");
    finalHeaders.delete("Content-Type");
  }

  return fetch(url, {
    method: "PUT",
    body: bodyToUpload,
    headers: finalHeaders,
    credentials: includeCredentials ? "include" : "omit",
    signal: abortController.signal,
  });
}

export async function uploadBlobWithProgress(
  url: string,
  body: Blob | ArrayBuffer | Uint8Array,
  onProgress?: (percent: number) => void,
  options: UploadTransportOptions = {}
): Promise<void> {
  const securityContract = await fetchUploadSecurityContract();
  const initial = buildUploadHeaders(url, options.headers, options.requireCsrf);
  const shouldEnforceCsrf = initial.shouldIncludeCsrf && securityContract?.csrfRequired !== false;
  if (shouldEnforceCsrf) {
    await ensureCsrfToken();
  }
  const { headers, includeCredentials } = buildUploadHeaders(url, options.headers, options.requireCsrf);
  if (!shouldEnforceCsrf) {
    clearCsrfHeaders(headers);
  }
  if (shouldEnforceCsrf && !getCookieValue("XSRF-TOKEN")) {
    throw new Error("CSRF token missing after refresh attempt");
  }
  const bodyForUpload = body instanceof ArrayBuffer ? new Blob([body as any]) : body;
  const file = bodyForUpload instanceof Blob ? bodyForUpload : new Blob([bodyForUpload as any]);
  const finalHeaders = new Headers(headers);
  if (options.skipContentType) {
    finalHeaders.delete("content-type");
    finalHeaders.delete("Content-Type");
  }

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abortController = createAbortSignal(options.signal, options.timeoutMs);

    const cleanup = () => {
      abortController.signal.removeEventListener("abort", handleAbort);
    };

    const handleAbort = () => {
      xhr.abort();
      cleanup();
      reject(new Error("Upload aborted"));
    };

    abortController.signal.addEventListener("abort", handleAbort, { once: true });

    xhr.upload.addEventListener("progress", (event) => {
      if (!onProgress || !event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    });

    xhr.addEventListener("load", () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        const requestId = xhr.getResponseHeader("X-Request-Id") || xhr.getResponseHeader("X-Trace-Id");
        const suffix = requestId ? ` (requestId ${requestId})` : "";
        reject(new Error(`Upload failed with status ${xhr.status}${suffix}`));
      }
    });

    xhr.addEventListener("error", () => {
      cleanup();
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new Error("Upload aborted"));
    });

    xhr.open("PUT", url);
    xhr.withCredentials = includeCredentials;
    finalHeaders.forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.send(file);
  });
}
