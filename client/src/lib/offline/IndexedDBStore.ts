/**
 * IndexedDBStore.ts
 *
 * Generic, fully-typed IndexedDB wrapper for IliaGPT offline storage.
 *
 * Supports the following named object stores:
 *   chats | messages | drafts | preferences | cachedResponses | syncQueue
 *
 * Features:
 *  - Automatic schema migrations (versions 1 → 3)
 *  - Generic class: IndexedDBStore<T> keyed on T['id']
 *  - Quota monitoring with LRU eviction
 *  - Transactional bulk operations with rollback helpers
 *  - Secondary index queries
 */

// ---------------------------------------------------------------------------
// Typed Store Schemas
// ---------------------------------------------------------------------------

export interface BaseRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatRecord extends BaseRecord {
  title: string;
  model: string;
  messageCount: number;
  lastMessageAt: number;
  isPinned: boolean;
  tags: string[];
}

export interface MessageRecord extends BaseRecord {
  chatId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments: AttachmentRef[];
  tokenCount: number;
  cached: boolean;
}

export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DraftRecord extends BaseRecord {
  chatId: string;
  content: string;
  attachments: AttachmentRef[];
}

export interface PreferenceRecord extends BaseRecord {
  key: string;
  value: unknown;
}

export interface CachedResponseRecord extends BaseRecord {
  promptHash: string;
  model: string;
  response: string;
  expiresAt: number;
  hitCount: number;
  lastHitAt: number;
}

export interface SyncQueueRecord extends BaseRecord {
  type: string;
  operation: 'create' | 'update' | 'delete';
  payload: unknown;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  retries: number;
  status: 'pending' | 'processing' | 'failed' | 'done';
  vectorClock: Record<string, number>;
  nextRetryAt: number;
}

// Map store names to their record types
export interface StoreSchemas {
  chats: ChatRecord;
  messages: MessageRecord;
  drafts: DraftRecord;
  preferences: PreferenceRecord;
  cachedResponses: CachedResponseRecord;
  syncQueue: SyncQueueRecord;
}

export type StoreName = keyof StoreSchemas;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'iliagpt-offline-v2';
const DB_VERSION = 3;

/** Indexes to create per store: [storeName, indexName, keyPath, options] */
const STORE_INDEXES: Array<[StoreName, string, string | string[], IDBIndexParameters]> = [
  ['chats', 'by_lastMessageAt', 'lastMessageAt', { unique: false }],
  ['chats', 'by_isPinned', 'isPinned', { unique: false }],
  ['messages', 'by_chatId', 'chatId', { unique: false }],
  ['messages', 'by_chatId_createdAt', ['chatId', 'createdAt'], { unique: false }],
  ['drafts', 'by_chatId', 'chatId', { unique: false }],
  ['preferences', 'by_key', 'key', { unique: true }],
  ['cachedResponses', 'by_promptHash', 'promptHash', { unique: false }],
  ['cachedResponses', 'by_expiresAt', 'expiresAt', { unique: false }],
  ['cachedResponses', 'by_lastHitAt', 'lastHitAt', { unique: false }],
  ['syncQueue', 'by_status', 'status', { unique: false }],
  ['syncQueue', 'by_priority_status', ['priority', 'status'], { unique: false }],
  ['syncQueue', 'by_nextRetryAt', 'nextRetryAt', { unique: false }],
];

// ---------------------------------------------------------------------------
// DB lifecycle
// ---------------------------------------------------------------------------

let sharedDb: IDBDatabase | null = null;
let openingPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (sharedDb) return Promise.resolve(sharedDb);
  if (openingPromise) return openingPromise;

  openingPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      openingPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      sharedDb = request.result;

      sharedDb.onclose = () => {
        sharedDb = null;
        openingPromise = null;
      };

      sharedDb.onversionchange = () => {
        sharedDb?.close();
        sharedDb = null;
        openingPromise = null;
      };

      openingPromise = null;
      resolve(sharedDb);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      applyMigrations(db, oldVersion);
    };

    request.onblocked = () => {
      console.warn('[IndexedDBStore] DB upgrade blocked by another tab. Please close other tabs.');
    };
  });

  return openingPromise;
}

