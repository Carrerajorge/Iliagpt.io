/**
 * Conversation Memory System
 * Long-term user memory and context
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

interface MemoryEntry {
  id: string;
  userId: string;
  type: MemoryType;
  content: string;
  importance: number;
  context?: string;
  createdAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
}

type MemoryType = 
  | "fact"           // User stated fact
  | "preference"     // User preference
  | "instruction"    // Standing instruction
  | "context"        // Important context
  | "summary"        // Conversation summary
  | "entity"         // Named entity (person, place, etc)
  | "task";          // Pending task or reminder

// Ensure table exists
const ensureTable = async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_memories (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        importance FLOAT DEFAULT 0.5,
        context TEXT,
        embedding VECTOR(1536),
        created_at TIMESTAMP DEFAULT NOW(),
        last_accessed_at TIMESTAMP DEFAULT NOW(),
        access_count INTEGER DEFAULT 0
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_memories_user ON user_memories(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_memories_type ON user_memories(type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_memories_importance ON user_memories(importance DESC)`);
  } catch (e) {
    // Table might exist
  }
};

ensureTable();

export class MemoryService {
  /**
   * Store a memory
   */
  async store(
    userId: string,
    type: MemoryType,
    content: string,
    options: {
      importance?: number;
      context?: string;
    } = {}
  ): Promise<string> {
    const { importance = 0.5, context } = options;
    
    // Check for duplicates
    const existing = await db.execute(sql`
      SELECT id FROM user_memories 
      WHERE user_id = ${userId} AND content = ${content}
      LIMIT 1
    `);
    
    if (existing.rows?.length) {
      // Update existing instead
      await db.execute(sql`
        UPDATE user_memories SET 
          importance = GREATEST(importance, ${importance}),
          last_accessed_at = NOW(),
          access_count = access_count + 1
        WHERE id = ${existing.rows[0].id}
      `);
      return existing.rows[0].id;
    }
    
    const result = await db.execute(sql`
      INSERT INTO user_memories (user_id, type, content, importance, context)
      VALUES (${userId}, ${type}, ${content}, ${importance}, ${context || null})
      RETURNING id
    `);
    
    return result.rows?.[0]?.id;
  }

  /**
   * Retrieve relevant memories for a query
   */
  async retrieve(
    userId: string,
    options: {
      types?: MemoryType[];
      limit?: number;
      minImportance?: number;
    } = {}
  ): Promise<MemoryEntry[]> {
    const { types, limit = 20, minImportance = 0 } = options;

    let result;

    if (types && types.length > 0) {
      result = await db.execute(sql`
        SELECT * FROM user_memories
        WHERE user_id = ${userId}
        AND importance >= ${minImportance}
        AND type = ANY(${types})
        ORDER BY importance DESC, last_accessed_at DESC
        LIMIT ${limit}
      `);
    } else {
      result = await db.execute(sql`
        SELECT * FROM user_memories
        WHERE user_id = ${userId}
        AND importance >= ${minImportance}
        ORDER BY importance DESC, last_accessed_at DESC
        LIMIT ${limit}
      `);
    }
    
    // Update access counts
    const ids = result.rows?.map((r: any) => r.id) || [];
    if (ids.length > 0) {
      await db.execute(sql`
        UPDATE user_memories SET 
          last_accessed_at = NOW(),
          access_count = access_count + 1
        WHERE id = ANY(${ids})
      `);
    }
    
    return (result.rows || []) as MemoryEntry[];
  }

  /**
   * Get memories formatted for context injection
   */
  async getContextMemories(userId: string): Promise<string> {
    const memories = await this.retrieve(userId, {
      types: ["fact", "preference", "instruction"],
      limit: 10,
      minImportance: 0.6
    });
    
    if (memories.length === 0) return "";
    
    const formatted = memories.map(m => {
      switch (m.type) {
        case "fact":
          return `- User fact: ${m.content}`;
        case "preference":
          return `- User prefers: ${m.content}`;
        case "instruction":
          return `- Standing instruction: ${m.content}`;
        default:
          return `- ${m.content}`;
      }
    });
    
    return `\n\n[User Memory Context]\n${formatted.join("\n")}\n`;
  }

  /**
   * Extract memories from conversation
   */
  async extractFromConversation(
    userId: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<number> {
    let extracted = 0;
    
    for (const msg of messages) {
      if (msg.role !== "user") continue;
      
      const content = msg.content.toLowerCase();
      
      // Extract preferences
      const preferencePatterns = [
        /(?:i prefer|i like|i love|i enjoy|my favorite is) (.+?)(?:\.|$)/gi,
        /(?:i don't like|i hate|i dislike) (.+?)(?:\.|$)/gi
      ];
      
      for (const pattern of preferencePatterns) {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
          await this.store(userId, "preference", match[0].trim(), { importance: 0.7 });
          extracted++;
        }
      }
      
      // Extract facts
      const factPatterns = [
        /(?:i am|i'm|my name is|i work (?:at|as|in)|i live in) (.+?)(?:\.|$)/gi
      ];
      
      for (const pattern of factPatterns) {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
          await this.store(userId, "fact", match[0].trim(), { importance: 0.8 });
          extracted++;
        }
      }
      
      // Extract instructions
      const instructionPatterns = [
        /(?:always|never|remember to|don't forget) (.+?)(?:\.|$)/gi
      ];
      
      for (const pattern of instructionPatterns) {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
          await this.store(userId, "instruction", match[0].trim(), { importance: 0.9 });
          extracted++;
        }
      }
    }
    
    return extracted;
  }

  /**
   * Decay old memories
   */
  async decayMemories(userId: string): Promise<number> {
    const result = await db.execute(sql`
      UPDATE user_memories SET
        importance = importance * 0.95
      WHERE user_id = ${userId}
      AND last_accessed_at < NOW() - INTERVAL '30 days'
      AND importance > 0.1
    `);
    
    // Delete very low importance memories
    await db.execute(sql`
      DELETE FROM user_memories
      WHERE user_id = ${userId}
      AND importance < 0.1
      AND access_count < 3
    `);
    
    return result.rowCount || 0;
  }

  /**
   * Delete a specific memory
   */
  async delete(userId: string, memoryId: string): Promise<boolean> {
    const result = await db.execute(sql`
      DELETE FROM user_memories WHERE id = ${memoryId} AND user_id = ${userId}
    `);
    return (result.rowCount || 0) > 0;
  }

  /**
   * Get memory stats for a user
   */
  async getStats(userId: string): Promise<{
    total: number;
    byType: Record<string, number>;
    avgImportance: number;
  }> {
    const result = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        type,
        AVG(importance) as avg_importance
      FROM user_memories
      WHERE user_id = ${userId}
      GROUP BY type
    `);
    
    const byType: Record<string, number> = {};
    let total = 0;
    let avgImportance = 0;
    
    for (const row of result.rows || []) {
      byType[(row as any).type] = parseInt((row as any).count || "0");
      total += parseInt((row as any).count || "0");
      avgImportance += parseFloat((row as any).avg_importance || "0");
    }
    
    return {
      total,
      byType,
      avgImportance: result.rows?.length ? avgImportance / result.rows.length : 0
    };
  }
}

export const memoryService = new MemoryService();
