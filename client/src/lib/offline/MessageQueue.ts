/**
 * MessageQueue.ts
 *
 * Durable message queue for IliaGPT offline mode.
 *
 * When the user sends a message while offline (or on a degraded connection)
 * the message is persisted in IndexedDB and retried automatically once
 * connectivity is restored.
 *
 * Features:
 *  - Full persistence via IndexedDB (syncQueue store)
 *  - Exponential backoff per item: 2s / 4s / 8s (max 3 retries)
 *  - Event callbacks: onDelivered, onFailed, onQueueEmpty
 *  - Integration with OfflineManager for automatic flush on reconnect
 *  - Processes one message at a time to preserve chat ordering
 */

import { OfflineManager, NetworkStatus, type OfflineStateChangeEvent } from './OfflineManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum QueueStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  FAILED = 'FAILED',
  DELIVERED = 'DELIVERED',
}

export interface AttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url?: string;
}

export interface MessageQueueItem {
  id: string;
  chatId: string;
  content: string;
  attachments: AttachmentMeta[];
  status: QueueStatus;
  createdAt: number;
  updatedAt: number;
  retries: number;
  nextRetryAt: number;
  /** Populated after delivery */
  serverMessageId?: string;
  error?: string;
}

export interface EnqueueOptions {
  chatId: string;
  content: string;
  attachments?: AttachmentMeta[];
}

export type DeliveredCallback = (item: MessageQueueItem, serverMessageId: string) => void;
export type FailedCallback = (item: MessageQueueItem, error: Error) => void;
export type QueueEmptyCallback = () => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'iliagpt-msg-queue';
const DB_VERSION = 1;
const STORE_NAME = 'message_queue';
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 2_000;
const API_ENDPOINT = '/api/messages';

// ---------------------------------------------------------------------------
// Minimal IndexedDB helpers (self-contained to avoid circular deps)
// ---------------------------------------------------------------------------

let _db: IDBDatabase | null = null;
let _dbOpenPromise: Promise<IDBDatabase> | null = null;

function openMsgDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (_dbOpenPromise) return _dbOpenPromise;

  _dbOpenPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => { _dbOpenPromise = null; reject(req.error); };
    req.onsuccess = () => {
      _db = req.result;
      _db.onclose = () => { _db = null; _dbOpenPromise = null; };
      _dbOpenPromise = null;
      resolve(_db);
    };

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_status', 'status', { unique: false });
        store.createIndex('by_chatId', 'chatId', { unique: false });
        store.createIndex('by_createdAt', 'createdAt', { unique: false });
      }
    };
  });

  return _dbOpenPromise;
}

function dbGet(id: string): Promise<MessageQueueItem | undefined> {
  return openMsgDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result as MessageQueueItem | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function dbPut(item: MessageQueueItem): Promise<void> {
  return openMsgDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function dbGetByStatus(status: QueueStatus): Promise<MessageQueueItem[]> {
  return openMsgDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db
          .transaction(STORE_NAME, 'readonly')
          .objectStore(STORE_NAME)
          .index('by_status')
          .getAll(IDBKeyRange.only(status));
        req.onsuccess = () => resolve(req.result as MessageQueueItem[]);
        req.onerror = () => reject(req.error);
      }),
  );
}

function dbGetAll(): Promise<MessageQueueItem[]> {
  return openMsgDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db
          .transaction(STORE_NAME, 'readonly')
          .objectStore(STORE_NAME)
          .getAll();
        req.onsuccess = () => resolve(req.result as MessageQueueItem[]);
        req.onerror = () => reject(req.error);
      }),
  );
}

// ---------------------------------------------------------------------------
// Backoff helper
// ---------------------------------------------------------------------------

function backoffMs(retries: number): number {
  const ms = BACKOFF_BASE_MS * Math.pow(2, retries);
  const jitter = ms * 0.2 * Math.random();
  return Math.round(ms + jitter);
}

// ---------------------------------------------------------------------------
// MessageQueue
// ---------------------------------------------------------------------------

export class MessageQueue {
  private static instance: MessageQueue | null = null;

  // Callbacks
  onDelivered: DeliveredCallback | null = null;
  onFailed: FailedCallback | null = null;
  onQueueEmpty: QueueEmptyCallback | null = null;

  private isProcessing = false;
  private unsubscribeOffline: (() => void) | null = null;

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  private constructor() {
    this.attachOfflineListener();
    // Restore any pending messages from a previous session
    this.restorePending().catch(console.error);
  }

