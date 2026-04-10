/**
 * Namespace-safe OOXML parser / serializer.
 *
 * Wraps `fast-xml-parser` v5 (XMLParser + XMLBuilder) with a fixed configuration
 * chosen to round-trip Word / Excel / PowerPoint XML **without losing any
 * structure that Microsoft Word rejects or warns on**. Specifically:
 *
 *   - `xmlns:*` and `mc:Ignorable` declarations on the root element survive in
 *      their original source order. We capture that order via a light regex
 *      pre-pass on the raw buffer (rootAttrOrder) and re-apply it after build.
 *   - The XML declaration (`<?xml ... ?>`) is captured byte-for-byte from the
 *     prefix of the input and re-emitted verbatim on build.
 *   - Per-entry line endings (`\r\n` vs `\n`) are detected and re-applied.
 *   - `xml:space="preserve"` whitespace is preserved: we disable `trimValues`
 *     and `parseTagValue` so text content is never normalised.
 *   - Self-closing tags (`<w:b/>`) stay self-closing via `suppressEmptyNode: false`.
 *   - Attributes like `w:val="0054"` stay string-typed via `parseAttributeValue: false`.
 *   - Comments and CDATA survive via `commentPropName` / `cdataPropName`.
 *
 * The resulting tree type (`OoxmlTree`) is a plain JS array matching the
 * fast-xml-parser `preserveOrder: true` shape. It can be walked, cloned, and
 * mutated by the higher-level OOXML modules (semanticMap, editor, runMerger,
 * roundTripDiff).
 */

import { XMLParser, XMLBuilder } from "fast-xml-parser";

/**
 * fast-xml-parser v5 preserveOrder convention:
 *   Each node is `{ tagName: [children], ":@": { "@_attr": "value" } }`.
 *   Attribute keys are prefixed with `attributeNamePrefix` (we use `@_`).
 *   `attributesGroupName` is NOT compatible with preserveOrder mode — setting
 *   it produces a broken double-wrap that the builder cannot serialize.
 */
export const ATTRS_KEY = ":@" as const;
export const ATTR_PREFIX = "@_" as const;
export const TEXT_KEY = "#text" as const;
export const CDATA_KEY = "__cdata" as const;
export const COMMENT_KEY = "__comment" as const;

/** A single node in the preserveOrder tree: one tag key + optional ":@" attrs bag. */
export type OoxmlNode = { [tag: string]: OoxmlNode[] | string } & {
  [ATTRS_KEY]?: Record<string, string>; // prefixed bag (e.g. "@_xmlns:w")
};

export interface OoxmlTree {
  /** Parsed document as a flat array of top-level nodes (preserveOrder shape). */
  nodes: OoxmlNode[];
  /** Exact byte-prefix XML declaration (e.g. `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`). Empty string if absent. */
  xmlDeclaration: string;
  /** Line ending used by the source ("\r\n" or "\n"). */
  lineEnding: "\r\n" | "\n";
  /** Original attribute source order for the root element, captured from the raw buffer. */
  rootAttrOrder: string[];
  /** Raw root element name (first non-whitespace tag after the declaration). */
  rootName: string;
}

// ---------------------------------------------------------------------------
// Shared fast-xml-parser options
// ---------------------------------------------------------------------------

const COMMON_OPTIONS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  // NOTE: do NOT set `attributesGroupName` in preserveOrder mode (v5 bug).
  textNodeName: TEXT_KEY,
  cdataPropName: CDATA_KEY,
  commentPropName: COMMENT_KEY,
  suppressEmptyNode: false,
  suppressUnpairedNode: false,
  suppressBooleanAttributes: false,
  processEntities: true,
} as const;

const PARSER_OPTIONS = {
  ...COMMON_OPTIONS,
  trimValues: false, // keep xml:space="preserve" whitespace byte-exact
  parseTagValue: false, // "0054" must stay "0054", not become 54
  parseAttributeValue: false,
} as const;

const BUILDER_OPTIONS = {
  ...COMMON_OPTIONS,
  format: false,
} as const;

// ---------------------------------------------------------------------------
// Declaration / line ending capture
// ---------------------------------------------------------------------------

const DECL_RE = /^\s*<\?xml[^?]*\?>/;

function captureXmlDeclaration(text: string): { declaration: string; rest: string } {
  const m = text.match(DECL_RE);
  if (!m) return { declaration: "", rest: text };
  return { declaration: m[0], rest: text.slice(m[0].length) };
}

function detectLineEnding(text: string): "\r\n" | "\n" {
  const crlf = text.indexOf("\r\n");
  if (crlf !== -1 && crlf < 4096) return "\r\n";
  return "\n";
}

// ---------------------------------------------------------------------------
// Root attribute source-order capture
// ---------------------------------------------------------------------------

