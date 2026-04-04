/**
 * SelfReflectionLoop
 *
 * Post-generation self-critique and improvement pass.  After the main
 * response has been generated, the SelfReflectionLoop:
 *
 *   1. Asks the LLM: "Did you fully answer the question?"
 *   2. Asks: "Are there factual errors or unsupported claims?"
 *   3. Asks: "Is any important context missing?"
 *   4. If any check returns improvement suggestions, optionally generates
 *      an improved response.
 *   5. Suggests follow-up questions the user might want to ask.
 *
 * Each reflection call is a real LLM call.  The loop runs at most
 * MAX_REFLECTION_ROUNDS rounds to avoid infinite self-correction spirals.
 *
 * The result includes:
 *   - The (possibly improved) response
 *   - A reflection report with all issues found
 *   - Suggested follow-up questions
 */

import { randomUUID }   from 'crypto';
import { z }            from 'zod';
import { Logger }       from '../lib/logger';
import { llmGateway }   from '../lib/llmGateway';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_REFLECTION_ROUNDS   = 2;
const IMPROVEMENT_THRESHOLD   = 0.7;  // reflectionScore < this triggers improvement
const DEFAULT_MODEL           = 'auto';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const ReflectionCheckSchema = z.object({
  dimension : z.enum(['completeness', 'accuracy', 'context']),
  score     : z.number().min(0).max(1),
  issues    : z.array(z.string()),
  suggestion: z.string(),
});
export type ReflectionCheck = z.infer<typeof ReflectionCheckSchema>;

export const SelfReflectionResultSchema = z.object({
  requestId          : z.string(),
  originalResponse   : z.string(),
  improvedResponse   : z.string().optional(),
  wasImproved        : z.boolean(),
  reflectionScore    : z.number().min(0).max(1),
  checks             : z.array(ReflectionCheckSchema),
  followUpQuestions  : z.array(z.string()),
  roundsCompleted    : z.number().int().nonneg(),
  durationMs         : z.number().nonneg(),
});
export type SelfReflectionResult = z.infer<typeof SelfReflectionResultSchema>;

// ─── JSON extraction ──────────────────────────────────────────────────────────

function extractJson<T>(raw: string): T | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

// ─── Reflection prompts ───────────────────────────────────────────────────────

interface CompletenessCheck { score: number; issues: string[]; suggestion: string }
interface AccuracyCheck     { score: number; issues: string[]; suggestion: string }
interface ContextCheck      { score: number; issues: string[]; suggestion: string }

async function checkCompleteness(
  question: string,
  response: string,
  requestId: string,
  model: string,
): Promise<CompletenessCheck> {
  const res = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: `You are a completeness evaluator.  Given a question and an answer, determine whether the answer fully addresses all aspects of the question.
Return JSON: {"score":0.85,"issues":["..."],"suggestion":"..."}
- score 1.0: perfectly complete
- score 0.7: mostly complete, minor gaps
- score 0.4: significant parts unanswered
- score 0.0: does not answer the question`,
      },
      { role: 'user', content: `Question: ${question}\n\nAnswer:\n${response}` },
    ],
    { model, requestId: `${requestId}-complete`, temperature: 0.1, maxTokens: 300 },
  );

  const parsed = extractJson<CompletenessCheck>(res.content);
  return parsed ?? { score: 0.7, issues: [], suggestion: '' };
}

async function checkAccuracy(
  question: string,
  response: string,
  requestId: string,
  model: string,
): Promise<AccuracyCheck> {
  const res = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: `You are a factual accuracy evaluator.  Check the answer for factual errors, unsupported claims, or misleading statements.
Return JSON: {"score":0.90,"issues":["..."],"suggestion":"..."}
- score 1.0: fully accurate
- score 0.8: minor imprecisions
- score 0.5: notable factual errors
- score 0.0: severely incorrect`,
      },
      { role: 'user', content: `Question: ${question}\n\nAnswer:\n${response}` },
    ],
    { model, requestId: `${requestId}-accuracy`, temperature: 0.1, maxTokens: 300 },
  );

  const parsed = extractJson<AccuracyCheck>(res.content);
  return parsed ?? { score: 0.75, issues: [], suggestion: '' };
}

async function checkMissingContext(
  question: string,
  response: string,
  requestId: string,
  model: string,
): Promise<ContextCheck> {
  const res = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: `You are a context evaluator.  Identify important context, caveats, or related information that would significantly improve the answer.
Return JSON: {"score":0.80,"issues":["..."],"suggestion":"..."}
- score 1.0: no missing context
- score 0.7: a few useful additions
- score 0.4: important context missing
- score 0.0: critical context absent`,
      },
      { role: 'user', content: `Question: ${question}\n\nAnswer:\n${response}` },
    ],
    { model, requestId: `${requestId}-context`, temperature: 0.2, maxTokens: 300 },
  );

  const parsed = extractJson<ContextCheck>(res.content);
  return parsed ?? { score: 0.8, issues: [], suggestion: '' };
}

async function generateImprovedResponse(
  question      : string,
  originalResponse: string,
  issues        : string[],
  requestId     : string,
  model         : string,
): Promise<string> {
  const issuesList = issues.map((i, n) => `${n + 1}. ${i}`).join('\n');

  const res = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: `You are an answer improvement assistant.  Rewrite the provided answer to fix the identified issues while preserving everything that was already correct.  Do not add unnecessary length.`,
      },
      {
        role   : 'user',
        content: `Original question: ${question}\n\nOriginal answer:\n${originalResponse}\n\nIssues to fix:\n${issuesList}\n\nImproved answer:`,
      },
    ],
    { model, requestId: `${requestId}-improve`, temperature: 0.3, maxTokens: 1200 },
  );

  return res.content;
}

