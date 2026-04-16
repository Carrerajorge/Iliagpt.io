/**
 * Connector Firewall — Network-level security for connector HTTP calls.
 *
 * Provides:
 *  - SSRF protection (private IPs, metadata endpoints, blocked protocols)
 *  - Per-connector domain whitelisting
 *  - `wrapFetch()` — a fetch wrapper that validates every URL before dispatch
 *  - Rate-awareness with warning thresholds
 *  - Outbound request logging with a ring buffer for debugging
 *
 * Zero external dependencies.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface UrlValidationResult {
  allowed: boolean;
  reason?: string;
}

export interface DomainValidationResult {
  allowed: boolean;
  reason?: string;
}

export interface RequestLogEntry {
  connectorId: string;
  method: string;
  url: string;
  status: number | null;
  latencyMs: number;
  responseSizeBytes: number | null;
  timestamp: string;
  error?: string;
}

export interface DomainRateState {
  count: number;
  windowStart: number;
}

// ─── Private IP detection ───────────────────────────────────────────

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateIp(hostname: string): boolean {
  // Strip brackets for IPv6
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  // IPv6 loopback
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;

  // IPv6 unique local (fc00::/7 = fc00:: through fdff::)
  if (h.startsWith("fc") || h.startsWith("fd")) return true;

  // IPv6 link-local (fe80::/10)
  if (h.startsWith("fe80:")) return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const v4Mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) {
    return isPrivateIp(v4Mapped[1]);
  }

  // IPv4
  const parts = parseIpv4(h);
  if (!parts) return false;

  const [a, b] = parts;

  if (a === 0) return true;                           // 0.0.0.0/8 — "this" network
  if (a === 10) return true;                           // 10.0.0.0/8
  if (a === 127) return true;                          // 127.0.0.0/8
  if (a === 169 && b === 254) return true;             // 169.254.0.0/16 (link-local)
  if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12
  if (a === 192 && b === 168) return true;             // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;   // 100.64.0.0/10 (CGN)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmark)
  if (a === 255) return true;                          // 255.0.0.0/8 (broadcast)

  return false;
}

const METADATA_HOSTNAMES = new Set([
  "169.254.169.254",            // AWS / GCP / Azure instance metadata
  "metadata.google.internal",   // GCP metadata
  "metadata.google.com",
  "instance-data",              // AWS alias
  "metadata",                   // Common alias
  "fd00:ec2::254",              // AWS IPv6 metadata
]);

const BLOCKED_PROTOCOLS = new Set([
  "file:",
  "gopher:",
  "ftp:",
  "telnet:",
  "ldap:",
  "dict:",
  "sftp:",
  "ssh:",
  "tftp:",
]);

// ─── Domain whitelists per connector ────────────────────────────────

interface DomainWhitelistEntry {
  /** Exact domain match or wildcard (e.g., "*.googleapis.com") */
  pattern: string;
}

const CONNECTOR_DOMAIN_WHITELIST: Record<string, DomainWhitelistEntry[]> = {
  gmail: [
    { pattern: "*.googleapis.com" },
    { pattern: "*.google.com" },
    { pattern: "accounts.google.com" },
    { pattern: "oauth2.googleapis.com" },
    { pattern: "www.googleapis.com" },
  ],
  "google-drive": [
    { pattern: "*.googleapis.com" },
    { pattern: "*.google.com" },
    { pattern: "accounts.google.com" },
    { pattern: "oauth2.googleapis.com" },
    { pattern: "www.googleapis.com" },
  ],
  slack: [
    { pattern: "*.slack.com" },
    { pattern: "slack.com" },
    { pattern: "api.slack.com" },
    { pattern: "files.slack.com" },
  ],
  notion: [
    { pattern: "api.notion.com" },
    { pattern: "*.notion.com" },
  ],
  github: [
    { pattern: "api.github.com" },
    { pattern: "*.githubusercontent.com" },
    { pattern: "github.com" },
    { pattern: "uploads.github.com" },
  ],
  hubspot: [
    { pattern: "api.hubapi.com" },
    { pattern: "api.hubspot.com" },
    { pattern: "*.hubapi.com" },
    { pattern: "*.hubspot.com" },
  ],
};

