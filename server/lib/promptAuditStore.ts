/**
 * Prompt Audit Store
 *
 * Non-blocking persistence layer for prompt integrity checks,
 * analysis results, and transformation logs.
 *
 * All write operations are fire-and-forget with error logging —
 * they NEVER block the request/response stream.
 */

import { db } from "../db";
import {
  promptIntegrityChecks,
  promptAnalysisResults,
  promptTransformationLog,
} from "@shared/schema/chat";
import { createLogger } from "./productionLogger";
import { sql, desc, eq, and, count, avg } from "drizzle-orm";

const logger = createLogger("PromptAuditStore");

// ── Types ──────────────────────────────────────────────────

export interface IntegrityCheckRecord {
  chatId?: string;
  runId?: string;
  messageRole?: string;
  clientPromptLen?: number;
  clientPromptHash?: string;
  serverPromptLen: number;
  serverPromptHash: string;
  valid: boolean;
  mismatchType?: string;
  lenDelta?: number;
  requestId?: string;
}

export interface AnalysisResultRecord {
  chatId?: string;
  runId?: string;
  requestId?: string;
  confidence?: number;
  needsClarification?: boolean;
  clarificationQuestions?: string[];
  extractedSpec?: unknown;
  policyViolations?: unknown;
  contradictions?: unknown;
  usedLLM?: boolean;
  processingTimeMs?: number;
}

export interface TransformationRecord {
  chatId?: string;
  runId?: string;
  requestId?: string;
  stage: "intake" | "normalize" | "truncate" | "compress" | "enrich";
  inputTokens?: number;
  outputTokens?: number;
  droppedMessages?: number;
  droppedChars?: number;
  transformationDetails?: unknown;
}

export interface AuditStats {
  totalChecks: number;
  failedChecks: number;
  avgConfidence: number;
  avgCompressionRatio: number;
  topMismatchTypes: Array<{ type: string; count: number }>;
  recentFailures: Array<{
    id: string;
    chatId: string | null;
    mismatchType: string | null;
    lenDelta: number | null;
    createdAt: Date;
  }>;
}

// ── Fire-and-forget wrapper ────────────────────────────────

function fireAndForget(fn: () => Promise<unknown>, label: string): void {
  fn().catch((err) => {
    logger.error(`${label} failed (non-blocking)`, {
      error: err?.message || String(err),
    });
  });
}

// ── Public API ─────────────────────────────────────────────

class PromptAuditStore {
  /** Save an integrity check result. Non-blocking. */
  saveIntegrityCheck(data: IntegrityCheckRecord): void {
    fireAndForget(async () => {
      await db.insert(promptIntegrityChecks).values({
        chatId: data.chatId,
        runId: data.runId,
        messageRole: data.messageRole,
        clientPromptLen: data.clientPromptLen,
        clientPromptHash: data.clientPromptHash,
        serverPromptLen: data.serverPromptLen,
        serverPromptHash: data.serverPromptHash,
        valid: data.valid,
        mismatchType: data.mismatchType,
        lenDelta: data.lenDelta,
        requestId: data.requestId,
      });
    }, "saveIntegrityCheck");
  }

  /** Save a prompt analysis result. Non-blocking. */
  saveAnalysisResult(data: AnalysisResultRecord): void {
    fireAndForget(async () => {
      await db.insert(promptAnalysisResults).values({
        chatId: data.chatId,
        runId: data.runId,
        requestId: data.requestId,
        confidence: data.confidence != null ? Math.round(data.confidence * 100) : undefined,
        needsClarification: data.needsClarification,
        clarificationQuestions: data.clarificationQuestions,
        extractedSpec: data.extractedSpec,
        policyViolations: data.policyViolations,
        contradictions: data.contradictions,
        usedLLM: data.usedLLM,
        processingTimeMs: data.processingTimeMs,
      });
    }, "saveAnalysisResult");
  }

