import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "ClaudeExtendedThinking" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskComplexity = "trivial" | "simple" | "moderate" | "complex" | "expert";

export interface ThinkingBudgetConfig {
  trivial: number;    // 1024
  simple: number;     // 4096
  moderate: number;   // 8192
  complex: number;    // 16384
  expert: number;     // 32768
}

export interface ParsedThinking {
  rawThinking: string;
  plan: string[];
  reasoningSteps: ReasoningStep[];
  uncertainties: string[];
  alternativesConsidered: Alternative[];
  keyInsights: string[];
  confidenceScore: number; // 0-1
  thinkingTokens: number;
}

export interface ReasoningStep {
  stepNumber: number;
  description: string;
  conclusion: string;
  confidence: "high" | "medium" | "low";
}

export interface Alternative {
  approach: string;
  reasoning: string;
  whyRejected: string;
}

export interface ThinkingSession {
  sessionId: string;
  taskDescription: string;
  taskHash: string;
  complexity: TaskComplexity;
  budgetTokens: number;
  parsedThinking: ParsedThinking;
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  durationMs: number;
  qualityScore?: number; // set by caller after evaluating result
  timestamp: number;
}

export interface ThinkingCacheEntry {
  taskHash: string;
  taskDescription: string;
  complexity: TaskComplexity;
  sessions: ThinkingSession[];
  avgQualityScore: number;
  hitCount: number;
  lastAccessedAt: number;
}

export interface BudgetComparison {
  taskDescription: string;
  results: Array<{
    budget: number;
    complexity: TaskComplexity;
    qualityScore: number;
    thinkingTokens: number;
    responseLength: number;
    reasoningSteps: number;
    durationMs: number;
  }>;
  optimalBudget: number;
  recommendation: string;
}

export interface BudgetHistory {
  complexity: TaskComplexity;
  attempts: Array<{
    budgetUsed: number;
    qualityScore: number;
    timestamp: number;
  }>;
  suggestedBudget: number;
  confidence: number;
}

// ─── Thinking parser ──────────────────────────────────────────────────────────

function parseThinkingContent(rawThinking: string): Omit<ParsedThinking, "rawThinking" | "thinkingTokens"> {
  const lines = rawThinking.split("\n").filter((l) => l.trim());

  // Extract plan items (lines starting with numbered bullets or "plan:")
  const planLines = lines.filter(
    (l) =>
      /^\d+\.\s/.test(l) ||
      l.toLowerCase().startsWith("step ") ||
      l.toLowerCase().startsWith("plan:")
  );
  const plan = planLines.map((l) => l.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);

  // Extract uncertainties (lines with "not sure", "unclear", "uncertain", "maybe", "might")
  const uncertaintyKeywords = ["not sure", "unclear", "uncertain", "might", "could be", "possibly", "unsure", "ambiguous"];
  const uncertainties = lines
    .filter((l) => uncertaintyKeywords.some((kw) => l.toLowerCase().includes(kw)))
    .map((l) => l.trim())
    .slice(0, 5);

  // Extract alternatives ("alternatively", "another approach", "instead of", "or we could")
  const altKeywords = ["alternatively", "another approach", "instead of", "or we could", "another option", "could also"];
  const alternativesConsidered: Alternative[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (altKeywords.some((kw) => line.toLowerCase().includes(kw))) {
      alternativesConsidered.push({
        approach: line.trim(),
        reasoning: lines[i + 1]?.trim() ?? "",
        whyRejected: lines[i + 2]?.trim() ?? "",
      });
    }
  }

  // Build reasoning steps from paragraphs
  const paragraphs = rawThinking.split(/\n{2,}/).filter((p) => p.trim().length > 30);
  const reasoningSteps: ReasoningStep[] = paragraphs.slice(0, 6).map((para, i) => {
    const hasHighConf =
      para.toLowerCase().includes("clearly") ||
      para.toLowerCase().includes("definitely") ||
      para.toLowerCase().includes("certainly");
    const hasLowConf =
      para.toLowerCase().includes("might") ||
      para.toLowerCase().includes("perhaps") ||
      para.toLowerCase().includes("not sure");

    const sentenceMatch = para.match(/[.!?]\s+([A-Z][^.!?]{10,}[.!?])/);
    const conclusion = sentenceMatch ? sentenceMatch[1] : para.slice(-80).trim();

    return {
      stepNumber: i + 1,
      description: para.slice(0, 120).trim(),
      conclusion,
      confidence: hasHighConf ? "high" : hasLowConf ? "low" : "medium",
    };
  });

  // Key insights (sentences with "key", "important", "critical", "insight")
  const insightKeywords = ["key", "important", "critical", "insight", "notable", "significant"];
  const keyInsights = lines
    .filter((l) => insightKeywords.some((kw) => l.toLowerCase().includes(kw)))
    .map((l) => l.trim())
    .slice(0, 5);

  // Confidence score: ratio of high-confidence steps
  const highConf = reasoningSteps.filter((s) => s.confidence === "high").length;
  const confidenceScore =
    reasoningSteps.length > 0 ? highConf / reasoningSteps.length : 0.5;

  return {
    plan,
    reasoningSteps,
    uncertainties,
    alternativesConsidered,
    keyInsights,
    confidenceScore,
  };
}

