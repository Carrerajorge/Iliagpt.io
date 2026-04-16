/**
 * ConnectorEventBus — Typed event bus for the connector platform.
 *
 * Provides a strongly-typed publish/subscribe mechanism for all connector
 * lifecycle events: registration, connections, operations, credentials,
 * circuit breaker state changes, rate limits, health, webhooks, and sagas.
 *
 * Features:
 *  - Discriminated union event types with full type inference
 *  - Async (fire-and-forget) and sync dispatch modes
 *  - Ring buffer of recent events for debugging
 *  - Promise-based `waitFor` with timeout and predicate
 *  - Bus piping for event forwarding
 *  - Handler errors are caught and logged, never propagate to emitter
 *
 * Zero external dependencies.
 */

// ─── Event Type Discriminants ──────────────────────────────────────

export const CONNECTOR_EVENT_TYPES = [
  "connector.registered",
  "connector.connected",
  "connector.disconnected",
  "connector.operation.started",
  "connector.operation.completed",
  "connector.operation.failed",
  "connector.credential.refreshed",
  "connector.credential.expired",
  "connector.credential.revoked",
  "connector.circuit.opened",
  "connector.circuit.closed",
  "connector.circuit.halfOpen",
  "connector.rateLimit.warning",
  "connector.rateLimit.exceeded",
  "connector.health.degraded",
  "connector.health.recovered",
  "connector.webhook.received",
  "connector.saga.started",
  "connector.saga.completed",
  "connector.saga.compensating",
  "connector.saga.failed",
] as const;

export type ConnectorEventType = (typeof CONNECTOR_EVENT_TYPES)[number];

// ─── Event Payloads (discriminated union) ──────────────────────────

interface BaseEvent {
  timestamp: number;
}

export interface ConnectorRegisteredEvent extends BaseEvent {
  type: "connector.registered";
  connectorId: string;
  version: string;
  capabilitiesCount: number;
}

export interface ConnectorConnectedEvent extends BaseEvent {
  type: "connector.connected";
  connectorId: string;
  userId: string;
  scopes: string[];
}

export interface ConnectorDisconnectedEvent extends BaseEvent {
  type: "connector.disconnected";
  connectorId: string;
  userId: string;
  reason: string;
}

export interface ConnectorOperationStartedEvent extends BaseEvent {
  type: "connector.operation.started";
  connectorId: string;
  operationId: string;
  userId: string;
  chatId: string;
  runId: string;
  inputHash: string;
}

export interface ConnectorOperationCompletedEvent extends BaseEvent {
  type: "connector.operation.completed";
  connectorId: string;
  operationId: string;
  userId: string;
  durationMs: number;
  success: boolean;
  outputSizeBytes: number;
}

export interface ConnectorOperationFailedEvent extends BaseEvent {
  type: "connector.operation.failed";
  connectorId: string;
  operationId: string;
  userId: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
}

export interface ConnectorCredentialRefreshedEvent extends BaseEvent {
  type: "connector.credential.refreshed";
  connectorId: string;
  userId: string;
  newExpiresAt: Date;
}

export interface ConnectorCredentialExpiredEvent extends BaseEvent {
  type: "connector.credential.expired";
  connectorId: string;
  userId: string;
}

export interface ConnectorCredentialRevokedEvent extends BaseEvent {
  type: "connector.credential.revoked";
  connectorId: string;
  userId: string;
  reason: string;
}

export interface ConnectorCircuitOpenedEvent extends BaseEvent {
  type: "connector.circuit.opened";
  connectorId: string;
  failureCount: number;
  lastError: string;
}

export interface ConnectorCircuitClosedEvent extends BaseEvent {
  type: "connector.circuit.closed";
  connectorId: string;
  recoveryTimeMs: number;
}

export interface ConnectorCircuitHalfOpenEvent extends BaseEvent {
  type: "connector.circuit.halfOpen";
  connectorId: string;
}

