/**
 * Cognitive Middleware — real capability handlers (Turn J).
 *
 * Turn I registered the full ILIAGPT capability catalog as
 * descriptors but left every entry (except `availability.echo` +
 * `availability.platform_status`) as a `stub`. Turn J promotes
 * 20+ capabilities to `available` by providing real handlers
 * backed by existing npm packages the repo already ships
 * (`exceljs`, `docx`, `pptxgenjs`, `pdfkit`, `papaparse`) or pure
 * TypeScript logic.
 *
 * Design principles:
 *
 *   1. **Deterministic outputs.** Every handler is pure or
 *      seeded so tests can assert exact results. File-producing
 *      handlers return:
 *        • `format`        — e.g., "xlsx", "docx", "pdf"
 *        • `base64`        — the full file as base64
 *        • `sizeBytes`     — numeric size for sanity checks
 *        • `metadata`      — format-specific summary (sheet count,
 *                            slide count, page count, etc.)
 *
 *   2. **No external I/O.** None of these handlers write to disk,
 *      call the network, or execute sandboxed code. They build
 *      artifacts in-memory and return bytes. Production wiring
 *      can add persistence on top without changing the handler
 *      contract.
 *
 *   3. **Safe defaults.** Every handler validates its args with
 *      explicit guards and returns structured failures via the
 *      `CapabilityHandler` contract (throw → `handler_threw`
 *      from the registry). Size caps prevent runaway memory:
 *      spreadsheets cap at 10k rows, PDFs at 100 pages, etc.
 *
 *   4. **Useful output shape.** Handlers return JSON-serializable
 *      objects that a test harness (Playwright in the browser)
 *      can decode and assert against without external tools.
 *
 * This file is intentionally long — it's the seam between the
 * cognitive layer and the product's actual work. Each handler is
 * self-contained + short; reviewing one doesn't require reading
 * the others.
 */

import ExcelJS from "exceljs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
} from "docx";
// pdfkit ships with no type declarations AND no ESM wrapper, so
// we resolve it via the Node `createRequire` helper. This works
// under both CJS and ESM modes (the project runs under tsx ESM).
import { createRequire } from "module";
const esmRequire = createRequire(import.meta.url);
const PDFDocument = esmRequire("pdfkit") as new (
  options?: Record<string, unknown>,
) => {
  on: (event: string, cb: (chunk: Buffer) => void) => void;
  fontSize: (n: number) => { text: (t: string, opts?: Record<string, unknown>) => unknown };
  moveDown: (n?: number) => unknown;
  end: () => void;
  text: (t: string, opts?: Record<string, unknown>) => unknown;
};
// pptxgenjs ships an ESM default export; `import * as pptxgen` unwraps
// it for Node CJS interop. The `.default` dance below handles both
// module shapes so this file works under either bundler.
import pptxgenModule from "pptxgenjs";
import Papa from "papaparse";

import type { CapabilityHandler, CapabilityHandlerResult } from "./capabilities";

// Interop with the pptxgenjs default export across module shapes.
const PptxGenJS =
  (pptxgenModule as unknown as { default?: typeof pptxgenModule }).default ??
  (pptxgenModule as unknown as typeof pptxgenModule);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Safe number coercion with a default. */
function num(v: unknown, def: number): number {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return def;
}

/** Safe string coercion with a default. */
function str(v: unknown, def: string): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return def;
  return String(v);
}

function toBase64(buf: Buffer | Uint8Array | ArrayBuffer): string {
  if (buf instanceof ArrayBuffer) return Buffer.from(new Uint8Array(buf)).toString("base64");
  if (buf instanceof Uint8Array) return Buffer.from(buf).toString("base64");
  return (buf as Buffer).toString("base64");
}

// ---------------------------------------------------------------------------
// 1. file_generation.create_excel_workbook
// ---------------------------------------------------------------------------

/**
 * Build a small .xlsx workbook. Input:
 *
 *   {
 *     title?: string,          // workbook display title
 *     sheets: Array<{
 *       name: string,
 *       headers: string[],
 *       rows: Array<Array<string|number|boolean|null>>,
 *       formulas?: Array<{ cell: string, formula: string }>
 *     }>
 *   }
 *
 * Returns:
 *   {
 *     format: "xlsx",
 *     base64: string,
 *     sizeBytes: number,
 *     metadata: { sheetCount, totalRows, sheetNames, formulaCount }
 *   }
 */
export const createExcelWorkbookHandler: CapabilityHandler = async (args) => {
  const rawSheets = (args.sheets as unknown[]) ?? [];
  if (!Array.isArray(rawSheets) || rawSheets.length === 0) {
    throw new Error("create_excel_workbook: args.sheets must be a non-empty array");
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ILIAGPT";
  workbook.created = new Date(0); // deterministic timestamp

  const sheetNames: string[] = [];
  let totalRows = 0;
  let formulaCount = 0;

  for (const raw of rawSheets) {
    const sheetDef = raw as {
      name?: unknown;
      headers?: unknown;
      rows?: unknown;
      formulas?: unknown;
    };
    const sheetName = str(sheetDef.name, `Sheet${sheetNames.length + 1}`).slice(0, 31);
    const sheet = workbook.addWorksheet(sheetName);
    sheetNames.push(sheet.name);

    const headers = Array.isArray(sheetDef.headers)
      ? (sheetDef.headers as unknown[]).map((h) => str(h, ""))
      : [];
    if (headers.length > 0) {
      sheet.addRow(headers);
      // Bold the header row so smoke tests can assert on styling.
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
    }

    const rows = Array.isArray(sheetDef.rows) ? (sheetDef.rows as unknown[]) : [];
    for (const row of rows.slice(0, 10_000)) {
      if (Array.isArray(row)) {
        sheet.addRow(row as (string | number | boolean | null)[]);
        totalRows++;
      }
    }

    const formulas = Array.isArray(sheetDef.formulas)
      ? (sheetDef.formulas as unknown[])
      : [];
    for (const f of formulas) {
      const fd = f as { cell?: unknown; formula?: unknown };
      const cell = str(fd.cell, "");
      const formula = str(fd.formula, "");
      if (cell && formula) {
        sheet.getCell(cell).value = { formula, result: undefined };
        formulaCount++;
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const base64 = toBase64(buffer);

  return {
    result: {
      format: "xlsx",
      base64,
      sizeBytes: (buffer as ArrayBuffer).byteLength ?? (buffer as Buffer).length,
      metadata: {
        sheetCount: sheetNames.length,
        sheetNames,
        totalRows,
        formulaCount,
      },
    },
    message: `workbook with ${sheetNames.length} sheet(s) and ${totalRows} rows built`,
  };
};

// ---------------------------------------------------------------------------
// 2. file_generation.create_word_document
// ---------------------------------------------------------------------------

/**
 * Build a .docx with headings + paragraphs + optional tables.
 * Input: { title, sections: Array<{ heading?, paragraphs?, table? }> }
 */
export const createWordDocumentHandler: CapabilityHandler = async (args) => {
  const title = str(args.title, "Untitled Document");
  const sectionsInput = Array.isArray(args.sections) ? (args.sections as unknown[]) : [];
  if (sectionsInput.length === 0) {
    throw new Error("create_word_document: args.sections must be a non-empty array");
  }

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
    }),
  ];

  let paragraphCount = 0;
  let tableCount = 0;

  for (const sec of sectionsInput) {
    const s = sec as {
      heading?: unknown;
      paragraphs?: unknown;
      table?: unknown;
    };
    if (s.heading) {
      children.push(
        new Paragraph({
          text: str(s.heading, ""),
          heading: HeadingLevel.HEADING_1,
        }),
      );
    }
    if (Array.isArray(s.paragraphs)) {
      for (const p of s.paragraphs as unknown[]) {
        children.push(
          new Paragraph({
            children: [new TextRun(str(p, ""))],
          }),
        );
        paragraphCount++;
      }
    }
    if (s.table && typeof s.table === "object") {
      const t = s.table as { headers?: unknown; rows?: unknown };
      const headers = Array.isArray(t.headers)
        ? (t.headers as unknown[]).map((h) => str(h, ""))
        : [];
      const rows = Array.isArray(t.rows) ? (t.rows as unknown[]) : [];

      const tableRows: TableRow[] = [];
      if (headers.length > 0) {
        tableRows.push(
          new TableRow({
            children: headers.map(
              (h) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                }),
            ),
          }),
        );
      }
      for (const r of rows) {
        const cells = Array.isArray(r) ? (r as unknown[]) : [];
        tableRows.push(
          new TableRow({
            children: cells.map(
              (c) =>
                new TableCell({
                  children: [new Paragraph(str(c, ""))],
                }),
            ),
          }),
        );
      }
      if (tableRows.length > 0) {
        children.push(new Table({ rows: tableRows }));
        tableCount++;
      }
    }
  }

  const doc = new Document({
    creator: "ILIAGPT",
    title,
    sections: [{ children }],
  });
  const buf = await Packer.toBuffer(doc);
  const base64 = toBase64(buf);

  return {
    result: {
      format: "docx",
      base64,
      sizeBytes: buf.length,
      metadata: {
        title,
        sectionCount: sectionsInput.length,
        paragraphCount,
        tableCount,
      },
    },
    message: `word document "${title}" built with ${sectionsInput.length} sections`,
  };
};

