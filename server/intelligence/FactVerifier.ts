/**
 * FactVerifier
 *
 * Real-time fact-checking during or after response generation.
 *
 * Pipeline:
 *   1. Decompose the response into individual verifiable claims.
 *   2. For each claim, check against:
 *        a. RAG knowledge base (if available)
 *        b. Heuristic / rule-based checks (dates, numbers, common knowledge)
 *        c. LLM cross-check (secondary model verification)
 *   3. Assign a status per claim: verified | uncertain | contradicted
 *   4. Return annotated response with inline confidence markers.
 *
 * Confidence markers (optional inline mode):
 *   ✓  verified with high confidence
 *   ⚠  uncertain or weakly supported
 *   ✗  potentially contradicted
 */

import { randomUUID }   from 'crypto';
import { z }            from 'zod';
import { Logger }       from '../lib/logger';
import { llmGateway }   from '../lib/llmGateway';

// ─── Types ────────────────────────────────────────────────────────────────────

export const ClaimStatusSchema = z.enum(['verified', 'uncertain', 'contradicted', 'unverifiable']);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const VerifiedClaimSchema = z.object({
  id         : z.string(),
  claim      : z.string(),
  status     : ClaimStatusSchema,
  confidence : z.number().min(0).max(1),
  sources    : z.array(z.string()),
  explanation: z.string(),
  position   : z.number().int().nonneg().optional(),
});
export type VerifiedClaim = z.infer<typeof VerifiedClaimSchema>;

export const FactCheckResultSchema = z.object({
  requestId       : z.string(),
  claims          : z.array(VerifiedClaimSchema),
  overallScore    : z.number().min(0).max(1),
  annotatedResponse: z.string().optional(),
  summary         : z.string(),
  durationMs      : z.number().nonneg(),
});
export type FactCheckResult = z.infer<typeof FactCheckResultSchema>;

// ─── Claim decomposer ─────────────────────────────────────────────────────────

interface RawClaim { text: string; position?: number }
interface DecompositionResponse { claims: string[] }

async function decomposeClaims(
  response : string,
  requestId: string,
  model    : string,
): Promise<RawClaim[]> {
  const res = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: `Extract factual claims from the text.  A claim is a statement that can be verified true or false.
Return JSON: {"claims":["claim1","claim2",...]}
Rules:
- Maximum 10 claims.
- One claim per item.
- Skip opinions, preferences, and questions.
- Keep each claim under 100 characters.`,
      },
      { role: 'user', content: response.slice(0, 2000) },
    ],
    { model, requestId, temperature: 0.1, maxTokens: 400 },
  );

  try {
    const match  = res.content.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as DecompositionResponse : null;
    return (parsed?.claims ?? []).map((text, i) => ({ text, position: i }));
  } catch {
    return [];
  }
}

// ─── Heuristic checks ─────────────────────────────────────────────────────────

const FUTURE_YEAR_RE  = /\b(?:202[7-9]|20[3-9]\d|2[1-9]\d{2})\b/;
const OVER_100PCT_RE  = /\b(?:1[0-9]{2}|[2-9]\d{2})\s*%(?!\s*(?:more|increase|growth|boost))/i;
const ALWAYS_NEVER_RE = /\b(?:always|never|everyone|no one|all|none|impossible|guaranteed|certain)\b/i;

function heuristicCheck(claim: string): { status: ClaimStatus; confidence: number; note: string } {
  if (FUTURE_YEAR_RE.test(claim)) {
    return { status: 'uncertain', confidence: 0.4, note: 'Contains a future year that cannot be verified yet' };
  }
  if (OVER_100PCT_RE.test(claim)) {
    return { status: 'uncertain', confidence: 0.5, note: 'Percentage over 100% — verify intent' };
  }
  if (ALWAYS_NEVER_RE.test(claim)) {
    return { status: 'uncertain', confidence: 0.6, note: 'Contains absolute language (always/never/everyone) which is rarely accurate' };
  }
  return { status: 'uncertain', confidence: 0.7, note: 'No heuristic issues detected' };
}

// ─── LLM cross-check ─────────────────────────────────────────────────────────

interface CrossCheckResponse {
  status     : string;
  confidence : number;
  explanation: string;
  sources    : string[];
}

async function llmCrossCheck(
  claim    : string,
  requestId: string,
  model    : string,
): Promise<CrossCheckResponse> {
  const res = await llmGateway.chat(
    [
      {
        role   : 'system',
        content: `You are a fact-checker.  Evaluate whether this claim is factually accurate based on your training data.
Return JSON: {"status":"verified|uncertain|contradicted|unverifiable","confidence":0.0-1.0,"explanation":"...","sources":["optional source names"]}
Be conservative: if you're not sure, use "uncertain". Do not fabricate sources.`,
      },
      { role: 'user', content: `Claim: "${claim}"` },
    ],
    { model, requestId, temperature: 0.1, maxTokens: 200 },
  );

  try {
    const match  = res.content.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as CrossCheckResponse : null;
    if (parsed && ClaimStatusSchema.safeParse(parsed.status).success) {
      return parsed;
    }
  } catch { /* fall through */ }

  return { status: 'uncertain', confidence: 0.5, explanation: 'Could not parse verification response', sources: [] };
}