export interface ConnectorRateLimitWarningEvent extends BaseEvent {
  type: "connector.rateLimit.warning";
  connectorId: string;
  userId: string;
  currentUsage: number;
  limit: number;
  windowMs: number;
}

export interface ConnectorRateLimitExceededEvent extends BaseEvent {
  type: "connector.rateLimit.exceeded";
  connectorId: string;
  userId: string;
  retryAfterMs: number;
}

export interface ConnectorHealthDegradedEvent extends BaseEvent {
  type: "connector.health.degraded";
  connectorId: string;
  latencyMs: number;
  threshold: number;
}

export interface ConnectorHealthRecoveredEvent extends BaseEvent {
  type: "connector.health.recovered";
  connectorId: string;
  latencyMs: number;
}

export interface ConnectorWebhookReceivedEvent extends BaseEvent {
  type: "connector.webhook.received";
  connectorId: string;
  webhookId: string;
  eventType: string;
  payloadSizeBytes: number;
}

export interface ConnectorSagaStartedEvent extends BaseEvent {
  type: "connector.saga.started";
  planId: string;
  userId: string;
  stepCount: number;
}

export interface ConnectorSagaCompletedEvent extends BaseEvent {
  type: "connector.saga.completed";
  planId: string;
  userId: string;
  durationMs: number;
  stepsExecuted: number;
}

export interface ConnectorSagaCompensatingEvent extends BaseEvent {
  type: "connector.saga.compensating";
  planId: string;
  userId: string;
  failedStep: string;
  compensationSteps: string[];
}

export interface ConnectorSagaFailedEvent extends BaseEvent {
  type: "connector.saga.failed";
  planId: string;
  userId: string;
  error: string;
}

// ─── Discriminated Union ───────────────────────────────────────────

export type ConnectorEvent =
  | ConnectorRegisteredEvent
  | ConnectorConnectedEvent
  | ConnectorDisconnectedEvent
  | ConnectorOperationStartedEvent
  | ConnectorOperationCompletedEvent
  | ConnectorOperationFailedEvent
  | ConnectorCredentialRefreshedEvent
  | ConnectorCredentialExpiredEvent
  | ConnectorCredentialRevokedEvent
  | ConnectorCircuitOpenedEvent
  | ConnectorCircuitClosedEvent
  | ConnectorCircuitHalfOpenEvent
  | ConnectorRateLimitWarningEvent
  | ConnectorRateLimitExceededEvent
  | ConnectorHealthDegradedEvent
  | ConnectorHealthRecoveredEvent
  | ConnectorWebhookReceivedEvent
  | ConnectorSagaStartedEvent
  | ConnectorSagaCompletedEvent
  | ConnectorSagaCompensatingEvent
  | ConnectorSagaFailedEvent;

// ─── Type-safe handler mapping ─────────────────────────────────────

/**
 * Maps each event type string to its concrete event interface so that
 * `on("connector.registered", handler)` infers the correct payload type.
 */
export interface ConnectorEventMap {
  "connector.registered": ConnectorRegisteredEvent;
  "connector.connected": ConnectorConnectedEvent;
  "connector.disconnected": ConnectorDisconnectedEvent;
  "connector.operation.started": ConnectorOperationStartedEvent;
  "connector.operation.completed": ConnectorOperationCompletedEvent;
  "connector.operation.failed": ConnectorOperationFailedEvent;
  "connector.credential.refreshed": ConnectorCredentialRefreshedEvent;
  "connector.credential.expired": ConnectorCredentialExpiredEvent;
  "connector.credential.revoked": ConnectorCredentialRevokedEvent;
  "connector.circuit.opened": ConnectorCircuitOpenedEvent;
  "connector.circuit.closed": ConnectorCircuitClosedEvent;
  "connector.circuit.halfOpen": ConnectorCircuitHalfOpenEvent;
  "connector.rateLimit.warning": ConnectorRateLimitWarningEvent;
  "connector.rateLimit.exceeded": ConnectorRateLimitExceededEvent;
  "connector.health.degraded": ConnectorHealthDegradedEvent;
  "connector.health.recovered": ConnectorHealthRecoveredEvent;
  "connector.webhook.received": ConnectorWebhookReceivedEvent;
  "connector.saga.started": ConnectorSagaStartedEvent;
  "connector.saga.completed": ConnectorSagaCompletedEvent;
  "connector.saga.compensating": ConnectorSagaCompensatingEvent;
  "connector.saga.failed": ConnectorSagaFailedEvent;
}

