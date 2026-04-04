/**
 * FactVerifier — decompose assistant responses into verifiable claims,
 * check each against RAG, web search, and common knowledge.
 * Annotates output with: ✓ verified, ⚠ uncertain, ✗ contradicted.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../utils/logger";

const logger = createLogger("FactVerifier");

// ─── Types ────────────────────────────────────────────────────────────────────

export type VerificationStatus = "verified" | "uncertain" | "contradicted" | "unverifiable";

export interface Claim {
  id: string;
  text: string;
  claimType: "factual" | "statistical" | "definitional" | "causal" | "opinion";
  extractedFrom: string;         // original sentence containing the claim
  isVerifiable: boolean;
}

export interface VerificationResult {
  claim: Claim;
  status: VerificationStatus;
  confidence: number;            // 0.0-1.0
  evidence: string[];            // supporting/contradicting sources
  explanation: string;
  marker: string;                // ✓ / ⚠ / ✗ / ~
}

export interface AnnotatedResponse {
  originalText: string;
  annotatedText: string;         // with inline markers
  claims: VerificationResult[];
  summary: {
    verified: number;
    uncertain: number;
    contradicted: number;
    unverifiable: number;
    overallConfidence: number;
  };
  verifiedAt: Date;
}

// ─── Claim Extraction ─────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function extractClaims(text: string): Promise<Claim[]> {
  if (!process.env.ANTHROPIC_API_KEY) return extractClaimsHeuristic(text);

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: `Extract verifiable factual claims from this text. Skip opinions and subjective statements.

Text: "${text.slice(0, 2000)}"

Return JSON array:
[{"text": "the claim", "claimType": "factual|statistical|definitional|causal|opinion", "extractedFrom": "original sentence", "isVerifiable": true|false}]

Only include claims that could be checked against external sources. Max 10 claims.`,
        },
      ],
    });

    const rawText = response.content[0]?.type === "text" ? response.content[0].text : "[]";
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? "[]") as Array<Omit<Claim, "id">>;

    return parsed.map((c, i) => ({ ...c, id: `claim_${i}` }));
  } catch (err) {
    logger.warn(`Claim extraction LLM failed: ${(err as Error).message}`);
    return extractClaimsHeuristic(text);
  }
}

function extractClaimsHeuristic(text: string): Claim[] {
  const claims: Claim[] = [];
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 20);

  const factualPatterns = [
    /\b(is|are|was|were)\s+(?:the|a|an)\s/i,
    /\b\d{4}\b/,                          // years
    /\b\d+%\b|\bpercent\b/i,              // statistics
    /\b(discovered|invented|founded|created|published)\b/i,
    /\b(according to|research shows|studies show|data indicates)\b/i,
  ];

  for (let i = 0; i < Math.min(sentences.length, 8); i++) {
    const sentence = sentences[i]!;
    const isFactual = factualPatterns.some((p) => p.test(sentence));
    if (!isFactual) continue;

    const claimType: Claim["claimType"] = /\d+%|\bpercent\b/i.test(sentence)
      ? "statistical"
      : /\b(is|are|means|defined as)\b/i.test(sentence)
      ? "definitional"
      : /\b(because|causes|leads to|results in)\b/i.test(sentence)
      ? "causal"
      : "factual";

    claims.push({
      id: `claim_${i}`,
      text: sentence.slice(0, 200),
      claimType,
      extractedFrom: sentence,
      isVerifiable: true,
    });
  }

  return claims;
}

// ─── Claim Verification ───────────────────────────────────────────────────────

// Common knowledge facts for quick verification without API calls
const COMMON_KNOWLEDGE: Array<{ pattern: RegExp; verified: boolean; note: string }> = [
  { pattern: /earth.*orbits.*sun|sun.*center.*solar system/i, verified: true, note: "Established astronomy" },
  { pattern: /water.*H2O|H2O.*water/i, verified: true, note: "Basic chemistry" },
  { pattern: /world war (i|1|one).*1914|1918.*world war (i|1|one)/i, verified: true, note: "Historical record" },
  { pattern: /world war (ii|2|two).*1939|1945.*world war (ii|2|two)/i, verified: true, note: "Historical record" },
  { pattern: /python.*guido|guido.*python/i, verified: true, note: "Programming language history" },
  { pattern: /javascript.*1995|netscape.*javascript/i, verified: true, note: "Programming language history" },
  { pattern: /\bpi\b.*3\.14|3\.14.*\bpi\b/i, verified: true, note: "Mathematical constant" },
];

function checkCommonKnowledge(claim: string): { matched: boolean; verified: boolean; note: string } | null {
  for (const entry of COMMON_KNOWLEDGE) {
    if (entry.pattern.test(claim)) {
      return { matched: true, verified: entry.verified, note: entry.note };
    }
  }
  return null;
}

async function verifyClaim(claim: Claim, searchContext?: string): Promise<VerificationResult> {
  const marker = (status: VerificationStatus): string => {
    const markers: Record<VerificationStatus, string> = { verified: "✓", uncertain: "⚠", contradicted: "✗", unverifiable: "~" };
    return markers[status];
  };

  // 1. Quick common knowledge check
  const commonCheck = checkCommonKnowledge(claim.text);
  if (commonCheck) {
    const status: VerificationStatus = commonCheck.verified ? "verified" : "contradicted";
    return {
      claim,
      status,
      confidence: 0.95,
      evidence: [commonCheck.note],
      explanation: commonCheck.note,
      marker: marker(status),
    };
  }

  // 2. Opinion/subjective claims are unverifiable
  if (claim.claimType === "opinion" || !claim.isVerifiable) {
    return {
      claim,
      status: "unverifiable",
      confidence: 1.0,
      evidence: ["Subjective or opinion-based claim"],
      explanation: "This is a matter of opinion or judgment, not a verifiable fact.",
      marker: "~",
    };
  }

  // 3. LLM verification
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      claim,
      status: "uncertain",
      confidence: 0.3,
      evidence: [],
      explanation: "Cannot verify without API access",
      marker: "⚠",
    };
  }

  try {
    const contextSection = searchContext
      ? `\n\nSearch context:\n${searchContext.slice(0, 1000)}`
      : "";

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Verify this claim based on your knowledge:

Claim: "${claim.text}"
Type: ${claim.claimType}${contextSection}

Return JSON: {"status": "verified|uncertain|contradicted|unverifiable", "confidence": 0.0-1.0, "evidence": ["source or fact"], "explanation": "brief reason"}

Be conservative — mark as uncertain if you're not confident.`,
        },
      ],
    });

    const rawText = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? "{}") as {
      status?: VerificationStatus;
      confidence?: number;
      evidence?: string[];
      explanation?: string;
    };

    const status: VerificationStatus = parsed.status ?? "uncertain";
    return {
      claim,
      status,
      confidence: parsed.confidence ?? 0.5,
      evidence: parsed.evidence ?? [],
      explanation: parsed.explanation ?? "No explanation provided",
      marker: marker(status),
    };
  } catch (err) {
    logger.warn(`Claim verification failed: ${(err as Error).message}`);
    return {
      claim,
      status: "uncertain",
      confidence: 0.3,
      evidence: [],
      explanation: "Verification encountered an error",
      marker: "⚠",
    };
  }
}

// ─── Text Annotation ──────────────────────────────────────────────────────────

function annotateText(
  originalText: string,
  results: VerificationResult[]
): string {
  let annotated = originalText;

  for (const result of results) {
    const { extractedFrom } = result.claim;
    const marker = ` ${result.marker}`;

    // Find the sentence and append the marker after it
    const sentenceEnd = extractedFrom.match(/[.!?]$/)?.[0] ?? ".";
    const withMarker = extractedFrom.replace(/([.!?])$/, `${marker}$1`);

    if (annotated.includes(extractedFrom)) {
      annotated = annotated.replace(extractedFrom, withMarker);
    } else {
      // Fallback: partial match on first 50 chars
      const preview = extractedFrom.slice(0, 50);
      if (annotated.includes(preview)) {
        annotated = annotated.replace(
          new RegExp(preview.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^.!?]*[.!?]"),
          (m) => m.replace(/([.!?])$/, `${marker}$1`)
        );
      }
      void sentenceEnd; // suppress unused warning
    }
  }

  return annotated;
}

// ─── FactVerifier ─────────────────────────────────────────────────────────────

export class FactVerifier {
  private cache = new Map<string, VerificationResult>();
  private readonly CACHE_TTL_MS = 10 * 60_000; // 10 minutes
  private cacheTimestamps = new Map<string, number>();

  /**
   * Verify all factual claims in a text block.
   */
  async verifyResponse(
    text: string,
    options: {
      searchContext?: string;
      maxClaims?: number;
      skipOpinions?: boolean;
    } = {}
  ): Promise<AnnotatedResponse> {
    const { searchContext, maxClaims = 8, skipOpinions = true } = options;

    logger.info(`Verifying response (${text.length} chars)`);

    // Extract claims
    let claims = await extractClaims(text);

    if (skipOpinions) {
      claims = claims.filter((c) => c.claimType !== "opinion");
    }

    claims = claims.slice(0, maxClaims);

    // Verify each claim (with cache)
    const results = await Promise.all(
      claims.map((claim) => this.verifyCachedClaim(claim, searchContext))
    );

    // Annotate
    const annotatedText = annotateText(text, results);

    // Summary
    const counts = { verified: 0, uncertain: 0, contradicted: 0, unverifiable: 0 };
    let totalConfidence = 0;

    for (const r of results) {
      counts[r.status]++;
      totalConfidence += r.confidence;
    }

    const overallConfidence = results.length > 0 ? totalConfidence / results.length : 0.5;

    logger.info(`Verification complete: ${counts.verified} verified, ${counts.uncertain} uncertain, ${counts.contradicted} contradicted`);

    return {
      originalText: text,
      annotatedText,
      claims: results,
      summary: { ...counts, overallConfidence },
      verifiedAt: new Date(),
    };
  }

  private async verifyCachedClaim(claim: Claim, searchContext?: string): Promise<VerificationResult> {
    const cacheKey = `${claim.text.slice(0, 100)}`;
    const now = Date.now();
    const ts = this.cacheTimestamps.get(cacheKey) ?? 0;

    if (this.cache.has(cacheKey) && now - ts < this.CACHE_TTL_MS) {
      return this.cache.get(cacheKey)!;
    }

    const result = await verifyClaim(claim, searchContext);
    this.cache.set(cacheKey, result);
    this.cacheTimestamps.set(cacheKey, now);
    return result;
  }

  /**
   * Quick single-claim check — useful for inline verification.
   */
  async verifyClaim(claimText: string): Promise<VerificationResult> {
    const claim: Claim = {
      id: "single",
      text: claimText,
      claimType: "factual",
      extractedFrom: claimText,
      isVerifiable: true,
    };
    return this.verifyCachedClaim(claim);
  }

  /**
   * Generate a verification legend for appending to responses.
   */
  formatLegend(): string {
    return "\n\n---\n*Verification markers: ✓ verified · ⚠ uncertain · ✗ contradicted · ~ unverifiable*";
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheTimestamps.clear();
  }
}

export const factVerifier = new FactVerifier();
