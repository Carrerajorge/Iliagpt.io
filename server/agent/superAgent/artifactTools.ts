import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import { promises as fs } from "fs";
import path from "path";
import { DocumentCompiler, type CompilerFormat } from "../documents/compiler";
import { resolveTheme } from "../documents/themes";
import type { PresentationSpec, DocumentSpec, WorkbookSpec } from "../documents/documentEngine";
import { createPptxDocument } from "../../services/documentGeneration";

export interface ArtifactMeta {
  id: string;
  type: "xlsx" | "docx" | "pptx";
  name: string;
  path: string;
  downloadUrl: string;
  size: number;
  createdAt: number;
}

export interface XlsxSpec {
  title: string;
  sheets: Array<{
    name: string;
    headers: string[];
    data: any[][];
    summary?: Record<string, any>;
  }>;
}

export interface DocxSpec {
  title: string;
  sections: Array<{
    heading: string;
    level: 1 | 2 | 3;
    paragraphs: string[];
    citations?: string[];
    table?: {
      headers: string[];
      rows: string[][];
    };
  }>;
  metadata?: {
    author?: string;
    subject?: string;
    keywords?: string[];
  };
}

export interface PptxSpec {
  title: string;
  slides: Array<{
    title: string;
    bullets: string[];
    notes?: string;
  }>;
  metadata?: {
    author?: string;
    subject?: string;
  };
}

export interface CitationsPack {
  sources: Array<{
    id: string;
    url: string;
    title: string;
    snippet: string;
    accessedAt: string;
  }>;
  claims: Array<{
    text: string;
    sourceIds: string[];
  }>;
  formatted: {
    apa: string[];
    mla: string[];
    chicago: string[];
  };
}

const ARTIFACTS_DIR = path.join(process.cwd(), "uploads", "artifacts");

/* ================================================================== */
/*  SAFETY LIMITS                                                      */
/* ================================================================== */

const MAX_SHEETS = 100;
const MAX_ROWS_PER_SHEET = 100_000;
const MAX_HEADERS_PER_SHEET = 500;
const MAX_SECTIONS = 500;
const MAX_PARAGRAPHS_PER_SECTION = 500;
const MAX_SLIDES = 200;
const MAX_BULLETS_PER_SLIDE = 50;
const MAX_STRING_LENGTH = 50_000; // 50KB per string field
const MAX_SUMMARY_KEYS = 100;
const FILE_WRITE_TIMEOUT_MS = 30_000;

/** Truncate string to safe length */
function safeStr(s: string | undefined | null, max: number = MAX_STRING_LENGTH): string {
  if (!s) return "";
  return s.length > max ? s.substring(0, max) : s;
}

/** Singleton promise to prevent race conditions from concurrent mkdir calls */
let _ensureDirPromise: Promise<void> | null = null;

async function ensureArtifactsDir(): Promise<void> {
  if (!_ensureDirPromise) {
    _ensureDirPromise = fs.mkdir(ARTIFACTS_DIR, { recursive: true }).then(() => {});
  }
  return _ensureDirPromise;
}

export async function createXlsx(spec: XlsxSpec): Promise<ArtifactMeta> {
  await ensureArtifactsDir();

  // Input validation
  if (!spec.sheets || spec.sheets.length === 0) throw new Error("No sheets in spec");
  if (spec.sheets.length > MAX_SHEETS) throw new Error(`Too many sheets: ${spec.sheets.length} (max ${MAX_SHEETS})`);

  const id = randomUUID();
  const safeTitle = safeStr(spec.title, 200).replace(/[^a-zA-Z0-9]/g, "_").substring(0, 80) || "workbook";
  const filename = `${safeTitle}_${id.substring(0, 8)}.xlsx`;
  const filepath = path.join(ARTIFACTS_DIR, filename);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IliaGPT Super Agent";
  workbook.created = new Date();

  for (const sheetSpec of spec.sheets.slice(0, MAX_SHEETS)) {
    const safeName = safeStr(sheetSpec.name, 31) || "Sheet";
    const sheet = workbook.addWorksheet(safeName);

    const headers = (sheetSpec.headers || []).slice(0, MAX_HEADERS_PER_SHEET);
    sheet.columns = headers.map((header, idx) => ({
      header: safeStr(header, 255),
      key: `col_${idx}`,
      width: Math.max(Math.min(header.length + 5, 60), 15),
    }));

    const headerRow = sheet.getRow(1);
    if (headerRow) {
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };
    }

    const data = (sheetSpec.data || []).slice(0, MAX_ROWS_PER_SHEET);
    for (const rowData of data) {
      const rowObj: Record<string, any> = {};
      const cells = Array.isArray(rowData) ? rowData.slice(0, MAX_HEADERS_PER_SHEET) : [];
      cells.forEach((cell, idx) => {
        rowObj[`col_${idx}`] = typeof cell === "string" ? safeStr(cell, 32_767) : cell;
      });
      sheet.addRow(rowObj);
    }

    if (sheetSpec.summary && typeof sheetSpec.summary === "object") {
      const entries = Object.entries(sheetSpec.summary).slice(0, MAX_SUMMARY_KEYS);
      sheet.addRow([]);
      sheet.addRow(["Summary"]);
      for (const [key, value] of entries) {
        sheet.addRow([safeStr(String(key), 255), safeStr(String(value ?? ""), 1000)]);
      }
    }

    if (headers.length > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };
    }
  }

  try {
    await workbook.xlsx.writeFile(filepath);
    const stats = await fs.stat(filepath);
    return {
      id,
      type: "xlsx",
      name: filename,
      path: filepath,
      downloadUrl: `/api/super/artifacts/${id}/download`,
      size: stats.size,
      createdAt: Date.now(),
    };
  } catch (err) {
    // Cleanup orphaned file on error
    await fs.unlink(filepath).catch(() => {});
    throw err;
  }
}

