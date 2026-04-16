/**
 * Query Optimization & Response Compression (#68, #69)
 * Database query helpers and HTTP compression middleware
 */

import { Request, Response, NextFunction } from 'express';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const deflate = promisify(zlib.deflate);
const brotliCompress = promisify(zlib.brotliCompress);

// ============================================
// QUERY OPTIMIZATION (#68)
// ============================================

/**
 * Pagination helper with cursor-based support
 */
export interface PaginationOptions {
    limit?: number;
    offset?: number;
    cursor?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
    data: T[];
    pagination: {
        total?: number;
        limit: number;
        offset: number;
        hasMore: boolean;
        nextCursor?: string;
    };
}

/**
 * Build pagination SQL clauses
 */
export function buildPaginationClause(options: PaginationOptions): {
    limit: number;
    offset: number;
    orderBy: string;
} {
    const limit = Math.min(options.limit || 20, 100); // Max 100
    const offset = options.offset || 0;
    const sortBy = options.sortBy || 'created_at';
    const sortOrder = options.sortOrder || 'desc';

    return {
        limit,
        offset,
        orderBy: `${sortBy} ${sortOrder.toUpperCase()}`,
    };
}

/**
 * Execute query with automatic batching to prevent N+1
 */
export async function batchQuery<T, K>(
    keys: K[],
    batchFn: (keys: K[]) => Promise<Map<K, T>>,
    options: { maxBatchSize?: number } = {}
): Promise<Map<K, T>> {
    const { maxBatchSize = 100 } = options;
    const results = new Map<K, T>();

    // Split into batches
    for (let i = 0; i < keys.length; i += maxBatchSize) {
        const batch = keys.slice(i, i + maxBatchSize);
        const batchResults = await batchFn(batch);

        for (const [key, value] of batchResults) {
            results.set(key, value);
        }
    }

    return results;
}

/**
 * DataLoader-style batching and caching
 */
export class DataLoader<K, V> {
    private cache = new Map<string, V>();
    private batch: K[] = [];
    private batchPromise: Promise<void> | null = null;
    private batchResults = new Map<string, V>();

    constructor(
        private batchFn: (keys: K[]) => Promise<Map<K, V>>,
        private keyFn: (key: K) => string = String
    ) { }

    async load(key: K): Promise<V | undefined> {
        const cacheKey = this.keyFn(key);

        // Check cache
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        // Add to batch
        this.batch.push(key);

        // Schedule batch execution
        if (!this.batchPromise) {
            this.batchPromise = new Promise(resolve => {
                setImmediate(async () => {
                    const keys = [...this.batch];
                    this.batch = [];
                    this.batchPromise = null;

                    const results = await this.batchFn(keys);
                    for (const [k, v] of results) {
                        const ck = this.keyFn(k);
                        this.cache.set(ck, v);
                        this.batchResults.set(ck, v);
                    }

                    resolve();
                });
            });
        }

        await this.batchPromise;
        return this.batchResults.get(cacheKey);
    }

    loadMany(keys: K[]): Promise<(V | undefined)[]> {
        return Promise.all(keys.map(k => this.load(k)));
    }

    clear(): void {
        this.cache.clear();
    }

    prime(key: K, value: V): void {
        this.cache.set(this.keyFn(key), value);
    }
}

/**
 * Query result caching with TTL
 */
const queryCache = new Map<string, { data: any; expires: number }>();

export async function cachedQuery<T>(
    cacheKey: string,
    queryFn: () => Promise<T>,
    ttlSeconds: number = 60
): Promise<T> {
    const cached = queryCache.get(cacheKey);

    if (cached && cached.expires > Date.now()) {
        return cached.data;
    }

    const result = await queryFn();

    queryCache.set(cacheKey, {
        data: result,
        expires: Date.now() + ttlSeconds * 1000,
    });

    return result;
}

