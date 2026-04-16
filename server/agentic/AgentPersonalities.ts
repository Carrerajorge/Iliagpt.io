import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import { CLAUDE_MODELS } from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "AgentPersonalities" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type PersonalityId =
  | "methodical"
  | "creative"
  | "efficient"
  | "cautious"
  | "expert";

export type ResponseStyle =
  | "detailed_structured"
  | "exploratory_freeform"
  | "concise_direct"
  | "careful_verified"
  | "technical_precise";

export interface ToolPreference {
  toolName: string;
  priority: number; // 0-10
  avoidUnless: string[]; // conditions where this tool is avoided
}

export interface PersonalityConfig {
  id: PersonalityId;
  name: string;
  description: string;
  emoji: string;
  systemPrompt: string;
  model: string;
  temperature: number; // 0-1
  maxTokens: number;
  thinkingBudget?: number; // if set, use extended thinking
  toolPreferences: ToolPreference[];
  responseStyle: ResponseStyle;
  /** How many steps before checking in with user */
  autonomyLevel: number; // 1-5 (1 = ask often, 5 = very autonomous)
  /** Retry threshold — if confidence below this, retry */
  retryConfidenceThreshold: number; // 0-1
  traits: string[]; // descriptive keywords
}

export interface UserPersonalityPreference {
  userId: string;
  globalPersonality?: PersonalityId;
  taskTypePreferences: Record<string, PersonalityId>; // taskType → personality
  learnedAdjustments: PersonalityAdjustment[];
  lastUpdated: number;
}

export interface PersonalityAdjustment {
  adjustmentId: string;
  basePersonality: PersonalityId;
  field: keyof PersonalityConfig;
  originalValue: unknown;
  adjustedValue: unknown;
  reason: string;
  appliedAt: number;
  approved: boolean;
}

export interface PersonalitySession {
  sessionId: string;
  userId: string;
  agentId: string;
  personality: PersonalityId;
  startedAt: number;
  taskType?: string;
  feedbackScore?: number; // 0-1
  feedbackNotes?: string;
}

// ─── Personality definitions ──────────────────────────────────────────────────

