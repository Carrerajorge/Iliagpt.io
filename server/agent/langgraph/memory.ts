import { BaseCheckpointSaver, type Checkpoint, type CheckpointMetadata, type CheckpointTuple } from "@langchain/langgraph";
import { RunnableConfig } from "@langchain/core/runnables";
import { pool } from "../../db";
import crypto from "crypto";

interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint: string;
  metadata: string;
  created_at: Date;
}

export class PostgresCheckpointer extends BaseCheckpointSaver {
  private tableName = "langgraph_checkpoints";
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          thread_id VARCHAR(255) NOT NULL,
          checkpoint_ns VARCHAR(255) NOT NULL DEFAULT '',
          checkpoint_id VARCHAR(255) NOT NULL,
          parent_checkpoint_id VARCHAR(255),
          checkpoint JSONB NOT NULL,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW(),
          PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
        );
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_thread 
          ON ${this.tableName} (thread_id, checkpoint_ns, created_at DESC);
      `);
      this.initialized = true;
      console.log("[PostgresCheckpointer] Table initialized");
    } catch (error: any) {
      console.error("[PostgresCheckpointer] Initialization error:", error.message);
    } finally {
      client.release();
    }
  }

  private generateCheckpointId(): string {
    return `ckpt_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    await this.initialize();

    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) || "";
    const checkpointId = config.configurable?.checkpoint_id as string;

    if (!threadId) return undefined;

    const client = await pool.connect();
    try {
      let query: string;
      let params: any[];

      if (checkpointId) {
        query = `
          SELECT * FROM ${this.tableName} 
          WHERE thread_id = $1 AND checkpoint_ns = $2 AND checkpoint_id = $3
        `;
        params = [threadId, checkpointNs, checkpointId];
      } else {
        query = `
          SELECT * FROM ${this.tableName} 
          WHERE thread_id = $1 AND checkpoint_ns = $2 
          ORDER BY created_at DESC LIMIT 1
        `;
        params = [threadId, checkpointNs];
      }

      const result = await client.query<CheckpointRow>(query, params);

      if (result.rows.length === 0) return undefined;

      const row = result.rows[0];
      const checkpoint = typeof row.checkpoint === "string"
        ? JSON.parse(row.checkpoint)
        : row.checkpoint;
      const metadata = row.metadata
        ? (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata)
        : {};

      return {
        config: {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        },
        checkpoint: checkpoint as Checkpoint,
        metadata: metadata as CheckpointMetadata,
        parentConfig: row.parent_checkpoint_id
          ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: row.checkpoint_ns,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
          : undefined,
      };
    } finally {
      client.release();
    }
  }

  async *list(
    config: RunnableConfig,
    options?: { limit?: number; before?: RunnableConfig }
  ): AsyncGenerator<CheckpointTuple> {
    await this.initialize();

    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) || "";
    const limit = options?.limit || 100;
    const beforeId = options?.before?.configurable?.checkpoint_id as string;

    if (!threadId) return;

    const client = await pool.connect();
    try {
      let query: string;
      let params: any[];

      if (beforeId) {
        query = `
          SELECT * FROM ${this.tableName} 
          WHERE thread_id = $1 AND checkpoint_ns = $2 
            AND created_at < (SELECT created_at FROM ${this.tableName} WHERE checkpoint_id = $3)
          ORDER BY created_at DESC LIMIT $4
        `;
        params = [threadId, checkpointNs, beforeId, limit];
      } else {
        query = `
          SELECT * FROM ${this.tableName} 
          WHERE thread_id = $1 AND checkpoint_ns = $2 
          ORDER BY created_at DESC LIMIT $3
        `;
        params = [threadId, checkpointNs, limit];
      }

      const result = await client.query<CheckpointRow>(query, params);

      for (const row of result.rows) {
        const checkpoint = typeof row.checkpoint === "string"
          ? JSON.parse(row.checkpoint)
          : row.checkpoint;
        const metadata = row.metadata
          ? (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata)
          : {};

        yield {
          config: {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: row.checkpoint_ns,
              checkpoint_id: row.checkpoint_id,
            },
          },
          checkpoint: checkpoint as Checkpoint,
          metadata: metadata as CheckpointMetadata,
          parentConfig: row.parent_checkpoint_id
            ? {
              configurable: {
                thread_id: row.thread_id,
                checkpoint_ns: row.checkpoint_ns,
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
            : undefined,
        };
      }
    } finally {
      client.release();
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    await this.initialize();

    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) || "";
    const parentCheckpointId = config.configurable?.checkpoint_id as string;
    const newCheckpointId = this.generateCheckpointId();

    if (!threadId) {
      throw new Error("thread_id is required in config.configurable");
    }

    const client = await pool.connect();
    try {
      await client.query(
        `
        INSERT INTO ${this.tableName} 
          (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id) 
        DO UPDATE SET checkpoint = $5, metadata = $6, created_at = NOW()
        `,
        [
          threadId,
          checkpointNs,
          newCheckpointId,
          parentCheckpointId || null,
          JSON.stringify(checkpoint),
          JSON.stringify(metadata),
        ]
      );

      return {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: newCheckpointId,
        },
      };
    } finally {
      client.release();
    }
  }

  async putWrites(
    config: RunnableConfig,
    writes: [string, unknown][],
    taskId: string
  ): Promise<void> {
    await this.initialize();

    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns as string) || "";
    const checkpointId = config.configurable?.checkpoint_id as string;

    if (!threadId || !checkpointId) return;

    const client = await pool.connect();
    try {
      const result = await client.query<CheckpointRow>(
        `SELECT checkpoint FROM ${this.tableName} WHERE thread_id = $1 AND checkpoint_ns = $2 AND checkpoint_id = $3`,
        [threadId, checkpointNs, checkpointId]
      );

      if (result.rows.length === 0) return;

      const checkpoint = typeof result.rows[0].checkpoint === "string"
        ? JSON.parse(result.rows[0].checkpoint)
        : result.rows[0].checkpoint;

      if (!checkpoint.pending_sends) {
        checkpoint.pending_sends = [];
      }

      for (const [channel, value] of writes) {
        checkpoint.pending_sends.push({ taskId, channel, value });
      }

      await client.query(
        `UPDATE ${this.tableName} SET checkpoint = $1 WHERE thread_id = $2 AND checkpoint_ns = $3 AND checkpoint_id = $4`,
        [JSON.stringify(checkpoint), threadId, checkpointNs, checkpointId]
      );
    } finally {
      client.release();
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.initialize();

    // const threadId = config.configurable?.thread_id as string;
    const checkpointNs = ""; // Default namespace or delete all?

    if (!threadId) return;

    const client = await pool.connect();
    try {
      await client.query(
        `DELETE FROM ${this.tableName} WHERE thread_id = $1 AND checkpoint_ns = $2`,
        [threadId, checkpointNs]
      );
    } finally {
      client.release();
    }
  }

  async getHistory(
    threadId: string,
    limit = 50
  ): Promise<Array<{ checkpoint_id: string; created_at: Date; metadata: any }>> {
    await this.initialize();

    const client = await pool.connect();
    try {
      const result = await client.query<Pick<CheckpointRow, "checkpoint_id" | "created_at" | "metadata">>(
        `SELECT checkpoint_id, created_at, metadata FROM ${this.tableName} 
         WHERE thread_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [threadId, limit]
      );

      return result.rows.map((row) => ({
        checkpoint_id: row.checkpoint_id,
        created_at: row.created_at,
        metadata: row.metadata ? (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) : {},
      }));
    } finally {
      client.release();
    }
  }
}

import { RedisCheckpointer } from "./redisCheckpointer";

export const postgresCheckpointer = new PostgresCheckpointer();
export const checkpointer = new RedisCheckpointer();

export interface ConversationMemory {
  threadId: string;
  messages: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    timestamp: number;
    toolCalls?: Array<{
      name: string;
      args: Record<string, any>;
      result?: string;
    }>;
  }>;
  context: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

class MemoryStore {
  private tableName = "langgraph_memory";
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          thread_id VARCHAR(255) PRIMARY KEY,
          messages JSONB NOT NULL DEFAULT '[]',
          context JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_updated 
          ON ${this.tableName} (updated_at DESC);
      `);
      this.initialized = true;
    } catch (error: any) {
      console.error("[MemoryStore] Initialization error:", error.message);
    } finally {
      client.release();
    }
  }

  async get(threadId: string): Promise<ConversationMemory | null> {
    await this.initialize();

    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM ${this.tableName} WHERE thread_id = $1`,
        [threadId]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        threadId: row.thread_id,
        messages: row.messages || [],
        context: row.context || {},
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      };
    } finally {
      client.release();
    }
  }

  async save(memory: ConversationMemory): Promise<void> {
    await this.initialize();

    const client = await pool.connect();
    try {
      await client.query(
        `
        INSERT INTO ${this.tableName} (thread_id, messages, context, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (thread_id) 
        DO UPDATE SET messages = $2, context = $3, updated_at = NOW()
        `,
        [memory.threadId, JSON.stringify(memory.messages), JSON.stringify(memory.context)]
      );
    } finally {
      client.release();
    }
  }

  async addMessage(
    threadId: string,
    role: "user" | "assistant" | "system" | "tool",
    content: string,
    toolCalls?: Array<{ name: string; args: Record<string, any>; result?: string }>
  ): Promise<void> {
    let memory = await this.get(threadId);

    if (!memory) {
      memory = {
        threadId,
        messages: [],
        context: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    memory.messages.push({
      role,
      content,
      timestamp: Date.now(),
      toolCalls,
    });

    const maxMessages = 100;
    if (memory.messages.length > maxMessages) {
      memory.messages = memory.messages.slice(-maxMessages);
    }

    memory.updatedAt = Date.now();
    await this.save(memory);
  }

  async updateContext(threadId: string, context: Record<string, any>): Promise<void> {
    let memory = await this.get(threadId);

    if (!memory) {
      memory = {
        threadId,
        messages: [],
        context: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    memory.context = { ...memory.context, ...context };
    memory.updatedAt = Date.now();
    await this.save(memory);
  }

  async delete(threadId: string): Promise<void> {
    await this.initialize();

    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM ${this.tableName} WHERE thread_id = $1`, [threadId]);
    } finally {
      client.release();
    }
  }
}

export const memoryStore = new MemoryStore();
