/**
 * LLM-as-a-Judge — Automated Evaluation & Regression Testing
 *
 * Uses a separate LLM to evaluate pipeline quality across dimensions:
 *   1. Brief Quality: Did the understanding agent capture the intent correctly?
 *   2. Retrieval Quality: Were the right documents/chunks retrieved?
 *   3. Response Quality: Is the response accurate, complete, and well-cited?
 *   4. Verification Quality: Did the verifier catch real issues?
 *
 * Supports:
 *   - Single-case evaluation
 *   - Batch regression testing
 *   - A/B comparison between pipeline versions
 *   - Synthetic case generation
 *   - Automated improvement suggestions
 */

import { GoogleGenAI } from '@google/genai';
import { withSpan } from '../../lib/tracing';
import type { PipelineTrace, EvaluationCase } from './pipelineTelemetry';
import { addEvaluationCase } from './pipelineTelemetry';

// ============================================================================
// Configuration
// ============================================================================

const isTestEnv = process.env.NODE_ENV === 'test' || !!process.env.VITEST_WORKER_ID;
const genAI = !isTestEnv && process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const JUDGE_MODEL = process.env.JUDGE_MODEL || 'gemini-2.5-flash';

// ============================================================================
// Types
// ============================================================================

export interface JudgeEvaluation {
  /** Overall score (1-10) */
  overallScore: number;
  /** Dimensional scores */
  dimensions: {
    intentCapture: { score: number; feedback: string };
    completeness: { score: number; feedback: string };
    accuracy: { score: number; feedback: string };
    citationQuality: { score: number; feedback: string };
    coherence: { score: number; feedback: string };
    tone: { score: number; feedback: string };
    efficiency: { score: number; feedback: string };
  };
  /** Strengths */
  strengths: string[];
  /** Weaknesses */
  weaknesses: string[];
  /** Specific improvement suggestions */
  improvements: Array<{
    component: 'understanding' | 'retrieval' | 'generation' | 'verification' | 'chunking' | 'prompt';
    suggestion: string;
    priority: 'high' | 'medium' | 'low';
    expectedImpact: string;
  }>;
  /** Pass/fail for regression */
  passesRegression: boolean;
  /** Comparison with baseline (if provided) */
  comparison?: {
    betterThanBaseline: boolean;
    deltaScore: number;
    changedDimensions: string[];
  };
}

export interface RegressionResult {
  /** Test suite name */
  suiteName: string;
  /** Total cases */
  totalCases: number;
  /** Passed cases */
  passedCases: number;
  /** Failed cases */
  failedCases: number;
  /** Pass rate */
  passRate: number;
  /** Average score */
  avgScore: number;
  /** Score by dimension */
  avgScoreByDimension: Record<string, number>;
  /** Failed case details */
  failures: Array<{
    caseId: string;
    score: number;
    reason: string;
    failedDimensions: string[];
  }>;
  /** Improvement suggestions aggregated */
  topImprovements: Array<{
    component: string;
    suggestion: string;
    frequency: number;
    avgPriority: number;
  }>;
  /** Timestamp */
  completedAt: string;
}

// ============================================================================
// Single Case Evaluation
// ============================================================================

export async function evaluateCase(
  userQuery: string,
  response: string,
  trace: PipelineTrace,
  expectedOutput?: EvaluationCase['expectedOutput'],
): Promise<JudgeEvaluation> {
  return withSpan('llm_judge.evaluate', async (span) => {
    span.setAttribute('judge.query_length', userQuery.length);
    span.setAttribute('judge.response_length', response.length);

    if (!genAI) {
      return createFallbackEvaluation();
    }

    const prompt = buildEvaluationPrompt(userQuery, response, trace, expectedOutput);

    try {
      const result = await (genAI as any).models.generateContent({
        model: JUDGE_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      });

      const rawText = result.text || '{}';
      const parsed = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] || '{}');

      const evaluation = parseJudgeResponse(parsed);
      span.setAttribute('judge.overall_score', evaluation.overallScore);
      span.setAttribute('judge.passes_regression', evaluation.passesRegression);

      return evaluation;
    } catch (error) {
      console.error('[LLMJudge] Evaluation error:', error);
      return createFallbackEvaluation();
    }
  });
}

