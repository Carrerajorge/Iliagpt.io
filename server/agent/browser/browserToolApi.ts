/**
 * Browser Tool API — Structured browser automation interface for the agent.
 *
 * Provides a small, powerful set of actions:
 *   browser.open(url)
 *   browser.waitFor(condition)
 *   browser.click(target)
 *   browser.type(target, text)
 *   browser.extract(type, target)
 *   browser.screenshot(scope)
 *   browser.assert(condition)
 *   browser.downloadWait()
 *
 * The agent communicates with the browser through structured actions,
 * not free-text. This keeps things deterministic and auditable.
 */

import { z } from "zod";
import { browserSessionManager } from "./session-manager";
import { SelectorResolver, type SelectorTarget } from "./selectorStrategy";
import { BrowserExpect, type AssertionResult } from "./assertionDsl";
import type { Page } from "playwright";

/* ------------------------------------------------------------------ */
/*  Action schemas (JSON Schema contracts for the agent)              */
/* ------------------------------------------------------------------ */

export const BrowserOpenSchema = z.object({
  action: z.literal("browser.open"),
  url: z.string().url(),
  contextProfile: z.string().optional(),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).default("networkidle"),
});

export const BrowserWaitForSchema = z.object({
  action: z.literal("browser.wait_for"),
  condition: z.enum(["selector", "text", "url_change", "network_idle", "timeout"]),
  value: z.string().optional(),
  timeout: z.number().int().positive().default(30_000),
});

export const BrowserClickSchema = z.object({
  action: z.literal("browser.click"),
  target: z.string(),
  doubleClick: z.boolean().default(false),
  button: z.enum(["left", "right", "middle"]).default("left"),
});

export const BrowserTypeSchema = z.object({
  action: z.literal("browser.type"),
  target: z.string(),
  text: z.string(),
  clear: z.boolean().default(true),
  pressEnter: z.boolean().default(false),
});

export const BrowserExtractSchema = z.object({
  action: z.literal("browser.extract"),
  type: z.enum(["text", "html", "table", "attributes", "links", "value"]),
  target: z.string().optional(),
  limit: z.number().int().positive().default(50),
});

export const BrowserScreenshotSchema = z.object({
  action: z.literal("browser.screenshot"),
  scope: z.enum(["viewport", "element", "fullpage"]).default("viewport"),
  target: z.string().optional(),
});

export const BrowserAssertSchema = z.object({
  action: z.literal("browser.assert"),
  assertion: z.enum([
    "visible",
    "hidden",
    "text_contains",
    "text_equals",
    "url_matches",
    "title_contains",
    "network_status",
    "element_count",
    "attribute_equals",
  ]),
  target: z.string().optional(),
  expected: z.union([z.string(), z.number()]).optional(),
  extra: z.record(z.any()).optional(),
});

export const BrowserDownloadWaitSchema = z.object({
  action: z.literal("browser.download_wait"),
  triggerSelector: z.string(),
  timeout: z.number().int().positive().default(30_000),
});

export const BrowserSelectSchema = z.object({
  action: z.literal("browser.select"),
  target: z.string(),
  value: z.string(),
});

export const BrowserScrollSchema = z.object({
  action: z.literal("browser.scroll"),
  direction: z.enum(["up", "down"]),
  amount: z.number().int().positive().default(300),
});

export const BrowserActionSchema = z.discriminatedUnion("action", [
  BrowserOpenSchema,
  BrowserWaitForSchema,
  BrowserClickSchema,
  BrowserTypeSchema,
  BrowserExtractSchema,
  BrowserScreenshotSchema,
  BrowserAssertSchema,
  BrowserDownloadWaitSchema,
  BrowserSelectSchema,
  BrowserScrollSchema,
]);

export type BrowserActionInput = z.infer<typeof BrowserActionSchema>;

/* ------------------------------------------------------------------ */
/*  Result type                                                       */
/* ------------------------------------------------------------------ */

