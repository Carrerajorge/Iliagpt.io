import { z } from "zod";
import crypto from "crypto";
import { AGENT_REGISTRY, BaseAgent, AgentCapability, AgentTask, AgentResult } from "../langgraph/agents/types";
import { CircuitBreaker, Bulkhead, getOrCreateCircuitBreaker, getOrCreateBulkhead } from "./resilience";

export const AgentGovernanceState = {
  IDLE: "idle",
  PLANNING: "planning",
  EXECUTING: "executing",
  VERIFYING: "verifying",
  WAITING: "waiting",
  FAILED: "failed",
  COMPLETED: "completed",
  PAUSED: "paused",
} as const;

export type AgentGovernanceStateType = typeof AgentGovernanceState[keyof typeof AgentGovernanceState];

export const AgentStateSchema = z.enum([
  "idle",
  "planning",
  "executing",
  "verifying",
  "waiting",
  "failed",
  "completed",
  "paused",
]);

export const StateTransitions: Record<AgentGovernanceStateType, AgentGovernanceStateType[]> = {
  [AgentGovernanceState.IDLE]: [AgentGovernanceState.PLANNING, AgentGovernanceState.EXECUTING, AgentGovernanceState.PAUSED],
  [AgentGovernanceState.PLANNING]: [AgentGovernanceState.EXECUTING, AgentGovernanceState.FAILED, AgentGovernanceState.PAUSED, AgentGovernanceState.IDLE],
  [AgentGovernanceState.EXECUTING]: [AgentGovernanceState.VERIFYING, AgentGovernanceState.WAITING, AgentGovernanceState.FAILED, AgentGovernanceState.PAUSED, AgentGovernanceState.COMPLETED],
  [AgentGovernanceState.VERIFYING]: [AgentGovernanceState.COMPLETED, AgentGovernanceState.FAILED, AgentGovernanceState.EXECUTING],
  [AgentGovernanceState.WAITING]: [AgentGovernanceState.EXECUTING, AgentGovernanceState.FAILED, AgentGovernanceState.PAUSED, AgentGovernanceState.IDLE],
  [AgentGovernanceState.FAILED]: [AgentGovernanceState.IDLE, AgentGovernanceState.PLANNING],
  [AgentGovernanceState.COMPLETED]: [AgentGovernanceState.IDLE],
  [AgentGovernanceState.PAUSED]: [AgentGovernanceState.IDLE, AgentGovernanceState.PLANNING, AgentGovernanceState.EXECUTING],
};

export interface TelemetryEvent {
  id: string;
  timestamp: string;
  agentId: string;
  agentName: string;
  eventType: "state_change" | "task_start" | "task_complete" | "task_fail" | "delegation" | "fallback" | "capability_check" | "load_shed" | "timeout" | "cancel";
  previousState?: AgentGovernanceStateType;
  currentState?: AgentGovernanceStateType;
  taskId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  error?: string;
  tokensUsed?: number;
  toolCalls?: number;
}

export interface TelemetryStats {
  agentId: string;
  agentName: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageDurationMs: number;
  p95DurationMs: number;
  successRate: number;
  tokensConsumed: number;
  stateTransitions: Record<string, number>;
  lastActiveAt: string;
  delegationsReceived: number;
  delegationsForwarded: number;
  fallbacksTriggered: number;
}

export const TelemetrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  eventType: z.enum(["state_change", "task_start", "task_complete", "task_fail", "delegation", "fallback", "capability_check", "load_shed", "timeout", "cancel"]),
  previousState: AgentStateSchema.optional(),
  currentState: AgentStateSchema.optional(),
  taskId: z.string().optional(),
  durationMs: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  tokensUsed: z.number().optional(),
  toolCalls: z.number().optional(),
});

export const CAPABILITY_MAPPINGS: Record<string, string[]> = {
  OrchestratorAgent: ["plan_execution", "delegate_task", "coordinate_workflow", "orchestrate", "decide", "reflect"],
  ResearchAgent: ["web_search", "deep_research", "fact_check", "fetch_url", "browser_extract"],
  CodeAgent: ["generate_code", "review_code", "debug_code", "code_refactor", "code_test"],
  DataAgent: ["analyze_data", "transform_data", "visualize_data", "data_query"],
  ContentAgent: ["write_article", "create_document", "create_marketing", "generate_text", "doc_create", "slides_create"],
  CommunicationAgent: ["compose_email", "create_notification", "email_send", "notification_push", "message"],
  BrowserAgent: ["navigate", "scrape", "automate", "browser_navigate", "browser_interact", "browser_session"],
  DocumentAgent: ["parse_document", "convert_document", "analyze_document", "pdf_manipulate", "spreadsheet_create", "ocr_extract"],
  QAAgent: ["generate_tests", "validate", "find_bugs", "code_test", "verify", "health_check"],
  SecurityAgent: ["vulnerability_scan", "security_audit", "compliance_check", "encrypt_data", "decrypt_data", "validate_input"],
};

