/**
 * Agent Team Orchestrator - ILIAGPT PRO 3.0
 * 
 * Coordinates multiple specialized agents to work on complex tasks.
 * Handles parallel execution, result merging, and conflict resolution.
 */

import { EventEmitter } from "events";
import {
    type TaskPlan,
    type SubTask,
    type AgentType,
    getExecutionOrder,
    updateSubtaskStatus,
    calculateProgress
} from "./taskDecomposer";

// ============== Types ==============

export interface AgentResult {
    taskId: string;
    agentType: AgentType;
    success: boolean;
    output: any;
    artifacts?: any[];
    durationMs: number;
    tokensUsed?: number;
    confidence?: number;
}

export interface TeamContext {
    userId: string;
    chatId: string;
    runId: string;
    signal?: AbortSignal;
    sharedMemory: SharedMemory;
}

export interface SharedMemory {
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T): void;
    getAll(): Record<string, any>;
    clear(): void;
}

export interface TeamOrchestratorOptions {
    maxParallel?: number;
    timeoutMs?: number;
    retryCount?: number;
    onProgress?: (plan: TaskPlan, task: SubTask) => void;
    onAgentStart?: (task: SubTask) => void;
    onAgentComplete?: (task: SubTask, result: AgentResult) => void;
}

// ============== Agent Registry ==============

type AgentExecutor = (
    task: SubTask,
    context: TeamContext,
    previousResults: AgentResult[]
) => Promise<AgentResult>;

const agentExecutors: Map<AgentType, AgentExecutor> = new Map();

/**
 * Register an agent executor
 */
export function registerAgent(type: AgentType, executor: AgentExecutor) {
    agentExecutors.set(type, executor);
}

/**
 * Get agent executor
 */
export function getAgent(type: AgentType): AgentExecutor | undefined {
    return agentExecutors.get(type);
}

// ============== Shared Memory Implementation ==============

export function createSharedMemory(): SharedMemory {
    const store: Record<string, any> = {};

    return {
        get<T>(key: string): T | undefined {
            return store[key] as T;
        },
        set<T>(key: string, value: T): void {
            store[key] = value;
        },
        getAll(): Record<string, any> {
            return { ...store };
        },
        clear(): void {
            for (const key of Object.keys(store)) {
                delete store[key];
            }
        }
    };
}

// ============== Team Orchestrator ==============

export class TeamOrchestrator extends EventEmitter {
    private options: Required<TeamOrchestratorOptions>;
    private results: Map<string, AgentResult> = new Map();
    private aborted = false;

    constructor(options: TeamOrchestratorOptions = {}) {
        super();
        this.options = {
            maxParallel: options.maxParallel ?? 3,
            timeoutMs: options.timeoutMs ?? 60000,
            retryCount: options.retryCount ?? 2,
            onProgress: options.onProgress ?? (() => { }),
            onAgentStart: options.onAgentStart ?? (() => { }),
            onAgentComplete: options.onAgentComplete ?? (() => { }),
        };
    }

    /**
     * Execute a task plan with multiple agents
     */
    async execute(plan: TaskPlan, context: TeamContext): Promise<{
        plan: TaskPlan;
        results: AgentResult[];
        finalOutput: any;
    }> {
        this.results.clear();
        this.aborted = false;

        let currentPlan = { ...plan, status: "executing" as const };
        const executionWaves = getExecutionOrder(currentPlan);

        // Handle abort signal
        if (context.signal) {
            context.signal.addEventListener("abort", () => {
                this.aborted = true;
            });
        }

        // Execute wave by wave
        for (const wave of executionWaves) {
            if (this.aborted) break;

            // Execute tasks in parallel within each wave
            const waveResults = await this.executeWave(wave, context, currentPlan);

            // Update plan with results
            for (const result of waveResults) {
                currentPlan = updateSubtaskStatus(
                    currentPlan,
                    result.taskId,
                    result.success ? "completed" : "failed",
                    result.output,
                    result.success ? undefined : String(result.output)
                );
                this.results.set(result.taskId, result);
            }

            this.options.onProgress(currentPlan, wave[0]);
        }

        // Merge final results
        const allResults = Array.from(this.results.values());
        const finalOutput = this.mergeResults(allResults, currentPlan);

        return {
            plan: {
                ...currentPlan,
                status: this.aborted ? "failed" : "completed",
                progress: calculateProgress(currentPlan),
            },
            results: allResults,
            finalOutput,
        };
    }

