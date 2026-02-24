import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolResult } from "../toolRegistry";
import { toolRegistry } from "../toolRegistry";
import {
  type ToolProfile,
  type SubscriptionTier,
  getCatalog,
  getCatalogSections,
  getCatalogSummary,
  getToolsForProfile,
  getProfileForTier,
  isToolAllowedForTier,
  filterToolDefinitionsByTier,
} from "./toolCatalog";
import {
  toolPolicyPipeline,
  resolveToolPolicyForPlan,
  isToolAvailableForPlan,
  getToolsForPlan,
  type UserPlan,
} from "./toolPolicy";
import { openclawWebSearch, clearSearchCache, getSearchCacheStats, WebSearchInputSchema } from "./tools/webSearch";
import { webFetch, clearWebFetchCache, WebFetchInputSchema } from "./tools/webFetch";
import { memorySearchTool, memoryGetTool } from "./tools/memoryTool";
import { getSubagentTools, getSubagentsForRun, countActiveForRun } from "./tools/subagentTool";
import {
  compactConversation,
  guardContextWindow,
  needsCompaction,
  type CompactionConfig,
  type ConversationMessage,
} from "./compaction";

const webSearchToolDef: ToolDefinition = {
  name: "web_search",
  description: "Search the web for current information using multiple providers (Grok, Gemini, DuckDuckGo) with automatic fallback",
  inputSchema: WebSearchInputSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const result = await openclawWebSearch(input);
      return {
        success: true,
        output: result,
        artifacts: [],
        previews: [{
          type: "markdown",
          content: result.results.map((r: any, i: number) =>
            `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet}`
          ).join("\n\n"),
          title: `Web Search: ${result.query}`,
        }],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return {
        success: false,
        output: null,
        error: { code: "SEARCH_ERROR", message: err.message, retryable: true },
      };
    }
  },
};

const webFetchToolDef: ToolDefinition = {
  name: "web_fetch",
  description: "Fetch and extract content from a URL, converting HTML to clean markdown or plain text with readability extraction",
  inputSchema: WebFetchInputSchema,
  async execute(input: any, context: ToolContext): Promise<ToolResult> {
    try {
      const result = await webFetch(input);
      return {
        success: result.success,
        output: result,
        artifacts: [],
        previews: result.success ? [{
          type: "markdown",
          content: (result.content || "").slice(0, 2000),
          title: `Fetched: ${result.url}`,
        }] : [],
        logs: [],
        metrics: { durationMs: 0 },
      };
    } catch (err: any) {
      return {
        success: false,
        output: null,
        error: { code: "FETCH_ERROR", message: err.message, retryable: true },
      };
    }
  },
};

let initialized = false;

export function initializeOpenClawTools(): void {
  if (initialized) return;

  const openclawTools: ToolDefinition[] = [
    webSearchToolDef,
    webFetchToolDef,
    memorySearchTool,
    memoryGetTool,
    ...getSubagentTools(),
  ];

  for (const tool of openclawTools) {
    try {
      toolRegistry.register(tool);
    } catch (err) {
      console.warn(`[OpenClaw] Tool ${tool.name} already registered, skipping`);
    }
  }

  initialized = true;
  console.log(`[OpenClaw] Initialized ${openclawTools.length} agentic tools`);
}

export function getOpenClawToolsForUser(plan: UserPlan): ToolDefinition[] {
  initializeOpenClawTools();
  return toolRegistry.listForLegacyPlan(plan);
}

export function getOpenClawToolDeclarations(plan: UserPlan) {
  const tools = getOpenClawToolsForUser(plan);
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

export function buildOpenClawSystemPromptSection(options: {
  citationsEnabled?: boolean;
  tier?: SubscriptionTier;
}): string {
  const sections: string[] = [];

  sections.push("## Memory Recall");
  sections.push(
    "Before answering questions about prior work, decisions, dates, people, preferences, or todos: use memory_search to recall relevant context."
  );
  if (options.citationsEnabled !== false) {
    sections.push("Include Source: <path#line> when citing memory snippets.");
  }
  sections.push("");

  sections.push("## Available Tools");
  const allowedTools = options.tier
    ? getToolsForProfile(getProfileForTier(options.tier))
    : getToolsForProfile("full");
  sections.push(`You have access to: ${allowedTools.join(", ")}`);
  sections.push("");

  sections.push("## Web Research");
  sections.push(
    "Use web_search for current information. Use web_fetch to extract content from URLs. Always verify information from multiple sources when possible."
  );
  sections.push("");

  if (options.tier === "pro") {
    sections.push("## Sub-Agents");
    sections.push(
      "For complex multi-step tasks, use subagent_spawn to delegate sub-tasks. Sub-agents run in parallel and report results back."
    );
    sections.push("");
  }

  return sections.join("\n");
}

export async function handleCompaction(
  messages: ConversationMessage[],
  overrides?: Partial<CompactionConfig>
): Promise<{ compacted: boolean; messages: ConversationMessage[]; summary?: string }> {
  if (!needsCompaction(messages, overrides)) {
    return { compacted: false, messages };
  }

  const result = await compactConversation(messages, overrides);
  return {
    compacted: true,
    messages: result.messages,
    summary: result.summary,
  };
}

export function getOpenClawStatus() {
  const searchStats = getSearchCacheStats();
  const catalog = getCatalogSummary();

  return {
    initialized,
    version: "1.0.0-openclaw-integration",
    tools: catalog,
    cache: {
      search: searchStats,
    },
  };
}

export {
  getCatalog,
  getCatalogSections,
  getCatalogSummary,
  getToolsForProfile,
  getProfileForTier,
  isToolAllowedForTier,
  filterToolDefinitionsByTier,
  toolPolicyPipeline,
  resolveToolPolicyForPlan,
  isToolAvailableForPlan,
  getToolsForPlan,
  clearSearchCache,
  clearWebFetchCache,
  compactConversation,
  guardContextWindow,
  needsCompaction,
  getSubagentsForRun,
  countActiveForRun,
};

export type { ToolProfile, SubscriptionTier, CompactionConfig, ConversationMessage, UserPlan };
