import { z } from "zod";
import { validateOrThrow } from "../validation";
import { sandboxSecurity } from "../sandboxSecurity";
import { browserWorker } from "../browser-worker";
import { resourceCleanup, CancellationToken, CancellationError } from "../executionEngine";
import { extractDomain } from "./canonicalizeUrl";
import { 
  BrowseRequestSchema,
  BrowseOptionsSchema,
  type BrowseRequest, 
  type BrowseResult, 
  type BrowseOptions,
  type WaitStrategy,
  type ScrollPaginationOptions,
} from "./types";

export const BrowserUrlSchema = z.string().min(1).max(8192);

export interface IBrowserAdapter {
  browse(url: string, options?: Partial<BrowseOptions>, cancellationToken?: CancellationToken): Promise<BrowseResult>;
  screenshot(url: string): Promise<Buffer | null>;
  isUrlAllowed(url: string): boolean;
}

const DEFAULT_BROWSE_OPTIONS: BrowseOptions = {
  timeout: 30000,
  takeScreenshot: false,
  waitForNetworkIdle: true,
  waitStrategy: "networkidle",
  extractContent: true,
};

export type NavigationError = {
  code: "timeout" | "blocked" | "failed" | "cancelled" | "security";
  message: string;
  url: string;
};

export class PlaywrightBrowserAdapter implements IBrowserAdapter {
  private activeSessions: Set<string> = new Set();
  
  isUrlAllowed(url: string): boolean {
    try {
      const validatedUrl = validateOrThrow(BrowserUrlSchema, url, "BrowserAdapter.isUrlAllowed");
      const domain = extractDomain(validatedUrl);
      if (!domain) {
        return false;
      }
      return sandboxSecurity.isHostAllowed(domain);
    } catch {
      return false;
    }
  }
  