async function generateFollowUps(
  question : string,
  response : string,
  requestId: string,
  model    : string,
): Promise<string[]> {
  const res = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: 'Generate 3 concise follow-up questions the user is likely to ask next, based on the answer given.  Return JSON: {"questions":["?","?","?"]}',
      },
      { role: 'user', content: `Question: ${question}\nAnswer: ${response.slice(0, 500)}` },
    ],
    { model, requestId: `${requestId}-followups`, temperature: 0.6, maxTokens: 200 },
  );

  try {
    const match   = res.content.match(/\{[\s\S]*\}/);
    const parsed  = match ? JSON.parse(match[0]) as { questions: string[] } : null;
    return parsed?.questions?.slice(0, 3) ?? [];
  } catch {
    return [];
  }
}

// ─── Main class ───────────────────────────────────────────────────────────────

export interface SelfReflectionOptions {
  model?           : string;
  requestId?       : string;
  /** If true, automatically generate an improved response when issues found. */
  autoImprove?     : boolean;
  /** If true, generate follow-up question suggestions. */
  suggestFollowUps?: boolean;
  /** Override the improvement trigger threshold (default 0.7). */
  improvementThreshold?: number;
}

export class SelfReflectionLoop {
  /**
   * Run self-reflection on a completed response.
   *
   * @param question  - The original user question
   * @param response  - The LLM-generated response to evaluate
   * @param opts      - Configuration options
   */
  async reflect(
    question: string,
    response: string,
    opts    : SelfReflectionOptions = {},
  ): Promise<SelfReflectionResult> {
    const requestId   = opts.requestId    ?? randomUUID();
    const model       = opts.model        ?? DEFAULT_MODEL;
    const autoImprove = opts.autoImprove  ?? true;
    const threshold   = opts.improvementThreshold ?? IMPROVEMENT_THRESHOLD;
    const start       = Date.now();

    Logger.debug('[SelfReflectionLoop] starting reflection', {
      requestId, questionLen: question.length, responseLen: response.length,
    });

    let currentResponse = response;
    const allChecks    : ReflectionCheck[] = [];
    let roundsCompleted = 0;
    let wasImproved     = false;

    for (let round = 0; round < MAX_REFLECTION_ROUNDS; round++) {
      roundsCompleted = round + 1;

      // ── Run the three reflection checks in parallel ──────────────────────
      const [completeness, accuracy, context] = await Promise.all([
        checkCompleteness(question, currentResponse, `${requestId}-r${round}`, model),
        checkAccuracy    (question, currentResponse, `${requestId}-r${round}`, model),
        checkMissingContext(question, currentResponse, `${requestId}-r${round}`, model),
      ]);

      const roundChecks: ReflectionCheck[] = [
        { dimension: 'completeness', ...completeness },
        { dimension: 'accuracy',     ...accuracy },
        { dimension: 'context',      ...context  },
      ];
      allChecks.push(...roundChecks);

      const roundScore =
        (completeness.score + accuracy.score + context.score) / 3;

      Logger.debug('[SelfReflectionLoop] reflection round complete', {
        requestId, round, roundScore: Math.round(roundScore * 100) / 100,
        completeness: completeness.score, accuracy: accuracy.score, context: context.score,
      });

      // ── Decide whether to improve ────────────────────────────────────────
      if (roundScore < threshold && autoImprove) {
        const allIssues = roundChecks.flatMap(c => c.issues).filter(Boolean);
        if (allIssues.length > 0) {
          Logger.debug('[SelfReflectionLoop] score below threshold — improving', {
            requestId, round, roundScore, issues: allIssues.length,
          });
          currentResponse = await generateImprovedResponse(
            question, currentResponse, allIssues, `${requestId}-r${round}`, model,
          );
          wasImproved = true;
        }
      } else {
        // Score acceptable — no further rounds needed
        break;
      }
    }

    // ── Compute final composite score ────────────────────────────────────────
    const latestChecks = allChecks.slice(-3); // last round's checks
    const reflectionScore =
      latestChecks.length > 0
        ? latestChecks.reduce((s, c) => s + c.score, 0) / latestChecks.length
        : 1.0;

    // ── Follow-up suggestions ────────────────────────────────────────────────
    let followUpQuestions: string[] = [];
    if (opts.suggestFollowUps !== false) {
      followUpQuestions = await generateFollowUps(
        question, currentResponse, requestId, model,
      );
    }

    const durationMs = Date.now() - start;

    Logger.info('[SelfReflectionLoop] reflection complete', {
      requestId,
      wasImproved,
      reflectionScore : Math.round(reflectionScore * 100) / 100,
      roundsCompleted,
      followUps       : followUpQuestions.length,
      durationMs,
    });

    return {
      requestId,
      originalResponse: response,
      improvedResponse: wasImproved ? currentResponse : undefined,
      wasImproved,
      reflectionScore : Math.round(reflectionScore * 1000) / 1000,
      checks          : allChecks,
      followUpQuestions,
      roundsCompleted,
      durationMs,
    };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const selfReflectionLoop = new SelfReflectionLoop();
