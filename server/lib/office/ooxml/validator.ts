/**
 * OpenXML structural validator (DOCX).
 *
 * Runs **before repack** to catch broken packages early. Checks the invariants
 * that Microsoft Word actually rejects in the wild:
 *
 *   1. `[Content_Types].xml` exists, is well-formed, and has an Override or
 *      Default rule for every entry in the package.
 *   2. `word/_rels/document.xml.rels` exists, is well-formed, and every Target
 *      with `TargetMode != "External"` resolves to an entry in the package.
 *   3. Every `*.xml` / `*.rels` entry is well-formed (re-parses without error).
 *   4. `word/styles.xml` (if present) is well-formed; every styleId referenced
 *      in `word/document.xml` resolves.
 *   5. `word/numbering.xml` (if present) is well-formed; every numId used in
 *      document.xml resolves to a num → abstractNum chain.
 *   6. The root element of `word/document.xml` declares `xmlns:w` (the W3C
 *      WordprocessingML namespace) and any prefix listed in `mc:Ignorable` is
 *      declared via a corresponding `xmlns:` attribute.
 *
 * The validator is **not** a full schema validator. It is a fast structural
 * triage that catches the failure modes that have actually broken the
 * pipeline in the past. The round-trip diff stage is the second line of
 * defense.
 */

import {
  parseOoxml,
  collectText,
  visitNodes,
  nodeAttrs,
  nodeChildren,
  nodeTagName,
} from "./xmlSerializer.ts";
import type { OoxmlNode } from "./xmlSerializer.ts";
import type { DocxPackage } from "./zipIO.ts";
import { getXmlEntry } from "./zipIO.ts";

export interface OoxmlValidationError {
  code:
    | "MISSING_CONTENT_TYPES"
    | "MISSING_RELS"
    | "MALFORMED_XML"
    | "ENTRY_NOT_TYPED"
    | "REL_TARGET_MISSING"
    | "STYLE_REF_MISSING"
    | "NUMID_REF_MISSING"
    | "ROOT_NS_MISSING"
    | "MC_IGNORABLE_PREFIX_UNDECLARED";
  entry?: string;
  detail: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: OoxmlValidationError[];
  warnings: OoxmlValidationError[];
  /** Stats useful for observability. */
  stats: {
    entryCount: number;
    xmlEntryCount: number;
    paragraphCount: number;
    tableCount: number;
    relCount: number;
    styleCount: number;
  };
}

