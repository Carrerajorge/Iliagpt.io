/**
 * ResearchMode.tsx
 *
 * Three-panel layout for research conversations:
 *   Left   — Chat panel (children)
 *   Center — Sources / references panel (URLs, papers, snippets, favicons)
 *   Right  — Notes panel (rich-text-like textarea, persisted to localStorage)
 *
 * Sources can be added manually or expanded to show a preview snippet.
 * Notes survive page refreshes via localStorage.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResearchSource {
  id: string;
  url: string;
  title: string;
  snippet: string;
  favicon?: string;
  addedAt: number;
  /** Whether the preview card is expanded */
  expanded?: boolean;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const NOTES_KEY = 'iliagpt:research-notes';
const SOURCES_KEY = 'iliagpt:research-sources';

function loadNotes(): string {
  try { return localStorage.getItem(NOTES_KEY) ?? ''; } catch { return ''; }
}
function saveNotes(value: string): void {
  try { localStorage.setItem(NOTES_KEY, value); } catch {/* ignore */}
}
function loadSources(): ResearchSource[] {
  try {
    const raw = localStorage.getItem(SOURCES_KEY);
    return raw ? JSON.parse(raw) : DEMO_SOURCES;
  } catch { return DEMO_SOURCES; }
}
function saveSources(sources: ResearchSource[]): void {
  try { localStorage.setItem(SOURCES_KEY, JSON.stringify(sources)); } catch {/* ignore */}
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_SOURCES: ResearchSource[] = [
  {
    id: 'src-1',
    url: 'https://arxiv.org/abs/2303.08774',
    title: 'GPT-4 Technical Report',
    snippet: 'We report the development of GPT-4, a large-scale, multimodal model which can accept image and text inputs and produce text outputs.',
    favicon: 'https://arxiv.org/favicon.ico',
    addedAt: Date.now() - 3600_000,
  },
  {
    id: 'src-2',
    url: 'https://www.nature.com/articles/s41586-021-03819-2',
    title: 'Highly accurate protein structure prediction with AlphaFold',
    snippet: 'Proteins are essential to life, and understanding their structure can facilitate a mechanistic understanding of their function.',
    favicon: 'https://www.nature.com/favicon.ico',
    addedAt: Date.now() - 7200_000,
  },
];

// ─── Utility ──────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

function generateId(): string {
  return `src-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── SourceCard ───────────────────────────────────────────────────────────────

interface SourceCardProps {
  source: ResearchSource;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onOpen: (url: string) => void;
}

function SourceCard({ source, onToggle, onRemove, onOpen }: SourceCardProps) {
  const domain = extractDomain(source.url);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      className="rounded-xl border border-gray-700 bg-gray-800 overflow-hidden hover:border-emerald-600 transition-colors"
    >
      {/* Header row */}
      <div
        className="flex items-start gap-2 p-3 cursor-pointer"
        onClick={() => onToggle(source.id)}
        role="button"
        aria-expanded={source.expanded}
      >
        {/* Favicon */}
        <div className="shrink-0 w-4 h-4 mt-0.5 rounded overflow-hidden bg-gray-700 flex items-center justify-center">
          {source.favicon ? (
            <img
              src={source.favicon}
              alt=""
              className="w-full h-full object-contain"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <span className="text-gray-500 text-xs">🔗</span>
          )}
        </div>

        {/* Title + domain */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-100 leading-snug truncate">{source.title}</p>
          <p className="text-xs text-gray-500 truncate">{domain}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onOpen(source.url)}
            className="p-1 text-gray-500 hover:text-emerald-400 transition-colors text-xs"
            title="Open URL"
          >
            ↗
          </button>
          <button
            onClick={() => onRemove(source.id)}
            className="p-1 text-gray-500 hover:text-red-400 transition-colors text-xs"
            title="Remove source"
          >
            ✕
          </button>
          <span className="text-gray-600 text-xs ml-1">{source.expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded snippet */}
      <AnimatePresence initial={false}>
        {source.expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 border-t border-gray-700 pt-2">
              <p className="text-xs text-gray-400 leading-relaxed line-clamp-4">{source.snippet}</p>
              <button
                onClick={() => onOpen(source.url)}
                className="mt-2 text-xs text-emerald-400 hover:text-emerald-300 transition-colors underline underline-offset-2"
              >
                Read full source ↗
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── AddSourceForm ────────────────────────────────────────────────────────────

interface AddSourceFormProps {
  onAdd: (source: ResearchSource) => void;
  onCancel: () => void;
}

function AddSourceForm({ onAdd, onCancel }: AddSourceFormProps) {
  const [url, setUrl]       = useState('');
  const [title, setTitle]   = useState('');
  const [snippet, setSnippet] = useState('');
  const [error, setError]   = useState('');
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => { urlRef.current?.focus(); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidUrl(url)) { setError('Please enter a valid URL.'); return; }
    const domain = extractDomain(url);
    onAdd({
      id: generateId(),
      url,
      title: title.trim() || domain,
      snippet: snippet.trim() || 'No description provided.',
      favicon: `https://${extractDomain(url)}/favicon.ico`,
      addedAt: Date.now(),
    });
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      onSubmit={handleSubmit}
      className="rounded-xl border border-emerald-700 bg-gray-800 p-3 space-y-2"
    >
      <p className="text-xs font-semibold text-emerald-400 mb-1">Add Source</p>

      <div>
        <input
          ref={urlRef}
          type="url"
          value={url}
          onChange={e => { setUrl(e.target.value); setError(''); }}
          placeholder="https://example.com/paper"
          className="w-full text-xs bg-gray-900 text-gray-200 border border-gray-700 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-500 transition-colors placeholder-gray-600"
        />
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>

      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="w-full text-xs bg-gray-900 text-gray-200 border border-gray-700 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-500 transition-colors placeholder-gray-600"
      />

      <textarea
        value={snippet}
        onChange={e => setSnippet(e.target.value)}
        placeholder="Snippet / abstract (optional)"
        rows={2}
        className="w-full text-xs bg-gray-900 text-gray-200 border border-gray-700 rounded-lg px-2 py-1.5 outline-none focus:border-emerald-500 transition-colors resize-none placeholder-gray-600"
      />

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1 rounded-lg text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="text-xs px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white transition-colors"
        >
          Add
        </button>
      </div>
    </motion.form>
  );
}

