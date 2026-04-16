/**
 * Advanced Format Module v4.0
 * Improvements 401-500: Format and Presentation
 * 
 * 401-430: Citation Formats
 * 431-460: Result Visualization
 * 461-490: Interactivity
 * 491-500: Accessibility
 */

// ============================================
// TYPES
// ============================================

export interface CitationData {
  title: string;
  authors: string[];
  year: number | string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url?: string;
  publisher?: string;
  accessDate?: string;
  abstract?: string;
}

export type CitationStyle = 
  | "apa7" | "apa6" 
  | "mla9" | "mla8" 
  | "chicago-author" | "chicago-notes"
  | "ieee" | "ieee-no-doi"
  | "vancouver" | "vancouver-no-doi"
  | "harvard" 
  | "ama" | "acs" | "apa" | "asa" | "cse" | "turabian" | "nlm"
  | "bibtex-article" | "bibtex-book" | "bibtex-inproceedings" | "bibtex-misc"
  | "ris" | "endnote-xml" | "csl-json" | "mods-xml";

export interface FormattedResult {
  html: string;
  plainText: string;
  markdown: string;
}

export interface DisplayOptions {
  highlightTerms?: string[];
  truncateAbstract?: number;
  showBadges?: boolean;
  showMetrics?: boolean;
  theme?: "light" | "dark";
}

// ============================================
// 401-430: CITATION FORMATS
// ============================================

// Helper functions
function formatAuthorsForStyle(authors: string[], style: string): string {
  if (authors.length === 0) return "Unknown";
  
  const formatName = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const lastName = parts.pop()!;
    const initials = parts.map(p => p[0] + ".").join(" ");
    return `${lastName}, ${initials}`;
  };
  
  switch (style) {
    case "apa":
      if (authors.length === 1) return formatName(authors[0]);
      if (authors.length === 2) return `${formatName(authors[0])} & ${formatName(authors[1])}`;
      if (authors.length <= 20) {
        const all = authors.slice(0, -1).map(formatName).join(", ");
        return `${all}, & ${formatName(authors[authors.length - 1])}`;
      }
      return `${authors.slice(0, 19).map(formatName).join(", ")}, ... ${formatName(authors[authors.length - 1])}`;
    
    case "mla":
      if (authors.length === 1) return authors[0];
      if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
      return `${authors[0]}, et al.`;
    
    case "chicago":
      if (authors.length === 1) return formatName(authors[0]);
      if (authors.length <= 3) {
        const all = authors.slice(0, -1).map(formatName).join(", ");
        return `${all}, and ${formatName(authors[authors.length - 1])}`;
      }
      return `${formatName(authors[0])} et al.`;
    
    case "ieee":
      return authors.map(a => {
        const parts = a.split(/\s+/);
        const lastName = parts.pop()!;
        const initials = parts.map(p => p[0] + ".").join(" ");
        return `${initials} ${lastName}`;
      }).join(", ");
    
    case "vancouver":
      return authors.slice(0, 6).map(a => {
        const parts = a.split(/\s+/);
        const lastName = parts.pop()!;
        const initials = parts.map(p => p[0]).join("");
        return `${lastName} ${initials}`;
      }).join(", ") + (authors.length > 6 ? ", et al." : "");
    
    default:
      return authors.join(", ");
  }
}

// 401-402. APA 7th and 6th edition
export function formatAPA7(data: CitationData): string {
  const authors = formatAuthorsForStyle(data.authors, "apa");
  const year = data.year || "n.d.";
  const title = data.title;
  const journal = data.journal ? `*${data.journal}*` : "";
  const volume = data.volume ? `, *${data.volume}*` : "";
  const issue = data.issue ? `(${data.issue})` : "";
  const pages = data.pages ? `, ${data.pages}` : "";
  const doi = data.doi ? ` https://doi.org/${data.doi}` : "";
  
  return `${authors} (${year}). ${title}. ${journal}${volume}${issue}${pages}.${doi}`;
}

