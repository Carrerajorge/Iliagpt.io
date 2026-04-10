/**
 * Template detector for DOCX packages.
 *
 * Scans `word/document.xml` and every header/footer part for the presence
 * of Docxtemplater-style `{{placeholder}}` markers. The detector is
 * text-based (not structural) because Docxtemplater itself tolerates
 * placeholders that span multiple `<w:r>` runs — we just need to know
 * whether the template intent is viable at all.
 *
 * Returned metadata:
 *   - hasPlaceholders: true if at least one `{{...}}` marker exists
 *   - placeholders: deduped list of marker names (without braces)
 *   - multiRun: true if any marker spans text that Word might have split
 *               across runs (informational — Docxtemplater handles this)
 *
 * Consumed by `stages/index.ts:planStage()` to auto-route to the
 * Docxtemplater ladder rung when an input looks like a template, even
 * if the user's objective doesn't explicitly mention "fill placeholder".
 */

import type { DocxPackage } from "./zipIO.ts";
import { getXmlEntry } from "./zipIO.ts";

export interface TemplateDetectionResult {
  hasPlaceholders: boolean;
  placeholders: string[];
  multiRun: boolean;
  /** Exact parts that contained at least one placeholder (for observability). */
  partsWithPlaceholders: string[];
}

/**
 * Strip `<w:...>` tags from an XML string so placeholders that Word has
 * split into multiple runs become detectable as contiguous `{{name}}`
 * text. This mirrors what Docxtemplater does internally before matching.
 */
function stripXmlTags(xml: string): string {
  return xml.replace(/<[^>]+>/g, "");
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.\- :]+?)\s*\}\}/g;

export function detectDocxTemplate(pkg: DocxPackage): TemplateDetectionResult {
  const parts: string[] = ["word/document.xml"];
  // Headers + footers can also carry template markers (e.g. {{client_name}}).
  for (const path of pkg.entries.keys()) {
    if (/^word\/header\d+\.xml$/.test(path)) parts.push(path);
    if (/^word\/footer\d+\.xml$/.test(path)) parts.push(path);
  }

  const found = new Set<string>();
  const partsWithPlaceholders: string[] = [];
  let multiRun = false;

  for (const part of parts) {
    const raw = getXmlEntry(pkg, part);
    if (!raw) continue;

    // First, try matching on the raw XML — catches placeholders that Word
    // kept inside a single <w:t>.
    const rawMatches = [...raw.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);

    // Then, try matching on the text-only view — catches placeholders that
    // got split across <w:r>/<w:t> runs.
    const stripped = stripXmlTags(raw);
    const strippedMatches = [...stripped.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);

    if (strippedMatches.length > rawMatches.length) multiRun = true;

    const combined = strippedMatches.length > 0 ? strippedMatches : rawMatches;
    if (combined.length > 0) {
      partsWithPlaceholders.push(part);
      for (const name of combined) found.add(name);
    }
  }

  return {
    hasPlaceholders: found.size > 0,
    placeholders: [...found].sort(),
    multiRun,
    partsWithPlaceholders,
  };
}
