import { SparseGrid, parseCellRef, parseRange } from './sparseGrid';

export const ExcelErrors = {
  DIV_ZERO: '#DIV/0!',
  REF: '#REF!',
  NAME: '#NAME?',
  VALUE: '#VALUE!',
  NUM: '#NUM!',
  NA: '#N/A',
  CIRCULAR: '#CIRCULAR!',
  ERROR: '#ERROR!',
} as const;

export type ExcelError = typeof ExcelErrors[keyof typeof ExcelErrors];

export type FormulaHandler = (args: string[], engine: FormulaEngine) => string;

export type SheetResolver = (sheetName: string) => SparseGrid | null;

export function isExcelError(value: string): boolean {
  return Object.values(ExcelErrors).includes(value as ExcelError);
}

/**
 * Safe arithmetic expression evaluator — recursive descent parser.
 * Only supports: numbers, +, -, *, /, parentheses, unary minus.
 * Returns null if the expression is invalid.
 * Replaces Function()/eval() to prevent code injection (CodeQL: code-injection).
 */
function safeEvalArithmetic(expr: string): number | null {
  const tokens = expr.match(/(\d+\.?\d*|\.\d+|[+\-*/()])/g);
  if (!tokens) return null;
  let pos = 0;

  function peek(): string | undefined { return tokens![pos]; }
  function consume(): string { return tokens![pos++]; }

  function parseExpr(): number {
    let left = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parseFactor();
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  function parseFactor(): number {
    if (peek() === "-") {
      consume();
      return -parseFactor();
    }
    if (peek() === "+") {
      consume();
      return parseFactor();
    }
    if (peek() === "(") {
      consume();
      const val = parseExpr();
      if (peek() === ")") consume();
      return val;
    }
    const token = consume();
    if (token === undefined) return NaN;
    return parseFloat(token);
  }

  try {
    const result = parseExpr();
    if (pos < tokens.length) return null; // leftover tokens = invalid
    return result;
  } catch {
    return null;
  }
}

export class FormulaEngine {
  private grid: SparseGrid;
  private sheetResolver: SheetResolver | null = null;
  private currentCell: { row: number; col: number } | null = null;
  private evaluationStack: Set<string> = new Set();
  private formulaRegistry: Map<string, FormulaHandler> = new Map();

  constructor(grid: SparseGrid) {
    this.grid = grid;
    this.registerBuiltInFormulas();
  }

  setGrid(grid: SparseGrid): void {
    this.grid = grid;
  }

  setSheetResolver(resolver: SheetResolver): void {
    this.sheetResolver = resolver;
  }

  setCurrentCell(row: number, col: number): void {
    this.currentCell = { row, col };
  }

  clearCurrentCell(): void {
    this.currentCell = null;
    this.evaluationStack.clear();
  }

  registerFormula(name: string, handler: FormulaHandler): void {
    this.formulaRegistry.set(name.toUpperCase(), handler);
  }

  getRegistry(): Map<string, FormulaHandler> {
    return this.formulaRegistry;
  }

  private registerBuiltInFormulas(): void {
    this.registerFormula('SUM', (args) => {
      const values = this.getMultiRangeValues(args);
      return values.reduce((a, b) => a + b, 0).toString();
    });

    this.registerFormula('AVERAGE', (args) => {
      const values = this.getMultiRangeNonEmptyValues(args);
      if (values.length === 0) return '0';
      return (values.reduce((a, b) => a + b, 0) / values.length).toString();
    });

    this.registerFormula('COUNT', (args) => {
      return this.getMultiRangeNonEmptyValues(args).length.toString();
    });

    this.registerFormula('COUNTA', (args) => {
      let count = 0;
      for (const arg of args) {
        const { sheetName, cellRef } = this.parseSheetReference(arg.trim());
        const cells = parseRange(cellRef);
        for (const c of cells) {
          const cell = this.getGridCell(c.row, c.col, sheetName);
          if (cell.value.trim() !== '') count++;
        }
      }
      return count.toString();
    });

    this.registerFormula('MAX', (args) => {
      const values = this.getMultiRangeNonEmptyValues(args);
      if (values.length === 0) return '0';
      return Math.max(...values).toString();
    });

    this.registerFormula('MIN', (args) => {
      const values = this.getMultiRangeNonEmptyValues(args);
      if (values.length === 0) return '0';
      return Math.min(...values).toString();
    });

    this.registerFormula('ROUND', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const value = this.evaluateExpression(args[0]);
      if (isExcelError(String(value))) return String(value);
      const decimals = args.length > 1 ? parseInt(String(this.evaluateExpression(args[1])), 10) : 0;
      if (isNaN(decimals)) return ExcelErrors.VALUE;
      return Number(value).toFixed(decimals);
    });

    this.registerFormula('ABS', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const value = this.evaluateExpression(args[0]);
      if (isExcelError(String(value))) return String(value);
      const num = Number(value);
      if (isNaN(num)) return ExcelErrors.VALUE;
      return Math.abs(num).toString();
    });

    this.registerFormula('SQRT', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const value = this.evaluateExpression(args[0]);
      if (isExcelError(String(value))) return String(value);
      const num = Number(value);
      if (isNaN(num)) return ExcelErrors.VALUE;
      if (num < 0) return ExcelErrors.NUM;
      return Math.sqrt(num).toString();
    });

    this.registerFormula('POWER', (args) => {
      if (args.length < 2) return ExcelErrors.VALUE;
      const base = this.evaluateExpression(args[0]);
      const exp = this.evaluateExpression(args[1]);
      if (isExcelError(String(base))) return String(base);
      if (isExcelError(String(exp))) return String(exp);
      return Math.pow(Number(base), Number(exp)).toString();
    });

    this.registerFormula('CONCAT', (args) => this.handleConcat(args));
    this.registerFormula('CONCATENATE', (args) => this.handleConcat(args));

    this.registerFormula('VLOOKUP', (args) => {
      if (args.length < 3) return ExcelErrors.VALUE;
      const searchKey = this.evaluateExpression(args[0]);
      if (isExcelError(String(searchKey))) return String(searchKey);
      const rangeStr = args[1].trim();
      const colIndex = parseInt(String(this.evaluateExpression(args[2])), 10);
      const isSorted = args.length > 3 ? this.evaluateCondition(args[3]) : true;

      const { sheetName, cellRef } = this.parseSheetReference(rangeStr);
      const cells = parseRange(cellRef);
      if (cells.length === 0) return ExcelErrors.REF;

      const bounds = this.getRangeBounds(cells);
      if (colIndex < 1 || colIndex > (bounds.maxCol - bounds.minCol + 1)) return ExcelErrors.REF;

      for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
        const cellVal = this.getCellRawValue(r, bounds.minCol, sheetName);
        if (this.matchValue(cellVal, searchKey, !isSorted)) {
          return this.getCellRawValue(r, bounds.minCol + colIndex - 1, sheetName);
        }
      }
      return ExcelErrors.NA;
    });

    this.registerFormula('HLOOKUP', (args) => {
      if (args.length < 3) return ExcelErrors.VALUE;
      const searchKey = this.evaluateExpression(args[0]);
      if (isExcelError(String(searchKey))) return String(searchKey);
      const rangeStr = args[1].trim();
      const rowIndex = parseInt(String(this.evaluateExpression(args[2])), 10);
      const isSorted = args.length > 3 ? this.evaluateCondition(args[3]) : true;

      const { sheetName, cellRef } = this.parseSheetReference(rangeStr);
      const cells = parseRange(cellRef);
      if (cells.length === 0) return ExcelErrors.REF;

      const bounds = this.getRangeBounds(cells);
      if (rowIndex < 1 || rowIndex > (bounds.maxRow - bounds.minRow + 1)) return ExcelErrors.REF;

      for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
        const cellVal = this.getCellRawValue(bounds.minRow, c, sheetName);
        if (this.matchValue(cellVal, searchKey, !isSorted)) {
          return this.getCellRawValue(bounds.minRow + rowIndex - 1, c, sheetName);
        }
      }
      return ExcelErrors.NA;
    });

    this.registerFormula('SUMIF', (args) => {
      if (args.length < 2) return ExcelErrors.VALUE;
      const rangeStr = args[0].trim();
      const criteria = this.parseStringArg(args[1]);
      const sumRangeStr = args.length > 2 ? args[2].trim() : rangeStr;

      const { sheetName: rangeSheet, cellRef: rangeCellRef } = this.parseSheetReference(rangeStr);
      const { sheetName: sumSheet, cellRef: sumCellRef } = this.parseSheetReference(sumRangeStr);
      const rangeCells = parseRange(rangeCellRef);
      const sumCells = parseRange(sumCellRef);
      if (rangeCells.length === 0) return ExcelErrors.REF;

      let sum = 0;
      for (let i = 0; i < rangeCells.length; i++) {
        const c = rangeCells[i];
        const val = this.getCellRawValue(c.row, c.col, rangeSheet);
        if (this.matchCriteria(val, criteria)) {
          const sumCell = sumCells[i] || c;
          const numVal = parseFloat(this.getCellRawValue(sumCell.row, sumCell.col, sumSheet).replace(/[^\d.-]/g, ''));
          if (!isNaN(numVal)) sum += numVal;
        }
      }
      return sum.toString();
    });

    this.registerFormula('COUNTIF', (args) => {
      if (args.length < 2) return ExcelErrors.VALUE;
      const rangeStr = args[0].trim();
      const criteria = this.parseStringArg(args[1]);

      const { sheetName, cellRef } = this.parseSheetReference(rangeStr);
      const cells = parseRange(cellRef);
      if (cells.length === 0) return ExcelErrors.REF;

      let count = 0;
      for (const c of cells) {
        const val = this.getCellRawValue(c.row, c.col, sheetName);
        if (this.matchCriteria(val, criteria)) count++;
      }
      return count.toString();
    });

    this.registerFormula('SUMIFS', (args) => {
      if (args.length < 3 || (args.length - 1) % 2 !== 0) return ExcelErrors.VALUE;
      const sumRangeStr = args[0].trim();
      const { sheetName: sumSheet, cellRef: sumCellRef } = this.parseSheetReference(sumRangeStr);
      const sumCells = parseRange(sumCellRef);
      if (sumCells.length === 0) return ExcelErrors.REF;

      const criteriaPairs: Array<{ cells: Array<{row: number, col: number}>, criteria: string, sheetName: string | null }> = [];
      for (let i = 1; i < args.length; i += 2) {
        const { sheetName, cellRef } = this.parseSheetReference(args[i].trim());
        const criteriaRange = parseRange(cellRef);
        const criteria = this.parseStringArg(args[i + 1]);
        if (criteriaRange.length !== sumCells.length) return ExcelErrors.VALUE;
        criteriaPairs.push({ cells: criteriaRange, criteria, sheetName });
      }

      let sum = 0;
      for (let i = 0; i < sumCells.length; i++) {
        let allMatch = true;
        for (const pair of criteriaPairs) {
          const val = this.getCellRawValue(pair.cells[i].row, pair.cells[i].col, pair.sheetName);
          if (!this.matchCriteria(val, pair.criteria)) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          const numVal = parseFloat(this.getCellRawValue(sumCells[i].row, sumCells[i].col, sumSheet).replace(/[^\d.-]/g, ''));
          if (!isNaN(numVal)) sum += numVal;
        }
      }
      return sum.toString();
    });

    this.registerFormula('COUNTIFS', (args) => {
      if (args.length < 2 || args.length % 2 !== 0) return ExcelErrors.VALUE;
      
      const { sheetName: firstSheet, cellRef: firstCellRef } = this.parseSheetReference(args[0].trim());
      const firstRange = parseRange(firstCellRef);
      if (firstRange.length === 0) return ExcelErrors.REF;

      const criteriaPairs: Array<{ cells: Array<{row: number, col: number}>, criteria: string, sheetName: string | null }> = [];
      for (let i = 0; i < args.length; i += 2) {
        const { sheetName, cellRef } = this.parseSheetReference(args[i].trim());
        const criteriaRange = parseRange(cellRef);
        const criteria = this.parseStringArg(args[i + 1]);
        if (criteriaRange.length !== firstRange.length) return ExcelErrors.VALUE;
        criteriaPairs.push({ cells: criteriaRange, criteria, sheetName });
      }

      let count = 0;
      for (let i = 0; i < firstRange.length; i++) {
        let allMatch = true;
        for (const pair of criteriaPairs) {
          const val = this.getCellRawValue(pair.cells[i].row, pair.cells[i].col, pair.sheetName);
          if (!this.matchCriteria(val, pair.criteria)) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) count++;
      }
      return count.toString();
    });

    this.registerFormula('INDEX', (args) => {
      if (args.length < 2) return ExcelErrors.VALUE;
      const rangeStr = args[0].trim();
      const rowNum = parseInt(String(this.evaluateExpression(args[1])), 10);
      const colNum = args.length > 2 ? parseInt(String(this.evaluateExpression(args[2])), 10) : 1;

      const { sheetName, cellRef } = this.parseSheetReference(rangeStr);
      const cells = parseRange(cellRef);
      if (cells.length === 0) return ExcelErrors.REF;

      const bounds = this.getRangeBounds(cells);
      const numRows = bounds.maxRow - bounds.minRow + 1;
      const numCols = bounds.maxCol - bounds.minCol + 1;

      if (rowNum < 1 || rowNum > numRows || colNum < 1 || colNum > numCols) {
        return ExcelErrors.REF;
      }

      return this.getCellRawValue(bounds.minRow + rowNum - 1, bounds.minCol + colNum - 1, sheetName);
    });

    this.registerFormula('MATCH', (args) => {
      if (args.length < 2) return ExcelErrors.VALUE;
      const searchKey = this.evaluateExpression(args[0]);
      if (isExcelError(String(searchKey))) return String(searchKey);
      const rangeStr = args[1].trim();
      const matchType = args.length > 2 ? parseInt(String(this.evaluateExpression(args[2])), 10) : 1;

      const { sheetName, cellRef } = this.parseSheetReference(rangeStr);
      const cells = parseRange(cellRef);
      if (cells.length === 0) return ExcelErrors.REF;

      const bounds = this.getRangeBounds(cells);
      const isRow = bounds.minRow === bounds.maxRow;
      const length = isRow ? (bounds.maxCol - bounds.minCol + 1) : (bounds.maxRow - bounds.minRow + 1);

      for (let i = 0; i < length; i++) {
        const r = isRow ? bounds.minRow : bounds.minRow + i;
        const c = isRow ? bounds.minCol + i : bounds.minCol;
        const val = this.getCellRawValue(r, c, sheetName);
        
        if (matchType === 0) {
          if (this.wildcardMatch(String(searchKey), val)) {
            return (i + 1).toString();
          }
        } else {
          if (val === String(searchKey) || Number(val) === Number(searchKey)) {
            return (i + 1).toString();
          }
        }
      }
      return ExcelErrors.NA;
    });

    this.registerFormula('TEXT', (args) => {
      if (args.length < 2) return ExcelErrors.VALUE;
      const value = this.evaluateExpression(args[0]);
      if (isExcelError(String(value))) return String(value);
      const format = this.parseStringArg(args[1]);
      return this.formatNumber(Number(value), format);
    });

    this.registerFormula('TODAY', () => {
      const today = new Date();
      return this.formatDate(today);
    });

    this.registerFormula('NOW', () => {
      const now = new Date();
      return `${this.formatDate(now)} ${now.toTimeString().split(' ')[0]}`;
    });

    this.registerFormula('DATE', (args) => {
      if (args.length < 3) return ExcelErrors.VALUE;
      const year = parseInt(String(this.evaluateExpression(args[0])), 10);
      const month = parseInt(String(this.evaluateExpression(args[1])), 10);
      const day = parseInt(String(this.evaluateExpression(args[2])), 10);
      if (isNaN(year) || isNaN(month) || isNaN(day)) return ExcelErrors.VALUE;
      const date = new Date(year, month - 1, day);
      return this.formatDate(date);
    });

    this.registerFormula('YEAR', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const date = this.parseDate(args[0]);
      if (!date) return ExcelErrors.VALUE;
      return date.getFullYear().toString();
    });

    this.registerFormula('MONTH', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const date = this.parseDate(args[0]);
      if (!date) return ExcelErrors.VALUE;
      return (date.getMonth() + 1).toString();
    });

    this.registerFormula('DAY', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const date = this.parseDate(args[0]);
      if (!date) return ExcelErrors.VALUE;
      return date.getDate().toString();
    });

    this.registerFormula('LEFT', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const text = this.getStringValue(args[0]);
      if (isExcelError(text)) return text;
      const numChars = args.length > 1 ? this.getNumericValue(args[1]) : 1;
      if (isNaN(numChars) || numChars < 0) return ExcelErrors.VALUE;
      return text.substring(0, numChars);
    });

    this.registerFormula('RIGHT', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const text = this.getStringValue(args[0]);
      if (isExcelError(text)) return text;
      const numChars = args.length > 1 ? this.getNumericValue(args[1]) : 1;
      if (isNaN(numChars) || numChars < 0) return ExcelErrors.VALUE;
      return text.substring(Math.max(0, text.length - numChars));
    });

    this.registerFormula('MID', (args) => {
      if (args.length < 3) return ExcelErrors.VALUE;
      const text = this.getStringValue(args[0]);
      if (isExcelError(text)) return text;
      const start = this.getNumericValue(args[1]);
      const numChars = this.getNumericValue(args[2]);
      if (isNaN(start) || isNaN(numChars) || start < 1 || numChars < 0) return ExcelErrors.VALUE;
      return text.substring(start - 1, start - 1 + numChars);
    });

    this.registerFormula('LEN', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const text = this.getStringValue(args[0]);
      if (isExcelError(text)) return text;
      return text.length.toString();
    });

    this.registerFormula('TRIM', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const text = this.getStringValue(args[0]);
      if (isExcelError(text)) return text;
      return text.replace(/\s+/g, ' ').trim();
    });

    this.registerFormula('UPPER', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const text = this.getStringValue(args[0]);
      if (isExcelError(text)) return text;
      return text.toUpperCase();
    });

    this.registerFormula('LOWER', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const text = this.getStringValue(args[0]);
      if (isExcelError(text)) return text;
      return text.toLowerCase();
    });

    this.registerFormula('PROPER', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const text = this.getStringValue(args[0]);
      if (isExcelError(text)) return text;
      return text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    });

    this.registerFormula('IFERROR', (args) => {
      if (args.length < 2) return ExcelErrors.VALUE;
      try {
        const value = this.evaluateExpression(args[0]);
        if (isExcelError(String(value))) {
          return String(this.evaluateExpression(args[1]));
        }
        return String(value);
      } catch {
        return String(this.evaluateExpression(args[1]));
      }
    });

    this.registerFormula('ISBLANK', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const { sheetName, cellRef } = this.parseSheetReference(args[0].trim());
      const ref = parseCellRef(cellRef);
      if (!ref) return ExcelErrors.REF;
      const cell = this.getGridCell(ref.row, ref.col, sheetName);
      return (cell.value.trim() === '').toString().toUpperCase();
    });

    this.registerFormula('ISNUMBER', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const value = this.evaluateExpression(args[0]);
      return (!isNaN(Number(value)) && String(value).trim() !== '').toString().toUpperCase();
    });

    this.registerFormula('ISTEXT', (args) => {
      if (args.length < 1) return ExcelErrors.VALUE;
      const value = this.evaluateExpression(args[0]);
      return (typeof value === 'string' && isNaN(Number(value))).toString().toUpperCase();
    });

    this.registerFormula('IF', (args) => {
      if (args.length < 2) return ExcelErrors.VALUE;
      const condition = this.evaluateCondition(args[0]);
      if (condition) {
        return String(this.evaluateExpression(args[1]));
      }
      return args.length > 2 ? String(this.evaluateExpression(args[2])) : 'FALSE';
    });
  }

  private handleConcat(args: string[]): string {
    return args.map(p => this.getStringValue(p)).join('');
  }

  private parseSheetReference(ref: string): { sheetName: string | null; cellRef: string } {
    const match = ref.match(/^([^!]+)!(.+)$/);
    if (match) {
      return { sheetName: match[1], cellRef: match[2] };
    }
    return { sheetName: null, cellRef: ref };
  }

  private getGridForSheet(sheetName: string | null): SparseGrid | null {
    if (!sheetName) return this.grid;
    if (this.sheetResolver) {
      return this.sheetResolver(sheetName);
    }
    return null;
  }

  private getGridCell(row: number, col: number, sheetName?: string | null): { value: string } {
    const grid = sheetName ? this.getGridForSheet(sheetName) : this.grid;
    if (!grid) return { value: '' };
    return grid.getCell(row, col);
  }

  private getCellValue(ref: string): number {
    const { sheetName, cellRef } = this.parseSheetReference(ref);
    const parsed = parseCellRef(cellRef);
    if (!parsed) return 0;
    
    const cellKey = `${sheetName || ''}!${parsed.row}:${parsed.col}`;
    if (this.evaluationStack.has(cellKey)) {
      throw new Error(ExcelErrors.CIRCULAR);
    }
    
    const grid = this.getGridForSheet(sheetName);
    if (!grid) return 0;
    
    const cell = grid.getCell(parsed.row, parsed.col);
    const val = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
    return isNaN(val) ? 0 : val;
  }

  private getCellRawValue(row: number, col: number, sheetName?: string | null): string {
    const grid = sheetName ? this.getGridForSheet(sheetName) : this.grid;
    if (!grid) return '';
    return grid.getCell(row, col).value;
  }

  private getRangeValues(rangeStr: string): number[] {
    const { sheetName, cellRef } = this.parseSheetReference(rangeStr);
    const cells = parseRange(cellRef);
    const grid = this.getGridForSheet(sheetName);
    if (!grid) return [];
    
    return cells.map(c => {
      const cell = grid.getCell(c.row, c.col);
      const val = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
      return isNaN(val) ? 0 : val;
    });
  }

  private getRangeNonEmptyValues(rangeStr: string): number[] {
    const { sheetName, cellRef } = this.parseSheetReference(rangeStr);
    const cells = parseRange(cellRef);
    const grid = this.getGridForSheet(sheetName);
    if (!grid) return [];
    
    const values: number[] = [];
    for (const c of cells) {
      const cell = grid.getCell(c.row, c.col);
      if (cell.value.trim() !== '') {
        const val = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
        if (!isNaN(val)) values.push(val);
      }
    }
    return values;
  }

  private getMultiRangeValues(args: string[]): number[] {
    const values: number[] = [];
    for (const arg of args) {
      values.push(...this.getRangeValues(arg.trim()));
    }
    return values;
  }

  private getMultiRangeNonEmptyValues(args: string[]): number[] {
    const values: number[] = [];
    for (const arg of args) {
      values.push(...this.getRangeNonEmptyValues(arg.trim()));
    }
    return values;
  }

  private getRangeBounds(cells: Array<{row: number, col: number}>): { minRow: number, maxRow: number, minCol: number, maxCol: number } {
    let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
    for (const c of cells) {
      minRow = Math.min(minRow, c.row);
      maxRow = Math.max(maxRow, c.row);
      minCol = Math.min(minCol, c.col);
      maxCol = Math.max(maxCol, c.col);
    }
    return { minRow, maxRow, minCol, maxCol };
  }

  private matchValue(cellVal: string, searchKey: string | number, exactMatch: boolean): boolean {
    if (exactMatch) {
      return cellVal === String(searchKey) || Number(cellVal) === Number(searchKey);
    }
    return cellVal.toLowerCase() === String(searchKey).toLowerCase() || 
           Number(cellVal) === Number(searchKey);
  }

  private matchCriteria(value: string, criteria: string): boolean {
    if (criteria.startsWith('>=')) {
      const num = parseFloat(criteria.substring(2));
      return !isNaN(num) && parseFloat(value) >= num;
    }
    if (criteria.startsWith('<=')) {
      const num = parseFloat(criteria.substring(2));
      return !isNaN(num) && parseFloat(value) <= num;
    }
    if (criteria.startsWith('<>') || criteria.startsWith('!=')) {
      const cmp = criteria.substring(2);
      return value !== cmp && parseFloat(value) !== parseFloat(cmp);
    }
    if (criteria.startsWith('>')) {
      const num = parseFloat(criteria.substring(1));
      return !isNaN(num) && parseFloat(value) > num;
    }
    if (criteria.startsWith('<')) {
      const num = parseFloat(criteria.substring(1));
      return !isNaN(num) && parseFloat(value) < num;
    }
    if (criteria.startsWith('=')) {
      const cmp = criteria.substring(1);
      return value === cmp || parseFloat(value) === parseFloat(cmp);
    }
    if (criteria.includes('*') || criteria.includes('?')) {
      return this.wildcardMatch(criteria, value);
    }
    return value === criteria || parseFloat(value) === parseFloat(criteria);
  }

  private wildcardMatch(pattern: string, text: string): boolean {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    return regex.test(text);
  }

  private parseStringArg(arg: string): string {
    const trimmed = arg.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    const { sheetName, cellRef } = this.parseSheetReference(trimmed);
    const ref = parseCellRef(cellRef);
    if (ref) {
      return this.getGridCell(ref.row, ref.col, sheetName).value;
    }
    return trimmed;
  }

  private getArgumentValue(arg: string): string | number {
    const trimmed = arg.trim();
    
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    
    const { sheetName, cellRef } = this.parseSheetReference(trimmed);
    const ref = parseCellRef(cellRef);
    if (ref) {
      const cell = this.getGridCell(ref.row, ref.col, sheetName);
      return cell.value;
    }
    
    const numVal = parseFloat(trimmed);
    if (!isNaN(numVal) && trimmed === String(numVal)) {
      return numVal;
    }
    
    return trimmed;
  }

  private getNumericValue(arg: string): number {
    const val = this.getArgumentValue(arg);
    if (typeof val === 'number') return val;
    const num = parseFloat(String(val).replace(/[^\d.-]/g, ''));
    return isNaN(num) ? 0 : num;
  }

  private getStringValue(arg: string): string {
    const val = this.getArgumentValue(arg);
    return String(val);
  }

  private formatNumber(value: number, format: string): string {
    if (isNaN(value)) return ExcelErrors.VALUE;
    
    if (format.includes('#,##0') || format.includes('#,###')) {
      const decimals = (format.split('.')[1] || '').replace(/[^0#]/g, '').length;
      return value.toLocaleString('en-US', { 
        minimumFractionDigits: decimals, 
        maximumFractionDigits: decimals 
      });
    }
    
    if (format.includes('0.')) {
      const decimals = (format.split('.')[1] || '').length;
      return value.toFixed(decimals);
    }
    
    if (format.includes('%')) {
      const decimals = (format.split('.')[1] || '').replace('%', '').length;
      return (value * 100).toFixed(decimals) + '%';
    }
    
    return value.toString();
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDate(arg: string): Date | null {
    const trimmed = arg.trim();
    const { sheetName, cellRef } = this.parseSheetReference(trimmed);
    const ref = parseCellRef(cellRef);
    let dateStr = trimmed;
    
    if (ref) {
      dateStr = this.getGridCell(ref.row, ref.col, sheetName).value;
    } else if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      dateStr = trimmed.slice(1, -1);
    }
    
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  }

  private parseFormulaArgs(argsStr: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let current = '';
    let inString = false;
    
    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      if (char === '"' && (i === 0 || argsStr[i-1] !== '\\')) {
        inString = !inString;
        current += char;
      } else if (!inString) {
        if (char === '(') {
          depth++;
          current += char;
        } else if (char === ')') {
          depth--;
          current += char;
        } else if (char === ',' && depth === 0) {
          args.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      } else {
        current += char;
      }
    }
    if (current.trim()) {
      args.push(current.trim());
    }
    return args;
  }

  evaluate(formula: string): string {
    this.evaluationStack.clear();
    
    if (!formula?.startsWith('=')) return formula;
    const expr = formula.substring(1).trim();

    if (this.currentCell) {
      const cellKey = `!${this.currentCell.row}:${this.currentCell.col}`;
      if (this.evaluationStack.has(cellKey)) {
        return ExcelErrors.CIRCULAR;
      }
      this.evaluationStack.add(cellKey);
    }

    try {
      const funcMatch = expr.match(/^([A-Z_][A-Z0-9_]*)\((.*)$/i);
      if (funcMatch) {
        const funcName = funcMatch[1].toUpperCase();
        const rest = funcMatch[2];
        
        let depth = 1;
        let argsEnd = -1;
        let inString = false;
        for (let i = 0; i < rest.length; i++) {
          const char = rest[i];
          if (char === '"' && (i === 0 || rest[i-1] !== '\\')) {
            inString = !inString;
          } else if (!inString) {
            if (char === '(') depth++;
            else if (char === ')') {
              depth--;
              if (depth === 0) {
                argsEnd = i;
                break;
              }
            }
          }
        }
        
        if (argsEnd >= 0 || (depth === 1 && rest.endsWith(')'))) {
          const actualArgsEnd = argsEnd >= 0 ? argsEnd : rest.length - 1;
          const argsStr = rest.substring(0, actualArgsEnd);
          const args = argsStr.trim() ? this.parseFormulaArgs(argsStr) : [];
          
          const handler = this.formulaRegistry.get(funcName);
          if (handler) {
            return handler(args, this);
          }
          return ExcelErrors.NAME;
        }
      }

      const upperExpr = expr.toUpperCase();
      const cellRefMatch = upperExpr.match(/^([A-Z]+\d+)$/);
      if (cellRefMatch) {
        return this.getCellValue(cellRefMatch[1]).toString();
      }

      const sheetRefMatch = expr.match(/^([^!]+)!([A-Z]+\d+)$/i);
      if (sheetRefMatch) {
        const { sheetName, cellRef } = this.parseSheetReference(expr);
        const parsed = parseCellRef(cellRef);
        if (!parsed) return ExcelErrors.REF;
        const grid = this.getGridForSheet(sheetName);
        if (!grid) return ExcelErrors.REF;
        return grid.getCell(parsed.row, parsed.col).value;
      }

      return this.evaluateExpression(expr).toString();
    } catch (e) {
      if (e instanceof Error && e.message === ExcelErrors.CIRCULAR) {
        return ExcelErrors.CIRCULAR;
      }
      return ExcelErrors.ERROR;
    } finally {
      if (this.currentCell) {
        const cellKey = `!${this.currentCell.row}:${this.currentCell.col}`;
        this.evaluationStack.delete(cellKey);
      }
    }
  }

  evaluateCondition(condition: string): boolean {
    const trimmed = condition.trim();
    
    if (trimmed.toUpperCase() === 'TRUE') return true;
    if (trimmed.toUpperCase() === 'FALSE') return false;
    
    const operators = ['>=', '<=', '<>', '!=', '=', '>', '<'];
    
    for (const op of operators) {
      const idx = trimmed.indexOf(op);
      if (idx > 0) {
        const left = this.evaluateExpression(trimmed.substring(0, idx).trim());
        const right = this.evaluateExpression(trimmed.substring(idx + op.length).trim());
        
        switch (op) {
          case '>=': return Number(left) >= Number(right);
          case '<=': return Number(left) <= Number(right);
          case '<>':
          case '!=': return String(left) !== String(right);
          case '=': return String(left) === String(right) || Number(left) === Number(right);
          case '>': return Number(left) > Number(right);
          case '<': return Number(left) < Number(right);
        }
      }
    }
    
    const val = this.evaluateExpression(trimmed);
    return Boolean(val) && val !== '0' && val !== 'FALSE' && val !== '';
  }

  evaluateExpression(expr: string): string | number {
    const trimmed = expr.trim();
    
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    
    const numVal = parseFloat(trimmed);
    if (!isNaN(numVal) && trimmed === numVal.toString()) {
      return numVal;
    }
    
    if (trimmed.toUpperCase() === 'TRUE') return 'TRUE';
    if (trimmed.toUpperCase() === 'FALSE') return 'FALSE';
    
    const funcMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)\(/i);
    if (funcMatch) {
      const result = this.evaluate('=' + trimmed);
      return result;
    }
    
    const { sheetName, cellRef } = this.parseSheetReference(trimmed);
    const parsed = parseCellRef(cellRef);
    if (parsed) {
      const grid = this.getGridForSheet(sheetName);
      if (!grid) return ExcelErrors.REF;
      
      const cellKey = `${sheetName || ''}!${parsed.row}:${parsed.col}`;
      if (this.evaluationStack.has(cellKey)) {
        throw new Error(ExcelErrors.CIRCULAR);
      }
      
      return this.getCellValue(trimmed);
    }
    
    const resolved = trimmed.replace(/([A-Z]+\d+)/gi, (match) => {
      return this.getCellValue(match).toString();
    });
    
    try {
      // FRONTEND FIX #8: Enhanced sanitization for formula expression evaluation
      const safeExpr = resolved.replace(/[^0-9+\-*/.() ]/g, '');
      if (safeExpr.trim()) {
        // Additional safety checks before evaluation
        // Check for balanced parentheses
        let parenCount = 0;
        for (const char of safeExpr) {
          if (char === '(') parenCount++;
          if (char === ')') parenCount--;
          if (parenCount < 0) return resolved; // Unbalanced - don't evaluate
        }
        if (parenCount !== 0) return resolved; // Unbalanced - don't evaluate

        // Block expressions that are too long (potential DoS)
        if (safeExpr.length > 1000) return resolved;

        if (safeExpr.includes('/')) {
          const checkDiv = safeExpr.replace(/\s/g, '');
          const divMatch = checkDiv.match(/\/([0-9.]+)/g);
          if (divMatch) {
            for (const m of divMatch) {
              const divisor = parseFloat(m.substring(1));
              if (divisor === 0) return ExcelErrors.DIV_ZERO;
            }
          }
        }
        // Evaluate arithmetic expression safely without Function()/eval() (CodeQL: code-injection).
        // The expression is already sanitized to [0-9+\-*/.() ] — parse it directly.
        const result = safeEvalArithmetic(safeExpr);
        if (result === null || !isFinite(result)) return ExcelErrors.DIV_ZERO;
        return result;
      }
    } catch (e) {
      // Silently fail for invalid expressions
    }
    
    return resolved;
  }
}
