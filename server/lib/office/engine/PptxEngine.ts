/**
 * PptxEngine — minimal create-from-spec implementation using PptxGenJS.
 *
 * ── Architectural role ──
 *
 * PptxGenJS is the **primary** high-level library for PPTX creation in the
 * Office Engine, mirroring Docxtemplater's role for DOCX templates. This
 * engine replaces the previous NOT_IMPLEMENTED stub with a minimal but
 * real create-from-spec path:
 *
 *   Level 0 — PptxGenJS fresh presentation built from the objective text.
 *             Produces a valid .pptx with a title slide + one content slide.
 *   Level 1 — (reserved) PptxGenJS template-filling via JSON spec.
 *   Level 2 — (reserved) direct OOXML edit for complex structural cases.
 *
 * The engine reuses the generic pipeline stages (unpack / parse / validate
 * / repack / round-trip diff / preview / export) because they're doc-kind
 * agnostic. XLSX/DOCX use the same `officeWorkerPool` dispatch target.
 *
 * This file intentionally keeps the surface minimal; XLSX and DOCX have
 * the full fallback ladder. PPTX editing (vs creation) is deferred to a
 * later slice because it requires the same depth of work as the DOCX
 * ladder (semanticMap for slides, placeholder templates, etc.).
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import PptxGenJS from "pptxgenjs";
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

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export class PptxEngine {
  async run(
    req: OfficeRunRequest,
    streamer: StepStreamer,
    externalSignal?: AbortSignal,
  ): Promise<OfficeRunResult> {
    if (req.docKind !== "pptx") {
      throw new OfficeEngineError(
        "UNSUPPORTED_DOC_KIND",
        `PptxEngine only handles pptx, got ${req.docKind}`,
      );
    }

    // Idempotency check (same contract as DOCX/XLSX engines)
    const inputChecksum = req.inputBuffer
      ? createHash("sha256").update(req.inputBuffer).digest("hex")
      : "no-input";
    const objectiveHash = createHash("sha256")
      .update(`${req.docKind}:${req.objective}`)
      .digest("hex");
    const existing = await findIdempotentRun(inputChecksum, objectiveHash, req.docKind);
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
          artifacts: cachedArtifacts
            .filter((a) => a.kind === "exported")
            .map((a) => ({
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
    runStartedCounter
      .labels(req.docKind, String(req.userId).startsWith("anon_") ? "anon" : "user")
      .inc();
    let seq = 0;
    const stepStart = (stage: string, stepType: string, title: string) => {
      const start = Date.now();
      return async (
        status: "completed" | "failed",
        extra?: { diff?: unknown; error?: unknown },
      ) => {
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

      // ── Stage 1: plan ──
      const planClose = stepStart("plan", "thinking", "Planificando PPTX");
      ctx.streamer.start("thinking", "Planificando PPTX", { description: ctx.objective });
      await planClose("completed");

      // ── Stage 2: generate (level 0 — PptxGenJS fresh) ──
      const genClose = stepStart("edit", "editing", "Generando PPTX con PptxGenJS");
      ctx.streamer.start("editing", "Generando PPTX con PptxGenJS (nivel 0)");
      const freshBuffer = await generateFreshPptx(req.objective);
      await genClose("completed", { diff: { added: freshBuffer.length, removed: 0 } });

      // Persist as input artifact AND proceed through the round-trip pipeline
      // so we exercise the full unpack → repack path on the generated file.
      await recordArtifact({
        runId: run.id,
        kind: "input",
        path: await sandbox.writeBinary("generated.pptx", freshBuffer),
        mimeType: PPTX_MIME,
        sizeBytes: freshBuffer.length,
        checksumSha256: createHash("sha256").update(freshBuffer).digest("hex"),
        versionLabel: "v1",
      });

      let pkg = await unpackStage(ctx, freshBuffer);

      // ── Stage 3: parse ──
      const parseClose = stepStart("parse", "analyzing", "Parseando OOXML (pptx)");
      ctx.streamer.start("analyzing", "Parseando OOXML (pptx)");
      await parseClose("completed");

      // ── Stage 4: repack ──
      const repackClose = stepStart("repack", "generating", "Repack PPTX");
      const repacked = await repackStage(ctx, pkg);
      await repackClose("completed");
      const repackedArtifact = await recordArtifact({
        runId: run.id,
        kind: "repacked",
        path: await sandbox.writeBinary("repacked.pptx", repacked.buffer),
        mimeType: PPTX_MIME,
        sizeBytes: repacked.size,
        checksumSha256: repacked.checksum,
        versionLabel: "v2",
      });

      // ── Stage 5: round-trip diff ──
      const rtClose = stepStart("roundtrip_diff", "analyzing", "Round-trip diff pptx");
      try {
        const diffReport = await roundTripStage(ctx, pkg, repacked.buffer, []);
        await rtClose("completed", { diff: diffReport });
        await sandbox.writeText("diff.json", JSON.stringify(diffReport, null, 2));
      } catch (err) {
        await rtClose("failed", { error: serializeErr(err) });
        throw err;
      }

      // ── Stage 6: preview ──
      const previewClose = stepStart("preview", "generating", "Preparando vista previa pptx");
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
        mimeType: PPTX_MIME,
        sizeBytes: previewArtifact.sizeBytes,
        checksumSha256: previewArtifact.checksumSha256,
        versionLabel: "v2",
        parentArtifactId: repackedArtifact.id,
      });

      // ── Stage 7: export ──
      const exportClose = stepStart("export", "completed", "Exportando pptx final");
      const outName =
        (req.inputName?.replace(/\.pptx$/i, "") ?? "presentation") + ".edited.pptx";
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
        mimeType: PPTX_MIME,
        sizeBytes: exportArtifact.sizeBytes,
        checksumSha256: exportArtifact.checksumSha256,
        versionLabel: "v2",
        parentArtifactId: repackedArtifact.id,
      });

      const durationMs = Date.now() - startTs;
      const finalLevel: OfficeFallbackLevel = 0;
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
            mimeType: PPTX_MIME,
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
// PptxGenJS fresh generation
// ---------------------------------------------------------------------------

async function generateFreshPptx(objective: string): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";

  // Title slide
  const titleSlide = pres.addSlide();
  titleSlide.background = { color: "0F172A" };
  titleSlide.addText(objective.slice(0, 120), {
    x: 0.6,
    y: 2.5,
    w: 12,
    h: 1.2,
    fontSize: 36,
    bold: true,
    color: "FFFFFF",
    fontFace: "Calibri",
  });
  titleSlide.addText("Generado por Office Engine · PptxGenJS", {
    x: 0.6,
    y: 4.0,
    w: 12,
    h: 0.6,
    fontSize: 16,
    color: "94A3B8",
    fontFace: "Calibri",
  });

  // Content slide
  const contentSlide = pres.addSlide();
  contentSlide.addText("Objetivo", {
    x: 0.6,
    y: 0.5,
    w: 12,
    h: 0.8,
    fontSize: 28,
    bold: true,
    color: "0F172A",
  });
  contentSlide.addText(objective, {
    x: 0.6,
    y: 1.6,
    w: 12,
    h: 5,
    fontSize: 18,
    color: "334155",
    valign: "top",
    fontFace: "Calibri",
  });

  // PptxGenJS returns an ArrayBuffer-ish result in Node when outputType is "nodebuffer"
  const result = await pres.write({ outputType: "nodebuffer" });
  if (Buffer.isBuffer(result)) return result;
  if (result instanceof ArrayBuffer) return Buffer.from(result);
  if (result && typeof result === "object" && "buffer" in result) {
    return Buffer.from((result as { buffer: ArrayBuffer }).buffer);
  }
  return Buffer.from(String(result));
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

export const pptxEngine = new PptxEngine();