export const FALLBACK_MAPPINGS: Record<string, string[]> = {
  OrchestratorAgent: [],
  ResearchAgent: ["BrowserAgent", "ContentAgent"],
  CodeAgent: ["QAAgent", "OrchestratorAgent"],
  DataAgent: ["CodeAgent", "OrchestratorAgent"],
  ContentAgent: ["ResearchAgent", "DocumentAgent"],
  CommunicationAgent: ["ContentAgent", "OrchestratorAgent"],
  BrowserAgent: ["ResearchAgent", "OrchestratorAgent"],
  DocumentAgent: ["ContentAgent", "CodeAgent"],
  QAAgent: ["CodeAgent", "SecurityAgent"],
  SecurityAgent: ["QAAgent", "CodeAgent"],
};

export interface LoadSheddingConfig {
  maxConcurrentTasks: number;
  queueSize: number;
  cooldownMs: number;
  priorityBoost: boolean;
}

export const DEFAULT_LOAD_SHEDDING_CONFIG: LoadSheddingConfig = {
  maxConcurrentTasks: 5,
  queueSize: 20,
  cooldownMs: 1000,
  priorityBoost: true,
};

export const AGENT_LOAD_CONFIGS: Record<string, LoadSheddingConfig> = {
  OrchestratorAgent: { maxConcurrentTasks: 10, queueSize: 50, cooldownMs: 500, priorityBoost: true },
  ResearchAgent: { maxConcurrentTasks: 8, queueSize: 30, cooldownMs: 1000, priorityBoost: false },
  CodeAgent: { maxConcurrentTasks: 6, queueSize: 25, cooldownMs: 800, priorityBoost: true },
  DataAgent: { maxConcurrentTasks: 4, queueSize: 20, cooldownMs: 1500, priorityBoost: false },
  ContentAgent: { maxConcurrentTasks: 6, queueSize: 25, cooldownMs: 1000, priorityBoost: false },
  CommunicationAgent: { maxConcurrentTasks: 10, queueSize: 50, cooldownMs: 500, priorityBoost: true },
  BrowserAgent: { maxConcurrentTasks: 3, queueSize: 15, cooldownMs: 2000, priorityBoost: false },
  DocumentAgent: { maxConcurrentTasks: 5, queueSize: 20, cooldownMs: 1500, priorityBoost: false },
  QAAgent: { maxConcurrentTasks: 4, queueSize: 20, cooldownMs: 1500, priorityBoost: false },
  SecurityAgent: { maxConcurrentTasks: 4, queueSize: 15, cooldownMs: 2000, priorityBoost: true },
};

export interface TimeoutConfig {
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  gracePeriodMs: number;
}

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  defaultTimeoutMs: 60000,
  maxTimeoutMs: 300000,
  gracePeriodMs: 5000,
};

export interface CancellationToken {
  id: string;
  taskId: string;
  agentId: string;
  cancelled: boolean;
  reason?: string;
  cancelledAt?: string;
  onCancel: (() => void)[];
}

export class AgentStateMachine {
  private state: AgentGovernanceStateType = AgentGovernanceState.IDLE;
  private stateHistory: Array<{ state: AgentGovernanceStateType; timestamp: string; reason?: string }> = [];
  private readonly agentId: string;
  private readonly agentName: string;

  constructor(agentId: string, agentName: string) {
    this.agentId = agentId;
    this.agentName = agentName;
    this.stateHistory.push({ state: this.state, timestamp: new Date().toISOString() });
  }

  getState(): AgentGovernanceStateType {
    return this.state;
  }

  getStateHistory(): Array<{ state: AgentGovernanceStateType; timestamp: string; reason?: string }> {
    return [...this.stateHistory];
  }

  canTransitionTo(targetState: AgentGovernanceStateType): boolean {
    const allowedTransitions = StateTransitions[this.state];
    return allowedTransitions.includes(targetState);
  }

  transitionTo(targetState: AgentGovernanceStateType, reason?: string): boolean {
    if (!this.canTransitionTo(targetState)) {
      console.warn(`[StateMachine] Invalid transition: ${this.state} -> ${targetState} for agent ${this.agentName}`);
      return false;
    }

    const previousState = this.state;
    this.state = targetState;
    this.stateHistory.push({ state: targetState, timestamp: new Date().toISOString(), reason });

    if (this.stateHistory.length > 100) {
      this.stateHistory = this.stateHistory.slice(-50);
    }

    console.log(`[StateMachine] ${this.agentName}: ${previousState} -> ${targetState}${reason ? ` (${reason})` : ""}`);
    return true;
  }

  reset(): void {
    this.state = AgentGovernanceState.IDLE;
    this.stateHistory.push({ state: this.state, timestamp: new Date().toISOString(), reason: "reset" });
  }

  isActive(): boolean {
    return [AgentGovernanceState.PLANNING, AgentGovernanceState.EXECUTING, AgentGovernanceState.VERIFYING].includes(this.state);
  }

  isPaused(): boolean {
    return this.state === AgentGovernanceState.PAUSED;
  }

  isFailed(): boolean {
    return this.state === AgentGovernanceState.FAILED;
  }

  isIdle(): boolean {
    return this.state === AgentGovernanceState.IDLE;
  }
}

export class TelemetryCollector {
  private events: TelemetryEvent[] = [];
  private stats: Map<string, TelemetryStats> = new Map();
  private readonly maxEvents: number;
  private readonly flushIntervalMs: number;
  private flushCallback?: (events: TelemetryEvent[]) => Promise<void>;