export function formatAPA6(data: CitationData): string {
  // APA 6 is similar but with minor differences
  const authors = formatAuthorsForStyle(data.authors, "apa");
  const year = data.year || "n.d.";
  const title = data.title;
  const journal = data.journal ? `*${data.journal}*` : "";
  const volume = data.volume ? `, *${data.volume}*` : "";
  const issue = data.issue ? `(${data.issue})` : "";
  const pages = data.pages ? `, ${data.pages}` : "";
  const doi = data.doi ? ` doi:${data.doi}` : "";
  
  return `${authors} (${year}). ${title}. ${journal}${volume}${issue}${pages}.${doi}`;
}

// 403-404. MLA 9th and 8th edition
export function formatMLA9(data: CitationData): string {
  const authors = formatAuthorsForStyle(data.authors, "mla");
  const title = `"${data.title}."`;
  const journal = data.journal ? `*${data.journal}*,` : "";
  const volume = data.volume ? ` vol. ${data.volume},` : "";
  const issue = data.issue ? ` no. ${data.issue},` : "";
  const year = data.year ? ` ${data.year},` : "";
  const pages = data.pages ? ` pp. ${data.pages}.` : "";
  const doi = data.doi ? ` https://doi.org/${data.doi}` : "";
  
  return `${authors}. ${title} ${journal}${volume}${issue}${year}${pages}${doi}`;
}

export function formatMLA8(data: CitationData): string {
  return formatMLA9(data); // Minimal differences
}

// 405-406. Chicago 17th (author-date and notes-bibliography)
export function formatChicagoAuthorDate(data: CitationData): string {
  const authors = formatAuthorsForStyle(data.authors, "chicago");
  const year = data.year || "n.d.";
  const title = `"${data.title}."`;
  const journal = data.journal ? `*${data.journal}*` : "";
  const volume = data.volume ? ` ${data.volume}` : "";
  const issue = data.issue ? `, no. ${data.issue}` : "";
  const year2 = data.year ? ` (${data.year})` : "";
  const pages = data.pages ? `: ${data.pages}` : "";
  const doi = data.doi ? `. https://doi.org/${data.doi}` : "";
  
  return `${authors}. ${year}. ${title} ${journal}${volume}${issue}${year2}${pages}${doi}`;
}

export function formatChicagoNotes(data: CitationData): string {
  const authors = data.authors.join(", ");
  const title = `"${data.title},"`;
  const journal = data.journal ? `*${data.journal}*` : "";
  const volume = data.volume ? ` ${data.volume}` : "";
  const issue = data.issue ? `, no. ${data.issue}` : "";
  const year = data.year ? ` (${data.year})` : "";
  const pages = data.pages ? `: ${data.pages}` : "";
  const doi = data.doi ? `, https://doi.org/${data.doi}` : "";
  
  return `${authors}, ${title} ${journal}${volume}${issue}${year}${pages}${doi}.`;
}

// 407-408. IEEE
export function formatIEEE(data: CitationData): string {
  const authors = formatAuthorsForStyle(data.authors, "ieee");
  const title = `"${data.title},"`;
  const journal = data.journal ? `*${data.journal}*,` : "";
  const volume = data.volume ? ` vol. ${data.volume},` : "";
  const issue = data.issue ? ` no. ${data.issue},` : "";
  const pages = data.pages ? ` pp. ${data.pages},` : "";
  const year = data.year ? ` ${data.year}` : "";
  const doi = data.doi ? `, doi: ${data.doi}` : "";
  
  return `${authors}, ${title} ${journal}${volume}${issue}${pages}${year}${doi}.`;
}

export function formatIEEENoDOI(data: CitationData): string {
  const authors = formatAuthorsForStyle(data.authors, "ieee");
  const title = `"${data.title},"`;
  const journal = data.journal ? `*${data.journal}*,` : "";
  const volume = data.volume ? ` vol. ${data.volume},` : "";
  const issue = data.issue ? ` no. ${data.issue},` : "";
  const pages = data.pages ? ` pp. ${data.pages},` : "";
  const year = data.year ? ` ${data.year}` : "";
  
  return `${authors}, ${title} ${journal}${volume}${issue}${pages}${year}.`;
}

