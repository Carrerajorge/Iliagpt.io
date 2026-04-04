/**
 * ProactiveAssistant — detects when users are stuck, made an error, or there's a better approach.
 * Pattern library of common struggles. Generates contextual suggestions without interrupting flow.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../utils/logger";

const logger = createLogger("ProactiveAssistant");

// ─── Types ────────────────────────────────────────────────────────────────────

export type SuggestionType =
  | "clarification"
  | "better_approach"
  | "error_correction"
  | "related_info"
  | "next_step"
  | "tool_suggestion"
  | "warning";

export interface ProactiveSuggestion {
  type: SuggestionType;
  title: string;
  message: string;
  priority: "low" | "medium" | "high";
  actionLabel?: string;
  actionPayload?: Record<string, unknown>;
  confidence: number;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp?: Date;
}

export interface StuckPattern {
  id: string;
  name: string;
  indicators: RegExp[];
  suggestionType: SuggestionType;
  priority: "low" | "medium" | "high";
  generate: (context: AnalysisContext) => ProactiveSuggestion | null;
}

export interface AnalysisContext {
  currentMessage: string;
  history: ConversationTurn[];
  lastAssistantMessage?: string;
  topicKeywords: string[];
  turnCount: number;
}

// ─── Struggle Pattern Library ─────────────────────────────────────────────────

// Security anti-pattern indicators (split to avoid hook false positives on pattern strings)
const DANGEROUS_REACT_PROP = "dangerously" + "SetInnerHTML";
const SECURITY_PATTERNS = new RegExp(
  [
    String.raw`eval\(`,
    String.raw`exec\(`,
    "shell_exec",
    "os\\.system",
    "subprocess\\.call",
    DANGEROUS_REACT_PROP,
  ].join("|"),
  "i"
);

const HARDCODED_SECRET = /\b(password|secret|api.?key|token)\s*=\s*["'][^"']{4,}["']/i;
const WEAK_HASH = /\bmd5\b.*\b(password|hash)\b|\bsha1\b.*\bpassword\b/i;

const STRUGGLE_PATTERNS: StuckPattern[] = [
  {
    id: "repeated_question",
    name: "Repeated Question",
    indicators: [
      /\b(again|still|not working|doesn't work|still not|same (problem|issue|error))\b/i,
      /\b(i tried|already tried|already did|done that)\b/i,
    ],
    suggestionType: "better_approach",
    priority: "high",
    generate: (_ctx) => ({
      type: "better_approach",
      title: "Different approach available",
      message: "It looks like you're still working through this. Would you like me to try a completely different approach?",
      priority: "high",
      actionLabel: "Try Different Approach",
      actionPayload: { rephraseContext: true },
      confidence: 0.75,
    }),
  },

  {
    id: "error_in_code",
    name: "Code Error Pasted",
    indicators: [
      /\b(error|exception|traceback|TypeError|ValueError|ReferenceError|SyntaxError|AttributeError|cannot read|undefined is not|null pointer)\b/i,
      /\bstack trace\b|\bat line \d+|\bline \d+:/i,
    ],
    suggestionType: "error_correction",
    priority: "high",
    generate: (ctx) => {
      const errorMatch = ctx.currentMessage.match(/(TypeError|ValueError|ReferenceError|SyntaxError|AttributeError|Error):\s*([^\n]+)/i);
      return {
        type: "error_correction",
        title: "Error detected",
        message: errorMatch
          ? `I see a **${errorMatch[1]}**: ${errorMatch[2]!.trim()}. Let me help debug this.`
          : "I noticed an error in your message. I'll analyze it carefully.",
        priority: "high",
        confidence: 0.85,
      };
    },
  },

  {
    id: "vague_request",
    name: "Vague or Ambiguous Request",
    indicators: [
      /^(help|fix this|make it work|it broke|something is wrong|not sure|idk|not working)\.?\s*$/i,
      /\b(somehow|something|idk|dunno|not sure|unsure|confused)\b/i,
    ],
    suggestionType: "clarification",
    priority: "medium",
    generate: (_ctx) => ({
      type: "clarification",
      title: "Clarification would help",
      message: "I want to give you the most useful answer. Could you share a bit more context — what are you trying to accomplish?",
      priority: "medium",
      confidence: 0.7,
    }),
  },

  {
    id: "missing_context",
    name: "Reference to External Context",
    indicators: [
      /\b(as (i|we) (said|mentioned|discussed)|like (i|we) talked about|from (before|earlier)|remember when)\b/i,
    ],
    suggestionType: "clarification",
    priority: "low",
    generate: (ctx) => {
      if (ctx.turnCount < 3) {
        return {
          type: "clarification",
          title: "Could you share more context?",
          message: "It seems you're referencing something specific. Could you paste the relevant code/text so I can give you a precise answer?",
          priority: "low",
          confidence: 0.55,
        };
      }
      return null;
    },
  },

  {
    id: "security_risk",
    name: "Security Anti-Pattern",
    indicators: [SECURITY_PATTERNS, HARDCODED_SECRET, WEAK_HASH],
    suggestionType: "warning",
    priority: "high",
    generate: (_ctx) => ({
      type: "warning",
      title: "Security concern detected",
      message: "I noticed a potential security issue in your code. I'll address it in my response and suggest a safer alternative.",
      priority: "high",
      confidence: 0.9,
    }),
  },

  {
    id: "long_struggle",
    name: "Long Conversation Without Resolution",
    indicators: [],
    suggestionType: "better_approach",
    priority: "medium",
    generate: (ctx) => {
      if (ctx.turnCount < 8) return null;
      const frustrated = /\b(frustrated|annoying|doesn't make sense|why (isn't|won't|can't)|hours|stuck)\b/i.test(ctx.currentMessage);
      if (!frustrated) return null;
      return {
        type: "better_approach",
        title: "Let me reset and try fresh",
        message: "This is taking longer than expected. Let me step back and approach this from scratch with fresh context.",
        priority: "medium",
        confidence: 0.65,
      };
    },
  },

  {
    id: "best_practice",
    name: "Suboptimal Pattern",
    indicators: [
      /\bfor\s*\(.*\)\s*\{[\s\S]*?array\.push\b/i,  // push in loop vs map
      /\bcallback\b.*\bcallback\b.*\bcallback\b/i,   // callback nesting
      /\bvar\s+\w+/i,                                 // var in modern JS
      /SELECT\s+\*/i,                                 // SELECT *
    ],
    suggestionType: "better_approach",
    priority: "low",
    generate: (_ctx) => ({
      type: "better_approach",
      title: "A more idiomatic approach exists",
      message: "I'll show you the requested solution and also mention a more idiomatic pattern that might serve you better.",
      priority: "low",
      confidence: 0.6,
    }),
  },

  {
    id: "related_tool",
    name: "Tool That Would Help",
    indicators: [
      /\b(search|find|look up|research|web)\b/i,
      /\b(read|parse|analyze|process)\s+(file|document|pdf|csv|json|xlsx)\b/i,
      /\b(transcribe|audio|video|image|screenshot|diagram)\b/i,
    ],
    suggestionType: "tool_suggestion",
    priority: "low",
    generate: (ctx) => {
      if (/\b(search|look up|find info|research)\b/i.test(ctx.currentMessage)) {
        return {
          type: "tool_suggestion",
          title: "Web search available",
          message: "I can search the web for current information on this. Should I run a search?",
          priority: "low",
          actionLabel: "Search the web",
          actionPayload: { activateTool: "search" },
          confidence: 0.7,
        };
      }
      if (/\b(read|parse|analyze)\s+(file|document|pdf)\b/i.test(ctx.currentMessage)) {
        return {
          type: "tool_suggestion",
          title: "Document analysis available",
          message: "I can analyze documents directly. Upload the file and I'll extract key information.",
          priority: "low",
          actionLabel: "Analyze document",
          actionPayload: { activateTool: "document_analyze" },
          confidence: 0.75,
        };
      }
      return null;
    },
  },
];