  constructor(maxEvents: number = 10000, flushIntervalMs: number = 60000) {
    this.maxEvents = maxEvents;
    this.flushIntervalMs = flushIntervalMs;
  }

  setFlushCallback(callback: (events: TelemetryEvent[]) => Promise<void>): void {
    this.flushCallback = callback;
  }

  recordEvent(event: Omit<TelemetryEvent, "id" | "timestamp">): TelemetryEvent {
    const fullEvent: TelemetryEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.events.push(fullEvent);
    this.updateStats(fullEvent);

    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents / 2);
    }

    return fullEvent;
  }

  recordStateChange(agentId: string, agentName: string, previousState: AgentGovernanceStateType, currentState: AgentGovernanceStateType, metadata?: Record<string, unknown>): TelemetryEvent {
    return this.recordEvent({
      agentId,
      agentName,
      eventType: "state_change",
      previousState,
      currentState,
      metadata,
    });
  }

  recordTaskStart(agentId: string, agentName: string, taskId: string, metadata?: Record<string, unknown>): TelemetryEvent {
    return this.recordEvent({
      agentId,
      agentName,
      eventType: "task_start",
      taskId,
      currentState: AgentGovernanceState.EXECUTING,
      metadata,
    });
  }

  recordTaskComplete(agentId: string, agentName: string, taskId: string, durationMs: number, tokensUsed?: number, toolCalls?: number): TelemetryEvent {
    return this.recordEvent({
      agentId,
      agentName,
      eventType: "task_complete",
      taskId,
      currentState: AgentGovernanceState.COMPLETED,
      durationMs,
      tokensUsed,
      toolCalls,
    });
  }

  recordTaskFail(agentId: string, agentName: string, taskId: string, error: string, durationMs: number): TelemetryEvent {
    return this.recordEvent({
      agentId,
      agentName,
      eventType: "task_fail",
      taskId,
      currentState: AgentGovernanceState.FAILED,
      error,
      durationMs,
    });
  }

  recordDelegation(fromAgentId: string, fromAgentName: string, toAgentName: string, taskId: string, reason?: string): TelemetryEvent {
    return this.recordEvent({
      agentId: fromAgentId,
      agentName: fromAgentName,
      eventType: "delegation",
      taskId,
      metadata: { toAgent: toAgentName, reason },
    });
  }

  recordFallback(agentId: string, agentName: string, fallbackAgentName: string, taskId: string, reason: string): TelemetryEvent {
    return this.recordEvent({
      agentId,
      agentName,
      eventType: "fallback",
      taskId,
      metadata: { fallbackAgent: fallbackAgentName, reason },
    });
  }

  recordLoadShed(agentId: string, agentName: string, taskId: string, reason: string): TelemetryEvent {
    return this.recordEvent({
      agentId,
      agentName,
      eventType: "load_shed",
      taskId,
      metadata: { reason },
    });
  }

  recordTimeout(agentId: string, agentName: string, taskId: string, timeoutMs: number): TelemetryEvent {
    return this.recordEvent({
      agentId,
      agentName,
      eventType: "timeout",
      taskId,
      durationMs: timeoutMs,
      error: `Task timed out after ${timeoutMs}ms`,
    });
  }

  recordCancel(agentId: string, agentName: string, taskId: string, reason: string): TelemetryEvent {
    return this.recordEvent({
      agentId,
      agentName,
      eventType: "cancel",
      taskId,
      metadata: { reason },
    });
  }

  private updateStats(event: TelemetryEvent): void {
    const key = event.agentId;
    let stats = this.stats.get(key);

    if (!stats) {
      stats = {
        agentId: event.agentId,
        agentName: event.agentName,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        averageDurationMs: 0,
        p95DurationMs: 0,
        successRate: 0,
        tokensConsumed: 0,
        stateTransitions: {},
        lastActiveAt: event.timestamp,
        delegationsReceived: 0,
        delegationsForwarded: 0,
        fallbacksTriggered: 0,
      };
      this.stats.set(key, stats);
    }

    stats.lastActiveAt = event.timestamp;

    if (event.eventType === "task_start") {
      stats.totalTasks++;
    } else if (event.eventType === "task_complete") {
      stats.completedTasks++;
      if (event.durationMs) {
        const durations = this.getDurationsForAgent(event.agentId);
        durations.push(event.durationMs);
        stats.averageDurationMs = durations.reduce((a, b) => a + b, 0) / durations.length;
        stats.p95DurationMs = this.calculateP95(durations);
      }
      if (event.tokensUsed) {
        stats.tokensConsumed += event.tokensUsed;
      }
    } else if (event.eventType === "task_fail") {
      stats.failedTasks++;
    } else if (event.eventType === "state_change" && event.currentState) {
      stats.stateTransitions[event.currentState] = (stats.stateTransitions[event.currentState] || 0) + 1;
    } else if (event.eventType === "delegation") {
      stats.delegationsForwarded++;
    } else if (event.eventType === "fallback") {
      stats.fallbacksTriggered++;
    }

    if (stats.totalTasks > 0) {
      stats.successRate = stats.completedTasks / stats.totalTasks;
    }
  }

  private getDurationsForAgent(agentId: string): number[] {
    return this.events
      .filter(e => e.agentId === agentId && e.eventType === "task_complete" && e.durationMs)
      .map(e => e.durationMs!)
      .slice(-100);
  }

  private calculateP95(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  getStats(agentId?: string): TelemetryStats | Map<string, TelemetryStats> | undefined {
    if (agentId) {
      return this.stats.get(agentId);
    }
    return new Map(this.stats);
  }

  getRecentEvents(limit: number = 100, agentId?: string): TelemetryEvent[] {
    let events = this.events;
    if (agentId) {
      events = events.filter(e => e.agentId === agentId);
    }
    return events.slice(-limit);
  }

  getEventsByType(eventType: TelemetryEvent["eventType"], limit: number = 100): TelemetryEvent[] {
    return this.events.filter(e => e.eventType === eventType).slice(-limit);
  }

  async flush(): Promise<void> {
    if (this.flushCallback && this.events.length > 0) {
      await this.flushCallback([...this.events]);
    }
  }

  clear(): void {
    this.events = [];
    this.stats.clear();
  }
}

