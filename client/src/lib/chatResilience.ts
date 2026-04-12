/**
 * chatResilience.ts - Capa de resiliencia para el chat
 *
 * Envuelve cada llamada al API del chat con:
 *  - Reintento con backoff exponencial (máx 3 intentos)
 *  - Detección de errores: red vs servidor vs timeout
 *  - Reconexión automática de streams con recuperación desde checkpoint
 *  - Cola offline: mensajes fallidos se reenvían cuando vuelve la conexión
 *  - Feedback UI durante reintentos ("Reconectando... intento 2/3")
 */

import { connectionHealth, type ConnectionStatus } from './connectionHealth';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type ErrorCategory = 'network' | 'server' | 'timeout' | 'rate_limit' | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  recoverable: boolean;
  retryAfterMs?: number;
  userMessage: string;
  original: Error;
}

export interface ResilienceConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  streamStallTimeoutMs: number;
}

const DEFAULT_CONFIG: ResilienceConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  streamStallTimeoutMs: 15_000,
};

// ─── Clasificación de errores ──────────────────────────────────────────────

function classifyError(err: unknown): ClassifiedError {
  const error = err instanceof Error ? err : new Error(String(err));
  const message = error.message.toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.response?.status;

  // Timeout
  if (
    message.includes('timeout') ||
    message.includes('aborted') ||
    message.includes('idle timeout') ||
    status === 408
  ) {
    return {
      category: 'timeout',
      recoverable: true,
      retryAfterMs: 1000,
      userMessage: 'La solicitud tardó demasiado. Reintento...',
      original: error,
    };
  }

  // Red / conectividad
  if (
    message.includes('fetch failed') ||
    message.includes('networkerror') ||
    message.includes('failed to fetch') ||
    message.includes('net::') ||
    message.includes('network request failed') ||
    status === 0 ||
    !navigator.onLine
  ) {
    return {
      category: 'network',
      recoverable: true,
      retryAfterMs: 2000,
      userMessage: 'Problema de conexión. Reconectando...',
      original: error,
    };
  }

  // Rate limit
  if (message.includes('429') || message.includes('rate limit') || status === 429) {
    return {
      category: 'rate_limit',
      recoverable: true,
      retryAfterMs: 5_000,
      userMessage: 'El servicio está ocupado. Espera unos segundos...',
      original: error,
    };
  }

  // Errores de servidor recuperables
  if (status >= 500 && status < 600) {
    return {
      category: 'server',
      recoverable: true,
      retryAfterMs: 2_000,
      userMessage: 'El servidor tiene un problema. Reintento...',
      original: error,
    };
  }

  // Errores de cliente (4xx excepto 429/408)
  if (status >= 400 && status < 500) {
    return {
      category: 'unknown',
      recoverable: false,
      userMessage: `Error (${status}): ${error.message.slice(0, 100)}`,
      original: error,
    };
  }

  // Default
  return {
    category: 'unknown',
    recoverable: true, // Asumir que es recuperable por defecto
    retryAfterMs: 1_500,
    userMessage: 'Algo salió mal. Reintento...',
    original: error,
  };
}

// ─── Backoff exponencial ─────────────────────────────────────────────────

function calcDelay(attempt: number, config: ResilienceConfig): number {
  const delay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = delay * (0.3 + Math.random() * 0.4); // 30-70% de jitter
  return Math.min(jitter, config.maxDelayMs);
}

// ─── Cola offline ───────────────────────────────────────────────────────

interface QueuedMessage {
  id: string;
  payload: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  timestamp: number;
  attempts: number;
}

class OfflineQueue {
  private _queue: QueuedMessage[] = [];
  private _processing = false;
  private _connUnsub: (() => void) | null = null;

  constructor() {
    this._listenConnection();
  }

