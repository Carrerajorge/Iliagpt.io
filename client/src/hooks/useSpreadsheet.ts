import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Workbook, Sheet, Selection, CellStyle, CellData,
  newWorkbook, newSheet, normSel, makeRef, parseRef,
  selectionLabel, clamp, formatValue, csvEscape, parseCSV,
  colToName, isLikelyNumberString, toNumber
} from '@/lib/spreadsheet-utils';

const MAX_HISTORY = 200;

type ActionType = 'cell' | 'style' | 'paste' | 'sheet_add' | 'sheet_rename' | 'sheet_delete';

interface HistoryEntry {
  type: ActionType;
  snapshot: string;
  timestamp: number;
}

interface ClipboardData {
  cells: Record<string, CellData>;
  rMin: number;
  rMax: number;
  cMin: number;
  cMax: number;
  isCut: boolean;
  sourceSheetIndex: number;
}

interface ComputedCache {
  [cellRef: string]: string | number;
}

export interface UseSpreadsheetReturn {
  workbook: Workbook;
  selection: Selection;
  editing: boolean;
  editValue: string;
  cache: ComputedCache;
  getCell: (row: number, col: number) => CellData | null;
  getCellStyle: (row: number, col: number) => CellStyle;
  setCellRaw: (row: number, col: number, raw: string) => void;
  applyStyle: (style: Partial<CellStyle>) => void;
  toggleStyle: (key: keyof CellStyle) => void;
  clearSelection: () => void;
  moveSelection: (dr: number, dc: number, extend?: boolean) => void;
  setSelection: (sel: Selection) => void;
  startEditing: (value?: string) => void;
  finishEditing: (commit?: boolean) => void;
  setEditValue: (value: string) => void;
  copy: (cut?: boolean) => void;
  paste: (mode?: 'all' | 'values' | 'formats') => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  addSheet: (name?: string) => void;
  renameSheet: (index: number, name: string) => void;
  deleteSheet: (index: number) => void;
  setActiveSheet: (index: number) => void;
  exportJSON: () => string;
  importJSON: (json: string) => boolean;
  exportCSV: () => string;
  importCSV: (csv: string) => void;
  autoSum: () => void;
  getActiveSheet: () => Sheet;
  selectionLabel: () => string;
  setWorkbook: (wb: Workbook) => void;
  getCellDisplayValue: (row: number, col: number) => string;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function useSpreadsheet(initialWorkbook?: Workbook): UseSpreadsheetReturn {
  const [workbook, setWorkbookState] = useState<Workbook>(() => 
    initialWorkbook ? deepClone(initialWorkbook) : newWorkbook()
  );
  
  const [selection, setSelection] = useState<Selection>({ r1: 1, c1: 1, r2: 1, c2: 1 });
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [cache, setCache] = useState<ComputedCache>({});
  
  const clipboardRef = useRef<ClipboardData | null>(null);
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const evaluatingRef = useRef<Set<string>>(new Set());

  const getActiveSheet = useCallback((): Sheet => {
    return workbook.sheets[workbook.active] || workbook.sheets[0];
  }, [workbook]);

  const evaluateFormula = useCallback((formula: string, sheet: Sheet, currentRef?: string): string | number => {
    if (!formula.startsWith('=')) return formula;
    
    const expr = formula.slice(1).trim();
    if (!expr) return '';

    const evalStack = evaluatingRef.current;
    if (currentRef && evalStack.has(currentRef)) {
      return '#CIRCULAR!';
    }
    if (currentRef) evalStack.add(currentRef);

    try {
      const V = (ref: string): number => {
        const parsed = parseRef(ref);
        if (!parsed) return 0;
        const cellData = sheet.cells[parsed.a1];
        if (!cellData) return 0;
        const raw = cellData.raw;
        if (raw.startsWith('=')) {
          const result = evaluateFormula(raw, sheet, parsed.a1);
          return toNumber(result);
        }
        return toNumber(raw);
      };

      const R = (rangeStr: string): number[] => {
        const parts = rangeStr.split(':');
        if (parts.length !== 2) return [];
        const start = parseRef(parts[0]);
        const end = parseRef(parts[1]);
        if (!start || !end) return [];
        
        const values: number[] = [];
        const rMin = Math.min(start.row, end.row);
        const rMax = Math.max(start.row, end.row);
        const cMin = Math.min(start.col, end.col);
        const cMax = Math.max(start.col, end.col);
        
        for (let r = rMin; r <= rMax; r++) {
          for (let c = cMin; c <= cMax; c++) {
            const ref = makeRef(r, c);
            values.push(V(ref));
          }
        }
        return values;
      };

      const upperExpr = expr.toUpperCase();
      
      const sumMatch = upperExpr.match(/^(SUM|SUMA)\((.+)\)$/i);
      if (sumMatch) {
        const arg = sumMatch[2].trim();
        if (arg.includes(':')) {
          return R(arg).reduce((a, b) => a + b, 0);
        }
        return V(arg);
      }

      const avgMatch = upperExpr.match(/^(AVERAGE|AVG|PROMEDIO)\((.+)\)$/i);
      if (avgMatch) {
        const arg = avgMatch[2].trim();
        if (arg.includes(':')) {
          const vals = R(arg);
          return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        }
        return V(arg);
      }

      const minMatch = upperExpr.match(/^MIN\((.+)\)$/i);
      if (minMatch) {
        const arg = minMatch[1].trim();
        if (arg.includes(':')) {
          const vals = R(arg);
          return vals.length > 0 ? Math.min(...vals) : 0;
        }
        return V(arg);
      }

      const maxMatch = upperExpr.match(/^MAX\((.+)\)$/i);
      if (maxMatch) {
        const arg = maxMatch[1].trim();
        if (arg.includes(':')) {
          const vals = R(arg);
          return vals.length > 0 ? Math.max(...vals) : 0;
        }
        return V(arg);
      }

      const countMatch = upperExpr.match(/^(COUNT|CONTAR)\((.+)\)$/i);
      if (countMatch) {
        const arg = countMatch[2].trim();
        if (arg.includes(':')) {
          return R(arg).filter(v => v !== 0).length;
        }
        return V(arg) !== 0 ? 1 : 0;
      }

      const ifMatch = upperExpr.match(/^(IF|SI)\((.+)\)$/i);
      if (ifMatch) {
        const args = ifMatch[2].split(',').map(s => s.trim());
        if (args.length >= 2) {
          const condition = args[0];
          const truePart = args[1];
          const falsePart = args[2] || '0';
          
          let condResult = false;
          const gtMatch = condition.match(/([A-Z]+\d+)\s*>\s*(\d+)/i);
          const ltMatch = condition.match(/([A-Z]+\d+)\s*<\s*(\d+)/i);
          const eqMatch = condition.match(/([A-Z]+\d+)\s*=\s*(\d+)/i);
          const gteMatch = condition.match(/([A-Z]+\d+)\s*>=\s*(\d+)/i);
          const lteMatch = condition.match(/([A-Z]+\d+)\s*<=\s*(\d+)/i);
          
          if (gtMatch) {
            condResult = V(gtMatch[1]) > parseFloat(gtMatch[2]);
          } else if (ltMatch) {
            condResult = V(ltMatch[1]) < parseFloat(ltMatch[2]);
          } else if (gteMatch) {
            condResult = V(gteMatch[1]) >= parseFloat(gteMatch[2]);
          } else if (lteMatch) {
            condResult = V(lteMatch[1]) <= parseFloat(lteMatch[2]);
          } else if (eqMatch) {
            condResult = V(eqMatch[1]) === parseFloat(eqMatch[2]);
          }
          
          const resultStr = condResult ? truePart : falsePart;
          if (parseRef(resultStr)) return V(resultStr);
          const num = parseFloat(resultStr.replace(/"/g, ''));
          return isNaN(num) ? resultStr.replace(/"/g, '') : num;
        }
      }

      const cellMatch = expr.match(/^[A-Z]+\d+$/i);
      if (cellMatch) {
        return V(expr);
      }

      // Safe expression evaluator - no dynamic code execution
      const safeEval = (expression: string): number => {
        // Only allow: numbers, cell references (already replaced), +, -, *, /, (, ), **, spaces
        const sanitized = expression
          .replace(/([A-Z]+\d+)/gi, (match) => String(V(match.toUpperCase())))
          .replace(/\^/g, '**');
        
        // Validate expression contains only safe characters
        if (!/^[\d\s+\-*/().]+$/.test(sanitized)) {
          throw new Error('Invalid expression');
        }
        
        // Parse and evaluate safely using a simple recursive descent parser
        let pos = 0;
        const tokens = sanitized.match(/(\d+\.?\d*|\+|\-|\*{1,2}|\/|\(|\))/g) || [];
        
        const parseNumber = (): number => {
          if (tokens[pos] === '(') {
            pos++;
            const result = parseAddSub();
            if (tokens[pos] === ')') pos++;
            return result;
          }
          if (tokens[pos] === '-') {
            pos++;
            return -parseNumber();
          }
          const num = parseFloat(tokens[pos] || '0');
          pos++;
          return isNaN(num) ? 0 : num;
        };
        
        const parsePow = (): number => {
          let left = parseNumber();
          while (tokens[pos] === '**') {
            pos++;
            left = Math.pow(left, parseNumber());
          }
          return left;
        };
        
        const parseMulDiv = (): number => {
          let left = parsePow();
          while (tokens[pos] === '*' || tokens[pos] === '/') {
            const op = tokens[pos];
            pos++;
            const right = parsePow();
            left = op === '*' ? left * right : (right !== 0 ? left / right : 0);
          }
          return left;
        };
        
        const parseAddSub = (): number => {
          let left = parseMulDiv();
          while (tokens[pos] === '+' || tokens[pos] === '-') {
            const op = tokens[pos];
            pos++;
            const right = parseMulDiv();
            left = op === '+' ? left + right : left - right;
          }
          return left;
        };
        
        return parseAddSub();
      };
      
      try {
        return safeEval(expr);
      } catch {
        return '#ERROR!';
      }
    } catch (e) {
      return '#ERROR!';
    } finally {
      if (currentRef) evalStack.delete(currentRef);
    }
  }, []);

  const recalculateCache = useCallback((wb: Workbook) => {
    const newCache: ComputedCache = {};
    const sheet = wb.sheets[wb.active];
    if (!sheet) return newCache;

    evaluatingRef.current.clear();

    for (const [ref, cellData] of Object.entries(sheet.cells)) {
      if (cellData.raw.startsWith('=')) {
        newCache[ref] = evaluateFormula(cellData.raw, sheet, ref);
      } else {
        newCache[ref] = cellData.raw;
      }
    }
    return newCache;
  }, [evaluateFormula]);

  useEffect(() => {
    setCache(recalculateCache(workbook));
  }, [workbook, recalculateCache]);

  const pushHistory = useCallback((type: ActionType) => {
    const snapshot = JSON.stringify(workbook);
    const entry: HistoryEntry = { type, snapshot, timestamp: Date.now() };
    
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }
    
    historyRef.current.push(entry);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
    historyIndexRef.current = historyRef.current.length - 1;
  }, [workbook]);

  const setWorkbook = useCallback((wb: Workbook) => {
    setWorkbookState(deepClone(wb));
  }, []);

  const getCell = useCallback((row: number, col: number): CellData | null => {
    const sheet = getActiveSheet();
    const ref = makeRef(row, col);
    return sheet.cells[ref] || null;
  }, [getActiveSheet]);

  const getCellStyle = useCallback((row: number, col: number): CellStyle => {
    const cell = getCell(row, col);
    return cell?.style || {};
  }, [getCell]);

  const getCellDisplayValue = useCallback((row: number, col: number): string => {
    const ref = makeRef(row, col);
    const cell = getCell(row, col);
    if (!cell) return '';
    
    const raw = cell.raw;
    if (raw.startsWith('=')) {
      const computed = cache[ref];
      if (computed === undefined) return raw;
      return formatValue(computed, cell.style);
    }
    
    if (isLikelyNumberString(raw)) {
      return formatValue(toNumber(raw), cell.style);
    }
    return raw;
  }, [getCell, cache]);

  const setCellRaw = useCallback((row: number, col: number, raw: string) => {
    pushHistory('cell');
    setWorkbookState(prev => {
      const wb = deepClone(prev);
      const sheet = wb.sheets[wb.active];
      const ref = makeRef(row, col);
      
      if (!raw && !sheet.cells[ref]) return prev;
      
      if (!raw) {
        delete sheet.cells[ref];
      } else {
        sheet.cells[ref] = {
          raw,
          style: sheet.cells[ref]?.style || {}
        };
      }
      return wb;
    });
  }, [pushHistory]);

  const applyStyle = useCallback((style: Partial<CellStyle>) => {
    pushHistory('style');
    const { rMin, rMax, cMin, cMax } = normSel(selection);
    
    setWorkbookState(prev => {
      const wb = deepClone(prev);
      const sheet = wb.sheets[wb.active];
      
      for (let r = rMin; r <= rMax; r++) {
        for (let c = cMin; c <= cMax; c++) {
          const ref = makeRef(r, c);
          if (!sheet.cells[ref]) {
            sheet.cells[ref] = { raw: '', style: {} };
          }
          sheet.cells[ref].style = { ...sheet.cells[ref].style, ...style };
        }
      }
      return wb;
    });
  }, [selection, pushHistory]);

  const toggleStyle = useCallback((key: keyof CellStyle) => {
    const { rMin, cMin } = normSel(selection);
    const currentStyle = getCellStyle(rMin, cMin);
    const currentValue = currentStyle[key];
    applyStyle({ [key]: !currentValue } as Partial<CellStyle>);
  }, [selection, getCellStyle, applyStyle]);

  const clearSelection = useCallback(() => {
    pushHistory('cell');
    const { rMin, rMax, cMin, cMax } = normSel(selection);
    
    setWorkbookState(prev => {
      const wb = deepClone(prev);
      const sheet = wb.sheets[wb.active];
      
      for (let r = rMin; r <= rMax; r++) {
        for (let c = cMin; c <= cMax; c++) {
          const ref = makeRef(r, c);
          delete sheet.cells[ref];
        }
      }
      return wb;
    });
  }, [selection, pushHistory]);

  const moveSelection = useCallback((dr: number, dc: number, extend = false) => {
    const sheet = getActiveSheet();
    setSelection(prev => {
      const newR2 = clamp(prev.r2 + dr, 1, sheet.rows);
      const newC2 = clamp(prev.c2 + dc, 1, sheet.cols);
      
      if (extend) {
        return { ...prev, r2: newR2, c2: newC2 };
      }
      return { r1: newR2, c1: newC2, r2: newR2, c2: newC2 };
    });
  }, [getActiveSheet]);

  const startEditing = useCallback((value?: string) => {
    if (editing) return;
    const cell = getCell(selection.r1, selection.c1);
    setEditValue(value !== undefined ? value : (cell?.raw || ''));
    setEditing(true);
  }, [editing, getCell, selection]);

  const finishEditing = useCallback((commit = true) => {
    if (!editing) return;
    if (commit) {
      setCellRaw(selection.r1, selection.c1, editValue);
    }
    setEditing(false);
    setEditValue('');
  }, [editing, editValue, selection, setCellRaw]);

  const copy = useCallback((cut = false) => {
    const { rMin, rMax, cMin, cMax } = normSel(selection);
    const sheet = getActiveSheet();
    const cells: Record<string, CellData> = {};
    
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const ref = makeRef(r, c);
        if (sheet.cells[ref]) {
          cells[ref] = deepClone(sheet.cells[ref]);
        }
      }
    }
    
    clipboardRef.current = {
      cells,
      rMin, rMax, cMin, cMax,
      isCut: cut,
      sourceSheetIndex: workbook.active
    };
    
    if (cut) {
      clearSelection();
    }
  }, [selection, getActiveSheet, workbook.active, clearSelection]);

  const paste = useCallback((mode: 'all' | 'values' | 'formats' = 'all') => {
    const clip = clipboardRef.current;
    if (!clip) return;
    
    pushHistory('paste');
    
    const { r1, c1 } = selection;
    const rowOffset = r1 - clip.rMin;
    const colOffset = c1 - clip.cMin;
    
    setWorkbookState(prev => {
      const wb = deepClone(prev);
      const sheet = wb.sheets[wb.active];
      
      for (const [ref, cellData] of Object.entries(clip.cells)) {
        const parsed = parseRef(ref);
        if (!parsed) continue;
        
        const newRow = parsed.row + rowOffset;
        const newCol = parsed.col + colOffset;
        const newRef = makeRef(newRow, newCol);
        
        if (newRow < 1 || newRow > sheet.rows || newCol < 1 || newCol > sheet.cols) continue;
        
        if (!sheet.cells[newRef]) {
          sheet.cells[newRef] = { raw: '', style: {} };
        }
        
        if (mode === 'all') {
          sheet.cells[newRef] = deepClone(cellData);
        } else if (mode === 'values') {
          sheet.cells[newRef].raw = cellData.raw;
        } else if (mode === 'formats') {
          sheet.cells[newRef].style = deepClone(cellData.style);
        }
      }
      
      if (clip.isCut) {
        clipboardRef.current = null;
      }
      
      return wb;
    });
  }, [selection, pushHistory]);

  const undo = useCallback(() => {
    if (historyIndexRef.current < 0) return;
    
    const entry = historyRef.current[historyIndexRef.current];
    if (!entry) return;
    
    historyIndexRef.current--;
    
    if (historyIndexRef.current >= 0) {
      const prevEntry = historyRef.current[historyIndexRef.current];
      setWorkbookState(JSON.parse(prevEntry.snapshot));
    } else {
      setWorkbookState(newWorkbook());
    }
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    
    historyIndexRef.current++;
    const entry = historyRef.current[historyIndexRef.current];
    if (entry) {
      setWorkbookState(JSON.parse(entry.snapshot));
    }
  }, []);

  const canUndo = historyIndexRef.current >= 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;

  const addSheet = useCallback((name?: string) => {
    pushHistory('sheet_add');
    setWorkbookState(prev => {
      const wb = deepClone(prev);
      const sheetName = name || `Hoja${wb.sheets.length + 1}`;
      wb.sheets.push(newSheet(sheetName));
      wb.active = wb.sheets.length - 1;
      return wb;
    });
  }, [pushHistory]);

  const renameSheet = useCallback((index: number, name: string) => {
    pushHistory('sheet_rename');
    setWorkbookState(prev => {
      const wb = deepClone(prev);
      if (wb.sheets[index]) {
        wb.sheets[index].name = name;
      }
      return wb;
    });
  }, [pushHistory]);

  const deleteSheet = useCallback((index: number) => {
    if (workbook.sheets.length <= 1) return;
    
    pushHistory('sheet_delete');
    setWorkbookState(prev => {
      const wb = deepClone(prev);
      wb.sheets.splice(index, 1);
      if (wb.active >= wb.sheets.length) {
        wb.active = wb.sheets.length - 1;
      }
      return wb;
    });
  }, [workbook.sheets.length, pushHistory]);

  const setActiveSheet = useCallback((index: number) => {
    setWorkbookState(prev => {
      if (index < 0 || index >= prev.sheets.length) return prev;
      const wb = deepClone(prev);
      wb.active = index;
      return wb;
    });
    setSelection({ r1: 1, c1: 1, r2: 1, c2: 1 });
  }, []);

  const exportJSON = useCallback((): string => {
    return JSON.stringify(workbook, null, 2);
  }, [workbook]);

  const importJSON = useCallback((json: string): boolean => {
    try {
      const parsed = JSON.parse(json);
      if (!parsed.sheets || !Array.isArray(parsed.sheets)) {
        return false;
      }
      setWorkbookState(parsed as Workbook);
      setSelection({ r1: 1, c1: 1, r2: 1, c2: 1 });
      historyRef.current = [];
      historyIndexRef.current = -1;
      return true;
    } catch {
      return false;
    }
  }, []);

  const exportCSV = useCallback((): string => {
    const sheet = getActiveSheet();
    const bounds = { rMax: 0, cMax: 0 };
    
    for (const ref of Object.keys(sheet.cells)) {
      const parsed = parseRef(ref);
      if (parsed) {
        bounds.rMax = Math.max(bounds.rMax, parsed.row);
        bounds.cMax = Math.max(bounds.cMax, parsed.col);
      }
    }
    
    if (bounds.rMax === 0) return '';
    
    const rows: string[] = [];
    for (let r = 1; r <= bounds.rMax; r++) {
      const cols: string[] = [];
      for (let c = 1; c <= bounds.cMax; c++) {
        const ref = makeRef(r, c);
        const cell = sheet.cells[ref];
        const raw = cell?.raw || '';
        const display = raw.startsWith('=') 
          ? String(cache[ref] ?? '') 
          : raw;
        cols.push(csvEscape(display));
      }
      rows.push(cols.join(','));
    }
    return rows.join('\n');
  }, [getActiveSheet, cache]);

  const importCSV = useCallback((csv: string) => {
    const parsed = parseCSV(csv);
    if (parsed.length === 0) return;
    
    pushHistory('paste');
    setWorkbookState(prev => {
      const wb = deepClone(prev);
      const sheet = wb.sheets[wb.active];
      sheet.cells = {};
      
      for (let r = 0; r < parsed.length; r++) {
        for (let c = 0; c < parsed[r].length; c++) {
          const value = parsed[r][c];
          if (value) {
            const ref = makeRef(r + 1, c + 1);
            sheet.cells[ref] = { raw: value, style: {} };
          }
        }
      }
      
      sheet.rows = Math.max(sheet.rows, parsed.length);
      sheet.cols = Math.max(sheet.cols, Math.max(...parsed.map(row => row.length)));
      
      return wb;
    });
  }, [pushHistory]);

  const autoSum = useCallback(() => {
    const { rMin, rMax, cMin, cMax } = normSel(selection);
    
    if (rMin === rMax && cMin === cMax) {
      let r = rMin - 1;
      while (r >= 1) {
        const cell = getCell(r, cMin);
        if (!cell || !cell.raw || !isLikelyNumberString(cell.raw)) break;
        r--;
      }
      
      if (r < rMin - 1) {
        const startRef = makeRef(r + 1, cMin);
        const endRef = makeRef(rMin - 1, cMin);
        setCellRaw(rMin, cMin, `=SUM(${startRef}:${endRef})`);
      }
    } else {
      const sumRow = rMax + 1;
      for (let c = cMin; c <= cMax; c++) {
        const startRef = makeRef(rMin, c);
        const endRef = makeRef(rMax, c);
        setCellRaw(sumRow, c, `=SUM(${startRef}:${endRef})`);
      }
    }
  }, [selection, getCell, setCellRaw]);

  const getSelectionLabel = useCallback((): string => {
    return selectionLabel(selection);
  }, [selection]);

  return {
    workbook,
    selection,
    editing,
    editValue,
    cache,
    getCell,
    getCellStyle,
    setCellRaw,
    applyStyle,
    toggleStyle,
    clearSelection,
    moveSelection,
    setSelection,
    startEditing,
    finishEditing,
    setEditValue,
    copy,
    paste,
    undo,
    redo,
    canUndo,
    canRedo,
    addSheet,
    renameSheet,
    deleteSheet,
    setActiveSheet,
    exportJSON,
    importJSON,
    exportCSV,
    importCSV,
    autoSum,
    getActiveSheet,
    selectionLabel: getSelectionLabel,
    setWorkbook,
    getCellDisplayValue
  };
}

export default useSpreadsheet;
