import { SparseGrid, CellData } from './sparseGrid';

export interface ExcelCommand {
  type: string;
  execute(): void;
  undo(): void;
  description: string;
}

export class UndoRedoManager {
  private undoStack: ExcelCommand[] = [];
  private redoStack: ExcelCommand[] = [];
  private maxStackSize: number;

  constructor(maxStackSize: number = 100) {
    this.maxStackSize = maxStackSize;
  }

  execute(command: ExcelCommand): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = [];
    
    while (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }
  }

  undo(): ExcelCommand | null {
    const command = this.undoStack.pop();
    if (!command) return null;
    
    command.undo();
    this.redoStack.push(command);
    return command;
  }

  redo(): ExcelCommand | null {
    const command = this.redoStack.pop();
    if (!command) return null;
    
    command.execute();
    this.undoStack.push(command);
    return command;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getUndoDescription(): string | null {
    if (this.undoStack.length === 0) return null;
    return this.undoStack[this.undoStack.length - 1].description;
  }

  getRedoDescription(): string | null {
    if (this.redoStack.length === 0) return null;
    return this.redoStack[this.redoStack.length - 1].description;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  getUndoStackSize(): number {
    return this.undoStack.length;
  }

  getRedoStackSize(): number {
    return this.redoStack.length;
  }
}

class SetCellValueCommand implements ExcelCommand {
  type = 'SetCellValue';
  private grid: SparseGrid;
  private row: number;
  private col: number;
  private newValue: string;
  private newFormat: Partial<CellData> | undefined;
  private previousData: CellData;
  description: string;

  constructor(
    grid: SparseGrid,
    row: number,
    col: number,
    newValue: string,
    newFormat?: Partial<CellData>
  ) {
    this.grid = grid;
    this.row = row;
    this.col = col;
    this.newValue = newValue;
    this.newFormat = newFormat;
    this.previousData = { ...grid.getCell(row, col) };
    this.description = `Set cell ${String.fromCharCode(65 + col)}${row + 1} to "${newValue}"`;
  }

  execute(): void {
    const data: Partial<CellData> = { value: this.newValue };
    if (this.newFormat) {
      Object.assign(data, this.newFormat);
    }
    this.grid.setCell(this.row, this.col, data);
  }

  undo(): void {
    if (this.previousData.value === '' && !this.hasFormatting(this.previousData)) {
      this.grid.deleteCell(this.row, this.col);
    } else {
      this.grid.setCell(this.row, this.col, this.previousData);
    }
  }

  private hasFormatting(data: CellData): boolean {
    return !!(data.bold || data.italic || data.underline || 
      data.fontFamily || data.fontSize || data.color || data.backgroundColor || data.format);
  }
}

class SetCellFormatCommand implements ExcelCommand {
  type = 'SetCellFormat';
  private grid: SparseGrid;
  private row: number;
  private col: number;
  private newFormat: Partial<CellData>;
  private previousData: CellData;
  description: string;

  constructor(
    grid: SparseGrid,
    row: number,
    col: number,
    newFormat: Partial<CellData>
  ) {
    this.grid = grid;
    this.row = row;
    this.col = col;
    this.newFormat = newFormat;
    this.previousData = { ...grid.getCell(row, col) };
    this.description = `Format cell ${String.fromCharCode(65 + col)}${row + 1}`;
  }

  execute(): void {
    const existing = this.grid.getCell(this.row, this.col);
    this.grid.setCell(this.row, this.col, { ...existing, ...this.newFormat });
  }

  undo(): void {
    this.grid.setCell(this.row, this.col, this.previousData);
  }
}

class InsertRowCommand implements ExcelCommand {
  type = 'InsertRow';
  private grid: SparseGrid;
  private rowIndex: number;
  description: string;

  constructor(grid: SparseGrid, rowIndex: number) {
    this.grid = grid;
    this.rowIndex = rowIndex;
    this.description = `Insert row at ${rowIndex + 1}`;
  }

  execute(): void {
    const allCells = this.grid.getAllCells()
      .sort((a, b) => b.row - a.row);
    
    for (const { row, col, data } of allCells) {
      if (row >= this.rowIndex) {
        this.grid.deleteCell(row, col);
        this.grid.setCell(row + 1, col, data);
      }
    }
  }

  undo(): void {
    const allCells = this.grid.getAllCells()
      .sort((a, b) => a.row - b.row);
    
    for (const { row, col, data } of allCells) {
      if (row > this.rowIndex) {
        this.grid.deleteCell(row, col);
        this.grid.setCell(row - 1, col, data);
      } else if (row === this.rowIndex) {
        this.grid.deleteCell(row, col);
      }
    }
  }
}

class DeleteRowCommand implements ExcelCommand {
  type = 'DeleteRow';
  private grid: SparseGrid;
  private rowIndex: number;
  private deletedRowData: Map<number, CellData>;
  description: string;

  constructor(grid: SparseGrid, rowIndex: number) {
    this.grid = grid;
    this.rowIndex = rowIndex;
    this.deletedRowData = new Map();
    this.description = `Delete row ${rowIndex + 1}`;
    
    const allCells = grid.getAllCells();
    for (const { row, col, data } of allCells) {
      if (row === rowIndex) {
        this.deletedRowData.set(col, { ...data });
      }
    }
  }

  execute(): void {
    const allCells = this.grid.getAllCells()
      .sort((a, b) => a.row - b.row);
    
    for (const { row, col, data } of allCells) {
      if (row === this.rowIndex) {
        this.grid.deleteCell(row, col);
      } else if (row > this.rowIndex) {
        this.grid.deleteCell(row, col);
        this.grid.setCell(row - 1, col, data);
      }
    }
  }

  undo(): void {
    const allCells = this.grid.getAllCells()
      .sort((a, b) => b.row - a.row);
    
    for (const { row, col, data } of allCells) {
      if (row >= this.rowIndex) {
        this.grid.deleteCell(row, col);
        this.grid.setCell(row + 1, col, data);
      }
    }
    
    Array.from(this.deletedRowData.entries()).forEach(([col, data]) => {
      this.grid.setCell(this.rowIndex, col, data);
    });
  }
}

class InsertColumnCommand implements ExcelCommand {
  type = 'InsertColumn';
  private grid: SparseGrid;
  private colIndex: number;
  description: string;

  constructor(grid: SparseGrid, colIndex: number) {
    this.grid = grid;
    this.colIndex = colIndex;
    this.description = `Insert column at ${String.fromCharCode(65 + colIndex)}`;
  }

  execute(): void {
    const allCells = this.grid.getAllCells()
      .sort((a, b) => b.col - a.col);
    
    for (const { row, col, data } of allCells) {
      if (col >= this.colIndex) {
        this.grid.deleteCell(row, col);
        this.grid.setCell(row, col + 1, data);
      }
    }
  }

  undo(): void {
    const allCells = this.grid.getAllCells()
      .sort((a, b) => a.col - b.col);
    
    for (const { row, col, data } of allCells) {
      if (col > this.colIndex) {
        this.grid.deleteCell(row, col);
        this.grid.setCell(row, col - 1, data);
      } else if (col === this.colIndex) {
        this.grid.deleteCell(row, col);
      }
    }
  }
}

class DeleteColumnCommand implements ExcelCommand {
  type = 'DeleteColumn';
  private grid: SparseGrid;
  private colIndex: number;
  private deletedColData: Map<number, CellData>;
  description: string;

  constructor(grid: SparseGrid, colIndex: number) {
    this.grid = grid;
    this.colIndex = colIndex;
    this.deletedColData = new Map();
    this.description = `Delete column ${String.fromCharCode(65 + colIndex)}`;
    
    const allCells = grid.getAllCells();
    for (const { row, col, data } of allCells) {
      if (col === colIndex) {
        this.deletedColData.set(row, { ...data });
      }
    }
  }

  execute(): void {
    const allCells = this.grid.getAllCells()
      .sort((a, b) => a.col - b.col);
    
    for (const { row, col, data } of allCells) {
      if (col === this.colIndex) {
        this.grid.deleteCell(row, col);
      } else if (col > this.colIndex) {
        this.grid.deleteCell(row, col);
        this.grid.setCell(row, col - 1, data);
      }
    }
  }

  undo(): void {
    const allCells = this.grid.getAllCells()
      .sort((a, b) => b.col - a.col);
    
    for (const { row, col, data } of allCells) {
      if (col >= this.colIndex) {
        this.grid.deleteCell(row, col);
        this.grid.setCell(row, col + 1, data);
      }
    }
    
    Array.from(this.deletedColData.entries()).forEach(([row, data]) => {
      this.grid.setCell(row, this.colIndex, data);
    });
  }
}

class SetRangeCommand implements ExcelCommand {
  type = 'SetRange';
  private grid: SparseGrid;
  private startRow: number;
  private startCol: number;
  private data: (string | number | Partial<CellData> | null)[][];
  private previousData: Map<string, CellData>;
  description: string;

  constructor(
    grid: SparseGrid,
    startRow: number,
    startCol: number,
    data: (string | number | Partial<CellData> | null)[][]
  ) {
    this.grid = grid;
    this.startRow = startRow;
    this.startCol = startCol;
    this.data = data;
    this.previousData = new Map();
    
    const rowCount = data.length;
    const colCount = data.reduce((max, row) => Math.max(max, row.length), 0);
    this.description = `Set range ${String.fromCharCode(65 + startCol)}${startRow + 1}:${String.fromCharCode(65 + startCol + colCount - 1)}${startRow + rowCount}`;
    
    for (let r = 0; r < data.length; r++) {
      for (let c = 0; c < data[r].length; c++) {
        const row = startRow + r;
        const col = startCol + c;
        const key = `${row}:${col}`;
        this.previousData.set(key, { ...grid.getCell(row, col) });
      }
    }
  }

  execute(): void {
    for (let r = 0; r < this.data.length; r++) {
      for (let c = 0; c < this.data[r].length; c++) {
        const cellData = this.data[r][c];
        if (cellData === null) continue;
        
        const row = this.startRow + r;
        const col = this.startCol + c;
        
        if (typeof cellData === 'string' || typeof cellData === 'number') {
          this.grid.setCell(row, col, { value: String(cellData) });
        } else {
          this.grid.setCell(row, col, cellData as Partial<CellData>);
        }
      }
    }
  }

  undo(): void {
    Array.from(this.previousData.entries()).forEach(([key, data]) => {
      const [row, col] = key.split(':').map(Number);
      if (data.value === '' && !this.hasFormatting(data)) {
        this.grid.deleteCell(row, col);
      } else {
        this.grid.setCell(row, col, data);
      }
    });
  }

  private hasFormatting(data: CellData): boolean {
    return !!(data.bold || data.italic || data.underline || 
      data.fontFamily || data.fontSize || data.color || data.backgroundColor || data.format);
  }
}

class ClearRangeCommand implements ExcelCommand {
  type = 'ClearRange';
  private grid: SparseGrid;
  private startRow: number;
  private endRow: number;
  private startCol: number;
  private endCol: number;
  private previousData: Map<string, CellData>;
  description: string;

  constructor(
    grid: SparseGrid,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number
  ) {
    this.grid = grid;
    this.startRow = startRow;
    this.endRow = endRow;
    this.startCol = startCol;
    this.endCol = endCol;
    this.previousData = new Map();
    this.description = `Clear range ${String.fromCharCode(65 + startCol)}${startRow + 1}:${String.fromCharCode(65 + endCol)}${endRow + 1}`;
    
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const key = `${r}:${c}`;
        const cellData = grid.getCell(r, c);
        if (cellData.value !== '' || this.hasFormatting(cellData)) {
          this.previousData.set(key, { ...cellData });
        }
      }
    }
  }

  execute(): void {
    for (let r = this.startRow; r <= this.endRow; r++) {
      for (let c = this.startCol; c <= this.endCol; c++) {
        this.grid.deleteCell(r, c);
      }
    }
  }

  undo(): void {
    Array.from(this.previousData.entries()).forEach(([key, data]) => {
      const [row, col] = key.split(':').map(Number);
      this.grid.setCell(row, col, data);
    });
  }

  private hasFormatting(data: CellData): boolean {
    return !!(data.bold || data.italic || data.underline || 
      data.fontFamily || data.fontSize || data.color || data.backgroundColor || data.format);
  }
}

