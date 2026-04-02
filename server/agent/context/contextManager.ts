import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { AgentContextIdentity, AgentRuntimeContext, CapabilityState, ContextUpdater } from "./contextTypes";
import { createEmptyRuntimeContext } from "./contextTypes";

export type ContextEvent = {
  id: string;
  contextId: string;
  type: string;
  payload?: any;
  timestamp: number;
};

type Listener = (event: ContextEvent, snapshot: AgentRuntimeContext) => void;

const MAX_SIGNALS = 200;
const MAX_SHORT_TERM_ITEMS = 64;

export class AgentContextManager {
  private contexts = new Map<string, AgentRuntimeContext>();
  private emitter = new EventEmitter();

  getOrCreate(identity: AgentContextIdentity): AgentRuntimeContext {
    const key = identity.runId;
    const existing = this.contexts.get(key);
    if (existing) {
      return existing;
    }
    const created = createEmptyRuntimeContext(identity);
    this.contexts.set(key, created);
    return created;
  }

  get(runId: string): AgentRuntimeContext | undefined {
    return this.contexts.get(runId);
  }

  update(runId: string, updater: ContextUpdater): AgentRuntimeContext {
    const current = this.getOrCreate(this.requireIdentity(runId));
    const payload = updater(current) || current;
    payload.updatedAt = Date.now();
    this.contexts.set(runId, payload);
    return payload;
  }

  attachMemory(runId: string, entry: { role: string; content: string; timestamp?: number }): AgentRuntimeContext {
    return this.update(runId, (ctx) => {
      ctx.memory.shortTerm.push({ ...entry, timestamp: entry.timestamp ?? Date.now() });
      if (ctx.memory.shortTerm.length > MAX_SHORT_TERM_ITEMS) {
        ctx.memory.shortTerm.splice(0, ctx.memory.shortTerm.length - MAX_SHORT_TERM_ITEMS);
      }
      return ctx;
    });
  }

  upsertCapabilityState<T = Record<string, unknown>>(runId: string, name: string, data: T): CapabilityState<T> {
    let snapshot!: CapabilityState<T>;
    this.update(runId, (ctx) => {
      const existing = ctx.capabilityState[name] as CapabilityState<T> | undefined;
      snapshot = {
        name,
        data,
        version: existing ? existing.version + 1 : 1,
        updatedAt: Date.now(),
      };
      ctx.capabilityState[name] = snapshot;
    });
    return snapshot;
  }

  pushSignal(runId: string, type: string, payload?: any): ContextEvent {
    let ctx = this.getOrCreate(this.requireIdentity(runId));
    const event: ContextEvent = {
      id: randomUUID(),
      contextId: ctx.id,
      type,
      payload,
      timestamp: Date.now(),
    };
    ctx = this.update(runId, (mutable) => {
      mutable.signals.push(event);
      if (mutable.signals.length > MAX_SIGNALS) {
        mutable.signals.splice(0, mutable.signals.length - MAX_SIGNALS);
      }
      return mutable;
    });
    this.emitter.emit(ctx.id, event, ctx);
    return event;
  }

  subscribe(runId: string, listener: Listener): () => void {
    const ctx = this.getOrCreate(this.requireIdentity(runId));
    const handler = (event: ContextEvent, snapshot: AgentRuntimeContext) => listener(event, snapshot);
    this.emitter.on(ctx.id, handler);
    return () => this.emitter.off(ctx.id, handler);
  }

  destroy(runId: string): void {
    const ctx = this.contexts.get(runId);
    if (!ctx) return;
    this.emitter.removeAllListeners(ctx.id);
    this.contexts.delete(runId);
  }

  snapshot(runId: string): AgentRuntimeContext | undefined {
    const ctx = this.contexts.get(runId);
    return ctx ? JSON.parse(JSON.stringify(ctx)) : undefined;
  }

  private requireIdentity(runId: string): AgentContextIdentity {
    const ctx = this.contexts.get(runId);
    if (ctx) return ctx.identity;
    throw new Error(`Context identity unavailable for run ${runId}`);
  }
}

export const contextManager = new AgentContextManager();
