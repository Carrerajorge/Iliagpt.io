import type { EventBus } from "../types";

type EventHandler = (payload: unknown) => void;

export class SimpleEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private eventHistory: Array<{ event: string; payload: unknown; timestamp: number }> = [];
  private maxHistory = 1000;
  private enableHistory = true;

  constructor(options?: { enableHistory?: boolean; maxHistory?: number }) {
    this.enableHistory = options?.enableHistory ?? true;
    this.maxHistory = options?.maxHistory ?? 1000;
  }

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  emit(event: string, payload: unknown): void {
    if (this.enableHistory) {
      this.eventHistory.push({
        event,
        payload,
        timestamp: Date.now(),
      });

      if (this.eventHistory.length > this.maxHistory) {
        this.eventHistory.shift();
      }
    }

    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of Array.from(handlers)) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[EventBus] Error in handler for event "${event}":`, error);
        }
      }
    }

    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      for (const handler of Array.from(wildcardHandlers)) {
        try {
          handler({ event, payload });
        } catch (error) {
          console.error(`[EventBus] Error in wildcard handler:`, error);
        }
      }
    }
  }

  once(event: string, handler: EventHandler): void {
    const onceHandler: EventHandler = (payload) => {
      this.off(event, onceHandler);
      handler(payload);
    };
    this.on(event, onceHandler);
  }

  getHistory(event?: string, limit: number = 100): Array<{ event: string; payload: unknown; timestamp: number }> {
    let history = this.eventHistory;
    
    if (event) {
      history = history.filter((e) => e.event === event);
    }
    
    return history.slice(-limit);
  }

  clearHistory(): void {
    this.eventHistory = [];
  }

  getRegisteredEvents(): string[] {
    return Array.from(this.handlers.keys());
  }

  getHandlerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
    this.eventHistory = [];
  }
}

export const globalEventBus = new SimpleEventBus();
