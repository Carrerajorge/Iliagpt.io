import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, WifiOff, ChevronDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useTerminal } from '@/hooks/useTerminal';

// ─── Types ────────────────────────────────────────────────────────────────────

type LineType = 'input' | 'output' | 'error' | 'system';
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface TerminalLine {
  id: string;
  type: LineType;
  text: string;
  createdAt: number;
}

interface TerminalEmulatorProps {
  sessionId?: string;
  className?: string;
  height?: number;
  onCommand?: (command: string) => void;
  readOnly?: boolean;
}

// ─── ANSI Renderer ────────────────────────────────────────────────────────────

const ANSI_COLOR_CLASS: Record<string, string> = {
  '30': 'text-zinc-500',
  '31': 'text-red-400',
  '32': 'text-green-400',
  '33': 'text-yellow-400',
  '34': 'text-blue-400',
  '35': 'text-purple-400',
  '36': 'text-cyan-400',
  '37': 'text-zinc-200',
  '0': 'text-zinc-200',
  '1': 'font-bold',
};

interface AnsiSpan {
  text: string;
  classes: string[];
}

function parseAnsi(raw: string): AnsiSpan[] {
  const regex = /\x1b\[([0-9;]*)m/g;
  const spans: AnsiSpan[] = [];
  let activeClasses: string[] = ['text-zinc-200'];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: raw.slice(lastIndex, match.index), classes: [...activeClasses] });
    }

    const codes = match[1].split(';');
    const newColors: string[] = [];
    const newBold: string[] = [];

    for (const code of codes) {
      const cls = ANSI_COLOR_CLASS[code];
      if (!cls) continue;
      if (cls === 'font-bold') newBold.push(cls);
      else newColors.push(cls);
    }

    if (newColors.length > 0 || newBold.length > 0) {
      activeClasses = [
        ...(newColors.length ? newColors : ['text-zinc-200']),
        ...newBold,
      ];
    } else {
      activeClasses = ['text-zinc-200'];
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < raw.length) {
    spans.push({ text: raw.slice(lastIndex), classes: [...activeClasses] });
  }

  return spans;
}

function renderAnsi(text: string): React.ReactNode {
  const spans = parseAnsi(text);
  if (spans.length === 0) return text;
  return (
    <>
      {spans.map((span, i) => (
        <span key={i} className={cn(span.classes)}>
          {span.text}
        </span>
      ))}
    </>
  );
}

// ─── Line Styles ──────────────────────────────────────────────────────────────

const LINE_CLASS: Record<LineType, string> = {
  input: 'text-green-300',
  output: 'text-zinc-200',
  error: 'text-red-400',
  system: 'text-zinc-500 italic',
};

// ─── Connection Badge ─────────────────────────────────────────────────────────

function ConnectionBadge({
  status,
  onReconnect,
}: {
  status: ConnectionStatus;
  onReconnect?: () => void;
}) {
  if (status === 'connecting') {
    return (
      <Badge
        variant="secondary"
        className="text-[10px] gap-1 bg-yellow-500/15 text-yellow-400 border-yellow-500/20"
      >
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Connecting
      </Badge>
    );
  }
  if (status === 'connected') {
    return (
      <Badge
        variant="secondary"
        className="text-[10px] gap-1 bg-green-500/15 text-green-400 border-green-500/20"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-green-400 inline-block" />
        Connected
      </Badge>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Badge
        variant="secondary"
        className="text-[10px] gap-1 bg-zinc-500/15 text-zinc-400 border-zinc-500/20"
      >
        <WifiOff className="h-2.5 w-2.5" />
        Disconnected
      </Badge>
      {onReconnect && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onReconnect}
          className="h-5 px-1.5 text-[10px] text-zinc-400 hover:text-zinc-200"
        >
          Reconnect
        </Button>
      )}
    </div>
  );
}

// ─── macOS Window Dots ────────────────────────────────────────────────────────

function WindowDots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      <span className="h-3 w-3 rounded-full bg-red-500/80" />
      <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
      <span className="h-3 w-3 rounded-full bg-green-500/80" />
    </div>
  );
}

// ─── Terminal Line Row ────────────────────────────────────────────────────────

interface TerminalLineRowProps {
  line: TerminalLine;
  lineNumber: number;
  showLineNumbers: boolean;
}

