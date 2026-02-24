import { z } from "zod";
import { type ToolDefinition, type ToolContext, type ToolResult } from "../toolRegistry";
import { SemanticMemoryStore } from "../../memory/SemanticMemoryStore";

const memoryStore = new SemanticMemoryStore();
// Ensure it's initialized
memoryStore.initialize().catch(console.error);

export const memorySearchTool: ToolDefinition = {
    name: "memory_search",
    description: "Search the user's semantic memory and past sessions to retrieve context, facts, or instructions. Use this tool when you need to remember past interactions, look up user preferences, or find relevant historical information.",
    inputSchema: z.object({
        query: z.string().describe("The search query or concept to look for in memory."),
        limit: z.number().int().min(1).max(20).optional().describe("Maximum number of results to return. Default is 5."),
        hybridSearch: z.boolean().optional().describe("Whether to use both keyword and semantic search. Default is true."),
    }),
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
        try {
            const results = await memoryStore.search(
                context.userId || "anonymous",
                input.query,
                {
                    limit: input.limit || 5,
                    hybridSearch: input.hybridSearch ?? true
                }
            );

            if (!results || results.length === 0) {
                return {
                    success: true,
                    output: "No relevant memories found for this query.",
                };
            }

            // Format the results for the LLM
            const formattedResults = results.map((result: any, i: number) => {
                const date = result.chunk.createdAt ? new Date(result.chunk.createdAt).toLocaleDateString() : 'Unknown date';
                return `[${i + 1}] (${date}) - Confidence: ${Math.round(result.score * 100)}% - Type: ${result.chunk.type}\\n${result.chunk.content}`;
            }).join("\\n\\n");

            return {
                success: true,
                output: `Found ${results.length} relevant memories:\\n\\n${formattedResults}`,
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                error: {
                    code: "MEMORY_SEARCH_ERROR",
                    message: error.message || "Failed to search memory.",
                    retryable: true,
                },
            };
        }
    },
};
