import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import officeParser from "officeparser";
import * as XLSX from "xlsx";
import { PptxParser } from "../parsers/pptxParser";
import type { DetectedFileType } from "../parsers/base";

const MAX_PREVIEW_SHEETS = 6;
const MAX_PREVIEW_ROWS = 60;
const MAX_PREVIEW_COLS = 18;
const MAX_PREVIEW_TEXT = 80_000;
const QUICKLOOK_EXECUTABLE = "/usr/bin/qlmanage";
const QUICKLOOK_SUPPORTED_EXTENSIONS = new Set(["xls", "xlsx", "csv", "tsv", "ppt", "pptx"]);
const execFileAsync = promisify(execFile);

type PreviewKind = "docx" | "xlsx" | "csv" | "pptx" | "text" | "unknown";

export interface FilePreviewPayload {
  type: PreviewKind;
  html?: string;
  content?: string;
  truncated?: boolean;
  meta?: Record<string, unknown>;
  message?: string;
}

interface GenerateFilePreviewOptions {
  sourcePath?: string;
}

interface SpreadsheetSheetPreview {
  name: string;
  html: string;
}

interface PresentationSlidePreview {
  slideNumber: number;
  title: string;
  bodyLines: string[];
  notes?: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeCss(value: string): string {
  return value.replace(/[^#(),.%\w\s-]/g, "");
}

function normalizeArgb(argb: string | undefined): string | null {
  if (!argb) return null;
  const clean = argb.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{8}$/.test(clean)) {
    return `#${clean.slice(2)}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `#${clean}`;
  }
  return null;
}

function normalizeQuickLookCssLengths(value: string): string {
  return value.replace(
    /\b(top|left|right|bottom|width|height|min-width|max-width|min-height|max-height|margin(?:-top|-right|-bottom|-left)?|padding(?:-top|-right|-bottom|-left)?|font-size|text-indent)\s*:\s*(-?\d+(?:\.\d+)?)(?=\s*(?:;|}|$|["']))/gi,
    (_match, property: string, numericValue: string) => `${property}:${numericValue}px`,
  );
}

function quickLookAssetMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

async function inlineQuickLookAsset(assetDir: string, assetName: string): Promise<string | null> {
  if (!assetName || /^(data:|https?:|file:|\/)/i.test(assetName)) {
    return null;
  }

  const assetPath = path.resolve(assetDir, assetName);
  if (!assetPath.startsWith(assetDir + path.sep)) {
    return null;
  }

  try {
    const assetBuffer = await fs.readFile(assetPath);
    return `data:${quickLookAssetMimeType(assetName)};base64,${assetBuffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function inlineQuickLookHtml(previewHtml: string, assetDir: string): Promise<string> {
  let result = previewHtml;
  const linkMatches = [...result.matchAll(/<link[^>]+href="([^"]+)"[^>]*>/gi)];

  for (const match of linkMatches) {
    const [fullTag, href] = match;
    const assetPath = path.resolve(assetDir, href);
    if (!assetPath.startsWith(assetDir + path.sep)) {
      result = result.replace(fullTag, "");
      continue;
    }

    try {
      const css = await fs.readFile(assetPath, "utf8");
      result = result.replace(fullTag, `<style type="text/css">${normalizeQuickLookCssLengths(css)}</style>`);
    } catch {
      result = result.replace(fullTag, "");
    }
  }

  const srcMatches = [...result.matchAll(/\s(src)=["']([^"']+)["']/gi)];
  for (const match of srcMatches) {
    const [fullAttr, attrName, assetName] = match;
    const dataUri = await inlineQuickLookAsset(assetDir, assetName);
    if (dataUri) {
      result = result.replace(fullAttr, ` ${attrName}="${dataUri}"`);
    }
  }

  return normalizeQuickLookCssLengths(
    result
      .replace(/<meta[^>]*>/gi, "")
      .replace(/<title[\s\S]*?<\/title>/gi, "")
      .replace(/<\/?(html|head|body)[^>]*>/gi, "")
      .trim(),
  );
}

async function renderQuickLookPreview(previewType: PreviewKind, sourcePath?: string): Promise<FilePreviewPayload | null> {
  if (
    process.platform !== "darwin" ||
    !sourcePath ||
    !QUICKLOOK_SUPPORTED_EXTENSIONS.has(path.extname(sourcePath).toLowerCase().replace(/^\./, ""))
  ) {
    return null;
  }

  try {
    await fs.access(QUICKLOOK_EXECUTABLE);
  } catch {
    return null;
  }

  const quickLookDir = await fs.mkdtemp(path.join(os.tmpdir(), "ilia-ql-"));

  try {
    await execFileAsync(QUICKLOOK_EXECUTABLE, ["-p", "-o", quickLookDir, sourcePath], {
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    });

    const previewBundle = (await fs.readdir(quickLookDir)).find((entry) => entry.endsWith(".qlpreview"));
    if (!previewBundle) {
      return null;
    }

    const previewBundleDir = path.join(quickLookDir, previewBundle);
    const previewHtml = await fs.readFile(path.join(previewBundleDir, "Preview.html"), "utf8");
    const inlinedPreview = await inlineQuickLookHtml(previewHtml, previewBundleDir);

    return {
      type: previewType,
      html: `<div class="ilia-quicklook-preview">${inlinedPreview}</div>`,
      meta: {
        renderer: "quicklook",
      },
    };
  } catch {
    return null;
  } finally {
    await fs.rm(quickLookDir, { recursive: true, force: true }).catch(() => {});
  }
}

function renderPreviewShell(title: string, body: string, options?: { kind?: string; note?: string }): string {
  const noteHtml = options?.note
    ? `<div style="margin: 0 auto 16px; max-width: 1080px; color: #5b6474; font-size: 12px; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">${escapeHtml(options.note)}</div>`
    : "";

  return `
    <div class="ilia-preview ilia-preview-${escapeHtml(options?.kind || "document")}" style="background: linear-gradient(180deg, #eef2ff 0%, #f8fafc 100%); min-height: 100%; padding: 24px; color: #111827;">
      <div style="max-width: 1080px; margin: 0 auto 18px;">
        <div style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,0.82); border: 1px solid rgba(148, 163, 184, 0.28); box-shadow: 0 10px 25px rgba(15, 23, 42, 0.08); font: 600 12px/1.2 Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #334155;">
          <span>${escapeHtml(title)}</span>
        </div>
      </div>
      ${noteHtml}
      ${body}
    </div>
  `;
}

function columnLettersToIndex(column: string): number {
  let result = 0;
  for (const char of column.toUpperCase()) {
    result = result * 26 + (char.charCodeAt(0) - 64);
  }
  return result;
}

function decodeCellAddress(address: string): { row: number; col: number } {
  const match = /^([A-Z]+)(\d+)$/i.exec(address.trim());
  if (!match) {
    return { row: 1, col: 1 };
  }
  return {
    col: columnLettersToIndex(match[1]),
    row: Number(match[2]) || 1,
  };
}

function parseRange(range: string): { startRow: number; endRow: number; startCol: number; endCol: number } | null {
  const [start, end] = range.split(":");
  if (!start || !end) return null;
  const startPos = decodeCellAddress(start);
  const endPos = decodeCellAddress(end);
  return {
    startRow: Math.min(startPos.row, endPos.row),
    endRow: Math.max(startPos.row, endPos.row),
    startCol: Math.min(startPos.col, endPos.col),
    endCol: Math.max(startPos.col, endPos.col),
  };
}

function getCellDisplayValue(cell: ExcelJS.Cell): string {
  if (cell.value == null) return "";
  if (typeof cell.text === "string" && cell.text.length > 0) {
    return cell.text;
  }
  if (cell.value instanceof Date) {
    return cell.value.toLocaleDateString("es-ES");
  }
  if (typeof cell.value === "object" && "richText" in cell.value) {
    return (cell.value.richText as Array<{ text?: string }>).map((part) => part.text || "").join("");
  }
  return String(cell.value);
}

function buildBorderCss(border: ExcelJS.Borders | undefined): string[] {
  if (!border) return [];
  const pieces = ["top", "right", "bottom", "left"] as const;
  const css: string[] = [];

  for (const edge of pieces) {
    const edgeStyle = border[edge];
    if (!edgeStyle?.style) continue;
    const color = normalizeArgb(edgeStyle.color?.argb) || "#cbd5e1";
    css.push(`border-${edge}: 1px solid ${escapeCss(color)}`);
  }

  return css;
}

function buildCellStyle(
  cell: ExcelJS.Cell,
  columnWidth: number,
  rowHeightPx: number | null,
): string {
  const styles: string[] = [
    "padding: 6px 10px",
    "vertical-align: top",
    "white-space: pre-wrap",
    "word-break: break-word",
    "box-sizing: border-box",
    `min-width: ${Math.max(72, columnWidth)}px`,
    `max-width: ${Math.max(72, columnWidth)}px`,
  ];

  if (rowHeightPx) {
    styles.push(`min-height: ${rowHeightPx}px`);
  }

  const fillColor = normalizeArgb((cell.style.fill as any)?.fgColor?.argb);
  if (fillColor) {
    styles.push(`background: ${escapeCss(fillColor)}`);
  }

  const font = cell.style.font;
  if (font) {
    if (font.bold) styles.push("font-weight: 700");
    if (font.italic) styles.push("font-style: italic");
    if (font.underline) styles.push("text-decoration: underline");
    if (font.size) styles.push(`font-size: ${Math.max(10, Math.min(20, Number(font.size)))}px`);
    if (font.name) styles.push(`font-family: ${escapeHtml(font.name)}, Inter, sans-serif`);
    const fontColor = normalizeArgb(font.color?.argb);
    if (fontColor) {
      styles.push(`color: ${escapeCss(fontColor)}`);
    }
  }

  const alignment = cell.style.alignment;
  if (alignment?.horizontal) {
    styles.push(`text-align: ${escapeCss(alignment.horizontal)}`);
  }
  if (alignment?.vertical) {
    styles.push(`vertical-align: ${escapeCss(alignment.vertical)}`);
  }
  if (alignment?.wrapText) {
    styles.push("white-space: pre-wrap");
  }

  styles.push(...buildBorderCss(cell.style.border));
  return styles.join("; ");
}

function buildSpreadsheetSectionTitle(name: string): string {
  return `
    <div style="display: flex; align-items: center; gap: 10px; margin: 0 0 12px;">
      <div style="width: 12px; height: 12px; border-radius: 999px; background: linear-gradient(135deg, #22c55e, #16a34a); box-shadow: 0 0 0 5px rgba(34,197,94,0.12);"></div>
      <h3 style="margin: 0; font: 700 15px/1.2 Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a;">${escapeHtml(name)}</h3>
    </div>
  `;
}

async function renderXlsxSheets(buffer: Buffer): Promise<{ html: string; truncated: boolean; sheetCount: number }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheetHtml: string[] = [];
  let truncated = false;
  let processedSheets = 0;

  workbook.eachSheet((worksheet) => {
    if (processedSheets >= MAX_PREVIEW_SHEETS) {
      truncated = true;
      return;
    }

    processedSheets += 1;
    const maxRows = Math.min(worksheet.actualRowCount || worksheet.rowCount || 0, MAX_PREVIEW_ROWS);
    const maxCols = Math.min(worksheet.actualColumnCount || worksheet.columnCount || 0, MAX_PREVIEW_COLS);

    if (maxRows === 0 || maxCols === 0) {
      sheetHtml.push(`
        <section style="margin: 0 0 24px; background: #fff; border-radius: 18px; border: 1px solid #dbe4f0; box-shadow: 0 14px 34px rgba(15, 23, 42, 0.08); padding: 18px;">
          ${buildSpreadsheetSectionTitle(worksheet.name)}
          <div style="padding: 18px; border-radius: 12px; background: #f8fafc; color: #64748b; font: 500 13px/1.4 Inter, sans-serif;">Hoja vacia.</div>
        </section>
      `);
      return;
    }

    if ((worksheet.actualRowCount || 0) > MAX_PREVIEW_ROWS || (worksheet.actualColumnCount || 0) > MAX_PREVIEW_COLS) {
      truncated = true;
    }

    const mergeMeta = new Map<string, { rowSpan: number; colSpan: number }>();
    const coveredCells = new Set<string>();
    const merges = worksheet.model?.merges || [];

    for (const mergeRange of merges) {
      const parsed = parseRange(String(mergeRange));
      if (!parsed) continue;
      if (parsed.startRow > maxRows || parsed.startCol > maxCols) continue;

      const rowSpan = Math.max(1, Math.min(parsed.endRow, maxRows) - parsed.startRow + 1);
      const colSpan = Math.max(1, Math.min(parsed.endCol, maxCols) - parsed.startCol + 1);
      const masterKey = `${parsed.startRow}:${parsed.startCol}`;

      mergeMeta.set(masterKey, { rowSpan, colSpan });

      for (let row = parsed.startRow; row <= Math.min(parsed.endRow, maxRows); row += 1) {
        for (let col = parsed.startCol; col <= Math.min(parsed.endCol, maxCols); col += 1) {
          if (row === parsed.startRow && col === parsed.startCol) continue;
          coveredCells.add(`${row}:${col}`);
        }
      }
    }

    const rowsHtml: string[] = [];
    for (let row = 1; row <= maxRows; row += 1) {
      const rowRef = worksheet.getRow(row);
      const rowHeightPx = rowRef.height ? Math.round(Number(rowRef.height) * 1.333) : null;
      const cellsHtml: string[] = [];

      for (let col = 1; col <= maxCols; col += 1) {
        const key = `${row}:${col}`;
        if (coveredCells.has(key)) continue;

        const cell = worksheet.getCell(row, col);
        const merge = mergeMeta.get(key);
        const columnWidth = Math.round((Number(worksheet.getColumn(col).width || 10) * 7) + 18);
        const style = buildCellStyle(cell, columnWidth, rowHeightPx);
        const tag = row === 1 ? "th" : "td";
        const spanAttrs = [
          merge?.rowSpan && merge.rowSpan > 1 ? `rowspan="${merge.rowSpan}"` : "",
          merge?.colSpan && merge.colSpan > 1 ? `colspan="${merge.colSpan}"` : "",
        ].filter(Boolean).join(" ");

        cellsHtml.push(`<${tag} ${spanAttrs} style="${style}">${escapeHtml(getCellDisplayValue(cell)) || "&nbsp;"}</${tag}>`);
      }

      rowsHtml.push(`<tr>${cellsHtml.join("")}</tr>`);
    }

    sheetHtml.push(`
      <section style="margin: 0 0 24px; background: #fff; border-radius: 18px; border: 1px solid #dbe4f0; box-shadow: 0 14px 34px rgba(15, 23, 42, 0.08); padding: 18px; overflow: hidden;">
        ${buildSpreadsheetSectionTitle(worksheet.name)}
        <div style="overflow: auto; border-radius: 14px; border: 1px solid #dbe4f0;">
          <table style="border-collapse: collapse; width: max-content; min-width: 100%; background: #fff; font: 500 12px/1.45 Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827;">
            <tbody>${rowsHtml.join("")}</tbody>
          </table>
        </div>
      </section>
    `);
  });

  return {
    html: renderPreviewShell("Vista previa de hoja de calculo", sheetHtml.join(""), {
      kind: "spreadsheet",
      note: truncated ? "Se muestran solo las primeras hojas/filas/columnas para mantener la interfaz fluida." : undefined,
    }),
    truncated,
    sheetCount: processedSheets,
  };
}

function normalizeSheetJsCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleDateString("es-ES");
  return String(value);
}

function renderSheetJsWorkbook(buffer: Buffer, kind: "xls" | "csv" | "tsv"): { html: string; truncated: boolean; sheetCount: number } {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const names = workbook.SheetNames.slice(0, MAX_PREVIEW_SHEETS);
  const sections: SpreadsheetSheetPreview[] = [];
  let truncated = workbook.SheetNames.length > MAX_PREVIEW_SHEETS;

  for (const sheetName of names) {
    const sheet = workbook.Sheets[sheetName];
    const rows = (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][])
      .slice(0, MAX_PREVIEW_ROWS)
      .map((row) => (row as unknown[]).slice(0, MAX_PREVIEW_COLS));

    if ((XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][]).length > MAX_PREVIEW_ROWS) {
      truncated = true;
    }

    const rowsHtml = rows.map((row, rowIndex) => {
      const cells = row.map((value) => {
        const tag = rowIndex === 0 ? "th" : "td";
        const style = rowIndex === 0
          ? "padding: 6px 10px; border: 1px solid #dbe4f0; background: #f8fafc; text-align: left; font-weight: 700;"
          : "padding: 6px 10px; border: 1px solid #e2e8f0; vertical-align: top; white-space: pre-wrap; word-break: break-word;";
        return `<${tag} style="${style}">${escapeHtml(normalizeSheetJsCell(value)) || "&nbsp;"}</${tag}>`;
      }).join("");

      return `<tr>${cells}</tr>`;
    }).join("");

    sections.push({
      name: kind === "csv" || kind === "tsv" ? "Datos" : sheetName,
      html: `
        <section style="margin: 0 0 24px; background: #fff; border-radius: 18px; border: 1px solid #dbe4f0; box-shadow: 0 14px 34px rgba(15, 23, 42, 0.08); padding: 18px; overflow: hidden;">
          ${buildSpreadsheetSectionTitle(kind === "csv" || kind === "tsv" ? "Vista previa tabular" : sheetName)}
          <div style="overflow: auto; border-radius: 14px; border: 1px solid #dbe4f0;">
            <table style="border-collapse: collapse; width: max-content; min-width: 100%; background: #fff; font: 500 12px/1.45 Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827;">
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </section>
      `,
    });
  }

  return {
    html: renderPreviewShell(kind === "csv" || kind === "tsv" ? "Vista previa CSV/TSV" : "Vista previa de hoja de calculo", sections.map((section) => section.html).join(""), {
      kind: "spreadsheet",
      note: truncated ? "Se muestra una porcion del archivo para mantener el preview rapido." : undefined,
    }),
    truncated,
    sheetCount: sections.length,
  };
}

function parseSlidesFromPptText(text: string): PresentationSlidePreview[] {
  const slides: PresentationSlidePreview[] = [];
  const slidePattern = /^=== Slide (\d+)(?:: (.*?))? ===\n([\s\S]*?)(?=^=== Slide |\Z)/gm;
  let match: RegExpExecArray | null;

  while ((match = slidePattern.exec(text)) !== null) {
    const slideNumber = Number(match[1]) || slides.length + 1;
    const title = (match[2] || "").trim();
    const body = (match[3] || "").trim();
    const notesMatch = body.match(/\[Speaker Notes:\s*([\s\S]*?)\]$/);
    const notes = notesMatch?.[1]?.trim();
    const contentBody = notesMatch ? body.replace(notesMatch[0], "").trim() : body;
    const bodyLines = contentBody
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    slides.push({
      slideNumber,
      title,
      bodyLines,
      notes,
    });
  }

  return slides;
}

function renderPresentationHtml(slides: PresentationSlidePreview[]): string {
  if (slides.length === 0) {
    return renderPreviewShell("Vista previa de presentacion", `
      <section style="margin: 0 auto; max-width: 980px; background: #fff; border-radius: 24px; border: 1px solid #dbe4f0; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08); padding: 28px;">
        <p style="margin: 0; color: #64748b; font: 500 14px/1.5 Inter, sans-serif;">No se pudo detectar contenido visible en las diapositivas.</p>
      </section>
    `, { kind: "presentation" });
  }

  return renderPreviewShell("Vista previa de presentacion", slides.map((slide) => {
    const bodyHtml = slide.bodyLines.length > 0
      ? `<ul style="margin: 0; padding-left: 20px; display: grid; gap: 10px; font: 500 18px/1.45 Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #334155;">
          ${slide.bodyLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>`
      : `<p style="margin: 0; font: 500 18px/1.45 Inter, sans-serif; color: #64748b;">Sin texto detectable en esta diapositiva.</p>`;

    const notesHtml = slide.notes
      ? `<div style="margin-top: 18px; padding: 14px 16px; border-radius: 14px; background: rgba(241, 245, 249, 0.92); color: #475569; font: 500 13px/1.5 Inter, sans-serif;">
          <strong style="color: #0f172a;">Notas:</strong> ${escapeHtml(slide.notes)}
        </div>`
      : "";

    return `
      <section style="margin: 0 auto 26px; max-width: 980px; aspect-ratio: 16 / 9; min-height: 360px; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); border-radius: 26px; border: 1px solid #dbe4f0; box-shadow: 0 22px 44px rgba(15, 23, 42, 0.10); padding: 30px; display: flex; flex-direction: column; justify-content: space-between;">
        <div style="display: flex; justify-content: space-between; gap: 16px; align-items: flex-start;">
          <div>
            <div style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; background: rgba(37, 99, 235, 0.08); color: #1d4ed8; font: 700 11px/1.2 Inter, sans-serif; margin-bottom: 18px;">DIAPOSITIVA ${slide.slideNumber}</div>
            <h2 style="margin: 0 0 18px; font: 800 32px/1.08 Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; letter-spacing: -0.03em;">${escapeHtml(slide.title || `Slide ${slide.slideNumber}`)}</h2>
          </div>
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">${bodyHtml}</div>
        ${notesHtml}
      </section>
    `;
  }).join(""), {
    kind: "presentation",
    note: "Se preserva la estructura visible de las diapositivas en un layout de lectura dentro del chat.",
  });
}

async function renderDocxHtml(buffer: Buffer): Promise<FilePreviewPayload> {
  // Primary: mammoth HTML conversion with style mapping.
  try {
    const result = await mammoth.convertToHtml({ buffer }, {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Title'] => h1.title:fresh",
        "p[style-name='Subtitle'] => h2.subtitle:fresh",
        "b => strong",
        "i => em",
        "u => u",
      ],
    });

    return {
      type: "docx",
      html: renderPreviewShell("Vista previa de Word", `
        <article style="max-width: 840px; margin: 0 auto; background: #fff; border-radius: 24px; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.10); border: 1px solid #dbe4f0; padding: 36px 42px; font: 400 16px/1.7 Georgia, Cambria, 'Times New Roman', serif; color: #111827;">
          ${result.value}
        </article>
      `, { kind: "document" }),
      meta: {
        warnings: result.messages,
      },
    };
  } catch (mammothError: any) {
    console.warn("[filePreview] mammoth.convertToHtml failed, falling back to text:", mammothError?.message || mammothError);
  }

  // Fallback 1: extract raw text via officeParser (handles minimal docx that
  // mammoth chokes on because of missing styles.xml or unusual relationships).
  try {
    const text = await officeParser.parseOfficeAsync(buffer);
    if (text && text.trim().length > 0) {
      return {
        type: "text",
        content: text.slice(0, MAX_PREVIEW_TEXT),
        truncated: text.length > MAX_PREVIEW_TEXT,
        meta: {
          degraded: true,
          reason: "mammoth_failed_using_officeparser",
        } as any,
      };
    }
  } catch (officeError: any) {
    console.warn("[filePreview] officeParser fallback failed:", officeError?.message || officeError);
  }

  // Fallback 2: extract raw text directly from the docx XML parts so we never
  // return 500 for a readable document. This keeps the analyze pipeline alive.
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buffer);
    const parts: string[] = [];
    const candidates = [
      "word/document.xml",
      "word/header1.xml",
      "word/footer1.xml",
    ];
    for (const name of candidates) {
      const entry = zip.file(name);
      if (!entry) continue;
      const xml = await entry.async("string");
      // naive but safe: strip tags, collapse whitespace.
      const text = xml
        .replace(/<w:tab[^>]*\/>/g, "\t")
        .replace(/<w:br[^>]*\/>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (text) parts.push(text);
    }
    const joined = parts.join("\n\n");
    if (joined) {
      return {
        type: "text",
        content: joined.slice(0, MAX_PREVIEW_TEXT),
        truncated: joined.length > MAX_PREVIEW_TEXT,
        meta: {
          degraded: true,
          reason: "mammoth_and_officeparser_failed_using_jszip",
        } as any,
      };
    }
  } catch (zipError: any) {
    console.warn("[filePreview] jszip fallback failed:", zipError?.message || zipError);
  }

  // Last resort: degraded unknown — never throw to keep the route non-500.
  return {
    type: "unknown",
    message: "No se pudo generar la vista previa, pero el archivo se recibió correctamente.",
    meta: { degraded: true, reason: "all_docx_fallbacks_failed" } as any,
  };
}

async function renderWordLegacyText(buffer: Buffer): Promise<FilePreviewPayload> {
  const text = await officeParser.parseOfficeAsync(buffer);
  return {
    type: "text",
    content: text.slice(0, MAX_PREVIEW_TEXT),
    truncated: text.length > MAX_PREVIEW_TEXT,
  };
}

async function renderPresentationPreview(buffer: Buffer, mimeType: string, fileName: string): Promise<FilePreviewPayload> {
  try {
    const parser = new PptxParser();
    const detected: DetectedFileType = {
      mimeType,
      extension: fileName.split(".").pop()?.toLowerCase() || "pptx",
      confidence: 1,
    };
    const parsed = await parser.parse(buffer, detected);
    const slides = parseSlidesFromPptText(parsed.text);
    return {
      type: "pptx",
      html: renderPresentationHtml(slides),
      meta: {
        slideCount: slides.length,
        ...parsed.metadata,
      },
    };
  } catch (error) {
    const fallback = await officeParser.parseOfficeAsync(buffer).catch(() => "");
    return {
      type: "text",
      content: fallback.slice(0, MAX_PREVIEW_TEXT) || "No se pudo renderizar la presentacion.",
      truncated: fallback.length > MAX_PREVIEW_TEXT,
    };
  }
}

export async function generateFilePreview(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  options: GenerateFilePreviewOptions = {},
): Promise<FilePreviewPayload> {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  const quickLookType: PreviewKind | null =
    ext === "xls" || ext === "xlsx" ? "xlsx" :
    ext === "csv" || ext === "tsv" ? "csv" :
    ext === "ppt" || ext === "pptx" ? "pptx" :
    null;

  if (quickLookType) {
    const quickLookPreview = await renderQuickLookPreview(quickLookType, options.sourcePath);
    if (quickLookPreview) {
      return quickLookPreview;
    }
  }

  if (ext === "docx" || mimeType.includes("wordprocessingml")) {
    return renderDocxHtml(buffer);
  }

  if (ext === "doc" || mimeType === "application/msword") {
    return renderWordLegacyText(buffer);
  }

  if (ext === "xlsx" || mimeType.includes("spreadsheetml")) {
    const spreadsheet = await renderXlsxSheets(buffer);
    return {
      type: "xlsx",
      html: spreadsheet.html,
      truncated: spreadsheet.truncated,
      meta: {
        sheetCount: spreadsheet.sheetCount,
      },
    };
  }

  if (ext === "xls") {
    const spreadsheet = renderSheetJsWorkbook(buffer, "xls");
    return {
      type: "xlsx",
      html: spreadsheet.html,
      truncated: spreadsheet.truncated,
      meta: {
        sheetCount: spreadsheet.sheetCount,
      },
    };
  }

  if (ext === "csv" || ext === "tsv" || mimeType === "text/csv" || mimeType === "text/tab-separated-values") {
    const spreadsheet = renderSheetJsWorkbook(buffer, ext === "tsv" ? "tsv" : "csv");
    return {
      type: "csv",
      html: spreadsheet.html,
      truncated: spreadsheet.truncated,
    };
  }

  if (ext === "pptx" || ext === "ppt" || mimeType.includes("presentationml") || mimeType.includes("powerpoint")) {
    return renderPresentationPreview(buffer, mimeType, fileName);
  }

  const textExtensions = new Set(["txt", "md", "json", "xml", "html", "htm", "log", "yml", "yaml", "sh", "sql", "env"]);
  if (textExtensions.has(ext) || mimeType.startsWith("text/")) {
    const content = buffer.toString("utf-8");
    return {
      type: "text",
      content: content.slice(0, MAX_PREVIEW_TEXT),
      truncated: content.length > MAX_PREVIEW_TEXT,
    };
  }

  return {
    type: "unknown",
    message: "Preview not available",
  };
}
