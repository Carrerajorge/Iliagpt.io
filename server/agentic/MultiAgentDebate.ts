import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "MultiAgentDebate" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type DebaterRole = "optimist" | "skeptic" | "analyst";

export type DebateStatus =
  | "initializing"
  | "opening_statements"
  | "debate_rounds"
  | "synthesizing"
  | "completed"
  | "failed";

export interface Argument {
  argumentId: string;
  debaterId: string;
  role: DebaterRole;
  round: number;
  content: string;
  thinkingContent: string;
  /** Points raised in support */
  supportPoints: string[];
  /** Attacks against prior arguments */
  rebuttals: Array<{ targetArgumentId: string; rebuttal: string }>;
  /** How confident the debater is in this argument */
  confidence: number;
  tokensUsed: number;
  timestamp: number;
}

export interface ArgumentScore {
  argumentId: string;
  logicalConsistency: number; // 0-1
  evidenceStrength: number; // 0-1
  novelty: number; // 0-1 (penalizes repeating prior arguments)
  rebuttalQuality: number; // 0-1
  overallScore: number; // weighted average
}

export interface DebateRound {
  roundNumber: number;
  arguments: Argument[];
  scores: ArgumentScore[];
  consensusLevel: number; // 0-1
  dominantPosition?: string;
}

export interface DebateSynthesis {
  question: string;
  consensus: string;
  keyAgreements: string[];
  keyDisagreements: string[];
  winningArguments: Array<{ argumentId: string; reason: string }>;
  recommendation: string;
  confidence: number;
  thinkingContent: string;
  minorityView?: string;
}

export interface DebateSession {
  debateId: string;
  question: string;
  context: string;
  status: DebateStatus;
  rounds: DebateRound[];
  synthesis?: DebateSynthesis;
  totalRounds: number;
  createdAt: number;
  completedAt?: number;
  totalTokensUsed: number;
  estimatedCostUSD: number;
}

export interface DebateOptions {
  maxRounds?: number; // default 3
  earlyStopConsensusThreshold?: number; // default 0.85 — stop if all agree
  thinkingBudgetTokens?: number; // default 10_000
  includeSynthesis?: boolean; // default true
}

// ─── Debater personas ─────────────────────────────────────────────────────────

const DEBATER_PERSONAS: Record<DebaterRole, { name: string; systemPrompt: string }> = {
  optimist: {
    name: "Optimist",
    systemPrompt: `You are the Optimist debater. Your role is to:
- Identify the best possible outcomes and opportunities
- Highlight strengths and positive aspects
- Propose ambitious but achievable solutions
- Challenge overly cautious thinking
- Be genuinely enthusiastic but intellectually honest
- Steel-man the most favorable interpretation

When arguing, be assertive but back up claims with reasoning.
Output valid JSON only.`,
  },
  skeptic: {
    name: "Skeptic",
    systemPrompt: `You are the Skeptic debater. Your role is to:
- Challenge assumptions and identify weak points
- Ask "what could go wrong?"
- Point out missing evidence or overconfidence
- Highlight risks, edge cases, and failure modes
- Play devil's advocate — even for positions you might personally agree with
- Be rigorous and demand evidence

When arguing, be direct and critical but constructive.
Output valid JSON only.`,
  },
  analyst: {
    name: "Analyst",
    systemPrompt: `You are the Analyst debater. Your role is to:
- Synthesize information objectively
- Weigh tradeoffs systematically
- Quantify when possible; qualify when not
- Identify where Optimist and Skeptic are both partly right
- Propose middle-ground solutions
- Focus on root causes, not symptoms

When arguing, be precise and data-driven.
Output valid JSON only.`,
  },
};

// ─── Argument scorer ──────────────────────────────────────────────────────────

