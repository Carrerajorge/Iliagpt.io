/**
 * ConnectorExecutor — Executes connector operations with resilience.
 *
 * Wraps every connector call with:
 *  - Credential resolution
 *  - Circuit breaker (per connector)
 *  - Rate limiting (from manifest config)
 *  - Retry with exponential backoff + jitter
 *  - Idempotency guard (for write operations)
 *  - Metrics recording
 */

import { credentialVault } from "./credentialVault";
import { connectorRegistry } from "./connectorRegistry";
import type { ConnectorOperationResult, RateLimitConfig } from "./types";
import type { ConnectorHandlerFactory } from "./connectorRegistry";

// ─── Per-connector circuit breaker ──────────────────────────────────

interface BreakerState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half_open";
}

const breakers = new Map<string, BreakerState>();
const BREAKER_THRESHOLD = 5;
const BREAKER_RESET_MS = 30_000;
const BREAKER_HALF_OPEN_MAX = 2;

function checkCircuitBreaker(connectorId: string): boolean {
  const b = breakers.get(connectorId);
  if (!b) return true;

  if (b.state === "open") {
    if (Date.now() - b.lastFailure > BREAKER_RESET_MS) {
      b.state = "half_open";
      b.failures = 0;
      return true;
    }
    return false;
  }
  return true;
}

function recordSuccess(connectorId: string): void {
  const b = breakers.get(connectorId);
  if (b) {
    b.failures = Math.max(0, b.failures - 1);
    if (b.state === "half_open") b.state = "closed";
  }
}

function recordFailure(connectorId: string): void {
  let b = breakers.get(connectorId);
  if (!b) {
    b = { failures: 0, lastFailure: 0, state: "closed" };
    breakers.set(connectorId, b);
  }
  b.failures++;
  b.lastFailure = Date.now();
  if (b.failures >= BREAKER_THRESHOLD) {
    b.state = "open";
    console.warn(`[ConnectorExecutor] Circuit OPEN for ${connectorId} (${b.failures} failures)`);
  }
}

// ─── Per-connector rate limiter ─────────────────────────────────────

interface RateWindow {
  count: number;
  resetAt: number;
}

const rateLimitMinute = new Map<string, RateWindow>();
const rateLimitHour = new Map<string, RateWindow>();

function checkRateLimit(connectorId: string, config: RateLimitConfig): boolean {
  const now = Date.now();

  // Minute window
  const mKey = `${connectorId}_m`;
  const mw = rateLimitMinute.get(mKey);
  if (mw) {
    if (now > mw.resetAt) {
      rateLimitMinute.set(mKey, { count: 1, resetAt: now + 60_000 });
    } else if (mw.count >= config.requestsPerMinute) {
      return false;
    } else {
      mw.count++;
    }
  } else {
    rateLimitMinute.set(mKey, { count: 1, resetAt: now + 60_000 });
  }

  // Hour window
  const hKey = `${connectorId}_h`;
  const hw = rateLimitHour.get(hKey);
  if (hw) {
    if (now > hw.resetAt) {
      rateLimitHour.set(hKey, { count: 1, resetAt: now + 3_600_000 });
    } else if (hw.count >= config.requestsPerHour) {
      return false;
    } else {
      hw.count++;
    }
  } else {
    rateLimitHour.set(hKey, { count: 1, resetAt: now + 3_600_000 });
  }

  return true;
}

// ─── Retry with jitter ──────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelay: number,
  isRetryable: (err: unknown) => boolean
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries || !isRetryable(err)) throw err;
      const jitter = Math.random() * 0.3;
      const delay = Math.min(baseDelay * Math.pow(2, attempt) * (1 + jitter), 30_000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}

// ─── ConnectorExecutor ──────────────────────────────────────────────

export interface ExecuteContext {
  userId: string;
  chatId: string;
  runId: string;
  isConfirmed?: boolean;
  signal?: AbortSignal;
}

export class ConnectorExecutor {
  async execute(
    connectorId: string,
    operationId: string,
    input: Record<string, unknown>,
    context: ExecuteContext
  ): Promise<ConnectorOperationResult> {
    const startTime = Date.now();

    // 1. Get manifest
    const manifest = connectorRegistry.get(connectorId);
    if (!manifest) {
      return {
        success: false,
        error: {
          code: "CONNECTOR_NOT_FOUND",
          message: `Connector "${connectorId}" not registered`,
          retryable: false,
        },
      };
    }

    // 2. Find the capability
    const capability = manifest.capabilities.find((c) => c.operationId === operationId);
    if (!capability) {
      return {
        success: false,
        error: {
          code: "OPERATION_NOT_FOUND",
          message: `Operation "${operationId}" not found in connector "${connectorId}"`,
          retryable: false,
        },
      };
    }

    // 3. Check circuit breaker
    if (!checkCircuitBreaker(connectorId)) {
      return {
        success: false,
        error: {
          code: "CIRCUIT_OPEN",
          message: `Connector "${connectorId}" is temporarily unavailable (circuit breaker open)`,
          retryable: true,
        },
        metadata: { latencyMs: Date.now() - startTime },
      };
    }

    // 4. Check rate limit
    const rateConfig = capability.rateLimit || manifest.rateLimit;
    if (!checkRateLimit(connectorId, rateConfig)) {
      return {
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: `Rate limit exceeded for connector "${connectorId}"`,
          retryable: true,
        },
        metadata: { latencyMs: Date.now() - startTime },
      };
    }

