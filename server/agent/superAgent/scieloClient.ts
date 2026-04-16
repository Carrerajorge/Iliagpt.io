/**
 * SciELO ArticleMeta API Client
 * 
 * Free API for searching Latin American and Spanish scientific literature.
 * All content is open access.
 * 
 * API Docs: https://articlemeta.scielo.org/
 */

import { sanitizePlainText, sanitizeSearchQuery } from "../../lib/textSanitizers";

export interface SciELOArticle {
    scielo_id: string;
    title: string;
    authors: string[];
    year: string;
    publicationDate?: string;
    journal: string;
    abstract: string;
    keywords: string[];
    doi: string;
    volume?: string;
    issue?: string;
    pages?: string;
    language: string;
    collection: string;
    city?: string;
    country?: string;
    url: string;
}

export interface SciELOSearchResult {
    articles: SciELOArticle[];
    totalResults: number;
    query: string;
    searchTime: number;
}

// SciELO ArticleMeta API endpoints
const SCIELO_ARTICLEMETA = "https://articlemeta.scielo.org/api/v1";
const SCIELO_SEARCH = "https://search.scielo.org/api/v2/search";

// Rate limiting & timeouts
const REQUEST_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = (process.env.HTTP_USER_AGENT || "Mozilla/5.0 (compatible; IliaGPT/1.0)").trim();

/**
 * Sanitize and harden SciELO search query input
 */
