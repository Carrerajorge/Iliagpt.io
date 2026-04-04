import crypto from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import Redis from "ioredis";
import { Logger } from "../lib/logger";
import { env } from "../config/env";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  expiresAt: Date;
}

export interface DeviceFingerprint {
  deviceId: string;
  userAgent: string;
  ipAddress: string;
  acceptLanguage: string;
  hash: string;
}

export interface TokenPayload {
  sub: string;         // userId
  jti: string;         // JWT ID (for revocation)
  deviceId: string;
  iat: number;
  exp: number;
  type: "access" | "refresh";
}

export interface SuspiciousActivityReport {
  suspicious: boolean;
  reasons: string[];
  riskScore: number;   // 0-100
  recommendAction: "allow" | "challenge" | "block";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;          // 15 minutes
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MAX_DEVICES_PER_USER = 10;
const REVOKED_TOKEN_KEY_PREFIX = "zt:revoked:";
const USER_DEVICES_KEY_PREFIX = "zt:devices:";
const REFRESH_TOKEN_KEY_PREFIX = "zt:refresh:";
const SUSPICIOUS_ATTEMPTS_KEY_PREFIX = "zt:suspicious:";

// ─── ZeroTrustAuth ────────────────────────────────────────────────────────────

class ZeroTrustAuth {
  private redis: Redis;
  private secret: string;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    this.redis.on("error", (err: Error) => {
      Logger.warn("[ZeroTrustAuth] Redis error", { error: err.message });
    });
    // Derive a 256-bit secret from SESSION_SECRET
    this.secret = crypto
      .createHash("sha256")
      .update(env.SESSION_SECRET + ":zero-trust")
      .digest("hex");
  }

  // ── Token issuance ──────────────────────────────────────────────────────────

  async issueTokens(userId: string, deviceFingerprint: DeviceFingerprint): Promise<TokenPair> {
    const accessJti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    const accessPayload: TokenPayload = {
      sub: userId,
      jti: accessJti,
      deviceId: deviceFingerprint.deviceId,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_SECONDS,
      type: "access",
    };

    const refreshPayload: TokenPayload = {
      sub: userId,
      jti: refreshJti,
      deviceId: deviceFingerprint.deviceId,
      iat: now,
      exp: now + REFRESH_TOKEN_TTL_SECONDS,
      type: "refresh",
    };

    const accessToken = this.signToken(accessPayload);
    const refreshToken = this.signToken(refreshPayload);

    // Persist refresh token in Redis so we can revoke it
    const refreshKey = `${REFRESH_TOKEN_KEY_PREFIX}${refreshJti}`;
    await this.redis.set(refreshKey, JSON.stringify({ userId, deviceId: deviceFingerprint.deviceId }), "EX", REFRESH_TOKEN_TTL_SECONDS);

    // Track devices per user (keep last N)
    const devicesKey = `${USER_DEVICES_KEY_PREFIX}${userId}`;
    await this.redis.lpush(devicesKey, deviceFingerprint.deviceId);
    await this.redis.ltrim(devicesKey, 0, MAX_DEVICES_PER_USER - 1);
    await this.redis.expire(devicesKey, REFRESH_TOKEN_TTL_SECONDS);

    Logger.security("[ZeroTrustAuth] Tokens issued", { userId, deviceId: deviceFingerprint.deviceId });

    return {
      accessToken,
      refreshToken,
      deviceId: deviceFingerprint.deviceId,
      expiresAt: new Date((now + ACCESS_TOKEN_TTL_SECONDS) * 1000),
    };
  }

  // ── Token verification ──────────────────────────────────────────────────────

  async verifyAccessToken(token: string): Promise<TokenPayload> {
    const payload = this.verifyToken(token) as TokenPayload;

    if (payload.type !== "access") {
      throw new Error("Invalid token type");
    }

    const revoked = await this.isTokenRevoked(payload.jti);
    if (revoked) {
      throw new Error("Token has been revoked");
    }

    return payload;
  }

  // ── Token refresh ───────────────────────────────────────────────────────────

  async refreshTokens(refreshToken: string, deviceFingerprint: DeviceFingerprint): Promise<TokenPair> {
    const payload = this.verifyToken(refreshToken) as TokenPayload;

    if (payload.type !== "refresh") {
      throw new Error("Invalid token type");
    }

    const revoked = await this.isTokenRevoked(payload.jti);
    if (revoked) {
      Logger.security("[ZeroTrustAuth] Refresh token reuse detected", { userId: payload.sub });
      await this.revokeAllUserTokens(payload.sub);
      throw new Error("Token reuse detected — all sessions revoked");
    }

    // Validate device
    if (payload.deviceId !== deviceFingerprint.deviceId) {
      Logger.security("[ZeroTrustAuth] Device mismatch on refresh", {
        userId: payload.sub,
        expected: payload.deviceId,
        got: deviceFingerprint.deviceId,
      });
      throw new Error("Device fingerprint mismatch");
    }

    // Revoke old refresh token (rotation)
    await this.revokeToken(refreshToken);

    return this.issueTokens(payload.sub, deviceFingerprint);
  }

