/**
 * ConnectorBulkhead — Per-connector concurrency isolation.
 *
 * Each connector gets its own semaphore so a slow or stuck connector cannot
 * exhaust the shared thread pool and starve other connectors.  Callers that
 * cannot acquire a slot within the timeout receive a clear error rather than
 * waiting indefinitely.
 */

const DEFAULT_MAX_CONCURRENT = 5;
const ACQUIRE_TIMEOUT_MS = 10_000;

/* ------------------------------------------------------------------ */
/*  Semaphore                                                          */
/* ------------------------------------------------------------------ */

export class Semaphore {
  private _available: number;
  private readonly _max: number;
  private readonly _waitQueue: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(max: number) {
    this._max = max;
    this._available = max;
  }

  get available(): number {
    return this._available;
  }

  get max(): number {
    return this._max;
  }

  /**
   * Acquire a slot.  Resolves with a release function once a slot is
   * available, or rejects after `timeoutMs` milliseconds.
   */
  acquire(timeoutMs: number = ACQUIRE_TIMEOUT_MS): Promise<() => void> {
    if (this._available > 0) {
      this._available--;
      return Promise.resolve(this._createRelease());
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from queue on timeout
        const idx = this._waitQueue.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) {
          this._waitQueue.splice(idx, 1);
        }
        reject(
          new Error(
            `Bulkhead full: could not acquire semaphore slot within ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this._waitQueue.push({ resolve, reject, timer });
    });
  }

  private _createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;

      if (this._waitQueue.length > 0) {
        const next = this._waitQueue.shift()!;
        clearTimeout(next.timer);
        next.resolve(this._createRelease());
      } else {
        this._available++;
      }
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Per-connector semaphore registry                                   */
/* ------------------------------------------------------------------ */

const connectorSemaphores = new Map<string, Semaphore>();

function getOrCreateSemaphore(
  connectorId: string,
  maxConcurrent: number,
): Semaphore {
  let sem = connectorSemaphores.get(connectorId);
  if (!sem || sem.max !== maxConcurrent) {
    sem = new Semaphore(maxConcurrent);
    connectorSemaphores.set(connectorId, sem);
  }
  return sem;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Execute `fn` within the concurrency bulkhead for `connectorId`.
 *
 * At most `maxConcurrent` invocations for a given connector run in parallel.
 * If all slots are occupied, the call waits up to 10 s before throwing.
 */
export async function withBulkhead<T>(
  connectorId: string,
  maxConcurrent: number = DEFAULT_MAX_CONCURRENT,
  fn: () => Promise<T>,
): Promise<T> {
  const sem = getOrCreateSemaphore(connectorId, maxConcurrent);
  const release = await sem.acquire(ACQUIRE_TIMEOUT_MS);

  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Return a snapshot of the semaphore state for a connector (useful for
 * health-check endpoints).
 */
export function bulkheadStatus(connectorId: string): {
  exists: boolean;
  available?: number;
  max?: number;
} {
  const sem = connectorSemaphores.get(connectorId);
  if (!sem) return { exists: false };
  return { exists: true, available: sem.available, max: sem.max };
}