  static getInstance(): MessageQueue {
    if (!MessageQueue.instance) {
      MessageQueue.instance = new MessageQueue();
    }
    return MessageQueue.instance;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Add a new message to the queue.
   * Returns the queue item immediately so the UI can track its status.
   */
  async enqueue(options: EnqueueOptions): Promise<MessageQueueItem> {
    const now = Date.now();
    const item: MessageQueueItem = {
      id: this.generateId(),
      chatId: options.chatId,
      content: options.content,
      attachments: options.attachments ?? [],
      status: QueueStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      retries: 0,
      nextRetryAt: 0,
    };

    await dbPut(item);

    // Attempt immediate delivery if online
    if (OfflineManager.getInstance().isOnline()) {
      this.scheduleProcess();
    }

    return item;
  }

  /**
   * Process the next pending message in FIFO order.
   * Returns true if a message was processed.
   */
  async processNext(): Promise<boolean> {
    if (this.isProcessing) return false;
    if (!OfflineManager.getInstance().isOnline()) return false;

    const pending = await this.getReadyPendingItems();
    if (pending.length === 0) return false;

    const item = pending[0]; // FIFO
    await this.deliverItem(item);
    return true;
  }

  /**
   * Flush all pending messages in FIFO order.
   * Re-entrant calls are no-ops while flush is in progress.
   */
  async flush(): Promise<void> {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      while (true) {
        if (!OfflineManager.getInstance().isOnline()) break;

        const pending = await this.getReadyPendingItems();
        if (pending.length === 0) break;

        for (const item of pending) {
          if (!OfflineManager.getInstance().isOnline()) break;
          await this.deliverItem(item);
        }
      }

      const remaining = await this.getQueueLength();
      if (remaining === 0) {
        this.onQueueEmpty?.();
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Total number of items in the queue (any status except DELIVERED).
   */
  async getQueueLength(): Promise<number> {
    const items = await dbGetAll();
    return items.filter((i) => i.status !== QueueStatus.DELIVERED).length;
  }

  /**
   * Get the current status of a specific item by ID.
   */
  async getStatus(id: string): Promise<QueueStatus | null> {
    const item = await dbGet(id);
    return item?.status ?? null;
  }

  /**
   * Get all FAILED items.
   */
  async getFailedItems(): Promise<MessageQueueItem[]> {
    return dbGetByStatus(QueueStatus.FAILED);
  }

  /**
   * Re-enqueue a failed item for another delivery attempt.
   */
  async retry(id: string): Promise<void> {
    const item = await dbGet(id);
    if (!item || item.status !== QueueStatus.FAILED) return;

    const reset: MessageQueueItem = {
      ...item,
      status: QueueStatus.PENDING,
      retries: 0,
      nextRetryAt: 0,
      error: undefined,
      updatedAt: Date.now(),
    };

    await dbPut(reset);

    if (OfflineManager.getInstance().isOnline()) {
      this.scheduleProcess();
    }
  }

  /**
   * Retry all failed items.
   */
  async retryAll(): Promise<void> {
    const failed = await this.getFailedItems();
    for (const item of failed) {
      await this.retry(item.id);
    }
  }

  // ---------------------------------------------------------------------------
  // Delivery
  // ---------------------------------------------------------------------------

  private async deliverItem(item: MessageQueueItem): Promise<void> {
    // Mark as PROCESSING
    const processing: MessageQueueItem = {
      ...item,
      status: QueueStatus.PROCESSING,
      updatedAt: Date.now(),
    };
    await dbPut(processing);

    try {
      const response = await this.postMessage(processing);

      const delivered: MessageQueueItem = {
        ...processing,
        status: QueueStatus.DELIVERED,
        serverMessageId: response.id,
        updatedAt: Date.now(),
      };
      await dbPut(delivered);

      this.onDelivered?.(delivered, response.id);
    } catch (err) {
      await this.handleDeliveryError(processing, err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async postMessage(
    item: MessageQueueItem,
  ): Promise<{ id: string; [key: string]: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Queue-Item-Id': item.id,
          'X-Idempotency-Key': item.id,
        },
        body: JSON.stringify({
          chatId: item.chatId,
          content: item.content,
          attachments: item.attachments,
          queuedAt: item.createdAt,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
      }

      return response.json() as Promise<{ id: string }>;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async handleDeliveryError(item: MessageQueueItem, error: Error): Promise<void> {
    const retries = item.retries + 1;

    if (retries >= MAX_RETRIES) {
      const failed: MessageQueueItem = {
        ...item,
        status: QueueStatus.FAILED,
        retries,
        error: error.message,
        updatedAt: Date.now(),
      };
      await dbPut(failed);
      this.onFailed?.(failed, error);
      console.error(`[MessageQueue] Item ${item.id} permanently failed:`, error.message);
      return;
    }

    const delay = backoffMs(retries);
    const pending: MessageQueueItem = {
      ...item,
      status: QueueStatus.PENDING,
      retries,
      nextRetryAt: Date.now() + delay,
      error: error.message,
      updatedAt: Date.now(),
    };
    await dbPut(pending);

    console.warn(
      `[MessageQueue] Item ${item.id} failed (attempt ${retries}/${MAX_RETRIES}). ` +
      `Retrying in ${Math.round(delay / 1000)}s.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getReadyPendingItems(): Promise<MessageQueueItem[]> {
    const pending = await dbGetByStatus(QueueStatus.PENDING);
    const now = Date.now();
    return pending
      .filter((i) => i.nextRetryAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt); // FIFO
  }

  private scheduleProcess(): void {
    // Defer slightly so the caller can receive the returned item first
    setTimeout(() => {
      this.flush().catch(console.error);
    }, 50);
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      this.flush().catch(console.error);
    }
  };

  // ---------------------------------------------------------------------------
  // Session restore
  // ---------------------------------------------------------------------------

  /**
   * On startup, re-queue any PROCESSING items (interrupted mid-delivery)
   * and schedule a flush for pending items.
   */
  private async restorePending(): Promise<void> {
    try {
      const interrupted = await dbGetByStatus(QueueStatus.PROCESSING);
      for (const item of interrupted) {
        const reset: MessageQueueItem = {
          ...item,
          status: QueueStatus.PENDING,
          nextRetryAt: Date.now() + 1_000, // brief delay
          updatedAt: Date.now(),
        };
        await dbPut(reset);
      }

      const pendingCount = (await dbGetByStatus(QueueStatus.PENDING)).length;
      if (pendingCount > 0 && OfflineManager.getInstance().isOnline()) {
        this.scheduleProcess();
      }
    } catch (err) {
      console.warn('[MessageQueue] Failed to restore pending items:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    this.unsubscribeOffline?.();
    this.onDelivered = null;
    this.onFailed = null;
    this.onQueueEmpty = null;
    MessageQueue.instance = null;
  }
}