  /** Log a transformation stage. Non-blocking. */
  logTransformation(data: TransformationRecord): void {
    fireAndForget(async () => {
      await db.insert(promptTransformationLog).values({
        chatId: data.chatId,
        runId: data.runId,
        requestId: data.requestId,
        stage: data.stage,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        droppedMessages: data.droppedMessages,
        droppedChars: data.droppedChars,
        transformationDetails: data.transformationDetails,
      });
    }, "logTransformation");
  }

  /** Batch save multiple integrity checks. Non-blocking. */
  saveIntegrityCheckBatch(records: IntegrityCheckRecord[]): void {
    if (records.length === 0) return;
    fireAndForget(async () => {
      await db.insert(promptIntegrityChecks).values(
        records.map((d) => ({
          chatId: d.chatId,
          runId: d.runId,
          messageRole: d.messageRole,
          clientPromptLen: d.clientPromptLen,
          clientPromptHash: d.clientPromptHash,
          serverPromptLen: d.serverPromptLen,
          serverPromptHash: d.serverPromptHash,
          valid: d.valid,
          mismatchType: d.mismatchType,
          lenDelta: d.lenDelta,
          requestId: d.requestId,
        })),
      );
    }, "saveIntegrityCheckBatch");
  }

  /** Get aggregated audit stats for admin endpoint. */
  async getStats(): Promise<AuditStats> {
    try {
      // Total and failed checks
      const [checkStats] = await db
        .select({
          total: count(),
          failed: count(sql`CASE WHEN ${promptIntegrityChecks.valid} = false THEN 1 END`),
        })
        .from(promptIntegrityChecks);

      // Avg confidence from analysis
      const [analysisStats] = await db
        .select({
          avgConfidence: avg(promptAnalysisResults.confidence),
        })
        .from(promptAnalysisResults);

      // Avg compression ratio from truncation transformations
      const [compressionStats] = await db
        .select({
          avgRatio: sql<number>`AVG(CASE WHEN ${promptTransformationLog.inputTokens} > 0 THEN ${promptTransformationLog.outputTokens}::float / ${promptTransformationLog.inputTokens}::float END)`,
        })
        .from(promptTransformationLog)
        .where(eq(promptTransformationLog.stage, "truncate"));

      // Top mismatch types
      const mismatchTypes = await db
        .select({
          type: promptIntegrityChecks.mismatchType,
          count: count(),
        })
        .from(promptIntegrityChecks)
        .where(sql`${promptIntegrityChecks.mismatchType} IS NOT NULL`)
        .groupBy(promptIntegrityChecks.mismatchType)
        .orderBy(desc(count()))
        .limit(5);

      // Recent failures
      const recentFailures = await db
        .select({
          id: promptIntegrityChecks.id,
          chatId: promptIntegrityChecks.chatId,
          mismatchType: promptIntegrityChecks.mismatchType,
          lenDelta: promptIntegrityChecks.lenDelta,
          createdAt: promptIntegrityChecks.createdAt,
        })
        .from(promptIntegrityChecks)
        .where(eq(promptIntegrityChecks.valid, false))
        .orderBy(desc(promptIntegrityChecks.createdAt))
        .limit(10);

      return {
        totalChecks: checkStats?.total || 0,
        failedChecks: checkStats?.failed || 0,
        avgConfidence: Number(analysisStats?.avgConfidence || 0),
        avgCompressionRatio: Number(compressionStats?.avgRatio || 1),
        topMismatchTypes: mismatchTypes.map((m) => ({
          type: m.type || "unknown",
          count: m.count,
        })),
        recentFailures,
      };
    } catch (err: any) {
      logger.error("getStats failed", { error: err?.message });
      return {
        totalChecks: 0,
        failedChecks: 0,
        avgConfidence: 0,
        avgCompressionRatio: 1,
        topMismatchTypes: [],
        recentFailures: [],
      };
    }
  }
}

export const promptAuditStore = new PromptAuditStore();
