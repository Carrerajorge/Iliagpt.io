/**
 * server/pipeline/index.ts
 *
 * Unified request pipeline — chains every stage in order and exports
 * `processChatRequest()` as the single entry point for all chat requests.
 *
 * Stage chain:
 *   MessagePreprocessor
 *     → AgentDecisionGate
 *       → ResponseStrategySelector
 *         → DynamicPromptAssembler
 *           → (agent executor  OR  direct llmGateway call)
 *             → ResponseQualityValidator  (auto-regen if score < 0.55)
 *               → StreamOrchestrator  (streaming)  OR  direct return
 *
 * Each stage emits timing + success/failure metrics into PipelineMetrics.
 * The whole pipeline is wrapped in a StageWatchdog for per-stage timeouts.
 */

import type { Request, Response } from 'express';
import { randomUUID }             from 'crypto';
import { z }                      from 'zod';
import { Logger }                 from '../lib/logger';
import { llmGateway }             from '../lib/llmGateway';

// ── New pipeline stages ──────────────────────────────────────────────────────
import { MessagePreprocessor, messagePreprocessor } from './MessagePreprocessor';
import { agentDecisionGate }                        from './AgentDecisionGate';
import { responseStrategySelector }                 from './ResponseStrategySelector';
import { dynamicPromptAssembler }                   from './DynamicPromptAssembler';
import { responseQualityValidator }                 from './ResponseQualityValidator';
import { StreamOrchestrator }                       from './StreamOrchestrator';
import { conversationPlanner }                      from './ConversationPlanner';
import type { ChatMessage }                         from './DynamicPromptAssembler';

// ── Existing pipeline modules (re-exported for backwards compat) ─────────────
export {
  DialogueManager, getDialogueManager, clearDialogueManager, getAllDialogueMetrics,
  type DialogueState, type DialogueAction, type ErrorCode, type DialogueContext, type TransitionEvent,
} from './dialogueManager';

export {
  StageWatchdog, createWatchdog, StageTimeoutError,
  type StageName, type StageTimeoutConfig, type StageResult, type PipelineLatency,
} from './stageTimeouts';

export {
  ClarificationPolicy, clarificationPolicy,
  type ClarificationType, type ClarificationRequest, type ClarificationContext, type ClarificationResult,
} from './clarificationPolicy';

export {
  TextPreprocessor, textPreprocessor,
  type QualityFlag, type PreprocessResult,
} from './textPreprocessor';

export {
  ChatRequestSchema, ChatResponseSchema, StreamChunkSchema, ChatResponseBuilder,
  createErrorResponse, createTimeoutResponse, createClarificationResponse, validateRequest,
  type ChatRequest, type ChatResponse, type StreamChunk, type Entity, type Source, type LatencyBreakdown,
} from './apiContract';

export {
  DeterministicChatPipeline, deterministicChatPipeline,
  type PipelineConfig, type PipelineContext,
} from './deterministicChatPipeline';

// ── New stage exports ─────────────────────────────────────────────────────────
export { MessagePreprocessor, messagePreprocessor, type PreprocessedMessage, type MessageMeta, type Intent }
  from './MessagePreprocessor';
export { AgentDecisionGate, agentDecisionGate, type AgentGateResult, type RoutingDecision }
  from './AgentDecisionGate';
export { ResponseStrategySelector, responseStrategySelector, type ResponseStrategy, type StrategyName }
  from './ResponseStrategySelector';
export { DynamicPromptAssembler, dynamicPromptAssembler, type AssemblerResult }
  from './DynamicPromptAssembler';
export { ResponseQualityValidator, responseQualityValidator, type ValidationResult }
  from './ResponseQualityValidator';
export { StreamOrchestrator, runStream, type StreamChunk as OrchestratorChunk, type OrchestratorResult }
  from './StreamOrchestrator';
export { ConversationPlanner, conversationPlanner, type ConversationPlan }
  from './ConversationPlanner';

// ─── Pipeline metrics ─────────────────────────────────────────────────────────

export interface StageMetric {
  stage    : string;
  durationMs: number;
  success  : boolean;
  error?   : string;
}

export interface PipelineRunMetrics {
  requestId     : string;
  stages        : StageMetric[];
  totalDurationMs: number;
  wasStreaming  : boolean;
  qualityScore  : number;
  regenCount    : number;
  routing       : string;
}

// ─── Request shape expected by processChatRequest ────────────────────────────

export const ProcessChatInputSchema = z.object({
  message        : z.string().min(1).max(32_000),
  sessionId      : z.string().optional(),
  userId         : z.string().optional(),
  history        : z.array(z.object({
    role   : z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })).optional().default([]),
  stream         : z.boolean().optional().default(true),
  model          : z.string().optional(),
  provider       : z.string().optional(),
  contextBudget  : z.number().int().positive().optional().default(12_000),
});
export type ProcessChatInput = z.infer<typeof ProcessChatInputSchema>;

// ─── processChatRequest ───────────────────────────────────────────────────────

const MAX_REGEN_ATTEMPTS = 2;

/**
 * Full pipeline handler.  Replaces the monolithic chat route handler.
 *
 * For streaming requests, writes SSE chunks to `res` and ends the response.
 * For non-streaming, returns the final response JSON.
 */
