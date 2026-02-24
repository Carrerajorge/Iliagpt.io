export type {
  ISODate,
  UserIdentity,
  ChatMessage,
  ToolExecutionOptions,
  ToolDefinition,
  AgentDefinition,
  RoutingDecision,
  ToolCall,
  ToolContext,
  Logger,
  Metrics,
  AuditEntry,
  Audit,
  Cache,
  MemoryRecord,
  Memory,
  EventBus,
  PolicyDecision,
  PolicyEngine,
  ResolvedConfig,
  LLMAdapter,
  WorkflowStep,
  WorkflowResult,
  TracerSpan,
} from "./types";

export { IliagptError, IliagptErrorCode, wrapError } from "./errors";
export { resolveConfig, clamp, jitter, sleep, nowISO, uid, withTimeout, sanitizeUserInput, safeJsonParse, redactSecrets } from "./config";

export { ServiceRegistry, globalServiceRegistry } from "./registry";

export { ConsoleLogger, globalLogger, InMemoryMetrics, globalMetrics, InMemoryAudit, NullAudit, globalAudit, Tracer, Span, SimpleEventBus, globalEventBus } from "./observability";
export type { StructuredLogEntry, MetricValue, MetricHistogram, SpanContext } from "./observability";

export { CircuitBreaker, CircuitBreakerRegistry, withCircuitBreaker, TokenBucket, RateLimiter, withRateLimit, Semaphore, ConcurrencyLimiter, Bulkhead, TTLCache, globalCache, InMemoryMemory, VectorMemory, globalMemory } from "./resilience";
export type { CircuitState, CircuitBreakerSnapshot, EmbeddingsAdapter, VectorStore } from "./resilience";

export { EnterpriseToolRunner, WorkflowEngine, CancellationToken } from "./execution";
export type { ToolRegistry, WorkflowProgress } from "./execution";

export { EnhancedPolicyEngine, globalPolicyEngine } from "./policy";
export type { PolicyRule, PolicyCheckArgs, RoleDefinition } from "./policy";

import { resolveConfig as _resolveConfig, uid as _uid } from "./config";
import { ServiceRegistry as _ServiceRegistry } from "./registry/serviceRegistry";
import { ConsoleLogger as _ConsoleLogger, InMemoryMetrics as _InMemoryMetrics, InMemoryAudit as _InMemoryAudit, NullAudit as _NullAudit, SimpleEventBus as _SimpleEventBus } from "./observability";
import { TTLCache as _TTLCache, InMemoryMemory as _InMemoryMemory } from "./resilience";
import { EnhancedPolicyEngine as _EnhancedPolicyEngine } from "./policy/enhancedPolicyEngine";
import { EnterpriseToolRunner as _EnterpriseToolRunner, ToolRegistry as IToolRegistry } from "./execution/toolRunner";
import { WorkflowEngine as _WorkflowEngine, CancellationToken as _CancellationToken } from "./execution/workflowEngine";
import { IliagptError as _IliagptError } from "./errors";
import type { 
  ResolvedConfig, 
  ToolContext, 
  UserIdentity, 
  AgentDefinition,
  ToolDefinition,
  ToolCall,
  WorkflowStep,
  WorkflowResult,
  LLMAdapter,
  ChatMessage,
  Memory as IMemory
} from "./types";
import { z } from "zod";

export class IliagptToolRegistry implements IToolRegistry {
  private tools = new Map<string, ToolDefinition<any, any>>();

