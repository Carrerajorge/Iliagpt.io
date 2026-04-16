import type { DocSpec, DocBlock, ExcelSpec, SheetSpec, TableSpec } from "../../shared/documentSpecs";

// Severity levels for validation issues
export type Severity = "error" | "warning" | "info";

// Validation issue structure
export interface ValidationIssue {
  code: string;
  message: string;
  path: string;
  severity: Severity;
}

// Quality report returned by validation functions
export interface QualityReport {
  valid: boolean;
  errors: Array<{ code: string; message: string; path: string }>;
  warnings: Array<{ code: string; message: string; path: string }>;
  info: Array<{ code: string; message: string; path: string }>;
}

// Error codes for DocSpec validation
export const DOC_ERROR_CODES = {
  TOO_MANY_BLOCKS: "DOC_E001",
  TOO_MANY_BULLETS: "DOC_E002",
  TOO_MANY_TABLE_COLUMNS: "DOC_E003",
  TOO_MANY_TABLE_ROWS: "DOC_E004",
  INVALID_HEADING_LEVEL: "DOC_E005",
  INVALID_TABLE_STYLE: "DOC_E006",
  EMPTY_BLOCKS: "DOC_E007",
  EMPTY_BULLET_ITEMS: "DOC_E008",
  EMPTY_TABLE_COLUMNS: "DOC_E009",
  MISMATCHED_ROW_LENGTH: "DOC_E010",
} as const;

// Warning codes for DocSpec validation
export const DOC_WARNING_CODES = {
  MANY_BLOCKS: "DOC_W001",
  MANY_BULLETS: "DOC_W002",
  LARGE_TABLE: "DOC_W003",
  NO_TITLE: "DOC_W004",
  DEEP_HEADING: "DOC_W005",
  MULTIPLE_TITLES: "DOC_W006",
  TOC_LATE: "DOC_W007",
} as const;

// Error codes for ExcelSpec validation
export const EXCEL_ERROR_CODES = {
  TOO_MANY_SHEETS: "EXCEL_E001",
  TOO_MANY_CELLS: "EXCEL_E002",
  TOO_MANY_TABLE_ROWS: "EXCEL_E003",
  TOO_MANY_TABLE_COLUMNS: "EXCEL_E004",
  INVALID_COLUMN_FORMAT: "EXCEL_E005",
  INVALID_SHEET_NAME: "EXCEL_E006",
  INVALID_ANCHOR: "EXCEL_E007",
  EMPTY_SHEETS: "EXCEL_E008",
  EMPTY_TABLE_HEADERS: "EXCEL_E009",
  MISMATCHED_ROW_LENGTH: "EXCEL_E010",
  INVALID_CHART_RANGE: "EXCEL_E011",
  CHART_RANGE_OUT_OF_BOUNDS: "EXCEL_E012",
} as const;

// Warning codes for ExcelSpec validation
export const EXCEL_WARNING_CODES = {
  MANY_SHEETS: "EXCEL_W001",
  MANY_CELLS: "EXCEL_W002",
  LARGE_TABLE: "EXCEL_W003",
  NO_WORKBOOK_TITLE: "EXCEL_W004",
  DUPLICATE_SHEET_NAMES: "EXCEL_W005",
  TABLE_OVERLAP: "EXCEL_W006",
  FORMULA_LIKE_TEXT: "EXCEL_W007",
} as const;

// Limits for DoS protection
export const DOC_LIMITS = {
  MAX_BLOCKS: 100,
  MAX_BULLET_ITEMS_TOTAL: 500,
  MAX_TABLE_COLUMNS: 26,
  MAX_TABLE_ROWS: 1000,
  MIN_HEADING_LEVEL: 1,
  MAX_HEADING_LEVEL: 6,
  // Warning thresholds
  WARN_BLOCKS: 75,
  WARN_BULLET_ITEMS: 300,
  WARN_TABLE_ROWS: 500,
} as const;

