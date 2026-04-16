/**
 * OOXML structural validator for XLSX (SpreadsheetML).
 *
 * Runs before repack to catch broken packages. Checks the invariants that
 * Microsoft Excel actually rejects in the wild:
 *
 *   1. `[Content_Types].xml` exists, is well-formed, and has an Override or
 *      Default rule for every entry in the package.
 *   2. `xl/workbook.xml` + `xl/_rels/workbook.xml.rels` exist and every
 *      `<sheet>` in the workbook resolves to an actual worksheet part via
 *      the rel `Id`.
 *   3. Every `*.xml` / `*.rels` entry is well-formed (re-parses without error).
 *   4. `xl/sharedStrings.xml` (if present) is well-formed; its `count`/
 *      `uniqueCount` attributes are consistent with the number of <si>.
 *   5. `xl/styles.xml` (if present) is well-formed; style indices referenced
 *      by cells via `s="..."` resolve to an entry in `<cellXfs>`.
 *   6. The workbook root element declares the SpreadsheetML namespace
 *      (http://schemas.openxmlformats.org/spreadsheetml/2006/main).
 *
 * Produces the same ValidationReport shape as the DOCX validator so both
 * engines can share downstream code.
 */

import {
  parseOoxml,
  visitNodes,
  nodeAttrs,
  nodeChildren,
  nodeTagName,
} from "../ooxml/xmlSerializer.ts";
import type { OoxmlNode } from "../ooxml/xmlSerializer.ts";
import type { DocxPackage } from "../ooxml/zipIO.ts";
import { getXmlEntry } from "../ooxml/zipIO.ts";

export interface XlsxValidationError {
  code:
    | "MISSING_CONTENT_TYPES"
    | "MISSING_WORKBOOK"
    | "MISSING_WORKBOOK_RELS"
    | "MALFORMED_XML"
    | "ENTRY_NOT_TYPED"
    | "SHEET_TARGET_MISSING"
    | "SHEET_RELID_MISSING"
    | "STYLE_REF_MISSING"
    | "SHARED_STRINGS_COUNT_MISMATCH"
    | "ROOT_NS_MISSING";
  entry?: string;
  detail: string;
}

export interface XlsxValidationReport {
  valid: boolean;
  errors: XlsxValidationError[];
  warnings: XlsxValidationError[];
  stats: {
    entryCount: number;
    xmlEntryCount: number;
    sheetCount: number;
    cellCount: number;
    sharedStringsCount: number;
    styleCount: number;
    mergedCellCount: number;
    namedRangeCount: number;
  };
}

const SML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