  // ── Revocation ──────────────────────────────────────────────────────────────

  async revokeToken(token: string): Promise<void> {
    try {
      const payload = this.verifyToken(token) as TokenPayload;
      const ttl = payload.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.redis.set(`${REVOKED_TOKEN_KEY_PREFIX}${payload.jti}`, "1", "EX", ttl);
      }
      // Also remove from refresh store if it's a refresh token
      if (payload.type === "refresh") {
        await this.redis.del(`${REFRESH_TOKEN_KEY_PREFIX}${payload.jti}`);
      }
    } catch {
      // If token is already invalid/expired, no-op
    }
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    // Find all refresh tokens for this user by scanning (small scope in practice)
    const pattern = `${REFRESH_TOKEN_KEY_PREFIX}*`;
    let cursor = "0";
    const toDelete: string[] = [];

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      for (const key of keys) {
        const raw = await this.redis.get(key);
        if (raw) {
          const data = JSON.parse(raw);
          if (data.userId === userId) {
            toDelete.push(key);
          }
        }
      }
    } while (cursor !== "0");

    if (toDelete.length > 0) {
      await this.redis.del(...toDelete);
    }

    Logger.security("[ZeroTrustAuth] All user tokens revoked", { userId, count: toDelete.length });
  }

  async isTokenRevoked(jti: string): Promise<boolean> {
    const result = await this.redis.get(`${REVOKED_TOKEN_KEY_PREFIX}${jti}`);
    return result !== null;
  }

  // ── Device fingerprinting ───────────────────────────────────────────────────

  async createDeviceFingerprint(req: Request): Promise<DeviceFingerprint> {
    const userAgent = req.get("user-agent") || "";
    const ipAddress = (req.ip || req.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
    const acceptLanguage = req.get("accept-language") || "";
    const acceptEncoding = req.get("accept-encoding") || "";

    const raw = `${userAgent}|${ipAddress}|${acceptLanguage}|${acceptEncoding}`;
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const deviceId = crypto.createHash("sha256").update(hash + ipAddress).digest("hex").slice(0, 16);

    return { deviceId, userAgent, ipAddress, acceptLanguage, hash };
  }

  // ── Suspicious activity detection ───────────────────────────────────────────

  async detectSuspiciousActivity(userId: string, deviceFingerprint: DeviceFingerprint): Promise<SuspiciousActivityReport> {
    const reasons: string[] = [];
    let riskScore = 0;

    // Check known devices
    const devicesKey = `${USER_DEVICES_KEY_PREFIX}${userId}`;
    const knownDevices = await this.redis.lrange(devicesKey, 0, -1);
    if (!knownDevices.includes(deviceFingerprint.deviceId)) {
      reasons.push("Unknown device");
      riskScore += 30;
    }

    // Check failed attempts
    const attemptsKey = `${SUSPICIOUS_ATTEMPTS_KEY_PREFIX}${userId}`;
    const attempts = parseInt((await this.redis.get(attemptsKey)) || "0", 10);
    if (attempts > 5) {
      reasons.push(`Excessive failed attempts: ${attempts}`);
      riskScore += Math.min(50, attempts * 5);
    }

    // Bot/empty user agent
    if (!deviceFingerprint.userAgent || deviceFingerprint.userAgent.length < 10) {
      reasons.push("Suspicious or missing user agent");
      riskScore += 20;
    }

    let recommendAction: SuspiciousActivityReport["recommendAction"] = "allow";
    if (riskScore >= 70) recommendAction = "block";
    else if (riskScore >= 40) recommendAction = "challenge";

    return { suspicious: riskScore > 0, reasons, riskScore, recommendAction };
  }

  // ── Middleware ───────────────────────────────────────────────────────────────

  requireAuth(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
          return res.status(401).json({ error: "Missing or invalid Authorization header" });
        }
        const token = authHeader.slice(7);
        const payload = await this.verifyAccessToken(token);
        (req as any).tokenPayload = payload;
        (req as any).userId = payload.sub;
        next();
      } catch (err: any) {
        Logger.warn("[ZeroTrustAuth] Auth failed", { error: err.message, path: req.path });
        return res.status(401).json({ error: "Unauthorized", message: err.message });
      }
    };
  }

  optionalAuth(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          const payload = await this.verifyAccessToken(token);
          (req as any).tokenPayload = payload;
          (req as any).userId = payload.sub;
        }
      } catch {
        // Optional — silently ignore
      }
      next();
    };
  }

  // ── Private: HMAC-SHA256 JWT (no external library) ───────────────────────────

  private signToken(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const unsigned = `${header}.${body}`;
    const sig = crypto.createHmac("sha256", this.secret).update(unsigned).digest("base64url");
    return `${unsigned}.${sig}`;
  }

  private verifyToken(token: string): Record<string, unknown> {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Malformed token");
    }
    const [header, body, sig] = parts;
    const unsigned = `${header}.${body}`;
    const expected = crypto.createHmac("sha256", this.secret).update(unsigned).digest("base64url");

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new Error("Invalid token signature");
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error("Token expired");
    }
    return payload;
  }
}

export const zeroTrustAuth = new ZeroTrustAuth();
