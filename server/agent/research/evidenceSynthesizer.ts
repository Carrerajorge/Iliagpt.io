import { llmGateway } from "../../lib/llmGateway";
import { Logger } from "../../lib/logger";
import { withRetry } from "../../utils/retry";
import type { CrossReference, EvidenceFragment, ResearchIssue, ResearchPhase, SourceResult } from "./deepResearchEngine";

const SYNTHESIS_MODEL = process.env.RESEARCH_MODEL || "gpt-4o-mini";

export interface CitationChain {
  id: string;
  claim: string;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  sourceIds: string[];
  confidence: number;
  consensusLevel: "strong" | "moderate" | "weak" | "contested";
}

export interface KnowledgeGap {
  description: string;
  relatedQuestionIds: string[];
  suggestedSearches: string[];
  priority: "high" | "medium" | "low";
}

export interface ConsensusMapping {
  topic: string;
  agreementLevel: number;
  supportingCount: number;
  contradictingCount: number;
  neutralCount: number;
  summary: string;
}

export interface SynthesisReport {
  citationChains: CitationChain[];
  contradictions: Array<{
    claimA: string;
    claimB: string;
    sourceA: string;
    sourceB: string;
    resolution: string | null;
  }>;
  consensusMap: ConsensusMapping[];
  knowledgeGaps: KnowledgeGap[];
  overallSummary: string;
  keyFindings: string[];
  evidenceQuality: "high" | "moderate" | "low";
  synthesizedAt: number;
}

