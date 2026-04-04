import crypto from 'crypto';
import { Request, RequestHandler, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import logger from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeviceInfo {
  userAgent: string;
  ip: string;
  acceptLanguage?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  tokenId: string;
}

export interface TokenClaims {
  userId: string;
  tenantId: string;
  role: string;
  deviceFingerprint: string;
  tokenId: string;
  family: string;
  iat?: number;
  exp?: number;
}

interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
  family: string;
  deviceFingerprint: string;
}

interface AccessTokenPayload extends TokenClaims {
  type: 'access';
}

interface RefreshTokenJwtPayload extends RefreshTokenPayload {
  type: 'refresh';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;           // 15 minutes
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const REVOCATION_TTL_SECONDS = ACCESS_TOKEN_TTL_SECONDS + 60; // slight buffer

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET environment variables are required');
}

// ─── ZeroTrustAuth ────────────────────────────────────────────────────────────

export class ZeroTrustAuth {
  private readonly redis: Redis;
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(redis: Redis) {
    this.redis = redis;
    this.accessSecret = JWT_SECRET!;
    this.refreshSecret = JWT_REFRESH_SECRET!;
  }

  // ── Key helpers ──────────────────────────────────────────────────────────────

  private refreshTokenRedisKey(userId: string, tokenId: string): string {
    return `rt:${userId}:${tokenId}`;
  }

  private familyRedisKey(family: string): string {
    return `rtfam:${family}`;
  }

  private revocationRedisKey(tokenId: string): string {
    return `revoked:${tokenId}`;
  }

  private userTokensSetKey(userId: string): string {
    return `user_tokens:${userId}`;
  }

  // ── Fingerprint ──────────────────────────────────────────────────────────────

  generateDeviceFingerprint(req: Request): string {
    const components = [
      req.headers['user-agent'] ?? '',
      req.ip ?? req.socket?.remoteAddress ?? '',
      req.headers['accept-language'] ?? '',
    ];
    return crypto
      .createHash('sha256')
      .update(components.join('|'))
      .digest('hex');
  }

  validateDeviceFingerprint(token: string, req: Request): boolean {
    try {
      const decoded = jwt.decode(token) as AccessTokenPayload | null;
      if (!decoded?.deviceFingerprint) return false;
      const current = this.generateDeviceFingerprint(req);
      return crypto.timingSafeEqual(
        Buffer.from(decoded.deviceFingerprint, 'hex'),
        Buffer.from(current, 'hex'),
      );
    } catch {
      return false;
    }
  }

  // ── Token issuance ────────────────────────────────────────────────────────────

  async issueTokenPair(
    userId: string,
    deviceInfo: DeviceInfo,
    opts?: { tenantId?: string; role?: string; existingFamily?: string },
  ): Promise<TokenPair> {
    const tokenId = crypto.randomUUID();
    const family = opts?.existingFamily ?? crypto.randomUUID();
    const fingerprint = crypto
      .createHash('sha256')
      .update([deviceInfo.userAgent, deviceInfo.ip, deviceInfo.acceptLanguage ?? ''].join('|'))
      .digest('hex');

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((now + ACCESS_TOKEN_TTL_SECONDS) * 1000);

    // Access token
    const accessPayload: AccessTokenPayload = {
      userId,
      tenantId: opts?.tenantId ?? '',
      role: opts?.role ?? 'user',
      deviceFingerprint: fingerprint,
      tokenId,
      family,
      type: 'access',
    };

    const accessToken = jwt.sign(accessPayload, this.accessSecret, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      issuer: 'iliagpt',
      subject: userId,
    });

    // Refresh token
    const refreshPayload: RefreshTokenJwtPayload = {
      userId,
      tokenId,
      family,
      deviceFingerprint: fingerprint,
      type: 'refresh',
    };

    const refreshToken = jwt.sign(refreshPayload, this.refreshSecret, {
      expiresIn: REFRESH_TOKEN_TTL_SECONDS,
      issuer: 'iliagpt',
      subject: userId,
    });

    // Store refresh token hash in Redis
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const pipeline = this.redis.pipeline();
    pipeline.setex(
      this.refreshTokenRedisKey(userId, tokenId),
      REFRESH_TOKEN_TTL_SECONDS,
      refreshHash,
    );
    // Track token in user set for bulk revocation
    pipeline.sadd(this.userTokensSetKey(userId), tokenId);
    pipeline.expire(this.userTokensSetKey(userId), REFRESH_TOKEN_TTL_SECONDS);
    // Track family membership
    pipeline.sadd(this.familyRedisKey(family), tokenId);
    pipeline.expire(this.familyRedisKey(family), REFRESH_TOKEN_TTL_SECONDS);
    await pipeline.exec();

