/**
 * Metadata Extractor Service
 * 
 * Extracts metadata from documents: author, date, language, keywords, etc.
 * Uses TF-IDF for automatic keyword extraction.
 */

// =============================================================================
// Types
// =============================================================================

export interface DocumentMetadata {
    title?: string;
    author?: string;
    createdDate?: Date;
    modifiedDate?: Date;
    language: string;
    pageCount?: number;
    wordCount: number;
    charCount: number;
    keywords: string[];
    summary?: string;
    documentType: DocumentType;
    confidence: number;
}

export type DocumentType =
    | 'report'
    | 'article'
    | 'presentation'
    | 'spreadsheet'
    | 'contract'
    | 'invoice'
    | 'email'
    | 'letter'
    | 'memo'
    | 'manual'
    | 'unknown';

export interface MetadataExtractionOptions {
    extractKeywords?: boolean;
    maxKeywords?: number;
    detectDocumentType?: boolean;
    extractDates?: boolean;
}

// =============================================================================
// TF-IDF Implementation
// =============================================================================

interface TermFrequency {
    term: string;
    frequency: number;
    tfidf: number;
}

function calculateTFIDF(text: string, maxTerms: number = 10): string[] {
    // Tokenize and clean
    const words = text.toLowerCase()
        .replace(/[^\w\sáéíóúüñ]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3);

    // Stop words (Spanish + English)
    const stopWords = new Set([
        // Spanish
        'para', 'como', 'pero', 'más', 'este', 'esta', 'estos', 'estas',
        'sobre', 'entre', 'cuando', 'donde', 'desde', 'hasta', 'también',
        'puede', 'pueden', 'sido', 'tiene', 'tienen', 'hacer', 'cada',
        'todos', 'otras', 'otros', 'otra', 'otro', 'mismo', 'misma',
        // English
        'that', 'this', 'with', 'from', 'have', 'been', 'were', 'they',
        'their', 'what', 'there', 'which', 'about', 'when', 'would',
        'will', 'could', 'should', 'than', 'into', 'only', 'just'
    ]);

    // Calculate term frequency
    const termCounts = new Map<string, number>();
    for (const word of words) {
        if (!stopWords.has(word)) {
            termCounts.set(word, (termCounts.get(word) || 0) + 1);
        }
    }

    // Calculate TF-IDF (simplified - using frequency as proxy)
    const terms: TermFrequency[] = [];
    const totalTerms = words.length;

    for (const [term, count] of termCounts) {
        const tf = count / totalTerms;
        // IDF approximation: penalize very common terms
        const idf = Math.log10(totalTerms / (count + 1));
        const tfidf = tf * idf;

        terms.push({ term, frequency: count, tfidf });
    }

    // Sort by TF-IDF score and return top terms
    return terms
        .sort((a, b) => b.tfidf - a.tfidf)
        .slice(0, maxTerms)
        .map(t => t.term);
}

// =============================================================================
// Language Detection
// =============================================================================

const LANGUAGE_INDICATORS: Record<string, string[]> = {
    es: ['el', 'la', 'de', 'que', 'en', 'es', 'para', 'con', 'por', 'una', 'los', 'del', 'las'],
    en: ['the', 'of', 'and', 'to', 'in', 'is', 'for', 'with', 'on', 'that', 'are', 'was'],
    fr: ['le', 'la', 'de', 'et', 'en', 'un', 'une', 'du', 'des', 'est', 'sont', 'pour'],
    de: ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'ist', 'auf', 'für'],
    pt: ['de', 'que', 'em', 'para', 'com', 'uma', 'os', 'no', 'da', 'por', 'na', 'dos'],
    it: ['di', 'che', 'il', 'la', 'per', 'un', 'una', 'con', 'del', 'della', 'sono', 'essere']
};

function detectLanguage(text: string): { language: string; confidence: number } {
    const words = text.toLowerCase().split(/\s+/);
    const scores: Record<string, number> = {};

    for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS)) {
        scores[lang] = 0;
        for (const word of words) {
            if (indicators.includes(word)) {
                scores[lang]++;
            }
        }
    }

    const entries = Object.entries(scores);
    const maxScore = Math.max(...entries.map(([, score]) => score));
    const detectedLang = entries.find(([, score]) => score === maxScore)?.[0] || 'en';
    const confidence = maxScore > 0 ? Math.min(maxScore / 20, 1) : 0.5;

    return { language: detectedLang, confidence };
}

// =============================================================================
// Document Type Detection
// =============================================================================

