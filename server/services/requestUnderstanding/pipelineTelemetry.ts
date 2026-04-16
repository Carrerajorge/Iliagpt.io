/**
 * Pipeline Telemetry & Evaluation System
 *
 * Traces the full lifecycle: Brief → Retrieval → Response → Verification
 *
 * Captures:
 *   - Per-stage latency and token usage
 *   - Task success rates
 *   - Clarification rates
 *   - Citation coverage
 *   - Error rates and types
 *   - Retrieval quality metrics
 *   - User satisfaction signals
 *
 * Stores traces in PostgreSQL for analysis and LLM-as-a-judge evaluation.
 */

import crypto from 'crypto';
import { withSpan } from '../../lib/tracing';
import type { CanonicalBrief } from './briefSchema';
import type { HybridRAGResult } from './hybridRAGEngine';
import type { VerificationResult } from './verifierQA';

// ============================================================================
// Types
// ============================================================================

export interface PipelineTrace {
  /** Unique trace ID */
  traceId: string;
  /** Session/chat ID */
  sessionId?: string;
  /** User ID */
  userId?: string;
  /** Timestamp */
  createdAt: string;

  // Stage Timings
  stages: {
    understanding: StageTrace;
    documentIngestion?: StageTrace;
    imageAnalysis?: StageTrace;
    retrieval?: StageTrace;
    graphBuilding?: StageTrace;
    generation: StageTrace;
    verification?: StageTrace;
  };

  // Input metrics
  input: {
    textLength: number;
    documentCount: number;
    imageCount: number;
    language: string;
    intentCategory: string;
    intentConfidence: number;
  };

  // Output metrics
  output: {
    responseLength: number;
    citationCount: number;
    format: string;
    pipeline: string;
  };

  // Quality metrics
  quality: {
    verificationGrade?: string;
    verificationConfidence?: number;
    citationCoverage?: number;
    claimsSupportedRate?: number;
    coherenceRate?: number;
    hallucinations: number;
    corrections: number;
  };

  // Retrieval metrics
  retrieval?: {
    chunksRetrieved: number;
    avgRelevanceScore: number;
    graphEntities: number;
    graphRelations: number;
    queryExpansionUsed: boolean;
    rerankingUsed: boolean;
  };

  // Cost metrics
  cost: {
    totalLLMCalls: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalLatencyMs: number;
  };

  // Outcome
  outcome: {
    success: boolean;
    needsClarification: boolean;
    errorType?: string;
    errorMessage?: string;
  };
}

