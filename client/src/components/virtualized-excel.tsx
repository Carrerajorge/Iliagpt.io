import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import { cn } from '@/lib/utils';
import { getFormulaEngineWorker } from '@/lib/worker-client';
import { SparseGrid, getColumnName, formatCellRef, CellData, CellBorders } from '@/lib/sparseGrid';
import { ChartLayer, ChartConfig as ChartLayerConfig } from './excel-chart-layer';
import { OfficeToolShell, OfficeViewMode } from './office/OfficeToolShell';
import { Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import * as XLSX from 'xlsx';
import { usePlatformSettings } from '@/contexts/PlatformSettingsContext';
import { formatZonedDate, normalizeTimeZone, type PlatformDateFormat } from '@/lib/platformDateTime';
import {
  buildPositionCache,
  getVisibleRange,
  ScrollThrottler,
  type PositionCache
} from '@/lib/excelPerformance';

export interface SelectionRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

function formatDisplayValue(
  value: string,
  numberFormat: string | undefined,
  opts?: { timeZone: string; dateFormat: PlatformDateFormat }
): string {
  if (!numberFormat || numberFormat === 'General' || numberFormat === 'Texto') {
    return value;
  }

  const num = parseFloat(value);
  if (isNaN(num)) return value;

  switch (numberFormat) {
    case 'Número':
    case 'Number':
      return num.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'Moneda':
    case 'Currency':
      return num.toLocaleString('es-ES', { style: 'currency', currency: 'USD' });
    case 'Porcentaje':
    case 'Percentage':
      return (num * 100).toLocaleString('es-ES', { minimumFractionDigits: 2 }) + '%';
    case 'Fecha':
    case 'Date':
      try {
        const date = new Date(num);
        if (!isNaN(date.getTime())) {
          return formatZonedDate(date, {
            timeZone: opts?.timeZone || "UTC",
            dateFormat: opts?.dateFormat || "YYYY-MM-DD",
          });
        }
      } catch {
        // FRONTEND FIX #19: Intentionally silent - invalid date value, return as-is
      }
      return value;
    default:
      return value;
  }
}

function getBorderStyle(borders?: CellBorders): React.CSSProperties {
  const style: React.CSSProperties = {};

  if (borders?.top) {
    const width = borders.top.style === 'thin' ? '1px' : borders.top.style === 'medium' ? '2px' : borders.top.style === 'thick' ? '3px' : '3px';
    style.borderTop = `${width} ${borders.top.style === 'double' ? 'double' : 'solid'} ${borders.top.color}`;
  }
  if (borders?.right) {
    const width = borders.right.style === 'thin' ? '1px' : borders.right.style === 'medium' ? '2px' : borders.right.style === 'thick' ? '3px' : '3px';
    style.borderRight = `${width} ${borders.right.style === 'double' ? 'double' : 'solid'} ${borders.right.color}`;
  }
  if (borders?.bottom) {
    const width = borders.bottom.style === 'thin' ? '1px' : borders.bottom.style === 'medium' ? '2px' : borders.bottom.style === 'thick' ? '3px' : '3px';
    style.borderBottom = `${width} ${borders.bottom.style === 'double' ? 'double' : 'solid'} ${borders.bottom.color}`;
  }
  if (borders?.left) {
    const width = borders.left.style === 'thin' ? '1px' : borders.left.style === 'medium' ? '2px' : borders.left.style === 'thick' ? '3px' : '3px';
    style.borderLeft = `${width} ${borders.left.style === 'double' ? 'double' : 'solid'} ${borders.left.color}`;
  }

  return style;
}

// Autofill pattern detection
interface AutofillPattern {
  type: 'arithmetic' | 'geometric' | 'text' | 'copy';
  values: (string | number)[];
  start?: number;
  step?: number;
  ratio?: number;
}

function detectNumericPattern(values: number[]): AutofillPattern {
  if (values.length === 0) {
    return { type: 'copy', values: [] };
  }

  if (values.length === 1) {
    return { type: 'arithmetic', values, start: values[0], step: 1 };
  }

  // Check for arithmetic progression (constant difference)
  const diffs: number[] = [];
  for (let i = 1; i < values.length; i++) {
    diffs.push(values[i] - values[i - 1]);
  }

  const allSameDiff = diffs.every(d => Math.abs(d - diffs[0]) < 0.0001);
  if (allSameDiff) {
    return {
      type: 'arithmetic',
      values,
      start: values[values.length - 1],
      step: diffs[0]
    };
  }

  // Check for geometric progression (constant ratio)
  if (values.every(v => v !== 0)) {
    const ratios: number[] = [];
    for (let i = 1; i < values.length; i++) {
      ratios.push(values[i] / values[i - 1]);
    }
    const allSameRatio = ratios.every(r => Math.abs(r - ratios[0]) < 0.0001);
    if (allSameRatio && ratios[0] !== 1) {
      return {
        type: 'geometric',
        values,
        start: values[values.length - 1],
        ratio: ratios[0]
      };
    }
  }

  return { type: 'copy', values };
}

function detectPattern(cellValues: (string | undefined)[]): AutofillPattern {
  const values = cellValues.filter(v => v !== undefined && v !== '') as string[];

  if (values.length === 0) {
    return { type: 'copy', values: [] };
  }

  // Try to parse as numbers
  const numbers = values.map(v => parseFloat(v));
  const allNumbers = numbers.every(n => !isNaN(n));

  if (allNumbers) {
    return detectNumericPattern(numbers);
  }

  // Text pattern - just copy
  return { type: 'copy', values };
}

function generateFillValues(pattern: AutofillPattern, count: number): (string | number)[] {
  const result: (string | number)[] = [];

  switch (pattern.type) {
    case 'arithmetic':
      for (let i = 0; i < count; i++) {
        const value = (pattern.start || 0) + (pattern.step || 1) * (i + 1);
        // Keep as integer if step is integer
        result.push(Number.isInteger(pattern.step) && Number.isInteger(pattern.start || 0)
          ? Math.round(value)
          : Math.round(value * 100) / 100);
      }
      break;

    case 'geometric':
      for (let i = 0; i < count; i++) {
        const value = (pattern.start || 1) * Math.pow(pattern.ratio || 2, i + 1);
        result.push(Math.round(value * 100) / 100);
      }
      break;

    case 'copy':
    default:
      for (let i = 0; i < count; i++) {
        const index = i % pattern.values.length;
        result.push(pattern.values[index]);
      }
      break;
  }

  return result;
}

const GRID_CONFIG = {
  MAX_ROWS: 10000,
  MAX_COLS: 10000,
  ROW_HEIGHT: 28,
  COL_WIDTH: 100,
  ROW_HEADER_WIDTH: 60,
  COL_HEADER_HEIGHT: 28,
  VISIBLE_ROWS: 35,
  VISIBLE_COLS: 20,
  BUFFER_ROWS: 5,
  BUFFER_COLS: 3,
};

const RESIZE_CONFIG = {
  MIN_COL_WIDTH: 30,
  MAX_COL_WIDTH: 500,
  MIN_ROW_HEIGHT: 20,
  MAX_ROW_HEIGHT: 300,
  RESIZE_HANDLE_SIZE: 5,
  DOUBLE_CLICK_DELAY: 300,
};

interface ResizeState {
  isResizing: boolean;
  type: 'column' | 'row' | null;
  index: number | null;
  startPos: number;
  startSize: number;
  currentSize: number;
}

interface ConditionalFormatRule {
  condition: 'greaterThan' | 'lessThan' | 'equals' | 'between';
  value?: number;
  min?: number;
  max?: number;
  style: { backgroundColor?: string; color?: string; };
}

interface ConditionalFormat {
  range: { startRow: number; endRow: number; startCol: number; endCol: number };
  rules: ConditionalFormatRule[];
}

interface VirtualizedExcelProps {
  grid: SparseGrid;
  onGridChange: (grid: SparseGrid) => void;
  selectedCell: { row: number; col: number } | null;
  onSelectCell: (cell: { row: number; col: number } | null) => void;
  editingCell: { row: number; col: number } | null;
  onEditCell: (cell: { row: number; col: number } | null) => void;
  className?: string;
  version?: number;
  activeStreamingCell?: { row: number; col: number } | null;
  typingValue?: string;
  isRecentCell?: (row: number, col: number) => boolean;
  conditionalFormats?: ConditionalFormat[];
  charts?: ChartLayerConfig[];
  onUpdateChart?: (chartId: string, updates: Partial<ChartLayerConfig>) => void;
  onDeleteChart?: (chartId: string) => void;
  columnWidths?: { [col: number]: number };
  rowHeights?: { [row: number]: number };
  onColumnWidthChange?: (col: number, width: number) => void;
  onRowHeightChange?: (row: number, height: number) => void;
  selectionRange?: SelectionRange | null;
  onSelectionRangeChange?: (range: SelectionRange | null) => void;
}

const VirtualCell = memo(function VirtualCell({
  row,
  col,
  data,
  isSelected,
  isInRange,
  isEditing,
  isStreaming,
  isRecentlyWritten,
  typingValue,
  editingValue,
  style,
  conditionalStyle,
  onMouseDown,
  onMouseEnter,
  onDoubleClick,
  onBlur,
  onChange,
  onTypingChange,
  onKeyDown,
  platformTimeZone,
  platformDateFormat,
}: {
  row: number;
  col: number;
  data: CellData;
  isSelected: boolean;
  isInRange?: boolean;
  isEditing: boolean;
  isStreaming: boolean;
  isRecentlyWritten: boolean;
  typingValue?: string;
  editingValue?: string;
  style: React.CSSProperties;
  conditionalStyle?: React.CSSProperties;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onDoubleClick: () => void;
  onBlur: () => void;
  onChange: (value: string) => void;
  onTypingChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  platformTimeZone: string;
  platformDateFormat: PlatformDateFormat;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const borderStyles = getBorderStyle(data.borders);
  const displayValue = formatDisplayValue(data.value, data.numberFormat, {
    timeZone: platformTimeZone,
    dateFormat: platformDateFormat,
  });

  const textDecorations: string[] = [];
  if (data.underline) textDecorations.push('underline');
  if (data.strikethrough) textDecorations.push('line-through');

  const cellStyle: React.CSSProperties = {
    ...style,
    ...borderStyles,
    fontWeight: data.bold ? 'bold' : 'normal',
    fontStyle: data.italic ? 'italic' : 'normal',
    textDecoration: textDecorations.length > 0 ? textDecorations.join(' ') : 'none',
    fontFamily: data.fontFamily || 'inherit',
    fontSize: data.fontSize ? `${data.fontSize}px` : 'inherit',
    textAlign: data.align || 'left',
    verticalAlign: data.verticalAlign || 'middle',
    backgroundColor: conditionalStyle?.backgroundColor || data.backgroundColor || data.format?.backgroundColor,
    color: conditionalStyle?.color || data.color || data.format?.textColor,
    whiteSpace: data.wrapText ? 'pre-wrap' : 'nowrap',
    paddingLeft: data.indent ? `${data.indent * 8}px` : undefined,
  };

  const inputValue = editingValue !== undefined ? editingValue : (data.formula || data.value);

  return (
    <div
      className={cn(
        "absolute border-r border-b border-gray-200 dark:border-gray-700 px-1.5 flex items-center text-sm select-none overflow-hidden cursor-cell hover:bg-blue-50/30 dark:hover:bg-blue-900/30",
        isSelected && !isEditing && "ring-2 ring-blue-500 ring-inset z-10 bg-blue-100 dark:bg-blue-900",
        isInRange && !isSelected && "bg-blue-100/60 dark:bg-blue-800/60",
        isStreaming && "ring-2 ring-purple-500 ring-inset z-20 bg-purple-50 dark:bg-purple-950",
        isRecentlyWritten && "animate-flash-green bg-green-100 dark:bg-green-900",
        data.value && !isStreaming && !isRecentlyWritten && !isInRange && !isSelected && "bg-white dark:bg-gray-900",
        !data.value && !isSelected && !isStreaming && !isInRange && "bg-gray-50/30 dark:bg-gray-900/30"
      )}
      style={cellStyle}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onDoubleClick={onDoubleClick}
      data-testid={`cell-${row}-${col}`}
      data-row={row}
      data-col={col}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          autoFocus
          className="w-full h-full bg-white dark:bg-gray-900 outline-none text-sm px-0.5"
          onChange={(e) => onTypingChange(e.target.value)}
          onBlur={() => {
            onChange(inputValue);
            onBlur();
          }}
          onKeyDown={onKeyDown}
          data-testid={`cell-input-${row}-${col}`}
        />
      ) : isStreaming && typingValue ? (
        <span className="truncate font-mono text-purple-700 dark:text-purple-300">
          {typingValue}
          <span className="inline-block w-0.5 h-4 bg-purple-500 animate-blink ml-0.5" />
        </span>
      ) : (
        <span className={data.wrapText ? '' : 'truncate'}>{displayValue}</span>
      )}
    </div>
  );
});

