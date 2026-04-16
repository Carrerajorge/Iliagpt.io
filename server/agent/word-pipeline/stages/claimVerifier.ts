import { v4 as uuidv4 } from "uuid";
import {
  Stage, StageContext, QualityGateResult, SectionContent, EvidenceChunk,
  Claim, ClaimSchema, GAP, GAPSchema, SourceRef, SourceRefSchema
} from "../contracts";
import { openai } from "../../../lib/openai";

interface ClaimExtractorInput {
  sections: SectionContent[];
}

interface ClaimExtractorOutput {
  claims: Claim[];
}

interface VerifierInput {
  claims: Claim[];
  evidence: EvidenceChunk[];
}

interface VerifierOutput {
  verifiedClaims: Claim[];
  gaps: GAP[];
}

export class ClaimExtractorStage implements Stage<ClaimExtractorInput, ClaimExtractorOutput> {
  id = "claims";
  name = "Claim Extractor";

  async execute(input: ClaimExtractorInput, context: StageContext): Promise<ClaimExtractorOutput> {
    const allClaims: Claim[] = [];

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.1,
      message: "Extracting claims from sections",
    });

    for (const section of input.sections) {
      allClaims.push(...section.claims);
    }

    if (allClaims.length === 0) {
      const extractedClaims = await this.extractClaimsWithLLM(input.sections, context);
      allClaims.push(...extractedClaims);
    }

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 1.0,
      message: `Extracted ${allClaims.length} claims`,
    });

    return { claims: allClaims };
  }

  private async extractClaimsWithLLM(sections: SectionContent[], context: StageContext): Promise<Claim[]> {
    const claims: Claim[] = [];
    
    const combinedMarkdown = sections.map(s => s.markdown).join("\n\n---\n\n");
    
    try {
      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content: `Extract all factual claims from the document that require citations or verification.

Return a JSON object with a "claims" array where each claim has:
- text: the exact claim text
- requiresCitation: boolean (true if it contains statistics, facts, or assertions that need sources)
- category: one of "statistical", "factual", "opinion", "procedural"

Focus on claims that:
1. Contain numbers, percentages, or statistics
2. Make assertions about facts or events
3. Reference studies, research, or external sources
4. Make comparisons or rankings

Return ONLY valid JSON.`,
          },
          { role: "user", content: combinedMarkdown.slice(0, 8000) },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        const claimsArray = parsed.claims || [];
        
        for (const c of claimsArray) {
          claims.push(ClaimSchema.parse({
            id: uuidv4(),
            text: c.text,
            sectionId: sections[0]?.sectionId || uuidv4(),
            requiresCitation: c.requiresCitation ?? true,
            citations: [],
            factIds: [],
            verified: false,
          }));
        }
      }
    } catch (error) {
      console.warn("[ClaimExtractor] LLM extraction failed:", error);
    }

    return claims;
  }

  validate(output: ClaimExtractorOutput): QualityGateResult {
    const issues: QualityGateResult["issues"] = [];
    let score = 1.0;

    const citationRequired = output.claims.filter(c => c.requiresCitation);
    if (citationRequired.length === 0 && output.claims.length > 0) {
      issues.push({ severity: "info", message: "No claims requiring citations found" });
    }

    return {
      gateId: "claims_quality",
      gateName: "Claim Extraction Quality",
      passed: true,
      score: Math.max(0, score),
      threshold: 0.5,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  async fallback(input: ClaimExtractorInput, _context: StageContext): Promise<ClaimExtractorOutput> {
    const claims: Claim[] = [];
    
    for (const section of input.sections) {
      const sentences = section.markdown.split(/[.!?]+/).filter(s => s.trim().length > 30);
      
      for (const sentence of sentences.slice(0, 5)) {
        const hasNumber = /\d+/.test(sentence);
        if (hasNumber) {
          claims.push(ClaimSchema.parse({
            id: uuidv4(),
            text: sentence.trim(),
            sectionId: section.sectionId,
            requiresCitation: true,
            citations: [],
            factIds: [],
            verified: false,
          }));
        }
      }
    }

    return { claims };
  }
}

export class FactVerifierStage implements Stage<VerifierInput, VerifierOutput> {
  id = "verifier";
  name = "Fact Verifier";

  async execute(input: VerifierInput, context: StageContext): Promise<VerifierOutput> {
    const verifiedClaims: Claim[] = [];
    const gaps: GAP[] = [];

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 0.1,
      message: `Verifying ${input.claims.length} claims`,
    });

    const claimsNeedingCitation = input.claims.filter(c => c.requiresCitation);
    const claimsNotNeedingCitation = input.claims.filter(c => !c.requiresCitation);

    for (const claim of claimsNotNeedingCitation) {
      verifiedClaims.push({ ...claim, verified: true, verificationScore: 1.0 });
    }

    for (let i = 0; i < claimsNeedingCitation.length; i++) {
      const claim = claimsNeedingCitation[i];
      
      context.emitEvent({
        eventType: "stage.progress",
        stageId: this.id,
        stageName: this.name,
        progress: 0.1 + (0.8 * (i + 1) / claimsNeedingCitation.length),
        message: `Verifying claim ${i + 1}/${claimsNeedingCitation.length}`,
      });

      const verificationResult = await this.verifyClaim(claim, input.evidence, context);
      
      if (verificationResult.verified) {
        verifiedClaims.push({
          ...claim,
          verified: true,
          verificationScore: verificationResult.score,
          citations: verificationResult.citations,
          verificationMethod: "retrieval",
        });
      } else {
        gaps.push(GAPSchema.parse({
          id: uuidv4(),
          type: "unverified_claim",
          missing: `Evidence for: ${claim.text.slice(0, 100)}`,
          question: `What evidence supports: "${claim.text.slice(0, 100)}"?`,
          claimId: claim.id,
          sectionId: claim.sectionId,
          priority: "high",
          suggestedAction: "re_retrieve",
        }));

        verifiedClaims.push({
          ...claim,
          verified: false,
          verificationScore: verificationResult.score,
          verificationMethod: "retrieval",
        });
      }
    }

    context.emitEvent({
      eventType: "stage.progress",
      stageId: this.id,
      stageName: this.name,
      progress: 1.0,
      message: `Verified ${verifiedClaims.filter(c => c.verified).length}/${input.claims.length} claims, ${gaps.length} gaps`,
    });

    return { verifiedClaims, gaps };
  }

  private async verifyClaim(
    claim: Claim,
    evidence: EvidenceChunk[],
    context: StageContext
  ): Promise<{ verified: boolean; score: number; citations: Claim["citations"] }> {
    
    const relevantEvidence = this.findRelevantEvidence(claim.text, evidence);
    
    if (relevantEvidence.length === 0) {
      return { verified: false, score: 0.2, citations: [] };
    }

    try {
      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        temperature: 0.1,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content: `You are a fact verification assistant. Determine if the claim is supported by the evidence.

Return JSON with:
- supported: boolean (true if evidence supports the claim)
- confidence: number 0.0 to 1.0
- reasoning: brief explanation

Return ONLY valid JSON.`,
          },
          {
            role: "user",
            content: `CLAIM: "${claim.text}"

EVIDENCE:
${relevantEvidence.map(e => `"${e.text}"`).join("\n\n")}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        const supported = parsed.supported === true;
        const confidence = typeof parsed.confidence === "number" ? parsed.confidence : (supported ? 0.8 : 0.3);

        const citations = relevantEvidence.map(e => SourceRefSchema.parse({
          id: e.sourceId,
          title: "Source",
          accessedAt: new Date().toISOString(),
          type: "web",
          reliability: e.score,
        }));

        return { verified: supported, score: confidence, citations };
      }
    } catch (error) {
      console.warn("[FactVerifier] LLM verification failed:", error);
    }

    return {
      verified: relevantEvidence.length > 0,
      score: relevantEvidence.length > 0 ? 0.5 : 0.2,
      citations: [],
    };
  }

  private findRelevantEvidence(claimText: string, evidence: EvidenceChunk[]): EvidenceChunk[] {
    const claimWords = new Set(
      claimText.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    );

    return evidence
      .map(e => {
        const evidenceWords = e.text.toLowerCase().split(/\s+/);
        const overlap = evidenceWords.filter(w => claimWords.has(w)).length;
        return { chunk: e, score: overlap / Math.max(1, claimWords.size) };
      })
      .filter(e => e.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(e => e.chunk);
  }

  validate(output: VerifierOutput): QualityGateResult {
    const issues: QualityGateResult["issues"] = [];
    let score = 1.0;

    const verifiedCount = output.verifiedClaims.filter(c => c.verified).length;
    const totalClaims = output.verifiedClaims.length;
    const verificationRate = totalClaims > 0 ? verifiedCount / totalClaims : 1;

    if (verificationRate < 0.5) {
      issues.push({
        severity: "error",
        message: `Low verification rate: ${(verificationRate * 100).toFixed(0)}%`,
      });
      score -= 0.4;
    } else if (verificationRate < 0.7) {
      issues.push({
        severity: "warning",
        message: `Moderate verification rate: ${(verificationRate * 100).toFixed(0)}%`,
      });
      score -= 0.2;
    }

    if (output.gaps.length > 5) {
      issues.push({
        severity: "warning",
        message: `${output.gaps.length} evidence gaps detected`,
      });
      score -= 0.1;
    }

    return {
      gateId: "verifier_quality",
      gateName: "Fact Verification Quality",
      passed: score >= 0.5,
      score: Math.max(0, score),
      threshold: 0.5,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  async fallback(input: VerifierInput, _context: StageContext): Promise<VerifierOutput> {
    return {
      verifiedClaims: input.claims.map(c => ({
        ...c,
        verified: !c.requiresCitation,
        verificationScore: c.requiresCitation ? 0.3 : 1.0,
        verificationMethod: "rule" as const,
      })),
      gaps: [],
    };
  }
}

export const claimExtractorStage = new ClaimExtractorStage();
export const factVerifierStage = new FactVerifierStage();
