/**
 * Cost Optimizer - ILIAGPT PRO 3.0
 * 
 * Tracks, analyzes, and optimizes AI model costs.
 * Provides recommendations and budget alerts.
 */

// ============== Types ==============

export interface CostEntry {
    id: string;
    timestamp: Date;
    userId: string;
    modelId: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
    totalCost: number;
    requestType: RequestType;
    cached: boolean;
    latencyMs: number;
}

export type RequestType =
    | "chat"
    | "completion"
    | "embedding"
    | "vision"
    | "code"
    | "document"
    | "tool";

export interface ModelPricing {
    modelId: string;
    provider: string;
    inputPer1k: number;  // USD per 1K tokens
    outputPer1k: number; // USD per 1K tokens
    contextWindow: number;
}

export interface CostSummary {
    totalCost: number;
    byModel: Record<string, number>;
    byProvider: Record<string, number>;
    byRequestType: Record<string, number>;
    totalRequests: number;
    totalTokens: { input: number; output: number };
    avgCostPerRequest: number;
    cacheHitRate: number;
    savingsFromCache: number;
}

export interface CostRecommendation {
    type: "model_switch" | "caching" | "prompt_optimization" | "batch" | "rate_limit";
    priority: "high" | "medium" | "low";
    currentCost: number;
    potentialSavings: number;
    description: string;
    action: string;
}

export interface BudgetAlert {
    userId: string;
    alertType: "approaching" | "exceeded" | "spike";
    threshold: number;
    current: number;
    message: string;
    timestamp: Date;
}

// ============== Model Pricing ==============

const MODEL_PRICING: ModelPricing[] = [
    // Grok 4.1 Series
    { modelId: "grok-4-1-fast-non-reasoning", provider: "xai", inputPer1k: 0.0005, outputPer1k: 0.002, contextWindow: 2000000 },
    { modelId: "grok-4-1-fast-reasoning", provider: "xai", inputPer1k: 0.001, outputPer1k: 0.004, contextWindow: 2000000 },

    // Grok 4 Series
    { modelId: "grok-4-fast-non-reasoning", provider: "xai", inputPer1k: 0.0005, outputPer1k: 0.002, contextWindow: 2000000 },
    { modelId: "grok-4-fast-reasoning", provider: "xai", inputPer1k: 0.001, outputPer1k: 0.004, contextWindow: 2000000 },
    { modelId: "grok-4-0709", provider: "xai", inputPer1k: 0.003, outputPer1k: 0.015, contextWindow: 256000 },
    { modelId: "grok-code-fast-1", provider: "xai", inputPer1k: 0.0005, outputPer1k: 0.002, contextWindow: 256000 },

    // Grok 3 Series
    { modelId: "grok-3", provider: "xai", inputPer1k: 0.003, outputPer1k: 0.015, contextWindow: 131072 },
    { modelId: "grok-3-fast", provider: "xai", inputPer1k: 0.005, outputPer1k: 0.025, contextWindow: 131072 },
    { modelId: "grok-3-mini", provider: "xai", inputPer1k: 0.0003, outputPer1k: 0.0005, contextWindow: 131072 },
    { modelId: "grok-3-mini-fast", provider: "xai", inputPer1k: 0.0006, outputPer1k: 0.004, contextWindow: 131072 },

    // Grok 2 (Legacy)
    { modelId: "grok-2-vision-1212", provider: "xai", inputPer1k: 0.002, outputPer1k: 0.01, contextWindow: 32768 },

    // Gemini
    { modelId: "gemini-2.5-pro", provider: "google", inputPer1k: 0.00125, outputPer1k: 0.005, contextWindow: 2000000 },
    { modelId: "gemini-2.5-flash", provider: "google", inputPer1k: 0.000075, outputPer1k: 0.0003, contextWindow: 1000000 },
    { modelId: "gemini-2.0-flash", provider: "google", inputPer1k: 0.00005, outputPer1k: 0.0002, contextWindow: 1000000 },

    // Default fallback
    { modelId: "default", provider: "default", inputPer1k: 0.001, outputPer1k: 0.005, contextWindow: 128000 },
];

// ============== Cost Store ==============

const costEntries: CostEntry[] = [];
const userBudgets: Map<string, { daily: number; monthly: number }> = new Map();
const MAX_ENTRIES = 100000;

// ============== Cost Optimizer ==============

export class CostOptimizer {
    private pricingMap: Map<string, ModelPricing>;

    constructor() {
        this.pricingMap = new Map();
        for (const pricing of MODEL_PRICING) {
            this.pricingMap.set(pricing.modelId, pricing);
        }
    }

    // ======== Cost Tracking ========