async function scoreArgument(
  argument: Argument,
  priorArguments: Argument[],
  backbone: ReturnType<typeof getClaudeAgentBackbone>
): Promise<ArgumentScore> {
  const priorContent = priorArguments
    .map((a) => `[${a.role}]: ${a.content.slice(0, 200)}`)
    .join("\n");

  const messages: AgentMessage[] = [
    {
      role: "user",
      content: `Score this debate argument.

ARGUMENT BY ${argument.role.toUpperCase()}:
${argument.content}

PRIOR ARGUMENTS IN DEBATE:
${priorContent || "(none)"}

Score each dimension 0-1:
- logicalConsistency: internal logic quality
- evidenceStrength: quality of evidence/reasoning
- novelty: does it add new insights vs repeat prior args?
- rebuttalQuality: how well does it address prior arguments?

Output JSON: { "logicalConsistency": 0.0, "evidenceStrength": 0.0, "novelty": 0.0, "rebuttalQuality": 0.0 }`,
    },
  ];

  const response = await backbone.call(messages, {
    model: CLAUDE_MODELS.HAIKU,
    maxTokens: 256,
    system: "Score debate arguments objectively. Return valid JSON only.",
  });

  let scores = {
    logicalConsistency: 0.5,
    evidenceStrength: 0.5,
    novelty: 0.5,
    rebuttalQuality: 0.5,
  };

  try {
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      scores = { ...scores, ...parsed };
    }
  } catch {
    // Use defaults
  }

  const overallScore =
    scores.logicalConsistency * 0.3 +
    scores.evidenceStrength * 0.3 +
    scores.novelty * 0.2 +
    scores.rebuttalQuality * 0.2;

  return {
    argumentId: argument.argumentId,
    ...scores,
    overallScore,
  };
}

// ─── MultiAgentDebate ─────────────────────────────────────────────────────────

export class MultiAgentDebate extends EventEmitter {
  private sessions = new Map<string, DebateSession>();

  constructor(
    private readonly backbone = getClaudeAgentBackbone()
  ) {
    super();
    logger.info("[MultiAgentDebate] Initialized");
  }

  // ── Start debate ──────────────────────────────────────────────────────────────

  async debate(
    question: string,
    context: string,
    opts: DebateOptions = {}
  ): Promise<DebateSession> {
    const {
      maxRounds = 3,
      earlyStopConsensusThreshold = 0.85,
      thinkingBudgetTokens = 10_000,
      includeSynthesis = true,
    } = opts;

    const session: DebateSession = {
      debateId: randomUUID(),
      question,
      context,
      status: "initializing",
      rounds: [],
      totalRounds: maxRounds,
      createdAt: Date.now(),
      totalTokensUsed: 0,
      estimatedCostUSD: 0,
    };

    this.sessions.set(session.debateId, session);

    logger.info(
      { debateId: session.debateId, question: question.slice(0, 80) },
      "[MultiAgentDebate] Debate started"
    );

    this.emit("debate:started", { debateId: session.debateId, question });

    try {
      // Opening statements
      session.status = "opening_statements";
      this.emit("debate:status", { debateId: session.debateId, status: session.status });

      const openingRound = await this.runRound(
        session,
        0,
        [],
        thinkingBudgetTokens,
        true
      );
      session.rounds.push(openingRound);

      // Debate rounds
      session.status = "debate_rounds";

      for (let round = 1; round <= maxRounds; round++) {
        // Check for early consensus
        const lastRound = session.rounds.at(-1)!;
        if (lastRound.consensusLevel >= earlyStopConsensusThreshold) {
          logger.info(
            {
              debateId: session.debateId,
              round,
              consensus: lastRound.consensusLevel,
            },
            "[MultiAgentDebate] Early consensus reached"
          );
          this.emit("debate:early_consensus", {
            debateId: session.debateId,
            round,
            consensusLevel: lastRound.consensusLevel,
          });
          break;
        }

        const allPriorArguments = session.rounds.flatMap((r) => r.arguments);
        const debateRound = await this.runRound(
          session,
          round,
          allPriorArguments,
          thinkingBudgetTokens,
          false
        );
        session.rounds.push(debateRound);

        this.emit("debate:round_completed", {
          debateId: session.debateId,
          round,
          consensusLevel: debateRound.consensusLevel,
        });
      }

      // Synthesis
      if (includeSynthesis) {
        session.status = "synthesizing";
        this.emit("debate:status", { debateId: session.debateId, status: session.status });
        session.synthesis = await this.synthesize(
          session,
          thinkingBudgetTokens
        );
      }

      session.status = "completed";
      session.completedAt = Date.now();

      logger.info(
        {
          debateId: session.debateId,
          rounds: session.rounds.length,
          tokens: session.totalTokensUsed,
          consensus: session.rounds.at(-1)?.consensusLevel,
        },
        "[MultiAgentDebate] Debate completed"
      );

      this.emit("debate:completed", session);
    } catch (err) {
      session.status = "failed";
      logger.error({ err, debateId: session.debateId }, "[MultiAgentDebate] Debate failed");
      this.emit("debate:failed", { debateId: session.debateId, error: String(err) });
    }

    return session;
  }

  // ── Round execution ───────────────────────────────────────────────────────────

