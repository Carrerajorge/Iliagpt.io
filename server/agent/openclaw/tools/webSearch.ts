import { z } from "zod";

const WebSearchInputSchema = z.object({
  query: z.string().min(1).max(500),
  count: z.number().int().min(1).max(20).default(5),
  country: z.string().length(2).default("us"),
  language: z.string().default("en"),
  freshness: z.enum(["day", "week", "month", "any"]).default("any"),
});

type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  imageUrl?: string;
  siteName?: string;
  publishedDate?: string;
}

export interface WebSearchOutput {
  query: string;
  provider: string;
  results: WebSearchResult[];
  cached: boolean;
}

interface CacheEntry {
  data: WebSearchOutput;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 200;
const searchCache = new Map<string, CacheEntry>();

function pruneCache() {
  if (searchCache.size <= MAX_CACHE_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of searchCache) {
    if (entry.expiresAt < now) searchCache.delete(key);
  }
  if (searchCache.size > MAX_CACHE_SIZE) {
    const oldest = Array.from(searchCache.entries())
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (let i = 0; i < oldest.length - MAX_CACHE_SIZE; i++) {
      searchCache.delete(oldest[i][0]);
    }
  }
}

function buildCacheKey(input: WebSearchInput): string {
  return `${input.query}|${input.count}|${input.country}|${input.language}|${input.freshness}`;
}

const PRIVATE_IP_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^fd/i,
  /localhost/i,
  /\.local$/i,
  /\.internal$/i,
];

function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname;
    if (PRIVATE_IP_PATTERNS.some(p => p.test(hostname))) return false;
    if (parsed.port && !["80", "443", ""].includes(parsed.port)) return false;
    return true;
  } catch {
    return false;
  }
}

async function searchWithGrok(input: WebSearchInput): Promise<WebSearchResult[]> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY not configured");

  const freshnessHint = input.freshness !== "any"
    ? ` (results from the last ${input.freshness})`
    : "";

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-3-mini",
      messages: [
        {
          role: "system",
          content: `You are a web search assistant. Return search results as a JSON array. Each result must have: title, url, snippet. Optionally include: siteName, publishedDate. Return at most ${input.count} results. Language: ${input.language}. Country: ${input.country}.${freshnessHint} ONLY output valid JSON array, no markdown, no explanation.`,
        },
        {
          role: "user",
          content: input.query,
        },
      ],
      search_mode: "auto",
      temperature: 0,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Grok search failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Grok returned no parseable results");

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) throw new Error("Grok result is not an array");

  return parsed
    .filter((r: any) => r.title && r.url && isUrlSafe(r.url))
    .slice(0, input.count)
    .map((r: any) => ({
      title: String(r.title).slice(0, 300),
      url: String(r.url),
      snippet: String(r.snippet || "").slice(0, 500),
      siteName: r.siteName ? String(r.siteName) : undefined,
      publishedDate: r.publishedDate ? String(r.publishedDate) : undefined,
    }));
}

