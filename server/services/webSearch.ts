import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { HTTP_HEADERS, TIMEOUTS, LIMITS } from "../lib/constants";
import { Logger } from "../lib/logger";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  authors?: string;
  year?: string;
  citation?: string;
  imageUrl?: string;
  siteName?: string;
  publishedDate?: string;
  canonicalUrl?: string;
}

export interface WebSearchResponse {
  query: string;
  results: SearchResult[];
  contents: { url: string; title: string; content: string; imageUrl?: string; siteName?: string; publishedDate?: string }[];
}

interface SearchCacheEntry {
  expiresAt: number;
  response: WebSearchResponse;
}

const ACADEMIC_PATTERNS = [
  // Citation requests
  /dame.*cita/i,
  /cita.*(apa|mla|chicago|harvard|ieee|vancouver)/i,
  /formato\s*(apa|mla|chicago|harvard|ieee|vancouver)/i,
  /apa\s*7/i,
  /normas?\s*apa/i,
  /estilo\s*(apa|mla)/i,
  /referencia.*bibliogr[áa]fica/i,
  
  // Scientific articles - Spanish
  /art[ií]culo.*cient[ií]fico/i,
  /art[ií]culos?\s+cient[ií]ficos?/i,
  /investigaci[óo]n\s+(sobre|de|del)/i,
  /estudio.*cient[ií]fico/i,
  /publicaci[óo]n\s+acad[ée]mica/i,
  /paper\s+(sobre|de|del)/i,
  /tesis\s+(sobre|de|del)/i,
  /revista.*cient[ií]fica/i,
  
  // "buscame X articulos cientificos"
  /buscame\s+\d+\s+art[ií]culos?/i,
  /buscarme\s+\d+\s+art[ií]culos?/i,
  /busca\s+\d+\s+art[ií]culos?/i,
  /dame\s+\d+\s+art[ií]culos?/i,
  /necesito\s+\d+\s+art[ií]culos?/i,
  /encontrar\s+\d+\s+art[ií]culos?/i,
  
  // "articulos de/sobre"
  /art[ií]culos?\s+(de|sobre|del)\s+/i,
  /busca.*art[ií]culo.*cient[ií]fico/i,
  /buscame.*art[ií]culo/i,
  
  // Academic sources
  /scholar/i,
  /scopus/i,
  /scielo/i,
  /pubmed/i,
  /web\s*of\s*science/i,
  
  // English patterns
  /academic\s+(article|paper|research)/i,
  /scientific\s+(article|paper|study)/i,
  /peer[\s-]?review/i,
  /bibliography/i,
  /citation\s+(in|for|style)/i,
  /research\s+paper/i,
  
  // Additional Spanish patterns
  /necesito.*cita/i,
  /quiero.*cita/i,
  /papers?\s+acad[ée]micos?/i,
  /estudios?\s+acad[ée]micos?/i,
];

const WEB_SEARCH_PATTERNS = [
  /qu[eé]\s+es\s+/i,
  /qui[eé]n\s+es\s+/i,
  /cu[aá]ndo\s+/i,
  /d[oó]nde\s+/i,
  /c[oó]mo\s+\w+\s+(funciona|trabaja|opera|works)/i,
  /dame\s+\d*\s*(noticias|artículos?)/i,
  /noticias\s+(sobre|de)/i,
  /[uú]ltimas?\s+noticias/i,
  /quisiera\s+(que\s+)?(me\s+)?ayud(es|a)\s+a\s+buscar/i,
  /ayúdame\s+a\s+buscar/i,
  /buscar\s+\d*\s*artículos?/i,
  /encuentra(me)?\s+\d*\s*(artículos?|información)/i,
  /investiga\s+(sobre|acerca)/i,
  /información\s+(sobre|de|del|acerca)/i,
  /precio\s+(de|del|actual)/i,
  /busca\s+(en\s+)?(internet|web|online)?/i,
  /buscar\s+/i,
  /investiga\s+/i,
  /informaci[oó]n\s+(sobre|de|del|acerca)/i,
  /actualidad\s+(de|sobre)/i,
  /\bhoy\b/i,
  /actual(es|mente)?/i,
  /202[4-9]|203[0-9]/i,
  /\b(clima|tiempo|weather)\s+(en|de|para|in|for)/i,
  /resultados?\s+(de|del)/i,
  /estad[ií]sticas?\s+(de|del|sobre)/i,
  /cotizaci[oó]n|stock|accion(es)?/i,
  /what\s+is\s+/i,
  /who\s+is\s+/i,
  /when\s+(did|does|is|was|will)/i,
  /where\s+(is|are|can|do)/i,
  /how\s+(to|does|do|can|is)/i,
  /latest\s+(news|update|info)/i,
  /current\s+(price|status|situation)/i,
  /search\s+(for|about|the)/i,
  /find\s+(out|info|about|me)/i,
  /look\s+up\s+/i,
  /tell\s+me\s+about\s+/i,
  /news\s+(about|on|from)/i,
  /\btoday\b/i,
  /\brecent(ly)?\b/i,
];

