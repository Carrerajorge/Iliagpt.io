import { JSDOM } from "jsdom";
import https from "https";
import http from "http";
import { lookup } from "dns/promises";
import { createLogger } from "../../utils/logger";

const log = createLogger("openclaw-internet-access");

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
  if (BLOCKED_HOSTS.has(lower)) throw new Error(`Blocked host: ${hostname}`);
  if (BLOCKED_CIDRS.some((r) => r.test(lower))) throw new Error(`Blocked address: ${hostname}`);
  try {
    const { address } = await lookup(hostname);
    if (BLOCKED_CIDRS.some((r) => r.test(address))) throw new Error(`Blocked resolved address: ${address}`);
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
  engine: string;
  results: { title: string; url: string; snippet: string; verified?: boolean }[];
  fetchedAt: string;
  elapsedMs: number;
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 80_000;
const MAX_REDIRECTS = 8;

const tlsAgent = new https.Agent({ rejectUnauthorized: false });

const searchCache = new Map<string, { result: WebSearchResult; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedSearch(query: string): WebSearchResult | null {
  const key = query.toLowerCase().trim();
  const entry = searchCache.get(key);
  if (entry && entry.expiry > Date.now()) {
    log.debug(`Cache hit for "${query}"`);
    return entry.result;
  }
  if (entry) searchCache.delete(key);
  return null;
}

function setCachedSearch(query: string, result: WebSearchResult): void {
  const key = query.toLowerCase().trim();
  searchCache.set(key, { result, expiry: Date.now() + CACHE_TTL_MS });
  if (searchCache.size > 200) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }
}

export async function httpGet(
  url: string,
  redirectCount = 0,
  customHeaders?: Record<string, string>
): Promise<{ status: number; headers: Record<string, string>; body: string; finalUrl: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`Blocked protocol: ${parsed.protocol}`);
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
        "Accept-Encoding": "identity",
        ...(customHeaders || {}),
      },
      timeout: FETCH_TIMEOUT_MS,
      ...(isHttps ? { agent: tlsAgent } : {}),
    };

    const req = lib.request(reqOptions, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectCount < MAX_REDIRECTS) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        resolve(httpGet(next, redirectCount + 1, customHeaders));
        return;
      }
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      res.on("data", (c) => {
        totalBytes += c.length;
        if (totalBytes <= MAX_RESPONSE_BYTES) chunks.push(c);
        else req.destroy();
      });
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        const hdrs: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") hdrs[k] = v;
          else if (Array.isArray(v)) hdrs[k] = v.join(", ");
        }
        resolve({ status: res.statusCode || 0, headers: hdrs, body, finalUrl: url });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.on("error", reject);
    req.end();
  });
}

function httpPost(
  url: string,
  postData: string,
  customHeaders?: Record<string, string>
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
          Accept: "text/html",
          "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
          ...(customHeaders || {}),
        },
        timeout: FETCH_TIMEOUT_MS,
        ...(isHttps ? { agent: tlsAgent } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          const hdrs: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") hdrs[k] = v;
            else if (Array.isArray(v)) hdrs[k] = v.join(", ");
          }
          resolve({ status: res.statusCode || 0, headers: hdrs, body });
        });
        res.on("error", reject);
      }
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

function stripHtmlToText(html: string): string {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    for (const sel of ["script", "style", "noscript", "svg", "nav", "footer", "header", "aside"]) {
      doc.querySelectorAll(sel).forEach((el) => el.remove());
    }
    return (doc.body?.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_BODY_CHARS);
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
      if (href && text && href.startsWith("http")) links.push({ href, text: text.slice(0, 120) });
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
  return {
    url: res.finalUrl,
    status: res.status,
    contentType,
    title: isHtml ? extractTitle(res.body) : undefined,
    text: isHtml ? stripHtmlToText(res.body) : res.body.slice(0, MAX_BODY_CHARS),
    links: isHtml && options?.extractLinks ? extractLinks(res.body, res.finalUrl) : undefined,
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
  };
}

