import { createHash } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { log } from '../index';

type CachedResponseType = 'json' | 'text' | 'empty';

interface IdempotencyEntry {
    status: 'processing' | 'completed';
    requestFingerprint: string;
    response?: unknown;
    responseType?: CachedResponseType;
    statusCode?: number;
    createdAt: number;
}

type RequestWithUser = Request & {
    user?: {
        id?: string;
    };
};

// In-memory fallback (replace with Redis for multi-node deployments).
const idempotencyStore = new Map<string, IdempotencyEntry>();
const EXPIRY_MS = 24 * 60 * 60 * 1000;
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 5000;
const MAX_KEY_LENGTH = 128;
const MIN_KEY_LENGTH = 8;
const MAX_IDEMPOTENCY_RESPONSE_BYTES = 50 * 1024;
const KEY_PREFIX_MAX = 192;
const MAX_SERIALIZE_DEPTH = 6;
const MAX_SERIALIZE_ARRAY_LENGTH = 200;
const MAX_SERIALIZE_OBJECT_KEYS = 200;
const MAX_SERIALIZE_STRING_LENGTH = 10_000;
const MAX_FINGERPRINT_SOURCE_BYTES = 256 * 1024;
const RETRY_AFTER_SECONDS = 2;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function purgeExpiredEntries(): void {
    const now = Date.now();
    for (const [key, value] of idempotencyStore.entries()) {
        const ttl = value.status === 'processing' ? PROCESSING_TIMEOUT_MS : EXPIRY_MS;
        if (now - value.createdAt > ttl) {
            idempotencyStore.delete(key);
        }
    }

    if (idempotencyStore.size <= MAX_ENTRIES) return;

    const overflow = idempotencyStore.size - MAX_ENTRIES;
    if (overflow <= 0) return;

    const staleKeys = Array.from(idempotencyStore.keys()).slice(0, overflow);
    for (const staleKey of staleKeys) {
        idempotencyStore.delete(staleKey);
    }
}

setInterval(purgeExpiredEntries, 60 * 1000).unref();

function stableSerialize(
    value: unknown,
    depth = 0,
    seen: WeakSet<object> = new WeakSet<object>()
): unknown {
    if (value === null || value === undefined) return value;
    if (depth > MAX_SERIALIZE_DEPTH) return '[depth-truncated]';
    if (typeof value === 'string') return value.slice(0, MAX_SERIALIZE_STRING_LENGTH);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function' || typeof value === 'symbol') return String(value);
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return value.toString('base64');

    if (Array.isArray(value)) {
        return value
            .slice(0, MAX_SERIALIZE_ARRAY_LENGTH)
            .map((item) => stableSerialize(item, depth + 1, seen));
    }

    if (typeof value === 'object') {
        const objectValue = value as Record<string, unknown>;
        if (seen.has(objectValue)) return '[circular]';
        seen.add(objectValue);

        const output: Record<string, unknown> = {};
        const keys = Object.keys(objectValue)
            .sort((a, b) => a.localeCompare(b))
            .slice(0, MAX_SERIALIZE_OBJECT_KEYS);
        for (const key of keys) {
            output[key] = stableSerialize(objectValue[key], depth + 1, seen);
        }
        return output;
    }

    return String(value);
}

function buildRequestFingerprint(req: Request): string {
    const canonicalPayload = {
        method: req.method.toUpperCase(),
        url: req.originalUrl || req.url,
        params: stableSerialize(req.params),
        query: stableSerialize(req.query),
        body: stableSerialize(req.body),
    };

    let serialized = JSON.stringify(canonicalPayload);
    if (serialized.length > MAX_FINGERPRINT_SOURCE_BYTES) {
        serialized = serialized.slice(0, MAX_FINGERPRINT_SOURCE_BYTES);
    }
    return createHash('sha256').update(serialized).digest('hex');
}

function resolveIdempotencyKey(req: Request): string | undefined {
    const header = req.headers['idempotency-key'];
    if (Array.isArray(header)) return header[0];
    return typeof header === 'string' ? header : undefined;
}

