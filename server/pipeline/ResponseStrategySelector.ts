/**
 * ResponseStrategySelector
 *
 * Third pipeline stage — maps the intent + gate decision to a concrete
 * ResponseStrategy that controls how the LLM is invoked.
 *
 * Each strategy carries:
 *   - temperature     (creativity vs determinism)
 *   - maxTokens       (budget for the response)
 *   - formatHint      (markdown, json, plain, code block)
 *   - systemHint      (extra system-prompt snippet injected for this call)
 *   - streamingEnabled
 *   - model preference hint (e.g. prefer reasoning models for analysis)
 *
 * Strategies
 * ──────────
 *   DirectAnswer       Simple factual Q&A.  Low temperature, short.
 *   StepByStep         Multi-part tasks.  Medium temperature, numbered steps.
 *   CodeGeneration     Code output.  Low temperature, fenced code blocks.
 *   AnalysisReport     Deep analysis.  Medium temperature, structured sections.
 *   CreativeGeneration Story / poem / brainstorm.  High temperature, long.
 *   Conversation       Small-talk.  High temperature, short.
 *   ClarificationRequest  Ask the user to clarify before answering.
 */

import { z }      from 'zod';
import { Logger } from '../lib/logger';
import type { Intent }         from './MessagePreprocessor';
import type { RoutingDecision, AgentGateResult } from './AgentDecisionGate';

// ─── Public schemas ───────────────────────────────────────────────────────────

export const StrategyNameSchema = z.enum([
  'DirectAnswer',
  'StepByStep',
  'CodeGeneration',
  'AnalysisReport',
  'CreativeGeneration',
  'Conversation',
  'ClarificationRequest',
]);
export type StrategyName = z.infer<typeof StrategyNameSchema>;

export const FormatHintSchema = z.enum([
  'plain',       // No special formatting
  'markdown',    // GitHub-flavoured markdown OK
  'json',        // Structured JSON output
  'code',        // Fenced code block as primary content
  'numbered',    // Numbered steps / lists
  'question',    // Ends with a clarifying question
]);
export type FormatHint = z.infer<typeof FormatHintSchema>;

export const ResponseStrategySchema = z.object({
  name            : StrategyNameSchema,
  temperature     : z.number().min(0).max(2),
  maxTokens       : z.number().int().positive(),
  formatHint      : FormatHintSchema,
  streamingEnabled: z.boolean(),
  /**
   * Short system-prompt addendum injected right before the user message.
   * Keep under 100 tokens.
   */
  systemHint      : z.string(),
  /**
   * Optional model tag hint sent to llmGateway so it can prefer a model
   * class (e.g. "reasoning", "fast", "code").
   */
  modelHint       : z.string().optional(),
  /**
   * If true, the pipeline should attempt to generate a structured JSON
   * response validated against a schema.
   */
  jsonMode        : z.boolean().default(false),
  /** Upper bound on thinking / planning tokens (for reasoning models). */
  thinkingBudget  : z.number().int().nonneg().optional(),
  /** Processing time to select this strategy in ms. */
  selectionMs     : z.number().nonneg(),
});
export type ResponseStrategy = z.infer<typeof ResponseStrategySchema>;

// ─── Strategy definitions ─────────────────────────────────────────────────────

type StrategyTemplate = Omit<ResponseStrategy, 'selectionMs'>;

const STRATEGIES: Record<StrategyName, StrategyTemplate> = {
  DirectAnswer: {
    name            : 'DirectAnswer',
    temperature     : 0.3,
    maxTokens       : 512,
    formatHint      : 'plain',
    streamingEnabled: true,
    systemHint      : 'Answer concisely and accurately. Get to the point immediately.',
    modelHint       : 'fast',
    jsonMode        : false,
  },

  StepByStep: {
    name            : 'StepByStep',
    temperature     : 0.4,
    maxTokens       : 1536,
    formatHint      : 'numbered',
    streamingEnabled: true,
    systemHint      : 'Break your response into clear numbered steps. Each step should be actionable and complete.',
    modelHint       : 'balanced',
    jsonMode        : false,
  },

  CodeGeneration: {
    name            : 'CodeGeneration',
    temperature     : 0.2,
    maxTokens       : 2048,
    formatHint      : 'code',
    streamingEnabled: true,
    systemHint      : 'Output production-quality code in a fenced code block. Include type annotations. Add brief inline comments only where logic is non-obvious.',
    modelHint       : 'code',
    jsonMode        : false,
  },

  AnalysisReport: {
    name            : 'AnalysisReport',
    temperature     : 0.5,
    maxTokens       : 2048,
    formatHint      : 'markdown',
    streamingEnabled: true,
    systemHint      : 'Structure your analysis with clear headings. Support claims with reasoning. Conclude with actionable insights.',
    modelHint       : 'reasoning',
    jsonMode        : false,
    thinkingBudget  : 2000,
  },

  CreativeGeneration: {
    name            : 'CreativeGeneration',
    temperature     : 0.9,
    maxTokens       : 2048,
    formatHint      : 'markdown',
    streamingEnabled: true,
    systemHint      : 'Be imaginative, engaging, and original. Vary sentence structure. Use vivid language.',
    modelHint       : 'balanced',
    jsonMode        : false,
  },

  Conversation: {
    name            : 'Conversation',
    temperature     : 0.8,
    maxTokens       : 256,
    formatHint      : 'plain',
    streamingEnabled: true,
    systemHint      : 'Respond naturally and warmly, as in a friendly conversation. Keep it brief.',
    modelHint       : 'fast',
    jsonMode        : false,
  },

  ClarificationRequest: {
    name            : 'ClarificationRequest',
    temperature     : 0.3,
    maxTokens       : 128,
    formatHint      : 'question',
    streamingEnabled: false,
    systemHint      : 'Politely ask the one most important clarifying question needed before you can answer. Do not attempt to answer yet.',
    modelHint       : 'fast',
    jsonMode        : false,
  },
};

