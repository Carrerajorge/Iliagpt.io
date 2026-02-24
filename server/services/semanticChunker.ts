/**
 * Semantic Chunking Service
 * 
 * Divides documents by logical sections/context instead of fixed token counts.
 * Optimized for RAG (Retrieval Augmented Generation).
 * 
 * Features:
 * - Header-based splitting
 * - Paragraph boundary detection
 * - Overlap management for context
 * - Metadata preservation per chunk
 */

// =============================================================================
// Types
// =============================================================================

export interface SemanticChunk {
    id: string;
    content: string;
    type: 'heading' | 'paragraph' | 'list' | 'code' | 'table' | 'mixed';
    headingHierarchy: string[];
    pageNumber?: number;
    sectionNumber?: number;
    startOffset: number;
    endOffset: number;
    metadata: ChunkMetadata;
}

export interface ChunkMetadata {
    wordCount: number;
    charCount: number;
    language?: string;
    hasCode: boolean;
    hasTable: boolean;
    hasList: boolean;
    importance: 'high' | 'medium' | 'low';
}

export interface ChunkingOptions {
    maxChunkSize?: number;           // Max chars per chunk
    minChunkSize?: number;           // Min chars per chunk
    overlapSize?: number;            // Overlap between chunks
    respectHeadings?: boolean;       // Split on headings
    respectParagraphs?: boolean;     // Split on paragraphs
    preserveCodeBlocks?: boolean;    // Keep code blocks intact
    preserveTables?: boolean;        // Keep tables intact
}

export interface ChunkingResult {
    chunks: SemanticChunk[];
    totalChunks: number;
    averageChunkSize: number;
    processingTimeMs: number;
    documentStructure: DocumentStructure;
}

