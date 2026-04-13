import ExcelJS from "exceljs";
import * as PptxGenJSImport from "pptxgenjs";
import type PptxGenJS from "pptxgenjs";
import { JSDOM } from "jsdom";
import { Document, Packer, Paragraph, TextRun, AlignmentType, Header, Footer, ImageRun, BorderStyle, convertInchesToTwip } from "docx";

import { generateWordFromMarkdown } from "./markdownToDocx";
import { buildOfficeBrandingVisualSpec, resolveOfficeBrandTheme, type OfficeBrandingVisualSpec } from "./officeBranding";
import {
  ExcelStyleConfig,
  ExcelDashboardBuilder,
  type DashboardConfig
} from "../lib/excelStyles";

export interface DocumentContent {
  title: string;
  type: "word" | "excel" | "ppt";
  content: any;
}

export interface ProfessionalExcelOptions {
  useProfessionalStyles?: boolean;
  dashboard?: DashboardConfig;
  priorityColumn?: number;
  alternateRows?: boolean;
  freezeHeader?: boolean;
  autoFilter?: boolean;
}

type PptxGenConstructor = new () => PptxGenJS;

let cachedPptxGenConstructor: PptxGenConstructor | null = null;

function resolvePptxGenConstructor(): PptxGenConstructor {
  if (cachedPptxGenConstructor) {
    return cachedPptxGenConstructor;
  }

  const candidates = [
    (PptxGenJSImport as any)?.default?.default,
    (PptxGenJSImport as any)?.["module.exports"]?.default,
    (PptxGenJSImport as any)?.default,
    (PptxGenJSImport as any)?.["module.exports"],
    PptxGenJSImport,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      cachedPptxGenConstructor = candidate as PptxGenConstructor;
      return cachedPptxGenConstructor;
    }
  }

  throw new Error("Unable to resolve PptxGenJS constructor");
}

export function createPptxDocument(): PptxGenJS {
  const PptxGenCtor = resolvePptxGenConstructor();
  return new PptxGenCtor();
}

// ============================================
// SECURITY CONSTANTS
// ============================================

/** Excel cell limits to prevent resource exhaustion */
const EXCEL_MAX_ROWS = 1_048_576; // Excel's own limit
const EXCEL_MAX_COLUMNS = 16_384; // Excel's own limit
const EXCEL_MAX_CELL_LENGTH = 32_767; // Excel's own cell char limit
const EXCEL_SAFE_MAX_ROWS = 100_000; // Practical generation limit
const EXCEL_SAFE_MAX_COLUMNS = 500;

/** Maximum content size for Word document generation (5MB) */
const WORD_MAX_CONTENT_SIZE = 5 * 1024 * 1024;

/**
 * Excel formula injection prefixes.
 * When spreadsheet applications encounter these at the start of a cell,
 * they may interpret the value as a formula, enabling DDE attacks,
 * data exfiltration via HYPERLINK(), or arbitrary command execution.
 */
const EXCEL_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "|", "\\"];

/**
 * Sanitize a cell value for safe inclusion in Excel documents.
 * Prevents formula injection / DDE attacks by prefixing dangerous
 * values with a single-quote character that Excel treats as text-prefix.
 */
function sanitizeExcelCell(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length === 0) return value;
  const trimmed = value.trimStart();
  if (trimmed.length === 0) return value;
  // Truncate to Excel's cell character limit
  const bounded = value.length > EXCEL_MAX_CELL_LENGTH
    ? value.substring(0, EXCEL_MAX_CELL_LENGTH)
    : value;
  if (EXCEL_FORMULA_PREFIXES.some(prefix => trimmed.startsWith(prefix))) {
    return `'${bounded}`;
  }
  return bounded;
}

/**
 * Sanitize all cells in a 2D data array for safe Excel generation.
 */
function sanitizeExcelData(data: any[][]): any[][] {
  return data.map(row =>
    row.map(cell => sanitizeExcelCell(cell))
  );
}

function isHtmlContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}

function htmlToMarkdown(html: string): string {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  const katexElements = document.querySelectorAll('.katex');
  katexElements.forEach((katex) => {
    const annotation = katex.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation && annotation.textContent) {
      const latex = annotation.textContent;
      const isBlock = katex.closest('.math-display') || 
                     katex.closest('div.katex') ||
                     katex.closest('span.katex-display');
      const replacement = document.createTextNode(isBlock ? `$$${latex}$$` : `$${latex}$`);
      katex.replaceWith(replacement);
    }
  });
  
  const mathDisplays = document.querySelectorAll('.math-display, .katex-display');
  mathDisplays.forEach((el) => {
    const text = el.textContent || '';
    if (text.includes('$$')) {
      const replacement = document.createTextNode('\n\n' + text + '\n\n');
      el.replaceWith(replacement);
    }
  });
  
  function processNode(node: Node): string {
    if (node.nodeType === 3) {
      return node.textContent || '';
    }
    
    if (node.nodeType !== 1) return '';
    
    const element = node as Element;
    const tagName = element.tagName.toLowerCase();
    const children = Array.from(element.childNodes).map(processNode).join('');
    
    switch (tagName) {
      case 'p':
        return children.trim() + '\n\n';
      case 'br':
        return '\n';
      case 'strong':
      case 'b':
        return `**${children}**`;
      case 'em':
      case 'i':
        return `*${children}*`;
      case 'u':
        return children;
      case 'code':
        return `\`${children}\``;
      case 'h1':
        return `# ${children}\n\n`;
      case 'h2':
        return `## ${children}\n\n`;
      case 'h3':
        return `### ${children}\n\n`;
      case 'h4':
        return `#### ${children}\n\n`;
      case 'h5':
        return `##### ${children}\n\n`;
      case 'h6':
        return `###### ${children}\n\n`;
      case 'ul':
        return '\n' + Array.from(element.children)
          .map(li => `- ${processNode(li).trim()}`)
          .join('\n') + '\n\n';
      case 'ol':
        return '\n' + Array.from(element.children)
          .map((li, i) => `${i + 1}. ${processNode(li).trim()}`)
          .join('\n') + '\n\n';
      case 'li':
        return children;
      case 'blockquote':
        return children.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
      case 'pre':
        const codeEl = element.querySelector('code');
        const lang = codeEl?.className.match(/language-(\w+)/)?.[1] || '';
        return `\`\`\`${lang}\n${codeEl?.textContent || children}\n\`\`\`\n\n`;
      case 'a':
        const href = element.getAttribute('href') || '';
        return `[${children}](${href})`;
      case 'table':
        return processTable(element);
      case 'div':
      case 'span':
        return children;
      default:
        return children;
    }
  }
  
  function processTable(table: Element): string {
    const rows = table.querySelectorAll('tr');
    if (rows.length === 0) return '';
    
    let result = '';
    rows.forEach((row, rowIndex) => {
      const cells = row.querySelectorAll('th, td');
      const cellContents = Array.from(cells).map(cell => processNode(cell).trim());
      result += '| ' + cellContents.join(' | ') + ' |\n';
      
      if (rowIndex === 0) {
        result += '| ' + cellContents.map(() => '---').join(' | ') + ' |\n';
      }
    });
    
    return result + '\n';
  }
  
  return processNode(document.body).trim();
}

