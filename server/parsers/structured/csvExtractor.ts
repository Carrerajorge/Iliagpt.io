import type {
  DocumentSemanticModel,
  Table,
  TableCell,
  Metric,
  Anomaly,
  SheetSummary,
  SourceReference,
} from "../../../shared/schemas/documentSemanticModel";

const PREVIEW_ROWS = 20;
const TOP_BOTTOM_COUNT = 5;
const SAMPLE_LINES_FOR_DETECTION = 10;

type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "iso-8859-1";
type Delimiter = "," | ";" | "\t" | "|";

interface ColumnStats {
  min: number;
  max: number;
  avg: number;
  sum: number;
  count: number;
  values: number[];
}

interface ColumnAnalysis {
  name: string;
  type: "text" | "number" | "date" | "boolean" | "mixed";
  nullCount: number;
  duplicateCount: number;
  stats?: ColumnStats;
  topValues?: Array<{ value: string | number; count?: number }>;
  bottomValues?: Array<{ value: string | number; count?: number }>;
  outliers?: number[];
}

function detectEncoding(buffer: Buffer): Encoding {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "utf-8";
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf-16le";
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return "utf-16be";
  }
  let nullBytes = 0;
  let highBytes = 0;
  const sampleSize = Math.min(buffer.length, 1024);
  for (let i = 0; i < sampleSize; i++) {
    if (buffer[i] === 0x00) nullBytes++;
    if (buffer[i] > 0x7f) highBytes++;
  }
  if (nullBytes > sampleSize * 0.1) {
    const evenNulls = buffer.filter((_, i) => i % 2 === 0 && buffer[i] === 0x00).length;
    const oddNulls = buffer.filter((_, i) => i % 2 === 1 && buffer[i] === 0x00).length;
    return evenNulls > oddNulls ? "utf-16be" : "utf-16le";
  }
  if (highBytes > 0) {
    let validUtf8 = true;
    for (let i = 0; i < sampleSize && validUtf8; i++) {
      const byte = buffer[i];
      if (byte > 0x7f) {
        if ((byte & 0xe0) === 0xc0 && i + 1 < sampleSize) {
          if ((buffer[i + 1] & 0xc0) !== 0x80) validUtf8 = false;
          i++;
        } else if ((byte & 0xf0) === 0xe0 && i + 2 < sampleSize) {
          if ((buffer[i + 1] & 0xc0) !== 0x80 || (buffer[i + 2] & 0xc0) !== 0x80) validUtf8 = false;
          i += 2;
        } else if ((byte & 0xf8) === 0xf0 && i + 3 < sampleSize) {
          if ((buffer[i + 1] & 0xc0) !== 0x80 || (buffer[i + 2] & 0xc0) !== 0x80 || (buffer[i + 3] & 0xc0) !== 0x80) validUtf8 = false;
          i += 3;
        } else {
          validUtf8 = false;
        }
      }
    }
    return validUtf8 ? "utf-8" : "iso-8859-1";
  }
  return "utf-8";
}

function bufferToString(buffer: Buffer, encoding: Encoding): string {
  switch (encoding) {
    case "utf-16le":
      return buffer.slice(2).toString("utf16le");
    case "utf-16be": {
      const swapped = Buffer.alloc(buffer.length - 2);
      for (let i = 2; i < buffer.length; i += 2) {
        if (i + 1 < buffer.length) {
          swapped[i - 2] = buffer[i + 1];
          swapped[i - 1] = buffer[i];
        }
      }
      return swapped.toString("utf16le");
    }
    case "utf-8":
      if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return buffer.slice(3).toString("utf-8");
      }
      return buffer.toString("utf-8");
    case "iso-8859-1":
      return buffer.toString("latin1");
    default:
      return buffer.toString("utf-8");
  }
}

