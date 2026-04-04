/**
 * AgentDecisionGate — Batch 1 Pipeline Stage
 *
 * Decides whether a message should be handled by:
 *  a) A direct LLM call (fast-path, ~80 % of messages)
 *  b) Full agentic execution via the orchestrator (tool use, multi-step, file ops)
 *
 * Provides a confidence score and escalation rationale so callers
 * can log decisions and adjust thresholds without changing logic here.
 */

import { createLogger } from "../utils/logger";
import type { EnrichedMessage, Intent } from "./MessagePreprocessor";

const log = createLogger("AgentDecisionGate");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExecutionMode = "direct" | "agent" | "orchestrator";

export interface GateDecision {
  mode: ExecutionMode;
  confidence: number;          // 0–1
  reasons: string[];           // human-readable rationale
  estimatedSteps: number;      // how many LLM calls the agent will need
  requiresTools: string[];     // tool names the agent will likely invoke
  fastPath: boolean;           // true → skip enrichment & just call LLM
}

export interface GateConfig {
  directConfidenceThreshold: number;   // below → escalate to agent
  agentConfidenceThreshold: number;    // above → use orchestrator
  maxDirectWords: number;              // longer messages → favour agent
  enableWebSearch: boolean;
  enableFileOps: boolean;
  enableCodeExecution: boolean;
}

// ─── Keyword Signals ──────────────────────────────────────────────────────────

/** Tool-invocation keyword groups — each match adds signal toward agent mode */
const TOOL_SIGNALS: Array<{ tool: string; patterns: RegExp[]; weight: number }> = [
  {
    tool: "web_search",
    patterns: [
      /\b(search|google|look up|find online|browse|latest news|current|today)\b/i,
      /\b(what happened|recent|trending|up[- ]to[- ]date)\b/i,
    ],
    weight: 0.4,
  },
  {
    tool: "file_read",
    patterns: [
      /\b(read|open|load|parse|check|show me)\b.*\b(file|document|pdf|csv|json|xml|txt)\b/i,
      /\b(file|document|attachment)\b.*\b(content|text|data)\b/i,
    ],
    weight: 0.5,
  },
  {
    tool: "file_write",
    patterns: [
      /\b(write|save|create|generate|export|output)\b.*\b(file|document|report|csv|json)\b/i,
      /\b(download|store|persist)\b/i,
    ],
    weight: 0.5,
  },
  {
    tool: "code_execution",
    patterns: [
      /\b(run|execute|eval|compile|test|calculate|compute)\b/i,
      /\b(script|program|snippet)\b.*\b(run|execute)\b/i,
    ],
    weight: 0.6,
  },
  {
    tool: "database",
    patterns: [
      /\b(query|select|insert|update|delete)\b.*\b(database|db|table|record)\b/i,
      /\bSQL\b/i,
    ],
    weight: 0.55,
  },
  {
    tool: "calendar",
    patterns: [/\b(schedule|appointment|calendar|remind|reminder|meeting)\b/i],
    weight: 0.35,
  },
  {
    tool: "email",
    patterns: [/\b(send|draft|compose|reply|forward)\b.*\b(email|mail|message)\b/i],
    weight: 0.45,
  },
  {
    tool: "image_gen",
    patterns: [/\b(draw|paint|generate|create|make)\b.*\b(image|picture|photo|illustration|art)\b/i],
    weight: 0.5,
  },
];

/** Multi-step task patterns — strong signal toward agent orchestration */
const MULTI_STEP_PATTERNS: RegExp[] = [
  /\b(then|after that|next|finally|first|second|third|step \d)\b/i,
  /\b(and then|followed by|once done|when finished)\b/i,
  /\b(multiple|several|a few|many|all of the following)\b/i,
  /^\s*\d+\.\s+/m,             // numbered list in message
  /^\s*[-*•]\s+/m,             // bullet list in message
];

/** Direct-answer signals — the message is clearly a simple Q&A */
const DIRECT_PATTERNS: RegExp[] = [
  /^(what is|what are|who is|when was|where is|how do I|why does)\b/i,
  /^(define|explain|describe|summarize|translate)\b/i,
  /^(tell me|can you tell|could you tell)\b/i,
];

// ─── AgentDecisionGate ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: GateConfig = {
  directConfidenceThreshold: 0.45,
  agentConfidenceThreshold: 0.70,
  maxDirectWords: 80,
  enableWebSearch: true,
  enableFileOps: true,
  enableCodeExecution: true,
};

export class AgentDecisionGate {
  private config: GateConfig;

