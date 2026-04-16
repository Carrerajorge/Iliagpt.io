import { isTransientError } from './errors';

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  exponentialBackoff?: boolean;
  shouldRetry?: (error: Error) => boolean;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'shouldRetry' | 'onRetry'>> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  exponentialBackoff: true,
};

function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  exponentialBackoff: boolean
): number {
  if (!exponentialBackoff) {
    return Math.min(baseDelay, maxDelay);
  }
  
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.1 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, maxDelay);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries,
    baseDelay,
    maxDelay,
    exponentialBackoff,
  } = { ...DEFAULT_OPTIONS, ...options };
  
  const shouldRetry = options.shouldRetry ?? isTransientError;
  const onRetry = options.onRetry ?? defaultOnRetry;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      if (attempt > maxRetries || !shouldRetry(err)) {
        throw err;
      }

      const delay = calculateDelay(attempt, baseDelay, maxDelay, exponentialBackoff);
      onRetry(err, attempt, delay);
      await sleep(delay);
    }
  }

  throw lastError ?? new Error('Retry failed with no error');
}

function defaultOnRetry(error: Error, attempt: number, delay: number): void {
  console.log(
    `[Retry] Attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms...`
  );
}

export function createRetryWrapper<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: RetryOptions = {}
): T {
  return ((...args: Parameters<T>) => {
    return withRetry(() => fn(...args), options);
  }) as T;
}

export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    }),
  ]);
}

export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  retryOptions: RetryOptions = {},
  timeoutMs: number = 30000
): Promise<T> {
  return withRetry(
    () => withTimeout(fn, timeoutMs),
    retryOptions
  );
}
