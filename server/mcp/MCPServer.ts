/**
 * MCPServer — exposes IliaGPT as an MCP (Model Context Protocol) server.
 * Tools: search, rag_query, memory_search, code_execute, document_analyze.
 * Resources: user documents, conversation history, knowledge graph.
 * JSON-RPC 2.0 transport over HTTP/SSE.
 */

import { EventEmitter } from "events";
import { createLogger } from "../utils/logger";
import { AppError } from "../utils/errors";
import { multiSearchProvider } from "../search/MultiSearchProvider";
import { pgVectorMemoryStore } from "../memory/PgVectorMemoryStore";
import { sharedKnowledgeGraph } from "../memory/SharedKnowledgeGraph";

const logger = createLogger("MCPServer");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPromptTemplate {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description: string; required: boolean }>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface MCPServerConfig {
  serverName?: string;
  serverVersion?: string;
  requireAuth?: boolean;
  authToken?: string;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS: MCPTool[] = [
  {
    name: "search",
    description: "Search the web across multiple providers (DuckDuckGo, Brave, Tavily, Bing). Returns relevant results with titles, URLs, and snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Maximum number of results (default: 10)" },
        providers: { type: "string", description: "Comma-separated list of providers to use" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_search",
    description: "Search stored memories and past conversation facts. Use this to recall what was discussed before.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for in memory" },
        userId: { type: "string", description: "Optional user ID to filter memories" },
        conversationId: { type: "string", description: "Optional conversation ID to filter memories" },
        memoryType: {
          type: "string",
          description: "Type of memory to filter",
          enum: ["fact", "preference", "action_item", "decision", "entity", "skill", "ephemeral"],
        },
        limit: { type: "number", description: "Maximum memories to return (default: 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "store_memory",
    description: "Store a new memory or fact for future recall.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The memory content to store" },
        memoryType: { type: "string", description: "Type: fact, preference, action_item, decision, entity, skill, ephemeral" },
        userId: { type: "string", description: "Optional user ID to associate memory with" },
        importance: { type: "number", description: "Importance score 0-1 (default: 0.5)" },
      },
      required: ["content"],
    },
  },
  {
    name: "knowledge_graph_query",
    description: "Query the shared knowledge graph for entities and their relationships.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Entity name to look up" },
        operation: {
          type: "string",
          description: "Operation: find_related, all_facts, search_nodes",
          enum: ["find_related", "all_facts", "search_nodes"],
        },
      },
      required: ["entity", "operation"],
    },
  },
  {
    name: "document_analyze",
    description: "Analyze a document file. Extracts text, structure, tables, and key information.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Absolute path to the document file" },
        extractText: { type: "string", description: "Return extracted text: true/false" },
        generateSummary: { type: "string", description: "Generate summary: true/false" },
      },
      required: ["filePath"],
    },
  },
];

// ─── Resource Definitions ─────────────────────────────────────────────────────

const RESOURCES: MCPResource[] = [
  {
    uri: "iliagpt://knowledge-graph",
    name: "Knowledge Graph",
    description: "Cross-agent shared knowledge graph with entity relationships",
    mimeType: "application/json",
  },
  {
    uri: "iliagpt://conversation-memories",
    name: "Conversation Memories",
    description: "Stored memories and facts from past conversations",
    mimeType: "application/json",
  },
];

// ─── Prompt Templates ─────────────────────────────────────────────────────────

const PROMPTS: MCPPromptTemplate[] = [
  {
    name: "research_assistant",
    description: "Research a topic comprehensively using web search and knowledge graph",
    arguments: [
      { name: "topic", description: "Topic to research", required: true },
      { name: "depth", description: "Research depth: quick, medium, deep", required: false },
    ],
  },
  {
    name: "code_review",
    description: "Perform a comprehensive code review with security and quality analysis",
    arguments: [
      { name: "code", description: "Code to review", required: true },
      { name: "language", description: "Programming language", required: false },
    ],
  },
  {
    name: "summarize_document",
    description: "Analyze and summarize a document",
    arguments: [
      { name: "file_path", description: "Path to document", required: true },
    ],
  },
];

// ─── Tool Handlers ────────────────────────────────────────────────────────────

