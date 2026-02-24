/**
 * Enhanced Semantic Chunker - ILIAGPT PRO 3.0 (10x Enhanced)
 * 
 * Context-aware chunking that preserves structure and meaning.
 * Handles tables, code blocks, and cross-references intelligently.
 */

// ============== Types ==============

export interface EnhancedChunk {
    id: string;
    content: string;
    type: ChunkType;
    metadata: ChunkMetadata;
    embedding?: number[];
    links: ChunkLink[];
}

export type ChunkType =
    | "paragraph"
    | "heading"
    | "table"
    | "code"
    | "list"
    | "quote"
    | "figure"
    | "citation"
    | "mixed";

export interface ChunkMetadata {
    position: number;
    pageNumber?: number;
    sectionTitle?: string;
    sectionHierarchy: string[];
    wordCount: number;
    tokenEstimate: number;
    language?: string;
    importance: number; // 0-1
    hasEntities: boolean;
    entityTypes?: string[];
}

export interface ChunkLink {
    type: "reference" | "continues" | "related" | "parent" | "child";
    targetId: string;
    strength: number;
}

export interface ChunkerConfig {
    targetSize?: number;
    maxSize?: number;
    minSize?: number;
    overlap?: number;
    preserveStructure?: boolean;
    includeMetadata?: boolean;
    generateLinks?: boolean;
}

// ============== Structure Detection ==============

interface StructureBlock {
    type: ChunkType;
    content: string;
    startLine: number;
    endLine: number;
    indent: number;
    heading?: string;
}

function detectStructure(text: string): StructureBlock[] {
    const lines = text.split("\n");
    const blocks: StructureBlock[] = [];
    let currentBlock: StructureBlock | null = null;
    let inCodeBlock = false;
    let inTable = false;
    let currentHeading = "";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const indent = line.length - line.trimStart().length;

        // Code block detection
        if (trimmed.startsWith("```")) {
            if (inCodeBlock) {
                // End of code block
                if (currentBlock) {
                    currentBlock.content += "\n" + line;
                    currentBlock.endLine = i;
                    blocks.push(currentBlock);
                    currentBlock = null;
                }
                inCodeBlock = false;
                continue;
            } else {
                // Start of code block
                finishCurrentBlock();
                currentBlock = {
                    type: "code",
                    content: line,
                    startLine: i,
                    endLine: i,
                    indent,
                    heading: currentHeading,
                };
                inCodeBlock = true;
                continue;
            }
        }

        if (inCodeBlock && currentBlock) {
            currentBlock.content += "\n" + line;
            currentBlock.endLine = i;
            continue;
        }

        // Table detection
        if (trimmed.includes("|") && trimmed.split("|").length >= 3) {
            if (!inTable) {
                finishCurrentBlock();
                currentBlock = {
                    type: "table",
                    content: line,
                    startLine: i,
                    endLine: i,
                    indent,
                    heading: currentHeading,
                };
                inTable = true;
            } else if (currentBlock) {
                currentBlock.content += "\n" + line;
                currentBlock.endLine = i;
            }
            continue;
        } else if (inTable) {
            inTable = false;
            if (currentBlock) {
                blocks.push(currentBlock);
                currentBlock = null;
            }
        }

        // Heading detection
        if (/^#{1,6}\s/.test(trimmed)) {
            finishCurrentBlock();
            currentHeading = trimmed.replace(/^#+\s*/, "");
            blocks.push({
                type: "heading",
                content: line,
                startLine: i,
                endLine: i,
                indent: 0,
                heading: currentHeading,
            });
            continue;
        }

        // List detection
        if (/^[-*•]\s|^\d+\.\s/.test(trimmed)) {
            if (currentBlock?.type !== "list") {
                finishCurrentBlock();
                currentBlock = {
                    type: "list",
                    content: line,
                    startLine: i,
                    endLine: i,
                    indent,
                    heading: currentHeading,
                };
            } else {
                currentBlock.content += "\n" + line;
                currentBlock.endLine = i;
            }
            continue;
        }

        // Quote detection
        if (trimmed.startsWith(">")) {
            if (currentBlock?.type !== "quote") {
                finishCurrentBlock();
                currentBlock = {
                    type: "quote",
                    content: line,
                    startLine: i,
                    endLine: i,
                    indent,
                    heading: currentHeading,
                };
            } else {
                currentBlock.content += "\n" + line;
                currentBlock.endLine = i;
            }
            continue;
        }

        // Empty line = paragraph break
        if (trimmed === "") {
            if (currentBlock && currentBlock.type === "paragraph") {
                finishCurrentBlock();
            }
            continue;
        }

        // Regular paragraph
        if (currentBlock?.type === "paragraph") {
            currentBlock.content += "\n" + line;
            currentBlock.endLine = i;
        } else {
            finishCurrentBlock();
            currentBlock = {
                type: "paragraph",
                content: line,
                startLine: i,
                endLine: i,
                indent,
                heading: currentHeading,
            };
        }
    }

    finishCurrentBlock();
    return blocks;

    function finishCurrentBlock() {
        if (currentBlock && currentBlock.content.trim()) {
            blocks.push(currentBlock);
            currentBlock = null;
        }
    }
}

