import { v4 as uuidv4 } from "uuid";
import {
  Stage, StageContext, QualityGateResult, DocumentPlan, DocumentPlanSchema,
  SectionSpec, SectionSpecSchema, SectionTypeSchema, AudienceType, DocumentGoal,
  SupportedLocale
} from "../contracts";
import { openai } from "../../../lib/openai";

interface PlannerInput {
  query: string;
  locale: SupportedLocale;
}

interface PlannerOutput {
  plan: DocumentPlan;
}

const SECTION_TEMPLATES: Record<DocumentGoal, SectionTypeSchema["_type"][]> = {
  analyze: ["executive_summary", "introduction", "methodology", "analysis", "results", "conclusions", "recommendations"],
  report: ["executive_summary", "introduction", "analysis", "results", "conclusions"],
  recommend: ["executive_summary", "introduction", "analysis", "recommendations", "conclusions"],
  audit: ["executive_summary", "introduction", "methodology", "analysis", "results", "recommendations", "appendix"],
  forecast: ["executive_summary", "introduction", "methodology", "analysis", "results", "conclusions"],
  compare: ["executive_summary", "introduction", "methodology", "analysis", "discussion", "conclusions"],
  explain: ["introduction", "analysis", "discussion", "conclusions"],
  summarize: ["executive_summary", "analysis", "conclusions"],
};

const AUDIENCE_STYLES: Record<AudienceType, { tone: "formal" | "technical" | "conversational" | "academic"; detailLevel: "brief" | "standard" | "detailed" | "comprehensive" }> = {
  executive: { tone: "formal", detailLevel: "brief" },
  technical: { tone: "technical", detailLevel: "detailed" },
  academic: { tone: "academic", detailLevel: "comprehensive" },
  operational: { tone: "formal", detailLevel: "standard" },
  general: { tone: "conversational", detailLevel: "standard" },
};

export class DocumentPlannerStage implements Stage<PlannerInput, PlannerOutput> {
  id = "planner";
  name = "Document Planner";

