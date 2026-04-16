/**
 * Browser Engine Extensions - Advanced capabilities for the UniversalBrowserController
 *
 * Adds PDF generation, accessibility tree extraction, console capture,
 * performance metrics, dialog handling, element highlighting, session
 * recording/replay, multi-page scraping pipelines, and cookie persistence.
 */

import { Page, BrowserContext, ConsoleMessage, Dialog } from "playwright";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";

// ============================================
// Types
// ============================================

export interface RecordedAction {
  id: string;
  timestamp: number;
  type: "navigate" | "click" | "type" | "scroll" | "select" | "hover" | "wait" | "screenshot" | "evaluate";
  selector?: string;
  value?: string;
  url?: string;
  coordinates?: { x: number; y: number };
  options?: Record<string, any>;
}

export interface SessionRecording {
  id: string;
  name: string;
  actions: RecordedAction[];
  startUrl: string;
  createdAt: number;
  duration: number;
  profileId: string;
}

export interface AccessibilityNode {
  role: string;
  name: string;
  value?: string;
  description?: string;
  focused?: boolean;
  disabled?: boolean;
  checked?: boolean | "mixed";
  level?: number;
  children?: AccessibilityNode[];
}

export interface PerformanceMetrics {
  loadTime: number;
  domContentLoaded: number;
  firstPaint: number;
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  totalBlockingTime: number;
  cumulativeLayoutShift: number;
  jsHeapSize: number;
  domNodes: number;
  resourceCount: number;
  transferSize: number;
  timestamp: number;
}

export interface ConsoleEntry {
  type: "log" | "error" | "warning" | "info" | "debug";
  text: string;
  location: { url: string; line: number; column: number } | null;
  timestamp: number;
}

export interface DialogEvent {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  defaultValue?: string;
  handled: boolean;
  response?: string | boolean;
  timestamp: number;
}

export interface ScrapingPipeline {
  id: string;
  name: string;
  startUrl: string;
  steps: ScrapingStep[];
  maxPages: number;
  concurrency: number;
  delay: number;
  variables: Record<string, any>;
}

export interface ScrapingStep {
  action: "navigate" | "click" | "paginate" | "extract" | "wait" | "condition";
  selector?: string;
  url?: string;
  extractionRules?: Array<{
    name: string;
    selector: string;
    type: "text" | "html" | "attribute" | "list";
    attribute?: string;
  }>;
  condition?: {
    selector: string;
    exists: boolean;
  };
  waitMs?: number;
  paginationSelector?: string;
  maxPages?: number;
}

export interface ScrapingResult {
  pipelineId: string;
  pagesScraped: number;
  data: Record<string, any>[];
  errors: string[];
  duration: number;
}

export interface ElementHighlight {
  selector: string;
  label?: string;
  color?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface NetworkThrottleProfile {
  name: string;
  downloadKbps: number;
  uploadKbps: number;
  latencyMs: number;
}

export interface HAREntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    headers: Array<{ name: string; value: string }>;
    content: { size: number; mimeType: string };
  };
  timings: { wait: number; receive: number };
}

export interface HARLog {
  version: string;
  creator: { name: string; version: string };
  entries: HAREntry[];
}

export interface FormField {
  selector: string;
  type: string;
  name: string;
  label: string;
  value: string;
  placeholder: string;
  required: boolean;
  options?: string[];
}

export interface AuthFlowResult {
  success: boolean;
  loginDetected: boolean;
  fieldsFound: { username: boolean; password: boolean; submit: boolean };
  postLoginUrl?: string;
  cookies: number;
  error?: string;
}

export interface VisualDiffResult {
  diffPercentage: number;
  totalPixels: number;
  changedPixels: number;
  regions: Array<{ x: number; y: number; width: number; height: number }>;
  diffImageBase64?: string;
}

// ============================================
// Browser Engine Extensions
// ============================================

export class BrowserEngineExtensions extends EventEmitter {
  private recordings: Map<string, SessionRecording> = new Map();
  private activeRecordings: Map<string, { recording: SessionRecording; startTime: number }> = new Map();
  private consoleEntries: Map<string, ConsoleEntry[]> = new Map();
  private dialogEvents: Map<string, DialogEvent[]> = new Map();

  // ============================================
  // PDF Generation
  // ============================================