function domainMatchesPattern(domain: string, pattern: string): boolean {
  const d = domain.toLowerCase();
  const p = pattern.toLowerCase();

  // Exact match
  if (d === p) return true;

  // Wildcard match: *.googleapis.com matches foo.googleapis.com, bar.googleapis.com
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".googleapis.com"
    if (d.endsWith(suffix)) return true;
    // Also match the bare domain (e.g., "googleapis.com" matches "*.googleapis.com")
    if (d === p.slice(2)) return true;
  }

  return false;
}

// ─── Known rate limits per domain (requests per minute) ─────────────

const KNOWN_RATE_LIMITS: Record<string, number> = {
  "api.github.com": 60,             // unauthenticated; 5000 authenticated (per hour)
  "api.slack.com": 50,              // Tier 3 method default
  "api.notion.com": 30,             // 3 requests/second → ~180/min but bursty
  "api.hubapi.com": 100,
  "api.hubspot.com": 100,
  "www.googleapis.com": 300,
  "gmail.googleapis.com": 250,
  "sheets.googleapis.com": 100,
  "drive.googleapis.com": 300,
};

const RATE_WARN_THRESHOLD = 0.8; // Warn at 80% of known limit

// ─── URL redaction for logging ──────────────────────────────────────

const SENSITIVE_QUERY_PARAMS = new Set([
  "token",
  "key",
  "api_key",
  "apikey",
  "access_token",
  "secret",
  "password",
  "auth",
  "authorization",
  "client_secret",
  "refresh_token",
  "code",
  "state",
]);

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const params = new URLSearchParams(url.search);
    for (const key of params.keys()) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        params.set(key, "[REDACTED]");
      }
    }
    url.search = params.toString();
    return url.toString();
  } catch {
    return rawUrl;
  }
}

// ─── Ring buffer for request logs ───────────────────────────────────