export class CapabilityVerifier {
  private capabilityCache: Map<string, Set<string>> = new Map();

  refreshCapabilities(): void {
    this.capabilityCache.clear();
    for (const [name, agent] of AGENT_REGISTRY) {
      const capabilities = new Set<string>();
      
      const agentCapabilities = agent.getCapabilities();
      for (const cap of agentCapabilities) {
        capabilities.add(cap.name);
      }
      
      const mappedCaps = CAPABILITY_MAPPINGS[name];
      if (mappedCaps) {
        for (const cap of mappedCaps) {
          capabilities.add(cap);
        }
      }
      
      this.capabilityCache.set(name, capabilities);
    }
  }

  hasCapability(agentName: string, capability: string): boolean {
    if (this.capabilityCache.size === 0) {
      this.refreshCapabilities();
    }
    
    const caps = this.capabilityCache.get(agentName);
    if (!caps) return false;
    
    return caps.has(capability) || Array.from(caps).some(c => c.includes(capability) || capability.includes(c));
  }

  getCapabilities(agentName: string): string[] {
    if (this.capabilityCache.size === 0) {
      this.refreshCapabilities();
    }
    
    const caps = this.capabilityCache.get(agentName);
    return caps ? Array.from(caps) : [];
  }

  findAgentsWithCapability(capability: string): string[] {
    if (this.capabilityCache.size === 0) {
      this.refreshCapabilities();
    }
    
    const agents: string[] = [];
    for (const [name, caps] of this.capabilityCache) {
      if (caps.has(capability) || Array.from(caps).some(c => c.includes(capability) || capability.includes(c))) {
        agents.push(name);
      }
    }
    return agents;
  }

  verifyTaskCapabilities(agentName: string, requiredCapabilities: string[]): { verified: boolean; missing: string[] } {
    const missing: string[] = [];
    for (const cap of requiredCapabilities) {
      if (!this.hasCapability(agentName, cap)) {
        missing.push(cap);
      }
    }
    return {
      verified: missing.length === 0,
      missing,
    };
  }

  getBestAgentForCapabilities(requiredCapabilities: string[]): { agentName: string; matchScore: number } | null {
    if (this.capabilityCache.size === 0) {
      this.refreshCapabilities();
    }

    let bestAgent: string | null = null;
    let bestScore = 0;

    for (const [name, caps] of this.capabilityCache) {
      let score = 0;
      for (const reqCap of requiredCapabilities) {
        if (caps.has(reqCap) || Array.from(caps).some(c => c.includes(reqCap) || reqCap.includes(c))) {
          score++;
        }
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestAgent = name;
      }
    }

    if (bestAgent) {
      return { agentName: bestAgent, matchScore: bestScore / requiredCapabilities.length };
    }
    return null;
  }
}

export class DelegationManager {
  private readonly fallbackMappings: Record<string, string[]>;
  private readonly telemetry: TelemetryCollector;
  private readonly capabilityVerifier: CapabilityVerifier;

  constructor(telemetry: TelemetryCollector, capabilityVerifier: CapabilityVerifier) {
    this.fallbackMappings = FALLBACK_MAPPINGS;
    this.telemetry = telemetry;
    this.capabilityVerifier = capabilityVerifier;
  }

  getFallbackAgents(agentName: string): string[] {
    return this.fallbackMappings[agentName] || [];
  }

  async delegateTask(
    fromAgentName: string,
    task: AgentTask,
    reason: string
  ): Promise<{ agentName: string; agent: BaseAgent } | null> {
    const fallbacks = this.getFallbackAgents(fromAgentName);
    
    for (const fallbackName of fallbacks) {
      const agent = AGENT_REGISTRY.get(fallbackName);
      if (!agent) continue;

      const state = agent.getState();
      if (state.status === "running") continue;

      this.telemetry.recordFallback(
        state.id,
        fromAgentName,
        fallbackName,
        task.id,
        reason
      );

      return { agentName: fallbackName, agent };
    }

    const requiredCapabilities = this.inferRequiredCapabilities(task);
    if (requiredCapabilities.length > 0) {
      const best = this.capabilityVerifier.getBestAgentForCapabilities(requiredCapabilities);
      if (best && best.agentName !== fromAgentName) {
        const agent = AGENT_REGISTRY.get(best.agentName);
        if (agent) {
          this.telemetry.recordDelegation(
            crypto.randomUUID(),
            fromAgentName,
            best.agentName,
            task.id,
            `Capability match: ${best.matchScore * 100}%`
          );
          return { agentName: best.agentName, agent };
        }
      }
    }

    return null;
  }

