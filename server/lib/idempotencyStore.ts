import crypto from "crypto";
import { db } from "../db";
import { pareIdempotencyKeys, type PareIdempotencyStatus } from "@shared/schema";
import { createLogger } from "./structuredLogger";
import { eq, lt, sql } from "drizzle-orm";

export type IdempotencyCheckResult =
  | { status: "new" }
  | { status: "processing" }
  | { status: "completed"; cachedResponse: Record<string, unknown> }
  | { status: "conflict" };

const TTL_HOURS = 24;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MAX_PAYLOAD_HASH_BYTES = 128_000;
const MAX_RESPONSE_JSON_BYTES = 64_000;
const IDEMPOTENCY_KEY_MIN_LENGTH = 6;
const IDEMPOTENCY_KEY_MAX_LENGTH = 140;
const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9._-]+$/;
const IDEMPOTENCY_HASH_RE = /^[a-f0-9]{64}$/;
const MAX_PAYLOAD_HASH_JSON_BYTES = 65_536;
const MAX_IDEMPOTENCY_LOG_KEY_BYTES = 6;
const MAX_IDEMPOTENCY_NESTING_DEPTH = 12;
const STALE_PROCESSING_TTL_MS = 5 * 60 * 1000;

let cleanupIntervalId: NodeJS.Timeout | null = null;
const logger = createLogger("idempotency-store");

function obfuscateIdempotencyKey(key: string): string {
  if (key.length <= MAX_IDEMPOTENCY_LOG_KEY_BYTES) {
    return "[REDACTED]";
  }
  return `${key.slice(0, 3)}...${key.slice(-3)}`;
}

function validateIdempotencyKey(key: string): void {
  if (
    typeof key !== "string" ||
    key.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    key.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_RE.test(key)
  ) {
    throw new Error("Invalid idempotency key");
  }
}

function validatePayloadHash(payloadHash: string): void {
  if (typeof payloadHash !== "string" || !IDEMPOTENCY_HASH_RE.test(payloadHash)) {
    throw new Error("Invalid idempotency payload hash");
  }
}

function normalizeForHash(value: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  if (depth > MAX_IDEMPOTENCY_NESTING_DEPTH) {
    return "[max_depth_exceeded]";
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (seen.has(value as object)) {
    return "[circular]";
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForHash(entry, seen, depth + 1));
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const keys = Object.keys(source).sort();
  for (const key of keys) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      output[key] = "[redacted_proto_key]";
      continue;
    }
    output[key] = normalizeForHash(source[key], seen, depth + 1);
  }
  return output;
}

