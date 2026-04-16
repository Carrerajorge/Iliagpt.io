import { z } from "zod";
import { SupportedLocaleSchema } from "./contracts";

export const DocumentTypeSchema = z.enum([
  "REPORT",
  "CV",
  "LETTER",
  "REQUEST",
  "MINUTES",
  "PROPOSAL",
  "MANUAL",
  "ESSAY",
  "SUMMARY"
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const ToneSchema = z.enum([
  "formal",
  "professional",
  "academic",
  "conversational",
  "technical",
  "persuasive",
  "informative"
]);
export type Tone = z.infer<typeof ToneSchema>;

export const AudienceSchema = z.enum([
  "executive",
  "technical",
  "academic",
  "operational",
  "general",
  "client",
  "internal"
]);
export type Audience = z.infer<typeof AudienceSchema>;

export const PageSizeSchema = z.enum([
  "A4",
  "LETTER",
  "LEGAL",
  "A3",
  "A5"
]);
export type PageSize = z.infer<typeof PageSizeSchema>;

export const PageOrientationSchema = z.enum(["portrait", "landscape"]);
export type PageOrientation = z.infer<typeof PageOrientationSchema>;

export const MarginsSchema = z.object({
  top: z.number().positive().default(2.54),
  bottom: z.number().positive().default(2.54),
  left: z.number().positive().default(2.54),
  right: z.number().positive().default(2.54),
  header: z.number().nonnegative().default(1.27),
  footer: z.number().nonnegative().default(1.27),
  gutter: z.number().nonnegative().default(0)
});
export type Margins = z.infer<typeof MarginsSchema>;

export const PageSetupSchema = z.object({
  size: PageSizeSchema.default("A4"),
  orientation: PageOrientationSchema.default("portrait"),
  margins: MarginsSchema.optional(),
  columns: z.number().int().min(1).max(3).default(1),
  columnSpacing: z.number().positive().default(1.27)
});
export type PageSetup = z.infer<typeof PageSetupSchema>;

export const FontSpecSchema = z.object({
  family: z.string(),
  size: z.number().positive(),
  weight: z.enum(["normal", "bold", "light"]).default("normal"),
  style: z.enum(["normal", "italic"]).default("normal"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
});
export type FontSpec = z.infer<typeof FontSpecSchema>;

export const TypographySchema = z.object({
  heading1: FontSpecSchema,
  heading2: FontSpecSchema,
  heading3: FontSpecSchema,
  heading4: FontSpecSchema,
  body: FontSpecSchema,
  caption: FontSpecSchema,
  quote: FontSpecSchema,
  code: FontSpecSchema,
  tableHeader: FontSpecSchema,
  tableBody: FontSpecSchema,
  footnote: FontSpecSchema,
  toc: FontSpecSchema,
  header: FontSpecSchema,
  footer: FontSpecSchema
});
export type Typography = z.infer<typeof TypographySchema>;

export const ColorPaletteSchema = z.object({
  primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  background: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  text: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  textMuted: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  border: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  tableHeaderBg: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  tableRowAltBg: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  linkColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  successColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  warningColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  errorColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/)
});
export type ColorPalette = z.infer<typeof ColorPaletteSchema>;

export const SpacingSchema = z.object({
  paragraphSpacing: z.number().nonnegative().default(12),
  lineHeight: z.number().positive().default(1.5),
  beforeHeading: z.number().nonnegative().default(24),
  afterHeading: z.number().nonnegative().default(12),
  listIndent: z.number().nonnegative().default(18),
  tableRowHeight: z.number().positive().default(20),
  sectionBreak: z.enum(["none", "page", "column"]).default("none")
});
export type Spacing = z.infer<typeof SpacingSchema>;

export const ComponentTypeSchema = z.enum([
  "paragraph",
  "heading",
  "list",
  "numbered_list",
  "table",
  "image",
  "chart",
  "callout",
  "quote",
  "code_block",
  "signature",
  "timeline",
  "skills_bar",
  "contact_info",
  "letterhead",
  "page_break",
  "horizontal_rule",
  "toc",
  "bibliography",
  "footnote",
  "watermark",
  "header",
  "footer"
]);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;

export const DocumentComponentSchema = z.object({
  id: z.string().uuid(),
  type: ComponentTypeSchema,
  sectionId: z.string().uuid().optional(),
  order: z.number().int().nonnegative(),
  content: z.any(),
  style: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional()
});
export type DocumentComponent = z.infer<typeof DocumentComponentSchema>;

export const SectionSpecEnhancedSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  type: z.enum([
    "title_page",
    "table_of_contents",
    "executive_summary",
    "introduction",
    "methodology",
    "analysis",
    "results",
    "discussion",
    "conclusions",
    "recommendations",
    "appendix",
    "bibliography",
    "glossary",
    "contact",
    "experience",
    "education",
    "skills",
    "projects",
    "references",
    "salutation",
    "body",
    "closing",
    "signature",
    "custom"
  ]),
  level: z.number().int().min(1).max(4).default(1),
  order: z.number().int().nonnegative(),
  pageBreakBefore: z.boolean().default(false),
  columns: z.number().int().min(1).max(3).optional(),
  components: z.array(z.string().uuid()).optional()
});
export type SectionSpecEnhanced = z.infer<typeof SectionSpecEnhancedSchema>;

