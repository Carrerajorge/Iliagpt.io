import { z } from "zod";
import { llmGateway } from "../../lib/llmGateway";
import { Logger } from "../../lib/logger";
import { withRetry } from "../../utils/retry";
import { searchWeb } from "../../services/webSearch";
import { RetrievalPipeline } from "../webtool/retrievalPipeline";
import { EvidenceSynthesizer, type SynthesisReport } from "./evidenceSynthesizer";
import { HypothesisGenerator, type HypothesisReport } from "./hypothesisGenerator";

const RESEARCH_MODEL = process.env.RESEARCH_MODEL || "gpt-4o-mini";
const MAX_SEARCH_QUERIES = 10;
const MAX_SOURCES_PER_QUERY = 6;
const EXTRACTION_BATCH_SIZE = 3;
const EXTRACTION_SOURCE_MAX_CHARS = 3_000;
const RESEARCH_LLM_RETRY_OPTIONS = {
  maxRetries: 2,
  baseDelay: 500,
  maxDelay: 5_000,
  shouldRetry: () => true,
};
const RESEARCH_SEARCH_RETRY_OPTIONS = {
  maxRetries: 2,
  baseDelay: 500,
  maxDelay: 4_000,
  shouldRetry: (error: Error) => /429|timeout|timed out|network|fetch|5\d\d|rate limit/i.test(error.message),
};

const retrievalPipeline = new RetrievalPipeline();

export const ResearchPhase = z.enum([
  "query_decomposition",
  "literature_search",
  "evidence_extraction",
  "cross_reference",
  "hypothesis_generation",
  "confidence_scoring",
]);
export type ResearchPhase = z.infer<typeof ResearchPhase>;

export type ResearchDepth = "shallow" | "standard" | "deep";

export interface ResearchIssue {
  id: string;
  phase: ResearchPhase;
  severity: "warning" | "error";
  message: string;
  detail?: string;
  query?: string;
  sourceUrl?: string | null;
  recoverable: boolean;
  timestamp: number;
}

export interface ResearchProgressEvent {
  phase: ResearchPhase;
  status: "started" | "running" | "completed" | "failed";
  progress: number;
  message?: string;
  queriesCompleted?: number;
  queriesTotal?: number;
  sourcesProcessed?: number;
  sourcesTotal?: number;
  issuesCount?: number;
}

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
  issues: ResearchIssue[];
  partial: boolean;
  statusMessage: string;
  startedAt: number;
  completedAt: number;
  totalDurationMs: number;
}

export interface ResearchSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

export type ResearchSearchFn = (
  query: string,
  options?: { maxResults?: number },
) => Promise<ResearchSearchResultItem[]>;

export interface ResearchOptions {
  maxSources?: number;
  enableHypothesis?: boolean;
  depthLevel?: ResearchDepth | number;
  focusAreas?: string[];
  searchFn?: ResearchSearchFn;
  onProgress?: (event: ResearchProgressEvent) => void;
  onPhaseUpdate?: (
    phase: ResearchPhase,
    progress: number,
    event?: ResearchProgressEvent,
  ) => void;
}

type ResearchExecutionContext = {
  query: string;
  issues: ResearchIssue[];
  onProgress?: ResearchOptions["onProgress"];
  onPhaseUpdate?: ResearchOptions["onPhaseUpdate"];
};

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseJsonPayload<T>(raw: string): T {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence) as T;
  } catch {
    const objectMatch = withoutFence.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]) as T;
    }

    const arrayMatch = withoutFence.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]) as T;
    }

    throw new Error("Model response did not contain valid JSON");
  }
}

function normalizeDepth(depthLevel?: ResearchDepth | number): ResearchDepth {
  if (depthLevel === "shallow" || depthLevel === "standard" || depthLevel === "deep") {
    return depthLevel;
  }

  if (typeof depthLevel === "number") {
    if (depthLevel <= 1) return "shallow";
    if (depthLevel === 2) return "standard";
    return "deep";
  }

  return "standard";
}

function emitProgress(
  context: Pick<ResearchExecutionContext, "onProgress" | "onPhaseUpdate" | "issues">,
  event: ResearchProgressEvent,
): void {
  const enrichedEvent = {
    ...event,
    issuesCount: context.issues.length,
  };

  context.onProgress?.(enrichedEvent);
  context.onPhaseUpdate?.(event.phase, event.progress, enrichedEvent);
}

