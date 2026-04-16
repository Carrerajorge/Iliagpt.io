/**
 * Fetch with Retry - ILIAGPT PRO 3.0
 *
 * Robust fetch wrapper with exponential backoff,
 * timeout handling, and error recovery.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelay?: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelay?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** HTTP status codes that should trigger a retry (default: [408, 429, 500, 502, 503, 504]) */
  retryStatusCodes?: number[];
  /** Callback for retry attempts */
  onRetry?: (attempt: number, error: Error, nextDelayMs: number) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly statusText?: string,
    public readonly response?: Response,
    public readonly attempts?: number
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'signal'>> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  timeout: 30000,
  retryStatusCodes: [408, 429, 500, 502, 503, 504],
};

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
  return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Create an AbortController that times out after specified ms
 */
function createTimeoutController(timeoutMs: number, existingSignal?: AbortSignal): {
  controller: AbortController;
  timeoutId: NodeJS.Timeout;
} {
  const controller = new AbortController();

  // Link to existing signal if provided
  if (existingSignal) {
    if (existingSignal.aborted) {
      controller.abort(existingSignal.reason);
    } else {
      existingSignal.addEventListener('abort', () => {
        controller.abort(existingSignal.reason);
      });
    }
  }

  const timeoutId = setTimeout(() => {
    controller.abort(new TimeoutError(`Request timed out after ${timeoutMs}ms`, timeoutMs));
  }, timeoutMs);

  return { controller, timeoutId };
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // Network errors
    return true;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    // User-initiated abort should not retry
    return false;
  }
  if (error instanceof TimeoutError) {
    return true;
  }
  return false;
}

/**
 * Fetch with automatic retry and exponential backoff
 *
 * @example
 * ```ts
 * // Basic usage
 * const response = await fetchWithRetry('/api/data');
 *
 * // With options
 * const response = await fetchWithRetry('/api/data', {
 *   method: 'POST',
 *   body: JSON.stringify(data),
 * }, {
 *   maxRetries: 5,
 *   timeout: 10000,
 *   onRetry: (attempt, error) => console.log(`Retry ${attempt}: ${error.message}`)
 * });
 * ```
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { maxRetries, baseDelay, maxDelay, timeout, retryStatusCodes, onRetry, signal } = opts;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { controller, timeoutId } = createTimeoutController(timeout, signal);

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check if we should retry based on status code
      if (!response.ok && retryStatusCodes.includes(response.status)) {
        const error = new FetchError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          response.statusText,
          response,
          attempt + 1
        );

        if (attempt < maxRetries) {
          const delay = calculateDelay(attempt, baseDelay, maxDelay);
          onRetry?.(attempt + 1, error, delay);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }

      return response;

    } catch (error) {
      clearTimeout(timeoutId);

      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      // Don't retry user-initiated aborts
      if (signal?.aborted) {
        throw err;
      }

      // Check if error is retryable
      if (attempt < maxRetries && isRetryableError(error)) {
        const delay = calculateDelay(attempt, baseDelay, maxDelay);
        onRetry?.(attempt + 1, err, delay);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw err;
    }
  }

  throw lastError || new Error('Fetch failed after retries');
}

/**
 * Fetch JSON with automatic retry
 */
export async function fetchJsonWithRetry<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RetryOptions
): Promise<T> {
  const response = await fetchWithRetry(input, {
    ...init,
    headers: {
      'Accept': 'application/json',
      ...init?.headers,
    },
  }, options);

  if (!response.ok) {
    throw new FetchError(
      `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      response.statusText,
      response
    );
  }

  return response.json();
}

/**
 * POST JSON with automatic retry
 */
export async function postJsonWithRetry<T, R>(
  url: string,
  data: T,
  options?: RetryOptions
): Promise<R> {
  return fetchJsonWithRetry<R>(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  }, options);
}

export default fetchWithRetry;