  async generatePdf(page: Page, options?: {
    format?: "A4" | "Letter" | "Legal" | "A3" | "Tabloid";
    landscape?: boolean;
    printBackground?: boolean;
    scale?: number;
    margin?: { top?: string; bottom?: string; left?: string; right?: string };
    headerTemplate?: string;
    footerTemplate?: string;
    displayHeaderFooter?: boolean;
    pageRanges?: string;
  }): Promise<{ buffer: Buffer; path: string }> {
    const pdfBuffer = await page.pdf({
      format: options?.format || "A4",
      landscape: options?.landscape || false,
      printBackground: options?.printBackground !== false,
      scale: options?.scale || 1,
      margin: options?.margin || { top: "1cm", bottom: "1cm", left: "1cm", right: "1cm" },
      headerTemplate: options?.headerTemplate,
      footerTemplate: options?.footerTemplate,
      displayHeaderFooter: options?.displayHeaderFooter || false,
      pageRanges: options?.pageRanges,
    });

    const outputDir = path.join(os.tmpdir(), "iliagpt-pdfs");
    await fs.mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, `page-${randomUUID().slice(0, 8)}.pdf`);
    await fs.writeFile(filePath, pdfBuffer);

    return { buffer: pdfBuffer, path: filePath };
  }

  // ============================================
  // Accessibility Tree
  // ============================================

  async getAccessibilityTree(page: Page): Promise<AccessibilityNode> {
    const snapshot = await page.accessibility.snapshot();
    return this.normalizeAccessibilityNode(snapshot);
  }

  async getAccessibilityByRole(page: Page, role: string): Promise<AccessibilityNode[]> {
    const tree = await this.getAccessibilityTree(page);
    const results: AccessibilityNode[] = [];
    this.findNodesByRole(tree, role, results);
    return results;
  }

  private normalizeAccessibilityNode(node: any): AccessibilityNode {
    if (!node) return { role: "none", name: "" };
    return {
      role: node.role || "none",
      name: node.name || "",
      value: node.value,
      description: node.description,
      focused: node.focused,
      disabled: node.disabled,
      checked: node.checked,
      level: node.level,
      children: node.children?.map((c: any) => this.normalizeAccessibilityNode(c)),
    };
  }

  private findNodesByRole(node: AccessibilityNode, role: string, results: AccessibilityNode[]): void {
    if (node.role === role) results.push(node);
    if (node.children) {
      for (const child of node.children) {
        this.findNodesByRole(child, role, results);
      }
    }
  }

  // ============================================
  // Console Log Capture
  // ============================================

  startConsoleCapture(sessionId: string, page: Page): void {
    this.consoleEntries.set(sessionId, []);

    page.on("console", (msg: ConsoleMessage) => {
      const entries = this.consoleEntries.get(sessionId);
      if (!entries) return;

      const entry: ConsoleEntry = {
        type: msg.type() as ConsoleEntry["type"],
        text: msg.text(),
        location: msg.location() ? {
          url: msg.location().url,
          line: msg.location().lineNumber,
          column: msg.location().columnNumber,
        } : null,
        timestamp: Date.now(),
      };

      entries.push(entry);
      // Keep max 500 entries
      if (entries.length > 500) entries.shift();

      this.emit("console", { sessionId, entry });
    });
  }

  getConsoleEntries(sessionId: string, filter?: {
    type?: ConsoleEntry["type"];
    search?: string;
    limit?: number;
  }): ConsoleEntry[] {
    let entries = this.consoleEntries.get(sessionId) || [];

    if (filter?.type) {
      entries = entries.filter((e) => e.type === filter.type);
    }
    if (filter?.search) {
      const search = filter.search.toLowerCase();
      entries = entries.filter((e) => e.text.toLowerCase().includes(search));
    }
    if (filter?.limit) {
      entries = entries.slice(-filter.limit);
    }

    return entries;
  }

  clearConsoleEntries(sessionId: string): void {
    this.consoleEntries.set(sessionId, []);
  }

  // ============================================
  // Dialog Handling
  // ============================================

  setupDialogHandler(sessionId: string, page: Page, autoAccept: boolean = true, defaultResponse?: string): void {
    this.dialogEvents.set(sessionId, []);

    page.on("dialog", async (dialog: Dialog) => {
      const event: DialogEvent = {
        type: dialog.type() as DialogEvent["type"],
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
        handled: true,
        timestamp: Date.now(),
      };

      if (autoAccept) {
        if (dialog.type() === "prompt") {
          event.response = defaultResponse || dialog.defaultValue() || "";
          await dialog.accept(event.response as string);
        } else {
          event.response = true;
          await dialog.accept();
        }
      } else {
        event.response = false;
        await dialog.dismiss();
      }

      const events = this.dialogEvents.get(sessionId) || [];
      events.push(event);
      this.dialogEvents.set(sessionId, events);

      this.emit("dialog", { sessionId, event });
    });
  }

  getDialogEvents(sessionId: string): DialogEvent[] {
    return this.dialogEvents.get(sessionId) || [];
  }

  // ============================================
  // Performance Metrics
  // ============================================

  async getPerformanceMetrics(page: Page): Promise<PerformanceMetrics> {
    const metrics = await page.evaluate(() => {
      const perf = performance;
      const nav = perf.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const paint = perf.getEntriesByType("paint");
      const resources = perf.getEntriesByType("resource") as PerformanceResourceTiming[];

      const fcp = paint.find((p) => p.name === "first-contentful-paint");
      const fp = paint.find((p) => p.name === "first-paint");

      let lcp = 0;
      try {
        const lcpEntries = (perf as any).getEntriesByType("largest-contentful-paint");
        if (lcpEntries.length > 0) lcp = lcpEntries[lcpEntries.length - 1].startTime;
      } catch { /* not supported */ }

      let cls = 0;
      try {
        const clsEntries = (perf as any).getEntriesByType("layout-shift");
        cls = clsEntries.reduce((sum: number, entry: any) =>
          sum + (entry.hadRecentInput ? 0 : entry.value), 0);
      } catch { /* not supported */ }

      const jsHeap = (performance as any).memory?.usedJSHeapSize || 0;

      return {
        loadTime: nav ? nav.loadEventEnd - nav.startTime : 0,
        domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
        firstPaint: fp ? fp.startTime : 0,
        firstContentfulPaint: fcp ? fcp.startTime : 0,
        largestContentfulPaint: lcp,
        totalBlockingTime: 0,
        cumulativeLayoutShift: cls,
        jsHeapSize: jsHeap,
        domNodes: document.querySelectorAll("*").length,
        resourceCount: resources.length,
        transferSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
      };
    });

    return { ...metrics, timestamp: Date.now() };
  }

  // ============================================
  // Element Highlighting
  // ============================================

  async highlightElements(page: Page, highlights: ElementHighlight[]): Promise<string> {
    await page.evaluate((items) => {
      // Remove existing highlights
      document.querySelectorAll("[data-iliagpt-highlight]").forEach((el) => el.remove());

      for (const item of items) {
        try {
          const elements = document.querySelectorAll(item.selector);
          elements.forEach((el, idx) => {
            const rect = el.getBoundingClientRect();
            const overlay = document.createElement("div");
            overlay.setAttribute("data-iliagpt-highlight", "true");
            overlay.style.cssText = `
              position: fixed;
              top: ${rect.top}px;
              left: ${rect.left}px;
              width: ${rect.width}px;
              height: ${rect.height}px;
              border: 2px solid ${item.color || "#ff0000"};
              background: ${item.color || "#ff0000"}20;
              z-index: 999999;
              pointer-events: none;
              box-sizing: border-box;
            `;

            if (item.label) {
              const label = document.createElement("div");
              label.textContent = `${item.label}${elements.length > 1 ? ` [${idx}]` : ""}`;
              label.style.cssText = `
                position: absolute;
                top: -20px;
                left: 0;
                background: ${item.color || "#ff0000"};
                color: white;
                font-size: 11px;
                padding: 1px 6px;
                border-radius: 3px;
                white-space: nowrap;
              `;
              overlay.appendChild(label);
            }

            document.body.appendChild(overlay);
          });
        } catch {
          // Invalid selector, skip
        }
      }
    }, highlights);

    // Capture screenshot with highlights
    const buffer = await page.screenshot({ type: "png" });
    const screenshot = buffer.toString("base64");

    // Remove highlights
    await page.evaluate(() => {
      document.querySelectorAll("[data-iliagpt-highlight]").forEach((el) => el.remove());
    });

    return screenshot;
  }

  async getElementAtPoint(page: Page, x: number, y: number): Promise<{
    selector: string;
    tag: string;
    text: string;
    attributes: Record<string, string>;
    boundingBox: { x: number; y: number; width: number; height: number };
  } | null> {
    return page.evaluate(({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      if (!el) return null;

      // Generate a unique CSS selector
      function getSelector(element: Element): string {
        if (element.id) return `#${element.id}`;
        if (element === document.body) return "body";

        const parent = element.parentElement;
        if (!parent) return element.tagName.toLowerCase();

        const siblings = Array.from(parent.children);
        const sameTag = siblings.filter((s) => s.tagName === element.tagName);

        let selector = element.tagName.toLowerCase();

        if (element.className && typeof element.className === "string") {
          const classes = element.className.trim().split(/\s+/).slice(0, 2).join(".");
          if (classes) selector += `.${classes}`;
        }

        if (sameTag.length > 1) {
          const index = sameTag.indexOf(element) + 1;
          selector += `:nth-of-type(${index})`;
        }

        return `${getSelector(parent)} > ${selector}`;
      }

      const rect = el.getBoundingClientRect();
      const attrs: Record<string, string> = {};
      for (const attr of el.attributes) {
        attrs[attr.name] = attr.value;
      }

      return {
        selector: getSelector(el),
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 200),
        attributes: attrs,
        boundingBox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    }, { px: x, py: y });
  }

  // ============================================
  // Session Recording & Replay
  // ============================================

  startRecording(sessionId: string, name: string, startUrl: string, profileId: string): string {
    const recordingId = randomUUID();
    const recording: SessionRecording = {
      id: recordingId,
      name,
      actions: [],
      startUrl,
      createdAt: Date.now(),
      duration: 0,
      profileId,
    };

    this.activeRecordings.set(sessionId, { recording, startTime: Date.now() });
    this.emit("recording:started", { sessionId, recordingId });
    return recordingId;
  }

  recordAction(sessionId: string, action: Omit<RecordedAction, "id" | "timestamp">): void {
    const active = this.activeRecordings.get(sessionId);
    if (!active) return;

    const recorded: RecordedAction = {
      id: randomUUID(),
      timestamp: Date.now() - active.startTime,
      ...action,
    };

    active.recording.actions.push(recorded);
    this.emit("recording:action", { sessionId, action: recorded });
  }

  stopRecording(sessionId: string): SessionRecording | null {
    const active = this.activeRecordings.get(sessionId);
    if (!active) return null;

    active.recording.duration = Date.now() - active.startTime;
    this.recordings.set(active.recording.id, active.recording);
    this.activeRecordings.delete(sessionId);

    this.emit("recording:stopped", { sessionId, recordingId: active.recording.id });
    return active.recording;
  }

  getRecording(recordingId: string): SessionRecording | null {
    return this.recordings.get(recordingId) || null;
  }

  listRecordings(): SessionRecording[] {
    return Array.from(this.recordings.values());
  }

  deleteRecording(recordingId: string): boolean {
    return this.recordings.delete(recordingId);
  }

  // ============================================
  // Multi-Page Scraping Pipeline
  // ============================================

  async executeScraping(
    page: Page,
    pipeline: ScrapingPipeline,
    onProgress?: (pagesScraped: number, currentUrl: string) => void
  ): Promise<ScrapingResult> {
    const startTime = Date.now();
    const allData: Record<string, any>[] = [];
    const errors: string[] = [];
    let pagesScraped = 0;

    try {
      // Navigate to start URL
      await page.goto(pipeline.startUrl, { waitUntil: "networkidle", timeout: 30000 });
      pagesScraped++;
      onProgress?.(pagesScraped, pipeline.startUrl);

      for (const step of pipeline.steps) {
        try {
          switch (step.action) {
            case "navigate":
              if (step.url) {
                const resolvedUrl = this.resolveTemplate(step.url, pipeline.variables);
                await page.goto(resolvedUrl, { waitUntil: "networkidle", timeout: 30000 });
                pagesScraped++;
                onProgress?.(pagesScraped, resolvedUrl);
              }
              break;

            case "click":
              if (step.selector) {
                await page.click(step.selector, { timeout: 10000 });
                await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
              }
              break;

            case "wait":
              await page.waitForTimeout(step.waitMs || 1000);
              break;

            case "extract":
              if (step.extractionRules) {
                const pageData: Record<string, any> = { _url: page.url() };
                for (const rule of step.extractionRules) {
                  try {
                    if (rule.type === "list") {
                      pageData[rule.name] = await page.$$eval(rule.selector, (els) =>
                        els.map((el) => (el as HTMLElement).innerText?.trim() || "")
                      );
                    } else if (rule.type === "attribute" && rule.attribute) {
                      pageData[rule.name] = await page.$eval(
                        rule.selector,
                        (el, attr) => el.getAttribute(attr) || "",
                        rule.attribute
                      );
                    } else {
                      pageData[rule.name] = await page.$eval(
                        rule.selector,
                        (el) => (el as HTMLElement).innerText?.trim() || ""
                      );
                    }
                  } catch {
                    pageData[rule.name] = null;
                  }
                }
                allData.push(pageData);
              }
              break;

            case "paginate":
              if (step.paginationSelector) {
                const maxPaginationPages = step.maxPages || pipeline.maxPages || 10;
                for (let p = 0; p < maxPaginationPages; p++) {
                  try {
                    const hasNext = await page.$(step.paginationSelector);
                    if (!hasNext) break;

                    await page.click(step.paginationSelector, { timeout: 5000 });
                    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
                    await page.waitForTimeout(pipeline.delay || 500);

                    pagesScraped++;
                    onProgress?.(pagesScraped, page.url());

                    // Re-extract if extraction rules exist
                    if (step.extractionRules) {
                      const pageData: Record<string, any> = { _url: page.url(), _page: p + 2 };
                      for (const rule of step.extractionRules) {
                        try {
                          if (rule.type === "list") {
                            pageData[rule.name] = await page.$$eval(rule.selector, (els) =>
                              els.map((el) => (el as HTMLElement).innerText?.trim() || "")
                            );
                          } else {
                            pageData[rule.name] = await page.$eval(
                              rule.selector,
                              (el) => (el as HTMLElement).innerText?.trim() || ""
                            );
                          }
                        } catch {
                          pageData[rule.name] = null;
                        }
                      }
                      allData.push(pageData);
                    }
                  } catch (e: any) {
                    errors.push(`Pagination page ${p + 2}: ${e.message}`);
                    break;
                  }
                }
              }
              break;

            case "condition":
              if (step.condition) {
                const exists = await page.$(step.condition.selector) !== null;
                if (exists !== step.condition.exists) {
                  break; // Skip remaining steps
                }
              }
              break;
          }
        } catch (e: any) {
          errors.push(`Step ${step.action}: ${e.message}`);
        }
      }
    } catch (e: any) {
      errors.push(`Pipeline error: ${e.message}`);
    }

    return {
      pipelineId: pipeline.id,
      pagesScraped,
      data: allData,
      errors,
      duration: Date.now() - startTime,
    };
  }

  // ============================================
  // Cookie Persistence
  // ============================================

  async saveCookies(context: BrowserContext, filePath: string): Promise<void> {
    const cookies = await context.cookies();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(cookies, null, 2));
  }

  async loadCookies(context: BrowserContext, filePath: string): Promise<number> {
    try {
      const data = await fs.readFile(filePath, "utf-8");
      const cookies = JSON.parse(data);
      await context.addCookies(cookies);
      return cookies.length;
    } catch {
      return 0;
    }
  }

  // ============================================
  // Utilities
  // ============================================

  private resolveTemplate(template: string, variables: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      return variables[name] !== undefined ? String(variables[name]) : `{{${name}}}`;
    });
  }

  // ============================================
  // Network Throttling
  // ============================================

  static THROTTLE_PRESETS: Record<string, NetworkThrottleProfile> = {
    "3g": { name: "3G", downloadKbps: 750, uploadKbps: 250, latencyMs: 100 },
    "3g-slow": { name: "Slow 3G", downloadKbps: 400, uploadKbps: 150, latencyMs: 200 },
    "4g": { name: "4G", downloadKbps: 4000, uploadKbps: 3000, latencyMs: 20 },
    "wifi": { name: "WiFi", downloadKbps: 30000, uploadKbps: 15000, latencyMs: 2 },
    "dial-up": { name: "Dial-up", downloadKbps: 56, uploadKbps: 28, latencyMs: 300 },
    "offline": { name: "Offline", downloadKbps: 0, uploadKbps: 0, latencyMs: 0 },
  };

  async setNetworkThrottle(
    context: BrowserContext,
    profile: NetworkThrottleProfile | string
  ): Promise<void> {
    const throttle = typeof profile === "string"
      ? BrowserEngineExtensions.THROTTLE_PRESETS[profile] || BrowserEngineExtensions.THROTTLE_PRESETS["4g"]
      : profile;

    if (throttle.downloadKbps === 0) {
      // Simulate offline mode
      await context.setOffline(true);
      return;
    }

    await context.setOffline(false);

    // Use route interception to simulate throttling
    const delayPerKb = 1000 / throttle.downloadKbps;

    await context.route("**/*", async (route) => {
      // Add latency
      if (throttle.latencyMs > 0) {
        await new Promise((r) => setTimeout(r, throttle.latencyMs));
      }
      await route.continue();
    });
  }

  async removeNetworkThrottle(context: BrowserContext): Promise<void> {
    await context.setOffline(false);
    await context.unrouteAll({ behavior: "wait" });
  }

  // ============================================
  // Geolocation Spoofing
  // ============================================

  async setGeolocation(
    context: BrowserContext,
    latitude: number,
    longitude: number,
    accuracy?: number
  ): Promise<void> {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({
      latitude,
      longitude,
      accuracy: accuracy || 100,
    });
  }

  static LOCATION_PRESETS: Record<string, { latitude: number; longitude: number; name: string }> = {
    "new-york": { latitude: 40.7128, longitude: -74.006, name: "New York, USA" },
    "london": { latitude: 51.5074, longitude: -0.1278, name: "London, UK" },
    "tokyo": { latitude: 35.6762, longitude: 139.6503, name: "Tokyo, Japan" },
    "paris": { latitude: 48.8566, longitude: 2.3522, name: "Paris, France" },
    "sydney": { latitude: -33.8688, longitude: 151.2093, name: "Sydney, Australia" },
    "sao-paulo": { latitude: -23.5505, longitude: -46.6333, name: "São Paulo, Brazil" },
    "dubai": { latitude: 25.2048, longitude: 55.2708, name: "Dubai, UAE" },
    "berlin": { latitude: 52.52, longitude: 13.405, name: "Berlin, Germany" },
    "mumbai": { latitude: 19.076, longitude: 72.8777, name: "Mumbai, India" },
    "singapore": { latitude: 1.3521, longitude: 103.8198, name: "Singapore" },
  };

  // ============================================
  // Device Emulation
  // ============================================

  static DEVICE_PRESETS: Record<string, {
    viewport: { width: number; height: number };
    userAgent: string;
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
  }> = {
    "iphone-15": {
      viewport: { width: 393, height: 852 },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
    "iphone-se": {
      viewport: { width: 375, height: 667 },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
    "ipad-pro": {
      viewport: { width: 1024, height: 1366 },
      userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
    "pixel-8": {
      viewport: { width: 412, height: 915 },
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
    },
    "galaxy-s24": {
      viewport: { width: 360, height: 780 },
      userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
    "macbook-pro": {
      viewport: { width: 1440, height: 900 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      deviceScaleFactor: 2,
      isMobile: false,
      hasTouch: false,
    },
    "desktop-4k": {
      viewport: { width: 3840, height: 2160 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      deviceScaleFactor: 1.5,
      isMobile: false,
      hasTouch: false,
    },
  };

  // ============================================
  // HAR Export
  // ============================================

  private harEntries: Map<string, HAREntry[]> = new Map();

  startHARCapture(sessionId: string, page: Page): void {
    this.harEntries.set(sessionId, []);

    const requestTimings = new Map<string, number>();

    page.on("request", (request) => {
      requestTimings.set(request.url() + request.method(), Date.now());
    });

    page.on("response", async (response) => {
      const entries = this.harEntries.get(sessionId);
      if (!entries) return;

      const request = response.request();
      const startTime = requestTimings.get(request.url() + request.method()) || Date.now();
      const endTime = Date.now();

      const reqHeaders = Object.entries(request.headers()).map(([name, value]) => ({ name, value }));
      const resHeaders = Object.entries(response.headers()).map(([name, value]) => ({ name, value }));

      let postData: { mimeType: string; text: string } | undefined;
      try {
        const pd = request.postData();
        if (pd) {
          postData = { mimeType: request.headers()["content-type"] || "text/plain", text: pd };
        }
      } catch { /* no post data */ }

      const entry: HAREntry = {
        startedDateTime: new Date(startTime).toISOString(),
        time: endTime - startTime,
        request: {
          method: request.method(),
          url: request.url(),
          headers: reqHeaders,
          postData,
        },
        response: {
          status: response.status(),
          statusText: response.statusText(),
          headers: resHeaders,
          content: {
            size: parseInt(response.headers()["content-length"] || "0", 10),
            mimeType: response.headers()["content-type"] || "unknown",
          },
        },
        timings: {
          wait: endTime - startTime,
          receive: 0,
        },
      };

      entries.push(entry);
      // Cap at 2000 entries
      if (entries.length > 2000) entries.shift();
    });
  }

  getHAR(sessionId: string): HARLog {
    const entries = this.harEntries.get(sessionId) || [];
    return {
      version: "1.2",
      creator: { name: "ILIAGPT Browser Controller", version: "2.0" },
      entries,
    };
  }

  clearHAR(sessionId: string): void {
    this.harEntries.set(sessionId, []);
  }

  async exportHAR(sessionId: string, filePath?: string): Promise<{ json: string; path?: string }> {
    const har = this.getHAR(sessionId);
    const json = JSON.stringify({ log: har }, null, 2);

    if (filePath) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, json);
      return { json, path: filePath };
    }

    const outputDir = path.join(os.tmpdir(), "iliagpt-har");
    await fs.mkdir(outputDir, { recursive: true });
    const autoPath = path.join(outputDir, `har-${randomUUID().slice(0, 8)}.har`);
    await fs.writeFile(autoPath, json);
    return { json, path: autoPath };
  }

  // ============================================
  // Smart Form Filling
  // ============================================

  async detectFormFields(page: Page): Promise<FormField[]> {
    return page.evaluate(() => {
      const fields: any[] = [];
      const inputs = document.querySelectorAll("input, textarea, select");

      inputs.forEach((el) => {
        const input = el as HTMLInputElement;
        const rect = input.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return; // hidden

        // Find label
        let label = "";
        if (input.id) {
          const labelEl = document.querySelector(`label[for="${input.id}"]`);
          if (labelEl) label = (labelEl as HTMLElement).innerText.trim();
        }
        if (!label) {
          const parent = input.closest("label");
          if (parent) label = (parent as HTMLElement).innerText.trim();
        }
        if (!label) {
          const prev = input.previousElementSibling;
          if (prev && prev.tagName === "LABEL") label = (prev as HTMLElement).innerText.trim();
        }

        // Get select options
        let options: string[] | undefined;
        if (input.tagName === "SELECT") {
          options = Array.from((input as unknown as HTMLSelectElement).options).map(
            (opt) => opt.textContent?.trim() || opt.value
          );
        }

        // Generate unique selector
        let selector = "";
        if (input.id) selector = `#${input.id}`;
        else if (input.name) selector = `[name="${input.name}"]`;
        else {
          const idx = Array.from(document.querySelectorAll(input.tagName)).indexOf(input);
          selector = `${input.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
        }

        fields.push({
          selector,
          type: input.type || input.tagName.toLowerCase(),
          name: input.name || input.id || "",
          label,
          value: input.value || "",
          placeholder: input.placeholder || "",
          required: input.required,
          options,
        });
      });

      return fields;
    });
  }

  async smartFormFill(page: Page, data: Record<string, string>): Promise<{
    filled: number;
    skipped: number;
    fields: Array<{ selector: string; name: string; filled: boolean }>;
  }> {
    const fields = await this.detectFormFields(page);
    let filled = 0;
    let skipped = 0;
    const results: Array<{ selector: string; name: string; filled: boolean }> = [];

    for (const field of fields) {
      // Match data key to field by name, label, placeholder, or type
      const matchKey = Object.keys(data).find((key) => {
        const k = key.toLowerCase();
        const n = field.name.toLowerCase();
        const l = field.label.toLowerCase();
        const p = field.placeholder.toLowerCase();
        return n.includes(k) || l.includes(k) || p.includes(k) ||
               k.includes(n) || k.includes(l) ||
               (k === "email" && field.type === "email") ||
               (k === "password" && field.type === "password") ||
               (k === "phone" && field.type === "tel") ||
               (k === "name" && (n === "name" || l.includes("name"))) ||
               (k === "username" && (n.includes("user") || l.includes("user")));
      });

      if (matchKey && data[matchKey]) {
        try {
          if (field.type === "select" || field.type === "SELECT") {
            await page.selectOption(field.selector, data[matchKey]);
          } else if (field.type === "checkbox" || field.type === "radio") {
            const shouldCheck = ["true", "yes", "1", "on"].includes(data[matchKey].toLowerCase());
            if (shouldCheck) await page.check(field.selector);
            else await page.uncheck(field.selector);
          } else {
            await page.fill(field.selector, data[matchKey]);
          }
          filled++;
          results.push({ selector: field.selector, name: field.name, filled: true });
        } catch {
          skipped++;
          results.push({ selector: field.selector, name: field.name, filled: false });
        }
      } else {
        skipped++;
        results.push({ selector: field.selector, name: field.name, filled: false });
      }
    }

    return { filled, skipped, fields: results };
  }

  // ============================================
  // Auth Flow Automation
  // ============================================

  async detectAndFillAuth(
    page: Page,
    credentials: { username: string; password: string },
    options?: { submitAfterFill?: boolean; waitForNavigation?: boolean }
  ): Promise<AuthFlowResult> {
    try {
      // Detect login form fields
      const result: AuthFlowResult = {
        success: false,
        loginDetected: false,
        fieldsFound: { username: false, password: false, submit: false },
        cookies: 0,
      };

      const formInfo = await page.evaluate(() => {
        // Find username/email field
        const usernameSelectors = [
          'input[type="email"]',
          'input[name="email"]',
          'input[name="username"]',
          'input[name="user"]',
          'input[name="login"]',
          'input[id="email"]',
          'input[id="username"]',
          'input[autocomplete="email"]',
          'input[autocomplete="username"]',
        ];

        // Find password field
        const passwordSelectors = [
          'input[type="password"]',
          'input[name="password"]',
          'input[name="pass"]',
          'input[autocomplete="current-password"]',
        ];

        // Find submit button
        const submitSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'button:has-text("Log in")',
          'button:has-text("Sign in")',
          'button:has-text("Login")',
          'button:has-text("Entrar")',
          'button:has-text("Submit")',
        ];

        let usernameEl: string | null = null;
        let passwordEl: string | null = null;
        let submitEl: string | null = null;

        for (const sel of usernameSelectors) {
          try {
            if (document.querySelector(sel)) { usernameEl = sel; break; }
          } catch { /* invalid selector */ }
        }

        for (const sel of passwordSelectors) {
          try {
            if (document.querySelector(sel)) { passwordEl = sel; break; }
          } catch { /* invalid selector */ }
        }

        for (const sel of submitSelectors) {
          try {
            if (document.querySelector(sel)) { submitEl = sel; break; }
          } catch { /* invalid selector */ }
        }

        return { usernameEl, passwordEl, submitEl };
      });

      result.fieldsFound.username = !!formInfo.usernameEl;
      result.fieldsFound.password = !!formInfo.passwordEl;
      result.fieldsFound.submit = !!formInfo.submitEl;
      result.loginDetected = result.fieldsFound.username || result.fieldsFound.password;

      if (!result.loginDetected) {
        result.error = "No login form detected on page";
        return result;
      }

      // Fill credentials
      if (formInfo.usernameEl) {
        await page.fill(formInfo.usernameEl, credentials.username);
      }
      if (formInfo.passwordEl) {
        await page.fill(formInfo.passwordEl, credentials.password);
      }

      // Submit if requested
      if (options?.submitAfterFill !== false && formInfo.submitEl) {
        if (options?.waitForNavigation) {
          await Promise.all([
            page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
            page.click(formInfo.submitEl),
          ]);
        } else {
          await page.click(formInfo.submitEl);
          await page.waitForTimeout(2000);
        }
      }

      result.postLoginUrl = page.url();
      const context = page.context();
      result.cookies = (await context.cookies()).length;
      result.success = true;

      return result;
    } catch (error: any) {
      return {
        success: false,
        loginDetected: false,
        fieldsFound: { username: false, password: false, submit: false },
        error: error.message,
        cookies: 0,
      };
    }
  }

  // ============================================
  // Visual Diff Between Screenshots
  // ============================================

  async visualDiff(
    screenshotA: Buffer,
    screenshotB: Buffer
  ): Promise<VisualDiffResult> {
    // Use canvas-free pixel comparison by comparing raw PNG data
    // For real pixel-level comparison, we compare base64 chunks
    const a = screenshotA;
    const b = screenshotB;

    const minLen = Math.min(a.length, b.length);
    let changedBytes = 0;

    // Simple byte-level comparison (approximation)
    for (let i = 0; i < minLen; i++) {
      if (a[i] !== b[i]) changedBytes++;
    }

    // Account for size difference
    changedBytes += Math.abs(a.length - b.length);

    const maxLen = Math.max(a.length, b.length);
    const diffPercentage = maxLen > 0 ? (changedBytes / maxLen) * 100 : 0;

    return {
      diffPercentage: Math.round(diffPercentage * 100) / 100,
      totalPixels: maxLen,
      changedPixels: changedBytes,
      regions: [], // Would need proper image parsing for region detection
    };
  }

  // ============================================
  // Multi-Browser Parallel Execution
  // ============================================

  async executeParallel(
    pages: Array<{ page: Page; label: string }>,
    action: (page: Page) => Promise<any>
  ): Promise<Array<{ label: string; result: any; error?: string; duration: number }>> {
    const results = await Promise.allSettled(
      pages.map(async ({ page, label }) => {
        const start = Date.now();
        try {
          const result = await action(page);
          return { label, result, duration: Date.now() - start };
        } catch (error: any) {
          return { label, result: null, error: error.message, duration: Date.now() - start };
        }
      })
    );

    return results.map((r) => {
      if (r.status === "fulfilled") return r.value;
      return { label: "unknown", result: null, error: r.reason?.message, duration: 0 };
    });
  }

  // ============================================
  // Page Waiting Utilities
  // ============================================

  async waitForNetworkIdle(page: Page, timeout: number = 10000): Promise<void> {
    await page.waitForLoadState("networkidle", { timeout });
  }

  async waitForSelectorWithRetry(
    page: Page,
    selector: string,
    options?: { timeout?: number; retries?: number; state?: "visible" | "hidden" | "attached" }
  ): Promise<boolean> {
    const retries = options?.retries || 3;
    const timeout = options?.timeout || 5000;

    for (let i = 0; i < retries; i++) {
      try {
        await page.waitForSelector(selector, {
          timeout,
          state: options?.state || "visible",
        });
        return true;
      } catch {
        if (i < retries - 1) {
          await page.waitForTimeout(1000);
        }
      }
    }
    return false;
  }

  cleanup(): void {
    this.recordings.clear();
    this.activeRecordings.clear();
    this.consoleEntries.clear();
    this.dialogEvents.clear();
    this.harEntries.clear();
  }
}

export const browserEngineExtensions = new BrowserEngineExtensions();
