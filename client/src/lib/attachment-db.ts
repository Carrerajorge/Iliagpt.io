/**
 * IndexedDB Storage for Chat Attachments
 * 
 * Provides persistent storage for large attachments (images, files)
 * that would exceed localStorage limits (5MB).
 * 
 * Uses IndexedDB for:
 * - Generated images
 * - File attachments
 * - Document previews
 */

const DB_NAME = 'iliagpt-attachments';
const DB_VERSION = 1;
const STORE_IMAGES = 'images';
const STORE_FILES = 'files';

let dbInstance: IDBDatabase | null = null;

// Initialize IndexedDB
export async function initAttachmentDB(): Promise<IDBDatabase> {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('[IndexedDB] Failed to open database:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            dbInstance = request.result;
            console.log('[IndexedDB] Database opened successfully');
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            // Create object store for images
            if (!db.objectStoreNames.contains(STORE_IMAGES)) {
                const imageStore = db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
                imageStore.createIndex('messageId', 'messageId', { unique: false });
                imageStore.createIndex('createdAt', 'createdAt', { unique: false });
                console.log('[IndexedDB] Created images store');
            }

            // Create object store for files
            if (!db.objectStoreNames.contains(STORE_FILES)) {
                const fileStore = db.createObjectStore(STORE_FILES, { keyPath: 'id' });
                fileStore.createIndex('messageId', 'messageId', { unique: false });
                fileStore.createIndex('chatId', 'chatId', { unique: false });
                fileStore.createIndex('createdAt', 'createdAt', { unique: false });
                console.log('[IndexedDB] Created files store');
            }
        };
    });
}

// ============================================================================
// IMAGE STORAGE
// ============================================================================

export interface StoredImage {
    id: string;
    messageId: string;
    chatId: string;
    base64: string;
    mimeType: string;
    createdAt: number;
    sizeBytes: number;
}

export async function storeImage(image: Omit<StoredImage, 'createdAt' | 'sizeBytes'>): Promise<void> {
    const db = await initAttachmentDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_IMAGES, 'readwrite');
        const store = transaction.objectStore(STORE_IMAGES);

        const record: StoredImage = {
            ...image,
            createdAt: Date.now(),
            sizeBytes: Math.ceil(image.base64.length * 0.75)
        };

        const request = store.put(record);

        request.onsuccess = () => {
            console.log(`[IndexedDB] Stored image ${image.id} (${(record.sizeBytes / 1024).toFixed(1)}KB)`);
            resolve();
        };

        request.onerror = () => {
            console.error('[IndexedDB] Failed to store image:', request.error);
            reject(request.error);
        };
    });
}

export async function getImage(id: string): Promise<StoredImage | null> {
    const db = await initAttachmentDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_IMAGES, 'readonly');
        const store = transaction.objectStore(STORE_IMAGES);
        const request = store.get(id);

        request.onsuccess = () => {
            resolve(request.result || null);
        };

        request.onerror = () => {
            console.error('[IndexedDB] Failed to get image:', request.error);
            reject(request.error);
        };
    });
}

export async function getImagesByMessageId(messageId: string): Promise<StoredImage[]> {
    const db = await initAttachmentDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_IMAGES, 'readonly');
        const store = transaction.objectStore(STORE_IMAGES);
        const index = store.index('messageId');
        const request = index.getAll(messageId);

        request.onsuccess = () => {
            resolve(request.result || []);
        };

        request.onerror = () => {
            console.error('[IndexedDB] Failed to get images by messageId:', request.error);
            reject(request.error);
        };
    });
}

export async function deleteImage(id: string): Promise<void> {
    const db = await initAttachmentDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_IMAGES, 'readwrite');
        const store = transaction.objectStore(STORE_IMAGES);
        const request = store.delete(id);

        request.onsuccess = () => {
            console.log(`[IndexedDB] Deleted image ${id}`);
            resolve();
        };

        request.onerror = () => {
            console.error('[IndexedDB] Failed to delete image:', request.error);
            reject(request.error);
        };
    });
}

// ============================================================================
// FILE STORAGE
// ============================================================================

export interface StoredFile {
    id: string;
    messageId: string;
    chatId: string;
    name: string;
    mimeType: string;
    data: ArrayBuffer | string; // ArrayBuffer for binary, base64 string for text
    createdAt: number;
    sizeBytes: number;
}