interface WordGenerationOptions {
  theme?: string;
  brand?: string;
  logoUrl?: string;
  logoText?: string;
  customColors?: Partial<OfficeBrandingVisualSpec["colors"]>;
}

function buildWordBrandingSpec(options: WordGenerationOptions = {}): OfficeBrandingVisualSpec {
  const brandingHints = [
    options.brand,
    options.logoText ? `logo: ${options.logoText}` : "",
    options.logoUrl ? `logoUrl: ${options.logoUrl}` : "",
    options.customColors?.primary ? `primary: #${options.customColors.primary}` : "",
    options.customColors?.secondary ? `secondary: #${options.customColors.secondary}` : "",
    options.customColors?.accent ? `accent: #${options.customColors.accent}` : "",
  ].filter(Boolean).join(", ");

  const resolved = resolveOfficeBrandTheme({
    theme: options.theme,
    brand: brandingHints,
  });
  return buildOfficeBrandingVisualSpec({
    ...resolved,
    logoUrl: options.logoUrl || resolved.logoUrl,
    logoText: options.logoText || resolved.logoText,
    customColors: {
      ...(resolved.customColors || {}),
      ...(options.customColors || {}),
    },
  });
}

async function loadBrandLogoBuffer(logoUrl?: string): Promise<Buffer | null> {
  if (!logoUrl) return null;
  try {
    if (logoUrl.startsWith("data:")) {
      const base64 = logoUrl.split(",")[1] || "";
      return base64 ? Buffer.from(base64, "base64") : null;
    }
    if (!/^https?:\/\//i.test(logoUrl)) return null;
    const response = await fetch(logoUrl);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

async function loadBrandLogoDataUri(logoUrl?: string): Promise<string | null> {
  if (!logoUrl) return null;
  try {
    if (logoUrl.startsWith("data:")) return logoUrl;
    if (!/^https?:\/\//i.test(logoUrl)) return null;
    const response = await fetch(logoUrl);
    if (!response.ok) return null;
    const mimeType = response.headers.get("content-type") || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    return `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function generateWordDocument(title: string, content: string, options: WordGenerationOptions = {}): Promise<Buffer> {
  // Security: enforce content size limit
  if (content.length > WORD_MAX_CONTENT_SIZE) {
    throw new Error(`Word document content exceeds maximum size of ${WORD_MAX_CONTENT_SIZE / (1024 * 1024)}MB`);
  }

  let markdownContent = content;

  if (isHtmlContent(content)) {
    markdownContent = htmlToMarkdown(content);
    console.log('[generateWordDocument] Converted HTML to Markdown for export');
  }

  const branding = buildWordBrandingSpec(options);
  const logoBuffer = await loadBrandLogoBuffer(options.logoUrl || branding.logoUrl);

  try {
    const blocks = markdownContent
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    const children: Paragraph[] = [];

    if (logoBuffer) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 220 },
        children: [new ImageRun({ data: logoBuffer, transformation: { width: 140, height: 56 } })],
      }));
    } else if (branding.logoText) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 220 },
        children: [new TextRun({
          text: branding.logoText,
          font: branding.fonts.heading,
          size: 28,
          bold: true,
          color: branding.colors.accent,
        })],
      }));
    }

    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, color: branding.colors.accent, size: 8 } },
      children: [new TextRun({
        text: title,
        font: branding.fonts.heading,
        size: 34,
        bold: true,
        color: branding.colors.primary,
      })],
    }));

    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [new TextRun({
        text: branding.brandName || branding.label,
        font: branding.fonts.body,
        size: 22,
        color: branding.colors.muted,
      })],
    }));

    for (const block of blocks) {
      const headingMatch = block.match(/^(#{1,3})\s+(.+)$/m);
      if (headingMatch) {
        children.push(new Paragraph({
          spacing: { before: 280, after: 120 },
          children: [new TextRun({
            text: headingMatch[2].trim(),
            font: branding.fonts.heading,
            size: headingMatch[1].length === 1 ? 28 : headingMatch[1].length === 2 ? 24 : 20,
            bold: true,
            color: branding.colors.secondary,
          })],
        }));
        continue;
      }

      const normalizedBlock = block
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s+/, "• ").trim())
        .join("\n");

      children.push(new Paragraph({
        spacing: { after: 180, line: 320 },
        children: [new TextRun({
          text: normalizedBlock,
          font: branding.fonts.body,
          size: 22,
          color: branding.colors.text,
        })],
      }));
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.9),
              bottom: convertInchesToTwip(0.7),
              left: convertInchesToTwip(0.9),
              right: convertInchesToTwip(0.9),
            },
          },
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              border: { bottom: { style: BorderStyle.SINGLE, color: branding.colors.accent, size: 4 } },
              children: [new TextRun({
                text: branding.brandName || branding.label,
                font: branding.fonts.body,
                size: 18,
                bold: true,
                color: branding.colors.accent,
              })],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({
                text: `${branding.label} • ${new Date().toLocaleDateString("es-ES")}`,
                font: branding.fonts.body,
                size: 16,
                color: branding.colors.muted,
              })],
            })],
          }),
        },
        children,
      }],
    });

    return Buffer.from(await Packer.toBuffer(doc));
  } catch (error) {
    console.warn('[generateWordDocument] Branded renderer failed, falling back to markdown renderer:', error);
    return generateWordFromMarkdown(title, markdownContent);
  }
}

export async function generateExcelDocument(
  title: string,
  data: any[][],
  options: ProfessionalExcelOptions = {}
): Promise<Buffer> {
  // Security: enforce row and column limits
  if (data.length > EXCEL_SAFE_MAX_ROWS) {
    throw new Error(`Excel data exceeds maximum row count of ${EXCEL_SAFE_MAX_ROWS}`);
  }
  const maxCols = data.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  if (maxCols > EXCEL_SAFE_MAX_COLUMNS) {
    throw new Error(`Excel data exceeds maximum column count of ${EXCEL_SAFE_MAX_COLUMNS}`);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IliaGPT';
  workbook.created = new Date();
  // Security: strip potentially sensitive workbook metadata
  workbook.lastModifiedBy = '';
  workbook.company = '';
  workbook.manager = '';

  // Security: sanitize all cell data against formula injection
  const rawData = data.length > 0 ? data : [["Contenido"], ["No hay datos disponibles"]];
  const safeData = sanitizeExcelData(rawData);

  const styles = new ExcelStyleConfig();
  const dashboardBuilder = new ExcelDashboardBuilder(workbook, styles);

  if (options.dashboard) {
    dashboardBuilder.createDashboard(options.dashboard);
  }

  const sheetName = title.replace(/[\\/:*?\[\]]/g, "").slice(0, 31) || "Hoja1";
  const worksheet = workbook.addWorksheet(sheetName);

  if (options.useProfessionalStyles && safeData.length > 1) {
    const headers = safeData[0].map(h => String(h));
    const rows = safeData.slice(1);

    dashboardBuilder.applyProfessionalTableStyle(
      worksheet,
      1,
      headers,
      rows,
      {
        freezeHeader: options.freezeHeader ?? true,
        autoFilter: options.autoFilter ?? true,
        alternateRows: options.alternateRows ?? true,
        priorityColumn: options.priorityColumn,
      }
    );

    const colWidths = safeData[0]?.map((_, colIndex) => {
      const maxLength = Math.max(...safeData.map(row => String(row[colIndex] || "").length));
      return Math.min(Math.max(maxLength, 12), 60);
    }) || [];

    colWidths.forEach((width, index) => {
      worksheet.getColumn(index + 1).width = width;
    });
  } else {
    worksheet.addRows(safeData);

    const colWidths = safeData[0]?.map((_, colIndex) => {
      const maxLength = Math.max(...safeData.map(row => String(row[colIndex] || "").length));
      return Math.min(Math.max(maxLength, 10), 50);
    }) || [];

    worksheet.columns = colWidths.map((width, index) => ({
      key: String.fromCharCode(65 + index),
      width: width
    }));
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function generateProfessionalDashboard(config: DashboardConfig): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IliaGPT';
  workbook.created = new Date();
  
  const styles = new ExcelStyleConfig();
  const builder = new ExcelDashboardBuilder(workbook, styles);
  builder.createDashboard(config);
  
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// PPT generation limits
const MAX_PPT_SLIDES = 200;
const MAX_PPT_TITLE_LENGTH = 500;
const MAX_PPT_CONTENT_ITEM_LENGTH = 5000;
const MAX_PPT_CONTENT_ITEMS = 20;
const MAX_PPT_TEXT_ELEMENTS_PER_SLIDE = 50;
const MAX_PPT_TOTAL_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB total text content
const MAX_PPT_TITLES_PER_SLIDE = 1;
const MAX_PPT_TRACE_MESSAGE_LENGTH = 420;
const PPT_TRACE_ENABLED = process.env.PPT_TRACE_ENABLED === "true" || process.env.NODE_ENV === "development";

type SlideVariant = "cover" | "section" | "content" | "two-column" | "table" | "closing";
type PptTraceContext = {
  source?: string;
  requestId?: string;
  actor?: string;
};

interface PptGenerationOptions {
  trace?: PptTraceContext;
  branding?: {
    theme?: string;
    brand?: string;
    logoUrl?: string;
    logoText?: string;
    customColors?: Partial<OfficeBrandingVisualSpec["colors"]>;
  };
}

interface PptFallbackContext extends PptTraceContext {
  traceId: string;
  reason?: string;
  requestedSlides?: number;
  stage?: string;
}

type PptTraceDetails = Record<string, string | number | boolean | null | undefined>;

function buildPptTraceId(): string {
  return `ppt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizePptTraceText(value: string | undefined): string {
  return sanitizePptText(value || "").replace(/\s+/g, " ").trim();
}

function truncateTraceValue(value: string, maxLength: number): string {
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function tracePptEvent(traceId: string, source: string, event: string, details: PptTraceDetails = {}): void {
  if (!PPT_TRACE_ENABLED) return;
  const payload = {
    ts: new Date().toISOString(),
    traceId,
    source: sanitizePptTraceText(source) || "generatePptDocument",
    event,
    ...details,
  };
  console.log(`[ppt-trace] ${JSON.stringify(payload)}`);
}

function tracePptError(error: unknown): string {
  if (error instanceof Error) {
    return truncateTraceValue(sanitizePptTraceText(`${error.name}: ${error.message}`), MAX_PPT_TRACE_MESSAGE_LENGTH);
  }
  return truncateTraceValue(sanitizePptTraceText(String(error)), MAX_PPT_TRACE_MESSAGE_LENGTH);
}

export const CORPORATE_PPT_DESIGN_SYSTEM = {
  palette: {
    bg: "F8FAFC",
    surface: "FFFFFF",
    surfaceElevated: "F1F5F9",
    primary: "0F172A",
    secondary: "334155",
    accent: "2563EB",
    text: "111827",
    muted: "64748B",
    border: "E2E8F0",
    shadow: "0F172A",
    tableHeader: "E2E8F0",
    footer: "CBD5E1",
  },
  typography: {
    heading: "Arial",
    body: "Arial",
    mono: "Consolas",
  },
  spacing: {
    marginX: 0.72,
    marginY: 0.55,
    sectionGap: 0.3,
    cardGap: 0.24,
    maxBodyHeight: 3.85,
  },
  sizes: {
    coverTitle: 28,
    coverSubtitle: 15,
    title: 24,
    sectionTitle: 28,
    body: 16,
    bodySmall: 11,
    badge: 9,
    footer: 9,
    icon: 12,
  },
  components: {
    gridColumns: 12,
    gridWidth: 9.0,
    badgeHeight: 0.22,
    buttonHeight: 0.45,
  },
} as const;

export const CORPORATE_PPT_MASTER_NAME = "ILIACODEX_CORPORATE" as const;

/**
 * Sanitize text content for PPT slides.
 * Strips control characters and null bytes that could corrupt the PPTX.
 */
function sanitizePptText(text: string): string {
  return text
    // Remove null bytes
    .replace(/\0/g, "")
    // Remove control characters except common whitespace
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function normalizePptContent(content: unknown): string[] {
  if (Array.isArray(content)) {
    return content
      .slice(0, MAX_PPT_CONTENT_ITEMS)
      .map((value) => sanitizePptText(typeof value === "string" ? value : String(value)))
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.substring(0, MAX_PPT_CONTENT_ITEM_LENGTH));
  }

  return [sanitizePptText(typeof content === "string" ? content : String(content))]
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => value.substring(0, MAX_PPT_CONTENT_ITEM_LENGTH));
}

export function normalizePptSlides(title: string, slides: { title: string; content: string[] }[]): { title: string; slides: { title: string; content: string[]; variant: SlideVariant; }[] } {
  const safeTitle = sanitizePptText(typeof title === "string" ? title : "Presentación").substring(0, MAX_PPT_TITLE_LENGTH) || "Presentación";
  const safeInput = Array.isArray(slides) ? slides : [];

  const sanitized = safeInput.slice(0, MAX_PPT_SLIDES).map((slide, index) => {
    const safeSlideTitle = sanitizePptText(typeof slide.title === "string" ? slide.title : `Slide ${index + 1}`).substring(0, MAX_PPT_TITLE_LENGTH) || `Slide ${index + 1}`;
    const safeContent = normalizePptContent(slide.content);

    return {
      title: safeSlideTitle,
      content: safeContent.length ? safeContent : ["(Sin contenido)"],
      variant: "content" as SlideVariant,
    };
  });

  if (sanitized.length === 0) {
    sanitized.push({
      title: "Resumen Ejecutivo",
      content: ["Este documento contiene el contenido base de la presentación solicitada."],
      variant: "content",
    });
  }

  let totalContentChars = safeTitle.length;
  for (const slide of sanitized) {
    totalContentChars += slide.title.length + slide.content.join("|").length;
    if (totalContentChars > MAX_PPT_TOTAL_CONTENT_SIZE) {
      slide.content = slide.content.slice(0, Math.max(1, slide.content.length - 1));
      slide.content[slide.content.length - 1] = `... truncado por límite de generación`;
      break;
    }
  }

  return { title: safeTitle, slides: sanitized };
}

function getSlideVariant(index: number, title: string, content: string[]): SlideVariant {
  const normalizedTitle = title.toLowerCase();
  const firstText = content.join(" ").toLowerCase();

  if (index === 0) return "cover";
  if (normalizedTitle.includes("sección") || normalizedTitle.includes("section")) return "section";
  if (normalizedTitle.includes("conclus") || normalizedTitle.includes("thanks") || normalizedTitle.includes("thank")) return "closing";
  if (normalizedTitle.length > 72 && content.length <= 1) return "section";
  if (content.length >= 10) return "two-column";

  const tableLike = content.filter(line => line.includes("|"));
  if (tableLike.length >= 2) return "table";
  if (firstText.startsWith("chart:") || firstText.includes("gráfico:") || firstText.includes("chart")) return "content";

  return "content";
}

export function defineCorporateMaster(pptx: PptxGenJS): void {
  pptx.defineSlideMaster({
    title: CORPORATE_PPT_MASTER_NAME,
    background: { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.bg },
    margin: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
    slideNumber: {
      x: 9.15,
      y: 5.35,
      w: 0.45,
      h: 0.2,
      align: "right",
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.footer,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.muted,
      bold: false,
      italic: false,
    },
    objects: [
      {
        line: {
          x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
          y: 5.15,
          w: 8.9,
          h: 0,
          line: { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.border, width: 1, dashType: "solid" },
        },
      },
      {
        text: {
          text: "Presentación ejecutiva",
          options: {
            x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
            y: 0.18,
            w: 2.4,
            h: 0.2,
            fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.bodySmall,
            color: CORPORATE_PPT_DESIGN_SYSTEM.palette.muted,
            fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
            align: "left",
          },
        },
      },
    ],
  });
}

function addCorporateBadge(slide: PptxGenJS.Slide, text: string): void {
  slide.addShape("rect", {
    x: 8.35,
    y: 5.38,
    w: 1.3,
    h: CORPORATE_PPT_DESIGN_SYSTEM.sizes.badge ? 0.2 : 0.22,
    fill: { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.surfaceElevated },
    line: {
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.border,
      width: 0.75,
    },
  });

  slide.addText(text, {
    x: 8.41,
    y: 5.385,
    w: 1.18,
    h: 0.2,
    align: "center",
    valign: "middle",
    fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.badge,
    color: CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
    bold: true,
    fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
  });
}

function addCorporateCard(slide: PptxGenJS.Slide, title: string, body: string, yOffset: number): void {
  slide.addShape("rect", {
    x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
    y: yOffset,
    w: 9.0,
    h: 3.7,
    fill: { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.surface },
    line: { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.border, width: 1 },
  });
  slide.addText(title, {
    x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX + 0.18,
    y: yOffset + 0.16,
    w: 8.64,
    h: 0.4,
    fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.bodySmall + 1,
    bold: true,
    color: CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
    fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
  });
  slide.addText(body, {
    x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX + 0.18,
    y: yOffset + 0.7,
    w: 8.64,
    h: 2.6,
    fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.body,
    color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
    fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
    valign: "top",
  });
}

function addCorporateButton(slide: PptxGenJS.Slide, label: string, x: number, y: number, w: number): void {
  slide.addShape("rect", {
    x,
    y,
    w,
    h: CORPORATE_PPT_DESIGN_SYSTEM.components.buttonHeight,
    fill: { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.secondary },
    line: {
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.secondary,
      width: 0,
    },
  });
  slide.addText(label, {
    x,
    y: y + 0.1,
    w,
    h: CORPORATE_PPT_DESIGN_SYSTEM.components.buttonHeight - 0.1,
    align: "center",
    fontSize: 12,
    bold: true,
    color: "FFFFFF",
    fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
  });
}

function addFooter(slide: PptxGenJS.Slide, title: string, slideIndex: number, total: number): void {
  slide.addText(`Resumen: ${title}`, {
    x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
    y: 5.05,
    w: 5.4,
    h: 0.2,
    align: "left",
    fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.footer,
    color: CORPORATE_PPT_DESIGN_SYSTEM.palette.muted,
    fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
    italic: true,
    valign: "middle",
  });
  slide.addText(`${slideIndex}/${total}`, {
    x: 9.14,
    y: 5.07,
    w: 0.65,
    h: 0.2,
    align: "right",
    fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.footer,
    color: CORPORATE_PPT_DESIGN_SYSTEM.palette.muted,
    fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
    valign: "middle",
  });
}

function parseSlideTable(lines: string[]): string[][] | null {
  if (lines.length < 2) return null;
  const normalized = lines
    .filter(Boolean)
    .map((line) => line.trim())
    .filter(line => line.includes("|"));

  if (normalized.length < 2) return null;
  const splitRows = normalized.map((line) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map(cell => cell.trim())
      .filter(cell => cell.length > 0)
  );

  const hasSeparator = splitRows.some(row => row.every(cell => /^-+$/.test(cell)));
  if (!hasSeparator) return null;
  const columns = Math.max(...splitRows.map(row => row.length));
  if (columns < 2) return null;

  return splitRows
    .filter((row, idx) => {
      if (!row.length || row.every(cell => /^-+$/.test(cell))) return false;
      if (hasSeparator && splitRows[idx - 1] && splitRows[idx - 1].every(cell => /^-+$/.test(cell))) return false;
      return true;
    })
    .filter(row => row.length > 0)
    .map(row => {
      const padded = [...row];
      while (padded.length < columns) padded.push("");
      return padded.slice(0, columns);
    });
}

function tryParseChartFromLines(lines: string[]): { title: string; labels: string[]; values: number[] } | null {
  const text = lines.join(" ").trim();
  if (!/^chart:/i.test(text)) return null;

  const payload = text.replace(/^chart:\s*/i, "");
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.labels) || !Array.isArray(parsed.values)) return null;
    const values = parsed.values.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value));
    if (!values.length) return null;

    return {
      title: sanitizePptText(parsed.title || "Métricas").substring(0, 80),
      labels: parsed.labels.map((label: unknown) => sanitizePptText(String(label)).substring(0, 40)),
      values,
    };
  } catch {
    return null;
  }
}

function renderSlideContent(slide: PptxGenJS.Slide, slideData: { title: string; content: string[]; variant: SlideVariant }, deckTitle: string, index: number, totalSlides: number): void {
  const bodyY = 1.6;
  const bodyH = CORPORATE_PPT_DESIGN_SYSTEM.spacing.maxBodyHeight;
  const normalizedLines = slideData.content
    .map((line) => sanitizePptText(line).replace(/^[\s\-*•\d.]+/, "").trim())
    .filter(Boolean);

  if (slideData.variant === "cover") {
    slide.addShape("rect", {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 1.08,
      w: 1.15,
      h: 0.06,
      fill: { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.accent },
      line: { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.accent, width: 0 },
    });
    slide.addText("PRESENTACIÓN", {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 1.18,
      w: 2.2,
      h: 0.2,
      fontSize: 10,
      bold: true,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.muted,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
    });
    slide.addText(slideData.title, {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 1.55,
      w: 9.0,
      h: 1.05,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.coverTitle,
      bold: true,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.heading,
      align: "left",
      valign: "middle",
    });

    const subtitle = normalizedLines[0] || `Resumen ejecutivo de ${deckTitle}`;
    slide.addText(subtitle, {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 2.8,
      w: 8.1,
      h: 0.7,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.coverSubtitle,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
      align: "left",
      valign: "top",
    });
    slide.addText(`${index + 1}/${totalSlides}`, {
      x: 8.9,
      y: 5.22,
      w: 0.7,
      h: 0.2,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.footer,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.muted,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
      align: "right",
    });
    return;
  }

  if (slideData.variant === "section") {
    slide.addText("SECCIÓN", {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 1.52,
      w: 2.4,
      h: 0.2,
      fontSize: 10,
      bold: true,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.muted,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
    });
    slide.addText(slideData.title, {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 2.0,
      w: 8.7,
      h: 0.95,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.sectionTitle,
      bold: true,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
      align: "left",
      valign: "middle",
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.heading,
    });
    if (normalizedLines[0]) {
      slide.addText(normalizedLines[0], {
        x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
        y: 3.18,
        w: 7.6,
        h: 0.6,
        fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.body,
        color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
        fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
      });
    }
    return;
  }

  if (slideData.variant === "closing") {
    slide.addText(slideData.title, {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 1.55,
      w: 8.6,
      h: 0.85,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.sectionTitle,
      bold: true,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.heading,
    });
    const closingBullets = (normalizedLines.length > 0 ? normalizedLines : ["Cerrar con decisiones, responsables y siguiente revisión."]).map((text) => ({
      text,
      options: {
        bullet: true,
        breakLine: true,
      },
    }));
    slide.addText(closingBullets, {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 2.6,
      w: 8.6,
      h: 2.1,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.body,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
      breakLine: true,
    });
    return;
  }

  slide.addShape("rect", {
    x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
    y: 0.88,
    w: 0.8,
    h: 0.05,
    fill: { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.accent },
    line: { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.accent, width: 0 },
  });
  slide.addText(`${index + 1}/${totalSlides}`, {
    x: 8.9,
    y: 5.22,
    w: 0.7,
    h: 0.2,
    fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.footer,
    color: CORPORATE_PPT_DESIGN_SYSTEM.palette.muted,
    fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
    align: "right",
  });

  const chartData = tryParseChartFromLines(normalizedLines);
  if (chartData && chartData.labels.length && chartData.values.length) {
    slide.addText(slideData.title, {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 1.02,
      w: 8.7,
      h: 0.6,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.title,
      bold: true,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.heading,
      align: "left",
    });

    slide.addChart("bar", [
      {
        name: chartData.title,
        labels: chartData.labels,
        values: chartData.values,
      },
    ], {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 1.5,
      w: 8.9,
      h: bodyH,
      showTitle: true,
      chartColors: [
        CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
        CORPORATE_PPT_DESIGN_SYSTEM.palette.accent,
        CORPORATE_PPT_DESIGN_SYSTEM.palette.secondary,
      ],
      catAxisLabelFontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.bodySmall,
      valAxisLabelFontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.bodySmall,
      chartColorsOpacity: 0.86,
      barDir: "col",
      showValue: true,
      showPercent: false,
      lineSize: 1,
      dataLabelPosition: "bestFit",
      dataLabelFontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.bodySmall,
      dataLabelColor: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
      showLabel: true,
      showDataTable: false,
      showLegend: false,
      barGrouping: "clustered",
    } as any);
    return;
  }

  const tableRows = parseSlideTable(normalizedLines);
  if (tableRows && tableRows.length > 0) {
    slide.addText(slideData.title, {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 1.02,
      w: 8.7,
      h: 0.6,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.title,
      bold: true,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.heading,
    });

    const tableWithStyles = tableRows.map((row, rowIndex) =>
      row.map((cell) => ({
        text: cell,
        options: {
          align: rowIndex === 0 ? ("center" as const) : ("left" as const),
          fontFace: rowIndex === 0 ? CORPORATE_PPT_DESIGN_SYSTEM.typography.heading : CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
          bold: rowIndex === 0,
          color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
          fill: rowIndex === 0 ? { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.tableHeader } : undefined,
          fontSize: rowIndex === 0 ? CORPORATE_PPT_DESIGN_SYSTEM.sizes.bodySmall + 2 : CORPORATE_PPT_DESIGN_SYSTEM.sizes.bodySmall,
        },
      }))
    );

    slide.addTable(tableWithStyles, {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 1.62,
      w: 8.9,
      h: bodyH,
      border: { pt: 0.75, color: CORPORATE_PPT_DESIGN_SYSTEM.palette.border },
      colW: Math.round((CORPORATE_PPT_DESIGN_SYSTEM.components.gridWidth * 100) / Math.max(...tableRows.map(row => row.length))) / 100,
    } as any);
    return;
  }

  if (slideData.variant === "two-column") {
    slide.addText(slideData.title, {
      x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
      y: 1.02,
      w: 8.7,
      h: 0.5,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.title,
      bold: true,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.heading,
    });

    const bullets = normalizedLines.slice(0, MAX_PPT_TEXT_ELEMENTS_PER_SLIDE).map((text) => ({
      text,
      options: {
        bullet: true,
        breakLine: true,
      },
    }));

    const mid = Math.ceil(bullets.length / 2);
    const firstColumn = bullets.slice(0, mid);
    const secondColumn = bullets.slice(mid);
    slide.addText(firstColumn, {
      x: 0.55,
      y: bodyY,
      w: 4.3,
      h: bodyH,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.body,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
      valign: "top",
      lineSpacingMultiple: 1.12,
    });
    if (secondColumn.length) {
      slide.addText(secondColumn, {
        x: 5.15,
        y: bodyY,
        w: 4.3,
        h: bodyH,
        color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
        fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.body,
        fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
        valign: "top",
        lineSpacingMultiple: 1.12,
      });
    }
    return;
  }

  slide.addText(slideData.title, {
    x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
    y: 1.02,
    w: 8.7,
    h: 0.55,
    fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.title,
    bold: true,
    color: CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
    fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.heading,
  });

  const bullets = normalizedLines
    .slice(0, MAX_PPT_TEXT_ELEMENTS_PER_SLIDE)
    .map((text) => ({
      text,
      options: {
        bullet: true,
        color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
      },
    }));

  slide.addText(bullets, {
    x: CORPORATE_PPT_DESIGN_SYSTEM.spacing.marginX,
    y: bodyY,
    w: 8.7,
    h: bodyH,
    fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.body,
    color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
    fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
    valign: "top",
    breakLine: true,
  });
}

async function createUltraMinimalFallbackPpt(
  title: string,
  slideCount: number,
  context?: PptFallbackContext
): Promise<Buffer> {
  const fallback = createPptxDocument();
  const safeTitle = sanitizePptText(title).substring(0, MAX_PPT_TITLE_LENGTH) || "Presentación";
  const source = sanitizePptTraceText(context?.source || "generatePptDocument");
  const traceId = context?.traceId || buildPptTraceId();

  fallback.layout = "LAYOUT_16x9";
  fallback.title = safeTitle;

  const slide = fallback.addSlide();
  slide.background = { color: "FFFFFF" };
  slide.addText(safeTitle, {
    x: 0.8,
    y: 1.6,
    w: 8.4,
    h: 1,
    fontSize: 32,
    bold: true,
    align: "center",
    color: "1F2937",
    valign: "middle",
  });
  slide.addText("No fue posible aplicar el tema corporativo completo.", {
    x: 0.8,
    y: 3,
    w: 8.4,
    h: 0.7,
    fontSize: 16,
    align: "center",
    color: "4B5563",
    valign: "middle",
  });
  slide.addText(`Diapositivas solicitadas: ${Math.max(1, slideCount)}`, {
    x: 0.8,
    y: 3.9,
    w: 8.4,
    h: 0.7,
    fontSize: 12,
    align: "center",
    color: "6B7280",
  });
  if (context?.reason) {
    slide.addText(`Motivo: ${truncateTraceValue(context.reason, 200)}`, {
      x: 0.8,
      y: 4.5,
      w: 8.4,
      h: 0.7,
      fontSize: 11,
      align: "center",
      color: "6B7280",
    });
  }
  slide.addText(`Origen: ${source}`, {
    x: 0.2,
    y: 5.2,
    w: 9.6,
    h: 0.2,
    fontSize: 9,
    color: "9CA3AF",
    align: "right",
  });

  try {
    const fallbackBuffer = await fallback.write({ outputType: "nodebuffer" });
    const buffer = Buffer.from(fallbackBuffer as ArrayBuffer);
    tracePptEvent(traceId, source, "fallback.ultra.minimal.success", {
      bytes: buffer.length,
      requestedSlides: context?.requestedSlides || slideCount,
    });
    return buffer;
  } catch (ultraError) {
    tracePptEvent(traceId, source, "fallback.ultra.minimal.failed", {
      error: tracePptError(ultraError),
      requestedSlides: context?.requestedSlides || slideCount,
    });
    // Last resort: create a truly minimal valid PPTX instead of an invalid text string
    try {
      const emergencyPptx = createPptxDocument();
      emergencyPptx.title = safeTitle;
      const emergencySlide = emergencyPptx.addSlide();
      emergencySlide.addText(safeTitle, {
        x: 1, y: 2.5, w: 8, h: 1,
        fontSize: 24, bold: true, align: "center", color: "1F2937",
      });
      const emergencyBuffer = await emergencyPptx.write({ outputType: "nodebuffer" });
      return Buffer.from(emergencyBuffer as ArrayBuffer);
    } catch {
      // Absolute last resort: return a minimal valid PPTX from a fresh PptxGenJS instance
      const PptxGenJS = (await import("pptxgenjs")).default;
      const p = new PptxGenJS();
      p.title = "Error";
      p.addSlide().addText("Fallback", { x: 1, y: 2, w: 8, h: 1, fontSize: 18 });
      const buf = (await p.write({ outputType: "arraybuffer" })) as ArrayBuffer;
      return Buffer.from(buf);
    }
  }
}

async function createSafeFallbackPpt(
  title: string,
  slideCount: number,
  context: PptFallbackContext
): Promise<Buffer> {
  const safeTitle = sanitizePptText(title).substring(0, MAX_PPT_TITLE_LENGTH) || "Presentación";
  const source = sanitizePptTraceText(context?.source || "generatePptDocument");
  const traceId = context?.traceId || buildPptTraceId();

  try {
    const fallback = createPptxDocument();
    fallback.layout = "LAYOUT_16x9";
    fallback.title = safeTitle;
    defineCorporateMaster(fallback);
    const slide = fallback.addSlide({ masterName: CORPORATE_PPT_MASTER_NAME });
    slide.background = { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.bg };
    slide.addText(safeTitle, {
      x: 0.9,
      y: 2.2,
      w: 8.2,
      h: 1.2,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.sectionTitle,
      bold: true,
      align: "center",
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.primary,
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.heading,
    });
    slide.addText(`No fue posible aplicar el maquetado de algunas diapositivas. Total de diapositivas pedidas: ${Math.max(1, slideCount)}`, {
      x: 0.9,
      y: 3.4,
      w: 8.2,
      h: 0.9,
      fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.body,
      color: CORPORATE_PPT_DESIGN_SYSTEM.palette.text,
      align: "center",
      fontFace: CORPORATE_PPT_DESIGN_SYSTEM.typography.body,
    });
    addCorporateBadge(slide, "Fallback");
    addFooter(slide, safeTitle, 1, 1);

    const fallbackBuffer = await fallback.write({ outputType: "nodebuffer" });
    const safeBuffer = Buffer.from(fallbackBuffer as ArrayBuffer);
    tracePptEvent(traceId, source, "fallback.primary.success", {
      stage: context.stage || "safe",
      requestedSlides: context.requestedSlides || slideCount,
      bytes: safeBuffer.length,
      error: context.reason || "",
    });
    return safeBuffer;
  } catch (fallbackError) {
    const safeError = tracePptError(fallbackError);
    tracePptEvent(traceId, source, "fallback.primary.failed", {
      stage: context.stage || "safe",
      requestedSlides: context.requestedSlides || slideCount,
      error: safeError,
    });
    return createUltraMinimalFallbackPpt(safeTitle, slideCount, {
      traceId,
      source,
      reason: safeError,
      requestedSlides: context.requestedSlides || slideCount,
      stage: "ultra-minimal",
      actor: context.actor,
    });
  }
}

export async function generatePptDocument(
  title: string,
  slides: { title: string; content: string[] }[],
  options: PptGenerationOptions = {}
): Promise<Buffer> {
  const safeTitle = sanitizePptText(title).substring(0, MAX_PPT_TITLE_LENGTH) || "Presentación";
  const requestedSlides = Array.isArray(slides) ? slides.length : 0;
  const source = sanitizePptTraceText(options.trace?.source || "generatePptDocument");
  const traceId = options.trace?.requestId || buildPptTraceId();
  const startedAt = Date.now();
  let normalized: { title: string; slides: { title: string; content: string[]; variant: SlideVariant; }[] };

  tracePptEvent(traceId, source, "request.start", {
    requestedSlides,
  });

  try {
    normalized = normalizePptSlides(safeTitle, slides);
    const slideCount = Math.max(1, normalized.slides.length);
    const branding = options.branding ? buildWordBrandingSpec(options.branding) : null;
    const brandingLogo = branding ? await loadBrandLogoDataUri(branding.logoUrl) : null;
    const preparedSlides = normalized.slides.map((slideData, index) => {
      slideData.variant = getSlideVariant(
        index,
        slideData.title,
        slideData.content
      );
      return slideData;
    });

    tracePptEvent(traceId, source, "request.normalized", {
      requestedSlides,
      slideCount: preparedSlides.length,
      droppedSlides: Math.max(0, requestedSlides - preparedSlides.length),
    });

    const presentation = createPptxDocument();
    presentation.layout = "LAYOUT_16x9";
    presentation.title = sanitizePptText(normalized.title).substring(0, MAX_PPT_TITLE_LENGTH);
    presentation.author = "IliaGPT";
    presentation.company = "";
    presentation.subject = "";
    if (!branding) {
      defineCorporateMaster(presentation);
    }

    let fallbackSlides = 0;
    for (let index = 0; index < preparedSlides.length; index++) {
      const slide = branding ? presentation.addSlide() : presentation.addSlide({ masterName: CORPORATE_PPT_MASTER_NAME });
      const slideData = preparedSlides[index];

      try {
        if (branding) {
          slide.background = { color: branding.colors.surface };
          slide.addShape("rect", {
            x: 0,
            y: 0,
            w: 10,
            h: 0.42,
            fill: { color: branding.colors.primary },
            line: { color: branding.colors.primary },
          });

          if (brandingLogo) {
            slide.addImage({ data: brandingLogo, x: 0.45, y: 0.55, w: 1.1, h: 0.5 });
          } else if (branding.logoText || branding.brandName) {
            slide.addText(branding.logoText || branding.brandName || branding.label, {
              x: 0.45,
              y: 0.58,
              w: 2.6,
              h: 0.35,
              fontFace: branding.fonts.heading,
              fontSize: 18,
              bold: true,
              color: branding.colors.accent,
            });
          }

          slide.addText(sanitizePptText(slideData.title), {
            x: 0.6,
            y: 1.35,
            w: 8.8,
            h: 0.8,
            fontFace: branding.fonts.heading,
            fontSize: 24,
            bold: true,
            color: branding.colors.primary,
          });

          const body = (slideData.content || []).slice(0, 8).map(item => `• ${sanitizePptText(item)}`).join("\n");
          slide.addText(body || "• Contenido principal", {
            x: 0.75,
            y: 2.2,
            w: 8.4,
            h: 3.1,
            fontFace: branding.fonts.body,
            fontSize: 17,
            color: branding.colors.text,
            breakLine: false,
            valign: "top",
            margin: 0.05,
          });

          slide.addText(`${branding.label} • ${index + 1}/${slideCount}`, {
            x: 0.6,
            y: 6.85,
            w: 8.8,
            h: 0.25,
            fontFace: branding.fonts.body,
            fontSize: 10,
            color: branding.colors.muted,
            align: "right",
          });
        } else {
          slide.background = { color: CORPORATE_PPT_DESIGN_SYSTEM.palette.bg };
          renderSlideContent(slide, slideData, normalized.title, index, slideCount);
        }
      } catch (slideError) {
        fallbackSlides += 1;
        const safeSlideError = tracePptError(slideError);
        const safeSlideTitle = sanitizePptText(slideData.title).substring(0, MAX_PPT_TITLE_LENGTH) || `Diapositiva ${index + 1}`;

        console.warn(`[generatePptDocument] Fallback rendering slide ${index + 1}: ${safeSlideError}`);
        tracePptEvent(traceId, source, "slide.fallback", {
          slideIndex: index + 1,
          reason: safeSlideError,
        });

        const fallbackPrimary = branding?.colors.primary || CORPORATE_PPT_DESIGN_SYSTEM.palette.primary;
        const fallbackAccent = branding?.colors.accent || CORPORATE_PPT_DESIGN_SYSTEM.palette.secondary;
        const fallbackSurface = branding?.colors.surface || CORPORATE_PPT_DESIGN_SYSTEM.palette.surface;
        const fallbackText = branding?.colors.text || CORPORATE_PPT_DESIGN_SYSTEM.palette.text;
        const fallbackMuted = branding?.colors.muted || CORPORATE_PPT_DESIGN_SYSTEM.palette.muted;
        slide.background = { color: fallbackSurface };
        slide.addText(safeSlideTitle, {
          x: 0.6,
          y: 2.35,
          w: 8.8,
          h: 0.9,
          fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.sectionTitle,
          bold: true,
          align: "center",
          color: fallbackPrimary,
        });
        slide.addText("No se pudo renderizar esta diapositiva con el formato extendido. Se muestra el contenido mínimo.", {
          x: 0.6,
          y: 3.4,
          w: 8.8,
          h: 1,
          fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.body,
          color: fallbackText,
          align: "center",
        });
        slide.addText((slideData.content || [""]).slice(0, MAX_PPT_TITLES_PER_SLIDE).join("\n"), {
          x: 0.6,
          y: 4.15,
          w: 8.8,
          h: 1,
          fontSize: CORPORATE_PPT_DESIGN_SYSTEM.sizes.bodySmall,
          color: fallbackMuted,
        });
        if (!branding) {
          addFooter(slide, safeTitle, index + 1, slideCount);
          addCorporateBadge(slide, "Recovery");
        } else {
          slide.addShape("rect", {
            x: 0,
            y: 0,
            w: 10,
            h: 0.28,
            fill: { color: fallbackAccent },
            line: { color: fallbackAccent },
          });
        }
      }
    }

    const buffer = await presentation.write({ outputType: "nodebuffer" });
    const safeBuffer = buffer as Buffer;
    tracePptEvent(traceId, source, "request.success", {
      slideCount: slideCount,
      fallbackSlides,
      durationMs: Date.now() - startedAt,
      bytes: safeBuffer.length,
    });
    return safeBuffer;
  } catch (error) {
    const safeError = tracePptError(error);
    tracePptEvent(traceId, source, "request.failed", {
      requestedSlides,
      durationMs: Date.now() - startedAt,
      error: safeError,
    });
    return createSafeFallbackPpt(safeTitle, Math.max(1, requestedSlides), {
      traceId,
      source,
      reason: safeError,
      requestedSlides,
      stage: "full",
      actor: options.trace?.actor,
    });
  }
}

export function parseExcelFromText(text: string): any[][] {
  // Security: limit input text size
  const safeText = text.length > WORD_MAX_CONTENT_SIZE
    ? text.substring(0, WORD_MAX_CONTENT_SIZE)
    : text;
  const lines = safeText.trim().split("\n");
  const data: any[][] = [];

  for (const line of lines) {
    // Security: enforce row limit
    if (data.length >= EXCEL_SAFE_MAX_ROWS) {
      console.warn(`[parseExcelFromText] Row limit reached (${EXCEL_SAFE_MAX_ROWS}), truncating`);
      break;
    }

    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    // Skip pure markdown table separator lines (|---|---|)
    if (/^\|?[\s\-:|]+\|[\s\-:|]*$/.test(trimmedLine)) continue;

    let cells: string[];
    if (trimmedLine.includes("|")) {
      cells = trimmedLine.split("|").map(cell => cell.trim()).filter(cell => cell && !cell.match(/^-+$/));
    } else if (trimmedLine.includes(",")) {
      cells = trimmedLine.split(",").map(cell => cell.trim());
      if (cells.length <= 1) {
        cells = [trimmedLine];
      }
    } else if (trimmedLine.includes("\t")) {
      cells = trimmedLine.split("\t").map(cell => cell.trim());
    } else if (trimmedLine.includes(";")) {
      cells = trimmedLine.split(";").map(cell => cell.trim());
    } else {
      cells = [trimmedLine];
    }

    // Security: enforce column limit and cell length limit
    if (cells.length > EXCEL_SAFE_MAX_COLUMNS) {
      cells = cells.slice(0, EXCEL_SAFE_MAX_COLUMNS);
    }
    cells = cells.map(c => c.length > EXCEL_MAX_CELL_LENGTH ? c.substring(0, EXCEL_MAX_CELL_LENGTH) : c);

    if (cells.length > 0) {
      data.push(cells);
    }
  }

  if (data.length === 0) {
    data.push(["Contenido"], [safeText.slice(0, 500)]);
  }

  return data;
}

export function parseSlidesFromText(text: string): { title: string; content: string[] }[] {
  const slides: { title: string; content: string[] }[] = [];
  const sections = text.split(/(?=^##?\s)/m);
  
  for (const section of sections) {
    const lines = section.trim().split("\n");
    if (lines.length === 0) continue;
    
    let title = lines[0].replace(/^#+\s*/, "").trim();
    if (!title) continue;
    
    const content: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.match(/^-+$/)) {
        content.push(line.replace(/^[-*•\d.)\s]+/, "").trim() || line);
      }
    }
    
    if (content.length > 0 || slides.length === 0) {
      slides.push({ title, content: content.length > 0 ? content : [""] });
    }
  }
  
  if (slides.length === 0) {
    const lines = text.split("\n").filter(l => l.trim());
    const maxSlideContent = 6;
    
    for (let i = 0; i < lines.length; i += maxSlideContent) {
      const chunk = lines.slice(i, i + maxSlideContent);
      slides.push({
        title: chunk[0]?.replace(/^[-*•\d.)\s]+/, "").trim() || `Diapositiva ${slides.length + 1}`,
        content: chunk.slice(1).map(l => l.replace(/^[-*•\d.)\s]+/, "").trim() || l),
      });
    }
    
    if (slides.length === 0) {
      slides.push({ title: "Presentación", content: [text.slice(0, 200)] });
    }
  }
  
  return slides;
}
