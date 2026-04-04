/**
 * ThinkingModes — 7 configurable reasoning modes for IliaGPT responses.
 * Auto-detected from query signals or overridden by user via slash commands.
 * Each mode configures: model tier, temperature, max_tokens, system prompt additions.
 */

import { createLogger } from "../utils/logger";

const logger = createLogger("ThinkingModes");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ThinkingModeId =
  | "quick"
  | "deep"
  | "creative"
  | "precise"
  | "code"
  | "research"
  | "debate";

export interface ThinkingModeConfig {
  id: ThinkingModeId;
  name: string;
  description: string;
  slashCommand: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPromptAddition: string;
  indicators: RegExp[];            // query patterns that suggest this mode
  weight: number;                  // detection priority weight 1-10
}

export interface ModeDetectionResult {
  mode: ThinkingModeId;
  confidence: number;              // 0.0 – 1.0
  reason: string;
  config: ThinkingModeConfig;
}

export interface ModeOverride {
  userId: string;
  conversationId: string;
  mode: ThinkingModeId;
  setAt: Date;
}

// ─── Mode Definitions ─────────────────────────────────────────────────────────

export const THINKING_MODES: Record<ThinkingModeId, ThinkingModeConfig> = {
  quick: {
    id: "quick",
    name: "Quick Answer",
    description: "Fast, concise responses for simple questions",
    slashCommand: "/quick",
    model: "claude-haiku-4-5-20251001",
    temperature: 0.3,
    maxTokens: 512,
    systemPromptAddition:
      "Be extremely concise. Answer in 1-3 sentences when possible. Skip preamble and filler.",
    indicators: [
      /^(what is|what's|who is|when (was|did|is)|where is|how (do|does|many|much|old)|define|meaning of)/i,
      /\b(quick|quickly|briefly|short|tl;?dr|tldr|just|simply)\b/i,
      /^(yes or no|true or false|is it|are (they|you|we)|can (you|i|we))/i,
    ],
    weight: 5,
  },

  deep: {
    id: "deep",
    name: "Deep Thinking",
    description: "Thorough, step-by-step analysis for complex problems",
    slashCommand: "/deep",
    model: "claude-sonnet-4-6",
    temperature: 0.6,
    maxTokens: 8192,
    systemPromptAddition:
      "Think step by step. Explore multiple angles. Show your reasoning process explicitly. Use headers to organize long responses. Be thorough — don't truncate important details.",
    indicators: [
      /\b(analyze|analyse|explain (in detail|thoroughly|deeply)|deep dive|comprehensive|thorough|elaborate|expand)\b/i,
      /\b(why|how does|what are the implications|what would happen|what causes|root cause|fundamentally)\b/i,
      /\b(complex|complicated|nuanced|philosophical|theoretical|trade-?off|pros and cons)\b/i,
      /[?]{2,}|\.\.\./,
    ],
    weight: 7,
  },

  creative: {
    id: "creative",
    name: "Creative Mode",
    description: "Imaginative, exploratory responses for brainstorming and creative work",
    slashCommand: "/creative",
    model: "claude-sonnet-4-6",
    temperature: 0.95,
    maxTokens: 4096,
    systemPromptAddition:
      "Be imaginative and original. Generate unexpected ideas. Use vivid language. Explore unconventional approaches. Don't self-censor creative ideas — present multiple directions.",
    indicators: [
      /\b(brainstorm|ideas for|creative|imagine|invent|design|create|write (a|an|the)|story|poem|scenario)\b/i,
      /\b(what if|suppose|hypothetically|alternative|novel|unique|original|innovative)\b/i,
      /\b(fiction|fantasy|sci-fi|narrative|character|plot|metaphor|analogy)\b/i,
    ],
    weight: 8,
  },

  precise: {
    id: "precise",
    name: "Precise Mode",
    description: "Exact, structured responses for technical or factual queries",
    slashCommand: "/precise",
    model: "claude-sonnet-4-6",
    temperature: 0.1,
    maxTokens: 3072,
    systemPromptAddition:
      "Be precise and accurate. Prefer numbered lists and structured formats. State confidence levels. Cite specific details. Avoid hedging language unless genuinely uncertain. Correct any inaccuracies immediately.",
    indicators: [
      /\b(exact|exactly|precisely|specific|accurate|correct|formula|calculation|number|percentage|date|statistic)\b/i,
      /\b(how many|how much|what percentage|what is the exact|specify|enumerate)\b/i,
      /\b(legal|medical|financial|official|standard|specification|requirement|protocol)\b/i,
    ],
    weight: 7,
  },

  code: {
    id: "code",
    name: "Code Mode",
    description: "Optimized for programming: complete, runnable code with explanations",
    slashCommand: "/code",
    model: "claude-sonnet-4-6",
    temperature: 0.15,
    maxTokens: 6144,
    systemPromptAddition:
      "You are an expert software engineer. Always provide complete, runnable code. Include imports. Add inline comments for non-obvious logic. Use the language the user specifies, or infer from context. Prefer idiomatic patterns. Mention time/space complexity for algorithms.",
    indicators: [
      /\b(code|function|class|method|algorithm|implement|program|script|snippet|syntax|debug|refactor|optimize)\b/i,
      /\b(python|javascript|typescript|java|golang|rust|c\+\+|sql|bash|shell|react|node)\b/i,
      /```|`[^`]+`|\bdef \b|\bfunction\b|\bconst \b|\blet \b|\bvar \b/,
      /\b(error|exception|traceback|undefined|null pointer|segfault|stack overflow)\b/i,
    ],
    weight: 9,
  },

  research: {
    id: "research",
    name: "Research Mode",
    description: "Evidence-based responses with citations, multiple sources, structured findings",
    slashCommand: "/research",
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    maxTokens: 8192,
    systemPromptAddition:
      "You are a rigorous research assistant. Structure responses with: Background, Key Findings, Evidence, Limitations, and Conclusion sections. Distinguish between established facts and emerging/contested claims. Mention when information may be outdated. Note gaps in current knowledge.",
    indicators: [
      /\b(research|study|studies|evidence|literature|paper|journal|published|academic|scientific|survey)\b/i,
      /\b(according to|recent findings|meta-analysis|systematic review|clinical trial|data shows)\b/i,
      /\b(what does (the )?research say|state of the art|current understanding|scientific consensus)\b/i,
    ],
    weight: 8,
  },

  debate: {
    id: "debate",
    name: "Debate Mode",
    description: "Present multiple perspectives with steelmanned arguments on both sides",
    slashCommand: "/debate",
    model: "claude-sonnet-4-6",
    temperature: 0.5,
    maxTokens: 5120,
    systemPromptAddition:
      "Present multiple perspectives fairly. Steelman each position — present the strongest version of each argument. Use 'Perspective A / Perspective B' or 'For / Against' structure. Avoid taking sides unless asked. Acknowledge where reasonable people disagree. Identify underlying assumptions.",
    indicators: [
      /\b(debate|controversial|argue|argument|side(s)?|perspective|opinion|view|stance|position)\b/i,
      /\b(for and against|pros and cons|advantages and disadvantages|is it (better|worse|right|wrong))\b/i,
      /\b(should (we|i|society)|ought to|is it ethical|moral(ity)?|right or wrong|good or bad)\b/i,
    ],
    weight: 7,
  },
};

// ─── Slash Command Parser ─────────────────────────────────────────────────────

const SLASH_TO_MODE: Record<string, ThinkingModeId> = Object.fromEntries(
  Object.values(THINKING_MODES).map((m) => [m.slashCommand.slice(1), m.id])
);

/**
 * Extract mode override from message content (e.g., "/deep explain this").
 * Returns { mode, cleanedMessage } or null if no slash command detected.
 */
export function extractSlashCommand(message: string): { mode: ThinkingModeId; cleanedMessage: string } | null {
  const match = message.match(/^\/([a-z]+)(\s+|$)([\s\S]*)/i);
  if (!match) return null;

  const command = match[1]!.toLowerCase();
  const rest = match[3]!.trim();

  const modeId = SLASH_TO_MODE[command];
  if (!modeId) return null;

  return { mode: modeId, cleanedMessage: rest || message };
}

// ─── Auto-Detection ───────────────────────────────────────────────────────────

/**
 * Score each mode against the message, return the highest-confidence match.
 */
function scoreMode(message: string, mode: ThinkingModeConfig): number {
  let score = 0;
  const lower = message.toLowerCase();

  for (const indicator of mode.indicators) {
    const matches = lower.match(indicator);
    if (matches) {
      score += matches.length * mode.weight;
    }
  }

  // Length heuristic: short messages → quick mode bias
  if (mode.id === "quick" && message.split(/\s+/).length < 8) score += 3;
  if (mode.id === "deep" && message.split(/\s+/).length > 30) score += 4;

  // Code block detection
  if (mode.id === "code" && (message.includes("```") || /[{}();]/.test(message))) score += 10;

  return score;
}

export function detectThinkingMode(message: string): ModeDetectionResult {
  // 1. Check slash command override first
  const slashResult = extractSlashCommand(message);
  if (slashResult) {
    const config = THINKING_MODES[slashResult.mode];
    return { mode: slashResult.mode, confidence: 1.0, reason: "slash_command", config };
  }

  // 2. Score each mode
  const scores: Array<{ id: ThinkingModeId; score: number }> = Object.values(THINKING_MODES).map((m) => ({
    id: m.id,
    score: scoreMode(message, m),
  }));

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0]!;
  const totalScore = scores.reduce((s, m) => s + m.score, 0);

  if (top.score === 0) {
    // Default to quick for short messages, deep for long
    const defaultMode = message.split(/\s+/).length > 20 ? "deep" : "quick";
    return {
      mode: defaultMode,
      confidence: 0.3,
      reason: "default_heuristic",
      config: THINKING_MODES[defaultMode],
    };
  }

  const confidence = totalScore > 0 ? Math.min(top.score / totalScore, 1.0) : 0.5;

  return {
    mode: top.id,
    confidence,
    reason: `pattern_match (score: ${top.score})`,
    config: THINKING_MODES[top.id],
  };
}

// ─── ThinkingModeManager ──────────────────────────────────────────────────────

export class ThinkingModeManager {
  private overrides = new Map<string, ModeOverride>(); // key: `${userId}:${conversationId}`

  /**
   * Set a persistent mode override for a user's conversation.
   */
  setOverride(userId: string, conversationId: string, mode: ThinkingModeId): void {
    const key = `${userId}:${conversationId}`;
    this.overrides.set(key, { userId, conversationId, mode, setAt: new Date() });
    logger.info(`Mode override set: ${mode} for user ${userId} in conversation ${conversationId}`);
  }

  clearOverride(userId: string, conversationId: string): void {
    this.overrides.delete(`${userId}:${conversationId}`);
  }

  /**
   * Resolve the active mode for a message, considering overrides and slash commands.
   */
  resolveMode(
    message: string,
    userId?: string,
    conversationId?: string
  ): ModeDetectionResult & { cleanedMessage: string } {
    // 1. Inline slash command (highest priority, clears override)
    const slashResult = extractSlashCommand(message);
    if (slashResult) {
      if (userId && conversationId) {
        this.setOverride(userId, conversationId, slashResult.mode);
      }
      const config = THINKING_MODES[slashResult.mode];
      return {
        mode: slashResult.mode,
        confidence: 1.0,
        reason: "slash_command",
        config,
        cleanedMessage: slashResult.cleanedMessage,
      };
    }

    // 2. Conversation-level override
    if (userId && conversationId) {
      const key = `${userId}:${conversationId}`;
      const override = this.overrides.get(key);
      if (override) {
        const config = THINKING_MODES[override.mode];
        return {
          mode: override.mode,
          confidence: 0.95,
          reason: "conversation_override",
          config,
          cleanedMessage: message,
        };
      }
    }

    // 3. Auto-detect
    const detected = detectThinkingMode(message);
    return { ...detected, cleanedMessage: message };
  }

  /**
   * Build the system prompt additions for a given mode + any global context.
   */
  buildSystemPromptAddition(mode: ThinkingModeId, extras?: Record<string, string>): string {
    const config = THINKING_MODES[mode];
    let addition = `\n\n## Active Reasoning Mode: ${config.name}\n${config.systemPromptAddition}`;

    if (extras?.["language"]) {
      addition += `\n\nRespond in: ${extras["language"]}.`;
    }
    if (extras?.["verbosity"]) {
      addition += `\n\nVerbosity preference: ${extras["verbosity"]}.`;
    }

    return addition;
  }

  listModes(): ThinkingModeConfig[] {
    return Object.values(THINKING_MODES);
  }

  getModeConfig(mode: ThinkingModeId): ThinkingModeConfig {
    return THINKING_MODES[mode];
  }

  /**
   * Format available modes as a user-readable help string.
   */
  formatHelp(): string {
    return Object.values(THINKING_MODES)
      .map((m) => `${m.slashCommand} — **${m.name}**: ${m.description}`)
      .join("\n");
  }
}

export const thinkingModeManager = new ThinkingModeManager();