const PERSONALITY_CONFIGS: Record<PersonalityId, PersonalityConfig> = {
  methodical: {
    id: "methodical",
    name: "Methodical",
    description: "Step-by-step, thorough analysis with clear structure",
    emoji: "🔬",
    systemPrompt: `You are a methodical AI assistant who approaches every task systematically.

Your approach:
1. Always break problems into discrete, ordered steps
2. Complete each step fully before moving to the next
3. Document your reasoning at each stage
4. Verify assumptions before proceeding
5. Summarize what you've done and what's next
6. Use numbered lists, headers, and structured formats
7. Double-check your work for completeness

Never skip steps. Never guess when you can verify. Structure your responses clearly.`,
    model: CLAUDE_MODELS.SONNET,
    temperature: 0.3,
    maxTokens: 4096,
    thinkingBudget: 8192,
    toolPreferences: [
      { toolName: "search", priority: 8, avoidUnless: [] },
      { toolName: "read_file", priority: 9, avoidUnless: [] },
      { toolName: "execute_code", priority: 6, avoidUnless: ["untested"] },
    ],
    responseStyle: "detailed_structured",
    autonomyLevel: 2,
    retryConfidenceThreshold: 0.85,
    traits: ["thorough", "structured", "reliable", "careful", "sequential"],
  },

  creative: {
    id: "creative",
    name: "Creative",
    description: "Lateral thinking, novel approaches, unconventional solutions",
    emoji: "🎨",
    systemPrompt: `You are a creative AI assistant who thinks laterally and explores unconventional ideas.

Your approach:
- Challenge assumptions — ask "what if this is wrong?"
- Explore multiple angles before settling on one
- Make unexpected connections between domains
- Propose novel, non-obvious solutions
- Use analogies and metaphors to explain complex ideas
- Embrace ambiguity as a creative opportunity
- Generate multiple alternatives before choosing

Don't default to the obvious answer. Ask yourself: "What's an approach nobody would think of first?"`,
    model: CLAUDE_MODELS.SONNET,
    temperature: 0.9,
    maxTokens: 3072,
    toolPreferences: [
      { toolName: "search", priority: 7, avoidUnless: [] },
      { toolName: "brainstorm", priority: 10, avoidUnless: [] },
      { toolName: "execute_code", priority: 5, avoidUnless: [] },
    ],
    responseStyle: "exploratory_freeform",
    autonomyLevel: 4,
    retryConfidenceThreshold: 0.5,
    traits: ["imaginative", "lateral", "exploratory", "novel", "associative"],
  },

  efficient: {
    id: "efficient",
    name: "Efficient",
    description: "Minimal steps, fast execution, direct answers",
    emoji: "⚡",
    systemPrompt: `You are an efficient AI assistant who values speed and directness above all.

Your approach:
- Answer the question directly — no preamble
- Use the minimum number of steps needed
- Avoid over-explaining; assume intelligence
- Skip obvious points
- Prefer action over analysis
- If something can be done in 2 steps, don't use 5
- Output only what is necessary

Get to the point. Fast. No fluff.`,
    model: CLAUDE_MODELS.HAIKU,
    temperature: 0.2,
    maxTokens: 1024,
    toolPreferences: [
      { toolName: "search", priority: 5, avoidUnless: [] },
      { toolName: "execute_code", priority: 9, avoidUnless: [] },
      { toolName: "read_file", priority: 7, avoidUnless: [] },
    ],
    responseStyle: "concise_direct",
    autonomyLevel: 5,
    retryConfidenceThreshold: 0.6,
    traits: ["fast", "direct", "concise", "pragmatic", "decisive"],
  },

  cautious: {
    id: "cautious",
    name: "Cautious",
    description: "Double-checks everything, asks for confirmation on risks",
    emoji: "🛡️",
    systemPrompt: `You are a cautious AI assistant who prioritizes safety and accuracy over speed.

Your approach:
- Always verify before acting — "measure twice, cut once"
- Explicitly state assumptions and ask if they're correct
- Flag potential risks before proceeding
- Prefer reversible actions over irreversible ones
- When uncertain, ask for clarification rather than guess
- Document what you're about to do before doing it
- Test with small examples before full execution
- Never make assumptions about user intent — confirm

If in doubt, don't proceed without confirmation. Safety first.`,
    model: CLAUDE_MODELS.SONNET,
    temperature: 0.1,
    maxTokens: 2048,
    thinkingBudget: 4096,
    toolPreferences: [
      { toolName: "read_file", priority: 10, avoidUnless: [] },
      { toolName: "search", priority: 8, avoidUnless: [] },
      { toolName: "execute_code", priority: 3, avoidUnless: ["explicitly_requested"] },
      { toolName: "write_file", priority: 2, avoidUnless: ["confirmed"] },
    ],
    responseStyle: "careful_verified",
    autonomyLevel: 1,
    retryConfidenceThreshold: 0.95,
    traits: ["safe", "verified", "confirmatory", "risk-aware", "precise"],
  },

  expert: {
    id: "expert",
    name: "Expert",
    description: "Deep domain knowledge, technical depth, assumes expertise",
    emoji: "🧠",
    systemPrompt: `You are an expert AI assistant with deep technical knowledge across multiple domains.

Your approach:
- Use precise technical terminology without over-explaining basics
- Reference relevant standards, papers, patterns, and best practices
- Provide nuanced, expert-level analysis
- Surface non-obvious implications and edge cases
- Go beyond the surface question to address the underlying need
- Recommend industry best practices with justification
- Identify when a simpler approach would suffice vs. when complexity is warranted
- Draw on cross-domain knowledge to enrich answers

Assume the user is a peer professional. Skip basics. Go deep.`,
    model: CLAUDE_MODELS.OPUS,
    temperature: 0.4,
    maxTokens: 8192,
    thinkingBudget: 16384,
    toolPreferences: [
      { toolName: "search", priority: 9, avoidUnless: [] },
      { toolName: "execute_code", priority: 8, avoidUnless: [] },
      { toolName: "read_file", priority: 9, avoidUnless: [] },
      { toolName: "analyze", priority: 10, avoidUnless: [] },
    ],
    responseStyle: "technical_precise",
    autonomyLevel: 4,
    retryConfidenceThreshold: 0.75,
    traits: ["technical", "deep", "nuanced", "authoritative", "comprehensive"],
  },
};