/** Idempotent migration runner – applies changes incrementally by version. */
function applyMigrations(db: IDBDatabase, fromVersion: number): void {
  // ── Version 1: initial schema ──
  if (fromVersion < 1) {
    const baseStores: StoreName[] = ['chats', 'messages', 'drafts', 'preferences'];
    for (const name of baseStores) {
      if (!db.objectStoreNames.contains(name)) {
        db.createObjectStore(name, { keyPath: 'id' });
      }
    }
  }

  // ── Version 2: add cachedResponses + syncQueue ──
  if (fromVersion < 2) {
    if (!db.objectStoreNames.contains('cachedResponses')) {
      db.createObjectStore('cachedResponses', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('syncQueue')) {
      db.createObjectStore('syncQueue', { keyPath: 'id' });
    }
  }

  // ── Version 3: add all indexes ──
  if (fromVersion < 3) {
    // We need to access the object stores via the ongoing upgrade transaction.
    // In onupgradeneeded the transaction is available on the request result.
    // Unfortunately IDBDatabase.transaction() does not work here – we rely on
    // the event.target.transaction which is the upgrade transaction.
    for (const [storeName, indexName, keyPath, opts] of STORE_INDEXES) {
      if (!db.objectStoreNames.contains(storeName)) continue;
      // Access via the upgrade transaction stored on the event
      // We'll use a trick: re-open via transaction parameter passed from event
      // The IDBDatabase reference during onupgradeneeded does provide
      // objectStore via the IDBVersionChangeEvent transaction:
      //   (event.target as IDBOpenDBRequest).transaction!.objectStore(...)
      // We handle this in the onupgradeneeded handler below by calling a
      // helper that accepts the transaction.
    }
    // Indexes are actually added in onupgradeneeded via the tx helper below.
    // This version guard is used as a signal.
  }
}

/** Called with the upgrade transaction to safely create all indexes. */
function applyIndexes(
  tx: IDBTransaction,
  fromVersion: number,
): void {
  if (fromVersion >= 3) return; // Already done

  for (const [storeName, indexName, keyPath, opts] of STORE_INDEXES) {
    try {
      const store = tx.objectStore(storeName);
      if (!store.indexNames.contains(indexName)) {
        store.createIndex(indexName, keyPath, opts);
      }
    } catch {
      // Store may not exist yet in this upgrade path – skip gracefully
    }
  }
}

// Override openDatabase to wire up the index creation properly
function openDatabaseFull(): Promise<IDBDatabase> {
  if (sharedDb) return Promise.resolve(sharedDb);
  if (openingPromise) return openingPromise;

  openingPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      openingPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      sharedDb = request.result;
      sharedDb.onclose = () => { sharedDb = null; openingPromise = null; };
      sharedDb.onversionchange = () => { sharedDb?.close(); sharedDb = null; openingPromise = null; };
      openingPromise = null;
      resolve(sharedDb);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = (event.target as IDBOpenDBRequest).transaction!;
      const oldVersion = event.oldVersion;

      applyMigrations(db, oldVersion);
      applyIndexes(tx, oldVersion);
    };

    request.onblocked = () => {
      console.warn('[IndexedDBStore] Upgrade blocked. Close other tabs and refresh.');
    };
  });

  return openingPromise;
}

// ---------------------------------------------------------------------------
// Utility: promise-wrap an IDBRequest
// ---------------------------------------------------------------------------

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(new Error('Transaction aborted'));
  });
}

// ---------------------------------------------------------------------------
// IndexedDBStore<T> – generic store accessor
// ---------------------------------------------------------------------------

export class IndexedDBStore<K extends StoreName> {
  private readonly storeName: K;

  constructor(storeName: K) {
    this.storeName = storeName;
  }

  // ── Low-level helpers ───────────────────────────────────────────────────

  private async getDb(): Promise<IDBDatabase> {
    return openDatabaseFull();
  }

  private async readStore(): Promise<IDBObjectStore> {
    const db = await this.getDb();
    return db.transaction(this.storeName, 'readonly').objectStore(this.storeName);
  }

