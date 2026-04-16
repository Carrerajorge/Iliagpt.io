import { z } from "zod";
import { MichatSystem, MichatToolRegistry, MichatAgentRegistry } from "../index";
import { MichatError } from "../errors";
import { uid, nowISO } from "../config";
import type { 
  ToolDefinition, 
  AgentDefinition, 
  UserIdentity, 
  ToolContext,
  ResolvedConfig
} from "../types";

import { policyEngine as legacyPolicyEngine } from "../../policyEngine";
import { agentEventBus as legacyEventBus } from "../../eventBus";
import { guardrails as legacyGuardrails } from "../../guardrails";

export interface LegacyToolConfig {
  id: string;
  name: string;
  description: string;
  category: string;
  capabilities: string[];
  inputSchema: Record<string, { type: string; required?: boolean; description?: string }>;
  execute: (params: Record<string, unknown>, context?: unknown) => Promise<unknown>;
}

export function adaptLegacyTool(legacy: LegacyToolConfig): ToolDefinition<z.ZodObject<any>, unknown> {
  const schemaShape: Record<string, z.ZodTypeAny> = {};
  
  for (const [key, config] of Object.entries(legacy.inputSchema)) {
    let zodType: z.ZodTypeAny;
    
    switch (config.type) {
      case "string":
        zodType = z.string();
        break;
      case "number":
        zodType = z.number();
        break;
      case "boolean":
        zodType = z.boolean();
        break;
      case "array":
        zodType = z.array(z.unknown());
        break;
      case "object":
        zodType = z.record(z.unknown());
        break;
      default:
        zodType = z.unknown();
    }
    
    if (!config.required) {
      zodType = zodType.optional();
    }
    
    schemaShape[key] = zodType;
  }
  
  return {
    id: parseInt(legacy.id) || Math.floor(Math.random() * 10000),
    name: legacy.name,
    category: legacy.category || "General",
    priority: "Media",
    description: legacy.description,
    schema: z.object(schemaShape),
    tags: legacy.capabilities,
    defaultOptions: {
      timeoutMs: 30000,
      retries: 2,
    },
    handler: async (params, ctx) => {
      ctx.metrics.inc(`tool.${legacy.name}.calls`);
      const t0 = performance.now();
      
      try {
        const result = await legacy.execute(params, {
          traceId: ctx.traceId,
          requestId: ctx.requestId,
          user: ctx.user,
        });
        
        ctx.metrics.timing(`tool.${legacy.name}.latency_ms`, performance.now() - t0);
        return result;
      } catch (error) {
        ctx.metrics.inc(`tool.${legacy.name}.errors`);
        throw error;
      }
    },
  };
}

export function adaptLegacyAgent(config: {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
}): AgentDefinition {
  return {
    id: config.id,
    name: config.name,
    role: config.role,
    description: config.description,
    systemPrompt: config.systemPrompt,
    allowTools: config.allowedTools,
    maxToolCallsPerTurn: 6,
    maxTokensPerTurn: 4096,
  };
}

export function adaptLegacyUser(user?: { 
  id?: string; 
  email?: string; 
  name?: string;
  plan?: string;
}): UserIdentity | undefined {
  if (!user) return undefined;
  
  return {
    id: user.id || "anonymous",
    name: user.name,
    email: user.email,
    roles: user.plan ? [user.plan] : ["free"],
    capabilities: [],
    plan: (user.plan as "free" | "pro" | "admin") || "free",
  };
}

export class MichatBridge {
  private system: MichatSystem;

  constructor(config?: Partial<ResolvedConfig>) {
    this.system = new MichatSystem({ config });
    this.setupEventBridge();
  }

