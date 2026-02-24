/**
 * Academic Research Engine v2.0
 * 
 * Enterprise-grade academic paper search with multi-source aggregation.
 * Priority: SciELO → OpenAlex → Semantic Scholar → CrossRef
 * 
 * Features:
 * - Multi-source parallel search
 * - Deduplication by DOI
 * - Geographic filtering (Latin America + Spain)
 * - Date range filtering
 * - Citation generation (APA 7, MLA, Chicago, Harvard, IEEE)
 * - Multi-format export (Excel, Word, BibTeX, RIS)
 */

import ExcelJS from "exceljs";
import { sanitizePlainText } from "../lib/textSanitizers";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface AcademicPaper {
  id: string;
  title: string;
  authors: Author[];
  year: number;
  journal?: string;
  abstract?: string;
  keywords?: string[];
  doi?: string;
  url?: string;
  language?: string;
  documentType?: string;
  cityOfPublication?: string;
  countryOfStudy?: string;
  affiliation?: string;
  citationCount?: number;
  source: "scielo" | "openalex" | "semantic_scholar" | "crossref" | "core";
  rawData?: any;
}

export interface Author {
  name: string;
  affiliation?: string;
  country?: string;
  orcid?: string;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  yearFrom?: number;
  yearTo?: number;
  countries?: string[];
  languages?: string[];
  documentTypes?: string[];
  sources?: ("scielo" | "openalex" | "semantic_scholar" | "crossref" | "core")[];
}

export interface SearchResult {
  papers: AcademicPaper[];
  totalFound: number;
  sources: { name: string; count: number; errors?: string }[];
  searchTime: number;
  deduplicated: number;
}

export interface CitationStyle {
  format: "apa7" | "mla9" | "chicago" | "harvard" | "ieee" | "vancouver";
}

// ============================================================================
// CONSTANTS
// ============================================================================

const LATIN_AMERICA_COUNTRIES = [
  "argentina", "bolivia", "brazil", "brasil", "chile", "colombia", "costa rica",
  "cuba", "dominican republic", "ecuador", "el salvador", "guatemala", "honduras",
  "mexico", "méxico", "nicaragua", "panama", "panamá", "paraguay", "peru", "perú",
  "puerto rico", "uruguay", "venezuela"
];

const SPAIN_COUNTRIES = ["spain", "españa"];

const ALL_TARGET_COUNTRIES = [...LATIN_AMERICA_COUNTRIES, ...SPAIN_COUNTRIES];

const API_TIMEOUT = 15000; // 15 seconds

// ============================================================================
// API CLIENTS
// ============================================================================

/**
 * SciELO API Client
 * Primary source for Latin American and Iberian research
 * API: https://search.scielo.org/
 */
async function searchSciELO(query: string, maxResults: number = 50): Promise<AcademicPaper[]> {
  const papers: AcademicPaper[] = [];
  
  try {
    // SciELO uses a search API similar to Solr
    const searchUrl = `https://search.scielo.org/?q=${encodeURIComponent(query)}&lang=en&count=${maxResults}&output=json`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);
    
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "IliaGPT Academic Research Engine/2.0"
      }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      console.log(`[SciELO] Search failed: ${response.status}`);
      return papers;
    }
    
    const data = await response.json();
    
    // Parse SciELO response (structure varies)
    if (data.response?.docs) {
      for (const doc of data.response.docs.slice(0, maxResults)) {
        papers.push({
          id: doc.id || `scielo_${Date.now()}_${Math.random()}`,
          title: doc.ti || doc.title || "",
          authors: parseAuthors(doc.au || []),
          year: parseInt(doc.year || doc.da?.substring(0, 4) || "0"),
          journal: doc.ta || doc.journal || "",
          abstract: doc.ab || "",
          keywords: doc.kw || [],
          doi: doc.doi || "",
          url: doc.ur || doc.fulltext_html || "",
          language: doc.la || "es",
          documentType: doc.type || "article",
          countryOfStudy: doc.country || "",
          source: "scielo",
          rawData: doc
        });
      }
    }
    
    console.log(`[SciELO] Found ${papers.length} papers`);
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.log("[SciELO] Request timeout");
    } else {
      console.error("[SciELO] Error:", error.message);
    }
  }
  
  return papers;
}

