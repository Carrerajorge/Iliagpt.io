/**
 * JWT Refresh Token Rotation Service (#57)
 * Secure token management with rotation and blacklisting
 */

import { createRequire } from 'module';
import crypto from 'crypto';

// jsonwebtoken is optional in some deployments; keep type-check green
const require = createRequire(import.meta.url);
let jwt: any;
try {
  jwt = require('jsonwebtoken');
} catch {
  jwt = null;
}
import { db } from '../db';
import { eq, and, lt } from 'drizzle-orm';

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret-change-in-prod';
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-secret-change-in-prod';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Token blacklist (in production, use Redis)
const tokenBlacklist = new Set<string>();

// Refresh token family tracking (for rotation)
const refreshTokenFamilies = new Map<string, {
    userId: number;
    createdAt: Date;
    lastRotatedAt: Date;
    tokens: Set<string>;
}>();

interface TokenPayload {
    userId: number;
    email: string;
    role: string;
    sessionId: string;
    fingerprint?: string;
}

interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
}

/**
 * Generate a new token pair
 */
export function generateTokenPair(payload: TokenPayload): TokenPair {
    if (!jwt) {
        throw new Error('jsonwebtoken not installed');
    }
    const sessionId = payload.sessionId || crypto.randomUUID();
    const familyId = crypto.randomUUID();

    // Access token - short lived
    const accessToken = jwt.sign(
        { ...payload, sessionId, type: 'access' },
        ACCESS_TOKEN_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // Refresh token - longer lived, includes family ID for rotation tracking
    const refreshToken = jwt.sign(
        { ...payload, sessionId, familyId, type: 'refresh' },
        REFRESH_TOKEN_SECRET,
        { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    // Track token family
    refreshTokenFamilies.set(familyId, {
        userId: payload.userId,
        createdAt: new Date(),
        lastRotatedAt: new Date(),
        tokens: new Set([refreshToken]),
    });

    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

    return { accessToken, refreshToken, expiresAt };
}

/**
 * Verify access token
 */
export function verifyAccessToken(token: string): TokenPayload | null {
    if (!jwt) return null;
    try {
        if (tokenBlacklist.has(token)) {
            return null;
        }

        const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as TokenPayload & { type: string };

        if (decoded.type !== 'access') {
            return null;
        }

        return decoded;
    } catch (error) {
        return null;
    }
}

/**
 * Rotate refresh token - issues new pair and invalidates old
 */
export function rotateRefreshToken(oldRefreshToken: string): TokenPair | null {
    if (!jwt) return null;
    try {
        // Verify the refresh token
        const decoded = jwt.verify(oldRefreshToken, REFRESH_TOKEN_SECRET) as TokenPayload & {
            type: string;
            familyId: string;
        };

        if (decoded.type !== 'refresh') {
            return null;
        }

        const family = refreshTokenFamilies.get(decoded.familyId);

        if (!family) {
            // Unknown family - possible token theft, invalidate
            console.warn('Unknown token family, possible theft detected');
            return null;
        }

        // Check if token was already used (reuse detection)
        if (!family.tokens.has(oldRefreshToken)) {
            // Token reuse detected! Invalidate entire family
            console.warn('Refresh token reuse detected! Invalidating all tokens for user:', decoded.userId);
            invalidateTokenFamily(decoded.familyId);
            return null;
        }

        // Remove old token from valid set
        family.tokens.delete(oldRefreshToken);
        tokenBlacklist.add(oldRefreshToken);

        // Generate new pair
        const newPair = generateTokenPair({
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role,
            sessionId: decoded.sessionId,
            fingerprint: decoded.fingerprint,
        });

        // Update family
        family.lastRotatedAt = new Date();
        family.tokens.add(newPair.refreshToken);

        return newPair;
    } catch (error) {
        return null;
    }
}

/**
 * Invalidate all tokens for a family (security measure)
 */
export function invalidateTokenFamily(familyId: string): void {
    const family = refreshTokenFamilies.get(familyId);
    if (family) {
        for (const token of family.tokens) {
            tokenBlacklist.add(token);
        }
        refreshTokenFamilies.delete(familyId);
    }
}

/**
 * Invalidate all tokens for a user (logout all sessions)
 */
export function invalidateAllUserTokens(userId: number): void {
    for (const [familyId, family] of refreshTokenFamilies.entries()) {
        if (family.userId === userId) {
            invalidateTokenFamily(familyId);
        }
    }
}

/**
 * Blacklist a specific token
 */
export function blacklistToken(token: string): void {
    tokenBlacklist.add(token);
}

/**
 * Clean up expired tokens from blacklist (run periodically)
 */
export function cleanupExpiredTokens(): void {
    const toRemove: string[] = [];

    for (const token of tokenBlacklist) {
        try {
            // If we can't decode it or it's expired, remove from blacklist
            jwt.verify(token, REFRESH_TOKEN_SECRET);
        } catch {
            toRemove.push(token);
        }
    }

    for (const token of toRemove) {
        tokenBlacklist.delete(token);
    }

    // Also cleanup old token families
    const now = Date.now();
    for (const [familyId, family] of refreshTokenFamilies.entries()) {
        if (now - family.createdAt.getTime() > REFRESH_TOKEN_EXPIRY_MS * 2) {
            refreshTokenFamilies.delete(familyId);
        }
    }
}

// Run cleanup every hour
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

/**
 * Extract token from Authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.substring(7);
}

// ============================================
// EXPRESS MIDDLEWARE
// ============================================

import { Request, Response, NextFunction } from 'express';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const payload = verifyAccessToken(token);

    if (!payload) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user to request
    (req as any).user = payload;
    next();
}

// ============================================
// ROUTER
// ============================================

import { Router } from 'express';

export function createTokenRouter() {
    const router = Router();

    // Refresh token endpoint
    router.post('/refresh', (req, res) => {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token required' });
        }

        const newPair = rotateRefreshToken(refreshToken);

        if (!newPair) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        res.json({
            accessToken: newPair.accessToken,
            refreshToken: newPair.refreshToken,
            expiresAt: newPair.expiresAt.toISOString(),
        });
    });

    // Logout (single session)
    router.post('/logout', authMiddleware, (req, res) => {
        const token = extractBearerToken(req.headers.authorization);
        if (token) {
            blacklistToken(token);
        }
        res.json({ success: true });
    });

    // Logout all sessions
    router.post('/logout-all', authMiddleware, (req, res) => {
        const userId = (req as any).user?.userId;
        if (userId) {
            invalidateAllUserTokens(userId);
        }
        res.json({ success: true, message: 'All sessions terminated' });
    });

    return router;
}
