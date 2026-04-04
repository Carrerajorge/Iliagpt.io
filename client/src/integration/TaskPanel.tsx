/**
 * TaskPanel.tsx
 *
 * Floating bottom-right panel that shows active background tasks.
 * Persists across navigation because it is mounted at layout level.
 *
 * States:
 *  collapsed → pill button with running-task badge
 *  expanded  → full panel with task list, progress bars, cancel buttons
 *
 * Features:
 *  - Sonner toast on task completion / failure
 *  - Auto-expands when a new task is added (3 s then auto-collapses if untouched)
 *  - Spring physics expand/collapse via framer-motion
 *  - "Clear completed" footer button
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  ChevronDown,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  StopCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAgenticChatContext } from './AgenticChatProvider';
import type { BackgroundTask } from '@/hooks/useBackgroundTasks';

// ─── Task status helpers ──────────────────────────────────────────────────────

function isRunningStatus(status: BackgroundTask['status']): boolean {
  return status === 'running' || status === 'pending' || status === 'queued';
}

function isTerminalStatus(status: BackgroundTask['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function statusLabel(status: BackgroundTask['status']): string {
  switch (status) {
    case 'running': return 'Running';
    case 'pending': return 'Pending';
    case 'queued': return 'Queued';
    case 'completed': return 'Done';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
}

function StatusIcon({ status }: { status: BackgroundTask['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    case 'cancelled':
      return <StopCircle className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-amber-500" />;
  }
}

function StatusBadge({ status }: { status: BackgroundTask['status'] }) {
  const variantMap: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    cancelled: 'bg-muted text-muted-foreground',
    running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    queued: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
        variantMap[status] ?? variantMap.pending
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

// ─── TaskRow ─────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: BackgroundTask;
  onCancel?: (taskId: string) => void;
  highlighted?: boolean;
}

function TaskRow({ task, onCancel, highlighted }: TaskRowProps) {
  const progress = task.progress ?? (task.status === 'completed' ? 100 : undefined);
  const canCancel = isRunningStatus(task.status) && onCancel;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'flex flex-col gap-1.5 px-3 py-2.5 border-b border-border/60 last:border-0 transition-colors',
        highlighted && 'bg-blue-50/60 dark:bg-blue-950/30'
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 min-w-0">
        <StatusIcon status={task.status} />
        <span className="flex-1 text-xs font-medium truncate text-foreground">
          {task.label ?? task.id}
        </span>
        <StatusBadge status={task.status} />
        {canCancel && (
          <button
            type="button"
            onClick={() => onCancel(task.id)}
            className="ml-1 p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Cancel task"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Progress bar */}
      {progress !== undefined && (
        <Progress
          value={progress}
          className={cn(
            'h-1',
            task.status === 'failed' && '[&>div]:bg-red-500',
            task.status === 'completed' && '[&>div]:bg-emerald-500'
          )}
        />
      )}

      {/* Error message */}
      {task.error && (
        <p className="text-[10px] text-red-600 dark:text-red-400 leading-snug truncate">
          {task.error}
        </p>
      )}
    </motion.div>
  );
}

// ─── TaskPanel ────────────────────────────────────────────────────────────────