function recordIssue(
  context: ResearchExecutionContext,
  issue: Omit<ResearchIssue, "id" | "timestamp">,
): ResearchIssue {
  const entry: ResearchIssue = {
    ...issue,
    id: `issue_${generateId()}`,
    timestamp: Date.now(),
  };

  context.issues.push(entry);

  const loggerContext = {
    phase: entry.phase,
    severity: entry.severity,
    message: entry.message,
    detail: entry.detail,
    query: entry.query || context.query,
    sourceUrl: entry.sourceUrl,
    recoverable: entry.recoverable,
  };

  if (entry.severity === "error") {
    Logger.error("[DeepResearch] Recoverable error recorded", loggerContext);
  } else {
    Logger.warn("[DeepResearch] Warning recorded", loggerContext);
  }

  return entry;
}

function buildStatusMessage(result: {
  issues: ResearchIssue[];
  sources: SourceResult[];
  evidence: EvidenceFragment[];
}): string {
  if (result.sources.length === 0) {
    return "La investigación terminó sin fuentes utilizables. Revisa los errores parciales para identificar qué falló en la búsqueda o extracción.";
  }

  if (result.issues.length === 0) {
    return `La investigación completó correctamente con ${result.sources.length} fuentes y ${result.evidence.length} fragmentos de evidencia.`;
  }

  const errorCount = result.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = result.issues.length - errorCount;
  return `La investigación completó con resultados parciales: ${result.sources.length} fuentes, ${result.evidence.length} evidencias, ${errorCount} errores recuperables y ${warningCount} advertencias.`;
}

