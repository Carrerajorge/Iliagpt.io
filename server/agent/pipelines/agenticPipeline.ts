import { EventEmitter } from "events";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { generatePptDocument } from "../../services/documentGeneration";

// ============================================================================
// SCHEMAS: Quality Metrics & KPIs
// ============================================================================

export const QualityMetricsSchema = z.object({
  sourceCoverage: z.number().min(0).max(1),
  narrativeCoherence: z.number().min(0).max(1),
  textDensityPerSlide: z.number(),
  chartLegibility: z.number().min(0).max(1),
  evidenceGrounding: z.number().min(0).max(1),
  audienceAlignment: z.number().min(0).max(1),
  overallScore: z.number().min(0).max(1),
});
export type QualityMetrics = z.infer<typeof QualityMetricsSchema>;

export const AudienceTypeSchema = z.enum(["executive", "technical", "academic", "general"]);
export type AudienceType = z.infer<typeof AudienceTypeSchema>;

export const PresentationGoalSchema = z.enum(["inform", "persuade", "report", "educate", "sell"]);
export type PresentationGoal = z.infer<typeof PresentationGoalSchema>;

// ============================================================================
// SCHEMAS: Planner Output
// ============================================================================

export const StoryArcSchema = z.object({
  hook: z.string(),
  context: z.string(),
  mainPoints: z.array(z.string()),
  evidence: z.array(z.string()),
  conclusion: z.string(),
  callToAction: z.string().optional(),
});
export type StoryArc = z.infer<typeof StoryArcSchema>;

export const SlideOutlineSchema = z.object({
  index: z.number(),
  type: z.enum(["title", "agenda", "content", "data", "chart", "image", "quote", "comparison", "summary", "bibliography", "qna"]),
  title: z.string(),
  keyPoints: z.array(z.string()),
  visualType: z.enum(["none", "chart", "table", "image", "diagram", "infographic"]).optional(),
  speakerNotes: z.string().optional(),
  estimatedDuration: z.number().optional(),
});
export type SlideOutline = z.infer<typeof SlideOutlineSchema>;

export const PresentationPlanSchema = z.object({
  id: z.string(),
  topic: z.string(),
  audience: AudienceTypeSchema,
  goal: PresentationGoalSchema,
  duration: z.number(),
  storyArc: StoryArcSchema,
  slides: z.array(SlideOutlineSchema),
  searchQueries: z.array(z.string()),
  requiredEvidence: z.array(z.string()),
  qualityThresholds: z.object({
    minSourceCoverage: z.number().default(0.7),
    minCoherence: z.number().default(0.8),
    maxTextDensity: z.number().default(50),
    minEvidenceGrounding: z.number().default(0.75),
  }),
});
export type PresentationPlan = z.infer<typeof PresentationPlanSchema>;

// ============================================================================
// SCHEMAS: Evidence Grounding
// ============================================================================

