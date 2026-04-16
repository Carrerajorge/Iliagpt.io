/**
 * Semantic Scholar API Client
 * 
 * Features:
 * - Paper search with citation counts
 * - Author disambiguation
 * - Related papers recommendations
 * - Rate limit aware
 */

import { executeWithHealing } from "./selfHealing";

const SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1";
const API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || "";

// Rate limiting: 100 requests per 5 minutes without API key
const RATE_LIMIT_DELAY = API_KEY ? 100 : 3000; // ms between requests

export interface SemanticScholarPaper {
    paperId: string;
    title: string;
    abstract?: string;
    year?: number;
    citationCount?: number;
    referenceCount?: number;
    influentialCitationCount?: number;
    authors: {
        authorId?: string;
        name: string;
    }[];
    venue?: string;
    publicationVenue?: {
        id?: string;
        name?: string;
        type?: string;
    };
    openAccessPdf?: {
        url: string;
        status: string;
    };
    externalIds?: {
        DOI?: string;
        ArXiv?: string;
        PubMed?: string;
        DBLP?: string;
    };
    url: string;
    fieldsOfStudy?: string[];
    s2FieldsOfStudy?: {
        category: string;
        source: string;
    }[];
    tldr?: {
        text: string;
    };
}

export interface SearchResult {
    total: number;
    offset: number;
    papers: SemanticScholarPaper[];
    query: string;
    durationMs: number;
}

export interface AuthorInfo {
    authorId: string;
    name: string;
    affiliations?: string[];
    paperCount?: number;
    citationCount?: number;
    hIndex?: number;
}

// Build request headers
function getHeaders(): HeadersInit {
    const headers: HeadersInit = {
        "Content-Type": "application/json",
    };

    if (API_KEY) {
        headers["x-api-key"] = API_KEY;
    }

    return headers;
}

// Search for papers
export async function searchPapers(
    query: string,
    options: {
        limit?: number;
        offset?: number;
        year?: string;         // e.g., "2020-2024" or "2023"
        fieldsOfStudy?: string[];
        openAccessOnly?: boolean;
    } = {}
): Promise<SearchResult> {
    const {
        limit = 20,
        offset = 0,
        year,
        fieldsOfStudy,
        openAccessOnly = false,
    } = options;

    const startTime = Date.now();

    // Build query params
    const params = new URLSearchParams({
        query,
        limit: limit.toString(),
        offset: offset.toString(),
        fields: [
            "paperId",
            "title",
            "abstract",
            "year",
            "citationCount",
            "referenceCount",
            "influentialCitationCount",
            "authors",
            "venue",
            "publicationVenue",
            "openAccessPdf",
            "externalIds",
            "url",
            "fieldsOfStudy",
            "s2FieldsOfStudy",
            "tldr",
        ].join(","),
    });

    if (year) {
        params.append("year", year);
    }

    if (fieldsOfStudy?.length) {
        params.append("fieldsOfStudy", fieldsOfStudy.join(","));
    }

    if (openAccessOnly) {
        params.append("openAccessPdf", "");
    }

    const url = `${SEMANTIC_SCHOLAR_API}/paper/search?${params}`;

    console.log(`[SemanticScholar] Searching: ${query}`);

    const result = await executeWithHealing(
        "semantic_scholar",
        async () => {
            const response = await fetch(url, {
                method: "GET",
                headers: getHeaders(),
            });

            if (!response.ok) {
                throw new Error(`Semantic Scholar API error: ${response.status}`);
            }

            return response.json();
        },
        {
            maxRetries: 3,
            onRetry: (attempt) => {
                console.log(`[SemanticScholar] Retry ${attempt}...`);
            },
        }
    );

    const data = result.result;

    // Add rate limit delay
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));

    return {
        total: data.total || 0,
        offset: data.offset || offset,
        papers: data.data || [],
        query,
        durationMs: Date.now() - startTime,
    };
}