export async function createDocx(spec: DocxSpec): Promise<ArtifactMeta> {
  await ensureArtifactsDir();

  // Input validation
  if (!spec.sections || spec.sections.length === 0) throw new Error("No sections in spec");
  if (spec.sections.length > MAX_SECTIONS) throw new Error(`Too many sections: ${spec.sections.length} (max ${MAX_SECTIONS})`);

  const id = randomUUID();
  const safeTitle = safeStr(spec.title, 200).replace(/[^a-zA-Z0-9]/g, "_").substring(0, 80) || "document";
  const filename = `${safeTitle}_${id.substring(0, 8)}.docx`;
  const filepath = path.join(ARTIFACTS_DIR, filename);

  const children: any[] = [];

  children.push(
    new Paragraph({
      text: safeStr(spec.title, 500),
      heading: HeadingLevel.TITLE,
      spacing: { after: 400 },
    })
  );

  for (const section of spec.sections.slice(0, MAX_SECTIONS)) {
    const headingLevel = section.level === 1 ? HeadingLevel.HEADING_1 :
                        section.level === 2 ? HeadingLevel.HEADING_2 :
                        HeadingLevel.HEADING_3;

    children.push(
      new Paragraph({
        text: safeStr(section.heading, 500),
        heading: headingLevel,
        spacing: { before: 300, after: 200 },
      })
    );

    const paragraphs = (section.paragraphs || []).slice(0, MAX_PARAGRAPHS_PER_SECTION);
    for (const para of paragraphs) {
      children.push(
        new Paragraph({
          children: [new TextRun(safeStr(para))],
          spacing: { after: 200 },
        })
      );
    }

    if (section.table) {
      const tableRows: TableRow[] = [];
      const headers = (section.table.headers || []).slice(0, MAX_HEADERS_PER_SHEET);

      if (headers.length > 0) {
        tableRows.push(
          new TableRow({
            children: headers.map(header =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: safeStr(header, 255), bold: true })] })],
                width: { size: 100 / headers.length, type: WidthType.PERCENTAGE },
              })
            ),
          })
        );

        const rows = (section.table.rows || []).slice(0, MAX_ROWS_PER_SHEET);
        for (const row of rows) {
          // Ensure row cells match header count
          const cells = Array.isArray(row) ? row.slice(0, headers.length) : [];
          while (cells.length < headers.length) cells.push("");
          tableRows.push(
            new TableRow({
              children: cells.map(cell =>
                new TableCell({
                  children: [new Paragraph(safeStr(String(cell ?? ""), 32_767))],
                })
              ),
            })
          );
        }

        children.push(
          new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          })
        );
      }
    }

    if (section.citations && section.citations.length > 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "References:", italics: true })],
          spacing: { before: 200 },
        })
      );

      for (const citation of section.citations.slice(0, 200)) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `• ${safeStr(citation, 2000)}`, size: 20 })],
          })
        );
      }
    }
  }

  const doc = new Document({
    creator: safeStr(spec.metadata?.author, 200) || "IliaGPT Super Agent",
    title: safeStr(spec.title, 500),
    subject: safeStr(spec.metadata?.subject, 500),
    keywords: spec.metadata?.keywords?.slice(0, 50).map(k => safeStr(k, 100)).join(", "),
    sections: [{
      children,
    }],
  });

  try {
    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(filepath, buffer);
    const stats = await fs.stat(filepath);
    return {
      id,
      type: "docx",
      name: filename,
      path: filepath,
      downloadUrl: `/api/super/artifacts/${id}/download`,
      size: stats.size,
      createdAt: Date.now(),
    };
  } catch (err) {
    await fs.unlink(filepath).catch(() => {});
    throw err;
  }
}

