import { ToolDefinition, ExecutionContext, ToolResult } from "../types";
import { searchWeb as simpleSearchWeb } from "../../../services/webSearch";

export const searchWebTool: ToolDefinition = {
  id: "search_web",
  name: "Search Web",
  description: "Search the web using a search engine and return results",
  category: "web",
  capabilities: ["search", "find", "lookup", "query", "google", "web search", "noticias", "news"],
  inputSchema: {
    query: { type: "string", description: "The search query", required: true },
    maxResults: { type: "number", description: "Maximum results to return", default: 5 }
  },
  outputSchema: {
    results: { type: "array", description: "Search results with title, url, snippet" },
    query: { type: "string", description: "The executed query" },
    webSources: { type: "array", description: "Web sources for citations" }
  },
  timeout: 30000,
  
  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { query, maxResults = 5 } = params;
    
    if (!query) {
      return {
        success: false,
        error: "No search query provided"
      };
    }

    try {
      context.onProgress({
        runId: context.runId,
        stepId: `search_${context.stepIndex}`,
        status: "progress",
        message: `Searching for: ${query}`,
        progress: 30
      });

      const searchResponse = await simpleSearchWeb(query, maxResults);
      
      const results = searchResponse.results.slice(0, maxResults).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet || ""
      }));

      const webSources = results.map(r => {
        let domain = "";
        try {
          domain = new URL(r.url).hostname.replace(/^www\./, "");
        } catch {
          domain = r.url.split("/")[2]?.replace(/^www\./, "") || "unknown";
        }
        return {
          url: r.url,
          title: r.title,
          domain,
          favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
          snippet: r.snippet || ""
        };
      });

      const textContent = searchResponse.contents.length > 0
        ? searchResponse.contents.map(c => `## ${c.title}\n\n${c.content}`).join("\n\n---\n\n")
        : results.map(r => `**${r.title}**\n${r.snippet}\nURL: ${r.url}`).join("\n\n");

      context.onProgress({
        runId: context.runId,
        stepId: `search_${context.stepIndex}`,
        status: "completed",
        message: `Found ${results.length} results`,
        progress: 100
      });

      return {
        success: true,
        data: {
          query,
          results,
          webSources,
          textContent,
          totalFound: results.length
        },
        metadata: {
          query,
          resultsCount: results.length,
          contentsExtracted: searchResponse.contents.length
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
};