export interface StageTrace {
  name: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  llmCalls: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export interface EvaluationCase {
  /** Unique case ID */
  caseId: string;
  /** Type: real (from production) or synthetic (generated) */
  type: 'real' | 'synthetic';
  /** Input */
  input: {
    userText: string;
    documents?: string[];
    images?: string[];
  };
  /** Expected output (for synthetic cases) */
  expectedOutput?: {
    intentCategory: string;
    subTaskCount: number;
    keyEntities: string[];
    expectedFormat: string;
    expectedCitations: number;
  };
  /** Actual trace (from production) */
  actualTrace?: PipelineTrace;
  /** Judge score */
  judgeScore?: number;
  /** Judge feedback */
  judgeFeedback?: string;
  /** Tags for categorization */
  tags: string[];
  /** Created at */
  createdAt: string;
}

export interface EvaluationMetrics {
  /** Time period */
  period: { start: string; end: string };
  /** Total requests processed */
  totalRequests: number;
  /** Task success rate */
  taskSuccessRate: number;
  /** Clarification rate (how often we need to ask) */
  clarificationRate: number;
  /** Average citation coverage */
  avgCitationCoverage: number;
  /** Average verification confidence */
  avgVerificationConfidence: number;
  /** Hallucination rate */
  hallucinationRate: number;
  /** Error rate */
  errorRate: number;
  /** Average latency by stage */
  avgLatencyByStage: Record<string, number>;
  /** Intent distribution */
  intentDistribution: Record<string, number>;
  /** Pipeline distribution */
  pipelineDistribution: Record<string, number>;
  /** Grade distribution */
  gradeDistribution: Record<string, number>;
  /** Average LLM calls per request */
  avgLLMCallsPerRequest: number;
  /** Average tokens per request */
  avgTokensPerRequest: number;
}

// ============================================================================
// In-Memory Trace Store (production would use PostgreSQL)
// ============================================================================

const traceStore: PipelineTrace[] = [];
const evaluationStore: EvaluationCase[] = [];
const MAX_TRACES = 10000;

// ============================================================================
// Trace Recording
// ============================================================================

export function createTrace(sessionId?: string, userId?: string): PipelineTrace {
  return {
    traceId: crypto.randomUUID(),
    sessionId,
    userId,
    createdAt: new Date().toISOString(),
    stages: {
      understanding: createStageTrace('understanding'),
      generation: createStageTrace('generation'),
    },
    input: {
      textLength: 0,
      documentCount: 0,
      imageCount: 0,
      language: 'es',
      intentCategory: 'unknown',
      intentConfidence: 0,
    },
    output: {
      responseLength: 0,
      citationCount: 0,
      format: 'text',
      pipeline: 'chat',
    },
    quality: {
      hallucinations: 0,
      corrections: 0,
    },
    cost: {
      totalLLMCalls: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalLatencyMs: 0,
    },
    outcome: {
      success: false,
      needsClarification: false,
    },
  };
}

function createStageTrace(name: string): StageTrace {
  return {
    name,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    llmCalls: 0,
    success: false,
  };
}

export function recordStageStart(trace: PipelineTrace, stage: keyof PipelineTrace['stages']): void {
  const stageTrace = trace.stages[stage];
  if (stageTrace) {
    stageTrace.startedAt = new Date().toISOString();
  } else {
    (trace.stages as any)[stage] = createStageTrace(stage);
  }
}

export function recordStageComplete(
  trace: PipelineTrace,
  stage: keyof PipelineTrace['stages'],
  metadata?: {
    tokensIn?: number;
    tokensOut?: number;
    llmCalls?: number;
    error?: string;
    metadata?: Record<string, any>;
  },
): void {
  const stageTrace = (trace.stages as any)[stage] as StageTrace | undefined;
  if (!stageTrace) return;

  stageTrace.completedAt = new Date().toISOString();
  stageTrace.durationMs = new Date(stageTrace.completedAt).getTime() - new Date(stageTrace.startedAt).getTime();
  stageTrace.success = !metadata?.error;

  if (metadata) {
    if (metadata.tokensIn) stageTrace.tokensIn = metadata.tokensIn;
    if (metadata.tokensOut) stageTrace.tokensOut = metadata.tokensOut;
    if (metadata.llmCalls) stageTrace.llmCalls = metadata.llmCalls;
    if (metadata.error) stageTrace.error = metadata.error;
    if (metadata.metadata) stageTrace.metadata = metadata.metadata;

    // Update cost totals
    trace.cost.totalTokensIn += metadata.tokensIn || 0;
    trace.cost.totalTokensOut += metadata.tokensOut || 0;
    trace.cost.totalLLMCalls += metadata.llmCalls || 0;
  }
}

export function recordBriefMetrics(trace: PipelineTrace, brief: CanonicalBrief): void {
  trace.input.textLength = brief.rawInputFingerprint.textLength;
  trace.input.documentCount = brief.rawInputFingerprint.documentCount;
  trace.input.imageCount = brief.rawInputFingerprint.imageCount;
  trace.input.language = brief.rawInputFingerprint.languageDetected;
  trace.input.intentCategory = brief.intentCategory;
  trace.input.intentConfidence = brief.intentConfidence;
  trace.output.format = brief.deliverable.format;
  trace.output.pipeline = brief.routingHints.suggestedPipeline;
}

export function recordRetrievalMetrics(trace: PipelineTrace, ragResult: HybridRAGResult): void {
  trace.retrieval = {
    chunksRetrieved: ragResult.results.length,
    avgRelevanceScore: ragResult.results.length > 0
      ? ragResult.results.reduce((s, r) => s + r.score, 0) / ragResult.results.length
      : 0,
    graphEntities: ragResult.graphContext?.entities.length || 0,
    graphRelations: ragResult.graphContext?.relations.length || 0,
    queryExpansionUsed: !!ragResult.queryExpansion,
    rerankingUsed: ragResult.stats.afterReranking < ragResult.stats.afterFusion,
  };
}

export function recordVerificationMetrics(trace: PipelineTrace, verification: VerificationResult): void {
  trace.quality.verificationGrade = verification.grade;
  trace.quality.verificationConfidence = verification.overallConfidence;
  trace.quality.citationCoverage = verification.citationAudit.coveragePercent;
  trace.quality.claimsSupportedRate = verification.claimVerifications.length > 0
    ? verification.claimVerifications.filter(c => c.supported).length / verification.claimVerifications.length
    : 1;
  trace.quality.coherenceRate = verification.coherenceChecks.length > 0
    ? verification.coherenceChecks.filter(c => c.passed).length / verification.coherenceChecks.length
    : 1;
  trace.quality.hallucinations = verification.claimVerifications.filter(c => c.issueType === 'hallucination').length;
  trace.quality.corrections = verification.corrections.length;
}

export function recordOutcome(
  trace: PipelineTrace,
  success: boolean,
  needsClarification: boolean,
  responseLength: number,
  citationCount: number,
  error?: string,
): void {
  trace.outcome.success = success;
  trace.outcome.needsClarification = needsClarification;
  trace.output.responseLength = responseLength;
  trace.output.citationCount = citationCount;
  trace.cost.totalLatencyMs = Object.values(trace.stages)
    .filter(Boolean)
    .reduce((s, stage) => s + (stage?.durationMs || 0), 0);

  if (error) {
    trace.outcome.errorType = error.split(':')[0] || 'unknown';
    trace.outcome.errorMessage = error;
  }
}

export function saveTrace(trace: PipelineTrace): void {
  traceStore.push(trace);
  if (traceStore.length > MAX_TRACES) {
    traceStore.shift(); // Remove oldest
  }
}

// ============================================================================
// Metrics Computation
// ============================================================================

export function computeMetrics(periodHours: number = 24): EvaluationMetrics {
  const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000).toISOString();
  const recentTraces = traceStore.filter(t => t.createdAt >= cutoff);

