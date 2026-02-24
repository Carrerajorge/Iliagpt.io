import Tesseract from "tesseract.js";
import { createRequire } from "node:module";

// Use createRequire to load pdf-parse via CommonJS — dynamic import() causes
// an API/Worker version mismatch ("4.10.38" vs "5.4.296") at runtime.
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

async function parsePdfBuffer(buffer: Buffer): Promise<{ text: string; numpages: number; info: Record<string, unknown> }> {
  if (!PDFParse) {
    throw new Error('pdf-parse module did not export PDFParse class');
  }

  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();

  // Get document info if available
  let info: Record<string, unknown> = {};
  try {
    const infoResult = await parser.getInfo();
    info = infoResult.info || {};
  } catch {
    // getInfo may fail on some PDFs, continue without metadata
  }

  return {
    text: result.text || "",
    numpages: result.pages?.length || 1,
    info
  };
}
import type {
  DocumentSemanticModel,
  Table,
  TableCell,
  Section,
  SourceReference,
} from "../../../shared/schemas/documentSemanticModel";

const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46];

const MIN_TEXT_LENGTH_PER_PAGE = 50;
const OCR_CONFIDENCE_THRESHOLD = 60;

function detectMimeType(buffer: Buffer): string {
  if (buffer.length >= 4) {
    const isPdf = PDF_MAGIC_BYTES.every((byte, i) => buffer[i] === byte);
    if (isPdf) {
      return "application/pdf";
    }
  }
  return "application/octet-stream";
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function countWords(text: string): number {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

function normalizeText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .normalize("NFKC");
}

function isScannedPdf(text: string, pageCount: number): boolean {
  if (!text || text.trim().length === 0) {
    return true;
  }
  const avgCharsPerPage = text.trim().length / Math.max(pageCount, 1);
  return avgCharsPerPage < MIN_TEXT_LENGTH_PER_PAGE;
}

interface TableDetectionResult {
  tables: Array<{
    headers: string[];
    rows: string[][];
    startLine: number;
    endLine: number;
  }>;
  nonTableContent: string;
}

function detectTablesFromText(text: string): TableDetectionResult {
  const lines = text.split("\n");
  const tables: Array<{
    headers: string[];
    rows: string[][];
    startLine: number;
    endLine: number;
  }> = [];
  const nonTableLines: string[] = [];

  let currentTable: {
    headers: string[];
    rows: string[][];
    startLine: number;
    endLine: number;
  } | null = null;
  let consecutiveTableRows = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line) {
      if (currentTable && consecutiveTableRows >= 2) {
        currentTable.endLine = i - 1;
        tables.push(currentTable);
        currentTable = null;
        consecutiveTableRows = 0;
      } else if (currentTable) {
        nonTableLines.push(...currentTable.rows.flat());
        currentTable = null;
        consecutiveTableRows = 0;
      }
      nonTableLines.push("");
      continue;
    }

    const isTableRow = detectTableRow(line);

    if (isTableRow) {
      const cells = parseTableRow(line);
      
      if (!currentTable) {
        currentTable = {
          headers: cells,
          rows: [],
          startLine: i,
          endLine: i,
        };
        consecutiveTableRows = 1;
      } else {
        currentTable.rows.push(cells);
        currentTable.endLine = i;
        consecutiveTableRows++;
      }
    } else {
      if (currentTable && consecutiveTableRows >= 3) {
        tables.push(currentTable);
      } else if (currentTable) {
        nonTableLines.push(currentTable.headers.join(" | "));
        for (const row of currentTable.rows) {
          nonTableLines.push(row.join(" | "));
        }
      }
      currentTable = null;
      consecutiveTableRows = 0;
      nonTableLines.push(line);
    }
  }

  if (currentTable && consecutiveTableRows >= 3) {
    tables.push(currentTable);
  } else if (currentTable) {
    nonTableLines.push(currentTable.headers.join(" | "));
    for (const row of currentTable.rows) {
      nonTableLines.push(row.join(" | "));
    }
  }

  return {
    tables,
    nonTableContent: nonTableLines.join("\n"),
  };
}

function detectTableRow(line: string): boolean {
  const tabDelimited = line.includes("\t") && line.split("\t").length >= 2;
  const pipeDelimited = line.includes("|") && line.split("|").length >= 3;
  const multipleSpaces = /\s{2,}/.test(line) && line.split(/\s{2,}/).filter(s => s.trim()).length >= 3;
  const commaDelimited = line.includes(",") && line.split(",").length >= 3 && !/[a-zA-Z]{10,}/.test(line);
  
  return tabDelimited || pipeDelimited || multipleSpaces || commaDelimited;
}

