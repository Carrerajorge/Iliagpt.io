let Queue: any, Worker: any, QueueEvents: any;
try { const bullmq = require('bullmq'); Queue = bullmq.Queue; Worker = bullmq.Worker; QueueEvents = bullmq.QueueEvents; } catch {}
import IORedis, { RedisOptions } from 'ioredis';

// Shared connection configuration - only connect if Redis is available
const REDIS_URL = process.env.REDIS_URL;

// Lazy connection - only create when needed and if Redis is configured
let sharedConnection: IORedis | null = null;
function getConnection(): IORedis | null {
    // Tests should be hermetic: don't try to connect to Redis unless explicitly enabled.
    if (process.env.NODE_ENV === "test" && process.env.ENABLE_QUEUES_IN_TEST !== "true") {
        return null;
    }
    if (!REDIS_URL && !process.env.REDIS_HOST) {
        console.warn('[QueueFactory] No REDIS_URL configured, queues disabled');
        return null;
    }
    if (!sharedConnection) {
        // Use REDIS_URL directly if available (Docker/production)
        // BullMQ requires maxRetriesPerRequest: null for blocking operations
        if (REDIS_URL) {
            sharedConnection = new IORedis(REDIS_URL, {
                maxRetriesPerRequest: null,
            });
        } else {
            sharedConnection = new IORedis({
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379'),
                password: process.env.REDIS_PASSWORD || undefined,
                maxRetriesPerRequest: null,
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
