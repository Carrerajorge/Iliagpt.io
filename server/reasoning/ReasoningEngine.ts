/**
 * ReasoningEngine
 *
 * Implements genuine Chain-of-Thought (CoT) reasoning by:
 *
 *   1. Decomposing the problem into steps with an LLM call.
 *   2. Executing each step sequentially (each step can build on the previous).
 *   3. Critiquing each step via a REAL LLM call (jsonMode, structured score).
 *      - Score < CRITIQUE_THRESHOLD (0.70) → re-execute the step (max 2 retries).
 *   4. Synthesising a final answer from the accepted chain.
 *   5. Returning the full ReasoningTrace for transparency.
 *
 * This replaces the existing stub in server/lib/ai/reasoningEngine.ts where
 * critiqueStep() always returned { score: 0.9 }.
 *
 * Uses llmGateway.chat() for all LLM calls — never hardcoded scores.
 */

import { randomUUID }   from 'crypto';
import { z }            from 'zod';
import { Logger }       from '../lib/logger';
import { llmGateway }   from '../lib/llmGateway';

// ─── Constants ────────────────────────────────────────────────────────────────

const CRITIQUE_THRESHOLD  = 0.70;   // Minimum step quality to accept without retry
const MAX_STEP_RETRIES    = 2;       // Maximum re-executions per step
const MAX_DECOMPOSE_STEPS = 8;       // Cap decomposition to avoid runaway chains
const DEFAULT_MODEL       = 'auto';  // Let llmGateway select the best model

// ─── Public schemas ───────────────────────────────────────────────────────────

export const ReasoningStepSchema = z.object({
  index       : z.number().int().nonneg(),
  description : z.string(),
  result      : z.string(),
  critiqueScore: z.number().min(0).max(1),
  critiqueRationale: z.string(),
  retries     : z.number().int().nonneg(),
  durationMs  : z.number().nonneg(),
});
export type ReasoningStep = z.infer<typeof ReasoningStepSchema>;

export const ReasoningTraceSchema = z.object({
  requestId     : z.string(),
  question      : z.string(),
  steps         : z.array(ReasoningStepSchema),
  finalAnswer   : z.string(),
  totalSteps    : z.number().int().nonneg(),
  avgCritiqueScore: z.number().min(0).max(1),
  confidence    : z.number().min(0).max(1),
  totalDurationMs: z.number().nonneg(),
  model         : z.string(),
});
export type ReasoningTrace = z.infer<typeof ReasoningTraceSchema>;

// ─── JSON schemas for structured LLM calls ───────────────────────────────────

/** Expected shape of the decompose-step LLM response. */
interface DecompositionResult {
  steps: Array<{ index: number; description: string }>;
}

/** Expected shape of the critique LLM response. */
interface CritiqueResult {
  score    : number;   // 0.0 – 1.0
  rationale: string;
  issues   : string[];
}

// ─── Helper: JSON extraction ──────────────────────────────────────────────────

function extractJson<T>(raw: string): T | null {
  // Try to extract a JSON object even if the model adds prose around it
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

// ─── Step 1: Decompose ────────────────────────────────────────────────────────

async function decomposeQuestion(
  question: string,
  requestId: string,
  model: string,
): Promise<Array<{ index: number; description: string }>> {
  const systemPrompt = `You are a reasoning assistant.  Break the user's question into a numbered sequence of sub-steps needed to answer it fully.  Respond with JSON only:
{"steps":[{"index":1,"description":"..."},{"index":2,"description":"..."},...]}
Rules:
- Maximum ${MAX_DECOMPOSE_STEPS} steps.
- Each step must be specific and actionable.
- Order steps logically; later steps may depend on earlier ones.`;

  const response = await llmGateway.chat(
    [
      { role: 'system',  content: systemPrompt },
      { role: 'user',    content: `Question: ${question}` },
    ],
    {
      model,
      requestId  : `${requestId}-decompose`,
      temperature: 0.2,
      maxTokens  : 512,
    },
  );

  const parsed = extractJson<DecompositionResult>(response.content);
  if (!parsed?.steps?.length) {
    Logger.warn('[ReasoningEngine] decomposition returned no steps — using single step', { requestId });
    return [{ index: 1, description: question }];
  }

  return parsed.steps.slice(0, MAX_DECOMPOSE_STEPS);
}

// ─── Step 2: Execute a single reasoning step ─────────────────────────────────

async function executeStep(
  question       : string,
  stepDescription: string,
  stepIndex      : number,
  previousResults: string,
  requestId      : string,
  model          : string,
): Promise<string> {
  const systemPrompt = `You are a careful reasoning assistant working through a multi-step problem.
Current step ${stepIndex}: ${stepDescription}
${previousResults ? `Previous steps completed:\n${previousResults}` : ''}
Provide a clear, detailed answer for this specific step only.`;

  const response = await llmGateway.chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: `Original question: ${question}\n\nNow address step ${stepIndex}: ${stepDescription}` },
    ],
    {
      model,
      requestId  : `${requestId}-step-${stepIndex}`,
      temperature: 0.3,
      maxTokens  : 800,
    },
  );

  return response.content;
}

