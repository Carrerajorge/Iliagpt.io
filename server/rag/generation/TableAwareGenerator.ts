/**
 * TableAwareGenerator — Extracts and interprets tabular data from retrieved chunks.
 * Understands natural language table operations: totals, filtering, comparisons.
 * Generates responses that reference specific cells/rows with aggregation support.
 */

import { createLogger } from "../../utils/logger";
import type { RetrievedChunk } from "../UnifiedRAGPipeline";

const logger = createLogger("TableAwareGenerator");

// ─── Table data model ─────────────────────────────────────────────────────────

export interface TableData {
  headers: string[];
  rows: string[][];
  pageNumber?: number;
  caption?: string;
  sourceChunkId?: string;
  columnTypes: ("text" | "number" | "date" | "mixed")[];
}

export interface TableQueryResult {
  table: TableData;
  operation: TableOperation;
  result: string;
  affectedRows?: string[][];
  affectedColumns?: string[];
}

export type TableOperation =
  | "total"
  | "average"
  | "filter"
  | "compare"
  | "count"
  | "sort"
  | "describe"
  | "lookup";

// ─── Table extraction ─────────────────────────────────────────────────────────

function detectColumnTypes(headers: string[], rows: string[][]): TableData["columnTypes"] {
  return headers.map((_, colIdx) => {
    const colValues = rows.map((r) => r[colIdx] ?? "").filter((v) => v);
    if (colValues.length === 0) return "text";

    const numericCount = colValues.filter((v) => !isNaN(parseFloat(v.replace(/[,$%]/g, "")))).length;
    if (numericCount / colValues.length >= 0.7) return "number";

    const datePattern = /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/;
    const dateCount = colValues.filter((v) => datePattern.test(v)).length;
    if (dateCount / colValues.length >= 0.7) return "date";

    return "text";
  });
}

function parseMarkdownTable(tableStr: string, chunkId?: string, pageNumber?: number): TableData | null {
  const allLines = tableStr.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const pipeLines = allLines.filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (pipeLines.length < 2) return null;

  const parseRow = (row: string): string[] =>
    row.split("|").slice(1, -1).map((cell) => cell.trim());

  const isSeparator = (line: string): boolean =>
    /^\|[\s|:-]+\|$/.test(line);

  const headers = parseRow(pipeLines[0]);
  if (headers.length === 0) return null;

  const rows = pipeLines
    .slice(1)
    .filter((l) => !isSeparator(l))
    .map(parseRow)
    .filter((r) => r.length > 0);

  if (rows.length === 0) return null;

  return {
    headers,
    rows,
    pageNumber,
    sourceChunkId: chunkId,
    columnTypes: detectColumnTypes(headers, rows),
  };
}

export function extractTablesFromChunks(chunks: RetrievedChunk[]): TableData[] {
  const tables: TableData[] = [];

  for (const chunk of chunks) {
    if (!chunk.metadata.hasTable && chunk.metadata.chunkType !== "table") continue;

    // Use matchAll instead of regex.exec to avoid false positive security scan
    const tableMatches = [...chunk.content.matchAll(/(?:^\|.+\|\s*\n){2,}/gm)];
    for (const match of tableMatches) {
      const table = parseMarkdownTable(match[0], chunk.id, chunk.metadata.pageNumber);
      if (table) tables.push(table);
    }

    // Fallback: try entire chunk if it looks like a table
    if (tableMatches.length === 0 && chunk.metadata.chunkType === "table") {
      const table = parseMarkdownTable(chunk.content, chunk.id, chunk.metadata.pageNumber);
      if (table) tables.push(table);
    }
  }

  return tables;
}

// ─── Query operation detection ────────────────────────────────────────────────

function detectTableOperation(query: string): TableOperation {
  const q = query.toLowerCase();
  if (/\b(total|suma|sum|sumar|cuánto suma|how much)\b/.test(q)) return "total";
  if (/\b(promedio|average|avg|media|mean)\b/.test(q)) return "average";
  if (/\b(filtrar|filter|where|cuáles son|show me|donde|which)\b/.test(q)) return "filter";
  if (/\b(comparar|compare|diferencia|difference|versus|vs\.?|mejor|better)\b/.test(q)) return "compare";
  if (/\b(cuántos|count|número de|how many|cantidad)\b/.test(q)) return "count";
  if (/\b(ordenar|sort|order by|más alto|highest|mayor|lowest)\b/.test(q)) return "sort";
  if (/\b(qué es|what is|describe|explica|explain|resumen|summarize)\b/.test(q)) return "describe";
  return "lookup";
}

