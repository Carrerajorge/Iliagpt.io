import { z } from "zod";
import crypto from "crypto";
import { toolRegistry, ToolCallTrace, ToolExecutionResult } from "./toolRegistry";

export const AgentCapabilitySchema = z.object({
  name: z.string(),
  description: z.string(),
  tools: z.array(z.string()),
  inputSchema: z.any(),
  outputSchema: z.any(),
});

export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const AgentConfigSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(10).max(1000),
  role: z.string(),
  model: z.string().default("grok-4-1-fast-non-reasoning"),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(100).max(128000).default(4096),
  systemPrompt: z.string(),
  tools: z.array(z.string()),
  capabilities: z.array(AgentCapabilitySchema),
  timeout: z.number().default(120000),
  maxIterations: z.number().default(10),
  priority: z.number().min(1).max(10).default(5),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const AgentStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["idle", "running", "completed", "failed", "cancelled"]),
  currentTask: z.string().optional(),
  progress: z.number().min(0).max(100).default(0),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

export const AgentTaskSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  input: z.record(z.any()),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  timeout: z.number().optional(),
  retries: z.number().default(0),
  maxRetries: z.number().default(3),
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const AgentResultSchema = z.object({
  taskId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  success: z.boolean(),
  output: z.any().optional(),
  error: z.string().optional(),
  duration: z.number(),
  tokensUsed: z.number().optional(),
  toolCalls: z.array(z.object({
    tool: z.string(),
    input: z.record(z.any()),
    output: z.any(),
    duration: z.number(),
    success: z.boolean(),
  })).optional(),
  reasoning: z.string().optional(),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;

export interface RegisteredAgent {
  config: AgentConfig;
  state: AgentState;
  execute: (task: AgentTask) => Promise<AgentResult>;
  getCapabilities: () => AgentCapability[];
  healthCheck: () => Promise<boolean>;
}

export const AGENT_ROLES = [
  "Orchestrator",
  "Research",
  "Code",
  "Data",
  "Content",
  "Communication",
  "Browser",
  "Document",
  "QA",
  "Security",
  "ComputerUse",
] as const;

export type AgentRole = typeof AGENT_ROLES[number];

class AgentRegistry {
  private agents: Map<string, RegisteredAgent> = new Map();
  private executionHistory: AgentResult[] = [];
  private maxHistory = 1000;

  register(agent: RegisteredAgent): void {
    const { name } = agent.config;
    
    if (this.agents.has(name)) {
      console.warn(`[AgentRegistry] Agent "${name}" already registered, overwriting`);
    }

    const validatedConfig = AgentConfigSchema.parse(agent.config);
    const validatedState = AgentStateSchema.parse(agent.state);

    this.agents.set(name, {
      ...agent,
      config: validatedConfig,
      state: validatedState,
    });

    console.log(`[AgentRegistry] Registered agent: ${name} (${agent.config.role})`);
  }

  unregister(name: string): boolean {
    return this.agents.delete(name);
  }

  get(name: string): RegisteredAgent | undefined {
    return this.agents.get(name);
  }

  getByRole(role: AgentRole): RegisteredAgent | undefined {
    for (const agent of this.agents.values()) {
      if (agent.config.role === role) {
        return agent;
      }
    }
    return undefined;
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  getAll(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  async execute(agentName: string, task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    
    const agent = this.agents.get(agentName);
    if (!agent) {
      return {
        taskId: task.id,
        agentId: "unknown",
        agentName: agentName,
        success: false,
        error: `Agent "${agentName}" not found`,
        duration: Date.now() - startTime,
      };
    }

    try {
      agent.state = { ...agent.state, status: "running", currentTask: task.description };
      
      const result = await agent.execute(task);
      
      agent.state = { ...agent.state, status: "completed", currentTask: undefined };
      this.addToHistory(result);
      
      return result;
    } catch (err: any) {
      const result: AgentResult = {
        taskId: task.id,
        agentId: agent.state.id,
        agentName: agent.config.name,
        success: false,
        error: err.message || "Unknown execution error",
        duration: Date.now() - startTime,
      };
      
      agent.state = { ...agent.state, status: "failed", error: err.message };
      this.addToHistory(result);
      
      return result;
    }
  }

  private addToHistory(result: AgentResult): void {
    this.executionHistory.push(result);
    if (this.executionHistory.length > this.maxHistory) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistory / 2);
    }
  }

  getHistory(filter?: {
    agentName?: string;
    success?: boolean;
    since?: number;
    limit?: number;
  }): AgentResult[] {
    let results = this.executionHistory;

    if (filter?.agentName) {
      results = results.filter(r => r.agentName === filter.agentName);
    }
    if (filter?.success !== undefined) {
      results = results.filter(r => r.success === filter.success);
    }
    if (filter?.since) {
      results = results.filter(r => r.duration >= filter.since!);
    }
    if (filter?.limit) {
      results = results.slice(-filter.limit);
    }

    return results;
  }

  async runHealthChecks(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    for (const [name, agent] of this.agents.entries()) {
      try {
        results.set(name, await agent.healthCheck());
      } catch {
        results.set(name, false);
      }
    }
    
    return results;
  }

  getStats(): {
    totalAgents: number;
    byRole: Record<string, number>;
    byStatus: Record<string, number>;
    history: {
      total: number;
      successRate: number;
      avgDurationMs: number;
    };
  } {
    const byRole: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    
    for (const agent of this.agents.values()) {
      byRole[agent.config.role] = (byRole[agent.config.role] || 0) + 1;
      byStatus[agent.state.status] = (byStatus[agent.state.status] || 0) + 1;
    }

    const successCount = this.executionHistory.filter(r => r.success).length;
    const totalDuration = this.executionHistory.reduce((sum, r) => sum + r.duration, 0);

    return {
      totalAgents: this.agents.size,
      byRole,
      byStatus,
      history: {
        total: this.executionHistory.length,
        successRate: this.executionHistory.length > 0 
          ? Math.round((successCount / this.executionHistory.length) * 100) 
          : 0,
        avgDurationMs: this.executionHistory.length > 0
          ? Math.round(totalDuration / this.executionHistory.length)
          : 0,
      },
    };
  }

  toJSON(): object {
    return {
      agents: Array.from(this.agents.entries()).map(([name, agent]) => ({
        name,
        config: agent.config,
        state: agent.state,
        capabilities: agent.getCapabilities(),
      })),
      stats: this.getStats(),
    };
  }
}

export function createAgent(
  config: AgentConfig,
  executeFn: (task: AgentTask, tools: typeof toolRegistry) => Promise<AgentResult>
): RegisteredAgent {
  const state: AgentState = {
    id: crypto.randomUUID(),
    name: config.name,
    status: "idle",
    progress: 0,
  };

  return {
    config,
    state,
    execute: (task) => executeFn(task, toolRegistry),
    getCapabilities: () => config.capabilities,
    healthCheck: async () => {
      for (const toolName of config.tools) {
        if (!toolRegistry.has(toolName)) {
          return false;
        }
      }
      return true;
    },
  };
}

export const agentRegistry = new AgentRegistry();
export { AgentRegistry };