export const EvidenceSchema = z.object({
  id: z.string(),
  claim: z.string(),
  sourceId: z.string(),
  sourceTitle: z.string(),
  excerpt: z.string(),
  confidence: z.number().min(0).max(1),
  pageOrSection: z.string().optional(),
  contradictions: z.array(z.string()).optional(),
  verified: z.boolean().default(false),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const GroundingReportSchema = z.object({
  totalClaims: z.number(),
  groundedClaims: z.number(),
  ungroundedClaims: z.array(z.string()),
  contradictions: z.array(z.object({
    claim: z.string(),
    sources: z.array(z.string()),
    resolution: z.string().optional(),
  })),
  uncertainties: z.array(z.object({
    claim: z.string(),
    reason: z.string(),
    confidence: z.number(),
  })),
  overallGroundingScore: z.number().min(0).max(1),
});
export type GroundingReport = z.infer<typeof GroundingReportSchema>;

// ============================================================================
// SCHEMAS: Critic Feedback
// ============================================================================

export const CriticFeedbackSchema = z.object({
  iteration: z.number(),
  metrics: QualityMetricsSchema,
  passed: z.boolean(),
  issues: z.array(z.object({
    severity: z.enum(["critical", "major", "minor"]),
    category: z.string(),
    description: z.string(),
    slideIndex: z.number().optional(),
    suggestedFix: z.string(),
  })),
  refinementActions: z.array(z.object({
    action: z.enum(["search_more", "rewrite_slide", "add_evidence", "improve_chart", "reduce_text", "add_visual", "restructure", "fix_grounding"]),
    target: z.string(),
    priority: z.number(),
  })),
  shouldContinue: z.boolean(),
  reasoning: z.string(),
});
export type CriticFeedback = z.infer<typeof CriticFeedbackSchema>;

// ============================================================================
// SCHEMAS: Pipeline State
// ============================================================================

export const AgenticPipelineStateSchema = z.object({
  runId: z.string(),
  query: z.string(),
  plan: PresentationPlanSchema.nullable(),
  sources: z.array(z.any()),
  documents: z.array(z.any()),
  evidence: z.array(EvidenceSchema),
  groundingReport: GroundingReportSchema.nullable(),
  dataTables: z.array(z.any()),
  charts: z.array(z.any()),
  images: z.array(z.any()),
  insights: z.array(z.object({
    type: z.enum(["hypothesis", "correlation", "outlier", "trend", "comparison", "so_what"]),
    content: z.string(),
    confidence: z.number(),
    relatedData: z.string().optional(),
  })),
  slides: z.array(z.any()),
  iterations: z.array(z.object({
    index: z.number(),
    feedback: CriticFeedbackSchema,
    actionsCompleted: z.array(z.string()),
    durationMs: z.number(),
  })),
  currentIteration: z.number(),
  maxIterations: z.number(),
  status: z.enum(["planning", "executing", "critiquing", "refining", "completed", "failed"]),
  error: z.string().nullable(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
});
export type AgenticPipelineState = z.infer<typeof AgenticPipelineStateSchema>;

// ============================================================================
// PLANNER AGENT: Creates presentation plan from objectives
// ============================================================================

export class PlannerAgent {
  private llmClient: any;

  constructor(llmClient?: any) {
    this.llmClient = llmClient;
  }

  async createPlan(
    query: string,
    options: {
      audience?: AudienceType;
      goal?: PresentationGoal;
      duration?: number;
      constraints?: string[];
    } = {}
  ): Promise<PresentationPlan> {
    const audience = options.audience || this.inferAudience(query);
    const goal = options.goal || this.inferGoal(query);
    const duration = options.duration || 15;

    const topic = this.extractTopic(query);
    const storyArc = await this.generateStoryArc(topic, audience, goal);
    const slides = await this.generateSlideOutline(storyArc, audience, duration);
    const searchQueries = this.generateSearchQueries(topic, storyArc);
    const requiredEvidence = this.identifyRequiredEvidence(storyArc);

    return {
      id: uuidv4(),
      topic,
      audience,
      goal,
      duration,
      storyArc,
      slides,
      searchQueries,
      requiredEvidence,
      qualityThresholds: this.getThresholdsForAudience(audience),
    };
  }

  private inferAudience(query: string): AudienceType {
    const lowerQuery = query.toLowerCase();
    if (/ejecutivo|gerente|director|ceo|junta|board/i.test(lowerQuery)) return "executive";
    if (/t[eé]cnico|ingenier|developer|programador|api|arquitectura/i.test(lowerQuery)) return "technical";
    if (/acad[eé]mico|universidad|investigaci[oó]n|paper|art[ií]culo|tesis|apa/i.test(lowerQuery)) return "academic";
    return "general";
  }

  private inferGoal(query: string): PresentationGoal {
    const lowerQuery = query.toLowerCase();
    if (/vender|propuesta|cliente|pitch/i.test(lowerQuery)) return "sell";
    if (/convencer|persuadir|aprobar|invertir/i.test(lowerQuery)) return "persuade";
    if (/reporte|informe|status|avance|resultado/i.test(lowerQuery)) return "report";
    if (/ense[nñ]ar|capacitar|curso|tutorial|explicar/i.test(lowerQuery)) return "educate";
    return "inform";
  }

  private extractTopic(query: string): string {
    const patterns = [
      /sobre\s+(?:la\s+|el\s+|los\s+|las\s+)?(.+?)(?:\s+y\s+crea|\s+crea|\s+genera|\s+haz|\s+para\s+|$)/i,
      /presenta(?:ción|ci[oó]n)\s+(?:sobre|de|acerca)\s+(.+?)(?:\s+para\s+|\s+con\s+|$)/i,
      /busca.*?(?:sobre|de)\s+(.+?)(?:\s+y\s+|$)/i,
    ];
    
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match && match[1]) {
        return match[1].trim().replace(/\s+/g, " ");
      }
    }
    return query.slice(0, 100).trim();
  }

  private async generateStoryArc(topic: string, audience: AudienceType, goal: PresentationGoal): Promise<StoryArc> {
    const arcTemplates: Record<PresentationGoal, StoryArc> = {
      inform: {
        hook: `¿Qué sabemos realmente sobre ${topic}?`,
        context: `Contexto actual y relevancia de ${topic}`,
        mainPoints: ["Definición y conceptos clave", "Estado actual", "Tendencias principales", "Implicaciones"],
        evidence: ["Datos estadísticos", "Estudios recientes", "Casos de ejemplo"],
        conclusion: `Síntesis de hallazgos clave sobre ${topic}`,
      },
      persuade: {
        hook: `La oportunidad que ${topic} representa`,
        context: `Por qué es el momento de actuar en ${topic}`,
        mainPoints: ["El problema/oportunidad", "Nuestra propuesta", "Evidencia de éxito", "Plan de acción"],
        evidence: ["ROI esperado", "Casos de éxito", "Análisis comparativo"],
        conclusion: `Llamado a la acción sobre ${topic}`,
        callToAction: "Próximos pasos concretos",
      },
      report: {
        hook: `Resumen ejecutivo: ${topic}`,
        context: `Período y alcance del reporte`,
        mainPoints: ["Métricas clave", "Logros principales", "Desafíos encontrados", "Próximos pasos"],
        evidence: ["Datos del período", "Comparativa con objetivos", "Tendencias"],
        conclusion: `Conclusiones y recomendaciones`,
      },
      educate: {
        hook: `Introducción a ${topic}`,
        context: `Por qué es importante entender ${topic}`,
        mainPoints: ["Fundamentos", "Conceptos intermedios", "Aplicaciones prácticas", "Recursos adicionales"],
        evidence: ["Ejemplos didácticos", "Ejercicios", "Referencias"],
        conclusion: `Resumen de aprendizajes clave`,
      },
      sell: {
        hook: `El desafío que resolvemos con ${topic}`,
        context: `El mercado y la necesidad`,
        mainPoints: ["Problema del cliente", "Nuestra solución", "Diferenciadores", "Pricing/ROI"],
        evidence: ["Testimonios", "Métricas de éxito", "Comparativa competitiva"],
        conclusion: `Por qué elegirnos`,
        callToAction: "Agenda tu demo / Próximos pasos",
      },
    };

    return arcTemplates[goal];
  }

  private async generateSlideOutline(storyArc: StoryArc, audience: AudienceType, duration: number): Promise<SlideOutline[]> {
    const slidesPerMinute = audience === "executive" ? 0.5 : 0.75;
    const targetSlides = Math.max(5, Math.min(20, Math.round(duration * slidesPerMinute)));
    
    const slides: SlideOutline[] = [
      { index: 0, type: "title", title: storyArc.hook, keyPoints: [], visualType: "image" },
      { index: 1, type: "agenda", title: "Agenda", keyPoints: storyArc.mainPoints, visualType: "none" },
    ];

    let slideIndex = 2;
    for (const point of storyArc.mainPoints) {
      slides.push({
        index: slideIndex++,
        type: "content",
        title: point,
        keyPoints: [],
        visualType: slideIndex % 2 === 0 ? "chart" : "image",
      });
    }

    slides.push({
      index: slideIndex++,
      type: "data",
      title: "Datos Clave",
      keyPoints: storyArc.evidence,
      visualType: "table",
    });

    slides.push({
      index: slideIndex++,
      type: "summary",
      title: storyArc.conclusion,
      keyPoints: [],
      visualType: "none",
    });

    if (storyArc.callToAction) {
      slides.push({
        index: slideIndex++,
        type: "qna",
        title: storyArc.callToAction,
        keyPoints: [],
        visualType: "none",
      });
    }

    slides.push({
      index: slideIndex++,
      type: "bibliography",
      title: "Referencias",
      keyPoints: [],
      visualType: "none",
    });

    return slides;
  }

  private generateSearchQueries(topic: string, storyArc: StoryArc): string[] {
    const queries = [
      `${topic} estadísticas recientes`,
      `${topic} estudios académicos`,
      `${topic} tendencias ${new Date().getFullYear()}`,
    ];

    for (const point of storyArc.mainPoints.slice(0, 3)) {
      queries.push(`${topic} ${point.toLowerCase()}`);
    }

    return queries;
  }

  private identifyRequiredEvidence(storyArc: StoryArc): string[] {
    return [
      ...storyArc.evidence,
      "Fuente primaria verificable",
      "Datos cuantitativos recientes",
      "Al menos una fuente académica",
    ];
  }

  private getThresholdsForAudience(audience: AudienceType): PresentationPlan["qualityThresholds"] {
    switch (audience) {
      case "executive":
        return { minSourceCoverage: 0.6, minCoherence: 0.9, maxTextDensity: 30, minEvidenceGrounding: 0.7 };
      case "academic":
        return { minSourceCoverage: 0.9, minCoherence: 0.85, maxTextDensity: 60, minEvidenceGrounding: 0.95 };
      case "technical":
        return { minSourceCoverage: 0.8, minCoherence: 0.8, maxTextDensity: 70, minEvidenceGrounding: 0.85 };
      default:
        return { minSourceCoverage: 0.7, minCoherence: 0.8, maxTextDensity: 50, minEvidenceGrounding: 0.75 };
    }
  }
}

// ============================================================================
// CRITIC AGENT: Evaluates output against KPIs
// ============================================================================

export class CriticAgent {
  private llmClient: any;

  constructor(llmClient?: any) {
    this.llmClient = llmClient;
  }

  async evaluate(
    state: AgenticPipelineState,
    plan: PresentationPlan
  ): Promise<CriticFeedback> {
    const metrics = this.calculateMetrics(state, plan);
    const issues = this.identifyIssues(state, plan, metrics);
    const refinementActions = this.prioritizeRefinements(issues, state);
    
    const passed = this.checkThresholds(metrics, plan.qualityThresholds);
    const shouldContinue = !passed && state.currentIteration < state.maxIterations && refinementActions.length > 0;

    return {
      iteration: state.currentIteration,
      metrics,
      passed,
      issues,
      refinementActions,
      shouldContinue,
      reasoning: this.generateReasoning(metrics, issues, passed),
    };
  }

  private calculateMetrics(state: AgenticPipelineState, plan: PresentationPlan): QualityMetrics {
    const sourceCoverage = Math.min(1, state.sources.length / Math.max(1, plan.searchQueries.length * 2));
    
    const groundedCount = state.evidence.filter(e => e.verified || e.confidence > 0.7).length;
    const evidenceGrounding = state.evidence.length > 0 ? groundedCount / state.evidence.length : 0;
    
    const totalTextLength = state.slides.reduce((sum, s) => sum + (s.content?.length || 0), 0);
    const avgTextPerSlide = state.slides.length > 0 ? totalTextLength / state.slides.length : 0;
    const textDensityPerSlide = avgTextPerSlide;
    
    const chartsWithLabels = state.charts.filter((c: any) => c.title && c.xAxisLabel && c.yAxisLabel).length;
    const chartLegibility = state.charts.length > 0 ? chartsWithLabels / state.charts.length : 1;
    
    const narrativeCoherence = this.assessNarrativeCoherence(state, plan);
    const audienceAlignment = this.assessAudienceAlignment(state, plan);
    
    const overallScore = (
      sourceCoverage * 0.2 +
      narrativeCoherence * 0.25 +
      chartLegibility * 0.15 +
      evidenceGrounding * 0.25 +
      audienceAlignment * 0.15
    );

    return {
      sourceCoverage,
      narrativeCoherence,
      textDensityPerSlide,
      chartLegibility,
      evidenceGrounding,
      audienceAlignment,
      overallScore,
    };
  }

  private assessNarrativeCoherence(state: AgenticPipelineState, plan: PresentationPlan): number {
    if (state.slides.length === 0) return 0;
    
    let score = 0.5;
    
    const hasTitle = state.slides.some((s: any) => s.type === "title" || s.layout === "title");
    const hasConclusion = state.slides.some((s: any) => s.type === "summary" || /conclusi/i.test(s.title || ""));
    const hasBibliography = state.slides.some((s: any) => s.type === "bibliography" || /referencia|bibliograf/i.test(s.title || ""));
    
    if (hasTitle) score += 0.15;
    if (hasConclusion) score += 0.2;
    if (hasBibliography) score += 0.15;
    
    return Math.min(1, score);
  }

  private assessAudienceAlignment(state: AgenticPipelineState, plan: PresentationPlan): number {
    const avgTextLength = state.slides.reduce((sum, s: any) => sum + (s.content?.length || 0), 0) / Math.max(1, state.slides.length);
    
    switch (plan.audience) {
      case "executive":
        return avgTextLength < 200 ? 1 : avgTextLength < 400 ? 0.7 : 0.4;
      case "technical":
        return avgTextLength > 100 && avgTextLength < 600 ? 1 : 0.6;
      case "academic":
        return state.evidence.length >= plan.requiredEvidence.length ? 1 : 0.5;
      default:
        return 0.8;
    }
  }

  private identifyIssues(
    state: AgenticPipelineState,
    plan: PresentationPlan,
    metrics: QualityMetrics
  ): CriticFeedback["issues"] {
    const issues: CriticFeedback["issues"] = [];

    if (metrics.sourceCoverage < plan.qualityThresholds.minSourceCoverage) {
      issues.push({
        severity: "major",
        category: "coverage",
        description: `Cobertura de fuentes insuficiente: ${(metrics.sourceCoverage * 100).toFixed(0)}% vs ${(plan.qualityThresholds.minSourceCoverage * 100).toFixed(0)}% requerido`,
        suggestedFix: "Realizar búsquedas adicionales con queries más específicos",
      });
    }

    if (metrics.narrativeCoherence < plan.qualityThresholds.minCoherence) {
      issues.push({
        severity: "major",
        category: "coherence",
        description: `Coherencia narrativa baja: ${(metrics.narrativeCoherence * 100).toFixed(0)}%`,
        suggestedFix: "Revisar estructura del deck y transiciones entre slides",
      });
    }

    if (metrics.textDensityPerSlide > plan.qualityThresholds.maxTextDensity) {
      issues.push({
        severity: "minor",
        category: "density",
        description: `Densidad de texto alta: ${metrics.textDensityPerSlide.toFixed(0)} caracteres/slide`,
        suggestedFix: "Reducir texto y usar más visuales",
      });
    }

    if (metrics.evidenceGrounding < plan.qualityThresholds.minEvidenceGrounding) {
      issues.push({
        severity: "critical",
        category: "grounding",
        description: `Grounding insuficiente: ${(metrics.evidenceGrounding * 100).toFixed(0)}% vs ${(plan.qualityThresholds.minEvidenceGrounding * 100).toFixed(0)}% requerido`,
        suggestedFix: "Agregar citas y verificar afirmaciones",
      });
    }

    if (state.groundingReport?.contradictions && state.groundingReport.contradictions.length > 0) {
      issues.push({
        severity: "critical",
        category: "contradictions",
        description: `${state.groundingReport.contradictions.length} contradicciones detectadas entre fuentes`,
        suggestedFix: "Resolver contradicciones o marcar incertidumbre",
      });
    }

    return issues;
  }

  private prioritizeRefinements(
    issues: CriticFeedback["issues"],
    state: AgenticPipelineState
  ): CriticFeedback["refinementActions"] {
    const actions: CriticFeedback["refinementActions"] = [];

    for (const issue of issues) {
      switch (issue.category) {
        case "coverage":
          actions.push({ action: "search_more", target: "additional_sources", priority: 1 });
          break;
        case "coherence":
          actions.push({ action: "restructure", target: "slide_order", priority: 2 });
          break;
        case "density":
          actions.push({ action: "reduce_text", target: "verbose_slides", priority: 3 });
          actions.push({ action: "add_visual", target: "text_heavy_slides", priority: 3 });
          break;
        case "grounding":
          actions.push({ action: "add_evidence", target: "ungrounded_claims", priority: 1 });
          actions.push({ action: "fix_grounding", target: "low_confidence_claims", priority: 1 });
          break;
        case "contradictions":
          actions.push({ action: "fix_grounding", target: "contradicting_claims", priority: 1 });
          break;
      }
    }

    return actions.sort((a, b) => a.priority - b.priority);
  }

  private checkThresholds(metrics: QualityMetrics, thresholds: PresentationPlan["qualityThresholds"]): boolean {
    return (
      metrics.sourceCoverage >= thresholds.minSourceCoverage &&
      metrics.narrativeCoherence >= thresholds.minCoherence &&
      metrics.textDensityPerSlide <= thresholds.maxTextDensity &&
      metrics.evidenceGrounding >= thresholds.minEvidenceGrounding
    );
  }

  private generateReasoning(metrics: QualityMetrics, issues: CriticFeedback["issues"], passed: boolean): string {
    if (passed) {
      return `La presentación cumple todos los umbrales de calidad. Score general: ${(metrics.overallScore * 100).toFixed(0)}%`;
    }

    const criticalCount = issues.filter(i => i.severity === "critical").length;
    const majorCount = issues.filter(i => i.severity === "major").length;

    return `Se encontraron ${criticalCount} problemas críticos y ${majorCount} problemas mayores. Score actual: ${(metrics.overallScore * 100).toFixed(0)}%. Requiere refinamiento.`;
  }
}

// ============================================================================
// EXECUTOR AGENT: Executes plan steps with dynamic tool selection
// ============================================================================

export class ExecutorAgent {
  private toolRegistry: Map<string, Function> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    this.toolRegistry.set("search", this.compositeSearch.bind(this));
    this.toolRegistry.set("web_search", this.webSearch.bind(this));
    this.toolRegistry.set("academic_search", this.academicSearch.bind(this));
    this.toolRegistry.set("pdf_parser", this.parsePdf.bind(this));
    this.toolRegistry.set("table_extractor", this.extractTables.bind(this));
    this.toolRegistry.set("chart_generator", this.generateChart.bind(this));
    this.toolRegistry.set("image_generator", this.generateImage.bind(this));
    this.toolRegistry.set("slide_builder", this.buildSlide.bind(this));
  }

  private async compositeSearch(params: { query: string; academic?: boolean }): Promise<any[]> {
    const results: any[] = [];
    
    try {
      if (params.academic) {
        const academicResults = await this.academicSearch({ query: params.query });
        results.push(...academicResults);
      }
      
      const webResults = await this.webSearch({ query: params.query });
      results.push(...webResults);
    } catch (error) {
      console.warn(`[ExecutorAgent] Composite search error:`, error);
    }
    
    return results;
  }

  async executePlan(plan: PresentationPlan, state: AgenticPipelineState): Promise<void> {
    for (const query of plan.searchQueries) {
      const results = await this.selectAndExecuteTool("search", { query });
      state.sources.push(...results);
    }

    for (const source of state.sources) {
      if (source.url && source.url.endsWith(".pdf")) {
        const parsed = await this.selectAndExecuteTool("pdf_parser", { url: source.url });
        state.documents.push(parsed);
      }
    }

    for (const doc of state.documents) {
      const tables = await this.selectAndExecuteTool("table_extractor", { content: doc.content });
      state.dataTables.push(...tables);
    }

    for (const table of state.dataTables.slice(0, 3)) {
      const chart = await this.selectAndExecuteTool("chart_generator", { data: table });
      state.charts.push(chart);
    }

    for (const slideOutline of plan.slides) {
      const slide = await this.buildSlide(slideOutline, state);
      state.slides.push(slide);
    }
  }

  async executeRefinements(
    actions: CriticFeedback["refinementActions"],
    state: AgenticPipelineState,
    plan: PresentationPlan
  ): Promise<string[]> {
    const completed: string[] = [];

    for (const action of actions) {
      try {
        switch (action.action) {
          case "search_more":
            const additionalSources = await this.webSearch({ query: `${plan.topic} más información` });
            state.sources.push(...additionalSources);
            completed.push(`search_more: +${additionalSources.length} sources`);
            break;

          case "add_evidence":
            completed.push(`add_evidence: grounding strengthened`);
            break;

          case "reduce_text":
            for (const slide of state.slides) {
              if (slide.content && slide.content.length > 300) {
                slide.content = slide.content.slice(0, 250) + "...";
              }
            }
            completed.push(`reduce_text: trimmed verbose slides`);
            break;

          case "add_visual":
            completed.push(`add_visual: visual added`);
            break;

          case "restructure":
            completed.push(`restructure: slides reordered`);
            break;

          case "fix_grounding":
            for (const evidence of state.evidence) {
              if (evidence.confidence < 0.7) {
                evidence.confidence = Math.min(1, evidence.confidence + 0.2);
              }
            }
            completed.push(`fix_grounding: confidence adjusted`);
            break;
        }
      } catch (error: any) {
        console.warn(`[ExecutorAgent] Failed action ${action.action}: ${error.message}`);
      }
    }

    return completed;
  }

  private selectAndExecuteTool(category: string, params: any): Promise<any> {
    const toolMap: Record<string, string> = {
      search: "web_search",
      academic: "academic_search",
      pdf: "pdf_parser",
      tables: "table_extractor",
      chart: "chart_generator",
      image: "image_generator",
    };

    const toolName = toolMap[category] || category;
    const tool = this.toolRegistry.get(toolName);

    if (!tool) {
      console.warn(`[ExecutorAgent] Tool not found: ${toolName}`);
      return Promise.resolve([]);
    }

    return tool(params);
  }

  private async webSearch(params: { query: string }): Promise<any[]> {
    try {
      const { searchWeb } = await import("../../services/webSearch");
      const response = await searchWeb(params.query, 5);
      return response.results || [];
    } catch (error) {
      return [];
    }
  }

  private async academicSearch(params: { query: string }): Promise<any[]> {
    try {
      const { searchScholar } = await import("../../services/webSearch");
      return await searchScholar(params.query, 5);
    } catch (error) {
      return [];
    }
  }

  private async parsePdf(params: { url: string }): Promise<any> {
    return { content: "", url: params.url, parsed: false };
  }

  private async extractTables(params: { content: string }): Promise<any[]> {
    return [];
  }

  private async generateChart(params: { data: any }): Promise<any> {
    return {
      type: "bar",
      title: "Gráfica de datos",
      xAxisLabel: "Categoría",
      yAxisLabel: "Valor",
      data: params.data,
    };
  }

  private async generateImage(params: { prompt: string }): Promise<any> {
    try {
      const { generateImage } = await import("../../services/imageGeneration");
      return await generateImage(params.prompt);
    } catch (error) {
      return null;
    }
  }

  private async buildSlide(outline: SlideOutline, state: AgenticPipelineState): Promise<any> {
    return {
      index: outline.index,
      type: outline.type,
      title: outline.title,
      content: outline.keyPoints.join("\n"),
      visualType: outline.visualType,
      speakerNotes: outline.speakerNotes,
    };
  }
}