const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const FULL_CONTENT_COUNT = 8;
const FULL_CONTENT_MAX_CHARS = 4500;
const TOTAL_FETCH_TIMEOUT = 15000;
const USER_AGENTS = [
  HTTP_HEADERS.USER_AGENT,
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
] as const;

const searchCache = new Map<string, SearchCacheEntry>();
let userAgentCursor = 0;

function nextUserAgent(): string {
  const userAgent = USER_AGENTS[userAgentCursor % USER_AGENTS.length];
  userAgentCursor += 1;
  return userAgent;
}

function getHeaders(userAgent: string = nextUserAgent()) {
  return {
    "User-Agent": userAgent,
    "Accept": HTTP_HEADERS.ACCEPT_HTML,
    "Accept-Language": HTTP_HEADERS.ACCEPT_LANGUAGE
  };
}

interface PageMetadata {
  title: string;
  text: string;
  imageUrl?: string;
  canonicalUrl?: string;
  siteName?: string;
  publishedDate?: string;
}

// Export as fetchUrl for compatibility with agentExecutor
export async function fetchUrl(url: string, options?: { extractText?: boolean; maxLength?: number }): Promise<PageMetadata | null> {
  return fetchPageContent(url);
}

export async function fetchPageContent(url: string): Promise<PageMetadata | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(TIMEOUTS.PAGE_FETCH, 5000));

    const response = await fetch(url, {
      signal: controller.signal,
      headers: getHeaders()
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    // Extract og:image, twitter:image, or first large image
    let imageUrl: string | undefined;
    const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
    const twitterImage = doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
    if (ogImage) {
      imageUrl = ogImage.startsWith("http") ? ogImage : new URL(ogImage, url).href;
    } else if (twitterImage) {
      imageUrl = twitterImage.startsWith("http") ? twitterImage : new URL(twitterImage, url).href;
    }

    // Extract canonical URL and normalize to absolute
    const canonicalEl = doc.querySelector('link[rel="canonical"]');
    const rawCanonical = canonicalEl?.getAttribute("href");
    let canonicalUrl = url;
    if (rawCanonical) {
      try {
        canonicalUrl = rawCanonical.startsWith("http") ? rawCanonical : new URL(rawCanonical, url).href;
      } catch {
        canonicalUrl = url;
      }
    }

    // Extract site name
    const siteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ||
      doc.querySelector('meta[name="application-name"]')?.getAttribute("content");

    // Extract published date
    const publishedDate = doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ||
      doc.querySelector('meta[name="date"]')?.getAttribute("content") ||
      doc.querySelector('time[datetime]')?.getAttribute("datetime");

    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article?.textContent) {
      return {
        title: article.title || "",
        text: article.textContent.replace(/\s+/g, " ").trim(),
        imageUrl,
        canonicalUrl,
        siteName: siteName || undefined,
        publishedDate: publishedDate || undefined
      };
    }

    return {
      title: doc.querySelector("title")?.textContent || "",
      text: "",
      imageUrl,
      canonicalUrl: canonicalUrl || undefined,
      siteName: siteName || undefined,
      publishedDate: publishedDate || undefined
    };
  } catch (error) {
    Logger.warn("[WebSearch] Full page fetch failed", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// Quick metadata extraction without full page content (for speed)
export async function fetchPageMetadata(url: string): Promise<Omit<PageMetadata, "text"> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        ...getHeaders(),
        "Range": "bytes=0-50000" // Only fetch first 50KB for metadata
      }
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    // Extract og:image
    let imageUrl: string | undefined;
    const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
    const twitterImage = doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
    if (ogImage) {
      imageUrl = ogImage.startsWith("http") ? ogImage : new URL(ogImage, url).href;
    } else if (twitterImage) {
      imageUrl = twitterImage.startsWith("http") ? twitterImage : new URL(twitterImage, url).href;
    }

    // Normalize canonical URL to absolute
    const rawCanonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
    let canonicalUrl = url;
    if (rawCanonical) {
      try {
        canonicalUrl = rawCanonical.startsWith("http") ? rawCanonical : new URL(rawCanonical, url).href;
      } catch {
        canonicalUrl = url;
      }
    }

    const siteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content");
    const publishedDate = doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content");
    const title = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
      doc.querySelector("title")?.textContent || "";

    return { title, imageUrl, canonicalUrl: canonicalUrl || undefined, siteName: siteName || undefined, publishedDate: publishedDate || undefined };
  } catch (error) {
    Logger.warn("[WebSearch] Metadata fetch failed", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function sanitizeWebQuery(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  let q = raw;
  q = q.replace(/<[^>]*>/g, "");
  q = q.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  q = q.normalize("NFC");
  q = q.replace(/\s+/g, " ").trim();
  if (q.length > 500) q = q.substring(0, 500).trim();
  return q;
}

export async function searchWeb(query: string, maxResults: number = LIMITS.MAX_SEARCH_RESULTS): Promise<WebSearchResponse> {
  const sanitized = sanitizeWebQuery(query);
  if (!sanitized) return { query, results: [], contents: [] };

  const cacheKey = `${sanitized}:${maxResults}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    Logger.debug("[WebSearch] Cache hit", { query: sanitized, maxResults });
    return cached.response;
  }

  const results: SearchResult[] = [];
  const domainCounts = new Map<string, number>();
  const seenUrls = new Set<string>();
  const MAX_PER_DOMAIN = 5; // Allow up to 5 results per domain for more coverage
  let ddgBlockedReason: string | null = null;

  // Helper to extract domain from URL
  const extractDomain = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url.split("/")[2]?.replace(/^www\./, "") || "";
    }
  };

  const detectDuckDuckGoBlock = (html: string, status: number): string | null => {
    if (status === 429) return "DuckDuckGo rate limited the request (HTTP 429)";
    if (status === 403 && /captcha|challenge|automated|unusual traffic/i.test(html)) {
      return "DuckDuckGo returned a challenge/captcha page";
    }
    if (/captcha|unusual traffic|automated requests|robot verification|please verify/i.test(html)) {
      return "DuckDuckGo challenge page detected in HTML response";
    }
    return null;
  };

  // Parse results from a DuckDuckGo HTML page
  const parseDDGPage = (html: string): void => {
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    for (const result of Array.from(doc.querySelectorAll(".result"))) {
      if (results.length >= maxResults) break;

      const titleEl = result.querySelector(".result__title a");
      const snippetEl = result.querySelector(".result__snippet");

      if (titleEl) {
        const href = titleEl.getAttribute("href") || "";
        let url = href;

        if (href.includes("uddg=")) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) url = decodeURIComponent(match[1]);
        }

        if (url && !url.includes("duckduckgo.com") && !seenUrls.has(url)) {
          const domain = extractDomain(url);

          // Allow up to MAX_PER_DOMAIN results per domain for broader coverage
          const count = domainCounts.get(domain) || 0;
          if (count >= MAX_PER_DOMAIN) continue;
          domainCounts.set(domain, count + 1);
          seenUrls.add(url);

          results.push({
            title: titleEl.textContent?.trim() || "",
            url,
            snippet: snippetEl?.textContent?.trim() || ""
          });
        }
      }
    }
  };

  // Fetch a single DuckDuckGo search page with timeout
  const fetchDDGPage = async (
    pageUrl: string,
    init?: RequestInit,
    timeoutMs: number = 4000,
  ): Promise<{ html: string | null; blockedReason: string | null }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const userAgent = nextUserAgent();

    try {
      const response = await fetch(pageUrl, {
        ...init,
        headers: {
          ...getHeaders(userAgent),
          ...(init?.headers || {}),
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return {
          html: null,
          blockedReason: response.status === 429 ? "DuckDuckGo rate limited the request (HTTP 429)" : null,
        };
      }
      const html = await response.text();
      return {
        html,
        blockedReason: detectDuckDuckGoBlock(html, response.status),
      };
    } catch (error) {
      clearTimeout(timeout);
      Logger.warn("[WebSearch] DuckDuckGo HTML fetch failed", {
        pageUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return { html: null, blockedReason: null };
    }
  };

  const fallbackSearchWithScraper = async (): Promise<void> => {
    try {
      const ddg = await import("duck-duck-scrape");
      const searchResults = await ddg.search(sanitized, {
        safeSearch: ddg.SafeSearchType.OFF,
      });

      for (const result of (searchResults.results || []).slice(0, maxResults)) {
        if (!result?.url || seenUrls.has(result.url)) continue;

        const domain = extractDomain(result.url);
        const count = domainCounts.get(domain) || 0;
        if (count >= MAX_PER_DOMAIN) continue;

        domainCounts.set(domain, count + 1);
        seenUrls.add(result.url);
        results.push({
          title: result.title || "",
          url: result.url || "",
          snippet: result.description || "",
        });
      }
    } catch (error) {
      Logger.warn("[WebSearch] duck-duck-scrape fallback failed", {
        query: sanitized,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  try {
    // Page 1: Initial search
    const baseUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(sanitized)}`;
    const page1 = await fetchDDGPage(baseUrl);
    if (page1.blockedReason) {
      ddgBlockedReason = page1.blockedReason;
    }
    if (page1.html) {
      parseDDGPage(page1.html);
    }

    // Pages 2+ : DuckDuckGo HTML paginates via POST with form data (s=offset, dc=offset+1)
    // Each page returns ~25-30 results. Fetch more pages concurrently if we need more results.
    const resultsAfterPage1 = results.length;
    if (results.length < maxResults && !ddgBlockedReason) {
      const pagesToFetch: number[] = [];
      const resultsPerPage = 30;
      for (let offset = resultsPerPage; offset < maxResults * 2; offset += resultsPerPage) {
        pagesToFetch.push(offset);
        if (pagesToFetch.length >= 3) break; // Max 3 extra pages (total ~120 raw results)
      }

      const extraPages = await Promise.allSettled(
        pagesToFetch.map(async (offset) => {
          const formBody = `q=${encodeURIComponent(sanitized)}&s=${offset}&dc=${offset + 1}&o=json&api=d.js`;
          return fetchDDGPage(
            "https://html.duckduckgo.com/html/",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: formBody,
            },
            5000,
          );
        })
      );

      for (const pageResult of extraPages) {
        if (results.length >= maxResults) break;
        if (pageResult.status === "fulfilled" && pageResult.value) {
          if (pageResult.value.blockedReason && !ddgBlockedReason) {
            ddgBlockedReason = pageResult.value.blockedReason;
          }
          if (pageResult.value.html) {
            parseDDGPage(pageResult.value.html);
          }
        }
      }
    }
    console.log(`[WebSearch] Pagination complete: page1=${resultsAfterPage1}, total=${results.length}/${maxResults}`);
  } catch (error) {
    Logger.warn("[WebSearch] DuckDuckGo HTML parsing pipeline failed", {
      query: sanitized,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (ddgBlockedReason || results.length === 0) {
    Logger.warn("[WebSearch] Falling back to duck-duck-scrape", {
      query: sanitized,
      reason: ddgBlockedReason || "DuckDuckGo HTML returned no usable results",
    });
    await fallbackSearchWithScraper();
  }

  console.log(`[WebSearch] Total unique results: ${results.length}, unique domains: ${domainCounts.size}`);

  const contents: { url: string; title: string; content: string; imageUrl?: string; siteName?: string; publishedDate?: string }[] = [];

  // Create metadata map to enrich results (include canonicalUrl)
  const metadataMap = new Map<string, { imageUrl?: string; siteName?: string; publishedDate?: string; canonicalUrl?: string }>();

  // Phase 1: Fetch full content for top results (these give the LLM real information)
  const fullContentPromises = results.slice(0, FULL_CONTENT_COUNT).map(async (result) => {
    try {
      const page = await fetchPageContent(result.url);
      if (page) {
        metadataMap.set(result.url, {
          imageUrl: page.imageUrl,
          siteName: page.siteName,
          publishedDate: page.publishedDate,
          canonicalUrl: page.canonicalUrl
        });
        contents.push({
          url: result.url,
          title: page.title || result.title,
          content: (page.text || result.snippet || "").slice(0, FULL_CONTENT_MAX_CHARS),
          imageUrl: page.imageUrl,
          siteName: page.siteName,
          publishedDate: page.publishedDate
        });
      }
    } catch (error) {
      Logger.warn("[WebSearch] Full content enrichment failed", {
        url: result.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Phase 2: Fetch metadata-only for remaining results (fast, for UI enrichment)
  const metadataPromises = results.slice(FULL_CONTENT_COUNT, LIMITS.MAX_CONTENT_FETCH).map(async (result) => {
    try {
      const metadata = await fetchPageMetadata(result.url);
      if (metadata) {
        metadataMap.set(result.url, {
          imageUrl: metadata.imageUrl,
          siteName: metadata.siteName,
          publishedDate: metadata.publishedDate,
          canonicalUrl: metadata.canonicalUrl
        });
        contents.push({
          url: result.url,
          title: metadata.title || result.title,
          content: result.snippet?.slice(0, LIMITS.MAX_CONTENT_LENGTH) || "",
          imageUrl: metadata.imageUrl,
          siteName: metadata.siteName,
          publishedDate: metadata.publishedDate
        });
      }
    } catch (error) {
      Logger.warn("[WebSearch] Metadata enrichment failed", {
        url: result.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Race all fetches against timeout
  await Promise.race([
    Promise.allSettled([...fullContentPromises, ...metadataPromises]),
    new Promise<void>(resolve => setTimeout(resolve, TOTAL_FETCH_TIMEOUT))
  ]);

  // Enrich results with metadata from fetched pages
  const enrichedResults = results.map(r => {
    const metadata = metadataMap.get(r.url);
    if (metadata) {
      return {
        ...r,
        imageUrl: metadata.imageUrl,
        siteName: metadata.siteName,
        publishedDate: metadata.publishedDate,
        canonicalUrl: metadata.canonicalUrl
      };
    }
    return r;
  });

  console.log(`[WebSearch] Query: "${query}" - Found ${results.length} unique sources, fetched ${contents.length} pages, ${Array.from(metadataMap.values()).filter(m => m.imageUrl).length} with images`);

  const response = { query, results: enrichedResults, contents };
  searchCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    response,
  });

  return response;
}

export async function searchScholar(query: string, maxResults: number = LIMITS.MAX_SEARCH_RESULTS): Promise<SearchResult[]> {
  const sanitized = sanitizeWebQuery(query);
  if (!sanitized) return [];
  const results: SearchResult[] = [];

  try {
    const searchUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(sanitized)}&hl=es`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(searchUrl, { headers: getHeaders(), signal: controller.signal });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error("Scholar search failed:", response.status);
      return results;
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    for (const article of Array.from(doc.querySelectorAll(".gs_ri")).slice(0, maxResults)) {
      const titleEl = article.querySelector(".gs_rt a");
      const snippetEl = article.querySelector(".gs_rs");
      const infoEl = article.querySelector(".gs_a");

      if (titleEl) {
        const title = titleEl.textContent?.trim() || "";
        const url = titleEl.getAttribute("href") || "";
        const snippet = snippetEl?.textContent?.trim() || "";
        const info = infoEl?.textContent?.trim() || "";

        const authors = info.match(/^([^-]+)/)?.[1]?.trim() || "";
        const year = info.match(/\b(19|20)\d{2}\b/)?.[0] || "";

        if (title && (url || snippet)) {
          results.push({
            title,
            url,
            snippet,
            authors,
            year,
            citation: `${authors} (${year}). ${title}. Recuperado de ${url}`
          });
        }
      }
    }
  } catch (error) {
    console.error("Scholar search error:", error);
  }

  return results;
}

export function needsAcademicSearch(message: string): boolean {
  return ACADEMIC_PATTERNS.some(pattern => pattern.test(message));
}

export function needsWebSearch(message: string): boolean {
  return WEB_SEARCH_PATTERNS.some(pattern => pattern.test(message));
}