async function searchWithGemini(input: WebSearchInput): Promise<WebSearchResult[]> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const freshnessHint = input.freshness !== "any"
    ? ` (results from the last ${input.freshness})`
    : "";

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Search the web for: "${input.query}"${freshnessHint}\nReturn at most ${input.count} results as a JSON array. Each result: { title, url, snippet, siteName?, publishedDate? }. Language: ${input.language}. Country: ${input.country}. ONLY output valid JSON array.`,
              },
            ],
          },
        ],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gemini search failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json();

  const groundingChunks =
    data.candidates?.[0]?.groundingMetadata?.groundingChunks ||
    data.candidates?.[0]?.groundingMetadata?.searchEntryPoint?.renderedContent;

  if (Array.isArray(groundingChunks) && groundingChunks.length > 0) {
    return groundingChunks
      .filter((c: any) => c.web?.uri && isUrlSafe(c.web.uri))
      .slice(0, input.count)
      .map((c: any) => ({
        title: String(c.web?.title || "").slice(0, 300),
        url: String(c.web.uri),
        snippet: "",
      }));
  }

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Gemini returned no parseable results");

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) throw new Error("Gemini result is not an array");

  return parsed
    .filter((r: any) => r.title && r.url && isUrlSafe(r.url))
    .slice(0, input.count)
    .map((r: any) => ({
      title: String(r.title).slice(0, 300),
      url: String(r.url),
      snippet: String(r.snippet || "").slice(0, 500),
      siteName: r.siteName ? String(r.siteName) : undefined,
      publishedDate: r.publishedDate ? String(r.publishedDate) : undefined,
    }));
}

async function searchWithDuckDuckGo(input: WebSearchInput): Promise<WebSearchResult[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; IliaGPT/1.0)",
      "Accept": "text/html",
      "Accept-Language": input.language,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) throw new Error(`DDG search failed: ${response.status}`);

  const { JSDOM } = await import("jsdom");
  const html = await response.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const results: WebSearchResult[] = [];
  const seenDomains = new Set<string>();

  for (const result of Array.from(doc.querySelectorAll(".result"))) {
    if (results.length >= input.count) break;
    const titleEl = result.querySelector(".result__title a");
    const snippetEl = result.querySelector(".result__snippet");
    if (!titleEl) continue;

    const href = titleEl.getAttribute("href") || "";
    let url = href;
    if (href.includes("uddg=")) {
      const match = href.match(/uddg=([^&]+)/);
      if (match) url = decodeURIComponent(match[1]);
    }

    if (!url || url.includes("duckduckgo.com") || !isUrlSafe(url)) continue;

    try {
      const domain = new URL(url).hostname.replace(/^www\./, "");
      if (seenDomains.has(domain)) continue;
      seenDomains.add(domain);
    } catch {
      continue;
    }

    results.push({
      title: titleEl.textContent?.trim() || "",
      url,
      snippet: snippetEl?.textContent?.trim() || "",
    });
  }

  return results;
}

type ProviderFn = (input: WebSearchInput) => Promise<WebSearchResult[]>;

const PROVIDERS: { name: string; fn: ProviderFn }[] = [
  { name: "grok", fn: searchWithGrok },
  { name: "gemini", fn: searchWithGemini },
  { name: "duckduckgo", fn: searchWithDuckDuckGo },
];

export async function openclawWebSearch(rawInput: unknown): Promise<WebSearchOutput> {
  const input = WebSearchInputSchema.parse(rawInput);

  const cacheKey = buildCacheKey(input);
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  let lastError: Error | null = null;

  for (const provider of PROVIDERS) {
    try {
      console.log(`[OpenClaw WebSearch] Trying provider: ${provider.name} for "${input.query}"`);
      const results = await provider.fn(input);

      if (results.length === 0) {
        console.log(`[OpenClaw WebSearch] ${provider.name} returned 0 results, trying next`);
        continue;
      }

      const output: WebSearchOutput = {
        query: input.query,
        provider: provider.name,
        results,
        cached: false,
      };

      searchCache.set(cacheKey, { data: output, expiresAt: Date.now() + CACHE_TTL_MS });
      pruneCache();

      console.log(`[OpenClaw WebSearch] ${provider.name} returned ${results.length} results`);
      return output;
    } catch (err: any) {
      lastError = err;
      console.warn(`[OpenClaw WebSearch] ${provider.name} failed: ${err.message}`);
    }
  }

  throw new Error(
    `All search providers failed for query "${input.query}". Last error: ${lastError?.message || "unknown"}`
  );
}

export { WebSearchInputSchema, isUrlSafe };

export function clearSearchCache(): void {
  searchCache.clear();
}

export function getSearchCacheStats(): { size: number; maxSize: number } {
  return { size: searchCache.size, maxSize: MAX_CACHE_SIZE };
}