function buildEvaluationPrompt(
  userQuery: string,
  response: string,
  trace: PipelineTrace,
  expectedOutput?: EvaluationCase['expectedOutput'],
): string {
  const traceInfo = `
- Intent detectado: ${trace.input.intentCategory} (confianza: ${trace.input.intentConfidence})
- Pipeline usado: ${trace.output.pipeline}
- Documentos procesados: ${trace.input.documentCount}
- Imágenes procesadas: ${trace.input.imageCount}
- Chunks recuperados: ${trace.retrieval?.chunksRetrieved || 0}
- Score promedio retrieval: ${trace.retrieval?.avgRelevanceScore?.toFixed(2) || 'N/A'}
- Entidades del grafo: ${trace.retrieval?.graphEntities || 0}
- Grado de verificación: ${trace.quality.verificationGrade || 'N/A'}
- Confianza de verificación: ${trace.quality.verificationConfidence?.toFixed(2) || 'N/A'}
- Cobertura de citas: ${trace.quality.citationCoverage || 0}%
- Alucinaciones detectadas: ${trace.quality.hallucinations}
- Latencia total: ${trace.cost.totalLatencyMs}ms
- Llamadas LLM totales: ${trace.cost.totalLLMCalls}`;

  const expectedInfo = expectedOutput
    ? `\n## Salida esperada:
- Categoría de intent: ${expectedOutput.intentCategory}
- Sub-tareas esperadas: ${expectedOutput.subTaskCount}
- Entidades clave: ${expectedOutput.keyEntities.join(', ')}
- Formato esperado: ${expectedOutput.expectedFormat}
- Citas esperadas: ${expectedOutput.expectedCitations}`
    : '';

  return `Eres un evaluador experto de sistemas de IA. Evalúa la calidad de esta interacción completa.

## Consulta del usuario:
${userQuery.slice(0, 2000)}

## Respuesta del sistema:
${response.slice(0, 4000)}

## Métricas del pipeline:
${traceInfo}
${expectedInfo}

## Evalúa en JSON con esta estructura:
{
  "overallScore": 1-10,
  "dimensions": {
    "intentCapture": {"score": 1-10, "feedback": "..."},
    "completeness": {"score": 1-10, "feedback": "..."},
    "accuracy": {"score": 1-10, "feedback": "..."},
    "citationQuality": {"score": 1-10, "feedback": "..."},
    "coherence": {"score": 1-10, "feedback": "..."},
    "tone": {"score": 1-10, "feedback": "..."},
    "efficiency": {"score": 1-10, "feedback": "..."}
  },
  "strengths": ["fortaleza 1", "fortaleza 2"],
  "weaknesses": ["debilidad 1", "debilidad 2"],
  "improvements": [
    {
      "component": "understanding|retrieval|generation|verification|chunking|prompt",
      "suggestion": "sugerencia específica",
      "priority": "high|medium|low",
      "expectedImpact": "impacto esperado"
    }
  ],
  "passesRegression": true/false
}

CRITERIOS:
1. intentCapture: ¿Se entendió correctamente lo que el usuario pedía?
2. completeness: ¿La respuesta cubre todos los aspectos de la solicitud?
3. accuracy: ¿Los datos/hechos son correctos y están bien citados?
4. citationQuality: ¿Las citas son específicas (doc, página, sección)?
5. coherence: ¿La respuesta es lógicamente consistente?
6. tone: ¿El tono es apropiado para la audiencia?
7. efficiency: ¿Se usaron los recursos de manera eficiente (latencia, tokens)?

passesRegression: true si overallScore >= 6 y no hay dimensión < 4.`;
}

