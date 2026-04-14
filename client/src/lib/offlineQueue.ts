const DB_NAME = 'sira-gpt-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending-messages';

const MAX_QUEUE_SIZE = 500;
const MAX_MESSAGES_PER_CHAT = 80;
const MAX_MESSAGE_BYTES = 12000;
const MAX_CHATID_LENGTH = 128;
const MAX_ID_LENGTH = 64;
const MAX_RETRIES = 8;
const QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingMessage {
  id: string;
  chatId: string;
  content: string;
  timestamp: number;
  retryCount: number;
  status: 'pending' | 'syncing' | 'failed';
}

class OfflineQueue {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onsuccess = async () => {
        this.db = request.result;
        await this.compactQueue();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('chatId', 'chatId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  private isValidRecord(message: Omit<PendingMessage, 'retryCount' | 'status'>): boolean {
    if (!message?.id || typeof message.id !== 'string' || message.id.length > MAX_ID_LENGTH) return false;
    if (!message.chatId || typeof message.chatId !== 'string' || message.chatId.length > MAX_CHATID_LENGTH) return false;
    if (!message.content || typeof message.content !== 'string' || message.content.length > MAX_MESSAGE_BYTES) return false;
    return true;
  }

  private async compactQueue(): Promise<void> {
    if (!this.db) return;
    await this.removeExpiredMessages();
    await this.enforcePerChatAndGlobalLimits();
  }

  private async removeExpiredMessages(): Promise<void> {
    if (!this.db) return;

    const cutoff = Date.now() - QUEUE_TTL_MS;
    const messages = await this.getAllMessagesRaw();
    const stale = messages.filter(m => m.timestamp < cutoff);

    if (stale.length === 0) return;

    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (const message of stale) {
      store.delete(message.id);
    }

    await this.promisifyTransaction(tx);
  }

  private async enforcePerChatAndGlobalLimits(): Promise<void> {
    if (!this.db) return;

    const all = await this.getAllMessagesRaw();
    const now = Date.now();

    const validMessages = all
      .filter(msg => msg.timestamp >= now - QUEUE_TTL_MS)
      .sort((a, b) => b.timestamp - a.timestamp);

    const toDelete: string[] = [];
    const chatCounts = new Map<string, number>();

    for (const message of validMessages) {
      if (message.chatId) {
        const count = chatCounts.get(message.chatId) || 0;
        if (count >= MAX_MESSAGES_PER_CHAT) {
          toDelete.push(message.id);
          continue;
        }
        chatCounts.set(message.chatId, count + 1);
      }
    }

    if (validMessages.length > MAX_QUEUE_SIZE) {
      const excess = validMessages.slice(MAX_QUEUE_SIZE);
      toDelete.push(...excess.map(item => item.id));
    }

    if (toDelete.length === 0) return;

    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const id of new Set(toDelete)) {
      store.delete(id);
    }
    await this.promisifyTransaction(tx);
  }

  async addMessage(message: Omit<PendingMessage, 'retryCount' | 'status'>): Promise<void> {
    await this.init();
    if (!this.db || !this.isValidRecord(message)) throw new Error('Invalid pending message payload');

    const existing = await this.getMessageById(message.id);
    if (existing) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const pendingMessage: PendingMessage = {
        ...message,
        retryCount: 0,
        status: 'pending',
      };

      const request = store.add(pendingMessage);
      request.onsuccess = async () => {
        try {
          await this.compactQueue();
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
      (request as any).onblocked = () => reject(new Error('Failed to add pending message: database blocked'));
    });
  }

  private async getMessageById(id: string): Promise<PendingMessage | null> {
    if (!this.db) return null;
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const message = await this.promisifyRequest<PendingMessage | undefined>(store.get(id));
    return message || null;
  }

  private async getAllMessagesRaw(): Promise<PendingMessage[]> {
    if (!this.db) return [];
    return this.promisifyRequest<PendingMessage[]>(this.db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
  }

  async getPendingMessages(): Promise<PendingMessage[]> {
    await this.init();
    if (!this.db) return [];

    const messages = await this.getAllMessagesRaw();
    const pending = messages.filter((m) => m.status === 'pending');
    return pending.sort((a, b) => a.timestamp - b.timestamp);
  }

  async resetFailedToPending(): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const messages = request.result as PendingMessage[];
        const failed = messages.filter((m) => m.status === 'failed');

        const toRetry = failed
          .filter(m => m.retryCount < MAX_RETRIES)
          .map(m => ({ ...m, status: 'pending' as const, retryCount: 0 }));

        let completed = 0;
        if (toRetry.length === 0) {
          resolve();
          return;
        }

        toRetry.forEach((msg) => {
          const putRequest = store.put(msg);
          putRequest.onsuccess = () => {
            completed++;
            if (completed === toRetry.length) resolve();
          };
          putRequest.onerror = () => reject(putRequest.error);
        });
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getFailedCount(): Promise<number> {
    await this.init();
    if (!this.db) return 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const all = request.result as PendingMessage[];
        resolve(all.filter(m => m.status === 'failed').length);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllMessages(): Promise<PendingMessage[]> {
    await this.init();
    if (!this.db) return [];

    return this.getAllMessagesRaw();
  }

  async updateMessageStatus(id: string, status: PendingMessage['status']): Promise<void> {
    await this.init();
    if (!this.db) return;

    if (!['pending', 'syncing', 'failed'].includes(status)) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const message = getRequest.result;
        if (message) {
          if (status === 'syncing') {
            message.retryCount = Math.min(message.retryCount + 1, MAX_RETRIES);
          }
          message.status = status;
          const putRequest = store.put(message);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async removeMessage(id: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clearAllMessages(): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getMessageCount(): Promise<number> {
    await this.init();
    if (!this.db) return 0;

    return this.promisifyRequest<number>(this.db!.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count());
  }

  private async promisifyTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
    });
  }

  private promisifyRequest<T>(request: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  }
}

export const offlineQueue = new OfflineQueue();
