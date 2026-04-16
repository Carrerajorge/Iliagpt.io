/**
 * Multi-Level Summarizer Service
 * 
 * Generates summaries at different levels of detail:
 * - Executive summary (1 paragraph)
 * - Key points (5-10 bullets)
 * - Section-by-section breakdown
 * 
 * Uses extractive summarization (no LLM required for basic features)
 */

// =============================================================================
// Types
// =============================================================================

export interface MultiLevelSummary {
    executive: string;           // 1-2 sentences
    keyPoints: string[];         // 5-10 bullet points
    detailed: string;            // Full paragraph summary
    sections: SectionSummary[];  // Per-section summaries
    tableOfContents: TOCEntry[]; // Generated TOC
    statistics: DocumentStats;
}

export interface SectionSummary {
    title: string;
    summary: string;
    keyTerms: string[];
    importance: 'high' | 'medium' | 'low';
}

export interface TOCEntry {
    title: string;
    level: number;
    pageNumber?: number;
}

export interface DocumentStats {
    wordCount: number;
    sentenceCount: number;
    paragraphCount: number;
    estimatedReadingTime: number; // minutes
    complexityScore: number;      // 0-100
}

export interface SummarizationOptions {
    maxExecutiveLength?: number;
    maxKeyPoints?: number;
    includeTableOfContents?: boolean;
    language?: 'es' | 'en' | 'auto';
}

// =============================================================================
// Sentence Scoring (TextRank-inspired)
// =============================================================================

function calculateSentenceScores(sentences: string[]): Map<number, number> {
    const scores = new Map<number, number>();

    // Initial scoring based on position and content
    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        let score = 0;

        // Position scoring (first sentences are often important)
        if (i < 3) score += 2;
        if (i === 0) score += 3;

        // Length scoring (medium length sentences are better)
        const words = sentence.split(/\s+/).length;
        if (words >= 10 && words <= 30) score += 2;
        if (words < 5) score -= 1;

        // Contains important words
        const importantPatterns = [
            /\b(important|crucial|key|main|significant|principal|fundamental)\b/i,
            /\b(resultado|result|conclus|summary|resumen|therefore|por lo tanto)\b/i,
            /\b(first|segundo|third|finally|lastly|primero|segundo|tercero)\b/i
        ];

        for (const pattern of importantPatterns) {
            if (pattern.test(sentence)) score += 1;
        }

        // Contains numbers (often factual/important)
        if (/\d+/.test(sentence)) score += 0.5;

        scores.set(i, score);
    }

    // Similarity-based boost (sentences similar to many others are central)
    for (let i = 0; i < sentences.length; i++) {
        const wordsI = new Set(sentences[i].toLowerCase().split(/\s+/));
        let similaritySum = 0;

        for (let j = 0; j < sentences.length; j++) {
            if (i === j) continue;
            const wordsJ = new Set(sentences[j].toLowerCase().split(/\s+/));
            let overlap = 0;
            for (const word of wordsI) {
                if (wordsJ.has(word) && word.length > 3) overlap++;
            }
            const similarity = overlap / Math.max(wordsI.size, wordsJ.size);
            similaritySum += similarity;
        }

        scores.set(i, (scores.get(i) || 0) + similaritySum * 0.5);
    }

    return scores;
}

function extractTopSentences(sentences: string[], scores: Map<number, number>, count: number): string[] {
    const indexed = sentences.map((s, i) => ({ sentence: s, score: scores.get(i) || 0, index: i }));
    indexed.sort((a, b) => b.score - a.score);

    // Get top sentences but maintain original order
    const topIndices = indexed.slice(0, count).map(x => x.index).sort((a, b) => a - b);
    return topIndices.map(i => sentences[i]);
}

// =============================================================================
// Text Analysis
// =============================================================================

function splitIntoSentences(text: string): string[] {
    // Split on sentence endings, handling common abbreviations
    return text
        .replace(/\b(Dr|Mr|Mrs|Ms|Sr|Sra|vs|etc|Inc|Ltd|Jr|No)\./gi, '$1<DOT>')
        .split(/[.!?]+/)
        .map(s => s.replace(/<DOT>/g, '.').trim())
        .filter(s => s.length > 10);
}

function splitIntoParagraphs(text: string): string[] {
    return text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
}

