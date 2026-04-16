/**
 * OfficeEngine — orchestrator for the DOCX vertical slice.
 *
 * Drives the full pipeline:
 *
 *   plan → unpack → parse → map → edit (fallback ladder) → validate
 *        → repack → round-trip diff → preview → export
 *
 * Responsibilities:
 *   - Lifecycle: create sandbox, persist run row, dispatch stages, persist
 *     each step, persist artifacts, mark run succeeded/failed/cancelled,
 *     dispose sandbox after a configurable retention.
 *   - Idempotency: short-circuit on (input_checksum, objective_hash) match.
 *   - Cancellation: AbortController plumbed through every stage.
 *   - Streaming: a `StepStreamer` is bound to the run for SSE clients.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { StepStreamer } from "../../../agent/stepStreamer";
import { createSandbox, type Sandbox } from "../sandbox";
import { officeWorkerPool } from "../workerPool";
import {
  planStage,
  enhancePlanWithPackage,
  unpackStage,
  parseStage,
  mapStage,
  editStage,
  validateStage,
  repackStage,
  roundTripStage,
  previewStage,
  exportStage,
  type Plan,
  type EditExecutor,
} from "../stages";
import { executeWithFallback } from "./fallbackLadder";
import { generateFreshDocx } from "../../../agent/capabilities/office/wordGenerator";
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
} from "../persistence";
import {
  runStartedCounter,
  runFinishedCounter,
  runDurationHistogram,
  runIdempotentHits,
} from "../metrics";
import type {
  OfficeRunRequest,
  OfficeRunResult,
  OfficeRunContext,
  OfficeFallbackLevel,
} from "../types";
import { OfficeEngineError } from "../types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeOfficeConversationIdForPersistence(
  conversationId?: string | null,
): string | undefined {
  if (typeof conversationId !== "string") {
    return undefined;
  }

  const trimmed = conversationId.trim();
  if (!trimmed) {
    return undefined;
  }

  if (UUID_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  // Chat ids in the product often look like `chat_<uuid>`. Persist the UUID
  // portion so the office run can still be stored even if the higher-level
  // chat identifier carries a string prefix.
  const suffixMatch = trimmed.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  );
  if (suffixMatch && UUID_RE.test(suffixMatch[1])) {
    return suffixMatch[1].toLowerCase();
  }

  return undefined;
}

export class OfficeEngine {
  /**
   * Run the pipeline. Returns the final result with artifact metadata.
   *
   * The streamer is the SSE channel for live step events. If you don't have
   * one, pass `new StepStreamer()` and the events will only be collected
   * in memory.
   */
  async run(req: OfficeRunRequest, streamer: StepStreamer, externalSignal?: AbortSignal): Promise<OfficeRunResult> {
    // ── Dispatcher ──
    // Delegate to the right engine based on docKind. Dynamic imports keep
    // the dependency graph flat and avoid circular imports via the shared
    // persistence/metrics modules.
    if (req.docKind === "xlsx") {
      const { xlsxEngine } = await import("./XlsxEngine.ts");
      return xlsxEngine.run(req, streamer, externalSignal);
    }
    if (req.docKind === "pptx") {
      const { pptxEngine } = await import("./PptxEngine.ts");
      return pptxEngine.run(req, streamer, externalSignal);
    }
    if (req.docKind === "pdf") {
      const { pdfEngine } = await import("./PdfEngine.ts");
      return pdfEngine.run(req, streamer, externalSignal);
    }
    if (req.docKind !== "docx") {
      throw new OfficeEngineError("UNSUPPORTED_DOC_KIND", `OfficeEngine dispatcher: unsupported docKind ${req.docKind}`);
    }

    // Idempotency check.
    //
    // We only short-circuit if BOTH the DB row exists AND the exported
    // artifact is still readable on disk. Otherwise the cached row would
    // point at a sandbox that's been cleaned up (e.g. server restart on a
    // host whose $TMPDIR was wiped), and the client would get a download
    // 410. In that case we discard the cache hit and run a fresh pipeline.
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
      const exportedAlive = exported ? existsSync(exported.path) : false;
      if (exportedAlive) {
        runIdempotentHits.inc();
        // Notify the route layer of the reused run id so it can register a
        // session immediately and return synchronously.
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
      // Stale cache → fall through and run fresh.
    }

    // Sandbox + run row
    const runId = randomUUID();
    const sandbox = await createSandbox(runId);
    const persistedConversationId = normalizeOfficeConversationIdForPersistence(req.conversationId);
    const run = await createRun({
      id: runId as unknown as string, // drizzle accepts string
      conversationId: persistedConversationId,
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
    } as any);

    // Notify the caller (route layer) that the run id is now stable so it can
    // register the SSE session keyed by it before the pipeline starts producing
    // step events.
    req.onStart?.(run.id);

    // Boot the worker pool lazily on first use.
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
      return async (status: "completed" | "failed", extra?: { diff?: unknown; error?: unknown; output?: string }) => {
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

      // Persist the input as the first artifact (if any).
      if (req.inputBuffer) {
        const inputPath = await sandbox.writeBinary("input.docx", req.inputBuffer);
        await recordArtifact({
          runId: run.id,
          kind: "input",
          path: inputPath,
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sizeBytes: req.inputBuffer.length,
          checksumSha256: inputChecksum,
          versionLabel: "v1",
        });
      }

      // ── Stage 1: plan ──
      const planClose = stepStart("plan", "thinking", "Planificando edición DOCX");
      let plan: Plan;
      try {
        plan = planStage(ctx);
        await planClose("completed", { output: plan.rationale });
      } catch (err) {
        await planClose("failed", { error: serializeErr(err) });
        throw err;
      }

      // For "create from spec" (level 0) we synthesize a fresh DOCX and skip
      // unpack/parse/map/edit on the original input.
      let pkg: import("../ooxml/zipIO").DocxPackage;
      let workingBuf: Buffer;

      if (plan.level === 0 || !req.inputBuffer) {
        const editClose = stepStart("edit", "editing", "Generando DOCX desde cero (nivel 0)");
        try {
          const fresh = await generateFreshDocx({
            title: req.objective.slice(0, 120),
            paragraphs: [req.objective],
          });
          pkg = await unpackStage(ctx, fresh);
          workingBuf = fresh;
          await editClose("completed", { output: `${fresh.length} bytes` });
        } catch (err) {
          await editClose("failed", { error: serializeErr(err) });
          throw err;
        }
      } else {
        // ── Stage 2: unpack ──
        pkg = await unpackStage(ctx, req.inputBuffer);
        workingBuf = req.inputBuffer;

        // Refine the plan now that we have the package: auto-route to
        // Docxtemplater (level 1) if the input contains real `{{...}}`
        // template markers. This implements the architectural priority
        // where Docxtemplater is the PRIMARY engine for DOCX templates.
        plan = enhancePlanWithPackage(plan, pkg);

        // ── Stage 3: parse ──
        const parseClose = stepStart("parse", "analyzing", "Parseando OOXML");
        try {
          await parseStage(ctx, pkg);
          await parseClose("completed");
        } catch (err) {
          await parseClose("failed", { error: serializeErr(err) });
          throw err;
        }

        // ── Stage 4: map ──
        const mapClose = stepStart("map", "analyzing", "Construyendo mapa semántico");
        let sdoc: import("../ooxml/semanticMap").SemanticDocument;
        try {
          sdoc = await mapStage(ctx, pkg);
          await mapClose("completed");
        } catch (err) {
          await mapClose("failed", { error: serializeErr(err) });
          throw err;
        }

        // ── Stage 5: edit (with fallback ladder) ──
        const editClose = stepStart("edit", "editing", "Aplicando edición");
        const executor: EditExecutor = async (p, sd, ops) => {
          const r = await executeWithFallback({
            pkg: p,
            sdoc: sd,
            ops,
            initialLevel: plan.level,
            freshBufferProvider: undefined,
          });
          if (r.newPkg) pkg = r.newPkg; // level 1 returns a new package
          return r;
        };
        let editResult: import("../types").EditResult;
        try {
          editResult = await editStage(ctx, pkg, sdoc, plan.ops, executor);
          await editClose("completed", { diff: editResult.diff });
        } catch (err) {
          await editClose("failed", { error: serializeErr(err) });
          throw err;
        }

        // Touched paths inform the round-trip diff allowlist below.
        (ctx as unknown as { touchedPaths: string[] }).touchedPaths = editResult.touchedNodePaths;
      }

      // ── Stage 6: validate ──
      const validateClose = stepStart("validate", "analyzing", "Validando OOXML");
      try {
        const report = await validateStage(ctx, pkg);
        await validateClose("completed", { diff: report.stats });
      } catch (err) {
        await validateClose("failed", { error: serializeErr(err) });
        throw err;
      }

      // ── Stage 7: repack ──
      const repackClose = stepStart("repack", "generating", "Repack DOCX");
      let repacked;
      try {
        repacked = await repackStage(ctx, pkg);
        await repackClose("completed", { output: `${repacked.size} bytes` });
      } catch (err) {
        await repackClose("failed", { error: serializeErr(err) });
        throw err;
      }
      const repackedArtifact = await recordArtifact({
        runId: run.id,
        kind: "repacked",
        path: await sandbox.writeBinary("repacked.docx", repacked.buffer),
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: repacked.size,
        checksumSha256: repacked.checksum,
        versionLabel: "v2",
      });

      // ── Stage 8: round-trip diff ──
      const rtClose = stepStart("roundtrip_diff", "analyzing", "Round-trip diff");
      try {
        const allowlist = (ctx as unknown as { touchedPaths?: string[] }).touchedPaths ?? [];
        const diffReport = await roundTripStage(ctx, pkg, repacked.buffer, allowlist);
        await rtClose("completed", { diff: diffReport });
        await sandbox.writeText("diff.json", JSON.stringify(diffReport, null, 2));
      } catch (err) {
        await rtClose("failed", { error: serializeErr(err) });
        throw err;
      }

      // ── Stage 9: preview ──
      const previewClose = stepStart("preview", "generating", "Preparando vista previa");
      let previewArtifact;
      try {
        previewArtifact = await previewStage(ctx, repacked.buffer, repacked.checksum, sandbox.writeBinary.bind(sandbox));
        await previewClose("completed");
      } catch (err) {
        await previewClose("failed", { error: serializeErr(err) });
        throw err;
      }
      await recordArtifact({
        runId: run.id,
        kind: "preview",
        path: previewArtifact.path,
        mimeType: previewArtifact.mimeType,
        sizeBytes: previewArtifact.sizeBytes,
        checksumSha256: previewArtifact.checksumSha256,
        versionLabel: "v2",
        parentArtifactId: repackedArtifact.id,
      });

      // ── Stage 10: export ──
      const exportClose = stepStart("export", "completed", "Exportando documento final");
      let exportArtifact;
      try {
        const outName = (req.inputName?.replace(/\.docx$/i, "") ?? "document") + ".edited.docx";
        exportArtifact = await exportStage(ctx, repacked.buffer, repacked.checksum, sandbox.writeBinary.bind(sandbox), outName);
        await exportClose("completed");
      } catch (err) {
        await exportClose("failed", { error: serializeErr(err) });
        throw err;
      }
      const exportRow = await recordArtifact({
        runId: run.id,
        kind: "exported",
        path: exportArtifact.path,
        mimeType: exportArtifact.mimeType,
        sizeBytes: exportArtifact.sizeBytes,
        checksumSha256: exportArtifact.checksumSha256,
        versionLabel: "v2",
        parentArtifactId: repackedArtifact.id,
      });

      const durationMs = Date.now() - startTs;
      const finalLevel: OfficeFallbackLevel = (plan.level ?? 2) as OfficeFallbackLevel;
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
            mimeType: exportArtifact.mimeType,
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
      const code = err instanceof OfficeEngineError ? err.code : "EXPORT_FAILED";
      const message = err instanceof Error ? err.message : String(err);
      await markRunFailed(run.id, code, message, durationMs);
      runFinishedCounter.labels(req.docKind, "failed", "0").inc();
      runDurationHistogram.labels(req.docKind, "failed").observe(durationMs / 1000);
      return {
        runId: run.id,
        status: "failed",
        fallbackLevel: 0,
        durationMs,
        artifacts: [],
        error: { code: code as never, message },
      };
    }
  }
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

export const officeEngine = new OfficeEngine();