/**
 * OpenAlex API Client
 * Comprehensive academic database with 250M+ works
 * API: https://docs.openalex.org/
 */
async function searchOpenAlex(query: string, maxResults: number = 50, yearFrom?: number, yearTo?: number): Promise<AcademicPaper[]> {
  const papers: AcademicPaper[] = [];
  
  try {
    let searchUrl = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${Math.min(maxResults, 200)}`;
    
    // Add year filter
    if (yearFrom || yearTo) {
      const from = yearFrom || 1900;
      const to = yearTo || new Date().getFullYear();
      searchUrl += `&filter=publication_year:${from}-${to}`;
    }
    
    // Request specific fields
    searchUrl += "&select=id,title,authorships,publication_year,primary_location,abstract_inverted_index,keywords,doi,language,type,cited_by_count";
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);
    
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "IliaGPT Academic Research Engine/2.0 (mailto:contact@iliagpt.com)"
      }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      console.log(`[OpenAlex] Search failed: ${response.status}`);
      return papers;
    }
    
    const data = await response.json();
    
    if (data.results) {
      for (const work of data.results) {
        // Reconstruct abstract from inverted index
        let abstract = "";
        if (work.abstract_inverted_index) {
          const words: { word: string; pos: number }[] = [];
          for (const [word, positions] of Object.entries(work.abstract_inverted_index)) {
            for (const pos of positions as number[]) {
              words.push({ word, pos });
            }
          }
          words.sort((a, b) => a.pos - b.pos);
          abstract = words.map(w => w.word).join(" ");
        }
        
        // Extract authors with affiliations
        const authors: Author[] = (work.authorships || []).map((a: any) => ({
          name: a.author?.display_name || "Unknown",
          affiliation: a.institutions?.[0]?.display_name || "",
          country: a.institutions?.[0]?.country_code || "",
          orcid: a.author?.orcid || ""
        }));
        
        papers.push({
          id: work.id || `openalex_${Date.now()}`,
          title: work.title || "",
          authors,
          year: work.publication_year || 0,
          journal: work.primary_location?.source?.display_name || "",
          abstract,
          keywords: (work.keywords || []).map((k: any) => k.keyword || k),
          doi: work.doi?.replace("https://doi.org/", "") || "",
          url: work.primary_location?.landing_page_url || work.doi || "",
          language: work.language || "en",
          documentType: work.type || "article",
          citationCount: work.cited_by_count || 0,
          countryOfStudy: authors[0]?.country || "",
          source: "openalex",
          rawData: work
        });
      }
    }
    
    console.log(`[OpenAlex] Found ${papers.length} papers`);
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.log("[OpenAlex] Request timeout");
    } else {
      console.error("[OpenAlex] Error:", error.message);
    }
  }
  
  return papers;
}

/**
 * Semantic Scholar API Client
 * 200M+ papers with semantic search
 * API: https://api.semanticscholar.org/
 */
async function searchSemanticScholar(query: string, maxResults: number = 50, yearFrom?: number, yearTo?: number): Promise<AcademicPaper[]> {
  const papers: AcademicPaper[] = [];
  
  try {
    let searchUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${Math.min(maxResults, 100)}`;
    searchUrl += "&fields=paperId,title,authors,year,venue,abstract,citationCount,externalIds,publicationTypes,s2FieldsOfStudy";
    
    // Add year filter
    if (yearFrom) searchUrl += `&year=${yearFrom}-`;
    if (yearTo) searchUrl += yearTo;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);
    
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "IliaGPT Academic Research Engine/2.0"
      }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      console.log(`[SemanticScholar] Search failed: ${response.status}`);
      return papers;
    }
    
    const data = await response.json();
    
    if (data.data) {
      for (const paper of data.data) {
        papers.push({
          id: paper.paperId || `ss_${Date.now()}`,
          title: paper.title || "",
          authors: (paper.authors || []).map((a: any) => ({ name: a.name || "Unknown" })),
          year: paper.year || 0,
          journal: paper.venue || "",
          abstract: paper.abstract || "",
          keywords: (paper.s2FieldsOfStudy || []).map((f: any) => f.category),
          doi: paper.externalIds?.DOI || "",
          url: paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : "",
          documentType: paper.publicationTypes?.[0] || "article",
          citationCount: paper.citationCount || 0,
          source: "semantic_scholar",
          rawData: paper
        });
      }
    }
    
    console.log(`[SemanticScholar] Found ${papers.length} papers`);
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.log("[SemanticScholar] Request timeout");
    } else {
      console.error("[SemanticScholar] Error:", error.message);
    }
  }
  
  return papers;
}