async function handleSearch(params: Record<string, unknown>): Promise<unknown> {
  const query = String(params["query"] ?? "");
  const maxResults = Number(params["maxResults"] ?? 10);

  const result = await multiSearchProvider.searchMultiProvider({ query, maxResults });
  return {
    results: result.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      publishedAt: r.publishedAt,
    })),
    totalResults: result.results.length,
    providers: result.providers,
  };
}

async function handleMemorySearch(params: Record<string, unknown>): Promise<unknown> {
  const memories = await pgVectorMemoryStore.search({
    query: String(params["query"] ?? ""),
    userId: params["userId"] as string | undefined,
    conversationId: params["conversationId"] as string | undefined,
    memoryType: params["memoryType"] as string | undefined as never,
    limit: Number(params["limit"] ?? 5),
  });

  return {
    memories: memories.map((m) => ({
      id: m.id,
      content: m.content,
      memoryType: m.memoryType,
      importance: m.importance,
      createdAt: m.createdAt.toISOString(),
      similarity: m.similarity,
    })),
    count: memories.length,
  };
}

async function handleStoreMemory(params: Record<string, unknown>): Promise<unknown> {
  const id = await pgVectorMemoryStore.store({
    content: String(params["content"] ?? ""),
    memoryType: (params["memoryType"] as string ?? "fact") as never,
    userId: params["userId"] as string | undefined,
    importance: Number(params["importance"] ?? 0.5),
  });
  return { id, stored: true };
}

async function handleKnowledgeGraph(params: Record<string, unknown>): Promise<unknown> {
  const entity = String(params["entity"] ?? "");
  const operation = String(params["operation"] ?? "find_related");

  switch (operation) {
    case "find_related": {
      const result = await sharedKnowledgeGraph.findRelated(entity);
      return {
        entity: result.entity.name,
        related: result.related.map((r) => ({
          name: r.node.name,
          type: r.node.nodeType,
          relationship: r.relationship,
          direction: r.direction,
        })),
      };
    }
    case "all_facts": {
      const facts = await sharedKnowledgeGraph.getAllFactsAbout(entity);
      return { entity, facts };
    }
    case "search_nodes": {
      const nodes = await sharedKnowledgeGraph.searchNodes(entity);
      return { query: entity, nodes: nodes.map((n) => ({ name: n.name, type: n.nodeType, accessCount: n.accessCount })) };
    }
    default:
      throw new AppError(`Unknown operation: ${operation}`, 400, "UNKNOWN_OPERATION");
  }
}

async function handleDocumentAnalyze(params: Record<string, unknown>): Promise<unknown> {
  const filePath = String(params["filePath"] ?? "");
  const generateSummary = params["generateSummary"] === "true";

  const { documentIntelligencePipeline } = await import("../multimodal/DocumentIntelligencePipeline");
  const analysis = await documentIntelligencePipeline.analyzeFile(filePath, { generateSummary });

  return {
    title: analysis.title,
    format: analysis.format,
    wordCount: analysis.wordCount,
    sections: analysis.sections.length,
    tables: analysis.tables.length,
    summary: analysis.summary,
    keyTopics: analysis.keyTopics.slice(0, 10),
    text: params["extractText"] === "true" ? analysis.fullText.slice(0, 5_000) : undefined,
  };
}

// ─── MCPServer ────────────────────────────────────────────────────────────────

export class MCPServer extends EventEmitter {
  private config: Required<MCPServerConfig>;

  constructor(config: MCPServerConfig = {}) {
    super();
    this.config = {
      serverName: config.serverName ?? "IliaGPT",
      serverVersion: config.serverVersion ?? "1.0.0",
      requireAuth: config.requireAuth ?? false,
      authToken: config.authToken ?? (process.env.MCP_AUTH_TOKEN ?? ""),
    };
  }

  async handleRequest(request: JsonRpcRequest, authHeader?: string): Promise<JsonRpcResponse> {
    // Auth check
    if (this.config.requireAuth && this.config.authToken) {
      const token = authHeader?.replace("Bearer ", "");
      if (token !== this.config.authToken) {
        return this.errorResponse(request.id, -32001, "Unauthorized");
      }
    }

    try {
      const result = await this.dispatch(request);
      return { jsonrpc: "2.0", id: request.id, result };
    } catch (err) {
      const appErr = err instanceof AppError ? err : null;
      logger.error(`MCP request error: ${request.method}`, err);
      return this.errorResponse(
        request.id,
        appErr ? appErr.statusCode : -32603,
        (err as Error).message
      );
    }
  }

