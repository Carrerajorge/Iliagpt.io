/**
 * Advanced Integrations Module v4.0
 * Improvements 501-600: Integrations
 * 
 * 501-530: New Data Sources
 * 531-550: Export Integrations
 * 551-570: Communication Integrations
 * 571-600: AI Integrations
 */

// ============================================
// TYPES
// ============================================

export interface DataSource {
  id: string;
  name: string;
  type: "api" | "scrape" | "hybrid";
  baseUrl: string;
  requiresKey: boolean;
  rateLimit: number; // requests per minute
  timeout: number;
  fields: string[];
}

export interface SearchResult {
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  doi?: string;
  url?: string;
  source: string;
  citations?: number;
}

export interface ExportFormat {
  id: string;
  name: string;
  extension: string;
  mimeType: string;
}

export interface AIProvider {
  id: string;
  name: string;
  model: string;
  capabilities: string[];
}

// ============================================
// 501-530: NEW DATA SOURCES
// ============================================

// Source configurations
export const DATA_SOURCES: Record<string, DataSource> = {
  // 501. arXiv
  arxiv: {
    id: "arxiv",
    name: "arXiv",
    type: "api",
    baseUrl: "http://export.arxiv.org/api/query",
    requiresKey: false,
    rateLimit: 30,
    timeout: 10000,
    fields: ["title", "authors", "abstract", "doi", "categories", "published"]
  },
  // 502. bioRxiv
  biorxiv: {
    id: "biorxiv",
    name: "bioRxiv",
    type: "api",
    baseUrl: "https://api.biorxiv.org/details/biorxiv",
    requiresKey: false,
    rateLimit: 30,
    timeout: 10000,
    fields: ["title", "authors", "abstract", "doi", "category", "date"]
  },
  // 503. medRxiv
  medrxiv: {
    id: "medrxiv",
    name: "medRxiv",
    type: "api",
    baseUrl: "https://api.biorxiv.org/details/medrxiv",
    requiresKey: false,
    rateLimit: 30,
    timeout: 10000,
    fields: ["title", "authors", "abstract", "doi", "category", "date"]
  },
  // 507. ORCID
  orcid: {
    id: "orcid",
    name: "ORCID",
    type: "api",
    baseUrl: "https://pub.orcid.org/v3.0",
    requiresKey: false,
    rateLimit: 24,
    timeout: 10000,
    fields: ["name", "works", "affiliations", "education"]
  },
  // 508. OpenAlex
  openalex: {
    id: "openalex",
    name: "OpenAlex",
    type: "api",
    baseUrl: "https://api.openalex.org",
    requiresKey: false,
    rateLimit: 100,
    timeout: 10000,
    fields: ["title", "authors", "abstract", "doi", "cited_by_count", "concepts"]
  },
  // 515. Unpaywall
  unpaywall: {
    id: "unpaywall",
    name: "Unpaywall",
    type: "api",
    baseUrl: "https://api.unpaywall.org/v2",
    requiresKey: true, // email required
    rateLimit: 100,
    timeout: 5000,
    fields: ["is_oa", "oa_locations", "best_oa_location"]
  },
  // 516. OpenCitations
  opencitations: {
    id: "opencitations",
    name: "OpenCitations",
    type: "api",
    baseUrl: "https://opencitations.net/index/coci/api/v1",
    requiresKey: false,
    rateLimit: 60,
    timeout: 10000,
    fields: ["citing", "cited", "creation", "timespan"]
  },
  // 517. DataCite
  datacite: {
    id: "datacite",
    name: "DataCite",
    type: "api",
    baseUrl: "https://api.datacite.org",
    requiresKey: false,
    rateLimit: 60,
    timeout: 10000,
    fields: ["doi", "titles", "creators", "descriptions", "subjects"]
  },
  // 518. Zenodo
  zenodo: {
    id: "zenodo",
    name: "Zenodo",
    type: "api",
    baseUrl: "https://zenodo.org/api",
    requiresKey: false,
    rateLimit: 60,
    timeout: 10000,
    fields: ["title", "creators", "description", "doi", "keywords"]
  },
  // 522. Papers with Code
  paperswithcode: {
    id: "paperswithcode",
    name: "Papers With Code",
    type: "api",
    baseUrl: "https://paperswithcode.com/api/v1",
    requiresKey: false,
    rateLimit: 60,
    timeout: 10000,
    fields: ["title", "abstract", "url_pdf", "repository_url", "tasks"]
  }
};

