/**
 * Zod Schemas for Content Block Validation
 * 
 * Enterprise-grade validation for all content block types.
 * Ensures type safety and data integrity at runtime.
 */

import { z } from 'zod';

// ============================================================================
// BASE SCHEMAS
// ============================================================================

export const BlockTypeSchema = z.enum([
    'text', 'heading', 'paragraph', 'divider', 'code', 'list', 'list-item',
    'quote', 'image', 'table', 'table-row', 'table-cell', 'card', 'callout',
    'button', 'file', 'chart', 'embed', 'link-preview', 'math', 'checkbox',
    'collapse', 'tabs', 'tab', 'grid', 'spacer', 'raw-html'
]);

export const BlockSourceSchema = z.enum(['user', 'assistant', 'system', 'tool']);

export const BlockMetadataSchema = z.object({
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    version: z.number().optional(),
    annotations: z.array(z.string()).optional(),
    interactive: z.boolean().optional(),
    editable: z.boolean().optional(),
}).optional();

export const BaseBlockSchema = z.object({
    id: z.string(),
    type: BlockTypeSchema,
    source: BlockSourceSchema.optional(),
    metadata: BlockMetadataSchema,
});

// ============================================================================
// TEXT SCHEMAS
// ============================================================================

export const TextFormatSchema = z.object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    code: z.boolean().optional(),
    highlight: z.string().optional(),
    link: z.string().url().optional(),
}).optional();

export const TextBlockSchema = BaseBlockSchema.extend({
    type: z.literal('text'),
    value: z.string(),
    format: TextFormatSchema,
});

// ============================================================================
// HEADING SCHEMA
// ============================================================================

export const HeadingBlockSchema = BaseBlockSchema.extend({
    type: z.literal('heading'),
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    value: z.string(),
    anchor: z.string().optional(),
});

// ============================================================================
// DIVIDER SCHEMA
// ============================================================================

export const DividerBlockSchema = BaseBlockSchema.extend({
    type: z.literal('divider'),
    variant: z.enum(['thin', 'thick', 'dashed', 'dotted']).optional(),
    spacing: z.enum(['sm', 'md', 'lg']).optional(),
});

// ============================================================================
// CODE SCHEMA
// ============================================================================

export const CodeBlockSchema = BaseBlockSchema.extend({
    type: z.literal('code'),
    code: z.string(),
    language: z.string().optional(),
    filename: z.string().optional(),
    showLineNumbers: z.boolean().optional(),
    highlightLines: z.array(z.number()).optional(),
    executable: z.boolean().optional(),
    collapsed: z.boolean().optional(),
});

// ============================================================================
// LIST SCHEMAS
// ============================================================================

export const ListItemBlockSchema = BaseBlockSchema.extend({
    type: z.literal('list-item'),
    children: z.lazy(() => z.array(ContentBlockSchema)),
    checked: z.boolean().optional(),
});

export const ListBlockSchema = BaseBlockSchema.extend({
    type: z.literal('list'),
    ordered: z.boolean(),
    start: z.number().optional(),
    items: z.array(ListItemBlockSchema),
});

// ============================================================================
// QUOTE SCHEMA
// ============================================================================

export const QuoteBlockSchema = BaseBlockSchema.extend({
    type: z.literal('quote'),
    children: z.lazy(() => z.array(ContentBlockSchema)),
    author: z.string().optional(),
    citation: z.string().optional(),
});

// ============================================================================
// IMAGE SCHEMA
// ============================================================================

export const ImageBlockSchema = BaseBlockSchema.extend({
    type: z.literal('image'),
    src: z.string().url(),
    alt: z.string(),
    caption: z.string().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    loading: z.enum(['lazy', 'eager']).optional(),
    lightbox: z.boolean().optional(),
});

// ============================================================================
// TABLE SCHEMAS
// ============================================================================

export const TableCellBlockSchema = BaseBlockSchema.extend({
    type: z.literal('table-cell'),
    value: z.union([z.string(), z.lazy(() => z.array(ContentBlockSchema))]),
    colspan: z.number().positive().optional(),
    rowspan: z.number().positive().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
});