// ─── Annotation ───────────────────────────────────────────────────────────────

const STATUS_MARKERS: Record<ClaimStatus, string> = {
  verified    : ' ✓',
  uncertain   : ' ⚠',
  contradicted: ' ✗',
  unverifiable: '',
};

function annotateResponse(response: string, claims: VerifiedClaim[]): string {
  let annotated = response;
  // Inject markers after the first occurrence of each claim in the response
  for (const claim of claims.filter(c => c.status !== 'unverifiable')) {
    const marker = STATUS_MARKERS[claim.status];
    if (!marker) continue;
    const idx = annotated.indexOf(claim.claim.slice(0, 40));
    if (idx !== -1) {
      const endOfClaim = idx + claim.claim.length;
      annotated = annotated.slice(0, endOfClaim) + marker + annotated.slice(endOfClaim);
    }
  }
  return annotated;
}

// ─── FactVerifier ─────────────────────────────────────────────────────────────

export interface FactVerifierOptions {
  model?          : string;
  requestId?      : string;
  /** If true, inject inline markers into the response text. */
  annotate?       : boolean;
  /** Skip LLM cross-check (faster, only heuristics). */
  skipLlmCheck?   : boolean;
  /** Parallelism for cross-checking claims. Default 3. */
  concurrency?    : number;
}

export class FactVerifier {
  /**
   * Decompose a response into claims, verify each one, and return results.
   *
   * @param question - The original question (for context)
   * @param response - The LLM response to verify
   * @param opts     - Options
   */
  async verify(
    question: string,
    response: string,
    opts    : FactVerifierOptions = {},
  ): Promise<FactCheckResult> {
    const start      = Date.now();
    const requestId  = opts.requestId  ?? randomUUID();
    const model      = opts.model      ?? 'auto';
    const annotate   = opts.annotate   ?? false;
    const concurrency = opts.concurrency ?? 3;

    // 1. Decompose
    const rawClaims = await decomposeClaims(response, `${requestId}-decomp`, model);

    if (rawClaims.length === 0) {
      Logger.debug('[FactVerifier] no verifiable claims found', { requestId });
      return {
        requestId,
        claims          : [],
        overallScore    : 0.8,
        annotatedResponse: response,
        summary         : 'No verifiable factual claims were identified.',
        durationMs      : Date.now() - start,
      };
    }

    // 2. Verify in batches
    const verified: VerifiedClaim[] = [];

    for (let i = 0; i < rawClaims.length; i += concurrency) {
      const batch = rawClaims.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(async (raw, batchIdx) => {
        const heuristic = heuristicCheck(raw.text);

        let status     = heuristic.status;
        let confidence = heuristic.confidence;
        let explanation = heuristic.note;
        let sources: string[] = [];

        if (!opts.skipLlmCheck) {
          const crossCheck = await llmCrossCheck(
            raw.text, `${requestId}-cc-${i + batchIdx}`, model,
          );
          // Blend heuristic and LLM confidence
          confidence  = crossCheck.confidence * 0.7 + confidence * 0.3;
          status      = crossCheck.status as ClaimStatus;
          explanation = crossCheck.explanation;
          sources     = crossCheck.sources;
        }

        return {
          id         : randomUUID(),
          claim      : raw.text,
          status,
          confidence : Math.round(confidence * 1000) / 1000,
          sources,
          explanation,
          position   : raw.position,
        } satisfies VerifiedClaim;
      }));

      verified.push(...results);
    }

    // 3. Overall score
    const scoreMap: Record<ClaimStatus, number> = {
      verified    : 1.0,
      uncertain   : 0.6,
      contradicted: 0.1,
      unverifiable: 0.7,
    };
    const overallScore = verified.length > 0
      ? verified.reduce((s, c) => s + scoreMap[c.status] * c.confidence, 0) / verified.length
      : 0.8;

    // 4. Summary
    const verCount = verified.filter(c => c.status === 'verified').length;
    const uncCount = verified.filter(c => c.status === 'uncertain').length;
    const conCount = verified.filter(c => c.status === 'contradicted').length;
    const summary  = `Checked ${verified.length} claim(s): ${verCount} verified ✓, ${uncCount} uncertain ⚠, ${conCount} contradicted ✗.`;

    Logger.debug('[FactVerifier] verification complete', {
      requestId, claims: verified.length, overallScore: Math.round(overallScore * 100) / 100,
      durationMs: Date.now() - start,
    });

    return {
      requestId,
      claims           : verified,
      overallScore     : Math.round(overallScore * 1000) / 1000,
      annotatedResponse: annotate ? annotateResponse(response, verified) : undefined,
      summary,
      durationMs       : Date.now() - start,
    };
  }
}

export const factVerifier = new FactVerifier();
