/**
 * CORS Configuration Middleware - Production-ready
 * Fix #22: Configure restrictive CORS for production
 */
import cors from 'cors';

// Production domains - add your actual domains here
const PRODUCTION_ORIGINS = [
    'https://iliagpt.com',
    'https://www.iliagpt.com',
    'https://app.iliagpt.com',
    'https://iliagpt.io',
    'https://www.iliagpt.io',
];

// Development origins (only in non-production)
const DEVELOPMENT_ORIGINS = [
    'http://localhost:5050',
    'http://localhost:5001',
    'http://localhost:3000',
    'http://127.0.0.1:5050',
];

const isProduction = process.env.NODE_ENV === 'production';

function dedupeAllowedOrigins(origins: string[]): string[] {
    return [...new Set((origins || []).filter(Boolean))];
}

export interface OriginValidationOptions {
    allowAnyLocalhost?: boolean;
}

export function getAllowedOrigins(options: OriginValidationOptions = {}): string[] | '*' {
    const allowAnyLocalhost = options.allowAnyLocalhost ?? !isProduction;
    const configuredOrigins = (process.env.ALLOWED_ORIGINS?.split(",").map(d => d.trim()).filter(Boolean) || []);
    const replitOrigins = (process.env.REPLIT_DOMAINS?.split(",") || [])
        .filter(isValidReplitDomain)
        .map(d => `https://${d.trim()}`);

    if (!isProduction) {
        if (allowAnyLocalhost) {
            return dedupeAllowedOrigins([
                ...DEVELOPMENT_ORIGINS,
                ...configuredOrigins,
                ...replitOrigins,
            ]);
        }

        return dedupeAllowedOrigins([
            ...configuredOrigins,
            ...replitOrigins,
            ...(PRODUCTION_ORIGINS || []),
        ]);
    }

    return dedupeAllowedOrigins([
        ...(configuredOrigins.length > 0 ? configuredOrigins : PRODUCTION_ORIGINS),
        ...replitOrigins,
    ]);
}

export function isAllowedOrigin(originHeader: string | undefined): boolean {
    if (!originHeader) return false;

    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins === '*') return true;
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(originHeader);

    return isLocalhost || allowedOrigins.includes(originHeader);
}

/** Security: validate Replit domain format to prevent injection */
function isValidReplitDomain(domain: string): boolean {
    if (!domain || typeof domain !== 'string') return false;
    const trimmed = domain.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9.\-]*\.(replit\.dev|repl\.co|replit\.app)$/.test(trimmed);
}

export const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = getAllowedOrigins();

        // Requests with no Origin header can happen for same-origin navigations or server-to-server calls.
        if (!origin) {
            callback(null, true);
            return;
        }

        // In development, allow localhost (any port) plus explicit allowlist entries.
        if (!isProduction) {
            const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
            const explicitlyAllowed = Array.isArray(allowedOrigins) && allowedOrigins.includes(origin);
            const localhostAllowed = localhostPattern.test(origin);

            if (explicitlyAllowed || localhostAllowed) {
                if (process.env.CORS_DEBUG === 'true') {
                    console.log(`[CORS] Dev mode - allowing origin: ${origin}`);
                }
                callback(null, true);
                return;
            }

            if (process.env.CORS_DEBUG === 'true') {
                console.warn(`[CORS] Dev mode - blocked origin: ${origin}`);
            }
            callback(new Error('Not allowed by CORS'));
            return;
        }

        // In production, check against whitelist
        if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Blocked request from origin: ${String(origin).substring(0, 200)}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-CSRFToken',
        'X-Upload-Id',
        'X-Conversation-Id',
        'X-Requested-With',
        'X-Request-ID',
        'X-Idempotency-Key',
        'X-CSRF-Token',
        'Accept',
        'Origin',
    ],
    exposedHeaders: [
        'X-Request-ID',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
    ],
    maxAge: 86400, // 24 hours - cache preflight requests
};

export const corsMiddleware = cors(corsOptions);

export default corsMiddleware;