// 501. arXiv search
export async function searchArxiv(query: string, maxResults = 10): Promise<SearchResult[]> {
  const url = `${DATA_SOURCES.arxiv.baseUrl}?search_query=all:${encodeURIComponent(query)}&max_results=${maxResults}`;
  
  try {
    const response = await fetch(url, { 
      headers: { "Accept": "application/xml" },
      signal: AbortSignal.timeout(DATA_SOURCES.arxiv.timeout)
    });
    
    if (!response.ok) return [];
    
    const xml = await response.text();
    return parseArxivResponse(xml);
  } catch {
    return [];
  }
}

function parseArxivResponse(xml: string): SearchResult[] {
  const results: SearchResult[] = [];
  
  // Simple regex parsing for arXiv response
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  
  for (const entry of entries) {
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim().replace(/\s+/g, " ");
    const authors = (entry.match(/<name>([\s\S]*?)<\/name>/g) || [])
      .map(a => a.replace(/<\/?name>/g, "").trim());
    const abstract = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim();
    const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1];
    const doi = entry.match(/doi\.org\/([\d.]+\/[^\s<]+)/)?.[1];
    const id = entry.match(/<id>([\s\S]*?)<\/id>/)?.[1];
    
    if (title) {
      results.push({
        title,
        authors,
        year: published ? new Date(published).getFullYear() : 0,
        abstract,
        doi,
        url: id,
        source: "arxiv"
      });
    }
  }
  
  return results;
}

// 508. OpenAlex search
export async function searchOpenAlex(query: string, maxResults = 10): Promise<SearchResult[]> {
  const url = `${DATA_SOURCES.openalex.baseUrl}/works?search=${encodeURIComponent(query)}&per_page=${maxResults}`;
  
  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(DATA_SOURCES.openalex.timeout)
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return (data.results || []).map((work: any) => ({
      title: work.title || "",
      authors: (work.authorships || []).map((a: any) => a.author?.display_name || ""),
      year: work.publication_year || 0,
      abstract: work.abstract_inverted_index ? reconstructAbstract(work.abstract_inverted_index) : undefined,
      doi: work.doi?.replace("https://doi.org/", ""),
      url: work.doi || work.id,
      source: "openalex",
      citations: work.cited_by_count
    }));
  } catch {
    return [];
  }
}

function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  const words: Array<[string, number]> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words.push([word, pos]);
    }
  }
  words.sort((a, b) => a[1] - b[1]);
  return words.map(w => w[0]).join(" ");
}

// 516. OpenCitations - get citations for a DOI
export async function getCitations(doi: string): Promise<{ citing: string[]; cited: string[] }> {
  try {
    const [citingRes, citedRes] = await Promise.all([
      fetch(`${DATA_SOURCES.opencitations.baseUrl}/citations/${doi}`, {
        signal: AbortSignal.timeout(DATA_SOURCES.opencitations.timeout)
      }),
      fetch(`${DATA_SOURCES.opencitations.baseUrl}/references/${doi}`, {
        signal: AbortSignal.timeout(DATA_SOURCES.opencitations.timeout)
      })
    ]);
    
    const citing = citingRes.ok ? (await citingRes.json()).map((c: any) => c.citing) : [];
    const cited = citedRes.ok ? (await citedRes.json()).map((c: any) => c.cited) : [];
    
    return { citing, cited };
  } catch {
    return { citing: [], cited: [] };
  }
}

// 515. Unpaywall - check open access
export async function checkOpenAccess(doi: string, email = "user@example.com"): Promise<{
  isOA: boolean;
  oaUrl?: string;
  license?: string;
}> {
  try {
    const response = await fetch(
      `${DATA_SOURCES.unpaywall.baseUrl}/${doi}?email=${email}`,
      { signal: AbortSignal.timeout(DATA_SOURCES.unpaywall.timeout) }
    );
    
    if (!response.ok) return { isOA: false };
    
    const data = await response.json();
    return {
      isOA: data.is_oa || false,
      oaUrl: data.best_oa_location?.url,
      license: data.best_oa_location?.license
    };
  } catch {
    return { isOA: false };
  }
}

