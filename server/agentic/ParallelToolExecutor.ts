/**
 * ParallelToolExecutor — Execute tool calls in parallel using a DAG-based
 * dependency graph. Independent tools run concurrently; dependent tools
 * wait for their predecessors.
 */

import { randomUUID } from "crypto";
import { Logger } from "../lib/logger";
import type { ToolContext, ToolResult } from "../agent/toolTypes";
import type { ToolCallRequest, ToolExecutor } from "./ClaudeAgentBackbone";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type ExecutionStatus = "pending" | "running" | "success" | "failed" | "cancelled" | "timeout";

export interface ToolNode {
  id: string; // corresponds to ToolCallRequest.id
  call: ToolCallRequest;
  dependsOn: string[]; // tool node ids that must complete first
  status: ExecutionStatus;
  result?: ToolResult;
  error?: Error;
  startedAt?: Date;
  completedAt?: Date;
  latencyMs?: number;
}

export interface ExecutionDAG {
  id: string;
  nodes: Map<string, ToolNode>;
  createdAt: Date;
}

export interface ParallelExecutionConfig {
  maxConcurrent?: number; // default 5
  toolTimeoutMs?: number; // per-tool timeout, default 30000
  totalTimeoutMs?: number; // overall execution timeout, default 120000
  onProgress?: (nodeId: string, status: ExecutionStatus) => void;
}

export interface ParallelExecutionResult {
  dagId: string;
  totalTools: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  results: Map<string, ToolResult | Error>;
  durationMs: number;
}

// ─── DAG utilities ──────────────────────────────────────────────────────────────

/** Build a DAG from tool calls with optional explicit dependencies.
 *  If no dependencies are specified, all calls run in parallel. */
function buildDAG(
  calls: ToolCallRequest[],
  dependencies?: Map<string, string[]> // callId → [dependsOnCallId]
): ExecutionDAG {
  const nodes = new Map<string, ToolNode>();

  for (const call of calls) {
    nodes.set(call.id, {
      id: call.id,
      call,
      dependsOn: dependencies?.get(call.id) ?? [],
      status: "pending",
    });
  }

  return { id: randomUUID(), nodes, createdAt: new Date() };
}

/** Topological sort using Kahn's algorithm. Returns execution levels. */
function topologicalLevels(dag: ExecutionDAG): string[][] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // nodeId → nodes that depend on it

  for (const [id] of dag.nodes) {
    inDegree.set(id, 0);
    dependents.set(id, []);
  }

  for (const [id, node] of dag.nodes) {
    inDegree.set(id, node.dependsOn.length);
    for (const dep of node.dependsOn) {
      const list = dependents.get(dep) ?? [];
      list.push(id);
      dependents.set(dep, list);
    }
  }

  const levels: string[][] = [];
  let queue = [...inDegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id);

  while (queue.length > 0) {
    levels.push([...queue]);
    const nextQueue: string[] = [];
    for (const id of queue) {
      for (const dependent of dependents.get(id) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 1) - 1);
        if (inDegree.get(dependent) === 0) nextQueue.push(dependent);
      }
    }
    queue = nextQueue;
  }

  return levels;
}

/** Check if the DAG has cycles (returns true if cyclic). */
function hasCycles(dag: ExecutionDAG): boolean {
  const visited = new Set<string>();
  const recStack = new Set<string>();

  const dfs = (id: string): boolean => {
    visited.add(id);
    recStack.add(id);
    const node = dag.nodes.get(id);
    for (const dep of node?.dependsOn ?? []) {
      if (!visited.has(dep) && dfs(dep)) return true;
      if (recStack.has(dep)) return true;
    }
    recStack.delete(id);
    return false;
  };

  for (const [id] of dag.nodes) {
    if (!visited.has(id) && dfs(id)) return true;
  }
  return false;
}

// ─── ParallelToolExecutor ───────────────────────────────────────────────────────
export class ParallelToolExecutor {
  private readonly maxConcurrent: number;
  private readonly toolTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly onProgress?: (nodeId: string, status: ExecutionStatus) => void;
  private activeCount = 0;

