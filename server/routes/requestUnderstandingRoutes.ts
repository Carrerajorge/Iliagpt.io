/**
 * Request Understanding API Routes
 *
 * Exposes the Request Understanding Pipeline as REST endpoints
 * for debugging, testing, evaluation, and integration.
 */

import { Router, type Request, type Response } from 'express';
import {
  processRequestGating,
  verifyAndFinalize,
  computeMetrics,
  getTraces,
  getEvaluationCases,
  generateSyntheticCases,
  evaluateCase,
  getBriefJsonSchema,
  type GatingInput,
} from '../services/requestUnderstanding';

const router = Router();

/**
 * POST /api/understanding/analyze
 * Main endpoint: process a text request through the understanding pipeline.
 * Returns the canonical brief + routing hints.
 */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { userText, conversationHistory, chatId } = req.body;

    if (!userText || typeof userText !== 'string') {
      return res.status(400).json({ error: 'userText is required' });
    }

    const input: GatingInput = {
      userText,
      conversationHistory: conversationHistory || [],
      userId: (req as any).user?.id || 'anonymous',
      chatId: chatId || undefined,
    };

    const result = await processRequestGating(input);

    res.json({
      brief: result.brief,
      needsClarification: result.needsClarification,
      suggestedPipeline: result.suggestedPipeline,
      documentCount: result.documents.length,
      imageCount: result.imageAnalyses.length,
      chunkCount: result.chunks.length,
      hasGraph: !!result.knowledgeGraph,
      ragResultCount: result.ragResults?.results.length || 0,
      processingTimeMs: result.totalProcessingTimeMs,
      traceId: result.trace.traceId,
    });
  } catch (error) {
    console.error('[RequestUnderstanding] Analyze error:', error);
    res.status(500).json({
      error: 'Failed to analyze request',
      message: (error as Error).message,
    });
  }
});

/**
 * POST /api/understanding/verify
 * Verify a generated response against the brief and context.
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { response, userQuery, traceId } = req.body;

    if (!response || !userQuery) {
      return res.status(400).json({ error: 'response and userQuery are required' });
    }

    // Find the trace (simplified — in production this would query DB)
    const traces = getTraces(100);
    const trace = traces.find(t => t.traceId === traceId);
    if (!trace) {
      return res.status(404).json({ error: 'Trace not found' });
    }

    // Create a minimal gating result for verification
    const gatingResult = {
      brief: {} as any,
      needsClarification: false,
      documents: [],
      imageAnalyses: [],
      chunks: [],
      trace,
      suggestedPipeline: 'chat' as const,
      totalProcessingTimeMs: 0,
    };

    const { verification } = await verifyAndFinalize(gatingResult, response, userQuery);

    res.json({
      passed: verification.passed,
      grade: verification.grade,
      confidence: verification.overallConfidence,
      claims: verification.claimVerifications.length,
      supportedClaims: verification.claimVerifications.filter(c => c.supported).length,
      coherenceIssues: verification.coherenceChecks.filter(c => !c.passed).length,
      citationCoverage: verification.citationAudit.coveragePercent,
      corrections: verification.corrections.length,
      disclaimers: verification.disclaimers,
      needsFollowUp: verification.needsFollowUp,
      followUpQuestion: verification.followUpQuestion,
    });
  } catch (error) {
    console.error('[RequestUnderstanding] Verify error:', error);
    res.status(500).json({
      error: 'Failed to verify response',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/understanding/metrics
 * Get pipeline evaluation metrics for the last N hours.
 */
router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const hours = parseInt(_req.query.hours as string) || 24;
    const metrics = computeMetrics(hours);
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to compute metrics' });
  }
});

/**
 * GET /api/understanding/traces
 * Get recent pipeline traces for debugging.
 */
router.get('/traces', async (_req: Request, res: Response) => {
  try {
    const limit = parseInt(_req.query.limit as string) || 50;
    const traces = getTraces(limit);
    res.json({
      total: traces.length,
      traces: traces.map(t => ({
        traceId: t.traceId,
        createdAt: t.createdAt,
        intentCategory: t.input.intentCategory,
        pipeline: t.output.pipeline,
        success: t.outcome.success,
        grade: t.quality.verificationGrade,
        confidence: t.quality.verificationConfidence,
        latencyMs: t.cost.totalLatencyMs,
        llmCalls: t.cost.totalLLMCalls,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get traces' });
  }
});

/**
 * GET /api/understanding/schema
 * Get the JSON Schema for the canonical brief (for integration/docs).
 */
router.get('/schema', (_req: Request, res: Response) => {
  res.json({
    version: '2.0',
    schema: getBriefJsonSchema(),
  });
});

/**
 * POST /api/understanding/evaluate
 * Run LLM-as-a-judge on a specific case.
 */
router.post('/evaluate', async (req: Request, res: Response) => {
  try {
    const { userQuery, response, traceId } = req.body;

    if (!userQuery || !response) {
      return res.status(400).json({ error: 'userQuery and response are required' });
    }

    const traces = getTraces(100);
    const trace = traces.find(t => t.traceId === traceId);
    if (!trace) {
      return res.status(404).json({ error: 'Trace not found' });
    }

    const evaluation = await evaluateCase(userQuery, response, trace);

    res.json({
      overallScore: evaluation.overallScore,
      passesRegression: evaluation.passesRegression,
      dimensions: evaluation.dimensions,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses,
      improvements: evaluation.improvements,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to evaluate case' });
  }
});

/**
 * POST /api/understanding/synthetic-cases
 * Generate synthetic test cases for evaluation.
 */
router.post('/synthetic-cases', async (req: Request, res: Response) => {
  try {
    const { count = 10, categories } = req.body;
    const cases = await generateSyntheticCases(count, categories);
    res.json({ generated: cases.length, cases });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate synthetic cases' });
  }
});

/**
 * GET /api/understanding/evaluation-cases
 * Get stored evaluation cases.
 */
router.get('/evaluation-cases', async (_req: Request, res: Response) => {
  try {
    const type = _req.query.type as string;
    const tags = _req.query.tags ? ((_req.query.tags as string).split(',')) : undefined;
    const cases = getEvaluationCases({ type, tags });
    res.json({ total: cases.length, cases });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get evaluation cases' });
  }
});

export default router;
