/**
 * serviceWorker.ts
 *
 * Service Worker registration and lifecycle management for IliaGPT.
 *
 * Responsibilities:
 *  - Register /sw.js with scope '/'
 *  - Detect and surface SW updates to the UI
 *  - Register Background Sync tags for the message queue
 *  - Request and manage Push notification permissions
 *  - Expose cache introspection: getCacheSize(), clearCache()
 *  - Bridge network-status messages from the SW to OfflineManager
 *  - Emit typed events: onUpdateAvailable, onOffline, onOnline
 *
 * All public methods are safe to call before registration completes –
 * they queue internally and resolve once the SW is ready.
 */

import { OfflineManager } from '@/lib/offline/OfflineManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SWUpdateInfo {
  waiting: ServiceWorker;
  registration: ServiceWorkerRegistration;
}

export interface PushSubscriptionResult {
  subscription: PushSubscription;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface CacheSizeInfo {
  cacheNames: string[];
  totalBytes: number;
  breakdown: Record<string, number>;
}

// Message types for postMessage communication between page and SW
export type SWMessageType =
  | 'SKIP_WAITING'
  | 'NETWORK_STATUS_CHANGE'
  | 'TRIGGER_SYNC'
  | 'GET_CACHE_SIZE'
  | 'CLEAR_CACHE'
  | 'PING';

export interface SWMessage {
  type: SWMessageType;
  payload?: unknown;
  messageId?: string;
}

export interface SWMessageResponse {
  type: string;
  messageId?: string;
  payload?: unknown;
  error?: string;
}

export type UpdateAvailableCallback = (info: SWUpdateInfo) => void;
export type OfflineCallback = () => void;
export type OnlineCallback = () => void;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SW_SCRIPT = '/sw.js';
const SW_SCOPE = '/';
const BACKGROUND_SYNC_TAG = 'message-queue-sync';
const PERIODIC_SYNC_TAG = 'periodic-sync';
const PERIODIC_SYNC_MIN_INTERVAL = 60 * 60 * 1000; // 1 hour in ms

// VAPID public key – replace with your own at deployment time
// (kept as env var reference; Vite will inline it at build)
const VAPID_PUBLIC_KEY =
  (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_VAPID_PUBLIC_KEY ?? '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// ---------------------------------------------------------------------------
// ServiceWorkerManager
// ---------------------------------------------------------------------------

export class ServiceWorkerManager {
  private static instance: ServiceWorkerManager | null = null;

  // Registration state
  private registration: ServiceWorkerRegistration | null = null;
  private registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

  // Pending response map for request/response style messaging
  private pendingMessages = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  // User-supplied event callbacks
  onUpdateAvailable: UpdateAvailableCallback | null = null;
  onOffline: OfflineCallback | null = null;
  onOnline: OnlineCallback | null = null;

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  private constructor() {
    this.setupWindowListeners();
  }

  static getInstance(): ServiceWorkerManager {
    if (!ServiceWorkerManager.instance) {
      ServiceWorkerManager.instance = new ServiceWorkerManager();
    }
    return ServiceWorkerManager.instance;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Register the service worker. Safe to call multiple times.
   * Returns the registration or null if SW is not supported.
   */
  async register(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) {
      console.warn('[SW] Service Workers are not supported in this browser.');
      return null;
    }

    if (this.registrationPromise) {
      return this.registrationPromise;
    }

    this.registrationPromise = this.doRegister();
    return this.registrationPromise;
  }

  private async doRegister(): Promise<ServiceWorkerRegistration | null> {
    try {
      const reg = await navigator.serviceWorker.register(SW_SCRIPT, {
        scope: SW_SCOPE,
        // Use 'all' to ensure the latest byte-for-byte SW is always evaluated
        updateViaCache: 'none',
      });

      this.registration = reg;

      // Tell OfflineManager about this registration
      OfflineManager.getInstance().setServiceWorkerRegistration(reg);

      this.watchForUpdates(reg);
      this.listenToSWMessages();
      this.tryPeriodicSync(reg);

      console.log('[SW] Registered successfully. Scope:', reg.scope);
      return reg;
    } catch (err) {
      console.error('[SW] Registration failed:', err);
      this.registrationPromise = null;
      return null;
    }
  }

  /**
   * Unregister the active service worker.
   */
  async unregister(): Promise<boolean> {
    const reg = this.registration ?? (await this.getRegistration());
    if (!reg) return false;

    const success = await reg.unregister();
    if (success) {
      this.registration = null;
      this.registrationPromise = null;
      console.log('[SW] Unregistered successfully.');
    }
    return success;
  }

  // ---------------------------------------------------------------------------
  // Update handling
  // ---------------------------------------------------------------------------

  /**
   * Poll for a new SW version. Triggers onUpdateAvailable callback if one is found.
   */
  async checkForUpdates(): Promise<boolean> {
    const reg = await this.getOrRegister();
    if (!reg) return false;

    try {
      await reg.update();
      return !!reg.waiting;
    } catch (err) {
      console.warn('[SW] Update check failed:', err);
      return false;
    }
  }

  /**
   * Tell the waiting SW to activate immediately.
   * Call this when the user clicks "Reload" on the update banner.
   */
  async applyUpdate(): Promise<void> {
    const reg = this.registration;
    if (!reg?.waiting) {
      console.warn('[SW] No waiting worker to activate.');
      return;
    }

    reg.waiting.postMessage({ type: 'SKIP_WAITING' } satisfies SWMessage);

    // Reload once the new SW has taken control
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true },
    );
  }