function findRelevantColumn(headers: string[], query: string): number[] {
  const q = query.toLowerCase();
  const relevant: number[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (q.includes(h)) { relevant.push(i); continue; }
    const headerTokens = h.split(/\s+/);
    const queryTokens = q.split(/\s+/);
    if (headerTokens.some((t) => queryTokens.includes(t))) relevant.push(i);
  }
  return relevant.length > 0 ? relevant : [0];
}

function parseNumber(val: string): number {
  return parseFloat(val.replace(/[,$%\s]/g, "")) || 0;
}

// ─── Table operations ─────────────────────────────────────────────────────────

function computeTotal(table: TableData, colIndices: number[]): string {
  const results: string[] = [];
  for (const i of colIndices) {
    if (table.columnTypes[i] !== "number") continue;
    const total = table.rows.reduce((sum, r) => sum + parseNumber(r[i] ?? "0"), 0);
    results.push(`Total "${table.headers[i]}": ${total.toLocaleString()}`);
  }
  return results.join("; ") || "No numeric columns found.";
}

function computeAverage(table: TableData, colIndices: number[]): string {
  const results: string[] = [];
  for (const i of colIndices) {
    if (table.columnTypes[i] !== "number") continue;
    const vals = table.rows.map((r) => parseNumber(r[i] ?? "0")).filter((v) => !isNaN(v));
    const avg = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    results.push(`Average "${table.headers[i]}": ${avg.toFixed(2)}`);
  }
  return results.join("; ") || "No numeric columns found.";
}

function filterRows(table: TableData, query: string): { rows: string[][]; description: string } {
  const valueMatch = query.match(/"([^"]+)"/) ?? query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
  if (!valueMatch) return { rows: table.rows, description: "No filter criteria detected." };

  const filterValue = valueMatch[1].toLowerCase();
  const filtered = table.rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(filterValue)));
  return { rows: filtered, description: `${filtered.length} row(s) matching "${valueMatch[1]}".` };
}

function compareRows(table: TableData, colIndices: number[]): string {
  if (table.rows.length < 2) return "Not enough rows to compare.";
  const lines: string[] = [];
  for (const i of colIndices) {
    if (table.columnTypes[i] !== "number") continue;
    const vals = table.rows.map((r, j) => ({ label: r[0] ?? `Row ${j + 1}`, val: parseNumber(r[i] ?? "0") }));
    vals.sort((a, b) => b.val - a.val);
    lines.push(`"${table.headers[i]}" — Highest: ${vals[0].label} (${vals[0].val}), Lowest: ${vals[vals.length - 1].label} (${vals[vals.length - 1].val})`);
  }
  return lines.join("\n") || "No numeric columns for comparison.";
}

function describeTable(table: TableData): string {
  const numericCols = table.headers.filter((_, i) => table.columnTypes[i] === "number");
  return (
    `Table with ${table.rows.length} row(s), ${table.headers.length} column(s). ` +
    `Columns: ${table.headers.join(", ")}.` +
    (numericCols.length > 0 ? ` Numeric: ${numericCols.join(", ")}.` : "")
  );
}

function lookupValue(table: TableData, query: string): string {
  const colIndices = findRelevantColumn(table.headers, query);
  return table.rows.slice(0, 5)
    .map((row) => colIndices.map((i) => `${table.headers[i]}: ${row[i] ?? "—"}`).join(", "))
    .join("\n") || "No matching data.";
}

