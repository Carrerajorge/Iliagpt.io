/**
 * Unified Scientific Article Search
 *
 * Combines Scopus, PubMed, SciELO, Redalyc, OpenAlex, WoS, and DuckDuckGo
 * for comprehensive scientific literature search with APA 7th Edition citation generation.
 *
 * Features:
 * - Parallel source querying with per-source timeouts
 * - Fuzzy deduplication (DOI + Levenshtein title similarity)
 * - Cross-source field enrichment
 * - Multi-factor relevance ranking
 */

import { searchScopus, ScopusArticle, isScopusConfigured } from "./scopusClient";
import { searchPubMed, PubMedArticle, generatePubMedAPA7Citation, isPubMedConfigured } from "./pubmedClient";
import { searchSciELO, SciELOArticle, generateSciELOAPA7Citation, isSciELOConfigured } from "./scieloClient";
import { searchRedalyc, RedalycArticle, generateRedalycAPA7Citation, isRedalycConfigured } from "./redalycClient";
import { searchOpenAlex, type AcademicCandidate } from "./openAlexClient";
import { lookupDOI, type CrossRefMetadata } from "./crossrefClient";
import { searchWos, type WosArticle, isWosConfigured } from "./wosClient";
import * as XLSX from "xlsx";
import { sanitizePlainText, sanitizeSearchQuery, sanitizeHttpUrl } from "../../lib/textSanitizers";

const PER_SOURCE_TIMEOUT_MS = 30_000;

// Source priority for ranking (higher = more trusted)
const SOURCE_PRIORITY: Record<string, number> = {
    scopus: 10,
    wos: 9,
    pubmed: 8,
    openalex: 6,
    scielo: 7,
    redalyc: 6,
    duckduckgo: 3,
};

/**
 * Wrap a promise with a timeout. If the source doesn't respond in time,
 * resolve with empty result instead of blocking the entire search.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
    return Promise.race([
        promise,
        new Promise<null>((resolve) => {
            setTimeout(() => {
                console.warn(`[UnifiedSearch] ${label} timed out after ${ms}ms`);
                resolve(null);
            }, ms);
        }),
    ]);
}

/**
 * Compute Levenshtein distance between two strings (for fuzzy title dedup).
 * Optimized: short-circuits if distance exceeds maxDist.
 */
function levenshteinDistance(a: string, b: string, maxDist: number = 20): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;

    const lenA = a.length;
    const lenB = b.length;
    let prev = new Array(lenB + 1);
    let curr = new Array(lenB + 1);

    for (let j = 0; j <= lenB; j++) prev[j] = j;

    for (let i = 1; i <= lenA; i++) {
        curr[0] = i;
        let minInRow = i;
        for (let j = 1; j <= lenB; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
            if (curr[j] < minInRow) minInRow = curr[j];
        }
        if (minInRow > maxDist) return maxDist + 1;
        [prev, curr] = [curr, prev];
    }

    return prev[lenB];
}

// =============================================================================
// Types
// =============================================================================

export type ArticleField =
    | "authors"
    | "title"
    | "year"
    | "publicationDate"
    | "journal"
    | "abstract"
    | "keywords"
    | "language"
    | "documentType"
    | "doi"
    | "url"
    | "volume"
    | "issue"
    | "pages"
    | "city"
    | "country";

export type FieldProvenanceSource =
    | "scopus"
    | "wos"
    | "openalex"
    | "duckduckgo"
    | "pubmed"
    | "scielo"
    | "redalyc"
    | "crossref"
    | "generated"
    | "inferred"
    | "unknown";

export interface FieldProvenance {
    source: FieldProvenanceSource;
    confidence: number; // 0..1
    note?: string;
}

export interface UnifiedArticle {
    id: string;
    source: "scopus" | "wos" | "openalex" | "duckduckgo" | "pubmed" | "scielo" | "redalyc";
    title: string;
    authors: string[];
    year: string;
    publicationDate?: string;
    journal: string;
    abstract: string;
    keywords: string[];
    doi?: string;
    url: string;
    volume?: string;
    issue?: string;
    pages?: string;
    language: string;
    documentType?: string;
    city?: string;
    country?: string;
    institutionCountryCodes?: string[];
    primaryInstitutionCountryCode?: string;
    citationCount?: number;
    apaCitation: string;
    fieldProvenance?: Partial<Record<ArticleField, FieldProvenance>>;
}

export interface UnifiedSearchResult {
    articles: UnifiedArticle[];
    totalBySource: {
        scopus: number;
        wos: number;
        openalex: number;
        duckduckgo: number;
        pubmed: number;
        scielo: number;
        redalyc: number;
    };
    query: string;
    searchTime: number;
    errors: string[];
}

export interface SearchOptions {
    maxResults?: number;
    maxPerSource?: number;
    startYear?: number;
    endYear?: number;
    sources?: ("scopus" | "wos" | "openalex" | "duckduckgo" | "pubmed" | "scielo" | "redalyc")[];
    language?: string;
    // Scopus-only: filter by affiliation country (e.g. ["Spain","Mexico"]).
    // Note: SciELO/Redalyc are already LatAm-focused; PubMed doesn't reliably expose affiliation country at search time.
    affilCountries?: string[];
}

// =============================================================================
// Helper Functions
// =============================================================================

function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 100);
}

