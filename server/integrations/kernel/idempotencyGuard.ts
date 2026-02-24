/**
 * IdempotencyGuard — Write-operation deduplication.
 *
 * Prevents duplicate side-effects when the same logical operation is retried
 * (e.g. network timeouts, user double-clicks, queue re-delivery).
 *
 * Results are cached in the `pareIdempotencyKeys` table for 24 hours.
 * If the table does not exist the guard falls through and executes normally,
 * so the feature degrades gracefully in environments without the schema.
 */

import { createHash } from "node:crypto";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Execute `fn` at most once for a given `(key, payloadHash)` pair within the
 * TTL window.  On cache hit the previous result is returned without executing
 * `fn` again.
 */
export async function withIdempotency<T>(
  key: string,
  payloadHash: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Attempt to fetch a cached result from DB
  const cached = await getCachedResult<T>(key, payloadHash);
  if (cached !== undefined) {
    return cached;
  }

  // Execute the real work
  const result = await fn();

  // Best-effort persist
  await storeResult(key, payloadHash, result).catch((err) => {
    console.warn(
      `[IdempotencyGuard] Could not persist result for key=${key}:`,
      err,
    );
  });

  return result;
}

/**
 * Produce a deterministic SHA-256 hex digest from an arbitrary payload.
 */
export function generatePayloadHash(payload: unknown): string {
  const raw =
    typeof payload === "string" ? payload : JSON.stringify(payload);
  return createHash("sha256").update(raw).digest("hex");
}

/* ------------------------------------------------------------------ */
/*  DB helpers (best-effort — table may not exist)                     */
/* ------------------------------------------------------------------ */

async function getCachedResult<T>(
  key: string,
  payloadHash: string,
): Promise<T | undefined> {
  try {
    const { db } = await import("../../db/index.js");
    const { sql } = await import("drizzle-orm");

    const cutoff = new Date(Date.now() - TTL_MS).toISOString();

    const rows: Array<{ result: string }> = await db.execute(
      sql`SELECT result FROM "pareIdempotencyKeys"
          WHERE key = ${key}
            AND payload_hash = ${payloadHash}
            AND created_at > ${cutoff}::timestamptz
          LIMIT 1`,
    ) as unknown as Array<{ result: string }>;

    if (rows.length === 0) return undefined;

    try {
      return JSON.parse(rows[0].result) as T;
    } catch {
      return rows[0].result as unknown as T;
    }
  } catch {
    // Table missing or query error — fall through
    return undefined;
  }
}

async function storeResult(
  key: string,
  payloadHash: string,
  result: unknown,
): Promise<void> {
  try {
    const { db } = await import("../../db/index.js");
    const { sql } = await import("drizzle-orm");

    const serialised =
      typeof result === "string" ? result : JSON.stringify(result);

    await db.execute(
      sql`INSERT INTO "pareIdempotencyKeys" (key, payload_hash, result, created_at)
          VALUES (${key}, ${payloadHash}, ${serialised}, NOW())
          ON CONFLICT (key, payload_hash) DO UPDATE
            SET result     = EXCLUDED.result,
                created_at = NOW()`,
    );
  } catch {
    // Silently ignore — table may not exist.
  }
}

/**
 * Remove expired entries.  Call from a periodic maintenance job if desired.
 */
export async function purgeExpired(): Promise<number> {
  try {
    const { db } = await import("../../db/index.js");
    const { sql } = await import("drizzle-orm");

    const cutoff = new Date(Date.now() - TTL_MS).toISOString();

    const res: { rowCount?: number } = (await db.execute(
      sql`DELETE FROM "pareIdempotencyKeys" WHERE created_at <= ${cutoff}::timestamptz`,
    )) as unknown as { rowCount?: number };

    return res.rowCount ?? 0;
  } catch {
    return 0;
  }
}
