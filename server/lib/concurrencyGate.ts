export interface ConcurrencyGateState {
  activeCount: number;
  pendingCount: number;
  maxConcurrent: number;
  maxPending: number;
}

interface ConcurrencyGateOptions {
  maxConcurrent: number;
  maxPending?: number;
  onStateChange?: (state: ConcurrencyGateState) => void;
}

export class ConcurrencyGate {
  private readonly maxConcurrent: number;
  private readonly maxPending: number;
  private readonly onStateChange?: (state: ConcurrencyGateState) => void;
  private activeCount = 0;
  private pendingResolvers: Array<() => void> = [];

  constructor(options: ConcurrencyGateOptions) {
    this.maxConcurrent = Math.max(1, Math.trunc(options.maxConcurrent));
    this.maxPending = Math.max(0, Math.trunc(options.maxPending ?? Number.POSITIVE_INFINITY));
    this.onStateChange = options.onStateChange;
  }

  getState(): ConcurrencyGateState {
    return {
      activeCount: this.activeCount,
      pendingCount: this.pendingResolvers.length,
      maxConcurrent: this.maxConcurrent,
      maxPending: this.maxPending,
    };
  }

  private notifyStateChange(): void {
    this.onStateChange?.(this.getState());
  }

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount += 1;
      this.notifyStateChange();
      return;
    }

    if (this.pendingResolvers.length >= this.maxPending) {
      throw new Error(
        `Concurrency gate queue is full (${this.pendingResolvers.length}/${this.maxPending})`,
      );
    }

    await new Promise<void>((resolve) => {
      this.pendingResolvers.push(resolve);
      this.notifyStateChange();
    });

    this.activeCount += 1;
    this.notifyStateChange();
  }

  release(): void {
    if (this.activeCount > 0) {
      this.activeCount -= 1;
    }

    const next = this.pendingResolvers.shift();
    this.notifyStateChange();
    next?.();
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  async *runStream<T>(factory: () => AsyncIterable<T>): AsyncGenerator<T, void, unknown> {
    await this.acquire();
    const iterator = factory()[Symbol.asyncIterator]();

    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) {
          return;
        }
        yield result.value;
      }
    } finally {
      await iterator.return?.();
      this.release();
    }
  }
}
