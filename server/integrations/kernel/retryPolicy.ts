/**
 * RetryPolicy — Exponential back-off with full jitter.
 *
 * Wraps an async operation and retries on transient failures using the
 * "Full Jitter" strategy from the AWS Architecture Blog:
 *
 *   delay = random_between(0, min(maxDelay, baseDelay * 2^attempt))
 *
 * This spreads retry storms across time and avoids thundering-herd effects.
 */

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

export interface RetryConfig {
  /** Maximum number of retry attempts (not counting the initial call). */
  maxRetries: number;
  /** Base delay in milliseconds for the first retry. */
  baseDelayMs: number;
  /** Upper bound on the computed delay. */
  maxDelayMs: number;
  /**
   * Predicate that decides whether an error is retryable.
   * Defaults to HTTP 429, 5xx, and common network / timeout errors.
   */
  retryable?: (error: unknown) => boolean;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

/* ------------------------------------------------------------------ */
/*  Default retryable predicate                                        */
/* ------------------------------------------------------------------ */

function isRetryableDefault(error: unknown): boolean {
  if (error == null) return false;

  // Check HTTP status codes on standard error shapes
  const status =
    (error as { status?: number }).status ??
    (error as { statusCode?: number }).statusCode ??
    (error as { response?: { status?: number } }).response?.status;

  if (typeof status === "number") {
    if (status === 429) return true; // Rate-limited
    if (status >= 500 && status <= 599) return true; // Server errors
  }

  // Check error codes / messages for network & timeout issues
  const code = (error as { code?: string }).code ?? "";
  const message =
    error instanceof Error ? error.message : String(error);

  const retryableCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ECONNABORTED",
    "ETIMEDOUT",
    "EPIPE",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
  ]);

  if (retryableCodes.has(code)) return true;

  const retryablePatterns = [
    /timeout/i,
    /network/i,
    /socket hang up/i,
    /ECONNRESET/,
    /ECONNREFUSED/,
    /fetch failed/i,
  ];

  return retryablePatterns.some((p) => p.test(message));
}

/* ------------------------------------------------------------------ */
/*  Delay helpers                                                      */
/* ------------------------------------------------------------------ */

function computeDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(maxDelayMs, exponential);
  // Full jitter: uniform random between 0 and capped
  return Math.floor(Math.random() * capped);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Execute `fn` with automatic retries on transient failures.
 *
 * Returns the result of the first successful invocation, or throws the
 * last error if all attempts are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const {
    maxRetries = DEFAULT_CONFIG.maxRetries,
    baseDelayMs = DEFAULT_CONFIG.baseDelayMs,
    maxDelayMs = DEFAULT_CONFIG.maxDelayMs,
    retryable = isRetryableDefault,
  } = config;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt || !retryable(err)) {
        throw err;
      }

      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
      console.warn(
        `[RetryPolicy] Attempt ${attempt + 1}/${maxRetries + 1} failed, ` +
          `retrying in ${delay}ms: ${err instanceof Error ? err.message : String(err)}`,
      );

      await sleep(delay);
    }
  }

  // Unreachable in practice, but satisfies the type checker
  throw lastError;
}

/**
 * Convenience: check whether an error would be retried under default rules.
 */
export { isRetryableDefault as isRetryable };