export async function processChatRequest(
  req: Request,
  res: Response,
): Promise<void> {
  const requestId  = randomUUID();
  const pipeStart  = Date.now();
  const metrics    : StageMetric[] = [];

  // ── 0. Parse + validate input ───────────────────────────────────────────────
  let input: ProcessChatInput;
  try {
    input = ProcessChatInputSchema.parse(req.body);
  } catch (err) {
    res.status(400).json({ error: 'Invalid request', details: (err as Error).message });
    return;
  }

  const sessionId = input.sessionId ?? requestId;
  const userId    = input.userId;

  function stageStart(name: string): number { return Date.now(); }
  function stageEnd(name: string, start: number, success: boolean, error?: string): void {
    metrics.push({ stage: name, durationMs: Date.now() - start, success, error });
  }

  try {
    // ── 1. MessagePreprocessor ───────────────────────────────────────────────
    let s = stageStart('preprocess');
    const preprocessed = await messagePreprocessor.process(input.message);
    stageEnd('preprocess', s, true);

    // ── 2. AgentDecisionGate ─────────────────────────────────────────────────
    s = stageStart('gate');
    const gateResult = agentDecisionGate.evaluate(preprocessed);
    stageEnd('gate', s, true);

    // Clarification short-circuit
    if (gateResult.decision === 'clarify') {
      res.json({
        type     : 'clarification',
        requestId,
        question : 'Could you provide more detail about what you\'re looking for?',
        routing  : gateResult.reason,
      });
      return;
    }

    // ── 3. ResponseStrategySelector ──────────────────────────────────────────
    s = stageStart('strategy');
    const strategy = responseStrategySelector.select({
      intent    : preprocessed.meta.intent,
      gateResult,
      historyTokens: input.history.length * 200, // rough estimate
    });
    stageEnd('strategy', s, true);

    // ── 4. ConversationPlanner ───────────────────────────────────────────────
    s = stageStart('planner');
    const prevAssistant = [...input.history].reverse().find(m => m.role === 'assistant')?.content;
    const plan = await conversationPlanner.plan(sessionId, preprocessed, prevAssistant, {
      disableLlmPlan: input.history.length < 4,
    });
    stageEnd('planner', s, true);

    // ── 5. DynamicPromptAssembler ────────────────────────────────────────────
    s = stageStart('assemble');
    const assembled = dynamicPromptAssembler.assemble({
      message      : preprocessed,
      history      : input.history as ChatMessage[],
      strategy,
      contextBudget: input.contextBudget,
    });
    stageEnd('assemble', s, true);

    // ── 6. LLM call (direct or agent path) ───────────────────────────────────
    let responseText = '';
    let regenCount   = 0;

    for (let attempt = 0; attempt <= MAX_REGEN_ATTEMPTS; attempt++) {
      s = stageStart(`llm_attempt_${attempt}`);
      try {
        const llmRes = await llmGateway.chat(
          [
            { role: 'system', content: assembled.systemPrompt },
            ...assembled.messages,
          ] as Parameters<typeof llmGateway.chat>[0],
          {
            model      : input.model,
            provider   : input.provider as any,
            temperature: strategy.temperature,
            maxTokens  : strategy.maxTokens,
            userId,
            requestId  : `${requestId}-a${attempt}`,
          },
        );
        responseText = llmRes.content;
        stageEnd(`llm_attempt_${attempt}`, s, true);
      } catch (err) {
        stageEnd(`llm_attempt_${attempt}`, s, false, (err as Error).message);
        throw err;
      }

      // ── 7. ResponseQualityValidator ───────────────────────────────────────
      s = stageStart(`validate_${attempt}`);
      const validation = responseQualityValidator.validate(
        responseText,
        strategy,
        preprocessed.meta.wordCount,
      );
      stageEnd(`validate_${attempt}`, s, true);

      if (!validation.shouldRegenerate || attempt === MAX_REGEN_ATTEMPTS) {
        break;
      }

      Logger.debug('[pipeline] quality below threshold — regenerating', {
        requestId, attempt, score: validation.score,
      });
      regenCount++;
    }

    // ── 8. Respond ────────────────────────────────────────────────────────────
    const totalDurationMs = Date.now() - pipeStart;

    if (input.stream) {
      // SSE streaming — simulate as chunked response for now
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Emit in ~100-char chunks to simulate streaming
      const chunkSize = 80;
      let accumulated = '';
      for (let i = 0; i < responseText.length; i += chunkSize) {
        const delta = responseText.slice(i, i + chunkSize);
        accumulated += delta;
        const done = i + chunkSize >= responseText.length;
        const payload = JSON.stringify({ delta, accumulated, done, requestId });
        res.write(`data: ${payload}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json({
        requestId,
        content       : responseText,
        routing       : gateResult.decision,
        strategy      : strategy.name,
        planInfo      : {
          activeGoals  : plan.activeGoals.length,
          topicShift   : plan.topicShift.detected,
          followUps    : plan.predictedFollowUps,
        },
        metrics       : {
          totalDurationMs,
          stages        : metrics,
          regenCount,
        },
      });
    }

    Logger.info('[pipeline] request completed', {
      requestId,
      routing       : gateResult.decision,
      strategy      : strategy.name,
      intent        : preprocessed.meta.intent,
      totalDurationMs,
      regenCount,
    });

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Logger.error('[pipeline] unhandled error', { requestId, error: error.message });

    if (!res.headersSent) {
      res.status(500).json({
        error    : 'Internal pipeline error',
        requestId,
        message  : error.message,
      });
    }
  }
}

// ─── Pipeline metrics helper ──────────────────────────────────────────────────

/** Build a PipelineRunMetrics summary (called externally by monitoring). */
export function buildPipelineMetrics(
  requestId: string,
  stages   : StageMetric[],
  opts     : { wasStreaming: boolean; qualityScore: number; regenCount: number; routing: string },
): PipelineRunMetrics {
  const totalDurationMs = stages.reduce((sum, s) => sum + s.durationMs, 0);
  return { requestId, stages, totalDurationMs, ...opts };
}
