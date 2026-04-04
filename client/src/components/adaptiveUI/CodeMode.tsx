/**
 * CodeMode.tsx
 * Split-pane layout with chat on the left and a code preview area on the right.
 */

import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Code2,
  Terminal,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Maximize2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CodeModePanelProps {
  chatId: string;
  children: React.ReactNode;
}

interface CodeBlock {
  language: string;
  code: string;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: 'text-blue-400 bg-blue-400/10',
  javascript: 'text-yellow-400 bg-yellow-400/10',
  python: 'text-green-400 bg-green-400/10',
  rust: 'text-orange-400 bg-orange-400/10',
  go: 'text-cyan-400 bg-cyan-400/10',
  java: 'text-red-400 bg-red-400/10',
  css: 'text-pink-400 bg-pink-400/10',
  html: 'text-amber-400 bg-amber-400/10',
  sql: 'text-purple-400 bg-purple-400/10',
  bash: 'text-emerald-400 bg-emerald-400/10',
  shell: 'text-emerald-400 bg-emerald-400/10',
  default: 'text-slate-400 bg-slate-400/10',
};

function getLanguageColor(lang: string): string {
  return LANGUAGE_COLORS[lang.toLowerCase()] ?? LANGUAGE_COLORS.default;
}

/** Simple syntax tokenizer using regex — no external library */
function tokenize(code: string, language: string): React.ReactNode[] {
  const lines = code.split('\n');

  const KEYWORD_SETS: Record<string, string[]> = {
    typescript: ['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'import', 'export', 'from', 'return', 'if', 'else', 'for', 'while', 'async', 'await', 'new', 'typeof', 'extends', 'implements', 'void', 'null', 'undefined', 'true', 'false'],
    javascript: ['const', 'let', 'var', 'function', 'class', 'import', 'export', 'from', 'return', 'if', 'else', 'for', 'while', 'async', 'await', 'new', 'typeof', 'true', 'false', 'null', 'undefined'],
    python: ['def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for', 'while', 'with', 'as', 'try', 'except', 'finally', 'pass', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'lambda'],
  };

  const keywords = new Set(KEYWORD_SETS[language.toLowerCase()] ?? KEYWORD_SETS.typescript);

  return lines.map((line, lineIdx) => {
    const tokens: React.ReactNode[] = [];
    const tokenRegex = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*|\/\*[\s\S]*?\*\/|#.*|\b\w+\b|[^\w\s]|\s+)/g;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(line)) !== null) {
      const token = match[0];
      const idx = match.index;

      if (/^["'`]/.test(token)) {
        tokens.push(<span key={idx} className="text-amber-300">{token}</span>);
      } else if (/^(\/\/|#)/.test(token) || /^\/\*/.test(token)) {
        tokens.push(<span key={idx} className="text-slate-500 italic">{token}</span>);
      } else if (keywords.has(token)) {
        tokens.push(<span key={idx} className="text-purple-400 font-medium">{token}</span>);
      } else if (/^\d+(\.\d+)?$/.test(token)) {
        tokens.push(<span key={idx} className="text-cyan-300">{token}</span>);
      } else if (/^[A-Z][a-zA-Z0-9]*$/.test(token)) {
        tokens.push(<span key={idx} className="text-blue-300">{token}</span>);
      } else if (/^[(){}[\];,.<>!=+\-*/&|^~%?:]/.test(token)) {
        tokens.push(<span key={idx} className="text-slate-400">{token}</span>);
      } else {
        tokens.push(<span key={idx}>{token}</span>);
      }
    }

    return (
      <div key={lineIdx} className="table-row">
        <span className="table-cell select-none pr-4 text-right text-slate-600 text-xs w-8">
          {lineIdx + 1}
        </span>
        <span className="table-cell">{tokens}</span>
      </div>
    );
  });
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_CODE = `import { useState, useEffect } from 'react';

interface User {
  id: string;
  name: string;
  email: string;
}

async function fetchUser(id: string): Promise<User> {
  const res = await fetch('/api/users/' + id);
  if (!res.ok) throw new Error('HTTP error: ' + res.status);
  return res.json();
}

export function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUser(userId)
      .then(setUser)
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>User not found</div>;

  return (
    <div className="profile">
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}`;

const TERMINAL_OUTPUT = `$ npm run dev
> ilia-gpt@1.0.0 dev
> vite --host

  VITE v5.0.0  ready in 312 ms

  Local:   http://localhost:5173/
  Network: http://192.168.1.100:5173/
  press h to show help
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-white/50 hover:text-white/80 hover:bg-white/8 transition-all"
      aria-label="Copy code"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

// ─── Code Panel ───────────────────────────────────────────────────────────────

interface CodePanelProps {
  codeBlock: CodeBlock;
  isTerminalOpen: boolean;
  onToggleTerminal: () => void;
}

function CodePanel({ codeBlock, isTerminalOpen, onToggleTerminal }: CodePanelProps) {
  const langColor = getLanguageColor(codeBlock.language);

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 flex-shrink-0">
        <Code2 className="w-4 h-4 text-white/40" />
        <span className="text-xs text-white/50 flex-1">code-preview.ts</span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${langColor}`}>
          {codeBlock.language || 'plaintext'}
        </span>
        <CopyButton text={codeBlock.code} />
        <button
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/40 hover:text-white/70 hover:bg-white/8 transition-all"
          aria-label="Open in editor"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Open</span>
        </button>
        <button
          className="p-1.5 rounded text-white/40 hover:text-white/70 hover:bg-white/8 transition-all"
          aria-label="Maximize"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Code area */}
      <div className="flex-1 overflow-auto p-4 font-mono text-sm text-slate-300 leading-relaxed">
        <div className="table w-full">
          {tokenize(codeBlock.code, codeBlock.language)}
        </div>
      </div>

      {/* Terminal section */}
      <div className="flex-shrink-0 border-t border-white/8">
        <button
          onClick={onToggleTerminal}
          className="flex items-center gap-2 w-full px-4 py-2 text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
          aria-expanded={isTerminalOpen}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Terminal</span>
          <span className="flex-1" />
          {isTerminalOpen ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5" />
          )}
        </button>

        <AnimatePresence>
          {isTerminalOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 140, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden bg-[#080808] border-t border-white/5"
            >
              <div className="p-3 font-mono text-xs text-emerald-400 leading-relaxed overflow-auto h-full">
                <pre className="whitespace-pre-wrap">{TERMINAL_OUTPUT}</pre>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Drag Handle ─────────────────────────────────────────────────────────────

function DragHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const isDragging = useRef(false);
  const startX = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      startX.current = e.clientX;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = ev.clientX - startX.current;
        startX.current = ev.clientX;
        onDrag(delta);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [onDrag]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-1 flex-shrink-0 bg-white/5 hover:bg-blue-500/50 cursor-col-resize transition-colors relative"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CodeMode({ chatId: _chatId, children }: CodeModePanelProps) {
  const [chatWidthPct, setChatWidthPct] = useState(40);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDrag = useCallback((delta: number) => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.offsetWidth;
    const deltaPct = (delta / containerWidth) * 100;
    setChatWidthPct((prev) => Math.min(65, Math.max(25, prev + deltaPct)));
  }, []);

  const codeBlock: CodeBlock = {
    language: 'typescript',
    code: DEMO_CODE,
  };

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      {/* Chat panel */}
      <div
        className="flex flex-col overflow-hidden flex-shrink-0"
        style={{ width: `${chatWidthPct}%` }}
      >
        {children}
      </div>

      <DragHandle onDrag={handleDrag} />

      {/* Code panel slides in */}
      <motion.div
        className="flex-1 overflow-hidden"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <CodePanel
          codeBlock={codeBlock}
          isTerminalOpen={isTerminalOpen}
          onToggleTerminal={() => setIsTerminalOpen((v) => !v)}
        />
      </motion.div>
    </div>
  );
}
