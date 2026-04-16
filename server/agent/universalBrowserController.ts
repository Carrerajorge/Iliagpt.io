/**
 * Universal Browser Controller - Agentic Multi-Browser Control
 *
 * Features:
 * - Multi-tab/multi-window management
 * - Self-correcting navigation loops
 * - Intelligent element detection (CSS + XPath + visual)
 * - Form auto-fill with context understanding
 * - Cookie/session persistence across sessions
 * - Download management
 * - Network request interception and modification
 * - Performance monitoring
 * - Anti-detection measures (stealth mode)
 * - Proxy support
 * - Agentic task chains (login -> navigate -> extract -> verify)
 */

import { chromium, firefox, webkit, Browser, Page, BrowserContext, Route, Request as PlaywrightRequest } from "playwright";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { getGeminiClientOrThrow } from "../lib/gemini";

// ============================================
// Types
// ============================================

export type BrowserType = "chromium" | "firefox" | "webkit";

export interface BrowserProfile {
  id: string;
  name: string;
  browserType: BrowserType;
  userAgent?: string;
  viewport: { width: number; height: number };
  locale?: string;
  timezone?: string;
  geolocation?: { latitude: number; longitude: number };
  proxy?: { server: string; username?: string; password?: string };
  cookies?: Array<{ name: string; value: string; domain: string; path?: string }>;
  localStorage?: Record<string, Record<string, string>>;
  headers?: Record<string, string>;
  stealth?: boolean;
}

export interface Tab {
  id: string;
  page: Page;
  url: string;
  title: string;
  active: boolean;
  createdAt: number;
}

export interface BrowserSession {
  id: string;
  profile: BrowserProfile;
  browser: Browser;
  context: BrowserContext;
  tabs: Map<string, Tab>;
  activeTabId: string | null;
  downloadDir: string;
  networkLogs: NetworkLog[];
  createdAt: number;
  lastActivity: number;
}

export interface NetworkLog {
  url: string;
  method: string;
  status?: number;
  headers: Record<string, string>;
  timestamp: number;
  duration?: number;
  size?: number;
  resourceType: string;
}

export interface ElementInfo {
  selector: string;
  xpath: string;
  tag: string;
  text: string;
  attributes: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  isVisible: boolean;
  isEnabled: boolean;
  computedStyles?: Record<string, string>;
}

export interface ExtractionRule {
  name: string;
  selector: string;
  type: "text" | "html" | "attribute" | "list" | "table" | "screenshot";
  attribute?: string;
  transform?: "trim" | "lowercase" | "uppercase" | "number" | "date";
  children?: ExtractionRule[];
}

export interface AgenticTask {
  id: string;
  name: string;
  steps: AgenticStep[];
  retryPolicy: { maxRetries: number; backoffMs: number };
  timeout: number;
  variables: Record<string, any>;
  onError: "retry" | "skip" | "abort";
}

export interface AgenticStep {
  id: string;
  action: "navigate" | "click" | "type" | "extract" | "wait" | "scroll" | "screenshot"
  | "select" | "upload" | "download" | "evaluate" | "condition" | "loop"
  | "switch_tab" | "new_tab" | "close_tab" | "assert" | "store_variable";
  params: Record<string, any>;
  selector?: string;
  description: string;
  expectedResult?: string;
  continueOnError?: boolean;
  retries?: number;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  results: StepResult[];
  extractedData: Record<string, any>;
  screenshots: string[];
  errors: string[];
  duration: number;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  data?: any;
  error?: string;
  screenshot?: string;
  duration: number;
}

// ============================================
// Stealth Plugin Configuration
// ============================================

const STEALTH_SCRIPTS = `
  // Override webdriver detection
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // Override chrome detection
  window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };

  // Override permissions
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );

  // Override plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });

  // Override languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en', 'es'],
  });

  // Override platform
  Object.defineProperty(navigator, 'platform', {
    get: () => 'Win32',
  });

  // Override hardware concurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
  });

  // Override WebGL renderer
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel Iris OpenGL Engine';
    return getParameter.call(this, parameter);
  };
`;

// ============================================
// Universal Browser Controller
// ============================================

export class UniversalBrowserController extends EventEmitter {
  private sessions: Map<string, BrowserSession> = new Map();
  private profiles: Map<string, BrowserProfile> = new Map();
  private llmClient: OpenAI;
  private baseWorkDir: string;

  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private maxSessionAge = 30 * 60 * 1000; // 30 minutes