interface SynthesisOptions {
  onIssue?: (issue: Omit<ResearchIssue, "id" | "timestamp">) => void;
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class EvidenceSynthesizer {
  async synthesize(
    query: string,
    evidence: EvidenceFragment[],
    sources: SourceResult[],
    crossRefs: CrossReference[],
    options: SynthesisOptions = {},
  ): Promise<SynthesisReport> {
    const citationChains = this.buildCitationChains(evidence, sources, crossRefs);
    const contradictions = this.detectContradictions(evidence, sources, crossRefs);
    const consensusMap = this.mapConsensus(evidence, sources);
    const knowledgeGaps = this.identifyKnowledgeGaps(evidence, query);

    const { overallSummary, keyFindings } = await this.generateSummary(
      query,
      citationChains,
      contradictions,
      consensusMap,
      options,
    );

    const evidenceQuality = this.assessEvidenceQuality(evidence, sources, crossRefs);

    return {
      citationChains,
      contradictions,
      consensusMap,
      knowledgeGaps,
      overallSummary,
      keyFindings,
      evidenceQuality,
      synthesizedAt: Date.now(),
    };
  }

  private buildCitationChains(
    evidence: EvidenceFragment[],
    sources: SourceResult[],
    crossRefs: CrossReference[]
  ): CitationChain[] {
    const chains: CitationChain[] = [];
    const processed = new Set<string>();

    const corroborationMap = new Map<string, Set<string>>();
    for (const cr of crossRefs) {
      if (cr.relationship === "corroborates") {
        for (const fid of cr.fragmentIds) {
          const existing = corroborationMap.get(fid) || new Set();
          for (const other of cr.fragmentIds) {
            if (other !== fid) existing.add(other);
          }
          corroborationMap.set(fid, existing);
        }
      }
    }

    for (const ev of evidence) {
      if (processed.has(ev.id)) continue;

      const supporting: string[] = [ev.id];
      const contradicting: string[] = [];
      const sourceIds = new Set<string>([ev.sourceId]);

      const correlated = corroborationMap.get(ev.id);
      if (correlated) {
        for (const cid of correlated) {
          const related = evidence.find((e) => e.id === cid);
          if (related) {
            supporting.push(cid);
            sourceIds.add(related.sourceId);
            processed.add(cid);
          }
        }
      }

      for (const cr of crossRefs) {
        if (cr.relationship === "contradicts" && cr.fragmentIds.includes(ev.id)) {
          for (const fid of cr.fragmentIds) {
            if (fid !== ev.id) contradicting.push(fid);
          }
        }
      }

      let consensusLevel: CitationChain["consensusLevel"];
      if (contradicting.length > 0) {
        consensusLevel = "contested";
      } else if (supporting.length >= 3) {
        consensusLevel = "strong";
      } else if (supporting.length >= 2) {
        consensusLevel = "moderate";
      } else {
        consensusLevel = "weak";
      }

      const avgConfidence =
        supporting
          .map((sid) => evidence.find((e) => e.id === sid)?.confidence || 0)
          .reduce((a, b) => a + b, 0) / supporting.length;

      chains.push({
        id: `chain_${generateId()}`,
        claim: ev.claim,
        supportingEvidence: supporting,
        contradictingEvidence: contradicting,
        sourceIds: [...sourceIds],
        confidence: avgConfidence,
        consensusLevel,
      });

      processed.add(ev.id);
    }

    return chains.sort((a, b) => b.confidence - a.confidence);
  }

  private detectContradictions(
    evidence: EvidenceFragment[],
    sources: SourceResult[],
    crossRefs: CrossReference[]
  ): SynthesisReport["contradictions"] {
    const contradictions: SynthesisReport["contradictions"] = [];

    for (const cr of crossRefs) {
      if (cr.relationship !== "contradicts") continue;

      const fragments = cr.fragmentIds
        .map((fid) => evidence.find((e) => e.id === fid))
        .filter(Boolean) as EvidenceFragment[];

      if (fragments.length >= 2) {
        const a = fragments[0];
        const b = fragments[1];

        contradictions.push({
          claimA: a.claim,
          claimB: b.claim,
          sourceA: a.sourceId,
          sourceB: b.sourceId,
          resolution: a.confidence > b.confidence + 0.2
            ? `Evidence leans toward claim A (confidence: ${a.confidence.toFixed(2)} vs ${b.confidence.toFixed(2)})`
            : b.confidence > a.confidence + 0.2
              ? `Evidence leans toward claim B (confidence: ${b.confidence.toFixed(2)} vs ${a.confidence.toFixed(2)})`
              : null,
        });
      }
    }

    return contradictions;
  }

  private mapConsensus(
    evidence: EvidenceFragment[],
    sources: SourceResult[]
  ): ConsensusMapping[] {
    const questionGroups = new Map<string, EvidenceFragment[]>();
    for (const ev of evidence) {
      const existing = questionGroups.get(ev.questionId) || [];
      existing.push(ev);
      questionGroups.set(ev.questionId, existing);
    }

    const consensus: ConsensusMapping[] = [];

    for (const [questionId, fragments] of questionGroups) {
      const supporting = fragments.filter((f) => f.evidenceType === "supports").length;
      const contradicting = fragments.filter((f) => f.evidenceType === "contradicts").length;
      const neutral = fragments.filter((f) => f.evidenceType === "neutral").length;
      const total = fragments.length;

      const agreementLevel =
        total > 0 ? (supporting - contradicting) / total : 0;

      const mainClaims = fragments
        .filter((f) => f.confidence > 0.5)
        .map((f) => f.claim)
        .slice(0, 3);

      consensus.push({
        topic: questionId,
        agreementLevel: Math.max(-1, Math.min(1, agreementLevel)),
        supportingCount: supporting,
        contradictingCount: contradicting,
        neutralCount: neutral,
        summary:
          mainClaims.length > 0
            ? mainClaims.join("; ")
            : "Insufficient evidence for summary",
      });
    }

    return consensus;
  }

  private identifyKnowledgeGaps(
    evidence: EvidenceFragment[],
    query: string
  ): KnowledgeGap[] {
    const gaps: KnowledgeGap[] = [];
    const questionIds = new Set(evidence.map((e) => e.questionId));

    const coveredTopics = new Set<string>();
    for (const ev of evidence) {
      const words = ev.claim.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      words.forEach((w) => coveredTopics.add(w));
    }

    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const uncoveredWords = queryWords.filter((w) => !coveredTopics.has(w));

    if (uncoveredWords.length > 0) {
      gaps.push({
        description: `Key query terms not addressed in evidence: ${uncoveredWords.join(", ")}`,
        relatedQuestionIds: [...questionIds],
        suggestedSearches: uncoveredWords.map((w) => `${w} research evidence`),
        priority: uncoveredWords.length > 3 ? "high" : "medium",
      });
    }

    const lowConfidence = evidence.filter((e) => e.confidence < 0.4);
    if (lowConfidence.length > evidence.length * 0.5) {
      gaps.push({
        description: "Majority of evidence has low confidence scores",
        relatedQuestionIds: [...new Set(lowConfidence.map((e) => e.questionId))],
        suggestedSearches: [
          `${query} systematic review`,
          `${query} meta-analysis`,
        ],
        priority: "high",
      });
    }

    const singleSourceQuestions: string[] = [];
    const questionSourceCount = new Map<string, Set<string>>();
    for (const ev of evidence) {
      const sources = questionSourceCount.get(ev.questionId) || new Set();
      sources.add(ev.sourceId);
      questionSourceCount.set(ev.questionId, sources);
    }
    for (const [qId, sourceSet] of questionSourceCount) {
      if (sourceSet.size === 1) singleSourceQuestions.push(qId);
    }
    if (singleSourceQuestions.length > 0) {
      gaps.push({
        description: `${singleSourceQuestions.length} question(s) supported by only a single source`,
        relatedQuestionIds: singleSourceQuestions,
        suggestedSearches: [`${query} additional perspectives`],
        priority: "medium",
      });
    }

    return gaps;
  }

  private async generateSummary(
    query: string,
    chains: CitationChain[],
    contradictions: SynthesisReport["contradictions"],
    consensus: ConsensusMapping[],
    options: SynthesisOptions,
  ): Promise<{ overallSummary: string; keyFindings: string[] }> {
    const topChains = chains
      .filter((c) => c.confidence > 0.3)
      .slice(0, 12)
      .map(
        (c) =>
          `- Claim: ${c.claim}\n  Confidence: ${c.confidence.toFixed(2)}\n  Consensus: ${c.consensusLevel}\n  Source IDs: ${c.sourceIds.join(", ")}`
      )
      .join("\n");

    const contradictionText =
      contradictions.length > 0
        ? contradictions
            .slice(0, 5)
            .map((c) => `- "${c.claimA}" vs "${c.claimB}"`)
            .join("\n")
        : "None detected";

    const consensusText =
      consensus.length > 0
        ? consensus
            .slice(0, 8)
            .map(
              (item) =>
                `- Topic: ${item.topic}; agreement: ${item.agreementLevel.toFixed(2)}; supporting: ${item.supportingCount}; contradicting: ${item.contradictingCount}; summary: ${item.summary}`,
            )
            .join("\n")
        : "No consensus map available";

    try {
      const response = await withRetry(
        () =>
          llmGateway.chat(
            [
              {
                role: "system" as const,
                content:
                  "You are a research synthesizer. Produce a grounded, evidence-heavy synthesis with explicit source traceability. " +
                  'Output ONLY a JSON object with: "summary" (string, 3-5 paragraphs), "keyFindings" (string[], 5-8 items). ' +
                  "Every key finding should mention the relevant source IDs inline, for example: \"Finding text (sources: src_1, src_2)\". " +
                  "Be objective, call out uncertainty, and do not invent evidence.",
              },
              {
                role: "user" as const,
                content:
                  `Query: ${query}\n\nTop Evidence Chains:\n${topChains}\n\nConsensus Map:\n${consensusText}\n\nContradictions:\n${contradictionText}`,
              },
            ],
            { model: SYNTHESIS_MODEL, temperature: 0.25, maxTokens: 2600, timeout: 25000 },
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

      return {
        overallSummary: parsed.summary || "Synthesis unavailable",
        keyFindings: Array.isArray(parsed.keyFindings)
          ? parsed.keyFindings.map(String)
          : [],
      };
    } catch (error) {
      Logger.warn("[EvidenceSynthesizer] Summary generation failed, using fallback synthesis", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      options.onIssue?.({
        phase: "hypothesis_generation" as ResearchPhase,
        severity: "warning",
        message: "Falló la síntesis LLM; se devolvió un resumen de respaldo.",
        detail: error instanceof Error ? error.message : String(error),
        query,
        recoverable: true,
      });

      const findings = chains
        .filter((c) => c.confidence > 0.4)
        .slice(0, 5)
        .map((c) => `${c.claim} (sources: ${c.sourceIds.join(", ")})`);

      return {
        overallSummary:
          `Research on "${query}" yielded ${chains.length} citation chains across multiple sources. ` +
          `${contradictions.length > 0 ? `${contradictions.length} contradictions were detected and should be reviewed carefully.` : "No major contradictions were found."} ` +
          `Consensus coverage included ${consensus.length} thematic clusters.`,
        keyFindings: findings.length > 0 ? findings : ["Insufficient evidence for key findings"],
      };
    }
  }

  private assessEvidenceQuality(
    evidence: EvidenceFragment[],
    sources: SourceResult[],
    crossRefs: CrossReference[]
  ): "high" | "moderate" | "low" {
    if (evidence.length === 0) return "low";

    let qualityScore = 0;

    if (sources.length >= 10) qualityScore += 2;
    else if (sources.length >= 5) qualityScore += 1;

    const avgConfidence =
      evidence.reduce((s, e) => s + e.confidence, 0) / evidence.length;
    if (avgConfidence >= 0.7) qualityScore += 2;
    else if (avgConfidence >= 0.5) qualityScore += 1;

    const corroborations = crossRefs.filter((cr) => cr.relationship === "corroborates").length;
    if (corroborations >= 5) qualityScore += 2;
    else if (corroborations >= 2) qualityScore += 1;

    const uniqueSources = new Set(evidence.map((e) => e.sourceId)).size;
    if (uniqueSources >= 5) qualityScore += 1;

    if (qualityScore >= 5) return "high";
    if (qualityScore >= 3) return "moderate";
    return "low";
  }
}