  private inferRequiredCapabilities(task: AgentTask): string[] {
    const capabilities: string[] = [];
    const desc = task.description.toLowerCase();

    if (desc.includes("search") || desc.includes("research")) capabilities.push("web_search");
    if (desc.includes("code") || desc.includes("generate")) capabilities.push("generate_code");
    if (desc.includes("analyze") || desc.includes("data")) capabilities.push("analyze_data");
    if (desc.includes("document") || desc.includes("write")) capabilities.push("create_document");
    if (desc.includes("email") || desc.includes("send")) capabilities.push("compose_email");
    if (desc.includes("browse") || desc.includes("navigate")) capabilities.push("navigate");
    if (desc.includes("test") || desc.includes("validate")) capabilities.push("generate_tests");
    if (desc.includes("security") || desc.includes("encrypt")) capabilities.push("vulnerability_scan");

    return capabilities;
  }

  shouldDelegate(agentName: string, result: AgentResult): boolean {
    if (!result.success) return true;
    return false;
  }
}

export class LoadShedder {
  private readonly configs: Map<string, LoadSheddingConfig> = new Map();
  private readonly activeTasks: Map<string, Set<string>> = new Map();
  private readonly queues: Map<string, Array<{ task: AgentTask; priority: number; enqueuedAt: number }>> = new Map();
  private readonly bulkheads: Map<string, Bulkhead> = new Map();
  private readonly cooldowns: Map<string, number> = new Map();
  private readonly telemetry: TelemetryCollector;

  constructor(telemetry: TelemetryCollector) {
    this.telemetry = telemetry;
    this.initializeConfigs();
  }

  private initializeConfigs(): void {
    for (const [agentName, config] of Object.entries(AGENT_LOAD_CONFIGS)) {
      this.configs.set(agentName, config);
      this.activeTasks.set(agentName, new Set());
      this.queues.set(agentName, []);
      this.bulkheads.set(agentName, getOrCreateBulkhead(agentName, {
        maxConcurrent: config.maxConcurrentTasks,
        maxQueue: config.queueSize,
        queueTimeoutMs: 30000,
      }));
    }
  }

  canAcceptTask(agentName: string): boolean {
    const config = this.configs.get(agentName) || DEFAULT_LOAD_SHEDDING_CONFIG;
    const active = this.activeTasks.get(agentName);
    const queue = this.queues.get(agentName);

    if (!active || !queue) {
      this.activeTasks.set(agentName, new Set());
      this.queues.set(agentName, []);
      return true;
    }

    const cooldownUntil = this.cooldowns.get(agentName) || 0;
    if (Date.now() < cooldownUntil) {
      return false;
    }

    if (active.size >= config.maxConcurrentTasks) {
      return queue.length < config.queueSize;
    }

    return true;
  }

  async acquireSlot(agentName: string, taskId: string): Promise<boolean> {
    const config = this.configs.get(agentName) || DEFAULT_LOAD_SHEDDING_CONFIG;
    const active = this.activeTasks.get(agentName) || new Set();

    if (active.size >= config.maxConcurrentTasks) {
      return false;
    }

    active.add(taskId);
    this.activeTasks.set(agentName, active);
    return true;
  }

  releaseSlot(agentName: string, taskId: string): void {
    const active = this.activeTasks.get(agentName);
    if (active) {
      active.delete(taskId);
    }

    this.processQueue(agentName);
  }

  enqueueTask(agentName: string, task: AgentTask): boolean {
    const config = this.configs.get(agentName) || DEFAULT_LOAD_SHEDDING_CONFIG;
    const queue = this.queues.get(agentName) || [];

    if (queue.length >= config.queueSize) {
      this.telemetry.recordLoadShed(
        crypto.randomUUID(),
        agentName,
        task.id,
        "Queue full"
      );
      return false;
    }

    const priority = this.getPriorityScore(task.priority, config.priorityBoost);
    queue.push({ task, priority, enqueuedAt: Date.now() });
    queue.sort((a, b) => b.priority - a.priority);
    this.queues.set(agentName, queue);
    return true;
  }

  dequeueTask(agentName: string): AgentTask | null {
    const queue = this.queues.get(agentName);
    if (!queue || queue.length === 0) return null;

    const item = queue.shift()!;
    this.queues.set(agentName, queue);
    return item.task;
  }

  private processQueue(agentName: string): void {
    const task = this.dequeueTask(agentName);
    if (task) {
      this.acquireSlot(agentName, task.id);
    }
  }

