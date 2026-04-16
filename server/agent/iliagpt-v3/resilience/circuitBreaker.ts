import { IliagptError } from "../errors";
import type { ResolvedConfig } from "../types";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerSnapshot {
  state: CircuitState;
  failures: number;
  openedAt: number;
  halfOpenAttempts: number;
  successfulCallsInHalfOpen: number;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private openedAt = 0;
  private halfOpenAttempts = 0;
  private successfulCallsInHalfOpen = 0;

  constructor(
    private failureThreshold: number,
    private openMs: number,
    private halfOpenMaxCalls: number
  ) {}

  canExecute(): boolean {
    const now = Date.now();

    if (this.state === "OPEN") {
      if (now - this.openedAt > this.openMs) {
        this.state = "HALF_OPEN";
        this.halfOpenAttempts = 0;
        this.successfulCallsInHalfOpen = 0;
        return true;
      }
      return false;
    }

    if (this.state === "HALF_OPEN") {
      if (this.halfOpenAttempts >= this.halfOpenMaxCalls) {
        return false;
      }
      this.halfOpenAttempts++;
      return true;
    }

    return true;
  }

  onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successfulCallsInHalfOpen++;
      if (this.successfulCallsInHalfOpen >= this.halfOpenMaxCalls) {
        this.state = "CLOSED";
        this.failures = 0;
        this.halfOpenAttempts = 0;
        this.successfulCallsInHalfOpen = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  onFailure(): void {
    if (this.state === "HALF_OPEN") {
      this.trip();
      return;
    }

    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.state = "OPEN";
    this.openedAt = Date.now();
    this.failures = 0;
    this.halfOpenAttempts = 0;
    this.successfulCallsInHalfOpen = 0;
  }

  reset(): void {
    this.state = "CLOSED";
    this.failures = 0;
    this.openedAt = 0;
    this.halfOpenAttempts = 0;
    this.successfulCallsInHalfOpen = 0;
  }

  getState(): CircuitState {
    return this.state;
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      state: this.state,
      failures: this.failures,
      openedAt: this.openedAt,
      halfOpenAttempts: this.halfOpenAttempts,
      successfulCallsInHalfOpen: this.successfulCallsInHalfOpen,
    };
  }

  getTimeUntilReset(): number | null {
    if (this.state !== "OPEN") return null;
    const elapsed = Date.now() - this.openedAt;
    return Math.max(0, this.openMs - elapsed);
  }
}

export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  constructor(private cfg: ResolvedConfig) {}

  get(key: string): CircuitBreaker {
    const existing = this.breakers.get(key);
    if (existing) return existing;

    const cb = new CircuitBreaker(
      this.cfg.CB_FAILURE_THRESHOLD,
      this.cfg.CB_OPEN_MS,
      this.cfg.CB_HALF_OPEN_MAX_CALLS
    );
    this.breakers.set(key, cb);
    return cb;
  }

  reset(key: string): void {
    const cb = this.breakers.get(key);
    if (cb) cb.reset();
  }

  resetAll(): void {
    for (const cb of Array.from(this.breakers.values())) {
      cb.reset();
    }
  }

  snapshot(): Record<string, CircuitBreakerSnapshot> {
    const result: Record<string, CircuitBreakerSnapshot> = {};
    for (const [key, cb] of Array.from(this.breakers.entries())) {
      result[key] = cb.snapshot();
    }
    return result;
  }

  getOpenCircuits(): string[] {
    return Array.from(this.breakers.entries())
      .filter(([_, cb]) => cb.getState() === "OPEN")
      .map(([key]) => key);
  }
}

export function withCircuitBreaker<T>(
  cb: CircuitBreaker,
  fn: () => Promise<T>,
  toolName: string
): Promise<T> {
  if (!cb.canExecute()) {
    throw new IliagptError("E_CIRCUIT_OPEN", `Circuit open: ${toolName}`, {
      tool: toolName,
      circuit: cb.snapshot(),
    });
  }

  return fn()
    .then((result) => {
      cb.onSuccess();
      return result;
    })
    .catch((error) => {
      cb.onFailure();
      throw error;
    });
}