// 518. Zenodo search
export async function searchZenodo(query: string, maxResults = 10): Promise<SearchResult[]> {
  try {
    const response = await fetch(
      `${DATA_SOURCES.zenodo.baseUrl}/records?q=${encodeURIComponent(query)}&size=${maxResults}`,
      { signal: AbortSignal.timeout(DATA_SOURCES.zenodo.timeout) }
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    return (data.hits?.hits || []).map((record: any) => ({
      title: record.metadata?.title || "",
      authors: (record.metadata?.creators || []).map((c: any) => c.name),
      year: record.metadata?.publication_date ? new Date(record.metadata.publication_date).getFullYear() : 0,
      abstract: record.metadata?.description,
      doi: record.metadata?.doi,
      url: record.links?.self,
      source: "zenodo"
    }));
  } catch {
    return [];
  }
}

// ============================================
// 531-550: EXPORT INTEGRATIONS
// ============================================

export const EXPORT_FORMATS: ExportFormat[] = [
  { id: "bibtex", name: "BibTeX", extension: ".bib", mimeType: "application/x-bibtex" },
  { id: "ris", name: "RIS", extension: ".ris", mimeType: "application/x-research-info-systems" },
  { id: "endnote", name: "EndNote XML", extension: ".xml", mimeType: "application/xml" },
  { id: "csl-json", name: "CSL-JSON", extension: ".json", mimeType: "application/json" },
  { id: "mods", name: "MODS XML", extension: ".xml", mimeType: "application/xml" },
  { id: "csv", name: "CSV", extension: ".csv", mimeType: "text/csv" },
  { id: "excel", name: "Excel", extension: ".xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
];

// 531-539. Export to reference managers
export function generateZoteroRDF(results: SearchResult[]): string {
  const items = results.map(r => `
    <bib:Article rdf:about="urn:doi:${r.doi || 'unknown'}">
      <dc:title>${escapeXML(r.title)}</dc:title>
      ${r.authors.map(a => `<dc:creator>${escapeXML(a)}</dc:creator>`).join("\n      ")}
      <dc:date>${r.year}</dc:date>
      ${r.abstract ? `<dcterms:abstract>${escapeXML(r.abstract)}</dcterms:abstract>` : ""}
    </bib:Article>
  `).join("\n");
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:dc="http://purl.org/dc/elements/1.1/"
         xmlns:dcterms="http://purl.org/dc/terms/"
         xmlns:bib="http://purl.org/net/biblio#">
${items}
</rdf:RDF>`;
}

// 540-549. Export to productivity tools
export function generateCSV(results: SearchResult[]): string {
  const headers = ["Title", "Authors", "Year", "DOI", "URL", "Abstract", "Citations", "Source"];
  const rows = results.map(r => [
    `"${(r.title || "").replace(/"/g, '""')}"`,
    `"${(r.authors || []).join("; ").replace(/"/g, '""')}"`,
    r.year || "",
    r.doi || "",
    r.url || "",
    `"${(r.abstract || "").replace(/"/g, '""').substring(0, 500)}"`,
    r.citations || "",
    r.source || ""
  ].join(","));
  
  return [headers.join(","), ...rows].join("\n");
}

export function generateMarkdownTable(results: SearchResult[]): string {
  const headers = "| Title | Authors | Year | Citations | Source |";
  const separator = "|-------|---------|------|-----------|--------|";
  const rows = results.map(r => 
    `| ${r.title.substring(0, 50)}${r.title.length > 50 ? "..." : ""} | ${r.authors.slice(0, 2).join(", ")}${r.authors.length > 2 ? " et al." : ""} | ${r.year} | ${r.citations || "-"} | ${r.source} |`
  );
  
  return [headers, separator, ...rows].join("\n");
}

export function generateNotionBlocks(results: SearchResult[]): object[] {
  return results.map(r => ({
    object: "block",
    type: "callout",
    callout: {
      rich_text: [
        {
          type: "text",
          text: { content: r.title },
          annotations: { bold: true }
        },
        {
          type: "text",
          text: { content: `\n${r.authors.join(", ")} (${r.year})` }
        },
        r.doi ? {
          type: "text",
          text: { content: `\nDOI: ${r.doi}`, link: { url: `https://doi.org/${r.doi}` } }
        } : null
      ].filter(Boolean),
      icon: { emoji: "📄" }
    }
  }));
}

// ============================================
// 551-570: COMMUNICATION INTEGRATIONS
// ============================================

