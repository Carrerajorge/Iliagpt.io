/**
 * APA 7th Edition Citation Formatter
 * 
 * Formatea citas y referencias bibliográficas siguiendo el estilo APA 7ma edición.
 * Soporta artículos de revista, libros, capítulos, sitios web, y más.
 */

export interface APACitation {
    // Required fields
    authors: string[];  // ["Apellido, Iniciales", "Apellido2, I. N."]
    year: number | string;
    title: string;

    // Optional fields based on source type
    journal?: string;           // For journal articles
    volume?: number | string;
    issue?: number | string;
    pages?: string;             // "123-145" or "e12345"

    publisher?: string;         // For books
    edition?: string;           // "2nd ed."
    editors?: string[];         // For edited books

    doi?: string;               // Digital Object Identifier
    url?: string;               // For web sources
    retrievedDate?: string;     // For web sources that may change

    sourceType: 'journal' | 'book' | 'chapter' | 'website' | 'conference' | 'thesis' | 'report' | 'other';

    // Additional metadata
    city?: string;
    country?: string;
    abstract?: string;
    keywords?: string[];
}

export interface InTextCitation {
    authors: string[];
    year: number | string;
    pageNumbers?: string;
    isDirectQuote?: boolean;
}

/**
 * Format author names for APA reference list
 * Up to 20 authors: list all; 21+: list first 19... last author
 */
export function formatAuthorsAPA(authors: string[]): string {
    if (!authors || authors.length === 0) {
        return "Anonymous";
    }

    // Normalize author format: "Last, F. M."
    const formattedAuthors = authors.map(author => {
        // Already in correct format
        if (/^[^,]+,\s*[A-Z]\./.test(author)) {
            return author;
        }

        // Parse "First Last" or "First Middle Last"
        const parts = author.trim().split(/\s+/);
        if (parts.length === 1) {
            return parts[0];
        }

        const lastName = parts[parts.length - 1];
        const initials = parts.slice(0, -1)
            .map(name => name[0]?.toUpperCase() + ".")
            .join(" ");

        return `${lastName}, ${initials}`;
    });

    if (formattedAuthors.length === 1) {
        return formattedAuthors[0];
    }

    if (formattedAuthors.length === 2) {
        return `${formattedAuthors[0]}, & ${formattedAuthors[1]}`;
    }

    if (formattedAuthors.length <= 20) {
        const allButLast = formattedAuthors.slice(0, -1).join(", ");
        return `${allButLast}, & ${formattedAuthors[formattedAuthors.length - 1]}`;
    }

    // 21+ authors: first 19, ..., last
    const first19 = formattedAuthors.slice(0, 19).join(", ");
    return `${first19}, ... ${formattedAuthors[formattedAuthors.length - 1]}`;
}

/**
 * Format in-text citation (Author, Year) or (Author, Year, p. X)
 */
export function formatInTextCitation(citation: InTextCitation): string {
    let authorPart: string;

    if (citation.authors.length === 0) {
        authorPart = "Anonymous";
    } else if (citation.authors.length === 1) {
        // Just last name
        authorPart = extractLastName(citation.authors[0]);
    } else if (citation.authors.length === 2) {
        authorPart = `${extractLastName(citation.authors[0])} & ${extractLastName(citation.authors[1])}`;
    } else {
        authorPart = `${extractLastName(citation.authors[0])} et al.`;
    }

    let result = `(${authorPart}, ${citation.year}`;

    if (citation.pageNumbers) {
        const pagePrefix = citation.pageNumbers.includes("-") ? "pp." : "p.";
        result += `, ${pagePrefix} ${citation.pageNumbers}`;
    }

    result += ")";

    return result;
}

/**
 * Format narrative citation: Author (Year) or Author et al. (Year)
 */
export function formatNarrativeCitation(citation: InTextCitation): string {
    let authorPart: string;

    if (citation.authors.length === 0) {
        authorPart = "Anonymous";
    } else if (citation.authors.length === 1) {
        authorPart = extractLastName(citation.authors[0]);
    } else if (citation.authors.length === 2) {
        authorPart = `${extractLastName(citation.authors[0])} and ${extractLastName(citation.authors[1])}`;
    } else {
        authorPart = `${extractLastName(citation.authors[0])} et al.`;
    }

    return `${authorPart} (${citation.year})`;
}