  private setupEventBridge(): void {
    const internalEvents = this.system.getService<{ on: (event: string, handler: (p: unknown) => void) => void }>("events");
    
    internalEvents.on("tool.started", (payload: any) => {
      legacyEventBus.emit(payload.runId || uid("run"), "tool_start", {
        tool_name: payload.tool,
        metadata: { traceId: payload.traceId, requestId: payload.requestId },
      }).catch(() => {});
    });

    internalEvents.on("tool.succeeded", (payload: any) => {
      legacyEventBus.emit(payload.runId || uid("run"), "tool_end", {
        tool_name: payload.tool,
        status: "success",
        metadata: { traceId: payload.traceId, requestId: payload.requestId },
      }).catch(() => {});
    });

    internalEvents.on("tool.failed", (payload: any) => {
      legacyEventBus.emit(payload.runId || uid("run"), "tool_end", {
        tool_name: payload.tool,
        status: "error",
        error: payload.err,
        metadata: { traceId: payload.traceId, requestId: payload.requestId },
      }).catch(() => {});
    });

    internalEvents.on("workflow.started", (payload: any) => {
      legacyEventBus.emit(payload.runId || uid("run"), "planning_start", {
        plan: { workflowId: payload.workflowId, steps: payload.steps },
        metadata: { traceId: payload.traceId, requestId: payload.requestId },
      }).catch(() => {});
    });

    internalEvents.on("workflow.succeeded", (payload: any) => {
      legacyEventBus.emit(payload.runId || uid("run"), "run_complete", {
        summary: `Workflow ${payload.workflowId} completed`,
        metadata: { traceId: payload.traceId, requestId: payload.requestId },
      }).catch(() => {});
    });
  }

  registerLegacyTool(legacy: LegacyToolConfig): void {
    const adapted = adaptLegacyTool(legacy);
    this.system.tools.register(adapted);
  }

  registerLegacyAgent(config: Parameters<typeof adaptLegacyAgent>[0]): void {
    const adapted = adaptLegacyAgent(config);
    this.system.agents.register(adapted);
  }

  async executeTool(
    toolName: string,
    params: Record<string, unknown>,
    user?: { id?: string; email?: string; name?: string; plan?: string },
    runId?: string
  ): Promise<unknown> {
    const adaptedUser = adaptLegacyUser(user);
    
    const policyCheck = legacyPolicyEngine.checkAccess({
      userId: user?.id || "anonymous",
      userPlan: (user?.plan as any) || "free",
      toolName,
    });

    if (!policyCheck.allowed) {
      throw new MichatError("E_POLICY_DENIED", policyCheck.reason || "Access denied by legacy policy", {
        tool: toolName,
        user: user?.id,
      });
    }

    return this.system.executeTool(
      { tool: toolName, params },
      adaptedUser
    );
  }

  async runWorkflow(
    steps: Array<{ id: string; tool: string; params: unknown; dependsOn?: string[] }>,
    user?: { id?: string; email?: string; name?: string; plan?: string }
  ) {
    const adaptedUser = adaptLegacyUser(user);
    
    for (const step of steps) {
      const policyCheck = legacyPolicyEngine.checkAccess({
        userId: user?.id || "anonymous",
        userPlan: (user?.plan as any) || "free",
        toolName: step.tool,
      });

      if (!policyCheck.allowed) {
        throw new MichatError("E_POLICY_DENIED", policyCheck.reason || "Access denied by legacy policy", {
          tool: step.tool,
          step: step.id,
        });
      }
    }

    return this.system.runWorkflow(steps, adaptedUser);
  }

  sanitizeInput(text: string): string {
    return legacyGuardrails.redactPII(text).text;
  }

  getCircuitState(toolName: string) {
    return this.system.getCircuitState(toolName);
  }

  getMetrics() {
    return this.system.getMetricsSnapshot();
  }

  getAuditLog(filter?: { actor?: string; resource?: string }, limit?: number) {
    return this.system.getAuditLog(filter, limit);
  }

  resetCircuit(toolName: string) {
    this.system.resetCircuit(toolName);
  }

  get tools() {
    return this.system.tools;
  }

  get agents() {
    return this.system.agents;
  }

  get config() {
    return this.system.config;
  }
}

let globalBridge: MichatBridge | null = null;

export function getMichatBridge(config?: Partial<ResolvedConfig>): MichatBridge {
  if (!globalBridge) {
    globalBridge = new MichatBridge(config);
  }
  return globalBridge;
}

export function resetMichatBridge(): void {
  globalBridge = null;
}
