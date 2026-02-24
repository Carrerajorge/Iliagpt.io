import * as ExcelJSModule from "exceljs";
const ExcelJS = ExcelJSModule.default || ExcelJSModule;
import type { ExcelSpec, TableSpec, ChartSpec, SheetLayoutSpec, HeaderStyle } from "../../shared/documentSpecs";
import { tokenizeMarkdown, hasMarkdown, RichTextToken } from "./richText/markdownTokenizer";
import { formatLatexForExcel } from "./richText/latexToImage";

// Security: complete list of formula injection prefixes (CSV injection / DDE attacks)
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "|", "\\"];

// Security limits
const MAX_SHEETS = 50;
const MAX_TABLE_ROWS = 100_000;
const MAX_TABLE_COLUMNS = 500;
const MAX_CELL_LENGTH = 32_767; // Excel cell limit
const MAX_CELL_REF_COL_LETTERS = 3; // Max 3 column letters (XFD = max Excel column)
const MAX_CELL_REF_ROW = 1_048_576; // Max Excel row

/** Validate a hex color string (6-char hex without #) */
function isValidHexColor(color: string): boolean {
  return /^[0-9A-Fa-f]{6}$/.test(color.replace(/^#/, ""));
}

interface ExcelRichTextRun {
  text: string;
  font?: Partial<ExcelJS.Font>;
}

function tokensToExcelRichText(tokens: RichTextToken[]): ExcelRichTextRun[] {
  return tokens.map((token) => {
    let displayText = token.text;
    const font: Partial<ExcelJS.Font> = {};

    if (token.bold) font.bold = true;
    if (token.italic) font.italic = true;
    if (token.code) {
      font.name = "Courier New";
      font.color = { argb: "FF666666" };
    }
    if (token.link) {
      font.underline = true;
      font.color = { argb: "FF0066CC" };
    }
    if (token.isMath) {
      displayText = formatLatexForExcel(token.text);
      font.italic = true;
      font.color = { argb: "FF336699" };
    }

    const run: ExcelRichTextRun = { text: displayText };
    if (Object.keys(font).length > 0) {
      run.font = font;
    }
    return run;
  });
}

function applyRichTextToCell(cell: ExcelJS.Cell, value: any): void {
  if (value === null || value === undefined) {
    cell.value = "";
    return;
  }

  const strValue = String(value);
  if (!hasMarkdown(strValue)) {
    cell.value = strValue;
    return;
  }

  const tokens = tokenizeMarkdown(strValue);
  const richText = tokensToExcelRichText(tokens);
  cell.value = { richText } as any;
}

const MIN_COL_WIDTH = 8;
const MAX_COL_WIDTH = 60;

function parseCellReference(ref: string): { col: number; row: number } {
  // Security: validate cell reference format with bounded length
  const safeRef = String(ref).trim().substring(0, 20);
  const match = safeRef.match(/^([A-Z]+)(\d+)$/i);
  if (!match) {
    throw new Error(`Invalid cell reference: ${safeRef}`);
  }
  const colLetters = match[1].toUpperCase();
  const rowStr = match[2];

  // Security: limit column letters and row number to prevent abuse
  if (colLetters.length > MAX_CELL_REF_COL_LETTERS) {
    throw new Error(`Cell reference column exceeds maximum: ${colLetters}`);
  }
  const row = parseInt(rowStr, 10);
  if (row < 1 || row > MAX_CELL_REF_ROW || !Number.isFinite(row)) {
    throw new Error(`Cell reference row out of range: ${row}`);
  }

  let col = 0;
  for (let i = 0; i < colLetters.length; i++) {
    col = col * 26 + (colLetters.charCodeAt(i) - 64);
  }
  return { col, row };
}

function columnIndexToLetter(index: number): string {
  let letter = "";
  while (index > 0) {
    const mod = (index - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    index = Math.floor((index - 1) / 26);
  }
  return letter || "A";
}

function escapeFormulaText(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trimStart();
  if (trimmed.length > 0 && FORMULA_PREFIXES.includes(trimmed[0])) {
    return "'" + value;
  }
  return value;
}

function sanitizeTableName(name: string | null | undefined, fallbackIndex: number): string {
  if (!name) {
    return `Table${fallbackIndex}`;
  }
  let cleaned = name.replace(/[^A-Za-z0-9_]/g, "_").trim();
  if (!cleaned) {
    return `Table${fallbackIndex}`;
  }
  if (!/^[A-Za-z_]/.test(cleaned)) {
    cleaned = `T_${cleaned}`;
  }
  return cleaned.slice(0, 255);
}

function heuristicColumnWidth(values: any[]): number {
  let maxLen = 0;
  for (const v of values) {
    const s = v === null || v === undefined ? "" : String(v);
    maxLen = Math.max(maxLen, s.length);
  }
  const width = maxLen + 2;
  return Math.min(Math.max(width, MIN_COL_WIDTH), MAX_COL_WIDTH);
}

let tableCounter = 0;

export async function renderExcelFromSpec(spec: ExcelSpec): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  // Security: generic creator metadata
  workbook.creator = "Document Generator";
  workbook.lastModifiedBy = "";
  workbook.company = "";
  workbook.manager = "";
  workbook.created = new Date();
  tableCounter = 0;

  if (spec.workbook_title) {
    workbook.title = String(spec.workbook_title).substring(0, 500);
  }

  // Security: limit number of sheets
  const sheets = (spec.sheets || []).slice(0, MAX_SHEETS);

  for (const sheetSpec of sheets) {
    const sheetName = sheetSpec.name.replace(/[\\/:*?\[\]]/g, "").slice(0, 31) || "Sheet";
    const worksheet = workbook.addWorksheet(sheetName);

    for (const tableSpec of sheetSpec.tables || []) {
      renderTable(worksheet, tableSpec);
    }

    for (const chartSpec of sheetSpec.charts || []) {
      renderChart(worksheet, chartSpec, sheetName);
    }

    applyLayout(worksheet, sheetSpec.layout || {});
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function renderTable(worksheet: ExcelJS.Worksheet, table: TableSpec): void {
  const anchor = parseCellReference(table.anchor);
  const startRow = anchor.row;
  const startCol = anchor.col;

  // Security: enforce column and row limits
  if (table.headers.length > MAX_TABLE_COLUMNS) {
    console.warn(`[ExcelRenderer] Table has ${table.headers.length} columns, truncating to ${MAX_TABLE_COLUMNS}`);
    table.headers = table.headers.slice(0, MAX_TABLE_COLUMNS);
  }
  if (table.rows && table.rows.length > MAX_TABLE_ROWS) {
    console.warn(`[ExcelRenderer] Table has ${table.rows.length} rows, truncating to ${MAX_TABLE_ROWS}`);
    table.rows = table.rows.slice(0, MAX_TABLE_ROWS);
  }

  const endCol = startCol + table.headers.length - 1;
  const endRow = startRow + (table.rows?.length || 0);
  
  tableCounter++;
  const tableName = sanitizeTableName(table.name, tableCounter);
  
  const tableStyle = table.table_style || "TableStyleMedium9";
  const formulas = table.formulas || {};
  const formulaHeaders = new Set(Object.keys(formulas));

  const processedRows = (table.rows || []).map((row, rowIdx) => {
    const excelRowNum = startRow + 1 + rowIdx;
    return row.map((value, colIdx) => {
      const header = table.headers[colIdx];
      if (formulaHeaders.has(header)) {
        const template = formulas[header];
        return template.replace(/\{row\}/g, String(excelRowNum));
      }
      return escapeFormulaText(value);
    });
  });

  worksheet.addTable({
    name: tableName,
    ref: table.anchor,
    headerRow: true,
    totalsRow: false,
    style: {
      theme: tableStyle as any,
      showRowStripes: true,
      showColumnStripes: false,
    },
    columns: table.headers.map(header => ({
      name: header,
      filterButton: table.autofilter !== false,
    })),
    rows: processedRows,
  });

  for (let rowIdx = 0; rowIdx < (table.rows?.length || 0); rowIdx++) {
    const excelRowNum = startRow + 1 + rowIdx;
    const excelRow = worksheet.getRow(excelRowNum);
    const row = table.rows![rowIdx];
    row.forEach((value, colIdx) => {
      const header = table.headers[colIdx];
      if (!formulaHeaders.has(header) && value != null && typeof value === "string" && hasMarkdown(value)) {
        const cell = excelRow.getCell(startCol + colIdx);
        applyRichTextToCell(cell, value);
      }
    });
  }

  const headerStyle = table.header_style || {};
  applyHeaderStyle(worksheet, startRow, startCol, table.headers, headerStyle);

  if (table.column_formats) {
    for (let rowIdx = 1; rowIdx <= (table.rows?.length || 0); rowIdx++) {
      const excelRow = worksheet.getRow(startRow + rowIdx);
      table.headers.forEach((header, colIdx) => {
        if (table.column_formats![header]) {
          const cell = excelRow.getCell(startCol + colIdx);
          cell.numFmt = table.column_formats![header];
        }
      });
    }
  }

  applyAutoFitForTable(worksheet, table, startCol);

  if (table.freeze_header !== false) {
    worksheet.views = [
      { state: "frozen", xSplit: 0, ySplit: startRow },
    ];
  }
}

function applyHeaderStyle(
  worksheet: ExcelJS.Worksheet,
  headerRow: number,
  startCol: number,
  headers: string[],
  style: Partial<HeaderStyle>
): void {
  const row = worksheet.getRow(headerRow);
  
  headers.forEach((_, colIdx) => {
    const cell = row.getCell(startCol + colIdx);
    
    const fontOptions: Partial<ExcelJS.Font> = {};
    if (style.bold !== false) {
      fontOptions.bold = true;
    }
    if (Object.keys(fontOptions).length > 0) {
      cell.font = { ...cell.font, ...fontOptions };
    }

    if (style.fill_color) {
      const cleanColor = String(style.fill_color).replace(/^#/, "");
      // Security: validate color is a valid hex value
      if (isValidHexColor(cleanColor)) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: `FF${cleanColor}` },
        };
      }
    }

    const alignmentOptions: Partial<ExcelJS.Alignment> = {};
    if (style.text_align) {
      alignmentOptions.horizontal = style.text_align;
    }
    if (style.wrap_text !== false) {
      alignmentOptions.wrapText = true;
    }
    alignmentOptions.vertical = "middle";
    
    if (Object.keys(alignmentOptions).length > 0) {
      cell.alignment = { ...cell.alignment, ...alignmentOptions };
    }
  });
}

function applyAutoFitForTable(
  worksheet: ExcelJS.Worksheet,
  table: TableSpec,
  startCol: number
): void {
  table.headers.forEach((header, colIdx) => {
    const colLetter = columnIndexToLetter(startCol + colIdx);
    const column = worksheet.getColumn(startCol + colIdx);
    
    if (column.width !== undefined && column.width !== 8.43) {
      return;
    }

    const columnValues: any[] = [header];
    for (const row of table.rows || []) {
      columnValues.push(row[colIdx]);
    }

    column.width = heuristicColumnWidth(columnValues);
  });
}

function renderChart(worksheet: ExcelJS.Worksheet, chart: ChartSpec, sheetName: string): void {
  try {
    const position = parseCellReference(chart.position || "H2");
    const cell = worksheet.getRow(position.row).getCell(position.col);
    cell.value = `[Chart placeholder: ${chart.title || chart.type || 'Chart'} - Charts require manual creation in Excel]`;
    cell.font = { italic: true, color: { argb: "FF808080" } };
  } catch (error) {
    console.warn(`[ExcelRenderer] Invalid chart position "${chart.position}", using default H2`);
    const cell = worksheet.getRow(2).getCell(8);
    cell.value = `[Chart: ${chart.title || chart.type || 'Chart'}]`;
    cell.font = { italic: true, color: { argb: "FF808080" } };
  }
}

function applyLayout(worksheet: ExcelJS.Worksheet, layout: SheetLayoutSpec): void {
  if (layout.freeze_panes) {
    const freeze = parseCellReference(layout.freeze_panes);
    worksheet.views = [
      { state: "frozen", xSplit: freeze.col - 1, ySplit: freeze.row - 1 },
    ];
  }

  if (layout.show_gridlines === false) {
    worksheet.views = worksheet.views?.map(v => ({ ...v, showGridLines: false })) || 
      [{ showGridLines: false }];
  }

  if (layout.column_widths) {
    for (const [colLetter, width] of Object.entries(layout.column_widths)) {
      const colNum = parseCellReference(`${colLetter}1`).col;
      const column = worksheet.getColumn(colNum);
      column.width = width;
    }
  }

  if (layout.auto_fit_columns !== false) {
    worksheet.columns?.forEach(column => {
      if (column.width === undefined || column.width === 8.43) {
        const values: any[] = [];
        column.eachCell?.({ includeEmpty: false }, cell => {
          values.push(cell.value);
        });
        if (values.length > 0) {
          column.width = heuristicColumnWidth(values);
        }
      }
    });
  }
}