function parseTableRow(line: string): string[] {
  if (line.includes("\t")) {
    return line.split("\t").map((c) => c.trim()).filter((c) => c);
  }
  if (line.includes("|")) {
    return line.split("|").map((c) => c.trim()).filter((c) => c);
  }
  if (/\s{2,}/.test(line)) {
    return line.split(/\s{2,}/).map((c) => c.trim()).filter((c) => c);
  }
  if (line.includes(",")) {
    return line.split(",").map((c) => c.trim()).filter((c) => c);
  }
  return [line];
}

function detectCellType(value: string): TableCell["type"] {
  if (!value || value.trim() === "") {
    return "empty";
  }

  const trimmed = value.trim();

  if (trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "false") {
    return "boolean";
  }

  if (
    /^\d{4}-\d{2}-\d{2}/.test(trimmed) ||
    /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(trimmed)
  ) {
    return "date";
  }

  const cleanNum = trimmed.replace(/,/g, "").replace(/[%$€£¥]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(cleanNum)) {
    return "number";
  }

  return "text";
}

function parseValue(value: string): string | number | boolean | null {
  const trimmed = value.trim();

  if (
    trimmed === "" ||
    trimmed.toLowerCase() === "null" ||
    trimmed.toLowerCase() === "n/a"
  ) {
    return null;
  }

  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;

  const cleanNum = trimmed.replace(/,/g, "").replace(/[%$€£¥]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(cleanNum)) {
    return parseFloat(cleanNum);
  }

  return trimmed;
}

function splitTextByPages(text: string, pageCount: number): string[] {
  const formFeedSplit = text.split("\f").filter((p) => p.trim());
  if (formFeedSplit.length === pageCount) {
    return formFeedSplit;
  }

  const pageMarkerRegex = /(?:^|\n)(?:Page\s*\d+|\d+\s*of\s*\d+|[-─]+\s*\d+\s*[-─]+)\s*(?:\n|$)/gi;
  const pageMarkerSplit = text.split(pageMarkerRegex).filter((p) => p.trim());
  if (pageMarkerSplit.length === pageCount) {
    return pageMarkerSplit;
  }

  if (pageCount <= 1) {
    return [text];
  }

  const avgCharsPerPage = Math.ceil(text.length / pageCount);
  const pages: string[] = [];
  let start = 0;

  for (let i = 0; i < pageCount; i++) {
    const end = Math.min(start + avgCharsPerPage, text.length);
    
    let splitPoint = end;
    if (i < pageCount - 1 && end < text.length) {
      const paragraphEnd = text.indexOf("\n\n", end - 100);
      if (paragraphEnd !== -1 && paragraphEnd < end + 100) {
        splitPoint = paragraphEnd + 2;
      } else {
        const lineEnd = text.indexOf("\n", end);
        if (lineEnd !== -1 && lineEnd < end + 50) {
          splitPoint = lineEnd + 1;
        }
      }
    } else if (i === pageCount - 1) {
      splitPoint = text.length;
    }

    pages.push(text.substring(start, splitPoint));
    start = splitPoint;
  }

  return pages;
}

async function performOcr(
  buffer: Buffer
): Promise<{ text: string; confidence: number; language: string }> {
  console.log("[pdfExtractor] Performing OCR with tesseract.js...");

  // Tesseract cannot read PDF buffers directly - only image formats
  // Check for PDF magic bytes and skip OCR if detected
  const isPdfBuffer = buffer.length >= 4 && 
    buffer[0] === 0x25 && buffer[1] === 0x50 && 
    buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF

  if (isPdfBuffer) {
    console.log("[pdfExtractor] Cannot perform OCR on PDF buffer directly - Tesseract requires image input");
    return {
      text: "",
      confidence: 0,
      language: "spa+eng",
    };
  }

  let worker: Tesseract.Worker | null = null;
  try {
    worker = await Tesseract.createWorker("spa+eng");
    
    const {
      data: { text, confidence },
    } = await worker.recognize(buffer);
    
    await worker.terminate();
    worker = null;

    return {
      text: normalizeText(text),
      confidence: confidence || 0,
      language: "spa+eng",
    };
  } catch (error: any) {
    console.error("[pdfExtractor] OCR failed:", error?.message || error);
    if (worker) {
      try { await worker.terminate(); } catch { /* ignore */ }
    }
    // Return empty result instead of throwing to prevent app crash
    return {
      text: "",
      confidence: 0,
      language: "spa+eng",
    };
  }
}

