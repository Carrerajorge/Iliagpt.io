import { z } from "zod";
import { db } from "../../../db";
import { agentMemoryStore, chatMessages, chats } from "@shared/schema";
import { eq, and, or, ilike, desc, sql } from "drizzle-orm";
import type { ToolDefinition, ToolResult, ToolContext } from "../../toolRegistry";
import { createError } from "../../toolRegistry";

const memorySearchSchema = z.object({
  query: z.string().min(1).describe("Search query for memory"),
  chatId: z.string().optional().describe("Limit search to a specific chat"),
  memoryType: z.enum(["context", "fact", "preference", "artifact_ref", "all"]).default("all").describe("Filter by memory type"),
  limit: z.number().min(1).max(50).default(10).describe("Maximum results to return"),
  citations: z.boolean().default(true).describe("Include source citations in results"),
});

const memoryGetSchema = z.object({
  memoryKey: z.string().min(1).describe("The exact memory key to retrieve"),
  chatId: z.string().optional().describe("Limit to a specific chat"),
});

export interface MemorySearchResult {
  id: string;
  key: string;
  value: unknown;
  type: string;
  chatId: string | null;
  citation: string | null;
  updatedAt: Date;
  score: number;
}

function computeRelevanceScore(query: string, key: string, value: unknown): number {
  const q = query.toLowerCase();
  const k = key.toLowerCase();
  const v = typeof value === "string" ? value.toLowerCase() : JSON.stringify(value).toLowerCase();

  let score = 0;

  if (k === q) score += 1.0;
  else if (k.includes(q)) score += 0.7;

  const queryTerms = q.split(/\s+/).filter(Boolean);
  for (const term of queryTerms) {
    if (k.includes(term)) score += 0.3;
    if (v.includes(term)) score += 0.2;
  }

  if (v.includes(q)) score += 0.5;

  return Math.min(score, 2.0);
}

function formatCitation(record: { chatId: string | null; memoryKey: string; id: string }): string {
  if (record.chatId) {
    return `Source: memory/${record.chatId}#${record.memoryKey}`;
  }
  return `Source: memory/global#${record.memoryKey}`;
}

