import { db } from "../../db";
import { agentMemoryStore } from "@shared/schema";
import { eq, and, isNull, or, gt } from "drizzle-orm";
import { randomUUID } from "crypto";

export type ProjectMemoryCategory =
  | "architecture_decision"
  | "file_purpose"
  | "user_preference"
  | "project_convention"
  | "dependency_info"
  | "known_issue"
  | "workflow_pattern";

export interface ProjectMemoryEntry {
  id: string;
  userId?: string;
  category: ProjectMemoryCategory;
  key: string;
  value: any;
  importance: number;
  ttlMs?: number;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class ProjectMemory {
  async store(params: {
    userId?: string;
    chatId?: string;
    category: ProjectMemoryCategory;
    key: string;
    value: any;
    importance?: number;
    ttlMs?: number;
  }): Promise<ProjectMemoryEntry> {
    const now = new Date();
    const expiresAt = params.ttlMs ? new Date(now.getTime() + params.ttlMs) : undefined;
    const memoryKey = `project:${params.category}:${params.key}`;
    const importance = params.importance ?? 0.5;

    const memoryValue = {
      data: params.value,
      category: params.category,
      importance,
    };

    try {
      const existing = await db
        .select()
        .from(agentMemoryStore)
        .where(
          and(
            eq(agentMemoryStore.memoryKey, memoryKey),
            params.userId ? eq(agentMemoryStore.userId, params.userId) : isNull(agentMemoryStore.userId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(agentMemoryStore)
          .set({
            memoryValue,
            expiresAt: expiresAt ?? null,
            updatedAt: now,
          })
          .where(eq(agentMemoryStore.id, existing[0].id));

        return {
          id: existing[0].id,
          userId: params.userId,
          category: params.category,
          key: params.key,
          value: params.value,
          importance,
          ttlMs: params.ttlMs,
          expiresAt,
          createdAt: existing[0].createdAt,
          updatedAt: now,
        };
      }

      const id = randomUUID();
      await db.insert(agentMemoryStore).values({
        id,
        chatId: params.chatId ?? null,
        userId: params.userId ?? null,
        memoryKey,
        memoryValue,
        memoryType: "fact",
        expiresAt: expiresAt ?? null,
        updatedAt: now,
      });

      return {
        id,
        userId: params.userId,
        category: params.category,
        key: params.key,
        value: params.value,
        importance,
        ttlMs: params.ttlMs,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      };
    } catch (error) {
      console.error("[ProjectMemory] Store error:", error);
      throw error;
    }
  }

  async recall(params: {
    userId?: string;
    category?: ProjectMemoryCategory;
    key?: string;
    minImportance?: number;
    limit?: number;
  }): Promise<ProjectMemoryEntry[]> {
    try {
      const conditions: any[] = [];

      if (params.userId) {
        conditions.push(eq(agentMemoryStore.userId, params.userId));
      }

      if (params.category && params.key) {
        conditions.push(eq(agentMemoryStore.memoryKey, `project:${params.category}:${params.key}`));
      } else if (params.category) {
        conditions.push(eq(agentMemoryStore.memoryType, "fact"));
      }

      const now = new Date();
      conditions.push(
        or(
          isNull(agentMemoryStore.expiresAt),
          gt(agentMemoryStore.expiresAt, now)
        )
      );

      const rows = await db
        .select()
        .from(agentMemoryStore)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(params.limit ?? 100);

      const results: ProjectMemoryEntry[] = [];

      for (const row of rows) {
        const val = row.memoryValue as any;
        if (!val || typeof val !== "object") continue;

        const keyParts = row.memoryKey.split(":");
        if (keyParts[0] !== "project") continue;

        const category = keyParts[1] as ProjectMemoryCategory;
        const key = keyParts.slice(2).join(":");
        const importance = val.importance ?? 0.5;

        if (params.category && category !== params.category) continue;
        if (params.minImportance && importance < params.minImportance) continue;

        results.push({
          id: row.id,
          userId: row.userId ?? undefined,
          category,
          key,
          value: val.data,
          importance,
          expiresAt: row.expiresAt ?? undefined,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }

      results.sort((a, b) => b.importance - a.importance);

      return results;
    } catch (error) {
      console.error("[ProjectMemory] Recall error:", error);
      return [];
    }
  }

  async forget(params: {
    userId?: string;
    category?: ProjectMemoryCategory;
    key?: string;
  }): Promise<number> {
    try {
      if (params.category && params.key) {
        const memoryKey = `project:${params.category}:${params.key}`;
        const conditions: any[] = [eq(agentMemoryStore.memoryKey, memoryKey)];
        if (params.userId) {
          conditions.push(eq(agentMemoryStore.userId, params.userId));
        }
        const deleted = await db
          .delete(agentMemoryStore)
          .where(and(...conditions))
          .returning();
        return deleted.length;
      }

      return 0;
    } catch (error) {
      console.error("[ProjectMemory] Forget error:", error);
      return 0;
    }
  }

  async cleanExpired(): Promise<number> {
    try {
      const now = new Date();
      const deleted = await db
        .delete(agentMemoryStore)
        .where(
          and(
            gt(now, agentMemoryStore.expiresAt!),
            eq(agentMemoryStore.memoryType, "fact")
          )
        )
        .returning();
      return deleted.length;
    } catch (error) {
      console.error("[ProjectMemory] CleanExpired error:", error);
      return 0;
    }
  }

  async getStats(userId?: string): Promise<{
    totalEntries: number;
    byCategory: Record<string, number>;
  }> {
    try {
      const entries = await this.recall({ userId });
      const byCategory: Record<string, number> = {};
      for (const entry of entries) {
        byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
      }
      return { totalEntries: entries.length, byCategory };
    } catch {
      return { totalEntries: 0, byCategory: {} };
    }
  }
}

export const projectMemory = new ProjectMemory();
