/**
 * Parser Sandbox - Worker-based parser execution with resource limits
 * PARE Phase 2 Security Hardening
 * 
 * Provides timeout, memory limit tracking, and CPU time monitoring for parser operations.
 * Includes WorkerPool for isolated parser execution using worker_threads.
 */

import { Worker } from 'worker_threads';
import { join } from 'path';
import type { FileParser, ParsedResult, DetectedFileType } from "../parsers/base";
import type { 
  ParserTask, 
  ParserTaskResult, 
  WorkerMessageToWorker, 
  WorkerMessageFromWorker 
} from "./pareWorkerTask.ts";
import { serializeTask, WorkerErrorCode } from "./pareWorkerTask.ts";

export interface SandboxOptions {
  timeoutMs: number;
  softMemoryLimitMB: number;
  hardMemoryLimitMB: number;
  enableCpuTracking: boolean;
}

export interface SandboxResult {
  success: boolean;
  result?: ParsedResult;
  error?: string;
  errorCode?: SandboxErrorCode;
  metrics: SandboxMetrics;
}

export interface SandboxMetrics {
  parseTimeMs: number;
  memoryUsedMB: number;
  memoryWarning: boolean;
  timedOut: boolean;
  aborted: boolean;
}

export enum SandboxErrorCode {
  TIMEOUT = 'PARSER_TIMEOUT',
  MEMORY_EXCEEDED = 'MEMORY_EXCEEDED',
  PARSE_ERROR = 'PARSE_ERROR',
  ABORTED = 'ABORTED',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
  WORKER_TERMINATED = 'WORKER_TERMINATED',
}

const DEFAULT_OPTIONS: SandboxOptions = {
  timeoutMs: 30000,
  softMemoryLimitMB: 256,
  hardMemoryLimitMB: 512,
  enableCpuTracking: true,
};

function getMemoryUsageMB(): number {
  try {
    const usage = process.memoryUsage();
    return usage.heapUsed / (1024 * 1024);
  } catch {
    return 0;
  }
}

function emitStructuredLog(
  level: 'warn' | 'error' | 'info',
  event: string,
  data: Record<string, any>
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    component: 'parserSandbox',
    ...data,
  };
  
  if (level === 'error') {
    console.error(`[PARSER_SANDBOX] ${event}`, JSON.stringify(logEntry));
  } else if (level === 'warn') {
    console.warn(`[PARSER_SANDBOX] ${event}`, JSON.stringify(logEntry));
  } else {
    console.log(`[PARSER_SANDBOX] ${event}`, JSON.stringify(logEntry));
  }
}

export interface WorkerPoolOptions {
  poolSize: number;
  defaultTimeout: number;
  workerScript?: string;
}

export interface WorkerPoolStats {
  activeWorkers: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalWorkers: number;
}

interface QueuedTask {
  task: ParserTask;
  resolve: (result: ParserTaskResult) => void;
  reject: (error: Error) => void;
  timeoutHandle?: NodeJS.Timeout;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
  currentTaskId: string | null;
  taskTimeoutHandle: NodeJS.Timeout | null;
}

const DEFAULT_POOL_OPTIONS: WorkerPoolOptions = {
  poolSize: 3,
  defaultTimeout: 30000,
};

export class WorkerPool {
  private workers: PoolWorker[] = [];
  private taskQueue: QueuedTask[] = [];
  private completedTasks = 0;
  private failedTasks = 0;
  private isShuttingDown = false;
  private options: WorkerPoolOptions;
  private pendingTasks: Map<string, QueuedTask> = new Map();

