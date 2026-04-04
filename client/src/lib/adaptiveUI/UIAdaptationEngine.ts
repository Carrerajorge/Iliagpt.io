/**
 * UIAdaptationEngine.ts
 *
 * Detects conversation context and suggests a layout mode for the UI.
 * Implements hysteresis to prevent rapid mode flapping: a mode is only
 * suggested after it has been the dominant context for N consecutive checks.
 *
 * Emits 'suggestion' events so consumers can react without polling.
 */

import { ContextDetector, ContextSignals, Message } from './ContextDetector';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LayoutMode = 'default' | 'code' | 'research' | 'data' | 'document';

export interface AdaptationSuggestion {
  mode: LayoutMode;
  confidence: number;
  reason: string;
  signals: ContextSignals;
  timestamp: number;
}

export interface UIAdaptationEngineConfig {
  /**
   * Minimum confidence score (0–1) that a context must reach before
   * it is even considered as a candidate for suggestion. (default: 0.4)
   */
  confidenceThreshold: number;

  /**
   * Number of consecutive analyzeMessages() calls the candidate mode must
   * remain dominant before the engine emits a suggestion. (default: 3)
   */
  hysteresisCount: number;

  /**
   * If the current mode's confidence drops below this value the engine
   * will re-evaluate immediately, ignoring hysteresis. (default: 0.2)
   */
  dropoutThreshold: number;

  /**
   * Configuration passed through to the internal ContextDetector.
   */
  detectorConfig?: {
    windowSize?: number;
    recencyBias?: number;
    noiseFloor?: number;
  };
}

type EventListener = (suggestion: AdaptationSuggestion) => void;

// ─── Utility ──────────────────────────────────────────────────────────────────

function buildReason(mode: LayoutMode, signals: ContextSignals): string {
  switch (mode) {
    case 'code':
      return `Code patterns detected (score ${(signals.code * 100).toFixed(0)}%): code blocks, keywords, or error traces found in recent messages.`;
    case 'research':
      return `Research patterns detected (score ${(signals.research * 100).toFixed(0)}%): citations, URLs, academic keywords found.`;
    case 'data':
      return `Data patterns detected (score ${(signals.data * 100).toFixed(0)}%): tables, CSV references, statistical terms found.`;
    case 'document':
      return `Document patterns detected (score ${(signals.document * 100).toFixed(0)}%): editing, drafting, and formatting keywords found.`;
    default:
      return 'No strong context signals; using default layout.';
  }
}

function dominantToLayoutMode(dominant: ContextSignals['dominant']): LayoutMode {
  if (dominant === 'default') return 'default';
  return dominant as LayoutMode;
}

// ─── UIAdaptationEngine ───────────────────────────────────────────────────────

const DEFAULT_CONFIG: UIAdaptationEngineConfig = {
  confidenceThreshold: 0.4,
  hysteresisCount: 3,
  dropoutThreshold: 0.2,
};

export class UIAdaptationEngine {
  private config: UIAdaptationEngineConfig;
  private detector: ContextDetector;

  /** Current active (committed) mode */
  private currentMode: LayoutMode = 'default';

  /** Candidate mode being tracked for hysteresis */
  private candidateMode: LayoutMode = 'default';

  /** How many consecutive checks the candidate has been dominant */
  private candidateStreak: number = 0;

  /** Last emitted suggestion */
  private lastSuggestion: AdaptationSuggestion | null = null;

  /** Event listeners */
  private listeners: Map<string, Set<EventListener>> = new Map();

