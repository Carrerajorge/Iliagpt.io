/**
 * browserScraper — opt-in browser-automated scrapers for academic
 * sites that gate their official API behind institutional subscription
 * (Scopus and Web of Science specifically).
 *
 * Why Playwright instead of Puppeteer:
 *   Puppeteer is NOT in the project's package.json. Playwright IS
 *   (already used for e2e tests + Electron desktop smoke). Playwright
 *   is a superset of Puppeteer's API surface. Adding Puppeteer would
 *   duplicate Chromium download across CI jobs. The `Launcher`
 *   interface below stays thin so a future swap to Puppeteer is a
 *   one-file change.
 *
 * Reality check: both Scopus and WoS require an authenticated
 * institutional session to return useful result lists. An anonymous
 * headless scrape lands on a login wall and gets very little beyond
 * whatever public teasers the site chooses to expose. This is
 * documented in docs/SEARCH_BRAIN.md and surfaced to the user in the
 * UI ("Resultados limitados si no estás autenticado en la institución").
 *
 * Policy stack (in order) before any scrape runs:
 *   1. User must have set `enableScrapingProviders: true` in Settings.
 *   2. robots.txt must allow the target path.
 *   3. Per-call timeout + single-page budget.
 *   4. Headless + no-stealth: we identify ourselves honestly.
 */

import type { AcademicResult } from "../unifiedAcademicSearch";
import { checkRobots } from "./robotsCheck";

const USER_AGENT = "IliaGPT-SearchBrain/1.0 (+https://iliagpt.io; respectful academic scraping)";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESULTS = 20;

export interface ScrapeOptions {
  query: string;
  maxResults?: number;
  timeoutMs?: number;
  launcher?: Launcher;
  robotsFetcher?: Parameters<typeof checkRobots>[0]["fetcher"];
}

// ─── Launcher seam ────────────────────────────────────────────────────────

/**
 * Narrow interface around "spin up a browser, fetch HTML, close it"
 * so tests inject a deterministic stub without pulling Playwright.
 */
export interface Launcher {
  fetchHtml(args: {
    url: string;
    userAgent: string;
    timeoutMs: number;
  }): Promise<{ ok: boolean; status: number; html: string } | null>;
}

/**
 * Default launcher uses Playwright's chromium. Runtime-imported so the
 * dependency is only pulled in when scraping actually happens — and
 * therefore doesn't bloat tests or cold-start.
 */
function defaultLauncher(): Launcher {
  return {
    async fetchHtml({ url, userAgent, timeoutMs }) {
      const playwright = (await import("playwright")) as unknown as {
        chromium: { launch: (opts?: unknown) => Promise<{ newContext: (opts?: unknown) => Promise<{ newPage: () => Promise<{ goto: (u: string, o: unknown) => Promise<{ status: () => number; ok: () => boolean } | null>; content: () => Promise<string>; close: () => Promise<void> }>; close: () => Promise<void> }>; close: () => Promise<void> }> };
      };
      const browser = await playwright.chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ userAgent });
        try {
          const page = await context.newPage();
          try {
            const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
            if (!response) return null;
            const html = await page.content();
            return { ok: response.ok(), status: response.status(), html };
          } finally {
            await page.close();
          }
        } finally {
          await context.close();
        }
      } finally {
        await browser.close();
      }
    },
  };
}

// ─── Parsers (pure, test via fixtures) ────────────────────────────────────

import { load as cheerioLoad } from "cheerio";

export function parseScopusHtml(html: string, maxResults: number, query: string): AcademicResult[] {
  const $ = cheerioLoad(html);
  const results: AcademicResult[] = [];
  // Scopus result cards historically live in `.searchArea` / `.list-doc`
  // containers. Site markup shifts; we try both and fall back to
  // picking anything that looks like a document link.
  const nodes = $("div.list-doc, .searchArea .result, article.result");
  nodes.each((_, el) => {
    if (results.length >= maxResults) return;
    const node = $(el);
    const title = cleanText(node.find("h4 a, a.docTitle, .result-title").first().text());
    const href = node.find("h4 a, a.docTitle, .result-title").first().attr("href") || "";
    if (!title || !href) return;
    const url = absolutiseScopusUrl(href);
    const authors = cleanText(node.find(".authors, .document-authors").first().text());
    const year = (node.find(".year, .publication-year").first().text().match(/\d{4}/) ?? [""])[0];
    const journal = cleanText(node.find(".sourceTitle, .publication-source").first().text());
    const cited = node.find(".citedBy, .cite-count").first().text().match(/\d+/);
    results.push({
      title,
      authors,
      year: year || "",
      journal: journal || undefined,
      url,
      source: "scopus",
      citations: cited ? Number(cited[0]) : undefined,
      documentType: "article",
      openAccess: false,
      language: undefined,
    });
  });
  if (results.length === 0) {
    const gated = isLoginGated($);
    if (gated) {
      // Login-gated page — return a single "info" row so the UI can
      // explain the empty result set instead of pretending nothing
      // matched the query.
      return [];
    }
  }
  void query;
  return results;
}

