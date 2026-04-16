import { v4 as uuidv4 } from "uuid";
import {
  Stage, StageContext, QualityGateResult, DocumentPlan,
  NormalizedFact, EvidenceChunk, SectionContent, SectionContentSchema,
  SectionSpec, Claim, ClaimSchema
} from "../contracts";
import { openai } from "../../../lib/openai";

interface WriterInput {
  plan: DocumentPlan | undefined;
  facts: NormalizedFact[];
  evidence: EvidenceChunk[];
}

interface WriterOutput {
  sections: SectionContent[];
}

export class SectionWriterStage implements Stage<WriterInput, WriterOutput> {
  id = "writer";
  name = "Section Writer";

  async execute(input: WriterInput, context: StageContext): Promise<WriterOutput> {
    if (!input.plan) {
      return { sections: [] };
    }

    const sections: SectionContent[] = [];
    const totalSections = input.plan.sections.length;

    for (let i = 0; i < input.plan.sections.length; i++) {
      const sectionSpec = input.plan.sections[i];
      
      context.emitEvent({
        eventType: "stage.progress",
        stageId: this.id,
        stageName: this.name,
        progress: (i + 1) / totalSections,
        message: `Writing section: ${sectionSpec.title}`,
      });

      const sectionContent = await this.writeSection(sectionSpec, input, context);
      sections.push(sectionContent);
    }

    return { sections };
  }

  private async writeSection(
    spec: SectionSpec,
    input: WriterInput,
    context: StageContext
  ): Promise<SectionContent> {
    const relevantFacts = input.facts.slice(0, 10);
    const relevantEvidence = input.evidence.slice(0, 5);

    const factsContext = relevantFacts.map(f => 
      `- ${f.key}: ${f.value}${f.unit ? ` ${f.unit}` : ""}`
    ).join("\n");

    const evidenceContext = relevantEvidence.map(e => 
      `"${e.text.slice(0, 200)}..."`
    ).join("\n\n");

    const toneInstructions = {
      formal: "Use formal, professional language. Avoid colloquialisms.",
      technical: "Use technical terminology appropriate for experts. Include precise definitions.",
      conversational: "Use clear, accessible language. Explain complex concepts simply.",
      academic: "Use academic style with proper citations. Be precise and objective.",
    };

    const detailInstructions = {
      brief: "Keep content concise. Maximum 200 words.",
      standard: "Provide adequate detail. Target 300-500 words.",
      detailed: "Include comprehensive detail. Target 500-800 words.",
      comprehensive: "Cover all aspects thoroughly. Target 800-1200 words.",
    };

    try {
      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        temperature: 0.4,
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content: `You are a professional document writer. Write a section for a ${input.plan?.goal} document.

SECTION: ${spec.title}
TYPE: ${spec.type}
AUDIENCE: ${spec.audience}
GOALS: ${spec.goals.join(", ")}

STYLE REQUIREMENTS:
- Tone: ${toneInstructions[spec.style.tone]}
- Detail: ${detailInstructions[spec.style.detailLevel]}
- ${spec.style.includeCitations ? "Include citations in [1], [2] format where appropriate." : "No citations needed."}
- ${spec.style.useFirstPerson ? "Use first person (we/our)." : "Use third person."}

Write in ${context.locale === "es" ? "Spanish" : "the document language"}.
Return ONLY the section content in Markdown format.`,
          },
          {
            role: "user",
            content: `Available facts:\n${factsContext}\n\nEvidence:\n${evidenceContext}\n\nWrite the "${spec.title}" section.`,
          },
        ],
      });

      const markdown = response.choices[0]?.message?.content || "";
      const wordCount = markdown.split(/\s+/).length;

      const claims = this.extractClaimsFromMarkdown(markdown, spec.id);

      return SectionContentSchema.parse({
        sectionId: spec.id,
        markdown,
        claims,
        wordCount,
        generatedAt: new Date().toISOString(),
      });

    } catch (error) {
      console.warn(`[SectionWriter] Failed to write section ${spec.title}:`, error);
      
      return this.generateFallbackSection(spec, input, context);
    }
  }

  private extractClaimsFromMarkdown(markdown: string, sectionId: string): Claim[] {
    const claims: Claim[] = [];
    const sentences = markdown.split(/[.!?]+/).filter(s => s.trim().length > 20);

    for (const sentence of sentences.slice(0, 10)) {
      const trimmed = sentence.trim();
      
      const hasNumber = /\d+/.test(trimmed);
      const hasStatisticalWord = /según|according|study|research|data|analysis|percent|million|billion/i.test(trimmed);
      const requiresCitation = hasNumber || hasStatisticalWord;

      if (requiresCitation || trimmed.length > 50) {
        claims.push(ClaimSchema.parse({
          id: uuidv4(),
          text: trimmed,
          sectionId,
          requiresCitation,
          citations: [],
          factIds: [],
          verified: false,
        }));
      }
    }

    return claims;
  }

  private generateFallbackSection(
    spec: SectionSpec,
    input: WriterInput,
    context: StageContext
  ): SectionContent {
    const fallbackContent: Record<string, Record<string, string>> = {
      executive_summary: {
        es: "Este documento presenta un análisis detallado del tema solicitado. Los hallazgos principales se resumen a continuación.",
        en: "This document presents a detailed analysis of the requested topic. The main findings are summarized below.",
      },
      introduction: {
        es: "El presente documento tiene como objetivo analizar y presentar información relevante sobre el tema en cuestión.",
        en: "This document aims to analyze and present relevant information about the topic in question.",
      },
      conclusions: {
        es: "En conclusión, el análisis presentado proporciona una visión integral del tema estudiado.",
        en: "In conclusion, the analysis presented provides a comprehensive view of the topic studied.",
      },
    };

    const locale = context.locale === "es" ? "es" : "en";
    const content = fallbackContent[spec.type]?.[locale] || 
      `## ${spec.title}\n\n${spec.goals.join(". ")}.`;

    return SectionContentSchema.parse({
      sectionId: spec.id,
      markdown: `## ${spec.title}\n\n${content}`,
      claims: [],
      wordCount: content.split(/\s+/).length,
      generatedAt: new Date().toISOString(),
    });
  }

  validate(output: WriterOutput): QualityGateResult {
    const issues: QualityGateResult["issues"] = [];
    let score = 1.0;

    if (output.sections.length === 0) {
      issues.push({ severity: "error", message: "No sections generated" });
      score -= 0.5;
    }

    const emptySections = output.sections.filter(s => s.wordCount < 50);
    if (emptySections.length > 0) {
      issues.push({ severity: "warning", message: `${emptySections.length} sections have less than 50 words` });
      score -= 0.1 * emptySections.length;
    }

    const totalWords = output.sections.reduce((sum, s) => sum + s.wordCount, 0);
    if (totalWords < 500) {
      issues.push({ severity: "warning", message: "Total document word count is low" });
      score -= 0.2;
    }

    return {
      gateId: "writer_quality",
      gateName: "Section Writer Quality",
      passed: score >= 0.6,
      score: Math.max(0, score),
      threshold: 0.6,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  async fallback(input: WriterInput, context: StageContext): Promise<WriterOutput> {
    if (!input.plan) return { sections: [] };

    return {
      sections: input.plan.sections.map(spec => 
        this.generateFallbackSection(spec, input, context)
      ),
    };
  }
}

export const sectionWriterStage = new SectionWriterStage();
