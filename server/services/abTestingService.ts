/**
 * A/B Testing Service - ILIAGPT PRO 3.0
 * 
 * Run experiments on prompts, models, and UI variations.
 * Statistical analysis and performance tracking.
 */

// ============== Types ==============

export interface Experiment {
    id: string;
    name: string;
    description: string;
    type: ExperimentType;
    status: ExperimentStatus;
    variants: Variant[];
    targetAudience: TargetAudience;
    startDate: Date;
    endDate?: Date;
    metrics: MetricDefinition[];
    results?: ExperimentResults;
}

export type ExperimentType =
    | "prompt"      // System prompt variations
    | "model"       // Model comparisons
    | "ui"          // UI/UX variations
    | "feature"     // Feature flags
    | "pricing";    // Pricing experiments

export type ExperimentStatus =
    | "draft"
    | "running"
    | "paused"
    | "completed"
    | "archived";

export interface Variant {
    id: string;
    name: string;
    weight: number;        // 0-100 allocation percentage
    config: Record<string, any>;
    isControl: boolean;
}

export interface TargetAudience {
    percentage: number;    // % of users in experiment
    filters?: {
        userTier?: string[];
        country?: string[];
        language?: string[];
        registrationDate?: { after?: Date; before?: Date };
    };
}

export interface MetricDefinition {
    name: string;
    type: "count" | "average" | "percentage" | "duration";
    goal: "increase" | "decrease";
    minimumSampleSize?: number;
}

export interface MetricResult {
    name: string;
    control: { value: number; sampleSize: number };
    treatment: { value: number; sampleSize: number };
    improvement: number;      // %
    confidence: number;       // %
    isSignificant: boolean;
}

export interface ExperimentResults {
    winner?: string;          // Variant ID
    metrics: MetricResult[];
    totalSamples: number;
    lastUpdated: Date;
}

// ============== Storage ==============

const experiments: Map<string, Experiment> = new Map();
const userAssignments: Map<string, Map<string, string>> = new Map(); // userId -> expId -> variantId
const eventLog: { expId: string; variantId: string; userId: string; metric: string; value: number; timestamp: Date }[] = [];

// ============== A/B Testing Service ==============

export class ABTestingService {

    // ======== Experiment Management ========

    /**
     * Create new experiment
     */
    createExperiment(
        name: string,
        type: ExperimentType,
        variants: Omit<Variant, 'id'>[],
        options: {
            description?: string;
            targetAudience?: TargetAudience;
            metrics?: MetricDefinition[];
        } = {}
    ): Experiment {
        const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        const experiment: Experiment = {
            id,
            name,
            description: options.description || "",
            type,
            status: "draft",
            variants: variants.map((v, i) => ({
                ...v,
                id: `var_${i}_${Math.random().toString(36).slice(2, 6)}`,
            })),
            targetAudience: options.targetAudience || { percentage: 100 },
            startDate: new Date(),
            metrics: options.metrics || [
                { name: "response_quality", type: "average", goal: "increase" },
                { name: "completion_rate", type: "percentage", goal: "increase" },
            ],
        };

        // Validate weights sum to 100
        const totalWeight = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
        if (Math.abs(totalWeight - 100) > 0.1) {
            throw new Error(`Variant weights must sum to 100, got ${totalWeight}`);
        }

        experiments.set(id, experiment);
        return experiment;
    }

    /**
     * Start experiment
     */
    startExperiment(experimentId: string): boolean {
        const exp = experiments.get(experimentId);
        if (!exp || exp.status !== "draft") return false;

        exp.status = "running";
        exp.startDate = new Date();
        return true;
    }

    /**
     * Stop experiment
     */
    stopExperiment(experimentId: string): boolean {
        const exp = experiments.get(experimentId);
        if (!exp || exp.status !== "running") return false;

        exp.status = "completed";
        exp.endDate = new Date();
        this.calculateResults(experimentId);
        return true;
    }

    /**
     * Pause experiment
     */
    pauseExperiment(experimentId: string): boolean {
        const exp = experiments.get(experimentId);
        if (!exp || exp.status !== "running") return false;

        exp.status = "paused";
        return true;
    }

    /**
     * Resume experiment
     */
    resumeExperiment(experimentId: string): boolean {
        const exp = experiments.get(experimentId);
        if (!exp || exp.status !== "paused") return false;

        exp.status = "running";
        return true;
    }

    /**
     * Delete experiment
     */
    deleteExperiment(experimentId: string): boolean {
        return experiments.delete(experimentId);
    }

    /**
     * Get experiment
     */
    getExperiment(experimentId: string): Experiment | undefined {
        return experiments.get(experimentId);
    }

    /**
     * List experiments
     */
    listExperiments(status?: ExperimentStatus): Experiment[] {
        const all = Array.from(experiments.values());
        return status ? all.filter(e => e.status === status) : all;
    }

    // ======== User Assignment ========

    /**
     * Get variant for user
     */
    getVariant(experimentId: string, userId: string): Variant | null {
        const exp = experiments.get(experimentId);
        if (!exp || exp.status !== "running") return null;

        // Check target audience
        if (!this.isInAudience(userId, exp.targetAudience)) return null;

        // Get or create assignment
        let userExps = userAssignments.get(userId);
        if (!userExps) {
            userExps = new Map();
            userAssignments.set(userId, userExps);
        }

        let variantId = userExps.get(experimentId);

        if (!variantId) {
            // Assign based on weights
            const random = Math.random() * 100;
            let cumulative = 0;

            for (const variant of exp.variants) {
                cumulative += variant.weight;
                if (random <= cumulative) {
                    variantId = variant.id;
                    break;
                }
            }

            if (variantId) {
                userExps.set(experimentId, variantId);
            }
        }

        return exp.variants.find(v => v.id === variantId) || null;
    }