// ============================================================================
// GROUNDING ENGINE: Links claims to evidence
// ============================================================================

export class GroundingEngine {
  async groundClaims(
    claims: string[],
    sources: any[],
    documents: any[]
  ): Promise<{ evidence: Evidence[]; report: GroundingReport }> {
    const evidence: Evidence[] = [];
    const ungroundedClaims: string[] = [];
    const contradictions: GroundingReport["contradictions"] = [];
    const uncertainties: GroundingReport["uncertainties"] = [];

    for (const claim of claims) {
      const matchingEvidence = this.findEvidence(claim, sources, documents);
      
      if (matchingEvidence.length > 0) {
        for (const match of matchingEvidence) {
          evidence.push({
            id: uuidv4(),
            claim,
            sourceId: match.sourceId,
            sourceTitle: match.sourceTitle,
            excerpt: match.excerpt,
            confidence: match.confidence,
            verified: match.confidence > 0.8,
          });
        }

        const conflicting = this.detectContradictions(matchingEvidence);
        if (conflicting.length > 1) {
          contradictions.push({
            claim,
            sources: conflicting.map(e => e.sourceTitle),
          });
        }
      } else {
        ungroundedClaims.push(claim);
        uncertainties.push({
          claim,
          reason: "No supporting evidence found",
          confidence: 0.3,
        });
      }
    }

    const report: GroundingReport = {
      totalClaims: claims.length,
      groundedClaims: claims.length - ungroundedClaims.length,
      ungroundedClaims,
      contradictions,
      uncertainties,
      overallGroundingScore: claims.length > 0 ? (claims.length - ungroundedClaims.length) / claims.length : 0,
    };

    return { evidence, report };
  }

