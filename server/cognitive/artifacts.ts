/**
 * Cognitive Middleware — artifact extraction (Turn H).
 *
 * The middleware emits `CognitiveResponse.text` — a flat string —
 * today. UIs that want to render code blocks, tables, diagrams, or
 * downloadable documents have to re-parse that string with regex
 * on the client, which is fragile + duplicates work across every
 * consumer.
 *
 * Turn H makes artifacts first-class: the middleware parses the
 * response text ONCE, produces a typed `CognitiveArtifact[]` array,
 * and attaches it to `CognitiveResponse`. Every consumer (web UI,
 * Electron desktop, terminal client, extension) reads the same
 * typed shapes.
 *
 * Detection strategy:
 *
 *   1. **Fenced code blocks** (```lang ... ```) → CodeArtifact
 *      with detected language. Deliberately narrow — only fenced
 *      blocks count. Inline backticks are NOT artifacts because
 *      they're usually variable names, not code to render.
 *
 *   2. **Mermaid blocks** (```mermaid ... ```) → DiagramArtifact
 *      with the raw Mermaid source. A special case of fenced
 *      code but extracted as a dedicated type so renderers can
 *      dispatch correctly.
 *
 *   3. **Markdown tables** (| col | col | + separator line) →
 *      TableArtifact with parsed headers + rows. The parser is
 *      forgiving: it accepts any header row whose next line is
 *      a separator with `---`, and it stops at the first line
 *      that doesn't start with `|`.
 *
 *   4. **Document-shaped responses** — detection is conservative.
 *      A response with at least N headings (`# `, `## `) AND
 *      more than M characters becomes a MarkdownArtifact so UIs
 *      can render it in a "document" panel instead of chat bubble.
 *
 * Design principles:
 *
 *   • **Deterministic.** Same text in → same artifacts out. No
 *     LLM-based detection, no fuzzy matching. Tests pin exact
 *     outputs for pinned inputs.
 *
 *   • **Never throws.** Parse failures become empty arrays, not
 *     exceptions. The middleware calls this helper inline in the
 *     happy path — a parse bug must NEVER break a request.
 *
 *   • **Stable ids.** Every artifact gets a deterministic id
 *     derived from its kind + its position in the source text
 *     (`code:0`, `table:1`, etc.) so consumers that cache
 *     artifacts across turns can diff them.
 *
 *   • **Zero dependencies.** No markdown-it, no remark. Pure
 *     string splitting + regex because the input shape is narrow
 *     and we want the extraction to be obvious to review.
 */

// ---------------------------------------------------------------------------
// Shape contracts
// ---------------------------------------------------------------------------

/**
 * Discriminated union of artifact kinds the middleware extracts.
 * Consumers `switch` on `kind` and dispatch to their renderer.
 *
 * Adding a new kind requires updating the union, the extractor,
 * the tests, and any consumer's exhaustiveness check. Renaming a
 * kind is a breaking change — existing shapes are frozen.
 */
export type CognitiveArtifact =
  | CodeArtifact
  | DiagramArtifact
  | TableArtifact
  | MarkdownArtifact;

interface ArtifactBase {
  /**
   * Stable id of the form `${kind}:${index}` where `index` is the
   * artifact's 0-based position in the emission order of its kind.
   * Consumers can use this as a React key or a cache key.
   */
  id: string;
  /**
   * Start offset (character index) of this artifact in the
   * original response text. Useful for highlighting or
   * rendering inline.
   */
  offset: number;
  /** Length of the artifact's source span in characters. */
  length: number;
}

export interface CodeArtifact extends ArtifactBase {
  kind: "code";
  /**
   * Lowercase language tag (e.g., "ts", "python", "bash"). Empty
   * string when the fence had no language. Not normalized — the
   * extractor preserves whatever the model wrote.
   */
  language: string;
  /** Raw source code (without the fences). */
  source: string;
}

export interface DiagramArtifact extends ArtifactBase {
  kind: "diagram";
  /** Always "mermaid" today. Future kinds (graphviz, plantuml) can be added. */
  format: "mermaid";
  /** Raw diagram source. */
  source: string;
}

