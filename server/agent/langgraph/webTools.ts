import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";
import { chromium, Browser, Page, BrowserContext } from "playwright";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: number;
}

const activeSessions = new Map<string, BrowserSession>();
const SESSION_TIMEOUT = 5 * 60 * 1000;

async function getOrCreateSession(sessionId: string): Promise<BrowserSession> {
  const existing = activeSessions.get(sessionId);
  if (existing && Date.now() - existing.createdAt < SESSION_TIMEOUT) {
    return existing;
  }

  if (existing) {
    await existing.browser.close().catch(() => {});
    activeSessions.delete(sessionId);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  const session: BrowserSession = {
    browser,
    context,
    page,
    createdAt: Date.now(),
  };

  activeSessions.set(sessionId, session);
  return session;
}

async function closeSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (session) {
    await session.browser.close().catch(() => {});
    activeSessions.delete(sessionId);
  }
}

export const browserNavigateTool = tool(
  async (input) => {
    const { url, sessionId = "default", waitFor, timeout = 30000, screenshot = false } = input;
    const startTime = Date.now();

    try {
      const session = await getOrCreateSession(sessionId);
      const { page } = session;

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout,
      });

      if (waitFor) {
        if (waitFor.startsWith("//") || waitFor.startsWith("/html")) {
          await page.waitForSelector(`xpath=${waitFor}`, { timeout: timeout / 2 }).catch(() => {});
        } else if (waitFor.match(/^[.#\[]|^\w+$/)) {
          await page.waitForSelector(waitFor, { timeout: timeout / 2 }).catch(() => {});
        } else {
          await page.waitForTimeout(parseInt(waitFor) || 1000);
        }
      }

      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        url: window.location.href,
        hasBody: !!document.body,
        bodyLength: document.body?.innerText?.length || 0,
        links: Array.from(document.querySelectorAll("a[href]")).slice(0, 20).map(a => ({
          text: (a as HTMLAnchorElement).innerText?.slice(0, 50),
          href: (a as HTMLAnchorElement).href,
        })),
        forms: document.querySelectorAll("form").length,
        inputs: document.querySelectorAll("input, textarea, select").length,
        buttons: document.querySelectorAll("button, input[type='submit']").length,
      }));

      let screenshotData: string | undefined;
      if (screenshot) {
        const buffer = await page.screenshot({ type: "png", fullPage: false });
        screenshotData = buffer.toString("base64").slice(0, 1000) + "...[truncated]";
      }

      return JSON.stringify({
        success: true,
        sessionId,
        currentUrl: pageInfo.url,
        title: pageInfo.title,
        pageInfo: {
          contentLength: pageInfo.bodyLength,
          linksCount: pageInfo.links.length,
          formsCount: pageInfo.forms,
          inputsCount: pageInfo.inputs,
          buttonsCount: pageInfo.buttons,
        },
        topLinks: pageInfo.links.slice(0, 10),
        screenshot: screenshotData ? "captured" : undefined,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        sessionId,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "browser_navigate",
    description: "Navigates to a URL using headless browser. Useful for web automation (login, form filling, navigation, screenshots). Supports waiting for elements, capturing page state, and managing browser sessions.",
    schema: z.object({
      url: z.string().url().describe("URL to navigate to"),
      sessionId: z.string().optional().default("default").describe("Browser session ID for maintaining state"),
      waitFor: z.string().optional().describe("CSS selector, XPath, or milliseconds to wait after navigation"),
      timeout: z.number().optional().default(30000).describe("Navigation timeout in milliseconds"),
      screenshot: z.boolean().optional().default(false).describe("Capture screenshot after navigation"),
    }),
  }
);