function parseJudgeResponse(parsed: any): JudgeEvaluation {
  const dims = parsed.dimensions || {};
  const parseDim = (d: any) => ({
    score: Math.min(10, Math.max(1, Number(d?.score) || 5)),
    feedback: String(d?.feedback || ''),
  });

  const dimensions = {
    intentCapture: parseDim(dims.intentCapture),
    completeness: parseDim(dims.completeness),
    accuracy: parseDim(dims.accuracy),
    citationQuality: parseDim(dims.citationQuality),
    coherence: parseDim(dims.coherence),
    tone: parseDim(dims.tone),
    efficiency: parseDim(dims.efficiency),
  };

  const overallScore = Math.min(10, Math.max(1, Number(parsed.overallScore) || 5));
  const minDimScore = Math.min(...Object.values(dimensions).map(d => d.score));
  const passesRegression = overallScore >= 6 && minDimScore >= 4;

  return {
    overallScore,
    dimensions,
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
    improvements: (Array.isArray(parsed.improvements) ? parsed.improvements : []).map((imp: any) => ({
      component: imp.component || 'generation',
      suggestion: imp.suggestion || '',
      priority: imp.priority || 'medium',
      expectedImpact: imp.expectedImpact || '',
    })),
    passesRegression,
  };
}

function createFallbackEvaluation(): JudgeEvaluation {
  const defaultDim = { score: 5, feedback: 'Evaluación no disponible (modelo no configurado)' };
  return {
    overallScore: 5,
    dimensions: {
      intentCapture: defaultDim,
      completeness: defaultDim,
      accuracy: defaultDim,
      citationQuality: defaultDim,
      coherence: defaultDim,
      tone: defaultDim,
      efficiency: defaultDim,
    },
    strengths: [],
    weaknesses: ['No se pudo evaluar con LLM'],
    improvements: [],
    passesRegression: true,
  };
}

// ============================================================================
// Batch Regression Testing
// ============================================================================

