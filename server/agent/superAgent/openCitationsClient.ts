/**
 * OpenCitations API Client
 *
 * 2B+ citation relationships, CC0 license, no authentication required.
 * Endpoints: https://opencitations.net/index/api/v2/
 *
 * Used for:
 *  - Enriching articles with citation counts from COCI/POCI/DOCI indices
 *  - Fetching forward citations (who cites this DOI)
 *  - Fetching backward references (what this DOI cites)
 *  - Bibliometric analysis and citation network expansion
 */

import { persistentJsonCacheGet, persistentJsonCacheSet } from "../../lib/persistentJsonCache";

const OPENCITATIONS_BASE = "https://opencitations.net/index/api/v2";
const RATE_LIMIT_MS = 250;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — citation counts are stable

export interface OpenCitationRecord {
  oci: string;
  citing: string;
  cited: string;
  creation: string;
  timespan: string;
  journal_sc: string;
  author_sc: string;
}

export interface OpenCitationMetadata {
  id: string;
  title: string;
  author: string;
  year: string;
  source_title: string;
  volume: string;
  issue: string;
  page: string;
  doi: string;
  reference: string;
  citation_count: string;
  citation: string;
}

export interface CitationEnrichment {
  doi: string;
  citingCount: number;
  referenceCount: number;
  citingDois: string[];
  referenceDois: string[];
  source: "opencitations";
}

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/doi\.org\//i, "")
    .replace(/^doi:/i, "");
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<any[] | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await rateLimit();
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "IliaGPT/1.0 (mailto:carrerajorge874@gmail.com)",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (response.ok) {
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      }

      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 200;
        console.warn(`[OpenCitations] HTTP ${response.status}, retry ${attempt + 1}/${retries} in ${Math.round(backoff)}ms`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }

      console.warn(`[OpenCitations] HTTP ${response.status} for ${url}`);
      return null;
    } catch (err: any) {
      if (attempt < retries) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 200;
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      console.error(`[OpenCitations] Fetch error: ${err.message}`);
      return null;
    }
  }
  return null;
}

/**
 * Get all forward citations for a DOI (papers that cite this article).
 * Returns citation records from COCI index.
 */
export async function getForwardCitations(doi: string): Promise<OpenCitationRecord[]> {
  const clean = normalizeDoi(doi);
  if (!clean) return [];

  const cacheKey = `opencitations:citations:${clean}`;
  const cached = await persistentJsonCacheGet<OpenCitationRecord[]>(cacheKey);
  if (cached !== null) return cached;

  const url = `${OPENCITATIONS_BASE}/citations/${encodeURIComponent(clean)}`;
  const data = await fetchWithRetry(url);
  const result = (data as OpenCitationRecord[]) || [];

  await persistentJsonCacheSet(cacheKey, result, DEFAULT_CACHE_TTL_MS);
  return result;
}

/**
 * Get all references cited by a DOI (papers this article cites).
 * Returns citation records from COCI index.
 */
export async function getReferences(doi: string): Promise<OpenCitationRecord[]> {
  const clean = normalizeDoi(doi);
  if (!clean) return [];

  const cacheKey = `opencitations:references:${clean}`;
  const cached = await persistentJsonCacheGet<OpenCitationRecord[]>(cacheKey);
  if (cached !== null) return cached;

  const url = `${OPENCITATIONS_BASE}/references/${encodeURIComponent(clean)}`;
  const data = await fetchWithRetry(url);
  const result = (data as OpenCitationRecord[]) || [];

  await persistentJsonCacheSet(cacheKey, result, DEFAULT_CACHE_TTL_MS);
  return result;
}

/**
 * Get metadata for one or more DOIs from OpenCitations.
 * Supports bulk lookups (up to ~50 DOIs separated by "__").
 */
