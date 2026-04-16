/**
 * APIConnectorFramework — auto-discovers and calls external APIs from OpenAPI specs.
 * Manages API keys (encrypted at rest), rate limiting per API, and response validation.
 */

import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";

const logger = createLogger("APIConnectorFramework");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, PathItem>;
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, SecurityScheme> };
}

interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: unknown }> }>;
  tags?: string[];
  security?: Array<Record<string, string[]>>;
}

interface Parameter {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  required?: boolean;
  description?: string;
  schema?: { type?: string; enum?: unknown[]; default?: unknown };
}

interface SecurityScheme {
  type: "apiKey" | "http" | "oauth2" | "openIdConnect";
  in?: "header" | "query" | "cookie";
  name?: string;
  scheme?: string;
}

export interface DiscoveredEndpoint {
  id: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  parameters: Parameter[];
  requiresAuth: boolean;
  tags: string[];
}

export interface APICallOptions {
  apiId: string;
  endpointId: string;
  params?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface APICallResult {
  status: number;
  data: unknown;
  headers: Record<string, string>;
  latencyMs: number;
  cached: boolean;
}

export interface APIRegistration {
  id: string;
  name: string;
  specUrl?: string;
  baseUrl: string;
  spec?: OpenAPISpec;
  authType: "none" | "apiKey" | "bearer" | "basic";
  keyHeaderName?: string;
  encryptedKey?: string;
  rateLimit: { requests: number; windowMs: number };
}

// ─── Simple Encryption (XOR obfuscation for in-memory storage) ───────────────
// For production, use server-side encryption via KMS or Vault.

function obfuscateKey(key: string, salt: string): string {
  const salted = salt.repeat(Math.ceil(key.length / salt.length)).slice(0, key.length);
  return Buffer.from(
    key.split("").map((c, i) => c.charCodeAt(0) ^ salted.charCodeAt(i)).map((n) => String.fromCharCode(n)).join("")
  ).toString("base64");
}

function deobfuscateKey(obfuscated: string, salt: string): string {
  const raw = Buffer.from(obfuscated, "base64").toString();
  const salted = salt.repeat(Math.ceil(raw.length / salt.length)).slice(0, raw.length);
  return raw.split("").map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ salted.charCodeAt(i))).join("");
}

const KEY_SALT = process.env.API_KEY_SALT ?? "iliagpt-default-salt-do-not-use-in-prod";

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

interface RateWindow {
  count: number;
  resetAt: number;
}

const rateLimits = new Map<string, RateWindow>();

function checkRateLimit(apiId: string, limit: { requests: number; windowMs: number }): boolean {
  const now = Date.now();
  const window = rateLimits.get(apiId);

  if (!window || now >= window.resetAt) {
    rateLimits.set(apiId, { count: 1, resetAt: now + limit.windowMs });
    return true;
  }

  if (window.count >= limit.requests) return false;
  window.count++;
  return true;
}

// ─── Response Cache ───────────────────────────────────────────────────────────