// ─── AgentPersonalities ───────────────────────────────────────────────────────

export class AgentPersonalities extends EventEmitter {
  private userPreferences = new Map<string, UserPersonalityPreference>();
  private activeSessions = new Map<string, PersonalitySession>();
  private sessionHistory: PersonalitySession[] = [];

  constructor() {
    super();
    logger.info("[AgentPersonalities] Initialized with personalities:", Object.keys(PERSONALITY_CONFIGS).join(", "));
  }

  // ── Personality retrieval ─────────────────────────────────────────────────────

  getPersonality(id: PersonalityId): PersonalityConfig {
    return { ...PERSONALITY_CONFIGS[id] };
  }

  listPersonalities(): PersonalityConfig[] {
    return Object.values(PERSONALITY_CONFIGS).map((p) => ({ ...p }));
  }

  // ── User preferences ──────────────────────────────────────────────────────────

  setGlobalPersonality(userId: string, personality: PersonalityId): void {
    const prefs = this.getUserPrefs(userId);
    prefs.globalPersonality = personality;
    prefs.lastUpdated = Date.now();
    this.userPreferences.set(userId, prefs);

    logger.info({ userId, personality }, "[AgentPersonalities] Global personality set");
    this.emit("preference:set", { userId, personality, scope: "global" });
  }

  setTaskTypePersonality(
    userId: string,
    taskType: string,
    personality: PersonalityId
  ): void {
    const prefs = this.getUserPrefs(userId);
    prefs.taskTypePreferences[taskType] = personality;
    prefs.lastUpdated = Date.now();
    this.userPreferences.set(userId, prefs);

    logger.info({ userId, taskType, personality }, "[AgentPersonalities] Task personality set");
    this.emit("preference:set", { userId, personality, scope: taskType });
  }

  resolvePersonality(userId: string, taskType?: string): PersonalityConfig {
    const prefs = this.userPreferences.get(userId);

    if (!prefs) return this.getPersonality("methodical"); // default

    // Task-specific preference takes priority
    if (taskType && prefs.taskTypePreferences[taskType]) {
      const base = this.getPersonality(prefs.taskTypePreferences[taskType]);
      return this.applyAdjustments(base, prefs.learnedAdjustments);
    }

    // Fall back to global
    if (prefs.globalPersonality) {
      const base = this.getPersonality(prefs.globalPersonality);
      return this.applyAdjustments(base, prefs.learnedAdjustments);
    }

    return this.getPersonality("methodical");
  }

  private applyAdjustments(
    base: PersonalityConfig,
    adjustments: PersonalityAdjustment[]
  ): PersonalityConfig {
    const result = { ...base };
    for (const adj of adjustments.filter((a) => a.approved && a.basePersonality === base.id)) {
      // Type-safe field assignment
      (result as Record<string, unknown>)[adj.field] = adj.adjustedValue;
    }
    return result;
  }

  // ── Personality learning ──────────────────────────────────────────────────────

