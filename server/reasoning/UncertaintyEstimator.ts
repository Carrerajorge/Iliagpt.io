/**
 * UncertaintyEstimator — Batch 1 Reasoning
 *
 * REAL uncertainty quantification — replaces the hardcoded 0.85 stub.
 *
 * Three methods (auto-selected by available resources):
 *  1. Claim decomposition: breaks response into individual factual claims
 *     and estimates per-claim confidence using an LLM critic
 *  2. Temperature sampling: generate N variants at elevated temp,
 *     measure semantic variance across outputs
 *  3. Linguistic hedge analysis: detects hedging/confidence language
 *     as a fast fallback when API budget is constrained
 *
 * Calibration tracking: stores predicted vs observed confidence for
 * improving future estimates.
 */

import { createLogger } from "../utils/logger";
import { llmGateway } from "../lib/llmGateway";

const log = createLogger("UncertaintyEstimator");

// ─── Types ────────────────────────────────────────────────────────────────────

export type EstimationMethod = "claim_decomposition" | "temperature_sampling" | "linguistic_hedge";

export interface ClaimConfidence {
  claim: string;
  confidence: number;       // 0–1
  hedgeLevel: "none" | "low" | "medium" | "high";
  supportedByContext: boolean;
}

export interface UncertaintyEstimate {
  overallConfidence: number;         // 0–1
  method: EstimationMethod;
  perClaimBreakdown: ClaimConfidence[];
  confidenceLabel: string;           // user-facing: "I'm confident" | "I think" | "I'm not sure"
  lowConfidenceClaims: string[];     // claims with confidence < 0.5
  estimationMs: number;
  calibrationId?: string;            // for tracking calibration
}

export interface CalibrationRecord {
  id: string;
  predictedConfidence: number;
  observedAccuracy?: number;   // filled in later when ground truth is known
  method: EstimationMethod;
  timestamp: number;
}

export interface EstimatorConfig {
  method: EstimationMethod | "auto";
  samplingVariants: number;          // for temperature_sampling (2–5)
  samplingTemperature: number;       // elevated temperature for sampling
  claimConfidenceThreshold: number;  // below this → claim is "low confidence"
  fastMode: boolean;                 // if true, always use linguistic_hedge
  model: string;
}

// ─── Hedge Word Analysis ──────────────────────────────────────────────────────

interface HedgePattern {
  level: "low" | "medium" | "high";
  patterns: RegExp[];
}

