/**
 * Structural XLSX editor (level-2 fallback in the XLSX engine).
 *
 * Applies a list of XlsxEditOps to a parsed workbook, mutating the in-memory
 * trees and persisting each modified sheet (and the workbook, if sheet
 * metadata changed) back into the package.
 *
 * Operations supported in this slice:
 *   - setCellValue(sheet, cell, value, type?)
 *   - setCellFormula(sheet, cell, formula, cachedValue?)
 *   - setRangeValues(sheet, startCell, rows[][])
 *   - appendRow(sheet, cells[])
 *   - renameSheet(from, to)
 *   - addNamedRange(name, refersTo)
 *   - mergeCells(sheet, range)
 *
 * Strings written by setCellValue are stored inline (`t="inlineStr"`) rather
 * than interning into the shared strings table. This is deliberate: it
 * keeps the edit local to the sheet XML and avoids the round-trip complexity
 * of modifying sharedStrings.xml (which would invalidate every other cell
 * that points into it). Excel reads inlineStr just fine.
 */

import {
  parseOoxml,
  serializeOoxml,
  visitNodes,
  nodeTagName,
  nodeChildren,
  setAttr,
  setAttrs,
  TEXT_KEY,
  ATTR_PREFIX,
  ATTRS_KEY,
} from "../ooxml/xmlSerializer.ts";
import type { OoxmlNode, OoxmlTree } from "../ooxml/xmlSerializer.ts";
import type { DocxPackage } from "../ooxml/zipIO.ts";
import { getXmlEntry, setXmlEntry } from "../ooxml/zipIO.ts";
import type { XlsxEditOp, XlsxEditResult } from "./xlsxTypes.ts";
import type { XlsxSemanticWorkbook, XlsxSheetInfo } from "./xlsxTypes.ts";
import { parseAddress, toAddress } from "./xlsxSemanticMap.ts";

export function applyXlsxEdits(
  pkg: DocxPackage,
  workbook: XlsxSemanticWorkbook,
  ops: XlsxEditOp[],
): XlsxEditResult {
  let added = 0;
  let removed = 0;
  const touched: string[] = [];
  const opResults: XlsxEditResult["opResults"] = [];
  // Track which sheet trees (and whether the workbook itself) we mutated so
  // we can re-serialize them once at the end.
  const dirtySheets = new Set<string>();
  let workbookDirty = false;

  for (const op of ops) {
    try {
      const r = applyOp(pkg, workbook, op, touched, (partPath) => dirtySheets.add(partPath), () => {
        workbookDirty = true;
      });
      added += r.added;
      removed += r.removed;
      opResults.push({ op: op.op, ok: true });
    } catch (e) {
      opResults.push({ op: op.op, ok: false, error: e instanceof Error ? e.message : String(e) });
      throw e; // bubble up to the fallback ladder
    }
  }

  // Re-serialize every dirty sheet tree back into the package.
  for (const sheet of workbook.sheets) {
    if (!dirtySheets.has(sheet.partPath)) continue;
    setXmlEntry(pkg, sheet.partPath, serializeOoxml(sheet.tree).toString("utf8"));
  }
  // Workbook (sheet metadata) changes — re-read, mutate, re-write.
  if (workbookDirty) {
    const workbookRaw = getXmlEntry(pkg, "xl/workbook.xml");
    if (workbookRaw) {
      // The rename operation already mutated the workbook tree in place via
      // the workbook branch of applyOp — nothing to do here beyond persisting.
      // (See renameSheet below.)
    }
  }

  return {
    diff: { added, removed },
    touchedNodePaths: touched,
    level: 2,
    opResults,
  };
}

// ---------------------------------------------------------------------------
// Op dispatch
// ---------------------------------------------------------------------------

