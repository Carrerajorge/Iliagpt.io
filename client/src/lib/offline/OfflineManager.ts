/**
 * OfflineManager.ts
 * Network state detection, offline/online mode switching, and reconnect logic.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NetworkStatus = 'online' | 'offline' | 'slow';

export type NetworkQuality = 'unknown' | '2g' | '3g' | '4g' | 'wifi';

export interface NetworkInfo {
  status: NetworkStatus;
  quality: NetworkQuality;
  /** Round-trip time in ms from last connectivity check */
  rtt: number | null;
  /** Effective downlink in Mbps (from Network Information API) */
  downlink: number | null;
  /** Timestamp of last successful connectivity check */
  lastChecked: number | null;
}

export type OfflineManagerEvent =
  | 'statusChange'
  | 'online'
  | 'offline'
  | 'slow'
  | 'reconnecting'
  | 'reconnectFailed'
  | 'qualityChange';

export type EventListener<T = unknown> = (payload: T) => void;

export interface StatusChangePayload {
  previous: NetworkStatus;
  current: NetworkStatus;
  networkInfo: NetworkInfo;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Endpoint used for connectivity probes (small, cacheless resource). */
const PROBE_URL = '/favicon.ico';
const PROBE_TIMEOUT_MS = 5_000;
const SLOW_RTT_THRESHOLD_MS = 1_500;

/** Reconnect schedule: base delay, multiplier, max delay (all in ms). */
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MULTIPLIER = 2;
const BACKOFF_MAX_MS = 60_000;
const BACKOFF_JITTER_RATIO = 0.2;

/** How often (ms) to poll when online to detect degraded connections. */
const ONLINE_POLL_INTERVAL_MS = 30_000;
/** How often (ms) to poll when offline for reconnect probing. */
const OFFLINE_POLL_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jittered(value: number, ratio: number): number {
  const jitter = value * ratio * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(value + jitter));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// OfflineManager
// ---------------------------------------------------------------------------

class OfflineManager {
  // -- Internal state -------------------------------------------------------

  private _networkInfo: NetworkInfo = {
    status: navigator.onLine ? 'online' : 'offline',
    quality: 'unknown',
    rtt: null,
    downlink: null,
    lastChecked: null,
  };

  /** Registered event listeners keyed by event name. */
  private _listeners: Map<OfflineManagerEvent, Set<EventListener<unknown>>> =
    new Map();

  /** Timer handle for periodic connectivity polls. */
  private _pollTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether the manager has been started. */
  private _started = false;

  /** Number of consecutive reconnect failures (used for exponential backoff). */
  private _reconnectAttempts = 0;

  /** Whether a probe is currently in flight. */
  private _probing = false;

  // -- Lifecycle ------------------------------------------------------------

  /**
   * Initialise network listeners and start polling.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  start(): void {
    if (this._started) return;
    this._started = true;

    // Browser online/offline events give us fast signals (not always accurate).
    window.addEventListener('online', this._handleBrowserOnline);
    window.addEventListener('offline', this._handleBrowserOffline);

    // Network Information API (Chrome/Android).
    const conn = this._getConnection();
    if (conn) {
      conn.addEventListener('change', this._handleConnectionChange);
    }

    // Seed with an immediate probe.
    void this._probe();
  }

  /** Tear down all listeners and timers. */
  stop(): void {
    if (!this._started) return;
    this._started = false;

    window.removeEventListener('online', this._handleBrowserOnline);
    window.removeEventListener('offline', this._handleBrowserOffline);

    const conn = this._getConnection();
    if (conn) {
      conn.removeEventListener('change', this._handleConnectionChange);
    }

    this._clearPollTimer();
  }

  // -- Public API -----------------------------------------------------------

  /** Current snapshot of network information. */
  get networkInfo(): Readonly<NetworkInfo> {
    return { ...this._networkInfo };
  }

  get status(): NetworkStatus {
    return this._networkInfo.status;
  }

  get isOnline(): boolean {
    return this._networkInfo.status !== 'offline';
  }

  get isOffline(): boolean {
    return this._networkInfo.status === 'offline';
  }

  /** Manually trigger an immediate connectivity check. */
  async checkNow(): Promise<NetworkStatus> {
    await this._probe();
    return this._networkInfo.status;
  }

  // -- EventEmitter pattern -------------------------------------------------

  on<T = unknown>(event: OfflineManagerEvent, listener: EventListener<T>): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(listener as EventListener<unknown>);

    // Return an unsubscribe function.
    return () => this.off(event, listener);
  }

  off<T = unknown>(event: OfflineManagerEvent, listener: EventListener<T>): void {
    this._listeners.get(event)?.delete(listener as EventListener<unknown>);
  }

