import { BaseCheckpointSaver, type Checkpoint, type CheckpointMetadata, type CheckpointTuple } from "@langchain/langgraph";
import { RunnableConfig } from "@langchain/core/runnables";
import IORedis from "ioredis";

// Reuse the same connection logic/env vars if possible, or create a new client
// For consistency, we'll implement a singleton pattern similar to RedisSSEManager
// or just instantiate a client. Given queueFactory usage, let's keep it simple.

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export class RedisCheckpointer extends BaseCheckpointSaver {
    private client: IORedis;
    private clientInitialized = false;

    constructor() {
        super();
        // Use lazy connection to avoid issues during build/test if Redis isn't there
        // We'll initialize explicitly or on first use
        this.client = new IORedis(REDIS_URL, {
            lazyConnect: true,
            maxRetriesPerRequest: 3,
        });

        this.client.on("error", (err) => {
            console.warn("[RedisCheckpointer] Redis client error:", err.message);
        });
    }

    async initialize(): Promise<void> {
        if (this.clientInitialized) return;
        try {
            await this.client.connect();
            this.clientInitialized = true;
            console.log("[RedisCheckpointer] Connected to Redis");
        } catch (error: any) {
            console.error("[RedisCheckpointer] Failed to connect:", error.message);
            // Don't throw, just log. Operations will fail gracefully if needed or retry.
        }
    }

    private getKey(threadId: string, checkpointNs: string, checkpointId: string) {
        return `checkpoint:${threadId}:${checkpointNs}:${checkpointId}`;
    }

    private getLatestKey(threadId: string, checkpointNs: string) {
        return `checkpoint_latest:${threadId}:${checkpointNs}`;
    }

    async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        if (!this.clientInitialized) await this.initialize();

        const threadId = config.configurable?.thread_id as string;
        const checkpointNs = (config.configurable?.checkpoint_ns as string) || "";
        const checkpointId = config.configurable?.checkpoint_id as string;

        if (!threadId) return undefined;

        let key: string;
        if (checkpointId) {
            key = this.getKey(threadId, checkpointNs, checkpointId);
        } else {
            // Find the latest checkpoint ID for this thread/ns
            const latestId = await this.client.get(this.getLatestKey(threadId, checkpointNs));
            if (!latestId) return undefined;
            key = this.getKey(threadId, checkpointNs, latestId);
        }

        const data = await this.client.get(key);
        if (!data) return undefined;

        const row = JSON.parse(data);

        return {
            config: {
                configurable: {
                    thread_id: threadId,
                    checkpoint_ns: checkpointNs,
                    checkpoint_id: row.checkpoint_id,
                },
            },
            checkpoint: row.checkpoint as Checkpoint,
            metadata: row.metadata as CheckpointMetadata,
            parentConfig: row.parent_checkpoint_id
                ? {
                    configurable: {
                        thread_id: threadId,
                        checkpoint_ns: checkpointNs,
                        checkpoint_id: row.parent_checkpoint_id,
                    },
                }
                : undefined,
        };
    }

    async *list(
        config: RunnableConfig,
        options?: { limit?: number; before?: RunnableConfig }
    ): AsyncGenerator<CheckpointTuple> {
        if (!this.clientInitialized) await this.initialize();

        // Note: Redis isn't great for listing/sorting by time without Sorted Sets (ZSET).
        // For a robust implementation, we should use ZSETs to index checkpoints by time.

        const threadId = config.configurable?.thread_id as string;
        const checkpointNs = (config.configurable?.checkpoint_ns as string) || "";

        if (!threadId) return;

        // Use ZSET: checkpoint_index:{threadId}:{ns} -> member: checkpointId, score: timestamp
        const indexKey = `checkpoint_index:${threadId}:${checkpointNs}`;
        const limit = options?.limit || 10;

        // Simple reverse range (newest first)
        const checkpointIds = await this.client.zrevrange(indexKey, 0, limit - 1);

        // In a real 'before' scenario, we'd find the rank of 'before' and paginate.
        // Simplifying for this iteration to just return recent ones.

        for (const cpId of checkpointIds) {
            // Skip if after 'before' id (simplified)
            // In reality, use ZREVRANGEBYSCORE if we tracked scores accurately

            const key = this.getKey(threadId, checkpointNs, cpId);
            const data = await this.client.get(key);
            if (data) {
                const row = JSON.parse(data);
                yield {
                    config: {
                        configurable: {
                            thread_id: threadId,
                            checkpoint_ns: checkpointNs,
                            checkpoint_id: row.checkpoint_id,
                        },
                    },
                    checkpoint: row.checkpoint as Checkpoint,
                    metadata: row.metadata as CheckpointMetadata,
                    parentConfig: row.parent_checkpoint_id
                        ? {
                            configurable: {
                                thread_id: threadId,
                                checkpoint_ns: checkpointNs,
                                checkpoint_id: row.parent_checkpoint_id,
                            },
                        }
                        : undefined,
                };
            }
        }
    }

    async put(
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata
    ): Promise<RunnableConfig> {
        if (!this.clientInitialized) await this.initialize();

        const threadId = config.configurable?.thread_id as string;
        const checkpointNs = (config.configurable?.checkpoint_ns as string) || "";
        const parentCheckpointId = config.configurable?.checkpoint_id as string;

        if (!threadId) {
            throw new Error("thread_id is required in config.configurable");
        }

        const checkpointId = checkpoint.id || `ckpt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        const row = {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: checkpointId,
            parent_checkpoint_id: parentCheckpointId,
            checkpoint,
            metadata,
            created_at: new Date().toISOString()
        };

        const key = this.getKey(threadId, checkpointNs, checkpointId);
        const indexKey = `checkpoint_index:${threadId}:${checkpointNs}`;
        const latestKey = this.getLatestKey(threadId, checkpointNs);

        // Store data, update index, update pointer
        const pipeline = this.client.pipeline();
        pipeline.set(key, JSON.stringify(row));
        pipeline.expire(key, 86400 * 7); // 7 day retention for individual checkpoints
        pipeline.zadd(indexKey, Date.now(), checkpointId);
        pipeline.expire(indexKey, 86400 * 7);
        pipeline.set(latestKey, checkpointId);
        pipeline.expire(latestKey, 86400 * 7);

        await pipeline.exec();

        return {
            configurable: {
                thread_id: threadId,
                checkpoint_ns: checkpointNs,
                checkpoint_id: checkpointId,
            },
        };
    }

    async putWrites(config: RunnableConfig, writes: [string, unknown][], taskId: string): Promise<void> {
        // Pending writes implementation (optional but good for resumption)
        // For now, we rely on standard put
    }
    async deleteThread(threadId: string): Promise<void> {
        if (!this.clientInitialized) await this.initialize();
        // const threadId = config.configurable?.thread_id as string;
        // const checkpointNs = (config.configurable?.checkpoint_ns as string) || "";
        const checkpointNs = ""; // As seen in memory.ts update attempt, using empty namespace

        if (!threadId) return;

        const indexKey = `checkpoint_index:${threadId}:${checkpointNs}`;
        const latestKey = this.getLatestKey(threadId, checkpointNs);

        await this.client.del(indexKey, latestKey);
    }

    // In a real implementation we would also walk the index and delete individual checkpoints
    // But since they have expiration, we can rely on that for now or improve later
}