  private async runRound(
    session: DebateSession,
    roundNumber: number,
    priorArguments: Argument[],
    thinkingBudget: number,
    isOpening: boolean
  ): Promise<DebateRound> {
    const roles: DebaterRole[] = ["optimist", "skeptic", "analyst"];

    // Run all 3 debaters in parallel
    const argumentPromises = roles.map((role) =>
      this.generateArgument(
        session.question,
        session.context,
        role,
        roundNumber,
        priorArguments,
        thinkingBudget,
        isOpening
      )
    );

    const arguments_ = await Promise.all(argumentPromises);

    // Score all arguments
    const scorePromises = arguments_.map((arg, i) =>
      scoreArgument(arg, [...priorArguments, ...arguments_.slice(0, i)], this.backbone)
    );
    const scores = await Promise.all(scorePromises);

    // Compute consensus level
    const consensusLevel = this.computeConsensusLevel(arguments_);

    // Find dominant position
    const highestScore = scores.reduce((best, s) =>
      s.overallScore > best.overallScore ? s : best
    );
    const dominantArg = arguments_.find(
      (a) => a.argumentId === highestScore.argumentId
    );

    // Update session token totals
    for (const arg of arguments_) {
      session.totalTokensUsed += arg.tokensUsed;
    }
    session.estimatedCostUSD = (session.totalTokensUsed / 1_000_000) * 3.0; // Sonnet pricing

    return {
      roundNumber,
      arguments: arguments_,
      scores,
      consensusLevel,
      dominantPosition: dominantArg?.content.slice(0, 200),
    };
  }

  // ── Individual argument generation ───────────────────────────────────────────

