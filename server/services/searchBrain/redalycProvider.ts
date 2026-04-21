/**
 * Redalyc provider — Latin American open-access academic portal.
 *
 * Redalyc does NOT expose a JSON API. This provider scrapes the public
 * search results page:
 *   https://www.redalyc.org/busquedaArticuloFiltros.oa?q={query}
 *
 * Scraping is intentionally tolerant: if the markup shifts we return
 * `[]` rather than crash, and the orchestrator records an empty trace.
 * This keeps the overall fan-out resilient when one provider breaks.
 *
 * The scrape respects a low request ceiling (per-call timeout, single
 * page) and identifies itself with a descriptive User-Agent so the
 * Redalyc ops team can contact us if something breaks.
 *
 * Returns AcademicResult so it fits the `unifiedAcademicSearch` output
 * shape the provider adapter expects — makes translation into
 * SearchBrain's NormalisedResult a one-liner.
 */

import { load as cheerioLoad } from "cheerio";
import type { AcademicResult } from "../unifiedAcademicSearch";

const REDALYC_BASE = "https://www.redalyc.org";
const USER_AGENT = "IliaGPT-SearchBrain/1.0 (+https://iliagpt.io; responsible academic scraping)";

export interface RedalycOptions {
  query: string;
  maxResults?: number;
  timeoutMs?: number;
}

/**
 * Search Redalyc. Returns AcademicResult[] compatible with the rest of
 * the unifiedAcademicSearch contract.
 */
export async function searchRedalyc(options: RedalycOptions): Promise<AcademicResult[]> {
  const { query } = options;
  const maxResults = options.maxResults ?? 20;
  const timeoutMs = options.timeoutMs ?? 8000;

  if (!query || typeof query !== "string" || query.trim().length === 0) return [];

  const searchUrl = `${REDALYC_BASE}/busquedaArticuloFiltros.oa?q=${encodeURIComponent(query)}`;
  const html = await fetchWithTimeout(searchUrl, timeoutMs);
  if (!html) return [];

  return parseRedalycHtml(html, maxResults);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.5",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.text();
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function parseRedalycHtml(html: string, maxResults: number): AcademicResult[] {
  const $ = cheerioLoad(html);
  const results: AcademicResult[] = [];

  // Redalyc wraps each hit in an element carrying `.resultado` or a
  // legacy `.articulo-resultado`. We keep both so the scraper survives
  // small markup shifts.
  const nodes = $(".resultado, .articulo-resultado, article.resultado-busqueda");
  nodes.each((_, el) => {
    if (results.length >= maxResults) return;
    const node = $(el);

    const titleEl = node.find("h2 a, .titulo a, a.titulo-articulo").first();
    const title = cleanText(titleEl.text());
    const relativeUrl = titleEl.attr("href") || "";
    if (!title || !relativeUrl) return;

    const url = relativeUrl.startsWith("http")
      ? relativeUrl
      : `${REDALYC_BASE}${relativeUrl.startsWith("/") ? "" : "/"}${relativeUrl}`;

    const authors = cleanText(
      node.find(".autores, .autor, .author-list, .meta-autores").first().text()
    );
    const journal = cleanText(
      node.find(".revista, .journal, .meta-revista").first().text()
    );
    const yearMatch = node.find(".anio, .year, .meta-anio").first().text().match(/\d{4}/);
    const year = yearMatch ? yearMatch[0] : "";

    const doiNode = node.find("a[href*='doi.org']").first();
    const doi = doiNode.length
      ? extractDoi(doiNode.attr("href") ?? "")
      : undefined;

    const pdfAnchor = node.find("a[href*='.pdf']").first();
    const pdfUrl = pdfAnchor.length
      ? normaliseUrl(pdfAnchor.attr("href") ?? "")
      : undefined;

    const abstract = cleanText(
      node.find(".resumen, .abstract, .meta-resumen").first().text()
    );

    results.push({
      title,
      authors,
      year,
      journal: journal || undefined,
      doi,
      url,
      pdfUrl,
      abstract: abstract || undefined,
      source: "scielo", // Redalyc overlaps geographically with SciELO's LatAm coverage; source tag is informational
      openAccess: true,
      documentType: "article",
      language: "es",
    });
  });

  return results;
}

function cleanText(s: string | undefined): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

function normaliseUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("http")) return url;
  return `${REDALYC_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

function extractDoi(href: string): string | undefined {
  const m = href.match(/10\.\d{4,9}\/[^?#\s]+/);
  return m ? m[0] : undefined;
}

export const REDALYC_INTERNAL = {
  extractDoi,
  normaliseUrl,
  cleanText,
};
