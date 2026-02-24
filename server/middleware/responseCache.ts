/**
 * Response caching middleware for expensive endpoints.
 * Uses Redis (if configured) or in-memory fallback.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getCacheService } from "../services/cache";
import { generateCacheKey } from "../lib/memoryCache"; // We still use this util
import { requestDedup } from "../lib/requestDedup";
import * as crypto from "crypto";

const CACHE_NAMESPACE = "response";
const DEFAULT_TTL_MS = parseInt(process.env.RESPONSE_CACHE_TTL_MS || "60000", 10);
const MAX_CACHEABLE_SIZE = parseInt(process.env.RESPONSE_CACHE_MAX_SIZE || "5242880", 10);
const STALE_WHILE_REVALIDATE_MS = parseInt(process.env.RESPONSE_CACHE_SWR_MS || "30000", 10);

// Use the singleton cache service
const cacheService = getCacheService();

export interface ResponseCacheOptions {
  ttl?: number;
  keyGenerator?: (req: Request) => string;
  condition?: (req: Request) => boolean;
  varyHeaders?: string[];
  staleWhileRevalidate?: boolean;
  deduplicate?: boolean;
  cacheErrors?: boolean;
  maxSize?: number;
  namespace?: string;
}

interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  contentType: string;
  cachedAt: number;
  etag: string;
}

interface CacheStats {
  cacheHits: number;
  cacheMisses: number;
  staleHits: number;
  bypassedRequests: number;
}

const stats: CacheStats = {
  cacheHits: 0,
  cacheMisses: 0,
  staleHits: 0,
  bypassedRequests: 0,
};

function defaultKeyGenerator(req: Request, varyHeaders?: string[]): string {
  const parts: (string | object)[] = [
    req.method,
    req.originalUrl || req.url,
  ];

  if (varyHeaders && varyHeaders.length > 0) {
    const headerValues: Record<string, string> = {};
    for (const header of varyHeaders) {
      const value = req.get(header);
      if (value) {
        headerValues[header.toLowerCase()] = value;
      }
    }
    if (Object.keys(headerValues).length > 0) {
      parts.push(headerValues);
    }
  }

  const userId = (req as any).user?.id;
  if (userId) {
    parts.push(`user:${userId}`);
  }

  return generateCacheKey(...parts);
}

function generateEtag(body: string): string {
  return `"${crypto.createHash("md5").update(body).digest("hex")}"`;
}

function isCacheable(req: Request, options: ResponseCacheOptions): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  if (options.condition && !options.condition(req)) {
    return false;
  }

  const cacheControl = req.get("Cache-Control");
  if (cacheControl && (cacheControl.includes("no-cache") || cacheControl.includes("no-store"))) {
    return false;
  }

  return true;
}

export function responseCache(options: ResponseCacheOptions = {}): RequestHandler {
  const {
    ttl = DEFAULT_TTL_MS,
    keyGenerator,
    varyHeaders = ["Accept", "Accept-Encoding"],
    staleWhileRevalidate = true,
    deduplicate = true,
    cacheErrors = false,
    maxSize = MAX_CACHEABLE_SIZE,
    namespace = CACHE_NAMESPACE,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!isCacheable(req, options)) {
      stats.bypassedRequests++;
      return next();
    }

    const cacheKey = `${namespace}:` + (keyGenerator
      ? keyGenerator(req)
      : defaultKeyGenerator(req, varyHeaders));

    // Try to get from cache
    const cached = await cacheService.get<CachedResponse>(cacheKey);

    if (cached) {
      const ifNoneMatch = req.get("If-None-Match");
      if (ifNoneMatch && ifNoneMatch === cached.etag) {
        stats.cacheHits++;
        res.status(304).end();
        return;
      }

      const age = Date.now() - cached.cachedAt;
      const isStale = age > ttl;

      if (!isStale || (staleWhileRevalidate && age <= ttl + STALE_WHILE_REVALIDATE_MS)) {
        if (isStale) {
          stats.staleHits++;
          // Trigger revalidation but return stale content immediately
          revalidateInBackground(req, res, cacheKey, options, next);
        } else {
          stats.cacheHits++;
        }

        res.set("X-Cache", isStale ? "STALE" : "HIT");
        res.set("X-Cache-Age", String(Math.floor(age / 1000)));
        res.set("ETag", cached.etag);
        res.set("Cache-Control", `public, max-age=${Math.floor(ttl / 1000)}`);

        for (const [key, value] of Object.entries(cached.headers)) {
          if (!["content-length", "transfer-encoding"].includes(key.toLowerCase())) {
            res.set(key, value);
          }
        }

        res.status(cached.statusCode);
        res.send(cached.body);
        return;
      }
    }

    stats.cacheMisses++;

    const executor = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        const originalSend = res.send.bind(res);
        const originalJson = res.json.bind(res);
        const originalEnd = res.end.bind(res);

        let responseBody = "";
        let responseSent = false;

        const captureAndCache = (body: string | Buffer | object): void => {
          if (responseSent) return;
          responseSent = true;

          let bodyStr: string;
          if (typeof body === "object" && !(body instanceof Buffer)) {
            bodyStr = JSON.stringify(body);
          } else if (body instanceof Buffer) {
            bodyStr = body.toString("utf-8");
          } else {
            bodyStr = body;
          }

          responseBody = bodyStr;

          const statusCode = res.statusCode;
          const shouldCache =
            (statusCode >= 200 && statusCode < 300) ||
            (cacheErrors && statusCode >= 400 && statusCode < 500);

          if (shouldCache && responseBody.length <= maxSize) {
            const cachedResponse: CachedResponse = {
              statusCode,
              headers: {},
              body: responseBody,
              contentType: res.get("Content-Type") || "application/json",
              cachedAt: Date.now(),
              etag: generateEtag(responseBody),
            };

            const headersToCache = ["Content-Type", "Content-Language", ...varyHeaders];
            for (const header of headersToCache) {
              const value = res.get(header);
              if (value) {
                cachedResponse.headers[header.toLowerCase()] = value;
              }
            }

            // Store in Redis (TTL in seconds)
            cacheService
              .set(cacheKey, cachedResponse, Math.ceil((ttl + STALE_WHILE_REVALIDATE_MS) / 1000))
              .catch((err) => console.warn("[ResponseCache] Cache set error:", err));

            res.set("X-Cache", "MISS");
            res.set("ETag", cachedResponse.etag);
            res.set("Cache-Control", `public, max-age=${Math.floor(ttl / 1000)}`);
          }

          resolve();
        };

        res.send = function (body: any): Response {
          captureAndCache(body);
          return originalSend(body);
        };

        res.json = function (body: any): Response {
          captureAndCache(body);
          return originalJson(body);
        };

        res.end = function (chunk?: any, ...args: any[]): Response {
          if (chunk) {
            captureAndCache(chunk);
          }
          return (originalEnd as any)(chunk, ...args);
        };

        res.on("error", reject);

        next();
      });
    };

    if (deduplicate) {
      try {
        await requestDedup.dedupe(cacheKey, executor);
      } catch (error) {
        next(error);
      }
    } else {
      try {
        await executor();
      } catch (error) {
        next(error);
      }
    }
  };
}

async function revalidateInBackground(
  req: Request,
  _res: Response,
  cacheKey: string,
  options: ResponseCacheOptions,
  _next: NextFunction
): Promise<void> {
  // Simple logging for now - proper background revalidation requires specialized logic
  // to run the request without sending response to client (since it's already sent)
  // For now we just let it expire naturally in next request
  console.log(`[ResponseCache] Stale hit for ${cacheKey} - revalidation skipped`);
}

export function clearResponseCache(pattern?: string): Promise<void> {
  // Redis doesn't support pattern deletion easily without SCAN
  // For now we assume namespace clearing if supported, or no-op
  // Implementation depends on RedisCacheService capabilities
  return Promise.resolve();
}

export function getResponseCacheStats(): CacheStats {
  return { ...stats };
}

export function resetResponseCacheStats(): void {
  stats.cacheHits = 0;
  stats.cacheMisses = 0;
  stats.staleHits = 0;
  stats.bypassedRequests = 0;
}

export function cacheEndpoint(ttlSeconds: number, options: Omit<ResponseCacheOptions, "ttl"> = {}): RequestHandler {
  return responseCache({
    ...options,
    ttl: ttlSeconds * 1000,
  });
}

export function noCacheEndpoint(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    next();
  };
}

export function privateCacheEndpoint(ttlSeconds: number): RequestHandler {
  return responseCache({
    ttl: ttlSeconds * 1000,
    keyGenerator: (req: Request) => {
      const userId = (req as any).user?.id || "anonymous";
      return generateCacheKey(req.method, req.originalUrl, `user:${userId}`);
    },
  });
}
