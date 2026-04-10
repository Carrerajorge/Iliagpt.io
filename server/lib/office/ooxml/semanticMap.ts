/**
 * Semantic view over a parsed DOCX package.
 *
 * The semantic map is a "logical" projection of the OOXML tree that the
 * editor and tests can reason about without walking raw XML. It is built
 * lazily and is **not** authoritative — it points back at the original
 * OoxmlNode references so edits applied through the editor mutate the
 * underlying tree directly.
 */

import {
  parseOoxml,
  collectText,
  visitNodes,
  nodeAttrs,
  nodeChildren,
  nodeTagName,
} from "./xmlSerializer.ts";
import type { OoxmlNode, OoxmlTree } from "./xmlSerializer.ts";
import type { DocxPackage } from "./zipIO.ts";
import { getXmlEntry } from "./zipIO.ts";

export interface ParagraphInfo {
  index: number;
  styleId?: string;
  text: string;
  numId?: string;
  ilvl?: string;
  node: OoxmlNode;
}

export interface CellInfo {
  row: number;
  col: number;
  text: string;
  gridSpan?: number;
  vMerge?: "restart" | "continue";
  node: OoxmlNode;
}

export interface TableInfo {
  index: number;
  rows: number;
  cells: CellInfo[];
  mergedCellCount: number;
  node: OoxmlNode;
}

export interface ListInfo {
  numId: string;
  abstractNumId?: string;
  levels: string[]; // ilvl values that are referenced
}

export interface ImageInfo {
  relId: string;
  target: string;
  partPath: string;
}

export interface HyperlinkInfo {
  relId?: string;
  anchor?: string;
  url?: string;
  text: string;
}

export interface SemanticDocument {
  paragraphs: ParagraphInfo[];
  tables: TableInfo[];
  lists: ListInfo[];
  styleIds: string[];
  images: ImageInfo[];
  headers: string[]; // entry paths
  footers: string[]; // entry paths
  hyperlinks: HyperlinkInfo[];
  comments: { id: string; text: string }[];
  tracked: { kind: "ins" | "del"; author?: string; text: string }[];
  rootTree: OoxmlTree;
}

export function buildSemanticMap(pkg: DocxPackage): SemanticDocument {
  const docXml = getXmlEntry(pkg, "word/document.xml");
  if (!docXml) throw new Error("buildSemanticMap: word/document.xml missing");
  const doc = parseOoxml(docXml);

  const paragraphs: ParagraphInfo[] = [];
  const tables: TableInfo[] = [];
  const hyperlinks: HyperlinkInfo[] = [];
  const tracked: SemanticDocument["tracked"] = [];

  let pIndex = 0;
  let tIndex = 0;

  visitNodes(doc.nodes, (n) => {
    const tag = nodeTagName(n);
    if (tag === "w:p") {
      paragraphs.push(extractParagraph(n, pIndex++));
    } else if (tag === "w:tbl") {
      tables.push(extractTable(n, tIndex++));
    } else if (tag === "w:hyperlink") {
      hyperlinks.push(extractHyperlink(n));
    } else if (tag === "w:ins" || tag === "w:del") {
      tracked.push({
        kind: tag === "w:ins" ? "ins" : "del",
        author: nodeAttrs(n)["w:author"],
        text: collectText([n]),
      });
    }
  });

  const styleIds = collectStyleIds(pkg);
  const lists = collectLists(pkg);
  const images = collectImages(pkg);
  const headers: string[] = [];
  const footers: string[] = [];
  for (const path of pkg.entries.keys()) {
    if (/^word\/header\d+\.xml$/.test(path)) headers.push(path);
    if (/^word\/footer\d+\.xml$/.test(path)) footers.push(path);
  }
  const comments = collectComments(pkg);

  return {
    paragraphs,
    tables,
    lists,
    styleIds,
    images,
    headers,
    footers,
    hyperlinks,
    comments,
    tracked,
    rootTree: doc,
  };
}

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

function extractParagraph(p: OoxmlNode, index: number): ParagraphInfo {
  let styleId: string | undefined;
  let numId: string | undefined;
  let ilvl: string | undefined;

  for (const child of nodeChildren(p)) {
    if (nodeTagName(child) !== "w:pPr") continue;
    for (const ppChild of nodeChildren(child)) {
      const t = nodeTagName(ppChild);
      if (t === "w:pStyle") styleId = nodeAttrs(ppChild)["w:val"];
      if (t === "w:numPr") {
        for (const npChild of nodeChildren(ppChild)) {
          const nt = nodeTagName(npChild);
          if (nt === "w:numId") numId = nodeAttrs(npChild)["w:val"];
          if (nt === "w:ilvl") ilvl = nodeAttrs(npChild)["w:val"];
        }
      }
    }
  }

  return {
    index,
    styleId,
    text: collectText([p]),
    numId,
    ilvl,
    node: p,
  };
}

