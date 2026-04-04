/**
 * ResearchMode.tsx
 * Three-panel research view: chat | sources | notes
 */

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  StickyNote,
  Globe,
  Calendar,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResearchModeProps {
  chatId: string;
  children: React.ReactNode;
}

interface Source {
  id: string;
  title: string;
  url: string;
  domain: string;
  excerpt: string;
  favicon: string;
  date: Date;
  isBookmarked: boolean;
}

// ─── Demo sources ─────────────────────────────────────────────────────────────

const INITIAL_SOURCES: Source[] = [
  {
    id: 's1',
    title: 'The Transformer Architecture: A Deep Dive',
    url: 'https://arxiv.org/abs/1706.03762',
    domain: 'arxiv.org',
    excerpt: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.',
    favicon: 'https://arxiv.org/favicon.ico',
    date: new Date('2024-11-15'),
    isBookmarked: true,
  },
  {
    id: 's2',
    title: 'Scaling Laws for Neural Language Models',
    url: 'https://arxiv.org/abs/2001.08361',
    domain: 'openai.com',
    excerpt: 'We study empirical scaling laws for language model performance on the cross-entropy loss. The loss scales as a power-law with model size, dataset size, and the amount of compute used for training.',
    favicon: 'https://openai.com/favicon.ico',
    date: new Date('2024-10-28'),
    isBookmarked: false,
  },
  {
    id: 's3',
    title: 'Constitutional AI: Harmlessness from AI Feedback',
    url: 'https://anthropic.com/research',
    domain: 'anthropic.com',
    excerpt: 'We introduce a method for training a harmless AI assistant through self-improvement, without any human labels identifying harmful outputs. The only human oversight is provided through a list of rules or principles.',
    favicon: 'https://anthropic.com/favicon.ico',
    date: new Date('2024-09-12'),
    isBookmarked: false,
  },
  {
    id: 's4',
    title: 'Emergent Abilities of Large Language Models',
    url: 'https://research.google/pubs/emergent-abilities',
    domain: 'research.google',
    excerpt: 'We investigate the phenomenon of emergence in large language models — abilities that are not present in smaller models but appear in larger models. These emergent abilities are surprising because they are not explicitly trained.',
    favicon: 'https://google.com/favicon.ico',
    date: new Date('2024-08-05'),
    isBookmarked: true,
  },
];

const NOTES_STORAGE_KEY = 'iliaGPT_research_notes';

// ─── SourceCard ───────────────────────────────────────────────────────────────

interface SourceCardProps {
  source: Source;
  onToggleBookmark: (id: string) => void;
  index: number;
}

function SourceCard({ source, onToggleBookmark, index }: SourceCardProps) {
  const dateStr = source.date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.3, ease: 'easeOut' }}
      className="group relative rounded-lg border border-white/8 bg-white/3 hover:bg-white/6 hover:border-white/15 transition-all p-3.5 cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-shrink-0 w-5 h-5 rounded bg-white/10 flex items-center justify-center mt-0.5">
          <Globe className="w-3 h-3 text-white/40" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white/90 leading-tight line-clamp-2">
            {source.title}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] text-amber-400/80 font-medium">{source.domain}</span>
            <span className="text-[10px] text-white/20">·</span>
            <span className="text-[10px] text-white/30 flex items-center gap-0.5">
              <Calendar className="w-2.5 h-2.5" />
              {dateStr}
            </span>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleBookmark(source.id); }}
          className={`flex-shrink-0 p-1 rounded transition-all ${
            source.isBookmarked
              ? 'text-amber-400'
              : 'text-white/20 hover:text-white/60'
          }`}
          aria-label={source.isBookmarked ? 'Remove bookmark' : 'Bookmark'}
        >
          {source.isBookmarked ? (
            <BookmarkCheck className="w-3.5 h-3.5" />
          ) : (
            <Bookmark className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Excerpt */}
      <p className="text-xs text-white/45 leading-relaxed line-clamp-3">
        {source.excerpt}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-white/6">
        <span className="text-[10px] text-white/25 truncate max-w-[140px]">{source.url}</span>
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-[10px] text-blue-400/70 hover:text-blue-400 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Open
        </a>
      </div>
    </motion.div>
  );
}

