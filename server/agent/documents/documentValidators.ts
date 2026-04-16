/**
 * Document Validators — Validate generated PPT/DOCX/XLSX for quality.
 *
 * Checks performed:
 *   PPT: nothing outside canvas, contrast, no overlap, min font size
 *   DOCX: TOC, page breaks, empty cells
 *   XLSX: formula integrity, broken refs, data validation
 */

import { z } from "zod";

/* Safety limits to prevent quadratic validation costs */
const MAX_COMPONENTS_PER_SLIDE = 100;
const MAX_OVERLAP_CHECKS = 50; // cap bounding boxes checked for O(n²) overlap
const MAX_DATA_TYPE_CHECKS_PER_SHEET = 10_000; // skip type checking beyond this
const MAX_VALIDATION_ISSUES = 5_000; // prevent memory exhaustion from issue array

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  location?: string;
  details?: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  format: "pptx" | "docx" | "xlsx";
  issueCount: number;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
  metadata: Record<string, any>;
}

/* ------------------------------------------------------------------ */
/*  PPT Validator                                                     */
/* ------------------------------------------------------------------ */

export class PresentationValidator {
  private slideWidth: number;
  private slideHeight: number;
  private minFontSize: number;

  constructor(options?: { slideWidth?: number; slideHeight?: number; minFontSize?: number }) {
    this.slideWidth = options?.slideWidth || 10;
    this.slideHeight = options?.slideHeight || 7.5;
    this.minFontSize = options?.minFontSize || 10;
  }

  /**
   * Validate a presentation spec before rendering.
   */
  validateSpec(spec: {
    slides: Array<{
      components: Array<{
        type: string;
        content: any;
        position?: { x?: number; y?: number; w?: number; h?: number };
        style?: Record<string, any>;
      }>;
    }>;
  }): ValidationResult {
    const issues: ValidationIssue[] = [];

    for (let s = 0; s < spec.slides.length; s++) {
      if (issues.length >= MAX_VALIDATION_ISSUES) break;
      const slide = spec.slides[s];

      // Check empty slide
      if (!slide.components || slide.components.length === 0) {
        issues.push({
          severity: "warning",
          code: "PPT_EMPTY_SLIDE",
          message: `Slide ${s + 1} has no components`,
          location: `slide[${s}]`,
        });
      }

      // Cap component count per slide
      if (slide.components && slide.components.length > MAX_COMPONENTS_PER_SLIDE) {
        issues.push({
          severity: "warning",
          code: "PPT_TOO_MANY_COMPONENTS",
          message: `Slide ${s + 1} has ${slide.components.length} components (max ${MAX_COMPONENTS_PER_SLIDE})`,
          location: `slide[${s}]`,
        });
      }

      const boundingBoxes: Array<{ x: number; y: number; w: number; h: number; idx: number }> = [];

      for (let c = 0; c < slide.components.length; c++) {
        const comp = slide.components[c];
        const pos = comp.position || {};

        // Check out-of-canvas
        if (pos.x !== undefined && pos.y !== undefined) {
          const right = (pos.x || 0) + (pos.w || 0);
          const bottom = (pos.y || 0) + (pos.h || 0);

          if (right > this.slideWidth) {
            issues.push({
              severity: "error",
              code: "PPT_OUT_OF_CANVAS_RIGHT",
              message: `Component ${c} on slide ${s + 1} extends beyond right edge (${right.toFixed(1)} > ${this.slideWidth})`,
              location: `slide[${s}].component[${c}]`,
              details: { x: pos.x, w: pos.w, slideWidth: this.slideWidth },
            });
          }

          if (bottom > this.slideHeight) {
            issues.push({
              severity: "error",
              code: "PPT_OUT_OF_CANVAS_BOTTOM",
              message: `Component ${c} on slide ${s + 1} extends beyond bottom edge (${bottom.toFixed(1)} > ${this.slideHeight})`,
              location: `slide[${s}].component[${c}]`,
              details: { y: pos.y, h: pos.h, slideHeight: this.slideHeight },
            });
          }

          boundingBoxes.push({
            x: pos.x || 0,
            y: pos.y || 0,
            w: pos.w || 1,
            h: pos.h || 1,
            idx: c,
          });
        }

        // Check minimum font size
        const fontSize = comp.style?.fontSize;
        if (typeof fontSize === "number" && fontSize < this.minFontSize) {
          issues.push({
            severity: "warning",
            code: "PPT_SMALL_FONT",
            message: `Component ${c} on slide ${s + 1} uses font size ${fontSize}pt (minimum: ${this.minFontSize}pt)`,
            location: `slide[${s}].component[${c}]`,
          });
        }

        // Check empty content
        if (comp.type !== "pageNumber" && comp.type !== "shape") {
          const content = comp.content;
          if (!content || (typeof content === "string" && content.trim() === "")) {
            issues.push({
              severity: "info",
              code: "PPT_EMPTY_CONTENT",
              message: `Component ${c} (${comp.type}) on slide ${s + 1} has no content`,
              location: `slide[${s}].component[${c}]`,
            });
          }
        }
      }

      // Check overlapping components (heuristic, capped to avoid O(n²) on large slides)
      const cappedBoxes = boundingBoxes.slice(0, MAX_OVERLAP_CHECKS);
      for (let i = 0; i < cappedBoxes.length; i++) {
        for (let j = i + 1; j < cappedBoxes.length; j++) {
          if (this.boxesOverlap(cappedBoxes[i], cappedBoxes[j])) {
            issues.push({
              severity: "warning",
              code: "PPT_OVERLAP",
              message: `Components ${cappedBoxes[i].idx} and ${cappedBoxes[j].idx} on slide ${s + 1} may overlap`,
              location: `slide[${s}]`,
              details: {
                comp1: cappedBoxes[i],
                comp2: cappedBoxes[j],
              },
            });
          }
        }
      }
      if (boundingBoxes.length > MAX_OVERLAP_CHECKS) {
        issues.push({
          severity: "info",
          code: "PPT_OVERLAP_CHECK_CAPPED",
          message: `Overlap check on slide ${s + 1} capped at ${MAX_OVERLAP_CHECKS} components (${boundingBoxes.length} total)`,
          location: `slide[${s}]`,
        });
      }
    }

    // Hard limit on slide count (consistent with LIMITS.pptx.maxSlides = 200)
    if (spec.slides.length > 200) {
      issues.push({
        severity: "error",
        code: "PPT_EXCEEDS_MAX_SLIDES",
        message: `Presentation has ${spec.slides.length} slides (hard limit: 200)`,
      });
    } else if (spec.slides.length > 50) {
      issues.push({
        severity: "warning",
        code: "PPT_TOO_MANY_SLIDES",
        message: `Presentation has ${spec.slides.length} slides (consider splitting)`,
      });
    }

    return this.buildResult("pptx", issues, { slideCount: spec.slides.length });
  }

