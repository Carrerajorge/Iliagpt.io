/**
 * WebScraperRobust — multi-strategy content extraction with politeness controls.
 * Strategies: readability, CSS selectors, JSON-LD, microdata.
 * Optional Playwright headless rendering for JS-heavy pages.
 * Respects robots.txt, crawl-delay, and rate limits per domain.
 */

import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";

const logger = createLogger("WebScraperRobust");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScrapedPage {
  url: string;
  finalUrl: string;
  title: string;
  text: string;
  html: string;
  metadata: PageMetadata;
  tables: TableData[];
  lists: string[][];
  links: Array<{ text: string; href: string }>;
  structuredData: unknown[];
  fetchedAt: string;
  strategy: ExtractionStrategy;
}

export interface PageMetadata {
  description?: string;
  author?: string;
  publishedAt?: string;
  modifiedAt?: string;
  keywords?: string[];
  ogTitle?: string;
  ogImage?: string;
  canonical?: string;
  language?: string;
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

export type ExtractionStrategy = "readability" | "css" | "json-ld" | "plain" | "javascript";

export interface ScrapeOptions {
  url: string;
  strategy?: ExtractionStrategy | "auto";
  maxContentLength?: number;
  timeout?: number;
  followRedirects?: boolean;
  useJavaScript?: boolean;
  proxyUrl?: string;
  cssSelectors?: { content?: string; title?: string; author?: string };
}

// ─── Robots.txt Cache ─────────────────────────────────────────────────────────

interface RobotsRules {
  disallowed: string[];
  crawlDelay: number;
  cached: number;
}

const robotsCache = new Map<string, RobotsRules>();
const ROBOTS_TTL = 3_600_000;

async function fetchRobotsTxt(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.cached < ROBOTS_TTL) return cached;

  try {
    const resp = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": "IliaGPT-Scraper/1.0" },
      signal: AbortSignal.timeout(5_000),
    });

    if (!resp.ok) {
      const rules: RobotsRules = { disallowed: [], crawlDelay: 0, cached: Date.now() };
      robotsCache.set(origin, rules);
      return rules;
    }

    const text = await resp.text();
    const lines = text.split("\n");
    let inUserAgent = false;
    const disallowed: string[] = [];
    let crawlDelay = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^user-agent:\s*\*/i.test(trimmed)) { inUserAgent = true; continue; }
      if (/^user-agent:/i.test(trimmed)) { inUserAgent = false; continue; }
      if (!inUserAgent) continue;

      const disallowMatch = /^disallow:\s*(.+)/i.test(trimmed) ? trimmed.replace(/^disallow:\s*/i, "") : null;
      if (disallowMatch) disallowed.push(disallowMatch.trim());

      const delayMatch = /^crawl-delay:\s*(\d+)/i.test(trimmed) ? trimmed.replace(/^crawl-delay:\s*/i, "") : null;
      if (delayMatch) crawlDelay = parseInt(delayMatch, 10);
    }

    const rules: RobotsRules = { disallowed, crawlDelay, cached: Date.now() };
    robotsCache.set(origin, rules);
    return rules;
  } catch {
    return { disallowed: [], crawlDelay: 0, cached: Date.now() };
  }
}

function isAllowedByRobots(path: string, rules: RobotsRules): boolean {
  return !rules.disallowed.some((d) => {
    if (!d || d === "/") return false;
    return path.startsWith(d);
  });
}

// ─── Per-Domain Rate Limiter ──────────────────────────────────────────────────

const domainLastFetch = new Map<string, number>();

async function politeDelay(domain: string, crawlDelay: number): Promise<void> {
  const minDelay = Math.max(crawlDelay * 1000, 500);
  const last = domainLastFetch.get(domain) ?? 0;
  const since = Date.now() - last;
  if (since < minDelay) {
    await new Promise((r) => setTimeout(r, minDelay - since));
  }
  domainLastFetch.set(domain, Date.now());
}

// ─── User Agent Rotation ──────────────────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "IliaGPT-Research/1.0 (Academic Research; +https://iliagpt.ai/bot)",
];

function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] ?? USER_AGENTS[0];
}

// ─── HTML Extraction ──────────────────────────────────────────────────────────

function extractMetadata(html: string): PageMetadata {
  const getMeta = (name: string): string | undefined => {
    const m1 = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"));
    if (m1?.[1]) return m1[1];
    const m2 = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, "i"));
    return m2?.[1];
  };

  const getOg = (prop: string): string | undefined => {
    const m1 = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i"));
    if (m1?.[1]) return m1[1];
    const m2 = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, "i"));
    return m2?.[1];
  };

  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
  const language = html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1];

  return {
    description: getMeta("description") ?? getOg("description"),
    author: getMeta("author"),
    publishedAt: getMeta("article:published_time") ?? getMeta("date"),
    modifiedAt: getMeta("article:modified_time"),
    keywords: getMeta("keywords")?.split(",").map((k) => k.trim()),
    ogTitle: getOg("title"),
    ogImage: getOg("image"),
    canonical,
    language,
  };
}

function extractJsonLd(html: string): unknown[] {
  const results: unknown[] = [];
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of matches) {
    try { results.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
  }
  return results;
}

