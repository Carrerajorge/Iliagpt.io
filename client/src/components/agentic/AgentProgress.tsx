import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  Check,
  X,
  Minus,
  Loader2,
  Terminal,
  FileText,
  Search,
  Globe,
  Code2,
  LayoutTemplate,
  ImageIcon,
  Mail,
  Database,
  Zap,
  Clock,
  ChevronDown,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

interface AgentStep {
  id: string;
  index: number;
  toolName: string;
  description?: string;
  status: AgentStepStatus;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
  output?: unknown;
  isParallel?: boolean;
}

interface AgentProgressProps {
  steps: AgentStep[];
  currentStepIndex?: number;
  isRunning: boolean;
  startedAt?: number;
  estimatedTotalMs?: number;
  onStepClick?: (step: AgentStep) => void;
  className?: string;
  compact?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  bash: 'Running shell command',
  execute_code: 'Executing code',
  python: 'Running Python',
  read_file: 'Reading file',
  write_file: 'Writing file',
  edit_file: 'Editing file',
  web_search: 'Searching the web',
  fetch_url: 'Fetching URL',
  browse: 'Browsing website',
  create_presentation: 'Creating presentation',
  create_document: 'Creating document',
  image_generation: 'Generating image',
  send_email: 'Sending email',
  query_database: 'Querying database',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}

