/**
 * DocumentMode.tsx
 * Split-pane layout with chat and a rich document preview area.
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  Download,
  Eye,
  EyeOff,
  Clock,
  ChevronRight,
  Hash,
  AlignLeft,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocumentModeProps {
  chatId: string;
  children: React.ReactNode;
}

interface DocumentVersion {
  id: string;
  timestamp: Date;
  wordCount: number;
  label: string;
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_DOCUMENT = `# The Future of Artificial Intelligence

## Introduction

Artificial intelligence (AI) represents one of the most transformative technologies of the 21st century. From natural language processing to computer vision, the capabilities of modern AI systems have expanded dramatically over the past decade.

## Key Developments

### Large Language Models

Large language models (LLMs) have demonstrated remarkable capabilities in understanding and generating human-like text. These models, trained on vast corpora of text data, can engage in complex reasoning, creative writing, and technical problem-solving.

The emergence of models with hundreds of billions of parameters has pushed the boundaries of what machines can accomplish. Tasks that once required specialized systems — translation, summarization, code generation — are now handled by general-purpose models.

### Multimodal AI

Beyond text, modern AI systems increasingly work across modalities. Vision-language models can describe images, answer questions about visual content, and even generate images from text descriptions.

## Challenges and Considerations

Despite remarkable progress, significant challenges remain:

1. **Alignment and safety** — Ensuring AI systems behave in accordance with human values
2. **Interpretability** — Understanding why models produce specific outputs
3. **Computational costs** — Training large models requires enormous resources
4. **Bias and fairness** — Mitigating societal biases encoded in training data

## Conclusion

The trajectory of AI development suggests continued rapid advancement. The key questions are no longer whether AI will transform society, but how we can ensure that transformation is beneficial, equitable, and aligned with human flourishing.`;

const DEMO_VERSIONS: DocumentVersion[] = [
  { id: 'v5', timestamp: new Date(Date.now() - 2 * 60 * 1000), wordCount: 312, label: 'Latest revision' },
  { id: 'v4', timestamp: new Date(Date.now() - 18 * 60 * 1000), wordCount: 289, label: 'Added conclusion' },
  { id: 'v3', timestamp: new Date(Date.now() - 45 * 60 * 1000), wordCount: 201, label: 'Expanded challenges' },
  { id: 'v2', timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), wordCount: 145, label: 'Initial draft' },
  { id: 'v1', timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000), wordCount: 78, label: 'Outline only' },
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

/** Renders markdown-lite content as JSX — no external dependency */
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let listMode = false;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    nodes.push(
      <ul key={`list-${nodes.length}`} className="list-disc list-inside space-y-1 my-3 text-white/80 leading-relaxed pl-4">
        {listBuffer.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
    listBuffer = [];
    listMode = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('# ')) {
      flushList();
      nodes.push(<h1 key={i} className="text-2xl font-bold text-white mt-6 mb-4">{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      flushList();
      nodes.push(<h2 key={i} className="text-xl font-semibold text-white/90 mt-5 mb-3 border-b border-white/8 pb-2">{line.slice(3)}</h2>);
    } else if (line.startsWith('### ')) {
      flushList();
      nodes.push(<h3 key={i} className="text-base font-semibold text-white/80 mt-4 mb-2">{line.slice(4)}</h3>);
    } else if (/^\d+\.\s/.test(line)) {
      flushList();
      const content = line.replace(/^\d+\.\s/, '');
      // Inline bold
      const parts = content.split(/\*\*(.*?)\*\*/g);
      const rendered = parts.map((p, pi) =>
        pi % 2 === 1 ? <strong key={pi} className="text-white font-semibold">{p}</strong> : p
      );
      nodes.push(
        <div key={i} className="flex gap-2 my-1 text-white/80 leading-relaxed">
          <span className="text-white/40 select-none">{line.match(/^\d+/)?.[0]}.</span>
          <span>{rendered}</span>
        </div>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      listMode = true;
      listBuffer.push(line.slice(2));
    } else if (line.trim() === '') {
      flushList();
      nodes.push(<div key={i} className="h-2" />);
    } else {
      flushList();
      // Inline bold
      const parts = line.split(/\*\*(.*?)\*\*/g);
      const rendered = parts.map((p, pi) =>
        pi % 2 === 1 ? <strong key={pi} className="text-white font-semibold">{p}</strong> : p
      );
      nodes.push(
        <p key={i} className="text-white/75 leading-relaxed text-sm">
          {rendered}
        </p>
      );
    }
  }

  flushList();
  return nodes;
}

// ─── Version Sidebar ─────────────────────────────────────────────────────────

interface VersionSidebarProps {
  versions: DocumentVersion[];
  activeVersionId: string;
  onSelect: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

function VersionSidebar({ versions, activeVersionId, onSelect, isOpen, onToggle }: VersionSidebarProps) {
  return (
    <div className="flex-shrink-0 border-l border-white/8 flex flex-col">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-2.5 text-xs text-white/40 hover:text-white/70 hover:bg-white/5 transition-all border-b border-white/8 w-full"
        aria-expanded={isOpen}
      >
        <Clock className="w-3.5 h-3.5" />
        {isOpen && <span className="font-medium">History</span>}
        <span className="flex-1" />
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 180, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="w-44 py-2">
              {versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => onSelect(v.id)}
                  className={`w-full text-left px-3 py-2 transition-all ${
                    activeVersionId === v.id
                      ? 'bg-white/10 text-white'
                      : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                  }`}
                >
                  <div className="text-xs font-medium">{v.label}</div>
                  <div className="text-[10px] text-white/30 mt-0.5">
                    {formatRelativeTime(v.timestamp)} · {v.wordCount}w
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Export Buttons ───────────────────────────────────────────────────────────

interface ExportButtonsProps {
  wordCount: number;
}

function ExportButtons({ wordCount }: ExportButtonsProps) {
  const formats = [
    { label: 'PDF', icon: '📄' },
    { label: 'DOCX', icon: '📝' },
    { label: 'MD', icon: '#' },
  ];

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-white/30 mr-1">
        <Hash className="w-3 h-3 inline mr-0.5" />
        {wordCount} words
      </span>
      {formats.map((f) => (
        <button
          key={f.label}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-white/50 hover:text-white/80 hover:bg-white/8 border border-white/10 hover:border-white/20 transition-all"
          aria-label={`Export as ${f.label}`}
        >
          <Download className="w-3 h-3" />
          {f.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DocumentMode({ chatId: _chatId, children }: DocumentModeProps) {
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [activeVersionId, setActiveVersionId] = useState('v5');

  const wordCount = useMemo(() => countWords(DEMO_DOCUMENT), []);
  const renderedContent = useMemo(() => renderMarkdown(DEMO_DOCUMENT), []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Chat panel */}
      <AnimatePresence>
        {!isReadingMode && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: '35%', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="flex flex-col overflow-hidden flex-shrink-0 border-r border-white/8"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Document preview panel */}
      <motion.div
        className="flex-1 flex flex-col overflow-hidden"
        initial={{ x: 30, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/8 bg-[#0f0f0f] flex-shrink-0">
          <FileText className="w-4 h-4 text-purple-400" />
          <span className="text-sm text-white/70 font-medium flex-1">Document Preview</span>
          <ExportButtons wordCount={wordCount} />
          <div className="w-px h-4 bg-white/10" />
          <button
            onClick={() => setIsReadingMode((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-all border ${
              isReadingMode
                ? 'border-purple-500/40 bg-purple-500/15 text-purple-400'
                : 'border-white/10 text-white/40 hover:text-white/70 hover:bg-white/8'
            }`}
            aria-pressed={isReadingMode}
          >
            {isReadingMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{isReadingMode ? 'Exit Reading' : 'Reading Mode'}</span>
          </button>
        </div>

        {/* Content area with optional history sidebar */}
        <div className="flex-1 flex overflow-hidden">
          {/* Document scroll area */}
          <div className="flex-1 overflow-y-auto">
            <div
              className={`mx-auto px-8 py-8 ${
                isReadingMode ? 'max-w-3xl' : 'max-w-2xl'
              }`}
            >
              {/* Document header decoration */}
              <div className="flex items-center gap-2 mb-6 pb-4 border-b border-white/8">
                <AlignLeft className="w-4 h-4 text-purple-400/60" />
                <span className="text-xs text-white/30">Version {activeVersionId} · Auto-saved</span>
              </div>

              {/* Rendered markdown */}
              <div className="space-y-1">
                {renderedContent}
              </div>

              <div className="h-16" />
            </div>
          </div>

          {/* Version history sidebar */}
          <VersionSidebar
            versions={DEMO_VERSIONS}
            activeVersionId={activeVersionId}
            onSelect={setActiveVersionId}
            isOpen={isHistoryOpen}
            onToggle={() => setIsHistoryOpen((v) => !v)}
          />
        </div>
      </motion.div>
    </div>
  );
}