function normalizeForStorage(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0
): unknown {
  if (depth > MAX_IDEMPOTENCY_NESTING_DEPTH) {
    return "[max_depth_exceeded]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return `${value}n`;
  }

  if (typeof value === "symbol" || typeof value === "function") {
    return `[unsupported:${typeof value}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value as object)) {
    return "[circular]";
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForStorage(entry, seen, depth + 1));
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const keys = Object.keys(source).sort();

  for (const key of keys) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      output[key] = "[redacted_proto_key]";
      continue;
    }

    output[key] = normalizeForStorage(source[key], seen, depth + 1);
  }

  return output;
}

function safeSerializedResponse(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeForStorage(payload) as Record<string, unknown>;
  const serialized = JSON.stringify(normalized);
  if (serialized === undefined) {
    return {
      _truncated: true,
      _reason: "Unable to serialize response payload",
      _timestamp: new Date().toISOString(),
    };
  }

  if (Buffer.byteLength(serialized, "utf8") <= MAX_RESPONSE_JSON_BYTES) {
    return normalized;
  }

  return {
    _truncated: true,
    _reason: "Response payload exceeds idempotency cache size limit",
    _originalBytes: Buffer.byteLength(serialized, "utf8"),
    _cachedAt: new Date().toISOString(),
    _digest: crypto.createHash("sha256").update(serialized).digest("hex"),
  };
}

export function computePayloadHash(body: unknown): string {
  const normalizedStructure = normalizeForHash(body);
  const normalized = JSON.stringify(normalizedStructure);
  if (normalized === undefined) {
    throw new Error("Unable to serialize idempotency payload");
  }
  if (Buffer.byteLength(normalized, "utf8") > MAX_PAYLOAD_HASH_BYTES) {
    throw new Error("Idempotency payload too large");
  }
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export async function checkIdempotencyKey(
  key: string,
  payloadHash: string
): Promise<IdempotencyCheckResult> {
  validateIdempotencyKey(key);
  validatePayloadHash(payloadHash);

  const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);

  try {
    const insertResult = await db.execute(sql`
      INSERT INTO pare_idempotency_keys (idempotency_key, payload_hash, status, expires_at)
      VALUES (${key}, ${payloadHash}, 'processing', ${expiresAt})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `);

    if (insertResult.rowCount && insertResult.rowCount > 0) {
      logger.info("Idempotency key created", {
        event: "IDEMPOTENCY_KEY_CREATED",
        key: obfuscateIdempotencyKey(key),
        payloadHash: payloadHash.substring(0, MAX_IDEMPOTENCY_LOG_KEY_BYTES) + "...",
        timestamp: new Date().toISOString(),
      });
      return { status: "new" };
    }

    const existing = await db.query.pareIdempotencyKeys.findFirst({
      where: eq(pareIdempotencyKeys.idempotencyKey, key),
    });

    if (!existing) {
      logger.error("Idempotency race condition on insert without existing row", {
        event: "IDEMPOTENCY_KEY_RACE_CONDITION",
        key: obfuscateIdempotencyKey(key),
        message: "Insert failed but no existing record found",
        timestamp: new Date().toISOString(),
      });
      return { status: "new" };
    }

    if (existing.payloadHash !== payloadHash) {
      logger.warn("Idempotency conflict detected", {
        event: "IDEMPOTENCY_CONFLICT",
        key: obfuscateIdempotencyKey(key),
        existingHash: existing.payloadHash.substring(0, MAX_IDEMPOTENCY_LOG_KEY_BYTES) + "...",
        newHash: payloadHash.substring(0, MAX_IDEMPOTENCY_LOG_KEY_BYTES) + "...",
        timestamp: new Date().toISOString(),
      });
      return { status: "conflict" };
    }

    if (existing.status === "completed" && existing.responseJson) {
      logger.info("Idempotency cache hit", {
        event: "IDEMPOTENCY_CACHE_HIT",
        key: obfuscateIdempotencyKey(key),
        timestamp: new Date().toISOString(),
      });
      return { status: "completed", cachedResponse: existing.responseJson as Record<string, unknown> };
    }

    if (existing.status === "processing") {
      const createdAt = existing.createdAt;
      const isStaleProcessing =
        createdAt instanceof Date &&
        Date.now() - createdAt.getTime() >= STALE_PROCESSING_TTL_MS;

      if (isStaleProcessing) {
        // Atomic CAS: only reset if still in 'processing' state (prevents race with concurrent completion)
        const casResult = await db.execute(sql`
          UPDATE pare_idempotency_keys
          SET status = 'processing', expires_at = ${expiresAt}
          WHERE idempotency_key = ${key} AND status = 'processing'
          RETURNING id
        `);

        if (!casResult.rowCount || casResult.rowCount === 0) {
          // Another process already changed the status — re-check
          logger.info("Idempotency stale CAS failed, re-checking", {
            event: "IDEMPOTENCY_STALE_CAS_MISS",
            key: obfuscateIdempotencyKey(key),
            timestamp: new Date().toISOString(),
          });
          return { status: "processing" };
        }

        logger.warn("Idempotency stale processing detected, forcing retry", {
          event: "IDEMPOTENCY_STALE_PROCESSING",
          key: obfuscateIdempotencyKey(key),
          createdAt,
          timestamp: new Date().toISOString(),
        });
        return { status: "new" };
      }

      logger.info("Idempotency key in progress", {
        event: "IDEMPOTENCY_IN_PROGRESS",
        key: obfuscateIdempotencyKey(key),
        createdAt: existing.createdAt,
        timestamp: new Date().toISOString(),
      });
      return { status: "processing" };
    }

    if (existing.status === "failed") {
      await db
        .update(pareIdempotencyKeys)
        .set({ status: "processing", expiresAt })
        .where(eq(pareIdempotencyKeys.idempotencyKey, key));

      logger.info("Idempotency retry after failure", {
        event: "IDEMPOTENCY_RETRY_AFTER_FAILURE",
        key: obfuscateIdempotencyKey(key),
        timestamp: new Date().toISOString(),
      });
      return { status: "new" };
    }

    return { status: "new" };
  } catch (error: unknown) {
    logger.error("Idempotency check failed", {
      event: "IDEMPOTENCY_CHECK_ERROR",
      key: obfuscateIdempotencyKey(key),
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}

export async function completeIdempotencyKey(
  key: string,
  response: Record<string, unknown>
): Promise<void> {
  validateIdempotencyKey(key);
  const responseJson = safeSerializedResponse(response);
  const responseBytes = Buffer.byteLength(JSON.stringify(responseJson), "utf8");
  try {
    await db
      .update(pareIdempotencyKeys)
      .set({
        status: "completed" as PareIdempotencyStatus,
        responseJson,
      })
      .where(eq(pareIdempotencyKeys.idempotencyKey, key));

    logger.info("Idempotency key completed", {
      event: "IDEMPOTENCY_KEY_COMPLETED",
      key: obfuscateIdempotencyKey(key),
      responseBytes,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    logger.error("Idempotency completion failed", {
      event: "IDEMPOTENCY_COMPLETE_ERROR",
      key: obfuscateIdempotencyKey(key),
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}

export async function failIdempotencyKey(
  key: string,
  error: string
): Promise<void> {
  validateIdempotencyKey(key);
  const truncatedError =
    typeof error === "string" && error.length > MAX_RESPONSE_JSON_BYTES
      ? `${error.slice(0, MAX_RESPONSE_JSON_BYTES - 20)}...`
      : error;

  try {
    await db
      .update(pareIdempotencyKeys)
      .set({
        status: "failed" as PareIdempotencyStatus,
        responseJson: {
          error:
            truncatedError.length > MAX_PAYLOAD_HASH_JSON_BYTES
              ? `[truncated] ${truncatedError.slice(0, MAX_PAYLOAD_HASH_JSON_BYTES)}`
              : `[redacted] ${truncatedError}`,
          failedAt: new Date().toISOString(),
        },
      })
      .where(eq(pareIdempotencyKeys.idempotencyKey, key));

    logger.info("Idempotency key failed", {
      event: "IDEMPOTENCY_KEY_FAILED",
      key: obfuscateIdempotencyKey(key),
      timestamp: new Date().toISOString(),
    });
  } catch (dbError: unknown) {
    logger.error("Idempotency fail-state update failed", {
      event: "IDEMPOTENCY_FAIL_ERROR",
      key: obfuscateIdempotencyKey(key),
      originalError: truncatedError,
      dbError: dbError instanceof Error ? dbError.message : String(dbError),
      timestamp: new Date().toISOString(),
    });
  }
}

export async function cleanupExpiredKeys(): Promise<number> {
  try {
    const now = new Date();
    const result = await db
      .delete(pareIdempotencyKeys)
      .where(lt(pareIdempotencyKeys.expiresAt, now));

    const deletedCount = result.rowCount || 0;

    if (deletedCount > 0) {
      logger.info("Idempotency cleanup removed expired keys", {
        event: "IDEMPOTENCY_CLEANUP",
        deletedCount,
        timestamp: now.toISOString(),
      });
    }

    return deletedCount;
  } catch (error: unknown) {
    logger.error("Idempotency cleanup failed", {
      event: "IDEMPOTENCY_CLEANUP_ERROR",
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
    return 0;
  }
}

export function startCleanupScheduler(): void {
  if (cleanupIntervalId) {
    return;
  }

  cleanupIntervalId = setInterval(async () => {
    try {
      await cleanupExpiredKeys();
    } catch (error: unknown) {
      logger.error("Idempotency cleanup interval failed", {
        event: "IDEMPOTENCY_CLEANUP_INTERVAL_ERROR",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  }, CLEANUP_INTERVAL_MS);
  if (cleanupIntervalId.unref) {
    cleanupIntervalId.unref();
  }

  logger.info("Idempotency cleanup scheduler started", {
    event: "IDEMPOTENCY_CLEANUP_SCHEDULER_STARTED",
    intervalMs: CLEANUP_INTERVAL_MS,
    timestamp: new Date().toISOString(),
  });
}

export function stopCleanupScheduler(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;

    logger.info("Idempotency cleanup scheduler stopped", {
      event: "IDEMPOTENCY_CLEANUP_SCHEDULER_STOPPED",
      timestamp: new Date().toISOString(),
    });
  }
}

export async function getIdempotencyKeyStats(): Promise<{
  total: number;
  processing: number;
  completed: number;
  failed: number;
  expired: number;
}> {
  const now = new Date();
  const [totalResult, processingResult, completedResult, failedResult, expiredResult] =
    await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(pareIdempotencyKeys),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(pareIdempotencyKeys)
        .where(eq(pareIdempotencyKeys.status, "processing")),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(pareIdempotencyKeys)
        .where(eq(pareIdempotencyKeys.status, "completed")),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(pareIdempotencyKeys)
        .where(eq(pareIdempotencyKeys.status, "failed")),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(pareIdempotencyKeys)
        .where(lt(pareIdempotencyKeys.expiresAt, now)),
    ]);

  return {
    total: totalResult[0]?.count ?? 0,
    processing: processingResult[0]?.count ?? 0,
    completed: completedResult[0]?.count ?? 0,
    failed: failedResult[0]?.count ?? 0,
    expired: expiredResult[0]?.count ?? 0,
  };
}