// 409-410. Vancouver
export function formatVancouver(data: CitationData): string {
  const authors = formatAuthorsForStyle(data.authors, "vancouver");
  const title = data.title;
  const journal = data.journal ? ` ${data.journal}.` : "";
  const year = data.year ? ` ${data.year}` : "";
  const volume = data.volume ? `;${data.volume}` : "";
  const issue = data.issue ? `(${data.issue})` : "";
  const pages = data.pages ? `:${data.pages}` : "";
  const doi = data.doi ? `. doi:${data.doi}` : "";
  
  return `${authors}. ${title}.${journal}${year}${volume}${issue}${pages}${doi}`;
}

export function formatVancouverNoDOI(data: CitationData): string {
  const authors = formatAuthorsForStyle(data.authors, "vancouver");
  const title = data.title;
  const journal = data.journal ? ` ${data.journal}.` : "";
  const year = data.year ? ` ${data.year}` : "";
  const volume = data.volume ? `;${data.volume}` : "";
  const issue = data.issue ? `(${data.issue})` : "";
  const pages = data.pages ? `:${data.pages}` : "";
  
  return `${authors}. ${title}.${journal}${year}${volume}${issue}${pages}`;
}

// 411. Harvard
export function formatHarvard(data: CitationData): string {
  const authors = formatAuthorsForStyle(data.authors, "apa");
  const year = data.year || "n.d.";
  const title = `'${data.title}'`;
  const journal = data.journal ? `, *${data.journal}*` : "";
  const volume = data.volume ? `, ${data.volume}` : "";
  const issue = data.issue ? `(${data.issue})` : "";
  const pages = data.pages ? `, pp. ${data.pages}` : "";
  const doi = data.doi ? `. doi:${data.doi}` : "";
  
  return `${authors} (${year}) ${title}${journal}${volume}${issue}${pages}${doi}`;
}

// 412. AMA (American Medical Association)
export function formatAMA(data: CitationData): string {
  const authors = formatAuthorsForStyle(data.authors, "vancouver");
  const title = data.title;
  const journal = data.journal ? ` *${data.journal}*.` : "";
  const year = data.year ? ` ${data.year}` : "";
  const volume = data.volume ? `;${data.volume}` : "";
  const issue = data.issue ? `(${data.issue})` : "";
  const pages = data.pages ? `:${data.pages}` : "";
  const doi = data.doi ? ` doi:${data.doi}` : "";
  
  return `${authors}. ${title}.${journal}${year}${volume}${issue}${pages}${doi}`;
}

// 413. ACS (American Chemical Society)
export function formatACS(data: CitationData): string {
  const authors = formatAuthorsForStyle(data.authors, "apa");
  const title = data.title;
  const journal = data.journal ? ` *${data.journal}*` : "";
  const year = data.year ? ` **${data.year}**` : "";
  const volume = data.volume ? `, *${data.volume}*` : "";
  const pages = data.pages ? `, ${data.pages}` : "";
  const doi = data.doi ? `. https://doi.org/${data.doi}` : "";
  
  return `${authors}. ${title}.${journal}${year}${volume}${pages}${doi}`;
}

// 421-424. BibTeX formats
export function formatBibTeXArticle(data: CitationData): string {
  const key = generateBibTeXKey(data);
  const lines = [
    `@article{${key},`,
    `  author = {${data.authors.join(" and ")}},`,
    `  title = {${data.title}},`,
    data.journal ? `  journal = {${data.journal}},` : null,
    data.volume ? `  volume = {${data.volume}},` : null,
    data.issue ? `  number = {${data.issue}},` : null,
    data.pages ? `  pages = {${data.pages}},` : null,
    `  year = {${data.year}},`,
    data.doi ? `  doi = {${data.doi}},` : null,
    data.url ? `  url = {${data.url}}` : null,
    `}`
  ].filter(Boolean);
  
  return lines.join("\n");
}

