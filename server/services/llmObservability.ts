/**
 * LLM Observability Service (Mejora #12 - Fase 3)
 *
 * Colecciona y expone métricas detalladas de rendimiento de LLMs:
 *   - Latencia por modelo: p50, p95, p99, p999
 *   - Tokens consumidos: prompt / completion / cached / por modelo y por usuario
 *   - Tasa de error por modelo y provider
 *   - Costo estimado por request/día/mes
 *   - TTFT (Time To First Token) para streaming
 *
 * Métricas expuestas como JSON vía /api/admin/llm-observability
 */

import { Logger } from "../lib/logger";

// ─── Constantes ───────────────────────────────────────────────────────────────

const MAX_LATENCY_SAMPLES = 2_000;   // muestras en ventana deslizante
const COST_WINDOW_MS = 24 * 60 * 60_000; // 24h para cómputo de costo diario
const MAX_COST_ENTRIES = 20_000;

// Costo estimado en USD por 1M tokens (ajustar según precios actuales)
const TOKEN_COST_USD_PER_M: Record<string, { input: number; output: number }> = {
    "gpt-4o": { input: 2.5, output: 10.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4-turbo": { input: 10.0, output: 30.0 },
    "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
    "claude-3-haiku": { input: 0.25, output: 1.25 },
    "gemini-1.5-pro": { input: 1.25, output: 5.0 },
    "gemini-1.5-flash": { input: 0.075, output: 0.3 },
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface LLMRequestRecord {
    model: string;
    provider: string;
    latencyMs: number;
    ttftMs?: number;       // Time to first token (streaming only)
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number; // tokens servidos desde cache del provider
    status: "success" | "error" | "cached";
    errorCode?: string;
    userId?: string;
    timestamp: number;
}

export interface PercentileStats {
    p50: number;
    p95: number;
    p99: number;
    p999: number;
    min: number;
    max: number;
    avg: number;
    samples: number;
}

export interface ModelStats {
    model: string;
    provider: string;
    latency: PercentileStats;
    ttft?: PercentileStats;
    tokens: {
        inputTotal: number;
        outputTotal: number;
        cachedTotal: number;
        inputPerRequest: number;
        outputPerRequest: number;
    };
    requests: {
        total: number;
        success: number;
        error: number;
        cached: number;
        errorRate: number;
    };
    cost: {
        estimatedUsdLast24h: number;
        estimatedUsdTotal: number;
    };
}

// ─── State ────────────────────────────────────────────────────────────────────

// latency samples por model
const latencySamplesByModel = new Map<string, number[]>();
const ttftSamplesByModel = new Map<string, number[]>();
const recordsByModel = new Map<string, LLMRequestRecord[]>();
const costEntries: Array<{ model: string; costUsd: number; timestamp: number }> = [];

// ─── Función de percentiles ───────────────────────────────────────────────────

function computePercentiles(samples: number[]): PercentileStats {
    if (samples.length === 0) {
        return { p50: 0, p95: 0, p99: 0, p999: 0, min: 0, max: 0, avg: 0, samples: 0 };
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const n = sorted.length;
    const pct = (p: number) => sorted[Math.min(Math.floor(p * n), n - 1)];
    const avg = sorted.reduce((a, b) => a + b, 0) / n;
    return {
        p50: pct(0.5),
        p95: pct(0.95),
        p99: pct(0.99),
        p999: pct(0.999),
        min: sorted[0],
        max: sorted[n - 1],
        avg: Math.round(avg),
        samples: n,
    };
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const normalizedModel = Object.keys(TOKEN_COST_USD_PER_M).find(k =>
        model.toLowerCase().includes(k.toLowerCase())
    );
    if (!normalizedModel) return 0;
    const costs = TOKEN_COST_USD_PER_M[normalizedModel];
    return (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output;
}

// ─── API Pública ──────────────────────────────────────────────────────────────

export const llmObservability = {
    /**
     * Registra un request LLM completado. Llamar desde llmGateway tras cada respuesta.
     */
    record(record: LLMRequestRecord): void {
        const { model, latencyMs, ttftMs, inputTokens, outputTokens } = record;

        // Latency samples
        let latSamples = latencySamplesByModel.get(model) ?? [];
        latSamples.push(latencyMs);
        if (latSamples.length > MAX_LATENCY_SAMPLES) latSamples = latSamples.slice(-MAX_LATENCY_SAMPLES);
        latencySamplesByModel.set(model, latSamples);

        // TTFT samples
        if (ttftMs !== undefined) {
            let ttftSamples = ttftSamplesByModel.get(model) ?? [];
            ttftSamples.push(ttftMs);
            if (ttftSamples.length > MAX_LATENCY_SAMPLES) ttftSamples = ttftSamples.slice(-MAX_LATENCY_SAMPLES);
            ttftSamplesByModel.set(model, ttftSamples);
        }

        // Full records (keep last 500 per model)
        let recs = recordsByModel.get(model) ?? [];
        recs.push(record);
        if (recs.length > 500) recs = recs.slice(-500);
        recordsByModel.set(model, recs);

        // Cost tracking
        const costUsd = estimateCost(model, inputTokens, outputTokens);
        if (costUsd > 0) {
            costEntries.push({ model, costUsd, timestamp: Date.now() });
            if (costEntries.length > MAX_COST_ENTRIES) costEntries.splice(0, MAX_COST_ENTRIES / 2);
        }
    },

    /**
     * Devuelve las estadísticas agregadas por modelo.
     */
    getStats(): Record<string, ModelStats> {
        const result: Record<string, ModelStats> = {};
        const now = Date.now();
        const window24h = now - COST_WINDOW_MS;

        for (const [model, recs] of recordsByModel) {
            const latSamples = latencySamplesByModel.get(model) ?? [];
            const ttftSamples = ttftSamplesByModel.get(model) ?? [];

            const total = recs.length;
            const success = recs.filter(r => r.status === "success").length;
            const error = recs.filter(r => r.status === "error").length;
            const cached = recs.filter(r => r.status === "cached").length;

            const inputTotal = recs.reduce((s, r) => s + r.inputTokens, 0);
            const outputTotal = recs.reduce((s, r) => s + r.outputTokens, 0);
            const cachedTotal = recs.reduce((s, r) => s + (r.cachedTokens ?? 0), 0);

            const costLast24h = costEntries
                .filter(e => e.model === model && e.timestamp >= window24h)
                .reduce((s, e) => s + e.costUsd, 0);
            const costTotal = costEntries
                .filter(e => e.model === model)
                .reduce((s, e) => s + e.costUsd, 0);

            const provider = recs[recs.length - 1]?.provider ?? "unknown";

            result[model] = {
                model,
                provider,
                latency: computePercentiles(latSamples),
                ttft: ttftSamples.length > 0 ? computePercentiles(ttftSamples) : undefined,
                tokens: {
                    inputTotal,
                    outputTotal,
                    cachedTotal,
                    inputPerRequest: total > 0 ? Math.round(inputTotal / total) : 0,
                    outputPerRequest: total > 0 ? Math.round(outputTotal / total) : 0,
                },
                requests: {
                    total,
                    success,
                    error,
                    cached,
                    errorRate: total > 0 ? parseFloat(((error / total) * 100).toFixed(2)) : 0,
                },
                cost: {
                    estimatedUsdLast24h: parseFloat(costLast24h.toFixed(6)),
                    estimatedUsdTotal: parseFloat(costTotal.toFixed(6)),
                },
            };
        }

        return result;
    },

    /**
     * Resumen global (suma de todos los modelos).
     */
    getSummary(): {
        totalRequests: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        totalCostUsd24h: number;
        activeModels: string[];
        avgLatencyMs: number;
    } {
        const stats = this.getStats();
        const models = Object.values(stats);
        const now = Date.now();
        const window24h = now - COST_WINDOW_MS;

        return {
            totalRequests: models.reduce((s, m) => s + m.requests.total, 0),
            totalInputTokens: models.reduce((s, m) => s + m.tokens.inputTotal, 0),
            totalOutputTokens: models.reduce((s, m) => s + m.tokens.outputTotal, 0),
            totalCostUsd24h: parseFloat(
                costEntries
                    .filter(e => e.timestamp >= window24h)
                    .reduce((s, e) => s + e.costUsd, 0)
                    .toFixed(6)
            ),
            activeModels: models
                .filter(m => m.requests.total > 0)
                .map(m => m.model),
            avgLatencyMs: models.length > 0
                ? Math.round(models.reduce((s, m) => s + m.latency.avg, 0) / models.length)
                : 0,
        };
    },
};

export default llmObservability;
