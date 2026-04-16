/**
 * PDF Full-Text Indexer Service
 * 
 * Features:
 * - Extract text from uploaded PDFs
 * - Full-text search with highlighting
 * - Passage-level search results
 * - Memory-efficient processing
 */

import crypto from "crypto";
import { LRUCache } from "lru-cache";

// In-memory search index
interface IndexEntry {
    documentId: string;
    filename: string;
    content: string;
    passages: Passage[];
    metadata: DocumentMetadata;
    indexedAt: Date;
}

interface Passage {
    id: string;
    text: string;
    pageNumber?: number;
    position: number;
    length: number;
}

interface DocumentMetadata {
    title?: string;
    author?: string;
    createdDate?: string;
    pageCount?: number;
    wordCount?: number;
    fileSize?: number;
}

interface SearchResult {
    documentId: string;
    filename: string;
    passages: {
        text: string;
        highlighted: string;
        pageNumber?: number;
        score: number;
    }[];
    totalMatches: number;
    metadata: DocumentMetadata;
}

// Index storage
const documentIndex = new Map<string, IndexEntry>();
const wordIndex = new Map<string, Set<string>>(); // word -> document IDs

// Cache for search results
const searchCache = new LRUCache<string, SearchResult[]>({
    max: 100,
    ttl: 5 * 60 * 1000, // 5 minutes
});

// Configuration
const PASSAGE_SIZE = 500; // characters per passage
const PASSAGE_OVERLAP = 100; // overlap between passages
const MIN_WORD_LENGTH = 2;
const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "must", "can", "this", "that",
    "these", "those", "it", "its", "they", "them", "their", "we", "our",
    "you", "your", "he", "she", "him", "her", "his",
    // Spanish
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del",
    "en", "con", "por", "para", "como", "que", "se", "su", "sus", "al",
]);

// Extract text from PDF buffer (placeholder - would use pdf-parse)
export async function extractTextFromPDF(buffer: Buffer): Promise<{
    text: string;
    metadata: DocumentMetadata;
}> {
    try {
        // Dynamic import to handle missing dependency gracefully
        const pdfParse = await import("pdf-parse");
        const data = await pdfParse.default(buffer);

        return {
            text: data.text,
            metadata: {
                title: data.info?.Title,
                author: data.info?.Author,
                createdDate: data.info?.CreationDate,
                pageCount: data.numpages,
                wordCount: data.text.split(/\s+/).length,
                fileSize: buffer.length,
            },
        };
    } catch (error) {
        console.error("[PDFIndexer] Extraction error:", error);
        return {
            text: "",
            metadata: { fileSize: buffer.length },
        };
    }
}

// Split text into passages
function createPassages(text: string): Passage[] {
    const passages: Passage[] = [];
    const cleanText = text.replace(/\s+/g, " ").trim();

    let position = 0;
    let passageIndex = 0;

    while (position < cleanText.length) {
        const end = Math.min(position + PASSAGE_SIZE, cleanText.length);

        // Try to end at sentence boundary
        let actualEnd = end;
        if (end < cleanText.length) {
            const sentenceEnd = cleanText.lastIndexOf(". ", end);
            if (sentenceEnd > position + PASSAGE_SIZE / 2) {
                actualEnd = sentenceEnd + 1;
            }
        }

        const passageText = cleanText.slice(position, actualEnd).trim();

        if (passageText.length >= MIN_WORD_LENGTH * 3) {
            passages.push({
                id: `p_${passageIndex}`,
                text: passageText,
                position,
                length: passageText.length,
            });
            passageIndex++;
        }

        position = actualEnd - PASSAGE_OVERLAP;
        if (position <= passages[passages.length - 1]?.position) {
            position = actualEnd;
        }
    }

    return passages;
}

// Tokenize and normalize text for indexing
function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter(word =>
            word.length >= MIN_WORD_LENGTH &&
            !STOP_WORDS.has(word) &&
            !/^\d+$/.test(word)
        );
}

// Index a document
export async function indexDocument(
    documentId: string,
    filename: string,
    content: Buffer | string
): Promise<{ success: boolean; wordCount: number; passageCount: number }> {
    try {
        let text: string;
        let metadata: DocumentMetadata;

        if (Buffer.isBuffer(content)) {
            const extracted = await extractTextFromPDF(content);
            text = extracted.text;
            metadata = extracted.metadata;
        } else {
            text = content;
            metadata = { wordCount: text.split(/\s+/).length };
        }

        if (!text || text.length < 10) {
            return { success: false, wordCount: 0, passageCount: 0 };
        }

        const passages = createPassages(text);

        // Create index entry
        const entry: IndexEntry = {
            documentId,
            filename,
            content: text,
            passages,
            metadata,
            indexedAt: new Date(),
        };

        documentIndex.set(documentId, entry);

        // Update word index
        const words = tokenize(text);
        for (const word of words) {
            if (!wordIndex.has(word)) {
                wordIndex.set(word, new Set());
            }
            wordIndex.get(word)!.add(documentId);
        }

        console.log(`[PDFIndexer] Indexed ${filename}: ${passages.length} passages, ${words.length} words`);

        return {
            success: true,
            wordCount: words.length,
            passageCount: passages.length
        };
    } catch (error) {
        console.error(`[PDFIndexer] Index error for ${filename}:`, error);
        return { success: false, wordCount: 0, passageCount: 0 };
    }
}