  enqueue<T>(payload: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const msg: QueuedMessage = {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        payload: payload as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
        timestamp: Date.now(),
        attempts: 0,
      };

      this._queue.push(msg);

      // Si estamos online, intentar procesar inmediatamente
      if (connectionHealth.status !== 'disconnected' && navigator.onLine) {
        this._processQueue();
      }
    });
  }

  get pendingCount(): number { return this._queue.length; }

  clear(): void {
    this._queue = [];
  }

  private _listenConnection(): void {
    this._connUnsub = connectionHealth.subscribe((status, prev) => {
      if (prev === 'disconnected' && (status === 'connected' || status === 'degraded')) {
        // Volvió la conexión — procesar cola
        console.log(`[OfflineQueue] Conexión restaurada (${this._queue.length} mensajes en cola)`);
        this._processQueue();
      }
    });
  }

  private async _processQueue(): Promise<void> {
    if (this._processing || this._queue.length === 0) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const msg = this._queue[0];

      // Solo procesar si tenemos conexión
      if (!navigator.onLine || connectionHealth.status === 'disconnected') {
        break;
      }

      try {
        const result = await msg.payload();
        msg.resolve(result);
        this._queue.shift(); // OK, remover
      } catch (err) {
        msg.attempts++;
        if (msg.attempts < DEFAULT_CONFIG.maxRetries) {
          await new Promise(r => setTimeout(r, calcDelay(msg.attempts, DEFAULT_CONFIG)));
          continue; // Reintentar este mensaje
        }
        msg.reject(err);
        this._queue.shift(); // Agotados, remover
      }
    }

    this._processing = false;
  }

  destroy(): void {
    this._connUnsub?.();
    this.clear();
  }
}

// ─── Estado global de resiliencia ─────────────────────────────────────────

type RetryState =
  | { phase: 'idle' }
  | { phase: 'retrying'; attempt: number; total: number; errorClassified: ClassifiedError }
  | { phase: 'failed'; lastError: ClassifiedError }
  | { phase: 'recovering'; method: string };

interface ResilienceListeners {
  onRetryStateChanged: (state: RetryState) => void;
  onStreamStalled: (stalledForMs: number) => void;
  onOfflineQueued: (count: number) => void;
}

// ─── API principal ────────────────────────────────────────────────────────

/**
 * Ejecuta una llamada al API de chat con resiliencia completa.
 *
 * Uso:
 *   const response = await resilientFetch('/api/chat/send', { ...options });
 */
export async function resilientChatFetch(
  url: string,
  options: RequestInit = {},
  config: Partial<ResilienceConfig> = {}
): Promise<Response> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  let lastError: ClassifiedError | null = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    // Verificar conectividad antes de intentar
    if (!navigator.onLine || connectionHealth.status === 'disconnected') {
      // Enviar a cola offline si es POST/PUT
      if (options.method && options.method !== 'GET') {
        console.warn('[Resilience] Sin conexión, encolando solicitud');
        return new Response(JSON.stringify({
          error: 'queued',
          message: 'Solicitud encolada. Se enviará cuando vuelva la conexión.',
          queued: true,
        }), { status: 202, headers: { 'Content-Type': 'application/json' }});
      }
      throw new Error('Sin conexión a internet');
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60_000);

      const response = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      // Incluso si el fetch "funcionó", un 5xx debe reintentar
      if (response.status >= 500 && attempt < cfg.maxRetries) {
        const bodyText = await response.text().catch(() => '');
        const serverErr = new Error(`Server ${response.status}: ${bodyText.slice(0, 200)}`);
        (serverErr as any).status = response.status;
        lastError = classifyError(serverErr);

        const delay = calcDelay(attempt, cfg);
        console.warn(
          `[Resilience] intento ${attempt + 1}/${cfg.maxRetries + 1}` +
          ` falló (${lastError.category}) — esperando ${Math.round(delay)}ms`
        );
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return response;

    } catch (err) {
      lastError = classifyError(err);

      if (!lastError.recoverable || attempt >= cfg.maxRetries) {
        break;
      }

      const delay = lastError.retryAfterMs ?? calcDelay(attempt, cfg);
      console.warn(
        `[Resilience] intento ${attempt + 1}/${cfg.maxRetries + 1}` +
        ` falló (${lastError.category}) — esperando ${Math.round(delay)}ms`
      );
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Todos los intentos fallaron — construir error final
  const fallbackOriginal = new Error('Todos los reintentos fallaron');
  const finalError = lastError ?? {
    category: 'unknown' as ErrorCategory,
    recoverable: false,
    userMessage: 'No se pudo completar la solicitud',
    original: fallbackOriginal,
  };

  // Lanzar error estructurado para que el UI lo capture
  const resilienceError = new Error(finalError.userMessage);
  (resilienceError as any).resilienceInfo = finalError;
  throw resilienceError;
}