  once<T = unknown>(event: OfflineManagerEvent, listener: EventListener<T>): () => void {
    const wrapper: EventListener<T> = (payload) => {
      listener(payload);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  private _emit<T>(event: OfflineManagerEvent, payload: T): void {
    this._listeners.get(event)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[OfflineManager] Error in "${event}" listener:`, err);
      }
    });
  }

  // -- Browser event handlers -----------------------------------------------

  private _handleBrowserOnline = (): void => {
    // Browser thinks we're online — probe to confirm.
    void this._probe();
  };

  private _handleBrowserOffline = (): void => {
    this._applyStatus('offline');
    this._scheduleReconnectPoll();
  };

  private _handleConnectionChange = (): void => {
    void this._probe();
  };

  // -- Connectivity probing -------------------------------------------------

  private async _probe(): Promise<void> {
    if (this._probing) return;
    this._probing = true;

    try {
      const result = await this._fetchProbe();

      const previousStatus = this._networkInfo.status;

      // Determine status from RTT.
      let newStatus: NetworkStatus;
      if (result === null) {
        newStatus = 'offline';
      } else if (result > SLOW_RTT_THRESHOLD_MS) {
        newStatus = 'slow';
      } else {
        newStatus = 'online';
      }

      // Update RTT and quality from Network Information API.
      const conn = this._getConnection();
      const downlink = conn?.downlink ?? null;
      const quality = this._resolveQuality(conn);

      const qualityChanged = quality !== this._networkInfo.quality;

      this._networkInfo = {
        ...this._networkInfo,
        status: newStatus,
        quality,
        rtt: result,
        downlink,
        lastChecked: Date.now(),
      };

      if (qualityChanged) {
        this._emit('qualityChange', { quality, networkInfo: this.networkInfo });
      }

      this._applyStatus(newStatus, previousStatus);

      if (newStatus !== 'offline') {
        // Successful probe — reset backoff counter.
        this._reconnectAttempts = 0;
        this._schedulePoll(ONLINE_POLL_INTERVAL_MS);
      } else {
        this._scheduleReconnectPoll();
      }
    } finally {
      this._probing = false;
    }
  }

  /**
   * Fetch the probe URL and return the RTT in ms, or null on failure.
   */
  private async _fetchProbe(): Promise<number | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    const start = performance.now();
    try {
      const response = await fetch(`${PROBE_URL}?_=${Date.now()}`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal,
      });
      const rtt = Math.round(performance.now() - start);
      return response.ok ? rtt : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // -- Status application ---------------------------------------------------

  private _applyStatus(
    newStatus: NetworkStatus,
    previousStatus: NetworkStatus = this._networkInfo.status
  ): void {
    if (newStatus === previousStatus) return;

    this._networkInfo = { ...this._networkInfo, status: newStatus };

    const payload: StatusChangePayload = {
      previous: previousStatus,
      current: newStatus,
      networkInfo: this.networkInfo,
    };

    this._emit('statusChange', payload);
    this._emit(newStatus, payload);

    if (newStatus !== 'offline' && previousStatus === 'offline') {
      this._reconnectAttempts = 0;
    }
  }

  // -- Polling helpers ------------------------------------------------------

  private _scheduleReconnectPoll(): void {
    this._clearPollTimer();

    const delay = this._nextBackoffDelay();
    this._emit('reconnecting', {
      attempt: this._reconnectAttempts,
      nextRetryMs: delay,
    });

    this._reconnectAttempts += 1;
    this._schedulePoll(delay);
  }

  private _schedulePoll(delayMs: number): void {
    this._clearPollTimer();
    this._pollTimer = setTimeout(() => {
      void this._probe();
    }, delayMs);
  }

  private _clearPollTimer(): void {
    if (this._pollTimer !== null) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private _nextBackoffDelay(): number {
    const raw = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, this._reconnectAttempts);
    const clamped = clamp(raw, BACKOFF_BASE_MS, BACKOFF_MAX_MS);
    return jittered(clamped, BACKOFF_JITTER_RATIO);
  }

  // -- Network Information API helpers --------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _getConnection(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _resolveQuality(conn: any): NetworkQuality {
    if (!conn) return 'unknown';
    const effectiveType: string = conn.effectiveType ?? '';
    switch (effectiveType) {
      case '2g':
        return '2g';
      case '3g':
        return '3g';
      case '4g':
        return '4g';
      default:
        // If downlink is high enough, treat as wifi-equivalent.
        if (typeof conn.downlink === 'number' && conn.downlink > 5) {
          return 'wifi';
        }
        return 'unknown';
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const offlineManager = new OfflineManager();

// Auto-start when this module is imported in a browser context.
if (typeof window !== 'undefined') {
  offlineManager.start();
}

export default offlineManager;