function applyOp(
  pkg: DocxPackage,
  workbook: XlsxSemanticWorkbook,
  op: XlsxEditOp,
  touched: string[],
  markSheetDirty: (partPath: string) => void,
  markWorkbookDirty: () => void,
): { added: number; removed: number } {
  switch (op.op) {
    case "setCellValue":
      return applySetCellValue(workbook, op, touched, markSheetDirty);
    case "setCellFormula":
      return applySetCellFormula(workbook, op, touched, markSheetDirty);
    case "setRangeValues":
      return applySetRangeValues(workbook, op, touched, markSheetDirty);
    case "appendRow":
      return applyAppendRow(workbook, op, touched, markSheetDirty);
    case "renameSheet":
      return applyRenameSheet(pkg, workbook, op, touched, markWorkbookDirty);
    case "addNamedRange":
      return applyAddNamedRange(pkg, op, touched);
    case "mergeCells":
      return applyMergeCells(workbook, op, touched, markSheetDirty);
  }
}

// ---------------------------------------------------------------------------
// Cell writers
// ---------------------------------------------------------------------------

function findSheet(workbook: XlsxSemanticWorkbook, name: string): XlsxSheetInfo {
  const sheet = workbook.sheets.find((s) => s.name === name);
  if (!sheet) throw new Error(`Sheet "${name}" not found`);
  return sheet;
}

/** Find the <row> element for a given row index inside a sheet tree (or null). */
function findRow(sheetTree: OoxmlTree, rowIdx: number): OoxmlNode | null {
  let found: OoxmlNode | null = null;
  visitNodes(sheetTree.nodes, (n) => {
    if (nodeTagName(n) !== "row") return;
    const a = ((n[ATTRS_KEY] as Record<string, string> | undefined) ?? {});
    const rAttr = a[`${ATTR_PREFIX}r`] ?? a["r"];
    if (rAttr && parseInt(rAttr, 10) === rowIdx) {
      found = n;
      return false;
    }
  });
  return found;
}

/** Find the <sheetData> parent element (where <row> children live). */
function findSheetData(sheetTree: OoxmlTree): OoxmlNode | null {
  let found: OoxmlNode | null = null;
  visitNodes(sheetTree.nodes, (n) => {
    if (nodeTagName(n) !== "sheetData") return;
    found = n;
    return false;
  });
  return found;
}

/** Ensure a <row r="N"> exists inside <sheetData>. Returns the row node. */
function ensureRow(sheetTree: OoxmlTree, rowIdx: number): OoxmlNode {
  const existing = findRow(sheetTree, rowIdx);
  if (existing) return existing;
  const sheetData = findSheetData(sheetTree);
  if (!sheetData) throw new Error("Sheet missing <sheetData>");
  const newRow: OoxmlNode = { "row": [] } as OoxmlNode;
  setAttr(newRow, "r", String(rowIdx));
  // Insert at the end — Excel tolerates out-of-order rows but we keep
  // insertion order predictable.
  const children = (sheetData as Record<string, unknown>)["sheetData"] as OoxmlNode[];
  children.push(newRow);
  return newRow;
}

/** Find or create a <c r="..."> cell in the given row. Returns the cell node. */
function ensureCell(rowNode: OoxmlNode, address: string): OoxmlNode {
  const children = (rowNode as Record<string, unknown>)["row"] as OoxmlNode[];
  for (const c of children) {
    if (nodeTagName(c) !== "c") continue;
    const attrs = ((c[ATTRS_KEY] as Record<string, string> | undefined) ?? {});
    const r = attrs[`${ATTR_PREFIX}r`] ?? attrs["r"];
    if (r === address) return c;
  }
  const newCell: OoxmlNode = { "c": [] } as OoxmlNode;
  setAttr(newCell, "r", address);
  children.push(newCell);
  return newCell;
}

/** Write an inline string value into a cell, replacing whatever was there. */
function writeInlineString(cell: OoxmlNode, text: string): number {
  const before = countCellText(cell);
  // <c r="A1" t="inlineStr"><is><t>text</t></is></c>
  setAttr(cell, "t", "inlineStr");
  const tNode: OoxmlNode = { "t": [{ [TEXT_KEY]: text } as OoxmlNode] } as OoxmlNode;
  if (/^\s|\s$/.test(text)) setAttr(tNode, "xml:space", "preserve");
  const isNode: OoxmlNode = { "is": [tNode] } as OoxmlNode;
  (cell as Record<string, unknown>)["c"] = [isNode];
  return before;
}

