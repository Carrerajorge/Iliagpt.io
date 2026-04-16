export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenMaxCalls?: number;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreakerError extends Error {
  public readonly state: CircuitState;
  public readonly nextAttemptAt: Date;

  constructor(state: CircuitState, nextAttemptAt: Date) {
    super(`Circuit breaker is ${state}. Next attempt allowed at ${nextAttemptAt.toISOString()}`);
    this.state = state;
    this.nextAttemptAt = nextAttemptAt;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: Date | null = null;
  private halfOpenCallCount: number = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenMaxCalls: number;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(private readonly name: string, options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 60000;
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? 1;
    this.onStateChange = options.onStateChange ?? this.defaultOnStateChange.bind(this);
  }

  private defaultOnStateChange(from: CircuitState, to: CircuitState): void {
    console.log(`[CircuitBreaker:${this.name}] State transition: ${from} -> ${to}`);
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      
      if (newState === CircuitState.CLOSED) {
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
      } else if (newState === CircuitState.HALF_OPEN) {
        this.halfOpenCallCount = 0;
      }

      this.onStateChange?.(oldState, newState);
    }
  }

  private shouldAttemptReset(): boolean {
    if (this.state !== CircuitState.OPEN || !this.lastFailureTime) {
      return false;
    }
    const timeSinceFailure = Date.now() - this.lastFailureTime.getTime();
    return timeSinceFailure >= this.resetTimeout;
  }

  private getNextAttemptTime(): Date {
    if (!this.lastFailureTime) {
      return new Date();
    }
    return new Date(this.lastFailureTime.getTime() + this.resetTimeout);
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new CircuitBreakerError(this.state, this.getNextAttemptTime());
      }
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenCallCount >= this.halfOpenMaxCalls) {
        throw new CircuitBreakerError(this.state, this.getNextAttemptTime());
      }
      this.halfOpenCallCount++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxCalls) {
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED && this.failureCount >= this.failureThreshold) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  public getState(): CircuitState {
    return this.state;
  }

  public reset(): void {
    this.transitionTo(CircuitState.CLOSED);
  }

  public getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: Date | null;
    nextAttemptAt: Date | null;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptAt: this.state === CircuitState.OPEN ? this.getNextAttemptTime() : null,
    };
  }
}

const circuitBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
  let breaker = circuitBreakers.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, options);
    circuitBreakers.set(name, breaker);
  }
  return breaker;
}

export function getAllCircuitBreakers(): Map<string, CircuitBreaker> {
  return new Map(circuitBreakers);
}

export function resetCircuitBreaker(name: string): void {
  const breaker = circuitBreakers.get(name);
  if (breaker) {
    breaker.reset();
  }
}

export function resetAllCircuitBreakers(): void {
  circuitBreakers.forEach(breaker => breaker.reset());
}
