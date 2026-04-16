export interface CellBorders {
  top?: { style: 'thin' | 'medium' | 'thick' | 'double'; color: string };
  right?: { style: 'thin' | 'medium' | 'thick' | 'double'; color: string };
  bottom?: { style: 'thin' | 'medium' | 'thick' | 'double'; color: string };
  left?: { style: 'thin' | 'medium' | 'thick' | 'double'; color: string };
}

export interface MergeInfo {
  isMerged: boolean;
  mergeId?: string;
  isMain?: boolean;
  rowSpan?: number;
  colSpan?: number;
}

export interface CellData {
  value: string;
  formula?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  numberFormat?: string;  // 'General', 'Number', 'Currency', 'Percentage', 'Date', 'Text'
  borders?: CellBorders;
  merge?: MergeInfo;
  wrapText?: boolean;
  rotation?: number;
  indent?: number;
  format?: {
    backgroundColor?: string;
    textColor?: string;
    fontSize?: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface SparseGridConfig {
  maxRows: number;
  maxCols: number;
}

const DEFAULT_CONFIG: SparseGridConfig = {
  maxRows: 10000,
  maxCols: 10000,
};

export class SparseGrid {
  private cells: Map<string, CellData>;
  public readonly maxRows: number;
  public readonly maxCols: number;

  constructor(config: Partial<SparseGridConfig> = {}) {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    this.cells = new Map();
    this.maxRows = finalConfig.maxRows;
    this.maxCols = finalConfig.maxCols;
  }

  private key(row: number, col: number): string {
    return `${row}:${col}`;
  }

  private parseKey(key: string): { row: number; col: number } {
    const [row, col] = key.split(':').map(Number);
    return { row, col };
  }

  getCell(row: number, col: number): CellData {
    return this.cells.get(this.key(row, col)) || { value: '' };
  }

  setCell(row: number, col: number, data: Partial<CellData>): void {
    const key = this.key(row, col);
    const existing = this.cells.get(key) || { value: '' };
    const newData = { ...existing, ...data };
    
    const hasFormatting = newData.bold || newData.italic || newData.underline || 
      newData.fontFamily || newData.fontSize || newData.color || newData.backgroundColor || newData.format;
    
    if (newData.value === '' && !newData.formula && !hasFormatting) {
      this.cells.delete(key);
    } else {
      this.cells.set(key, newData);
    }
  }

  deleteCell(row: number, col: number): void {
    this.cells.delete(this.key(row, col));
  }

  validateBounds(row: number, col: number): ValidationResult {
    if (row < 0 || row >= this.maxRows) {
      return { valid: false, error: `Row ${row} out of bounds (0-${this.maxRows - 1})` };
    }
    if (col < 0 || col >= this.maxCols) {
      return { valid: false, error: `Column ${col} out of bounds (0-${this.maxCols - 1})` };
    }
    return { valid: true };
  }

  safeSetCell(row: number, col: number, data: Partial<CellData>): ValidationResult {
    const bounds = this.validateBounds(row, col);
    if (!bounds.valid) return bounds;
    
    try {
      this.setCell(row, col, data);
      return { valid: true };
    } catch (e) {
      return { valid: false, error: `Failed to set cell: ${e}` };
    }
  }

  static validateCellRef(ref: string): ValidationResult {
    const match = ref.match(/^([A-Z]+)(\d+)$/i);
    if (!match) {
      return { valid: false, error: `Invalid cell reference: ${ref}` };
    }
    return { valid: true };
  }

  static validateRange(range: string): ValidationResult {
    const parts = range.split(':');
    if (parts.length > 2) {
      return { valid: false, error: `Invalid range format: ${range}` };
    }
    for (const part of parts) {
      const result = SparseGrid.validateCellRef(part);
      if (!result.valid) return result;
    }
    return { valid: true };
  }

  hasData(row: number, col: number): boolean {
    return this.cells.has(this.key(row, col));
  }

  getCellCount(): number {
    return this.cells.size;
  }

  getAllCells(): Array<{ row: number; col: number; data: CellData }> {
    return Array.from(this.cells.entries()).map(([key, data]) => {
      const { row, col } = this.parseKey(key);
      return { row, col, data };
    });
  }

  getCellsInRange(
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number
  ): Array<{ row: number; col: number; data: CellData }> {
    const result: Array<{ row: number; col: number; data: CellData }> = [];
    
    Array.from(this.cells.entries()).forEach(([key, data]) => {
      const { row, col } = this.parseKey(key);
      if (row >= startRow && row <= endRow && col >= startCol && col <= endCol) {
        result.push({ row, col, data });
      }
    });
    
    return result;
  }

  getDataBounds(): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null {
    if (this.cells.size === 0) return null;
    
    let minRow = Infinity, maxRow = -Infinity;
    let minCol = Infinity, maxCol = -Infinity;
    
    Array.from(this.cells.keys()).forEach(key => {
      const { row, col } = this.parseKey(key);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
    });
    
    return { minRow, maxRow, minCol, maxCol };
  }

  clear(): void {
    this.cells.clear();
  }

  clone(): SparseGrid {
    const newGrid = new SparseGrid({ maxRows: this.maxRows, maxCols: this.maxCols });
    Array.from(this.cells.entries()).forEach(([key, data]) => {
      newGrid.cells.set(key, { ...data });
    });
    return newGrid;
  }

  toJSON(): object {
    const cellsArray: Array<{ row: number; col: number; data: CellData }> = [];
    Array.from(this.cells.entries()).forEach(([key, data]) => {
      const { row, col } = this.parseKey(key);
      cellsArray.push({ row, col, data });
    });
    return {
      maxRows: this.maxRows,
      maxCols: this.maxCols,
      cells: cellsArray,
    };
  }

  static fromJSON(json: any): SparseGrid {
    const grid = new SparseGrid({
      maxRows: json.maxRows || DEFAULT_CONFIG.maxRows,
      maxCols: json.maxCols || DEFAULT_CONFIG.maxCols,
    });
    
    if (Array.isArray(json.cells)) {
      for (const { row, col, data } of json.cells) {
        grid.setCell(row, col, data);
      }
    }
    
    return grid;
  }
}

export function getColumnName(index: number): string {
  let name = '';
  let i = index;
  while (i >= 0) {
    name = String.fromCharCode(65 + (i % 26)) + name;
    i = Math.floor(i / 26) - 1;
  }
  return name;
}

export function getColumnIndex(name: string): number {
  let index = 0;
  const upperName = name.toUpperCase();
  for (let i = 0; i < upperName.length; i++) {
    index = index * 26 + (upperName.charCodeAt(i) - 64);
  }
  return index - 1;
}

export function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    row: parseInt(match[2], 10) - 1,
    col: getColumnIndex(match[1]),
  };
}

export function formatCellRef(row: number, col: number): string {
  return `${getColumnName(col)}${row + 1}`;
}

export function parseRange(range: string): Array<{ row: number; col: number }> {
  const [start, end] = range.split(':');
  const startCell = parseCellRef(start);
  const endCell = end ? parseCellRef(end) : startCell;
  if (!startCell || !endCell) return [];
  
  const cells: Array<{ row: number; col: number }> = [];
  for (let r = Math.min(startCell.row, endCell.row); r <= Math.max(startCell.row, endCell.row); r++) {
    for (let c = Math.min(startCell.col, endCell.col); c <= Math.max(startCell.col, endCell.col); c++) {
      cells.push({ row: r, col: c });
    }
  }
  return cells;
}