  async browse(
    url: string, 
    options?: Partial<BrowseOptions>,
    cancellationToken?: CancellationToken
  ): Promise<BrowseResult> {
    const validatedUrl = validateOrThrow(BrowserUrlSchema, url, "BrowserAdapter.browse.url");
    
    const request: BrowseRequest = validateOrThrow(
      BrowseRequestSchema,
      { url: validatedUrl, options },
      "BrowserAdapter.browse"
    );
    
    const mergedOptions: BrowseOptions = {
      ...DEFAULT_BROWSE_OPTIONS,
      ...options,
    };
    
    const startTime = Date.now();
    let sessionId: string | null = null;
    
    try {
      if (cancellationToken?.isCancelled) {
        throw new CancellationError("Operation cancelled before starting");
      }
      
      const domain = extractDomain(validatedUrl);
      if (!sandboxSecurity.isHostAllowed(domain)) {
        console.warn(`[BrowserAdapter] Host blocked by sandbox security: ${domain}`);
        return this.createErrorResult(validatedUrl, startTime, {
          code: "security",
          message: `Host '${domain}' is not allowed by sandbox security policy`,
          url: validatedUrl,
        });
      }
      
      sessionId = await browserWorker.createSession();
      this.activeSessions.add(sessionId);
      
      if (cancellationToken) {
        const correlationId = cancellationToken["correlationId"];
        if (correlationId) {
          resourceCleanup.register(correlationId, async () => {
            if (sessionId) {
              await this.destroySession(sessionId);
            }
          });
        }
      }
      
      const navigationResult = await browserWorker.navigate(
        sessionId, 
        validatedUrl, 
        mergedOptions.takeScreenshot
      );
      
      const navigationTime = Date.now() - startTime;
      
      if (!navigationResult.success) {
        const errorCode = this.classifyNavigationError(navigationResult.error);
        return this.createErrorResult(validatedUrl, startTime, {
          code: errorCode,
          message: navigationResult.error || "Navigation failed",
          url: validatedUrl,
        }, navigationResult.timing);
      }
      
      cancellationToken?.throwIfCancelled();
      
      let content: string | undefined;
      let html = navigationResult.html;
      
      if (mergedOptions.scrollPagination?.enabled && sessionId) {
        html = await this.performScrollPagination(
          sessionId,
          mergedOptions.scrollPagination,
          cancellationToken
        ) || html;
      }
      
      if (mergedOptions.extractContent && html) {
        content = this.extractTextContent(html);
      }
      
      const renderTime = Date.now() - startTime - navigationTime;
      
      return {
        success: true,
        url: validatedUrl,
        finalUrl: navigationResult.url,
        title: navigationResult.title,
        content,
        html,
        screenshot: navigationResult.screenshot,
        timing: {
          navigationMs: navigationResult.timing.navigationMs,
          renderMs: navigationResult.timing.renderMs,
          totalMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      if (error instanceof CancellationError) {
        return this.createErrorResult(validatedUrl, startTime, {
          code: "cancelled",
          message: error.message,
          url: validatedUrl,
        });
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = this.classifyNavigationError(errorMessage);
      
      return this.createErrorResult(validatedUrl, startTime, {
        code: errorCode,
        message: errorMessage,
        url: validatedUrl,
      });
    } finally {
      if (sessionId) {
        await this.destroySession(sessionId);
      }
    }
  }
  
  private createErrorResult(
    url: string,
    startTime: number,
    error: NavigationError,
    timing?: { navigationMs: number; renderMs: number }
  ): BrowseResult {
    return {
      success: false,
      url,
      finalUrl: url,
      title: "",
      timing: {
        navigationMs: timing?.navigationMs || 0,
        renderMs: timing?.renderMs || 0,
        totalMs: Date.now() - startTime,
      },
      error: error.message,
    };
  }
  
  private classifyNavigationError(error?: string): NavigationError["code"] {
    if (!error) return "failed";
    const lowerError = error.toLowerCase();
    if (lowerError.includes("timeout")) return "timeout";
    if (lowerError.includes("cancel")) return "cancelled";
    if (lowerError.includes("blocked") || lowerError.includes("security")) return "blocked";
    return "failed";
  }
  
  private async performScrollPagination(
    sessionId: string,
    options: ScrollPaginationOptions,
    cancellationToken?: CancellationToken
  ): Promise<string | null> {
    const maxScrolls = options.maxScrolls || 10;
    const scrollDelay = options.scrollDelayMs || 500;
    
    try {
      for (let i = 0; i < maxScrolls; i++) {
        if (cancellationToken?.isCancelled) {
          break;
        }
        
        await this.sleep(scrollDelay);
      }
      
      return null;
    } catch (error) {
      console.warn("[BrowserAdapter] Scroll pagination failed:", error);
      return null;
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async screenshot(url: string): Promise<Buffer | null> {
    let sessionId: string | null = null;
    
    try {
      sessionId = await browserWorker.createSession();
      this.activeSessions.add(sessionId);
      
      const result = await browserWorker.navigate(sessionId, url, true);
      
      return result.screenshot || null;
    } catch (error) {
      console.error(`[BrowserAdapter] Screenshot failed for ${url}:`, error);
      return null;
    } finally {
      if (sessionId) {
        await this.destroySession(sessionId);
      }
    }
  }
  
  private async destroySession(sessionId: string): Promise<void> {
    try {
      this.activeSessions.delete(sessionId);
      await browserWorker.destroySession(sessionId);
    } catch (error) {
      console.warn(`[BrowserAdapter] Failed to destroy session ${sessionId}:`, error);
    }
  }
  
  private extractTextContent(html: string): string {
    let text = html;
    
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");
    text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
    text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
    text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
    text = text.replace(/<!--[\s\S]*?-->/g, "");
    
    text = text.replace(/<[^>]+>/g, " ");
    
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#?\w+;/g, " ");
    
    text = text.replace(/\s+/g, " ").trim();
    
    return text;
  }
  
  async cleanup(): Promise<void> {
    const sessions = Array.from(this.activeSessions);
    await Promise.all(sessions.map(id => this.destroySession(id)));
  }
  
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }
}

export const browserAdapter = new PlaywrightBrowserAdapter();