export async function defaultDeepResearchSearch(
  query: string,
  options: { maxResults?: number } = {},
): Promise<ResearchSearchResultItem[]> {
  const maxResults = Math.max(1, Math.min(options.maxResults || MAX_SOURCES_PER_QUERY, 10));

  try {
    const pipelineResult = await retrievalPipeline.retrieve({
      query,
      maxResults,
      allowBrowser: false,
      preferBrowser: false,
      deduplicateByContent: true,
      minQualityScore: 0,
    });

    if (pipelineResult.results.length > 0) {
      return pipelineResult.results.map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        content: result.content,
      }));
    }
  } catch (error) {
    Logger.warn("[DeepResearch] RetrievalPipeline search failed, falling back to searchWeb", {
      query,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const response = await searchWeb(query, maxResults * 2);
  const contentsByUrl = new Map(response.contents.map((item) => [item.url, item.content]));

  return response.results.slice(0, maxResults).map((result) => ({
    title: result.title || "Untitled",
    url: result.url,
    snippet: result.snippet || "",
    content: contentsByUrl.get(result.url) || result.snippet || "",
  }));
}

export class DeepResearchEngine {
  private synthesizer = new EvidenceSynthesizer();
  private hypothesisGen = new HypothesisGenerator();

  async conduct(query: string, options: ResearchOptions = {}): Promise<ResearchResult> {
    const startedAt = Date.now();
    const researchId = generateId();
    const phasesCompleted: ResearchPhase[] = [];
    const issues: ResearchIssue[] = [];
    const context: ResearchExecutionContext = {
      query,
      issues,
      onProgress: options.onProgress,
      onPhaseUpdate: options.onPhaseUpdate,
    };

    const maxSources = options.maxSources || 20;
    const depthLevel = normalizeDepth(options.depthLevel);
    const enableHypothesis = options.enableHypothesis !== false;

    emitProgress(context, {
      phase: "query_decomposition",
      status: "started",
      progress: 0,
      message: "Descomponiendo la consulta de investigación",
    });
    const questions = await this.decomposeQuery(query, depthLevel, context, options.focusAreas);
    phasesCompleted.push("query_decomposition");
    emitProgress(context, {
      phase: "query_decomposition",
      status: "completed",
      progress: 100,
      message: `${questions.length} preguntas de investigación generadas`,
    });

    emitProgress(context, {
      phase: "literature_search",
      status: "started",
      progress: 0,
      message: "Buscando fuentes relevantes en la web",
    });
    const sources = await this.searchLiterature(questions, maxSources, context, options.searchFn);
    phasesCompleted.push("literature_search");
    emitProgress(context, {
      phase: "literature_search",
      status: "completed",
      progress: 100,
      message: `${sources.length} fuentes recopiladas`,
      sourcesProcessed: sources.length,
      sourcesTotal: Math.max(sources.length, 1),
    });

    emitProgress(context, {
      phase: "evidence_extraction",
      status: "started",
      progress: 0,
      message: "Extrayendo evidencia de las fuentes encontradas",
      sourcesProcessed: 0,
      sourcesTotal: sources.length,
    });
    const evidence = await this.extractEvidence(questions, sources, context);
    phasesCompleted.push("evidence_extraction");
    emitProgress(context, {
      phase: "evidence_extraction",
      status: "completed",
      progress: 100,
      message: `${evidence.length} fragmentos de evidencia extraídos`,
      sourcesProcessed: sources.length,
      sourcesTotal: sources.length,
    });

    emitProgress(context, {
      phase: "cross_reference",
      status: "started",
      progress: 0,
      message: "Verificando corroboraciones y contradicciones",
    });
    const crossReferences = await this.crossReferenceVerify(evidence);
    phasesCompleted.push("cross_reference");
    emitProgress(context, {
      phase: "cross_reference",
      status: "completed",
      progress: 100,
      message: `${crossReferences.length} relaciones entre evidencias verificadas`,
    });

    emitProgress(context, {
      phase: "hypothesis_generation",
      status: "running",
      progress: 10,
      message: "Sintetizando evidencia disponible",
    });
    const synthesis = await this.synthesizer.synthesize(query, evidence, sources, crossReferences, {
      onIssue: (issue) => recordIssue(context, issue),
    });

    let hypotheses: HypothesisReport = {
      hypotheses: [],
      causalChains: [],
      counterfactuals: [],
      generatedAt: Date.now(),
      evidenceBaseSize: evidence.length,
      queryContext: query,
    };

    if (enableHypothesis) {
      hypotheses = await this.hypothesisGen.generate(query, evidence, synthesis, {
        onIssue: (issue) => recordIssue(context, issue),
      });
    }

    phasesCompleted.push("hypothesis_generation");
    emitProgress(context, {
      phase: "hypothesis_generation",
      status: "completed",
      progress: 100,
      message: enableHypothesis
        ? `${hypotheses.hypotheses.length} hipótesis generadas con evidencia sintetizada`
        : "Síntesis completada sin generación de hipótesis",
    });

    emitProgress(context, {
      phase: "confidence_scoring",
      status: "started",
      progress: 0,
      message: "Calculando confianza y factores de incertidumbre",
    });
    const { confidenceScore, uncertaintyFactors } = this.scoreConfidence(sources, evidence, crossReferences);
    phasesCompleted.push("confidence_scoring");
    emitProgress(context, {
      phase: "confidence_scoring",
      status: "completed",
      progress: 100,
      message: `Confianza global: ${(confidenceScore * 100).toFixed(0)}%`,
    });

    const completedAt = Date.now();
    const partial = issues.length > 0;

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
      issues,
      partial,
      statusMessage: buildStatusMessage({ issues, sources, evidence }),
      startedAt,
      completedAt,
      totalDurationMs: completedAt - startedAt,
    };
  }

  private async decomposeQuery(
    query: string,
    depth: ResearchDepth,
    context: ResearchExecutionContext,
    focusAreas?: string[],
  ): Promise<ResearchQuestion[]> {
    const questionCount = depth === "shallow" ? 3 : depth === "standard" ? 5 : 8;
    const focusHint = focusAreas?.length ? `\nFocus areas: ${focusAreas.join(", ")}` : "";

    try {
      const response = await withRetry(
        () =>
          llmGateway.chat(
            [
              {
                role: "system" as const,
                content:
                  `You are a research methodologist. Decompose the user's query into ${questionCount} specific research questions.` +
                  ` Output ONLY a JSON array where each element has: "question" (string), "category" ("primary"|"secondary"|"exploratory"), ` +
                  `"keywords" (string[]), "expectedEvidenceType" ("quantitative"|"qualitative"|"mixed"). No explanation.`,
              },
              {
                role: "user" as const,
                content: `${query}${focusHint}`,
              },
            ],
            { model: RESEARCH_MODEL, temperature: 0.3, maxTokens: 1500, timeout: 15000 },
          ),
        RESEARCH_LLM_RETRY_OPTIONS,
      );

      const parsed = parseJsonPayload<any[]>(response.content);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("The decomposition model returned an empty question list");
      }

      return parsed.map((item, idx) => ({
        id: `q_${generateId()}_${idx}`,
        question: String(item.question || item),
        category: item.category || "primary",
        keywords: Array.isArray(item.keywords) ? item.keywords.map(String) : [],
        expectedEvidenceType: item.expectedEvidenceType || "mixed",
      }));
    } catch (error) {
      recordIssue(context, {
        phase: "query_decomposition",
        severity: "warning",
        message: "Fallo la descomposición LLM; se usó una descomposición de respaldo.",
        detail: error instanceof Error ? error.message : String(error),
        query,
        recoverable: true,
      });

      return this.fallbackDecompose(query);
    }
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
    context: ResearchExecutionContext,
    searchFn?: ResearchSearchFn,
  ): Promise<SourceResult[]> {
    const effectiveSearchFn = searchFn || defaultDeepResearchSearch;
    const allSources: SourceResult[] = [];
    const seenUrls = new Set<string>();
    const searchQueries: string[] = [];

    for (const question of questions) {
      searchQueries.push(question.question);
      if (question.keywords.length >= 2) {
        searchQueries.push(question.keywords.join(" "));
      }
    }

    const uniqueQueries = [...new Set(searchQueries)].slice(0, MAX_SEARCH_QUERIES);
    const perQueryLimit = Math.max(
      3,
      Math.min(MAX_SOURCES_PER_QUERY, Math.ceil(maxSources / Math.max(uniqueQueries.length, 1)) + 2),
    );

    for (let queryIdx = 0; queryIdx < uniqueQueries.length; queryIdx++) {
      if (allSources.length >= maxSources) break;

      const searchQuery = uniqueQueries[queryIdx];
      emitProgress(context, {
        phase: "literature_search",
        status: "running",
        progress: Math.min(99, Math.round((queryIdx / Math.max(uniqueQueries.length, 1)) * 100)),
        message: `Buscando fuentes para: ${searchQuery}`,
        queriesCompleted: queryIdx,
        queriesTotal: uniqueQueries.length,
        sourcesProcessed: allSources.length,
        sourcesTotal: maxSources,
      });

      try {
        const results = await withRetry(
          () => effectiveSearchFn(searchQuery, { maxResults: perQueryLimit }),
          RESEARCH_SEARCH_RETRY_OPTIONS,
        );

        const items = Array.isArray(results) ? results : [];

        if (items.length === 0) {
          recordIssue(context, {
            phase: "literature_search",
            severity: "warning",
            message: "Una consulta de búsqueda no devolvió resultados utilizables.",
            detail: searchQuery,
            query: searchQuery,
            recoverable: true,
          });
        }

        for (const item of items.slice(0, perQueryLimit)) {
          const url = item.url || null;
          if (url && seenUrls.has(url)) continue;
          if (url) seenUrls.add(url);

          allSources.push({
            id: `src_${generateId()}`,
            title: item.title || "Untitled",
            url,
            snippet: item.snippet || "",
            fullContent: item.content || item.snippet || "",
            query: searchQuery,
            relevanceScore: 0,
            retrievedAt: Date.now(),
          });
        }
      } catch (error) {
        recordIssue(context, {
          phase: "literature_search",
          severity: "error",
          message: "Una consulta de búsqueda falló incluso después de reintentos.",
          detail: error instanceof Error ? error.message : String(error),
          query: searchQuery,
          recoverable: true,
        });
      }
    }

    if (allSources.length === 0) {
      recordIssue(context, {
        phase: "literature_search",
        severity: "error",
        message: "La investigación no encontró fuentes utilizables.",
        detail: "All literature-search attempts returned zero usable sources.",
        query: context.query,
        recoverable: true,
      });
    }

    for (const source of allSources) {
      source.relevanceScore = this.computeRelevance(source, questions);
    }

    allSources.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return allSources.slice(0, maxSources);
  }

  private computeRelevance(source: SourceResult, questions: ResearchQuestion[]): number {
    let maxScore = 0;
    const contentLower = `${source.fullContent} ${source.title} ${source.snippet}`.toLowerCase();

    for (const question of questions) {
      let questionScore = 0;
      const questionWords = question.question.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
      const questionMatchCount = questionWords.filter((word) => contentLower.includes(word)).length;
      questionScore += questionWords.length > 0 ? questionMatchCount / questionWords.length : 0;

      const keywordMatchCount = question.keywords.filter((keyword) => contentLower.includes(keyword.toLowerCase())).length;
      questionScore += question.keywords.length > 0 ? (keywordMatchCount / question.keywords.length) * 0.5 : 0;

      if (question.category === "primary") {
        questionScore *= 1.2;
      }

      maxScore = Math.max(maxScore, questionScore);
    }

    return Math.min(maxScore, 1.0);
  }

  private async extractEvidence(
    questions: ResearchQuestion[],
    sources: SourceResult[],
    context: ResearchExecutionContext,
  ): Promise<EvidenceFragment[]> {
    const evidence: EvidenceFragment[] = [];

    if (sources.length === 0) {
      return evidence;
    }

    const sourceBatches: SourceResult[][] = [];
    for (let idx = 0; idx < sources.length; idx += EXTRACTION_BATCH_SIZE) {
      sourceBatches.push(sources.slice(idx, idx + EXTRACTION_BATCH_SIZE));
    }

    for (let batchIdx = 0; batchIdx < sourceBatches.length; batchIdx++) {
      const batch = sourceBatches[batchIdx];
      const batchContent = batch
        .map(
          (source, sourceIdx) =>
            `[Source ${sourceIdx}] Title: ${source.title}\nURL: ${source.url || "unknown"}\n` +
            `Query: ${source.query}\nContent:\n${source.fullContent.substring(0, EXTRACTION_SOURCE_MAX_CHARS)}`,
        )
        .join("\n\n---\n\n");

      const questionsText = questions.map((question) => `- ${question.question}`).join("\n");
      const processedSources = Math.min((batchIdx + 1) * EXTRACTION_BATCH_SIZE, sources.length);

      emitProgress(context, {
        phase: "evidence_extraction",
        status: "running",
        progress: Math.min(99, Math.round((processedSources / Math.max(sources.length, 1)) * 100)),
        message: `Extrayendo evidencia de ${processedSources}/${sources.length} fuentes`,
        sourcesProcessed: processedSources,
        sourcesTotal: sources.length,
      });

      try {
        const response = await withRetry(
          () =>
            llmGateway.chat(
              [
                {
                  role: "system" as const,
                  content:
                    "You are a research analyst extracting evidence from sources. " +
                    "Output ONLY a JSON array of objects with: " +
                    `"sourceIndex" (number), "claim" (string), "context" (string), "confidence" (0-1), ` +
                    `"evidenceType" ("supports"|"contradicts"|"neutral"), "questionIndex" (number). ` +
                    "Extract 1-3 claims per relevant source, prefer concrete findings and preserve useful context for citation.",
                },
                {
                  role: "user" as const,
                  content: `Questions:\n${questionsText}\n\nSources:\n${batchContent}`,
                },
              ],
              { model: RESEARCH_MODEL, temperature: 0.2, maxTokens: 2500, timeout: 25000 },
            ),
          RESEARCH_LLM_RETRY_OPTIONS,
        );

        const parsed = parseJsonPayload<any[]>(response.content);
        if (!Array.isArray(parsed)) {
          throw new Error("Evidence extraction did not return a JSON array");
        }

        for (const item of parsed) {
          const sourceIdx = Number(item.sourceIndex);
          const questionIdx = Number(item.questionIndex);

          if (
            sourceIdx >= 0 &&
            sourceIdx < batch.length &&
            questionIdx >= 0 &&
            questionIdx < questions.length
          ) {
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
      } catch (error) {
        recordIssue(context, {
          phase: "evidence_extraction",
          severity: "warning",
          message: "Falló la extracción LLM para un lote; se usó evidencia de respaldo basada en snippets.",
          detail: error instanceof Error ? error.message : String(error),
          query: context.query,
          recoverable: true,
        });

        evidence.push(...this.createFallbackEvidence(batch, questions));
      }
    }

    if (evidence.length === 0 && sources.length > 0) {
      recordIssue(context, {
        phase: "evidence_extraction",
        severity: "error",
        message: "No se pudo extraer evidencia útil de las fuentes recuperadas.",
        detail: "Every extraction batch produced zero evidence fragments.",
        query: context.query,
        recoverable: true,
      });
    }

    return evidence;
  }

  private createFallbackEvidence(
    batch: SourceResult[],
    questions: ResearchQuestion[],
  ): EvidenceFragment[] {
    return batch
      .filter((source) => source.fullContent.length > 50 || source.snippet.length > 30)
      .map((source, idx) => ({
        id: `ev_${generateId()}_${idx}`,
        sourceId: source.id,
        claim: (source.snippet || source.fullContent).substring(0, 240),
        context: source.fullContent.substring(0, 450) || source.snippet.substring(0, 240),
        confidence: 0.3,
        evidenceType: "neutral" as const,
        questionId: questions[0]?.id || "",
      }));
  }

  private async crossReferenceVerify(evidence: EvidenceFragment[]): Promise<CrossReference[]> {
    const crossReferences: CrossReference[] = [];
    if (evidence.length < 2) return crossReferences;

    const claimGroups = new Map<string, EvidenceFragment[]>();
    for (const fragment of evidence) {
      const existing = claimGroups.get(fragment.questionId) || [];
      existing.push(fragment);
      claimGroups.set(fragment.questionId, existing);
    }

    for (const [, fragments] of claimGroups) {
      if (fragments.length < 2) continue;

      for (let leftIdx = 0; leftIdx < fragments.length; leftIdx++) {
        for (let rightIdx = leftIdx + 1; rightIdx < fragments.length; rightIdx++) {
          const left = fragments[leftIdx];
          const right = fragments[rightIdx];
          const similarity = this.textSimilarity(left.claim, right.claim);

          let relationship: CrossReference["relationship"];
          let strength: number;

          if (left.evidenceType === right.evidenceType && similarity > 0.3) {
            relationship = "corroborates";
            strength = similarity * Math.min(left.confidence, right.confidence);
          } else if (
            (left.evidenceType === "supports" && right.evidenceType === "contradicts") ||
            (left.evidenceType === "contradicts" && right.evidenceType === "supports")
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
            crossReferences.push({
              fragmentIds: [left.id, right.id],
              relationship,
              strength: Math.min(1, strength),
              note: `${relationship} relationship between evidence from different sources`,
            });
          }
        }
      }
    }

    return crossReferences.sort((a, b) => b.strength - a.strength).slice(0, 50);
  }

  private textSimilarity(left: string, right: string): number {
    const wordsA = new Set(left.toLowerCase().split(/\s+/).filter((word) => word.length > 3));
    const wordsB = new Set(right.toLowerCase().split(/\s+/).filter((word) => word.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++;
    }

    return intersection / Math.max(wordsA.size, wordsB.size);
  }

  private scoreConfidence(
    sources: SourceResult[],
    evidence: EvidenceFragment[],
    crossReferences: CrossReference[],
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

    const averageRelevance =
      sources.reduce((sum, source) => sum + source.relevanceScore, 0) / sources.length;
    score += averageRelevance * 0.15;
    if (averageRelevance < 0.4) uncertaintyFactors.push("Low average source relevance");

    const averageEvidenceConfidence =
      evidence.length > 0
        ? evidence.reduce((sum, fragment) => sum + fragment.confidence, 0) / evidence.length
        : 0;
    score += averageEvidenceConfidence * 0.2;
    if (averageEvidenceConfidence < 0.5) uncertaintyFactors.push("Low evidence confidence");

    const corroborations = crossReferences.filter((item) => item.relationship === "corroborates").length;
    const contradictions = crossReferences.filter((item) => item.relationship === "contradicts").length;

    if (corroborations > 0) score += Math.min(corroborations * 0.03, 0.15);
    if (contradictions > 0) {
      score -= contradictions * 0.05;
      uncertaintyFactors.push(`${contradictions} contradicting evidence pairs found`);
    }

    const questionsWithEvidence = new Set(evidence.map((fragment) => fragment.questionId)).size;
    if (questionsWithEvidence < 2) uncertaintyFactors.push("Evidence covers few research questions");
    if (evidence.length === 0) uncertaintyFactors.push("No evidence extracted from sources");

    return {
      confidenceScore: Math.min(1, Math.max(0, score)),
      uncertaintyFactors,
    };
  }
}

export const deepResearchEngine = new DeepResearchEngine();