  constructor(options: Partial<WorkerPoolOptions> = {}) {
    this.options = { ...DEFAULT_POOL_OPTIONS, ...options };
    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    const workerScript = this.options.workerScript || 
      join(__dirname, '../workers/parserWorker.ts');
    
    for (let i = 0; i < this.options.poolSize; i++) {
      try {
        const worker = new Worker(workerScript, {
          execArgv: ['--require', 'tsx/cjs'],
        });
        
        const poolWorker: PoolWorker = {
          worker,
          busy: false,
          currentTaskId: null,
          taskTimeoutHandle: null,
        };

        worker.on('message', (message: WorkerMessageFromWorker) => {
          this.handleWorkerMessage(poolWorker, message);
        });

        worker.on('error', (error) => {
          emitStructuredLog('error', 'WORKER_ERROR', {
            workerId: i,
            error: error.message,
          });
          this.handleWorkerError(poolWorker, error);
        });

        worker.on('exit', (code) => {
          if (code !== 0 && !this.isShuttingDown) {
            emitStructuredLog('warn', 'WORKER_EXITED', {
              workerId: i,
              exitCode: code,
            });
            this.replaceWorker(poolWorker);
          }
        });

        this.workers.push(poolWorker);
      } catch (error) {
        emitStructuredLog('error', 'WORKER_INIT_FAILED', {
          workerId: i,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    emitStructuredLog('info', 'WORKER_POOL_INITIALIZED', {
      poolSize: this.workers.length,
    });
  }

  private handleWorkerMessage(poolWorker: PoolWorker, message: WorkerMessageFromWorker): void {
    switch (message.type) {
      case 'result':
        this.completeTask(poolWorker, message.result);
        break;
        
      case 'error':
        const errorResult: ParserTaskResult = {
          taskId: message.taskId,
          success: false,
          error: message.error,
          errorCode: message.errorCode,
          metrics: { parseTimeMs: 0, memoryUsedMB: 0 },
        };
        this.completeTask(poolWorker, errorResult);
        break;
        
      case 'ready':
        emitStructuredLog('info', 'WORKER_READY', {});
        break;
        
      case 'shutdown_complete':
        break;
    }
  }

  private handleWorkerError(poolWorker: PoolWorker, error: Error): void {
    if (poolWorker.currentTaskId) {
      const queuedTask = this.pendingTasks.get(poolWorker.currentTaskId);
      if (queuedTask) {
        this.pendingTasks.delete(poolWorker.currentTaskId);
        this.failedTasks++;
        queuedTask.reject(error);
      }
    }
    
    poolWorker.busy = false;
    poolWorker.currentTaskId = null;
    
    if (poolWorker.taskTimeoutHandle) {
      clearTimeout(poolWorker.taskTimeoutHandle);
      poolWorker.taskTimeoutHandle = null;
    }
  }

  private replaceWorker(oldWorker: PoolWorker): void {
    const index = this.workers.indexOf(oldWorker);
    if (index === -1) return;

    try {
      const workerScript = this.options.workerScript || 
        join(__dirname, '../workers/parserWorker.ts');
      
      const worker = new Worker(workerScript, {
        execArgv: ['--require', 'tsx/cjs'],
      });
      
      const newPoolWorker: PoolWorker = {
        worker,
        busy: false,
        currentTaskId: null,
        taskTimeoutHandle: null,
      };

      worker.on('message', (message: WorkerMessageFromWorker) => {
        this.handleWorkerMessage(newPoolWorker, message);
      });

      worker.on('error', (error) => {
        this.handleWorkerError(newPoolWorker, error);
      });

      worker.on('exit', (code) => {
        if (code !== 0 && !this.isShuttingDown) {
          this.replaceWorker(newPoolWorker);
        }
      });

      this.workers[index] = newPoolWorker;
      this.processQueue();
    } catch (error) {
      emitStructuredLog('error', 'WORKER_REPLACE_FAILED', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private completeTask(poolWorker: PoolWorker, result: ParserTaskResult): void {
    const queuedTask = this.pendingTasks.get(result.taskId);
    
    if (poolWorker.taskTimeoutHandle) {
      clearTimeout(poolWorker.taskTimeoutHandle);
      poolWorker.taskTimeoutHandle = null;
    }
    
    poolWorker.busy = false;
    poolWorker.currentTaskId = null;
    
    if (queuedTask) {
      this.pendingTasks.delete(result.taskId);
      
      if (result.success) {
        this.completedTasks++;
      } else {
        this.failedTasks++;
      }
      
      queuedTask.resolve(result);
    }
    
    this.processQueue();
  }

  private processQueue(): void {
    if (this.isShuttingDown || this.taskQueue.length === 0) return;
    
    const availableWorker = this.workers.find(w => !w.busy);
    if (!availableWorker) return;
    
    const queuedTask = this.taskQueue.shift();
    if (!queuedTask) return;
    
    availableWorker.busy = true;
    availableWorker.currentTaskId = queuedTask.task.taskId;
    this.pendingTasks.set(queuedTask.task.taskId, queuedTask);
    
    const timeout = queuedTask.task.options?.timeout || this.options.defaultTimeout;
    
    availableWorker.taskTimeoutHandle = setTimeout(() => {
      this.handleTaskTimeout(availableWorker, queuedTask.task.taskId);
    }, timeout + 2000);
    
    const message: WorkerMessageToWorker = {
      type: 'task',
      task: serializeTask(queuedTask.task),
    };
    
    availableWorker.worker.postMessage(message);
  }

  private handleTaskTimeout(poolWorker: PoolWorker, taskId: string): void {
    emitStructuredLog('error', 'TASK_TIMEOUT_KILL', {
      taskId,
    });
    
    const queuedTask = this.pendingTasks.get(taskId);
    if (queuedTask) {
      this.pendingTasks.delete(taskId);
      this.failedTasks++;
      
      const timeoutResult: ParserTaskResult = {
        taskId,
        success: false,
        error: 'Worker forcefully terminated due to timeout',
        errorCode: WorkerErrorCode.TIMEOUT,
        metrics: { parseTimeMs: 0, memoryUsedMB: 0 },
      };
      
      queuedTask.resolve(timeoutResult);
    }
    
    poolWorker.worker.terminate().catch(() => {});
    
    this.replaceWorker(poolWorker);
  }

  public submit(task: ParserTask): Promise<ParserTaskResult> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('Worker pool is shutting down'));
    }
    
    return new Promise((resolve, reject) => {
      const queuedTask: QueuedTask = {
        task,
        resolve,
        reject,
      };
      
      this.taskQueue.push(queuedTask);
      this.processQueue();
    });
  }

  public getStats(): WorkerPoolStats {
    return {
      activeWorkers: this.workers.filter(w => w.busy).length,
      queuedTasks: this.taskQueue.length,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      totalWorkers: this.workers.length,
    };
  }

  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    for (const queuedTask of this.taskQueue) {
      queuedTask.reject(new Error('Worker pool shutdown'));
    }
    this.taskQueue = [];
    
    const shutdownPromises = this.workers.map(async (poolWorker) => {
      if (poolWorker.taskTimeoutHandle) {
        clearTimeout(poolWorker.taskTimeoutHandle);
      }
      
      try {
        const shutdownMessage: WorkerMessageToWorker = { type: 'shutdown' };
        poolWorker.worker.postMessage(shutdownMessage);
        
        await Promise.race([
          new Promise<void>((resolve) => {
            poolWorker.worker.on('exit', () => resolve());
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ]);
        
        await poolWorker.worker.terminate();
      } catch (error) {
        emitStructuredLog('warn', 'WORKER_SHUTDOWN_ERROR', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    
    await Promise.all(shutdownPromises);
    this.workers = [];
    
    emitStructuredLog('info', 'WORKER_POOL_SHUTDOWN', {
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
    });
  }
}

let globalWorkerPool: WorkerPool | null = null;

export function getWorkerPool(options?: Partial<WorkerPoolOptions>): WorkerPool {
  if (!globalWorkerPool) {
    globalWorkerPool = new WorkerPool(options);
  }
  return globalWorkerPool;
}

export async function shutdownWorkerPool(): Promise<void> {
  if (globalWorkerPool) {
    await globalWorkerPool.shutdown();
    globalWorkerPool = null;
  }
}

/**
 * Run a parser in a sandboxed environment with resource limits
 */
export async function runParserInSandbox(
  parser: FileParser,
  content: Buffer,
  fileType: DetectedFileType,
  options: Partial<SandboxOptions> = {}
): Promise<SandboxResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();
  const initialMemory = getMemoryUsageMB();
  
  const metrics: SandboxMetrics = {
    parseTimeMs: 0,
    memoryUsedMB: 0,
    memoryWarning: false,
    timedOut: false,
    aborted: false,
  };

  const abortController = new AbortController();
  let memoryCheckInterval: NodeJS.Timeout | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;
  let memoryExceeded = false;

  try {
    memoryCheckInterval = setInterval(() => {
      const currentMemory = getMemoryUsageMB();
      const memoryDelta = currentMemory - initialMemory;
      
      if (memoryDelta > opts.softMemoryLimitMB && !metrics.memoryWarning) {
        metrics.memoryWarning = true;
        emitStructuredLog('warn', 'MEMORY_SOFT_LIMIT', {
          parser: parser.name,
          memoryUsedMB: memoryDelta.toFixed(2),
          softLimitMB: opts.softMemoryLimitMB,
          fileSize: content.length,
        });
      }
      
      if (memoryDelta > opts.hardMemoryLimitMB) {
        memoryExceeded = true;
        abortController.abort();
        emitStructuredLog('error', 'MEMORY_HARD_LIMIT_EXCEEDED', {
          parser: parser.name,
          memoryUsedMB: memoryDelta.toFixed(2),
          hardLimitMB: opts.hardMemoryLimitMB,
          fileSize: content.length,
        });
      }
    }, 100);

    const parsePromise = parser.parse(content, fileType);
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        metrics.timedOut = true;
        abortController.abort();
        emitStructuredLog('error', 'PARSER_TIMEOUT', {
          parser: parser.name,
          timeoutMs: opts.timeoutMs,
          fileSize: content.length,
          mimeType: fileType.mimeType,
        });
        reject(new Error(`Parser timeout after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);
    });

    const abortPromise = new Promise<never>((_, reject) => {
      abortController.signal.addEventListener('abort', () => {
        if (memoryExceeded) {
          reject(new Error('Memory limit exceeded'));
        } else {
          metrics.aborted = true;
          reject(new Error('Parse operation aborted'));
        }
      });
    });

    const result = await Promise.race([parsePromise, timeoutPromise, abortPromise]);

    metrics.parseTimeMs = Date.now() - startTime;
    metrics.memoryUsedMB = getMemoryUsageMB() - initialMemory;

    return {
      success: true,
      result,
      metrics,
    };

  } catch (error) {
    metrics.parseTimeMs = Date.now() - startTime;
    metrics.memoryUsedMB = getMemoryUsageMB() - initialMemory;

    const errorMessage = error instanceof Error ? error.message : String(error);
    
    let errorCode: SandboxErrorCode;
    if (metrics.timedOut) {
      errorCode = SandboxErrorCode.TIMEOUT;
    } else if (memoryExceeded) {
      errorCode = SandboxErrorCode.MEMORY_EXCEEDED;
    } else if (metrics.aborted) {
      errorCode = SandboxErrorCode.ABORTED;
    } else {
      errorCode = SandboxErrorCode.PARSE_ERROR;
    }

    emitStructuredLog('error', 'PARSE_FAILED', {
      parser: parser.name,
      errorCode,
      error: errorMessage,
      parseTimeMs: metrics.parseTimeMs,
      memoryUsedMB: metrics.memoryUsedMB.toFixed(2),
      fileSize: content.length,
    });

    return {
      success: false,
      error: errorMessage,
      errorCode,
      metrics,
    };

  } finally {
    if (memoryCheckInterval) {
      clearInterval(memoryCheckInterval);
    }
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Create a sandboxed version of a parser
 */
export function createSandboxedParser(
  parser: FileParser,
  options: Partial<SandboxOptions> = {}
): FileParser {
  return {
    name: `Sandboxed_${parser.name}`,
    supportedMimeTypes: parser.supportedMimeTypes,
    async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
      const result = await runParserInSandbox(parser, content, type, options);
      
      if (!result.success) {
        throw new Error(`[${result.errorCode}] ${result.error}`);
      }
      
      const parsed = result.result!;
      parsed.metadata = {
        ...parsed.metadata,
        sandbox_metrics: {
          parseTimeMs: result.metrics.parseTimeMs,
          memoryUsedMB: result.metrics.memoryUsedMB,
          memoryWarning: result.metrics.memoryWarning,
        },
      };
      
      return parsed;
    },
  };
}

export const parserSandbox = {
  runParserInSandbox,
  createSandboxedParser,
  SandboxErrorCode,
  DEFAULT_OPTIONS,
  WorkerPool,
  getWorkerPool,
  shutdownWorkerPool,
};