function extractHeadings(text: string): { title: string; level: number; offset: number }[] {
    const headings: { title: string; level: number; offset: number }[] = [];

    // Markdown headings
    const mdPattern = /^(#{1,6})\s+(.+)$/gm;
    let match;
    while ((match = mdPattern.exec(text)) !== null) {
        headings.push({
            title: match[2].trim(),
            level: match[1].length,
            offset: match.index
        });
    }

    // Numbered sections
    const numPattern = /^(\d+(?:\.\d+)*)\s+(.+)$/gm;
    while ((match = numPattern.exec(text)) !== null) {
        const level = match[1].split('.').length;
        headings.push({
            title: match[2].trim(),
            level,
            offset: match.index
        });
    }

    return headings.sort((a, b) => a.offset - b.offset);
}

function calculateComplexity(text: string): number {
    const words = text.split(/\s+/);
    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
    const sentences = splitIntoSentences(text);
    const avgSentenceLength = words.length / sentences.length;

    // Flesch-Kincaid inspired but simplified
    const complexity = Math.min(100, Math.round(
        (avgWordLength * 10) + (avgSentenceLength * 2)
    ));

    return complexity;
}

// =============================================================================
// Main Function
// =============================================================================

export function generateMultiLevelSummary(
    text: string,
    options: SummarizationOptions = {}
): MultiLevelSummary {
    const {
        maxExecutiveLength = 300,
        maxKeyPoints = 10,
        includeTableOfContents = true
    } = options;

    // Basic analysis
    const paragraphs = splitIntoParagraphs(text);
    const sentences = splitIntoSentences(text);
    const headings = extractHeadings(text);
    const words = text.split(/\s+/).filter(w => w.length > 0);

    // Calculate sentence scores
    const scores = calculateSentenceScores(sentences);

    // Generate executive summary (top 2-3 sentences)
    const topSentences = extractTopSentences(sentences, scores, 3);
    let executive = topSentences.join(' ');
    if (executive.length > maxExecutiveLength) {
        executive = executive.substring(0, maxExecutiveLength - 3) + '...';
    }

    // Generate key points (top 10 sentences, as bullets)
    const keyPoints = extractTopSentences(sentences, scores, maxKeyPoints)
        .map(s => s.length > 150 ? s.substring(0, 147) + '...' : s);

    // Generate detailed summary (top 30% of sentences)
    const detailedCount = Math.max(5, Math.floor(sentences.length * 0.3));
    const detailed = extractTopSentences(sentences, scores, detailedCount).join(' ');

    // Generate section summaries
    const sections: SectionSummary[] = [];
    for (let i = 0; i < headings.length; i++) {
        const start = headings[i].offset;
        const end = headings[i + 1]?.offset || text.length;
        const sectionText = text.substring(start, end);
        const sectionSentences = splitIntoSentences(sectionText);

        if (sectionSentences.length > 0) {
            const sectionScores = calculateSentenceScores(sectionSentences);
            const sectionTop = extractTopSentences(sectionSentences, sectionScores, 2);

            // Extract key terms (simple word frequency)
            const wordFreq = new Map<string, number>();
            for (const word of sectionText.toLowerCase().split(/\s+/)) {
                if (word.length > 4) {
                    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
                }
            }
            const keyTerms = [...wordFreq.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([word]) => word);

            sections.push({
                title: headings[i].title,
                summary: sectionTop.join(' '),
                keyTerms,
                importance: headings[i].level <= 2 ? 'high' : headings[i].level === 3 ? 'medium' : 'low'
            });
        }
    }

    // Generate table of contents
    const tableOfContents: TOCEntry[] = includeTableOfContents
        ? headings.map(h => ({ title: h.title, level: h.level }))
        : [];

    // Calculate statistics
    const statistics: DocumentStats = {
        wordCount: words.length,
        sentenceCount: sentences.length,
        paragraphCount: paragraphs.length,
        estimatedReadingTime: Math.ceil(words.length / 200), // ~200 words per minute
        complexityScore: calculateComplexity(text)
    };

    return {
        executive,
        keyPoints,
        detailed,
        sections,
        tableOfContents,
        statistics
    };
}

// =============================================================================
// Export
// =============================================================================

export const multiLevelSummarizer = {
    generateMultiLevelSummary,
    calculateSentenceScores,
    splitIntoSentences,
    extractHeadings
};

export default multiLevelSummarizer;
