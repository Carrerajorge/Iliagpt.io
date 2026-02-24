import { unifiedArticleSearch, UnifiedSearchResult } from "../agent/superAgent/unifiedArticleSearch";
import { llmGateway } from "../lib/llmGateway";
import { sanitizeSearchQuery } from "../lib/textSanitizers";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

/**
 * Service to orchestrate academic research requests using LLM for query optimization
 * and UnifiedArticleSearch for data retrieval.
 */
export class AcademicSearchService {

    private artifactsDir: string;

    constructor() {
        // Artifacts directory relative to execution context (usually project root)
        this.artifactsDir = path.join(process.cwd(), "artifacts", "research");
        if (!fs.existsSync(this.artifactsDir)) {
            fs.mkdirSync(this.artifactsDir, { recursive: true });
        }
    }

    /**
   * Process a natural language research request
   */
    /**
     * Sanitize user query to prevent injection and ensure robust results
     */
    private sanitizeQuery(raw: string): string {
        return sanitizeSearchQuery(raw, 500);
    }

    async processResearchRequest(
        userQuery: string,
        options: { userId?: string; format?: "apa7" | "bibtex" } = {}
    ): Promise<{
        summary: string;
        filePath?: string; // Legacy field (links to Word/Text file)
        files?: { name: string; path: string }[]; // New field for multiple files
        articleCount: number;
        sources: string[];
    }> {
        // Harden input query
        const sanitizedQuery = this.sanitizeQuery(userQuery);
        if (!sanitizedQuery) {
            return {
                summary: "## ⚠️ Búsqueda Académica\n\nLa consulta proporcionada no es válida. Por favor, ingrese un tema de búsqueda.",
                files: [],
                articleCount: 0,
                sources: [],
            };
        }
        const userQueryClean = sanitizedQuery;
        console.log(`[AcademicSearch] Processing request: "${userQueryClean}"`);

        // 1. Analyze and Optimize Query using LLM
        const queryParams = await this.optimizeQuery(userQueryClean);
        console.log(`[AcademicSearch] Optimized params:`, queryParams);

        // 2. Execute Search
        // Use English keywords for international DBs (Scopus, PubMed)
        const searchQuery = queryParams.englishKeywords.join(" OR ");

        console.log(`[AcademicSearch] Executing search ALL sources with query: "${searchQuery}"`);

        // Map region to affiliation country filters
        const affilCountries = regionToAffilCountries(queryParams.region);

        const searchResult = await unifiedArticleSearch.searchAllSources(searchQuery, {
            maxResults: queryParams.count || 50,
            startYear: queryParams.yearStart,
            endYear: queryParams.yearEnd,
            affilCountries,
        });

        // 3. Generate Output Files
        const files: { name: string; path: string }[] = [];

        // 3.1 CITATIONS (Word/Text)
        if (queryParams.outputFormats.includes("word") || queryParams.outputFormats.includes("txt")) {
            const filename = `referencias_${uuidv4().substring(0, 8)}.txt`;
            const filePath = path.join(this.artifactsDir, filename);
            const citationsContent = unifiedArticleSearch.generateAPACitationsList(searchResult.articles);
            fs.writeFileSync(filePath, citationsContent, "utf-8");
            files.push({ name: "Referencias (APA 7)", path: filePath });
        }

        // 3.2 EXCEL
        if (queryParams.outputFormats.includes("excel") || queryParams.outputFormats.includes("xlsx")) {
            const filename = `reporte_articulos_${uuidv4().substring(0, 8)}.xlsx`;
            const filePath = path.join(this.artifactsDir, filename);
            // Ensure generateExcelReport is available and returns buffer
            try {
                const buffer = unifiedArticleSearch.generateExcelReport(searchResult.articles);
                fs.writeFileSync(filePath, buffer);
                files.push({ name: "Tabla de Artículos (Excel)", path: filePath });
            } catch (e) {
                console.error("Error generating Excel:", e);
            }
        }

        // Default fallback if no format detected (generate Word)
        if (files.length === 0 && searchResult.articles.length > 0) {
            const filename = `referencias_${uuidv4().substring(0, 8)}.txt`;
            const filePath = path.join(this.artifactsDir, filename);
            const citationsContent = unifiedArticleSearch.generateAPACitationsList(searchResult.articles);
            fs.writeFileSync(filePath, citationsContent, "utf-8");
            files.push({ name: "Referencias (APA 7)", path: filePath });
        }

        // 4. Generate Summary for Chat
        const summary = this.generateSummary(searchResult, files, queryParams);

        return {
            summary,
            filePath: files[0]?.path, // For legacy compatibility
            files,
            articleCount: searchResult.articles.length,
            sources: Object.keys(searchResult.totalBySource).filter((k) => (searchResult.totalBySource as any)[k] > 0),
        };
    }

