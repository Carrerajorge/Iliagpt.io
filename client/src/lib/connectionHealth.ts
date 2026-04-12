/**
 * connectionHealth.ts - Monitor de salud de conexión
 *
 * Monitorea navigator.onLine + pings periódicos a /api/health.
 * Emite eventos: connected, degraded, disconnected, restored.
 *
 * Se integra con chatResilience.ts para pausar solicitudes durante caídas.
 */

export type ConnectionStatus = 'connected' | 'degraded' | 'disconnected';

type StatusListener = (status: ConnectionStatus, previous: ConnectionStatus) => void;

class ConnectionHealthMonitor {
  private _status: ConnectionStatus = 'connected';
  private _listeners: Set<StatusListener> = new Set();
  private _pingInterval: ReturnType<typeof setInterval> | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastPingOk = true;
  private readonly PING_INTERVAL_MS = 30_000; // 30s entre health checks
  private readonly DEBOUNCE_MS = 2_000;       // 2s debounce para evitar flicker

  get status(): ConnectionStatus {
    if (!navigator.onLine) return 'disconnected';
    return this._status;
  }

  constructor() {
    this._init();
  }

  subscribe(listener: StatusListener): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  async checkNow(): Promise<ConnectionStatus> {
    const ok = await this._pingHealthEndpoint();
    const newStatus = ok ? 'connected' : 'degraded';
    this._setStatus(newStatus);
    return newStatus;
  }

  private _init(): void {
    // Eventos del navegador
    window.addEventListener('online', () => this._handleOnline());
    window.addEventListener('offline', () => this._handleOffline());

    // Estado inicial
    if (!navigator.onLine) {
      this._status = 'disconnected';
    }

    // Health checks periódicos (solo si estamos online)
    this._pingInterval = setInterval(() => {
      if (navigator.onLine) {
        this.checkNow();
      }
    }, this.PING_INTERVAL_MS);

    // Primer check rápido tras carga
    setTimeout(() => this.checkNow(), 3_000);
  }

  private _handleOnline(): void {
    this._setStatusDebounced('connected');
    // Verificar de verdad con un ping
    setTimeout(() => this.checkNow(), 1_000);
  }

  private _handleOffline(): void {
    this._setStatusDebounced('disconnected');
  }

  private _setStatusDebounced(status: ConnectionStatus): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._setStatus(status), this.DEBOUNCE_MS);
  }

  private _setStatus(status: ConnectionStatus): void {
    const prev = this._status;
    if (prev === status) return;

    this._status = status;
    console.log(`[ConnectionHealth] ${prev} → ${status}`);

    for (const listener of this._listeners) {
      try { listener(status, prev); } catch (e) {
        console.warn('[ConnectionHealth] listener error', e);
      }
    }
  }

  private async _pingHealthEndpoint(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);

      const res = await fetch('/api/health/live', {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });

      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  destroy(): void {
    if (this._pingInterval) clearInterval(this._pingInterval);
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._listeners.clear();
  }
}

// Singleton
export const connectionHealth = new ConnectionHealthMonitor();

// Auto-limpiar al descargar página (no es necesario en SPA pero por si acaso)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => connectionHealth.destroy());
}
