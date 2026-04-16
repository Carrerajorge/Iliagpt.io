/**
 * Claw Browser Tool — Lightweight Playwright-based browser automation
 * for the Claw agent subsystem.
 *
 * Lazy-launches a headless Chromium instance on first use.
 */

import { z } from "zod";
import type { Browser, BrowserContext, Page } from "playwright";

export interface PageInfo {
  url: string;
  title: string;
  textContent: string;
  links: { text: string; href: string }[];
}

const NAV_TIMEOUT = 30_000;

export class BrowserTool {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;

    if (!this.browser) {
      // Dynamic import so Playwright is only loaded when actually needed
      const pw = await import("playwright");
      this.browser = await pw.chromium.launch({ headless: true });
    }

    this.context = await this.browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    this.page = await this.context.newPage();
    this.page.setDefaultNavigationTimeout(NAV_TIMEOUT);
    this.page.setDefaultTimeout(NAV_TIMEOUT);
    return this.page;
  }

  /** Navigate to a URL and return structured page information. */
  async navigate(url: string): Promise<PageInfo> {
    const page = await this.ensurePage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

    const [title, textContent, links] = await Promise.all([
      page.title(),
      page.evaluate(() => document.body?.innerText?.slice(0, 100_000) ?? ""),
      page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .slice(0, 50)
          .map((a) => ({
            text: (a as HTMLAnchorElement).innerText.trim().slice(0, 120),
            href: (a as HTMLAnchorElement).href,
          }))
      ),
    ]);

    return { url: page.url(), title, textContent, links };
  }

  /** Take a screenshot and return it as a Buffer. */
  async screenshot(opts?: { fullPage?: boolean }): Promise<Buffer> {
    const page = await this.ensurePage();
    const buf = await page.screenshot({
      fullPage: opts?.fullPage ?? false,
      type: "png",
    });
    return Buffer.from(buf);
  }

  /** Extract text content from the page or a specific element. */
  async extractContent(selector?: string): Promise<string> {
    const page = await this.ensurePage();
    if (selector) {
      const el = await page.$(selector);
      if (!el) return `[no element found for selector: ${selector}]`;
      return (await el.innerText()) ?? "";
    }
    return page.evaluate(() => document.body?.innerText ?? "");
  }

  /** Click an element matching the given selector. */
  async click(selector: string): Promise<void> {
    const page = await this.ensurePage();
    await page.click(selector, { timeout: NAV_TIMEOUT });
  }

  /** Type text into an input element matching the given selector. */
  async type(selector: string, text: string): Promise<void> {
    const page = await this.ensurePage();
    await page.fill(selector, text);
  }

  /** Close the browser and release all resources. */
  async close(): Promise<void> {
    try {
      if (this.page && !this.page.isClosed()) await this.page.close();
    } catch { /* ignore */ }
    try {
      if (this.context) await this.context.close();
    } catch { /* ignore */ }
    try {
      if (this.browser) await this.browser.close();
    } catch { /* ignore */ }
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}

/* ------------------------------------------------------------------ */
/*  Tool definition for the Claw agent tool registry                  */
/* ------------------------------------------------------------------ */

const clawBrowserInputSchema = z.object({
  action: z
    .enum(["navigate", "screenshot", "extract", "click", "type"])
    .describe("The browser action to perform"),
  url: z.string().optional().describe("URL to navigate to (required for 'navigate')"),
  selector: z
    .string()
    .optional()
    .describe("CSS selector for click, type, or extract actions"),
  text: z.string().optional().describe("Text to type (required for 'type' action)"),
  fullPage: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to capture a full-page screenshot"),
});

export type ClawBrowserInput = z.infer<typeof clawBrowserInputSchema>;

/**
 * Singleton-style tool definition compatible with the IliaGPT tool registry.
 * Manages one BrowserTool instance per invocation context.
 */
export const BROWSER_TOOL_DEFINITION = {
  name: "claw_browser",
  description:
    "Interact with a headless browser: navigate to URLs, take screenshots, extract content, click elements, and type text. Supports actions: navigate, screenshot, extract, click, type.",
  inputSchema: clawBrowserInputSchema,
  capabilities: ["requires_network" as const, "accesses_external_api" as const],
  safetyPolicy: "requires_confirmation" as const,
  timeoutMs: 60_000,

  /** Shared browser instance across calls within one session. */
  _browser: null as BrowserTool | null,

  async execute(input: ClawBrowserInput): Promise<{ success: boolean; output: unknown; error?: string }> {
    if (!this._browser) this._browser = new BrowserTool();
    const browser = this._browser;

    try {
      switch (input.action) {
        case "navigate": {
          if (!input.url) return { success: false, output: null, error: "url is required for navigate" };
          const info = await browser.navigate(input.url);
          return { success: true, output: info };
        }
        case "screenshot": {
          const buf = await browser.screenshot({ fullPage: input.fullPage });
          return { success: true, output: { size: buf.length, base64: buf.toString("base64").slice(0, 200) + "..." } };
        }
        case "extract": {
          const text = await browser.extractContent(input.selector);
          return { success: true, output: { text: text.slice(0, 50_000) } };
        }
        case "click": {
          if (!input.selector) return { success: false, output: null, error: "selector is required for click" };
          await browser.click(input.selector);
          return { success: true, output: { clicked: input.selector } };
        }
        case "type": {
          if (!input.selector || !input.text) return { success: false, output: null, error: "selector and text are required for type" };
          await browser.type(input.selector, input.text);
          return { success: true, output: { typed: input.text, into: input.selector } };
        }
        default:
          return { success: false, output: null, error: `Unknown action: ${input.action}` };
      }
    } catch (err: any) {
      return { success: false, output: null, error: err.message ?? String(err) };
    }
  },
};
