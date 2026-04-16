import ExcelJS from "exceljs";
import mammoth from "mammoth";
import path from "path";
import { createRequire } from "module";
import officeParser from "officeparser";
import { performOCR } from "./ocrService";
import * as XLSX from "xlsx";

// pdf-parse is CommonJS, use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const PREVIEW_ROW_LIMIT = 100;

// ============================================
// SECURITY LIMITS
// ============================================

/** Maximum extracted text size (5MB) */
const MAX_EXTRACTED_TEXT = 5 * 1024 * 1024;

/** Maximum number of sheets to process */
const MAX_SHEETS = 100;

/** Maximum number of pages to process for PDF */
const MAX_PDF_PAGES = 1000;

/** Timeout for individual parse operations (60s) */
const PARSE_TIMEOUT_MS = 60_000;

/** Maximum columns for tabular data */
const MAX_COLUMNS = 500;

/** Wrap async operation with timeout */
function withParseTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${PARSE_TIMEOUT_MS}ms`)), PARSE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId!));
}

/** Truncate extracted text to security limit */
function capText(text: string): string {
  return text.length > MAX_EXTRACTED_TEXT ? text.substring(0, MAX_EXTRACTED_TEXT) : text;
}

export interface DocumentMetadata {
  fileType: 'xlsx' | 'xls' | 'csv' | 'tsv' | 'pdf' | 'docx' | 'pptx' | 'ppt' | 'rtf' | 'png' | 'jpeg' | 'gif' | 'bmp' | 'tiff' | 'webp';
  fileName: string;
  fileSize: number;
  encoding?: string;
  pageCount?: number;
  sheetCount?: number;
}

export interface DocumentSheet {
  name: string;
  index: number;
  rowCount: number;
  columnCount: number;
  headers: string[];
  previewData: any[][];
  isTabular: boolean;
}

export interface ParsedDocument {
  metadata: DocumentMetadata;
  sheets: DocumentSheet[];
}

const MAGIC_BYTES: Record<string, { bytes: number[]; offset?: number }[]> = {
  xlsx: [
    { bytes: [0x50, 0x4B, 0x03, 0x04] }, // ZIP (OOXML)
  ],
  xls: [
    { bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] }, // OLE2
  ],
  pdf: [
    { bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  ],
  docx: [
    { bytes: [0x50, 0x4B, 0x03, 0x04] }, // ZIP (OOXML)
  ],
  pptx: [
    { bytes: [0x50, 0x4B, 0x03, 0x04] }, // ZIP (OOXML)
  ],
  png: [
    { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }, // PNG signature
  ],
  jpeg: [
    { bytes: [0xFF, 0xD8, 0xFF] }, // JPEG
  ],
  gif: [
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  ],
  bmp: [
    { bytes: [0x42, 0x4D] }, // BM
  ],
  tiff: [
    { bytes: [0x49, 0x49, 0x2A, 0x00] }, // Little-endian
    { bytes: [0x4D, 0x4D, 0x00, 0x2A] }, // Big-endian
  ],
  webp: [
    { bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF (WebP container)
  ],
  rtf: [
    { bytes: [0x7B, 0x5C, 0x72, 0x74, 0x66] }, // {\rtf
  ],
};

const MIME_TYPE_MAP: Record<string, DocumentMetadata['fileType']> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
};

function checkMagicBytes(buffer: Buffer, expected: { bytes: number[]; offset?: number }[]): boolean {
  for (const pattern of expected) {
    const offset = pattern.offset || 0;
    if (buffer.length < offset + pattern.bytes.length) continue;
    
    let matches = true;
    for (let i = 0; i < pattern.bytes.length; i++) {
      if (buffer[offset + i] !== pattern.bytes[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function isTextFile(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 1024);
  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32 && byte !== 27)) {
      return false;
    }
  }
  return true;
}

function detectDelimiter(buffer: Buffer): 'csv' | 'tsv' | null {
  const sample = buffer.toString('utf-8', 0, Math.min(buffer.length, 4096));
  const lines = sample.split(/\r?\n/).slice(0, 5);
  
  let tabCount = 0;
  let commaCount = 0;
  
  for (const line of lines) {
    tabCount += (line.match(/\t/g) || []).length;
    commaCount += (line.match(/,/g) || []).length;
  }
  
  if (tabCount > commaCount && tabCount > 0) return 'tsv';
  if (commaCount > 0) return 'csv';
  return null;
}

export async function detectFileType(
  buffer: Buffer,
  mimeType: string
): Promise<DocumentMetadata['fileType'] | null> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  const mimeFileType = MIME_TYPE_MAP[mimeType];

  // Check image formats first (most specific magic bytes)
  if (checkMagicBytes(buffer, MAGIC_BYTES.png)) {
    return 'png';
  }
  if (checkMagicBytes(buffer, MAGIC_BYTES.jpeg)) {
    return 'jpeg';
  }
  if (checkMagicBytes(buffer, MAGIC_BYTES.gif)) {
    return 'gif';
  }
  if (checkMagicBytes(buffer, MAGIC_BYTES.bmp)) {
    return 'bmp';
  }
  if (checkMagicBytes(buffer, MAGIC_BYTES.tiff)) {
    return 'tiff';
  }
  if (checkMagicBytes(buffer, MAGIC_BYTES.webp)) {
    // WebP has RIFF header, verify it's actually WebP
    if (buffer.length > 11 && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return 'webp';
    }
  }

  // Check RTF
  if (checkMagicBytes(buffer, MAGIC_BYTES.rtf)) {
    return 'rtf';
  }

  // Check PDF
  if (checkMagicBytes(buffer, MAGIC_BYTES.pdf)) {
    return 'pdf';
  }

  // Check OLE2 (xls, ppt)
  if (checkMagicBytes(buffer, MAGIC_BYTES.xls)) {
    // OLE2 can be xls or ppt - trust MIME type first
    if (mimeFileType === 'ppt') return 'ppt';
    if (mimeFileType === 'xls') return 'xls';
    
    // Detect by content - look for OLE2 stream markers
    // PowerPoint files contain "PowerPoint Document" stream
    // Excel files contain "Workbook" or "Book" stream
    const bufferStr = buffer.toString('binary');
    
    // Check for PowerPoint markers first (more distinctive)
    const hasPowerPointMarker = bufferStr.includes('PowerPoint Document') || 
      bufferStr.includes('P\x00o\x00w\x00e\x00r\x00P\x00o\x00i\x00n\x00t') ||
      bufferStr.includes('Current User');
    
    // Check for Excel markers
    const hasExcelMarker = bufferStr.includes('Workbook') || 
      bufferStr.includes('W\x00o\x00r\x00k\x00b\x00o\x00o\x00k') ||
      bufferStr.includes('Book');
    
    // If both are found, prioritize Excel (more common case)
    if (hasExcelMarker && !hasPowerPointMarker) {
      return 'xls';
    }
    if (hasPowerPointMarker && !hasExcelMarker) {
      return 'ppt';
    }
    
    // Default to XLS for OLE2 files without clear markers (most common case)
    return 'xls';
  }

  // Check ZIP-based formats (xlsx, docx, pptx)
  if (checkMagicBytes(buffer, MAGIC_BYTES.xlsx)) {
    // Trust MIME type first for OOXML formats
    if (mimeFileType === 'xlsx') return 'xlsx';
    if (mimeFileType === 'docx') return 'docx';
    if (mimeFileType === 'pptx') return 'pptx';
    
    // Try to detect by content
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      return 'xlsx';
    } catch {
      try {
        await mammoth.extractRawText({ buffer });
        return 'docx';
      } catch {
        // Could be pptx - try officeParser
        try {
          await officeParser.parseOfficeAsync(buffer);
          return 'pptx';
        } catch {
          return mimeFileType || null;
        }
      }
    }
  }

  // Check text-based formats
  if (isTextFile(buffer)) {
    if (mimeFileType === 'rtf') return 'rtf';
    const delimiter = detectDelimiter(buffer);
    if (mimeFileType === 'tsv' || delimiter === 'tsv') return 'tsv';
    if (mimeFileType === 'csv' || delimiter === 'csv') return 'csv';
    return 'csv';
  }

  // Fall back to MIME type
  return mimeFileType || null;
}

function sanitizeFileName(fileName: string): string {
  const basename = path.basename(fileName);
  return basename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 255);
}

export async function extractMetadata(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<DocumentMetadata> {
  const fileType = await detectFileType(buffer, mimeType);
  
  if (!fileType) {
    throw new Error('Unable to detect file type');
  }

  const metadata: DocumentMetadata = {
    fileType,
    fileName: sanitizeFileName(fileName),
    fileSize: buffer.length,
  };

  switch (fileType) {
    case 'xlsx': {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      metadata.sheetCount = workbook.worksheets.length;
      break;
    }
    case 'xls': {
      // Use SheetJS for binary XLS files
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      metadata.sheetCount = workbook.SheetNames.length;
      break;
    }
    case 'pdf': {
      const pdfData = await pdfParse(buffer);
      metadata.pageCount = pdfData.numpages;
      break;
    }
    case 'csv':
    case 'tsv': {
      metadata.encoding = 'utf-8';
      metadata.sheetCount = 1;
      break;
    }
    case 'docx': {
      metadata.encoding = 'utf-8';
      break;
    }
  }

  return metadata;
}

async function parseExcelXlsx(buffer: Buffer): Promise<DocumentSheet[]> {
  const workbook = new ExcelJS.Workbook();
  await withParseTimeout(workbook.xlsx.load(buffer), "Excel XLSX load");

  const sheets: DocumentSheet[] = [];

  workbook.eachSheet((worksheet, sheetIndex) => {
    // Security: limit number of sheets
    if (sheets.length >= MAX_SHEETS) return;
    const data: any[][] = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const rowData: any[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        rowData[colNumber - 1] = getCellValue(cell);
      });
      data[rowNumber - 1] = rowData;
    });

    const compactData = data.filter((row) => row && row.length > 0);
    const headerInfo = detectHeaders(compactData);
    const headers = headerInfo.headers;
    
    const rowCount = compactData.length;
    const columnCount = Math.max(...compactData.map((row) => row.length), 0);
    const previewData = compactData.slice(0, PREVIEW_ROW_LIMIT);

    sheets.push({
      name: worksheet.name,
      index: sheetIndex - 1,
      rowCount,
      columnCount,
      headers,
      previewData,
      isTabular: true,
    });
  });

  return sheets;
}

function parseExcelXls(buffer: Buffer): DocumentSheet[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets: DocumentSheet[] = [];

  // Security: limit number of sheets
  const sheetNames = workbook.SheetNames.slice(0, MAX_SHEETS);
  sheetNames.forEach((sheetName, sheetIndex) => {
    const worksheet = workbook.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    
    const compactData = data.filter((row) => row && row.some((cell: any) => cell !== null && cell !== ''));
    const headerInfo = detectHeaders(compactData);
    const headers = headerInfo.headers;
    
    const rowCount = compactData.length;
    const columnCount = Math.max(...compactData.map((row) => (row as any[]).length), 0);
    const previewData = compactData.slice(0, PREVIEW_ROW_LIMIT);

    sheets.push({
      name: sheetName,
      index: sheetIndex,
      rowCount,
      columnCount,
      headers,
      previewData,
      isTabular: true,
    });
  });

  return sheets;
}

function getCellValue(cell: ExcelJS.Cell): any {
  if (cell.value === null || cell.value === undefined) {
    return null;
  }

  if (typeof cell.value === "object") {
    if ("result" in cell.value && cell.value.result !== undefined) {
      return cell.value.result;
    }
    if ("richText" in cell.value) {
      return (cell.value.richText as any[]).map((rt) => rt.text).join("");
    }
    if (cell.value instanceof Date) {
      return cell.value;
    }
    if ("hyperlink" in cell.value) {
      return (cell.value as any).text || (cell.value as any).hyperlink;
    }
  }

  return cell.value;
}

function parseDelimitedText(buffer: Buffer, delimiter: string): DocumentSheet[] {
  const content = buffer.toString("utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return [{
      name: "Sheet1",
      index: 0,
      rowCount: 0,
      columnCount: 0,
      headers: [],
      previewData: [],
      isTabular: true,
    }];
  }

  const data: any[][] = lines.map((line) => parseDelimitedLine(line, delimiter));
  const headerInfo = detectHeaders(data);
  const headers = headerInfo.headers;

  const columnCount = Math.max(...data.map((row) => row.length), 0);
  const previewData = data.slice(0, PREVIEW_ROW_LIMIT);

  return [{
    name: "Sheet1",
    index: 0,
    rowCount: data.length,
    columnCount,
    headers,
    previewData,
    isTabular: true,
  }];
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map(cell => cell.trim());
  }
  
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }

  result.push(current.trim());
  return result;
}

interface HeaderDetectionResult {
  headers: string[];
  dataStartRow: number;
}

function detectHeaders(data: any[][]): HeaderDetectionResult {
  if (data.length === 0) {
    return { headers: [], dataStartRow: 0 };
  }

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const nonEmptyCount = row.filter(
      (cell) => cell !== null && cell !== undefined && cell !== ""
    ).length;
    if (nonEmptyCount === 0) continue;

    const allStrings = row.every(
      (cell) =>
        cell === null ||
        cell === undefined ||
        cell === "" ||
        typeof cell === "string"
    );
    const hasReasonableLengths = row.every(
      (cell) =>
        cell === null ||
        cell === undefined ||
        cell === "" ||
        (typeof cell === "string" && cell.length < 100)
    );

    if (allStrings && hasReasonableLengths && nonEmptyCount >= 2) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    return { headers: [], dataStartRow: 0 };
  }

  const headers = data[headerRowIndex].map((cell, idx) => {
    if (cell === null || cell === undefined || cell === "") {
      return `Column${idx + 1}`;
    }
    return String(cell);
  });

  return {
    headers,
    dataStartRow: headerRowIndex + 1,
  };
}

async function parsePdf(buffer: Buffer): Promise<DocumentSheet[]> {
  const pdfData = await withParseTimeout(pdfParse(buffer), "PDF parse");
  // Security: cap extracted text
  const text = capText(pdfData.text || "");
  const numPages = pdfData.numpages || 1;

  const pages = text.split(/\f/).filter((page: string) => page.trim().length > 0);

  const sheets: DocumentSheet[] = [];

  // Security: limit pages processed
  const maxPages = Math.min(Math.max(pages.length, numPages), MAX_PDF_PAGES);

  if (pages.length === 0 && text.trim()) {
    const lines = text.split(/\r?\n/).filter((line: string) => line.trim());
    const previewLines = lines.slice(0, PREVIEW_ROW_LIMIT);

    sheets.push({
      name: "Page 1",
      index: 0,
      rowCount: lines.length,
      columnCount: 1,
      headers: ["Content"],
      previewData: previewLines.map((line: string) => [line]),
      isTabular: false,
    });
  } else {
    for (let i = 0; i < maxPages; i++) {
      const pageText = pages[i] || "";
      const lines = pageText.split(/\r?\n/).filter((line: string) => line.trim());
      const previewLines = lines.slice(0, PREVIEW_ROW_LIMIT);

      sheets.push({
        name: `Page ${i + 1}`,
        index: i,
        rowCount: lines.length,
        columnCount: 1,
        headers: ["Content"],
        previewData: previewLines.map((line: string) => [line]),
        isTabular: false,
      });
    }
  }

  if (sheets.length === 0) {
    sheets.push({
      name: "Page 1",
      index: 0,
      rowCount: 0,
      columnCount: 1,
      headers: ["Content"],
      previewData: [],
      isTabular: false,
    });
  }

  return sheets;
}

function parseGenericText(text: string, docName: string): DocumentSheet[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  const previewLines = lines.slice(0, PREVIEW_ROW_LIMIT);

  return [{
    name: docName,
    index: 0,
    rowCount: lines.length,
    columnCount: 1,
    headers: ["Content"],
    previewData: previewLines.map(line => [line]),
    isTabular: false,
  }];
}

async function parsePptx(buffer: Buffer, fileName: string): Promise<DocumentSheet[]> {
  try {
    const text = await withParseTimeout(officeParser.parseOfficeAsync(buffer), "PPTX parse");
    if (!text || text.trim().length === 0) {
      return [{
        name: "Presentation",
        index: 0,
        rowCount: 0,
        columnCount: 1,
        headers: ["Content"],
        previewData: [],
        isTabular: false,
      }];
    }
    return parseGenericText(text, "Presentation");
  } catch (error) {
    console.error("Error parsing PowerPoint:", error);
    throw new Error(`Failed to parse PowerPoint: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function parseRtf(buffer: Buffer): Promise<DocumentSheet[]> {
  try {
    const text = await withParseTimeout(officeParser.parseOfficeAsync(buffer), "RTF parse");
    if (!text || text.trim().length === 0) {
      const rawText = buffer.toString("utf-8")
        .replace(/\\[a-z]+\d*\s?|[{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return parseGenericText(rawText, "Document");
    }
    return parseGenericText(text, "Document");
  } catch (error) {
    console.error("Error parsing RTF:", error);
    const rawText = buffer.toString("utf-8")
      .replace(/\\[a-z]+\d*\s?|[{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return parseGenericText(rawText, "Document");
  }
}

async function parseImage(buffer: Buffer, fileName: string): Promise<DocumentSheet[]> {
  try {
    const ocrResult = await ocrService.performOCR(buffer);
    const text = ocrResult.text || "";
    
    if (!text.trim()) {
      return [{
        name: "Image",
        index: 0,
        rowCount: 0,
        columnCount: 1,
        headers: ["Content"],
        previewData: [],
        isTabular: false,
      }];
    }
    
    return parseGenericText(text, "Image");
  } catch (error) {
    console.error("Error performing OCR on image:", error);
    throw new Error(`Failed to extract text from image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function parseDocx(buffer: Buffer): Promise<DocumentSheet[]> {
  const result = await withParseTimeout(mammoth.extractRawText({ buffer }), "DOCX parse");
  // Security: cap extracted text
  const text = capText(result.value || "");

  const headingPattern = /^(?:#{1,6}\s+.+|[A-Z][A-Z\s]{2,}[A-Z]$|(?:\d+\.)+\s+.+)/m;
  
  let sections: string[] = [];
  
  const paragraphs = text.split(/\n{2,}/);
  
  if (paragraphs.some(p => headingPattern.test(p.trim()))) {
    let currentSection = "";
    for (const para of paragraphs) {
      if (headingPattern.test(para.trim()) && currentSection.trim()) {
        sections.push(currentSection.trim());
        currentSection = para;
      } else {
        currentSection += "\n\n" + para;
      }
    }
    if (currentSection.trim()) {
      sections.push(currentSection.trim());
    }
  }
  
  if (sections.length === 0) {
    sections = paragraphs.filter(p => p.trim());
  }

  if (sections.length === 0) {
    return [{
      name: "Document",
      index: 0,
      rowCount: 0,
      columnCount: 1,
      headers: ["Content"],
      previewData: [],
      isTabular: false,
    }];
  }

  if (sections.length === 1 || sections.length > 50) {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    const previewLines = lines.slice(0, PREVIEW_ROW_LIMIT);
    
    return [{
      name: "Document",
      index: 0,
      rowCount: lines.length,
      columnCount: 1,
      headers: ["Content"],
      previewData: previewLines.map(line => [line]),
      isTabular: false,
    }];
  }

  return sections.map((section, index) => {
    const lines = section.split(/\r?\n/).filter(line => line.trim());
    const previewLines = lines.slice(0, PREVIEW_ROW_LIMIT);
    const firstLine = lines[0] || `Section ${index + 1}`;
    const sectionName = firstLine.length > 50 
      ? firstLine.substring(0, 47) + "..."
      : firstLine;

    return {
      name: sectionName,
      index,
      rowCount: lines.length,
      columnCount: 1,
      headers: ["Content"],
      previewData: previewLines.map(line => [line]),
      isTabular: false,
    };
  });
}

export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
  fileName: string = "document"
): Promise<ParsedDocument> {
  const metadata = await extractMetadata(buffer, mimeType, fileName);
  
  let sheets: DocumentSheet[];

  switch (metadata.fileType) {
    case 'xlsx':
      sheets = await parseExcelXlsx(buffer);
      break;
    case 'xls':
      sheets = parseExcelXls(buffer);
      break;
    case 'csv':
      sheets = parseDelimitedText(buffer, ',');
      break;
    case 'tsv':
      sheets = parseDelimitedText(buffer, '\t');
      break;
    case 'pdf':
      sheets = await parsePdf(buffer);
      break;
    case 'docx':
      sheets = await parseDocx(buffer);
      break;
    case 'pptx':
    case 'ppt':
      sheets = await parsePptx(buffer, fileName);
      break;
    case 'rtf':
      sheets = await parseRtf(buffer);
      break;
    case 'png':
    case 'jpeg':
    case 'gif':
    case 'bmp':
    case 'tiff':
    case 'webp':
      sheets = await parseImage(buffer, fileName);
      break;
    default:
      throw new Error(`Unsupported file type: ${metadata.fileType}`);
  }

  return {
    metadata,
    sheets,
  };
}

export function validateFileSize(buffer: Buffer): { valid: boolean; error?: string } {
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
    };
  }
  return { valid: true };
}

export async function extractContent(buffer: Buffer, mimeType: string): Promise<string> {
  // Security: enforce file size limit
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  const fileType = await detectFileType(buffer, mimeType);
  if (!fileType) {
    throw new Error('Unsupported file type');
  }

  try {
    switch (fileType) {
      case 'pdf': {
        const pdfData = await withParseTimeout(pdfParse(buffer), "PDF content extraction");
        return capText(pdfData.text || '');
      }
      case 'docx': {
        const docResult = await withParseTimeout(mammoth.extractRawText({ buffer }), "DOCX content extraction");
        return capText(docResult.value || '');
      }
      case 'xlsx':
      case 'xls': {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheets: string[] = [];
        // Security: limit sheets
        const sheetNames = workbook.SheetNames.slice(0, MAX_SHEETS);
        for (const sheetName of sheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          sheets.push(`=== ${sheetName} ===\n${csv}`);
        }
        return capText(sheets.join('\n\n'));
      }
      case 'csv':
      case 'tsv':
        return capText(buffer.toString('utf-8'));

      case 'pptx':
      case 'ppt': {
        const pptText = await withParseTimeout(officeParser.parseOfficeAsync(buffer), "PPT content extraction");
        return capText(pptText || '');
      }
      case 'rtf': {
        const rtfText = await withParseTimeout(officeParser.parseOfficeAsync(buffer), "RTF content extraction");
        return capText(rtfText || '');
      }
      case 'png':
      case 'jpeg':
      case 'gif':
      case 'bmp':
      case 'tiff':
      case 'webp': {
        const ocrResult = await withParseTimeout(performOCR(buffer), "OCR extraction");
        return capText(ocrResult.text || '');
      }
      default:
        throw new Error(`Cannot extract content from file type: ${fileType}`);
    }
  } catch (error) {
    console.error(`[DocumentIngestion] Content extraction failed for ${fileType}:`, error);
    throw error;
  }
}

export const documentIngestion = {
  detectFileType,
  extractMetadata,
  parseDocument,
  validateFileSize,
  extractContent,
  sanitizeFileName,
  MAX_FILE_SIZE,
  PREVIEW_ROW_LIMIT,
};

export default documentIngestion;