class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private writeIndex = 0;
  private _size = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  toArray(): T[] {
    if (this._size === 0) return [];

    const result: T[] = [];
    // Start from the oldest entry
    const start = this._size < this.capacity ? 0 : this.writeIndex;
    for (let i = 0; i < this._size; i++) {
      const idx = (start + i) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  get size(): number {
    return this._size;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.writeIndex = 0;
    this._size = 0;
  }
}

// ─── RequestLogger ──────────────────────────────────────────────────

export class RequestLogger {
  private logs: RingBuffer<RequestLogEntry>;

  constructor(capacity = 200) {
    this.logs = new RingBuffer<RequestLogEntry>(capacity);
  }

  log(entry: RequestLogEntry): void {
    this.logs.push(entry);

    // Structured log for observability
    console.log(
      JSON.stringify({
        event: "connector_outbound_request",
        connectorId: entry.connectorId,
        method: entry.method,
        url: entry.url,
        status: entry.status,
        latencyMs: entry.latencyMs,
        responseSizeBytes: entry.responseSizeBytes,
        error: entry.error || undefined,
        timestamp: entry.timestamp,
      })
    );
  }

  /** Get recent request logs (newest first) */
  getRecent(limit?: number): RequestLogEntry[] {
    const all = this.logs.toArray().reverse();
    return limit ? all.slice(0, limit) : all;
  }

  /** Get logs filtered by connector ID */
  getByConnector(connectorId: string, limit?: number): RequestLogEntry[] {
    return this.getRecent(limit).filter((e) => e.connectorId === connectorId);
  }

  /** Get aggregate stats for a connector */
  getStats(connectorId: string): {
    total: number;
    success: number;
    failure: number;
    avgLatencyMs: number;
  } {
    const entries = this.logs.toArray().filter((e) => e.connectorId === connectorId);
    if (entries.length === 0) {
      return { total: 0, success: 0, failure: 0, avgLatencyMs: 0 };
    }

    let success = 0;
    let failure = 0;
    let totalLatency = 0;

    for (const e of entries) {
      if (e.status !== null && e.status >= 200 && e.status < 400) {
        success++;
      } else {
        failure++;
      }
      totalLatency += e.latencyMs;
    }

    return {
      total: entries.length,
      success,
      failure,
      avgLatencyMs: Math.round(totalLatency / entries.length),
    };
  }

  clear(): void {
    this.logs.clear();
  }
}

// ─── ConnectorFirewall ──────────────────────────────────────────────

export class ConnectorFirewall {
  private requestLogger: RequestLogger;
  private domainRates = new Map<string, DomainRateState>();
  private customWhitelists = new Map<string, DomainWhitelistEntry[]>();
  private isDev: boolean;

  constructor(options?: { isDev?: boolean; logCapacity?: number }) {
    this.requestLogger = new RequestLogger(options?.logCapacity ?? 200);
    this.isDev = options?.isDev ?? (process.env.NODE_ENV !== "production");
  }

  // ─── URL Validation (SSRF protection) ───────────────────────────

  /**
   * Validate a URL for SSRF safety.
   * Blocks private IPs, metadata endpoints, dangerous protocols.
   * Allows only https:// (and http:// for localhost in dev mode).
   */
  validateUrl(url: string): UrlValidationResult {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: `Malformed URL: ${url.slice(0, 100)}` };
    }

    // Protocol check
    if (BLOCKED_PROTOCOLS.has(parsed.protocol)) {
      return { allowed: false, reason: `Blocked protocol: ${parsed.protocol}` };
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { allowed: false, reason: `Only https:// and http:// are allowed, got: ${parsed.protocol}` };
    }

    // http:// only allowed for localhost in dev
    if (parsed.protocol === "http:") {
      const isLocalhost =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1";

      if (!isLocalhost || !this.isDev) {
        return {
          allowed: false,
          reason: `HTTP is only allowed for localhost in development mode`,
        };
      }
    }

    // Private IP check
    if (isPrivateIp(parsed.hostname)) {
      return { allowed: false, reason: `Blocked private/reserved IP: ${parsed.hostname}` };
    }

    // Metadata endpoint check
    if (METADATA_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
      return { allowed: false, reason: `Blocked cloud metadata endpoint: ${parsed.hostname}` };
    }

    // Check for DNS rebinding patterns (IP in hostname with non-standard port)
    const ipParts = parseIpv4(parsed.hostname);
    if (ipParts && parsed.port) {
      // Bare IPs with non-standard ports are suspicious
      const port = parseInt(parsed.port, 10);
      if (port !== 80 && port !== 443) {
        return { allowed: false, reason: `Suspicious: bare IP with non-standard port ${port}` };
      }
    }

    // Check for user info in URL (user:pass@host — often used in SSRF)
    if (parsed.username || parsed.password) {
      return { allowed: false, reason: `URL contains user credentials — blocked for security` };
    }

    return { allowed: true };
  }

  // ─── Domain Validation ──────────────────────────────────────────

  /**
   * Validate that a domain is in the whitelist for a specific connector.
   * If no whitelist is defined for the connector, all domains are allowed
   * (subject to URL-level SSRF checks).
   */
  validateDomain(domain: string, connectorId: string): DomainValidationResult {
    const whitelist =
      this.customWhitelists.get(connectorId) ||
      CONNECTOR_DOMAIN_WHITELIST[connectorId];

    // No whitelist = no domain restriction (URL-level checks still apply)
    if (!whitelist || whitelist.length === 0) {
      return { allowed: true };
    }

    for (const entry of whitelist) {
      if (domainMatchesPattern(domain, entry.pattern)) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `Domain "${domain}" is not in the whitelist for connector "${connectorId}"`,
    };
  }

  /**
   * Register a custom domain whitelist for a connector (extends the built-in list).
   */
  addDomainWhitelist(connectorId: string, patterns: string[]): void {
    const existing = this.customWhitelists.get(connectorId) || [];
    const entries = patterns.map((p) => ({ pattern: p }));
    this.customWhitelists.set(connectorId, [...existing, ...entries]);
  }

  // ─── Rate tracking ─────────────────────────────────────────────

  /**
   * Track a request to a domain and warn if approaching known rate limits.
   * Returns a warning message if at 80%+ of known limit, otherwise null.
   */
  private trackDomainRate(domain: string): string | null {
    const now = Date.now();
    const key = domain.toLowerCase();
    const state = this.domainRates.get(key);

    if (!state || now - state.windowStart > 60_000) {
      // New window
      this.domainRates.set(key, { count: 1, windowStart: now });
      return null;
    }

    state.count++;

    // Check against known limits
    const knownLimit = KNOWN_RATE_LIMITS[key];
    if (knownLimit && state.count >= Math.floor(knownLimit * RATE_WARN_THRESHOLD)) {
      return `Approaching rate limit for ${domain}: ${state.count}/${knownLimit} requests/min (${Math.round((state.count / knownLimit) * 100)}%)`;
    }

    return null;
  }

  // ─── Wrapped fetch ─────────────────────────────────────────────

  /**
   * Return a fetch wrapper that validates URLs and logs requests.
   *
   * The returned function has the same signature as `globalThis.fetch`
   * but will reject requests that fail URL validation or domain whitelisting.
   *
   * @param connectorId  Connector identifier for domain whitelisting and logging
   */
  wrapFetch(
    connectorId: string
  ): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
    const firewall = this;

    return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      // Resolve the URL string
      let urlStr: string;
      if (typeof input === "string") {
        urlStr = input;
      } else if (input instanceof URL) {
        urlStr = input.toString();
      } else if (input instanceof Request) {
        urlStr = input.url;
      } else {
        throw new Error("[ConnectorFirewall] Invalid fetch input");
      }

      // Validate URL (SSRF)
      const urlCheck = firewall.validateUrl(urlStr);
      if (!urlCheck.allowed) {
        const error = new Error(`[ConnectorFirewall] Request blocked: ${urlCheck.reason}`);
        firewall.requestLogger.log({
          connectorId,
          method: init?.method || "GET",
          url: redactUrl(urlStr),
          status: null,
          latencyMs: 0,
          responseSizeBytes: null,
          timestamp: new Date().toISOString(),
          error: urlCheck.reason,
        });
        throw error;
      }

      // Validate domain whitelist
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(urlStr);
      } catch {
        throw new Error(`[ConnectorFirewall] Malformed URL: ${urlStr.slice(0, 100)}`);
      }

      const domainCheck = firewall.validateDomain(parsedUrl.hostname, connectorId);
      if (!domainCheck.allowed) {
        const error = new Error(`[ConnectorFirewall] Domain blocked: ${domainCheck.reason}`);
        firewall.requestLogger.log({
          connectorId,
          method: init?.method || "GET",
          url: redactUrl(urlStr),
          status: null,
          latencyMs: 0,
          responseSizeBytes: null,
          timestamp: new Date().toISOString(),
          error: domainCheck.reason,
        });
        throw error;
      }

      // Track domain rate
      const rateWarning = firewall.trackDomainRate(parsedUrl.hostname);
      if (rateWarning) {
        console.warn(
          JSON.stringify({
            event: "connector_rate_warning",
            connectorId,
            domain: parsedUrl.hostname,
            message: rateWarning,
            timestamp: new Date().toISOString(),
          })
        );
      }

      // Execute the actual fetch
      const startTime = Date.now();
      const method = init?.method || "GET";
      let response: Response;

      try {
        response = await fetch(input, init);
      } catch (err) {
        const latencyMs = Date.now() - startTime;
        const errorMsg = err instanceof Error ? err.message : String(err);

        firewall.requestLogger.log({
          connectorId,
          method,
          url: redactUrl(urlStr),
          status: null,
          latencyMs,
          responseSizeBytes: null,
          timestamp: new Date().toISOString(),
          error: errorMsg,
        });

        throw err;
      }

      // Log the completed request
      const latencyMs = Date.now() - startTime;

      // Try to get response size from content-length header
      let responseSizeBytes: number | null = null;
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        const parsed = parseInt(contentLength, 10);
        if (!isNaN(parsed)) responseSizeBytes = parsed;
      }

      firewall.requestLogger.log({
        connectorId,
        method,
        url: redactUrl(urlStr),
        status: response.status,
        latencyMs,
        responseSizeBytes,
        timestamp: new Date().toISOString(),
      });

      return response;
    };
  }

  // ─── Accessors ─────────────────────────────────────────────────

  /** Get the request logger for inspection / debugging */
  get logger(): RequestLogger {
    return this.requestLogger;
  }

  /** Get recent logs for a specific connector */
  getRecentLogs(connectorId: string, limit = 20): RequestLogEntry[] {
    return this.requestLogger.getByConnector(connectorId, limit);
  }

  /** Get aggregate stats for a connector */
  getStats(connectorId: string): ReturnType<RequestLogger["getStats"]> {
    return this.requestLogger.getStats(connectorId);
  }

  /** Get the domain whitelist for a connector (built-in + custom) */
  getDomainWhitelist(connectorId: string): string[] {
    const builtin = CONNECTOR_DOMAIN_WHITELIST[connectorId] || [];
    const custom = this.customWhitelists.get(connectorId) || [];
    return [...builtin, ...custom].map((e) => e.pattern);
  }

  /** Reset rate tracking (useful for tests) */
  resetRates(): void {
    this.domainRates.clear();
  }

  /** Clear all logs */
  clearLogs(): void {
    this.requestLogger.clear();
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const connectorFirewall = new ConnectorFirewall();
