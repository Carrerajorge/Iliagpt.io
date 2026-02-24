/**
 * Verifier / QA Agent
 *
 * A SEPARATE model that runs AFTER the main response to check:
 *   1. Factual coherence (dates, numbers, names match across sources)
 *   2. Citation completeness (every claim has a traceable citation)
 *   3. Contradiction detection (between sources or within response)
 *   4. Confidence scoring (per-claim and overall)
 *   5. Hallucination detection (claims not supported by provided context)
 *   6. Missing information flagging (when response is incomplete)
 *
 * If verification fails, it can:
 *   - Request a rewrite with specific corrections
 *   - Add disclaimers for low-confidence claims
 *   - Generate a clarification question for the user
 */

import { GoogleGenAI } from '@google/genai';
import { withSpan } from '../../lib/tracing';
import type { CanonicalBrief } from './briefSchema';
import type { RetrievedResult } from './hybridRAGEngine';

// ============================================================================
// Configuration
// ============================================================================

const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.VITEST_WORKER_ID;
const genAI = !isTestEnv && process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const VERIFIER_MODEL = process.env.VERIFIER_MODEL || 'gemini-2.5-flash';

// ============================================================================
// Types
// ============================================================================

export interface VerificationInput {
  /** The response to verify */
  response: string;
  /** The original brief */
  brief: CanonicalBrief;
  /** Retrieved context used to generate the response */
  retrievedContext: RetrievedResult[];
  /** Original user query */
  userQuery: string;
}

export interface ClaimVerification {
  /** The claim being verified */
  claim: string;
  /** Whether the claim is supported by context */
  supported: boolean;
  /** Which source(s) support this claim */
  supportingSources: Array<{
    fileName: string;
    pageNumber?: number;
    sectionTitle?: string;
    excerpt: string;
    chunkId: string;
  }>;
  /** Confidence in this verification (0-1) */
  confidence: number;
  /** Type of issue if not supported */
  issueType?: 'hallucination' | 'unsupported' | 'partially_supported' | 'contradicted' | 'outdated';
  /** Suggested correction */
  correction?: string;
}

export interface CoherenceCheck {
  /** Type of check */
  type: 'date_consistency' | 'number_consistency' | 'name_consistency' |
    'cross_source_contradiction' | 'internal_contradiction' | 'logical_consistency';
  /** Whether it passed */
  passed: boolean;
  /** Severity */
  severity: 'critical' | 'major' | 'minor' | 'info';
  /** Description of the issue */
  description: string;
  /** Locations in the response */
  locations: string[];
  /** Suggested fix */
  fix?: string;
}

export interface CitationAudit {
  /** Total claims that need citations */
  totalClaims: number;
  /** Claims with proper citations */
  citedClaims: number;
  /** Claims missing citations */
  uncitedClaims: number;
  /** Citation coverage percentage */
  coveragePercent: number;
  /** Claims with incorrect citations */
  incorrectCitations: number;
  /** Specific uncited claims */
  uncitedClaimsList: string[];
}

export interface VerificationResult {
  /** Overall verification passed */
  passed: boolean;
  /** Overall confidence score (0-1) */
  overallConfidence: number;
  /** Verification grade */
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** Individual claim verifications */
  claimVerifications: ClaimVerification[];
  /** Coherence checks */
  coherenceChecks: CoherenceCheck[];
  /** Citation audit */
  citationAudit: CitationAudit;
  /** Whether a follow-up question is needed */
  needsFollowUp: boolean;
  /** Follow-up question if needed */
  followUpQuestion?: string;
  /** Suggested corrections to the response */
  corrections: Array<{
    original: string;
    corrected: string;
    reason: string;
    severity: 'critical' | 'major' | 'minor';
  }>;
  /** Disclaimers to add */
  disclaimers: string[];
  /** Processing metadata */
  metadata: {
    model: string;
    processingTimeMs: number;
    checksPerformed: number;
  };
}

// ============================================================================
// Claim Extraction
// ============================================================================

function extractClaims(text: string): string[] {
  // Split into sentences and filter for factual claims
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  return sentences
    .map(s => s.trim())
    .filter(s => {
      // Skip questions, greetings, meta-statements
      if (/^\s*[¿?]/.test(s)) return false;
      if (/^(hola|gracias|de nada|ok|bien)/i.test(s)) return false;
      // Keep sentences with factual content (numbers, names, dates, specific claims)
      return s.length > 20 && (
        /\d/.test(s) || // Has numbers
        /[A-Z][a-z]+/.test(s) || // Has proper nouns
        /\b(es|son|fue|fueron|tiene|tienen|según|indica|muestra|demuestra|establece|define|consiste|significa)\b/i.test(s) // Has assertion verbs
      );
    });
}