    /**
     * Track a model call cost
     */
    async trackCost(
        userId: string,
        modelId: string,
        inputTokens: number,
        outputTokens: number,
        options: {
            requestType?: RequestType;
            cached?: boolean;
            latencyMs?: number;
        } = {}
    ): Promise<CostEntry> {
        const pricing = this.pricingMap.get(modelId) || this.pricingMap.get("default")!;

        const inputCost = (inputTokens / 1000) * pricing.inputPer1k;
        const outputCost = (outputTokens / 1000) * pricing.outputPer1k;

        // Apply cache discount
        const totalCost = options.cached ? 0 : inputCost + outputCost;

        const entry: CostEntry = {
            id: `cost_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date(),
            userId,
            modelId,
            provider: pricing.provider,
            inputTokens,
            outputTokens,
            inputCost,
            outputCost,
            totalCost,
            requestType: options.requestType || "chat",
            cached: options.cached || false,
            latencyMs: options.latencyMs || 0,
        };

        costEntries.unshift(entry);

        if (costEntries.length > MAX_ENTRIES) {
            costEntries.pop();
        }

        // Check budget alerts
        await this.checkBudgetAlerts(userId);

        return entry;
    }

    /**
     * Get cost summary
     */
    async getCostSummary(
        userId?: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<CostSummary> {
        let entries = [...costEntries];

        if (userId) {
            entries = entries.filter(e => e.userId === userId);
        }

        if (startDate) {
            entries = entries.filter(e => e.timestamp >= startDate);
        }

        if (endDate) {
            entries = entries.filter(e => e.timestamp <= endDate);
        }

        const byModel: Record<string, number> = {};
        const byProvider: Record<string, number> = {};
        const byRequestType: Record<string, number> = {};
        let totalCost = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let cacheHits = 0;
        let savingsFromCache = 0;

        for (const entry of entries) {
            totalCost += entry.totalCost;
            totalInputTokens += entry.inputTokens;
            totalOutputTokens += entry.outputTokens;

            byModel[entry.modelId] = (byModel[entry.modelId] || 0) + entry.totalCost;
            byProvider[entry.provider] = (byProvider[entry.provider] || 0) + entry.totalCost;
            byRequestType[entry.requestType] = (byRequestType[entry.requestType] || 0) + entry.totalCost;

            if (entry.cached) {
                cacheHits++;
                savingsFromCache += entry.inputCost + entry.outputCost;
            }
        }

        return {
            totalCost,
            byModel,
            byProvider,
            byRequestType,
            totalRequests: entries.length,
            totalTokens: { input: totalInputTokens, output: totalOutputTokens },
            avgCostPerRequest: entries.length > 0 ? totalCost / entries.length : 0,
            cacheHitRate: entries.length > 0 ? cacheHits / entries.length : 0,
            savingsFromCache,
        };
    }

    // ======== Recommendations ========

    /**
     * Get cost optimization recommendations
     */
    async getRecommendations(userId: string): Promise<CostRecommendation[]> {
        const recommendations: CostRecommendation[] = [];
        const entries = costEntries.filter(e => e.userId === userId);

        if (entries.length < 10) {
            return recommendations;
        }

        const summary = await this.getCostSummary(userId);

        // Model switch recommendation
        const expensiveModels = Object.entries(summary.byModel)
            .filter(([, cost]) => cost > summary.totalCost * 0.3)
            .map(([modelId]) => modelId);

        for (const model of expensiveModels) {
            const cheaper = this.findCheaperAlternative(model);
            if (cheaper) {
                const modelCost = summary.byModel[model];
                const savings = modelCost * 0.4; // Estimate 40% savings

                recommendations.push({
                    type: "model_switch",
                    priority: savings > 10 ? "high" : "medium",
                    currentCost: modelCost,
                    potentialSavings: savings,
                    description: `Alto uso de ${model} (${(modelCost / summary.totalCost * 100).toFixed(1)}% del costo)`,
                    action: `Considera usar ${cheaper} para tareas simples`,
                });
            }
        }

        // Caching recommendation
        if (summary.cacheHitRate < 0.2) {
            recommendations.push({
                type: "caching",
                priority: "high",
                currentCost: summary.totalCost,
                potentialSavings: summary.totalCost * 0.3,
                description: `Baja tasa de cache (${(summary.cacheHitRate * 100).toFixed(1)}%)`,
                action: "Habilita semantic caching para consultas repetidas",
            });
        }

        // Prompt optimization
        const avgInputTokens = summary.totalTokens.input / summary.totalRequests;
        if (avgInputTokens > 2000) {
            recommendations.push({
                type: "prompt_optimization",
                priority: "medium",
                currentCost: summary.totalCost * 0.4,
                potentialSavings: summary.totalCost * 0.15,
                description: `Prompts largos (promedio ${Math.round(avgInputTokens)} tokens)`,
                action: "Usa Context Compressor para reducir tokens de entrada",
            });
        }

        return recommendations.sort((a, b) =>
            b.potentialSavings - a.potentialSavings
        );
    }

    /**
     * Find cheaper model alternative
     */
    private findCheaperAlternative(modelId: string): string | null {
        const current = this.pricingMap.get(modelId);
        if (!current) return null;

        const alternatives = Array.from(this.pricingMap.values())
            .filter(p =>
                p.modelId !== modelId &&
                p.provider === current.provider &&
                (p.inputPer1k + p.outputPer1k) < (current.inputPer1k + current.outputPer1k) * 0.5
            )
            .sort((a, b) => (a.inputPer1k + a.outputPer1k) - (b.inputPer1k + b.outputPer1k));

        return alternatives[0]?.modelId || null;
    }

    // ======== Budget Management ========

    /**
     * Set user budget
     */
    setBudget(userId: string, daily: number, monthly: number): void {
        userBudgets.set(userId, { daily, monthly });
    }

    /**
     * Check budget alerts
     */
    private async checkBudgetAlerts(userId: string): Promise<BudgetAlert | null> {
        const budget = userBudgets.get(userId);
        if (!budget) return null;

        // Get today's cost
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dailyCost = costEntries
            .filter(e => e.userId === userId && e.timestamp >= today)
            .reduce((sum, e) => sum + e.totalCost, 0);

        // Get monthly cost
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthlyCost = costEntries
            .filter(e => e.userId === userId && e.timestamp >= monthStart)
            .reduce((sum, e) => sum + e.totalCost, 0);

        // Check daily
        if (dailyCost >= budget.daily) {
            return {
                userId,
                alertType: "exceeded",
                threshold: budget.daily,
                current: dailyCost,
                message: `Presupuesto diario excedido: $${dailyCost.toFixed(2)} de $${budget.daily.toFixed(2)}`,
                timestamp: new Date(),
            };
        } else if (dailyCost >= budget.daily * 0.8) {
            return {
                userId,
                alertType: "approaching",
                threshold: budget.daily,
                current: dailyCost,
                message: `Acercándose al límite diario: $${dailyCost.toFixed(2)} de $${budget.daily.toFixed(2)}`,
                timestamp: new Date(),
            };
        }

        // Check monthly
        if (monthlyCost >= budget.monthly) {
            return {
                userId,
                alertType: "exceeded",
                threshold: budget.monthly,
                current: monthlyCost,
                message: `Presupuesto mensual excedido: $${monthlyCost.toFixed(2)} de $${budget.monthly.toFixed(2)}`,
                timestamp: new Date(),
            };
        }

        return null;
    }

    /**
     * Predict monthly cost
     */
    async predictMonthlyCost(userId: string): Promise<{
        predicted: number;
        daysRemaining: number;
        dailyAverage: number;
        trend: "increasing" | "stable" | "decreasing";
    }> {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const daysElapsed = Math.max(1, Math.floor((now.getTime() - monthStart.getTime()) / 86400000));
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysRemaining = daysInMonth - daysElapsed;

        const monthlyEntries = costEntries.filter(e =>
            e.userId === userId && e.timestamp >= monthStart
        );

        const totalCost = monthlyEntries.reduce((sum, e) => sum + e.totalCost, 0);
        const dailyAverage = totalCost / daysElapsed;
        const predicted = totalCost + (dailyAverage * daysRemaining);

        // Calculate trend
        const midMonth = new Date(now.getFullYear(), now.getMonth(), 15);
        const firstHalfCost = monthlyEntries
            .filter(e => e.timestamp < midMonth)
            .reduce((sum, e) => sum + e.totalCost, 0);
        const secondHalfCost = totalCost - firstHalfCost;

        let trend: "increasing" | "stable" | "decreasing" = "stable";
        if (secondHalfCost > firstHalfCost * 1.2) trend = "increasing";
        else if (secondHalfCost < firstHalfCost * 0.8) trend = "decreasing";

        return { predicted, daysRemaining, dailyAverage, trend };
    }

    /**
     * Estimate request cost before execution
     */
    estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
        const pricing = this.pricingMap.get(modelId) || this.pricingMap.get("default")!;
        return (inputTokens / 1000) * pricing.inputPer1k + (outputTokens / 1000) * pricing.outputPer1k;
    }
}

// ============== Singleton ==============

let optimizerInstance: CostOptimizer | null = null;

export function getCostOptimizer(): CostOptimizer {
    if (!optimizerInstance) {
        optimizerInstance = new CostOptimizer();
    }
    return optimizerInstance;
}

export default CostOptimizer;
