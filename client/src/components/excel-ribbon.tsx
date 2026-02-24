import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

const RIBBON_TABS = [
  { id: 'home', label: 'Inicio' },
  { id: 'insert', label: 'Insertar' },
  { id: 'draw', label: 'Dibujar' },
  { id: 'pageLayout', label: 'Disposición de página' },
  { id: 'formulas', label: 'Fórmulas' },
  { id: 'data', label: 'Datos' },
  { id: 'review', label: 'Revisar' },
  { id: 'view', label: 'Vista' },
  { id: 'automate', label: 'Automatizar' }
] as const;

type TabId = typeof RIBBON_TABS[number]['id'];

const EXCEL_COLORS = {
  tabBg: '#217346',
  tabHover: '#185c37',
  tabActive: '#ffffff',
  tabText: '#ffffff',
  tabActiveText: '#217346',
  ribbonBg: 'linear-gradient(180deg, #f3f3f3 0%, #e8e8e8 100%)',
  ribbonBorder: '#d4d4d4',
  buttonHover: 'rgba(0, 0, 0, 0.08)',
  buttonActive: 'rgba(33, 115, 70, 0.15)',
  groupLabel: '#666666',
  separator: '#c8c8c8',
};

const COLOR_PALETTE = [
  ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4'],
  ['#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'],
  ['#f8f8f8', '#e6e6e6', '#ddd9c4', '#c6d9f0', '#dce6f1', '#ebf1de', '#fde9d9', '#e6b8af', '#d9d9d9', '#bfbfbf'],
];

const Icons = {
  paste: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" fill="currentColor" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  cut: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
  formatPainter: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M19 3H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" fill="#ffd966" />
      <path d="M12 11v8" />
      <path d="M8 21h8" />
    </svg>
  ),
  bold: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 4v16h6.5c2.5 0 4.5-2 4.5-4.5 0-1.93-1.23-3.58-2.95-4.2.87-.63 1.45-1.65 1.45-2.8 0-1.93-1.57-3.5-3.5-3.5H6zm3 3h2.5c.83 0 1.5.67 1.5 1.5S12.33 10 11.5 10H9V7zm0 6h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5H9v-3z" />
    </svg>
  ),
  italic: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4v3h2.21l-3.42 10H6v3h8v-3h-2.21l3.42-10H18V4h-8z" />
    </svg>
  ),
  underline: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z" />
    </svg>
  ),
  alignLeft: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 5h18v2H3V5zm0 4h12v2H3V9zm0 4h18v2H3v-2zm0 4h12v2H3v-2z" />
    </svg>
  ),
  alignCenter: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 5h18v2H3V5zm3 4h12v2H6V9zm-3 4h18v2H3v-2zm3 4h12v2H6v-2z" />
    </svg>
  ),
  alignRight: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 5h18v2H3V5zm6 4h12v2H9V9zm-6 4h18v2H3v-2zm6 4h12v2H9v-2z" />
    </svg>
  ),
  merge: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 12h8M12 8l4 4-4 4" />
    </svg>
  ),
  wrapText: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
      <polyline points="14 16 12 18 14 20" />
      <line x1="3" y1="18" x2="10" y2="18" />
    </svg>
  ),
  borders: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="1" />
    </svg>
  ),
  conditionalFormat: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" fill="#ef4444" rx="1" />
      <rect x="14" y="3" width="7" height="7" fill="#f59e0b" rx="1" />
      <rect x="3" y="14" width="7" height="7" fill="#22c55e" rx="1" />
      <rect x="14" y="14" width="7" height="7" fill="#3b82f6" rx="1" />
    </svg>
  ),
  formatTable: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
      <line x1="3" y1="15" x2="21" y2="15" />
    </svg>
  ),
  cellStyles: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <rect x="6" y="6" width="5" height="5" fill="#3b82f6" />
    </svg>
  ),
  insertRow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="12" y1="8" x2="12" y2="16" />
    </svg>
  ),
  deleteRow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  ),
  format: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M7 7h10M7 12h10M7 17h6" />
    </svg>
  ),
  sort: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 6h7M3 12h5M3 18h3" />
      <path d="M17 6v12M14 15l3 3 3-3" />
    </svg>
  ),
  sortAsc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 18h7M3 12h5M3 6h3" />
      <path d="M17 18V6M14 9l3-3 3 3" />
    </svg>
  ),
  filter: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  find: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  analyze: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 21H4.6c-.56 0-.84 0-1.05-.11a1 1 0 0 1-.44-.44C3 20.24 3 19.96 3 19.4V3" />
      <path d="m7 14 4-4 4 4 6-6" />
    </svg>
  ),
  comment: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  share: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  ),
  dropdown: (
    <svg viewBox="0 0 12 12" fill="currentColor">
      <path d="M3 4l3 4 3-4z" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 17v-5M12 17V8M17 17v-8" />
    </svg>
  ),
  lineChart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 14l4-4 4 2 4-5" />
    </svg>
  ),
  pieChart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9l6.5 3.5" fill="currentColor" fillOpacity="0.3" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  shapes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="7" height="7" />
      <circle cx="17.5" cy="6.5" r="4.5" />
      <path d="M12 14l5 8H7l5-8z" />
    </svg>
  ),
  function: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <text x="3" y="18" fontSize="16" fontFamily="serif" fontStyle="italic">fx</text>
    </svg>
  ),
  sum: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 5H6l6 7-6 7h12" />
    </svg>
  ),
  dataValidation: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 12l2 2 4-4" stroke="#22c55e" strokeWidth="2" />
    </svg>
  ),
  textToColumns: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="12" y1="3" x2="12" y2="21" />
      <path d="M8 6l-4 6 4 6M16 6l4 6-4 6" />
    </svg>
  ),
  spellcheck: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M9 12l2 2 4-4" stroke="#22c55e" strokeWidth="2" />
    </svg>
  ),
  protect: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  gridlines: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  ),
  freezePanes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="10" y1="3" x2="10" y2="21" strokeWidth="3" stroke="#3b82f6" />
      <line x1="3" y1="10" x2="21" y2="10" strokeWidth="3" stroke="#3b82f6" />
    </svg>
  ),
  zoom: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  ),
  macro: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" fill="#ef4444" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  ),
  script: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  ),
  redo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
    </svg>
  ),
  pencil: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  ),
  eraser: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  ),
  highlighter: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="m9 11-6 6v3h9l3-3" fill="#ffd966" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  )
};

export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
}