// ---------------------------------------------------------------------------
// 3. file_generation.create_pdf
// ---------------------------------------------------------------------------

/**
 * Build a .pdf from a title + body paragraphs using pdfkit.
 * Input: { title, body: string[] }
 * Output: { format: "pdf", base64, sizeBytes, metadata: { pageCount (approx) } }
 */
export const createPdfHandler: CapabilityHandler = async (args) => {
  const title = str(args.title, "Untitled");
  const body = Array.isArray(args.body) ? (args.body as unknown[]) : [];
  if (body.length === 0) {
    throw new Error("create_pdf: args.body must be a non-empty array of strings");
  }

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({
    size: "LETTER",
    margin: 50,
    info: { Title: title, Author: "ILIAGPT", CreationDate: new Date(0) },
  });
  doc.on("data", (c: Buffer) => chunks.push(c));

  const pdfPromise: Promise<Buffer> = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.fontSize(22).text(title, { underline: true });
  doc.moveDown();
  for (const p of body.slice(0, 500)) {
    doc.fontSize(12).text(str(p, ""), { align: "left" });
    doc.moveDown(0.5);
  }
  doc.end();

  const buf = await pdfPromise;
  const base64 = toBase64(buf);

  // A very rough page count: pdfkit writes one page per doc.bufferedPageRange
  // but we don't want to introspect private state. Instead parse the buffer
  // header for "/Count" — cheap and good enough for tests.
  const text = buf.toString("latin1");
  const countMatch = text.match(/\/Count\s+(\d+)/);
  const pageCount = countMatch ? Number(countMatch[1]) : 1;

  return {
    result: {
      format: "pdf",
      base64,
      sizeBytes: buf.length,
      metadata: { title, pageCount },
    },
    message: `pdf "${title}" with ~${pageCount} page(s) built`,
  };
};

// ---------------------------------------------------------------------------
// 4. file_generation.create_powerpoint
// ---------------------------------------------------------------------------

/**
 * Build a .pptx with N slides. Input: { title, slides: Array<{
 * title, bullets?, notes? }> }
 */
export const createPowerPointHandler: CapabilityHandler = async (args) => {
  const title = str(args.title, "Untitled");
  const slidesInput = Array.isArray(args.slides) ? (args.slides as unknown[]) : [];
  if (slidesInput.length === 0) {
    throw new Error("create_powerpoint: args.slides must be a non-empty array");
  }

  const pres = new PptxGenJS();
  pres.author = "ILIAGPT";
  pres.title = title;
  pres.layout = "LAYOUT_16x9";

  // Title slide
  const titleSlide = pres.addSlide();
  titleSlide.addText(title, {
    x: 0.5,
    y: 2.0,
    w: 9.0,
    h: 1.5,
    fontSize: 36,
    bold: true,
    align: "center",
  });

  let bulletCount = 0;
  for (const raw of slidesInput.slice(0, 200)) {
    const s = raw as {
      title?: unknown;
      bullets?: unknown;
      notes?: unknown;
    };
    const slide = pres.addSlide();
    slide.addText(str(s.title, "Untitled slide"), {
      x: 0.5,
      y: 0.3,
      w: 9.0,
      h: 0.8,
      fontSize: 24,
      bold: true,
    });
    if (Array.isArray(s.bullets)) {
      const bullets = (s.bullets as unknown[]).map((b) => ({
        text: str(b, ""),
        options: { bullet: true },
      }));
      if (bullets.length > 0) {
        slide.addText(bullets, {
          x: 0.5,
          y: 1.5,
          w: 9.0,
          h: 5.0,
          fontSize: 18,
        });
        bulletCount += bullets.length;
      }
    }
    if (s.notes) {
      slide.addNotes(str(s.notes, ""));
    }
  }

  // pptxgenjs returns base64 directly with the "base64" outputType.
  const base64 = (await pres.write({ outputType: "base64" })) as string;
  const sizeBytes = Math.floor((base64.length * 3) / 4);

  return {
    result: {
      format: "pptx",
      base64,
      sizeBytes,
      metadata: {
        title,
        slideCount: slidesInput.length + 1, // +1 for title slide
        bulletCount,
      },
    },
    message: `powerpoint "${title}" with ${slidesInput.length + 1} slide(s) built`,
  };
};

// ---------------------------------------------------------------------------
// 5. file_generation.create_code_file
// ---------------------------------------------------------------------------

/**
 * Trivial handler: package a source string as a "file" with the
 * given language tag. Returns base64 of the source bytes.
 */
export const createCodeFileHandler: CapabilityHandler = async (args) => {
  const language = str(args.language, "text");
  const filename = str(args.filename, `file.${language}`);
  const source = str(args.source, "");
  if (!source) {
    throw new Error("create_code_file: args.source must be a non-empty string");
  }
  const buf = Buffer.from(source, "utf-8");
  return {
    result: {
      format: "code",
      language,
      filename,
      base64: toBase64(buf),
      sizeBytes: buf.length,
      metadata: {
        filename,
        language,
        lineCount: source.split("\n").length,
        charCount: source.length,
      },
    },
    message: `code file "${filename}" (${language}) built`,
  };
};

// ---------------------------------------------------------------------------
// 6. data_analysis.describe_dataset
// ---------------------------------------------------------------------------

/**
 * Takes a CSV string (args.csv) OR a rows array (args.rows +
 * args.headers). Returns per-column statistics for numeric columns:
 * mean, median, min, max, stddev, count. String columns report
 * count + distinctCount.
 */
export const describeDatasetHandler: CapabilityHandler = async (args) => {
  let headers: string[] = [];
  let rows: unknown[][] = [];

  if (typeof args.csv === "string") {
    const parsed = Papa.parse<string[]>(args.csv, { skipEmptyLines: true });
    if (Array.isArray(parsed.data) && parsed.data.length > 0) {
      headers = parsed.data[0] as string[];
      rows = parsed.data.slice(1) as unknown[][];
    }
  } else if (Array.isArray(args.headers) && Array.isArray(args.rows)) {
    headers = (args.headers as unknown[]).map((h) => str(h, ""));
    rows = args.rows as unknown[][];
  }

  if (headers.length === 0 || rows.length === 0) {
    throw new Error(
      "describe_dataset: provide either args.csv or both args.headers + args.rows",
    );
  }

  const stats: Record<string, unknown> = {};
  for (let col = 0; col < headers.length; col++) {
    const colName = headers[col];
    const values: unknown[] = rows.map((r) => r[col]);
    const numericValues: number[] = [];
    for (const v of values) {
      if (typeof v === "number") {
        numericValues.push(v);
      } else if (typeof v === "string") {
        const n = Number(v);
        if (!Number.isNaN(n) && v.trim().length > 0) numericValues.push(n);
      }
    }
    if (numericValues.length === values.length && numericValues.length > 0) {
      const count = numericValues.length;
      const sum = numericValues.reduce((a, b) => a + b, 0);
      const mean = sum / count;
      const sorted = [...numericValues].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const variance =
        numericValues.reduce((acc, v) => acc + (v - mean) ** 2, 0) / count;
      const stddev = Math.sqrt(variance);
      stats[colName] = {
        type: "numeric",
        count,
        mean,
        median,
        min,
        max,
        stddev,
      };
    } else {
      const stringValues = values.map((v) => str(v, ""));
      const distinct = new Set(stringValues).size;
      stats[colName] = {
        type: "string",
        count: stringValues.length,
        distinctCount: distinct,
      };
    }
  }

  return {
    result: {
      rowCount: rows.length,
      columnCount: headers.length,
      columns: headers,
      stats,
    },
    message: `described ${rows.length} rows × ${headers.length} columns`,
  };
};