export function validateXlsx(pkg: DocxPackage): XlsxValidationReport {
  const errors: XlsxValidationError[] = [];
  const warnings: XlsxValidationError[] = [];
  const stats = {
    entryCount: pkg.entries.size,
    xmlEntryCount: 0,
    sheetCount: 0,
    cellCount: 0,
    sharedStringsCount: 0,
    styleCount: 0,
    mergedCellCount: 0,
    namedRangeCount: 0,
  };

  // 1. [Content_Types].xml present + every entry typed
  const ctRaw = getXmlEntry(pkg, "[Content_Types].xml");
  if (!ctRaw) {
    errors.push({ code: "MISSING_CONTENT_TYPES", detail: "[Content_Types].xml is missing" });
  }

  // 2. workbook.xml + rels
  const workbookRaw = getXmlEntry(pkg, "xl/workbook.xml");
  if (!workbookRaw) {
    errors.push({ code: "MISSING_WORKBOOK", detail: "xl/workbook.xml is missing" });
  }
  const workbookRelsRaw = getXmlEntry(pkg, "xl/_rels/workbook.xml.rels");
  if (!workbookRelsRaw) {
    errors.push({
      code: "MISSING_WORKBOOK_RELS",
      detail: "xl/_rels/workbook.xml.rels is missing",
    });
  }

  // 3. Well-formedness of every XML entry
  for (const [path, entry] of pkg.entries.entries()) {
    if (!entry.isXml) continue;
    stats.xmlEntryCount++;
    try {
      parseOoxml(entry.content as string);
    } catch (e) {
      errors.push({
        code: "MALFORMED_XML",
        entry: path,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Content_Types coverage
  if (ctRaw) {
    try {
      const ct = parseOoxml(ctRaw);
      const defaults = new Set<string>();
      const overrides = new Set<string>();
      visitNodes(ct.nodes, (n) => {
        const tag = nodeTagName(n);
        if (tag?.endsWith("Default")) {
          const ext = nodeAttrs(n)["Extension"];
          if (ext) defaults.add(ext.toLowerCase());
        } else if (tag?.endsWith("Override")) {
          const part = nodeAttrs(n)["PartName"];
          if (part) overrides.add(part);
        }
      });
      for (const path of pkg.entries.keys()) {
        if (path === "[Content_Types].xml") continue;
        if (path.startsWith("_rels/") || path.endsWith("/.rels") || path.endsWith(".rels")) {
          if (defaults.has("rels")) continue;
        }
        const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
        const partName = "/" + path;
        if (overrides.has(partName)) continue;
        if (ext && defaults.has(ext)) continue;
        warnings.push({
          code: "ENTRY_NOT_TYPED",
          entry: path,
          detail: `No Default or Override in [Content_Types].xml for ${path}`,
        });
      }
    } catch {
      /* malformed already reported */
    }
  }

  // 2b. Sheet resolution: every <sheet> in workbook.xml must have a rel target
  //     AND that target must exist in the package.
  const sheetPaths: string[] = [];
  if (workbookRaw && workbookRelsRaw) {
    try {
      const wb = parseOoxml(workbookRaw);
      const rels = parseOoxml(workbookRelsRaw);

      // Root namespace check
      const root = findFirst(wb.nodes, "workbook");
      if (root) {
        const rootAttrs = nodeAttrs(root);
        if (rootAttrs["xmlns"] !== SML_NS) {
          errors.push({
            code: "ROOT_NS_MISSING",
            entry: "xl/workbook.xml",
            detail: `Root <workbook> namespace expected ${SML_NS}, got ${rootAttrs["xmlns"] || "(none)"}`,
          });
        }
      }

      // Build rel id → target map
      const relTargets = new Map<string, string>();
      visitNodes(rels.nodes, (n) => {
        if (nodeTagName(n) !== "Relationship") return;
        const a = nodeAttrs(n);
        const id = a["Id"];
        const target = a["Target"];
        if (id && target) relTargets.set(id, target);
      });

      // For each <sheet> — resolve its r:id → target → entry path
      visitNodes(wb.nodes, (n) => {
        if (nodeTagName(n) !== "sheet") return;
        stats.sheetCount++;
        const a = nodeAttrs(n);
        const rId = a["r:id"] ?? a["r:Id"];
        if (!rId) {
          errors.push({
            code: "SHEET_RELID_MISSING",
            entry: "xl/workbook.xml",
            detail: `<sheet name="${a["name"] || "?"}"/> has no r:id`,
          });
          return;
        }
        const target = relTargets.get(rId);
        if (!target) {
          errors.push({
            code: "SHEET_TARGET_MISSING",
            entry: "xl/workbook.xml",
            detail: `<sheet> r:id="${rId}" does not resolve in workbook.xml.rels`,
          });
          return;
        }
        const resolved = resolveRelTarget("xl/_rels/workbook.xml.rels", target);
        if (!pkg.entries.has(resolved)) {
          errors.push({
            code: "SHEET_TARGET_MISSING",
            entry: resolved,
            detail: `<sheet> r:id="${rId}" → "${resolved}" not in package`,
          });
          return;
        }
        sheetPaths.push(resolved);
      });

      // Named ranges (workbook-level <definedNames>)
      visitNodes(wb.nodes, (n) => {
        if (nodeTagName(n) === "definedName") stats.namedRangeCount++;
      });
    } catch {
      /* malformed already reported */
    }
  }

  // 4. sharedStrings count check
  const sstRaw = getXmlEntry(pkg, "xl/sharedStrings.xml");
  if (sstRaw) {
    try {
      const sst = parseOoxml(sstRaw);
      const root = findFirst(sst.nodes, "sst");
      let countAttr = 0;
      if (root) {
        const a = nodeAttrs(root);
        if (a["uniqueCount"]) countAttr = parseInt(a["uniqueCount"], 10);
      }
      let siCount = 0;
      visitNodes(sst.nodes, (n) => {
        if (nodeTagName(n) === "si") siCount++;
      });
      stats.sharedStringsCount = siCount;
      if (countAttr > 0 && countAttr !== siCount) {
        warnings.push({
          code: "SHARED_STRINGS_COUNT_MISMATCH",
          entry: "xl/sharedStrings.xml",
          detail: `uniqueCount=${countAttr} but ${siCount} <si> elements found`,
        });
      }
    } catch {
      /* malformed already reported */
    }
  }

  // 5. Styles: cellXfs count + referenced style indices
  const stylesRaw = getXmlEntry(pkg, "xl/styles.xml");
  let cellXfsCount = 0;
  if (stylesRaw) {
    try {
      const st = parseOoxml(stylesRaw);
      visitNodes(st.nodes, (n) => {
        if (nodeTagName(n) !== "cellXfs") return;
        for (const c of nodeChildren(n)) if (nodeTagName(c) === "xf") cellXfsCount++;
      });
      stats.styleCount = cellXfsCount;
    } catch {
      /* malformed already reported */
    }
  }

  // Walk every sheet to count cells, merges, and validate style refs.
  for (const sheetPath of sheetPaths) {
    const raw = getXmlEntry(pkg, sheetPath);
    if (!raw) continue;
    try {
      const tree = parseOoxml(raw);
      visitNodes(tree.nodes, (n) => {
        const tag = nodeTagName(n);
        if (tag === "c") {
          stats.cellCount++;
          const a = nodeAttrs(n);
          const s = a["s"];
          if (s !== undefined && cellXfsCount > 0) {
            const idx = parseInt(s, 10);
            if (Number.isFinite(idx) && idx >= cellXfsCount) {
              warnings.push({
                code: "STYLE_REF_MISSING",
                entry: sheetPath,
                detail: `Cell ${a["r"] || "?"} references style index ${idx}, cellXfs has only ${cellXfsCount}`,
              });
            }
          }
        } else if (tag === "mergeCell") {
          stats.mergedCellCount++;
        }
      });
    } catch {
      /* malformed already reported */
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveRelTarget(relsPath: string, target: string): string {
  // "xl/_rels/workbook.xml.rels" → base is "xl/"
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