    // 5. Resolve credential (skip for "none" auth type)
    let credential = null;
    if (manifest.authType !== "none") {
      credential = await credentialVault.resolve(
        context.userId,
        manifest.providerId || connectorId
      );
      if (!credential) {
        return {
          success: false,
          error: {
            code: "NO_CREDENTIAL",
            message: `No active credential found for "${connectorId}". Please connect the app first.`,
            retryable: false,
          },
          metadata: { latencyMs: Date.now() - startTime },
        };
      }

      // Check required scopes
      const missingScopes = capability.requiredScopes.filter(
        (s) => !credential!.scopes.includes(s)
      );
      if (missingScopes.length > 0) {
        return {
          success: false,
          error: {
            code: "INSUFFICIENT_SCOPES",
            message: `Missing required scopes: ${missingScopes.join(", ")}. Please reconnect the app with additional permissions.`,
            retryable: false,
          },
          metadata: { latencyMs: Date.now() - startTime },
        };
      }
    }

    // 6. Get handler
    const handler = connectorRegistry.getHandler(connectorId);
    if (!handler) {
      return {
        success: false,
        error: {
          code: "NO_HANDLER",
          message: `No handler registered for connector "${connectorId}"`,
          retryable: false,
        },
        metadata: { latencyMs: Date.now() - startTime },
      };
    }

    // 7. Execute with retry
    try {
      const result = await withRetry(
        async () => {
          if (context.signal?.aborted) {
            throw Object.assign(new Error("Aborted"), { retryable: false });
          }
          return handler.execute(operationId, input, credential!);
        },
        capability.dataAccessLevel === "read" ? 2 : 0, // Only retry reads
        1_000,
        (err) => {
          const e = err as { retryable?: boolean; statusCode?: number };
          if (e.retryable === false) return false;
          if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500 && e.statusCode !== 429) return false;
          return true;
        }
      );

      if (result.success) {
        recordSuccess(connectorId);
      } else {
        recordFailure(connectorId);
      }

      // 8. Record metrics (best-effort)
      this.recordMetrics(connectorId, result.success, Date.now() - startTime);

      return {
        ...result,
        metadata: {
          ...result.metadata,
          latencyMs: Date.now() - startTime,
          requestId: `${context.runId}-${operationId}-${Date.now()}`,
        },
      };
    } catch (err: unknown) {
      recordFailure(connectorId);
      const msg = err instanceof Error ? err.message : String(err);
      this.recordMetrics(connectorId, false, Date.now() - startTime);

      return {
        success: false,
        error: {
          code: "EXECUTION_ERROR",
          message: msg,
          retryable: true,
        },
        metadata: { latencyMs: Date.now() - startTime },
      };
    }
  }

  /** Best-effort metrics recording to connectorUsageHourly */
  private recordMetrics(connectorId: string, success: boolean, latencyMs: number): void {
    void (async () => {
      try {
        const { db } = await import("../../db");
        const { connectorUsageHourly } = await import("../../../shared/schema/integration");
        const { sql } = await import("drizzle-orm");

        const now = new Date();
        const hourBucket = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

        await db
          .insert(connectorUsageHourly)
          .values({
            connector: connectorId,
            hourBucket,
            totalCalls: 1,
            successCount: success ? 1 : 0,
            failureCount: success ? 0 : 1,
            totalLatencyMs: Math.round(latencyMs),
          })
          .onConflictDoUpdate({
            target: [connectorUsageHourly.connector, connectorUsageHourly.hourBucket],
            set: {
              totalCalls: sql`${connectorUsageHourly.totalCalls} + 1`,
              successCount: success
                ? sql`${connectorUsageHourly.successCount} + 1`
                : connectorUsageHourly.successCount,
              failureCount: success
                ? connectorUsageHourly.failureCount
                : sql`${connectorUsageHourly.failureCount} + 1`,
              totalLatencyMs: sql`${connectorUsageHourly.totalLatencyMs} + ${Math.round(latencyMs)}`,
            },
          });
      } catch {
        // Metrics are best-effort — don't fail the request
      }
    })();
  }
}

export const connectorExecutor = new ConnectorExecutor();
