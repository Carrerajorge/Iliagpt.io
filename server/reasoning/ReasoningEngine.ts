/**
 * ReasoningEngine — Batch 1 Reasoning Overhaul
 *
 * REPLACES server/lib/ai/reasoningEngine.ts (stub).
 *
 * Real chain-of-thought with actual LLM self-critique:
 *  - solveWithCoT: plan → execute each step → critique each step → synthesize
 *  - critiqueStep: real LLM call that evaluates logical correctness,
 *    factual accuracy, and completeness. Returns score 0-1 with detailed critique.
 *  - Step retry: up to MAX_STEP_RETRIES per step when critique score < 0.7
 *  - Reasoning modes: analytical, creative, mathematical, coding
 *  - Full trace with timestamps and token counts
 */

import { createLogger } from "../utils/logger";
import { llmGateway } from "../lib/llmGateway";

const log = createLogger("ReasoningEngine");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReasoningMode = "analytical" | "creative" | "mathematical" | "coding";

export interface ReasoningStep {
  id: number;
  instruction: string;
  result: string;
  critiqueScore: number;         // 0–1
  critiqueReason: string;
  retryCount: number;
  startedAt: number;
  durationMs: number;
  tokenCount: number;
}

export interface ReasoningTrace {
  taskId: string;
  mode: ReasoningMode;
  task: string;
  steps: ReasoningStep[];
  finalAnswer: string;
  overallConfidence: number;     // average critique score across steps
  totalDurationMs: number;
  totalTokenCount: number;
  warnings: string[];            // steps that exceeded retry limit, etc.
}

export interface CritiqueResult {
  score: number;                 // 0–1
  reason: string;
  suggestions: string;           // actionable improvements for the re-attempt
  factualIssues: string[];
  logicIssues: string[];
  completenessIssues: string[];
}

export interface ReasoningConfig {
  maxStepsPerTask: number;
  maxStepRetries: number;
  critiquePasingThreshold: number;   // score below this triggers retry
  planningModel: string;
  executionModel: string;
  critiqueModel: string;
  synthesisModel: string;
  timeoutMs: number;
}

// ─── Mode-Specific Prompts ────────────────────────────────────────────────────

const MODE_INSTRUCTIONS: Record<ReasoningMode, string> = {
  analytical:
    "Approach this analytically: identify assumptions, decompose into sub-problems, " +
    "evaluate evidence, and draw justified conclusions.",
  creative:
    "Approach this creatively: explore unusual angles, generate diverse ideas, " +
    "and synthesize a novel solution rather than defaulting to the obvious.",
  mathematical:
    "Approach this mathematically: state known values and unknowns, apply relevant " +
    "formulas or theorems step by step, verify each result, and present a clean solution.",
  coding:
    "Approach this as a software engineer: consider edge cases, choose appropriate " +
    "data structures and algorithms, write clean maintainable code, and verify correctness.",
};

const PLAN_SYSTEM_PROMPT = `You are a precise task decomposition engine.
Given a task, return a JSON array of sequential steps to solve it.
Each step must be a specific, actionable instruction (one sentence).
Return ONLY the JSON array, no other text.
Example: ["Identify the variables", "Apply the formula", "Verify the result"]`;

const SYNTHESIS_SYSTEM_PROMPT = `You are a precise synthesizer.
Given reasoning steps and their results, produce a clear, complete final answer.
The answer should directly address the original task.
Do not repeat the steps — just give the synthesized conclusion.`;

