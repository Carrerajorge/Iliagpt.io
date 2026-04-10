/**
 * Semantic view over a parsed XLSX package.
 *
 * Projects the OOXML SpreadsheetML tree into a workbook model that the
 * editor and tests can reason about without walking raw XML. Resolves
 * shared strings (cell type "s" → index into sst.xml → actual text),
 * A1 addresses, merges, named ranges, tables, and part paths.
 *
 * The returned SemanticWorkbook holds references back to the original
 * OoxmlNode for every cell, so edits applied through the editor mutate
 * the underlying sheet tree directly.
 */

import {
  parseOoxml,
  visitNodes,
  nodeAttrs,
  nodeChildren,
  nodeTagName,
  collectText,
} from "../ooxml/xmlSerializer.ts";
import type { OoxmlNode, OoxmlTree } from "../ooxml/xmlSerializer.ts";
import type { DocxPackage } from "../ooxml/zipIO.ts";
import { getXmlEntry } from "../ooxml/zipIO.ts";
import type {
  XlsxCellInfo,
  XlsxMergeInfo,
  XlsxSheetInfo,
  XlsxSemanticWorkbook,
  XlsxNamedRange,
  XlsxTableInfo,
} from "./xlsxTypes.ts";

export function buildXlsxSemanticMap(pkg: DocxPackage): XlsxSemanticWorkbook {
  const workbookRaw = getXmlEntry(pkg, "xl/workbook.xml");
  if (!workbookRaw) {
    throw new Error("buildXlsxSemanticMap: xl/workbook.xml missing");
  }
  const workbookRelsRaw = getXmlEntry(pkg, "xl/_rels/workbook.xml.rels");
  if (!workbookRelsRaw) {
    throw new Error("buildXlsxSemanticMap: xl/_rels/workbook.xml.rels missing");
  }

  const workbookTree = parseOoxml(workbookRaw);
  const workbookRels = parseOoxml(workbookRelsRaw);

  // Resolve rId → target path
  const relTargets = new Map<string, string>();
  visitNodes(workbookRels.nodes, (n) => {
    if (nodeTagName(n) !== "Relationship") return;
    const a = nodeAttrs(n);
    const id = a["Id"];
    const target = a["Target"];
    if (id && target) relTargets.set(id, target);
  });

  // Load shared strings table (may be absent if the workbook uses only inline strings)
  const sharedStrings = loadSharedStrings(pkg);

  // Walk <sheet> definitions from workbook.xml
  const sheets: XlsxSheetInfo[] = [];
  const referencedStyleIds = new Set<number>();
  visitNodes(workbookTree.nodes, (n) => {
    if (nodeTagName(n) !== "sheet") return;
    const a = nodeAttrs(n);
    const name = a["name"] ?? "";
    const rId = a["r:id"] ?? a["r:Id"];
    if (!name || !rId) return;
    const target = relTargets.get(rId);
    if (!target) return;
    const partPath = resolveRelTarget("xl/_rels/workbook.xml.rels", target);
    const sheetRaw = getXmlEntry(pkg, partPath);
    if (!sheetRaw) return;
    const tree = parseOoxml(sheetRaw);
    const { cells, rowCount, maxCol, merges } = extractSheet(tree, sharedStrings, referencedStyleIds);
    sheets.push({
      name,
      rId,
      partPath,
      tree,
      cells,
      rowCount,
      maxCol,
      merges,
    });
  });

  // Named ranges (workbook scope)
  const namedRanges: XlsxNamedRange[] = [];
  visitNodes(workbookTree.nodes, (n) => {
    if (nodeTagName(n) !== "definedName") return;
    const a = nodeAttrs(n);
    const name = a["name"];
    if (!name) return;
    const refersTo = collectText([n]);
    const scopeAttr = a["localSheetId"];
    namedRanges.push({
      name,
      refersTo,
      scope: scopeAttr !== undefined ? parseInt(scopeAttr, 10) : undefined,
    });
  });

  // Tables (xl/tables/*.xml)
  const tables: XlsxTableInfo[] = [];
  for (const [path, entry] of pkg.entries.entries()) {
    if (!path.startsWith("xl/tables/") || !path.endsWith(".xml")) continue;
    if (!entry.isXml) continue;
    try {
      const t = parseOoxml(entry.content as string);
      const tableNode = findFirst(t.nodes, "table");
      if (!tableNode) continue;
      const a = nodeAttrs(tableNode);
      const id = a["id"] ?? "";
      const name = a["name"] ?? "";
      const displayName = a["displayName"] ?? name;
      const ref = a["ref"] ?? "";
      const headers: string[] = [];
      visitNodes([tableNode], (n) => {
        if (nodeTagName(n) !== "tableColumn") return;
        const ca = nodeAttrs(n);
        if (ca["name"]) headers.push(ca["name"]);
      });
      tables.push({ id, name, displayName, ref, partPath: path, headers });
    } catch {
      /* malformed already handled by validator */
    }
  }

  // Charts + drawings + comments part enumeration
  const charts: string[] = [];
  const drawings: string[] = [];
  const comments: string[] = [];
  for (const path of pkg.entries.keys()) {
    if (/^xl\/charts\/chart\d+\.xml$/.test(path)) charts.push(path);
    if (/^xl\/drawings\/drawing\d+\.xml$/.test(path)) drawings.push(path);
    if (/^xl\/comments\d+\.xml$/.test(path)) comments.push(path);
  }

  // Hyperlinks: scan every sheet rels file for a "hyperlink" relationship type
  let hyperlinkCount = 0;
  for (const [path, entry] of pkg.entries.entries()) {
    if (!/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(path)) continue;
    if (!entry.isXml) continue;
    try {
      const t = parseOoxml(entry.content as string);
      visitNodes(t.nodes, (n) => {
        if (nodeTagName(n) !== "Relationship") return;
        const type = nodeAttrs(n)["Type"] ?? "";
        if (type.endsWith("/hyperlink")) hyperlinkCount++;
      });
    } catch {
      /* ignore */
    }
  }

  return {
    sheets,
    namedRanges,
    tables,
    referencedStyleIds,
    charts,
    drawings,
    hyperlinkCount,
    comments,
  };
}

