import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { SparseGrid, CellData } from '@/lib/sparseGrid';
import {
  ExcelCommand,
  UndoRedoManager,
  createSetCellCommand,
  createSetCellFormatCommand,
  createInsertRowCommand,
  createDeleteRowCommand,
  createInsertColumnCommand,
  createDeleteColumnCommand,
  createSetRangeCommand,
  createClearRangeCommand,
} from '@/lib/excelUndoRedo';

interface UseExcelUndoRedoReturn {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  executeCommand: (command: ExcelCommand) => void;
  undoDescription: string | null;
  redoDescription: string | null;
  setCellValue: (row: number, col: number, value: string, format?: Partial<CellData>) => void;
  setCellFormat: (row: number, col: number, format: Partial<CellData>) => void;
  insertRow: (rowIndex: number) => void;
  deleteRow: (rowIndex: number) => void;
  insertColumn: (colIndex: number) => void;
  deleteColumn: (colIndex: number) => void;
  setRange: (startRow: number, startCol: number, data: (string | number | Partial<CellData> | null)[][]) => void;
  clearRange: (startRow: number, endRow: number, startCol: number, endCol: number) => void;
  clear: () => void;
}

export function useExcelUndoRedo(
  grid: SparseGrid,
  onGridChange: (grid: SparseGrid) => void
): UseExcelUndoRedoReturn {
  const managerRef = useRef<UndoRedoManager>(new UndoRedoManager(100));
  const [version, setVersion] = useState(0);

  const triggerUpdate = useCallback(() => {
    setVersion(v => v + 1);
    onGridChange(grid);
  }, [grid, onGridChange]);

  const executeCommand = useCallback((command: ExcelCommand) => {
    managerRef.current.execute(command);
    triggerUpdate();
  }, [triggerUpdate]);

  const undo = useCallback(() => {
    const command = managerRef.current.undo();
    if (command) {
      triggerUpdate();
    }
  }, [triggerUpdate]);

  const redo = useCallback(() => {
    const command = managerRef.current.redo();
    if (command) {
      triggerUpdate();
    }
  }, [triggerUpdate]);

  const setCellValue = useCallback((
    row: number,
    col: number,
    value: string,
    format?: Partial<CellData>
  ) => {
    const command = createSetCellCommand(grid, row, col, value, format);
    executeCommand(command);
  }, [grid, executeCommand]);

  const setCellFormat = useCallback((
    row: number,
    col: number,
    format: Partial<CellData>
  ) => {
    const command = createSetCellFormatCommand(grid, row, col, format);
    executeCommand(command);
  }, [grid, executeCommand]);

  const insertRow = useCallback((rowIndex: number) => {
    const command = createInsertRowCommand(grid, rowIndex);
    executeCommand(command);
  }, [grid, executeCommand]);

  const deleteRow = useCallback((rowIndex: number) => {
    const command = createDeleteRowCommand(grid, rowIndex);
    executeCommand(command);
  }, [grid, executeCommand]);

  const insertColumn = useCallback((colIndex: number) => {
    const command = createInsertColumnCommand(grid, colIndex);
    executeCommand(command);
  }, [grid, executeCommand]);

  const deleteColumn = useCallback((colIndex: number) => {
    const command = createDeleteColumnCommand(grid, colIndex);
    executeCommand(command);
  }, [grid, executeCommand]);

  const setRange = useCallback((
    startRow: number,
    startCol: number,
    data: (string | number | Partial<CellData> | null)[][]
  ) => {
    const command = createSetRangeCommand(grid, startRow, startCol, data);
    executeCommand(command);
  }, [grid, executeCommand]);

  const clearRange = useCallback((
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number
  ) => {
    const command = createClearRangeCommand(grid, startRow, endRow, startCol, endCol);
    executeCommand(command);
  }, [grid, executeCommand]);

  const clear = useCallback(() => {
    managerRef.current.clear();
    setVersion(v => v + 1);
  }, []);

  const canUndo = useMemo(() => managerRef.current.canUndo(), [version]);
  const canRedo = useMemo(() => managerRef.current.canRedo(), [version]);
  const undoDescription = useMemo(() => managerRef.current.getUndoDescription(), [version]);
  const redoDescription = useMemo(() => managerRef.current.getRedoDescription(), [version]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    executeCommand,
    undoDescription,
    redoDescription,
    setCellValue,
    setCellFormat,
    insertRow,
    deleteRow,
    insertColumn,
    deleteColumn,
    setRange,
    clearRange,
    clear,
  };
}