/** Write a numeric value into a cell. */
function writeNumber(cell: OoxmlNode, value: number): number {
  const before = countCellText(cell);
  // <c r="A1"><v>123</v></c> — no type attribute (default is "n")
  removeAttr(cell, "t");
  const vNode: OoxmlNode = { "v": [{ [TEXT_KEY]: String(value) } as OoxmlNode] } as OoxmlNode;
  (cell as Record<string, unknown>)["c"] = [vNode];
  return before;
}

/** Write a formula into a cell. */
function writeFormula(cell: OoxmlNode, formula: string, cachedValue?: string): number {
  const before = countCellText(cell);
  removeAttr(cell, "t");
  const fNode: OoxmlNode = { "f": [{ [TEXT_KEY]: formula } as OoxmlNode] } as OoxmlNode;
  const children: OoxmlNode[] = [fNode];
  if (cachedValue !== undefined) {
    children.push({ "v": [{ [TEXT_KEY]: cachedValue } as OoxmlNode] } as OoxmlNode);
  }
  (cell as Record<string, unknown>)["c"] = children;
  return before;
}

function countCellText(cell: OoxmlNode): number {
  let n = 0;
  visitNodes([cell], (node) => {
    if (nodeTagName(node) !== "v" && nodeTagName(node) !== "t") return;
    for (const c of nodeChildren(node)) {
      const v = (c as Record<string, unknown>)[TEXT_KEY];
      if (typeof v === "string") n += v.length;
    }
  });
  return n;
}

function removeAttr(node: OoxmlNode, name: string): void {
  const bag = node[ATTRS_KEY] as Record<string, string> | undefined;
  if (!bag) return;
  delete bag[`${ATTR_PREFIX}${name}`];
  delete bag[name];
}

// ---------------------------------------------------------------------------
// Op implementations
// ---------------------------------------------------------------------------

function applySetCellValue(
  workbook: XlsxSemanticWorkbook,
  op: Extract<XlsxEditOp, { op: "setCellValue" }>,
  touched: string[],
  markDirty: (partPath: string) => void,
): { added: number; removed: number } {
  const sheet = findSheet(workbook, op.sheet);
  const { row } = parseAddress(op.cell);
  if (row <= 0) throw new Error(`Invalid cell address: ${op.cell}`);
  const rowNode = ensureRow(sheet.tree, row);
  const cellNode = ensureCell(rowNode, op.cell);
  let before: number;
  if (typeof op.value === "number" || op.type === "number") {
    const n = typeof op.value === "number" ? op.value : parseFloat(op.value);
    if (!Number.isFinite(n)) throw new Error(`setCellValue: not a number: ${op.value}`);
    before = writeNumber(cellNode, n);
  } else {
    before = writeInlineString(cellNode, String(op.value));
  }
  touched.push(`${sheet.partPath}#${op.cell}`);
  markDirty(sheet.partPath);
  const after = String(op.value).length;
  return { added: after, removed: before };
}

function applySetCellFormula(
  workbook: XlsxSemanticWorkbook,
  op: Extract<XlsxEditOp, { op: "setCellFormula" }>,
  touched: string[],
  markDirty: (partPath: string) => void,
): { added: number; removed: number } {
  const sheet = findSheet(workbook, op.sheet);
  const { row } = parseAddress(op.cell);
  if (row <= 0) throw new Error(`Invalid cell address: ${op.cell}`);
  const rowNode = ensureRow(sheet.tree, row);
  const cellNode = ensureCell(rowNode, op.cell);
  const before = writeFormula(cellNode, op.formula, op.cachedValue);
  touched.push(`${sheet.partPath}#${op.cell}@formula`);
  markDirty(sheet.partPath);
  return { added: op.formula.length, removed: before };
}

