import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { z } from "zod";

export const SubAgentStatusSchema = z.enum([
  "idle",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type SubAgentStatus = z.infer<typeof SubAgentStatusSchema>;

export const SubAgentConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  objective: z.string(),
  tools: z.array(z.string()).default([]),
  context: z.record(z.any()).default({}),
  parentRunId: z.string(),
  priority: z.number().min(1).max(10).default(5),
  timeoutMs: z.number().default(60000),
  maxRetries: z.number().default(2),
});
export type SubAgentConfig = z.infer<typeof SubAgentConfigSchema>;

export const SubAgentResultSchema = z.object({
  agentId: z.string().uuid(),
  taskId: z.string().optional(),
  status: SubAgentStatusSchema,
  output: z.any().optional(),
  error: z.string().optional(),
  startedAt: z.number(),
  completedAt: z.number().optional(),
  durationMs: z.number().optional(),
  retries: z.number().default(0),
  qualityScore: z.number().min(0).max(1).optional(),
  toolsUsed: z.array(z.string()).default([]),
  tokenUsage: z.number().default(0),
});
export type SubAgentResult = z.infer<typeof SubAgentResultSchema>;

export const PoolStatsSchema = z.object({
  totalAgents: z.number(),
  activeAgents: z.number(),
  idleAgents: z.number(),
  completedTasks: z.number(),
  failedTasks: z.number(),
  avgDurationMs: z.number(),
  totalTokenUsage: z.number(),
});
export type PoolStats = z.infer<typeof PoolStatsSchema>;

export type SubAgentExecutorFn = (
  config: SubAgentConfig,
) => Promise<{ output: any; toolsUsed: string[]; tokenUsage: number; qualityScore?: number }>;

interface PooledAgent {
  id: string;
  config: SubAgentConfig;
  status: SubAgentStatus;
  result?: SubAgentResult;
  abortController: AbortController;
}

export type SubAgentSpawnerEvent =
  | "agent_spawned"
  | "agent_started"
  | "agent_completed"
  | "agent_failed"
  | "agent_retrying"
  | "wave_started"
  | "wave_completed"
  | "pool_drained";

export class SubAgentSpawner extends EventEmitter {
  private pool: Map<string, PooledAgent> = new Map();
  private completedResults: SubAgentResult[] = [];
  private maxConcurrency: number;
  private activeSemaphore: number = 0;
  private readonly durations: number[] = [];

  constructor(maxConcurrency: number = 10) {
    super();
    this.setMaxListeners(50);
    this.maxConcurrency = maxConcurrency;
  }

  createAgent(params: {
    name: string;
    objective: string;
    tools?: string[];
    context?: Record<string, any>;
    parentRunId: string;
    priority?: number;
    timeoutMs?: number;
    maxRetries?: number;
  }): SubAgentConfig {
    const config = SubAgentConfigSchema.parse({
      id: randomUUID(),
      name: params.name,
      objective: params.objective,
      tools: params.tools || [],
      context: params.context || {},
      parentRunId: params.parentRunId,
      priority: params.priority ?? 5,
      timeoutMs: params.timeoutMs ?? 60000,
      maxRetries: params.maxRetries ?? 2,
    });

    const pooled: PooledAgent = {
      id: config.id,
      config,
      status: "idle",
      abortController: new AbortController(),
    };
    this.pool.set(config.id, pooled);

    this.emit("agent_spawned", { agentId: config.id, name: config.name, objective: config.objective });

    return config;
  }

  async executeAgent(
    config: SubAgentConfig,
    executorFn: SubAgentExecutorFn,
  ): Promise<SubAgentResult> {
    const pooled = this.pool.get(config.id);
    if (!pooled) {
      throw new Error(`Agent ${config.id} not found in pool`);
    }

    pooled.status = "running";
    this.activeSemaphore++;
    const startedAt = Date.now();

    this.emit("agent_started", { agentId: config.id, name: config.name });

    let lastError: string | undefined;
    let retries = 0;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      if (pooled.abortController.signal.aborted) {
        return this.finalizeAgent(pooled, {
          agentId: config.id,
          status: "cancelled",
          startedAt,
          completedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          retries,
          toolsUsed: [],
          tokenUsage: 0,
        });
      }

      try {
        const result = await Promise.race([
          executorFn(config),
          this.createTimeout(config.timeoutMs, config.id),
        ]);

        const completedAt = Date.now();
        const durationMs = completedAt - startedAt;

        return this.finalizeAgent(pooled, {
          agentId: config.id,
          status: "completed",
          output: result.output,
          startedAt,
          completedAt,
          durationMs,
          retries,
          qualityScore: result.qualityScore,
          toolsUsed: result.toolsUsed,
          tokenUsage: result.tokenUsage,
        });
      } catch (err: any) {
        lastError = err.message || String(err);
        retries = attempt + 1;

        if (attempt < config.maxRetries) {
          this.emit("agent_retrying", {
            agentId: config.id,
            attempt: attempt + 1,
            maxRetries: config.maxRetries,
            error: lastError,
          });
          await this.backoff(attempt);
        }
      }
    }

