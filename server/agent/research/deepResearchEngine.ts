import { z } from "zod";
import { llmGateway } from "../../lib/llmGateway";
import { EvidenceSynthesizer, type SynthesisReport } from "./evidenceSynthesizer";
import { HypothesisGenerator, type HypothesisReport } from "./hypothesisGenerator";

const RESEARCH_MODEL = process.env.RESEARCH_MODEL || "gpt-4o-mini";
const MAX_SEARCH_QUERIES = 10;
const MAX_SOURCES_PER_QUERY = 5;

export const ResearchPhase = z.enum([
  "query_decomposition",
  "literature_search",
  "evidence_extraction",
  "cross_reference",
  "hypothesis_generation",
  "confidence_scoring",
]);
export type ResearchPhase = z.infer<typeof ResearchPhase>;

export interface ResearchQuestion {
  id: string;
  question: string;
  category: "primary" | "secondary" | "exploratory";
  keywords: string[];
  expectedEvidenceType: "quantitative" | "qualitative" | "mixed";
}

export interface SourceResult {
  id: string;
  title: string;
  url: string | null;
  snippet: string;
  fullContent: string;
  query: string;
  relevanceScore: number;
  retrievedAt: number;
}

export interface EvidenceFragment {
  id: string;
  sourceId: string;
  claim: string;
  context: string;
  confidence: number;
  evidenceType: "supports" | "contradicts" | "neutral";
  questionId: string;
}

export interface CrossReference {
  fragmentIds: string[];
  relationship: "corroborates" | "contradicts" | "extends" | "unrelated";
  strength: number;
  note: string;
}

export interface ResearchResult {
  id: string;
  originalQuery: string;
  questions: ResearchQuestion[];
  sources: SourceResult[];
  evidence: EvidenceFragment[];
  crossReferences: CrossReference[];
  synthesis: SynthesisReport;
  hypotheses: HypothesisReport;
  confidenceScore: number;
  uncertaintyFactors: string[];
  phasesCompleted: ResearchPhase[];
  startedAt: number;
  completedAt: number;
  totalDurationMs: number;
}