export const EXCEL_LIMITS = {
  MAX_SHEETS: 50,
  MAX_CELLS_PER_SHEET: 5000000,
  MAX_TABLE_ROWS: 50000,
  MAX_TABLE_COLUMNS: 1000,
  MAX_SHEET_NAME_LENGTH: 31,
  // Warning thresholds
  WARN_SHEETS: 30,
  WARN_CELLS_PER_SHEET: 1000000,
  WARN_TABLE_ROWS: 10000,
} as const;

// Valid Word table styles
const VALID_WORD_TABLE_STYLES = new Set([
  "Table Grid",
  "Light Shading",
  "Light Shading Accent 1",
  "Light Shading Accent 2",
  "Light Shading Accent 3",
  "Light Shading Accent 4",
  "Light Shading Accent 5",
  "Light Shading Accent 6",
  "Light List",
  "Light Grid",
  "Medium Shading 1",
  "Medium Shading 2",
  "Medium List 1",
  "Medium List 2",
  "Medium Grid 1",
  "Medium Grid 2",
  "Medium Grid 3",
  "Dark List",
  "Colorful Shading",
  "Colorful List",
  "Colorful Grid",
]);

// Valid Excel number formats
const VALID_EXCEL_FORMATS = new Set([
  "General",
  "0",
  "0.00",
  "#,##0",
  "#,##0.00",
  "0%",
  "0.00%",
  "$#,##0",
  "$#,##0.00",
  "mm/dd/yyyy",
  "dd/mm/yyyy",
  "yyyy-mm-dd",
  "h:mm AM/PM",
  "h:mm:ss AM/PM",
  "m/d/yy h:mm",
  "@", // Text format
]);

// Cell reference validation regex
const CELL_REFERENCE_REGEX = /^[A-Z]{1,3}[1-9][0-9]*$/i;
const RANGE_REGEX = /^[A-Z]{1,3}[1-9][0-9]*:[A-Z]{1,3}[1-9][0-9]*$/i;

function createIssue(
  code: string,
  message: string,
  path: string,
  severity: Severity
): ValidationIssue {
  return { code, message, path, severity };
}

function isValidCellReference(ref: string): boolean {
  return CELL_REFERENCE_REGEX.test(ref);
}

function isValidRange(range: string): boolean {
  return RANGE_REGEX.test(range);
}