export interface RibbonCommands {
  copy: () => void;
  cut: () => void;
  paste: () => void;
  undo: () => void;
  redo: () => void;
  toggleBold: () => void;
  toggleItalic: () => void;
  toggleUnderline: () => void;
  toggleStrikethrough: () => void;
  setFont: (font: string) => void;
  setFontSize: (size: number) => void;
  setFontColor: (color: string) => void;
  setFillColor: (color: string) => void;
  alignLeft: () => void;
  alignCenter: () => void;
  alignRight: () => void;
  alignTop: () => void;
  alignMiddle: () => void;
  alignBottom: () => void;
  mergeCells: () => void;
  unmergeCells: () => void;
  wrapText: () => void;
  setNumberFormat: (format: string) => void;
  setBorders: (type: 'all' | 'outside' | 'inside' | 'none' | 'top' | 'bottom' | 'left' | 'right', style?: 'thin' | 'medium' | 'thick') => void;
  insertRow: () => void;
  insertColumn: () => void;
  deleteRow: () => void;
  deleteColumn: () => void;
  insertChart: (type: string) => void;
  applyConditionalFormat: () => void;
  sort: (direction: 'asc' | 'desc') => void;
  filter: () => void;
  freezePanes: () => void;
  toggleGridlines: () => void;
  insertFormula: (formula: 'SUM' | 'AVERAGE' | 'COUNT' | 'MAX' | 'MIN' | 'IF' | 'VLOOKUP') => void;
  findReplace: () => void;
  increaseIndent: () => void;
  decreaseIndent: () => void;
}

interface ExcelRibbonProps {
  commands: Partial<RibbonCommands>;
  cellFormat?: CellFormat;
  currentFont?: string;
  currentFontSize?: number;
  currentNumberFormat?: string;
  onRunAutomation?: (prompt: string) => void;
}

interface DropdownProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  width?: number;
  disabled?: boolean;
}

