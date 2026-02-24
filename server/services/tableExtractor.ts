/**
 * Table Extractor Service
 * 
 * Extracts structured tables from PDFs, images, and documents
 * using pattern recognition and heuristics.
 * 
 * Features:
 * - PDF table detection
 * - Image-based table extraction (via OCR)
 * - CSV/JSON output formats
 * - Header detection
 * - Multi-page table support
 */

import * as XLSX from 'xlsx';

// =============================================================================
// Types
// =============================================================================

export interface TableCell {
    value: string;
    rowSpan: number;
    colSpan: number;
    isHeader: boolean;
}

export interface ExtractedTable {
    id: string;
    headers: string[];
    rows: string[][];
    rawCells: TableCell[][];
    pageNumber?: number;
    confidence: number;
    bounds?: {
        top: number;
        left: number;
        bottom: number;
        right: number;
    };
}

export interface TableExtractionResult {
    tables: ExtractedTable[];
    totalTables: number;
    processingTimeMs: number;
    source: 'pdf' | 'image' | 'excel' | 'text';
}

export interface TableExtractionOptions {
    detectHeaders?: boolean;
    minColumns?: number;
    minRows?: number;
    outputFormat?: 'json' | 'csv' | 'markdown';
}

// =============================================================================
// Table Detection Patterns
// =============================================================================

// Pattern for detecting table-like structures in text
const TABLE_PATTERNS = {
    // Pipe-separated tables (Markdown style)
    pipeSeparated: /^\s*\|(.+\|)+\s*$/gm,

    // Tab-separated values
    tabSeparated: /^.+\t.+$/gm,

    // Multiple spaces as separators
    spaceSeparated: /^.+\s{3,}.+$/gm,

    // Dash/equals separators (ASCII tables)
    dashSeparator: /^[-=]+$/gm,

    // Comma-separated (CSV-like)
    commaSeparated: /^"?[^"]+(?:","[^"]+)+"?$/gm,
};

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Extract tables from text content (PDF extracted text, etc.)
 */
export function extractTablesFromText(
    text: string,
    options: TableExtractionOptions = {}
): TableExtractionResult {
    const startTime = Date.now();
    const { detectHeaders = true, minColumns = 2, minRows = 2 } = options;

    const tables: ExtractedTable[] = [];
    let tableIndex = 0;

    // Split by potential table boundaries
    const lines = text.split('\n');
    let currentTableLines: string[] = [];
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isTableLine = isLikelyTableRow(line);

        if (isTableLine) {
            if (!inTable) {
                inTable = true;
                currentTableLines = [];
            }
            currentTableLines.push(line);
        } else {
            if (inTable && currentTableLines.length >= minRows) {
                const table = parseTableFromLines(currentTableLines, tableIndex++, detectHeaders);
                if (table && table.headers.length >= minColumns) {
                    tables.push(table);
                }
            }
            inTable = false;
            currentTableLines = [];
        }
    }

    // Handle last table
    if (inTable && currentTableLines.length >= minRows) {
        const table = parseTableFromLines(currentTableLines, tableIndex++, detectHeaders);
        if (table && table.headers.length >= minColumns) {
            tables.push(table);
        }
    }

    return {
        tables,
        totalTables: tables.length,
        processingTimeMs: Date.now() - startTime,
        source: 'text'
    };
}

/**
 * Extract tables from Excel buffer
 */
export function extractTablesFromExcel(
    buffer: Buffer,
    options: TableExtractionOptions = {}
): TableExtractionResult {
    const startTime = Date.now();
    const { detectHeaders = true } = options;

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const tables: ExtractedTable[] = [];

    for (let i = 0; i < workbook.SheetNames.length; i++) {
        const sheetName = workbook.SheetNames[i];
        const sheet = workbook.Sheets[sheetName];

        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

        if (jsonData.length < 2) continue;

        // Filter out empty rows
        const rows = jsonData.filter(row => row.some(cell => cell !== undefined && cell !== ''));

        if (rows.length < 2) continue;

        const headers = detectHeaders
            ? rows[0].map(h => String(h || ''))
            : rows[0].map((_, idx) => `Column ${idx + 1}`);

        const dataRows = detectHeaders ? rows.slice(1) : rows;

        tables.push({
            id: `excel-${sheetName}-${i}`,
            headers,
            rows: dataRows.map(row => row.map(cell => String(cell || ''))),
            rawCells: dataRows.map(row =>
                row.map(cell => ({
                    value: String(cell || ''),
                    rowSpan: 1,
                    colSpan: 1,
                    isHeader: false
                }))
            ),
            pageNumber: i + 1,
            confidence: 0.95
        });
    }

    return {
        tables,
        totalTables: tables.length,
        processingTimeMs: Date.now() - startTime,
        source: 'excel'
    };
}