    logger.info({ userId, tokenId, family }, 'Token pair issued');
    return { accessToken, refreshToken, expiresAt, tokenId };
  }

  // ── Verification ──────────────────────────────────────────────────────────────

  async verifyAccessToken(token: string): Promise<TokenClaims> {
    let decoded: AccessTokenPayload;

    try {
      decoded = jwt.verify(token, this.accessSecret, {
        issuer: 'iliagpt',
      }) as AccessTokenPayload;
    } catch (err) {
      const msg = err instanceof jwt.TokenExpiredError ? 'Token expired' : 'Invalid token';
      logger.warn({ err }, msg);
      throw new Error(msg);
    }

    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }

    // Check revocation list
    const revoked = await this.redis.exists(this.revocationRedisKey(decoded.tokenId));
    if (revoked) {
      logger.warn({ tokenId: decoded.tokenId }, 'Attempted use of revoked token');
      throw new Error('Token has been revoked');
    }

    const { type: _type, ...claims } = decoded;
    return claims as TokenClaims;
  }

  // ── Rotation ──────────────────────────────────────────────────────────────────

  async refreshTokens(refreshToken: string, deviceInfo: DeviceInfo): Promise<TokenPair> {
    let decoded: RefreshTokenJwtPayload;

    try {
      decoded = jwt.verify(refreshToken, this.refreshSecret, {
        issuer: 'iliagpt',
      }) as RefreshTokenJwtPayload;
    } catch (err) {
      logger.warn({ err }, 'Refresh token verification failed');
      throw new Error('Invalid refresh token');
    }

    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    const { userId, tokenId, family } = decoded;
    const storedKey = this.refreshTokenRedisKey(userId, tokenId);
    const storedHash = await this.redis.get(storedKey);

    if (!storedHash) {
      // Token not in Redis — possible reuse of a consumed token -> family compromise
      logger.error({ userId, tokenId, family }, 'Refresh token reuse detected — revoking family');
      await this.revokeFamilyTokens(family, userId);
      throw new Error('Token reuse detected. All sessions invalidated.');
    }

    const incomingHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const hashesMatch = crypto.timingSafeEqual(
      Buffer.from(storedHash, 'hex'),
      Buffer.from(incomingHash, 'hex'),
    );

    if (!hashesMatch) {
      logger.error({ userId, tokenId }, 'Refresh token hash mismatch — revoking family');
      await this.revokeFamilyTokens(family, userId);
      throw new Error('Token integrity check failed. All sessions invalidated.');
    }

    // Consume the current token immediately (atomic delete)
    const deleted = await this.redis.del(storedKey);
    if (deleted === 0) {
      // Race condition: another request already consumed this token
      logger.warn({ userId, tokenId }, 'Concurrent refresh attempt detected');
      throw new Error('Token already consumed');
    }

    // Remove from user token set and family set
    await this.redis.srem(this.userTokensSetKey(userId), tokenId);
    await this.redis.srem(this.familyRedisKey(family), tokenId);

    // Issue new pair with same family
    const newPair = await this.issueTokenPair(userId, deviceInfo, { existingFamily: family });
    logger.info({ userId, oldTokenId: tokenId, newTokenId: newPair.tokenId }, 'Tokens rotated');
    return newPair;
  }

  // ── Revocation ────────────────────────────────────────────────────────────────

  async revokeToken(tokenId: string, userId: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.setex(this.revocationRedisKey(tokenId), REVOCATION_TTL_SECONDS, '1');
    pipeline.del(this.refreshTokenRedisKey(userId, tokenId));
    pipeline.srem(this.userTokensSetKey(userId), tokenId);
    await pipeline.exec();
    logger.info({ tokenId, userId }, 'Token revoked');
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    const setKey = this.userTokensSetKey(userId);
    const tokenIds = await this.redis.smembers(setKey);

    if (tokenIds.length === 0) {
      logger.info({ userId }, 'No active tokens to revoke');
      return;
    }

    const pipeline = this.redis.pipeline();
    for (const tokenId of tokenIds) {
      pipeline.setex(this.revocationRedisKey(tokenId), REVOCATION_TTL_SECONDS, '1');
      pipeline.del(this.refreshTokenRedisKey(userId, tokenId));
    }
    pipeline.del(setKey);
    await pipeline.exec();

    logger.info({ userId, count: tokenIds.length }, 'All user tokens revoked');
  }

  private async revokeFamilyTokens(family: string, userId: string): Promise<void> {
    const famKey = this.familyRedisKey(family);
    const tokenIds = await this.redis.smembers(famKey);

    const pipeline = this.redis.pipeline();
    for (const tokenId of tokenIds) {
      pipeline.setex(this.revocationRedisKey(tokenId), REVOCATION_TTL_SECONDS, '1');
      pipeline.del(this.refreshTokenRedisKey(userId, tokenId));
      pipeline.srem(this.userTokensSetKey(userId), tokenId);
    }
    pipeline.del(famKey);
    await pipeline.exec();

    logger.warn({ family, userId, count: tokenIds.length }, 'Token family revoked due to compromise');
  }

  // ── Express middleware ────────────────────────────────────────────────────────

  authenticate(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or malformed Authorization header' });
        return;
      }

      const token = authHeader.slice(7);

      try {
        const claims = await this.verifyAccessToken(token);

        // Optional: strict device fingerprint enforcement
        if (process.env.ENFORCE_DEVICE_FINGERPRINT === 'true') {
          const currentFingerprint = this.generateDeviceFingerprint(req);
          const match = crypto.timingSafeEqual(
            Buffer.from(claims.deviceFingerprint, 'hex'),
            Buffer.from(currentFingerprint, 'hex'),
          );
          if (!match) {
            logger.warn(
              { userId: claims.userId, tokenId: claims.tokenId },
              'Device fingerprint mismatch',
            );
            res.status(401).json({ error: 'Device fingerprint mismatch' });
            return;
          }
        }

        (req as Request & { user: TokenClaims }).user = claims;
        next();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Authentication failed';
        res.status(401).json({ error: message });
      }
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: ZeroTrustAuth | null = null;

export function getZeroTrustAuth(redis?: Redis): ZeroTrustAuth {
  if (!_instance) {
    if (!redis) {
      throw new Error('Redis instance required for first initialization of ZeroTrustAuth');
    }
    _instance = new ZeroTrustAuth(redis);
  }
  return _instance;
}

export default ZeroTrustAuth;
