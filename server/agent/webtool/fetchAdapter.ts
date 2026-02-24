import { z } from "zod";
import { validateOrThrow } from "../validation";
import { sandboxSecurity } from "../sandboxSecurity";
import { resourceCleanup, CancellationToken, CancellationError } from "../executionEngine";
import { extractDomain } from "./canonicalizeUrl";
import { 
  FetchRequestSchema, 
  FetchOptionsSchema,
  type FetchRequest, 
  type FetchResult, 
  type FetchOptions 
} from "./types";
import { HTTP_HEADERS } from "../../lib/constants";

export const UrlInputSchema = z.string().min(1).max(8192);

export interface IFetchAdapter {
  fetch(url: string, options?: Partial<FetchOptions>, cancellationToken?: CancellationToken): Promise<FetchResult>;
  checkRobotsTxt(url: string): Promise<boolean>;
  isUrlAllowed(url: string): boolean;
}

const DEFAULT_FETCH_OPTIONS: FetchOptions = {
  timeout: 30000,
  retries: 3,
  respectRobotsTxt: true,
  followRedirects: true,
  maxRedirects: 5,
};

const robotsTxtCache = new Map<string, { allowed: boolean; expiry: number }>();
const ROBOTS_CACHE_TTL = 60 * 60 * 1000;

export class HttpFetchAdapter implements IFetchAdapter {
  private readonly userAgent: string;
  private activeRequests: Map<string, AbortController> = new Map();
  
  constructor(userAgent?: string) {
    this.userAgent = userAgent || HTTP_HEADERS.USER_AGENT;
  }
  
  isUrlAllowed(url: string): boolean {
    try {
      const validatedUrl = validateOrThrow(UrlInputSchema, url, "FetchAdapter.isUrlAllowed");
      const domain = extractDomain(validatedUrl);
      if (!domain) {
        return false;
      }
      return sandboxSecurity.isHostAllowed(domain);
    } catch {
      return false;
    }
  }
  
