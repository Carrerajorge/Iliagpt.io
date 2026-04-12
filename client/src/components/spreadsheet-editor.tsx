import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  X,
  Download,
  Plus,
  Trash2,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  BarChart3,
  LineChart,
  PieChart,
  Maximize2,
  Minimize2,
  FileSpreadsheet,
  Loader2,
  Send,
  Table,
  Calculator,
  Wand2,
  CheckCircle2,
  Undo,
  Redo,
  Copy,
  Scissors,
  Clipboard,
} from 'lucide-react';
import { toast } from 'sonner';
import { colToName, makeRef } from '@/lib/spreadsheet-utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart as RechartsLineChart, Line, PieChart as RechartsPieChart, Pie, Cell } from 'recharts';
import { VirtualizedExcel, GRID_CONFIG } from './virtualized-excel';
import { SparseGrid, getColumnName as getSparseColumnName, formatCellRef, CellData as SparseCellData } from '@/lib/sparseGrid';
import { FormulaEngine } from '@/lib/formulaEngine';
import { useExcelStreaming, STREAM_STATUS } from '@/hooks/useExcelStreaming';
import { StreamingIndicator } from './excel-streaming-indicator';
import { Sparkles } from 'lucide-react';
import { ExcelOrchestrator, WorkbookData as OrchestratorWorkbook, SheetData as OrchestratorSheet, ChartConfig as OrchestratorChartConfig } from '@/lib/excelOrchestrator';
import { ChartLayer, ChartConfig as ChartLayerConfig, createChartFromSelection } from './excel-chart-layer';
import { ExcelRibbon, RibbonCommands, CellFormat } from './excel-ribbon';
import { useExcelUndoRedo } from '@/hooks/useExcelUndoRedo';

interface SpreadsheetEditorProps {
  title: string;
  content: string;
  onChange: (content: string) => void;
  onClose: () => void;
  onDownload: () => void;
  onInsertContent?: (insertFn: (content: string) => Promise<void>) => void;
  onOrchestratorReady?: (orchestrator: { runOrchestrator: (prompt: string) => Promise<void> }) => void;
}

interface CellData {
  value: string;
  formula?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  indent?: number;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  numberFormat?: string;
  borders?: {
    top?: { style: 'thin' | 'medium' | 'thick' | 'double'; color: string };
    bottom?: { style: 'thin' | 'medium' | 'thick' | 'double'; color: string };
    left?: { style: 'thin' | 'medium' | 'thick' | 'double'; color: string };
    right?: { style: 'thin' | 'medium' | 'thick' | 'double'; color: string };
  };
}

interface ChartConfig {
  type: 'bar' | 'line' | 'pie';
  visible: boolean;
  title?: string;
}

interface SpreadsheetData {
  cells: { [key: string]: CellData };
  rowCount: number;
  colCount: number;
}

interface SheetData {
  id: string;
  name: string;
  data: SpreadsheetData;
  chartConfig?: ChartConfig;
  charts?: ChartLayerConfig[];
  conditionalFormats?: Array<{
    range: { startRow: number; endRow: number; startCol: number; endCol: number };
    rules: Array<{ condition: 'greaterThan' | 'lessThan' | 'equals' | 'between'; value?: number; min?: number; max?: number; style: { backgroundColor?: string; color?: string; } }>;
  }>;
  columnWidths?: { [colIndex: number]: number };
  rowHeights?: { [rowIndex: number]: number };
  frozenRows?: number;
  frozenColumns?: number;
  hiddenRows?: number[];
  hiddenColumns?: number[];
}

interface WorkbookData {
  sheets: SheetData[];
  activeSheetId: string;
}

const getColumnLabel = (index: number): string => {
  let label = '';
  let num = index;
  while (num >= 0) {
    label = String.fromCharCode(65 + (num % 26)) + label;
    num = Math.floor(num / 26) - 1;
  }
  return label;
};

const getCellKey = (row: number, col: number): string => `${row}-${col}`;

const parseCellRef = (ref: string): { row: number; col: number } | null => {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const colStr = match[1].toUpperCase();
  const rowNum = parseInt(match[2], 10) - 1;
  let colNum = 0;
  for (let i = 0; i < colStr.length; i++) {
    colNum = colNum * 26 + (colStr.charCodeAt(i) - 64);
  }
  colNum -= 1;
  return { row: rowNum, col: colNum };
};

const parseRange = (range: string): Array<{ row: number; col: number }> => {
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
};

const evaluateFormula = (formula: string, cells: { [key: string]: CellData }): string => {
  if (!formula.startsWith('=')) return formula;
  const expr = formula.substring(1).toUpperCase().trim();

  const getCellValue = (ref: string): number => {
    const parsed = parseCellRef(ref);
    if (!parsed) return 0;
    const cell = cells[getCellKey(parsed.row, parsed.col)];
    if (!cell) return 0;
    const val = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
    return isNaN(val) ? 0 : val;
  };

  const getRangeValues = (rangeStr: string): number[] => {
    const rangeCells = parseRange(rangeStr);
    return rangeCells.map(c => {
      const cell = cells[getCellKey(c.row, c.col)];
      if (!cell) return 0;
      const val = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
      return isNaN(val) ? 0 : val;
    });
  };

  const sumMatch = expr.match(/^SUM\(([^)]+)\)$/);
  if (sumMatch) {
    const values = getRangeValues(sumMatch[1]);
    return values.reduce((a, b) => a + b, 0).toString();
  }

  const avgMatch = expr.match(/^AVERAGE\(([^)]+)\)$/);
  if (avgMatch) {
    const values = getRangeValues(avgMatch[1]);
    if (values.length === 0) return '0';
    const sum = values.reduce((a, b) => a + b, 0);
    return (sum / values.length).toFixed(2);
  }

  const countMatch = expr.match(/^COUNT\(([^)]+)\)$/);
  if (countMatch) {
    const rangeCells = parseRange(countMatch[1]);
    let count = 0;
    rangeCells.forEach(c => {
      const cell = cells[getCellKey(c.row, c.col)];
      if (cell && cell.value.trim() !== '') count++;
    });
    return count.toString();
  }

  const minMatch = expr.match(/^MIN\(([^)]+)\)$/);
  if (minMatch) {
    const values = getRangeValues(minMatch[1]).filter(v => !isNaN(v));
    if (values.length === 0) return '0';
    return Math.min(...values).toString();
  }

  const maxMatch = expr.match(/^MAX\(([^)]+)\)$/);
  if (maxMatch) {
    const values = getRangeValues(maxMatch[1]).filter(v => !isNaN(v));
    if (values.length === 0) return '0';
    return Math.max(...values).toString();
  }

  const cellRefMatch = expr.match(/^([A-Z]+\d+)$/);
  if (cellRefMatch) {
    return getCellValue(cellRefMatch[1]).toString();
  }

  return '#ERROR';
};

const createEmptySheet = (id: string, name: string): SheetData => ({
  id,
  name,
  data: { cells: {}, rowCount: 20, colCount: 10 }
});

const parseSheetData = (content: string): SpreadsheetData => {
  if (content.includes('<table') && content.includes('</table>')) {
    const cells: { [key: string]: CellData } = {};
    let maxRow = 0;
    let maxCol = 0;

    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const rows = doc.querySelectorAll('tbody tr');

    rows.forEach((row, rowIndex) => {
      const tds = row.querySelectorAll('td');
      tds.forEach((td, colIndex) => {
        const value = td.textContent?.trim() || '';
        if (value) {
          const style = td.getAttribute('style') || '';
          cells[getCellKey(rowIndex, colIndex)] = {
            value,
            bold: style.includes('font-weight: bold'),
            italic: style.includes('font-style: italic'),
            align: style.includes('text-align: right') ? 'right' :
              style.includes('text-align: center') ? 'center' : 'left'
          };
        }
        maxCol = Math.max(maxCol, colIndex);
      });
      maxRow = Math.max(maxRow, rowIndex);
    });

    return {
      cells,
      rowCount: Math.max(maxRow + 1, 20),
      colCount: Math.max(maxCol + 1, 10),
    };
  }

  const lines = content.split('\n').filter(line => line.trim());
  const cells: { [key: string]: CellData } = {};
  let maxCol = 0;

  lines.forEach((line, rowIndex) => {
    const values = line.split(/[,\t]/).map(v => v.trim());
    values.forEach((value, colIndex) => {
      if (value) {
        cells[getCellKey(rowIndex, colIndex)] = { value };
        maxCol = Math.max(maxCol, colIndex);
      }
    });
  });

  return {
    cells,
    rowCount: Math.max(lines.length, 20),
    colCount: Math.max(maxCol + 1, 10),
  };
};

const parseContent = (content: string): WorkbookData => {
  try {
    const parsed = JSON.parse(content);
    if (parsed.sheets && Array.isArray(parsed.sheets)) {
      return {
        sheets: parsed.sheets.map((sheet: SheetData) => ({
          ...sheet,
          columnWidths: sheet.columnWidths || {},
          rowHeights: sheet.rowHeights || {},
          charts: sheet.charts || [],
          conditionalFormats: sheet.conditionalFormats || [],
          frozenRows: sheet.frozenRows,
          frozenColumns: sheet.frozenColumns,
          hiddenRows: sheet.hiddenRows || [],
          hiddenColumns: sheet.hiddenColumns || [],
        })),
        activeSheetId: parsed.activeSheetId
      } as WorkbookData;
    }
    if (parsed.cells && typeof parsed.rowCount === 'number') {
      return {
        sheets: [{ id: 'sheet1', name: 'Hoja 1', data: parsed, columnWidths: {}, rowHeights: {}, charts: [], conditionalFormats: [], hiddenRows: [], hiddenColumns: [] }],
        activeSheetId: 'sheet1'
      };
    }
  } catch { }

  const sheetData = parseSheetData(content);
  return {
    sheets: [{ id: 'sheet1', name: 'Hoja 1', data: sheetData, columnWidths: {}, rowHeights: {}, charts: [], conditionalFormats: [], hiddenRows: [], hiddenColumns: [] }],
    activeSheetId: 'sheet1'
  };
};

const convertToSparseGrid = (data: SpreadsheetData): SparseGrid => {
  const grid = new SparseGrid();
  Object.entries(data.cells).forEach(([key, cellData]) => {
    const parts = key.split('-');
    if (parts.length !== 2) {
      console.warn(`Invalid cell key format: ${key}`);
      return;
    }
    const [row, col] = parts.map(Number);
    if (isNaN(row) || isNaN(col)) {
      console.warn(`Invalid cell coordinates in key: ${key}`);
      return;
    }
    try {
      grid.setCell(row, col, {
        value: cellData.value,
        formula: cellData.formula,
        bold: cellData.bold,
        italic: cellData.italic,
        underline: cellData.underline,
        strikethrough: cellData.strikethrough,
        align: cellData.align,
        verticalAlign: cellData.verticalAlign,
        indent: cellData.indent,
        fontFamily: cellData.fontFamily,
        fontSize: cellData.fontSize,
        color: cellData.color,
        backgroundColor: cellData.backgroundColor,
        numberFormat: cellData.numberFormat,
        borders: cellData.borders,
      });
    } catch (e) {
      console.warn(`Failed to set cell at ${key}:`, e);
    }
  });
  return grid;
};