function canCacheBody(body: unknown): boolean {
    try {
        if (typeof body === 'string') {
            return Buffer.byteLength(body, 'utf8') <= MAX_IDEMPOTENCY_RESPONSE_BYTES;
        }
        if (Buffer.isBuffer(body)) {
            return body.length <= MAX_IDEMPOTENCY_RESPONSE_BYTES;
        }
        if (typeof body === 'undefined' || body === null) return true;
        return Buffer.byteLength(JSON.stringify(body), 'utf8') <= MAX_IDEMPOTENCY_RESPONSE_BYTES;
    } catch {
        return false;
    }
}

export const idempotency = (req: Request, res: Response, next: NextFunction) => {
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
        return next();
    }

    const key = resolveIdempotencyKey(req);
    if (!key) {
        return next();
    }

    if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
        return res.status(400).json({
            status: 'error',
            code: 'INVALID_KEY',
            message: 'Invalid Idempotency-Key',
        });
    }

    purgeExpiredEntries();

    const userScope = (req as RequestWithUser).user?.id || req.ip || 'anonymous';
    const scope = String(userScope).slice(0, 64);
    const scopedKey = `${scope}:${key}`.slice(0, KEY_PREFIX_MAX + MAX_KEY_LENGTH);
    const requestFingerprint = buildRequestFingerprint(req);
    const cached = idempotencyStore.get(scopedKey);

    if (cached) {
        if (cached.requestFingerprint !== requestFingerprint) {
            return res.status(422).json({
                status: 'error',
                code: 'KEY_REUSED_WITH_DIFFERENT_REQUEST',
                message: 'Idempotency-Key was already used with a different request payload.',
            });
        }

        if (cached.status === 'processing') {
            const isStale = Date.now() - cached.createdAt > PROCESSING_TIMEOUT_MS;
            if (!isStale) {
                res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
                return res.status(409).json({
                    status: 'error',
                    code: 'CONFLICT',
                    message: 'Request with this Idempotency-Key is currently processing.',
                });
            }
            idempotencyStore.delete(scopedKey);
        } else {
            res.setHeader('Idempotency-Replayed', 'true');
            log(`[Idempotency Hit] scope=${scope} key_suffix=${key.slice(-6)}`, 'api');
            const statusCode = cached.statusCode ?? 200;

            if (cached.responseType === 'text') {
                return res.status(statusCode).send(cached.response as string | Buffer);
            }
            if (cached.responseType === 'empty' || typeof cached.response === 'undefined') {
                return res.status(statusCode).end();
            }
            return res.status(statusCode).json(cached.response);
        }
    }

    idempotencyStore.set(scopedKey, {
        status: 'processing',
        requestFingerprint,
        createdAt: Date.now(),
    });

    let capturedBody: unknown;
    let capturedType: CachedResponseType = 'empty';
    let bodyCaptureEnabled = true;
    let bodyExceededCacheLimit = false;

    const captureBody = (body: unknown, responseType: CachedResponseType): void => {
        if (!bodyCaptureEnabled) return;
        if (!canCacheBody(body)) {
            bodyCaptureEnabled = false;
            bodyExceededCacheLimit = true;
            return;
        }
        capturedBody = body;
        capturedType = responseType;
    };

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = ((body: unknown) => {
        captureBody(body, 'json');
        return originalJson(body);
    }) as Response['json'];

    res.send = ((body?: unknown) => {
        const responseType: CachedResponseType =
            typeof body === 'string' || Buffer.isBuffer(body) ? 'text' : 'json';
        captureBody(body, responseType);
        return originalSend(body as Parameters<Response['send']>[0]);
    }) as Response['send'];

    res.on('finish', () => {
        if (res.statusCode >= 500) {
            idempotencyStore.delete(scopedKey);
            return;
        }
        if (bodyExceededCacheLimit) {
            // Avoid replaying a truncated/empty response when payload exceeded cache budget.
            idempotencyStore.delete(scopedKey);
            return;
        }

        idempotencyStore.set(scopedKey, {
            status: 'completed',
            requestFingerprint,
            response: bodyCaptureEnabled ? capturedBody : undefined,
            responseType: bodyCaptureEnabled ? capturedType : 'empty',
            statusCode: res.statusCode,
            createdAt: Date.now(),
        });
    });

    return next();
};
