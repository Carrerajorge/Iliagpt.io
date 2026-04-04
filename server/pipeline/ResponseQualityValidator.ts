/**
 * ResponseQualityValidator — Batch 1 Pipeline Stage
 *
 * Post-processing gate that scores every LLM response before delivery:
 *  - Hallucination detection: verifies claims against provided context
 *  - Code block syntax validation (JS/TS/Python pattern checks)
 *  - Factual consistency cross-reference within the response itself
 *  - Completeness check: did the response address all questions?
 *  - Aggregate quality score 0–1 with per-dimension breakdown
 *  - Auto-regeneration signal if score < configurable threshold
 */

import { createLogger } from "../utils/logger";

const log = createLogger("ResponseQualityValidator");

// ─── Types ────────────────────────────────────────────────────────────────────

export type QualityDimension =
  | "completeness"
  | "factual_consistency"
  | "code_validity"
  | "hallucination_risk"
  | "length_appropriateness"
  | "format_compliance";

export interface DimensionScore {
  dimension: QualityDimension;
  score: number;       // 0–1
  weight: number;      // contribution weight
  issues: string[];
  details?: string;
}

export interface ValidationResult {
  overallScore: number;         // 0–1 weighted average
  passed: boolean;              // true if score ≥ threshold
  shouldRegenerate: boolean;    // true if score < regenerationThreshold
  dimensions: DimensionScore[];
  issues: string[];             // flattened critical issues
  suggestions: string[];        // non-blocking improvement hints
  validationMs: number;
  responseTokenEstimate: number;
}

export interface ValidatorConfig {
  passingThreshold: number;        // default 0.60
  regenerationThreshold: number;   // below this → caller should retry (default 0.45)
  maxResponseLength: number;       // chars — above this penalises length score
  minResponseLength: number;       // chars — below this also penalises
  enableCodeValidation: boolean;
  enableHallucinationCheck: boolean;
  contextSnippets: string[];       // relevant context the response should align with
}

const DEFAULT_CONFIG: ValidatorConfig = {
  passingThreshold: 0.60,
  regenerationThreshold: 0.45,
  maxResponseLength: 12_000,
  minResponseLength: 20,
  enableCodeValidation: true,
  enableHallucinationCheck: true,
  contextSnippets: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract all fenced code blocks from response (uses matchAll, not exec) */
function extractCodeBlocks(text: string): Array<{ lang: string; code: string }> {
  const blocks: Array<{ lang: string; code: string }> = [];
  for (const m of text.matchAll(/```(\w*)\n?([\s\S]*?)```/g)) {
    blocks.push({ lang: (m[1] ?? "").toLowerCase(), code: m[2] ?? "" });
  }
  return blocks;
}

/** Extract question sentences from text */
function extractQuestions(text: string): string[] {
  const questions: string[] = [];
  for (const m of text.matchAll(/[^.!?]*\?/g)) {
    const q = m[0].trim();
    if (q.length > 5) questions.push(q);
  }
  return questions;
}

// ─── Dimension Validators ─────────────────────────────────────────────────────

/**
 * Completeness: did the response address all questions in the user message?
 * Heuristic: for each detected question, check if key nouns/verbs appear
 * in the response.
 */
function validateCompleteness(
  userMessage: string,
  response: string,
): DimensionScore {
  const issues: string[] = [];
  const questions = extractQuestions(userMessage);

  if (questions.length === 0) {
    return { dimension: "completeness", score: 0.85, weight: 0.2, issues: [] };
  }

  const responseLower = response.toLowerCase();
  let answered = 0;

  const stopwords = new Set([
    "what", "when", "where", "which", "that", "this",
    "with", "from", "have", "will", "does",
  ]);

  for (const q of questions) {
    const keywords = q
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length >= 4 && !stopwords.has(w));

    if (keywords.length === 0) {
      answered++;
      continue;
    }

    const matchedKeywords = keywords.filter(kw => responseLower.includes(kw));
    const ratio = matchedKeywords.length / keywords.length;
    if (ratio >= 0.5) answered++;
    else issues.push(`Possible unanswered question: "${q.slice(0, 60)}..."`);
  }

  const score = answered / questions.length;
  return { dimension: "completeness", score, weight: 0.25, issues };
}

/**
 * Factual consistency: look for internal contradictions.
 * Detects sentences that appear to make conflicting claims about same subject.
 */
