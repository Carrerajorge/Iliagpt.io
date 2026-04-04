/**
 * CodeMode.tsx
 *
 * Three-panel layout for coding conversations:
 *   Left  — Chat panel (children)
 *   Center — Code editor area (syntax-highlighted textarea)
 *   Right — Terminal output panel
 *
 * Panels are resizable via drag handles; sizes are persisted to localStorage.
 * Individual panels can be collapsed/expanded. Keyboard shortcut Ctrl+` focuses
 * the terminal.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'iliagpt:code-mode-panels';
const MIN_PANEL_PCT = 10; // minimum panel width as % of container

interface PanelSizes {
  chat: number;    // percentage
  editor: number;
  terminal: number;
}

const DEFAULT_SIZES: PanelSizes = { chat: 30, editor: 42, terminal: 28 };

// ─── Persistence helpers ──────────────────────────────────────────────────────

function loadSizes(): PanelSizes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PanelSizes;
      if (parsed.chat && parsed.editor && parsed.terminal) return parsed;
    }
  } catch {/* ignore */}
  return DEFAULT_SIZES;
}

function saveSizes(sizes: PanelSizes): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes)); } catch {/* ignore */}
}

// ─── Syntax-highlight helper (CSS-class-based) ────────────────────────────────

const HIGHLIGHT_MAP: Array<[RegExp, string]> = [
  [/\b(const|let|var|function|class|interface|type|import|export|return|async|await|if|else|for|while|do|switch|case|break|new|typeof|instanceof|extends|implements|from|of|in)\b/g, 'text-purple-400'],
  [/\b(true|false|null|undefined|void|never|any|string|number|boolean|object)\b/g, 'text-orange-400'],
  [/(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)/g, 'text-gray-500 italic'],
  [/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, 'text-green-400'],
  [/\b(\d+\.?\d*)\b/g, 'text-amber-300'],
];

// ─── Panel collapse state ─────────────────────────────────────────────────────

interface CollapseState {
  chat: boolean;
  editor: boolean;
  terminal: boolean;
}

// ─── Drag handle ──────────────────────────────────────────────────────────────

interface DragHandleProps {
  onDrag: (deltaX: number) => void;
}

function DragHandle({ onDrag }: DragHandleProps) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;

    const handleMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onDrag(delta);
    };

    const handleUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-1 mx-0.5 shrink-0 cursor-col-resize group"
      title="Drag to resize"
    >
      <div className="w-full h-full bg-gray-700 group-hover:bg-indigo-500 transition-colors rounded-full" />
    </div>
  );
}

// ─── Editor Panel ─────────────────────────────────────────────────────────────

interface EditorPanelProps {
  collapsed: boolean;
  onToggle: () => void;
}

function EditorPanel({ collapsed, onToggle }: EditorPanelProps) {
  const [code, setCode] = useState(`// Start writing code here\nfunction greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("World"));`);
  const [language, setLanguage] = useState('typescript');
  const [lineCount, setLineCount] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLineCount(code.split('\n').length);
  }, [code]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab → 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
      setCode(newVal);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  const languages = ['typescript', 'javascript', 'python', 'rust', 'go', 'sql'];

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-indigo-400 font-semibold">Editor</span>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded px-1 py-0.5 font-mono"
          >
            {languages.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 font-mono">{lineCount} lines</span>
          <button
            onClick={() => setCode('')}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors px-1"
            title="Clear editor"
          >
            ✕
          </button>
          <button
            onClick={onToggle}
            className="text-xs text-gray-500 hover:text-white transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▶' : '◀'}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-1 overflow-hidden"
          >
            {/* Line numbers */}
            <div className="select-none shrink-0 py-2 px-2 text-right bg-gray-950 border-r border-gray-800 overflow-hidden" style={{ minWidth: '2.5rem' }}>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className="text-xs font-mono text-gray-600 leading-5">
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="flex-1 resize-none bg-gray-950 text-gray-200 font-mono text-xs leading-5 py-2 px-3 outline-none caret-indigo-400 selection:bg-indigo-800"
              style={{ tabSize: 2 }}
              placeholder={`// ${language} code…`}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Terminal Panel ───────────────────────────────────────────────────────────

interface TerminalLine {
  id: number;
  type: 'input' | 'output' | 'error' | 'info';
  text: string;
}

let lineId = 0;

interface TerminalPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  terminalRef: React.RefObject<HTMLDivElement>;
}

