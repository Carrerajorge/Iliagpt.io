/**
 * arXiv API Client
 *
 * 2.4M+ preprints: physics, mathematics, CS, EE, quantitative biology,
 * quantitative finance, statistics, economics.
 * 100% free, no authentication required.
 * Endpoint: https://export.arxiv.org/api/query
 *
 * Features:
 *  - Full-text search across title, abstract, authors
 *  - Category filtering (cs.AI, cs.LG, cs.CL, math.*, q-bio.*, etc.)
 *  - Year range filtering
 *  - PDF and LaTeX source links (always open access)
 *  - Atom feed response (XML), parsed to AcademicCandidate
 */

import { AcademicCandidate } from "./openAlexClient";
import { persistentJsonCacheGet, persistentJsonCacheSet } from "../../lib/persistentJsonCache";
import { sanitizeSearchQuery } from "../../lib/textSanitizers";

const ARXIV_API_BASE = "https://export.arxiv.org/api/query";
const RATE_LIMIT_MS = 500;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — preprints are updated daily

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await rateLimit();
      const response = await fetch(url, {
        headers: {
          "Accept": "application/xml, text/xml",
          "User-Agent": "IliaGPT/1.0 (mailto:carrerajorge874@gmail.com)",
        },
        signal: AbortSignal.timeout(20_000),
      });

      if (response.ok) return response;

      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 300;
        console.warn(`[arXiv] HTTP ${response.status}, retry ${attempt + 1}/${retries} in ${Math.round(backoff)}ms`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }

      console.warn(`[arXiv] HTTP ${response.status} for URL: ${url}`);
      return null;
    } catch (err: any) {
      if (attempt < retries) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 300;
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      console.error(`[arXiv] Fetch error: ${err.message}`);
      return null;
    }
  }
  return null;
}

function extractXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function extractAllXmlTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
  return xml.match(regex) || [];
}

function extractAttrValue(xml: string, attr: string): string {
  const match = xml.match(new RegExp(`${attr}="([^"]+)"`));
  return match?.[1] || "";
}

function parseArXivEntry(entryXml: string): AcademicCandidate | null {
  const title = extractXmlTag(entryXml, "title");
  if (!title) return null;

  const abstract = extractXmlTag(entryXml, "summary");
  const published = extractXmlTag(entryXml, "published");
  const updated = extractXmlTag(entryXml, "updated");

  // arXiv ID from <id> tag like https://arxiv.org/abs/2301.12345v2
  const idRaw = extractXmlTag(entryXml, "id");
  const arxivIdMatch = idRaw.match(/arxiv\.org\/abs\/([^\s]+)/i);
  const arxivId = arxivIdMatch?.[1]?.replace(/v\d+$/, "") || "";

  // DOI (optional — many preprints don't have one)
  const doi = extractXmlTag(entryXml, "arxiv:doi") || extractXmlTag(entryXml, "doi");

  // Authors
  const authorBlocks = extractAllXmlTags(entryXml, "author");
  const authors = authorBlocks.map(block => {
    const name = extractXmlTag(block, "name");
    return name;
  }).filter(Boolean);

  // First author affiliation
  const firstAuthorBlock = authorBlocks[0] || "";
  const affiliation = extractXmlTag(firstAuthorBlock, "arxiv:affiliation");

  // Categories (arXiv subject areas)
  const categoryMatches = entryXml.match(/<category[^>]*term="([^"]+)"/g) || [];
  const categories = categoryMatches
    .map(c => extractAttrValue(c, "term"))
    .filter(Boolean);

  // Primary category
  const primaryCat = extractAttrValue(
    entryXml.match(/<arxiv:primary_category[^>]*/)?.[0] || "",
    "term"
  ) || categories[0] || "";

  const year = published ? parseInt(published.substring(0, 4)) : 0;
  const publicationDate = published ? published.substring(0, 10) : "";

  const landingUrl = arxivId ? `https://arxiv.org/abs/${arxivId}` : "";
  const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : "";

  return {
    source: "openalex" as const, // reuse type; actual source tracked via metadata
    sourceId: arxivId || `arxiv_${Date.now()}`,
    doi: doi || "",
    title,
    year,
    publicationDate,
    journal: primaryCat || "arXiv",
    abstract,
    authors,
    keywords: categories,
    language: "en",
    documentType: "preprint",
    citationCount: 0,
    affiliations: affiliation ? [affiliation] : [],
    city: "",
    country: "",
    institutionCountryCodes: [],
    primaryInstitutionCountryCode: undefined,
    landingUrl,
    doiUrl: doi ? `https://doi.org/${doi}` : pdfUrl,
    verified: true,
    relevanceScore: 0,
    verificationStatus: "verified",
    // Extra metadata stored for pipeline use
    ...{ arxivId, pdfUrl, categories },
  } as AcademicCandidate & { arxivId: string; pdfUrl: string; categories: string[] };
}