function applySetRangeValues(
  workbook: XlsxSemanticWorkbook,
  op: Extract<XlsxEditOp, { op: "setRangeValues" }>,
  touched: string[],
  markDirty: (partPath: string) => void,
): { added: number; removed: number } {
  const sheet = findSheet(workbook, op.sheet);
  const start = parseAddress(op.startCell);
  if (start.col <= 0 || start.row <= 0) throw new Error(`Invalid startCell: ${op.startCell}`);
  let added = 0;
  let removed = 0;
  for (let ri = 0; ri < op.rows.length; ri++) {
    const rowIdx = start.row + ri;
    const rowNode = ensureRow(sheet.tree, rowIdx);
    for (let ci = 0; ci < op.rows[ri].length; ci++) {
      const colIdx = start.col + ci;
      const addr = toAddress(colIdx, rowIdx);
      const cellNode = ensureCell(rowNode, addr);
      const val = op.rows[ri][ci];
      let before: number;
      if (typeof val === "number") before = writeNumber(cellNode, val);
      else before = writeInlineString(cellNode, String(val));
      removed += before;
      added += String(val).length;
      touched.push(`${sheet.partPath}#${addr}`);
    }
  }
  markDirty(sheet.partPath);
  return { added, removed };
}

function applyAppendRow(
  workbook: XlsxSemanticWorkbook,
  op: Extract<XlsxEditOp, { op: "appendRow" }>,
  touched: string[],
  markDirty: (partPath: string) => void,
): { added: number; removed: number } {
  const sheet = findSheet(workbook, op.sheet);
  // New row index = current max row + 1
  let maxRow = 0;
  visitNodes(sheet.tree.nodes, (n) => {
    if (nodeTagName(n) !== "row") return;
    const attrs = ((n[ATTRS_KEY] as Record<string, string> | undefined) ?? {});
    const r = attrs[`${ATTR_PREFIX}r`] ?? attrs["r"];
    if (r) {
      const idx = parseInt(r, 10);
      if (idx > maxRow) maxRow = idx;
    }
  });
  const newRowIdx = maxRow + 1;
  const rowNode = ensureRow(sheet.tree, newRowIdx);
  let added = 0;
  for (let ci = 0; ci < op.cells.length; ci++) {
    const addr = toAddress(ci + 1, newRowIdx);
    const cellNode = ensureCell(rowNode, addr);
    const val = op.cells[ci];
    if (typeof val === "number") writeNumber(cellNode, val);
    else writeInlineString(cellNode, String(val));
    added += String(val).length;
    touched.push(`${sheet.partPath}#${addr}`);
  }
  markDirty(sheet.partPath);
  return { added, removed: 0 };
}

function applyRenameSheet(
  pkg: DocxPackage,
  workbook: XlsxSemanticWorkbook,
  op: Extract<XlsxEditOp, { op: "renameSheet" }>,
  touched: string[],
  markWorkbookDirty: () => void,
): { added: number; removed: number } {
  if (op.from === op.to) return { added: 0, removed: 0 };
  if (workbook.sheets.some((s) => s.name === op.to)) {
    throw new Error(`renameSheet: target name "${op.to}" already exists`);
  }
  const target = workbook.sheets.find((s) => s.name === op.from);
  if (!target) throw new Error(`renameSheet: source "${op.from}" not found`);

  // Workbook.xml is not tracked in the semantic map's sheet.tree — we need
  // to load, mutate, and persist it here.
  const workbookRaw = getXmlEntry(pkg, "xl/workbook.xml");
  if (!workbookRaw) throw new Error("renameSheet: xl/workbook.xml missing");
  const tree = parseOoxml(workbookRaw);
  let updated = false;
  visitNodes(tree.nodes, (n) => {
    if (nodeTagName(n) !== "sheet") return;
    const attrs = ((n[ATTRS_KEY] as Record<string, string> | undefined) ?? {});
    const nameVal = attrs[`${ATTR_PREFIX}name`] ?? attrs["name"];
    if (nameVal === op.from) {
      setAttr(n, "name", op.to);
      updated = true;
      return false;
    }
  });
  if (!updated) throw new Error(`renameSheet: <sheet name="${op.from}"> not found in workbook.xml`);
  setXmlEntry(pkg, "xl/workbook.xml", serializeOoxml(tree).toString("utf8"));
  target.name = op.to;
  touched.push(`xl/workbook.xml#sheet[${op.from}]`);
  markWorkbookDirty();
  return { added: op.to.length, removed: op.from.length };
}