export function invalidateQueryCache(pattern: string | RegExp): number {
    let invalidated = 0;

    for (const key of queryCache.keys()) {
        if (typeof pattern === 'string' ? key.includes(pattern) : pattern.test(key)) {
            queryCache.delete(key);
            invalidated++;
        }
    }

    return invalidated;
}

// ============================================
// RESPONSE COMPRESSION (#69)
// ============================================

interface CompressionOptions {
    threshold?: number;      // Minimum size to compress (bytes)
    level?: number;          // Compression level (1-9)
    memLevel?: number;       // Memory usage for compression
    preferBrotli?: boolean;  // Prefer Brotli over gzip
}

const DEFAULT_COMPRESSION: Required<CompressionOptions> = {
    threshold: 1024,         // 1KB
    level: 6,
    memLevel: 8,
    preferBrotli: true,
};

/**
 * Compression middleware
 */
export function compressionMiddleware(options: CompressionOptions = {}) {
    const opts = { ...DEFAULT_COMPRESSION, ...options };

    return async (req: Request, res: Response, next: NextFunction) => {
        // Store original send
        const originalSend = res.send.bind(res);

        res.send = function (body: any): Response {
            // Skip if already compressed or streaming
            if (res.headersSent || res.getHeader('Content-Encoding')) {
                return originalSend(body);
            }

            // Get body as buffer
            let data: Buffer;
            if (Buffer.isBuffer(body)) {
                data = body;
            } else if (typeof body === 'string') {
                data = Buffer.from(body);
            } else if (typeof body === 'object') {
                data = Buffer.from(JSON.stringify(body));
                if (!res.getHeader('Content-Type')) {
                    res.setHeader('Content-Type', 'application/json');
                }
            } else {
                return originalSend(body);
            }

            // Skip if below threshold
            if (data.length < opts.threshold) {
                return originalSend(data);
            }

            // Get accepted encodings
            const acceptEncoding = req.headers['accept-encoding'] || '';

            // Determine best encoding
            let encoding: string | null = null;
            let compressedData: Buffer | null = null;

            (async () => {
                try {
                    if (opts.preferBrotli && acceptEncoding.includes('br')) {
                        encoding = 'br';
                        compressedData = await brotliCompress(data, {
                            params: {
                                [zlib.constants.BROTLI_PARAM_QUALITY]: opts.level,
                            },
                        });
                    } else if (acceptEncoding.includes('gzip')) {
                        encoding = 'gzip';
                        compressedData = await gzip(data, { level: opts.level });
                    } else if (acceptEncoding.includes('deflate')) {
                        encoding = 'deflate';
                        compressedData = await deflate(data, { level: opts.level });
                    }

                    if (compressedData && compressedData.length < data.length) {
                        res.setHeader('Content-Encoding', encoding!);
                        res.setHeader('Content-Length', compressedData.length);
                        res.setHeader('Vary', 'Accept-Encoding');
                        originalSend(compressedData);
                    } else {
                        originalSend(data);
                    }
                } catch (error) {
                    // Fallback to uncompressed on error
                    originalSend(data);
                }
            })();

            return res;
        };

        next();
    };
}

/**
 * Utility to compress a specific response
 */
export async function compressResponse(
    data: string | Buffer,
    acceptEncoding: string,
    options: CompressionOptions = {}
): Promise<{ data: Buffer; encoding: string | null }> {
    const opts = { ...DEFAULT_COMPRESSION, ...options };
    const input = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (input.length < opts.threshold) {
        return { data: input, encoding: null };
    }

    try {
        if (opts.preferBrotli && acceptEncoding.includes('br')) {
            return {
                data: await brotliCompress(input, {
                    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: opts.level },
                }),
                encoding: 'br',
            };
        } else if (acceptEncoding.includes('gzip')) {
            return {
                data: await gzip(input, { level: opts.level }),
                encoding: 'gzip',
            };
        }
    } catch {
        // Fall through to uncompressed
    }

    return { data: input, encoding: null };
}
