/**
 * AdaptiveLayout.tsx
 *
 * Top-level layout wrapper that responds to UIAdaptationEngine suggestions.
 * Renders the appropriate mode component (CodeMode, ResearchMode, or the
 * default children) with Framer Motion cross-fade transitions, and shows
 * a dismissible toast banner whenever the layout mode switches.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutMode,
  AdaptationSuggestion,
  getUIAdaptationEngine,
} from '../../lib/adaptiveUI/UIAdaptationEngine';
import { Message } from '../../lib/adaptiveUI/ContextDetector';
import CodeMode from './CodeMode';
import ResearchMode from './ResearchMode';

// ─── Context ──────────────────────────────────────────────────────────────────

interface UIAdaptationContextValue {
  currentMode: LayoutMode;
  setMode: (mode: LayoutMode) => void;
  lastSuggestion: AdaptationSuggestion | null;
  isManualOverride: boolean;
  enableAutoAdaptation: () => void;
}

const UIAdaptationContext = createContext<UIAdaptationContextValue>({
  currentMode: 'default',
  setMode: () => {},
  lastSuggestion: null,
  isManualOverride: false,
  enableAutoAdaptation: () => {},
});

/** Access the current adaptive layout mode and control functions */
export function useUIAdaptation(): UIAdaptationContextValue {
  return useContext(UIAdaptationContext);
}

// ─── Mode metadata ────────────────────────────────────────────────────────────

const MODE_META: Record<LayoutMode, { label: string; icon: string; color: string }> = {
  default:  { label: 'Default',   icon: '💬', color: 'bg-gray-700' },
  code:     { label: 'Code',      icon: '⌨️', color: 'bg-indigo-700' },
  research: { label: 'Research',  icon: '🔬', color: 'bg-emerald-700' },
  data:     { label: 'Data',      icon: '📊', color: 'bg-amber-700' },
  document: { label: 'Document',  icon: '📄', color: 'bg-sky-700' },
};

const ALL_MODES: LayoutMode[] = ['default', 'code', 'research', 'data', 'document'];

// ─── Mode Switch Toast ────────────────────────────────────────────────────────

interface ModeSwitchToastProps {
  mode: LayoutMode;
  onDismiss: () => void;
}