export async function getMetadata(dois: string[]): Promise<OpenCitationMetadata[]> {
  if (dois.length === 0) return [];

  const cleanDois = dois.map(normalizeDoi).filter(Boolean);
  const cacheKey = `opencitations:meta:${cleanDois.sort().join("|")}`;
  const cached = await persistentJsonCacheGet<OpenCitationMetadata[]>(cacheKey);
  if (cached !== null) return cached;

  const bulk = cleanDois.join("__");
  const url = `${OPENCITATIONS_BASE}/metadata/${encodeURIComponent(bulk)}`;
  const data = await fetchWithRetry(url);
  const result = (data as OpenCitationMetadata[]) || [];

  await persistentJsonCacheSet(cacheKey, result, DEFAULT_CACHE_TTL_MS);
  return result;
}

/**
 * Get citation count for a single DOI (lightweight — only returns the count).
 */
export async function getCitationCount(doi: string): Promise<number> {
  const citations = await getForwardCitations(doi);
  return citations.length;
}

/**
 * Enrich a list of articles that have DOIs with citation data from OpenCitations.
 * Runs in parallel with a concurrency limit to respect rate limiting.
 *
 * @param articles - Array of objects with at least a `doi` field
 * @param maxEnrich - Max number of articles to enrich (default 20, to avoid long waits)
 */
export async function enrichWithCitations<T extends { doi?: string; citationCount?: number }>(
  articles: T[],
  maxEnrich = 20
): Promise<(T & { openCitationsCount?: number; citingDois?: string[] })[]> {
  const toEnrich = articles.filter(a => !!a.doi).slice(0, maxEnrich);

  const results = await Promise.allSettled(
    toEnrich.map(async article => {
      const citations = await getForwardCitations(article.doi!);
      return {
        ...article,
        openCitationsCount: citations.length,
        citingDois: citations
          .map(c => {
            const raw = c.citing || "";
            return raw.replace(/^doi:/i, "");
          })
          .filter(Boolean)
          .slice(0, 50),
      };
    })
  );

  const enrichedMap = new Map<string, any>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      enrichedMap.set(toEnrich[i].doi!, r.value);
    }
  });

  return articles.map(article => {
    if (article.doi && enrichedMap.has(article.doi)) {
      return enrichedMap.get(article.doi);
    }
    return article;
  });
}

/**
 * Expand a citation network from a seed DOI.
 * Returns all DOIs that cite the seed (forward) and all DOIs the seed cites (backward).
 * Useful for finding related literature via citation graph traversal.
 */
export async function expandCitationNetwork(doi: string): Promise<{
  seed: string;
  forwardDois: string[];
  backwardDois: string[];
  totalConnections: number;
}> {
  const [forward, backward] = await Promise.all([
    getForwardCitations(doi),
    getReferences(doi),
  ]);

  const forwardDois = forward
    .map(c => c.citing.replace(/^doi:/i, ""))
    .filter(Boolean);

  const backwardDois = backward
    .map(c => c.cited.replace(/^doi:/i, ""))
    .filter(Boolean);

  return {
    seed: doi,
    forwardDois,
    backwardDois,
    totalConnections: forwardDois.length + backwardDois.length,
  };
}

/**
 * Get citation counts for multiple DOIs in bulk using the metadata endpoint.
 * Much faster than calling getCitationCount() for each DOI individually.
 */
export async function getBulkCitationCounts(dois: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (dois.length === 0) return result;

  const CHUNK_SIZE = 30;
  const chunks: string[][] = [];
  for (let i = 0; i < dois.length; i += CHUNK_SIZE) {
    chunks.push(dois.slice(i, i + CHUNK_SIZE));
  }

  for (const chunk of chunks) {
    try {
      const metadata = await getMetadata(chunk);
      for (const meta of metadata) {
        if (meta.doi && meta.citation_count) {
          const clean = normalizeDoi(meta.doi);
          const count = parseInt(meta.citation_count, 10);
          if (!isNaN(count)) {
            result.set(clean, count);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[OpenCitations] Bulk metadata chunk failed: ${err.message}`);
    }
  }

  return result;
}
