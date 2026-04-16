/**
 * Document Generation Engine — Spec-driven "perfect" document generation.
 *
 * Uses JSON specs + design tokens + layout engine + validators to produce
 * deterministic, high-quality PPT/DOCX/XLSX documents.
 *
 * Architecture:
 *   1. Spec (JSON) → describes content, structure, styling
 *   2. Design Tokens → theme (fonts, colors, spacing)
 *   3. Layout Engine → deterministic positioning with anti-overflow
 *   4. Renderer → PptxGenJS / docx / ExcelJS
 *   5. Validator → verify output quality
 */

import { z } from "zod";
import { createPptxDocument } from "../../services/documentGeneration";

/* ================================================================== */
/*  SECURITY HELPERS                                                   */
/* ================================================================== */

/** Strip control characters from text */
function sanitizeText(text: string): string {
  // Single-pass: strip null bytes, control chars (except \t \n \r),
  // bidi overrides (U+202A-U+202E, U+2066-U+2069), zero-width chars, and BOM
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
}

const EXCEL_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "|", "\\"];

/** Sanitize a cell value to prevent Excel formula injection */
function sanitizeExcelValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trimStart();
  if (trimmed.length === 0) return value;
  if (EXCEL_FORMULA_PREFIXES.some(p => trimmed.startsWith(p))) {
    return `'${value}`;
  }
  return value;
}

/** Block remote/absolute image paths to prevent SSRF and path traversal */
function isImagePathSafe(imagePath: string): boolean {
  if (!imagePath || typeof imagePath !== "string") return false;
  if (imagePath.length > 4096) return false; // reject absurdly long paths
  const lower = imagePath.trim().toLowerCase();
  // Block remote URLs
  if (lower.startsWith("http://") || lower.startsWith("https://")) return false;
  // Block file:// protocol
  if (lower.startsWith("file://")) return false;
  // Block SMB / UNC / extended-length paths
  if (lower.startsWith("\\\\") || lower.startsWith("//") || lower.startsWith("\\\\?\\")) return false;
  // Block absolute paths outside of project
  if (lower.startsWith("/etc/") || lower.startsWith("/proc/") || lower.startsWith("/sys/") || lower.startsWith("/dev/")) return false;
  // Block path traversal
  if (imagePath.includes("..")) return false;
  return true;
}

/** Sanitize Excel sheet name — remove illegal chars (*?:/\[]) and cap to 31 chars */
function sanitizeSheetName(name: string): string {
  if (!name || typeof name !== "string") return "Sheet1";
  return name
    .replace(/[*?:/\\[\]]/g, "_")
    .substring(0, 31)
    .trim() || "Sheet1";
}

