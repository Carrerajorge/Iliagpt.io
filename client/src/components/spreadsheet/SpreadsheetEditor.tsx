import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { HotTable } from '@handsontable/react';
import { registerAllModules } from 'handsontable/registry';
import Handsontable from 'handsontable';
import 'handsontable/dist/handsontable.full.min.css';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  Download, Upload, Plus, Trash2, Save, FileSpreadsheet,
  Table, BarChart3, Calculator, Filter, SortAsc, Search,
  Undo, Redo, Copy, Clipboard, Scissors, Bold, Italic,
  AlignLeft, AlignCenter, AlignRight, Palette, Grid3X3, Type
} from 'lucide-react';
import '../../styles/spreadsheet.css';
import { useSpreadsheetStreaming } from './useSpreadsheetStreaming';
import { AICommandBar } from './AICommandBar';
import { StreamingIndicator } from './StreamingIndicator';
import { ExcelContextMenu } from './ExcelContextMenu';

registerAllModules();

type AutofillPattern = {
  type: 'arithmetic' | 'geometric' | 'date' | 'list' | 'alphanumeric' | 'repeat_sequence' | 'copy';
  values: any[];
  start?: number;
  step?: number;
  ratio?: number;
  lastDate?: Date;
  dayStep?: number;
  format?: string;
  list?: string[];
  lastIndex?: number;
  originalCase?: string;
  prefix?: string;
  lastNumber?: number;
};

function parseDate(value: any): Date | null {
  const str = String(value);
  const formats = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  ];

  for (const regex of formats) {
    const match = str.match(regex);
    if (match) {
      let day: string, month: string, year: string;
      if (regex.source.startsWith('^(\\d{4})')) {
        [, year, month, day] = match;
      } else {
        [, day, month, year] = match;
      }
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) return date;
    }
  }
  return null;
}

function detectDateFormat(value: any): string {
  const str = String(value);
  if (str.includes('/')) {
    if (str.match(/^\d{4}\//)) return 'YYYY/MM/DD';
    return 'DD/MM/YYYY';
  }
  if (str.includes('-')) {
    if (str.match(/^\d{4}-/)) return 'YYYY-MM-DD';
    return 'DD-MM-YYYY';
  }
  return 'DD/MM/YYYY';
}

function formatDate(date: Date, format: string): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  switch (format) {
    case 'YYYY/MM/DD': return `${year}/${month}/${day}`;
    case 'YYYY-MM-DD': return `${year}-${month}-${day}`;
    case 'DD-MM-YYYY': return `${day}-${month}-${year}`;
    case 'DD/MM/YYYY':
    default: return `${day}/${month}/${year}`;
  }
}

function detectCase(str: string): string {
  if (str === str.toUpperCase()) return 'upper';
  if (str === str.toLowerCase()) return 'lower';
  if (str[0] === str[0].toUpperCase()) return 'capitalize';
  return 'mixed';
}

function applyCase(str: string, caseType: string): string {
  switch (caseType) {
    case 'upper': return str.toUpperCase();
    case 'lower': return str.toLowerCase();
    case 'capitalize': return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    default: return str;
  }
}

function detectTextPattern(values: any[]): AutofillPattern | null {
  const daysES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const daysEN = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const daysShortES = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  const daysShortEN = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const monthsES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const monthsEN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthsShortES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const monthsShortEN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const quarters = ['q1', 'q2', 'q3', 'q4', 't1', 't2', 't3', 't4'];

  const lowerValues = values.map(v => String(v).toLowerCase().trim());

  const lists = [
    { name: 'days', list: daysES },
    { name: 'days', list: daysEN },
    { name: 'days', list: daysShortES },
    { name: 'days', list: daysShortEN },
    { name: 'months', list: monthsES },
    { name: 'months', list: monthsEN },
    { name: 'months', list: monthsShortES },
    { name: 'months', list: monthsShortEN },
    { name: 'quarters', list: quarters }
  ];

  for (const { list } of lists) {
    const indices = lowerValues.map(v => list.indexOf(v));
    if (indices.every(i => i !== -1)) {
      let isConsecutive = true;
      for (let i = 1; i < indices.length; i++) {
        const expectedNext = (indices[i - 1] + 1) % list.length;
        if (indices[i] !== expectedNext) {
          isConsecutive = false;
          break;
        }
      }
      if (isConsecutive || indices.length === 1) {
        return {
          type: 'list',
          values,
          list,
          lastIndex: indices[indices.length - 1],
          originalCase: detectCase(String(values[0]))
        };
      }
    }
  }
  return null;
}

function detectAlphanumericPattern(values: any[]): AutofillPattern | null {
  const regex = /^(.+?)(\d+)$/;
  const parsed = values.map(v => {
    const match = String(v).match(regex);
    if (match) {
      return { prefix: match[1], number: parseInt(match[2]) };
    }
    return null;
  });

  if (parsed.every(p => p !== null)) {
    const prefix = parsed[0]!.prefix;
    if (parsed.every(p => p!.prefix === prefix)) {
      const numbers = parsed.map(p => p!.number);
      const diffs: number[] = [];
      for (let i = 1; i < numbers.length; i++) {
        diffs.push(numbers[i] - numbers[i - 1]);
      }
      if (diffs.length === 0 || diffs.every(d => d === diffs[0])) {
        return {
          type: 'alphanumeric',
          values,
          prefix,
          lastNumber: numbers[numbers.length - 1],
          step: diffs.length > 0 ? diffs[0] : 1
        };
      }
    }
  }
  return null;
}

function detectPattern(data: any[][], direction: string): AutofillPattern {
  const values = direction === 'down' || direction === 'up'
    ? data.map(row => row[0])
    : data[0];

  if (values.length === 0) return { type: 'copy', values };
  if (values.length === 1) return { type: 'copy', values };

  const numbers = values.map(v => parseFloat(v)).filter(n => !isNaN(n));

  if (numbers.length === values.length) {
    const diffs: number[] = [];
    for (let i = 1; i < numbers.length; i++) {
      diffs.push(numbers[i] - numbers[i - 1]);
    }
    const allSameDiff = diffs.every(d => d === diffs[0]);
    if (allSameDiff) {
      return {
        type: 'arithmetic',
        values: numbers,
        start: numbers[numbers.length - 1],
        step: diffs[0]
      };
    }

    if (numbers[0] !== 0) {
      const ratios: number[] = [];
      for (let i = 1; i < numbers.length; i++) {
        ratios.push(numbers[i] / numbers[i - 1]);
      }
      const allSameRatio = ratios.every(r => Math.abs(r - ratios[0]) < 0.0001);
      if (allSameRatio && ratios[0] !== 1) {
        return {
          type: 'geometric',
          values: numbers,
          start: numbers[numbers.length - 1],
          ratio: ratios[0]
        };
      }
    }
    return { type: 'repeat_sequence', values: numbers };
  }

  const dates = values.map(v => parseDate(v)).filter(d => d !== null) as Date[];
  if (dates.length === values.length) {
    const dayDiffs: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      dayDiffs.push(Math.round((dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24)));
    }
    const allSameDayDiff = dayDiffs.every(d => d === dayDiffs[0]);
    if (allSameDayDiff) {
      return {
        type: 'date',
        values: dates,
        lastDate: dates[dates.length - 1],
        dayStep: dayDiffs[0],
        format: detectDateFormat(values[0])
      };
    }
  }

  const textPattern = detectTextPattern(values);
  if (textPattern) return textPattern;

  const alphanumPattern = detectAlphanumericPattern(values);
  if (alphanumPattern) return alphanumPattern;

  return { type: 'repeat_sequence', values };
}

