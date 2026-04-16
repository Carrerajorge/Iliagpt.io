/**
 * Document Compiler — Single entry point for all document generation.
 *
 * Architecture:
 *   Input (spec or raw text) → Preflight Validation → Sanitization →
 *   LayoutEngine → DocumentEngine render → Graceful Degradation →
 *   Output (Buffer + metadata)
 *
 * All Word/Excel/PowerPoint generation must go through this compiler.
 * It wraps DocumentEngine with:
 *   - Design token resolution (theme presets or custom)
 *   - Preflight validation (fonts, colors, content limits, UTF-8)
 *   - Graceful degradation (fallback to safe minimal documents)
 *   - Observability (structured logging with timing/size metrics)
 */

import {
  DocumentEngine,
  DesignTokensSchema,
  type DesignTokens,
  type PresentationSpec,
  type DocumentSpec,
  type WorkbookSpec,
  type LayoutBox,
  LayoutEngine,
} from "./documentEngine";
import {
  PresentationValidator,
  DocumentValidator,
  WorkbookValidator,
  type ValidationResult,
  type ValidationIssue,
} from "./documentValidators";
import { resolveTheme } from "./themes";
import {
  markdownToDocSpec,
  csvToWorkbookSpec,
  jsonToPresentationSpec,
} from "./textToSpec";
import { createPptxDocument } from "../../services/documentGeneration";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

export type CompilerFormat = "pptx" | "docx" | "xlsx";
export type CompilerInputSpec = PresentationSpec | DocumentSpec | WorkbookSpec;

export interface CompilerInput {
  format: CompilerFormat;
  spec: CompilerInputSpec;
  theme?: string | Partial<DesignTokens>;
}

export interface CompilerTextInput {
  format: CompilerFormat;
  title: string;
  content: string;
  theme?: string | Partial<DesignTokens>;
}

export interface CompilerOutput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  format: CompilerFormat;
  validation: ValidationResult;
  metrics: {
    durationMs: number;
    sizeBytes: number;
    degraded: boolean;
  };
}

/* ================================================================== */
/*  SECURITY / LIMIT CONSTANTS                                         */
/* ================================================================== */

const LIMITS = {
  pptx: { maxSlides: 200, maxTitleLength: 500, maxBulletLength: 5000, maxTotalSize: 10 * 1024 * 1024 },
  docx: { maxSections: 500, maxContentSize: 5 * 1024 * 1024 },
  xlsx: { maxRows: 100_000, maxColumns: 500, maxCellLength: 32_767, maxSheets: 100 },
  maxOutputBytes: 50 * 1024 * 1024, // 50MB hard cap on generated file size
  maxAutoRepairIterations: 3, // cap suffix loop in auto-repair
  compileTimeoutMs: 30_000, // 30s hard timeout per compilation
} as const;

/** Race a promise against a timeout; rejects with a clear message on expiry. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Structured-clone safe deep copy (avoids in-place mutation of caller's spec). */
function deepCloneSpec<T>(obj: T): T {
  try {
    return structuredClone(obj);
  } catch {
    // Fallback for environments without structuredClone
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (jsonErr) {
      console.warn(`[DocumentCompiler] deepClone JSON fallback failed: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`);
      // Last resort: return shallow copy (better than crashing)
      return { ...obj } as T;
    }
  }
}

const MIME_TYPES: Record<CompilerFormat, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/* ================================================================== */
/*  SANITIZATION HELPERS                                               */
/* ================================================================== */

function sanitizeText(text: string): string {
  return text
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function normalizeColor(color: string): string {
  if (!color) return "#000000";
  let c = color.trim();
  if (!c.startsWith("#") && /^[0-9a-fA-F]{6}$/.test(c)) c = "#" + c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) return "#000000";
  return c;
}

function sanitizeFilename(title: string): string {
  const cleaned = title
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF _-]/g, "_") // allow Latin extended + accented chars
    .replace(/_+/g, "_")
    .trim();

  if (!cleaned) return "document";

  // UTF-8 safe truncation: use TextEncoder to count bytes, not chars
  const encoder = new TextEncoder();
  let result = cleaned;
  let iterations = 0;
  while (encoder.encode(result).length > 200 && iterations++ < 500) {
    // Remove last character until within 200 bytes
    result = result.slice(0, -1);
  }
  // Ensure we don't end mid-character and trim trailing underscores
  return result.replace(/_+$/, "").trim() || "document";
}

/* ================================================================== */
/*  DOCUMENT COMPILER                                                  */
/* ================================================================== */

export class DocumentCompiler {
  private engine: DocumentEngine;
  private tokens: DesignTokens;
  private validators: {
    pptx: PresentationValidator;
    docx: DocumentValidator;
    xlsx: WorkbookValidator;
  };

