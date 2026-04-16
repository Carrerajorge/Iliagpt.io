// ========== UTILIDADES DE REFERENCIA A1 ==========

// Convertir número de columna a letra (1 -> A, 27 -> AA)
export function colToName(col: number): string {
  let name = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    col = Math.floor((col - 1) / 26);
  }
  return name;
}

// Convertir letra de columna a número (A -> 1, AA -> 27)
export function nameToCol(name: string): number {
  let col = 0;
  for (const ch of name) {
    const code = ch.toUpperCase().charCodeAt(0) - 64;
    if (code < 1 || code > 26) return NaN;
    col = col * 26 + code;
  }
  return col;
}

// Parsear referencia A1 -> { col, row, a1 }
export function parseRef(ref: string): { col: number; row: number; a1: string } | null {
  const m = String(ref).trim().toUpperCase().match(/^([A-Z]+)([1-9][0-9]*)$/);
  if (!m) return null;
  return { col: nameToCol(m[1]), row: parseInt(m[2], 10), a1: m[1] + m[2] };
}

// Crear referencia desde row y col
export function makeRef(row: number, col: number): string {
  return colToName(col) + String(row);
}

// Clamp un número entre min y max
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Convertir valor a número
export function toNumber(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Verificar si parece número
export function isLikelyNumberString(s: string): boolean {
  const t = String(s).trim().replace(",", ".");
  if (t === "") return false;
  return /^[-+]?\d+(\.\d+)?$/.test(t);
}

// Formatear valor según estilo
export function formatValue(value: any, style: CellStyle): string {
  const fmt = style?.format || "general";
  const decimals = Number.isFinite(style?.decimals) ? style.decimals : 2;

  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);

  if (fmt === "text") return String(value);
  if (typeof value !== "number") return String(value);

  if (fmt === "general") {
    if (Math.abs(value - Math.round(value)) < 1e-12) return String(Math.round(value));
    return String(value);
  }

  if (fmt === "number") {
    return value.toFixed(decimals);
  }
  
  if (fmt === "currency") {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(value);
    } catch {
      return "$" + value.toFixed(decimals);
    }
  }
  
  if (fmt === "percent") {
    return (value * 100).toFixed(decimals) + "%";
  }

  return String(value);
}

// Escape para CSV
export function csvEscape(v: any): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Parser de CSV
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      cur += ch;
    } else {
      if (ch === '"') { inQuotes = true; continue; }
      if (ch === ",") { row.push(cur); cur = ""; continue; }
      if (ch === "\n") {
        row.push(cur); cur = "";
        rows.push(row);
        row = [];
        continue;
      }
      if (ch === "\r") continue;
      cur += ch;
    }
  }
  row.push(cur);
  rows.push(row);
  return rows;
}

// ========== TIPOS ==========

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  fgColor?: string;
  bgColor?: string;
  format?: 'general' | 'number' | 'currency' | 'percent' | 'text';
  decimals?: number;
}

export interface CellData {
  raw: string;
  style: CellStyle;
}

export interface Sheet {
  name: string;
  rows: number;
  cols: number;
  cells: Record<string, CellData>; // { "A1": { raw: "=1+2", style: {} } }
}

export interface Workbook {
  version: number;
  createdAt: string;
  active: number;
  sheets: Sheet[];
}

export interface Selection {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface NormalizedSelection {
  rMin: number;
  rMax: number;
  cMin: number;
  cMax: number;
}

// Normalizar selección
export function normSel(sel: Selection): NormalizedSelection {
  return {
    rMin: Math.min(sel.r1, sel.r2),
    rMax: Math.max(sel.r1, sel.r2),
    cMin: Math.min(sel.c1, sel.c2),
    cMax: Math.max(sel.c1, sel.c2)
  };
}

// Label de selección (A1 o A1:C3)
export function selectionLabel(sel: Selection): string {
  const { rMin, rMax, cMin, cMax } = normSel(sel);
  const a1 = makeRef(rMin, cMin);
  const b1 = makeRef(rMax, cMax);
  return a1 === b1 ? a1 : `${a1}:${b1}`;
}

// Crear nuevo workbook
export function newWorkbook(): Workbook {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    active: 0,
    sheets: [newSheet("Hoja1", 100, 26)]
  };
}

// Crear nueva hoja
export function newSheet(name: string = "Hoja1", rows: number = 100, cols: number = 26): Sheet {
  return {
    name,
    rows,
    cols,
    cells: {}
  };
}