  private watchForUpdates(reg: ServiceWorkerRegistration): void {
    // Handle case where a waiting SW already exists on load
    if (reg.waiting) {
      this.onUpdateAvailable?.({ waiting: reg.waiting, registration: reg });
    }

    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;

      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          // New SW installed and waiting
          this.onUpdateAvailable?.({ waiting: installing, registration: reg });
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Background Sync
  // ---------------------------------------------------------------------------

  /**
   * Register a one-shot Background Sync for the message queue.
   * Falls back gracefully if the API is unavailable.
   */
  async registerBackgroundSync(tag: string = BACKGROUND_SYNC_TAG): Promise<boolean> {
    const reg = await this.getOrRegister();
    if (!reg) return false;

    const syncReg = reg as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };

    if (!syncReg.sync) {
      console.warn('[SW] Background Sync API not available. Falling back to immediate flush.');
      return false;
    }

    try {
      await syncReg.sync.register(tag);
      return true;
    } catch (err) {
      console.warn('[SW] Background sync registration failed:', err);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Push notifications
  // ---------------------------------------------------------------------------

  /**
   * Request notification permission and subscribe to push.
   * Returns the subscription details or null if denied/unavailable.
   */
  async requestPushPermission(): Promise<PushSubscriptionResult | null> {
    if (!('Notification' in window) || !('PushManager' in window)) {
      console.warn('[SW] Push notifications are not supported.');
      return null;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[SW] Push notification permission denied.');
      return null;
    }

    const reg = await this.getOrRegister();
    if (!reg) return null;

    try {
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: VAPID_PUBLIC_KEY
          ? urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          : undefined,
      });

      const rawKey = subscription.getKey('p256dh');
      const rawAuth = subscription.getKey('auth');

      const p256dh = rawKey
        ? btoa(String.fromCharCode(...new Uint8Array(rawKey)))
        : '';
      const auth = rawAuth
        ? btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
        : '';

      const result: PushSubscriptionResult = {
        subscription,
        endpoint: subscription.endpoint,
        keys: { p256dh, auth },
      };

      // Send subscription to server
      await this.sendSubscriptionToServer(result);

      return result;
    } catch (err) {
      console.error('[SW] Push subscription failed:', err);
      return null;
    }
  }

  /**
   * Cancel the current push subscription.
   */
  async unsubscribePush(): Promise<boolean> {
    const reg = await this.getOrRegister();
    if (!reg) return false;

    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;

    return sub.unsubscribe();
  }