// ---------------------------------------------------------------------------
// Sheet extraction
// ---------------------------------------------------------------------------

function extractSheet(
  tree: OoxmlTree,
  sharedStrings: string[],
  referencedStyleIds: Set<number>,
): { cells: XlsxCellInfo[]; rowCount: number; maxCol: number; merges: XlsxMergeInfo[] } {
  const cells: XlsxCellInfo[] = [];
  const merges: XlsxMergeInfo[] = [];
  let rowCount = 0;
  let maxCol = 0;

  visitNodes(tree.nodes, (n) => {
    const tag = nodeTagName(n);
    if (tag === "row") {
      rowCount++;
    } else if (tag === "c") {
      const a = nodeAttrs(n);
      const address = a["r"] ?? "";
      if (!address) return;
      const { col, row } = parseAddress(address);
      if (col > maxCol) maxCol = col;
      const cellType = a["t"] ?? "n";
      const styleAttr = a["s"];
      const styleIndex = styleAttr !== undefined ? parseInt(styleAttr, 10) : undefined;
      if (styleIndex !== undefined && Number.isFinite(styleIndex)) {
        referencedStyleIds.add(styleIndex);
      }

      // <v> child holds the value
      let rawValue = "";
      let formula: string | undefined;
      for (const child of nodeChildren(n)) {
        const ct = nodeTagName(child);
        if (ct === "v") rawValue = collectText([child]);
        else if (ct === "f") formula = collectText([child]);
        else if (ct === "is") {
          // inline string: <c t="inlineStr"><is><t>...</t></is></c>
          rawValue = collectText([child]);
        }
      }

      // Resolve shared strings
      let resolvedValue = rawValue;
      if (cellType === "s") {
        const idx = parseInt(rawValue, 10);
        if (Number.isFinite(idx) && idx >= 0 && idx < sharedStrings.length) {
          resolvedValue = sharedStrings[idx];
        }
      }

      cells.push({
        address,
        col,
        row,
        type: cellType,
        value: resolvedValue,
        formula,
        styleIndex,
        node: n,
      });
    } else if (tag === "mergeCell") {
      const a = nodeAttrs(n);
      const range = a["ref"];
      if (!range) return;
      const [start, end] = range.split(":");
      if (!start || !end) return;
      const s = parseAddress(start);
      const e = parseAddress(end);
      merges.push({
        range,
        startCol: s.col,
        startRow: s.row,
        endCol: e.col,
        endRow: e.row,
      });
    }
  });

  return { cells, rowCount, maxCol, merges };
}

function loadSharedStrings(pkg: DocxPackage): string[] {
  const raw = getXmlEntry(pkg, "xl/sharedStrings.xml");
  if (!raw) return [];
  const out: string[] = [];
  try {
    const tree = parseOoxml(raw);
    visitNodes(tree.nodes, (n) => {
      if (nodeTagName(n) !== "si") return;
      // A shared string item can be a plain <t> or a run-rich <r><t>...</t></r>.
      out.push(collectText([n]));
    });
  } catch {
    /* ignore */
  }
  return out;
}

// ---------------------------------------------------------------------------
// A1 address parsing
// ---------------------------------------------------------------------------

/** Convert an A1 address to { col, row } with 1-based indices. */
export function parseAddress(address: string): { col: number; row: number } {
  const m = address.match(/^([A-Z]+)(\d+)$/);
  if (!m) return { col: 0, row: 0 };
  const letters = m[1];
  const rowNum = parseInt(m[2], 10);
  let col = 0;
  for (const ch of letters) {
    col = col * 26 + (ch.charCodeAt(0) - "A".charCodeAt(0) + 1);
  }
  return { col, row: rowNum };
}

/** Convert a 1-based { col, row } to an A1 address. */
export function toAddress(col: number, row: number): string {
  let c = col;
  let letters = "";
  while (c > 0) {
    const rem = (c - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    c = Math.floor((c - 1) / 26);
  }
  return letters + row;
}

function findFirst(nodes: OoxmlNode[], tagName: string): OoxmlNode | null {
  for (const n of nodes) {
    if (nodeTagName(n) === tagName) return n;
    const children = nodeChildren(n);
    if (children.length > 0) {
      const r = findFirst(children, tagName);
      if (r) return r;
    }
  }
  return null;
}

function resolveRelTarget(relsPath: string, target: string): string {
  const base = relsPath.replace(/_rels\/[^/]+$/, "");
  const parts = (base + target).split("/").filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}