export interface BrowserActionResult {
  success: boolean;
  action: string;
  data?: any;
  screenshot?: string;
  selector?: SelectorTarget;
  assertion?: AssertionResult;
  error?: string;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/*  Browser Tool API                                                  */
/* ------------------------------------------------------------------ */

export class BrowserToolApi {
  private sessionId: string | null = null;
  private selectorResolver: SelectorResolver | null = null;
  private browserExpect: BrowserExpect | null = null;
  private mode: "dom" | "visual" = "dom";

  /**
   * Execute a structured browser action.
   */
  async execute(input: BrowserActionInput): Promise<BrowserActionResult> {
    const start = Date.now();
    const parsed = BrowserActionSchema.parse(input);

    try {
      switch (parsed.action) {
        case "browser.open":
          return await this.handleOpen(parsed, start);
        case "browser.wait_for":
          return await this.handleWaitFor(parsed, start);
        case "browser.click":
          return await this.handleClick(parsed, start);
        case "browser.type":
          return await this.handleType(parsed, start);
        case "browser.extract":
          return await this.handleExtract(parsed, start);
        case "browser.screenshot":
          return await this.handleScreenshot(parsed, start);
        case "browser.assert":
          return await this.handleAssert(parsed, start);
        case "browser.download_wait":
          return await this.handleDownloadWait(parsed, start);
        case "browser.select":
          return await this.handleSelect(parsed, start);
        case "browser.scroll":
          return await this.handleScroll(parsed, start);
        default:
          return { success: false, action: "unknown", error: "Unknown action", durationMs: Date.now() - start };
      }
    } catch (err: any) {
      return {
        success: false,
        action: parsed.action,
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  }

  setMode(mode: "dom" | "visual"): void {
    this.mode = mode;
  }

  getMode(): "dom" | "visual" {
    return this.mode;
  }

  async cleanup(): Promise<void> {
    if (this.sessionId) {
      await browserSessionManager.closeSession(this.sessionId);
      this.sessionId = null;
      this.selectorResolver = null;
      this.browserExpect = null;
    }
  }

  /* -- Action handlers --------------------------------------------- */

  private async handleOpen(
    input: z.infer<typeof BrowserOpenSchema>,
    start: number
  ): Promise<BrowserActionResult> {
    // Create a new session if one doesn't exist
    if (!this.sessionId) {
      this.sessionId = await browserSessionManager.createSession(
        `Navigate to ${input.url}`,
        { enableNetworkCapture: true }
      );
    }

    const result = await browserSessionManager.navigate(this.sessionId, input.url);
    await this.initResolverAndExpect();

    return {
      success: result.success,
      action: "browser.open",
      data: result.data,
      screenshot: result.screenshot,
      error: result.error,
      durationMs: Date.now() - start,
    };
  }

  private async handleWaitFor(
    input: z.infer<typeof BrowserWaitForSchema>,
    start: number
  ): Promise<BrowserActionResult> {
    this.ensureSession();
    const page = await this.getPage();

    try {
      switch (input.condition) {
        case "selector":
          await page.waitForSelector(input.value || "body", { timeout: input.timeout });
          break;
        case "text":
          await page.waitForFunction(
            (text: string) => document.body.innerText.includes(text),
            input.value || "",
            { timeout: input.timeout }
          );
          break;
        case "url_change":
          await page.waitForURL(input.value ? new RegExp(input.value) : /.*/, {
            timeout: input.timeout,
          });
          break;
        case "network_idle":
          await page.waitForLoadState("networkidle", { timeout: input.timeout });
          break;
        case "timeout":
          await page.waitForTimeout(Math.min(input.timeout, 30_000));
          break;
      }

      return { success: true, action: "browser.wait_for", durationMs: Date.now() - start };
    } catch (err: any) {
      return {
        success: false,
        action: "browser.wait_for",
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  }

  private async handleClick(
    input: z.infer<typeof BrowserClickSchema>,
    start: number
  ): Promise<BrowserActionResult> {
    this.ensureSession();
    const page = await this.getPage();
    await this.initResolverAndExpect();

    const resolved = await this.selectorResolver!.resolve(input.target, { requireVisible: true });
    const locator = this.selectorResolver!.getLocator(resolved);

    if (input.doubleClick) {
      await locator.dblclick({ button: input.button, timeout: 10_000 });
    } else {
      await locator.click({ button: input.button, timeout: 10_000 });
    }

    // Wait for navigation if it occurs
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

    const screenshot = await this.takeScreenshot(page);

    return {
      success: true,
      action: "browser.click",
      selector: resolved,
      screenshot,
      data: { url: page.url() },
      durationMs: Date.now() - start,
    };
  }

  private async handleType(
    input: z.infer<typeof BrowserTypeSchema>,
    start: number
  ): Promise<BrowserActionResult> {
    this.ensureSession();
    const page = await this.getPage();
    await this.initResolverAndExpect();

    const resolved = await this.selectorResolver!.resolve(input.target, { requireVisible: true });
    const locator = this.selectorResolver!.getLocator(resolved);

    if (input.clear) {
      await locator.fill(input.text, { timeout: 10_000 });
    } else {
      await locator.type(input.text, { timeout: 10_000 });
    }

    if (input.pressEnter) {
      await locator.press("Enter");
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    }

    return {
      success: true,
      action: "browser.type",
      selector: resolved,
      durationMs: Date.now() - start,
    };
  }

  private async handleExtract(
    input: z.infer<typeof BrowserExtractSchema>,
    start: number
  ): Promise<BrowserActionResult> {
    this.ensureSession();
    const page = await this.getPage();

    let data: any;

    switch (input.type) {
      case "text": {
        if (input.target) {
          data = await page.locator(input.target).first().innerText();
        } else {
          data = await page.evaluate(() => document.body.innerText);
        }
        if (typeof data === "string") data = data.slice(0, 10_000);
        break;
      }
      case "html": {
        if (input.target) {
          data = await page.locator(input.target).first().innerHTML();
        } else {
          data = await page.content();
        }
        if (typeof data === "string") data = data.slice(0, 20_000);
        break;
      }
      case "table": {
        data = await page.evaluate((sel: string | undefined) => {
          const table = sel ? document.querySelector(sel) : document.querySelector("table");
          if (!table) return null;
          const rows = Array.from(table.querySelectorAll("tr"));
          return rows.slice(0, 100).map((row) =>
            Array.from(row.querySelectorAll("th, td")).map((cell) => (cell as HTMLElement).innerText.trim())
          );
        }, input.target);
        break;
      }
      case "attributes": {
        if (!input.target) throw new Error("target required for attribute extraction");
        data = await page.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const attrs: Record<string, string> = {};
          for (const attr of el.attributes) {
            attrs[attr.name] = attr.value;
          }
          return attrs;
        }, input.target);
        break;
      }
      case "links": {
        data = await page.evaluate((limit: number) => {
          return Array.from(document.querySelectorAll("a[href]"))
            .slice(0, limit)
            .map((a) => ({
              text: (a as HTMLAnchorElement).innerText.trim(),
              href: (a as HTMLAnchorElement).href,
            }));
        }, input.limit);
        break;
      }
      case "value": {
        if (!input.target) throw new Error("target required for value extraction");
        data = await page.locator(input.target).first().inputValue();
        break;
      }
    }

    return {
      success: true,
      action: "browser.extract",
      data,
      durationMs: Date.now() - start,
    };
  }

  private async handleScreenshot(
    input: z.infer<typeof BrowserScreenshotSchema>,
    start: number
  ): Promise<BrowserActionResult> {
    this.ensureSession();
    const page = await this.getPage();

    let buffer: Buffer;

    switch (input.scope) {
      case "element": {
        if (!input.target) throw new Error("target required for element screenshot");
        buffer = await page.locator(input.target).first().screenshot({ type: "png" });
        break;
      }
      case "fullpage":
        buffer = await page.screenshot({ type: "png", fullPage: true });
        break;
      default:
        buffer = await page.screenshot({ type: "png", fullPage: false });
    }

    const screenshot = `data:image/png;base64,${buffer.toString("base64")}`;

    return {
      success: true,
      action: "browser.screenshot",
      screenshot,
      durationMs: Date.now() - start,
    };
  }

  private async handleAssert(
    input: z.infer<typeof BrowserAssertSchema>,
    start: number
  ): Promise<BrowserActionResult> {
    this.ensureSession();
    await this.initResolverAndExpect();

    let result: AssertionResult;

    switch (input.assertion) {
      case "visible":
        result = await this.browserExpect!.visible(input.target || "body");
        break;
      case "hidden":
        result = await this.browserExpect!.hidden(input.target || "body");
        break;
      case "text_contains":
        result = await this.browserExpect!.textContains(
          input.target || "body",
          String(input.expected || "")
        );
        break;
      case "text_equals":
        result = await this.browserExpect!.textEquals(
          input.target || "body",
          String(input.expected || "")
        );
        break;
      case "url_matches":
        result = await this.browserExpect!.urlMatches(String(input.expected || ".*"));
        break;
      case "title_contains":
        result = await this.browserExpect!.titleContains(String(input.expected || ""));
        break;
      case "network_status":
        result = await this.browserExpect!.networkStatus(
          String(input.target || ".*"),
          input.extra?.range || [200, 299]
        );
        break;
      case "element_count":
        result = await this.browserExpect!.elementCount(
          input.target || "body",
          Number(input.expected || 1)
        );
        break;
      case "attribute_equals":
        result = await this.browserExpect!.attributeEquals(
          input.target || "body",
          String(input.extra?.attribute || "class"),
          String(input.expected || "")
        );
        break;
      default:
        result = { name: "unknown", status: "error", message: "Unknown assertion", evidence: { timestamp: Date.now() }, durationMs: 0 };
    }

    return {
      success: result.status === "pass",
      action: "browser.assert",
      assertion: result,
      durationMs: Date.now() - start,
    };
  }

  private async handleDownloadWait(
    input: z.infer<typeof BrowserDownloadWaitSchema>,
    start: number
  ): Promise<BrowserActionResult> {
    this.ensureSession();
    const page = await this.getPage();

    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: input.timeout }),
        page.click(input.triggerSelector, { timeout: 10_000 }),
      ]);

