/**
 * Offline Mode Hook - ILIAGPT PRO 3.0
 * 
 * Enables offline functionality with local caching,
 * sync queue, and intelligent reconnection.
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ============== Types ==============

export interface OfflineState {
    isOffline: boolean;
    isOnline: boolean;
    pendingActions: PendingAction[];
    syncStatus: SyncStatus;
    lastOnline: Date | null;
    cachedMessages: number;
    storageUsed: number;
}

export interface PendingAction {
    id: string;
    type: "message" | "create_chat" | "delete_chat" | "update_settings";
    data: any;
    timestamp: Date;
    retryCount: number;
    priority: number;
}

export type SyncStatus =
    | "synced"
    | "pending"
    | "syncing"
    | "error"
    | "offline";

export interface OfflineConfig {
    maxCacheSize?: number;        // bytes
    maxPendingActions?: number;
    syncInterval?: number;        // ms
    retryDelay?: number;          // ms
    maxRetries?: number;
    enableBackgroundSync?: boolean;
}

// ============== Storage Keys ==============

const STORAGE_KEYS = {
    pendingActions: "iliagpt_pending_actions",
    cachedMessages: "iliagpt_cached_messages",
    cachedChats: "iliagpt_cached_chats",
    lastSync: "iliagpt_last_sync",
    offlineSettings: "iliagpt_offline_settings",
};

// ============== Helpers ==============

function getFromStorage<T>(key: string, defaultValue: T): T {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
    } catch {
        return defaultValue;
    }
}

function setToStorage(key: string, value: any): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn("[Offline] Storage write failed:", e);
    }
}

function generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============== Hook ==============

export function useOfflineMode(config: OfflineConfig = {}) {
    const {
        maxCacheSize = 50 * 1024 * 1024, // 50MB
        maxPendingActions = 100,
        syncInterval = 5000,
        retryDelay = 2000,
        maxRetries = 5,
        enableBackgroundSync = true,
    } = config;

    const [state, setState] = useState<OfflineState>({
        isOffline: typeof navigator !== "undefined" ? !navigator.onLine : false,
        isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
        pendingActions: [],
        syncStatus: "synced",
        lastOnline: null,
        cachedMessages: 0,
        storageUsed: 0,
    });

    const syncInProgress = useRef(false);
    const syncInterval$ = useRef<NodeJS.Timeout | null>(null);

    // ======== Online/Offline Detection ========

    useEffect(() => {
        const handleOnline = () => {
            setState(s => ({
                ...s,
                isOnline: true,
                isOffline: false,
                lastOnline: new Date(),
                syncStatus: s.pendingActions.length > 0 ? "pending" : "synced",
            }));

            // Trigger sync when coming online
            if (enableBackgroundSync) {
                syncPendingActions();
            }
        };

        const handleOffline = () => {
            setState(s => ({
                ...s,
                isOnline: false,
                isOffline: true,
                syncStatus: "offline",
            }));
        };

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        // Load cached state
        const cached = getFromStorage<PendingAction[]>(STORAGE_KEYS.pendingActions, []);
        setState(s => ({
            ...s,
            pendingActions: cached,
            cachedMessages: getFromStorage(STORAGE_KEYS.cachedMessages, []).length,
        }));

        // Start sync interval
        if (enableBackgroundSync) {
            syncInterval$.current = setInterval(() => {
                if (navigator.onLine) {
                    syncPendingActions();
                }
            }, syncInterval);
        }

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
            if (syncInterval$.current) {
                clearInterval(syncInterval$.current);
            }
        };
    }, [enableBackgroundSync, syncInterval]);

    // ======== Pending Actions ========

    const queueAction = useCallback((
        type: PendingAction["type"],
        data: any,
        priority: number = 5
    ): string => {
        const action: PendingAction = {
            id: generateId(),
            type,
            data,
            timestamp: new Date(),
            retryCount: 0,
            priority,
        };

        setState(s => {
            let actions = [...s.pendingActions, action];

            // Enforce max actions
            if (actions.length > maxPendingActions) {
                actions = actions
                    .sort((a, b) => b.priority - a.priority)
                    .slice(0, maxPendingActions);
            }

            // Persist
            setToStorage(STORAGE_KEYS.pendingActions, actions);

            return {
                ...s,
                pendingActions: actions,
                syncStatus: s.isOnline ? "pending" : "offline",
            };
        });

        // Try immediate sync if online
        if (navigator.onLine) {
            syncPendingActions();
        }

        return action.id;
    }, [maxPendingActions]);

    const removeAction = useCallback((actionId: string) => {
        setState(s => {
            const actions = s.pendingActions.filter(a => a.id !== actionId);
            setToStorage(STORAGE_KEYS.pendingActions, actions);

            return {
                ...s,
                pendingActions: actions,
                syncStatus: actions.length === 0 ? "synced" : s.syncStatus,
            };
        });
    }, []);

    // ======== Sync ========

    const syncPendingActions = useCallback(async (): Promise<{
        synced: number;
        failed: number;
    }> => {
        // Prevent concurrent sync operations
        if (syncInProgress.current || !navigator.onLine) {
            return { synced: 0, failed: 0 };
        }

        syncInProgress.current = true;
        setState(s => ({ ...s, syncStatus: "syncing" }));

        let synced = 0;
        let failed = 0;

        // Get fresh state to avoid stale closure issues
        const currentState = getFromStorage<PendingAction[]>(STORAGE_KEYS.pendingActions, []);
        const actions = [...currentState].sort(
            (a, b) => b.priority - a.priority ||
                      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        for (const action of actions) {
            // Check if we're still online before each action
            if (!navigator.onLine) {
                console.log('[Offline] Lost connection during sync, stopping');
                break;
            }

            try {
                // Execute action (in production, call actual API)
                await executeAction(action);
                removeAction(action.id);
                synced++;
            } catch (error) {
                const updatedRetryCount = action.retryCount + 1;

                if (updatedRetryCount >= maxRetries) {
                    // Remove failed action after max retries
                    removeAction(action.id);
                    failed++;
                    console.error(`[Offline] Action ${action.id} failed after ${maxRetries} retries`);
                } else {
                    // Update retry count atomically
                    setState(s => {
                        const updatedActions = s.pendingActions.map(a =>
                            a.id === action.id ? { ...a, retryCount: updatedRetryCount } : a
                        );
                        setToStorage(STORAGE_KEYS.pendingActions, updatedActions);
                        return { ...s, pendingActions: updatedActions };
                    });
                }

                // Delay before next action
                await new Promise(r => setTimeout(r, retryDelay));
            }
        }

        syncInProgress.current = false;

        // Get fresh pending count to determine final status
        setState(s => ({
            ...s,
            syncStatus: s.pendingActions.length === 0 ? "synced" : "pending",
        }));

        if (synced > 0) {
            setToStorage(STORAGE_KEYS.lastSync, new Date().toISOString());
        }

        return { synced, failed };
    }, [maxRetries, retryDelay, removeAction]);

    // ======== Cache ========

    const cacheMessage = useCallback((chatId: string, message: any) => {
        const key = `${STORAGE_KEYS.cachedMessages}_${chatId}`;
        const cached = getFromStorage<any[]>(key, []);
        cached.push({ ...message, cachedAt: new Date().toISOString() });

        // Limit cache size
        const limited = cached.slice(-500);
        setToStorage(key, limited);

        setState(s => ({
            ...s,
            cachedMessages: s.cachedMessages + 1,
        }));
    }, []);

    const getCachedMessages = useCallback((chatId: string): any[] => {
        const key = `${STORAGE_KEYS.cachedMessages}_${chatId}`;
        return getFromStorage<any[]>(key, []);
    }, []);

    const clearCache = useCallback((chatId?: string) => {
        if (chatId) {
            localStorage.removeItem(`${STORAGE_KEYS.cachedMessages}_${chatId}`);
        } else {
            // Clear all caches
            Object.keys(localStorage)
                .filter(k => k.startsWith(STORAGE_KEYS.cachedMessages))
                .forEach(k => localStorage.removeItem(k));
        }

        setState(s => ({ ...s, cachedMessages: 0 }));
    }, []);

    // ======== Storage Stats ========

    const getStorageStats = useCallback((): {
        used: number;
        available: number;
        percent: number;
    } => {
        let used = 0;

        for (const key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                used += localStorage[key].length * 2; // UTF-16
            }
        }

        return {
            used,
            available: maxCacheSize - used,
            percent: (used / maxCacheSize) * 100,
        };
    }, [maxCacheSize]);

    return {
        ...state,
        queueAction,
        removeAction,
        syncPendingActions,
        cacheMessage,
        getCachedMessages,
        clearCache,
        getStorageStats,
        forceSync: syncPendingActions,
    };
}

// ======== Action Executor ========

async function executeAction(action: PendingAction): Promise<void> {
    // FRONTEND FIX #50: Avoid logging potentially sensitive data in production
    // In production, this would call actual APIs
    if (import.meta.env.DEV) {
        console.log(`[Offline] Executing action: ${action.type}`, action.data);
    } else {
        console.log(`[Offline] Executing action: ${action.type}`);
    }

    // Simulate network request
    await new Promise(r => setTimeout(r, 100));

    // Simulate occasional failures
    if (Math.random() < 0.1) {
        throw new Error("Network error");
    }
}

export default useOfflineMode;
