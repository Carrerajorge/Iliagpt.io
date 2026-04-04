/**
 * OfflineManager.ts
 *
 * Central offline state management singleton for IliaGPT.
 * Detects network quality, manages status transitions (ONLINE / DEGRADED / OFFLINE),
 * integrates with the ServiceWorker registration, and notifies subscribers via a
 * simple EventEmitter-style API.
 *
 * Usage:
 *   const mgr = OfflineManager.getInstance();
 *   const unsub = mgr.subscribe(({ status }) => console.log(status));
 *   unsub(); // later
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum NetworkStatus {
  ONLINE = 'ONLINE',
  DEGRADED = 'DEGRADED',
  OFFLINE = 'OFFLINE',
}

export interface NetworkQuality {
  /** Effective connection type as reported by navigator.connection */
  effectiveType: '4g' | '3g' | '2g' | 'slow-2g' | 'unknown';
  /** Downlink bandwidth in Mbps (may be 0 if unavailable) */
  downlink: number;
  /** Round-trip time in ms measured by the last ping test */
  rtt: number;
  /** True when data saver is active */
  saveData: boolean;
}

export interface OfflineStateChangeEvent {
  status: NetworkStatus;
  quality: NetworkQuality;
  previousStatus: NetworkStatus;
  timestamp: number;
}

export type OfflineSubscriber = (event: OfflineStateChangeEvent) => void;

// Navigator Connection API (not fully typed in lib.dom.d.ts)
interface NavigatorConnection extends EventTarget {
  readonly effectiveType?: '4g' | '3g' | '2g' | 'slow-2g';
  readonly downlink?: number;
  readonly rtt?: number;
  readonly saveData?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PING_ENDPOINT = '/api/health';
const PING_TIMEOUT_MS = 4_000;
const PING_INTERVAL_ONLINE_MS = 30_000;
const PING_INTERVAL_OFFLINE_MS = 8_000;
const STATUS_DEBOUNCE_MS = 1_200;
/** RTT threshold above which we treat the connection as DEGRADED */
const DEGRADED_RTT_THRESHOLD_MS = 1_500;
/** Downlink threshold (Mbps) below which we treat as DEGRADED */
const DEGRADED_DOWNLINK_THRESHOLD_MBPS = 0.15;

// ---------------------------------------------------------------------------
// OfflineManager
// ---------------------------------------------------------------------------

export class OfflineManager {
  private static instance: OfflineManager | null = null;

  private _status: NetworkStatus = NetworkStatus.ONLINE;
  private _quality: NetworkQuality = {
    effectiveType: 'unknown',
    downlink: 0,
    rtt: 0,
    saveData: false,
  };

  private readonly subscribers = new Set<OfflineSubscriber>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private swRegistration: ServiceWorkerRegistration | null = null;

  // Pending status that has been proposed but not yet committed after debounce
  private pendingStatus: NetworkStatus | null = null;

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  private constructor() {
    // Set initial status from browser state
    this._status = navigator.onLine ? NetworkStatus.ONLINE : NetworkStatus.OFFLINE;
    this.attachBrowserListeners();
    this.attachConnectionListeners();
    this.schedulePing();
  }

  static getInstance(): OfflineManager {
    if (!OfflineManager.instance) {
      OfflineManager.instance = new OfflineManager();
    }
    return OfflineManager.instance;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  getStatus(): NetworkStatus {
    return this._status;
  }

  getQuality(): NetworkQuality {
    return { ...this._quality };
  }

  isOnline(): boolean {
    return this._status !== NetworkStatus.OFFLINE;
  }

  /**
   * Subscribe to status-change events.
   * Returns an unsubscribe function for convenience.
   */
  subscribe(callback: OfflineSubscriber): () => void {
    this.subscribers.add(callback);
    return () => this.unsubscribe(callback);
  }

  unsubscribe(callback: OfflineSubscriber): void {
    this.subscribers.delete(callback);
  }

  /**
   * Attach the app's ServiceWorker registration so the manager can
   * coordinate background-sync and SW-driven offline/online events.
   */
  setServiceWorkerRegistration(reg: ServiceWorkerRegistration): void {
    this.swRegistration = reg;
    this.listenToSWMessages();
  }

  /**
   * Trigger an immediate network check (useful after user-driven actions).
   */
  async checkNow(): Promise<NetworkStatus> {
    await this.runPingTest();
    return this._status;
  }

  // ---------------------------------------------------------------------------
  // Browser event listeners
  // ---------------------------------------------------------------------------

  private attachBrowserListeners(): void {
    window.addEventListener('online', this.handleBrowserOnline);
    window.addEventListener('offline', this.handleBrowserOffline);
  }

  private readonly handleBrowserOnline = (): void => {
    // Browser says we're online – verify with a ping before committing
    this.runPingTest().catch(() => {
      this.proposeStatus(NetworkStatus.OFFLINE);
    });
  };

  private readonly handleBrowserOffline = (): void => {
    this.proposeStatus(NetworkStatus.OFFLINE);
  };

  // ---------------------------------------------------------------------------
  // Network Information API (navigator.connection)
  // ---------------------------------------------------------------------------

  private attachConnectionListeners(): void {
    const conn = this.getConnection();
    if (!conn) return;
    conn.addEventListener('change', this.handleConnectionChange);
    this.syncQualityFromConnection(conn);
  }

  private readonly handleConnectionChange = (): void => {
    const conn = this.getConnection();
    if (!conn) return;
    this.syncQualityFromConnection(conn);
    this.evaluateStatusFromQuality();
  };

  private getConnection(): NavigatorConnection | null {
    return (navigator as unknown as { connection?: NavigatorConnection }).connection ?? null;
  }

  private syncQualityFromConnection(conn: NavigatorConnection): void {
    this._quality = {
      effectiveType: conn.effectiveType ?? 'unknown',
      downlink: conn.downlink ?? 0,
      rtt: conn.rtt ?? 0,
      saveData: conn.saveData ?? false,
    };
  }

  /** Evaluate status purely from connection quality metrics (no ping). */
  private evaluateStatusFromQuality(): void {
    if (!navigator.onLine) {
      this.proposeStatus(NetworkStatus.OFFLINE);
      return;
    }

    const isDegraded =
      this._quality.rtt > DEGRADED_RTT_THRESHOLD_MS ||
      (this._quality.downlink > 0 &&
        this._quality.downlink < DEGRADED_DOWNLINK_THRESHOLD_MBPS) ||
      this._quality.effectiveType === 'slow-2g' ||
      this._quality.effectiveType === '2g';

    this.proposeStatus(isDegraded ? NetworkStatus.DEGRADED : NetworkStatus.ONLINE);
  }

  // ---------------------------------------------------------------------------
  // Ping / latency test
  // ---------------------------------------------------------------------------

  private schedulePing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
    }
    const interval =
      this._status === NetworkStatus.OFFLINE
        ? PING_INTERVAL_OFFLINE_MS
        : PING_INTERVAL_ONLINE_MS;

