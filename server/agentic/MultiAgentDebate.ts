/**
 * MultiAgentDebate — Launch N agents with different perspectives, run a
 * structured debate, detect consensus, and synthesise the best outcome.
 *
 * Auto-triggers for high-stakes decisions: financial, security, architecture.
 */

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { Logger } from "../lib/logger";
import { FAST_MODEL, REASONING_MODEL } from "./ClaudeAgentBackbone";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type AgentPerspective = "optimistic" | "skeptical" | "analytical";

export type DebateTopic =
  | "general"
  | "financial"
  | "security"
  | "architecture"
  | "ethical"
  | "operational";

export interface DebateArgument {
  agentId: string;
  perspective: AgentPerspective;
  round: number;
  position: string; // summary stance
  reasoning: string; // detailed argument
  evidencePoints: string[];
  score: number; // internal quality score 0-100
  counterpoints?: string[]; // responses to other agents
}

export interface DebateRound {
  roundNumber: number;
  arguments: DebateArgument[];
  consensusScore: number; // 0-1; 1 = full consensus
}

export interface DebateResult {
  debateId: string;
  topic: DebateTopic;
  question: string;
  rounds: DebateRound[];
  consensus: boolean;
  finalSynthesis: string;
  recommendedAction: string;
  confidenceLevel: number; // 0-1
  dissenting: string[]; // any remaining disagreements
  durationMs: number;
}

export interface DebateConfig {
  agentCount?: number; // default 3
  maxRounds?: number; // default 4
  consensusThreshold?: number; // default 0.75
  perspectives?: AgentPerspective[];
  onRoundComplete?: (round: DebateRound) => void;
}

// ─── Stake detection ───────────────────────────────────────────────────────────
const HIGH_STAKES_PATTERNS: Array<{ pattern: RegExp; topic: DebateTopic }> = [
  { pattern: /\b(payment|cost|price|budget|money|revenue|billing|invoice|financial)\b/i, topic: "financial" },
  { pattern: /\b(security|vulnerability|authentication|authorization|credential|token|breach|exploit)\b/i, topic: "security" },
  { pattern: /\b(architecture|design|refactor|migrate|database|schema|api|service|microservice)\b/i, topic: "architecture" },
  { pattern: /\b(delete|remove|drop|destroy|purge|wipe|irreversible)\b/i, topic: "operational" },
  { pattern: /\b(ethics|bias|fairness|privacy|gdpr|compliance|legal)\b/i, topic: "ethical" },
];

export function detectTopicAndStakes(question: string): { topic: DebateTopic; highStakes: boolean } {
  for (const { pattern, topic } of HIGH_STAKES_PATTERNS) {
    if (pattern.test(question)) return { topic, highStakes: true };
  }
  return { topic: "general", highStakes: false };
}

// ─── Prompt builders ────────────────────────────────────────────────────────────
const PERSPECTIVE_DESCRIPTIONS: Record<AgentPerspective, string> = {
  optimistic:
    "You look for opportunities and reasons to proceed. You identify the best-case outcomes and benefits. You are constructive and solution-oriented, but not reckless — you acknowledge real risks.",
  skeptical:
    "You look for risks, hidden assumptions, and reasons why this might fail. You play devil's advocate and challenge every assumption. You are critical but constructive — you want the best outcome.",
  analytical:
    "You weigh evidence objectively, avoid emotional reasoning, and apply logical frameworks. You identify what data we have, what we are missing, and what a rational actor should do given the evidence.",
};

function buildInitialArgumentPrompt(
  question: string,
  topic: DebateTopic,
  perspective: AgentPerspective,
  context: string
): string {
  return `You are participating in a structured debate as the ${perspective.toUpperCase()} agent.

DEBATE TOPIC TYPE: ${topic}
QUESTION: ${question}
CONTEXT: ${context || "No additional context provided."}

YOUR ROLE: ${PERSPECTIVE_DESCRIPTIONS[perspective]}

Provide your initial position as JSON:
{
  "position": "one-sentence stance",
  "reasoning": "detailed argument (150-250 words)",
  "evidence_points": ["point 1", "point 2", "point 3"],
  "score": 75
}

"score" is your own assessment of argument strength (0-100). Be realistic.`;
}