function sanitizeSciELOQuery(raw: string): string {
    let q = sanitizeSearchQuery(raw, 500);
    if (!q) return "";
    // Remove dangerous special characters (keep letters, digits, spaces, common punctuation, accented chars)
    q = q.replace(/[^\w\s\-.,()'"áéíóúüñàèìòùâêîôûãõçÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÃÕÇ]/g, " ");
    // Collapse whitespace
    q = q.replace(/\s+/g, " ").trim();
    return q;
}

/**
 * Fetch with timeout for SciELO API calls
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

const DEFAULT_COLLECTIONS = [
    // LatAm (SciELO Network)
    "arg", "bol", "bra", "chl", "col", "cri", "cub", "ecu", "mex", "nic", "pan", "per", "pry", "ury", "ven",
    // Spain
    "spa",
    // Some deployments use "scl" for Brazil
    "scl",
];

const STOPWORDS = new Set([
    // Spanish
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "a", "en", "con", "por",
    "para", "sobre", "y", "o", "que", "como", "su", "sus", "es", "son", "fue", "fueron", "ser", "se",
    "entre", "hacia", "desde", "hasta",
    // Portuguese
    "o", "a", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "em", "por", "para",
    "sobre", "e", "ou", "que", "como", "se", "sua", "suas", "entre", "ate", "até",
    // English
    "the", "and", "or", "of", "in", "on", "for", "with", "to", "from", "by", "as", "into", "this", "that",
]);

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text: string): string {
    return (text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function stripHtml(text: string): string {
    return sanitizePlainText(text || "", { maxLen: 5000, collapseWs: true });
}

function buildQueryTerms(query: string): string[] {
    const tokens = normalizeText(query)
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .filter((t) => t.length >= 3)
        .filter((t) => !STOPWORDS.has(t));
    return Array.from(new Set(tokens));
}

function matchesQuery(text: string, terms: string[], minMatches: number): boolean {
    if (terms.length === 0) return true;
    const hay = normalizeText(text);
    if (!hay) return false;
    let hits = 0;
    for (const t of terms) {
        if (hay.includes(t)) {
            hits++;
            if (hits >= minMatches) return true;
        }
    }
    return false;
}

function pickLangText(entries: any, prefer: Array<"es" | "pt" | "en">, valueKey: string = "_"): string {
    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) return "";

    const byLang: Record<string, string> = {};
    for (const e of list) {
        const lang = String(e?.l || "").trim().toLowerCase();
        const v = stripHtml(String((valueKey && e?.[valueKey]) || e?._ || e?.a || ""));
        if (!lang || !v) continue;
        if (!byLang[lang]) byLang[lang] = v;
    }

    for (const lang of prefer) {
        const v = byLang[lang];
        if (v) return v;
    }

    // Fallback: first non-empty value
    for (const e of list) {
        const v = stripHtml(String((valueKey && e?.[valueKey]) || e?._ || e?.a || ""));
        if (v) return v;
    }
    return "";
}

function pickTitleV(titleObj: any, field: string): string {
    const v = titleObj?.[field];
    const list = Array.isArray(v) ? v : [];
    for (const e of list) {
        const s = stripHtml(String(e?._ || ""));
        if (s) return s;
    }
    return "";
}

function parseArticleMetaAuthors(articleObj: any): string[] {
    const list = Array.isArray(articleObj?.v10) ? articleObj.v10 : [];
    const out: string[] = [];
    for (const a of list) {
        const surname = String(a?.s || "").trim();
        const given = String(a?.n || "").trim();
        if (surname && given) out.push(`${surname}, ${given}`.trim());
        else if (surname) out.push(surname);
    }
    return out;
}

function parseArticleMetaKeywords(articleObj: any, prefer: Array<"es" | "pt" | "en"> = ["es", "pt", "en"]): string[] {
    const list = Array.isArray(articleObj?.v85) ? articleObj.v85 : [];
    const bucket: Record<string, string[]> = { es: [], pt: [], en: [] };
    const other: string[] = [];
    for (const k of list) {
        const kw = stripHtml(String(k?.k || "")).trim();
        if (!kw) continue;
        if (/^nd$/i.test(kw)) continue;
        const lang = String(k?.l || "").trim().toLowerCase();
        if (lang && bucket[lang]) bucket[lang].push(kw);
        else other.push(kw);
    }

    for (const lang of prefer) {
        if (bucket[lang].length > 0) return Array.from(new Set(bucket[lang]));
    }
    return Array.from(new Set([...other, ...bucket.es, ...bucket.pt, ...bucket.en])).filter(Boolean);
}

function parseArticleMetaPages(articleObj: any): string {
    const list = Array.isArray(articleObj?.v14) ? articleObj.v14 : [];
    let first = "";
    let last = "";
    for (const p of list) {
        if (!first && p?.f) first = String(p.f).trim();
        if (!last && p?.l) last = String(p.l).trim();
    }
    if (first && last && first !== last) return `${first}-${last}`;
    return first || last || "";
}

function iso2ToCountryName(iso2: string): string {
    const c = (iso2 || "").trim().toUpperCase();
    const map: Record<string, string> = {
        AR: "Argentina",
        BO: "Bolivia",
        BR: "Brazil",
        CL: "Chile",
        CO: "Colombia",
        CR: "Costa Rica",
        CU: "Cuba",
        DO: "Dominican Republic",
        EC: "Ecuador",
        ES: "Spain",
        GT: "Guatemala",
        HN: "Honduras",
        MX: "Mexico",
        NI: "Nicaragua",
        PA: "Panama",
        PE: "Peru",
        PR: "Puerto Rico",
        PY: "Paraguay",
        UY: "Uruguay",
        VE: "Venezuela",
        ZAF: "South Africa",
        ZA: "South Africa",
    };
    return map[c] || iso2 || "";
}

/**
 * Search SciELO for articles
 */
export async function searchSciELO(
    query: string,
    options: {
        maxResults?: number;
        startYear?: number;
        endYear?: number;
        collection?: string; // e.g., "scl" for Brazil, "spa" for Spain, "col" for Colombia
    } = {}
): Promise<SciELOSearchResult> {
    const { maxResults = 25, startYear, endYear, collection } = options;
    const clampedMax = Math.max(1, Math.min(100, maxResults));
    const startTime = Date.now();

    // Sanitize query input
    const sanitized = sanitizeSciELOQuery(query);
    if (!sanitized) {
        console.warn("[SciELO] Empty query after sanitization");
        return { articles: [], totalResults: 0, query, searchTime: Date.now() - startTime };
    }

    console.log(`[SciELO] Searching: "${sanitized}"`);

    try {
        // Use the SciELO search API
        const params = new URLSearchParams({
            q: sanitized,
            count: clampedMax.toString(),
            from: "0",
            output: "json",
            lang: "es", // Spanish language results
            sort: "RELEVANCE",
        });

        // Add year filter
        if (startYear && endYear) {
            params.set("filter", `year_cluster:[${startYear} TO ${endYear}]`);
        }

        // Add collection filter
        if (collection) {
            params.set("in", collection);
        }

        const response = await fetchWithTimeout(`${SCIELO_SEARCH}?${params}`, {
            headers: {
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
                "Referer": "https://search.scielo.org/",
            },
        });

        if (!response.ok) {
            // Fallback to ArticleMeta if search API fails
            console.log(`[SciELO] Search API returned ${response.status}, trying ArticleMeta...`);
            return searchSciELOArticleMeta(query, options);
        }

        const data = await response.json();

        const articles: SciELOArticle[] = [];
        const docs = data.documents || data.response?.docs || [];

        for (const doc of docs) {
            const article = parseSciELODocument(doc);
            if (article) {
                articles.push(article);
            }
        }

        const totalResults = data.total || data.response?.numFound || articles.length;

        console.log(`[SciELO] Found ${totalResults} results, returning ${articles.length}`);

        return {
            articles,
            totalResults,
            query,
            searchTime: Date.now() - startTime
        };

    } catch (error: any) {
        console.error(`[SciELO] Search error: ${error.message}`);
        // Try ArticleMeta as fallback
        return searchSciELOArticleMeta(query, options);
    }
}

/**
 * Alternative: Search using ArticleMeta API
 */
async function searchSciELOArticleMeta(
    query: string,
    options: {
        maxResults?: number;
        startYear?: number;
        endYear?: number;
        collection?: string;
    } = {}
): Promise<SciELOSearchResult> {
    const { maxResults = 25, startYear, endYear, collection } = options;
    const startTime = Date.now();

    try {
        // ArticleMeta payloads are huge; cap to keep latency and bandwidth bounded.
        const target = Math.min(60, Math.max(1, maxResults));

        const collections = (collection ? [collection] : DEFAULT_COLLECTIONS).map((c) => (c || "").trim()).filter(Boolean);
        const terms = buildQueryTerms(query);
        const minMatches = terms.length >= 6 ? 2 : 1;

        const articles: SciELOArticle[] = [];
        const seen = new Set<string>();

        const perPage = 3;
        const maxPagesPerCollection = 3; // 9 objects per collection max
        const wallBudgetMs = (() => {
            const raw = process.env.SCIELO_ARTICLEMETA_TIME_BUDGET_MS;
            const n = raw ? parseInt(raw, 10) : 12_000;
            return Number.isFinite(n) && n > 0 ? n : 12_000;
        })();
        const maxRequests = (() => {
            const raw = process.env.SCIELO_ARTICLEMETA_MAX_REQUESTS;
            const n = raw ? parseInt(raw, 10) : 25;
            return Number.isFinite(n) && n > 0 ? n : 25;
        })();
        let requestCount = 0;

        outer: for (const col of collections) {
            for (let page = 0; page < maxPagesPerCollection && articles.length < target; page++) {
                if (Date.now() - startTime > wallBudgetMs) break outer;
                if (requestCount >= maxRequests) break outer;
                requestCount++;

                const params = new URLSearchParams({
                    collection: col,
                    limit: String(perPage),
                    offset: String(page * perPage),
                });

                const response = await fetch(`${SCIELO_ARTICLEMETA}/articles/?${params}`, {
                    headers: {
                        "Accept": "application/json",
                        "User-Agent": USER_AGENT,
                    },
                });

                if (!response.ok) {
                    console.error(`[SciELO ArticleMeta] Failed: ${response.status} (collection=${col})`);
                    break;
                }

                const data = await response.json();
                const objects = Array.isArray(data.objects) ? data.objects : [];
                if (objects.length === 0) break;

                for (const obj of objects) {
                    const article = parseArticleMetaObject(obj);
                    if (!article) continue;

                    if (seen.has(article.scielo_id)) continue;

                    const y = parseInt((article.year || "").trim(), 10);
                    if (startYear && Number.isFinite(y) && y < startYear) continue;
                    if (endYear && Number.isFinite(y) && y > endYear) continue;

                    const hay = `${article.title} ${article.abstract} ${(article.keywords || []).join(" ")} ${article.journal}`;
                    if (!matchesQuery(hay, terms, minMatches)) continue;

                    seen.add(article.scielo_id);
                    articles.push(article);
                    if (articles.length >= target) break;
                }

                await sleep(Math.min(REQUEST_DELAY_MS, 150));

                // If fewer than perPage objects were returned, we reached the end.
                if (objects.length < perPage) break;
            }

            if (articles.length >= target) break;
        }

        return {
            articles: articles.slice(0, target),
            totalResults: articles.length,
            query,
            searchTime: Date.now() - startTime,
        };

    } catch (error: any) {
        console.error(`[SciELO ArticleMeta] Error: ${error.message}`);
        return {
            articles: [],
            totalResults: 0,
            query,
            searchTime: Date.now() - startTime
        };
    }
}

function parseSciELODocument(doc: any): SciELOArticle | null {
    try {
        const pid = doc.id || doc.PID || doc.pid || "";
        const title = doc.title || doc.ti || (Array.isArray(doc.ti) ? doc.ti[0] : "") || "";
        const journal = doc.ta || doc.journal_title || "";
        const year = doc.py || doc.publication_year || doc.da?.substring(0, 4) || "";
        const abstractText = doc.ab || doc.abstract || (Array.isArray(doc.ab) ? doc.ab[0] : "") || "";

        // Authors
        let authors: string[] = [];
        if (doc.au) {
            authors = Array.isArray(doc.au) ? doc.au : [doc.au];
        }

        // Keywords
        let keywords: string[] = [];
        if (doc.kw) {
            keywords = Array.isArray(doc.kw) ? doc.kw : doc.kw.split(";").map((k: string) => k.trim());
        }

        const collection = doc.in || doc.collection || "";
        const doi = doc.doi || "";

        return {
            scielo_id: pid,
            title: typeof title === "string" ? title : String(title),
            authors,
            year: String(year),
            journal: typeof journal === "string" ? journal : String(journal),
            abstract: typeof abstractText === "string" ? abstractText : String(abstractText),
            keywords,
            doi,
            volume: doc.volume || "",
            issue: doc.issue || "",
            pages: doc.pages || "",
            language: doc.la || "es",
            collection,
            url: `https://www.scielo.br/scielo.php?pid=${pid}&script=sci_arttext`
        };
    } catch {
        return null;
    }
}

function parseArticleMetaObject(obj: any): SciELOArticle | null {
    try {
        const pid = String(obj?.code || "").trim();
        if (!pid) return null;

        const articleObj = obj?.article || {};
        const title = pickLangText(articleObj?.v12, ["es", "pt", "en"], "_");
        const abstractText = pickLangText(articleObj?.v83, ["es", "pt", "en"], "a");
        const authors = parseArticleMetaAuthors(articleObj);
        const keywords = parseArticleMetaKeywords(articleObj);

        const year = String(obj?.publication_year || obj?.publicationYear || "").trim();
        const publicationDate = String(obj?.publication_date || obj?.publicationDate || "").trim();
        const collection = String(obj?.collection || "").trim();

        // Journal metadata lives under obj.title
        const titleObj = obj?.title || {};
        const journal =
            pickTitleV(titleObj, "v100") ||
            pickTitleV(titleObj, "v130") ||
            pickTitleV(titleObj, "v150") ||
            pickTitleV(titleObj, "v151") ||
            pickTitleV(titleObj, "v230") ||
            "";

        const city = pickTitleV(titleObj, "v490") || "";
        const countryIso = pickTitleV(titleObj, "v310") || "";
        const country = iso2ToCountryName(countryIso) || "";

        const volume = pickLangText(articleObj?.v31, ["es", "pt", "en"], "_");
        const issue = pickLangText(articleObj?.v32, ["es", "pt", "en"], "_");
        const pages = parseArticleMetaPages(articleObj);

        // URL from fulltexts.html/pdf
        const fulltexts = obj?.fulltexts || {};
        const html = fulltexts?.html || {};
        const pdf = fulltexts?.pdf || {};
        const url =
            String(html?.es || html?.pt || html?.en || "") ||
            String(pdf?.es || pdf?.pt || pdf?.en || "") ||
            "";

        // Language: infer from title v12 first element
        const lang = String((Array.isArray(articleObj?.v12) ? articleObj.v12?.[0]?.l : "") || "").trim() || "es";

        return {
            scielo_id: pid,
            title: title || "",
            authors,
            year: year || "",
            publicationDate: publicationDate || undefined,
            journal: journal || "",
            abstract: abstractText || "",
            keywords,
            doi: "",
            volume: volume || "",
            issue: issue || "",
            pages: pages || "",
            language: lang,
            collection: collection || "",
            city: city || undefined,
            country: country || undefined,
            url: url || "",
        };
    } catch {
        return null;
    }
}

/**
 * Generate APA 7th Edition citation for SciELO article
 */
export function generateSciELOAPA7Citation(article: SciELOArticle): string {
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

    let journalPart = `*${article.journal}*`;
    if (article.volume) {
        journalPart += `, *${article.volume}*`;
        if (article.issue) {
            journalPart += `(${article.issue})`;
        }
    }
    if (article.pages) {
        journalPart += `, ${article.pages}`;
    }

    let doiPart = "";
    if (article.doi) {
        doiPart = ` 🔗 https://doi.org/${article.doi}`;
    } else if (article.url) {
        doiPart = ` 🔗 ${article.url}`;
    }

    return `${authorsStr} ${year}. ${title} ${journalPart}.${doiPart}`.trim();
}

function formatAuthorAPA(author: string): string {
    const parts = author.split(",").map(p => p.trim());
    if (parts.length < 2) return author;

    const lastName = parts[0];
    const firstPart = parts[1];

    const initials = firstPart.split(/\s+/)
        .map(name => name.charAt(0).toUpperCase() + ".")
        .join(" ");

    return `${lastName}, ${initials}`;
}

export function isSciELOConfigured(): boolean {
    // SciELO APIs are free and don't require API key
    return true;
}
