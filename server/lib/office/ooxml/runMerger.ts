/**
 * Multi-`w:r` text replacement.
 *
 * In Word, a contiguous text run can be split across multiple `<w:r>` elements
 * because of formatting changes, spell-check markers, language tags, etc.
 * Naive find/replace on each `<w:t>` misses matches that straddle a run
 * boundary. This module:
 *
 *   1. Walks every `<w:p>` and builds a virtual string from the concatenation
 *      of its `<w:r>/<w:t>` text content, recording the byte offset and
 *      run-index of each run.
 *   2. Locates substring matches in that virtual string.
 *   3. Rewrites the involved runs in place: the first matched run keeps its
 *      `<w:rPr>` and gets the replacement text; the remaining runs in the
 *      match window have their `<w:t>` content trimmed or emptied.
 *
 * The first matched run's run properties (`<w:rPr>`) are preserved so the
 * replacement inherits formatting from the start of the original phrase.
 */

import { TEXT_KEY, nodeTagName, nodeChildren, setAttr } from "./xmlSerializer.ts";
import type { OoxmlNode } from "./xmlSerializer.ts";

interface RunSlice {
  /** Index of the run within the paragraph. */
  runIndex: number;
  /** Reference to the `<w:r>` node. */
  runNode: OoxmlNode;
  /** Reference to the `<w:t>` text node inside that run. */
  textNode: OoxmlNode | null;
  /** Concatenated text contributed by this run. */
  text: string;
  /** Offset of this run's first character in the paragraph virtual string. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

export interface RunMatch {
  /** The paragraph node. */
  paragraph: OoxmlNode;
  /** All run slices in source order. */
  slices: RunSlice[];
  /** Index of the match start within the virtual string. */
  matchStart: number;
  /** Exclusive end of the match in the virtual string. */
  matchEnd: number;
  /** The needle that was matched. */
  needle: string;
}

function paragraphRuns(p: OoxmlNode): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const child of nodeChildren(p)) {
    if (nodeTagName(child) === "w:r") out.push(child);
  }
  return out;
}

function runText(r: OoxmlNode): { textNode: OoxmlNode | null; text: string } {
  // Look for the first <w:t> inside the run.
  for (const child of nodeChildren(r)) {
    if (nodeTagName(child) !== "w:t") continue;
    const grand = nodeChildren(child);
    let text = "";
    for (const g of grand) {
      const t = (g as Record<string, unknown>)[TEXT_KEY];
      if (typeof t === "string") text += t;
    }
    return { textNode: child, text };
  }
  return { textNode: null, text: "" };
}

function buildParagraphSlices(p: OoxmlNode): { slices: RunSlice[]; virtual: string } {
  const slices: RunSlice[] = [];
  let cursor = 0;
  let virtual = "";
  const runs = paragraphRuns(p);
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const { textNode, text } = runText(r);
    const start = cursor;
    const end = cursor + text.length;
    slices.push({ runIndex: i, runNode: r, textNode, text, start, end });
    virtual += text;
    cursor = end;
  }
  return { slices, virtual };
}

/** Find every occurrence of `needle` across the runs of every paragraph. */
export function findTextAcrossRuns(body: OoxmlNode, needle: string): RunMatch[] {
  if (!needle) return [];
  const matches: RunMatch[] = [];
  const visit = (node: OoxmlNode) => {
    const tag = nodeTagName(node);
    if (tag === "w:p") {
      const { slices, virtual } = buildParagraphSlices(node);
      let from = 0;
      while (true) {
        const idx = virtual.indexOf(needle, from);
        if (idx === -1) break;
        matches.push({
          paragraph: node,
          slices,
          matchStart: idx,
          matchEnd: idx + needle.length,
          needle,
        });
        from = idx + needle.length;
      }
      return;
    }
    for (const child of nodeChildren(node)) visit(child);
  };
  visit(body);
  return matches;
}

/**
 * Replace a single match in place. Mutates the run nodes inside the paragraph.
 *
 * Strategy:
 *   - First run that overlaps the match: keep `<w:rPr>`, replace its text with
 *     [prefix outside match] + replacement + [empty/trim of any trailing
 *     content that falls outside the match within this run].
 *   - Intermediate runs fully inside the match: empty their `<w:t>`.
 *   - Last run that overlaps but extends past the match: trim its leading
 *     portion that's inside the match, keep the rest.
 */
export function replaceAcrossRuns(match: RunMatch, replacement: string): { added: number; removed: number } {
  const { slices, matchStart, matchEnd } = match;
  const involved = slices.filter((s) => s.end > matchStart && s.start < matchEnd);
  if (involved.length === 0) return { added: 0, removed: 0 };

  let removedChars = 0;
  let addedChars = 0;

  for (let i = 0; i < involved.length; i++) {
    const slice = involved[i];
    const t = slice.textNode;
    if (!t) continue;
    const localStart = Math.max(0, matchStart - slice.start);
    const localEnd = Math.min(slice.text.length, matchEnd - slice.start);

    let newText: string;
    if (i === 0) {
      const prefix = slice.text.slice(0, localStart);
      const suffix = involved.length === 1 ? slice.text.slice(localEnd) : "";
      newText = prefix + replacement + suffix;
      addedChars += replacement.length;
      removedChars += localEnd - localStart;
      if (involved.length === 1 && localEnd < slice.text.length) {
        // suffix already added back
      }
    } else if (i === involved.length - 1) {
      newText = slice.text.slice(localEnd);
      removedChars += localEnd;
    } else {
      newText = "";
      removedChars += slice.text.length;
    }

    setRunText(t, newText);
    slice.text = newText;
  }

  return { added: addedChars, removed: removedChars };
}

function setRunText(textNode: OoxmlNode, text: string): void {
  // Replace all child text fragments with a single #text child.
  // If the text has leading/trailing whitespace, force xml:space="preserve".
  const tag = nodeTagName(textNode);
  if (!tag) return;
  (textNode as Record<string, unknown>)[tag] = [{ [TEXT_KEY]: text } as OoxmlNode];
  if (/^\s|\s$/.test(text)) {
    setAttr(textNode, "xml:space", "preserve");
  }
}
