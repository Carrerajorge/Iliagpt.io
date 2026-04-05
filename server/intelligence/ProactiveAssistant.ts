/**
 * ProactiveAssistant
 *
 * Instead of only responding to explicit questions, the ProactiveAssistant
 * monitors the conversation and decides when to volunteer additional help.
 *
 * Detection patterns:
 *   - Stuck detection       — same question rephrased ≥2 times
 *   - Error detected        — user pastes an error or says "not working"
 *   - Better way exists     — user's approach has a known simpler alternative
 *   - Missing context       — response would improve with more context
 *   - Goal not met          — underlying need not yet addressed
 *
 * Aggressiveness setting (1–5):
 *   1 — Only critical issues (e.g. security vulnerabilities)
 *   3 — Balanced (default)
 *   5 — Suggest anything even marginally useful
 */

import { randomUUID }   from 'crypto';
import { z }            from 'zod';
import { Logger }       from '../lib/logger';
import { llmGateway }   from '../lib/llmGateway';

// ─── Types ────────────────────────────────────────────────────────────────────

export const ProactiveTriggerSchema = z.enum([
  'stuck',           // User is rephrasing the same question
  'error',           // User pasted an error or described a failure
  'better_way',      // A simpler/safer approach exists
  'missing_context', // The response would improve with additional context
  'next_step',       // Logical follow-up action the user hasn't asked about
  'related_info',    // Highly relevant information not yet mentioned
  'goal_not_met',    // The root goal behind the question hasn't been addressed
]);
export type ProactiveTrigger = z.infer<typeof ProactiveTriggerSchema>;

export const ProactiveSuggestionSchema = z.object({
  id        : z.string(),
  trigger   : ProactiveTriggerSchema,
  priority  : z.number().int().min(1).max(5),  // 1 = critical, 5 = minor
  headline  : z.string(),
  detail    : z.string(),
  action    : z.string().optional(),
  confidence: z.number().min(0).max(1),
});
export type ProactiveSuggestion = z.infer<typeof ProactiveSuggestionSchema>;

export interface TurnSummary {
  index  : number;
  role   : 'user' | 'assistant';
  text   : string;
  intent?: string;
}

export interface ProactiveAnalysisResult {
  requestId   : string;
  suggestions : ProactiveSuggestion[];
  shouldInject: boolean;
  durationMs  : number;
}

// ─── Pattern library ──────────────────────────────────────────────────────────

const ERROR_PATTERNS = [
  /error:/i, /exception:/i, /traceback/i, /stack\s+trace/i,
  /undefined is not/i, /cannot read propert/i, /null pointer/i,
  /segmentation fault/i, /permission denied/i, /connection refused/i,
  /ENOENT/i, /ECONNREFUSED/i, /TypeError/i, /SyntaxError/i,
  /not working/i, /doesn'?t work/i, /\bbroken\b/i, /\bfails?\b/i,
];

interface CodePattern { pattern: RegExp; headline: string; detail: string }

const SECURITY_PATTERNS: CodePattern[] = [
  {
    pattern : /innerHTML\s*=\s*[^"'`][^;]+\+/,
    headline: 'Potential XSS vulnerability in innerHTML assignment',
    detail  : 'Concatenating dynamic content into innerHTML can lead to XSS. Use textContent or a sanitization library.',
  },
  {
    pattern : /console\.log.{0,40}(?:password|token|secret|apikey|api_key)/i,
    headline: 'Sensitive data may appear in logs',
    detail  : 'Logging credentials is a security risk. Remove these statements before production deployment.',
  },
];

const QUALITY_PATTERNS: CodePattern[] = [
  {
    pattern : /\bvar\s+\w+\s*=/,
    headline: 'Consider using const or let instead of var',
    detail  : 'var has function scope and hoisting behavior that can cause bugs. const (default) or let are safer alternatives.',
  },
  {
    pattern : /for\s*\(\s*(?:let|var)\s+\w+\s*=\s*0[^;]*\.length/,
    headline: 'Array iteration could use higher-order methods',
    detail  : 'Traditional index loops can often be replaced with .map(), .filter(), or .forEach() for clearer intent.',
  },
];

const ALL_CODE_PATTERNS = [...SECURITY_PATTERNS, ...QUALITY_PATTERNS];

// ─── Stuck detection ──────────────────────────────────────────────────────────

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().match(/\b\w{4,}\b/g) ?? []);
  const setB = new Set(b.toLowerCase().match(/\b\w{4,}\b/g) ?? []);
  if (setA.size === 0 && setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  return shared / (setA.size + setB.size - shared);
}

function detectStuck(history: TurnSummary[]): boolean {
  const recentUser = history.filter(t => t.role === 'user').slice(-4);
  if (recentUser.length < 2) return false;
  for (let i = 0; i < recentUser.length - 1; i++) {
    const sim = jaccardSimilarity(recentUser[i]!.text, recentUser[i + 1]!.text);
    if (sim > 0.55) return true;
  }
  return false;
}

function detectError(text: string): boolean {
  return ERROR_PATTERNS.some(re => re.test(text));
}

function detectBetterWay(text: string): ProactiveSuggestion[] {
  return ALL_CODE_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ headline, detail }) => ({
      id        : randomUUID(),
      trigger   : 'better_way' as ProactiveTrigger,
      priority  : 2,
      headline,
      detail,
      confidence: 0.85,
    }));
}

