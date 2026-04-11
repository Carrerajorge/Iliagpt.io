import JSZip from "jszip";
import type {
  DocumentSemanticModel,
  DocumentMeta,
  ExtractionDiagnostics,
} from "../../shared/schemas/documentSemanticModel";
import { extractExcel } from "../parsers/structured/excelExtractor";
import { extractCSV } from "../parsers/structured/csvExtractor";
import { extractWord } from "../parsers/structured/wordExtractor";
import { extractPDF } from "../parsers/structured/pdfExtractor";
import { extractPptx } from "../parsers/structured/pptxExtractor";

const MAGIC_BYTES = {
  ZIP: [0x50, 0x4b, 0x03, 0x04],
  PDF: [0x25, 0x50, 0x44, 0x46],
  OLE: [0xd0, 0xcf, 0x11, 0xe0],
};

const MIME_TYPES = {
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  PDF: "application/pdf",
  XLS: "application/vnd.ms-excel",
  DOC: "application/msword",
  CSV: "text/csv",
  TEXT: "text/plain",
  UNKNOWN: "application/octet-stream",
};

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function matchesMagicBytes(buffer: Buffer, magic: number[]): boolean {
  if (buffer.length < magic.length) return false;
  return magic.every((byte, i) => buffer[i] === byte);
}

function isLikelyCSV(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 4096);
  const sample = buffer.slice(0, sampleSize).toString("utf-8");
  
  const lines = sample.split("\n").slice(0, 10);
  if (lines.length < 2) return false;
  
  const delimiters = [",", ";", "\t", "|"];
  
  for (const delimiter of delimiters) {
    const counts = lines
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        let count = 0;
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '"') {
            inQuotes = !inQuotes;
          } else if (!inQuotes && line[i] === delimiter) {
            count++;
          }
        }
        return count;
      });
    
    if (counts.length >= 2 && counts[0] > 0) {
      const isConsistent = counts.every((c) => c === counts[0]);
      if (isConsistent) {
        return true;
      }
    }
  }
  
  return false;
}

async function detectZipSubtype(buffer: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const fileNames = Object.keys(zip.files);
    
    if (fileNames.some((name) => name.startsWith("xl/") || name === "[Content_Types].xml" && fileNames.some((n) => n.includes("worksheet")))) {
      const hasWorkbook = fileNames.some((name) => name.includes("workbook.xml"));
      const hasWorksheets = fileNames.some((name) => name.includes("worksheets/"));
      if (hasWorkbook || hasWorksheets) {
        return MIME_TYPES.XLSX;
      }
    }
    
    if (fileNames.some((name) => name.startsWith("word/") || name === "word/document.xml")) {
      return MIME_TYPES.DOCX;
    }
    
    if (fileNames.some((name) => name.startsWith("ppt/") || name === "ppt/presentation.xml")) {
      return MIME_TYPES.PPTX;
    }
    
    const contentTypes = zip.files["[Content_Types].xml"];
    if (contentTypes) {
      const content = await contentTypes.async("string");
      if (content.includes("spreadsheetml")) {
        return MIME_TYPES.XLSX;
      }
      if (content.includes("wordprocessingml")) {
        return MIME_TYPES.DOCX;
      }
      if (content.includes("presentationml")) {
        return MIME_TYPES.PPTX;
      }
    }
    
    return MIME_TYPES.UNKNOWN;
  } catch {
    return MIME_TYPES.UNKNOWN;
  }
}

export function detectMimeType(buffer: Buffer): string {
  if (matchesMagicBytes(buffer, MAGIC_BYTES.PDF)) {
    return MIME_TYPES.PDF;
  }
  
  if (matchesMagicBytes(buffer, MAGIC_BYTES.ZIP)) {
    return "application/zip";
  }
  
  if (matchesMagicBytes(buffer, MAGIC_BYTES.OLE)) {
    return MIME_TYPES.XLS;
  }
  
  if (isLikelyCSV(buffer)) {
    return MIME_TYPES.CSV;
  }
  
  const hasNullBytes = buffer.slice(0, Math.min(buffer.length, 1024)).includes(0x00);
  if (!hasNullBytes) {
    return MIME_TYPES.TEXT;
  }
  
  return MIME_TYPES.UNKNOWN;
}

async function detectMimeTypeAsync(buffer: Buffer): Promise<string> {
  const syncResult = detectMimeType(buffer);
  
  if (syncResult === "application/zip") {
    return await detectZipSubtype(buffer);
  }
  
  return syncResult;
}

function getDocumentType(mimeType: string): DocumentMeta["documentType"] {
  switch (mimeType) {
    case MIME_TYPES.XLSX:
    case MIME_TYPES.XLS:
      return "excel";
    case MIME_TYPES.CSV:
      return "csv";
    case MIME_TYPES.DOCX:
    case MIME_TYPES.DOC:
      return "word";
    case MIME_TYPES.PDF:
      return "pdf";
    case MIME_TYPES.PPTX:
      return "presentation";
    case MIME_TYPES.TEXT:
      return "text";
    default:
      return "unknown";
  }
}

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1) return "";
  return fileName.substring(lastDot + 1).toLowerCase();
}