export async function runRegressionSuite(
  cases: EvaluationCase[],
  responseGenerator: (query: string) => Promise<{ response: string; trace: PipelineTrace }>,
  suiteName: string = 'default',
): Promise<RegressionResult> {
  return withSpan('llm_judge.regression', async (span) => {
    span.setAttribute('judge.suite_name', suiteName);
    span.setAttribute('judge.case_count', cases.length);

    const results: Array<{ caseId: string; evaluation: JudgeEvaluation }> = [];
    const failures: RegressionResult['failures'] = [];

    for (const evalCase of cases) {
      try {
        const { response, trace } = await responseGenerator(evalCase.input.userText);
        const evaluation = await evaluateCase(
          evalCase.input.userText,
          response,
          trace,
          evalCase.expectedOutput,
        );

        results.push({ caseId: evalCase.caseId, evaluation });

        // Update evaluation case with results
        evalCase.judgeScore = evaluation.overallScore;
        evalCase.judgeFeedback = `${evaluation.strengths.join('; ')} | ${evaluation.weaknesses.join('; ')}`;
        evalCase.actualTrace = trace;

        if (!evaluation.passesRegression) {
          const failedDims = Object.entries(evaluation.dimensions)
            .filter(([_, d]) => d.score < 4)
            .map(([name]) => name);
          failures.push({
            caseId: evalCase.caseId,
            score: evaluation.overallScore,
            reason: evaluation.weaknesses[0] || 'Score below threshold',
            failedDimensions: failedDims,
          });
        }
      } catch (error) {
        failures.push({
          caseId: evalCase.caseId,
          score: 0,
          reason: `Error: ${(error as Error).message}`,
          failedDimensions: ['all'],
        });
      }
    }

    // Aggregate dimension scores
    const avgScoreByDimension: Record<string, number> = {};
    const dimNames = ['intentCapture', 'completeness', 'accuracy', 'citationQuality', 'coherence', 'tone', 'efficiency'];
    for (const dimName of dimNames) {
      const scores = results.map(r => (r.evaluation.dimensions as any)[dimName]?.score || 0);
      avgScoreByDimension[dimName] = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;
    }

    // Aggregate improvements
    const improvementCounts = new Map<string, { count: number; priorities: number[]; suggestion: string; component: string }>();
    for (const r of results) {
      for (const imp of r.evaluation.improvements) {
        const key = `${imp.component}:${imp.suggestion.slice(0, 50)}`;
        const existing = improvementCounts.get(key) || {
          count: 0,
          priorities: [],
          suggestion: imp.suggestion,
          component: imp.component,
        };
        existing.count++;
        existing.priorities.push(imp.priority === 'high' ? 3 : imp.priority === 'medium' ? 2 : 1);
        improvementCounts.set(key, existing);
      }
    }

    const topImprovements = Array.from(improvementCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(imp => ({
        component: imp.component,
        suggestion: imp.suggestion,
        frequency: imp.count,
        avgPriority: imp.priorities.reduce((a, b) => a + b, 0) / imp.priorities.length,
      }));

    const avgScore = results.length > 0
      ? results.reduce((s, r) => s + r.evaluation.overallScore, 0) / results.length
      : 0;

    const regressionResult: RegressionResult = {
      suiteName,
      totalCases: cases.length,
      passedCases: results.filter(r => r.evaluation.passesRegression).length,
      failedCases: failures.length,
      passRate: results.length > 0
        ? results.filter(r => r.evaluation.passesRegression).length / results.length
        : 0,
      avgScore,
      avgScoreByDimension,
      failures,
      topImprovements,
      completedAt: new Date().toISOString(),
    };

    span.setAttribute('judge.pass_rate', regressionResult.passRate);
    span.setAttribute('judge.avg_score', regressionResult.avgScore);
    span.setAttribute('judge.failures', regressionResult.failedCases);

    return regressionResult;
  });
}

// ============================================================================
// Synthetic Case Generation
// ============================================================================

export async function generateSyntheticCases(
  count: number = 10,
  categories?: string[],
): Promise<EvaluationCase[]> {
  if (!genAI) return [];

  const targetCategories = categories || [
    'create_document', 'analyze_data', 'answer_question',
    'summarize', 'research', 'compare', 'explain',
  ];

  const prompt = `Genera ${count} casos de prueba sintéticos para evaluar un sistema de IA que procesa solicitudes de usuarios.

Cada caso debe incluir:
1. Una solicitud realista de usuario (en español)
2. La categoría de intent esperada
3. Número de sub-tareas esperadas
4. Entidades clave que deberían detectarse
5. Formato de salida esperado
6. Número de citas esperadas

Categorías a cubrir: ${targetCategories.join(', ')}

Incluye variedad: solicitudes simples, complejas, con documentos, con imágenes, ambiguas.

Responde en JSON:
{
  "cases": [
    {
      "userText": "solicitud del usuario",
      "intentCategory": "categoría",
      "subTaskCount": 3,
      "keyEntities": ["entidad1", "entidad2"],
      "expectedFormat": "text|word|excel|etc",
      "expectedCitations": 5,
      "tags": ["tag1", "tag2"],
      "documents": [],
      "images": []
    }
  ]
}`;

  try {
    const result = await (genAI as any).models.generateContent({
      model: JUDGE_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    });

    const rawText = result.text || '{}';
    const parsed = JSON.parse(rawText.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const rawCases = Array.isArray(parsed.cases) ? parsed.cases : [];

    return rawCases.map((c: any, i: number): EvaluationCase => ({
      caseId: `synthetic-${Date.now()}-${i}`,
      type: 'synthetic',
      input: {
        userText: c.userText || '',
        documents: c.documents || [],
        images: c.images || [],
      },
      expectedOutput: {
        intentCategory: c.intentCategory || 'other',
        subTaskCount: c.subTaskCount || 1,
        keyEntities: c.keyEntities || [],
        expectedFormat: c.expectedFormat || 'text',
        expectedCitations: c.expectedCitations || 0,
      },
      tags: c.tags || ['synthetic'],
      createdAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.error('[LLMJudge] Synthetic generation error:', error);
    return [];
  }
}

export const llmJudge = {
  evaluateCase,
  runRegressionSuite,
  generateSyntheticCases,
};