  constructor(config: Partial<GateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  evaluate(message: EnrichedMessage): GateDecision {
    const t0 = Date.now();
    const reasons: string[] = [];
    const requiredTools: string[] = [];
    let agentScore = 0;   // 0–1, higher → needs agent

    // ── Fast-path bail-outs ──────────────────────────────────────────────────

    if (message.isBlocked) {
      return this.buildDecision("direct", 0.95, ["message_blocked"], [], false);
    }

    if (message.isDuplicate) {
      reasons.push("duplicate_message_fast_path");
      return this.buildDecision("direct", 0.9, reasons, [], true);
    }

    // ── Conversational short-circuit ──────────────────────────────────────────

    if (
      message.intent === "conversational" &&
      message.wordCount <= 15
    ) {
      reasons.push("short_conversational");
      return this.buildDecision("direct", 0.92, reasons, [], true);
    }

    // ── Direct-answer patterns (subtract from agent score) ───────────────────

    let directBoost = 0;
    for (const pat of DIRECT_PATTERNS) {
      if (pat.test(message.normalizedText)) {
        directBoost += 0.15;
        reasons.push(`direct_pattern:${pat.source.slice(0, 30)}`);
      }
    }
    agentScore -= Math.min(0.3, directBoost);

    // ── Intent signals ────────────────────────────────────────────────────────

    const intentWeights: Partial<Record<Intent, number>> = {
      code: 0.25,
      analysis: 0.2,
      command: 0.3,
      creative: 0.1,
      question: -0.1,
      conversational: -0.2,
    };
    const intentWeight = intentWeights[message.intent] ?? 0;
    agentScore += intentWeight * message.intentConfidence;
    if (intentWeight !== 0) {
      reasons.push(`intent:${message.intent}(${message.intentConfidence.toFixed(2)})`);
    }

    // ── Tool invocation signals ───────────────────────────────────────────────

    for (const sig of TOOL_SIGNALS) {
      if (
        (!sig.tool.startsWith("file_") || this.config.enableFileOps) &&
        (sig.tool !== "web_search" || this.config.enableWebSearch) &&
        (sig.tool !== "code_execution" || this.config.enableCodeExecution)
      ) {
        for (const pat of sig.patterns) {
          if (pat.test(message.normalizedText)) {
            agentScore += sig.weight;
            reasons.push(`tool_signal:${sig.tool}`);
            if (!requiredTools.includes(sig.tool)) requiredTools.push(sig.tool);
            break;
          }
        }
      }
    }

    // ── Multi-step detection ──────────────────────────────────────────────────

    let multiStepCount = 0;
    for (const pat of MULTI_STEP_PATTERNS) {
      if (pat.test(message.normalizedText)) multiStepCount++;
    }
    if (multiStepCount >= 2) {
      agentScore += 0.35;
      reasons.push(`multi_step(${multiStepCount}_signals)`);
    } else if (multiStepCount === 1) {
      agentScore += 0.15;
      reasons.push("single_step_sequence_hint");
    }

    // ── Message length heuristic ──────────────────────────────────────────────

    if (message.wordCount > this.config.maxDirectWords) {
      const lengthBoost = Math.min(0.2, (message.wordCount - this.config.maxDirectWords) / 200);
      agentScore += lengthBoost;
      reasons.push(`length_boost(${message.wordCount}_words)`);
    }

    // ── Entity richness ───────────────────────────────────────────────────────

    const totalEntities =
      message.entities.filePaths.length +
      message.entities.urls.length +
      message.entities.codeBlocks.length;

    if (totalEntities > 2) {
      agentScore += 0.15;
      reasons.push(`entity_rich(${totalEntities})`);
    }

    // ── Code blocks in message ────────────────────────────────────────────────

    if (message.hasCode) {
      agentScore += 0.2;
      reasons.push("contains_code_blocks");
    }

    // ── Clamp and decide ─────────────────────────────────────────────────────

    const clamped = Math.max(0, Math.min(1, agentScore));
    const estimatedSteps = this.estimateSteps(clamped, requiredTools);

    let mode: ExecutionMode;
    let confidence: number;

    if (clamped < this.config.directConfidenceThreshold) {
      mode = "direct";
      confidence = 1 - clamped;
    } else if (clamped >= this.config.agentConfidenceThreshold) {
      mode = "orchestrator";
      confidence = clamped;
    } else {
      mode = "agent";
      confidence = clamped;
    }

    const decision = this.buildDecision(mode, confidence, reasons, requiredTools, false, estimatedSteps);

    log.debug("gate_decision", {
      mode,
      agentScore: clamped.toFixed(3),
      confidence: confidence.toFixed(3),
      requiredTools,
      reasonCount: reasons.length,
      evalMs: Date.now() - t0,
    });

    return decision;
  }

  private estimateSteps(agentScore: number, tools: string[]): number {
    if (agentScore < 0.3) return 1;
    const base = 1 + tools.length;
    return agentScore > 0.7 ? base + 2 : base;
  }

  private buildDecision(
    mode: ExecutionMode,
    confidence: number,
    reasons: string[],
    tools: string[],
    fastPath: boolean,
    estimatedSteps: number = 1,
  ): GateDecision {
    return {
      mode,
      confidence: Math.round(confidence * 1000) / 1000,
      reasons,
      estimatedSteps,
      requiresTools: tools,
      fastPath,
    };
  }
}

export const agentDecisionGate = new AgentDecisionGate();
