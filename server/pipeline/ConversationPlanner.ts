/**
 * ConversationPlanner — Batch 1 Pipeline Stage
 *
 * Maintains a cross-message "conversation plan" to:
 *  - Predict likely follow-up topics and pre-load relevant context
 *  - Track conversation goals and measure progress
 *  - Suggest proactive information at natural moments
 *  - Detect topic shifts and reset context accordingly
 *  - Provide downstream pipeline stages with anticipatory metadata
 */

import { createLogger } from "../utils/logger";
import type { Intent } from "./MessagePreprocessor";

const log = createLogger("ConversationPlanner");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConversationGoal =
  | "learn_topic"
  | "debug_code"
  | "build_feature"
  | "research"
  | "get_advice"
  | "creative_project"
  | "data_analysis"
  | "planning"
  | "casual_chat"
  | "unknown";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  intent?: Intent;
  timestamp: number;
  tokenEstimate: number;
}

export interface TopicNode {
  topic: string;
  confidence: number;     // 0–1
  firstSeen: number;      // timestamp
  lastSeen: number;
  frequency: number;      // how many turns referenced this topic
}

export interface ConversationPlan {
  sessionId: string;
  goal: ConversationGoal;
  goalConfidence: number;
  activeTopics: TopicNode[];
  anticipatedFollowUps: string[];   // predicted next questions
  suggestedProactiveInfo: string[]; // info to volunteer without being asked
  topicShiftDetected: boolean;
  goalProgressPct: number;          // 0–100 estimate
  turnCount: number;
  totalTokensEstimate: number;
  lastUpdated: number;
}

export interface PlannerConfig {
  maxActiveTopics: number;
  topicDecayTurns: number;         // topic dropped if not seen for N turns
  topicShiftThreshold: number;     // 0–1 cosine-like similarity threshold
  maxAnticipatedFollowUps: number;
  maxProactiveSuggestions: number;
}

// ─── Goal Detection ───────────────────────────────────────────────────────────

interface GoalPattern {
  goal: ConversationGoal;
  patterns: RegExp[];
  weight: number;
}