// 551-560. Share to social/professional networks
export function generateTwitterShareUrl(result: SearchResult): string {
  const text = `📚 "${result.title}" by ${result.authors.slice(0, 2).join(", ")}${result.authors.length > 2 ? " et al." : ""} (${result.year})`;
  const url = result.doi ? `https://doi.org/${result.doi}` : result.url || "";
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

export function generateLinkedInShareUrl(result: SearchResult): string {
  const url = result.doi ? `https://doi.org/${result.doi}` : result.url || "";
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}

export function generateRedditShareUrl(result: SearchResult, subreddit = "science"): string {
  const title = `${result.title} (${result.year})`;
  const url = result.doi ? `https://doi.org/${result.doi}` : result.url || "";
  return `https://www.reddit.com/r/${subreddit}/submit?title=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;
}

// 561-565. Generate share links
export function generateShareLink(results: SearchResult[]): string {
  // In a real implementation, this would create a shareable link
  const ids = results.map(r => r.doi || r.url).filter(Boolean).join(",");
  return `https://iliagpt.com/share?papers=${encodeURIComponent(ids)}`;
}

export function generateQRCodeData(url: string): string {
  // Return data for QR code generation
  return url;
}

// 566-567. Messaging integrations
export function formatForSlack(results: SearchResult[]): object {
  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `📚 ${results.length} Academic Results` }
      },
      ...results.slice(0, 5).map(r => ({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${r.title}*\n${r.authors.slice(0, 2).join(", ")}${r.authors.length > 2 ? " et al." : ""} (${r.year})\n${r.doi ? `<https://doi.org/${r.doi}|DOI: ${r.doi}>` : ""}`
        }
      }))
    ]
  };
}

export function formatForDiscord(results: SearchResult[]): object {
  return {
    embeds: results.slice(0, 5).map(r => ({
      title: r.title.substring(0, 256),
      description: r.abstract?.substring(0, 200) || "",
      url: r.doi ? `https://doi.org/${r.doi}` : r.url,
      color: 0x5865F2,
      fields: [
        { name: "Authors", value: r.authors.slice(0, 3).join(", "), inline: true },
        { name: "Year", value: String(r.year), inline: true },
        { name: "Citations", value: String(r.citations || "N/A"), inline: true }
      ],
      footer: { text: `Source: ${r.source}` }
    }))
  };
}

// 568-570. Webhooks and integrations
export interface WebhookPayload {
  event: "search" | "cite" | "export";
  timestamp: string;
  data: any;
}

export function createWebhookPayload(event: WebhookPayload["event"], data: any): WebhookPayload {
  return {
    event,
    timestamp: new Date().toISOString(),
    data
  };
}

