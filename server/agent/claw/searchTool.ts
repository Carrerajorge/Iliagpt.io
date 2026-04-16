/**
 * Claw Search Tool — Web search and URL fetching for the Claw agent subsystem.
 *
 * Uses DuckDuckGo HTML scraping as a zero-dependency fallback search provider.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface SearchOptions {
  query: string;
  maxResults?: number;
  type?: "web" | "academic" | "news";
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/* ------------------------------------------------------------------ */
/*  Web Search                                                        */
/* ------------------------------------------------------------------ */

const DDG_URL = "https://html.duckduckgo.com/html/";

/**
 * Perform a web search and return structured results.
 * Uses DuckDuckGo HTML endpoint as a lightweight, key-free search backend.
 */
export async function webSearch(opts: SearchOptions): Promise<SearchResult[]> {
  const maxResults = opts.maxResults ?? 5;

  const params = new URLSearchParams({ q: opts.query });
  if (opts.type === "news") params.set("iar", "news");
  if (opts.type === "academic") params.set("q", `${opts.query} site:scholar.google.com OR site:arxiv.org`);

  const resp = await fetch(DDG_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    body: params.toString(),
  });

  if (!resp.ok) {
    throw new Error(`DuckDuckGo search failed: ${resp.status} ${resp.statusText}`);
  }

  const html = await resp.text();
  return parseDdgResults(html, maxResults);
}

/** Parse DuckDuckGo HTML search results page into structured data. */
function parseDdgResults(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = [];
  // Each organic result lives in a <div class="result ..."> with an <a class="result__a"> and <a class="result__snippet">
  const resultBlocks = html.split(/class="result\s/g).slice(1);

  for (const block of resultBlocks) {
    if (results.length >= max) break;

    const hrefMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
    const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

    if (hrefMatch && titleMatch) {
      let url = hrefMatch[1];
      // DuckDuckGo wraps URLs in a redirect; extract the actual URL
      const uddg = url.match(/[?&]uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);

      results.push({
        title: titleMatch[1].trim(),
        url,
        snippet: snippetMatch
          ? snippetMatch[1].replace(/<[^>]*>/g, "").trim()
          : "",
      });
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  URL Fetch                                                         */
/* ------------------------------------------------------------------ */

/**
 * Fetch a URL and return readable text content (HTML tags stripped).
 * Truncates to maxLength characters (default 50 000).
 */
export async function fetchUrl(
  url: string,
  opts?: { maxLength?: number }
): Promise<{ content: string; title: string }> {
  const maxLength = opts?.maxLength ?? 50_000;

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });

  if (!resp.ok) {
    throw new Error(`Fetch failed for ${url}: ${resp.status} ${resp.statusText}`);
  }

  const html = await resp.text();

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // Strip tags and collapse whitespace
  const content = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  return { content, title };
}

/* ------------------------------------------------------------------ */
/*  Tool definition for the Claw agent tool registry                  */
/* ------------------------------------------------------------------ */

const clawSearchInputSchema = z.object({
  action: z.enum(["search", "fetch"]).describe("Action: 'search' for web search, 'fetch' for URL content retrieval"),
  query: z.string().optional().describe("Search query (required for 'search' action)"),
  url: z.string().optional().describe("URL to fetch (required for 'fetch' action)"),
  maxResults: z.number().int().min(1).max(20).optional().default(5).describe("Max search results to return"),
  type: z.enum(["web", "academic", "news"]).optional().default("web").describe("Type of search"),
  maxLength: z.number().int().optional().default(50_000).describe("Max character length for fetched content"),
});

export type ClawSearchInput = z.infer<typeof clawSearchInputSchema>;

export const SEARCH_TOOL_DEFINITION = {
  name: "claw_search",
  description:
    "Search the web or fetch URL content. Actions: 'search' performs a web search and returns titles, URLs, and snippets; 'fetch' retrieves a URL and returns readable text content.",
  inputSchema: clawSearchInputSchema,
  capabilities: ["requires_network" as const, "accesses_external_api" as const],
  safetyPolicy: "safe" as const,
  timeoutMs: 30_000,

  async execute(input: ClawSearchInput): Promise<{ success: boolean; output: unknown; error?: string }> {
    try {
      if (input.action === "search") {
        if (!input.query) return { success: false, output: null, error: "query is required for search" };
        const results = await webSearch({ query: input.query, maxResults: input.maxResults, type: input.type });
        return { success: true, output: { results, count: results.length } };
      }

      if (input.action === "fetch") {
        if (!input.url) return { success: false, output: null, error: "url is required for fetch" };
        const page = await fetchUrl(input.url, { maxLength: input.maxLength });
        return { success: true, output: page };
      }

      return { success: false, output: null, error: `Unknown action: ${input.action}` };
    } catch (err: any) {
      return { success: false, output: null, error: err.message ?? String(err) };
    }
  },
};