// ─── Step 3: Critique a step result ──────────────────────────────────────────

async function critiqueStep(
  question       : string,
  stepDescription: string,
  stepResult     : string,
  requestId      : string,
  model          : string,
): Promise<CritiqueResult> {
  const systemPrompt = `You are a critical evaluator.  Assess the quality of a single reasoning step.
Respond with JSON only:
{"score":0.85,"rationale":"...","issues":["..."]}
Score rubric:
- 1.0: Perfect — correct, complete, well-reasoned
- 0.8: Good — minor omissions or imprecisions
- 0.7: Acceptable — mostly correct but notable gaps
- 0.5: Weak — significant errors or missing key points
- 0.0–0.4: Unacceptable — wrong or harmful`;

  const response = await llmGateway.chat(
    [
      { role: 'system', content: systemPrompt },
      {
        role   : 'user',
        content: `Original question: ${question}\n\nStep to evaluate: ${stepDescription}\n\nStep result:\n${stepResult}`,
      },
    ],
    {
      model,
      requestId  : `${requestId}-critique`,
      temperature: 0.1,     // Low temperature for consistent evaluation
      maxTokens  : 300,
    },
  );

  const parsed = extractJson<CritiqueResult>(response.content);
  if (!parsed || typeof parsed.score !== 'number') {
    Logger.warn('[ReasoningEngine] critique response malformed — defaulting to 0.6', { requestId });
    return { score: 0.6, rationale: 'Parse error in critique response', issues: [] };
  }

  // Clamp score to [0, 1]
  return {
    score    : Math.max(0, Math.min(1, parsed.score)),
    rationale: parsed.rationale ?? '',
    issues   : parsed.issues    ?? [],
  };
}

// ─── Step 4: Synthesise final answer ─────────────────────────────────────────

async function synthesiseFinalAnswer(
  question   : string,
  chainText  : string,
  requestId  : string,
  model      : string,
): Promise<string> {
  const systemPrompt = `You are a synthesis assistant.  Given a chain of reasoning steps, write a clear, concise final answer to the original question.  Do not repeat the steps — integrate them into a coherent response.`;

  const response = await llmGateway.chat(
    [
      { role: 'system', content: systemPrompt },
      {
        role   : 'user',
        content: `Question: ${question}\n\nReasoning chain:\n${chainText}\n\nFinal answer:`,
      },
    ],
    {
      model,
      requestId  : `${requestId}-synthesis`,
      temperature: 0.4,
      maxTokens  : 1024,
    },
  );

  return response.content;
}

// ─── Main class ───────────────────────────────────────────────────────────────

export interface ReasoningOptions {
  model?     : string;
  requestId? : string;
  userId?    : string;
  /** Override critique threshold (default 0.70). */
  threshold? : number;
}

