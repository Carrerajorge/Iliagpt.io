import { EventEmitter } from 'events';
import { AgentResult, TeamContext } from '../teamOrchestrator';
import { SandboxWorkerManager, SandboxExecutionOptions, AgentType, SubTask } from './sandboxWorkerManager';
import { CrossAgentMemoryBus } from './crossAgentMemoryBus';

export interface TaskPlan {
    id: string;
    goal: string;
    subtasks: SubTask[];
    status: "pending" | "executing" | "completed" | "failed";
    progress: number;
}
export function getExecutionOrder(plan: TaskPlan): SubTask[][] { return [plan.subtasks]; }
export function updateSubtaskStatus(plan: TaskPlan, id: string, status: any, output: any, err?: any): TaskPlan { return plan; }
export function calculateProgress(plan: TaskPlan): number { return plan.progress || 0; }

export interface SandboxTeamOptions {
    maxParallel?: number;
    timeoutMs?: number;
    retryCount?: number;
    onProgress?: (plan: TaskPlan, task: SubTask) => void;
    onAgentStart?: (task: SubTask, environmentType: string) => void;
    onAgentComplete?: (task: SubTask, result: AgentResult) => void;
}

export class SandboxTeamOrchestrator extends EventEmitter {
    private workerManager = new SandboxWorkerManager();
    private memoryBus: CrossAgentMemoryBus;
    private options: Required<SandboxTeamOptions>;
    private results = new Map<string, AgentResult>();
    private aborted = false;

    constructor(private runId: string, options: SandboxTeamOptions = {}) {
        super();
        this.memoryBus = new CrossAgentMemoryBus(runId);
        this.options = {
            maxParallel: options.maxParallel ?? 3,
            timeoutMs: options.timeoutMs ?? 120000,
            retryCount: options.retryCount ?? 1,
            onProgress: options.onProgress ?? (() => {}),
            onAgentStart: options.onAgentStart ?? (() => {}),
            onAgentComplete: options.onAgentComplete ?? (() => {}),
        };
    }

    async execute(plan: TaskPlan, context: TeamContext): Promise<{
        plan: TaskPlan;
        results: AgentResult[];
        finalOutput: any;
        memoryBus: CrossAgentMemoryBus;
    }> {
        this.results.clear();
        this.aborted = false;

        await this.memoryBus.initialize();
        
        // Put the initial context/variables into the bus so isolated agents can read them
        await this.memoryBus.set('sharedMemory', context.sharedMemory.getAll());

        let currentPlan = { ...plan, status: "executing" } as TaskPlan;
        const executionWaves = getExecutionOrder(currentPlan);

        if (context.signal) {
            context.signal.addEventListener("abort", () => {
                this.aborted = true;
            });
        }

        // Parallel isolated execution by wave
        for (const wave of executionWaves) {
            if (this.aborted) break;

            const waveResults = await this.executeIsolatedWave(wave, context);

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

        const allResults = Array.from(this.results.values());
        const finalOutput = await this.mergeIsolatedResults(allResults, currentPlan);

        // Optional: Destroy the bus or leave it for later analysis
        // await this.memoryBus.destroy();

        return {
            plan: {
                ...currentPlan,
                status: this.aborted ? "failed" : "completed",
                progress: calculateProgress(currentPlan),
            },
            results: allResults,
            finalOutput,
            memoryBus: this.memoryBus
        };
    }

    private async executeIsolatedWave(tasks: SubTask[], context: TeamContext): Promise<AgentResult[]> {
        // Chunk based on infrastructure resources (RAM/CPU limits)
        const chunks = this.chunkArray(tasks, this.options.maxParallel);
        const results: AgentResult[] = [];

        for (const chunk of chunks) {
            if (this.aborted) break;

            const chunkResults = await Promise.all(
                chunk.map(task => this.executeIsolatedTaskSafely(task))
            );
            results.push(...chunkResults);
        }

        return results;
    }

    private async executeIsolatedTaskSafely(task: SubTask): Promise<AgentResult> {
        const isCodingTask = task.agentType === 'coder' || task.agentType === 'data_analyst';
        const environmentType = isCodingTask ? 'docker_sandbox' : 'worker_thread';

        this.options.onAgentStart(task, environmentType);

        let lastResult: AgentResult | null = null;

        for (let attempt = 0; attempt <= this.options.retryCount; attempt++) {
            if (this.aborted) {
                return { taskId: task.id, agentType: task.agentType, success: false, output: "Aborted", durationMs: 0 };
            }

            const execOptions: SandboxExecutionOptions = {
                runId: this.runId,
                task,
                timeoutMs: this.options.timeoutMs,
                useDockerSandbox: isCodingTask
            };

            const result = await this.workerManager.runIsolatedAgent(execOptions);
            lastResult = result;

            if (result.success) {
                this.options.onAgentComplete(task, result);
                return result;
            } else {
                // Retry backoff
                await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
            }
        }

        this.options.onAgentComplete(task, lastResult as AgentResult);
        return lastResult as AgentResult;
    }

    private async mergeIsolatedResults(results: AgentResult[], plan: TaskPlan): Promise<any> {
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        const sorted = [...successful].sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5));

        const finalState = await this.memoryBus.get('sharedMemory') || {};

        return {
            goal: plan.goal,
            orchestrationResult: "Merged from isolated sandboxes",
            tasksCompleted: successful.length,
            tasksFailed: failed.length,
            agentOutputs: sorted.map(s => ({ agent: s.agentType, output: s.output, confidence: s.confidence })),
            finalGlobalState: finalState,
            totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0)
        };
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}
