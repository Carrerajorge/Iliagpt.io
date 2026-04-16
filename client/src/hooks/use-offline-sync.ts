import { useState, useEffect, useCallback, useRef } from 'react';
import { useOnlineStatus } from './use-online-status';
import { offlineQueue } from '../lib/offlineQueue';
import { nanoid } from 'nanoid';

const MAX_RETRIES = 5;
const RETRY_INTERVAL_MS = 30000;

interface UseOfflineSyncOptions {
  onSyncStart?: () => void;
  onSyncComplete?: (syncedCount: number) => void;
  onSyncError?: (error: Error) => void;
  sendMessage: (chatId: string, content: string) => Promise<boolean>;
}

export function useOfflineSync(options: UseOfflineSyncOptions) {
  const { sendMessage, onSyncStart, onSyncComplete, onSyncError } = options;
  const { isOnline, wasOffline, resetWasOffline } = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncInProgress = useRef(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updateCounts = useCallback(async () => {
    try {
      const total = await offlineQueue.getMessageCount();
      const failed = await offlineQueue.getFailedCount();
      setPendingCount(total);
      setFailedCount(failed);
    } catch (error) {
      console.error('Error getting counts:', error);
    }
  }, []);

  const queueMessage = useCallback(async (chatId: string, content: string): Promise<string> => {
    const id = nanoid();
    await offlineQueue.addMessage({
      id,
      chatId,
      content,
      timestamp: Date.now(),
    });
    await updateCounts();
    return id;
  }, [updateCounts]);

  const syncPendingMessages = useCallback(async () => {
    if (syncInProgress.current || !isOnline) return;
    
    syncInProgress.current = true;
    setIsSyncing(true);
    onSyncStart?.();

    try {
      const pending = await offlineQueue.getPendingMessages();
      let syncedCount = 0;

      for (const message of pending) {
        if (!navigator.onLine) break;
        
        if (message.retryCount >= MAX_RETRIES) {
          await offlineQueue.updateMessageStatus(message.id, 'failed');
          continue;
        }

        try {
          await offlineQueue.updateMessageStatus(message.id, 'syncing');
          const success = await sendMessage(message.chatId, message.content);
          
          if (success) {
            await offlineQueue.removeMessage(message.id);
            syncedCount++;
          } else {
            await offlineQueue.updateMessageStatus(message.id, 'pending');
          }
        } catch (error) {
          console.error('Error syncing message:', error);
          await offlineQueue.updateMessageStatus(message.id, 'pending');
        }
      }

      await updateCounts();
      onSyncComplete?.(syncedCount);
      
      const remainingPending = await offlineQueue.getPendingMessages();
      if (remainingPending.length > 0 && isOnline) {
        scheduleRetry();
      }
    } catch (error) {
      console.error('Sync error:', error);
      onSyncError?.(error as Error);
    } finally {
      setIsSyncing(false);
      syncInProgress.current = false;
    }
  }, [isOnline, sendMessage, onSyncStart, onSyncComplete, onSyncError, updateCounts]);

  const scheduleRetry = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }
    
    retryTimeoutRef.current = setTimeout(() => {
      if (navigator.onLine) {
        syncPendingMessages();
      }
    }, RETRY_INTERVAL_MS);
  }, [syncPendingMessages]);

  const retryFailed = useCallback(async () => {
    await offlineQueue.resetFailedToPending();
    await updateCounts();
    syncPendingMessages();
  }, [updateCounts, syncPendingMessages]);

  useEffect(() => {
    if (wasOffline && isOnline) {
      syncPendingMessages();
      resetWasOffline();
    }
  }, [wasOffline, isOnline, syncPendingMessages, resetWasOffline]);

  useEffect(() => {
    updateCounts();
  }, [updateCounts]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const sendOrQueue = useCallback(async (chatId: string, content: string): Promise<{ queued: boolean; id?: string }> => {
    if (!isOnline) {
      const id = await queueMessage(chatId, content);
      return { queued: true, id };
    }

    try {
      const success = await sendMessage(chatId, content);
      if (!success) {
        const id = await queueMessage(chatId, content);
        scheduleRetry();
        return { queued: true, id };
      }
      return { queued: false };
    } catch (error) {
      const id = await queueMessage(chatId, content);
      scheduleRetry();
      return { queued: true, id };
    }
  }, [isOnline, sendMessage, queueMessage, scheduleRetry]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    failedCount,
    queueMessage,
    sendOrQueue,
    syncPendingMessages,
    retryFailed,
    updateCounts,
  };
}
