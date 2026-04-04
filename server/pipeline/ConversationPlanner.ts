/**
 * ConversationPlanner
 *
 * Multi-turn conversation planning and goal tracking.
 *
 * Responsibilities:
 *   - Detect conversation goals from the current and previous turns
 *   - Track whether goals have been satisfied
 *   - Detect topic shifts (are we still in the same thread?)
 *   - Predict likely follow-up intents so downstream stages can pre-load context
 *   - Identify when the conversation has reached a natural conclusion
 *   - Provide a ConversationPlan that downstream stages can query
 *
 * All planning is heuristic/rule-based to avoid adding LLM latency to every
 * turn.  An optional LLM-assisted deep-plan is available for complex sessions.
 */

import { randomUUID }   from 'crypto';
import { z }            from 'zod';
import { Logger }       from '../lib/logger';
import { llmGateway }   from '../lib/llmGateway';
import type { PreprocessedMessage, Intent } from './MessagePreprocessor';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOPIC_SHIFT_THRESHOLD       = 0.35;   // Jaccard distance above this = topic shift
const GOAL_SATISFIED_WINDOW       = 3;      // Look at last N turns for satisfaction signal
const MAX_PREDICTED_FOLLOWUPS     = 3;
const LLM_PLAN_HISTORY_THRESHOLD  = 5;      // Use LLM planner if history > N turns

// ─── Public schemas ───────────────────────────────────────────────────────────

export const ConversationGoalSchema = z.object({
  id         : z.string(),
  description: z.string(),
  intent     : z.string(),
  /** Turn index when this goal was first detected. */
  detectedAt : z.number().int().nonneg(),
  satisfied  : z.boolean(),
  /** Turn index when this goal was considered satisfied, or null. */
  satisfiedAt: z.number().int().nonneg().nullable(),
});
export type ConversationGoal = z.infer<typeof ConversationGoalSchema>;

export const TopicShiftSchema = z.object({
  detected      : z.boolean(),
  similarity    : z.number().min(0).max(1),
  previousTopic : z.string().optional(),
  currentTopic  : z.string().optional(),
});
export type TopicShift = z.infer<typeof TopicShiftSchema>;

export const ConversationPlanSchema = z.object({
  sessionId          : z.string(),
  turnIndex          : z.number().int().nonneg(),
  activeGoals        : z.array(ConversationGoalSchema),
  satisfiedGoals     : z.array(ConversationGoalSchema),
  topicShift         : TopicShiftSchema,
  predictedFollowUps : z.array(z.string()),
  /** True when the conversation seems to have reached a natural end. */
  isClosing          : z.boolean(),
  /** Hint to the response strategy: should we proactively offer more? */
  shouldProactivelyExtend: z.boolean(),
  planningMs         : z.number().nonneg(),
});
export type ConversationPlan = z.infer<typeof ConversationPlanSchema>;

// ─── Turn history record ──────────────────────────────────────────────────────

export interface TurnRecord {
  index      : number;
  role       : 'user' | 'assistant';
  content    : string;
  intent?    : Intent;
  timestamp  : number;
}

// ─── Topic similarity (word overlap / Jaccard) ────────────────────────────────

