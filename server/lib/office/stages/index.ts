/**
 * Office Engine pipeline stages.
 *
 * Each exported function is one stage of the pipeline. They are intentionally
 * thin: most logic lives in `../ooxml/*` (pure functions, runs in workers
 * via `../workerClient.ts`) and the orchestrator (`../engine/OfficeEngine.ts`).
 *
 * Each stage:
 *   1. Starts a `StepStreamer` step (so the UI sees it immediately).
 *   2. Performs the work (often by dispatching to the worker pool).
 *   3. Completes or fails the step with diff/output metadata.
 *   4. Returns a typed result for the orchestrator.
 *
 * The 10 stages here are co-located in one file for the slice. They were
 * originally planned as separate files; consolidation keeps the call graph
 * legible without changing the interface (the orchestrator imports each by
 * named export).
 */

import { createHash } from "node:crypto";
import { workerUnpackDocx, workerValidateDocx, workerRepackDocx, workerRoundTripDiff } from "../workerClient";
import { buildSemanticMap } from "../ooxml/semanticMap";
import type { SemanticDocument } from "../ooxml/semanticMap";
import type { DocxPackage } from "../ooxml/zipIO";
import type { ValidationReport } from "../ooxml/validator";
import type { DiffReport } from "../ooxml/roundTripDiff";
import type { OfficeRunContext, EditOp, EditResult, OfficeFallbackLevel } from "../types";
import { OfficeEngineError } from "../types";

// ---------------------------------------------------------------------------
// Plan stage
// ---------------------------------------------------------------------------

export interface Plan {
  ops: EditOp[];
  level: OfficeFallbackLevel;
  rationale: string;
}