    /**
     * Use LLM to extract search parameters from natural language
     */
    private async optimizeQuery(userQuery: string): Promise<{
        englishKeywords: string[];
        spanishKeywords: string[];
        yearStart?: number;
        yearEnd?: number;
        count: number;
        region?: string;
        outputFormats: string[];
    }> {
        try {
            const response = await llmGateway.chat([
                {
                    role: "system",
                    content: `You are a Research Query Optimizer. Extract search parameters from the user's request.
          Return a JSON object with:
          - englishKeywords: Array of 3-5 specific academic keywords in English.
          - spanishKeywords: Array of 3-5 specific academic keywords in Spanish.
          - yearStart: Number (optional).
          - yearEnd: Number (optional).
          - count: Number (desired number of articles, default 50, max 100).
          - region: String (e.g. "LatAm", "Spain", "World"). If user specifies "latinoamerica", "españa", etc.
          - outputFormats: Array of strings ["word", "excel", "txt"]. Default ["word"]. If user mentions "excel", "tabla", "hoja de cálculo", include "excel".
          
          Example: "Find me 50 articles on circular economy in LatAm 2021-2025 output Excel and Word"
          Result: { 
            "englishKeywords": ["circular economy", "supply chain", "sustainability"], 
            "spanishKeywords": ["economía circular", "cadena de suministro"], 
            "yearStart": 2021, 
            "yearEnd": 2025, 
            "count": 50, 
            "region": "LatAm",
            "outputFormats": ["excel", "word"]
          }`
                },
                {
                    role: "user",
                    content: userQuery
                }
            ], {
                userId: "system-optimizer",
                model: "grok-beta",
                maxTokens: 500,
                temperature: 0.1
            });

            const text = response.content.replace(/```json/g, "").replace(/```/g, "").trim();
            return JSON.parse(text);

        } catch (error) {
            console.error("[AcademicSearch] LLM Optimization failed, using keyword extraction fallback", error);

            // Use the scopus keyword extractor as a more intelligent fallback
            try {
                const { extractSearchKeywords } = await import("../agent/superAgent/scopusClient");
                const extracted = extractSearchKeywords(userQuery);
                const englishKeywords = extracted.allKeywords.length > 0
                    ? extracted.allKeywords.slice(0, 5)
                    : [userQuery];

                return {
                    englishKeywords,
                    spanishKeywords: [userQuery],
                    yearStart: extracted.yearRange?.start,
                    yearEnd: extracted.yearRange?.end,
                    count: 50,
                    outputFormats: ["word"],
                };
            } catch {
                return {
                    englishKeywords: [userQuery],
                    spanishKeywords: [userQuery],
                    count: 50,
                    outputFormats: ["word"]
                };
            }
        }
    }

    private generateSummary(result: UnifiedSearchResult, files: { name: string; path: string }[], params: any): string {
        const total = result.articles.length;

        const SOURCE_URLS: Record<string, string> = {
            scopus: "https://www.scopus.com",
            wos: "https://www.webofscience.com",
            openalex: "https://openalex.org",
            duckduckgo: "https://duckduckgo.com",
            pubmed: "https://pubmed.ncbi.nlm.nih.gov",
            scielo: "https://scielo.org",
            redalyc: "https://www.redalyc.org",
        };

        const sources = Object.entries(result.totalBySource)
            .filter(([_, count]) => count > 0)
            .map(([source, count]) => {
                const url = SOURCE_URLS[source] || "";
                return `${source} (${count}) 🔗 ${url}`;
            })
            .join("\n  - ");

        const fileLinks = files.map(f => `[Descargar ${f.name}](${f.path})`).join("\n");

        return `## 📚 Búsqueda Académica Completada

**Tema:** ${params.englishKeywords[0]}
**Resultados:** ${total} artículos encontrados.
**Fuentes consultadas:**
  - ${sources || "Ninguna"}
**Archivos Generados:**
${fileLinks}`;
    }
}

/**
 * Convert a region string from the LLM optimizer to a list of affiliation country names
 * that Scopus and OpenAlex can filter on.
 */
function regionToAffilCountries(region: string | undefined): string[] | undefined {
    if (!region) return undefined;
    const r = region.toLowerCase().trim();

    const LATAM_COUNTRIES = [
        "Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Costa Rica",
        "Cuba", "Dominican Republic", "Ecuador", "El Salvador", "Guatemala",
        "Honduras", "Mexico", "Nicaragua", "Panama", "Paraguay", "Peru",
        "Puerto Rico", "Uruguay", "Venezuela",
    ];

    if (r === "latam" || r === "latinoamerica" || r === "latin america" || r === "latinoamérica") {
        return LATAM_COUNTRIES;
    }
    if (r === "spain" || r === "españa" || r === "espana") {
        return ["Spain"];
    }
    if (r === "latam+spain" || r === "iberoamerica" || r === "iberoamérica") {
        return [...LATAM_COUNTRIES, "Spain", "Portugal"];
    }
    if (r === "world" || r === "global" || r === "mundial") {
        return undefined; // No filter
    }

    // If it looks like a single country name, pass it through
    if (r.length > 2 && r.length < 40) {
        return [region];
    }

    return undefined;
}

export const academicSearchService = new AcademicSearchService();