function topicWords(text: string): Set<string> {
  // Keep only "content" words (skip stop words)
  const STOP = new Set(['a','an','the','is','are','was','were','be','been','have',
    'has','had','do','does','did','will','would','could','should','can','may',
    'i','you','he','she','it','we','they','me','him','her','us','them',
    'in','on','at','to','for','of','with','by','from','up','as','into',
    'and','or','but','not','if','this','that','these','those','what','when',
    'where','who','how','why','please','thanks']);
  return new Set(
    (text.toLowerCase().match(/\b\w{3,}\b/g) ?? []).filter(w => !STOP.has(w)),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

function detectTopicShift(
  currentText  : string,
  previousTexts: string[],
): TopicShift {
  if (previousTexts.length === 0) {
    return { detected: false, similarity: 1 };
  }

  const currentWords  = topicWords(currentText);
  const previousWords = new Set(previousTexts.flatMap(t => [...topicWords(t)]));

  const similarity = jaccardSimilarity(currentWords, previousWords);

  return {
    detected     : similarity < (1 - TOPIC_SHIFT_THRESHOLD),
    similarity   : Math.round(similarity * 1000) / 1000,
    currentTopic : [...currentWords].slice(0, 5).join(', '),
    previousTopic: [...previousWords].slice(0, 5).join(', '),
  };
}

// ─── Goal detection ───────────────────────────────────────────────────────────

const CLOSING_SIGNALS = /\b(?:thanks?(?:\s+you)?|thank\s+you|great|perfect|that['']s\s+(?:all|it|good|great)|bye|goodbye|no\s+more\s+questions?|done|finished|that\s+(?:helps?|works?|answers?))\b/i;
const GOAL_PREFIXES   = /^(?:help\s+me|I\s+want\s+to|I\s+need\s+to|I['']m\s+trying\s+to|can\s+you|please|how\s+do\s+I|how\s+to)\b/i;

function extractGoalDescription(text: string, intent: Intent): string {
  const firstSentence = text.split(/[.!?]+/)[0]?.trim() ?? text;
  if (GOAL_PREFIXES.test(firstSentence)) {
    return firstSentence.slice(0, 120);
  }
  return `${intent}: ${firstSentence.slice(0, 80)}`;
}

function isSatisfied(turnHistory: TurnRecord[], goal: ConversationGoal): boolean {
  // Look at assistant turns after the goal was set — if assistant provided
  // a substantive response AND user replied with a closing signal, goal satisfied
  const recent = turnHistory.slice(-(GOAL_SATISFIED_WINDOW * 2));

  const hasSubstantiveAnswer = recent.some(
    t => t.role === 'assistant' && t.content.trim().split(/\s+/).length > 20 && t.index > goal.detectedAt,
  );
  const hasClosingSignal = recent.some(
    t => t.role === 'user' && CLOSING_SIGNALS.test(t.content) && t.index > goal.detectedAt,
  );

  return hasSubstantiveAnswer && hasClosingSignal;
}

// ─── Follow-up prediction (rule-based) ───────────────────────────────────────

const FOLLOWUP_HINTS: Partial<Record<Intent, string[]>> = {
  code       : ['Can you add tests?', 'How do I deploy this?', 'What edge cases should I handle?'],
  analysis   : ['What are the trade-offs?', 'Can you go deeper on X?', 'What should I do next?'],
  question   : ['Can you give an example?', 'Tell me more about this', 'What are the implications?'],
  command    : ['Can you improve it?', 'Are there alternatives?', 'How does this work?'],
  creative   : ['Can you make it longer?', 'Write a sequel', 'Change the tone'],
  conversation: ['Tell me more', 'That\'s interesting, why?', 'What else?'],
};

function predictFollowUps(intent: Intent, text: string): string[] {
  const hints = FOLLOWUP_HINTS[intent] ?? FOLLOWUP_HINTS['question'] ?? [];
  return hints.slice(0, MAX_PREDICTED_FOLLOWUPS);
}

// ─── LLM-assisted deep planning ──────────────────────────────────────────────

async function llmPlan(
  sessionId  : string,
  history    : TurnRecord[],
  current    : string,
  model      : string,
): Promise<{ predictedFollowUps: string[]; goals: string[] }> {
  const historyText = history
    .slice(-8)
    .map(t => `${t.role}: ${t.content.slice(0, 150)}`)
    .join('\n');

  const res = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: 'Analyze this conversation and return JSON: {"goals":["goal1"],"predictedFollowUps":["question1","question2","question3"]}. Goals are what the user is trying to accomplish. PredictedFollowUps are the 3 most likely next questions.',
      },
      { role: 'user', content: `Conversation so far:\n${historyText}\n\nLatest message: ${current}` },
    ],
    {
      model,
      requestId  : `planner-${sessionId}`,
      temperature: 0.3,
      maxTokens  : 300,
    },
  );

  try {
    const match  = res.content.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as { goals: string[]; predictedFollowUps: string[] } : null;
    return {
      goals             : parsed?.goals             ?? [],
      predictedFollowUps: parsed?.predictedFollowUps ?? [],
    };
  } catch {
    return { goals: [], predictedFollowUps: [] };
  }
}

// ─── Main class ───────────────────────────────────────────────────────────────

export interface ConversationPlannerOptions {
  model?       : string;
  /** Disable LLM-assisted planning even for long conversations. */
  disableLlmPlan?: boolean;
}

export class ConversationPlanner {
  private readonly sessions = new Map<string, {
    goals  : ConversationGoal[];
    history: TurnRecord[];
  }>();

