/**
 * UIAdaptationEngine.ts
 * Singleton engine that manages adaptive UI mode detection and user preferences.
 */

import { useState, useEffect, useCallback } from 'react';
import { ContextDetector, ContextType } from './ContextDetector';
import type { Message } from '@/types/chat';

export enum UIMode {
  CHAT = 'CHAT',
  CODE = 'CODE',
  DOCUMENT = 'DOCUMENT',
  RESEARCH = 'RESEARCH',
  DATA = 'DATA',
  CANVAS = 'CANVAS',
  CREATIVE = 'CREATIVE',
}

// Map ContextType to UIMode (they share the same values)
const contextTypeToUIMode = (ct: ContextType): UIMode =>
  UIMode[ct as keyof typeof UIMode] ?? UIMode.CHAT;

export interface ModeSuggestion {
  mode: UIMode;
  confidence: number;
}

export interface ModeChangeEvent {
  mode: UIMode;
  confidence: number;
  isAuto: boolean;
}

type ModeChangeListener = (event: ModeChangeEvent) => void;

const STORAGE_KEY = 'iliaGPT_uiPrefs';
const AUTO_REVERT_MS = 30 * 60 * 1000; // 30 minutes

interface StoredPreferences {
  usageCounts: Record<string, number>;
  manualMode: UIMode | null;
  manualModeSetAt: number | null;
}

const DEFAULT_PREFS: StoredPreferences = {
  usageCounts: {},
  manualMode: null,
  manualModeSetAt: null,
};

export class UIAdaptationEngine {
  private static instance: UIAdaptationEngine | null = null;

  private detector: ContextDetector;
  private usageCounts: Map<UIMode, number>;
  private manualMode: UIMode | null = null;
  private manualModeSetAt: number | null = null;
  private currentMode: UIMode = UIMode.CHAT;
  private currentConfidence: number = 0;
  private listeners: Set<ModeChangeListener> = new Set();
  private autoRevertTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivity: number = Date.now();

  private constructor() {
    this.detector = new ContextDetector();
    this.usageCounts = new Map();
    this.loadFromStorage();
    this.scheduleAutoRevert();
  }

  static getInstance(): UIAdaptationEngine {
    if (!UIAdaptationEngine.instance) {
      UIAdaptationEngine.instance = new UIAdaptationEngine();
    }
    return UIAdaptationEngine.instance;
  }

  // ─── Storage ─────────────────────────────────────────────────────────────

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const prefs: StoredPreferences = JSON.parse(raw);

      // Restore usage counts
      for (const [key, count] of Object.entries(prefs.usageCounts ?? {})) {
        const mode = key as UIMode;
        if (Object.values(UIMode).includes(mode)) {
          this.usageCounts.set(mode, count);
        }
      }