// ─── Complexity classifier ────────────────────────────────────────────────────

function classifyTaskComplexity(taskDescription: string): TaskComplexity {
  const lower = taskDescription.toLowerCase();
  const wordCount = taskDescription.split(/\s+/).length;

  const expertKeywords = [
    "algorithm", "architecture", "distributed", "concurrency", "proof",
    "theorem", "optimize", "ml model", "neural", "research", "analyze deeply",
  ];
  const complexKeywords = [
    "design", "implement", "refactor", "explain", "compare", "evaluate",
    "strategy", "plan", "complex", "multiple", "integrate",
  ];
  const simpleKeywords = [
    "what is", "define", "list", "simple", "quick", "basic", "explain briefly",
  ];

  if (expertKeywords.some((kw) => lower.includes(kw)) || wordCount > 100) return "expert";
  if (complexKeywords.some((kw) => lower.includes(kw)) || wordCount > 50) return "complex";
  if (wordCount > 20) return "moderate";
  if (simpleKeywords.some((kw) => lower.includes(kw)) || wordCount <= 10) return "simple";
  return "moderate";
}

// ─── Task hasher ──────────────────────────────────────────────────────────────

function hashTask(taskDescription: string): string {
  // Normalize: lowercase, remove punctuation, sort words
  const normalized = taskDescription
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .sort()
    .join(" ");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

// ─── ClaudeExtendedThinking ───────────────────────────────────────────────────

export class ClaudeExtendedThinking extends EventEmitter {
  private cache = new Map<string, ThinkingCacheEntry>(); // taskHash → entry
  private budgetHistory = new Map<TaskComplexity, BudgetHistory>(); // complexity → history
  private sessions: ThinkingSession[] = [];

  private readonly budgetConfig: ThinkingBudgetConfig = {
    trivial: 1024,
    simple: 4096,
    moderate: 8192,
    complex: 16384,
    expert: 32768,
  };

  constructor(
    private readonly backbone = getClaudeAgentBackbone(),
    budgetOverrides: Partial<ThinkingBudgetConfig> = {}
  ) {
    super();
    Object.assign(this.budgetConfig, budgetOverrides);
    logger.info("[ClaudeExtendedThinking] Initialized");
  }

  // ── Main thinking call ────────────────────────────────────────────────────────

  async think(
    taskDescription: string,
    messages: AgentMessage[],
    opts: {
      complexity?: TaskComplexity;
      budgetOverride?: number;
      useCache?: boolean;
      systemPrompt?: string;
      model?: string;
    } = {}
  ): Promise<ThinkingSession> {
    const {
      useCache = true,
      systemPrompt,
      model = CLAUDE_MODELS.OPUS,
    } = opts;

    const complexity = opts.complexity ?? classifyTaskComplexity(taskDescription);
    const taskHash = hashTask(taskDescription);

    // Check cache
    if (useCache) {
      const cached = this.checkCache(taskHash, complexity);
      if (cached) {
        logger.debug({ taskHash, complexity }, "[ClaudeExtendedThinking] Cache hit");
        this.emit("thinking:cache_hit", { taskHash, complexity });
        return cached;
      }
    }

    // Determine budget
    const budgetTokens = opts.budgetOverride ?? this.getAdaptiveBudget(complexity);

    logger.info(
      { complexity, budgetTokens, taskHash },
      "[ClaudeExtendedThinking] Starting extended thinking"
    );

    this.emit("thinking:started", { taskHash, complexity, budgetTokens });

    const start = Date.now();

    const response = await this.backbone.call(messages, {
      model,
      maxTokens: Math.max(budgetTokens, 8192),
      system: systemPrompt,
      thinking: { enabled: true, budgetTokens },
    });

    const durationMs = Date.now() - start;

    // Parse thinking content
    const parsed = parseThinkingContent(response.thinkingContent);
    const parsedThinking: ParsedThinking = {
      rawThinking: response.thinkingContent,
      thinkingTokens: response.usage.inputTokens, // approximate
      ...parsed,
    };

    const session: ThinkingSession = {
      sessionId: randomUUID(),
      taskDescription,
      taskHash,
      complexity,
      budgetTokens,
      parsedThinking,
      responseText: response.text,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      thinkingTokens: response.thinkingContent.length,
      durationMs,
      timestamp: Date.now(),
    };

    this.sessions.push(session);
    if (this.sessions.length > 1000) this.sessions.shift();

    // Update cache
    this.updateCache(taskHash, taskDescription, complexity, session);

    logger.info(
      {
        sessionId: session.sessionId,
        complexity,
        budgetTokens,
        thinkingChars: response.thinkingContent.length,
        reasoningSteps: parsedThinking.reasoningSteps.length,
        uncertainties: parsedThinking.uncertainties.length,
        durationMs,
      },
      "[ClaudeExtendedThinking] Thinking completed"
    );

    this.emit("thinking:completed", session);
    return session;
  }

  // ── Streaming thinking ────────────────────────────────────────────────────────

  async *streamThinking(
    taskDescription: string,
    messages: AgentMessage[],
    opts: {
      complexity?: TaskComplexity;
      budgetOverride?: number;
      systemPrompt?: string;
    } = {}
  ): AsyncGenerator<{
    type: "thinking_delta" | "text_delta" | "thinking_complete" | "done";
    content?: string;
    parsedThinking?: ParsedThinking;
  }> {
    const complexity = opts.complexity ?? classifyTaskComplexity(taskDescription);
    const budgetTokens = opts.budgetOverride ?? this.getAdaptiveBudget(complexity);

    logger.info({ complexity, budgetTokens }, "[ClaudeExtendedThinking] Streaming thinking");

    let thinkingBuffer = "";
    let textBuffer = "";

    for await (const event of this.backbone.stream(messages, {
      model: CLAUDE_MODELS.OPUS,
      maxTokens: Math.max(budgetTokens, 8192),
      system: opts.systemPrompt,
      thinking: { enabled: true, budgetTokens },
    })) {
      if (event.type === "thinking_delta") {
        thinkingBuffer += event.content ?? "";
        yield { type: "thinking_delta", content: event.content };
      } else if (event.type === "text_delta") {
        textBuffer += event.content ?? "";
        yield { type: "text_delta", content: event.content };
      } else if (event.type === "message_stop") {
        // Parse and emit final thinking summary
        const parsed = parseThinkingContent(thinkingBuffer);
        const parsedThinking: ParsedThinking = {
          rawThinking: thinkingBuffer,
          thinkingTokens: thinkingBuffer.length,
          ...parsed,
        };
        yield { type: "thinking_complete", parsedThinking };
        yield { type: "done" };
      }
    }
  }

  // ── Budget management ─────────────────────────────────────────────────────────

  getAdaptiveBudget(complexity: TaskComplexity): number {
    const history = this.budgetHistory.get(complexity);

    // If we have enough history with good quality, use suggested budget
    if (history && history.confidence > 0.7 && history.attempts.length >= 3) {
      logger.debug(
        { complexity, suggestedBudget: history.suggestedBudget },
        "[ClaudeExtendedThinking] Using adaptive budget"
      );
      return history.suggestedBudget;
    }

    return this.budgetConfig[complexity];
  }

  recordQualityFeedback(sessionId: string, qualityScore: number): void {
    const session = this.sessions.find((s) => s.sessionId === sessionId);
    if (!session) return;

    session.qualityScore = qualityScore;

    // Update budget history
    const history = this.budgetHistory.get(session.complexity) ?? {
      complexity: session.complexity,
      attempts: [],
      suggestedBudget: this.budgetConfig[session.complexity],
      confidence: 0,
    };

    history.attempts.push({
      budgetUsed: session.budgetTokens,
      qualityScore,
      timestamp: Date.now(),
    });

    // Adjust suggested budget based on quality
    const recent = history.attempts.slice(-5);
    const avgQuality = recent.reduce((s, a) => s + a.qualityScore, 0) / recent.length;

    if (avgQuality < 0.6 && session.budgetTokens < this.budgetConfig.expert) {
      // Increase budget for better quality
      history.suggestedBudget = Math.min(
        session.budgetTokens * 1.5,
        this.budgetConfig.expert
      );
    } else if (avgQuality >= 0.85 && session.budgetTokens > this.budgetConfig.trivial) {
      // Budget is sufficient — try reducing slightly
      history.suggestedBudget = Math.max(
        session.budgetTokens * 0.85,
        this.budgetConfig.trivial
      );
    }

    history.confidence = Math.min(1, history.attempts.length / 10);
    this.budgetHistory.set(session.complexity, history);

    // Also update cache quality score
    const cacheEntry = this.cache.get(session.taskHash);
    if (cacheEntry) {
      const cachedSession = cacheEntry.sessions.find((s) => s.sessionId === sessionId);
      if (cachedSession) cachedSession.qualityScore = qualityScore;

      const validScores = cacheEntry.sessions
        .map((s) => s.qualityScore)
        .filter((s): s is number => s !== undefined);
      cacheEntry.avgQualityScore =
        validScores.length > 0
          ? validScores.reduce((a, b) => a + b, 0) / validScores.length
          : 0;
    }

    this.emit("quality:recorded", { sessionId, qualityScore, complexity: session.complexity });
  }

  // ── Budget comparison ─────────────────────────────────────────────────────────

  async compareBudgets(
    taskDescription: string,
    budgets: number[],
    messages: AgentMessage[]
  ): Promise<BudgetComparison> {
    logger.info(
      { budgets, task: taskDescription.slice(0, 60) },
      "[ClaudeExtendedThinking] Comparing budgets"
    );

    const results: BudgetComparison["results"] = [];

    for (const budget of budgets) {
      const complexity: TaskComplexity =
        budget <= 4096
          ? "simple"
          : budget <= 8192
          ? "moderate"
          : budget <= 16384
          ? "complex"
          : "expert";

      const start = Date.now();
      const session = await this.think(taskDescription, messages, {
        budgetOverride: budget,
        complexity,
        useCache: false,
      });

      results.push({
        budget,
        complexity,
        qualityScore: session.qualityScore ?? 0.5,
        thinkingTokens: session.thinkingTokens,
        responseLength: session.responseText.length,
        reasoningSteps: session.parsedThinking.reasoningSteps.length,
        durationMs: Date.now() - start,
      });
    }

    // Find optimal: highest quality per token spent
    const scored = results.map((r) => ({
      ...r,
      efficiency: r.qualityScore / (r.thinkingTokens / 1000 + 1),
    }));

    const optimal = scored.reduce((best, r) =>
      r.efficiency > best.efficiency ? r : best
    );

    const recommendation = `Budget ${optimal.budget} tokens achieved best efficiency (${
      optimal.reasoningSteps
    } reasoning steps, ${optimal.responseLength} chars response).`;

    return {
      taskDescription,
      results,
      optimalBudget: optimal.budget,
      recommendation,
    };
  }

  // ── Cache management ──────────────────────────────────────────────────────────

  private checkCache(
    taskHash: string,
    complexity: TaskComplexity
  ): ThinkingSession | null {
    const entry = this.cache.get(taskHash);
    if (!entry) return null;

    // Only use cache if complexity matches and entry is fresh (< 1 hour)
    const fresh = Date.now() - entry.lastAccessedAt < 60 * 60 * 1000;
    if (!fresh) return null;

    const matching = entry.sessions.find(
      (s) => s.complexity === complexity
    );
    if (!matching) return null;

    entry.hitCount++;
    entry.lastAccessedAt = Date.now();
    return matching;
  }

  private updateCache(
    taskHash: string,
    taskDescription: string,
    complexity: TaskComplexity,
    session: ThinkingSession
  ): void {
    const existing = this.cache.get(taskHash) ?? {
      taskHash,
      taskDescription,
      complexity,
      sessions: [],
      avgQualityScore: 0,
      hitCount: 0,
      lastAccessedAt: Date.now(),
    };

    // Remove old session for same complexity
    existing.sessions = existing.sessions.filter((s) => s.complexity !== complexity);
    existing.sessions.push(session);
    existing.lastAccessedAt = Date.now();

    this.cache.set(taskHash, existing);

    // Prune cache if too large
    if (this.cache.size > 500) {
      const oldest = Array.from(this.cache.entries()).sort(
        ([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt
      )[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
  }

  invalidateCache(taskHash?: string): void {
    if (taskHash) {
      this.cache.delete(taskHash);
    } else {
      this.cache.clear();
    }
    this.emit("cache:invalidated", { taskHash });
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getSession(sessionId: string): ThinkingSession | null {
    return this.sessions.find((s) => s.sessionId === sessionId) ?? null;
  }

  getRecentSessions(limit = 20): ThinkingSession[] {
    return this.sessions.slice(-limit).reverse();
  }

  getBudgetHistory(complexity: TaskComplexity): BudgetHistory | null {
    return this.budgetHistory.get(complexity) ?? null;
  }

  getStats() {
    const byComplexity = new Map<TaskComplexity, number>();
    for (const s of this.sessions) {
      byComplexity.set(s.complexity, (byComplexity.get(s.complexity) ?? 0) + 1);
    }

    const scored = this.sessions.filter((s) => s.qualityScore !== undefined);
    const avgQuality =
      scored.length > 0
        ? scored.reduce((a, s) => a + (s.qualityScore ?? 0), 0) / scored.length
        : 0;

    return {
      totalSessions: this.sessions.length,
      cacheSize: this.cache.size,
      avgQualityScore: avgQuality,
      byComplexity: Object.fromEntries(byComplexity.entries()),
      adaptiveBudgets: Object.fromEntries(
        Array.from(this.budgetHistory.entries()).map(([k, v]) => [
          k,
          { suggested: v.suggestedBudget, confidence: v.confidence },
        ])
      ),
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: ClaudeExtendedThinking | null = null;

export function getClaudeExtendedThinking(
  budgetOverrides?: Partial<ThinkingBudgetConfig>
): ClaudeExtendedThinking {
  if (!_instance) _instance = new ClaudeExtendedThinking(undefined, budgetOverrides);
  return _instance;
}
