/**
 * Scopus Academic Search Integration
 * Uses Elsevier's Scopus API for academic paper search
 * 
 * To use: Set SCOPUS_API_KEY in environment variables
 * Get your API key from: https://dev.elsevier.com/
 */

import { SearchResult } from "./webSearch";

const SCOPUS_API_KEY = process.env.SCOPUS_API_KEY || "";
const SCOPUS_BASE_URL = "https://api.elsevier.com/content/search/scopus";

export interface ScopusArticle {
  title: string;
  authors: string;
  publicationName: string;
  year: string;
  doi: string;
  citedByCount: number;
  abstract: string;
  url: string;
  scopusId: string;
}

export interface ScopusSearchResponse {
  query: string;
  totalResults: number;
  articles: ScopusArticle[];
}

/**
 * Check if Scopus API is configured
 */
export function isScopusConfigured(): boolean {
  return SCOPUS_API_KEY.length > 0;
}

/**
 * Search Scopus for academic articles
 */
export async function searchScopus(
  query: string,
  options: {
    maxResults?: number;
    sortBy?: "relevance" | "date" | "citedby";
    yearFrom?: number;
    yearTo?: number;
  } = {}
): Promise<ScopusSearchResponse> {
  const { maxResults = 10, sortBy = "relevance", yearFrom, yearTo } = options;

  if (!SCOPUS_API_KEY) {
    console.warn("[Scopus] API key not configured. Set SCOPUS_API_KEY in environment.");
    return { query, totalResults: 0, articles: [] };
  }

  try {
    // Build query with date range if specified
    let searchQuery = query;
    if (yearFrom || yearTo) {
      const from = yearFrom || 1900;
      const to = yearTo || new Date().getFullYear();
      searchQuery = `${query} AND PUBYEAR > ${from - 1} AND PUBYEAR < ${to + 1}`;
    }

    const params = new URLSearchParams({
      query: searchQuery,
      count: maxResults.toString(),
      sort: sortBy === "date" ? "-coverDate" : sortBy === "citedby" ? "-citedby-count" : "relevance",
      field: "dc:title,dc:creator,prism:publicationName,prism:coverDate,prism:doi,citedby-count,dc:description,prism:url,dc:identifier"
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(`${SCOPUS_BASE_URL}?${params}`, {
      headers: {
        "X-ELS-APIKey": SCOPUS_API_KEY,
        "Accept": "application/json"
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const error = await response.text();
      console.error("[Scopus] API error:", response.status, error);
      return { query, totalResults: 0, articles: [] };
    }

    const data = await response.json();
    const entries = data["search-results"]?.entry || [];
    const totalResults = parseInt(data["search-results"]?.["opensearch:totalResults"] || "0");

    const articles: ScopusArticle[] = entries
      .filter((entry: any) => entry["dc:title"])
      .map((entry: any) => ({
        title: entry["dc:title"] || "",
        authors: entry["dc:creator"] || "Unknown",
        publicationName: entry["prism:publicationName"] || "",
        year: entry["prism:coverDate"]?.split("-")[0] || "",
        doi: entry["prism:doi"] || "",
        citedByCount: parseInt(entry["citedby-count"] || "0"),
        abstract: entry["dc:description"] || "",
        url: entry["prism:url"] || `https://www.scopus.com/record/display.uri?eid=${entry["dc:identifier"]}`,
        scopusId: entry["dc:identifier"]?.replace("SCOPUS_ID:", "") || ""
      }));

    console.log(`[Scopus] Found ${totalResults} results for "${query}", returning ${articles.length}`);

    return {
      query,
      totalResults,
      articles
    };
  } catch (error) {
    console.error("[Scopus] Search error:", error);
    return { query, totalResults: 0, articles: [] };
  }
}

/**
 * Convert Scopus articles to standard SearchResult format
 */
export function scopusToSearchResults(articles: ScopusArticle[]): SearchResult[] {
  return articles.map(article => ({
    title: article.title,
    url: article.doi ? `https://doi.org/${article.doi}` : article.url,
    snippet: article.abstract || `${article.publicationName}. Cited by ${article.citedByCount} 🔗`,
    authors: article.authors,
    year: article.year,
    citation: formatApaCitation(article)
  }));
}

/**
 * Format APA 7th edition citation
 */
export function formatApaCitation(article: ScopusArticle): string {
  const authorList = article.authors.split(",").map(a => a.trim());
  let authorStr = "";
  
  if (authorList.length === 1) {
    authorStr = authorList[0];
  } else if (authorList.length === 2) {
    authorStr = `${authorList[0]} & ${authorList[1]}`;
  } else if (authorList.length > 2) {
    authorStr = `${authorList[0]} et al.`;
  }
  
  const doi = article.doi ? ` 🔗 https://doi.org/${article.doi}` : "";

  return `${authorStr} (${article.year}). ${article.title}. ${article.publicationName}.${doi}`;
}

/**
 * Search both Scopus and Google Scholar, merge results
 */
export async function searchAcademicSources(
  query: string,
  options: {
    maxResults?: number;
    includeScopus?: boolean;
    includeScholar?: boolean;
  } = {}
): Promise<SearchResult[]> {
  const { maxResults = 10, includeScopus = true, includeScholar = true } = options;
  const results: SearchResult[] = [];
  const halfMax = Math.ceil(maxResults / 2);

  const promises: Promise<SearchResult[]>[] = [];

  // Scopus search
  if (includeScopus && isScopusConfigured()) {
    promises.push(
      searchScopus(query, { maxResults: halfMax })
        .then(res => scopusToSearchResults(res.articles))
        .catch(() => [])
    );
  }

  // Google Scholar search (fallback/supplement)
  if (includeScholar) {
    const { searchScholar } = require("./webSearch");
    promises.push(
      searchScholar(query, halfMax).catch(() => [])
    );
  }

  const allResults = await Promise.all(promises);
  
  // Merge and deduplicate by title similarity
  const seen = new Set<string>();
  for (const resultSet of allResults) {
    for (const result of resultSet) {
      const titleKey = result.title.toLowerCase().substring(0, 50);
      if (!seen.has(titleKey)) {
        seen.add(titleKey);
        results.push(result);
      }
    }
  }

  return results.slice(0, maxResults);
}

/**
 * Get article details from Scopus by DOI
 */
export async function getScopusArticleByDoi(doi: string): Promise<ScopusArticle | null> {
  if (!SCOPUS_API_KEY) return null;

  try {
    const doiController = new AbortController();
    const doiTimer = setTimeout(() => doiController.abort(), 15000);
    const response = await fetch(
      `https://api.elsevier.com/content/abstract/doi/${encodeURIComponent(doi)}`,
      {
        headers: {
          "X-ELS-APIKey": SCOPUS_API_KEY,
          "Accept": "application/json"
        },
        signal: doiController.signal,
      }
    );
    clearTimeout(doiTimer);

    if (!response.ok) return null;

    const data = await response.json();
    const coredata = data["abstracts-retrieval-response"]?.coredata;

    if (!coredata) return null;

    return {
      title: coredata["dc:title"] || "",
      authors: coredata["dc:creator"]?.map((a: any) => a["$"]).join(", ") || "",
      publicationName: coredata["prism:publicationName"] || "",
      year: coredata["prism:coverDate"]?.split("-")[0] || "",
      doi: coredata["prism:doi"] || doi,
      citedByCount: parseInt(coredata["citedby-count"] || "0"),
      abstract: coredata["dc:description"] || "",
      url: `https://doi.org/${doi}`,
      scopusId: coredata["dc:identifier"]?.replace("SCOPUS_ID:", "") || ""
    };
  } catch (error) {
    console.error("[Scopus] Error fetching article by DOI:", error);
    return null;
  }
}
