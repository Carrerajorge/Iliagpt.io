/**
 * Round-trip diff between an "original" and a "repacked" DOCX package.
 *
 * Two passes:
 *
 *   1. **Byte-level**: for each non-XML zip entry, compare the raw Buffer.
 *      Non-XML entries (images, fonts, etc.) MUST be byte-identical because
 *      we don't touch them. Differences here are fatal.
 *
 *   2. **Canonical XML**: for each XML entry, re-parse both sides with the
 *      same fixed config and walk the trees in parallel. Differences are
 *      logged with their structural path. The caller can pass an "intended
 *      changes" allowlist of touched node paths from the edit stage; matches
 *      against the allowlist are downgraded to warnings.
 *
 * The diff is run inside the worker thread (CPU-only, no FS).
 */

import {
  parseOoxml,
  nodeTagName,
  nodeAttrs,
  nodeChildren,
  collectText,
  ATTRS_KEY,
} from "./xmlSerializer.ts";
import type { OoxmlNode } from "./xmlSerializer.ts";
import type { DocxPackage } from "./zipIO.ts";
import { unpackDocx } from "./zipIO.ts";

export interface ByteDiff {
  path: string;
  originalSize: number;
  repackedSize: number;
  firstDiffOffset: number;
}

export interface XmlDiff {
  entry: string;
  jsonPath: string;
  kind: "tag" | "attr" | "text" | "missing" | "extra";
  before?: string;
  after?: string;
}

export interface DiffReport {
  byteDiffs: ByteDiff[];
  xmlDiffs: XmlDiff[];
  cleanEntries: number;
  diffedEntries: number;
  fatal: boolean;
}

export interface RoundTripDiffOptions {
  /** Touched node path patterns from the edit stage. Diffs that match are demoted to warnings. */
  allowlist?: string[];
}

export async function roundTripDiff(
  original: DocxPackage,
  repackedBuf: Buffer,
  opts: RoundTripDiffOptions = {},
): Promise<DiffReport> {
  const repacked = await unpackDocx(repackedBuf);
  const byteDiffs: ByteDiff[] = [];
  const xmlDiffs: XmlDiff[] = [];
  let cleanEntries = 0;
  let diffedEntries = 0;
  let fatal = false;

  const allEntries = new Set<string>([...original.entries.keys(), ...repacked.entries.keys()]);

  for (const path of allEntries) {
    const a = original.entries.get(path);
    const b = repacked.entries.get(path);
    if (!a) {
      xmlDiffs.push({ entry: path, jsonPath: "/", kind: "extra", after: "(new entry)" });
      diffedEntries++;
      continue;
    }
    if (!b) {
      xmlDiffs.push({ entry: path, jsonPath: "/", kind: "missing", before: "(deleted entry)" });
      diffedEntries++;
      continue;
    }
    if (a.isXml !== b.isXml) {
      xmlDiffs.push({
        entry: path,
        jsonPath: "/",
        kind: "tag",
        before: a.isXml ? "xml" : "binary",
        after: b.isXml ? "xml" : "binary",
      });
      diffedEntries++;
      continue;
    }

    if (!a.isXml) {
      // Byte-level diff for binary entries (images, fonts).
      const ba = a.content as Buffer;
      const bb = b.content as Buffer;
      const diff = compareBuffers(ba, bb);
      if (diff !== -1) {
        byteDiffs.push({
          path,
          originalSize: ba.length,
          repackedSize: bb.length,
          firstDiffOffset: diff,
        });
        diffedEntries++;
        // [Content_Types].xml is XML so it can't fall here, but any other binary
        // diff is fatal because we never modify binaries.
        fatal = true;
      } else {
        cleanEntries++;
      }
      continue;
    }

    // Canonical XML diff
    const ta = parseOoxml(a.content as string);
    const tb = parseOoxml(b.content as string);
    const diffs = diffNodes(ta.nodes, tb.nodes, "");
    if (diffs.length > 0) {
      diffedEntries++;
      for (const d of diffs) {
        const annotated: XmlDiff = { ...d, entry: path };
        xmlDiffs.push(annotated);
        // Fatal if [Content_Types].xml has any unintended diff
        if (path === "[Content_Types].xml" && !inAllowlist(annotated, opts.allowlist)) {
          fatal = true;
        }
      }
    } else {
      cleanEntries++;
    }
  }

  return {
    byteDiffs,
    xmlDiffs,
    cleanEntries,
    diffedEntries,
    fatal,
  };
}

function compareBuffers(a: Buffer, b: Buffer): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  if (a.length !== b.length) return len;
  return -1;
}

function inAllowlist(diff: XmlDiff, allowlist?: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return false;
  return allowlist.some((pat) => diff.jsonPath.includes(pat));
}

// ---------------------------------------------------------------------------
// Tree diff
// ---------------------------------------------------------------------------

function diffNodes(a: OoxmlNode[], b: OoxmlNode[], path: string): Omit<XmlDiff, "entry">[] {
  const out: Omit<XmlDiff, "entry">[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const na = a[i];
    const nb = b[i];
    if (!na) {
      out.push({ jsonPath: `${path}[${i}]`, kind: "extra", after: nodeSummary(nb) });
      continue;
    }
    if (!nb) {
      out.push({ jsonPath: `${path}[${i}]`, kind: "missing", before: nodeSummary(na) });
      continue;
    }
    const ta = nodeTagName(na);
    const tb = nodeTagName(nb);
    if (ta !== tb) {
      out.push({
        jsonPath: `${path}[${i}]`,
        kind: "tag",
        before: ta ?? "(text)",
        after: tb ?? "(text)",
      });
      continue;
    }
    if (!ta && !tb) {
      // Both are text/special nodes (e.g. #text)
      const sa = collectText([na]);
      const sb = collectText([nb]);
      if (sa !== sb) {
        out.push({ jsonPath: `${path}[${i}]/#text`, kind: "text", before: sa, after: sb });
      }
      continue;
    }
    // Both have the same tag. Compare attributes.
    const aa = nodeAttrs(na);
    const ab = nodeAttrs(nb);
    const aks = new Set([...Object.keys(aa), ...Object.keys(ab)]);
    for (const k of aks) {
      if (aa[k] !== ab[k]) {
        out.push({
          jsonPath: `${path}/${ta}[${i}]@${k}`,
          kind: "attr",
          before: aa[k],
          after: ab[k],
        });
      }
    }
    // Recurse into children
    out.push(...diffNodes(nodeChildren(na), nodeChildren(nb), `${path}/${ta}[${i}]`));
  }
  return out;
}

function nodeSummary(n: OoxmlNode | undefined): string {
  if (!n) return "(undefined)";
  const t = nodeTagName(n);
  if (!t) return "(text)";
  const attrCount = Object.keys(nodeAttrs(n)).length;
  return `<${t} attrs=${attrCount}>`;
}

// Re-export ATTRS_KEY for callers
export { ATTRS_KEY };