function extractLastName(author: string): string {
    // Handle "Last, First" format
    if (author.includes(",")) {
        return author.split(",")[0].trim();
    }
    // Handle "First Last" format
    const parts = author.split(/\s+/);
    return parts[parts.length - 1];
}

/**
 * Format a complete APA 7 reference based on source type
 */
export function formatAPA7Reference(citation: APACitation): string {
    const authors = formatAuthorsAPA(citation.authors);
    const year = `(${citation.year}).`;

    switch (citation.sourceType) {
        case 'journal':
            return formatJournalArticle(citation, authors, year);
        case 'book':
            return formatBook(citation, authors, year);
        case 'chapter':
            return formatBookChapter(citation, authors, year);
        case 'website':
            return formatWebsite(citation, authors, year);
        case 'conference':
            return formatConferencePaper(citation, authors, year);
        case 'thesis':
            return formatThesis(citation, authors, year);
        case 'report':
            return formatReport(citation, authors, year);
        default:
            return formatGeneric(citation, authors, year);
    }
}

function formatJournalArticle(citation: APACitation, authors: string, year: string): string {
    let ref = `${authors} ${year} ${citation.title}. `;

    if (citation.journal) {
        ref += `*${citation.journal}*`;

        if (citation.volume) {
            ref += `, *${citation.volume}*`;

            if (citation.issue) {
                ref += `(${citation.issue})`;
            }
        }

        if (citation.pages) {
            ref += `, ${citation.pages}`;
        }

        ref += ". ";
    }

    if (citation.doi) {
        ref += formatDOI(citation.doi);
    } else if (citation.url) {
        ref += `🔗 ${citation.url}`;
    }

    return ref.trim();
}

function formatBook(citation: APACitation, authors: string, year: string): string {
    let ref = `${authors} ${year} *${citation.title}*`;

    if (citation.edition) {
        ref += ` (${citation.edition})`;
    }

    ref += ". ";

    if (citation.publisher) {
        ref += `${citation.publisher}. `;
    }

    if (citation.doi) {
        ref += formatDOI(citation.doi);
    } else if (citation.url) {
        ref += `🔗 ${citation.url}`;
    }

    return ref.trim();
}

function formatBookChapter(citation: APACitation, authors: string, year: string): string {
    let ref = `${authors} ${year} ${citation.title}. `;

    if (citation.editors && citation.editors.length > 0) {
        const editors = formatEditorsAPA(citation.editors);
        ref += `In ${editors} (Ed${citation.editors.length > 1 ? 's' : ''}.), `;
    }

    if (citation.journal) { // Using journal field for book title
        ref += `*${citation.journal}*`;

        if (citation.pages) {
            ref += ` (pp. ${citation.pages})`;
        }

        ref += ". ";
    }

    if (citation.publisher) {
        ref += `${citation.publisher}. `;
    }

    if (citation.doi) {
        ref += formatDOI(citation.doi);
    }

    return ref.trim();
}

function formatWebsite(citation: APACitation, authors: string, year: string): string {
    let ref = `${authors} ${year} *${citation.title}*. `;

    if (citation.publisher) {
        ref += `${citation.publisher}. `;
    }

    if (citation.retrievedDate) {
        ref += `Retrieved ${citation.retrievedDate}, from `;
    }

    if (citation.url) {
        ref += `🔗 ${citation.url}`;
    }

    return ref.trim();
}

function formatConferencePaper(citation: APACitation, authors: string, year: string): string {
    let ref = `${authors} ${year} ${citation.title}. `;

    if (citation.journal) {
        ref += `*${citation.journal}*. `;
    }

    if (citation.city && citation.country) {
        ref += `${citation.city}, ${citation.country}. `;
    }

    if (citation.doi) {
        ref += formatDOI(citation.doi);
    } else if (citation.url) {
        ref += `🔗 ${citation.url}`;
    }

    return ref.trim();
}

function formatThesis(citation: APACitation, authors: string, year: string): string {
    let ref = `${authors} ${year} *${citation.title}* `;
    ref += `[Doctoral dissertation${citation.publisher ? `, ${citation.publisher}` : ''}]. `;

    if (citation.url) {
        ref += `🔗 ${citation.url}`;
    }

    return ref.trim();
}

function formatReport(citation: APACitation, authors: string, year: string): string {
    let ref = `${authors} ${year} *${citation.title}*. `;

    if (citation.publisher) {
        ref += `${citation.publisher}. `;
    }

    if (citation.doi) {
        ref += formatDOI(citation.doi);
    } else if (citation.url) {
        ref += `🔗 ${citation.url}`;
    }

    return ref.trim();
}

