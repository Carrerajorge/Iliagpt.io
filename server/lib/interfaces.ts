/**
 * Storage Service Abstraction
 * Supports S3 (Production) and Filesystem (Dev/Fallback)
 */

export interface IStorageService {
    upload(key: string, data: Buffer | string, contentType?: string): Promise<string>;
    download(key: string): Promise<Buffer>;
    delete(key: string): Promise<void>;
    getPublicUrl(key: string): string;
}

/**
 * Cache Service Abstraction
 * Replaces in-memory Maps with Redis
 */

export interface ICacheService {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    del(key: string): Promise<void>;
}
