/**
 * Redalyc API Client
 * 
 * Free API for searching Latin American open access scientific journals.
 * Requires registration for API token at https://www.redalyc.org/
 * 
 * API Docs: https://zenodo.org/record/7774744
 */

import { sanitizePlainText, sanitizeSearchQuery } from "../../lib/textSanitizers";

export interface RedalycArticle {
    redalyc_id: string;
    title: string;
    authors: string[];
    year: string;
    journal: string;
    abstract: string;
    keywords: string[];
    doi?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    language: string;
    institution?: string;
    country?: string;
    url: string;
}

export interface RedalycSearchResult {
    articles: RedalycArticle[];
    totalResults: number;
    query: string;
    searchTime: number;
}

// Redalyc API endpoints
const REDALYC_API_BASE = "https://www.redalyc.org/api/search/";
const REDALYC_OAI = "https://www.redalyc.org/exportarcita";
const REDALYC_SERVICE_BASE = "https://www.redalyc.org/service/r2020/getArticles";

// Rate limiting & timeouts
const REQUEST_DELAY_MS = 400;
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = (process.env.HTTP_USER_AGENT || "Mozilla/5.0 (compatible; IliaGPT/1.0)").trim();

/**
 * Sanitize and harden Redalyc search query input
 */
function sanitizeRedalycQuery(raw: string): string {
    let q = sanitizeSearchQuery(raw, 500);
    if (!q) return "";
    // Remove dangerous chars (keep letters, digits, spaces, common punctuation, accented chars)
    q = q.replace(/[^\w\s\-.,()'"áéíóúüñàèìòùâêîôûãõçÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÃÕÇ]/g, " ");
    // Collapse whitespace
    q = q.replace(/\s+/g, " ").trim();
    return q;
}

/**
 * Fetch with timeout for Redalyc API calls
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

const DOI_REGEX = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(text: string): string {
    return sanitizePlainText(text || "", { maxLen: 5000, collapseWs: true });
}

function normalizeDoi(raw: string | undefined): string | undefined {
    const v = (raw || "").trim();
    if (!v) return undefined;
    const m = v.match(DOI_REGEX);
    const doi = (m?.[0] || "")
        .replace(/^https?:\/\/doi\.org\//i, "")
        .replace(/^doi:\s*/i, "")
        .replace(/[),.;]+$/g, "")
        .trim();
    return doi || undefined;
}

function normalizeLanguageLabel(lang: string | undefined): string {
    const l = (lang || "").trim();
    if (!l) return "es";
    const lower = l.toLowerCase();
    const map: Record<string, string> = {
        es: "Spanish",
        spa: "Spanish",
        español: "Spanish",
        espanol: "Spanish",
        spanish: "Spanish",
        pt: "Portuguese",
        por: "Portuguese",
        portugués: "Portuguese",
        portugues: "Portuguese",
        portuguese: "Portuguese",
        en: "English",
        eng: "English",
        inglés: "English",
        ingles: "English",
        english: "English",
    };
    return map[lower] || l;
}

function pickRedalycLangSegment(text: string, prefer: Array<"es" | "pt" | "en"> = ["es", "pt", "en"]): string {
    const raw = stripHtml(text || "");
    if (!raw) return "";
    const parts = raw.split(">>>").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return "";

    // Some fields prefix with "es:" / "pt:" / "en:".
    const byLang: Record<string, string> = {};
    for (const p of parts) {
        const m = p.match(/^(es|pt|en)\s*:\s*(.+)$/i);
        if (m) {
            byLang[m[1].toLowerCase()] = m[2].trim();
        }
    }

    for (const lang of prefer) {
        const v = byLang[lang];
        if (v) return v;
    }

    // No lang markers: return the first segment.
    return parts[0];
}

function parseRedalycKeywords(text: string): string[] {
    const raw = stripHtml(text || "");
    if (!raw) return [];
    const parts = raw.split(">>>").map((p) => p.trim()).filter(Boolean);

    const out: string[] = [];
    const seen = new Set<string>();
    for (const p0 of parts) {
        const p = p0.replace(/^(es|pt|en)\s*:\s*/i, "").trim();
        const tokens = p
            .split(/[;,]/g)
            .map((t) => t.trim().replace(/\.+$/g, ""))
            .filter(Boolean);
        for (const t of tokens) {
            const key = t.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(t);
        }
    }
    return out;
}

function parseAuthorsFromServiceRow(row: any): string[] {
    const a1 = (row?.apellidoNombre || "").trim();
    if (a1) {
        return a1
            .split(">>>")
            .map((x: string) => x.trim())
            .filter(Boolean);
    }
    const a2 = (row?.autores || "").trim();
    if (a2) {
        return a2
            .split(/[;,]/g)
            .map((x: string) => x.trim())
            .filter(Boolean);
    }
    return [];
}

/**
 * Search Redalyc for articles
 * Note: Requires REDALYC_API_TOKEN for full API access
 * Falls back to OAI-PMH/scraping if no token
 */