const Dropdown: React.FC<DropdownProps> = ({ value, options, onChange, width = 120, disabled }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div
      className="relative"
      ref={dropdownRef}
      style={{ "--w": width + "px" } as React.CSSProperties}
    >
      <div className="w-[var(--w)]">  <button
        className={`flex items-center justify-between w-full h-[22px] px-2 border rounded text-[11px] transition-colors
          ${disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200' : 'bg-white border-gray-300 hover:border-gray-400 hover:bg-gray-50'}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen ? "true" : "false"}
      >
        <span className="flex-1 text-left truncate font-medium">{value}</span>
        <span className="w-3 h-3 ml-1 text-gray-500">{Icons.dropdown}</span>
      </button></div>
      {isOpen && (
        <div
          className="absolute top-full left-0 right-0 mt-0.5 bg-white border border-gray-300 rounded shadow-lg max-h-64 overflow-y-auto z-50"
          role="listbox"
        >
          {options.map((option, idx) => (
            <button
              key={idx}
              role="option"
              aria-selected={option === value}
              className={`block w-full px-3 py-1.5 text-left text-[11px] transition-colors
                ${option === value ? 'bg-[#e8f4ec] text-[#217346] font-medium' : 'hover:bg-gray-100'}`}
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  icon: React.ReactNode;
  tooltip: string;
}

const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange, icon, tooltip }) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={pickerRef}>
      <button
        className="flex flex-col items-center justify-center w-7 h-7 p-0.5 border border-transparent rounded cursor-pointer transition-all text-gray-700 hover:bg-gray-200 hover:border-gray-300"
        onClick={() => setIsOpen(!isOpen)}
        title={tooltip}
        aria-label={tooltip}
        aria-haspopup="true"
        aria-expanded={isOpen ? "true" : "false"}
      >
        <span className="w-4 h-4">{icon}</span>
        <div className="w-4 h-1 rounded-sm -mt-0.5 bg-[var(--bg-col)]" style={{ "--bg-col": color } as React.CSSProperties} />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 p-2 bg-white border border-gray-300 rounded-lg shadow-xl z-50 min-w-[180px]">
          <div className="text-[10px] text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Colores del tema</div>
          {COLOR_PALETTE.map((row, rowIdx) => (
            <div key={rowIdx} className="flex gap-0.5 mb-0.5">
              {row.map((c) => (
                <button
                  key={c}
                  className={`w-4 h-4 rounded-sm border transition-transform hover:scale-125 hover:z-10 ${c === color ? 'ring-2 ring-[#217346] ring-offset-1' : 'border-gray-300'}`}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    onChange(c);
                    setIsOpen(false);
                  }}
                  title={c}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-gray-200">
            <label className="flex items-center gap-2 text-[10px] text-gray-600 cursor-pointer">
              <span>Personalizado:</span>
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  onChange(e.target.value);
                  setIsOpen(false);
                }}
                className="w-6 h-5 border-0 cursor-pointer"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

interface BorderPickerProps {
  onSelect: (type: 'all' | 'outside' | 'inside' | 'none' | 'top' | 'bottom' | 'left' | 'right', style?: 'thin' | 'medium' | 'thick') => void;
}

const BorderPicker: React.FC<BorderPickerProps> = ({ onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const borderOptions = [
    {
      type: 'all' as const, label: 'Todos los bordes', icon: (
        <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" /><line x1="10" y1="2" x2="10" y2="18" stroke="currentColor" strokeWidth="1" /><line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1" /></svg>
      )
    },
    {
      type: 'outside' as const, label: 'Borde exterior', icon: (
        <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
      )
    },
    {
      type: 'inside' as const, label: 'Bordes interiores', icon: (
        <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2" /><line x1="10" y1="2" x2="10" y2="18" stroke="currentColor" strokeWidth="1.5" /><line x1="2" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1.5" /></svg>
      )
    },
    {
      type: 'none' as const, label: 'Sin borde', icon: (
        <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2" /></svg>
      )
    },
    {
      type: 'top' as const, label: 'Borde superior', icon: (
        <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2" /><line x1="2" y1="2" x2="18" y2="2" stroke="currentColor" strokeWidth="2" /></svg>
      )
    },
    {
      type: 'bottom' as const, label: 'Borde inferior', icon: (
        <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2" /><line x1="2" y1="18" x2="18" y2="18" stroke="currentColor" strokeWidth="2" /></svg>
      )
    },
    {
      type: 'left' as const, label: 'Borde izquierdo', icon: (
        <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2" /><line x1="2" y1="2" x2="2" y2="18" stroke="currentColor" strokeWidth="2" /></svg>
      )
    },
    {
      type: 'right' as const, label: 'Borde derecho', icon: (
        <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2" /><line x1="18" y1="2" x2="18" y2="18" stroke="currentColor" strokeWidth="2" /></svg>
      )
    },
  ];

  return (
    <div className="relative" ref={pickerRef}>
      <button
        className="flex flex-col items-center justify-center w-7 h-7 p-0.5 border border-transparent rounded cursor-pointer transition-all text-gray-700 hover:bg-gray-200 hover:border-gray-300"
        onClick={() => setIsOpen(!isOpen)}
        title="Bordes"
        aria-label="Bordes"
        aria-haspopup="true"
        aria-expanded={isOpen ? "true" : "false"}
      >
        <span className="w-4 h-4">{Icons.borders}</span>
        <span className="w-2.5 h-2.5 text-gray-500">{Icons.dropdown}</span>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 p-2 bg-white border border-gray-300 rounded-lg shadow-xl z-50 min-w-[160px]">
          <div className="text-[10px] text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Bordes</div>
          <div className="grid grid-cols-4 gap-1 mb-2">
            {borderOptions.map((opt) => (
              <button
                key={opt.type}
                className="flex items-center justify-center w-8 h-8 rounded border border-gray-200 hover:bg-gray-100 hover:border-gray-400 transition-colors"
                onClick={() => { onSelect(opt.type); setIsOpen(false); }}
                title={opt.label}
              >
                {opt.icon}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-200 pt-2">
            <div className="text-[9px] text-gray-500 mb-1">Estilos de línea</div>
            <div className="flex gap-1">
              <button
                className="flex-1 h-6 border border-gray-300 rounded hover:bg-gray-100 flex items-center justify-center"
                onClick={() => { onSelect('all', 'thin'); setIsOpen(false); }}
                title="Línea delgada"
              >
                <div className="w-8 h-px bg-gray-800" />
              </button>
              <button
                className="flex-1 h-6 border border-gray-300 rounded hover:bg-gray-100 flex items-center justify-center"
                onClick={() => { onSelect('all', 'medium'); setIsOpen(false); }}
                title="Línea media"
              >
                <div className="w-8 h-0.5 bg-gray-800" />
              </button>
              <button
                className="flex-1 h-6 border border-gray-300 rounded hover:bg-gray-100 flex items-center justify-center"
                onClick={() => { onSelect('all', 'thick'); setIsOpen(false); }}
                title="Línea gruesa"
              >
                <div className="w-8 h-1 bg-gray-800" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface NumberFormatPickerProps {
  value: string;
  onChange: (format: string) => void;
}

const NumberFormatPicker: React.FC<NumberFormatPickerProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formats = [
    { id: 'General', label: 'General', example: '1234.56', icon: 'Aa' },
    { id: 'Número', label: 'Número', example: '1,234.56', icon: '#' },
    { id: 'Moneda', label: 'Moneda ($)', example: '$1,234.56', icon: '$' },
    { id: 'Contabilidad', label: 'Contabilidad', example: '$ 1,234.56', icon: '¢' },
    { id: 'Porcentaje', label: 'Porcentaje', example: '12.35%', icon: '%' },
    { id: 'Científico', label: 'Científico', example: '1.23E+03', icon: 'E' },
    { id: 'Fecha', label: 'Fecha corta', example: '27/12/2025', icon: '📅' },
    { id: 'FechaLarga', label: 'Fecha larga', example: '27 dic 2025', icon: '📆' },
    { id: 'Hora', label: 'Hora', example: '14:30:00', icon: '⏰' },
    { id: 'Texto', label: 'Texto', example: '1234', icon: 'T' },
  ];

  return (
    <div className="relative" ref={pickerRef}>
      <button
        className="flex items-center justify-between w-[100px] h-[22px] px-2 border rounded text-[11px] transition-colors bg-white border-gray-300 hover:border-gray-400 hover:bg-gray-50"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="flex-1 text-left truncate font-medium">{value}</span>
        <span className="w-3 h-3 ml-1 text-gray-500">{Icons.dropdown}</span>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-0.5 bg-white border border-gray-300 rounded-lg shadow-xl z-50 w-[200px] overflow-hidden">
          <div className="text-[10px] text-gray-500 px-3 py-1.5 bg-gray-50 font-medium uppercase tracking-wide border-b">
            Formatos de número
          </div>
          <div className="max-h-64 overflow-y-auto">
            {formats.map((fmt) => (
              <button
                key={fmt.id}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-100 ${value === fmt.id ? 'bg-green-50 text-green-700' : ''}`}
                onClick={() => { onChange(fmt.id); setIsOpen(false); }}
              >
                <span className="w-6 h-6 flex items-center justify-center bg-gray-100 rounded text-[11px] font-bold">
                  {fmt.icon}
                </span>
                <div className="flex-1">
                  <div className="text-[11px] font-medium">{fmt.label}</div>
                  <div className="text-[9px] text-gray-400">{fmt.example}</div>
                </div>
                {value === fmt.id && (
                  <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

interface MergePickerProps {
  onMerge: () => void;
  onUnmerge: () => void;
}

const MergePicker: React.FC<MergePickerProps> = ({ onMerge, onUnmerge }) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={pickerRef}>
      <button
        className="flex flex-col items-center justify-center w-7 h-7 p-0.5 border border-transparent rounded cursor-pointer transition-all text-gray-700 hover:bg-gray-200 hover:border-gray-300"
        onClick={() => setIsOpen(!isOpen)}
        title="Combinar celdas"
        aria-label="Combinar celdas"
        aria-haspopup="true"
        aria-expanded={isOpen ? "true" : "false"}
      >
        <span className="w-4 h-4">{Icons.merge}</span>
        <span className="w-2.5 h-2.5 text-gray-500">{Icons.dropdown}</span>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 p-1 bg-white border border-gray-300 rounded-lg shadow-xl z-50 min-w-[140px]">
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] rounded hover:bg-gray-100"
            onClick={() => { onMerge(); setIsOpen(false); }}
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M6 10h8M10 6l4 4-4 4" stroke="currentColor" strokeWidth="1.5" /></svg>
            Combinar y centrar
          </button>
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] rounded hover:bg-gray-100"
            onClick={() => { onMerge(); setIsOpen(false); }}
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="16" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="2" y="12" width="16" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            Combinar horizontalmente
          </button>
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] rounded hover:bg-gray-100"
            onClick={() => { onMerge(); setIsOpen(false); }}
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="6" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="12" y="2" width="6" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            Combinar verticalmente
          </button>
          <div className="border-t border-gray-200 my-1" />
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] rounded hover:bg-gray-100 text-red-600"
            onClick={() => { onUnmerge(); setIsOpen(false); }}
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4"><rect x="2" y="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" /><line x1="6" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="1.5" /></svg>
            Separar celdas
          </button>
        </div>
      )}
    </div>
  );
};

