import { z } from "zod";

export const TextStyleSchema = z.object({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  code: z.boolean().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  link: z.string().optional(),
  superscript: z.boolean().optional(),
  subscript: z.boolean().optional(),
});

export type TextStyle = z.infer<typeof TextStyleSchema>;

export const TextRunSchema = z.object({
  text: z.string(),
  style: TextStyleSchema.optional(),
});

export type TextRun = z.infer<typeof TextRunSchema>;

export const ListItemSchema: z.ZodType<ListItem> = z.lazy(() =>
  z.object({
    runs: z.array(TextRunSchema),
    children: z.array(ListItemSchema).optional(),
  })
);

export interface ListItem {
  runs: TextRun[];
  children?: ListItem[];
}

export const BlockTypeSchema = z.enum([
  "heading",
  "paragraph",
  "bullet-list",
  "ordered-list",
  "blockquote",
  "code-block",
  "horizontal-rule",
  "table",
  "image",
]);

export type BlockType = z.infer<typeof BlockTypeSchema>;

export const HeadingBlockSchema = z.object({
  type: z.literal("heading"),
  level: z.number().min(1).max(6),
  runs: z.array(TextRunSchema),
  alignment: z.enum(["left", "center", "right", "justify"]).optional(),
});

export type HeadingBlock = z.infer<typeof HeadingBlockSchema>;

export const ParagraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  runs: z.array(TextRunSchema),
  alignment: z.enum(["left", "center", "right", "justify"]).optional(),
  indent: z.number().optional(),
});

export type ParagraphBlock = z.infer<typeof ParagraphBlockSchema>;

export const BulletListBlockSchema = z.object({
  type: z.literal("bullet-list"),
  items: z.array(ListItemSchema),
  indent: z.number().optional(),
});

export type BulletListBlock = z.infer<typeof BulletListBlockSchema>;

export const OrderedListBlockSchema = z.object({
  type: z.literal("ordered-list"),
  items: z.array(ListItemSchema),
  start: z.number().optional(),
  indent: z.number().optional(),
});

export type OrderedListBlock = z.infer<typeof OrderedListBlockSchema>;

export const BlockquoteBlockSchema = z.object({
  type: z.literal("blockquote"),
  runs: z.array(TextRunSchema),
});

export type BlockquoteBlock = z.infer<typeof BlockquoteBlockSchema>;

export const CodeBlockSchema = z.object({
  type: z.literal("code-block"),
  code: z.string(),
  language: z.string().optional(),
});

export type CodeBlock = z.infer<typeof CodeBlockSchema>;

export const HorizontalRuleBlockSchema = z.object({
  type: z.literal("horizontal-rule"),
});

export type HorizontalRuleBlock = z.infer<typeof HorizontalRuleBlockSchema>;

export const TableCellSchema = z.object({
  runs: z.array(TextRunSchema),
  colSpan: z.number().optional(),
  rowSpan: z.number().optional(),
  isHeader: z.boolean().optional(),
});

export type TableCell = z.infer<typeof TableCellSchema>;

export const TableRowSchema = z.object({
  cells: z.array(TableCellSchema),
});

export type TableRow = z.infer<typeof TableRowSchema>;

export const TableBlockSchema = z.object({
  type: z.literal("table"),
  rows: z.array(TableRowSchema),
  hasHeader: z.boolean().optional(),
});

export type TableBlock = z.infer<typeof TableBlockSchema>;

export const ImageBlockSchema = z.object({
  type: z.literal("image"),
  src: z.string(),
  alt: z.string().optional(),
  title: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export type ImageBlock = z.infer<typeof ImageBlockSchema>;

export const RichTextBlockSchema = z.discriminatedUnion("type", [
  HeadingBlockSchema,
  ParagraphBlockSchema,
  BulletListBlockSchema,
  OrderedListBlockSchema,
  BlockquoteBlockSchema,
  CodeBlockSchema,
  HorizontalRuleBlockSchema,
  TableBlockSchema,
  ImageBlockSchema,
]);

export type RichTextBlock = z.infer<typeof RichTextBlockSchema>;

export const RichTextDocumentSchema = z.object({
  blocks: z.array(RichTextBlockSchema),
  metadata: z
    .object({
      title: z.string().optional(),
      author: z.string().optional(),
      createdAt: z.string().optional(),
      documentType: z
        .enum(["cv", "letter", "report", "article", "contract", "generic"])
        .optional(),
    })
    .optional(),
});

export type RichTextDocument = z.infer<typeof RichTextDocumentSchema>;

export type FontWeight = "regular" | "bold";
export type FontStyle = "normal" | "italic";

export interface FontVariant {
  weight: FontWeight;
  style: FontStyle;
}

export interface FontFamily {
  name: string;
  variants: {
    regular?: string;
    bold?: string;
    italic?: string;
    boldItalic?: string;
  };
  fallback: string[];
}

export interface FontRegistry {
  families: Record<string, FontFamily>;
  defaultFamily: string;
  monoFamily: string;
}

export function getFontVariantKey(style: TextStyle): keyof FontFamily["variants"] {
  if (style.bold && style.italic) return "boldItalic";
  if (style.bold) return "bold";
  if (style.italic) return "italic";
  return "regular";
}

export function mergeStyles(base: TextStyle, overlay: TextStyle): TextStyle {
  return {
    ...base,
    ...overlay,
    bold: overlay.bold ?? base.bold,
    italic: overlay.italic ?? base.italic,
    underline: overlay.underline ?? base.underline,
    strikethrough: overlay.strikethrough ?? base.strikethrough,
    code: overlay.code ?? base.code,
    color: overlay.color ?? base.color,
    backgroundColor: overlay.backgroundColor ?? base.backgroundColor,
    fontSize: overlay.fontSize ?? base.fontSize,
    fontFamily: overlay.fontFamily ?? base.fontFamily,
    link: overlay.link ?? base.link,
  };
}

export function normalizeRuns(runs: TextRun[]): TextRun[] {
  if (runs.length === 0) return [];

  const normalized: TextRun[] = [];
  let current: TextRun | null = null;

  for (const run of runs) {
    if (run.text.length === 0) continue;

    if (current && stylesEqual(current.style, run.style)) {
      current = { text: current.text + run.text, style: current.style };
    } else {
      if (current) normalized.push(current);
      current = { ...run };
    }
  }

  if (current) normalized.push(current);
  return normalized;
}

function stylesEqual(a?: TextStyle, b?: TextStyle): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.code === b.code &&
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor &&
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily &&
    a.link === b.link
  );
}