export function formatBibTeXBook(data: CitationData): string {
  const key = generateBibTeXKey(data);
  const lines = [
    `@book{${key},`,
    `  author = {${data.authors.join(" and ")}},`,
    `  title = {${data.title}},`,
    data.publisher ? `  publisher = {${data.publisher}},` : null,
    `  year = {${data.year}},`,
    data.doi ? `  doi = {${data.doi}}` : null,
    `}`
  ].filter(Boolean);
  
  return lines.join("\n");
}

export function formatBibTeXInProceedings(data: CitationData): string {
  const key = generateBibTeXKey(data);
  const lines = [
    `@inproceedings{${key},`,
    `  author = {${data.authors.join(" and ")}},`,
    `  title = {${data.title}},`,
    data.journal ? `  booktitle = {${data.journal}},` : null,
    data.pages ? `  pages = {${data.pages}},` : null,
    `  year = {${data.year}},`,
    data.doi ? `  doi = {${data.doi}}` : null,
    `}`
  ].filter(Boolean);
  
  return lines.join("\n");
}

export function formatBibTeXMisc(data: CitationData): string {
  const key = generateBibTeXKey(data);
  const lines = [
    `@misc{${key},`,
    `  author = {${data.authors.join(" and ")}},`,
    `  title = {${data.title}},`,
    `  year = {${data.year}},`,
    data.url ? `  howpublished = {\\url{${data.url}}},` : null,
    data.accessDate ? `  note = {Accessed: ${data.accessDate}}` : null,
    `}`
  ].filter(Boolean);
  
  return lines.join("\n");
}

function generateBibTeXKey(data: CitationData): string {
  const firstAuthor = data.authors[0]?.split(/\s+/).pop()?.toLowerCase() || "unknown";
  const year = data.year || "nd";
  const titleWord = data.title.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") || "paper";
  return `${firstAuthor}${year}${titleWord}`;
}

// 425. RIS format
export function formatRIS(data: CitationData): string {
  const lines = [
    "TY  - JOUR",
    `TI  - ${data.title}`,
    ...data.authors.map(a => `AU  - ${a}`),
    data.year ? `PY  - ${data.year}` : null,
    data.journal ? `JO  - ${data.journal}` : null,
    data.volume ? `VL  - ${data.volume}` : null,
    data.issue ? `IS  - ${data.issue}` : null,
    data.pages ? `SP  - ${data.pages}` : null,
    data.doi ? `DO  - ${data.doi}` : null,
    data.url ? `UR  - ${data.url}` : null,
    data.abstract ? `AB  - ${data.abstract}` : null,
    "ER  - "
  ].filter(Boolean);
  
  return lines.join("\n");
}

// 426. EndNote XML
export function formatEndNoteXML(data: CitationData): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xml>
  <records>
    <record>
      <ref-type name="Journal Article">17</ref-type>
      <contributors>
        <authors>
          ${data.authors.map(a => `<author>${a}</author>`).join("\n          ")}
        </authors>
      </contributors>
      <titles>
        <title>${escapeXML(data.title)}</title>
        ${data.journal ? `<secondary-title>${escapeXML(data.journal)}</secondary-title>` : ""}
      </titles>
      <dates>
        <year>${data.year}</year>
      </dates>
      ${data.volume ? `<volume>${data.volume}</volume>` : ""}
      ${data.issue ? `<number>${data.issue}</number>` : ""}
      ${data.pages ? `<pages>${data.pages}</pages>` : ""}
      ${data.doi ? `<electronic-resource-num>${data.doi}</electronic-resource-num>` : ""}
    </record>
  </records>
