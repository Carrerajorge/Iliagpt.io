let Queue: any, Worker: any, QueueEvents: any;
try { const bullmq = require('bullmq'); Queue = bullmq.Queue; Worker = bullmq.Worker; QueueEvents = bullmq.QueueEvents; } catch {}
import IORedis, { RedisOptions } from 'ioredis';

const LOOPBACK_BASE_URL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLoopbackBaseUrl(baseUrl?: string): boolean {
    if (!baseUrl?.trim()) return false;
    try {
        const parsed = new URL(baseUrl);
        return LOOPBACK_BASE_URL_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
}

function isUpstashRedisUrl(redisUrl?: string): boolean {
    if (!redisUrl?.trim()) return false;
    try {
        return /upstash/i.test(new URL(redisUrl).hostname);
    } catch {
        return /upstash/i.test(redisUrl);
    }
}

export function shouldEnableRedisQueues(params: {
    nodeEnv?: string;
    redisUrl?: string;
    redisHost?: string;
    baseUrl?: string;
    bullmqDisable?: string;
    bullmqForceEnable?: string;
}): boolean {
    if (params.bullmqForceEnable === "true") {
        return true;
    }
    if (params.bullmqDisable === "true") {
        return false;
    }
    if (!params.redisUrl && !params.redisHost) {
        return false;
    }
    if (
        params.nodeEnv === "production" &&
        isLoopbackBaseUrl(params.baseUrl) &&
        isUpstashRedisUrl(params.redisUrl)
    ) {
        return false;
    }
    return true;
}

// Lazy connection - only create when needed and if Redis is configured
let sharedConnection: IORedis | null = null;
let queueDisableNoticeShown = false;
function getConnection(): IORedis | null {
    // Tests should be hermetic: don't try to connect to Redis unless explicitly enabled.
    if (process.env.NODE_ENV === "test" && process.env.ENABLE_QUEUES_IN_TEST !== "true") {
        return null;
    }
    const redisUrl = process.env.REDIS_URL;
    const redisHost = process.env.REDIS_HOST;
    const queuesEnabled = shouldEnableRedisQueues({
        nodeEnv: process.env.NODE_ENV,
        redisUrl,
        redisHost,
        baseUrl: process.env.BASE_URL,
        bullmqDisable: process.env.BULLMQ_DISABLE,
        bullmqForceEnable: process.env.BULLMQ_FORCE_ENABLE,
    });
    if (!queuesEnabled) {
        if (!queueDisableNoticeShown) {
            const reason =
                process.env.BULLMQ_DISABLE === "true"
                    ? "disabled via BULLMQ_DISABLE=true"
                    : (!redisUrl && !redisHost)
                        ? "no Redis configuration present"
                        : "loopback production runtime detected with managed Upstash Redis; using local/no-queue mode";
            console.warn(`[QueueFactory] BullMQ queues disabled (${reason})`);
            queueDisableNoticeShown = true;
        }
        return null;
    }
    if (!sharedConnection) {
        // Use REDIS_URL directly if available (Docker/production)
        // BullMQ requires maxRetriesPerRequest: null for blocking operations
        if (redisUrl) {
            sharedConnection = new IORedis(redisUrl, {
                maxRetriesPerRequest: null,
                enableOfflineQueue: false,
            });
        } else {
            sharedConnection = new IORedis({
                host: redisHost || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379'),
                password: process.env.REDIS_PASSWORD || undefined,
                maxRetriesPerRequest: null,
                enableOfflineQueue: false,
            });
        }
        sharedConnection.on('error', (err) => console.warn('[QueueFactory] Redis error:', err.message));
    }
    return sharedConnection;
}

export const QUEUE_NAMES = {
    UPLOAD: 'upload-queue',
    PROCESSING: 'processing-queue',
    PAYMENTS_SYNC: 'payments-sync-queue',
    CHANNEL_INGEST: 'channel-ingest-queue',
    PROMPT_ANALYSIS: 'prompt-analysis-queue',
    /** NotificationHandler outbound webhooks (retries via BullMQ when Redis is configured) */
    WEBHOOK_NOTIFICATION: 'webhook-notification-queue',
};

// Registry for BullBoard
export const queues = new Map<string, Queue>();

/**
 * Creates a standard BullMQ Queue
 */
export function createQueue<T>(name: string): Queue<T> | null {
    if (!Queue) return null;
    const conn = getConnection();
    if (!conn) return null;

    const jobAttempts = parseInt(process.env.QUEUE_JOB_ATTEMPTS || "3");
    const queue = new Queue<T>(name, {
        connection: conn,
        defaultJobOptions: {
            attempts: jobAttempts,
            backoff: {
                type: 'exponential',
                delay: 300,
            },
            removeOnComplete: {
                age: 24 * 3600, // Keep for 24 hours
                count: 1000,
            },
            removeOnFail: {
                age: 7 * 24 * 3600, // Keep for 7 days
            }
        },
    });

    queues.set(name, queue);
    return queue;
}

/**
 * Creates a standard BullMQ Worker
 */
export function createWorker<T, R>(name: string, processor: (job: any) => Promise<R>): Worker<T, R> | null {
    if (!Worker) return null;
    const conn = getConnection();
    if (!conn) return null;

    const stalledInterval = parseInt(process.env.QUEUE_STALLED_INTERVAL_MS || "30000");
    const maxStalledCount = parseInt(process.env.QUEUE_MAX_STALLED_COUNT || "2");
    return new Worker<T, R>(name, processor, {
        connection: conn,
        concurrency: parseInt(process.env.WORKER_CONCURRENCY || '10'),
        stalledInterval,
        maxStalledCount,
    });
}

/**
 * Creates a QueueEvents listener for monitoring
 */
export function createQueueEvents(name: string): QueueEvents | null {
    const conn = getConnection();
    if (!conn) return null;

    return new QueueEvents(name, {
        connection: conn,
    });
}