function ModeSwitchToast({ mode, onDismiss }: ModeSwitchToastProps) {
  const meta = MODE_META[mode];

  useEffect(() => {
    const id = setTimeout(onDismiss, 4000);
    return () => clearTimeout(id);
  }, [mode, onDismiss]);

  return (
    <motion.div
      key={`toast-${mode}`}
      initial={{ opacity: 0, y: -24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16, scale: 0.95 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full text-white text-sm font-medium shadow-lg ${meta.color} backdrop-blur-sm`}
    >
      <span>{meta.icon}</span>
      <span>Switched to <strong>{meta.label} Mode</strong></span>
      <button
        onClick={onDismiss}
        className="ml-2 opacity-70 hover:opacity-100 transition-opacity text-xs"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </motion.div>
  );
}

// ─── Mode Toolbar ─────────────────────────────────────────────────────────────

interface ModeToolbarProps {
  currentMode: LayoutMode;
  isManualOverride: boolean;
  onSelectMode: (mode: LayoutMode) => void;
  onEnableAuto: () => void;
}

function ModeToolbar({ currentMode, isManualOverride, onSelectMode, onEnableAuto }: ModeToolbarProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium transition-colors border border-gray-600"
        title="Switch layout mode"
      >
        <span>{MODE_META[currentMode].icon}</span>
        <span>{MODE_META[currentMode].label}</span>
        <span className="text-gray-400 ml-1">{open ? '▲' : '▼'}</span>
        {isManualOverride && (
          <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-400" title="Manual override active" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1 z-40 bg-gray-800 border border-gray-600 rounded-xl shadow-xl overflow-hidden min-w-[160px]"
          >
            {ALL_MODES.map(m => (
              <button
                key={m}
                onClick={() => { onSelectMode(m); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                  m === currentMode
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span>{MODE_META[m].icon}</span>
                <span>{MODE_META[m].label}</span>
                {m === currentMode && <span className="ml-auto text-gray-400">✓</span>}
              </button>
            ))}

            {isManualOverride && (
              <>
                <div className="border-t border-gray-700 my-1" />
                <button
                  onClick={() => { onEnableAuto(); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-400 hover:bg-gray-700 transition-colors"
                >
                  <span>↩</span>
                  <span>Resume auto-detect</span>
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Layout variants ──────────────────────────────────────────────────────────

const layoutVariants = {
  enter: { opacity: 0, scale: 0.985, filter: 'blur(2px)' },
  center: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 1.01, filter: 'blur(2px)' },
};

// ─── AdaptiveLayout ───────────────────────────────────────────────────────────

export interface AdaptiveLayoutProps {
  /** Messages driving the context detection */
  messages?: Message[];
  /** Default layout content (rendered when mode is 'default' or 'document') */
  children: React.ReactNode;
  /** Show the mode toolbar. Default: true */
  showToolbar?: boolean;
  /** Interval in ms for re-running analysis. Default: 2000 */
  analysisInterval?: number;
  /** Extra classes for the root wrapper */
  className?: string;
}

export default function AdaptiveLayout({
  messages = [],
  children,
  showToolbar = true,
  analysisInterval = 2000,
  className = '',
}: AdaptiveLayoutProps) {
  const engine = getUIAdaptationEngine();

  const [currentMode, setCurrentModeState] = useState<LayoutMode>(engine.getCurrentMode());
  const [toastMode, setToastMode] = useState<LayoutMode | null>(null);
  const [isManualOverride, setIsManualOverride] = useState(false);
  const [lastSuggestion, setLastSuggestion] = useState<AdaptationSuggestion | null>(null);
  const prevModeRef = useRef<LayoutMode>(currentMode);

  // Subscribe to engine events
  useEffect(() => {
    const unsub = engine.on('suggestion', (suggestion) => {
      setLastSuggestion(suggestion);
      if (!isManualOverride && suggestion.mode !== prevModeRef.current) {
        prevModeRef.current = suggestion.mode;
        setCurrentModeState(suggestion.mode);
        setToastMode(suggestion.mode);
      }
    });
    return unsub;
  }, [engine, isManualOverride]);

  // Periodic analysis
  useEffect(() => {
    if (isManualOverride || messages.length === 0) return;
    const id = setInterval(() => {
      engine.analyzeMessages(messages);
    }, analysisInterval);
    return () => clearInterval(id);
  }, [engine, messages, analysisInterval, isManualOverride]);

  // Also run immediately when messages change
  useEffect(() => {
    if (!isManualOverride && messages.length > 0) {
      engine.analyzeMessages(messages);
    }
  }, [messages, isManualOverride, engine]);

  const setMode = useCallback((mode: LayoutMode) => {
    setIsManualOverride(true);
    engine.forceMode(mode);
    prevModeRef.current = mode;
    setCurrentModeState(mode);
    setToastMode(mode);
  }, [engine]);

  const enableAutoAdaptation = useCallback(() => {
    setIsManualOverride(false);
    engine.reset();
  }, [engine]);

  const dismissToast = useCallback(() => setToastMode(null), []);

  const contextValue: UIAdaptationContextValue = {
    currentMode,
    setMode,
    lastSuggestion,
    isManualOverride,
    enableAutoAdaptation,
  };

  return (
    <UIAdaptationContext.Provider value={contextValue}>
      <div className={`relative flex flex-col h-full w-full bg-gray-900 text-gray-100 ${className}`}>
        {/* Toolbar */}
        {showToolbar && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm z-30">
            <span className="text-xs text-gray-500 font-mono">
              {isManualOverride ? 'Manual mode' : 'Auto-detecting…'}
            </span>
            <ModeToolbar
              currentMode={currentMode}
              isManualOverride={isManualOverride}
              onSelectMode={setMode}
              onEnableAuto={enableAutoAdaptation}
            />
          </div>
        )}

        {/* Toast notification */}
        <AnimatePresence>
          {toastMode !== null && (
            <ModeSwitchToast key={toastMode} mode={toastMode} onDismiss={dismissToast} />
          )}
        </AnimatePresence>

        {/* Mode content with animated transitions */}
        <div className="flex-1 overflow-hidden relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentMode}
              variants={layoutVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="absolute inset-0 flex flex-col"
            >
              {currentMode === 'code' ? (
                <CodeMode>{children}</CodeMode>
              ) : currentMode === 'research' ? (
                <ResearchMode>{children}</ResearchMode>
              ) : (
                // Default, data, and document modes render the children as-is.
                // (Data and document modes could get their own components in future.)
                <div className="h-full w-full overflow-auto">
                  {children}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </UIAdaptationContext.Provider>
  );
}