export async function searchRedalyc(
    query: string,
    options: {
        maxResults?: number;
        startYear?: number;
        endYear?: number;
        country?: string;
    } = {}
): Promise<RedalycSearchResult> {
    const { maxResults = 25, startYear, endYear, country } = options;
    const startTime = Date.now();

    // Sanitize query input
    const sanitized = sanitizeRedalycQuery(query);
    if (!sanitized) {
        console.warn("[Redalyc] Empty query after sanitization");
        return { articles: [], totalResults: 0, query, searchTime: Date.now() - startTime };
    }

    console.log(`[Redalyc] Searching: "${sanitized}"`);

    const token = process.env.REDALYC_API_TOKEN;

    if (token) {
        return searchRedalycWithToken(sanitized, token, options);
    }

    // Fallback: Use web search interface
    return searchRedalycWeb(sanitized, options);
}

/**
 * Search with official API token
 */
async function searchRedalycWithToken(
    query: string,
    token: string,
    options: {
        maxResults?: number;
        startYear?: number;
        endYear?: number;
        country?: string;
    } = {}
): Promise<RedalycSearchResult> {
    const { maxResults = 25, startYear, endYear, country } = options;
    const startTime = Date.now();

    try {
        const params = new URLSearchParams({
            q: query,
            rows: maxResults.toString(),
            format: "json",
        });

        if (startYear && endYear) {
            params.set("filter", `year:[${startYear} TO ${endYear}]`);
        }

        if (country) {
            params.set("country", country);
        }

        const response = await fetchWithTimeout(`${REDALYC_API_BASE}?${params}`, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            console.error(`[Redalyc] API error: ${response.status}`);
            return searchRedalycWeb(query, { maxResults, startYear, endYear });
        }

        const data = await response.json();
        const articles: RedalycArticle[] = [];

        const docs = data.response?.docs || data.articles || [];

        for (const doc of docs) {
            const article: RedalycArticle = {
                redalyc_id: doc.id || doc.redalyc_id || "",
                title: doc.title || doc.titulo || "",
                authors: parseAuthors(doc.authors || doc.autores),
                year: String(doc.year || doc.anio || ""),
                journal: doc.journal || doc.revista || "",
                abstract: doc.abstract || doc.resumen || "",
                keywords: doc.keywords || doc.palabras_clave || [],
                doi: doc.doi || "",
                volume: String(doc.volume || doc.volumen || ""),
                issue: String(doc.issue || doc.numero || ""),
                pages: doc.pages || doc.paginas || "",
                language: doc.language || doc.idioma || "es",
                institution: doc.institution || doc.institucion || "",
                country: doc.country || doc.pais || "",
                url: doc.url || `https://www.redalyc.org/articulo.oa?id=${doc.id || doc.redalyc_id}`
            };

            articles.push(article);
        }

        return {
            articles,
            totalResults: data.response?.numFound || articles.length,
            query,
            searchTime: Date.now() - startTime
        };

    } catch (error: any) {
        console.error(`[Redalyc] Search error: ${error.message}`);
        return {
            articles: [],
            totalResults: 0,
            query,
            searchTime: Date.now() - startTime
        };
    }
}

/**
 * Fallback: Search via web interface
 */