// ============================================================================
// Number Extraction & Comparison
// ============================================================================

function extractNumbers(text: string): Array<{ value: number; context: string }> {
  const results: Array<{ value: number; context: string }> = [];
  const pattern = /(?:\$|€|USD|EUR)?[\s]*[\d,]+(?:\.\d+)?(?:\s*%|\s*(?:millones|miles|billion|million))?/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const numStr = match[0].replace(/[,$€\s]/g, '').replace(/millones|million/i, '000000').replace(/miles|thousand/i, '000');
    const value = parseFloat(numStr);
    if (!isNaN(value)) {
      const start = Math.max(0, match.index - 50);
      const end = Math.min(text.length, match.index + match[0].length + 50);
      results.push({ value, context: text.slice(start, end).trim() });
    }
  }
  return results;
}

// ============================================================================
// Date Extraction & Comparison
// ============================================================================

function extractDates(text: string): Array<{ raw: string; context: string }> {
  const results: Array<{ raw: string; context: string }> = [];
  const pattern = /\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}|\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:de\s+)?\d{4}\b|\b\d{4}\b/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const start = Math.max(0, match.index - 40);
    const end = Math.min(text.length, match.index + match[0].length + 40);
    results.push({ raw: match[0], context: text.slice(start, end).trim() });
  }
  return results;
}

// ============================================================================
// LLM-based Verification
// ============================================================================

async function llmVerify(
  response: string,
  context: string,
  userQuery: string,
): Promise<{
  claimVerifications: any[];
  coherenceIssues: any[];
  citationProblems: any[];
  overallConfidence: number;
  followUpNeeded: boolean;
  followUpQuestion?: string;
  corrections: any[];
  disclaimers: string[];
}> {
  if (!genAI) {
    return {
      claimVerifications: [],
      coherenceIssues: [],
      citationProblems: [],
      overallConfidence: 0.5,
      followUpNeeded: false,
      corrections: [],
      disclaimers: [],
    };
  }

  const prompt = `Eres un verificador de calidad. Analiza esta respuesta contra el contexto proporcionado.

## Consulta del usuario:
${userQuery.slice(0, 500)}

## Respuesta a verificar:
${response.slice(0, 4000)}

## Contexto/Fuentes disponibles:
${context.slice(0, 6000)}

## Tareas de verificación:

Responde en JSON con esta estructura:
{
  "claimVerifications": [
    {
      "claim": "la afirmación extraída",
      "supported": true/false,
      "confidence": 0.0-1.0,
      "issueType": null o "hallucination"|"unsupported"|"partially_supported"|"contradicted"|"outdated",
      "sourceEvidence": "extracto del contexto que soporta/contradice",
      "correction": null o "corrección sugerida"
    }
  ],
  "coherenceIssues": [
    {
      "type": "date_consistency"|"number_consistency"|"name_consistency"|"cross_source_contradiction"|"internal_contradiction"|"logical_consistency",
      "passed": true/false,
      "severity": "critical"|"major"|"minor"|"info",
      "description": "descripción del problema",
      "fix": "corrección sugerida"
    }
  ],
  "citationProblems": [
    {"claim": "afirmación sin citar", "suggestedSource": "fuente sugerida"}
  ],
  "overallConfidence": 0.0-1.0,
  "followUpNeeded": true/false,
  "followUpQuestion": "pregunta si es necesario" o null,
  "corrections": [
    {"original": "texto original", "corrected": "texto corregido", "reason": "razón", "severity": "critical"|"major"|"minor"}
  ],
  "disclaimers": ["advertencia si aplica"]
}

REGLAS:
1. Verifica CADA afirmación factual contra el contexto.
2. Marca como "hallucination" si no hay NINGÚN soporte en el contexto.
3. Detecta inconsistencias numéricas (ej: "5 millones" vs "5 mil").
4. Detecta contradicciones entre fuentes.
5. overallConfidence debe reflejar la calidad general.
6. followUpNeeded = true SOLO si hay un error crítico que impide entregar la respuesta.`;

  try {
    const result = await (genAI as any).models.generateContent({
      model: VERIFIER_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    });

    const rawText = result.text || '{}';
    const parsed = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] || '{}');

    return {
      claimVerifications: Array.isArray(parsed.claimVerifications) ? parsed.claimVerifications : [],
      coherenceIssues: Array.isArray(parsed.coherenceIssues) ? parsed.coherenceIssues : [],
      citationProblems: Array.isArray(parsed.citationProblems) ? parsed.citationProblems : [],
      overallConfidence: typeof parsed.overallConfidence === 'number' ? parsed.overallConfidence : 0.5,
      followUpNeeded: parsed.followUpNeeded === true,
      followUpQuestion: parsed.followUpQuestion || undefined,
      corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
      disclaimers: Array.isArray(parsed.disclaimers) ? parsed.disclaimers : [],
    };
  } catch (error) {
    console.error('[VerifierQA] LLM verification error:', error);
    return {
      claimVerifications: [],
      coherenceIssues: [],
      citationProblems: [],
      overallConfidence: 0.5,
      followUpNeeded: false,
      corrections: [],
      disclaimers: [],
    };
  }
}