const DOCUMENT_TYPE_PATTERNS: Record<DocumentType, RegExp[]> = {
    invoice: [/factura/i, /invoice/i, /total\s*:/i, /subtotal/i, /iva|tax/i, /n[úu]mero de factura/i],
    contract: [/contrato/i, /contract/i, /agreement/i, /partes|parties/i, /términos|terms/i, /firma|signature/i],
  email: [/^(?:from|de):/im, /^(?:to|para):/im, /^(?:subject|asunto):/im, /@\w+\.\w+/i],
    letter: [/estimado|dear/i, /atentamente|sincerely/i, /cordialmente|regards/i],
    report: [/informe|report/i, /conclusi[oó]n|conclusion/i, /resumen ejecutivo|executive summary/i],
    presentation: [/slide|diapositiva/i, /presentaci[oó]n/i],
    spreadsheet: [/\d+[\t,]\d+[\t,]\d+/g],
    memo: [/memorando|memo/i, /para:|to:/i, /de:|from:/i],
    manual: [/manual|gu[ií]a|guide/i, /instrucciones|instructions/i, /paso \d|step \d/i],
    article: [/abstract|resumen/i, /introduction|introducci[oó]n/i, /references|referencias/i],
    unknown: []
};

function detectDocumentType(text: string): { type: DocumentType; confidence: number } {
    const scores: Record<DocumentType, number> = {
        invoice: 0, contract: 0, email: 0, letter: 0, report: 0,
        presentation: 0, spreadsheet: 0, memo: 0, manual: 0, article: 0, unknown: 0
    };

    for (const [type, patterns] of Object.entries(DOCUMENT_TYPE_PATTERNS) as [DocumentType, RegExp[]][]) {
        for (const pattern of patterns) {
            const matches = text.match(pattern);
            if (matches) {
                scores[type] += matches.length;
            }
        }
    }

    const entries = Object.entries(scores) as [DocumentType, number][];
    const maxScore = Math.max(...entries.map(([, score]) => score));

    if (maxScore === 0) {
        return { type: 'unknown', confidence: 0.3 };
    }

    const detectedType = entries.find(([, score]) => score === maxScore)?.[0] || 'unknown';
    const confidence = Math.min(maxScore / 5, 0.95);

    return { type: detectedType, confidence };
}

// =============================================================================
// Date Extraction
// =============================================================================

function extractDates(text: string): { created?: Date; modified?: Date } {
    const datePatterns = [
        // ISO format
        /(\d{4}-\d{2}-\d{2})/g,
        // DD/MM/YYYY or MM/DD/YYYY
        /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g,
        // Month name formats
        /(\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:de\s+)?\d{2,4})/gi
    ];

    const dates: Date[] = [];

    for (const pattern of datePatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            try {
                const parsed = new Date(match[1]);
                if (!isNaN(parsed.getTime())) {
                    dates.push(parsed);
                }
            } catch {
                // Skip invalid dates
            }
        }
    }

    if (dates.length === 0) return {};

    dates.sort((a, b) => a.getTime() - b.getTime());

    return {
        created: dates[0],
        modified: dates[dates.length - 1]
    };
}

// =============================================================================
// Main Function
// =============================================================================

export function extractMetadata(
    text: string,
    options: MetadataExtractionOptions = {}
): DocumentMetadata {
    const {
        extractKeywords = true,
        maxKeywords = 10,
        detectDocumentType: shouldDetectType = true,
        extractDates: shouldExtractDates = true
    } = options;

    // Basic counts
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    const charCount = text.length;

    // Language detection
    const { language, confidence: langConfidence } = detectLanguage(text);

    // Document type detection
    const { type: documentType, confidence: typeConfidence } = shouldDetectType
        ? detectDocumentType(text)
        : { type: 'unknown' as DocumentType, confidence: 0 };

    // Keyword extraction
    const keywords = extractKeywords ? calculateTFIDF(text, maxKeywords) : [];

    // Date extraction
    const dates = shouldExtractDates ? extractDates(text) : {};

    // Title extraction (first heading or first line)
    const titleMatch = text.match(/^#\s+(.+)$/m) || text.match(/^(.{10,80})[\n\r]/);
    const title = titleMatch?.[1]?.trim();

    // Overall confidence
    const confidence = (langConfidence + typeConfidence) / 2;

    return {
        title,
        language,
        wordCount,
        charCount,
        keywords,
        documentType,
        confidence,
        createdDate: dates.created,
        modifiedDate: dates.modified
    };
}

// =============================================================================
// Export
// =============================================================================

export const metadataExtractor = {
    extractMetadata,
    detectLanguage,
    detectDocumentType,
    calculateTFIDF
};

export default metadataExtractor;
