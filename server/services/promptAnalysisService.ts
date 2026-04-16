/**
 * Prompt Analysis Service
 *
 * Provides sync (heuristic) and async (BullMQ + LLM) prompt analysis.
 *
 * - analyzeSync(): Fast heuristic analysis via processSync() (< 5ms)
 * - analyzeAsync(): Enqueues BullMQ job for full LLM-powered analysis
 * - getResult(): Retrieves completed analysis from Redis cache
 *
 * Results are cached in Redis for 5 minutes by prompt hash.
 */

import * as crypto from "crypto";
import { createQueue, createWorker, QUEUE_NAMES } from "../lib/queueFactory";
import { redis } from "../lib/redis";
import { createLogger } from "../lib/productionLogger";
import { promptAuditStore } from "../lib/promptAuditStore";

const logger = createLogger("PromptAnalysisService");

const CACHE_PREFIX = "prompt:analysis:";
const CACHE_TTL_SECONDS = 300; // 5 minutes

// ── Types ──────────────────────────────────────────────────

interface AnalysisJobData {
  chatId?: string;
  runId?: string;
  requestId: string;
  text: string;
  useLLM: boolean;
}

interface AnalysisResult {
  requestId: string;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestions: string[];
  spec: {
    goal: string;
    tasks: unknown[];
    constraints: unknown[];
  };
  usedLLM: boolean;
  processingTimeMs: number;
  cached: boolean;
}

// ── Service Class ──────────────────────────────────────────

class PromptAnalysisService {
  private queue = createQueue<AnalysisJobData>(QUEUE_NAMES.PROMPT_ANALYSIS);
  private workerStarted = false;

  constructor() {
    this.startWorker();
  }

  /** Fast sync analysis using heuristics only (< 5ms). */
  analyzeSync(text: string): AnalysisResult {
    const startTime = Date.now();
    try {
      // Dynamic import to avoid circular deps
      const { PromptUnderstanding } = require("../agent/promptUnderstanding");
      const pu = new PromptUnderstanding();
      const result = pu.processSync(text);

      return {
        requestId: result.requestId,
        confidence: result.confidence,
        needsClarification: result.needsClarification,
        clarificationQuestions: result.clarificationQuestions,
        spec: {
          goal: result.spec.goal,
          tasks: result.spec.tasks,
          constraints: result.spec.constraints,
        },
        usedLLM: false,
        processingTimeMs: Date.now() - startTime,
        cached: false,
      };
    } catch (err: any) {
      logger.error("analyzeSync failed", { error: err?.message });
      return this.emptyResult("sync-error", Date.now() - startTime);
    }
  }

  /** Enqueue async LLM-powered analysis. Returns jobId. */
  async analyzeAsync(
    text: string,
    chatId?: string,
    runId?: string,
    requestId?: string,
  ): Promise<{ jobId: string | null; cached: boolean; result?: AnalysisResult }> {
    const hash = this.textHash(text);
    const rid = requestId || crypto.randomUUID();

    // Check Redis cache first
    try {
      const cached = await this.getCachedResult(hash);
      if (cached) {
        return { jobId: null, cached: true, result: { ...cached, requestId: rid, cached: true } };
      }
    } catch {
      // Cache miss or Redis unavailable — proceed with queue
    }

    if (!this.queue) {
      // Queue unavailable — fall back to sync
      const syncResult = this.analyzeSync(text);
      return { jobId: null, cached: false, result: syncResult };
    }

    const job = await this.queue.add("analyze", {
      chatId,
      runId,
      requestId: rid,
      text,
      useLLM: true,
    }, {
      jobId: `analysis-${hash}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 1000 },
    });

    return { jobId: job.id || null, cached: false };
  }

  /** Get result from cache or completed job. */
  async getResult(textOrHash: string): Promise<AnalysisResult | null> {
    const hash = textOrHash.length === 32 ? textOrHash : this.textHash(textOrHash);
    return this.getCachedResult(hash);
  }

  // ── Private ────────────────────────────────────────────

  private startWorker(): void {
    if (this.workerStarted) return;
    this.workerStarted = true;

    const worker = createWorker<AnalysisJobData, AnalysisResult>(
      QUEUE_NAMES.PROMPT_ANALYSIS,
      async (job) => {
        const { text, chatId, runId, requestId, useLLM } = job.data;
        const startTime = Date.now();

        try {
          const { PromptUnderstanding } = require("../agent/promptUnderstanding");
          const pu = new PromptUnderstanding();

          const result = useLLM
            ? await pu.processFullPrompt(text, { useLLM: true })
            : pu.processSync(text);

          const analysisResult: AnalysisResult = {
            requestId,
            confidence: result.confidence,
            needsClarification: result.needsClarification,
            clarificationQuestions: result.clarificationQuestions,
            spec: {
              goal: result.spec.goal,
              tasks: result.spec.tasks,
              constraints: result.spec.constraints,
            },
            usedLLM: result.usedLLM,
            processingTimeMs: Date.now() - startTime,
            cached: false,
          };

          // Cache in Redis
          const hash = this.textHash(text);
          await this.cacheResult(hash, analysisResult);

          // Persist to audit trail
          promptAuditStore.saveAnalysisResult({
            chatId,
            runId,
            requestId,
            confidence: result.confidence,
            needsClarification: result.needsClarification,
            clarificationQuestions: result.clarificationQuestions,
            extractedSpec: result.spec,
            policyViolations: result.policyViolations,
            contradictions: result.contradictions,
            usedLLM: result.usedLLM,
            processingTimeMs: analysisResult.processingTimeMs,
          });

          return analysisResult;
        } catch (err: any) {
          logger.error("Analysis worker job failed", {
            jobId: job.id,
            requestId,
            error: err?.message,
          });
          throw err;
        }
      },
    );

    if (worker) {
      worker.on("failed", (job, err) => {
        logger.warn("Analysis job failed", {
          jobId: job?.id,
          error: err?.message,
        });
      });
    }
  }

  private textHash(text: string): string {
    return crypto.createHash("md5").update(text).digest("hex");
  }

  private async getCachedResult(hash: string): Promise<AnalysisResult | null> {
    try {
      const raw = await redis.get(`${CACHE_PREFIX}${hash}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private async cacheResult(hash: string, result: AnalysisResult): Promise<void> {
    try {
      await redis.setex(`${CACHE_PREFIX}${hash}`, CACHE_TTL_SECONDS, JSON.stringify(result));
    } catch {
      // Cache write failure is non-critical
    }
  }

  private emptyResult(requestId: string, processingTimeMs: number): AnalysisResult {
    return {
      requestId,
      confidence: 0,
      needsClarification: false,
      clarificationQuestions: [],
      spec: { goal: "", tasks: [], constraints: [] },
      usedLLM: false,
      processingTimeMs,
      cached: false,
    };
  }
}

export const promptAnalysisService = new PromptAnalysisService();