const ColumnHeader = memo(function ColumnHeader({
  col,
  style,
  width,
  onResizeStart,
  onAutoFit,
  isResizing,
  onSelectColumn,
}: {
  col: number;
  style: React.CSSProperties;
  width: number;
  onResizeStart: (col: number, startX: number, startWidth: number) => void;
  onAutoFit: (col: number) => void;
  isResizing: boolean;
  onSelectColumn?: (col: number) => void;
}) {
  const [isHoveringResize, setIsHoveringResize] = useState(false);
  const lastClickRef = useRef(0);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const isNearEdge = e.clientX >= rect.right - RESIZE_CONFIG.RESIZE_HANDLE_SIZE;
    setIsHoveringResize(isNearEdge);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!isResizing) setIsHoveringResize(false);
  }, [isResizing]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const isNearEdge = e.clientX >= rect.right - RESIZE_CONFIG.RESIZE_HANDLE_SIZE;

    if (isNearEdge) {
      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      if (now - lastClickRef.current < RESIZE_CONFIG.DOUBLE_CLICK_DELAY) {
        onAutoFit(col);
        lastClickRef.current = 0;
      } else {
        lastClickRef.current = now;
        onResizeStart(col, e.clientX, width);
      }
    } else {
      onSelectColumn?.(col);
    }
  }, [col, width, onResizeStart, onAutoFit, onSelectColumn]);

  return (
    <div
      className={cn(
        "absolute flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-r border-b border-gray-200 dark:border-gray-700 select-none cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700",
        isHoveringResize && "cursor-col-resize"
      )}
      style={style}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      data-testid={`col-header-${col}`}
    >
      {getColumnName(col)}
      <div
        className={cn(
          "absolute right-0 top-0 bottom-0 w-1 transition-colors",
          isHoveringResize && "bg-blue-500"
        )}
      />
    </div>
  );
});