function validateFactualConsistency(response: string): DimensionScore {
  const issues: string[] = [];
  let score = 1.0;

  // Detect negation flip: same subject in positive then negative claim
  const sentences = response.split(/[.!?]\s+/);
  const claims = new Map<string, boolean>(); // subject → isPositive

  for (const sentence of sentences) {
    const isNegated =
      /\b(not|never|no|cannot|can't|isn't|aren't|doesn't|don't)\b/i.test(sentence);
    const subjectMatch = sentence.match(/^(?:the\s+)?(\w+(?:\s+\w+){0,2})\b/i);
    if (subjectMatch) {
      const subj = subjectMatch[1].toLowerCase();
      const isPositive = !isNegated;
      if (claims.has(subj) && claims.get(subj) !== isPositive) {
        score -= 0.08;
        issues.push(`Potential contradiction about "${subj}"`);
      } else {
        claims.set(subj, isPositive);
      }
    }
  }

  // Check for conflicting numbers attached to the same noun
  const numberClaims = new Map<string, string>();
  for (const m of response.matchAll(/(\w+)\s+(?:is|are|has|have|equals?|totals?)\s+(\d+(?:\.\d+)?)/gi)) {
    const noun = (m[1] ?? "").toLowerCase();
    const num = m[2] ?? "";
    if (numberClaims.has(noun) && numberClaims.get(noun) !== num) {
      score -= 0.1;
      issues.push(`Conflicting values for "${noun}": ${numberClaims.get(noun)} vs ${num}`);
    } else {
      numberClaims.set(noun, num);
    }
  }

  return {
    dimension: "factual_consistency",
    score: Math.max(0, score),
    weight: 0.2,
    issues: issues.slice(0, 3),
  };
}

/**
 * Code validity: static checks on fenced code blocks.
 * Catches obvious structural problems without running the code.
 */
function validateCodeBlocks(response: string): DimensionScore {
  const issues: string[] = [];
  const blocks = extractCodeBlocks(response);

  if (blocks.length === 0) {
    return { dimension: "code_validity", score: 1.0, weight: 0.15, issues: [] };
  }

  let scoreSum = 0;
  for (const { lang, code } of blocks) {
    let blockScore = 1.0;

    // Unbalanced braces
    const opens = (code.match(/\{/g) ?? []).length;
    const closes = (code.match(/\}/g) ?? []).length;
    if (Math.abs(opens - closes) > 2) {
      blockScore -= 0.3;
      issues.push(`Unbalanced braces in ${lang || "code"} block`);
    }

    // Unbalanced parentheses
    const parensOpen = (code.match(/\(/g) ?? []).length;
    const parensClose = (code.match(/\)/g) ?? []).length;
    if (Math.abs(parensOpen - parensClose) > 2) {
      blockScore -= 0.2;
      issues.push(`Unbalanced parentheses in ${lang || "code"} block`);
    }

    // Python-specific: mixed indent styles
    if (lang === "python" || lang === "py") {
      const hasTabs = /^\t/m.test(code);
      const hasSpaces = /^ {2,}/m.test(code);
      if (hasTabs && hasSpaces) {
        blockScore -= 0.15;
        issues.push("Python block mixes tabs and spaces");
      }
    }

    // Placeholder markers left in code
    if (/\b(TODO|FIXME|PLACEHOLDER|YOUR_CODE_HERE)\b/.test(code)) {
      blockScore -= 0.15;
      issues.push("Code block contains placeholder markers");
    }

    // Very short block suggesting truncation
    if (code.trim().split("\n").length < 2 && code.trim().length < 20) {
      blockScore -= 0.1;
      issues.push("Code block appears incomplete or truncated");
    }

    scoreSum += Math.max(0, blockScore);
  }

  return {
    dimension: "code_validity",
    score: scoreSum / blocks.length,
    weight: 0.2,
    issues: issues.slice(0, 4),
  };
}

/**
 * Hallucination risk: checks whether specific numbers and URLs in the response
 * appear in the provided context snippets. Without context, falls back to
 * over-confidence language detection.
 */
function validateHallucinationRisk(
  response: string,
  contextSnippets: string[],
): DimensionScore {
  const issues: string[] = [];
  let score = 0.85; // Optimistic baseline when no external context available

  if (contextSnippets.length > 0) {
    const contextText = contextSnippets.join(" ").toLowerCase();

    // Verify specific numbers appear in context
    const numbers = response.match(/\b\d{4,}\b/g) ?? [];
    let unsupported = 0;
    for (const num of numbers) {
      if (!contextText.includes(num)) unsupported++;
    }
    if (numbers.length > 0) {
      const unsupportedRatio = unsupported / numbers.length;
      score -= unsupportedRatio * 0.35;
      if (unsupportedRatio > 0.3) {
        issues.push(`${unsupported}/${numbers.length} specific numbers not found in context`);
      }
    }
  }

  // Flag URLs that don't appear in context
  const contextText = contextSnippets.join(" ");
  const urlsInResponse = response.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi) ?? [];
  for (const url of urlsInResponse) {
    if (!contextText.includes(url)) {
      score -= 0.05;
      issues.push(`Unverified URL: ${url.slice(0, 60)}`);
    }
  }

  // Over-confident language without hedging → small penalty
  const overconfidentPatterns: RegExp[] = [
    /\b(definitely|certainly|absolutely|always|never|100%)\b/gi,
    /\bI (know|guarantee|promise|assure you)\b/gi,
  ];
  let overconfidenceHits = 0;
  for (const pat of overconfidentPatterns) {
    overconfidenceHits += (response.match(pat) ?? []).length;
  }
  if (overconfidenceHits > 3) {
    score -= Math.min(0.1, overconfidenceHits * 0.02);
    issues.push(`Overly confident language (${overconfidenceHits} instances)`);
  }

  return {
    dimension: "hallucination_risk",
    score: Math.max(0, score),
    weight: 0.25,
    issues: issues.slice(0, 3),
  };
}