const CRITIQUE_SYSTEM_PROMPT = `You are a rigorous critic evaluating a reasoning step.
Evaluate the result against the instruction on:
1. Logical correctness (0–10)
2. Factual accuracy (0–10)
3. Completeness (0–10)

Return a JSON object with exactly these fields:
{
  "score": <0.0-1.0 overall>,
  "reason": "<one sentence summary>",
  "suggestions": "<how to improve if score < 0.7>",
  "factualIssues": ["<issue1>", ...],
  "logicIssues": ["<issue1>", ...],
  "completenessIssues": ["<issue1>", ...]
}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePlan(raw: string): string[] {
  try {
    const cleaned = raw.trim();
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr) && arr.every(s => typeof s === "string")) {
      return arr.slice(0, 8); // cap at 8 steps
    }
  } catch {
    // fallback: extract lines that look like steps
    const lines = raw
      .split("\n")
      .map(l => l.replace(/^\d+[\.\)]\s*/, "").trim())
      .filter(l => l.length > 5);
    if (lines.length > 0) return lines.slice(0, 8);
  }
  return ["Analyse the request", "Formulate a solution", "Verify the solution"];
}

function parseCritique(raw: string): CritiqueResult {
  try {
    const cleaned = raw.trim();
    const obj = JSON.parse(cleaned);
    return {
      score: Math.min(1, Math.max(0, Number(obj.score) || 0.7)),
      reason: String(obj.reason || ""),
      suggestions: String(obj.suggestions || ""),
      factualIssues: Array.isArray(obj.factualIssues) ? obj.factualIssues : [],
      logicIssues: Array.isArray(obj.logicIssues) ? obj.logicIssues : [],
      completenessIssues: Array.isArray(obj.completenessIssues) ? obj.completenessIssues : [],
    };
  } catch {
    return {
      score: 0.75,
      reason: "Could not parse critique; proceeding with default confidence.",
      suggestions: "",
      factualIssues: [],
      logicIssues: [],
      completenessIssues: [],
    };
  }
}

// ─── ReasoningEngine ──────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ReasoningConfig = {
  maxStepsPerTask: 6,
  maxStepRetries: 2,
  critiquePasingThreshold: 0.70,
  planningModel: "gemini-2.5-flash",
  executionModel: "gemini-3.1-pro",
  critiqueModel: "gemini-2.5-flash",
  synthesisModel: "gemini-3.1-pro",
  timeoutMs: 120_000,
};

export class ReasoningEngine {
  private config: ReasoningConfig;

  constructor(config: Partial<ReasoningConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Solve a task using real chain-of-thought.
   * Generates a plan, executes each step, critiques, retries if needed,
   * and synthesises a final answer.
   */
  async solveWithCoT(
    task: string,
    context: Record<string, unknown> = {},
    mode: ReasoningMode = "analytical",
  ): Promise<ReasoningTrace> {
    const taskId = `cot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const start = Date.now();
    const warnings: string[] = [];
    let totalTokens = 0;

    log.info("cot_started", { taskId, mode, taskLength: task.length });

    // ── Step 1: Generate plan ───────────────────────────────────────────────
    const planResponse = await llmGateway.chat(
      [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Mode: ${mode}\nInstructions: ${MODE_INSTRUCTIONS[mode]}\n\nTask: ${task}`,
        },
      ],
      {
        model: this.config.planningModel,
        temperature: 0.3,
        timeout: this.config.timeoutMs / 4,
      },
    );

    const plan = parsePlan(planResponse.content).slice(0, this.config.maxStepsPerTask);
    totalTokens += planResponse.usage?.totalTokens ?? 0;

    log.info("cot_plan_generated", { taskId, stepCount: plan.length, steps: plan });

    // ── Step 2: Execute and critique each step ───────────────────────────────
    const steps: ReasoningStep[] = [];
    let accumulatedContext = `Task: ${task}\n\nContext: ${JSON.stringify(context)}`;

    for (let i = 0; i < plan.length; i++) {
      const instruction = plan[i];
      const stepId = i + 1;
      const stepStart = Date.now();
      let retryCount = 0;
      let stepResult = "";
      let critiqueResult: CritiqueResult = {
        score: 0,
        reason: "",
        suggestions: "",
        factualIssues: [],
        logicIssues: [],
        completenessIssues: [],
      };

      log.debug("cot_step_started", { taskId, stepId, instruction });

      // Retry loop
      while (retryCount <= this.config.maxStepRetries) {
        const retryContext = retryCount > 0
          ? `\n\nPrevious attempt failed critique. Issues:\n${critiqueResult.suggestions}\nFactual: ${critiqueResult.factualIssues.join(", ")}\nLogic: ${critiqueResult.logicIssues.join(", ")}`
          : "";

        // Execute step
        const stepResponse = await llmGateway.chat(
          [
            {
              role: "system",
              content:
                `You are a precise reasoning engine operating in ${mode} mode. ` +
                `${MODE_INSTRUCTIONS[mode]} ` +
                "Execute ONLY the current step. Output only the result of this step, concisely.",
            },
            {
              role: "user",
              content: `${accumulatedContext}\n\nCurrent Step ${stepId}/${plan.length}: ${instruction}${retryContext}`,
            },
          ],
          {
            model: this.config.executionModel,
            temperature: mode === "creative" ? 0.7 : 0.3,
            timeout: this.config.timeoutMs / plan.length,
          },
        );

        stepResult = stepResponse.content;
        totalTokens += stepResponse.usage?.totalTokens ?? 0;

        // Critique the step
        critiqueResult = await this.critiqueStep(instruction, stepResult);
        totalTokens += Math.ceil((instruction.length + stepResult.length) / 4) * 2;

        log.debug("cot_step_critiqued", {
          taskId,
          stepId,
          critiqueScore: critiqueResult.score,
          retryCount,
        });

        if (critiqueResult.score >= this.config.critiquePasingThreshold) {
          break; // Step passed critique
        }

        if (retryCount >= this.config.maxStepRetries) {
          warnings.push(
            `Step ${stepId} "${instruction.slice(0, 40)}" exceeded max retries. ` +
            `Final score: ${critiqueResult.score.toFixed(2)}`,
          );
          break;
        }

        retryCount++;
        log.warn("cot_step_retry", {
          taskId,
          stepId,
          retryCount,
          critiqueScore: critiqueResult.score,
          reason: critiqueResult.reason,
        });
      }

      const stepRecord: ReasoningStep = {
        id: stepId,
        instruction,
        result: stepResult,
        critiqueScore: critiqueResult.score,
        critiqueReason: critiqueResult.reason,
        retryCount,
        startedAt: stepStart,
        durationMs: Date.now() - stepStart,
        tokenCount: Math.ceil(stepResult.length / 4),
      };

      steps.push(stepRecord);
      accumulatedContext += `\n\nStep ${stepId} (${instruction}): ${stepResult}`;
    }

    // ── Step 3: Synthesise final answer ──────────────────────────────────────
    const stepSummary = steps
      .map(s => `Step ${s.id}: ${s.instruction}\nResult: ${s.result}`)
      .join("\n\n");

    const synthesisResponse = await llmGateway.chat(
      [
        { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Original Task: ${task}\n\nMode: ${mode}\n\nReasoning Steps:\n${stepSummary}\n\nFinal Answer:`,
        },
      ],
      {
        model: this.config.synthesisModel,
        temperature: 0.4,
        timeout: this.config.timeoutMs / 4,
      },
    );

    totalTokens += synthesisResponse.usage?.totalTokens ?? 0;

    const overallConfidence =
      steps.length > 0
        ? steps.reduce((s, step) => s + step.critiqueScore, 0) / steps.length
        : 0.7;

    const trace: ReasoningTrace = {
      taskId,
      mode,
      task,
      steps,
      finalAnswer: synthesisResponse.content,
      overallConfidence,
      totalDurationMs: Date.now() - start,
      totalTokenCount: totalTokens,
      warnings,
    };

    log.info("cot_completed", {
      taskId,
      stepCount: steps.length,
      overallConfidence: overallConfidence.toFixed(2),
      totalDurationMs: trace.totalDurationMs,
      totalTokenCount: totalTokens,
      warnings: warnings.length,
    });

    return trace;
  }

  /**
   * Real LLM call that evaluates a reasoning step.
   * Returns a detailed critique with score 0-1.
   */
  async critiqueStep(instruction: string, result: string): Promise<CritiqueResult> {
    const critiqueResponse = await llmGateway.chat(
      [
        { role: "system", content: CRITIQUE_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Instruction: ${instruction}\n\nResult to evaluate:\n${result}\n\n` +
            "Return your critique as JSON.",
        },
      ],
      {
        model: this.config.critiqueModel,
        temperature: 0.1,  // low temperature for consistent evaluation
        timeout: 20_000,
      },
    );

    return parseCritique(critiqueResponse.content);
  }

  /**
   * Lightweight single-step reasoning — no plan/critique loop.
   * Useful for simple analytical tasks that don't warrant full CoT.
   */
  async reason(
    prompt: string,
    mode: ReasoningMode = "analytical",
  ): Promise<{ answer: string; confidence: number; tokenCount: number }> {
    const response = await llmGateway.chat(
      [
        {
          role: "system",
          content:
            `You are a precise reasoning assistant. ${MODE_INSTRUCTIONS[mode]} ` +
            "Think step by step, then provide your answer.",
        },
        { role: "user", content: prompt },
      ],
      {
        model: this.config.executionModel,
        temperature: mode === "creative" ? 0.7 : 0.4,
        timeout: 30_000,
      },
    );

    return {
      answer: response.content,
      confidence: 0.8, // single-step has no critique
      tokenCount: response.usage?.totalTokens ?? Math.ceil(response.content.length / 4),
    };
  }
}

export const reasoningEngine = new ReasoningEngine();