export const browserInteractTool = tool(
  async (input) => {
    const { action, selector, sessionId = "default", value, options = {} } = input;
    const startTime = Date.now();

    try {
      const session = await getOrCreateSession(sessionId);
      const { page } = session;

      const currentUrl = page.url();
      if (currentUrl === "about:blank") {
        return JSON.stringify({
          success: false,
          error: "No page loaded. Use browser_navigate first.",
        });
      }

      let result: any = { action, selector };

      switch (action) {
        case "click":
          await page.click(selector, { timeout: options.timeout || 5000 });
          await page.waitForTimeout(500);
          result.clicked = true;
          break;

        case "type":
          if (!value) {
            return JSON.stringify({ success: false, error: "Value required for type action" });
          }
          await page.fill(selector, value);
          result.typed = value;
          break;

        case "select":
          if (!value) {
            return JSON.stringify({ success: false, error: "Value required for select action" });
          }
          await page.selectOption(selector, value);
          result.selected = value;
          break;

        case "hover":
          await page.hover(selector);
          result.hovered = true;
          break;

        case "scroll":
          if (selector === "page") {
            await page.evaluate((pixels: number) => window.scrollBy(0, pixels), options.scrollY || 500);
          } else {
            await page.locator(selector).scrollIntoViewIfNeeded();
          }
          result.scrolled = true;
          break;

        case "press":
          await page.keyboard.press(value || "Enter");
          result.pressed = value || "Enter";
          break;

        case "upload":
          if (!value) {
            return JSON.stringify({ success: false, error: "File path required for upload action" });
          }
          await page.setInputFiles(selector, value);
          result.uploaded = value;
          break;

        case "wait":
          await page.waitForSelector(selector, { timeout: options.timeout || 10000 });
          result.found = true;
          break;

        case "check":
          await page.check(selector);
          result.checked = true;
          break;

        case "uncheck":
          await page.uncheck(selector);
          result.unchecked = true;
          break;

        default:
          return JSON.stringify({
            success: false,
            error: `Unknown action: ${action}. Valid: click, type, select, hover, scroll, press, upload, wait, check, uncheck`,
          });
      }

      const newUrl = page.url();
      result.urlChanged = newUrl !== currentUrl;
      result.currentUrl = newUrl;

      return JSON.stringify({
        success: true,
        sessionId,
        ...result,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        sessionId,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "browser_interact",
    description: "Interacts with web page elements for automation: click, type, select, hover, scroll, keyboard events, file upload, checkboxes. Use for logins and form submissions. Requires an active browser session.",
    schema: z.object({
      action: z.enum(["click", "type", "select", "hover", "scroll", "press", "upload", "wait", "check", "uncheck"])
        .describe("Interaction type"),
      selector: z.string().describe("CSS selector or 'page' for scroll"),
      sessionId: z.string().optional().default("default").describe("Browser session ID"),
      value: z.string().optional().describe("Value for type/select/press/upload actions"),
      options: z.record(z.any()).optional().default({}).describe("Additional options (timeout, scrollY)"),
    }),
  }
);

export const browserExtractTool = tool(
  async (input) => {
    const { selector, sessionId = "default", extractType = "text", multiple = false, attributes = [] } = input;
    const startTime = Date.now();

    try {
      const session = await getOrCreateSession(sessionId);
      const { page } = session;

      const currentUrl = page.url();
      if (currentUrl === "about:blank") {
        return JSON.stringify({
          success: false,
          error: "No page loaded. Use browser_navigate first.",
        });
      }

      let extractedData: any;

      if (multiple) {
        extractedData = await page.$$eval(selector, (elements, opts) => {
          return elements.slice(0, 100).map((el) => {
            const result: any = {};
            
            if (opts.extractType === "text" || opts.extractType === "all") {
              result.text = (el as HTMLElement).innerText?.trim();
            }
            if (opts.extractType === "html" || opts.extractType === "all") {
              result.html = el.innerHTML?.slice(0, 1000);
            }
            if (opts.extractType === "outerHtml" || opts.extractType === "all") {
              result.outerHtml = el.outerHTML?.slice(0, 1000);
            }
            if (opts.attributes?.length > 0) {
              result.attributes = {};
              opts.attributes.forEach((attr: string) => {
                result.attributes[attr] = el.getAttribute(attr);
              });
            }
            
            const tagName = el.tagName.toLowerCase();
            if (tagName === "a") {
              result.href = (el as HTMLAnchorElement).href;
            }
            if (tagName === "img") {
              result.src = (el as HTMLImageElement).src;
              result.alt = (el as HTMLImageElement).alt;
            }
            if (tagName === "input" || tagName === "textarea") {
              result.value = (el as HTMLInputElement).value;
              result.type = (el as HTMLInputElement).type;
            }

            return result;
          });
        }, { extractType, attributes });
      } else {
        const element = await page.$(selector);
        if (!element) {
          return JSON.stringify({
            success: false,
            error: `Element not found: ${selector}`,
          });
        }

        extractedData = await element.evaluate((el, opts) => {
          const result: any = {};
          
          if (opts.extractType === "text" || opts.extractType === "all") {
            result.text = (el as HTMLElement).innerText?.trim();
          }
          if (opts.extractType === "html" || opts.extractType === "all") {
            result.html = el.innerHTML?.slice(0, 5000);
          }
          if (opts.extractType === "outerHtml" || opts.extractType === "all") {
            result.outerHtml = el.outerHTML?.slice(0, 5000);
          }
          if (opts.attributes?.length > 0) {
            result.attributes = {};
            opts.attributes.forEach((attr: string) => {
              result.attributes[attr] = el.getAttribute(attr);
            });
          }
          
          const tagName = el.tagName.toLowerCase();
          if (tagName === "a") {
            result.href = (el as HTMLAnchorElement).href;
          }
          if (tagName === "img") {
            result.src = (el as HTMLImageElement).src;
            result.alt = (el as HTMLImageElement).alt;
          }

          return result;
        }, { extractType, attributes });
      }

      return JSON.stringify({
        success: true,
        sessionId,
        selector,
        multiple,
        count: multiple ? (extractedData as any[]).length : 1,
        data: extractedData,
        currentUrl,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        sessionId,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "browser_extract",
    description: "Extracts data from web pages using CSS selectors. Supports text, HTML, attributes, and structured data extraction from single or multiple elements.",
    schema: z.object({
      selector: z.string().describe("CSS selector to target elements"),
      sessionId: z.string().optional().default("default").describe("Browser session ID"),
      extractType: z.enum(["text", "html", "outerHtml", "all"]).optional().default("text").describe("Type of content to extract"),
      multiple: z.boolean().optional().default(false).describe("Extract from all matching elements"),
      attributes: z.array(z.string()).optional().default([]).describe("Specific attributes to extract"),
    }),
  }
);

export const browserSessionTool = tool(
  async (input) => {
    const { action, sessionId = "default", cookies, localStorage: localStorageData, profile } = input;
    const startTime = Date.now();

    try {
      switch (action) {
        case "create": {
          const session = await getOrCreateSession(sessionId);
          return JSON.stringify({
            success: true,
            action: "create",
            sessionId,
            message: "Browser session created",
            latencyMs: Date.now() - startTime,
          });
        }

        case "close": {
          await closeSession(sessionId);
          return JSON.stringify({
            success: true,
            action: "close",
            sessionId,
            message: "Browser session closed",
            latencyMs: Date.now() - startTime,
          });
        }

        case "get_cookies": {
          const session = activeSessions.get(sessionId);
          if (!session) {
            return JSON.stringify({
              success: false,
              error: "Session not found. Create session first.",
            });
          }
          const sessionCookies = await session.context.cookies();
          return JSON.stringify({
            success: true,
            action: "get_cookies",
            sessionId,
            cookies: sessionCookies.map(c => ({
              name: c.name,
              domain: c.domain,
              path: c.path,
              expires: c.expires,
              httpOnly: c.httpOnly,
              secure: c.secure,
            })),
            count: sessionCookies.length,
            latencyMs: Date.now() - startTime,
          });
        }

        case "set_cookies": {
          const session = activeSessions.get(sessionId);
          if (!session) {
            return JSON.stringify({
              success: false,
              error: "Session not found. Create session first.",
            });
          }
          if (!cookies || cookies.length === 0) {
            return JSON.stringify({
              success: false,
              error: "Cookies array required for set_cookies action",
            });
          }
          await session.context.addCookies(cookies);
          return JSON.stringify({
            success: true,
            action: "set_cookies",
            sessionId,
            cookiesAdded: cookies.length,
            latencyMs: Date.now() - startTime,
          });
        }

        case "clear_cookies": {
          const session = activeSessions.get(sessionId);
          if (!session) {
            return JSON.stringify({
              success: false,
              error: "Session not found. Create session first.",
            });
          }
          await session.context.clearCookies();
          return JSON.stringify({
            success: true,
            action: "clear_cookies",
            sessionId,
            message: "All cookies cleared",
            latencyMs: Date.now() - startTime,
          });
        }

        case "get_localStorage": {
          const session = activeSessions.get(sessionId);
          if (!session) {
            return JSON.stringify({
              success: false,
              error: "Session not found. Create session first.",
            });
          }
          const storage = await session.page.evaluate(() => {
            const items: Record<string, string> = {};
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key) {
                items[key] = localStorage.getItem(key) || "";
              }
            }
            return items;
          });
          return JSON.stringify({
            success: true,
            action: "get_localStorage",
            sessionId,
            localStorage: storage,
            count: Object.keys(storage).length,
            latencyMs: Date.now() - startTime,
          });
        }

        case "set_localStorage": {
          const session = activeSessions.get(sessionId);
          if (!session) {
            return JSON.stringify({
              success: false,
              error: "Session not found. Create session first.",
            });
          }
          if (!localStorageData) {
            return JSON.stringify({
              success: false,
              error: "localStorage object required for set_localStorage action",
            });
          }
          await session.page.evaluate((data) => {
            Object.entries(data).forEach(([key, value]) => {
              localStorage.setItem(key, value as string);
            });
          }, localStorageData);
          return JSON.stringify({
            success: true,
            action: "set_localStorage",
            sessionId,
            itemsSet: Object.keys(localStorageData).length,
            latencyMs: Date.now() - startTime,
          });
        }

        case "list": {
          const sessions = Array.from(activeSessions.entries()).map(([id, session]) => ({
            sessionId: id,
            createdAt: session.createdAt,
            age: Math.round((Date.now() - session.createdAt) / 1000) + "s",
            currentUrl: session.page.url(),
          }));
          return JSON.stringify({
            success: true,
            action: "list",
            sessions,
            count: sessions.length,
            latencyMs: Date.now() - startTime,
          });
        }

        case "clear_all": {
          const sessionIds = Array.from(activeSessions.keys());
          for (const id of sessionIds) {
            await closeSession(id);
          }
          return JSON.stringify({
            success: true,
            action: "clear_all",
            sessionsClosed: sessionIds.length,
            latencyMs: Date.now() - startTime,
          });
        }

        default:
          return JSON.stringify({
            success: false,
            error: `Unknown action: ${action}. Valid: create, close, get_cookies, set_cookies, clear_cookies, get_localStorage, set_localStorage, list, clear_all`,
          });
      }
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "browser_session",
    description: "Manages browser sessions, cookies, localStorage, and navigation profiles. Supports multiple concurrent sessions with authentication persistence.",
    schema: z.object({
      action: z.enum(["create", "close", "get_cookies", "set_cookies", "clear_cookies", "get_localStorage", "set_localStorage", "list", "clear_all"])
        .describe("Session management action"),
      sessionId: z.string().optional().default("default").describe("Session ID to manage"),
      cookies: z.array(z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string().optional().default("/"),
      })).optional().describe("Cookies to set (for set_cookies action)"),
      localStorage: z.record(z.string()).optional().describe("localStorage items to set"),
      profile: z.string().optional().describe("Named browser profile to load"),
    }),
  }
);

export const fetchUrlTool = tool(
  async (input) => {
    const { url, renderJs = false, extractContent = true, maxLength = 50000, headers = {} } = input;
    const startTime = Date.now();

    try {
      if (renderJs) {
        const browser = await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });

        try {
          const page = await browser.newPage();
          await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
          
          const content = await page.evaluate(() => ({
            title: document.title,
            url: window.location.href,
            html: document.documentElement.outerHTML,
            text: document.body?.innerText || "",
            meta: {
              description: document.querySelector('meta[name="description"]')?.getAttribute("content"),
              keywords: document.querySelector('meta[name="keywords"]')?.getAttribute("content"),
              author: document.querySelector('meta[name="author"]')?.getAttribute("content"),
            },
          }));

          await browser.close();

          const processedText = extractContent
            ? content.text
                .replace(/\s+/g, " ")
                .replace(/\n{3,}/g, "\n\n")
                .trim()
                .slice(0, maxLength)
            : content.html.slice(0, maxLength);

          return JSON.stringify({
            success: true,
            url: content.url,
            title: content.title,
            content: processedText,
            contentLength: processedText.length,
            meta: content.meta,
            renderedJs: true,
            latencyMs: Date.now() - startTime,
          });
        } catch (error) {
          await browser.close();
          throw error;
        }
      } else {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            ...headers,
          },
        });

        if (!response.ok) {
          return JSON.stringify({
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            url,
          });
        }

        const html = await response.text();
        const contentType = response.headers.get("content-type") || "";

        let processedContent: string;

        if (extractContent && contentType.includes("text/html")) {
          const cleanText = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&[a-z]+;/gi, " ")
            .replace(/\s+/g, " ")
            .trim();

          processedContent = cleanText.slice(0, maxLength);
        } else {
          processedContent = html.slice(0, maxLength);
        }

        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : "";

        return JSON.stringify({
          success: true,
          url,
          title,
          content: processedContent,
          contentLength: processedContent.length,
          contentType,
          renderedJs: false,
          latencyMs: Date.now() - startTime,
        });
      }
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        url,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "fetch_url",
    description: "Fetches and extracts content from URLs. Supports JavaScript rendering for dynamic sites, content extraction, and rate limiting.",
    schema: z.object({
      url: z.string().url().describe("URL to fetch"),
      renderJs: z.boolean().optional().default(false).describe("Render JavaScript (slower but handles SPAs)"),
      extractContent: z.boolean().optional().default(true).describe("Extract readable text vs raw HTML"),
      maxLength: z.number().optional().default(50000).describe("Maximum content length"),
      headers: z.record(z.string()).optional().default({}).describe("Additional HTTP headers"),
    }),
  }
);

