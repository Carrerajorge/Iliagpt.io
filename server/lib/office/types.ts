/**
 * Office Engine — shared types used across the pipeline, worker pool, and persistence.
 *
 * These types are the contract between the orchestrator (main thread) and the
 * worker_threads pool. Everything here is pure TypeScript — no side effects,
 * no Node built-ins — so it can be safely imported from both contexts.
 */

import type { StepStreamer } from "../../agent/stepStreamer";
import type { OfficeDocKind, OfficeFallbackLevel, OfficeEngineStage } from "@shared/schema";

export type { OfficeDocKind, OfficeFallbackLevel, OfficeEngineStage } from "@shared/schema";

// ---------------------------------------------------------------------------
// Run context
// ---------------------------------------------------------------------------

export interface OfficeRunContext {
  runId: string;
  userId: string;
  conversationId?: string | null;
  workspaceId?: string | null;
  objective: string;
  docKind: OfficeDocKind;
  sandboxPath: string;
  signal: AbortSignal;
  streamer: StepStreamer;
}

// ---------------------------------------------------------------------------
// Stage result envelope
// ---------------------------------------------------------------------------

export interface StageResult<T> {
  value: T;
  durationMs: number;
  inputDigest?: string;
  outputDigest?: string;
  log?: Array<{ level: "info" | "warn" | "error"; msg: string; data?: unknown }>;
  diff?: unknown;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export type OfficeEngineErrorCode =
  | "UNSUPPORTED_DOC_KIND"
  | "INVALID_INPUT"
  | "UNPACK_FAILED"
  | "PARSE_FAILED"
  | "MAP_FAILED"
  | "EDIT_FAILED"
  | "VALIDATE_FAILED"
  | "REPACK_FAILED"
  | "ROUNDTRIP_DIFF_FAILED"
  | "PREVIEW_FAILED"
  | "EXPORT_FAILED"
  | "WORKER_TIMEOUT"
  | "WORKER_CRASH"
  | "QUEUE_FULL"
  | "CANCELLED"
  | "NOT_IMPLEMENTED";

export class OfficeEngineError extends Error {
  readonly code: OfficeEngineErrorCode;
  readonly stage?: OfficeEngineStage;
  readonly details?: unknown;

  constructor(code: OfficeEngineErrorCode, message: string, opts?: { stage?: OfficeEngineStage; details?: unknown; cause?: unknown }) {
    super(message);
    this.name = "OfficeEngineError";
    this.code = code;
    this.stage = opts?.stage;
    this.details = opts?.details;
    if (opts?.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Worker task envelope
// ---------------------------------------------------------------------------

export type WorkerTaskName =
  | "docx.unpack"
  | "docx.parse"
  | "docx.validate"
  | "docx.repack"
  | "docx.roundtrip_diff"
  | "xlsx.unpack"
  | "xlsx.parse"
  | "xlsx.validate"
  | "xlsx.repack"
  | "xlsx.roundtrip_diff";

export interface WorkerTaskEnvelope<TIn = unknown> {
  taskId: string;
  task: WorkerTaskName;
  payload: TIn;
}

export type WorkerTaskResult<TOut = unknown> =
  | { taskId: string; ok: true; result: TOut }
  | { taskId: string; ok: false; error: { name: string; message: string; stack?: string; code?: string } };

// ---------------------------------------------------------------------------
// Run request / response
// ---------------------------------------------------------------------------

export interface OfficeRunRequest {
  userId: string;
  conversationId?: string | null;
  workspaceId?: string | null;
  objective: string;
  docKind: OfficeDocKind;
  inputName?: string;
  inputBuffer?: Buffer; // optional: a "create from spec" objective has no input file
  /** Called as soon as the engine has assigned a run_id (right after createRun). */
  onStart?: (runId: string) => void;
}

export interface OfficeRunResult {
  runId: string;
  status: "succeeded" | "failed" | "cancelled";
  fallbackLevel: OfficeFallbackLevel;
  durationMs: number;
  /** True when the run was reused via the idempotency cache. */
  idempotent?: boolean;
  artifacts: Array<{
    id: string;
    kind: string;
    path: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
    downloadUrl?: string;
    previewUrl?: string;
  }>;
  error?: { code: OfficeEngineErrorCode; message: string };
}

// ---------------------------------------------------------------------------
// Edit operations (the "intent" applied to a DOCX package)
// ---------------------------------------------------------------------------

export type EditOp =
  | { op: "replaceText"; find: string; replace: string; all?: boolean }
  | { op: "fillPlaceholder"; data: Record<string, unknown> }
  | { op: "setCellText"; tableIndex: number; row: number; col: number; text: string }
  | { op: "appendRow"; tableIndex: number; cells: string[] }
  | { op: "setStyle"; styleId: string; paragraphIndex: number }
  | { op: "insertImage"; paragraphIndex: number; imageBuffer: Buffer; mimeType: string; widthEmu: number; heightEmu: number }
  | { op: "setHyperlink"; paragraphIndex: number; runIndex: number; url: string };

export interface EditResult {
  diff: { added: number; removed: number };
  touchedNodePaths: string[];
  level: OfficeFallbackLevel;
  opResults: Array<{ op: EditOp["op"]; ok: boolean; error?: string }>;
}