function generateFillData(pattern: AutofillPattern, targetCount: number): any[] {
  const result: any[] = [];

  switch (pattern.type) {
    case 'arithmetic':
      for (let i = 0; i < targetCount; i++) {
        const value = (pattern.start || 0) + (pattern.step || 1) * (i + 1);
        result.push(value);
      }
      break;

    case 'geometric':
      for (let i = 0; i < targetCount; i++) {
        const value = (pattern.start || 1) * Math.pow(pattern.ratio || 2, i + 1);
        result.push(Math.round(value * 100) / 100);
      }
      break;

    case 'date':
      for (let i = 0; i < targetCount; i++) {
        const newDate = new Date(pattern.lastDate!);
        newDate.setDate(newDate.getDate() + (pattern.dayStep || 1) * (i + 1));
        result.push(formatDate(newDate, pattern.format || 'DD/MM/YYYY'));
      }
      break;

    case 'list':
      for (let i = 0; i < targetCount; i++) {
        const index = ((pattern.lastIndex || 0) + i + 1) % pattern.list!.length;
        let value = pattern.list![index];
        value = applyCase(value, pattern.originalCase || 'lower');
        result.push(value);
      }
      break;

    case 'alphanumeric':
      for (let i = 0; i < targetCount; i++) {
        const num = (pattern.lastNumber || 0) + (pattern.step || 1) * (i + 1);
        result.push(`${pattern.prefix}${num}`);
      }
      break;

    case 'repeat_sequence':
    case 'copy':
    default:
      for (let i = 0; i < targetCount; i++) {
        const index = i % pattern.values.length;
        result.push(pattern.values[index]);
      }
      break;
  }

  return result;
}

interface SpreadsheetEditorProps {
  initialData?: any[][];
  initialSheets?: { name: string; data: any[][]; metadata?: any }[];
  fileName?: string;
  documentId?: string;
  onSave?: (data: any[][], fileName: string, sheets?: { name: string; data: any[][]; metadata?: any }[]) => void;
  readOnly?: boolean;
  height?: number;
}