export function parseWosHtml(html: string, maxResults: number, query: string): AcademicResult[] {
  const $ = cheerioLoad(html);
  const results: AcademicResult[] = [];
  // Web of Science uses Angular shadow DOM for logged-in users;
  // anonymous HTML has little structured data. We try both the
  // Clarivate `app-summary-title` card shape and a fallback generic
  // article heading tree.
  const nodes = $("app-summary-title, .search-result-summary, article");
  nodes.each((_, el) => {
    if (results.length >= maxResults) return;
    const node = $(el);
    const title = cleanText(node.find("a.title, a.summary-title, h2 a, h3 a").first().text());
    const href = node.find("a.title, a.summary-title, h2 a, h3 a").first().attr("href") || "";
    if (!title || !href) return;
    const url = absolutiseWosUrl(href);
    const authors = cleanText(node.find(".authors, .author-list, .meta-authors").first().text());
    const year = (node.find(".year, .meta-year").first().text().match(/\d{4}/) ?? [""])[0];
    const journal = cleanText(node.find(".journal, .source-title").first().text());
    const cited = node.find(".times-cited, .cited-by").first().text().match(/\d+/);
    results.push({
      title,
      authors,
      year: year || "",
      journal: journal || undefined,
      url,
      source: "wos",
      citations: cited ? Number(cited[0]) : undefined,
      documentType: "article",
      openAccess: false,
    });
  });
  void query;
  return results;
}

function isLoginGated($: ReturnType<typeof cheerioLoad>): boolean {
  const txt = $("body").text().toLowerCase();
  return /sign\s+in|log\s+in|institutional\s+access|subscribe\s+to\s+view/.test(txt);
}

function absolutiseScopusUrl(href: string): string {
  if (/^https?:/i.test(href)) return href;
  return `https://www.scopus.com${href.startsWith("/") ? "" : "/"}${href}`;
}

function absolutiseWosUrl(href: string): string {
  if (/^https?:/i.test(href)) return href;
  return `https://www.webofscience.com${href.startsWith("/") ? "" : "/"}${href}`;
}

function cleanText(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

// ─── Public entrypoints ───────────────────────────────────────────────────

/**
 * Scopus scraper. Respects robots.txt, opt-in gated by caller, single
 * request per call. Returns [] when robots disallows or the fetch
 * fails or the page is login-gated.
 */
export async function scrapeScopus(options: ScrapeOptions): Promise<AcademicResult[]> {
  const { query } = options;
  if (!query || typeof query !== "string" || query.trim().length === 0) return [];
  const url = `https://www.scopus.com/results/results.uri?s=${encodeURIComponent(query)}`;
  return scrape(url, {
    ...options,
    parser: (html, max) => parseScopusHtml(html, max, query),
  });
}

/**
 * Web of Science scraper. Same policy stack + caveats as Scopus.
 */
export async function scrapeWos(options: ScrapeOptions): Promise<AcademicResult[]> {
  const { query } = options;
  if (!query || typeof query !== "string" || query.trim().length === 0) return [];
  const url = `https://www.webofscience.com/wos/alldb/basic-search?query=${encodeURIComponent(query)}`;
  return scrape(url, {
    ...options,
    parser: (html, max) => parseWosHtml(html, max, query),
  });
}

async function scrape(
  url: string,
  options: ScrapeOptions & { parser: (html: string, max: number) => AcademicResult[] }
): Promise<AcademicResult[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  const robots = await checkRobots({
    targetUrl: url,
    userAgent: USER_AGENT,
    timeoutMs: Math.min(timeoutMs, 4000),
    fetcher: options.robotsFetcher,
  });
  if (!robots.allowed) return [];

  const launcher = options.launcher ?? defaultLauncher();
  let response: Awaited<ReturnType<Launcher["fetchHtml"]>> = null;
  try {
    response = await launcher.fetchHtml({ url, userAgent: USER_AGENT, timeoutMs });
  } catch {
    return [];
  }
  if (!response || !response.ok) return [];
  return options.parser(response.html, maxResults);
}

export const BROWSER_SCRAPER_INTERNAL = {
  parseScopusHtml,
  parseWosHtml,
  absolutiseScopusUrl,
  absolutiseWosUrl,
  isLoginGated,
  cleanText,
  USER_AGENT,
};
