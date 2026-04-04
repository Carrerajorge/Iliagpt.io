import { randomUUID } from 'crypto';
import { Logger } from '../../lib/logger';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ProcedureStep {
  id: string;
  order: number;
  action: string;
  params: Record<string, unknown>;
  expectedOutput?: string;
  fallback?: string;
  timeoutMs: number; // default 30000
  retryCount: number; // default 0
}

export interface Procedure {
  id: string;
  agentId: string;
  name: string;
  description: string;
  steps: ProcedureStep[];
  triggers: string[]; // keywords/phrases that activate this procedure
  successRate: number; // 0-1
  executionCount: number;
  avgDurationMs: number;
  lastExecutedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  tags: string[];
  isActive: boolean;
}

export interface ExecutionRecord {
  id: string;
  procedureId: string;
  startedAt: Date;
  completedAt?: Date;
  success: boolean;
  durationMs: number;
  error?: string;
  stepsCompleted: number;
  context: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal sliding window tracker
// ---------------------------------------------------------------------------

interface SuccessWindow {
  // Circular buffer of booleans (true = success, false = failure)
  buffer: boolean[];
  head: number; // next write position
  size: number; // current filled size
}

const WINDOW_SIZE = 100;

function createWindow(): SuccessWindow {
  return { buffer: new Array<boolean>(WINDOW_SIZE).fill(false), head: 0, size: 0 };
}

function pushToWindow(window: SuccessWindow, success: boolean): void {
  window.buffer[window.head] = success;
  window.head = (window.head + 1) % WINDOW_SIZE;
  if (window.size < WINDOW_SIZE) window.size++;
}

function windowSuccessRate(window: SuccessWindow): number {
  if (window.size === 0) return 0;
  let successes = 0;
  for (let i = 0; i < window.size; i++) {
    if (window.buffer[i]) successes++;
  }
  return successes / window.size;
}

// ---------------------------------------------------------------------------
// Fuzzy matching helpers
// ---------------------------------------------------------------------------

/**
 * Returns a similarity score [0, 1] between a trigger string and a query.
 * Uses Jaccard similarity on word tokens.
 */
function triggerSimilarity(trigger: string, query: string): number {
  const t = new Set(tokenize(trigger));
  const q = new Set(tokenize(query));
  if (t.size === 0 || q.size === 0) return 0;

  let intersection = 0;
  for (const word of q) {
    if (t.has(word)) intersection++;
  }
  const union = t.size + q.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Returns true if the procedure matches the trigger query.
 * Checks name and all triggers with fuzzy similarity >= threshold.
 */
function procedureMatchesQuery(
  proc: Procedure,
  query: string,
  threshold = 0.2,
): boolean {
  if (proc.name.toLowerCase().includes(query.toLowerCase())) return true;
  for (const trigger of proc.triggers) {
    if (triggerSimilarity(trigger, query) >= threshold) return true;
    if (trigger.toLowerCase().includes(query.toLowerCase())) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// ProceduralMemory
// ---------------------------------------------------------------------------

export class ProceduralMemory {
  private readonly procedures: Map<string, Procedure> = new Map();
  private readonly executionHistory: Map<string, ExecutionRecord[]> = new Map();
  private readonly successWindows: Map<string, SuccessWindow> = new Map();
  // Running average of duration — updated on each execution
  private readonly durationAccumulators: Map<
    string,
    { total: number; count: number }
  > = new Map();

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------

  register(
    proc: Omit<
      Procedure,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'version'
      | 'successRate'
      | 'executionCount'
      | 'avgDurationMs'
    >,
  ): Procedure {
    const id = randomUUID();
    const now = new Date();

    // Ensure steps have defaults
    const steps: ProcedureStep[] = proc.steps.map((s) => ({
      timeoutMs: 30000,
      retryCount: 0,
      ...s,
      id: s.id || randomUUID(),
    }));

    const full: Procedure = {
      ...proc,
      id,
      steps,
      successRate: 0,
      executionCount: 0,
      avgDurationMs: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    this.procedures.set(id, full);
    this.successWindows.set(id, createWindow());
    this.durationAccumulators.set(id, { total: 0, count: 0 });
    this.executionHistory.set(id, []);

    Logger.info(
      `[ProceduralMemory] registered procedure id=${id} name="${proc.name}" triggers=${proc.triggers.length}`,
    );
    return { ...full };
  }

  // -------------------------------------------------------------------------
  // recall — fuzzy match on triggers and name
  // -------------------------------------------------------------------------

  recall(trigger: string): Procedure[] {
    const results: Procedure[] = [];
    for (const proc of this.procedures.values()) {
      if (!proc.isActive) continue;
      if (procedureMatchesQuery(proc, trigger)) {
        results.push({ ...proc });
      }
    }
    // Sort by successRate descending, then executionCount descending
    results.sort((a, b) => {
      const diff = b.successRate - a.successRate;
      return diff !== 0 ? diff : b.executionCount - a.executionCount;
    });
    Logger.debug(
      `[ProceduralMemory] recall trigger="${trigger}" matched=${results.length}`,
    );
    return results;
  }

  // -------------------------------------------------------------------------
  // getBestProcedure
  // -------------------------------------------------------------------------

  getBestProcedure(trigger: string): Procedure | undefined {
    const matches = this.recall(trigger);
    return matches.length > 0 ? matches[0] : undefined;
  }

  // -------------------------------------------------------------------------
  // recordExecution
  // -------------------------------------------------------------------------

  recordExecution(record: Omit<ExecutionRecord, 'id'>): void {
    const proc = this.procedures.get(record.procedureId);
    if (!proc) {
      Logger.warn(
        `[ProceduralMemory] recordExecution: procedure not found id=${record.procedureId}`,
      );
      return;
    }

    const id = randomUUID();
    const full: ExecutionRecord = { ...record, id };

    // Push to history (keep last 500 per procedure)
    const history = this.executionHistory.get(record.procedureId) ?? [];
    history.push(full);
    if (history.length > 500) history.shift();
    this.executionHistory.set(record.procedureId, history);

    // Update sliding success window
    const window = this.successWindows.get(record.procedureId) ?? createWindow();
    pushToWindow(window, record.success);
    this.successWindows.set(record.procedureId, window);

    // Update duration accumulator (rolling average)
    const acc = this.durationAccumulators.get(record.procedureId) ?? {
      total: 0,
      count: 0,
    };
    acc.total += record.durationMs;
    acc.count++;
    this.durationAccumulators.set(record.procedureId, acc);

    // Update procedure record
    proc.executionCount++;
    proc.successRate = windowSuccessRate(window);
    proc.avgDurationMs =
      acc.count > 0 ? Math.round(acc.total / acc.count) : 0;
    proc.lastExecutedAt = record.startedAt;
    proc.updatedAt = new Date();
    this.procedures.set(proc.id, proc);

    Logger.debug(
      `[ProceduralMemory] recordExecution id=${id} procedureId=${record.procedureId} success=${record.success} successRate=${proc.successRate.toFixed(3)}`,
    );
  }

  // -------------------------------------------------------------------------
  // refineProcedure
  // -------------------------------------------------------------------------

  refineProcedure(
    id: string,
    updates: Partial<Pick<Procedure, 'steps' | 'description' | 'triggers'>>,
  ): Procedure {
    const proc = this.procedures.get(id);
    if (!proc) {
      throw new Error(`[ProceduralMemory] refineProcedure: procedure not found id=${id}`);
    }

    const refined: Procedure = {
      ...proc,
      ...updates,
      id, // guard
      version: proc.version + 1,
      updatedAt: new Date(),
    };

    // Reset success tracking window for new version
    this.successWindows.set(id, createWindow());
    this.durationAccumulators.set(id, { total: 0, count: 0 });

    this.procedures.set(id, refined);
    Logger.info(
      `[ProceduralMemory] refined procedure id=${id} version=${refined.version}`,
    );
    return { ...refined };
  }

  // -------------------------------------------------------------------------
  // deprecate
  // -------------------------------------------------------------------------

  deprecate(id: string): void {
    const proc = this.procedures.get(id);
    if (!proc) {
      Logger.warn(`[ProceduralMemory] deprecate: procedure not found id=${id}`);
      return;
    }
    proc.isActive = false;
    proc.updatedAt = new Date();
    this.procedures.set(id, proc);
    Logger.info(`[ProceduralMemory] deprecated procedure id=${id} name="${proc.name}"`);
  }

  // -------------------------------------------------------------------------
  // getProcedure
  // -------------------------------------------------------------------------

  getProcedure(id: string): Procedure | undefined {
    const p = this.procedures.get(id);
    return p ? { ...p } : undefined;
  }

  // -------------------------------------------------------------------------
  // listProcedures
  // -------------------------------------------------------------------------

  listProcedures(filter?: {
    tags?: string[];
    minSuccessRate?: number;
    isActive?: boolean;
  }): Procedure[] {
    const results: Procedure[] = [];
    for (const proc of this.procedures.values()) {
      if (filter?.isActive !== undefined && proc.isActive !== filter.isActive) {
        continue;
      }
      if (
        filter?.minSuccessRate !== undefined &&
        proc.successRate < filter.minSuccessRate
      ) {
        continue;
      }
      if (filter?.tags && filter.tags.length > 0) {
        const hasAll = filter.tags.every((t) => proc.tags.includes(t));
        if (!hasAll) continue;
      }
      results.push({ ...proc });
    }
    results.sort((a, b) => b.successRate - a.successRate);
    return results;
  }

  // -------------------------------------------------------------------------
  // getExecutionHistory
  // -------------------------------------------------------------------------

  getExecutionHistory(
    procedureId: string,
    limit = 50,
  ): ExecutionRecord[] {
    const history = this.executionHistory.get(procedureId) ?? [];
    return [...history].reverse().slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  getStats(): {
    total: number;
    active: number;
    avgSuccessRate: number;
    totalExecutions: number;
  } {
    const all = [...this.procedures.values()];
    const active = all.filter((p) => p.isActive);
    const totalExecutions = all.reduce((s, p) => s + p.executionCount, 0);
    const avgSuccessRate =
      active.length > 0
        ? active.reduce((s, p) => s + p.successRate, 0) / active.length
        : 0;

    return {
      total: all.length,
      active: active.length,
      avgSuccessRate: parseFloat(avgSuccessRate.toFixed(4)),
      totalExecutions,
    };
  }

  // -------------------------------------------------------------------------
  // Serialization helpers for MemoryManager
  // -------------------------------------------------------------------------

  getRawProcedures(): Map<string, Procedure> {
    return new Map(this.procedures);
  }

  getRawExecutionHistory(): Map<string, ExecutionRecord[]> {
    return new Map(this.executionHistory);
  }

  loadProcedure(proc: Procedure): void {
    this.procedures.set(proc.id, proc);
    if (!this.successWindows.has(proc.id)) {
      this.successWindows.set(proc.id, createWindow());
    }
    if (!this.durationAccumulators.has(proc.id)) {
      this.durationAccumulators.set(proc.id, { total: 0, count: 0 });
    }
    if (!this.executionHistory.has(proc.id)) {
      this.executionHistory.set(proc.id, []);
    }
  }

  loadExecutionRecord(record: ExecutionRecord): void {
    const history = this.executionHistory.get(record.procedureId) ?? [];
    history.push(record);
    this.executionHistory.set(record.procedureId, history);

    const window = this.successWindows.get(record.procedureId);
    if (window) pushToWindow(window, record.success);
  }
}
