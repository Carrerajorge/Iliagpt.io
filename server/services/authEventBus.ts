/**
 * Auth Event Bus — In-Process Typed Event Emitter
 *
 * Emits structured auth events for downstream consumers:
 *  - Admin projection refresh (materialized view)
 *  - Audit enrichment
 *  - Security anomaly detection
 *
 * Single-server deployment: EventEmitter is sufficient.
 * Multi-instance upgrade path: replace with PG LISTEN/NOTIFY.
 */

import { EventEmitter } from "events";

export type AuthEventType =
  | "USER_REGISTERED"
  | "USER_LOGIN"
  | "USER_LOGOUT"
  | "USER_UPDATED"
  | "USER_DELETED"
  | "ROLE_CHANGED"
  | "PLAN_CHANGED"
  | "STATUS_CHANGED"
  | "USER_BLOCKED"
  | "USER_UNBLOCKED"
  | "PASSWORD_CHANGED"
  | "MFA_ENABLED"
  | "MFA_DISABLED"
  | "IDENTITY_LINKED"
  | "BREAK_GLASS_LOGIN";

export interface AuthEvent {
  type: AuthEventType;
  userId: string;
  timestamp: Date;
  correlationId: string;
  data: Record<string, any>;
  idempotencyKey: string; // userId + type + timestamp truncated to second
}

class TypedAuthEventBus extends EventEmitter {
  /**
   * Emit an auth event to all registered listeners.
   */
  emitAuth(event: AuthEvent): void {
    this.emit("auth", event);
  }

  /**
   * Register a listener for auth events.
   */
  onAuth(listener: (event: AuthEvent) => void): this {
    return this.on("auth", listener);
  }

  /**
   * Helper to create and emit an event with auto-generated fields.
   */
  publish(
    type: AuthEventType,
    userId: string,
    data: Record<string, any> = {},
    correlationId?: string,
  ): void {
    const now = new Date();
    const truncatedTs = now.toISOString().replace(/\.\d{3}Z$/, "");
    const event: AuthEvent = {
      type,
      userId,
      timestamp: now,
      correlationId: correlationId || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      data,
      idempotencyKey: `${userId}:${type}:${truncatedTs}`,
    };
    this.emitAuth(event);
  }
}

/**
 * Singleton event bus for auth events.
 */
export const authEventBus = new TypedAuthEventBus();

// Prevent memory leaks from too many listeners (materialized view + anomaly detection + metrics)
authEventBus.setMaxListeners(20);
