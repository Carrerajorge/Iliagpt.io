import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Pause,
  Play,
  Square,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Brain,
  Zap,
  AlertCircle,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentStatus = 'idle' | 'thinking' | 'acting' | 'complete' | 'error';

interface AgentStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  timestamp?: string;
}

interface AgentStatusPanelProps {
  agentId: string;
  taskName: string;
  status: AgentStatus;
  model: string;
  tokensIn: number;
  tokensOut: number;
  steps: AgentStep[];
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Model pricing ($/M tokens) – approximate
// ---------------------------------------------------------------------------

const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':     { input: 15,    output: 75    },
  'claude-sonnet-4-6':   { input: 3,     output: 15    },
  'claude-haiku-4-5':    { input: 0.8,   output: 4     },
  'gpt-4o':              { input: 2.5,   output: 10    },
  'gpt-4o-mini':         { input: 0.15,  output: 0.6   },
  'gemini-1.5-pro':      { input: 1.25,  output: 5     },
  'gemini-1.5-flash':    { input: 0.075, output: 0.3   },
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = MODEL_PRICES[model] ?? { input: 3, output: 15 };
  return (tokensIn / 1_000_000) * pricing.input +
         (tokensOut / 1_000_000) * pricing.output;
}

function formatCost(usd: number): string {
  if (usd < 0.001) return '<$0.001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1)    return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

function getProviderInfo(model: string): { emoji: string; name: string } {
  if (model.startsWith('claude'))  return { emoji: '🤖', name: 'Anthropic' };
  if (model.startsWith('gpt'))     return { emoji: '🟢', name: 'OpenAI'    };
  if (model.startsWith('gemini'))  return { emoji: '🔷', name: 'Google'    };
  return { emoji: '⚡', name: 'Unknown' };
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  AgentStatus,
  { label: string; color: string; bg: string; headerGradient: string }
> = {
  idle:     {
    label: 'Idle',
    color: 'text-slate-500',
    bg:    'bg-slate-100 dark:bg-slate-800',
    headerGradient: 'from-slate-700 to-slate-900',
  },
  thinking: {
    label: 'Thinking…',
    color: 'text-violet-600 dark:text-violet-400',
    bg:    'bg-violet-100 dark:bg-violet-900/40',
    headerGradient: 'from-violet-900 via-indigo-900 to-slate-900',
  },
  acting:   {
    label: 'Acting',
    color: 'text-blue-600 dark:text-blue-400',
    bg:    'bg-blue-100 dark:bg-blue-900/40',
    headerGradient: 'from-blue-900 via-indigo-900 to-slate-900',
  },
  complete: {
    label: 'Complete',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg:    'bg-emerald-100 dark:bg-emerald-900/40',
    headerGradient: 'from-emerald-900 via-teal-900 to-slate-900',
  },
  error:    {
    label: 'Error',
    color: 'text-red-600 dark:text-red-400',
    bg:    'bg-red-100 dark:bg-red-900/40',
    headerGradient: 'from-red-900 via-rose-900 to-slate-900',
  },
};

// ---------------------------------------------------------------------------
// Step icon
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: AgentStep['status'] }) {
  switch (status) {
    case 'done':
      return <CheckCircle size={14} className="text-emerald-500 flex-shrink-0" />;
    case 'failed':
      return <XCircle size={14} className="text-red-500 flex-shrink-0" />;
    case 'running':
      return <Loader2 size={14} className="text-blue-500 flex-shrink-0 animate-spin" />;
    default:
      return <Clock size={14} className="text-slate-400 flex-shrink-0" />;
  }
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

function ProgressBar({ steps }: { steps: AgentStep[] }) {
  const doneCount = steps.filter((s) => s.status === 'done').length;
  const total     = steps.length;
  const pct       = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-slate-400">Progress</span>
        <span className="text-xs font-semibold text-slate-300">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: [0, 0, 0.2, 1] }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentStatusPanel({
  agentId,
  taskName,
  status,
  model,
  tokensIn,
  tokensOut,
  steps,
  onPause,
  onResume,
  onCancel,
  className,
}: AgentStatusPanelProps) {
  const cfg      = STATUS_CONFIG[status];
  const provider = getProviderInfo(model);
  const cost     = useMemo(() => estimateCost(model, tokensIn, tokensOut), [model, tokensIn, tokensOut]);
  const isPaused = status === 'idle';

  return (
    <div
      className={cn(
        'rounded-2xl overflow-hidden',
        'border border-slate-700/50',
        'bg-slate-900 dark:bg-slate-950',
        'shadow-xl',
        className,
      )}
    >
      {/* Gradient header */}
      <div className={cn('bg-gradient-to-r p-4', cfg.headerGradient)}>
        {/* Title row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {/* Pulse indicator */}
              {(status === 'thinking' || status === 'acting') && (
                <motion.div
                  className="relative w-2 h-2 flex-shrink-0"
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                >
                  <span className="absolute inset-0 rounded-full bg-violet-400 opacity-50 animate-ping" />
                  <span className="relative block w-2 h-2 rounded-full bg-violet-400" />
                </motion.div>
              )}
              {status === 'complete' && (
                <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
              )}
              {status === 'error' && (
                <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              )}
              <span className={cn('text-xs font-semibold uppercase tracking-wider', cfg.color)}>
                {cfg.label}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white leading-tight truncate max-w-[240px]">
              {taskName}
            </h3>
            <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
              id: {agentId.slice(0, 12)}…
            </p>
          </div>

          {/* Model badge */}
          <div className="flex-shrink-0 bg-white/10 rounded-lg px-2.5 py-1.5 text-right">
            <div className="text-base leading-none">{provider.emoji}</div>
            <div className="text-[10px] text-slate-300 mt-0.5 font-medium">{provider.name}</div>
            <div className="text-[9px] text-slate-400 font-mono">{model}</div>
          </div>
        </div>

        {/* Progress bar */}
        {steps.length > 0 && (
          <div className="mt-3">
            <ProgressBar steps={steps} />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-4 space-y-4">
        {/* Token / cost stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800/60 rounded-xl p-3 text-center">
            <div className="text-xs text-slate-500 mb-1 flex items-center justify-center gap-1">
              <Activity size={10} />
              In
            </div>
            <div className="text-sm font-semibold text-slate-200">
              {formatTokens(tokensIn)}
            </div>
          </div>
          <div className="bg-slate-800/60 rounded-xl p-3 text-center">
            <div className="text-xs text-slate-500 mb-1 flex items-center justify-center gap-1">
              <Brain size={10} />
              Out
            </div>
            <div className="text-sm font-semibold text-slate-200">
              {formatTokens(tokensOut)}
            </div>
          </div>
          <div className="bg-slate-800/60 rounded-xl p-3 text-center">
            <div className="text-xs text-slate-500 mb-1 flex items-center justify-center gap-1">
              <Zap size={10} />
              Cost
            </div>
            <div className="text-sm font-semibold text-emerald-400">
              {formatCost(cost)}
            </div>
          </div>
        </div>

        {/* Steps timeline */}
        {steps.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Steps
            </h4>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {steps.map((step, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.2 }}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg',
                    'bg-slate-800/40 border border-slate-700/30',
                    step.status === 'running' && 'border-blue-500/30 bg-blue-900/10',
                    step.status === 'done'    && 'border-emerald-500/20 bg-emerald-900/10',
                    step.status === 'failed'  && 'border-red-500/20 bg-red-900/10',
                  )}
                >
                  <StepIcon status={step.status} />
                  <span className={cn(
                    'text-xs flex-1 truncate',
                    step.status === 'done'    && 'text-slate-400 line-through',
                    step.status === 'failed'  && 'text-red-400',
                    step.status === 'running' && 'text-blue-300 font-medium',
                    step.status === 'pending' && 'text-slate-500',
                  )}>
                    {step.name}
                  </span>
                  {step.timestamp && (
                    <span className="text-[10px] text-slate-600 flex-shrink-0 font-mono">
                      {step.timestamp}
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        {(onPause || onResume || onCancel) && (
          <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
            {/* Pause / Resume toggle */}
            {(onPause || onResume) && (
              <button
                onClick={isPaused ? onResume : onPause}
                disabled={status === 'complete' || status === 'error'}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2',
                  'py-2 px-3 rounded-lg text-sm font-medium',
                  'bg-slate-700 hover:bg-slate-600 text-slate-200',
                  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  'border border-slate-600',
                )}
              >
                {isPaused ? (
                  <><Play size={13} /> Resume</>
                ) : (
                  <><Pause size={13} /> Pause</>
                )}
              </button>
            )}

            {/* Cancel */}
            {onCancel && (
              <button
                onClick={onCancel}
                disabled={status === 'complete' || status === 'error'}
                className={cn(
                  'flex items-center justify-center gap-2',
                  'py-2 px-3 rounded-lg text-sm font-medium',
                  'bg-red-900/30 hover:bg-red-800/50 text-red-300',
                  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  'border border-red-800/30',
                )}
              >
                <Square size={13} /> Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentStatusPanel;
