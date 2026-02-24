/**
 * Session Fingerprinting Service (#63)
 * Detect session hijacking by fingerprinting client characteristics
 */

import crypto from 'crypto';
import { Request } from 'express';

interface SessionFingerprint {
    hash: string;
    components: FingerprintComponents;
    createdAt: Date;
    lastSeenAt: Date;
    trustScore: number;
}

interface FingerprintComponents {
    userAgent: string;
    acceptLanguage: string;
    acceptEncoding: string;
    ipPrefix: string; // First 3 octets for IPv4, first 4 groups for IPv6
    timezone?: string;
    screenResolution?: string;
    colorDepth?: string;
    platform?: string;
}

// Store for active session fingerprints
const sessionFingerprints = new Map<string, SessionFingerprint>();

/**
 * Extract fingerprint components from request
 */
export function extractFingerprintComponents(req: Request): FingerprintComponents {
    const ip = (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');

    // Get IP prefix (for IPv4: first 3 octets, for IPv6: first 4 groups)
    let ipPrefix = '';
    if (ip.includes(':')) {
        // IPv6
        ipPrefix = ip.split(':').slice(0, 4).join(':');
    } else {
        // IPv4
        ipPrefix = ip.split('.').slice(0, 3).join('.');
    }

    return {
        userAgent: req.headers['user-agent'] || '',
        acceptLanguage: req.headers['accept-language'] || '',
        acceptEncoding: req.headers['accept-encoding'] || '',
        ipPrefix,
        timezone: req.headers['x-timezone'] as string || undefined,
        screenResolution: req.headers['x-screen-resolution'] as string || undefined,
        colorDepth: req.headers['x-color-depth'] as string || undefined,
        platform: req.headers['x-platform'] as string || undefined,
    };
}

/**
 * Generate fingerprint hash from components
 */
export function generateFingerprintHash(components: FingerprintComponents): string {
    const data = [
        components.userAgent,
        components.acceptLanguage,
        components.acceptEncoding,
        components.ipPrefix,
        components.timezone || '',
        components.screenResolution || '',
        components.colorDepth || '',
        components.platform || '',
    ].join('|');

    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

/**
 * Create a new fingerprint for a session
 */
export function createSessionFingerprint(sessionId: string, req: Request): SessionFingerprint {
    const components = extractFingerprintComponents(req);
    const hash = generateFingerprintHash(components);

    const fingerprint: SessionFingerprint = {
        hash,
        components,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        trustScore: 100,
    };

    sessionFingerprints.set(sessionId, fingerprint);
    return fingerprint;
}

/**
 * Validate session fingerprint
 * Returns trust score (0-100) and analysis
 */
export function validateSessionFingerprint(
    sessionId: string,
    req: Request
): {
    valid: boolean;
    trustScore: number;
    anomalies: string[];
    newFingerprint: boolean;
} {
    const stored = sessionFingerprints.get(sessionId);
    const currentComponents = extractFingerprintComponents(req);
    const currentHash = generateFingerprintHash(currentComponents);

    // No stored fingerprint - new session
    if (!stored) {
        createSessionFingerprint(sessionId, req);
        return {
            valid: true,
            trustScore: 100,
            anomalies: [],
            newFingerprint: true,
        };
    }

    const anomalies: string[] = [];
    let trustScore = 100;

    // Check each component
    if (currentComponents.userAgent !== stored.components.userAgent) {
        anomalies.push('user_agent_changed');
        trustScore -= 40; // Major red flag
    }

    if (currentComponents.acceptLanguage !== stored.components.acceptLanguage) {
        anomalies.push('language_changed');
        trustScore -= 10;
    }

    if (currentComponents.acceptEncoding !== stored.components.acceptEncoding) {
        anomalies.push('encoding_changed');
        trustScore -= 5;
    }

    if (currentComponents.ipPrefix !== stored.components.ipPrefix) {
        anomalies.push('ip_prefix_changed');
        trustScore -= 25; // Significant - might be VPN/network change
    }

    if (stored.components.timezone && currentComponents.timezone &&
        currentComponents.timezone !== stored.components.timezone) {
        anomalies.push('timezone_changed');
        trustScore -= 15;
    }

    if (stored.components.platform && currentComponents.platform &&
        currentComponents.platform !== stored.components.platform) {
        anomalies.push('platform_changed');
        trustScore -= 30; // Unlikely to change
    }

    // Time-based analysis
    const timeSinceLastSeen = Date.now() - stored.lastSeenAt.getTime();
    const HOUR = 60 * 60 * 1000;

    // If session was idle for > 24h and fingerprint changed, more suspicious
    if (timeSinceLastSeen > 24 * HOUR && anomalies.length > 0) {
        trustScore -= 10;
        anomalies.push('long_idle_with_changes');
    }

    // Update last seen
    stored.lastSeenAt = new Date();
    stored.trustScore = Math.max(0, trustScore);

    // Determine validity
    const valid = trustScore >= 40; // Below 40% is considered suspicious

    return {
        valid,
        trustScore: Math.max(0, trustScore),
        anomalies,
        newFingerprint: false,
    };
}

/**
 * Get fingerprint for session
 */
export function getSessionFingerprint(sessionId: string): SessionFingerprint | null {
    return sessionFingerprints.get(sessionId) || null;
}

/**
 * Clear session fingerprint
 */
export function clearSessionFingerprint(sessionId: string): void {
    sessionFingerprints.delete(sessionId);
}

/**
 * Middleware to validate fingerprint on each request
 */
import { Response, NextFunction } from 'express';

export function fingerprintMiddleware(options: {
    enforceStrict?: boolean;
    trustThreshold?: number;
    onAnomaly?: (sessionId: string, anomalies: string[], trustScore: number) => void;
} = {}) {
    const {
        enforceStrict = false,
        trustThreshold = 40,
        onAnomaly,
    } = options;

    return (req: Request, res: Response, next: NextFunction) => {
        const sessionId = (req as any).user?.sessionId;

        if (!sessionId) {
            return next();
        }

        const result = validateSessionFingerprint(sessionId, req);

        // Attach to request for logging/auditing
        (req as any).fingerprintResult = result;

        if (!result.valid || result.trustScore < trustThreshold) {
            // Trigger anomaly callback
            if (onAnomaly && result.anomalies.length > 0) {
                onAnomaly(sessionId, result.anomalies, result.trustScore);
            }

            if (enforceStrict) {
                return res.status(401).json({
                    error: 'Session validation failed',
                    code: 'SESSION_ANOMALY',
                    requireReauth: true,
                });
            }
        }

        next();
    };
}

// Cleanup old fingerprints periodically
setInterval(() => {
    const now = Date.now();
    const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const [sessionId, fingerprint] of sessionFingerprints.entries()) {
        if (now - fingerprint.lastSeenAt.getTime() > MAX_AGE) {
            sessionFingerprints.delete(sessionId);
        }
    }
}, 60 * 60 * 1000); // Every hour