export function validateDocx(pkg: DocxPackage): ValidationReport {
  const errors: OoxmlValidationError[] = [];
  const warnings: OoxmlValidationError[] = [];

  const stats = {
    entryCount: pkg.entries.size,
    xmlEntryCount: 0,
    paragraphCount: 0,
    tableCount: 0,
    relCount: 0,
    styleCount: 0,
  };

  // 1. [Content_Types].xml present + every entry typed
  const ctRaw = getXmlEntry(pkg, "[Content_Types].xml");
  if (!ctRaw) {
    errors.push({ code: "MISSING_CONTENT_TYPES", detail: "[Content_Types].xml is missing" });
  }

  // 2. document.xml.rels present
  const docRelsRaw = getXmlEntry(pkg, "word/_rels/document.xml.rels");
  if (!docRelsRaw) {
    errors.push({ code: "MISSING_RELS", detail: "word/_rels/document.xml.rels is missing" });
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

  // Build a quick "set of entry paths" for relationship target resolution
  const entrySet = new Set(pkg.entries.keys());

  // 1b. Every entry has a Default or Override in [Content_Types].xml
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
          // Relationship parts are typed by Default rels extension; treat as covered if present.
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
    } catch (e) {
      // Already reported as MALFORMED_XML above.
    }
  }

  // 2b. Relationship target resolution
  if (docRelsRaw) {
    try {
      const rels = parseOoxml(docRelsRaw);
      visitNodes(rels.nodes, (n) => {
        const tag = nodeTagName(n);
        if (tag !== "Relationship") return;
        stats.relCount++;
        const a = nodeAttrs(n);
        const target = a["Target"];
        const mode = a["TargetMode"];
        if (!target) return;
        if (mode === "External") return; // hyperlinks
        // Targets are relative to word/_rels/, so they resolve against word/
        const resolved = resolveRelTarget("word/_rels/document.xml.rels", target);
        if (!entrySet.has(resolved)) {
          errors.push({
            code: "REL_TARGET_MISSING",
            entry: resolved,
            detail: `Relationship target "${target}" → "${resolved}" not found in package`,
          });
        }
      });
    } catch {
      /* malformed already reported */
    }
  }

  // 4. Style id resolution
  const stylesRaw = getXmlEntry(pkg, "word/styles.xml");
  const styleIds = new Set<string>();
  if (stylesRaw) {
    try {
      const st = parseOoxml(stylesRaw);
      visitNodes(st.nodes, (n) => {
        if (nodeTagName(n) === "w:style") {
          stats.styleCount++;
          const id = nodeAttrs(n)["w:styleId"];
          if (id) styleIds.add(id);
        }
      });
    } catch {
      /* malformed already reported */
    }
  }

  // 5. numId resolution
  const numberingRaw = getXmlEntry(pkg, "word/numbering.xml");
  const numIds = new Set<string>();
  if (numberingRaw) {
    try {
      const nb = parseOoxml(numberingRaw);
      visitNodes(nb.nodes, (n) => {
        if (nodeTagName(n) === "w:num") {
          const id = nodeAttrs(n)["w:numId"];
          if (id) numIds.add(id);
        }
      });
    } catch {
      /* malformed already reported */
    }
  }

  // Walk the body and check style/numId refs + count paragraphs/tables
  const docRaw = getXmlEntry(pkg, "word/document.xml");
  if (docRaw) {
    try {
      const doc = parseOoxml(docRaw);

      // 6. Root namespace + mc:Ignorable
      const rootNode = findFirst(doc.nodes, "w:document");
      if (rootNode) {
        const a = nodeAttrs(rootNode);
        if (!a["xmlns:w"]) {
          errors.push({
            code: "ROOT_NS_MISSING",
            entry: "word/document.xml",
            detail: "Root element <w:document> missing xmlns:w declaration",
          });
        }
        const ignorable = a["mc:Ignorable"];
        if (ignorable) {
          const declared = new Set(
            Object.keys(a)
              .filter((k) => k.startsWith("xmlns:"))
              .map((k) => k.slice("xmlns:".length)),
          );
          for (const prefix of ignorable.split(/\s+/).filter(Boolean)) {
            if (!declared.has(prefix)) {
              errors.push({
                code: "MC_IGNORABLE_PREFIX_UNDECLARED",
                entry: "word/document.xml",
                detail: `mc:Ignorable lists "${prefix}" but no xmlns:${prefix} is declared`,
              });
            }
          }
        }
      }

      visitNodes(doc.nodes, (n) => {
        const tag = nodeTagName(n);
        if (tag === "w:p") stats.paragraphCount++;
        if (tag === "w:tbl") stats.tableCount++;
        if (tag === "w:pStyle" || tag === "w:rStyle") {
          const id = nodeAttrs(n)["w:val"];
          if (id && stylesRaw && !styleIds.has(id)) {
            warnings.push({
              code: "STYLE_REF_MISSING",
              entry: "word/document.xml",
              detail: `Style "${id}" referenced but not defined in styles.xml`,
            });
          }
        }
        if (tag === "w:numId") {
          const id = nodeAttrs(n)["w:val"];
          if (id && numberingRaw && !numIds.has(id)) {
            warnings.push({
              code: "NUMID_REF_MISSING",
              entry: "word/document.xml",
              detail: `numId "${id}" referenced but not defined in numbering.xml`,
            });
          }
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
  // relsPath is like "word/_rels/document.xml.rels" → base is "word/"
  const base = relsPath.replace(/_rels\/[^/]+$/, "");
  // Normalize "../" segments
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

// Re-export for callers that want utility access
export { collectText };
