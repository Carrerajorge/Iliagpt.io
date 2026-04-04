import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Copy,
  Check,
  Download,
  ChevronDown,
  ChevronRight,
  FileText,
  ImageIcon,
  BarChart2,
  Database,
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CodeArtifact {
  id: string;
  name: string;
  type: 'file' | 'image' | 'plot' | 'data';
  url?: string;
  data?: string; // base64
  mimeType?: string;
  sizeBytes?: number;
}

interface CodeExecutionResult {
  id: string;
  code: string;
  language: string;
  status: 'running' | 'success' | 'error' | 'timeout';
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
  artifacts?: CodeArtifact[];
  memoryUsedMb?: number;
}

interface CodeExecutionViewProps {
  execution: CodeExecutionResult;
  onCopy?: () => void;
  onDownload?: (artifact: CodeArtifact) => void;
  className?: string;
  defaultTab?: 'output' | 'code' | 'artifacts';
}

// ─── Duration Format ──────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Status Header Elements ───────────────────────────────────────────────────

type ExecStatus = CodeExecutionResult['status'];

const STATUS_BADGE_CLASS: Record<ExecStatus, string> = {
  running: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  success: 'bg-green-500/15 text-green-400 border-green-500/20',
  error: 'bg-destructive/15 text-destructive border-destructive/20',
  timeout: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
};

function StatusIcon({ status }: { status: ExecStatus }) {
  if (status === 'running') {
    return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />;
  }
  if (status === 'success') {
    return (
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 350, damping: 20 }}
      >
        <CheckCircle2 className="h-4 w-4 text-green-400" />
      </motion.div>
    );
  }
  if (status === 'error') {
    return (
      <motion.div
        animate={{ x: [0, -3, 3, -3, 3, 0] }}
        transition={{ duration: 0.4 }}
      >
        <XCircle className="h-4 w-4 text-destructive" />
      </motion.div>
    );
  }
  return <Clock className="h-4 w-4 text-yellow-400" />;
}

function StatusBadge({ status }: { status: ExecStatus }) {
  const labels: Record<ExecStatus, string> = {
    running: 'Running',
    success: 'Success',
    error: 'Error',
    timeout: 'Timeout',
  };
  return (
    <Badge
      variant="secondary"
      className={cn('text-xs font-normal', STATUS_BADGE_CLASS[status])}
    >
      {labels[status]}
    </Badge>
  );
}

// ─── Exit Code Badge ──────────────────────────────────────────────────────────

function ExitCodeBadge({ exitCode }: { exitCode: number | null | undefined }) {
  if (exitCode === undefined || exitCode === null) return null;
  const isOk = exitCode === 0;
  return (
    <Badge
      variant="secondary"
      className={cn(
        'text-[10px] font-mono',
        isOk
          ? 'bg-green-500/15 text-green-400 border-green-500/20'
          : 'bg-destructive/15 text-destructive border-destructive/20',
      )}
    >
      exit {exitCode}
    </Badge>
  );
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
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
      className={cn('h-7 px-2 gap-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60', className)}
      aria-label="Copy code"
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span key="check" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }} className="flex items-center gap-1">
            <Check className="h-3 w-3 text-green-400" />
            Copied
          </motion.span>
        ) : (
          <motion.span key="copy" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }} className="flex items-center gap-1">
            <Copy className="h-3 w-3" />
            Copy
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  );
}

// ─── Image Modal ──────────────────────────────────────────────────────────────