export interface ResearchOptions {
  maxSources?: number;
  enableHypothesis?: boolean;
  depthLevel?: "shallow" | "standard" | "deep";
  focusAreas?: string[];
  searchFn?: (query: string) => Promise<Array<{ title: string; url: string; snippet: string; content?: string }>>;
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class DeepResearchEngine {
  private synthesizer = new EvidenceSynthesizer();
  private hypothesisGen = new HypothesisGenerator();

  async conduct(query: string, options: ResearchOptions = {}): Promise<ResearchResult> {
    const startedAt = Date.now();
    const researchId = generateId();
    const phasesCompleted: ResearchPhase[] = [];

    const maxSources = options.maxSources || 20;
    const depthLevel = options.depthLevel || "standard";
    const enableHypothesis = options.enableHypothesis !== false;

    const questions = await this.decomposeQuery(query, depthLevel, options.focusAreas);
    phasesCompleted.push("query_decomposition");

    const sources = await this.searchLiterature(questions, maxSources, options.searchFn);
    phasesCompleted.push("literature_search");

    const evidence = await this.extractEvidence(questions, sources);
    phasesCompleted.push("evidence_extraction");

    const crossReferences = await this.crossReferenceVerify(evidence);
    phasesCompleted.push("cross_reference");

    const synthesis = await this.synthesizer.synthesize(query, evidence, sources, crossReferences);

    let hypotheses: HypothesisReport = {
      hypotheses: [],
      generatedAt: Date.now(),
      evidenceBaseSize: evidence.length,
      queryContext: query,
    };
    if (enableHypothesis) {
      hypotheses = await this.hypothesisGen.generate(query, evidence, synthesis);
      phasesCompleted.push("hypothesis_generation");
    }

    const { confidenceScore, uncertaintyFactors } = this.scoreConfidence(sources, evidence, crossReferences);
    phasesCompleted.push("confidence_scoring");

    const completedAt = Date.now();

    return {
      id: researchId,
      originalQuery: query,
      questions,
      sources,
      evidence,
      crossReferences,
      synthesis,
      hypotheses,
      confidenceScore,
      uncertaintyFactors,
      phasesCompleted,
      startedAt,
      completedAt,
      totalDurationMs: completedAt - startedAt,
    };
  }

  private async decomposeQuery(
    query: string,
    depth: "shallow" | "standard" | "deep",
    focusAreas?: string[]
  ): Promise<ResearchQuestion[]> {
    const questionCount = depth === "shallow" ? 3 : depth === "standard" ? 5 : 8;
    const focusHint = focusAreas?.length ? `\nFocus areas: ${focusAreas.join(", ")}` : "";

    try {
      const response = await llmGateway.chat(
        [
          {
            role: "system" as const,
            content: `You are a research methodologist. Decompose the user's query into ${questionCount} specific research questions. Output ONLY a JSON array where each element has: "question" (string), "category" ("primary"|"secondary"|"exploratory"), "keywords" (string[]), "expectedEvidenceType" ("quantitative"|"qualitative"|"mixed"). No explanation.`,
          },
          {
            role: "user" as const,
            content: `${query}${focusHint}`,
          },
        ],
        { model: RESEARCH_MODEL, temperature: 0.3, maxTokens: 1500, timeout: 15000 }
      );

      const parsed = JSON.parse(
        response.content.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "")
      );

      if (Array.isArray(parsed)) {
        return parsed.map((q: any, idx: number) => ({
          id: `q_${generateId()}_${idx}`,
          question: String(q.question || q),
          category: q.category || "primary",
          keywords: Array.isArray(q.keywords) ? q.keywords.map(String) : [],
          expectedEvidenceType: q.expectedEvidenceType || "mixed",
        }));
      }
    } catch {}

    return this.fallbackDecompose(query);
  }

  private fallbackDecompose(query: string): ResearchQuestion[] {
    const words = query.split(/\s+/).filter((w) => w.length > 3);
    const mainTopic = words.slice(0, 5).join(" ");

    return [
      {
        id: `q_${generateId()}_0`,
        question: `What is the current state of knowledge about ${mainTopic}?`,
        category: "primary",
        keywords: words.slice(0, 5),
        expectedEvidenceType: "mixed",
      },
      {
        id: `q_${generateId()}_1`,
        question: `What are the key factors and variables involved in ${mainTopic}?`,
        category: "primary",
        keywords: words.slice(0, 5),
        expectedEvidenceType: "qualitative",
      },
      {
        id: `q_${generateId()}_2`,
        question: `What evidence exists for or against claims about ${mainTopic}?`,
        category: "secondary",
        keywords: words.slice(0, 5),
        expectedEvidenceType: "quantitative",
      },
    ];
  }

  private async searchLiterature(
    questions: ResearchQuestion[],
    maxSources: number,
    searchFn?: ResearchOptions["searchFn"]
  ): Promise<SourceResult[]> {
    const allSources: SourceResult[] = [];
    const seenUrls = new Set<string>();
    const searchQueries: string[] = [];

    for (const q of questions) {
      searchQueries.push(q.question);
      if (q.keywords.length >= 2) {
        searchQueries.push(q.keywords.join(" "));
      }
    }

    const uniqueQueries = [...new Set(searchQueries)].slice(0, MAX_SEARCH_QUERIES);

    for (const sq of uniqueQueries) {
      if (allSources.length >= maxSources) break;

      try {
        const results = searchFn
          ? await searchFn(sq)
          : this.fallbackSearch(sq);

        const items = Array.isArray(results) ? results : [];

        for (const item of items.slice(0, MAX_SOURCES_PER_QUERY)) {
          const url = item.url || null;
          if (url && seenUrls.has(url)) continue;
          if (url) seenUrls.add(url);

          allSources.push({
            id: `src_${generateId()}`,
            title: item.title || "Untitled",
            url,
            snippet: item.snippet || "",
            fullContent: item.content || item.snippet || "",
            query: sq,
            relevanceScore: 0,
            retrievedAt: Date.now(),
          });
        }
      } catch {}
    }

    for (const source of allSources) {
      source.relevanceScore = this.computeRelevance(source, questions);
    }

    allSources.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return allSources.slice(0, maxSources);
  }