  constructor(options?: {
    workDir?: string;
    apiKey?: string;
    baseURL?: string;
  }) {
    super();
    this.baseWorkDir = options?.workDir || "/tmp/browser-controller";
    this.llmClient = new OpenAI({
      baseURL: options?.baseURL || (process.env.XAI_API_KEY ? "https://api.x.ai/v1" : "https://api.openai.com/v1"),
      apiKey: options?.apiKey || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY || "missing",
      timeout: 30000,
      maxRetries: 3,
    });

    // Register default profiles
    this.registerDefaultProfiles();

    // Periodically clean up stale sessions
    this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 5 * 60 * 1000);
  }

  private async cleanupStaleSessions(): Promise<void> {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.maxSessionAge) {
        await this.closeSession(id).catch(() => { });
      }
    }
  }

  private registerDefaultProfiles(): void {
    const defaults: BrowserProfile[] = [
      {
        id: "chrome-desktop",
        name: "Chrome Desktop",
        browserType: "chromium",
        viewport: { width: 1920, height: 1080 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        stealth: true,
      },
      {
        id: "firefox-desktop",
        name: "Firefox Desktop",
        browserType: "firefox",
        viewport: { width: 1920, height: 1080 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
      },
      {
        id: "safari-desktop",
        name: "Safari Desktop",
        browserType: "webkit",
        viewport: { width: 1440, height: 900 },
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      },
      {
        id: "mobile-iphone",
        name: "iPhone Safari",
        browserType: "webkit",
        viewport: { width: 390, height: 844 },
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      },
      {
        id: "mobile-android",
        name: "Android Chrome",
        browserType: "chromium",
        viewport: { width: 412, height: 915 },
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      },
    ];

    for (const profile of defaults) {
      this.profiles.set(profile.id, profile);
    }
  }

  // ============================================
  // Session Management
  // ============================================

  async createSession(profileId: string = "chrome-desktop", customProfile?: Partial<BrowserProfile>): Promise<string> {
    const baseProfile = this.profiles.get(profileId) || this.profiles.get("chrome-desktop")!;
    const profile: BrowserProfile = { ...baseProfile, ...customProfile, id: customProfile?.id || baseProfile.id };

    const sessionId = randomUUID();
    const downloadDir = path.join(this.baseWorkDir, sessionId, "downloads");
    await fs.mkdir(downloadDir, { recursive: true });

    // Launch browser based on type
    const launchOptions = {
      headless: true,
      args: profile.browserType === "chromium" ? [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        `--window-size=${profile.viewport.width},${profile.viewport.height}`,
      ] : [],
    };

    let browser: Browser;
    switch (profile.browserType) {
      case "firefox":
        browser = await firefox.launch(launchOptions);
        break;
      case "webkit":
        browser = await webkit.launch(launchOptions);
        break;
      default:
        browser = await chromium.launch(launchOptions);
    }

    const contextOptions: any = {
      viewport: profile.viewport,
      userAgent: profile.userAgent,
      locale: profile.locale || "en-US",
      timezoneId: profile.timezone,
      geolocation: profile.geolocation,
      permissions: profile.geolocation ? ["geolocation"] : [],
      acceptDownloads: true,
      extraHTTPHeaders: profile.headers,
    };

    if (profile.proxy) {
      contextOptions.proxy = profile.proxy;
    }

    const context = await browser.newContext(contextOptions);

    // Apply stealth scripts if enabled
    if (profile.stealth) {
      await context.addInitScript(STEALTH_SCRIPTS);
    }

    // Set cookies if provided
    if (profile.cookies?.length) {
      await context.addCookies(profile.cookies as any);
    }

    const session: BrowserSession = {
      id: sessionId,
      profile,
      browser,
      context,
      tabs: new Map(),
      activeTabId: null,
      downloadDir,
      networkLogs: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    // Set up network logging
    context.on("request", (request: PlaywrightRequest) => {
      session.networkLogs.push({
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        timestamp: Date.now(),
        resourceType: request.resourceType(),
      });
      // Keep only last 500 logs
      if (session.networkLogs.length > 500) {
        session.networkLogs = session.networkLogs.slice(-500);
      }
    });

    this.sessions.set(sessionId, session);

    // Open first tab
    const tabId = await this.newTab(sessionId);
    session.activeTabId = tabId;

    this.emit("session:created", { sessionId, profile: profile.name });
    return sessionId;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    await session.browser.close().catch(() => { });
    this.sessions.delete(sessionId);
    this.emit("session:closed", { sessionId });
  }

  // ============================================
  // Tab Management
  // ============================================

  async newTab(sessionId: string, url?: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const page = await session.context.newPage();
    const tabId = randomUUID();

    if (url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    }

    const tab: Tab = {
      id: tabId,
      page,
      url: page.url(),
      title: await page.title().catch(() => ""),
      active: true,
      createdAt: Date.now(),
    };

    // Deactivate other tabs
    for (const [, t] of session.tabs) {
      t.active = false;
    }

    session.tabs.set(tabId, tab);
    session.activeTabId = tabId;
    page.on("close", () => {
      const currentSession = this.sessions.get(sessionId);
      if (!currentSession) return;
      currentSession.tabs.delete(tabId);
      if (currentSession.activeTabId === tabId) {
        const remaining = Array.from(currentSession.tabs.entries()).find(([, t]) => !t.page.isClosed());
        currentSession.activeTabId = remaining ? remaining[0] : null;
        if (remaining) {
          for (const [, t] of currentSession.tabs) {
            t.active = false;
          }
          remaining[1].active = true;
        }
      }
    });

    return tabId;
  }

  async switchTab(sessionId: string, tabId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const tab = session.tabs.get(tabId);
    if (!tab) throw new Error(`Tab not found: ${tabId}`);

    for (const [, t] of session.tabs) {
      t.active = false;
    }
    tab.active = true;
    session.activeTabId = tabId;
    try {
      await tab.page.bringToFront();
    } catch (error: any) {
      throw new Error(`Failed to switch tab: ${error.message}`);
    }
  }

  async closeTab(sessionId: string, tabId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const tab = session.tabs.get(tabId);
    if (!tab) return;

    await tab.page.close();
    session.tabs.delete(tabId);

    if (session.activeTabId === tabId) {
      const remaining = Array.from(session.tabs.keys());
      session.activeTabId = remaining.length > 0 ? remaining[0] : null;
      if (session.activeTabId) {
        const nextTab = session.tabs.get(session.activeTabId)!;
        nextTab.active = true;
      }
    }
  }

  listTabs(sessionId: string): Array<{ id: string; url: string; title: string; active: boolean }> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    return Array.from(session.tabs.values()).map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: t.active,
    }));
  }

  // ============================================
  // Navigation
  // ============================================

  async navigate(sessionId: string, url: string, options?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
    timeout?: number;
    tabId?: string;
  }): Promise<{ success: boolean; url: string; title: string; status?: number }> {
    const page = this.getActivePage(sessionId, options?.tabId);

    try {
      const response = await page.goto(url, {
        waitUntil: options?.waitUntil || "domcontentloaded",
        timeout: options?.timeout || 30000,
      });

      const tab = this.getActiveTab(sessionId, options?.tabId);
      if (tab) {
        tab.url = page.url();
        tab.title = await page.title();
      }

      return {
        success: true,
        url: page.url(),
        title: await page.title(),
        status: response?.status(),
      };
    } catch (error: any) {
      return { success: false, url: page.url(), title: "", status: undefined };
    }
  }

  async goBack(sessionId: string): Promise<void> {
    const page = this.getActivePage(sessionId);
    await page.goBack({ waitUntil: "domcontentloaded" });
  }

  async goForward(sessionId: string): Promise<void> {
    const page = this.getActivePage(sessionId);
    await page.goForward({ waitUntil: "domcontentloaded" });
  }

  async reload(sessionId: string): Promise<void> {
    const page = this.getActivePage(sessionId);
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  // ============================================
  // Interaction
  // ============================================

  async click(sessionId: string, selector: string, options?: {
    button?: "left" | "right" | "middle";
    clickCount?: number;
    timeout?: number;
    force?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    const page = this.getActivePage(sessionId);
    const session = this.sessions.get(sessionId);
    const timeout = options?.timeout || 5000;

    const clickFirstVisible = async (candidateSelector: string): Promise<boolean> => {
      const locator = page.locator(candidateSelector);
      const count = Math.min(await locator.count(), 20);
      if (count === 0) return false;
      for (let i = 0; i < count; i++) {
        const item = locator.nth(i);
        try {
          const visible = await item.isVisible();
          if (!visible && !options?.force) continue;
          const enabled = await item.isEnabled().catch(() => true);
          if (!enabled && !options?.force) continue;
          await item.click({
            button: options?.button || "left",
            clickCount: options?.clickCount || 1,
            timeout: Math.min(timeout, 3000),
            force: options?.force || false,
          });
          return true;
        } catch {
          // Try next candidate
        }
      }
      return false;
    };

    try {
      let clicked = await clickFirstVisible(selector);
      if (!clicked) {
        await page.click(selector, {
          button: options?.button || "left",
          clickCount: options?.clickCount || 1,
          timeout,
          force: options?.force || false,
        });
        clicked = true;
      }
      if (!clicked) {
        return { success: false, error: `No clickable visible element for selector: ${selector}` };
      }
      if (session) session.lastActivity = Date.now();
      return { success: true };
    } catch (error: any) {
      // Try alternative selectors
      const alternatives = await this.findAlternativeSelectors(page, selector);
      for (const alt of alternatives) {
        try {
          const clicked = await clickFirstVisible(alt);
          if (!clicked) {
            await page.click(alt, { timeout: 3000 });
          }
          if (session) session.lastActivity = Date.now();
          return { success: true };
        } catch {
          continue;
        }
      }
      return { success: false, error: error.message };
    }
  }

  async type(sessionId: string, selector: string, text: string, options?: {
    clear?: boolean;
    delay?: number;
    pressEnter?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    const page = this.getActivePage(sessionId);
    const session = this.sessions.get(sessionId);

    try {
      if (options?.clear) {
        await page.fill(selector, "");
      }
      await page.fill(selector, text);

      if (options?.pressEnter) {
        await page.press(selector, "Enter");
      }
      if (session) session.lastActivity = Date.now();
      return { success: true };
    } catch (error: any) {
      // Fallback: click + keyboard.type
      try {
        await page.click(selector, { timeout: 3000 });
        if (options?.clear) {
          await page.keyboard.press("Control+a");
          await page.keyboard.press("Delete");
        }
        await page.keyboard.type(text, { delay: options?.delay || 30 });
        if (options?.pressEnter) {
          await page.keyboard.press("Enter");
        }
        if (session) session.lastActivity = Date.now();
        return { success: true };
      } catch (fallbackErr: any) {
        return { success: false, error: fallbackErr.message };
      }
    }
  }

  async select(sessionId: string, selector: string, values: string | string[]): Promise<{ success: boolean; selected: string[] }> {
    const page = this.getActivePage(sessionId);
    const session = this.sessions.get(sessionId);
    const selected = await page.selectOption(selector, values);
    if (session) session.lastActivity = Date.now();
    return { success: true, selected };
  }

  async hover(sessionId: string, selector: string): Promise<void> {
    const page = this.getActivePage(sessionId);
    const session = this.sessions.get(sessionId);
    await page.hover(selector);
    if (session) session.lastActivity = Date.now();
  }

  async scroll(sessionId: string, options: {
    direction: "up" | "down" | "left" | "right";
    amount?: number;
    selector?: string;
  }): Promise<void> {
    const page = this.getActivePage(sessionId);

    if (options.selector) {
      await page.locator(options.selector).scrollIntoViewIfNeeded();
    } else {
      const delta = options.amount || 500;
      const deltaMap = {
        up: { x: 0, y: -delta },
        down: { x: 0, y: delta },
        left: { x: -delta, y: 0 },
        right: { x: delta, y: 0 },
      };
      const d = deltaMap[options.direction];
      await page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx: d.x, dy: d.y });
    }
  }

  async uploadFile(sessionId: string, selector: string, filePaths: string[]): Promise<void> {
    const page = this.getActivePage(sessionId);
    await page.setInputFiles(selector, filePaths);
  }

  // ============================================
  // Data Extraction
  // ============================================

  async extract(sessionId: string, rules: ExtractionRule[]): Promise<Record<string, any>> {
    const page = this.getActivePage(sessionId);
    const results: Record<string, any> = {};

    for (const rule of rules) {
      try {
        switch (rule.type) {
          case "text":
            if (rule.selector === "page") {
              results[rule.name] = await page.evaluate(() => document.body?.innerText || "");
            } else {
              const el = await page.$(rule.selector);
              results[rule.name] = el ? await el.innerText() : null;
            }
            break;

          case "html":
            results[rule.name] = await page.$eval(rule.selector, el => el.innerHTML);
            break;

          case "attribute":
            results[rule.name] = await page.$eval(
              rule.selector,
              (el, attr) => el.getAttribute(attr || ""),
              rule.attribute || ""
            );
            break;

          case "list":
            results[rule.name] = await page.$$eval(rule.selector, (elements) =>
              elements.map(el => (el as HTMLElement).innerText?.trim()).filter(Boolean)
            );
            break;

          case "table":
            results[rule.name] = await page.$eval(rule.selector, (table) => {
              const rows = Array.from(table.querySelectorAll("tr"));
              return rows.map(row =>
                Array.from(row.querySelectorAll("td, th")).map(cell => (cell as HTMLElement).innerText?.trim())
              );
            });
            break;

          case "screenshot":
            const element = await page.$(rule.selector);
            if (element) {
              const buf = await element.screenshot({ type: "png" });
              results[rule.name] = buf.toString("base64");
            }
            break;
        }

        // Apply transform
        if (rule.transform && results[rule.name] != null) {
          const val = results[rule.name];
          switch (rule.transform) {
            case "trim":
              results[rule.name] = typeof val === "string" ? val.trim() : val;
              break;
            case "lowercase":
              results[rule.name] = typeof val === "string" ? val.toLowerCase() : val;
              break;
            case "uppercase":
              results[rule.name] = typeof val === "string" ? val.toUpperCase() : val;
              break;
            case "number":
              results[rule.name] = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
              break;
          }
        }
      } catch (error: any) {
        results[rule.name] = null;
      }
    }

    return results;
  }

  async extractStructured(sessionId: string, description: string): Promise<any> {
    const page = this.getActivePage(sessionId);

    // Get page HTML (truncated for LLM)
    let html: string;
    try {
      html = await page.evaluate(() => {
        const clone = document.documentElement.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("script, style, svg, noscript").forEach(el => el.remove());
        return clone.outerHTML.slice(0, 30000);
      });
    } catch (error: any) {
      throw new Error(`Failed to extract page HTML: ${error.message}`);
    }

    const response = await this.llmClient.chat.completions.create({
      model: "grok-4-1-fast-non-reasoning",
      messages: [
        {
          role: "system",
          content: "You extract structured data from HTML. Return valid JSON only.",
        },
        {
          role: "user",
          content: `Extract the following data from this HTML:\n\nREQUEST: ${description}\n\nHTML:\n${html}`,
        },
      ],
      max_tokens: 4096,
      temperature: 0,
    });

    const text = response.choices[0]?.message?.content || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) return {};
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return {};
    }
  }

  // ============================================
  // Screenshot
  // ============================================

  async screenshot(sessionId: string, options?: {
    fullPage?: boolean;
    selector?: string;
    quality?: number;
    type?: "png" | "jpeg";
  }): Promise<string> {
    let page: Page;
    try {
      page = this.getActivePage(sessionId);
    } catch (error: any) {
      const recoveredPage = this.recoverActivePage(sessionId);
      if (!recoveredPage) throw error;
      page = recoveredPage;
    }

    let buffer: Buffer;
    try {
      if (options?.selector) {
        const element = await page.$(options.selector);
        if (!element) throw new Error(`Element not found: ${options.selector}`);
        buffer = await element.screenshot({ type: options?.type || "png" });
      } else {
        buffer = await page.screenshot({
          type: options?.type || "png",
          fullPage: options?.fullPage || false,
          quality: options?.type === "jpeg" ? options?.quality || 80 : undefined,
        });
      }
    } catch (error: any) {
      const isClosedError = /has been closed|Target page, context or browser has been closed|closed/i.test(String(error?.message || ""));
      if (!isClosedError) throw error;
      const recoveredPage = this.recoverActivePage(sessionId);
      if (!recoveredPage) throw error;
      page = recoveredPage;
      if (options?.selector) {
        const element = await page.$(options.selector);
        if (!element) throw new Error(`Element not found after recovery: ${options.selector}`);
        buffer = await element.screenshot({ type: options?.type || "png" });
      } else {
        buffer = await page.screenshot({
          type: options?.type || "png",
          fullPage: options?.fullPage || false,
          quality: options?.type === "jpeg" ? options?.quality || 80 : undefined,
        });
      }
    }

    return buffer.toString("base64");
  }

  // ============================================
  // Network Control
  // ============================================

  async interceptRequests(sessionId: string, patterns: Array<{
    urlPattern: string;
    action: "block" | "modify" | "log";
    headers?: Record<string, string>;
    body?: string;
  }>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    await session.context.route("**/*", async (route: Route) => {
      const url = route.request().url();

      for (const pattern of patterns) {
        if (url.includes(pattern.urlPattern) || new RegExp(pattern.urlPattern).test(url)) {
          switch (pattern.action) {
            case "block":
              await route.abort();
              return;
            case "modify":
              await route.continue({
                headers: pattern.headers ? { ...route.request().headers(), ...pattern.headers } : undefined,
                postData: pattern.body,
              });
              return;
            case "log":
              this.emit("network:intercepted", { url, method: route.request().method() });
              break;
          }
        }
      }

      await route.continue();
    });
  }

  getNetworkLogs(sessionId: string, filter?: { urlPattern?: string; method?: string }): NetworkLog[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    let logs = session.networkLogs;
    if (filter?.urlPattern) {
      logs = logs.filter(l => l.url.includes(filter.urlPattern!));
    }
    if (filter?.method) {
      logs = logs.filter(l => l.method === filter.method);
    }
    return logs;
  }

  // ============================================
  // Cookie & Storage Management
  // ============================================

  async getCookies(sessionId: string, urls?: string[]): Promise<any[]> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.context.cookies(urls);
  }

  async setCookies(sessionId: string, cookies: Array<{ name: string; value: string; domain: string; path?: string }>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.context.addCookies(cookies as any);
  }

  async clearCookies(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.context.clearCookies();
  }

  async getLocalStorage(sessionId: string): Promise<Record<string, string>> {
    const page = this.getActivePage(sessionId);
    return page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) items[key] = localStorage.getItem(key) || "";
      }
      return items;
    });
  }

  async setLocalStorage(sessionId: string, items: Record<string, string>): Promise<void> {
    const page = this.getActivePage(sessionId);
    await page.evaluate((data) => {
      for (const [key, value] of Object.entries(data)) {
        localStorage.setItem(key, value);
      }
    }, items);
  }

  // ============================================
  // Agentic Task Execution
  // ============================================

  async executeAgenticTask(sessionId: string, task: AgenticTask, onProgress?: (step: AgenticStep, result: StepResult) => void): Promise<TaskResult> {
    const startTime = Date.now();
    const results: StepResult[] = [];
    const screenshots: string[] = [];
    const errors: string[] = [];
    let stepsCompleted = 0;

    for (const step of task.steps) {
      const stepStart = Date.now();
      let retries = step.retries || task.retryPolicy.maxRetries;
      let stepResult: StepResult | null = null;

      while (retries >= 0) {
        try {
          const data = await this.executeStep(sessionId, step, task.variables);

          stepResult = {
            stepId: step.id,
            success: true,
            data,
            duration: Date.now() - stepStart,
          };

          // Store variable if step says to
          if (step.action === "store_variable" && step.params.variableName) {
            task.variables[step.params.variableName] = data;
          }

          stepsCompleted++;
          break;
        } catch (error: any) {
          retries--;
          if (retries >= 0) {
            await new Promise(r => setTimeout(r, task.retryPolicy.backoffMs));
            continue;
          }

          stepResult = {
            stepId: step.id,
            success: false,
            error: error.message,
            duration: Date.now() - stepStart,
          };

          errors.push(`Step "${step.description}": ${error.message}`);

          if (!step.continueOnError && task.onError === "abort") {
            results.push(stepResult);
            onProgress?.(step, stepResult);
            return {
              taskId: task.id,
              success: false,
              stepsCompleted,
              totalSteps: task.steps.length,
              results,
              extractedData: task.variables,
              screenshots,
              errors,
              duration: Date.now() - startTime,
            };
          }
        }
      }

      if (stepResult) {
        results.push(stepResult);
        onProgress?.(step, stepResult);
      }
    }

    return {
      taskId: task.id,
      success: stepsCompleted === task.steps.length,
      stepsCompleted,
      totalSteps: task.steps.length,
      results,
      extractedData: task.variables,
      screenshots,
      errors,
      duration: Date.now() - startTime,
    };
  }

  private async executeStep(sessionId: string, step: AgenticStep, variables: Record<string, any>): Promise<any> {
    const page = this.getActivePage(sessionId);

    // Resolve variables in params
    const params = this.resolveVariables(step.params, variables);
    const selector = step.selector ? this.resolveTemplate(step.selector, variables) : undefined;

    switch (step.action) {
      case "navigate":
        return this.navigate(sessionId, params.url, params);

      case "click":
        if (!selector) throw new Error("Selector required for click");
        return this.click(sessionId, selector, params);

      case "type":
        if (!selector) throw new Error("Selector required for type");
        return this.type(sessionId, selector, params.text || params.value || "", params);

      case "extract":
        if (params.rules) {
          return this.extract(sessionId, params.rules);
        }
        if (selector) {
          return page.$eval(selector, (el: any) => el.innerText?.trim() || el.value || "");
        }
        return this.extractStructured(sessionId, params.description || "Extract all data");

      case "wait":
        if (selector) {
          await page.waitForSelector(selector, { timeout: params.timeout || 10000 });
        } else if (params.url) {
          await page.waitForURL(params.url, { timeout: params.timeout || 10000 });
        } else {
          await page.waitForTimeout(params.duration || 1000);
        }
        return { waited: true };

      case "scroll":
        await this.scroll(sessionId, {
          direction: params.direction || "down",
          amount: params.amount,
          selector,
        });
        return { scrolled: true };

      case "screenshot":
        return this.screenshot(sessionId, { selector, fullPage: params.fullPage });

      case "select":
        if (!selector) throw new Error("Selector required for select");
        return this.select(sessionId, selector, params.value || params.values);

      case "upload":
        if (!selector) throw new Error("Selector required for upload");
        await this.uploadFile(sessionId, selector, Array.isArray(params.files) ? params.files : [params.files]);
        return { uploaded: true };

      case "evaluate":
        return page.evaluate(params.script || params.code);

      case "condition":
        const conditionResult = await page.evaluate(params.condition);
        if (conditionResult && params.thenSteps) {
          for (const s of params.thenSteps) {
            await this.executeStep(sessionId, s, variables);
          }
        } else if (!conditionResult && params.elseSteps) {
          for (const s of params.elseSteps) {
            await this.executeStep(sessionId, s, variables);
          }
        }
        return { conditionMet: !!conditionResult };

      case "loop":
        const items = params.items || [];
        const loopResults = [];
        for (const item of items) {
          variables[params.variableName || "_item"] = item;
          for (const s of params.steps || []) {
            loopResults.push(await this.executeStep(sessionId, s, variables));
          }
        }
        return loopResults;

      case "new_tab":
        return this.newTab(sessionId, params.url);

      case "switch_tab":
        await this.switchTab(sessionId, params.tabId);
        return { switched: true };

      case "close_tab":
        await this.closeTab(sessionId, params.tabId);
        return { closed: true };

      case "assert":
        const assertValue = selector
          ? await page.$eval(selector, (el: any) => el.innerText?.trim() || el.value || "")
          : await page.evaluate(params.expression);
        const passed = params.expected
          ? String(assertValue).includes(String(params.expected))
          : !!assertValue;
        if (!passed) throw new Error(`Assertion failed: expected "${params.expected}", got "${assertValue}"`);
        return { asserted: true, value: assertValue };

      case "store_variable":
        const extractedValue = selector
          ? await page.$eval(selector, (el: any) => el.innerText?.trim() || el.value || "")
          : await page.evaluate(params.expression);
        return extractedValue;

      default:
        throw new Error(`Unknown step action: ${step.action}`);
    }
  }

  // ============================================
  // Smart Agentic Navigation (Gemini Vision-powered)
  // Uses screenshot-based visual understanding for decisions
  // ============================================

  async agenticNavigate(sessionId: string, goal: string, maxSteps: number = 20, onStep?: (step: {
    stepNumber: number;
    totalSteps: number;
    action: string;
    reasoning: string;
    goalProgress: string;
    screenshot: string;
    url: string;
    title: string;
  }) => void, options?: {
    maxRuntimeMs?: number;
    decisionTimeoutMs?: number;
    maxConsecutiveDecisionFailures?: number;
    allowedDomains?: string[];
  }): Promise<{
    success: boolean;
    steps: string[];
    data: any;
    screenshots: string[];
  }> {
    const steps: string[] = [];
    const screenshots: string[] = [];
    let data: any = {};
    const startTime = Date.now();
    const maxRuntimeMs = Math.max(10000, options?.maxRuntimeMs ?? 180000); // 3 minutes
    const decisionTimeoutMs = Math.max(5000, options?.decisionTimeoutMs ?? 25000); // 25s per decision
    const maxConsecutiveDecisionFailures = Math.max(1, options?.maxConsecutiveDecisionFailures ?? 3);
    let consecutiveDecisionFailures = 0;
    let previousActionSignature: string | null = null;
    let repeatedActionCount = 0;
    const maxRepeatedActionCount = 2;
    const isReservationGoal = /\b(reserv(a|ar|ation)|book(ing)?|mesa|restaurant|restaurante|table)\b/i.test(goal);
    const restaurantHint = (() => {
      const match = goal.match(/\b(?:restaurante|restaurant)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ'\- ]{2,80})/i);
      if (!match?.[1]) return "";
      const cleaned = match[1].split(/\b(?:para|for|el|on|a las|at)\b/i)[0].trim();
      return cleaned;
    })();

    // Get Gemini client for vision-based decisions
    let geminiClient: ReturnType<typeof getGeminiClientOrThrow> | null = null;
    try {
      geminiClient = getGeminiClientOrThrow();
    } catch {
      console.warn("[BrowserAgent] Gemini unavailable, falling back to Grok text-only");
    }

    for (let i = 0; i < maxSteps; i++) {
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= maxRuntimeMs) {
        const timeoutMessage = `Timeout: exceeded ${maxRuntimeMs}ms runtime budget`;
        console.warn(`[BrowserAgent] ${timeoutMessage} for session ${sessionId}`);
        steps.push(timeoutMessage);
        data = { ...data, error: "runtime_timeout", elapsedMs };
        return { success: false, steps, data, screenshots };
      }

      console.log(`[BrowserAgent] Step ${i + 1}/${maxSteps} for session ${sessionId}, elapsed=${elapsedMs}ms`);
      let page: Page;
      try {
        page = this.getActivePage(sessionId);
      } catch (error: any) {
        const recovered = this.recoverActivePage(sessionId);
        if (!recovered) {
          const recoverError = `Failed to get active page: ${error?.message || "unknown error"}`;
          steps.push(`Error: ${recoverError}`);
          data = { ...data, error: "active_page_unavailable", details: recoverError };
          return { success: false, steps, data, screenshots };
        }
        page = recovered;
      }

      if (page.isClosed()) {
        const recovered = this.recoverActivePage(sessionId);
        if (!recovered) {
          const closedError = "Active page is closed and could not be recovered";
          steps.push(`Error: ${closedError}`);
          data = { ...data, error: "active_page_closed" };
          return { success: false, steps, data, screenshots };
        }
        page = recovered;
      }

      // Take screenshot for vision-based analysis
      let screenshotBase64 = "";
      try {
        screenshotBase64 = await this.screenshot(sessionId, { type: "jpeg", quality: 60 });
        screenshots.push(screenshotBase64);
      } catch (error: any) {
        const msg = `screenshot_failed: ${error?.message || "unknown error"}`;
        console.warn(`[BrowserAgent] Step ${i + 1}: ${msg}`);
        steps.push(`Warning: ${msg}`);
      }

      // Get page info for context
      let pageInfo: {
        url: string;
        title: string;
        text: string;
        forms: Array<{
          tag: string;
          type: string;
          name: string;
          placeholder: string;
          text: string;
          value: string;
        }>;
      };
      try {
        pageInfo = await page.evaluate(() => ({
          url: window.location.href,
          title: document.title,
          text: document.body?.innerText?.slice(0, 3000) || "",
          forms: Array.from(document.querySelectorAll("input, textarea, select, button, a[href]")).slice(0, 30).map(el => ({
            tag: el.tagName,
            type: (el as HTMLInputElement).type || "",
            name: (el as HTMLInputElement).name || (el as HTMLInputElement).id || "",
            placeholder: (el as HTMLInputElement).placeholder || "",
            text: (el as HTMLElement).innerText?.slice(0, 80) || "",
            value: (el as HTMLInputElement).value || "",
          })),
        }));
      } catch (error: any) {
        const recovered = this.recoverActivePage(sessionId);
        if (!recovered) {
          const pageInfoError = `Failed to inspect page: ${error?.message || "unknown error"}`;
          steps.push(`Error: ${pageInfoError}`);
          data = { ...data, error: "page_inspection_failed", details: pageInfoError };
          return { success: false, steps, data, screenshots };
        }
        page = recovered;
        pageInfo = await page.evaluate(() => ({
          url: window.location.href,
          title: document.title,
          text: document.body?.innerText?.slice(0, 3000) || "",
          forms: Array.from(document.querySelectorAll("input, textarea, select, button, a[href]")).slice(0, 30).map(el => ({
            tag: el.tagName,
            type: (el as HTMLInputElement).type || "",
            name: (el as HTMLInputElement).name || (el as HTMLInputElement).id || "",
            placeholder: (el as HTMLInputElement).placeholder || "",
            text: (el as HTMLElement).innerText?.slice(0, 80) || "",
            value: (el as HTMLInputElement).value || "",
          })),
        }));
      }

      if (isReservationGoal && /reservas?\s+completas?\s+por\s+web|reservations?\s+full\s+online|no\s+availability\s+online/i.test(pageInfo.text)) {
        const question = "No hay disponibilidad web para la fecha/hora solicitada. ¿Quieres que pruebe otra fecha u horario?";
        steps.push("Detected no web availability message for requested reservation.");
        data = {
          ...data,
          status: "needs_user_input",
          missingFields: ["alternativeDateOrTime"],
          question,
          reason: "no_web_availability",
          pageUrl: pageInfo.url,
        };
        return { success: false, steps, data, screenshots };
      }

      // Build the decision prompt
      const reservationInstructions = isReservationGoal
        ? `\nReservation-specific rules:
- Use action "done" ONLY after explicit confirmation is visible (e.g. "confirmed", "reserva confirmada", confirmation code/reference).
- If blocked because required user data is missing, use action "done" with:
  {"status":"needs_user_input","missingFields":["field"],"question":"ask one concise question"}
- When confirmed, include:
  {"status":"confirmed","confirmationCode":"...", "restaurant":"...", "date":"...", "time":"...", "partySize":"..."}
- If max progress reached without proof, use:
  {"status":"unconfirmed","reason":"why not confirmed","lastUrl":"..."}`
        : "";

      const systemPrompt = `You are an expert web automation agent controlling a real Chromium browser. You can SEE the page via screenshots.

CURRENT STATE:
- URL: ${pageInfo.url}
- Title: ${pageInfo.title}
- Step: ${i + 1}/${maxSteps}
- Previous actions: ${steps.slice(-5).join(" → ") || "none"}

INTERACTIVE ELEMENTS ON PAGE:
${pageInfo.forms.slice(0, 25).map((f, idx) => `[${idx}] <${f.tag.toLowerCase()} type="${f.type}" name="${f.name}" placeholder="${f.placeholder}"> text="${f.text}" value="${f.value}"`).join("\n")}

Respond with EXACTLY ONE JSON action:
{
  "action": "click" | "type" | "navigate" | "scroll" | "wait" | "select" | "done",
  "selector": "CSS selector targeting the element",
  "value": "text to type, URL to navigate, or option to select",
  "reasoning": "brief explanation of why this action",
  "goalProgress": "percentage like 30%",
  "extractedData": {}
}

RULES:
- Look at the screenshot to understand the visual layout
- Use precise CSS selectors (prefer name, id, or unique attributes)
- For dropdowns/selects, use action "select" with value being the option text
- After typing in search fields, you may need to click a search/submit button or press Enter
- If you see a cookie banner or popup, dismiss it first
- If the page hasn't loaded yet, use "wait"
- ONLY use "done" when the goal is truly accomplished${options?.allowedDomains ? `\n- You MUST NOT navigate outside these allowed domains: ${options.allowedDomains.join(", ")}` : ""}${reservationInstructions}`;

      let planned: any = null;

      try {
        // Use Gemini Vision if available (can SEE the screenshot)
        if (geminiClient && screenshotBase64) {
          const geminiDecisionPromise = geminiClient.models.generateContent({
            model: "gemini-2.0-flash",
            contents: [{
              role: "user",
              parts: [
                { text: `${systemPrompt}\n\nGOAL: ${goal}\n\nAnalyze the screenshot and the page elements above. What is the SINGLE best next action to achieve the goal? Respond with ONLY the JSON object, no markdown.` },
                { inlineData: { mimeType: "image/jpeg", data: screenshotBase64 } },
              ],
            }],
            config: {
              temperature: 0.1,
              maxOutputTokens: 1024,
            },
          } as any);

          const geminiTimeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Gemini vision timeout after ${decisionTimeoutMs}ms`)), decisionTimeoutMs)
          );

          const geminiResponse = await Promise.race([geminiDecisionPromise, geminiTimeoutPromise]);
          const geminiText = geminiResponse?.text ?? geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

          const jsonMatch = geminiText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            planned = JSON.parse(jsonMatch[0]);
          }
          consecutiveDecisionFailures = 0;
        }

        // Fallback to Grok text-only if Gemini unavailable or failed
        if (!planned) {
          const grokDecisionPromise = this.llmClient.chat.completions.create({
            model: "grok-4-1-fast-non-reasoning",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `GOAL: ${goal}\n\nPage text (truncated): ${pageInfo.text.slice(0, 2000)}` },
            ],
            max_tokens: 1024,
            temperature: 0.1,
          });

          const grokTimeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Grok decision timeout after ${decisionTimeoutMs}ms`)), decisionTimeoutMs)
          );

          const grokResponse = await Promise.race([grokDecisionPromise, grokTimeoutPromise]);
          const grokText = grokResponse.choices[0]?.message?.content || "{}";
          const jsonMatch = grokText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            planned = JSON.parse(jsonMatch[0]);
          }
          consecutiveDecisionFailures = 0;
        }
      } catch (error: any) {
        consecutiveDecisionFailures++;
        const errMsg = error?.message || "Unknown LLM decision error";
        console.warn(`[BrowserAgent] Step ${i + 1}: ${errMsg}`);
        steps.push(`Error: ${errMsg}`);

        if (consecutiveDecisionFailures >= maxConsecutiveDecisionFailures) {
          data = { ...data, error: "decision_failures_exceeded", consecutiveDecisionFailures, lastError: errMsg };
          return { success: false, steps, data, screenshots };
        }

        try {
          await page.waitForTimeout(800);
        } catch {
          // Ignore best-effort delay errors
        }
        continue;
      }

      if (!planned) {
        steps.push("Error: Could not parse LLM response as JSON action");
        continue;
      }

      const actionSignature = `${String(planned.action || "").toLowerCase()}|${String(planned.selector || "").toLowerCase()}|${String(planned.value || "").toLowerCase()}`;
      if (previousActionSignature === actionSignature) {
        repeatedActionCount++;
      } else {
        previousActionSignature = actionSignature;
        repeatedActionCount = 0;
      }

      if (repeatedActionCount >= maxRepeatedActionCount) {
        if (planned.action === "type") {
          let recovered = false;
          const searchButtonSelectors = [
            "button[type='submit']",
            "button[aria-label*='buscar' i]",
            "button[aria-label*='search' i]",
            "button[class*='search' i]",
            "button[name*='search' i]",
            "input[type='submit']",
          ];
          for (const selector of searchButtonSelectors) {
            try {
              const count = await page.locator(selector).count();
              if (count > 0) {
                await page.locator(selector).first().click({ timeout: 1500 });
                steps.push(`Heuristic recovery: clicked ${selector} after repeated typing`);
                recovered = true;
                break;
              }
            } catch {
              // Try next selector
            }
          }

          if (!recovered && restaurantHint) {
            const candidateTerms = Array.from(new Set([
              restaurantHint,
              restaurantHint.split(/\s+/)[0] || "",
            ])).filter(Boolean);
            for (const term of candidateTerms) {
              try {
                const count = await page.getByText(term, { exact: false }).count();
                if (count > 0) {
                  await page.getByText(term, { exact: false }).first().click({ timeout: 1500 });
                  steps.push(`Heuristic recovery: clicked result text "${term}"`);
                  recovered = true;
                  break;
                }
              } catch {
                // Try next term
              }
            }
          }

          if (recovered) {
            await page.waitForTimeout(1000);
            previousActionSignature = null;
            repeatedActionCount = 0;
            continue;
          }
        }

        const repeatedMsg = `Stopped: repeated action loop detected (${planned.action || "unknown"})`;
        console.warn(`[BrowserAgent] ${repeatedMsg} for session ${sessionId}`);
        steps.push(repeatedMsg);
        data = { ...data, error: "repeated_action_loop", action: planned.action, signature: actionSignature };
        return { success: false, steps, data, screenshots };
      }

      console.log(`[BrowserAgent] Step ${i + 1}: action=${planned.action}, progress=${planned.goalProgress}, reasoning=${(planned.reasoning || '').slice(0, 80)}`);
      steps.push(`${planned.action}: ${planned.reasoning}`);

      // Emit step callback with screenshot for real-time UI updates
      if (onStep) {
        try {
          onStep({
            stepNumber: i + 1,
            totalSteps: maxSteps,
            action: planned.action,
            reasoning: planned.reasoning || '',
            goalProgress: planned.goalProgress || '0%',
            screenshot: screenshotBase64,
            url: pageInfo.url,
            title: pageInfo.title,
          });
        } catch (cbErr) {
          console.warn(`[BrowserAgent] onStep callback error:`, cbErr);
        }
      }

      if (planned.action === "done") {
        data = planned.extractedData || {};
        const status = String(data?.status || "").toLowerCase();
        const hasConfirmationEvidence = Boolean(
          data?.confirmationCode ||
          data?.reservationCode ||
          data?.bookingReference ||
          data?.confirmation
        );
        const isNeedsUserInput = status === "needs_user_input";
        const isConfirmed =
          status === "confirmed" ||
          status === "completed" ||
          status === "success" ||
          hasConfirmationEvidence;
        const doneSuccess = isReservationGoal ? isConfirmed && !isNeedsUserInput : true;
        // Send final screenshot after "done" action
        if (onStep) {
          try {
            const finalScreenshot = await this.screenshot(sessionId, { type: "jpeg", quality: 60 });
            onStep({
              stepNumber: i + 1,
              totalSteps: maxSteps,
              action: "done",
              reasoning: "Task completed",
              goalProgress: "100%",
              screenshot: finalScreenshot,
              url: pageInfo.url,
              title: pageInfo.title,
            });
          } catch (cbErr) {
            console.warn(`[BrowserAgent] onStep final callback error:`, cbErr);
          }
        }
        return { success: doneSuccess, steps, data, screenshots };
      }

      try {
        switch (planned.action) {
          case "click":
            await this.click(sessionId, planned.selector);
            break;
          case "type":
            await this.type(sessionId, planned.selector, planned.value, { clear: true });
            if (/\b(search|buscar|query)\b/i.test(String(planned.selector || "")) ||
              /\b(search|buscar)\b/i.test(String(planned.reasoning || ""))) {
              try {
                const activePage = this.getActivePage(sessionId);
                await activePage.keyboard.press("Enter");
              } catch {
                // Best-effort submit for search fields
              }
            }
            break;
          case "navigate":
            if (options?.allowedDomains && options.allowedDomains.length > 0) {
              try {
                const targetUrlStr = planned.value.startsWith('http') ? planned.value : `https://${planned.value}`;
                const targetUrl = new URL(targetUrlStr);
                const isAllowed = options.allowedDomains.some(domain =>
                  targetUrl.hostname === domain || targetUrl.hostname.endsWith(`.${domain}`)
                );
                if (!isAllowed) {
                  throw new Error(`Domain '${targetUrl.hostname}' is not in the allowed domains list (${options.allowedDomains.join(", ")}). Halting navigation to prevent hallucination.`);
                }
              } catch (urlErr: any) {
                if (urlErr.message.includes('not in the allowed domains list')) {
                  throw urlErr; // rethrow logic error
                }
                throw new Error(`Invalid URL format for navigation: ${planned.value}`);
              }
            }
            await this.navigate(sessionId, planned.value);
            break;
          case "scroll":
            await this.scroll(sessionId, { direction: planned.value === "up" ? "up" : "down", amount: 500 });
            break;
          case "select":
            try {
              await page.selectOption(planned.selector, { label: planned.value });
            } catch {
              // Fallback: try clicking the option text
              try {
                await page.click(`${planned.selector} option: has - text("${planned.value}")`);
              } catch {
                steps.push(`Warning: Could not select "${planned.value}" in ${planned.selector} `);
              }
            }
            break;
          case "wait":
            await page.waitForTimeout(2000);
            break;
          case "extract":
            data = { ...data, ...(planned.extractedData || {}) };
            break;
        }

        try {
          const activePage = this.getActivePage(sessionId);
          await activePage.waitForTimeout(500); // Brief pause between actions
        } catch {
          // Best-effort pause; continue loop if page changed/closed
        }
      } catch (error: any) {
        steps.push(`Error executing ${planned.action}: ${error.message} `);
        // Don't abort on action errors - let the LLM see the new state and adapt
      }
    }

    if (isReservationGoal && !data?.status) {
      data = { ...data, status: "unconfirmed" };
    }
    return { success: false, steps, data, screenshots };
  }

  async runCalaReservation(
    sessionId: string,
    reservation: {
      restaurant?: string;
      date?: string;
      time?: string;
      partySize?: number;
      contactName?: string;
      email?: string;
      phone?: string;
    },
    onStep?: (step: {
      stepNumber: number;
      totalSteps: number;
      action: string;
      reasoning: string;
      goalProgress: string;
      screenshot: string;
      url: string;
      title: string;
    }) => void,
    options?: { maxRuntimeMs?: number }
  ): Promise<{
    success: boolean;
    steps: string[];
    data: any;
    screenshots: string[];
  }> {
    const steps: string[] = [];
    const screenshots: string[] = [];
    const totalSteps = 12;
    let stepNumber = 0;
    const startedAt = Date.now();
    const maxRuntimeMs = Math.max(20000, options?.maxRuntimeMs ?? 120000);
    const data: any = {};
    const backendSignals: {
      validate: any | null;
      changeDay: any | null;
      comprove: any | null;
    } = {
      validate: null,
      changeDay: null,
      comprove: null,
    };
    let attachedPage: Page | null = null;
    let responseListener: ((response: any) => Promise<void>) | null = null;

    const ensureBudget = () => {
      if (Date.now() - startedAt > maxRuntimeMs) {
        throw new Error(`Timeout: exceeded ${maxRuntimeMs}ms runtime budget`);
      }
    };

    const parseDayFromDate = (raw: string | undefined): number | null => {
      if (!raw) return null;
      const source = String(raw).trim().toLowerCase();
      const iso = source.match(/\b\d{4}-\d{2}-(\d{2})\b/);
      if (iso?.[1]) return Number(iso[1]);
      const slash = source.match(/\b(\d{1,2})[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/);
      if (slash?.[1]) return Number(slash[1]);
      const es = source.match(/\b(\d{1,2})\s+de\s+[a-záéíóúñ]+\b/i);
      if (es?.[1]) return Number(es[1]);
      const en = source.match(/\b[a-z]+\s+(\d{1,2})(?:,\s*\d{4})?\b/i);
      if (en?.[1]) return Number(en[1]);
      if (/\b(hoy|today)\b/i.test(source)) return new Date().getDate();
      if (/\b(mañana|manana|tomorrow)\b/i.test(source)) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.getDate();
      }
      return null;
    };

    const parseMonthFromDate = (raw: string | undefined): number | null => {
      if (!raw) return null;
      const source = String(raw).trim().toLowerCase();
      const iso = source.match(/\b\d{4}-(\d{2})-\d{2}\b/);
      if (iso?.[1]) return Number(iso[1]);
      const slash = source.match(/\b\d{1,2}[\/-](\d{1,2})(?:[\/-]\d{2,4})?\b/);
      if (slash?.[1]) return Number(slash[1]);

      const monthEs: Record<string, number> = {
        enero: 1,
        febrero: 2,
        marzo: 3,
        abril: 4,
        mayo: 5,
        junio: 6,
        julio: 7,
        agosto: 8,
        septiembre: 9,
        setiembre: 9,
        octubre: 10,
        noviembre: 11,
        diciembre: 12,
      };
      const monthEn: Record<string, number> = {
        january: 1,
        february: 2,
        march: 3,
        april: 4,
        may: 5,
        june: 6,
        july: 7,
        august: 8,
        september: 9,
        october: 10,
        november: 11,
        december: 12,
      };

      const es = source.match(/\b\d{1,2}\s+de\s+([a-záéíóúñ]+)\b/i);
      if (es?.[1]) {
        const key = es[1].normalize("NFD").replace(/\p{Diacritic}/gu, "");
        if (monthEs[key] != null) return monthEs[key];
      }
      const en = source.match(/\b([a-z]+)\s+\d{1,2}(?:,\s*\d{4})?\b/i);
      if (en?.[1]) {
        const key = en[1].normalize("NFD").replace(/\p{Diacritic}/gu, "");
        if (monthEn[key] != null) return monthEn[key];
      }

      if (/\b(hoy|today)\b/i.test(source)) return new Date().getMonth() + 1;
      if (/\b(mañana|manana|tomorrow)\b/i.test(source)) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.getMonth() + 1;
      }
      return null;
    };

    const normalizeTime = (raw: string | undefined): string | null => {
      if (!raw) return null;
      const source = String(raw).trim().toLowerCase();
      const match = source.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i);
      if (!match) return null;
      let hour = Number(match[1]);
      const minute = Number(match[2] || "00");
      const ampm = (match[3] || "").toLowerCase();
      if (/pm|p\.m\./.test(ampm) && hour < 12) hour += 12;
      if (/am|a\.m\./.test(ampm) && hour === 12) hour = 0;
      if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
      }
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} `;
    };

    const toMinutes = (hhmm: string): number => {
      const m = hhmm.match(/^(\d{2}):(\d{2})$/);
      if (!m) return Number.POSITIVE_INFINITY;
      return Number(m[1]) * 60 + Number(m[2]);
    };

    const escapeRegex = (value: string): string =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const emitProgress = async (action: string, reasoning: string, progress: string, skipScreenshot = false) => {
      stepNumber += 1;
      const page = this.getActivePage(sessionId);
      let screenshot = "";
      if (!skipScreenshot) {
        try {
          screenshot = await this.screenshot(sessionId, { type: "jpeg", quality: 40 });
          screenshots.push(screenshot);
        } catch {
          // Best effort screenshot
        }
      }
      let url = "";
      let title = "";
      try {
        url = page.url();
        title = await page.title();
      } catch {
        // Ignore page metadata errors
      }
      if (onStep) {
        try {
          onStep({
            stepNumber: Math.min(stepNumber, totalSteps),
            totalSteps,
            action,
            reasoning,
            goalProgress: progress,
            screenshot,
            url,
            title,
          });
        } catch {
          // Ignore callback errors
        }
      }
    };

    const safeParseJson = (raw: string): any | null => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };

    const detectBackendReservationBlock = (): {
      status: "needs_user_input";
      reason: string;
      question: string;
      missingFields: string[];
      backendMessage?: string;
    } | null => {
      const validate = backendSignals.validate;
      const changeDay = backendSignals.changeDay;
      const possibleMessages = [
        validate?.error_text,
        validate?.message,
        validate?.not_avaible,
        changeDay?.not_avaible,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      // Find the most relevant message (first non-empty one matching the detected condition)
      const findRelevantMessage = (pattern: RegExp): string =>
        possibleMessages.find((m) => pattern.test(m.toLowerCase())) || possibleMessages[0] || "";
      const merged = possibleMessages.join(" | ").toLowerCase();

      if (!merged) return null;

      if (/ya hemos registrado una reserva|duplicad|already.*reserv/i.test(merged)) {
        return {
          status: "needs_user_input",
          reason: "duplicate_reservation_detected",
          question:
            "CoverManager indicó que ya existe una reserva para esos datos ese mismo día. ¿Quieres que intente con otro horario, otro nombre/teléfono o editar la reserva existente?",
          missingFields: ["alternativeDateOrTimeOrContact"],
          backendMessage: findRelevantMessage(/duplicad|registrado|already|tienes? una/),
        };
      }

      if (/reservas?\s+completas?\s+por\s+web|no hay disponibilidad|no\s+availability|lista de espera/i.test(merged)) {
        return {
          status: "needs_user_input",
          reason: "no_web_availability",
          question:
            "No hay disponibilidad web en Cala para ese horario. ¿Quieres que pruebe otra hora/fecha o que intente lista de espera?",
          missingFields: ["alternativeDateOrTime"],
          backendMessage: findRelevantMessage(/completas|disponibilidad|availability|espera/),
        };
      }

      if (/cerrado|closed|fuera de horario|hours/i.test(merged)) {
        return {
          status: "needs_user_input",
          reason: "restaurant_closed",
          question: "El restaurante está cerrado o fuera de horario para esa fecha. ¿Quieres que pruebe otro día?",
          missingFields: ["alternativeDateOrTime"],
          backendMessage: findRelevantMessage(/cerrado|closed|horario|hours/),
        };
      }

      if (/email|correo|tel[eé]fono|phone|inv[aá]lid|incorrecto/i.test(merged)) {
        return {
          status: "needs_user_input",
          reason: "invalid_contact_data",
          question: "El sitio indica que algún dato de contacto es inválido. ¿Puedes verificar email y teléfono?",
          missingFields: ["contactEmail", "contactPhone"],
          backendMessage: findRelevantMessage(/email|tel|phone|correo|inv[aá]lid/),
        };
      }

      if (validate && Number(validate?.resp) === 0) {
        return {
          status: "needs_user_input",
          reason: "reservation_validation_failed",
          question:
            "El sitio rechazó la validación de la reserva con esos datos. ¿Quieres que pruebe con otros datos de contacto u otro horario?",
          missingFields: ["alternativeDateOrTimeOrContact"],
          backendMessage: findRelevantMessage(/.*/),
        };
      }

      return null;
    };

    const backendSignalSummary = () => ({
      validateResp: backendSignals.validate?.resp,
      validateErrorText: backendSignals.validate?.error_text,
      validateMessage: backendSignals.validate?.message,
      changeDayNotAvailable: backendSignals.changeDay?.not_avaible,
      comproveResp: backendSignals.comprove?.resp,
    });

    const clickFirstVisible = async (
      selectors: string[],
      options?: {
        maxCandidates?: number;
        clickTimeoutMs?: number;
        allowDispatchFallback?: boolean;
      }
    ): Promise<string | null> => {
      const page = this.getActivePage(sessionId);
      const maxCandidates = Math.max(1, Math.min(options?.maxCandidates ?? 8, 20));
      const clickTimeoutMs = Math.max(300, Math.min(options?.clickTimeoutMs ?? 1200, 5000));
      for (const selector of selectors) {
        const locator = page.locator(selector);
        const count = Math.min(await locator.count().catch(() => 0), maxCandidates);
        for (let i = 0; i < count; i++) {
          const item = locator.nth(i);
          try {
            if (!(await item.isVisible())) continue;
            if (!(await item.isEnabled().catch(() => true))) continue;
            await item.click({ timeout: clickTimeoutMs });
            return selector;
          } catch {
            if (options?.allowDispatchFallback) {
              try {
                await item.dispatchEvent("click");
                return selector;
              } catch {
                // Try next candidate
              }
            }
          }
        }
      }
      return null;
    };

    const clickVisibleText = async (value: string): Promise<boolean> => {
      const page = this.getActivePage(sessionId);
      const exact = value.trim();
      if (!exact) return false;
      const regex = new RegExp(`^\\s * ${escapeRegex(exact)} \\s * $`, "i");
      const locators = [
        page.getByText(exact, { exact: true }),
        page.locator("button, a, span, div").filter({ hasText: regex }),
      ];
      for (const locator of locators) {
        const count = Math.min(await locator.count().catch(() => 0), 12);
        for (let i = 0; i < count; i++) {
          const item = locator.nth(i);
          try {
            if (!(await item.isVisible())) continue;
            await item.click({ timeout: 1200 });
            return true;
          } catch {
            try {
              await item.dispatchEvent("click");
              return true;
            } catch {
              // Try next candidate
            }
          }
        }
      }
      return false;
    };

    const clickSubmitButton = async (selectors: string[]): Promise<string | null> => {
      const page = this.getActivePage(sessionId);
      for (const rawSelector of selectors) {
        const button = page.locator(rawSelector).first();
        const exists = (await button.count().catch(() => 0)) > 0;
        if (!exists) continue;
        try {
          if (!(await button.isVisible().catch(() => false))) continue;
          if (!(await button.isEnabled().catch(() => true))) continue;
          await button.scrollIntoViewIfNeeded().catch(() => { });
          await button.focus().catch(() => { });
          await button.click({ timeout: 1200 });
          return rawSelector;
        } catch {
          try {
            await button.click({ timeout: 1200, force: true });
            return rawSelector;
          } catch {
            // Continue with lower-level submit fallbacks
          }
          try {
            await button.dispatchEvent("click");
            return rawSelector;
          } catch {
            try {
              const submitted = await page.evaluate((selector) => {
                const node = document.querySelector(selector) as
                  | HTMLInputElement
                  | HTMLButtonElement
                  | null;
                if (!node) return false;
                const form = node.form || (node.closest("form") as HTMLFormElement | null);
                try {
                  node.click();
                } catch {
                  // Ignore direct click failure
                }
                if (form) {
                  try {
                    if (typeof (form as any).requestSubmit === "function") {
                      (form as any).requestSubmit(node);
                      return true;
                    }
                  } catch {
                    // Fallback below
                  }
                  try {
                    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
                  } catch {
                    // Ignore
                  }
                  try {
                    form.submit();
                  } catch {
                    // Ignore
                  }
                  return true;
                }
                return true;
              }, rawSelector);
              if (submitted) {
                await page.keyboard.press("Enter").catch(() => { });
                return rawSelector;
              }
            } catch {
              // Try next selector
            }
          }
        }
      }
      return null;
    };

    const ensureInputChecked = async (selector: string): Promise<boolean> => {
      const page = this.getActivePage(sessionId);
      const input = page.locator(selector).first();
      const exists = (await input.count().catch(() => 0)) > 0;
      if (!exists) return false;
      try {
        const alreadyChecked = await input.isChecked().catch(() => false);
        if (alreadyChecked) return true;
        await input.scrollIntoViewIfNeeded().catch(() => { });
        await input.check({ force: true, timeout: 1200 });
        const checked = await input.isChecked().catch(() => false);
        if (checked) return true;
      } catch {
        // Fall through to DOM-level fallback
      }

      try {
        const checked = await page.evaluate((rawSelector) => {
          const node = document.querySelector(rawSelector) as HTMLInputElement | null;
          if (!node) return false;
          if (node.checked) return true;
          try {
            node.click();
          } catch {
            // Ignore
          }
          if (!node.checked) {
            node.checked = true;
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
          }
          return !!node.checked;
        }, selector);
        return !!checked;
      } catch {
        return false;
      }
    };

    const quickType = async (selector: string, value: string): Promise<boolean> => {
      const page = this.getActivePage(sessionId);
      const input = page.locator(selector).first();
      const exists = (await input.count().catch(() => 0)) > 0;
      if (!exists) return false;
      try {
        if (!(await input.isVisible().catch(() => true))) return false;
        await input.fill("", { timeout: 800 }).catch(() => { });
        await input.fill(value, { timeout: 1200 });
        return true;
      } catch {
        try {
          await input.click({ timeout: 800 });
          await page.keyboard.press("Control+a").catch(() => { });
          await page.keyboard.type(value, { delay: 15 });
          return true;
        } catch {
          return false;
        }
      }
    };

    const autofillVisibleRequiredFields = async (defaults: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
    }) => {
      const fn = defaults.firstName || "Invitado";
      const ln = defaults.lastName || fn; // Use first name as fallback for last name
      await quickType("#user_first_name", fn);
      await quickType("#user_last_name", ln);
      // Single full-name field fallback
      await quickType("#user_name", `${fn} ${ln} `.trim());
      await quickType("#user_email", defaults.email);
      await quickType("#user_email2", defaults.email);
      await quickType("#user_phone", defaults.phone);
      // Alternative phone selectors
      await quickType("#user_phone_number", defaults.phone);
      await quickType("#comment_text", "N/A");
      await ensureInputChecked("#legal_ficha");
      await ensureInputChecked("#consentimiento_legal");
      await ensureInputChecked("#no_food_restrictions_data");
      // Generic terms checkboxes
      await ensureInputChecked('[name="terms"]');
      await ensureInputChecked('[name="legal"]');
      await ensureInputChecked('[name="privacy"]');
      await quickType("#food_restrictions", "Sin alergias");
    };

    const readFlowState = async (): Promise<{
      hasStep2Form: boolean;
      hasExtraStep: boolean;
      hasConfirmation: boolean;
      pageText: string;
    }> => {
      const page = this.getActivePage(sessionId);
      const hasStep2Form =
        (await page.locator("#user_first_name:visible, #user_last_name:visible, #user_email:visible, #user_phone:visible").count().catch(() => 0)) > 0;
      const hasExtraStep =
        (await page
          .locator("#response_0:visible, #response_2:visible, [id='1_response_0']:visible, input.reservarButton.step3:not(.ng-hide):visible")
          .count()
          .catch(() => 0)) > 0;
      const pageText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      const hasConfirmation = /reserva confirmada|solicitud confirmada|lista de espera confirmada|solicitud recibida/i.test(pageText);
      return { hasStep2Form, hasExtraStep, hasConfirmation, pageText };
    };

    const extractValidationMissingFields = (pageText: string): string[] => {
      const text = String(pageText || "").toLowerCase();
      const missing = new Set<string>();
      const invalidWord = /obligatorio|required|invalido|inválido|incorrecto|correcto|completa|complete|falta/.test(text);
      if (/correo|email/.test(text) && invalidWord) missing.add("contactEmail");
      if (/tel[eé]fono|phone|celular|whatsapp/.test(text) && invalidWord) missing.add("contactPhone");
      if (/nombre|apellidos|apellido|name/.test(text) && invalidWord) missing.add("contactName");
      return Array.from(missing);
    };

    const waitForFlowTransition = async (
      timeoutMs: number,
      waitReasoning: string,
      waitProgress: string
    ): Promise<{
      hasStep2Form: boolean;
      hasExtraStep: boolean;
      hasConfirmation: boolean;
      pageText: string;
    }> => {
      const page = this.getActivePage(sessionId);
      const started = Date.now();
      const hardDeadline = startedAt + maxRuntimeMs - 500;
      let state = await readFlowState();
      let progressSent = false;
      while (Date.now() - started < timeoutMs && Date.now() < hardDeadline) {
        if (state.hasExtraStep || state.hasConfirmation || !state.hasStep2Form) {
          return state;
        }
        if (!progressSent && Date.now() - started >= 7000) {
          progressSent = true;
          await emitProgress("wait", waitReasoning, waitProgress);
        }
        await page.waitForTimeout(500).catch(() => { });
        state = await readFlowState();
      }
      return state;
    };

    try {
      ensureBudget();
      const page = this.getActivePage(sessionId);
      attachedPage = page;
      responseListener = async (response: any) => {
        try {
          const url = String(response?.url?.() || "").toLowerCase();
          if (!url) return;
          const isValidate = /\/reserve\/validate\/?$/.test(url);
          const isChangeDay = /\/reserve\/change_day\//.test(url);
          const isComprove = /\/reserve\/comprove_message\/?$/.test(url);
          if (!isValidate && !isChangeDay && !isComprove) return;
          const payloadText = await response.text().catch(() => "");
          if (!payloadText) return;
          const payload = safeParseJson(payloadText);
          if (!payload) return;
          if (isValidate) backendSignals.validate = payload;
          if (isChangeDay) backendSignals.changeDay = payload;
          if (isComprove) backendSignals.comprove = payload;
        } catch {
          // Best-effort telemetry only
        }
      };
      page.on("response", responseListener);
      // Page is already navigated by the caller (agentExecutor navigate()).
      // Just ensure DOM is ready — this should be near-instant since navigate() already waited.
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => { });
      // Quick check: if the page somehow failed to load, reload once
      const pageLoaded = await page.evaluate(() => {
        const body = document.body?.innerText || "";
        return body.length > 50 || !!document.querySelector("select, .ui-datepicker, #datepicker_calendar, .calendar");
      }).catch(() => false);
      if (!pageLoaded) {
        console.log("[CalaReservation] Page appears empty, retrying with reload...");
        await page.reload({ timeout: 15000 }).catch(() => { });
        await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => { });
      }
      steps.push("Opened Cala reservation page.");
      await emitProgress("navigate", "Página de reserva abierta", "10%");

      const partySize = Number(reservation.partySize || 0);
      if (!Number.isFinite(partySize) || partySize <= 0) {
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields: ["partySize"],
            question: "Necesito la cantidad exacta de personas para continuar.",
          },
          screenshots,
        };
      }

      ensureBudget();
      // Party size — find the correct select (prefer #party_size, #pax, or first visible select)
      const partySizeSelector = await page.evaluate(() => {
        // Try known CoverManager selectors first
        const known = ["#party_size", "#pax", 'select[name="party_size"]', 'select[name="pax"]', 'select[name="personas"]'];
        for (const sel of known) {
          const el = document.querySelector(sel) as HTMLSelectElement | null;
          if (el && el.offsetParent !== null) return sel;
        }
        // Fallback: first visible select that has numeric-looking options (party size select typically has 1-20)
        for (const sel of Array.from(document.querySelectorAll("select"))) {
          if ((sel as HTMLElement).offsetParent === null) continue;
          const opts = Array.from((sel as HTMLSelectElement).options).map((o: HTMLOptionElement) => o.value);
          if (opts.some((v: string) => /^\\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 20)) return "select";
          break; // Use first visible select as fallback
        }
        return "select"; // Ultimate fallback
      }).catch(() => "select");

      const selectResult = await this.select(sessionId, partySizeSelector, String(partySize)).catch(() => ({ success: false }));
      if (!(selectResult as any)?.success) {
        // Try multiple label formats: "2 personas", "2 Personas", "2 pax", "2 comensales"
        for (const label of [`${partySize} personas`, `${partySize} Personas`, `${partySize} pax`, `${partySize} comensales`, `${partySize} `]) {
          const ok = await page.selectOption(partySizeSelector, { label }).catch(() => null);
          if (ok) break;
        }
      }

      // Verify party size was actually selected (strict text check to avoid "2" matching "12")
      const verifiedPartySize = await page.evaluate(({ expected, selector }) => {
        const sel = document.querySelector(selector) as HTMLSelectElement | null;
        if (!sel) return null;
        if (sel.value === String(expected)) return true;
        const selectedText = sel.selectedOptions?.[0]?.text || "";
        // Strict check: the number must be a standalone token, not part of a larger number
        const regex = new RegExp(`\\\\b${expected} \\\\b`);
        return regex.test(selectedText);
      }, { expected: partySize, selector: partySizeSelector }).catch(() => null);
      if (verifiedPartySize === false) {
        console.log(`[CalaReservation] Warning: party size ${partySize} may not be selected correctly`);
      }

      // Brief wait for calendar to update after party size change
      await page.waitForTimeout(400).catch(() => { });
      steps.push(`Selected party size: ${partySize}.`);
      await emitProgress("select", `Seleccionadas ${partySize} personas`, "20%", true);

      const day = parseDayFromDate(reservation.date);
      if (!day || day < 1 || day > 31) {
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields: ["date"],
            question: "Necesito la fecha exacta (día/mes/año) para reservar en Cala.",
          },
          screenshots,
        };
      }

      // ── Past date detection ──
      const targetMonth = parseMonthFromDate(reservation.date);
      const today = new Date();
      const todayDay = today.getDate();
      const todayMonth = today.getMonth() + 1;
      const todayYear = today.getFullYear();
      // Parse target year from date string (default to current year)
      const targetYearMatch = String(reservation.date || "").match(/\b(20\d{2})\b/);
      const targetYear = targetYearMatch ? Number(targetYearMatch[1]) : todayYear;
      if (targetYear < todayYear) {
        await emitProgress("wait", `Año ${targetYear} ya pasó`, "22%");
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields: ["date"],
            question: `El año ${targetYear} ya pasó. ¿Quieres reservar para una fecha en ${todayYear}?`,
            reason: "past_date",
          },
          screenshots,
        };
      }
      if (targetYear === todayYear && targetMonth && targetMonth < todayMonth) {
        await emitProgress("wait", "Mes solicitado ya pasó", "22%");
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields: ["date"],
            question: "El mes solicitado ya pasó. ¿Quieres reservar para una fecha futura?",
            reason: "past_date",
          },
          screenshots,
        };
      }
      if (targetYear === todayYear && targetMonth && targetMonth === todayMonth && day < todayDay) {
        await emitProgress("wait", `Día ${day} ya pasó este mes`, "22%");
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields: ["date"],
            question: `El día ${day} ya pasó este mes. ¿Quieres reservar para una fecha futura ? `,
            reason: "past_date",
          },
          screenshots,
        };
      }

      // ── Calendar month navigation — navigate forward if target month differs ──
      ensureBudget();
      if (targetMonth) {
        // Detect current calendar month from the visible header (e.g., "Febrero 2026")
        const currentCalMonth = await page.evaluate(() => {
          const header = (document.querySelector(".ui-datepicker-title") as HTMLElement | null)?.innerText || "";
          const m = header.toLowerCase();
          if (m.includes("enero") || m.includes("january")) return 1;
          if (m.includes("febrero") || m.includes("february")) return 2;
          if (m.includes("marzo") || m.includes("march")) return 3;
          if (m.includes("abril") || m.includes("april")) return 4;
          if (m.includes("mayo") || m.includes("may")) return 5;
          if (m.includes("junio") || m.includes("june")) return 6;
          if (m.includes("julio") || m.includes("july")) return 7;
          if (m.includes("agosto") || m.includes("august")) return 8;
          if (m.includes("septiembre") || m.includes("setiembre") || m.includes("september")) return 9;
          if (m.includes("octubre") || m.includes("october")) return 10;
          if (m.includes("noviembre") || m.includes("november")) return 11;
          if (m.includes("diciembre") || m.includes("december")) return 12;
          return null;
        }).catch(() => null);

        if (currentCalMonth !== null && currentCalMonth !== targetMonth) {
          // Always navigate forward — don't go backward in time for reservations
          let diff = targetMonth - currentCalMonth;
          if (diff < 0) diff += 12; // wrap forward across year boundary
          const clicks = Math.min(diff, 11); // Max 11 months forward
          const navSelector = [".ui-datepicker-next", "a.ui-datepicker-next", ".next-month", "[title='Sig']", "[title='Next']"];

          for (let i = 0; i < clicks; i++) {
            ensureBudget();
            const clicked = await clickFirstVisible(navSelector, { allowDispatchFallback: true, clickTimeoutMs: 1200 });
            if (!clicked) break;
            await page.waitForTimeout(400).catch(() => { }); // Wait for calendar to re-render
          }
          if (clicks > 0) {
            steps.push(`Navigated calendar forward ${clicks} month(s).`);
            await page.waitForTimeout(300).catch(() => { });
          }
        }
      }

      ensureBudget();
      // Reset changeDay signal BEFORE clicking so we can detect the fresh AJAX response
      backendSignals.changeDay = null;
      // Scroll calendar into view first for reliability
      await page.evaluate(() => {
        const cal = document.querySelector("#datepicker_calendar, .ui-datepicker, .calendar-container");
        if (cal) (cal as HTMLElement).scrollIntoView({ block: "center", behavior: "instant" });
      }).catch(() => { });

      // Wait for calendar strip to render (CoverManager horizontal day strip refreshes via AJAX)
      for (let i = 0; i < 10; i++) {
        const hasAnyDay = await page.evaluate(() =>
          document.querySelectorAll("span.date").length > 0
        ).catch(() => false);
        if (hasAnyDay) break;
        await page.waitForTimeout(500).catch(() => { });
      }

      // Strategy 1: Try to click the day in the visible horizontal strip (span.date elements)
      let dateClicked = await page.evaluate((targetDay) => {
        const dayStr = String(targetDay);
        const candidates = Array.from(document.querySelectorAll("span.date"));
        for (const el of candidates) {
          if ((el.textContent || "").trim() === dayStr && (el as HTMLElement).offsetParent !== null) {
            try {
              (el as HTMLElement).click();
              return "strip";
            } catch { /* continue */ }
          }
        }
        return null;
      }, day).catch(() => null);

      // Strategy 2: If day not in horizontal strip, open the full calendar (jQuery datepicker)
      if (!dateClicked) {
        console.log(`[CalaReservation] Day ${day} not in horizontal strip, opening full calendar...`);
        // Click the calendar icon to open the datepicker
        const calIconClicked = await page.evaluate(() => {
          // CoverManager uses a fa-calendar icon or a container with onclick to toggle datepicker
          const icon = document.querySelector("i.fa.fa-calendar");
          if (icon && (icon as HTMLElement).offsetParent !== null) {
            const clickTarget = icon.closest("a, button, div, span") || icon;
            (clickTarget as HTMLElement).click();
            return true;
          }
          // Fallback: try to show the datepicker directly
          const dp = document.querySelector("#datepicker_calendar, .ui-datepicker");
          if (dp) {
            (dp as HTMLElement).style.display = "block";
            return true;
          }
          return false;
        }).catch(() => false);

        if (calIconClicked) {
          await page.waitForTimeout(800).catch(() => { });
          // Now try to click the day in the jQuery datepicker table
          dateClicked = await page.evaluate((targetDay) => {
            const dayStr = String(targetDay);
            // jQuery datepicker: table.ui-datepicker-calendar td a.ui-state-default
            const dpCells = document.querySelectorAll(".ui-datepicker-calendar td a");
            for (const cell of Array.from(dpCells)) {
              if ((cell.textContent || "").trim() === dayStr) {
                try {
                  (cell as HTMLElement).click();
                  return "datepicker";
                } catch { /* continue */ }
              }
            }
            // Also try td[data-day] approach
            const byDataDay = document.querySelector(`td[data - day= "${dayStr}"]a, td[data - day= "${dayStr}"]span`);
            if (byDataDay) {
              try {
                (byDataDay as HTMLElement).click();
                return "datepicker-data";
              } catch { /* continue */ }
            }
            return null;
          }, day).catch(() => null);
        }
      }

      // Strategy 3: Playwright selector-based click as last resort
      if (!dateClicked) {
        const selectorClicked = await clickFirstVisible([
          `span.date: has - text("${day}")`,
          `.ui - datepicker - calendar td a: has - text("${day}")`,
          `td[data - day= "${day}"]a`,
          `td[data - day= "${day}"]span`,
        ]);
        if (selectorClicked) dateClicked = "selector";
      }

      if (!dateClicked) {
        const calState = await page.evaluate(() => {
          const stripDays = Array.from(document.querySelectorAll("span.date")).map(el => (el.textContent || "").trim());
          const dpDays = Array.from(document.querySelectorAll(".ui-datepicker-calendar td a")).map(el => (el.textContent || "").trim());
          return { stripDays, dpDays, dpVisible: !!document.querySelector(".ui-datepicker-calendar")?.closest("[style*='block']") };
        }).catch(() => ({ stripDays: [], dpDays: [], dpVisible: false }));
        console.log(`[CalaReservation] Day ${day} click failed.State: `, JSON.stringify(calState));
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields: ["date"],
            question: `No pude seleccionar el día ${day} en el calendario. ¿Quieres que pruebe otra fecha ? `,
          },
          screenshots,
        };
      }
      console.log(`[CalaReservation] Day ${day} clicked via ${dateClicked} `);
      await page.waitForTimeout(500).catch(() => { });
      steps.push(`Selected date day: ${day}.`);
      await emitProgress("click", `Fecha seleccionada(día ${day})`, "30%");

      const timeText = normalizeTime(reservation.time);
      if (!timeText) {
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields: ["time"],
            question: "Necesito la hora exacta para la reserva (ej. 20:00).",
          },
          screenshots,
        };
      }

      ensureBudget();
      let availableTimes: string[] = [];
      const scanAvailableTimes = async (): Promise<string[]> => {
        return page.evaluate(() => {
          const set = new Set<string>();
          const regex = /\b([0-2]?\d:[0-5]\d)\b/g;
          // Prioritize clickable/interactive elements and short text spans
          for (const node of Array.from(document.querySelectorAll("button, a, span, div, li")).slice(0, 2000)) {
            const el = node as HTMLElement;
            const text = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (!text || text.length > 30) continue; // Skip long text blocks (headers, paragraphs)
            if (el.offsetParent === null && el.tagName !== "BODY") continue; // Skip hidden elements
            for (const match of text.match(regex) || []) {
              const [hh, mm] = match.split(":").map(Number);
              // Filter to restaurant-plausible hours (7:00 - 23:59) to avoid phone/date false positives
              if (hh >= 7 && hh <= 23 && mm >= 0 && mm <= 59) {
                set.add(`${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} `);
              }
            }
          }
          return Array.from(set).sort();
        });
      };

      availableTimes = await scanAvailableTimes();
      const timePollStart = Date.now();
      const timePollMaxMs = 5000; // 5 seconds max wait for time slots
      for (let poll = 0; poll < 25; poll++) { // 25 * 200ms = 5s
        ensureBudget();
        await page.waitForTimeout(200).catch(() => { });
        availableTimes = await scanAvailableTimes();
        if (availableTimes.length > 0) {
          console.log(`[CalaReservation] Time slots found after ${Date.now() - timePollStart} ms: ${availableTimes.join(", ")} `);
          break;
        }
        // Also check if changeDay AJAX returned a "no availability" signal
        if (backendSignals.changeDay?.not_avaible) {
          console.log("[CalaReservation] changeDay backend signal: not_available");
          break;
        }
        if (Date.now() - timePollStart > timePollMaxMs) break;
      }

      if (!Array.isArray(availableTimes) || availableTimes.length === 0) {
        ensureBudget();
        // Check both page text and backend signals for no-availability
        const pageText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
        const changeDayNotAvail = backendSignals.changeDay?.not_avaible;
        if (/reservas?\s+completas?\s+por\s+web|no\s+availability\s+online/i.test(pageText) || changeDayNotAvail) {
          await emitProgress("wait", `Sin disponibilidad web para el día ${day} `, "30%");
          return {
            success: false,
            steps,
            data: {
              status: "needs_user_input",
              missingFields: ["alternativeDateOrTime"],
              question: `No hay disponibilidad web para el día ${day}. ¿Quieres que pruebe otro día u horario ? `,
              reason: "no_web_availability",
              backendMessage: changeDayNotAvail || undefined,
            },
            screenshots,
          };
        }
        // Time slots may exist in a non-standard format or the page is slow — try once more with longer wait
        ensureBudget();
        await page.waitForTimeout(500).catch(() => { });
        availableTimes = await scanAvailableTimes();
      }

      let selectedTime = timeText;
      if (!availableTimes.includes(selectedTime) && availableTimes.length > 0) {
        const targetMinutes = toMinutes(selectedTime);
        selectedTime = availableTimes.slice().sort((a, b) => Math.abs(toMinutes(a) - targetMinutes) - Math.abs(toMinutes(b) - targetMinutes))[0];
      }

      // Multi-strategy time click
      const clickTimeValue = async (timeVal: string): Promise<boolean> => {
        // Strategy 1: exact text match
        if (await clickVisibleText(timeVal)) return true;
        // Strategy 2: CSS selectors with data attributes
        const selectorClicked = await clickFirstVisible([
          `[data - hour= "${timeVal}"]`, `[data - time= "${timeVal}"]`,
          `button: has - text("${timeVal}")`, `a: has - text("${timeVal}")`,
          `span: has - text("${timeVal}")`, `div.hour: has - text("${timeVal}")`,
        ]);
        if (selectorClicked) return true;
        // Strategy 3: JS click on element containing the time text
        const jsClicked = await page.evaluate((t) => {
          const regex = new RegExp(`\\b${t} \\b`);
          for (const el of document.querySelectorAll("button, a, span, div, li")) {
            if (regex.test((el.textContent || "").trim()) && (el as HTMLElement).offsetParent !== null) {
              try {
                (el as HTMLElement).click();
                return true;
              } catch {
                /* continue */
              }
            }
          }
          return false;
        }, timeVal).catch(() => false);
        return jsClicked;
      };

      let clickedTime = await clickTimeValue(selectedTime);
      if (!clickedTime && availableTimes.length > 0 && selectedTime !== availableTimes[0]) {
        // Fallback: try the first available time
        clickedTime = await clickTimeValue(availableTimes[0]);
        if (clickedTime) selectedTime = availableTimes[0];
      }
      if (!clickedTime) {
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields: ["time"],
            question: `No pude seleccionar la hora ${timeText}. Horas detectadas: ${availableTimes.slice(0, 8).join(", ") || "ninguna"}. ¿Otra hora ? `,
          },
          screenshots,
        };
      }

      await page.waitForTimeout(150).catch(() => { });
      const timeWasAdjusted = selectedTime !== timeText;
      if (timeWasAdjusted) {
        steps.push(`Requested time ${timeText} not available.Selected closest: ${selectedTime}.`);
        data.timeAdjusted = true;
        data.requestedTime = timeText;
        data.selectedTime = selectedTime;
        data.availableTimes = availableTimes.slice(0, 10);
        await emitProgress("click", `${timeText} no disponible → seleccionada ${selectedTime} `, "40%");
      } else {
        steps.push(`Selected time: ${selectedTime}.`);
        await emitProgress("click", `Hora seleccionada: ${selectedTime} `, "40%");
      }

      // ── Wait for contact form to appear after time selection ──
      // CoverManager may animate/load the contact form — poll for form fields
      ensureBudget();
      for (let i = 0; i < 15; i++) { // up to 3s (15 * 200ms)
        const formReady = await page.evaluate(() => {
          // Check for either split name fields or single name field
          const firstName = document.querySelector("#user_first_name") as HTMLInputElement | null;
          const userName = document.querySelector("#user_name, [name=\"name\"], [name=\"nombre\"]") as HTMLInputElement | null;
          const anyField = firstName || userName;
          return !!(anyField && (anyField as any).offsetParent !== null);
        }).catch(() => false);
        if (formReady) break;
        await page.waitForTimeout(200).catch(() => { });
      }

      const fullName = String(reservation.contactName || "").trim();
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || "";
      // Handle single-name: use first name as last name fallback (CoverManager may require both)
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : firstName;
      const email = String(reservation.email || "").trim();
      // Phone normalization: strip non-digits except leading +, keep only first +
      let phone = String(reservation.phone || "").replace(/[^\d+]/g, "").trim();
      // Remove any + that isn't at the start
      if (phone.includes("+")) {
        phone = (phone.startsWith("+") ? "+" : "") + phone.replace(/\+/g, "");
      }
      // If phone doesn't start with +, try to add country code
      if (phone && !phone.startsWith("+")) {
        const digits = phone.replace(/\D/g, "");
        if (digits.length >= 7 && digits.length <= 10) {
          // Short number without country code → prepend +51 (Peru)
          phone = "+51" + digits;
        } else if (digits.length >= 11 && digits.length <= 15) {
          // Already includes country code as digits (e.g., 51999888777) → just add +
          phone = "+" + digits;
        }
      }
      // Validate email format loosely
      const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

      if (!firstName || !email || !phone) {
        const missingFields: string[] = [];
        if (!firstName) missingFields.push("contactName");
        if (!email) missingFields.push("contactEmail");
        if (!phone) missingFields.push("contactPhone");
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields,
            question: "Necesito nombre, email y teléfono para completar la reserva en Cala.",
          },
          screenshots,
        };
      }
      if (!emailValid) {
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields: ["contactEmail"],
            question: `El email "${email}" no parece válido. ¿Puedes verificarlo ? `,
            reason: "invalid_contact_data",
          },
          screenshots,
        };
      }
      if (phone.replace(/\D/g, "").length < 7) {
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields: ["contactPhone"],
            question: `El teléfono "${phone}" parece incompleto. ¿Puedes verificarlo ? `,
            reason: "invalid_contact_data",
          },
          screenshots,
        };
      }

      ensureBudget();
      await quickType("#user_first_name", firstName);
      await quickType("#user_last_name", lastName || firstName);
      await quickType("#user_name", `${firstName} ${lastName || firstName} `.trim());
      await quickType("#user_email", email);
      await quickType("#user_email2", email);
      await quickType("#user_phone", phone);
      await quickType("#user_phone_number", phone);
      await autofillVisibleRequiredFields({ firstName, lastName: lastName || firstName, email, phone });
      await page.waitForTimeout(300).catch(() => { });
      steps.push("Filled reservation contact details.");
      await emitProgress("type", "Datos de contacto completados", "55%");

      ensureBudget();
      await ensureInputChecked("#legal_ficha");
      await ensureInputChecked("#consentimiento_legal");
      await ensureInputChecked('[name="terms"]');
      await ensureInputChecked('[name="legal"]');
      await ensureInputChecked('[name="privacy"]');
      steps.push("Accepted reservation terms.");
      await emitProgress("click", "Condiciones legales aceptadas", "62%", true);

      ensureBudget();
      const step2Submit = await clickSubmitButton([
        "input.reservarButton.step2:not(.ng-hide)",
        "input.reservarButton.step2[value*='Reservar']",
        "input[value='Reservar ahora']",
        "input[value='Reservar']",
      ]);
      if (!step2Submit) {
        return {
          success: false,
          steps,
          data: {
            status: "unconfirmed",
            reason: "step2_submit_not_found",
            lastUrl: page.url(),
          },
          screenshots,
        };
      }
      await page.waitForTimeout(800).catch(() => { });
      let flowState = await waitForFlowTransition(
        15000,
        "Esperando respuesta del sitio tras enviar formulario",
        "72%"
      );

      // If form did not transition, re-fill any visible required field and re-submit once.
      if (!flowState.hasExtraStep && !flowState.hasConfirmation && flowState.hasStep2Form) {
        if (backendSignals.validate && Number(backendSignals.validate?.resp) === 1 && backendSignals.validate?.havequestions) {
          flowState = await waitForFlowTransition(
            6000,
            "Esperando carga de preguntas adicionales",
            "75%"
          );
        }

        const initialValidationMissing = extractValidationMissingFields(flowState.pageText);
        await autofillVisibleRequiredFields({ firstName, lastName: lastName || "-", email, phone });
        await page.waitForTimeout(300).catch(() => { });
        const retrySubmit = await clickSubmitButton([
          "input.reservarButton.step2:not(.ng-hide)",
          "input.reservarButton.step2[value*='Reservar']",
          "input[value='Reservar ahora']",
          "input[value='Reservar']",
        ]);
        if (retrySubmit) {
          await page.waitForTimeout(800).catch(() => { });
          flowState = await waitForFlowTransition(
            15000,
            "Reintentando envio del formulario",
            "75%"
          );
        }

        if (!flowState.hasExtraStep && !flowState.hasConfirmation && flowState.hasStep2Form) {
          const backendBlock = detectBackendReservationBlock();
          if (backendBlock) {
            return {
              success: false,
              steps,
              data: {
                ...backendBlock,
                finalUrl: page.url(),
              },
              screenshots,
            };
          }

          const missingByValidation = initialValidationMissing.length > 0
            ? initialValidationMissing
            : extractValidationMissingFields(flowState.pageText);
          if (missingByValidation.length > 0) {
            return {
              success: false,
              steps,
              data: {
                status: "needs_user_input",
                missingFields: missingByValidation,
                question: `El formulario de Cala sigue marcando datos inválidos: ${missingByValidation.join(", ")}. ¿Puedes confirmarlos exactamente ? `,
                reason: "step2_validation_block",
                finalUrl: page.url(),
              },
              screenshots,
            };
          }
          return {
            success: false,
            steps,
            data: {
              status: "unconfirmed",
              reason: "step2_stuck_no_transition",
              finalUrl: page.url(),
              backendSignals: backendSignalSummary(),
            },
            screenshots,
          };
        }
      }

      if (Date.now() - startedAt >= maxRuntimeMs - 500) {
        return {
          success: false,
          steps,
          data: {
            status: "unconfirmed",
            reason: "runtime_budget_exhausted_after_step2",
            finalUrl: page.url(),
          },
          screenshots,
        };
      }

      steps.push("Submitted reservation info step.");
      await emitProgress("click", "Formulario inicial enviado", "72%");

      ensureBudget();
      const hasExtraStep = flowState.hasExtraStep;
      if (hasExtraStep) {
        await quickType("#response_0", "N/A");
        await quickType("#response_2", "Sin alergias");
        await ensureInputChecked("[id='1_response_0']");
        await autofillVisibleRequiredFields({ firstName, lastName: lastName || "-", email, phone });
        await page.waitForTimeout(500).catch(() => { });
        steps.push("Answered additional reservation questions.");
        await emitProgress("type", "Preguntas adicionales completadas", "82%", true);

        const step3Submit = await clickSubmitButton([
          "input.reservarButton.step3:not(.ng-hide)",
          "input.reservarButton.step3[value*='Petición']",
          "input.reservarButton.step3[value*='Reservar']",
          "input[value='Petición de reserva']",
          "input[value='Reservar']",
        ]);
        if (!step3Submit) {
          return {
            success: false,
            steps,
            data: {
              status: "unconfirmed",
              reason: "step3_submit_not_found",
              lastUrl: page.url(),
            },
            screenshots,
          };
        }
        await page.waitForTimeout(600).catch(() => { });
        flowState = await waitForFlowTransition(
          15000,
          "Esperando confirmacion final de la reserva",
          "90%"
        );
        if (Date.now() - startedAt >= maxRuntimeMs - 500) {
          return {
            success: false,
            steps,
            data: {
              status: "unconfirmed",
              reason: "runtime_budget_exhausted_after_step3",
              finalUrl: page.url(),
            },
            screenshots,
          };
        }
        steps.push("Submitted additional reservation step.");
        await emitProgress("click", "Paso adicional enviado", "90%");
      }

      ensureBudget();
      const finalState = await page.evaluate(() => {
        const text = document.body?.innerText || "";
        const statusLines = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => /confirmad|solicitud|localizador|referencia|código|codigo|reserva/i.test(line))
          .slice(0, 30);
        const codeMatch = text.match(/(?:localizador|codigo|código|referencia|reference)\s*[:#]?\s*([A-Z0-9-]{4,})/i);
        return {
          url: window.location.href,
          text,
          statusLines,
          code: codeMatch?.[1] || null,
        };
      });

      const confirmed = /reserva confirmada|solicitud confirmada|lista de espera confirmada|solicitud recibida/i.test(finalState.text);
      const noAvailability = /reservas?\s+completas?\s+por\s+web|no\s+availability\s+online/i.test(finalState.text);
      const backendBlock = detectBackendReservationBlock();

      await emitProgress("done", confirmed ? "Reserva completada" : "Flujo finalizado", confirmed ? "100%" : "95%");

      if (confirmed) {
        return {
          success: true,
          steps,
          data: {
            status: "confirmed",
            restaurant: reservation.restaurant || "Cala",
            date: reservation.date,
            time: selectedTime,
            partySize,
            timeAdjusted: data.timeAdjusted || undefined,
            requestedTime: data.requestedTime || undefined,
            selectedTime: data.selectedTime || undefined,
            availableTimes: Array.isArray(data.availableTimes) ? data.availableTimes : undefined,
            confirmationCode: finalState.code || undefined,
            confirmationLines: finalState.statusLines,
            finalUrl: finalState.url,
          },
          screenshots,
        };
      }

      if (noAvailability) {
        return {
          success: false,
          steps,
          data: {
            status: "needs_user_input",
            missingFields: ["alternativeDateOrTime"],
            question: "No hay disponibilidad web en Cala para esos datos. ¿Quieres que pruebe otra fecha u horario?",
            reason: "no_web_availability",
            finalUrl: finalState.url,
          },
          screenshots,
        };
      }

      if (backendBlock) {
        return {
          success: false,
          steps,
          data: {
            ...backendBlock,
            finalUrl: finalState.url,
          },
          screenshots,
        };
      }

      return {
        success: false,
        steps,
        data: {
          status: "unconfirmed",
          reason: "confirmation_not_detected",
          confirmationLines: finalState.statusLines,
          finalUrl: finalState.url,
        },
        screenshots,
      };
    } catch (error: any) {
      const errMsg = error?.message || "unknown error";
      steps.push(`Error: ${errMsg} `);
      // Classify error for better user-facing messages
      const isTimeout = /timeout|exceeded.*runtime.*budget/i.test(errMsg);
      const isNavigation = /navigation|net::|ERR_/i.test(errMsg);
      const isClosed = /closed|destroyed|disposed|target.*closed/i.test(errMsg);
      let reason = "unknown_error";
      let question = `Ocurrió un error durante la automatización: ${errMsg} `;
      if (isTimeout) {
        reason = "runtime_timeout";
        question = "El proceso de reserva tardó más de lo esperado. ¿Quieres que lo intente de nuevo?";
      } else if (isNavigation) {
        reason = "page_navigation_error";
        question = "No pude cargar la página del restaurante. ¿Quieres que lo intente de nuevo?";
      } else if (isClosed) {
        reason = "browser_session_closed";
        question = "La sesión del navegador se cerró inesperadamente. ¿Quieres que lo intente de nuevo?";
      }
      return {
        success: false,
        steps,
        data: {
          status: "needs_user_input",
          error: errMsg,
          reason,
          question,
          missingFields: [],
        },
        screenshots,
      };
    } finally {
      if (attachedPage && responseListener) {
        try {
          attachedPage.off("response", responseListener);
        } catch {
          // Ignore listener cleanup errors
        }
      }
    }
  }

  // ============================================
  // Helper Methods (Public API for extensions)
  // ============================================

  getSession(sessionId: string): BrowserSession | null {
    return this.sessions.get(sessionId) || null;
  }

  getSessionContext(sessionId: string): BrowserContext {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId} `);
    return session.context;
  }

  getActivePage(sessionId: string, tabId?: string): Page {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId} `);

    const id = tabId || session.activeTabId;
    const tab = id ? session.tabs.get(id) : undefined;
    if (tab && !tab.page.isClosed()) {
      return tab.page;
    }

    const recovered = this.recoverActivePage(sessionId);
    if (recovered) return recovered;

    if (!id) throw new Error("No active tab");
    if (!tab) throw new Error(`Tab not found: ${id} `);
    throw new Error(`Active tab is closed: ${id} `);
  }

  private recoverActivePage(sessionId: string): Page | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    for (const [tabId, tab] of Array.from(session.tabs.entries())) {
      if (tab.page.isClosed()) {
        session.tabs.delete(tabId);
      }
    }

    const openTabEntry = Array.from(session.tabs.entries()).find(([, tab]) => !tab.page.isClosed());
    if (openTabEntry) {
      for (const [, tab] of session.tabs) {
        tab.active = false;
      }
      openTabEntry[1].active = true;
      session.activeTabId = openTabEntry[0];
      return openTabEntry[1].page;
    }

    const openContextPage = session.context.pages().find((p) => !p.isClosed());
    if (!openContextPage) return null;

    const recoveredTabId = randomUUID();
    session.tabs.set(recoveredTabId, {
      id: recoveredTabId,
      page: openContextPage,
      url: openContextPage.url(),
      title: openContextPage.url(),
      active: true,
      createdAt: Date.now(),
    });
    session.activeTabId = recoveredTabId;
    return openContextPage;
  }

  getActiveTab(sessionId: string, tabId?: string): Tab | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const id = tabId || session.activeTabId;
    if (!id) return null;

    return session.tabs.get(id) || null;
  }

  private async findAlternativeSelectors(page: Page, originalSelector: string): Promise<string[]> {
    const alternatives: string[] = [];

    try {
      // Try by text content
      const textMatch = originalSelector.match(/[.#]?[\w-]+/);
      if (textMatch) {
        alternatives.push(`text = "${textMatch[0]}"`);
        alternatives.push(`[aria - label*= "${textMatch[0]}"]`);
        alternatives.push(`[title *= "${textMatch[0]}"]`);
        alternatives.push(`[placeholder *= "${textMatch[0]}"]`);
      }

      // Try by role
      alternatives.push(`[role = "button"]`);
      alternatives.push(`[role = "link"]`);
    } catch {
      // Ignore
    }

    return alternatives;
  }

  private resolveVariables(params: Record<string, any>, variables: Record<string, any>): Record<string, any> {
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") {
        resolved[key] = this.resolveTemplate(value, variables);
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private resolveTemplate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      return variables[name] !== undefined ? String(variables[name]) : `{ {${name} } } `;
    });
  }

  async cleanup(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    for (const [id] of this.sessions) {
      await this.closeSession(id);
    }
  }
}

// Singleton
export const universalBrowserController = new UniversalBrowserController();