  recordFeedback(
    sessionId: string,
    score: number, // 0-1
    notes?: string
  ): void {
    const session = this.activeSessions.get(sessionId) ??
      this.sessionHistory.find((s) => s.sessionId === sessionId);

    if (!session) {
      logger.warn({ sessionId }, "[AgentPersonalities] Session not found for feedback");
      return;
    }

    session.feedbackScore = score;
    session.feedbackNotes = notes;

    // Learn: if score is consistently low for this personality+taskType, suggest adjustment
    this.learnFromFeedback(session);

    this.emit("feedback:recorded", { sessionId, score, personality: session.personality });
  }

  private learnFromFeedback(session: PersonalitySession): void {
    const prefs = this.getUserPrefs(session.userId);
    const recentSessions = this.sessionHistory.filter(
      (s) =>
        s.userId === session.userId &&
        s.personality === session.personality &&
        s.taskType === session.taskType &&
        s.feedbackScore !== undefined
    );

    if (recentSessions.length < 3) return;

    const avgScore =
      recentSessions.reduce((s, r) => s + (r.feedbackScore ?? 0), 0) /
      recentSessions.length;

    if (avgScore < 0.5) {
      // Personality isn't working well — suggest switching
      const alternative = this.suggestAlternative(session.personality, session.taskType);
      if (alternative) {
        logger.info(
          { userId: session.userId, current: session.personality, suggested: alternative },
          "[AgentPersonalities] Suggesting personality switch"
        );
        this.emit("personality:suggestion", {
          userId: session.userId,
          currentPersonality: session.personality,
          suggestedPersonality: alternative,
          reason: `Average feedback score of ${avgScore.toFixed(2)} below threshold`,
        });
      }
    } else if (avgScore >= 0.85 && session.taskType) {
      // This personality works well for this task type — lock it in
      prefs.taskTypePreferences[session.taskType] = session.personality;
      prefs.lastUpdated = Date.now();
      this.userPreferences.set(session.userId, prefs);
      logger.info(
        { userId: session.userId, taskType: session.taskType, personality: session.personality },
        "[AgentPersonalities] Task preference learned"
      );
      this.emit("preference:learned", {
        userId: session.userId,
        taskType: session.taskType,
        personality: session.personality,
      });
    }
  }

  private suggestAlternative(
    current: PersonalityId,
    taskType?: string
  ): PersonalityId | null {
    const all: PersonalityId[] = ["methodical", "creative", "efficient", "cautious", "expert"];
    const others = all.filter((p) => p !== current);

    // Simple heuristic
    if (taskType?.includes("code") || taskType?.includes("debug")) return "methodical";
    if (taskType?.includes("research") || taskType?.includes("write")) return "expert";
    if (taskType?.includes("quick") || taskType?.includes("fast")) return "efficient";

    return others[Math.floor(Math.random() * others.length)];
  }

  // ── Session management ────────────────────────────────────────────────────────

  startSession(
    userId: string,
    agentId: string,
    taskType?: string
  ): PersonalitySession {
    const personality = this.resolvePersonality(userId, taskType);

    const session: PersonalitySession = {
      sessionId: randomUUID(),
      userId,
      agentId,
      personality: personality.id,
      startedAt: Date.now(),
      taskType,
    };

    this.activeSessions.set(session.sessionId, session);

    logger.debug(
      { sessionId: session.sessionId, personality: personality.id, taskType },
      "[AgentPersonalities] Session started"
    );

    this.emit("session:started", session);
    return session;
  }

  endSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    this.activeSessions.delete(sessionId);
    this.sessionHistory.push(session);

    // Trim history
    if (this.sessionHistory.length > 1000) this.sessionHistory.shift();

