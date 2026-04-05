import { llmGateway } from "../../lib/llmGateway";
import { Logger } from "../../lib/logger";
import { withRetry } from "../../utils/retry";
import type { EvidenceFragment, ResearchIssue } from "./deepResearchEngine";
import type { SynthesisReport } from "./evidenceSynthesizer";

const HYPOTHESIS_MODEL = process.env.RESEARCH_MODEL || "gpt-4o-mini";

export interface Hypothesis {
  id: string;
  statement: string;
  type: "causal" | "correlational" | "descriptive" | "counterfactual";
  plausibility: number;
  novelty: number;
  impact: number;
  overallScore: number;
  supportingEvidenceIds: string[];
  assumptions: string[];
  validationApproaches: ValidationApproach[];
  counterarguments: string[];
  generatedAt: number;
}

export interface ValidationApproach {
  method: string;
  description: string;
  feasibility: "high" | "medium" | "low";
  estimatedEffort: "minimal" | "moderate" | "substantial";
}

export interface CausalChain {
  cause: string;
  mechanism: string;
  effect: string;
  confidence: number;
  evidenceIds: string[];
}

export interface CounterfactualAnalysis {
  premise: string;
  counterfactual: string;
  predictedOutcome: string;
  confidence: number;
  reasoning: string;
}

export interface HypothesisReport {
  hypotheses: Hypothesis[];
  causalChains: CausalChain[];
  counterfactuals: CounterfactualAnalysis[];
  generatedAt: number;
  evidenceBaseSize: number;
  queryContext: string;
}

interface HypothesisOptions {
  onIssue?: (issue: Omit<ResearchIssue, "id" | "timestamp">) => void;
}