// Get paper details by ID
export async function getPaperDetails(paperId: string): Promise<SemanticScholarPaper | null> {
    const params = new URLSearchParams({
        fields: [
            "paperId",
            "title",
            "abstract",
            "year",
            "citationCount",
            "referenceCount",
            "influentialCitationCount",
            "authors",
            "venue",
            "publicationVenue",
            "openAccessPdf",
            "externalIds",
            "url",
            "fieldsOfStudy",
            "s2FieldsOfStudy",
            "tldr",
        ].join(","),
    });

    const url = `${SEMANTIC_SCHOLAR_API}/paper/${paperId}?${params}`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: getHeaders(),
        });

        if (!response.ok) {
            console.error(`[SemanticScholar] Paper not found: ${paperId}`);
            return null;
        }

        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));

        return response.json();
    } catch (error) {
        console.error(`[SemanticScholar] Error fetching paper ${paperId}:`, error);
        return null;
    }
}

// Get related papers (citations and references)
export async function getRelatedPapers(
    paperId: string,
    type: "citations" | "references" = "citations",
    limit = 10
): Promise<SemanticScholarPaper[]> {
    const params = new URLSearchParams({
        fields: "paperId,title,year,citationCount,authors,venue,url",
        limit: limit.toString(),
    });

    const url = `${SEMANTIC_SCHOLAR_API}/paper/${paperId}/${type}?${params}`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: getHeaders(),
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));

        return (data.data || []).map((item: any) => item.citingPaper || item.citedPaper);
    } catch (error) {
        console.error(`[SemanticScholar] Error fetching ${type}:`, error);
        return [];
    }
}

// Get author details
export async function getAuthorDetails(authorId: string): Promise<AuthorInfo | null> {
    const params = new URLSearchParams({
        fields: "authorId,name,affiliations,paperCount,citationCount,hIndex",
    });

    const url = `${SEMANTIC_SCHOLAR_API}/author/${authorId}?${params}`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: getHeaders(),
        });

        if (!response.ok) {
            return null;
        }

        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));

        return response.json();
    } catch (error) {
        console.error(`[SemanticScholar] Error fetching author ${authorId}:`, error);
        return null;
    }
}

// Search by DOI
export async function getPaperByDOI(doi: string): Promise<SemanticScholarPaper | null> {
    return getPaperDetails(`DOI:${doi}`);
}

// Search by ArXiv ID
export async function getPaperByArXiv(arxivId: string): Promise<SemanticScholarPaper | null> {
    return getPaperDetails(`ARXIV:${arxivId}`);
}

// Recommendations based on a set of papers
export async function getRecommendations(
    paperIds: string[],
    limit = 10
): Promise<SemanticScholarPaper[]> {
    if (paperIds.length === 0) return [];

    const url = `${SEMANTIC_SCHOLAR_API}/recommendations`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({
                positivePaperIds: paperIds.slice(0, 5), // Max 5
                negativePaperIds: [],
                fields: "paperId,title,year,citationCount,authors,venue,url,abstract",
                limit,
            }),
        });

        if (!response.ok) {
            console.error(`[SemanticScholar] Recommendations failed: ${response.status}`);
            return [];
        }

        const data = await response.json();
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));

        return data.recommendedPapers || [];
    } catch (error) {
        console.error(`[SemanticScholar] Error getting recommendations:`, error);
        return [];
    }
}

// Convert to SourceSignal format for pipeline compatibility
export function toSourceSignal(paper: SemanticScholarPaper) {
    return {
        id: `ss_${paper.paperId}`,
        title: paper.title,
        url: paper.url,
        snippet: paper.abstract || paper.tldr?.text || "",
        score: Math.min(100, (paper.citationCount || 0) / 10),
        source: "Semantic Scholar",
        type: "academic",
        metadata: {
            year: paper.year,
            citations: paper.citationCount,
            authors: paper.authors.map(a => a.name).join(", "),
            venue: paper.venue || paper.publicationVenue?.name,
            doi: paper.externalIds?.DOI,
            openAccess: !!paper.openAccessPdf,
            pdfUrl: paper.openAccessPdf?.url,
            fields: paper.fieldsOfStudy,
        },
    };
}

export default {
    searchPapers,
    getPaperDetails,
    getRelatedPapers,
    getAuthorDetails,
    getPaperByDOI,
    getPaperByArXiv,
    getRecommendations,
    toSourceSignal,
};