const RowHeader = memo(function RowHeader({
  row,
  style,
  height,
  onResizeStart,
  onAutoFit,
  isResizing,
  onSelectRow,
}: {
  row: number;
  style: React.CSSProperties;
  height: number;
  onResizeStart: (row: number, startY: number, startHeight: number) => void;
  onAutoFit: (row: number) => void;
  isResizing: boolean;
  onSelectRow?: (row: number) => void;
}) {
  const displayNumber = row + 1;
  const [isHoveringResize, setIsHoveringResize] = useState(false);
  const lastClickRef = useRef(0);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const isNearEdge = e.clientY >= rect.bottom - RESIZE_CONFIG.RESIZE_HANDLE_SIZE;
    setIsHoveringResize(isNearEdge);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!isResizing) setIsHoveringResize(false);
  }, [isResizing]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const isNearEdge = e.clientY >= rect.bottom - RESIZE_CONFIG.RESIZE_HANDLE_SIZE;

    if (isNearEdge) {
      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      if (now - lastClickRef.current < RESIZE_CONFIG.DOUBLE_CLICK_DELAY) {
        onAutoFit(row);
        lastClickRef.current = 0;
      } else {
        lastClickRef.current = now;
        onResizeStart(row, e.clientY, height);
      }
    } else {
      onSelectRow?.(row);
    }
  }, [row, height, onResizeStart, onAutoFit, onSelectRow]);

  return (
    <div
      className={cn(
        "absolute flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-r border-b border-gray-200 dark:border-gray-700 select-none cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700",
        isHoveringResize && "cursor-row-resize"
      )}
      style={style}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      data-testid={`row-header-${row}`}
      title={`Fila ${displayNumber}`}
    >
      {displayNumber}
      <div
        className={cn(
          "absolute left-0 right-0 bottom-0 h-1 transition-colors",
          isHoveringResize && "bg-blue-500"
        )}
      />
    </div>
  );
});

