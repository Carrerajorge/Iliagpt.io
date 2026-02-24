import { AsyncLocalStorage } from "async_hooks";
import type { CorrelationIds } from "../telemetry/eventSchema";

export interface CorrelationContext {
  traceId: string;
  requestId?: string;
  userId?: string;
  workspaceId?: string;
  conversationId?: string;
  runId?: string;
  startTime: number;
}

const asyncLocalStorage = new AsyncLocalStorage<CorrelationContext>();

export function getContext(): CorrelationContext | undefined {
  return asyncLocalStorage.getStore();
}

export function getTraceId(): string | undefined {
  return asyncLocalStorage.getStore()?.traceId;
}

export function getUserId(): string | undefined {
  return asyncLocalStorage.getStore()?.userId;
}

/**
 * Extract the full set of correlation IDs for telemetry events.
 * Safe to call from any async context — returns a partial object
 * with whatever IDs are available.
 */
export function getCorrelationIds(): CorrelationIds {
  const store = asyncLocalStorage.getStore();
  if (!store) {
    return { traceId: "unknown" };
  }
  return {
    traceId: store.traceId,
    requestId: store.requestId ?? store.traceId,
    userId: store.userId,
    workspaceId: store.workspaceId,
    conversationId: store.conversationId,
    runId: store.runId,
  };
}

export function setContext(context: CorrelationContext): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    Object.assign(store, context);
  }
}

export function runWithContext<T>(context: CorrelationContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

export function updateContext(updates: Partial<CorrelationContext>): void {
  const store = asyncLocalStorage.getStore();
  if (store) {
    Object.assign(store, updates);
  }
}
