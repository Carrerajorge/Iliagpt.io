/**
 * OpenAI-Compatible API Authentication Middleware
 *
 * Validates API keys from the `Authorization: Bearer <key>` header against
 * the `api_keys` table.  Returns OpenAI-style error envelopes on failure.
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { hashApiKey } from "../../services/encryption";
import { createLogger } from "../../utils/logger";

const log = createLogger("openai-compat-auth");

export interface ApiKeyUser {
  userId: string;
  email: string;
  role: string;
  apiKeyId: string;
  permissions: string[];
  rateLimit: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKeyUser?: ApiKeyUser;
    }
  }
}

/**
 * Authenticate a request using the api_keys table (SHA-256 hash lookup).
 * Accepts keys with any prefix (ilgpt_, sk-, etc.).
 */
export async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      error: {
        message: "Missing API key. Provide it via the Authorization header: Bearer <key>",
        type: "invalid_request_error",
        param: null,
        code: "missing_api_key",
      },
    });
    return;
  }

  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) {
    res.status(401).json({
      error: {
        message: "Empty API key",
        type: "invalid_request_error",
        param: null,
        code: "missing_api_key",
      },
    });
    return;
  }

  const keyHash = hashApiKey(apiKey);

  try {
    const result = await db.execute(sql`
      SELECT ak.id, ak.user_id, ak.permissions, ak.rate_limit, ak.expires_at, ak.is_active,
             u.id AS uid, u.email, u.role
      FROM api_keys ak
      JOIN users u ON ak.user_id = u.id
      WHERE ak.key_hash = ${keyHash}
    `);

    if (!result.rows?.length) {
      res.status(401).json({
        error: {
          message: "Invalid API key provided",
          type: "authentication_error",
          param: null,
          code: "invalid_api_key",
        },
      });
      return;
    }

    const row = result.rows[0] as any;

    if (!row.is_active) {
      res.status(401).json({
        error: {
          message: "This API key has been deactivated",
          type: "authentication_error",
          param: null,
          code: "api_key_deactivated",
        },
      });
      return;
    }

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      res.status(401).json({
        error: {
          message: "This API key has expired",
          type: "authentication_error",
          param: null,
          code: "api_key_expired",
        },
      });
      return;
    }

    // Update last_used_at (fire and forget)
    db.execute(sql`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${row.id}`).catch((err) => {
      log.warn("Failed to update last_used_at", { error: err });
    });

    req.apiKeyUser = {
      userId: row.uid || row.user_id,
      email: row.email,
      role: row.role,
      apiKeyId: row.id,
      permissions: Array.isArray(row.permissions) ? row.permissions : JSON.parse(row.permissions || '["read"]'),
      rateLimit: Number(row.rate_limit) || 1000,
    };

    next();
  } catch (error) {
    log.error("API key authentication error", { error });
    res.status(500).json({
      error: {
        message: "An internal error occurred during authentication",
        type: "api_error",
        param: null,
        code: "internal_error",
      },
    });
  }
}

/**
 * Simple per-key sliding-window rate limiter (in-memory).
 * For production multi-instance deployments swap to a Redis-backed counter.
 */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function apiRateLimit(req: Request, res: Response, next: NextFunction): void {
  const user = req.apiKeyUser;
  if (!user) {
    // Should never happen if authenticateApiKey ran first
    next();
    return;
  }

  const now = Date.now();
  const windowMs = 60_000; // 1 minute window
  let bucket = rateBuckets.get(user.apiKeyId);

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(user.apiKeyId, bucket);
  }

  bucket.count++;

  if (bucket.count > user.rateLimit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: {
        message: "Rate limit exceeded. Please retry after " + retryAfter + " seconds.",
        type: "tokens_exceeded",
        param: null,
        code: "rate_limit_exceeded",
      },
    });
    return;
  }

  next();
}