    this.emit("session:ended", session);
  }

  // ── Personality customization ─────────────────────────────────────────────────

  proposeAdjustment(
    userId: string,
    personality: PersonalityId,
    field: keyof PersonalityConfig,
    newValue: unknown,
    reason: string
  ): PersonalityAdjustment {
    const prefs = this.getUserPrefs(userId);
    const config = this.getPersonality(personality);
    const originalValue = config[field];

    const adjustment: PersonalityAdjustment = {
      adjustmentId: randomUUID(),
      basePersonality: personality,
      field,
      originalValue,
      adjustedValue: newValue,
      reason,
      appliedAt: Date.now(),
      approved: false,
    };

    prefs.learnedAdjustments.push(adjustment);
    this.userPreferences.set(userId, prefs);

    this.emit("adjustment:proposed", { userId, adjustment });
    return adjustment;
  }

  approveAdjustment(userId: string, adjustmentId: string): void {
    const prefs = this.getUserPrefs(userId);
    const adj = prefs.learnedAdjustments.find((a) => a.adjustmentId === adjustmentId);
    if (adj) {
      adj.approved = true;
      this.emit("adjustment:approved", { userId, adjustmentId });
    }
  }

  // ── Blend personalities ───────────────────────────────────────────────────────

  blend(
    primary: PersonalityId,
    secondary: PersonalityId,
    primaryWeight = 0.7
  ): PersonalityConfig {
    const p = this.getPersonality(primary);
    const s = this.getPersonality(secondary);
    const w = Math.max(0, Math.min(1, primaryWeight));

    return {
      ...p,
      id: `${primary}_${secondary}` as PersonalityId,
      name: `${p.name}/${s.name}`,
      description: `Blend of ${p.name} (${Math.round(w * 100)}%) and ${s.name} (${Math.round((1 - w) * 100)}%)`,
      temperature: p.temperature * w + s.temperature * (1 - w),
      maxTokens: Math.round(p.maxTokens * w + s.maxTokens * (1 - w)),
      autonomyLevel: Math.round(p.autonomyLevel * w + s.autonomyLevel * (1 - w)),
      retryConfidenceThreshold:
        p.retryConfidenceThreshold * w + s.retryConfidenceThreshold * (1 - w),
      traits: [...new Set([...p.traits.slice(0, 3), ...s.traits.slice(0, 2)])],
      systemPrompt: `${p.systemPrompt}\n\nAdditionally, incorporate these traits from ${s.name} personality:\n${s.traits.join(", ")}.`,
    };
  }

  // ── Helper ────────────────────────────────────────────────────────────────────

  private getUserPrefs(userId: string): UserPersonalityPreference {
    return (
      this.userPreferences.get(userId) ?? {
        userId,
        taskTypePreferences: {},
        learnedAdjustments: [],
        lastUpdated: Date.now(),
      }
    );
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getUserPreferences(userId: string): UserPersonalityPreference | null {
    return this.userPreferences.get(userId) ?? null;
  }

  getActiveSession(sessionId: string): PersonalitySession | null {
    return this.activeSessions.get(sessionId) ?? null;
  }

  getSessionHistory(userId: string, limit = 20): PersonalitySession[] {
    return this.sessionHistory
      .filter((s) => s.userId === userId)
      .slice(-limit)
      .reverse();
  }

  getStats() {
    const byPersonality = new Map<string, number>();
    for (const s of this.sessionHistory) {
      byPersonality.set(s.personality, (byPersonality.get(s.personality) ?? 0) + 1);
    }

    const scored = this.sessionHistory.filter((s) => s.feedbackScore !== undefined);
    const avgFeedback =
      scored.length > 0
        ? scored.reduce((a, s) => a + (s.feedbackScore ?? 0), 0) / scored.length
        : 0;

    return {
      totalSessions: this.sessionHistory.length,
      activeSessions: this.activeSessions.size,
      byPersonality: Object.fromEntries(byPersonality.entries()),
      avgFeedbackScore: avgFeedback,
      usersConfigured: this.userPreferences.size,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: AgentPersonalities | null = null;

export function getAgentPersonalities(): AgentPersonalities {
  if (!_instance) _instance = new AgentPersonalities();
  return _instance;
}