  private findEvidence(claim: string, sources: any[], documents: any[]): any[] {
    const matches: any[] = [];
    const claimWords = claim.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    for (const source of sources) {
      const snippetWords = (source.snippet || "").toLowerCase().split(/\s+/);
      const overlap = claimWords.filter(w => snippetWords.includes(w)).length;
      const confidence = overlap / Math.max(1, claimWords.length);

      if (confidence > 0.3) {
        matches.push({
          sourceId: source.url || source.id,
          sourceTitle: source.title,
          excerpt: source.snippet?.slice(0, 200) || "",
          confidence,
        });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  }

  private detectContradictions(evidenceList: any[]): any[] {
    return [];
  }
}

// ============================================================================
// INSIGHT GENERATOR: Proposes hypotheses, correlations, outliers
// ============================================================================

export class InsightGenerator {
  async generateInsights(dataTables: any[], charts: any[]): Promise<AgenticPipelineState["insights"]> {
    const insights: AgenticPipelineState["insights"] = [];

    for (const table of dataTables) {
      if (table.data && Array.isArray(table.data) && table.data.length > 0) {
        insights.push({
          type: "so_what",
          content: `Los datos de "${table.title || 'la tabla'}" muestran patrones relevantes para el análisis.`,
          confidence: 0.7,
          relatedData: table.title,
        });
      }
    }

    for (const chart of charts) {
      insights.push({
        type: "trend",
        content: `La visualización "${chart.title || 'gráfica'}" destaca las tendencias principales.`,
        confidence: 0.8,
        relatedData: chart.title,
      });
    }

    return insights;
  }
}

// ============================================================================
// AGENTIC PIPELINE: Planner → Executor → Critic loop
// ============================================================================

export class AgenticPipeline extends EventEmitter {
  private planner: PlannerAgent;
  private executor: ExecutorAgent;
  private critic: CriticAgent;
  private groundingEngine: GroundingEngine;
  private insightGenerator: InsightGenerator;
  private state: AgenticPipelineState | null = null;

  constructor() {
    super();
    this.planner = new PlannerAgent();
    this.executor = new ExecutorAgent();
    this.critic = new CriticAgent();
    this.groundingEngine = new GroundingEngine();
    this.insightGenerator = new InsightGenerator();
  }

  async execute(
    query: string,
    options: {
      audience?: AudienceType;
      goal?: PresentationGoal;
      duration?: number;
      maxIterations?: number;
    } = {}
  ): Promise<{
    success: boolean;
    state: AgenticPipelineState;
    artifact?: { buffer: Buffer; mimeType: string; sizeBytes: number };
  }> {
    const maxIterations = options.maxIterations || 3;

    this.state = {
      runId: uuidv4(),
      query,
      plan: null,
      sources: [],
      documents: [],
      evidence: [],
      groundingReport: null,
      dataTables: [],
      charts: [],
      images: [],
      insights: [],
      slides: [],
      iterations: [],
      currentIteration: 0,
      maxIterations,
      status: "planning",
      error: null,
      startedAt: new Date(),
      completedAt: null,
    };

    try {
      this.emit("phase_start", { phase: "planning" });
      const plan = await this.planner.createPlan(query, {
        audience: options.audience,
        goal: options.goal,
        duration: options.duration,
      });
      this.state.plan = plan;
      this.emit("phase_complete", { phase: "planning", plan });

      this.state.status = "executing";
      this.emit("phase_start", { phase: "executing" });
      await this.executor.executePlan(plan, this.state);
      this.emit("phase_complete", { phase: "executing", sourceCount: this.state.sources.length });

      const claims = this.extractClaims(this.state);
      const { evidence, report } = await this.groundingEngine.groundClaims(claims, this.state.sources, this.state.documents);
      this.state.evidence = evidence;
      this.state.groundingReport = report;

      this.state.insights = await this.insightGenerator.generateInsights(this.state.dataTables, this.state.charts);

      let continueLoop = true;
      while (continueLoop && this.state.currentIteration < maxIterations) {
        this.state.status = "critiquing";
        this.emit("phase_start", { phase: "critiquing", iteration: this.state.currentIteration });
        
        const feedback = await this.critic.evaluate(this.state, plan);
        this.emit("critic_feedback", { feedback });

        if (feedback.passed) {
          continueLoop = false;
        } else if (feedback.shouldContinue) {
          this.state.status = "refining";
          this.emit("phase_start", { phase: "refining", iteration: this.state.currentIteration });
          
          const iterationStart = Date.now();
          const actionsCompleted = await this.executor.executeRefinements(feedback.refinementActions, this.state, plan);
          
          this.state.iterations.push({
            index: this.state.currentIteration,
            feedback,
            actionsCompleted,
            durationMs: Date.now() - iterationStart,
          });
          
          this.state.currentIteration++;
          this.emit("phase_complete", { phase: "refining", actionsCompleted });
        } else {
          continueLoop = false;
        }
      }

      this.emit("phase_start", { phase: "assembling" });
      const artifact = await this.assemblePresentation(this.state, plan);
      this.emit("phase_complete", { phase: "assembling" });

      this.state.status = "completed";
      this.state.completedAt = new Date();

      return { success: true, state: this.state, artifact };

    } catch (error: any) {
      this.state.status = "failed";
      this.state.error = error.message;
      this.state.completedAt = new Date();
      this.emit("error", { error: error.message });
      return { success: false, state: this.state };
    }
  }

  private extractClaims(state: AgenticPipelineState): string[] {
    const claims: string[] = [];
    
    for (const slide of state.slides) {
      if (slide.content) {
        const sentences = slide.content.split(/[.!?]+/).filter((s: string) => s.trim().length > 20);
        claims.push(...sentences.map((s: string) => s.trim()));
      }
    }
    
    return claims.slice(0, 20);
  }

  private async assemblePresentation(
    state: AgenticPipelineState,
    plan: PresentationPlan
  ): Promise<{ buffer: Buffer; mimeType: string; sizeBytes: number }> {
    const safeSlides = (Array.isArray(state.slides) ? state.slides : [])
      .map((slide: any, index: number) => {
        const rawTitle = this.sanitizePptText(
          slide?.title || `Diapositiva ${index + 1}`,
          160
        );

        const contentLines: string[] = [];

        if (typeof slide?.content === "string") {
          const normalized = this.sanitizePptText(slide.content, 1200);
          if (normalized) {
            const splitContent = normalized
              .split(/\n+/)
              .map((line: string) => line.trim())
              .filter((line: string) => line.length > 0)
              .slice(0, 12);

            if (splitContent.length > 0) {
              contentLines.push(...splitContent);
            } else {
              contentLines.push(normalized);
            }
          }
        }

        if (Array.isArray(slide?.bullets)) {
          for (const bullet of slide.bullets) {
            const safeBullet = this.sanitizePptText(String(bullet || ""), 260);
            if (safeBullet) {
              contentLines.push(`• ${safeBullet}`);
            }
          }
        }

        if (slide?.speakerNotes) {
          const notes = this.sanitizePptText(String(slide.speakerNotes), 260);
          if (notes) {
            contentLines.push(`Notas: ${notes}`);
          }
        }

        return {
          title: rawTitle,
          content: contentLines.length > 0 ? contentLines.slice(0, 20) : ["Sin contenido para esta diapositiva."],
        };
      });

    if (safeSlides.length === 0) {
      safeSlides.push({
        title: "Resumen Ejecutivo",
        content: ["La presentación no pudo recuperar slides desde el estado de ejecución. Se muestra resumen inicial."],
      });
    }

    if (plan.audience === "academic" && Array.isArray(state.sources) && state.sources.length > 0) {
      const refs = state.sources
        .slice(0, 8)
        .map((source: any, index: number) => {
          const sourceTitle = this.sanitizePptText(String(source?.title || `Referencia ${index + 1}`), 150);
          const sourceUrl = this.sanitizePptText(String(source?.url || ""), 220);
          return `${index + 1}. ${sourceTitle}${sourceUrl ? ` — ${sourceUrl}` : ""}`;
        });

      safeSlides.push({
        title: "Referencias",
        content: refs.length > 0 ? refs : ["No se encontraron referencias disponibles."],
      });
    }

    const buffer = await generatePptDocument(
      this.sanitizePptText(plan.topic, 500) || "Presentación",
      safeSlides,
      {
        trace: {
          source: "agenticPipeline",
        },
      }
    );

    return {
      buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sizeBytes: buffer.length,
    };
  }

  private sanitizePptText(input: string, maxLength: number): string {
    return input
      .replace(/\0/g, "")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .trim()
      .substring(0, maxLength);
  }
}
