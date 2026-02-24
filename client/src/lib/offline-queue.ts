/**
 * Offline Message Queue
 * 
 * Queues messages when offline and syncs them when connection returns.
 * Uses IndexedDB for persistence and navigator.onLine for detection.
 */

import { Message, generateRequestId } from '@/hooks/use-chats';

const DB_NAME = 'iliagpt-offline';
const DB_VERSION = 1;
const STORE_QUEUE = 'message_queue';

let dbInstance: IDBDatabase | null = null;

export interface QueuedMessage {
    id: string;
    chatId: string;
    message: Message;
    createdAt: number;
    retryCount: number;
    status: 'pending' | 'syncing' | 'failed';
    error?: string;
}

// Initialize IndexedDB for offline queue
async function initOfflineDB(): Promise<IDBDatabase> {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);

        request.onsuccess = () => {
            dbInstance = request.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            if (!db.objectStoreNames.contains(STORE_QUEUE)) {
                const store = db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
                store.createIndex('chatId', 'chatId', { unique: false });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };
    });
}

// Check if currently online
export function isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

// Add message to offline queue
export async function queueOfflineMessage(chatId: string, message: Message): Promise<QueuedMessage> {
    const db = await initOfflineDB();

    const queuedMessage: QueuedMessage = {
        id: `offline_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        chatId,
        message: { ...message, requestId: message.requestId || generateRequestId() },
        createdAt: Date.now(),
        retryCount: 0,
        status: 'pending'
    };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_QUEUE, 'readwrite');
        const store = transaction.objectStore(STORE_QUEUE);
        const request = store.put(queuedMessage);

        request.onsuccess = () => {
            console.log(`[Offline] Queued message for chat ${chatId}`);
            resolve(queuedMessage);
        };

        request.onerror = () => reject(request.error);
    });
}

// Get all pending messages
export async function getPendingMessages(): Promise<QueuedMessage[]> {
    const db = await initOfflineDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_QUEUE, 'readonly');
        const store = transaction.objectStore(STORE_QUEUE);
        const index = store.index('status');
        const request = index.getAll('pending');

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

// Get queue size
export async function getQueueSize(): Promise<number> {
    const pending = await getPendingMessages();
    return pending.length;
}

// Update queued message status
export async function updateQueuedMessageStatus(
    id: string,
    status: 'pending' | 'syncing' | 'failed',
    error?: string
): Promise<void> {
    const db = await initOfflineDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_QUEUE, 'readwrite');
        const store = transaction.objectStore(STORE_QUEUE);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
            const item = getRequest.result;
            if (item) {
                item.status = status;
                item.retryCount = status === 'failed' ? item.retryCount + 1 : item.retryCount;
                if (error) item.error = error;

                const putRequest = store.put(item);
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = () => reject(putRequest.error);
            } else {
                resolve();
            }
        };

        getRequest.onerror = () => reject(getRequest.error);
    });
}

// Remove from queue (after successful sync)
export async function removeFromQueue(id: string): Promise<void> {
    const db = await initOfflineDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_QUEUE, 'readwrite');
        const store = transaction.objectStore(STORE_QUEUE);
        const request = store.delete(id);

        request.onsuccess = () => {
            console.log(`[Offline] Removed message ${id} from queue`);
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

// Sync callback type
type SyncCallback = (chatId: string, message: Message) => Promise<boolean>;

// Process offline queue when back online
export async function syncOfflineQueue(syncFn: SyncCallback): Promise<number> {
    if (!isOnline()) {
        console.log('[Offline] Still offline, skipping sync');
        return 0;
    }

    const pending = await getPendingMessages();
    if (pending.length === 0) return 0;

    console.log(`[Offline] Syncing ${pending.length} queued messages`);

    let syncedCount = 0;

    for (const item of pending) {
        try {
            await updateQueuedMessageStatus(item.id, 'syncing');

            const success = await syncFn(item.chatId, item.message);

            if (success) {
                await removeFromQueue(item.id);
                syncedCount++;
            } else {
                await updateQueuedMessageStatus(item.id, 'failed', 'Sync returned false');
            }
        } catch (error) {
            await updateQueuedMessageStatus(
                item.id,
                'failed',
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    }

    console.log(`[Offline] Synced ${syncedCount}/${pending.length} messages`);
    return syncedCount;
}

// Set up online/offline listeners
let syncCallback: SyncCallback | null = null;

export function setupOfflineSync(callback: SyncCallback): () => void {
    syncCallback = callback;

    const handleOnline = async () => {
        console.log('[Offline] Connection restored, syncing...');
        if (syncCallback) {
            await syncOfflineQueue(syncCallback);
        }
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('online', handleOnline);

        // Return cleanup function
        return () => {
            window.removeEventListener('online', handleOnline);
            syncCallback = null;
        };
    }

    return () => { syncCallback = null; };
}

// Clear all queued messages
export async function clearOfflineQueue(): Promise<void> {
    const db = await initOfflineDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_QUEUE, 'readwrite');
        const store = transaction.objectStore(STORE_QUEUE);
        const request = store.clear();

        request.onsuccess = () => {
            console.log('[Offline] Cleared queue');
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

export default {
    isOnline,
    queueOfflineMessage,
    getPendingMessages,
    getQueueSize,
    syncOfflineQueue,
    setupOfflineSync,
    clearOfflineQueue
};