function inferMimeTypeFromExtension(fileName: string): string | null {
  const ext = getFileExtension(fileName);
  switch (ext) {
    case "xlsx":
      return MIME_TYPES.XLSX;
    case "xls":
      return MIME_TYPES.XLS;
    case "csv":
      return MIME_TYPES.CSV;
    case "docx":
      return MIME_TYPES.DOCX;
    case "doc":
      return MIME_TYPES.DOC;
    case "pdf":
      return MIME_TYPES.PDF;
    case "pptx":
      return MIME_TYPES.PPTX;
    case "txt":
      return MIME_TYPES.TEXT;
    default:
      return null;
  }
}

export async function normalizeDocument(
  buffer: Buffer,
  fileName: string,
  storagePath?: string
): Promise<DocumentSemanticModel> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];
  
  let detectedMimeType = await detectMimeTypeAsync(buffer);
  const declaredMimeType = inferMimeTypeFromExtension(fileName);
  
  if (detectedMimeType === MIME_TYPES.UNKNOWN && declaredMimeType) {
    detectedMimeType = declaredMimeType;
    warnings.push(`MIME type detection inconclusive, using extension-based type: ${declaredMimeType}`);
  }
  
  let partialResult: Partial<DocumentSemanticModel> = {};
  let parserUsed = "none";
  
  try {
    switch (detectedMimeType) {
      case MIME_TYPES.XLSX:
      case MIME_TYPES.XLS:
        partialResult = await extractExcel(buffer, fileName);
        parserUsed = "excelExtractor";
        break;
        
      case MIME_TYPES.CSV:
        partialResult = await extractCSV(buffer, fileName);
        parserUsed = "csvExtractor";
        break;
        
      case MIME_TYPES.DOCX:
      case MIME_TYPES.DOC:
        partialResult = await extractWord(buffer, fileName);
        parserUsed = "wordExtractor";
        break;
        
      case MIME_TYPES.PDF:
        partialResult = await extractPDF(buffer, fileName);
        parserUsed = "pdfExtractor";
        break;

      case MIME_TYPES.PPTX:
        partialResult = await extractPptx(buffer, fileName);
        parserUsed = "pptxExtractor";
        break;
        
      case MIME_TYPES.TEXT:
        partialResult = await extractCSV(buffer, fileName);
        parserUsed = "csvExtractor (text fallback)";
        break;
        
      default:
        errors.push(`Unsupported document type: ${detectedMimeType}`);
        parserUsed = "none";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Extraction failed: ${message}`);
  }
  
  const durationMs = Date.now() - startTime;
  
  const documentMeta: DocumentMeta = {
    id: partialResult.documentMeta?.id || generateId(),
    fileName,
    fileSize: buffer.length,
    mimeType: detectedMimeType,
    documentType: getDocumentType(detectedMimeType),
    createdAt: partialResult.documentMeta?.createdAt || new Date().toISOString(),
    modifiedAt: partialResult.documentMeta?.modifiedAt,
    author: partialResult.documentMeta?.author,
    title: partialResult.documentMeta?.title || fileName,
    pageCount: partialResult.documentMeta?.pageCount,
    sheetCount: partialResult.documentMeta?.sheetCount,
    wordCount: partialResult.documentMeta?.wordCount,
    language: partialResult.documentMeta?.language,
  };
  
  const existingDiagnostics = partialResult.extractionDiagnostics;
  const extractionDiagnostics: ExtractionDiagnostics = {
    extractedAt: existingDiagnostics?.extractedAt || new Date().toISOString(),
    durationMs: existingDiagnostics?.durationMs || durationMs,
    parserUsed,
    mimeTypeDetected: detectedMimeType,
    mimeTypeDeclared: declaredMimeType || undefined,
    ocrApplied: existingDiagnostics?.ocrApplied,
    ocrConfidence: existingDiagnostics?.ocrConfidence,
    warnings: [...(existingDiagnostics?.warnings || []), ...warnings],
    errors: [...(existingDiagnostics?.errors || []), ...errors],
    bytesProcessed: buffer.length,
    chunksGenerated: existingDiagnostics?.chunksGenerated,
  };
  
  const sections = partialResult.sections || [];
  const tables = partialResult.tables || [];
  const metrics = partialResult.metrics || [];
  const anomalies = partialResult.anomalies || [];
  const insights = partialResult.insights || [];
  const sources = partialResult.sources || [];
  const sheets = partialResult.sheets;
  const suggestedQuestions = partialResult.suggestedQuestions || [];
  const llmSummary = partialResult.llmSummary;
  
  sections.forEach((s) => { if (!s.id) s.id = generateId(); });
  tables.forEach((t) => { if (!t.id) t.id = generateId(); });
  metrics.forEach((m) => { if (!m.id) m.id = generateId(); });
  anomalies.forEach((a) => { if (!a.id) a.id = generateId(); });
  insights.forEach((i) => { if (!i.id) i.id = generateId(); });
  sources.forEach((s) => { if (!s.id) s.id = generateId(); });
  suggestedQuestions.forEach((q) => { if (!q.id) q.id = generateId(); });
  
  const result: DocumentSemanticModel = {
    version: "1.0",
    documentMeta,
    sections,
    tables,
    metrics,
    anomalies,
    insights,
    sources,
    sheets,
    suggestedQuestions,
    extractionDiagnostics,
    llmSummary,
  };
  
  return result;
}