function buildResponseRoundPrompt(
  question: string,
  perspective: AgentPerspective,
  myPriorArgument: string,
  othersArguments: Array<{ perspective: AgentPerspective; position: string; reasoning: string }>
): string {
  const othersText = othersArguments
    .map((a) => `[${a.perspective.toUpperCase()}]: ${a.position}\n${a.reasoning}`)
    .join("\n\n");

  return `Continue the structured debate as the ${perspective.toUpperCase()} agent.

QUESTION: ${question}

YOUR PRIOR POSITION: ${myPriorArgument}

OTHER AGENTS' ARGUMENTS:
${othersText}

Respond and refine your position as JSON:
{
  "position": "updated one-sentence stance (may be same or evolved)",
  "reasoning": "refined argument incorporating rebuttals (150-250 words)",
  "evidence_points": ["updated point 1", "point 2", "point 3"],
  "counterpoints": ["rebuttal to optimistic agent", "rebuttal to analytical agent"],
  "score": 80
}`;
}

function buildSynthesisPrompt(
  question: string,
  allArguments: DebateArgument[]
): string {
  const argText = allArguments
    .map(
      (a) =>
        `[${a.perspective.toUpperCase()} R${a.round}] Score:${a.score}\nPosition: ${a.position}\nReasoning: ${a.reasoning}`
    )
    .join("\n\n---\n\n");

  return `Synthesise the following debate into a final recommendation.

QUESTION: ${question}

ALL ARGUMENTS:
${argText}

Produce a synthesis as JSON:
{
  "final_synthesis": "comprehensive summary merging the best insights from all agents (200-300 words)",
  "recommended_action": "clear, actionable recommendation",
  "confidence_level": 0.0-1.0,
  "dissenting_views": ["any unresolved disagreement 1", "point 2"]
}`;
}

// ─── MultiAgentDebate ─────────────────────────────────────────────────────────
export class MultiAgentDebate {
  private readonly client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Run a full debate on a question. Returns synthesised result. */
  async debate(
    question: string,
    context = "",
    config: DebateConfig = {}
  ): Promise<DebateResult> {
    const startMs = Date.now();
    const debateId = randomUUID();
    const {
      agentCount = 3,
      maxRounds = 4,
      consensusThreshold = 0.75,
      perspectives = this.defaultPerspectives(agentCount),
      onRoundComplete,
    } = config;

    const { topic } = detectTopicAndStakes(question);
    Logger.info("[MultiAgentDebate] Starting debate", { debateId, topic, agentCount, maxRounds });

    const rounds: DebateRound[] = [];
    let allArguments: DebateArgument[] = [];
    let consensusReached = false;

    // Round 1: Initial positions
    const round1Args = await this.runRound(
      debateId,
      question,
      topic,
      context,
      perspectives,
      1,
      []
    );
    const round1: DebateRound = {
      roundNumber: 1,
      arguments: round1Args,
      consensusScore: this.measureConsensus(round1Args),
    };
    rounds.push(round1);
    allArguments = allArguments.concat(round1Args);
    onRoundComplete?.(round1);

    if (round1.consensusScore >= consensusThreshold) {
      consensusReached = true;
    }

    // Subsequent rounds until consensus or maxRounds
    let roundNum = 2;
    while (!consensusReached && roundNum <= maxRounds) {
      const prevArgs = rounds[rounds.length - 1].arguments;
      const roundArgs = await this.runResponseRound(
        debateId,
        question,
        perspectives,
        roundNum,
        prevArgs,
        allArguments
      );
      const round: DebateRound = {
        roundNumber: roundNum,
        arguments: roundArgs,
        consensusScore: this.measureConsensus(roundArgs),
      };
      rounds.push(round);
      allArguments = allArguments.concat(roundArgs);
      onRoundComplete?.(round);

      if (round.consensusScore >= consensusThreshold) {
        consensusReached = true;
      }
      roundNum++;
    }

    // Synthesis
    const synthesis = await this.synthesise(question, allArguments);

    const result: DebateResult = {
      debateId,
      topic,
      question,
      rounds,
      consensus: consensusReached,
      finalSynthesis: synthesis.final_synthesis,
      recommendedAction: synthesis.recommended_action,
      confidenceLevel: synthesis.confidence_level,
      dissenting: synthesis.dissenting_views,
      durationMs: Date.now() - startMs,
    };

    Logger.info("[MultiAgentDebate] Debate complete", {
      debateId,
      rounds: rounds.length,
      consensus: consensusReached,
      durationMs: result.durationMs,
    });

    return result;
  }