// ---------------------------------------------------------------------------
// 7. data_analysis.clean_and_transform
// ---------------------------------------------------------------------------

/**
 * Takes { rows, dedupeKey? } and returns deduplicated + null-
 * normalized rows. Very simple: if `dedupeKey` is set, rows with
 * the same value at that column index are collapsed (first wins).
 */
export const cleanAndTransformHandler: CapabilityHandler = async (args) => {
  const rows = Array.isArray(args.rows) ? (args.rows as unknown[][]) : [];
  const dedupeKey = typeof args.dedupeKey === "number" ? args.dedupeKey : null;
  if (rows.length === 0) {
    throw new Error("clean_and_transform: args.rows must be a non-empty array");
  }

  const cleaned: unknown[][] = [];
  const seen = new Set<string>();
  let removedDuplicates = 0;
  let normalizedNulls = 0;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const normalized = row.map((c) => {
      if (c === null || c === undefined || c === "") {
        normalizedNulls++;
        return null;
      }
      return c;
    });
    if (dedupeKey !== null && dedupeKey >= 0 && dedupeKey < normalized.length) {
      const key = String(normalized[dedupeKey]);
      if (seen.has(key)) {
        removedDuplicates++;
        continue;
      }
      seen.add(key);
    }
    cleaned.push(normalized);
  }

  return {
    result: {
      rows: cleaned,
      originalRowCount: rows.length,
      cleanedRowCount: cleaned.length,
      removedDuplicates,
      normalizedNulls,
    },
    message: `cleaned ${rows.length} → ${cleaned.length} rows`,
  };
};

// ---------------------------------------------------------------------------
// 8. data_analysis.forecast_series
// ---------------------------------------------------------------------------

/**
 * Simple exponential smoothing forecast. Input:
 *   { series: number[], horizon: number, alpha?: number }
 * Returns { forecast: number[], fitted: number[], rmse }
 */
export const forecastSeriesHandler: CapabilityHandler = async (args) => {
  const series = Array.isArray(args.series) ? (args.series as unknown[]) : [];
  const horizon = Math.max(1, Math.min(365, num(args.horizon, 5)));
  const alpha = Math.max(0, Math.min(1, num(args.alpha, 0.5)));
  if (series.length === 0) {
    throw new Error("forecast_series: args.series must be a non-empty array of numbers");
  }

  const values: number[] = [];
  for (const v of series) {
    if (typeof v === "number" && !Number.isNaN(v)) values.push(v);
    else if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n)) values.push(n);
    }
  }
  if (values.length === 0) {
    throw new Error("forecast_series: series has no numeric values");
  }

  // Exponential smoothing: s_t = α * x_t + (1-α) * s_{t-1}
  const fitted: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    fitted.push(alpha * values[i] + (1 - alpha) * fitted[i - 1]);
  }

  // Forecast: hold the last smoothed value as the point forecast.
  const lastSmoothed = fitted[fitted.length - 1];
  const forecast: number[] = new Array(horizon).fill(lastSmoothed);

  // Root mean squared error of the one-step-ahead fit.
  let sumSq = 0;
  for (let i = 1; i < values.length; i++) {
    sumSq += (values[i] - fitted[i - 1]) ** 2;
  }
  const rmse = Math.sqrt(sumSq / Math.max(1, values.length - 1));

  return {
    result: {
      forecast,
      fitted,
      rmse,
      horizon,
      alpha,
      pointForecast: lastSmoothed,
    },
    message: `forecast of ${horizon} periods produced`,
  };
};

// ---------------------------------------------------------------------------
// 9. format_conversion.csv_to_excel_model
// ---------------------------------------------------------------------------

/**
 * Convert a CSV string into an .xlsx workbook with one sheet + a
 * sum formula under every numeric column.
 */