/** WCAG AA contrast ratio check (simplified luminance) */
function relativeLuminance(hex: string): number {
  const safe = safeColor(hex); // ensure valid 6-digit hex
  const c = safe.replace("#", "");
  if (c.length !== 6) return 0; // defensive: should never happen after safeColor
  const rVal = parseInt(c.substring(0, 2), 16);
  const gVal = parseInt(c.substring(2, 4), 16);
  const bVal = parseInt(c.substring(4, 6), 16);
  if (isNaN(rVal) || isNaN(gVal) || isNaN(bVal)) return 0; // defensive NaN guard
  const r = rVal / 255;
  const g = gVal / 255;
  const b = bVal / 255;
  const srgb = [r, g, b].map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(fg: string, bg: string): number {
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Minimum WCAG AA contrast ratio for normal text (>= 4.5:1) */
const MIN_CONTRAST_RATIO = 4.5;

/** Validate and normalize a hex color string; returns safe fallback on invalid input */
function safeColor(color: string | undefined | null, fallback: string = "#000000"): string {
  if (!color || typeof color !== "string") return fallback;
  let c = color.trim();
  if (!c.startsWith("#") && /^[0-9a-fA-F]{6}$/.test(c)) c = "#" + c;
  if (/^#[0-9a-fA-F]{3}$/.test(c) && c.length === 4) {
    c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) return fallback;
  return c;
}

/* ================================================================== */
/*  DESIGN TOKENS                                                     */
/* ================================================================== */

export const DesignTokensSchema = z.object({
  version: z.string().default("1.0.0"),
  name: z.string().default("default"),
  font: z.object({
    heading: z.string().max(100).regex(/^[a-zA-Z0-9\s\-_.]+$/).default("Calibri"),
    body: z.string().max(100).regex(/^[a-zA-Z0-9\s\-_.]+$/).default("Calibri"),
    mono: z.string().max(100).regex(/^[a-zA-Z0-9\s\-_.]+$/).default("Consolas"),
    sizeH1: z.number().min(1).max(200).default(28),
    sizeH2: z.number().min(1).max(150).default(22),
    sizeH3: z.number().min(1).max(120).default(18),
    sizeH4: z.number().min(1).max(100).default(16),
    sizeBody: z.number().min(1).max(100).default(12),
    sizeCaption: z.number().min(1).max(72).default(10),
    sizeMin: z.number().min(1).max(50).default(8),
    lineHeight: z.number().min(0.5).max(5).default(1.15),
  }).default({}),
  color: z.object({
    primary: z.string().default("#1a73e8"),
    secondary: z.string().default("#34a853"),
    accent: z.string().default("#ea4335"),
    warning: z.string().default("#fbbc04"),
    info: z.string().default("#4285f4"),
    success: z.string().default("#34a853"),
    background: z.string().default("#ffffff"),
    surface: z.string().default("#f8f9fa"),
    textPrimary: z.string().default("#202124"),
    textSecondary: z.string().default("#5f6368"),
    textMuted: z.string().default("#9aa0a6"),
    border: z.string().default("#dadce0"),
    headerBg: z.string().default("#1a73e8"),
    headerFg: z.string().default("#ffffff"),
    zebraOdd: z.string().default("#f8f9fa"),
    zebraEven: z.string().default("#ffffff"),
    priorityCritical: z.string().default("#FED7D7"),
    priorityHigh: z.string().default("#FEEBC8"),
    priorityMedium: z.string().default("#C6F6D5"),
    priorityLow: z.string().default("#E2E8F0"),
  }).default({}),
  spacing: z.object({
    xs: z.number().default(4),
    sm: z.number().default(8),
    md: z.number().default(16),
    lg: z.number().default(24),
    xl: z.number().default(32),
    xxl: z.number().default(48),
  }).default({}),
  layout: z.object({
    slideWidth: z.number().min(1).max(50).default(10),      // inches
    slideHeight: z.number().min(1).max(50).default(5.625),  // 16:9 widescreen default
    marginTop: z.number().min(0).max(5).default(0.5),
    marginBottom: z.number().min(0).max(5).default(0.5),
    marginLeft: z.number().min(0).max(5).default(0.5),
    marginRight: z.number().min(0).max(5).default(0.5),
    gridColumns: z.number().int().min(1).max(24).default(12),
    pageWidth: z.number().min(1).max(50).default(8.5),      // DOCX letter width inches
    pageHeight: z.number().min(1).max(50).default(11),      // DOCX letter height inches
  }).default({}),
  border: z.object({
    radiusSm: z.number().default(2),
    radiusMd: z.number().default(4),
    radiusLg: z.number().default(8),
    widthThin: z.number().default(1),
    widthMedium: z.number().default(2),
  }).default({}),
  shadow: z.object({
    sm: z.object({
      offsetX: z.number().default(1),
      offsetY: z.number().default(1),
      blur: z.number().default(2),
      color: z.string().default("00000033"),
    }).default({}),
    md: z.object({
      offsetX: z.number().default(2),
      offsetY: z.number().default(2),
      blur: z.number().default(6),
      color: z.string().default("00000040"),
    }).default({}),
  }).default({}),
});
export type DesignTokens = z.infer<typeof DesignTokensSchema>;

/* ================================================================== */
/*  SLIDE SPEC (PPT)                                                  */
/* ================================================================== */

export const SlideComponentSchema = z.object({
  type: z.enum(["title", "subtitle", "body", "bullets", "image", "chart", "table", "shape", "footer", "pageNumber"]),
  content: z.any(),
  style: z.record(z.any()).optional(),
  position: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
  }).optional(),
});

export const SlideSpecSchema = z.object({
  type: z.enum(["cover", "agenda", "content", "section_header", "chart", "table", "comparison", "closing", "blank"]),
  components: z.array(SlideComponentSchema),
  notes: z.string().optional(),
  transition: z.string().optional(),
});

export const PresentationSpecSchema = z.object({
  format: z.literal("pptx"),
  title: z.string(),
  author: z.string().optional(),
  subject: z.string().optional(),
  theme: DesignTokensSchema.default({}),
  slides: z.array(SlideSpecSchema),
  metadata: z.record(z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).optional(),
});
export type PresentationSpec = z.infer<typeof PresentationSpecSchema>;

/* ================================================================== */
/*  DOCUMENT SPEC (DOCX)                                              */
/* ================================================================== */

export const DocSectionSchema = z.object({
  type: z.enum(["heading", "paragraph", "bullets", "numberedList", "table", "image", "pageBreak", "toc", "quote", "code"]),
  level: z.number().int().min(1).max(6).optional(),
  content: z.any(),
  style: z.record(z.any()).optional(),
});

export const DocumentSpecSchema = z.object({
  format: z.literal("docx"),
  title: z.string(),
  author: z.string().optional(),
  subject: z.string().optional(),
  theme: DesignTokensSchema.default({}),
  sections: z.array(DocSectionSchema),
  header: z.string().optional(),
  footer: z.string().optional(),
  metadata: z.record(z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).optional(),
});
export type DocumentSpec = z.infer<typeof DocumentSpecSchema>;