  constructor(config: ParallelExecutionConfig = {}) {
    this.maxConcurrent = config.maxConcurrent ?? 5;
    this.toolTimeoutMs = config.toolTimeoutMs ?? 30_000;
    this.totalTimeoutMs = config.totalTimeoutMs ?? 120_000;
    this.onProgress = config.onProgress;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Execute tool calls respecting dependencies.
   * Calls with no dependencies run in parallel up to maxConcurrent.
   */
  async execute(
    calls: ToolCallRequest[],
    executor: ToolExecutor,
    ctx: ToolContext,
    dependencies?: Map<string, string[]>
  ): Promise<ParallelExecutionResult> {
    const startMs = Date.now();

    if (calls.length === 0) {
      return {
        dagId: randomUUID(),
        totalTools: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        results: new Map(),
        durationMs: 0,
      };
    }

    const dag = buildDAG(calls, dependencies);

    if (hasCycles(dag)) {
      throw new Error("[ParallelToolExecutor] Dependency graph has cycles — cannot execute");
    }

    Logger.info("[ParallelToolExecutor] Starting parallel execution", {
      dagId: dag.id,
      toolCount: calls.length,
      maxConcurrent: this.maxConcurrent,
    });

    const levels = topologicalLevels(dag);
    const results = new Map<string, ToolResult | Error>();

    // Overall timeout
    let timedOut = false;
    const totalTimer = setTimeout(() => {
      timedOut = true;
      Logger.warn("[ParallelToolExecutor] Overall timeout reached", { dagId: dag.id });
    }, this.totalTimeoutMs);

    try {
      for (const level of levels) {
        if (timedOut) {
          // Cancel remaining
          for (const id of level) {
            const node = dag.nodes.get(id)!;
            node.status = "cancelled";
            results.set(id, new Error("Cancelled: overall timeout exceeded"));
            this.onProgress?.(id, "cancelled");
          }
          continue;
        }

        // Execute level in batches of maxConcurrent
        await this.executeLevelInBatches(level, dag, executor, ctx, results, () => timedOut);
      }
    } finally {
      clearTimeout(totalTimer);
    }

    let succeeded = 0;
    let failed = 0;
    let cancelled = 0;

    for (const [, node] of dag.nodes) {
      if (node.status === "success") succeeded++;
      else if (node.status === "failed") failed++;
      else if (node.status === "cancelled") cancelled++;
    }

    const durationMs = Date.now() - startMs;

    Logger.info("[ParallelToolExecutor] Execution complete", {
      dagId: dag.id,
      succeeded,
      failed,
      cancelled,
      durationMs,
    });

    return {
      dagId: dag.id,
      totalTools: calls.length,
      succeeded,
      failed,
      cancelled,
      results,
      durationMs,
    };
  }

  /**
   * Analyse a list of tool calls and infer dependencies based on tool names.
   * Heuristic: write tools depend on prior read tools of the same resource.
   */
  inferDependencies(calls: ToolCallRequest[]): Map<string, string[]> {
    const deps = new Map<string, string[]>();
    const writersOf = new Map<string, string[]>(); // resource key → writer ids

    for (const call of calls) {
      deps.set(call.id, []);
    }

    // Simple heuristic: tools with "write"/"create"/"delete" depend on prior reads of same resource
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const isWrite = /write|create|delete|update|save/i.test(call.name);
      const isRead = /read|fetch|search|list|get/i.test(call.name);
      const resourceKey = this.extractResourceKey(call);

      if (isRead) {
        // Mark resource as "recently read" — writes after this should depend on it
        const writers = writersOf.get(resourceKey) ?? [];
        writers.push(call.id);
        writersOf.set(resourceKey, writers);
      }

      if (isWrite && resourceKey) {
        // Depend on all prior reads of same resource
        const priorReads = writersOf.get(resourceKey) ?? [];
        const myDeps = deps.get(call.id)!;
        for (const rid of priorReads) {
          if (rid !== call.id && !myDeps.includes(rid)) {
            myDeps.push(rid);
          }
        }
      }
    }

    return deps;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async executeLevelInBatches(
    level: string[],
    dag: ExecutionDAG,
    executor: ToolExecutor,
    ctx: ToolContext,
    results: Map<string, ToolResult | Error>,
    isTimedOut: () => boolean
  ): Promise<void> {
    // Split level into batches of maxConcurrent
    for (let batchStart = 0; batchStart < level.length; batchStart += this.maxConcurrent) {
      if (isTimedOut()) break;

      const batch = level.slice(batchStart, batchStart + this.maxConcurrent);
      await Promise.allSettled(
        batch.map((id) => this.executeSingleNode(id, dag, executor, ctx, results))
      );
    }
  }

  private async executeSingleNode(
    id: string,
    dag: ExecutionDAG,
    executor: ToolExecutor,
    ctx: ToolContext,
    results: Map<string, ToolResult | Error>
  ): Promise<void> {
    const node = dag.nodes.get(id)!;

    // Check if any dependency failed — if so, cancel this node
    for (const depId of node.dependsOn) {
      const depNode = dag.nodes.get(depId);
      if (depNode && (depNode.status === "failed" || depNode.status === "cancelled")) {
        node.status = "cancelled";
        const err = new Error(`Cancelled: dependency "${depId}" failed`);
        results.set(id, err);
        this.onProgress?.(id, "cancelled");
        Logger.debug("[ParallelToolExecutor] Node cancelled due to failed dependency", { id, depId });
        return;
      }
    }

    node.status = "running";
    node.startedAt = new Date();
    this.onProgress?.(id, "running");

    try {
      const result = await this.withTimeout(
        executor.execute(node.call, ctx),
        this.toolTimeoutMs,
        `Tool "${node.call.name}" timed out after ${this.toolTimeoutMs}ms`
      );

      node.status = result.success ? "success" : "failed";
      node.result = result;
      results.set(id, result);
      this.onProgress?.(id, node.status);

      Logger.debug("[ParallelToolExecutor] Tool completed", {
        id,
        name: node.call.name,
        status: node.status,
        latencyMs: Date.now() - node.startedAt!.getTime(),
      });
    } catch (err: any) {
      node.status = "failed";
      node.error = err instanceof Error ? err : new Error(String(err));
      results.set(id, node.error);
      this.onProgress?.(id, "failed");

      Logger.error("[ParallelToolExecutor] Tool execution failed", {
        id,
        name: node.call.name,
        error: err?.message,
      });
    } finally {
      node.completedAt = new Date();
      node.latencyMs = node.completedAt.getTime() - (node.startedAt?.getTime() ?? 0);
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  private extractResourceKey(call: ToolCallRequest): string {
    // Try to extract a resource name from the tool input (file path, URL, etc.)
    const input = call.input;
    const candidates = [input.path, input.url, input.file, input.resource, input.key];
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 0) return c.toLowerCase();
    }
    return call.name;
  }
}
