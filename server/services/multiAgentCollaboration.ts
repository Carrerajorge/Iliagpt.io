/**
 * Multi-Agent Collaboration Protocol
 *
 * Implements:
 *   - Agent-to-Agent (A2A) messaging
 *   - Task delegation with tracking
 *   - Shared memory between agents
 *   - Consensus mechanism for multi-agent decisions
 *   - MCP client for connecting to external MCP servers
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { ActiveInferenceBrain, AgentGoal } from "../agent/computerUse/autonomousAgentBrain";

// ── Types ──────────────────────────────────────────────────────────────

export interface AgentIdentity {
  id: string;
  name: string;
  role: string;          // e.g. "researcher", "coder", "reviewer", "planner"
  capabilities: string[];
  status: "available" | "busy" | "offline";
  currentTaskId?: string;
}

export interface DelegationTask {
  id: string;
  parentAgentId: string;
  childAgentId: string;
  task: string;
  context: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  timeoutAt?: Date;
  priority: "low" | "normal" | "high" | "critical";
}

export interface A2AMessage {
  id: string;
  from: string;          // agent ID
  to: string;            // agent ID or "broadcast"
  type: "request" | "response" | "notification" | "query" | "vote";
  topic: string;
  payload: unknown;
  timestamp: Date;
  replyTo?: string;      // message ID
}

export interface SharedMemoryEntry {
  key: string;
  value: unknown;
  setBy: string;         // agent ID
  updatedAt: Date;
  ttl?: number;          // seconds
  tags: string[];
}

export interface ConsensusProposal {
  id: string;
  proposer: string;
  question: string;
  options: string[];
  votes: Map<string, string>; // agentId -> option
  status: "open" | "decided" | "expired";
  deadline: Date;
  decision?: string;
}

// ── Agent Registry ─────────────────────────────────────────────────────

export class AgentRegistry extends EventEmitter {
  private agents = new Map<string, AgentIdentity>();

  register(agent: AgentIdentity): void {
    this.agents.set(agent.id, agent);
    this.emit("agent:registered", agent);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
    this.emit("agent:unregistered", { id: agentId });
  }

  getAgent(id: string): AgentIdentity | undefined {
    return this.agents.get(id);
  }

  listAgents(filter?: { role?: string; status?: string }): AgentIdentity[] {
    let results = Array.from(this.agents.values());
    if (filter?.role) results = results.filter(a => a.role === filter.role);
    if (filter?.status) results = results.filter(a => a.status === filter.status);
    return results;
  }

  findBestAgent(requiredCapabilities: string[]): AgentIdentity | null {
    const available = this.listAgents({ status: "available" });

    // Score agents by capability match
    let bestAgent: AgentIdentity | null = null;
    let bestScore = 0;

    for (const agent of available) {
      const matchCount = requiredCapabilities.filter(c => agent.capabilities.includes(c)).length;
      const score = matchCount / requiredCapabilities.length;
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestScore > 0 ? bestAgent : null;
  }

  setStatus(agentId: string, status: AgentIdentity["status"]): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      this.emit("agent:status_changed", { agentId, status });
    }
  }
}

// ── Task Delegation Engine ─────────────────────────────────────────────

export class DelegationEngine extends EventEmitter {
  private tasks = new Map<string, DelegationTask>();
  private registry: AgentRegistry;
  private timeoutCheckerInterval?: NodeJS.Timeout;

  constructor(registry: AgentRegistry) {
    super();
    this.registry = registry;
  }

  start(): void {
    // Check for timed-out tasks every 30 seconds
    this.timeoutCheckerInterval = setInterval(() => this.checkTimeouts(), 30_000);
  }

  stop(): void {
    if (this.timeoutCheckerInterval) {
      clearInterval(this.timeoutCheckerInterval);
      this.timeoutCheckerInterval = undefined;
    }
  }

  /**
   * Delegate a task to a specific agent or auto-select.
   */
  async delegate(params: {
    parentAgentId: string;
    task: string;
    context?: Record<string, unknown>;
    childAgentId?: string;
    requiredCapabilities?: string[];
    priority?: DelegationTask["priority"];
    timeoutMs?: number;
  }): Promise<DelegationTask> {
    // Auto-select agent if not specified
    let childAgentId = params.childAgentId;
    if (!childAgentId && params.requiredCapabilities) {
      const best = this.registry.findBestAgent(params.requiredCapabilities);
      if (!best) throw new Error("No available agent with required capabilities");
      childAgentId = best.id;
    }
    if (!childAgentId) throw new Error("No target agent specified");

    const task: DelegationTask = {
      id: randomUUID(),
      parentAgentId: params.parentAgentId,
      childAgentId,
      task: params.task,
      context: params.context || {},
      status: "pending",
      priority: params.priority || "normal",
      createdAt: new Date(),
      timeoutAt: params.timeoutMs
        ? new Date(Date.now() + params.timeoutMs)
        : new Date(Date.now() + 5 * 60_000), // 5 min default
    };

    this.tasks.set(task.id, task);

    // Save to DB
    await this.saveToDB(task);

    // Notify child agent
    this.registry.setStatus(childAgentId, "busy");
    this.emit("task:created", task);

    return task;
  }

  /**
   * Mark a task as started.
   */
  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("Task not found");

    task.status = "running";
    task.startedAt = new Date();
    await this.saveToDB(task);
    this.emit("task:started", task);
  }

  /**
   * Complete a task with result.
   */
  async completeTask(taskId: string, result: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("Task not found");

    task.status = "completed";
    task.result = result;
    task.completedAt = new Date();

    this.registry.setStatus(task.childAgentId, "available");
    await this.saveToDB(task);
    this.emit("task:completed", task);
  }

  /**
   * Fail a task.
   */
  async failTask(taskId: string, error: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("Task not found");

    task.status = "failed";
    task.error = error;
    task.completedAt = new Date();

    this.registry.setStatus(task.childAgentId, "available");
    await this.saveToDB(task);
    this.emit("task:failed", task);
  }

  /**
   * Cancel a task.
   */
  async cancelTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("Task not found");

    task.status = "cancelled";
    task.completedAt = new Date();

    this.registry.setStatus(task.childAgentId, "available");
    await this.saveToDB(task);
    this.emit("task:cancelled", task);
  }

  // Inyectado soporte para resolución autónoma usando Sub-Cerebros Active Inference
  async delegateWithAutonomousBrain(params: {
    parentAgentId: string;
    goal: AgentGoal;
    requiredCapabilities?: string[];
    timeoutMs?: number;
  }): Promise<DelegationTask> {
    const taskDef = await this.delegate({
      parentAgentId: params.parentAgentId,
      task: params.goal.description,
      requiredCapabilities: params.requiredCapabilities,
      timeoutMs: params.timeoutMs
    });

    // Invocamos un cerebro efímero para el Sub-Agent
    const subBrain = new ActiveInferenceBrain();

    // Background execution
    this.startTask(taskDef.id).then(async () => {
      try {
        const result = await subBrain.executionLoop(params.goal);
        if (result.success) {
          await this.completeTask(taskDef.id, JSON.stringify(result));
        } else {
          await this.failTask(taskDef.id, result.reason || "ActiveInference Brain fail");
        }
      } catch (e: any) {
        await this.failTask(taskDef.id, e.message);
      }
    });

    return taskDef;
  }

  getTask(id: string): DelegationTask | undefined {
    return this.tasks.get(id);
  }

  listTasks(filter?: { parentAgentId?: string; childAgentId?: string; status?: string }): DelegationTask[] {
    let results = Array.from(this.tasks.values());
    if (filter?.parentAgentId) results = results.filter(t => t.parentAgentId === filter.parentAgentId);
    if (filter?.childAgentId) results = results.filter(t => t.childAgentId === filter.childAgentId);
    if (filter?.status) results = results.filter(t => t.status === filter.status);
    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private checkTimeouts(): void {
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (
        (task.status === "pending" || task.status === "running") &&
        task.timeoutAt &&
        now > task.timeoutAt.getTime()
      ) {
        this.failTask(task.id, "Task timed out").catch(() => { });
      }
    }
  }

  private async saveToDB(task: DelegationTask): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO agent_delegations (id, parent_agent_id, child_agent_id, task, status, result, error, context, created_at, completed_at, timeout_at)
        VALUES (${task.id}, ${task.parentAgentId}, ${task.childAgentId}, ${task.task},
                ${task.status}, ${task.result || null}, ${task.error || null},
                ${JSON.stringify(task.context)}::jsonb,
                ${task.createdAt.toISOString()},
                ${task.completedAt?.toISOString() || null},
                ${task.timeoutAt?.toISOString() || null})
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          result = EXCLUDED.result,
          error = EXCLUDED.error,
          completed_at = EXCLUDED.completed_at
      `);
    } catch {
      // Table might not exist yet
    }
  }
}

// ── Shared Memory ──────────────────────────────────────────────────────

export class SharedAgentMemory {
  private memory = new Map<string, SharedMemoryEntry>();

  set(key: string, value: unknown, agentId: string, tags: string[] = [], ttl?: number): void {
    this.memory.set(key, {
      key,
      value,
      setBy: agentId,
      updatedAt: new Date(),
      ttl,
      tags,
    });
  }

  get(key: string): unknown | undefined {
    const entry = this.memory.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (entry.ttl) {
      const elapsed = (Date.now() - entry.updatedAt.getTime()) / 1000;
      if (elapsed > entry.ttl) {
        this.memory.delete(key);
        return undefined;
      }
    }

    return entry.value;
  }

  getEntry(key: string): SharedMemoryEntry | undefined {
    return this.memory.get(key);
  }

  delete(key: string): boolean {
    return this.memory.delete(key);
  }

  search(query: { tags?: string[]; setBy?: string; prefix?: string }): SharedMemoryEntry[] {
    let results = Array.from(this.memory.values());

    if (query.tags?.length) {
      results = results.filter(e => query.tags!.some(t => e.tags.includes(t)));
    }
    if (query.setBy) {
      results = results.filter(e => e.setBy === query.setBy);
    }
    if (query.prefix) {
      results = results.filter(e => e.key.startsWith(query.prefix!));
    }

    return results;
  }

  listKeys(): string[] {
    return Array.from(this.memory.keys());
  }

  clear(): void {
    this.memory.clear();
  }
}

// ── A2A Message Bus ────────────────────────────────────────────────────

export class A2AMessageBus extends EventEmitter {
  private messageLog: A2AMessage[] = [];
  private maxLog = 5000;

  send(message: Omit<A2AMessage, "id" | "timestamp">): A2AMessage {
    const msg: A2AMessage = {
      ...message,
      id: randomUUID(),
      timestamp: new Date(),
    };

    this.messageLog.push(msg);
    if (this.messageLog.length > this.maxLog) {
      this.messageLog.shift();
    }

    if (msg.to === "broadcast") {
      this.emit("message:broadcast", msg);
    } else {
      this.emit(`message:${msg.to}`, msg);
    }

    this.emit("message", msg);
    return msg;
  }

  getMessages(filter?: { from?: string; to?: string; topic?: string; limit?: number }): A2AMessage[] {
    let results = [...this.messageLog];
    if (filter?.from) results = results.filter(m => m.from === filter.from);
    if (filter?.to) results = results.filter(m => m.to === filter.to || m.to === "broadcast");
    if (filter?.topic) results = results.filter(m => m.topic === filter.topic);
    results.reverse();
    if (filter?.limit) results = results.slice(0, filter.limit);
    return results;
  }
}

// ── Consensus Mechanism ────────────────────────────────────────────────

export class ConsensusMechanism {
  private proposals = new Map<string, ConsensusProposal>();

  createProposal(params: {
    proposer: string;
    question: string;
    options: string[];
    deadlineMs?: number;
  }): ConsensusProposal {
    const proposal: ConsensusProposal = {
      id: randomUUID(),
      proposer: params.proposer,
      question: params.question,
      options: params.options,
      votes: new Map(),
      status: "open",
      deadline: new Date(Date.now() + (params.deadlineMs || 60_000)),
    };

    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  vote(proposalId: string, agentId: string, option: string): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== "open") return false;
    if (!proposal.options.includes(option)) return false;
    if (Date.now() > proposal.deadline.getTime()) {
      this.resolveProposal(proposalId);
      return false;
    }

    proposal.votes.set(agentId, option);
    return true;
  }

  resolveProposal(proposalId: string): string | null {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return null;

    // Count votes
    const counts = new Map<string, number>();
    for (const option of proposal.options) counts.set(option, 0);
    for (const vote of proposal.votes.values()) {
      counts.set(vote, (counts.get(vote) || 0) + 1);
    }

    // Find winner (simple majority)
    let maxVotes = 0;
    let winner = proposal.options[0];
    for (const [option, count] of counts) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = option;
      }
    }

    proposal.status = "decided";
    proposal.decision = winner;
    return winner;
  }

  getProposal(id: string): ConsensusProposal | undefined {
    return this.proposals.get(id);
  }
}

// ── MCP Client ─────────────────────────────────────────────────────────

export interface MCPServer {
  id: string;
  name: string;
  url: string;           // WebSocket or HTTP URL
  status: "connected" | "disconnected" | "error";
  capabilities: string[];
  tools: MCPTool[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class MCPClient extends EventEmitter {
  private servers = new Map<string, MCPServer>();

  /**
   * Connect to an MCP server via HTTP/SSE.
   */
  async connect(params: { id: string; name: string; url: string }): Promise<MCPServer> {
    const server: MCPServer = {
      id: params.id,
      name: params.name,
      url: params.url,
      status: "disconnected",
      capabilities: [],
      tools: [],
    };

    try {
      // Discover tools via MCP protocol
      const response = await fetch(`${params.url}/tools/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
      });

      if (response.ok) {
        const data = await response.json() as any;
        server.tools = data.result?.tools || [];
        server.capabilities = server.tools.map(t => t.name);
        server.status = "connected";
      } else {
        server.status = "error";
      }
    } catch (err: any) {
      server.status = "error";
    }

    this.servers.set(server.id, server);
    this.emit("server:connected", server);
    return server;
  }

  /**
   * Call a tool on an MCP server.
   */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`MCP server ${serverId} not found`);
    if (server.status !== "connected") throw new Error(`MCP server ${serverId} is ${server.status}`);

    const response = await fetch(`${server.url}/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: toolName, arguments: args },
        id: Date.now(),
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP call failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as any;
    if (data.error) throw new Error(`MCP error: ${data.error.message}`);
    return data.result;
  }

  disconnect(serverId: string): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.status = "disconnected";
      this.emit("server:disconnected", server);
    }
    this.servers.delete(serverId);
  }

  listServers(): MCPServer[] {
    return Array.from(this.servers.values());
  }
}

// ── Singletons ─────────────────────────────────────────────────────────

export const agentRegistry = new AgentRegistry();
export const sharedMemory = new SharedAgentMemory();
export const messageBus = new A2AMessageBus();
export const consensus = new ConsensusMechanism();
export const mcpClient = new MCPClient();

let _delegationEngine: DelegationEngine | null = null;

export function getDelegationEngine(): DelegationEngine {
  if (!_delegationEngine) {
    _delegationEngine = new DelegationEngine(agentRegistry);
  }
  return _delegationEngine;
}
