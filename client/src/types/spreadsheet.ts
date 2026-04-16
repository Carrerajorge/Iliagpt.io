export interface CellStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline' | 'line-through';
  fontColor: string;
  fillColor: string;
  borderTop: BorderStyle | null;
  borderRight: BorderStyle | null;
  borderBottom: BorderStyle | null;
  borderLeft: BorderStyle | null;
  horizontalAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  textRotation: number;
  indentLevel: number;
  wrapText: boolean;
  numberFormat: string;
  decimalPlaces: number;
  useThousandsSeparator: boolean;
  currencySymbol: string;
}

export interface BorderStyle {
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double';
  color: string;
}

export interface CellData {
  value: any;
  formula: string | null;
  style: Partial<CellStyle>;
  comment: string | null;
  hyperlink: string | null;
}

export interface MergedCell {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface ClipboardData {
  mode: 'copy' | 'cut';
  data: CellData[][];
  styles: Partial<CellStyle>[][];
  sourceRange: { startRow: number; startCol: number; endRow: number; endCol: number };
  formatOnly: boolean;
}

export interface ConditionalRule {
  id: string;
  range: { startRow: number; startCol: number; endRow: number; endCol: number };
  type: 'greaterThan' | 'lessThan' | 'between' | 'equal' | 'text' | 'duplicate' | 'colorScale' | 'dataBar';
  condition: any;
  format: Partial<CellStyle>;
  priority: number;
}

export interface TableDefinition {
  id: string;
  name: string;
  range: { startRow: number; startCol: number; endRow: number; endCol: number };
  hasHeaders: boolean;
  style: string;
  bandedRows: boolean;
  bandedColumns: boolean;
  showFilters: boolean;
}

export const DEFAULT_CELL_STYLE: CellStyle = {
  fontFamily: 'Arial',
  fontSize: 11,
  fontWeight: 'normal',
  fontStyle: 'normal',
  textDecoration: 'none',
  fontColor: '#000000',
  fillColor: 'transparent',
  borderTop: null,
  borderRight: null,
  borderBottom: null,
  borderLeft: null,
  horizontalAlign: 'left',
  verticalAlign: 'middle',
  textRotation: 0,
  indentLevel: 0,
  wrapText: false,
  numberFormat: 'general',
  decimalPlaces: 2,
  useThousandsSeparator: false,
  currencySymbol: '$'
};
