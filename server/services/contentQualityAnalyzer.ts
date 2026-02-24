/**
 * Content Quality Analyzer - ILIAGPT PRO 3.0 (10x Enhanced)
 * 
 * Analyzes document quality, type, language, and readability.
 * Provides intelligent content classification.
 */

// ============== Types ==============

export interface ContentAnalysis {
    language: LanguageInfo;
    contentType: ContentType;
    quality: QualityMetrics;
    structure: StructureAnalysis;
    entities: ExtractedEntity[];
    topics: Topic[];
    readability: ReadabilityScore;
}

export interface LanguageInfo {
    code: string;
    name: string;
    confidence: number;
    isMultilingual: boolean;
    secondaryLanguages?: string[];
}

export interface ContentType {
    primary: DocumentCategory;
    secondary?: DocumentCategory;
    confidence: number;
    indicators: string[];
}

export type DocumentCategory =
    | "academic"
    | "legal"
    | "technical"
    | "business"
    | "medical"
    | "financial"
    | "creative"
    | "news"
    | "casual"
    | "mixed";

export interface QualityMetrics {
    overall: number; // 0-100
    clarity: number;
    completeness: number;
    accuracy: number;
    formatting: number;
    issues: QualityIssue[];
}

export interface QualityIssue {
    type: "grammar" | "spelling" | "formatting" | "incomplete" | "unclear";
    severity: "low" | "medium" | "high";
    location?: string;
    suggestion?: string;
}

export interface StructureAnalysis {
    hasTitle: boolean;
    hasSections: boolean;
    hasTableOfContents: boolean;
    hasTables: boolean;
    hasImages: boolean;
    hasCode: boolean;
    hasCitations: boolean;
    paragraphCount: number;
    sectionCount: number;
    listCount: number;
}

export interface ExtractedEntity {
    text: string;
    type: "person" | "organization" | "location" | "date" | "number" | "email" | "url" | "phone";
    confidence: number;
    count: number;
}

export interface Topic {
    name: string;
    relevance: number;
    keywords: string[];
}

export interface ReadabilityScore {
    fleschKincaid: number;
    gradeLevel: string;
    avgSentenceLength: number;
    avgWordLength: number;
    complexWordPercent: number;
    readingTimeMinutes: number;
}

// ============== Language Detection ==============

const LANGUAGE_PATTERNS: Record<string, RegExp[]> = {
    es: [
        /\b(el|la|los|las|un|una|de|en|que|y|a|para|con|por)\b/gi,
        /\b(está|están|tiene|tienen|puede|pueden|hacer|ser)\b/gi,
        /[áéíóúñü]/gi,
    ],
    en: [
        /\b(the|a|an|is|are|was|were|have|has|had|will|would)\b/gi,
        /\b(and|or|but|for|with|this|that|from|they|we|you)\b/gi,
    ],
    pt: [
        /\b(o|a|os|as|um|uma|de|em|que|e|para|com|por)\b/gi,
        /\b(está|são|tem|têm|pode|podem|fazer|ser)\b/gi,
        /[ãõç]/gi,
    ],
    fr: [
        /\b(le|la|les|un|une|de|en|que|et|à|pour|avec|par)\b/gi,
        /\b(est|sont|ont|peut|peuvent|faire|être)\b/gi,
        /[àâçéèêëîïôûùü]/gi,
    ],
};

export function detectLanguage(text: string): LanguageInfo {
    const sample = text.slice(0, 5000000);
    const scores: Record<string, number> = {};

    for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
        let score = 0;
        for (const pattern of patterns) {
            const matches = sample.match(pattern);
            score += matches?.length || 0;
        }
        scores[lang] = score;
    }

    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;

    const primary = sorted[0];
    const confidence = primary[1] / total;

    const langNames: Record<string, string> = {
        es: "Spanish",
        en: "English",
        pt: "Portuguese",
        fr: "French",
    };

    return {
        code: primary[0],
        name: langNames[primary[0]] || primary[0],
        confidence: Math.min(0.99, confidence * 2),
        isMultilingual: sorted.length > 1 && sorted[1][1] > total * 0.2,
        secondaryLanguages: sorted.slice(1, 3)
            .filter(([, score]) => score > total * 0.1)
            .map(([lang]) => lang),
    };
}

// ============== Content Type Detection ==============

