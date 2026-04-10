/**
 * REST + SSE routes for the Office Engine.
 *
 *   POST   /api/office-engine/runs            multipart upload, starts a run
 *   GET    /api/office-engine/runs/:id        run metadata + artifact list
 *   GET    /api/office-engine/runs/:id/events SSE stream of step events
 *   GET    /api/office-engine/runs/:id/artifacts/:kind  binary download
 *   POST   /api/office-engine/runs/:id/cancel cancels an in-flight run
 *   POST   /api/office-engine/runs/:id/retry  starts a retry run
 *
 * Runs are spawned in the request process (low-latency interactive feedback).
 * Step events are pushed through the StepStreamer associated with the run;
 * the SSE endpoint subscribes to that streamer to forward events to the
 * client. Artifact binaries are streamed from the per-run sandbox directory.
 */

import express, { type Request, type Response, Router } from "express";
import multer from "multer";
import * as fs from "node:fs";
import { Logger } from "../lib/logger";
import { initSSEStream } from "../services/streamingResponse";
import { StepStreamer } from "../agent/stepStreamer";
import { officeEngine } from "../lib/office/engine/OfficeEngine";
import { getRun, listArtifacts } from "../lib/office/persistence";
import { officeWorkerPool } from "../lib/office/workerPool";
import type { OfficeRunRequest, OfficeRunResult } from "../lib/office/types";
import {
  countRunningOfficeRunsForUser,
  getOfficeRunSession,
  getOfficeRunSessionStats,
  markOfficeRunSessionFinished,
  registerOfficeRunSession,
  type OfficeRunSession,
} from "../lib/office/runSessionRegistry";
import { getSecureUserId } from "../lib/anonUserHelper";
import { renderMetrics, routeRejectsCounter, officeMetricsRegistry } from "../lib/office/metrics";

/**
 * Hardening config (env-driven, defaults safe for dev):
 *   - OFFICE_ENGINE_REQUIRE_AUTH=1 → reject anonymous (anon_*) users with 401.
 *   - OFFICE_ENGINE_MAX_CONCURRENT_PER_USER (default 4) → reject when a user
 *     has too many runs in flight.
 *   - OFFICE_ENGINE_MAX_INPUT_BYTES (default 100MB) → multer limit.
 */
const REQUIRE_AUTH = process.env.OFFICE_ENGINE_REQUIRE_AUTH === "1";
const MAX_CONCURRENT_PER_USER = Math.max(
  1,
  Number(process.env.OFFICE_ENGINE_MAX_CONCURRENT_PER_USER ?? 4),
);
const MAX_INPUT_BYTES = Math.max(
  1024,
  Number(process.env.OFFICE_ENGINE_MAX_INPUT_BYTES ?? 100 * 1024 * 1024),
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_INPUT_BYTES },
});