  private getPriorityScore(priority: AgentTask["priority"], boost: boolean): number {
    const scores: Record<string, number> = {
      critical: 100,
      high: 75,
      medium: 50,
      low: 25,
    };
    let score = scores[priority] || 50;
    if (boost && priority === "critical") {
      score += 25;
    }
    return score;
  }

  triggerCooldown(agentName: string): void {
    const config = this.configs.get(agentName) || DEFAULT_LOAD_SHEDDING_CONFIG;
    this.cooldowns.set(agentName, Date.now() + config.cooldownMs);
  }

  getLoadMetrics(agentName?: string): Record<string, { active: number; queued: number; config: LoadSheddingConfig }> {
    const metrics: Record<string, { active: number; queued: number; config: LoadSheddingConfig }> = {};

    const agents = agentName ? [agentName] : Array.from(this.configs.keys());

    for (const name of agents) {
      const config = this.configs.get(name) || DEFAULT_LOAD_SHEDDING_CONFIG;
      const active = this.activeTasks.get(name)?.size || 0;
      const queued = this.queues.get(name)?.length || 0;
      metrics[name] = { active, queued, config };
    }

    return metrics;
  }

  isOverloaded(agentName: string): boolean {
    const config = this.configs.get(agentName) || DEFAULT_LOAD_SHEDDING_CONFIG;
    const active = this.activeTasks.get(agentName)?.size || 0;
    const queued = this.queues.get(agentName)?.length || 0;
    
    return active >= config.maxConcurrentTasks && queued >= config.queueSize * 0.8;
  }
}

export class TimeoutManager {
  private readonly config: TimeoutConfig;
  private readonly activeTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly telemetry: TelemetryCollector;

  constructor(telemetry: TelemetryCollector, config: TimeoutConfig = DEFAULT_TIMEOUT_CONFIG) {
    this.config = config;
    this.telemetry = telemetry;
  }

  setTimeout(taskId: string, agentId: string, agentName: string, timeoutMs?: number, onTimeout?: () => void): void {
    const effectiveTimeout = Math.min(timeoutMs || this.config.defaultTimeoutMs, this.config.maxTimeoutMs);

    const timeoutHandle = setTimeout(() => {
      this.telemetry.recordTimeout(agentId, agentName, taskId, effectiveTimeout);
      onTimeout?.();
      this.clearTimeout(taskId);
    }, effectiveTimeout);

    this.activeTimeouts.set(taskId, timeoutHandle);
  }

  clearTimeout(taskId: string): void {
    const handle = this.activeTimeouts.get(taskId);
    if (handle) {
      clearTimeout(handle);
      this.activeTimeouts.delete(taskId);
    }
  }

  extendTimeout(taskId: string, extensionMs: number): boolean {
    return false;
  }

  getActiveTimeouts(): string[] {
    return Array.from(this.activeTimeouts.keys());
  }
}

export class CancellationManager {
  private readonly tokens: Map<string, CancellationToken> = new Map();
  private readonly telemetry: TelemetryCollector;

  constructor(telemetry: TelemetryCollector) {
    this.telemetry = telemetry;
  }

  createToken(taskId: string, agentId: string): CancellationToken {
    const token: CancellationToken = {
      id: crypto.randomUUID(),
      taskId,
      agentId,
      cancelled: false,
      onCancel: [],
    };
    this.tokens.set(taskId, token);
    return token;
  }

  cancel(taskId: string, reason: string): boolean {
    const token = this.tokens.get(taskId);
    if (!token || token.cancelled) return false;

    token.cancelled = true;
    token.reason = reason;
    token.cancelledAt = new Date().toISOString();

    this.telemetry.recordCancel(token.agentId, "Unknown", taskId, reason);

    for (const callback of token.onCancel) {
      try {
        callback();
      } catch (e) {
        console.error("[CancellationManager] Error in cancel callback:", e);
      }
    }

    return true;
  }

  isCancelled(taskId: string): boolean {
    return this.tokens.get(taskId)?.cancelled || false;
  }

  getToken(taskId: string): CancellationToken | undefined {
    return this.tokens.get(taskId);
  }

  onCancel(taskId: string, callback: () => void): void {
    const token = this.tokens.get(taskId);
    if (token) {
      token.onCancel.push(callback);
    }
  }

  cleanup(taskId: string): void {
    this.tokens.delete(taskId);
  }

  getActiveTasks(): string[] {
    return Array.from(this.tokens.entries())
      .filter(([_, token]) => !token.cancelled)
      .map(([taskId]) => taskId);
  }
}

export class AgentGovernor {
  private readonly stateMachines: Map<string, AgentStateMachine> = new Map();
  private readonly telemetry: TelemetryCollector;
  private readonly capabilityVerifier: CapabilityVerifier;
  private readonly delegationManager: DelegationManager;
  private readonly loadShedder: LoadShedder;
  private readonly timeoutManager: TimeoutManager;
  private readonly cancellationManager: CancellationManager;
  private readonly circuitBreakers: Map<string, CircuitBreaker> = new Map();