export interface DocumentStructure {
    headings: { level: number; text: string; offset: number }[];
    sections: { title: string; startOffset: number; endOffset: number }[];
    hasCodeBlocks: boolean;
    hasTables: boolean;
    estimatedLanguage: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_OPTIONS: Required<ChunkingOptions> = {
    maxChunkSize: 1500,
    minChunkSize: 100,
    overlapSize: 150,
    respectHeadings: true,
    respectParagraphs: true,
    preserveCodeBlocks: true,
    preserveTables: true
};

// =============================================================================
// Heading Patterns (Markdown + Common Document Formats)
// =============================================================================

const HEADING_PATTERNS = [
    // Markdown headings
    { pattern: /^#{1,6}\s+.+$/gm, level: (match: string) => match.match(/^#+/)?.[0].length || 1 },

    // Underlined headings
    { pattern: /^.+\n[=]+$/gm, level: () => 1 },
    { pattern: /^.+\n[-]+$/gm, level: () => 2 },

    // Numbered sections (1. 1.1 1.1.1)
    { pattern: /^(?:\d+\.)+\s+.+$/gm, level: (match: string) => (match.match(/\d+\./g) || []).length },

    // ALL CAPS headings
    { pattern: /^[A-Z][A-Z\s]{10,}$/gm, level: () => 2 },
];

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Perform semantic chunking on text content
 */
export function chunkDocument(
    text: string,
    options: ChunkingOptions = {}
): ChunkingResult {
    const startTime = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Analyze document structure
    const structure = analyzeDocumentStructure(text);

    // Split into initial sections based on headings
    const sections = splitByHeadings(text, structure.headings, opts);

    // Further split large sections
    const chunks: SemanticChunk[] = [];
    let chunkIndex = 0;

    for (const section of sections) {
        const sectionChunks = splitSection(section, chunkIndex, opts);
        chunks.push(...sectionChunks);
        chunkIndex += sectionChunks.length;
    }

    // Apply overlap
    const chunksWithOverlap = applyOverlap(chunks, opts.overlapSize);

    // Calculate statistics
    const totalChars = chunksWithOverlap.reduce((sum, c) => sum + c.content.length, 0);
    const averageChunkSize = chunksWithOverlap.length > 0
        ? Math.round(totalChars / chunksWithOverlap.length)
        : 0;

    return {
        chunks: chunksWithOverlap,
        totalChunks: chunksWithOverlap.length,
        averageChunkSize,
        processingTimeMs: Date.now() - startTime,
        documentStructure: structure
    };
}

/**
 * Analyze document structure
 */
function analyzeDocumentStructure(text: string): DocumentStructure {
    const headings: DocumentStructure['headings'] = [];

    // Extract headings
    for (const { pattern, level } of HEADING_PATTERNS) {
        let match;
        const regex = new RegExp(pattern.source, pattern.flags);
        while ((match = regex.exec(text)) !== null) {
            headings.push({
                level: level(match[0]),
                text: match[0].replace(/^#+\s*/, '').trim(),
                offset: match.index
            });
        }
    }

    // Sort by offset
    headings.sort((a, b) => a.offset - b.offset);

    // Build sections
    const sections: DocumentStructure['sections'] = [];
    for (let i = 0; i < headings.length; i++) {
        const current = headings[i];
        const next = headings[i + 1];
        sections.push({
            title: current.text,
            startOffset: current.offset,
            endOffset: next ? next.offset : text.length
        });
    }

    // Detect code blocks and tables
    const hasCodeBlocks = /```[\s\S]*?```/.test(text) || /^    .+$/gm.test(text);
    const hasTables = /^\|.+\|$/gm.test(text) || /\t.*\t/gm.test(text);

    // Simple language detection
    const estimatedLanguage = detectLanguage(text);

    return {
        headings,
        sections,
        hasCodeBlocks,
        hasTables,
        estimatedLanguage
    };
}

/**
 * Split text by headings
 */
function splitByHeadings(
    text: string,
    headings: DocumentStructure['headings'],
    opts: Required<ChunkingOptions>
): { content: string; heading: string; level: number; offset: number }[] {
    if (!opts.respectHeadings || headings.length === 0) {
        return [{ content: text, heading: '', level: 0, offset: 0 }];
    }

    const sections: { content: string; heading: string; level: number; offset: number }[] = [];

    // Add content before first heading
    if (headings[0].offset > 0) {
        sections.push({
            content: text.substring(0, headings[0].offset).trim(),
            heading: '',
            level: 0,
            offset: 0
        });
    }

    // Add sections between headings
    for (let i = 0; i < headings.length; i++) {
        const start = headings[i].offset;
        const end = headings[i + 1]?.offset || text.length;
        const content = text.substring(start, end).trim();

        if (content) {
            sections.push({
                content,
                heading: headings[i].text,
                level: headings[i].level,
                offset: start
            });
        }
    }

    return sections;
}

/**
 * Split a section into chunks respecting paragraphs
 */
function splitSection(
    section: { content: string; heading: string; level: number; offset: number },
    startIndex: number,
    opts: Required<ChunkingOptions>
): SemanticChunk[] {
    const { content, heading, offset } = section;
    const chunks: SemanticChunk[] = [];

    // If content is small enough, return as single chunk
    if (content.length <= opts.maxChunkSize) {
        chunks.push(createChunk(
            `chunk-${startIndex}`,
            content,
            heading ? [heading] : [],
            offset,
            offset + content.length
        ));
        return chunks;
    }

    // Split by paragraphs first
    const paragraphs = content.split(/\n\s*\n/);
    let currentChunk = '';
    let currentOffset = offset;
    let chunkIndex = startIndex;

    for (const paragraph of paragraphs) {
        // Check for code blocks or tables that should be preserved
        if (opts.preserveCodeBlocks && /```[\s\S]*?```/.test(paragraph)) {
            if (currentChunk) {
                chunks.push(createChunk(
                    `chunk-${chunkIndex++}`,
                    currentChunk.trim(),
                    heading ? [heading] : [],
                    currentOffset,
                    currentOffset + currentChunk.length
                ));
                currentChunk = '';
            }
            chunks.push(createChunk(
                `chunk-${chunkIndex++}`,
                paragraph,
                heading ? [heading] : [],
                currentOffset,
                currentOffset + paragraph.length,
                'code'
            ));
            currentOffset += paragraph.length + 2;
            continue;
        }

        // Would adding this paragraph exceed max size?
        if (currentChunk.length + paragraph.length > opts.maxChunkSize) {
            if (currentChunk.length >= opts.minChunkSize) {
                chunks.push(createChunk(
                    `chunk-${chunkIndex++}`,
                    currentChunk.trim(),
                    heading ? [heading] : [],
                    currentOffset,
                    currentOffset + currentChunk.length
                ));
                currentOffset += currentChunk.length;
                currentChunk = paragraph + '\n\n';
            } else {
                // Force add to meet minimum
                currentChunk += paragraph + '\n\n';
            }
        } else {
            currentChunk += paragraph + '\n\n';
        }
    }

    // Add remaining content
    if (currentChunk.trim().length >= opts.minChunkSize) {
        chunks.push(createChunk(
            `chunk-${chunkIndex}`,
            currentChunk.trim(),
            heading ? [heading] : [],
            currentOffset,
            currentOffset + currentChunk.length
        ));
    } else if (chunks.length > 0) {
        // Merge with previous chunk
        const lastChunk = chunks[chunks.length - 1];
        lastChunk.content += '\n\n' + currentChunk.trim();
        lastChunk.endOffset = currentOffset + currentChunk.length;
        lastChunk.metadata.charCount = lastChunk.content.length;
        lastChunk.metadata.wordCount = countWords(lastChunk.content);
    }

    return chunks;
}

/**
 * Apply overlap between chunks for context preservation
 */
function applyOverlap(chunks: SemanticChunk[], overlapSize: number): SemanticChunk[] {
    if (overlapSize === 0 || chunks.length <= 1) return chunks;

    return chunks.map((chunk, index) => {
        if (index === 0) return chunk;

        const prevChunk = chunks[index - 1];
        const overlapText = prevChunk.content.slice(-overlapSize);

        // Find a good break point (sentence or word boundary)
        const breakPoint = overlapText.search(/[.!?]\s+\S/) + 1;
        const cleanOverlap = breakPoint > 0
            ? overlapText.slice(breakPoint).trim()
            : overlapText.split(/\s+/).slice(-3).join(' ');

        return {
            ...chunk,
            content: cleanOverlap + '\n\n' + chunk.content,
            metadata: {
                ...chunk.metadata,
                charCount: chunk.content.length + cleanOverlap.length + 2,
                wordCount: countWords(cleanOverlap + ' ' + chunk.content)
            }
        };
    });
}

// =============================================================================
// Helper Functions
// =============================================================================

function createChunk(
    id: string,
    content: string,
    headingHierarchy: string[],
    startOffset: number,
    endOffset: number,
    type: SemanticChunk['type'] = 'paragraph'
): SemanticChunk {
    const hasCode = /```|`[^`]+`/.test(content);
    const hasTable = /^\|.+\|$/gm.test(content);
    const hasList = /^[\s]*[-*•]\s/gm.test(content);

    // Determine type based on content
    let detectedType = type;
    if (hasCode && !hasTable) detectedType = 'code';
    else if (hasTable) detectedType = 'table';
    else if (hasList) detectedType = 'list';
    else if (headingHierarchy.length > 0 && content.length < 200) detectedType = 'heading';

    // Determine importance
    let importance: ChunkMetadata['importance'] = 'medium';
    if (headingHierarchy.length > 0) importance = 'high';
    else if (content.length < 100) importance = 'low';

    return {
        id,
        content,
        type: detectedType,
        headingHierarchy,
        startOffset,
        endOffset,
        metadata: {
            wordCount: countWords(content),
            charCount: content.length,
            hasCode,
            hasTable,
            hasList,
            importance
        }
    };
}

function countWords(text: string): number {
    return text.split(/\s+/).filter(w => w.length > 0).length;
}

function detectLanguage(text: string): string {
    // Simple heuristic based on common words
    const spanishWords = ['el', 'la', 'de', 'que', 'en', 'es', 'para', 'con'];
    const englishWords = ['the', 'of', 'and', 'to', 'in', 'is', 'for', 'with'];

    const words = text.toLowerCase().split(/\s+/);
    let spanishCount = 0;
    let englishCount = 0;

    for (const word of words) {
        if (spanishWords.includes(word)) spanishCount++;
        if (englishWords.includes(word)) englishCount++;
    }

    return spanishCount > englishCount ? 'es' : 'en';
}

// =============================================================================
// Export
// =============================================================================

export const semanticChunker = {
    chunkDocument,
    analyzeDocumentStructure,
    DEFAULT_OPTIONS
};

export default semanticChunker;