export interface ArXivSearchOptions {
  maxResults?: number;
  yearStart?: number;
  yearEnd?: number;
  /** arXiv category filter, e.g. "cs.AI", "cs.LG", "math.CO" */
  category?: string;
  /** Sort: "relevance" | "lastUpdatedDate" | "submittedDate" */
  sortBy?: "relevance" | "lastUpdatedDate" | "submittedDate";
  sortOrder?: "ascending" | "descending";
}

/**
 * Build an arXiv search query string.
 * Supports field-specific search: ti: (title), abs: (abstract), au: (author), cat: (category)
 */
function buildArXivQuery(query: string, opts: ArXivSearchOptions): string {
  const parts: string[] = [];

  // Main full-text query across all fields
  const cleanQuery = sanitizeSearchQuery(query, 400);
  if (cleanQuery) {
    parts.push(`all:${cleanQuery}`);
  }

  // Category filter
  if (opts.category) {
    parts.push(`cat:${opts.category}`);
  }

  return parts.join("+AND+");
}

/**
 * Search arXiv for preprints matching the query.
 * Returns AcademicCandidate[] compatible with the existing pipeline.
 */
export async function searchArXiv(
  query: string,
  opts: ArXivSearchOptions = {}
): Promise<AcademicCandidate[]> {
  const {
    maxResults = 50,
    sortBy = "relevance",
    sortOrder = "descending",
  } = opts;

  if (!query?.trim()) return [];

  const clampedMax = Math.max(1, Math.min(200, maxResults));
  const cacheKey = `arxiv:search:${query.toLowerCase().trim()}:${clampedMax}:${sortBy}:${opts.category || ""}:${opts.yearStart || ""}:${opts.yearEnd || ""}`;

  const cached = await persistentJsonCacheGet<AcademicCandidate[]>(cacheKey);
  if (cached !== null) {
    console.log(`[arXiv] Cache hit: ${cached.length} results`);
    return cached;
  }

  const arxivQuery = buildArXivQuery(query, opts);
  if (!arxivQuery) return [];

  const params = new URLSearchParams({
    search_query: arxivQuery,
    start: "0",
    max_results: String(clampedMax),
    sortBy,
    sortOrder,
  });

  const url = `${ARXIV_API_BASE}?${params.toString()}`;
  console.log(`[arXiv] Searching: ${url}`);

  const response = await fetchWithRetry(url);
  if (!response) {
    console.warn("[arXiv] No response from API");
    return [];
  }

  const xmlText = await response.text();

  // Parse entries from Atom feed
  const entryMatches = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const candidates: AcademicCandidate[] = [];

  for (const entryXml of entryMatches) {
    const candidate = parseArXivEntry(entryXml);
    if (!candidate) continue;

    // Apply year filter post-parse (arXiv API doesn't support year range natively)
    if (opts.yearStart && candidate.year && candidate.year < opts.yearStart) continue;
    if (opts.yearEnd && candidate.year && candidate.year > opts.yearEnd) continue;

    candidates.push(candidate);
  }

  console.log(`[arXiv] Found ${candidates.length} preprints for query: ${query.substring(0, 60)}`);
  await persistentJsonCacheSet(cacheKey, candidates, CACHE_TTL_MS);

  return candidates;
}

/**
 * Fetch a specific arXiv paper by its arXiv ID.
 * Returns a single AcademicCandidate or null.
 */
export async function getArXivById(arxivId: string): Promise<AcademicCandidate | null> {
  if (!arxivId?.trim()) return null;

  const clean = arxivId.replace(/v\d+$/, "").trim();
  const cacheKey = `arxiv:id:${clean}`;

  const cached = await persistentJsonCacheGet<AcademicCandidate>(cacheKey);
  if (cached !== null) return cached;

  const url = `${ARXIV_API_BASE}?id_list=${encodeURIComponent(clean)}`;
  const response = await fetchWithRetry(url);
  if (!response) return null;

  const xmlText = await response.text();
  const entryMatch = xmlText.match(/<entry>[\s\S]*?<\/entry>/)?.[0];
  if (!entryMatch) return null;

  const candidate = parseArXivEntry(entryMatch);
  if (candidate) {
    await persistentJsonCacheSet(cacheKey, candidate, CACHE_TTL_MS);
  }
  return candidate;
}

/**
 * Search arXiv by author name.
 */
export async function searchArXivByAuthor(
  author: string,
  maxResults = 20
): Promise<AcademicCandidate[]> {
  const clean = sanitizeSearchQuery(author, 200);
  if (!clean) return [];
  const query = `au:${clean}`;
  return searchArXiv(query, { maxResults, sortBy: "submittedDate" });
}

/**
 * Get the latest preprints from a specific arXiv category.
 */
export async function getLatestArXivByCategory(
  category: string,
  maxResults = 20
): Promise<AcademicCandidate[]> {
  return searchArXiv(`cat:${category}`, {
    maxResults,
    sortBy: "submittedDate",
    sortOrder: "descending",
  });
}
