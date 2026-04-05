import crypto from 'crypto';
import { Request, RequestHandler, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { pool } from '../db';
import logger from '../lib/logger';

// ─── Scopes ───────────────────────────────────────────────────────────────────

export enum APIKeyScope {
  CHAT_READ     = 'chat:read',
  CHAT_WRITE    = 'chat:write',
  AGENTS_READ   = 'agents:read',
  AGENTS_WRITE  = 'agents:write',
  FILES_READ    = 'files:read',
  FILES_WRITE   = 'files:write',
  USERS_READ    = 'users:read',
  USERS_WRITE   = 'users:write',
  ADMIN_ALL     = 'admin:*',
  BILLING_READ  = 'billing:read',
  BILLING_WRITE = 'billing:write',
  WEBHOOKS      = 'webhooks:write',
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateKeyOptions {
  userId: string;
  tenantId: string;
  name: string;
  scopes: string[];
  expiresAt?: Date;
  rateLimit?: RateLimitConfig;
  ipWhitelist?: string[];
  metadata?: Record<string, unknown>;
}

export interface RateLimitConfig {
  requests: number;
  windowSeconds: number;
}

export interface APIKeyResult {
  keyId: string;
  /** Returned ONCE — never stored; caller must save immediately */
  rawKey: string;
  name: string;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date | null;
}

export interface APIKeyInfo {
  keyId: string;
  userId: string;
  tenantId: string;
  name: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  enabled: boolean;
  ipWhitelist: string[];
  metadata: Record<string, unknown>;
  rateLimit: RateLimitConfig | null;
  revokedAt: Date | null;
  revokedBy: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ENV_TAG = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
const RATE_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])
  local clear_before = now - window * 1000

  redis.call('ZREMRANGEBYSCORE', key, '-inf', clear_before)
  local count = redis.call('ZCARD', key)

  if count < limit then
    redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
    redis.call('PEXPIRE', key, window * 1000)
    return 1
  end
  return 0
`;

// ─── APIKeyManager ─────────────────────────────────────────────────────────────

export class APIKeyManager {
  private readonly db: Pool;
  private readonly redis: Redis;
  private initialized = false;

  constructor(db: Pool, redis: Redis) {
    this.db = db;
    this.redis = redis;
  }

  // ── Schema bootstrap ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.db.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        key_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       TEXT        NOT NULL,
        tenant_id     TEXT        NOT NULL,
        name          TEXT        NOT NULL,
        key_hash      TEXT        NOT NULL UNIQUE,
        key_prefix    TEXT        NOT NULL,
        scopes        TEXT[]      NOT NULL DEFAULT '{}',
        expires_at    TIMESTAMPTZ,
        rate_limit    JSONB,
        ip_whitelist  TEXT[]      NOT NULL DEFAULT '{}',
        metadata      JSONB       NOT NULL DEFAULT '{}',
        enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
        last_used_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at    TIMESTAMPTZ,
        revoked_by    TEXT,
        CONSTRAINT api_keys_name_user_unique UNIQUE (user_id, name)
      );

      CREATE INDEX IF NOT EXISTS api_keys_user_idx    ON api_keys (user_id);
      CREATE INDEX IF NOT EXISTS api_keys_tenant_idx  ON api_keys (tenant_id);
      CREATE INDEX IF NOT EXISTS api_keys_hash_idx    ON api_keys (key_hash);
      CREATE INDEX IF NOT EXISTS api_keys_enabled_idx ON api_keys (enabled) WHERE enabled = TRUE;
    `);

    this.initialized = true;
    logger.info('api_keys table ensured');
  }

  // ── Key generation helpers ───────────────────────────────────────────────────

  private generateRawKey(): string {
    const random = crypto.randomBytes(32).toString('hex');
    return `ilg_${ENV_TAG}_${random}`;
  }

  private hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  private keyPrefix(rawKey: string): string {
    // e.g. "ilg_dev_a1b2c3d4" — first 16 chars for display/identification
    return rawKey.slice(0, 16);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  async createKey(options: CreateKeyOptions): Promise<APIKeyResult> {
    await this.initialize();

    const rawKey = this.generateRawKey();
    const keyHash = this.hashKey(rawKey);
    const prefix = this.keyPrefix(rawKey);

    const result = await this.db.query(
      `INSERT INTO api_keys
         (user_id, tenant_id, name, key_hash, key_prefix, scopes, expires_at,
          rate_limit, ip_whitelist, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING key_id, name, scopes, created_at, expires_at`,
      [
        options.userId,
        options.tenantId,
        options.name,
        keyHash,
        prefix,
        options.scopes,
        options.expiresAt ?? null,
        options.rateLimit ? JSON.stringify(options.rateLimit) : null,
        options.ipWhitelist ?? [],
        JSON.stringify(options.metadata ?? {}),
      ],
    );

    const row = result.rows[0];
    logger.info(
      { keyId: row.key_id, userId: options.userId, name: options.name },
      'API key created',
    );

    return {
      keyId: row.key_id,
      rawKey,                // Only time raw key is exposed
      name: row.name,
      scopes: row.scopes,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async validateKey(rawKey: string, requiredScopes?: string[]): Promise<APIKeyInfo> {
    await this.initialize();

    if (!rawKey.startsWith('ilg_')) {
      throw new Error('Invalid API key format');
    }

    const keyHash = this.hashKey(rawKey);

    const result = await this.db.query(
      `SELECT key_id, user_id, tenant_id, name, scopes, expires_at, rate_limit,
              ip_whitelist, metadata, enabled, last_used_at, created_at,
              revoked_at, revoked_by
       FROM api_keys
       WHERE key_hash = $1`,
      [keyHash],
    );

    if (result.rows.length === 0) {
      throw new Error('API key not found');
    }

    const row = result.rows[0];

    if (!row.enabled || row.revoked_at !== null) {
      throw new Error('API key is disabled or revoked');
    }

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      throw new Error('API key has expired');
    }

    // IP whitelist check (skip if list is empty)
    if (row.ip_whitelist && row.ip_whitelist.length > 0) {
      // Caller must inject request IP via metadata or pass it — handled in middleware
      // Direct calls should pass IP via requiredScopes expansion pattern (see middleware)
    }

    // Scope validation
    if (requiredScopes && requiredScopes.length > 0) {
      this.assertScopes(row.scopes as string[], requiredScopes);
    }

    // Rate limit check
    if (row.rate_limit) {
      const allowed = await this.checkRateLimit(row.key_id, row.rate_limit as RateLimitConfig);
      if (!allowed) {
        throw new Error('Rate limit exceeded');
      }
    }

    // Update last used timestamp asynchronously (fire-and-forget, non-blocking)
    this.db
      .query(`UPDATE api_keys SET last_used_at = NOW() WHERE key_id = $1`, [row.key_id])
      .catch((err) => logger.error({ err, keyId: row.key_id }, 'Failed to update last_used_at'));

    return {
      keyId: row.key_id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      name: row.name,
      scopes: row.scopes,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      enabled: row.enabled,
      ipWhitelist: row.ip_whitelist ?? [],
      metadata: row.metadata ?? {},
      rateLimit: row.rate_limit,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
    };
  }

  // ── Scope validation ──────────────────────────────────────────────────────────

  private assertScopes(grantedScopes: string[], requiredScopes: string[]): void {
    for (const required of requiredScopes) {
      if (!this.hasScopeAccess(grantedScopes, required)) {
        throw new Error(`Missing required scope: ${required}`);
      }
    }
  }

  private hasScopeAccess(grantedScopes: string[], requiredScope: string): boolean {
    for (const granted of grantedScopes) {
      // Exact match
      if (granted === requiredScope) return true;

      // Wildcard match: 'admin:*' grants 'admin:read', 'admin:write', etc.
      if (granted.endsWith(':*')) {
        const grantedPrefix = granted.slice(0, -2); // strip ':*'
        const [reqNamespace] = requiredScope.split(':');
        if (grantedPrefix === reqNamespace) return true;
      }

      // Full wildcard '*' grants everything
      if (granted === '*') return true;
    }
    return false;
  }

  // ── Rate limiting (sliding window via Redis sorted set) ──────────────────────

  private rateLimitKey(keyId: string): string {
    return `ratelimit:apikey:${keyId}`;
  }

  private async checkRateLimit(keyId: string, config: RateLimitConfig): Promise<boolean> {
    const key = this.rateLimitKey(keyId);
    const now = Date.now();

    try {
      const result = await this.redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        key,
        String(config.requests),
        String(config.windowSeconds),
        String(now),
      );
      return result === 1;
    } catch (err) {
      // On Redis failure, fail open (allow request) to avoid availability issues
      logger.error({ err, keyId }, 'Rate limit check failed — failing open');
      return true;
    }
  }

  // ── Revocation ────────────────────────────────────────────────────────────────

  async revokeKey(keyId: string, revokedBy: string): Promise<void> {
    await this.initialize();

    const result = await this.db.query(
      `UPDATE api_keys
       SET enabled = FALSE, revoked_at = NOW(), revoked_by = $2
       WHERE key_id = $1 AND revoked_at IS NULL
       RETURNING key_id`,
      [keyId, revokedBy],
    );

    if (result.rowCount === 0) {
      throw new Error('API key not found or already revoked');
    }

    // Clear rate limit bucket
    await this.redis.del(this.rateLimitKey(keyId)).catch(() => {});
    logger.info({ keyId, revokedBy }, 'API key revoked');
  }

  // ── Rotation ──────────────────────────────────────────────────────────────────

  async rotateKey(keyId: string): Promise<APIKeyResult> {
    await this.initialize();

    // Fetch current key metadata
    const existing = await this.db.query(
      `SELECT user_id, tenant_id, name, scopes, expires_at,
              rate_limit, ip_whitelist, metadata
       FROM api_keys
       WHERE key_id = $1 AND enabled = TRUE AND revoked_at IS NULL`,
      [keyId],
    );

    if (existing.rows.length === 0) {
      throw new Error('API key not found or not active');
    }

    const row = existing.rows[0];

    // Use a DB transaction: create new key, revoke old key atomically
    const client = await this.db.connect();
    let newKeyResult: APIKeyResult;

    try {
      await client.query('BEGIN');

      const rawKey = this.generateRawKey();
      const keyHash = this.hashKey(rawKey);
      const prefix = this.keyPrefix(rawKey);
      const newName = `${row.name}_rotated_${Date.now()}`;

      const insertResult = await client.query(
        `INSERT INTO api_keys
           (user_id, tenant_id, name, key_hash, key_prefix, scopes, expires_at,
            rate_limit, ip_whitelist, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING key_id, name, scopes, created_at, expires_at`,
        [
          row.user_id,
          row.tenant_id,
          newName,
          keyHash,
          prefix,
          row.scopes,
          row.expires_at,
          row.rate_limit ? JSON.stringify(row.rate_limit) : null,
          row.ip_whitelist ?? [],
          JSON.stringify(row.metadata ?? {}),
        ],
      );

      await client.query(
        `UPDATE api_keys
         SET enabled = FALSE, revoked_at = NOW(), revoked_by = 'rotation'
         WHERE key_id = $1`,
        [keyId],
      );

      await client.query('COMMIT');

      const newRow = insertResult.rows[0];
      newKeyResult = {
        keyId: newRow.key_id,
        rawKey,
        name: newRow.name,
        scopes: newRow.scopes,
        createdAt: newRow.created_at,
        expiresAt: newRow.expires_at,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await this.redis.del(this.rateLimitKey(keyId)).catch(() => {});
    logger.info({ oldKeyId: keyId, newKeyId: newKeyResult.keyId }, 'API key rotated');
    return newKeyResult;
  }

  // ── Listing ───────────────────────────────────────────────────────────────────

  async listKeys(userId: string): Promise<APIKeyInfo[]> {
    await this.initialize();

    const result = await this.db.query(
      `SELECT key_id, user_id, tenant_id, name, scopes, expires_at, rate_limit,
              ip_whitelist, metadata, enabled, last_used_at, created_at,
              revoked_at, revoked_by
       FROM api_keys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );

    return result.rows.map((row) => ({
      keyId: row.key_id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      name: row.name,
      scopes: row.scopes,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      enabled: row.enabled,
      ipWhitelist: row.ip_whitelist ?? [],
      metadata: row.metadata ?? {},
      rateLimit: row.rate_limit,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
    }));
  }

  async updateKeyScopes(keyId: string, scopes: string[]): Promise<void> {
    await this.initialize();

    const result = await this.db.query(
      `UPDATE api_keys SET scopes = $2 WHERE key_id = $1 AND enabled = TRUE
       RETURNING key_id`,
      [keyId, scopes],
    );

    if (result.rowCount === 0) {
      throw new Error('API key not found or not active');
    }

    logger.info({ keyId, scopes }, 'API key scopes updated');
  }

  // ── Express middleware ────────────────────────────────────────────────────────

  requireAPIKey(scopes?: string[]): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      // Accept key from Authorization header (Bearer ilg_...) or X-API-Key header
      let rawKey: string | undefined;

      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ilg_')) {
        rawKey = authHeader.slice(7);
      } else if (req.headers['x-api-key']) {
        rawKey = req.headers['x-api-key'] as string;
      }

      if (!rawKey) {
        res.status(401).json({ error: 'API key required' });
        return;
      }

      try {
        const keyInfo = await this.validateKey(rawKey, scopes);

        // IP whitelist enforcement (when not empty)
        if (keyInfo.ipWhitelist.length > 0) {
          const clientIp = req.ip ?? req.socket?.remoteAddress ?? '';
          if (!keyInfo.ipWhitelist.includes(clientIp)) {
            logger.warn({ keyId: keyInfo.keyId, clientIp }, 'IP not in whitelist');
            res.status(403).json({ error: 'IP address not allowed' });
            return;
          }
        }

        (req as Request & { apiKey: APIKeyInfo }).apiKey = keyInfo;
        next();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'API key validation failed';
        const status = message.includes('Rate limit') ? 429 : 401;
        res.status(status).json({ error: message });
      }
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: APIKeyManager | null = null;

export function getAPIKeyManager(redis?: Redis): APIKeyManager {
  if (!_instance) {
    if (!redis) {
      throw new Error('Redis instance required for first initialization of APIKeyManager');
    }
    _instance = new APIKeyManager(pool, redis);
  }
  return _instance;
}

export default APIKeyManager;
