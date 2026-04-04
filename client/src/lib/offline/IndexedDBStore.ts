/**
 * IndexedDBStore.ts
 * Promise-based IndexedDB wrapper with versioned schema migrations,
 * typed object stores, and generic CRUD operations.
 */

// ---------------------------------------------------------------------------
// Store names (typed union for safety)
// ---------------------------------------------------------------------------

export type StoreName =
  | 'chats'
  | 'messages'
  | 'drafts'
  | 'cached_responses'
  | 'sync_queue';

// ---------------------------------------------------------------------------
// Record shape per store
// ---------------------------------------------------------------------------

export interface ChatRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number | null;
  messageCount: number;
  modelId: string;
  isArchived: boolean;
  metadata: Record<string, unknown>;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  tokenCount: number | null;
  isStreaming: boolean;
  metadata: Record<string, unknown>;
}

export interface DraftRecord {
  id: string;
  chatId: string;
  content: string;
  savedAt: number;
  attachments: string[]; // file IDs / URLs
}

export interface CachedResponseRecord {
  id: string;
  promptHash: string;
  modelId: string;
  response: string;
  cachedAt: number;
  expiresAt: number;
  tokenCount: number;
}

export interface SyncQueueRecord {
  id: string;
  operation: 'create' | 'update' | 'delete';
  storeName: StoreName;
  recordId: string;
  payload: unknown;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  enqueuedAt: number;
  attempts: number;
  lastAttemptAt: number | null;
  error: string | null;
}

// Map from store name to its record type (used for generic typing).
export interface StoreRecordMap {
  chats: ChatRecord;
  messages: MessageRecord;
  drafts: DraftRecord;
  cached_responses: CachedResponseRecord;
  sync_queue: SyncQueueRecord;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class IDBError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'IDBError';
  }
}

export class IDBNotFoundError extends IDBError {
  constructor(store: StoreName, key: IDBValidKey) {
    super(`Record not found in "${store}" with key "${String(key)}"`);
    this.name = 'IDBNotFoundError';
  }
}