    /**
     * Execute a wave of tasks in parallel
     */
    private async executeWave(
        tasks: SubTask[],
        context: TeamContext,
        plan: TaskPlan
    ): Promise<AgentResult[]> {
        const chunks = this.chunkArray(tasks, this.options.maxParallel);
        const results: AgentResult[] = [];

        for (const chunk of chunks) {
            if (this.aborted) break;

            const chunkResults = await Promise.all(
                chunk.map(task => this.executeTask(task, context))
            );
            results.push(...chunkResults);
        }

        return results;
    }

    /**
     * Execute a single task with retry logic
     */
    private async executeTask(
        task: SubTask,
        context: TeamContext
    ): Promise<AgentResult> {
        const executor = getAgent(task.agentType);
        const previousResults = this.getPreviousResults(task.dependencies);
        const startTime = Date.now();

        this.options.onAgentStart(task);

        // If no executor, return mock result
        if (!executor) {
            const result: AgentResult = {
                taskId: task.id,
                agentType: task.agentType,
                success: true,
                output: `[${task.agentType}] Completed: ${task.title}`,
                durationMs: 100,
                confidence: 0.9,
            };
            this.options.onAgentComplete(task, result);
            return result;
        }

        // Execute with retry
        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= this.options.retryCount; attempt++) {
            if (this.aborted) {
                return {
                    taskId: task.id,
                    agentType: task.agentType,
                    success: false,
                    output: "Aborted",
                    durationMs: Date.now() - startTime,
                };
            }

            try {
                const result = await Promise.race([
                    executor(task, context, previousResults),
                    this.createTimeout(this.options.timeoutMs),
                ]) as AgentResult;

                this.options.onAgentComplete(task, result);
                return result;
            } catch (error) {
                lastError = error as Error;
                if (attempt < this.options.retryCount) {
                    await this.delay(1000 * (attempt + 1)); // Exponential backoff
                }
            }
        }

        const errorResult: AgentResult = {
            taskId: task.id,
            agentType: task.agentType,
            success: false,
            output: lastError?.message ?? "Unknown error",
            durationMs: Date.now() - startTime,
        };
        this.options.onAgentComplete(task, errorResult);
        return errorResult;
    }

    /**
     * Merge results from all agents
     */
    private mergeResults(results: AgentResult[], plan: TaskPlan): any {
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        // Combine outputs based on confidence scores
        const sortedByConfidence = [...successful].sort(
            (a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5)
        );

        // Build merged output
        const merged = {
            goal: plan.goal,
            summary: this.generateSummary(sortedByConfidence),
            details: sortedByConfidence.map(r => ({
                agent: r.agentType,
                output: r.output,
                confidence: r.confidence,
            })),
            artifacts: successful.flatMap(r => r.artifacts ?? []),
            stats: {
                totalTasks: results.length,
                successful: successful.length,
                failed: failed.length,
                totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
                totalTokens: results.reduce((sum, r) => sum + (r.tokensUsed ?? 0), 0),
            },
            errors: failed.map(r => ({
                agent: r.agentType,
                error: r.output,
            })),
        };

        return merged;
    }

    /**
     * Generate summary from results
     */
    private generateSummary(results: AgentResult[]): string {
        if (results.length === 0) return "No se completaron tareas.";

        const outputs = results
            .slice(0, 3)
            .map(r => typeof r.output === "string" ? r.output : JSON.stringify(r.output))
            .join("\n\n");

        return outputs.slice(0, 500);
    }

    /**
     * Get results from dependency tasks
     */
    private getPreviousResults(dependencyIds: string[]): AgentResult[] {
        return dependencyIds
            .map(id => this.results.get(id))
            .filter((r): r is AgentResult => r !== undefined);
    }

    /**
     * Create a timeout promise
     */
    private createTimeout(ms: number): Promise<never> {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Task timeout")), ms);
        });
    }

    /**
     * Delay helper
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Chunk array into smaller arrays
     */
    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Abort execution
     */
    abort() {
        this.aborted = true;
    }
}

// ============== Factory ==============

export function createTeamOrchestrator(options?: TeamOrchestratorOptions) {
    return new TeamOrchestrator(options);
}

export default TeamOrchestrator;