const HEDGE_PATTERNS: HedgePattern[] = [
  {
    level: "high",
    patterns: [
      /\b(I'm not sure|I don't know|I'm uncertain|unclear|hard to say|difficult to determine)\b/i,
      /\b(may or may not|could be wrong|not confident|might be incorrect)\b/i,
      /\b(speculation|speculative|guess|possibly incorrect)\b/i,
    ],
  },
  {
    level: "medium",
    patterns: [
      /\b(I think|I believe|I suspect|I assume|probably|likely|possibly|perhaps|maybe)\b/i,
      /\b(it seems|it appears|it looks like|as far as I know|to my knowledge)\b/i,
      /\b(generally|typically|usually|often|in most cases)\b/i,
    ],
  },
  {
    level: "low",
    patterns: [
      /\b(approximately|roughly|around|about|nearly|almost)\b/i,
      /\b(tend to|tends to|can sometimes|sometimes|occasionally)\b/i,
    ],
  },
];

const CONFIDENCE_PATTERNS: RegExp[] = [
  /\b(definitely|certainly|absolutely|clearly|obviously|undoubtedly)\b/i,
  /\b(I'm confident|I'm sure|without a doubt|it is a fact)\b/i,
];

function analyzeHedges(text: string): {
  overallConfidence: number;
  perSentence: Array<{ text: string; hedgeLevel: "none" | "low" | "medium" | "high" }>;
} {
  const sentences = text.split(/[.!?]\s+/).filter(s => s.trim().length > 10);
  let totalPenalty = 0;

  const perSentence = sentences.map(sentence => {
    let hedgeLevel: "none" | "low" | "medium" | "high" = "none";

    for (const hp of HEDGE_PATTERNS) {
      for (const pat of hp.patterns) {
        if (pat.test(sentence)) {
          hedgeLevel = hp.level;
          break;
        }
      }
      if (hedgeLevel !== "none") break;
    }

    const confidenceBoost = CONFIDENCE_PATTERNS.some(p => p.test(sentence));

    const penaltyMap = { none: 0, low: 0.05, medium: 0.15, high: 0.35 };
    const boost = confidenceBoost ? 0.05 : 0;
    totalPenalty += penaltyMap[hedgeLevel] - boost;

    return { text: sentence.slice(0, 100), hedgeLevel };
  });

  const avgPenalty = sentences.length > 0 ? totalPenalty / sentences.length : 0;
  const overallConfidence = Math.max(0.3, Math.min(0.97, 0.88 - avgPenalty));

  return { overallConfidence, perSentence };
}

// ─── Claim Decomposition ──────────────────────────────────────────────────────

const CLAIM_DECOMP_SYSTEM = `You are a factual claim extractor and confidence estimator.
Given a response text, extract individual factual claims and estimate confidence for each.
Return JSON array with objects: { "claim": string, "confidence": 0-1, "hedgeLevel": "none"|"low"|"medium"|"high" }
Extract 3-8 most important claims. Return ONLY the JSON array.`;

async function decomposeClaims(
  response: string,
  model: string,
  contextSnippets: string[] = [],
): Promise<ClaimConfidence[]> {
  const contextHint = contextSnippets.length > 0
    ? `\n\nContext provided: ${contextSnippets.join(" ").slice(0, 500)}`
    : "";

  const result = await llmGateway.chat(
    [
      { role: "system", content: CLAIM_DECOMP_SYSTEM },
      {
        role: "user",
        content: `Response to analyze:\n${response.slice(0, 2000)}${contextHint}`,
      },
    ],
    { model, temperature: 0.1, timeout: 20_000 },
  );

  try {
    const parsed = JSON.parse(result.content.trim());
    if (!Array.isArray(parsed)) return [];

    return parsed.map(item => ({
      claim: String(item.claim ?? ""),
      confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.7)),
      hedgeLevel: (["none", "low", "medium", "high"].includes(item.hedgeLevel)
        ? item.hedgeLevel
        : "none") as ClaimConfidence["hedgeLevel"],
      supportedByContext: contextSnippets.length > 0
        ? contextSnippets.some(c => c.toLowerCase().includes(String(item.claim ?? "").toLowerCase().slice(0, 20)))
        : false,
    }));
  } catch {
    log.warn("claim_decomp_parse_failed", { rawLength: result.content.length });
    return [];
  }
}

// ─── Temperature Sampling ─────────────────────────────────────────────────────

/**
 * Generates N response variants at elevated temperature and measures
 * how similar they are. High similarity → high confidence.
 */
async function sampleVariants(
  prompt: string,
  systemPrompt: string,
  nVariants: number,
  temperature: number,
  model: string,
): Promise<number> {
  const variants: string[] = [];

  // Generate variants in parallel (capped at 3 to limit cost)
  const n = Math.min(nVariants, 3);
  const promises = Array.from({ length: n }, () =>
    llmGateway.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      { model, temperature, timeout: 15_000 },
    ).then(r => r.content).catch(() => ""),
  );

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) variants.push(r.value);
  }

  if (variants.length < 2) return 0.7; // fallback

  // Measure vocabulary overlap as a proxy for semantic similarity
  const tokenSets = variants.map(v =>
    new Set(v.toLowerCase().split(/\W+/).filter(w => w.length > 4)),
  );

  let totalJaccard = 0;
  let pairCount = 0;
  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      const intersection = new Set([...tokenSets[i]].filter(t => tokenSets[j].has(t)));
      const union = new Set([...tokenSets[i], ...tokenSets[j]]);
      totalJaccard += intersection.size / Math.max(union.size, 1);
      pairCount++;
    }
  }

  const avgSimilarity = pairCount > 0 ? totalJaccard / pairCount : 0.5;
  // Map similarity [0,1] to confidence [0.4, 0.97]
  return 0.4 + avgSimilarity * 0.57;
}

// ─── Calibration Store ────────────────────────────────────────────────────────

const calibrationStore: CalibrationRecord[] = [];

// ─── UncertaintyEstimator ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: EstimatorConfig = {
  method: "auto",
  samplingVariants: 3,
  samplingTemperature: 0.8,
  claimConfidenceThreshold: 0.5,
  fastMode: false,
  model: "gemini-2.5-flash",
};

export class UncertaintyEstimator {
  private config: EstimatorConfig;