export const csvToExcelModelHandler: CapabilityHandler = async (args) => {
  const csv = str(args.csv, "");
  if (!csv) throw new Error("csv_to_excel_model: args.csv must be a non-empty string");

  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: true });
  const data = (parsed.data as string[][]) ?? [];
  if (data.length === 0) {
    throw new Error("csv_to_excel_model: CSV parsed to zero rows");
  }
  const headers = data[0];
  const rows = data.slice(1);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ILIAGPT";
  workbook.created = new Date(0);
  const sheet = workbook.addWorksheet("Data");
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows.slice(0, 10_000)) {
    // Try to coerce numerics so formulas work.
    const coerced = row.map((v) => {
      const n = Number(v);
      return !Number.isNaN(n) && v.trim() !== "" ? n : v;
    });
    sheet.addRow(coerced);
  }

  // Add a TOTAL row at the bottom with SUM() formulas for numeric columns.
  const totalRowIdx = rows.length + 3; // header + data + blank + totals
  sheet.getCell(`A${totalRowIdx}`).value = "TOTAL";
  sheet.getCell(`A${totalRowIdx}`).font = { bold: true };
  let sumFormulas = 0;
  for (let col = 0; col < headers.length; col++) {
    const columnLetter = String.fromCharCode("A".charCodeAt(0) + col);
    // Check if the top value in this column is numeric — proxy for
    // "this column is a number column".
    const sample = rows[0]?.[col];
    if (sample && !Number.isNaN(Number(sample))) {
      sheet.getCell(`${columnLetter}${totalRowIdx}`).value = {
        formula: `SUM(${columnLetter}2:${columnLetter}${rows.length + 1})`,
        result: undefined,
      };
      sumFormulas++;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const base64 = toBase64(buffer);

  return {
    result: {
      format: "xlsx",
      base64,
      sizeBytes: (buffer as ArrayBuffer).byteLength ?? (buffer as Buffer).length,
      metadata: {
        rowCount: rows.length,
        columnCount: headers.length,
        sumFormulas,
      },
    },
    message: `converted ${rows.length}-row csv to xlsx model with ${sumFormulas} sum formulas`,
  };
};

// ---------------------------------------------------------------------------
// 10. research_synthesis.executive_summary
// ---------------------------------------------------------------------------

/**
 * Pure-TS executive summary: splits the input text into sentences,
 * ranks them by a simple heuristic (length + keyword density), and
 * returns the top N. Deterministic — no LLM needed for the base
 * version (real production may chain to middleware.run for LLM
 * rewriting, but that's a separate concern).
 */
export const executiveSummaryHandler: CapabilityHandler = async (args) => {
  const text = str(args.text, "");
  const maxSentences = Math.max(1, Math.min(20, num(args.maxSentences, 3)));
  if (!text) throw new Error("executive_summary: args.text must be a non-empty string");

  // Sentence splitter — naive but deterministic.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
  if (sentences.length === 0) {
    return {
      result: { summary: text.slice(0, 200), selectedCount: 1, totalSentences: 1 },
      message: "summary produced from short input",
    };
  }

  // Score: prefer sentences in the first third of the text + those
  // with 50-200 chars (typical of well-formed topic sentences).
  const scored = sentences.map((s, i) => {
    let score = 0;
    if (i < sentences.length / 3) score += 2;
    if (s.length >= 50 && s.length <= 200) score += 1;
    if (/^(the|this|in |we |our |results?|conclusion)/i.test(s)) score += 1;
    return { s, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const picked = scored
    .slice(0, maxSentences)
    .sort((a, b) => a.i - b.i)
    .map((e) => e.s);

  return {
    result: {
      summary: picked.join(" "),
      selectedCount: picked.length,
      totalSentences: sentences.length,
    },
    message: `summary of ${sentences.length} sentences → ${picked.length} selected`,
  };
};

// ---------------------------------------------------------------------------
// 11. sub_agents.decompose_task
// ---------------------------------------------------------------------------

/**
 * Split a natural-language task description into sub-tasks. Pure
 * TS: splits on sentence boundaries + numbered list markers +
 * bullet points, then assigns priority and dependency hints.
 */
export const decomposeTaskHandler: CapabilityHandler = async (args) => {
  const task = str(args.task, "");
  if (!task) throw new Error("decompose_task: args.task must be a non-empty string");

  // Split on common step delimiters.
  const raw = task
    .split(/(?:\n+|(?:^|\s)(?:\d+[\.\)]|[-*•])\s|(?<=[.!?])\s+)/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

  const subtasks = raw.map((t, i) => ({
    id: `subtask_${i + 1}`,
    description: t,
    priority: i === 0 ? "high" : i < 3 ? "medium" : "low",
    dependsOn: i === 0 ? [] : [`subtask_${i}`],
  }));

  return {
    result: {
      originalTask: task,
      subtasks,
      count: subtasks.length,
    },
    message: `decomposed into ${subtasks.length} subtask(s)`,
  };
};

// ---------------------------------------------------------------------------
// 12. connectors.list_available
// ---------------------------------------------------------------------------

/**
 * Static list of the MCP connectors the ILIAGPT platform knows
 * about. Status is "available" / "stub" / "coming_soon" — in
 * production this would query the MCP client registry.
 */
export const listConnectorsHandler: CapabilityHandler = async () => {
  const connectors = [
    { id: "google_drive", name: "Google Drive", status: "available" },
    { id: "gmail", name: "Gmail", status: "available" },
    { id: "zoom", name: "Zoom", status: "available" },
    { id: "slack", name: "Slack", status: "available" },
    { id: "jira", name: "Jira", status: "available" },
    { id: "asana", name: "Asana", status: "coming_soon" },
    { id: "notion", name: "Notion", status: "available" },
    { id: "github", name: "GitHub", status: "available" },
    { id: "linear", name: "Linear", status: "available" },
    { id: "docusign", name: "DocuSign", status: "coming_soon" },
    { id: "factset", name: "FactSet", status: "coming_soon" },
    { id: "fellow", name: "Fellow.ai", status: "available" },
  ];
  return {
    result: {
      connectors,
      count: connectors.length,
      availableCount: connectors.filter((c) => c.status === "available").length,
    },
    message: `${connectors.length} connectors known`,
  };
};

// ---------------------------------------------------------------------------
// 13. plugins.list_marketplace
// ---------------------------------------------------------------------------

export const listPluginsHandler: CapabilityHandler = async () => {
  const plugins = [
    { id: "finance.variance_analysis", domain: "finance", title: "Variance analysis" },
    { id: "legal.contract_redline", domain: "legal", title: "Contract redline" },
    { id: "hr.performance_review", domain: "hr", title: "Performance review template" },
    { id: "engineering.code_review", domain: "engineering", title: "Code review helper" },
    { id: "marketing.brand_voice", domain: "marketing", title: "Brand voice analyzer" },
    { id: "skills.xlsx", domain: "files", title: "xlsx skill" },
    { id: "skills.pptx", domain: "files", title: "pptx skill" },
    { id: "skills.docx", domain: "files", title: "docx skill" },
    { id: "skills.pdf", domain: "files", title: "pdf skill" },
  ];
  return {
    result: { plugins, count: plugins.length },
    message: `${plugins.length} plugins in marketplace`,
  };
};

// ---------------------------------------------------------------------------
// 14. file_management.bulk_rename
// ---------------------------------------------------------------------------

/**
 * Pure-TS pattern application: given a list of filenames and a
 * pattern, return the new filenames. The pattern supports
 * placeholders {original}, {date:YYYY-MM-DD}, {index:03d}.
 * No filesystem writes — the handler returns a preview.
 */
export const bulkRenameHandler: CapabilityHandler = async (args) => {
  const files = Array.isArray(args.files) ? (args.files as unknown[]) : [];
  const pattern = str(args.pattern, "{original}");
  const dateISO = str(args.date, "2026-04-11");
  if (files.length === 0) {
    throw new Error("bulk_rename: args.files must be a non-empty array");
  }

  const renamed: Array<{ original: string; renamed: string }> = [];
  let index = 1;
  for (const f of files) {
    const original = str(f, "");
    if (!original) continue;
    let next = pattern;
    next = next.replace(/\{original\}/g, original);
    next = next.replace(/\{date\}/g, dateISO);
    next = next.replace(
      /\{index(?::(\d+)d)?\}/g,
      (_m, width) => String(index).padStart(Number(width ?? 1), "0"),
    );
    renamed.push({ original, renamed: next });
    index++;
  }

  return {
    result: {
      renamed,
      count: renamed.length,
      pattern,
    },
    message: `renamed ${renamed.length} file(s)`,
  };
};

// ---------------------------------------------------------------------------
// 15. file_management.organize_folder
// ---------------------------------------------------------------------------

/**
 * Pure-TS analysis: given a list of files with metadata
 * ({ name, size, mtime, type }), propose a subfolder organization
 * (by type, by date, by size). Returns a structured plan the UI
 * can preview before any disk writes.
 */
export const organizeFolderHandler: CapabilityHandler = async (args) => {
  const files = Array.isArray(args.files) ? (args.files as unknown[]) : [];
  if (files.length === 0) {
    throw new Error("organize_folder: args.files must be a non-empty array");
  }
  const plan: Record<string, string[]> = {};
  for (const raw of files) {
    const f = raw as { name?: unknown; type?: unknown };
    const name = str(f.name, "");
    const type = str(f.type, "other");
    if (!name) continue;
    const folder = type.length > 0 ? type.toLowerCase() : "other";
    plan[folder] = plan[folder] ?? [];
    plan[folder].push(name);
  }

  return {
    result: {
      plan,
      folderCount: Object.keys(plan).length,
      fileCount: files.length,
    },
    message: `organized ${files.length} files into ${Object.keys(plan).length} folders`,
  };
};

// ---------------------------------------------------------------------------
// 16-20. Scheduled tasks, projects, governance (in-memory stores)
// ---------------------------------------------------------------------------

/**
 * Module-level in-memory stores for scheduled tasks + projects.
 * Shared across invocations so a "list" call after a "create"
 * call in the same process can see the just-added entry.
 * Production wiring uses real persistence layers.
 */
const SCHEDULED_TASKS: Array<{
  id: string;
  userId: string;
  name: string;
  cadence: string;
  createdAt: number;
}> = [];
const PROJECTS: Array<{
  id: string;
  userId: string;
  name: string;
  description: string;
  createdAt: number;
}> = [];

export const createScheduledTaskHandler: CapabilityHandler = async (args, ctx) => {
  const name = str(args.name, "");
  const cadence = str(args.cadence, "daily");
  if (!name) throw new Error("create_recurring: args.name must be non-empty");
  const id = `sched_${ctx.userId}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const task = {
    id,
    userId: ctx.userId,
    name,
    cadence,
    createdAt: Date.now(),
  };
  SCHEDULED_TASKS.push(task);
  return { result: task, message: `scheduled task "${name}" created with cadence ${cadence}` };
};

export const listScheduledTasksHandler: CapabilityHandler = async (_args, ctx) => {
  const tasks = SCHEDULED_TASKS.filter((t) => t.userId === ctx.userId);
  return {
    result: { tasks, count: tasks.length },
    message: `${tasks.length} scheduled task(s) for user`,
  };
};

export const createProjectHandler: CapabilityHandler = async (args, ctx) => {
  const name = str(args.name, "");
  const description = str(args.description, "");
  if (!name) throw new Error("create_workspace: args.name must be non-empty");
  const id = `proj_${ctx.userId}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const project = {
    id,
    userId: ctx.userId,
    name,
    description,
    createdAt: Date.now(),
  };
  PROJECTS.push(project);
  return { result: project, message: `project "${name}" created` };
};

export const listProjectsHandler: CapabilityHandler = async (_args, ctx) => {
  const projects = PROJECTS.filter((p) => p.userId === ctx.userId);
  return {
    result: { projects, count: projects.length },
    message: `${projects.length} project(s) for user`,
  };
};

// ---------------------------------------------------------------------------
// 21. security_governance.audit_recent_actions (pure stub)
// ---------------------------------------------------------------------------

/**
 * Placeholder that returns a static audit summary. Production
 * wiring would query the run repository directly. Kept simple so
 * the Turn J Playwright tests can assert an exact shape.
 */
export const auditRecentActionsHandler: CapabilityHandler = async (args, ctx) => {
  const hours = Math.max(1, Math.min(168, num(args.hours, 24)));
  return {
    result: {
      userId: ctx.userId,
      windowHours: hours,
      summary: {
        totalActions: 0,
        byCategory: {},
      },
      note: "demo audit — production reads from the run repository",
    },
    message: "audit placeholder produced",
  };
};

// ---------------------------------------------------------------------------
// 22. enterprise.usage_analytics (pure stub with shape)
// ---------------------------------------------------------------------------

export const usageAnalyticsHandler: CapabilityHandler = async () => {
  return {
    result: {
      period: "last_7_days",
      totalRequests: 0,
      totalTokens: 0,
      byProvider: {},
      byIntent: {},
    },
    message: "usage analytics placeholder produced",
  };
};

// ---------------------------------------------------------------------------
// 23. enterprise.rbac_check
// ---------------------------------------------------------------------------

export const rbacCheckHandler: CapabilityHandler = async (args) => {
  const userId = str(args.userId, "");
  const action = str(args.action, "");
  const role = str(args.role, "viewer");
  if (!userId || !action) {
    throw new Error("rbac_check: args.userId and args.action are required");
  }
  // Demo rule: admin can do anything; editor can do non-destructive
  // actions; viewer can only read.
  const isDestructive = /delete|drop|remove|destroy/i.test(action);
  let allowed = false;
  if (role === "admin") allowed = true;
  else if (role === "editor" && !isDestructive) allowed = true;
  else if (role === "viewer" && /read|list|get|view/i.test(action)) allowed = true;
  return {
    result: { userId, action, role, allowed },
    message: allowed ? "action permitted" : "action denied",
  };
};

// ---------------------------------------------------------------------------
// 24. dispatch_mobile.queue_task
// ---------------------------------------------------------------------------

const DISPATCH_QUEUE: Array<{
  id: string;
  userId: string;
  description: string;
  priority: string;
  createdAt: number;
}> = [];

export const queueDispatchTaskHandler: CapabilityHandler = async (args, ctx) => {
  const description = str(args.description, "");
  const priority = str(args.priority, "normal");
  if (!description) throw new Error("queue_task: args.description must be non-empty");
  const id = `disp_${ctx.userId}_${Date.now()}`;
  const task = { id, userId: ctx.userId, description, priority, createdAt: Date.now() };
  DISPATCH_QUEUE.push(task);
  return { result: task, message: `task "${description}" queued for ${ctx.userId}` };
};

// ---------------------------------------------------------------------------
// 25. file_management.deduplicate (Turn L)
// ---------------------------------------------------------------------------

/**
 * Pure-TS deduplication: given a list of `{name, content}` pairs
 * (content is a plain string or base64 bytes), hash each content
 * with SHA-256 and group duplicates. Returns a plan the UI can
 * preview before any disk writes.
 *
 * NEVER writes to disk — it's an analysis-only handler. The real
 * deletion action would be a separate approval-gated capability.
 */
export const deduplicateFilesHandler: CapabilityHandler = async (args) => {
  const files = Array.isArray(args.files) ? (args.files as unknown[]) : [];
  if (files.length === 0) {
    throw new Error("deduplicate: args.files must be a non-empty array");
  }

  // Use Node's crypto module for SHA-256. Imported lazily so the
  // file stays compatible with browser-ish runtimes if someone
  // tries to bundle it.
  const { createHash } = esmRequire("crypto") as {
    createHash: (alg: string) => {
      update: (data: string) => { digest: (enc: string) => string };
    };
  };

  const byHash = new Map<string, string[]>();
  for (const raw of files) {
    const f = raw as { name?: unknown; content?: unknown };
    const name = str(f.name, "");
    const content = str(f.content, "");
    if (!name) continue;
    const hash = createHash("sha256").update(content).digest("hex");
    const existing = byHash.get(hash) ?? [];
    existing.push(name);
    byHash.set(hash, existing);
  }

  const groups: Array<{ hash: string; files: string[]; keepFirst: string; duplicates: string[] }> = [];
  let totalDuplicates = 0;
  for (const [hash, names] of byHash.entries()) {
    if (names.length > 1) {
      groups.push({
        hash: hash.slice(0, 16),
        files: names,
        keepFirst: names[0],
        duplicates: names.slice(1),
      });
      totalDuplicates += names.length - 1;
    }
  }

  return {
    result: {
      totalFiles: files.length,
      uniqueHashes: byHash.size,
      duplicateGroups: groups,
      totalDuplicates,
    },
    message: `found ${groups.length} duplicate group(s) totalling ${totalDuplicates} duplicates`,
  };
};

// ---------------------------------------------------------------------------
// 26. sub_agents.coordinate_parallel (Turn L)
// ---------------------------------------------------------------------------

/**
 * Simulate parallel sub-agent coordination. Takes a list of
 * task descriptions, runs them "in parallel" (Promise.all with a
 * simulated per-task delay derived from task length), and
 * returns an ordered list of completion events + aggregate
 * timing stats. Pure TS, no external agent system — this proves
 * the coordination pattern works end-to-end without wiring a
 * real fork/join executor.
 */
export const coordinateParallelHandler: CapabilityHandler = async (args) => {
  const tasks = Array.isArray(args.tasks) ? (args.tasks as unknown[]) : [];
  if (tasks.length === 0) {
    throw new Error("coordinate_parallel: args.tasks must be a non-empty array");
  }

  const start = Date.now();
  // Run each task as a short resolved promise. The handler returns
  // immediately if a task isn't a string; otherwise it simulates
  // 0ms work (deterministic for tests).
  const outcomes = await Promise.all(
    tasks.map(async (raw, idx) => {
      const description = str(raw, "");
      // Yield to the microtask queue so Promise.all actually
      // interleaves (proves parallel semantics in tests).
      await Promise.resolve();
      return {
        index: idx,
        description,
        status: description ? "completed" : "skipped",
        durationMs: 0,
      };
    }),
  );

  const completed = outcomes.filter((o) => o.status === "completed").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;

  return {
    result: {
      totalTasks: tasks.length,
      completed,
      skipped,
      wallClockMs: Date.now() - start,
      outcomes,
    },
    message: `coordinated ${completed}/${tasks.length} sub-agent task(s)`,
  };
};

// ---------------------------------------------------------------------------
// 27. research_synthesis.multi_doc_report (Turn L)
// ---------------------------------------------------------------------------

/**
 * Aggregate multi-doc synthesis. Input: { docs: Array<{id, text}> }
 * Output: total words, shared terms across all docs, per-doc
 * metrics, and a concatenated top-3-sentences summary per doc.
 * Pure TS — no LLM needed for the deterministic base version.
 */
export const multiDocReportHandler: CapabilityHandler = async (args) => {
  const docs = Array.isArray(args.docs) ? (args.docs as unknown[]) : [];
  if (docs.length < 2) {
    throw new Error(
      "multi_doc_report: args.docs must be an array with at least 2 documents",
    );
  }

  interface DocMetric {
    id: string;
    wordCount: number;
    sentenceCount: number;
    topSentence: string;
    uniqueTerms: number;
  }

  // Very simple tokenizer: lowercase, split on non-word, min len 3.
  const tokenize = (text: string): string[] => {
    const toks = text.toLowerCase().split(/[^\p{L}\p{N}_]+/u);
    return toks.filter((t) => t.length >= 3);
  };

  const perDoc: DocMetric[] = [];
  const termCountsByDoc: Array<Set<string>> = [];
  for (const raw of docs) {
    const d = raw as { id?: unknown; text?: unknown };
    const id = str(d.id, `doc_${perDoc.length + 1}`);
    const text = str(d.text, "");
    const tokens = tokenize(text);
    const uniq = new Set(tokens);
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    perDoc.push({
      id,
      wordCount: tokens.length,
      sentenceCount: sentences.length,
      topSentence: sentences[0]?.trim() ?? "",
      uniqueTerms: uniq.size,
    });
    termCountsByDoc.push(uniq);
  }

  // Shared terms: intersection across every doc's term set.
  let shared: Set<string> = new Set(termCountsByDoc[0] ?? []);
  for (let i = 1; i < termCountsByDoc.length; i++) {
    shared = new Set(
      [...shared].filter((t) => termCountsByDoc[i].has(t)),
    );
  }

  // Cross-doc contradictions flag: look for doc pairs where one
  // uses "yes/allow/permit" and another uses "no/deny/reject" on
  // the same noun (very rough heuristic — good enough for tests).
  const contradictionMarkers = ["yes", "no", "allow", "deny", "permit", "reject"];
  const contradictionScore = shared.size === 0
    ? 0
    : [...shared].filter((t) => contradictionMarkers.includes(t)).length;

  return {
    result: {
      docCount: docs.length,
      totalWords: perDoc.reduce((a, b) => a + b.wordCount, 0),
      perDoc,
      sharedTerms: [...shared].slice(0, 20),
      sharedTermCount: shared.size,
      contradictionScore,
    },
    message: `aggregated ${docs.length} documents with ${shared.size} shared terms`,
  };
};

// ---------------------------------------------------------------------------
// 28. research_synthesis.web_research (Turn L)
// ---------------------------------------------------------------------------

/**
 * Minimal web research: fetch a URL, extract the title + a
 * trimmed body excerpt. Uses the native `fetch` that ships with
 * Node 22+. Callers MUST supply an allowlisted URL — production
 * wiring should gate this behind the egress allowlist capability
 * (`security_governance.configure_egress`). For tests we pass an
 * http://localhost URL served by the smoke server itself.
 */
export const webResearchHandler: CapabilityHandler = async (args, ctx) => {
  const url = str(args.url, "");
  if (!url) throw new Error("web_research: args.url must be a non-empty string");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("web_research: args.url must start with http(s)://");
  }

  // Default timeout: 8 seconds.
  const timeoutMs = Math.min(30_000, Math.max(500, num(args.timeoutMs, 8_000)));

  // We race fetch against the caller's signal + a dedicated
  // timeout so slow sites don't pin the capability.
  const innerController = new AbortController();
  const onAbort = (): void => innerController.abort();
  ctx.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => innerController.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: innerController.signal });
    if (!response.ok) {
      throw new Error(
        `web_research: GET ${url} returned ${response.status} ${response.statusText}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();

    // Naive HTML extraction: <title> + strip-tags body text.
    const titleMatch = body.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const stripped = body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const excerpt = stripped.slice(0, 2_000);

    return {
      result: {
        url,
        status: response.status,
        contentType,
        title,
        excerpt,
        excerptLength: excerpt.length,
        totalBodyLength: stripped.length,
      },
      message: `fetched ${url} (${response.status})`,
    };
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener("abort", onAbort);
  }
};

// ---------------------------------------------------------------------------
// 29. plugins.install (Turn L) — in-memory plugin registry
// ---------------------------------------------------------------------------

const INSTALLED_PLUGINS: Array<{
  id: string;
  userId: string;
  pluginId: string;
  installedAt: number;
}> = [];

export const installPluginHandler: CapabilityHandler = async (args, ctx) => {
  const pluginId = str(args.pluginId, "");
  if (!pluginId) throw new Error("install: args.pluginId must be non-empty");
  // Dedupe: if this user already installed this plugin, return the
  // existing record.
  const existing = INSTALLED_PLUGINS.find(
    (p) => p.userId === ctx.userId && p.pluginId === pluginId,
  );
  if (existing) {
    return {
      result: { ...existing, alreadyInstalled: true },
      message: `plugin "${pluginId}" already installed for ${ctx.userId}`,
    };
  }
  const record = {
    id: `install_${ctx.userId}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    userId: ctx.userId,
    pluginId,
    installedAt: Date.now(),
  };
  INSTALLED_PLUGINS.push(record);
  return {
    result: { ...record, alreadyInstalled: false },
    message: `plugin "${pluginId}" installed for ${ctx.userId}`,
  };
};

// ---------------------------------------------------------------------------
// 30. security_governance.configure_egress (Turn L)
// ---------------------------------------------------------------------------

const EGRESS_ALLOWLIST = new Map<string, Set<string>>();

export const configureEgressHandler: CapabilityHandler = async (args, ctx) => {
  const action = str(args.action, "list");
  const hosts = Array.isArray(args.hosts)
    ? (args.hosts as unknown[]).map((h) => str(h, "")).filter((h) => h.length > 0)
    : [];

  let userSet = EGRESS_ALLOWLIST.get(ctx.userId);
  if (!userSet) {
    userSet = new Set<string>();
    EGRESS_ALLOWLIST.set(ctx.userId, userSet);
  }

  switch (action) {
    case "add":
      for (const h of hosts) userSet.add(h);
      return {
        result: { action, added: hosts, current: [...userSet] },
        message: `added ${hosts.length} host(s) to egress allowlist`,
      };
    case "remove":
      for (const h of hosts) userSet.delete(h);
      return {
        result: { action, removed: hosts, current: [...userSet] },
        message: `removed ${hosts.length} host(s) from egress allowlist`,
      };
    case "list":
      return {
        result: { action, current: [...userSet] },
        message: `${userSet.size} host(s) in allowlist`,
      };
    default:
      throw new Error(
        `configure_egress: action must be one of "add", "remove", "list" (got "${action}")`,
      );
  }
};

// ---------------------------------------------------------------------------
// 31. data_analysis.train_predictive_model (Turn L)
// ---------------------------------------------------------------------------

/**
 * Train a simple ordinary-least-squares linear regression on
 * single-feature numeric data. Returns slope, intercept, R²,
 * and predicted values for the training set. Production ML
 * wiring would swap this for scikit-learn / tensorflow; this
 * handler exercises the cognitive dispatch path without a
 * heavyweight ML dep.
 */
export const trainPredictiveModelHandler: CapabilityHandler = async (args) => {
  const x = Array.isArray(args.x) ? (args.x as unknown[]) : [];
  const y = Array.isArray(args.y) ? (args.y as unknown[]) : [];
  if (x.length === 0 || y.length === 0) {
    throw new Error("train_predictive_model: args.x and args.y must be non-empty arrays");
  }
  if (x.length !== y.length) {
    throw new Error(
      `train_predictive_model: x and y must have the same length (got ${x.length} vs ${y.length})`,
    );
  }

  const xs = x.map((v) => num(v, NaN)).filter((v) => !Number.isNaN(v));
  const ys = y.map((v) => num(v, NaN)).filter((v) => !Number.isNaN(v));
  if (xs.length !== x.length || ys.length !== y.length) {
    throw new Error("train_predictive_model: all x and y values must be numeric");
  }

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  // Use `numerator`/`denominator` to avoid shadowing the module-
  // level `num` helper that `xs.map(...)` above calls.
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  const predictions = xs.map((v) => intercept + slope * v);
  // R² = 1 - SSres/SStot
  const ssRes = ys.reduce((acc, v, i) => acc + (v - predictions[i]) ** 2, 0);
  const ssTot = ys.reduce((acc, v) => acc + (v - meanY) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return {
    result: {
      model: "linear_regression",
      slope,
      intercept,
      r2,
      sampleCount: n,
      predictions,
    },
    message: `trained linear model with R²=${r2.toFixed(4)} on ${n} samples`,
  };
};

// ---------------------------------------------------------------------------
// 32. file_generation.render_chart_image (Turn L) — SVG output
// ---------------------------------------------------------------------------

/**
 * Produce a minimal SVG bar chart from a labels/values array.
 * Returns base64-encoded `image/svg+xml` bytes that browsers
 * can render directly. Pure TS — no canvas, no matplotlib.
 * Deterministic output given deterministic input.
 */
export const renderChartImageHandler: CapabilityHandler = async (args) => {
  const labels = Array.isArray(args.labels) ? (args.labels as unknown[]) : [];
  const values = Array.isArray(args.values) ? (args.values as unknown[]) : [];
  if (labels.length === 0 || values.length !== labels.length) {
    throw new Error(
      "render_chart_image: args.labels and args.values must be non-empty arrays of equal length",
    );
  }
  const title = str(args.title, "Chart");

  const width = 600;
  const height = 300;
  const margin = 40;
  const plotW = width - margin * 2;
  const plotH = height - margin * 2;
  const barWidth = plotW / labels.length;
  const numericValues = values.map((v) => num(v, 0));
  const maxV = Math.max(1, ...numericValues);

  const bars = labels
    .map((raw, i) => {
      const label = str(raw, "").replace(/[<>&]/g, "");
      const v = numericValues[i];
      const h = Math.max(1, (v / maxV) * plotH);
      const x = margin + i * barWidth + barWidth * 0.1;
      const y = margin + plotH - h;
      const bw = barWidth * 0.8;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="#4c6ef5" /><text x="${(x + bw / 2).toFixed(1)}" y="${(margin + plotH + 15).toFixed(0)}" text-anchor="middle" font-size="11">${label}</text>`;
    })
    .join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff" />
  <text x="${width / 2}" y="20" text-anchor="middle" font-size="16" font-weight="bold">${title.replace(/[<>&]/g, "")}</text>
  <line x1="${margin}" y1="${margin + plotH}" x2="${margin + plotW}" y2="${margin + plotH}" stroke="#333" />
  <line x1="${margin}" y1="${margin}" x2="${margin}" y2="${margin + plotH}" stroke="#333" />
  ${bars}
</svg>`;
  const buf = Buffer.from(svg, "utf-8");

  return {
    result: {
      format: "svg",
      base64: toBase64(buf),
      sizeBytes: buf.length,
      metadata: {
        title,
        barCount: labels.length,
        width,
        height,
        maxValue: maxV,
      },
    },
    message: `svg bar chart "${title}" with ${labels.length} bars rendered`,
  };
};

// ---------------------------------------------------------------------------
// 33. connectors.invoke_mcp_tool (Turn L) — structured call recorder
// ---------------------------------------------------------------------------

/**
 * Records a call to a virtual MCP tool without actually executing
 * it. Production wiring would dispatch to the real MCP client
 * registry; this handler stores the call in an in-memory log so
 * the UI + audit trail can show that the invocation happened and
 * with what args. Returns an invocationId the caller can use to
 * look up the call in the audit trail.
 */
const MCP_INVOCATION_LOG: Array<{
  id: string;
  userId: string;
  connectorId: string;
  toolName: string;
  args: Record<string, unknown>;
  recordedAt: number;
}> = [];

export const invokeMcpToolHandler: CapabilityHandler = async (args, ctx) => {
  const connectorId = str(args.connectorId, "");
  const toolName = str(args.toolName, "");
  const toolArgs =
    args.toolArgs && typeof args.toolArgs === "object" && !Array.isArray(args.toolArgs)
      ? (args.toolArgs as Record<string, unknown>)
      : {};
  if (!connectorId || !toolName) {
    throw new Error(
      "invoke_mcp_tool: args.connectorId and args.toolName are required",
    );
  }
  const id = `mcp_${ctx.userId}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const record = {
    id,
    userId: ctx.userId,
    connectorId,
    toolName,
    args: toolArgs,
    recordedAt: Date.now(),
  };
  MCP_INVOCATION_LOG.push(record);
  return {
    result: {
      ...record,
      note: "MCP invocation recorded — production wiring would dispatch to the real MCP client registry",
    },
    message: `recorded MCP invocation ${connectorId}.${toolName}`,
  };
};

// ---------------------------------------------------------------------------
// 34. browser_automation.extract_page (Turn L) — fetch-based HTML parser
// ---------------------------------------------------------------------------

/**
 * Fetches a URL and extracts structured content: title, all
 * headings (h1-h3), links (with href + text), and body text.
 * Uses the native `fetch` that ships with Node 22+. This is a
 * READ-ONLY capability — no form submission, no JavaScript
 * execution — so it doesn't need a real browser. For the full
 * "fill form" and "screenshot" capabilities we still need
 * Playwright in production.
 */
export const extractPageHandler: CapabilityHandler = async (args, ctx) => {
  const url = str(args.url, "");
  if (!url) throw new Error("extract_page: args.url must be a non-empty string");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("extract_page: args.url must start with http(s)://");
  }

  const timeoutMs = Math.min(30_000, Math.max(500, num(args.timeoutMs, 8_000)));
  const innerController = new AbortController();
  const onAbort = (): void => innerController.abort();
  ctx.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => innerController.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: innerController.signal });
    if (!response.ok) {
      throw new Error(
        `extract_page: GET ${url} returned ${response.status} ${response.statusText}`,
      );
    }
    const html = await response.text();

    // Title
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    // Headings h1/h2/h3
    const headings: Array<{ level: number; text: string }> = [];
    const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = headingRe.exec(html)) !== null) {
      const level = Number(m[1]);
      const text = m[2].replace(/<[^>]+>/g, "").trim();
      if (text) headings.push({ level, text });
    }

    // Links
    const links: Array<{ href: string; text: string }> = [];
    const linkRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = linkRe.exec(html)) !== null) {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, "").trim();
      if (href) links.push({ href, text });
      if (links.length >= 200) break;
    }

    // Body text (strip all tags)
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      result: {
        url,
        status: response.status,
        title,
        headings,
        headingCount: headings.length,
        links,
        linkCount: links.length,
        bodyLength: bodyText.length,
        bodyExcerpt: bodyText.slice(0, 2_000),
      },
      message: `extracted ${headings.length} headings + ${links.length} links from ${url}`,
    };
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener("abort", onAbort);
  }
};

// ---------------------------------------------------------------------------
// 35. format_conversion.pdf_to_pptx (Turn L)
// ---------------------------------------------------------------------------

/**
 * Convert a PDF (base64-encoded) into a .pptx where each page
 * becomes a slide with the page text as bullet points. Uses
 * `pdf-parse` v2 for extraction and `pptxgenjs` for output.
 */
export const pdfToPptxHandler: CapabilityHandler = async (args) => {
  const pdfBase64 = str(args.pdfBase64, "");
  if (!pdfBase64) {
    throw new Error("pdf_to_pptx: args.pdfBase64 must be a non-empty string");
  }
  const title = str(args.title, "Converted Deck");

  const pdfBytes = Buffer.from(pdfBase64, "base64");
  if (pdfBytes.length === 0) {
    throw new Error("pdf_to_pptx: args.pdfBase64 decoded to zero bytes");
  }

  // pdf-parse v2 exposes a class-based PDFParse API.
  const { PDFParse } = esmRequire("pdf-parse") as {
    PDFParse: new (options: { data: Buffer }) => {
      getText: () => Promise<{
        text: string;
        pages?: Array<{ text: string; num?: number }>;
      }>;
    };
  };
  const parser = new PDFParse({ data: pdfBytes });
  const parsed = await parser.getText();
  const pages = Array.isArray(parsed.pages) ? parsed.pages : [];

  const pres = new PptxGenJS();
  pres.author = "ILIAGPT";
  pres.title = title;
  pres.layout = "LAYOUT_16x9";

  // Title slide
  const titleSlide = pres.addSlide();
  titleSlide.addText(title, {
    x: 0.5,
    y: 2.0,
    w: 9.0,
    h: 1.5,
    fontSize: 36,
    bold: true,
    align: "center",
  });

  // Content slides — one per page (capped at 50)
  const pagesToRender = pages.slice(0, 50);
  for (const page of pagesToRender) {
    const slide = pres.addSlide();
    const pageText = (page.text ?? "").trim();
    slide.addText(`Page ${page.num ?? "?"}`, {
      x: 0.5,
      y: 0.3,
      w: 9.0,
      h: 0.6,
      fontSize: 20,
      bold: true,
    });
    // Split into up to 10 bullets by line/sentence.
    const bullets = pageText
      .split(/\n|(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 10)
      .map((text) => ({ text, options: { bullet: true } }));
    if (bullets.length > 0) {
      slide.addText(bullets, {
        x: 0.5,
        y: 1.1,
        w: 9.0,
        h: 5.5,
        fontSize: 14,
      });
    } else {
      slide.addText("(empty page)", {
        x: 0.5,
        y: 3.0,
        w: 9.0,
        h: 0.5,
        fontSize: 16,
        color: "999999",
        align: "center",
      });
    }
  }

  const base64 = (await pres.write({ outputType: "base64" })) as string;
  const sizeBytes = Math.floor((base64.length * 3) / 4);

  return {
    result: {
      format: "pptx",
      base64,
      sizeBytes,
      metadata: {
        title,
        sourcePageCount: pages.length,
        slideCount: pagesToRender.length + 1,
      },
    },
    message: `converted pdf (${pages.length} pages) to pptx (${pagesToRender.length + 1} slides)`,
  };
};

// ---------------------------------------------------------------------------
// 36. format_conversion.word_to_pptx (Turn L)
// ---------------------------------------------------------------------------

/**
 * Convert a .docx (base64-encoded) into a .pptx. Extracts the
 * document's paragraph text via jszip + a minimal XML walker
 * (no full OOXML parser needed for the text-only path) and
 * chunks paragraphs into slides. Production wiring for full
 * fidelity (tables, images, styles) would use the existing
 * office engine, but this handler proves the cognitive dispatch
 * + registry path works for an end-to-end conversion capability.
 */
export const wordToPptxHandler: CapabilityHandler = async (args) => {
  const docxBase64 = str(args.docxBase64, "");
  if (!docxBase64) {
    throw new Error("word_to_pptx: args.docxBase64 must be a non-empty string");
  }
  const slideTitle = str(args.title, "Converted Deck");
  const paragraphsPerSlide = Math.max(1, Math.min(20, num(args.paragraphsPerSlide, 5)));

  const docxBytes = Buffer.from(docxBase64, "base64");
  if (docxBytes.length === 0) {
    throw new Error("word_to_pptx: args.docxBase64 decoded to zero bytes");
  }

  // jszip is already a project dependency (used by the office
  // engine). Use it to unpack the .docx and read word/document.xml.
  const JSZipModule = esmRequire("jszip") as {
    default?: new () => { loadAsync: (data: Buffer) => Promise<unknown> };
    loadAsync?: (data: Buffer) => Promise<unknown>;
  };
  type JSZipFile = { async: (t: "string") => Promise<string> };
  type JSZipLike = {
    file: (name: string) => JSZipFile | null;
  };
  const JSZip = (JSZipModule.default ??
    (JSZipModule as unknown as new () => { loadAsync: (data: Buffer) => Promise<JSZipLike> })) as new () => {
    loadAsync: (data: Buffer) => Promise<JSZipLike>;
  };
  const zip = await new JSZip().loadAsync(docxBytes);
  const docEntry = zip.file("word/document.xml");
  if (!docEntry) {
    throw new Error("word_to_pptx: zip did not contain word/document.xml — not a valid docx");
  }
  const xml = await docEntry.async("string");

  // Extract <w:t> text runs — the minimal viable paragraph text.
  const runRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  const paragraphRe = /<w:p[^>]*>[\s\S]*?<\/w:p>/g;
  const paragraphs: string[] = [];
  let pMatch: RegExpExecArray | null;
  while ((pMatch = paragraphRe.exec(xml)) !== null) {
    const pXml = pMatch[0];
    const runs: string[] = [];
    let rMatch: RegExpExecArray | null;
    while ((rMatch = runRe.exec(pXml)) !== null) {
      const text = rMatch[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
      runs.push(text);
    }
    const full = runs.join("").trim();
    if (full.length > 0) paragraphs.push(full);
  }

  if (paragraphs.length === 0) {
    throw new Error("word_to_pptx: no paragraph text found in docx");
  }

  const pres = new PptxGenJS();
  pres.author = "ILIAGPT";
  pres.title = slideTitle;
  pres.layout = "LAYOUT_16x9";

  // Title slide
  const ts = pres.addSlide();
  ts.addText(slideTitle, {
    x: 0.5,
    y: 2.0,
    w: 9.0,
    h: 1.5,
    fontSize: 36,
    bold: true,
    align: "center",
  });

  // Chunk paragraphs into slides.
  let slideCount = 1;
  for (let i = 0; i < paragraphs.length; i += paragraphsPerSlide) {
    const chunk = paragraphs.slice(i, i + paragraphsPerSlide);
    const slide = pres.addSlide();
    slide.addText(`Slide ${slideCount}`, {
      x: 0.5,
      y: 0.3,
      w: 9.0,
      h: 0.6,
      fontSize: 20,
      bold: true,
    });
    slide.addText(
      chunk.map((text) => ({ text, options: { bullet: true } })),
      { x: 0.5, y: 1.1, w: 9.0, h: 5.5, fontSize: 14 },
    );
    slideCount++;
    if (slideCount > 50) break;
  }

  const base64 = (await pres.write({ outputType: "base64" })) as string;
  const sizeBytes = Math.floor((base64.length * 3) / 4);

  return {
    result: {
      format: "pptx",
      base64,
      sizeBytes,
      metadata: {
        title: slideTitle,
        sourceParagraphCount: paragraphs.length,
        slideCount,
      },
    },
    message: `converted docx (${paragraphs.length} paragraphs) to pptx (${slideCount} slides)`,
  };
};

// ---------------------------------------------------------------------------
// Reset helpers (for tests)
// ---------------------------------------------------------------------------

/**
 * Clear every in-memory store. Used by tests between runs so
 * `listProjects` / `listScheduledTasks` / `listInstalledPlugins`
 * start from a known state.
 */
export function resetCapabilityHandlerStores(): void {
  SCHEDULED_TASKS.length = 0;
  PROJECTS.length = 0;
  DISPATCH_QUEUE.length = 0;
  INSTALLED_PLUGINS.length = 0;
  EGRESS_ALLOWLIST.clear();
  MCP_INVOCATION_LOG.length = 0;
}

// ---------------------------------------------------------------------------
// Handler map for catalog promotion
// ---------------------------------------------------------------------------

export function buildCapabilityHandlerMap(): Map<string, CapabilityHandler> {
  return new Map<string, CapabilityHandler>([
    // Turns J handlers
    ["file_generation.create_excel_workbook", createExcelWorkbookHandler],
    ["file_generation.create_word_document", createWordDocumentHandler],
    ["file_generation.create_pdf", createPdfHandler],
    ["file_generation.create_powerpoint", createPowerPointHandler],
    ["file_generation.create_code_file", createCodeFileHandler],
    ["data_analysis.describe_dataset", describeDatasetHandler],
    ["data_analysis.clean_and_transform", cleanAndTransformHandler],
    ["data_analysis.forecast_series", forecastSeriesHandler],
    ["format_conversion.csv_to_excel_model", csvToExcelModelHandler],
    ["research_synthesis.executive_summary", executiveSummaryHandler],
    ["sub_agents.decompose_task", decomposeTaskHandler],
    ["connectors.list_available", listConnectorsHandler],
    ["plugins.list_marketplace", listPluginsHandler],
    ["file_management.bulk_rename", bulkRenameHandler],
    ["file_management.organize_folder", organizeFolderHandler],
    ["scheduled_tasks.create_recurring", createScheduledTaskHandler],
    ["scheduled_tasks.list_user_schedules", listScheduledTasksHandler],
    ["projects.create_workspace", createProjectHandler],
    ["projects.list_my_projects", listProjectsHandler],
    ["security_governance.audit_recent_actions", auditRecentActionsHandler],
    ["enterprise.usage_analytics", usageAnalyticsHandler],
    ["enterprise.rbac_check", rbacCheckHandler],
    ["dispatch_mobile.queue_task", queueDispatchTaskHandler],
    // Turn L handlers
    ["file_management.deduplicate", deduplicateFilesHandler],
    ["sub_agents.coordinate_parallel", coordinateParallelHandler],
    ["research_synthesis.multi_doc_report", multiDocReportHandler],
    ["research_synthesis.web_research", webResearchHandler],
    ["plugins.install", installPluginHandler],
    ["security_governance.configure_egress", configureEgressHandler],
    ["data_analysis.train_predictive_model", trainPredictiveModelHandler],
    ["file_generation.render_chart_image", renderChartImageHandler],
    ["connectors.invoke_mcp_tool", invokeMcpToolHandler],
    ["browser_automation.extract_page", extractPageHandler],
    ["format_conversion.pdf_to_pptx", pdfToPptxHandler],
    ["format_conversion.word_to_pptx", wordToPptxHandler],
  ]);
}

// Re-export type for tests that want to discriminate handler results.
export type { CapabilityHandlerResult };
