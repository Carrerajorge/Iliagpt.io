import { chromium, Browser, Page, BrowserContext, Request, Response } from "playwright";
import crypto from "crypto";
import { 
  SessionConfig, 
  DEFAULT_SESSION_CONFIG, 
  BrowserAction, 
  ActionResult, 
  Observation,
  NetworkRequest,
  PageState,
  SessionEvent,
  SessionEventCallback,
  ComputerSession
} from "./types";

interface ActiveSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  config: SessionConfig;
  objective: string;
  actions: BrowserAction[];
  observations: Observation[];
  networkRequests: NetworkRequest[];
  callbacks: Set<SessionEventCallback>;
  screenshotInterval?: ReturnType<typeof setInterval>;
  createdAt: Date;
  status: "active" | "paused" | "completed" | "error" | "cancelled";
}

class BrowserSessionManager {
  private static readonly MAX_SESSIONS = 10;
  private static readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private static readonly MAX_OBSERVATIONS = 500;
  private static readonly MAX_NETWORK_REQUESTS = 1000;

  private sessions: Map<string, ActiveSession> = new Map();
  private globalCallbacks: Set<SessionEventCallback> = new Set();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Periodic cleanup of stale sessions
    this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 60000);
  }

  private async cleanupStaleSessions(): Promise<void> {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt.getTime() > BrowserSessionManager.SESSION_TTL_MS) {
        console.warn(`[BrowserSessionManager] Cleaning up stale session ${id}`);
        await this.closeSession(id);
      }
    }
  }

  async createSession(
    objective: string,
    config: Partial<SessionConfig> = {},
    onEvent?: SessionEventCallback
  ): Promise<string> {
    if (this.sessions.size >= BrowserSessionManager.MAX_SESSIONS) {
      throw new Error(`Maximum number of browser sessions (${BrowserSessionManager.MAX_SESSIONS}) reached. Close existing sessions before creating new ones.`);
    }

    const sessionConfig = { ...DEFAULT_SESSION_CONFIG, ...config };
    const sessionId = crypto.randomUUID();

    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        `--window-size=${sessionConfig.viewport!.width},${sessionConfig.viewport!.height}`
      ]
    });

    const context = await browser.newContext({
      viewport: sessionConfig.viewport,
      userAgent: sessionConfig.userAgent || 
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      acceptDownloads: true
    });

    const page = await context.newPage();

    const session: ActiveSession = {
      id: sessionId,
      browser,
      context,
      page,
      config: sessionConfig,
      objective,
      actions: [],
      observations: [],
      networkRequests: [],
      callbacks: new Set(),
      createdAt: new Date(),
      status: "active"
    };

    if (onEvent) {
      session.callbacks.add(onEvent);
    }

    if (sessionConfig.enableNetworkCapture) {
      this.setupNetworkCapture(session);
    }

    this.sessions.set(sessionId, session);
    
    this.emitEvent(session, {
      type: "started",
      sessionId,
      timestamp: new Date(),
      data: { objective, config: sessionConfig }
    });

    return sessionId;
  }

  private setupNetworkCapture(session: ActiveSession): void {
    session.page.on("request", (request: Request) => {
      if (session.networkRequests.length >= BrowserSessionManager.MAX_NETWORK_REQUESTS) {
        session.networkRequests.shift(); // rotate oldest entry
      }
      const req: NetworkRequest = {
        url: request.url(),
        method: request.method()
      };
      session.networkRequests.push(req);
    });

    session.page.on("response", (response: Response) => {
      const url = response.url();
      const existing = session.networkRequests.find(r => r.url === url && !r.status);
      if (existing) {
        existing.status = response.status();
        existing.mimeType = response.headers()["content-type"];
      }
    });
  }

  private emitEvent(session: ActiveSession, event: SessionEvent): void {
    session.callbacks.forEach(cb => {
      try { cb(event); } catch (e) { console.error("Event callback error:", e); }
    });
    this.globalCallbacks.forEach(cb => {
      try { cb(event); } catch (e) { console.error("Global callback error:", e); }
    });
  }

  async navigate(sessionId: string, url: string): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const action: BrowserAction = {
      type: "navigate",
      params: { url },
      timestamp: new Date()
    };
    session.actions.push(action);

    const startTime = Date.now();

    try {
      if (session.config.allowedDomains && session.config.allowedDomains.length > 0) {
        const domain = new URL(url).hostname;
        const allowed = session.config.allowedDomains.some(d => 
          domain === d || domain.endsWith(`.${d}`)
        );
        if (!allowed) {
          return {
            success: false,
            action,
            error: `Domain ${domain} not in allowed list`,
            duration: Date.now() - startTime
          };
        }
      }

      await session.page.goto(url, {
        waitUntil: "networkidle",
        timeout: session.config.timeout
      });

      const screenshot = await this.captureScreenshot(session);
      
      this.emitEvent(session, {
        type: "action",
        sessionId,
        timestamp: new Date(),
        data: { action: "navigate", url, screenshot }
      });

      return {
        success: true,
        action,
        data: {
          url: session.page.url(),
          title: await session.page.title()
        },
        screenshot,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      this.emitEvent(session, {
        type: "error",
        sessionId,
        timestamp: new Date(),
        data: { action: "navigate", error: error.message }
      });

      return {
        success: false,
        action,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async click(sessionId: string, selector: string): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const action: BrowserAction = {
      type: "click",
      params: { selector },
      timestamp: new Date()
    };
    session.actions.push(action);

    const startTime = Date.now();

    try {
      await session.page.click(selector, { timeout: 10000 });
      await session.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      
      const screenshot = await this.captureScreenshot(session);

      this.emitEvent(session, {
        type: "action",
        sessionId,
        timestamp: new Date(),
        data: { action: "click", selector, screenshot }
      });

      return {
        success: true,
        action,
        data: { newUrl: session.page.url() },
        screenshot,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        action,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async type(sessionId: string, selector: string, text: string): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const action: BrowserAction = {
      type: "type",
      params: { selector, text },
      timestamp: new Date()
    };
    session.actions.push(action);

    const startTime = Date.now();

    try {
      await session.page.fill(selector, text, { timeout: 10000 });
      
      const screenshot = await this.captureScreenshot(session);

      this.emitEvent(session, {
        type: "action",
        sessionId,
        timestamp: new Date(),
        data: { action: "type", selector, textLength: text.length, screenshot }
      });

      return {
        success: true,
        action,
        screenshot,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        action,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async scroll(sessionId: string, direction: "up" | "down", amount: number = 300): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const action: BrowserAction = {
      type: "scroll",
      params: { direction, amount },
      timestamp: new Date()
    };
    session.actions.push(action);

    const startTime = Date.now();

    try {
      const scrollAmount = direction === "down" ? amount : -amount;
      await session.page.evaluate((y) => window.scrollBy(0, y), scrollAmount);
      await session.page.waitForTimeout(300);
      
      const screenshot = await this.captureScreenshot(session);

      this.emitEvent(session, {
        type: "action",
        sessionId,
        timestamp: new Date(),
        data: { action: "scroll", direction, amount, screenshot }
      });

      return {
        success: true,
        action,
        screenshot,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        action,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  async wait(sessionId: string, ms: number): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const action: BrowserAction = {
      type: "wait",
      params: { ms },
      timestamp: new Date()
    };
    session.actions.push(action);

    const startTime = Date.now();

    await session.page.waitForTimeout(ms);
    const screenshot = await this.captureScreenshot(session);

    return {
      success: true,
      action,
      screenshot,
      duration: Date.now() - startTime
    };
  }

  async evaluate(sessionId: string, script: string): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const action: BrowserAction = {
      type: "evaluate",
      params: { script },
      timestamp: new Date()
    };
    session.actions.push(action);

    const startTime = Date.now();

    try {
      const result = await session.page.evaluate(script);
      
      return {
        success: true,
        action,
        data: result,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        action,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  private async captureScreenshot(session: ActiveSession): Promise<string> {
    try {
      const buffer = await session.page.screenshot({ 
        type: "png",
        fullPage: false
      });
      return `data:image/png;base64,${buffer.toString("base64")}`;
    } catch {
      return "";
    }
  }

  async getPageState(sessionId: string): Promise<PageState | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    try {
      const state = await session.page.evaluate(`
        (function() {
          var walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null
          );
          var visibleText = "";
          var node;
          while (node = walker.nextNode()) {
            var parent = node.parentElement;
            if (parent && getComputedStyle(parent).display !== "none") {
              var txt = node.textContent;
              if (txt) visibleText += txt.trim() + " ";
            }
          }
          visibleText = visibleText.slice(0, 10000);

          var links = Array.from(document.querySelectorAll("a[href]")).slice(0, 50).map(function(a) {
            return {
              text: a.textContent ? a.textContent.trim() : "",
              href: a.href
            };
          });

          var forms = Array.from(document.querySelectorAll("form")).slice(0, 10).map(function(f) {
            return {
              action: f.action,
              inputs: Array.from(f.querySelectorAll("input, textarea, select")).map(function(i) {
                return i.name || i.id || "";
              }).filter(Boolean)
            };
          });

          var images = Array.from(document.querySelectorAll("img[src]")).slice(0, 20).map(function(i) {
            return {
              src: i.src,
              alt: i.alt
            };
          });

          var metaTags = {};
          document.querySelectorAll("meta[name], meta[property]").forEach(function(m) {
            var name = m.getAttribute("name") || m.getAttribute("property") || "";
            var content = m.getAttribute("content") || "";
            if (name && content) metaTags[name] = content;
          });

          var jsonLd = [];
          document.querySelectorAll('script[type="application/ld+json"]').forEach(function(s) {
            try {
              jsonLd.push(JSON.parse(s.textContent || ""));
            } catch(e) {}
          });

          return {
            url: window.location.href,
            title: document.title,
            visibleText: visibleText,
            links: links,
            forms: forms,
            images: images,
            metaTags: metaTags,
            jsonLd: jsonLd
          };
        })()
      `);

      const observation: Observation = {
        sessionId,
        timestamp: new Date(),
        type: "state",
        data: state
      };
      if (session.observations.length >= BrowserSessionManager.MAX_OBSERVATIONS) {
        session.observations.shift();
      }
      session.observations.push(observation);

      this.emitEvent(session, {
        type: "observation",
        sessionId,
        timestamp: new Date(),
        data: { type: "state", state }
      });

      return state as PageState;
    } catch (error) {
      console.error("Failed to get page state:", error);
      return null;
    }
  }

  async getScreenshot(sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const screenshot = await this.captureScreenshot(session);
    
    const observation: Observation = {
      sessionId,
      timestamp: new Date(),
      type: "screenshot",
      data: { screenshot }
    };
    session.observations.push(observation);

    this.emitEvent(session, {
      type: "observation",
      sessionId,
      timestamp: new Date(),
      data: { type: "screenshot", screenshot }
    });

    return screenshot;
  }

  startScreenshotStreaming(sessionId: string, intervalMs: number = 2000): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.screenshotInterval) {
      clearInterval(session.screenshotInterval);
    }

    session.screenshotInterval = setInterval(async () => {
      if (session.status !== "active") {
        this.stopScreenshotStreaming(sessionId);
        return;
      }
      await this.getScreenshot(sessionId);
    }, intervalMs);
  }

  stopScreenshotStreaming(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.screenshotInterval) {
      clearInterval(session.screenshotInterval);
      session.screenshotInterval = undefined;
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.stopScreenshotStreaming(sessionId);

    session.status = "completed";

    this.emitEvent(session, {
      type: "completed",
      sessionId,
      timestamp: new Date(),
      data: {
        actions: session.actions.length,
        observations: session.observations.length,
        duration: Date.now() - session.createdAt.getTime()
      }
    });

    try {
      await session.context.clearCookies();
      await session.context.close();
      await session.browser.close();
    } catch (e) {
      console.error("Error closing session:", e);
    }

    this.sessions.delete(sessionId);
  }

  async cancelSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "cancelled";

    this.emitEvent(session, {
      type: "cancelled",
      sessionId,
      timestamp: new Date(),
      data: { reason: "User cancelled" }
    });

    await this.closeSession(sessionId);
  }

  getSession(sessionId: string): ComputerSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      status: session.status,
      startedAt: session.createdAt,
      objective: session.objective,
      actions: session.actions,
      observations: session.observations,
      currentUrl: session.page.url(),
      currentTitle: undefined
    };
  }

  addGlobalEventListener(callback: SessionEventCallback): void {
    this.globalCallbacks.add(callback);
  }

  removeGlobalEventListener(callback: SessionEventCallback): void {
    this.globalCallbacks.delete(callback);
  }

  addSessionEventListener(sessionId: string, callback: SessionEventCallback): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.callbacks.add(callback);
    }
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  async cleanup(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const id of sessionIds) {
      await this.closeSession(id);
    }
  }
}

export const browserSessionManager = new BrowserSessionManager();
