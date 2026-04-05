import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import {
  getClaudeAgentBackbone,
  CLAUDE_MODELS,
  type AgentMessage,
  type ToolDefinition,
} from "./ClaudeAgentBackbone.js";

const logger = pino({ name: "AutonomousResearchAgent" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResearchDepth = "quick" | "standard" | "deep";

export type SourceType = "web" | "academic" | "rag" | "document" | "database";

export interface ResearchSource {
  sourceId: string;
  type: SourceType;
  title: string;
  url?: string;
  content: string;
  relevanceScore: number; // 0-1
  credibilityScore: number; // 0-1
  date?: string;
  author?: string;
  language?: string;
  biasIndicators: string[];
}

export interface ResearchFinding {
  findingId: string;
  claim: string;
  evidence: string;
  sourceIds: string[];
  confidence: number; // 0-1
  contradicts?: string[]; // findingIds this contradicts
  category: string; // what aspect of the research question this addresses
}

export interface ResearchReport {
  reportId: string;
  question: string;
  depth: ResearchDepth;
  executiveSummary: string;
  sections: ReportSection[];
  findings: ResearchFinding[];
  sources: ResearchSource[];
  contradictions: Array<{
    topic: string;
    positions: Array<{ claim: string; sourceId: string }>;
    resolution?: string;
  }>;
  limitations: string[];
  recommendations: string[];
  biasWarnings: string[];
  languages: string[];
  generatedAt: number;
  researchDurationMs: number;
  totalSourcesEvaluated: number;
  totalSourcesUsed: number;
}

export interface ReportSection {
  title: string;
  content: string;
  citations: string[]; // sourceIds
  confidence: number;
}

export interface ResearchProgress {
  sessionId: string;
  phase: "planning" | "searching" | "reading" | "analyzing" | "synthesizing" | "complete";
  currentTask: string;
  sourcesFound: number;
  sourcesRead: number;
  findingsExtracted: number;
  percentComplete: number;
  estimatedRemainingMs: number;
}

export interface ResearchConfig {
  maxSources?: number; // default per depth: quick=5, standard=15, deep=30
  maxQueriesPerAngle?: number; // default 3
  credibilityThreshold?: number; // default 0.5
  detectBias?: boolean; // default true
  multiLanguage?: boolean; // default false
  searchTools?: string[]; // tool names to use for search
}

// ─── Depth configs ────────────────────────────────────────────────────────────

const DEPTH_CONFIG: Record<ResearchDepth, {
  maxSources: number;
  searchAngles: number;
  maxQueriesPerAngle: number;
  reportSections: number;
  useAcademic: boolean;
}> = {
  quick: { maxSources: 5, searchAngles: 2, maxQueriesPerAngle: 2, reportSections: 3, useAcademic: false },
  standard: { maxSources: 15, searchAngles: 4, maxQueriesPerAngle: 3, reportSections: 5, useAcademic: true },
  deep: { maxSources: 30, searchAngles: 6, maxQueriesPerAngle: 4, reportSections: 8, useAcademic: true },
};

// ─── AutonomousResearchAgent ──────────────────────────────────────────────────

export class AutonomousResearchAgent extends EventEmitter {
  private activeSessions = new Map<string, ResearchProgress>();
  private completedReports = new Map<string, ResearchReport>();

  constructor(
    private readonly backbone = getClaudeAgentBackbone(),
    private readonly config: ResearchConfig = {}
  ) {
    super();
    logger.info("[AutonomousResearchAgent] Initialized");
  }

  // ── Main research entry point ─────────────────────────────────────────────────

  async research(
    question: string,
    depth: ResearchDepth = "standard",
    toolHandlers: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {}
  ): Promise<ResearchReport> {
    const sessionId = randomUUID();
    const depthCfg = DEPTH_CONFIG[depth];
    const startedAt = Date.now();

    const progress: ResearchProgress = {
      sessionId,
      phase: "planning",
      currentTask: "Planning research strategy",
      sourcesFound: 0,
      sourcesRead: 0,
      findingsExtracted: 0,
      percentComplete: 0,
      estimatedRemainingMs: depth === "quick" ? 300_000 : depth === "standard" ? 900_000 : 1_800_000,
    };

    this.activeSessions.set(sessionId, progress);
    this.emit("research:started", { sessionId, question, depth });

    logger.info({ sessionId, question: question.slice(0, 80), depth }, "[AutonomousResearchAgent] Research started");

    // Phase 1: Planning — generate search queries from multiple angles
    this.updateProgress(sessionId, "planning", "Generating search queries", 5);
    const searchPlan = await this.generateSearchPlan(question, depth);

    // Phase 2: Searching
    this.updateProgress(sessionId, "searching", "Executing searches", 10);
    const sources = await this.executeSearches(sessionId, searchPlan, depthCfg, toolHandlers);

    // Phase 3: Reading + quality assessment
    this.updateProgress(sessionId, "reading", "Reading and evaluating sources", 40);
    const evaluatedSources = await this.evaluateSources(question, sources);

    // Filter by credibility
    const threshold = this.config.credibilityThreshold ?? 0.5;
    const qualitySources = evaluatedSources.filter((s) => s.credibilityScore >= threshold);

    // Phase 4: Analysis — extract findings, detect contradictions
    this.updateProgress(sessionId, "analyzing", "Extracting findings", 65);
    const findings = await this.extractFindings(question, qualitySources);
    const contradictions = this.detectContradictions(findings, qualitySources);

    // Bias detection
    const biasWarnings: string[] = [];
    if (this.config.detectBias !== false) {
      const biases = await this.detectBias(qualitySources);
      biasWarnings.push(...biases);
    }

    // Phase 5: Synthesis
    this.updateProgress(sessionId, "synthesizing", "Writing report", 80);
    const report = await this.synthesizeReport(
      sessionId,
      question,
      depth,
      qualitySources,
      findings,
      contradictions,
      biasWarnings,
      depthCfg.reportSections,
      startedAt
    );

    this.updateProgress(sessionId, "complete", "Research complete", 100);
    this.completedReports.set(report.reportId, report);
    this.activeSessions.delete(sessionId);

    logger.info(
      {
        reportId: report.reportId,
        sources: report.totalSourcesUsed,
        findings: findings.length,
        durationMs: Date.now() - startedAt,
      },
      "[AutonomousResearchAgent] Research complete"
    );

    this.emit("research:completed", report);
    return report;
  }

  // ── Phase 1: Search plan ──────────────────────────────────────────────────────

  private async generateSearchPlan(
    question: string,
    depth: ResearchDepth
  ): Promise<Array<{ angle: string; queries: string[] }>> {
    const depthCfg = DEPTH_CONFIG[depth];

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Generate a comprehensive search plan for this research question.

QUESTION: ${question}
DEPTH: ${depth} (${depthCfg.searchAngles} angles, ${depthCfg.maxQueriesPerAngle} queries each)

Generate ${depthCfg.searchAngles} different research angles and ${depthCfg.maxQueriesPerAngle} specific search queries per angle.

Angles should cover: direct answer, background context, opposing views, recent developments, academic perspective, practical applications.

Output JSON: [{"angle": "angle description", "queries": ["query 1", "query 2"]}]
Return ONLY valid JSON array.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 1024,
      system: "You generate comprehensive, multi-angle research plans for autonomous research.",
    });

    try {
      const jsonMatch = response.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as Array<{ angle: string; queries: string[] }>;
      }
    } catch {
      // Fall back to simple plan
    }

    return [
      { angle: "Direct answer", queries: [question] },
      { angle: "Background", queries: [`background of ${question}`] },
    ];
  }

  // ── Phase 2: Search execution ─────────────────────────────────────────────────

  private async executeSearches(
    sessionId: string,
    searchPlan: Array<{ angle: string; queries: string[] }>,
    depthCfg: typeof DEPTH_CONFIG[ResearchDepth],
    toolHandlers: Record<string, (input: Record<string, unknown>) => Promise<unknown>>
  ): Promise<ResearchSource[]> {
    const sources: ResearchSource[] = [];
    const maxSources = this.config.maxSources ?? depthCfg.maxSources;
    let totalFound = 0;

    for (const { angle, queries } of searchPlan) {
      if (sources.length >= maxSources) break;

      for (const query of queries.slice(0, this.config.maxQueriesPerAngle ?? depthCfg.maxQueriesPerAngle)) {
        if (sources.length >= maxSources) break;

        // Try web search tool if available
        const searchHandler = toolHandlers["web_search"] ?? toolHandlers["search"];
        if (searchHandler) {
          try {
            const results = await searchHandler({ query, maxResults: 5 });
            const resultList = Array.isArray(results) ? results : [results];

            for (const r of resultList.slice(0, 3)) {
              const result = r as Record<string, unknown>;
              const source: ResearchSource = {
                sourceId: randomUUID(),
                type: "web",
                title: String(result["title"] ?? query),
                url: String(result["url"] ?? ""),
                content: String(result["snippet"] ?? result["content"] ?? ""),
                relevanceScore: 0.7, // will be updated in evaluation
                credibilityScore: 0.5,
                biasIndicators: [],
              };
              sources.push(source);
              totalFound++;
            }
          } catch {
            // Tool not available or failed
          }
        }

        // Fallback: use LLM knowledge
        if (sources.length < 3) {
          const syntheticSource = await this.generateKnowledgeSource(query, angle);
          sources.push(syntheticSource);
        }
      }
    }

    const progress = this.activeSessions.get(sessionId);
    if (progress) {
      progress.sourcesFound = totalFound;
      this.emit("research:progress", progress);
    }

    return sources;
  }

  private async generateKnowledgeSource(query: string, angle: string): Promise<ResearchSource> {
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Based on your knowledge, provide factual information for this research query.

QUERY: ${query}
ANGLE: ${angle}

Provide relevant, accurate information. Cite any specific facts you can.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 512,
      system: "You provide factual research information from your training knowledge.",
    });

    return {
      sourceId: randomUUID(),
      type: "document",
      title: `Knowledge: ${query.slice(0, 50)}`,
      content: response.text,
      relevanceScore: 0.8,
      credibilityScore: 0.7, // LLM knowledge — moderate trust
      biasIndicators: ["ai_generated"],
    };
  }

  // ── Phase 3: Source evaluation ────────────────────────────────────────────────

  private async evaluateSources(
    question: string,
    sources: ResearchSource[]
  ): Promise<ResearchSource[]> {
    // Batch evaluate in groups of 5
    const batches: ResearchSource[][] = [];
    for (let i = 0; i < sources.length; i += 5) {
      batches.push(sources.slice(i, i + 5));
    }

    const evaluated: ResearchSource[] = [];

    for (const batch of batches) {
      const messages: AgentMessage[] = [
        {
          role: "user",
          content: `Evaluate these sources for a research question.

QUESTION: ${question}

SOURCES:
${batch.map((s, i) => `[${i}] ${s.title}\n${s.content.slice(0, 300)}`).join("\n\n")}

For each source, rate 0-1: relevanceScore, credibilityScore.
Flag bias indicators if any.

Output JSON array matching source indices:
[{"index": 0, "relevanceScore": 0.0, "credibilityScore": 0.0, "biasIndicators": []}]
Return ONLY valid JSON array.`,
        },
      ];

      try {
        const response = await this.backbone.call(messages, {
          model: CLAUDE_MODELS.HAIKU,
          maxTokens: 512,
          system: "Evaluate research sources for relevance and credibility.",
        });

        const jsonMatch = response.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const ratings = JSON.parse(jsonMatch[0]) as Array<{
            index: number;
            relevanceScore?: number;
            credibilityScore?: number;
            biasIndicators?: string[];
          }>;

          for (const rating of ratings) {
            if (rating.index >= 0 && rating.index < batch.length) {
              const source = { ...batch[rating.index] };
              source.relevanceScore = rating.relevanceScore ?? source.relevanceScore;
              source.credibilityScore = rating.credibilityScore ?? source.credibilityScore;
              source.biasIndicators = rating.biasIndicators ?? source.biasIndicators;
              evaluated.push(source);
            }
          }
          continue;
        }
      } catch {
        // Fall through
      }

      evaluated.push(...batch);
    }

    return evaluated;
  }

  // ── Phase 4: Finding extraction ───────────────────────────────────────────────

  private async extractFindings(
    question: string,
    sources: ResearchSource[]
  ): Promise<ResearchFinding[]> {
    const sourceTexts = sources
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 10)
      .map((s) => `[${s.sourceId.slice(0, 8)}] ${s.title}:\n${s.content.slice(0, 400)}`)
      .join("\n\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Extract key findings from these research sources.

QUESTION: ${question}

SOURCES:
${sourceTexts}

Extract 5-10 distinct findings. Each should be a specific claim with evidence.

Output JSON array:
[{
  "claim": "specific factual claim",
  "evidence": "supporting text from sources",
  "sourceIds": ["sourceId prefix"],
  "confidence": 0.0-1.0,
  "category": "what aspect this addresses"
}]
Return ONLY valid JSON array.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.SONNET,
      maxTokens: 2048,
      system: "Extract precise, evidenced findings from research sources.",
    });

    try {
      const jsonMatch = response.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const raw = JSON.parse(jsonMatch[0]) as Array<{
          claim?: string;
          evidence?: string;
          sourceIds?: string[];
          confidence?: number;
          category?: string;
        }>;

        return raw
          .filter((f) => f.claim && f.evidence)
          .map((f) => ({
            findingId: randomUUID(),
            claim: f.claim!,
            evidence: f.evidence!,
            sourceIds: f.sourceIds ?? [],
            confidence: f.confidence ?? 0.7,
            category: f.category ?? "general",
          }));
      }
    } catch {
      // Fall through
    }

    return [];
  }

  // ── Contradiction detection ───────────────────────────────────────────────────

  private detectContradictions(
    findings: ResearchFinding[],
    sources: ResearchSource[]
  ): ResearchReport["contradictions"] {
    const contradictions: ResearchReport["contradictions"] = [];

    for (let i = 0; i < findings.length; i++) {
      for (let j = i + 1; j < findings.length; j++) {
        const a = findings[i];
        const b = findings[j];

        // Simple heuristic: same category but very different confidence levels or opposing indicators
        if (
          a.category === b.category &&
          Math.abs(a.confidence - b.confidence) > 0.3
        ) {
          contradictions.push({
            topic: a.category,
            positions: [
              {
                claim: a.claim,
                sourceId: a.sourceIds[0] ?? "unknown",
              },
              {
                claim: b.claim,
                sourceId: b.sourceIds[0] ?? "unknown",
              },
            ],
          });

          // Mark as contradicting each other
          if (!a.contradicts) a.contradicts = [];
          if (!b.contradicts) b.contradicts = [];
          a.contradicts.push(b.findingId);
          b.contradicts.push(a.findingId);
        }
      }
    }

    return contradictions;
  }

  // ── Bias detection ────────────────────────────────────────────────────────────

  private async detectBias(sources: ResearchSource[]): Promise<string[]> {
    const biasedSources = sources.filter((s) => s.biasIndicators.length > 0);
    if (biasedSources.length === 0) return [];

    const warnings: string[] = [];

    for (const source of biasedSources) {
      if (source.biasIndicators.includes("ai_generated")) {
        warnings.push(`Source "${source.title.slice(0, 40)}" is AI-generated — treat with appropriate skepticism`);
      }
      if (source.biasIndicators.length > 1) {
        warnings.push(`Source "${source.title.slice(0, 40)}" shows bias indicators: ${source.biasIndicators.join(", ")}`);
      }
    }

    return [...new Set(warnings)];
  }

  // ── Phase 5: Report synthesis ─────────────────────────────────────────────────

  private async synthesizeReport(
    sessionId: string,
    question: string,
    depth: ResearchDepth,
    sources: ResearchSource[],
    findings: ResearchFinding[],
    contradictions: ResearchReport["contradictions"],
    biasWarnings: string[],
    sectionCount: number,
    startedAt: number
  ): Promise<ResearchReport> {
    const topFindings = findings
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8)
      .map((f) => `- ${f.claim} (confidence: ${f.confidence.toFixed(2)})`)
      .join("\n");

    const messages: AgentMessage[] = [
      {
        role: "user",
        content: `Write a comprehensive research report.

QUESTION: ${question}
DEPTH: ${depth}

KEY FINDINGS:
${topFindings}

CONTRADICTIONS FOUND: ${contradictions.length}

Write a ${sectionCount}-section report covering:
1. Executive summary
2. Background and context
3. Main findings
4. Analysis and implications
5. Contradictions and limitations (if any)
${sectionCount > 5 ? "6. Recommendations\n7. Methodology\n8. Conclusion" : "6. Conclusion"}

Output JSON:
{
  "executiveSummary": "2-3 sentence summary",
  "sections": [{"title": "...", "content": "...", "confidence": 0.0-1.0}],
  "limitations": ["limitation 1"],
  "recommendations": ["recommendation 1"]
}
Return ONLY valid JSON.`,
      },
    ];

    const response = await this.backbone.call(messages, {
      model: CLAUDE_MODELS.OPUS,
      maxTokens: 4096,
      system:
        "You write comprehensive, well-structured research reports. Be precise, cite evidence, acknowledge uncertainty.",
    });

    let parsed: {
      executiveSummary?: string;
      sections?: Array<{ title?: string; content?: string; confidence?: number }>;
      limitations?: string[];
      recommendations?: string[];
    } = {};

    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      parsed = { executiveSummary: response.text.slice(0, 300) };
    }

    const languages = [
      ...new Set(sources.map((s) => s.language ?? "en").filter(Boolean)),
    ];

    const report: ResearchReport = {
      reportId: randomUUID(),
      question,
      depth,
      executiveSummary: String(parsed.executiveSummary ?? "Research completed."),
      sections: (parsed.sections ?? []).map((s) => ({
        title: String(s.title ?? ""),
        content: String(s.content ?? ""),
        citations: sources.slice(0, 3).map((src) => src.sourceId),
        confidence: Number(s.confidence ?? 0.7),
      })),
      findings,
      sources,
      contradictions,
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      biasWarnings,
      languages,
      generatedAt: Date.now(),
      researchDurationMs: Date.now() - startedAt,
      totalSourcesEvaluated: sources.length,
      totalSourcesUsed: sources.filter((s) => s.credibilityScore >= 0.5).length,
    };

    return report;
  }

  // ── Progress tracking ─────────────────────────────────────────────────────────

  private updateProgress(
    sessionId: string,
    phase: ResearchProgress["phase"],
    currentTask: string,
    percent: number
  ): void {
    const progress = this.activeSessions.get(sessionId);
    if (!progress) return;

    progress.phase = phase;
    progress.currentTask = currentTask;
    progress.percentComplete = percent;

    this.emit("research:progress", { ...progress });
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getProgress(sessionId: string): ResearchProgress | null {
    return this.activeSessions.get(sessionId) ?? null;
  }

  getReport(reportId: string): ResearchReport | null {
    return this.completedReports.get(reportId) ?? null;
  }

  listReports(): ResearchReport[] {
    return Array.from(this.completedReports.values()).sort(
      (a, b) => b.generatedAt - a.generatedAt
    );
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _instance: AutonomousResearchAgent | null = null;

export function getAutonomousResearchAgent(
  config?: ResearchConfig
): AutonomousResearchAgent {
  if (!_instance) _instance = new AutonomousResearchAgent(undefined, config);
  return _instance;
}