// Highlight matches in text
function highlightMatches(text: string, query: string): string {
    const queryWords = tokenize(query);
    let highlighted = text;

    for (const word of queryWords) {
        const regex = new RegExp(`\\b(${word}\\w*)\\b`, "gi");
        highlighted = highlighted.replace(regex, "**$1**");
    }

    return highlighted;
}

// Calculate relevance score
function calculateScore(passage: string, queryWords: string[]): number {
    const passageWords = new Set(tokenize(passage));
    let matches = 0;
    let exactMatches = 0;

    for (const word of queryWords) {
        if (passageWords.has(word)) {
            exactMatches++;
        }
        for (const pw of passageWords) {
            if (pw.startsWith(word) || word.startsWith(pw)) {
                matches++;
                break;
            }
        }
    }

    const coverage = exactMatches / queryWords.length;
    const density = matches / passageWords.size;

    return coverage * 0.7 + density * 0.3;
}

// Search indexed documents
export function search(
    query: string,
    options: {
        limit?: number;
        documentIds?: string[];
        minScore?: number;
    } = {}
): SearchResult[] {
    const { limit = 20, documentIds, minScore = 0.1 } = options;

    // Check cache
    const cacheKey = crypto
        .createHash("md5")
        .update(JSON.stringify({ query, options }))
        .digest("hex");

    const cached = searchCache.get(cacheKey);
    if (cached) return cached;

    const queryWords = tokenize(query);
    if (queryWords.length === 0) return [];

    // Find candidate documents
    const candidateDocIds = new Set<string>();
    for (const word of queryWords) {
        const docs = wordIndex.get(word);
        if (docs) {
            docs.forEach(id => candidateDocIds.add(id));
        }
        // Also check prefix matches
        for (const [indexWord, docs] of wordIndex) {
            if (indexWord.startsWith(word) || word.startsWith(indexWord)) {
                docs.forEach(id => candidateDocIds.add(id));
            }
        }
    }

    // Filter by specified document IDs
    const targetDocIds = documentIds
        ? [...candidateDocIds].filter(id => documentIds.includes(id))
        : [...candidateDocIds];

    const results: SearchResult[] = [];

    for (const docId of targetDocIds) {
        const entry = documentIndex.get(docId);
        if (!entry) continue;

        const matchingPassages: SearchResult["passages"] = [];

        for (const passage of entry.passages) {
            const score = calculateScore(passage.text, queryWords);

            if (score >= minScore) {
                matchingPassages.push({
                    text: passage.text,
                    highlighted: highlightMatches(passage.text, query),
                    pageNumber: passage.pageNumber,
                    score,
                });
            }
        }

        if (matchingPassages.length > 0) {
            // Sort by score and keep top passages
            matchingPassages.sort((a, b) => b.score - a.score);

            results.push({
                documentId: docId,
                filename: entry.filename,
                passages: matchingPassages.slice(0, 5),
                totalMatches: matchingPassages.length,
                metadata: entry.metadata,
            });
        }
    }

    // Sort by best passage score
    results.sort((a, b) =>
        (b.passages[0]?.score || 0) - (a.passages[0]?.score || 0)
    );

    const finalResults = results.slice(0, limit);
    searchCache.set(cacheKey, finalResults);

    return finalResults;
}

// Remove document from index
export function removeDocument(documentId: string): boolean {
    const entry = documentIndex.get(documentId);
    if (!entry) return false;

    // Remove from word index
    const words = tokenize(entry.content);
    for (const word of words) {
        const docs = wordIndex.get(word);
        if (docs) {
            docs.delete(documentId);
            if (docs.size === 0) {
                wordIndex.delete(word);
            }
        }
    }

    documentIndex.delete(documentId);
    searchCache.clear();

    return true;
}

// Get index statistics
export function getIndexStats(): {
    documentCount: number;
    wordCount: number;
    totalPassages: number;
    totalBytes: number;
} {
    let totalPassages = 0;
    let totalBytes = 0;

    for (const entry of documentIndex.values()) {
        totalPassages += entry.passages.length;
        totalBytes += entry.metadata.fileSize || 0;
    }

    return {
        documentCount: documentIndex.size,
        wordCount: wordIndex.size,
        totalPassages,
        totalBytes,
    };
}

// Clear entire index
export function clearIndex(): void {
    documentIndex.clear();
    wordIndex.clear();
    searchCache.clear();
}

export default {
    indexDocument,
    search,
    removeDocument,
    getIndexStats,
    clearIndex,
    extractTextFromPDF,
};