export const TableRowBlockSchema = BaseBlockSchema.extend({
    type: z.literal('table-row'),
    cells: z.array(TableCellBlockSchema),
    header: z.boolean().optional(),
});

export const TableBlockSchema = BaseBlockSchema.extend({
    type: z.literal('table'),
    headers: z.array(z.string()).optional(),
    rows: z.array(TableRowBlockSchema),
    caption: z.string().optional(),
    striped: z.boolean().optional(),
    bordered: z.boolean().optional(),
});

// ============================================================================
// CARD SCHEMA
// ============================================================================

export const CardActionSchema = z.object({
    label: z.string(),
    action: z.string(),
    variant: z.enum(['primary', 'secondary', 'ghost']).optional(),
    icon: z.string().optional(),
});

export const CardBlockSchema = BaseBlockSchema.extend({
    type: z.literal('card'),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    image: z.string().url().optional(),
    actions: z.array(CardActionSchema).optional(),
    variant: z.enum(['default', 'elevated', 'outlined']).optional(),
});

// ============================================================================
// CALLOUT SCHEMA
// ============================================================================

export const CalloutBlockSchema = BaseBlockSchema.extend({
    type: z.literal('callout'),
    variant: z.enum(['info', 'warning', 'error', 'success', 'tip', 'note']),
    title: z.string().optional(),
    children: z.lazy(() => z.array(ContentBlockSchema)),
    icon: z.string().optional(),
    collapsible: z.boolean().optional(),
});

// ============================================================================
// BUTTON SCHEMA
// ============================================================================

export const ButtonBlockSchema = BaseBlockSchema.extend({
    type: z.literal('button'),
    label: z.string(),
    action: z.string(),
    actionType: z.enum(['link', 'callback', 'copy', 'download']),
    variant: z.enum(['primary', 'secondary', 'outline', 'ghost', 'destructive']).optional(),
    size: z.enum(['sm', 'md', 'lg']).optional(),
    icon: z.string().optional(),
    iconPosition: z.enum(['left', 'right']).optional(),
    disabled: z.boolean().optional(),
    loading: z.boolean().optional(),
});

// ============================================================================
// FILE SCHEMA
// ============================================================================

export const FileBlockSchema = BaseBlockSchema.extend({
    type: z.literal('file'),
    name: z.string(),
    url: z.string().url(),
    size: z.number().positive().optional(),
    mimeType: z.string().optional(),
    icon: z.string().optional(),
    preview: z.string().url().optional(),
    downloadable: z.boolean().optional(),
});

// ============================================================================
// CHART SCHEMA
// ============================================================================

export const ChartDatasetSchema = z.object({
    label: z.string(),
    data: z.array(z.number()),
    backgroundColor: z.union([z.string(), z.array(z.string())]).optional(),
    borderColor: z.string().optional(),
});

export const ChartDataSchema = z.object({
    labels: z.array(z.string()),
    datasets: z.array(ChartDatasetSchema),
});

export const ChartBlockSchema = BaseBlockSchema.extend({
    type: z.literal('chart'),
    chartType: z.enum(['line', 'bar', 'pie', 'doughnut', 'area', 'scatter']),
    data: ChartDataSchema,
    title: z.string().optional(),
    height: z.number().positive().optional(),
});

// ============================================================================
// EMBED SCHEMA
// ============================================================================

export const EmbedBlockSchema = BaseBlockSchema.extend({
    type: z.literal('embed'),
    provider: z.enum(['youtube', 'vimeo', 'twitter', 'spotify', 'figma', 'codepen', 'custom']),
    url: z.string().url(),
    embedUrl: z.string().url().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    aspectRatio: z.string().optional(),
});

// ============================================================================
// LINK PREVIEW SCHEMA
// ============================================================================

export const LinkPreviewBlockSchema = BaseBlockSchema.extend({
    type: z.literal('link-preview'),
    url: z.string().url(),
    title: z.string().optional(),
    description: z.string().optional(),
    image: z.string().url().optional(),
    siteName: z.string().optional(),
    favicon: z.string().url().optional(),
});