export const DocumentSpecSchema = z.object({
  id: z.string().uuid(),
  doc_type: DocumentTypeSchema,
  locale: SupportedLocaleSchema,
  tone: ToneSchema,
  audience: AudienceSchema,
  title: z.string(),
  subtitle: z.string().optional(),
  author: z.string().optional(),
  date: z.string().optional(),
  version: z.string().optional(),
  page_setup: PageSetupSchema,
  typography: TypographySchema.optional(),
  color_palette: ColorPaletteSchema.optional(),
  spacing: SpacingSchema.optional(),
  sections: z.array(SectionSpecEnhancedSchema),
  components: z.array(DocumentComponentSchema).optional(),
  template_id: z.string().optional(),
  theme_id: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
});
export type DocumentSpec = z.infer<typeof DocumentSpecSchema>;

export const DEFAULT_TYPOGRAPHY: Typography = {
  heading1: { family: "Calibri", size: 24, weight: "bold" },
  heading2: { family: "Calibri", size: 18, weight: "bold" },
  heading3: { family: "Calibri", size: 14, weight: "bold" },
  heading4: { family: "Calibri", size: 12, weight: "bold" },
  body: { family: "Calibri", size: 11, weight: "normal" },
  caption: { family: "Calibri", size: 9, weight: "normal", style: "italic" },
  quote: { family: "Calibri", size: 11, weight: "normal", style: "italic" },
  code: { family: "Consolas", size: 10, weight: "normal" },
  tableHeader: { family: "Calibri", size: 11, weight: "bold" },
  tableBody: { family: "Calibri", size: 10, weight: "normal" },
  footnote: { family: "Calibri", size: 9, weight: "normal" },
  toc: { family: "Calibri", size: 11, weight: "normal" },
  header: { family: "Calibri", size: 10, weight: "normal" },
  footer: { family: "Calibri", size: 10, weight: "normal" }
};

export const DEFAULT_COLOR_PALETTE: ColorPalette = {
  primary: "#1F4E79",
  secondary: "#2E75B6",
  accent: "#5B9BD5",
  background: "#FFFFFF",
  text: "#333333",
  textMuted: "#666666",
  border: "#D9D9D9",
  tableHeaderBg: "#1F4E79",
  tableRowAltBg: "#F2F2F2",
  linkColor: "#0563C1",
  successColor: "#70AD47",
  warningColor: "#FFC000",
  errorColor: "#C00000"
};

export const DEFAULT_SPACING: Spacing = {
  paragraphSpacing: 12,
  lineHeight: 1.5,
  beforeHeading: 24,
  afterHeading: 12,
  listIndent: 18,
  tableRowHeight: 20,
  sectionBreak: "none"
};

export const DEFAULT_MARGINS: Margins = {
  top: 2.54,
  bottom: 2.54,
  left: 2.54,
  right: 2.54,
  header: 1.27,
  footer: 1.27,
  gutter: 0
};

export const CV_TYPOGRAPHY: Typography = {
  ...DEFAULT_TYPOGRAPHY,
  heading1: { family: "Calibri Light", size: 28, weight: "light" },
  heading2: { family: "Calibri", size: 14, weight: "bold", color: "#1F4E79" },
  body: { family: "Calibri", size: 10, weight: "normal" }
};

