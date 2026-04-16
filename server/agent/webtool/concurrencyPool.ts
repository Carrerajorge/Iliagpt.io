import { EventEmitter } from "events";

export interface PoolTask<T> {
  id: string;
  execute: () => Promise<T>;
  priority?: number;
  timeout?: number;
}

export interface PoolResult<T> {
  id: string;
  success: boolean;
  result?: T;
  error?: string;
  durationMs: number;
}

export interface PoolOptions {
  maxConcurrency: number;
  defaultTimeout: number;
  retryOnTimeout: boolean;
  maxRetries: number;
}

const DEFAULT_POOL_OPTIONS: PoolOptions = {
  maxConcurrency: 5,
  defaultTimeout: 10000,
  retryOnTimeout: false,
  maxRetries: 1,
};

export class ConcurrencyPool<T> extends EventEmitter {
  private options: PoolOptions;
  private running: Map<string, Promise<PoolResult<T>>> = new Map();
  private queue: PoolTask<T>[] = [];
  private results: Map<string, PoolResult<T>> = new Map();
  private completedCount = 0;
  private totalTasks = 0;

  constructor(options: Partial<PoolOptions> = {}) {
    super();
    this.options = { ...DEFAULT_POOL_OPTIONS, ...options };
  }

  async executeAll(tasks: PoolTask<T>[]): Promise<PoolResult<T>[]> {
    if (tasks.length === 0) {
      return [];
    }

    this.totalTasks = tasks.length;
    this.completedCount = 0;
    this.results.clear();
    
    const sortedTasks = [...tasks].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.queue = sortedTasks;
    
    await this.processQueue();
    
    return tasks.map(task => this.results.get(task.id)!);
  }

  async *executeStreaming(tasks: PoolTask<T>[]): AsyncGenerator<PoolResult<T>> {
    if (tasks.length === 0) {
      return;
    }

    this.totalTasks = tasks.length;
    this.completedCount = 0;
    this.results.clear();
    
    const sortedTasks = [...tasks].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.queue = sortedTasks;
    
    const resultQueue: PoolResult<T>[] = [];
    let resolveNext: (() => void) | null = null;
    let allDone = false;
    
    const originalEmit = this.emit.bind(this);
    this.emit = (event: string, ...args: any[]) => {
      if (event === "result") {
        resultQueue.push(args[0] as PoolResult<T>);
        if (resolveNext) {
          resolveNext();
          resolveNext = null;
        }
      }
      return originalEmit(event, ...args);
    };
    
    const processPromise = this.processQueue().then(() => {
      allDone = true;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });
    
    while (!allDone || resultQueue.length > 0) {
      if (resultQueue.length > 0) {
        yield resultQueue.shift()!;
      } else if (!allDone) {
        await new Promise<void>(resolve => {
          resolveNext = resolve;
        });
      }
    }
    
    await processPromise;
  }

  private async processQueue(): Promise<void> {
    const fillSlots = () => {
      while (this.running.size < this.options.maxConcurrency && this.queue.length > 0) {
        const task = this.queue.shift()!;
        const promise = this.executeTask(task);
        this.running.set(task.id, promise);
        
        promise.finally(() => {
          this.running.delete(task.id);
          fillSlots();
        });
      }
    };
    
    fillSlots();
    
    while (this.running.size > 0 || this.queue.length > 0) {
      if (this.running.size > 0) {
        await Promise.race(this.running.values());
      }
    }
  }

  private async executeTask(task: PoolTask<T>, retryCount = 0): Promise<PoolResult<T>> {
    const startTime = Date.now();
    const timeout = task.timeout || this.options.defaultTimeout;

    let timeoutTimer: ReturnType<typeof setTimeout>;
    try {
      const result = await Promise.race([
        task.execute(),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => reject(new Error("Task timeout")), timeout);
        }),
      ]);
      clearTimeout(timeoutTimer!);

      const poolResult: PoolResult<T> = {
        id: task.id,
        success: true,
        result,
        durationMs: Date.now() - startTime,
      };

      this.results.set(task.id, poolResult);
      this.completedCount++;
      this.emit("result", poolResult);
      this.emit("progress", { completed: this.completedCount, total: this.totalTasks });

      return poolResult;
    } catch (error) {
      clearTimeout(timeoutTimer!);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (
        this.options.retryOnTimeout &&
        errorMessage === "Task timeout" &&
        retryCount < this.options.maxRetries
      ) {
        return this.executeTask(task, retryCount + 1);
      }
      
      const poolResult: PoolResult<T> = {
        id: task.id,
        success: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
      
      this.results.set(task.id, poolResult);
      this.completedCount++;
      this.emit("result", poolResult);
      this.emit("progress", { completed: this.completedCount, total: this.totalTasks });
      
      return poolResult;
    }
  }

  getProgress(): { completed: number; total: number; running: number; queued: number } {
    return {
      completed: this.completedCount,
      total: this.totalTasks,
      running: this.running.size,
      queued: this.queue.length,
    };
  }

  cancel(): void {
    this.queue = [];
    this.emit("cancelled");
  }
}

export function createConcurrencyPool<T>(options?: Partial<PoolOptions>): ConcurrencyPool<T> {
  return new ConcurrencyPool<T>(options);
}