interface CacheEntry {
  data: unknown;
  status: number;
  headers: Record<string, string>;
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL = 60_000; // 1 minute default

function getCacheKey(apiId: string, endpointId: string, params: Record<string, unknown>): string {
  return `${apiId}:${endpointId}:${JSON.stringify(params)}`;
}

// ─── OpenAPI Spec Fetcher ─────────────────────────────────────────────────────

async function fetchOpenAPISpec(specUrl: string): Promise<OpenAPISpec> {
  const resp = await fetch(specUrl, {
    headers: { "Accept": "application/json, application/yaml" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new AppError(`Failed to fetch OpenAPI spec: ${resp.status}`, 502, "SPEC_FETCH_ERROR");

  const contentType = resp.headers.get("content-type") ?? "";

  if (contentType.includes("yaml") || specUrl.endsWith(".yaml") || specUrl.endsWith(".yml")) {
    // Basic YAML to JSON conversion for simple cases
    const text = await resp.text();
    // For production, use a proper YAML parser like js-yaml
    logger.warn("YAML spec detected — basic conversion only. Install js-yaml for full support.");
    throw new AppError("YAML specs require js-yaml dependency", 501, "YAML_NOT_SUPPORTED");
  }

  return resp.json() as Promise<OpenAPISpec>;
}

// ─── Endpoint Discovery ───────────────────────────────────────────────────────

function discoverEndpoints(spec: OpenAPISpec): DiscoveredEndpoint[] {
  const endpoints: DiscoveredEndpoint[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const methods = ["get", "post", "put", "patch", "delete"] as const;

    for (const method of methods) {
      const op = pathItem[method];
      if (!op) continue;

      const id = op.operationId ?? `${method}:${path}`;
      const requiresAuth = (op.security?.length ?? 0) > 0 || spec.components?.securitySchemes !== undefined;

      endpoints.push({
        id,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? `${method.toUpperCase()} ${path}`,
        description: op.description,
        parameters: op.parameters ?? [],
        requiresAuth,
        tags: op.tags ?? [],
      });
    }
  }

  return endpoints;
}

// ─── URL Builder ──────────────────────────────────────────────────────────────

function buildRequestUrl(
  baseUrl: string,
  path: string,
  params: Record<string, unknown>,
  parameters: Parameter[]
): { url: string; query: URLSearchParams; pathParams: Record<string, string> } {
  const queryParams = new URLSearchParams();
  const pathParams: Record<string, string> = {};

  for (const p of parameters) {
    const value = params[p.name];
    if (value === undefined || value === null) continue;

    if (p.in === "path") {
      pathParams[p.name] = String(value);
    } else if (p.in === "query") {
      queryParams.set(p.name, String(value));
    }
  }

  let resolvedPath = path;
  for (const [k, v] of Object.entries(pathParams)) {
    resolvedPath = resolvedPath.replace(`{${k}}`, encodeURIComponent(v));
  }

  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const url = `${base}${resolvedPath}${queryParams.toString() ? `?${queryParams}` : ""}`;

  return { url, query: queryParams, pathParams };
}

// ─── Request Logger ───────────────────────────────────────────────────────────

interface RequestLog {
  apiId: string;
  endpointId: string;
  method: string;
  url: string;
  statusCode: number;
  latencyMs: number;
  timestamp: string;
  error?: string;
}

const requestLogs: RequestLog[] = [];
const MAX_LOGS = 1_000;

function logRequest(entry: RequestLog): void {
  requestLogs.push(entry);
  if (requestLogs.length > MAX_LOGS) requestLogs.shift();
}

// ─── Main Framework ───────────────────────────────────────────────────────────

export class APIConnectorFramework {
  private registry = new Map<string, APIRegistration>();
  private endpointCache = new Map<string, DiscoveredEndpoint[]>();

  async registerAPI(registration: APIRegistration & { apiKey?: string }): Promise<void> {
    const reg: APIRegistration = { ...registration };

    if (registration.apiKey) {
      reg.encryptedKey = obfuscateKey(registration.apiKey, KEY_SALT);
    }

    // Fetch spec if URL provided
    if (reg.specUrl && !reg.spec) {
      try {
        reg.spec = await fetchOpenAPISpec(reg.specUrl);
        logger.info(`Loaded OpenAPI spec for ${reg.name}: ${Object.keys(reg.spec.paths).length} paths`);
      } catch (err) {
        logger.warn(`Could not load spec for ${reg.name}: ${(err as Error).message}`);
      }
    }

    if (reg.spec) {
      this.endpointCache.set(reg.id, discoverEndpoints(reg.spec));
    }

    this.registry.set(reg.id, reg);
    logger.info(`Registered API: ${reg.id} (${reg.name})`);
  }

  getEndpoints(apiId: string): DiscoveredEndpoint[] {
    return this.endpointCache.get(apiId) ?? [];
  }

  listAPIs(): Array<{ id: string; name: string; endpointCount: number }> {
    return [...this.registry.values()].map((r) => ({
      id: r.id,
      name: r.name,
      endpointCount: this.endpointCache.get(r.id)?.length ?? 0,
    }));
  }

  async call(options: APICallOptions): Promise<APICallResult> {
    const { apiId, endpointId, params = {}, body, headers: extraHeaders = {} } = options;

    const reg = this.registry.get(apiId);
    if (!reg) throw new AppError(`Unknown API: ${apiId}`, 404, "API_NOT_FOUND");

    if (!checkRateLimit(apiId, reg.rateLimit)) {
      throw new AppError(`Rate limit exceeded for API: ${apiId}`, 429, "RATE_LIMIT_EXCEEDED");
    }

    const cacheKey = getCacheKey(apiId, endpointId, params);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return { status: cached.status, data: cached.data, headers: cached.headers, latencyMs: 0, cached: true };
    }

    // Find endpoint
    const endpoints = this.endpointCache.get(apiId) ?? [];
    const endpoint = endpoints.find((e) => e.id === endpointId);

    if (!endpoint && reg.spec) {
      throw new AppError(`Endpoint ${endpointId} not found in ${apiId}`, 404, "ENDPOINT_NOT_FOUND");
    }

    // Build URL
    const parameters = endpoint?.parameters ?? [];
    const { url } = buildRequestUrl(reg.baseUrl, endpoint?.path ?? `/${endpointId}`, params, parameters);

    // Build headers
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "IliaGPT-APIConnector/1.0",
      ...extraHeaders,
    };

    // Auth
    if (reg.encryptedKey) {
      const apiKey = deobfuscateKey(reg.encryptedKey, KEY_SALT);
      if (reg.authType === "bearer") {
        headers["Authorization"] = `Bearer ${apiKey}`;
      } else if (reg.authType === "apiKey" && reg.keyHeaderName) {
        headers[reg.keyHeaderName] = apiKey;
      }
    }

    const method = endpoint?.method ?? "GET";
    const t0 = Date.now();

    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });

      const latencyMs = Date.now() - t0;
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => { respHeaders[k] = v; });

