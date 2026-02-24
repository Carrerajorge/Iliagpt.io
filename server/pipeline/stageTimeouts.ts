import { EventEmitter } from "events";
import { z } from "zod";

export const StageNameSchema = z.enum([
  "preprocess",
  "nlu",
  "retrieval",
  "rerank",
  "generation",
  "postprocess",
  "total"
]);
export type StageName = z.infer<typeof StageNameSchema>;

export interface StageTimeoutConfig {
  preprocess: number;
  nlu: number;
  retrieval: number;
  rerank: number;
  generation: number;
  postprocess: number;
  total: number;
}

const DEFAULT_TIMEOUTS: StageTimeoutConfig = {
  preprocess: 200,
  nlu: 400,
  retrieval: 2000,
  rerank: 800,
  generation: 6000,
  postprocess: 200,
  total: 10000
};

const AGGRESSIVE_TIMEOUTS: StageTimeoutConfig = {
  preprocess: 100,
  nlu: 200,
  retrieval: 1500,
  rerank: 500,
  generation: 4000,
  postprocess: 100,
  total: 7000
};

export interface StageResult<T = any> {
  success: boolean;
  data?: T;
  error?: Error;
  durationMs: number;
  timedOut: boolean;
  stage: StageName;
  aborted?: boolean;
}

export interface PipelineLatency {
  preprocess: number | null;
  nlu: number | null;
  retrieval: number | null;
  rerank: number | null;
  generation: number | null;
  postprocess: number | null;
  total: number;
}

export interface AbortableOperation<T> {
  execute: (signal: AbortSignal) => Promise<T>;
  onAbort?: () => void;
  fallback?: () => T;
}

export interface ExecuteWithAbortOptions {
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class StageTimeoutError extends Error {
  constructor(
    public readonly stage: StageName,
    public readonly timeoutMs: number,
    public readonly elapsedMs: number
  ) {
    super(`Stage '${stage}' timed out after ${elapsedMs}ms (limit: ${timeoutMs}ms)`);
    this.name = "StageTimeoutError";
  }
}

export class StageAbortError extends Error {
  constructor(
    public readonly stage: StageName,
    public readonly reason: string = "Operation aborted"
  ) {
    super(`Stage '${stage}' was aborted: ${reason}`);
    this.name = "StageAbortError";
  }
}

export class StageWatchdog extends EventEmitter {
  private config: StageTimeoutConfig;
  private stageTimers: Map<StageName, NodeJS.Timeout> = new Map();
  private stageStartTimes: Map<StageName, number> = new Map();
  private stageDurations: Map<StageName, number> = new Map();
  private abortControllers: Map<StageName, AbortController> = new Map();
  private abortCallbacks: Map<StageName, () => void> = new Map();
  private requestStartTime: number = 0;
  private requestId: string;
  private aborted: boolean = false;
  private globalAbortController: AbortController | null = null;

  constructor(requestId: string, config?: Partial<StageTimeoutConfig>, aggressive: boolean = false) {
    super();
    this.requestId = requestId;
    const baseConfig = aggressive ? AGGRESSIVE_TIMEOUTS : DEFAULT_TIMEOUTS;
    this.config = { ...baseConfig, ...config };
    this.setMaxListeners(50);
  }

  getConfig(): StageTimeoutConfig {
    return { ...this.config };
  }

  startRequest(): void {
    this.requestStartTime = Date.now();
    this.aborted = false;
    this.stageDurations.clear();
    this.stageStartTimes.clear();
    this.abortControllers.clear();
    this.abortCallbacks.clear();
    
    this.globalAbortController = new AbortController();
    
    const totalTimer = setTimeout(() => {
      if (!this.aborted) {
        this.handleTimeout("total");
      }
    }, this.config.total);
    this.stageTimers.set("total", totalTimer);

    this.emit("request_started", {
      requestId: this.requestId,
      timestamp: this.requestStartTime,
      timeoutConfig: this.config
    });
  }

  startStage(stage: StageName): void {
    if (this.aborted) return;

    const startTime = Date.now();
    this.stageStartTimes.set(stage, startTime);

    const controller = new AbortController();
    this.abortControllers.set(stage, controller);

    const timer = setTimeout(() => {
      if (!this.aborted && this.stageStartTimes.has(stage)) {
        this.handleTimeout(stage);
      }
    }, this.config[stage]);
    this.stageTimers.set(stage, timer);

    this.emit("stage_started", {
      requestId: this.requestId,
      stage,
      startTime,
      timeoutMs: this.config[stage]
    });
  }