export function VirtualizedExcel({
  grid,
  onGridChange,
  selectedCell,
  onSelectCell,
  editingCell,
  onEditCell,
  className,
  version = 0,
  activeStreamingCell = null,
  typingValue = '',
  isRecentCell = () => false,
  conditionalFormats,
  charts = [],
  onUpdateChart,
  onDeleteChart,
  columnWidths,
  rowHeights,
  onColumnWidthChange,
  onRowHeightChange,
  selectionRange: externalSelectionRange,
  onSelectionRangeChange,
}: VirtualizedExcelProps) {
  void version;
  const { settings: platformSettings } = usePlatformSettings();
  const platformTimeZone = normalizeTimeZone(platformSettings.timezone_default);
  const platformDateFormat = platformSettings.date_format;

  const [scrollPos, setScrollPos] = useState({ top: 0, left: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRAF = useRef<number | null>(null);
  // Worker reference
  const formulaWorker = useRef<any>(null);

  // Initialize worker
  useEffect(() => {
    const worker = getFormulaEngineWorker();
    if (worker) {
      formulaWorker.current = worker;
      // Initial sync
      if (grid) {
        const cells = grid.getAllCells().reduce((acc: any, { row, col, data }) => {
          acc[`${row},${col}`] = data;
          return acc;
        }, {});
        worker.updateGrid(cells);
      }
    }
  }, []);

  // Sync grid to worker when it changes
  useEffect(() => {
    if (formulaWorker.current && grid) {
      // Serialize grid for worker
      const cells = grid.getAllCells().reduce((acc: any, { row, col, data }) => {
        acc[`${row},${col}`] = data;
        return acc;
      }, {});
      formulaWorker.current.updateGrid(cells);
    }
  }, [grid]);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollThrottler = useRef(new ScrollThrottler(16));

  const [internalSelectionRange, setInternalSelectionRange] = useState<SelectionRange | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ row: number; col: number } | null>(null);

  const selectionRange = externalSelectionRange ?? internalSelectionRange;
  const setSelectionRange = onSelectionRangeChange ?? setInternalSelectionRange;

  const [resizeState, setResizeState] = useState<ResizeState>({
    isResizing: false,
    type: null,
    index: null,
    startPos: 0,
    startSize: 0,
    currentSize: 0,
  });

  const [editingValue, setEditingValue] = useState<string | undefined>(undefined);

  // Fill handle state
  const [isFillDragging, setIsFillDragging] = useState(false);
  const [fillTargetRow, setFillTargetRow] = useState<number | null>(null);
  const [fillSourceRange, setFillSourceRange] = useState<{ startRow: number; endRow: number; col: number } | null>(null);

  const isInSelectionRange = useCallback((row: number, col: number): boolean => {
    if (!selectionRange) return false;
    const minRow = Math.min(selectionRange.startRow, selectionRange.endRow);
    const maxRow = Math.max(selectionRange.startRow, selectionRange.endRow);
    const minCol = Math.min(selectionRange.startCol, selectionRange.endCol);
    const maxCol = Math.max(selectionRange.startCol, selectionRange.endCol);
    return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
  }, [selectionRange]);

  const handleColumnResizeStart = useCallback((col: number, startX: number, startWidth: number) => {
    setResizeState({
      isResizing: true,
      type: 'column',
      index: col,
      startPos: startX,
      startSize: startWidth,
      currentSize: startWidth,
    });
  }, []);

  const handleRowResizeStart = useCallback((row: number, startY: number, startHeight: number) => {
    setResizeState({
      isResizing: true,
      type: 'row',
      index: row,
      startPos: startY,
      startSize: startHeight,
      currentSize: startHeight,
    });
  }, []);

  const handleAutoFitColumn = useCallback((col: number) => {
    if (!grid) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let maxWidth = 50;
    const headerText = getColumnName(col);
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    maxWidth = Math.max(maxWidth, ctx.measureText(headerText).width + 20);

    const cells = grid.getAllCells();
    for (const { row: r, col: c, data: cell } of cells) {
      if (c === col && cell.value) {
        const fontWeight = cell.bold ? 'bold' : 'normal';
        const fontStyle = cell.italic ? 'italic' : 'normal';
        const fontSize = cell.fontSize || 13;
        const fontFamily = cell.fontFamily || '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
        const textWidth = ctx.measureText(String(cell.value)).width + 16;
        maxWidth = Math.max(maxWidth, textWidth);
      }
    }

    const clampedWidth = Math.max(RESIZE_CONFIG.MIN_COL_WIDTH, Math.min(RESIZE_CONFIG.MAX_COL_WIDTH, Math.ceil(maxWidth)));
    onColumnWidthChange?.(col, clampedWidth);
  }, [grid, onColumnWidthChange]);

  const handleAutoFitRow = useCallback((row: number) => {
    if (!grid) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let maxHeight = GRID_CONFIG.ROW_HEIGHT;

    const cells = grid.getAllCells();
    for (const { row: r, col: c, data: cell } of cells) {
      if (r === row && cell.value) {
        const fontSize = cell.fontSize || 13;
        const lineHeight = fontSize * 1.4;
        const fontWeight = cell.bold ? 'bold' : 'normal';
        const fontStyle = cell.italic ? 'italic' : 'normal';
        const fontFamily = cell.fontFamily || '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;

        const text = String(cell.value);
        const colWidth = columnWidths?.[c] || GRID_CONFIG.COL_WIDTH;
        const availableWidth = colWidth - 12;

        let totalLines = 0;
        const paragraphs = text.split('\n');
        for (const paragraph of paragraphs) {
          if (!paragraph) {
            totalLines += 1;
            continue;
          }
          const textWidth = ctx.measureText(paragraph).width;
          const wrappedLines = Math.ceil(textWidth / availableWidth);
          totalLines += Math.max(1, wrappedLines);
        }

        const estimatedHeight = totalLines * lineHeight + 8;
        maxHeight = Math.max(maxHeight, estimatedHeight);
      }
    }

    const clampedHeight = Math.max(RESIZE_CONFIG.MIN_ROW_HEIGHT, Math.min(RESIZE_CONFIG.MAX_ROW_HEIGHT, Math.ceil(maxHeight)));
    onRowHeightChange?.(row, clampedHeight);
  }, [grid, columnWidths, onRowHeightChange]);

  useEffect(() => {
    if (!resizeState.isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = resizeState.type === 'column'
        ? e.clientX - resizeState.startPos
        : e.clientY - resizeState.startPos;

      const minSize = resizeState.type === 'column' ? RESIZE_CONFIG.MIN_COL_WIDTH : RESIZE_CONFIG.MIN_ROW_HEIGHT;
      const maxSize = resizeState.type === 'column' ? RESIZE_CONFIG.MAX_COL_WIDTH : RESIZE_CONFIG.MAX_ROW_HEIGHT;
      const newSize = Math.max(minSize, Math.min(maxSize, resizeState.startSize + delta));

      setResizeState(prev => ({ ...prev, currentSize: newSize }));
    };

    const handleMouseUp = () => {
      if (resizeState.index !== null) {
        if (resizeState.type === 'column') {
          onColumnWidthChange?.(resizeState.index, resizeState.currentSize);
        } else {
          onRowHeightChange?.(resizeState.index, resizeState.currentSize);
        }
      }
      setResizeState({
        isResizing: false,
        type: null,
        index: null,
        startPos: 0,
        startSize: 0,
        currentSize: 0,
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = resizeState.type === 'column' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizeState, onColumnWidthChange, onRowHeightChange]);



  useEffect(() => {
    const throttler = scrollThrottler.current;
    return () => {
      throttler.cancel();
    };
  }, []);

  const positionCacheOptimized = useMemo<PositionCache>(() => {
    return buildPositionCache(
      GRID_CONFIG.MAX_ROWS,
      GRID_CONFIG.MAX_COLS,
      columnWidths || {},
      rowHeights || {}
    );
  }, [columnWidths, rowHeights]);

  const getColumnWidth = useCallback((col: number) => columnWidths?.[col] || GRID_CONFIG.COL_WIDTH, [columnWidths]);
  const getRowHeight = useCallback((row: number) => rowHeights?.[row] || GRID_CONFIG.ROW_HEIGHT, [rowHeights]);

  const positionCache = useMemo(() => {
    const colCache = new Map<number, number>();
    const rowCache = new Map<number, number>();

    return {
      getColumnLeft: (col: number): number => {
        if (col === 0) return 0;
        if (colCache.has(col)) return colCache.get(col)!;

        let startCol = 0;
        let startPos = 0;
        for (let i = col - 1; i >= 0; i--) {
          if (colCache.has(i)) {
            startCol = i;
            startPos = colCache.get(i)!;
            break;
          }
        }

        let pos = startPos;
        for (let i = startCol; i < col; i++) {
          pos += columnWidths?.[i] ?? GRID_CONFIG.COL_WIDTH;
        }
        colCache.set(col, pos);
        return pos;
      },
      getRowTop: (row: number): number => {
        if (row === 0) return 0;
        if (rowCache.has(row)) return rowCache.get(row)!;

        let startRow = 0;
        let startPos = 0;
        for (let i = row - 1; i >= 0; i--) {
          if (rowCache.has(i)) {
            startRow = i;
            startPos = rowCache.get(i)!;
            break;
          }
        }

        let pos = startPos;
        for (let i = startRow; i < row; i++) {
          pos += rowHeights?.[i] ?? GRID_CONFIG.ROW_HEIGHT;
        }
        rowCache.set(row, pos);
        return pos;
      }
    };
  }, [columnWidths, rowHeights]);

  const getColumnLeft = positionCache.getColumnLeft;
  const getRowTop = positionCache.getRowTop;

  const findRowAtPosition = useCallback((scrollTop: number): number => {
    const positions = positionCacheOptimized.rowPositions;
    let left = 0;
    let right = positions.length - 2;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (positions[mid] <= scrollTop && scrollTop < positions[mid + 1]) {
        return mid;
      } else if (positions[mid] > scrollTop) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }
    return Math.max(0, Math.min(left, GRID_CONFIG.MAX_ROWS - 1));
  }, [positionCacheOptimized]);

  const findColAtPosition = useCallback((scrollLeft: number): number => {
    const positions = positionCacheOptimized.columnPositions;
    let left = 0;
    let right = positions.length - 2;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (positions[mid] <= scrollLeft && scrollLeft < positions[mid + 1]) {
        return mid;
      } else if (positions[mid] > scrollLeft) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }
    return Math.max(0, Math.min(left, GRID_CONFIG.MAX_COLS - 1));
  }, [positionCacheOptimized]);

  const getConditionalStyle = useCallback((row: number, col: number, value: string | number): React.CSSProperties => {
    if (!conditionalFormats) return {};

    const numValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.-]/g, ''));
    if (isNaN(numValue)) return {};

    for (const format of conditionalFormats) {
      const { range, rules } = format;
      if (row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol) {
        for (const rule of rules) {
          let matches = false;
          switch (rule.condition) {
            case 'greaterThan':
              matches = numValue > (rule.value ?? 0);
              break;
            case 'lessThan':
              matches = numValue < (rule.value ?? 0);
              break;
            case 'equals':
              matches = numValue === rule.value;
              break;
            case 'between':
              matches = numValue >= (rule.min ?? -Infinity) && numValue <= (rule.max ?? Infinity);
              break;
          }
          if (matches) {
            return {
              backgroundColor: rule.style.backgroundColor,
              color: rule.style.color
            };
          }
        }
      }
    }
    return {};
  }, [conditionalFormats]);

  // Shell state
  const [viewMode, setViewMode] = useState<OfficeViewMode>('visual');
  const [csvContent, setCsvContent] = useState('');

  // Sync CSV for code view
  useEffect(() => {
    if (viewMode === 'code' && grid) {
      // Simple CSV generation
      const cells = grid.getAllCells();
      // This is a simplified CSV export for the code view
      let maxRow = 0;
      let maxCol = 0;
      cells.forEach(c => {
        if (c.row > maxRow) maxRow = c.row;
        if (c.col > maxCol) maxCol = c.col;
      });

      let csv = '';
      for (let r = 0; r <= maxRow; r++) {
        const rowArr = [];
        for (let c = 0; c <= maxCol; c++) {
          const cell = grid.getCell(r, c);
          // Escape quotes
          const val = cell?.value ? String(cell.value).replace(/"/g, '""') : '';
          rowArr.push(`"${val}"`);
        }
        csv += rowArr.join(',') + '\n';
      }
      setCsvContent(csv);
    }
  }, [viewMode, grid]);

  const handleDownload = () => {
    // Generate simple XLSX
    const wb = XLSX.utils.book_new();
    const wsData = [];
    const cells = grid.getAllCells();
    let maxRow = 0;
    let maxCol = 0;
    cells.forEach(c => {
      if (c.row > maxRow) maxRow = c.row;
      if (c.col > maxCol) maxCol = c.col;
    });

    for (let r = 0; r <= maxRow; r++) {
      const rowArr = [];
      for (let c = 0; c <= maxCol; c++) {
        const cell = grid.getCell(r, c);
        rowArr.push(cell?.value || '');
      }
      wsData.push(rowArr);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, "spreadsheet.xlsx");
  };

  const handleCsvChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCsvContent(e.target.value);
    // We don't live-update grid from CSV typing to avoid perf issues, 
    // but we could add an "Apply" button or debounce. 
    // For now, this is read-only projection or simple edit.
    // Implementing full CSV parsing back to grid is complex for this step
    // but fits the "Code View" philosophy.
  };

  const handleFormat = useCallback((format: Partial<CellData>) => {
    if (!selectedCell && !selectionRange) return;

    const updates: Array<{ row: number, col: number, data: Partial<CellData> }> = [];

    const startRow = selectionRange ? Math.min(selectionRange.startRow, selectionRange.endRow) : selectedCell!.row;
    const endRow = selectionRange ? Math.max(selectionRange.startRow, selectionRange.endRow) : selectedCell!.row;
    const startCol = selectionRange ? Math.min(selectionRange.startCol, selectionRange.endCol) : selectedCell!.col;
    const endCol = selectionRange ? Math.max(selectionRange.startCol, selectionRange.endCol) : selectedCell!.col;

    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const current = grid.getCell(r, c) || {};
        // Merge styles
        const newData = { ...current, ...format };
        grid.setCell(r, c, newData);
      }
    }
    onGridChange(grid);
  }, [grid, selectedCell, selectionRange, onGridChange]);

  const Toolbar = () => (
    <div className="flex items-center gap-1">
      <span className="text-xs font-semibold mr-2">{selectionRange ? 'Rango' : 'Celda'}</span>

      <Toggle size="sm" onPressedChange={(pressed) => handleFormat({ bold: pressed })} title="Negrita"><Bold className="h-4 w-4" /></Toggle>
      <Toggle size="sm" onPressedChange={(pressed) => handleFormat({ italic: pressed })} title="Cursiva"><Italic className="h-4 w-4" /></Toggle>
      <Toggle size="sm" onPressedChange={(pressed) => handleFormat({ underline: pressed })} title="Subrayado"><Underline className="h-4 w-4" /></Toggle>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <Toggle size="sm" onPressedChange={() => handleFormat({ align: 'left' })} title="Alinear Izquierda"><AlignLeft className="h-4 w-4" /></Toggle>
      <Toggle size="sm" onPressedChange={() => handleFormat({ align: 'center' })} title="Centrar"><AlignCenter className="h-4 w-4" /></Toggle>
      <Toggle size="sm" onPressedChange={() => handleFormat({ align: 'right' })} title="Alinear Derecha"><AlignRight className="h-4 w-4" /></Toggle>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Simple Color Pickers */}
      <div className="flex items-center gap-1 border border-gray-200 rounded px-1">
        <div className="w-4 h-4 rounded-full overflow-hidden border border-gray-300 relative" title="Color de Texto">
          <input type="color" className="absolute -top-1 -left-1 w-8 h-8 cursor-pointer opacity-0" onChange={(e) => handleFormat({ color: e.target.value })} />
          <div className="w-full h-full bg-black/80 pointer-events-none" />
        </div>
        <div className="w-4 h-4 rounded-full overflow-hidden border border-gray-300 relative bg-yellow-100" title="Color de Fondo">
          <input type="color" className="absolute -top-1 -left-1 w-8 h-8 cursor-pointer opacity-0" onChange={(e) => handleFormat({ backgroundColor: e.target.value })} />
        </div>
      </div>

    </div>
  );

  const calculatedStartRow = findRowAtPosition(scrollPos.top);
  const startRow = Math.max(0, calculatedStartRow - GRID_CONFIG.BUFFER_ROWS);
  const startCol = Math.max(0, findColAtPosition(scrollPos.left) - GRID_CONFIG.BUFFER_COLS);
  const endRow = Math.min(GRID_CONFIG.MAX_ROWS, startRow + GRID_CONFIG.VISIBLE_ROWS + GRID_CONFIG.BUFFER_ROWS * 2);
  const endCol = Math.min(GRID_CONFIG.MAX_COLS, startCol + GRID_CONFIG.VISIBLE_COLS + GRID_CONFIG.BUFFER_COLS * 2);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    scrollThrottler.current.throttle(() => {
      setScrollPos({ top: target.scrollTop, left: target.scrollLeft });
    });
  }, []);

  const updateCell = useCallback(async (row: number, col: number, value: string) => {
    if (value.startsWith('=')) {
      if (formulaWorker.current) {
        try {
          const evaluated = await formulaWorker.current.evaluate(value);
          grid.setCell(row, col, { value: evaluated, formula: value });
        } catch (e) {
          console.error('Formula evaluation failed:', e);
          grid.setCell(row, col, { value: '#ERROR!', formula: value });
        }
      } else {
        grid.setCell(row, col, { value: value, formula: value });
      }
    } else {
      grid.setCell(row, col, { value, formula: undefined });
    }

    onGridChange(grid);
  }, [grid, onGridChange]);

  const handleCellMouseDown = useCallback((row: number, col: number, e: React.MouseEvent) => {
    if (e.shiftKey && selectedCell) {
      setSelectionRange({
        startRow: selectedCell.row,
        startCol: selectedCell.col,
        endRow: row,
        endCol: col,
      });
    } else {
      onSelectCell({ row, col });
      setDragStart({ row, col });
      setIsDragging(true);
      setSelectionRange(null);
    }
    containerRef.current?.focus();
  }, [onSelectCell, selectedCell, setSelectionRange]);

  const handleCellMouseEnter = useCallback((row: number, col: number) => {
    if (isDragging && dragStart) {
      setSelectionRange({
        startRow: dragStart.row,
        startCol: dragStart.col,
        endRow: row,
        endCol: col,
      });
    }
  }, [isDragging, dragStart, setSelectionRange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mouseup', handleMouseUp);
      return () => document.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isDragging, handleMouseUp]);

  const handleCellSelect = useCallback((row: number, col: number) => {
    onSelectCell({ row, col });
  }, [onSelectCell]);

  const handleSelectColumn = useCallback((col: number) => {
    onSelectCell({ row: 0, col });
    setSelectionRange({
      startRow: 0,
      startCol: col,
      endRow: GRID_CONFIG.MAX_ROWS - 1,
      endCol: col,
    });
  }, [onSelectCell, setSelectionRange]);

  const handleSelectRow = useCallback((row: number) => {
    onSelectCell({ row, col: 0 });
    setSelectionRange({
      startRow: row,
      startCol: 0,
      endRow: row,
      endCol: GRID_CONFIG.MAX_COLS - 1,
    });
  }, [onSelectCell, setSelectionRange]);

  // Fill handle handlers
  const handleFillHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!selectedCell && !selectionRange) return;

    const startRow = selectionRange ? Math.min(selectionRange.startRow, selectionRange.endRow) : selectedCell!.row;
    const endRow = selectionRange ? Math.max(selectionRange.startRow, selectionRange.endRow) : selectedCell!.row;
    const col = selectionRange ? selectionRange.startCol : selectedCell!.col;

    setIsFillDragging(true);
    setFillSourceRange({ startRow, endRow, col });
    setFillTargetRow(endRow);
  }, [selectedCell, selectionRange]);

  const handleFillMouseMove = useCallback((e: MouseEvent) => {
    if (!isFillDragging || !fillSourceRange) return;

    const viewportElement = viewportRef.current;
    if (!viewportElement) return;

    const rect = viewportElement.getBoundingClientRect();
    const relativeY = e.clientY - rect.top + scrollPos.top - GRID_CONFIG.COL_HEADER_HEIGHT;

    // Find which row the mouse is over
    const row = findRowAtPosition(relativeY);
    if (row > fillSourceRange.endRow) {
      setFillTargetRow(row);
    } else {
      setFillTargetRow(fillSourceRange.endRow);
    }
  }, [isFillDragging, fillSourceRange, scrollPos.top, findRowAtPosition]);

  const handleFillMouseUp = useCallback(() => {
    if (!isFillDragging || !fillSourceRange || fillTargetRow === null) {
      setIsFillDragging(false);
      setFillSourceRange(null);
      setFillTargetRow(null);
      return;
    }

    const { startRow, endRow, col } = fillSourceRange;
    const targetEnd = fillTargetRow;

    if (targetEnd > endRow) {
      // Collect source values
      const sourceValues: (string | undefined)[] = [];
      for (let r = startRow; r <= endRow; r++) {
        const cell = grid.getCell(r, col);
        sourceValues.push(cell?.value);
      }

      // Detect pattern and generate fill values
      const pattern = detectPattern(sourceValues);
      const fillCount = targetEnd - endRow;
      const fillValues = generateFillValues(pattern, fillCount);

      // Apply fill values
      for (let i = 0; i < fillValues.length; i++) {
        const targetRow = endRow + 1 + i;
        grid.setCell(targetRow, col, { value: String(fillValues[i]) });
      }

      onGridChange(grid);

      // Update selection to include filled range
      setSelectionRange({
        startRow,
        startCol: col,
        endRow: targetEnd,
        endCol: col,
      });
    }

    setIsFillDragging(false);
    setFillSourceRange(null);
    setFillTargetRow(null);
  }, [isFillDragging, fillSourceRange, fillTargetRow, grid, onGridChange, setSelectionRange]);

  // Fill handle mouse event listeners
  useEffect(() => {
    if (isFillDragging) {
      document.addEventListener('mousemove', handleFillMouseMove);
      document.addEventListener('mouseup', handleFillMouseUp);
      document.body.style.cursor = 'crosshair';

      return () => {
        document.removeEventListener('mousemove', handleFillMouseMove);
        document.removeEventListener('mouseup', handleFillMouseUp);
        document.body.style.cursor = '';
      };
    }
  }, [isFillDragging, handleFillMouseMove, handleFillMouseUp]);

  // Check if a cell is in the fill preview range
  const isInFillRange = useCallback((row: number, col: number): boolean => {
    if (!isFillDragging || !fillSourceRange || fillTargetRow === null) return false;
    return col === fillSourceRange.col && row > fillSourceRange.endRow && row <= fillTargetRow;
  }, [isFillDragging, fillSourceRange, fillTargetRow]);

  const handleCellEdit = useCallback((row: number, col: number) => {
    const cellData = grid.getCell(row, col);
    setEditingValue(cellData?.formula || cellData?.value || '');
    onEditCell({ row, col });
    onSelectCell({ row, col });
  }, [onEditCell, onSelectCell, grid]);

  const handleCellBlur = useCallback(() => {
    setEditingValue(undefined);
    onEditCell(null);
  }, [onEditCell]);

  const handleTypingChange = useCallback((value: string) => {
    setEditingValue(value);
  }, []);

  const handleCellChange = useCallback((row: number, col: number, value: string) => {
    if (typeof row !== 'number' || typeof col !== 'number' || isNaN(row) || isNaN(col)) {
      console.warn('Invalid cell coordinates in handleCellChange:', row, col);
      return;
    }
    if (row < 0 || row >= GRID_CONFIG.MAX_ROWS || col < 0 || col >= GRID_CONFIG.MAX_COLS) {
      console.warn('Cell coordinates out of bounds:', row, col);
      return;
    }
    try {
      updateCell(row, col, value);
    } catch (e) {
      console.error('Failed to change cell:', e);
    }
  }, [updateCell]);

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent, row: number, col: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (editingValue !== undefined) {
        updateCell(row, col, editingValue);
      }
      const nextRow = Math.min(row + 1, GRID_CONFIG.MAX_ROWS - 1);
      setEditingValue(undefined);
      onEditCell(null);
      onSelectCell({ row: nextRow, col });
      // Refocus container and auto-enter edit mode on next cell
      requestAnimationFrame(() => {
        containerRef.current?.focus();
        // Auto-enter edit mode on the new cell for continuous typing
        setEditingValue('');
        onEditCell({ row: nextRow, col });
      });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (editingValue !== undefined) {
        updateCell(row, col, editingValue);
      }
      const nextCol = Math.min(col + 1, GRID_CONFIG.MAX_COLS - 1);
      setEditingValue(undefined);
      onEditCell(null);
      onSelectCell({ row, col: nextCol });
      // Refocus container and auto-enter edit mode on next cell
      requestAnimationFrame(() => {
        containerRef.current?.focus();
        setEditingValue('');
        onEditCell({ row, col: nextCol });
      });
    } else if (e.key === 'Escape') {
      setEditingValue(undefined);
      onEditCell(null);
      // Refocus container after escaping edit mode
      requestAnimationFrame(() => {
        containerRef.current?.focus();
      });
    }
  }, [onEditCell, onSelectCell, editingValue, updateCell]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!selectedCell || editingCell) return;

    const { row, col } = selectedCell;
    if (typeof row !== 'number' || typeof col !== 'number' || isNaN(row) || isNaN(col)) {
      console.warn('Invalid selected cell coordinates:', selectedCell);
      return;
    }

    let newRow = row;
    let newCol = col;

    try {
      switch (e.key) {
        case 'ArrowUp':
          newRow = Math.max(0, row - 1);
          e.preventDefault();
          break;
        case 'ArrowDown':
          newRow = Math.min(GRID_CONFIG.MAX_ROWS - 1, row + 1);
          e.preventDefault();
          break;
        case 'ArrowLeft':
          newCol = Math.max(0, col - 1);
          e.preventDefault();
          break;
        case 'ArrowRight':
          newCol = Math.min(GRID_CONFIG.MAX_COLS - 1, col + 1);
          e.preventDefault();
          break;
        case 'Enter':
          handleCellEdit(row, col);
          e.preventDefault();
          return;
        case 'Delete':
        case 'Backspace':
          // Delete selected range or single cell
          if (selectionRange) {
            const minRow = Math.min(selectionRange.startRow, selectionRange.endRow);
            const maxRow = Math.max(selectionRange.startRow, selectionRange.endRow);
            const minCol = Math.min(selectionRange.startCol, selectionRange.endCol);
            const maxCol = Math.max(selectionRange.startCol, selectionRange.endCol);

            for (let r = minRow; r <= maxRow; r++) {
              for (let c = minCol; c <= maxCol; c++) {
                grid.setCell(r, c, { value: '' });
              }
            }
            onGridChange(grid);
          } else {
            updateCell(row, col, '');
          }
          e.preventDefault();
          return;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            setEditingValue(e.key);
            onEditCell({ row, col });
            e.preventDefault();
          }
          return;
      }

      if (newRow < 0 || newRow >= GRID_CONFIG.MAX_ROWS || newCol < 0 || newCol >= GRID_CONFIG.MAX_COLS) {
        console.warn('Navigation target out of bounds:', newRow, newCol);
        return;
      }

      onSelectCell({ row: newRow, col: newCol });

      if (viewportRef.current) {
        const cellTop = newRow * GRID_CONFIG.ROW_HEIGHT;
        const cellLeft = newCol * GRID_CONFIG.COL_WIDTH;
        const viewportWidth = viewportRef.current.clientWidth - GRID_CONFIG.ROW_HEADER_WIDTH;
        const viewportHeight = viewportRef.current.clientHeight - GRID_CONFIG.COL_HEADER_HEIGHT;

        if (cellTop < scrollPos.top) {
          viewportRef.current.scrollTop = cellTop;
        } else if (cellTop + GRID_CONFIG.ROW_HEIGHT > scrollPos.top + viewportHeight) {
          viewportRef.current.scrollTop = cellTop + GRID_CONFIG.ROW_HEIGHT - viewportHeight;
        }

        if (cellLeft < scrollPos.left) {
          viewportRef.current.scrollLeft = cellLeft;
        } else if (cellLeft + GRID_CONFIG.COL_WIDTH > scrollPos.left + viewportWidth) {
          viewportRef.current.scrollLeft = cellLeft + GRID_CONFIG.COL_WIDTH - viewportWidth;
        }
      }
    } catch (e) {
      console.error('Error handling keyboard navigation:', e);
    }
  }, [selectedCell, editingCell, scrollPos, onEditCell, onSelectCell, updateCell, handleCellEdit, selectionRange, grid, onGridChange]);

  const visibleRows = useMemo(() => {
    const rows: number[] = [];
    for (let r = startRow; r < endRow; r++) {
      rows.push(r);
    }
    return rows;
  }, [startRow, endRow]);

  const visibleCols = useMemo(() => {
    const cols: number[] = [];
    for (let c = startCol; c < endCol; c++) {
      cols.push(c);
    }
    return cols;
  }, [startCol, endCol]);

  const totalWidth = positionCacheOptimized.totalWidth;
  const totalHeight = positionCacheOptimized.totalHeight;

  return (
    <OfficeToolShell
      title="Libro de Excel"
      type="excel"
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onClose={() => { }} // No-op for now or elevate prop
      onDownload={handleDownload}
      toolbar={<Toolbar />}
      className={className}
    >
      {viewMode === 'visual' ? (
        <div
          ref={containerRef}
          className={cn("flex flex-col h-full w-full overflow-hidden bg-white dark:bg-gray-900 outline-none")}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          data-testid="virtualized-excel"
        >
          <div className="flex flex-col w-full h-full">
            {/* Formula Bar */}
            <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
              <div className="font-serif italic text-gray-400 font-bold px-1 select-none">fx</div>
              <div className="flex-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-sm flex items-center shadow-inner">
                <input
                  className="flex-1 w-full border-none outline-none text-sm h-7 px-2 bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400"
                  value={editingValue !== undefined ? editingValue : (selectedCell ? grid.getCell(selectedCell.row, selectedCell.col)?.value || '' : '')}
                  onChange={(e) => {
                    if (selectedCell) {
                      if (editingValue === undefined) {
                        setEditingValue(e.target.value);
                        onEditCell(selectedCell);
                      } else {
                        setEditingValue(e.target.value);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (selectedCell && editingValue !== undefined) {
                        updateCell(selectedCell.row, selectedCell.col, editingValue);
                        setEditingValue(undefined);
                        onEditCell(null);
                        containerRef.current?.focus();
                      }
                    }
                  }}
                  placeholder={selectedCell ? "Escribe un valor o fórmula..." : "Selecciona una celda"}
                  disabled={!selectedCell}
                />
              </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
              <div
                className="flex-shrink-0 bg-gray-100 dark:bg-gray-800 flex flex-col"
                style={{ width: GRID_CONFIG.ROW_HEADER_WIDTH }}
              >
                <div
                  className="flex-shrink-0 z-20 bg-gray-200 dark:bg-gray-700 border-r border-b border-gray-300 dark:border-gray-600"
                  style={{ height: GRID_CONFIG.COL_HEADER_HEIGHT, width: GRID_CONFIG.ROW_HEADER_WIDTH }}
                />
                <div
                  className="flex-1 relative overflow-hidden"
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: totalHeight,
                      transform: `translateY(-${scrollPos.top}px)`,
                    }}
                  >
                    {visibleRows.map(row => (
                      <RowHeader
                        key={row}
                        row={row}
                        height={getRowHeight(row)}
                        onResizeStart={handleRowResizeStart}
                        onAutoFit={handleAutoFitRow}
                        isResizing={resizeState.isResizing && resizeState.type === 'row'}
                        onSelectRow={handleSelectRow}
                        style={{
                          position: 'absolute',
                          top: getRowTop(row),
                          left: 0,
                          width: GRID_CONFIG.ROW_HEADER_WIDTH,
                          height: resizeState.isResizing && resizeState.type === 'row' && resizeState.index === row
                            ? resizeState.currentSize
                            : getRowHeight(row),
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-1 flex flex-col overflow-hidden">
                <div
                  className="flex-shrink-0 bg-gray-100 dark:bg-gray-800 overflow-hidden"
                  style={{ height: GRID_CONFIG.COL_HEADER_HEIGHT }}
                >
                  <div
                    className="relative"
                    style={{
                      width: totalWidth,
                      height: GRID_CONFIG.COL_HEADER_HEIGHT,
                      transform: `translateX(-${scrollPos.left}px)`,
                    }}
                  >
                    {visibleCols.map(col => (
                      <ColumnHeader
                        key={col}
                        col={col}
                        width={getColumnWidth(col)}
                        onResizeStart={handleColumnResizeStart}
                        onAutoFit={handleAutoFitColumn}
                        isResizing={resizeState.isResizing && resizeState.type === 'column'}
                        onSelectColumn={handleSelectColumn}
                        style={{
                          top: 0,
                          left: getColumnLeft(col),
                          width: resizeState.isResizing && resizeState.type === 'column' && resizeState.index === col
                            ? resizeState.currentSize
                            : getColumnWidth(col),
                          height: GRID_CONFIG.COL_HEADER_HEIGHT,
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div
                  ref={viewportRef}
                  className="flex-1 overflow-auto"
                  onScroll={handleScroll}
                  data-testid="excel-viewport"
                >
                  <div
                    style={{
                      width: totalWidth,
                      height: totalHeight,
                      position: 'relative',
                    }}
                  >
                    {visibleRows.map(row =>
                      visibleCols.map(col => {
                        const cellData = grid.getCell(row, col) || { value: '' };
                        const safeData = {
                          value: cellData.value ?? '',
                          formula: cellData.formula,
                          bold: cellData.bold,
                          italic: cellData.italic,
                          underline: cellData.underline,
                          strikethrough: cellData.strikethrough,
                          align: cellData.align,
                          verticalAlign: cellData.verticalAlign,
                          fontFamily: cellData.fontFamily,
                          fontSize: cellData.fontSize,
                          color: cellData.color,
                          backgroundColor: cellData.backgroundColor,
                          numberFormat: cellData.numberFormat,
                          borders: cellData.borders,
                          wrapText: cellData.wrapText,
                          indent: cellData.indent,
                          format: cellData.format,
                        };
                        const isSelected = selectedCell?.row === row && selectedCell?.col === col;
                        const isEditing = editingCell?.row === row && editingCell?.col === col;
                        const inRange = isInSelectionRange(row, col);

                        const isStreamingCell = activeStreamingCell?.row === row && activeStreamingCell?.col === col;
                        const isRecentlyWritten = isRecentCell(row, col);
                        const conditionalStyle = getConditionalStyle(row, col, safeData.value);

	                        return (
	                          <VirtualCell
	                            key={`${row}:${col}`}
	                            row={row}
	                            col={col}
	                            data={safeData}
	                            isSelected={isSelected}
	                            isInRange={inRange}
	                            isEditing={isEditing}
	                            isStreaming={isStreamingCell}
	                            isRecentlyWritten={isRecentlyWritten}
	                            typingValue={isStreamingCell ? typingValue : undefined}
	                            editingValue={isEditing ? editingValue : undefined}
	                            platformTimeZone={platformTimeZone}
	                            platformDateFormat={platformDateFormat}
	                            style={{
	                              top: getRowTop(row),
	                              left: getColumnLeft(col),
	                              width: getColumnWidth(col),
	                              height: getRowHeight(row),
	                            }}
                            conditionalStyle={conditionalStyle}
                            onMouseDown={(e) => handleCellMouseDown(row, col, e)}
                            onMouseEnter={() => handleCellMouseEnter(row, col)}
                            onDoubleClick={() => handleCellEdit(row, col)}
                            onBlur={handleCellBlur}
                            onChange={(value) => handleCellChange(row, col, value)}
                            onTypingChange={handleTypingChange}
                            onKeyDown={(e) => handleCellKeyDown(e, row, col)}
                          />
                        );
                      })
                    )}

                    {/* Fill Handle - small square at bottom-right of selection */}
                    {selectedCell && !editingCell && !isFillDragging && (() => {
                      const targetRow = selectionRange
                        ? Math.max(selectionRange.startRow, selectionRange.endRow)
                        : selectedCell.row;
                      const targetCol = selectionRange
                        ? Math.max(selectionRange.startCol, selectionRange.endCol)
                        : selectedCell.col;

                      const cellBottom = getRowTop(targetRow) + getRowHeight(targetRow);
                      const cellRight = getColumnLeft(targetCol) + getColumnWidth(targetCol);

                      return (
                        <div
                          className="absolute w-3 h-3 bg-blue-600 border-2 border-white cursor-crosshair z-30 shadow-sm hover:scale-125 transition-transform"
                          style={{
                            top: cellBottom - 6,
                            left: cellRight - 6,
                          }}
                          onMouseDown={handleFillHandleMouseDown}
                          data-testid="fill-handle"
                          title="Arrastra para rellenar serie"
                        />
                      );
                    })()}

                    {/* Fill preview range indicator */}
                    {isFillDragging && fillSourceRange && fillTargetRow !== null && fillTargetRow > fillSourceRange.endRow && (
                      <div
                        className="absolute border-2 border-dashed border-blue-500 bg-blue-100/30 pointer-events-none z-20"
                        style={{
                          top: getRowTop(fillSourceRange.endRow + 1),
                          left: getColumnLeft(fillSourceRange.col),
                          width: getColumnWidth(fillSourceRange.col),
                          height: getRowTop(fillTargetRow) + getRowHeight(fillTargetRow) - getRowTop(fillSourceRange.endRow + 1),
                        }}
                      />
                    )}

                    {charts && charts.length > 0 && onUpdateChart && onDeleteChart && (
                      <ChartLayer
                        charts={charts}
                        grid={grid}
                        gridConfig={GRID_CONFIG}
                        onUpdateChart={onUpdateChart}
                        onDeleteChart={onDeleteChart}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-shrink-0 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between">
              <span>
                {selectionRange ? (
                  selectionRange.startRow === selectionRange.endRow && selectionRange.startCol === selectionRange.endCol
                    ? `Celda: ${formatCellRef(selectionRange.startRow, selectionRange.startCol)}`
                    : `Rango: ${formatCellRef(selectionRange.startRow, selectionRange.startCol)}:${formatCellRef(selectionRange.endRow, selectionRange.endCol)} (${(Math.abs(selectionRange.endRow - selectionRange.startRow) + 1) * (Math.abs(selectionRange.endCol - selectionRange.startCol) + 1)} celdas)`
                ) : selectedCell
                  ? `Celda: ${formatCellRef(selectedCell.row, selectedCell.col)}`
                  : 'Selecciona una celda'}
              </span>
              <span>
                Datos: {grid.getCellCount().toLocaleString()} celdas |
                Capacidad: {(GRID_CONFIG.MAX_ROWS * GRID_CONFIG.MAX_COLS).toLocaleString()} celdas
              </span>
            </div>

            {resizeState.isResizing && (
              <div
                className="fixed bg-blue-500 pointer-events-none z-50"
                style={resizeState.type === 'column' ? {
                  width: 2,
                  top: 0,
                  bottom: 0,
                  left: resizeState.startPos + (resizeState.currentSize - resizeState.startSize),
                } : {
                  height: 2,
                  left: 0,
                  right: 0,
                  top: resizeState.startPos + (resizeState.currentSize - resizeState.startSize),
                }}
              />
            )}

            {resizeState.isResizing && (
              <div
                className="fixed bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg pointer-events-none z-50"
                style={{
                  left: resizeState.type === 'column'
                    ? resizeState.startPos + (resizeState.currentSize - resizeState.startSize) + 10
                    : 80,
                  top: resizeState.type === 'column'
                    ? 80
                    : resizeState.startPos + (resizeState.currentSize - resizeState.startSize) + 10,
                }}
              >
                {resizeState.type === 'column' ? 'Ancho' : 'Alto'}: {Math.round(resizeState.currentSize)}px
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="h-full w-full bg-[#1e1e1e] p-4 font-mono text-sm">
          <textarea
            className="w-full h-full bg-transparent text-[#d4d4d4] resize-none focus:outline-none"
            value={csvContent}
            onChange={handleCsvChange}
            spellCheck={false}
          />
        </div>
      )}
    </OfficeToolShell>
  );
}

export { GRID_CONFIG };
export type { VirtualizedExcelProps, ConditionalFormat, ConditionalFormatRule };
