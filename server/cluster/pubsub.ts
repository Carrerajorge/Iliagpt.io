/**
 * Redis PubSub system for multi-instance SSE coordination.
 *
 * Provides channel-based publish/subscribe, distributed locks (Redlock pattern),
 * and presence tracking. Falls back to in-memory EventEmitter when Redis is
 * unavailable (common in local development).
 */

import Redis from 'ioredis';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createLogger } from '../lib/productionLogger';
import { SCALABILITY } from '../config/scalability';

const logger = createLogger('PubSub');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChannelType = `chat:${string}` | `user:${string}` | 'system';

export type EventType =
  | 'message_new'
  | 'message_update'
  | 'typing_start'
  | 'typing_stop'
  | 'presence_update'
  | 'agent_progress';

export interface PubSubEvent {
  type: EventType;
  payload: unknown;
  /** ISO-8601 timestamp set automatically on publish */
  timestamp?: string;
  /** Unique event id set automatically on publish */
  id?: string;
  /** Originating instance id so receivers can ignore self-published events */
  sourceInstanceId?: string;
}

export interface Lock {
  key: string;
  token: string;
  expiresAt: number;
}

export type PresenceStatus = 'online' | 'away' | 'offline';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INSTANCE_ID = randomUUID();
const PRESENCE_KEY_PREFIX = 'presence:';
const PRESENCE_TTL_SECONDS = 120; // auto-expire after 2 min without refresh
const LOCK_KEY_PREFIX = 'lock:';

/** Lua script: compare-and-delete for safe lock release */
const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

function buildRedisClient(label: string): Redis | null {
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev && !process.env.REDIS_URL) {
    return null;
  }

  const redisUrl = process.env.REDIS_URL;
  const MAX_RETRIES = 5;

  const retryStrategy = (times: number) => {
    if (times > MAX_RETRIES) return null;
    return Math.min(times * 500, 3000);
  };

  const opts = {
    maxRetriesPerRequest: SCALABILITY.redis.maxRetriesPerRequest,
    lazyConnect: true,
    enableReadyCheck: true,
    retryStrategy,
    connectTimeout: SCALABILITY.redis.connectTimeout,
    commandTimeout: SCALABILITY.redis.commandTimeout,
    keepAlive: SCALABILITY.redis.keepAlive,
    enableOfflineQueue: SCALABILITY.redis.enableOfflineQueue,
  };

  const client = redisUrl ? new Redis(redisUrl, opts) : new Redis({ ...opts });

  let errorLoggedOnce = false;
  client.on('error', (err) => {
    if (!errorLoggedOnce) {
      logger.error(`Redis [${label}] unavailable`, { error: err?.message });
      errorLoggedOnce = true;
    }
  });

  return client;
}

// ---------------------------------------------------------------------------
// PubSubManager
// ---------------------------------------------------------------------------

export class PubSubManager {
  private pubClient: Redis | null;
  private subClient: Redis | null;
  private cmdClient: Redis | null;
  private emitter = new EventEmitter();
  private redisAvailable = false;
  private subscribedChannels = new Set<string>();

  constructor() {
    this.pubClient = buildRedisClient('pub');
    this.subClient = buildRedisClient('sub');
    this.cmdClient = buildRedisClient('cmd');
    this.emitter.setMaxListeners(200);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (!this.pubClient || !this.subClient || !this.cmdClient) {
      logger.info('Redis not available — PubSub running in local-only mode');
      return;
    }

    try {
      await Promise.all([
        this.pubClient.connect(),
        this.subClient.connect(),
        this.cmdClient.connect(),
      ]);
      this.redisAvailable = true;

      // Forward Redis subscription messages to the local EventEmitter so
      // handler management stays uniform regardless of backend.
      this.subClient.on('message', (channel: string, message: string) => {
        try {
          const event: PubSubEvent = JSON.parse(message);
          this.emitter.emit(channel, event);
        } catch (err) {
          logger.error('Failed to parse PubSub message', { channel, error: String(err) });
        }
      });

      logger.info('PubSub initialized with Redis');
    } catch (err) {
      logger.error('PubSub Redis init failed — falling back to local mode', { error: String(err) });
      this.redisAvailable = false;
    }
  }

  async close(): Promise<void> {
    const clients = [this.pubClient, this.subClient, this.cmdClient];
    await Promise.allSettled(
      clients.filter(Boolean).map((c) => c!.quit().catch(() => {})),
    );
    this.emitter.removeAllListeners();
    this.subscribedChannels.clear();
    logger.info('PubSub closed');
  }

  // -----------------------------------------------------------------------
  // Publish / Subscribe
  // -----------------------------------------------------------------------

  async publish(channel: string, event: PubSubEvent): Promise<void> {
    const enriched: PubSubEvent = {
      ...event,
      id: event.id ?? randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      sourceInstanceId: INSTANCE_ID,
    };

    if (this.redisAvailable && this.pubClient) {
      try {
        await this.pubClient.publish(channel, JSON.stringify(enriched));
        return;
      } catch (err) {
        logger.error('Redis publish failed, falling back to local', { error: String(err) });
      }
    }

    // Local-only fallback
    this.emitter.emit(channel, enriched);
  }