  endStage(stage: StageName): number {
    const startTime = this.stageStartTimes.get(stage);
    const timer = this.stageTimers.get(stage);

    if (timer) {
      clearTimeout(timer);
      this.stageTimers.delete(stage);
    }

    this.abortControllers.delete(stage);
    this.abortCallbacks.delete(stage);

    const duration = startTime ? Date.now() - startTime : 0;
    this.stageDurations.set(stage, duration);
    this.stageStartTimes.delete(stage);

    this.emit("stage_completed", {
      requestId: this.requestId,
      stage,
      durationMs: duration,
      withinBudget: duration <= this.config[stage]
    });

    return duration;
  }

  getAbortSignal(stage: StageName): AbortSignal | null {
    const controller = this.abortControllers.get(stage);
    return controller?.signal ?? null;
  }

  getGlobalAbortSignal(): AbortSignal | null {
    return this.globalAbortController?.signal ?? null;
  }

  async executeWithTimeout<T>(
    stage: StageName,
    operation: () => Promise<T>,
    fallback?: () => T,
    options?: ExecuteWithAbortOptions
  ): Promise<StageResult<T>> {
    if (this.aborted) {
      return {
        success: false,
        error: new Error("Pipeline aborted"),
        durationMs: 0,
        timedOut: false,
        aborted: true,
        stage
      };
    }

    this.startStage(stage);
    const startTime = Date.now();

    if (options?.onAbort) {
      this.abortCallbacks.set(stage, options.onAbort);
    }

    const stageSignal = this.getAbortSignal(stage);
    if (options?.signal && stageSignal) {
      options.signal.addEventListener("abort", () => {
        const controller = this.abortControllers.get(stage);
        if (controller && !controller.signal.aborted) {
          controller.abort(options.signal?.reason);
        }
      }, { once: true });
    }

    try {
      const result = await Promise.race([
        operation(),
        this.createTimeoutPromise<T>(stage),
        this.createAbortPromise<T>(stage)
      ]);

      const duration = this.endStage(stage);

      return {
        success: true,
        data: result,
        durationMs: duration,
        timedOut: false,
        aborted: false,
        stage
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.endStage(stage);

      if (error instanceof StageAbortError) {
        this.emit("stage_aborted", {
          requestId: this.requestId,
          stage,
          elapsedMs: duration,
          reason: error.reason
        });

        if (fallback) {
          return {
            success: true,
            data: fallback(),
            durationMs: duration,
            timedOut: false,
            aborted: true,
            stage
          };
        }

        return {
          success: false,
          error,
          durationMs: duration,
          timedOut: false,
          aborted: true,
          stage
        };
      }

      if (error instanceof StageTimeoutError) {
        this.emit("stage_timeout", {
          requestId: this.requestId,
          stage,
          timeoutMs: this.config[stage],
          elapsedMs: duration
        });

        if (fallback) {
          return {
            success: true,
            data: fallback(),
            durationMs: duration,
            timedOut: true,
            aborted: false,
            stage
          };
        }

        return {
          success: false,
          error,
          durationMs: duration,
          timedOut: true,
          aborted: false,
          stage
        };
      }

      return {
        success: false,
        error: error as Error,
        durationMs: duration,
        timedOut: false,
        aborted: false,
        stage
      };
    }
  }

  async executeWithAbort<T>(
    stage: StageName,
    operation: AbortableOperation<T>
  ): Promise<StageResult<T>> {
    if (this.aborted) {
      return {
        success: false,
        error: new Error("Pipeline aborted"),
        durationMs: 0,
        timedOut: false,
        aborted: true,
        stage
      };
    }

    this.startStage(stage);
    const startTime = Date.now();

    const controller = this.abortControllers.get(stage)!;
    
    if (operation.onAbort) {
      this.abortCallbacks.set(stage, operation.onAbort);
    }

    const timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(new StageTimeoutError(stage, this.config[stage], Date.now() - startTime));
        
        const callback = this.abortCallbacks.get(stage);
        if (callback) {
          try {
            callback();
          } catch (e) {
            console.error(`[StageWatchdog] onAbort callback error for stage ${stage}:`, e);
          }
        }
      }
    }, this.config[stage]);