export type ConnectorEventHandler<T extends ConnectorEventType> = (
  event: ConnectorEventMap[T],
) => void | Promise<void>;

// ─── Ring Buffer ───────────────────────────────────────────────────

const RING_BUFFER_CAPACITY = 500;

class RingBuffer<T> {
  private readonly _buf: (T | undefined)[];
  private _head = 0;
  private _size = 0;

  constructor(capacity: number) {
    this._buf = new Array(capacity);
  }

  push(item: T): void {
    this._buf[this._head] = item;
    this._head = (this._head + 1) % this._buf.length;
    if (this._size < this._buf.length) this._size++;
  }

  toArray(limit?: number): T[] {
    const count = limit !== undefined ? Math.min(limit, this._size) : this._size;
    const result: T[] = [];
    // Read oldest-first: start from (head - size) and walk forward
    const start = (this._head - this._size + this._buf.length) % this._buf.length;
    const offset = this._size - count;
    for (let i = 0; i < count; i++) {
      const idx = (start + offset + i) % this._buf.length;
      result.push(this._buf[idx] as T);
    }
    return result;
  }

  get size(): number {
    return this._size;
  }

  clear(): void {
    this._buf.fill(undefined);
    this._head = 0;
    this._size = 0;
  }
}

// ─── ConnectorEventBus ─────────────────────────────────────────────

export class ConnectorEventBus {
  private readonly _handlers = new Map<
    ConnectorEventType,
    Set<ConnectorEventHandler<any>>
  >();
  private readonly _onceHandlers = new Map<
    ConnectorEventType,
    Set<ConnectorEventHandler<any>>
  >();
  private readonly _recentEvents = new RingBuffer<ConnectorEvent>(RING_BUFFER_CAPACITY);
  private readonly _pipes: ConnectorEventBus[] = [];
  private _wildcardHandlers: Set<(event: ConnectorEvent) => void | Promise<void>> = new Set();

  // ── Subscribe ────────────────────────────────────────────────────

  /**
   * Subscribe to a specific event type.  The handler receives the
   * correctly-typed event payload.
   */
  on<T extends ConnectorEventType>(
    eventType: T,
    handler: ConnectorEventHandler<T>,
  ): void {
    let set = this._handlers.get(eventType);
    if (!set) {
      set = new Set();
      this._handlers.set(eventType, set);
    }
    set.add(handler);
  }

  /**
   * Subscribe to a specific event type for a single invocation.
   * The handler is automatically removed after the first call.
   */
  once<T extends ConnectorEventType>(
    eventType: T,
    handler: ConnectorEventHandler<T>,
  ): void {
    let set = this._onceHandlers.get(eventType);
    if (!set) {
      set = new Set();
      this._onceHandlers.set(eventType, set);
    }
    set.add(handler);
  }

  /**
   * Subscribe to ALL events (wildcard).  Useful for logging / metrics.
   */
  onAny(handler: (event: ConnectorEvent) => void | Promise<void>): void {
    this._wildcardHandlers.add(handler);
  }

  // ── Unsubscribe ──────────────────────────────────────────────────

  /**
   * Remove a previously registered handler.
   */
  off<T extends ConnectorEventType>(
    eventType: T,
    handler: ConnectorEventHandler<T>,
  ): void {
    this._handlers.get(eventType)?.delete(handler);
    this._onceHandlers.get(eventType)?.delete(handler);
  }

  /**
   * Remove a wildcard handler.
   */
  offAny(handler: (event: ConnectorEvent) => void | Promise<void>): void {
    this._wildcardHandlers.delete(handler);
  }

