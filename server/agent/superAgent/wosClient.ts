import { translateToEnglish } from "./scopusClient";
import { sanitizeSearchQuery } from "../../lib/textSanitizers";

export interface WosArticle {
  id: string;
  title: string;
  authors: string[];
  year: number;
  journal: string;
  abstract: string;
  keywords: string[];
  doi: string;
  citationCount: number;
  affiliations: string[];
  wosUrl: string;
  documentType: string;
  language: string;
}

export interface WosSearchResult {
  articles: WosArticle[];
  totalResults: number;
  query: string;
  searchTime: number;
}

const WOS_STARTER_API_BASE = "https://api.clarivate.com/apis/wos-starter/v1";
const REQUEST_TIMEOUT_MS = 20000;

export function isWosConfigured(): boolean {
  const key = process.env.WOS_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * Sanitize and harden WoS search query input
 */
function sanitizeWosQuery(raw: string): string {
  return sanitizeSearchQuery(raw, 500);
}

/**
 * Fetch with timeout for WoS API calls
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchWos(
  query: string,
  options: {
    maxResults?: number;
    startYear?: number;
    endYear?: number;
    documentType?: string;
  } = {}
): Promise<WosSearchResult> {
  const apiKey = process.env.WOS_API_KEY;
  if (!apiKey) {
    throw new Error("WOS_API_KEY not configured");
  }

  const { maxResults = 25, startYear, endYear, documentType } = options;
  const clampedMax = Math.max(1, Math.min(50, maxResults));
  const startTime = Date.now();

  // Sanitize query input
  const sanitized = sanitizeWosQuery(query);
  if (!sanitized) {
    return { articles: [], totalResults: 0, query, searchTime: 0 };
  }

  const translatedQuery = translateToEnglish(sanitized);
  console.log(`[WoS] Original query: "${sanitized}"`);
  console.log(`[WoS] Translated query: "${translatedQuery}"`);

  let searchQuery = `TS=(${translatedQuery})`;

  // Validate year range
  const currentYear = new Date().getFullYear();
  if (startYear && endYear) {
    const clampedStart = Math.max(1900, Math.min(currentYear + 1, startYear));
    const clampedEnd = Math.max(clampedStart, Math.min(currentYear + 1, endYear));
    searchQuery += ` AND PY=(${clampedStart}-${clampedEnd})`;
  }

  const params = new URLSearchParams({
    db: "WOS",
    q: searchQuery,
    limit: String(clampedMax),
    page: "1",
  });

  const searchUrl = `${WOS_STARTER_API_BASE}/documents?${params}`;
  console.log(`[WoS] Search URL: ${searchUrl}`);

  try {
    const response = await fetchWithTimeout(searchUrl, {
      headers: {
        "X-ApiKey": apiKey,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WoS] API error: ${response.status} - ${errorText}`);
      throw new Error(`WoS API error: ${response.status}`);
    }

    const data = await response.json();
    const searchTime = Date.now() - startTime;
    
    console.log(`[WoS] Response structure:`, JSON.stringify(data).substring(0, 500));

    const hits = data.hits || [];
    const metadata = data.metadata || {};
    
    const articles: WosArticle[] = hits.map((hit: any, index: number) => {
      const source = hit.source || {};
      const names = source.names || {};
      const identifiers = source.identifiers || {};
      const links = source.links || {};
      
      const title = source.title || "No title";
      const year = source.publishYear || source.sortDate?.substring(0, 4) || new Date().getFullYear();
      const journal = source.sourceTitle || "";
      
      const authors = (names.authors || []).map((a: any) => 
        a.displayName || a.wosStandard || `${a.lastName || ''}, ${a.firstName || ''}`.trim()
      ).filter(Boolean);
      
      const abstract = source.abstract || "";
      
      const keywords = source.keywords?.authorKeywords || source.keywordsPlus || [];
      
      const doi = identifiers.doi || "";
      const citationCount = source.timesCited || 0;
      
      const affiliations = (source.affiliations || []).map((aff: any) => 
        aff.organizationEnhanced || aff.organizationName || ""
      ).filter(Boolean);
      
      const uid = hit.uid || source.uid || `wos-${index}`;
      const wosUrl = links.record || `https://www.webofscience.com/wos/woscc/full-record/${uid}`;
      
      return {
        id: uid,
        title,
        authors,
        year: parseInt(String(year), 10),
        journal,
        abstract,
        keywords: Array.isArray(keywords) ? keywords : [],
        doi,
        citationCount: parseInt(String(citationCount), 10) || 0,
        affiliations,
        wosUrl,
        documentType: source.docType || source.documentType || "Article",
        language: source.language || "English",
      };
    });

    const totalResults = metadata.total || hits.length;
    console.log(`[WoS] Found ${articles.length} articles from ${totalResults} total in ${searchTime}ms`);

    return {
      articles,
      totalResults,
      query: translatedQuery,
      searchTime,
    };
  } catch (error) {
    console.error("[WoS] Search error:", error);
    throw error;
  }
}

export function formatWosForExcel(articles: WosArticle[]): any[] {
  return articles.map((article, index) => ({
    "#": index + 1,
    "Authors": article.authors.join("; "),
    "Title": article.title,
    "Year": article.year,
    "Journal": article.journal,
    "Abstract": article.abstract.substring(0, 500) + (article.abstract.length > 500 ? "..." : ""),
    "Keywords": article.keywords.join("; "),
    "Language": article.language,
    "Document Type": article.documentType,
    "DOI": article.doi,
    "Citations": article.citationCount,
    "Affiliations": article.affiliations.join("; "),
    "WoS URL": article.wosUrl,
    "Source": "Web of Science",
  }));
}