export interface TableArtifact extends ArtifactBase {
  kind: "table";
  /** Header row cells, trimmed. */
  headers: string[];
  /** Body rows — each row is an array of cell strings. */
  rows: string[][];
}

export interface MarkdownArtifact extends ArtifactBase {
  kind: "markdown";
  /**
   * The full markdown source (same as the response text when the
   * whole response qualifies as a document). Separate from the
   * text field so consumers can route it to a document panel.
   */
  source: string;
  /** Number of top-level headings detected (for routing heuristics). */
  headingCount: number;
}

// ---------------------------------------------------------------------------
// Extraction entry point
// ---------------------------------------------------------------------------

/**
 * Parse the response text and return every artifact found, in
 * the order they appear. Never throws.
 *
 * Order of operations:
 *   1. Extract fenced code blocks (mermaid goes to diagrams,
 *      everything else to code).
 *   2. Extract markdown tables.
 *   3. Classify the whole response as a markdown document if it
 *      has enough headings + length to qualify.
 *
 * The returned array is ordered by the kind detection priority
 * above (code → diagram → table → markdown), NOT by document
 * position. If a single response contains a code block AND a
 * table, code comes first. Consumers that want document-order
 * should sort by `offset`.
 */
export function extractArtifacts(text: string): CognitiveArtifact[] {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }
  try {
    const artifacts: CognitiveArtifact[] = [];

    // Code + diagrams come from fenced blocks.
    const fenced = extractFencedBlocks(text);
    let codeIdx = 0;
    let diagramIdx = 0;
    for (const block of fenced) {
      if (block.language === "mermaid") {
        artifacts.push({
          id: `diagram:${diagramIdx++}`,
          kind: "diagram",
          format: "mermaid",
          source: block.source,
          offset: block.offset,
          length: block.length,
        });
      } else {
        artifacts.push({
          id: `code:${codeIdx++}`,
          kind: "code",
          language: block.language,
          source: block.source,
          offset: block.offset,
          length: block.length,
        });
      }
    }

    // Markdown tables.
    const tables = extractMarkdownTables(text);
    let tableIdx = 0;
    for (const t of tables) {
      artifacts.push({
        id: `table:${tableIdx++}`,
        kind: "table",
        headers: t.headers,
        rows: t.rows,
        offset: t.offset,
        length: t.length,
      });
    }

    // Document-shaped response as a single MarkdownArtifact.
    const markdownDoc = classifyMarkdownDocument(text);
    if (markdownDoc) {
      artifacts.push(markdownDoc);
    }

    return artifacts;
  } catch {
    // Parser bug — never propagate.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fenced code blocks
// ---------------------------------------------------------------------------

interface RawFencedBlock {
  language: string;
  source: string;
  offset: number;
  length: number;
}

/**
 * Walk the text and pull out every fenced code block. A fence is
 * either ``` or ~~~ repeated AT LEAST 3 times at the start of a
 * line (we only accept ``` for simplicity). An opening fence may
 * have a language tag on the same line; the block runs until a
 * matching closing fence.
 *
 * Limits:
 *   • We don't support indented fences (4+ space indent = code
 *     block in markdown). Rare in model output, adds complexity.
 *   • We don't support nested fences. If a model emits ```md then
 *     ``` then ``` the first closing fence wins.
 *   • We accept an unclosed final fence: in that case the block
 *     runs to end-of-text so the user still sees their code.
 */
function extractFencedBlocks(text: string): RawFencedBlock[] {
  const out: RawFencedBlock[] = [];
  // Match: start-of-line or start-of-text, three+ backticks,
  // optional language, newline, anything non-greedy, closing fence.
  // Using multiline + dotAll so `.` matches newlines.
  const fenceRe = /(^|\n)```([a-zA-Z0-9_+-]*)\n([\s\S]*?)(?:\n```|$)/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    const prefix = match[1]; // "" or "\n"
    const language = (match[2] ?? "").toLowerCase();
    const source = match[3] ?? "";
    // The offset is the position of the opening ``` in the
    // original string. `match.index` points at the prefix; add
    // the prefix length to skip it.
    const offset = match.index + prefix.length;
    out.push({
      language,
      source,
      offset,
      length: match[0].length - prefix.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown tables
// ---------------------------------------------------------------------------

interface RawTable {
  headers: string[];
  rows: string[][];
  offset: number;
  length: number;
}

/**
 * Pull markdown tables out of the text. A table is:
 *
 *     | col1 | col2 | col3 |
 *     | ---- | ---- | ---- |
 *     | a    | b    | c    |
 *     | d    | e    | f    |
 *
 * The parser looks for a line starting with `|` followed by a
 * separator line whose cells all contain `---`, then collects
 * body rows until the first non-`|` line. Cells are trimmed.
 *
 * Tables nested inside code blocks are skipped — we mask out
 * fenced-block regions before scanning so a table in a markdown
 * code example doesn't false-positive.
 */
function extractMarkdownTables(text: string): RawTable[] {
  const masked = maskFencedBlocks(text);
  const lines = masked.split("\n");
  // Precompute line offsets so we can report table position in
  // the ORIGINAL text.
  const lineStarts: number[] = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    lineStarts.push(lineStarts[i] + lines[i].length + 1); // +1 for "\n"
  }

  const out: RawTable[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const headerLine = lines[i];
    const sepLine = lines[i + 1];
    if (!isTablePipeLine(headerLine)) continue;
    if (!isTableSeparatorLine(sepLine)) continue;

    const headers = splitTableRow(headerLine);
    if (headers.length === 0) continue;

    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length && isTablePipeLine(lines[j])) {
      const cells = splitTableRow(lines[j]);
      // Pad or trim to header width so rows are rectangular.
      while (cells.length < headers.length) cells.push("");
      if (cells.length > headers.length) cells.length = headers.length;
      rows.push(cells);
      j++;
    }

    if (rows.length > 0) {
      const startOffset = lineStarts[i];
      const endOffset =
        j === lines.length
          ? masked.length
          : lineStarts[j];
      out.push({
        headers,
        rows,
        offset: startOffset,
        length: endOffset - startOffset,
      });
      i = j - 1; // skip past the consumed rows
    }
  }
  return out;
}

/** Replace characters inside fenced code blocks with spaces so pipe
 * characters inside code don't confuse the table scanner. Preserves
 * offsets so positions still map to the original text. */
function maskFencedBlocks(text: string): string {
  const chars = text.split("");
  const fenceRe = /(^|\n)```[a-zA-Z0-9_+-]*\n[\s\S]*?(?:\n```|$)/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    const startInMatch = (match[1] ?? "").length;
    const start = match.index + startInMatch;
    const end = match.index + match[0].length;
    for (let k = start; k < end; k++) {
      if (chars[k] !== "\n") chars[k] = " ";
    }
  }
  return chars.join("");
}

function isTablePipeLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.includes("|", 1);
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return false;
  const cells = splitTableRow(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

function splitTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  if (t.length === 0) return [];
  return t.split("|").map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// Document classification
// ---------------------------------------------------------------------------

const DOCUMENT_MIN_CHARS = 400;
const DOCUMENT_MIN_HEADINGS = 2;

/**
 * Classify the full text as a Markdown document when it has at
 * least `DOCUMENT_MIN_HEADINGS` top-level headings (`# ` or `## `)
 * AND is longer than `DOCUMENT_MIN_CHARS`. This heuristic is
 * deliberately conservative — we only want to surface a document
 * panel when the model clearly WROTE a document, not when a short
 * chat reply happens to use a `## ` heading.
 */
function classifyMarkdownDocument(text: string): MarkdownArtifact | null {
  if (text.length < DOCUMENT_MIN_CHARS) return null;
  const headingMatches = text.match(/^(#{1,3})\s+\S/gm);
  const headingCount = headingMatches ? headingMatches.length : 0;
  if (headingCount < DOCUMENT_MIN_HEADINGS) return null;
  return {
    id: "markdown:0",
    kind: "markdown",
    source: text,
    headingCount,
    offset: 0,
    length: text.length,
  };
}
