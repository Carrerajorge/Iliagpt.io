import { redis } from '../../lib/redis';
import Redis from 'ioredis';
import { EventEmitter } from 'events';

/**
 * Event-based memory bus that uses Redis to share state across isolated
 * Agent Sandbox workers/containers in real-time.
 */
export class CrossAgentMemoryBus extends EventEmitter {
    private subscriber: Redis | null = null;
    private readonly maxExpirySecs = 3600 * 24; // 24 hours

    constructor(public readonly runId: string) {
        super();
    }

    /**
     * Initializes the subscription for real-time memory updates.
     */
    async initialize() {
        if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
            console.warn('[CrossAgentMemoryBus] No Redis configured, falling back to local memory simulation (Not isolated).');
            return;
        }

        try {
            // We need a dedicated connection for subscriber
            this.subscriber = process.env.REDIS_URL
                ? new Redis(process.env.REDIS_URL, { lazyConnect: true })
                : new Redis({
                    host: process.env.REDIS_HOST || '127.0.0.1',
                    port: Number(process.env.REDIS_PORT) || 6379,
                    password: process.env.REDIS_PASSWORD || undefined,
                    lazyConnect: true
                });

            await this.subscriber.connect();
            await this.subscriber.subscribe(`agent_bus:${this.runId}`);

            this.subscriber.on('message', (channel, message) => {
                if (channel === `agent_bus:${this.runId}`) {
                    try {
                        const parsed = JSON.parse(message);
                        this.emit(parsed.event, parsed.payload);
                    } catch (e) {
                        console.error('[CrossAgentMemoryBus] Failed to parse message', e);
                    }
                }
            });
        } catch (e) {
            console.error('[CrossAgentMemoryBus] Failed to initialize subscriber', e);
            this.subscriber = null;
        }
    }

    /**
     * Set a value in the shared memory
     */
    async set<T>(key: string, value: T): Promise<void> {
        const fullKey = `agent_bus:${this.runId}:${key}`;
        await redis.set(fullKey, JSON.stringify(value), 'EX', this.maxExpirySecs);

        // Broadcast the update so other agents know
        await this.publish('memoryUpdated', { key, value });
    }

    /**
     * Get a value from the shared memory
     */
    async get<T>(key: string): Promise<T | undefined> {
        const fullKey = `agent_bus:${this.runId}:${key}`;
        const raw = await redis.get(fullKey);
        if (!raw) return undefined;
        try {
            return JSON.parse(raw) as T;
        } catch {
            return undefined;
        }
    }

    /**
     * Publish an arbitrary event to all sub-agents in this run
     */
    async publish(event: string, payload: any) {
        const message = JSON.stringify({ event, payload });
        await redis.publish(`agent_bus:${this.runId}`, message);
    }

    /**
     * Get all keys associated with this run
     */
    async getAllKeys(): Promise<string[]> {
        const pattern = `agent_bus:${this.runId}:*`;
        const keys = await redis.keys(pattern);
        return keys.map(k => k.replace(`agent_bus:${this.runId}:`, ''));
    }

    /**
     * Clear all memory for this run and stop listening
     */
    async destroy() {
        if (this.subscriber) {
            await this.subscriber.unsubscribe(`agent_bus:${this.runId}`);
            this.subscriber.disconnect();
            this.subscriber = null;
        }
    }
}