const GOAL_PATTERNS: GoalPattern[] = [
  {
    goal: "debug_code",
    patterns: [
      /\b(bug|error|exception|crash|fails?|broken|doesn't work|not working)\b/i,
      /\b(debug|fix|resolve|solve)\b.*\b(issue|problem|error)\b/i,
    ],
    weight: 1.5,
  },
  {
    goal: "build_feature",
    patterns: [
      /\b(build|create|implement|add|develop|make)\b.*\b(feature|function|component|module|api|endpoint)\b/i,
      /\b(new\s+)(page|screen|form|button|modal|widget)\b/i,
    ],
    weight: 1.4,
  },
  {
    goal: "learn_topic",
    patterns: [
      /\b(explain|teach|learn|understand|how does|what is|why does)\b/i,
      /\b(tutorial|guide|introduction|overview|basics|fundamentals)\b/i,
    ],
    weight: 1.2,
  },
  {
    goal: "research",
    patterns: [
      /\b(research|investigate|find|look up|compare|survey|review)\b/i,
      /\b(best practices|state of the art|latest|current|recent)\b/i,
    ],
    weight: 1.1,
  },
  {
    goal: "data_analysis",
    patterns: [
      /\b(analyze|analyse|data|dataset|statistics|metrics|numbers|trends)\b/i,
      /\b(chart|graph|plot|visualize|distribution|correlation)\b/i,
    ],
    weight: 1.3,
  },
  {
    goal: "creative_project",
    patterns: [
      /\b(write|story|novel|poem|script|article|blog|essay|creative)\b/i,
      /\b(character|plot|setting|scene|chapter|draft)\b/i,
    ],
    weight: 1.2,
  },
  {
    goal: "planning",
    patterns: [
      /\b(plan|roadmap|timeline|schedule|strategy|steps|process)\b/i,
      /\b(project|sprint|milestone|deadline|goal|objective)\b/i,
    ],
    weight: 1.1,
  },
  {
    goal: "get_advice",
    patterns: [
      /\b(advice|recommend|suggest|should I|would you|best way|opinion)\b/i,
      /\b(help me decide|what do you think|pros.*cons)\b/i,
    ],
    weight: 1.0,
  },
  {
    goal: "casual_chat",
    patterns: [
      /^(hi|hello|hey|hola|how are you|what's up|good morning)\b/i,
      /\b(joke|fun|interesting|cool|awesome|random)\b/i,
    ],
    weight: 0.9,
  },
];

function detectGoal(turns: ConversationTurn[]): { goal: ConversationGoal; confidence: number } {
  const recentText = turns
    .filter(t => t.role === "user")
    .slice(-5)
    .map(t => t.content)
    .join(" ");

  const scores: Partial<Record<ConversationGoal, number>> = {};

  for (const gp of GOAL_PATTERNS) {
    let score = 0;
    for (const pat of gp.patterns) {
      if (pat.test(recentText)) score += gp.weight;
    }
    if (score > 0) scores[gp.goal] = (scores[gp.goal] ?? 0) + score;
  }

  const entries = Object.entries(scores) as [ConversationGoal, number][];
  if (entries.length === 0) return { goal: "unknown", confidence: 0.4 };

  entries.sort((a, b) => b[1] - a[1]);
  const [topGoal, topScore] = entries[0];
  const totalScore = entries.reduce((s, [, v]) => s + v, 0);
  const confidence = Math.min(0.95, 0.4 + (topScore / Math.max(totalScore, 1)) * 0.6);

  return { goal: topGoal, confidence };
}

// ─── Topic Extraction ──────────────────────────────────────────────────────────

/** Extract noun-phrase–like topics from user messages using simple heuristics */
function extractTopics(text: string): string[] {
  const stopwords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "this", "that", "these",
    "those", "i", "you", "he", "she", "we", "they", "it", "my", "your",
    "our", "their", "its", "me", "him", "her", "us", "them",
  ]);

  // Extract 1–3 word noun phrases (capitalized proper nouns or recurring technical terms)
  const topics: string[] = [];

  // Proper nouns / technical terms (capitalized after sentence start)
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g)) {
    const term = m[1];
    if (term.length > 2 && !stopwords.has(term.toLowerCase())) {
      topics.push(term.toLowerCase());
    }
  }

  // Technical identifiers (camelCase, snake_case, filenames)
  for (const m of text.matchAll(/\b([a-z][a-zA-Z0-9_]{3,}(?:[A-Z][a-z]+)+)\b/g)) {
    topics.push(m[1]);
  }

  // Words after "about", "regarding", "related to" (topic signals)
  for (const m of text.matchAll(/\b(?:about|regarding|concerning|related to)\s+([a-z]+(?:\s+[a-z]+)?)\b/gi)) {
    const term = (m[1] ?? "").trim();
    if (term.length > 3) topics.push(term.toLowerCase());
  }

  return [...new Set(topics)].slice(0, 6);
}

// ─── Follow-up Prediction ─────────────────────────────────────────────────────

const FOLLOWUP_TEMPLATES: Record<ConversationGoal, string[]> = {
  learn_topic: [
    "Can you give me an example?",
    "What are the common pitfalls?",
    "How does this compare to alternatives?",
    "Where can I learn more?",
  ],
  debug_code: [
    "What caused this error?",
    "Are there other similar bugs I should check?",
    "How can I write a test for this?",
    "Can you show the fixed version?",
  ],
  build_feature: [
    "What's the recommended architecture?",
    "Can you show the implementation?",
    "How do I test this?",
    "What edge cases should I handle?",
  ],
  research: [
    "What are the key takeaways?",
    "How does this apply to my situation?",
    "Are there more recent sources?",
    "Can you summarize the findings?",
  ],
  data_analysis: [
    "What patterns stand out?",
    "Can you visualize this?",
    "What does the data suggest?",
    "Are there outliers I should investigate?",
  ],
  creative_project: [
    "Can you continue the story?",
    "What would happen if...?",
    "Can you make it more dramatic?",
    "How should I develop this character?",
  ],
  planning: [
    "What should I prioritize first?",
    "What risks should I plan for?",
    "How long will each step take?",
    "What resources do I need?",
  ],
  get_advice: [
    "What would you do in my situation?",
    "What are the risks?",
    "Is there a third option?",
    "What would an expert recommend?",
  ],
  casual_chat: [
    "Tell me something interesting.",
    "What do you think about...?",
  ],
  unknown: [
    "Can you elaborate?",
    "What else would you like to know?",
  ],
};