export function createOfficeEngineRouter(): Router {
  const router: Router = express.Router();

  router.post("/runs", upload.single("file"), async (req: Request, res: Response) => {
    try {
      // ── Auth ──
      const userId = getSecureUserId(req);
      if (!userId) {
        routeRejectsCounter.labels("no_user").inc();
        return res.status(401).json({
          error: "Unauthorized — no user id resolved",
          code: "OFFICE_ENGINE_NO_USER",
        });
      }
      const isAnon = String(userId).startsWith("anon_");
      if (REQUIRE_AUTH && isAnon) {
        routeRejectsCounter.labels("auth_required").inc();
        return res.status(401).json({
          error: "Authentication required for the Office Engine in this environment",
          code: "OFFICE_ENGINE_AUTH_REQUIRED",
        });
      }

      // ── Concurrency cap ──
      const inFlight = countRunningOfficeRunsForUser(userId);
      if (inFlight >= MAX_CONCURRENT_PER_USER) {
        routeRejectsCounter.labels("concurrency_limit").inc();
        return res.status(429).json({
          error: `Too many concurrent runs (limit=${MAX_CONCURRENT_PER_USER}, in flight=${inFlight})`,
          code: "OFFICE_ENGINE_CONCURRENCY_LIMIT",
        });
      }

      // ── Validation ──
      const objective = String(req.body?.objective ?? "").trim();
      const docKindRaw = String(req.body?.docKind ?? "docx");
      if (docKindRaw !== "docx" && docKindRaw !== "xlsx") {
        routeRejectsCounter.labels("unsupported_doc_kind").inc();
        return res.status(501).json({
          error: `docKind "${docKindRaw}" not supported. This engine ships docx and xlsx.`,
          code: "OFFICE_ENGINE_UNSUPPORTED_DOC_KIND",
        });
      }
      if (!objective) {
        routeRejectsCounter.labels("missing_objective").inc();
        return res.status(400).json({
          error: "Missing 'objective' field",
          code: "OFFICE_ENGINE_MISSING_OBJECTIVE",
        });
      }
      if (objective.length > 2000) {
        routeRejectsCounter.labels("objective_too_long").inc();
        return res.status(400).json({
          error: "Objective too long (max 2000 chars)",
          code: "OFFICE_ENGINE_OBJECTIVE_TOO_LONG",
        });
      }

      const conversationId = req.body?.conversationId ? String(req.body.conversationId) : null;
      const inputBuffer = req.file?.buffer;
      const inputName = req.file?.originalname;
      if (inputBuffer && inputBuffer.length > MAX_INPUT_BYTES) {
        routeRejectsCounter.labels("input_too_large").inc();
        return res.status(413).json({
          error: `Input too large (limit=${MAX_INPUT_BYTES})`,
          code: "OFFICE_ENGINE_INPUT_TOO_LARGE",
        });
      }

      const runReq: OfficeRunRequest = {
        userId,
        conversationId,
        objective,
        docKind: docKindRaw as "docx" | "xlsx",
        inputName,
        inputBuffer,
      };

      // Create the streamer + AbortController BEFORE starting the engine so
      // we can register the session and accept SSE subscriptions immediately.
      const streamer = new StepStreamer();
      const controller = new AbortController();
      const pendingEvents: OfficeRunSession["pendingEvents"] = [];
      streamer.on("step", (step) => {
        pendingEvents.push({ event: "step", data: step });
      });

      const session: OfficeRunSession = {
        runId: "",
        userId,
        streamer,
        controller,
        // result is filled in below
        result: undefined as unknown as Promise<OfficeRunResult>,
        finished: false,
        pendingEvents,
      };

      // The engine notifies us via `onStart(runId)` the moment the DB row
      // exists. We register the session at that point so SSE subscribers
      // (and the response below) can find it.
      const runIdPromise = new Promise<string>((resolve) => {
        runReq.onStart = (runId) => {
          registerOfficeRunSession(runId, session);
          resolve(runId);
        };
      });

      // Start the engine; capture the run promise.
      const resultPromise = officeEngine.run(runReq, streamer, controller.signal);
      session.result = resultPromise;
      resultPromise
        .then((result) => {
          markOfficeRunSessionFinished(result.runId, result.status, result.error?.message);
        })
        .catch((err) => {
          if (session.runId) {
            markOfficeRunSessionFinished(
              session.runId,
              "failed",
              err instanceof Error ? err.message : String(err),
            );
          }
          Logger.warn(`[OfficeEngineRoutes] run failed: ${err instanceof Error ? err.message : err}`);
        });

      // Wait for the runId callback (or for the result to settle if the
      // engine fails before reaching that point). The race is bounded by
      // the engine itself — there's no fixed timeout here.
      const runId = await Promise.race([
        runIdPromise,
        resultPromise.then((r) => r.runId).catch(() => ""),
      ]);
      if (!runId) {
        return res.status(500).json({ error: "Engine failed before assigning a run id" });
      }
      // Race the engine result against a tiny grace window. If the engine
      // already settled (idempotent cache short-circuit) we can surface the
      // final state in the same response. Otherwise we return 202 and the
      // client subscribes to SSE for live progress.
      let idempotent = false;
      let immediateStatus: string | undefined;
      const settled = await Promise.race<OfficeRunResult | null>([
        session.result.then((r) => r).catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 25)),
      ]);
      if (settled) {
        idempotent = settled.idempotent === true;
        immediateStatus = settled.status;
      }
      return res.status(202).json({ runId, idempotent, status: immediateStatus });
    } catch (err) {
      Logger.error("[OfficeEngineRoutes] /runs error:", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/runs/:id", async (req: Request, res: Response) => {
    const run = await getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Run not found" });
    const artifacts = await listArtifacts(req.params.id);
    return res.json({ run, artifacts });
  });

  // Prometheus text-format metrics for the Office Engine.
  router.get("/metrics", async (_req: Request, res: Response) => {
    // Snapshot the worker pool gauges before serializing.
    officeWorkerPool.stats();
    res.setHeader("Content-Type", officeMetricsRegistry.contentType);
    res.send(await renderMetrics());
  });

  // JSON stats convenience (smaller surface for dashboards / health checks).
  router.get("/stats", (_req: Request, res: Response) => {
    const sessionStats = getOfficeRunSessionStats();
    res.json({
      worker_pool: officeWorkerPool.stats(),
      sessions: sessionStats,
      config: {
        require_auth: REQUIRE_AUTH,
        max_concurrent_per_user: MAX_CONCURRENT_PER_USER,
        max_input_bytes: MAX_INPUT_BYTES,
      },
    });
  });

  router.get("/runs/:id/events", async (req: Request, res: Response) => {
    const session = getOfficeRunSession(req.params.id);
    // Live session — bind to the StepStreamer.
    if (session) {
      const stream = initSSEStream(req, res);
      // Replay backlog so late subscribers don't miss the early steps.
      for (const ev of session.pendingEvents) {
        stream.writeEvent(ev.event, ev.data);
      }
      const onStep = (step: unknown) => stream.writeEvent("step", step);
      session.streamer.on("step", onStep);
      if (session.finished) {
        if (session.finalStatus === "failed" && session.finalError) {
          stream.writeEvent("error", { message: session.finalError });
        }
        stream.writeEvent("finished", {
          runId: session.runId,
          status: session.finalStatus ?? "succeeded",
        });
        session.streamer.off("step", onStep);
        stream.close();
      } else {
        session.result
          .then((r) => {
            if (r.status === "failed" && r.error?.message) {
              stream.writeEvent("error", { message: r.error.message });
            }
            stream.writeEvent("finished", { runId: r.runId, status: r.status });
          })
          .catch((err) => stream.writeEvent("error", { message: err instanceof Error ? err.message : String(err) }))
          .finally(() => {
            session.streamer.off("step", onStep);
            stream.close();
          });
      }
      req.on("close", () => {
        session.streamer.off("step", onStep);
      });
      return;
    }

    // No live session — fall back to the DB. This handles two cases:
    //   (a) the request hits the SSE endpoint AFTER the run completed and
    //       its in-memory session was retired (idempotent runs, server
    //       restart, late subscribers).
    //   (b) the run id is bogus → 404.
    const dbRun = await getRun(req.params.id);
    if (!dbRun) {
      return res.status(404).json({ error: "Run not found" });
    }
    const stream = initSSEStream(req, res);
    if (dbRun.status === "succeeded") {
      // Synthesize a single completion event so the client can render the
      // artifact straight away.
      stream.writeEvent("step", {
        id: `synth-${dbRun.id}`,
        type: "completed",
        title: "Documento listo (cache)",
        status: "completed",
        duration: dbRun.durationMs ?? 0,
        artifact: {
          id: "exported",
          name: dbRun.inputName ?? "document.docx",
          type: "docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          downloadUrl: `/api/office-engine/runs/${dbRun.id}/artifacts/exported`,
          previewUrl: `/api/office-engine/runs/${dbRun.id}/artifacts/preview`,
        },
      });
      stream.writeEvent("finished", { runId: dbRun.id, status: "succeeded" });
    } else if (dbRun.status === "failed") {
      stream.writeEvent("error", { message: dbRun.errorMessage ?? "Run failed" });
      stream.writeEvent("finished", { runId: dbRun.id, status: "failed" });
    } else {
      // pending/running/cancelled with no live session — race condition where
      // the in-memory session was already cleaned up. Surface the DB state.
      stream.writeEvent("finished", { runId: dbRun.id, status: dbRun.status });
    }
    stream.close();
  });

  router.get("/runs/:id/artifacts/:kind", async (req: Request, res: Response) => {
    const run = await getRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Run not found" });
    const artifacts = await listArtifacts(req.params.id);
    const a = artifacts.find((x) => x.kind === req.params.kind);
    if (!a) return res.status(404).json({ error: `Artifact kind=${req.params.kind} not found` });
    if (!fs.existsSync(a.path)) {
      return res.status(410).json({ error: "Artifact file no longer available on disk" });
    }
    res.setHeader("Content-Type", a.mimeType);
    res.setHeader("Content-Length", String(a.sizeBytes));
    res.setHeader("X-Office-Engine-Checksum", a.checksumSha256);
    fs.createReadStream(a.path).pipe(res);
  });

  router.post("/runs/:id/cancel", (req: Request, res: Response) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: "Run not found" });
    session.controller.abort();
    return res.json({ cancelled: true });
  });

  router.post("/runs/:id/retry", async (req: Request, res: Response) => {
    const original = await getRun(req.params.id);
    if (!original) return res.status(404).json({ error: "Run not found" });
    return res.status(501).json({
      error: "Retry endpoint deferred — repost the original /runs request with the same input to use idempotency.",
    });
  });

  return router;
}