    /**
     * Check if user is in target audience
     */
    private isInAudience(userId: string, audience: TargetAudience): boolean {
        // Deterministic assignment based on user ID
        const hash = this.hashString(userId) % 100;
        return hash < audience.percentage;
    }

    /**
     * Simple string hash
     */
    private hashString(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    // ======== Event Tracking ========

    /**
     * Track event for experiment
     */
    trackEvent(
        experimentId: string,
        userId: string,
        metric: string,
        value: number = 1
    ): void {
        const variant = this.getVariant(experimentId, userId);
        if (!variant) return;

        eventLog.push({
            expId: experimentId,
            variantId: variant.id,
            userId,
            metric,
            value,
            timestamp: new Date(),
        });

        // Keep log size manageable
        if (eventLog.length > 100000) {
            eventLog.splice(0, 10000);
        }
    }

    /**
     * Track conversion  
     */
    trackConversion(experimentId: string, userId: string): void {
        this.trackEvent(experimentId, userId, "conversion", 1);
    }

    // ======== Results Calculation ========

    /**
     * Calculate experiment results
     */
    calculateResults(experimentId: string): ExperimentResults | null {
        const exp = experiments.get(experimentId);
        if (!exp) return null;

        const events = eventLog.filter(e => e.expId === experimentId);
        const control = exp.variants.find(v => v.isControl);

        if (!control || exp.variants.length < 2) return null;

        const results: ExperimentResults = {
            metrics: [],
            totalSamples: new Set(events.map(e => e.userId)).size,
            lastUpdated: new Date(),
        };

        // Calculate each metric
        for (const metricDef of exp.metrics) {
            const controlEvents = events.filter(e =>
                e.variantId === control.id && e.metric === metricDef.name
            );

            // Compare against each treatment
            for (const treatment of exp.variants.filter(v => !v.isControl)) {
                const treatmentEvents = events.filter(e =>
                    e.variantId === treatment.id && e.metric === metricDef.name
                );

                const controlValue = this.calculateMetric(controlEvents, metricDef.type);
                const treatmentValue = this.calculateMetric(treatmentEvents, metricDef.type);

                const improvement = controlValue > 0
                    ? ((treatmentValue - controlValue) / controlValue) * 100
                    : 0;

                // Simple significance test
                const confidence = this.calculateConfidence(
                    controlEvents.length,
                    treatmentEvents.length,
                    controlValue,
                    treatmentValue
                );

                results.metrics.push({
                    name: `${metricDef.name} (${treatment.name} vs Control)`,
                    control: { value: controlValue, sampleSize: controlEvents.length },
                    treatment: { value: treatmentValue, sampleSize: treatmentEvents.length },
                    improvement,
                    confidence,
                    isSignificant: confidence >= 95,
                });
            }
        }

        // Determine winner
        const significantWins = results.metrics.filter(m =>
            m.isSignificant && m.improvement > 0
        );

        if (significantWins.length > 0) {
            // Find treatment with most significant wins
            results.winner = exp.variants.find(v => !v.isControl)?.id;
        }

        exp.results = results;
        return results;
    }

    /**
     * Calculate metric value
     */
    private calculateMetric(
        events: typeof eventLog,
        type: MetricDefinition["type"]
    ): number {
        if (events.length === 0) return 0;

        switch (type) {
            case "count":
                return events.length;
            case "average":
                return events.reduce((sum, e) => sum + e.value, 0) / events.length;
            case "percentage":
                return (events.filter(e => e.value > 0).length / events.length) * 100;
            case "duration":
                return events.reduce((sum, e) => sum + e.value, 0) / events.length;
            default:
                return 0;
        }
    }

    /**
     * Calculate statistical confidence (simplified)
     */
    private calculateConfidence(
        n1: number,
        n2: number,
        mean1: number,
        mean2: number
    ): number {
        if (n1 < 10 || n2 < 10) return 0;

        // Simplified confidence based on sample sizes and effect size
        const minSample = Math.min(n1, n2);
        const effectSize = Math.abs(mean2 - mean1) / Math.max(mean1, 0.01);

        // Higher samples and larger effect = higher confidence
        const confidence = Math.min(99, 50 + (Math.sqrt(minSample) * effectSize * 10));
        return Math.round(confidence);
    }

    // ======== Quick Access ========

    /**
     * Get prompt for experiment (convenience method)
     */
    getExperimentalPrompt(basePrompt: string, experimentId: string, userId: string): string {
        const variant = this.getVariant(experimentId, userId);

        if (!variant || variant.isControl) {
            return basePrompt;
        }

        // Apply variant modifications
        const promptModifier = variant.config.promptPrefix || "";
        const promptSuffix = variant.config.promptSuffix || "";

        return `${promptModifier}${basePrompt}${promptSuffix}`;
    }

    /**
     * Get model for experiment
     */
    getExperimentalModel(defaultModel: string, experimentId: string, userId: string): string {
        const variant = this.getVariant(experimentId, userId);
        return variant?.config.model || defaultModel;
    }
}

// ============== Singleton ==============

let abTestingInstance: ABTestingService | null = null;

export function getABTesting(): ABTestingService {
    if (!abTestingInstance) {
        abTestingInstance = new ABTestingService();
    }
    return abTestingInstance;
}

export default ABTestingService;