const CONTENT_INDICATORS: Record<DocumentCategory, RegExp[]> = {
    academic: [
        /\b(abstract|methodology|hypothesis|conclusion|references|bibliography)\b/gi,
        /\b(study|research|analysis|findings|literature|review)\b/gi,
        /\bet al\./gi,
        /\(\d{4}\)/g, // Citations like (2024)
    ],
    legal: [
        /\b(whereas|hereby|herein|thereof|pursuant|notwithstanding)\b/gi,
        /\b(contract|agreement|clause|party|parties|terms|conditions)\b/gi,
        /\b(law|legal|court|judge|plaintiff|defendant|attorney)\b/gi,
    ],
    technical: [
        /\b(api|sdk|implementation|algorithm|function|method|class)\b/gi,
        /\b(specification|documentation|protocol|interface|module)\b/gi,
        /```[\s\S]*```/g,
        /\b(error|exception|debug|deploy|config)\b/gi,
    ],
    business: [
        /\b(revenue|profit|market|strategy|stakeholder|roi|kpi)\b/gi,
        /\b(quarterly|annual|fiscal|budget|forecast|growth)\b/gi,
        /\b(company|corporation|enterprise|client|customer)\b/gi,
    ],
    medical: [
        /\b(patient|diagnosis|treatment|symptom|medication|dose)\b/gi,
        /\b(clinical|therapy|disease|condition|healthcare)\b/gi,
        /\b(mg|ml|iv|po|bid|tid|prn)\b/gi,
    ],
    financial: [
        /\b(investment|portfolio|assets|liabilities|equity|dividend)\b/gi,
        /\b(stock|bond|fund|market|trading|securities)\b/gi,
        /\$[\d,]+/g,
    ],
    creative: [
        /\b(chapter|scene|character|story|narrative|plot)\b/gi,
        /[""][^""]+[""].*said/gi,
    ],
    news: [
        /\b(reported|announced|according to|sources say|breaking)\b/gi,
        /\b(yesterday|today|last week|officials|government)\b/gi,
    ],
    casual: [
        /\b(lol|omg|btw|idk|gonna|wanna|kinda|sorta)\b/gi,
        /[!?]{2,}/g,
        /[:;]-?[)D(P]/g,
    ],
    mixed: [],
};

export function detectContentType(text: string): ContentType {
    const sample = text.slice(0, 5000000);
    const scores: Record<string, { score: number; indicators: string[] }> = {};

    for (const [type, patterns] of Object.entries(CONTENT_INDICATORS)) {
        const indicators: string[] = [];
        let score = 0;

        for (const pattern of patterns) {
            const matches = sample.match(pattern);
            if (matches) {
                score += matches.length;
                indicators.push(...matches.slice(0, 3));
            }
        }

        scores[type] = { score, indicators: [...new Set(indicators)] };
    }

    const sorted = Object.entries(scores)
        .filter(([type]) => type !== "mixed")
        .sort((a, b) => b[1].score - a[1].score);

    const total = sorted.reduce((sum, [, { score }]) => sum + score, 0) || 1;
    const primary = sorted[0];

    return {
        primary: primary[0] as DocumentCategory,
        secondary: sorted[1]?.[1].score > total * 0.2
            ? sorted[1][0] as DocumentCategory
            : undefined,
        confidence: Math.min(0.95, (primary[1].score / total) * 2),
        indicators: primary[1].indicators.slice(0, 5),
    };
}

// ============== Structure Analysis ==============