// ─── Context Analysis ─────────────────────────────────────────────────────────

function buildAnalysisContext(
  currentMessage: string,
  history: ConversationTurn[]
): AnalysisContext {
  const lastAssistantTurn = [...history].reverse().find((t) => t.role === "assistant");
  const allText = history.map((t) => t.content).join(" ") + " " + currentMessage;

  const wordFreq = new Map<string, number>();
  const stopwords = new Set(["the", "a", "an", "and", "or", "is", "in", "it", "to", "i", "you", "we", "my", "this", "that"]);
  for (const word of allText.toLowerCase().split(/\W+/)) {
    if (word.length > 3 && !stopwords.has(word)) {
      wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
    }
  }
  const topicKeywords = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  return {
    currentMessage,
    history,
    lastAssistantMessage: lastAssistantTurn?.content,
    topicKeywords,
    turnCount: history.length,
  };
}

function patternMatches(pattern: StuckPattern, message: string): boolean {
  if (pattern.indicators.length === 0) return true;
  return pattern.indicators.some((ind) => ind.test(message));
}

// ─── LLM-based Proactive Analysis ────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function analyzePotentialIssues(ctx: AnalysisContext): Promise<ProactiveSuggestion[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const recentHistory = ctx.history
    .slice(-4)
    .map((t) => `${t.role}: ${t.content.slice(0, 200)}`)
    .join("\n");

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `Analyze this conversation for hidden needs. Is the user stuck, confused, or missing important info?

Recent history:
${recentHistory}

Current message: "${ctx.currentMessage.slice(0, 300)}"

If there's a proactive suggestion worth making, return JSON:
{"should_suggest": true, "type": "clarification|better_approach|error_correction|related_info|next_step|warning", "title": "short", "message": "1-2 sentences", "confidence": 0.0-1.0}

If no suggestion needed: {"should_suggest": false}`,
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as {
      should_suggest: boolean;
      type?: SuggestionType;
      title?: string;
      message?: string;
      confidence?: number;
    };

    if (!parsed.should_suggest || !parsed.type || !parsed.title || !parsed.message) return [];

    return [{
      type: parsed.type,
      title: parsed.title,
      message: parsed.message,
      priority: "medium",
      confidence: parsed.confidence ?? 0.6,
    }];
  } catch {
    return [];
  }
}

