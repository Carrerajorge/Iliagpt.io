import * as ExcelJSModule from "exceljs";
const ExcelJS = (ExcelJSModule as any).default || ExcelJSModule;
import type { FileParser, ParsedResult, DetectedFileType } from "./base";

// Security limits
const XLSX_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const XLSX_MAX_SHEETS = 100;
const XLSX_MAX_CELL_VALUE_LENGTH = 50_000;
const XLSX_MAX_METADATA_VALUE_LENGTH = 1000;

/** Sanitize metadata values */
function sanitizeMetadataValue(value: unknown): string {
  return String(value ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .substring(0, XLSX_MAX_METADATA_VALUE_LENGTH);
}

export class XlsxParser implements FileParser {
  name = "xlsx";
  supportedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ];

  private readonly MAX_ROWS_PREVIEW = 100;
  private readonly MAX_COLS_PREVIEW = 20;

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    const startTime = Date.now();
    console.log(`[XlsxParser] Starting Excel parse, size: ${content.length} bytes`);

    // Security: enforce file size limit
    if (content.length > XLSX_MAX_FILE_SIZE) {
      throw new Error(`Excel file exceeds maximum size of ${XLSX_MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(content);
      
      const sheetData: Array<{
        name: string;
        rowCount: number;
        columnCount: number;
        content: string;
        truncated: boolean;
      }> = [];

      const metadata = this.extractWorkbookMetadata(workbook);

      // Security: limit number of sheets processed
      let sheetCount = 0;
      workbook.eachSheet((worksheet) => {
        if (sheetCount >= XLSX_MAX_SHEETS) return;
        sheetCount++;
        const sheetResult = this.parseSheet(worksheet);
        sheetData.push(sheetResult);
      });

      const formattedOutput = this.formatOutput(metadata, sheetData);
      
      const elapsed = Date.now() - startTime;
      console.log(`[XlsxParser] Completed in ${elapsed}ms, ${sheetData.length} sheets processed`);

      return {
        text: formattedOutput,
        metadata: {
          ...metadata,
          sheets: sheetData.map(s => ({
            name: s.name,
            rowCount: s.rowCount,
            columnCount: s.columnCount,
            truncated: s.truncated,
          })),
        },
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[XlsxParser] Failed after ${elapsed}ms:`, error);
      
      if (error instanceof Error) {
        throw new Error(`Failed to parse Excel: ${error.message}`);
      }
      throw new Error("Failed to parse Excel: Unknown error");
    }
  }

  private extractWorkbookMetadata(workbook: ExcelJS.Workbook): Record<string, any> {
    const metadata: Record<string, any> = {
      sheetCount: 0,
    };

    let sheetCount = 0;
    workbook.eachSheet(() => sheetCount++);
    metadata.sheetCount = sheetCount;

    // Security: sanitize metadata values
    if (workbook.creator) metadata.author = sanitizeMetadataValue(workbook.creator);
    if (workbook.created) metadata.creationDate = workbook.created.toISOString().split('T')[0];
    if (workbook.modified) metadata.modificationDate = workbook.modified.toISOString().split('T')[0];
    if (workbook.company) metadata.company = sanitizeMetadataValue(workbook.company);

    return metadata;
  }

  private parseSheet(worksheet: ExcelJS.Worksheet): {
    name: string;
    rowCount: number;
    columnCount: number;
    content: string;
    truncated: boolean;
  } {
    const sheetName = worksheet.name;
    const rows: string[][] = [];
    let maxCols = 0;
    let totalRows = 0;
    let truncated = false;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      totalRows = rowNumber;
      
      if (rows.length >= this.MAX_ROWS_PREVIEW) {
        truncated = true;
        return;
      }

      const values: string[] = [];
      let colIndex = 0;
      
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > this.MAX_COLS_PREVIEW) {
          truncated = true;
          return;
        }
        
        while (values.length < colNumber - 1) {
          values.push('');
        }
        
        const cellValue = this.getCellValue(cell);
        values.push(cellValue);
        colIndex = colNumber;
      });
      
      maxCols = Math.max(maxCols, values.length);
      rows.push(values);
    });

    const normalizedRows = rows.map(row => {
      while (row.length < maxCols) row.push('');
      return row;
    });

    const markdownTable = this.createMarkdownTable(normalizedRows, sheetName, totalRows, truncated);

    return {
      name: sheetName,
      rowCount: totalRows,
      columnCount: maxCols,
      content: markdownTable,
      truncated,
    };
  }

  private getCellValue(cell: ExcelJS.Cell): string {
    if (cell.value === null || cell.value === undefined) {
      return '';
    }

    if (typeof cell.value === 'object') {
      if ('result' in cell.value) {
        return String(cell.value.result ?? '');
      }
      if ('text' in cell.value) {
        return (cell.value as any).text;
      }
      if ('richText' in cell.value) {
        return (cell.value as any).richText.map((rt: any) => rt.text).join('');
      }
      if (cell.value instanceof Date) {
        return cell.value.toISOString().split('T')[0];
      }
      return cell.text ?? String(cell.value);
    }

    if (typeof cell.value === 'number') {
      if (Number.isInteger(cell.value)) {
        return String(cell.value);
      }
      return cell.value.toFixed(2);
    }

    // Security: limit cell value length
    return String(cell.value).substring(0, XLSX_MAX_CELL_VALUE_LENGTH);
  }

  private createMarkdownTable(
    rows: string[][],
    sheetName: string,
    totalRows: number,
    truncated: boolean
  ): string {
    if (rows.length === 0) {
      return `*Empty sheet*`;
    }

    const parts: string[] = [];
    
    const columnWidths = this.calculateColumnWidths(rows);
    
    const headerRow = rows[0];
    parts.push('| ' + headerRow.map((cell, i) => this.padCell(cell, columnWidths[i])).join(' | ') + ' |');
    parts.push('| ' + columnWidths.map(w => '-'.repeat(Math.max(3, w))).join(' | ') + ' |');
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      parts.push('| ' + row.map((cell, j) => this.padCell(cell, columnWidths[j])).join(' | ') + ' |');
    }

    if (truncated) {
      parts.push('');
      parts.push(`*Note: Sheet has ${totalRows} total rows. Showing first ${Math.min(this.MAX_ROWS_PREVIEW, rows.length)} rows.*`);
    }

    return parts.join('\n');
  }

  private calculateColumnWidths(rows: string[][]): number[] {
    if (rows.length === 0) return [];
    
    const widths: number[] = new Array(rows[0].length).fill(3);
    
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        const escapedCell = this.escapeMarkdown(row[i]);
        widths[i] = Math.min(30, Math.max(widths[i], escapedCell.length));
      }
    }
    
    return widths;
  }

  private padCell(cell: string, width: number): string {
    const escaped = this.escapeMarkdown(cell);
    if (escaped.length >= width) {
      return escaped.substring(0, width);
    }
    return escaped + ' '.repeat(width - escaped.length);
  }

  private escapeMarkdown(text: string): string {
    return text
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '')
      .trim();
  }

  private formatOutput(
    metadata: Record<string, any>,
    sheets: Array<{ name: string; rowCount: number; columnCount: number; content: string; truncated: boolean }>
  ): string {
    const parts: string[] = [];
    
    parts.push('=== Workbook Info ===');
    if (metadata.author) parts.push(`Author: ${metadata.author}`);
    if (metadata.company) parts.push(`Company: ${metadata.company}`);
    if (metadata.creationDate) parts.push(`Created: ${metadata.creationDate}`);
    parts.push(`Sheets: ${metadata.sheetCount}`);
    parts.push('');

    for (const sheet of sheets) {
      parts.push(`## Sheet: ${sheet.name}`);
      parts.push(`*${sheet.rowCount} rows × ${sheet.columnCount} columns*`);
      parts.push('');
      parts.push(sheet.content);
      parts.push('');
    }

    return parts.join('\n').trim();
  }
}