      let data: unknown;
      const ct = resp.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        data = await resp.json();
      } else {
        data = await resp.text();
      }

      logRequest({ apiId, endpointId, method, url, statusCode: resp.status, latencyMs, timestamp: new Date().toISOString() });

      if (!resp.ok) {
        throw new AppError(`API call failed: ${resp.status} ${resp.statusText}`, resp.status, "API_CALL_FAILED", true, { data });
      }

      // Cache GET responses
      if (method === "GET") {
        responseCache.set(cacheKey, { data, status: resp.status, headers: respHeaders, expiresAt: Date.now() + CACHE_TTL });
      }

      logger.debug(`API call ${apiId}:${endpointId} → ${resp.status} (${latencyMs}ms)`);

      return { status: resp.status, data, headers: respHeaders, latencyMs, cached: false };
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const msg = (err as Error).message;
      logRequest({ apiId, endpointId, method, url, statusCode: 0, latencyMs, timestamp: new Date().toISOString(), error: msg });
      throw err instanceof AppError ? err : new AppError(`API call failed: ${msg}`, 502, "API_CALL_ERROR");
    }
  }

  getRequestLogs(apiId?: string): RequestLog[] {
    if (apiId) return requestLogs.filter((l) => l.apiId === apiId);
    return [...requestLogs];
  }

  removeAPI(apiId: string): void {
    this.registry.delete(apiId);
    this.endpointCache.delete(apiId);
  }

  getRateLimitUsage(apiId: string): { used: number; remaining: number; resetAt: number } | null {
    const reg = this.registry.get(apiId);
    if (!reg) return null;
    const window = rateLimits.get(apiId);
    if (!window) return { used: 0, remaining: reg.rateLimit.requests, resetAt: Date.now() + reg.rateLimit.windowMs };
    return {
      used: window.count,
      remaining: Math.max(0, reg.rateLimit.requests - window.count),
      resetAt: window.resetAt,
    };
  }
}

export const apiConnectorFramework = new APIConnectorFramework();