/**
 * CrossRef API Client
 * 140M+ DOIs with official metadata
 * API: https://api.crossref.org/
 */
async function searchCrossRef(query: string, maxResults: number = 50, yearFrom?: number, yearTo?: number): Promise<AcademicPaper[]> {
  const papers: AcademicPaper[] = [];
  
  try {
    let searchUrl = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${Math.min(maxResults, 100)}`;
    
    // Add year filter
    if (yearFrom || yearTo) {
      const from = yearFrom || 1900;
      const to = yearTo || new Date().getFullYear();
      searchUrl += `&filter=from-pub-date:${from},until-pub-date:${to}`;
    }
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);
    
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "IliaGPT Academic Research Engine/2.0 (mailto:contact@iliagpt.com)"
      }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      console.log(`[CrossRef] Search failed: ${response.status}`);
      return papers;
    }
    
    const data = await response.json();
    
    if (data.message?.items) {
      for (const item of data.message.items) {
        const authors: Author[] = (item.author || []).map((a: any) => ({
          name: `${a.given || ""} ${a.family || ""}`.trim(),
          affiliation: a.affiliation?.[0]?.name || ""
        }));
        
	        papers.push({
	          id: item.DOI || `crossref_${Date.now()}`,
	          title: item.title?.[0] || "",
	          authors,
	          year: item.published?.["date-parts"]?.[0]?.[0] || 0,
	          journal: item["container-title"]?.[0] || "",
	          abstract: sanitizePlainText(item.abstract, { maxLen: 12000, collapseWs: true }),
	          keywords: item.subject || [],
	          doi: item.DOI || "",
	          url: item.URL || `https://doi.org/${item.DOI}`,
	          language: item.language || "en",
          documentType: item.type || "article",
          cityOfPublication: item.publisher_location || "",
          source: "crossref",
          rawData: item
        });
      }
    }
    
    console.log(`[CrossRef] Found ${papers.length} papers`);
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.log("[CrossRef] Request timeout");
    } else {
      console.error("[CrossRef] Error:", error.message);
    }
  }
  
  return papers;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function parseAuthors(authorData: any): Author[] {
  if (!authorData) return [];
  if (typeof authorData === "string") {
    return authorData.split(";").map(name => ({ name: name.trim() }));
  }
  if (Array.isArray(authorData)) {
    return authorData.map(a => {
      if (typeof a === "string") return { name: a.trim() };
      return { name: a.name || a.display_name || "Unknown", affiliation: a.affiliation || "" };
    });
  }
  return [];
}

function deduplicatePapers(papers: AcademicPaper[]): AcademicPaper[] {
  const seen = new Map<string, AcademicPaper>();
  
  for (const paper of papers) {
    // Use DOI as primary key, fallback to normalized title
    const key = paper.doi?.toLowerCase() || 
                paper.title.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 100);
    
    if (!seen.has(key)) {
      seen.set(key, paper);
    } else {
      // Prefer paper with more data
      const existing = seen.get(key)!;
      if ((paper.abstract?.length || 0) > (existing.abstract?.length || 0)) {
        seen.set(key, paper);
      }
    }
  }
  
  return Array.from(seen.values());
}