function applyAddNamedRange(
  pkg: DocxPackage,
  op: Extract<XlsxEditOp, { op: "addNamedRange" }>,
  touched: string[],
): { added: number; removed: number } {
  const workbookRaw = getXmlEntry(pkg, "xl/workbook.xml");
  if (!workbookRaw) throw new Error("addNamedRange: xl/workbook.xml missing");
  const tree = parseOoxml(workbookRaw);

  // Find or create <definedNames>
  let definedNamesNode: OoxmlNode | null = null;
  visitNodes(tree.nodes, (n) => {
    if (nodeTagName(n) !== "definedNames") return;
    definedNamesNode = n;
    return false;
  });
  if (!definedNamesNode) {
    // Insert after <sheets>
    const root = tree.nodes.find((n) => nodeTagName(n) === "workbook");
    if (!root) throw new Error("addNamedRange: <workbook> root not found");
    const rootChildren = (root as Record<string, unknown>)["workbook"] as OoxmlNode[];
    definedNamesNode = { "definedNames": [] } as OoxmlNode;
    const sheetsIdx = rootChildren.findIndex((c) => nodeTagName(c) === "sheets");
    if (sheetsIdx >= 0) rootChildren.splice(sheetsIdx + 1, 0, definedNamesNode);
    else rootChildren.push(definedNamesNode);
  }

  // Append <definedName name="..">refersTo</definedName>
  const dnChildren = (definedNamesNode as Record<string, unknown>)["definedNames"] as OoxmlNode[];
  const newDN: OoxmlNode = {
    "definedName": [{ [TEXT_KEY]: op.refersTo } as OoxmlNode],
  } as OoxmlNode;
  setAttr(newDN, "name", op.name);
  dnChildren.push(newDN);

  setXmlEntry(pkg, "xl/workbook.xml", serializeOoxml(tree).toString("utf8"));
  touched.push(`xl/workbook.xml#definedName[${op.name}]`);
  return { added: op.name.length + op.refersTo.length, removed: 0 };
}

function applyMergeCells(
  workbook: XlsxSemanticWorkbook,
  op: Extract<XlsxEditOp, { op: "mergeCells" }>,
  touched: string[],
  markDirty: (partPath: string) => void,
): { added: number; removed: number } {
  const sheet = findSheet(workbook, op.sheet);

  // Find <mergeCells> or create one
  let mergeCellsNode: OoxmlNode | null = null;
  visitNodes(sheet.tree.nodes, (n) => {
    if (nodeTagName(n) !== "mergeCells") return;
    mergeCellsNode = n;
    return false;
  });
  if (!mergeCellsNode) {
    // Insert after <sheetData>
    const worksheetNode = sheet.tree.nodes.find((n) => nodeTagName(n) === "worksheet");
    if (!worksheetNode) throw new Error("mergeCells: <worksheet> root not found");
    const wsChildren = (worksheetNode as Record<string, unknown>)["worksheet"] as OoxmlNode[];
    mergeCellsNode = { "mergeCells": [] } as OoxmlNode;
    setAttr(mergeCellsNode, "count", "0");
    const sheetDataIdx = wsChildren.findIndex((c) => nodeTagName(c) === "sheetData");
    if (sheetDataIdx >= 0) wsChildren.splice(sheetDataIdx + 1, 0, mergeCellsNode);
    else wsChildren.push(mergeCellsNode);
  }

  const mcChildren = (mergeCellsNode as Record<string, unknown>)["mergeCells"] as OoxmlNode[];
  const newMerge: OoxmlNode = { "mergeCell": [] } as OoxmlNode;
  setAttr(newMerge, "ref", op.range);
  mcChildren.push(newMerge);
  // Update count attribute
  setAttr(mergeCellsNode, "count", String(mcChildren.filter((c) => nodeTagName(c) === "mergeCell").length));

  touched.push(`${sheet.partPath}#merge[${op.range}]`);
  markDirty(sheet.partPath);
  return { added: op.range.length, removed: 0 };
}

// Satisfy unused-import warnings — `setAttrs` is referenced indirectly via
// the serializer helpers but keeping the import explicit documents intent.
void setAttrs;
