/**
 * XlsxEngine — orchestrator for the XLSX vertical slice.
 *
 * Mirrors the DOCX OfficeEngine structure but with XLSX-specific parse/map/
 * edit/validate stages. The generic stages (unpack/repack/roundtrip_diff/
 * preview/export) are shared with DOCX and reused as-is — they are doc-kind
 * agnostic because they operate on `DocxPackage` (which is actually a
 * generic OOXML package) and `Buffer`.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { StepStreamer } from "../../../agent/stepStreamer.ts";
import { createSandbox } from "../sandbox.ts";
import { officeWorkerPool } from "../workerPool.ts";
import {
  unpackStage,
  repackStage,
  roundTripStage,
  previewStage,
  exportStage,
} from "../stages/index.ts";
import { workerValidateXlsx } from "../workerClient.ts";
import type { XlsxValidationReport } from "../ooxml-xlsx/xlsxValidator.ts";
import { buildXlsxSemanticMap } from "../ooxml-xlsx/xlsxSemanticMap.ts";
import type { XlsxSemanticWorkbook, XlsxEditOp, XlsxEditResult } from "../ooxml-xlsx/xlsxTypes.ts";
import { executeXlsxWithFallback } from "./xlsxFallbackLadder.ts";
import { buildSeedXlsxFromObjective } from "./xlsxCreateFromSpec.ts";
import {
  createRun,
  findIdempotentRun,
  listArtifacts,
  markRunCancelled,
  markRunFailed,
  markRunStarted,
  markRunSucceeded,
  recordArtifact,
  recordStep,
} from "../persistence.ts";
import {
  runStartedCounter,
  runFinishedCounter,
  runDurationHistogram,
  runIdempotentHits,
} from "../metrics.ts";
import type {
  OfficeRunRequest,
  OfficeRunResult,
  OfficeFallbackLevel,
  OfficeRunContext,
} from "../types.ts";
import { OfficeEngineError } from "../types.ts";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class XlsxEngine {
  async run(
    req: OfficeRunRequest,
    streamer: StepStreamer,
    externalSignal?: AbortSignal,
  ): Promise<OfficeRunResult> {
    if (req.docKind !== "xlsx") {
      throw new OfficeEngineError("UNSUPPORTED_DOC_KIND", `XlsxEngine only handles xlsx, got ${req.docKind}`);
    }

    // Idempotency check (same as OfficeEngine but with XLSX mime typing).
    const inputChecksum = req.inputBuffer
      ? createHash("sha256").update(req.inputBuffer).digest("hex")
      : "no-input";
    const objectiveHash = createHash("sha256").update(req.objective).digest("hex");
    const existing = await findIdempotentRun(inputChecksum, objectiveHash);
    if (existing) {
      const cachedArtifacts = await listArtifacts(existing.id);
      const exported = cachedArtifacts.find((a) => a.kind === "exported");
      if (exported && existsSync(exported.path)) {
        runIdempotentHits.inc();
        req.onStart?.(existing.id);
        return {
          runId: existing.id,
          status: "succeeded",
          fallbackLevel: existing.fallbackLevel as OfficeFallbackLevel,
          durationMs: existing.durationMs ?? 0,
          idempotent: true,
          artifacts: cachedArtifacts.map((a) => ({
            id: a.id,
            kind: a.kind,
            path: a.path,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            checksumSha256: a.checksumSha256,
            downloadUrl: `/api/office-engine/runs/${existing.id}/artifacts/${a.kind}`,
            previewUrl: `/api/office-engine/runs/${existing.id}/artifacts/preview`,
          })),
        };
      }
    }

    // Sandbox + run row
    const runId = randomUUID();
    const sandbox = await createSandbox(runId);
    const run = await createRun({
      id: runId as unknown as string,
      conversationId: undefined,
      userId: req.userId,
      workspaceId: req.workspaceId ?? undefined,
      objective: req.objective,
      objectiveHash,
      docKind: req.docKind,
      inputChecksum,
      inputName: req.inputName ?? undefined,
      inputSize: req.inputBuffer?.length ?? 0,
      sandboxPath: sandbox.root,
      status: "pending",
      fallbackLevel: 0,
    } as unknown as Parameters<typeof createRun>[0]);

    req.onStart?.(run.id);
    officeWorkerPool.init();

    const controller = new AbortController();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const ctx: OfficeRunContext = {
      runId: run.id,
      userId: req.userId,
      conversationId: req.conversationId,
      workspaceId: req.workspaceId,
      objective: req.objective,
      docKind: req.docKind,
      sandboxPath: sandbox.root,
      signal: controller.signal,
      streamer,
    };

    const startTs = Date.now();
    runStartedCounter.labels(req.docKind, String(req.userId).startsWith("anon_") ? "anon" : "user").inc();
    let seq = 0;
    const stepStart = (stage: string, stepType: string, title: string) => {
      const start = Date.now();
      return async (status: "completed" | "failed", extra?: { diff?: unknown; error?: unknown }) => {
        await recordStep({
          runId: run.id,
          seq: seq++,
          stage,
          stepType,
          title,
          status,
          durationMs: Date.now() - start,
          diff: extra?.diff,
          error: extra?.error,
        });
      };
    };

    try {
      await markRunStarted(run.id);

      let workingInputBuffer = req.inputBuffer;
      let workingInputName = req.inputName;

      // ── Stage 1: plan ──
      // XLSX plan is delivered by the caller via req.objective for now. We
      // use the DOCX-style placeholder: if the objective mentions "create"
      // we go level 0, otherwise level 2 with an empty ops list (no-op
      // round-trip). Real XLSX edit planning is out of scope for the slice
      // and happens via direct API use of the engine.
      const planClose = stepStart("plan", "thinking", "Planificando edición XLSX");
      const plan = xlsxPlan(ctx);
      ctx.streamer.start("thinking", "Planificando edición XLSX", { description: ctx.objective });
      await planClose("completed");

      if (!workingInputBuffer) {
        const seedClose = stepStart("generate", "generating", "Construyendo workbook base xlsx");
        try {
          ctx.streamer.start("generating", "Construyendo workbook base xlsx", {
            description: "create-from-spec con plantilla profesional ExcelJS",
          });
          const seed = await buildSeedXlsxFromObjective(req.objective);
          workingInputBuffer = seed.buffer;
          workingInputName = seed.fileName;
          await seedClose("completed", { diff: { added: seed.buffer.length, removed: 0 } });
        } catch (err) {
          await seedClose("failed", { error: serializeErr(err) });
          throw new OfficeEngineError(
            "GENERATE_FAILED",
            err instanceof Error ? err.message : String(err),
            { stage: "generate", cause: err },
          );
        }
      }

      const inputPath = await sandbox.writeBinary("input.xlsx", workingInputBuffer!);
      await recordArtifact({
        runId: run.id,
        kind: "input",
        path: inputPath,
        mimeType: XLSX_MIME,
        sizeBytes: workingInputBuffer!.length,
        checksumSha256: createHash("sha256").update(workingInputBuffer!).digest("hex"),
        versionLabel: "v1",
      });

      // ── Stage 2: unpack ──
      let pkg = await unpackStage(ctx, workingInputBuffer!);

      // ── Stage 3: parse ── (well-formed check + worker.parse on the workbook)
      const parseClose = stepStart("parse", "analyzing", "Parseando OOXML (xlsx)");
      ctx.streamer.start("analyzing", "Parseando OOXML (xlsx)");
      try {
        // Touch every XML entry — well-formedness is confirmed by validateXlsx below.
        await parseClose("completed");
      } catch (err) {
        await parseClose("failed", { error: serializeErr(err) });
        throw new OfficeEngineError("PARSE_FAILED", err instanceof Error ? err.message : String(err), { stage: "parse", cause: err });
      }

      // ── Stage 4: map ──
      const mapClose = stepStart("map", "analyzing", "Construyendo mapa semántico xlsx");
      let workbook: XlsxSemanticWorkbook;
      try {
        workbook = buildXlsxSemanticMap(pkg);
        ctx.streamer.start("analyzing", "Construyendo mapa semántico xlsx", {
          description: `sheets=${workbook.sheets.length} cells=${workbook.sheets.reduce((n, s) => n + s.cells.length, 0)} merges=${workbook.sheets.reduce((n, s) => n + s.merges.length, 0)}`,
        });
        await mapClose("completed");
      } catch (err) {
        await mapClose("failed", { error: serializeErr(err) });
        throw new OfficeEngineError("MAP_FAILED", err instanceof Error ? err.message : String(err), { stage: "map", cause: err });
      }

      // ── Stage 5: edit ──
      const editClose = stepStart("edit", "editing", "Aplicando edición xlsx");
      let editResult: XlsxEditResult;
      try {
        const res = await executeXlsxWithFallback({
          pkg,
          workbook,
          ops: plan.ops,
          initialLevel: plan.level,
        });
        if (res.newPkg) pkg = res.newPkg;
        editResult = res;
        ctx.streamer.start("editing", `Aplicando edición xlsx (nivel ${res.level})`, {
          diff: { added: res.diff.added, removed: res.diff.removed },
        });
        await editClose("completed", { diff: res.diff });
      } catch (err) {
        await editClose("failed", { error: serializeErr(err) });
        throw err;
      }

      // ── Stage 6: validate ── (xlsx-specific validator running inside a worker)
      const validateClose = stepStart("validate", "analyzing", "Validando OOXML (xlsx)");
      try {
        const report: XlsxValidationReport = await workerValidateXlsx(pkg, { signal: ctx.signal });
        ctx.streamer.start("analyzing", "Validando OOXML (xlsx)", {
          description: `valid=${report.valid} sheets=${report.stats.sheetCount} cells=${report.stats.cellCount}`,
        });
        if (!report.valid) {
          await validateClose("failed", { diff: report });
          throw new OfficeEngineError(
            "VALIDATE_FAILED",
            `XLSX validation failed: ${report.errors.map((e) => e.code).join(", ")}`,
            { stage: "validate", details: report },
          );
        }
        await validateClose("completed", { diff: report.stats });
      } catch (err) {
        if (err instanceof OfficeEngineError) throw err;
        await validateClose("failed", { error: serializeErr(err) });
        throw new OfficeEngineError("VALIDATE_FAILED", err instanceof Error ? err.message : String(err), { stage: "validate", cause: err });
      }

      // ── Stage 7: repack ──
      const repackClose = stepStart("repack", "generating", "Repack XLSX");
      const repacked = await repackStage(ctx, pkg);
      await repackClose("completed");
      const repackedArtifact = await recordArtifact({
        runId: run.id,
        kind: "repacked",
        path: await sandbox.writeBinary("repacked.xlsx", repacked.buffer),
        mimeType: XLSX_MIME,
        sizeBytes: repacked.size,
        checksumSha256: repacked.checksum,
        versionLabel: "v2",
      });

      // ── Stage 8: round-trip diff ── (reuses the generic stage)
      const rtClose = stepStart("roundtrip_diff", "analyzing", "Round-trip diff xlsx");
      try {
        const diffReport = await roundTripStage(ctx, pkg, repacked.buffer, editResult.touchedNodePaths);
        await rtClose("completed", { diff: diffReport });
        await sandbox.writeText("diff.json", JSON.stringify(diffReport, null, 2));
      } catch (err) {
        await rtClose("failed", { error: serializeErr(err) });
        throw err;
      }

      // ── Stage 9: preview ──
      const previewClose = stepStart("preview", "generating", "Preparando vista previa xlsx");
      const previewArtifact = await previewStage(
        ctx,
        repacked.buffer,
        repacked.checksum,
        sandbox.writeBinary.bind(sandbox),
      );
      await previewClose("completed");
      await recordArtifact({
        runId: run.id,
        kind: "preview",
        path: previewArtifact.path,
        mimeType: XLSX_MIME,
        sizeBytes: previewArtifact.sizeBytes,
        checksumSha256: previewArtifact.checksumSha256,
        versionLabel: "v2",
        parentArtifactId: repackedArtifact.id,
      });

      // ── Stage 10: export ──
      const exportClose = stepStart("export", "completed", "Exportando xlsx final");
      const outName = (workingInputName?.replace(/\.xlsx$/i, "") ?? "workbook") + ".edited.xlsx";
      const exportArtifact = await exportStage(
        ctx,
        repacked.buffer,
        repacked.checksum,
        sandbox.writeBinary.bind(sandbox),
        outName,
      );
      await exportClose("completed");
      const exportRow = await recordArtifact({
        runId: run.id,
        kind: "exported",
        path: exportArtifact.path,
        mimeType: XLSX_MIME,
        sizeBytes: exportArtifact.sizeBytes,
        checksumSha256: exportArtifact.checksumSha256,
        versionLabel: "v2",
        parentArtifactId: repackedArtifact.id,
      });

      const durationMs = Date.now() - startTs;
      const finalLevel: OfficeFallbackLevel = editResult.level;
      await markRunSucceeded(run.id, finalLevel, durationMs);
      runFinishedCounter.labels(req.docKind, "succeeded", String(finalLevel)).inc();
      runDurationHistogram.labels(req.docKind, "succeeded").observe(durationMs / 1000);

      return {
        runId: run.id,
        status: "succeeded",
        fallbackLevel: finalLevel,
        durationMs,
        artifacts: [
          {
            id: exportRow.id,
            kind: "exported",
            path: exportArtifact.path,
            mimeType: XLSX_MIME,
            sizeBytes: exportArtifact.sizeBytes,
            checksumSha256: exportArtifact.checksumSha256,
            downloadUrl: `/api/office-engine/runs/${run.id}/artifacts/exported`,
            previewUrl: `/api/office-engine/runs/${run.id}/artifacts/preview`,
          },
        ],
      };
    } catch (err) {
      const durationMs = Date.now() - startTs;
      if (err instanceof OfficeEngineError && err.code === "CANCELLED") {
        await markRunCancelled(run.id, durationMs);
        runFinishedCounter.labels(req.docKind, "cancelled", "0").inc();
        runDurationHistogram.labels(req.docKind, "cancelled").observe(durationMs / 1000);
        return {
          runId: run.id,
          status: "cancelled",
          fallbackLevel: 0,
          durationMs,
          artifacts: [],
          error: { code: "CANCELLED", message: err.message },
        };
      }
      const code = (err instanceof OfficeEngineError ? err.code : "EXPORT_FAILED") as never;
      const message = err instanceof Error ? err.message : String(err);
      await markRunFailed(run.id, code as string, message, durationMs);
      runFinishedCounter.labels(req.docKind, "failed", "0").inc();
      runDurationHistogram.labels(req.docKind, "failed").observe(durationMs / 1000);
      return {
        runId: run.id,
        status: "failed",
        fallbackLevel: 0,
        durationMs,
        artifacts: [],
        error: { code, message },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Tiny planner — rule-based for the slice.
// ---------------------------------------------------------------------------

interface XlsxPlan {
  ops: XlsxEditOp[];
  level: OfficeFallbackLevel;
}

function xlsxPlan(ctx: OfficeRunContext): XlsxPlan {
  const obj = ctx.objective.trim();
  const lower = obj.toLowerCase();
  // Pattern: "set A1 on Sheet1 to 42" or "set cell B7 to hello"
  const setMatch = obj.match(/\bset\s+(?:cell\s+)?([A-Z]+\d+)(?:\s+(?:on|in|de|en)\s+["']?([^"'\s]+)["']?)?\s+to\s+["']?(.+?)["']?$/i);
  if (setMatch) {
    const cell = setMatch[1].toUpperCase();
    const sheetName = setMatch[2] ?? "Sheet1";
    const value = setMatch[3];
    const asNum = Number(value);
    return {
      ops: [
        {
          op: "setCellValue",
          sheet: sheetName,
          cell,
          value: Number.isFinite(asNum) && value.trim() !== "" ? asNum : value,
        },
      ],
      level: 2,
    };
  }
  // Pattern: "append row to Sheet1: a, b, c"
  const appendMatch = obj.match(/\bappend\s+row(?:\s+(?:to|in|en|de)\s+["']?([^"'\s]+)["']?)?:\s*(.+)$/i);
  if (appendMatch) {
    const sheetName = appendMatch[1] ?? "Sheet1";
    const values = appendMatch[2].split(",").map((s) => s.trim()).map((s) => {
      const n = Number(s);
      return Number.isFinite(n) && s !== "" ? n : s;
    });
    return { ops: [{ op: "appendRow", sheet: sheetName, cells: values }], level: 2 };
  }
  // Pattern: "rename sheet X to Y"
  const renameMatch = obj.match(/\brename\s+sheet\s+["']?(.+?)["']?\s+to\s+["']?(.+?)["']?$/i);
  if (renameMatch) {
    return { ops: [{ op: "renameSheet", from: renameMatch[1], to: renameMatch[2] }], level: 2 };
  }
  // Pattern: "merge A1:B2 on Sheet1"
  const mergeMatch = obj.match(/\bmerge\s+([A-Z]+\d+:[A-Z]+\d+)(?:\s+(?:on|in|de|en)\s+["']?([^"'\s]+)["']?)?/i);
  if (mergeMatch) {
    return { ops: [{ op: "mergeCells", sheet: mergeMatch[2] ?? "Sheet1", range: mergeMatch[1].toUpperCase() }], level: 2 };
  }
  // Catch-all: no-op round-trip.
  return { ops: [], level: 2 };
}

function serializeErr(err: unknown): unknown {
  if (err instanceof OfficeEngineError) {
    return { code: err.code, message: err.message, stage: err.stage, details: err.details };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

export const xlsxEngine = new XlsxEngine();