function detectDelimiter(lines: string[]): Delimiter {
  const delimiters: Delimiter[] = [",", ";", "\t", "|"];
  const scores: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  for (const delimiter of delimiters) {
    const counts = lines.map((line) => {
      let count = 0;
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (!inQuotes && char === delimiter) {
          count++;
        }
      }
      return count;
    });
    const nonZeroCounts = counts.filter((c) => c > 0);
    if (nonZeroCounts.length === 0) continue;
    const isConsistent = nonZeroCounts.every((c) => c === nonZeroCounts[0]);
    if (isConsistent && nonZeroCounts[0] > 0) {
      scores[delimiter] = nonZeroCounts[0] * lines.length;
    } else {
      scores[delimiter] = nonZeroCounts.reduce((a, b) => a + b, 0) * 0.5;
    }
  }
  let bestDelimiter: Delimiter = ",";
  let bestScore = 0;
  for (const [delimiter, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter as Delimiter;
    }
  }
  return bestDelimiter;
}

function parseCSVLine(line: string, delimiter: Delimiter): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseColumnType(values: Array<string | number | boolean | null>): "text" | "number" | "date" | "boolean" | "mixed" {
  const nonNullValues = values.filter((v) => v !== null && v !== "");
  if (nonNullValues.length === 0) return "text";
  const types = new Set<string>();
  for (const value of nonNullValues) {
    if (typeof value === "number") {
      types.add("number");
    } else if (typeof value === "boolean") {
      types.add("boolean");
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "false") {
        types.add("boolean");
      } else if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(trimmed)) {
        types.add("date");
      } else if (/^-?\d+(\.\d+)?$/.test(trimmed) || /^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(trimmed)) {
        types.add("number");
      } else {
        types.add("text");
      }
    }
  }
  if (types.size === 1) {
    return Array.from(types)[0] as "text" | "number" | "date" | "boolean";
  }
  return "mixed";
}

function parseValue(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "na" || trimmed.toLowerCase() === "n/a") {
    return null;
  }
  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;
  const cleanNum = trimmed.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(cleanNum)) {
    return parseFloat(cleanNum);
  }
  return trimmed;
}

function calculateStats(values: Array<string | number | boolean | null>): ColumnStats | undefined {
  const numericValues = values
    .filter((v): v is number => typeof v === "number" && !isNaN(v));
  if (numericValues.length === 0) return undefined;
  const sum = numericValues.reduce((a, b) => a + b, 0);
  const count = numericValues.length;
  const avg = sum / count;
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  return { min, max, avg, sum, count, values: numericValues };
}

function findDuplicates(values: Array<string | number | boolean | null>): number {
  const nonNull = values.filter((v) => v !== null);
  const uniqueSet = new Set(nonNull.map((v) => String(v)));
  return nonNull.length - uniqueSet.size;
}

function findOutliersIQR(values: number[]): number[] {
  if (values.length < 4) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q1Index = Math.floor(n * 0.25);
  const q3Index = Math.floor(n * 0.75);
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  return values.filter((v) => v < lowerBound || v > upperBound);
}

function getTopBottomValues(
  values: number[],
  count: number
): { top: Array<{ value: number }>; bottom: Array<{ value: number }> } {
  if (values.length === 0) {
    return { top: [], bottom: [] };
  }
  const sorted = [...values].sort((a, b) => b - a);
  const top = sorted.slice(0, count).map((value) => ({ value }));
  const bottomSorted = [...values].sort((a, b) => a - b);
  const bottom = bottomSorted.slice(0, count).map((value) => ({ value }));
  return { top, bottom };
}

function analyzeColumn(
  header: string,
  values: Array<string | number | boolean | null>
): ColumnAnalysis {
  const type = parseColumnType(values);
  const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
  const duplicateCount = findDuplicates(values);
  const analysis: ColumnAnalysis = {
    name: header,
    type,
    nullCount,
    duplicateCount,
  };
  if (type === "number" || type === "mixed") {
    const stats = calculateStats(values);
    if (stats) {
      analysis.stats = stats;
      const { top, bottom } = getTopBottomValues(stats.values, TOP_BOTTOM_COUNT);
      analysis.topValues = top;
      analysis.bottomValues = bottom;
      analysis.outliers = findOutliersIQR(stats.values);
    }
  }
  return analysis;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function detectCellType(value: string | number | boolean | null): TableCell["type"] {
  if (value === null || value === "") return "empty";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(value) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(value)) {
      return "date";
    }
  }
  return "text";
}

