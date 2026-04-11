import type { ListenOptions, Server } from "net";

export type HttpListenCandidate = {
  host: string;
  port: number;
  reusePort: boolean;
  options: ListenOptions;
};

type ListenServer = Pick<Server, "listen" | "once" | "removeListener">;

const LOOPBACK_HOST = "127.0.0.1";
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"]);
const RETRYABLE_LISTEN_CODES = new Set(["ENOTSUP", "EADDRNOTAVAIL", "EAFNOSUPPORT"]);
const LOOPBACK_BASE_URL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function resolveHostFromBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl?.trim()) return undefined;
  try {
    const parsed = new URL(baseUrl);
    if (!LOOPBACK_BASE_URL_HOSTS.has(parsed.hostname)) {
      return undefined;
    }
    return parsed.hostname === "localhost" ? LOOPBACK_HOST : parsed.hostname.replace(/^\[(.*)\]$/, "$1");
  } catch {
    return undefined;
  }
}

export function resolveHttpListenCandidates(params: {
  port: number;
  configuredHost?: string;
  baseUrl?: string;
  isProduction: boolean;
  preferReusePort?: boolean;
}): HttpListenCandidate[] {
  const host =
    params.configuredHost?.trim() ||
    resolveHostFromBaseUrl(params.baseUrl) ||
    (params.isProduction ? "0.0.0.0" : LOOPBACK_HOST);
  const candidates: HttpListenCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (candidateHost: string, reusePort: boolean) => {
    const key = `${candidateHost}:${params.port}:${reusePort ? "reuse" : "single"}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      host: candidateHost,
      port: params.port,
      reusePort,
      options: reusePort
        ? ({ port: params.port, host: candidateHost, reusePort: true } as const)
        : ({ port: params.port, host: candidateHost } as const),
    });
  };

  if (params.preferReusePort) {
    pushCandidate(host, true);
  }

  pushCandidate(host, false);

  if (WILDCARD_HOSTS.has(host)) {
    pushCandidate(LOOPBACK_HOST, false);
  }

  return candidates;
}

export function shouldRetryListenError(error: NodeJS.ErrnoException | null | undefined): boolean {
  return !!error?.code && RETRYABLE_LISTEN_CODES.has(error.code);
}

export async function listenWithFallback(
  server: ListenServer,
  candidates: readonly HttpListenCandidate[],
  onRetry?: (error: NodeJS.ErrnoException, failed: HttpListenCandidate, next: HttpListenCandidate) => void,
): Promise<HttpListenCandidate> {
  if (!candidates.length) {
    throw new Error("No HTTP listen candidates configured");
  }

  return await new Promise<HttpListenCandidate>((resolve, reject) => {
    let index = 0;

    const tryCandidate = () => {
      const candidate = candidates[index];
      if (!candidate) {
        reject(new Error("HTTP listen fallback exhausted"));
        return;
      }

      let settled = false;

      const cleanup = () => {
        server.removeListener("error", onError);
        server.removeListener("listening", onListening);
      };

      const onListening = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(candidate);
      };

      const onError = (rawError: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();

        const error =
          rawError instanceof Error ? (rawError as NodeJS.ErrnoException) : new Error(String(rawError));
        const nextCandidate = candidates[index + 1];

        if (nextCandidate && shouldRetryListenError(error)) {
          index += 1;
          onRetry?.(error, candidate, nextCandidate);
          tryCandidate();
          return;
        }

        reject(error);
      };

      server.once("error", onError);
      server.once("listening", onListening);

      try {
        (server.listen as (options: ListenOptions) => void)(candidate.options);
      } catch (error) {
        onError(error);
      }
    };

    tryCandidate();
  });
}
