import { z } from "zod";
import { randomUUID } from "crypto";
import { Artifact, ArtifactSchema } from "../contracts";
import { eventLogger, logRunEvent } from "../eventLogger";
import { openai } from "../../lib/openai";
import { Citation, CitationSchema, StepResult, StepResultSchema } from "./executorAgent";

export const RunResultPackageSchema = z.object({
  runId: z.string().uuid(),
  correlationId: z.string(),
  objective: z.string(),
  stepResults: z.array(StepResultSchema),
  artifacts: z.array(ArtifactSchema),
  citations: z.array(CitationSchema),
  summary: z.string().optional(),
  claims: z.array(z.object({
    id: z.string().uuid(),
    text: z.string(),
    sourceStepIndex: z.number().int().nonnegative().optional(),
    supportingCitationIds: z.array(z.string().uuid()).optional(),
  })).optional(),
});
export type RunResultPackage = z.infer<typeof RunResultPackageSchema>;

export const VerificationIssueSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "unsupported_claim",
    "missing_citation",
    "invalid_artifact",
    "incomplete_coverage",
    "conflicting_sources",
    "stale_data",
    "low_confidence",
  ]),
  severity: z.enum(["error", "warning", "info"]),
  description: z.string(),
  affectedClaimId: z.string().uuid().optional(),
  affectedArtifactId: z.string().uuid().optional(),
  affectedStepIndex: z.number().int().nonnegative().optional(),
  suggestedAction: z.string().optional(),
});
export type VerificationIssue = z.infer<typeof VerificationIssueSchema>;