  const total = recentTraces.length || 1;
  const successful = recentTraces.filter(t => t.outcome.success).length;
  const clarifications = recentTraces.filter(t => t.outcome.needsClarification).length;
  const errors = recentTraces.filter(t => !!t.outcome.errorType).length;

  // Compute averages
  const avgCitation = recentTraces.reduce((s, t) => s + (t.quality.citationCoverage || 0), 0) / total;
  const avgVerification = recentTraces.reduce((s, t) => s + (t.quality.verificationConfidence || 0), 0) / total;
  const hallucinations = recentTraces.reduce((s, t) => s + t.quality.hallucinations, 0);

  // Stage latencies
  const stageLatencies: Record<string, number[]> = {};
  for (const trace of recentTraces) {
    for (const [name, stage] of Object.entries(trace.stages)) {
      if (stage && stage.durationMs > 0) {
        if (!stageLatencies[name]) stageLatencies[name] = [];
        stageLatencies[name].push(stage.durationMs);
      }
    }
  }
  const avgLatencyByStage: Record<string, number> = {};
  for (const [name, latencies] of Object.entries(stageLatencies)) {
    avgLatencyByStage[name] = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  }

  // Distributions
  const intentDist: Record<string, number> = {};
  const pipelineDist: Record<string, number> = {};
  const gradeDist: Record<string, number> = {};
  for (const trace of recentTraces) {
    intentDist[trace.input.intentCategory] = (intentDist[trace.input.intentCategory] || 0) + 1;
    pipelineDist[trace.output.pipeline] = (pipelineDist[trace.output.pipeline] || 0) + 1;
    if (trace.quality.verificationGrade) {
      gradeDist[trace.quality.verificationGrade] = (gradeDist[trace.quality.verificationGrade] || 0) + 1;
    }
  }

  return {
    period: {
      start: cutoff,
      end: new Date().toISOString(),
    },
    totalRequests: recentTraces.length,
    taskSuccessRate: successful / total,
    clarificationRate: clarifications / total,
    avgCitationCoverage: avgCitation,
    avgVerificationConfidence: avgVerification,
    hallucinationRate: hallucinations / total,
    errorRate: errors / total,
    avgLatencyByStage,
    intentDistribution: intentDist,
    pipelineDistribution: pipelineDist,
    gradeDistribution: gradeDist,
    avgLLMCallsPerRequest: recentTraces.reduce((s, t) => s + t.cost.totalLLMCalls, 0) / total,
    avgTokensPerRequest: recentTraces.reduce((s, t) => s + t.cost.totalTokensIn + t.cost.totalTokensOut, 0) / total,
  };
}

// ============================================================================
// Evaluation Case Management
// ============================================================================

export function addEvaluationCase(evalCase: EvaluationCase): void {
  evaluationStore.push(evalCase);
}

export function getEvaluationCases(
  filter?: { type?: string; tags?: string[]; minScore?: number },
): EvaluationCase[] {
  let cases = [...evaluationStore];
  if (filter?.type) cases = cases.filter(c => c.type === filter.type);
  if (filter?.tags) cases = cases.filter(c => filter.tags!.some(t => c.tags.includes(t)));
  if (filter?.minScore !== undefined) cases = cases.filter(c => (c.judgeScore || 0) >= filter.minScore!);
  return cases;
}

export function getTraces(limit: number = 100): PipelineTrace[] {
  return traceStore.slice(-limit);
}

export const pipelineTelemetry = {
  createTrace,
  recordStageStart,
  recordStageComplete,
  recordBriefMetrics,
  recordRetrievalMetrics,
  recordVerificationMetrics,
  recordOutcome,
  saveTrace,
  computeMetrics,
  addEvaluationCase,
  getEvaluationCases,
  getTraces,
};