export class IDBTransactionError extends IDBError {
  constructor(store: StoreName, operation: string, cause?: unknown) {
    super(`Transaction failed on "${store}" during "${operation}"`, cause);
    this.name = 'IDBTransactionError';
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export interface QueryOptions {
  index?: string;
  range?: IDBKeyRange;
  direction?: IDBCursorDirection;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Schema / migration definitions
// ---------------------------------------------------------------------------

interface StoreSchema {
  name: StoreName;
  keyPath: string;
  autoIncrement?: boolean;
  indexes: Array<{
    name: string;
    keyPath: string | string[];
    unique?: boolean;
    multiEntry?: boolean;
  }>;
}

const SCHEMA: StoreSchema[] = [
  {
    name: 'chats',
    keyPath: 'id',
    indexes: [
      { name: 'by_updatedAt', keyPath: 'updatedAt' },
      { name: 'by_lastMessageAt', keyPath: 'lastMessageAt' },
      { name: 'by_isArchived', keyPath: 'isArchived' },
    ],
  },
  {
    name: 'messages',
    keyPath: 'id',
    indexes: [
      { name: 'by_chatId', keyPath: 'chatId' },
      { name: 'by_chatId_createdAt', keyPath: ['chatId', 'createdAt'] },
      { name: 'by_createdAt', keyPath: 'createdAt' },
    ],
  },
  {
    name: 'drafts',
    keyPath: 'id',
    indexes: [
      { name: 'by_chatId', keyPath: 'chatId', unique: true },
      { name: 'by_savedAt', keyPath: 'savedAt' },
    ],
  },
  {
    name: 'cached_responses',
    keyPath: 'id',
    indexes: [
      { name: 'by_promptHash', keyPath: 'promptHash' },
      { name: 'by_expiresAt', keyPath: 'expiresAt' },
      { name: 'by_modelId_promptHash', keyPath: ['modelId', 'promptHash'] },
    ],
  },
  {
    name: 'sync_queue',
    keyPath: 'id',
    indexes: [
      { name: 'by_priority', keyPath: 'priority' },
      { name: 'by_enqueuedAt', keyPath: 'enqueuedAt' },
      { name: 'by_storeName', keyPath: 'storeName' },
      { name: 'by_recordId', keyPath: 'recordId' },
    ],
  },
];

// ---------------------------------------------------------------------------
// IDBWrapper
// ---------------------------------------------------------------------------

export class IDBWrapper {
  private _db: IDBDatabase | null = null;
  private _opening: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly _dbName: string,
    private readonly _version: number = 1
  ) {}

  // -- Connection -----------------------------------------------------------

  private _open(): Promise<IDBDatabase> {
    if (this._db) return Promise.resolve(this._db);
    if (this._opening) return this._opening;

    this._opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this._dbName, this._version);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;
        this._migrate(db, oldVersion, this._version);
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this._db = db;

        // Handle unexpected version changes (e.g., another tab upgraded).
        db.onversionchange = () => {
          db.close();
          this._db = null;
          this._opening = null;
        };

        resolve(db);
      };

      request.onerror = () => {
        this._opening = null;
        reject(new IDBError('Failed to open database', request.error));
      };

      request.onblocked = () => {
        console.warn('[IDBWrapper] Database upgrade blocked — close other tabs.');
      };
    });

    return this._opening;
  }

  /** Close the database connection explicitly. */
  close(): void {
    this._db?.close();
    this._db = null;
    this._opening = null;
  }

  // -- Schema migrations ----------------------------------------------------

  private _migrate(db: IDBDatabase, oldVersion: number, newVersion: number): void {
    // Version 1 — initial schema.
    if (oldVersion < 1) {
      for (const schema of SCHEMA) {
        const store = db.createObjectStore(schema.name, {
          keyPath: schema.keyPath,
          autoIncrement: schema.autoIncrement ?? false,
        });
        for (const idx of schema.indexes) {
          store.createIndex(idx.name, idx.keyPath, {
            unique: idx.unique ?? false,
            multiEntry: idx.multiEntry ?? false,
          });
        }
      }
    }

    // Placeholder for future version migrations.
    // if (oldVersion < 2) { ... }
    void newVersion; // suppress unused-variable lint warning
  }

  // -- Transaction helper ---------------------------------------------------

  private async _transaction<T>(
    storeNames: StoreName | StoreName[],
    mode: IDBTransactionMode,
    callback: (tx: IDBTransaction) => Promise<T>
  ): Promise<T> {
    const db = await this._open();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];

    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result: T;

      tx.oncomplete = () => resolve(result);
      tx.onerror = () =>
        reject(
          new IDBTransactionError(
            names[0],
            mode,
            tx.error
          )
        );
      tx.onabort = () =>
        reject(new IDBTransactionError(names[0], `${mode} (aborted)`, tx.error));

      callback(tx)
        .then((r) => {
          result = r;
        })
        .catch((err) => {
          tx.abort();
          reject(err);
        });
    });
  }

  // -- Low-level request wrapper -------------------------------------------

  private _req<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new IDBError('IDB request failed', request.error));
    });
  }

  // -- Generic CRUD ---------------------------------------------------------

  /** Retrieve a single record by primary key. */
  async get<S extends StoreName>(
    store: S,
    key: IDBValidKey
  ): Promise<StoreRecordMap[S] | undefined> {
    return this._transaction(store, 'readonly', async (tx) => {
      const result = await this._req<StoreRecordMap[S] | undefined>(
        tx.objectStore(store).get(key)
      );
      return result;
    });
  }

  /** Retrieve a single record by primary key, throwing if absent. */
  async getOrThrow<S extends StoreName>(
    store: S,
    key: IDBValidKey
  ): Promise<StoreRecordMap[S]> {
    const record = await this.get(store, key);
    if (record === undefined) throw new IDBNotFoundError(store, key);
    return record;
  }

  /** Insert or update a record (upsert). */
  async put<S extends StoreName>(
    store: S,
    record: StoreRecordMap[S]
  ): Promise<IDBValidKey> {
    return this._transaction(store, 'readwrite', async (tx) => {
      return this._req<IDBValidKey>(tx.objectStore(store).put(record));
    });
  }

  /** Insert or update multiple records in a single transaction. */
  async putMany<S extends StoreName>(
    store: S,
    records: StoreRecordMap[S][]
  ): Promise<void> {
    if (records.length === 0) return;
    return this._transaction(store, 'readwrite', async (tx) => {
      const os = tx.objectStore(store);
      await Promise.all(records.map((r) => this._req(os.put(r))));
    });
  }

  /** Delete a record by primary key. Returns true if it existed. */
  async delete<S extends StoreName>(store: S, key: IDBValidKey): Promise<void> {
    return this._transaction(store, 'readwrite', async (tx) => {
      await this._req(tx.objectStore(store).delete(key));
    });
  }

  /** Delete all records in a store. */
  async clear<S extends StoreName>(store: S): Promise<void> {
    return this._transaction(store, 'readwrite', async (tx) => {
      await this._req(tx.objectStore(store).clear());
    });
  }

  /** Retrieve all records (optionally via an index + range). */
  async getAll<S extends StoreName>(
    store: S,
    options?: QueryOptions
  ): Promise<StoreRecordMap[S][]> {
    return this._transaction(store, 'readonly', async (tx) => {
      const os = tx.objectStore(store);
      const source = options?.index ? os.index(options.index) : os;
      const records = await this._req<StoreRecordMap[S][]>(
        source.getAll(options?.range, options?.limit)
      );
      return records;
    });
  }

  /**
   * Cursor-based query with offset, limit, direction support.
   * More flexible than getAll but slightly more expensive.
   */
  async query<S extends StoreName>(
    store: S,
    options: QueryOptions = {}
  ): Promise<StoreRecordMap[S][]> {
    const { index, range, direction = 'next', limit, offset = 0 } = options;

    return this._transaction(store, 'readonly', (tx) => {
      return new Promise<StoreRecordMap[S][]>((resolve, reject) => {
        const os = tx.objectStore(store);
        const source = index ? os.index(index) : os;
        const request = source.openCursor(range ?? null, direction);

        const results: StoreRecordMap[S][] = [];
        let skipped = 0;

        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(results);
            return;
          }

          if (skipped < offset) {
            skipped++;
            cursor.advance(offset - skipped + 1);
            return;
          }

          results.push(cursor.value as StoreRecordMap[S]);

          if (limit !== undefined && results.length >= limit) {
            resolve(results);
            return;
          }

          cursor.continue();
        };

        request.onerror = () =>
          reject(new IDBError('Cursor query failed', request.error));
      });
    });
  }

  /** Count records in a store (optionally scoped to an index + range). */
  async count<S extends StoreName>(
    store: S,
    options?: { index?: string; range?: IDBKeyRange }
  ): Promise<number> {
    return this._transaction(store, 'readonly', async (tx) => {
      const os = tx.objectStore(store);
      const source = options?.index ? os.index(options.index) : os;
      return this._req<number>(source.count(options?.range));
    });
  }

  /**
   * Run multiple operations across multiple stores in a single transaction.
   * Useful for atomic cross-store writes.
   */
  async atomicWrite(
    stores: StoreName[],
    callback: (tx: IDBTransaction) => Promise<void>
  ): Promise<void> {
    return this._transaction(stores, 'readwrite', callback);
  }

  /** Delete records matching a key range on an index. */
  async deleteByIndex<S extends StoreName>(
    store: S,
    indexName: string,
    range: IDBKeyRange
  ): Promise<number> {
    return this._transaction(store, 'readwrite', (tx) => {
      return new Promise<number>((resolve, reject) => {
        const os = tx.objectStore(store);
        const index = os.index(indexName);
        const request = index.openCursor(range);
        let count = 0;

        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(count);
            return;
          }
          cursor.delete();
          count++;
          cursor.continue();
        };

        request.onerror = () =>
          reject(new IDBError('deleteByIndex failed', request.error));
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton store instance (shared across the app)
// ---------------------------------------------------------------------------

export const idb = new IDBWrapper('iliagpt_offline', 1);

export default idb;
