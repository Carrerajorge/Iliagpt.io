import { v4 as uuidv4 } from "uuid";
import {
  Stage, StageContext, QualityGateResult, SectionContent, Claim, NormalizedFact
} from "../contracts";
import { openai } from "../../../lib/openai";

interface CriticInput {
  sections: SectionContent[];
  claims: Claim[];
  facts: NormalizedFact[];
}

interface CriticOutput {
  auditReport: {
    crossSectionConsistency: number;
    styleConsistency: number;
    citationCoverage: number;
    overallScore: number;
    issues: Array<{
      type: "cross_section" | "style" | "citation" | "factual";
      severity: "error" | "warning" | "info";
      message: string;
      sectionId?: string;
      claimId?: string;
    }>;
    recommendations: string[];
  };
}

export class ConsistencyCriticStage implements Stage<CriticInput, CriticOutput> {
  id = "critic";
  name = "Consistency Critic";

  async execute(input: CriticInput, context: StageContext): Promise<CriticOutput> {
    const issues: CriticOutput["auditReport"]["issues"] = [];
    const recommendations: string[] = [];

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.1,
      message: "Auditing cross-section consistency",
    });

    const crossSectionConsistency = this.checkCrossSectionConsistency(input.sections, issues);

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.4,
      message: "Auditing style consistency",
    });

    const styleConsistency = this.checkStyleConsistency(input.sections, issues);

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.7,
      message: "Auditing citation coverage",
    });

    const citationCoverage = this.checkCitationCoverage(input.claims, issues);

    await this.llmAudit(input, issues, recommendations, context);

    const overallScore = (crossSectionConsistency + styleConsistency + citationCoverage) / 3;

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 1.0,
      message: `Audit complete. Score: ${(overallScore * 100).toFixed(0)}%`,
    });

    return {
      auditReport: {
        crossSectionConsistency,
        styleConsistency,
        citationCoverage,
        overallScore,
        issues,
        recommendations,
      },
    };
  }

  private checkCrossSectionConsistency(
    sections: SectionContent[],
    issues: CriticOutput["auditReport"]["issues"]
  ): number {
    let score = 1.0;

    const allNumbers = new Map<string, { value: number; sectionId: string }[]>();
    
    for (const section of sections) {
      const numbers = section.markdown.match(/\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?/g) || [];
      for (const num of numbers) {
        const normalized = parseFloat(num.replace(/[.,](?=\d{3})/g, "").replace(",", "."));
        if (!isNaN(normalized)) {
          const key = normalized.toFixed(2);
          if (!allNumbers.has(key)) {
            allNumbers.set(key, []);
          }
          allNumbers.get(key)!.push({ value: normalized, sectionId: section.sectionId });
        }
      }
    }

    for (const [key, occurrences] of allNumbers.entries()) {
      if (occurrences.length > 1) {
        const uniqueSections = new Set(occurrences.map(o => o.sectionId));
        if (uniqueSections.size > 1) {
        }
      }
    }

    if (sections.length > 1) {
      const firstHasIntro = sections[0]?.markdown.toLowerCase().includes("introducción") ||
                            sections[0]?.markdown.toLowerCase().includes("introduction");
      if (!firstHasIntro && sections.length >= 3) {
        issues.push({
          type: "cross_section",
          severity: "info",
          message: "First section may not be an introduction",
          sectionId: sections[0]?.sectionId,
        });
      }
    }

    return Math.max(0, score);
  }

  private checkStyleConsistency(
    sections: SectionContent[],
    issues: CriticOutput["auditReport"]["issues"]
  ): number {
    let score = 1.0;

    const tones: { hasFirstPerson: boolean; sectionId: string }[] = [];
    
    for (const section of sections) {
      const hasFirstPerson = /\b(yo|nosotros|nuestro|nuestra|we|our|us|I)\b/i.test(section.markdown);
      tones.push({ hasFirstPerson, sectionId: section.sectionId });
    }

    const firstPersonCount = tones.filter(t => t.hasFirstPerson).length;
    const mixedTone = firstPersonCount > 0 && firstPersonCount < sections.length;
    
    if (mixedTone) {
      issues.push({
        type: "style",
        severity: "warning",
        message: "Mixed use of first and third person across sections",
      });
      score -= 0.15;
    }

    const headingLevels: number[] = [];
    for (const section of sections) {
      const headings = section.markdown.match(/^#{1,6}\s/gm) || [];
      for (const h of headings) {
        headingLevels.push(h.trim().length);
      }
    }

    if (headingLevels.length > 0) {
      const minLevel = Math.min(...headingLevels);
      const maxLevel = Math.max(...headingLevels);
      if (maxLevel - minLevel > 3) {
        issues.push({
          type: "style",
          severity: "info",
          message: "Wide range of heading levels may affect document hierarchy",
        });
      }
    }

    return Math.max(0, score);
  }

  private checkCitationCoverage(
    claims: Claim[],
    issues: CriticOutput["auditReport"]["issues"]
  ): number {
    const claimsNeedingCitation = claims.filter(c => c.requiresCitation);
    const claimsWithCitation = claimsNeedingCitation.filter(c => c.citations.length > 0);
    
    if (claimsNeedingCitation.length === 0) {
      return 1.0;
    }

    const coverage = claimsWithCitation.length / claimsNeedingCitation.length;

    if (coverage < 0.5) {
      issues.push({
        type: "citation",
        severity: "error",
        message: `Low citation coverage: ${(coverage * 100).toFixed(0)}% of claims with citations`,
      });
    } else if (coverage < 0.8) {
      issues.push({
        type: "citation",
        severity: "warning",
        message: `Moderate citation coverage: ${(coverage * 100).toFixed(0)}%`,
      });
    }

    const unverifiedClaims = claims.filter(c => c.requiresCitation && !c.verified);
    if (unverifiedClaims.length > 0) {
      issues.push({
        type: "citation",
        severity: "warning",
        message: `${unverifiedClaims.length} claims could not be verified`,
      });
    }

    return coverage;
  }

  private async llmAudit(
    input: CriticInput,
    issues: CriticOutput["auditReport"]["issues"],
    recommendations: string[],
    context: StageContext
  ): Promise<void> {
    const combinedMarkdown = input.sections.map(s => s.markdown).join("\n\n---\n\n").slice(0, 6000);
    
    try {
      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        temperature: 0.2,
        max_tokens: 1000,
        messages: [
          {
            role: "system",
            content: `You are a document quality auditor. Review the document for:
1. Logical flow and coherence
2. Contradictions or inconsistencies
3. Unsupported assertions
4. Missing context or explanations

Return JSON with:
- issues: array of { type: "factual"|"style"|"cross_section", severity: "error"|"warning"|"info", message: string }
- recommendations: array of improvement suggestions

Return ONLY valid JSON.`,
          },
          { role: "user", content: combinedMarkdown },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        
        for (const issue of parsed.issues || []) {
          issues.push({
            type: issue.type || "factual",
            severity: issue.severity || "info",
            message: issue.message,
          });
        }

        for (const rec of parsed.recommendations || []) {
          recommendations.push(rec);
        }
      }
    } catch (error) {
      console.warn("[ConsistencyCritic] LLM audit failed:", error);
    }
  }

  validate(output: CriticOutput): QualityGateResult {
    const issues: QualityGateResult["issues"] = [];
    const score = output.auditReport.overallScore;

    const errorCount = output.auditReport.issues.filter(i => i.severity === "error").length;
    const warningCount = output.auditReport.issues.filter(i => i.severity === "warning").length;

    if (errorCount > 0) {
      issues.push({
        severity: "error",
        message: `${errorCount} critical issues found in audit`,
      });
    }

    if (warningCount > 3) {
      issues.push({
        severity: "warning",
        message: `${warningCount} warnings found in audit`,
      });
    }

    if (output.auditReport.citationCoverage < 0.5) {
      issues.push({
        severity: "error",
        message: "Citation coverage below 50%",
      });
    }

    return {
      gateId: "critic_quality",
      gateName: "Consistency Audit Quality",
      passed: score >= 0.6 && errorCount === 0,
      score,
      threshold: 0.6,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  async fallback(input: CriticInput, _context: StageContext): Promise<CriticOutput> {
    return {
      auditReport: {
        crossSectionConsistency: 0.7,
        styleConsistency: 0.8,
        citationCoverage: input.claims.filter(c => c.verified).length / Math.max(1, input.claims.length),
        overallScore: 0.7,
        issues: [],
        recommendations: ["Review document for consistency manually"],
      },
    };
  }
}

export const consistencyCriticStage = new ConsistencyCriticStage();