function formatGeneric(citation: APACitation, authors: string, year: string): string {
    let ref = `${authors} ${year} ${citation.title}. `;

    if (citation.doi) {
        ref += formatDOI(citation.doi);
    } else if (citation.url) {
        ref += `🔗 ${citation.url}`;
    }

    return ref.trim();
}

function formatEditorsAPA(editors: string[]): string {
    if (editors.length === 1) {
        return formatSingleEditor(editors[0]);
    }
    if (editors.length === 2) {
        return `${formatSingleEditor(editors[0])} & ${formatSingleEditor(editors[1])}`;
    }

    const allButLast = editors.slice(0, -1).map(formatSingleEditor).join(", ");
    return `${allButLast}, & ${formatSingleEditor(editors[editors.length - 1])}`;
}

function formatSingleEditor(editor: string): string {
    // Convert "Last, First" to "F. Last"
    if (editor.includes(",")) {
        const [last, rest] = editor.split(",");
        const initials = rest.trim().split(/\s+/).map(n => n[0]?.toUpperCase() + ".").join(" ");
        return `${initials} ${last.trim()}`;
    }
    return editor;
}

function formatDOI(doi: string): string {
    // Ensure DOI is in URL format with 🔗 emoji
    if (doi.startsWith("http")) {
        return `🔗 ${doi}`;
    }
    return `🔗 https://doi.org/${doi.replace(/^doi:\s*/i, "")}`;
}

/**
 * Generate a complete bibliography from multiple citations
 * Sorted alphabetically by first author's last name
 */
export function generateBibliography(citations: APACitation[]): string {
    const formatted = citations.map(formatAPA7Reference);

    // Sort alphabetically by first author's last name
    formatted.sort((a, b) => {
        const lastNameA = extractLastName(a.split(" ")[0] || "");
        const lastNameB = extractLastName(b.split(" ")[0] || "");
        return lastNameA.localeCompare(lastNameB);
    });

    return formatted.join("\n\n");
}

/**
 * Generate bibliography as Word-compatible content
 */
export function generateBibliographyForWord(citations: APACitation[]): {
    title: string;
    entries: string[];
} {
    const entries = citations
        .map(formatAPA7Reference)
        .sort((a, b) => {
            const lastNameA = extractLastName(a.split(" ")[0] || "");
            const lastNameB = extractLastName(b.split(" ")[0] || "");
            return lastNameA.localeCompare(lastNameB);
        });

    return {
        title: "Referencias",
        entries
    };
}

/**
 * Convert CrossRef metadata to APACitation format
 */
export function crossRefToAPACitation(metadata: {
    doi: string;
    title: string;
    authors: string[];
    year: number;
    journal: string;
    volume?: string;
    issue?: string;
    pages?: string;
    abstract?: string;
    keywords?: string[];
    url?: string;
}): APACitation {
    return {
        authors: metadata.authors,
        year: metadata.year,
        title: metadata.title,
        journal: metadata.journal,
        volume: metadata.volume,
        issue: metadata.issue,
        pages: metadata.pages,
        doi: metadata.doi,
        url: metadata.url,
        abstract: metadata.abstract,
        keywords: metadata.keywords,
        sourceType: 'journal'
    };
}

/**
 * Validate if a citation has minimum required fields
 */
export function validateCitation(citation: Partial<APACitation>): {
    valid: boolean;
    errors: string[]
} {
    const errors: string[] = [];

    if (!citation.authors || citation.authors.length === 0) {
        errors.push("At least one author is required");
    }

    if (!citation.year) {
        errors.push("Publication year is required");
    }

    if (!citation.title) {
        errors.push("Title is required");
    }

    if (!citation.sourceType) {
        errors.push("Source type is required");
    }

    // Source-specific validation
    if (citation.sourceType === 'journal' && !citation.journal) {
        errors.push("Journal name is required for journal articles");
    }

    if (citation.sourceType === 'book' && !citation.publisher) {
        errors.push("Publisher is required for books");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

export default {
    formatAuthorsAPA,
    formatInTextCitation,
    formatNarrativeCitation,
    formatAPA7Reference,
    generateBibliography,
    generateBibliographyForWord,
    crossRefToAPACitation,
    validateCitation
};
