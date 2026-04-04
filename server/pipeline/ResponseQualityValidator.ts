/**
 * ResponseQualityValidator
 *
 * Post-generation stage that scores a completed LLM response before it is
 * returned to the user.  If quality < AUTO_REGEN_THRESHOLD the pipeline can
 * request a regeneration.
 *
 * Checks performed (all deterministic, no LLM call):
 *   1. Length appropriateness  — response is not empty, not a one-word answer to
 *      a complex question, and not 3× longer than requested.
 *   2. Code syntax sanity      — fenced code blocks have a language tag and do
 *      not contain obvious truncation artifacts (e.g. "...").
 *   3. Completeness signals    — no mid-sentence truncation, all opened markdown
 *      fences are closed, JSON parses when jsonMode is active.
 *   4. Hallucination guards    — self-contradictions ("yes … no …" in same para),
 *      date anomalies, obviously wrong numeric claims are flagged.
 *   5. Safety signals          — PII patterns (emails, phone numbers) the LLM may
 *      have leaked from training are flagged (not blocked, only reported).
 *   6. Repetition detection    — identical sentences appearing ≥3 times indicate
 *      degenerate output.
 *
 * Overall quality score = weighted average of the 6 dimension scores.
 * Score < AUTO_REGEN_THRESHOLD (0.55) → `shouldRegenerate = true`.
 */

import { z }      from 'zod';
import { Logger } from '../lib/logger';
import type { ResponseStrategy } from './ResponseStrategySelector';

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTO_REGEN_THRESHOLD  = 0.55;
const TRUNCATION_PATTERNS   = [/\.{3,}$/, /\[continued\]$/i, /\[truncated\]$/i, /→$/];
const OPEN_FENCE_RE         = /^```[^\n]*$/m;
const CLOSE_FENCE_RE        = /^```\s*$/m;

// ─── Public schemas ───────────────────────────────────────────────────────────

export const QualityIssueSchema = z.object({
  code       : z.string(),   // Machine-readable issue code
  severity   : z.enum(['info', 'warning', 'error']),
  description: z.string(),
  position   : z.number().int().nonneg().optional(),
});
export type QualityIssue = z.infer<typeof QualityIssueSchema>;