  /**
   * Subscribe to a channel. Returns an unsubscribe function.
   */
  subscribe(channel: string, handler: (event: PubSubEvent) => void): () => void {
    this.emitter.on(channel, handler);

    if (this.redisAvailable && this.subClient && !this.subscribedChannels.has(channel)) {
      this.subscribedChannels.add(channel);
      this.subClient.subscribe(channel).catch((err) => {
        logger.error('Redis subscribe failed', { channel, error: String(err) });
      });
    }

    return () => {
      this.emitter.off(channel, handler);

      // If no more listeners for this channel, unsubscribe from Redis too
      if (this.emitter.listenerCount(channel) === 0 && this.subscribedChannels.has(channel)) {
        this.subscribedChannels.delete(channel);
        if (this.redisAvailable && this.subClient) {
          this.subClient.unsubscribe(channel).catch(() => {});
        }
      }
    };
  }

  // -----------------------------------------------------------------------
  // Convenience publishers
  // -----------------------------------------------------------------------

  async publishToUser(userId: string, event: PubSubEvent): Promise<void> {
    await this.publish(`user:${userId}`, event);
  }

  async publishToChat(chatId: string, event: PubSubEvent): Promise<void> {
    await this.publish(`chat:${chatId}`, event);
  }

  // -----------------------------------------------------------------------
  // Distributed Lock (Redlock-lite, single-instance)
  // -----------------------------------------------------------------------

  /**
   * Attempt to acquire a distributed lock. Returns the Lock on success, or
   * null if the lock is already held. Uses a single SET NX PX command.
   */
  async acquireLock(key: string, ttlMs: number): Promise<Lock | null> {
    const token = randomUUID();
    const lockKey = `${LOCK_KEY_PREFIX}${key}`;

    if (this.redisAvailable && this.cmdClient) {
      try {
        const result = await this.cmdClient.set(lockKey, token, 'PX', ttlMs, 'NX');
        if (result === 'OK') {
          return { key: lockKey, token, expiresAt: Date.now() + ttlMs };
        }
        return null; // already held
      } catch (err) {
        logger.error('acquireLock Redis error', { key, error: String(err) });
        // Fall through to in-memory lock
      }
    }

    // In-memory fallback: use a simple map on the emitter (good enough for single instance)
    const memLocks = ((this.emitter as any).__locks ??= new Map<string, { token: string; expiresAt: number }>());
    const existing = memLocks.get(lockKey);
    if (existing && existing.expiresAt > Date.now()) {
      return null;
    }
    const lock: Lock = { key: lockKey, token, expiresAt: Date.now() + ttlMs };
    memLocks.set(lockKey, lock);
    return lock;
  }

  /**
   * Release a previously acquired lock. Uses a Lua script to ensure only the
   * holder can release it (compare-and-delete).
   */
  async releaseLock(lock: Lock): Promise<void> {
    if (this.redisAvailable && this.cmdClient) {
      try {
        // ioredis .call() executes a Redis command; here we use EVALSHA-style
        // Lua execution for atomic compare-and-delete.
        await this.cmdClient.call(
          'EVAL', RELEASE_LOCK_SCRIPT, '1', lock.key, lock.token,
        );
        return;
      } catch (err) {
        logger.error('releaseLock Redis error', { key: lock.key, error: String(err) });
      }
    }

    // In-memory fallback
    const memLocks: Map<string, Lock> | undefined = (this.emitter as any).__locks;
    if (memLocks) {
      const existing = memLocks.get(lock.key);
      if (existing && existing.token === lock.token) {
        memLocks.delete(lock.key);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Presence Tracking
  // -----------------------------------------------------------------------

  async setPresence(userId: string, status: PresenceStatus): Promise<void> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;

    if (this.redisAvailable && this.cmdClient) {
      try {
        if (status === 'offline') {
          await this.cmdClient.del(key);
        } else {
          await this.cmdClient.set(key, status, 'EX', PRESENCE_TTL_SECONDS);
        }
      } catch (err) {
        logger.error('setPresence error', { userId, error: String(err) });
      }
    }

    // Also broadcast so other instances / local listeners are notified
    await this.publishToUser(userId, {
      type: 'presence_update',
      payload: { userId, status },
    });
  }

  async getPresence(userId: string): Promise<PresenceStatus> {
    const key = `${PRESENCE_KEY_PREFIX}${userId}`;

    if (this.redisAvailable && this.cmdClient) {
      try {
        const val = await this.cmdClient.get(key);
        if (val === 'online' || val === 'away') return val;
      } catch (err) {
        logger.error('getPresence error', { userId, error: String(err) });
      }
    }

    return 'offline';
  }

  async getOnlineUsers(userIds: string[]): Promise<Map<string, PresenceStatus>> {
    const result = new Map<string, PresenceStatus>();

    if (userIds.length === 0) return result;

    if (this.redisAvailable && this.cmdClient) {
      try {
        const keys = userIds.map((id) => `${PRESENCE_KEY_PREFIX}${id}`);
        const values = await this.cmdClient.mget(...keys);
        for (let i = 0; i < userIds.length; i++) {
          const v = values[i];
          result.set(userIds[i], (v === 'online' || v === 'away') ? v : 'offline');
        }
        return result;
      } catch (err) {
        logger.error('getOnlineUsers error', { error: String(err) });
      }
    }

    // Fallback: everyone offline
    for (const id of userIds) {
      result.set(id, 'offline');
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Introspection
  // -----------------------------------------------------------------------

  get instanceId(): string {
    return INSTANCE_ID;
  }

  get isRedisConnected(): boolean {
    return this.redisAvailable;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const pubsub = new PubSubManager();