// ============================================================================
// ADDITIONAL SCHEMAS
// ============================================================================

export const MathBlockSchema = BaseBlockSchema.extend({
    type: z.literal('math'),
    expression: z.string(),
    displayMode: z.boolean().optional(),
});

export const CheckboxBlockSchema = BaseBlockSchema.extend({
    type: z.literal('checkbox'),
    label: z.string(),
    checked: z.boolean(),
    disabled: z.boolean().optional(),
});

export const CollapseBlockSchema = BaseBlockSchema.extend({
    type: z.literal('collapse'),
    title: z.string(),
    children: z.lazy(() => z.array(ContentBlockSchema)),
    defaultOpen: z.boolean().optional(),
});

export const SpacerBlockSchema = BaseBlockSchema.extend({
    type: z.literal('spacer'),
    height: z.number().positive(),
});

export const RawHtmlBlockSchema = BaseBlockSchema.extend({
    type: z.literal('raw-html'),
    html: z.string(),
    sanitized: z.boolean().optional(),
});

// ============================================================================
// UNION SCHEMA
// ============================================================================

export const ContentBlockSchema: z.ZodType<any> = z.lazy(() =>
    z.discriminatedUnion('type', [
        TextBlockSchema,
        HeadingBlockSchema,
        DividerBlockSchema,
        CodeBlockSchema,
        ListBlockSchema,
        ListItemBlockSchema,
        QuoteBlockSchema,
        ImageBlockSchema,
        TableBlockSchema,
        TableRowBlockSchema,
        TableCellBlockSchema,
        CardBlockSchema,
        CalloutBlockSchema,
        ButtonBlockSchema,
        FileBlockSchema,
        ChartBlockSchema,
        EmbedBlockSchema,
        LinkPreviewBlockSchema,
        MathBlockSchema,
        CheckboxBlockSchema,
        CollapseBlockSchema,
        SpacerBlockSchema,
        RawHtmlBlockSchema,
    ])
);

// ============================================================================
// MESSAGE CONTENT SCHEMA
// ============================================================================

export const ContentFormatSchema = z.enum(['markdown', 'html', 'blocks', 'mixed']);

export const ContentMetadataSchema = z.object({
    createdAt: z.number(),
    updatedAt: z.number().optional(),
    version: z.number(),
    wordCount: z.number().optional(),
    charCount: z.number().optional(),
    blockCount: z.number().optional(),
    hasCode: z.boolean().optional(),
    hasImages: z.boolean().optional(),
    hasTables: z.boolean().optional(),
    hasMath: z.boolean().optional(),
    codeLanguages: z.array(z.string()).optional(),
    readingTime: z.number().optional(),
    contentHash: z.string().optional(),
});

export const MessageContentSchema = z.object({
    id: z.string(),
    format: ContentFormatSchema,
    raw: z.string(),
    blocks: z.array(ContentBlockSchema).optional(),
    metadata: ContentMetadataSchema.optional(),
    source: BlockSourceSchema.optional(),
});

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

export function validateBlock(block: unknown): { valid: boolean; errors?: z.ZodError } {
    const result = ContentBlockSchema.safeParse(block);
    return result.success
        ? { valid: true }
        : { valid: false, errors: result.error };
}

export function validateMessageContent(content: unknown): { valid: boolean; errors?: z.ZodError } {
    const result = MessageContentSchema.safeParse(content);
    return result.success
        ? { valid: true }
        : { valid: false, errors: result.error };
}

export function validateBlocks(blocks: unknown[]): { valid: boolean; invalidIndices: number[]; errors: z.ZodError[] } {
    const invalidIndices: number[] = [];
    const errors: z.ZodError[] = [];

    blocks.forEach((block, index) => {
        const result = ContentBlockSchema.safeParse(block);
        if (!result.success) {
            invalidIndices.push(index);
            errors.push(result.error);
        }
    });

    return { valid: invalidIndices.length === 0, invalidIndices, errors };
}
