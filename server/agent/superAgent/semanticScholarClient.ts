import { AcademicCandidate } from "./openAlexClient";
import { sanitizeSearchQuery } from "../../lib/textSanitizers";

const S2_API_BASE = "https://api.semanticscholar.org/graph/v1";
const RATE_LIMIT_MS = 1000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const FETCH_TIMEOUT_MS = 15000;

/**
 * Sanitize and harden Semantic Scholar search query input
 */
function sanitizeS2Query(raw: string): string {
  return sanitizeSearchQuery(raw, 500);
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

async function fetchWithRetry(url: string, retries: number = MAX_RETRIES): Promise<Response | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await rateLimit();
      
      const controller = new AbortController();
      const fetchTimer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(fetchTimer);

      if (response.ok) {
        return response;
      }

      if (response.status === 429) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
        console.log(`[SemanticScholar] Rate limited, waiting ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      if (response.status >= 500) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt);
        console.log(`[SemanticScholar] Server error ${response.status}, retry ${attempt + 1}/${retries}...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      console.error(`[SemanticScholar] API error: ${response.status}`);
      return null;
    } catch (error: any) {
      console.error(`[SemanticScholar] Request error: ${error.message}`);
      if (attempt < retries) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }
  return null;
}

interface S2Paper {
  paperId: string;
  externalIds?: {
    DOI?: string;
  };
  title: string;
  abstract?: string;
  year?: number;
  venue?: string;
  authors?: Array<{
    name: string;
    affiliations?: string[];
  }>;
  citationCount?: number;
  fieldsOfStudy?: string[];
  publicationTypes?: string[];
  openAccessPdf?: {
    url: string;
  };
}

function mapS2ToCandidate(paper: S2Paper): AcademicCandidate {
  const doi = paper.externalIds?.DOI || "";
  
  const affiliations: string[] = [];
  const authors: string[] = [];
  for (const author of paper.authors || []) {
    authors.push(author.name);
    if (author.affiliations) {
      affiliations.push(...author.affiliations);
    }
  }

  return {
    source: "semantic_scholar" as const,
    sourceId: paper.paperId,
    doi,
    title: paper.title || "",
    year: paper.year || 0,
    journal: paper.venue || "Unknown",
    abstract: paper.abstract || "",
    authors,
    keywords: paper.fieldsOfStudy || [],
    language: "en",
    documentType: paper.publicationTypes?.[0] || "article",
    citationCount: paper.citationCount || 0,
    affiliations,
    city: "Unknown",
    country: "Unknown",
    landingUrl: paper.openAccessPdf?.url || "",
    doiUrl: doi ? `https://doi.org/${doi}` : "",
    verified: false,
    relevanceScore: 0,
    verificationStatus: "pending" as const,
  };
}

export async function searchSemanticScholar(
  query: string,
  options: {
    yearStart?: number;
    yearEnd?: number;
    maxResults?: number;
  } = {}
): Promise<AcademicCandidate[]> {
  const currentYear = new Date().getFullYear();
  const { yearStart = 2020, yearEnd = currentYear, maxResults = 100 } = options;
  const clampedMax = Math.max(1, Math.min(100, maxResults));
  const clampedYearStart = Math.max(1900, Math.min(currentYear + 1, yearStart));
  const clampedYearEnd = Math.max(clampedYearStart, Math.min(currentYear + 1, yearEnd));

  // Sanitize query input
  const sanitized = sanitizeS2Query(query);
  if (!sanitized) {
    console.warn("[SemanticScholar] Empty query after sanitization");
    return [];
  }

  const fields = "paperId,externalIds,title,abstract,year,venue,authors,citationCount,fieldsOfStudy,publicationTypes,openAccessPdf";

  const params = new URLSearchParams({
    query: sanitized,
    fields,
    limit: String(clampedMax),
    year: `${clampedYearStart}-${clampedYearEnd}`,
  });

  const url = `${S2_API_BASE}/paper/search?${params}`;
  console.log(`[SemanticScholar] Searching: ${query.substring(0, 50)}...`);

  try {
    const response = await fetchWithRetry(url);
    
    if (!response) {
      console.error(`[SemanticScholar] Search failed after retries`);
      return [];
    }

    const data = await response.json();
    const papers = data.data || [];
    
    console.log(`[SemanticScholar] Found ${papers.length} results from ${data.total || 0} total`);

    return papers.map(mapS2ToCandidate);
  } catch (error: any) {
    console.error(`[SemanticScholar] Search error: ${error.message}`);
    return [];
  }
}

export async function searchSemanticScholarMultiple(
  queries: string[],
  options: {
    yearStart?: number;
    yearEnd?: number;
    maxResults?: number;
  } = {}
): Promise<AcademicCandidate[]> {
  const allCandidates: AcademicCandidate[] = [];
  const seenIds = new Set<string>();

  for (const query of queries) {
    try {
      const candidates = await searchSemanticScholar(query, options);
      
      for (const candidate of candidates) {
        const key = candidate.doi || candidate.sourceId;
        if (!seenIds.has(key)) {
          seenIds.add(key);
          allCandidates.push(candidate);
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1100));
    } catch (error: any) {
      console.error(`[SemanticScholar] Query "${query}" failed: ${error.message}`);
    }
  }

  return allCandidates;
}