function TerminalPanel({ collapsed, onToggle, terminalRef }: TerminalPanelProps) {
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: lineId++, type: 'info', text: '$ terminal ready — Ctrl+` to focus' },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const handleCommand = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    setLines(prev => [...prev, { id: lineId++, type: 'input', text: `$ ${trimmed}` }]);
    setHistory(h => [trimmed, ...h].slice(0, 50));
    setHistoryIdx(-1);

    // Simulate responses
    const responses: Record<string, string[]> = {
      clear: [],
      ls: ['node_modules/', 'src/', 'public/', 'package.json', 'tsconfig.json'],
      pwd: ['/Users/user/project'],
      'npm test': ['> project@1.0.0 test', 'PASS src/__tests__/App.test.ts', 'All tests passed (12ms)'],
      'npm run build': ['> vite build', 'vite v5.0.0 building for production…', '✓ 24 modules transformed', 'dist/index.html   0.50 kB', 'dist/assets/index.js  142 kB'],
    };

    if (trimmed === 'clear') {
      setLines([{ id: lineId++, type: 'info', text: '$ terminal ready' }]);
      return;
    }

    const output = responses[trimmed] ?? [`bash: ${trimmed}: command not found`];
    const type = (responses[trimmed] === undefined) ? 'error' : 'output';

    setTimeout(() => {
      setLines(prev => [
        ...prev,
        ...output.map(text => ({ id: lineId++, type, text } as TerminalLine)),
      ]);
    }, 80);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCommand(input);
      setInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(idx);
      setInput(history[idx] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(idx);
      setInput(idx === -1 ? '' : history[idx]);
    }
  };

  const lineColor = (type: TerminalLine['type']) => {
    switch (type) {
      case 'input':  return 'text-indigo-300';
      case 'error':  return 'text-red-400';
      case 'info':   return 'text-gray-500';
      default:       return 'text-green-300';
    }
  };

  return (
    <div ref={terminalRef} className="flex flex-col h-full bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-green-400 font-semibold">Terminal</span>
          <span className="text-xs text-gray-600 font-mono">Ctrl+`</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLines([{ id: lineId++, type: 'info', text: '$ terminal ready' }])}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            title="Clear terminal"
          >
            ⌫
          </button>
          <button onClick={onToggle} className="text-xs text-gray-500 hover:text-white transition-colors">
            {collapsed ? '◀' : '▶'}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col flex-1 overflow-hidden"
            onClick={() => inputRef.current?.focus()}
          >
            {/* Output */}
            <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
              {lines.map(line => (
                <div key={line.id} className={`font-mono text-xs leading-5 whitespace-pre-wrap ${lineColor(line.type)}`}>
                  {line.text}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input row */}
            <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-800 bg-gray-900">
              <span className="font-mono text-xs text-indigo-400 shrink-0">$</span>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent font-mono text-xs text-gray-200 outline-none caret-green-400"
                placeholder="type a command…"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── CodeMode ─────────────────────────────────────────────────────────────────

export interface CodeModeProps {
  children: React.ReactNode;
}

export default function CodeMode({ children }: CodeModeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<PanelSizes>(loadSizes);
  const [collapsed, setCollapsed] = useState<CollapseState>({
    chat: false,
    editor: false,
    terminal: false,
  });

  // Persist sizes
  useEffect(() => { saveSizes(sizes); }, [sizes]);

  // Ctrl+` → focus terminal input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        const input = terminalRef.current?.querySelector('input');
        input?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleDrag = useCallback((panel: 'left' | 'right', deltaX: number) => {
    const containerWidth = containerRef.current?.clientWidth ?? 1;
    const deltaPct = (deltaX / containerWidth) * 100;

    setSizes(prev => {
      if (panel === 'left') {
        // Dragging handle between chat and editor
        const newChat = Math.max(MIN_PANEL_PCT, Math.min(prev.chat + deltaPct, 100 - MIN_PANEL_PCT * 2));
        const diff = newChat - prev.chat;
        const newEditor = Math.max(MIN_PANEL_PCT, prev.editor - diff);
        return { ...prev, chat: newChat, editor: newEditor };
      } else {
        // Dragging handle between editor and terminal
        const newEditor = Math.max(MIN_PANEL_PCT, Math.min(prev.editor + deltaPct, 100 - MIN_PANEL_PCT * 2));
        const diff = newEditor - prev.editor;
        const newTerminal = Math.max(MIN_PANEL_PCT, prev.terminal - diff);
        return { ...prev, editor: newEditor, terminal: newTerminal };
      }
    });
  }, []);

  const togglePanel = (panel: keyof CollapseState) => {
    setCollapsed(prev => ({ ...prev, [panel]: !prev[panel] }));
  };

  // Compute effective widths accounting for collapsed state
  const effectiveSizes = (() => {
    const collapsedWidth = 2.5; // % for collapsed panel tab
    let chatW  = collapsed.chat     ? collapsedWidth : sizes.chat;
    let editW  = collapsed.editor   ? collapsedWidth : sizes.editor;
    let termW  = collapsed.terminal ? collapsedWidth : sizes.terminal;
    const totalCollapsed = [collapsed.chat, collapsed.editor, collapsed.terminal].filter(Boolean).length;
    const expandedTotal = 100 - (totalCollapsed * collapsedWidth);
    const rawExpanded = sizes.chat + sizes.editor + sizes.terminal - totalCollapsed * collapsedWidth;
    const scale = rawExpanded > 0 ? expandedTotal / rawExpanded : 1;
    if (!collapsed.chat)     chatW  = sizes.chat     * scale;
    if (!collapsed.editor)   editW  = sizes.editor   * scale;
    if (!collapsed.terminal) termW  = sizes.terminal * scale;
    return { chatW, editW, termW };
  })();

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full overflow-hidden bg-gray-950"
      style={{ cursor: 'default' }}
    >
      {/* Chat panel */}
      <div
        className="flex flex-col h-full overflow-hidden border-r border-gray-800 transition-all duration-150"
        style={{ width: `${effectiveSizes.chatW}%`, minWidth: `${MIN_PANEL_PCT}%` }}
      >
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0">
          <span className="text-xs font-mono text-blue-400 font-semibold">Chat</span>
          <button onClick={() => togglePanel('chat')} className="text-xs text-gray-500 hover:text-white transition-colors">
            {collapsed.chat ? '▶' : '◀'}
          </button>
        </div>
        <AnimatePresence initial={false}>
          {!collapsed.chat && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex-1 overflow-auto"
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <DragHandle onDrag={d => handleDrag('left', d)} />

      {/* Editor panel */}
      <div
        className="flex flex-col h-full overflow-hidden border-r border-gray-800 transition-all duration-150"
        style={{ width: `${effectiveSizes.editW}%`, minWidth: `${MIN_PANEL_PCT}%` }}
      >
        <EditorPanel
          collapsed={collapsed.editor}
          onToggle={() => togglePanel('editor')}
        />
      </div>

      <DragHandle onDrag={d => handleDrag('right', d)} />

      {/* Terminal panel */}
      <div
        className="flex flex-col h-full overflow-hidden transition-all duration-150"
        style={{ width: `${effectiveSizes.termW}%`, minWidth: `${MIN_PANEL_PCT}%` }}
      >
        <TerminalPanel
          collapsed={collapsed.terminal}
          onToggle={() => togglePanel('terminal')}
          terminalRef={terminalRef}
        />
      </div>
    </div>
  );
}
