import { z } from "zod";
import { toolRegistry, type ToolContext, type ToolResult, type ToolArtifact } from "../toolRegistry";
import { validateOrThrow } from "../validation";
import { metricsCollector } from "../metricsCollector";
import { retrievalPipeline, RetrievalPipeline } from "./retrievalPipeline";
import { RetrievalRequestSchema, type RetrievalRequest, type RetrievalPipelineResult } from "./types";
import { randomUUID } from "crypto";
import { getUserPrivacySettings } from "../../services/privacyService";

export * from "./types";
export * from "./canonicalizeUrl";
export * from "./hashContent";
export * from "./qualityScorer";
export * from "./searchAdapter";
export * from "./fetchAdapter";
export * from "./browserAdapter";
export * from "./retrievalPipeline";

const WebToolInputSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(20).optional().default(5),
  includeScholar: z.boolean().optional().default(false),
  preferBrowser: z.boolean().optional().default(false),
  extractReadable: z.boolean().optional().default(true),
  deduplicateByContent: z.boolean().optional().default(true),
  minQualityScore: z.number().min(0).max(500).optional().default(0),
  allowedDomains: z.array(z.string()).optional(),
  blockedDomains: z.array(z.string()).optional(),
});

async function executeWebTool(input: unknown, context: ToolContext): Promise<ToolResult> {
  const startTime = Date.now();
  const logs: ToolResult["logs"] = [];
  
  const addLog = (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => {
    logs.push({ level, message, timestamp: new Date(), data });
  };
  
  try {
    addLog("info", "Starting web retrieval", { query: (input as any)?.query });
    
    const validated = validateOrThrow(
      WebToolInputSchema,
      input,
      "WebTool.execute"
    );

    let privacy = { trainingOptIn: false, remoteBrowserDataAccess: false };
    try {
      privacy = await getUserPrivacySettings(context.userId);
    } catch (e: any) {
      addLog("warn", "Failed to load privacy settings; defaulting to fetch-only mode.", {
        error: e?.message || String(e),
      });
    }
    
    const request: RetrievalRequest = {
      query: validated.query,
      maxResults: validated.maxResults,
      includeScholar: validated.includeScholar,
      preferBrowser: privacy.remoteBrowserDataAccess ? validated.preferBrowser : false,
      allowBrowser: privacy.remoteBrowserDataAccess,
      extractReadable: validated.extractReadable,
      deduplicateByContent: validated.deduplicateByContent,
      minQualityScore: validated.minQualityScore,
      allowedDomains: validated.allowedDomains,
      blockedDomains: validated.blockedDomains,
      correlationId: context.correlationId,
    };

    if (!privacy.remoteBrowserDataAccess) {
      addLog("info", "Remote browser data access disabled by privacy settings; retrieval will avoid browser sessions (no cookies/DOM/screenshot session data).");
    }
    
    addLog("debug", "Executing retrieval pipeline", { request });
    
    const result = await retrievalPipeline.retrieve(request);
    
    addLog("info", "Retrieval completed", { 
      totalFound: result.totalFound,
      totalProcessed: result.totalProcessed,
      resultsReturned: result.results.length,
      timing: result.timing,
    });
    
    for (const error of result.errors) {
      addLog("warn", `Retrieval error at ${error.stage}`, { url: error.url, error: error.error });
    }
    
    const artifacts: ToolArtifact[] = result.results.map((r, index) => ({
      id: randomUUID(),
      type: "data" as const,
      name: `result-${index + 1}`,
      mimeType: "application/json",
      data: {
        url: r.url,
        canonicalUrl: r.canonicalUrl,
        title: r.title,
        snippet: r.snippet,
        qualityScore: r.qualityScore,
        contentHash: r.contentHash,
        fetchMethod: r.fetchMethod,
        metadata: r.metadata,
      },
      createdAt: new Date(),
    }));
    
    const contentArtifacts: ToolArtifact[] = result.results.map((r, index) => ({
      id: randomUUID(),
      type: "document" as const,
      name: `content-${index + 1}`,
      mimeType: "text/plain",
      data: r.content,
      size: r.content.length,
      createdAt: new Date(),
    }));
    
    const previews: ToolResult["previews"] = [
      {
        type: "markdown",
        title: `Search Results for "${validated.query}"`,
        content: formatResultsAsMarkdown(result),
      },
    ];
    
    const durationMs = Date.now() - startTime;
    
    metricsCollector.record({
      toolName: "web_tool",
      latencyMs: durationMs,
      success: result.success,
      timestamp: new Date(),
    });
    
    return {
      success: result.success,
      output: {
        query: result.query,
        results: result.results.map(r => ({
          url: r.url,
          canonicalUrl: r.canonicalUrl,
          title: r.title,
          snippet: r.snippet,
          content: r.content.slice(0, 5000),
          qualityScore: r.qualityScore.total,
          fetchMethod: r.fetchMethod,
        })),
        totalFound: result.totalFound,
        totalProcessed: result.totalProcessed,
        timing: result.timing,
      },
      artifacts: [...artifacts, ...contentArtifacts],
      previews,
      logs,
      metrics: {
        durationMs,
        apiCalls: result.totalProcessed,
        bytesProcessed: result.results.reduce((sum, r) => sum + r.content.length, 0),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;
    
    addLog("error", "Web tool execution failed", { error: errorMessage });
    
    metricsCollector.record({
      toolName: "web_tool",
      latencyMs: durationMs,
      success: false,
      errorCode: "EXECUTION_FAILED",
      timestamp: new Date(),
    });
    
    return {
      success: false,
      output: null,
      artifacts: [],
      previews: [],
      logs,
      metrics: { durationMs },
      error: {
        code: "EXECUTION_FAILED",
        message: errorMessage,
        retryable: true,
      },
    };
  }
}

function formatResultsAsMarkdown(result: RetrievalPipelineResult): string {
  if (result.results.length === 0) {
    return `No results found for "${result.query}".`;
  }
  
  let md = `## Search Results\n\n`;
  md += `Found **${result.totalFound}** results, processed **${result.totalProcessed}**, returning **${result.results.length}**.\n\n`;
  
  for (let i = 0; i < result.results.length; i++) {
    const r = result.results[i];
    md += `### ${i + 1}. ${r.title || "Untitled"}\n`;
    md += `**URL:** [${r.url}](${r.url})\n`;
    md += `**Quality Score:** ${r.qualityScore.total}/500\n`;
    md += `**Fetch Method:** ${r.fetchMethod}\n\n`;
    md += `> ${r.snippet || r.content.slice(0, 200)}...\n\n`;
  }
  
  md += `---\n`;
  md += `*Search completed in ${result.timing.totalMs}ms*\n`;
  
  return md;
}

export function registerWebTool(): void {
  toolRegistry.register({
    name: "web_search_retrieve",
    description: "Search the web and retrieve content from URLs. Supports academic search, content extraction with Readability, quality scoring, and deduplication.",
    inputSchema: WebToolInputSchema,
    capabilities: ["requires_network", "accesses_external_api", "long_running"],
    execute: executeWebTool,
  });
  
  console.log("[WebTool] Registered web_search_retrieve tool");
}

registerWebTool();