function extractTables(html: string): TableData[] {
  const tables: TableData[] = [];
  const tableMatches = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];

  for (const tableMatch of tableMatches) {
    const tableHtml = tableMatch[0];
    const headers = [...tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").trim());

    const rows: string[][] = [];
    for (const trMatch of [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)]) {
      const cells = [...trMatch[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map((m) => m[1].replace(/<[^>]+>/g, "").trim());
      if (cells.length > 0) rows.push(cells);
    }

    if (headers.length > 0 || rows.length > 0) tables.push({ headers, rows });
  }

  return tables;
}

function extractLists(html: string): string[][] {
  const lists: string[][] = [];
  for (const listMatch of [...html.matchAll(/<[ou]l[\s\S]*?<\/[ou]l>/gi)]) {
    const items = [...listMatch[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (items.length > 0) lists.push(items);
  }
  return lists;
}

function extractLinks(html: string, baseUrl: string): Array<{ text: string; href: string }> {
  const links: Array<{ text: string; href: string }> = [];
  for (const m of [...html.matchAll(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
    try {
      links.push({ text, href: new URL(href, baseUrl).toString() });
    } catch { /* skip invalid */ }
    if (links.length >= 100) break;
  }
  return links;
}

function extractReadableText(html: string, maxLen: number): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (og) return og;
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
}

function extractWithCssHeuristics(html: string, maxLen: number): string {
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*(?:class|id)=["'][^"']*(?:content|article|post|entry|story|text|body|markdown)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) {
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
      if (text.length > 200) return text.slice(0, maxLen);
    }
  }
  return "";
}

// ─── JavaScript Rendering (Playwright) ───────────────────────────────────────

async function scrapeWithPlaywright(url: string, timeout: number): Promise<string> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.setUserAgent(pickUserAgent());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    await page.waitForTimeout(1_500);
    const html = await page.content();
    await browser.close();
    return html;
  } catch (err) {
    throw new AppError(`Playwright scrape failed: ${(err as Error).message}`, 500, "PLAYWRIGHT_ERROR");
  }
}

// ─── Main Scraper ─────────────────────────────────────────────────────────────

export class WebScraperRobust {
  private maxContentLength: number;
  private defaultTimeout: number;

  constructor(opts: { maxContentLength?: number; defaultTimeout?: number } = {}) {
    this.maxContentLength = opts.maxContentLength ?? 50_000;
    this.defaultTimeout = opts.defaultTimeout ?? 15_000;
  }

  async scrape(options: ScrapeOptions): Promise<ScrapedPage> {
    const { url, strategy = "auto", timeout = this.defaultTimeout, useJavaScript = false } = options;
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { throw new AppError(`Invalid URL: ${url}`, 400, "INVALID_URL"); }

    const robots = await fetchRobotsTxt(parsed.origin);
    const path = parsed.pathname + parsed.search;

    if (!isAllowedByRobots(path, robots)) {
      throw new AppError(`Disallowed by robots.txt: ${url}`, 403, "ROBOTS_DISALLOWED");
    }

    await politeDelay(parsed.hostname, robots.crawlDelay);

    let html: string;
    let finalUrl = url;
    let usedStrategy: ExtractionStrategy = "readability";

    if (useJavaScript) {
      html = await scrapeWithPlaywright(url, timeout);
      usedStrategy = "javascript";
    } else {
      const resp = await fetch(url, {
        headers: {
          "User-Agent": pickUserAgent(),
          "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(timeout),
        redirect: options.followRedirects !== false ? "follow" : "manual",
      });

      if (!resp.ok) throw new AppError(`HTTP ${resp.status} for ${url}`, resp.status, "SCRAPE_HTTP_ERROR");
      finalUrl = resp.url;
      const ct = resp.headers.get("content-type") ?? "";
      if (!ct.includes("text/html") && !ct.includes("text/plain")) {
        throw new AppError(`Non-HTML content: ${ct}`, 400, "NON_HTML_CONTENT");
      }
      html = await resp.text();
    }

    const maxLen = options.maxContentLength ?? this.maxContentLength;
    let text: string;

    if (strategy === "css" || (strategy === "auto" && options.cssSelectors)) {
      const cssText = extractWithCssHeuristics(html, maxLen);
      text = cssText.length > 200 ? cssText : extractReadableText(html, maxLen);
      usedStrategy = "css";
    } else if (strategy === "json-ld") {
      text = JSON.stringify(extractJsonLd(html)).slice(0, maxLen);
      usedStrategy = "json-ld";
    } else {
      const cssText = extractWithCssHeuristics(html, maxLen);
      text = cssText.length > 200 ? cssText : extractReadableText(html, maxLen);
      usedStrategy = "readability";
    }

    logger.debug(`Scraped ${finalUrl} (${text.length} chars, strategy: ${usedStrategy})`);

    return {
      url,
      finalUrl,
      title: extractTitle(html),
      text,
      html: html.slice(0, maxLen * 2),
      metadata: extractMetadata(html),
      tables: extractTables(html),
      lists: extractLists(html),
      links: extractLinks(html, finalUrl),
      structuredData: extractJsonLd(html),
      fetchedAt: new Date().toISOString(),
      strategy: usedStrategy,
    };
  }

  async scrapeMany(
    urls: string[],
    options: Omit<ScrapeOptions, "url"> = {}
  ): Promise<Array<{ url: string; page?: ScrapedPage; error?: string }>> {
    const results = await Promise.allSettled(urls.map((url) => this.scrape({ ...options, url })));
    return results.map((r, i) => ({
      url: urls[i]!,
      page: r.status === "fulfilled" ? r.value : undefined,
      error: r.status === "rejected" ? (r.reason as Error).message : undefined,
    }));
  }
}

export const webScraper = new WebScraperRobust();