function filterByCountry(papers: AcademicPaper[], targetCountries: string[]): AcademicPaper[] {
  if (targetCountries.length === 0) return papers;
  
  const normalizedTargets = targetCountries.map(c => c.toLowerCase());
  
  return papers.filter(paper => {
    // Check country of study
    if (paper.countryOfStudy) {
      const country = paper.countryOfStudy.toLowerCase();
      if (normalizedTargets.some(t => country.includes(t))) return true;
    }
    
    // Check author affiliations
    for (const author of paper.authors) {
      if (author.country) {
        const country = author.country.toLowerCase();
        if (normalizedTargets.some(t => country.includes(t) || t.includes(country))) return true;
      }
      if (author.affiliation) {
        const aff = author.affiliation.toLowerCase();
        if (normalizedTargets.some(t => aff.includes(t))) return true;
      }
    }
    
    // Check if abstract/title mentions target countries
    const text = `${paper.title} ${paper.abstract || ""}`.toLowerCase();
    if (normalizedTargets.some(t => text.includes(t))) return true;
    
    return false;
  });
}

// ============================================================================
// CITATION GENERATORS
// ============================================================================

export function generateAPACitation(paper: AcademicPaper): string {
  // APA 7th Edition format
  const authors = formatAuthorsAPA(paper.authors);
  const year = paper.year ? `(${paper.year})` : "(n.d.)";
  const title = paper.title;
  const journal = paper.journal ? `*${paper.journal}*` : "";
  const doi = paper.doi ? `🔗 https://doi.org/${paper.doi}` : (paper.url ? `🔗 ${paper.url}` : "");

  let citation = `${authors} ${year}. ${title}.`;
  if (journal) citation += ` ${journal}.`;
  if (doi) citation += ` ${doi}`;

  return citation.trim();
}

function formatAuthorsAPA(authors: Author[]): string {
  if (!authors || authors.length === 0) return "Unknown Author";
  
  if (authors.length === 1) {
    return formatAuthorNameAPA(authors[0].name);
  } else if (authors.length === 2) {
    return `${formatAuthorNameAPA(authors[0].name)} & ${formatAuthorNameAPA(authors[1].name)}`;
  } else if (authors.length <= 20) {
    const formatted = authors.slice(0, -1).map(a => formatAuthorNameAPA(a.name)).join(", ");
    return `${formatted}, & ${formatAuthorNameAPA(authors[authors.length - 1].name)}`;
  } else {
    // More than 20 authors: show first 19, ellipsis, then last
    const first19 = authors.slice(0, 19).map(a => formatAuthorNameAPA(a.name)).join(", ");
    return `${first19}, ... ${formatAuthorNameAPA(authors[authors.length - 1].name)}`;
  }
}

function formatAuthorNameAPA(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  
  const lastName = parts[parts.length - 1];
  const initials = parts.slice(0, -1).map(p => p.charAt(0).toUpperCase() + ".").join(" ");
  
  return `${lastName}, ${initials}`;
}

export function generateMLACitation(paper: AcademicPaper): string {
  // MLA 9th Edition format
  const authors = formatAuthorsMLA(paper.authors);
  const title = `"${paper.title}."`;
  const journal = paper.journal ? `*${paper.journal}*,` : "";
  const year = paper.year ? `${paper.year}` : "n.d.";
  const doi = paper.doi ? `doi:${paper.doi}.` : "";
  
  return `${authors} ${title} ${journal} ${year}. ${doi}`.replace(/\s+/g, " ").trim();
}

function formatAuthorsMLA(authors: Author[]): string {
  if (!authors || authors.length === 0) return "Unknown Author.";
  if (authors.length === 1) return `${authors[0].name}.`;
  if (authors.length === 2) return `${authors[0].name}, and ${authors[1].name}.`;
  return `${authors[0].name}, et al.`;
}

export function generateChicagoCitation(paper: AcademicPaper): string {
  // Chicago Author-Date format
  const authors = formatAuthorsChicago(paper.authors);
  const year = paper.year || "n.d.";
  const title = `"${paper.title}."`;
  const journal = paper.journal ? `*${paper.journal}*` : "";
  const doi = paper.doi ? `🔗 https://doi.org/${paper.doi}` : (paper.url ? `🔗 ${paper.url}` : "");

  return `${authors} ${year}. ${title} ${journal}. ${doi}`.replace(/\s+/g, " ").trim();
}

