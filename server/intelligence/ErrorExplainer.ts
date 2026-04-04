import { randomUUID } from 'crypto';
import { Logger } from '../lib/logger';

export type ErrorCategory =
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'model'
  | 'internal'
  | 'user_input'
  | 'timeout'
  | 'quota';

export interface ExplainedError {
  id: string;
  originalError: string;
  category: ErrorCategory;
  title: string;
  userMessage: string;
  technicalDetails: string;
  suggestedFixes: string[];
  canRetry: boolean;
  retryAfterMs?: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
}

export interface ErrorPattern {
  category: ErrorCategory;
  matches: string[];
  userMessageTemplate: string;
  fixes: string[];
  canRetry: boolean;
  severity: ExplainedError['severity'];
  retryAfterMs?: number;
  title: string;
}

export interface ErrorFrequency {
  errorHash: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  category: ErrorCategory;
  pattern: string;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
};

export class ErrorExplainer {
  private retryConfig: RetryConfig;
  private frequencyMap: Map<string, ErrorFrequency> = new Map();

  private patterns: ErrorPattern[] = [
    {
      category: 'network',
      matches: ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'network error', 'fetch failed', 'ECONNRESET', 'socket hang up'],
      title: 'Network Connection Error',
      userMessageTemplate: 'Network connection issue. The server could not be reached.',
      fixes: [
        'Check your internet connection',
        'Try again in a moment',
        'Verify the service endpoint is correct',
        'Contact support if the issue persists',
      ],
      canRetry: true,
      severity: 'medium',
    },
    {
      category: 'auth',
      matches: ['401', 'unauthorized', 'invalid api key', 'authentication failed', 'invalid_api_key', 'forbidden', '403'],
      title: 'Authentication Failed',
      userMessageTemplate: 'Authentication failed. Your credentials could not be verified.',
      fixes: [
        'Verify your API key is correct and active',
        'Re-login to your account and try again',
        'Check if your API key has the required permissions',
        'Generate a new API key if the current one has expired',
      ],
      canRetry: false,
      severity: 'high',
    },
    {
      category: 'rate_limit',
      matches: ['429', 'rate limit', 'too many requests', 'quota exceeded', 'rate_limit_exceeded', 'ratelimit'],
      title: 'Rate Limit Reached',
      userMessageTemplate: "You've sent too many requests. Please slow down.",
      fixes: [
        'Wait a moment before retrying',
        'Reduce the frequency of your requests',
        'Upgrade your plan for higher rate limits',
        'Implement request queuing in your application',
      ],
      canRetry: true,
      retryAfterMs: 60000,
      severity: 'low',
    },
    {
      category: 'model',
      matches: ['model not found', 'invalid model', 'model overloaded', '503', 'model_not_found', 'engine_not_found'],
      title: 'AI Model Unavailable',
      userMessageTemplate: 'The AI model is temporarily unavailable.',
      fixes: [
        'Try a different model',
        'Retry in a few seconds',
        'Check the service status page',
        'Fall back to a backup model if available',
      ],
      canRetry: true,
      severity: 'medium',
    },
    {
      category: 'timeout',
      matches: ['timeout', 'timed out', 'deadline exceeded', 'request timeout', 'gateway timeout', '504'],
      title: 'Request Timed Out',
      userMessageTemplate: 'The request took too long and was cancelled.',
      fixes: [
        'Try a shorter or simpler question',
        'Retry the request',
        'Check your network connection speed',
        'Increase the timeout setting if configurable',
      ],
      canRetry: true,
      severity: 'medium',
    },
    {
      category: 'user_input',
      matches: ['invalid request', 'bad request', '400', 'validation error', 'invalid_request_error', 'malformed'],
      title: 'Invalid Request',
      userMessageTemplate: 'There was an issue with your input. Please check and try again.',
      fixes: [
        'Check your input for formatting issues',
        'Ensure all required fields are provided',
        'Reduce the length of your input if it exceeds limits',
        'Remove any special characters that may cause issues',
      ],
      canRetry: false,
      severity: 'low',
    },
    {
      category: 'quota',
      matches: ['quota', 'insufficient credits', 'billing', 'payment required', 'usage limit', 'balance', '402'],
      title: 'Usage Limit Reached',
      userMessageTemplate: "You've reached your usage limit for this billing period.",
      fixes: [
        'Check your account balance or credits',
        'Upgrade your plan for higher limits',
        'Wait for your quota to reset at the start of the next period',
        'Contact support to increase your limits',
      ],
      canRetry: false,
      severity: 'high',
    },
  ];

  private fallbackPattern: ErrorPattern = {
    category: 'internal',
    matches: [],
    title: 'Unexpected Error',
    userMessageTemplate: 'An unexpected error occurred. Our team has been notified.',
    fixes: [
      'Retry the request',
      'Refresh the page and try again',
      'Contact support if this continues',
      'Check the system status page for outages',
    ],
    canRetry: true,
    severity: 'medium',
  };

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  explain(error: Error | string): ExplainedError {
    const message = typeof error === 'string' ? error : error.message;
    const stack = error instanceof Error ? error.stack ?? message : message;

    const pattern = this._matchPattern(message);
    const technicalDetails = this.simplifyStackTrace(stack);

    const explained: ExplainedError = {
      id: randomUUID(),
      originalError: message,
      category: pattern.category,
      title: pattern.title,
      userMessage: pattern.userMessageTemplate,
      technicalDetails,
      suggestedFixes: [...pattern.fixes],
      canRetry: pattern.canRetry,
      retryAfterMs: pattern.retryAfterMs,
      severity: pattern.severity,
      timestamp: new Date(),
    };

    Logger.debug('Error explained', { category: pattern.category, severity: pattern.severity });
    return explained;
  }

  simplifyStackTrace(stack: string): string {
    const lines = stack.split('\n');
    const filtered = lines.filter(line => {
      // Keep the error message line (usually first)
      if (!line.includes(' at ')) return true;
      // Filter out node_modules
      return !line.includes('node_modules');
    });

    // Replace absolute paths with relative: strip everything up to project root markers
    const simplified = filtered.slice(0, 6).map(line => {
      return line
        .replace(/\(\/[^\s)]*\/(src|server|client|lib|app)\//g, '(./$1/')
        .replace(/at \/[^\s]*\/(src|server|client|lib|app)\//g, 'at ./$1/');
    });

    return simplified.join('\n');
  }

  getRetryDelay(attempt: number): number {
    const base = this.retryConfig.baseDelayMs;
    const factor = this.retryConfig.backoffFactor;
    const max = this.retryConfig.maxDelayMs;

    const exponential = base * Math.pow(factor, attempt);
    const capped = Math.min(exponential, max);

    // ±10% jitter
    const jitter = capped * 0.1 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(capped + jitter));
  }

  shouldRetry(error: ExplainedError, attempt: number): boolean {
    if (!error.canRetry) return false;
    if (attempt >= this.retryConfig.maxAttempts) return false;
    if (error.category === 'quota' || error.category === 'auth') return false;
    return true;
  }

  async withRetry<T>(
    fn: () => Promise<T>,
    onRetry?: (attempt: number, error: ExplainedError) => void,
  ): Promise<T> {
    let lastExplained: ExplainedError | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err: unknown) {
        const rawError = err instanceof Error ? err : new Error(String(err));
        const explained = this.explain(rawError);
        lastExplained = explained;
        this.recordError(explained);

        if (!this.shouldRetry(explained, attempt)) {
          Logger.warn('Not retrying error', { category: explained.category, attempt });
          throw explained;
        }

        const delay = explained.retryAfterMs ?? this.getRetryDelay(attempt);
        Logger.info('Retrying after error', { attempt: attempt + 1, delayMs: delay, category: explained.category });

        if (onRetry) {
          onRetry(attempt + 1, explained);
        }

        await sleep(delay);
      }
    }

    // Should not reach here, but satisfy TypeScript
    throw lastExplained ?? new Error('Max retry attempts exceeded');
  }

  recordError(error: ExplainedError): void {
    const hash = this._hashError(error.originalError);
    const existing = this.frequencyMap.get(hash);

    if (existing) {
      existing.count++;
      existing.lastSeen = error.timestamp;
    } else {
      this.frequencyMap.set(hash, {
        errorHash: hash,
        count: 1,
        firstSeen: error.timestamp,
        lastSeen: error.timestamp,
        category: error.category,
        pattern: error.originalError.slice(0, 80),
      });
    }
  }

  getFrequentErrors(limit = 10): ErrorFrequency[] {
    return Array.from(this.frequencyMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getPatternStats(): Record<ErrorCategory, { count: number; canRetryPct: number }> {
    const categories: ErrorCategory[] = [
      'network', 'auth', 'rate_limit', 'model', 'internal',
      'user_input', 'timeout', 'quota',
    ];

    const result = {} as Record<ErrorCategory, { count: number; canRetryPct: number }>;
    for (const cat of categories) {
      result[cat] = { count: 0, canRetryPct: 0 };
    }

    const allFreqs = Array.from(this.frequencyMap.values());
    for (const freq of allFreqs) {
      if (freq.category in result) {
        result[freq.category].count += freq.count;
      }
    }

    // Compute canRetryPct from pattern definitions
    for (const cat of categories) {
      const pattern = this.patterns.find(p => p.category === cat);
      if (pattern) {
        result[cat].canRetryPct = pattern.canRetry ? 1.0 : 0.0;
      }
    }

    return result;
  }

  private _hashError(message: string): string {
    return message.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  private _matchPattern(message: string): ErrorPattern {
    const lower = message.toLowerCase();
    for (const pattern of this.patterns) {
      for (const match of pattern.matches) {
        if (lower.includes(match.toLowerCase())) {
          return pattern;
        }
      }
    }
    return this.fallbackPattern;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