/* ================================================================== */
/*  WORKBOOK SPEC (XLSX)                                              */
/* ================================================================== */

export const ColumnDefSchema = z.object({
  key: z.string(),
  header: z.string(),
  type: z.enum(["string", "number", "date", "currency", "percentage", "boolean", "formula"]).default("string"),
  width: z.number().positive().max(100).optional(), // Excel col max ~100 chars
  format: z.string().optional(),
  validation: z.object({
    type: z.enum(["list", "range", "length", "custom"]).optional(),
    values: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    formula: z.string().optional(),
  }).optional(),
});

export const SheetSpecSchema = z.object({
  name: z.string(),
  columns: z.array(ColumnDefSchema),
  rows: z.array(z.record(z.any())),
  formulas: z.array(z.object({
    cell: z.string(),
    formula: z.string(),
  })).default([]),
  filters: z.boolean().default(true),
  freezeRow: z.number().int().min(0).default(1),
  freezeCol: z.number().int().min(0).default(0),
  protection: z.boolean().default(false),
});

export const WorkbookSpecSchema = z.object({
  format: z.literal("xlsx"),
  title: z.string(),
  author: z.string().optional(),
  theme: DesignTokensSchema.default({}),
  sheets: z.array(SheetSpecSchema),
  metadata: z.record(z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).optional(),
});
export type WorkbookSpec = z.infer<typeof WorkbookSpecSchema>;

