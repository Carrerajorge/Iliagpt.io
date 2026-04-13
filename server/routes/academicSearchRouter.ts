/**
 * Academic Search Routes
 * Unified API for multiple academic databases:
 * - Scopus, SciELO, PubMed, Google Scholar, DuckDuckGo, Web of Science
 *
 * All routes include input validation and sanitization at the API boundary.
 */

import { Router } from "express";
import {
  searchAllSources,
  searchScopus,
  searchScielo,
  searchPubMed,
  searchScholar,
  searchDuckDuckGo,
  searchWOS,
  searchOpenAlex,
  searchCORE,
  searchArXiv,
  searchDOAJ,
  searchBASE,
  getSourcesStatus,
  AcademicResult
} from "../services/unifiedAcademicSearch";
import { sanitizePlainText, sanitizeSearchQuery } from "../lib/textSanitizers";
import { lookupUnpaywallByDoi } from "../services/unpayWallSearch";
import {
  getForwardCitations,
  getReferences,
  getBulkCitationCounts,
  expandCitationNetwork,
} from "../agent/superAgent/openCitationsClient";

export const academicSearchRouter = Router();

// =============================================================================
// Route-level input validation & sanitization
// =============================================================================

const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS_LIMIT = 100;
const VALID_SOURCES = [
  "scopus",
  "pubmed",
  "scholar",
  "scielo",
  "semantic",
  "crossref",
  "duckduckgo",
  "wos",
  "openalex",
  "core",
  "arxiv",
  "doaj",
  "base"
];

/**
 * Validate and sanitize search query at the API boundary.
 * Returns sanitized query or null if invalid.
 */
function validateQuery(raw: any): { valid: true; query: string } | { valid: false; error: string } {
  if (!raw || typeof raw !== "string") {
    return { valid: false, error: "query is required and must be a string" };
  }

  let q = sanitizeSearchQuery(raw, MAX_QUERY_LENGTH);

  if (q.length === 0) {
    return { valid: false, error: "query cannot be empty" };
  }
  if (q.length < 2) {
    return { valid: false, error: "query must be at least 2 characters" };
  }

  return { valid: true, query: q };
}

/**
 * Validate maxResults parameter
 */
function validateMaxResults(raw: any): number {
  const num = parseInt(String(raw), 10);
  if (isNaN(num) || num < 1) return 10;
  return Math.min(num, MAX_RESULTS_LIMIT);
}

/**
 * Validate year parameter (must be 1900-current+1)
 */
function validateYear(raw: any): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const num = parseInt(String(raw), 10);
  if (isNaN(num)) return undefined;
  const currentYear = new Date().getFullYear();
  return Math.max(1900, Math.min(currentYear + 1, num));
}

/**
 * Validate sources array
 */
function validateSources(raw: any): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((s: any) => typeof s === "string" && VALID_SOURCES.includes(s.toLowerCase()));
}

function getLanguage(body: any): string | undefined {
  return typeof body?.language === "string" ? body.language.substring(0, 10) : undefined;
}