function getToolIcon(toolName: string): React.ElementType {
  switch (toolName) {
    case 'bash':
    case 'execute_code':
      return Terminal;
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'create_document':
      return FileText;
    case 'web_search':
      return Search;
    case 'fetch_url':
    case 'browse':
      return Globe;
    case 'python':
      return Code2;
    case 'create_presentation':
      return LayoutTemplate;
    case 'image_generation':
      return ImageIcon;
    case 'send_email':
      return Mail;
    case 'query_database':
      return Database;
    default:
      return Zap;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatElapsed(startedAt: number, now: number): string {
  return formatDuration(now - startedAt);
}

function formatOutputPreview(output: unknown): string {
  if (output === null || output === undefined) return '(no output)';
  if (typeof output === 'string') return output.slice(0, 200);
  try {
    const str = JSON.stringify(output, null, 2);
    return str.slice(0, 200) + (str.length > 200 ? '\n…' : '');
  } catch {
    return String(output).slice(0, 200);
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StatusIconProps {
  status: AgentStepStatus;
  toolName: string;
  compact: boolean;
}

function StatusIcon({ status, toolName, compact }: StatusIconProps) {
  const ToolIcon = getToolIcon(toolName);
  const size = compact ? 'w-6 h-6' : 'w-8 h-8';
  const iconSize = compact ? 12 : 14;

  const baseClasses = cn(
    'relative flex items-center justify-center rounded-full flex-shrink-0 z-10',
    size,
  );

  if (status === 'running') {
    return (
      <motion.div
        className={cn(baseClasses, 'bg-blue-600 shadow-[0_0_12px_rgba(59,130,246,0.4)]')}
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
      >
        <Loader2
          size={iconSize}
          className="text-white animate-spin"
        />
      </motion.div>
    );
  }

  if (status === 'succeeded') {
    return (
      <div className={cn(baseClasses, 'bg-green-600')}>
        <Check size={iconSize} className="text-white" strokeWidth={2.5} />
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className={cn(baseClasses, 'bg-red-600')}>
        <X size={iconSize} className="text-white" strokeWidth={2.5} />
      </div>
    );
  }

  if (status === 'skipped') {
    return (
      <div className={cn(baseClasses, 'bg-zinc-600')}>
        <Minus size={iconSize} className="text-white" strokeWidth={2.5} />
      </div>
    );
  }

  // pending
  return (
    <div className={cn(baseClasses, 'border-2 border-zinc-600 bg-zinc-900')}>
      <ToolIcon size={iconSize} className="text-zinc-500" />
    </div>
  );
}

interface ConnectorLineProps {
  status: AgentStepStatus;
  isLast: boolean;
  compact: boolean;
}

function ConnectorLine({ status, isLast, compact }: ConnectorLineProps) {
  if (isLast) return null;
  const colorClass =
    status === 'succeeded'
      ? 'bg-green-600'
      : status === 'failed'
        ? 'bg-red-600'
        : status === 'running'
          ? 'bg-blue-600'
          : 'bg-zinc-700';

  const height = compact ? 'h-4' : 'h-5';

  return (
    <div className={cn('w-px mx-auto', height, colorClass)} />
  );
}

interface StepItemProps {
  step: AgentStep;
  isLast: boolean;
  isCurrent: boolean;
  compact: boolean;
  expandedStepId: string | null;
  onToggleExpand: (id: string) => void;
  onStepClick?: (step: AgentStep) => void;
  animationDelay: number;
}

function StepItem({
  step,
  isLast,
  isCurrent,
  compact,
  expandedStepId,
  onToggleExpand,
  onStepClick,
  animationDelay,
}: StepItemProps) {
  const isExpanded = expandedStepId === step.id;
  const isClickable = !!onStepClick || (step.status === 'succeeded' && step.output !== undefined && !compact);
  const hasOutput = step.output !== undefined && step.output !== null;

  const handleClick = () => {
    if (onStepClick) onStepClick(step);
    if (!compact && hasOutput && step.status === 'succeeded') {
      onToggleExpand(step.id);
    }
  };

  const duration =
    step.durationMs != null
      ? step.durationMs
      : step.startedAt != null && step.completedAt != null
        ? step.completedAt - step.startedAt
        : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: animationDelay }}
      className="relative"
    >
      {/* Parallel group indicator */}
      {step.isParallel && !compact && (
        <div className="absolute -left-3 top-0 bottom-0 w-0.5 bg-violet-500/40 rounded-full" />
      )}

      <div
        className={cn(
          'flex gap-3 rounded-lg transition-colors duration-150',
          compact ? 'px-2 py-1.5' : 'px-3 py-2.5',
          isCurrent && 'bg-blue-950/30 border-l-2 border-blue-500',
          !isCurrent && 'border-l-2 border-transparent',
          isClickable && 'cursor-pointer hover:bg-zinc-800/50',
        )}
        onClick={isClickable ? handleClick : undefined}
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onKeyDown={
          isClickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') handleClick();
              }
            : undefined
        }
      >
        {/* Left: icon + connector */}
        <div className="flex flex-col items-center flex-shrink-0" style={{ width: compact ? 24 : 32 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={step.status}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.18 }}
            >
              <StatusIcon status={step.status} toolName={step.toolName} compact={compact} />
            </motion.div>
          </AnimatePresence>
          <ConnectorLine status={step.status} isLast={isLast} compact={compact} />
        </div>

        {/* Right: content */}
        <div className="flex-1 min-w-0 pt-0.5">
          {compact ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-200 truncate">
                {getToolLabel(step.toolName)}
              </span>
              {step.status === 'running' && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-zinc-100">
                  {getToolLabel(step.toolName)}
                </span>
                {duration != null && step.status !== 'running' && (
                  <Badge
                    variant="secondary"
                    className="text-xs px-1.5 py-0 h-5 bg-zinc-800 text-zinc-400 border-zinc-700"
                  >
                    {formatDuration(duration)}
                  </Badge>
                )}
                {step.isParallel && (
                  <Badge
                    variant="secondary"
                    className="text-xs px-1.5 py-0 h-5 bg-violet-900/50 text-violet-300 border-violet-700"
                  >
                    parallel
                  </Badge>
                )}
                {hasOutput && step.status === 'succeeded' && (
                  <ChevronDown
                    size={14}
                    className={cn(
                      'text-zinc-500 transition-transform duration-200 ml-auto flex-shrink-0',
                      isExpanded && 'rotate-180',
                    )}
                  />
                )}
              </div>

              {step.description && (
                <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{step.description}</p>
              )}

              {step.status === 'failed' && step.error && (
                <p className="text-xs text-red-400 mt-1 font-mono leading-relaxed">{step.error}</p>
              )}

              {/* Expanded output */}
              <AnimatePresence>
                {isExpanded && hasOutput && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <pre
                      className="mt-2 p-2 rounded bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-300 max-h-[150px] overflow-y-auto leading-relaxed whitespace-pre-wrap break-all"
                    >
                      {formatOutputPreview(step.output)}
                    </pre>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AgentProgress({
  steps,
  currentStepIndex,
  isRunning,
  startedAt,
  estimatedTotalMs,
  onStepClick,
  className,
  compact = false,
}: AgentProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);

  // Live clock tick
  useEffect(() => {
    if (!isRunning && !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning, startedAt]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedStepId((prev) => (prev === id ? null : id));
  }, []);

  // ── Derived values ──────────────────────────────────────────────────────────

  const totalSteps = steps.length;
  const completedSteps = steps.filter(
    (s) => s.status === 'succeeded' || s.status === 'skipped',
  ).length;
  const failedSteps = steps.filter((s) => s.status === 'failed').length;
  const allDone = !isRunning && totalSteps > 0;

  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const elapsedMs = startedAt ? now - startedAt : null;

  // Estimate remaining time
  const estimatedRemainingMs = (() => {
    if (estimatedTotalMs != null && elapsedMs != null) {
      const rem = estimatedTotalMs - elapsedMs;
      return rem > 0 ? rem : 0;
    }
    // Compute from average completed step duration
    const durations = steps
      .filter((s) => s.durationMs != null)
      .map((s) => s.durationMs as number);
    if (durations.length === 0) return null;
    const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
    const remainingSteps = totalSteps - completedSteps - failedSteps;
    return remainingSteps > 0 ? avgMs * remainingSteps : 0;
  })();

  // Summary state
  const summaryState: 'success' | 'failed' | 'mixed' | null = (() => {
    if (!allDone || totalSteps === 0) return null;
    if (failedSteps === 0) return 'success';
    if (failedSteps === totalSteps) return 'failed';
    return 'mixed';
  })();

  const firstFailedStep = steps.find((s) => s.status === 'failed');

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (totalSteps === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-3 py-12 text-zinc-500',
          className,
        )}
      >
        <Zap size={32} className="opacity-40" />
        <p className="text-sm">Agent hasn't started yet</p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* ── Overall progress header ── */}
      {!compact && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-medium">
              Step {Math.min(completedSteps + (isRunning ? 1 : 0), totalSteps)} of {totalSteps}
              <span className="ml-1.5 text-zinc-500">({progressPct}%)</span>
            </span>
            <div className="flex items-center gap-3">
              {elapsedMs != null && (
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  Elapsed: {formatElapsed(startedAt!, now)}
                </span>
              )}
              {estimatedRemainingMs != null && estimatedRemainingMs > 0 && isRunning && (
                <span className="text-zinc-500">~{formatDuration(estimatedRemainingMs)} left</span>
              )}
            </div>
          </div>
          <Progress value={progressPct} className="h-1.5 bg-zinc-800" />
        </div>
      )}

      {/* compact header */}
      {compact && (
        <div className="flex items-center gap-2 px-2">
          <Progress value={progressPct} className="h-1 flex-1 bg-zinc-800" />
          <span className="text-xs text-zinc-500 flex-shrink-0">
            {completedSteps}/{totalSteps}
          </span>
        </div>
      )}

      {/* ── Timeline ── */}
      <ScrollArea className={cn(compact ? 'h-64' : 'h-[500px]')}>
        <div className={cn('flex flex-col', compact ? 'gap-0' : 'gap-0 pr-3')}>
          {steps.map((step, idx) => (
            <StepItem
              key={step.id}
              step={step}
              isLast={idx === steps.length - 1}
              isCurrent={
                currentStepIndex != null
                  ? step.index === currentStepIndex
                  : step.status === 'running'
              }
              compact={compact}
              expandedStepId={expandedStepId}
              onToggleExpand={handleToggleExpand}
              onStepClick={onStepClick}
              animationDelay={idx * 0.04}
            />
          ))}
        </div>
      </ScrollArea>

      {/* ── Summary footer ── */}
      <AnimatePresence>
        {summaryState != null && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.25 }}
            className={cn(
              'rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-2',
              summaryState === 'success' && 'bg-green-950/50 border border-green-800 text-green-400',
              summaryState === 'failed' && 'bg-red-950/50 border border-red-800 text-red-400',
              summaryState === 'mixed' && 'bg-yellow-950/50 border border-yellow-800 text-yellow-400',
            )}
          >
            {summaryState === 'success' && (
              <>
                <Check size={14} strokeWidth={2.5} />
                Completed in{' '}
                {elapsedMs != null ? formatDuration(elapsedMs) : `${completedSteps} steps`}
              </>
            )}
            {summaryState === 'failed' && firstFailedStep && (
              <>
                <X size={14} strokeWidth={2.5} />
                Failed at step {firstFailedStep.index + 1}:{' '}
                {getToolLabel(firstFailedStep.toolName)}
              </>
            )}
            {summaryState === 'mixed' && (
              <>
                <Minus size={14} strokeWidth={2.5} />
                {completedSteps} step{completedSteps !== 1 ? 's' : ''} completed,{' '}
                {failedSteps} failed
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
