/**
 * AdaptiveLayout.tsx
 * Main adaptive layout container that switches between UI modes.
 */

import React, { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  MessageSquare,
  Code2,
  FileText,
  Search,
  BarChart2,
  PenTool,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { UIMode, useUIMode } from '@/lib/adaptiveUI/UIAdaptationEngine';
import type { Message } from '@/types/chat';
import CodeMode from './CodeMode';
import DocumentMode from './DocumentMode';
import ResearchMode from './ResearchMode';
import DataMode from './DataMode';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdaptiveLayoutProps {
  children: React.ReactNode;
  chatId?: string;
  messages?: Message[];
}

interface ModeConfig {
  mode: UIMode;
  label: string;
  icon: React.ReactNode;
  description: string;
  color: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODE_CONFIGS: ModeConfig[] = [
  {
    mode: UIMode.CHAT,
    label: 'Chat',
    icon: <MessageSquare className="w-4 h-4" />,
    description: 'Standard chat interface',
    color: 'text-blue-500',
  },
  {
    mode: UIMode.CODE,
    label: 'Code',
    icon: <Code2 className="w-4 h-4" />,
    description: 'Split view with code editor',
    color: 'text-green-500',
  },
  {
    mode: UIMode.DOCUMENT,
    label: 'Document',
    icon: <FileText className="w-4 h-4" />,
    description: 'Document editing & preview',
    color: 'text-purple-500',
  },
  {
    mode: UIMode.RESEARCH,
    label: 'Research',
    icon: <Search className="w-4 h-4" />,
    description: 'Three-panel research view',
    color: 'text-amber-500',
  },
  {
    mode: UIMode.DATA,
    label: 'Data',
    icon: <BarChart2 className="w-4 h-4" />,
    description: 'Data visualization',
    color: 'text-cyan-500',
  },
  {
    mode: UIMode.CANVAS,
    label: 'Canvas',
    icon: <PenTool className="w-4 h-4" />,
    description: 'Visual canvas mode',
    color: 'text-pink-500',
  },
  {
    mode: UIMode.CREATIVE,
    label: 'Creative',
    icon: <Sparkles className="w-4 h-4" />,
    description: 'Creative writing mode',
    color: 'text-orange-500',
  },
];

const CONFIDENCE_LABELS: Record<string, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.4) return 'medium';
  return 'low';
}

// ─── Confidence Badge ─────────────────────────────────────────────────────────

interface ConfidenceBadgeProps {
  mode: UIMode;
  confidence: number;
}