export async function storeFile(file: Omit<StoredFile, 'createdAt' | 'sizeBytes'>): Promise<void> {
    const db = await initAttachmentDB();

    const sizeBytes = typeof file.data === 'string'
        ? Math.ceil(file.data.length * 0.75)
        : file.data.byteLength;

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_FILES, 'readwrite');
        const store = transaction.objectStore(STORE_FILES);

        const record: StoredFile = {
            ...file,
            createdAt: Date.now(),
            sizeBytes
        };

        const request = store.put(record);

        request.onsuccess = () => {
            console.log(`[IndexedDB] Stored file ${file.name} (${(sizeBytes / 1024).toFixed(1)}KB)`);
            resolve();
        };

        request.onerror = () => {
            console.error('[IndexedDB] Failed to store file:', request.error);
            reject(request.error);
        };
    });
}

export async function getFile(id: string): Promise<StoredFile | null> {
    const db = await initAttachmentDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_FILES, 'readonly');
        const store = transaction.objectStore(STORE_FILES);
        const request = store.get(id);

        request.onsuccess = () => {
            resolve(request.result || null);
        };

        request.onerror = () => {
            console.error('[IndexedDB] Failed to get file:', request.error);
            reject(request.error);
        };
    });
}

export async function getFilesByMessageId(messageId: string): Promise<StoredFile[]> {
    const db = await initAttachmentDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_FILES, 'readonly');
        const store = transaction.objectStore(STORE_FILES);
        const index = store.index('messageId');
        const request = index.getAll(messageId);

        request.onsuccess = () => {
            resolve(request.result || []);
        };

        request.onerror = () => {
            console.error('[IndexedDB] Failed to get files by messageId:', request.error);
            reject(request.error);
        };
    });
}

export async function deleteFile(id: string): Promise<void> {
    const db = await initAttachmentDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_FILES, 'readwrite');
        const store = transaction.objectStore(STORE_FILES);
        const request = store.delete(id);

        request.onsuccess = () => {
            console.log(`[IndexedDB] Deleted file ${id}`);
            resolve();
        };

        request.onerror = () => {
            console.error('[IndexedDB] Failed to delete file:', request.error);
            reject(request.error);
        };
    });
}

// ============================================================================
// STORAGE STATS & CLEANUP
// ============================================================================

export interface StorageStats {
    imageCount: number;
    imageSizeBytes: number;
    fileCount: number;
    fileSizeBytes: number;
    totalSizeBytes: number;
}

export async function getStorageStats(): Promise<StorageStats> {
    const db = await initAttachmentDB();

    const countStore = (storeName: string): Promise<{ count: number; size: number }> => {
        return new Promise((resolve) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.openCursor();

            let count = 0;
            let size = 0;

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
                if (cursor) {
                    count++;
                    size += cursor.value.sizeBytes || 0;
                    cursor.continue();
                } else {
                    resolve({ count, size });
                }
            };

            request.onerror = () => {
                resolve({ count: 0, size: 0 });
            };
        });
    };

    const [imageStats, fileStats] = await Promise.all([
        countStore(STORE_IMAGES),
        countStore(STORE_FILES)
    ]);

    return {
        imageCount: imageStats.count,
        imageSizeBytes: imageStats.size,
        fileCount: fileStats.count,
        fileSizeBytes: fileStats.size,
        totalSizeBytes: imageStats.size + fileStats.size
    };
}

// Cleanup old attachments (older than maxAgeDays)
export async function cleanupOldAttachments(maxAgeDays: number = 30): Promise<number> {
    const db = await initAttachmentDB();
    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

    let deletedCount = 0;

    const cleanupStore = (storeName: string): Promise<number> => {
        return new Promise((resolve) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const index = store.index('createdAt');
            const range = IDBKeyRange.upperBound(cutoffTime);
            const request = index.openCursor(range);

            let count = 0;

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
                if (cursor) {
                    cursor.delete();
                    count++;
                    cursor.continue();
                } else {
                    resolve(count);
                }
            };

            request.onerror = () => {
                resolve(0);
            };
        });
    };

    const [imageDeleted, fileDeleted] = await Promise.all([
        cleanupStore(STORE_IMAGES),
        cleanupStore(STORE_FILES)
    ]);

    deletedCount = imageDeleted + fileDeleted;

    if (deletedCount > 0) {
        console.log(`[IndexedDB] Cleaned up ${deletedCount} old attachments`);
    }

    return deletedCount;
}

// Clear all attachments (for testing or reset)
export async function clearAllAttachments(): Promise<void> {
    const db = await initAttachmentDB();

    const clearStore = (storeName: string): Promise<void> => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    };

    await Promise.all([
        clearStore(STORE_IMAGES),
        clearStore(STORE_FILES)
    ]);

    console.log('[IndexedDB] Cleared all attachments');
}

export default {
    initAttachmentDB,
    storeImage,
    getImage,
    getImagesByMessageId,
    deleteImage,
    storeFile,
    getFile,
    getFilesByMessageId,
    deleteFile,
    getStorageStats,
    cleanupOldAttachments,
    clearAllAttachments
};