    this.pingTimer = setInterval(() => {
      this.runPingTest().catch(() => {
        /* swallow – proposeStatus handles it */
      });
    }, interval);
  }

  private async runPingTest(): Promise<void> {
    const start = performance.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

      const response = await fetch(PING_ENDPOINT, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const rtt = Math.round(performance.now() - start);
      this._quality = {
        ...this._quality,
        rtt,
      };

      if (!response.ok) {
        this.proposeStatus(NetworkStatus.DEGRADED);
        return;
      }

      const isDegraded = rtt > DEGRADED_RTT_THRESHOLD_MS;
      this.proposeStatus(isDegraded ? NetworkStatus.DEGRADED : NetworkStatus.ONLINE);
    } catch {
      if (!navigator.onLine) {
        this.proposeStatus(NetworkStatus.OFFLINE);
      } else {
        // Fetch failed but browser thinks we're online – treat as degraded
        this.proposeStatus(NetworkStatus.DEGRADED);
      }
    } finally {
      // Re-schedule with interval appropriate to new status
      this.schedulePing();
    }
  }

  // ---------------------------------------------------------------------------
  // Status transitions with debounce
  // ---------------------------------------------------------------------------

  /**
   * Propose a new status. The actual transition is debounced to avoid
   * rapid flapping between states on flaky connections.
   */
  private proposeStatus(proposed: NetworkStatus): void {
    this.pendingStatus = proposed;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.commitStatus(this.pendingStatus!);
      this.pendingStatus = null;
      this.debounceTimer = null;
    }, STATUS_DEBOUNCE_MS);
  }

  private commitStatus(newStatus: NetworkStatus): void {
    if (newStatus === this._status) return;

    const previousStatus = this._status;
    this._status = newStatus;

    const event: OfflineStateChangeEvent = {
      status: newStatus,
      quality: { ...this._quality },
      previousStatus,
      timestamp: Date.now(),
    };

    this.notifySubscribers(event);
    this.notifyServiceWorker(newStatus);
    this.schedulePing(); // reset ping interval for new status
  }

  // ---------------------------------------------------------------------------
  // Subscriber notification
  // ---------------------------------------------------------------------------

  private notifySubscribers(event: OfflineStateChangeEvent): void {
    this.subscribers.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        console.error('[OfflineManager] Subscriber threw an error:', err);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // ServiceWorker integration
  // ---------------------------------------------------------------------------

  private notifyServiceWorker(status: NetworkStatus): void {
    if (!this.swRegistration?.active) return;

    this.swRegistration.active.postMessage({
      type: 'NETWORK_STATUS_CHANGE',
      payload: { status },
    });

    // When back online, request a background sync flush
    if (status === NetworkStatus.ONLINE) {
      this.requestBackgroundSync();
    }
  }

  private requestBackgroundSync(): void {
    if (!this.swRegistration) return;
    const reg = this.swRegistration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    reg.sync?.register('message-queue-sync').catch((err) => {
      console.warn('[OfflineManager] Background sync registration failed:', err);
    });
  }

  private listenToSWMessages(): void {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const { type, payload } = event.data ?? {};

      if (type === 'NETWORK_STATUS_FROM_SW') {
        const swStatus: NetworkStatus = payload?.status ?? NetworkStatus.ONLINE;
        this.proposeStatus(swStatus);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Cleanup (useful in tests)
  // ---------------------------------------------------------------------------

  destroy(): void {
    window.removeEventListener('online', this.handleBrowserOnline);
    window.removeEventListener('offline', this.handleBrowserOffline);

    const conn = this.getConnection();
    conn?.removeEventListener('change', this.handleConnectionChange);

    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);

    this.subscribers.clear();
    OfflineManager.instance = null;
  }
}