/**
 * Convert extracted table to CSV format
 */
export function tableToCSV(table: ExtractedTable): string {
    const escapeCSV = (value: string) => {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    };

    const lines: string[] = [];

    // Header row
    lines.push(table.headers.map(escapeCSV).join(','));

    // Data rows
    for (const row of table.rows) {
        lines.push(row.map(escapeCSV).join(','));
    }

    return lines.join('\n');
}

/**
 * Convert extracted table to Markdown format
 */
export function tableToMarkdown(table: ExtractedTable): string {
    const lines: string[] = [];

    // Header row
    lines.push('| ' + table.headers.join(' | ') + ' |');

    // Separator
    lines.push('| ' + table.headers.map(() => '---').join(' | ') + ' |');

    // Data rows
    for (const row of table.rows) {
        lines.push('| ' + row.join(' | ') + ' |');
    }

    return lines.join('\n');
}

/**
 * Convert extracted table to JSON format
 */
export function tableToJSON(table: ExtractedTable): object[] {
    return table.rows.map(row => {
        const obj: Record<string, string> = {};
        table.headers.forEach((header, idx) => {
            obj[header || `column_${idx}`] = row[idx] || '';
        });
        return obj;
    });
}

// =============================================================================
// Helper Functions
// =============================================================================

function isLikelyTableRow(line: string): boolean {
    const trimmed = line.trim();

    // Empty lines are not table rows
    if (!trimmed) return false;

    // Pipe-separated (Markdown tables)
    if (/^\|.+\|$/.test(trimmed)) return true;

    // Tab-separated
    if (trimmed.includes('\t') && (trimmed.match(/\t/g) || []).length >= 1) return true;

    // Multiple aligned columns (3+ spaces as separator)
    if ((trimmed.match(/\s{3,}/g) || []).length >= 1) return true;

    // Separator lines
    if (/^[-=|+]+$/.test(trimmed)) return true;

    return false;
}

function parseTableFromLines(
    lines: string[],
    tableIndex: number,
    detectHeaders: boolean
): ExtractedTable | null {
    // Remove separator lines
    const dataLines = lines.filter(line => !/^[-=|+\s]+$/.test(line.trim()));

    if (dataLines.length < 2) return null;

    // Detect separator character
    const separator = detectSeparator(dataLines[0]);

    // Parse rows
    const rows = dataLines.map(line => parseLine(line, separator));

    // Ensure consistent column count
    const maxCols = Math.max(...rows.map(r => r.length));
    const normalizedRows = rows.map(row => {
        while (row.length < maxCols) row.push('');
        return row;
    });

    // Detect headers
    const headers = detectHeaders
        ? normalizedRows[0]
        : normalizedRows[0].map((_, idx) => `Column ${idx + 1}`);

    const dataRows = detectHeaders ? normalizedRows.slice(1) : normalizedRows;

    return {
        id: `table-${tableIndex}`,
        headers,
        rows: dataRows,
        rawCells: dataRows.map(row =>
            row.map(cell => ({
                value: cell,
                rowSpan: 1,
                colSpan: 1,
                isHeader: false
            }))
        ),
        confidence: 0.75
    };
}

function detectSeparator(line: string): string | RegExp {
    // Check for pipe
    if (line.includes('|')) return '|';

    // Check for tab
    if (line.includes('\t')) return '\t';

    // Check for comma (CSV)
    if (line.includes(',') && !line.includes('  ')) return ',';

    // Default to multiple spaces
    return /\s{2,}/;
}

function parseLine(line: string, separator: string | RegExp): string[] {
    let trimmed = line.trim();

    // Remove leading/trailing pipes
    if (trimmed.startsWith('|')) trimmed = trimmed.substring(1);
    if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);

    const parts = trimmed.split(separator);
    return parts.map(p => p.trim());
}

// =============================================================================
// Export
// =============================================================================

export const tableExtractor = {
    extractTablesFromText,
    extractTablesFromExcel,
    tableToCSV,
    tableToMarkdown,
    tableToJSON
};

export default tableExtractor;
