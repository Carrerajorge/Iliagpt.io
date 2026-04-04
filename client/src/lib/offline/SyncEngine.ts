/**
 * SyncEngine.ts
 *
 * Offline→Online synchronization engine for IliaGPT.
 *
 * Responsibilities:
 *  - Maintain a priority queue of pending sync items (HIGH / MEDIUM / LOW)
 *  - Process the queue when OfflineManager reports ONLINE status
 *  - Resolve write conflicts with a CRDT-inspired last-write-wins strategy
 *    augmented by per-node vector clocks
 *  - Retry with exponential backoff + jitter (1 s base, 32 s cap)
 *  - Emit granular progress events via EventTarget
 *  - Persist the queue in IndexedDB (syncQueue store) for durability across reloads
 */

import { OfflineManager, NetworkStatus, type OfflineStateChangeEvent } from './OfflineManager';
import { syncQueueStore, type SyncQueueRecord } from './IndexedDBStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum SyncPriority {
  HIGH = 0,
  MEDIUM = 1,
  LOW = 2,
}

const PRIORITY_LABELS: Record<SyncPriority, SyncQueueRecord['priority']> = {
  [SyncPriority.HIGH]: 'HIGH',
  [SyncPriority.MEDIUM]: 'MEDIUM',
  [SyncPriority.LOW]: 'LOW',
};

export type VectorClock = Record<string, number>;

export interface SyncItem {
  /** Unique item ID (UUID) */
  id: string;
  /** Entity type: 'chat' | 'message' | 'draft' | 'preference' */
  type: string;
  operation: 'create' | 'update' | 'delete';
  payload: unknown;
  vectorClock: VectorClock;
  priority: SyncPriority;
  retries: number;
  createdAt: number;
  /** Earliest time this item may be retried (epoch ms) */
  nextRetryAt: number;
}

export interface SyncStatus {
  pending: number;
  processing: number;
  failed: number;
  done: number;
  lastSyncAt: number | null;
  isRunning: boolean;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type SyncEventType =
  | 'sync:started'
  | 'sync:item:processing'
  | 'sync:item:done'
  | 'sync:item:failed'
  | 'sync:item:conflict'
  | 'sync:queue:empty'
  | 'sync:error';

export interface SyncEvent {
  type: SyncEventType;
  itemId?: string;
  detail?: unknown;
}

export type SyncEventListener = (event: SyncEvent) => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 32_000;
const MAX_RETRIES = 6;
/** The node ID for this browser session – used in vector clocks */
const NODE_ID =
  typeof crypto !== 'undefined'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Priority queue (min-heap on [priority, createdAt])
// ---------------------------------------------------------------------------

class PriorityQueue<T extends { priority: SyncPriority; createdAt: number }> {
  private heap: T[] = [];

  get size(): number { return this.heap.length; }
  isEmpty(): boolean { return this.heap.length === 0; }

  enqueue(item: T): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  peek(): T | undefined { return this.heap[0]; }

  toArray(): T[] { return [...this.heap]; }

  remove(predicate: (item: T) => boolean): void {
    this.heap = this.heap.filter((i) => !predicate(i));
    // Rebuild heap
    for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i--) {
      this.sinkDown(i);
    }
  }

  private compare(a: T, b: T): boolean {
    // Lower priority enum value = higher importance
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.createdAt < b.createdAt;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.compare(this.heap[i], this.heap[parent])) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }

  private sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.compare(this.heap[left], this.heap[smallest])) smallest = left;
      if (right < n && this.compare(this.heap[right], this.heap[smallest])) smallest = right;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

// ---------------------------------------------------------------------------
// Vector clock helpers
// ---------------------------------------------------------------------------

/**
 * Increment this node's counter in the clock.
 */
function tickClock(clock: VectorClock): VectorClock {
  return { ...clock, [NODE_ID]: (clock[NODE_ID] ?? 0) + 1 };
}

/**
 * Merge two clocks by taking the max of each node's counter.
 */
