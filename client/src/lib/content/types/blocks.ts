/**
 * Content Block Type Definitions
 * 
 * Enterprise-grade block types for structured content rendering.
 * Supports 15+ block types for rich message formatting.
 */

// ============================================================================
// BASE TYPES
// ============================================================================

export type BlockType =
    | 'text'
    | 'heading'
    | 'paragraph'
    | 'divider'
    | 'code'
    | 'list'
    | 'list-item'
    | 'quote'
    | 'image'
    | 'table'
    | 'table-row'
    | 'table-cell'
    | 'card'
    | 'callout'
    | 'button'
    | 'file'
    | 'chart'
    | 'embed'
    | 'link-preview'
    | 'math'
    | 'checkbox'
    | 'collapse'
    | 'tabs'
    | 'tab'
    | 'grid'
    | 'spacer'
    | 'raw-html';

export type BlockSource = 'user' | 'assistant' | 'system' | 'tool';

// ============================================================================
// BASE BLOCK INTERFACE
// ============================================================================

export interface BaseBlock {
    id: string;
    type: BlockType;
    source?: BlockSource;
    metadata?: BlockMetadata;
}

export interface BlockMetadata {
    createdAt?: number;
    updatedAt?: number;
    version?: number;
    annotations?: string[];
    interactive?: boolean;
    editable?: boolean;
}

// ============================================================================
// TEXT BLOCKS
// ============================================================================

export interface TextBlock extends BaseBlock {
    type: 'text';
    value: string;
    format?: TextFormat;
}

export interface TextFormat {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    code?: boolean;
    highlight?: string; // color
    link?: string;
}

export interface ParagraphBlock extends BaseBlock {
    type: 'paragraph';
    children: InlineContent[];
    align?: 'left' | 'center' | 'right' | 'justify';
}

export type InlineContent = TextBlock | LinkInline | MentionInline | EmojiInline;

export interface LinkInline {
    type: 'link';
    href: string;
    text: string;
    title?: string;
    target?: '_blank' | '_self';
}

export interface MentionInline {
    type: 'mention';
    userId: string;
    displayName: string;
}

export interface EmojiInline {
    type: 'emoji';
    emoji: string;
    shortcode?: string;
}

// ============================================================================
// HEADING BLOCK
// ============================================================================

export interface HeadingBlock extends BaseBlock {
    type: 'heading';
    level: 1 | 2 | 3 | 4 | 5 | 6;
    value: string;
    anchor?: string; // for linking
}

// ============================================================================
// DIVIDER BLOCK
// ============================================================================

export interface DividerBlock extends BaseBlock {
    type: 'divider';
    variant?: 'thin' | 'thick' | 'dashed' | 'dotted';
    spacing?: 'sm' | 'md' | 'lg';
}

// ============================================================================
// CODE BLOCK
// ============================================================================

export interface CodeBlock extends BaseBlock {
    type: 'code';
    code: string;
    language?: string;
    filename?: string;
    showLineNumbers?: boolean;
    highlightLines?: number[];
    executable?: boolean;
    collapsed?: boolean;
}

// ============================================================================
// LIST BLOCKS
// ============================================================================

export interface ListBlock extends BaseBlock {
    type: 'list';
    ordered: boolean;
    start?: number;
    items: ListItemBlock[];
}

export interface ListItemBlock extends BaseBlock {
    type: 'list-item';
    children: ContentBlock[];
    checked?: boolean; // for task lists
}

// ============================================================================
// QUOTE BLOCK
// ============================================================================

export interface QuoteBlock extends BaseBlock {
    type: 'quote';
    children: ContentBlock[];
    author?: string;
    citation?: string;
}

// ============================================================================
// IMAGE BLOCK
// ============================================================================

export interface ImageBlock extends BaseBlock {
    type: 'image';
    src: string;
    alt: string;
    caption?: string;
    width?: number;
    height?: number;
    loading?: 'lazy' | 'eager';
    lightbox?: boolean;
}

// ============================================================================
// TABLE BLOCKS
// ============================================================================

export interface TableBlock extends BaseBlock {
    type: 'table';
    headers?: string[];
    rows: TableRowBlock[];
    caption?: string;
    striped?: boolean;
    bordered?: boolean;
}

export interface TableRowBlock extends BaseBlock {
    type: 'table-row';
    cells: TableCellBlock[];
    header?: boolean;
}

export interface TableCellBlock extends BaseBlock {
    type: 'table-cell';
    value: string | ContentBlock[];
    colspan?: number;
    rowspan?: number;
    align?: 'left' | 'center' | 'right';
}

// ============================================================================
// CARD BLOCK
// ============================================================================

export interface CardBlock extends BaseBlock {
    type: 'card';
    title?: string;
    subtitle?: string;
    description?: string;
    image?: string;
    actions?: CardAction[];
    variant?: 'default' | 'elevated' | 'outlined';
}

export interface CardAction {
    label: string;
    action: string;
    variant?: 'primary' | 'secondary' | 'ghost';
    icon?: string;
}

// ============================================================================
// CALLOUT BLOCK
// ============================================================================

export interface CalloutBlock extends BaseBlock {
    type: 'callout';
    variant: 'info' | 'warning' | 'error' | 'success' | 'tip' | 'note';
    title?: string;
    children: ContentBlock[];
    icon?: string;
    collapsible?: boolean;
}