const convertFromSparseGrid = (grid: SparseGrid): SpreadsheetData => {
  const cells: { [key: string]: CellData } = {};
  let maxRow = 0;
  let maxCol = 0;

  try {
    const allCells = grid.getAllCells();
    allCells.forEach(({ row, col, data }) => {
      if (typeof row !== 'number' || typeof col !== 'number' || isNaN(row) || isNaN(col)) {
        console.warn(`Invalid cell coordinates: row=${row}, col=${col}`);
        return;
      }
      if (!data) {
        console.warn(`Undefined cell data at row=${row}, col=${col}`);
        return;
      }
      cells[getCellKey(row, col)] = {
        value: data.value || '',
        formula: data.formula,
        bold: data.bold,
        italic: data.italic,
        underline: data.underline,
        strikethrough: data.strikethrough,
        align: data.align,
        verticalAlign: data.verticalAlign,
        indent: data.indent,
        fontFamily: data.fontFamily,
        fontSize: data.fontSize,
        color: data.color,
        backgroundColor: data.backgroundColor,
        numberFormat: data.numberFormat,
        borders: data.borders,
      };
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
    });
  } catch (e) {
    console.error('Failed to convert from sparse grid:', e);
  }

  return {
    cells,
    rowCount: Math.max(maxRow + 1, 20),
    colCount: Math.max(maxCol + 1, 10),
  };
};

