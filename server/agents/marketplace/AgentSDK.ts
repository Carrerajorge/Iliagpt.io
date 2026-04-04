import { EventEmitter } from "events";
import pino from "pino";
import type { AgentManifest, AgentPermissions } from "./AgentManifest.js";

const logger = pino({ name: "AgentSDK" });

// ─── Core types ───────────────────────────────────────────────────────────────

export interface SDKMessage {
  id: string;
  from: string;
  to: string | "broadcast";
  type: string;
  payload: unknown;
  timestamp: number;
  correlationId?: string;
}

export interface SDKToolCall {
  toolId: string;
  input: Record<string, unknown>;
  timeout?: number;
}

export interface SDKToolResult {
  toolId: string;
  success: boolean;
  output: unknown;
  durationMs: number;
  error?: string;
}

export interface SDKModelRequest {
  modelId?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  tools?: unknown[];
  stream?: boolean;
}

export interface SDKModelResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  modelId: string;
  finishReason: "stop" | "length" | "tool_calls" | "error";
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

export interface SDKMemoryQuery {
  query: string;
  namespace?: string;
  topK?: number;
  filters?: Record<string, unknown>;
}

export interface SDKMemoryRecord {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score?: number;
}

export interface AgentContext {
  agentId: string;
  userId: string;
  sessionId: string;
  conversationId?: string;
  locale: string;
  permissions: AgentPermissions;
  metadata: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  output: unknown;
  durationMs: number;
  tokensUsed?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ─── Resource API ─────────────────────────────────────────────────────────────

export interface ResourceAPI {
  /** Request a model completion */
  requestModel(req: SDKModelRequest): Promise<SDKModelResponse>;
  /** Call a registered tool */
  requestTool(call: SDKToolCall): Promise<SDKToolResult>;
  /** Store a value in agent memory */
  storeMemory(content: string, metadata?: Record<string, unknown>): Promise<string>;
  /** Query agent memory */
  queryMemory(query: SDKMemoryQuery): Promise<SDKMemoryRecord[]>;
  /** Delete a memory record */
  forgetMemory(id: string): Promise<void>;
  /** Read a file (requires filesystem permission) */
  readFile(path: string): Promise<string>;
  /** Write a file (requires filesystem readwrite permission) */
  writeFile(path: string, content: string): Promise<void>;
  /** Fetch a URL (requires network permission) */
  fetchUrl(url: string, options?: RequestInit): Promise<{ status: number; body: string }>;
}

// ─── Communication API ────────────────────────────────────────────────────────

export interface CommunicationAPI {
  /** Send a message to another agent or user */
  sendMessage(to: string, type: string, payload: unknown): Promise<void>;
  /** Send a message to all agents in the same swarm */
  broadcastToSwarm(type: string, payload: unknown): Promise<void>;
  /** Subscribe to incoming messages of a given type */
  onMessage(type: string, handler: (msg: SDKMessage) => void | Promise<void>): () => void;
  /** Send a request and wait for a reply (request-response pattern) */
  request(
    to: string,
    type: string,
    payload: unknown,
    timeoutMs?: number
  ): Promise<SDKMessage>;
}

// ─── AgentCapability base class ───────────────────────────────────────────────

export abstract class AgentCapability {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;

  protected resources!: ResourceAPI;
  protected comms!: CommunicationAPI;
  protected ctx!: AgentContext;

  /** Called once when the capability is attached to an agent */
  async initialize(
    resources: ResourceAPI,
    comms: CommunicationAPI,
    ctx: AgentContext
  ): Promise<void> {
    this.resources = resources;
    this.comms = comms;
    this.ctx = ctx;
    await this.onInitialize();
  }

  protected async onInitialize(): Promise<void> {}
  abstract execute(input: unknown): Promise<unknown>;
  async cleanup(): Promise<void> {}
}

// ─── AgentTool base class ─────────────────────────────────────────────────────

export abstract class AgentTool {
  abstract readonly toolId: string;
  abstract readonly description: string;
  abstract readonly inputSchema: Record<string, unknown>;