    try {
      const checkAbortedBeforeExecution = () => {
        if (controller.signal.aborted) {
          throw new StageAbortError(stage, "Aborted before execution");
        }
      };
      
      checkAbortedBeforeExecution();

      const result = await operation.execute(controller.signal);

      clearTimeout(timeoutId);
      const duration = this.endStage(stage);

      return {
        success: true,
        data: result,
        durationMs: duration,
        timedOut: false,
        aborted: false,
        stage
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      this.endStage(stage);

      const isAborted = controller.signal.aborted;
      const isTimeout = error instanceof StageTimeoutError || 
        (isAborted && controller.signal.reason instanceof StageTimeoutError);

      if (isTimeout) {
        this.emit("stage_timeout", {
          requestId: this.requestId,
          stage,
          timeoutMs: this.config[stage],
          elapsedMs: duration
        });

        if (operation.fallback) {
          return {
            success: true,
            data: operation.fallback(),
            durationMs: duration,
            timedOut: true,
            aborted: false,
            stage
          };
        }

        return {
          success: false,
          error: error instanceof StageTimeoutError ? error : new StageTimeoutError(stage, this.config[stage], duration),
          durationMs: duration,
          timedOut: true,
          aborted: false,
          stage
        };
      }

      if (isAborted || error instanceof StageAbortError || (error as any)?.name === "AbortError") {
        this.emit("stage_aborted", {
          requestId: this.requestId,
          stage,
          elapsedMs: duration,
          reason: (error as Error).message
        });

        if (operation.fallback) {
          return {
            success: true,
            data: operation.fallback(),
            durationMs: duration,
            timedOut: false,
            aborted: true,
            stage
          };
        }

        return {
          success: false,
          error: error instanceof StageAbortError ? error : new StageAbortError(stage, (error as Error).message),
          durationMs: duration,
          timedOut: false,
          aborted: true,
          stage
        };
      }

      return {
        success: false,
        error: error as Error,
        durationMs: duration,
        timedOut: false,
        aborted: false,
        stage
      };
    }
  }

  private createTimeoutPromise<T>(stage: StageName): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        const elapsed = Date.now() - (this.stageStartTimes.get(stage) || Date.now());
        const error = new StageTimeoutError(stage, this.config[stage], elapsed);
        
        const controller = this.abortControllers.get(stage);
        if (controller && !controller.signal.aborted) {
          controller.abort(error);
          
          const callback = this.abortCallbacks.get(stage);
          if (callback) {
            try {
              callback();
            } catch (e) {
              console.error(`[StageWatchdog] onAbort callback error for stage ${stage}:`, e);
            }
          }
        }
        