export const LETTER_TYPOGRAPHY: Typography = {
  ...DEFAULT_TYPOGRAPHY,
  heading1: { family: "Times New Roman", size: 14, weight: "bold" },
  body: { family: "Times New Roman", size: 12, weight: "normal" }
};

export const DOCUMENT_TYPE_DEFAULTS: Record<DocumentType, {
  page_setup: Partial<PageSetup>;
  typography: Typography;
  color_palette: ColorPalette;
  spacing: Spacing;
  sections: string[];
}> = {
  REPORT: {
    page_setup: { size: "A4", orientation: "portrait", columns: 1 },
    typography: DEFAULT_TYPOGRAPHY,
    color_palette: DEFAULT_COLOR_PALETTE,
    spacing: DEFAULT_SPACING,
    sections: ["title_page", "table_of_contents", "executive_summary", "introduction", "methodology", "results", "analysis", "conclusions", "recommendations", "bibliography"]
  },
  CV: {
    page_setup: { size: "A4", orientation: "portrait", columns: 1, margins: { ...DEFAULT_MARGINS, left: 1.5, right: 1.5 } },
    typography: CV_TYPOGRAPHY,
    color_palette: DEFAULT_COLOR_PALETTE,
    spacing: { ...DEFAULT_SPACING, paragraphSpacing: 6, lineHeight: 1.15 },
    sections: ["contact", "executive_summary", "experience", "education", "skills", "projects", "references"]
  },
  LETTER: {
    page_setup: { size: "A4", orientation: "portrait", columns: 1 },
    typography: LETTER_TYPOGRAPHY,
    color_palette: DEFAULT_COLOR_PALETTE,
    spacing: { ...DEFAULT_SPACING, paragraphSpacing: 18 },
    sections: ["letterhead", "salutation", "body", "closing", "signature"]
  },
  REQUEST: {
    page_setup: { size: "A4", orientation: "portrait", columns: 1 },
    typography: DEFAULT_TYPOGRAPHY,
    color_palette: DEFAULT_COLOR_PALETTE,
    spacing: DEFAULT_SPACING,
    sections: ["letterhead", "salutation", "introduction", "body", "closing", "signature"]
  },
  MINUTES: {
    page_setup: { size: "A4", orientation: "portrait", columns: 1 },
    typography: DEFAULT_TYPOGRAPHY,
    color_palette: DEFAULT_COLOR_PALETTE,
    spacing: DEFAULT_SPACING,
    sections: ["title_page", "introduction", "body", "conclusions", "signature"]
  },
  PROPOSAL: {
    page_setup: { size: "A4", orientation: "portrait", columns: 1 },
    typography: DEFAULT_TYPOGRAPHY,
    color_palette: DEFAULT_COLOR_PALETTE,
    spacing: DEFAULT_SPACING,
    sections: ["title_page", "executive_summary", "introduction", "methodology", "results", "conclusions", "bibliography"]
  },
  MANUAL: {
    page_setup: { size: "A4", orientation: "portrait", columns: 1 },
    typography: DEFAULT_TYPOGRAPHY,
    color_palette: DEFAULT_COLOR_PALETTE,
    spacing: DEFAULT_SPACING,
    sections: ["title_page", "table_of_contents", "introduction", "body", "glossary", "appendix"]
  },
  ESSAY: {
    page_setup: { size: "A4", orientation: "portrait", columns: 1 },
    typography: { ...DEFAULT_TYPOGRAPHY, body: { family: "Times New Roman", size: 12, weight: "normal" } },
    color_palette: DEFAULT_COLOR_PALETTE,
    spacing: { ...DEFAULT_SPACING, lineHeight: 2.0 },
    sections: ["title_page", "introduction", "body", "conclusions", "bibliography"]
  },
  SUMMARY: {
    page_setup: { size: "A4", orientation: "portrait", columns: 1 },
    typography: DEFAULT_TYPOGRAPHY,
    color_palette: DEFAULT_COLOR_PALETTE,
    spacing: DEFAULT_SPACING,
    sections: ["executive_summary", "conclusions"]
  }
};
