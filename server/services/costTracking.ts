/**
 * Model Cost Tracking (#55)
 * Track and report costs per model, user, and feature
 */

import { EventEmitter } from 'events';
import { MODEL_PRICING_REGISTRY } from '../lib/modelRegistry';

// ============================================
// TYPES
// ============================================

interface ModelPricing {
    inputPerMillion: number;  // USD per 1M input tokens
    outputPerMillion: number; // USD per 1M output tokens
    currency: string;
}

interface UsageRecord {
    id: string;
    timestamp: Date;
    userId: number;
    chatId?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    feature: string;
    metadata?: Record<string, any>;
}

interface UsageSummary {
    period: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    byModel: Record<string, { input: number; output: number; cost: number }>;
    byFeature: Record<string, { input: number; output: number; cost: number }>;
}

// ============================================
// PRICING - built from the central model registry + additional providers
// ============================================

const MODEL_PRICING: Record<string, ModelPricing> = {
    // Import all xAI / Gemini pricing from the central registry
    ...Object.fromEntries(
        Object.entries(MODEL_PRICING_REGISTRY).map(([id, p]) => [
            id,
            { inputPerMillion: p.inputPerMillion, outputPerMillion: p.outputPerMillion, currency: 'USD' },
        ]),
    ),

    // Anthropic
    'claude-3.5-sonnet': { inputPerMillion: 3.00, outputPerMillion: 15.00, currency: 'USD' },
    'claude-3-haiku': { inputPerMillion: 0.25, outputPerMillion: 1.25, currency: 'USD' },

    // OpenAI
    'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00, currency: 'USD' },
    'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60, currency: 'USD' },

    // Embeddings
    'text-embedding-3-small': { inputPerMillion: 0.02, outputPerMillion: 0, currency: 'USD' },
    'text-embedding-3-large': { inputPerMillion: 0.13, outputPerMillion: 0, currency: 'USD' },
};

// ============================================
// COST TRACKER
// ============================================

class CostTracker extends EventEmitter {
    private records: UsageRecord[] = [];
    private dailyTotals = new Map<string, UsageSummary>();

    /**
     * Calculate cost for token usage
     */
    calculateCost(model: string, inputTokens: number, outputTokens: number): number {
        const pricing = MODEL_PRICING[model];
        if (!pricing) {
            console.warn(`Unknown model pricing: ${model}`);
            return 0;
        }

        const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
        const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

        return inputCost + outputCost;
    }

    /**
     * Record usage
     */
    recordUsage(params: {
        userId: number;
        chatId?: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
        feature: string;
        metadata?: Record<string, any>;
    }): UsageRecord {
        const cost = this.calculateCost(params.model, params.inputTokens, params.outputTokens);

        const record: UsageRecord = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            userId: params.userId,
            chatId: params.chatId,
            model: params.model,
            inputTokens: params.inputTokens,
            outputTokens: params.outputTokens,
            cost,
            feature: params.feature,
            metadata: params.metadata,
        };

        this.records.push(record);
        this.updateDailyTotals(record);
        this.emit('usage', record);

        // Limit in-memory records
        if (this.records.length > 10000) {
            this.records = this.records.slice(-5000);
        }