export function generateRSSFeed(results: SearchResult[], feedTitle = "Academic Search Results"): string {
  const items = results.map(r => `
    <item>
      <title>${escapeXML(r.title)}</title>
      <link>${r.doi ? `https://doi.org/${r.doi}` : r.url || ""}</link>
      <description>${escapeXML(r.abstract || "")}</description>
      <author>${escapeXML(r.authors.join(", "))}</author>
      <pubDate>${new Date(r.year, 0, 1).toUTCString()}</pubDate>
      <source>${r.source}</source>
    </item>
  `).join("\n");
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXML(feedTitle)}</title>
    <link>https://iliagpt.com</link>
    <description>Academic search results feed</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;
}

// ============================================
// 571-600: AI INTEGRATIONS
// ============================================

export const AI_PROVIDERS: AIProvider[] = [
  { id: "gpt4", name: "GPT-4", model: "gpt-4-turbo", capabilities: ["summarize", "analyze", "qa", "review"] },
  { id: "claude", name: "Claude", model: "claude-3-opus", capabilities: ["summarize", "analyze", "qa", "review"] },
  { id: "gemini", name: "Gemini", model: "gemini-pro", capabilities: ["summarize", "analyze", "qa"] },
  { id: "local", name: "Local LLM", model: "llama-3", capabilities: ["summarize", "qa"] }
];

// 571-574. AI summarization prompts
export function generateSummarizationPrompt(paper: SearchResult): string {
  return `Please provide a concise summary of this academic paper:

Title: ${paper.title}
Authors: ${paper.authors.join(", ")}
Year: ${paper.year}
${paper.abstract ? `Abstract: ${paper.abstract}` : ""}

Provide:
1. Main objective (1-2 sentences)
2. Key methodology (1-2 sentences)
3. Main findings (2-3 sentences)
4. Significance (1 sentence)`;
}

// 575. Literature review prompt
export function generateLiteratureReviewPrompt(papers: SearchResult[]): string {
  const paperList = papers.map((p, i) => 
    `[${i + 1}] ${p.title} (${p.authors[0]}${p.authors.length > 1 ? " et al." : ""}, ${p.year})`
  ).join("\n");
  
  return `Please write a brief literature review synthesizing these ${papers.length} papers:

${paperList}

Include:
1. Common themes across the papers
2. Key methodological approaches
3. Main findings and their relationships
4. Research gaps identified
5. Future research directions`;
}

// 576. Methodology comparison prompt
export function generateMethodologyComparisonPrompt(papers: SearchResult[]): string {
  return `Compare the methodologies used in these papers:

${papers.map((p, i) => `[${i + 1}] "${p.title}" - ${p.abstract?.substring(0, 200) || "No abstract"}`).join("\n\n")}

Analyze:
1. Data collection methods
2. Analysis techniques
3. Sample sizes and populations
4. Strengths and limitations of each approach
5. Which methodology is most robust and why`;
}

// 577. Gap finding prompt
export function generateGapFindingPrompt(papers: SearchResult[]): string {
  return `Based on these papers, identify research gaps:

${papers.map((p, i) => `[${i + 1}] ${p.title} (${p.year})`).join("\n")}

Identify:
1. Topics not adequately covered
2. Methodological limitations across studies
3. Populations or contexts not studied
4. Questions raised but not answered
5. Potential future research directions`;
}

// 585-590. AI-powered analysis functions
export interface AnalysisResult {
  type: string;
  summary: string;
  keyPoints: string[];
  confidence: number;
}

export function generateKeywordExtractionPrompt(text: string): string {
  return `Extract the most important academic keywords from this text. Return only a comma-separated list of 5-10 keywords:

${text.substring(0, 2000)}`;
}

export function generateReadabilityPrompt(text: string): string {
  return `Analyze the readability of this academic text and provide:
1. Readability score (1-10, where 10 is most accessible)
2. Target audience level (undergraduate, graduate, expert)
3. Suggestions for improving clarity

Text: ${text.substring(0, 1500)}`;
}

// 591-595. Trend detection
export function analyzeTrends(papers: SearchResult[]): {
  yearlyCount: Record<number, number>;
  topAuthors: Array<{ name: string; count: number }>;
  topSources: Array<{ source: string; count: number }>;
  citationTrend: "increasing" | "decreasing" | "stable";
} {
  const yearlyCount: Record<number, number> = {};
  const authorCount: Record<string, number> = {};
  const sourceCount: Record<string, number> = {};
  
  for (const paper of papers) {
    // Year count
    yearlyCount[paper.year] = (yearlyCount[paper.year] || 0) + 1;
    
    // Author count
    for (const author of paper.authors.slice(0, 3)) {
      authorCount[author] = (authorCount[author] || 0) + 1;
    }
    
    // Source count
    sourceCount[paper.source] = (sourceCount[paper.source] || 0) + 1;
  }
  
  // Calculate citation trend
  const sortedYears = Object.keys(yearlyCount).map(Number).sort();
  const recentYears = sortedYears.slice(-3);
  const recentCounts = recentYears.map(y => yearlyCount[y] || 0);
  
  let citationTrend: "increasing" | "decreasing" | "stable" = "stable";
  if (recentCounts.length >= 2) {
    const diff = recentCounts[recentCounts.length - 1] - recentCounts[0];
    if (diff > 2) citationTrend = "increasing";
    else if (diff < -2) citationTrend = "decreasing";
  }
  
  return {
    yearlyCount,
    topAuthors: Object.entries(authorCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    topSources: Object.entries(sourceCount)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    citationTrend
  };
}

// 596-600. AI-powered alerts
export interface AlertRule {
  id: string;
  name: string;
  query: string;
  frequency: "daily" | "weekly" | "monthly";
  filters: Record<string, any>;
  notifyVia: ("email" | "slack" | "webhook")[];
}

export function createAlertRule(
  name: string,
  query: string,
  frequency: AlertRule["frequency"] = "weekly"
): AlertRule {
  return {
    id: `alert_${Date.now()}`,
    name,
    query,
    frequency,
    filters: {},
    notifyVia: ["email"]
  };
}

export function generateAlertDigest(papers: SearchResult[], rule: AlertRule): string {
  return `
# New Papers Alert: ${rule.name}

Found ${papers.length} new papers matching your search for "${rule.query}"

## Papers

${papers.map((p, i) => `
### ${i + 1}. ${p.title}
- **Authors:** ${p.authors.slice(0, 3).join(", ")}${p.authors.length > 3 ? " et al." : ""}
- **Year:** ${p.year}
- **Citations:** ${p.citations || "N/A"}
${p.doi ? `- **DOI:** [${p.doi}](https://doi.org/${p.doi})` : ""}
`).join("\n")}

---
*Alert generated by IliaGPT Academic Search*
`;
}

// Helper function
function escapeXML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