export const VerificationResultSchema = z.object({
  runId: z.string().uuid(),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  citationCoverage: z.number().min(0).max(1),
  artifactIntegrity: z.number().min(0).max(1),
  issues: z.array(VerificationIssueSchema),
  gapsRequiringResearch: z.array(z.object({
    topic: z.string(),
    reason: z.string(),
    priority: z.enum(["high", "medium", "low"]),
  })),
  verifiedAt: z.date(),
  durationMs: z.number().int().nonnegative(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const VerifierConfigSchema = z.object({
  model: z.string().default("grok-3-fast"),
  minCitationCoverage: z.number().min(0).max(1).default(0.7),
  minArtifactIntegrity: z.number().min(0).max(1).default(0.9),
  minConfidenceThreshold: z.number().min(0).max(1).default(0.5),
  requireAllClaims: z.boolean().default(false),
  useLLMVerification: z.boolean().default(true),
});
export type VerifierConfig = z.infer<typeof VerifierConfigSchema>;

export class VerifierAgent {
  private config: VerifierConfig;

  constructor(config: Partial<VerifierConfig> = {}) {
    this.config = VerifierConfigSchema.parse(config);
  }

  async verify(result: RunResultPackage): Promise<VerificationResult> {
    const startTime = Date.now();
    const validatedResult = RunResultPackageSchema.parse(result);

    await logRunEvent(
      validatedResult.runId,
      validatedResult.correlationId,
      "run_started",
      { phase: "verification", objective: validatedResult.objective }
    );

    const issues: VerificationIssue[] = [];
    const gapsRequiringResearch: VerificationResult["gapsRequiringResearch"] = [];

    const citationCoverage = this.checkCitationCoverage(validatedResult, issues);
    const artifactIntegrity = this.validateArtifactIntegrity(validatedResult, issues);

    this.identifyGaps(validatedResult, issues, gapsRequiringResearch);

    if (this.config.useLLMVerification && validatedResult.summary) {
      await this.llmVerifyClaims(validatedResult, issues, gapsRequiringResearch);
    }

    this.checkLowConfidenceCitations(validatedResult, issues);

    const score = this.calculateOverallScore(citationCoverage, artifactIntegrity, issues);

    const passed = this.determinePassFail(score, citationCoverage, artifactIntegrity, issues);

    const verificationResult: VerificationResult = {
      runId: validatedResult.runId,
      passed,
      score,
      citationCoverage,
      artifactIntegrity,
      issues,
      gapsRequiringResearch,
      verifiedAt: new Date(),
      durationMs: Date.now() - startTime,
    };

    await logRunEvent(
      validatedResult.runId,
      validatedResult.correlationId,
      passed ? "run_completed" : "run_failed",
      {
        phase: "verification",
        passed,
        score,
        issueCount: issues.length,
        gapCount: gapsRequiringResearch.length,
      },
      { durationMs: verificationResult.durationMs }
    );

    return verificationResult;
  }

  private checkCitationCoverage(
    result: RunResultPackage,
    issues: VerificationIssue[]
  ): number {
    const claims = result.claims || [];
    if (claims.length === 0) {
      return 1;
    }

    let supportedClaims = 0;
    const citationIds = new Set(result.citations.map((c) => c.id));

    for (const claim of claims) {
      const supportingIds = claim.supportingCitationIds || [];
      const validSupport = supportingIds.filter((id) => citationIds.has(id));

      if (validSupport.length > 0) {
        supportedClaims++;
      } else {
        issues.push({
          id: randomUUID(),
          type: "unsupported_claim",
          severity: "warning",
          description: `Claim lacks supporting citations: "${claim.text.slice(0, 100)}..."`,
          affectedClaimId: claim.id,
          suggestedAction: "Add citations or re-research this topic",
        });
      }
    }

    return claims.length > 0 ? supportedClaims / claims.length : 1;
  }

  private validateArtifactIntegrity(
    result: RunResultPackage,
    issues: VerificationIssue[]
  ): number {
    const artifacts = result.artifacts || [];
    if (artifacts.length === 0) {
      return 1;
    }

    let validArtifacts = 0;

    for (const artifact of artifacts) {
      const integrityIssues = this.checkArtifact(artifact);

      if (integrityIssues.length === 0) {
        validArtifacts++;
      } else {
        for (const issue of integrityIssues) {
          issues.push({
            id: randomUUID(),
            type: "invalid_artifact",
            severity: "error",
            description: issue,
            affectedArtifactId: artifact.id,
            suggestedAction: "Regenerate or repair the artifact",
          });
        }
      }
    }

    return artifacts.length > 0 ? validArtifacts / artifacts.length : 1;
  }

  private checkArtifact(artifact: Artifact): string[] {
    const issues: string[] = [];

    if (!artifact.id) {
      issues.push("Artifact missing ID");
    }

    if (!artifact.name || artifact.name.trim() === "") {
      issues.push("Artifact missing name");
    }

    if (!artifact.type) {
      issues.push("Artifact missing type");
    }

    if (artifact.type === "file" && !artifact.url && !artifact.data) {
      issues.push("File artifact has no URL or data");
    }

    if (artifact.type === "image" && artifact.data) {
      const imageData = artifact.data as any;
      if (!imageData.width || !imageData.height || imageData.width <= 0 || imageData.height <= 0) {
        issues.push("Image artifact has invalid dimensions");
      }
    }

    if (artifact.type === "document" && artifact.data) {
      const docData = artifact.data as any;
      if (!docData.format) {
        issues.push("Document artifact missing format");
      }
    }

    return issues;
  }

  private identifyGaps(
    result: RunResultPackage,
    issues: VerificationIssue[],
    gaps: VerificationResult["gapsRequiringResearch"]
  ): void {
    const failedSteps = result.stepResults.filter((s) => !s.success);

    for (const step of failedSteps) {
      if (!step.error?.retryable) continue;

      gaps.push({
        topic: `Failed step: ${step.toolName}`,
        reason: step.error?.message || "Step execution failed",
        priority: "high",
      });
    }

    const unsupportedClaimIssues = issues.filter((i) => i.type === "unsupported_claim");
    if (unsupportedClaimIssues.length >= 3) {
      gaps.push({
        topic: "Citation coverage",
        reason: `${unsupportedClaimIssues.length} claims lack supporting citations`,
        priority: "medium",
      });
    }

    if (result.citations.length === 0 && (result.claims?.length || 0) > 0) {
      issues.push({
        id: randomUUID(),
        type: "missing_citation",
        severity: "error",
        description: "No citations found despite claims being made",
        suggestedAction: "Re-run research steps to collect sources",
      });

      gaps.push({
        topic: "Source collection",
        reason: "No citations collected during execution",
        priority: "high",
      });
    }
  }

  private checkLowConfidenceCitations(
    result: RunResultPackage,
    issues: VerificationIssue[]
  ): void {
    for (const citation of result.citations) {
      if (citation.confidence < this.config.minConfidenceThreshold) {
        issues.push({
          id: randomUUID(),
          type: "low_confidence",
          severity: "warning",
          description: `Low confidence citation (${(citation.confidence * 100).toFixed(0)}%): "${citation.excerpt.slice(0, 50)}..."`,
          affectedStepIndex: citation.stepIndex,
          suggestedAction: "Consider finding additional supporting sources",
        });
      }
    }
  }

  private async llmVerifyClaims(
    result: RunResultPackage,
    issues: VerificationIssue[],
    gaps: VerificationResult["gapsRequiringResearch"]
  ): Promise<void> {
    if (!result.summary || result.citations.length === 0) return;

    try {
      const prompt = this.buildVerificationPrompt(result);

      const response = await openai.chat.completions.create({
        model: this.config.model,
        temperature: 0.1,
        max_tokens: 2048,
        messages: [
          {
            role: "system",
            content: `You are a fact-checker that verifies claims against provided sources.
Identify any claims that are not supported by the sources or are contradicted by them.
Return a JSON object with:
{
  "unsupportedClaims": [{"claim": "...", "reason": "..."}],
  "conflictingClaims": [{"claim": "...", "sources": ["..."], "conflict": "..."}],
  "missingTopics": ["topic that needs more research"]
}`,
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return;

      const analysis = JSON.parse(content);

      for (const item of analysis.unsupportedClaims || []) {
        issues.push({
          id: randomUUID(),
          type: "unsupported_claim",
          severity: "warning",
          description: `LLM identified unsupported claim: ${item.claim}. Reason: ${item.reason}`,
          suggestedAction: "Find supporting sources or revise the claim",
        });
      }

      for (const item of analysis.conflictingClaims || []) {
        issues.push({
          id: randomUUID(),
          type: "conflicting_sources",
          severity: "warning",
          description: `Conflicting information: ${item.claim}. Conflict: ${item.conflict}`,
          suggestedAction: "Resolve the conflict between sources",
        });
      }

      for (const topic of analysis.missingTopics || []) {
        gaps.push({
          topic,
          reason: "LLM identified as needing more research",
          priority: "medium",
        });
      }
    } catch (error) {
      console.warn("[VerifierAgent] LLM verification failed:", error);
    }
  }

  private buildVerificationPrompt(result: RunResultPackage): string {
    const citationTexts = result.citations
      .map((c, i) => `[${i + 1}] ${c.sourceTitle || "Source"}: "${c.excerpt}"`)
      .join("\n");

    return `Summary to verify:
${result.summary}

Available sources:
${citationTexts}

Analyze the summary and identify any claims not supported by the sources.`;
  }

  private calculateOverallScore(
    citationCoverage: number,
    artifactIntegrity: number,
    issues: VerificationIssue[]
  ): number {
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;

    const issuePenalty = Math.min(0.5, errorCount * 0.15 + warningCount * 0.05);

    const baseScore = citationCoverage * 0.5 + artifactIntegrity * 0.5;
    return Math.max(0, baseScore - issuePenalty);
  }

  private determinePassFail(
    score: number,
    citationCoverage: number,
    artifactIntegrity: number,
    issues: VerificationIssue[]
  ): boolean {
    if (artifactIntegrity < this.config.minArtifactIntegrity) {
      return false;
    }

    if (this.config.requireAllClaims && citationCoverage < 1) {
      return false;
    }

    if (citationCoverage < this.config.minCitationCoverage) {
      return false;
    }

    const criticalErrors = issues.filter(
      (i) => i.severity === "error" && i.type !== "low_confidence"
    );
    if (criticalErrors.length > 0) {
      return false;
    }

    return score >= 0.5;
  }
}

export const verifierAgent = new VerifierAgent();