// ─── Notes Panel ──────────────────────────────────────────────────────────────

function NotesPanel() {
  const [notes, setNotes] = useState(loadNotes);
  const [charCount, setCharCount] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setCharCount(notes.length); }, [notes]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNotes(val);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNotes(val), 500);
  };

  const handleClear = () => {
    if (window.confirm('Clear all notes? This cannot be undone.')) {
      setNotes('');
      saveNotes('');
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(notes).catch(() => {});
  };

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <span className="text-xs font-mono text-amber-400 font-semibold">Notes</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">{charCount} chars</span>
          <button
            onClick={handleCopy}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            title="Copy notes"
          >
            ⎘
          </button>
          <button
            onClick={handleClear}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            title="Clear notes"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Toolbar (formatting hints) */}
      <div className="flex items-center gap-3 px-3 py-1 bg-gray-900 border-b border-gray-800 shrink-0">
        {['**bold**', '*italic*', '- list', '## heading', '> quote'].map(hint => (
          <button
            key={hint}
            className="text-xs text-gray-600 hover:text-gray-300 font-mono transition-colors"
            title={`Insert ${hint}`}
            onClick={() => {
              setNotes(prev => prev + (prev.endsWith('\n') || prev === '' ? '' : '\n') + hint + ' ');
            }}
          >
            {hint}
          </button>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        value={notes}
        onChange={handleChange}
        className="flex-1 resize-none bg-gray-950 text-gray-200 text-xs leading-relaxed font-mono p-3 outline-none caret-amber-400 selection:bg-amber-900/40 placeholder-gray-700"
        placeholder={"Start taking notes…\n\nMarkdown is supported:\n## Heading\n**bold** *italic*\n- list item\n> quote"}
        spellCheck
      />

      {/* Footer */}
      <div className="px-3 py-1 bg-gray-900 border-t border-gray-800 shrink-0">
        <p className="text-xs text-gray-600">Auto-saved · Markdown supported</p>
      </div>
    </div>
  );
}

// ─── ResearchMode ─────────────────────────────────────────────────────────────

export interface ResearchModeProps {
  children: React.ReactNode;
}

export default function ResearchMode({ children }: ResearchModeProps) {
  const [sources, setSources] = useState<ResearchSource[]>(loadSources);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Persist sources
  useEffect(() => { saveSources(sources); }, [sources]);

  const toggleSource = useCallback((id: string) => {
    setSources(prev => prev.map(s => s.id === id ? { ...s, expanded: !s.expanded } : s));
  }, []);

  const removeSource = useCallback((id: string) => {
    setSources(prev => prev.filter(s => s.id !== id));
  }, []);

  const addSource = useCallback((source: ResearchSource) => {
    setSources(prev => [source, ...prev]);
    setShowAddForm(false);
  }, []);

  const openSource = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const filteredSources = sources.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return s.title.toLowerCase().includes(q) ||
           s.url.toLowerCase().includes(q) ||
           s.snippet.toLowerCase().includes(q);
  });

  return (
    <div className="flex h-full w-full overflow-hidden bg-gray-950">
      {/* ── Chat Panel ── */}
      <div className="flex flex-col h-full overflow-hidden border-r border-gray-800" style={{ width: '35%', minWidth: '240px' }}>
        <div className="flex items-center px-3 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0">
          <span className="text-xs font-mono text-blue-400 font-semibold">Chat</span>
        </div>
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>

      {/* ── Sources Panel ── */}
      <div
        className="flex flex-col h-full overflow-hidden border-r border-gray-800"
        style={{ width: '35%', minWidth: '240px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0">
          <span className="text-xs font-mono text-emerald-400 font-semibold">
            Sources
            <span className="ml-1.5 text-gray-600">({filteredSources.length})</span>
          </span>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className={`text-xs px-2 py-0.5 rounded-md transition-colors ${
              showAddForm
                ? 'bg-emerald-800 text-emerald-200'
                : 'bg-gray-800 text-gray-400 hover:bg-emerald-900 hover:text-emerald-300'
            }`}
          >
            {showAddForm ? '✕ Cancel' : '+ Add'}
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-1.5 border-b border-gray-800 bg-gray-900 shrink-0">
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search sources…"
            className="w-full text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-lg px-2 py-1 outline-none focus:border-emerald-600 transition-colors placeholder-gray-600"
          />
        </div>

        {/* Source list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <AnimatePresence mode="popLayout">
            {showAddForm && (
              <AddSourceForm
                key="add-form"
                onAdd={addSource}
                onCancel={() => setShowAddForm(false)}
              />
            )}

            {filteredSources.length === 0 && !showAddForm ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-8"
              >
                <p className="text-3xl mb-2">🔬</p>
                <p className="text-xs text-gray-500">No sources yet.</p>
                <p className="text-xs text-gray-600 mt-1">Click "+ Add" to add a reference.</p>
              </motion.div>
            ) : (
              filteredSources.map(source => (
                <SourceCard
                  key={source.id}
                  source={source}
                  onToggle={toggleSource}
                  onRemove={removeSource}
                  onOpen={openSource}
                />
              ))
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-gray-800 bg-gray-900 shrink-0">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-600">{sources.length} source{sources.length !== 1 ? 's' : ''}</p>
            {sources.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm('Remove all sources?')) {
                    setSources([]);
                  }
                }}
                className="text-xs text-gray-600 hover:text-red-400 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Notes Panel ── */}
      <div className="flex flex-col h-full overflow-hidden" style={{ flex: 1, minWidth: '180px' }}>
        <NotesPanel />
      </div>
    </div>
  );
}