function predictFollowUps(
  goal: ConversationGoal,
  activeTopics: TopicNode[],
  maxCount: number,
): string[] {
  const templates = FOLLOWUP_TEMPLATES[goal] ?? FOLLOWUP_TEMPLATES.unknown;

  // Personalise templates with top active topic if available
  const topTopic = activeTopics[0]?.topic;
  const personalised = topTopic
    ? templates.map(t =>
        t.includes("this") ? t.replace("this", topTopic) : t,
      )
    : templates;

  return personalised.slice(0, maxCount);
}

// ─── Topic Shift Detection ────────────────────────────────────────────────────

function detectTopicShift(
  activeTopics: TopicNode[],
  newTopics: string[],
  threshold: number,
): boolean {
  if (activeTopics.length === 0 || newTopics.length === 0) return false;

  const activeSet = new Set(activeTopics.map(t => t.topic));
  const overlap = newTopics.filter(t => activeSet.has(t)).length;
  const unionSize = activeSet.size + newTopics.filter(t => !activeSet.has(t)).length;

  const jaccardSimilarity = overlap / Math.max(unionSize, 1);
  return jaccardSimilarity < threshold;
}

// ─── ConversationPlanner ──────────────────────────────────────────────────────

const DEFAULT_CONFIG: PlannerConfig = {
  maxActiveTopics: 8,
  topicDecayTurns: 6,
  topicShiftThreshold: 0.15,
  maxAnticipatedFollowUps: 3,
  maxProactiveSuggestions: 2,
};

export class ConversationPlanner {
  private config: PlannerConfig;
  private plans: Map<string, ConversationPlan> = new Map();
  private turnHistory: Map<string, ConversationTurn[]> = new Map();