  private async writeStore(): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
    const db = await this.getDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    return { store: tx.objectStore(this.storeName), tx };
  }

  // ── CRUD ────────────────────────────────────────────────────────────────

  async get(id: string): Promise<StoreSchemas[K] | undefined> {
    const store = await this.readStore();
    return promisify(store.get(id) as IDBRequest<StoreSchemas[K] | undefined>);
  }

  async getAll(): Promise<StoreSchemas[K][]> {
    const store = await this.readStore();
    return promisify(store.getAll() as IDBRequest<StoreSchemas[K][]>);
  }

  async put(item: StoreSchemas[K]): Promise<void> {
    const { store, tx } = await this.writeStore();
    const now = Date.now();
    const record = { ...item, updatedAt: now } as StoreSchemas[K];
    store.put(record);
    return txComplete(tx);
  }

  async delete(id: string): Promise<void> {
    const { store, tx } = await this.writeStore();
    store.delete(id);
    return txComplete(tx);
  }

  async clear(): Promise<void> {
    const { store, tx } = await this.writeStore();
    store.clear();
    return txComplete(tx);
  }

  /**
   * Atomically write multiple items. If any put fails the entire
   * transaction is aborted and the promise rejects.
   */
  async bulkPut(items: StoreSchemas[K][]): Promise<void> {
    if (items.length === 0) return;

    const db = await this.getDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);
    const now = Date.now();

    for (const item of items) {
      store.put({ ...item, updatedAt: now });
    }

    return txComplete(tx);
  }

  /**
   * Query items using a named index.
   * @param indexName  The index name (must exist in STORE_INDEXES for this store).
   * @param value      The key or IDBKeyRange to query.
   */
  async query(
    indexName: string,
    value: IDBValidKey | IDBKeyRange,
  ): Promise<StoreSchemas[K][]> {
    const db = await this.getDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const store = tx.objectStore(this.storeName);
    const index = store.index(indexName);
    return promisify(index.getAll(value) as IDBRequest<StoreSchemas[K][]>);
  }

  /**
   * Counts records optionally filtered by an index.
   */
  async count(indexName?: string, value?: IDBValidKey | IDBKeyRange): Promise<number> {
    const db = await this.getDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const store = tx.objectStore(this.storeName);

    if (indexName && value !== undefined) {
      const index = store.index(indexName);
      return promisify(index.count(value));
    }

    return promisify(store.count());
  }

  /**
   * Iterate all records sorted by the given index, calling predicate.
   * Stops when predicate returns false.
   */
  async iterate(
    indexName: string,
    direction: IDBCursorDirection = 'next',
    predicate?: (record: StoreSchemas[K]) => boolean,
  ): Promise<StoreSchemas[K][]> {
    const db = await this.getDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const index = tx.objectStore(this.storeName).index(indexName);

    return new Promise<StoreSchemas[K][]>((resolve, reject) => {
      const results: StoreSchemas[K][] = [];
      const request = index.openCursor(null, direction);

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(results);
          return;
        }

        const record = cursor.value as StoreSchemas[K];
        if (!predicate || predicate(record)) {
          results.push(record);
        } else {
          resolve(results); // short-circuit
          return;
        }

        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }
}

// ---------------------------------------------------------------------------
// Storage quota management (shared utility)
// ---------------------------------------------------------------------------

export interface QuotaInfo {
  usedBytes: number;
  quotaBytes: number;
  usedPercent: number;
  available: boolean;
}

export async function checkQuota(): Promise<QuotaInfo> {
  if (!navigator.storage?.estimate) {
    return { usedBytes: 0, quotaBytes: 0, usedPercent: 0, available: false };
  }

  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return {
    usedBytes: usage,
    quotaBytes: quota,
    usedPercent: quota > 0 ? (usage / quota) * 100 : 0,
    available: true,
  };
}

/**
 * Evict oldest cached responses until at least `bytesToFree` bytes are recovered.
 * Uses the `cachedResponses` store, sorted by `lastHitAt` (LRU order).
 */
export async function evictOldest(bytesToFree: number): Promise<number> {
  const store = new IndexedDBStore('cachedResponses');
  const records = await store.iterate('by_lastHitAt', 'next');

  let freedEstimate = 0;
  const toDelete: string[] = [];

  for (const record of records) {
    if (freedEstimate >= bytesToFree) break;
    toDelete.push(record.id);
    // Rough size estimate: JSON-serialised response string length × 2 bytes per char
    freedEstimate += (record.response?.length ?? 0) * 2;
  }

  for (const id of toDelete) {
    await store.delete(id);
  }

  return freedEstimate;
}

/**
 * Evict expired cached responses (expiresAt < now).
 */
export async function evictExpired(): Promise<number> {
  const store = new IndexedDBStore('cachedResponses');
  const expired = await store.query(
    'by_expiresAt',
    IDBKeyRange.upperBound(Date.now()),
  );

  for (const record of expired) {
    await store.delete(record.id);
  }

  return expired.length;
}

// ---------------------------------------------------------------------------
// Convenience pre-built store instances (optional singletons)
// ---------------------------------------------------------------------------

export const chatStore = new IndexedDBStore('chats');
export const messageStore = new IndexedDBStore('messages');
export const draftStore = new IndexedDBStore('drafts');
export const preferenceStore = new IndexedDBStore('preferences');
export const cachedResponseStore = new IndexedDBStore('cachedResponses');
export const syncQueueStore = new IndexedDBStore('syncQueue');
