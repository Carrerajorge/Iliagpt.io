import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolStatus = 'pending' | 'running' | 'success' | 'failed';

interface ToolExecutionCardProps {
  toolName: string;
  status: ToolStatus;
  duration?: number;  // milliseconds
  result?: unknown;
  error?: string;
  onRetry?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  ToolStatus,
  {
    borderColor: string;
    bgColor: string;
    badgeColor: string;
    badgeBg: string;
    label: string;
  }
> = {
  pending: {
    borderColor: 'border-l-amber-400',
    bgColor:     'bg-amber-50/30 dark:bg-amber-950/20',
    badgeColor:  'text-amber-700 dark:text-amber-300',
    badgeBg:     'bg-amber-100 dark:bg-amber-900/50',
    label:       'Pending',
  },
  running: {
    borderColor: 'border-l-blue-500',
    bgColor:     'bg-blue-50/30 dark:bg-blue-950/20',
    badgeColor:  'text-blue-700 dark:text-blue-300',
    badgeBg:     'bg-blue-100 dark:bg-blue-900/50',
    label:       'Running',
  },
  success: {
    borderColor: 'border-l-emerald-500',
    bgColor:     'bg-emerald-50/30 dark:bg-emerald-950/20',
    badgeColor:  'text-emerald-700 dark:text-emerald-300',
    badgeBg:     'bg-emerald-100 dark:bg-emerald-900/50',
    label:       'Success',
  },
  failed: {
    borderColor: 'border-l-red-500',
    bgColor:     'bg-red-50/30 dark:bg-red-950/20',
    badgeColor:  'text-red-700 dark:text-red-300',
    badgeBg:     'bg-red-100 dark:bg-red-900/50',
    label:       'Failed',
  },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatJson(value: unknown, maxLines = 5): { preview: string; full: string; truncated: boolean } {
  const full = JSON.stringify(value, null, 2);
  const lines = full.split('\n');
  const truncated = lines.length > maxLines;
  const preview = lines.slice(0, maxLines).join('\n') + (truncated ? '\n  …' : '');
  return { preview, full, truncated };
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case 'pending':
      return (
        <Clock
          size={16}
          className="text-amber-500 dark:text-amber-400 flex-shrink-0"
        />
      );
    case 'running':
      return (
        <Loader2
          size={16}
          className="text-blue-500 dark:text-blue-400 flex-shrink-0 animate-spin"
        />
      );
    case 'success':
      return (
        <CheckCircle
          size={16}
          className="text-emerald-500 dark:text-emerald-400 flex-shrink-0"
        />
      );
    case 'failed':
      return (
        <XCircle
          size={16}
          className="text-red-500 dark:text-red-400 flex-shrink-0"
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Result viewer
// ---------------------------------------------------------------------------

function ResultViewer({ result }: { result: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const { preview, full, truncated } = useMemo(() => formatJson(result), [result]);

  return (
    <div className="mt-3">
      <button
        onClick={() => setExpanded((p) => !p)}
        className={cn(
          'flex items-center gap-1.5 text-xs font-medium',
          'text-slate-500 dark:text-slate-400',
          'hover:text-slate-700 dark:hover:text-slate-200 transition-colors',
          'mb-2',
        )}
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {expanded ? 'Hide result' : 'Show result'}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 dark:bg-slate-900">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                  Result JSON
                </span>
              </div>
              <pre className="p-3 bg-slate-900 dark:bg-slate-950 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed max-h-64 overflow-y-auto">
                {expanded && truncated ? full : preview}
              </pre>
              {truncated && !expanded && (
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ToolExecutionCard({
  toolName,
  status,
  duration,
  result,
  error,
  onRetry,
  className,
}: ToolExecutionCardProps) {
  const config = STATUS_CONFIG[status];
  const hasResult = result !== undefined && result !== null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
      className={cn(
        'relative rounded-xl border border-l-4',
        'border-slate-200 dark:border-slate-700',
        config.borderColor,
        config.bgColor,
        'p-4',
        'transition-colors duration-200',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <StatusIcon status={status} />

          {/* Tool icon */}
          <div className="flex-shrink-0 w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <Wrench size={12} className="text-slate-500 dark:text-slate-400" />
          </div>

          {/* Tool name */}
          <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate font-mono">
            {toolName}
          </span>
        </div>

        {/* Right side badges */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Duration badge */}
          {duration !== undefined && (
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
              {formatDuration(duration)}
            </span>
          )}

          {/* Status badge */}
          <span
            className={cn(
              'text-[11px] font-semibold px-2 py-0.5 rounded-full',
              config.badgeColor,
              config.badgeBg,
            )}
          >
            {config.label}
          </span>
        </div>
      </div>

      {/* Running pulse indicator */}
      {status === 'running' && (
        <div className="mt-3 h-1 rounded-full bg-blue-100 dark:bg-blue-900/40 overflow-hidden">
          <motion.div
            className="h-full bg-blue-500 dark:bg-blue-400 rounded-full"
            animate={{ x: ['-100%', '200%'] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            style={{ width: '40%' }}
          />
        </div>
      )}

      {/* Error message */}
      {status === 'failed' && error && (
        <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
          <p className="text-xs text-red-700 dark:text-red-300 font-medium mb-1">Error</p>
          <p className="text-xs text-red-600 dark:text-red-400 font-mono break-all leading-relaxed">
            {error}
          </p>

          {onRetry && (
            <button
              onClick={onRetry}
              className={cn(
                'mt-2 flex items-center gap-1.5 text-xs font-medium',
                'text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200',
                'transition-colors',
              )}
            >
              <RefreshCw size={11} />
              Retry
            </button>
          )}
        </div>
      )}

      {/* Result JSON viewer */}
      {status === 'success' && hasResult && (
        <ResultViewer result={result} />
      )}
    </motion.div>
  );
}

export default ToolExecutionCard;