  async execute(input: PlannerInput, context: StageContext): Promise<PlannerOutput> {
    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.1,
      message: "Analyzing query intent",
    });

    const { audience, goal, title, estimatedWordCount } = await this.analyzeQueryWithLLM(input.query, input.locale);

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.5,
      message: `Creating ${goal} document for ${audience} audience`,
    });

    const sectionTypes = SECTION_TEMPLATES[goal] || SECTION_TEMPLATES.report;
    const style = AUDIENCE_STYLES[audience] || AUDIENCE_STYLES.general;

    const sections: SectionSpec[] = sectionTypes.map((type, index) => 
      SectionSpecSchema.parse({
        id: uuidv4(),
        title: this.getSectionTitle(type, input.locale),
        type,
        level: type === "appendix" ? 2 : 1,
        goals: this.getSectionGoals(type, input.query),
        audience,
        style: {
          ...style,
          includeCitations: type !== "executive_summary" && type !== "table_of_contents",
          maxWords: this.getMaxWordsForSection(type, estimatedWordCount / sectionTypes.length),
        },
        order: index,
      })
    );

    const plan = DocumentPlanSchema.parse({
      id: uuidv4(),
      title,
      subtitle: this.generateSubtitle(goal, input.locale),
      authors: ["IliaGPT"],
      date: new Date().toLocaleDateString(input.locale === "es" ? "es-ES" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      locale: input.locale,
      audience,
      goal,
      sections,
      style: {
        fontFamily: "Calibri",
        fontSize: 11,
        lineSpacing: 1.15,
      },
      estimatedWordCount,
    });

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 1.0,
      message: `Plan created with ${sections.length} sections`,
    });

    return { plan };
  }

  validate(output: PlannerOutput): QualityGateResult {
    const issues: QualityGateResult["issues"] = [];
    let score = 1.0;

    if (!output.plan?.title) {
      issues.push({ severity: "error", message: "Missing document title" });
      score -= 0.3;
    }

    if (!output.plan?.sections || output.plan.sections.length === 0) {
      issues.push({ severity: "error", message: "No sections in plan" });
      score -= 0.4;
    }

    if (output.plan?.sections && output.plan.sections.length < 3) {
      issues.push({ severity: "warning", message: "Document has less than 3 sections" });
      score -= 0.1;
    }

    const hasIntro = output.plan?.sections.some(s => s.type === "introduction" || s.type === "executive_summary");
    const hasConclusion = output.plan?.sections.some(s => s.type === "conclusions" || s.type === "recommendations");
    
    if (!hasIntro) {
      issues.push({ severity: "warning", message: "Missing introduction section" });
      score -= 0.1;
    }
    
    if (!hasConclusion) {
      issues.push({ severity: "warning", message: "Missing conclusion section" });
      score -= 0.1;
    }

    return {
      gateId: "planner_quality",
      gateName: "Document Plan Quality",
      passed: score >= 0.7,
      score: Math.max(0, score),
      threshold: 0.7,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  async fallback(input: PlannerInput, _context: StageContext): Promise<PlannerOutput> {
    const sections: SectionSpec[] = [
      { id: uuidv4(), title: "Resumen Ejecutivo", type: "executive_summary", level: 1, goals: ["Summarize key points"], audience: "general", style: { tone: "formal", detailLevel: "brief", includeCitations: false }, order: 0 },
      { id: uuidv4(), title: "Introducción", type: "introduction", level: 1, goals: ["Introduce topic"], audience: "general", style: { tone: "formal", detailLevel: "standard", includeCitations: true }, order: 1 },
      { id: uuidv4(), title: "Análisis", type: "analysis", level: 1, goals: ["Analyze main points"], audience: "general", style: { tone: "formal", detailLevel: "detailed", includeCitations: true }, order: 2 },
      { id: uuidv4(), title: "Conclusiones", type: "conclusions", level: 1, goals: ["Summarize findings"], audience: "general", style: { tone: "formal", detailLevel: "standard", includeCitations: true }, order: 3 },
    ];

    return {
      plan: DocumentPlanSchema.parse({
        id: uuidv4(),
        title: input.query.slice(0, 100),
        authors: ["IliaGPT"],
        date: new Date().toISOString().split("T")[0],
        locale: input.locale,
        audience: "general",
        goal: "report",
        sections,
        style: { fontFamily: "Calibri", fontSize: 11, lineSpacing: 1.15 },
        estimatedWordCount: 2000,
      }),
    };
  }

  private async analyzeQueryWithLLM(query: string, locale: SupportedLocale): Promise<{
    audience: AudienceType;
    goal: DocumentGoal;
    title: string;
    estimatedWordCount: number;
  }> {
    try {
      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content: `You are a document planning assistant. Analyze the user query and return JSON with:
- audience: one of "executive", "technical", "academic", "operational", "general"
- goal: one of "analyze", "report", "recommend", "audit", "forecast", "compare", "explain", "summarize"
- title: a professional document title in ${locale === "es" ? "Spanish" : "the query language"}
- estimatedWordCount: estimated word count (1000-10000)

Return ONLY valid JSON.`,
          },
          { role: "user", content: query },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        return {
          audience: parsed.audience || "general",
          goal: parsed.goal || "report",
          title: parsed.title || query.slice(0, 100),
          estimatedWordCount: parsed.estimatedWordCount || 2000,
        };
      }
    } catch (error) {
      console.warn("[DocumentPlanner] LLM analysis failed, using defaults");
    }

    return {
      audience: "general",
      goal: "report",
      title: query.slice(0, 100),
      estimatedWordCount: 2000,
    };
  }

  private getSectionTitle(type: string, locale: SupportedLocale): string {
    const titles: Record<string, Record<string, string>> = {
      executive_summary: { es: "Resumen Ejecutivo", en: "Executive Summary" },
      introduction: { es: "Introducción", en: "Introduction" },
      methodology: { es: "Metodología", en: "Methodology" },
      analysis: { es: "Análisis", en: "Analysis" },
      results: { es: "Resultados", en: "Results" },
      discussion: { es: "Discusión", en: "Discussion" },
      conclusions: { es: "Conclusiones", en: "Conclusions" },
      recommendations: { es: "Recomendaciones", en: "Recommendations" },
      appendix: { es: "Anexos", en: "Appendix" },
      bibliography: { es: "Referencias", en: "References" },
      glossary: { es: "Glosario", en: "Glossary" },
    };
    return titles[type]?.[locale] || titles[type]?.["en"] || type;
  }

  private getSectionGoals(type: string, query: string): string[] {
    const baseGoals: Record<string, string[]> = {
      executive_summary: ["Provide high-level overview", "Highlight key findings"],
      introduction: ["Set context", "Define scope", "State objectives"],
      methodology: ["Describe approach", "Explain data sources"],
      analysis: ["Present detailed analysis", "Support with evidence"],
      results: ["Present findings", "Include data visualizations"],
      discussion: ["Interpret results", "Compare with existing knowledge"],
      conclusions: ["Summarize key findings", "Address objectives"],
      recommendations: ["Provide actionable steps", "Prioritize actions"],
    };
    return baseGoals[type] || [`Address: ${query.slice(0, 50)}`];
  }

  private getMaxWordsForSection(type: string, avgWords: number): number {
    const multipliers: Record<string, number> = {
      executive_summary: 0.5,
      introduction: 0.8,
      methodology: 0.7,
      analysis: 1.5,
      results: 1.3,
      discussion: 1.2,
      conclusions: 0.6,
      recommendations: 0.8,
    };
    return Math.round(avgWords * (multipliers[type] || 1.0));
  }

  private generateSubtitle(goal: DocumentGoal, locale: SupportedLocale): string {
    const subtitles: Record<DocumentGoal, Record<string, string>> = {
      analyze: { es: "Documento de Análisis", en: "Analysis Document" },
      report: { es: "Informe", en: "Report" },
      recommend: { es: "Documento de Recomendaciones", en: "Recommendations Document" },
      audit: { es: "Informe de Auditoría", en: "Audit Report" },
      forecast: { es: "Pronóstico", en: "Forecast" },
      compare: { es: "Análisis Comparativo", en: "Comparative Analysis" },
      explain: { es: "Documento Explicativo", en: "Explanatory Document" },
      summarize: { es: "Resumen", en: "Summary" },
    };
    return subtitles[goal]?.[locale] || subtitles[goal]?.["en"] || "";
  }
}

export const documentPlannerStage = new DocumentPlannerStage();
