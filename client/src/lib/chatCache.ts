/**
 * IndexedDB Chat Cache
 * Local storage for offline access and faster loading
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface ChatCacheDB extends DBSchema {
    chats: {
        key: string;
        value: {
            id: string;
            title: string;
            projectId?: string;
            createdAt: Date;
            updatedAt: Date;
            messageCount: number;
            lastMessage?: string;
            syncedAt: Date;
        };
        indexes: {
            'by-project': string;
            'by-updated': Date;
        };
    };
    messages: {
        key: string;
        value: {
            id: string;
            chatId: string;
            role: 'user' | 'assistant' | 'system';
            content: string;
            timestamp: Date;
            attachments?: string;
            syncedAt: Date;
        };
        indexes: {
            'by-chat': string;
            'by-timestamp': Date;
        };
    };
    pendingSync: {
        key: string;
        value: {
            id: string;
            type: 'message' | 'chat';
            action: 'create' | 'update' | 'delete';
            data: any;
            createdAt: Date;
            retries: number;
        };
    };
    attachments: {
        key: string;
        value: {
            id: string;
            messageId: string;
            name: string;
            type: string;
            size: number;
            data: Blob;
            cachedAt: Date;
        };
        indexes: {
            'by-message': string;
        };
    };
}

const DB_NAME = 'iliagpt-cache';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<ChatCacheDB> | null = null;

/**
 * Initialize the database
 */
async function getDB(): Promise<IDBPDatabase<ChatCacheDB>> {
    if (dbInstance) return dbInstance;

    dbInstance = await openDB<ChatCacheDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
            // Chats store
            const chatStore = db.createObjectStore('chats', { keyPath: 'id' });
            chatStore.createIndex('by-project', 'projectId');
            chatStore.createIndex('by-updated', 'updatedAt');

            // Messages store
            const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
            messageStore.createIndex('by-chat', 'chatId');
            messageStore.createIndex('by-timestamp', 'timestamp');

            // Pending sync store
            db.createObjectStore('pendingSync', { keyPath: 'id' });

            // Attachments store
            const attachmentStore = db.createObjectStore('attachments', { keyPath: 'id' });
            attachmentStore.createIndex('by-message', 'messageId');
        },
    });

    return dbInstance;
}

// ============================================
// CHAT OPERATIONS
// ============================================

export async function cacheChat(chat: ChatCacheDB['chats']['value']): Promise<void> {
    const db = await getDB();
    await db.put('chats', { ...chat, syncedAt: new Date() });
}

export async function getCachedChat(chatId: string): Promise<ChatCacheDB['chats']['value'] | undefined> {
    const db = await getDB();
    return db.get('chats', chatId);
}

export async function getAllCachedChats(): Promise<ChatCacheDB['chats']['value'][]> {
    const db = await getDB();
    return db.getAllFromIndex('chats', 'by-updated');
}

export async function getChatsByProject(projectId: string): Promise<ChatCacheDB['chats']['value'][]> {
    const db = await getDB();
    return db.getAllFromIndex('chats', 'by-project', projectId);
}

export async function deleteCachedChat(chatId: string): Promise<void> {
    const db = await getDB();
    await db.delete('chats', chatId);

    // Also delete associated messages
    const messagesToDelete = await db.getAllFromIndex('messages', 'by-chat', chatId);
    for (const message of messagesToDelete) {
        await db.delete('messages', message.id);
    }
}

// ============================================
// MESSAGE OPERATIONS
// ============================================

export async function cacheMessage(message: ChatCacheDB['messages']['value']): Promise<void> {
    const db = await getDB();
    await db.put('messages', { ...message, syncedAt: new Date() });
}

export async function cacheMessages(messages: ChatCacheDB['messages']['value'][]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('messages', 'readwrite');

    await Promise.all([
        ...messages.map(m => tx.store.put({ ...m, syncedAt: new Date() })),
        tx.done,
    ]);
}