function ImageModal({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.img
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          src={src}
          alt={alt}
          className="max-w-full max-h-full rounded-lg shadow-2xl object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Artifact Card ────────────────────────────────────────────────────────────

interface ArtifactCardProps {
  artifact: CodeArtifact;
  onDownload?: (artifact: CodeArtifact) => void;
}

function ArtifactCard({ artifact, onDownload }: ArtifactCardProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const imgSrc = artifact.data
    ? `data:${artifact.mimeType ?? 'image/png'};base64,${artifact.data}`
    : artifact.url;

  if (artifact.type === 'image' || artifact.type === 'plot') {
    return (
      <>
        <div className="rounded-lg border border-border/50 overflow-hidden bg-zinc-900/60 group">
          <button
            className="w-full relative overflow-hidden"
            onClick={() => setLightboxOpen(true)}
            aria-label={`View ${artifact.name}`}
          >
            {imgSrc && (
              <img
                src={imgSrc}
                alt={artifact.name}
                className="w-full h-40 object-contain bg-zinc-950 hover:opacity-90 transition-opacity"
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
              <span className="text-xs text-white font-medium">Click to enlarge</span>
            </div>
          </button>
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border/40">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="flex-1 text-xs text-muted-foreground truncate">{artifact.name}</span>
            {onDownload && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDownload(artifact)}
                className="h-6 px-1.5 text-xs gap-1 text-muted-foreground hover:text-foreground"
              >
                <Download className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {lightboxOpen && imgSrc && (
          <ImageModal src={imgSrc} alt={artifact.name} onClose={() => setLightboxOpen(false)} />
        )}
      </>
    );
  }

  if (artifact.type === 'data') {
    let parsed: unknown = artifact.data;
    try {
      if (artifact.data) parsed = JSON.parse(artifact.data);
    } catch {
      // not JSON
    }

    return (
      <div className="rounded-lg border border-border/50 overflow-hidden bg-zinc-900/60">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
          <Database className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1 text-xs text-muted-foreground truncate">{artifact.name}</span>
          {artifact.sizeBytes && (
            <span className="text-[10px] text-muted-foreground">{formatBytes(artifact.sizeBytes)}</span>
          )}
        </div>
        <div className="max-h-40 overflow-auto text-xs">
          <SyntaxHighlighter
            language="json"
            style={oneDark}
            customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.7rem', padding: '0.75rem' }}
          >
            {typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  }

  // file
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-zinc-900/60 px-3 py-2.5">
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{artifact.name}</p>
        {artifact.sizeBytes !== undefined && (
          <p className="text-[10px] text-muted-foreground">{formatBytes(artifact.sizeBytes)}</p>
        )}
      </div>
      {onDownload && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDownload(artifact)}
          className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      )}
    </div>
  );
}

// ─── Code Tab ─────────────────────────────────────────────────────────────────

function CodeTab({ code, language, onCopy }: { code: string; language: string; onCopy?: () => void }) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    onCopy?.();
  }, [code, onCopy]);

  return (
    <div className="relative">
      <div className="absolute top-2 right-2 z-10">
        <CopyButton text={code} />
      </div>
      <div className="overflow-auto max-h-96 rounded-md text-xs">
        <SyntaxHighlighter
          language={language || 'text'}
          style={oneDark}
          showLineNumbers
          customStyle={{ margin: 0, borderRadius: '0.375rem', fontSize: '0.7rem', padding: '1rem' }}
          lineNumberStyle={{ color: '#4b5563', minWidth: '2.5em' }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

// ─── Output Tab ───────────────────────────────────────────────────────────────

function OutputTab({
  status,
  stdout,
  stderr,
  exitCode,
  memoryUsedMb,
}: {
  status: ExecStatus;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  memoryUsedMb?: number;
}) {
  const hasStderr = !!stderr?.trim();
  const [outputSub, setOutputSub] = useState<'stdout' | 'stderr'>('stdout');

  if (status === 'running') {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Executing…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Meta badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <ExitCodeBadge exitCode={exitCode} />
        {memoryUsedMb !== undefined && (
          <Badge variant="secondary" className="text-[10px] font-mono">
            {memoryUsedMb.toFixed(1)} MB
          </Badge>
        )}
      </div>

      {/* Sub-tabs if stderr exists */}
      {hasStderr ? (
        <div>
          <div className="flex gap-0 border-b border-border mb-0">
            <button
              onClick={() => setOutputSub('stdout')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
                outputSub === 'stdout'
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              stdout
            </button>
            <button
              onClick={() => setOutputSub('stderr')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
                outputSub === 'stderr'
                  ? 'border-destructive text-destructive'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              stderr
            </button>
          </div>
          <div className="mt-2">
            {outputSub === 'stdout' ? (
              <pre className="rounded-md bg-zinc-950 border border-border/40 p-3 text-xs text-green-300 font-mono overflow-auto max-h-60 whitespace-pre-wrap leading-relaxed">
                {stdout || '(no output)'}
              </pre>
            ) : (
              <pre className="rounded-md bg-zinc-950 border border-destructive/20 p-3 text-xs text-red-400 font-mono overflow-auto max-h-60 whitespace-pre-wrap leading-relaxed">
                {stderr}
              </pre>
            )}
          </div>
        </div>
      ) : (
        <pre className="rounded-md bg-zinc-950 border border-border/40 p-3 text-xs text-green-300 font-mono overflow-auto max-h-60 whitespace-pre-wrap leading-relaxed">
          {stdout || '(no output)'}
        </pre>
      )}
    </div>
  );
}

// ─── CodeExecutionView ────────────────────────────────────────────────────────

export function CodeExecutionView({
  execution,
  onCopy,
  onDownload,
  className,
  defaultTab = 'output',
}: CodeExecutionViewProps) {
  const [isOpen, setIsOpen] = useState(true);
  const hasArtifacts = (execution.artifacts?.length ?? 0) > 0;

  const collapsedSummary = (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <StatusIcon status={execution.status} />
      <span className="font-mono">{execution.language}</span>
      <StatusBadge status={execution.status} />
      {execution.durationMs !== undefined && execution.status !== 'running' && (
        <span className="text-muted-foreground">{formatDuration(execution.durationMs)}</span>
      )}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn('rounded-xl border border-border/60 overflow-hidden bg-card/80', className)}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Header */}
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-900/60 hover:bg-zinc-900/80 transition-colors text-left border-b border-border/40">
            <div className="flex-1 flex items-center gap-2 flex-wrap">
              {/* Language Badge */}
              <Badge variant="outline" className="text-xs font-mono font-normal">
                {execution.language || 'code'}
              </Badge>

              {/* Status */}
              <StatusIcon status={execution.status} />
              <StatusBadge status={execution.status} />

              {/* Duration */}
              {execution.durationMs !== undefined && execution.status !== 'running' && (
                <Badge variant="secondary" className="text-[10px] font-mono gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {formatDuration(execution.durationMs)}
                </Badge>
              )}

              {/* Memory */}
              {execution.memoryUsedMb !== undefined && (
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {execution.memoryUsedMb.toFixed(1)} MB
                </Badge>
              )}
            </div>

            {/* Toggle chevron */}
            <AnimatePresence mode="wait" initial={false}>
              {isOpen ? (
                <motion.span key="down" initial={{ rotate: -90 }} animate={{ rotate: 0 }} exit={{ rotate: -90 }} transition={{ duration: 0.15 }}>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </motion.span>
              ) : (
                <motion.span key="right" initial={{ rotate: 90 }} animate={{ rotate: 0 }} exit={{ rotate: 90 }} transition={{ duration: 0.15 }}>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-4">
            <Tabs defaultValue={defaultTab}>
              <TabsList className="h-8 mb-4">
                <TabsTrigger value="code" className="text-xs">Code</TabsTrigger>
                <TabsTrigger value="output" className="text-xs">Output</TabsTrigger>
                {hasArtifacts && (
                  <TabsTrigger value="artifacts" className="text-xs gap-1">
                    Artifacts
                    <Badge variant="secondary" className="text-[10px] h-4 px-1">
                      {execution.artifacts!.length}
                    </Badge>
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="code" className="mt-0">
                <CodeTab
                  code={execution.code}
                  language={execution.language}
                  onCopy={onCopy}
                />
              </TabsContent>

              <TabsContent value="output" className="mt-0">
                <OutputTab
                  status={execution.status}
                  stdout={execution.stdout}
                  stderr={execution.stderr}
                  exitCode={execution.exitCode}
                  memoryUsedMb={execution.memoryUsedMb}
                />
              </TabsContent>

              {hasArtifacts && (
                <TabsContent value="artifacts" className="mt-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {execution.artifacts!.map((artifact) => (
                      <ArtifactCard
                        key={artifact.id}
                        artifact={artifact}
                        onDownload={onDownload}
                      />
                    ))}
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Collapsed summary (visible only when closed) */}
      {!isOpen && (
        <div className="px-4 py-2 bg-zinc-900/20 border-t border-border/20">
          {collapsedSummary}
        </div>
      )}
    </motion.div>
  );
}