// ============== Importance Scoring ==============

function calculateImportance(block: StructureBlock): number {
    let score = 0.5;

    // Headings are important
    if (block.type === "heading") score = 0.9;

    // Tables and code are valuable
    if (block.type === "table") score = 0.85;
    if (block.type === "code") score = 0.8;

    // Quotes might contain key information
    if (block.type === "quote") score = 0.7;

    // Length affects importance
    const wordCount = block.content.split(/\s+/).length;
    if (wordCount > 50) score += 0.1;
    if (wordCount > 100) score += 0.05;

    // First few blocks are typically more important
    if (block.startLine < 20) score += 0.1;

    // Key phrases increase importance
    const keyPhrases = [
        "important", "critical", "conclusion", "summary",
        "resultado", "conclusión", "importante", "clave"
    ];
    if (keyPhrases.some(p => block.content.toLowerCase().includes(p))) {
        score += 0.15;
    }

    return Math.min(1, score);
}

// ============== Chunk Generation ==============

function generateChunkId(): string {
    return `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function mergeSmallBlocks(
    blocks: StructureBlock[],
    minSize: number
): StructureBlock[] {
    const merged: StructureBlock[] = [];
    let accumulator: StructureBlock | null = null;

    for (const block of blocks) {
        const blockTokens = estimateTokens(block.content);

        if (block.type === "heading" || block.type === "table" || block.type === "code") {
            // Don't merge special blocks
            if (accumulator) {
                merged.push(accumulator);
                accumulator = null;
            }
            merged.push(block);
            continue;
        }

        if (blockTokens >= minSize) {
            if (accumulator) {
                merged.push(accumulator);
                accumulator = null;
            }
            merged.push(block);
        } else {
            if (!accumulator) {
                accumulator = { ...block, type: "mixed" };
            } else {
                accumulator.content += "\n\n" + block.content;
                accumulator.endLine = block.endLine;

                if (estimateTokens(accumulator.content) >= minSize) {
                    merged.push(accumulator);
                    accumulator = null;
                }
            }
        }
    }

    if (accumulator) {
        merged.push(accumulator);
    }

    return merged;
}

function splitLargeBlock(
    block: StructureBlock,
    maxSize: number
): StructureBlock[] {
    const tokens = estimateTokens(block.content);
    if (tokens <= maxSize) return [block];

    // For code blocks, split on function/class boundaries
    if (block.type === "code") {
        const functionMatches = block.content.split(/\n(?=(?:function|class|def|const|let|var)\s)/);
        if (functionMatches.length > 1) {
            return functionMatches.map((content, i) => ({
                ...block,
                content: i === 0 ? content : "```\n" + content,
                startLine: block.startLine + i * 10,
                endLine: block.startLine + (i + 1) * 10 - 1,
            }));
        }
    }

    // For tables, keep as single chunk if possible
    if (block.type === "table") {
        return [block];
    }

    // For other blocks, split on sentence boundaries
    const sentences = block.content.match(/[^.!?]+[.!?]+/g) || [block.content];
    const chunks: StructureBlock[] = [];
    let current = "";
    let startLine = block.startLine;

    for (const sentence of sentences) {
        if (estimateTokens(current + sentence) > maxSize && current) {
            chunks.push({
                ...block,
                content: current.trim(),
                startLine,
                endLine: startLine + Math.ceil(current.length / 80),
            });
            startLine = chunks[chunks.length - 1].endLine + 1;
            current = sentence;
        } else {
            current += sentence;
        }
    }

    if (current.trim()) {
        chunks.push({
            ...block,
            content: current.trim(),
            startLine,
            endLine: block.endLine,
        });
    }

    return chunks;
}

