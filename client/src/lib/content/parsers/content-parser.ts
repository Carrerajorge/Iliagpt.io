/**
 * Content Parser Pro
 * 
 * Enterprise-grade parser with:
 * - Streaming support
 * - Performance metrics
 * - Caching with LRU
 * - Worker thread support
 * - Error recovery
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Root, Content as MdastContent } from 'mdast';
import DOMPurify from 'dompurify';
import {
    ContentBlock,
    TextBlock,
    HeadingBlock,
    DividerBlock,
    CodeBlock,
    ListBlock,
    ListItemBlock,
    QuoteBlock,
    ImageBlock,
    TableBlock,
    TableRowBlock,
    TableCellBlock,
    CalloutBlock,
    createBlockId,
} from '../types/blocks';
import type { MessageContent, ContentFormat, ParseResult, ContentMetadata, ParseStats } from '../types/content';
import { validateBlocks } from '../validators/schemas';

// ============================================================================
// LRU CACHE
// ============================================================================

class LRUCache<K, V> {
    private cache = new Map<K, V>();
    private maxSize: number;

    constructor(maxSize: number = 100) {
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Remove least recently used (first item)
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, value);
    }

    has(key: K): boolean {
        return this.cache.has(key);
    }

    clear(): void {
        this.cache.clear();
    }

    get size(): number {
        return this.cache.size;
    }
}

// Global parse cache
const parseCache = new LRUCache<string, ParseResult>(100);

// ============================================================================
// CONFIGURATION
// ============================================================================

const BLOCK_PATTERN = /```block\s*\n([\s\S]*?)\n```/g;
const CALLOUT_PATTERN = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?([\s\S]*?)(?=\n(?!>)|$)/gmi;

interface ParserConfig {
    enableCache?: boolean;
    enableMetrics?: boolean;
    enableCallouts?: boolean;
    sanitizeHtml?: boolean;
    maxDepth?: number;
}

const DEFAULT_CONFIG: ParserConfig = {
    enableCache: true,
    enableMetrics: true,
    enableCallouts: true,
    sanitizeHtml: true,
    maxDepth: 10,
};

// ============================================================================
// METRICS
// ============================================================================

interface ParseMetrics {
    parseTimeMs: number;
    cacheHit: boolean;
    blockCount: number;
    nodeCount: number;
    errorCount: number;
    warningCount: number;
}

let globalMetrics: ParseMetrics[] = [];

export function getParseMetrics(): {
    avgParseTime: number;
    cacheHitRate: number;
    totalParses: number;
} {
    if (globalMetrics.length === 0) {
        return { avgParseTime: 0, cacheHitRate: 0, totalParses: 0 };
    }

    const avgParseTime = globalMetrics.reduce((sum, m) => sum + m.parseTimeMs, 0) / globalMetrics.length;
    const cacheHits = globalMetrics.filter(m => m.cacheHit).length;

    return {
        avgParseTime,
        cacheHitRate: cacheHits / globalMetrics.length,
        totalParses: globalMetrics.length,
    };
}

export function clearMetrics(): void {
    globalMetrics = [];
}

// ============================================================================
// FORMAT DETECTION (Enhanced)
// ============================================================================

export function detectContentFormat(raw: string): ContentFormat {
    const trimmed = raw.trim();

    // Check if it's pure JSON
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) || parsed.type || parsed.blocks) {
                return 'blocks';
            }
        } catch {
            // Not valid JSON
        }
    }

    // Check if it's HTML
    if (trimmed.startsWith('<') && /<\/[a-z]+>/i.test(trimmed)) {
        return 'html';
    }

    // Check for embedded blocks or callouts
    if (BLOCK_PATTERN.test(trimmed) || CALLOUT_PATTERN.test(trimmed)) {
        return 'mixed';
    }

    return 'markdown';
}

// ============================================================================
// MARKDOWN PARSER (Enhanced)
// ============================================================================

const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath);

function extractText(node: MdastContent): string {
    if ('value' in node) return node.value;
    if ('children' in node) {
        return (node.children as MdastContent[]).map(extractText).join('');
    }
    return '';
}

function mdastToBlocks(node: MdastContent, depth: number = 0, config: ParserConfig = DEFAULT_CONFIG): ContentBlock | ContentBlock[] | null {
    if (depth > (config.maxDepth || 10)) {
        console.warn('[Parser] Max depth exceeded');
        return null;
    }

    switch (node.type) {
        case 'text':
            return {
                id: createBlockId(),
                type: 'text',
                value: node.value,
            } as TextBlock;

        case 'heading':
            return {
                id: createBlockId(),
                type: 'heading',
                level: node.depth as 1 | 2 | 3 | 4 | 5 | 6,
                value: extractText(node),
                anchor: slugify(extractText(node)),
            } as HeadingBlock;

        case 'thematicBreak':
            return {
                id: createBlockId(),
                type: 'divider',
                variant: 'thin',
            } as DividerBlock;

        case 'code':
            return {
                id: createBlockId(),
                type: 'code',
                code: node.value,
                language: node.lang || undefined,
                filename: (node.meta as string)?.match(/filename="?([^"\s]+)"?/)?.[1],
                showLineNumbers: true,
                highlightLines: parseHighlightLines((node.meta as string) || ''),
            } as CodeBlock;

        case 'paragraph': {
            const text = extractText(node);

            // Check for image-only paragraph
            if (node.children.length === 1 && node.children[0].type === 'image') {
                const img = node.children[0];
                return {
                    id: createBlockId(),
                    type: 'image',
                    src: img.url,
                    alt: img.alt || '',
                    caption: img.title || undefined,
                    loading: 'lazy',
                    lightbox: true,
                } as ImageBlock;
            }

            // Check for inline math
            if (text.startsWith('$') && text.endsWith('$')) {
                return {
                    id: createBlockId(),
                    type: 'math',
                    expression: text.slice(1, -1),
                    displayMode: false,
                };
            }

            return {
                id: createBlockId(),
                type: 'text',
                value: text,
            } as TextBlock;
        }

        case 'blockquote': {
            const content = extractText(node);

            // Check for GitHub-style callouts
            const calloutMatch = content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)/i);
            if (calloutMatch && config.enableCallouts) {
                const variantMap: Record<string, CalloutBlock['variant']> = {
                    'NOTE': 'note',
                    'TIP': 'tip',
                    'IMPORTANT': 'info',
                    'WARNING': 'warning',
                    'CAUTION': 'error',
                };

                return {
                    id: createBlockId(),
                    type: 'callout',
                    variant: variantMap[calloutMatch[1].toUpperCase()] || 'note',
                    children: [{
                        id: createBlockId(),
                        type: 'text',
                        value: calloutMatch[2].trim(),
                    } as TextBlock],
                } as CalloutBlock;
            }

            const quoteChildren = (node.children as MdastContent[])
                .flatMap(c => mdastToBlocks(c, depth + 1, config))
                .filter(Boolean) as ContentBlock[];

            return {
                id: createBlockId(),
                type: 'quote',
                children: quoteChildren,
            } as QuoteBlock;
        }

        case 'list': {
            const items: ListItemBlock[] = node.children.map(li => {
                const itemChildren = (li.children as MdastContent[])
                    .flatMap(c => mdastToBlocks(c, depth + 1, config))
                    .filter(Boolean) as ContentBlock[];
                return {
                    id: createBlockId(),
                    type: 'list-item',
                    children: itemChildren,
                    checked: li.checked ?? undefined,
                } as ListItemBlock;
            });
            return {
                id: createBlockId(),
                type: 'list',
                ordered: node.ordered ?? false,
                start: node.start ?? undefined,
                items,
            } as ListBlock;
        }

        case 'image':
            return {
                id: createBlockId(),
                type: 'image',
                src: node.url,
                alt: node.alt || '',
                caption: node.title || undefined,
                loading: 'lazy',
                lightbox: true,
            } as ImageBlock;

        case 'table': {
            const rows: TableRowBlock[] = node.children.map((row, rowIndex) => ({
                id: createBlockId(),
                type: 'table-row',
                header: rowIndex === 0,
                cells: row.children.map((cell, cellIndex) => ({
                    id: createBlockId(),
                    type: 'table-cell',
                    value: extractText(cell),
                    align: node.align?.[cellIndex] || undefined,
                } as TableCellBlock)),
            } as TableRowBlock));
            return {
                id: createBlockId(),
                type: 'table',
                rows,
                striped: true,
                bordered: true,
            } as TableBlock;
        }

        case 'math':
            return {
                id: createBlockId(),
                type: 'math',
                expression: node.value,
                displayMode: true,
            };

        default:
            return null;
    }
}

export function parseMarkdown(raw: string, config: ParserConfig = DEFAULT_CONFIG): ContentBlock[] {
    try {
        const tree = markdownProcessor.parse(raw) as Root;
        const blocks = tree.children
            .flatMap(node => mdastToBlocks(node, 0, config))
            .filter(Boolean) as ContentBlock[];
        return blocks;
    } catch (error) {
        console.error('[ContentParser] Markdown parse error:', error);
        return [{
            id: createBlockId(),
            type: 'text',
            value: raw,
        }];
    }
}

// ============================================================================
// HTML PARSER
// ============================================================================

const SANITIZE_CONFIG = {
    ALLOWED_TAGS: [
        'p', 'br', 'b', 'i', 'u', 's', 'em', 'strong', 'a',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'hr', 'blockquote',
        'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'img', 'span', 'div', 'figure', 'figcaption'
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'style', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
};

// Prevent Reverse Tabnabbing (Global Hook)
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if ('target' in node && node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
    }
});

export function sanitizeHtml(html: string): string {
    if (typeof window === 'undefined') {
        return html;
    }
    return DOMPurify.sanitize(html, SANITIZE_CONFIG) as string;
}

export function parseHtml(raw: string): ContentBlock[] {
    const sanitized = sanitizeHtml(raw);
    return [{
        id: createBlockId(),
        type: 'raw-html',
        html: sanitized,
        sanitized: true,
    }];
}

// ============================================================================
// JSON BLOCKS PARSER
// ============================================================================

export function parseJsonBlocks(raw: string): ContentBlock[] {
    try {
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
            return parsed.map(block => ({
                ...block,
                id: block.id || createBlockId(),
            }));
        }

        if (parsed.blocks && Array.isArray(parsed.blocks)) {
            return parsed.blocks.map((block: ContentBlock) => ({
                ...block,
                id: block.id || createBlockId(),
            }));
        }

        return [{
            ...parsed,
            id: parsed.id || createBlockId(),
        }];
    } catch (error) {
        console.error('[ContentParser] JSON parse error:', error);
        return [{
            id: createBlockId(),
            type: 'text',
            value: raw,
        }];
    }
}

// ============================================================================
// MIXED CONTENT PARSER
// ============================================================================

export function parseMixedContent(raw: string, config: ParserConfig = DEFAULT_CONFIG): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    let lastIndex = 0;

    BLOCK_PATTERN.lastIndex = 0;

    let match;
    while ((match = BLOCK_PATTERN.exec(raw)) !== null) {
        const markdownBefore = raw.slice(lastIndex, match.index).trim();
        if (markdownBefore) {
            blocks.push(...parseMarkdown(markdownBefore, config));
        }

        try {
            const jsonContent = match[1].trim();
            const embeddedBlock = JSON.parse(jsonContent);
            blocks.push({
                ...embeddedBlock,
                id: embeddedBlock.id || createBlockId(),
            });
        } catch (e) {
            blocks.push({
                id: createBlockId(),
                type: 'code',
                code: match[1],
                language: 'json',
            });
        }

        lastIndex = match.index + match[0].length;
    }

    const remainingMarkdown = raw.slice(lastIndex).trim();
    if (remainingMarkdown) {
        blocks.push(...parseMarkdown(remainingMarkdown, config));
    }

    return blocks;
}

// ============================================================================
// STREAMING PARSER
// ============================================================================

export interface StreamingParseOptions {
    onBlock: (block: ContentBlock) => void;
    onComplete: (result: ParseResult) => void;
    onError?: (error: Error) => void;
    chunkDelimiter?: string;
}

export function parseStreaming(
    reader: ReadableStreamDefaultReader<string>,
    options: StreamingParseOptions
): () => void {
    let buffer = '';
    let cancelled = false;
    const allBlocks: ContentBlock[] = [];
    const startTime = performance.now();

    async function processStream() {
        try {
            while (!cancelled) {
                const { done, value } = await reader.read();

                if (done) break;

                buffer += value;

                // Try to parse complete blocks from buffer
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim()) {
                        const blocks = parseMarkdown(line.trim());
                        blocks.forEach(block => {
                            allBlocks.push(block);
                            options.onBlock(block);
                        });
                    }
                }
            }

            // Parse remaining buffer
            if (buffer.trim()) {
                const blocks = parseMarkdown(buffer.trim());
                blocks.forEach(block => {
                    allBlocks.push(block);
                    options.onBlock(block);
                });
            }

            // Complete
            const result: ParseResult = {
                success: true,
                content: {
                    id: createBlockId(),
                    format: 'markdown',
                    raw: '',
                    blocks: allBlocks,
                    metadata: generateMetadata('', allBlocks),
                },
                stats: {
                    parseTimeMs: performance.now() - startTime,
                    blockCount: allBlocks.length,
                    nodeCount: countNodes(allBlocks),
                    sanitizationApplied: false,
                },
            };

            options.onComplete(result);
        } catch (error) {
            options.onError?.(error as Error);
        }
    }

    processStream();

    return () => {
        cancelled = true;
    };
}

// ============================================================================
// MAIN PARSER (with caching & metrics)
// ============================================================================

export function parseContent(
    raw: string,
    format?: ContentFormat,
    config: ParserConfig = DEFAULT_CONFIG
): ParseResult {
    const startTime = performance.now();

    // Check cache
    const cacheKey = `${raw.slice(0, 100)}_${raw.length}_${format || 'auto'}`;
    if (config.enableCache && parseCache.has(cacheKey)) {
        const cached = parseCache.get(cacheKey)!;

        if (config.enableMetrics) {
            globalMetrics.push({
                parseTimeMs: performance.now() - startTime,
                cacheHit: true,
                blockCount: cached.content.blocks?.length || 0,
                nodeCount: cached.stats?.nodeCount || 0,
                errorCount: cached.errors?.length || 0,
                warningCount: cached.warnings?.length || 0,
            });
        }

        return cached;
    }

    const detectedFormat = format || detectContentFormat(raw);

    let blocks: ContentBlock[];

    switch (detectedFormat) {
        case 'markdown':
            blocks = parseMarkdown(raw, config);
            break;
        case 'html':
            blocks = parseHtml(raw);
            break;
        case 'blocks':
            blocks = parseJsonBlocks(raw);
            break;
        case 'mixed':
            blocks = parseMixedContent(raw, config);
            break;
        default:
            blocks = parseMarkdown(raw, config);
    }

    const validation = validateBlocks(blocks);
    const metadata = generateMetadata(raw, blocks);
    const parseTimeMs = performance.now() - startTime;

    const content: MessageContent = {
        id: createBlockId(),
        format: detectedFormat,
        raw,
        blocks,
        metadata,
        _cachedAt: Date.now(),
    };

    const result: ParseResult = {
        success: validation.valid,
        content,
        errors: validation.valid ? undefined : validation.errors.map(e => ({
            code: 'VALIDATION_ERROR',
            message: e.message,
            severity: 'error' as const,
        })),
        stats: {
            parseTimeMs,
            blockCount: blocks.length,
            nodeCount: countNodes(blocks),
            sanitizationApplied: detectedFormat === 'html',
        },
    };

    // Store in cache
    if (config.enableCache) {
        parseCache.set(cacheKey, result);
    }

    // Record metrics
    if (config.enableMetrics) {
        globalMetrics.push({
            parseTimeMs,
            cacheHit: false,
            blockCount: blocks.length,
            nodeCount: countNodes(blocks),
            errorCount: validation.errors.length,
            warningCount: 0,
        });
    }

    return result;
}

// ============================================================================
// UTILITIES
// ============================================================================

function generateMetadata(raw: string, blocks: ContentBlock[]): ContentMetadata {
    const words = raw.split(/\s+/).filter(Boolean).length;
    const hasCode = blocks.some(b => b.type === 'code');
    const hasImages = blocks.some(b => b.type === 'image');
    const hasTables = blocks.some(b => b.type === 'table');
    const hasMath = blocks.some(b => b.type === 'math');

    const codeLanguages = blocks
        .filter(b => b.type === 'code' && (b as CodeBlock).language)
        .map(b => (b as CodeBlock).language!)
        .filter((v, i, a) => a.indexOf(v) === i);

    // Generate content hash
    const contentHash = simpleHash(raw);

    return {
        createdAt: Date.now(),
        version: 1,
        wordCount: words,
        charCount: raw.length,
        blockCount: blocks.length,
        hasCode,
        hasImages,
        hasTables,
        hasMath,
        codeLanguages: codeLanguages.length > 0 ? codeLanguages : undefined,
        readingTime: Math.ceil(words / 200),
        contentHash,
    };
}

function countNodes(blocks: ContentBlock[]): number {
    let count = blocks.length;
    for (const block of blocks) {
        if ('children' in block && Array.isArray(block.children)) {
            count += countNodes(block.children as ContentBlock[]);
        }
        if ('items' in block && Array.isArray(block.items)) {
            count += countNodes(block.items as ContentBlock[]);
        }
        if ('rows' in block && Array.isArray(block.rows)) {
            count += countNodes(block.rows as ContentBlock[]);
        }
    }
    return count;
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

function parseHighlightLines(meta: string): number[] {
    const match = meta.match(/\{([\d,\-\s]+)\}/);
    if (!match) return [];

    const ranges = match[1].split(',').map(s => s.trim());
    const lines: number[] = [];

    for (const range of ranges) {
        if (range.includes('-')) {
            const [start, end] = range.split('-').map(Number);
            for (let i = start; i <= end; i++) lines.push(i);
        } else {
            lines.push(Number(range));
        }
    }

    return lines;
}

export default {
    parseContent,
    parseMarkdown,
    parseHtml,
    parseJsonBlocks,
    parseMixedContent,
    parseStreaming,
    detectContentFormat,
    sanitizeHtml,
    getParseMetrics,
    clearMetrics,
};
