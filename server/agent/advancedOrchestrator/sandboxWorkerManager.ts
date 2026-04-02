import { Worker } from 'worker_threads';
import * as path from 'path';
import { AgentResult } from '../teamOrchestrator';
import { sandboxService } from '../sandbox/sandboxService';

export type AgentType = "researcher" | "coder" | "data_analyst" | "reviewer" | string;
export interface SubTask {
    id: string;
    agentType: AgentType;
    title: string;
    instruction: string;
    dependencies: string[];
    status: "pending" | "running" | "completed" | "failed";
}

export interface SandboxExecutionOptions {
    runId: string;
    task: SubTask;
    timeoutMs?: number;
    useDockerSandbox?: boolean; // If true, uses sandboxService. If false, worker_thread
}

/**
 * Manages the lifecycle of isolated agents (Worker threads / Docker Sandboxes).
 * Agents run independently without blocking the main orchestrator event loop.
 */
export class SandboxWorkerManager {
    private activeWorkers = new Map<string, Worker>();
    
    /**
     * Executes a subtask in an isolated environment.
     */
    async runIsolatedAgent(options: SandboxExecutionOptions): Promise<AgentResult> {
        const { task, runId, useDockerSandbox = false, timeoutMs = 60000 } = options;

        if (useDockerSandbox || task.agentType === 'coder') {
            return this.runInDockerSandbox(options);
        } else {
            return this.runInWorkerThread(options);
        }
    }

    private async runInWorkerThread(options: SandboxExecutionOptions): Promise<AgentResult> {
        const { task, runId, timeoutMs } = options;
        
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            // In a real app we would point to the compiled runner script.
            // Assuming we create a `worker-entry.ts` or leverage ts-node/Node 20 --import for this.
            // For Iliagpt we can point to a wrapper script that instantiates the exact AgentType.
            const workerPath = path.resolve(__dirname, 'worker-entry.js'); // Assuming transpile or direct TS loader
            
            // If the path doesn't exist yet, we will simulate the isolated worker behavior
            // using a standard fallback until worker-entry is fully built.
            const worker = new Worker(`
                const { parentPort, workerData } = require('worker_threads');
                
                // Simulated Agent Workload inside worker
                async function execute() {
                    const ts = Date.now();
                    // Setup internal bus connection manually
                    // In real execution, import getAgent(workerData.task.agentType)(...)
                    parentPort.postMessage({
                        taskId: workerData.task.id,
                        agentType: workerData.task.agentType,
                        success: true,
                        output: "[Isolated Worker Thread] Processed " + workerData.task.title,
                        durationMs: Date.now() - ts,
                        confidence: 0.95
                    });
                }
                execute().catch(e => {
                    parentPort.postMessage({
                        taskId: workerData.task.id,
                        agentType: workerData.task.agentType,
                        success: false,
                        output: e.message,
                        durationMs: Date.now() - ts,
                        confidence: 0
                    });
                });
            `, { eval: true, workerData: { task, runId } });

            this.activeWorkers.set(task.id, worker);

            const timer = setTimeout(() => {
                worker.terminate();
                this.activeWorkers.delete(task.id);
                resolve({
                    taskId: task.id,
                    agentType: task.agentType,
                    success: false,
                    output: 'Worker Timeout',
                    durationMs: Date.now() - startTime
                });
            }, timeoutMs);

            worker.on('message', (msg: AgentResult) => {
                clearTimeout(timer);
                this.activeWorkers.delete(task.id);
                // Worker finished, clean up and resolve
                worker.terminate();
                resolve(msg);
            });

            worker.on('error', (err) => {
                clearTimeout(timer);
                this.activeWorkers.delete(task.id);
                resolve({
                    taskId: task.id,
                    agentType: task.agentType,
                    success: false,
                    output: `Worker Error: ${err.message}`,
                    durationMs: Date.now() - startTime
                });
            });
        });
    }

    private async runInDockerSandbox(options: SandboxExecutionOptions): Promise<AgentResult> {
        const { task, runId, timeoutMs } = options;
        const startTime = Date.now();
        
        try {
            // Provision heavy sandbox
            const sessionId = await sandboxService.createSession();
            
            // Pass command to run agent CLI inside the sandbox
            // In production, we assume CLI accepts agentType and task
            const result = await sandboxService.executeNode(`
                console.log("Processing task: ${task.title} as ${task.agentType}");
                // Implement CLI call to getAgent(${task.agentType}) logic
                // Return output JSON format
                console.log(JSON.stringify({
                    taskId: "${task.id}",
                    success: true,
                    output: "[Docker Sandbox] Executed heavy code task",
                    confidence: 0.90
                }));
            `, { runId: sessionId, timeout: timeoutMs });

            await sandboxService.destroySession(sessionId);

            let stdoutOutput = result.stdout;
            // Best effort to parse JSON output from sandbox stdout
            try {
                const match = result.stdout.match(/({[\s\S]*})/m);
                if (match) {
                    const parsed = JSON.parse(match[1]);
                    return {
                        ...parsed,
                        agentType: task.agentType,
                        durationMs: Date.now() - startTime
                    };
                }
            } catch { }

            return {
                taskId: task.id,
                agentType: task.agentType,
                success: result.returnCode === 0,
                output: result.stdout || result.stderr || "No output",
                durationMs: Date.now() - startTime
            };

        } catch (error: any) {
            return {
                taskId: task.id,
                agentType: task.agentType,
                success: false,
                output: `Docker Sandbox Error: ${error.message}`,
                durationMs: Date.now() - startTime
            };
        }
    }
}