export async function createPptx(spec: PptxSpec): Promise<ArtifactMeta> {
  await ensureArtifactsDir();

  // Input validation
  if (!spec.slides || spec.slides.length === 0) throw new Error("No slides in spec");
  if (spec.slides.length > MAX_SLIDES) throw new Error(`Too many slides: ${spec.slides.length} (max ${MAX_SLIDES})`);

  const id = randomUUID();
  const safeTitle = safeStr(spec.title, 200).replace(/[^a-zA-Z0-9]/g, "_").substring(0, 80) || "presentation";
  const filename = `${safeTitle}_${id.substring(0, 8)}.pptx`;
  const filepath = path.join(ARTIFACTS_DIR, filename);

  const pptx = createPptxDocument();
  pptx.author = safeStr(spec.metadata?.author, 200) || "IliaGPT Super Agent";
  pptx.subject = safeStr(spec.metadata?.subject, 500) || safeStr(spec.title, 500);
  pptx.title = safeStr(spec.title, 500);

  // Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.addText(safeStr(spec.title, 500), {
    x: 0.5, y: 1.5, w: 9, h: 2,
    fontSize: 32, bold: true, color: "1A1A2E",
    align: "center", valign: "middle",
  });
  titleSlide.addText(safeStr(spec.metadata?.author, 200) || "IliaGPT Super Agent", {
    x: 0.5, y: 4, w: 9, h: 0.5,
    fontSize: 14, color: "666666",
    align: "center",
  });

  // Content slides (capped)
  for (const slideSpec of spec.slides.slice(0, MAX_SLIDES)) {
    const slide = pptx.addSlide();

    slide.addText(safeStr(slideSpec.title, 500), {
      x: 0.5, y: 0.3, w: 9, h: 0.8,
      fontSize: 24, bold: true, color: "1A1A2E",
    });

    const bullets = (slideSpec.bullets || []).slice(0, MAX_BULLETS_PER_SLIDE);
    const bulletText = bullets.map(b => ({
      text: safeStr(b, 5000),
      options: { fontSize: 16, color: "333333", bullet: true, breakLine: true } as any,
    }));

    if (bulletText.length > 0) {
      slide.addText(bulletText, {
        x: 0.5, y: 1.3, w: 9, h: 3.8,
        valign: "top",
      });
    }

    if (slideSpec.notes) {
      slide.addNotes(safeStr(slideSpec.notes, 100_000));
    }
  }

  try {
    const pptxBuffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
    await fs.writeFile(filepath, pptxBuffer);
    const stats = await fs.stat(filepath);
    return {
      id,
      type: "pptx",
      name: filename,
      path: filepath,
      downloadUrl: `/api/super/artifacts/${id}/download`,
      size: stats.size,
      createdAt: Date.now(),
    };
  } catch (err) {
    await fs.unlink(filepath).catch(() => {});
    throw err;
  }
}

/* ================================================================== */
/*  COMPILER-BASED ARTIFACT CREATION                                   */
/* ================================================================== */

const _compiler = new DocumentCompiler("corporate");

/**
 * Create any document artifact through the unified compiler.
 * Falls back to legacy creation functions on compiler error.
 */
export async function createArtifactCompiled(
  format: "xlsx" | "docx" | "pptx",
  spec: XlsxSpec | DocxSpec | PptxSpec,
  theme?: string
): Promise<ArtifactMeta> {
  await ensureArtifactsDir();

  const id = randomUUID();
  const safeTitle = safeStr(spec.title, 200).replace(/[^a-zA-Z0-9]/g, "_").substring(0, 80) || "document";
  const filename = `${safeTitle}_${id.substring(0, 8)}.${format}`;
  const filepath = path.join(ARTIFACTS_DIR, filename);

  try {
    // Convert legacy spec to compiler spec format
    const compilerSpec = convertLegacyToCompilerSpec(format, spec);
    const result = await _compiler.compile({
      format,
      spec: compilerSpec,
      theme: theme || "corporate",
    });

    await fs.writeFile(filepath, result.buffer);

    if (result.metrics.degraded) {
      const issueMsg = Array.isArray(result.validation.issues)
        ? result.validation.issues.slice(0, 10).map(i => i.message).join(", ")
        : "unknown";
      console.warn(`[ArtifactTools] Compiled ${format} in degraded mode: ${issueMsg}`);
    }

    const meta: ArtifactMeta = {
      id,
      type: format,
      name: filename,
      path: filepath,
      downloadUrl: `/api/super/artifacts/${id}/download`,
      size: result.metrics.sizeBytes,
      createdAt: Date.now(),
    };
    storeArtifactMeta(meta);
    return meta;
  } catch (err) {
    // Fallback to legacy creation
    console.warn(`[ArtifactTools] Compiler failed for ${format}, falling back to legacy: ${err instanceof Error ? err.message : String(err)}`);
    switch (format) {
      case "xlsx": return createXlsx(spec as XlsxSpec);
      case "docx": return createDocx(spec as DocxSpec);
      case "pptx": return createPptx(spec as PptxSpec);
    }
  }
}