        return record;
    }

    private updateDailyTotals(record: UsageRecord): void {
        const day = record.timestamp.toISOString().split('T')[0];

        let summary = this.dailyTotals.get(day);
        if (!summary) {
            summary = {
                period: day,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCost: 0,
                byModel: {},
                byFeature: {},
            };
            this.dailyTotals.set(day, summary);
        }

        // Update totals
        summary.totalInputTokens += record.inputTokens;
        summary.totalOutputTokens += record.outputTokens;
        summary.totalCost += record.cost;

        // By model
        if (!summary.byModel[record.model]) {
            summary.byModel[record.model] = { input: 0, output: 0, cost: 0 };
        }
        summary.byModel[record.model].input += record.inputTokens;
        summary.byModel[record.model].output += record.outputTokens;
        summary.byModel[record.model].cost += record.cost;

        // By feature
        if (!summary.byFeature[record.feature]) {
            summary.byFeature[record.feature] = { input: 0, output: 0, cost: 0 };
        }
        summary.byFeature[record.feature].input += record.inputTokens;
        summary.byFeature[record.feature].output += record.outputTokens;
        summary.byFeature[record.feature].cost += record.cost;
    }

    /**
     * Get usage for user
     */
    getUserUsage(userId: number, options: {
        startDate?: Date;
        endDate?: Date;
    } = {}): UsageSummary {
        const { startDate, endDate } = options;

        const filtered = this.records.filter(r => {
            if (r.userId !== userId) return false;
            if (startDate && r.timestamp < startDate) return false;
            if (endDate && r.timestamp > endDate) return false;
            return true;
        });

        return this.summarize(filtered);
    }

    /**
     * Get daily summary
     */
    getDailySummary(date: string): UsageSummary | null {
        return this.dailyTotals.get(date) || null;
    }

    /**
     * Get weekly/monthly aggregation
     */
    getAggregatedSummary(days: number): UsageSummary {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);

        const filtered = this.records.filter(r => r.timestamp >= cutoff);
        return this.summarize(filtered);
    }

    private summarize(records: UsageRecord[]): UsageSummary {
        const summary: UsageSummary = {
            period: 'custom',
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCost: 0,
            byModel: {},
            byFeature: {},
        };

        for (const record of records) {
            summary.totalInputTokens += record.inputTokens;
            summary.totalOutputTokens += record.outputTokens;
            summary.totalCost += record.cost;

            if (!summary.byModel[record.model]) {
                summary.byModel[record.model] = { input: 0, output: 0, cost: 0 };
            }
            summary.byModel[record.model].input += record.inputTokens;
            summary.byModel[record.model].output += record.outputTokens;
            summary.byModel[record.model].cost += record.cost;

            if (!summary.byFeature[record.feature]) {
                summary.byFeature[record.feature] = { input: 0, output: 0, cost: 0 };
            }
            summary.byFeature[record.feature].input += record.inputTokens;
            summary.byFeature[record.feature].output += record.outputTokens;
            summary.byFeature[record.feature].cost += record.cost;
        }

        return summary;
    }

    /**
     * Get model pricing info
     */
    getPricing(model: string): ModelPricing | null {
        return MODEL_PRICING[model] || null;
    }

    /**
     * Get all pricing
     */
    getAllPricing(): Record<string, ModelPricing> {
        return { ...MODEL_PRICING };
    }
}

// Singleton
export const costTracker = new CostTracker();

// ============================================
// EXPRESS ROUTER
// ============================================

import { Router, Request, Response } from 'express';

export function createCostRouter(): Router {
    const router = Router();

    // Get user usage
    router.get('/usage', (req: Request, res: Response) => {
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const days = parseInt(req.query.days as string) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const usage = costTracker.getUserUsage(userId, { startDate });
        res.json(usage);
    });

    // Get daily breakdown
    router.get('/usage/daily', (req: Request, res: Response) => {
        const date = req.query.date as string || new Date().toISOString().split('T')[0];
        const summary = costTracker.getDailySummary(date);
        res.json(summary || { period: date, totalCost: 0 });
    });

    // Get pricing
    router.get('/pricing', (req: Request, res: Response) => {
        res.json(costTracker.getAllPricing());
    });

    // Admin: get aggregated
    router.get('/admin/aggregated', (req: Request, res: Response) => {
        const days = parseInt(req.query.days as string) || 7;
        const summary = costTracker.getAggregatedSummary(days);
        res.json(summary);
    });

    return router;
}

// ============================================
// MIDDLEWARE
// ============================================

export function trackModelUsage(feature: string) {
    return (inputTokens: number, outputTokens: number, model: string, userId: number, chatId?: string) => {
        return costTracker.recordUsage({
            userId,
            chatId,
            model,
            inputTokens,
            outputTokens,
            feature,
        });
    };
}

// Re-export
export { MODEL_PRICING };