const REPLACE_RE = /(?:replace|reemplaz[ao]r?)\s+["']?(.+?)["']?\s+(?:with|por|con)\s+["']?(.+?)["']?$/i;
const PLACEHOLDER_RE = /\b(fill|rellenar|completar)\s+(placeholders?|plantilla|template)/i;
const CREATE_RE = /\b(create|crea[r]?|generate|generar)\s+(?:un\s+|a\s+)?(?:documento|document|docx|word)/i;

/**
 * Deterministic rule-based planner. Maps the natural-language objective onto
 * a list of EditOps and an initial fallback level. LLM-driven planning is
 * out of scope for this slice.
 */
export function planStage(ctx: OfficeRunContext): Plan {
  const step = ctx.streamer.start("thinking", "Planificando edición DOCX", { description: ctx.objective });

  let plan: Plan;
  const obj = ctx.objective.trim();

  const replaceMatch = obj.match(REPLACE_RE);
  if (replaceMatch) {
    const find = replaceMatch[1];
    const replace = replaceMatch[2];
    plan = {
      ops: [{ op: "replaceText", find, replace, all: /\ball\b|todas?/i.test(obj) }],
      level: 2,
      rationale: `text replacement: "${find}" → "${replace}"`,
    };
  } else if (PLACEHOLDER_RE.test(obj)) {
    plan = {
      ops: [{ op: "fillPlaceholder", data: {} }],
      level: 1,
      rationale: "placeholder template fill",
    };
  } else if (CREATE_RE.test(obj)) {
    plan = {
      ops: [],
      level: 0,
      rationale: "create document from spec",
    };
  } else {
    // Catch-all: no recognized edit intent. Run the pipeline as a "no-op
    // round-trip" — unpack/parse/validate/repack without applying any
    // EditOps. This still proves the document is well-formed and produces
    // a valid exported artifact. Avoids the brittle "replaceText not found"
    // failure mode of an arbitrary objective string.
    plan = {
      ops: [],
      level: 2,
      rationale: "no-op round-trip (no recognized edit intent)",
    };
  }

  ctx.streamer.complete(step, { output: plan.rationale });
  return plan;
}

// ---------------------------------------------------------------------------
// Unpack
// ---------------------------------------------------------------------------

export async function unpackStage(ctx: OfficeRunContext, inputBuf: Buffer): Promise<DocxPackage> {
  const step = ctx.streamer.start("reading", "Descomprimiendo DOCX");
  try {
    const pkg = await workerUnpackDocx(inputBuf, { signal: ctx.signal });
    ctx.streamer.complete(step, {
      output: `${pkg.entries.size} entries, ${pkg.originalOrder.length} in source order`,
    });
    return pkg;
  } catch (err) {
    ctx.streamer.fail(step, err instanceof Error ? err.message : String(err));
    throw new OfficeEngineError("UNPACK_FAILED", err instanceof Error ? err.message : String(err), { stage: "unpack", cause: err });
  }
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export interface ParseResult {
  xmlEntryCount: number;
  paragraphHint: number;
}

export async function parseStage(ctx: OfficeRunContext, pkg: DocxPackage): Promise<ParseResult> {
  const step = ctx.streamer.start("analyzing", "Parseando OOXML");
  try {
    let xmlCount = 0;
    let pHint = 0;
    for (const e of pkg.entries.values()) {
      if (!e.isXml) continue;
      xmlCount++;
      // Quick paragraph counter without doing a full parse — used as observability hint.
      const s = e.content as string;
      if (e.path === "word/document.xml") {
        pHint = (s.match(/<w:p[\s>]/g) || []).length;
      }
    }
    ctx.streamer.complete(step, { output: `${xmlCount} XML entries (~${pHint} paragraphs in body)` });
    return { xmlEntryCount: xmlCount, paragraphHint: pHint };
  } catch (err) {
    ctx.streamer.fail(step, err instanceof Error ? err.message : String(err));
    throw new OfficeEngineError("PARSE_FAILED", err instanceof Error ? err.message : String(err), { stage: "parse", cause: err });
  }
}

// ---------------------------------------------------------------------------
// Map (semantic)
// ---------------------------------------------------------------------------

export async function mapStage(ctx: OfficeRunContext, pkg: DocxPackage): Promise<SemanticDocument> {
  const step = ctx.streamer.start("analyzing", "Construyendo mapa semántico");
  try {
    const sdoc = buildSemanticMap(pkg);
    ctx.streamer.complete(step, {
      output: `paragraphs=${sdoc.paragraphs.length} tables=${sdoc.tables.length} images=${sdoc.images.length} hyperlinks=${sdoc.hyperlinks.length}`,
    });
    return sdoc;
  } catch (err) {
    ctx.streamer.fail(step, err instanceof Error ? err.message : String(err));
    throw new OfficeEngineError("MAP_FAILED", err instanceof Error ? err.message : String(err), { stage: "map", cause: err });
  }
}

// ---------------------------------------------------------------------------
// Edit (delegates to fallbackLadder)
// ---------------------------------------------------------------------------

export type EditExecutor = (pkg: DocxPackage, sdoc: SemanticDocument, ops: EditOp[]) => Promise<EditResult>;

export async function editStage(
  ctx: OfficeRunContext,
  pkg: DocxPackage,
  sdoc: SemanticDocument,
  ops: EditOp[],
  executor: EditExecutor,
): Promise<EditResult> {
  const step = ctx.streamer.start("editing", "Aplicando edición", { expandable: true });
  try {
    const result = await executor(pkg, sdoc, ops);
    ctx.streamer.complete(step, {
      title: `Aplicando edición (nivel ${result.level})`,
      output: `${result.opResults.length} ops, +${result.diff.added}/-${result.diff.removed} chars`,
      // diff metadata is included via stepStreamer's diff field on creation; we update via updates below
    });
    // Patch the diff metadata on the underlying step (stepStreamer doesn't expose it via complete)
    // — handled by the orchestrator persistence layer instead.
    return result;
  } catch (err) {
    ctx.streamer.fail(step, err instanceof Error ? err.message : String(err));
    throw new OfficeEngineError("EDIT_FAILED", err instanceof Error ? err.message : String(err), { stage: "edit", cause: err });
  }
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export async function validateStage(ctx: OfficeRunContext, pkg: DocxPackage): Promise<ValidationReport> {
  const step = ctx.streamer.start("analyzing", "Validando OOXML");
  try {
    const report = await workerValidateDocx(pkg, { signal: ctx.signal });
    if (!report.valid) {
      ctx.streamer.fail(step, `${report.errors.length} validation errors`);
      throw new OfficeEngineError(
        "VALIDATE_FAILED",
        `OOXML validation failed: ${report.errors.map((e) => e.code).join(", ")}`,
        { stage: "validate", details: report },
      );
    }
    ctx.streamer.complete(step, {
      output: `valid=${report.valid} warnings=${report.warnings.length} entries=${report.stats.entryCount} paragraphs=${report.stats.paragraphCount} tables=${report.stats.tableCount}`,
    });
    return report;
  } catch (err) {
    if (err instanceof OfficeEngineError) throw err;
    ctx.streamer.fail(step, err instanceof Error ? err.message : String(err));
    throw new OfficeEngineError("VALIDATE_FAILED", err instanceof Error ? err.message : String(err), { stage: "validate", cause: err });
  }
}

// ---------------------------------------------------------------------------
// Repack
// ---------------------------------------------------------------------------

export interface RepackResult {
  buffer: Buffer;
  checksum: string;
  size: number;
}

export async function repackStage(ctx: OfficeRunContext, pkg: DocxPackage): Promise<RepackResult> {
  const step = ctx.streamer.start("generating", "Repack DOCX");
  try {
    const buffer = await workerRepackDocx(pkg, { signal: ctx.signal });
    const checksum = createHash("sha256").update(buffer).digest("hex");
    ctx.streamer.complete(step, { output: `${buffer.length} bytes sha256=${checksum.slice(0, 12)}…` });
    return { buffer, checksum, size: buffer.length };
  } catch (err) {
    ctx.streamer.fail(step, err instanceof Error ? err.message : String(err));
    throw new OfficeEngineError("REPACK_FAILED", err instanceof Error ? err.message : String(err), { stage: "repack", cause: err });
  }
}

// ---------------------------------------------------------------------------
// Round-trip diff
// ---------------------------------------------------------------------------

export async function roundTripStage(
  ctx: OfficeRunContext,
  originalPkg: DocxPackage,
  repackedBuf: Buffer,
  allowlist: string[],
): Promise<DiffReport> {
  const step = ctx.streamer.start("analyzing", "Round-trip diff");
  try {
    const report = await workerRoundTripDiff(originalPkg, repackedBuf, allowlist, { signal: ctx.signal });
    if (report.fatal) {
      ctx.streamer.fail(step, `Fatal diff: ${report.byteDiffs.length} byte diffs, ${report.xmlDiffs.length} xml diffs`);
      throw new OfficeEngineError(
        "ROUNDTRIP_DIFF_FAILED",
        `Round-trip diff fatal: byte=${report.byteDiffs.length} xml=${report.xmlDiffs.length}`,
        { stage: "roundtrip_diff", details: report },
      );
    }
    ctx.streamer.complete(step, {
      output: `clean=${report.cleanEntries} diffed=${report.diffedEntries} (within allowlist)`,
    });
    return report;
  } catch (err) {
    if (err instanceof OfficeEngineError) throw err;
    ctx.streamer.fail(step, err instanceof Error ? err.message : String(err));
    throw new OfficeEngineError("ROUNDTRIP_DIFF_FAILED", err instanceof Error ? err.message : String(err), { stage: "roundtrip_diff", cause: err });
  }
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export interface PreviewArtifact {
  path: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}

export async function previewStage(
  ctx: OfficeRunContext,
  buffer: Buffer,
  checksum: string,
  writeBinary: (relative: string, data: Buffer) => Promise<string>,
): Promise<PreviewArtifact> {
  const step = ctx.streamer.start("generating", "Preparando vista previa");
  try {
    const path = await writeBinary("preview.docx", buffer);
    ctx.streamer.complete(step, {
      output: `preview ready (${buffer.length} bytes)`,
      artifact: {
        id: "preview",
        name: "preview.docx",
        type: "docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: buffer.length,
        downloadUrl: `/api/office-engine/runs/${ctx.runId}/artifacts/preview`,
        previewUrl: `/api/office-engine/runs/${ctx.runId}/artifacts/preview`,
      },
    });
    return {
      path,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: buffer.length,
      checksumSha256: checksum,
    };
  } catch (err) {
    ctx.streamer.fail(step, err instanceof Error ? err.message : String(err));
    throw new OfficeEngineError("PREVIEW_FAILED", err instanceof Error ? err.message : String(err), { stage: "preview", cause: err });
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportArtifact {
  path: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}

export async function exportStage(
  ctx: OfficeRunContext,
  buffer: Buffer,
  expectedChecksum: string,
  writeBinary: (relative: string, data: Buffer) => Promise<string>,
  outputName: string,
): Promise<ExportArtifact> {
  const step = ctx.streamer.start("generating", "Exportando documento final");
  try {
    const actualChecksum = createHash("sha256").update(buffer).digest("hex");
    if (actualChecksum !== expectedChecksum) {
      throw new OfficeEngineError(
        "EXPORT_FAILED",
        `Export checksum mismatch: repack=${expectedChecksum.slice(0, 12)}… export=${actualChecksum.slice(0, 12)}…`,
        { stage: "export" },
      );
    }
    const path = await writeBinary(outputName, buffer);
    const completed = ctx.streamer.complete(step, {
      title: "Documento listo",
      output: `${buffer.length} bytes (checksum verified)`,
      artifact: {
        id: "exported",
        name: outputName,
        type: "docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: buffer.length,
        downloadUrl: `/api/office-engine/runs/${ctx.runId}/artifacts/exported`,
        previewUrl: `/api/office-engine/runs/${ctx.runId}/artifacts/preview`,
      },
    });
    // Promote the step type to "completed" via a follow-up event so the UI shows the final state.
    ctx.streamer.add("completed", "Documento listo", {
      output: `Run ${ctx.runId} finished`,
      artifact: completed.artifact,
    });
    return {
      path,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: buffer.length,
      checksumSha256: actualChecksum,
    };
  } catch (err) {
    if (err instanceof OfficeEngineError) {
      ctx.streamer.fail(step, err.message);
      throw err;
    }
    ctx.streamer.fail(step, err instanceof Error ? err.message : String(err));
    throw new OfficeEngineError("EXPORT_FAILED", err instanceof Error ? err.message : String(err), { stage: "export", cause: err });
  }
}