  constructor(options?: {
    timeoutConfig?: TimeoutConfig;
    flushCallback?: (events: TelemetryEvent[]) => Promise<void>;
  }) {
    this.telemetry = new TelemetryCollector();
    this.capabilityVerifier = new CapabilityVerifier();
    this.delegationManager = new DelegationManager(this.telemetry, this.capabilityVerifier);
    this.loadShedder = new LoadShedder(this.telemetry);
    this.timeoutManager = new TimeoutManager(this.telemetry, options?.timeoutConfig);
    this.cancellationManager = new CancellationManager(this.telemetry);

    if (options?.flushCallback) {
      this.telemetry.setFlushCallback(options.flushCallback);
    }

    this.initializeAgents();
  }

  private initializeAgents(): void {
    for (const [name, agent] of AGENT_REGISTRY) {
      const state = agent.getState();
      this.stateMachines.set(name, new AgentStateMachine(state.id, name));
      this.circuitBreakers.set(name, getOrCreateCircuitBreaker(name, {
        failureThreshold: 5,
        successThreshold: 3,
        resetTimeoutMs: 30000,
      }));
    }
    this.capabilityVerifier.refreshCapabilities();
  }

  getAgentState(agentName: string): AgentGovernanceStateType | undefined {
    return this.stateMachines.get(agentName)?.getState();
  }

  transitionState(agentName: string, targetState: AgentGovernanceStateType, reason?: string): boolean {
    const machine = this.stateMachines.get(agentName);
    if (!machine) return false;

    const previousState = machine.getState();
    const success = machine.transitionTo(targetState, reason);

    if (success) {
      const agent = AGENT_REGISTRY.get(agentName);
      this.telemetry.recordStateChange(
        agent?.getState().id || agentName,
        agentName,
        previousState,
        targetState,
        { reason }
      );
    }

    return success;
  }

  canAcceptTask(agentName: string, requiredCapabilities?: string[]): { canAccept: boolean; reason?: string } {
    const circuitBreaker = this.circuitBreakers.get(agentName);
    if (circuitBreaker && !circuitBreaker.canExecute()) {
      return { canAccept: false, reason: "Circuit breaker open" };
    }

    if (!this.loadShedder.canAcceptTask(agentName)) {
      return { canAccept: false, reason: "Agent overloaded" };
    }

    const machine = this.stateMachines.get(agentName);
    if (machine && !machine.canTransitionTo(AgentGovernanceState.EXECUTING)) {
      return { canAccept: false, reason: `Invalid state: ${machine.getState()}` };
    }

    if (requiredCapabilities && requiredCapabilities.length > 0) {
      const verification = this.capabilityVerifier.verifyTaskCapabilities(agentName, requiredCapabilities);
      if (!verification.verified) {
        return { canAccept: false, reason: `Missing capabilities: ${verification.missing.join(", ")}` };
      }
    }

    return { canAccept: true };
  }

  async executeWithGovernance(
    agentName: string,
    task: AgentTask,
    options?: {
      timeoutMs?: number;
      requiredCapabilities?: string[];
      allowFallback?: boolean;
    }
  ): Promise<AgentResult> {
    const agent = AGENT_REGISTRY.get(agentName);
    if (!agent) {
      return {
        taskId: task.id,
        agentId: "unknown",
        success: false,
        error: `Agent ${agentName} not found`,
        duration: 0,
      };
    }

    const canAccept = this.canAcceptTask(agentName, options?.requiredCapabilities);
    if (!canAccept.canAccept) {
      if (options?.allowFallback !== false) {
        const fallback = await this.delegationManager.delegateTask(agentName, task, canAccept.reason || "Cannot accept");
        if (fallback) {
          return this.executeWithGovernance(fallback.agentName, task, { ...options, allowFallback: false });
        }
      }
      return {
        taskId: task.id,
        agentId: agent.getState().id,
        success: false,
        error: canAccept.reason,
        duration: 0,
      };
    }

    const cancellationToken = this.cancellationManager.createToken(task.id, agent.getState().id);
    await this.loadShedder.acquireSlot(agentName, task.id);
    this.transitionState(agentName, AgentGovernanceState.PLANNING, "Task started");

    const startTime = Date.now();
    this.telemetry.recordTaskStart(agent.getState().id, agentName, task.id, { task });

    this.timeoutManager.setTimeout(
      task.id,
      agent.getState().id,
      agentName,
      options?.timeoutMs || task.timeout,
      () => {
        this.cancellationManager.cancel(task.id, "Timeout");
        this.transitionState(agentName, AgentGovernanceState.FAILED, "Timeout");
      }
    );

    try {
      this.transitionState(agentName, AgentGovernanceState.EXECUTING, "Execution started");

      const result = await agent.execute(task);
      const duration = Date.now() - startTime;

      this.timeoutManager.clearTimeout(task.id);

      if (this.cancellationManager.isCancelled(task.id)) {
        this.circuitBreakers.get(agentName)?.recordFailure();
        return {
          taskId: task.id,
          agentId: agent.getState().id,
          success: false,
          error: "Task cancelled",
          duration,
        };
      }

      if (result.success) {
        this.circuitBreakers.get(agentName)?.recordSuccess();
        this.transitionState(agentName, AgentGovernanceState.VERIFYING, "Verifying result");
        this.transitionState(agentName, AgentGovernanceState.COMPLETED, "Task completed");
        this.telemetry.recordTaskComplete(
          agent.getState().id,
          agentName,
          task.id,
          duration,
          result.tokensUsed,
          result.toolCalls?.length
        );
      } else {
        this.circuitBreakers.get(agentName)?.recordFailure();
        this.transitionState(agentName, AgentGovernanceState.FAILED, result.error);
        this.telemetry.recordTaskFail(agent.getState().id, agentName, task.id, result.error || "Unknown error", duration);

        if (options?.allowFallback !== false) {
          const fallback = await this.delegationManager.delegateTask(agentName, task, result.error || "Task failed");
          if (fallback) {
            this.loadShedder.releaseSlot(agentName, task.id);
            return this.executeWithGovernance(fallback.agentName, task, { ...options, allowFallback: false });
          }
        }
      }

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.timeoutManager.clearTimeout(task.id);
      this.circuitBreakers.get(agentName)?.recordFailure();
      this.transitionState(agentName, AgentGovernanceState.FAILED, error.message);
      this.telemetry.recordTaskFail(agent.getState().id, agentName, task.id, error.message, duration);
      this.loadShedder.triggerCooldown(agentName);

      return {
        taskId: task.id,
        agentId: agent.getState().id,
        success: false,
        error: error.message,
        duration,
      };
    } finally {
      this.loadShedder.releaseSlot(agentName, task.id);
      this.cancellationManager.cleanup(task.id);
      this.transitionState(agentName, AgentGovernanceState.IDLE, "Ready for next task");
    }
  }

