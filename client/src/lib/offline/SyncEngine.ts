/**
 * SyncEngine.ts
 * CRDT-based sync engine using vector clocks for conflict resolution.
 * Manages a priority queue of pending operations and processes them
 * in batches when connectivity is restored.
 */

import { idb, SyncQueueRecord, StoreName, StoreRecordMap } from './IndexedDBStore';
import offlineManager, { OfflineManagerEvent } from './OfflineManager';

// ---------------------------------------------------------------------------
// Vector Clock (CRDT primitive)
// ---------------------------------------------------------------------------

/** Node ID → logical timestamp. */
export type VectorClock = Record<string, number>;

/** Merge two vector clocks by taking the max of each component. */
export function mergeClocks(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [nodeId, ts] of Object.entries(b)) {
    result[nodeId] = Math.max(result[nodeId] ?? 0, ts);
  }
  return result;
}

/** Increment the local node's clock. */
export function tickClock(clock: VectorClock, nodeId: string): VectorClock {
  return { ...clock, [nodeId]: (clock[nodeId] ?? 0) + 1 };
}

/**
 * Determine causal ordering of two vector clocks.
 * Returns: 'before' | 'after' | 'concurrent' | 'equal'
 */
export function compareClock(
  a: VectorClock,
  b: VectorClock
): 'before' | 'after' | 'concurrent' | 'equal' {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aLess = false;
  let bLess = false;

  for (const key of allKeys) {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    if (av < bv) aLess = true;
    if (bv < av) bLess = true;
  }

  if (!aLess && !bLess) return 'equal';
  if (aLess && !bLess) return 'before';
  if (!aLess && bLess) return 'after';
  return 'concurrent';
}

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

const PRIORITY_ORDER: Record<Priority, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

export interface SyncOperation {
  id: string;
  operation: 'create' | 'update' | 'delete';
  storeName: StoreName;
  recordId: string;
  payload: unknown;
  priority: Priority;
  vectorClock: VectorClock;
  nodeId: string;
  enqueuedAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

export interface SyncProgress {
  phase: 'idle' | 'starting' | 'syncing' | 'resolving' | 'complete' | 'failed';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  /** 0–100 */
  percent: number;
  startedAt: number | null;
  completedAt: number | null;
  errors: Array<{ operationId: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Sync result
// ---------------------------------------------------------------------------

export interface SyncResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
  conflicts: Array<{ id: string; resolution: 'local' | 'remote' }>;
  duration: number;
}

// ---------------------------------------------------------------------------
// Remote API adapter interface
// The host application must provide this.
// ---------------------------------------------------------------------------

export interface RemoteAdapter {
  /**
   * Apply a batch of operations to the remote server.
   * Returns per-operation results.
   */
  applyBatch(operations: SyncOperation[]): Promise<
    Array<{
      id: string;
      success: boolean;
      remoteClock?: VectorClock;
      remotePayload?: unknown;
      error?: string;
    }>
  >;

  /**
   * Fetch the server's current version of a record for conflict checking.
   */
  fetchRemote(
    storeName: StoreName,
    recordId: string
  ): Promise<{ payload: unknown; clock: VectorClock } | null>;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type SyncEngineEvent =
  | 'syncStart'
  | 'syncProgress'
  | 'syncComplete'
  | 'syncFailed'
  | 'conflict'
  | 'operationRetry';

export type SyncEventListener<T = unknown> = (payload: T) => void;

// ---------------------------------------------------------------------------
// SyncEngine
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1_000, 3_000, 10_000];

export class SyncEngine {
  private _nodeId: string;
  private _adapter: RemoteAdapter | null = null;
  private _batchSize: number;
  private _maxRetries: number;
  private _isSyncing = false;
  private _vectorClock: VectorClock = {};

  private _progress: SyncProgress = this._emptyProgress();
  private _listeners: Map<SyncEngineEvent, Set<SyncEventListener<unknown>>> = new Map();

  private _unsubscribeOnline: (() => void) | null = null;

  constructor(options: {
    nodeId: string;
    batchSize?: number;
    maxRetries?: number;
  }) {
    this._nodeId = options.nodeId;
    this._batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this._maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  // -- Lifecycle ------------------------------------------------------------

  /** Attach a remote adapter and start listening for online events. */
  start(adapter: RemoteAdapter): void {
    this._adapter = adapter;

    this._unsubscribeOnline = offlineManager.on<{ current: string }>(
      'statusChange' as OfflineManagerEvent,
      (payload) => {
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'current' in payload &&
          (payload as { current: string }).current !== 'offline'
        ) {
          void this.sync();
        }
      }
    );
  }

  stop(): void {
    this._unsubscribeOnline?.();
    this._unsubscribeOnline = null;
    this._adapter = null;
  }

  // -- Enqueue operations ---------------------------------------------------