function extractTable(tbl: OoxmlNode, index: number): TableInfo {
  const cells: CellInfo[] = [];
  let rowIdx = 0;
  let mergedCount = 0;
  for (const row of nodeChildren(tbl)) {
    if (nodeTagName(row) !== "w:tr") continue;
    let colIdx = 0;
    for (const cell of nodeChildren(row)) {
      if (nodeTagName(cell) !== "w:tc") continue;
      let gridSpan: number | undefined;
      let vMerge: "restart" | "continue" | undefined;
      for (const c of nodeChildren(cell)) {
        if (nodeTagName(c) !== "w:tcPr") continue;
        for (const tp of nodeChildren(c)) {
          const tt = nodeTagName(tp);
          if (tt === "w:gridSpan") {
            const v = nodeAttrs(tp)["w:val"];
            if (v) gridSpan = parseInt(v, 10);
          }
          if (tt === "w:vMerge") {
            const v = nodeAttrs(tp)["w:val"];
            vMerge = v === "restart" ? "restart" : "continue";
          }
        }
      }
      if (gridSpan !== undefined && gridSpan > 1) mergedCount++;
      if (vMerge !== undefined) mergedCount++;
      cells.push({
        row: rowIdx,
        col: colIdx,
        text: collectText([cell]),
        gridSpan,
        vMerge,
        node: cell,
      });
      colIdx += gridSpan ?? 1;
    }
    rowIdx++;
  }
  return {
    index,
    rows: rowIdx,
    cells,
    mergedCellCount: mergedCount,
    node: tbl,
  };
}

function extractHyperlink(h: OoxmlNode): HyperlinkInfo {
  const a = nodeAttrs(h);
  return {
    relId: a["r:id"],
    anchor: a["w:anchor"],
    url: a["w:tgtFrame"],
    text: collectText([h]),
  };
}

function collectStyleIds(pkg: DocxPackage): string[] {
  const stylesXml = getXmlEntry(pkg, "word/styles.xml");
  if (!stylesXml) return [];
  const out: string[] = [];
  try {
    const t = parseOoxml(stylesXml);
    visitNodes(t.nodes, (n) => {
      if (nodeTagName(n) === "w:style") {
        const id = nodeAttrs(n)["w:styleId"];
        if (id) out.push(id);
      }
    });
  } catch {
    /* validator already complains */
  }
  return out;
}

function collectLists(pkg: DocxPackage): ListInfo[] {
  const numberingXml = getXmlEntry(pkg, "word/numbering.xml");
  if (!numberingXml) return [];
  const out: ListInfo[] = [];
  try {
    const t = parseOoxml(numberingXml);
    visitNodes(t.nodes, (n) => {
      if (nodeTagName(n) !== "w:num") return;
      const numId = nodeAttrs(n)["w:numId"];
      if (!numId) return;
      let abstractNumId: string | undefined;
      const levels: string[] = [];
      for (const child of nodeChildren(n)) {
        if (nodeTagName(child) === "w:abstractNumId") {
          abstractNumId = nodeAttrs(child)["w:val"];
        }
        if (nodeTagName(child) === "w:lvlOverride") {
          const ilvl = nodeAttrs(child)["w:ilvl"];
          if (ilvl) levels.push(ilvl);
        }
      }
      out.push({ numId, abstractNumId, levels });
    });
  } catch {
    /* validator already complains */
  }
  return out;
}

function collectImages(pkg: DocxPackage): ImageInfo[] {
  const docRels = getXmlEntry(pkg, "word/_rels/document.xml.rels");
  if (!docRels) return [];
  const out: ImageInfo[] = [];
  try {
    const t = parseOoxml(docRels);
    visitNodes(t.nodes, (n) => {
      if (nodeTagName(n) !== "Relationship") return;
      const a = nodeAttrs(n);
      const type = a["Type"] || "";
      if (!type.endsWith("/image")) return;
      const id = a["Id"] || "";
      const target = a["Target"] || "";
      const part = "word/" + target.replace(/^\/+/, "");
      out.push({ relId: id, target, partPath: part });
    });
  } catch {
    /* validator already complains */
  }
  return out;
}

function collectComments(pkg: DocxPackage): { id: string; text: string }[] {
  const cx = getXmlEntry(pkg, "word/comments.xml");
  if (!cx) return [];
  const out: { id: string; text: string }[] = [];
  try {
    const t = parseOoxml(cx);
    visitNodes(t.nodes, (n) => {
      if (nodeTagName(n) !== "w:comment") return;
      const id = nodeAttrs(n)["w:id"] || "";
      out.push({ id, text: collectText([n]) });
    });
  } catch {
    /* validator already complains */
  }
  return out;
}