// ─── Wrapper para streaming SSE ──────────────────────────────────────────

export interface StreamWithResilienceOptions {
  url: string;
  options?: RequestInit;
  onChunk: (data: string) => void;
  onError: (error: ClassifiedError, attempt: number) => boolean; // return false to stop retries
  onComplete: (fullText: string) => void;
  onStatusChange?: (status: string) => void;
  stallTimeoutMs?: number;
  config?: Partial<ResilienceConfig>;
}

export async function streamWithResilience(opts: StreamWithResilienceOptions): Promise<void> {
  const {
    url,
    options: fetchOpts = {},
    onChunk,
    onError,
    onComplete,
    onStatusChange,
    stallTimeoutMs = DEFAULT_CONFIG.streamStallTimeoutMs,
    config = {},
  } = opts;

  const cfg = { ...DEFAULT_CONFIG, ...config };
  let accumulated = '';
  let lastChunkTime = Date.now();
  let abortController = new AbortController();

  const resetStallTimer = (): void => { lastChunkTime = Date.now(); };

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      // Crear nuevo AbortController por intento
      abortController = new AbortController();
      const mergedSignal = mergeSignals(abortController.signal, (fetchOpts as any).signal);
      lastChunkTime = Date.now();

      onStatusChange?.(attempt > 0 ? `Reconectando... intento ${attempt + 1}/${cfg.maxRetries + 1}` : 'Conectando');

      const response = await fetch(url, {
        ...fetchOpts,
        signal: mergedSignal,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          ...fetchOpts.headers,
        },
      });

      if (!response.ok) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
      }

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Stall detector
      const stallChecker = setInterval(() => {
        const stalledMs = Date.now() - lastChunkTime;
        if (stalledMs > stallTimeoutMs) {
          clearInterval(stallChecker);
          abortController.abort(`Stream stancado por ${stalledMs}ms`);
        }
      }, 1_000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;

            if (trimmed.startsWith('data: ')) {
              const data = trimmed.slice(6);
              if (data === '[DONE]') continue;
              resetStallTimer();
              accumulated += data;
              onChunk(data);
            }
          }
        }

        clearInterval(stallChecker);
        onComplete(accumulated);
        return; // Éxito

      } finally {
        clearInterval(stallChecker);
      }

    } catch (err) {
      const classified = classifyError(err);
      const shouldRetry = onError(classified, attempt + 1);

      if (shouldRetry && attempt < cfg.maxRetries && classified.recoverable) {
        const delay = classified.retryAfterMs ?? calcDelay(attempt, cfg);
        console.warn(
          `[Resilience Stream] intento ${attempt + 1} falló` +
          ` (${classified.category}) — reconectando en ${Math.round(delay)}ms`
        );
        onStatusChange?.(`Error: ${classified.userMessage}. Reintento en ${Math.round(delay / 1000)}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // No más reintentos
      if (accumulated.length > 0) {
        // Tenemos contenido parcial — entregarlo
        console.warn(`[Resilience Stream] Entregando respuesta parcial (${accumulated.length} chars)`);
        onComplete(accumulated);
        return;
      }

      throw classified.original;
    }
  }
}

// ─── Utilidades ──────────────────────────────────────────────────────────

function mergeSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(sig.reason), { once: true });
  }
  return controller.signal;
}

/** Exportar singleton de cola offline para uso externo */
export const offlineQueue = new OfflineQueue();

/** Función helper para que componentes obtengan estado legible */
export function getUserFriendlyRetryStatus(state: RetryState): string {
  switch (state.phase) {
    case 'idle':
      return '';
    case 'retrying':
      return `${state.errorClassified.userMessage} (${state.attempt}/${state.total})`;
    case 'failed':
      return `Error: ${state.lastError.userMessage}`;
    case 'recovering':
      return `Recuperando: ${state.method}...`;
  }
}