function generateEmptySheet(rows: number, cols: number): any[][] {
  return Array(rows).fill(null).map(() => Array(cols).fill(''));
}

function getColumnHeaders(count: number): string[] {
  const headers: string[] = [];
  for (let i = 0; i < count; i++) {
    let header = '';
    let num = i;
    while (num >= 0) {
      header = String.fromCharCode(65 + (num % 26)) + header;
      num = Math.floor(num / 26) - 1;
    }
    headers.push(header);
  }
  return headers;
}

export function SpreadsheetEditor({
  initialData,
  initialSheets,
  fileName = 'spreadsheet.xlsx',
  documentId,
  onSave,
  readOnly = false,
  height = 600
}: SpreadsheetEditorProps) {
  const hotRef = useRef<any>(null);
  const [data, setData] = useState<any[][]>(
    initialSheets?.[0]?.data || initialData || generateEmptySheet(50, 26)
  );
  const [currentFileName, setCurrentFileName] = useState(fileName);
  const [docId, setDocId] = useState(documentId);
  const [sheets, setSheets] = useState<{ name: string; data: any[][]; metadata?: any }[]>(
    initialSheets || [{ name: 'Hoja 1', data: initialData || generateEmptySheet(50, 26) }]
  );
  const [activeSheet, setActiveSheet] = useState(0);
  const [history, setHistory] = useState<any[][][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [isModified, setIsModified] = useState(false);
  const [formulaValue, setFormulaValue] = useState('');

  const [cellFormat, setCellFormat] = useState({
    bold: false,
    italic: false,
    align: 'left' as 'left' | 'center' | 'right',
    backgroundColor: '',
    textColor: ''
  });
  const [selectedRange, setSelectedRange] = useState<{ startRow: number; startCol: number; endRow: number; endCol: number } | null>(null);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; isOpen: boolean }>({
    x: 0, y: 0, isOpen: false
  });
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    isStreaming,
    streamingCell,
    streamToCell,
    streamToCells,
    streamFillColumn,
    streamFillRange,
    cancelStreaming
  } = useSpreadsheetStreaming(hotRef, setIsModified);

  useEffect(() => {
    if (initialSheets && initialSheets.length > 0) {
      setSheets(initialSheets);
      setData(initialSheets[0].data || generateEmptySheet(50, 26));
      setActiveSheet(0);
    } else if (initialData) {
      setData(initialData);
      setSheets([{ name: 'Hoja 1', data: initialData }]);
    }
  }, [initialData, initialSheets]);

  const formattingAppliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hotRef.current?.hotInstance || !sheets[activeSheet]?.metadata?.formatting) return;

    const formatKey = `${activeSheet}-${JSON.stringify(sheets[activeSheet].metadata.formatting)}`;
    if (formattingAppliedRef.current === formatKey) return;
    formattingAppliedRef.current = formatKey;

    const hot = hotRef.current.hotInstance;
    const formatting = sheets[activeSheet].metadata.formatting;

    Object.entries(formatting).forEach(([key, format]: [string, any]) => {
      const [row, col] = key.split('-').map(Number);
      if (format.bold) hot.setCellMeta(row, col, 'bold', true);
      if (format.italic) hot.setCellMeta(row, col, 'italic', true);
      if (format.alignment) hot.setCellMeta(row, col, 'alignment', format.alignment);
      if (format.backgroundColor) hot.setCellMeta(row, col, 'backgroundColor', format.backgroundColor);
      if (format.textColor) hot.setCellMeta(row, col, 'textColor', format.textColor);
    });

    hot.render();
  }, [activeSheet]);

  const updateFormatState = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();

    if (!selected || selected.length === 0) return;

    const [row, col] = [selected[0][0], selected[0][1]];
    const meta = hot.getCellMeta(row, col);

    setCellFormat({
      bold: meta.bold || false,
      italic: meta.italic || false,
      align: (meta.alignment as 'left' | 'center' | 'right') || 'left',
      backgroundColor: meta.backgroundColor || '',
      textColor: meta.textColor || ''
    });
  }, []);

  const applyBold = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();

    if (!selected || selected.length === 0) return;

    selected.forEach(([startRow, startCol, endRow, endCol]: number[]) => {
      for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
        for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
          const meta = hot.getCellMeta(row, col);
          const newBold = !meta.bold;
          hot.setCellMeta(row, col, 'bold', newBold);
        }
      }
    });

    hot.render();
    setIsModified(true);
    updateFormatState();
  }, [updateFormatState]);

  const applyItalic = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();

    if (!selected || selected.length === 0) return;

    selected.forEach(([startRow, startCol, endRow, endCol]: number[]) => {
      for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
        for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
          const meta = hot.getCellMeta(row, col);
          const newItalic = !meta.italic;
          hot.setCellMeta(row, col, 'italic', newItalic);
        }
      }
    });

    hot.render();
    setIsModified(true);
    updateFormatState();
  }, [updateFormatState]);

  const applyAlignment = useCallback((alignment: 'left' | 'center' | 'right') => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();

    if (!selected || selected.length === 0) return;

    selected.forEach(([startRow, startCol, endRow, endCol]: number[]) => {
      for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
        for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
          hot.setCellMeta(row, col, 'alignment', alignment);
        }
      }
    });

    hot.render();
    setIsModified(true);
    updateFormatState();
  }, [updateFormatState]);

  const applyBackgroundColor = useCallback((color: string) => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();

    if (!selected || selected.length === 0) return;

    selected.forEach(([startRow, startCol, endRow, endCol]: number[]) => {
      for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
        for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
          hot.setCellMeta(row, col, 'backgroundColor', color);
        }
      }
    });

    hot.render();
    setIsModified(true);
    updateFormatState();
  }, [updateFormatState]);

  const applyTextColor = useCallback((color: string) => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();

    if (!selected || selected.length === 0) return;

    selected.forEach(([startRow, startCol, endRow, endCol]: number[]) => {
      for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
        for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
          hot.setCellMeta(row, col, 'textColor', color);
        }
      }
    });

    hot.render();
    setIsModified(true);
    updateFormatState();
  }, [updateFormatState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        applyBold();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        applyItalic();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applyBold, applyItalic]);

  const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        const importedSheets = workbook.SheetNames.map(name => {
          const worksheet = workbook.Sheets[name];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
          return { name, data: jsonData as any[][] };
        });

        setSheets(importedSheets);
        setActiveSheet(0);
        setData(importedSheets[0].data);
        setCurrentFileName(file.name);
        setIsModified(false);
      } catch (error) {
        console.error('Error al importar:', error);
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  }, []);

  const handleExport = useCallback((format: 'xlsx' | 'csv' = 'xlsx') => {
    const workbook = XLSX.utils.book_new();

    sheets.forEach(sheet => {
      const worksheet = XLSX.utils.aoa_to_sheet(sheet.data);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
    });

    if (format === 'xlsx') {
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, currentFileName.endsWith('.xlsx') ? currentFileName : `${currentFileName}.xlsx`);
    } else {
      const csvData = XLSX.utils.sheet_to_csv(workbook.Sheets[sheets[activeSheet].name]);
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8' });
      saveAs(blob, currentFileName.replace('.xlsx', '.csv'));
    }
  }, [sheets, activeSheet, currentFileName]);

  const extractFormatMetadata = useCallback(() => {
    if (!hotRef.current?.hotInstance) return {};
    const hot = hotRef.current.hotInstance;
    const formatting: Record<string, any> = {};
    const rowCount = hot.countRows();
    const colCount = hot.countCols();

    for (let row = 0; row < rowCount; row++) {
      for (let col = 0; col < colCount; col++) {
        const meta = hot.getCellMeta(row, col);
        if (meta.bold || meta.italic || meta.alignment || meta.backgroundColor || meta.textColor) {
          formatting[`${row}-${col}`] = {
            bold: meta.bold || false,
            italic: meta.italic || false,
            alignment: meta.alignment || 'left',
            backgroundColor: meta.backgroundColor || '',
            textColor: meta.textColor || ''
          };
        }
      }
    }
    return formatting;
  }, []);

  const handleSave = useCallback(() => {
    const updatedSheets = [...sheets];
    updatedSheets[activeSheet] = {
      ...updatedSheets[activeSheet],
      data,
      metadata: { formatting: extractFormatMetadata() }
    };

    setSheets(updatedSheets);

    if (onSave) {
      onSave(data, currentFileName, updatedSheets);
    }
    setIsModified(false);
  }, [data, currentFileName, onSave, sheets, activeSheet, extractFormatMetadata]);

  const handleDataChange = useCallback((changes: any, source: string) => {
    if (source === 'loadData') return;
    if (!changes || changes.length === 0) return;

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      setIsModified(true);

      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(JSON.parse(JSON.stringify(data)));
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }, 100);
  }, [data, history, historyIndex]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      isOpen: true
    });
  }, []);

  const handleContextAction = useCallback((action: string) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    const selected = hot.getSelected();
    if (!selected) return;

    const [r1, c1, r2, c2] = selected[0];
    const minRow = Math.min(r1, r2);
    const maxRow = Math.max(r1, r2);
    const minCol = Math.min(c1, c2);
    const maxCol = Math.max(c1, c2);

    switch (action) {
      case 'cut':
        handleCut();
        break;
      case 'copy':
        handleCopy();
        break;
      case 'paste':
        handlePaste();
        break;
      case 'insert_row_above':
        hot.alter('insert_row_above', minRow);
        break;
      case 'insert_row_below':
        hot.alter('insert_row_below', maxRow);
        break;
      case 'insert_col_left':
        hot.alter('insert_col_start', minCol);
        break;
      case 'insert_col_right':
        hot.alter('insert_col_end', maxCol);
        break;
      case 'delete_rows':
        hot.alter('remove_row', minRow, maxRow - minRow + 1);
        break;
      case 'delete_cols':
        hot.alter('remove_col', minCol, maxCol - minCol + 1);
        break;
      case 'clear_contents':
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            hot.setDataAtCell(r, c, '');
          }
        }
        break;
      case 'sort_asc':
        hot.getPlugin('columnSorting').sort({ column: minCol, sortOrder: 'asc' });
        break;
      case 'sort_desc':
        hot.getPlugin('columnSorting').sort({ column: minCol, sortOrder: 'desc' });
        break;
      case 'add_comment':
        const comment = prompt('Escribe un comentario:');
        if (comment) {
          hot.setCellMeta(minRow, minCol, 'comment', { value: comment });
          hot.render();
        }
        break;
      case 'hyperlink':
        const url = prompt('URL del hipervínculo:');
        if (url) {
          hot.setCellMeta(minRow, minCol, 'hyperlink', url);
          hot.render();
        }
        break;
      case 'merge_all':
        hot.getPlugin('mergeCells').merge(minRow, minCol, maxRow, maxCol);
        break;
      case 'unmerge':
        hot.getPlugin('mergeCells').unmerge(minRow, minCol, maxRow, maxCol);
        break;
      case 'fill_down':
      case 'fill_right':
      case 'fill_up':
      case 'fill_left':
        break;
      default:
        console.log('Action not implemented:', action);
    }
    setIsModified(true);
    // Note: handleCut, handleCopy, handlePaste are called but not in deps to avoid hoisting issues
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSmartAutofill = useCallback((selectionData: any[][], sourceRange: any, targetRange: any, direction: string) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    const { startRow: sr, startCol: sc, endRow: er, endCol: ec } = sourceRange;

    const sourceData: any[][] = [];
    for (let r = sr; r <= er; r++) {
      const row: any[] = [];
      for (let c = sc; c <= ec; c++) {
        row.push(hot.getDataAtCell(r, c));
      }
      sourceData.push(row);
    }

    const pattern = detectPattern(sourceData, direction);

    const { startRow: tr, endRow: ter, startCol: tc, endCol: tec } = targetRange;
    const targetCount = direction === 'down' || direction === 'up'
      ? ter - tr + 1
      : tec - tc + 1;

    const fillData = generateFillData(pattern, targetCount);

    if (direction === 'down' || direction === 'up') {
      for (let i = 0; i < fillData.length; i++) {
        const row = direction === 'down' ? tr + i : ter - i;
        hot.setDataAtCell(row, sc, fillData[i]);
      }
    } else {
      for (let i = 0; i < fillData.length; i++) {
        const col = direction === 'right' ? tc + i : tec - i;
        hot.setDataAtCell(sr, col, fillData[i]);
      }
    }

    return false;
  }, []);

  const handleUndo = useCallback(() => {
    if (hotRef.current?.hotInstance) {
      hotRef.current.hotInstance.undo();
    }
  }, []);

  const handleRedo = useCallback(() => {
    if (hotRef.current?.hotInstance) {
      hotRef.current.hotInstance.redo();
    }
  }, []);

  const handleCut = useCallback(() => {
    if (hotRef.current?.hotInstance) {
      const plugin = hotRef.current.hotInstance.getPlugin('CopyPaste');
      plugin?.cut();
    }
  }, []);

  const handleCopy = useCallback(() => {
    if (hotRef.current?.hotInstance) {
      const plugin = hotRef.current.hotInstance.getPlugin('CopyPaste');
      plugin?.copy();
    }
  }, []);

  const handlePaste = useCallback(() => {
    if (hotRef.current?.hotInstance) {
      const plugin = hotRef.current.hotInstance.getPlugin('CopyPaste');
      plugin?.paste();
    }
  }, []);

  const addSheet = useCallback(() => {
    const newSheet = {
      name: `Hoja ${sheets.length + 1}`,
      data: generateEmptySheet(50, 26)
    };
    setSheets([...sheets, newSheet]);
    setActiveSheet(sheets.length);
    setData(newSheet.data);
  }, [sheets]);

  const removeSheet = useCallback((index: number) => {
    if (sheets.length <= 1) return;
    const newSheets = sheets.filter((_, i) => i !== index);
    setSheets(newSheets);
    const newActiveSheet = Math.min(activeSheet, newSheets.length - 1);
    setActiveSheet(newActiveSheet);
    setData(newSheets[newActiveSheet].data);
  }, [sheets, activeSheet]);

  const switchSheet = useCallback((index: number) => {
    const updatedSheets = [...sheets];
    updatedSheets[activeSheet] = { ...updatedSheets[activeSheet], data };
    setSheets(updatedSheets);

    setActiveSheet(index);
    setData(updatedSheets[index].data);
  }, [sheets, activeSheet, data]);

  const insertRow = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    if (selected) {
      hot.alter('insert_row_below', selected[0][0]);
    }
  }, []);

  const insertColumn = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    if (selected) {
      hot.alter('insert_col_end', selected[0][1]);
    }
  }, []);

  const deleteRow = useCallback(() => {
    if (!hotRef.current?.hotInstance) return;
    const hot = hotRef.current.hotInstance;
    const selected = hot.getSelected();
    if (selected) {
      hot.alter('remove_row', selected[0][0]);
    }
  }, []);

  const handleSelection = useCallback((row: number, col: number, row2: number, col2: number) => {
    setSelectedCell({ row, col });
    setSelectedRange({
      startRow: Math.min(row, row2),
      startCol: Math.min(col, col2),
      endRow: Math.max(row, row2),
      endCol: Math.max(col, col2)
    });
    if (hotRef.current?.hotInstance) {
      const value = hotRef.current.hotInstance.getDataAtCell(row, col);
      setFormulaValue(value || '');
    }
  }, []);

  const handleAICommand = useCallback(async (command: string) => {
    if (!selectedRange) return;

    setIsAIProcessing(true);
    try {
      const response = await fetch('/api/ai/excel-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          type: 'custom',
          range: selectedRange,
          currentData: data
        })
      });

      if (!response.ok) {
        throw new Error('Failed to process AI command');
      }

      const result = await response.json();

      if (result.cells && Array.isArray(result.cells) && result.cells.length > 0) {
        await streamToCells(result.cells);
      } else if (result.columnData && Array.isArray(result.columnData)) {
        await streamFillColumn(
          selectedRange.startCol,
          result.columnData,
          selectedRange.startRow
        );
      } else if (result.rangeData && Array.isArray(result.rangeData)) {
        await streamFillRange(
          selectedRange.startRow,
          selectedRange.startCol,
          result.rangeData
        );
      } else if (result.cell && typeof result.cell === 'string') {
        await streamToCell(selectedRange.startRow, selectedRange.startCol, result.cell);
      }
    } catch (error) {
      console.error('AI command error:', error);
    } finally {
      setIsAIProcessing(false);
    }
  }, [selectedRange, data, streamToCell, streamToCells, streamFillColumn, streamFillRange]);

  const handleSelectionEnd = useCallback(() => {
    updateFormatState();
  }, [updateFormatState]);

  const getCellReference = useCallback(() => {
    if (!selectedRange) {
      if (!selectedCell) return 'A1';
      return `${getColumnHeaders(26)[selectedCell.col] || 'A'}${selectedCell.row + 1}`;
    }

    const startRef = `${getColumnHeaders(26)[selectedRange.startCol] || 'A'}${selectedRange.startRow + 1}`;
    const endRef = `${getColumnHeaders(26)[selectedRange.endCol] || 'A'}${selectedRange.endRow + 1}`;

    if (selectedRange.startRow === selectedRange.endRow && selectedRange.startCol === selectedRange.endCol) {
      return startRef;
    }
    return `${startRef}:${endRef}`;
  }, [selectedCell, selectedRange]);

  const getSelectedCellCount = useCallback(() => {
    if (!selectedRange) return 1;
    return (selectedRange.endRow - selectedRange.startRow + 1) * (selectedRange.endCol - selectedRange.startCol + 1);
  }, [selectedRange]);

  const customRendererRef = useRef((
    instance: Handsontable,
    td: HTMLTableCellElement,
    row: number,
    col: number,
    prop: string | number,
    value: any,
    cellProperties: Handsontable.CellProperties
  ) => {
    Handsontable.renderers.TextRenderer(instance, td, row, col, prop, value, cellProperties);

    const meta = instance.getCellMeta(row, col);

    if (meta.bold) {
      td.style.fontWeight = 'bold';
    }
    if (meta.italic) {
      td.style.fontStyle = 'italic';
    }
    if (meta.alignment) {
      td.style.textAlign = meta.alignment as string;
    }
    if (meta.backgroundColor) {
      td.style.backgroundColor = meta.backgroundColor as string;
    }
    if (meta.textColor) {
      td.style.color = meta.textColor as string;
    }
  });

  const hotSettings = {
    data,
    rowHeaders: true,
    colHeaders: getColumnHeaders(26),
    height,
    width: '100%',
    licenseKey: 'non-commercial-and-evaluation',

    renderAllRows: false,
    viewportRowRenderingOffset: 20,
    viewportColumnRenderingOffset: 5,

    selectionMode: 'multiple' as const,
    fillHandle: {
      autoInsertRow: true,
      direction: 'vertical' as const,
    },
    outsideClickDeselects: false,
    fragmentSelection: true,

    enterBeginsEditing: true,
    enterMoves: { row: 1, col: 0 },
    tabMoves: { row: 0, col: 1 },
    autoWrapRow: true,
    autoWrapCol: true,
    editor: 'text' as const,

    contextMenu: false,
    manualColumnResize: true,
    manualRowResize: true,
    manualColumnMove: true,
    manualRowMove: true,

    copyPaste: {
      columnsLimit: 1000,
      rowsLimit: 1000,
      pasteMode: 'overwrite' as const,
      copyColumnHeaders: false,
      copyColumnGroupHeaders: false,
      copyColumnHeadersOnly: false,
    },

    filters: true,
    dropdownMenu: true,
    columnSorting: true,
    multiColumnSorting: true,
    mergeCells: true,
    comments: true,
    customBorders: true,
    undo: true,

    stretchH: 'all' as const,
    wordWrap: false,
    rowHeights: 25,

    readOnly,
    afterChange: handleDataChange,
    afterSelection: handleSelection,
    afterSelectionEnd: handleSelectionEnd,
    beforeAutofill: handleSmartAutofill,
    renderer: customRendererRef.current,
    className: 'spreadsheet-dark-theme',
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl overflow-hidden border border-gray-700" data-testid="spreadsheet-editor">
      <div className="flex flex-wrap items-center gap-1 p-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-1 pr-2 border-r border-gray-600">
          <label className="p-2 hover:bg-gray-700 rounded cursor-pointer transition-colors" title="Importar Excel" data-testid="button-import">
            <Upload className="w-4 h-4 text-gray-300" />
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} className="hidden" aria-label="Importar archivo" />
          </label>
          <button onClick={() => handleExport('xlsx')} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Exportar XLSX" data-testid="button-export-xlsx">
            <Download className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={() => handleExport('csv')} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Exportar CSV" data-testid="button-export-csv">
            <FileSpreadsheet className="w-4 h-4 text-gray-300" />
          </button>
          {onSave && (
            <button
              onClick={handleSave}
              className={`p-2 rounded transition-colors ${isModified ? 'bg-indigo-600 hover:bg-indigo-500' : 'hover:bg-gray-700'}`}
              title="Guardar"
              data-testid="button-save"
            >
              <Save className="w-4 h-4 text-white" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <button onClick={handleUndo} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Deshacer (Ctrl+Z)" data-testid="button-undo">
            <Undo className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={handleRedo} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Rehacer (Ctrl+Y)" data-testid="button-redo">
            <Redo className="w-4 h-4 text-gray-300" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <button onClick={handleCut} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Cortar" data-testid="button-cut">
            <Scissors className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={handleCopy} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Copiar" data-testid="button-copy">
            <Copy className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={handlePaste} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Pegar" data-testid="button-paste">
            <Clipboard className="w-4 h-4 text-gray-300" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <button onClick={insertRow} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Insertar Fila" data-testid="button-insert-row">
            <Plus className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={insertColumn} className="p-2 hover:bg-gray-700 rounded transition-colors" title="Insertar Columna" data-testid="button-insert-column">
            <Grid3X3 className="w-4 h-4 text-gray-300" />
          </button>
          <button onClick={deleteRow} className="p-2 hover:bg-gray-700 rounded transition-colors text-red-400" title="Eliminar Fila" data-testid="button-delete-row">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <button
            onClick={applyBold}
            className={`p-2 rounded transition-colors ${cellFormat.bold ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
            title="Negrita (Ctrl+B)"
            data-testid="button-bold"
          >
            <Bold className={`w-4 h-4 ${cellFormat.bold ? 'text-white' : 'text-gray-300'}`} />
          </button>
          <button
            onClick={applyItalic}
            className={`p-2 rounded transition-colors ${cellFormat.italic ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
            title="Cursiva (Ctrl+I)"
            data-testid="button-italic"
          >
            <Italic className={`w-4 h-4 ${cellFormat.italic ? 'text-white' : 'text-gray-300'}`} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <button
            onClick={() => applyAlignment('left')}
            className={`p-2 rounded transition-colors ${cellFormat.align === 'left' ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
            title="Alinear Izquierda"
            data-testid="button-align-left"
          >
            <AlignLeft className={`w-4 h-4 ${cellFormat.align === 'left' ? 'text-white' : 'text-gray-300'}`} />
          </button>
          <button
            onClick={() => applyAlignment('center')}
            className={`p-2 rounded transition-colors ${cellFormat.align === 'center' ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
            title="Centrar"
            data-testid="button-align-center"
          >
            <AlignCenter className={`w-4 h-4 ${cellFormat.align === 'center' ? 'text-white' : 'text-gray-300'}`} />
          </button>
          <button
            onClick={() => applyAlignment('right')}
            className={`p-2 rounded transition-colors ${cellFormat.align === 'right' ? 'bg-indigo-600 text-white' : 'hover:bg-gray-700'}`}
            title="Alinear Derecha"
            data-testid="button-align-right"
          >
            <AlignRight className={`w-4 h-4 ${cellFormat.align === 'right' ? 'text-white' : 'text-gray-300'}`} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-2 border-r border-gray-600">
          <div className="relative" title="Color de Fondo">
            <button
              className={`p-2 rounded transition-colors ${cellFormat.backgroundColor ? 'ring-2 ring-indigo-500' : 'hover:bg-gray-700'}`}
              style={{ backgroundColor: cellFormat.backgroundColor || undefined }}
              data-testid="button-bg-color"
              aria-label="Color de fondo"
            >
              <Palette className="w-4 h-4 text-gray-300" />
            </button>
            <input
              type="color"
              onChange={(e) => applyBackgroundColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              title="Color de Fondo"
              data-testid="input-bg-color"
            />
          </div>
          <div className="relative" title="Color de Texto">
            <button
              className={`p-2 rounded transition-colors ${cellFormat.textColor ? 'ring-2 ring-indigo-500' : 'hover:bg-gray-700'}`}
              data-testid="button-text-color"
              aria-label="Color de texto"
            >
              <Type className="w-4 h-4" style={{ color: cellFormat.textColor || '#d1d5db' }} />
            </button>
            <input
              type="color"
              onChange={(e) => applyTextColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              title="Color de Texto"
              data-testid="input-text-color"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 px-2">
          <button className="p-2 hover:bg-gray-700 rounded transition-colors" title="Filtrar" data-testid="button-filter">
            <Filter className="w-4 h-4 text-gray-300" />
          </button>
          <button className="p-2 hover:bg-gray-700 rounded transition-colors" title="Ordenar" data-testid="button-sort">
            <SortAsc className="w-4 h-4 text-gray-300" />
          </button>
          <button className="p-2 hover:bg-gray-700 rounded transition-colors" title="Buscar" data-testid="button-search">
            <Search className="w-4 h-4 text-gray-300" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            value={currentFileName}
            onChange={(e) => setCurrentFileName(e.target.value)}
            className="px-3 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-indigo-500"
            placeholder="nombre-archivo.xlsx"
            data-testid="input-filename"
            aria-label="Nombre del archivo"
          />
          {isModified && <span className="text-yellow-400 text-xs" data-testid="text-modified-indicator">● Sin guardar</span>}
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 bg-gray-850 border-b border-gray-700">
        <div className="flex items-center gap-2 px-2 py-1 bg-gray-700 rounded min-w-[80px]">
          <span className="text-xs text-gray-400" data-testid="text-cell-reference">
            {getCellReference()}
          </span>
          {getSelectedCellCount() > 1 && (
            <span className="text-xs text-gray-500 ml-1" data-testid="text-cell-count">
              ({getSelectedCellCount()} celdas)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 px-2">
          <Calculator className="w-4 h-4 text-gray-400" />
          <span className="text-xs text-gray-400">fx</span>
        </div>
        <input
          type="text"
          value={formulaValue}
          onChange={(e) => setFormulaValue(e.target.value)}
          className="flex-1 px-3 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white focus:outline-none focus:border-indigo-500"
          placeholder="Ingresa fórmula o valor..."
          data-testid="input-formula"
          aria-label="Barra de fórmulas"
        />
      </div>

      <AICommandBar
        onExecute={handleAICommand}
        isProcessing={isAIProcessing || isStreaming}
        selectedRange={selectedRange}
      />

      <div className="flex-1 overflow-hidden spreadsheet-container" onContextMenu={handleContextMenu}>
        <HotTable ref={hotRef} settings={hotSettings} />
      </div>

      <div className="flex items-center gap-1 p-2 bg-gray-800 border-t border-gray-700 overflow-x-auto">
        {sheets.map((sheet, index) => (
          <div
            key={index}
            className={`flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer transition-colors ${activeSheet === index
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            onClick={() => switchSheet(index)}
            data-testid={`tab-sheet-${index}`}
          >
            <Table className="w-3 h-3" />
            <span className="text-sm">{sheet.name}</span>
            {sheets.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); removeSheet(index); }}
                className="p-0.5 hover:bg-gray-500 rounded"
                data-testid={`button-remove-sheet-${index}`}
                aria-label={`Eliminar hoja ${sheet.name}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addSheet}
          className="p-1.5 hover:bg-gray-700 rounded transition-colors"
          title="Añadir hoja"
          data-testid="button-add-sheet"
          aria-label="Añadir hoja"
        >
          <Plus className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      <StreamingIndicator
        isStreaming={isStreaming}
        cell={streamingCell}
        onCancel={cancelStreaming}
      />

      <ExcelContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        isOpen={contextMenu.isOpen}
        onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))}
        onAction={handleContextAction}
        selectedRange={selectedRange}
      />
    </div>
  );
}

export default SpreadsheetEditor;