function mergeClock(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [node, tick] of Object.entries(b)) {
    result[node] = Math.max(result[node] ?? 0, tick);
  }
  return result;
}

/**
 * Compare clocks:
 *  1 → a dominates b (a happened after b)
 * -1 → b dominates a
 *  0 → concurrent (conflict)
 */
function compareClock(a: VectorClock, b: VectorClock): 1 | -1 | 0 {
  const allNodes = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aAhead = false;
  let bAhead = false;

  for (const node of allNodes) {
    const av = a[node] ?? 0;
    const bv = b[node] ?? 0;
    if (av > bv) aAhead = true;
    if (bv > av) bAhead = true;
  }

  if (aAhead && !bAhead) return 1;
  if (bAhead && !aAhead) return -1;
  return 0;
}

// ---------------------------------------------------------------------------
// Exponential backoff helper
// ---------------------------------------------------------------------------

function backoffMs(retries: number): number {
  const base = BACKOFF_BASE_MS * Math.pow(2, retries);
  const capped = Math.min(base, BACKOFF_MAX_MS);
  // ±25% jitter
  const jitter = capped * 0.25 * (Math.random() * 2 - 1);
  return Math.round(capped + jitter);
}

// ---------------------------------------------------------------------------
// SyncEngine
// ---------------------------------------------------------------------------

export class SyncEngine {
  private static instance: SyncEngine | null = null;

  private readonly queue = new PriorityQueue<SyncItem>();
  private readonly failedItems = new Map<string, SyncItem>();
  private readonly listeners = new Set<SyncEventListener>();

  private isRunning = false;
  private lastSyncAt: number | null = null;
  private processingCount = 0;

  private unsubscribeOffline: (() => void) | null = null;

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  private constructor() {
    this.attachOfflineListener();
    // Restore persisted queue from IndexedDB on startup
    this.restoreFromDB().catch((err) =>
      console.error('[SyncEngine] Failed to restore queue:', err),
    );
  }

  static getInstance(): SyncEngine {
    if (!SyncEngine.instance) {
      SyncEngine.instance = new SyncEngine();
    }
    return SyncEngine.instance;
  }

  // ---------------------------------------------------------------------------
  // Event emitter
  // ---------------------------------------------------------------------------