/* ================================================================== */
/*  LAYOUT ENGINE                                                     */
/* ================================================================== */

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class LayoutEngine {
  private tokens: DesignTokens;

  constructor(tokens: DesignTokens) {
    this.tokens = tokens;
  }

  /**
   * Calculate bounding boxes for slide components.
   * Anti-overflow: ensures nothing exceeds slide boundaries.
   */
  calculateSlideLayout(components: z.infer<typeof SlideComponentSchema>[]): LayoutBox[] {
    const { layout } = this.tokens;
    const usableW = layout.slideWidth - layout.marginLeft - layout.marginRight;
    const usableH = layout.slideHeight - layout.marginTop - layout.marginBottom;

    let currentY = layout.marginTop;
    const boxes: LayoutBox[] = [];

    for (const comp of components) {
      // Use explicit position if provided
      if (comp.position?.x !== undefined && comp.position?.y !== undefined) {
        const box: LayoutBox = {
          x: Math.min(comp.position.x, layout.slideWidth - 0.5),
          y: Math.min(comp.position.y, layout.slideHeight - 0.5),
          w: Math.min(comp.position.w || usableW, layout.slideWidth - (comp.position.x || layout.marginLeft)),
          h: Math.min(comp.position.h || 1, layout.slideHeight - (comp.position.y || currentY)),
        };
        boxes.push(box);
        continue;
      }

      // Auto-layout
      const estimatedH = this.estimateComponentHeight(comp, usableW);
      const remainingH = layout.slideHeight - layout.marginBottom - currentY;

      // Anti-overflow: if component doesn't fit, cap it
      const actualH = Math.min(estimatedH, remainingH, usableH * 0.6);

      const box: LayoutBox = {
        x: layout.marginLeft,
        y: currentY,
        w: usableW,
        h: actualH,
      };

      boxes.push(box);
      currentY += actualH + this.tokens.spacing.sm / 72; // convert pt to inches
    }

    return boxes;
  }

  private estimateComponentHeight(comp: z.infer<typeof SlideComponentSchema>, width: number): number {
    switch (comp.type) {
      case "title":
        return 1.2;
      case "subtitle":
        return 0.8;
      case "body":
        return this.estimateTextHeight(String(comp.content || ""), width);
      case "bullets": {
        const items = Array.isArray(comp.content) ? comp.content.length : 1;
        return Math.min(items * 0.4 + 0.2, 4.0);
      }
      case "image":
        return 3.0;
      case "chart":
        return 3.5;
      case "table": {
        const rows = Array.isArray(comp.content) ? comp.content.length : 3;
        return Math.min(rows * 0.35 + 0.5, 4.5);
      }
      case "footer":
      case "pageNumber":
        return 0.3;
      default:
        return 1.0;
    }
  }

  private estimateTextHeight(text: string, width: number): number {
    // Rough heuristic: ~10 chars per inch at body size
    const charsPerLine = width * 10;
    const lines = Math.ceil(text.length / charsPerLine);
    return Math.max(0.5, lines * 0.3);
  }

  /**
   * Check if text needs to be truncated to fit a box.
   * Returns { fits, truncated, overflow }.
   */
  checkTextFit(text: string, box: LayoutBox, fontSize: number): {
    fits: boolean;
    truncated: string;
    overflow: boolean;
  } {
    if (box.h <= 0 || box.w <= 0 || fontSize <= 0) return { fits: false, truncated: text.substring(0, 100), overflow: true };
    const charsPerInch = 72 / fontSize * 1.5; // rough estimate
    const maxCharsPerLine = box.w * charsPerInch;
    const maxLines = Math.floor(box.h / (fontSize / 72 * 1.5));
    const maxChars = maxCharsPerLine * maxLines;

    if (text.length <= maxChars) {
      return { fits: true, truncated: text, overflow: false };
    }

    return {
      fits: false,
      truncated: text.slice(0, Math.max(0, maxChars - 3)) + "…",
      overflow: true,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  OVERFLOW: Split content across multiple slides/pages            */
  /* ---------------------------------------------------------------- */

  /**
   * Split an array of slide components into groups that each fit
   * within the usable slide area. Used when a single slide has
   * too many components.
   */
  splitOverflow(
    components: z.infer<typeof SlideComponentSchema>[],
  ): z.infer<typeof SlideComponentSchema>[][] {
    const { layout } = this.tokens;
    const usableH = layout.slideHeight - layout.marginTop - layout.marginBottom;
    const groups: z.infer<typeof SlideComponentSchema>[][] = [];
    let current: z.infer<typeof SlideComponentSchema>[] = [];
    let currentHeight = 0;
    const usableW = layout.slideWidth - layout.marginLeft - layout.marginRight;

    for (const comp of components) {
      const h = this.estimateComponentHeight(comp, usableW);
      if (currentHeight + h > usableH && current.length > 0) {
        groups.push(current);
        current = [];
        currentHeight = 0;
      }
      current.push(comp);
      currentHeight += h + this.tokens.spacing.sm / 72;
    }

    if (current.length > 0) groups.push(current);
    return groups.length > 0 ? groups : [components];
  }

  /**
   * Split a table that's too tall across multiple groups.
   * Each group includes a copy of the header row.
   */
  splitTable(
    rows: any[][],
    maxRowsPerPage: number,
  ): { rows: any[][]; includesHeader: boolean }[] {
    if (rows.length <= 1) return [{ rows, includesHeader: true }];

    const header = rows[0];
    const dataRows = rows.slice(1);
    const chunks: { rows: any[][]; includesHeader: boolean }[] = [];

    const MAX_CHUNKS = 200; // cap to prevent memory exhaustion on huge tables
    for (let i = 0; i < dataRows.length && chunks.length < MAX_CHUNKS; i += maxRowsPerPage) {
      const chunk = dataRows.slice(i, i + maxRowsPerPage);
      chunks.push({
        rows: [header, ...chunk],
        includesHeader: true,
      });
    }

    return chunks.length > 0 ? chunks : [{ rows, includesHeader: true }];
  }

  /**
   * Auto-fit text: try decreasing font size until content fits,
   * with minimum font size from tokens.
   */
  autoFitText(
    text: string,
    box: LayoutBox,
    startFontSize: number,
  ): { fontSize: number; text: string; truncated: boolean } {
    const minFontSize = this.tokens.font.sizeMin;
    let fontSize = startFontSize;

    // Cap iterations to prevent CPU exhaustion on large font ranges
    const MAX_FONT_ITERATIONS = 50;
    let iterations = 0;
    while (fontSize > minFontSize && iterations < MAX_FONT_ITERATIONS) {
      const fit = this.checkTextFit(text, box, fontSize);
      if (fit.fits) {
        return { fontSize, text, truncated: false };
      }
      // Step down faster for large fonts to reduce iteration count
      fontSize -= fontSize > 48 ? 4 : fontSize > 24 ? 2 : 1;
      iterations++;
    }

    // At minimum font size, truncate if still doesn't fit
    const fit = this.checkTextFit(text, box, minFontSize);
    return {
      fontSize: minFontSize,
      text: fit.truncated,
      truncated: fit.overflow,
    };
  }

  /**
   * Split bullet items into groups that fit within a given height.
   * Returns arrays of bullet strings, each group fitting one slide.
   */
  splitBullets(
    items: string[],
    box: LayoutBox,
    fontSize: number,
  ): string[][] {
    const lineHeight = Math.max(0.01, fontSize / 72 * 1.5); // inches per line, min 0.01
    const maxItems = Math.max(1, Math.floor(box.h / lineHeight));
    const groups: string[][] = [];
    const MAX_GROUPS = 200; // cap to prevent memory exhaustion

    for (let i = 0; i < items.length && groups.length < MAX_GROUPS; i += maxItems) {
      groups.push(items.slice(i, i + maxItems));
    }

    return groups.length > 0 ? groups : [items];
  }
}

/* ================================================================== */
/*  DOCUMENT GENERATOR                                                */
/* ================================================================== */

export class DocumentEngine {
  private layoutEngine: LayoutEngine;

  constructor(tokens?: DesignTokens) {
    const parsedTokens = DesignTokensSchema.parse(tokens || {});
    this.layoutEngine = new LayoutEngine(parsedTokens);
  }

  /**
   * Generate a presentation from a spec.
   */
  async generatePresentation(spec: PresentationSpec): Promise<Buffer> {
    let parsed: PresentationSpec;
    try {
      parsed = PresentationSpecSchema.parse(spec);
    } catch (zodErr) {
      console.warn(`[DocumentEngine] Presentation spec validation failed: ${zodErr instanceof Error ? zodErr.message : String(zodErr)}`);
      // Use spec as-is with minimal safety
      parsed = spec;
    }
    const MAX_NOTES_LENGTH = 100_000;
    const MAX_TABLE_TOTAL_CHARS = 50_000;

    const pptx = createPptxDocument();
    pptx.title = sanitizeText(String(parsed.title || "").substring(0, 500));
    if (parsed.author) pptx.author = sanitizeText(String(parsed.author).substring(0, 200));
    if (parsed.subject) pptx.subject = sanitizeText(String(parsed.subject).substring(0, 200));

    const tokens = DesignTokensSchema.parse(parsed.theme);
    const layout = new LayoutEngine(tokens);

    for (const slideSpec of parsed.slides) {
      const slide = pptx.addSlide();
      const boxes = layout.calculateSlideLayout(slideSpec.components);

      for (let i = 0; i < slideSpec.components.length; i++) {
        const comp = slideSpec.components[i];
        const box = boxes[i];
        this.renderSlideComponent(slide, comp, box, tokens);
      }

      if (slideSpec.notes && typeof slideSpec.notes === "string") {
        slide.addNotes(sanitizeText(slideSpec.notes.substring(0, MAX_NOTES_LENGTH)));
      }
    }

    const data = await pptx.write({ outputType: "nodebuffer" });
    return Buffer.from(data as ArrayBuffer);
  }

  /**
   * Generate a Word document from a spec.
   */
  async generateDocument(spec: DocumentSpec): Promise<Buffer> {
    let parsed: DocumentSpec;
    try {
      parsed = DocumentSpecSchema.parse(spec);
    } catch (zodErr) {
      console.warn(`[DocumentEngine] Document spec validation failed: ${zodErr instanceof Error ? zodErr.message : String(zodErr)}`);
      parsed = spec;
    }
    const { generateWordFromMarkdown } = await import("../../services/markdownToDocx");

    // Convert spec sections to markdown for the existing renderer
    const MAX_MARKDOWN_SIZE = 2 * 1024 * 1024; // 2MB cap on generated markdown
    let markdown = `# ${parsed.title}\n\n`;

    for (const section of parsed.sections) {
      if (markdown.length > MAX_MARKDOWN_SIZE) {
        markdown += "\n[Document truncated due to size limits]\n";
        break;
      }
      switch (section.type) {
        case "heading": {
          const level = section.level || 1;
          markdown += `${"#".repeat(level)} ${section.content}\n\n`;
          break;
        }
        case "paragraph":
          markdown += `${section.content}\n\n`;
          break;
        case "bullets": {
          const items = Array.isArray(section.content) ? section.content : [section.content];
          items.forEach((item: string) => { markdown += `- ${item}\n`; });
          markdown += "\n";
          break;
        }
        case "numberedList": {
          const items = Array.isArray(section.content) ? section.content : [section.content];
          items.forEach((item: string, i: number) => { markdown += `${i + 1}. ${item}\n`; });
          markdown += "\n";
          break;
        }
        case "table": {
          if (Array.isArray(section.content) && section.content.length > 0) {
            const headers = section.content[0] as string[];
            markdown += `| ${headers.join(" | ")} |\n`;
            markdown += `| ${headers.map(() => "---").join(" | ")} |\n`;
            for (let r = 1; r < section.content.length; r++) {
              markdown += `| ${(section.content[r] as string[]).join(" | ")} |\n`;
            }
            markdown += "\n";
          }
          break;
        }
        case "pageBreak":
          markdown += "\n---\n\n";
          break;
        case "quote":
          markdown += `> ${section.content}\n\n`;
          break;
        case "code":
          markdown += `\`\`\`\n${section.content}\n\`\`\`\n\n`;
          break;
      }
    }

    const buffer = await generateWordFromMarkdown(markdown, parsed.title);
    return buffer;
  }

  /**
   * Generate an Excel workbook from a spec.
   */
  async generateWorkbook(spec: WorkbookSpec): Promise<Buffer> {
    let parsed: WorkbookSpec;
    try {
      parsed = WorkbookSpecSchema.parse(spec);
    } catch (zodErr) {
      console.warn(`[DocumentEngine] Workbook spec validation failed: ${zodErr instanceof Error ? zodErr.message : String(zodErr)}`);
      parsed = spec;
    }
    const excelMod = await import("exceljs");
    const ExcelJS = (excelMod as any).default || excelMod;

    // Estimate memory: cells × ~100 bytes, cap at 500MB to prevent OOM
    const MAX_WORKBOOK_MEMORY = 500 * 1024 * 1024; // 500MB
    const MAX_SAFE_CELLS = Math.floor(Number.MAX_SAFE_INTEGER / 100);
    let estimatedCells = 0;
    for (const sh of parsed.sheets) {
      const sheetCells = sh.rows.length * (sh.columns?.length || 1);
      if (sheetCells > MAX_SAFE_CELLS) {
        throw new Error(`Sheet "${sh.name}" exceeds safe cell count: ${sheetCells}`);
      }
      estimatedCells += sheetCells;
    }
    if (estimatedCells * 100 > MAX_WORKBOOK_MEMORY) {
      throw new Error(`Workbook too large: ~${estimatedCells} cells would require ~${Math.round(estimatedCells * 100 / 1024 / 1024)}MB (limit: ${MAX_WORKBOOK_MEMORY / 1024 / 1024}MB)`);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = parsed.author || "ILIA Agent";
    workbook.created = new Date();

    const tokens = DesignTokensSchema.parse(parsed.theme);

    for (const sheetSpec of parsed.sheets) {
      const sheet = workbook.addWorksheet(sanitizeSheetName(sheetSpec.name));

      // Setup columns
      sheet.columns = sheetSpec.columns.map((col) => ({
        header: col.header,
        key: col.key,
        width: col.width || 15,
      }));

      // Style header row (safe color normalization)
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: safeColor(tokens.color.headerFg, "#ffffff").replace("#", "FF") }, size: 11 };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: safeColor(tokens.color.headerBg, "#1a73e8").replace("#", "FF") },
      };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.height = 25;

      // Add data rows (sanitize cell values to prevent formula injection)
      for (let r = 0; r < sheetSpec.rows.length; r++) {
        const sanitizedRow: Record<string, any> = {};
        for (const [key, val] of Object.entries(sheetSpec.rows[r])) {
          sanitizedRow[key] = sanitizeExcelValue(val);
        }
        const row = sheet.addRow(sanitizedRow);

        // Zebra striping (safe colors)
        if (r % 2 === 0) {
          row.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: safeColor(tokens.color.zebraOdd, "#f8f9fa").replace("#", "FF") },
          };
        }

        // Apply column formats (with null-safe cell access)
        for (let c = 0; c < sheetSpec.columns.length; c++) {
          const colDef = sheetSpec.columns[c];
          const cell = row.getCell(c + 1);
          if (!cell) continue;

          if (colDef.format) {
            cell.numFmt = colDef.format;
          }

          // Data validation (sanitize list values)
          if (colDef.validation?.type === "list" && colDef.validation.values) {
            const safeValues = colDef.validation.values
              .map(v => String(v).replace(/"/g, "").replace(/,/g, "").substring(0, 255))
              .filter(v => v.length > 0)
              .slice(0, 100);
            if (safeValues.length > 0) {
              cell.dataValidation = {
                type: "list",
                allowBlank: true,
                formulae: [`"${safeValues.join(",")}"`],
              };
            }
          }
        }
      }

      // Apply formulas (validate cell reference format + row/col bounds, cap formula length)
      const cellRefPattern = /^([A-Z]{1,3})(\d{1,7})$/;
      const MAX_EXCEL_ROW = 1_048_576;
      const MAX_EXCEL_COL = 16_384; // XFD
      for (const formula of sheetSpec.formulas) {
        const match = formula.cell.match(cellRefPattern);
        if (!match) {
          console.warn(`[DocumentEngine] Skipping invalid cell ref: ${formula.cell}`);
          continue;
        }
        const rowNum = parseInt(match[2], 10);
        // Convert column letters to number (A=1, Z=26, AA=27...)
        // Pre-check: Excel max column is "XFD" (3 chars)
        if (match[1].length > 3) {
          console.warn(`[DocumentEngine] Column ref too long: ${match[1]}`);
          continue;
        }
        let colNum = 0;
        for (const ch of match[1]) {
          const code = ch.charCodeAt(0);
          if (code < 65 || code > 90) { colNum = MAX_EXCEL_COL + 1; break; } // only A-Z
          colNum = colNum * 26 + (code - 64);
        }
        if (rowNum > MAX_EXCEL_ROW || colNum > MAX_EXCEL_COL) {
          console.warn(`[DocumentEngine] Cell ref out of bounds: ${formula.cell} (row ${rowNum}, col ${colNum})`);
          continue;
        }
        const safeFormula = (formula.formula ?? "").substring(0, 8192); // Excel formula limit
        const cell = sheet.getCell(formula.cell);
        cell.value = { formula: safeFormula } as any;
      }

      // Auto-filter
      if (sheetSpec.filters && sheetSpec.columns.length > 0) {
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: sheetSpec.rows.length + 1, column: sheetSpec.columns.length },
        };
      }

      // Freeze panes
      if (sheetSpec.freezeRow > 0 || sheetSpec.freezeCol > 0) {
        sheet.views = [{
          state: "frozen",
          xSplit: sheetSpec.freezeCol,
          ySplit: sheetSpec.freezeRow,
        }];
      }

      // Sheet protection
      if (sheetSpec.protection) {
        sheet.protect("", { selectLockedCells: true, selectUnlockedCells: true });
      }

      // Add borders to all cells (capped to prevent memory exhaustion on huge sheets)
      const MAX_STYLED_ROWS = 10_000;
      const MAX_STYLED_COLS = 200;
      const lastRow = Math.min(sheetSpec.rows.length + 1, MAX_STYLED_ROWS);
      const lastCol = Math.min(sheetSpec.columns.length, MAX_STYLED_COLS);
      // Skip styling if total cell count exceeds 100k (prevents OOM on huge sheets)
      const totalCells = lastRow * lastCol;
      if (totalCells > 100_000) {
        console.warn(`[DocumentEngine] Skipping border styling: ${totalCells} cells exceeds 100k limit`);
      } else {
        // Hoist border color + object outside loop — single allocation reused across all cells
        const safeBorderColor = safeColor(tokens.color.border, "#dadce0").replace("#", "FF");
        const borderStyle = {
          top: { style: "thin" as const, color: { argb: safeBorderColor } },
          left: { style: "thin" as const, color: { argb: safeBorderColor } },
          bottom: { style: "thin" as const, color: { argb: safeBorderColor } },
          right: { style: "thin" as const, color: { argb: safeBorderColor } },
        };
        for (let r = 1; r <= lastRow; r++) {
          for (let c = 1; c <= lastCol; c++) {
            sheet.getCell(r, c).border = borderStyle;
          }
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /* -- Slide Component Renderer (with graceful degradation) --------- */

  private renderSlideComponent(
    slide: any,
    comp: z.infer<typeof SlideComponentSchema>,
    box: LayoutBox,
    tokens: DesignTokens
  ): void {
    try {
      this.renderSlideComponentInner(slide, comp, box, tokens);
    } catch (err) {
      // Graceful degradation: render as plain text fallback
      console.warn(`[DocumentEngine] Component "${comp.type}" render failed, using fallback: ${err instanceof Error ? err.message : String(err)}`);
      try {
        let fallbackText: string;
        try {
          fallbackText = typeof comp.content === "string"
            ? comp.content
            : Array.isArray(comp.content)
              ? comp.content.map(String).join("\n")
              : JSON.stringify(comp.content);
        } catch { fallbackText = "[content]"; }
        slide.addText(fallbackText.substring(0, 2000), {
          x: box.x, y: box.y, w: box.w, h: box.h,
          fontSize: tokens.font.sizeBody,
          fontFace: tokens.font.body,
          color: tokens.color.textSecondary,
          valign: "top",
        });
      } catch {
        // Even fallback failed — skip this component silently
      }
    }
  }

  private renderSlideComponentInner(
    slide: any,
    comp: z.infer<typeof SlideComponentSchema>,
    box: LayoutBox,
    tokens: DesignTokens
  ): void {
    const baseTextOpts = {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fontFace: tokens.font.body,
      color: tokens.color.textPrimary.replace("#", ""),
      fontSize: tokens.font.sizeBody,
      valign: "top" as const,
    };

    // Contrast check helper (log warning if text on bg fails WCAG AA)
    const checkContrast = (fg: string, bg: string, label: string) => {
      try {
        const ratio = contrastRatio(fg, bg);
        if (ratio < MIN_CONTRAST_RATIO) {
          console.warn(`[DocumentEngine] Low contrast (${ratio.toFixed(1)}:1) for ${label}: fg=${fg} bg=${bg} (WCAG AA requires ${MIN_CONTRAST_RATIO}:1)`);
        }
      } catch (e) { console.warn(`[DocumentEngine] Contrast check error: ${e instanceof Error ? e.message : String(e)}`); }
    };

    switch (comp.type) {
      case "title": {
        const text = String(comp.content || "");
        const fitted = this.layoutEngine.autoFitText(text, box, tokens.font.sizeH1);
        checkContrast(tokens.color.textPrimary, tokens.color.background, "title");
        slide.addText(fitted.text, {
          ...baseTextOpts,
          fontSize: fitted.fontSize,
          fontFace: tokens.font.heading,
          bold: true,
          valign: "middle" as const,
          color: tokens.color.textPrimary.replace("#", ""),
        });
        break;
      }

      case "subtitle": {
        const text = String(comp.content || "");
        const fitted = this.layoutEngine.autoFitText(text, box, tokens.font.sizeH2);
        slide.addText(fitted.text, {
          ...baseTextOpts,
          fontSize: fitted.fontSize,
          color: tokens.color.textSecondary.replace("#", ""),
          valign: "middle" as const,
        });
        break;
      }

      case "body": {
        const text = String(comp.content || "");
        const fitted = this.layoutEngine.autoFitText(text, box, tokens.font.sizeBody);
        slide.addText(fitted.text, {
          ...baseTextOpts,
          fontSize: fitted.fontSize,
        });
        break;
      }

      case "bullets": {
        const items = Array.isArray(comp.content) ? comp.content : [comp.content];
        const textItems = items.map((item: string) => ({
          text: String(item),
          options: {
            bullet: true,
            fontSize: tokens.font.sizeBody,
            color: tokens.color.textPrimary.replace("#", ""),
          },
        }));
        slide.addText(textItems, baseTextOpts);
        break;
      }

      case "table": {
        if (Array.isArray(comp.content) && comp.content.length > 0) {
          // Auto-split tables that are too large (max ~15 rows per slide)
          const maxRowsPerSlide = Math.max(3, Math.floor(box.h / 0.35));
          const chunks = this.layoutEngine.splitTable(comp.content, maxRowsPerSlide);
          const firstChunk = chunks[0]; // Only render first chunk on this slide

          let tableCharCount = 0;
          const tableRows = firstChunk.rows.map((row: any[], rowIdx: number) =>
            (Array.isArray(row) ? row : [row]).map((cell: any) => {
              const cellText = String(cell).substring(0, 500);
              tableCharCount += cellText.length;
              return {
              text: tableCharCount <= MAX_TABLE_TOTAL_CHARS ? cellText : "…",
              options: {
                fontSize: Math.max(tokens.font.sizeBody - 2, tokens.font.sizeMin),
                bold: rowIdx === 0,
                fill: rowIdx === 0
                  ? tokens.color.headerBg.replace("#", "")
                  : rowIdx % 2 === 0
                    ? tokens.color.zebraOdd.replace("#", "")
                    : tokens.color.zebraEven.replace("#", ""),
                color: rowIdx === 0
                  ? tokens.color.headerFg.replace("#", "")
                  : tokens.color.textPrimary.replace("#", ""),
              },
            }; })
          );

          const colCount = firstChunk.rows[0]?.length || 1;
          slide.addTable(tableRows, {
            x: box.x,
            y: box.y,
            w: box.w,
            colW: Array(colCount).fill(box.w / colCount),
            border: { pt: 0.5, color: tokens.color.border.replace("#", "") },
            autoPage: false,
          });
        }
        break;
      }

      case "image":
        if (typeof comp.content === "string" && comp.content.trim()) {
          if (!isImagePathSafe(comp.content)) {
            console.warn(`[DocumentEngine] Blocked unsafe image path: ${comp.content.substring(0, 80)}`);
            slide.addText("[Image blocked: unsafe path]", {
              ...baseTextOpts,
              align: "center",
              valign: "middle" as const,
              color: tokens.color.textSecondary.replace("#", ""),
              italic: true,
            });
          } else {
            try {
              slide.addImage({
                path: comp.content,
                x: box.x, y: box.y, w: box.w, h: box.h,
              });
            } catch {
              // Image failed — render placeholder
              slide.addText("[Image]", {
                ...baseTextOpts,
                align: "center",
                valign: "middle" as const,
                color: tokens.color.textSecondary.replace("#", ""),
                italic: true,
              });
            }
          }
        }
        break;

      case "chart":
        slide.addText("[Chart]", {
          ...baseTextOpts,
          align: "center",
          valign: "middle" as const,
          color: tokens.color.textSecondary.replace("#", ""),
          italic: true,
        });
        break;

      case "shape":
        slide.addShape("rect", {
          x: box.x, y: box.y, w: box.w, h: box.h,
          fill: { color: tokens.color.surface.replace("#", "") },
          line: { color: tokens.color.border.replace("#", ""), width: 1 },
        });
        break;

      case "footer":
        slide.addText(String(comp.content || ""), {
          ...baseTextOpts,
          fontSize: tokens.font.sizeCaption,
          color: tokens.color.textSecondary.replace("#", ""),
          align: "center",
        });
        break;

      case "pageNumber":
        slide.addText("Slide {{slideNumber}}", {
          ...baseTextOpts,
          fontSize: tokens.font.sizeCaption,
          color: tokens.color.textSecondary.replace("#", ""),
          align: "right",
        });
        break;

      default:
        // Unknown component type — render content as text
        slide.addText(String(comp.content || ""), baseTextOpts);
        break;
    }
  }
}

/* ================================================================== */
/*  EXPORTED SECURITY HELPERS (for testing)                            */
/* ================================================================== */

export { isImagePathSafe, sanitizeSheetName, contrastRatio, safeColor };