interface RibbonButtonProps {
  icon: React.ReactNode;
  label?: string;
  onClick?: () => void;
  size?: 'small' | 'large';
  active?: boolean;
  disabled?: boolean;
  hasDropdown?: boolean;
  tooltip?: string;
}

const RibbonButton: React.FC<RibbonButtonProps> = ({
  icon,
  label,
  onClick,
  size = 'small',
  active = false,
  disabled = false,
  hasDropdown = false,
  tooltip = ''
}) => {
  const sizeClasses = size === 'small'
    ? "w-7 h-7 p-0.5"
    : "min-w-[48px] h-[58px] px-1.5 py-1 gap-0.5";

  const iconSize = size === 'small' ? "w-4 h-4" : "w-6 h-6";

  return (
    <button
      className={`flex flex-col items-center justify-center border rounded cursor-pointer transition-all text-gray-700
        ${disabled ? 'opacity-40 cursor-not-allowed border-transparent' : 'border-transparent hover:bg-[rgba(0,0,0,0.06)] hover:border-gray-300'}
        ${active ? 'bg-[rgba(33,115,70,0.12)] border-[#217346] text-[#217346]' : ''}
        ${sizeClasses}`}
      onClick={onClick}
      disabled={disabled}
      title={tooltip || label}
      aria-label={tooltip || label}
      aria-pressed={active}
    >
      <span className={iconSize}>{icon}</span>
      {size === 'large' && label && (
        <span className="text-[10px] text-center leading-tight max-w-[60px] break-words font-medium">{label}</span>
      )}
      {hasDropdown && <span className="w-2.5 h-2.5 text-gray-500">{Icons.dropdown}</span>}
    </button>
  );
};

interface SplitButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  onDropdownClick?: () => void;
  size?: 'small' | 'large';
  tooltip?: string;
}

const SplitButton: React.FC<SplitButtonProps> = ({ icon, label, onClick, onDropdownClick, size = 'large', tooltip }) => {
  return (
    <div className={`flex flex-col items-stretch rounded overflow-hidden border border-transparent hover:border-gray-300 transition-colors ${size === 'large' ? 'min-w-[48px] h-[58px]' : ''}`}>
      <button
        className="flex-1 flex flex-col items-center justify-center border-none bg-transparent cursor-pointer p-1 gap-0.5 hover:bg-[rgba(0,0,0,0.06)] transition-colors"
        onClick={onClick}
        title={tooltip || label}
        aria-label={tooltip || label}
      >
        <span className="w-5 h-5">{icon}</span>
        {size === 'large' && <span className="text-[10px] text-gray-700 leading-tight font-medium">{label}</span>}
      </button>
      <button
        className="flex items-center justify-center h-3.5 border-none border-t border-gray-200 bg-transparent cursor-pointer hover:bg-[rgba(0,0,0,0.08)] transition-colors"
        onClick={onDropdownClick || onClick}
        aria-label={`${label} opciones`}
        aria-haspopup="true"
      >
        <span className="w-2.5 h-2.5 text-gray-500">{Icons.dropdown}</span>
      </button>
    </div>
  );
};

const RibbonGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  return (
    <div className="flex flex-col px-1.5 py-1 relative" role="group" aria-label={title}>
      <div className="flex items-start gap-0.5 flex-1 min-h-[48px]">
        {children}
      </div>
      <div className="text-[9px] text-gray-500 text-center pt-0.5 border-t border-gray-200/60 mt-0.5 uppercase tracking-wide font-medium">
        {title}
      </div>
    </div>
  );
};

const RibbonSeparator: React.FC = () => <div className="w-px h-[62px] bg-gradient-to-b from-gray-200 via-gray-300 to-gray-200 mx-0.5" />;

const ChartThumbnail: React.FC<{ type: string; label: string; onClick: () => void }> = ({ type, label, onClick }) => {
  const chartSvgs: Record<string, React.ReactNode> = {
    col_clustered: (
      <svg viewBox="0 0 100 80" fill="none" className="w-14 h-12">
        <rect x="15" y="35" width="12" height="30" stroke="#111827" fill="#2563eb" fillOpacity="0.3" />
        <rect x="32" y="20" width="12" height="45" stroke="#111827" fill="#2563eb" fillOpacity="0.5" />
        <rect x="49" y="10" width="12" height="55" stroke="#111827" fill="#2563eb" fillOpacity="0.7" />
        <rect x="66" y="25" width="12" height="40" stroke="#111827" fill="#2563eb" fillOpacity="0.4" />
        <line x1="10" y1="66" x2="92" y2="66" stroke="#111827" />
      </svg>
    ),
    col_stacked: (
      <svg viewBox="0 0 100 80" fill="none" className="w-14 h-12">
        <rect x="20" y="40" width="14" height="26" stroke="#111827" fill="#2563eb" fillOpacity="0.5" />
        <rect x="20" y="26" width="14" height="14" stroke="#111827" fill="#f59e0b" fillOpacity="0.5" />
        <rect x="45" y="30" width="14" height="36" stroke="#111827" fill="#2563eb" fillOpacity="0.5" />
        <rect x="45" y="16" width="14" height="14" stroke="#111827" fill="#f59e0b" fillOpacity="0.5" />
        <rect x="70" y="20" width="14" height="46" stroke="#111827" fill="#2563eb" fillOpacity="0.5" />
        <line x1="10" y1="66" x2="92" y2="66" stroke="#111827" />
      </svg>
    ),
    bar_clustered: (
      <svg viewBox="0 0 100 80" fill="none" className="w-14 h-12">
        <rect x="18" y="16" width="55" height="10" stroke="#111827" fill="#2563eb" fillOpacity="0.5" />
        <rect x="18" y="34" width="35" height="10" stroke="#111827" fill="#2563eb" fillOpacity="0.5" />
        <rect x="18" y="52" width="65" height="10" stroke="#111827" fill="#2563eb" fillOpacity="0.5" />
      </svg>
    ),
    line_basic: (
      <svg viewBox="0 0 100 80" fill="none" className="w-14 h-12">
        <polyline points="12,56 34,36 56,46 86,20" stroke="#2563eb" strokeWidth="2" fill="none" />
        <circle cx="12" cy="56" r="3" fill="#2563eb" />
        <circle cx="34" cy="36" r="3" fill="#2563eb" />
        <circle cx="56" cy="46" r="3" fill="#2563eb" />
        <circle cx="86" cy="20" r="3" fill="#2563eb" />
        <line x1="10" y1="66" x2="92" y2="66" stroke="#111827" />
      </svg>
    ),
    area_basic: (
      <svg viewBox="0 0 100 80" fill="none" className="w-14 h-12">
        <polygon points="12,66 12,56 34,36 56,46 86,20 86,66" fill="#2563eb" fillOpacity="0.3" stroke="#2563eb" strokeWidth="2" />
        <line x1="10" y1="66" x2="92" y2="66" stroke="#111827" />
      </svg>
    ),
    pie_basic: (
      <svg viewBox="0 0 100 80" fill="none" className="w-14 h-12">
        <circle cx="50" cy="40" r="28" fill="none" stroke="#111827" />
        <path d="M50,40 L50,12 A28,28 0 0,1 78,40 Z" fill="#2563eb" fillOpacity="0.7" />
        <path d="M50,40 L78,40 A28,28 0 0,1 35,65 Z" fill="#f59e0b" fillOpacity="0.7" />
        <path d="M50,40 L35,65 A28,28 0 0,1 50,12 Z" fill="#22c55e" fillOpacity="0.7" />
      </svg>
    ),
    scatter_basic: (
      <svg viewBox="0 0 100 80" fill="none" className="w-14 h-12">
        <circle cx="20" cy="50" r="4" fill="#2563eb" />
        <circle cx="35" cy="35" r="4" fill="#2563eb" />
        <circle cx="50" cy="45" r="4" fill="#2563eb" />
        <circle cx="65" cy="25" r="4" fill="#2563eb" />
        <circle cx="80" cy="30" r="4" fill="#2563eb" />
        <line x1="10" y1="66" x2="92" y2="66" stroke="#111827" />
        <line x1="12" y1="10" x2="12" y2="66" stroke="#111827" />
      </svg>
    ),
    radar_basic: (
      <svg viewBox="0 0 100 80" fill="none" className="w-14 h-12">
        <polygon points="50,15 80,30 75,55 25,55 20,30" fill="#2563eb" fillOpacity="0.3" stroke="#2563eb" strokeWidth="2" />
        <polygon points="50,25 68,35 65,50 35,50 32,35" fill="none" stroke="#111827" strokeDasharray="2" />
      </svg>
    )
  };

  return (
    <button
      className="border border-gray-200 rounded-lg bg-white h-[70px] cursor-pointer flex flex-col items-center justify-center gap-1 hover:border-blue-400 hover:shadow-md transition-all"
      onClick={onClick}
    >
      {chartSvgs[type] || <span className="text-2xl">📊</span>}
      <span className="text-[9px] text-gray-600">{label}</span>
    </button>
  );
};