export function SpreadsheetEditor({
  title,
  content,
  onChange,
  onClose,
  onDownload,
  onInsertContent,
  onOrchestratorReady,
}: SpreadsheetEditorProps) {
  const [workbook, setWorkbook] = useState<WorkbookData>(() => parseContent(content));
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ start: string; end: string } | null>(null);
  const [showChart, setShowChart] = useState(false);
  const [chartType, setChartType] = useState<'bar' | 'line' | 'pie'>('bar');
  const [useVirtualized, setUseVirtualized] = useState(true);
  const [sparseGrid, setSparseGrid] = useState<SparseGrid>(() => new SparseGrid());
  const [gridVersion, setGridVersion] = useState(0);
  const [virtualSelectedCell, setVirtualSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [virtualEditingCell, setVirtualEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [virtualSelectionRange, setVirtualSelectionRange] = useState<{ startRow: number; startCol: number; endRow: number; endCol: number } | null>(null);
  const [mergedCells, setMergedCells] = useState<Set<string>>(new Set());
  const [wrapText, setWrapTextEnabled] = useState(false);
  const [showAIPrompt, setShowAIPrompt] = useState(false);
  const [aiPrompt, setAIPrompt] = useState('');
  const [orchestratorProgress, setOrchestratorProgress] = useState<{ current: number; total: number; task: string } | null>(null);
  const [showAICommandBar, setShowAICommandBar] = useState(true);
  const [aiCommand, setAICommand] = useState('');
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<{ [category: string]: Array<{ id: string; name: string; sheets: number; }> }>({});
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const aiCommandRef = useRef<HTMLInputElement>(null);
  const aiSuggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formulaInputRef = useRef<HTMLInputElement>(null);
  const initialContentRef = useRef(content);
  const insertFnRegisteredRef = useRef(false);

  const streaming = useExcelStreaming(sparseGrid);
  const { STREAM_STATUS } = streaming;

  const undoRedo = useExcelUndoRedo(sparseGrid, (newGrid) => {
    setSparseGrid(newGrid);
    setGridVersion(v => v + 1);
  });

  const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  // Get active sheet data
  const activeSheet = workbook.sheets.find(s => s.id === workbook.activeSheetId) || workbook.sheets[0];

  // State for column widths and row heights (synced with active sheet)
  const [columnWidths, setColumnWidths] = useState<{ [col: number]: number }>(
    activeSheet?.columnWidths || {}
  );
  const [rowHeights, setRowHeights] = useState<{ [row: number]: number }>(
    activeSheet?.rowHeights || {}
  );

  // Sync columnWidths/rowHeights when active sheet changes
  useEffect(() => {
    setColumnWidths(activeSheet?.columnWidths || {});
    setRowHeights(activeSheet?.rowHeights || {});
  }, [workbook.activeSheetId, activeSheet?.columnWidths, activeSheet?.rowHeights]);

  // Update workbook when columnWidths or rowHeights change
  useEffect(() => {
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(sheet =>
        sheet.id === prev.activeSheetId
          ? { ...sheet, columnWidths, rowHeights }
          : sheet
      )
    }));
  }, [columnWidths, rowHeights]);

  // Functions to update column widths and row heights
  const setColumnWidth = useCallback((col: number, width: number) => {
    setColumnWidths(prev => ({ ...prev, [col]: width }));
  }, []);

  const setRowHeight = useCallback((row: number, height: number) => {
    setRowHeights(prev => ({ ...prev, [row]: height }));
  }, []);
  const data = activeSheet?.data || { cells: {}, rowCount: 20, colCount: 10 };

  const getCellValue = useCallback((row: number, col: number): string | number => {
    const cell = sparseGrid.getCell(row, col);
    if (!cell) return '';
    return cell.value;
  }, [sparseGrid, gridVersion]);

  useEffect(() => {
    if (activeSheet?.data) {
      const grid = convertToSparseGrid(activeSheet.data);
      setSparseGrid(grid);
    }
  }, [workbook.activeSheetId]);

  // Extract chart data from spreadsheet
  const chartData = useMemo(() => {
    const result: Array<{ name: string; value: number;[key: string]: string | number }> = [];
    const headers: string[] = [];

    // Get headers from first row
    for (let c = 0; c < data.colCount; c++) {
      const cell = data.cells[getCellKey(0, c)];
      if (cell?.value) {
        headers[c] = cell.value;
      }
    }

    // Get data rows
    for (let r = 1; r < data.rowCount; r++) {
      const labelCell = data.cells[getCellKey(r, 0)];
      if (!labelCell?.value) continue;

      const row: { name: string; value: number;[key: string]: string | number } = {
        name: labelCell.value,
        value: 0
      };

      let hasNumericData = false;
      for (let c = 1; c < data.colCount; c++) {
        const cell = data.cells[getCellKey(r, c)];
        if (cell?.value) {
          const numVal = parseFloat(cell.value.replace(/[^\d.-]/g, ''));
          if (!isNaN(numVal)) {
            const key = headers[c] || `col${c}`;
            row[key] = numVal;
            if (c === 1) row.value = numVal;
            hasNumericData = true;
          }
        }
      }

      if (hasNumericData) {
        result.push(row);
      }
    }

    return { data: result, headers: headers.filter((h, i) => i > 0 && h) };
  }, [data.cells, data.rowCount, data.colCount]);

  // Update active sheet data helper
  const setData = useCallback((updater: (prev: SpreadsheetData) => SpreadsheetData) => {
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(sheet =>
        sheet.id === prev.activeSheetId
          ? { ...sheet, data: updater(sheet.data) }
          : sheet
      )
    }));
  }, []);

  const handleSparseGridChange = useCallback((updatedGrid: SparseGrid) => {
    setGridVersion(v => v + 1);
    setSparseGrid(updatedGrid);
    const newData = convertFromSparseGrid(updatedGrid);
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(sheet =>
        sheet.id === prev.activeSheetId
          ? { ...sheet, data: newData }
          : sheet
      )
    }));
  }, []);

  const handleUpdateChart = useCallback((chartId: string, updates: Partial<ChartLayerConfig>) => {
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(sheet =>
        sheet.id === prev.activeSheetId
          ? {
            ...sheet,
            charts: (sheet.charts || []).map(chart =>
              chart.id === chartId ? { ...chart, ...updates } : chart
            )
          }
          : sheet
      )
    }));
  }, []);

  const handleDeleteChart = useCallback((chartId: string) => {
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(sheet =>
        sheet.id === prev.activeSheetId
          ? {
            ...sheet,
            charts: (sheet.charts || []).filter(chart => chart.id !== chartId)
          }
          : sheet
      )
    }));
  }, []);

  const handleInsertChart = useCallback((chartType: ChartLayerConfig['type']) => {
    if (!virtualSelectedCell) return;

    const title = `Gráfico de ${chartType === 'bar' ? 'Barras' : chartType === 'line' ? 'Líneas' : chartType === 'pie' ? 'Circular' : 'Área'}`;
    const newChart = createChartFromSelection(
      chartType,
      title,
      {
        startRow: Math.max(0, virtualSelectedCell.row - 5),
        endRow: virtualSelectedCell.row,
        startCol: Math.max(0, virtualSelectedCell.col - 1),
        endCol: virtualSelectedCell.col
      }
    );

    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(sheet =>
        sheet.id === prev.activeSheetId
          ? { ...sheet, charts: [...(sheet.charts || []), newChart] }
          : sheet
      )
    }));
  }, [virtualSelectedCell]);

  useEffect(() => {
    streaming.setOnGridChange(handleSparseGridChange);
  }, [handleSparseGridChange]);

  const handleAIGenerate = useCallback(async () => {
    console.log('[AI Generate] Called with prompt:', aiPrompt);
    if (!aiPrompt.trim()) return;
    setShowAIPrompt(false);

    const lowerPrompt = aiPrompt.toLowerCase();

    // Detect complex prompts that need orchestration (includes chart requests)
    const isComplexPrompt = /completo|análisis|análisis completo|4 hojas|gráficos?|gráfica|grafica|gr[aá]fico de barras|gr[aá]fico de lineas|gr[aá]fico de pastel|charts?|bar chart|line chart|pie chart|dashboard|resumen|fórmulas múltiples|crea.*gr[aá]fic|genera.*gr[aá]fic/i.test(lowerPrompt);

    if (isComplexPrompt) {
      // Use the AI Orchestrator for complex multi-sheet workbooks
      const streamingHook = {
        queueCell: (row: number, col: number, value: string, delay?: number) => {
          streaming.queueCell(row, col, String(value), delay);
        },
        processStreamQueue: () => streaming.processStreamQueue()
      };

      // Convert current workbook to orchestrator format
      const orchestratorWorkbook = {
        sheets: workbook.sheets.map(sheet => ({
          id: sheet.id,
          name: sheet.name,
          grid: convertToSparseGrid(sheet.data),
          charts: sheet.charts || [],
          conditionalFormats: sheet.conditionalFormats || []
        })),
        activeSheetId: workbook.activeSheetId
      } as unknown as OrchestratorWorkbook;

      const orchestrator = new ExcelOrchestrator(
        orchestratorWorkbook,
        (updater) => {
          setWorkbook(prev => {
            const updated = updater({
              sheets: prev.sheets.map(sheet => ({
                id: sheet.id,
                name: sheet.name,
                grid: convertToSparseGrid(sheet.data),
                charts: sheet.charts || [],
                conditionalFormats: sheet.conditionalFormats || []
              })),
              activeSheetId: prev.activeSheetId
            } as unknown as OrchestratorWorkbook);

            return {
              ...prev,
              sheets: updated.sheets.map(sheet => ({
                ...sheet,
                data: convertFromSparseGrid(sheet.grid),
                charts: sheet.charts,
                conditionalFormats: sheet.conditionalFormats
              }))
            };
          });
        },
        streamingHook
      );

      try {
        await orchestrator.analyzeAndPlan(aiPrompt);
        await orchestrator.executePlan((progress) => {
          setOrchestratorProgress({
            current: progress.current,
            total: progress.total,
            task: progress.task
          });
        });
        setOrchestratorProgress(null);
        setGridVersion(v => v + 1);
      } catch (err) {
        console.error('[Orchestrator] Error:', err);
        setOrchestratorProgress(null);
      }

      setAIPrompt('');
      return;
    }

    // Simple data generation for non-complex prompts
    let sampleData: (string | number | null)[][];

    if (lowerPrompt.includes('ventas') || lowerPrompt.includes('sales')) {
      sampleData = [
        ['Mes', 'Producto', 'Cantidad', 'Precio', 'Total'],
        ['Enero', 'Laptop', 15, 1200, '=C2*D2'],
        ['Febrero', 'Mouse', 45, 25, '=C3*D3'],
        ['Marzo', 'Teclado', 30, 75, '=C4*D4'],
        ['Abril', 'Monitor', 12, 350, '=C5*D5'],
        ['Mayo', 'Laptop', 20, 1200, '=C6*D6'],
        ['Junio', 'Mouse', 60, 25, '=C7*D7'],
        ['', '', '', 'TOTAL:', '=SUM(E2:E7)'],
      ];
    } else if (lowerPrompt.includes('empleados') || lowerPrompt.includes('nómina')) {
      sampleData = [
        ['ID', 'Nombre', 'Departamento', 'Salario', 'Bono', 'Total'],
        ['001', 'Juan Pérez', 'Ventas', 3500, 500, '=D2+E2'],
        ['002', 'María García', 'Marketing', 3200, 400, '=D3+E3'],
        ['003', 'Carlos López', 'IT', 4500, 700, '=D4+E4'],
        ['004', 'Ana Martínez', 'RRHH', 3000, 350, '=D5+E5'],
        ['', '', '', '', 'TOTAL:', '=SUM(F2:F5)'],
      ];
    } else {
      sampleData = [
        ['Dato 1', 'Dato 2', 'Resultado'],
        ['Valor A', 100, '=B2*2'],
        ['Valor B', 200, '=B3*2'],
        ['Valor C', 300, '=B4*2'],
        ['', 'Total:', '=SUM(C2:C4)'],
      ];
    }

    const startRow = virtualSelectedCell?.row || 0;
    const startCol = virtualSelectedCell?.col || 0;
    console.log('[AI Generate] Starting streaming at', startRow, startCol);

    try {
      await streaming.simulateStreaming(sampleData, startRow, startCol);
      console.log('[AI Generate] Streaming completed');
    } catch (err) {
      console.error('[AI Generate] Error:', err);
    }
    setAIPrompt('');
  }, [aiPrompt, virtualSelectedCell, streaming, workbook]);

  const runOrchestrator = useCallback(async (prompt: string) => {
    const streamingHook = {
      queueCell: (row: number, col: number, value: string, delay?: number) => {
        streaming.queueCell(row, col, String(value), delay);
      },
      processStreamQueue: () => streaming.processStreamQueue()
    };

    const orchestratorWorkbook = {
      sheets: workbook.sheets.map(sheet => ({
        id: sheet.id,
        name: sheet.name,
        grid: convertToSparseGrid(sheet.data),
        charts: sheet.charts || [],
        conditionalFormats: sheet.conditionalFormats || []
      })),
      activeSheetId: workbook.activeSheetId
    } as unknown as OrchestratorWorkbook;

    const orchestrator = new ExcelOrchestrator(
      orchestratorWorkbook,
      (updater) => {
        setWorkbook(prev => {
          const updated = updater({
            sheets: prev.sheets.map(sheet => ({
              id: sheet.id,
              name: sheet.name,
              grid: convertToSparseGrid(sheet.data),
              charts: sheet.charts || [],
              conditionalFormats: sheet.conditionalFormats || []
            })),
            activeSheetId: prev.activeSheetId
          } as unknown as OrchestratorWorkbook);

          console.log('[Orchestrator] Updated sheets:', updated.sheets.map(s => ({ name: s.name, chartsCount: s.charts?.length || 0 })));

          const newWorkbook = {
            ...prev,
            sheets: updated.sheets.map(sheet => ({
              id: sheet.id,
              name: sheet.name,
              data: convertFromSparseGrid(sheet.grid),
              charts: sheet.charts as ChartLayerConfig[],
              conditionalFormats: sheet.conditionalFormats
            })),
            activeSheetId: updated.activeSheetId
          };

          console.log('[Orchestrator] New workbook sheets:', newWorkbook.sheets.map(s => ({ name: s.name, chartsCount: s.charts?.length || 0 })));

          return newWorkbook;
        });
      },
      streamingHook
    );

    try {
      console.log('[Orchestrator] Analyzing prompt:', prompt);
      await orchestrator.analyzeAndPlan(prompt);
      await orchestrator.executePlan((progress) => {
        setOrchestratorProgress({
          current: progress.current,
          total: progress.total,
          task: progress.task
        });
      });
      setOrchestratorProgress(null);
      setGridVersion(v => v + 1);
      console.log('[Orchestrator] Complete');
    } catch (err) {
      console.error('[Orchestrator] Error:', err);
      setOrchestratorProgress(null);
    }
  }, [streaming, workbook]);

  useEffect(() => {
    if (onOrchestratorReady) {
      onOrchestratorReady({ runOrchestrator });
    }
  }, [onOrchestratorReady, runOrchestrator]);

  // AI Command Bar suggestions
  const aiSuggestions = useMemo(() => [
    { icon: Table, text: 'Llena con nombres de ciudades', type: 'fill' },
    { icon: Calculator, text: 'Calcula el total de esta columna', type: 'formula' },
    { icon: BarChart3, text: 'Genera datos de ventas mensuales', type: 'generate' },
    { icon: Wand2, text: 'Formatea como tabla', type: 'format' },
    { icon: CheckCircle2, text: 'Completa los datos faltantes', type: 'complete' },
    { icon: Table, text: 'Genera tabla de inventario', type: 'generate' },
    { icon: FileSpreadsheet, text: 'Llena con fechas secuenciales', type: 'fill' },
    { icon: Calculator, text: 'Calcula promedio del rango', type: 'formula' }
  ], []);

  // Handle AI Command submission
  const handleAICommand = useCallback(async (command: string) => {
    if (!command.trim() || isAIProcessing) return;

    setIsAIProcessing(true);
    setShowAISuggestions(false);

    const startRow = virtualSelectedCell?.row || 0;
    const startCol = virtualSelectedCell?.col || 0;
    const rowCount = 6;
    const colCount = 5;

    try {
      const response = await fetch('/api/ai/excel-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          type: 'custom',
          range: { startRow, startCol, endRow: startRow + rowCount - 1, endCol: startCol + colCount - 1 }
        })
      });

      if (!response.ok) throw new Error('AI command failed');

      const result = await response.json();

      if (result.columnData && Array.isArray(result.columnData)) {
        const data = result.columnData.map((v: string) => [v]);
        await streaming.simulateStreaming(data, startRow, startCol);
      } else if (result.rangeData && Array.isArray(result.rangeData)) {
        await streaming.simulateStreaming(result.rangeData, startRow, startCol);
      } else if (result.cell) {
        sparseGrid.setCell(startRow, startCol, { value: result.cell });
        setGridVersion(v => v + 1);
      }

      setAICommand('');
    } catch (error) {
      console.error('AI command error:', error);
    } finally {
      setIsAIProcessing(false);
    }
  }, [virtualSelectedCell, streaming, sparseGrid, isAIProcessing]);

  // Load templates
  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const response = await fetch('/api/admin/excel/templates');
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || {});
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  // Apply template
  const applyTemplate = useCallback(async (templateId: string) => {
    try {
      const response = await fetch(`/api/admin/excel/${templateId}`);
      if (response.ok) {
        const templateDoc = await response.json();
        if (templateDoc.sheets && templateDoc.sheets.length > 0) {
          const templateSheet = templateDoc.sheets[0];
          const templateData = templateSheet.data;

          if (Array.isArray(templateData)) {
            await streaming.simulateStreaming(templateData, 0, 0);
          }
        }
        setShowTemplates(false);
      }
    } catch (error) {
      console.error('Failed to apply template:', error);
    }
  }, [streaming]);

  // Close suggestions on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (aiSuggestionsRef.current && !aiSuggestionsRef.current.contains(e.target as Node) &&
        aiCommandRef.current && !aiCommandRef.current.contains(e.target as Node)) {
        setShowAISuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sheet management functions
  const addSheet = useCallback(() => {
    const newId = `sheet${Date.now()}`;
    const sheetNum = workbook.sheets.length + 1;
    setWorkbook(prev => ({
      ...prev,
      sheets: [...prev.sheets, createEmptySheet(newId, `Hoja ${sheetNum}`)],
      activeSheetId: newId
    }));
  }, [workbook.sheets.length]);

  const switchSheet = useCallback((sheetId: string) => {
    setWorkbook(prev => {
      const newWorkbook = { ...prev, activeSheetId: sheetId };
      const targetSheet = newWorkbook.sheets.find(s => s.id === sheetId);
      if (targetSheet?.chartConfig?.visible) {
        setShowChart(true);
        setChartType(targetSheet.chartConfig.type);
      } else {
        setShowChart(false);
      }
      return newWorkbook;
    });
    setSelectedCell(null);
    setEditingCell(null);
  }, []);

  const renameSheet = useCallback((sheetId: string, newName: string) => {
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(s => s.id === sheetId ? { ...s, name: newName } : s)
    }));
  }, []);

  const deleteSheet = useCallback((sheetId: string) => {
    if (workbook.sheets.length <= 1) return;
    setWorkbook(prev => {
      const newSheets = prev.sheets.filter(s => s.id !== sheetId);
      const newActiveId = prev.activeSheetId === sheetId ? newSheets[0].id : prev.activeSheetId;
      return { sheets: newSheets, activeSheetId: newActiveId };
    });
  }, [workbook.sheets.length]);

  useEffect(() => {
    if (content !== initialContentRef.current && content) {
      const newWorkbook = parseContent(content);
      setWorkbook(newWorkbook);
      initialContentRef.current = content;
    }
  }, [content]);

  const dataToHtml = useCallback((spreadsheetData: SpreadsheetData): string => {
    let html = '<table border="1" style="border-collapse: collapse; width: 100%;">';
    html += '<thead><tr>';
    for (let c = 0; c < spreadsheetData.colCount; c++) {
      html += `<th style="padding: 8px; background: #f0f0f0; font-weight: bold;">${getColumnLabel(c)}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let r = 0; r < spreadsheetData.rowCount; r++) {
      html += '<tr>';
      for (let c = 0; c < spreadsheetData.colCount; c++) {
        const cell = spreadsheetData.cells[getCellKey(r, c)] || { value: '' };
        const style = [
          'padding: 6px',
          cell.bold ? 'font-weight: bold' : '',
          cell.italic ? 'font-style: italic' : '',
          cell.align ? `text-align: ${cell.align}` : ''
        ].filter(Boolean).join('; ');
        html += `<td style="${style}">${cell.value}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }, []);

  // Serialize workbook to JSON for storage
  useEffect(() => {
    const workbookJson = JSON.stringify(workbook);
    onChange(workbookJson);
  }, [workbook, onChange]);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  const insertContentFn = useCallback(async (text: string) => {
    console.log('[insertContentFn] Called with text length:', text.length);

    // Clean markdown from text
    const cleanMarkdown = (str: string) => str
      .replace(/^\*\*[^*]+\*\*\s*/gm, '')
      .replace(/^-\s+\*\*([^*]+)\*\*:\s*/gm, '$1,')
      .replace(/^\s*-\s+/gm, '')
      .replace(/\[GRAFICO:[^\]]+\]/g, '')
      .trim();

    // Parse GRAFICO command from content
    const parseGraficoCommand = (content: string): ChartConfig | null => {
      const graficoMatch = content.match(/\[GRAFICO:(barras|lineas|pastel)\]/i);
      if (!graficoMatch) return null;
      const tipoMap: { [k: string]: 'bar' | 'line' | 'pie' } = {
        'barras': 'bar',
        'lineas': 'line',
        'pastel': 'pie'
      };
      return {
        type: tipoMap[graficoMatch[1].toLowerCase()] || 'bar',
        visible: true
      };
    };

    // Convert lines to 2D array for streaming
    const linesToMatrix = (lines: string[]): (string | number | null)[][] => {
      return lines.map(line => {
        const values = line.split(/[,\t]/).map(v => v.trim());
        return values.map(v => {
          if (!v) return null;
          const num = Number(v);
          return isNaN(num) ? v : num;
        });
      });
    };

    // Parse lines and insert into a sheet, handling formulas (non-streaming fallback)
    const insertLines = (lines: string[], sheetData: SpreadsheetData): SpreadsheetData => {
      const newCells = { ...sheetData.cells };
      let maxColInserted = 0;

      let startRow = 0;
      for (let r = 0; r < sheetData.rowCount; r++) {
        let rowHasData = false;
        for (let c = 0; c < sheetData.colCount; c++) {
          if (sheetData.cells[getCellKey(r, c)]?.value) {
            rowHasData = true;
            break;
          }
        }
        if (!rowHasData) {
          startRow = r;
          break;
        }
        startRow = r + 1;
      }

      lines.forEach((line, rowOffset) => {
        const values = line.split(/[,\t]/).map(v => v.trim());
        values.forEach((value, colOffset) => {
          if (value) {
            const key = getCellKey(startRow + rowOffset, colOffset);
            if (value.startsWith('=')) {
              newCells[key] = { value: value, formula: value };
            } else {
              newCells[key] = { value };
            }
            maxColInserted = Math.max(maxColInserted, colOffset);
          }
        });
      });

      // Evaluate formulas after all cells are inserted
      Object.keys(newCells).forEach(key => {
        const cell = newCells[key];
        if (cell.formula && cell.formula.startsWith('=')) {
          cell.value = evaluateFormula(cell.formula, newCells);
        }
      });

      return {
        ...sheetData,
        cells: newCells,
        rowCount: Math.max(sheetData.rowCount, startRow + lines.length + 1),
        colCount: Math.max(sheetData.colCount, maxColInserted + 1)
      };
    };

    // Check for chart command in text
    const chartConfig = parseGraficoCommand(text);

    // Check if there are sheet commands
    const hasSheetCommands = /\[(NUEVA_HOJA|HOJA):/.test(text);

    // If no sheet commands, insert into active sheet with streaming
    if (!hasSheetCommands) {
      const cleanText = cleanMarkdown(text);
      const lines = cleanText.split('\n').filter(line => line.trim());
      if (lines.length === 0 && !chartConfig) return;

      if (lines.length > 0 && useVirtualized) {
        // Find the first empty row in the sparse grid
        let startRow = 0;
        for (let r = 0; r < 1000; r++) {
          let rowHasData = false;
          for (let c = 0; c < 26; c++) {
            const cell = sparseGrid.getCell(r, c);
            if (cell.value) {
              rowHasData = true;
              break;
            }
          }
          if (!rowHasData) {
            startRow = r;
            break;
          }
          startRow = r + 1;
        }

        // Use streaming for virtualized mode
        const matrix = linesToMatrix(lines);
        console.log('[insertContentFn] Streaming', matrix.length, 'rows to active sheet starting at row', startRow);
        await streaming.simulateStreaming(matrix, startRow, 0);
      } else if (lines.length > 0) {
        setData(prev => insertLines(lines, prev));
      }

      // Apply chart config to active sheet
      if (chartConfig) {
        setWorkbook(prev => ({
          ...prev,
          sheets: prev.sheets.map(s =>
            s.id === prev.activeSheetId
              ? { ...s, chartConfig }
              : s
          )
        }));
        setShowChart(true);
        setChartType(chartConfig.type);
      }
      return;
    }

    // Parse sheet commands and their content using regex.exec
    const sheetCommandPattern = /\[(NUEVA_HOJA|HOJA):([^\]]+)\]/g;
    const commands: { type: string; name: string; startIndex: number; endIndex: number }[] = [];
    let match;

    while ((match = sheetCommandPattern.exec(text)) !== null) {
      commands.push({
        type: match[1],
        name: match[2].trim(),
        startIndex: match.index,
        endIndex: match.index + match[0].length
      });
    }

    // Pre-calculate chart configs for each command section
    const commandChartConfigs: (ChartConfig | null)[] = commands.map((cmd, idx) => {
      const contentStart = cmd.endIndex;
      const contentEnd = idx < commands.length - 1 ? commands[idx + 1].startIndex : text.length;
      const content = text.substring(contentStart, contentEnd);
      return parseGraficoCommand(content);
    });

    // Find the last chart config for showing after update
    let finalChartConfig: ChartConfig | null = null;
    for (let i = commandChartConfigs.length - 1; i >= 0; i--) {
      if (commandChartConfigs[i]) {
        finalChartConfig = commandChartConfigs[i];
        break;
      }
    }

    // Pre-calculate the last sheet's data for streaming
    let lastSheetLines: string[] = [];
    if (useVirtualized && commands.length > 0) {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.type === 'NUEVA_HOJA') {
        const contentStart = lastCmd.endIndex;
        const contentEnd = text.length;
        const content = text.substring(contentStart, contentEnd);
        const cleanedText = cleanMarkdown(content);
        lastSheetLines = cleanedText.split('\n').filter(line => line.trim());
      }
    }

    // Process multiple sheets
    setWorkbook(prev => {
      const newSheets: SheetData[] = prev.sheets.map(s => ({ ...s, data: { ...s.data, cells: { ...s.data.cells } } }));
      let newWorkbook: WorkbookData = { ...prev, sheets: newSheets };
      let lastSheetId = prev.activeSheetId;

      commands.forEach((cmd, idx) => {
        const contentStart = cmd.endIndex;
        const contentEnd = idx < commands.length - 1 ? commands[idx + 1].startIndex : text.length;
        const content = text.substring(contentStart, contentEnd);
        const sectionChartConfig = commandChartConfigs[idx];

        const cleanedText = cleanMarkdown(content);
        const lines = cleanedText.split('\n').filter(line => line.trim());

        if (cmd.type === 'NUEVA_HOJA') {
          const newId = `sheet${Date.now()}_${idx}`;
          const newSheet = createEmptySheet(newId, cmd.name);

          // For virtualized mode, we'll stream the last sheet - skip direct insert
          const isLastCommand = idx === commands.length - 1;
          if (!(useVirtualized && isLastCommand && lines.length > 0)) {
            if (lines.length > 0) {
              newSheet.data = insertLines(lines, newSheet.data);
            }
          }

          if (sectionChartConfig) {
            newSheet.chartConfig = sectionChartConfig;
          }

          newWorkbook.sheets.push(newSheet);
          lastSheetId = newId;
        } else if (cmd.type === 'HOJA') {
          const targetSheet = newWorkbook.sheets.find(s => s.name.toLowerCase() === cmd.name.toLowerCase());
          if (targetSheet) {
            const sheetIndex = newWorkbook.sheets.findIndex(s => s.id === targetSheet.id);
            if (sheetIndex >= 0) {
              if (lines.length > 0) {
                newWorkbook.sheets[sheetIndex].data = insertLines(lines, newWorkbook.sheets[sheetIndex].data);
              }
              if (sectionChartConfig) {
                newWorkbook.sheets[sheetIndex].chartConfig = sectionChartConfig;
              }
            }
            lastSheetId = targetSheet.id;
          }
        }
      });

      newWorkbook.activeSheetId = lastSheetId;
      return newWorkbook;
    });

    // Stream the last sheet's data if we're in virtualized mode
    if (useVirtualized && lastSheetLines.length > 0) {
      // Wait for React to update the workbook state
      await new Promise(resolve => setTimeout(resolve, 200));

      // Create a fresh sparse grid for the new sheet
      const newGrid = new SparseGrid();
      setSparseGrid(newGrid);
      setGridVersion(v => v + 1);

      // Update the streaming hook's grid reference
      streaming.setGrid(newGrid);

      // Wait for state update
      await new Promise(resolve => setTimeout(resolve, 50));

      const matrix = linesToMatrix(lastSheetLines);
      console.log('[insertContentFn] Streaming', matrix.length, 'rows to new sheet');
      await streaming.simulateStreaming(matrix, 0, 0);
    }

    // Show chart if any sheet had chart config
    if (finalChartConfig) {
      setShowChart(true);
      setChartType(finalChartConfig.type);
    }
  }, [setData, useVirtualized, streaming]);

  useEffect(() => {
    if (onInsertContent && !insertFnRegisteredRef.current) {
      onInsertContent(insertContentFn);
      insertFnRegisteredRef.current = true;
    }
  }, [onInsertContent, insertContentFn]);

  const updateCell = useCallback((key: string, updates: Partial<CellData>, skipUndo = false) => {
    try {
      const [row, col] = key.split('-').map(Number);
      if (isNaN(row) || isNaN(col)) return;

      // Update the data state
      setData(prev => ({
        ...prev,
        cells: {
          ...prev.cells,
          [key]: { ...prev.cells[key], value: '', ...updates },
        },
      }));

      // Also update sparse grid for virtualized view
      sparseGrid.setCell(row, col, {
        value: updates.value ?? '',
        formula: updates.formula,
        bold: updates.bold,
        italic: updates.italic,
        underline: updates.underline,
        align: updates.align,
        fontFamily: updates.fontFamily,
        fontSize: updates.fontSize,
        color: updates.color,
        backgroundColor: updates.backgroundColor,
        numberFormat: updates.numberFormat,
      });
      setGridVersion(v => v + 1);

    } catch (e) {
      console.error('Failed to update cell:', e);
    }
  }, [sparseGrid]);

  const handleCellClick = useCallback((key: string) => {
    setSelectedCell(key);
    setSelectionRange(null);
  }, []);

  const handleCellDoubleClick = useCallback((key: string) => {
    setEditingCell(key);
    setSelectedCell(key);
  }, []);

  const handleCellChange = useCallback((key: string, value: string) => {
    if (value.startsWith('=')) {
      const computedValue = evaluateFormula(value, data.cells);
      updateCell(key, { value: computedValue, formula: value });
    } else {
      updateCell(key, { value, formula: undefined });
    }
  }, [updateCell, data.cells]);

  const handleCellBlur = useCallback(() => {
    setEditingCell(null);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, key: string) => {
    const [row, col] = key.split('-').map(Number);

    if (e.key === 'Enter') {
      e.preventDefault();
      setEditingCell(null);
      const nextKey = getCellKey(row + 1, col);
      setSelectedCell(nextKey);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setEditingCell(null);
      const nextKey = getCellKey(row, col + 1);
      setSelectedCell(nextKey);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }, []);

  // Helper to get the active cell (virtualized or legacy mode)
  const getActiveCell = useCallback(() => {
    if (useVirtualized && virtualSelectedCell) {
      return { row: virtualSelectedCell.row, col: virtualSelectedCell.col, key: getCellKey(virtualSelectedCell.row, virtualSelectedCell.col) };
    } else if (selectedCell) {
      const parts = selectedCell.split('-');
      return { row: parseInt(parts[0]), col: parseInt(parts[1]), key: selectedCell };
    }
    return null;
  }, [useVirtualized, virtualSelectedCell, selectedCell]);

  const handleNavigationKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Handle Ctrl+Z (Undo) and Ctrl+Y (Redo) globally
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (undoRedo.canUndo) {
        undoRedo.undo();
        toast.success('Deshacer', { description: 'Cambio revertido', duration: 1500 });
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      if (undoRedo.canRedo) {
        undoRedo.redo();
        toast.success('Rehacer', { description: 'Cambio restaurado', duration: 1500 });
      }
      return;
    }
    // Handle Ctrl+C (Copy) with toast feedback
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      const active = getActiveCell();
      if (active) {
        if (useVirtualized) {
          const cell = sparseGrid.getCell(active.row, active.col);
          if (cell?.value) {
            navigator.clipboard.writeText(String(cell.value));
            const cellRef = colToName(active.col + 1) + (active.row + 1);
            toast.success('Copiado', {
              description: `Celda ${cellRef} copiada`,
              duration: 2000,
              icon: <Copy className="h-4 w-4" />
            });
          }
        } else if (data.cells[active.key]?.value) {
          navigator.clipboard.writeText(data.cells[active.key].value);
          toast.success('Copiado', {
            description: 'Contenido copiado',
            duration: 2000,
            icon: <Copy className="h-4 w-4" />
          });
        }
      }
      return;
    }
    // Handle Ctrl+X (Cut) with toast feedback
    if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
      e.preventDefault();
      const active = getActiveCell();
      if (active) {
        if (useVirtualized) {
          const cell = sparseGrid.getCell(active.row, active.col);
          if (cell?.value) {
            navigator.clipboard.writeText(String(cell.value));
            sparseGrid.setCell(active.row, active.col, { ...cell, value: '' });
            setGridVersion(v => v + 1);
            const cellRef = colToName(active.col + 1) + (active.row + 1);
            toast.success('Cortado', {
              description: `Celda ${cellRef} cortada`,
              duration: 2000,
              icon: <Scissors className="h-4 w-4" />
            });
          }
        } else if (data.cells[active.key]?.value) {
          navigator.clipboard.writeText(data.cells[active.key].value);
          updateCell(active.key, { ...data.cells[active.key], value: '' });
          toast.success('Cortado', {
            description: 'Contenido cortado',
            duration: 2000,
            icon: <Scissors className="h-4 w-4" />
          });
        }
      }
      return;
    }

    if (!selectedCell || editingCell) return;

    const [row, col] = selectedCell.split('-').map(Number);
    let newRow = row;
    let newCol = col;

    switch (e.key) {
      case 'ArrowUp':
        newRow = Math.max(0, row - 1);
        break;
      case 'ArrowDown':
        newRow = Math.min(data.rowCount - 1, row + 1);
        break;
      case 'ArrowLeft':
        newCol = Math.max(0, col - 1);
        break;
      case 'ArrowRight':
        newCol = Math.min(data.colCount - 1, col + 1);
        break;
      case 'Enter':
        setEditingCell(selectedCell);
        e.preventDefault();
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          setEditingCell(selectedCell);
          updateCell(selectedCell, { value: e.key });
        }
        return;
    }

    e.preventDefault();
    setSelectedCell(getCellKey(newRow, newCol));
  }, [selectedCell, editingCell, data.rowCount, data.colCount, data.cells, updateCell, undoRedo, getActiveCell, useVirtualized, sparseGrid]);

  const addRow = useCallback(() => {
    try {
      setData(prev => ({ ...prev, rowCount: prev.rowCount + 1 }));
    } catch (e) {
      console.error('Failed to add row:', e);
    }
  }, []);

  const addColumn = useCallback(() => {
    try {
      setData(prev => ({ ...prev, colCount: prev.colCount + 1 }));
    } catch (e) {
      console.error('Failed to add column:', e);
    }
  }, []);

  const deleteRow = useCallback(() => {
    try {
      if (!selectedCell) return;
      const parts = selectedCell.split('-');
      if (parts.length !== 2) {
        console.warn('Invalid selected cell format for delete row');
        return;
      }
      const row = Number(parts[0]);
      if (isNaN(row)) {
        console.warn('Invalid row number for delete');
        return;
      }
      setData(prev => {
        const newCells: { [key: string]: CellData } = {};
        Object.entries(prev.cells).forEach(([key, cell]) => {
          const cellParts = key.split('-');
          if (cellParts.length !== 2) return;
          const [r, c] = cellParts.map(Number);
          if (isNaN(r) || isNaN(c)) return;
          if (r < row) {
            newCells[key] = cell;
          } else if (r > row) {
            newCells[getCellKey(r - 1, c)] = cell;
          }
        });
        return { ...prev, cells: newCells, rowCount: Math.max(1, prev.rowCount - 1) };
      });
      setSelectedCell(null);
    } catch (e) {
      console.error('Failed to delete row:', e);
    }
  }, [selectedCell]);

  const deleteColumn = useCallback(() => {
    try {
      if (!selectedCell) return;
      const parts = selectedCell.split('-');
      if (parts.length !== 2) {
        console.warn('Invalid selected cell format for delete column');
        return;
      }
      const col = Number(parts[1]);
      if (isNaN(col)) {
        console.warn('Invalid column number for delete');
        return;
      }
      setData(prev => {
        const newCells: { [key: string]: CellData } = {};
        Object.entries(prev.cells).forEach(([key, cell]) => {
          const cellParts = key.split('-');
          if (cellParts.length !== 2) return;
          const [r, c] = cellParts.map(Number);
          if (isNaN(r) || isNaN(c)) return;
          if (c < col) {
            newCells[key] = cell;
          } else if (c > col) {
            newCells[getCellKey(r, c - 1)] = cell;
          }
        });
        return { ...prev, cells: newCells, colCount: Math.max(1, prev.colCount - 1) };
      });
      setSelectedCell(null);
    } catch (e) {
      console.error('Failed to delete column:', e);
    }
  }, [selectedCell]);

  const getSelectionCells = useCallback((): Array<{ row: number; col: number }> => {
    if (useVirtualized && virtualSelectionRange) {
      const minRow = Math.min(virtualSelectionRange.startRow, virtualSelectionRange.endRow);
      const maxRow = Math.max(virtualSelectionRange.startRow, virtualSelectionRange.endRow);
      const minCol = Math.min(virtualSelectionRange.startCol, virtualSelectionRange.endCol);
      const maxCol = Math.max(virtualSelectionRange.startCol, virtualSelectionRange.endCol);

      const cells: Array<{ row: number; col: number }> = [];
      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          cells.push({ row: r, col: c });
        }
      }
      return cells;
    } else if (!useVirtualized && selectionRange) {
      const startParts = selectionRange.start.split('-').map(Number);
      const endParts = selectionRange.end.split('-').map(Number);
      if (startParts.length === 2 && endParts.length === 2) {
        const minRow = Math.min(startParts[0], endParts[0]);
        const maxRow = Math.max(startParts[0], endParts[0]);
        const minCol = Math.min(startParts[1], endParts[1]);
        const maxCol = Math.max(startParts[1], endParts[1]);

        const cells: Array<{ row: number; col: number }> = [];
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            cells.push({ row: r, col: c });
          }
        }
        return cells;
      }
    }

    const active = getActiveCell();
    return active ? [{ row: active.row, col: active.col }] : [];
  }, [useVirtualized, virtualSelectionRange, selectionRange, getActiveCell]);

  const applyToSelection = useCallback((updater: (cell: SparseCellData) => Partial<SparseCellData>) => {
    const cells = getSelectionCells();
    if (cells.length === 0) return;

    if (useVirtualized) {
      cells.forEach(({ row, col }) => {
        const existing = sparseGrid.getCell(row, col) || { value: '' };
        sparseGrid.setCell(row, col, { ...existing, ...updater(existing) });
      });
      setGridVersion(v => v + 1);
    } else {
      cells.forEach(({ row, col }) => {
        const key = getCellKey(row, col);
        const cell = data.cells[key] || { value: '' };
        updateCell(key, { ...cell, ...updater(cell) });
      });
    }
  }, [getSelectionCells, useVirtualized, sparseGrid, data.cells, updateCell]);

  const updateActiveCell = useCallback((updates: Partial<SparseCellData>) => {
    applyToSelection(() => updates);
  }, [applyToSelection]);

  const toggleBold = useCallback(() => {
    console.log('[toggleBold] Called');
    const active = getActiveCell();
    console.log('[toggleBold] Active cell:', active);
    if (!active) {
      console.log('[toggleBold] No active cell, returning');
      return;
    }
    const firstCell = useVirtualized ? sparseGrid.getCell(active.row, active.col) : data.cells[active.key];
    console.log('[toggleBold] First cell:', firstCell);
    const newBold = !(firstCell?.bold);
    console.log('[toggleBold] Setting bold to:', newBold);
    applyToSelection(() => ({ bold: newBold }));
  }, [getActiveCell, useVirtualized, sparseGrid, data.cells, applyToSelection]);

  const toggleItalic = useCallback(() => {
    console.log('[toggleItalic] Called');
    const active = getActiveCell();
    console.log('[toggleItalic] Active cell:', active);
    if (!active) {
      console.log('[toggleItalic] No active cell, returning');
      return;
    }
    const firstCell = useVirtualized ? sparseGrid.getCell(active.row, active.col) : data.cells[active.key];
    console.log('[toggleItalic] First cell:', firstCell);
    const newItalic = !(firstCell?.italic);
    console.log('[toggleItalic] Setting italic to:', newItalic);
    applyToSelection(() => ({ italic: newItalic }));
  }, [getActiveCell, useVirtualized, sparseGrid, data.cells, applyToSelection]);

  const toggleUnderline = useCallback(() => {
    console.log('[toggleUnderline] Called');
    const active = getActiveCell();
    console.log('[toggleUnderline] Active cell:', active);
    if (!active) {
      console.log('[toggleUnderline] No active cell, returning');
      return;
    }
    const firstCell = useVirtualized ? sparseGrid.getCell(active.row, active.col) : data.cells[active.key];
    console.log('[toggleUnderline] First cell:', firstCell);
    const newUnderline = !(firstCell?.underline);
    console.log('[toggleUnderline] Setting underline to:', newUnderline);
    applyToSelection(() => ({ underline: newUnderline }));
  }, [getActiveCell, useVirtualized, sparseGrid, data.cells, applyToSelection]);

  const setAlignment = useCallback((align: 'left' | 'center' | 'right') => {
    console.log('[setAlignment] Called with:', align);
    const active = getActiveCell();
    console.log('[setAlignment] Active cell:', active);
    if (!active) {
      console.log('[setAlignment] No active cell, returning');
      return;
    }
    console.log('[setAlignment] Applying alignment');
    applyToSelection(() => ({ align }));
  }, [getActiveCell, applyToSelection]);

  const setFontFamily = useCallback((fontFamily: string) => {
    applyToSelection(() => ({ fontFamily }));
  }, [applyToSelection]);

  const setFontSize = useCallback((fontSize: number) => {
    applyToSelection(() => ({ fontSize }));
  }, [applyToSelection]);

  const setFontColor = useCallback((color: string) => {
    applyToSelection(() => ({ color }));
  }, [applyToSelection]);

  const setFillColor = useCallback((backgroundColor: string) => {
    applyToSelection(() => ({ backgroundColor }));
  }, [applyToSelection]);

  const updateChartConfig = useCallback((type: string, visible: boolean) => {
    const chartType = type as 'bar' | 'line' | 'pie';
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(s =>
        s.id === prev.activeSheetId
          ? { ...s, chartConfig: { type: chartType, visible, title: s.chartConfig?.title } }
          : s
      )
    }));
    setChartType(chartType);
    setShowChart(visible);
  }, []);

  const hideChart = useCallback(() => {
    setWorkbook(prev => ({
      ...prev,
      sheets: prev.sheets.map(s =>
        s.id === prev.activeSheetId && s.chartConfig
          ? { ...s, chartConfig: { ...s.chartConfig, visible: false } }
          : s
      )
    }));
    setShowChart(false);
  }, []);

  const mergeCells = useCallback(() => {
    if (!selectionRange) return;
    console.log('Merge cells:', selectionRange);
  }, [selectionRange]);

  const unmergeCells = useCallback(() => {
    if (!selectionRange) return;
    console.log('Unmerge cells:', selectionRange);
  }, [selectionRange]);

  const toggleWrapText = useCallback(() => {
    setWrapTextEnabled(prev => !prev);
  }, []);

  const toggleStrikethrough = useCallback(() => {
    const active = getActiveCell();
    if (!active) return;
    const firstCell = useVirtualized ? sparseGrid.getCell(active.row, active.col) : data.cells[active.key];
    const newStrikethrough = !(firstCell?.strikethrough);
    applyToSelection(() => ({ strikethrough: newStrikethrough }));
  }, [getActiveCell, useVirtualized, sparseGrid, data.cells, applyToSelection]);

  const setBorders = useCallback((type: 'all' | 'outside' | 'inside' | 'none' | 'top' | 'bottom' | 'left' | 'right', style: 'thin' | 'medium' | 'thick' = 'thin') => {
    const active = getActiveCell();
    if (!active) return;

    const borderStyle = { style, color: '#000000' };
    const cells = getSelectionCells();
    if (cells.length === 0) return;

    const minRow = Math.min(...cells.map(c => c.row));
    const maxRow = Math.max(...cells.map(c => c.row));
    const minCol = Math.min(...cells.map(c => c.col));
    const maxCol = Math.max(...cells.map(c => c.col));

    const applyBordersToCell = (row: number, col: number, existingBorders: any) => {
      if (type === 'none') return undefined;

      const isTop = row === minRow;
      const isBottom = row === maxRow;
      const isLeft = col === minCol;
      const isRight = col === maxCol;

      const borders = { ...existingBorders };

      if (type === 'all') {
        borders.top = borderStyle;
        borders.bottom = borderStyle;
        borders.left = borderStyle;
        borders.right = borderStyle;
      } else if (type === 'outside') {
        if (isTop) borders.top = borderStyle;
        if (isBottom) borders.bottom = borderStyle;
        if (isLeft) borders.left = borderStyle;
        if (isRight) borders.right = borderStyle;
      } else if (type === 'inside') {
        if (!isTop) borders.top = borderStyle;
        if (!isBottom) borders.bottom = borderStyle;
        if (!isLeft) borders.left = borderStyle;
        if (!isRight) borders.right = borderStyle;
      } else {
        if (type === 'top') borders.top = borderStyle;
        if (type === 'bottom') borders.bottom = borderStyle;
        if (type === 'left') borders.left = borderStyle;
        if (type === 'right') borders.right = borderStyle;
      }

      return borders;
    };

    if (useVirtualized) {
      cells.forEach(({ row, col }) => {
        const cell = sparseGrid.getCell(row, col) || { value: '' };
        const newBorders = applyBordersToCell(row, col, cell.borders || {});
        sparseGrid.setCell(row, col, { ...cell, borders: newBorders });
      });
      setGridVersion(v => v + 1);
    } else {
      cells.forEach(({ row, col }) => {
        const key = getCellKey(row, col);
        const cell = data.cells[key] || { value: '' };
        const newBorders = applyBordersToCell(row, col, cell.borders || {});
        updateCell(key, { ...cell, borders: newBorders });
      });
    }
  }, [getActiveCell, getSelectionCells, useVirtualized, sparseGrid, data.cells, updateCell]);

  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [findResults, setFindResults] = useState<Array<{ row: number, col: number }>>([]);
  const [currentFindIndex, setCurrentFindIndex] = useState(0);

  const findInSpreadsheet = useCallback(() => {
    if (!findText) return;
    const results: Array<{ row: number, col: number }> = [];

    if (useVirtualized) {
      for (let r = 0; r < GRID_CONFIG.MAX_ROWS && r < 1000; r++) {
        for (let c = 0; c < GRID_CONFIG.MAX_COLS && c < 100; c++) {
          const cell = sparseGrid.getCell(r, c);
          if (cell?.value && String(cell.value).toLowerCase().includes(findText.toLowerCase())) {
            results.push({ row: r, col: c });
          }
        }
      }
    } else {
      Object.keys(data.cells).forEach(key => {
        const cell = data.cells[key];
        if (cell?.value && String(cell.value).toLowerCase().includes(findText.toLowerCase())) {
          const [row, col] = key.split('-').map(Number);
          results.push({ row, col });
        }
      });
    }

    setFindResults(results);
    setCurrentFindIndex(0);
    if (results.length > 0) {
      const first = results[0];
      if (useVirtualized) {
        setVirtualSelectedCell({ row: first.row, col: first.col });
      } else {
        setSelectedCell(`${first.row}-${first.col}`);
      }
    }
  }, [findText, useVirtualized, sparseGrid, data.cells]);

  const replaceInSpreadsheet = useCallback((replaceAll: boolean) => {
    if (!findText) return;

    if (useVirtualized) {
      const cellsToReplace = replaceAll ? findResults : (findResults.length > 0 ? [findResults[currentFindIndex]] : []);
      cellsToReplace.forEach(({ row, col }) => {
        const cell = sparseGrid.getCell(row, col) || { value: '' };
        const newValue = String(cell.value).replace(new RegExp(findText, replaceAll ? 'gi' : 'i'), replaceText);
        sparseGrid.setCell(row, col, { ...cell, value: newValue });
      });
      setGridVersion(v => v + 1);
    } else {
      const newCells = { ...data.cells };
      const cellsToReplace = replaceAll ? findResults : (findResults.length > 0 ? [findResults[currentFindIndex]] : []);
      cellsToReplace.forEach(({ row, col }) => {
        const key = `${row}-${col}`;
        const cell = newCells[key] || { value: '' };
        const newValue = String(cell.value).replace(new RegExp(findText, replaceAll ? 'gi' : 'i'), replaceText);
        newCells[key] = { ...cell, value: newValue };
      });
      setData(prev => ({ ...prev, cells: newCells }));
    }

    if (!replaceAll && findResults.length > 1) {
      setCurrentFindIndex(prev => (prev + 1) % findResults.length);
    } else {
      findInSpreadsheet();
    }
  }, [findText, replaceText, findResults, currentFindIndex, useVirtualized, sparseGrid, data.cells, findInSpreadsheet]);

  const insertFormula = useCallback((formulaType: 'SUM' | 'AVERAGE' | 'COUNT' | 'MAX' | 'MIN' | 'IF' | 'VLOOKUP') => {
    const active = getActiveCell();
    if (!active) return;

    const selectionCells = getSelectionCells();
    let formula = '';

    if (selectionCells.length > 1) {
      const rows = selectionCells.map(c => c.row);
      const cols = selectionCells.map(c => c.col);
      const minRow = Math.min(...rows);
      const maxRow = Math.max(...rows);
      const minCol = Math.min(...cols);
      const maxCol = Math.max(...cols);
      const startRef = formatCellRef(minRow, minCol);
      const endRef = formatCellRef(maxRow, maxCol);
      formula = `=${formulaType}(${startRef}:${endRef})`;
    } else {
      const startRef = formatCellRef(Math.max(0, active.row - 5), active.col);
      const endRef = formatCellRef(active.row - 1, active.col);
      if (active.row > 0) {
        formula = `=${formulaType}(${startRef}:${endRef})`;
      } else {
        formula = `=${formulaType}(A1:A10)`;
      }
    }

    if (useVirtualized) {
      const cell = sparseGrid.getCell(active.row, active.col) || { value: '' };
      const engine = new FormulaEngine(sparseGrid);
      const result = engine.evaluate(formula);
      sparseGrid.setCell(active.row, active.col, {
        ...cell,
        formula,
        value: String(result)
      });
      setGridVersion(v => v + 1);
    } else {
      const cell = data.cells[active.key] || { value: '' };
      const result = evaluateFormula(formula, data.cells);
      updateCell(active.key, { ...cell, formula, value: result });
    }
  }, [getActiveCell, getSelectionCells, useVirtualized, sparseGrid, data.cells, updateCell]);

  const sortData = useCallback((direction: 'asc' | 'desc') => {
    const active = getActiveCell();
    if (!active) return;

    const colToSort = active.col;

    if (useVirtualized) {
      const rowsWithData: Array<{ row: number, values: Map<number, any> }> = [];

      for (let r = 0; r < 1000; r++) {
        const cell = sparseGrid.getCell(r, colToSort);
        if (cell?.value) {
          const rowData = new Map<number, any>();
          for (let c = 0; c < 100; c++) {
            const cellData = sparseGrid.getCell(r, c);
            if (cellData) rowData.set(c, { ...cellData });
          }
          rowsWithData.push({ row: r, values: rowData });
        }
      }

      if (rowsWithData.length === 0) return;

      rowsWithData.sort((a, b) => {
        const aVal = a.values.get(colToSort)?.value || '';
        const bVal = b.values.get(colToSort)?.value || '';
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);

        if (!isNaN(aNum) && !isNaN(bNum)) {
          return direction === 'asc' ? aNum - bNum : bNum - aNum;
        }
        return direction === 'asc'
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });

      rowsWithData.forEach((rowInfo, newIndex) => {
        for (let c = 0; c < 100; c++) {
          const cellData = rowInfo.values.get(c);
          if (cellData) {
            sparseGrid.setCell(newIndex, c, cellData);
          } else {
            sparseGrid.deleteCell(newIndex, c);
          }
        }
      });

      setGridVersion(v => v + 1);
    } else {
      const rowsWithData: Array<{ row: number, cells: { [key: string]: CellData } }> = [];

      for (let r = 0; r < data.rowCount; r++) {
        const key = getCellKey(r, colToSort);
        const cell = data.cells[key];
        if (cell?.value) {
          const rowCells: { [key: string]: CellData } = {};
          for (let c = 0; c < data.colCount; c++) {
            const cellKey = getCellKey(r, c);
            if (data.cells[cellKey]) {
              rowCells[c.toString()] = { ...data.cells[cellKey] };
            }
          }
          rowsWithData.push({ row: r, cells: rowCells });
        }
      }

      if (rowsWithData.length === 0) return;

      rowsWithData.sort((a, b) => {
        const aVal = a.cells[colToSort.toString()]?.value || '';
        const bVal = b.cells[colToSort.toString()]?.value || '';
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);

        if (!isNaN(aNum) && !isNaN(bNum)) {
          return direction === 'asc' ? aNum - bNum : bNum - aNum;
        }
        return direction === 'asc'
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });

      const newCells: { [key: string]: CellData } = {};
      rowsWithData.forEach((rowInfo, newIndex) => {
        Object.entries(rowInfo.cells).forEach(([col, cellData]) => {
          newCells[getCellKey(newIndex, parseInt(col))] = cellData;
        });
      });

      setData(prev => ({ ...prev, cells: newCells }));
    }
  }, [getActiveCell, useVirtualized, sparseGrid, data]);

  const setVerticalAlignment = useCallback((align: 'top' | 'middle' | 'bottom') => {
    applyToSelection(() => ({ verticalAlign: align }));
  }, [applyToSelection]);

  const setIndent = useCallback((delta: number) => {
    const active = getActiveCell();
    if (!active) return;
    const firstCell = useVirtualized ? sparseGrid.getCell(active.row, active.col) : data.cells[active.key];
    const currentIndent = firstCell?.indent || 0;
    const newIndent = Math.max(0, currentIndent + delta);
    applyToSelection(() => ({ indent: newIndent }));
  }, [getActiveCell, useVirtualized, sparseGrid, data.cells, applyToSelection]);

  const setNumberFormat = useCallback((format: string) => {
    applyToSelection(() => ({ numberFormat: format }));
  }, [applyToSelection]);

  const ribbonCommands: Partial<RibbonCommands> = useMemo(() => ({
    copy: () => {
      const active = getActiveCell();
      if (!active) return;

      if (useVirtualized) {
        const cell = sparseGrid.getCell(active.row, active.col);
        if (cell?.value) {
          navigator.clipboard.writeText(String(cell.value));
          const cellRef = colToName(active.col + 1) + (active.row + 1);
          toast.success('Copiado', {
            description: `Celda ${cellRef} copiada al portapapeles`,
            duration: 2000,
            icon: <Copy className="h-4 w-4" />
          });
        }
      } else {
        const cell = data.cells[active.key];
        if (cell?.value) {
          navigator.clipboard.writeText(cell.value);
          toast.success('Copiado', {
            description: 'Contenido copiado al portapapeles',
            duration: 2000,
            icon: <Copy className="h-4 w-4" />
          });
        }
      }
    },
    cut: () => {
      const active = getActiveCell();
      if (!active) return;

      if (useVirtualized) {
        const cell = sparseGrid.getCell(active.row, active.col);
        if (cell?.value) {
          navigator.clipboard.writeText(String(cell.value));
          sparseGrid.setCell(active.row, active.col, { ...cell, value: '' });
          setGridVersion(v => v + 1);
          const cellRef = colToName(active.col + 1) + (active.row + 1);
          toast.success('Cortado', {
            description: `Celda ${cellRef} cortada`,
            duration: 2000,
            icon: <Scissors className="h-4 w-4" />
          });
        }
      } else {
        const cell = data.cells[active.key];
        if (cell?.value) {
          navigator.clipboard.writeText(cell.value);
          updateCell(active.key, { ...cell, value: '' });
          toast.success('Cortado', {
            description: 'Contenido cortado al portapapeles',
            duration: 2000,
            icon: <Scissors className="h-4 w-4" />
          });
        }
      }
    },
    paste: async () => {
      const active = getActiveCell();
      if (!active) return;

      try {
        const text = await navigator.clipboard.readText();
        if (useVirtualized) {
          const cell = sparseGrid.getCell(active.row, active.col) || { value: '' };
          sparseGrid.setCell(active.row, active.col, { ...cell, value: text });
          setGridVersion(v => v + 1);
          const cellRef = colToName(active.col + 1) + (active.row + 1);
          toast.success('Pegado', {
            description: `Contenido pegado en ${cellRef}`,
            duration: 2000,
            icon: <Clipboard className="h-4 w-4" />
          });
        } else {
          const cell = data.cells[active.key] || { value: '' };
          updateCell(active.key, { ...cell, value: text });
          toast.success('Pegado', {
            description: 'Contenido pegado',
            duration: 2000,
            icon: <Clipboard className="h-4 w-4" />
          });
        }
      } catch (e) {
        console.error('Paste failed:', e);
        toast.error('Error al pegar', { description: 'No se pudo acceder al portapapeles' });
      }
    },
    toggleBold,
    toggleItalic,
    toggleUnderline,
    toggleStrikethrough,
    setFont: setFontFamily,
    setFontSize,
    setFontColor,
    setFillColor,
    alignLeft: () => setAlignment('left'),
    alignCenter: () => setAlignment('center'),
    alignRight: () => setAlignment('right'),
    alignTop: () => setVerticalAlignment('top'),
    alignMiddle: () => setVerticalAlignment('middle'),
    alignBottom: () => setVerticalAlignment('bottom'),
    increaseIndent: () => setIndent(1),
    decreaseIndent: () => setIndent(-1),
    insertRow: addRow,
    insertColumn: addColumn,
    deleteRow,
    deleteColumn,
    insertChart: (type) => updateChartConfig(type, true),
    sort: sortData,
    filter: () => {
      console.log('Filter toggle');
    },
    undo: undoRedo.undo,
    redo: undoRedo.redo,
    mergeCells,
    unmergeCells,
    wrapText: toggleWrapText,
    setNumberFormat,
    setBorders,
    insertFormula,
    findReplace: () => setFindReplaceOpen(true),
  }), [getActiveCell, useVirtualized, sparseGrid, data.cells, updateCell, toggleBold, toggleItalic, toggleUnderline, toggleStrikethrough, setFontFamily, setFontSize, setFontColor, setFillColor, setAlignment, setVerticalAlignment, setIndent, addRow, addColumn, deleteRow, deleteColumn, updateChartConfig, sortData, undoRedo.undo, undoRedo.redo, mergeCells, unmergeCells, toggleWrapText, setNumberFormat, setBorders, insertFormula]);

  const cellFormat: CellFormat = useMemo(() => {
    const active = getActiveCell();
    if (!active) return {};

    if (useVirtualized) {
      const cell = sparseGrid.getCell(active.row, active.col);
      return {
        bold: cell?.bold,
        italic: cell?.italic,
        underline: cell?.underline,
        align: cell?.align,
        fontFamily: cell?.fontFamily,
        fontSize: cell?.fontSize,
        color: cell?.color,
        backgroundColor: cell?.backgroundColor,
      };
    } else {
      const cell = data.cells[active.key];
      return {
        bold: cell?.bold,
        italic: cell?.italic,
        underline: cell?.underline,
        align: cell?.align,
        fontFamily: cell?.fontFamily,
        fontSize: cell?.fontSize,
        color: cell?.color,
        backgroundColor: cell?.backgroundColor,
      };
    }
  }, [getActiveCell, useVirtualized, sparseGrid, data.cells, gridVersion]);

  // Recalculate formulas when cells change
  const recalculateFormulas = useCallback(() => {
    setData(prev => {
      const newCells = { ...prev.cells };
      let changed = false;
      Object.keys(newCells).forEach(key => {
        const cell = newCells[key];
        if (cell.formula && cell.formula.startsWith('=')) {
          const newValue = evaluateFormula(cell.formula, newCells);
          if (newValue !== cell.value) {
            newCells[key] = { ...cell, value: newValue };
            changed = true;
          }
        }
      });
      return changed ? { ...prev, cells: newCells } : prev;
    });
  }, [setData]);

  // Recalculate formulas when data changes
  useEffect(() => {
    const hasFormulas = Object.values(data.cells).some(cell => cell.formula);
    if (hasFormulas) {
      recalculateFormulas();
    }
  }, [data.cells, recalculateFormulas]);

  // Auto-show chart on initial load if chartConfig.visible is true
  useEffect(() => {
    if (activeSheet?.chartConfig?.visible) {
      setShowChart(true);
      setChartType(activeSheet.chartConfig.type);
    }
  }, []);

  const selectedCellData = selectedCell ? data.cells[selectedCell] : null;
  const selectedCellLabel = selectedCell
    ? `${getColumnLabel(parseInt(selectedCell.split('-')[1]))}${parseInt(selectedCell.split('-')[0]) + 1}`
    : '';

  return (
    <div
      className="spreadsheet-editor flex flex-col h-full bg-white dark:bg-black"
      onKeyDown={handleNavigationKeyDown}
      tabIndex={0}
    >
      {/* Top Action Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <span className="font-medium text-sm">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={onDownload} className="gap-2">
            <Download className="h-4 w-4" />
            Descargar
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Excel Ribbon */}
      <ExcelRibbon
        commands={ribbonCommands}
        cellFormat={cellFormat}
        currentFont="Calibri"
        currentFontSize={11}
        currentNumberFormat="General"
        onRunAutomation={(prompt) => {
          // TODO: Wire up orchestrator when available
          console.info('[SpreadsheetEditor] Automation prompt:', prompt);
        }}
      />

      {/* Formula Bar with Undo/Redo */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
        {/* Cell Reference (A1 notation) */}
        <div className="w-20 px-2 py-1 text-xs font-mono bg-white dark:bg-black border rounded text-center font-semibold text-green-700 dark:text-green-400" data-testid="cell-reference-display">
          {(() => {
            if (useVirtualized && virtualSelectionRange) {
              const { startRow, startCol, endRow, endCol } = virtualSelectionRange;
              const start = colToName(startCol + 1) + (startRow + 1);
              const end = colToName(endCol + 1) + (endRow + 1);
              return start === end ? start : `${start}:${end}`;
            } else if (useVirtualized && virtualSelectedCell) {
              return colToName(virtualSelectedCell.col + 1) + (virtualSelectedCell.row + 1);
            } else if (selectedCell) {
              const parts = selectedCell.split('-');
              if (parts.length === 2) {
                const row = parseInt(parts[0], 10);
                const col = parseInt(parts[1], 10);
                return colToName(col + 1) + (row + 1);
              }
            }
            return 'A1';
          })()}
        </div>

        {/* Undo/Redo Buttons */}
        <div className="flex items-center gap-0.5 mx-1 border-l border-r border-gray-300 dark:border-gray-700 px-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 w-7 p-0",
              !undoRedo.canUndo && "opacity-40 cursor-not-allowed"
            )}
            onClick={() => {
              undoRedo.undo();
              toast.success('Deshacer', { description: 'Cambio revertido', duration: 1500 });
            }}
            disabled={!undoRedo.canUndo}
            title="Deshacer (Ctrl+Z)"
            data-testid="btn-undo"
          >
            <Undo className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 w-7 p-0",
              !undoRedo.canRedo && "opacity-40 cursor-not-allowed"
            )}
            onClick={() => {
              undoRedo.redo();
              toast.success('Rehacer', { description: 'Cambio restaurado', duration: 1500 });
            }}
            disabled={!undoRedo.canRedo}
            title="Rehacer (Ctrl+Y)"
            data-testid="btn-redo"
          >
            <Redo className="h-4 w-4" />
          </Button>
        </div>

        <span className="text-gray-400 text-sm mx-1 font-medium">fx</span>
        <input
          ref={formulaInputRef}
          type="text"
          className="flex-1 px-3 py-1 text-sm border rounded bg-white dark:bg-black focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="Ingresa un valor o fórmula"
          value={selectedCellData?.formula || selectedCellData?.value || ''}
          onChange={(e) => selectedCell && handleCellChange(selectedCell, e.target.value)}
          data-testid="formula-input"
          aria-label="Barra de fórmulas"
        />
        <Button
          variant={useVirtualized ? 'default' : 'ghost'}
          size="sm"
          className="gap-1 text-xs ml-2"
          onClick={() => setUseVirtualized(!useVirtualized)}
          title={useVirtualized ? 'Modo empresarial: 10,000 × 10,000 celdas' : 'Cambiar a modo empresarial'}
          data-testid="btn-toggle-virtualized"
        >
          <Maximize2 className="h-3 w-3" />
          {useVirtualized ? '10K×10K' : 'Modo Pro'}
        </Button>
      </div>

      {/* Chart Panel */}
      {showChart && chartData.data.length > 0 && (
        <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-black p-4" style={{ height: '280px' }}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Gráfico: {activeSheet?.name}</h3>
            <span className="text-xs text-gray-500">{chartData.data.length} registros</span>
          </div>
          <ResponsiveContainer width="100%" height="90%">
            {chartType === 'bar' ? (
              <BarChart data={chartData.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}
                />
                {chartData.headers.length > 0 ? (
                  chartData.headers.map((header, i) => (
                    <Bar key={header} dataKey={header} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
                  ))
                ) : (
                  <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                )}
              </BarChart>
            ) : chartType === 'line' ? (
              <RechartsLineChart data={chartData.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}
                />
                {chartData.headers.length > 0 ? (
                  chartData.headers.map((header, i) => (
                    <Line key={header} type="monotone" dataKey={header} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ fill: CHART_COLORS[i % CHART_COLORS.length] }} />
                  ))
                ) : (
                  <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
                )}
              </RechartsLineChart>
            ) : (
              <RechartsPieChart>
                <Pie
                  data={chartData.data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={{ stroke: '#9ca3af' }}
                >
                  {chartData.data.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '12px'
                  }}
                />
              </RechartsPieChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {showChart && chartData.data.length === 0 && (
        <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-6 text-center">
          <BarChart3 className="h-12 w-12 mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">Agrega datos numéricos para ver el gráfico</p>
          <p className="text-xs text-gray-400 mt-1">Primera columna: etiquetas, siguientes columnas: valores</p>
        </div>
      )}

      {/* Spreadsheet Grid */}
      {useVirtualized ? (
        <div className="flex-1 overflow-hidden relative">
          <VirtualizedExcel
            grid={sparseGrid}
            onGridChange={handleSparseGridChange}
            selectedCell={virtualSelectedCell}
            onSelectCell={setVirtualSelectedCell}
            editingCell={virtualEditingCell}
            onEditCell={setVirtualEditingCell}
            version={gridVersion}
            activeStreamingCell={streaming.activeCell}
            typingValue={streaming.typingValue}
            isRecentCell={streaming.isRecentCell}
            conditionalFormats={activeSheet?.conditionalFormats}
            charts={(activeSheet?.charts || []) as ChartLayerConfig[]}
            onUpdateChart={handleUpdateChart}
            onDeleteChart={handleDeleteChart}
            columnWidths={columnWidths}
            rowHeights={rowHeights}
            onColumnWidthChange={setColumnWidth}
            onRowHeightChange={setRowHeight}
            selectionRange={virtualSelectionRange}
            onSelectionRangeChange={setVirtualSelectionRange}
          />

          {/* Streaming Indicator */}
          <StreamingIndicator
            status={streaming.streamStatus}
            progress={streaming.streamProgress}
            activeCell={streaming.activeCell}
            onPause={streaming.pauseStreaming}
            onResume={streaming.resumeStreaming}
            onCancel={streaming.cancelStreaming}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="spreadsheet-table border-collapse w-full">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="spreadsheet-corner-cell" />
                {Array.from({ length: data.colCount }, (_, i) => (
                  <th key={i} className="spreadsheet-col-header">
                    {getColumnLabel(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: data.rowCount }, (_, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="spreadsheet-row-header">
                    {rowIndex + 1}
                  </td>
                  {Array.from({ length: data.colCount }, (_, colIndex) => {
                    const key = getCellKey(rowIndex, colIndex);
                    const cell = data.cells[key] || { value: '' };
                    const isSelected = selectedCell === key;
                    const isEditing = editingCell === key;

                    return (
                      <td
                        key={colIndex}
                        className={cn(
                          'spreadsheet-cell',
                          isSelected && 'spreadsheet-cell-selected',
                          cell.bold && 'font-bold',
                          cell.italic && 'italic'
                        )}
                        style={{ textAlign: cell.align || 'left' }}
                        onClick={() => handleCellClick(key)}
                        onDoubleClick={() => handleCellDoubleClick(key)}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            type="text"
                            className="spreadsheet-cell-input"
                            value={cell.value}
                            onChange={(e) => handleCellChange(key, e.target.value)}
                            onBlur={handleCellBlur}
                            onKeyDown={(e) => handleKeyDown(e, key)}
                            aria-label={`Editar celda ${getCellKey(rowIndex, colIndex)}`}
                          />
                        ) : (
                          <span className="spreadsheet-cell-content">{cell.value}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sheet Tabs & Status Bar */}
      <div className="flex items-center border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
        <div className="flex items-center gap-1 px-2 py-1 overflow-x-auto flex-1">
          {workbook.sheets.map(sheet => (
            <button
              key={sheet.id}
              onClick={() => switchSheet(sheet.id)}
              className={cn(
                'px-3 py-1.5 text-xs rounded-t border-x border-t transition-colors whitespace-nowrap',
                sheet.id === workbook.activeSheetId
                  ? 'bg-white dark:bg-black border-gray-300 dark:border-gray-700 font-medium'
                  : 'bg-gray-100 dark:bg-gray-900 border-transparent hover:bg-gray-200 dark:hover:bg-gray-800'
              )}
            >
              {sheet.name}
              {workbook.sheets.length > 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); deleteSheet(sheet.id); }}
                  className="ml-2 text-gray-400 hover:text-red-500 cursor-pointer"
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button
            onClick={addSheet}
            className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            title="Agregar hoja"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Selection Info */}
        <div className="px-3 py-1 text-xs text-gray-600 dark:text-gray-400 border-l border-gray-200 dark:border-gray-800 font-medium" data-testid="selection-info">
          {(() => {
            if (useVirtualized && virtualSelectionRange) {
              const { startRow, startCol, endRow, endCol } = virtualSelectionRange;
              const minR = Math.min(startRow, endRow);
              const maxR = Math.max(startRow, endRow);
              const minC = Math.min(startCol, endCol);
              const maxC = Math.max(startCol, endCol);
              const cellCount = (maxR - minR + 1) * (maxC - minC + 1);
              const start = colToName(minC + 1) + (minR + 1);
              const end = colToName(maxC + 1) + (maxR + 1);
              if (cellCount > 1) {
                return `Rango: ${start}:${end} (${cellCount} celdas)`;
              }
              return start;
            } else if (useVirtualized && virtualSelectedCell) {
              return colToName(virtualSelectedCell.col + 1) + (virtualSelectedCell.row + 1);
            } else if (selectionRange) {
              const startParts = selectionRange.start.split('-').map(Number);
              const endParts = selectionRange.end.split('-').map(Number);
              if (startParts.length === 2 && endParts.length === 2) {
                const minR = Math.min(startParts[0], endParts[0]);
                const maxR = Math.max(startParts[0], endParts[0]);
                const minC = Math.min(startParts[1], endParts[1]);
                const maxC = Math.max(startParts[1], endParts[1]);
                const cellCount = (maxR - minR + 1) * (maxC - minC + 1);
                const start = colToName(minC + 1) + (minR + 1);
                const end = colToName(maxC + 1) + (maxR + 1);
                if (cellCount > 1) {
                  return `Rango: ${start}:${end} (${cellCount} celdas)`;
                }
              }
            }
            return '';
          })()}
        </div>

        <div className="px-3 py-1 text-xs text-gray-500 border-l border-gray-200 dark:border-gray-800">
          {data.rowCount} × {data.colCount}
        </div>
      </div>

      {/* AI Prompt Modal - Always visible when showAIPrompt is true */}
      {showAIPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 w-96">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-500" />
              Generar con IA
            </h3>
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAIPrompt(e.target.value)}
              placeholder="Ej: tabla de ventas mensuales, nómina de empleados..."
              className="w-full px-4 py-2 border rounded-lg mb-4 focus:ring-2 focus:ring-purple-500 outline-none dark:bg-gray-800 dark:border-gray-700"
              onKeyDown={(e) => e.key === 'Enter' && handleAIGenerate()}
              autoFocus
              data-testid="input-ai-prompt"
              aria-label="Prompt para generar con IA"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAIPrompt(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAIGenerate} className="bg-purple-600 hover:bg-purple-700 text-white">
                <Sparkles className="w-4 h-4 mr-1" />
                Generar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Find & Replace Dialog */}
      {findReplaceOpen && (
        <div className="fixed top-20 right-4 bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 p-4 w-80 z-[100]" data-testid="find-replace-dialog">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Buscar y reemplazar</h3>
            <button
              onClick={() => setFindReplaceOpen(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label="Cerrar búsqueda"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Buscar</label>
              <input
                type="text"
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                placeholder="Texto a buscar..."
                className="w-full px-3 py-1.5 text-sm border rounded focus:ring-1 focus:ring-green-500 outline-none dark:bg-gray-800 dark:border-gray-700"
                onKeyDown={(e) => e.key === 'Enter' && findInSpreadsheet()}
                autoFocus
                data-testid="input-find-text"
                aria-label="Texto a buscar"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Reemplazar con</label>
              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="Nuevo texto..."
                className="w-full px-3 py-1.5 text-sm border rounded focus:ring-1 focus:ring-green-500 outline-none dark:bg-gray-800 dark:border-gray-700"
                data-testid="input-replace-text"
                aria-label="Texto para reemplazar"
              />
            </div>
            {findResults.length > 0 && (
              <div className="text-xs text-gray-500">
                {currentFindIndex + 1} de {findResults.length} resultados
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={findInSpreadsheet} className="flex-1" data-testid="btn-find">
                Buscar
              </Button>
              <Button size="sm" variant="outline" onClick={() => replaceInSpreadsheet(false)} className="flex-1" data-testid="btn-replace">
                Reemplazar
              </Button>
            </div>
            <Button size="sm" variant="default" onClick={() => replaceInSpreadsheet(true)} className="w-full" data-testid="btn-replace-all">
              Reemplazar todo
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}