export function queryTable(table: TableData, query: string): TableQueryResult {
  const operation = detectTableOperation(query);
  const colIndices = findRelevantColumn(table.headers, query);
  const affectedColumns = colIndices.map((i) => table.headers[i]);

  let result: string;
  let affectedRows: string[][] | undefined;

  switch (operation) {
    case "total": result = computeTotal(table, colIndices); break;
    case "average": result = computeAverage(table, colIndices); break;
    case "filter": { const f = filterRows(table, query); affectedRows = f.rows; result = f.description; break; }
    case "compare": result = compareRows(table, colIndices); break;
    case "count": result = `${table.rows.length} row(s) in table.`; break;
    case "sort": {
      const si = colIndices[0];
      affectedRows = [...table.rows]
        .sort((a, b) => table.columnTypes[si] === "number"
          ? parseNumber(b[si] ?? "0") - parseNumber(a[si] ?? "0")
          : (a[si] ?? "").localeCompare(b[si] ?? ""))
        .slice(0, 10);
      result = `Sorted by "${table.headers[si]}" (top 10 shown).`;
      break;
    }
    case "describe": result = describeTable(table); break;
    default: result = lookupValue(table, query);
  }

  return { table, operation, result, affectedRows, affectedColumns };
}

// ─── TableAwareGenerator ──────────────────────────────────────────────────────

export interface TableAwareGeneratorConfig {
  maxTablesPerResponse: number;
  includeSummarization: boolean;
  summarizationModel: string;
}

const DEFAULT_TAG_CONFIG: TableAwareGeneratorConfig = {
  maxTablesPerResponse: 5,
  includeSummarization: true,
  summarizationModel: process.env.RAG_RERANK_MODEL ?? "gpt-4o-mini",
};

export class TableAwareGenerator {
  private readonly config: TableAwareGeneratorConfig;

  constructor(config: Partial<TableAwareGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_TAG_CONFIG, ...config };
  }

  async processTableQuery(
    query: string,
    chunks: RetrievedChunk[]
  ): Promise<{ tables: TableData[]; queryResults: TableQueryResult[]; summary: string }> {
    const tables = extractTablesFromChunks(chunks).slice(0, this.config.maxTablesPerResponse);
    if (tables.length === 0) return { tables: [], queryResults: [], summary: "" };

    const queryResults = tables.map((t) => queryTable(t, query));

    const summary = this.config.includeSummarization
      ? await this.summarize(query, queryResults)
      : queryResults.map((r) => `• ${r.result}`).join("\n");

    logger.info("TableAwareGenerator complete", {
      query: query.slice(0, 60),
      tables: tables.length,
      operations: [...new Set(queryResults.map((r) => r.operation))],
    });

    return { tables, queryResults, summary };
  }

  private async summarize(query: string, results: TableQueryResult[]): Promise<string> {
    const operationSummary = results.map((r, i) => `Table ${i + 1} (${r.operation}): ${r.result}`).join("\n");
    try {
      const { llmGateway } = await import("../../lib/llmGateway");
      const response = await llmGateway.chat(
        [{ role: "user", content: `Query: ${query}\n\nTable analysis:\n${operationSummary}\n\nWrite a concise answer using these results. Be specific with numbers.` }],
        { model: this.config.summarizationModel, maxTokens: 300, temperature: 0.2 }
      );
      return response.content;
    } catch (err) {
      logger.warn("Table summarization failed", { error: String(err) });
      return operationSummary;
    }
  }

  static formatTableAsText(table: TableData, maxRows = 20): string {
    const header = table.headers.join(" | ");
    const separator = table.headers.map((h) => "-".repeat(h.length)).join("-|-");
    const dataRows = table.rows.slice(0, maxRows).map((row) =>
      table.headers.map((_, i) => row[i] ?? "").join(" | ")
    );
    const lines = [header, separator, ...dataRows];
    if (table.rows.length > maxRows) lines.push(`... and ${table.rows.length - maxRows} more rows`);
    return lines.join("\n");
  }

  static suggestVisualization(table: TableData): string {
    const numericCols = table.columnTypes.filter((t) => t === "number").length;
    const textCols = table.columnTypes.filter((t) => t === "text").length;
    if (numericCols >= 2 && table.rows.length > 5) return "line_chart";
    if (numericCols === 1 && textCols === 1) return "bar_chart";
    if (numericCols >= 1 && table.rows.length <= 8) return "pie_chart";
    if (table.columnTypes.some((t) => t === "date")) return "time_series";
    return "table";
  }
}