function generatePageSourceRef(
  pageNumbers: number[],
  totalPages: number
): string {
  if (pageNumbers.length === 0) return "page:unknown";
  if (pageNumbers.length === 1) return `page:${pageNumbers[0]}`;

  const sorted = [...pageNumbers].sort((a, b) => a - b);
  const ranges: string[] = [];
  let rangeStart = sorted[0];
  let rangeEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === rangeEnd + 1) {
      rangeEnd = sorted[i];
    } else {
      if (rangeStart === rangeEnd) {
        ranges.push(`${rangeStart}`);
      } else {
        ranges.push(`${rangeStart}-${rangeEnd}`);
      }
      rangeStart = sorted[i];
      rangeEnd = sorted[i];
    }
  }

  if (rangeStart === rangeEnd) {
    ranges.push(`${rangeStart}`);
  } else {
    ranges.push(`${rangeStart}-${rangeEnd}`);
  }

  return `page:${ranges.join(",")}`;
}

export async function extractPDF(
  buffer: Buffer,
  fileName: string
): Promise<Partial<DocumentSemanticModel>> {
  const startTime = Date.now();
  const detectedMime = detectMimeType(buffer);
  const warnings: string[] = [];
  const errors: string[] = [];

  let extractedText = "";
  let pageCount = 0;
  let ocrApplied = false;
  let ocrConfidence: number | undefined;
  let pdfMetadata: Record<string, unknown> = {};

  try {
    const pdfData = await parsePdfBuffer(buffer);
    extractedText = normalizeText(pdfData.text || "");
    pageCount = pdfData.numpages || 1;
    pdfMetadata = pdfData.info || {};

    if (isScannedPdf(extractedText, pageCount)) {
      console.log("[pdfExtractor] Detected scanned/image-only PDF, attempting OCR...");
      warnings.push("PDF appears to be scanned or image-only. Attempting OCR.");

      try {
        const ocrResult = await performOcr(buffer);
        extractedText = ocrResult.text;
        ocrConfidence = ocrResult.confidence;
        ocrApplied = true;

        if (ocrConfidence < OCR_CONFIDENCE_THRESHOLD) {
          warnings.push(
            `OCR confidence is low (${ocrConfidence.toFixed(1)}%). Text extraction may be incomplete or inaccurate.`
          );
        }
      } catch (ocrError) {
        errors.push(
          `OCR failed: ${ocrError instanceof Error ? ocrError.message : "Unknown error"}`
        );
        warnings.push("OCR processing failed. Returning minimal text content.");
      }
    }
  } catch (parseError) {
    console.error("[pdfExtractor] PDF parsing failed:", parseError);

    try {
      console.log("[pdfExtractor] Attempting OCR as fallback...");
      const ocrResult = await performOcr(buffer);
      extractedText = ocrResult.text;
      ocrConfidence = ocrResult.confidence;
      ocrApplied = true;
      pageCount = 1;
      warnings.push("Standard PDF parsing failed. Used OCR as fallback.");
    } catch (ocrError) {
      errors.push(
        `Both PDF parsing and OCR failed: ${ocrError instanceof Error ? ocrError.message : "Unknown error"}`
      );
      throw new Error(
        `Failed to extract PDF content: ${parseError instanceof Error ? parseError.message : "Unknown error"}`
      );
    }
  }

  const pages = splitTextByPages(extractedText, pageCount);
  const sections: Section[] = [];
  const tables: Table[] = [];
  const sources: SourceReference[] = [];

  const documentSourceId = generateId();
  sources.push({
    id: documentSourceId,
    type: "page",
    location: fileName,
    pageNumber: 1,
    previewText: extractedText.substring(0, 200),
  });

  let tableIndex = 0;

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageNum = pageIdx + 1;
    const pageText = pages[pageIdx];

    if (!pageText.trim()) {
      continue;
    }

    const sourceRef = `page:${pageNum}`;
    const pageSourceId = generateId();

    sources.push({
      id: pageSourceId,
      type: "page",
      location: `${fileName}#page-${pageNum}`,
      pageNumber: pageNum,
      previewText: pageText.substring(0, 150),
    });

    const tableDetection = detectTablesFromText(pageText);

    for (const detectedTable of tableDetection.tables) {
      if (detectedTable.rows.length < 1) continue;

      tableIndex++;
      const tableId = generateId();
      const tableSourceRef = `page:${pageNum}:table:${tableIndex}`;

      const tableSourceId = generateId();
      sources.push({
        id: tableSourceId,
        type: "range",
        location: `${fileName}#page-${pageNum}-table-${tableIndex}`,
        pageNumber: pageNum,
        previewText: detectedTable.headers.join(", ").substring(0, 100),
      });

      const columnTypes: Array<"text" | "number" | "date" | "boolean" | "mixed"> = [];
      for (let col = 0; col < detectedTable.headers.length; col++) {
        const columnValues = detectedTable.rows.map((row) => row[col] || "");
        const types = new Set<string>();
        for (const value of columnValues) {
          const cellType = detectCellType(value);
          if (cellType !== "empty") {
            types.add(cellType);
          }
        }
        if (types.size === 0) {
          columnTypes.push("text");
        } else if (types.size === 1) {
          columnTypes.push(
            Array.from(types)[0] as "text" | "number" | "date" | "boolean"
          );
        } else {
          columnTypes.push("mixed");
        }
      }

      const headerRow: TableCell[] = detectedTable.headers.map((h) => ({
        value: h,
        type: "text" as const,
      }));

      const tableRows: TableCell[][] = [headerRow];
      for (const row of detectedTable.rows) {
        const tableRow: TableCell[] = [];
        for (let col = 0; col < detectedTable.headers.length; col++) {
          const cellValue = row[col] || "";
          const parsed = parseValue(cellValue);
          tableRow.push({
            value: parsed,
            type: detectCellType(cellValue),
          });
        }
        tableRows.push(tableRow);
      }

      tables.push({
        id: tableId,
        title: `Page ${pageNum} - Table ${tableIndex}`,
        sourceRef: tableSourceId,
        pageNumber: pageNum,
        headers: detectedTable.headers,
        columnTypes,
        rows: tableRows,
        rowCount: tableRows.length,
        columnCount: detectedTable.headers.length,
        previewRows: tableRows.slice(0, 10),
      });

      sections.push({
        id: generateId(),
        type: "table",
        title: `Table ${tableIndex}`,
        sourceRef: tableSourceRef,
        tableRef: tableId,
      });
    }

    const paragraphs = tableDetection.nonTableContent
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    for (const paragraph of paragraphs) {
      const isHeading =
        paragraph.length < 100 &&
        (paragraph === paragraph.toUpperCase() ||
          /^(?:Chapter|Section|Part|\d+\.)\s/i.test(paragraph) ||
          /^[A-Z][A-Za-z\s]{0,50}:?$/.test(paragraph));

      if (isHeading) {
        sections.push({
          id: generateId(),
          type: "heading",
          level: 2,
          title: paragraph,
          content: paragraph,
          sourceRef,
        });
      } else {
        const isList =
          paragraph.includes("\n") &&
          paragraph.split("\n").every(
            (line) =>
              /^[\s]*[-•*▪▸►→]\s/.test(line) ||
              /^[\s]*\d+[.)]\s/.test(line) ||
              /^[\s]*[a-zA-Z][.)]\s/.test(line)
          );

        if (isList) {
          const listItems = paragraph
            .split("\n")
            .map((item) =>
              item.replace(/^[\s]*[-•*▪▸►→]\s*/, "").replace(/^[\s]*\d+[.)]\s*/, "").replace(/^[\s]*[a-zA-Z][.)]\s*/, "").trim()
            )
            .filter((item) => item.length > 0);

          sections.push({
            id: generateId(),
            type: "list",
            content: listItems.join("; "),
            listItems,
            sourceRef,
          });
        } else {
          sections.push({
            id: generateId(),
            type: "paragraph",
            content: paragraph.replace(/\n/g, " ").replace(/\s+/g, " "),
            sourceRef,
          });
        }
      }
    }
  }

  const wordCount = countWords(extractedText);
  const durationMs = Date.now() - startTime;

  return {
    documentMeta: {
      id: generateId(),
      fileName,
      fileSize: buffer.length,
      mimeType: detectedMime,
      documentType: "pdf",
      pageCount,
      wordCount,
      title: pdfMetadata.Title as string | undefined,
      author: pdfMetadata.Author as string | undefined,
      createdAt: pdfMetadata.CreationDate as string | undefined,
      modifiedAt: pdfMetadata.ModDate as string | undefined,
    },
    sections,
    tables,
    metrics: [],
    anomalies: [],
    insights: [],
    sources,
    suggestedQuestions: [],
    extractionDiagnostics: {
      extractedAt: new Date().toISOString(),
      durationMs,
      parserUsed: ocrApplied ? "pdfExtractor+tesseract" : "pdfExtractor",
      mimeTypeDetected: detectedMime,
      ocrApplied,
      ocrConfidence,
      bytesProcessed: buffer.length,
      chunksGenerated: sections.length,
      warnings: warnings.length > 0 ? warnings : undefined,
      errors: errors.length > 0 ? errors : undefined,
    },
  };
}
