/**
 * Professional File Generator Service
 *
 * Centralized service for generating professional files (Excel, Word, PowerPoint, CSV, PDF)
 * used by the iliagpt.io skill system. Wraps lower-level document services with a unified,
 * fault-tolerant API that never throws.
 */

import {
  createExcelFromData,
  createMultiSheetExcel,
  AdvancedExcelBuilder,
  type SheetOptions,
} from "../advancedExcelBuilder";
import { generateProfessionalDocument } from "../docxCodeGenerator";
import { generateWordFromMarkdown } from "../markdownToDocx";
import {
  EnterpriseDocumentService,
  WordDocumentGenerator,
  ExcelDocumentGenerator,
  type DocumentRequest,
  type DocumentSection,
} from "../enterpriseDocumentService";
import { llmGateway } from "../../lib/llmGateway";
import PptxGenJS from "pptxgenjs";

// ============================================
// Interfaces
// ============================================

export interface StructuredData {
  title: string;
  sheets: Array<{
    name: string;
    headers: string[];
    rows: any[][];
    formulas?: boolean;
    charts?: boolean;
  }>;
  theme?: "professional" | "modern" | "minimal" | "vibrant";
  author?: string;
}

export interface DocumentContent {
  title: string;
  sections: Array<{
    heading: string;
    content: string; // markdown
    level?: number;
  }>;
  author?: string;
  date?: string;
  style?: "formal" | "modern" | "academic";
}

export interface SlideData {
  title: string;
  bullets?: string[];
  notes?: string;
  imagePrompt?: string;
}

export interface PresentationContent {
  title: string;
  subtitle?: string;
  author?: string;
  slides: SlideData[];
  theme?: string;
}

export interface FileResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

// ============================================
// Helpers
// ============================================

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 120)
    || "document";
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").substring(0, 14);
}

/**
 * Escape a single CSV field according to RFC 4180.
 */