  constructor(config: Partial<UIAdaptationEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.detector = new ContextDetector(this.config.detectorConfig);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Analyze a list of conversation messages and return an adaptation suggestion.
   * Internally applies hysteresis so the returned suggestion may reflect the
   * *current committed mode* until the candidate has been stable for N checks.
   */
  analyzeMessages(messages: Message[]): AdaptationSuggestion {
    const signals = this.detector.detectContext(messages);
    const { confidenceThreshold, hysteresisCount, dropoutThreshold } = this.config;

    const candidateLayoutMode = dominantToLayoutMode(signals.dominant);
    const candidateScore = signals[signals.dominant === 'default' ? 'code' : signals.dominant] ?? 0;

    // ── Early-exit: confidence too low → stay on current mode ──────────────
    if (signals.dominant !== 'default' && candidateScore < confidenceThreshold) {
      return this.buildSuggestion(this.currentMode, candidateScore, signals, 'Confidence below threshold; maintaining current mode.');
    }

    // ── Dropout: current mode confidence collapsed → reset hysteresis ──────
    const currentModeScore = this.currentMode === 'default'
      ? 0
      : (signals[this.currentMode] ?? 0);

    if (this.currentMode !== 'default' && currentModeScore < dropoutThreshold) {
      // Immediately allow re-evaluation
      this.candidateStreak = 0;
      this.candidateMode = candidateLayoutMode;
    }

    // ── Hysteresis logic ───────────────────────────────────────────────────
    if (candidateLayoutMode === this.candidateMode) {
      this.candidateStreak++;
    } else {
      // A different mode has become dominant — reset streak
      this.candidateMode = candidateLayoutMode;
      this.candidateStreak = 1;
    }

    let suggestedMode: LayoutMode;
    if (this.candidateStreak >= hysteresisCount) {
      // Promote candidate to current mode
      suggestedMode = this.candidateMode;
      this.currentMode = suggestedMode;
    } else {
      // Not enough consecutive checks yet — hold the current mode
      suggestedMode = this.currentMode;
    }

    const suggestion = this.buildSuggestion(suggestedMode, candidateScore, signals, buildReason(suggestedMode, signals));
    this.lastSuggestion = suggestion;

    // Emit event if mode changed
    if (!this.lastSuggestion || this.lastSuggestion.mode !== suggestion.mode || this.lastSuggestion.timestamp !== suggestion.timestamp) {
      this.emit('suggestion', suggestion);
    }

    return suggestion;
  }

  /**
   * Force a mode override, bypassing hysteresis.
   * Useful when the user manually selects a mode via toolbar.
   */
  forceMode(mode: LayoutMode): AdaptationSuggestion {
    this.currentMode = mode;
    this.candidateMode = mode;
    this.candidateStreak = this.config.hysteresisCount; // satisfy hysteresis immediately

    const emptySignals: ContextSignals = {
      code: 0, research: 0, data: 0, document: 0,
      dominant: mode === 'default' ? 'default' : mode,
      raw: { code: 0, research: 0, data: 0, document: 0 },
      sampledMessages: 0,
    };
    const suggestion = this.buildSuggestion(mode, 1, emptySignals, `Mode manually overridden to '${mode}'.`);
    this.lastSuggestion = suggestion;
    this.emit('suggestion', suggestion);
    return suggestion;
  }

  /** Returns the current committed mode without running analysis */
  getCurrentMode(): LayoutMode {
    return this.currentMode;
  }

  /** Returns the last suggestion that was emitted */
  getLastSuggestion(): AdaptationSuggestion | null {
    return this.lastSuggestion;
  }

  /** Reset engine state (useful on conversation clear) */
  reset(): void {
    this.currentMode = 'default';
    this.candidateMode = 'default';
    this.candidateStreak = 0;
    this.lastSuggestion = null;
  }

  /** Update engine configuration at runtime */
  configure(config: Partial<UIAdaptationEngineConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.detectorConfig) {
      this.detector.configure(config.detectorConfig);
    }
  }

  // ── Event Emitter ──────────────────────────────────────────────────────────

  on(event: 'suggestion', listener: EventListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    // Return unsubscribe function
    return () => this.off(event, listener);
  }

  off(event: 'suggestion', listener: EventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: 'suggestion', suggestion: AdaptationSuggestion): void {
    this.listeners.get(event)?.forEach(listener => {
      try {
        listener(suggestion);
      } catch (err) {
        console.error('[UIAdaptationEngine] Listener threw:', err);
      }
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildSuggestion(
    mode: LayoutMode,
    confidence: number,
    signals: ContextSignals,
    reason: string,
  ): AdaptationSuggestion {
    return {
      mode,
      confidence: Math.min(1, Math.max(0, confidence)),
      reason,
      signals,
      timestamp: Date.now(),
    };
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let _instance: UIAdaptationEngine | null = null;

/** Returns a shared singleton instance of UIAdaptationEngine */
export function getUIAdaptationEngine(config?: Partial<UIAdaptationEngineConfig>): UIAdaptationEngine {
  if (!_instance) {
    _instance = new UIAdaptationEngine(config);
  }
  return _instance;
}

/** Replace the singleton (useful in tests or on settings change) */
export function resetUIAdaptationEngine(config?: Partial<UIAdaptationEngineConfig>): UIAdaptationEngine {
  _instance = new UIAdaptationEngine(config);
  return _instance;
}

export default UIAdaptationEngine;
