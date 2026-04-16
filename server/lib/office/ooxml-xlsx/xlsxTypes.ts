/**
 * XLSX-specific types for the Office Engine.
 *
 * The DOCX slice's `EditOp` union covers paragraph/run/table operations. XLSX
 * needs a different vocabulary for cells, ranges, sheets, formulas, etc.
 */

import type { OoxmlNode, OoxmlTree } from "../ooxml/xmlSerializer";

// ---------------------------------------------------------------------------
// Edit operations (XLSX vocabulary)
// ---------------------------------------------------------------------------

export type XlsxEditOp =
  | { op: "setCellValue"; sheet: string; cell: string; value: string | number; type?: "string" | "number" | "inlineStr" }
  | { op: "setCellFormula"; sheet: string; cell: string; formula: string; cachedValue?: string }
  | { op: "setRangeValues"; sheet: string; startCell: string; rows: Array<Array<string | number>> }
  | { op: "appendRow"; sheet: string; cells: Array<string | number> }
  | { op: "renameSheet"; from: string; to: string }
  | { op: "addNamedRange"; name: string; refersTo: string }
  | { op: "mergeCells"; sheet: string; range: string };

export interface XlsxEditResult {
  diff: { added: number; removed: number };
  touchedNodePaths: string[];
  level: 0 | 1 | 2;
  opResults: Array<{ op: XlsxEditOp["op"]; ok: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Semantic map
// ---------------------------------------------------------------------------

export interface XlsxCellInfo {
  /** A1-style address, e.g. "B7". */
  address: string;
  /** Numeric column index (1-based). */
  col: number;
  /** Numeric row index (1-based). */
  row: number;
  /** Cell type: "n" (number), "s" (sharedString), "str" (inline str), "b" (bool), "e" (error), "inlineStr". */
  type: string;
  /** The raw `<v>` value as it appears in the XML (already resolved against sharedStrings if applicable). */
  value: string;
  /** The raw formula text (e.g. "SUM(A1:A10)") if present. */
  formula?: string;
  /** Style index from the cell's `s` attribute. */
  styleIndex?: number;
  /** Pointer to the underlying <c> node so editors can mutate in place. */
  node: OoxmlNode;
}

export interface XlsxMergeInfo {
  /** A1-style range, e.g. "A1:B2". */
  range: string;
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

export interface XlsxSheetInfo {
  /** Sheet name from the workbook (`<sheet name="...">`). */
  name: string;
  /** rId from the workbook → sheet relationship. */
  rId: string;
  /** Path inside the package, e.g. "xl/worksheets/sheet1.xml". */
  partPath: string;
  /** Parsed sheet tree. */
  tree: OoxmlTree;
  /** Flat array of all `<c>` cells found in the sheet. */
  cells: XlsxCellInfo[];
  /** Number of `<row>` elements. */
  rowCount: number;
  /** Maximum column index seen across cells. */
  maxCol: number;
  /** Merged ranges. */
  merges: XlsxMergeInfo[];
}

export interface XlsxNamedRange {
  name: string;
  refersTo: string;
  /** Optional sheet scope (sheet id), absent for workbook-level names. */
  scope?: number;
}

export interface XlsxTableInfo {
  /** Table id from `<table id="...">`. */
  id: string;
  name: string;
  displayName: string;
  ref: string;
  partPath: string;
  /** Header column names. */
  headers: string[];
}

export interface XlsxSemanticWorkbook {
  /** All sheets in workbook order. */
  sheets: XlsxSheetInfo[];
  /** Named ranges (workbook scope). */
  namedRanges: XlsxNamedRange[];
  /** Structured tables (`xl/tables/table*.xml`). */
  tables: XlsxTableInfo[];
  /** Style ids actually referenced by cells (used to validate styles.xml). */
  referencedStyleIds: Set<number>;
  /** Charts found under `xl/charts/`. */
  charts: string[];
  /** Drawings found under `xl/drawings/`. */
  drawings: string[];
  /** Hyperlinks declared in any sheet rels. */
  hyperlinkCount: number;
  /** Comments parts (`xl/comments*.xml`). */
  comments: string[];
}
