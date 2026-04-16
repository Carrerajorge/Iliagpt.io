import * as XLSX from "xlsx";
import type {
  DocumentSemanticModel,
  Table,
  TableCell,
  Metric,
  Anomaly,
  SheetSummary,
  SourceReference,
} from "../../../shared/schemas/documentSemanticModel";

const EXCEL_MAGIC_BYTES = {
  xlsx: [0x50, 0x4b, 0x03, 0x04],
  xls: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
};

const PREVIEW_ROWS = 20;
const TOP_BOTTOM_COUNT = 5;

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

function detectMimeType(buffer: Buffer): string {
  if (buffer.length >= 4) {
    const isXlsx = EXCEL_MAGIC_BYTES.xlsx.every((byte, i) => buffer[i] === byte);
    if (isXlsx) {
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
  }

  if (buffer.length >= 8) {
    const isXls = EXCEL_MAGIC_BYTES.xls.every((byte, i) => buffer[i] === byte);
    if (isXls) {
      return "application/vnd.ms-excel";
    }
  }

  return "application/octet-stream";
}

function getUsedRange(sheet: XLSX.WorkSheet): string {
  const range = sheet["!ref"];
  return range || "A1";
}

function detectCellType(cell: XLSX.CellObject | undefined): TableCell["type"] {
  if (!cell || cell.v === undefined || cell.v === null) {
    return "empty";
  }

  if (cell.f) {
    return "formula";
  }

  switch (cell.t) {
    case "n":
      return "number";
    case "d":
      return "date";
    case "b":
      return "boolean";
    case "s":
    case "z":
    default:
      return "text";
  }
}

function getCellValue(cell: XLSX.CellObject | undefined): string | number | boolean | null {
  if (!cell || cell.v === undefined || cell.v === null) {
    return null;
  }

  if (cell.t === "d" && cell.v instanceof Date) {
    return cell.v.toISOString().split("T")[0];
  }

  return cell.v as string | number | boolean;
}

function getFormula(cell: XLSX.CellObject | undefined): string | undefined {
  if (cell?.f) {
    return `=${cell.f}`;
  }
  return undefined;
}

function parseColumnType(values: Array<string | number | boolean | null>): "text" | "number" | "date" | "boolean" | "mixed" {
  const nonNullValues = values.filter((v) => v !== null);
  if (nonNullValues.length === 0) return "text";

  const types = new Set<string>();

  for (const value of nonNullValues) {
    if (typeof value === "number") {
      types.add("number");
    } else if (typeof value === "boolean") {
      types.add("boolean");
    } else if (typeof value === "string") {
      const datePattern = /^\d{4}-\d{2}-\d{2}/;
      if (datePattern.test(value)) {
        types.add("date");
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

export async function extractExcel(
  buffer: Buffer,
  fileName: string
): Promise<Partial<DocumentSemanticModel>> {
  const startTime = Date.now();
  const detectedMime = detectMimeType(buffer);

  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellFormula: true,
    cellDates: true,
    cellNF: true,
    cellStyles: false,
  });

  const tables: Table[] = [];
  const metrics: Metric[] = [];
  const anomalies: Anomaly[] = [];
  const sheets: SheetSummary[] = [];
  const sources: SourceReference[] = [];

  for (let sheetIndex = 0; sheetIndex < workbook.SheetNames.length; sheetIndex++) {
    const sheetName = workbook.SheetNames[sheetIndex];
    const sheet = workbook.Sheets[sheetName];
    const usedRange = getUsedRange(sheet);

    const sourceId = generateId();
    sources.push({
      id: sourceId,
      type: "sheet",
      location: `${fileName}!${sheetName}`,
      sheetName,
      range: usedRange,
    });

    const range = XLSX.utils.decode_range(usedRange);
    const rowCount = range.e.r - range.s.r + 1;
    const columnCount = range.e.c - range.s.c + 1;

    const headers: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c });
      const cell = sheet[cellAddress];
      const headerValue = cell ? String(getCellValue(cell) ?? `Col${c + 1}`) : `Col${c + 1}`;
      headers.push(headerValue);
    }

    const columnData: Array<Array<string | number | boolean | null>> = headers.map(() => []);
    const allRows: TableCell[][] = [];
    const previewRows: TableCell[][] = [];
    const columnTypes: Array<"text" | "number" | "date" | "boolean" | "mixed"> = [];

    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: TableCell[] = [];

      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[cellAddress] as XLSX.CellObject | undefined;
        const cellType = detectCellType(cell);
        const cellValue = getCellValue(cell);
        const formula = getFormula(cell);

        const tableCell: TableCell = {
          value: cellValue,
          type: cellType,
        };

        if (formula) {
          tableCell.formula = formula;
        }

        row.push(tableCell);

        if (r > range.s.r) {
          const colIndex = c - range.s.c;
          columnData[colIndex].push(cellValue);
        }
      }

      allRows.push(row);
      if (r - range.s.r < PREVIEW_ROWS) {
        previewRows.push(row);
      }
    }

    const columnAnalyses: ColumnAnalysis[] = headers.map((header, i) =>
      analyzeColumn(header, columnData[i])
    );

    for (const analysis of columnAnalyses) {
      columnTypes.push(analysis.type);
    }

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

        const metricId = generateId();
        metrics.push({
          id: metricId,
          name: `${sheetName} - ${analysis.name} Sum`,
          value: analysis.stats.sum,
          type: "total",
          sourceRef: sourceId,
          description: `Sum of ${analysis.name} column`,
        });

        metrics.push({
          id: generateId(),
          name: `${sheetName} - ${analysis.name} Avg`,
          value: Math.round(analysis.stats.avg * 100) / 100,
          type: "average",
          sourceRef: sourceId,
          description: `Average of ${analysis.name} column`,
        });

        metrics.push({
          id: generateId(),
          name: `${sheetName} - ${analysis.name} Count`,
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
          severity: analysis.nullCount > rowCount * 0.2 ? "high" : analysis.nullCount > rowCount * 0.05 ? "medium" : "low",
          description: `Column "${analysis.name}" has ${analysis.nullCount} null/empty values`,
          sourceRef: sourceId,
          affectedColumns: [analysis.name],
        });
      }

      if (analysis.duplicateCount > 0 && analysis.type !== "boolean") {
        anomalies.push({
          id: generateId(),
          type: "duplicate",
          severity: analysis.duplicateCount > rowCount * 0.5 ? "medium" : "low",
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
    tables.push({
      id: tableId,
      title: sheetName,
      sourceRef: sourceId,
      sheetName,
      range: usedRange,
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
    });

    sheets.push({
      name: sheetName,
      index: sheetIndex,
      rowCount,
      columnCount,
      usedRange,
      headers,
      tables: [tableId],
      metrics: metrics.filter((m) => m.sourceRef === sourceId).map((m) => m.id),
      anomalies: anomalies.filter((a) => a.sourceRef === sourceId).map((a) => a.id),
      topValues,
      bottomValues,
    });
  }

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
      parserUsed: "excelExtractor",
      mimeTypeDetected: detectedMime,
      bytesProcessed: buffer.length,
      chunksGenerated: tables.length,
    },
  };
}