  constructor(defaultTheme?: string | Partial<DesignTokens>) {
    this.tokens = resolveTheme(defaultTheme);
    this.engine = new DocumentEngine(this.tokens);
    this.validators = {
      pptx: new PresentationValidator({
        slideWidth: this.tokens.layout.slideWidth,
        slideHeight: this.tokens.layout.slideHeight,
        minFontSize: this.tokens.font.sizeMin,
      }),
      docx: new DocumentValidator(),
      xlsx: new WorkbookValidator(),
    };
  }

  /* ---------------------------------------------------------------- */
  /*  MAIN API: compile from spec                                     */
  /* ---------------------------------------------------------------- */

  async compile(input: CompilerInput): Promise<CompilerOutput> {
    const start = Date.now();
    const theme = input.theme ? resolveTheme(input.theme) : this.tokens;
    const engine = input.theme ? new DocumentEngine(theme) : this.engine;
    let degraded = false;

    // 1. Preflight validation (wrapped to never throw)
    let validation: ValidationResult;
    try {
      validation = this.preflight(input);
    } catch (preflightErr) {
      console.warn(`[DocumentCompiler] Preflight threw, treating as valid: ${preflightErr instanceof Error ? preflightErr.message : String(preflightErr)}`);
      validation = {
        valid: true,
        format: input.format,
        issueCount: 1,
        errors: 0,
        warnings: 1,
        issues: [{
          severity: "warning",
          code: "COMPILER_PREFLIGHT_ERROR",
          message: `Preflight threw: ${preflightErr instanceof Error ? preflightErr.message : String(preflightErr)}`,
        }],
        metadata: {},
      };
    }

    // Ensure validation.issues is always an array
    if (!Array.isArray(validation.issues)) validation.issues = [];

    // 2. If validation errors, attempt auto-repair
    let spec = input.spec;
    if (!validation.valid) {
      const repaired = this.autoRepair(input, validation);
      if (repaired) {
        spec = repaired;
        validation.valid = true;
        validation.issues.push({
          severity: "info",
          code: "COMPILER_AUTO_REPAIRED",
          message: "Spec was auto-repaired to fix validation errors",
        });
      }
    }

    // 3. Render (with timeout protection)
    let buffer: Buffer;
    let filename: string;

    try {
      const renderPromise = (async () => {
        let buf: Buffer;
        let fname: string;
        switch (input.format) {
          case "pptx": {
            const pptSpec = { ...spec as PresentationSpec, theme };
            buf = await engine.generatePresentation(pptSpec);
            fname = sanitizeFilename((spec as PresentationSpec).title) + ".pptx";
            break;
          }
          case "docx": {
            const docSpec = { ...spec as DocumentSpec, theme };
            buf = await engine.generateDocument(docSpec);
            fname = sanitizeFilename((spec as DocumentSpec).title) + ".docx";
            break;
          }
          case "xlsx": {
            const xlsSpec = { ...spec as WorkbookSpec, theme };
            buf = await engine.generateWorkbook(xlsSpec);
            fname = sanitizeFilename((spec as WorkbookSpec).title) + ".xlsx";
            break;
          }
        }
        // Exhaustiveness guard — all 3 cases must assign buf/fname
        if (!buf! || !fname!) throw new Error(`Unsupported format: ${input.format}`);
        return { buf: buf!, fname: fname! };
      })();

      const result = await withTimeout(renderPromise, LIMITS.compileTimeoutMs, `${input.format} render`);
      buffer = result.buf;
      filename = result.fname;
    } catch (err) {
      // Graceful degradation: produce a minimal valid file
      console.warn(`[DocumentCompiler] Render failed, using fallback: ${err instanceof Error ? err.message : String(err)}`);
      const fallback = await this.generateFallback(input.format, spec, err);
      buffer = fallback.buffer;
      filename = fallback.filename;
      degraded = true;
      validation.issues.push({
        severity: "warning",
        code: "COMPILER_FALLBACK",
        message: `Render failed, used fallback: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 4. Output size guard
    if (buffer! && buffer!.length > LIMITS.maxOutputBytes) {
      console.warn(`[DocumentCompiler] Output exceeds max size (${buffer!.length} > ${LIMITS.maxOutputBytes}), using fallback`);
      const fallback = await this.generateFallback(input.format, spec, new Error("Output too large"));
      buffer = fallback.buffer;
      filename = fallback.filename;
      degraded = true;
      validation.issues.push({
        severity: "warning",
        code: "COMPILER_OUTPUT_TOO_LARGE",
        message: `Output was ${(buffer!.length / 1024 / 1024).toFixed(1)}MB, exceeded ${LIMITS.maxOutputBytes / 1024 / 1024}MB limit`,
      });
    }

    const output: CompilerOutput = {
      buffer: buffer!,
      filename: filename!,
      mimeType: MIME_TYPES[input.format],
      format: input.format,
      validation,
      metrics: {
        durationMs: Date.now() - start,
        sizeBytes: buffer!.length,
        degraded,
      },
    };

    // Observability
    this.logCompilation(output, input);

    return output;
  }

  /* ---------------------------------------------------------------- */
  /*  CONVENIENCE: compile from raw text                              */
  /* ---------------------------------------------------------------- */

  async compileFromText(input: CompilerTextInput): Promise<CompilerOutput> {
    // Cap raw content size before processing to prevent DoS
    const MAX_RAW_CONTENT = 10 * 1024 * 1024; // 10MB
    const content = input.content.length > MAX_RAW_CONTENT
      ? input.content.substring(0, MAX_RAW_CONTENT)
      : input.content;
    const title = input.title.length > 500
      ? input.title.substring(0, 500)
      : input.title;

    let spec: CompilerInputSpec;

    switch (input.format) {
      case "docx":
        spec = markdownToDocSpec(title, content);
        break;
      case "xlsx":
        spec = csvToWorkbookSpec(title, content);
        break;
      case "pptx":
        spec = jsonToPresentationSpec(title, content);
        break;
    }

    return this.compile({ format: input.format, spec, theme: input.theme });
  }

  /* ---------------------------------------------------------------- */
  /*  PREFLIGHT VALIDATION                                            */
  /* ---------------------------------------------------------------- */

  private preflight(input: CompilerInput): ValidationResult {
    // Structural validation via existing validators
    // Cast to `any` because Zod's `.default()` makes fields optional at the TS level
    // but they are always populated at runtime after `.parse()`.
    switch (input.format) {
      case "pptx":
        return this.validators.pptx.validateSpec(input.spec as any);
      case "docx":
        return this.validators.docx.validateSpec(input.spec as any);
      case "xlsx":
        return this.validators.xlsx.validateSpec(input.spec as any);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  AUTO-REPAIR                                                     */
  /* ---------------------------------------------------------------- */

  private autoRepair(input: CompilerInput, validation: ValidationResult): CompilerInputSpec | null {
    const errors = validation.issues.filter(i => i.severity === "error");
    if (errors.length === 0) return null;

    try {
      // Deep clone to avoid corrupting the caller's spec on partial repair failure
      const cloned = deepCloneSpec(input.spec);

      switch (input.format) {
        case "pptx": {
          const spec = cloned as PresentationSpec;
          if (!Array.isArray(spec.slides)) return null;
          // Fix out-of-canvas by clamping positions
          for (const slide of spec.slides) {
            if (!slide || !Array.isArray(slide.components)) continue;
            for (const comp of slide.components) {
              if (!comp || typeof comp !== "object") continue;
              if (comp.position && typeof comp.position === "object") {
                const p = comp.position;
                if (p.x !== undefined) p.x = Math.min(p.x, this.tokens.layout.slideWidth - 0.5);
                if (p.y !== undefined) p.y = Math.min(p.y, this.tokens.layout.slideHeight - 0.5);
                if (p.w !== undefined) {
                  p.w = Math.min(p.w, this.tokens.layout.slideWidth - (p.x || 0));
                }
                if (p.h !== undefined) {
                  p.h = Math.min(p.h, this.tokens.layout.slideHeight - (p.y || 0));
                }
              }
            }
          }
          return spec;
        }

        case "docx": {
          const spec = cloned as DocumentSpec;
          // Fix table column mismatches by padding/trimming rows
          for (const section of spec.sections) {
            if (section.type === "table" && Array.isArray(section.content) && section.content.length > 1) {
              const headerLen = Array.isArray(section.content[0]) ? section.content[0].length : 0;
              for (let r = 1; r < section.content.length; r++) {
                const row = section.content[r];
                if (Array.isArray(row)) {
                  while (row.length < headerLen) row.push("");
                  if (row.length > headerLen) section.content[r] = row.slice(0, headerLen);
                }
              }
            }
          }
          return spec;
        }

        case "xlsx": {
          const spec = cloned as WorkbookSpec;
          // Fix duplicate sheet names (capped iterations to prevent infinite loop)
          const names = new Set<string>();
          for (const sheet of spec.sheets) {
            let name = sheet.name.substring(0, 31);
            let suffix = 1;
            const maxSuffix = LIMITS.maxAutoRepairIterations * 100;
            while (names.has(name) && suffix <= maxSuffix) {
              name = `${sheet.name.substring(0, 28)}_${suffix++}`;
            }
            // If still colliding after max iterations, append unique suffix
            if (names.has(name)) {
              name = `${sheet.name.substring(0, 22)}_${Date.now() % 100000}`;
            }
            sheet.name = name;
            names.add(name);
          }
          return spec;
        }
      }
    } catch (repairErr) {
      console.warn(`[DocumentCompiler] Auto-repair failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`);
      return null;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  GRACEFUL DEGRADATION — FALLBACK FILE GENERATION                 */
  /* ---------------------------------------------------------------- */

  private async generateFallback(
    format: CompilerFormat,
    spec: CompilerInputSpec,
    error: unknown
  ): Promise<{ buffer: Buffer; filename: string }> {
    const title = (spec as any).title || "Document";
    // Sanitize error message: strip file paths to prevent information disclosure
    const rawMsg = error instanceof Error ? error.message : String(error);
    const errMsg = rawMsg.replace(/\/[a-zA-Z0-9_./-]+/g, "[PATH]").substring(0, 500);
    const safeTitle = sanitizeFilename(title);

    try {
      switch (format) {
        case "pptx": {
          const pptx = createPptxDocument();
          pptx.title = title;
          pptx.author = "IliaGPT";

          const slide = pptx.addSlide();
          slide.addText(title, {
            x: 0.5, y: 1.5, w: 9, h: 1.5,
            fontSize: 36, bold: true, color: "363636",
            align: "center", fontFace: "Arial",
          });
          slide.addText("Document generated with fallback mode", {
            x: 0.5, y: 3.5, w: 9, h: 0.5,
            fontSize: 14, color: "999999",
            align: "center", fontFace: "Arial", italic: true,
          });

          const data = await pptx.write({ outputType: "nodebuffer" });
          return { buffer: Buffer.from(data as ArrayBuffer), filename: `${safeTitle}.pptx` };
        }

        case "docx": {
          const { Document, Paragraph, TextRun, Packer, HeadingLevel } = await import("docx");
          const doc = new Document({
            sections: [{
              children: [
                new Paragraph({
                  text: title,
                  heading: HeadingLevel.TITLE,
                }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "This document was generated in fallback mode due to a processing issue.",
                      italics: true,
                      color: "999999",
                    }),
                  ],
                }),
              ],
            }],
          });
          const buffer = await Packer.toBuffer(doc);
          return { buffer, filename: `${safeTitle}.docx` };
        }

        case "xlsx": {
          try {
            const excelMod = await import("exceljs");
            const ExcelJS = (excelMod as any).default || excelMod;
            const workbook = new ExcelJS.Workbook();
            workbook.creator = "IliaGPT";
            const sheet = workbook.addWorksheet("Sheet1");
            sheet.columns = [{ header: "Info", key: "info", width: 50 }];
            sheet.addRow({ info: title });
            sheet.addRow({ info: "Generated in fallback mode" });
            const buf = Buffer.from(await workbook.xlsx.writeBuffer());
            return { buffer: buf, filename: `${safeTitle}.xlsx` };
          } catch (xlsxErr) {
            console.error(`[DocumentCompiler] XLSX fallback import failed: ${xlsxErr instanceof Error ? xlsxErr.message : String(xlsxErr)}`);
            return { buffer: Buffer.from(""), filename: `${safeTitle}.xlsx` };
          }
        }
      }
    } catch (fallbackError) {
      // If even the fallback fails, return a minimal buffer
      console.error(`[DocumentCompiler] Even fallback generation failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
      return {
        buffer: Buffer.from("Fallback generation failed"),
        filename: `${safeTitle}.${format}`,
      };
    }
  }

  /* ---------------------------------------------------------------- */
  /*  OBSERVABILITY                                                    */
  /* ---------------------------------------------------------------- */

  private logCompilation(output: CompilerOutput, input: CompilerInput): void {
    const logEntry = {
      event: "document_compiled",
      format: output.format,
      theme: typeof input.theme === "string" ? input.theme : (input.theme as any)?.name || "default",
      durationMs: output.metrics.durationMs,
      sizeBytes: output.metrics.sizeBytes,
      degraded: output.metrics.degraded,
      validationErrors: output.validation.errors,
      validationWarnings: output.validation.warnings,
      filename: output.filename,
    };
    console.log(`[DocumentCompiler] ${JSON.stringify(logEntry)}`);
  }
}

/* ================================================================== */
/*  SINGLETON (convenience)                                            */
/* ================================================================== */

let _defaultCompiler: DocumentCompiler | null = null;

export function getDefaultCompiler(): DocumentCompiler {
  if (!_defaultCompiler) {
    _defaultCompiler = new DocumentCompiler("corporate");
  }
  return _defaultCompiler;
}
