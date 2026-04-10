/**
 * Fallback ladder for OOXML editing.
 *
 *   Level 0 — high-level `docx` lib (`generateFreshDocx`). Only when the plan
 *             is "create from scratch": no input file, no edits, jumps
 *             straight to repack/validate.
 *   Level 1 — `docxtemplater` + `pizzip` over the whole package buffer. Used
 *             when the plan contains a `fillPlaceholder` op. On any template
 *             error, the ladder bumps to level 2.
 *   Level 2 — direct OOXML node edit via `editor.applyEdits`. The general
 *             case. On error, the run fails with the validator report.
 *
 * The ladder records which level actually executed on the EditResult so the
 * orchestrator can persist `fallback_level` on the run row.
 */

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { applyEdits } from "../ooxml/editor";
import { unpackDocx, repackDocx } from "../ooxml/zipIO";
import type { DocxPackage } from "../ooxml/zipIO";
import type { SemanticDocument } from "../ooxml/semanticMap";
import type { EditOp, EditResult, OfficeFallbackLevel } from "../types";
import { OfficeEngineError } from "../types";

export interface LadderInput {
  pkg: DocxPackage;
  sdoc: SemanticDocument;
  ops: EditOp[];
  /** Initial level suggested by the planner. The ladder may bump it up. */
  initialLevel: OfficeFallbackLevel;
  /** Set when level 0 is selected — provides the freshly-built buffer. */
  freshBufferProvider?: () => Promise<Buffer>;
}

export async function executeWithFallback(input: LadderInput): Promise<EditResult & { newPkg?: DocxPackage }> {
  let level = input.initialLevel;

  // Level 0 — create from spec
  if (level === 0 && input.freshBufferProvider) {
    try {
      const buf = await input.freshBufferProvider();
      const newPkg = await unpackDocx(buf);
      return {
        diff: { added: countDocChars(newPkg), removed: 0 },
        touchedNodePaths: ["w:body[fresh]"],
        level: 0,
        opResults: [{ op: "replaceText", ok: true }], // synthetic
        newPkg,
      };
    } catch (err) {
      // bump down to level 2 if creating fresh failed
      level = 2;
    }
  }

  // Level 1 — docxtemplater
  if (level === 1) {
    try {
      const placeholderOp = input.ops.find((o) => o.op === "fillPlaceholder");
      const data = (placeholderOp && "data" in placeholderOp ? placeholderOp.data : {}) as Record<string, unknown>;
      const buf = await repackDocx(input.pkg);
      const zip = new PizZip(buf);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        nullGetter: () => "",
      });
      doc.render(data);
      const out = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
      const newPkg = await unpackDocx(out);
      return {
        diff: { added: 0, removed: 0 }, // docxtemplater doesn't expose char counts
        touchedNodePaths: ["w:p[placeholder]"],
        level: 1,
        opResults: input.ops.map((o) => ({ op: o.op, ok: true })),
        newPkg,
      };
    } catch (err) {
      // bump to level 2
      level = 2;
    }
  }

  // Level 2 — direct OOXML node edit
  try {
    const result = applyEdits(input.pkg, input.ops);
    return { ...result, level: 2 };
  } catch (err) {
    throw new OfficeEngineError(
      "EDIT_FAILED",
      `Level 2 OOXML edit failed: ${err instanceof Error ? err.message : String(err)}`,
      { stage: "edit", cause: err },
    );
  }
}

function countDocChars(pkg: DocxPackage): number {
  const docXml = pkg.entries.get("word/document.xml");
  if (!docXml || typeof docXml.content !== "string") return 0;
  // Approximate "character count" by stripping tags.
  return docXml.content.replace(/<[^>]*>/g, "").length;
}