  // ── Emit ─────────────────────────────────────────────────────────

  /**
   * Asynchronously dispatch an event to all handlers.
   * Fire-and-forget: handler errors are caught and logged, never propagate
   * to the emitter.  Returns immediately without awaiting handlers.
   */
  emit(event: ConnectorEvent): void {
    // Stamp timestamp if not present
    if (!event.timestamp) {
      (event as any).timestamp = Date.now();
    }

    // Record in ring buffer
    this._recentEvents.push(event);

    const eventType = event.type as ConnectorEventType;

    // Persistent handlers
    const persistent = this._handlers.get(eventType);
    if (persistent) {
      for (const handler of persistent) {
        this._safeInvoke(handler, event);
      }
    }

    // Once handlers — invoke and remove
    const once = this._onceHandlers.get(eventType);
    if (once && once.size > 0) {
      const snapshot = Array.from(once);
      once.clear();
      for (const handler of snapshot) {
        this._safeInvoke(handler, event);
      }
    }

    // Wildcard handlers
    for (const handler of this._wildcardHandlers) {
      this._safeInvoke(handler, event);
    }

    // Forward to piped buses
    for (const target of this._pipes) {
      target.emit(event);
    }
  }

  /**
   * Synchronously dispatch an event to all handlers.
   * Awaits every handler before returning.  Use for critical events
   * where ordering guarantees matter.
   */
  async emitSync(event: ConnectorEvent): Promise<void> {
    if (!event.timestamp) {
      (event as any).timestamp = Date.now();
    }

    this._recentEvents.push(event);

    const eventType = event.type as ConnectorEventType;

    // Persistent handlers
    const persistent = this._handlers.get(eventType);
    if (persistent) {
      for (const handler of persistent) {
        await this._safeInvokeAsync(handler, event);
      }
    }

    // Once handlers
    const once = this._onceHandlers.get(eventType);
    if (once && once.size > 0) {
      const snapshot = Array.from(once);
      once.clear();
      for (const handler of snapshot) {
        await this._safeInvokeAsync(handler, event);
      }
    }

    // Wildcard handlers
    for (const handler of this._wildcardHandlers) {
      await this._safeInvokeAsync(handler, event);
    }

    // Forward to piped buses (await each)
    for (const target of this._pipes) {
      await target.emitSync(event);
    }
  }

  // ── Introspection ────────────────────────────────────────────────

  /**
   * Return the most recent events from the ring buffer.
   * @param limit Max number of events to return (default: all, up to 500)
   */
  getRecentEvents(limit?: number): ConnectorEvent[] {
    return this._recentEvents.toArray(limit);
  }

  /**
   * Return the number of registered listeners.
   * If `eventType` is provided, returns count for that type only.
   * Otherwise returns total across all types.
   */
  getListenerCount(eventType?: ConnectorEventType): number {
    if (eventType) {
      const persistent = this._handlers.get(eventType)?.size ?? 0;
      const once = this._onceHandlers.get(eventType)?.size ?? 0;
      return persistent + once;
    }

    let total = this._wildcardHandlers.size;
    for (const set of this._handlers.values()) {
      total += set.size;
    }
    for (const set of this._onceHandlers.values()) {
      total += set.size;
    }
    return total;
  }

  // ── waitFor ──────────────────────────────────────────────────────