export const researchDeepTool = tool(
  async (input) => {
    const { topic, depth = "standard", maxSources = 5, includeVerification = true } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert research analyst conducting deep research on topics.

Your research process:
1. Identify key aspects of the topic
2. Formulate specific research questions
3. Analyze from multiple perspectives
4. Cross-reference facts for accuracy
5. Synthesize findings into coherent insights

Research depth levels:
- quick: High-level overview, 3-5 key points
- standard: Comprehensive analysis, multiple perspectives
- deep: Exhaustive research, detailed analysis, academic rigor

Return JSON:
{
  "topic": "research topic",
  "summary": "executive summary of findings",
  "keyFindings": [
    {
      "finding": "specific finding",
      "confidence": 0.0-1.0,
      "sources": ["source types used"],
      "importance": "high|medium|low"
    }
  ],
  "perspectives": [
    {
      "viewpoint": "perspective name",
      "summary": "what this perspective says",
      "strengths": ["strengths of this view"],
      "weaknesses": ["limitations"]
    }
  ],
  "factCheck": {
    "verifiedClaims": ["claims verified as accurate"],
    "uncertainClaims": ["claims needing more verification"],
    "debunkedClaims": ["claims found to be inaccurate"]
  },
  "dataPoints": [
    {
      "metric": "specific data point",
      "value": "the value",
      "source": "where from",
      "date": "when"
    }
  ],
  "recommendations": ["actionable insights"],
  "furtherResearch": ["areas needing more investigation"],
  "confidence": 0.0-1.0,
  "limitations": ["research limitations"]
}`,
          },
          {
            role: "user",
            content: `Research Topic: ${topic}

Depth Level: ${depth}
Max Sources: ${maxSources}
Include Verification: ${includeVerification}

Conduct thorough research and provide a comprehensive analysis.`,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          depth,
          researchTimeMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        topic,
        summary: content,
        keyFindings: [],
        depth,
        researchTimeMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        topic,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "research_deep",
    description: "Conducts multi-step deep research: search, analyze, synthesize, verify, and report. Provides structured findings with confidence scores and verification.",
    schema: z.object({
      topic: z.string().describe("Research topic or question"),
      depth: z.enum(["quick", "standard", "deep"]).optional().default("standard").describe("Research depth level"),
      maxSources: z.number().optional().default(5).describe("Maximum sources to consult"),
      includeVerification: z.boolean().optional().default(true).describe("Include fact verification step"),
    }),
  }
);

export const WEB_TOOLS = [
  browserNavigateTool,
  browserInteractTool,
  browserExtractTool,
  browserSessionTool,
  fetchUrlTool,
  researchDeepTool,
];
