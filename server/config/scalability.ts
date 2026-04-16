const isProd = process.env.NODE_ENV === 'production';

export const SCALABILITY = {
  db: {
    writePool: {
      max: parseInt(process.env.DB_POOL_MAX || (isProd ? '100' : '5')),
      min: parseInt(process.env.DB_POOL_MIN || (isProd ? '10' : '0')),
      idleTimeoutMs: isProd ? 10_000 : 3_000,
      connectTimeoutMs: isProd ? 5_000 : 3_000,
      statementTimeoutMs: 15_000,
    },
    readPool: {
      max: parseInt(process.env.DB_READ_POOL_MAX || (isProd ? '150' : '5')),
      min: parseInt(process.env.DB_READ_POOL_MIN || (isProd ? '20' : '2')),
      idleTimeoutMs: isProd ? 15_000 : 10_000,
      connectTimeoutMs: 5_000,
      statementTimeoutMs: 30_000,
    },
  },

  redis: {
    maxRetriesPerRequest: null as null,
    connectTimeout: 5_000,
    commandTimeout: 3_000,
    keepAlive: 30_000,
    enableOfflineQueue: true,
    lazyConnect: true,
  },

  rateLimits: {
    global: { points: 600, duration: 60 },
    auth: { points: 15, duration: 900, blockDuration: 300 },
    ai: { points: 120, duration: 60 },
    streaming: { points: 30, duration: 60 },
  },

  cache: {
    responseTtlMs: isProd ? 120_000 : 60_000,
    maxCacheableSize: 10 * 1024 * 1024,
    staleWhileRevalidateMs: isProd ? 60_000 : 30_000,
    settingsCacheTtlMs: isProd ? 300_000 : 60_000,
    modelsCacheTtlMs: isProd ? 300_000 : 120_000,
  },

  sse: {
    heartbeatIntervalMs: isProd ? 25_000 : 30_000,
    maxConnectionsPerUser: 5,
    sessionTtlSeconds: isProd ? 3_600 : 1_800,
  },

  http: {
    keepAliveTimeoutMs: isProd ? 65_000 : 605_000,
    headersTimeoutMs: isProd ? 66_000 : 60_000,
    requestTimeoutMs: isProd ? 300_000 : 600_000,
    bodyLimit: '50mb',
  },

  compression: {
    level: isProd ? 6 : 1,
    threshold: 512,
    memLevel: 8,
  },

  clustering: {
    enabled: isProd && !!process.env.CLUSTER_MODE,
    workers: parseInt(process.env.CLUSTER_WORKERS || '0') || (isProd ? 4 : 1),
  },
} as const;

export function getScalabilityReport() {
  return {
    environment: isProd ? 'production' : 'development',
    db: {
      writePoolMax: SCALABILITY.db.writePool.max,
      readPoolMax: SCALABILITY.db.readPool.max,
    },
    rateLimits: SCALABILITY.rateLimits,
    cache: {
      responseTtlMs: SCALABILITY.cache.responseTtlMs,
      maxCacheableSize: `${(SCALABILITY.cache.maxCacheableSize / 1024 / 1024).toFixed(1)}MB`,
    },
    http: {
      keepAliveTimeoutMs: SCALABILITY.http.keepAliveTimeoutMs,
      bodyLimit: SCALABILITY.http.bodyLimit,
    },
    clustering: SCALABILITY.clustering,
  };
}