  register<TParams extends z.ZodTypeAny, TResult>(tool: ToolDefinition<TParams, TResult>): void {
    if (this.tools.has(tool.name)) {
      throw new _IliagptError("E_INTERNAL", `Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition<any, any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new _IliagptError("E_TOOL_NOT_FOUND", `Tool not found: ${name}`);
    }
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Array<{ id: number; name: string; category: string; priority: string; description: string }> {
    return Array.from(this.tools.values()).map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      priority: t.priority,
      description: t.description,
    }));
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  clear(): void {
    this.tools.clear();
  }
}

export class IliagptAgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition): void {
    if (this.agents.has(agent.id)) {
      throw new _IliagptError("E_INTERNAL", `Agent already registered: ${agent.id}`);
    }
    this.agents.set(agent.id, agent);
  }

  get(id: string): AgentDefinition {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new _IliagptError("E_AGENT_NOT_FOUND", `Agent not found: ${id}`);
    }
    return agent;
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  unregister(id: string): boolean {
    return this.agents.delete(id);
  }

  clear(): void {
    this.agents.clear();
  }
}

export interface IliagptSystemOptions {
  config?: Partial<ResolvedConfig>;
  llmAdapter?: LLMAdapter;
  policyEngine?: _EnhancedPolicyEngine;
}

export class IliagptSystem {
  public readonly config: ResolvedConfig;
  public readonly tools: IliagptToolRegistry;
  public readonly agents: IliagptAgentRegistry;

  private readonly services: _ServiceRegistry;
  private readonly logger: _ConsoleLogger;
  private readonly metrics: _InMemoryMetrics;
  private readonly audit: _InMemoryAudit | _NullAudit;
  private readonly cache: _TTLCache;
  private readonly memory: _InMemoryMemory;
  private readonly events: _SimpleEventBus;
  private readonly policy: _EnhancedPolicyEngine;

  private readonly toolRunner: _EnterpriseToolRunner;
  private readonly workflow: _WorkflowEngine;

  private conversation: ChatMessage[] = [];

  constructor(options: IliagptSystemOptions = {}) {
    this.config = _resolveConfig(options.config ?? {});
    
    this.tools = new IliagptToolRegistry();
    this.agents = new IliagptAgentRegistry();
    this.services = new _ServiceRegistry();
    
    this.logger = new _ConsoleLogger(this.config.LOG_LEVEL);
    this.metrics = new _InMemoryMetrics();
    this.audit = this.config.ENABLE_AUDIT ? new _InMemoryAudit() : new _NullAudit();
    this.cache = new _TTLCache({ defaultTtlMs: this.config.CACHE_DEFAULT_TTL_MS });
    this.memory = new _InMemoryMemory();
    this.events = new _SimpleEventBus();
    this.policy = options.policyEngine ?? new _EnhancedPolicyEngine();

    this.toolRunner = new _EnterpriseToolRunner(this.tools, this.config, this.logger);
    this.workflow = new _WorkflowEngine(this.toolRunner, this.config.MAX_CONCURRENCY, this.logger);

    this.services.set("logger", this.logger);
    this.services.set("metrics", this.metrics);
    this.services.set("audit", this.audit);
    this.services.set("cache", this.cache);
    this.services.set("memory", this.memory);
    this.services.set("events", this.events);

    this.events.on("tool.failed", (p: Record<string, unknown>) => this.logger.warn("tool.failed", p));
  }

  private makeContext(user?: UserIdentity): ToolContext {
    const traceId = _uid("trace");
    const requestId = _uid("req");

    return {
      traceId,
      requestId,
      now: () => new Date(),
      user,
      config: this.config,
      logger: this.logger,
      metrics: this.metrics,
      audit: this.audit,
      cache: this.cache,
      memory: this.memory as IMemory,
      events: this.events,
      services: this.services,
      policy: this.policy,
    };
  }

  getHistory(): ChatMessage[] {
    return [...this.conversation];
  }

  clearHistory(): void {
    this.conversation = [];
  }

  listTools() {
    return this.tools.list();
  }

  listAgents() {
    return this.agents.list().map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      toolCount: a.allowTools.length,
    }));
  }

  async executeTool(call: ToolCall, user?: UserIdentity, agent?: AgentDefinition): Promise<unknown> {
    const ctx = this.makeContext(user);

    if (agent) {
      const tool = this.tools.get(call.tool);
      const decision = this.policy.canUseTool({ agent, toolName: call.tool, user, tool });
      
      if (!decision.allow) {
        throw new _IliagptError("E_POLICY_DENIED", decision.reason ?? "Policy denied", {
          agent: agent.id,
          tool: call.tool,
        });
      }
    }

    return await this.toolRunner.run(call.tool, call.params, ctx, call.options);
  }

  async runWorkflow(
    steps: WorkflowStep[],
    user?: UserIdentity,
    agent?: AgentDefinition,
    cancellationToken?: _CancellationToken
  ): Promise<WorkflowResult> {
    const ctx = this.makeContext(user);

    if (agent) {
      for (const step of steps) {
        const tool = this.tools.get(step.tool);
        const decision = this.policy.canUseTool({ agent, toolName: step.tool, user, tool });
        
        if (!decision.allow) {
          throw new _IliagptError("E_POLICY_DENIED", decision.reason ?? "Policy denied", {
            agent: agent.id,
            tool: step.tool,
          });
        }
      }
    }

    return await this.workflow.run(steps, ctx, cancellationToken);
  }

  getMetricsSnapshot() {
    return this.metrics.snapshot();
  }

  getAuditLog(filter?: { actor?: string; resource?: string }, limit?: number) {
    return this.audit.query(filter ?? {}, limit);
  }

  getCircuitState(toolName: string) {
    return this.toolRunner.getCircuitState(toolName);
  }

  resetCircuit(toolName: string) {
    this.toolRunner.resetCircuit(toolName);
  }

  resetAllCircuits() {
    this.toolRunner.resetAllCircuits();
  }

  getService<T>(name: string): T {
    return this.services.get<T>(name);
  }

  setService<T>(name: string, service: T): void {
    this.services.set(name, service);
  }
}
