/**
 * Memory Snapshots for Conversation Recovery
 * 
 * Creates point-in-time snapshots of conversations for recovery.
 * Useful for:
 * - Long conversations that exceed memory limits
 * - Crash recovery
 * - Historical state restoration
 */

import { Message, Chat } from '@/hooks/use-chats';

const DB_NAME = 'iliagpt-snapshots';
const DB_VERSION = 1;
const STORE_SNAPSHOTS = 'snapshots';

let dbInstance: IDBDatabase | null = null;

export interface ConversationSnapshot {
    id: string;
    chatId: string;
    title: string;
    messageCount: number;
    messages: Message[];
    createdAt: number;
    sizeBytes: number;
    metadata?: {
        trigger: 'auto' | 'manual';
        reason?: string;
    };
}

// Initialize IndexedDB
async function initSnapshotDB(): Promise<IDBDatabase> {
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

            if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
                const store = db.createObjectStore(STORE_SNAPSHOTS, { keyPath: 'id' });
                store.createIndex('chatId', 'chatId', { unique: false });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };
    });
}

// Configuration
const SNAPSHOT_TRIGGER_MESSAGE_COUNT = 50; // Create snapshot every 50 messages
const MAX_SNAPSHOTS_PER_CHAT = 5; // Keep only last 5 snapshots per chat
const MAX_SNAPSHOT_AGE_DAYS = 30; // Delete snapshots older than 30 days

// Create snapshot
export async function createSnapshot(
    chat: Chat,
    trigger: 'auto' | 'manual' = 'auto',
    reason?: string
): Promise<ConversationSnapshot> {
    const db = await initSnapshotDB();

    const snapshot: ConversationSnapshot = {
        id: `snap_${chat.id}_${Date.now()}`,
        chatId: chat.id,
        title: chat.title,
        messageCount: chat.messages.length,
        messages: chat.messages.map(m => ({
            ...m,
            // Strip large data to reduce snapshot size
            generatedImage: undefined,
            sources: undefined
        })) as Message[],
        createdAt: Date.now(),
        sizeBytes: 0,
        metadata: { trigger, reason }
    };

    // Calculate size
    snapshot.sizeBytes = new Blob([JSON.stringify(snapshot)]).size;

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_SNAPSHOTS, 'readwrite');
        const store = transaction.objectStore(STORE_SNAPSHOTS);
        const request = store.put(snapshot);

        request.onsuccess = async () => {
            console.log(`[Snapshot] Created snapshot for chat ${chat.id} (${snapshot.messageCount} messages, ${(snapshot.sizeBytes / 1024).toFixed(1)}KB)`);

            // Cleanup old snapshots
            await cleanupOldSnapshots(chat.id);

            resolve(snapshot);
        };

        request.onerror = () => reject(request.error);
    });
}

// Get snapshots for a chat
export async function getSnapshots(chatId: string): Promise<ConversationSnapshot[]> {
    const db = await initSnapshotDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_SNAPSHOTS, 'readonly');
        const store = transaction.objectStore(STORE_SNAPSHOTS);
        const index = store.index('chatId');
        const request = index.getAll(chatId);

        request.onsuccess = () => {
            const snapshots = request.result || [];
            // Sort by creation time, newest first
            snapshots.sort((a, b) => b.createdAt - a.createdAt);
            resolve(snapshots);
        };

        request.onerror = () => reject(request.error);
    });
}

// Get latest snapshot
export async function getLatestSnapshot(chatId: string): Promise<ConversationSnapshot | null> {
    const snapshots = await getSnapshots(chatId);
    return snapshots.length > 0 ? snapshots[0] : null;
}

// Restore from snapshot
export async function restoreFromSnapshot(snapshotId: string): Promise<ConversationSnapshot | null> {
    const db = await initSnapshotDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_SNAPSHOTS, 'readonly');
        const store = transaction.objectStore(STORE_SNAPSHOTS);
        const request = store.get(snapshotId);

        request.onsuccess = () => {
            const snapshot = request.result;
            if (snapshot) {
                console.log(`[Snapshot] Restored snapshot ${snapshotId} (${snapshot.messageCount} messages)`);
            }
            resolve(snapshot || null);
        };

        request.onerror = () => reject(request.error);
    });
}

// Delete snapshot
export async function deleteSnapshot(snapshotId: string): Promise<void> {
    const db = await initSnapshotDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_SNAPSHOTS, 'readwrite');
        const store = transaction.objectStore(STORE_SNAPSHOTS);
        const request = store.delete(snapshotId);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Cleanup old snapshots for a chat (keep only MAX_SNAPSHOTS_PER_CHAT)
async function cleanupOldSnapshots(chatId: string): Promise<number> {
    const snapshots = await getSnapshots(chatId);

    if (snapshots.length <= MAX_SNAPSHOTS_PER_CHAT) {
        return 0;
    }

    // Remove oldest snapshots
    const toDelete = snapshots.slice(MAX_SNAPSHOTS_PER_CHAT);

    for (const snapshot of toDelete) {
        await deleteSnapshot(snapshot.id);
    }

    console.log(`[Snapshot] Cleaned up ${toDelete.length} old snapshots for chat ${chatId}`);
    return toDelete.length;
}

// Cleanup all old snapshots (older than MAX_SNAPSHOT_AGE_DAYS)
export async function cleanupAllOldSnapshots(): Promise<number> {
    const db = await initSnapshotDB();
    const cutoffTime = Date.now() - (MAX_SNAPSHOT_AGE_DAYS * 24 * 60 * 60 * 1000);

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_SNAPSHOTS, 'readwrite');
        const store = transaction.objectStore(STORE_SNAPSHOTS);
        const index = store.index('createdAt');
        const range = IDBKeyRange.upperBound(cutoffTime);
        const request = index.openCursor(range);

        let deletedCount = 0;

        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
                cursor.delete();
                deletedCount++;
                cursor.continue();
            } else {
                if (deletedCount > 0) {
                    console.log(`[Snapshot] Cleaned up ${deletedCount} expired snapshots`);
                }
                resolve(deletedCount);
            }
        };

        request.onerror = () => reject(request.error);
    });
}

// Check if snapshot should be created (auto-trigger logic)
export function shouldCreateSnapshot(messageCount: number, lastSnapshotMessageCount: number = 0): boolean {
    // Create snapshot every SNAPSHOT_TRIGGER_MESSAGE_COUNT messages
    const messagesSinceLastSnapshot = messageCount - lastSnapshotMessageCount;
    return messagesSinceLastSnapshot >= SNAPSHOT_TRIGGER_MESSAGE_COUNT;
}

// Get storage stats
export async function getSnapshotStats(): Promise<{ count: number; totalSizeBytes: number }> {
    const db = await initSnapshotDB();

    return new Promise((resolve) => {
        const transaction = db.transaction(STORE_SNAPSHOTS, 'readonly');
        const store = transaction.objectStore(STORE_SNAPSHOTS);
        const request = store.openCursor();

        let count = 0;
        let totalSize = 0;

        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
                count++;
                totalSize += cursor.value.sizeBytes || 0;
                cursor.continue();
            } else {
                resolve({ count, totalSizeBytes: totalSize });
            }
        };

        request.onerror = () => {
            resolve({ count: 0, totalSizeBytes: 0 });
        };
    });
}

export default {
    createSnapshot,
    getSnapshots,
    getLatestSnapshot,
    restoreFromSnapshot,
    deleteSnapshot,
    cleanupAllOldSnapshots,
    shouldCreateSnapshot,
    getSnapshotStats,
    SNAPSHOT_TRIGGER_MESSAGE_COUNT
};