    return this.finalizeAgent(pooled, {
      agentId: config.id,
      status: "failed",
      error: lastError,
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      retries,
      toolsUsed: [],
      tokenUsage: 0,
    });
  }

  async executeWave(
    configs: SubAgentConfig[],
    executorFn: SubAgentExecutorFn,
  ): Promise<SubAgentResult[]> {
    const sorted = [...configs].sort((a, b) => a.priority - b.priority);

    this.emit("wave_started", {
      agentCount: sorted.length,
      agents: sorted.map(c => ({ id: c.id, name: c.name })),
    });

    const batches: SubAgentConfig[][] = [];
    for (let i = 0; i < sorted.length; i += this.maxConcurrency) {
      batches.push(sorted.slice(i, i + this.maxConcurrency));
    }

    const allResults: SubAgentResult[] = [];

    for (const batch of batches) {
      const batchResults = await Promise.allSettled(
        batch.map(config => this.executeAgent(config, executorFn)),
      );

      for (const settled of batchResults) {
        if (settled.status === "fulfilled") {
          allResults.push(settled.value);
        } else {
          allResults.push({
            agentId: "unknown",
            status: "failed",
            error: settled.reason?.message || "Unknown error",
            startedAt: Date.now(),
            completedAt: Date.now(),
            durationMs: 0,
            retries: 0,
            toolsUsed: [],
            tokenUsage: 0,
          });
        }
      }
    }

    this.emit("wave_completed", {
      total: allResults.length,
      succeeded: allResults.filter(r => r.status === "completed").length,
      failed: allResults.filter(r => r.status === "failed").length,
    });

    return allResults;
  }

  async executeDAG(
    waves: SubAgentConfig[][],
    executorFn: SubAgentExecutorFn,
    onWaveComplete?: (waveIndex: number, results: SubAgentResult[]) => void,
  ): Promise<SubAgentResult[]> {
    const allResults: SubAgentResult[] = [];

    for (let i = 0; i < waves.length; i++) {
      const waveResults = await this.executeWave(waves[i], executorFn);
      allResults.push(...waveResults);

      if (onWaveComplete) {
        onWaveComplete(i, waveResults);
      }

      const waveFailures = waveResults.filter(r => r.status === "failed");
      if (waveFailures.length === waveResults.length && waveResults.length > 0) {
        console.warn(`[SubAgentSpawner] Wave ${i} fully failed, aborting remaining waves`);
        break;
      }
    }

    this.emit("pool_drained", { totalResults: allResults.length });
    return allResults;
  }

  cancelAgent(agentId: string): boolean {
    const pooled = this.pool.get(agentId);
    if (!pooled || pooled.status === "completed" || pooled.status === "failed") {
      return false;
    }

    pooled.abortController.abort();
    pooled.status = "cancelled";
    return true;
  }

  cancelAll(): number {
    let cancelled = 0;
    for (const [id] of this.pool) {
      if (this.cancelAgent(id)) {
        cancelled++;
      }
    }
    return cancelled;
  }

  getPoolStats(): PoolStats {
    const agents = Array.from(this.pool.values());
    const active = agents.filter(a => a.status === "running").length;
    const idle = agents.filter(a => a.status === "idle").length;
    const completed = this.completedResults.filter(r => r.status === "completed").length;
    const failed = this.completedResults.filter(r => r.status === "failed").length;
    const avgDuration =
      this.durations.length > 0
        ? this.durations.reduce((a, b) => a + b, 0) / this.durations.length
        : 0;
    const totalTokens = this.completedResults.reduce((sum, r) => sum + (r.tokenUsage || 0), 0);

    return {
      totalAgents: agents.length,
      activeAgents: active,
      idleAgents: idle,
      completedTasks: completed,
      failedTasks: failed,
      avgDurationMs: Math.round(avgDuration),
      totalTokenUsage: totalTokens,
    };
  }

  getAgentResult(agentId: string): SubAgentResult | undefined {
    return this.completedResults.find(r => r.agentId === agentId);
  }

  reset(): void {
    this.cancelAll();
    this.pool.clear();
    this.completedResults = [];
    this.durations.length = 0;
    this.activeSemaphore = 0;
  }

  private finalizeAgent(pooled: PooledAgent, result: SubAgentResult): SubAgentResult {
    const validated = SubAgentResultSchema.parse(result);
    pooled.status = validated.status;
    pooled.result = validated;
    this.completedResults.push(validated);
    this.activeSemaphore = Math.max(0, this.activeSemaphore - 1);

    if (validated.durationMs) {
      this.durations.push(validated.durationMs);
    }

    if (validated.status === "completed") {
      this.emit("agent_completed", {
        agentId: validated.agentId,
        durationMs: validated.durationMs,
        qualityScore: validated.qualityScore,
      });
    } else if (validated.status === "failed") {
      this.emit("agent_failed", {
        agentId: validated.agentId,
        error: validated.error,
        retries: validated.retries,
      });
    }

    return validated;
  }

  private createTimeout(ms: number, agentId: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Agent ${agentId} timed out after ${ms}ms`)), ms);
    });
  }

  private backoff(attempt: number): Promise<void> {
    const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
    return new Promise(resolve => setTimeout(resolve, delay));
  }
}

export const subAgentSpawner = new SubAgentSpawner();