  private async generateArgument(
    question: string,
    context: string,
    role: DebaterRole,
    round: number,
    priorArguments: Argument[],
    thinkingBudget: number,
    isOpening: boolean
  ): Promise<Argument> {
    const persona = DEBATER_PERSONAS[role];

    const priorSummary =
      priorArguments.length > 0
        ? `\nPRIOR ARGUMENTS:\n${priorArguments
            .map(
              (a) =>
                `[Round ${a.round}, ${a.role.toUpperCase()}, ID:${a.argumentId.slice(0, 8)}]: ${a.content.slice(0, 300)}`
            )
            .join("\n\n")}`
        : "";

    const instruction = isOpening
      ? "Provide your opening statement with your initial position."
      : `Round ${round}: Respond to prior arguments. Attack weak points, defend your position, refine your view if needed.`;

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `DEBATE QUESTION: ${question}

CONTEXT: ${context}${priorSummary}

${instruction}

Output JSON:
{
  "content": "Your full argument (3-5 sentences)",
  "supportPoints": ["point 1", "point 2"],
  "rebuttals": [{ "targetArgumentId": "id_prefix", "rebuttal": "why they're wrong" }],
  "confidence": 0.0-1.0
}

Return ONLY valid JSON.`,
      },
    ];

    const start = Date.now();
    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 1024,
      system: persona.systemPrompt,
      thinking: { enabled: true, budgetTokens: thinkingBudget },
    });

    let parsed: {
      content?: string;
      supportPoints?: string[];
      rebuttals?: Array<{ targetArgumentId: string; rebuttal: string }>;
      confidence?: number;
    } = {};

    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = { content: response.text.slice(0, 500) };
    }

    return {
      argumentId: randomUUID(),
      debaterId: `${role}-debater`,
      role,
      round,
      content: String(parsed.content ?? response.text.slice(0, 500)),
      thinkingContent: response.thinkingContent,
      supportPoints: Array.isArray(parsed.supportPoints) ? parsed.supportPoints : [],
      rebuttals: Array.isArray(parsed.rebuttals) ? parsed.rebuttals : [],
      confidence: Number(parsed.confidence ?? 0.5),
      tokensUsed: response.usage.inputTokens + response.usage.outputTokens,
      timestamp: Date.now(),
    };
  }

  // ── Consensus measurement ─────────────────────────────────────────────────────

  private computeConsensusLevel(arguments_: Argument[]): number {
    if (arguments_.length < 2) return 1;

    // Average pairwise confidence similarity
    let totalSimilarity = 0;
    let pairs = 0;

    for (let i = 0; i < arguments_.length; i++) {
      for (let j = i + 1; j < arguments_.length; j++) {
        const confDiff = Math.abs(
          arguments_[i].confidence - arguments_[j].confidence
        );
        // Penalize fast consensus (if round 0 already agrees, it's suspicious)
        const similarity = 1 - confDiff;
        totalSimilarity += similarity;
        pairs++;
      }
    }

    const rawConsensus = pairs > 0 ? totalSimilarity / pairs : 0;

    // Penalize if all arguments are from round 0 (opening consensus is low value)
    const allOpening = arguments_.every((a) => a.round === 0);
    return allOpening ? rawConsensus * 0.7 : rawConsensus;
  }

  // ── Synthesis ─────────────────────────────────────────────────────────────────

  private async synthesize(
    session: DebateSession,
    thinkingBudget: number
  ): Promise<DebateSynthesis> {
    const allArguments = session.rounds.flatMap((r) => r.arguments);
    const allScores = session.rounds.flatMap((r) => r.scores);

    // Find top 3 arguments by score
    const topArgs = [...allScores]
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, 3)
      .map((s) => {
        const arg = allArguments.find((a) => a.argumentId === s.argumentId);
        return { score: s, arg };
      })
      .filter((x) => x.arg !== undefined);

    const topArgsSummary = topArgs
      .map(
        (x) =>
          `[${x.arg!.role.toUpperCase()}, score=${x.score.overallScore.toFixed(2)}]: ${x.arg!.content.slice(0, 300)}`
      )
      .join("\n\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Synthesize this multi-agent debate into a final answer.

QUESTION: ${session.question}

TOP ARGUMENTS:
${topArgsSummary}

DEBATE STATS:
- ${session.rounds.length} rounds
- Final consensus level: ${session.rounds.at(-1)?.consensusLevel.toFixed(2) ?? "unknown"}

Output JSON:
{
  "consensus": "The main agreed-upon conclusion",
  "keyAgreements": ["agreement 1", "agreement 2"],
  "keyDisagreements": ["disagreement 1"],
  "winningArguments": [{"argumentId": "id", "reason": "why it won"}],
  "recommendation": "Concrete actionable recommendation",
  "confidence": 0.0-1.0,
  "minorityView": "Important minority view if any, or null"
}

Return ONLY valid JSON.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 2048,
      system:
        "You are a neutral debate judge synthesizing multiple perspectives into an actionable conclusion. Be precise and balanced.",
      thinking: { enabled: true, budgetTokens: thinkingBudget },
    });

    session.totalTokensUsed += response.usage.inputTokens + response.usage.outputTokens;

    let parsed: Partial<DebateSynthesis> = {};
    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      // Use defaults
    }

    return {
      question: session.question,
      consensus: String(parsed.consensus ?? "No clear consensus reached"),
      keyAgreements: Array.isArray(parsed.keyAgreements) ? parsed.keyAgreements : [],
      keyDisagreements: Array.isArray(parsed.keyDisagreements)
        ? parsed.keyDisagreements
        : [],
      winningArguments: Array.isArray(parsed.winningArguments)
        ? parsed.winningArguments
        : [],
      recommendation: String(parsed.recommendation ?? "Further analysis required"),
      confidence: Number(parsed.confidence ?? 0.5),
      thinkingContent: response.thinkingContent,
      minorityView: parsed.minorityView
        ? String(parsed.minorityView)
        : undefined,
    };
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getSession(debateId: string): DebateSession | null {
    return this.sessions.get(debateId) ?? null;
  }

  getArgumentsByRole(debateId: string, role: DebaterRole): Argument[] {
    const session = this.sessions.get(debateId);
    if (!session) return [];
    return session.rounds
      .flatMap((r) => r.arguments)
      .filter((a) => a.role === role);
  }

  getTopArguments(debateId: string, limit = 5): Array<Argument & { score: ArgumentScore }> {
    const session = this.sessions.get(debateId);
    if (!session) return [];

    const allArgs = session.rounds.flatMap((r) => r.arguments);
    const allScores = session.rounds.flatMap((r) => r.scores);

    return allScores
      .sort((a, b) => b.overallScore - a.overallScore)
      .slice(0, limit)
      .map((s) => {
        const arg = allArgs.find((a) => a.argumentId === s.argumentId)!;
        return { ...arg, score: s };
      })
      .filter(Boolean);
  }

  getSummary(debateId: string) {
    const session = this.sessions.get(debateId);
    if (!session) return null;

    return {
      debateId: session.debateId,
      question: session.question.slice(0, 80),
      status: session.status,
      rounds: session.rounds.length,
      finalConsensus: session.rounds.at(-1)?.consensusLevel ?? 0,
      synthesisConfidence: session.synthesis?.confidence ?? null,
      recommendation: session.synthesis?.recommendation ?? null,
      totalTokens: session.totalTokensUsed,
      estimatedCostUSD: session.estimatedCostUSD,
      durationMs: session.completedAt
        ? session.completedAt - session.createdAt
        : null,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: MultiAgentDebate | null = null;

export function getMultiAgentDebate(): MultiAgentDebate {
  if (!_instance) _instance = new MultiAgentDebate();
  return _instance;
}
