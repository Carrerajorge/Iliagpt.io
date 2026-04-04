import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Logger } from '../../lib/logger';
import { AgentManifest } from './AgentManifest';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ChildLogger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface AgentContext {
  agentId: string;
  userId: string;
  runId: string;
  sessionId: string;
  manifest: AgentManifest;
  permissions: Set<string>;
  logger: ChildLogger;
  emit(event: string, data: unknown): void;
  request(targetAgent: string, action: string, params: unknown): Promise<unknown>;
}

export interface AgentLifecycleHooks {
  onInstall?(): Promise<void> | void;
  onUninstall?(): Promise<void> | void;
  onEnable?(): Promise<void> | void;
  onDisable?(): Promise<void> | void;
  onError?(err: Error): Promise<void> | void;
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  action: string;
  params: unknown;
  replyTo?: string;
  timestamp: Date;
}

export interface AgentResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}

// ─── Prefixed Logger ──────────────────────────────────────────────────────────

function makePrefixedLogger(prefix: string): ChildLogger {
  return {
    debug: (msg: string, ...args: unknown[]) => Logger.debug(`${prefix} ${msg}`, ...args),
    info: (msg: string, ...args: unknown[]) => Logger.info(`${prefix} ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) => Logger.warn(`${prefix} ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => Logger.error(`${prefix} ${msg}`, ...args),
  };
}

// ─── MarketplaceAgent ─────────────────────────────────────────────────────────

export abstract class MarketplaceAgent implements AgentLifecycleHooks {
  protected readonly context: AgentContext;
  protected readonly log: ChildLogger;

  constructor(context: AgentContext) {
    this.context = context;
    this.log = makePrefixedLogger(`[${context.manifest.name}]`);
  }

  // ─── Abstract ─────────────────────────────────────────────────────────────

  abstract execute(action: string, params: unknown): Promise<AgentResponse<unknown>>;

  // ─── Message Handling ─────────────────────────────────────────────────────

  async handleMessage(msg: AgentMessage): Promise<AgentResponse<unknown>> {
    const start = Date.now();

    this.log.debug(`Handling action "${msg.action}" from "${msg.from}" (msgId=${msg.id})`);

    try {
      const result = await this.execute(msg.action, msg.params);
      const duration = Date.now() - start;

      return {
        ...result,
        duration,
      };
    } catch (err) {
      const duration = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.log.error(`Action "${msg.action}" failed: ${errorMessage}`);

      if (err instanceof Error) {
        await this.onError(err);
      }

      return {
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  // ─── Param Validation ─────────────────────────────────────────────────────

  protected validateParams<T>(schema: z.ZodSchema<T>, params: unknown): T {
    const result = schema.safeParse(params);

    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
          return `[${path}] ${issue.message}`;
        })
        .join('; ');

      throw new Error(`Parameter validation failed: ${issues}`);
    }

    return result.data;
  }

  // ─── Capabilities & Permissions ───────────────────────────────────────────

  getCapabilities(): string[] {
    return [...this.context.manifest.capabilities];
  }

  hasPermission(resource: string, access: string): boolean {
    const key = `${resource}:${access}`;
    return this.context.permissions.has(key);
  }

  // ─── Lifecycle Hooks (overridable) ────────────────────────────────────────

  async onInstall(): Promise<void> {
    this.log.debug('onInstall hook called');
  }

  async onUninstall(): Promise<void> {
    this.log.debug('onUninstall hook called');
  }

  async onEnable(): Promise<void> {
    this.log.debug('onEnable hook called');
  }

  async onDisable(): Promise<void> {
    this.log.debug('onDisable hook called');
  }

  async onError(err: Error): Promise<void> {
    this.log.error(`Unhandled agent error: ${err.message}`);
  }

  // ─── Static Factory ───────────────────────────────────────────────────────

  static create<T extends MarketplaceAgent>(
    AgentClass: new (ctx: AgentContext) => T,
    context: AgentContext
  ): T {
    return new AgentClass(context);
  }
}

// ─── Retry Utilities ──────────────────────────────────────────────────────────

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 100;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  baseDelay: number
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < attempts - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        Logger.debug(
          `[AgentCommunicationBus] Retry ${attempt + 1}/${attempts - 1} after ${delay}ms`
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// ─── Message Queue Entry ──────────────────────────────────────────────────────

interface QueueEntry {
  message: AgentMessage;
  resolve: (response: AgentResponse<unknown>) => void;
  reject: (err: unknown) => void;
  attempts: number;
}

// ─── AgentCommunicationBus ────────────────────────────────────────────────────

export class AgentCommunicationBus {
  private readonly agents: Map<string, MarketplaceAgent> = new Map();
  private readonly queue: QueueEntry[] = [];
  private processing = false;

  // ─── Registration ──────────────────────────────────────────────────────

  register(agentId: string, agent: MarketplaceAgent): void {
    if (this.agents.has(agentId)) {
      Logger.warn(`[AgentCommunicationBus] Agent "${agentId}" is already registered; replacing`);
    }
    this.agents.set(agentId, agent);
    Logger.info(`[AgentCommunicationBus] Agent "${agentId}" registered`);
  }

  unregister(agentId: string): void {
    if (!this.agents.has(agentId)) {
      Logger.warn(`[AgentCommunicationBus] Agent "${agentId}" not found for unregistration`);
      return;
    }
    this.agents.delete(agentId);
    Logger.info(`[AgentCommunicationBus] Agent "${agentId}" unregistered`);
  }

  // ─── Send ──────────────────────────────────────────────────────────────

  async send(
    from: string,
    to: string,
    action: string,
    params: unknown
  ): Promise<AgentResponse<unknown>> {
    const target = this.agents.get(to);
    if (!target) {
      return {
        success: false,
        error: `Target agent "${to}" is not registered on the communication bus`,
        duration: 0,
      };
    }

    const message: AgentMessage = {
      id: randomUUID(),
      from,
      to,
      action,
      params,
      timestamp: new Date(),
    };

    Logger.debug(
      `[AgentCommunicationBus] Sending "${action}" from "${from}" to "${to}" (msgId=${message.id})`
    );

    return new Promise<AgentResponse<unknown>>((resolve, reject) => {
      const entry: QueueEntry = {
        message,
        resolve,
        reject,
        attempts: 0,
      };
      this.queue.push(entry);
      this._processQueue();
    });
  }

  // ─── Broadcast ─────────────────────────────────────────────────────────

  async broadcast(
    from: string,
    action: string,
    params: unknown
  ): Promise<AgentResponse<unknown>[]> {
    const targets = Array.from(this.agents.keys()).filter((id) => id !== from);

    if (targets.length === 0) {
      Logger.warn(`[AgentCommunicationBus] Broadcast from "${from}" found no targets`);
      return [];
    }

    Logger.info(
      `[AgentCommunicationBus] Broadcasting "${action}" from "${from}" to ${targets.length} agents`
    );

    const results = await Promise.allSettled(
      targets.map((to) => this.send(from, to, action, params))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      const errorMessage =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      Logger.error(
        `[AgentCommunicationBus] Broadcast to "${targets[index]}" failed: ${errorMessage}`
      );
      return {
        success: false,
        error: errorMessage,
        duration: 0,
      };
    });
  }

  // ─── Queue Processing ──────────────────────────────────────────────────

  private _processQueue(): void {
    if (this.processing) return;
    this.processing = true;

    setImmediate(() => this._drainQueue());
  }

  private async _drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (!entry) break;

      await this._dispatchEntry(entry);
    }
    this.processing = false;
  }

  private async _dispatchEntry(entry: QueueEntry): Promise<void> {
    const { message, resolve } = entry;
    const target = this.agents.get(message.to);

    if (!target) {
      resolve({
        success: false,
        error: `Target agent "${message.to}" was unregistered before the message could be delivered`,
        duration: 0,
      });
      return;
    }

    try {
      const response = await withRetry(
        () => target.handleMessage(message),
        RETRY_ATTEMPTS,
        RETRY_BASE_DELAY_MS
      );

      Logger.debug(
        `[AgentCommunicationBus] Message ${message.id} delivered to "${message.to}" ` +
          `(success=${response.success}, duration=${response.duration}ms)`
      );

      resolve(response);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      Logger.error(
        `[AgentCommunicationBus] Message ${message.id} to "${message.to}" failed after ` +
          `${RETRY_ATTEMPTS} attempts: ${errorMessage}`
      );

      resolve({
        success: false,
        error: `Failed after ${RETRY_ATTEMPTS} attempts: ${errorMessage}`,
        duration: 0,
      });
    }
  }

  // ─── Introspection ────────────────────────────────────────────────────

  getRegisteredAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  isRegistered(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  getQueueDepth(): number {
    return this.queue.length;
  }
}