  on(listener: SyncEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SyncEvent): void {
    this.listeners.forEach((cb) => {
      try { cb(event); } catch { /* isolate listener errors */ }
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Enqueue a sync item. Assigns a vector clock tick and persists to IndexedDB.
   */
  async enqueue(item: Omit<SyncItem, 'vectorClock' | 'retries' | 'nextRetryAt'>): Promise<SyncItem> {
    const full: SyncItem = {
      ...item,
      vectorClock: tickClock({}),
      retries: 0,
      nextRetryAt: 0,
    };

    this.queue.enqueue(full);
    await this.persistItem(full, 'pending');

    if (OfflineManager.getInstance().isOnline()) {
      this.processQueue().catch(console.error);
    }

    return full;
  }

  /**
   * Drain the queue, processing items in priority order.
   * Re-entrant calls are ignored while already running.
   */
  async processQueue(): Promise<void> {
    if (this.isRunning) return;
    if (this.queue.isEmpty()) return;

    this.isRunning = true;
    this.emit({ type: 'sync:started' });

    try {
      while (!this.queue.isEmpty()) {
        if (!OfflineManager.getInstance().isOnline()) break;

        const item = this.queue.peek();
        if (!item) break;

        // Respect backoff
        if (item.nextRetryAt > Date.now()) {
          await new Promise((r) => setTimeout(r, item.nextRetryAt - Date.now()));
        }

        this.queue.dequeue();
        await this.processItem(item);
      }
    } finally {
      this.isRunning = false;
      this.lastSyncAt = Date.now();

      if (this.queue.isEmpty()) {
        this.emit({ type: 'sync:queue:empty' });
      }
    }
  }

  getSyncStatus(): SyncStatus {
    return {
      pending: this.queue.size,
      processing: this.processingCount,
      failed: this.failedItems.size,
      done: 0, // tracked externally if needed
      lastSyncAt: this.lastSyncAt,
      isRunning: this.isRunning,
    };
  }

  getFailedItems(): SyncItem[] {
    return Array.from(this.failedItems.values());
  }

  /**
   * Re-enqueue all failed items for retry.
   */
  async retryFailed(): Promise<void> {
    for (const item of this.failedItems.values()) {
      const reset: SyncItem = { ...item, retries: 0, nextRetryAt: 0 };
      this.queue.enqueue(reset);
      this.failedItems.delete(item.id);
      await this.persistItem(reset, 'pending');
    }

    if (OfflineManager.getInstance().isOnline()) {
      this.processQueue().catch(console.error);
    }
  }

  // ---------------------------------------------------------------------------
  // Conflict resolution (CRDT-inspired LWW with vector clocks)
  // ---------------------------------------------------------------------------

  /**
   * Given a local item and a remote item for the same entity,
   * return the winner and whether a conflict occurred.
   */
  resolveConflict(
    local: SyncItem,
    remote: SyncItem,
  ): { winner: SyncItem; conflict: boolean } {
    const cmp = compareClock(local.vectorClock, remote.vectorClock);

    if (cmp === 1) {
      // Local is strictly newer – keep local
      return { winner: local, conflict: false };
    }

    if (cmp === -1) {
      // Remote is strictly newer – accept remote
      return { winner: remote, conflict: false };
    }

    // Concurrent writes: true conflict – fall back to wall-clock LWW
    const conflict = true;
    const winner = local.createdAt >= remote.createdAt ? local : remote;
    const merged: SyncItem = {
      ...winner,
      vectorClock: mergeClock(local.vectorClock, remote.vectorClock),
    };

    this.emit({ type: 'sync:item:conflict', itemId: local.id, detail: { local, remote, winner: merged } });
    return { winner: merged, conflict };
  }

  // ---------------------------------------------------------------------------
  // Item processing
  // ---------------------------------------------------------------------------

  private async processItem(item: SyncItem): Promise<void> {
    this.processingCount++;
    this.emit({ type: 'sync:item:processing', itemId: item.id });
    await this.persistItem(item, 'processing');

    try {
      await this.sendToServer(item);

      this.processingCount--;
      await this.persistItem(item, 'done');
      this.emit({ type: 'sync:item:done', itemId: item.id });
    } catch (err) {
      this.processingCount--;
      await this.handleItemError(item, err);
    }
  }

  private async sendToServer(item: SyncItem): Promise<void> {
    const endpoint = this.resolveEndpoint(item);
    const method = this.resolveMethod(item);

    const response = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Item-Id': item.id,
        'X-Vector-Clock': JSON.stringify(item.vectorClock),
      },
      body: method !== 'DELETE' ? JSON.stringify(item.payload) : undefined,
    });

    if (response.status === 409) {
      // Server signals conflict – fetch the server version and resolve
      const serverPayload = (await response.json()) as { item: SyncItem };
      const { winner } = this.resolveConflict(item, serverPayload.item);
      if (winner.id !== item.id) {
        // Remote wins – no re-send needed
        return;
      }
      // Local wins – retry once with updated clock
      const retried: SyncItem = {
        ...winner,
        vectorClock: tickClock(winner.vectorClock),
      };
      await this.sendToServer(retried);
      return;
    }

    if (!response.ok) {
      throw new Error(`Server responded ${response.status}: ${response.statusText}`);
    }
  }

  private resolveEndpoint(item: SyncItem): string {
    const base = '/api';
    switch (item.type) {
      case 'chat': return `${base}/chats${item.operation !== 'create' ? `/${(item.payload as { id?: string })?.id ?? ''}` : ''}`;
      case 'message': return `${base}/messages${item.operation !== 'create' ? `/${(item.payload as { id?: string })?.id ?? ''}` : ''}`;
      case 'draft': return `${base}/drafts${item.operation !== 'create' ? `/${(item.payload as { id?: string })?.id ?? ''}` : ''}`;
      case 'preference': return `${base}/preferences`;
      default: return `${base}/sync`;
    }
  }