      // Restore manual mode if still valid (within 30 min)
      if (prefs.manualMode && prefs.manualModeSetAt) {
        const elapsed = Date.now() - prefs.manualModeSetAt;
        if (elapsed < AUTO_REVERT_MS) {
          this.manualMode = prefs.manualMode;
          this.manualModeSetAt = prefs.manualModeSetAt;
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private saveToStorage(): void {
    try {
      const counts: Record<string, number> = {};
      this.usageCounts.forEach((count, mode) => {
        counts[mode] = count;
      });

      const prefs: StoredPreferences = {
        usageCounts: counts,
        manualMode: this.manualMode,
        manualModeSetAt: this.manualModeSetAt,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore storage errors
    }
  }

  // ─── Auto-revert logic ────────────────────────────────────────────────────

  private scheduleAutoRevert(): void {
    if (this.autoRevertTimer) {
      clearTimeout(this.autoRevertTimer);
    }

    if (!this.manualMode || !this.manualModeSetAt) return;

    const elapsed = Date.now() - this.manualModeSetAt;
    const remaining = AUTO_REVERT_MS - elapsed;

    if (remaining <= 0) {
      this.clearManualMode();
      return;
    }

    this.autoRevertTimer = setTimeout(() => {
      this.clearManualMode();
    }, remaining);
  }

  private clearManualMode(): void {
    this.manualMode = null;
    this.manualModeSetAt = null;
    this.saveToStorage();

    // Emit event to notify subscribers that auto mode is restored
    this.emit({
      mode: this.currentMode,
      confidence: this.currentConfidence,
      isAuto: true,
    });
  }

  // ─── Core API ─────────────────────────────────────────────────────────────

  suggestMode(messages: Message[]): ModeSuggestion {
    this.lastActivity = Date.now();

    const messageDtos = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const signals = this.detector.detect(messageDtos);
    const mode = contextTypeToUIMode(signals.type);

    // Increment usage count
    const currentCount = this.usageCounts.get(mode) ?? 0;
    this.usageCounts.set(mode, currentCount + 1);
    this.saveToStorage();

    return { mode, confidence: signals.confidence };
  }

  setMode(mode: UIMode): void {
    this.manualMode = mode;
    this.manualModeSetAt = Date.now();
    this.lastActivity = Date.now();
    this.saveToStorage();
    this.scheduleAutoRevert();

    this.emit({
      mode,
      confidence: 1.0,
      isAuto: false,
    });
  }

  /** Returns the mode that should be active given messages */
  getActiveMode(messages: Message[]): ModeChangeEvent {
    // Check if manual override is still valid
    if (this.manualMode && this.manualModeSetAt) {
      const elapsed = Date.now() - this.manualModeSetAt;
      if (elapsed < AUTO_REVERT_MS) {
        return {
          mode: this.manualMode,
          confidence: 1.0,
          isAuto: false,
        };
      } else {
        this.clearManualMode();
      }
    }

    // Auto-detect
    const suggestion = this.suggestMode(messages);
    this.currentMode = suggestion.mode;
    this.currentConfidence = suggestion.confidence;

    return {
      mode: suggestion.mode,
      confidence: suggestion.confidence,
      isAuto: true,
    };
  }

  isInManualMode(): boolean {
    if (!this.manualMode || !this.manualModeSetAt) return false;
    const elapsed = Date.now() - this.manualModeSetAt;
    return elapsed < AUTO_REVERT_MS;
  }

  getManualMode(): UIMode | null {
    return this.isInManualMode() ? this.manualMode : null;
  }

  getUsageCount(mode: UIMode): number {
    return this.usageCounts.get(mode) ?? 0;
  }

  getMostUsedMode(): UIMode {
    let best: UIMode = UIMode.CHAT;
    let bestCount = 0;

    this.usageCounts.forEach((count, mode) => {
      if (count > bestCount) {
        bestCount = count;
        best = mode;
      }
    });

    return best;
  }

  // ─── Event subscription ───────────────────────────────────────────────────

  subscribe(listener: ModeChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: ModeChangeEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    });
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.autoRevertTimer) {
      clearTimeout(this.autoRevertTimer);
    }
    this.listeners.clear();
    UIAdaptationEngine.instance = null;
  }
}

// ─── React hook ───────────────────────────────────────────────────────────────

export interface UseUIModeReturn {
  mode: UIMode;
  confidence: number;
  setMode: (mode: UIMode) => void;
  isAutoMode: boolean;
  resetToAuto: () => void;
  suggestMode: (messages: Message[]) => ModeSuggestion;
}

export function useUIMode(messages?: Message[]): UseUIModeReturn {
  const engine = UIAdaptationEngine.getInstance();

  const [modeState, setModeState] = useState<{
    mode: UIMode;
    confidence: number;
    isAuto: boolean;
  }>(() => {
    const isManual = engine.isInManualMode();
    const manualMode = engine.getManualMode();
    return {
      mode: manualMode ?? UIMode.CHAT,
      confidence: isManual ? 1.0 : 0,
      isAuto: !isManual,
    };
  });

  // Update mode when messages change
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const event = engine.getActiveMode(messages);
    setModeState({
      mode: event.mode,
      confidence: event.confidence,
      isAuto: event.isAuto,
    });
  }, [messages, engine]);

  // Subscribe to external mode changes (e.g., auto-revert)
  useEffect(() => {
    const unsubscribe = engine.subscribe((event) => {
      setModeState({
        mode: event.mode,
        confidence: event.confidence,
        isAuto: event.isAuto,
      });
    });
    return unsubscribe;
  }, [engine]);

  const setMode = useCallback(
    (mode: UIMode) => {
      engine.setMode(mode);
      setModeState({ mode, confidence: 1.0, isAuto: false });
    },
    [engine]
  );

  const resetToAuto = useCallback(() => {
    // Force auto-detection by clearing manual mode via a private-like approach
    // We re-suggest based on current messages
    const currentMessages = messages ?? [];
    if (currentMessages.length > 0) {
      const suggestion = engine.suggestMode(currentMessages);
      setModeState({
        mode: suggestion.mode,
        confidence: suggestion.confidence,
        isAuto: true,
      });
    } else {
      setModeState({ mode: UIMode.CHAT, confidence: 0, isAuto: true });
    }
  }, [engine, messages]);

  const suggestModeFn = useCallback(
    (msgs: Message[]) => engine.suggestMode(msgs),
    [engine]
  );

  return {
    mode: modeState.mode,
    confidence: modeState.confidence,
    setMode,
    isAutoMode: modeState.isAuto,
    resetToAuto,
    suggestMode: suggestModeFn,
  };
}