function escapeCSVField(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ============================================
// ProfessionalFileGenerator
// ============================================

export class ProfessionalFileGenerator {
  private enterpriseService: EnterpriseDocumentService;

  constructor() {
    this.enterpriseService = new EnterpriseDocumentService("professional");
  }

  // ------------------------------------------
  // Excel
  // ------------------------------------------

  /**
   * Generate an Excel workbook.
   * Accepts either a full StructuredData object or a simple (headers, rows, options) signature
   * used by skill handlers.
   */
  async generateExcel(
    dataOrHeaders: StructuredData | string[],
    rows?: any[][],
    options?: { sheetName?: string; title?: string },
  ): Promise<FileResult | Buffer> {
    // Simple overload: (headers, rows, options) → returns Buffer for backward compat
    if (Array.isArray(dataOrHeaders) && typeof dataOrHeaders[0] === "string") {
      const headers = dataOrHeaders as string[];
      const structuredData: StructuredData = {
        title: options?.title || "Spreadsheet",
        sheets: [
          {
            name: options?.sheetName || "Sheet1",
            headers,
            rows: rows || [],
          },
        ],
        theme: "professional",
      };
      const result = await this._generateExcelCore(structuredData);
      return result.buffer;
    }
    // Full signature: (StructuredData) → returns FileResult
    return this._generateExcelCore(dataOrHeaders as StructuredData);
  }

  private async _generateExcelCore(data: StructuredData): Promise<FileResult> {
    try {
      const theme = data.theme || "professional";

      // Build sheets array for the multi-sheet helper, prepending headers to rows
      const sheetDefs = data.sheets.map((s) => {
        const combined: any[][] = [s.headers, ...s.rows];
        const opts: SheetOptions = {
          autoFormulas: s.formulas !== false,
          conditionalFormatting: true,
          autoColumnWidth: true,
          freezeHeader: true,
        };
        return { name: s.name, data: combined, options: opts };
      });

      // Use AdvancedExcelBuilder directly for maximum control
      const builder = new AdvancedExcelBuilder({ theme });
      builder.getWorkbook().creator = data.author || "ILIAGPT PRO";

      for (const def of sheetDefs) {
        builder.addSheet(def.name, def.data, def.options);
      }

      // Add a summary/stats sheet if there is meaningful numeric data
      if (sheetDefs.length > 0 && sheetDefs[0].data.length > 1) {
        try {
          builder.addSummarySheet(sheetDefs[0].name, sheetDefs[0].data);
        } catch {
          // Non-critical; skip summary sheet on error
        }
      }

      const buffer = await builder.build();
      const filename = `${sanitizeFilename(data.title)}_${timestamp()}.xlsx`;

      return {
        buffer,
        filename,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    } catch (primaryError) {
      console.warn(
        "[ProfessionalFileGenerator] Primary Excel generation failed, attempting fallback:",
        primaryError,
      );

      // Fallback: use the simpler createMultiSheetExcel factory
      try {
        const fallbackSheets = data.sheets.map((s) => ({
          name: s.name,
          data: [s.headers, ...s.rows] as any[][],
          options: {
            autoFormulas: s.formulas !== false,
            freezeHeader: true,
            autoColumnWidth: true,
          } as SheetOptions,
        }));

        const result = await createMultiSheetExcel(fallbackSheets, {
          title: data.title,
          theme: data.theme || "professional",
          includeSummary: true,
        });

        return {
          buffer: result.buffer,
          filename: result.filename,
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
      } catch (fallbackError) {
        console.warn(
          "[ProfessionalFileGenerator] Fallback Excel generation also failed:",
          fallbackError,
        );

        // Last resort: single-sheet simple export
        const firstSheet = data.sheets[0] || {
          headers: ["Data"],
          rows: [["No data available"]],
        };
        const result = await createExcelFromData(
          [firstSheet.headers, ...firstSheet.rows],
          { title: data.title, theme: data.theme || "professional" },
        );

        return {
          buffer: result.buffer,
          filename: result.filename,
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
      }
    }
  }

  // ------------------------------------------
  // Word
  // ------------------------------------------

  /**
   * Generate a Word document with professional formatting.
   *
   * Accepts either a full DocumentContent object or a simple (markdown, options) signature
   * used by skill handlers.
   *
   * Strategy:
   * 1. Try LLM-powered code generation via generateProfessionalDocument
   * 2. Fall back to EnterpriseDocumentService (WordDocumentGenerator)
   * 3. Last resort: markdown-to-docx conversion
   */
  async generateWord(
    contentOrMarkdown: DocumentContent | string,
    options?: { title?: string; locale?: string },
  ): Promise<FileResult | Buffer> {
    // Simple overload: (markdown, options) → returns Buffer for backward compat
    if (typeof contentOrMarkdown === "string") {
      const markdown = contentOrMarkdown;
      const title = options?.title || "Document";
      // Parse markdown into sections
      const sections: DocumentContent["sections"] = [];
      const lines = markdown.split("\n");
      let currentHeading = title;
      let currentContent: string[] = [];
      let currentLevel = 1;

      for (const line of lines) {
        const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
          if (currentContent.length > 0 || sections.length > 0) {
            sections.push({
              heading: currentHeading,
              content: currentContent.join("\n").trim(),
              level: currentLevel,
            });
          }
          currentLevel = headingMatch[1].length;
          currentHeading = headingMatch[2];
          currentContent = [];
        } else {
          currentContent.push(line);
        }
      }
      // Push last section
      if (currentContent.length > 0 || sections.length === 0) {
        sections.push({
          heading: currentHeading,
          content: currentContent.join("\n").trim(),
          level: currentLevel,
        });
      }

      const docContent: DocumentContent = {
        title,
        sections,
        style: "formal",
      };
      const result = await this._generateWordCore(docContent);
      return result.buffer;
    }
    return this._generateWordCore(contentOrMarkdown);
  }

  private async _generateWordCore(content: DocumentContent): Promise<FileResult> {
    const filename = `${sanitizeFilename(content.title)}_${timestamp()}.docx`;
    const mimeType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    // Build a full-text description for the LLM code generator
    const description = this.buildDocumentDescription(content);

    // Attempt 1: LLM-based code generation (highest quality, most flexible)
    try {
      const result = await generateProfessionalDocument(description, "informe");
      return { buffer: result.buffer, filename, mimeType };
    } catch (err) {
      console.warn(
        "[ProfessionalFileGenerator] LLM document generation failed, trying enterprise service:",
        err,
      );
    }

    // Attempt 2: Enterprise document service (template-based, reliable)
    try {
      const themeMap: Record<string, string> = {
        formal: "professional",
        modern: "modern",
        academic: "academic",
      };
      const themeName = themeMap[content.style || "formal"] || "professional";

      const sections: DocumentSection[] = content.sections.map((s, i) => ({
        id: `section-${i}`,
        title: s.heading,
        content: s.content,
        level: (s.level || 1) as 1 | 2 | 3,
      }));

      const request: DocumentRequest = {
        type: "docx",
        title: content.title,
        subtitle: content.date
          ? `${content.author || ""} - ${content.date}`.trim()
          : content.author,
        author: content.author,
        theme: themeName,
        sections,
        options: {
          includeTableOfContents: sections.length > 3,
          includePageNumbers: true,
          includeHeader: true,
          includeFooter: true,
        },
      };

      const service = new EnterpriseDocumentService(themeName);
      const result = await service.generateDocument(request);

      if (result.success && result.buffer) {
        return { buffer: result.buffer, filename, mimeType };
      }
      throw new Error(result.error || "Enterprise document generation failed");
    } catch (err) {
      console.warn(
        "[ProfessionalFileGenerator] Enterprise service failed, falling back to markdown conversion:",
        err,
      );
    }

    // Attempt 3: Markdown-to-DOCX (simplest, most reliable)
    try {
      const markdown = content.sections
        .map((s) => {
          const level = s.level || 1;
          const prefix = "#".repeat(Math.min(level, 6));
          return `${prefix} ${s.heading}\n\n${s.content}`;
        })
        .join("\n\n");

      const buffer = await generateWordFromMarkdown(content.title, markdown);
      return { buffer, filename, mimeType };
    } catch (err) {
      console.warn(
        "[ProfessionalFileGenerator] All Word generation methods failed:",
        err,
      );

      // Absolute last resort: return a minimal valid docx-like buffer
      // In practice generateWordFromMarkdown is extremely reliable, so this
      // path should almost never be reached.
      const fallbackMarkdown = `# ${content.title}\n\n${content.sections.map((s) => s.content).join("\n\n")}`;
      const buffer = await generateWordFromMarkdown(
        content.title,
        fallbackMarkdown,
      );
      return { buffer, filename, mimeType };
    }
  }

  // ------------------------------------------
  // PowerPoint
  // ------------------------------------------

  /**
   * Generate a PowerPoint presentation with professional corporate styling.
   * Accepts either PresentationContent or a simple (slides[], options) signature.
   */
  async generatePowerPoint(
    contentOrSlides: PresentationContent | SlideData[],
    options?: { title?: string },
  ): Promise<FileResult | Buffer> {
    // Simple overload: (slides[], options) → returns Buffer
    if (Array.isArray(contentOrSlides)) {
      const presentation: PresentationContent = {
        title: options?.title || "Presentation",
        slides: contentOrSlides,
      };
      const result = await this._generatePowerPointCore(presentation);
      return result.buffer;
    }
    return this._generatePowerPointCore(contentOrSlides);
  }

  private async _generatePowerPointCore(content: PresentationContent): Promise<FileResult> {
    const filename = `${sanitizeFilename(content.title)}_${timestamp()}.pptx`;
    const mimeType =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    try {
      const pptx = new PptxGenJS();

      // Metadata
      pptx.author = content.author || "ILIAGPT PRO";
      pptx.title = content.title;
      pptx.subject = content.subtitle || "";

      // Corporate blue/white theme colours
      const THEME = {
        primary: "1F4E79",
        secondary: "2B7A78",
        accent: "4472C4",
        bg: "FFFFFF",
        bgDark: "1F4E79",
        textDark: "1A202C",
        textLight: "FFFFFF",
        muted: "718096",
      };

      // Define a master slide layout
      pptx.defineSlideMaster({
        title: "CORPORATE",
        background: { color: THEME.bg },
        objects: [
          // Bottom accent bar
          {
            rect: {
              x: 0,
              y: "93%",
              w: "100%",
              h: "7%",
              fill: { color: THEME.bgDark },
            },
          },
        ],
      });

      // ------ Title Slide ------
      const titleSlide = pptx.addSlide({ masterName: "CORPORATE" });
      titleSlide.background = { color: THEME.bgDark };

      titleSlide.addText(content.title, {
        x: 0.8,
        y: 1.5,
        w: 8.4,
        h: 1.5,
        fontSize: 36,
        fontFace: "Calibri",
        color: THEME.textLight,
        bold: true,
        align: "left",
      });

      if (content.subtitle) {
        titleSlide.addText(content.subtitle, {
          x: 0.8,
          y: 3.2,
          w: 8.4,
          h: 0.8,
          fontSize: 18,
          fontFace: "Calibri",
          color: THEME.accent,
          align: "left",
        });
      }

      if (content.author) {
        titleSlide.addText(content.author, {
          x: 0.8,
          y: 4.2,
          w: 8.4,
          h: 0.5,
          fontSize: 14,
          fontFace: "Calibri",
          color: THEME.muted,
          align: "left",
        });
      }

      // ------ Content Slides ------
      const totalSlides = content.slides.length;
      content.slides.forEach((slideData, idx) => {
        const slide = pptx.addSlide({ masterName: "CORPORATE" });

        // Slide number in footer
        slide.addText(`${idx + 1} / ${totalSlides}`, {
          x: 8.5,
          y: "94%",
          w: 1.2,
          h: 0.3,
          fontSize: 9,
          fontFace: "Calibri",
          color: THEME.textLight,
          align: "right",
        });

        // Top accent line
        slide.addShape("rect" as any, {
          x: 0,
          y: 0,
          w: "100%",
          h: 0.06,
          fill: { color: THEME.accent },
        });

        // Slide title
        slide.addText(slideData.title, {
          x: 0.6,
          y: 0.3,
          w: 8.8,
          h: 0.8,
          fontSize: 26,
          fontFace: "Calibri",
          color: THEME.primary,
          bold: true,
          align: "left",
        });

        // Bullet content
        if (slideData.bullets && slideData.bullets.length > 0) {
          const bulletRows = slideData.bullets.map((bullet) => ({
            text: bullet,
            options: {
              fontSize: 16,
              fontFace: "Calibri" as const,
              color: THEME.textDark,
              bullet: { code: "2022" } as any,
              paraSpaceAfter: 8,
            },
          }));

          slide.addText(bulletRows, {
            x: 0.8,
            y: 1.4,
            w: 8.4,
            h: 3.8,
            valign: "top",
            lineSpacingMultiple: 1.3,
          });
        }

        // Speaker notes
        if (slideData.notes) {
          slide.addNotes(slideData.notes);
        }
      });

      // Generate buffer
      const arrayBuffer = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
      const buffer = Buffer.from(arrayBuffer);

      return { buffer, filename, mimeType };
    } catch (err) {
      console.warn(
        "[ProfessionalFileGenerator] PowerPoint generation failed:",
        err,
      );

      // Fallback: attempt via EnterpriseDocumentService
      try {
        const sections: DocumentSection[] = content.slides.map((s, i) => ({
          id: `slide-${i}`,
          title: s.title,
          content: s.bullets?.join("\n") || "",
          level: 1 as const,
        }));

        const request: DocumentRequest = {
          type: "pptx",
          title: content.title,
          subtitle: content.subtitle,
          author: content.author,
          sections,
        };

        const result = await this.enterpriseService.generateDocument(request);
        if (result.success && result.buffer) {
          return { buffer: result.buffer, filename, mimeType };
        }
      } catch (fallbackErr) {
        console.warn(
          "[ProfessionalFileGenerator] PowerPoint fallback also failed:",
          fallbackErr,
        );
      }

      // Absolute fallback: minimal pptx with just a title slide
      const minPptx = new PptxGenJS();
      minPptx.title = content.title;
      const slide = minPptx.addSlide();
      slide.addText(content.title, {
        x: 1,
        y: 2,
        w: 8,
        h: 2,
        fontSize: 32,
        bold: true,
        align: "center",
      });
      const minBuf = (await minPptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
      return { buffer: Buffer.from(minBuf), filename, mimeType };
    }
  }

  // ------------------------------------------
  // CSV
  // ------------------------------------------

  /**
   * Generate a CSV file with proper escaping and BOM for Excel compatibility.
   * Accepts either a structured object or a raw CSV string (for backward compat).
   */
  async generateCSV(
    dataOrString:
      | { headers: string[]; rows: any[][]; title?: string }
      | string,
  ): Promise<FileResult | Buffer> {
    // Simple overload: raw CSV string → returns Buffer
    if (typeof dataOrString === "string") {
      const csvContent = dataOrString;
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const body = Buffer.from(csvContent, "utf-8");
      return Buffer.concat([bom, body]);
    }
    return this._generateCSVCore(dataOrString);
  }

  private async _generateCSVCore(data: {
    headers: string[];
    rows: any[][];
    title?: string;
  }): Promise<FileResult> {
    try {
      const lines: string[] = [];

      // Header row
      lines.push(data.headers.map(escapeCSVField).join(","));

      // Data rows
      for (const row of data.rows) {
        lines.push(row.map(escapeCSVField).join(","));
      }

      const csvContent = lines.join("\r\n");
      // UTF-8 BOM for Excel compatibility
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const body = Buffer.from(csvContent, "utf-8");
      const buffer = Buffer.concat([bom, body]);

      const title = data.title || "data";
      const filename = `${sanitizeFilename(title)}_${timestamp()}.csv`;

      return {
        buffer,
        filename,
        mimeType: "text/csv; charset=utf-8",
      };
    } catch (err) {
      console.warn("[ProfessionalFileGenerator] CSV generation failed:", err);

      // Fallback: return headers only
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const headerLine = (data.headers || ["Error"]).join(",");
      const buffer = Buffer.concat([bom, Buffer.from(headerLine, "utf-8")]);

      return {
        buffer,
        filename: `export_${timestamp()}.csv`,
        mimeType: "text/csv; charset=utf-8",
      };
    }
  }

  // ------------------------------------------
  // LLM-powered data generation from prompt
  // ------------------------------------------

  /**
   * Generate structured data from a natural language prompt using the LLM gateway.
   * Returns typed data suitable for passing into generateExcel, generateWord, etc.
   */
  async generateDataFromPrompt(
    prompt: string,
    type: "excel" | "word" | "ppt" | "csv",
  ): Promise<StructuredData | DocumentContent | PresentationContent> {
    const schemaInstructions = this.getSchemaInstructions(type);

    try {
      const response = await llmGateway.chat(
        [
          {
            role: "system",
            content: `You are a professional data generator. Given a user prompt, generate structured JSON data that can be used to create a ${type.toUpperCase()} file.

${schemaInstructions}

IMPORTANT:
- Return ONLY valid JSON, no markdown fences, no extra text.
- Generate realistic, professional content appropriate for a business document.
- Use clear, descriptive headers and section titles.
- Include enough data to make the document look substantial (at least 5-10 rows for spreadsheets, 3-5 sections for documents).
- All text content should be in the same language as the user's prompt.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        {
          temperature: 0.7,
          maxTokens: 4096,
        },
      );

      const content = response.content.trim();

      // Strip potential markdown code fences
      const jsonStr = content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();

      const parsed = JSON.parse(jsonStr);
      return this.validateAndNormalize(parsed, type);
    } catch (err) {
      console.warn(
        "[ProfessionalFileGenerator] LLM data generation failed, returning fallback:",
        err,
      );

      return this.getFallbackData(prompt, type);
    }
  }

  // ============================================
  // Private helpers
  // ============================================

  /**
   * Build a text description from DocumentContent for the LLM code generator.
   */
  private buildDocumentDescription(content: DocumentContent): string {
    const parts: string[] = [];
    parts.push(`Title: ${content.title}`);
    if (content.author) parts.push(`Author: ${content.author}`);
    if (content.date) parts.push(`Date: ${content.date}`);
    if (content.style) parts.push(`Style: ${content.style}`);
    parts.push("");
    for (const section of content.sections) {
      const hashes = "#".repeat(section.level || 1);
      parts.push(`${hashes} ${section.heading}`);
      parts.push(section.content);
      parts.push("");
    }
    return parts.join("\n");
  }

  /**
   * Return JSON schema instructions for each output type.
   */
  private getSchemaInstructions(type: string): string {
    switch (type) {
      case "excel":
        return `Return JSON matching this schema:
{
  "title": "string - spreadsheet title",
  "sheets": [
    {
      "name": "string - sheet tab name",
      "headers": ["string array of column headers"],
      "rows": [["array of arrays with cell values (strings, numbers)"]],
      "formulas": true/false,
      "charts": true/false
    }
  ],
  "theme": "professional" | "modern" | "minimal" | "vibrant",
  "author": "optional string"
}`;

      case "word":
        return `Return JSON matching this schema:
{
  "title": "string - document title",
  "sections": [
    {
      "heading": "string - section heading",
      "content": "string - section content in markdown format",
      "level": 1-3 (heading level)
    }
  ],
  "author": "optional string",
  "date": "optional date string",
  "style": "formal" | "modern" | "academic"
}`;

      case "ppt":
        return `Return JSON matching this schema:
{
  "title": "string - presentation title",
  "subtitle": "optional string",
  "author": "optional string",
  "slides": [
    {
      "title": "string - slide title",
      "bullets": ["array of bullet point strings"],
      "notes": "optional speaker notes"
    }
  ],
  "theme": "optional theme name"
}`;

      case "csv":
        return `Return JSON matching this schema:
{
  "title": "string - file title",
  "sheets": [
    {
      "name": "Data",
      "headers": ["string array of column headers"],
      "rows": [["array of arrays with cell values"]]
    }
  ]
}`;

      default:
        return "Return structured JSON appropriate for the requested file type.";
    }
  }

  /**
   * Validate and normalize parsed LLM output into the correct type.
   */
  private validateAndNormalize(
    data: any,
    type: string,
  ): StructuredData | DocumentContent | PresentationContent {
    switch (type) {
      case "excel":
      case "csv": {
        const result: StructuredData = {
          title: String(data.title || "Spreadsheet"),
          sheets: [],
          theme: data.theme || "professional",
          author: data.author,
        };

        const sheets = Array.isArray(data.sheets) ? data.sheets : [];
        for (const sheet of sheets) {
          result.sheets.push({
            name: String(sheet.name || "Sheet"),
            headers: Array.isArray(sheet.headers) ? sheet.headers.map(String) : ["Column A"],
            rows: Array.isArray(sheet.rows) ? sheet.rows : [],
            formulas: sheet.formulas === true,
            charts: sheet.charts === true,
          });
        }

        if (result.sheets.length === 0) {
          result.sheets.push({
            name: "Data",
            headers: ["Item", "Value"],
            rows: [["No data", ""]],
          });
        }

        return result;
      }

      case "word": {
        const result: DocumentContent = {
          title: String(data.title || "Document"),
          sections: [],
          author: data.author,
          date: data.date,
          style: data.style || "formal",
        };

        const sections = Array.isArray(data.sections) ? data.sections : [];
        for (const section of sections) {
          result.sections.push({
            heading: String(section.heading || "Section"),
            content: String(section.content || ""),
            level: typeof section.level === "number" ? section.level : 1,
          });
        }

        if (result.sections.length === 0) {
          result.sections.push({
            heading: "Content",
            content: "No content generated.",
            level: 1,
          });
        }

        return result;
      }

      case "ppt": {
        const result: PresentationContent = {
          title: String(data.title || "Presentation"),
          subtitle: data.subtitle,
          author: data.author,
          slides: [],
          theme: data.theme,
        };

        const slides = Array.isArray(data.slides) ? data.slides : [];
        for (const slide of slides) {
          result.slides.push({
            title: String(slide.title || "Slide"),
            bullets: Array.isArray(slide.bullets) ? slide.bullets.map(String) : undefined,
            notes: slide.notes ? String(slide.notes) : undefined,
            imagePrompt: slide.imagePrompt ? String(slide.imagePrompt) : undefined,
          });
        }

        if (result.slides.length === 0) {
          result.slides.push({
            title: data.title || "Slide 1",
            bullets: ["No content generated"],
          });
        }

        return result;
      }

      default:
        return data;
    }
  }

  /**
   * Return minimal fallback data when LLM generation fails.
   */
  private getFallbackData(
    prompt: string,
    type: string,
  ): StructuredData | DocumentContent | PresentationContent {
    const truncatedPrompt = prompt.substring(0, 200);

    switch (type) {
      case "excel":
      case "csv":
        return {
          title: "Generated Data",
          sheets: [
            {
              name: "Data",
              headers: ["Item", "Description", "Value"],
              rows: [
                ["1", `Generated from: ${truncatedPrompt}`, "N/A"],
              ],
            },
          ],
          theme: "professional" as const,
        };

      case "word":
        return {
          title: "Generated Document",
          sections: [
            {
              heading: "Overview",
              content: `This document was generated based on the following request:\n\n> ${truncatedPrompt}\n\nPlease provide more details for a complete document.`,
              level: 1,
            },
          ],
          style: "formal" as const,
        };

      case "ppt":
        return {
          title: "Generated Presentation",
          slides: [
            {
              title: "Overview",
              bullets: [
                `Generated from: ${truncatedPrompt}`,
                "Please provide more details for complete slides.",
              ],
            },
          ],
        };

      default:
        return {
          title: "Generated Data",
          sheets: [
            {
              name: "Data",
              headers: ["Content"],
              rows: [[truncatedPrompt]],
            },
          ],
        };
    }
  }
}

// ============================================
// Singleton export
// ============================================

export const professionalFileGenerator = new ProfessionalFileGenerator();