  /**
   * Enqueue a new sync operation. The vector clock is ticked before persisting.
   */
  async enqueue(
    operation: Omit<SyncOperation, 'id' | 'vectorClock' | 'nodeId' | 'enqueuedAt' | 'attempts' | 'lastAttemptAt' | 'error'>
  ): Promise<string> {
    this._vectorClock = tickClock(this._vectorClock, this._nodeId);

    const op: SyncOperation = {
      ...operation,
      id: this._generateId(),
      nodeId: this._nodeId,
      vectorClock: { ...this._vectorClock },
      enqueuedAt: Date.now(),
      attempts: 0,
      lastAttemptAt: null,
      error: null,
    };

    await idb.put('sync_queue', this._toRecord(op));
    return op.id;
  }

  // -- Sync -----------------------------------------------------------------

  /** Run a full sync cycle. Idempotent — concurrent calls are coalesced. */
  async sync(): Promise<SyncResult> {
    if (this._isSyncing) {
      return { succeeded: [], failed: [], conflicts: [], duration: 0 };
    }
    if (!this._adapter) {
      throw new Error('[SyncEngine] No adapter attached — call start() first.');
    }

    this._isSyncing = true;
    const startedAt = Date.now();
    this._progress = {
      ...this._emptyProgress(),
      phase: 'starting',
      startedAt,
    };
    this._emit('syncStart', { ...this._progress });

    const result: SyncResult = {
      succeeded: [],
      failed: [],
      conflicts: [],
      duration: 0,
    };

    try {
      const pending = await this._loadPendingOperations();
      this._progress.total = pending.length;
      this._progress.phase = 'syncing';

      const batches = this._chunk(pending, this._batchSize);

      for (const batch of batches) {
        await this._processBatch(batch, result);
        this._emitProgress();
      }

      this._progress.phase = 'complete';
      this._progress.completedAt = Date.now();
      result.duration = this._progress.completedAt - startedAt;
      this._emit('syncComplete', { result, progress: this._progress });
    } catch (err) {
      this._progress.phase = 'failed';
      this._progress.completedAt = Date.now();
      result.duration = this._progress.completedAt - startedAt;
      this._emit('syncFailed', { error: err, progress: this._progress });
    } finally {
      this._isSyncing = false;
    }

    return result;
  }

  // -- Batch processing -----------------------------------------------------

  private async _processBatch(
    operations: SyncOperation[],
    result: SyncResult
  ): Promise<void> {
    if (!this._adapter) return;

    const responses = await this._adapter.applyBatch(operations);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const res = responses[i];

      if (!res) {
        await this._markFailed(op, 'No response from server');
        result.failed.push({ id: op.id, error: 'No response from server' });
        this._progress.failed++;
        continue;
      }

      if (res.success) {
        // Merge the remote vector clock into our local clock.
        if (res.remoteClock) {
          this._vectorClock = mergeClocks(this._vectorClock, res.remoteClock);
        }

        await idb.delete('sync_queue', op.id);
        result.succeeded.push(op.id);
        this._progress.succeeded++;
      } else {
        // Check if this is a conflict that needs resolution.
        if (res.remotePayload !== undefined && res.remoteClock !== undefined) {
          const resolution = await this._resolveConflict(op, {
            payload: res.remotePayload,
            clock: res.remoteClock,
          });
          result.conflicts.push({ id: op.id, resolution });

          if (resolution === 'local') {
            // Retry with incremented clock.
            this._vectorClock = tickClock(this._vectorClock, this._nodeId);
            const retried = { ...op, vectorClock: { ...this._vectorClock } };
            await idb.put('sync_queue', this._toRecord(retried));
          } else {
            // Accept remote — remove from queue and update local store.
            await idb.delete('sync_queue', op.id);
            await this._applyRemoteVersion(op.storeName, res.remotePayload);
          }
          this._progress.processed++;
        } else {
          // Transient failure — schedule retry.
          const error = res.error ?? 'Unknown error';
          await this._scheduleRetry(op, error);

          if (op.attempts + 1 >= this._maxRetries) {
            result.failed.push({ id: op.id, error });
            this._progress.failed++;
          } else {
            this._emit('operationRetry', { operationId: op.id, attempt: op.attempts + 1, error });
          }
        }
      }

      this._progress.processed++;
    }
  }

  // -- Conflict resolution (LWW with vector clocks) -------------------------

  private async _resolveConflict(
    localOp: SyncOperation,
    remote: { payload: unknown; clock: VectorClock }
  ): Promise<'local' | 'remote'> {
    this._progress.phase = 'resolving';
    const order = compareClock(localOp.vectorClock, remote.clock);

    let resolution: 'local' | 'remote';

    if (order === 'after') {
      // Local is causally newer — keep local.
      resolution = 'local';
    } else if (order === 'before') {
      // Remote is causally newer — use remote.
      resolution = 'remote';
    } else {
      // Concurrent or equal — last-write-wins based on wall-clock enqueuedAt.
      // In a tie, prefer remote (server wins) for safety.
      const remoteWallClock = remote.clock['__server__'] ?? 0;
      resolution = localOp.enqueuedAt > remoteWallClock ? 'local' : 'remote';
    }

    this._emit('conflict', {
      operationId: localOp.id,
      resolution,
      localClock: localOp.vectorClock,
      remoteClock: remote.clock,
    });

    return resolution;
  }