export async function getCachedMessages(chatId: string): Promise<ChatCacheDB['messages']['value'][]> {
    const db = await getDB();
    const messages = await db.getAllFromIndex('messages', 'by-chat', chatId);
    return messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

export async function getLatestMessages(limit: number = 100): Promise<ChatCacheDB['messages']['value'][]> {
    const db = await getDB();
    const all = await db.getAllFromIndex('messages', 'by-timestamp');
    return all.slice(-limit);
}

// ============================================
// PENDING SYNC OPERATIONS
// ============================================

export async function addPendingSync(
    type: 'message' | 'chat',
    action: 'create' | 'update' | 'delete',
    data: any
): Promise<void> {
    const db = await getDB();
    await db.put('pendingSync', {
        id: crypto.randomUUID(),
        type,
        action,
        data,
        createdAt: new Date(),
        retries: 0,
    });
}

export async function getPendingSyncs(): Promise<ChatCacheDB['pendingSync']['value'][]> {
    const db = await getDB();
    return db.getAll('pendingSync');
}

export async function removePendingSync(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('pendingSync', id);
}

export async function incrementSyncRetry(id: string): Promise<void> {
    const db = await getDB();
    const item = await db.get('pendingSync', id);
    if (item) {
        item.retries++;
        await db.put('pendingSync', item);
    }
}

// ============================================
// ATTACHMENT OPERATIONS
// ============================================

export async function cacheAttachment(
    id: string,
    messageId: string,
    name: string,
    type: string,
    data: Blob
): Promise<void> {
    const db = await getDB();
    await db.put('attachments', {
        id,
        messageId,
        name,
        type,
        size: data.size,
        data,
        cachedAt: new Date(),
    });
}

export async function getCachedAttachment(id: string): Promise<Blob | undefined> {
    const db = await getDB();
    const attachment = await db.get('attachments', id);
    return attachment?.data;
}

export async function getAttachmentsByMessage(messageId: string): Promise<ChatCacheDB['attachments']['value'][]> {
    const db = await getDB();
    return db.getAllFromIndex('attachments', 'by-message', messageId);
}

// ============================================
// SYNC UTILITIES
// ============================================

export async function syncWithServer(): Promise<{ synced: number; failed: number }> {
    const pending = await getPendingSyncs();
    let synced = 0;
    let failed = 0;

    for (const item of pending) {
        try {
            const endpoint = item.type === 'chat' ? '/api/chats' : '/api/messages';
            let method = 'POST';
            let url = endpoint;

            if (item.action === 'update') {
                method = 'PUT';
                url = `${endpoint}/${item.data.id}`;
            } else if (item.action === 'delete') {
                method = 'DELETE';
                url = `${endpoint}/${item.data.id}`;
            }

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: item.action !== 'delete' ? JSON.stringify(item.data) : undefined,
            });

            if (response.ok) {
                await removePendingSync(item.id);
                synced++;
            } else {
                await incrementSyncRetry(item.id);
                failed++;
            }
        } catch (error) {
            await incrementSyncRetry(item.id);
            failed++;
        }
    }

    return { synced, failed };
}

// ============================================
// CACHE MANAGEMENT
// ============================================

export async function getCacheSize(): Promise<{ chats: number; messages: number; attachments: number }> {
    const db = await getDB();
    return {
        chats: await db.count('chats'),
        messages: await db.count('messages'),
        attachments: await db.count('attachments'),
    };
}

export async function clearOldCache(daysOld: number = 30): Promise<number> {
    const db = await getDB();
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    let deleted = 0;

    // Clear old messages
    const messages = await db.getAll('messages');
    for (const message of messages) {
        if (message.syncedAt < cutoff) {
            await db.delete('messages', message.id);
            deleted++;
        }
    }

    // Clear old chats without recent messages
    const chats = await db.getAll('chats');
    for (const chat of chats) {
        if (chat.syncedAt < cutoff) {
            const chatMessages = await getCachedMessages(chat.id);
            if (chatMessages.length === 0 || chatMessages.every(m => m.syncedAt < cutoff)) {
                await deleteCachedChat(chat.id);
                deleted++;
            }
        }
    }

    return deleted;
}

export async function clearAllCache(): Promise<void> {
    const db = await getDB();
    await db.clear('chats');
    await db.clear('messages');
    await db.clear('attachments');
    await db.clear('pendingSync');
}