</xml>`;
}

// 428. CSL-JSON
export function formatCSLJSON(data: CitationData): string {
  const csl = {
    type: "article-journal",
    title: data.title,
    author: data.authors.map(name => {
      const parts = name.split(/\s+/);
      const family = parts.pop();
      const given = parts.join(" ");
      return { family, given };
    }),
    issued: { "date-parts": [[parseInt(String(data.year)) || 0]] },
    "container-title": data.journal,
    volume: data.volume,
    issue: data.issue,
    page: data.pages,
    DOI: data.doi,
    URL: data.url
  };
  
  return JSON.stringify(csl, null, 2);
}

// 429. MODS XML
export function formatMODSXML(data: CitationData): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<mods xmlns="http://www.loc.gov/mods/v3">
  <titleInfo>
    <title>${escapeXML(data.title)}</title>
  </titleInfo>
  ${data.authors.map(a => {
    const parts = a.split(/\s+/);
    const family = parts.pop();
    const given = parts.join(" ");
    return `<name type="personal">
    <namePart type="family">${escapeXML(family || "")}</namePart>
    <namePart type="given">${escapeXML(given)}</namePart>
  </name>`;
  }).join("\n  ")}
  <originInfo>
    <dateIssued>${data.year}</dateIssued>
  </originInfo>
  ${data.journal ? `<relatedItem type="host">
    <titleInfo>
      <title>${escapeXML(data.journal)}</title>
    </titleInfo>
  </relatedItem>` : ""}
  ${data.doi ? `<identifier type="doi">${data.doi}</identifier>` : ""}
</mods>`;
}

function escapeXML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Main citation formatter
export function formatCitation(data: CitationData, style: CitationStyle): string {
  switch (style) {
    case "apa7":
    case "apa":
      return formatAPA7(data);
    case "apa6":
      return formatAPA6(data);
    case "mla9":
      return formatMLA9(data);
    case "mla8":
      return formatMLA8(data);
    case "chicago-author":
      return formatChicagoAuthorDate(data);
    case "chicago-notes":
      return formatChicagoNotes(data);
    case "ieee":
      return formatIEEE(data);
    case "ieee-no-doi":
      return formatIEEENoDOI(data);
    case "vancouver":
      return formatVancouver(data);
    case "vancouver-no-doi":
      return formatVancouverNoDOI(data);
    case "harvard":
      return formatHarvard(data);
    case "ama":
      return formatAMA(data);
    case "acs":
      return formatACS(data);
    case "bibtex-article":
      return formatBibTeXArticle(data);
    case "bibtex-book":
      return formatBibTeXBook(data);
    case "bibtex-inproceedings":
      return formatBibTeXInProceedings(data);
    case "bibtex-misc":
      return formatBibTeXMisc(data);
    case "ris":
      return formatRIS(data);
    case "endnote-xml":
      return formatEndNoteXML(data);
    case "csl-json":
      return formatCSLJSON(data);
    case "mods-xml":
      return formatMODSXML(data);
    default:
      return formatAPA7(data);
  }
}

// ============================================
// 431-460: RESULT VISUALIZATION
// ============================================