      const filename = download.suggestedFilename();
      const path = await download.path();

      return {
        success: true,
        action: "browser.download_wait",
        data: { filename, path },
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        action: "browser.download_wait",
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  }

  private async handleSelect(
    input: z.infer<typeof BrowserSelectSchema>,
    start: number
  ): Promise<BrowserActionResult> {
    this.ensureSession();
    const page = await this.getPage();

    await page.selectOption(input.target, input.value, { timeout: 10_000 });

    return {
      success: true,
      action: "browser.select",
      durationMs: Date.now() - start,
    };
  }

  private async handleScroll(
    input: z.infer<typeof BrowserScrollSchema>,
    start: number
  ): Promise<BrowserActionResult> {
    this.ensureSession();
    const result = await browserSessionManager.scroll(
      this.sessionId!,
      input.direction,
      input.amount
    );

    return {
      success: result.success,
      action: "browser.scroll",
      screenshot: result.screenshot,
      error: result.error,
      durationMs: Date.now() - start,
    };
  }

  /* -- Helpers ----------------------------------------------------- */

  private ensureSession(): void {
    if (!this.sessionId) {
      throw new Error("No browser session. Call browser.open first.");
    }
  }

  private async getPage(): Promise<Page> {
    const session = browserSessionManager.getSession(this.sessionId!);
    if (!session) throw new Error("Browser session not found");
    // Access internal page — the session manager holds the reference
    const internal = (browserSessionManager as any).sessions?.get(this.sessionId!);
    if (!internal?.page) throw new Error("Browser page not accessible");
    return internal.page;
  }

  private async initResolverAndExpect(): Promise<void> {
    if (!this.selectorResolver) {
      const page = await this.getPage();
      this.selectorResolver = new SelectorResolver(page);
      this.browserExpect = new BrowserExpect(page);
    }
  }

  private async takeScreenshot(page: Page): Promise<string> {
    try {
      const buffer = await page.screenshot({ type: "png", fullPage: false });
      return `data:image/png;base64,${buffer.toString("base64")}`;
    } catch {
      return "";
    }
  }
}