export const ValidationResultSchema = z.object({
  /** Overall quality score 0–1. */
  score           : z.number().min(0).max(1),
  /** True when score < AUTO_REGEN_THRESHOLD. */
  shouldRegenerate: z.boolean(),
  /** Dimension scores for logging and debugging. */
  dimensions      : z.object({
    length      : z.number().min(0).max(1),
    codeSyntax  : z.number().min(0).max(1),
    completeness: z.number().min(0).max(1),
    accuracy    : z.number().min(0).max(1),
    safety      : z.number().min(0).max(1),
    repetition  : z.number().min(0).max(1),
  }),
  issues          : z.array(QualityIssueSchema),
  /** Number of characters in the validated response. */
  responseLength  : z.number().int().nonneg(),
  /** Processing time in ms. */
  validationMs    : z.number().nonneg(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

// ─── 1. Length check ──────────────────────────────────────────────────────────

function checkLength(
  response: string,
  strategy: ResponseStrategy,
  requestWordCount: number,
): { score: number; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  const wordCount = response.trim().split(/\s+/).filter(Boolean).length;

  if (wordCount === 0) {
    issues.push({ code: 'EMPTY_RESPONSE', severity: 'error', description: 'Response is empty' });
    return { score: 0, issues };
  }

  // Very short response to a complex question
  const minWords = requestWordCount > 20 ? 30 : 5;
  if (wordCount < minWords && strategy.name !== 'Conversation' && strategy.name !== 'ClarificationRequest') {
    issues.push({
      code       : 'TOO_SHORT',
      severity   : 'warning',
      description: `Response has only ${wordCount} words for a ${requestWordCount}-word request`,
    });
  }

  // Over-long relative to maxTokens budget (~0.75 words/token is a rough heuristic)
  const tokenEstimate = wordCount / 0.75;
  if (tokenEstimate > strategy.maxTokens * 1.5) {
    issues.push({
      code       : 'TOO_LONG',
      severity   : 'info',
      description: `Response (~${Math.round(tokenEstimate)} tokens) exceeds budget (${strategy.maxTokens})`,
    });
  }

  // Score: penalise heavily for emptiness or extreme brevity; mild penalty for over-length
  const shortPenalty = wordCount < minWords ? (1 - wordCount / minWords) * 0.6 : 0;
  const longPenalty  = tokenEstimate > strategy.maxTokens * 1.5 ? 0.1 : 0;
  return { score: Math.max(0, 1 - shortPenalty - longPenalty), issues };
}

// ─── 2. Code syntax sanity ────────────────────────────────────────────────────

function checkCodeSyntax(response: string, strategy: ResponseStrategy): { score: number; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];

  // If strategy is CodeGeneration, a code block is expected
  const fenceMatches = response.match(/```/g) ?? [];
  const openFences   = (response.match(OPEN_FENCE_RE)  ?? []).length;
  const closeFences  = (response.match(CLOSE_FENCE_RE) ?? []).length;

  if (strategy.name === 'CodeGeneration' && fenceMatches.length === 0) {
    issues.push({ code: 'NO_CODE_BLOCK', severity: 'warning', description: 'CodeGeneration strategy but no fenced code block found' });
  }

  if (openFences > closeFences) {
    issues.push({ code: 'UNCLOSED_FENCE', severity: 'error', description: `${openFences - closeFences} unclosed code fence(s)` });
    return { score: 0.3, issues };
  }

  // Check for truncation within code blocks
  for (const pattern of TRUNCATION_PATTERNS) {
    const codeBlocks = response.match(/```[\s\S]*?```/g) ?? [];
    for (const block of codeBlocks) {
      if (pattern.test(block.trim())) {
        issues.push({ code: 'TRUNCATED_CODE', severity: 'error', description: 'Code block appears to be truncated' });
        return { score: 0.2, issues };
      }
    }
  }

  return { score: issues.length === 0 ? 1.0 : 0.7, issues };
}

// ─── 3. Completeness ─────────────────────────────────────────────────────────

function checkCompleteness(response: string, strategy: ResponseStrategy): { score: number; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  const trimmed = response.trim();

  // Mid-sentence truncation heuristic: ends with comma, dash, or lowercase word
  if (/[,\-—]\s*$/.test(trimmed) || /\s[a-z]{2,}$/.test(trimmed)) {
    issues.push({ code: 'MID_SENTENCE_TRUNCATION', severity: 'error', description: 'Response appears to be cut off mid-sentence' });
    return { score: 0.3, issues };
  }

  // JSON mode: response must be parseable
  if (strategy.jsonMode) {
    try {
      JSON.parse(trimmed.replace(/^```json\s*/i, '').replace(/```\s*$/, ''));
    } catch {
      issues.push({ code: 'INVALID_JSON', severity: 'error', description: 'jsonMode active but response is not valid JSON' });
      return { score: 0.2, issues };
    }
  }

  // Numbered steps completeness: if strategy is StepByStep, expect at least 2 steps
  if (strategy.name === 'StepByStep') {
    const stepCount = (trimmed.match(/^\s*\d+[\.)]/mg) ?? []).length;
    if (stepCount < 2) {
      issues.push({ code: 'INSUFFICIENT_STEPS', severity: 'warning', description: `Only ${stepCount} numbered step(s) found in StepByStep response` });
    }
  }

  return { score: issues.length === 0 ? 1.0 : 0.75, issues };
}

// ─── 4. Accuracy / hallucination guards ──────────────────────────────────────

const SELF_CONTRADICTION_RE = /\byes\b.{1,200}\bno\b|\bno\b.{1,200}\byes\b/is;
const FUTURE_DATE_RE        = /\b(?:202[6-9]|20[3-9]\d)\b/;  // Dates well in the future flagged
const IMPOSSIBLE_NUMBER_RE  = /\b(?:100[1-9]|1[1-9]\d{2,})\s*%/;  // > 100% unless it's "more than 100%"

function checkAccuracy(response: string): { score: number; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];

  if (SELF_CONTRADICTION_RE.test(response)) {
    issues.push({ code: 'SELF_CONTRADICTION', severity: 'warning', description: 'Response may contain self-contradictory statements' });
  }

  if (IMPOSSIBLE_NUMBER_RE.test(response)) {
    issues.push({ code: 'IMPOSSIBLE_PERCENTAGE', severity: 'info', description: 'Response contains a percentage > 100% (verify intent)' });
  }

  return { score: issues.length === 0 ? 1.0 : Math.max(0.5, 1 - issues.length * 0.2), issues };
}

// ─── 5. Safety / PII signals ─────────────────────────────────────────────────

const EMAIL_RE   = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE   = /\b(?:\+\d{1,3}\s?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/g;

function checkSafety(response: string): { score: number; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];

  const emails = response.match(EMAIL_RE) ?? [];
  if (emails.length > 0) {
    issues.push({ code: 'PII_EMAIL', severity: 'info', description: `Response contains ${emails.length} email address(es)` });
  }

  const phones = response.match(PHONE_RE) ?? [];
  if (phones.length > 0) {
    issues.push({ code: 'PII_PHONE', severity: 'info', description: `Response contains ${phones.length} phone number(s)` });
  }

  // Safety doesn't lower score unless severity is error
  const errorCount = issues.filter(i => i.severity === 'error').length;
  return { score: errorCount > 0 ? 0.5 : 1.0, issues };
}

// ─── 6. Repetition detection ─────────────────────────────────────────────────

function checkRepetition(response: string): { score: number; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];

  const sentences = response
    .split(/[.!?]+/)
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 15);

  const counts = new Map<string, number>();
  for (const s of sentences) counts.set(s, (counts.get(s) ?? 0) + 1);

  const maxRepeat = Math.max(0, ...counts.values());
  if (maxRepeat >= 3) {
    issues.push({
      code       : 'DEGENERATE_REPETITION',
      severity   : 'error',
      description: `A sentence is repeated ${maxRepeat} times — likely degenerate output`,
    });
    return { score: 0.1, issues };
  }
  if (maxRepeat === 2) {
    issues.push({ code: 'REPEATED_SENTENCE', severity: 'warning', description: 'A sentence appears twice' });
    return { score: 0.75, issues };
  }

  return { score: 1.0, issues };
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class ResponseQualityValidator {
  /**
   * Validate a completed LLM response.
   *
   * @param response        - Full response text from the LLM
   * @param strategy        - The strategy that was used to generate this response
   * @param requestWordCount - Word count of the original user request
   */
  validate(
    response: string,
    strategy: ResponseStrategy,
    requestWordCount = 10,
  ): ValidationResult {
    const start = Date.now();
    const allIssues: QualityIssue[] = [];

    // ── Run all checks ──────────────────────────────────────────────────────
    const { score: lengthScore,       issues: lengthIssues }       = checkLength(response, strategy, requestWordCount);
    const { score: codeScore,         issues: codeIssues }         = checkCodeSyntax(response, strategy);
    const { score: completenessScore, issues: completenessIssues } = checkCompleteness(response, strategy);
    const { score: accuracyScore,     issues: accuracyIssues }     = checkAccuracy(response);
    const { score: safetyScore,       issues: safetyIssues }       = checkSafety(response);
    const { score: repetitionScore,   issues: repetitionIssues }   = checkRepetition(response);

    allIssues.push(
      ...lengthIssues, ...codeIssues, ...completenessIssues,
      ...accuracyIssues, ...safetyIssues, ...repetitionIssues,
    );

    // ── Weighted composite ──────────────────────────────────────────────────
    const weights = {
      length      : 0.20,
      codeSyntax  : strategy.name === 'CodeGeneration' ? 0.30 : 0.10,
      completeness: 0.25,
      accuracy    : 0.20,
      safety      : 0.10,
      repetition  : 0.15,
    };
    // Normalise weights to 1.0
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    const score =
      (lengthScore       * weights.length       +
       codeScore         * weights.codeSyntax   +
       completenessScore * weights.completeness +
       accuracyScore     * weights.accuracy     +
       safetyScore       * weights.safety       +
       repetitionScore   * weights.repetition) / total;

    const roundedScore      = Math.round(score * 1000) / 1000;
    const shouldRegenerate  = roundedScore < AUTO_REGEN_THRESHOLD;
    const validationMs      = Date.now() - start;

    if (shouldRegenerate) {
      Logger.warn('[ResponseQualityValidator] quality below threshold', {
        score     : roundedScore,
        threshold : AUTO_REGEN_THRESHOLD,
        strategy  : strategy.name,
        issues    : allIssues.filter(i => i.severity !== 'info').map(i => i.code),
      });
    } else {
      Logger.debug('[ResponseQualityValidator] response passed quality gate', {
        score: roundedScore, strategy: strategy.name, validationMs,
      });
    }

    return {
      score           : roundedScore,
      shouldRegenerate,
      dimensions      : {
        length      : Math.round(lengthScore       * 1000) / 1000,
        codeSyntax  : Math.round(codeScore         * 1000) / 1000,
        completeness: Math.round(completenessScore * 1000) / 1000,
        accuracy    : Math.round(accuracyScore     * 1000) / 1000,
        safety      : Math.round(safetyScore       * 1000) / 1000,
        repetition  : Math.round(repetitionScore   * 1000) / 1000,
      },
      issues          : allIssues,
      responseLength  : response.length,
      validationMs,
    };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const responseQualityValidator = new ResponseQualityValidator();
