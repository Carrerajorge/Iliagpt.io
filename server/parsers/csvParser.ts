import type { FileParser, ParsedResult, DetectedFileType } from "./base";

export interface CSVRowInfo {
  rowNumber: number;
  columns: string[];
  values: Record<string, string>;
}

export interface CSVParseResult extends ParsedResult {
  rows: CSVRowInfo[];
  headers: string[];
  totalRows: number;
  totalColumns: number;
}

// CSV Security Limits
const CSV_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const CSV_MAX_ROWS = 1_000_000;
const CSV_MAX_COLUMNS = 1_000;
const CSV_MAX_CELL_LENGTH = 100_000; // 100KB per cell
const CSV_MAX_LINE_LENGTH = 1_000_000; // 1MB per line

/**
 * CSV formula injection prefixes that could trigger code execution
 * when opened in spreadsheet applications (Excel, LibreOffice Calc, Google Sheets).
 */
const CSV_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "|", "\\"];

/**
 * Sanitize a CSV cell value to prevent formula injection attacks.
 * Prefixes dangerous values with a single quote to neutralize them.
 */
function sanitizeCsvCell(value: string): string {
  if (!value || value.length === 0) return value;
  const trimmed = value.trimStart();
  if (trimmed.length === 0) return value;
  if (CSV_FORMULA_PREFIXES.some(prefix => trimmed.startsWith(prefix))) {
    return `'${value}`;
  }
  return value;
}

/**
 * Dedicated CSV Parser with row/column citations
 * Generates citations in format: [doc:filename.csv row:N col:M]
 *
 * Security hardening:
 * - File size limits to prevent memory exhaustion
 * - Row/column count limits
 * - Cell length limits
 * - Formula injection protection (CSV injection / DDE attacks)
 */
export class CsvParser implements FileParser {
  name = "CsvParser";
  supportedMimeTypes = [
    "text/csv",
    "application/csv",
    "text/comma-separated-values",
  ];

  supports(fileType: DetectedFileType): boolean {
    const extensions = ["csv"];

    return (
      this.supportedMimeTypes.includes(fileType.mimeType.toLowerCase()) ||
      extensions.includes(fileType.extension?.toLowerCase() || "")
    );
  }

  async parse(buffer: Buffer, fileTypeOrFilename: DetectedFileType | string): Promise<CSVParseResult> {
    const filename = typeof fileTypeOrFilename === "string"
      ? fileTypeOrFilename
      : (fileTypeOrFilename.extension ? `file.${fileTypeOrFilename.extension}` : "file.csv");

    // Security: enforce file size limit
    if (buffer.length > CSV_MAX_FILE_SIZE) {
      throw new Error(`CSV file exceeds maximum size of ${CSV_MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    const content = buffer.toString("utf-8");
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);

    if (lines.length === 0) {
      return {
        text: "",
        metadata: {
          format: "csv",
          headers: [],
          totalRows: 0,
          totalColumns: 0,
          filename,
          parser_used: this.name,
        },
        rows: [],
        headers: [],
        totalRows: 0,
        totalColumns: 0,
      };
    }

    // Security: enforce row limit
    if (lines.length > CSV_MAX_ROWS + 1) { // +1 for header
      throw new Error(`CSV file exceeds maximum row count of ${CSV_MAX_ROWS}`);
    }

    // Parse headers from first line
    const rawHeaders = this.parseCSVLine(lines[0]);

    // Security: enforce column limit
    if (rawHeaders.length > CSV_MAX_COLUMNS) {
      throw new Error(`CSV file exceeds maximum column count of ${CSV_MAX_COLUMNS}`);
    }

    // Sanitize headers against formula injection
    const headers = rawHeaders.map(h => sanitizeCsvCell(h.substring(0, CSV_MAX_CELL_LENGTH)));
    const rows: CSVRowInfo[] = [];
    const textParts: string[] = [];

    // Add header info to text
    textParts.push(`=== ${filename} ===`);
    textParts.push(`Columns (${headers.length}): ${headers.join(", ")}`);
    textParts.push("");

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      // Security: enforce line length limit
      if (lines[i].length > CSV_MAX_LINE_LENGTH) {
        console.warn(`[CsvParser] Row ${i} exceeds max line length, truncating`);
        lines[i] = lines[i].substring(0, CSV_MAX_LINE_LENGTH);
      }

      const rawValues = this.parseCSVLine(lines[i]);
      const rowNumber = i; // 1-indexed (excluding header)

      const rowInfo: CSVRowInfo = {
        rowNumber,
        columns: headers,
        values: {},
      };

      // Build value map and citation text
      const cellTexts: string[] = [];
      for (let j = 0; j < headers.length; j++) {
        const header = headers[j] || `col${j + 1}`;
        // Sanitize cell value against formula injection and enforce cell length limit
        const rawValue = rawValues[j] || "";
        const value = sanitizeCsvCell(rawValue.substring(0, CSV_MAX_CELL_LENGTH));
        rowInfo.values[header] = value;

        if (value.trim()) {
          // Format: [doc:file.csv row:N col:header]
          cellTexts.push(`${header}: "${value}" [doc:${filename} row:${rowNumber} col:${header}]`);
        }
      }

      if (cellTexts.length > 0) {
        textParts.push(`Row ${rowNumber}:`);
        textParts.push(cellTexts.join("; "));
        textParts.push("");
      }

      rows.push(rowInfo);
    }

    const fullText = textParts.join("\n");

    return {
      text: fullText,
      metadata: {
        format: "csv",
        headers,
        totalRows: rows.length,
        totalColumns: headers.length,
        filename,
        parser_used: this.name,
        citationFormat: "[doc:filename.csv row:N col:M]",
      },
      rows,
      headers,
      totalRows: rows.length,
      totalColumns: headers.length,
    };
  }

  /**
   * Parse a single CSV line, handling quoted values
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"' && !inQuotes) {
        inQuotes = true;
      } else if (char === '"' && inQuotes) {
        if (nextChar === '"') {
          current += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = false;
        }
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  /**
   * Get specific cell citation
   */
  getCellCitation(filename: string, row: number, column: string): string {
    return `[doc:${filename} row:${row} col:${column}]`;
  }

  /**
   * Get row citation
   */
  getRowCitation(filename: string, row: number): string {
    return `[doc:${filename} row:${row}]`;
  }
}