function generateId(): string {
  return `hyp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class HypothesisGenerator {
  async generate(
    query: string,
    evidence: EvidenceFragment[],
    synthesis: SynthesisReport,
    options: HypothesisOptions = {},
  ): Promise<HypothesisReport> {
    const hypotheses = await this.generateHypotheses(query, evidence, synthesis, options);
    const causalChains = this.extractCausalChains(evidence, synthesis);
    const counterfactuals = await this.generateCounterfactuals(query, evidence, hypotheses, options);

    for (const h of hypotheses) {
      h.overallScore = this.computeOverallScore(h);
    }

    hypotheses.sort((a, b) => b.overallScore - a.overallScore);

    return {
      hypotheses,
      causalChains,
      counterfactuals,
      generatedAt: Date.now(),
      evidenceBaseSize: evidence.length,
      queryContext: query,
    };
  }

  private async generateHypotheses(
    query: string,
    evidence: EvidenceFragment[],
    synthesis: SynthesisReport,
    options: HypothesisOptions,
  ): Promise<Hypothesis[]> {
    const evidenceSummary = evidence
      .filter((e) => e.confidence > 0.3)
      .slice(0, 15)
      .map((e) => `- [${e.evidenceType}] ${e.claim} (conf: ${e.confidence.toFixed(2)})`)
      .join("\n");

    const gapsSummary = synthesis.knowledgeGaps
      .slice(0, 5)
      .map((g) => `- ${g.description}`)
      .join("\n");

    const findingsSummary = synthesis.keyFindings.slice(0, 5).join("\n- ");

    try {
      const response = await withRetry(
        () =>
          llmGateway.chat(
            [
              {
                role: "system" as const,
                content:
                  "You are a hypothesis generator for scientific research. Given evidence and knowledge gaps, generate 3-6 testable hypotheses. " +
                  'Output ONLY a JSON array of objects with: "statement", "type", "plausibility", "novelty", "impact", "assumptions", ' +
                  '"validationApproaches", and "counterarguments". Keep hypotheses tightly linked to the supplied evidence and gaps. No explanation.',
              },
              {
                role: "user" as const,
                content: `Research Query: ${query}\n\nKey Findings:\n- ${findingsSummary}\n\nEvidence:\n${evidenceSummary}\n\nKnowledge Gaps:\n${gapsSummary}`,
              },
            ],
            { model: HYPOTHESIS_MODEL, temperature: 0.45, maxTokens: 3000, timeout: 25000 },
          ),
        {
          maxRetries: 2,
          baseDelay: 500,
          maxDelay: 4_000,
          shouldRetry: () => true,
        },
      );

      const parsed = JSON.parse(
        response.content.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "")
      );

      if (Array.isArray(parsed)) {
        return parsed.map((h: any) => ({
          id: generateId(),
          statement: String(h.statement || ""),
          type: h.type || "descriptive",
          plausibility: Math.min(1, Math.max(0, Number(h.plausibility) || 0.5)),
          novelty: Math.min(1, Math.max(0, Number(h.novelty) || 0.5)),
          impact: Math.min(1, Math.max(0, Number(h.impact) || 0.5)),
          overallScore: 0,
          supportingEvidenceIds: this.findSupportingEvidence(h.statement || "", evidence),
          assumptions: Array.isArray(h.assumptions) ? h.assumptions.map(String) : [],
          validationApproaches: Array.isArray(h.validationApproaches)
            ? h.validationApproaches.map((v: any) => ({
                method: String(v.method || ""),
                description: String(v.description || ""),
                feasibility: v.feasibility || "medium",
                estimatedEffort: v.estimatedEffort || "moderate",
              }))
            : [],
          counterarguments: Array.isArray(h.counterarguments) ? h.counterarguments.map(String) : [],
          generatedAt: Date.now(),
        }));
      }
    } catch (error) {
      Logger.warn("[HypothesisGenerator] Hypothesis generation failed, using fallback", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      options.onIssue?.({
        phase: "hypothesis_generation",
        severity: "warning",
        message: "Falló la generación LLM de hipótesis; se devolvieron hipótesis de respaldo.",
        detail: error instanceof Error ? error.message : String(error),
        query,
        recoverable: true,
      });
    }

    return this.fallbackHypotheses(query, evidence);
  }

  private fallbackHypotheses(
    query: string,
    evidence: EvidenceFragment[]
  ): Hypothesis[] {
    const supportingClaims = evidence.filter((e) => e.evidenceType === "supports" && e.confidence > 0.4);
    if (supportingClaims.length === 0) return [];

    return [
      {
        id: generateId(),
        statement: `Based on available evidence, the phenomena described in "${query}" are systematically connected through underlying mechanisms that require further investigation.`,
        type: "descriptive",
        plausibility: 0.5,
        novelty: 0.3,
        impact: 0.5,
        overallScore: 0,
        supportingEvidenceIds: supportingClaims.slice(0, 3).map((e) => e.id),
        assumptions: ["Available evidence is representative", "No major confounding factors"],
        validationApproaches: [
          {
            method: "Literature Review",
            description: "Conduct a systematic literature review to validate findings",
            feasibility: "high",
            estimatedEffort: "moderate",
          },
        ],
        counterarguments: ["Evidence base may be too narrow for generalization"],
        generatedAt: Date.now(),
      },
    ];
  }

  private findSupportingEvidence(hypothesis: string, evidence: EvidenceFragment[]): string[] {
    const hypWords = new Set(
      hypothesis
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4)
    );

    return evidence
      .filter((e) => {
        const claimWords = e.claim.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
        const overlap = claimWords.filter((w) => hypWords.has(w)).length;
        return overlap >= 2 || (overlap >= 1 && e.confidence > 0.6);
      })
      .slice(0, 5)
      .map((e) => e.id);
  }

  private extractCausalChains(
    evidence: EvidenceFragment[],
    synthesis: SynthesisReport
  ): CausalChain[] {
    const chains: CausalChain[] = [];
    const causalPatterns = [
      /(.+?)\s+(?:causes?|leads?\s+to|results?\s+in|produces?)\s+(.+)/i,
      /(.+?)\s+(?:porque|due\s+to|because\s+of)\s+(.+)/i,
      /(?:when|si|if)\s+(.+?),?\s+(?:then|entonces)\s+(.+)/i,
    ];

    for (const ev of evidence) {
      if (ev.confidence < 0.4) continue;

      for (const pattern of causalPatterns) {
        const match = ev.claim.match(pattern);
        if (match) {
          chains.push({
            cause: match[1].trim(),
            mechanism: "Implied by evidence",
            effect: match[2].trim(),
            confidence: ev.confidence,
            evidenceIds: [ev.id],
          });
          break;
        }
      }
    }

    const strongChains = synthesis.citationChains
      .filter((c) => c.consensusLevel === "strong" || c.consensusLevel === "moderate")
      .slice(0, 5);

    for (let i = 0; i < strongChains.length - 1; i++) {
      const a = strongChains[i];
      const b = strongChains[i + 1];

      const aWords = new Set(a.claim.toLowerCase().split(/\s+/).filter((w) => w.length > 4));
      const bWords = b.claim.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      const overlap = bWords.filter((w) => aWords.has(w)).length;

      if (overlap >= 2) {
        chains.push({
          cause: a.claim,
          mechanism: "Sequential evidence suggests causal link",
          effect: b.claim,
          confidence: Math.min(a.confidence, b.confidence) * 0.7,
          evidenceIds: [...a.supportingEvidence.slice(0, 2), ...b.supportingEvidence.slice(0, 2)],
        });
      }
    }

    return chains.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
  }

  private async generateCounterfactuals(
    query: string,
    evidence: EvidenceFragment[],
    hypotheses: Hypothesis[],
    options: HypothesisOptions,
  ): Promise<CounterfactualAnalysis[]> {
    if (hypotheses.length === 0) return [];

    const topHypotheses = hypotheses
      .filter((h) => h.plausibility > 0.3)
      .slice(0, 3)
      .map((h) => h.statement)
      .join("\n- ");

    try {
      const response = await withRetry(
        () =>
          llmGateway.chat(
            [
              {
                role: "system" as const,
                content:
                  "You are a counterfactual analyst. Given hypotheses, generate 2-4 counterfactual scenarios. " +
                  'Output ONLY a JSON array of objects with: "premise", "counterfactual", "predictedOutcome", "confidence", and "reasoning". No explanation.',
              },
              {
                role: "user" as const,
                content: `Query: ${query}\n\nHypotheses:\n- ${topHypotheses}`,
              },
            ],
            { model: HYPOTHESIS_MODEL, temperature: 0.5, maxTokens: 1500, timeout: 15000 },
          ),
        {
          maxRetries: 2,
          baseDelay: 500,
          maxDelay: 4_000,
          shouldRetry: () => true,
        },
      );

      const parsed = JSON.parse(
        response.content.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "")
      );

      if (Array.isArray(parsed)) {
        return parsed.map((cf: any) => ({
          premise: String(cf.premise || ""),
          counterfactual: String(cf.counterfactual || ""),
          predictedOutcome: String(cf.predictedOutcome || ""),
          confidence: Math.min(1, Math.max(0, Number(cf.confidence) || 0.5)),
          reasoning: String(cf.reasoning || ""),
        }));
      }
    } catch (error) {
      Logger.warn("[HypothesisGenerator] Counterfactual generation failed", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      options.onIssue?.({
        phase: "hypothesis_generation",
        severity: "warning",
        message: "Falló la generación de contrafactuales; se devolvió un conjunto vacío.",
        detail: error instanceof Error ? error.message : String(error),
        query,
        recoverable: true,
      });
    }

    return [];
  }

  private computeOverallScore(hypothesis: Hypothesis): number {
    const weights = { plausibility: 0.4, novelty: 0.25, impact: 0.25, validation: 0.1 };

    const validationScore =
      hypothesis.validationApproaches.length > 0
        ? hypothesis.validationApproaches.reduce((s, v) => {
            const feasibilityScore = v.feasibility === "high" ? 1 : v.feasibility === "medium" ? 0.6 : 0.3;
            return s + feasibilityScore;
          }, 0) / hypothesis.validationApproaches.length
        : 0.5;

    const evidenceBoost = Math.min(hypothesis.supportingEvidenceIds.length * 0.05, 0.15);

    return (
      hypothesis.plausibility * weights.plausibility +
      hypothesis.novelty * weights.novelty +
      hypothesis.impact * weights.impact +
      validationScore * weights.validation +
      evidenceBoost
    );
  }
}