  /** Score a single argument for quality (external use). */
  scoreArgument(arg: DebateArgument): number {
    let score = arg.score;
    score += arg.evidencePoints.length * 5; // evidence richness
    score += (arg.counterpoints?.length ?? 0) * 3; // responsiveness
    return Math.min(100, score);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private defaultPerspectives(count: number): AgentPerspective[] {
    const pool: AgentPerspective[] = ["optimistic", "skeptical", "analytical"];
    return pool.slice(0, Math.min(count, pool.length));
  }

  private async runRound(
    debateId: string,
    question: string,
    topic: DebateTopic,
    context: string,
    perspectives: AgentPerspective[],
    roundNumber: number,
    _priorRound: DebateArgument[]
  ): Promise<DebateArgument[]> {
    const promises = perspectives.map((perspective) =>
      this.generateInitialArgument(question, topic, context, perspective, roundNumber)
    );
    return Promise.all(promises);
  }

  private async runResponseRound(
    debateId: string,
    question: string,
    perspectives: AgentPerspective[],
    roundNumber: number,
    prevRoundArgs: DebateArgument[],
    _allArgs: DebateArgument[]
  ): Promise<DebateArgument[]> {
    const promises = perspectives.map((perspective) => {
      const myPrior = prevRoundArgs.find((a) => a.perspective === perspective);
      const others = prevRoundArgs.filter((a) => a.perspective !== perspective);
      return this.generateResponseArgument(question, perspective, myPrior, others, roundNumber);
    });
    return Promise.all(promises);
  }

  private async generateInitialArgument(
    question: string,
    topic: DebateTopic,
    context: string,
    perspective: AgentPerspective,
    round: number
  ): Promise<DebateArgument> {
    const prompt = buildInitialArgumentPrompt(question, topic, perspective, context);
    const parsed = await this.callAndParse(prompt);

    return {
      agentId: `${perspective}_agent`,
      perspective,
      round,
      position: String(parsed.position ?? ""),
      reasoning: String(parsed.reasoning ?? ""),
      evidencePoints: Array.isArray(parsed.evidence_points) ? parsed.evidence_points : [],
      score: typeof parsed.score === "number" ? Math.min(100, Math.max(0, parsed.score)) : 50,
    };
  }

  private async generateResponseArgument(
    question: string,
    perspective: AgentPerspective,
    myPrior: DebateArgument | undefined,
    others: DebateArgument[],
    round: number
  ): Promise<DebateArgument> {
    const myPriorText = myPrior ? `${myPrior.position}\n${myPrior.reasoning}` : "No prior position.";
    const othersInfo = others.map((a) => ({
      perspective: a.perspective,
      position: a.position,
      reasoning: a.reasoning,
    }));

    const prompt = buildResponseRoundPrompt(question, perspective, myPriorText, othersInfo);
    const parsed = await this.callAndParse(prompt);

    return {
      agentId: `${perspective}_agent`,
      perspective,
      round,
      position: String(parsed.position ?? ""),
      reasoning: String(parsed.reasoning ?? ""),
      evidencePoints: Array.isArray(parsed.evidence_points) ? parsed.evidence_points : [],
      counterpoints: Array.isArray(parsed.counterpoints) ? parsed.counterpoints : [],
      score: typeof parsed.score === "number" ? Math.min(100, Math.max(0, parsed.score)) : 50,
    };
  }

  private async synthesise(
    question: string,
    allArguments: DebateArgument[]
  ): Promise<{
    final_synthesis: string;
    recommended_action: string;
    confidence_level: number;
    dissenting_views: string[];
  }> {
    const prompt = buildSynthesisPrompt(question, allArguments);
    const parsed = await this.callAndParse(prompt, REASONING_MODEL);
    return {
      final_synthesis: String(parsed.final_synthesis ?? "Synthesis unavailable."),
      recommended_action: String(parsed.recommended_action ?? "No recommendation."),
      confidence_level: typeof parsed.confidence_level === "number" ? parsed.confidence_level : 0.5,
      dissenting_views: Array.isArray(parsed.dissenting_views) ? parsed.dissenting_views : [],
    };
  }

  private measureConsensus(args: DebateArgument[]): number {
    if (args.length < 2) return 1;

    // Measure lexical similarity of positions using simple token overlap
    const tokenSets = args.map((a) => new Set(a.position.toLowerCase().split(/\W+/).filter(Boolean)));
    let totalOverlap = 0;
    let pairs = 0;

    for (let i = 0; i < tokenSets.length; i++) {
      for (let j = i + 1; j < tokenSets.length; j++) {
        const a = tokenSets[i];
        const b = tokenSets[j];
        const intersection = new Set([...a].filter((t) => b.has(t)));
        const union = new Set([...a, ...b]);
        totalOverlap += union.size > 0 ? intersection.size / union.size : 0;
        pairs++;
      }
    }

    return pairs > 0 ? totalOverlap / pairs : 1;
  }

  private async callAndParse(prompt: string, model = FAST_MODEL): Promise<Record<string, any>> {
    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text : "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (err) {
      Logger.error("[MultiAgentDebate] API/parse error", err);
      return {};
    }
  }
}
