import { JSDOM } from "jsdom";
import https from "https";
import http from "http";
import { lookup } from "dns/promises";

const BLOCKED_CIDRS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^fd/i,
];

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "169.254.169.254"]);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function validateTarget(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(lower)) {
    throw new Error(`Blocked host: ${hostname}`);
  }
  if (BLOCKED_CIDRS.some((r) => r.test(lower))) {
    throw new Error(`Blocked address: ${hostname}`);
  }
  try {
    const { address } = await lookup(hostname);
    if (BLOCKED_CIDRS.some((r) => r.test(address))) {
      throw new Error(`Blocked resolved address: ${address}`);
    }
  } catch (e: any) {
    if (e.message?.startsWith("Blocked")) throw e;
  }
}

export interface WebFetchResult {
  url: string;
  status: number;
  contentType: string;
  title?: string;
  text: string;
  links?: { href: string; text: string }[];
  fetchedAt: string;
  elapsedMs: number;
}

export interface WebSearchResult {
  query: string;
  results: { title: string; url: string; snippet: string }[];
  fetchedAt: string;
  elapsedMs: number;
}

const USER_AGENT = "OpenClaw/2026.4.5 IliaGPT (+https://iliagpt.replit.app)";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 80_000;
const MAX_REDIRECTS = 5;

const tlsAgent = new https.Agent({ rejectUnauthorized: false });

async function httpGet(
  url: string,
  redirectCount = 0
): Promise<{ status: number; headers: Record<string, string>; body: string; finalUrl: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  }
  await validateTarget(parsed.hostname);

  return new Promise((resolve, reject) => {
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
      },
      timeout: FETCH_TIMEOUT_MS,
      ...(isHttps ? { agent: tlsAgent } : {}),
    };

    const req = lib.request(reqOptions, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location &&
        redirectCount < MAX_REDIRECTS
      ) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        resolve(httpGet(next, redirectCount + 1));
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      res.on("data", (c) => {
        totalBytes += c.length;
        if (totalBytes <= MAX_RESPONSE_BYTES) {
          chunks.push(c);
        } else {
          req.destroy();
        }
      });
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        const hdrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") hdrs[k] = v;
          else if (Array.isArray(v)) hdrs[k] = v.join(", ");
        }
        resolve({
          status: res.statusCode || 0,
          headers: hdrs,
          body,
          finalUrl: url,
        });
      });
      res.on("error", reject);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

function stripHtmlToText(html: string): string {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    for (const sel of ["script", "style", "noscript", "svg", "nav", "footer", "header"]) {
      doc.querySelectorAll(sel).forEach((el) => el.remove());
    }
    const text = (doc.body?.textContent || "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text.slice(0, MAX_BODY_CHARS);
  } catch {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_BODY_CHARS);
  }
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : undefined;
}

function extractLinks(html: string, baseUrl: string): { href: string; text: string }[] {
  try {
    const dom = new JSDOM(html, { url: baseUrl });
    const anchors = dom.window.document.querySelectorAll("a[href]");
    const links: { href: string; text: string }[] = [];
    anchors.forEach((a) => {
      const href = (a as any).href;
      const text = (a.textContent || "").trim();
      if (href && text && href.startsWith("http")) {
        links.push({ href, text: text.slice(0, 120) });
      }
    });
    return links.slice(0, 50);
  } catch {
    return [];
  }
}

export async function webFetch(url: string, options?: { extractLinks?: boolean }): Promise<WebFetchResult> {
  const start = Date.now();

  const res = await httpGet(url);
  const contentType = res.headers["content-type"] || "unknown";
  const isHtml = contentType.includes("html");
  const text = isHtml ? stripHtmlToText(res.body) : res.body.slice(0, MAX_BODY_CHARS);
  const title = isHtml ? extractTitle(res.body) : undefined;
  const links = isHtml && options?.extractLinks ? extractLinks(res.body, res.finalUrl) : undefined;

  return {
    url: res.finalUrl,
    status: res.status,
    contentType,
    title,
    text,
    links,
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
  };
}

export async function webSearch(query: string): Promise<WebSearchResult> {
  const start = Date.now();
  const encoded = encodeURIComponent(query);
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;

  const res = await httpGet(ddgUrl);
  const dom = new JSDOM(res.body);
  const doc = dom.window.document;
  const results: { title: string; url: string; snippet: string }[] = [];

  doc.querySelectorAll(".result").forEach((el) => {
    const anchor = el.querySelector(".result__a") as HTMLAnchorElement | null;
    const snippetEl = el.querySelector(".result__snippet");
    if (anchor) {
      const rawHref = anchor.getAttribute("href") || "";
      let finalUrl = rawHref;
      const uddgMatch = rawHref.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        finalUrl = decodeURIComponent(uddgMatch[1]);
      }
      results.push({
        title: (anchor.textContent || "").trim(),
        url: finalUrl,
        snippet: (snippetEl?.textContent || "").trim(),
      });
    }
  });

  return {
    query,
    results: results.slice(0, 10),
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
  };
}

export const internetToolDefinitions = [
  {
    id: "openclaw.web.fetch",
    name: "Web Fetch",
    description: "Fetch and parse a web page, extracting clean text content from any URL",
    parameters: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        extractLinks: { type: "boolean", description: "Whether to extract links from the page" },
      },
      required: ["url"],
    },
  },
  {
    id: "openclaw.web.search",
    name: "Web Search",
    description: "Search the web using DuckDuckGo and return structured results",
    parameters: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
  },
];

export async function executeInternetTool(
  toolId: string,
  params: Record<string, any>
): Promise<{ ok: boolean; result?: any; error?: string }> {
  try {
    switch (toolId) {
      case "openclaw.web.fetch": {
        const result = await webFetch(params.url, { extractLinks: params.extractLinks });
        return { ok: true, result };
      }
      case "openclaw.web.search": {
        const result = await webSearch(params.query);
        return { ok: true, result };
      }
      default:
        return { ok: false, error: `Unknown internet tool: ${toolId}` };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