/**
 * Extract the attribute names declared on the first (root) element in source
 * order. fast-xml-parser v5 preserves JS object insertion order for the `:@`
 * bag, so in practice the output already matches. We do this defensive pass
 * to guarantee stability even if the parser implementation changes, and to
 * make the root-element serialization deterministic independent of JS engine.
 */
function captureRootAttrOrder(body: string): { name: string; attrs: string[] } {
  // Skip leading comments/whitespace and processing instructions.
  let i = 0;
  while (i < body.length) {
    // whitespace
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;
    // comment
    if (body.startsWith("<!--", i)) {
      const end = body.indexOf("-->", i + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }
    // doctype / pi
    if (body.startsWith("<!", i) || body.startsWith("<?", i)) {
      const end = body.indexOf(">", i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    // element opening tag
    if (body[i] === "<") break;
    i++;
  }

  if (i >= body.length || body[i] !== "<") {
    return { name: "", attrs: [] };
  }
  // Find the matching close of the opening tag.
  const end = findTagEnd(body, i);
  if (end === -1) return { name: "", attrs: [] };
  const tag = body.slice(i + 1, end);
  // name is up to first whitespace or self-close slash
  const nameMatch = tag.match(/^([A-Za-z_][\w.:-]*)/);
  if (!nameMatch) return { name: "", attrs: [] };
  const name = nameMatch[1];
  const afterName = tag.slice(name.length);
  const attrs = parseAttributeNames(afterName);
  return { name, attrs };
}

function findTagEnd(body: string, start: number): number {
  // Simple scan respecting quoted attribute values.
  let i = start + 1;
  let inSingle = false;
  let inDouble = false;
  while (i < body.length) {
    const c = body[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
    } else if (inDouble) {
      if (c === '"') inDouble = false;
    } else {
      if (c === "'") inSingle = true;
      else if (c === '"') inDouble = true;
      else if (c === ">") return i;
    }
    i++;
  }
  return -1;
}

function parseAttributeNames(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length || s[i] === "/" || s[i] === ">") break;
    const m = s.slice(i).match(/^([A-Za-z_][\w.:-]*)\s*=\s*/);
    if (!m) break;
    out.push(m[1]);
    i += m[0].length;
    // skip quoted value
    if (i < s.length && (s[i] === '"' || s[i] === "'")) {
      const quote = s[i];
      i++;
      while (i < s.length && s[i] !== quote) i++;
      if (i < s.length) i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseOoxml(buf: Buffer | string): OoxmlTree {
  const text = typeof buf === "string" ? buf : buf.toString("utf8");
  const lineEnding = detectLineEnding(text);
  const { declaration, rest } = captureXmlDeclaration(text);
  const { name, attrs } = captureRootAttrOrder(rest);

  const parser = new XMLParser(PARSER_OPTIONS);
  const nodes = parser.parse(rest) as OoxmlNode[];

  return {
    nodes,
    xmlDeclaration: declaration,
    lineEnding,
    rootAttrOrder: attrs,
    rootName: name,
  };
}

export function serializeOoxml(tree: OoxmlTree): Buffer {
  const builder = new XMLBuilder(BUILDER_OPTIONS);
  let body = builder.build(tree.nodes) as string;

  // Enforce root element attribute source order if we captured one.
  if (tree.rootName && tree.rootAttrOrder.length > 0) {
    body = reorderRootAttributes(body, tree.rootName, tree.rootAttrOrder);
  }

  // Normalise line endings to the original style.
  const normalized =
    tree.lineEnding === "\r\n"
      ? body.replace(/\r?\n/g, "\r\n")
      : body.replace(/\r\n/g, "\n");

  // Prepend the captured declaration (if any).
  let final: string;
  if (tree.xmlDeclaration) {
    const sep = tree.lineEnding;
    final = tree.xmlDeclaration + sep + normalized.replace(/^\s*/, "");
  } else {
    final = normalized;
  }

  return Buffer.from(final, "utf8");
}

/** Rewrite the attribute order of the first opening tag matching rootName. */
function reorderRootAttributes(body: string, rootName: string, desiredOrder: string[]): string {
  const openRe = new RegExp(
    `<${escapeRegex(rootName)}((?:\\s+[^>]+?)?)(\\s*/?)>`,
    "",
  );
  return body.replace(openRe, (_m, attrsText: string, tail: string) => {
    const attrs = parseAttributesKeyValue(attrsText);
    if (attrs.length === 0) return `<${rootName}${tail}>`;
    // Sort so the keys in desiredOrder come first (in that exact order),
    // any extras keep their original relative order at the tail.
    const byKey = new Map(attrs.map((a) => [a.name, a]));
    const ordered: Array<{ name: string; raw: string }> = [];
    for (const name of desiredOrder) {
      const hit = byKey.get(name);
      if (hit) {
        ordered.push(hit);
        byKey.delete(name);
      }
    }
    for (const leftover of byKey.values()) ordered.push(leftover);
    const joined = ordered.map((a) => a.raw).join(" ");
    return `<${rootName} ${joined}${tail}>`;
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseAttributesKeyValue(s: string): Array<{ name: string; raw: string }> {
  const out: Array<{ name: string; raw: string }> = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const m = s.slice(i).match(/^([A-Za-z_][\w.:-]*)\s*=\s*(['"])/);
    if (!m) break;
    const name = m[1];
    const quote = m[2];
    const start = i;
    i += m[0].length;
    const endQuote = s.indexOf(quote, i);
    if (endQuote === -1) break;
    i = endQuote + 1;
    out.push({ name, raw: s.slice(start, i) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tree traversal helpers (used by semanticMap, editor, roundTripDiff)
// ---------------------------------------------------------------------------

/** Return the single tag name of a node (excluding ":@"), or null if it's a text/special node. */
export function nodeTagName(node: OoxmlNode): string | null {
  for (const key of Object.keys(node)) {
    if (key === ATTRS_KEY) continue;
    return key;
  }
  return null;
}

/** Get the children array of a node (for a tag node). Returns [] if none. */
export function nodeChildren(node: OoxmlNode): OoxmlNode[] {
  const tag = nodeTagName(node);
  if (!tag) return [];
  const v = node[tag];
  return Array.isArray(v) ? (v as OoxmlNode[]) : [];
}

/**
 * Get the attributes map of a node as a STRIPPED view (no `@_` prefix).
 *
 * The returned object is a fresh copy — mutations are NOT reflected back into
 * the underlying tree. To write attributes use `setAttr(node, name, value)`.
 */
export function nodeAttrs(node: OoxmlNode): Record<string, string> {
  const raw = node[ATTRS_KEY] as Record<string, string> | undefined;
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const k of Object.keys(raw)) {
    const stripped = k.startsWith(ATTR_PREFIX) ? k.slice(ATTR_PREFIX.length) : k;
    out[stripped] = raw[k];
  }
  return out;
}

/** Read a single attribute by its unprefixed name. */
export function getAttr(node: OoxmlNode, name: string): string | undefined {
  const raw = node[ATTRS_KEY] as Record<string, string> | undefined;
  if (!raw) return undefined;
  return raw[ATTR_PREFIX + name] ?? raw[name];
}

/** Set a single attribute (writes to the prefixed bag). Creates the bag if absent. */
export function setAttr(node: OoxmlNode, name: string, value: string): void {
  const raw = (node[ATTRS_KEY] as Record<string, string> | undefined) ?? {};
  raw[ATTR_PREFIX + name] = value;
  (node as Record<string, unknown>)[ATTRS_KEY] = raw;
}

/** Replace the entire attribute bag with the given unprefixed map. */
export function setAttrs(node: OoxmlNode, attrs: Record<string, string>): void {
  const bag: Record<string, string> = {};
  for (const k of Object.keys(attrs)) bag[ATTR_PREFIX + k] = attrs[k];
  (node as Record<string, unknown>)[ATTRS_KEY] = bag;
}

/** Collect all descendant text content of a node as a single string. */
export function collectText(nodes: OoxmlNode[]): string {
  let out = "";
  const visit = (n: OoxmlNode) => {
    for (const key of Object.keys(n)) {
      if (key === ATTRS_KEY) continue;
      const v = n[key];
      if (key === TEXT_KEY && typeof v === "string") {
        out += v;
      } else if (Array.isArray(v)) {
        for (const child of v) visit(child as OoxmlNode);
      }
    }
  };
  for (const n of nodes) visit(n);
  return out;
}

/** Depth-first visit. Stops if visitor returns `false`. */
export function visitNodes(
  nodes: OoxmlNode[],
  visitor: (node: OoxmlNode, parent: OoxmlNode[] | null, index: number) => void | false,
  parent: OoxmlNode[] | null = null,
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const res = visitor(node, parent, i);
    if (res === false) return;
    const tag = nodeTagName(node);
    if (tag) {
      const children = node[tag];
      if (Array.isArray(children)) {
        visitNodes(children as OoxmlNode[], visitor, children as OoxmlNode[]);
      }
    }
  }
}

/** Structural clone — safe because the tree is JSON-compatible. */
export function cloneTree(tree: OoxmlTree): OoxmlTree {
  return {
    nodes: structuredClone(tree.nodes),
    xmlDeclaration: tree.xmlDeclaration,
    lineEnding: tree.lineEnding,
    rootAttrOrder: [...tree.rootAttrOrder],
    rootName: tree.rootName,
  };
}
