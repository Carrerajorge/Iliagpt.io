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
  getSourcesStatus,
  AcademicResult
} from "../services/unifiedAcademicSearch";
import { sanitizePlainText, sanitizeSearchQuery } from "../lib/textSanitizers";

export const academicSearchRouter = Router();

// =============================================================================
// Route-level input validation & sanitization
// =============================================================================

const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS_LIMIT = 100;
const VALID_SOURCES = ["scopus", "pubmed", "scholar", "scielo", "semantic", "crossref", "duckduckgo", "wos"];

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

    console.log(`[Academic] Unified search: "${queryResult.query}" | sources: ${sources?.join(",") || "all"}`);

    const result = await searchAllSources(queryResult.query, {
      maxResults,
      sources,
      yearFrom,
      yearTo,
      language
    });

    res.json(result);
  } catch (error: any) {
    console.error("[Academic] Search error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/scopus - Search Scopus only
academicSearchRouter.post("/scopus", async (req, res) => {
  try {
    const queryResult = validateQuery(req.body?.query);
    if (!queryResult.valid) return res.status(400).json({ error: queryResult.error });
    const maxResults = validateMaxResults(req.body?.maxResults);

    const results = await searchScopus(queryResult.query, { maxResults });

    res.json({ query: queryResult.query, source: "scopus", totalResults: results.length, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/scielo - Search SciELO only
academicSearchRouter.post("/scielo", async (req, res) => {
  try {
    const queryResult = validateQuery(req.body?.query);
    if (!queryResult.valid) return res.status(400).json({ error: queryResult.error });
    const maxResults = validateMaxResults(req.body?.maxResults);
    const language = typeof req.body?.language === "string" ? req.body.language.substring(0, 10) : "es";

    const results = await searchScielo(queryResult.query, { maxResults, language });

    res.json({ query: queryResult.query, source: "scielo", totalResults: results.length, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/pubmed - Search PubMed only
academicSearchRouter.post("/pubmed", async (req, res) => {
  try {
    const queryResult = validateQuery(req.body?.query);
    if (!queryResult.valid) return res.status(400).json({ error: queryResult.error });
    const maxResults = validateMaxResults(req.body?.maxResults);

    const results = await searchPubMed(queryResult.query, { maxResults });

    res.json({ query: queryResult.query, source: "pubmed", totalResults: results.length, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/scholar - Search Google Scholar only
academicSearchRouter.post("/scholar", async (req, res) => {
  try {
    const queryResult = validateQuery(req.body?.query);
    if (!queryResult.valid) return res.status(400).json({ error: queryResult.error });
    const maxResults = validateMaxResults(req.body?.maxResults);

    const results = await searchScholar(queryResult.query, { maxResults });

    res.json({ query: queryResult.query, source: "scholar", totalResults: results.length, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/duckduckgo - Search DuckDuckGo only
academicSearchRouter.post("/duckduckgo", async (req, res) => {
  try {
    const queryResult = validateQuery(req.body?.query);
    if (!queryResult.valid) return res.status(400).json({ error: queryResult.error });
    const maxResults = validateMaxResults(req.body?.maxResults);

    const results = await searchDuckDuckGo(queryResult.query, { maxResults });

    res.json({ query: queryResult.query, source: "duckduckgo", totalResults: results.length, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/wos - Search Web of Science only
academicSearchRouter.post("/wos", async (req, res) => {
  try {
    const queryResult = validateQuery(req.body?.query);
    if (!queryResult.valid) return res.status(400).json({ error: queryResult.error });
    const maxResults = validateMaxResults(req.body?.maxResults);

    const results = await searchWOS(queryResult.query, { maxResults });

    res.json({ query: queryResult.query, source: "wos", totalResults: results.length, results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
