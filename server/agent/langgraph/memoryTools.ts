import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { db, pool } from "../../db";
import { agentMemories, agentContext, agentSessionState } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import OpenAI from "openai";
import crypto from "crypto";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    if (!process.env.XAI_API_KEY) {
      return generateFallbackEmbedding(text);
    }
    
    const response = await xaiClient.embeddings.create({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    });
    
    return response.data[0].embedding;
  } catch (error: any) {
    console.warn("[MemoryTools] Embedding generation failed, using fallback:", error.message);
    return generateFallbackEmbedding(text);
  }
}

function generateFallbackEmbedding(text: string): number[] {
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const embedding: number[] = [];
  
  for (let i = 0; i < 1536; i++) {
    const charCode = hash.charCodeAt(i % hash.length);
    const seed = (charCode * (i + 1)) % 1000;
    embedding.push((seed / 1000) * 2 - 1);
  }
  
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / magnitude);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const memoryStoreTool = tool(
  async (input) => {
    try {
      const embedding = await generateEmbedding(input.content);
      
      const [memory] = await db.insert(agentMemories).values({
        namespace: input.namespace || "default",
        content: input.content,
        embedding,
        metadata: input.metadata || {},
      }).returning();

      return JSON.stringify({
        success: true,
        message: "Memory stored successfully",
        data: {
          id: memory.id,
          namespace: memory.namespace,
          contentPreview: input.content.slice(0, 100) + (input.content.length > 100 ? "..." : ""),
        },
      });
    } catch (error: any) {
      console.error("[MemoryStore] Error:", error.message);
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "memory_store",
    description: "Stores content in vector memory with semantic embedding. Use for remembering important info: user preferences, projects/status, contacts/relationships, and feedback to improve future responses.",
    schema: z.object({
      content: z.string().describe("The content to store in memory"),
      namespace: z.string().optional().default("default").describe("Memory namespace for organization (e.g., 'user_prefs', 'facts', 'conversation')"),
      metadata: z.record(z.unknown()).optional().describe("Additional metadata to store with the memory"),
    }),
  }
);

export const memoryRetrieveTool = tool(
  async (input) => {
    try {
      const queryEmbedding = await generateEmbedding(input.query);
      const embeddingStr = `[${queryEmbedding.join(",")}]`;
      
      const client = await pool.connect();
      try {
        const namespaceCondition = input.namespace 
          ? `AND namespace = $2` 
          : "";
        
        const params = input.namespace 
          ? [embeddingStr, input.namespace, input.limit || 5]
          : [embeddingStr, input.limit || 5];
        
        const limitParam = input.namespace ? "$3" : "$2";
        
        const result = await client.query(`
          SELECT 
            id, 
            namespace, 
            content, 
            metadata,
            created_at,
            1 - (embedding <=> $1::vector) as similarity
          FROM agent_memories
          WHERE embedding IS NOT NULL ${namespaceCondition}
          ORDER BY embedding <=> $1::vector
          LIMIT ${limitParam}
        `, params);

        const memories = result.rows.map(row => ({
          id: row.id,
          namespace: row.namespace,
          content: row.content,
          metadata: row.metadata,
          similarity: parseFloat(row.similarity).toFixed(4),
          createdAt: row.created_at,
        }));

        return JSON.stringify({
          success: true,
          message: `Retrieved ${memories.length} memories`,
          data: { memories, query: input.query },
        });
      } finally {
        client.release();
      }
    } catch (error: any) {
      console.error("[MemoryRetrieve] Error:", error.message);
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "memory_retrieve",
    description: "Retrieves relevant memories using semantic search (preferences, projects, contacts, prior feedback). Finds information similar to the query from stored memories.",
    schema: z.object({
      query: z.string().describe("The search query to find relevant memories"),
      namespace: z.string().optional().describe("Filter by namespace"),
      limit: z.number().optional().default(5).describe("Maximum number of memories to retrieve"),
    }),
  }
);

export const contextManageTool = tool(
  async (input) => {
    try {
      switch (input.action) {
        case "add": {
          if (!input.threadId || !input.message) {
            return JSON.stringify({ success: false, error: "threadId and message required for add action" });
          }

          const existing = await db.select().from(agentContext).where(eq(agentContext.threadId, input.threadId)).limit(1);
          
          const newMessage = {
            role: input.message.role,
            content: input.message.content,
            timestamp: Date.now(),
          };
          
          const messageTokens = estimateTokens(input.message.content);

          if (existing.length === 0) {
            await db.insert(agentContext).values({
              threadId: input.threadId,
              contextWindow: [newMessage],
              tokenCount: messageTokens,
              maxTokens: input.maxTokens || 128000,
            });
          } else {
            const currentContext = existing[0];
            const contextWindow = [...(currentContext.contextWindow || []), newMessage];
            const newTokenCount = (currentContext.tokenCount || 0) + messageTokens;
            
            await db.update(agentContext)
              .set({ 
                contextWindow,
                tokenCount: newTokenCount,
              })
              .where(eq(agentContext.threadId, input.threadId));
          }

          return JSON.stringify({
            success: true,
            message: "Message added to context",
            data: { threadId: input.threadId, tokensAdded: messageTokens },
          });
        }

        case "get": {
          if (!input.threadId) {
            return JSON.stringify({ success: false, error: "threadId required for get action" });
          }

          const context = await db.select().from(agentContext).where(eq(agentContext.threadId, input.threadId)).limit(1);
          
          if (context.length === 0) {
            return JSON.stringify({
              success: true,
              message: "No context found",
              data: { threadId: input.threadId, contextWindow: [], tokenCount: 0 },
            });
          }

          return JSON.stringify({
            success: true,
            message: "Context retrieved",
            data: {
              threadId: input.threadId,
              contextWindow: context[0].contextWindow,
              tokenCount: context[0].tokenCount,
              maxTokens: context[0].maxTokens,
            },
          });
        }

        case "compress": {
          if (!input.threadId) {
            return JSON.stringify({ success: false, error: "threadId required for compress action" });
          }

          const context = await db.select().from(agentContext).where(eq(agentContext.threadId, input.threadId)).limit(1);
          
          if (context.length === 0) {
            return JSON.stringify({ success: true, message: "No context to compress" });
          }

          const currentContext = context[0];
          const messages = currentContext.contextWindow || [];
          
          if (messages.length <= 10) {
            return JSON.stringify({ success: true, message: "Context small enough, no compression needed" });
          }

          const systemMessages = messages.filter((m: any) => m.role === "system");
          const recentMessages = messages.slice(-8);
          const compressedWindow = [...systemMessages, ...recentMessages];
          const newTokenCount = compressedWindow.reduce((sum: number, m: any) => sum + estimateTokens(m.content), 0);

          await db.update(agentContext)
            .set({ 
              contextWindow: compressedWindow,
              tokenCount: newTokenCount,
            })
            .where(eq(agentContext.threadId, input.threadId));

          return JSON.stringify({
            success: true,
            message: `Context compressed from ${messages.length} to ${compressedWindow.length} messages`,
            data: { 
              previousMessages: messages.length,
              newMessages: compressedWindow.length,
              tokensSaved: (currentContext.tokenCount || 0) - newTokenCount,
            },
          });
        }

        case "clear": {
          if (!input.threadId) {
            return JSON.stringify({ success: false, error: "threadId required for clear action" });
          }

          await db.delete(agentContext).where(eq(agentContext.threadId, input.threadId));

          return JSON.stringify({
            success: true,
            message: "Context cleared",
            data: { threadId: input.threadId },
          });
        }

        default:
          return JSON.stringify({ success: false, error: `Unknown action: ${input.action}` });
      }
    } catch (error: any) {
      console.error("[ContextManage] Error:", error.message);
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "context_manage",
    description: "Manages the conversation context window. Actions: add (add message), get (retrieve context), compress (reduce context size), clear (reset context).",
    schema: z.object({
      action: z.enum(["add", "get", "compress", "clear"]).describe("Context management action"),
      threadId: z.string().optional().describe("Thread ID for the context"),
      message: z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      }).optional().describe("Message to add (for add action)"),
      maxTokens: z.number().optional().default(128000).describe("Maximum tokens for context window"),
    }),
  }
);

export const sessionStateTool = tool(
  async (input) => {
    try {
      switch (input.action) {
        case "set": {
          if (!input.sessionId || !input.key) {
            return JSON.stringify({ success: false, error: "sessionId and key required for set action" });
          }

          await db.insert(agentSessionState)
            .values({
              sessionId: input.sessionId,
              key: input.key,
              value: input.value,
              expiresAt: input.ttlSeconds ? new Date(Date.now() + input.ttlSeconds * 1000) : null,
            })
            .onConflictDoUpdate({
              target: [agentSessionState.sessionId, agentSessionState.key],
              set: {
                value: input.value,
                expiresAt: input.ttlSeconds ? new Date(Date.now() + input.ttlSeconds * 1000) : null,
                updatedAt: new Date(),
              },
            });

          return JSON.stringify({
            success: true,
            message: "Session state set",
            data: { sessionId: input.sessionId, key: input.key },
          });
        }

        case "get": {
          if (!input.sessionId || !input.key) {
            return JSON.stringify({ success: false, error: "sessionId and key required for get action" });
          }

          const result = await db.select()
            .from(agentSessionState)
            .where(and(
              eq(agentSessionState.sessionId, input.sessionId),
              eq(agentSessionState.key, input.key)
            ))
            .limit(1);

          if (result.length === 0) {
            return JSON.stringify({
              success: true,
              message: "Key not found",
              data: { sessionId: input.sessionId, key: input.key, value: null },
            });
          }

          const state = result[0];
          if (state.expiresAt && new Date(state.expiresAt) < new Date()) {
            await db.delete(agentSessionState)
              .where(and(
                eq(agentSessionState.sessionId, input.sessionId),
                eq(agentSessionState.key, input.key)
              ));
            return JSON.stringify({
              success: true,
              message: "Key expired",
              data: { sessionId: input.sessionId, key: input.key, value: null },
            });
          }

          return JSON.stringify({
            success: true,
            message: "Session state retrieved",
            data: { 
              sessionId: input.sessionId, 
              key: input.key, 
              value: state.value,
              expiresAt: state.expiresAt,
            },
          });
        }

        case "delete": {
          if (!input.sessionId || !input.key) {
            return JSON.stringify({ success: false, error: "sessionId and key required for delete action" });
          }

          await db.delete(agentSessionState)
            .where(and(
              eq(agentSessionState.sessionId, input.sessionId),
              eq(agentSessionState.key, input.key)
            ));

          return JSON.stringify({
            success: true,
            message: "Session state deleted",
            data: { sessionId: input.sessionId, key: input.key },
          });
        }

        case "list": {
          if (!input.sessionId) {
            return JSON.stringify({ success: false, error: "sessionId required for list action" });
          }

          const results = await db.select()
            .from(agentSessionState)
            .where(eq(agentSessionState.sessionId, input.sessionId));

          const validStates = results.filter(s => 
            !s.expiresAt || new Date(s.expiresAt) > new Date()
          );

          return JSON.stringify({
            success: true,
            message: `Found ${validStates.length} session variables`,
            data: { 
              sessionId: input.sessionId,
              keys: validStates.map(s => ({
                key: s.key,
                expiresAt: s.expiresAt,
              })),
            },
          });
        }

        default:
          return JSON.stringify({ success: false, error: `Unknown action: ${input.action}` });
      }
    } catch (error: any) {
      console.error("[SessionState] Error:", error.message);
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "session_state",
    description: "Manages session-scoped state variables. Actions: set (store value), get (retrieve value), delete (remove value), list (list all keys).",
    schema: z.object({
      action: z.enum(["set", "get", "delete", "list"]).describe("Session state action"),
      sessionId: z.string().optional().describe("Session ID"),
      key: z.string().optional().describe("State variable key"),
      value: z.unknown().optional().describe("Value to store (for set action)"),
      ttlSeconds: z.number().optional().describe("Time-to-live in seconds (for set action)"),
    }),
  }
);

export const MEMORY_TOOLS = [
  memoryStoreTool,
  memoryRetrieveTool,
  contextManageTool,
  sessionStateTool,
];

export function getMemoryToolByName(name: string) {
  return MEMORY_TOOLS.find((t) => t.name === name);
}