function normalizeText(text: string): string {
    return (text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function affilCountriesToOpenAlexCodes(affilCountries: string[] | undefined): string[] | undefined {
    if (!affilCountries || affilCountries.length === 0) return undefined;

    const map: Record<string, string> = {
        argentina: "AR",
        bolivia: "BO",
        brazil: "BR",
        brasil: "BR",
        chile: "CL",
        colombia: "CO",
        "costa rica": "CR",
        cuba: "CU",
        "dominican republic": "DO",
        "republica dominicana": "DO",
        "república dominicana": "DO",
        ecuador: "EC",
        "el salvador": "SV",
        guatemala: "GT",
        honduras: "HN",
        mexico: "MX",
        méxico: "MX",
        nicaragua: "NI",
        panama: "PA",
        panamá: "PA",
        paraguay: "PY",
        peru: "PE",
        perú: "PE",
        "puerto rico": "PR",
        uruguay: "UY",
        venezuela: "VE",
        spain: "ES",
        españa: "ES",
        espana: "ES",
    };

    const codes: string[] = [];
    for (const c of affilCountries) {
        const key = normalizeText(c);
        const code = map[key];
        if (code) codes.push(code);
    }

    const unique = Array.from(new Set(codes));
    return unique.length > 0 ? unique : undefined;
}

function inferCountryFromText(text: string): string | undefined {
    const t = normalizeText(text);
    if (!t) return undefined;

    const patterns: Array<[RegExp, string]> = [
        [/\b(espa(n|ñ)a|spain)\b/i, "Spain"],
        [/\b(mexico|m[eé]xico)\b/i, "Mexico"],
        [/\b(argentina)\b/i, "Argentina"],
        [/\b(chile)\b/i, "Chile"],
        [/\b(colombia)\b/i, "Colombia"],
        [/\b(peru|per[uú])\b/i, "Peru"],
        [/\b(brazil|brasil)\b/i, "Brazil"],
        [/\b(uruguay)\b/i, "Uruguay"],
        [/\b(venezuela)\b/i, "Venezuela"],
        [/\b(guatemala)\b/i, "Guatemala"],
        [/\b(honduras)\b/i, "Honduras"],
        [/\b(nicaragua)\b/i, "Nicaragua"],
        [/\b(paraguay)\b/i, "Paraguay"],
        [/\b(ecuador)\b/i, "Ecuador"],
        [/\b(bolivia)\b/i, "Bolivia"],
        [/\b(costa rica)\b/i, "Costa Rica"],
        [/\b(el salvador)\b/i, "El Salvador"],
        [/\b(panama|panam[aá])\b/i, "Panama"],
        [/\b(cuba)\b/i, "Cuba"],
        [/\b(puerto rico)\b/i, "Puerto Rico"],
        [/\b(dominican republic|rep(u|ú)blica dominicana)\b/i, "Dominican Republic"],
    ];

    for (const [re, country] of patterns) {
        if (re.test(t)) return country;
    }

    return undefined;
}

const DOI_REGEX = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi;

function extractDois(input: string): string[] {
    const text = input || "";
    const matches = text.match(DOI_REGEX) || [];
    return matches
        .map((m) => m.replace(/[\])}>,.;]+$/g, ""))
        .map((m) => m.trim())
        .filter(Boolean);
}

function extractDoiFromUrl(url: string): string | undefined {
    const u = (url || "").trim();
    if (!u) return undefined;
    const m = u.match(/doi\.org\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i);
    return m?.[1]?.trim();
}

function convertCrossRefMetadataToUnified(meta: CrossRefMetadata, source: UnifiedArticle["source"]): UnifiedArticle {
    const doi = (meta.doi || "").trim();
    const url = meta.url || (doi ? `https://doi.org/${doi}` : "");
    const year = meta.year ? String(meta.year) : "n.d.";

    return {
        id: `${source}_${doi || normalizeTitle(meta.title).slice(0, 32)}`,
        source,
        title: meta.title || "n.d.",
        authors: meta.authors || [],
        year,
        publicationDate: meta.publicationDate || undefined,
        journal: meta.journal || "n.d.",
        abstract: meta.abstract || "",
        keywords: meta.keywords || [],
        doi: doi || undefined,
        url,
        volume: meta.volume || undefined,
        issue: meta.issue || undefined,
        pages: meta.pages || undefined,
        language: meta.language || "en",
        documentType: meta.documentType || "Article",
        city: meta.city || "Unknown",
        country: meta.country || "Unknown",
        citationCount: meta.citationCount || 0,
        apaCitation: "", // Filled below by generator for non-Scopus sources
    };
}

// =============================================================================
// Search Query Hardening
// =============================================================================

/**
 * Sanitize and harden a search query to prevent injection attacks
 * and ensure robust results across all academic sources.
 * - Removes dangerous characters that could break API queries
 * - Trims excessive whitespace
 * - Limits query length to prevent abuse
 * - Strips potential script/HTML injection
 * - Normalizes unicode for consistent cross-source results
 */