function ConfidenceBadge({ mode, confidence }: ConfidenceBadgeProps) {
  const config = MODE_CONFIGS.find((c) => c.mode === mode);
  const label = getConfidenceLabel(confidence);
  const pct = Math.round(confidence * 100);

  const badgeColors: Record<string, string> = {
    high: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    low: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${badgeColors[label]}`}
    >
      <Wand2 className="w-3 h-3" />
      <span>
        Auto: {config?.label ?? mode} · {pct}%
      </span>
    </motion.div>
  );
}

// ─── Mode Toolbar ─────────────────────────────────────────────────────────────

interface ModeToolbarProps {
  currentMode: UIMode;
  isAutoMode: boolean;
  confidence: number;
  onSelectMode: (mode: UIMode) => void;
  onResetAuto: () => void;
}

function ModeToolbar({
  currentMode,
  isAutoMode,
  confidence,
  onSelectMode,
  onResetAuto,
}: ModeToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/8 bg-[#0f0f0f]/80 backdrop-blur-sm flex-shrink-0">
      {/* Auto badge */}
      <AnimatePresence mode="wait">
        {isAutoMode && currentMode !== UIMode.CHAT && (
          <ConfidenceBadge key={currentMode} mode={currentMode} confidence={confidence} />
        )}
      </AnimatePresence>

      <div className="flex-1" />

      {/* Mode buttons */}
      <Tooltip.Provider delayDuration={300}>
        <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-1">
          {MODE_CONFIGS.map((config) => {
            const isActive = currentMode === config.mode;
            return (
              <Tooltip.Root key={config.mode}>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={() => onSelectMode(config.mode)}
                    className={`
                      relative flex items-center justify-center w-7 h-7 rounded-md transition-all duration-150
                      ${
                        isActive
                          ? 'bg-white/15 shadow-sm text-white'
                          : 'text-white/40 hover:text-white/70 hover:bg-white/8'
                      }
                    `}
                    aria-label={config.label}
                    aria-pressed={isActive}
                  >
                    {config.icon}
                    {isActive && (
                      <motion.span
                        layoutId="modeIndicator"
                        className="absolute inset-0 rounded-md bg-white/10"
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
                      />
                    )}
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="z-50 px-2.5 py-1.5 rounded-md bg-[#1a1a1a] border border-white/10 text-white text-xs shadow-xl"
                    sideOffset={6}
                  >
                    <div className="font-medium">{config.label}</div>
                    <div className="text-white/50 mt-0.5">{config.description}</div>
                    <Tooltip.Arrow className="fill-[#1a1a1a]" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            );
          })}
        </div>

        {/* Auto-detect button */}
        {!isAutoMode && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                onClick={onResetAuto}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-white/50 hover:text-white/80 hover:bg-white/8 transition-all"
                aria-label="Reset to auto-detect"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Auto</span>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="z-50 px-2.5 py-1.5 rounded-md bg-[#1a1a1a] border border-white/10 text-white text-xs shadow-xl"
                sideOffset={6}
              >
                Reset to auto-detected mode
                <Tooltip.Arrow className="fill-[#1a1a1a]" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}
      </Tooltip.Provider>
    </div>
  );
}

// ─── Fallback Canvas/Creative layouts ────────────────────────────────────────

function CanvasMode({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <div className="w-1/3 border-r border-white/8 overflow-hidden flex flex-col">{children}</div>
      <div className="flex-1 flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-center text-white/30">
          <PenTool className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Canvas coming soon</p>
        </div>
      </div>
    </div>
  );
}

function CreativeMode({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <div className="w-1/3 border-r border-white/8 overflow-hidden flex flex-col">{children}</div>
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-orange-950/20 to-purple-950/20">
        <div className="text-center text-white/30">
          <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Creative workspace coming soon</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdaptiveLayout({
  children,
  chatId,
  messages,
}: AdaptiveLayoutProps) {
  const { mode, confidence, setMode, isAutoMode, resetToAuto } = useUIMode(messages);
  const [isMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  const handleSelectMode = useCallback(
    (newMode: UIMode) => {
      if (newMode === mode && !isAutoMode) return;
      setMode(newMode);
    },
    [mode, isAutoMode, setMode]
  );

  // Mobile: always show chat only
  if (isMobile) {
    return (
      <div className="flex flex-col h-full w-full overflow-hidden">
        {children}
      </div>
    );
  }

  const resolvedChatId = chatId ?? '';

  const renderModeContent = () => {
    switch (mode) {
      case UIMode.CODE:
        return <CodeMode chatId={resolvedChatId}>{children}</CodeMode>;
      case UIMode.DOCUMENT:
        return <DocumentMode chatId={resolvedChatId}>{children}</DocumentMode>;
      case UIMode.RESEARCH:
        return <ResearchMode chatId={resolvedChatId}>{children}</ResearchMode>;
      case UIMode.DATA:
        return <DataMode chatId={resolvedChatId}>{children}</DataMode>;
      case UIMode.CANVAS:
        return <CanvasMode>{children}</CanvasMode>;
      case UIMode.CREATIVE:
        return <CreativeMode>{children}</CreativeMode>;
      case UIMode.CHAT:
      default:
        return (
          <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[#0f0f0f]">
      <ModeToolbar
        currentMode={mode}
        isAutoMode={isAutoMode}
        confidence={confidence}
        onSelectMode={handleSelectMode}
        onResetAuto={resetToAuto}
      />

      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="absolute inset-0 flex flex-col"
          >
            {renderModeContent()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