// ============================================================================
// Main Verification Function
// ============================================================================

/**
 * Verify a response against the brief, retrieved context, and user query.
 */
export async function verifyResponse(input: VerificationInput): Promise<VerificationResult> {
  return withSpan('verifier.verify', async (span) => {
    const startTime = Date.now();
    span.setAttribute('verifier.response_length', input.response.length);
    span.setAttribute('verifier.context_count', input.retrievedContext.length);

    // 1. Extract claims from response
    const claims = extractClaims(input.response);
    span.setAttribute('verifier.claims_count', claims.length);

    // 2. Build context string for LLM verification
    const contextStr = input.retrievedContext.map(r =>
      `[${r.citation.fileName}${r.citation.pageNumber ? ` p.${r.citation.pageNumber}` : ''}${r.citation.sectionTitle ? ` - ${r.citation.sectionTitle}` : ''}]\n${r.chunk.content}`
    ).join('\n\n---\n\n');

    // 3. Run heuristic checks in parallel with LLM verification
    const [llmResult, heuristicChecks] = await Promise.all([
      llmVerify(input.response, contextStr, input.userQuery),
      runHeuristicChecks(input.response, contextStr, input.retrievedContext),
    ]);

    // 4. Build claim verifications
    const claimVerifications: ClaimVerification[] = llmResult.claimVerifications.map((cv: any) => ({
      claim: cv.claim || '',
      supported: cv.supported !== false,
      supportingSources: cv.sourceEvidence ? [{
        fileName: 'context',
        excerpt: String(cv.sourceEvidence).slice(0, 300),
        chunkId: '',
      }] : [],
      confidence: cv.confidence || 0.5,
      issueType: cv.issueType || undefined,
      correction: cv.correction || undefined,
    }));

    // 5. Build coherence checks
    const coherenceChecks: CoherenceCheck[] = [
      ...heuristicChecks,
      ...llmResult.coherenceIssues.map((ci: any) => ({
        type: ci.type || 'logical_consistency' as const,
        passed: ci.passed !== false,
        severity: ci.severity || 'minor' as const,
        description: ci.description || '',
        locations: [],
        fix: ci.fix || undefined,
      })),
    ];

    // 6. Citation audit
    const citedPattern = /\[(?:Fuente|Source|Ref|Doc)\s*\d+[^\]]*\]/gi;
    const citedMatches = input.response.match(citedPattern) || [];
    const uncitedClaimsList = llmResult.citationProblems.map((cp: any) => cp.claim || '');

    const citationAudit: CitationAudit = {
      totalClaims: claims.length,
      citedClaims: citedMatches.length,
      uncitedClaims: uncitedClaimsList.length,
      coveragePercent: claims.length > 0
        ? Math.round((citedMatches.length / claims.length) * 100)
        : 100,
      incorrectCitations: 0,
      uncitedClaimsList,
    };

    // 7. Compute overall score
    const supportedRate = claimVerifications.length > 0
      ? claimVerifications.filter(c => c.supported).length / claimVerifications.length
      : 0.5;

    const coherenceRate = coherenceChecks.length > 0
      ? coherenceChecks.filter(c => c.passed).length / coherenceChecks.length
      : 1.0;

    const citationRate = citationAudit.coveragePercent / 100;

    const overallConfidence = Math.min(1, (
      supportedRate * 0.4 +
      coherenceRate * 0.3 +
      citationRate * 0.2 +
      llmResult.overallConfidence * 0.1
    ));

    // 8. Grade
    let grade: VerificationResult['grade'];
    if (overallConfidence >= 0.85) grade = 'A';
    else if (overallConfidence >= 0.7) grade = 'B';
    else if (overallConfidence >= 0.5) grade = 'C';
    else if (overallConfidence >= 0.3) grade = 'D';
    else grade = 'F';

    // 9. Critical failures
    const hasCriticalFailure = coherenceChecks.some(c => !c.passed && c.severity === 'critical')
      || claimVerifications.some(c => c.issueType === 'hallucination' && c.confidence > 0.7);

    const passed = !hasCriticalFailure && overallConfidence >= 0.5;

    const processingTimeMs = Date.now() - startTime;
    span.setAttribute('verifier.passed', passed);
    span.setAttribute('verifier.confidence', overallConfidence);
    span.setAttribute('verifier.grade', grade);
    span.setAttribute('verifier.processing_time_ms', processingTimeMs);

    return {
      passed,
      overallConfidence,
      grade,
      claimVerifications,
      coherenceChecks,
      citationAudit,
      needsFollowUp: llmResult.followUpNeeded,
      followUpQuestion: llmResult.followUpQuestion,
      corrections: llmResult.corrections.map((c: any) => ({
        original: c.original || '',
        corrected: c.corrected || '',
        reason: c.reason || '',
        severity: c.severity || 'minor',
      })),
      disclaimers: llmResult.disclaimers,
      metadata: {
        model: VERIFIER_MODEL,
        processingTimeMs,
        checksPerformed: claimVerifications.length + coherenceChecks.length,
      },
    };
  });
}

