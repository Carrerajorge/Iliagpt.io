/**
 * Plan Optimizer Service - ILIAGPT PRO 3.0
 * 
 * AI agent plan optimization and auto-improvement.
 * Analyzes execution patterns and suggests optimizations.
 */

// ============== Types ==============

export interface ExecutionPlan {
    id: string;
    name: string;
    steps: PlanStep[];
    estimatedDuration: number;
    actualDuration?: number;
    success?: boolean;
    optimizations?: Optimization[];
}

export interface PlanStep {
    id: string;
    type: StepType;
    name: string;
    params: Record<string, any>;
    dependencies: string[];
    estimatedDuration: number;
    actualDuration?: number;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    error?: string;
    canParallelize?: boolean;
}

export type StepType =
    | "llm_call"
    | "tool_execution"
    | "web_search"
    | "file_operation"
    | "api_call"
    | "user_input"
    | "conditional"
    | "loop"
    | "parallel";

export interface Optimization {
    type: OptimizationType;
    description: string;
    impact: "high" | "medium" | "low";
    autoApplicable: boolean;
    suggestedChange: any;
}

export type OptimizationType =
    | "parallelize"
    | "cache"
    | "skip_redundant"
    | "batch"
    | "reorder"
    | "simplify"
    | "reduce_llm_calls"
    | "use_faster_model";

export interface ExecutionStats {
    planId: string;
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    parallelizedSteps: number;
    cachedSteps: number;
    totalDuration: number;
    llmCallDuration: number;
    toolExecutionDuration: number;
    waitTime: number;
}

// ============== Plan History ==============

const planHistory: ExecutionPlan[] = [];
const optimizationRules: Map<string, (plan: ExecutionPlan) => Optimization[]> = new Map();

// ============== Plan Optimizer ==============

export class PlanOptimizer {

    constructor() {
        this.registerDefaultRules();
    }

    // ======== Plan Analysis ========

    /**
     * Analyze plan for optimizations
     */
    analyzePlan(plan: ExecutionPlan): Optimization[] {
        const optimizations: Optimization[] = [];

        // Run all registered rules
        for (const [, rule] of optimizationRules) {
            optimizations.push(...rule(plan));
        }

        // Deduplicate and sort by impact
        const unique = this.deduplicateOptimizations(optimizations);
        return unique.sort((a, b) =>
            this.impactScore(b.impact) - this.impactScore(a.impact)
        );
    }

    /**
     * Optimize plan automatically
     */
    optimizePlan(plan: ExecutionPlan): ExecutionPlan {
        const optimizations = this.analyzePlan(plan);
        let optimizedPlan = { ...plan, steps: [...plan.steps] };

        for (const opt of optimizations) {
            if (opt.autoApplicable) {
                optimizedPlan = this.applyOptimization(optimizedPlan, opt);
            }
        }

        optimizedPlan.optimizations = optimizations;
        return optimizedPlan;
    }

    /**
     * Apply single optimization
     */
    private applyOptimization(plan: ExecutionPlan, opt: Optimization): ExecutionPlan {
        switch (opt.type) {
            case "parallelize":
                return this.applyParallelization(plan, opt.suggestedChange);
            case "reorder":
                return this.applyReorder(plan, opt.suggestedChange);
            case "skip_redundant":
                return this.removeStep(plan, opt.suggestedChange.stepId);
            case "batch":
                return this.batchSteps(plan, opt.suggestedChange.stepIds);
            default:
                return plan;
        }
    }

    // ======== Optimization Rules ========

