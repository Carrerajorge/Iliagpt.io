/**
 * RAG Evaluation Harness
 *
 * Measures retrieval quality:
 *   - Recall@K, Precision@K, Hit Rate, MRR, NDCG
 *   - Latency tracking
 *   - Golden chat regression testing
 *   - Tracing / observability integration
 */

import { db } from "../../db";
import { ragEvalResults, type InsertRagEvalResult, ragAuditLog } from "@shared/schema/rag";
import { eq, and, desc, gte, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoldenTestCase {
    id: string;
    query: string;
    expectedChunkIds: string[];    // ground-truth relevant chunks
    expectedAnswer?: string;       // optional reference answer
    tags?: string[];
    metadata?: Record<string, unknown>;
}

export interface RetrievalTrace {
    query: string;
    rewrittenQuery?: string;
    retrievedChunkIds: string[];
    scores: number[];
    latencyMs: number;
    totalCandidates: number;
    config: Record<string, unknown>;
}

export interface EvalMetrics {
    recallAtK: number;
    precisionAtK: number;
    hitRate: number;             // 1 if any relevant doc in top-K, else 0
    mrr: number;                // Mean Reciprocal Rank
    ndcg: number;               // Normalized Discounted Cumulative Gain
    latencyMs: number;
}

export interface EvalRunSummary {
    runId: string;
    totalCases: number;
    avgRecallAtK: number;
    avgPrecisionAtK: number;
    avgHitRate: number;
    avgMRR: number;
    avgNDCG: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    failedCases: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Metric computation
// ---------------------------------------------------------------------------

export function computeMetrics(
    expectedIds: string[],
    retrievedIds: string[],
    latencyMs: number,
    k?: number,
): EvalMetrics {
    const effectiveK = k ?? retrievedIds.length;
    const topK = retrievedIds.slice(0, effectiveK);
    const expectedSet = new Set(expectedIds);

    // Recall@K = |relevant ∩ retrieved| / |relevant|
    const relevantRetrieved = topK.filter((id) => expectedSet.has(id)).length;
    const recallAtK = expectedIds.length > 0 ? relevantRetrieved / expectedIds.length : 0;

    // Precision@K = |relevant ∩ retrieved| / K
    const precisionAtK = topK.length > 0 ? relevantRetrieved / topK.length : 0;

    // Hit Rate = 1 if any relevant in top-K
    const hitRate = relevantRetrieved > 0 ? 1 : 0;

    // MRR = 1 / rank of first relevant
    let mrr = 0;
    for (let i = 0; i < topK.length; i++) {
        if (expectedSet.has(topK[i])) {
            mrr = 1 / (i + 1);
            break;
        }
    }

    // NDCG
    const ndcg = computeNDCG(expectedIds, topK);

    return { recallAtK, precisionAtK, hitRate, mrr, ndcg, latencyMs };
}

function computeNDCG(expectedIds: string[], retrievedIds: string[]): number {
    const expectedSet = new Set(expectedIds);

    // DCG
    let dcg = 0;
    for (let i = 0; i < retrievedIds.length; i++) {
        const relevance = expectedSet.has(retrievedIds[i]) ? 1 : 0;
        dcg += relevance / Math.log2(i + 2); // +2 because i is 0-indexed
    }

    // Ideal DCG (all relevant docs at top)
    let idcg = 0;
    const idealLen = Math.min(expectedIds.length, retrievedIds.length);
    for (let i = 0; i < idealLen; i++) {
        idcg += 1 / Math.log2(i + 2);
    }

    return idcg > 0 ? dcg / idcg : 0;
}

// ---------------------------------------------------------------------------
// Run evaluation against golden test cases
// ---------------------------------------------------------------------------

export async function runEvaluation(
    runId: string,
    testCases: GoldenTestCase[],
    retriever: (query: string) => Promise<RetrievalTrace>,
    k: number = 5,
): Promise<EvalRunSummary> {
    const results: Array<EvalMetrics & { testCaseId: string }> = [];
    const failedCases: string[] = [];
    const latencies: number[] = [];

    for (const testCase of testCases) {
        try {
            const trace = await retriever(testCase.query);
            const metrics = computeMetrics(
                testCase.expectedChunkIds,
                trace.retrievedChunkIds,
                trace.latencyMs,
                k,
            );

            latencies.push(trace.latencyMs);

            // Persist result
            await db.insert(ragEvalResults).values({
                runId,
                testCaseId: testCase.id,
                query: testCase.query,
                expectedChunkIds: testCase.expectedChunkIds,
                retrievedChunkIds: trace.retrievedChunkIds,
                recallAtK: metrics.recallAtK,
                precisionAtK: metrics.precisionAtK,
                mrr: metrics.mrr,
                ndcg: metrics.ndcg,
                hitRate: metrics.hitRate,
                latencyMs: trace.latencyMs,
                k,
                retrievalConfig: trace.config,
                metadata: testCase.metadata ?? {},
            });

            results.push({ ...metrics, testCaseId: testCase.id });
        } catch (error) {
            console.error(`[EvalHarness] Test case ${testCase.id} failed:`, error);
            failedCases.push(testCase.id);
        }
    }

    // Compute aggregates
    const count = results.length || 1;
    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1);
    const percentile = (arr: number[], p: number) => {
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, idx)] ?? 0;
    };

    return {
        runId,
        totalCases: testCases.length,
        avgRecallAtK: avg(results.map((r) => r.recallAtK)),
        avgPrecisionAtK: avg(results.map((r) => r.precisionAtK)),
        avgHitRate: avg(results.map((r) => r.hitRate)),
        avgMRR: avg(results.map((r) => r.mrr)),
        avgNDCG: avg(results.map((r) => r.ndcg)),
        avgLatencyMs: avg(latencies),
        p50LatencyMs: percentile(latencies, 50),
        p95LatencyMs: percentile(latencies, 95),
        p99LatencyMs: percentile(latencies, 99),
        failedCases,
        createdAt: new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Regression detector — compare two eval runs
// ---------------------------------------------------------------------------

export async function detectRegression(
    currentRunId: string,
    baselineRunId: string,
    threshold: number = 0.05, // 5% degradation threshold
): Promise<{
    hasRegression: boolean;
    regressions: Array<{ metric: string; baseline: number; current: number; delta: number }>;
}> {
    const getRunAvgs = async (runId: string) => {
        const rows = await db
            .select({
                avgRecall: sql<number>`AVG(recall_at_k)`,
                avgPrecision: sql<number>`AVG(precision_at_k)`,
                avgHitRate: sql<number>`AVG(hit_rate)`,
                avgMRR: sql<number>`AVG(mrr)`,
                avgNDCG: sql<number>`AVG(ndcg)`,
                avgLatency: sql<number>`AVG(latency_ms)`,
            })
            .from(ragEvalResults)
            .where(eq(ragEvalResults.runId, runId));

        return rows[0];
    };

    const [baseline, current] = await Promise.all([
        getRunAvgs(baselineRunId),
        getRunAvgs(currentRunId),
    ]);

    if (!baseline || !current) {
        return { hasRegression: false, regressions: [] };
    }

    const regressions: Array<{ metric: string; baseline: number; current: number; delta: number }> = [];

    const check = (name: string, base: number | null, cur: number | null, lowerIsBetter = false) => {
        const b = Number(base) || 0;
        const c = Number(cur) || 0;
        const delta = lowerIsBetter ? c - b : b - c; // positive delta = regression
        if (delta > threshold) {
            regressions.push({ metric: name, baseline: b, current: c, delta });
        }
    };

    check("recall@k", baseline.avgRecall, current.avgRecall);
    check("precision@k", baseline.avgPrecision, current.avgPrecision);
    check("hit_rate", baseline.avgHitRate, current.avgHitRate);
    check("mrr", baseline.avgMRR, current.avgMRR);
    check("ndcg", baseline.avgNDCG, current.avgNDCG);
    check("latency_ms", baseline.avgLatency, current.avgLatency, true);

    return {
        hasRegression: regressions.length > 0,
        regressions,
    };
}

// ---------------------------------------------------------------------------
// Tracing / Observability helpers
// ---------------------------------------------------------------------------

export interface TraceSpan {
    name: string;
    startMs: number;
    endMs?: number;
    durationMs?: number;
    metadata?: Record<string, unknown>;
    children: TraceSpan[];
}

export class RequestTracer {
    private rootSpan: TraceSpan;
    private currentSpan: TraceSpan;
    private spanStack: TraceSpan[] = [];

    constructor(name: string) {
        this.rootSpan = { name, startMs: Date.now(), children: [], metadata: {} };
        this.currentSpan = this.rootSpan;
    }

    startSpan(name: string, metadata?: Record<string, unknown>): void {
        const span: TraceSpan = { name, startMs: Date.now(), children: [], metadata };
        this.currentSpan.children.push(span);
        this.spanStack.push(this.currentSpan);
        this.currentSpan = span;
    }

    endSpan(): void {
        this.currentSpan.endMs = Date.now();
        this.currentSpan.durationMs = this.currentSpan.endMs - this.currentSpan.startMs;
        this.currentSpan = this.spanStack.pop() || this.rootSpan;
    }

    finish(): TraceSpan {
        this.rootSpan.endMs = Date.now();
        this.rootSpan.durationMs = this.rootSpan.endMs - this.rootSpan.startMs;
        return this.rootSpan;
    }

    toJSON(): Record<string, unknown> {
        return JSON.parse(JSON.stringify(this.rootSpan));
    }
}

// ---------------------------------------------------------------------------
// Get historical eval results
// ---------------------------------------------------------------------------

export async function getEvalHistory(
    runId?: string,
    limit: number = 20,
): Promise<Array<Record<string, unknown>>> {
    if (runId) {
        return db
            .select()
            .from(ragEvalResults)
            .where(eq(ragEvalResults.runId, runId))
            .orderBy(desc(ragEvalResults.createdAt))
            .limit(limit);
    }

    // Get latest runs summary
    const rows = await db.execute(sql`
        SELECT run_id,
               COUNT(*) as total_cases,
               AVG(recall_at_k) as avg_recall,
               AVG(precision_at_k) as avg_precision,
               AVG(hit_rate) as avg_hit_rate,
               AVG(mrr) as avg_mrr,
               AVG(ndcg) as avg_ndcg,
               AVG(latency_ms) as avg_latency,
               MAX(created_at) as created_at
        FROM rag_eval_results
        GROUP BY run_id
        ORDER BY MAX(created_at) DESC
        LIMIT ${limit}
    `);

    return (rows as any).rows ?? [];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const evaluationHarness = {
    computeMetrics,
    runEvaluation,
    detectRegression,
    getEvalHistory,
    RequestTracer,
};