function validateDoi(raw: any): { valid: true; doi: string } | { valid: false; error: string } {
  if (!raw || typeof raw !== "string") {
    return { valid: false, error: "doi is required and must be a string" };
  }

  const doi = sanitizePlainText(raw, { maxLen: 300, collapseWs: true })
    .trim()
    .replace(/^https?:\/\/doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .trim();

  if (!doi) {
    return { valid: false, error: "doi cannot be empty" };
  }

  if (!/^10\.\S+\/\S+$/i.test(doi)) {
    return { valid: false, error: "doi must be a valid DOI" };
  }

  return { valid: true, doi };
}

function createSourceHandler(
  source: string,
  searchFn: (query: string, options?: any) => Promise<AcademicResult[]>,
  buildOptions?: (body: any) => Record<string, unknown>,
) {
  return async (req: any, res: any) => {
    try {
      const queryResult = validateQuery(req.body?.query);
      if (!queryResult.valid) return res.status(400).json({ error: queryResult.error });

      const maxResults = validateMaxResults(req.body?.maxResults);
      const results = await searchFn(queryResult.query, {
        maxResults,
        ...(buildOptions ? buildOptions(req.body) : {}),
      });

      res.json({ query: queryResult.query, source, totalResults: results.length, results });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}

// GET /api/academic/status - Check which sources are available
academicSearchRouter.get("/status", async (req, res) => {
  try {
    const sources = getSourcesStatus();
    const available = Object.entries(sources)
      .filter(([_, v]) => v.available)
      .map(([k]) => k);

    res.json({
      totalSources: Object.keys(sources).length,
      availableSources: available.length,
      sources
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/search - Search all available sources
academicSearchRouter.post("/search", async (req, res) => {
  try {
    const queryResult = validateQuery(req.body?.query);
    if (!queryResult.valid) {
      return res.status(400).json({ error: queryResult.error });
    }

    const maxResults = validateMaxResults(req.body?.maxResults);
    const sources = validateSources(req.body?.sources);
    const yearFrom = validateYear(req.body?.yearFrom);
    const yearTo = validateYear(req.body?.yearTo);
    const language = typeof req.body?.language === "string" ? req.body.language.substring(0, 10) : undefined;
    const openAccessOnly = Boolean(req.body?.openAccessOnly);
    const sortBy = req.body?.sortBy === "citations" || req.body?.sortBy === "date" || req.body?.sortBy === "trending"
      ? req.body.sortBy
      : "relevance";

    console.log(`[Academic] Unified search: "${queryResult.query}" | sources: ${sources?.join(",") || "all"}`);

    const result = await searchAllSources(queryResult.query, {
      maxResults,
      sources,
      yearFrom,
      yearTo,
      language,
      openAccessOnly,
      sortBy,
    });

    res.json(result);
  } catch (error: any) {
    console.error("[Academic] Search error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/scopus - Search Scopus only
academicSearchRouter.post("/scopus", createSourceHandler("scopus", searchScopus));

// POST /api/academic/scielo - Search SciELO only
academicSearchRouter.post("/scielo", createSourceHandler("scielo", searchScielo, (body) => ({
  language: getLanguage(body) || "es"
})));

// POST /api/academic/pubmed - Search PubMed only
academicSearchRouter.post("/pubmed", createSourceHandler("pubmed", searchPubMed));

// POST /api/academic/scholar - Search Google Scholar only
academicSearchRouter.post("/scholar", createSourceHandler("scholar", searchScholar));

// POST /api/academic/duckduckgo - Search DuckDuckGo only
academicSearchRouter.post("/duckduckgo", createSourceHandler("duckduckgo", searchDuckDuckGo));

// POST /api/academic/wos - Search Web of Science only
academicSearchRouter.post("/wos", createSourceHandler("wos", searchWOS));
academicSearchRouter.post("/openalex", createSourceHandler("openalex", searchOpenAlex, (body) => ({
  language: getLanguage(body),
  yearFrom: validateYear(body?.yearFrom),
  yearTo: validateYear(body?.yearTo),
  openAccessOnly: Boolean(body?.openAccessOnly),
})));
academicSearchRouter.post("/core", createSourceHandler("core", searchCORE, (body) => ({
  language: getLanguage(body),
  yearFrom: validateYear(body?.yearFrom),
  yearTo: validateYear(body?.yearTo),
  openAccessOnly: Boolean(body?.openAccessOnly),
})));
academicSearchRouter.post("/arxiv", createSourceHandler("arxiv", searchArXiv, (body) => ({
  language: getLanguage(body),
  yearFrom: validateYear(body?.yearFrom),
  yearTo: validateYear(body?.yearTo),
  openAccessOnly: Boolean(body?.openAccessOnly),
})));
academicSearchRouter.post("/doaj", createSourceHandler("doaj", searchDOAJ, (body) => ({
  language: getLanguage(body),
  yearFrom: validateYear(body?.yearFrom),
  yearTo: validateYear(body?.yearTo),
  openAccessOnly: Boolean(body?.openAccessOnly),
})));
academicSearchRouter.post("/base", createSourceHandler("base", searchBASE, (body) => ({
  language: getLanguage(body),
  openAccessOnly: Boolean(body?.openAccessOnly),
})));

academicSearchRouter.post("/unpaywall", async (req, res) => {
  try {
    const doiResult = validateDoi(req.body?.doi);
    if (!doiResult.valid) {
      return res.status(400).json({ error: doiResult.error });
    }

    const lookup = await lookupUnpaywallByDoi(doiResult.doi);
    if (!lookup) {
      return res.status(404).json({ error: "No open access record found for DOI", doi: doiResult.doi });
    }

    return res.json({
      doi: doiResult.doi,
      ...lookup,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/cite - Generate citation from result
academicSearchRouter.post("/cite", async (req, res) => {
  try {
    const { article, style = "apa" } = req.body;

    if (!article || typeof article !== "object" || !article.title || typeof article.title !== "string") {
      return res.status(400).json({ error: "article with a valid title string is required" });
    }

    // Sanitize input fields
    const cleanTitle = sanitizePlainText(String(article.title), { maxLen: 500 });
    const cleanAuthors = sanitizePlainText(String(article.authors || "Unknown"), { maxLen: 1000 });
    const cleanYear = String(article.year || "n.d.").replace(/[^0-9n.d.]/g, "").substring(0, 10);
    const cleanJournal = sanitizePlainText(String(article.journal || ""), { maxLen: 300 });
    const cleanDoi = article.doi ? sanitizePlainText(String(article.doi), { maxLen: 200, collapseWs: true }) : "";

    const doiPart = cleanDoi ? ` 🔗 https://doi.org/${cleanDoi}` : "";
    const citation = `${cleanAuthors} (${cleanYear}). ${cleanTitle}. ${cleanJournal}.${doiPart}`;

    res.json({
      style,
      citation,
      article: {
        title: cleanTitle,
        authors: cleanAuthors,
        year: cleanYear,
        journal: cleanJournal,
        doi: cleanDoi
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// OpenCitations endpoints (2B+ citation records, CC0, no auth required)
// =============================================================================

// GET /api/academic/citations/:doi - Forward citations for a DOI (who cites this paper)
academicSearchRouter.get("/citations/:doi", async (req, res) => {
  try {
    const rawDoi = decodeURIComponent(req.params.doi).trim();
    if (!rawDoi) return res.status(400).json({ error: "doi is required" });
    const doi = sanitizePlainText(rawDoi, { maxLen: 300 });
    const citations = await getForwardCitations(doi);
    res.json({ doi, count: citations.length, citations });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/academic/references/:doi - References of a DOI (what this paper cites)
academicSearchRouter.get("/references/:doi", async (req, res) => {
  try {
    const rawDoi = decodeURIComponent(req.params.doi).trim();
    if (!rawDoi) return res.status(400).json({ error: "doi is required" });
    const doi = sanitizePlainText(rawDoi, { maxLen: 300 });
    const references = await getReferences(doi);
    res.json({ doi, count: references.length, references });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/academic/citation-network/:doi - Full citation network expansion (forward + backward)
academicSearchRouter.get("/citation-network/:doi", async (req, res) => {
  try {
    const rawDoi = decodeURIComponent(req.params.doi).trim();
    if (!rawDoi) return res.status(400).json({ error: "doi is required" });
    const doi = sanitizePlainText(rawDoi, { maxLen: 300 });
    const network = await expandCitationNetwork(doi);
    res.json(network);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/citation-counts - Bulk citation counts for multiple DOIs
academicSearchRouter.post("/citation-counts", async (req, res) => {
  try {
    const { dois } = req.body;
    if (!Array.isArray(dois) || dois.length === 0) {
      return res.status(400).json({ error: "dois array is required" });
    }
    const cleanDois = dois
      .map((d: any) => sanitizePlainText(String(d), { maxLen: 300 }))
      .filter(Boolean)
      .slice(0, 50);
    const counts = await getBulkCitationCounts(cleanDois);
    const result = Object.fromEntries(counts);
    res.json({ counts: result, total: counts.size });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/academic/quick/:query - Quick search all sources
academicSearchRouter.get("/quick/:query", async (req, res) => {
  try {
    const rawQuery = decodeURIComponent(req.params.query);
    const queryResult = validateQuery(rawQuery);
    if (!queryResult.valid) return res.status(400).json({ error: queryResult.error });
    const maxResults = validateMaxResults(req.query.max);

    const result = await searchAllSources(queryResult.query, { maxResults });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