        reject(error);
      }, this.config[stage]);
    });
  }

  private createAbortPromise<T>(stage: StageName): Promise<T> {
    return new Promise((_, reject) => {
      const controller = this.abortControllers.get(stage);
      if (!controller) return;

      if (controller.signal.aborted) {
        reject(new StageAbortError(stage, "Already aborted"));
        return;
      }

      controller.signal.addEventListener("abort", () => {
        if (controller.signal.reason instanceof StageTimeoutError) {
          return;
        }
        reject(new StageAbortError(stage, controller.signal.reason?.message || "Operation aborted"));
      }, { once: true });
    });
  }

  private handleTimeout(stage: StageName): void {
    const startTime = this.stageStartTimes.get(stage) || this.requestStartTime;
    const elapsed = Date.now() - startTime;

    const controller = this.abortControllers.get(stage);
    if (controller && !controller.signal.aborted) {
      controller.abort(new StageTimeoutError(stage, this.config[stage], elapsed));
      
      const callback = this.abortCallbacks.get(stage);
      if (callback) {
        try {
          callback();
        } catch (e) {
          console.error(`[StageWatchdog] onAbort callback error for stage ${stage}:`, e);
        }
      }
    }

    this.emit("timeout", {
      requestId: this.requestId,
      stage,
      timeoutMs: this.config[stage],
      elapsedMs: elapsed,
      isTotal: stage === "total"
    });

    if (stage === "total") {
      this.abortAllStages();
      this.abort();
    }
  }

  abortStage(stage: StageName, reason: string = "Manual abort"): void {
    const controller = this.abortControllers.get(stage);
    if (controller && !controller.signal.aborted) {
      controller.abort(new StageAbortError(stage, reason));
      
      const callback = this.abortCallbacks.get(stage);
      if (callback) {
        try {
          callback();
        } catch (e) {
          console.error(`[StageWatchdog] onAbort callback error for stage ${stage}:`, e);
        }
      }

      this.emit("stage_aborted", {
        requestId: this.requestId,
        stage,
        reason
      });
    }
  }

  abortAllStages(reason: string = "Pipeline abort"): void {
    for (const [stage, controller] of this.abortControllers) {
      if (!controller.signal.aborted) {
        controller.abort(new StageAbortError(stage, reason));
        
        const callback = this.abortCallbacks.get(stage);
        if (callback) {
          try {
            callback();
          } catch (e) {
            console.error(`[StageWatchdog] onAbort callback error for stage ${stage}:`, e);
          }
        }
      }
    }

    if (this.globalAbortController && !this.globalAbortController.signal.aborted) {
      this.globalAbortController.abort(reason);
    }

    this.emit("all_stages_aborted", {
      requestId: this.requestId,
      reason,
      abortedStages: Array.from(this.abortControllers.keys())
    });
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;

    this.abortAllStages("Pipeline aborted");

    for (const [stage, timer] of this.stageTimers) {
      clearTimeout(timer);
    }
    this.stageTimers.clear();

    this.emit("aborted", {
      requestId: this.requestId,
      totalElapsedMs: Date.now() - this.requestStartTime,
      completedStages: Array.from(this.stageDurations.keys())
    });
  }

  isAborted(): boolean {
    return this.aborted;
  }

  isStageAborted(stage: StageName): boolean {
    const controller = this.abortControllers.get(stage);
    return controller?.signal.aborted ?? false;
  }

  finishRequest(): PipelineLatency {
    const totalDuration = Date.now() - this.requestStartTime;

    const totalTimer = this.stageTimers.get("total");
    if (totalTimer) {
      clearTimeout(totalTimer);
      this.stageTimers.delete("total");
    }

    for (const [stage, timer] of this.stageTimers) {
      clearTimeout(timer);
    }
    this.stageTimers.clear();

    for (const [stage, controller] of this.abortControllers) {
      if (!controller.signal.aborted) {
        controller.abort("Request finished");
      }
    }
    this.abortControllers.clear();
    this.abortCallbacks.clear();

    if (this.globalAbortController && !this.globalAbortController.signal.aborted) {
      this.globalAbortController.abort("Request finished");
    }
    this.globalAbortController = null;

    const latency: PipelineLatency = {
      preprocess: this.stageDurations.get("preprocess") ?? null,
      nlu: this.stageDurations.get("nlu") ?? null,
      retrieval: this.stageDurations.get("retrieval") ?? null,
      rerank: this.stageDurations.get("rerank") ?? null,
      generation: this.stageDurations.get("generation") ?? null,
      postprocess: this.stageDurations.get("postprocess") ?? null,
      total: totalDuration
    };

    this.emit("request_completed", {
      requestId: this.requestId,
      latency,
      aborted: this.aborted
    });

    return latency;
  }

  getRemainingBudget(): number {
    const elapsed = Date.now() - this.requestStartTime;
    return Math.max(0, this.config.total - elapsed);
  }

  getElapsedTime(): number {
    return Date.now() - this.requestStartTime;
  }

  getStageDurations(): Record<StageName, number | null> {
    const result: Record<StageName, number | null> = {
      preprocess: null,
      nlu: null,
      retrieval: null,
      rerank: null,
      generation: null,
      postprocess: null,
      total: null
    };

    for (const [stage, duration] of this.stageDurations) {
      result[stage] = duration;
    }

    return result;
  }

  getActiveStages(): StageName[] {
    return Array.from(this.stageStartTimes.keys());
  }

  getAbortedStages(): StageName[] {
    const aborted: StageName[] = [];
    for (const [stage, controller] of this.abortControllers) {
      if (controller.signal.aborted) {
        aborted.push(stage);
      }
    }
    return aborted;
  }
}

export function createWatchdog(
  requestId: string,
  config?: Partial<StageTimeoutConfig>,
  aggressive: boolean = false
): StageWatchdog {
  return new StageWatchdog(requestId, config, aggressive);
}