export async function extractCSV(
  buffer: Buffer,
  fileName: string
): Promise<Partial<DocumentSemanticModel>> {
  const startTime = Date.now();
  const encoding = detectEncoding(buffer);
  const content = bufferToString(buffer, encoding);
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return {
      tables: [],
      metrics: [],
      anomalies: [],
      sheets: [],
      sources: [],
      extractionDiagnostics: {
        extractedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        parserUsed: "csvExtractor",
        mimeTypeDetected: "text/csv",
        bytesProcessed: buffer.length,
        chunksGenerated: 0,
        warnings: ["Empty CSV file"],
      },
    };
  }
  const sampleLines = lines.slice(0, SAMPLE_LINES_FOR_DETECTION);
  const delimiter = detectDelimiter(sampleLines);
  const headers = parseCSVLine(lines[0], delimiter).map((h, i) => h || `Column${i + 1}`);
  const dataLines = lines.slice(1);
  const parsedRows: Array<Array<string | number | boolean | null>> = [];
  for (const line of dataLines) {
    const rawValues = parseCSVLine(line, delimiter);
    const row = rawValues.map((v) => parseValue(v));
    while (row.length < headers.length) {
      row.push(null);
    }
    if (row.length > headers.length) {
      row.length = headers.length;
    }
    parsedRows.push(row);
  }
  const columnData: Array<Array<string | number | boolean | null>> = headers.map(() => []);
  for (const row of parsedRows) {
    for (let i = 0; i < headers.length; i++) {
      columnData[i].push(row[i]);
    }
  }
  const columnAnalyses: ColumnAnalysis[] = headers.map((header, i) =>
    analyzeColumn(header, columnData[i])
  );
  const columnTypes: Array<"text" | "number" | "date" | "boolean" | "mixed"> = columnAnalyses.map((a) => a.type);
  const allRows: TableCell[][] = [];
  const headerRow: TableCell[] = headers.map((h) => ({
    value: h,
    type: "text" as const,
  }));
  allRows.push(headerRow);
  for (const row of parsedRows) {
    const tableRow: TableCell[] = row.map((value) => ({
      value,
      type: detectCellType(value),
    }));
    allRows.push(tableRow);
  }
  const previewRows = allRows.slice(0, PREVIEW_ROWS);
  const sourceId = generateId();
  const sources: SourceReference[] = [{
    id: sourceId,
    type: "sheet",
    location: fileName,
    sheetName: "CSV",
    range: `A1:${String.fromCharCode(64 + headers.length)}${parsedRows.length + 1}`,
  }];
  const metrics: Metric[] = [];
  const anomalies: Anomaly[] = [];
  const nullCounts: Record<string, number> = {};
  const numericStats: Record<string, { min?: number; max?: number; avg?: number; sum?: number; median?: number }> = {};
  const topValues: Record<string, Array<{ value: string | number; count?: number }>> = {};
  const bottomValues: Record<string, Array<{ value: string | number; count?: number }>> = {};
  for (const analysis of columnAnalyses) {
    nullCounts[analysis.name] = analysis.nullCount;
    if (analysis.stats) {
      numericStats[analysis.name] = {
        min: analysis.stats.min,
        max: analysis.stats.max,
        avg: analysis.stats.avg,
        sum: analysis.stats.sum,
      };
      metrics.push({
        id: generateId(),
        name: `${analysis.name} Sum`,
        value: analysis.stats.sum,
        type: "total",
        sourceRef: sourceId,
        description: `Sum of ${analysis.name} column`,
      });
      metrics.push({
        id: generateId(),
        name: `${analysis.name} Avg`,
        value: Math.round(analysis.stats.avg * 100) / 100,
        type: "average",
        sourceRef: sourceId,
        description: `Average of ${analysis.name} column`,
      });
      metrics.push({
        id: generateId(),
        name: `${analysis.name} Count`,
        value: analysis.stats.count,
        type: "count",
        sourceRef: sourceId,
        description: `Count of numeric values in ${analysis.name} column`,
      });
    }
    if (analysis.topValues && analysis.topValues.length > 0) {
      topValues[analysis.name] = analysis.topValues;
    }
    if (analysis.bottomValues && analysis.bottomValues.length > 0) {
      bottomValues[analysis.name] = analysis.bottomValues;
    }
    if (analysis.nullCount > 0) {
      anomalies.push({
        id: generateId(),
        type: "null",
        severity: analysis.nullCount > parsedRows.length * 0.2 ? "high" : analysis.nullCount > parsedRows.length * 0.05 ? "medium" : "low",
        description: `Column "${analysis.name}" has ${analysis.nullCount} null/empty values`,
        sourceRef: sourceId,
        affectedColumns: [analysis.name],
      });
    }
    if (analysis.duplicateCount > 0 && analysis.type !== "boolean") {
      anomalies.push({
        id: generateId(),
        type: "duplicate",
        severity: analysis.duplicateCount > parsedRows.length * 0.5 ? "medium" : "low",
        description: `Column "${analysis.name}" has ${analysis.duplicateCount} duplicate values`,
        sourceRef: sourceId,
        affectedColumns: [analysis.name],
      });
    }
    if (analysis.outliers && analysis.outliers.length > 0) {
      anomalies.push({
        id: generateId(),
        type: "outlier",
        severity: analysis.outliers.length > 5 ? "high" : analysis.outliers.length > 2 ? "medium" : "low",
        description: `Column "${analysis.name}" has ${analysis.outliers.length} outlier values detected using IQR method: [${analysis.outliers.slice(0, 5).join(", ")}${analysis.outliers.length > 5 ? "..." : ""}]`,
        sourceRef: sourceId,
        affectedColumns: [analysis.name],
        suggestedAction: "Review outlier values for data quality issues",
      });
    }
  }
  const totalDuplicates = columnAnalyses.reduce((sum, a) => sum + a.duplicateCount, 0);
  const tableId = generateId();
  const tables: Table[] = [{
    id: tableId,
    title: fileName.replace(/\.[^/.]+$/, ""),
    sourceRef: sourceId,
    sheetName: "CSV",
    range: `A1:${String.fromCharCode(64 + headers.length)}${parsedRows.length + 1}`,
    headers,
    columnTypes,
    rows: allRows,
    rowCount: allRows.length,
    columnCount: headers.length,
    previewRows,
    stats: {
      nullCount: nullCounts,
      duplicateCount: totalDuplicates,
      numericStats,
    },
  }];
  const sheets: SheetSummary[] = [{
    name: "CSV",
    index: 0,
    rowCount: parsedRows.length + 1,
    columnCount: headers.length,
    usedRange: `A1:${String.fromCharCode(64 + headers.length)}${parsedRows.length + 1}`,
    headers,
    tables: [tableId],
    metrics: metrics.map((m) => m.id),
    anomalies: anomalies.map((a) => a.id),
    topValues,
    bottomValues,
  }];
  const durationMs = Date.now() - startTime;
  return {
    tables,
    metrics,
    anomalies,
    sheets,
    sources,
    extractionDiagnostics: {
      extractedAt: new Date().toISOString(),
      durationMs,
      parserUsed: "csvExtractor",
      mimeTypeDetected: "text/csv",
      bytesProcessed: buffer.length,
      chunksGenerated: 1,
      warnings: encoding !== "utf-8" ? [`Detected non-UTF-8 encoding: ${encoding}`] : undefined,
    },
  };
}