// ─── Selection logic ──────────────────────────────────────────────────────────

interface SelectionInput {
  intent    : Intent;
  gateResult: AgentGateResult;
  /** True if the user has asked for JSON output explicitly. */
  wantsJson?: boolean;
  /** Rough estimate of how many tokens the conversation history occupies. */
  historyTokens?: number;
}

function pickStrategyName(input: SelectionInput): StrategyName {
  const { intent, gateResult, wantsJson } = input;

  // Clarification always overrides
  if (gateResult.decision === 'clarify') return 'ClarificationRequest';

  // JSON explicitly requested → DirectAnswer with JSON mode patched later
  if (wantsJson) return 'DirectAnswer';

  // Primary mapping by intent
  switch (intent) {
    case 'code':
      return 'CodeGeneration';

    case 'analysis':
      return 'AnalysisReport';

    case 'creative':
      return 'CreativeGeneration';

    case 'command':
      // Commands that are multi-step get StepByStep treatment
      return gateResult.isMultiStep ? 'StepByStep' : 'DirectAnswer';

    case 'question':
      // Complex questions benefit from step-by-step; simple ones are direct
      return gateResult.dimensions.complexity >= 0.5 ? 'AnalysisReport' : 'DirectAnswer';

    case 'conversation':
      return 'Conversation';

    default:
      return gateResult.isMultiStep ? 'StepByStep' : 'DirectAnswer';
  }
}

function applyOverrides(
  strategy: StrategyTemplate,
  input: SelectionInput,
): StrategyTemplate {
  const s = { ...strategy };

  // JSON mode override
  if (input.wantsJson) {
    s.jsonMode   = true;
    s.formatHint = 'json';
    s.systemHint += ' Respond with valid JSON only, no prose.';
    s.maxTokens  = Math.min(s.maxTokens, 1024);
  }

  // Reduce maxTokens when history is already large (stay within context window)
  if ((input.historyTokens ?? 0) > 6000) {
    s.maxTokens = Math.min(s.maxTokens, 768);
  }

  // Boost maxTokens for agent path (tools may return large intermediate results)
  if (input.gateResult.decision === 'agent') {
    s.maxTokens = Math.min(s.maxTokens * 2, 4096);
  }

  return s;
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class ResponseStrategySelector {
  /**
   * Select and configure a ResponseStrategy for the current turn.
   *
   * @param input - Intent, gate result, and optional overrides
   * @returns     - Fully configured ResponseStrategy
   */
  select(input: SelectionInput): ResponseStrategy {
    const start = Date.now();

    const name     = pickStrategyName(input);
    const template = STRATEGIES[name];
    const patched  = applyOverrides(template, input);

    const selectionMs = Date.now() - start;

    Logger.debug('[ResponseStrategySelector] strategy selected', {
      strategy  : name,
      intent    : input.intent,
      decision  : input.gateResult.decision,
      isMultiStep: input.gateResult.isMultiStep,
      jsonMode  : patched.jsonMode,
      maxTokens : patched.maxTokens,
      selectionMs,
    });

    return { ...patched, selectionMs };
  }

  /**
   * Return all available strategy templates (for introspection / testing).
   */
  allStrategies(): Record<StrategyName, StrategyTemplate> {
    return { ...STRATEGIES };
  }

  /**
   * Build a custom strategy by merging overrides onto a base strategy.
   * Useful for A/B tests or user-preference overrides.
   */
  buildCustom(
    base: StrategyName,
    overrides: Partial<Omit<ResponseStrategy, 'name' | 'selectionMs'>>,
  ): ResponseStrategy {
    const template = STRATEGIES[base];
    return {
      ...template,
      ...overrides,
      name       : base,
      selectionMs: 0,
    };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const responseStrategySelector = new ResponseStrategySelector();