function hardenSearchQuery(rawQuery: string): string {
    let query = sanitizeSearchQuery(rawQuery, 500);
    if (!query) return "";

    // 4. Remove excessive special characters that break API queries
    //    Keep: alphanumeric, spaces, hyphens, periods, commas, parentheses, quotes, colons, accented chars
    query = query.replace(/[^\w\s\-.,()'"":;áéíóúüñàèìòùâêîôûãõçÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÃÕÇ]/g, " ");

    // 5. Collapse multiple spaces into one
    query = query.replace(/\s+/g, " ").trim();

    // 6. Limit query length (most APIs have limits around 500-2000 chars)
    const MAX_QUERY_LENGTH = 500;
    if (query.length > MAX_QUERY_LENGTH) {
        query = query.substring(0, MAX_QUERY_LENGTH).trim();
    }

    // 7. Minimum query validation
    if (query.length < 2) {
        console.warn("[SearchHardening] Query too short after sanitization:", rawQuery);
        return "";
    }

    return query;
}

/**
 * Validate and clamp numeric search options
 */
function hardenSearchOptions(options: SearchOptions): SearchOptions {
    const currentYear = new Date().getFullYear();
    const hardened = { ...options };

    // Clamp maxResults
    if (hardened.maxResults !== undefined) {
        hardened.maxResults = Math.max(1, Math.min(500, hardened.maxResults));
    }
    if (hardened.maxPerSource !== undefined) {
        hardened.maxPerSource = Math.max(1, Math.min(100, hardened.maxPerSource));
    }

    // Validate year range
    if (hardened.startYear !== undefined) {
        hardened.startYear = Math.max(1900, Math.min(currentYear + 1, hardened.startYear));
    }
    if (hardened.endYear !== undefined) {
        hardened.endYear = Math.max(1900, Math.min(currentYear + 1, hardened.endYear));
    }
    if (hardened.startYear && hardened.endYear && hardened.startYear > hardened.endYear) {
        // Swap if inverted
        [hardened.startYear, hardened.endYear] = [hardened.endYear, hardened.startYear];
    }

    return hardened;
}

// =============================================================================
// Main Search Function
// =============================================================================

/**
 * Search all configured sources for scientific articles
 */
export async function searchAllSources(
    query: string,
    options: SearchOptions = {}
): Promise<UnifiedSearchResult> {
    // Harden inputs
    const sanitizedQuery = hardenSearchQuery(query);
    const sanitizedOptions = hardenSearchOptions(options);

    if (!sanitizedQuery) {
        console.error("[UnifiedSearch] Empty query after sanitization, aborting search");
        return {
            articles: [],
            totalBySource: { scopus: 0, wos: 0, openalex: 0, duckduckgo: 0, pubmed: 0, scielo: 0, redalyc: 0 },
            query: query,
            searchTime: 0,
            errors: ["Query was empty or invalid after sanitization"],
        };
    }

    const {
        maxResults = 100,
        maxPerSource = 30,
        startYear,
        endYear,
        sources = ["scopus", "openalex", "pubmed", "scielo", "redalyc"],
        language,
        affilCountries
    } = sanitizedOptions;

    const startTime = Date.now();
    const errors: string[] = [];

    // Use sanitized query for all sources
    const englishQuery = sanitizedQuery;
    const spanishQuery = sanitizedQuery;

    console.log(`[UnifiedSearch] Starting search for: "${sanitizedQuery}"`);

    const results: {
        scopus: UnifiedArticle[];
        wos: UnifiedArticle[];
        openalex: UnifiedArticle[];
        duckduckgo: UnifiedArticle[];
        pubmed: UnifiedArticle[];
        scielo: UnifiedArticle[];
        redalyc: UnifiedArticle[];
    } = {
        scopus: [],
        wos: [],
        openalex: [],
        duckduckgo: [],
        pubmed: [],
        scielo: [],
        redalyc: []
    };

    // Run searches in parallel
    const searchPromises: Promise<void>[] = [];

    // Scopus (requires API key)
    if (sources.includes("scopus") && isScopusConfigured()) {
        searchPromises.push(
            (async () => {
                try {
                    const scopusResult = await withTimeout(
                        searchScopus(englishQuery, {
                            maxResults: maxPerSource,
                            startYear,
                            endYear,
                            affilCountries
                        }),
                        PER_SOURCE_TIMEOUT_MS,
                        "Scopus"
                    );
                    if (scopusResult) {
                        results.scopus = scopusResult.articles.map(a => convertScopusToUnified(a));
                    }
                    console.log(`[UnifiedSearch] Scopus: ${results.scopus.length} articles`);
                } catch (error: any) {
                    errors.push(`Scopus: ${error.message}`);
                    console.error(`[UnifiedSearch] Scopus error: ${error.message}`);
                }
            })()
        );
    }

    // Web of Science (requires API key)
    if (sources.includes("wos") && isWosConfigured()) {
        searchPromises.push(
            (async () => {
                try {
                    const wosResult = await withTimeout(
                        searchWos(englishQuery, {
                            maxResults: Math.min(50, maxPerSource),
                            startYear,
                            endYear,
                        }),
                        PER_SOURCE_TIMEOUT_MS,
                        "WoS"
                    );
                    if (wosResult) {
                        results.wos = wosResult.articles.map((a) => convertWosToUnified(a));
                    }
                    console.log(`[UnifiedSearch] WoS: ${results.wos.length} articles`);
                } catch (error: any) {
                    errors.push(`WoS: ${error.message}`);
                    console.error(`[UnifiedSearch] WoS error: ${error.message}`);
                }
            })()
        );
    }

    // OpenAlex (free)
    if (sources.includes("openalex")) {
        searchPromises.push(
            (async () => {
                try {
                    const countryCodes = affilCountriesToOpenAlexCodes(affilCountries);
                    const openAlexCandidates = await withTimeout(
                        searchOpenAlex(englishQuery, {
                            maxResults: Math.min(1000, Math.max(50, maxPerSource)),
                            yearStart: startYear,
                            yearEnd: endYear,
                            countryCodes,
                        }),
                        PER_SOURCE_TIMEOUT_MS,
                        "OpenAlex"
                    );
                    if (openAlexCandidates) {
                        results.openalex = openAlexCandidates.map(c => convertOpenAlexToUnified(c));
                    }
                    console.log(`[UnifiedSearch] OpenAlex: ${results.openalex.length} articles`);
                } catch (error: any) {
                    errors.push(`OpenAlex: ${error.message}`);
                    console.error(`[UnifiedSearch] OpenAlex error: ${error.message}`);
                }
            })()
        );
    }

    // DuckDuckGo (free) - best effort: discover DOIs and hydrate via Crossref
    if (sources.includes("duckduckgo")) {
        searchPromises.push(
            (async () => {
                try {
                    const ddg = await import("duck-duck-scrape");
                    const q = `${englishQuery} doi`;
                    const searchResults = await ddg.search(q, { safeSearch: ddg.SafeSearchType.OFF });

                    const dois: string[] = [];
                    for (const r of (searchResults.results || [])) {
                        const found = [
                            ...extractDois(`${r.title || ""} ${r.description || ""}`),
                            ...(extractDoiFromUrl(r.url || "") ? [extractDoiFromUrl(r.url || "")!] : []),
                        ];
                        for (const d of found) dois.push(d);
                        if (dois.length >= maxPerSource * 2) break;
                    }

                    const uniqueDois = Array.from(new Set(dois.map((d) => d.trim()).filter(Boolean))).slice(0, Math.min(30, maxPerSource));

                    const hydrated: UnifiedArticle[] = [];
                    for (const d of uniqueDois) {
                        const meta = await lookupDOI(d);
                        if (!meta) continue;
                        const ua = convertCrossRefMetadataToUnified(meta, "duckduckgo");
                        ua.apaCitation = generateGenericAPA7Citation(ua);
                        hydrated.push(ua);
                    }

                    // Filter by year range if provided
                    const filtered = hydrated.filter((a) => {
                        const y = parseInt(a.year || "", 10);
                        if (!Number.isFinite(y)) return true;
                        if (startYear && y < startYear) return false;
                        if (endYear && y > endYear) return false;
                        return true;
                    });

                    results.duckduckgo = filtered.slice(0, maxPerSource);
                    console.log(`[UnifiedSearch] DuckDuckGo: ${results.duckduckgo.length} articles`);
                } catch (error: any) {
                    errors.push(`DuckDuckGo: ${error.message}`);
                    console.error(`[UnifiedSearch] DuckDuckGo error: ${error.message}`);
                }
            })()
        );
    }

    // PubMed (free) - Run last or parallel but with ability to fill gaps
    if (sources.includes("pubmed") && isPubMedConfigured()) {
        searchPromises.push(
            (async () => {
                try {
                    // If we need 100 total, and mostly rely on PubMed, ask for more
                    const pubmedMax = Math.max(maxPerSource, maxResults - results.scopus.length - results.scielo.length - results.redalyc.length + 20);

                    const pubmedResult = await searchPubMed(englishQuery, {
                        maxResults: pubmedMax,
                        startYear,
                        endYear
                    });
                    results.pubmed = pubmedResult.articles.map(a => convertPubMedToUnified(a));
                    console.log(`[UnifiedSearch] PubMed: ${results.pubmed.length} articles`);
                } catch (error: any) {
                    errors.push(`PubMed: ${error.message}`);
                    console.error(`[UnifiedSearch] PubMed error: ${error.message}`);
                }
            })()
        );
    }

    // SciELO (free - Spanish/Portuguese)
    if (sources.includes("scielo") && isSciELOConfigured()) {
        searchPromises.push(
            (async () => {
                try {
                    const scieloResult = await searchSciELO(spanishQuery, {
                        maxResults: maxPerSource,
                        startYear,
                        endYear
                    });
                    results.scielo = scieloResult.articles.map(a => convertSciELOToUnified(a));
                    console.log(`[UnifiedSearch] SciELO: ${results.scielo.length} articles`);
                } catch (error: any) {
                    errors.push(`SciELO: ${error.message}`);
                    console.error(`[UnifiedSearch] SciELO error: ${error.message}`);
                }
            })()
        );
    }

    // Redalyc (free - Spanish)
    if (sources.includes("redalyc") && isRedalycConfigured()) {
        searchPromises.push(
            (async () => {
                try {
                    const redalycResult = await searchRedalyc(spanishQuery, {
                        maxResults: maxPerSource,
                        startYear,
                        endYear
                    });
                    results.redalyc = redalycResult.articles.map(a => convertRedalycToUnified(a));
                    console.log(`[UnifiedSearch] Redalyc: ${results.redalyc.length} articles`);
                } catch (error: any) {
                    errors.push(`Redalyc: ${error.message}`);
                    console.error(`[UnifiedSearch] Redalyc error: ${error.message}`);
                }
            })()
        );
    }

    await Promise.all(searchPromises);

    // Combine all results and sanitize article data from all sources
    const allArticlesRaw = [
        ...results.scopus,
        ...results.wos,
        ...results.openalex,
        ...results.duckduckgo,
        ...results.pubmed,
        ...results.scielo,
        ...results.redalyc
    ];

    // Sanitize all article fields to prevent XSS and ensure clean data
    const allArticles = allArticlesRaw.map(sanitizeUnifiedArticle);

    const deduplicated = deduplicateArticles(allArticles);

    // Cross-source enrichment: fill in missing fields from duplicate entries
    enrichArticles(deduplicated);

    // Rank articles by multi-factor score
    rankArticles(deduplicated);

    const finalArticles = deduplicated.slice(0, maxResults);

    console.log(`[UnifiedSearch] Total: ${allArticles.length}, Deduplicated: ${deduplicated.length}, Returning: ${finalArticles.length}`);

    return {
        articles: finalArticles,
        totalBySource: {
            scopus: results.scopus.length,
            wos: results.wos.length,
            openalex: results.openalex.length,
            duckduckgo: results.duckduckgo.length,
            pubmed: results.pubmed.length,
            scielo: results.scielo.length,
            redalyc: results.redalyc.length
        },
        query,
        searchTime: Date.now() - startTime,
        errors
    };
}

// =============================================================================
// Result Sanitization
// =============================================================================

/**
 * Sanitize article text fields to prevent XSS and ensure clean data.
 * Applied to all articles from all sources before they reach the user.
 */
function sanitizeArticleText(text: string | undefined | null): string {
    return sanitizePlainText(text, { maxLen: 20000, collapseWs: true });
}

/**
 * Sanitize a URL string to prevent injection
 */
function sanitizeUrl(url: string | undefined | null): string {
    return sanitizeHttpUrl(url);
}

/**
 * Sanitize a full UnifiedArticle after conversion
 */
function sanitizeUnifiedArticle(article: UnifiedArticle): UnifiedArticle {
    return {
        ...article,
        title: sanitizeArticleText(article.title) || "Untitled",
        authors: (article.authors || []).map(a => sanitizeArticleText(a)).filter(Boolean),
        year: (article.year || "").replace(/[^0-9n.d.]/g, "").substring(0, 10),
        journal: sanitizeArticleText(article.journal),
        abstract: sanitizeArticleText(article.abstract),
        keywords: (article.keywords || []).map(k => sanitizeArticleText(k)).filter(Boolean),
        doi: sanitizePlainText(article.doi || "", { maxLen: 300, collapseWs: true }),
        url: sanitizeUrl(article.url),
        language: sanitizeArticleText(article.language),
        documentType: sanitizeArticleText(article.documentType),
        country: sanitizeArticleText(article.country),
        city: sanitizeArticleText(article.city),
    };
}

// =============================================================================
// Converters
// =============================================================================

function convertScopusToUnified(article: ScopusArticle): UnifiedArticle {
    return {
        id: `scopus_${article.scopusId || article.eid}`,
        source: "scopus",
        title: article.title,
        authors: article.authors,
        year: article.year,
        journal: article.journal,
        abstract: article.abstract,
        keywords: article.keywords,
        doi: article.doi,
        url: article.url,
        language: article.language,
        documentType: article.subtypeDescription || "Article",
        country: article.affiliationCountry, // Scopus provides this
        city: article.affiliationCity,       // Scopus provides this
        citationCount: article.citationCount,
        apaCitation: generateScopusAPA7Citation(article)
    };
}

function convertWosToUnified(article: WosArticle): UnifiedArticle {
    const doi = (article.doi || "").trim();
    const inferredCountry = inferCountryFromText(article.affiliations?.join("; ") || "") || "Unknown";

    const unified: UnifiedArticle = {
        id: `wos_${article.id}`,
        source: "wos",
        title: article.title || "n.d.",
        authors: article.authors || [],
        year: article.year ? String(article.year) : "n.d.",
        journal: article.journal || "n.d.",
        abstract: article.abstract || "",
        keywords: article.keywords || [],
        doi: doi || undefined,
        url: doi ? `https://doi.org/${doi}` : article.wosUrl || "",
        language: article.language || "en",
        documentType: article.documentType || "Article",
        country: inferredCountry,
        city: "Unknown",
        citationCount: article.citationCount || 0,
        apaCitation: "",
    };

    unified.apaCitation = generateGenericAPA7Citation(unified);
    return unified;
}

function convertPubMedToUnified(article: PubMedArticle): UnifiedArticle {
    return {
        id: `pubmed_${article.pmid}`,
        source: "pubmed",
        title: article.title,
        authors: article.authors,
        year: article.year,
        journal: article.journal,
        abstract: article.abstract,
        keywords: article.keywords,
        doi: article.doi,
        url: article.url,
        volume: article.volume,
        pages: article.pages,
        language: article.language,
        documentType: "Article", // Default for PubMed
        country: "n.d.",        // Hard to extract from summary
        city: "n.d.",
        apaCitation: generatePubMedAPA7Citation(article)
    };
}

function convertOpenAlexToUnified(candidate: AcademicCandidate): UnifiedArticle {
    const year = candidate.year && candidate.year > 0 ? String(candidate.year) : "n.d.";
    const doi = (candidate.doi || "").trim();

    return {
        id: `openalex_${candidate.sourceId}`,
        source: "openalex",
        title: candidate.title || "n.d.",
        authors: candidate.authors || [],
        year,
        publicationDate: candidate.publicationDate || undefined,
        journal: candidate.journal || "n.d.",
        abstract: candidate.abstract || "",
        keywords: candidate.keywords || [],
        doi: doi || undefined,
        url: candidate.doiUrl || candidate.landingUrl || "",
        language: candidate.language || "en",
        documentType: candidate.documentType || "Article",
        country: candidate.country || "Unknown",
        city: candidate.city || "Unknown",
        institutionCountryCodes: candidate.institutionCountryCodes || [],
        primaryInstitutionCountryCode: candidate.primaryInstitutionCountryCode,
        citationCount: candidate.citationCount || 0,
        apaCitation: generateOpenAlexAPA7Citation(candidate),
    };
}

function convertSciELOToUnified(article: SciELOArticle): UnifiedArticle {
    const country = (article.country || "").trim() || scieloCollectionToCountry(article.collection);
    const city = (article.city || "").trim() || "n.d.";
    return {
        id: `scielo_${article.scielo_id}`,
        source: "scielo",
        title: article.title,
        authors: article.authors,
        year: article.year,
        publicationDate: article.publicationDate || undefined,
        journal: article.journal,
        abstract: article.abstract,
        keywords: article.keywords,
        doi: article.doi,
        url: article.url,
        volume: article.volume,
        pages: article.pages,
        language: article.language,
        documentType: "Article",
        country, // Derived from SciELO collection when possible
        city,
        apaCitation: generateSciELOAPA7Citation(article)
    };
}

function convertRedalycToUnified(article: RedalycArticle): UnifiedArticle {
    const inferred = inferCountryFromText(`${article.country || ""} ${article.institution || ""}`) || (article.country || "");
    return {
        id: `redalyc_${article.redalyc_id}`,
        source: "redalyc",
        title: article.title,
        authors: article.authors,
        year: article.year,
        journal: article.journal,
        abstract: article.abstract,
        keywords: article.keywords,
        doi: article.doi,
        url: article.url,
        volume: article.volume,
        pages: article.pages,
        language: article.language,
        documentType: "Article",
        country: inferred || "LatAm", // Redalyc is LatAm focused, try to infer when possible
        city: "n.d.",
        apaCitation: generateRedalycAPA7Citation(article)
    };
}

function generateGenericAPA7Citation(article: UnifiedArticle): string {
    // Authors
    const authors = article.authors || [];
    let authorsStr = "";

    if (authors.length === 0) {
        authorsStr = "";
    } else if (authors.length === 1) {
        authorsStr = formatAuthorAPA(authors[0]);
    } else if (authors.length === 2) {
        authorsStr = `${formatAuthorAPA(authors[0])} & ${formatAuthorAPA(authors[1])}`;
    } else if (authors.length <= 20) {
        const allAuthors = authors.map(formatAuthorAPA);
        authorsStr = allAuthors.slice(0, -1).join(", ") + ", & " + allAuthors[allAuthors.length - 1];
    } else {
        const first19 = authors.slice(0, 19).map(formatAuthorAPA);
        authorsStr = first19.join(", ") + ", ... " + formatAuthorAPA(authors[authors.length - 1]);
    }

    const year = article.year ? `(${article.year})` : "(n.d.)";
    const title = article.title?.endsWith(".") ? article.title : `${article.title}.`;

    let journalPart = article.journal ? `*${article.journal}*` : "";
    if (article.volume) {
        journalPart += `, *${article.volume}*`;
        if (article.issue) journalPart += `(${article.issue})`;
    }
    if (article.pages) {
        journalPart += `${journalPart ? "," : ""} ${article.pages}`;
    }

    const cleanDoi = (article.doi || "").trim().replace(/^https?:\/\/doi\.org\//i, "");
    const doiUrl = cleanDoi ? `https://doi.org/${cleanDoi}` : "";
    const rawUrl = (article.url || "").trim();
    const linkUrl = doiUrl || ((rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) ? rawUrl : "");

    const journalSegment = journalPart ? ` ${journalPart}.` : "";
    const linkSegment = linkUrl ? ` 🔗 ${linkUrl}` : "";

    return `${authorsStr} ${year}. ${title}${journalSegment}${linkSegment}`.trim();
}

function generateScopusAPA7Citation(article: ScopusArticle): string {
    // Authors
    let authorsStr = "";
    if (article.authors.length === 0) {
        authorsStr = "";
    } else if (article.authors.length === 1) {
        authorsStr = formatAuthorAPA(article.authors[0]);
    } else if (article.authors.length === 2) {
        authorsStr = `${formatAuthorAPA(article.authors[0])} & ${formatAuthorAPA(article.authors[1])}`;
    } else if (article.authors.length <= 20) {
        const allAuthors = article.authors.map(formatAuthorAPA);
        authorsStr = allAuthors.slice(0, -1).join(", ") + ", & " + allAuthors[allAuthors.length - 1];
    } else {
        const first19 = article.authors.slice(0, 19).map(formatAuthorAPA);
        authorsStr = first19.join(", ") + ", ... " + formatAuthorAPA(article.authors[article.authors.length - 1]);
    }

    const year = article.year ? `(${article.year})` : "(n.d.)";
    const title = article.title.endsWith(".") ? article.title : article.title + ".";
    const journalPart = `*${article.journal}*`;

    let doiPart = "";
    if (article.doi) {
        doiPart = ` 🔗 https://doi.org/${article.doi}`;
    }

    return `${authorsStr} ${year}. ${title} ${journalPart}.${doiPart}`.trim();
}

function generateOpenAlexAPA7Citation(candidate: AcademicCandidate): string {
    const authors = (candidate.authors || []).filter(Boolean);

    let authorsStr = "";
    if (authors.length === 0) {
        authorsStr = "";
    } else if (authors.length === 1) {
        authorsStr = formatAuthorAPA(authors[0]);
    } else if (authors.length === 2) {
        authorsStr = `${formatAuthorAPA(authors[0])} & ${formatAuthorAPA(authors[1])}`;
    } else if (authors.length <= 20) {
        const allAuthors = authors.map(formatAuthorAPA);
        authorsStr = allAuthors.slice(0, -1).join(", ") + ", & " + allAuthors[allAuthors.length - 1];
    } else {
        const first19 = authors.slice(0, 19).map(formatAuthorAPA);
        authorsStr = first19.join(", ") + ", ... " + formatAuthorAPA(authors[authors.length - 1]);
    }

    const year = candidate.year ? `(${candidate.year})` : "(n.d.)";
    const title = candidate.title?.endsWith(".") ? candidate.title : `${candidate.title}.`;
    const journalPart = candidate.journal ? `*${candidate.journal}*` : "";

    const doi = (candidate.doi || "").trim();
    const doiPart = doi ? ` 🔗 https://doi.org/${doi}` : "";

    return `${authorsStr} ${year}. ${title} ${journalPart}.${doiPart}`.trim();
}

function formatAuthorAPA(author: string): string {
    const parts = author.split(",").map(p => p.trim());
    if (parts.length >= 2) {
        const lastName = parts[0];
        const firstPart = parts[1];
        const initials = firstPart.split(/\s+/)
            .map(name => name.charAt(0).toUpperCase() + ".")
            .join(" ");
        return `${lastName}, ${initials}`;
    }

    // Handle "FirstName LastName" format
    const spaceParts = author.split(/\s+/);
    if (spaceParts.length >= 2) {
        const lastName = spaceParts[spaceParts.length - 1];
        const initials = spaceParts.slice(0, -1).map(n => n.charAt(0).toUpperCase() + ".").join(" ");
        return `${lastName}, ${initials}`;
    }

    return author;
}

// =============================================================================
// Deduplication (fuzzy: DOI + Levenshtein title similarity)
// =============================================================================

function deduplicateArticles(articles: UnifiedArticle[]): UnifiedArticle[] {
    const groups: UnifiedArticle[][] = [];
    const doiIndex = new Map<string, number>(); // doi → group index
    const titleIndex = new Map<string, number>(); // normalized title → group index

    for (const article of articles) {
        const doiKey = article.doi ? article.doi.toLowerCase().trim() : null;
        const normTitle = normalizeTitle(article.title);
        let groupIdx: number | undefined;

        // 1) Exact DOI match
        if (doiKey && doiIndex.has(doiKey)) {
            groupIdx = doiIndex.get(doiKey);
        }

        // 2) Exact normalized title match
        if (groupIdx === undefined && titleIndex.has(normTitle)) {
            groupIdx = titleIndex.get(normTitle);
        }

        // 3) Fuzzy title match: check against existing group titles
        if (groupIdx === undefined && normTitle.length > 15) {
            for (let i = 0; i < groups.length; i++) {
                const representative = groups[i][0];
                const repTitle = normalizeTitle(representative.title);
                if (Math.abs(normTitle.length - repTitle.length) > 15) continue;

                const dist = levenshteinDistance(normTitle, repTitle, 12);
                const maxLen = Math.max(normTitle.length, repTitle.length);
                const similarity = 1 - dist / maxLen;

                if (similarity >= 0.85) {
                    groupIdx = i;
                    break;
                }
            }
        }

        if (groupIdx !== undefined) {
            groups[groupIdx].push(article);
        } else {
            // New group
            groupIdx = groups.length;
            groups.push([article]);
        }

        // Update indexes
        if (doiKey) doiIndex.set(doiKey, groupIdx);
        titleIndex.set(normTitle, groupIdx);
    }

    // From each group, pick the best representative
    const result: UnifiedArticle[] = [];
    for (const group of groups) {
        const best = pickBestArticle(group);
        result.push(best);
    }

    return result;
}

/**
 * From a group of duplicate articles (same work from different sources),
 * pick the one from the most trusted source with the most complete data.
 */
function pickBestArticle(group: UnifiedArticle[]): UnifiedArticle {
    if (group.length === 1) return group[0];

    // Sort by: source priority DESC, abstract length DESC, citation count DESC
    group.sort((a, b) => {
        const priA = SOURCE_PRIORITY[a.source] || 0;
        const priB = SOURCE_PRIORITY[b.source] || 0;
        if (priA !== priB) return priB - priA;
        if (a.abstract.length !== b.abstract.length) return b.abstract.length - a.abstract.length;
        return (b.citationCount || 0) - (a.citationCount || 0);
    });

    return group[0];
}

// =============================================================================
// Cross-source Enrichment
// =============================================================================

/**
 * Fill in missing fields from other sources' data when we have duplicates.
 * This runs after deduplication and operates on the best representatives.
 */
function enrichArticles(articles: UnifiedArticle[]): void {
    for (const article of articles) {
        // Fill missing abstract
        if (!article.abstract || article.abstract.length < 50) {
            // abstract stays as-is; no external calls here
        }

        // Normalize empty fields
        if (!article.year || article.year === "n.d.") {
            // Keep as is
        }

        // Ensure DOI-based URL when DOI exists but URL is missing/generic
        if (article.doi && (!article.url || article.url === "")) {
            article.url = `https://doi.org/${article.doi}`;
        }

        // Ensure citation exists
        if (!article.apaCitation || article.apaCitation.trim().length < 10) {
            article.apaCitation = generateGenericAPA7Citation(article);
        }

        // Normalize country
        if (!article.country || article.country === "Unknown" || article.country === "n.d.") {
            // Try to infer from affiliations in the URL or other fields
            if (article.primaryInstitutionCountryCode) {
                const inferred = inferCountryFromCode(article.primaryInstitutionCountryCode);
                if (inferred) article.country = inferred;
            }
        }
    }
}

function inferCountryFromCode(code: string): string | undefined {
    const map: Record<string, string> = {
        AR: "Argentina", BO: "Bolivia", BR: "Brazil", CL: "Chile",
        CO: "Colombia", CR: "Costa Rica", CU: "Cuba", DO: "Dominican Republic",
        EC: "Ecuador", SV: "El Salvador", GT: "Guatemala", HN: "Honduras",
        MX: "Mexico", NI: "Nicaragua", PA: "Panama", PY: "Paraguay",
        PE: "Peru", PR: "Puerto Rico", UY: "Uruguay", VE: "Venezuela",
        ES: "Spain", US: "United States", GB: "United Kingdom", DE: "Germany",
        FR: "France", IT: "Italy", PT: "Portugal", CN: "China", JP: "Japan",
        KR: "South Korea", IN: "India", AU: "Australia", CA: "Canada",
    };
    return map[(code || "").toUpperCase()] || undefined;
}

// =============================================================================
// Multi-factor Ranking
// =============================================================================

function rankArticles(articles: UnifiedArticle[]): void {
    for (const article of articles) {
        (article as any)._rankScore = computeRankScore(article);
    }

    articles.sort((a, b) => {
        const sa = (a as any)._rankScore || 0;
        const sb = (b as any)._rankScore || 0;
        return sb - sa;
    });

    // Clean up temporary field
    for (const article of articles) {
        delete (article as any)._rankScore;
    }
}

function computeRankScore(article: UnifiedArticle): number {
    let score = 0;

    // Factor 1: Source priority (0-10)
    score += (SOURCE_PRIORITY[article.source] || 0);

    // Factor 2: Citation count (log scale, max ~5 points)
    const citations = article.citationCount || 0;
    if (citations > 0) {
        score += Math.min(5, Math.log10(citations + 1) * 2);
    }

    // Factor 3: Data completeness (0-4)
    if (article.abstract && article.abstract.length > 100) score += 1;
    if (article.doi) score += 1;
    if (article.authors.length > 0) score += 0.5;
    if (article.keywords.length > 0) score += 0.5;
    if (article.country && article.country !== "Unknown" && article.country !== "n.d.") score += 0.5;
    if (article.year && article.year !== "n.d.") score += 0.5;

    // Factor 4: Recency bonus (newer articles score slightly higher)
    const year = parseInt(article.year || "0", 10);
    const currentYear = new Date().getFullYear();
    if (year > 0) {
        const age = currentYear - year;
        if (age <= 2) score += 2;
        else if (age <= 5) score += 1;
        else if (age <= 10) score += 0.5;
    }

    return score;
}



// =============================================================================
// Word Document Generation
// =============================================================================

/**
 * Generate APA citations list as text (for Word export)
 */
export function generateAPACitationsList(articles: UnifiedArticle[]): string {
    const lines: string[] = [
        "Referencias Bibliográficas (APA 7ma Edición)",
        "",
        `Total de artículos: ${articles.length}`,
        ""
    ];

    // Group by source
    const bySource: Record<string, UnifiedArticle[]> = {
        scopus: [],
        wos: [],
        openalex: [],
        duckduckgo: [],
        pubmed: [],
        scielo: [],
        redalyc: []
    };

    for (const article of articles) {
        bySource[article.source].push(article);
    }

    // Sort all articles alphabetically by first author
    const sortedArticles = [...articles].sort((a, b) => {
        const authorA = a.authors[0] || "";
        const authorB = b.authors[0] || "";
        return authorA.localeCompare(authorB);
    });

    lines.push("================================================================================");
    lines.push("");

    for (let i = 0; i < sortedArticles.length; i++) {
        const article = sortedArticles[i];
        const sourceUrl = article.doi ? `https://doi.org/${article.doi}` : article.url || "";
        const linkEmoji = sourceUrl ? ` 🔗 ${sourceUrl}` : "";
        lines.push(`${i + 1}. [${article.source.toUpperCase()}]`);
        const citation = article.apaCitation || generateGenericAPA7Citation(article);
        // Ensure every citation ends with the 🔗 link emoji if not already present
        if (citation.includes("🔗")) {
            lines.push(citation);
        } else {
            lines.push(`${citation}${linkEmoji}`);
        }
        lines.push("");
    }

    lines.push("================================================================================");
    lines.push("");
    lines.push("Distribución por fuente:");
    lines.push(`  - Scopus: ${bySource.scopus.length} artículos 🔗 https://www.scopus.com`);
    lines.push(`  - WoS: ${bySource.wos.length} artículos 🔗 https://www.webofscience.com`);
    lines.push(`  - OpenAlex: ${bySource.openalex.length} artículos 🔗 https://openalex.org`);
    lines.push(`  - DuckDuckGo: ${bySource.duckduckgo.length} artículos 🔗 https://duckduckgo.com`);
    lines.push(`  - PubMed: ${bySource.pubmed.length} artículos 🔗 https://pubmed.ncbi.nlm.nih.gov`);
    lines.push(`  - SciELO: ${bySource.scielo.length} artículos 🔗 https://scielo.org`);
    lines.push(`  - Redalyc: ${bySource.redalyc.length} artículos 🔗 https://www.redalyc.org`);

    return lines.join("\n");
}

/**
 * Generate Excel report buffer
 */
export function generateExcelReport(articles: UnifiedArticle[]): Buffer {
    // Columns: Authors Title Year Journal Abstract Keywords Language Document Type DOI City of publication Country of study Scopus
    const sorted = [...articles].sort((a, b) => {
        const aKey = (a.authors[0] || "").toLowerCase();
        const bKey = (b.authors[0] || "").toLowerCase();
        if (aKey !== bKey) return aKey.localeCompare(bKey);
        const at = (a.title || "").toLowerCase();
        const bt = (b.title || "").toLowerCase();
        if (at !== bt) return at.localeCompare(bt);
        return (b.year || "").localeCompare(a.year || "");
    });

    const headers = [
        "Authors",
        "Title",
        "Year",
        "Journal",
        "Abstract",
        "Keywords",
        "Language",
        "Document Type",
        "DOI",
        "City of publication",
        "Country of study",
        "Scopus",
    ];

    const rows = [
        headers,
        ...sorted.map(a => ([
            a.authors?.join(", ") || "n.d.",
            a.title || "n.d.",
            a.year || "n.d.",
            a.journal || "n.d.",
            a.abstract || "n.d.",
            (a.keywords || []).join(", ") || "n.d.",
            normalizeLanguageLabel(a.language) || "n.d.",
            a.documentType || "Article",
            a.doi || "",
            a.city || "n.d.",
            a.country || "n.d.",
            a.source === "scopus" ? "Yes" : "No",
        ])),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Articles");

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function scieloCollectionToCountry(collection: string): string {
    const c = (collection || "").trim().toLowerCase();
    if (!c) return "n.d.";

    const map: Record<string, string> = {
        // Common SciELO collections (3-letter codes in `in` / `collection`)
        // NOTE: Some deployments use `scl` for Brazil.
        arg: "Argentina",
        bol: "Bolivia",
        bra: "Brazil",
        chl: "Chile",
        col: "Colombia",
        cri: "Costa Rica",
        cub: "Cuba",
        ecu: "Ecuador",
        mex: "Mexico",
        nic: "Nicaragua",
        pan: "Panama",
        per: "Peru",
        pry: "Paraguay",
        ury: "Uruguay",
        ven: "Venezuela",
        spa: "Spain",
        esp: "Spain",
        prt: "Portugal",
        scl: "Brazil",
        // Non-LatAm (still present in SciELO network)
        zaf: "South Africa",
        sza: "South Africa",
    };

    return map[c] || "LatAm";
}

function normalizeLanguageLabel(lang: string | undefined): string | undefined {
    const l = (lang || "").trim();
    if (!l) return undefined;
    const lower = l.toLowerCase();

    const map: Record<string, string> = {
        es: "Spanish",
        spa: "Spanish",
        spanish: "Spanish",
        español: "Spanish",
        espanol: "Spanish",
        pt: "Portuguese",
        por: "Portuguese",
        portuguese: "Portuguese",
        português: "Portuguese",
        portugues: "Portuguese",
        en: "English",
        eng: "English",
        english: "English",
        fr: "French",
        fra: "French",
        french: "French",
    };

    return map[lower] || l;
}

// =============================================================================
// Export
// =============================================================================

export const unifiedArticleSearch = {
    searchAllSources,
    generateAPACitationsList,
    generateExcelReport,
    isScopusConfigured,
    isWosConfigured,
    isOpenAlexConfigured: () => true,
    isDuckDuckGoConfigured: () => true,
    isPubMedConfigured,
    isSciELOConfigured,
    isRedalycConfigured
};

export default unifiedArticleSearch;