async function searchMemoryRecords(
  userId: string,
  query: string,
  opts: { chatId?: string; memoryType?: string; limit: number; citations: boolean }
): Promise<MemorySearchResult[]> {
  const queryTerms = query.split(/\s+/).filter(Boolean);
  const likeConditions = queryTerms.map(term =>
    or(
      ilike(agentMemoryStore.memoryKey, `%${term}%`),
      sql`CAST(${agentMemoryStore.memoryValue} AS TEXT) ILIKE ${"%" + term + "%"}`
    )
  );

  const conditions = [
    eq(agentMemoryStore.userId, userId),
    ...(opts.chatId ? [eq(agentMemoryStore.chatId, opts.chatId)] : []),
    ...(opts.memoryType && opts.memoryType !== "all"
      ? [eq(agentMemoryStore.memoryType, opts.memoryType)]
      : []),
    or(
      ilike(agentMemoryStore.memoryKey, `%${query}%`),
      sql`CAST(${agentMemoryStore.memoryValue} AS TEXT) ILIKE ${"%" + query + "%"}`,
      ...likeConditions.filter(Boolean)
    ),
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(agentMemoryStore)
    .where(and(...conditions))
    .orderBy(desc(agentMemoryStore.updatedAt))
    .limit(opts.limit * 2);

  const scored: MemorySearchResult[] = rows.map(row => ({
    id: row.id,
    key: row.memoryKey,
    value: row.memoryValue,
    type: row.memoryType || "context",
    chatId: row.chatId,
    citation: opts.citations ? formatCitation(row) : null,
    updatedAt: row.updatedAt,
    score: computeRelevanceScore(query, row.memoryKey, row.memoryValue),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, opts.limit);
}

async function searchConversationHistory(
  userId: string,
  query: string,
  opts: { chatId?: string; limit: number; citations: boolean }
): Promise<MemorySearchResult[]> {
  const queryTerms = query.split(/\s+/).filter(Boolean);
  const likeConditions = queryTerms.map(term =>
    ilike(chatMessages.content, `%${term}%`)
  );

  const conditions = [
    ...(opts.chatId ? [eq(chatMessages.chatId, opts.chatId)] : []),
    or(
      ilike(chatMessages.content, `%${query}%`),
      ...likeConditions
    ),
  ].filter(Boolean);

  const chatConditions = opts.chatId
    ? [eq(chats.id, opts.chatId), eq(chats.userId, userId)]
    : [eq(chats.userId, userId)];

  const rows = await db
    .select({
      id: chatMessages.id,
      chatId: chatMessages.chatId,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .innerJoin(chats, eq(chatMessages.chatId, chats.id))
    .where(and(...chatConditions, ...conditions))
    .orderBy(desc(chatMessages.createdAt))
    .limit(opts.limit * 2);

  const results: MemorySearchResult[] = rows.map(row => {
    const snippet = row.content.length > 300
      ? row.content.substring(0, 300) + "..."
      : row.content;

    return {
      id: row.id,
      key: `${row.role}_message`,
      value: snippet,
      type: "conversation",
      chatId: row.chatId,
      citation: opts.citations
        ? `Source: chat/${row.chatId}#msg-${row.id}`
        : null,
      updatedAt: row.createdAt,
      score: computeRelevanceScore(query, row.content, ""),
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, opts.limit);
}

export const memorySearchTool: ToolDefinition = {
  name: "memory_search",
  description:
    "Search conversation memory and history for relevant past interactions, facts, preferences, and context. Returns matching memory entries with optional citations.",
  inputSchema: memorySearchSchema,
  capabilities: ["reads_files"],
  execute: async (input, context: ToolContext): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const [memoryResults, conversationResults] = await Promise.all([
        searchMemoryRecords(context.userId, input.query, {
          chatId: input.chatId,
          memoryType: input.memoryType,
          limit: input.limit,
          citations: input.citations,
        }),
        searchConversationHistory(context.userId, input.query, {
          chatId: input.chatId,
          limit: Math.ceil(input.limit / 2),
          citations: input.citations,
        }),
      ]);

      const combined = [...memoryResults, ...conversationResults];
      combined.sort((a, b) => b.score - a.score);
      const finalResults = combined.slice(0, input.limit);

      const formattedOutput = finalResults.map(r => ({
        key: r.key,
        value: r.value,
        type: r.type,
        score: Math.round(r.score * 100) / 100,
        ...(r.citation ? { citation: r.citation } : {}),
        ...(r.chatId ? { chatId: r.chatId } : {}),
      }));

      return {
        success: true,
        output: {
          query: input.query,
          totalResults: finalResults.length,
          results: formattedOutput,
        },
        artifacts: [],
        previews:
          finalResults.length > 0
            ? [
                {
                  type: "markdown" as const,
                  content: `### Memory Search: "${input.query}"\n\n${finalResults
                    .slice(0, 5)
                    .map(
                      (r, i) =>
                        `${i + 1}. **${r.key}** (${r.type}, score: ${Math.round(r.score * 100) / 100})\n   ${typeof r.value === "string" ? r.value.substring(0, 150) : JSON.stringify(r.value).substring(0, 150)}${r.citation ? `\n   _${r.citation}_` : ""}`
                    )
                    .join("\n\n")}`,
                  title: `Memory: ${input.query}`,
                },
              ]
            : [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("MEMORY_SEARCH_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

export const memoryGetTool: ToolDefinition = {
  name: "memory_get",
  description:
    "Retrieve a specific memory entry by its exact key. Returns the stored value and metadata.",
  inputSchema: memoryGetSchema,
  capabilities: ["reads_files"],
  execute: async (input, context: ToolContext): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const conditions = [
        eq(agentMemoryStore.userId, context.userId),
        eq(agentMemoryStore.memoryKey, input.memoryKey),
        ...(input.chatId ? [eq(agentMemoryStore.chatId, input.chatId)] : []),
      ];

      const rows = await db
        .select()
        .from(agentMemoryStore)
        .where(and(...conditions))
        .orderBy(desc(agentMemoryStore.updatedAt))
        .limit(1);

      if (rows.length === 0) {
        return {
          success: true,
          output: {
            found: false,
            key: input.memoryKey,
            message: `No memory entry found for key "${input.memoryKey}"`,
          },
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const record = rows[0];
      return {
        success: true,
        output: {
          found: true,
          key: record.memoryKey,
          value: record.memoryValue,
          type: record.memoryType,
          chatId: record.chatId,
          citation: formatCitation(record),
          updatedAt: record.updatedAt,
        },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("MEMORY_GET_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};