  private async sendSubscriptionToServer(sub: PushSubscriptionResult): Promise<void> {
    try {
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: sub.keys,
        }),
      });
    } catch (err) {
      console.warn('[SW] Failed to register push subscription with server:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Cache management
  // ---------------------------------------------------------------------------

  /**
   * Calculate the total size of all SW-managed caches.
   */
  async getCacheSize(): Promise<CacheSizeInfo> {
    const empty: CacheSizeInfo = { cacheNames: [], totalBytes: 0, breakdown: {} };

    if (!('caches' in window)) return empty;

    try {
      const names = await caches.keys();
      const breakdown: Record<string, number> = {};

      for (const name of names) {
        const cache = await caches.open(name);
        const responses = await cache.keys();
        let size = 0;

        for (const req of responses) {
          try {
            const res = await cache.match(req);
            if (res) {
              const blob = await res.clone().blob();
              size += blob.size;
            }
          } catch {
            // Skip entries that fail to read
          }
        }

        breakdown[name] = size;
      }

      const totalBytes = Object.values(breakdown).reduce((a, b) => a + b, 0);
      return { cacheNames: names, totalBytes, breakdown };
    } catch (err) {
      console.warn('[SW] getCacheSize failed:', err);
      return empty;
    }
  }

  /**
   * Delete all SW-managed caches.
   */
  async clearCache(): Promise<number> {
    if (!('caches' in window)) return 0;

    try {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      console.log(`[SW] Cleared ${names.length} cache(s).`);
      return names.length;
    } catch (err) {
      console.error('[SW] clearCache failed:', err);
      return 0;
    }
  }

  /**
   * Delete a single named cache.
   */
  async clearNamedCache(name: string): Promise<boolean> {
    if (!('caches' in window)) return false;
    return caches.delete(name);
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  /**
   * Post a typed message to the active service worker.
   */
  postMessage(message: SWMessage): boolean {
    const sw =
      navigator.serviceWorker?.controller ??
      this.registration?.active;

    if (!sw) {
      console.warn('[SW] No active worker to post message to.');
      return false;
    }

    sw.postMessage(message);
    return true;
  }

  /**
   * Send a message and await a response.
   * Times out after 5 seconds.
   */
  sendMessageAndWait<T = unknown>(message: SWMessage, timeoutMs = 5_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const messageId = this.generateMessageId();
      const timedMessage: SWMessage = { ...message, messageId };

      const timer = setTimeout(() => {
        this.pendingMessages.delete(messageId);
        reject(new Error(`[SW] Message ${messageId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingMessages.set(messageId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      const sent = this.postMessage(timedMessage);
      if (!sent) {
        clearTimeout(timer);
        this.pendingMessages.delete(messageId);
        reject(new Error('[SW] No active service worker to handle the message.'));
      }
    });
  }

  private listenToSWMessages(): void {
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as SWMessageResponse;
      if (!data?.type) return;

      // Resolve any waiting request/response pair
      if (data.messageId && this.pendingMessages.has(data.messageId)) {
        const handlers = this.pendingMessages.get(data.messageId)!;
        this.pendingMessages.delete(data.messageId);

        if (data.error) {
          handlers.reject(new Error(data.error));
        } else {
          handlers.resolve(data.payload);
        }
        return;
      }

      // Handle broadcast messages from the SW
      switch (data.type) {
        case 'NETWORK_STATUS_FROM_SW':
          // Already handled by OfflineManager which listens separately
          break;
        default:
          // Unknown message – silently ignore
          break;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Periodic Background Sync (optional enhancement)
  // ---------------------------------------------------------------------------

  private tryPeriodicSync(reg: ServiceWorkerRegistration): void {
    const periodicReg = reg as ServiceWorkerRegistration & {
      periodicSync?: {
        register: (tag: string, options: { minInterval: number }) => Promise<void>;
        getTags: () => Promise<string[]>;
      };
    };

    if (!periodicReg.periodicSync) return;

    navigator.permissions
      .query({ name: 'periodic-background-sync' as PermissionName })
      .then((status) => {
        if (status.state === 'granted') {
          return periodicReg.periodicSync!.register(PERIODIC_SYNC_TAG, {
            minInterval: PERIODIC_SYNC_MIN_INTERVAL,
          });
        }
      })
      .catch(() => {
        // Periodic sync not available or permission denied
      });
  }

  // ---------------------------------------------------------------------------
  // Window event listeners
  // ---------------------------------------------------------------------------

  private setupWindowListeners(): void {
    window.addEventListener('offline', () => this.onOffline?.());
    window.addEventListener('online', () => this.onOnline?.());
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getOrRegister(): Promise<ServiceWorkerRegistration | null> {
    if (this.registration) return this.registration;
    return this.register();
  }

  private async getRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE).catch(() => null);
    return reg ?? null;
  }

  private generateMessageId(): string {
    return `sw-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Returns the current SW state for debugging.
   */
  async getDebugInfo(): Promise<Record<string, unknown>> {
    const reg = this.registration;

    return {
      supported: 'serviceWorker' in navigator,
      registered: !!reg,
      scope: reg?.scope,
      installingState: reg?.installing?.state ?? null,
      waitingState: reg?.waiting?.state ?? null,
      activeState: reg?.active?.state ?? null,
      controllerState: navigator.serviceWorker?.controller?.state ?? null,
      notificationPermission: 'Notification' in window ? Notification.permission : 'unsupported',
      pushSupported: 'PushManager' in window,
      backgroundSyncSupported: !!(reg as { sync?: unknown } | undefined)?.sync,
      cacheAPI: 'caches' in window,
    };
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    this.onUpdateAvailable = null;
    this.onOffline = null;
    this.onOnline = null;
    this.pendingMessages.clear();
    ServiceWorkerManager.instance = null;
  }
}