  /**
   * Returns a promise that resolves when an event of the given type is
   * emitted (optionally matching a predicate).  Rejects on timeout.
   *
   * @param eventType   The event type to wait for
   * @param predicate   Optional filter — event must match to resolve
   * @param timeoutMs   Max wait time (default 30 000 ms)
   */
  waitFor<T extends ConnectorEventType>(
    eventType: T,
    predicate?: (event: ConnectorEventMap[T]) => boolean,
    timeoutMs: number = 30_000,
  ): Promise<ConnectorEventMap[T]> {
    return new Promise<ConnectorEventMap[T]>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;

      const handler: ConnectorEventHandler<T> = (event) => {
        if (settled) return;
        if (predicate && !predicate(event)) return;

        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        this.off(eventType, handler);
        resolve(event);
      };

      this.on(eventType, handler);

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.off(eventType, handler);
        reject(
          new Error(
            `ConnectorEventBus.waitFor("${eventType}") timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    });
  }

  // ── Piping ───────────────────────────────────────────────────────

  /**
   * Forward all events emitted on this bus to the target bus.
   */
  pipe(targetBus: ConnectorEventBus): void {
    if (targetBus === this) return; // prevent self-pipe loop
    if (!this._pipes.includes(targetBus)) {
      this._pipes.push(targetBus);
    }
  }

  /**
   * Stop forwarding events to the target bus.
   */
  unpipe(targetBus: ConnectorEventBus): void {
    const idx = this._pipes.indexOf(targetBus);
    if (idx !== -1) this._pipes.splice(idx, 1);
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  /**
   * Remove all handlers and clear the event history.
   */
  removeAllListeners(): void {
    this._handlers.clear();
    this._onceHandlers.clear();
    this._wildcardHandlers.clear();
    this._pipes.length = 0;
    this._recentEvents.clear();
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Invoke handler without awaiting (fire-and-forget).
   * Errors are caught and logged to prevent handler failures from
   * affecting the emitter or other handlers.
   */
  private _safeInvoke(handler: Function, event: ConnectorEvent): void {
    try {
      const result = handler(event);
      // If handler returns a promise, catch its rejection
      if (result && typeof result === "object" && typeof (result as any).catch === "function") {
        (result as Promise<unknown>).catch((err: unknown) => {
          this._logHandlerError(event.type, err);
        });
      }
    } catch (err: unknown) {
      this._logHandlerError(event.type, err);
    }
  }

  /**
   * Invoke handler and await it.  Errors are caught and logged.
   */
  private async _safeInvokeAsync(handler: Function, event: ConnectorEvent): Promise<void> {
    try {
      await handler(event);
    } catch (err: unknown) {
      this._logHandlerError(event.type, err);
    }
  }

  /**
   * Structured error log for handler failures.
   */
  private _logHandlerError(eventType: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(
      JSON.stringify({
        event: "connector_event_handler_error",
        eventType,
        error: message,
        ...(stack ? { stack } : {}),
        timestamp: Date.now(),
      }),
    );
  }
}

// ─── Built-in Handlers ─────────────────────────────────────────────

function registerBuiltInHandlers(bus: ConnectorEventBus): void {
  // Log all events at debug level (structured JSON)
  bus.onAny((event) => {
    // Serialize Date objects for JSON output
    const serializable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event)) {
      serializable[key] = value instanceof Date ? value.toISOString() : value;
    }
    console.debug(
      JSON.stringify({
        event: "connector_event",
        ...serializable,
      }),
    );
  });

  // Circuit opened → warn level
  bus.on("connector.circuit.opened", (event) => {
    console.warn(
      JSON.stringify({
        event: "connector_circuit_opened",
        level: "warn",
        connectorId: event.connectorId,
        failureCount: event.failureCount,
        lastError: event.lastError,
        timestamp: event.timestamp,
      }),
    );
  });

  // Credential expired → error level
  bus.on("connector.credential.expired", (event) => {
    console.error(
      JSON.stringify({
        event: "connector_credential_expired",
        level: "error",
        connectorId: event.connectorId,
        userId: event.userId,
        timestamp: event.timestamp,
      }),
    );
  });

  // Rate limit exceeded → warn level
  bus.on("connector.rateLimit.exceeded", (event) => {
    console.warn(
      JSON.stringify({
        event: "connector_rate_limit_exceeded",
        level: "warn",
        connectorId: event.connectorId,
        userId: event.userId,
        retryAfterMs: event.retryAfterMs,
        timestamp: event.timestamp,
      }),
    );
  });
}

// ─── Singleton ─────────────────────────────────────────────────────

export const connectorEventBus = new ConnectorEventBus();
registerBuiltInHandlers(connectorEventBus);