// 486. Highlight search terms
export function highlightTerms(text: string, terms: string[]): string {
  if (!terms.length) return text;
  
  let result = text;
  for (const term of terms) {
    const regex = new RegExp(`(${escapeRegExp(term)})`, "gi");
    result = result.replace(regex, '<mark class="highlight">$1</mark>');
  }
  return result;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 487. Truncate abstract intelligently
export function truncateAbstract(text: string, maxLength = 300): string {
  if (text.length <= maxLength) return text;
  
  // Find last sentence boundary before maxLength
  const truncated = text.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf(".");
  const lastExclaim = truncated.lastIndexOf("!");
  const lastQuestion = truncated.lastIndexOf("?");
  
  const boundary = Math.max(lastPeriod, lastExclaim, lastQuestion);
  
  if (boundary > maxLength * 0.5) {
    return text.substring(0, boundary + 1);
  }
  
  // Fall back to word boundary
  const lastSpace = truncated.lastIndexOf(" ");
  return text.substring(0, lastSpace) + "...";
}

// 488. Source badges
export function getSourceBadge(source: string): { label: string; color: string; icon: string } {
  const badges: Record<string, { label: string; color: string; icon: string }> = {
    scopus: { label: "Scopus", color: "#FF6600", icon: "📚" },
    pubmed: { label: "PubMed", color: "#326599", icon: "🔬" },
    scholar: { label: "Scholar", color: "#4285F4", icon: "🎓" },
    scielo: { label: "SciELO", color: "#C41E3A", icon: "📖" },
    semantic: { label: "Semantic Scholar", color: "#1857B6", icon: "🧠" },
    crossref: { label: "CrossRef", color: "#2C3E50", icon: "🔗" },
    duckduckgo: { label: "Web", color: "#DE5833", icon: "🌐" },
    arxiv: { label: "arXiv", color: "#B31B1B", icon: "📄" },
    wos: { label: "Web of Science", color: "#5E33BF", icon: "🌍" }
  };
  
  return badges[source] || { label: source, color: "#666", icon: "📑" };
}

// 489. Open access indicator
export function getOpenAccessIndicator(isOpenAccess: boolean): { label: string; color: string; icon: string } {
  return isOpenAccess
    ? { label: "Open Access", color: "#F68212", icon: "🔓" }
    : { label: "Subscription", color: "#666", icon: "🔒" };
}

// Format result as card HTML
export function formatResultCard(result: any, options: DisplayOptions = {}): FormattedResult {
  const { highlightTerms: terms = [], truncateAbstract: maxLen = 300, showBadges = true, showMetrics = true } = options;
  
  const title = terms.length ? highlightTerms(result.title, terms) : result.title;
  const abstract = result.abstract ? truncateAbstract(result.abstract, maxLen) : "";
  const highlightedAbstract = terms.length ? highlightTerms(abstract, terms) : abstract;
  
  const badge = showBadges ? getSourceBadge(result.source) : null;
  const oa = result.openAccess ? getOpenAccessIndicator(true) : null;
  
  const html = `
<div class="result-card" data-id="${result.doi || result.fingerprint}">
  <div class="result-header">
    <h3 class="result-title">
      <a href="${result.url}" target="_blank" rel="noopener">${title}</a>
    </h3>
    ${showBadges && badge ? `<span class="badge" style="background:${badge.color}">${badge.icon} ${badge.label}</span>` : ""}
    ${oa ? `<span class="badge oa">${oa.icon}</span>` : ""}
  </div>
  <p class="result-authors">${result.authors}</p>
  <p class="result-meta">
    <span class="year">${result.year}</span>
    ${result.journal ? `<span class="journal">${result.journal}</span>` : ""}
  </p>
  ${highlightedAbstract ? `<p class="result-abstract">${highlightedAbstract}</p>` : ""}
  ${showMetrics ? `
  <div class="result-metrics">
    ${result.citations !== undefined ? `<span class="metric">📊 ${result.citations} citations</span>` : ""}
    ${result.score !== undefined ? `<span class="metric">⭐ ${result.score}%</span>` : ""}
  </div>
  ` : ""}
</div>`;

  const plainText = `${result.title}
${result.authors} (${result.year})
${result.journal || ""}
${abstract}
${result.citations ? `Citations: ${result.citations}` : ""}`;

  const markdown = `### ${result.title}
*${result.authors}* (${result.year})
${result.journal ? `**${result.journal}**` : ""}

${abstract}

${result.doi ? `[DOI: ${result.doi}](https://doi.org/${result.doi})` : result.url ? `[Link](${result.url})` : ""}`;

  return { html, plainText, markdown };
}

// ============================================
// 461-490: INTERACTIVITY HELPERS
// ============================================

// 461. Copy to clipboard helper
export function generateCopyScript(elementId: string, text: string): string {
  return `
<script>
document.getElementById('${elementId}').addEventListener('click', function() {
  navigator.clipboard.writeText('${text.replace(/'/g, "\\'")}')
    .then(() => {
      this.classList.add('copied');
      setTimeout(() => this.classList.remove('copied'), 2000);
    });
});
</script>`;
}

// 471. Keyboard shortcuts definition
export interface KeyboardShortcut {
  key: string;
  modifiers?: ("ctrl" | "alt" | "shift" | "meta")[];
  action: string;
  description: string;
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { key: "/", action: "focusSearch", description: "Focus search box" },
  { key: "Escape", action: "clearSearch", description: "Clear search" },
  { key: "Enter", action: "search", description: "Execute search" },
  { key: "ArrowDown", action: "nextResult", description: "Next result" },
  { key: "ArrowUp", action: "prevResult", description: "Previous result" },
  { key: "Enter", action: "openResult", description: "Open selected result" },
  { key: "c", modifiers: ["ctrl"], action: "copyCitation", description: "Copy citation" },
  { key: "s", modifiers: ["ctrl"], action: "saveResult", description: "Save result" },
  { key: "f", modifiers: ["ctrl"], action: "toggleFilters", description: "Toggle filters" },
  { key: "?", action: "showHelp", description: "Show shortcuts" }
];

// ============================================
// 491-500: ACCESSIBILITY
// ============================================

// 491. ARIA labels
export function generateAriaLabels(result: any): Record<string, string> {
  return {
    article: `Article: ${result.title} by ${result.authors}, published ${result.year}`,
    title: `Title: ${result.title}`,
    authors: `Authors: ${result.authors}`,
    year: `Year: ${result.year}`,
    journal: result.journal ? `Journal: ${result.journal}` : "",
    citations: result.citations !== undefined ? `${result.citations} citations` : "",
    openAccess: result.openAccess ? "Open access article" : "Subscription required",
    doi: result.doi ? `DOI: ${result.doi}` : "",
    abstract: result.abstract ? `Abstract: ${truncateAbstract(result.abstract, 100)}` : ""
  };
}

// 492. Screen reader friendly text
export function generateScreenReaderText(result: any): string {
  const parts = [
    `Article titled ${result.title}`,
    `by ${result.authors}`,
    `published in ${result.year}`,
    result.journal ? `in ${result.journal}` : "",
    result.citations !== undefined ? `with ${result.citations} citations` : "",
    result.openAccess ? "This is an open access article." : ""
  ];
  
  return parts.filter(Boolean).join(", ");
}

// 493. Skip link generator
export function generateSkipLinks(): string {
  return `
<nav class="skip-links" aria-label="Skip navigation">
  <a href="#search-box" class="skip-link">Skip to search</a>
  <a href="#results" class="skip-link">Skip to results</a>
  <a href="#filters" class="skip-link">Skip to filters</a>
</nav>`;
}

// 495. Font size adjustment CSS
export function generateFontSizeCSS(baseSize = 16): string {
  return `
:root {
  --font-size-base: ${baseSize}px;
  --font-size-sm: ${baseSize * 0.875}px;
  --font-size-lg: ${baseSize * 1.125}px;
  --font-size-xl: ${baseSize * 1.25}px;
  --font-size-2xl: ${baseSize * 1.5}px;
}

.font-size-small { font-size: var(--font-size-sm); }
.font-size-normal { font-size: var(--font-size-base); }
.font-size-large { font-size: var(--font-size-lg); }
.font-size-xlarge { font-size: var(--font-size-xl); }
`;
}

// 498. Color blind friendly palette
export const COLOR_BLIND_PALETTE = {
  primary: "#0072B2",
  secondary: "#E69F00",
  success: "#009E73",
  danger: "#D55E00",
  warning: "#F0E442",
  info: "#56B4E9",
  dark: "#000000",
  light: "#FFFFFF",
  gray: "#999999"
};

// 499. Focus indicator styles
export function generateFocusStyles(): string {
  return `
:focus {
  outline: 3px solid #4A90D9;
  outline-offset: 2px;
}

:focus:not(:focus-visible) {
  outline: none;
}

:focus-visible {
  outline: 3px solid #4A90D9;
  outline-offset: 2px;
}

.focus-ring:focus {
  box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.5);
}
`;
}

// 500. Skip navigation
export function generateSkipNavigation(): string {
  return `
<a href="#main-content" class="skip-nav">
  Skip to main content
</a>
<style>
.skip-nav {
  position: absolute;
  top: -40px;
  left: 0;
  background: #000;
  color: white;
  padding: 8px 16px;
  z-index: 100;
  transition: top 0.3s;
}
.skip-nav:focus {
  top: 0;
}
</style>`;
}
