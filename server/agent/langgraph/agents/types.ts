import { z } from "zod";
import crypto from "crypto";

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
  })).optional(),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;

export interface BaseAgentConfig {
  name: string;
  description: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  tools: string[];
  timeout: number;
  maxIterations: number;
}

export interface AgentCapability {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  outputSchema: z.ZodSchema;
}

export abstract class BaseAgent {
  protected config: BaseAgentConfig;
  protected state: AgentState;

  constructor(config: BaseAgentConfig) {
    this.config = {
      ...config,
      // Automatically expose the Swarm delegation capability to all agents
      tools: config.tools.includes("delegate_task") ? config.tools : [...config.tools, "delegate_task"],
      systemPrompt: `${config.systemPrompt}\n\n[SWARM DELEGATION PROTOCOL]:\nYou have the ability to delegate sub-tasks to other specialized agents if a task falls outside your immediate expertise. Use the 'delegate_task' tool to specify the target agent and the sub-task description. Currently available specialized agents are registered in the system.`,
    };
    this.state = {
      id: crypto.randomUUID(),
      name: config.name,
      status: "idle",
      progress: 0,
    };
  }

  abstract execute(task: AgentTask): Promise<AgentResult>;

  abstract getCapabilities(): AgentCapability[];

  getState(): AgentState {
    return { ...this.state };
  }

  getName(): string {
    return this.config.name;
  }

  getDescription(): string {
    return this.config.description;
  }

  protected updateState(updates: Partial<AgentState>): void {
    this.state = { ...this.state, ...updates };
  }

  protected async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  /**
   * Empowers any agent to recursively delegate a sub-task to another specialized agent.
   * This forms the foundation of the Agent-to-Agent (Peer-to-Peer) Swarm Protocol.
   */
  protected async delegateTask(targetAgentName: string, subTaskDescription: string, inputData: Record<string, any> = {}): Promise<AgentResult> {
    const targetAgent = AGENT_REGISTRY.get(targetAgentName);

    if (!targetAgent) {
      throw new Error(`Delegation Failed: Target agent '${targetAgentName}' not found in registry.`);
    }

    // Inform state we are waiting on a sub-agent
    const previousTask = this.state.currentTask;
    this.updateState({
      status: "running",
      currentTask: `Waiting on delegated task to ${targetAgentName}: ${subTaskDescription.substring(0, 50)}...`
    });

    try {
      // Create a deterministic sub-task ID mapping back to the parent
      const subTaskId = `subtask_${crypto.randomUUID().split("-")[0]}_from_${this.state.name}`;

      const subTask: AgentTask = {
        id: subTaskId,
        type: "delegated_execution",
        description: subTaskDescription,
        input: {
          ...inputData,
          _delegatedBy: this.state.name,
          _parentTaskId: this.state.currentTask
        },
        priority: "high",
        retries: 0,
        maxRetries: 2,
      };

      const result = await targetAgent.execute(subTask);

      // Restore previous state
      this.updateState({
        currentTask: previousTask
      });

      return result;
    } catch (error: any) {
      this.updateState({ currentTask: previousTask });
      throw new Error(`Delegation to ${targetAgentName} failed: ${error.message}`);
    }
  }
}

export const AGENT_REGISTRY: Map<string, BaseAgent> = new Map();

export function registerAgent(agent: BaseAgent): void {
  AGENT_REGISTRY.set(agent.getName(), agent);
}

export function getAgent(name: string): BaseAgent | undefined {
  return AGENT_REGISTRY.get(name);
}

export function getAllAgents(): BaseAgent[] {
  return Array.from(AGENT_REGISTRY.values());
}