  async fetch(
    url: string, 
    options?: Partial<FetchOptions>,
    cancellationToken?: CancellationToken
  ): Promise<FetchResult> {
    const validatedUrl = validateOrThrow(UrlInputSchema, url, "FetchAdapter.fetch.url");
    
    const request: FetchRequest = validateOrThrow(
      FetchRequestSchema,
      { url: validatedUrl, options },
      "FetchAdapter.fetch"
    );
    
    const mergedOptions: FetchOptions = {
      ...DEFAULT_FETCH_OPTIONS,
      ...options,
    };
    
    const startMs = Date.now();
    let retryCount = 0;
    let lastError: Error | null = null;
    
    if (cancellationToken?.isCancelled) {
      return {
        success: false,
        url: validatedUrl,
        finalUrl: validatedUrl,
        status: 0,
        statusText: "Cancelled",
        headers: {},
        contentLength: 0,
        timing: {
          startMs,
          endMs: Date.now(),
          durationMs: Date.now() - startMs,
        },
        retryCount: 0,
        error: "Operation cancelled before starting",
      };
    }
    
    const domain = extractDomain(validatedUrl);
    if (!sandboxSecurity.isHostAllowed(domain)) {
      console.warn(`[FetchAdapter] Host blocked by sandbox security: ${domain}`);
      return {
        success: false,
        url: validatedUrl,
        finalUrl: validatedUrl,
        status: 403,
        statusText: "Forbidden by sandbox security",
        headers: {},
        contentLength: 0,
        timing: {
          startMs,
          endMs: Date.now(),
          durationMs: Date.now() - startMs,
        },
        retryCount: 0,
        error: `Host '${domain}' is not allowed by sandbox security policy`,
      };
    }
    
    if (mergedOptions.respectRobotsTxt) {
      const allowed = await this.checkRobotsTxt(validatedUrl);
      if (!allowed) {
        return {
          success: false,
          url: validatedUrl,
          finalUrl: validatedUrl,
          status: 403,
          statusText: "Forbidden by robots.txt",
          headers: {},
          contentLength: 0,
          timing: {
            startMs,
            endMs: Date.now(),
            durationMs: Date.now() - startMs,
          },
          retryCount: 0,
          error: "URL blocked by robots.txt",
        };
      }
    }
    
    const requestId = `${validatedUrl}-${Date.now()}`;
    
    while (retryCount <= mergedOptions.retries) {
      try {
        if (cancellationToken?.isCancelled) {
          throw new CancellationError("Operation cancelled during retry");
        }
        
        const controller = new AbortController();
        this.activeRequests.set(requestId, controller);
        
        if (cancellationToken) {
          cancellationToken.onCancelled(() => {
            controller.abort();
          });
        }
        
        const timeoutId = setTimeout(() => controller.abort(), mergedOptions.timeout);
        
        const headers: Record<string, string> = {
          "User-Agent": this.userAgent,
          "Accept": HTTP_HEADERS.ACCEPT_HTML,
          "Accept-Language": HTTP_HEADERS.ACCEPT_LANGUAGE,
          ...mergedOptions.headers,
        };
        
        const response = await fetch(validatedUrl, {
          signal: controller.signal,
          headers,
          redirect: mergedOptions.followRedirects ? "follow" : "manual",
        });
        
        clearTimeout(timeoutId);
        this.activeRequests.delete(requestId);
        
        const endMs = Date.now();
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value;
        });
        
        let content: string | undefined;
        const contentType = responseHeaders["content-type"] || "";
        
        if (contentType.includes("text/") || contentType.includes("application/json") || contentType.includes("application/xml")) {
          content = await response.text();
        }
        
        const contentLength = content?.length || parseInt(responseHeaders["content-length"] || "0", 10);
        
        return {
          success: response.ok,
          url: validatedUrl,
          finalUrl: response.url,
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          content,
          contentType,
          contentLength,
          timing: {
            startMs,
            endMs,
            durationMs: endMs - startMs,
          },
          retryCount,
        };
      } catch (error) {
        this.activeRequests.delete(requestId);
        
        if (error instanceof CancellationError) {
          return {
            success: false,
            url: validatedUrl,
            finalUrl: validatedUrl,
            status: 0,
            statusText: "Cancelled",
            headers: {},
            contentLength: 0,
            timing: {
              startMs,
              endMs: Date.now(),
              durationMs: Date.now() - startMs,
            },
            retryCount,
            error: error.message,
          };
        }
        
        lastError = error instanceof Error ? error : new Error(String(error));
        
        const isRetryable = this.isRetryableError(lastError);
        
        if (!isRetryable || retryCount >= mergedOptions.retries) {
          break;
        }
        
        retryCount++;
        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
        await this.sleep(delay);
      }
    }
    
    const endMs = Date.now();
    return {
      success: false,
      url: validatedUrl,
      finalUrl: validatedUrl,
      status: 0,
      statusText: "Request failed",
      headers: {},
      contentLength: 0,
      timing: {
        startMs,
        endMs,
        durationMs: endMs - startMs,
      },
      retryCount,
      error: lastError?.message || "Unknown error",
    };
  }
  
  cancelAllRequests(): void {
    for (const [requestId, controller] of this.activeRequests) {
      controller.abort();
      this.activeRequests.delete(requestId);
    }
  }
  
  getActiveRequestCount(): number {
    return this.activeRequests.size;
  }
  
  async checkRobotsTxt(url: string): Promise<boolean> {
    try {
      const domain = extractDomain(url);
      const cacheKey = domain;
      
      const cached = robotsTxtCache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        return cached.allowed;
      }
      
      const parsedUrl = new URL(url);
      const robotsUrl = `${parsedUrl.protocol}//${parsedUrl.host}/robots.txt`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(robotsUrl, {
        signal: controller.signal,
        headers: { "User-Agent": this.userAgent },
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        robotsTxtCache.set(cacheKey, { allowed: true, expiry: Date.now() + ROBOTS_CACHE_TTL });
        return true;
      }
      
      const robotsTxt = await response.text();
      const allowed = this.parseRobotsTxt(robotsTxt, parsedUrl.pathname);
      
      robotsTxtCache.set(cacheKey, { allowed, expiry: Date.now() + ROBOTS_CACHE_TTL });
      
      return allowed;
    } catch {
      return true;
    }
  }
  
  private parseRobotsTxt(robotsTxt: string, path: string): boolean {
    const lines = robotsTxt.split("\n");
    let isRelevantUserAgent = false;
    let globalDisallow: string[] = [];
    let specificDisallow: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      
      if (trimmed.startsWith("user-agent:")) {
        const agent = trimmed.slice("user-agent:".length).trim();
        isRelevantUserAgent = agent === "*" || agent.includes("bot") || agent.includes("crawler");
      } else if (trimmed.startsWith("disallow:") && isRelevantUserAgent) {
        const disallowPath = line.slice(line.indexOf(":") + 1).trim();
        if (disallowPath) {
          if (isRelevantUserAgent) {
            specificDisallow.push(disallowPath);
          } else {
            globalDisallow.push(disallowPath);
          }
        }
      }
    }
    
    const disallowPaths = [...specificDisallow, ...globalDisallow];
    
    for (const disallowPath of disallowPaths) {
      if (disallowPath === "/") {
        return false;
      }
      if (path.startsWith(disallowPath)) {
        return false;
      }
      if (disallowPath.endsWith("*")) {
        const prefix = disallowPath.slice(0, -1);
        if (path.startsWith(prefix)) {
          return false;
        }
      }
    }
    
    return true;
  }
  
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("network") ||
      message.includes("socket")
      // "abort" removed: aborted requests are intentionally cancelled and should not be retried
    );
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const fetchAdapter = new HttpFetchAdapter();