  /**
   * Update the conversation plan for a new user turn.
   *
   * @param sessionId   - Stable session identifier
   * @param msg         - The preprocessed current user message
   * @param assistantPrevious - The previous assistant response (if any)
   * @param opts        - Options
   */
  async plan(
    sessionId        : string,
    msg              : PreprocessedMessage,
    assistantPrevious: string | undefined,
    opts             : ConversationPlannerOptions = {},
  ): Promise<ConversationPlan> {
    const start  = Date.now();
    const model  = opts.model ?? 'auto';

    // ── 1. Retrieve or initialise session state ─────────────────────────────
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { goals: [], history: [] });
    }
    const session = this.sessions.get(sessionId)!;

    const turnIndex = session.history.filter(t => t.role === 'user').length;

    // ── 2. Append previous assistant turn to history ─────────────────────────
    if (assistantPrevious && session.history.length > 0) {
      session.history.push({
        index    : turnIndex - 1,
        role     : 'assistant',
        content  : assistantPrevious,
        timestamp: Date.now(),
      });
    }

    // ── 3. Append current user turn ──────────────────────────────────────────
    session.history.push({
      index    : turnIndex,
      role     : 'user',
      content  : msg.normalized,
      intent   : msg.meta.intent,
      timestamp: Date.now(),
    });

    // ── 4. Topic shift detection ─────────────────────────────────────────────
    const prevUserTexts = session.history
      .filter(t => t.role === 'user' && t.index < turnIndex)
      .slice(-3)
      .map(t => t.content);

    const topicShift = detectTopicShift(msg.normalized, prevUserTexts);

    if (topicShift.detected) {
      Logger.debug('[ConversationPlanner] topic shift detected', {
        sessionId, similarity: topicShift.similarity,
      });
    }

    // ── 5. Goal detection ────────────────────────────────────────────────────
    const isClosing = CLOSING_SIGNALS.test(msg.normalized);

    if (!isClosing && msg.meta.intent !== 'conversation') {
      // Add new goal if this looks like a new task
      const existingGoal = session.goals.find(
        g => !g.satisfied && jaccardSimilarity(topicWords(g.description), topicWords(msg.normalized)) > 0.4,
      );

      if (!existingGoal) {
        session.goals.push({
          id         : randomUUID(),
          description: extractGoalDescription(msg.normalized, msg.meta.intent),
          intent     : msg.meta.intent,
          detectedAt : turnIndex,
          satisfied  : false,
          satisfiedAt: null,
        });
      }
    }

    // ── 6. Goal satisfaction check ───────────────────────────────────────────
    for (const goal of session.goals) {
      if (!goal.satisfied && isSatisfied(session.history, goal)) {
        goal.satisfied  = true;
        goal.satisfiedAt = turnIndex;
        Logger.debug('[ConversationPlanner] goal satisfied', { sessionId, goal: goal.description });
      }
    }

    const activeGoals    = session.goals.filter(g => !g.satisfied);
    const satisfiedGoals = session.goals.filter(g =>  g.satisfied);

    // ── 7. Follow-up prediction ──────────────────────────────────────────────
    let predictedFollowUps = predictFollowUps(msg.meta.intent, msg.normalized);

    // Use LLM planner for longer conversations
    if (!opts.disableLlmPlan && session.history.length >= LLM_PLAN_HISTORY_THRESHOLD) {
      try {
        const llmResult = await llmPlan(sessionId, session.history, msg.normalized, model);
        if (llmResult.predictedFollowUps.length > 0) {
          predictedFollowUps = llmResult.predictedFollowUps;
        }
      } catch (err) {
        Logger.warn('[ConversationPlanner] LLM plan failed — using rule-based follow-ups', {
          sessionId, error: (err as Error).message,
        });
      }
    }

    const shouldProactivelyExtend =
      activeGoals.length > 0 &&
      !isClosing &&
      session.history.filter(t => t.role === 'assistant').length >= 1;

    const planningMs = Date.now() - start;

    Logger.debug('[ConversationPlanner] plan updated', {
      sessionId,
      turnIndex,
      activeGoals   : activeGoals.length,
      satisfiedGoals: satisfiedGoals.length,
      topicShift    : topicShift.detected,
      isClosing,
      planningMs,
    });

    return {
      sessionId,
      turnIndex,
      activeGoals,
      satisfiedGoals,
      topicShift,
      predictedFollowUps,
      isClosing,
      shouldProactivelyExtend,
      planningMs,
    };
  }

  /**
   * Clear a session's state (call on session end / logout).
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Return the number of active sessions tracked in memory.
   */
  get activeSessions(): number {
    return this.sessions.size;
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const conversationPlanner = new ConversationPlanner();
