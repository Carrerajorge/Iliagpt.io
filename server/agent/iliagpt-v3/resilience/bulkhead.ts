type QueuedTask<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export class Semaphore {
  private available: number;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent: number) {
    this.available = maxConcurrent;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.available++;
    }
  }

  getAvailable(): number {
    return this.available;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }
}

export class ConcurrencyLimiter {
  private semaphore: Semaphore;

  constructor(maxConcurrent: number) {
    this.semaphore = new Semaphore(maxConcurrent);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.semaphore.acquire();
    
    try {
      return await fn();
    } finally {
      this.semaphore.release();
    }
  }

  getAvailable(): number {
    return this.semaphore.getAvailable();
  }

  getQueueLength(): number {
    return this.semaphore.getQueueLength();
  }

  getMaxConcurrent(): number {
    return this.semaphore.getMaxConcurrent();
  }
}

export class Bulkhead {
  private limiters = new Map<string, ConcurrencyLimiter>();

  constructor(private defaultMax: number) {}

  getLimiter(key: string, maxConcurrent?: number): ConcurrencyLimiter {
    const max = maxConcurrent ?? this.defaultMax;
    const cacheKey = `${key}:${max}`;
    
    let limiter = this.limiters.get(cacheKey);
    
    if (!limiter) {
      limiter = new ConcurrencyLimiter(max);
      this.limiters.set(cacheKey, limiter);
    }
    
    return limiter;
  }

  async run<T>(key: string, fn: () => Promise<T>, maxConcurrent?: number): Promise<T> {
    const limiter = this.getLimiter(key, maxConcurrent);
    return limiter.run(fn);
  }

  snapshot(): Record<string, { available: number; queueLength: number; maxConcurrent: number }> {
    const result: Record<string, { available: number; queueLength: number; maxConcurrent: number }> = {};
    
    for (const [key, limiter] of Array.from(this.limiters.entries())) {
      result[key] = {
        available: limiter.getAvailable(),
        queueLength: limiter.getQueueLength(),
        maxConcurrent: limiter.getMaxConcurrent(),
      };
    }
    
    return result;
  }

  getStats(key: string): { available: number; queueLength: number; maxConcurrent: number } | undefined {
    for (const [k, limiter] of Array.from(this.limiters.entries())) {
      if (k.startsWith(`${key}:`)) {
        return {
          available: limiter.getAvailable(),
          queueLength: limiter.getQueueLength(),
          maxConcurrent: limiter.getMaxConcurrent(),
        };
      }
    }
    return undefined;
  }

  clear(): void {
    this.limiters.clear();
  }
}
