import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Bot,
  Code2,
  Search,
  FileText,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Square,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useBackgroundTasks } from '@/hooks/useBackgroundTasks';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
type TaskType = 'agent' | 'code' | 'search' | 'file' | string;

interface BackgroundTask {
  id: string;
  type: TaskType;
  label: string;
  status: TaskStatus;
  progress?: number; // 0–100
  message?: string;
  createdAt: number;
  updatedAt?: number;
}

interface TaskManagerProps {
  chatId: string;
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  return `${Math.floor(diff / 86_400_000)} day ago`;
}

const TASK_TYPE_ICONS: Record<string, React.ElementType> = {
  agent: Bot,
  code: Code2,
  search: Search,
  file: FileText,
};

function TaskTypeIcon({ type }: { type: string }) {
  const Icon = TASK_TYPE_ICONS[type] ?? Activity;
  return <Icon className="h-3.5 w-3.5" />;
}

// ─── Status Styles ────────────────────────────────────────────────────────────

const STATUS_BADGE_CLASS: Record<TaskStatus, string> = {
  queued: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
  running: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  completed: 'bg-green-500/15 text-green-400 border-green-500/20',
  failed: 'bg-destructive/15 text-destructive border-destructive/20',
  cancelled: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge
      variant="secondary"
      className={cn('text-[10px] px-1.5 py-0 h-4 font-normal', STATUS_BADGE_CLASS[status])}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}

// ─── Task Type Badge ──────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal gap-1">
      <TaskTypeIcon type={type} />
      {label}
    </Badge>
  );
}

// ─── Status Icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'running') {
    return <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />;
  }
  if (status === 'completed') {
    return <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />;
  }
  if (status === 'failed') {
    return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
  }
  if (status === 'queued') {
    return <Clock className="h-4 w-4 text-zinc-400 shrink-0" />;
  }
  if (status === 'cancelled') {
    return <Square className="h-4 w-4 text-yellow-400 shrink-0 fill-yellow-400" />;
  }
  return null;
}

// ─── Task Card ────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: BackgroundTask;
  onCancel?: (id: string) => void;
  onRemove?: (id: string) => void;
}

function TaskCard({ task, onCancel, onRemove }: TaskCardProps) {
  const isTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
  const showProgress = task.status === 'running' && task.progress !== undefined;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.18 }}
      className="rounded-lg border border-border/60 bg-card/60 px-3 py-3 space-y-2"
    >
      {/* Top row */}
      <div className="flex items-start gap-2">
        <StatusIcon status={task.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate leading-tight">{task.label}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <TypeBadge type={task.type} />
            <StatusBadge status={task.status} />
            <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
              {relativeTime(task.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Progress */}
      {showProgress && (
        <Progress
          value={task.progress}
          className="h-1 bg-blue-950"
        />
      )}

      {/* Message */}
      {task.message && (
        <p className="text-xs text-muted-foreground pl-6 leading-relaxed truncate">
          {task.message}
        </p>
      )}

      {/* Action Buttons */}
      <div className="flex gap-1.5 pl-6">
        {task.status === 'running' && onCancel && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onCancel(task.id)}
            className="h-6 px-2 text-xs gap-1"
          >
            <Square className="h-2.5 w-2.5 fill-current" />
            Cancel
          </Button>
        )}
        {isTerminal && onRemove && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRemove(task.id)}
            className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </Button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
      <Activity className="h-8 w-8 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── TaskManager ──────────────────────────────────────────────────────────────

export function TaskManager({
  chatId,
  isOpen,
  onClose,
  className,
}: TaskManagerProps) {
  const { tasks, cancelTask, removeTask, clearCompleted } = useBackgroundTasks(chatId);
  const [tab, setTab] = useState<string>('all');

  const runningCount = useMemo(
    () => tasks.filter((t: BackgroundTask) => t.status === 'running').length,
    [tasks],
  );

  const filteredTasks = useMemo<BackgroundTask[]>(() => {
    if (tab === 'all') return tasks;
    if (tab === 'running') return tasks.filter((t: BackgroundTask) => t.status === 'running' || t.status === 'queued');
    if (tab === 'completed') return tasks.filter((t: BackgroundTask) => t.status === 'completed');
    if (tab === 'failed') return tasks.filter((t: BackgroundTask) => t.status === 'failed' || t.status === 'cancelled');
    return tasks;
  }, [tasks, tab]);

  const hasCompleted = useMemo(
    () => tasks.some((t: BackgroundTask) => t.status === 'completed'),
    [tasks],
  );

  const EMPTY_MESSAGES: Record<string, string> = {
    all: 'No background tasks',
    running: 'No tasks running',
    completed: 'No completed tasks',
    failed: 'No failed tasks',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.8 }}
            className={cn(
              'fixed right-0 top-0 bottom-0 z-50 w-80 bg-background border-l border-border shadow-2xl flex flex-col',
              className,
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
              <h2 className="text-sm font-semibold flex-1">Background Tasks</h2>
              {runningCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-xs bg-blue-500/15 text-blue-400 border-blue-500/20 tabular-nums"
                >
                  {runningCount} running
                </Badge>
              )}
              {tasks.length > 0 && runningCount === 0 && (
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {tasks.length}
                </Badge>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                className="h-7 w-7"
                aria-label="Close task manager"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Tabs */}
            <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="grid grid-cols-4 mx-3 mt-3 shrink-0 h-8">
                <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                <TabsTrigger value="running" className="text-xs">Running</TabsTrigger>
                <TabsTrigger value="completed" className="text-xs">Done</TabsTrigger>
                <TabsTrigger value="failed" className="text-xs">Failed</TabsTrigger>
              </TabsList>

              {(['all', 'running', 'completed', 'failed'] as const).map((tabId) => (
                <TabsContent
                  key={tabId}
                  value={tabId}
                  className="flex-1 min-h-0 mt-0 data-[state=active]:flex flex-col"
                >
                  <ScrollArea className="flex-1 px-3 pt-3">
                    {filteredTasks.length === 0 ? (
                      <EmptyState label={EMPTY_MESSAGES[tabId]} />
                    ) : (
                      <div className="space-y-2 pb-4">
                        <AnimatePresence initial={false}>
                          {filteredTasks.map((task: BackgroundTask) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              onCancel={cancelTask}
                              onRemove={removeTask}
                            />
                          ))}
                        </AnimatePresence>
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>
              ))}
            </Tabs>

            {/* Footer */}
            <AnimatePresence>
              {hasCompleted && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-t px-3 py-2 shrink-0"
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearCompleted}
                    className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground w-full justify-center"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear completed
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