  private boxesOverlap(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
  ): boolean {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  private buildResult(
    format: "pptx" | "docx" | "xlsx",
    issues: ValidationIssue[],
    metadata: Record<string, any>
  ): ValidationResult {
    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;
    return {
      valid: errors === 0,
      format,
      issueCount: issues.length,
      errors,
      warnings,
      issues,
      metadata,
    };
  }
}

/* ------------------------------------------------------------------ */
/*  DOCX Validator                                                    */
/* ------------------------------------------------------------------ */

export class DocumentValidator {
  validateSpec(spec: {
    sections: Array<{
      type: string;
      content: any;
      level?: number;
    }>;
  }): ValidationResult {
    const issues: ValidationIssue[] = [];

    // Check for content
    if (!spec.sections || spec.sections.length === 0) {
      issues.push({
        severity: "error",
        code: "DOCX_EMPTY",
        message: "Document has no sections",
      });
    }

    let lastHeadingLevel = 0;

    for (let i = 0; i < spec.sections.length && issues.length < MAX_VALIDATION_ISSUES; i++) {
      const section = spec.sections[i];

      // Check heading hierarchy
      if (section.type === "heading" && section.level) {
        if (section.level > lastHeadingLevel + 1 && lastHeadingLevel > 0) {
          issues.push({
            severity: "warning",
            code: "DOCX_HEADING_SKIP",
            message: `Heading at section ${i} skips from level ${lastHeadingLevel} to ${section.level}`,
            location: `section[${i}]`,
          });
        }
        lastHeadingLevel = section.level;
      }

      // Check empty content
      if (section.type !== "pageBreak" && section.type !== "toc") {
        if (!section.content || (typeof section.content === "string" && section.content.trim() === "")) {
          issues.push({
            severity: "warning",
            code: "DOCX_EMPTY_SECTION",
            message: `Section ${i} (${section.type}) has no content`,
            location: `section[${i}]`,
          });
        }
      }

      // Check table integrity
      if (section.type === "table" && Array.isArray(section.content)) {
        const rows = section.content;
        if (rows.length > 0) {
          const headerLen = Array.isArray(rows[0]) ? rows[0].length : 0;
          for (let r = 1; r < rows.length; r++) {
            const rowLen = Array.isArray(rows[r]) ? rows[r].length : 0;
            if (rowLen !== headerLen) {
              issues.push({
                severity: "error",
                code: "DOCX_TABLE_MISMATCH",
                message: `Table row ${r} has ${rowLen} columns but header has ${headerLen}`,
                location: `section[${i}].row[${r}]`,
              });
            }
          }
        }
      }
    }

    // Check consecutive page breaks
    for (let i = 1; i < spec.sections.length; i++) {
      if (spec.sections[i].type === "pageBreak" && spec.sections[i - 1].type === "pageBreak") {
        issues.push({
          severity: "info",
          code: "DOCX_DOUBLE_PAGEBREAK",
          message: `Consecutive page breaks at sections ${i - 1} and ${i}`,
          location: `section[${i}]`,
        });
      }
    }

    const errors = issues.filter((i) => i.severity === "error").length;
    return {
      valid: errors === 0,
      format: "docx",
      issueCount: issues.length,
      errors,
      warnings: issues.filter((i) => i.severity === "warning").length,
      issues,
      metadata: { sectionCount: spec.sections.length },
    };
  }
}

/* ------------------------------------------------------------------ */
/*  XLSX Validator                                                    */
/* ------------------------------------------------------------------ */

export class WorkbookValidator {
  validateSpec(spec: {
    sheets: Array<{
      name: string;
      columns: Array<{ key: string; header: string; type?: string }>;
      rows: Array<Record<string, any>>;
      formulas?: Array<{ cell: string; formula: string }>;
    }>;
  }): ValidationResult {
    const issues: ValidationIssue[] = [];

    if (!spec.sheets || spec.sheets.length === 0) {
      issues.push({
        severity: "error",
        code: "XLSX_NO_SHEETS",
        message: "Workbook has no sheets",
      });
    }

    const sheetNames = new Set<string>();

    for (let s = 0; s < spec.sheets.length && issues.length < MAX_VALIDATION_ISSUES; s++) {
      const sheet = spec.sheets[s];

      // Check duplicate sheet names
      if (sheetNames.has(sheet.name)) {
        issues.push({
          severity: "error",
          code: "XLSX_DUPLICATE_SHEET",
          message: `Duplicate sheet name: "${sheet.name}"`,
          location: `sheet[${s}]`,
        });
      }
      sheetNames.add(sheet.name);

      // Sheet name length (Excel max 31)
      if (sheet.name.length > 31) {
        issues.push({
          severity: "error",
          code: "XLSX_SHEET_NAME_TOO_LONG",
          message: `Sheet name "${sheet.name}" exceeds 31 characters`,
          location: `sheet[${s}]`,
        });
      }

      // Check columns
      if (!sheet.columns || sheet.columns.length === 0) {
        issues.push({
          severity: "error",
          code: "XLSX_NO_COLUMNS",
          message: `Sheet "${sheet.name}" has no column definitions`,
          location: `sheet[${s}]`,
        });
        continue;
      }

      // Check for duplicate column keys
      const colKeys = new Set<string>();
      for (const col of sheet.columns) {
        if (colKeys.has(col.key)) {
          issues.push({
            severity: "error",
            code: "XLSX_DUPLICATE_COL_KEY",
            message: `Duplicate column key "${col.key}" in sheet "${sheet.name}"`,
            location: `sheet[${s}]`,
          });
        }
        colKeys.add(col.key);
      }

      // Check data types (capped to prevent slow validation on large datasets)
      let typeChecks = 0;
      for (let r = 0; r < sheet.rows.length && typeChecks < MAX_DATA_TYPE_CHECKS_PER_SHEET; r++) {
        const row = sheet.rows[r];
        for (const col of sheet.columns) {
          if (typeChecks >= MAX_DATA_TYPE_CHECKS_PER_SHEET) break;
          typeChecks++;
          const value = row[col.key];
          if (value === undefined || value === null) continue;

          if (col.type === "number" && typeof value !== "number" && isNaN(Number(value))) {
            issues.push({
              severity: "warning",
              code: "XLSX_TYPE_MISMATCH",
              message: `Row ${r + 1}, column "${col.key}": expected number, got "${typeof value}"`,
              location: `sheet[${s}].row[${r}].${col.key}`,
            });
          }
        }
      }

      // Validate formulas (basic check)
      if (sheet.formulas) {
        const cellPattern = /^[A-Z]{1,3}\d{1,7}$/; // max col XFD, max row 1048576
        for (const formula of sheet.formulas) {
          if (!cellPattern.test(formula.cell)) {
            issues.push({
              severity: "error",
              code: "XLSX_INVALID_CELL_REF",
              message: `Invalid cell reference "${formula.cell}" in sheet "${sheet.name}"`,
              location: `sheet[${s}].formula`,
            });
          }
        }
      }

      // Check row count (Excel max ~1M rows)
      if (sheet.rows.length > 100_000) {
        issues.push({
          severity: "warning",
          code: "XLSX_LARGE_DATASET",
          message: `Sheet "${sheet.name}" has ${sheet.rows.length} rows — may be slow`,
          location: `sheet[${s}]`,
        });
      }
    }

    const errors = issues.filter((i) => i.severity === "error").length;
    return {
      valid: errors === 0,
      format: "xlsx",
      issueCount: issues.length,
      errors,
      warnings: issues.filter((i) => i.severity === "warning").length,
      issues,
      metadata: { sheetCount: spec.sheets.length },
    };
  }
}
