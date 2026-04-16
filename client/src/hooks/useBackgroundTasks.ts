/**
 * useBackgroundTasks.ts
 *
 * Background task management with real-time WebSocket updates,
 * exponential-backoff reconnection, and REST-based cancellation.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundTask {
  id: string;
  type: string;
  label: string;
  status: TaskStatus;
  progress: number; // 0–100
  message?: string;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
  estimatedMs?: number;
}

// ---------------------------------------------------------------------------
// WebSocket message shapes (narrow union for type-safe dispatch)
// ---------------------------------------------------------------------------

interface WsTaskUpdate {
  type: 'task_update';
  task: BackgroundTask;
}

interface WsTaskComplete {
  type: 'task_complete';
  taskId: string;
  result: unknown;
}

interface WsTaskError {
  type: 'task_error';
  taskId: string;
  error: string;
}

type WsMessage = WsTaskUpdate | WsTaskComplete | WsTaskError;

function isWsMessage(val: unknown): val is WsMessage {
  if (val === null || typeof val !== 'object') return false;
  const obj = val as Record<string, unknown>;
  return (
    obj['type'] === 'task_update' ||
    obj['type'] === 'task_complete' ||
    obj['type'] === 'task_error'
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_BACKOFF_FACTOR = 2;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBackgroundTasks(chatId: string): {
  tasks: BackgroundTask[];
  runningCount: number;
  hasFailures: boolean;
  addTask: (task: Omit<BackgroundTask, 'createdAt' | 'updatedAt'>) => void;
  updateTask: (id: string, updates: Partial<BackgroundTask>) => void;
  cancelTask: (id: string) => Promise<void>;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
  getTask: (id: string) => BackgroundTask | undefined;
} {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef<number>(INITIAL_RECONNECT_DELAY_MS);
  const mountedRef = useRef(true);
  // Keep latest tasks in a ref so WS callbacks don't capture stale state
  const tasksRef = useRef<BackgroundTask[]>([]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // -------------------------------------------------------------------------
  // Task mutations
  // -------------------------------------------------------------------------

  const addTask = useCallback(
    (task: Omit<BackgroundTask, 'createdAt' | 'updatedAt'>): void => {
      const now = Date.now();
      const full: BackgroundTask = { ...task, createdAt: now, updatedAt: now };
      setTasks((prev) => {
        // Prevent duplicates
        if (prev.some((t) => t.id === full.id)) {
          return prev.map((t) => (t.id === full.id ? { ...t, ...full } : t));
        }
        return [...prev, full];
      });
    },
    []
  );

  const updateTask = useCallback(
    (id: string, updates: Partial<BackgroundTask>): void => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t
        )
      );
    },
    []
  );

  const removeTask = useCallback((id: string): void => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearCompleted = useCallback((): void => {
    setTasks((prev) =>
      prev.filter(
        (t) =>
          t.status !== 'completed' &&
          t.status !== 'failed' &&
          t.status !== 'cancelled'
      )
    );
  }, []);

  const getTask = useCallback(
    (id: string): BackgroundTask | undefined => {
      return tasksRef.current.find((t) => t.id === id);
    },
    []
  );

  const cancelTask = useCallback(
    async (id: string): Promise<void> => {
      try {
        const res = await fetch(`/api/agent/tasks/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const msg = await res.text().catch(() => res.statusText);
          throw new Error(`Cancel failed (${res.status}): ${msg}`);
        }
        updateTask(id, { status: 'cancelled' });
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        // Surface the error to callers — update task to reflect failure to cancel
        updateTask(id, {
          message: `Cancel failed: ${error.message}`,
        });
        throw error;
      }
    },
    [updateTask]
  );

  // -------------------------------------------------------------------------
  // WebSocket message dispatch
  // -------------------------------------------------------------------------

  const handleWsMessage = useCallback(
    (raw: string): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      if (!isWsMessage(parsed)) return;

      switch (parsed.type) {
        case 'task_update':
          setTasks((prev) => {
            const exists = prev.some((t) => t.id === parsed.task.id);
            if (exists) {
              return prev.map((t) =>
                t.id === parsed.task.id
                  ? { ...t, ...parsed.task, updatedAt: Date.now() }
                  : t
              );
            }
            return [...prev, { ...parsed.task, updatedAt: Date.now() }];
          });
          break;

        case 'task_complete':
          setTasks((prev) =>
            prev.map((t) =>
              t.id === parsed.taskId
                ? {
                    ...t,
                    status: 'completed' as TaskStatus,
                    progress: 100,
                    result: parsed.result,
                    updatedAt: Date.now(),
                  }
                : t
            )
          );
          break;

        case 'task_error':
          setTasks((prev) =>
            prev.map((t) =>
              t.id === parsed.taskId
                ? {
                    ...t,
                    status: 'failed' as TaskStatus,
                    error: parsed.error,
                    updatedAt: Date.now(),
                  }
                : t
            )
          );
          break;
      }
    },
    []
  );

  // -------------------------------------------------------------------------
  // WebSocket lifecycle with exponential backoff
  // -------------------------------------------------------------------------

  const connectWs = useCallback((): void => {
    if (!mountedRef.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;
    const url = `${protocol}://${host}/api/agent/ws?chatId=${encodeURIComponent(chatId)}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      // Reset backoff on successful connection
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
    };

    ws.onmessage = (ev: MessageEvent<unknown>) => {
      if (typeof ev.data === 'string') {
        handleWsMessage(ev.data);
      }
    };

    ws.onclose = () => {
      if (mountedRef.current) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose, so reconnect is handled there
      ws.close();
    };
  }, [chatId, handleWsMessage]);

  function scheduleReconnect(): void {
    if (!mountedRef.current) return;
    if (reconnectTimerRef.current !== null) return; // already scheduled

    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(
      delay * RECONNECT_BACKOFF_FACTOR,
      MAX_RECONNECT_DELAY_MS
    );

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connectWs();
    }, delay);
  }

  useEffect(() => {
    mountedRef.current = true;
    connectWs();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connectWs]);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const runningCount = tasks.filter(
    (t) => t.status === 'running' || t.status === 'queued'
  ).length;

  const hasFailures = tasks.some((t) => t.status === 'failed');

  return {
    tasks,
    runningCount,
    hasFailures,
    addTask,
    updateTask,
    cancelTask,
    removeTask,
    clearCompleted,
    getTask,
  };
}