export function analyzeStructure(text: string): StructureAnalysis {
    const lines = text.split("\n");

    return {
        hasTitle: /^#\s|^[A-Z][^.!?]*$/m.test(text.slice(0, 500)),
        hasSections: (text.match(/^#{1,3}\s|^[A-Z][^.!?]{5,50}$/gm)?.length || 0) > 2,
        hasTableOfContents: /table of contents|índice|contenido/i.test(text.slice(0, 2000)),
        hasTables: /\|.*\|.*\|/g.test(text) || /<table/i.test(text),
        hasImages: /!\[.*\]\(.*\)|<img/i.test(text),
        hasCode: /```[\s\S]*```|`[^`]+`/.test(text),
        hasCitations: /\[\d+\]|\(\w+,?\s*\d{4}\)|et al\./i.test(text),
        paragraphCount: (text.match(/\n\n[^\n]/g)?.length || 0) + 1,
        sectionCount: text.match(/^#{1,3}\s/gm)?.length || 0,
        listCount: text.match(/^[\s]*[-*•]\s|^\d+\.\s/gm)?.length || 0,
    };
}

// ============== Entity Extraction ==============

const ENTITY_PATTERNS: Record<ExtractedEntity["type"], RegExp> = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
    url: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi,
    phone: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    date: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
    number: /\$[\d,]+(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b/g,
    person: /\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
    organization: /\b(?:Inc|Corp|LLC|Ltd|Company|University|Institute|Foundation)\b/gi,
    location: /\b(?:Street|Avenue|Road|Boulevard|City|State|Country)\b/gi,
};

export function extractEntities(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seen = new Map<string, ExtractedEntity>();

    for (const [type, pattern] of Object.entries(ENTITY_PATTERNS)) {
        const matches = text.match(pattern) || [];

        for (const match of matches) {
            const key = `${type}:${match.toLowerCase()}`;
            const existing = seen.get(key);

            if (existing) {
                existing.count++;
            } else {
                const entity = {
                    text: match,
                    type: type as ExtractedEntity["type"],
                    confidence: type === "email" || type === "url" ? 0.95 : 0.7,
                    count: 1,
                };
                seen.set(key, entity);
                entities.push(entity);
            }
        }
    }

    return entities.sort((a, b) => b.count - a.count).slice(0, 50);
}

// ============== Readability ==============

export function calculateReadability(text: string): ReadabilityScore {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);

    const avgSentenceLength = words.length / Math.max(1, sentences.length);
    const avgWordLength = words.reduce((s, w) => s + w.length, 0) / Math.max(1, words.length);

    // Flesch-Kincaid Grade Level
    const fleschKincaid = 0.39 * avgSentenceLength + 11.8 * (syllables / words.length) - 15.59;

    const complexWords = words.filter(w => countSyllables(w) >= 3).length;
    const complexWordPercent = (complexWords / words.length) * 100;

    const wordsPerMinute = 200;
    const readingTimeMinutes = words.length / wordsPerMinute;

    const gradeLevel = fleschKincaid < 6 ? "Elementary" :
        fleschKincaid < 9 ? "Middle School" :
            fleschKincaid < 12 ? "High School" :
                fleschKincaid < 16 ? "College" : "Graduate";

    return {
        fleschKincaid: Math.max(0, Math.min(20, fleschKincaid)),
        gradeLevel,
        avgSentenceLength,
        avgWordLength,
        complexWordPercent,
        readingTimeMinutes,
    };
}

function countSyllables(word: string): number {
    word = word.toLowerCase().replace(/[^a-z]/g, "");
    if (word.length <= 3) return 1;

    const vowels = word.match(/[aeiouy]+/g);
    let count = vowels?.length || 1;

    if (word.endsWith("e")) count--;
    if (word.endsWith("le") && word.length > 2 && !/[aeiouy]le$/.test(word)) count++;

    return Math.max(1, count);
}

// ============== Quality Analysis ==============

export function analyzeQuality(text: string): QualityMetrics {
    const issues: QualityIssue[] = [];

    // Check for incomplete sentences
    const incompleteMatch = text.match(/[^.!?]\s*$/);
    if (incompleteMatch) {
        issues.push({
            type: "incomplete",
            severity: "low",
            suggestion: "Document may be truncated",
        });
    }

    // Check for excessive repetition
    const words = text.toLowerCase().split(/\s+/);
    const wordFreq = new Map<string, number>();
    for (const word of words) {
        if (word.length > 4) {
            wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }
    }
    const maxRepetition = Math.max(...Array.from(wordFreq.values()));
    if (maxRepetition > words.length * 0.05) {
        issues.push({
            type: "unclear",
            severity: "medium",
            suggestion: "High word repetition detected",
        });
    }

    const clarity = 100 - issues.filter(i => i.type === "unclear").length * 10;
    const completeness = text.length > 100 ? 90 : 60;
    const formatting = (text.match(/\n\n|#{1,3}\s|[-*]\s/g)?.length || 0) > 3 ? 85 : 70;

    return {
        overall: Math.round((clarity + completeness + formatting) / 3),
        clarity,
        completeness,
        accuracy: 80, // Would need external validation
        formatting,
        issues,
    };
}

// ============== Main Function ==============

export function analyzeContent(text: string): ContentAnalysis {
    return {
        language: detectLanguage(text),
        contentType: detectContentType(text),
        quality: analyzeQuality(text),
        structure: analyzeStructure(text),
        entities: extractEntities(text),
        topics: extractTopics(text),
        readability: calculateReadability(text),
    };
}

function extractTopics(text: string): Topic[] {
    // Simple keyword extraction
    const words = text.toLowerCase().split(/\s+/);
    const freq = new Map<string, number>();

    for (const word of words) {
        if (word.length > 5 && !/^(would|could|should|these|those|their|which|about)$/.test(word)) {
            freq.set(word, (freq.get(word) || 0) + 1);
        }
    }

    return Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([word, count]) => ({
            name: word,
            relevance: count / words.length,
            keywords: [word],
        }));
}

export const contentQualityAnalyzer = {
    analyzeContent,
    detectLanguage,
    detectContentType,
    analyzeStructure,
    extractEntities,
    calculateReadability,
    analyzeQuality,
};

export default contentQualityAnalyzer;