  private resolveMethod(item: SyncItem): string {
    switch (item.operation) {
      case 'create': return 'POST';
      case 'update': return 'PATCH';
      case 'delete': return 'DELETE';
    }
  }

  private async handleItemError(item: SyncItem, err: unknown): Promise<void> {
    const retries = item.retries + 1;
    const errMessage = err instanceof Error ? err.message : String(err);

    this.emit({ type: 'sync:item:failed', itemId: item.id, detail: { error: errMessage, retries } });

    if (retries >= MAX_RETRIES) {
      const failed: SyncItem = { ...item, retries };
      this.failedItems.set(item.id, failed);
      await this.persistItem(failed, 'failed');
      console.error(`[SyncEngine] Item ${item.id} permanently failed after ${retries} retries.`);
      return;
    }

    // Re-enqueue with backoff
    const next: SyncItem = {
      ...item,
      retries,
      nextRetryAt: Date.now() + backoffMs(retries),
    };

    this.queue.enqueue(next);
    await this.persistItem(next, 'pending');
  }

  // ---------------------------------------------------------------------------
  // OfflineManager integration
  // ---------------------------------------------------------------------------

  private attachOfflineListener(): void {
    const mgr = OfflineManager.getInstance();
    this.unsubscribeOffline = mgr.subscribe(this.handleNetworkChange);
  }

  private readonly handleNetworkChange = (event: OfflineStateChangeEvent): void => {
    if (event.status === NetworkStatus.ONLINE) {
      this.processQueue().catch(console.error);
    }
  };

  // ---------------------------------------------------------------------------
  // IndexedDB persistence
  // ---------------------------------------------------------------------------

  private async persistItem(
    item: SyncItem,
    status: SyncQueueRecord['status'],
  ): Promise<void> {
    try {
      const record: SyncQueueRecord = {
        id: item.id,
        type: item.type,
        operation: item.operation,
        payload: item.payload,
        vectorClock: item.vectorClock,
        priority: PRIORITY_LABELS[item.priority],
        retries: item.retries,
        status,
        nextRetryAt: item.nextRetryAt,
        createdAt: item.createdAt,
        updatedAt: Date.now(),
      };
      await syncQueueStore.put(record);
    } catch (err) {
      console.warn('[SyncEngine] Failed to persist item to IndexedDB:', err);
    }
  }

  private async restoreFromDB(): Promise<void> {
    try {
      const records = await syncQueueStore.query('by_status', IDBKeyRange.only('pending'));
      for (const record of records) {
        const item: SyncItem = {
          id: record.id,
          type: record.type,
          operation: record.operation,
          payload: record.payload,
          vectorClock: record.vectorClock,
          priority: this.parsePriority(record.priority),
          retries: record.retries,
          createdAt: record.createdAt,
          nextRetryAt: record.nextRetryAt,
        };
        this.queue.enqueue(item);
      }

      const failedRecords = await syncQueueStore.query('by_status', IDBKeyRange.only('failed'));
      for (const record of failedRecords) {
        this.failedItems.set(record.id, {
          id: record.id,
          type: record.type,
          operation: record.operation,
          payload: record.payload,
          vectorClock: record.vectorClock,
          priority: this.parsePriority(record.priority),
          retries: record.retries,
          createdAt: record.createdAt,
          nextRetryAt: record.nextRetryAt,
        });
      }
    } catch (err) {
      console.warn('[SyncEngine] Could not restore queue from IndexedDB:', err);
    }
  }

  private parsePriority(label: SyncQueueRecord['priority']): SyncPriority {
    switch (label) {
      case 'HIGH': return SyncPriority.HIGH;
      case 'MEDIUM': return SyncPriority.MEDIUM;
      default: return SyncPriority.LOW;
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    this.unsubscribeOffline?.();
    this.listeners.clear();
    SyncEngine.instance = null;
  }
}
