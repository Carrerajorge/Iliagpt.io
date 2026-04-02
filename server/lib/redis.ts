/**
 * Shared Redis client
 *
 * Several subsystems (metrics/audit, memory, rate limiting, etc.) want a direct
 * Redis handle. Historically this codebase created multiple Redis clients in
 * different modules; this file provides a single import path (`server/lib/redis`)
 * so new modules can depend on it without breaking the build.
 *
 * Notes:
 * - Uses ioredis because other parts of the server already depend on it.
 * - Uses lazy connections to avoid blocking startup during builds/tests.
 */

import Redis from 'ioredis';
import { createLogger } from './productionLogger';

const logger = createLogger('RedisSingleton');

function buildRedisClient(): Redis {
  const isDev = process.env.NODE_ENV !== "production";
  const redisUrl = isDev ? undefined : process.env.REDIS_URL;
  const host = isDev ? undefined : process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined;
  if (isDev) {
    logger.info('Redis disabled in development to avoid Upstash quota issues');
  }

  // Cap reconnection attempts so we don't spam logs when Redis is unavailable.
  const MAX_RETRIES = 5;
  const retryStrategy = (times: number) => {
    if (times > MAX_RETRIES) {
      // Returning null tells ioredis to stop retrying.
      return null;
    }
    return Math.min(times * 500, 3000);
  };

  const sharedOpts = {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    enableReadyCheck: true,
    retryStrategy,
    connectTimeout: 5000,
    commandTimeout: 3000,
    keepAlive: 30000,
    enableOfflineQueue: true,
  };

  const client = redisUrl
    ? new Redis(redisUrl, sharedOpts)
    : new Redis({
      host: host || '127.0.0.1',
      port: port || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      ...sharedOpts,
    });

  let errorLoggedOnce = false;
  client.on('error', (err) => {
    if (!errorLoggedOnce) {
      logger.error('Redis unavailable — will degrade gracefully', { error: err?.message || String(err) });
      errorLoggedOnce = true;
    }
  });

  return client;
}

export const redis = buildRedisClient();