function parseDuckDuckGoResults(html: string): { title: string; url: string; snippet: string }[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const results: { title: string; url: string; snippet: string }[] = [];

  doc.querySelectorAll(".result").forEach((el) => {
    const anchor = el.querySelector(".result__a") as HTMLAnchorElement | null;
    const snippetEl = el.querySelector(".result__snippet");
    if (anchor) {
      const rawHref = anchor.getAttribute("href") || "";
      let finalUrl = rawHref;
      const uddgMatch = rawHref.match(/uddg=([^&]+)/);
      if (uddgMatch) finalUrl = decodeURIComponent(uddgMatch[1]);
      if (finalUrl.startsWith("http") && !finalUrl.includes("duckduckgo.com/y.js")) {
        results.push({
          title: (anchor.textContent || "").trim(),
          url: finalUrl,
          snippet: (snippetEl?.textContent || "").trim(),
        });
      }
    }
  });

  return results;
}

async function searchDuckDuckGoGet(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const encoded = encodeURIComponent(query);
  const res = await httpGet(`https://html.duckduckgo.com/html/?q=${encoded}`);
  return parseDuckDuckGoResults(res.body);
}

async function searchDuckDuckGoPost(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const res = await httpPost("https://html.duckduckgo.com/html/", `q=${encodeURIComponent(query)}&b=`);
  return parseDuckDuckGoResults(res.body);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchDuckDuckGo(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  let results = await searchDuckDuckGoGet(query);
  if (results.length > 0) return results.slice(0, 10);

  log.info("DDG GET returned 0, trying POST after 1s delay");
  await delay(1000);

  results = await searchDuckDuckGoPost(query);
  if (results.length > 0) return results.slice(0, 10);

  log.info("DDG POST also returned 0, trying alternate query after 1.5s delay");
  await delay(1500);

  const altQuery = query.length > 20 ? query.split(" ").slice(0, 4).join(" ") : query + " official site";
  results = await searchDuckDuckGoGet(altQuery);
  return results.slice(0, 10);
}

const PUBLIC_SEARXNG_INSTANCES = [
  "https://searx.be",
  "https://search.hbubli.cc",
  "https://baresearch.org",
  "https://searx.tiekoetter.com",
  "https://priv.au",
];

async function searchSearxngPublic(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const encoded = encodeURIComponent(query);
  for (const instance of PUBLIC_SEARXNG_INSTANCES) {
    try {
      const res = await httpGet(`${instance}/search?q=${encoded}&format=json&language=auto`);
      if (res.status !== 200) continue;
      const data = JSON.parse(res.body);
      const results = (data.results || []).map((r: any) => ({
        title: String(r.title || "").trim(),
        url: String(r.url || "").trim(),
        snippet: String(r.content || "").trim(),
      })).filter((r: any) => r.url && r.title);
      if (results.length > 0) return results.slice(0, 10);
    } catch {}
  }
  return [];
}

async function searchBrave(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const res = await httpGet(`https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`);
    const dom = new JSDOM(res.body);
    const doc = dom.window.document;
    const results: { title: string; url: string; snippet: string }[] = [];
    doc.querySelectorAll('[data-type="web"]').forEach((el) => {
      const a = el.querySelector("a[href^='http']") as HTMLAnchorElement | null;
      const titleEl = el.querySelector(".title, .snippet-title");
      const snippetEl = el.querySelector(".snippet-description, .snippet-content");
      if (a?.href) {
        results.push({
          title: (titleEl?.textContent || a.textContent || "").trim(),
          url: a.href,
          snippet: (snippetEl?.textContent || "").trim(),
        });
      }
    });
    return results.slice(0, 10);
  } catch {
    return [];
  }
}

async function searchStartpage(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const res = await httpGet(`https://www.startpage.com/do/search?q=${encodeURIComponent(query)}`);
    const dom = new JSDOM(res.body);
    const results: { title: string; url: string; snippet: string }[] = [];
    dom.window.document.querySelectorAll(".w-gl__result").forEach((el) => {
      const a = el.querySelector("a.w-gl__result-url, a.result-link") as HTMLAnchorElement | null;
      const titleEl = el.querySelector(".w-gl__result-title, h3");
      const snippetEl = el.querySelector(".w-gl__description, p");
      if (a?.href) {
        results.push({
          title: (titleEl?.textContent || "").trim(),
          url: a.href,
          snippet: (snippetEl?.textContent || "").trim(),
        });
      }
    });
    return results.slice(0, 10);
  } catch {
    return [];
  }
}