// ─── Research Timeline ────────────────────────────────────────────────────────

function ResearchTimeline({ sources }: { sources: Source[] }) {
  const sorted = [...sources].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <div className="flex-shrink-0 border-t border-white/8 bg-[#0a0a0a]">
      <div className="px-4 py-2 text-[10px] text-white/30 uppercase tracking-wider font-medium">
        Timeline
      </div>
      <div className="flex gap-3 px-4 pb-3 overflow-x-auto scrollbar-thin">
        {sorted.map((source, i) => (
          <motion.div
            key={source.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="flex-shrink-0 w-40 rounded-md border border-white/8 bg-white/3 p-2.5 cursor-pointer hover:bg-white/6 transition-all"
          >
            <div className="text-[10px] text-white/30 mb-1 flex items-center gap-1">
              <Calendar className="w-2.5 h-2.5" />
              {source.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
            <div className="text-xs text-white/70 font-medium line-clamp-2 leading-tight">
              {source.title}
            </div>
            <div className="text-[10px] text-amber-400/60 mt-1">{source.domain}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Notes Panel ─────────────────────────────────────────────────────────────

interface NotesPanelProps {
  chatId: string;
}

function NotesPanel({ chatId }: NotesPanelProps) {
  const storageKey = `${NOTES_STORAGE_KEY}_${chatId}`;
  const [notes, setNotes] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  });

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNotes(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // ignore
    }
  }, [storageKey]);

  const wordCount = notes.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/8 flex-shrink-0">
        <StickyNote className="w-3.5 h-3.5 text-amber-400/70" />
        <span className="text-xs font-medium text-white/60">Research Notes</span>
        <span className="flex-1" />
        {wordCount > 0 && (
          <span className="text-[10px] text-white/25">{wordCount}w</span>
        )}
      </div>

      <textarea
        value={notes}
        onChange={handleChange}
        placeholder="Add your research notes here...&#10;&#10;• Key findings&#10;• Questions to investigate&#10;• Connections between sources"
        className="flex-1 w-full resize-none bg-transparent p-3 text-xs text-white/70 placeholder-white/20 leading-relaxed focus:outline-none"
        spellCheck={false}
      />

      {notes && (
        <div className="px-3 py-2 border-t border-white/6 flex-shrink-0">
          <span className="text-[10px] text-white/20">Auto-saved to local storage</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ResearchMode({ chatId, children }: ResearchModeProps) {
  const [sources, setSources] = useState<Source[]>(INITIAL_SOURCES);

  const handleToggleBookmark = useCallback((id: string) => {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isBookmarked: !s.isBookmarked } : s))
    );
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Chat panel — 30% */}
        <div className="flex flex-col overflow-hidden flex-shrink-0 border-r border-white/8" style={{ width: '30%' }}>
          {children}
        </div>

        {/* Sources panel — 40% */}
        <motion.div
          className="flex flex-col overflow-hidden border-r border-white/8"
          style={{ width: '40%' }}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          {/* Panel header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 flex-shrink-0">
            <Search className="w-3.5 h-3.5 text-amber-400/70" />
            <span className="text-xs font-medium text-white/60">Sources</span>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
              {sources.length}
            </span>
          </div>

          {/* Source cards */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {sources.map((source, i) => (
              <SourceCard
                key={source.id}
                source={source}
                onToggleBookmark={handleToggleBookmark}
                index={i}
              />
            ))}
          </div>
        </motion.div>

        {/* Notes panel — 30% */}
        <motion.div
          className="flex flex-col overflow-hidden"
          style={{ width: '30%' }}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <NotesPanel chatId={chatId} />
        </motion.div>
      </div>

      {/* Timeline at bottom */}
      <ResearchTimeline sources={sources} />
    </div>
  );
}