// ============== Link Generation ==============

function generateLinks(chunks: EnhancedChunk[]): void {
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Sequential links
        if (i > 0) {
            chunk.links.push({
                type: "continues",
                targetId: chunks[i - 1].id,
                strength: 0.8,
            });
        }

        // Same section links
        const sameSection = chunks.filter(
            (c, j) => j !== i &&
                c.metadata.sectionTitle === chunk.metadata.sectionTitle &&
                c.metadata.sectionTitle !== undefined
        );

        for (const related of sameSection.slice(0, 3)) {
            chunk.links.push({
                type: "related",
                targetId: related.id,
                strength: 0.6,
            });
        }
    }
}

// ============== Main Function ==============

export function enhancedSemanticChunk(
    text: string,
    config: ChunkerConfig = {}
): EnhancedChunk[] {
    const {
        targetSize = 400,
        maxSize = 800,
        minSize = 100,
        overlap = 50,
        preserveStructure = true,
        includeMetadata = true,
        generateLinks: shouldGenerateLinks = true,
    } = config;

    // Step 1: Detect structure
    let blocks = detectStructure(text);

    // Step 2: Merge small blocks
    blocks = mergeSmallBlocks(blocks, minSize);

    // Step 3: Split large blocks
    const processedBlocks: StructureBlock[] = [];
    for (const block of blocks) {
        processedBlocks.push(...splitLargeBlock(block, maxSize));
    }

    // Step 4: Build section hierarchy
    let currentHierarchy: string[] = [];
    const blockHierarchies: string[][] = [];

    for (const block of processedBlocks) {
        if (block.type === "heading") {
            // Determine heading level
            const level = (block.content.match(/^#+/) || ["#"])[0].length;
            currentHierarchy = currentHierarchy.slice(0, level - 1);
            currentHierarchy.push(block.heading || "");
        }
        blockHierarchies.push([...currentHierarchy]);
    }

    // Step 5: Create enhanced chunks
    const chunks: EnhancedChunk[] = processedBlocks.map((block, index) => {
        const wordCount = block.content.split(/\s+/).length;
        const importance = calculateImportance(block);

        // Basic entity detection
        const hasEntities = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b|@|\$\d/.test(block.content);

        return {
            id: generateChunkId(),
            content: block.content,
            type: block.type,
            metadata: {
                position: index,
                sectionTitle: block.heading,
                sectionHierarchy: blockHierarchies[index],
                wordCount,
                tokenEstimate: estimateTokens(block.content),
                importance,
                hasEntities,
            },
            links: [],
        };
    });

    // Step 6: Generate links
    if (shouldGenerateLinks) {
        generateLinks(chunks);
    }

    // Step 7: Add overlap for continuity
    if (overlap > 0 && chunks.length > 1) {
        for (let i = 1; i < chunks.length; i++) {
            const prevContent = chunks[i - 1].content;
            const overlapText = prevContent.slice(-overlap * 4); // ~overlap tokens

            if (chunks[i].type === "paragraph" || chunks[i].type === "mixed") {
                chunks[i].content = `[...] ${overlapText}\n\n${chunks[i].content}`;
                chunks[i].metadata.tokenEstimate += overlap;
            }
        }
    }

    return chunks;
}

/**
 * Get chunks optimized for RAG retrieval
 */
export function getRAGOptimizedChunks(
    text: string,
    maxTokensPerChunk: number = 500
): { content: string; metadata: ChunkMetadata }[] {
    const chunks = enhancedSemanticChunk(text, {
        targetSize: maxTokensPerChunk * 0.8,
        maxSize: maxTokensPerChunk,
        minSize: maxTokensPerChunk * 0.2,
        overlap: 30,
        preserveStructure: true,
    });

    return chunks.map(c => ({
        content: c.content,
        metadata: c.metadata,
    }));
}

export const enhancedSemanticChunker = {
    enhancedSemanticChunk,
    getRAGOptimizedChunks,
    detectStructure,
    calculateImportance,
};

export default enhancedSemanticChunker;