/**
 * Length appropriateness: penalise extreme brevity or verbosity.
 */
function validateLength(
  response: string,
  minLength: number,
  maxLength: number,
): DimensionScore {
  const len = response.length;
  const issues: string[] = [];
  let score = 1.0;

  if (len < minLength) {
    score = Math.max(0.2, len / minLength);
    issues.push(`Response too short (${len} chars, min ${minLength})`);
  } else if (len > maxLength) {
    const overflow = len - maxLength;
    score = Math.max(0.5, 1 - overflow / maxLength);
    issues.push(`Response very long (${len} chars, recommended max ${maxLength})`);
  }

  return { dimension: "length_appropriateness", score, weight: 0.1, issues };
}

/**
 * Format compliance: checks markdown fencing, list consistency, etc.
 */
function validateFormat(response: string): DimensionScore {
  const issues: string[] = [];
  let score = 1.0;

  // Unclosed code fence (odd number of ``` markers)
  const openFences = (response.match(/```/g) ?? []).length;
  if (openFences % 2 !== 0) {
    score -= 0.3;
    issues.push("Unclosed code fence detected");
  }

  // Inconsistent list markers (mixing * and - at same level)
  const bulletLines = response.match(/^(\s*[-*•])\s+/gm) ?? [];
  const markers = new Set(bulletLines.map(l => l.trim().charAt(0)));
  if (markers.size > 1) {
    score -= 0.05;
    issues.push("Mixed list markers (- and *) at same level");
  }

  // Trailing whitespace (template artefact indicator)
  const trailingWs = (response.match(/[ \t]+$/gm) ?? []).length;
  if (trailingWs > 10) {
    score -= Math.min(0.1, trailingWs * 0.005);
  }

  return { dimension: "format_compliance", score: Math.max(0.5, score), weight: 0.1, issues };
}

// ─── ResponseQualityValidator ─────────────────────────────────────────────────

export class ResponseQualityValidator {
  private config: ValidatorConfig;

  constructor(config: Partial<ValidatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  validate(
    response: string,
    userMessage: string,
    contextSnippets?: string[],
  ): ValidationResult {
    const t0 = Date.now();
    const ctx = contextSnippets ?? this.config.contextSnippets;

    const dimensions: DimensionScore[] = [
      validateCompleteness(userMessage, response),
      validateFactualConsistency(response),
      this.config.enableCodeValidation
        ? validateCodeBlocks(response)
        : { dimension: "code_validity" as const, score: 1.0, weight: 0.15, issues: [] },
      this.config.enableHallucinationCheck
        ? validateHallucinationRisk(response, ctx)
        : { dimension: "hallucination_risk" as const, score: 0.9, weight: 0.25, issues: [] },
      validateLength(response, this.config.minResponseLength, this.config.maxResponseLength),
      validateFormat(response),
    ];

    const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
    const overallScore =
      dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight;

    const allIssues = dimensions.flatMap(d => d.issues);

    const suggestions: string[] = [];
    for (const dim of dimensions) {
      if (dim.score < 0.7 && dim.score >= 0.5) {
        suggestions.push(`Improve ${dim.dimension} (score: ${dim.score.toFixed(2)})`);
      }
    }

    const result: ValidationResult = {
      overallScore: Math.round(overallScore * 1000) / 1000,
      passed: overallScore >= this.config.passingThreshold,
      shouldRegenerate: overallScore < this.config.regenerationThreshold,
      dimensions,
      issues: allIssues.filter(i => i.length > 0).slice(0, 5),
      suggestions,
      validationMs: Date.now() - t0,
      responseTokenEstimate: Math.ceil(response.length / 4),
    };

    log.info("response_validated", {
      overallScore: result.overallScore,
      passed: result.passed,
      shouldRegenerate: result.shouldRegenerate,
      issueCount: allIssues.length,
      validationMs: result.validationMs,
    });

    return result;
  }

  configure(patch: Partial<ValidatorConfig>): void {
    this.config = { ...this.config, ...patch };
  }
}

export const responseQualityValidator = new ResponseQualityValidator();