async function searchArxiv(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const res = await httpGet(`http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=5`);
    const results: { title: string; url: string; snippet: string }[] = [];
    const entries = res.body.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    for (const e of entries) {
      const title = (e.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "").replace(/\s+/g, " ").trim();
      const url = e.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || "";
      const summary = (e.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] || "").replace(/\s+/g, " ").trim();
      if (url && title) results.push({ title: `${title} (arXiv)`, url, snippet: summary.slice(0, 300) });
    }
    return results;
  } catch {
    return [];
  }
}

async function searchStackExchange(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    const res = await httpGet(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=5`);
    const data = JSON.parse(res.body);
    return (data.items || []).map((it: any) => ({
      title: `${it.title} (Stack Overflow)`,
      url: it.link,
      snippet: `Score ${it.score} · ${it.answer_count} answers · ${it.is_answered ? "answered" : "open"}`,
    }));
  } catch {
    return [];
  }
}

async function searchWikipedia(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const encoded = encodeURIComponent(query);
  const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&format=json&srlimit=5&utf8=1`;
  const res = await httpGet(apiUrl);
  try {
    const data = JSON.parse(res.body);
    return (data.query?.search || []).map((item: any) => ({
      title: item.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
      snippet: (item.snippet || "").replace(/<[^>]*>/g, "").trim(),
    }));
  } catch {
    return [];
  }
}

async function searchWikipediaES(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const encoded = encodeURIComponent(query);
  const apiUrl = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&format=json&srlimit=5&utf8=1`;
  const res = await httpGet(apiUrl);
  try {
    const data = JSON.parse(res.body);
    return (data.query?.search || []).map((item: any) => ({
      title: item.title + " (Wikipedia ES)",
      url: `https://es.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
      snippet: (item.snippet || "").replace(/<[^>]*>/g, "").trim(),
    }));
  } catch {
    return [];
  }
}

async function verifyUrl(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname || parsed.hostname.length < 3) return false;
    if (!parsed.hostname.includes(".")) return false;
    await validateTarget(parsed.hostname);

    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    return new Promise<boolean>((resolve) => {
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: "HEAD",
          headers: { "User-Agent": USER_AGENT },
          timeout: 5000,
          ...(isHttps ? { agent: tlsAgent } : {}),
        },
        (res) => {
          res.resume();
          const status = res.statusCode || 0;
          resolve(status > 0 && status < 500);
        }
      );
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.on("error", () => resolve(false));
      req.end();
    });
  } catch {
    return false;
  }
}

const WELL_KNOWN_DOMAINS = new Set([
  "google.com", "youtube.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
  "linkedin.com", "reddit.com", "wikipedia.org", "amazon.com", "amazon.es", "amazon.com.mx",
  "netflix.com", "spotify.com", "apple.com", "microsoft.com", "github.com", "stackoverflow.com",
  "tiktok.com", "whatsapp.com", "telegram.org", "discord.com", "twitch.tv", "pinterest.com",
  "tumblr.com", "flickr.com", "medium.com", "wordpress.com", "blogger.com", "bbc.com",
  "cnn.com", "nytimes.com", "washingtonpost.com", "theguardian.com", "reuters.com",
  "forbes.com", "bloomberg.com", "wsj.com", "espn.com", "imdb.com", "rottentomatoes.com",
  "yelp.com", "tripadvisor.com", "booking.com", "airbnb.com", "uber.com", "paypal.com",
  "stripe.com", "shopify.com", "ebay.com", "walmart.com", "target.com", "bestbuy.com",
  "adobe.com", "zoom.us", "slack.com", "notion.so", "figma.com", "canva.com",
  "dropbox.com", "drive.google.com", "docs.google.com", "maps.google.com",
  "play.google.com", "apps.apple.com", "store.steampowered.com",
  "cnnespanol.cnn.com", "telemundo.com", "univision.com", "excelsior.com.mx",
  "elimparcial.com", "larepublica.pe", "tn.com.ar", "bbc.co.uk",
  "rt.com", "actualidad.rt.com", "news.google.com", "help.netflix.com",
  "open.spotify.com", "accounts.spotify.com", "qr.netflix.com",
  "about.instagram.com", "meta.com", "support.google.com",
]);

function isWellKnownDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const domain of WELL_KNOWN_DOMAINS) {
      if (hostname === domain || hostname.endsWith("." + domain)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function smartVerifyUrl(url: string): Promise<boolean> {
  if (isWellKnownDomain(url)) return true;
  return verifyUrl(url);
}

export async function webSearch(query: string): Promise<WebSearchResult> {
  const cached = getCachedSearch(query);
  if (cached) return cached;

  const start = Date.now();

  const { FREE_DATABASES } = await import("./freeDatabases");
  const engines: { name: string; run: () => Promise<{ title: string; url: string; snippet: string }[]> }[] = [
    { name: "duckduckgo", run: () => searchDuckDuckGo(query) },
    { name: "searxng", run: () => searchSearxngPublic(query) },
    { name: "brave", run: () => searchBrave(query) },
    { name: "startpage", run: () => searchStartpage(query) },
    { name: "wikipedia-en", run: () => searchWikipedia(query) },
    { name: "wikipedia-es", run: () => searchWikipediaES(query) },
    { name: "stackexchange", run: () => searchStackExchange(query) },
    { name: "arxiv", run: () => searchArxiv(query) },
    ...FREE_DATABASES.map((db) => ({ name: db.name, run: () => db.run(query) })),
  ];

  const settled = await Promise.allSettled(engines.map((e) => e.run().then((r) => ({ name: e.name, r }))));
  const successful: string[] = [];
  const seen = new Map<string, { title: string; url: string; snippet: string; sources: Set<string> }>();
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    successful.push(s.value.name);
    log.info(`${s.value.name} returned ${s.value.r.length} results for "${query}"`);
    for (const item of s.value.r) {
      const key = item.url.replace(/[#?].*$/, "").replace(/\/$/, "");
      const existing = seen.get(key);
      if (existing) existing.sources.add(s.value.name);
      else seen.set(key, { ...item, sources: new Set([s.value.name]) });
    }
  }

  const results = Array.from(seen.values())
    .sort((a, b) => b.sources.size - a.sources.size)
    .map(({ sources, ...rest }) => rest);
  const engine = successful.join("+") || "none";

  const verified = await Promise.all(
    results.slice(0, 15).map(async (r) => ({
      ...r,
      verified: await smartVerifyUrl(r.url),
    }))
  );

  const validResults = verified.filter((r) => r.verified);

  const searchResult: WebSearchResult = {
    query,
    engine,
    results: validResults,
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - start,
  };

  if (validResults.length > 0) setCachedSearch(query, searchResult);

  return searchResult;
}

export async function webSearchAndFetch(query: string, maxPages: number = 2): Promise<{
  search: WebSearchResult;
  pages: WebFetchResult[];
}> {
  const search = await webSearch(query);
  const topUrls = search.results
    .filter((r) => r.verified !== false)
    .slice(0, maxPages)
    .map((r) => r.url);

  const pages: WebFetchResult[] = [];
  if (topUrls.length > 0) {
    const fetchResults = await Promise.allSettled(topUrls.map((url) => webFetch(url)));
    for (const r of fetchResults) {
      if (r.status === "fulfilled" && r.value.status >= 200 && r.value.status < 400) {
        pages.push(r.value);
      }
    }
  }
  return { search, pages };
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
    description: "Search the web using DuckDuckGo + Wikipedia with caching and retry logic",
    parameters: {
      type: "object" as const,
      properties: { query: { type: "string", description: "Search query" } },
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
      case "openclaw.web.fetch":
        return { ok: true, result: await webFetch(params.url, { extractLinks: params.extractLinks }) };
      case "openclaw.web.search":
        return { ok: true, result: await webSearch(params.query) };
      default:
        return { ok: false, error: `Unknown internet tool: ${toolId}` };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
