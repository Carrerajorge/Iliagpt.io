/**
 * RedisFallback — Transparent Redis wrapper with in-memory fallback and auto-reconnect.
 *
 * Features:
 *   - Same API as a basic Redis client (get/set/del/hset/hget/lpush/lrange/expire/ping)
 *   - Falls back to an in-memory Map when Redis is unavailable
 *   - Monitors Redis liveness on an interval; promotes back to Redis once healthy
 *   - Logs transitions between Redis and fallback mode
 *   - TTL support in fallback mode via per-key expiry tracking
 */

import { EventEmitter } from 'events';
import { Logger }       from '../lib/logger';

// ─── Fallback store ───────────────────────────────────────────────────────────

interface FallbackEntry {
  value  : string;
  expiresAt?: number;
}

class InMemoryStore {
  private readonly store  = new Map<string, FallbackEntry>();
  private readonly hstore = new Map<string, Map<string, string>>();
  private readonly lists  = new Map<string, string[]>();

  private _isExpired(entry: FallbackEntry): boolean {
    return entry.expiresAt != null && Date.now() > entry.expiresAt;
  }

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry || this._isExpired(entry)) { this.store.delete(key); return null; }
    return entry.value;
  }

  set(key: string, value: string, ttlSeconds?: number): void {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds != null ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }

  del(key: string): void {
    this.store.delete(key);
    this.hstore.delete(key);
    this.lists.delete(key);
  }

  expire(key: string, ttlSeconds: number): void {
    const entry = this.store.get(key);
    if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000;
  }

  hset(key: string, field: string, value: string): void {
    if (!this.hstore.has(key)) this.hstore.set(key, new Map());
    this.hstore.get(key)!.set(field, value);
  }

  hget(key: string, field: string): string | null {
    return this.hstore.get(key)?.get(field) ?? null;
  }

  lpush(key: string, ...values: string[]): void {
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key)!.unshift(...values);
  }

  lrange(key: string, start: number, stop: number): string[] {
    const list = this.lists.get(key) ?? [];
    return stop === -1 ? list.slice(start) : list.slice(start, stop + 1);
  }
}

// ─── Main class ───────────────────────────────────────────────────────────────

export type RedisMode = 'redis' | 'fallback';

export class RedisFallbackClient extends EventEmitter {
  private redisClient  : unknown = null;
  private mode         : RedisMode = 'fallback';
  private reconnecting = false;
  private readonly fallback = new InMemoryStore();
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly reconnectIntervalMs = 30_000) {
    super();
  }

  // ── Initialise (tries Redis, falls back silently) ────────────────────────────

  async init(): Promise<void> {
    await this._tryConnect();
    this.reconnectTimer = setInterval(() => this._tryReconnect(), this.reconnectIntervalMs);
  }

  destroy(): void {
    if (this.reconnectTimer) { clearInterval(this.reconnectTimer); this.reconnectTimer = null; }
  }

  getMode(): RedisMode { return this.mode; }

  // ── Public API (delegates to Redis or fallback) ──────────────────────────────

  async ping(): Promise<'PONG'> {
    if (this.mode === 'redis') {
      try { return await (this.redisClient as { ping(): Promise<'PONG'> }).ping(); } catch { this._onDisconnect(); }
    }
    return 'PONG';
  }

  async get(key: string): Promise<string | null> {
    if (this.mode === 'redis') {
      try { return await (this.redisClient as { get(k: string): Promise<string | null> }).get(key); } catch { this._onDisconnect(); }
    }
    return this.fallback.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.mode === 'redis') {
      try {
        const r = this.redisClient as { set(k: string, v: string, o?: { EX?: number }): Promise<unknown> };
        await r.set(key, value, ttlSeconds != null ? { EX: ttlSeconds } : undefined);
        return;
      } catch { this._onDisconnect(); }
    }
    this.fallback.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    if (this.mode === 'redis') {
      try { await (this.redisClient as { del(k: string): Promise<unknown> }).del(key); return; } catch { this._onDisconnect(); }
    }
    this.fallback.del(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (this.mode === 'redis') {
      try { await (this.redisClient as { expire(k: string, t: number): Promise<unknown> }).expire(key, ttlSeconds); return; } catch { this._onDisconnect(); }
    }
    this.fallback.expire(key, ttlSeconds);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    if (this.mode === 'redis') {
      try { await (this.redisClient as { hSet(k: string, f: string, v: string): Promise<unknown> }).hSet(key, field, value); return; } catch { this._onDisconnect(); }
    }
    this.fallback.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    if (this.mode === 'redis') {
      try { return await (this.redisClient as { hGet(k: string, f: string): Promise<string | null> }).hGet(key, field); } catch { this._onDisconnect(); }
    }
    return this.fallback.hget(key, field);
  }

  async lpush(key: string, ...values: string[]): Promise<void> {
    if (this.mode === 'redis') {
      try { await (this.redisClient as { lPush(k: string, v: string[]): Promise<unknown> }).lPush(key, values); return; } catch { this._onDisconnect(); }
    }
    this.fallback.lpush(key, ...values);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (this.mode === 'redis') {
      try { return await (this.redisClient as { lRange(k: string, s: number, e: number): Promise<string[]> }).lRange(key, start, stop); } catch { this._onDisconnect(); }
    }
    return this.fallback.lrange(key, start, stop);
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async _tryConnect(): Promise<void> {
    try {
      const { createClient } = await import('redis');
      const client = createClient({ url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' });
      await client.connect();
      await client.ping();
      this.redisClient = client;
      this.mode        = 'redis';
      Logger.info('[RedisFallback] connected to Redis');
      this.emit('connected');
    } catch {
      this.mode = 'fallback';
      Logger.warn('[RedisFallback] Redis unavailable — using in-memory fallback');
      this.emit('fallback');
    }
  }

  private _onDisconnect(): void {
    if (this.mode === 'redis') {
      this.mode = 'fallback';
      Logger.warn('[RedisFallback] Redis connection lost — switching to in-memory fallback');
      this.emit('fallback');
    }
  }

  private async _tryReconnect(): Promise<void> {
    if (this.mode === 'redis' || this.reconnecting) return;
    this.reconnecting = true;
    try {
      await this._tryConnect();
    } finally {
      this.reconnecting = false;
    }
  }
}

export const redisFallback = new RedisFallbackClient();