interface TableBoundingBox {
  tableIndex: number;
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

function parseCellReferenceToCoords(ref: string): { row: number; col: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;

  const colStr = match[1].toUpperCase();
  const rowNum = parseInt(match[2], 10);

  // Convert column letters to 0-based index (A=0, B=1, ..., Z=25, AA=26, etc.)
  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  col -= 1; // Convert to 0-based

  return { row: rowNum, col };
}

function getTableBoundingBox(table: TableSpec, tableIndex: number): TableBoundingBox | null {
  const anchorCoords = parseCellReferenceToCoords(table.anchor);
  if (!anchorCoords) return null;

  const headers = table.headers || [];
  const rows = table.rows || [];

  return {
    tableIndex,
    minRow: anchorCoords.row,
    maxRow: anchorCoords.row + rows.length, // +1 for header row is included since anchor is row 1
    minCol: anchorCoords.col,
    maxCol: anchorCoords.col + headers.length - 1,
  };
}

function tablesOverlap(a: TableBoundingBox, b: TableBoundingBox): boolean {
  // Two rectangles do NOT overlap if one is completely to the left, right, above, or below the other
  // They overlap if: !(a.maxRow < b.minRow || b.maxRow < a.minRow || a.maxCol < b.minCol || b.maxCol < a.minCol)
  return !(a.maxRow < b.minRow || b.maxRow < a.minRow || a.maxCol < b.minCol || b.maxCol < a.minCol);
}

function parseRangeToCoords(range: string): { start: { row: number; col: number }; end: { row: number; col: number } } | null {
  const parts = range.split(":");
  if (parts.length !== 2) return null;

  const start = parseCellReferenceToCoords(parts[0].trim());
  const end = parseCellReferenceToCoords(parts[1].trim());

  if (!start || !end) return null;
  return { start, end };
}

function isRangeWithinTableBounds(range: string, tables: TableSpec[]): { valid: boolean; reason: string } {
  const rangeCoords = parseRangeToCoords(range);
  if (!rangeCoords) {
    return { valid: false, reason: "invalid range format" };
  }

  for (const table of tables) {
    const anchorCoords = parseCellReferenceToCoords(table.anchor);
    if (!anchorCoords) continue;

    const headers = table.headers || [];
    const rows = table.rows || [];

    const tableMinRow = anchorCoords.row;
    const tableMaxRow = anchorCoords.row + rows.length;
    const tableMinCol = anchorCoords.col;
    const tableMaxCol = anchorCoords.col + headers.length - 1;

    if (
      rangeCoords.start.row >= tableMinRow &&
      rangeCoords.end.row <= tableMaxRow &&
      rangeCoords.start.col >= tableMinCol &&
      rangeCoords.end.col <= tableMaxCol
    ) {
      return { valid: true, reason: "" };
    }
  }

  return { valid: false, reason: "range extends beyond all table boundaries" };
}

function isFormulaLikeText(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const firstChar = trimmed[0];
  return firstChar === "=" || firstChar === "+" || firstChar === "-" || firstChar === "@";
}

/**
 * Validates a DocSpec for Word document generation
 */
export function validateDocSpec(spec: DocSpec): QualityReport {
  const issues: ValidationIssue[] = [];
  const blocks = spec.blocks || [];

  // Check total blocks
  if (blocks.length > DOC_LIMITS.MAX_BLOCKS) {
    issues.push(
      createIssue(
        DOC_ERROR_CODES.TOO_MANY_BLOCKS,
        `Document has ${blocks.length} blocks, maximum allowed is ${DOC_LIMITS.MAX_BLOCKS}`,
        "blocks",
        "error"
      )
    );
  } else if (blocks.length > DOC_LIMITS.WARN_BLOCKS) {
    issues.push(
      createIssue(
        DOC_WARNING_CODES.MANY_BLOCKS,
        `Document has ${blocks.length} blocks, consider splitting into multiple documents`,
        "blocks",
        "warning"
      )
    );
  }

  if (blocks.length === 0) {
    issues.push(
      createIssue(
        DOC_ERROR_CODES.EMPTY_BLOCKS,
        "Document has no content blocks",
        "blocks",
        "error"
      )
    );
  }

  // Check title
  if (!spec.title || spec.title.trim() === "") {
    issues.push(
      createIssue(
        DOC_WARNING_CODES.NO_TITLE,
        "Document has no title specified",
        "title",
        "warning"
      )
    );
  }

  // Count total bullet items and validate blocks
  let totalBulletItems = 0;

  blocks.forEach((block, index) => {
    const blockPath = `blocks[${index}]`;

    switch (block.type) {
      case "heading":
        if (block.level < DOC_LIMITS.MIN_HEADING_LEVEL || block.level > DOC_LIMITS.MAX_HEADING_LEVEL) {
          issues.push(
            createIssue(
              DOC_ERROR_CODES.INVALID_HEADING_LEVEL,
              `Heading level ${block.level} is invalid, must be between 1 and 6`,
              `${blockPath}.level`,
              "error"
            )
          );
        } else if (block.level >= 5) {
          issues.push(
            createIssue(
              DOC_WARNING_CODES.DEEP_HEADING,
              `Heading level ${block.level} is very deep, consider restructuring`,
              `${blockPath}.level`,
              "warning"
            )
          );
        }
        break;

      case "bullets":
        const items = block.items || [];
        totalBulletItems += items.length;
        if (items.length === 0) {
          issues.push(
            createIssue(
              DOC_ERROR_CODES.EMPTY_BULLET_ITEMS,
              "Bullet block has no items",
              `${blockPath}.items`,
              "error"
            )
          );
        }
        break;

      case "table":
        const columns = block.columns || [];
        const rows = block.rows || [];

        if (columns.length === 0) {
          issues.push(
            createIssue(
              DOC_ERROR_CODES.EMPTY_TABLE_COLUMNS,
              "Table has no columns defined",
              `${blockPath}.columns`,
              "error"
            )
          );
        }

        if (columns.length > DOC_LIMITS.MAX_TABLE_COLUMNS) {
          issues.push(
            createIssue(
              DOC_ERROR_CODES.TOO_MANY_TABLE_COLUMNS,
              `Table has ${columns.length} columns, maximum allowed is ${DOC_LIMITS.MAX_TABLE_COLUMNS}`,
              `${blockPath}.columns`,
              "error"
            )
          );
        }

        if (rows.length > DOC_LIMITS.MAX_TABLE_ROWS) {
          issues.push(
            createIssue(
              DOC_ERROR_CODES.TOO_MANY_TABLE_ROWS,
              `Table has ${rows.length} rows, maximum allowed is ${DOC_LIMITS.MAX_TABLE_ROWS}`,
              `${blockPath}.rows`,
              "error"
            )
          );
        } else if (rows.length > DOC_LIMITS.WARN_TABLE_ROWS) {
          issues.push(
            createIssue(
              DOC_WARNING_CODES.LARGE_TABLE,
              `Table has ${rows.length} rows, consider pagination`,
              `${blockPath}.rows`,
              "warning"
            )
          );
        }

        // Validate row lengths match column count
        rows.forEach((row, rowIndex) => {
          if (Array.isArray(row) && row.length !== columns.length) {
            issues.push(
              createIssue(
                DOC_ERROR_CODES.MISMATCHED_ROW_LENGTH,
                `Row ${rowIndex} has ${row.length} cells but table has ${columns.length} columns`,
                `${blockPath}.rows[${rowIndex}]`,
                "error"
              )
            );
          }
        });

        // Validate table style
        if (block.style && !VALID_WORD_TABLE_STYLES.has(block.style)) {
          issues.push(
            createIssue(
              DOC_ERROR_CODES.INVALID_TABLE_STYLE,
              `Unknown table style "${block.style}"`,
              `${blockPath}.style`,
              "warning"
            )
          );
        }
        break;
    }
  });

  // Check total bullet items
  if (totalBulletItems > DOC_LIMITS.MAX_BULLET_ITEMS_TOTAL) {
    issues.push(
      createIssue(
        DOC_ERROR_CODES.TOO_MANY_BULLETS,
        `Document has ${totalBulletItems} total bullet items, maximum allowed is ${DOC_LIMITS.MAX_BULLET_ITEMS_TOTAL}`,
        "blocks",
        "error"
      )
    );
  } else if (totalBulletItems > DOC_LIMITS.WARN_BULLET_ITEMS) {
    issues.push(
      createIssue(
        DOC_WARNING_CODES.MANY_BULLETS,
        `Document has ${totalBulletItems} bullet items, consider grouping or summarizing`,
        "blocks",
        "warning"
      )
    );
  }

  // Check for multiple title blocks (should only have 0 or 1)
  const titleBlocks = blocks.filter((block) => block.type === "title");
  if (titleBlocks.length > 1) {
    issues.push(
      createIssue(
        DOC_WARNING_CODES.MULTIPLE_TITLES,
        `Document has ${titleBlocks.length} title blocks, should have at most 1`,
        "blocks",
        "warning"
      )
    );
  }

  // Check TOC placement (should be near the top, within first 5 blocks)
  const tocBlockIndex = blocks.findIndex((block) => block.type === "toc");
  if (tocBlockIndex > 4) {
    issues.push(
      createIssue(
        DOC_WARNING_CODES.TOC_LATE,
        `Table of contents appears at block ${tocBlockIndex + 1}, should be within first 5 blocks`,
        `blocks[${tocBlockIndex}]`,
        "warning"
      )
    );
  }

  return buildReport(issues);
}

/**
 * Validates an ExcelSpec for Excel workbook generation
 */
export function validateExcelSpec(spec: ExcelSpec): QualityReport {
  const issues: ValidationIssue[] = [];
  const sheets = spec.sheets || [];

  // Check workbook title
  if (!spec.workbook_title || spec.workbook_title.trim() === "") {
    issues.push(
      createIssue(
        EXCEL_WARNING_CODES.NO_WORKBOOK_TITLE,
        "Workbook has no title specified",
        "workbook_title",
        "warning"
      )
    );
  }

  // Check sheet count
  if (sheets.length === 0) {
    issues.push(
      createIssue(
        EXCEL_ERROR_CODES.EMPTY_SHEETS,
        "Workbook has no sheets",
        "sheets",
        "error"
      )
    );
  }

  if (sheets.length > EXCEL_LIMITS.MAX_SHEETS) {
    issues.push(
      createIssue(
        EXCEL_ERROR_CODES.TOO_MANY_SHEETS,
        `Workbook has ${sheets.length} sheets, maximum allowed is ${EXCEL_LIMITS.MAX_SHEETS}`,
        "sheets",
        "error"
      )
    );
  } else if (sheets.length > EXCEL_LIMITS.WARN_SHEETS) {
    issues.push(
      createIssue(
        EXCEL_WARNING_CODES.MANY_SHEETS,
        `Workbook has ${sheets.length} sheets, consider splitting into multiple workbooks`,
        "sheets",
        "warning"
      )
    );
  }

  // Check for duplicate sheet names
  const sheetNames = new Set<string>();
  sheets.forEach((sheet, index) => {
    const normalizedName = sheet.name.toLowerCase();
    if (sheetNames.has(normalizedName)) {
      issues.push(
        createIssue(
          EXCEL_WARNING_CODES.DUPLICATE_SHEET_NAMES,
          `Duplicate sheet name "${sheet.name}"`,
          `sheets[${index}].name`,
          "warning"
        )
      );
    }
    sheetNames.add(normalizedName);
  });

  // Validate each sheet
  sheets.forEach((sheet, sheetIndex) => {
    validateSheet(sheet, sheetIndex, issues);
  });

  return buildReport(issues);
}

function validateSheet(sheet: SheetSpec, sheetIndex: number, issues: ValidationIssue[]): void {
  const sheetPath = `sheets[${sheetIndex}]`;

  // Validate sheet name
  if (!sheet.name || sheet.name.trim() === "") {
    issues.push(
      createIssue(
        EXCEL_ERROR_CODES.INVALID_SHEET_NAME,
        "Sheet name is empty",
        `${sheetPath}.name`,
        "error"
      )
    );
  } else if (sheet.name.length > EXCEL_LIMITS.MAX_SHEET_NAME_LENGTH) {
    issues.push(
      createIssue(
        EXCEL_ERROR_CODES.INVALID_SHEET_NAME,
        `Sheet name "${sheet.name}" exceeds ${EXCEL_LIMITS.MAX_SHEET_NAME_LENGTH} characters`,
        `${sheetPath}.name`,
        "error"
      )
    );
  } else if (/[\\/:*?\[\]]/.test(sheet.name)) {
    issues.push(
      createIssue(
        EXCEL_ERROR_CODES.INVALID_SHEET_NAME,
        `Sheet name "${sheet.name}" contains invalid characters`,
        `${sheetPath}.name`,
        "error"
      )
    );
  }

  // Calculate total cells in sheet
  let totalCells = 0;
  const tables = sheet.tables || [];

  tables.forEach((table, tableIndex) => {
    const tablePath = `${sheetPath}.tables[${tableIndex}]`;
    const headers = table.headers || [];
    const rows = table.rows || [];

    // Validate anchor
    if (!table.anchor || !isValidCellReference(table.anchor)) {
      issues.push(
        createIssue(
          EXCEL_ERROR_CODES.INVALID_ANCHOR,
          `Invalid table anchor "${table.anchor}"`,
          `${tablePath}.anchor`,
          "error"
        )
      );
    }

    // Validate headers
    if (headers.length === 0) {
      issues.push(
        createIssue(
          EXCEL_ERROR_CODES.EMPTY_TABLE_HEADERS,
          "Table has no headers defined",
          `${tablePath}.headers`,
          "error"
        )
      );
    }

    // Check column count
    if (headers.length > EXCEL_LIMITS.MAX_TABLE_COLUMNS) {
      issues.push(
        createIssue(
          EXCEL_ERROR_CODES.TOO_MANY_TABLE_COLUMNS,
          `Table has ${headers.length} columns, maximum allowed is ${EXCEL_LIMITS.MAX_TABLE_COLUMNS}`,
          `${tablePath}.headers`,
          "error"
        )
      );
    }

    // Check row count
    if (rows.length > EXCEL_LIMITS.MAX_TABLE_ROWS) {
      issues.push(
        createIssue(
          EXCEL_ERROR_CODES.TOO_MANY_TABLE_ROWS,
          `Table has ${rows.length} rows, maximum allowed is ${EXCEL_LIMITS.MAX_TABLE_ROWS}`,
          `${tablePath}.rows`,
          "error"
        )
      );
    } else if (rows.length > EXCEL_LIMITS.WARN_TABLE_ROWS) {
      issues.push(
        createIssue(
          EXCEL_WARNING_CODES.LARGE_TABLE,
          `Table has ${rows.length} rows, performance may be impacted`,
          `${tablePath}.rows`,
          "warning"
        )
      );
    }

    // Validate row lengths match header count
    rows.forEach((row, rowIndex) => {
      if (Array.isArray(row) && row.length !== headers.length) {
        issues.push(
          createIssue(
            EXCEL_ERROR_CODES.MISMATCHED_ROW_LENGTH,
            `Row ${rowIndex} has ${row.length} cells but table has ${headers.length} headers`,
            `${tablePath}.rows[${rowIndex}]`,
            "error"
          )
        );
      }
    });

    // Validate column formats
    if (table.column_formats) {
      for (const [header, format] of Object.entries(table.column_formats)) {
        if (!headers.includes(header)) {
          issues.push(
            createIssue(
              EXCEL_ERROR_CODES.INVALID_COLUMN_FORMAT,
              `Column format specified for unknown header "${header}"`,
              `${tablePath}.column_formats.${header}`,
              "warning"
            )
          );
        }
        // Note: We allow custom formats, but warn about unrecognized ones
        if (!VALID_EXCEL_FORMATS.has(format) && !format.includes("#") && !format.includes("0")) {
          issues.push(
            createIssue(
              EXCEL_ERROR_CODES.INVALID_COLUMN_FORMAT,
              `Unrecognized column format "${format}" for header "${header}"`,
              `${tablePath}.column_formats.${header}`,
              "warning"
            )
          );
        }
      }
    }

    // Calculate cells for this table
    totalCells += headers.length * (rows.length + 1); // +1 for header row
  });

  // Check total cells per sheet
  if (totalCells > EXCEL_LIMITS.MAX_CELLS_PER_SHEET) {
    issues.push(
      createIssue(
        EXCEL_ERROR_CODES.TOO_MANY_CELLS,
        `Sheet "${sheet.name}" has approximately ${totalCells} cells, maximum allowed is ${EXCEL_LIMITS.MAX_CELLS_PER_SHEET}`,
        `${sheetPath}`,
        "error"
      )
    );
  } else if (totalCells > EXCEL_LIMITS.WARN_CELLS_PER_SHEET) {
    issues.push(
      createIssue(
        EXCEL_WARNING_CODES.MANY_CELLS,
        `Sheet "${sheet.name}" has approximately ${totalCells} cells, generation may be slow`,
        `${sheetPath}`,
        "warning"
      )
    );
  }

  // Validate charts
  const charts = sheet.charts || [];
  charts.forEach((chart, chartIndex) => {
    const chartPath = `${sheetPath}.charts[${chartIndex}]`;

    if (chart.categories_range && !isValidRange(chart.categories_range)) {
      issues.push(
        createIssue(
          EXCEL_ERROR_CODES.INVALID_CHART_RANGE,
          `Invalid categories range "${chart.categories_range}"`,
          `${chartPath}.categories_range`,
          "error"
        )
      );
    }

    if (chart.values_range && !isValidRange(chart.values_range)) {
      issues.push(
        createIssue(
          EXCEL_ERROR_CODES.INVALID_CHART_RANGE,
          `Invalid values range "${chart.values_range}"`,
          `${chartPath}.values_range`,
          "error"
        )
      );
    }

    if (chart.position && !isValidCellReference(chart.position)) {
      issues.push(
        createIssue(
          EXCEL_ERROR_CODES.INVALID_CHART_RANGE,
          `Invalid chart position "${chart.position}"`,
          `${chartPath}.position`,
          "warning"
        )
      );
    }

    // Range consistency: verify chart ranges reference cells within table data
    if (tables.length > 0) {
      if (chart.categories_range) {
        const catBoundsCheck = isRangeWithinTableBounds(chart.categories_range, tables);
        if (!catBoundsCheck.valid) {
          issues.push(
            createIssue(
              EXCEL_ERROR_CODES.CHART_RANGE_OUT_OF_BOUNDS,
              `Chart categories_range "${chart.categories_range}" extends beyond table data (${catBoundsCheck.reason})`,
              `${chartPath}.categories_range`,
              "error"
            )
          );
        }
      }

      if (chart.values_range) {
        const valBoundsCheck = isRangeWithinTableBounds(chart.values_range, tables);
        if (!valBoundsCheck.valid) {
          issues.push(
            createIssue(
              EXCEL_ERROR_CODES.CHART_RANGE_OUT_OF_BOUNDS,
              `Chart values_range "${chart.values_range}" extends beyond table data (${valBoundsCheck.reason})`,
              `${chartPath}.values_range`,
              "error"
            )
          );
        }
      }
    }
  });

  // Table overlap detection
  const tableBoundingBoxes: TableBoundingBox[] = [];
  tables.forEach((table, tableIndex) => {
    const bbox = getTableBoundingBox(table, tableIndex);
    if (bbox) {
      tableBoundingBoxes.push(bbox);
    }
  });

  // Check each pair of tables for overlap
  for (let i = 0; i < tableBoundingBoxes.length; i++) {
    for (let j = i + 1; j < tableBoundingBoxes.length; j++) {
      const boxA = tableBoundingBoxes[i];
      const boxB = tableBoundingBoxes[j];
      if (tablesOverlap(boxA, boxB)) {
        issues.push(
          createIssue(
            EXCEL_WARNING_CODES.TABLE_OVERLAP,
            `Tables ${boxA.tableIndex + 1} and ${boxB.tableIndex + 1} overlap in sheet "${sheet.name}"`,
            `${sheetPath}.tables`,
            "warning"
          )
        );
      }
    }
  }

  // Formula-like text warnings (warn when cell values start with =, +, -, @)
  tables.forEach((table, tableIndex) => {
    const tablePath = `${sheetPath}.tables[${tableIndex}]`;
    const rows = table.rows || [];

    rows.forEach((row, rowIndex) => {
      if (Array.isArray(row)) {
        row.forEach((cell, cellIndex) => {
          if (isFormulaLikeText(cell)) {
            issues.push(
              createIssue(
                EXCEL_WARNING_CODES.FORMULA_LIKE_TEXT,
                `Value "${String(cell).substring(0, 20)}${String(cell).length > 20 ? "..." : ""}" looks like a formula in data cell`,
                `${tablePath}.rows[${rowIndex}][${cellIndex}]`,
                "warning"
              )
            );
          }
        });
      }
    });
  });
}

function buildReport(issues: ValidationIssue[]): QualityReport {
  const errors = issues
    .filter((i) => i.severity === "error")
    .map(({ code, message, path }) => ({ code, message, path }));

  const warnings = issues
    .filter((i) => i.severity === "warning")
    .map(({ code, message, path }) => ({ code, message, path }));

  const info = issues
    .filter((i) => i.severity === "info")
    .map(({ code, message, path }) => ({ code, message, path }));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    info,
  };
}