function TerminalLineRow({ line, lineNumber, showLineNumbers }: TerminalLineRowProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 font-mono text-xs leading-5 whitespace-pre-wrap break-all',
        LINE_CLASS[line.type],
      )}
    >
      {showLineNumbers && (
        <span className="select-none text-zinc-600 w-6 text-right shrink-0 tabular-nums">
          {lineNumber}
        </span>
      )}
      <span className="shrink-0 select-none">{line.type === 'input' ? '$ ' : '  '}</span>
      <span className="flex-1 min-w-0 break-words">
        {line.type === 'output' || line.type === 'error' ? renderAnsi(line.text) : line.text}
      </span>
    </div>
  );
}

// ─── TerminalEmulator ─────────────────────────────────────────────────────────

export function TerminalEmulator({
  sessionId,
  className,
  height = 400,
  onCommand,
  readOnly = false,
}: TerminalEmulatorProps) {
  const { session, sendCommand, sendRaw, clear, navigateHistory, reconnect } =
    useTerminal({ sessionId });

  const [inputValue, setInputValue] = useState('');
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef(0);

  const connectionStatus: ConnectionStatus =
    (session?.status as ConnectionStatus) ?? 'disconnected';

  // Cap lines at 1000
  const rawLines: TerminalLine[] = (session?.lines ?? []).map((line) => ({
    id: line.id,
    type: line.type,
    text: line.content,
    createdAt: line.timestamp,
  }));
  const lines: TerminalLine[] =
    rawLines.length > 1000 ? rawLines.slice(rawLines.length - 1000) : rawLines;

  // Auto-scroll
  useEffect(() => {
    if (shouldAutoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      setShowScrollBtn(false);
    }
  }, [lines, shouldAutoScroll]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    const goingUp = el.scrollTop < lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;

    if (goingUp && !atBottom) {
      setShouldAutoScroll(false);
      setShowScrollBtn(true);
    } else if (atBottom) {
      setShouldAutoScroll(true);
      setShowScrollBtn(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    setShouldAutoScroll(true);
    setShowScrollBtn(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = inputValue.trim();
        if (cmd) {
          sendCommand(cmd);
          onCommand?.(cmd);
          setInputValue('');
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = navigateHistory('up');
        if (prev !== undefined) setInputValue(prev);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = navigateHistory('down');
        if (next !== undefined) setInputValue(next);
      } else if (e.key === 'c' && e.ctrlKey) {
        e.preventDefault();
        sendRaw('\x03');
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        clear();
      }
    },
    [inputValue, sendCommand, navigateHistory, sendRaw, clear, onCommand],
  );

  const focusInput = useCallback(() => {
    if (!readOnly) inputRef.current?.focus();
  }, [readOnly]);

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl',
        className,
      )}
      style={{ height }}
      onClick={focusInput}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <WindowDots />
        <span className="text-xs font-medium text-zinc-400 flex-1 font-mono">Terminal</span>
        <ConnectionBadge
          status={connectionStatus}
          onReconnect={connectionStatus === 'disconnected' ? reconnect : undefined}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            clear();
          }}
          className="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
          aria-label="Clear terminal"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Output */}
      <div className="flex-1 relative overflow-hidden">
        <div
          ref={outputRef}
          className="h-full overflow-y-auto px-3 py-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
          onScroll={handleScroll}
        >
          {connectionStatus === 'connecting' && lines.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 italic font-mono py-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Connecting to terminal session…
            </div>
          )}

          {connectionStatus === 'disconnected' && lines.length === 0 && (
            <p className="text-xs text-zinc-600 italic font-mono py-2">
              — Session disconnected —
            </p>
          )}

          <div className="space-y-0.5">
            {lines.map((line, idx) => (
              <TerminalLineRow
                key={line.id}
                line={line}
                lineNumber={idx + 1}
                showLineNumbers={false}
              />
            ))}
          </div>

          <div ref={bottomRef} />
        </div>

        {/* Scroll-to-bottom button */}
        <AnimatePresence>
          {showScrollBtn && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-2 right-3"
            >
              <Button
                size="sm"
                variant="secondary"
                onClick={scrollToBottom}
                className="h-7 px-2 text-xs gap-1 bg-zinc-800/90 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Scroll down
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Input Row */}
      {!readOnly && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-t border-zinc-800 bg-zinc-900/60 shrink-0">
          <span className="font-mono text-xs text-green-300 select-none shrink-0">$</span>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={connectionStatus !== 'connected'}
            placeholder={connectionStatus === 'connected' ? '' : 'Not connected'}
            className={cn(
              'flex-1 bg-transparent font-mono text-xs text-green-300 outline-none caret-green-400',
              'placeholder:text-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed',
            )}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Terminal input"
          />
        </div>
      )}
    </div>
  );
}