  private async dispatch(request: JsonRpcRequest): Promise<unknown> {
    const params = request.params ?? {};

    switch (request.method) {
      case "initialize":
        return {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {}, resources: { subscribe: false }, prompts: {} },
          serverInfo: { name: this.config.serverName, version: this.config.serverVersion },
        };

      case "tools/list":
        return { tools: TOOLS };

      case "tools/call": {
        const toolName = String(params["name"] ?? "");
        const toolArgs = (params["arguments"] as Record<string, unknown>) ?? {};

        logger.info(`MCP tool call: ${toolName}`);
        this.emit("toolCall", { tool: toolName, args: toolArgs });

        switch (toolName) {
          case "search": return handleSearch(toolArgs);
          case "memory_search": return handleMemorySearch(toolArgs);
          case "store_memory": return handleStoreMemory(toolArgs);
          case "knowledge_graph_query": return handleKnowledgeGraph(toolArgs);
          case "document_analyze": return handleDocumentAnalyze(toolArgs);
          default:
            throw new AppError(`Unknown tool: ${toolName}`, 404, "TOOL_NOT_FOUND");
        }
      }

      case "resources/list":
        return { resources: RESOURCES };

      case "resources/read": {
        const uri = String(params["uri"] ?? "");
        if (uri === "iliagpt://knowledge-graph") {
          const stats = await sharedKnowledgeGraph.getStats();
          return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(stats) }] };
        }
        if (uri === "iliagpt://conversation-memories") {
          return {
            contents: [{
              uri,
              mimeType: "application/json",
              text: JSON.stringify({ message: "Use memory_search tool to query memories" }),
            }],
          };
        }
        throw new AppError(`Resource not found: ${uri}`, 404, "RESOURCE_NOT_FOUND");
      }

      case "prompts/list":
        return { prompts: PROMPTS };

      case "prompts/get": {
        const name = String(params["name"] ?? "");
        const args = (params["arguments"] as Record<string, string>) ?? {};
        const prompt = PROMPTS.find((p) => p.name === name);
        if (!prompt) throw new AppError(`Prompt not found: ${name}`, 404, "PROMPT_NOT_FOUND");

        return {
          description: prompt.description,
          messages: [this.buildPromptMessage(name, args)],
        };
      }

      case "ping":
        return { pong: true };

      default:
        return this.errorResponse(null, -32601, `Method not found: ${request.method}`);
    }
  }

  private buildPromptMessage(name: string, args: Record<string, string>): { role: string; content: { type: string; text: string } } {
    const templates: Record<string, string> = {
      research_assistant: `Research the following topic thoroughly: ${args["topic"] ?? ""}. Use web search to find current information, then synthesize the findings. Depth: ${args["depth"] ?? "medium"}.`,
      code_review: `Review this code for quality, security, and best practices:\n\n${args["code"] ?? ""}${args["language"] ? `\nLanguage: ${args["language"]}` : ""}`,
      summarize_document: `Analyze and summarize the document at: ${args["file_path"] ?? ""}. Extract key information, main topics, and provide a concise summary.`,
    };

    return {
      role: "user",
      content: { type: "text", text: templates[name] ?? `Execute prompt: ${name}` },
    };
  }

  private errorResponse(
    id: string | number | null,
    code: number,
    message: string
  ): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }

  // HTTP/SSE handler for Express integration
  expressHandler() {
    const self = this;
    return async (req: { headers: Record<string, string>; body: JsonRpcRequest }, res: {
      setHeader: (k: string, v: string) => void;
      json: (data: unknown) => void;
      status: (code: number) => { json: (data: unknown) => void };
    }) => {
      const authHeader = req.headers["authorization"] ?? "";
      const response = await self.handleRequest(req.body, authHeader);
      res.setHeader("Content-Type", "application/json");
      res.json(response);
    };
  }
}

export const mcpServer = new MCPServer({
  serverName: "IliaGPT",
  serverVersion: "1.0.0",
  requireAuth: !!process.env.MCP_AUTH_TOKEN,
  authToken: process.env.MCP_AUTH_TOKEN,
});
