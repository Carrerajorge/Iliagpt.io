import { db } from "../db";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import {
  spreadsheetUploads,
  spreadsheetSheets,
  spreadsheetAnalysisSessions,
  spreadsheetAnalysisJobs,
  spreadsheetAnalysisOutputs,
  type InsertSpreadsheetUpload,
  type SpreadsheetUpload,
  type InsertSpreadsheetSheet,
  type SpreadsheetSheet,
  type InsertSpreadsheetAnalysisSession,
  type SpreadsheetAnalysisSession,
  type InsertSpreadsheetAnalysisJob,
  type SpreadsheetAnalysisJob,
  type InsertSpreadsheetAnalysisOutput,
  type SpreadsheetAnalysisOutput,
  type SpreadsheetUploadStatus,
} from "@shared/schema";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/tab-separated-values",
];
const PREVIEW_ROW_LIMIT = 100;

export interface SheetInfo {
  name: string;
  sheetIndex: number;
  rowCount: number;
  columnCount: number;
  inferredHeaders: string[];
  columnTypes: ColumnTypeInfo[];
  previewData: any[][];
}

export interface ColumnTypeInfo {
  name: string;
  type: "text" | "number" | "date" | "boolean" | "mixed" | "empty";
  sampleValues?: any[];
  nullCount?: number;
  statistics?: ColumnStatistics;
}

export interface ColumnStatistics {
  min?: number;
  max?: number;
  avg?: number;
  sum?: number;
  uniqueCount?: number;
  uniqueValues?: any[];
}

export interface InterSheetReference {
  formula: string;
  sourceSheet: string;
  sourceCell: string;
  targetSheet: string;
  targetCell?: string;
}

export interface CrossSheetRelationship {
  sourceSheet: string;
  targetSheet: string;
  linkingColumns: string[];
}

export interface SheetSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  columnTypes: Record<string, string>;
}

export interface CrossSheetSummary {
  totalSheets: number;
  totalRows: number;
  totalColumns: number;
  totalDataPoints: number;
  commonHeaders: string[];
  relationships: CrossSheetRelationship[];
  naturalLanguageSummary: string;
}

export interface WorkbookSummary {
  totalSheets: number;
  totalRows: number;
  totalColumns: number;
  sheetSummaries: SheetSummary[];
  crossSheetRelationships: CrossSheetRelationship[];
  interSheetReferences: InterSheetReference[];
  crossSheetSummary: CrossSheetSummary;
}

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  checksum?: string;
}

export interface ParsedSpreadsheet {
  sheets: SheetInfo[];
}