interface ChartPickerProps {
  icon: React.ReactNode;
  label: string;
  onSelect: (chartType: string) => void;
  chartTypes: Array<{ type: string; label: string; category: string }>;
}

const ChartPicker: React.FC<ChartPickerProps> = ({ icon, label, onSelect, chartTypes }) => {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const categories = [...new Set(chartTypes.map(c => c.category))];

  return (
    <div className="relative" ref={pickerRef}>
      <div className="flex flex-col items-stretch rounded overflow-hidden border border-transparent hover:border-gray-300 transition-colors min-w-[52px] h-[58px]">
        <button
          className="flex-1 flex flex-col items-center justify-center border-none bg-transparent cursor-pointer p-1 gap-0.5 hover:bg-[rgba(0,0,0,0.06)] transition-colors"
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className="w-5 h-5">{icon}</span>
          <span className="text-[10px] text-gray-700 leading-tight font-medium">{label}</span>
        </button>
        <button
          className="flex items-center justify-center h-3.5 border-none border-t border-gray-200 bg-transparent cursor-pointer hover:bg-[rgba(0,0,0,0.08)] transition-colors"
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="true"
          aria-expanded={isOpen}
        >
          <span className="w-2.5 h-2.5 text-gray-500">{Icons.dropdown}</span>
        </button>
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 p-3 bg-white border border-gray-300 rounded-xl shadow-xl z-50 min-w-[340px]">
          {categories.map((category) => (
            <div key={category} className="mb-3 last:mb-0">
              <h4 className="text-[11px] font-semibold text-gray-700 mb-2 px-1">{category}</h4>
              <div className="grid grid-cols-3 gap-2">
                {chartTypes.filter(c => c.category === category).map((chart) => (
                  <ChartThumbnail
                    key={chart.type}
                    type={chart.type}
                    label={chart.label}
                    onClick={() => { onSelect(chart.type); setIsOpen(false); }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const HomeTabContent: React.FC<{
  commands: Partial<RibbonCommands>;
  cellFormat?: CellFormat;
  currentFont: string;
  currentFontSize: string;
  currentNumberFormat: string;
}> = ({ commands, cellFormat, currentFont, currentFontSize, currentNumberFormat }) => {
  const fonts = ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Verdana'];
  const sizes = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36', '48', '72'];

  const [fontColor, setFontColor] = useState(cellFormat?.color || '#000000');
  const [fillColor, setFillColor] = useState(cellFormat?.backgroundColor || '#ffffff');

  return (
    <div className="flex items-start gap-0.5 px-1 py-0.5 min-h-[72px]">
      <RibbonGroup title="Portapapeles">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.paste} label="Pegar" onClick={() => commands.paste?.()} tooltip="Pegar (Ctrl+V)" />
          <div className="flex flex-col gap-0.5 pt-0.5">
            <RibbonButton icon={Icons.cut} onClick={() => commands.cut?.()} tooltip="Cortar (Ctrl+X)" />
            <RibbonButton icon={Icons.copy} onClick={() => commands.copy?.()} tooltip="Copiar (Ctrl+C)" />
            <RibbonButton icon={Icons.formatPainter} tooltip="Copiar formato" />
          </div>
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Fuente">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-0.5">
            <Dropdown value={currentFont} options={fonts} onChange={(f) => commands.setFont?.(f)} width={140} />
            <Dropdown value={currentFontSize} options={sizes} onChange={(s) => commands.setFontSize?.(parseInt(s))} width={50} />
            <RibbonButton
              icon={<span className="text-[12px] font-semibold">A<sup className="text-[7px] ml-[-1px]">▲</sup></span>}
              onClick={() => commands.setFontSize?.(parseInt(currentFontSize) + 2)}
              tooltip="Aumentar tamaño de fuente"
            />
            <RibbonButton
              icon={<span className="text-[10px] font-semibold">A<sup className="text-[7px] ml-[-1px]">▼</sup></span>}
              onClick={() => commands.setFontSize?.(Math.max(6, parseInt(currentFontSize) - 2))}
              tooltip="Reducir tamaño de fuente"
            />
          </div>
          <div className="flex items-center gap-px">
            <RibbonButton icon={<span className="text-[13px] font-bold">N</span>} active={cellFormat?.bold} onClick={() => commands.toggleBold?.()} tooltip="Negrita (Ctrl+B)" />
            <RibbonButton icon={<span className="text-[13px] italic font-medium">K</span>} active={cellFormat?.italic} onClick={() => commands.toggleItalic?.()} tooltip="Cursiva (Ctrl+I)" />
            <RibbonButton icon={<span className="text-[13px] underline font-medium">S</span>} active={cellFormat?.underline} onClick={() => commands.toggleUnderline?.()} tooltip="Subrayado (Ctrl+U)" />
            <div className="w-px h-5 bg-gray-200 mx-0.5" />
            <BorderPicker onSelect={(type, style) => commands.setBorders?.(type, style)} />
            <ColorPicker
              color={fillColor}
              onChange={(c) => { setFillColor(c); commands.setFillColor?.(c); }}
              icon={<span className="text-[11px]">🪣</span>}
              tooltip="Color de relleno"
            />
            <ColorPicker
              color={fontColor}
              onChange={(c) => { setFontColor(c); commands.setFontColor?.(c); }}
              icon={<span className="text-[12px] font-bold" style={{ borderBottom: `3px solid ${fontColor}` }}>A</span>}
              tooltip="Color de fuente"
            />
          </div>
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Alineación">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-px">
            <RibbonButton icon={Icons.alignLeft} onClick={() => commands.alignLeft?.()} active={cellFormat?.align === 'left'} tooltip="Alinear izquierda" />
            <RibbonButton icon={Icons.alignCenter} onClick={() => commands.alignCenter?.()} active={cellFormat?.align === 'center'} tooltip="Centrar" />
            <RibbonButton icon={Icons.alignRight} onClick={() => commands.alignRight?.()} active={cellFormat?.align === 'right'} tooltip="Alinear derecha" />
          </div>
          <div className="flex items-center gap-px">
            <RibbonButton icon={Icons.wrapText} onClick={() => commands.wrapText?.()} tooltip="Ajustar texto" />
            <MergePicker onMerge={() => commands.mergeCells?.()} onUnmerge={() => commands.unmergeCells?.()} />
          </div>
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Número">
        <div className="flex flex-col gap-1">
          <NumberFormatPicker value={currentNumberFormat} onChange={(fmt) => commands.setNumberFormat?.(fmt)} />
          <div className="flex items-center gap-px">
            <RibbonButton
              icon={<span className="text-[11px] font-bold text-green-700">$</span>}
              onClick={() => commands.setNumberFormat?.('Moneda')}
              tooltip="Formato moneda"
            />
            <RibbonButton
              icon={<span className="text-[11px] font-bold">%</span>}
              onClick={() => commands.setNumberFormat?.('Porcentaje')}
              tooltip="Formato porcentaje"
            />
            <RibbonButton
              icon={<span className="text-[9px] font-mono">,00</span>}
              onClick={() => commands.setNumberFormat?.('Número')}
              tooltip="Estilo millares"
            />
          </div>
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Estilos">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.conditionalFormat} label="Condicional" onClick={() => commands.applyConditionalFormat?.()} tooltip="Formato condicional" />
          <SplitButton icon={Icons.formatTable} label="Tabla" onClick={() => { }} tooltip="Dar formato como tabla" />
          <SplitButton icon={Icons.cellStyles} label="Estilos" onClick={() => { }} tooltip="Estilos de celda" />
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Celdas">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.insertRow} label="Insertar" onClick={() => commands.insertRow?.()} tooltip="Insertar celdas" />
          <SplitButton icon={Icons.deleteRow} label="Eliminar" onClick={() => commands.deleteRow?.()} tooltip="Eliminar celdas" />
          <SplitButton icon={Icons.format} label="Formato" onClick={() => { }} tooltip="Formato de celdas" />
        </div>
      </RibbonGroup>

      <RibbonSeparator />

      <RibbonGroup title="Edición">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.sortAsc} label="A→Z" onClick={() => commands.sort?.('asc')} tooltip="Ordenar A-Z" />
          <SplitButton icon={Icons.sort} label="Z→A" onClick={() => commands.sort?.('desc')} tooltip="Ordenar Z-A" />
          <SplitButton icon={Icons.filter} label="Filtro" onClick={() => commands.filter?.()} tooltip="Aplicar filtro" />
          <SplitButton icon={Icons.find} label="Buscar" onClick={() => commands.findReplace?.()} tooltip="Buscar y reemplazar" />
        </div>
      </RibbonGroup>
    </div>
  );
};

const InsertTabContent: React.FC<{ commands: Partial<RibbonCommands> }> = ({ commands }) => {
  const columnChartTypes = [
    { type: 'col_clustered', label: 'Agrupadas', category: 'Columnas 2D' },
    { type: 'col_stacked', label: 'Apiladas', category: 'Columnas 2D' },
    { type: 'bar_clustered', label: 'Barras', category: 'Barras 2D' },
  ];

  const lineChartTypes = [
    { type: 'line_basic', label: 'Línea', category: 'Líneas 2D' },
    { type: 'area_basic', label: 'Área', category: 'Áreas 2D' },
  ];

  const pieChartTypes = [
    { type: 'pie_basic', label: 'Circular', category: 'Circular' },
  ];

  const scatterChartTypes = [
    { type: 'scatter_basic', label: 'Dispersión', category: 'XY (Dispersión)' },
    { type: 'radar_basic', label: 'Radial', category: 'Otros' },
  ];

  return (
    <div className="flex items-start gap-0.5 px-1 py-0.5 min-h-[72px]">
      <RibbonGroup title="Hoja / Tablas">
        <div className="flex items-start gap-0.5">
          <SplitButton
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="1" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            }
            label="Hoja de tabla"
            onClick={() => { }}
            tooltip="Insertar tabla dinámica"
          />
          <SplitButton icon={Icons.formatTable} label="Tabla" onClick={() => { }} tooltip="Insertar tabla" />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Gráfico">
        <div className="flex items-start gap-0.5">
          <ChartPicker
            icon={Icons.chart}
            label="Gráfico"
            onSelect={(type) => commands.insertChart?.(type)}
            chartTypes={columnChartTypes}
          />
          <ChartPicker
            icon={Icons.lineChart}
            label="Líneas"
            onSelect={(type) => commands.insertChart?.(type)}
            chartTypes={lineChartTypes}
          />
          <ChartPicker
            icon={
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="3" />
                <circle cx="14" cy="14" r="4" />
                <circle cx="18" cy="6" r="2" />
              </svg>
            }
            label="Dispersión"
            onSelect={(type) => commands.insertChart?.(type)}
            chartTypes={scatterChartTypes}
          />
          <ChartPicker
            icon={Icons.pieChart}
            label="Otros"
            onSelect={(type) => commands.insertChart?.(type)}
            chartTypes={pieChartTypes}
          />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Ilustraciones">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.image} label="Imagen" onClick={() => { }} tooltip="Insertar imagen" />
          <SplitButton icon={Icons.shapes} label="Formas" onClick={() => { }} tooltip="Insertar forma" />
          <SplitButton
            icon={
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            }
            label="Instantánea"
            onClick={() => { }}
            tooltip="Captura de pantalla de rango"
          />
          <SplitButton
            icon={
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <circle cx="9" cy="12" r="2" />
                <line x1="14" y1="10" x2="18" y2="10" />
                <line x1="14" y1="14" x2="18" y2="14" />
              </svg>
            }
            label="Controles"
            onClick={() => { }}
            tooltip="Insertar controles de formulario"
          />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Vínculos">
        <SplitButton
          icon={
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          }
          label="Hipervínculo"
          onClick={() => { }}
          tooltip="Insertar hipervínculo (Ctrl+K)"
        />
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Texto">
        <SplitButton
          icon={<span className="text-[16px] font-serif">A</span>}
          label="Cuadro de texto"
          onClick={() => { }}
          tooltip="Insertar cuadro de texto"
        />
      </RibbonGroup>
    </div>
  );
};

const DrawTabContent: React.FC<{ commands: Partial<RibbonCommands> }> = ({ commands }) => {
  return (
    <div className="flex items-start gap-0.5 px-1 py-0.5 min-h-[72px]">
      <RibbonGroup title="Herramientas">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.pencil} label="Lápiz" onClick={() => { }} tooltip="Dibujar con lápiz" />
          <SplitButton icon={Icons.highlighter} label="Resaltador" onClick={() => { }} tooltip="Resaltar" />
          <SplitButton icon={Icons.eraser} label="Borrador" onClick={() => { }} tooltip="Borrar" />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Acciones">
        <div className="flex items-start gap-0.5">
          <RibbonButton icon={Icons.undo} size="large" label="Deshacer" onClick={() => commands.undo?.()} tooltip="Deshacer (Ctrl+Z)" />
          <RibbonButton icon={Icons.redo} size="large" label="Rehacer" onClick={() => commands.redo?.()} tooltip="Rehacer (Ctrl+Y)" />
        </div>
      </RibbonGroup>
    </div>
  );
};

const PageLayoutTabContent: React.FC = () => {
  return (
    <div className="flex items-start gap-0.5 px-1 py-0.5 min-h-[72px]">
      <RibbonGroup title="Configurar página">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.format} label="Márgenes" onClick={() => { }} tooltip="Configurar márgenes" />
          <SplitButton icon={Icons.format} label="Orientación" onClick={() => { }} tooltip="Orientación de página" />
          <SplitButton icon={Icons.format} label="Tamaño" onClick={() => { }} tooltip="Tamaño de papel" />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Opciones de hoja">
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
            <input type="checkbox" className="w-3 h-3 accent-[#217346]" />
            <span>Líneas de cuadrícula</span>
          </label>
          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
            <input type="checkbox" className="w-3 h-3 accent-[#217346]" />
            <span>Encabezados</span>
          </label>
        </div>
      </RibbonGroup>
    </div>
  );
};

const FormulasTabContent: React.FC<{ commands: Partial<RibbonCommands> }> = ({ commands }) => {
  return (
    <div className="flex items-start gap-0.5 px-1 py-0.5 min-h-[72px]">
      <RibbonGroup title="Funciones rápidas">
        <div className="flex items-start gap-0.5">
          <SplitButton
            icon={Icons.sum}
            label="SUMA"
            onClick={() => commands.insertFormula?.('SUM')}
            tooltip="Insertar SUMA - suma los valores de un rango"
          />
          <SplitButton
            icon={<span className="text-[10px] font-bold">x̄</span>}
            label="PROMEDIO"
            onClick={() => commands.insertFormula?.('AVERAGE')}
            tooltip="Insertar PROMEDIO - calcula el promedio de un rango"
          />
          <SplitButton
            icon={<span className="text-[10px] font-bold">#</span>}
            label="CONTAR"
            onClick={() => commands.insertFormula?.('COUNT')}
            tooltip="Insertar CONTAR - cuenta las celdas con números"
          />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Estadísticas">
        <div className="flex items-start gap-0.5">
          <SplitButton
            icon={<span className="text-[10px] font-bold">↑</span>}
            label="MAX"
            onClick={() => commands.insertFormula?.('MAX')}
            tooltip="Insertar MAX - encuentra el valor máximo"
          />
          <SplitButton
            icon={<span className="text-[10px] font-bold">↓</span>}
            label="MIN"
            onClick={() => commands.insertFormula?.('MIN')}
            tooltip="Insertar MIN - encuentra el valor mínimo"
          />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Lógicas">
        <div className="flex items-start gap-0.5">
          <SplitButton
            icon={<span className="text-[10px] font-bold">?:</span>}
            label="SI"
            onClick={() => commands.insertFormula?.('IF')}
            tooltip="Insertar SI - condición lógica"
          />
          <SplitButton
            icon={<span className="text-[10px] font-bold">↔</span>}
            label="BUSCARV"
            onClick={() => commands.insertFormula?.('VLOOKUP')}
            tooltip="Insertar BUSCARV - buscar valores en una tabla"
          />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Biblioteca">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.function} label="Todas" onClick={() => { }} tooltip="Ver todas las funciones disponibles" />
        </div>
      </RibbonGroup>
    </div>
  );
};

const DataTabContent: React.FC<{ commands: Partial<RibbonCommands> }> = ({ commands }) => {
  return (
    <div className="flex items-start gap-0.5 px-1 py-0.5 min-h-[72px]">
      <RibbonGroup title="Obtener datos">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.format} label="Externos" onClick={() => { }} tooltip="Obtener datos externos" />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Ordenar y filtrar">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.sortAsc} label="A→Z" onClick={() => commands.sort?.('asc')} tooltip="Ordenar A-Z" />
          <SplitButton icon={Icons.sort} label="Z→A" onClick={() => commands.sort?.('desc')} tooltip="Ordenar Z-A" />
          <SplitButton icon={Icons.filter} label="Filtro" onClick={() => commands.filter?.()} tooltip="Aplicar filtro" />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Herramientas de datos">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.textToColumns} label="Texto en col." onClick={() => { }} tooltip="Texto en columnas" />
          <SplitButton icon={Icons.dataValidation} label="Validación" onClick={() => { }} tooltip="Validación de datos" />
        </div>
      </RibbonGroup>
    </div>
  );
};

const ReviewTabContent: React.FC = () => {
  return (
    <div className="flex items-start gap-0.5 px-1 py-0.5 min-h-[72px]">
      <RibbonGroup title="Revisión">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.spellcheck} label="Ortografía" onClick={() => { }} tooltip="Revisar ortografía" />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Comentarios">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.comment} label="Nuevo" onClick={() => { }} tooltip="Nuevo comentario" />
          <SplitButton icon={Icons.share} label="Mostrar" onClick={() => { }} tooltip="Mostrar comentarios" />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Proteger">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.protect} label="Hoja" onClick={() => { }} tooltip="Proteger hoja" />
          <SplitButton icon={Icons.protect} label="Libro" onClick={() => { }} tooltip="Proteger libro" />
        </div>
      </RibbonGroup>
    </div>
  );
};

const ViewTabContent: React.FC<{ commands: Partial<RibbonCommands> }> = ({ commands }) => {
  const [showGridlines, setShowGridlines] = useState(true);
  const [showHeaders, setShowHeaders] = useState(true);

  return (
    <div className="flex items-start gap-0.5 px-1 py-0.5 min-h-[72px]">
      <RibbonGroup title="Vistas del libro">
        <div className="flex items-start gap-0.5">
          <RibbonButton icon={Icons.gridlines} size="large" label="Normal" active tooltip="Vista normal" />
          <RibbonButton icon={Icons.format} size="large" label="Diseño" tooltip="Vista diseño" />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Mostrar">
        <div className="flex flex-col gap-1.5 py-1">
          <label className="flex items-center gap-2 text-[10px] cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded">
            <input
              type="checkbox"
              checked={showGridlines}
              onChange={(e) => { setShowGridlines(e.target.checked); commands.toggleGridlines?.(); }}
              className="w-3.5 h-3.5 accent-[#217346]"
            />
            <span className="font-medium">Líneas de cuadrícula</span>
          </label>
          <label className="flex items-center gap-2 text-[10px] cursor-pointer hover:bg-gray-100 px-1 py-0.5 rounded">
            <input
              type="checkbox"
              checked={showHeaders}
              onChange={(e) => setShowHeaders(e.target.checked)}
              className="w-3.5 h-3.5 accent-[#217346]"
            />
            <span className="font-medium">Encabezados</span>
          </label>
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Ventana">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.freezePanes} label="Inmovilizar" onClick={() => commands.freezePanes?.()} tooltip="Inmovilizar paneles" />
          <SplitButton icon={Icons.format} label="Dividir" onClick={() => { }} tooltip="Dividir ventana" />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Zoom">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.zoom} label="Zoom" onClick={() => { }} tooltip="Ajustar zoom" />
          <RibbonButton icon={<span className="text-[10px] font-bold">100%</span>} size="large" label="100%" tooltip="Zoom al 100%" />
        </div>
      </RibbonGroup>
    </div>
  );
};

const AutomateTabContent: React.FC<{ onRunAutomation?: (prompt: string) => void }> = ({ onRunAutomation }) => {
  const [prompt, setPrompt] = useState('');

  const handleRun = useCallback(() => {
    if (prompt.trim() && onRunAutomation) {
      onRunAutomation(prompt.trim());
      setPrompt('');
    }
  }, [prompt, onRunAutomation]);

  return (
    <div className="flex items-start gap-0.5 px-1 py-0.5 min-h-[72px]">
      <RibbonGroup title="Scripts">
        <div className="flex items-start gap-0.5">
          <SplitButton icon={Icons.macro} label="Grabar" onClick={() => { }} tooltip="Grabar macro" />
          <SplitButton icon={Icons.script} label="Editor" onClick={() => { }} tooltip="Editor de scripts" />
        </div>
      </RibbonGroup>
      <RibbonSeparator />
      <RibbonGroup title="Automatización con IA">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRun()}
            placeholder="Describe qué quieres automatizar..."
            className="h-7 w-64 px-2 text-[11px] border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#217346] focus:border-[#217346]"
            aria-label="Prompt de automatización"
          />
          <button
            onClick={handleRun}
            disabled={!prompt.trim()}
            className="h-7 px-3 text-[11px] font-medium text-white bg-[#217346] rounded hover:bg-[#185c37] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Ejecutar
          </button>
        </div>
      </RibbonGroup>
    </div>
  );
};

export function ExcelRibbon({ commands, cellFormat, currentFont = 'Calibri', currentFontSize = 11, currentNumberFormat = 'General', onRunAutomation }: ExcelRibbonProps) {
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const tabListRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, tabId: TabId) => {
    const tabs = RIBBON_TABS.map(t => t.id);
    const currentIndex = tabs.indexOf(tabId);

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % tabs.length;
      setActiveTab(tabs[nextIndex]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      setActiveTab(tabs[prevIndex]);
    }
  }, []);

  const tabContent = useMemo(() => {
    switch (activeTab) {
      case 'home':
        return <HomeTabContent commands={commands} cellFormat={cellFormat} currentFont={currentFont} currentFontSize={String(currentFontSize)} currentNumberFormat={currentNumberFormat} />;
      case 'insert':
        return <InsertTabContent commands={commands} />;
      case 'draw':
        return <DrawTabContent commands={commands} />;
      case 'pageLayout':
        return <PageLayoutTabContent />;
      case 'formulas':
        return <FormulasTabContent commands={commands} />;
      case 'data':
        return <DataTabContent commands={commands} />;
      case 'review':
        return <ReviewTabContent />;
      case 'view':
        return <ViewTabContent commands={commands} />;
      case 'automate':
        return <AutomateTabContent onRunAutomation={onRunAutomation} />;
      default:
        return null;
    }
  }, [activeTab, commands, cellFormat, currentFont, currentFontSize, currentNumberFormat, onRunAutomation]);

  return (
    <div className="flex flex-col border-b border-gray-300 bg-white select-none" data-testid="excel-ribbon">
      <div
        className="flex items-center h-8 px-1 bg-[#217346]"
        role="tablist"
        aria-label="Pestañas de la cinta de opciones"
        ref={tabListRef}
      >
        {RIBBON_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`ribbon-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`px-3 py-1.5 text-[11px] font-medium rounded-t transition-all cursor-pointer
              ${activeTab === tab.id
                ? 'bg-white text-[#217346] shadow-sm'
                : 'text-white/90 hover:text-white hover:bg-white/10'}`}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id={`ribbon-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={activeTab}
        className="bg-gradient-to-b from-[#f8f8f8] to-[#f0f0f0] border-b border-gray-200"
      >
        {tabContent}
      </div>
    </div>
  );
}