  cancelTask(taskId: string, reason: string): boolean {
    return this.cancellationManager.cancel(taskId, reason);
  }

  pauseAgent(agentName: string): boolean {
    return this.transitionState(agentName, AgentGovernanceState.PAUSED, "Manually paused");
  }

  resumeAgent(agentName: string): boolean {
    const machine = this.stateMachines.get(agentName);
    if (machine?.isPaused()) {
      return this.transitionState(agentName, AgentGovernanceState.IDLE, "Manually resumed");
    }
    return false;
  }

  getCapabilities(agentName: string): string[] {
    return this.capabilityVerifier.getCapabilities(agentName);
  }

  findAgentsForCapability(capability: string): string[] {
    return this.capabilityVerifier.findAgentsWithCapability(capability);
  }

  getBestAgentForTask(requiredCapabilities: string[]): { agentName: string; matchScore: number } | null {
    return this.capabilityVerifier.getBestAgentForCapabilities(requiredCapabilities);
  }

  getTelemetryStats(agentId?: string): TelemetryStats | Map<string, TelemetryStats> | undefined {
    return this.telemetry.getStats(agentId);
  }

  getRecentEvents(limit?: number, agentId?: string): TelemetryEvent[] {
    return this.telemetry.getRecentEvents(limit, agentId);
  }

  getLoadMetrics(agentName?: string): Record<string, { active: number; queued: number; config: LoadSheddingConfig }> {
    return this.loadShedder.getLoadMetrics(agentName);
  }

  getCircuitBreakerStatus(agentName: string): { state: string; canExecute: boolean } | undefined {
    const cb = this.circuitBreakers.get(agentName);
    if (!cb) return undefined;
    return {
      state: cb.getState(),
      canExecute: cb.canExecute(),
    };
  }

  getGovernanceMetrics(): {
    agents: Record<string, {
      state: AgentGovernanceStateType;
      capabilities: string[];
      load: { active: number; queued: number };
      circuitBreaker: { state: string; canExecute: boolean };
    }>;
    telemetrySummary: {
      totalEvents: number;
      recentFailures: number;
      avgDuration: number;
    };
  } {
    const agents: Record<string, any> = {};

    for (const [name] of AGENT_REGISTRY) {
      const state = this.stateMachines.get(name)?.getState() || AgentGovernanceState.IDLE;
      const capabilities = this.capabilityVerifier.getCapabilities(name);
      const load = this.loadShedder.getLoadMetrics(name)[name] || { active: 0, queued: 0 };
      const cb = this.circuitBreakers.get(name);

      agents[name] = {
        state,
        capabilities,
        load: { active: load.active, queued: load.queued },
        circuitBreaker: {
          state: cb?.getState() || "closed",
          canExecute: cb?.canExecute() ?? true,
        },
      };
    }

    const recentEvents = this.telemetry.getRecentEvents(1000);
    const failures = recentEvents.filter(e => e.eventType === "task_fail").length;
    const completedEvents = recentEvents.filter(e => e.eventType === "task_complete" && e.durationMs);
    const avgDuration = completedEvents.length > 0
      ? completedEvents.reduce((sum, e) => sum + (e.durationMs || 0), 0) / completedEvents.length
      : 0;

    return {
      agents,
      telemetrySummary: {
        totalEvents: recentEvents.length,
        recentFailures: failures,
        avgDuration,
      },
    };
  }

  async flushTelemetry(): Promise<void> {
    await this.telemetry.flush();
  }
}

export const globalAgentGovernor = new AgentGovernor();

export {
  withResilience,
  CircuitBreaker,
  Bulkhead,
  getOrCreateCircuitBreaker,
  getOrCreateBulkhead,
} from "./resilience";