export class ReasoningEngine {
  /**
   * Run a full Chain-of-Thought reasoning pass on the given question.
   *
   * Each step is critiqued by the LLM with a real quality score.
   * Steps scoring below the threshold are retried up to MAX_STEP_RETRIES times.
   */
  async reason(
    question: string,
    opts    : ReasoningOptions = {},
  ): Promise<ReasoningTrace> {
    const requestId = opts.requestId  ?? randomUUID();
    const model     = opts.model      ?? DEFAULT_MODEL;
    const threshold = opts.threshold  ?? CRITIQUE_THRESHOLD;
    const start     = Date.now();

    Logger.info('[ReasoningEngine] starting CoT reasoning', { requestId, question: question.slice(0, 80) });

    // ── 1. Decompose ────────────────────────────────────────────────────────
    const rawSteps = await decomposeQuestion(question, requestId, model);
    Logger.debug('[ReasoningEngine] decomposed into steps', { requestId, stepCount: rawSteps.length });

    // ── 2. Execute + critique each step ─────────────────────────────────────
    const acceptedSteps: ReasoningStep[] = [];
    let previousResultsText = '';

    for (const rawStep of rawSteps) {
      const stepStart = Date.now();
      let retries     = 0;
      let result      = '';
      let critique: CritiqueResult = { score: 0, rationale: '', issues: [] };

      // Retry loop for this step
      while (retries <= MAX_STEP_RETRIES) {
        result = await executeStep(
          question,
          rawStep.description,
          rawStep.index,
          previousResultsText,
          `${requestId}-r${retries}`,
          model,
        );

        critique = await critiqueStep(
          question,
          rawStep.description,
          result,
          `${requestId}-r${retries}`,
          model,
        );

        Logger.debug('[ReasoningEngine] step critique', {
          requestId,
          step     : rawStep.index,
          score    : critique.score,
          threshold,
          retry    : retries,
        });

        if (critique.score >= threshold) break; // Accepted

        retries++;
        if (retries <= MAX_STEP_RETRIES) {
          Logger.debug('[ReasoningEngine] step below threshold — retrying', {
            requestId, step: rawStep.index, score: critique.score, retry: retries,
          });
        }
      }

      const step: ReasoningStep = {
        index            : rawStep.index,
        description      : rawStep.description,
        result,
        critiqueScore    : critique.score,
        critiqueRationale: critique.rationale,
        retries,
        durationMs       : Date.now() - stepStart,
      };

      acceptedSteps.push(step);
      previousResultsText += `Step ${rawStep.index} (${rawStep.description}):\n${result}\n\n`;
    }

    // ── 3. Synthesise final answer ───────────────────────────────────────────
    const finalAnswer = await synthesiseFinalAnswer(
      question,
      previousResultsText,
      requestId,
      model,
    );

    // ── 4. Compute summary metrics ───────────────────────────────────────────
    const avgCritiqueScore =
      acceptedSteps.length > 0
        ? acceptedSteps.reduce((s, step) => s + step.critiqueScore, 0) / acceptedSteps.length
        : 0;

    // Confidence = average critique score, penalised for each retry
    const totalRetries = acceptedSteps.reduce((s, step) => s + step.retries, 0);
    const confidence   = Math.max(0.1, avgCritiqueScore - totalRetries * 0.05);

    const trace: ReasoningTrace = {
      requestId,
      question,
      steps          : acceptedSteps,
      finalAnswer,
      totalSteps     : acceptedSteps.length,
      avgCritiqueScore: Math.round(avgCritiqueScore * 1000) / 1000,
      confidence     : Math.round(confidence * 1000) / 1000,
      totalDurationMs: Date.now() - start,
      model,
    };

    Logger.info('[ReasoningEngine] CoT completed', {
      requestId,
      steps         : trace.totalSteps,
      avgScore      : trace.avgCritiqueScore,
      confidence    : trace.confidence,
      durationMs    : trace.totalDurationMs,
      totalRetries,
    });

    return trace;
  }

  /**
   * Critique a pre-generated answer without running full CoT.
   * Useful for post-hoc quality checks on direct answers.
   */
  async critiqueAnswer(
    question: string,
    answer  : string,
    opts    : ReasoningOptions = {},
  ): Promise<CritiqueResult> {
    const requestId = opts.requestId ?? randomUUID();
    const model     = opts.model     ?? DEFAULT_MODEL;

    return critiqueStep(question, 'final answer', answer, requestId, model);
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const reasoningEngine = new ReasoningEngine();