// ============================================================================
// BUTTON BLOCK
// ============================================================================

export interface ButtonBlock extends BaseBlock {
    type: 'button';
    label: string;
    action: string;
    actionType: 'link' | 'callback' | 'copy' | 'download';
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
    size?: 'sm' | 'md' | 'lg';
    icon?: string;
    iconPosition?: 'left' | 'right';
    disabled?: boolean;
    loading?: boolean;
}

// ============================================================================
// FILE BLOCK
// ============================================================================

export interface FileBlock extends BaseBlock {
    type: 'file';
    name: string;
    url: string;
    size?: number;
    mimeType?: string;
    icon?: string;
    preview?: string;
    downloadable?: boolean;
}

// ============================================================================
// CHART BLOCK
// ============================================================================

export interface ChartBlock extends BaseBlock {
    type: 'chart';
    chartType: 'line' | 'bar' | 'pie' | 'doughnut' | 'area' | 'scatter';
    data: ChartData;
    options?: ChartOptions;
    title?: string;
    height?: number;
}

export interface ChartData {
    labels: string[];
    datasets: ChartDataset[];
}

export interface ChartDataset {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string;
}

export interface ChartOptions {
    responsive?: boolean;
    legend?: boolean;
    animation?: boolean;
}

// ============================================================================
// EMBED BLOCK
// ============================================================================

export interface EmbedBlock extends BaseBlock {
    type: 'embed';
    provider: 'youtube' | 'vimeo' | 'twitter' | 'spotify' | 'figma' | 'codepen' | 'custom';
    url: string;
    embedUrl?: string;
    width?: number;
    height?: number;
    aspectRatio?: string;
}

// ============================================================================
// LINK PREVIEW BLOCK
// ============================================================================

export interface LinkPreviewBlock extends BaseBlock {
    type: 'link-preview';
    url: string;
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
    favicon?: string;
}

// ============================================================================
// MATH BLOCK
// ============================================================================

export interface MathBlock extends BaseBlock {
    type: 'math';
    expression: string;
    displayMode?: boolean; // block vs inline
}

// ============================================================================
// CHECKBOX BLOCK
// ============================================================================

export interface CheckboxBlock extends BaseBlock {
    type: 'checkbox';
    label: string;
    checked: boolean;
    disabled?: boolean;
}

// ============================================================================
// COLLAPSE BLOCK
// ============================================================================

export interface CollapseBlock extends BaseBlock {
    type: 'collapse';
    title: string;
    children: ContentBlock[];
    defaultOpen?: boolean;
}

// ============================================================================
// TABS BLOCK
// ============================================================================

export interface TabsBlock extends BaseBlock {
    type: 'tabs';
    tabs: TabBlock[];
    defaultTab?: string;
}

export interface TabBlock extends BaseBlock {
    type: 'tab';
    label: string;
    value: string;
    children: ContentBlock[];
    icon?: string;
}

// ============================================================================
// GRID BLOCK
// ============================================================================

export interface GridBlock extends BaseBlock {
    type: 'grid';
    columns: number;
    gap?: number;
    children: ContentBlock[];
}

// ============================================================================
// SPACER BLOCK
// ============================================================================

export interface SpacerBlock extends BaseBlock {
    type: 'spacer';
    height: number;
}

// ============================================================================
// RAW HTML BLOCK
// ============================================================================

export interface RawHtmlBlock extends BaseBlock {
    type: 'raw-html';
    html: string;
    sanitized?: boolean;
}

// ============================================================================
// UNION TYPE
// ============================================================================

export type ContentBlock =
    | TextBlock
    | ParagraphBlock
    | HeadingBlock
    | DividerBlock
    | CodeBlock
    | ListBlock
    | ListItemBlock
    | QuoteBlock
    | ImageBlock
    | TableBlock
    | TableRowBlock
    | TableCellBlock
    | CardBlock
    | CalloutBlock
    | ButtonBlock
    | FileBlock
    | ChartBlock
    | EmbedBlock
    | LinkPreviewBlock
    | MathBlock
    | CheckboxBlock
    | CollapseBlock
    | TabsBlock
    | TabBlock
    | GridBlock
    | SpacerBlock
    | RawHtmlBlock;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function createBlockId(): string {
    return `blk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createTextBlock(value: string, format?: TextFormat): TextBlock {
    return {
        id: createBlockId(),
        type: 'text',
        value,
        format
    };
}

export function createDividerBlock(variant: DividerBlock['variant'] = 'thin'): DividerBlock {
    return {
        id: createBlockId(),
        type: 'divider',
        variant
    };
}

export function createHeadingBlock(level: HeadingBlock['level'], value: string): HeadingBlock {
    return {
        id: createBlockId(),
        type: 'heading',
        level,
        value
    };
}

export function createCodeBlock(code: string, language?: string): CodeBlock {
    return {
        id: createBlockId(),
        type: 'code',
        code,
        language,
        showLineNumbers: true
    };
}

export function createCalloutBlock(
    variant: CalloutBlock['variant'],
    children: ContentBlock[],
    title?: string
): CalloutBlock {
    return {
        id: createBlockId(),
        type: 'callout',
        variant,
        title,
        children
    };
}
