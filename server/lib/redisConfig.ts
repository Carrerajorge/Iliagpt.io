/**
 * Unified Redis Configuration
 * Centralizes all Redis connection settings for consistency across the application
 */

import Redis, { RedisOptions } from 'ioredis';
import { createLogger } from './productionLogger';

const logger = createLogger('Redis');

// Parse REDIS_URL or construct from individual env vars
function getRedisConfig(): RedisOptions {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    // Parse the URL and add our options
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || process.env.REDIS_PASSWORD || undefined,
      username: url.username || undefined,
      db: parseInt(url.pathname?.slice(1) || '0'),
      // Unified connection options
      maxRetriesPerRequest: null, // Required for BullMQ blocking operations
      retryStrategy: (times: number) => {
        if (times > 10) {
          logger.error('Redis connection failed after 10 retries');
          return null; // Stop retrying
        }
        const delay = Math.min(times * 200, 5000);
        logger.warn(`Redis reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
      },
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          // Reconnect on READONLY errors (common in Redis clusters during failover)
          return true;
        }
        return false;
      },
      enableReadyCheck: true,
      lazyConnect: false,
      connectTimeout: 10000,
      commandTimeout: 5000,
    };
  }

  // Fallback to individual env vars
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => {
      if (times > 10) return null;
      return Math.min(times * 200, 5000);
    },
    enableReadyCheck: true,
    lazyConnect: false,
  };
}

// Singleton connection instance
let sharedConnection: Redis | null = null;
let connectionPromise: Promise<Redis> | null = null;

/**
 * Get or create a shared Redis connection
 * Uses singleton pattern to reuse connections
 */
export async function getRedisConnection(): Promise<Redis | null> {
  const config = getRedisConfig();

  if (!config.host && !process.env.REDIS_URL) {
    logger.info('Redis not configured - running without Redis');
    return null;
  }

  if (sharedConnection && sharedConnection.status === 'ready') {
    return sharedConnection;
  }

  // Prevent multiple simultaneous connection attempts
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = new Promise((resolve, reject) => {
    try {
      const client = new Redis(config);

      client.on('connect', () => {
        logger.info('Redis connected');
      });

      client.on('ready', () => {
        logger.info('Redis ready');
        sharedConnection = client;
        resolve(client);
      });

      client.on('error', (err) => {
        logger.error('Redis error', { error: err.message });
      });

      client.on('close', () => {
        logger.warn('Redis connection closed');
        sharedConnection = null;
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!sharedConnection) {
          reject(new Error('Redis connection timeout'));
        }
      }, 10000);
    } catch (error) {
      logger.error('Failed to create Redis connection', { error });
      reject(error);
    }
  });

  try {
    return await connectionPromise;
  } catch (error) {
    connectionPromise = null;
    return null;
  }
}

/**
 * Get a synchronous connection (for BullMQ which needs sync connection)
 * Returns null if Redis is not configured
 */
export function getRedisConnectionSync(): Redis | null {
  const config = getRedisConfig();

  if (!config.host && !process.env.REDIS_URL) {
    return null;
  }

  const client = new Redis(config);

  client.on('error', (err) => {
    logger.error('Redis error', { error: err.message });
  });

  return client;
}

/**
 * Close the shared Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  if (sharedConnection) {
    await sharedConnection.quit();
    sharedConnection = null;
    connectionPromise = null;
    logger.info('Redis connection closed');
  }
}

/**
 * Check if Redis is available
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = await getRedisConnection();
    if (!client) return false;

    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Get Redis connection status
 */
export function getRedisStatus(): {
  configured: boolean;
  connected: boolean;
  status: string;
} {
  const configured = !!(process.env.REDIS_URL || process.env.REDIS_HOST);
  const connected = sharedConnection?.status === 'ready';

  return {
    configured,
    connected,
    status: sharedConnection?.status || 'disconnected',
  };
}

export default {
  getRedisConnection,
  getRedisConnectionSync,
  closeRedisConnection,
  isRedisAvailable,
  getRedisStatus,
};