// ─── Context Builder ──────────────────────────────────────────────────────────

export function buildAgentContext(options: {
  manifest: AgentManifest;
  userId: string;
  sessionId?: string;
  bus?: AgentCommunicationBus;
  extraPermissions?: string[];
}): AgentContext {
  const { manifest, userId, sessionId, bus, extraPermissions } = options;

  const agentId = `${manifest.name}-${randomUUID()}`;
  const runId = randomUUID();
  const resolvedSessionId = sessionId ?? randomUUID();

  const permissions = new Set<string>(
    manifest.permissions.map((p) => `${p.resource}:${p.access}`)
  );

  if (extraPermissions) {
    for (const perm of extraPermissions) {
      permissions.add(perm);
    }
  }

  const logger = makePrefixedLogger(`[${manifest.name}]`);

  const context: AgentContext = {
    agentId,
    userId,
    runId,
    sessionId: resolvedSessionId,
    manifest,
    permissions,
    logger,
    emit: (event: string, data: unknown) => {
      logger.debug(`emit "${event}": ${JSON.stringify(data)}`);
    },
    request: async (targetAgent: string, action: string, params: unknown): Promise<unknown> => {
      if (!bus) {
        throw new Error(
          `Agent "${manifest.name}" attempted request to "${targetAgent}" but no bus is configured`
        );
      }
      const response = await bus.send(agentId, targetAgent, action, params);
      if (!response.success) {
        throw new Error(
          `Request to "${targetAgent}::${action}" failed: ${response.error ?? 'unknown error'}`
        );
      }
      return response.data;
    },
  };

  return context;
}