  private fallbackSearch(query: string): Array<{ title: string; url: string; snippet: string }> {
    return [
      {
        title: `Research result for: ${query.substring(0, 60)}`,
        url: "",
        snippet: `No external search function provided. Query: ${query}`,
      },
    ];
  }

  private computeRelevance(source: SourceResult, questions: ResearchQuestion[]): number {
    let maxScore = 0;
    const contentLower = (source.fullContent + " " + source.title + " " + source.snippet).toLowerCase();

    for (const q of questions) {
      let qScore = 0;
      const qWords = q.question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const matchCount = qWords.filter((w) => contentLower.includes(w)).length;
      qScore += qWords.length > 0 ? matchCount / qWords.length : 0;

      const kwMatchCount = q.keywords.filter((k) => contentLower.includes(k.toLowerCase())).length;
      qScore += q.keywords.length > 0 ? (kwMatchCount / q.keywords.length) * 0.5 : 0;

      if (q.category === "primary") qScore *= 1.2;

      maxScore = Math.max(maxScore, qScore);
    }

    return Math.min(maxScore, 1.0);
  }

  private async extractEvidence(
    questions: ResearchQuestion[],
    sources: SourceResult[]
  ): Promise<EvidenceFragment[]> {
    const evidence: EvidenceFragment[] = [];
    const batchSize = 5;
    const sourceBatches: SourceResult[][] = [];

    for (let i = 0; i < sources.length; i += batchSize) {
      sourceBatches.push(sources.slice(i, i + batchSize));
    }

    for (const batch of sourceBatches) {
      const batchContent = batch
        .map(
          (s, i) =>
            `[Source ${i}] Title: ${s.title}\nContent: ${s.fullContent.substring(0, 800)}`
        )
        .join("\n\n---\n\n");

      const questionsText = questions.map((q) => `- ${q.question}`).join("\n");

      try {
        const response = await llmGateway.chat(
          [
            {
              role: "system" as const,
              content: `You are a research analyst extracting evidence. Given sources and questions, extract specific claims. Output ONLY a JSON array of objects with: "sourceIndex" (number), "claim" (string), "context" (string, brief quote), "confidence" (0-1), "evidenceType" ("supports"|"contradicts"|"neutral"), "questionIndex" (number). Extract 1-3 claims per relevant source. No explanation.`,
            },
            {
              role: "user" as const,
              content: `Questions:\n${questionsText}\n\nSources:\n${batchContent}`,
            },
          ],
          { model: RESEARCH_MODEL, temperature: 0.2, maxTokens: 2000, timeout: 20000 }
        );

        const parsed = JSON.parse(
          response.content.trim().replace(/^```json?\s*/, "").replace(/\s*```$/, "")
        );

        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const sourceIdx = Number(item.sourceIndex);
            const questionIdx = Number(item.questionIndex);
            if (sourceIdx >= 0 && sourceIdx < batch.length && questionIdx >= 0 && questionIdx < questions.length) {
              evidence.push({
                id: `ev_${generateId()}`,
                sourceId: batch[sourceIdx].id,
                claim: String(item.claim || ""),
                context: String(item.context || ""),
                confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5)),
                evidenceType: item.evidenceType || "neutral",
                questionId: questions[questionIdx].id,
              });
            }
          }
        }
      } catch {
        for (const source of batch) {
          if (source.fullContent.length > 50) {
            evidence.push({
              id: `ev_${generateId()}`,
              sourceId: source.id,
              claim: source.snippet.substring(0, 200),
              context: source.fullContent.substring(0, 300),
              confidence: 0.3,
              evidenceType: "neutral",
              questionId: questions[0]?.id || "",
            });
          }
        }
      }
    }

    return evidence;
  }

  private async crossReferenceVerify(evidence: EvidenceFragment[]): Promise<CrossReference[]> {
    const crossRefs: CrossReference[] = [];
    if (evidence.length < 2) return crossRefs;

    const claimGroups = new Map<string, EvidenceFragment[]>();
    for (const ev of evidence) {
      const existing = claimGroups.get(ev.questionId) || [];
      existing.push(ev);
      claimGroups.set(ev.questionId, existing);
    }

    for (const [, fragments] of claimGroups) {
      if (fragments.length < 2) continue;

      for (let i = 0; i < fragments.length; i++) {
        for (let j = i + 1; j < fragments.length; j++) {
          const a = fragments[i];
          const b = fragments[j];

          const similarity = this.textSimilarity(a.claim, b.claim);

          let relationship: CrossReference["relationship"];
          let strength: number;

          if (a.evidenceType === b.evidenceType && similarity > 0.3) {
            relationship = "corroborates";
            strength = similarity * Math.min(a.confidence, b.confidence);
          } else if (
            (a.evidenceType === "supports" && b.evidenceType === "contradicts") ||
            (a.evidenceType === "contradicts" && b.evidenceType === "supports")
          ) {
            relationship = "contradicts";
            strength = similarity * 0.8;
          } else if (similarity > 0.15) {
            relationship = "extends";
            strength = similarity * 0.6;
          } else {
            continue;
          }

          if (strength > 0.1) {
            crossRefs.push({
              fragmentIds: [a.id, b.id],
              relationship,
              strength: Math.min(1, strength),
              note: `${relationship} relationship between evidence from different sources`,
            });
          }
        }
      }
    }

    return crossRefs.sort((a, b) => b.strength - a.strength).slice(0, 50);
  }

  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    return intersection / Math.max(wordsA.size, wordsB.size);
  }

  private scoreConfidence(
    sources: SourceResult[],
    evidence: EvidenceFragment[],
    crossRefs: CrossReference[]
  ): { confidenceScore: number; uncertaintyFactors: string[] } {
    const uncertaintyFactors: string[] = [];
    let score = 0.5;

    if (sources.length === 0) {
      uncertaintyFactors.push("No sources found");
      return { confidenceScore: 0.1, uncertaintyFactors };
    }

    const sourceScore = Math.min(sources.length / 10, 1.0);
    score += sourceScore * 0.15;
    if (sources.length < 3) uncertaintyFactors.push("Limited number of sources");

    const avgRelevance =
      sources.reduce((s, src) => s + src.relevanceScore, 0) / sources.length;
    score += avgRelevance * 0.15;
    if (avgRelevance < 0.4) uncertaintyFactors.push("Low average source relevance");

    const avgConfidence =
      evidence.length > 0
        ? evidence.reduce((s, e) => s + e.confidence, 0) / evidence.length
        : 0;
    score += avgConfidence * 0.2;
    if (avgConfidence < 0.5) uncertaintyFactors.push("Low evidence confidence");

    const corroborations = crossRefs.filter((cr) => cr.relationship === "corroborates").length;
    const contradictions = crossRefs.filter((cr) => cr.relationship === "contradicts").length;

    if (corroborations > 0) score += Math.min(corroborations * 0.03, 0.15);
    if (contradictions > 0) {
      score -= contradictions * 0.05;
      uncertaintyFactors.push(`${contradictions} contradicting evidence pairs found`);
    }

    const questionsWithEvidence = new Set(evidence.map((e) => e.questionId)).size;
    if (questionsWithEvidence < 2) uncertaintyFactors.push("Evidence covers few research questions");

    if (evidence.length === 0) uncertaintyFactors.push("No evidence extracted from sources");

    return {
      confidenceScore: Math.min(1, Math.max(0, score)),
      uncertaintyFactors,
    };
  }
}

export const deepResearchEngine = new DeepResearchEngine();