  // -- Retry logic ----------------------------------------------------------

  private async _scheduleRetry(op: SyncOperation, error: string): Promise<void> {
    const updated: SyncOperation = {
      ...op,
      attempts: op.attempts + 1,
      lastAttemptAt: Date.now(),
      error,
    };
    await idb.put('sync_queue', this._toRecord(updated));
  }

  private async _markFailed(op: SyncOperation, error: string): Promise<void> {
    // Keep in queue with max attempts so it won't be retried automatically.
    const updated: SyncOperation = {
      ...op,
      attempts: this._maxRetries,
      lastAttemptAt: Date.now(),
      error,
    };
    await idb.put('sync_queue', this._toRecord(updated));
  }

  // -- Local store update after remote wins ---------------------------------

  private async _applyRemoteVersion(
    storeName: StoreName,
    payload: unknown
  ): Promise<void> {
    if (storeName === 'sync_queue') return; // Never overwrite the queue itself.
    // The payload must conform to the store's record type.
    try {
      await idb.put(storeName, payload as StoreRecordMap[typeof storeName]);
    } catch (err) {
      console.warn('[SyncEngine] Failed to apply remote version:', err);
    }
  }

  // -- Loading pending operations -------------------------------------------

  private async _loadPendingOperations(): Promise<SyncOperation[]> {
    const records = await idb.getAll('sync_queue');

    // Filter out operations that have exceeded max retries.
    const pending = records.filter((r) => r.attempts < this._maxRetries);

    // Sort by priority then by enqueuedAt (FIFO within same priority).
    pending.sort((a, b) => {
      const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.enqueuedAt - b.enqueuedAt;
    });

    return pending.map((r) => this._fromRecord(r));
  }

  // -- Progress helpers -----------------------------------------------------

  private _emptyProgress(): SyncProgress {
    return {
      phase: 'idle',
      total: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      percent: 0,
      startedAt: null,
      completedAt: null,
      errors: [],
    };
  }

  private _emitProgress(): void {
    if (this._progress.total > 0) {
      this._progress.percent = Math.round(
        (this._progress.processed / this._progress.total) * 100
      );
    }
    this._emit('syncProgress', { ...this._progress });
  }

  get progress(): Readonly<SyncProgress> {
    return { ...this._progress };
  }

  // -- EventEmitter ---------------------------------------------------------

  on<T = unknown>(event: SyncEngineEvent, listener: SyncEventListener<T>): () => void {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(listener as SyncEventListener<unknown>);
    return () => this.off(event, listener);
  }

  off<T = unknown>(event: SyncEngineEvent, listener: SyncEventListener<T>): void {
    this._listeners.get(event)?.delete(listener as SyncEventListener<unknown>);
  }

  private _emit<T>(event: SyncEngineEvent, payload: T): void {
    this._listeners.get(event)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[SyncEngine] Error in "${event}" listener:`, err);
      }
    });
  }

  // -- Conversion helpers ---------------------------------------------------

  private _toRecord(op: SyncOperation): SyncQueueRecord {
    return {
      id: op.id,
      operation: op.operation,
      storeName: op.storeName,
      recordId: op.recordId,
      payload: { _op: op, _clock: op.vectorClock } as unknown,
      priority: op.priority,
      enqueuedAt: op.enqueuedAt,
      attempts: op.attempts,
      lastAttemptAt: op.lastAttemptAt,
      error: op.error,
    };
  }

  private _fromRecord(r: SyncQueueRecord): SyncOperation {
    // The payload was stored as { _op, _clock } by _toRecord.
    const raw = r.payload as { _op?: SyncOperation; _clock?: VectorClock };
    if (raw?._op) return raw._op;

    // Fallback reconstruction.
    return {
      id: r.id,
      operation: r.operation,
      storeName: r.storeName,
      recordId: r.recordId,
      payload: r.payload,
      priority: r.priority,
      vectorClock: {},
      nodeId: this._nodeId,
      enqueuedAt: r.enqueuedAt,
      attempts: r.attempts,
      lastAttemptAt: r.lastAttemptAt,
      error: r.error,
    };
  }

  private _chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  private _generateId(): string {
    return `${this._nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

// ---------------------------------------------------------------------------
// Singleton export (consumers must call .start(adapter) before syncing)
// ---------------------------------------------------------------------------

export const syncEngine = new SyncEngine({
  nodeId: (() => {
    // Generate or retrieve a stable node ID from localStorage.
    const key = 'iliagpt_nodeId';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem(key, id);
    }
    return id;
  })(),
});

export default syncEngine;
