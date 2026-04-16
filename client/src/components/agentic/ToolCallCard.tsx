import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal,
  FileText,
  Search,
  Globe,
  Code2,
  Wrench,
  ImageIcon,
  Presentation,
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type ToolCallStatus = 'pending' | 'running' | 'success' | 'error';

interface ToolCall {
  id: string;
  index: number;
  toolName: string;
  args: Record<string, unknown>;
  argsDelta: string;
  status: ToolCallStatus;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
}

interface ToolCallCardProps {
  toolCall: ToolCall;
  onRetry?: (toolCall: ToolCall) => void;
  className?: string;
  defaultExpanded?: boolean;
}

// ─── Tool Icon Map ────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, LucideIcon> = {
  bash: Terminal,
  execute_code: Terminal,
  python: Code2,
  read_file: FileText,
  write_file: FileText,
  edit_file: FileText,
  web_search: Search,
  fetch_url: Globe,
  browse: Globe,
  create_presentation: Presentation,
  create_document: FileText,
  image_generation: ImageIcon,
  default: Wrench,
};

function getToolIcon(toolName: string): LucideIcon {
  const lower = toolName.toLowerCase();
  for (const [key, icon] of Object.entries(TOOL_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return TOOL_ICONS.default;
}

// ─── Status Helpers ───────────────────────────────────────────────────────────

const STATUS_BORDER: Record<ToolCallStatus, string> = {
  pending: 'border-l-muted-foreground/30',
  running: 'border-l-blue-500',
  success: 'border-l-green-500',
  error: 'border-l-destructive',
};

const STATUS_LABEL: Record<ToolCallStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  success: 'Done',
  error: 'Error',
};

function StatusBadge({ status }: { status: ToolCallStatus }) {
  if (status === 'running') {
    return (
      <Badge
        variant="secondary"
        className="gap-1 text-xs bg-blue-500/15 text-blue-400 border-blue-500/30"
      >
        <motion.span
          className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
        Running
      </Badge>
    );
  }
  if (status === 'success') {
    return (
      <Badge variant="secondary" className="text-xs bg-green-500/15 text-green-400 border-green-500/30">
        Done
      </Badge>
    );
  }
  if (status === 'error') {
    return <Badge variant="destructive" className="text-xs">{STATUS_LABEL[status]}</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">{STATUS_LABEL[status]}</Badge>;
}

// ─── Duration Format ──────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleCopy}
      className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span
            key="check"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex items-center gap-1"
          >
            <Check className="h-3 w-3 text-green-400" />
            Copied
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex items-center gap-1"
          >
            <Copy className="h-3 w-3" />
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  );
}

// ─── Result Display ───────────────────────────────────────────────────────────

function ResultDisplay({ result, error }: { result?: unknown; error?: string }) {
  if (error) {
    return (
      <pre className="rounded bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive overflow-auto max-h-60 whitespace-pre-wrap font-mono">
        {error}
      </pre>
    );
  }

  if (result === undefined || result === null) return null;

  if (typeof result === 'string') {
    return (
      <pre className="rounded bg-zinc-900/80 border border-border/40 p-3 text-xs text-zinc-200 overflow-auto max-h-60 whitespace-pre-wrap font-mono leading-relaxed">
        {result}
      </pre>
    );
  }

  return (
    <div className="rounded overflow-hidden border border-border/40 text-xs max-h-60 overflow-y-auto">
      <SyntaxHighlighter
        language="json"
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.7rem', padding: '0.75rem' }}
      >
        {JSON.stringify(result, null, 2)}
      </SyntaxHighlighter>
    </div>
  );
}

// ─── ToolCallCard ─────────────────────────────────────────────────────────────

export function ToolCallCard({
  toolCall,
  onRetry,
  className,
  defaultExpanded = false,
}: ToolCallCardProps) {
  const [isOpen, setIsOpen] = useState(defaultExpanded);
  const ToolIcon = getToolIcon(toolCall.toolName);
  const isComplete = toolCall.status === 'success' || toolCall.status === 'error';
  const argsJson = JSON.stringify(toolCall.args, null, 2);
  const resultStr =
    toolCall.result !== undefined
      ? typeof toolCall.result === 'string'
        ? toolCall.result
        : JSON.stringify(toolCall.result, null, 2)
      : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn('relative', className)}
    >
      {/* Running glow animation */}
      <AnimatePresence>
        {toolCall.status === 'running' && (
          <motion.div
            key="running-glow"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.8, repeat: Infinity }}
            className="absolute inset-0 rounded-lg bg-blue-500/5 pointer-events-none z-0"
          />
        )}
      </AnimatePresence>

      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div
          className={cn(
            'relative z-10 rounded-lg border border-border/60 border-l-[3px] bg-card/80 backdrop-blur-sm overflow-hidden',
            STATUS_BORDER[toolCall.status],
          )}
        >
          {/* Header */}
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left">
              {/* Tool Icon */}
              <ToolIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

              {/* Tool Name */}
              <span className="flex-1 text-xs font-mono font-medium text-foreground truncate">
                {toolCall.toolName}
              </span>

              {/* Status Badge */}
              <StatusBadge status={toolCall.status} />

              {/* Duration */}
              {isComplete && toolCall.durationMs !== undefined && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDuration(toolCall.durationMs)}
                </div>
              )}

              {/* Expand toggle */}
              <AnimatePresence mode="wait" initial={false}>
                {isOpen ? (
                  <motion.span
                    key="down"
                    initial={{ rotate: -90 }}
                    animate={{ rotate: 0 }}
                    exit={{ rotate: -90 }}
                    transition={{ duration: 0.15 }}
                  >
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </motion.span>
                ) : (
                  <motion.span
                    key="right"
                    initial={{ rotate: 90 }}
                    animate={{ rotate: 0 }}
                    exit={{ rotate: 90 }}
                    transition={{ duration: 0.15 }}
                  >
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="border-t border-border/40 px-3 py-3 space-y-3">
              {/* Args Section */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                  Arguments
                </p>
                <div className="rounded overflow-hidden border border-border/40 text-xs max-h-52 overflow-y-auto">
                  <SyntaxHighlighter
                    language="json"
                    style={oneDark}
                    customStyle={{
                      margin: 0,
                      borderRadius: 0,
                      fontSize: '0.7rem',
                      padding: '0.75rem',
                    }}
                  >
                    {argsJson}
                  </SyntaxHighlighter>
                </div>
              </div>

              {/* Result Section */}
              {isComplete && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">
                    Result
                  </p>
                  <ResultDisplay result={toolCall.result} error={toolCall.error} />
                </div>
              )}

              {/* Footer Actions */}
              <div className="flex items-center gap-1 pt-0.5">
                <CopyButton text={argsJson} label="Copy args" />

                {isComplete && resultStr && (
                  <CopyButton text={resultStr} label="Copy result" />
                )}

                {onRetry && toolCall.status === 'error' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRetry(toolCall)}
                    className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground ml-auto"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </Button>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </motion.div>
  );
}