function formatAuthorsChicago(authors: Author[]): string {
  if (!authors || authors.length === 0) return "Unknown Author";
  if (authors.length === 1) return authors[0].name;
  if (authors.length <= 3) return authors.map(a => a.name).join(", ");
  return `${authors[0].name} et al.`;
}

export function generateVancouverCitation(paper: AcademicPaper): string {
  // Vancouver (ICMJE) numbered style — used in biomedical sciences
  const authors = formatAuthorsVancouver(paper.authors);
  const title = paper.title.endsWith(".") ? paper.title : `${paper.title}.`;
  const journal = paper.journal || "";
  const year = paper.year || "n.d.";
  const doi = paper.doi ? ` doi:${paper.doi}` : "";

  if (journal) {
    return `${authors} ${title} ${abbreviateJournal(journal)}. ${year}.${doi}`;
  }
  return `${authors} ${title} ${year}.${doi}`;
}

function formatAuthorsVancouver(authors: Author[]): string {
  if (!authors || authors.length === 0) return "Unknown.";
  if (authors.length <= 6) {
    return authors.map(a => formatAuthorNameVancouver(a.name)).join(", ") + ".";
  }
  // 7+ authors: list first 6, then et al.
  const first6 = authors.slice(0, 6).map(a => formatAuthorNameVancouver(a.name)).join(", ");
  return `${first6}, et al.`;
}

function formatAuthorNameVancouver(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const lastName = parts[parts.length - 1];
  const initials = parts.slice(0, -1).map(p => p.charAt(0).toUpperCase()).join("");
  return `${lastName} ${initials}`;
}