  protected resources!: ResourceAPI;
  protected ctx!: AgentContext;

  initialize(resources: ResourceAPI, ctx: AgentContext): void {
    this.resources = resources;
    this.ctx = ctx;
  }

  abstract run(input: Record<string, unknown>): Promise<unknown>;

  /** Optional: validate input before run() is called */
  validate(_input: Record<string, unknown>): string | null {
    return null; // null = valid
  }
}

// ─── MarketplaceAgent base class ──────────────────────────────────────────────

export abstract class MarketplaceAgent extends EventEmitter {
  protected readonly log: pino.Logger;
  protected resources!: ResourceAPI;
  protected comms!: CommunicationAPI;
  protected ctx!: AgentContext;
  protected capabilities: Map<string, AgentCapability> = new Map();
  protected tools: Map<string, AgentTool> = new Map();

  private _status: "idle" | "installing" | "active" | "deactivated" | "error" =
    "idle";

  constructor(protected readonly manifest: AgentManifest) {
    super();
    this.log = pino({ name: `Agent:${manifest.id}` });
  }

  get id(): string {
    return this.manifest.id;
  }
  get name(): string {
    return this.manifest.name;
  }
  get version(): string {
    return this.manifest.version;
  }
  get status() {
    return this._status;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Called once after the agent package is downloaded and verified.
   * Use this to initialize databases, validate config, warm caches.
   */
  async install(
    resources: ResourceAPI,
    comms: CommunicationAPI,
    ctx: AgentContext
  ): Promise<void> {
    this._status = "installing";
    this.resources = resources;
    this.comms = comms;
    this.ctx = ctx;

    // Initialize all registered capabilities
    for (const cap of this.capabilities.values()) {
      await cap.initialize(resources, comms, ctx);
    }
    // Initialize all registered tools
    for (const tool of this.tools.values()) {
      tool.initialize(resources, ctx);
    }

    try {
      await this.onInstall();
      this.log.info("[SDK] Agent installed successfully");
      this.emit("installed", { agentId: this.id });
    } catch (err) {
      this._status = "error";
      this.log.error({ err }, "[SDK] Installation failed");
      throw err;
    }
  }

  /**
   * Called when the agent is enabled for a user/session.
   * Runs after install; may be called multiple times (activate/deactivate cycles).
   */
  async activate(): Promise<void> {
    if (this._status !== "installing" && this._status !== "deactivated") {
      throw new Error(
        `Cannot activate agent in status '${this._status}'. Must be 'installing' or 'deactivated'.`
      );
    }
    try {
      await this.onActivate();
      this._status = "active";
      this.log.info("[SDK] Agent activated");
      this.emit("activated", { agentId: this.id });
    } catch (err) {
      this._status = "error";
      this.log.error({ err }, "[SDK] Activation failed");
      throw err;
    }
  }

  /**
   * Called when the agent is disabled temporarily.
   * Resources are preserved; agent can be re-activated.
   */
  async deactivate(): Promise<void> {
    if (this._status !== "active") {
      this.log.warn(
        { status: this._status },
        "[SDK] Deactivate called on non-active agent, skipping"
      );
      return;
    }
    try {
      await this.onDeactivate();
      this._status = "deactivated";
      this.log.info("[SDK] Agent deactivated");
      this.emit("deactivated", { agentId: this.id });
    } catch (err) {
      this.log.error({ err }, "[SDK] Deactivation failed");
      throw err;
    }
  }

  /**
   * Called when the agent package is being removed from the marketplace.
   * Clean up all persistent resources.
   */
  async uninstall(): Promise<void> {
    try {
      if (this._status === "active") await this.deactivate();
      await this.onUninstall();
      for (const cap of this.capabilities.values()) await cap.cleanup();
      this.capabilities.clear();
      this.tools.clear();
      this.log.info("[SDK] Agent uninstalled");
      this.emit("uninstalled", { agentId: this.id });
    } catch (err) {
      this.log.error({ err }, "[SDK] Uninstall failed");
      throw err;
    }
  }

  // ── Abstract lifecycle hooks (subclasses implement) ─────────────────────────

  protected async onInstall(): Promise<void> {}
  protected async onActivate(): Promise<void> {}
  protected async onDeactivate(): Promise<void> {}
  protected async onUninstall(): Promise<void> {}

  // ── Core execution ───────────────────────────────────────────────────────────

  /**
   * Main entry point — process a user or system request.
   */
  async run(input: unknown, context?: Partial<AgentContext>): Promise<ExecutionResult> {
    if (this._status !== "active") {
      throw new Error(`Agent '${this.id}' is not active (status: ${this._status})`);
    }

    const mergedCtx: AgentContext = {
      ...this.ctx,
      ...context,
    };

    const startMs = Date.now();
    this.emit("execution:start", { agentId: this.id, input });

    try {
      const output = await this.execute(input, mergedCtx);
      const durationMs = Date.now() - startMs;
      const result: ExecutionResult = { success: true, output, durationMs };
      this.emit("execution:end", { agentId: this.id, result });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startMs;
      const error = err instanceof Error ? err.message : String(err);
      this.log.error({ err, durationMs }, "[SDK] Execution error");
      this.emit("execution:error", { agentId: this.id, error });
      return { success: false, output: null, durationMs, error };
    }
  }

  /** Implement the core agent logic in subclasses */
  protected abstract execute(input: unknown, ctx: AgentContext): Promise<unknown>;

  // ── Capability / Tool registration ───────────────────────────────────────────

  protected registerCapability(cap: AgentCapability): void {
    if (this.capabilities.has(cap.id)) {
      throw new Error(`Capability '${cap.id}' already registered`);
    }
    this.capabilities.set(cap.id, cap);
    this.log.debug({ capId: cap.id }, "[SDK] Capability registered");
  }

  protected registerTool(tool: AgentTool): void {
    if (this.tools.has(tool.toolId)) {
      throw new Error(`Tool '${tool.toolId}' already registered`);
    }
    this.tools.set(tool.toolId, tool);
    this.log.debug({ toolId: tool.toolId }, "[SDK] Tool registered");
  }

  getCapability(id: string): AgentCapability | undefined {
    return this.capabilities.get(id);
  }

  getTool(toolId: string): AgentTool | undefined {
    return this.tools.get(toolId);
  }

  listCapabilities(): AgentCapability[] {
    return Array.from(this.capabilities.values());
  }

  listTools(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  // ── Health ────────────────────────────────────────────────────────────────────

  async healthCheck(): Promise<{ healthy: boolean; details: Record<string, unknown> }> {
    return {
      healthy: this._status === "active",
      details: {
        status: this._status,
        capabilities: this.capabilities.size,
        tools: this.tools.size,
        agentId: this.id,
        version: this.version,
      },
    };
  }
}

// ─── SDK Factory ──────────────────────────────────────────────────────────────

/** Type for the constructor of a MarketplaceAgent subclass */
export type AgentClass = new (manifest: AgentManifest) => MarketplaceAgent;

/**
 * Define a marketplace agent. Returns a factory function.
 * This is the primary export third-party developers use.
 *
 * @example
 * export default defineAgent((manifest) =>
 *   class MyAgent extends MarketplaceAgent {
 *     protected async execute(input, ctx) { ... }
 *   }
 * );
 */
export function defineAgent(
  factory: (manifest: AgentManifest) => AgentClass
): (manifest: AgentManifest) => AgentClass {
  return factory;
}

// ─── SDK version export ───────────────────────────────────────────────────────

export const SDK_VERSION = "1.0.0";
export const PLATFORM_API_VERSION = "1.0";
