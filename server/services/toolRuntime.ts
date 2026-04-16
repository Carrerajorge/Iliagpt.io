import { logToolCall } from "./integrationPolicyService";
import { storage } from "../storage";

interface ToolCallOptions {
  timeout?: number; // ms, default 30000
  retries?: number; // default 2
  idempotencyKey?: string;
}

interface ToolCallResult {
  success: boolean;
  data?: any;
  error?: string;
  latencyMs: number;
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 2;

// In-memory cache for idempotency (in production, use Redis)
const idempotencyCache = new Map<string, ToolCallResult>();

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)
    ),
  ]);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeToolCall(
  userId: string,
  toolId: string,
  providerId: string,
  accountId: string | null,
  input: any,
  executor: () => Promise<any>,
  options: ToolCallOptions = {}
): Promise<ToolCallResult> {
  const {
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    idempotencyKey,
  } = options;

  // Check idempotency
  if (idempotencyKey && idempotencyCache.has(idempotencyKey)) {
    const cached = idempotencyCache.get(idempotencyKey)!;
    console.log(`[ToolRuntime] Returning cached result for ${idempotencyKey}`);
    return cached;
  }

  const startTime = Date.now();
  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= retries) {
    try {
      const data = await withTimeout(executor(), timeout);
      const latencyMs = Date.now() - startTime;

      const result: ToolCallResult = {
        success: true,
        data,
        latencyMs,
      };

      // Log successful call
      await logToolCall(
        userId,
        toolId,
        providerId,
        input,
        data,
        "success",
        latencyMs
      );

      // Cache for idempotency
      if (idempotencyKey) {
        idempotencyCache.set(idempotencyKey, result);
        // Clean up after 1 hour
        setTimeout(() => idempotencyCache.delete(idempotencyKey), 3600000);
      }

      return result;
    } catch (error: any) {
      lastError = error;
      attempt++;

      if (error.message === "TIMEOUT") {
        console.log(`[ToolRuntime] Timeout on attempt ${attempt} for ${toolId}`);
      } else {
        console.log(`[ToolRuntime] Error on attempt ${attempt} for ${toolId}:`, error.message);
      }

      if (attempt <= retries) {
        // Exponential backoff: 1s, 2s, 4s...
        await sleep(1000 * Math.pow(2, attempt - 1));
      }
    }
  }

  const latencyMs = Date.now() - startTime;
  const errorStatus = lastError?.message === "TIMEOUT" ? "timeout" : "error";

  // Log failed call
  await logToolCall(
    userId,
    toolId,
    providerId,
    input,
    null,
    errorStatus,
    latencyMs,
    lastError?.message
  );

  return {
    success: false,
    error: lastError?.message || "Unknown error",
    latencyMs,
  };
}

// Cleanup old idempotency cache entries periodically
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  // In a real implementation, we'd track timestamps
  // For now, the per-key timeout handles cleanup
}, 60000);

export { ToolCallOptions, ToolCallResult };
