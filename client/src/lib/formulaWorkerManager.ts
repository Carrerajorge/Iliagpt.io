import type { FormulaTask, FormulaResult } from './formulaWorker';
import { SparseGrid } from './sparseGrid';
import { FormulaEngine } from './formulaEngine';

type TaskCallback = (result: FormulaResult) => void;

interface PendingTask {
  callback: TaskCallback;
  timestamp: number;
}

const TASK_TIMEOUT_MS = 30000;
const BATCH_DELAY_MS = 16; // ~60fps
const MAX_BATCH_SIZE = 100;

export class FormulaWorkerManager {
  private worker: Worker | null = null;
  private pendingTasks: Map<string, PendingTask> = new Map();
  private taskIdCounter = 0;
  private isWorkerReady = false;
  private pendingBatch: Array<{ row: number; col: number; formula: string; callback: TaskCallback }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private lastGridSync: number = 0;
  private currentGrid: SparseGrid | null = null;
  private useMainThread = false;

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(
        new URL('./formulaWorker.ts', import.meta.url),
        { type: 'module' }
      );
      
      this.worker.onmessage = (e: MessageEvent<FormulaResult>) => {
        this.handleWorkerMessage(e.data);
      };
      
      this.worker.onerror = (error) => {
        console.error('[FormulaWorkerManager] Worker error:', error);
        this.useMainThread = true;
        this.processPendingWithMainThread();
      };

      this.isWorkerReady = true;
    } catch (error) {
      console.warn('[FormulaWorkerManager] Failed to create worker, using main thread:', error);
      this.useMainThread = true;
    }
  }

  private handleWorkerMessage(result: FormulaResult): void {
    const pending = this.pendingTasks.get(result.id);
    if (pending) {
      pending.callback(result);
      this.pendingTasks.delete(result.id);
    }
  }

  private generateTaskId(): string {
    return `task_${++this.taskIdCounter}_${Date.now()}`;
  }

  syncGrid(grid: SparseGrid): void {
    this.currentGrid = grid;
    this.lastGridSync = Date.now();
    
    if (this.worker && this.isWorkerReady && !this.useMainThread) {
      const gridData = grid.toJSON();
      this.worker.postMessage({
        id: this.generateTaskId(),
        type: 'evaluate',
        formula: '=1+1',
        gridData,
      } as FormulaTask);
    }
  }

  evaluateFormula(formula: string, callback: TaskCallback): void {
    if (this.useMainThread) {
      setTimeout(() => {
        callback({ id: '', type: 'result', value: this.evaluateOnMainThread(formula) });
      }, 0);
      return;
    }

    const taskId = this.generateTaskId();
    this.pendingTasks.set(taskId, { callback, timestamp: Date.now() });
    
    const task: FormulaTask = {
      id: taskId,
      type: 'evaluate',
      formula,
    };
    
    this.worker?.postMessage(task);
  }

  evaluateBatch(
    formulas: Array<{ row: number; col: number; formula: string }>,
    callback: (results: Array<{ row: number; col: number; value: string }>) => void
  ): void {
    if (this.useMainThread) {
      const results = formulas.map(f => ({
        row: f.row,
        col: f.col,
        value: this.evaluateOnMainThread(f.formula),
      }));
      setTimeout(() => callback(results), 0);
      return;
    }

    const taskId = this.generateTaskId();
    this.pendingTasks.set(taskId, {
      callback: (result) => {
        if (result.type === 'batchResult' && result.results) {
          callback(result.results);
        }
      },
      timestamp: Date.now(),
    });
    
    const task: FormulaTask = {
      id: taskId,
      type: 'evaluateBatch',
      formulas,
    };
    
    this.worker?.postMessage(task);
  }

  queueFormulaEvaluation(
    row: number,
    col: number,
    formula: string,
    callback: TaskCallback
  ): void {
    this.pendingBatch.push({ row, col, formula, callback });
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    
    if (this.pendingBatch.length >= MAX_BATCH_SIZE) {
      this.flushBatch();
    } else {
      this.batchTimer = setTimeout(() => this.flushBatch(), BATCH_DELAY_MS);
    }
  }

  private flushBatch(): void {
    if (this.pendingBatch.length === 0) return;
    
    const batch = [...this.pendingBatch];
    this.pendingBatch = [];
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.useMainThread) {
      for (const item of batch) {
        const value = this.evaluateOnMainThread(item.formula);
        item.callback({ id: '', type: 'result', value });
      }
      return;
    }

    this.evaluateBatch(
      batch.map(b => ({ row: b.row, col: b.col, formula: b.formula })),
      (results) => {
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const item = batch.find(b => b.row === result.row && b.col === result.col);
          if (item) {
            item.callback({ id: '', type: 'result', value: result.value });
          }
        }
      }
    );
  }

  private mainThreadEngine: FormulaEngine | null = null;

  private evaluateOnMainThread(formula: string): string {
    if (!this.currentGrid) return '#ERROR!';
    
    if (!this.mainThreadEngine) {
      this.mainThreadEngine = new FormulaEngine(this.currentGrid);
    } else {
      this.mainThreadEngine.setGrid(this.currentGrid);
    }
    
    try {
      return this.mainThreadEngine.evaluate(formula);
    } catch {
      return '#ERROR!';
    }
  }

  private processPendingWithMainThread(): void {
    Array.from(this.pendingTasks.entries()).forEach(([taskId, pending]) => {
      pending.callback({ id: taskId, type: 'error', error: 'Worker failed, processed on main thread' });
    });
    this.pendingTasks.clear();
  }

  cleanupStaleRequests(): void {
    const now = Date.now();
    Array.from(this.pendingTasks.entries()).forEach(([taskId, pending]) => {
      if (now - pending.timestamp > TASK_TIMEOUT_MS) {
        pending.callback({ id: taskId, type: 'error', error: 'Request timeout' });
        this.pendingTasks.delete(taskId);
      }
    });
  }

  terminate(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.worker?.terminate();
    this.worker = null;
    this.pendingTasks.clear();
    this.pendingBatch = [];
  }

  get isUsingMainThread(): boolean {
    return this.useMainThread;
  }

  get pendingCount(): number {
    return this.pendingTasks.size + this.pendingBatch.length;
  }
}

let sharedManager: FormulaWorkerManager | null = null;

export function getFormulaWorkerManager(): FormulaWorkerManager {
  if (!sharedManager) {
    sharedManager = new FormulaWorkerManager();
    setInterval(() => sharedManager?.cleanupStaleRequests(), 10000);
  }
  return sharedManager;
}
