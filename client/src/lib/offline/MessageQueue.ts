/**
 * MessageQueue.ts
 * Persistent, ordered message queue with offline support.
 * Messages are stored in IndexedDB and processed when connectivity resumes.
 */

import { idb } from './IndexedDBStore';
import offlineManager, { NetworkStatus } from './OfflineManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface QueuedMessage {
  /** Stable unique ID (generated on enqueue). */
  id: string;
  /** Target chat session. */
  chatId: string;
  /** Message content. */
  content: string;
  /** Role of the author (always 'user' for queued messages). */
  role: 'user' | 'system';
  /** Monotonically increasing sequence number within a chat for ordered delivery. */
  sequence: number;
  /** Wall-clock timestamp when the message was created. */
  createdAt: number;
  /** Current processing status. */
  status: MessageStatus;
  /** Number of delivery attempts made. */
  attempts: number;
  /** Timestamp of the most recent attempt, or null. */
  lastAttemptAt: number | null;
  /** Error message from the last failed attempt, or null. */
  lastError: string | null;
  /** Optional metadata (attachments, model hints, etc.). */
  metadata: Record<string, unknown>;
}

export type MessageQueueEvent =
  | 'enqueue'
  | 'statusChange'
  | 'sent'
  | 'failed'
  | 'queueDrained'
  | 'processingStart'
  | 'processingStop';

export type QueueEventListener<T = unknown> = (payload: T) => void;

export interface StatusChangePayload {
  messageId: string;
  previous: MessageStatus;
  current: MessageStatus;
  message: QueuedMessage;
}

export interface QueueSnapshot {
  total: number;
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  messages: QueuedMessage[];
}

// ---------------------------------------------------------------------------
// Sender function type (provided by host application)
// ---------------------------------------------------------------------------

/**
 * The host application must supply a sender function.
 * It receives a QueuedMessage and should return a Promise that resolves
 * when the message has been accepted by the server, or rejects on failure.
 */
export type MessageSender = (message: QueuedMessage) => Promise<void>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];
const PROCESS_CONCURRENCY = 1; // Ordered delivery: process one at a time.

// ---------------------------------------------------------------------------
// Sequence counter (per-chat, in-memory; hydrated from IDB on init)
// ---------------------------------------------------------------------------

class SequenceCounter {
  private _counters: Map<string, number> = new Map();

  next(chatId: string): number {
    const current = this._counters.get(chatId) ?? 0;
    const next = current + 1;
    this._counters.set(chatId, next);
    return next;
  }

  seed(chatId: string, value: number): void {
    const existing = this._counters.get(chatId) ?? 0;
    if (value > existing) {
      this._counters.set(chatId, value);
    }
  }
}

// ---------------------------------------------------------------------------
// MessageQueue
// ---------------------------------------------------------------------------

export class MessageQueue {
  private _sender: MessageSender | null = null;
  private _isProcessing = false;
  private _started = false;
  private _unsubscribeNetwork: (() => void) | null = null;
  private _retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private _sequenceCounter = new SequenceCounter();

  private _listeners: Map<MessageQueueEvent, Set<QueueEventListener<unknown>>> =
    new Map();

  // -- Lifecycle ------------------------------------------------------------

  /**
   * Attach a sender function and begin listening for network status changes.
   * Calling start() will also attempt to drain any persisted pending messages.
   */
  async start(sender: MessageSender): Promise<void> {
    if (this._started) return;
    this._started = true;
    this._sender = sender;

    // Hydrate sequence counters from persisted messages.
    await this._hydrateSequenceCounters();

    // Listen for network status changes.
    this._unsubscribeNetwork = offlineManager.on<{ current: NetworkStatus }>(
      'statusChange',
      (payload) => {
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'current' in payload &&
          (payload as { current: NetworkStatus }).current !== 'offline'
        ) {
          void this.processQueue();
        }
      }
    );