    /**
     * Register default optimization rules
     */
    private registerDefaultRules(): void {
        // Rule 1: Parallelize independent steps
        optimizationRules.set("parallelize", (plan) => {
            const optimizations: Optimization[] = [];
            const parallelGroups: string[][] = [];

            for (let i = 0; i < plan.steps.length; i++) {
                const step = plan.steps[i];
                const independentSteps = plan.steps.slice(i + 1).filter(s =>
                    !s.dependencies.includes(step.id) &&
                    !step.dependencies.includes(s.id) &&
                    s.canParallelize !== false &&
                    step.canParallelize !== false
                );

                if (independentSteps.length > 0) {
                    const group = [step.id, ...independentSteps.map(s => s.id)];
                    parallelGroups.push(group);

                    optimizations.push({
                        type: "parallelize",
                        description: `Run ${group.length} steps in parallel`,
                        impact: independentSteps.length > 2 ? "high" : "medium",
                        autoApplicable: true,
                        suggestedChange: { stepIds: group },
                    });
                    break; // One group at a time
                }
            }

            return optimizations;
        });

        // Rule 2: Skip redundant LLM calls
        optimizationRules.set("skip_redundant", (plan) => {
            const optimizations: Optimization[] = [];
            const llmCalls = plan.steps.filter(s => s.type === "llm_call");

            for (let i = 0; i < llmCalls.length; i++) {
                for (let j = i + 1; j < llmCalls.length; j++) {
                    if (this.areSimilarCalls(llmCalls[i], llmCalls[j])) {
                        optimizations.push({
                            type: "skip_redundant",
                            description: `Skip redundant LLM call "${llmCalls[j].name}"`,
                            impact: "high",
                            autoApplicable: false, // Manual review needed
                            suggestedChange: { stepId: llmCalls[j].id },
                        });
                    }
                }
            }

            return optimizations;
        });

        // Rule 3: Batch similar operations
        optimizationRules.set("batch", (plan) => {
            const optimizations: Optimization[] = [];
            const byType = new Map<StepType, PlanStep[]>();

            for (const step of plan.steps) {
                const steps = byType.get(step.type) || [];
                steps.push(step);
                byType.set(step.type, steps);
            }

            for (const [type, steps] of byType) {
                if (steps.length >= 3 && ["api_call", "file_operation", "web_search"].includes(type)) {
                    optimizations.push({
                        type: "batch",
                        description: `Batch ${steps.length} ${type} operations`,
                        impact: "medium",
                        autoApplicable: true,
                        suggestedChange: { stepIds: steps.map(s => s.id), type },
                    });
                }
            }

            return optimizations;
        });

        // Rule 4: Use faster model for simple steps
        optimizationRules.set("faster_model", (plan) => {
            const optimizations: Optimization[] = [];

            for (const step of plan.steps) {
                if (step.type === "llm_call" && step.params.model?.includes("grok-3")) {
                    const isSimple = this.isSimpleLLMCall(step);
                    if (isSimple) {
                        optimizations.push({
                            type: "use_faster_model",
                            description: `Use grok-3-mini for simple step "${step.name}"`,
                            impact: "medium",
                            autoApplicable: true,
                            suggestedChange: { stepId: step.id, newModel: "grok-3-mini" },
                        });
                    }
                }
            }

            return optimizations;
        });

        // Rule 5: Reorder for early fail detection
        optimizationRules.set("reorder", (plan) => {
            const optimizations: Optimization[] = [];
            const userInputSteps = plan.steps.filter(s => s.type === "user_input");

            for (const step of userInputSteps) {
                const index = plan.steps.indexOf(step);
                if (index > 2) {
                    optimizations.push({
                        type: "reorder",
                        description: `Move user input "${step.name}" earlier to fail fast`,
                        impact: "low",
                        autoApplicable: true,
                        suggestedChange: { stepId: step.id, newIndex: 0 },
                    });
                }
            }

            return optimizations;
        });
    }

    /**
     * Check if two LLM calls are similar
     */
    private areSimilarCalls(a: PlanStep, b: PlanStep): boolean {
        const promptA = a.params.prompt || a.params.message || "";
        const promptB = b.params.prompt || b.params.message || "";

        if (!promptA || !promptB) return false;

        // Simple similarity check
        const wordsA = new Set(promptA.toLowerCase().split(/\s+/));
        const wordsB = new Set(promptB.toLowerCase().split(/\s+/));

        let overlap = 0;
        for (const word of wordsA) {
            if (wordsB.has(word)) overlap++;
        }

        const similarity = (overlap * 2) / (wordsA.size + wordsB.size);
        return similarity > 0.7;
    }

    /**
     * Check if LLM call is simple
     */
    private isSimpleLLMCall(step: PlanStep): boolean {
        const prompt = step.params.prompt || step.params.message || "";

        // Simple if short prompt and no complex reasoning needed
        return (
            prompt.length < 500 &&
            !prompt.toLowerCase().includes("analyze") &&
            !prompt.toLowerCase().includes("compare") &&
            !prompt.toLowerCase().includes("reason") &&
            step.estimatedDuration < 3000
        );
    }

    // ======== Plan Transformations ========

    private applyParallelization(plan: ExecutionPlan, change: { stepIds: string[] }): ExecutionPlan {
        const parallelStep: PlanStep = {
            id: `parallel_${Date.now()}`,
            type: "parallel",
            name: `Parallel execution of ${change.stepIds.length} steps`,
            params: { stepIds: change.stepIds },
            dependencies: [],
            estimatedDuration: Math.max(...plan.steps
                .filter(s => change.stepIds.includes(s.id))
                .map(s => s.estimatedDuration)
            ),
            status: "pending",
            canParallelize: false,
        };

        const newSteps = plan.steps.filter(s => !change.stepIds.includes(s.id));
        const insertIndex = Math.min(
            ...plan.steps
                .filter(s => change.stepIds.includes(s.id))
                .map(s => plan.steps.indexOf(s))
        );

        newSteps.splice(insertIndex, 0, parallelStep);
        return { ...plan, steps: newSteps };
    }