export function TaskPanel() {
  const {
    backgroundTasks,
    taskCount,
    runningTaskCount,
    taskPanelOpen,
    setTaskPanelOpen,
  } = useAgenticChatContext();

  // Track which tasks have been toasted already
  const toastedRef = useRef<Set<string>>(new Set());
  // Track previously known task IDs to detect additions
  const prevTaskIdsRef = useRef<Set<string>>(new Set());
  // Recently added task id for highlight effect
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  // Whether the user has interacted with the panel since auto-open
  const userInteractedRef = useRef(false);
  const autoCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel handler (tasks may expose a cancel fn — use cancelTask if available)
  const handleCancelTask = useCallback(
    (taskId: string) => {
      const task = backgroundTasks.find((t) => t.id === taskId);
      if (task && typeof (task as { cancel?: () => void }).cancel === 'function') {
        (task as { cancel: () => void }).cancel();
      }
    },
    [backgroundTasks]
  );

  // Clear completed tasks
  const completedTasks = backgroundTasks.filter((t) => isTerminalStatus(t.status));
  const handleClearCompleted = useCallback(() => {
    // Tasks are managed externally; we just emit an event or call clear if available
    completedTasks.forEach((t) => {
      const task = t as BackgroundTask & { clear?: () => void };
      if (typeof task.clear === 'function') task.clear();
    });
  }, [completedTasks]);

  // Toast on task completion / failure
  useEffect(() => {
    backgroundTasks.forEach((task) => {
      if (toastedRef.current.has(task.id)) return;

      if (task.status === 'completed') {
        toastedRef.current.add(task.id);
        toast.success(`Task complete: ${task.label ?? task.id}`, {
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
          duration: 4000,
        });
      } else if (task.status === 'failed') {
        toastedRef.current.add(task.id);
        toast.error(`Task failed: ${task.label ?? task.id}`, {
          description: task.error ?? undefined,
          icon: <XCircle className="w-4 h-4 text-red-500" />,
          duration: 5000,
        });
      }
    });
  }, [backgroundTasks]);

  // Auto-expand when a new task is added
  useEffect(() => {
    const currentIds = new Set(backgroundTasks.map((t) => t.id));
    const newIds = [...currentIds].filter((id) => !prevTaskIdsRef.current.has(id));

    if (newIds.length > 0) {
      const newId = newIds[0];
      setHighlightedTaskId(newId);
      userInteractedRef.current = false;
      setTaskPanelOpen(true);

      // Auto-collapse after 3 s if user hasn't interacted
      if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = setTimeout(() => {
        if (!userInteractedRef.current) {
          setTaskPanelOpen(false);
        }
        setHighlightedTaskId(null);
      }, 3000);
    }

    prevTaskIdsRef.current = currentIds;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundTasks.length]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current);
    };
  }, []);

  const handleToggle = useCallback(() => {
    userInteractedRef.current = true;
    setTaskPanelOpen(!taskPanelOpen);
  }, [taskPanelOpen, setTaskPanelOpen]);

  const handleClose = useCallback(() => {
    userInteractedRef.current = true;
    setTaskPanelOpen(false);
  }, [setTaskPanelOpen]);

  const isAnyRunning = runningTaskCount > 0;

  // Don't render at all if no tasks
  if (taskCount === 0 && !taskPanelOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      <AnimatePresence mode="wait">
        {taskPanelOpen ? (
          /* ── Expanded panel ─────────────────────────────────────────── */
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="w-80 rounded-xl border border-border bg-background/95 backdrop-blur-sm shadow-xl overflow-hidden"
            onPointerDown={() => { userInteractedRef.current = true; }}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-muted/30">
              <Activity className={cn('w-4 h-4', isAnyRunning && 'text-blue-500')} />
              <span className="text-sm font-semibold flex-1">Tasks</span>
              {taskCount > 0 && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  {taskCount}
                </Badge>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Minimize task panel"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {/* Task list */}
            <ScrollArea className="max-h-72">
              <AnimatePresence initial={false}>
                {backgroundTasks.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No tasks yet
                  </div>
                ) : (
                  backgroundTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onCancel={handleCancelTask}
                      highlighted={task.id === highlightedTaskId}
                    />
                  ))
                )}
              </AnimatePresence>
            </ScrollArea>

            {/* Footer */}
            {completedTasks.length > 0 && (
              <div className="border-t border-border px-3 py-2 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 text-muted-foreground hover:text-foreground"
                  onClick={handleClearCompleted}
                >
                  Clear completed ({completedTasks.length})
                </Button>
              </div>
            )}
          </motion.div>
        ) : (
          /* ── Collapsed pill ─────────────────────────────────────────── */
          <motion.button
            key="pill"
            type="button"
            onClick={handleToggle}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className={cn(
              'relative flex items-center gap-2 px-3 py-2 rounded-full',
              'border border-border bg-background/95 backdrop-blur-sm shadow-lg',
              'hover:shadow-xl transition-shadow text-sm font-medium',
              isAnyRunning && 'border-blue-300 dark:border-blue-700'
            )}
          >
            {isAnyRunning ? (
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            ) : (
              <Activity className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-xs font-semibold">
              {isAnyRunning ? `${runningTaskCount} running` : `${taskCount} task${taskCount !== 1 ? 's' : ''}`}
            </span>

            {/* Pulsing dot when tasks running */}
            {isAnyRunning && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
