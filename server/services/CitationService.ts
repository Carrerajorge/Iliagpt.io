import { Logger } from "../lib/logger";

interface SourceMetadata {
    title?: string;
    author?: string;
    year?: string | number;
    url?: string;
    publisher?: string;
    pageNumber?: string | number;
    [key: string]: any;
}

interface Source {
    id: string;
    metadata: SourceMetadata;
}

export type CitationStyle = 'apa' | 'mla' | 'vancouver' | 'bibtex' | 'ris';

export class CitationService {
    private static logger = Logger;

    /**
     * Formats a single source citation in the specified style
     */
    static format(source: Source, style: CitationStyle = 'apa'): string {
        switch (style) {
            case 'mla': return this.formatMLA(source);
            case 'vancouver': return this.formatVancouver(source);
            case 'bibtex': return this.formatBibTeX(source);
            case 'ris': return this.formatRIS(source);
            case 'apa':
            default:
                return this.formatAPA(source);
        }
    }

    /**
     * Formats a single source citation in APA 7th style
     */
    static formatAPA(source: Source): string {
        const { title, author, year, url, publisher } = source.metadata;

        const authorText = author ? `${this.formatAuthorList(author, 'apa')}.` : "Unknown Author.";
        const yearText = year ? `(${year}).` : "(n.d.).";
        const titleText = title ? `*${title}*.` : "Untitled.";
        const publisherText = publisher ? `${publisher}.` : "";
        const urlText = url ? `🔗 ${url}` : "";

        return [authorText, yearText, titleText, publisherText, urlText]
            .filter(part => part && part.trim() !== "")
            .join(" ");
    }

    /**
     * Formats a single source citation in MLA 9th style
     */
    static formatMLA(source: Source): string {
        const { title, author, year, url, publisher } = source.metadata;

        const authorText = author ? `${this.formatAuthorList(author, 'mla')}.` : "Unknown Author.";
        const titleText = title ? `"${title}."` : "\"Untitled.\"";
        const publisherText = publisher ? `${publisher},` : "";
        const yearText = year ? `${year},` : "n.d.,";
        const urlText = url ? url : "";

        let citation = [authorText, titleText, publisherText, yearText, urlText]
            .filter(part => part && part.trim() !== "")
            .join(" ");

        if (citation.endsWith(',')) citation = citation.slice(0, -1) + '.';
        else if (!citation.endsWith('.')) citation += '.';

        return citation;
    }

    /**
     * Formats a single source citation in Vancouver style
     */
    static formatVancouver(source: Source): string {
        const { title, author, year, url, publisher } = source.metadata;

        const authorText = author ? `${this.formatAuthorList(author, 'vancouver')}.` : "Unknown Author.";
        const titleText = title ? `${title}.` : "Untitled.";
        const publisherText = publisher ? `${publisher};` : "";
        const yearText = year ? `${year}.` : "[date unknown].";
        const urlText = url ? `Available from: ${url}` : "";

        return [authorText, titleText, publisherText, yearText, urlText]
            .filter(part => part && part.trim() !== "")
            .join(" ");
    }

    /**
     * Formats a single source citation as a BibTeX entry
     */
    static formatBibTeX(source: Source): string {
        const { title, author, year, url, publisher, journal } = source.metadata;
        const entryType = journal ? 'article' : 'misc';
        const id = source.id.replace(/[^a-zA-Z0-9]/g, '');
        const citeKey = author ? `${author.split(',')[0].split(' ')[0].replace(/[^a-zA-Z]/g, '')}${year || ''}${id.slice(0, 4)}`.toLowerCase() : `source${year || ''}${id.slice(0, 4)}`;

        let bibtex = `@${entryType}{${citeKey},\n`;
        if (author) bibtex += `  author = {${author.split(';').map(a => a.trim()).join(' and ')}},\n`;
        if (title) bibtex += `  title = {${title}},\n`;
        if (journal) bibtex += `  journal = {${journal}},\n`;
        if (publisher) bibtex += `  publisher = {${publisher}},\n`;
        if (year) bibtex += `  year = {${year}},\n`;
        if (url) bibtex += `  url = {${url}}\n`;

        // Remove trailing comma from last entry if it has one (it shouldn't based on the logic, but safety first)
        if (bibtex.endsWith(',\n')) bibtex = bibtex.slice(0, -2) + '\n';

        bibtex += `}`;
        return bibtex;
    }

    /**
     * Formats a single source citation as a RIS (Research Information Systems) format
     */
    static formatRIS(source: Source): string {
        const { title, author, year, url, publisher, journal } = source.metadata;

        let ris = `TY  - ${journal ? 'JOUR' : 'ELEC'}\n`;
        if (title) ris += `TI  - ${title}\n`;
        if (author) {
            author.split(';').forEach(a => {
                ris += `AU  - ${a.trim()}\n`;
            });
        }
        if (journal) ris += `JO  - ${journal}\n`;
        if (publisher) ris += `PB  - ${publisher}\n`;
        if (year) ris += `PY  - ${year}\n`;
        if (url) ris += `UR  - ${url}\n`;
        ris += `ER  - \n`;

        return ris;
    }

    /** @deprecated Use format instead. Backwards compatibility for existing code. */
    static formatCitation(source: Source): string {
        return this.formatAPA(source);
    }

    /**
     * Generates a bibliography for a list of sources.
     */
    static formatBibliography(sources: Source[], style: CitationStyle = 'apa'): string {
        if (!sources || sources.length === 0) return "";

        const uniqueSources = new Map<string, Source>();
        sources.forEach(s => {
            // Deduplicate by URL or Title if ID is missing or duplicated
            const key = s.metadata.url || s.metadata.title || s.id;
            if (!uniqueSources.has(key)) {
                uniqueSources.set(key, s);
            }
        });

        const separator = (style === 'bibtex' || style === 'ris') ? "\n\n" : "\n\n";

        return Array.from(uniqueSources.values())
            .map(s => this.format(s, style))
            .sort() // Alphabetical order
            .join(separator);
    }

    /**
     * Helper to format author lists based on style rules
     */
    private static formatAuthorList(authorString: string, style: 'apa' | 'mla' | 'vancouver'): string {
        if (!authorString) return "";
        const authors = authorString.split(';').map(a => a.trim()).filter(Boolean);
        if (authors.length === 0) return "";

        if (style === 'vancouver') {
            // Vancouver: Last FM. (no periods or spaces between initials)
            // Simplified approximation since we don't always have structured names
            return authors.map(a => a.replace(/[^a-zA-Z\s-]/g, '')).join(', ');
        }

        if (authors.length === 1) return authors[0];

        if (style === 'mla') {
            if (authors.length === 2) return `${authors[0]}, and ${authors[1]}`;
            return `${authors[0]}, et al`;
        }

        // APA
        if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
        if (authors.length > 20) return `${authors.slice(0, 19).join(', ')}, ... ${authors[authors.length - 1]}`;
        return `${authors.slice(0, -1).join(', ')}, & ${authors[authors.length - 1]}`;
    }

    /**
     * Helper to extract valid year from various string formats
     */
    static normalizeYear(dateStr: string): string | undefined {
        if (!dateStr) return undefined;
        const match = dateStr.match(/\b(19|20)\d{2}\b/);
        return match ? match[0] : undefined;
    }
}