export function validateSpreadsheetFile(
  buffer: Buffer,
  mimeType: string
): FileValidationResult {
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
    };
  }

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: xlsx, xls, csv`,
    };
  }

  const checksum = generateChecksum(buffer);
  return { valid: true, checksum };
}

export function generateChecksum(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function createUpload(
  data: InsertSpreadsheetUpload
): Promise<SpreadsheetUpload> {
  const [upload] = await db
    .insert(spreadsheetUploads)
    .values(data)
    .returning();
  return upload;
}

export async function getUpload(
  id: string
): Promise<SpreadsheetUpload | undefined> {
  const [upload] = await db
    .select()
    .from(spreadsheetUploads)
    .where(eq(spreadsheetUploads.id, id))
    .limit(1);
  return upload;
}

export async function getUserUploads(
  userId: string
): Promise<SpreadsheetUpload[]> {
  return db
    .select()
    .from(spreadsheetUploads)
    .where(eq(spreadsheetUploads.userId, userId))
    .orderBy(desc(spreadsheetUploads.createdAt));
}

export async function updateUploadStatus(
  id: string,
  status: SpreadsheetUploadStatus,
  errorMessage?: string
): Promise<SpreadsheetUpload | undefined> {
  const [updated] = await db
    .update(spreadsheetUploads)
    .set({
      status,
      errorMessage: errorMessage ?? null,
    })
    .where(eq(spreadsheetUploads.id, id))
    .returning();
  return updated;
}

export async function deleteUpload(id: string): Promise<void> {
  await db.delete(spreadsheetUploads).where(eq(spreadsheetUploads.id, id));
}

export async function createSheet(
  data: InsertSpreadsheetSheet
): Promise<SpreadsheetSheet> {
  const [sheet] = await db
    .insert(spreadsheetSheets)
    .values(data)
    .returning();
  return sheet;
}

export async function getSheets(uploadId: string): Promise<SpreadsheetSheet[]> {
  return db
    .select()
    .from(spreadsheetSheets)
    .where(eq(spreadsheetSheets.uploadId, uploadId))
    .orderBy(spreadsheetSheets.sheetIndex);
}

export async function createAnalysisSession(
  data: InsertSpreadsheetAnalysisSession
): Promise<SpreadsheetAnalysisSession> {
  const [session] = await db
    .insert(spreadsheetAnalysisSessions)
    .values(data)
    .returning();
  return session;
}

export async function getAnalysisSession(
  id: string
): Promise<SpreadsheetAnalysisSession | undefined> {
  const [session] = await db
    .select()
    .from(spreadsheetAnalysisSessions)
    .where(eq(spreadsheetAnalysisSessions.id, id))
    .limit(1);
  return session;
}

export async function updateAnalysisSession(
  id: string,
  updates: Partial<SpreadsheetAnalysisSession>
): Promise<SpreadsheetAnalysisSession | undefined> {
  const [updated] = await db
    .update(spreadsheetAnalysisSessions)
    .set(updates)
    .where(eq(spreadsheetAnalysisSessions.id, id))
    .returning();
  return updated;
}

export async function createAnalysisOutput(
  data: InsertSpreadsheetAnalysisOutput
): Promise<SpreadsheetAnalysisOutput> {
  const [output] = await db
    .insert(spreadsheetAnalysisOutputs)
    .values(data)
    .returning();
  return output;
}

export async function getAnalysisOutputs(
  sessionId: string
): Promise<SpreadsheetAnalysisOutput[]> {
  return db
    .select()
    .from(spreadsheetAnalysisOutputs)
    .where(eq(spreadsheetAnalysisOutputs.sessionId, sessionId))
    .orderBy(spreadsheetAnalysisOutputs.order);
}

export async function createAnalysisJob(
  data: InsertSpreadsheetAnalysisJob
): Promise<SpreadsheetAnalysisJob> {
  const [job] = await db
    .insert(spreadsheetAnalysisJobs)
    .values(data)
    .returning();
  return job;
}

export async function getAnalysisJobsBySession(
  sessionId: string
): Promise<SpreadsheetAnalysisJob[]> {
  return db
    .select()
    .from(spreadsheetAnalysisJobs)
    .where(eq(spreadsheetAnalysisJobs.sessionId, sessionId))
    .orderBy(spreadsheetAnalysisJobs.createdAt);
}

export async function getAnalysisJob(
  id: string
): Promise<SpreadsheetAnalysisJob | undefined> {
  const [job] = await db
    .select()
    .from(spreadsheetAnalysisJobs)
    .where(eq(spreadsheetAnalysisJobs.id, id))
    .limit(1);
  return job;
}

export async function updateAnalysisJob(
  id: string,
  updates: Partial<SpreadsheetAnalysisJob>
): Promise<void> {
  await db
    .update(spreadsheetAnalysisJobs)
    .set(updates)
    .where(eq(spreadsheetAnalysisJobs.id, id));
}

export async function getSheetByName(
  uploadId: string,
  sheetName: string
): Promise<SpreadsheetSheet | undefined> {
  const [sheet] = await db
    .select()
    .from(spreadsheetSheets)
    .where(eq(spreadsheetSheets.uploadId, uploadId))
    .limit(1);

  const sheets = await db
    .select()
    .from(spreadsheetSheets)
    .where(eq(spreadsheetSheets.uploadId, uploadId));

  return sheets.find(s => s.name === sheetName);
}

export async function parseSpreadsheet(
  buffer: Buffer,
  mimeType: string
): Promise<ParsedSpreadsheet> {
  // If file is very large (> 10MB) and background jobs are enabled
  if (buffer.length > 10 * 1024 * 1024 && process.env.ENABLE_BACKGROUND_JOBS === "true") {
    console.log("[SpreadsheetAnalyzer] Large file detected, candidate for background processing.");
    // logic to dispatch would go here if we changed the return signature to support async job IDs
  }

  if (mimeType === "text/csv") {
    return parseDelimited(buffer, ",");
  }
  if (mimeType === "text/tab-separated-values") {
    return parseDelimited(buffer, "\t");
  }
  // Check if it's binary XLS (OLE2) or XLSX (OOXML)
  if (mimeType === "application/vnd.ms-excel") {
    return parseExcelXls(buffer);
  }
  return parseExcelXlsx(buffer);
}

async function parseExcelXlsx(buffer: Buffer): Promise<ParsedSpreadsheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets: SheetInfo[] = [];

  workbook.eachSheet((worksheet, sheetIndex) => {
    const sheetInfo = extractSheetInfo(worksheet, sheetIndex - 1);
    sheets.push(sheetInfo);
  });

  return { sheets };
}

function parseExcelXls(buffer: Buffer): ParsedSpreadsheet {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets: SheetInfo[] = [];

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const worksheet = workbook.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

    const compactData = data.filter((row) => row && row.some((cell: any) => cell !== null && cell !== ''));
    const headerInfo = detectHeaders(compactData);
    const headers = headerInfo.headers;
    const dataStartRow = headerInfo.dataStartRow;

    const dataRows = compactData.slice(dataStartRow);
    const rowCount = compactData.length;
    const columnCount = Math.max(...compactData.map((row) => (row as any[]).length), 0);
    const previewData = compactData.slice(0, PREVIEW_ROW_LIMIT);

    const columnTypes = inferColumnTypes(
      dataRows,
      headers.length > 0 ? headers : undefined
    );

    sheets.push({
      name: sheetName,
      sheetIndex,
      rowCount,
      columnCount,
      inferredHeaders: headers,
      columnTypes,
      previewData,
    });
  });

  return { sheets };
}

function parseDelimited(buffer: Buffer, delimiter: string): ParsedSpreadsheet {
  const content = buffer.toString("utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return {
      sheets: [
        {
          name: "Sheet1",
          sheetIndex: 0,
          rowCount: 0,
          columnCount: 0,
          inferredHeaders: [],
          columnTypes: [],
          previewData: [],
        },
      ],
    };
  }

  const data: any[][] = lines.map((line) => parseDelimitedLine(line, delimiter));
  const headerInfo = detectHeaders(data);
  const headers = headerInfo.headers;
  const dataStartRow = headerInfo.dataStartRow;

  const dataRows = data.slice(dataStartRow);
  const columnCount = Math.max(...data.map((row) => row.length), 0);
  const previewData = data.slice(0, PREVIEW_ROW_LIMIT);

  const columnTypes = inferColumnTypes(
    dataRows,
    headers.length > 0 ? headers : undefined
  );

  return {
    sheets: [
      {
        name: "Sheet1",
        sheetIndex: 0,
        rowCount: data.length,
        columnCount,
        inferredHeaders: headers,
        columnTypes,
        previewData,
      },
    ],
  };
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  // For tabs, use simple split
  if (delimiter === "\t") {
    return line.split("\t").map(cell => cell.trim());
  }

  // For commas, handle quoted values
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

function extractSheetInfo(
  worksheet: ExcelJS.Worksheet,
  sheetIndex: number
): SheetInfo {
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
  const dataStartRow = headerInfo.dataStartRow;

  const dataRows = compactData.slice(dataStartRow);
  const rowCount = compactData.length;
  const columnCount = Math.max(...compactData.map((row) => row.length), 0);
  const previewData = compactData.slice(0, PREVIEW_ROW_LIMIT);

  const columnTypes = inferColumnTypes(
    dataRows,
    headers.length > 0 ? headers : undefined
  );

  return {
    name: worksheet.name,
    sheetIndex,
    rowCount,
    columnCount,
    inferredHeaders: headers,
    columnTypes,
    previewData,
  };
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
      return (cell.value.richText as any[])
        .map((rt) => rt.text)
        .join("");
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

    const nonEmptyCount = row.filter((cell) => cell !== null && cell !== undefined && cell !== "").length;
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

export function inferColumnTypes(
  data: any[][],
  headers?: string[]
): ColumnTypeInfo[] {
  if (data.length === 0) {
    return [];
  }

  const maxCols = Math.max(...data.map((row) => row.length), 0);
  const result: ColumnTypeInfo[] = [];

  for (let colIdx = 0; colIdx < maxCols; colIdx++) {
    const columnName = headers && headers[colIdx] ? headers[colIdx] : `Column${colIdx + 1}`;
    const values = data.map((row) => row[colIdx]);

    const typeInfo = analyzeColumnType(columnName, values);
    result.push(typeInfo);
  }

  return result;
}

function analyzeColumnType(name: string, values: any[]): ColumnTypeInfo {
  const nonNullValues = values.filter(
    (v) => v !== null && v !== undefined && v !== ""
  );
  const nullCount = values.length - nonNullValues.length;

  if (nonNullValues.length === 0) {
    return {
      name,
      type: "empty",
      sampleValues: [],
      nullCount,
      statistics: { uniqueCount: 0 },
    };
  }

  const typeCounts = {
    number: 0,
    text: 0,
    date: 0,
    boolean: 0,
  };

  for (const value of nonNullValues) {
    const type = detectValueType(value);
    typeCounts[type]++;
  }

  const total = nonNullValues.length;
  const threshold = 0.8;

  let inferredType: "text" | "number" | "date" | "boolean" | "mixed" = "mixed";

  if (typeCounts.number / total >= threshold) {
    inferredType = "number";
  } else if (typeCounts.date / total >= threshold) {
    inferredType = "date";
  } else if (typeCounts.boolean / total >= threshold) {
    inferredType = "boolean";
  } else if (typeCounts.text / total >= threshold) {
    inferredType = "text";
  }

  const sampleValues = nonNullValues.slice(0, 5);
  const statistics = computeColumnStatistics(nonNullValues, inferredType);

  return {
    name,
    type: inferredType,
    sampleValues,
    nullCount,
    statistics,
  };
}

function computeColumnStatistics(values: any[], type: string): ColumnStatistics {
  const uniqueSet = new Set(values.map(v => String(v)));
  const statistics: ColumnStatistics = {
    uniqueCount: uniqueSet.size,
  };

  if (type === "number") {
    const numericValues = values
      .map(v => typeof v === "number" ? v : parseFloat(String(v)))
      .filter(v => !isNaN(v));

    if (numericValues.length > 0) {
      statistics.min = Math.min(...numericValues);
      statistics.max = Math.max(...numericValues);
      statistics.sum = numericValues.reduce((a, b) => a + b, 0);
      statistics.avg = statistics.sum / numericValues.length;
    }
  } else if (type === "text" && uniqueSet.size <= 20) {
    statistics.uniqueValues = Array.from(uniqueSet).slice(0, 20);
  }

  return statistics;
}

function detectValueType(value: any): "number" | "text" | "date" | "boolean" {
  if (typeof value === "boolean") {
    return "boolean";
  }

  if (value instanceof Date) {
    return "date";
  }

  if (typeof value === "number" && !isNaN(value)) {
    return "number";
  }

  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();

    if (trimmed === "true" || trimmed === "false" || trimmed === "yes" || trimmed === "no") {
      return "boolean";
    }

    const numValue = Number(value);
    if (!isNaN(numValue) && value.trim() !== "") {
      return "number";
    }

    const dateValue = Date.parse(value);
    if (!isNaN(dateValue) && isLikelyDateString(value)) {
      return "date";
    }

    return "text";
  }

  return "text";
}

function isLikelyDateString(value: string): boolean {
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
    /^\d{1,2}-\d{1,2}-\d{2,4}$/,
    /^\w{3}\s+\d{1,2},?\s+\d{4}$/,
    /^\d{4}\/\d{2}\/\d{2}$/,
  ];

  return datePatterns.some((pattern) => pattern.test(value.trim()));
}

export function generateCrossSheetSummary(sheets: SheetInfo[]): CrossSheetSummary {
  const totalSheets = sheets.length;
  const totalRows = sheets.reduce((sum, s) => sum + s.rowCount, 0);
  const totalColumns = sheets.reduce((sum, s) => sum + s.columnCount, 0);
  const totalDataPoints = sheets.reduce((sum, s) => sum + (s.rowCount * s.columnCount), 0);

  const headersBySheet: Map<string, Set<string>> = new Map();
  sheets.forEach(sheet => {
    const normalizedHeaders = sheet.inferredHeaders.map(h => h.toLowerCase().trim());
    headersBySheet.set(sheet.name, new Set(normalizedHeaders));
  });

  const allHeaders = sheets.flatMap(s => s.inferredHeaders.map(h => h.toLowerCase().trim()));
  const headerCounts = new Map<string, number>();
  allHeaders.forEach(h => {
    headerCounts.set(h, (headerCounts.get(h) || 0) + 1);
  });
  const commonHeaders = Array.from(headerCounts.entries())
    .filter(([_, count]) => count > 1)
    .map(([header, _]) => header);

  const relationships: CrossSheetRelationship[] = [];
  const sheetNames = sheets.map(s => s.name);

  for (let i = 0; i < sheetNames.length; i++) {
    for (let j = i + 1; j < sheetNames.length; j++) {
      const sheet1Headers = headersBySheet.get(sheetNames[i]) || new Set();
      const sheet2Headers = headersBySheet.get(sheetNames[j]) || new Set();

      const linkingColumns: string[] = [];
      sheet1Headers.forEach(header => {
        if (sheet2Headers.has(header)) {
          linkingColumns.push(header);
        }
      });

      if (linkingColumns.length > 0) {
        relationships.push({
          sourceSheet: sheetNames[i],
          targetSheet: sheetNames[j],
          linkingColumns,
        });
      }
    }
  }

  const sheetDescriptions = sheets.map(s => {
    const columnInfo = s.columnTypes
      .filter(c => c.type !== "empty")
      .map(c => `${c.name} (${c.type})`)
      .slice(0, 5)
      .join(", ");
    return `"${s.name}" with ${s.rowCount} rows and ${s.columnCount} columns (${columnInfo}${s.columnTypes.length > 5 ? "..." : ""})`;
  });

  let naturalLanguageSummary = `This workbook contains ${totalSheets} sheet${totalSheets > 1 ? "s" : ""} with a total of ${totalRows} rows and ${totalColumns} columns (${totalDataPoints.toLocaleString()} data points). `;

  if (sheets.length <= 3) {
    naturalLanguageSummary += `Sheets: ${sheetDescriptions.join("; ")}. `;
  } else {
    naturalLanguageSummary += `Sheets include: ${sheetDescriptions.slice(0, 2).join("; ")}, and ${sheets.length - 2} more. `;
  }

  if (commonHeaders.length > 0) {
    naturalLanguageSummary += `Common columns across sheets: ${commonHeaders.slice(0, 5).join(", ")}${commonHeaders.length > 5 ? ` and ${commonHeaders.length - 5} more` : ""}. `;
  }

  if (relationships.length > 0) {
    const relationshipDesc = relationships.slice(0, 3).map(r =>
      `${r.sourceSheet} ↔ ${r.targetSheet} (via ${r.linkingColumns.slice(0, 3).join(", ")})`
    ).join("; ");
    naturalLanguageSummary += `Potential relationships detected: ${relationshipDesc}${relationships.length > 3 ? ` and ${relationships.length - 3} more` : ""}.`;
  }

  return {
    totalSheets,
    totalRows,
    totalColumns,
    totalDataPoints,
    commonHeaders,
    relationships,
    naturalLanguageSummary,
  };
}

export function detectInterSheetReferences(workbook: ExcelJS.Workbook): InterSheetReference[] {
  const references: InterSheetReference[] = [];
  const crossSheetPattern = /(?:'([^']+)'|([A-Za-z0-9_]+))!(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)/g;

  workbook.eachSheet((worksheet, sheetIndex) => {
    const sourceSheet = worksheet.name;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.value && typeof cell.value === "object" && "formula" in cell.value) {
          const formula = (cell.value as any).formula;
          if (typeof formula === "string") {
            const colLetter = columnIndexToLetter(colNumber);
            const sourceCell = `${colLetter}${rowNumber}`;

            let match;
            crossSheetPattern.lastIndex = 0;
            while ((match = crossSheetPattern.exec(formula)) !== null) {
              const targetSheet = match[1] || match[2];
              const targetCell = match[3];

              if (targetSheet !== sourceSheet) {
                references.push({
                  formula,
                  sourceSheet,
                  sourceCell,
                  targetSheet,
                  targetCell,
                });
              }
            }
          }
        }
      });
    });
  });

  return references;
}

function columnIndexToLetter(colIndex: number): string {
  let result = "";
  let index = colIndex;
  while (index > 0) {
    const remainder = (index - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    index = Math.floor((index - 1) / 26);
  }
  return result;
}

export async function analyzeWorkbook(buffer: Buffer): Promise<WorkbookSummary> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets: SheetInfo[] = [];
  workbook.eachSheet((worksheet, sheetIndex) => {
    const sheetInfo = extractSheetInfo(worksheet, sheetIndex - 1);
    sheets.push(sheetInfo);
  });

  const sheetSummaries: SheetSummary[] = sheets.map(sheet => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    columnTypes: Object.fromEntries(
      sheet.columnTypes.map(ct => [ct.name, ct.type])
    ),
  }));

  const crossSheetSummary = generateCrossSheetSummary(sheets);
  const interSheetReferences = detectInterSheetReferences(workbook);

  return {
    totalSheets: sheets.length,
    totalRows: sheets.reduce((sum, s) => sum + s.rowCount, 0),
    totalColumns: sheets.reduce((sum, s) => sum + s.columnCount, 0),
    sheetSummaries,
    crossSheetRelationships: crossSheetSummary.relationships,
    interSheetReferences,
    crossSheetSummary,
  };
}

export const spreadsheetAnalyzer = {
  validateSpreadsheetFile,
  generateChecksum,
  createUpload,
  getUpload,
  getUserUploads,
  updateUploadStatus,
  deleteUpload,
  createSheet,
  getSheets,
  getSheetByName,
  createAnalysisSession,
  getAnalysisSession,
  updateAnalysisSession,
  createAnalysisJob,
  getAnalysisJob,
  getAnalysisJobsBySession,
  updateAnalysisJob,
  createAnalysisOutput,
  getAnalysisOutputs,
  parseSpreadsheet,
  inferColumnTypes,
  generateCrossSheetSummary,
  detectInterSheetReferences,
  analyzeWorkbook,
};

export default spreadsheetAnalyzer;