function convertLegacyToCompilerSpec(
  format: string,
  spec: XlsxSpec | DocxSpec | PptxSpec
): PresentationSpec | DocumentSpec | WorkbookSpec {
  switch (format) {
    case "pptx": {
      const s = spec as PptxSpec;
      const safeTitle = safeStr(s.title, 500);
      return {
        format: "pptx" as const,
        title: safeTitle,
        author: safeStr(s.metadata?.author, 200),
        slides: [
          {
            type: "cover" as const,
            components: [
              { type: "title" as const, content: safeTitle },
              { type: "subtitle" as const, content: safeStr(s.metadata?.author, 200) || "IliaGPT" },
            ],
          },
          ...s.slides.slice(0, MAX_SLIDES).map(slide => ({
            type: "content" as const,
            components: [
              { type: "title" as const, content: safeStr(slide.title, 500) },
              ...((slide.bullets || []).length > 0
                ? [{ type: "bullets" as const, content: (slide.bullets || []).slice(0, MAX_BULLETS_PER_SLIDE).map(b => safeStr(b, 5000)) }]
                : []),
            ],
            notes: slide.notes ? safeStr(slide.notes, 100_000) : undefined,
          })),
        ],
      } satisfies PresentationSpec;
    }

    case "docx": {
      const s = spec as DocxSpec;
      const sections: DocumentSpec["sections"] = [];
      for (const sec of (s.sections || []).slice(0, MAX_SECTIONS)) {
        sections.push({
          type: "heading",
          level: sec.level,
          content: safeStr(sec.heading, 500),
        });
        for (const para of (sec.paragraphs || []).slice(0, MAX_PARAGRAPHS_PER_SECTION)) {
          sections.push({ type: "paragraph", content: safeStr(para) });
        }
        if (sec.table) {
          const headers = (sec.table.headers || []).slice(0, MAX_HEADERS_PER_SHEET);
          const rows = (sec.table.rows || []).slice(0, MAX_ROWS_PER_SHEET);
          sections.push({
            type: "table",
            content: [
              headers.map(h => safeStr(h, 255)),
              ...rows.map(row =>
                (row || []).slice(0, headers.length).map(cell => safeStr(String(cell ?? ""), 32_767))
              ),
            ],
          });
        }
        if (sec.citations?.length) {
          sections.push({
            type: "bullets",
            content: sec.citations.slice(0, 200).map(c => safeStr(c, 2000)),
          });
        }
      }
      return {
        format: "docx" as const,
        title: safeStr(s.title, 500),
        author: safeStr(s.metadata?.author, 200),
        subject: safeStr(s.metadata?.subject, 500),
        sections,
      } satisfies DocumentSpec;
    }

    case "xlsx": {
      const s = spec as XlsxSpec;
      return {
        format: "xlsx" as const,
        title: safeStr(s.title, 500),
        sheets: s.sheets.slice(0, MAX_SHEETS).map(sheet => {
          const headers = (sheet.headers || []).slice(0, MAX_HEADERS_PER_SHEET);
          const data = (sheet.data || []).slice(0, MAX_ROWS_PER_SHEET);
          return {
            name: safeStr(sheet.name, 31) || "Sheet",
            columns: headers.map((h, idx) => ({
              key: `col_${idx}`,
              header: safeStr(h, 255),
              type: "string" as const,
              width: Math.max(Math.min(String(h).length + 5, 60), 15),
            })),
            rows: data.map(row => {
              const obj: Record<string, any> = {};
              const cells = Array.isArray(row) ? row.slice(0, headers.length) : [];
              cells.forEach((cell, idx) => { obj[`col_${idx}`] = cell; });
              return obj;
            }),
            formulas: [],
            filters: true,
            freezeRow: 1,
            freezeCol: 0,
            protection: false,
          };
        }),
      } satisfies WorkbookSpec;
    }

    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

export function packCitations(
  sources: Array<{ id: string; url: string; title: string; snippet: string }>,
  claims: Array<{ text: string; sourceIds: string[] }>
): CitationsPack {
  const now = new Date().toISOString().split("T")[0];
  
  const formattedSources = sources.map(s => ({
    ...s,
    accessedAt: now,
  }));
  
  const apa: string[] = [];
  const mla: string[] = [];
  const chicago: string[] = [];
  
  for (const source of sources) {
    let domain = "unknown";
    try {
      domain = new URL(source.url).hostname;
    } catch {
      // Invalid URL — use fallback domain
    }

    apa.push(`${source.title}. (${new Date().getFullYear()}). Retrieved from ${source.url}`);
    mla.push(`"${source.title}." ${domain}, ${source.url}. Accessed ${now}.`);
    chicago.push(`"${source.title}." ${domain}. Accessed ${now}. ${source.url}.`);
  }
  
  return {
    sources: formattedSources,
    claims,
    formatted: { apa, mla, chicago },
  };
}

export async function getArtifact(id: string): Promise<{ path: string; name: string; type: string } | null> {
  // Sanitize ID to prevent path traversal (only allow alphanumeric + hyphens)
  const safeId = id.replace(/[^a-zA-Z0-9-]/g, "");
  // Require at least a full UUID (36 chars with hyphens), or first 8 as minimum
  if (safeId.length < 8) return null;

  // 1. Check in-memory artifact store first (fast path, no I/O)
  const meta = artifactStore.get(safeId);
  if (meta) {
    // Verify file still exists, is within ARTIFACTS_DIR, and is not a symlink
    const resolved = path.resolve(meta.path);
    if (!resolved.startsWith(path.resolve(ARTIFACTS_DIR))) return null;
    try {
      const stat = await fs.lstat(resolved);
      if (stat.isSymbolicLink()) { artifactStore.delete(safeId); return null; }
      return { path: resolved, name: meta.name, type: meta.type };
    } catch {
      // File was deleted; remove stale metadata
      artifactStore.delete(safeId);
    }
  }

  // 2. Fallback to filesystem scan (slow path)
  await ensureArtifactsDir();

  const READDIR_TIMEOUT_MS = 5000;
  let files: string[];
  try {
    files = await Promise.race([
      fs.readdir(ARTIFACTS_DIR),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Artifact readdir timeout")), READDIR_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    console.warn(`[ArtifactTools] readdir failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  // Use full safeId match first, then fall back to 8-char prefix (but prefer exact)
  const exactMatch = files.find(f => f.includes(safeId));
  const prefixMatch = !exactMatch ? files.find(f => f.includes(safeId.substring(0, 8))) : null;
  const match = exactMatch || prefixMatch;

  if (match) {
    // Double-check resolved path stays within ARTIFACTS_DIR
    const resolved = path.resolve(ARTIFACTS_DIR, match);
    const safePrefix = path.resolve(ARTIFACTS_DIR) + path.sep;
    if (!resolved.startsWith(safePrefix) && resolved !== path.resolve(ARTIFACTS_DIR)) {
      console.warn(`[ArtifactTools] Path traversal attempt blocked: ${match}`);
      return null;
    }
    // Reject symlinks to prevent escape from artifacts dir
    try {
      const fstat = await fs.lstat(resolved);
      if (fstat.isSymbolicLink()) {
        console.warn(`[ArtifactTools] Symlink rejected: ${match}`);
        return null;
      }
    } catch { return null; }
    const ext = path.extname(match).slice(1);
    return {
      path: resolved,
      name: match,
      type: ext as "xlsx" | "docx" | "pptx",
    };
  }

  return null;
}

/** In-memory artifact metadata cache with LRU eviction to prevent unbounded growth. */
const ARTIFACT_STORE_MAX = 10_000;
const artifactStore = new Map<string, ArtifactMeta>();

export function storeArtifactMeta(meta: ArtifactMeta): void {
  // Evict oldest entry when at capacity (Map preserves insertion order)
  if (artifactStore.size >= ARTIFACT_STORE_MAX) {
    const oldestKey = artifactStore.keys().next().value;
    if (oldestKey) artifactStore.delete(oldestKey);
  }
  artifactStore.set(meta.id, meta);
}

export function getArtifactMeta(id: string): ArtifactMeta | undefined {
  return artifactStore.get(id);
}

export function listArtifacts(): ArtifactMeta[] {
  return Array.from(artifactStore.values());
}