    private applyReorder(plan: ExecutionPlan, change: { stepId: string; newIndex: number }): ExecutionPlan {
        const steps = plan.steps.filter(s => s.id !== change.stepId);
        const step = plan.steps.find(s => s.id === change.stepId);
        if (!step) return plan;

        steps.splice(change.newIndex, 0, step);
        return { ...plan, steps };
    }

    private removeStep(plan: ExecutionPlan, stepId: string): ExecutionPlan {
        return {
            ...plan,
            steps: plan.steps.filter(s => s.id !== stepId),
        };
    }

    private batchSteps(plan: ExecutionPlan, stepIds: string[]): ExecutionPlan {
        const stepsToRemove = plan.steps.filter(s => stepIds.includes(s.id));
        if (stepsToRemove.length < 2) return plan;

        const batchStep: PlanStep = {
            id: `batch_${Date.now()}`,
            type: stepsToRemove[0].type,
            name: `Batched ${stepsToRemove.length} ${stepsToRemove[0].type} operations`,
            params: { operations: stepsToRemove.map(s => s.params) },
            dependencies: [...new Set(stepsToRemove.flatMap(s => s.dependencies))],
            estimatedDuration: stepsToRemove[0].estimatedDuration * 1.5, // Overhead
            status: "pending",
        };

        const insertIndex = Math.min(...stepIds.map(id =>
            plan.steps.findIndex(s => s.id === id)
        ));

        const newSteps = plan.steps.filter(s => !stepIds.includes(s.id));
        newSteps.splice(insertIndex, 0, batchStep);

        return { ...plan, steps: newSteps };
    }

    // ======== Utilities ========

    private impactScore(impact: string): number {
        return impact === "high" ? 3 : impact === "medium" ? 2 : 1;
    }

    private deduplicateOptimizations(opts: Optimization[]): Optimization[] {
        const seen = new Set<string>();
        return opts.filter(o => {
            const key = `${o.type}:${JSON.stringify(o.suggestedChange)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Calculate execution stats
     */
    calculateStats(plan: ExecutionPlan): ExecutionStats {
        const completedSteps = plan.steps.filter(s => s.status === "completed");
        const failedSteps = plan.steps.filter(s => s.status === "failed");
        const skippedSteps = plan.steps.filter(s => s.status === "skipped");

        const llmCalls = plan.steps.filter(s => s.type === "llm_call");
        const toolExecs = plan.steps.filter(s => s.type === "tool_execution");

        return {
            planId: plan.id,
            totalSteps: plan.steps.length,
            completedSteps: completedSteps.length,
            failedSteps: failedSteps.length,
            skippedSteps: skippedSteps.length,
            parallelizedSteps: plan.steps.filter(s => s.type === "parallel").length,
            cachedSteps: 0,
            totalDuration: plan.actualDuration || 0,
            llmCallDuration: llmCalls.reduce((sum, s) => sum + (s.actualDuration || 0), 0),
            toolExecutionDuration: toolExecs.reduce((sum, s) => sum + (s.actualDuration || 0), 0),
            waitTime: 0,
        };
    }

    /**
     * Record completed plan for learning
     */
    recordExecution(plan: ExecutionPlan): void {
        planHistory.push(plan);
        if (planHistory.length > 1000) {
            planHistory.shift();
        }
    }

    /**
     * Get optimization suggestions based on history
     */
    getHistoricalInsights(): { pattern: string; suggestion: string; frequency: number }[] {
        const insights: { pattern: string; suggestion: string; frequency: number }[] = [];

        // Analyze common failure patterns
        const failedPlans = planHistory.filter(p => !p.success);
        const failurePatterns = new Map<string, number>();

        for (const plan of failedPlans) {
            const failedStep = plan.steps.find(s => s.status === "failed");
            if (failedStep) {
                const pattern = `${failedStep.type}:${failedStep.error?.slice(0, 50)}`;
                failurePatterns.set(pattern, (failurePatterns.get(pattern) || 0) + 1);
            }
        }

        for (const [pattern, count] of failurePatterns) {
            if (count >= 3) {
                insights.push({
                    pattern: pattern.split(":")[0],
                    suggestion: `Add retry logic for ${pattern.split(":")[0]} failures`,
                    frequency: count,
                });
            }
        }

        return insights;
    }
}

// ============== Singleton ==============

let optimizerInstance: PlanOptimizer | null = null;

export function getPlanOptimizer(): PlanOptimizer {
    if (!optimizerInstance) {
        optimizerInstance = new PlanOptimizer();
    }
    return optimizerInstance;
}

export default PlanOptimizer;