function abbreviateJournal(journal: string): string {
  // Simple abbreviation: remove common articles/prepositions, truncate words > 4 chars
  return journal
    .replace(/\b(the|of|and|in|for|on|a|an)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function generateHarvardCitation(paper: AcademicPaper): string {
  const authors = formatAuthorsHarvard(paper.authors);
  const year = paper.year || "n.d.";
  const title = `'${paper.title}'`;
  const journal = paper.journal ? `*${paper.journal}*` : "";
  const doi = paper.doi ? `doi:${paper.doi}` : "";

  return `${authors} (${year}) ${title}, ${journal}. ${doi}`.replace(/\s+/g, " ").trim();
}

function formatAuthorsHarvard(authors: Author[]): string {
  if (!authors || authors.length === 0) return "Unknown";
  if (authors.length === 1) return authors[0].name;
  if (authors.length === 2) return `${authors[0].name} and ${authors[1].name}`;
  return `${authors[0].name} et al.`;
}

export function generateIEEECitation(paper: AcademicPaper): string {
  const authors = formatAuthorsIEEE(paper.authors);
  const title = `"${paper.title},"`;
  const journal = paper.journal ? `*${paper.journal}*,` : "";
  const year = paper.year ? `${paper.year}` : "n.d.";
  const doi = paper.doi ? `doi: ${paper.doi}.` : "";

  return `${authors} ${title} ${journal} ${year}. ${doi}`.replace(/\s+/g, " ").trim();
}

function formatAuthorsIEEE(authors: Author[]): string {
  if (!authors || authors.length === 0) return "Unknown,";
  return authors.map(a => {
    const parts = a.name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const lastName = parts[parts.length - 1];
    const initials = parts.slice(0, -1).map(p => p.charAt(0).toUpperCase() + ".").join(" ");
    return `${initials} ${lastName}`;
  }).join(", ") + ",";
}

/**
 * Export papers to RIS format (Research Information Systems).
 * Compatible with EndNote, Zotero, Mendeley, etc.
 */
export function exportToRIS(papers: AcademicPaper[]): string {
  const entries: string[] = [];

  for (const paper of papers) {
    const lines: string[] = [];
    lines.push("TY  - JOUR");

    for (const author of paper.authors) {
      lines.push(`AU  - ${author.name}`);
    }

    lines.push(`TI  - ${paper.title}`);

    if (paper.journal) lines.push(`JO  - ${paper.journal}`);
    if (paper.year) lines.push(`PY  - ${paper.year}`);
    if (paper.abstract) lines.push(`AB  - ${paper.abstract}`);
    if (paper.doi) lines.push(`DO  - ${paper.doi}`);
    if (paper.url) lines.push(`UR  - ${paper.url}`);
    if (paper.language) lines.push(`LA  - ${paper.language}`);

    if (paper.keywords) {
      for (const kw of paper.keywords) {
        lines.push(`KW  - ${kw}`);
      }
    }

    lines.push(`DB  - ${paper.source}`);
    lines.push("ER  - ");

    entries.push(lines.join("\n"));
  }

  return entries.join("\n\n");
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

export async function exportToExcel(papers: AcademicPaper[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IliaGPT Academic Research Engine";
  workbook.created = new Date();
  
  const worksheet = workbook.addWorksheet("Academic Papers", {
    properties: { tabColor: { argb: "1A365D" } }
  });
  
  // Define columns
  worksheet.columns = [
    { header: "#", key: "num", width: 5 },
    { header: "Authors", key: "authors", width: 40 },
    { header: "Title", key: "title", width: 60 },
    { header: "Year", key: "year", width: 8 },
    { header: "Journal", key: "journal", width: 40 },
    { header: "Abstract", key: "abstract", width: 80 },
    { header: "Keywords", key: "keywords", width: 30 },
    { header: "Language", key: "language", width: 10 },
    { header: "Document Type", key: "documentType", width: 15 },
    { header: "DOI", key: "doi", width: 30 },
    { header: "City of Publication", key: "city", width: 20 },
    { header: "Country of Study", key: "country", width: 20 },
    { header: "Citation Count", key: "citations", width: 12 },
    { header: "Source", key: "source", width: 15 },
    { header: "APA 7 Citation", key: "apaCitation", width: 100 },
  ];
  
  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "1A365D" }
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  
  // Add data rows
  papers.forEach((paper, index) => {
    worksheet.addRow({
      num: index + 1,
      authors: paper.authors.map(a => a.name).join("; "),
      title: paper.title,
      year: paper.year || "",
      journal: paper.journal || "",
      abstract: paper.abstract || "",
      keywords: (paper.keywords || []).join("; "),
      language: paper.language || "",
      documentType: paper.documentType || "",
      doi: paper.doi || "",
      city: paper.cityOfPublication || "",
      country: paper.countryOfStudy || "",
      citations: paper.citationCount || 0,
      source: paper.source,
      apaCitation: generateAPACitation(paper),
    });
  });
  
  // Auto-filter
  worksheet.autoFilter = {
    from: "A1",
    to: `O${papers.length + 1}`
  };
  
  // Freeze header row
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function exportToBibTeX(papers: AcademicPaper[]): string {
  const entries: string[] = [];
  
  for (const paper of papers) {
    const key = generateBibTeXKey(paper);
    const authors = paper.authors.map(a => a.name).join(" and ");
    
    let entry = `@article{${key},\n`;
    entry += `  author = {${authors}},\n`;
    entry += `  title = {${paper.title}},\n`;
    if (paper.year) entry += `  year = {${paper.year}},\n`;
    if (paper.journal) entry += `  journal = {${paper.journal}},\n`;
    if (paper.doi) entry += `  doi = {${paper.doi}},\n`;
    if (paper.keywords?.length) entry += `  keywords = {${paper.keywords.join(", ")}},\n`;
    if (paper.abstract) entry += `  abstract = {${paper.abstract.substring(0, 500)}},\n`;
    entry += `}`;
    
    entries.push(entry);
  }
  
  return entries.join("\n\n");
}

function generateBibTeXKey(paper: AcademicPaper): string {
  const firstAuthor = paper.authors[0]?.name.split(" ").pop() || "unknown";
  const year = paper.year || "nd";
  const titleWord = paper.title.split(" ").find(w => w.length > 4)?.toLowerCase() || "paper";
  return `${firstAuthor}${year}${titleWord}`.replace(/[^a-z0-9]/gi, "");
}

// ============================================================================
// MAIN SEARCH ENGINE
// ============================================================================

export class AcademicResearchEngine {
  private defaultSources: SearchOptions["sources"] = ["openalex", "semantic_scholar", "crossref"];
  
  async search(options: SearchOptions): Promise<SearchResult> {
    const startTime = Date.now();
    const sources = options.sources || this.defaultSources;
    const maxPerSource = Math.ceil((options.maxResults || 100) / sources.length);
    
    console.log(`[AcademicEngine] Starting search: "${options.query}" (max: ${options.maxResults}, sources: ${sources.join(", ")})`);
    
    // Search all sources in parallel
    const searchPromises: Promise<{ source: string; papers: AcademicPaper[]; error?: string }>[] = [];
    
    for (const source of sources) {
      switch (source) {
        case "scielo":
          searchPromises.push(
            searchSciELO(options.query, maxPerSource)
              .then(papers => ({ source: "scielo", papers }))
              .catch(e => ({ source: "scielo", papers: [], error: e.message }))
          );
          break;
        case "openalex":
          searchPromises.push(
            searchOpenAlex(options.query, maxPerSource, options.yearFrom, options.yearTo)
              .then(papers => ({ source: "openalex", papers }))
              .catch(e => ({ source: "openalex", papers: [], error: e.message }))
          );
          break;
        case "semantic_scholar":
          searchPromises.push(
            searchSemanticScholar(options.query, maxPerSource, options.yearFrom, options.yearTo)
              .then(papers => ({ source: "semantic_scholar", papers }))
              .catch(e => ({ source: "semantic_scholar", papers: [], error: e.message }))
          );
          break;
        case "crossref":
          searchPromises.push(
            searchCrossRef(options.query, maxPerSource, options.yearFrom, options.yearTo)
              .then(papers => ({ source: "crossref", papers }))
              .catch(e => ({ source: "crossref", papers: [], error: e.message }))
          );
          break;
      }
    }
    
    const results = await Promise.all(searchPromises);
    
    // Aggregate papers
    let allPapers: AcademicPaper[] = [];
    const sourceStats: SearchResult["sources"] = [];
    
    for (const result of results) {
      allPapers.push(...result.papers);
      sourceStats.push({
        name: result.source,
        count: result.papers.length,
        errors: result.error
      });
    }
    
    const totalBeforeDedup = allPapers.length;
    
    // Deduplicate
    allPapers = deduplicatePapers(allPapers);
    
    // Filter by year
    if (options.yearFrom || options.yearTo) {
      allPapers = allPapers.filter(p => {
        if (!p.year) return true;
        if (options.yearFrom && p.year < options.yearFrom) return false;
        if (options.yearTo && p.year > options.yearTo) return false;
        return true;
      });
    }
    
    // Filter by country (if specified)
    if (options.countries && options.countries.length > 0) {
      allPapers = filterByCountry(allPapers, options.countries);
    }
    
    // Limit results
    if (options.maxResults && allPapers.length > options.maxResults) {
      allPapers = allPapers.slice(0, options.maxResults);
    }
    
    const searchTime = Date.now() - startTime;
    
    console.log(`[AcademicEngine] Search complete: ${allPapers.length} papers (${totalBeforeDedup - allPapers.length} deduplicated) in ${searchTime}ms`);
    
    return {
      papers: allPapers,
      totalFound: allPapers.length,
      sources: sourceStats,
      searchTime,
      deduplicated: totalBeforeDedup - allPapers.length
    };
  }
  
  async searchLatinAmericaAndSpain(query: string, maxResults: number = 100, yearFrom?: number, yearTo?: number): Promise<SearchResult> {
    return this.search({
      query,
      maxResults,
      yearFrom,
      yearTo,
      countries: ALL_TARGET_COUNTRIES,
      sources: ["openalex", "semantic_scholar", "crossref"]
    });
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const academicEngine = new AcademicResearchEngine();

export default academicEngine;