export function createSetCellCommand(
  grid: SparseGrid,
  row: number,
  col: number,
  newValue: string,
  newFormat?: Partial<CellData>
): ExcelCommand {
  return new SetCellValueCommand(grid, row, col, newValue, newFormat);
}

export function createSetCellFormatCommand(
  grid: SparseGrid,
  row: number,
  col: number,
  newFormat: Partial<CellData>
): ExcelCommand {
  return new SetCellFormatCommand(grid, row, col, newFormat);
}

export function createInsertRowCommand(
  grid: SparseGrid,
  rowIndex: number
): ExcelCommand {
  return new InsertRowCommand(grid, rowIndex);
}

export function createDeleteRowCommand(
  grid: SparseGrid,
  rowIndex: number
): ExcelCommand {
  return new DeleteRowCommand(grid, rowIndex);
}

export function createInsertColumnCommand(
  grid: SparseGrid,
  colIndex: number
): ExcelCommand {
  return new InsertColumnCommand(grid, colIndex);
}

export function createDeleteColumnCommand(
  grid: SparseGrid,
  colIndex: number
): ExcelCommand {
  return new DeleteColumnCommand(grid, colIndex);
}

export function createSetRangeCommand(
  grid: SparseGrid,
  startRow: number,
  startCol: number,
  data: (string | number | Partial<CellData> | null)[][]
): ExcelCommand {
  return new SetRangeCommand(grid, startRow, startCol, data);
}

export function createClearRangeCommand(
  grid: SparseGrid,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number
): ExcelCommand {
  return new ClearRangeCommand(grid, startRow, endRow, startCol, endCol);
}
