/** OpenClaw Document Analyzer — extracts content from any document type. */
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface DocumentAnalysis {
  id: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  extractedText: string;
  structure: DocumentStructure;
  metadata: Record<string, string>;
  processingMs: number;
}

export interface DocumentStructure {
  type: "document" | "spreadsheet" | "presentation" | "pdf" | "image" | "code" | "data";
  pageCount?: number;
  slideCount?: number;
  sheetNames?: string[];
  headings?: string[];
  tables?: number;
  images?: number;
  formulas?: string[];
  codeLanguage?: string;
}

const EXT_TO_MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".py": "text/x-python",
  ".html": "text/html",
  ".xml": "application/xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const CODE_EXTENSIONS = new Set([".js", ".ts", ".py", ".html", ".xml", ".css", ".java", ".go", ".rs", ".rb", ".sh"]);

function mimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_MIME[ext] || "application/octet-stream";
}

function structureTypeFromMime(mime: string): DocumentStructure["type"] {
  if (mime.includes("spreadsheet") || mime === "text/csv" || mime === "text/tab-separated-values") return "spreadsheet";
  if (mime.includes("presentation")) return "presentation";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/json") return "data";
  if (mime.includes("javascript") || mime.includes("typescript") || mime.includes("python")) return "code";
  return "document";
}

async function extractDocx(buffer: Buffer): Promise<{ text: string; structure: Partial<DocumentStructure> }> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const headings: string[] = [];
  try {
    const htmlResult = await mammoth.convertToHtml({ buffer });
    const headingRegex = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi;
    let match: RegExpExecArray | null;
    while ((match = headingRegex.exec(htmlResult.value)) !== null) {
      headings.push(match[1].replace(/<[^>]+>/g, "").trim());
    }
  } catch { /* headings are optional */ }
  return { text: result.value, structure: { headings, type: "document" } };
}

async function extractXlsx(buffer: Buffer): Promise<{ text: string; structure: Partial<DocumentStructure> }> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetNames: string[] = [];
  const formulas: string[] = [];
  const lines: string[] = [];
  let tableCount = 0;

  workbook.eachSheet((sheet) => {
    sheetNames.push(sheet.name);
    tableCount++;
    sheet.eachRow((row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => {
        if (v && typeof v === "object" && "formula" in (v as Record<string, unknown>)) {
          formulas.push(String((v as Record<string, unknown>).formula));
          return String((v as Record<string, unknown>).result ?? "");
        }
        return v == null ? "" : String(v);
      });
      lines.push(values.join("\t"));
    });
    lines.push("");
  });

  return { text: lines.join("\n").trim(), structure: { sheetNames, formulas, tables: tableCount, type: "spreadsheet" } };
}

async function extractPptx(buffer: Buffer): Promise<{ text: string; structure: Partial<DocumentStructure> }> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideTexts: string[] = [];
  let slideCount = 0;
  let imageCount = 0;

  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort();

  for (const slideFile of slideFiles) {
    slideCount++;
    const xml = await zip.file(slideFile)!.async("text");
    const textParts: string[] = [];
    const tagRegex = /<a:t>(.*?)<\/a:t>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(xml)) !== null) {
      textParts.push(match[1]);
    }
    slideTexts.push(`--- Slide ${slideCount} ---\n${textParts.join(" ")}`);
  }

  const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith("ppt/media/"));
  imageCount = mediaFiles.length;

  return { text: slideTexts.join("\n\n"), structure: { slideCount, images: imageCount, type: "presentation" } };
}

async function extractPdf(buffer: Buffer): Promise<{ text: string; structure: Partial<DocumentStructure> }> {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  return { text: data.text, structure: { pageCount: data.numpages, type: "pdf" } };
}

function extractCsvTsv(buffer: Buffer, delimiter: string): { text: string; structure: Partial<DocumentStructure> } {
  const text = buffer.toString("utf-8");
  const lines = text.split("\n").filter((l) => l.trim());
  const headings = lines.length > 0 ? lines[0].split(delimiter).map((h) => h.trim()) : [];
  return { text, structure: { headings, tables: 1, type: "spreadsheet" } };
}

function extractJson(buffer: Buffer): { text: string; structure: Partial<DocumentStructure> } {
  const raw = buffer.toString("utf-8");
  try {
    const parsed = JSON.parse(raw);
    return { text: JSON.stringify(parsed, null, 2), structure: { type: "data" } };
  } catch {
    return { text: raw, structure: { type: "data" } };
  }
}

function extractPlainText(buffer: Buffer, filename: string): { text: string; structure: Partial<DocumentStructure> } {
  const text = buffer.toString("utf-8");
  const ext = path.extname(filename).toLowerCase();
  const isCode = CODE_EXTENSIONS.has(ext);
  const headings: string[] = [];

  if (ext === ".md") {
    const headingRegex = /^#{1,6}\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = headingRegex.exec(text)) !== null) {
      headings.push(match[1].trim());
    }
  }

  return {
    text,
    structure: {
      type: isCode ? "code" : "document",
      headings: headings.length ? headings : undefined,
      codeLanguage: isCode ? ext.slice(1) : undefined,
    },
  };
}

function extractImage(buffer: Buffer, mime: string): { text: string; structure: Partial<DocumentStructure> } {
  return {
    text: `[Image file: ${mime}, ${buffer.length} bytes. OCR not yet available.]`,
    structure: { type: "image", images: 1 },
  };
}

export class OpenClawDocumentAnalyzer {
  /** Analyze a document buffer and extract content. */
  async analyze(buffer: Buffer, filename: string, userId: string): Promise<DocumentAnalysis> {
    const start = Date.now();
    const mimeType = mimeFromFilename(filename);
    const id = randomUUID();

    let text = "";
    let structure: DocumentStructure = { type: structureTypeFromMime(mimeType) };
    const metadata: Record<string, string> = { originalFilename: filename };

    try {
      const result = await this.extractText(buffer, mimeType, filename);
      text = result.text;
      structure = { ...structure, ...result.structure };
    } catch (err) {
      text = `[Extraction failed: ${err instanceof Error ? err.message : String(err)}]`;
      metadata.extractionError = err instanceof Error ? err.message : String(err);
    }

    return {
      id,
      userId,
      filename,
      mimeType,
      sizeBytes: buffer.length,
      extractedText: text,
      structure,
      metadata,
      processingMs: Date.now() - start,
    };
  }

  /** Route to format-specific extractor. */
  private async extractText(
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<{ text: string; structure: Partial<DocumentStructure> }> {
    if (mimeType.includes("wordprocessingml")) return extractDocx(buffer);
    if (mimeType.includes("spreadsheetml")) return extractXlsx(buffer);
    if (mimeType.includes("presentationml")) return extractPptx(buffer);
    if (mimeType === "application/pdf") return extractPdf(buffer);
    if (mimeType === "text/csv") return extractCsvTsv(buffer, ",");
    if (mimeType === "text/tab-separated-values") return extractCsvTsv(buffer, "\t");
    if (mimeType === "application/json") return extractJson(buffer);
    if (mimeType.startsWith("image/")) return extractImage(buffer, mimeType);
    // Fallback: treat as plain text / code
    return extractPlainText(buffer, filename);
  }
}

export const documentAnalyzer = new OpenClawDocumentAnalyzer();