// ============================================================================
// Heuristic Checks (fast, no LLM)
// ============================================================================

async function runHeuristicChecks(
  response: string,
  context: string,
  retrieved: RetrievedResult[],
): Promise<CoherenceCheck[]> {
  const checks: CoherenceCheck[] = [];

  // 1. Number consistency check
  const responseNumbers = extractNumbers(response);
  const contextNumbers = extractNumbers(context);
  for (const rn of responseNumbers) {
    let foundMatch = false;
    for (const cn of contextNumbers) {
      if (Math.abs(rn.value - cn.value) / (Math.abs(cn.value) || 1) < 0.01) {
        foundMatch = true;
        break;
      }
    }
    if (!foundMatch && contextNumbers.length > 0) {
      checks.push({
        type: 'number_consistency',
        passed: false,
        severity: 'major',
        description: `Número ${rn.value} en la respuesta no se encuentra en el contexto: "${rn.context}"`,
        locations: [rn.context],
        fix: 'Verificar el número contra las fuentes',
      });
    }
  }

  // 2. Date consistency check
  const responseDates = extractDates(response);
  const contextDates = extractDates(context);
  for (const rd of responseDates) {
    let foundMatch = false;
    for (const cd of contextDates) {
      if (cd.raw === rd.raw || cd.raw.includes(rd.raw) || rd.raw.includes(cd.raw)) {
        foundMatch = true;
        break;
      }
    }
    if (!foundMatch && contextDates.length > 0) {
      checks.push({
        type: 'date_consistency',
        passed: false,
        severity: 'minor',
        description: `Fecha "${rd.raw}" en la respuesta no se encuentra en el contexto`,
        locations: [rd.context],
      });
    }
  }

  // 3. Response length check (too short may indicate incomplete answer)
  const wordCount = response.split(/\s+/).length;
  if (wordCount < 30 && context.length > 500) {
    checks.push({
      type: 'logical_consistency',
      passed: false,
      severity: 'minor',
      description: 'La respuesta es muy breve considerando la cantidad de contexto disponible',
      locations: [],
      fix: 'Considerar expandir la respuesta con más detalles del contexto',
    });
  }

  // 4. No context used check
  if (retrieved.length > 0 && !response.match(/\[(?:Fuente|Source|Ref)\s*\d+/i)) {
    checks.push({
      type: 'logical_consistency',
      passed: false,
      severity: 'major',
      description: 'La respuesta no cita ninguna fuente a pesar de tener contexto disponible',
      locations: [],
      fix: 'Agregar citas a las fuentes consultadas',
    });
  }

  return checks;
}

export const verifierQA = {
  verifyResponse,
  extractClaims,
  extractNumbers,
  extractDates,
};