async function searchRedalycWeb(
    query: string,
    options: {
        maxResults?: number;
        startYear?: number;
        endYear?: number;
    } = {}
): Promise<RedalycSearchResult> {
    const { maxResults = 25, startYear, endYear } = options;
    const startTime = Date.now();

    console.log(`[Redalyc] Using service fallback for: "${query}"`);

    try {
        const baseQuery = (query || "").trim();
        if (!baseQuery) {
            return { articles: [], totalResults: 0, query, searchTime: Date.now() - startTime };
        }

        const yearFilter = startYear && endYear ? `${Math.min(startYear, endYear)}-${Math.max(startYear, endYear)}` : "";
        const segment = yearFilter
            ? `${baseQuery}<<<${yearFilter}<<<${""}<<<${""}<<<${""}`
            : baseQuery;

        const pageSize = Math.min(50, Math.max(5, maxResults));
        const articles: RedalycArticle[] = [];
        let totalResults = 0;

        // Country mapping is returned as "filtros" with numeric codes.
        let countryMap: Record<string, string> | null = null;

        for (let page = 1; articles.length < maxResults; page++) {
            const url = `${REDALYC_SERVICE_BASE}/${encodeURIComponent(segment)}/${page}/${pageSize}/1/default/`;
            const response = await fetchWithTimeout(url, {
                headers: {
                    // Do NOT send "Accept: application/json" (Redalyc returns 406 in some cases).
                    "User-Agent": USER_AGENT,
                },
            });

            if (!response.ok) {
                const txt = await response.text().catch(() => "");
                console.error(`[Redalyc] Service failed: ${response.status} ${txt?.slice(0, 200) || ""}`.trim());
                break;
            }

            const txt = await response.text();
            const data = JSON.parse(txt || "{}");

            if (!totalResults) {
                totalResults = parseInt(String(data.totalResultados || "0"), 10) || 0;
            }

            if (!countryMap) {
                const filtros = Array.isArray(data.filtros) ? data.filtros : [];
                const fPais = filtros.find((f: any) => String(f?.nombre || "").toLowerCase().includes("pa"));
                const elems = Array.isArray(fPais?.elementos) ? fPais.elementos : [];
                const m: Record<string, string> = {};
                for (const e of elems) {
                    const k = String(e?.clave || "").trim();
                    const v = String(e?.nombre || "").trim();
                    if (k && v) m[k] = v;
                }
                countryMap = m;
            }

            const rows = Array.isArray(data.resultados) ? data.resultados : [];
            if (rows.length === 0) break;

            for (const row of rows) {
                const id = String(row?.cveArticulo || row?.id || "").trim();
                const title = stripHtml(String(row?.titulo || ""));
                const year = String(row?.anioArticulo || row?.anoEdcNum || "").trim();
                const journal = stripHtml(String(row?.nomRevista || ""));
                if (!id || !title) continue;

                const y = parseInt(year, 10);
                if (startYear && Number.isFinite(y) && y < startYear) continue;
                if (endYear && Number.isFinite(y) && y > endYear) continue;

                const doi = normalizeDoi(String(row?.doiTitulo || row?.doi || ""));
                const keywords = parseRedalycKeywords(String(row?.palabras || ""));
                const abstract = pickRedalycLangSegment(String(row?.resumen || ""), ["es", "pt", "en"]);
                const countryCode = String(row?.paisRevista || "").trim();
                const country = (countryMap && countryCode && countryMap[countryCode]) ? countryMap[countryCode] : "";

                articles.push({
                    redalyc_id: id,
                    title,
                    authors: parseAuthorsFromServiceRow(row),
                    year: year || "",
                    journal: journal || "",
                    abstract,
                    keywords,
                    doi: doi || undefined,
                    volume: String(row?.volRevNum || "").trim() || undefined,
                    issue: String(row?.numRevNum || "").trim() || undefined,
                    pages: String(row?.paginas || "").trim() || undefined,
                    language: normalizeLanguageLabel(String(row?.idiomaArticulo || "")),
                    institution: stripHtml(String(row?.nomInstitucionRev || "")) || undefined,
                    country: country || undefined,
                    url: `https://www.redalyc.org/articulo.oa?id=${id}`,
                });

                if (articles.length >= maxResults) break;
            }

            await sleep(REQUEST_DELAY_MS);

            // Stop early if we reached the end.
            if (totalResults && page * pageSize >= totalResults) break;
        }

        return {
            articles: articles.slice(0, maxResults),
            totalResults: totalResults || articles.length,
            query,
            searchTime: Date.now() - startTime,
        };

    } catch (error: any) {
        console.error(`[Redalyc] Service search error: ${error.message}`);
        return {
            articles: [],
            totalResults: 0,
            query,
            searchTime: Date.now() - startTime
        };
    }
}

function parseRedalycHTML(html: string, maxResults: number): RedalycArticle[] {
    const articles: RedalycArticle[] = [];

    // Extract article links and data from HTML
    // This is a simplified parser - adjust based on actual HTML structure
    const articleMatches = html.match(/<div class="[^"]*article[^"]*"[\s\S]*?<\/div>/gi) || [];

    for (const match of articleMatches.slice(0, maxResults)) {
        const titleMatch = match.match(/<a[^>]*>([^<]+)<\/a>/i);
        const idMatch = match.match(/id=(\d+)/);

        if (titleMatch && idMatch) {
            articles.push({
                redalyc_id: idMatch[1],
                title: titleMatch[1].trim(),
                authors: [],
                year: "",
                journal: "",
                abstract: "",
                keywords: [],
                language: "es",
                url: `https://www.redalyc.org/articulo.oa?id=${idMatch[1]}`
            });
        }
    }

    return articles;
}

function parseAuthors(authors: any): string[] {
    if (!authors) return [];
    if (Array.isArray(authors)) {
        return authors.map(a => typeof a === "string" ? a : a.name || a.nombre || "");
    }
    if (typeof authors === "string") {
        return authors.split(/[;,]/).map(a => a.trim()).filter(Boolean);
    }
    return [];
}

/**
 * Generate APA 7th Edition citation for Redalyc article
 */
export function generateRedalycAPA7Citation(article: RedalycArticle): string {
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

    let urlPart = "";
    if (article.doi) {
        urlPart = ` 🔗 https://doi.org/${article.doi}`;
    } else if (article.url) {
        urlPart = ` 🔗 ${article.url}`;
    }

    return `${authorsStr} ${year}. ${title} ${journalPart}.${urlPart}`.trim();
}

function formatAuthorAPA(author: string): string {
    // Handle "FirstName LastName" format
    const parts = author.split(/\s+/);
    if (parts.length >= 2) {
        const lastName = parts[parts.length - 1];
        const initials = parts.slice(0, -1).map(n => n.charAt(0).toUpperCase() + ".").join(" ");
        return `${lastName}, ${initials}`;
    }
    return author;
}

export function isRedalycConfigured(): boolean {
    // Works without token but with limited functionality
    return true;
}