// ─── LLM-based analysis ───────────────────────────────────────────────────────

interface LLMProactiveResponse {
  suggestions: Array<{
    trigger    : string;
    priority   : number;
    headline   : string;
    detail     : string;
    action?    : string;
    confidence : number;
  }>;
}

async function llmProactiveAnalysis(
  history       : TurnSummary[],
  requestId     : string,
  model         : string,
  aggressiveness: number,
): Promise<ProactiveSuggestion[]> {
  const histText = history.slice(-6)
    .map(t => `${t.role}: ${t.text.slice(0, 300)}`)
    .join('\n');

  const minConfidence = aggressiveness >= 4 ? 0.5 : 0.7;

  const res = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: `You are a proactive assistant analyst. Review this conversation and identify opportunities to proactively help.
Aggressiveness: ${aggressiveness}/5. Return JSON:
{"suggestions":[{"trigger":"stuck|error|better_way|missing_context|next_step|related_info|goal_not_met","priority":1-5,"headline":"...","detail":"...","action":"optional","confidence":0.0-1.0}]}
Include only suggestions with confidence >= ${minConfidence}. Maximum ${aggressiveness} suggestions.`,
      },
      { role: 'user', content: `Conversation:\n${histText}` },
    ],
    { model, requestId, temperature: 0.3, maxTokens: 600 },
  );

  try {
    const match  = res.content.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as LLMProactiveResponse : null;
    if (!parsed?.suggestions) return [];
    return parsed.suggestions
      .filter(s => ProactiveTriggerSchema.safeParse(s.trigger).success)
      .map(s => ({
        id        : randomUUID(),
        trigger   : s.trigger as ProactiveTrigger,
        priority  : Math.max(1, Math.min(5, s.priority)),
        headline  : s.headline,
        detail    : s.detail,
        action    : s.action,
        confidence: s.confidence,
      }));
  } catch {
    return [];
  }
}

// ─── ProactiveAssistant ───────────────────────────────────────────────────────

export interface ProactiveAssistantOptions {
  aggressiveness?: number;   // 1–5, default 3
  model?         : string;
  requestId?     : string;
  skipLlm?       : boolean;
}

export class ProactiveAssistant {
  /**
   * Analyse the conversation history and return proactive suggestions.
   *
   * @param history     - Recent turns (user + assistant), newest last
   * @param lastMessage - The most recent user message
   * @param opts        - Configuration
   */
  async analyse(
    history    : TurnSummary[],
    lastMessage: string,
    opts       : ProactiveAssistantOptions = {},
  ): Promise<ProactiveAnalysisResult> {
    const start     = Date.now();
    const requestId = opts.requestId      ?? randomUUID();
    const model     = opts.model          ?? 'auto';
    const aggr      = opts.aggressiveness ?? 3;
    const all       : ProactiveSuggestion[] = [];

    // Rule-based (fast, no LLM call)
    if (detectStuck(history)) {
      all.push({
        id        : randomUUID(),
        trigger   : 'stuck',
        priority  : 2,
        headline  : 'You seem to be asking the same thing in different ways',
        detail    : 'Let me try a different approach or clarify what specifically is unclear from the previous answers.',
        confidence: 0.8,
      });
    }

    if (detectError(lastMessage)) {
      all.push({
        id        : randomUUID(),
        trigger   : 'error',
        priority  : 1,
        headline  : 'I see an error — let me help diagnose it',
        detail    : 'Share the full error message and stack trace if available.',
        confidence: 0.9,
      });
    }

    all.push(...detectBetterWay(lastMessage));

    // LLM analysis (slower, more contextual)
    if (!opts.skipLlm && history.length >= 2) {
      try {
        const llmSugg = await llmProactiveAnalysis(history, `${requestId}-llm`, model, aggr);
        all.push(...llmSugg);
      } catch (err) {
        Logger.warn('[ProactiveAssistant] LLM analysis failed', { error: (err as Error).message });
      }
    }

    // Deduplicate by trigger, sort by priority, cap to aggressiveness
    const seen    = new Set<string>();
    const deduped = all
      .filter(s => { const k = s.trigger; const ok = !seen.has(k); seen.add(k); return ok; })
      .sort((a, b) => a.priority - b.priority)
      .slice(0, aggr);

    const shouldInject = deduped.some(s => s.priority <= 2);

    Logger.debug('[ProactiveAssistant] analysis complete', {
      requestId, suggestions: deduped.length, shouldInject, durationMs: Date.now() - start,
    });

    return { requestId, suggestions: deduped, shouldInject, durationMs: Date.now() - start };
  }
}

export const proactiveAssistant = new ProactiveAssistant();
