/**
 * Content Type Definitions
 * 
 * Defines the main content interfaces for message rendering.
 */

import type { ContentBlock, BlockSource } from './blocks';

// ============================================================================
// CONTENT FORMAT
// ============================================================================

export type ContentFormat = 'markdown' | 'html' | 'blocks' | 'mixed';

// ============================================================================
// MESSAGE CONTENT
// ============================================================================

export interface MessageContent {
    /** Unique identifier */
    id: string;

    /** Content format type */
    format: ContentFormat;

    /** Raw content string (markdown/html) */
    raw: string;

    /** Parsed blocks (for 'blocks' or 'mixed' format) */
    blocks?: ContentBlock[];

    /** Content metadata */
    metadata?: ContentMetadata;

    /** Source of the content */
    source?: BlockSource;

    /** Cached AST for performance */
    _ast?: ParsedAST;

    /** Cache timestamp */
    _cachedAt?: number;
}

// ============================================================================
// CONTENT METADATA
// ============================================================================

export interface ContentMetadata {
    /** Creation timestamp */
    createdAt: number;

    /** Last update timestamp */
    updatedAt?: number;

    /** Content version for optimistic locking */
    version: number;

    /** Word count */
    wordCount?: number;

    /** Character count */
    charCount?: number;

    /** Block count */
    blockCount?: number;

    /** Has code blocks */
    hasCode?: boolean;

    /** Has images */
    hasImages?: boolean;

    /** Has tables */
    hasTables?: boolean;

    /** Has math expressions */
    hasMath?: boolean;

    /** Languages used in code blocks */
    codeLanguages?: string[];

    /** Estimated reading time in minutes */
    readingTime?: number;

    /** Content hash for integrity */
    contentHash?: string;
}

// ============================================================================
// PARSED AST
// ============================================================================

export interface ParsedAST {
    type: 'root';
    children: ASTNode[];
}

export interface ASTNode {
    type: string;
    value?: string;
    children?: ASTNode[];
    position?: ASTPosition;
    properties?: Record<string, unknown>;
}

export interface ASTPosition {
    start: { line: number; column: number; offset: number };
    end: { line: number; column: number; offset: number };
}

// ============================================================================
// PARSE RESULT
// ============================================================================

export interface ParseResult {
    success: boolean;
    content: MessageContent;
    errors?: ParseError[];
    warnings?: ParseWarning[];
    stats?: ParseStats;
}

export interface ParseError {
    code: string;
    message: string;
    position?: ASTPosition;
    severity: 'error' | 'critical';
}

export interface ParseWarning {
    code: string;
    message: string;
    position?: ASTPosition;
}

export interface ParseStats {
    parseTimeMs: number;
    blockCount: number;
    nodeCount: number;
    sanitizationApplied: boolean;
}

// ============================================================================
// RENDER CONTEXT
// ============================================================================

export interface RenderContext {
    /** Theme mode */
    theme: 'light' | 'dark' | 'system';

    /** Parent container width */
    containerWidth?: number;

    /** Device type */
    device: 'mobile' | 'tablet' | 'desktop';

    /** Enable interactive features */
    interactive: boolean;

    /** Enable animations */
    animations: boolean;

    /** Lazy load images */
    lazyLoadImages: boolean;

    /** Code syntax highlighting */
    syntaxHighlighting: boolean;

    /** Enable lightbox for images */
    enableLightbox: boolean;

    /** Custom class name prefix */
    classPrefix?: string;

    /** Event handlers */
    handlers?: RenderHandlers;
}

export interface RenderHandlers {
    onBlockClick?: (blockId: string, block: ContentBlock) => void;
    onLinkClick?: (url: string, event: React.MouseEvent) => void;
    onImageLoad?: (blockId: string) => void;
    onCodeCopy?: (code: string) => void;
    onButtonAction?: (action: string, blockId: string) => void;
    onCheckboxChange?: (blockId: string, checked: boolean) => void;
}

// ============================================================================
// PLUGIN SYSTEM
// ============================================================================

export interface ContentPlugin {
    name: string;
    version: string;

    /** Block types this plugin handles */
    blockTypes?: string[];

    /** Custom parser */
    parser?: PluginParser;

    /** Custom renderer */
    renderer?: PluginRenderer;

    /** Lifecycle hooks */
    hooks?: PluginHooks;
}

export interface PluginParser {
    parse: (raw: string) => ContentBlock[];
    canParse: (content: string) => boolean;
}

export interface PluginRenderer {
    render: (block: ContentBlock, context: RenderContext) => React.ReactNode;
    canRender: (block: ContentBlock) => boolean;
}

export interface PluginHooks {
    beforeParse?: (raw: string) => string;
    afterParse?: (blocks: ContentBlock[]) => ContentBlock[];
    beforeRender?: (blocks: ContentBlock[]) => ContentBlock[];
    afterRender?: (element: React.ReactNode) => React.ReactNode;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type BlockRenderer<T extends ContentBlock = ContentBlock> =
    React.FC<{ block: T; context: RenderContext }>;

export type BlockRendererMap = {
    [K in ContentBlock['type']]?: BlockRenderer<Extract<ContentBlock, { type: K }>>;
};
