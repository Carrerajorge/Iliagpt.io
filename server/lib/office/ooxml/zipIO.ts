/**
 * DOCX zip unpack / repack with deterministic, byte-stable output.
 *
 * A `.docx` file is a ZIP archive containing OOXML parts. We need to:
 *   - Preserve the **original entry order**, so a round-trip diff can compare
 *     against the source byte-for-byte where the content didn't change.
 *   - Use a **fixed timestamp** for every entry on repack so the output is
 *     reproducible across runs (otherwise the central directory differs).
 *   - Treat XML and binary entries differently: XML entries are stored as
 *     UTF-8 strings (the higher layers parse + re-emit them), binary entries
 *     (images, fonts) are stored as Buffers and never modified.
 *
 * Compression: DEFLATE level 6, matching what Word produces. We do not try to
 * reproduce Word's specific deflate stream byte-for-byte (different deflater
 * implementations vary); the round-trip diff therefore compares the **content
 * of each entry** after decompression, not the raw zip bytes.
 */

import JSZip from "jszip";

export interface DocxEntry {
  /** Path inside the zip, e.g. `word/document.xml`. */
  path: string;
  /** XML entries are stored as UTF-8 strings; binary entries as Buffers. */
  content: Buffer | string;
  /** True if the entry is text/XML, false for binary. */
  isXml: boolean;
}

export interface DocxPackage {
  /** Insertion-ordered map keyed by entry path. */
  entries: Map<string, DocxEntry>;
  /** Original zip entry order (used by the round-trip diff to compare in source order). */
  originalOrder: string[];
}

const XML_EXTENSIONS = new Set([".xml", ".rels"]);
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

function isXmlPath(filename: string): boolean {
  // Office stores some files without an extension (e.g. `[Content_Types].xml` always has it).
  // We rely on extension only — if Office ever uses extensionless XML it will be misclassified
  // and stored as a Buffer, which still round-trips correctly.
  const lower = filename.toLowerCase();
  for (const ext of XML_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Unpack
// ---------------------------------------------------------------------------

export async function unpackDocx(buf: Buffer): Promise<DocxPackage> {
  const zip = await JSZip.loadAsync(buf);
  const entries = new Map<string, DocxEntry>();
  const originalOrder: string[] = [];

  // JSZip preserves insertion order for the `files` property, which matches
  // the central directory order from the source archive.
  const paths = Object.keys(zip.files);
  for (const p of paths) {
    const file = zip.files[p];
    if (file.dir) continue;
    const isXml = isXmlPath(p);
    const content: Buffer | string = isXml
      ? await file.async("string")
      : Buffer.from(await file.async("nodebuffer"));
    entries.set(p, { path: p, content, isXml });
    originalOrder.push(p);
  }

  return { entries, originalOrder };
}

// ---------------------------------------------------------------------------
// Repack
// ---------------------------------------------------------------------------

export async function repackDocx(pkg: DocxPackage): Promise<Buffer> {
  const zip = new JSZip();

  // Re-add entries in the original order so that any newly-added entries (if
  // ever supported) are appended at the end without disturbing existing ones.
  const seen = new Set<string>();
  for (const p of pkg.originalOrder) {
    const e = pkg.entries.get(p);
    if (!e) continue; // entry was deleted by an editor stage
    addEntry(zip, e);
    seen.add(p);
  }
  // Append any new entries inserted out-of-order by editors.
  for (const [p, e] of pkg.entries.entries()) {
    if (!seen.has(p)) addEntry(zip, e);
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
  });
}

function addEntry(zip: JSZip, e: DocxEntry): void {
  const data = e.isXml && typeof e.content === "string" ? e.content : (e.content as Buffer);
  zip.file(e.path, data, {
    binary: !e.isXml,
    date: FIXED_DATE,
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getXmlEntry(pkg: DocxPackage, path: string): string | null {
  const e = pkg.entries.get(path);
  if (!e || !e.isXml || typeof e.content !== "string") return null;
  return e.content;
}

export function setXmlEntry(pkg: DocxPackage, path: string, xml: string): void {
  const existing = pkg.entries.get(path);
  if (existing) {
    existing.content = xml;
    existing.isXml = true;
  } else {
    pkg.entries.set(path, { path, content: xml, isXml: true });
  }
}

export function getBinaryEntry(pkg: DocxPackage, path: string): Buffer | null {
  const e = pkg.entries.get(path);
  if (!e || e.isXml) return null;
  return e.content as Buffer;
}

export function clonePackage(pkg: DocxPackage): DocxPackage {
  const entries = new Map<string, DocxEntry>();
  for (const [p, e] of pkg.entries.entries()) {
    entries.set(p, {
      path: e.path,
      content: typeof e.content === "string" ? e.content : Buffer.from(e.content),
      isXml: e.isXml,
    });
  }
  return { entries, originalOrder: [...pkg.originalOrder] };
}
