/**
 * Document Generator Orchestrator — routes to the appropriate generator
 * and returns a binary file buffer ready for download.
 */

import * as fs from "fs";
import * as path from "path";
import { generateWord, type WordContent } from "./wordGenerator";
import { generateExcel, type ExcelContent } from "./excelGenerator";
import { generatePptx, type PptxContent } from "./pptxGenerator";
import { generatePdf, type PdfContent } from "./pdfGenerator";

export type DocumentType = "word" | "excel" | "pptx" | "pdf" | "csv";

export interface GeneratedDocument {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  type: DocumentType;
  downloadUrl: string;
}

const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");

function ensureArtifactsDir(): void {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\u00C0-\u024F _-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

/**
 * Generate a professional document from structured content.
 * Returns the binary buffer, saves to artifacts/, and provides a download URL.
 */
export async function generateDocument(
  type: DocumentType,
  content: WordContent | ExcelContent | PptxContent | PdfContent | { headers: string[]; rows: string[][] },
): Promise<GeneratedDocument> {
  let result: { buffer: Buffer; filename: string; mimeType: string };

  switch (type) {
    case "word":
      result = await generateWord(content as WordContent);
      break;
    case "excel":
      result = await generateExcel(content as ExcelContent);
      break;
    case "pptx":
      result = await generatePptx(content as PptxContent);
      break;
    case "pdf":
      result = await generatePdf(content as PdfContent);
      break;
    case "csv": {
      const csvContent = content as { headers: string[]; rows: string[][] };
      const bom = "\uFEFF"; // UTF-8 BOM for Excel compatibility
      const csv = bom + [csvContent.headers.join(","), ...csvContent.rows.map(r => r.join(","))].join("\n");
      const filename = `datos_${Date.now()}.csv`;
      result = { buffer: Buffer.from(csv, "utf-8"), filename, mimeType: "text/csv" };
      break;
    }
    default:
      throw new Error(`Unsupported document type: ${type}`);
  }

  // Save to artifacts directory
  ensureArtifactsDir();
  const storedFilename = `${Date.now()}_${sanitizeFilename(result.filename)}`;
  const filePath = path.join(ARTIFACTS_DIR, storedFilename);
  fs.writeFileSync(filePath, result.buffer);

  const downloadUrl = `/api/artifacts/${storedFilename}/download`;
  console.log(`[DocGenerator] Created ${type}: ${storedFilename} (${result.buffer.length} bytes) → ${downloadUrl}`);

  return {
    buffer: result.buffer,
    filename: result.filename,
    mimeType: result.mimeType,
    type,
    downloadUrl,
  };
}

export { type WordContent, type ExcelContent, type PptxContent, type PdfContent };