    // Try to drain immediately if we're already online.
    if (offlineManager.isOnline) {
      void this.processQueue();
    }
  }

  /** Detach sender and stop background processing. */
  stop(): void {
    this._started = false;
    this._sender = null;
    this._unsubscribeNetwork?.();
    this._unsubscribeNetwork = null;

    // Cancel all pending retry timers.
    for (const timer of this._retryTimers.values()) {
      clearTimeout(timer);
    }
    this._retryTimers.clear();
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Add a message to the queue.
   * The message is persisted to IndexedDB immediately.
   * Returns the enqueued message (with its assigned id and sequence number).
   */
  async enqueue(
    input: Pick<QueuedMessage, 'chatId' | 'content' | 'role' | 'metadata'>
  ): Promise<QueuedMessage> {
    const sequence = this._sequenceCounter.next(input.chatId);

    const message: QueuedMessage = {
      id: this._generateId(),
      chatId: input.chatId,
      content: input.content,
      role: input.role,
      metadata: input.metadata ?? {},
      sequence,
      createdAt: Date.now(),
      status: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
    };

    await this._persist(message);
    this._emit('enqueue', { message });

    // Attempt immediate delivery if online.
    if (offlineManager.isOnline && !this._isProcessing) {
      void this.processQueue();
    }

    return message;
  }

  /**
   * Dequeue (remove) a message by ID regardless of status.
   * Cancels any pending retry timer for the message.
   */
  async dequeue(messageId: string): Promise<void> {
    const timer = this._retryTimers.get(messageId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this._retryTimers.delete(messageId);
    }
    await idb.delete('sync_queue', messageId);
  }

  /**
   * Process all pending messages in sequence (ordered delivery guarantee).
   * If already processing, the call is a no-op.
   */
  async processQueue(): Promise<void> {
    if (this._isProcessing || !this._sender || offlineManager.isOffline) return;

    this._isProcessing = true;
    this._emit('processingStart', {});

    try {
      let hasMore = true;

      while (hasMore) {
        // Load the next batch of pending messages (ordered by chatId + sequence).
        const pending = await this._loadPending(PROCESS_CONCURRENCY);

        if (pending.length === 0) {
          hasMore = false;
          break;
        }

        for (const message of pending) {
          await this._send(message);

          // Re-check connectivity after each message.
          if (offlineManager.isOffline) {
            hasMore = false;
            break;
          }
        }
      }
    } finally {
      this._isProcessing = false;
      this._emit('processingStop', {});
    }

    // Check if queue is fully drained.
    const remaining = await this.countByStatus('pending');
    if (remaining === 0) {
      this._emit('queueDrained', {});
    }
  }

  // -- Querying -------------------------------------------------------------

  /** Get all queued messages across all chats. */
  async getAll(): Promise<QueuedMessage[]> {
    const records = await idb.getAll('sync_queue');
    return records
      .map((r) => this._deserialize(r.payload))
      .filter((m): m is QueuedMessage => m !== null)
      .sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence);
  }

  /** Get messages for a specific chat in order. */
  async getByChat(chatId: string): Promise<QueuedMessage[]> {
    const all = await this.getAll();
    return all
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  /** Get a snapshot of queue stats. */
  async snapshot(): Promise<QueueSnapshot> {
    const all = await this.getAll();
    return {
      total: all.length,
      pending: all.filter((m) => m.status === 'pending').length,
      sending: all.filter((m) => m.status === 'sending').length,
      sent: all.filter((m) => m.status === 'sent').length,
      failed: all.filter((m) => m.status === 'failed').length,
      messages: all,
    };
  }

  /** Count messages in a given status. */
  async countByStatus(status: MessageStatus): Promise<number> {
    const all = await this.getAll();
    return all.filter((m) => m.status === status).length;
  }

  /** Retry a failed message immediately. */
  async retry(messageId: string): Promise<void> {
    const records = await idb.getAll('sync_queue');
    const record = records.find((r) => r.id === messageId);
    if (!record) return;

    const message = this._deserialize(record.payload);
    if (!message || message.status !== 'failed') return;

    // Reset attempts so it can be retried.
    const reset: QueuedMessage = {
      ...message,
      status: 'pending',
      attempts: 0,
      lastError: null,
    };

    await this._persist(reset);

    if (offlineManager.isOnline) {
      void this.processQueue();
    }
  }

  /** Remove all messages with status 'sent'. */
  async pruneSent(): Promise<number> {
    const records = await idb.getAll('sync_queue');
    let count = 0;

    for (const r of records) {
      const msg = this._deserialize(r.payload);
      if (msg?.status === 'sent') {
        await idb.delete('sync_queue', r.id);
        count++;
      }
    }

    return count;
  }

  // -- Internal send logic --------------------------------------------------

  private async _send(message: QueuedMessage): Promise<void> {
    if (!this._sender) return;

    const previous = message.status;
    const sending: QueuedMessage = {
      ...message,
      status: 'sending',
      lastAttemptAt: Date.now(),
    };

    await this._persist(sending);
    this._emitStatusChange(sending.id, previous, 'sending', sending);

    try {
      await this._sender(sending);

      const sent: QueuedMessage = { ...sending, status: 'sent', lastError: null };
      await this._persist(sent);
      this._emitStatusChange(sent.id, 'sending', 'sent', sent);
      this._emit('sent', { message: sent });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const attempts = sending.attempts + 1;

      if (attempts >= MAX_RETRIES) {
        const failed: QueuedMessage = {
          ...sending,
          status: 'failed',
          attempts,
          lastError: errorMessage,
        };
        await this._persist(failed);
        this._emitStatusChange(failed.id, 'sending', 'failed', failed);
        this._emit('failed', { message: failed, error: errorMessage });
      } else {
        // Schedule a retry with exponential backoff.
        const retrying: QueuedMessage = {
          ...sending,
          status: 'pending',
          attempts,
          lastError: errorMessage,
        };
        await this._persist(retrying);
        this._emitStatusChange(retrying.id, 'sending', 'pending', retrying);

        const delayMs = RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        this._scheduleRetry(retrying, delayMs);
      }
    }
  }

  private _scheduleRetry(message: QueuedMessage, delayMs: number): void {
    // Cancel any existing timer.
    const existing = this._retryTimers.get(message.id);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      this._retryTimers.delete(message.id);
      if (offlineManager.isOnline && !this._isProcessing) {
        void this.processQueue();
      }
    }, delayMs);

    this._retryTimers.set(message.id, timer);
  }

  // -- Persistence helpers --------------------------------------------------

  private async _persist(message: QueuedMessage): Promise<void> {
    await idb.put('sync_queue', {
      id: message.id,
      operation: 'create',
      storeName: 'messages',
      recordId: message.id,
      payload: message,
      priority: 'HIGH',
      enqueuedAt: message.createdAt,
      attempts: message.attempts,
      lastAttemptAt: message.lastAttemptAt,
      error: message.lastError,
    });
  }

  private async _loadPending(limit: number): Promise<QueuedMessage[]> {
    const records = await idb.getAll('sync_queue');

    return records
      .map((r) => this._deserialize(r.payload))
      .filter((m): m is QueuedMessage => m !== null && m.status === 'pending')
      .sort((a, b) => {
        // Primary sort: chatId (group chat messages together).
        if (a.chatId < b.chatId) return -1;
        if (a.chatId > b.chatId) return 1;
        // Secondary sort: sequence within chat.
        return a.sequence - b.sequence;
      })
      .slice(0, limit);
  }

  private _deserialize(payload: unknown): QueuedMessage | null {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('id' in payload) ||
      !('chatId' in payload) ||
      !('status' in payload)
    ) {
      return null;
    }
    return payload as QueuedMessage;
  }

  private async _hydrateSequenceCounters(): Promise<void> {
    try {
      const records = await idb.getAll('sync_queue');
      for (const r of records) {
        const msg = this._deserialize(r.payload);
        if (msg) {
          this._sequenceCounter.seed(msg.chatId, msg.sequence);
        }
      }
    } catch (err) {
      console.warn('[MessageQueue] Failed to hydrate sequence counters:', err);
    }
  }

  // -- EventEmitter ---------------------------------------------------------

  on<T = unknown>(
    event: MessageQueueEvent,
    listener: QueueEventListener<T>
  ): () => void {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(listener as QueueEventListener<unknown>);
    return () => this.off(event, listener);
  }

  off<T = unknown>(
    event: MessageQueueEvent,
    listener: QueueEventListener<T>
  ): void {
    this._listeners.get(event)?.delete(listener as QueueEventListener<unknown>);
  }

  once<T = unknown>(
    event: MessageQueueEvent,
    listener: QueueEventListener<T>
  ): () => void {
    const wrapper: QueueEventListener<T> = (payload) => {
      listener(payload);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  private _emit<T>(event: MessageQueueEvent, payload: T): void {
    this._listeners.get(event)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[MessageQueue] Error in "${event}" listener:`, err);
      }
    });
  }

  private _emitStatusChange(
    messageId: string,
    previous: MessageStatus,
    current: MessageStatus,
    message: QueuedMessage
  ): void {
    const payload: StatusChangePayload = { messageId, previous, current, message };
    this._emit('statusChange', payload);
  }

  // -- Utility --------------------------------------------------------------

  private _generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  get isProcessing(): boolean {
    return this._isProcessing;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const messageQueue = new MessageQueue();

export default messageQueue;
