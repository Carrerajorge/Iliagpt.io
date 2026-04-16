import { useState, useCallback, useRef } from 'react';
import { showErrorToast } from '@/lib/queryClient';
import { useOnlineStatus } from './use-online-status';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetryAttempt?: (attempt: number, delay: number) => void;
  onSuccess?: () => void;
  onFailure?: (error: Error) => void;
  showToast?: boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetryAttempt' | 'onSuccess' | 'onFailure'>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  showToast: true,
};

function calculateBackoffDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const delay = baseDelay * Math.pow(2, attempt);
  const jitter = delay * 0.2 * Math.random();
  return Math.min(delay + jitter, maxDelay);
}

export function useRetry<T>(
  asyncFn: () => Promise<T>,
  options?: RetryOptions
) {
  const { isOnline } = useOnlineStatus();
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const opts = { ...DEFAULT_OPTIONS, ...options };

  const execute = useCallback(async (): Promise<T | null> => {
    if (!isOnline) {
      const offlineError = new Error('No internet connection');
      setError(offlineError);
      if (opts.showToast) {
        showErrorToast('No internet connection', {
          description: 'Check your connection and try again',
        });
      }
      return null;
    }

    setIsRetrying(true);
    setError(null);
    abortControllerRef.current = new AbortController();

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      if (abortControllerRef.current?.signal.aborted) {
        setIsRetrying(false);
        return null;
      }

      try {
        setRetryCount(attempt);
        const result = await asyncFn();
        setIsRetrying(false);
        setRetryCount(0);
        setError(null);
        options?.onSuccess?.();
        return result;
      } catch (err) {
        const error = err as Error;
        
        if (attempt < opts.maxRetries) {
          const delay = calculateBackoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
          options?.onRetryAttempt?.(attempt + 1, delay);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        setError(error);
        setIsRetrying(false);
        options?.onFailure?.(error);
        
        if (opts.showToast) {
          showErrorToast(error.message, {
            onRetry: () => execute(),
          });
        }
        
        return null;
      }
    }

    setIsRetrying(false);
    return null;
  }, [asyncFn, isOnline, opts]);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsRetrying(false);
  }, []);

  const reset = useCallback(() => {
    setIsRetrying(false);
    setRetryCount(0);
    setError(null);
  }, []);

  const retry = useCallback(() => {
    return execute();
  }, [execute]);

  return {
    execute,
    retry,
    cancel,
    reset,
    isRetrying,
    retryCount,
    error,
    isOnline,
  };
}

export function useMessageRetry(
  sendMessage: (chatId: string, content: string) => Promise<boolean>,
  options?: Omit<RetryOptions, 'showToast'>
) {
  const { isOnline } = useOnlineStatus();
  const [pendingMessages, setPendingMessages] = useState<Array<{
    id: string;
    chatId: string;
    content: string;
    timestamp: number;
    attempts: number;
  }>>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const opts = { ...DEFAULT_OPTIONS, ...options };

  const queueMessage = useCallback((chatId: string, content: string, id: string) => {
    setPendingMessages(prev => [...prev, {
      id,
      chatId,
      content,
      timestamp: Date.now(),
      attempts: 0,
    }]);
  }, []);

  const sendWithRetry = useCallback(async (
    chatId: string,
    content: string,
    messageId: string
  ): Promise<boolean> => {
    if (!isOnline) {
      queueMessage(chatId, content, messageId);
      showErrorToast('No internet connection', {
        description: 'Message queued and will send when online',
      });
      return false;
    }

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      try {
        const success = await sendMessage(chatId, content);
        if (success) {
          setPendingMessages(prev => prev.filter(m => m.id !== messageId));
          return true;
        }
        throw new Error('Failed to send message');
      } catch (error) {
        if (attempt < opts.maxRetries) {
          const delay = calculateBackoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        queueMessage(chatId, content, messageId);
        showErrorToast('Failed to send message', {
          onRetry: () => retryMessage(messageId),
        });
        return false;
      }
    }

    return false;
  }, [isOnline, opts, sendMessage, queueMessage]);

  const retryMessage = useCallback(async (messageId: string): Promise<boolean> => {
    const message = pendingMessages.find(m => m.id === messageId);
    if (!message) return false;

    setPendingMessages(prev => 
      prev.map(m => m.id === messageId ? { ...m, attempts: m.attempts + 1 } : m)
    );

    try {
      const success = await sendMessage(message.chatId, message.content);
      if (success) {
        setPendingMessages(prev => prev.filter(m => m.id !== messageId));
        return true;
      }
      throw new Error('Failed to send message');
    } catch (error) {
      showErrorToast('Still unable to send', {
        onRetry: () => retryMessage(messageId),
      });
      return false;
    }
  }, [pendingMessages, sendMessage]);

  const syncPending = useCallback(async (): Promise<number> => {
    if (!isOnline || pendingMessages.length === 0) return 0;
    
    setIsSyncing(true);
    let syncedCount = 0;

    for (const message of pendingMessages) {
      if (!navigator.onLine) break;

      try {
        const success = await sendMessage(message.chatId, message.content);
        if (success) {
          setPendingMessages(prev => prev.filter(m => m.id !== message.id));
          syncedCount++;
        }
      } catch (error) {
        continue;
      }
    }

    setIsSyncing(false);
    return syncedCount;
  }, [isOnline, pendingMessages, sendMessage]);

  const clearPending = useCallback(() => {
    setPendingMessages([]);
  }, []);

  return {
    sendWithRetry,
    retryMessage,
    syncPending,
    clearPending,
    pendingMessages,
    pendingCount: pendingMessages.length,
    isSyncing,
    isOnline,
  };
}