  constructor(config: Partial<EstimatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async estimate(
    response: string,
    originalPrompt?: string,
    contextSnippets?: string[],
  ): Promise<UncertaintyEstimate> {
    const t0 = Date.now();

    let method: EstimationMethod;
    if (this.config.fastMode || this.config.method === "linguistic_hedge") {
      method = "linguistic_hedge";
    } else if (this.config.method === "auto") {
      method = response.length > 300 ? "claim_decomposition" : "linguistic_hedge";
    } else {
      method = this.config.method;
    }

    let overallConfidence: number;
    let perClaimBreakdown: ClaimConfidence[] = [];

    log.debug("uncertainty_estimation_started", { method, responseLength: response.length });

    if (method === "claim_decomposition") {
      perClaimBreakdown = await decomposeClaims(
        response,
        this.config.model,
        contextSnippets,
      );

      if (perClaimBreakdown.length > 0) {
        overallConfidence =
          perClaimBreakdown.reduce((s, c) => s + c.confidence, 0) / perClaimBreakdown.length;
      } else {
        // Fall back to linguistic analysis if decomposition failed
        method = "linguistic_hedge";
        const hedge = analyzeHedges(response);
        overallConfidence = hedge.overallConfidence;
        perClaimBreakdown = hedge.perSentence.map(s => ({
          claim: s.text,
          confidence: s.hedgeLevel === "none" ? 0.85 : s.hedgeLevel === "low" ? 0.75 : s.hedgeLevel === "medium" ? 0.55 : 0.35,
          hedgeLevel: s.hedgeLevel,
          supportedByContext: false,
        }));
      }
    } else if (method === "temperature_sampling" && originalPrompt) {
      overallConfidence = await sampleVariants(
        originalPrompt,
        "Answer concisely.",
        this.config.samplingVariants,
        this.config.samplingTemperature,
        this.config.model,
      );
    } else {
      // Linguistic hedge analysis (fast, no extra LLM calls)
      const hedge = analyzeHedges(response);
      overallConfidence = hedge.overallConfidence;
      perClaimBreakdown = hedge.perSentence.map(s => ({
        claim: s.text,
        confidence: s.hedgeLevel === "none" ? 0.85 : s.hedgeLevel === "low" ? 0.75 : s.hedgeLevel === "medium" ? 0.55 : 0.35,
        hedgeLevel: s.hedgeLevel,
        supportedByContext: false,
      }));
    }

    const clamped = Math.max(0.1, Math.min(0.99, overallConfidence));

    // User-facing label
    let confidenceLabel: string;
    if (clamped >= 0.85) confidenceLabel = "I'm confident";
    else if (clamped >= 0.65) confidenceLabel = "I believe";
    else if (clamped >= 0.45) confidenceLabel = "I think";
    else confidenceLabel = "I'm not sure, but";

    const lowConfidenceClaims = perClaimBreakdown
      .filter(c => c.confidence < this.config.claimConfidenceThreshold)
      .map(c => c.claim);

    // Register calibration record
    const calibrationId = `cal-${Date.now()}`;
    calibrationStore.push({
      id: calibrationId,
      predictedConfidence: clamped,
      method,
      timestamp: Date.now(),
    });

    const estimate: UncertaintyEstimate = {
      overallConfidence: Math.round(clamped * 1000) / 1000,
      method,
      perClaimBreakdown,
      confidenceLabel,
      lowConfidenceClaims: lowConfidenceClaims.slice(0, 3),
      estimationMs: Date.now() - t0,
      calibrationId,
    };

    log.info("uncertainty_estimated", {
      overallConfidence: estimate.overallConfidence,
      confidenceLabel,
      method,
      lowConfidenceClaimCount: lowConfidenceClaims.length,
      estimationMs: estimate.estimationMs,
    });

    return estimate;
  }

  /**
   * Record observed accuracy for a previous estimate to track calibration.
   * Call this when you receive user feedback ("was this accurate?").
   */
  recordObservedAccuracy(calibrationId: string, observedAccuracy: number): void {
    const record = calibrationStore.find(r => r.id === calibrationId);
    if (record) {
      record.observedAccuracy = Math.max(0, Math.min(1, observedAccuracy));
      log.debug("calibration_updated", { calibrationId, observedAccuracy });
    }
  }

  /** Calculate calibration error (mean absolute error across all observed records) */
  getCalibrationError(): number | null {
    const observed = calibrationStore.filter(r => r.observedAccuracy !== undefined);
    if (observed.length === 0) return null;

    const mae =
      observed.reduce((s, r) => s + Math.abs(r.predictedConfidence - (r.observedAccuracy ?? 0)), 0) /
      observed.length;

    return Math.round(mae * 1000) / 1000;
  }
}

export const uncertaintyEstimator = new UncertaintyEstimator();