  constructor(config: Partial<PlannerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Call after each user message to update and retrieve the plan */
  update(
    sessionId: string,
    userMessage: string,
    intent?: Intent,
    assistantResponse?: string,
  ): ConversationPlan {
    const turns = this.turnHistory.get(sessionId) ?? [];
    const now = Date.now();

    // Record user turn
    turns.push({
      role: "user",
      content: userMessage,
      intent,
      timestamp: now,
      tokenEstimate: Math.ceil(userMessage.length / 4),
    });

    if (assistantResponse) {
      turns.push({
        role: "assistant",
        content: assistantResponse,
        timestamp: now,
        tokenEstimate: Math.ceil(assistantResponse.length / 4),
      });
    }

    // Keep last 30 turns
    const recentTurns = turns.slice(-30);
    this.turnHistory.set(sessionId, recentTurns);

    // Detect goal
    const { goal, confidence: goalConfidence } = detectGoal(recentTurns);

    // Extract and merge topics
    const newTopics = extractTopics(userMessage);
    const existingPlan = this.plans.get(sessionId);
    const existingTopics = existingPlan?.activeTopics ?? [];

    const topicShiftDetected = detectTopicShift(
      existingTopics,
      newTopics,
      this.config.topicShiftThreshold,
    );

    // If topic shift detected, decay old topics aggressively
    const decayMultiplier = topicShiftDetected ? 0.3 : 1.0;

    // Merge topics
    const topicMap = new Map<string, TopicNode>(
      existingTopics.map(t => [t.topic, t]),
    );

    for (const topic of newTopics) {
      if (topicMap.has(topic)) {
        const existing = topicMap.get(topic)!;
        topicMap.set(topic, {
          ...existing,
          lastSeen: now,
          frequency: existing.frequency + 1,
          confidence: Math.min(0.99, existing.confidence + 0.1),
        });
      } else {
        topicMap.set(topic, {
          topic,
          confidence: 0.6,
          firstSeen: now,
          lastSeen: now,
          frequency: 1,
        });
      }
    }

    // Decay and prune old topics
    const currentTurn = recentTurns.length;
    const prunedTopics = [...topicMap.values()]
      .map(t => ({
        ...t,
        confidence: t.confidence * decayMultiplier,
      }))
      .filter(t => {
        const turnsSinceSeen = currentTurn - recentTurns.filter(r => r.timestamp <= t.lastSeen).length;
        return turnsSinceSeen < this.config.topicDecayTurns && t.confidence > 0.1;
      })
      .sort((a, b) => b.confidence * b.frequency - a.confidence * a.frequency)
      .slice(0, this.config.maxActiveTopics);

    // Predict follow-ups
    const anticipatedFollowUps = predictFollowUps(
      goal,
      prunedTopics,
      this.config.maxAnticipatedFollowUps,
    );

    // Proactive suggestions based on goal and topic
    const suggestedProactiveInfo = this.generateProactiveSuggestions(
      goal,
      prunedTopics,
      recentTurns.length,
    );

    // Goal progress estimation
    const goalProgressPct = this.estimateGoalProgress(goal, recentTurns);

    const totalTokens = recentTurns.reduce((s, t) => s + t.tokenEstimate, 0);

    const plan: ConversationPlan = {
      sessionId,
      goal,
      goalConfidence,
      activeTopics: prunedTopics,
      anticipatedFollowUps,
      suggestedProactiveInfo,
      topicShiftDetected,
      goalProgressPct,
      turnCount: recentTurns.filter(t => t.role === "user").length,
      totalTokensEstimate: totalTokens,
      lastUpdated: now,
    };

    this.plans.set(sessionId, plan);

    log.debug("conversation_plan_updated", {
      sessionId,
      goal,
      goalConfidence: goalConfidence.toFixed(2),
      topicCount: prunedTopics.length,
      topicShiftDetected,
      goalProgressPct,
      turnCount: plan.turnCount,
    });

    return plan;
  }

  /** Retrieve the current plan without modifying it */
  getPlan(sessionId: string): ConversationPlan | undefined {
    return this.plans.get(sessionId);
  }

  /** Evict session data on logout / session expiry */
  evict(sessionId: string): void {
    this.plans.delete(sessionId);
    this.turnHistory.delete(sessionId);
  }

  /** Return recent turns as context messages for the LLM */
  getContextWindow(
    sessionId: string,
    maxTokens: number,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const turns = this.turnHistory.get(sessionId) ?? [];
    const result: typeof turns = [];
    let tokens = 0;

    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (tokens + turn.tokenEstimate > maxTokens) break;
      result.unshift(turn);
      tokens += turn.tokenEstimate;
    }

    return result.map(t => ({ role: t.role, content: t.content }));
  }

  private generateProactiveSuggestions(
    goal: ConversationGoal,
    topics: TopicNode[],
    turnCount: number,
  ): string[] {
    const suggestions: string[] = [];

    // Offer examples after explanation turns
    if (goal === "learn_topic" && turnCount === 2) {
      suggestions.push("Would you like a practical example?");
    }

    // Offer testing guidance after build turns
    if (goal === "build_feature" && turnCount >= 3) {
      suggestions.push("Want me to generate tests for this implementation?");
    }

    // Offer a summary after many research turns
    if (goal === "research" && turnCount >= 5 && turnCount % 5 === 0) {
      suggestions.push("Should I summarize what we've covered so far?");
    }

    return suggestions.slice(0, this.config.maxProactiveSuggestions);
  }

  private estimateGoalProgress(
    goal: ConversationGoal,
    turns: ConversationTurn[],
  ): number {
    const userTurns = turns.filter(t => t.role === "user").length;

    // Rough heuristics per goal type
    const goalLengths: Record<ConversationGoal, number> = {
      learn_topic: 4,
      debug_code: 3,
      build_feature: 6,
      research: 5,
      data_analysis: 4,
      creative_project: 8,
      planning: 4,
      get_advice: 2,
      casual_chat: 1,
      unknown: 3,
    };

    const expectedTurns = goalLengths[goal] ?? 3;
    return Math.min(100, Math.round((userTurns / expectedTurns) * 100));
  }
}

export const conversationPlanner = new ConversationPlanner();