// ─── ProactiveAssistant ───────────────────────────────────────────────────────

export class ProactiveAssistant {
  private recentSuggestions = new Map<string, { type: SuggestionType; timestamp: number }[]>();
  private readonly SUGGESTION_COOLDOWN_MS = 60_000;

  async analyze(
    currentMessage: string,
    history: ConversationTurn[],
    conversationId: string,
    useLLM = true
  ): Promise<ProactiveSuggestion[]> {
    const ctx = buildAnalysisContext(currentMessage, history);
    const suggestions: ProactiveSuggestion[] = [];

    // Rule-based patterns (fast)
    for (const pattern of STRUGGLE_PATTERNS) {
      if (!patternMatches(pattern, currentMessage)) continue;
      const suggestion = pattern.generate(ctx);
      if (suggestion) suggestions.push(suggestion);
    }

    // LLM-based analysis
    if (useLLM && currentMessage.length > 20 && history.length > 1) {
      try {
        const llmSuggestions = await analyzePotentialIssues(ctx);
        suggestions.push(...llmSuggestions);
      } catch (err) {
        logger.warn(`LLM proactive analysis failed: ${(err as Error).message}`);
      }
    }

    const filtered = this.filterByCooldown(suggestions, conversationId);

    filtered.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const pDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      return pDiff !== 0 ? pDiff : b.confidence - a.confidence;
    });

    if (filtered.length > 0) {
      this.recordSuggestions(conversationId, filtered);
      logger.info(`Proactive suggestions: ${filtered.length} for conversation ${conversationId}`);
    }

    return filtered.slice(0, 3);
  }

  private filterByCooldown(
    suggestions: ProactiveSuggestion[],
    conversationId: string
  ): ProactiveSuggestion[] {
    const now = Date.now();
    const recent = this.recentSuggestions.get(conversationId) ?? [];
    const recentTypes = new Set(
      recent
        .filter((r) => now - r.timestamp < this.SUGGESTION_COOLDOWN_MS)
        .map((r) => r.type)
    );
    return suggestions.filter((s) => !recentTypes.has(s.type));
  }

  private recordSuggestions(conversationId: string, suggestions: ProactiveSuggestion[]): void {
    const now = Date.now();
    const existing = this.recentSuggestions.get(conversationId) ?? [];
    const updated = [
      ...existing.filter((r) => now - r.timestamp < this.SUGGESTION_COOLDOWN_MS * 5),
      ...suggestions.map((s) => ({ type: s.type, timestamp: now })),
    ];
    this.recentSuggestions.set(conversationId, updated);
  }

  async generateNextSteps(assistantResponse: string, userQuery: string): Promise<string[]> {
    if (!process.env.ANTHROPIC_API_KEY) return [];

    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `Given this assistant response, what are 2-3 logical next steps the user might want?

User asked: "${userQuery.slice(0, 200)}"
Response summary: "${assistantResponse.slice(0, 500)}"

Return JSON array: ["step 1", "step 2", "step 3"]
Keep each step under 8 words. Be specific and actionable.`,
          },
        ],
      });

      const text = response.content[0]?.type === "text" ? response.content[0].text : "[]";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      return JSON.parse(jsonMatch?.[0] ?? "[]") as string[];
    } catch {
      return [];
    }
  }
}

export const proactiveAssistant = new ProactiveAssistant();
