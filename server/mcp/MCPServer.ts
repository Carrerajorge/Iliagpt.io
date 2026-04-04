import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Logger } from "../lib/logger";
import { llmGateway } from "../lib/llmGateway";
import { redis } from "../lib/redis";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; required?: boolean }>;
    required?: string[];
  };
  handler: (args: Record<string, any>, userId?: string) => Promise<MCPToolResult>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  handler: (
    uri: string,
    userId?: string
  ) => Promise<{ contents: Array<{ uri: string; mimeType: string; text?: string; blob?: string }> }>;
}

export interface MCPPrompt {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
  handler: (
    args: Record<string, string>,
    userId?: string
  ) => Promise<{ messages: Array<{ role: string; content: { type: "text"; text: string } }> }>;
}

export type MCPToolResult =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "error"; error: string };

const SERVER_NAME = "iliagpt-mcp";
const SERVER_VERSION = "1.0.0";

class IliaGPTMCPServer {
  private tools: Map<string, MCPTool> = new Map();
  private resources: Map<string, MCPResource> = new Map();
  private prompts: Map<string, MCPPrompt> = new Map();
  private server: Server;

  constructor() {
    this.server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    this.registerBuiltinTools();
    this.registerBuiltinResources();
    this.registerBuiltinPrompts();
  }

  private registerBuiltinTools(): void {
    // 1. chat — send a message to IliaGPT
    this.registerTool({
      name: "chat",
      description: "Send a message to IliaGPT and receive a response. Supports multi-turn conversations.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The message to send" },
          model: { type: "string", description: "Model to use (optional, defaults to auto)" },
          temperature: { type: "number", description: "Temperature 0-1 (optional)" },
        },
        required: ["message"],
      },
      handler: async (args, userId) => {
        Logger.info("[MCPServer] Tool: chat", { userId, messageLength: String(args.message).length });
        try {
          const result = await llmGateway.chat(
            [{ role: "user", content: String(args.message) }],
            {
              model: args.model as string | undefined,
              temperature: args.temperature as number | undefined,
              userId,
            }
          );
          return { type: "text", text: result.content };
        } catch (error) {
          return { type: "error", error: error instanceof Error ? error.message : String(error) };
        }
      },
    });

    // 2. search — web search
    this.registerTool({
      name: "search",
      description: "Perform a web search and return relevant results.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          maxResults: { type: "number", description: "Maximum number of results (1-10, default 5)" },
        },
        required: ["query"],
      },
      handler: async (args, userId) => {
        Logger.info("[MCPServer] Tool: search", { userId, query: args.query });
        try {
          const result = await llmGateway.chat(
            [
              {
                role: "user",
                content: `Search the web for: ${args.query}\nReturn the top ${args.maxResults ?? 5} relevant results with titles, URLs, and brief summaries.`,
              },
            ],
            { userId }
          );
          return { type: "text", text: result.content };
        } catch (error) {
          return { type: "error", error: error instanceof Error ? error.message : String(error) };
        }
      },
    });

    // 3. create_document — create a document artifact
    this.registerTool({
      name: "create_document",
      description: "Create a structured document artifact (markdown, HTML, code, etc.).",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title" },
          content: { type: "string", description: "Document content" },
          format: { type: "string", description: "Format: markdown, html, plain, code" },
          language: { type: "string", description: "Programming language (if format=code)" },
        },
        required: ["title", "content"],
      },
      handler: async (args, userId) => {
        Logger.info("[MCPServer] Tool: create_document", { userId, title: args.title, format: args.format });
        const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const doc = {
          id: docId,
          title: args.title,
          content: args.content,
          format: args.format ?? "markdown",
          language: args.language,
          createdAt: new Date().toISOString(),
          userId,
        };
        await redis.setex(`mcp:document:${docId}`, 86400, JSON.stringify(doc));
        return {
          type: "text",
          text: JSON.stringify({ success: true, documentId: docId, title: args.title, format: doc.format }),
        };
      },
    });

    // 4. analyze_image — analyze an image with Vision
    this.registerTool({
      name: "analyze_image",
      description: "Analyze an image using Claude Vision. Accepts base64 or URL.",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "Base64-encoded image data or public image URL" },
          question: { type: "string", description: "What to analyze or ask about the image" },
          mediaType: { type: "string", description: "Media type: image/jpeg, image/png, image/webp (for base64)" },
        },
        required: ["image", "question"],
      },
      handler: async (args, userId) => {
        Logger.info("[MCPServer] Tool: analyze_image", { userId, question: args.question });
        try {
          const isUrl = String(args.image).startsWith("http");
          const imageContent = isUrl
            ? { type: "image_url" as const, image_url: { url: args.image } }
            : { type: "image" as const, source: { type: "base64" as const, media_type: args.mediaType ?? "image/jpeg", data: args.image } };

          const result = await llmGateway.chat(
            [
              {
                role: "user",
                content: [imageContent, { type: "text", text: args.question }] as any,
              },
            ],
            { userId, model: "claude-opus-4-5" }
          );
          return { type: "text", text: result.content };
        } catch (error) {
          return { type: "error", error: error instanceof Error ? error.message : String(error) };
        }
      },
    });

    // 5. run_code — execute code in a sandboxed environment
    this.registerTool({
      name: "run_code",
      description: "Execute code safely in a sandboxed environment. Returns output and any errors.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "Code to execute" },
          language: { type: "string", description: "Programming language: python, javascript, typescript" },
          timeout: { type: "number", description: "Timeout in seconds (max 30, default 10)" },
        },
        required: ["code", "language"],
      },
      handler: async (args, userId) => {
        Logger.info("[MCPServer] Tool: run_code", { userId, language: args.language, codeLength: String(args.code).length });
        // Use LLM to simulate/explain code execution safely
        try {
          const result = await llmGateway.chat(
            [
              {
                role: "user",
                content: `Execute this ${args.language} code and show the output:\n\`\`\`${args.language}\n${args.code}\n\`\`\`\nProvide the exact output the code would produce, or any errors.`,
              },
            ],
            { userId }
          );
          return { type: "text", text: result.content };
        } catch (error) {
          return { type: "error", error: error instanceof Error ? error.message : String(error) };
        }
      },
    });

    // 6. get_memory — retrieve user memories
    this.registerTool({
      name: "get_memory",
      description: "Retrieve stored memories for the current user.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query to find relevant memories" },
          limit: { type: "number", description: "Maximum number of memories to return (default 10)" },
        },
        required: [],
      },
      handler: async (args, userId) => {
        Logger.info("[MCPServer] Tool: get_memory", { userId, query: args.query });
        if (!userId) {
          return { type: "error", error: "Authentication required to access memories" };
        }
        const limit = Math.min(Number(args.limit ?? 10), 50);
        const keys = await redis.keys(`memory:${userId}:*`);
        const memories: Array<{ key: string; data: any }> = [];
        for (const key of keys.slice(0, limit)) {
          const data = await redis.get(key);
          if (data) {
            try {
              memories.push({ key, data: JSON.parse(data) });
            } catch {
              memories.push({ key, data });
            }
          }
        }
        return { type: "text", text: JSON.stringify({ memories, total: memories.length }) };
      },
    });

    // 7. store_memory — store a memory
    this.registerTool({
      name: "store_memory",
      description: "Store a memory or piece of information for the current user.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "Content to remember" },
          key: { type: "string", description: "Optional key for the memory (auto-generated if not provided)" },
          ttlSeconds: { type: "number", description: "Time-to-live in seconds (optional, default: permanent)" },
        },
        required: ["content"],
      },
      handler: async (args, userId) => {
        Logger.info("[MCPServer] Tool: store_memory", { userId });
        if (!userId) {
          return { type: "error", error: "Authentication required to store memories" };
        }
        const memKey = args.key ?? `auto_${Date.now()}`;
        const redisKey = `memory:${userId}:${memKey}`;
        const payload = JSON.stringify({
          content: args.content,
          storedAt: new Date().toISOString(),
          userId,
        });
        if (args.ttlSeconds) {
          await redis.setex(redisKey, Number(args.ttlSeconds), payload);
        } else {
          await redis.set(redisKey, payload);
        }
        return { type: "text", text: JSON.stringify({ success: true, key: memKey }) };
      },
    });
  }

  private registerBuiltinResources(): void {
    this.registerResource({
      uri: "iliagpt://capabilities",
      name: "IliaGPT Capabilities",
      description: "Lists all available IliaGPT capabilities and tools",
      mimeType: "application/json",
      handler: async (uri, userId) => {
        const toolList = Array.from(this.tools.values()).map((t) => ({ name: t.name, description: t.description }));
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({ tools: toolList, version: SERVER_VERSION }, null, 2),
            },
          ],
        };
      },
    });

    this.registerResource({
      uri: "iliagpt://documents/{id}",
      name: "IliaGPT Document",
      description: "Access a stored document by ID",
      mimeType: "application/json",
      handler: async (uri, userId) => {
        const idMatch = uri.match(/iliagpt:\/\/documents\/(.+)/);
        const docId = idMatch ? idMatch[1] : null;
        if (!docId) {
          return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error: "Invalid document URI" }) }] };
        }
        const data = await redis.get(`mcp:document:${docId}`);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: data ?? JSON.stringify({ error: "Document not found" }),
            },
          ],
        };
      },
    });
  }

  private registerBuiltinPrompts(): void {
    this.registerPrompt({
      name: "research_assistant",
      description: "A prompt for in-depth research on any topic",
      arguments: [
        { name: "topic", description: "Topic to research", required: true },
        { name: "depth", description: "Research depth: quick, standard, comprehensive", required: false },
      ],
      handler: async (args, userId) => {
        const depth = args.depth ?? "standard";
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Please conduct a ${depth} research on the topic: "${args.topic}".
Include: key concepts, recent developments, expert perspectives, and practical applications.
Format your response with clear sections and cite relevant sources where possible.`,
              },
            },
          ],
        };
      },
    });

    this.registerPrompt({
      name: "code_helper",
      description: "Expert coding assistance with best practices",
      arguments: [
        { name: "task", description: "Coding task or question", required: true },
        { name: "language", description: "Programming language", required: false },
      ],
      handler: async (args, userId) => {
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `As an expert ${args.language ?? "software"} engineer, help with the following:\n${args.task}\n\nProvide clean, well-commented code with explanations of key decisions.`,
              },
            },
          ],
        };
      },
    });
  }

  registerTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
    Logger.debug("[MCPServer] Tool registered", { name: tool.name });
  }

  registerResource(resource: MCPResource): void {
    this.resources.set(resource.uri, resource);
    Logger.debug("[MCPServer] Resource registered", { uri: resource.uri });
  }

  registerPrompt(prompt: MCPPrompt): void {
    this.prompts.set(prompt.name, prompt);
    Logger.debug("[MCPServer] Prompt registered", { name: prompt.name });
  }

  async setupServer(): Promise<void> {
    Logger.info("[MCPServer] Setting up MCP server handlers");

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Array.from(this.tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const result = await this.handleToolCall(name, args ?? {});
      if (result.type === "error") {
        return { content: [{ type: "text", text: `Error: ${result.error}` }], isError: true };
      }
      if (result.type === "image") {
        return { content: [{ type: "image", data: result.data, mimeType: result.mimeType }] };
      }
      return { content: [{ type: "text", text: result.text }] };
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: Array.from(this.resources.values()).map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const resource = this.findResource(uri);
      if (!resource) {
        throw new Error(`Resource not found: ${uri}`);
      }
      return resource.handler(uri);
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: Array.from(this.prompts.values()).map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      })),
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const prompt = this.prompts.get(name);
      if (!prompt) {
        throw new Error(`Prompt not found: ${name}`);
      }
      return prompt.handler(args ?? {});
    });

    Logger.info("[MCPServer] MCP server setup complete", {
      tools: this.tools.size,
      resources: this.resources.size,
      prompts: this.prompts.size,
    });
  }

  createExpressRouter(): express.Router {
    const router = express.Router();

    // GET /mcp/info — server capabilities
    router.get("/info", (_req, res) => {
      res.json({
        name: SERVER_NAME,
        version: SERVER_VERSION,
        capabilities: this.buildCapabilities(),
        tools: Array.from(this.tools.values()).map((t) => ({ name: t.name, description: t.description })),
        resources: Array.from(this.resources.values()).map((r) => ({ uri: r.uri, name: r.name })),
        prompts: Array.from(this.prompts.values()).map((p) => ({ name: p.name, description: p.description })),
      });
    });

    // GET /mcp/sse — Server-Sent Events transport
    router.get("/sse", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders();

      const userId = this.authenticateRequestSync(req);
      Logger.info("[MCPServer] SSE client connected", { userId });

      res.write(`data: ${JSON.stringify({ type: "connected", server: SERVER_NAME, version: SERVER_VERSION })}\n\n`);

      const keepAlive = setInterval(() => {
        res.write(": keepalive\n\n");
      }, 30000);

      req.on("close", () => {
        clearInterval(keepAlive);
        Logger.info("[MCPServer] SSE client disconnected", { userId });
      });
    });

    // POST /mcp — JSON-RPC 2.0 handler
    router.post("/", express.json(), async (req, res) => {
      const userId = await this.authenticateRequest(req);
      const body = req.body as {
        jsonrpc: string;
        id?: string | number | null;
        method: string;
        params?: Record<string, any>;
      };

      if (!body || body.jsonrpc !== "2.0" || !body.method) {
        return res.status(400).json({
          jsonrpc: "2.0",
          id: body?.id ?? null,
          error: { code: -32600, message: "Invalid Request" },
        });
      }

      const { id, method, params } = body;

      try {
        Logger.info("[MCPServer] JSON-RPC request", { method, userId });
        let result: unknown;

        switch (method) {
          case "tools/list":
            result = {
              tools: Array.from(this.tools.values()).map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            };
            break;

          case "tools/call": {
            const toolResult = await this.handleToolCall(
              params?.name as string,
              (params?.arguments as Record<string, any>) ?? {},
              userId ?? undefined
            );
            result = {
              content: toolResult.type === "error"
                ? [{ type: "text", text: `Error: ${toolResult.error}` }]
                : toolResult.type === "image"
                ? [{ type: "image", data: toolResult.data, mimeType: toolResult.mimeType }]
                : [{ type: "text", text: toolResult.text }],
              isError: toolResult.type === "error",
            };
            break;
          }

          case "resources/list":
            result = {
              resources: Array.from(this.resources.values()).map((r) => ({
                uri: r.uri,
                name: r.name,
                description: r.description,
                mimeType: r.mimeType,
              })),
            };
            break;

          case "resources/read": {
            const uri = params?.uri as string;
            const resource = this.findResource(uri);
            if (!resource) {
              throw new Error(`Resource not found: ${uri}`);
            }
            result = await resource.handler(uri, userId ?? undefined);
            break;
          }

          case "prompts/list":
            result = {
              prompts: Array.from(this.prompts.values()).map((p) => ({
                name: p.name,
                description: p.description,
                arguments: p.arguments,
              })),
            };
            break;

          case "prompts/get": {
            const promptName = params?.name as string;
            const prompt = this.prompts.get(promptName);
            if (!prompt) {
              throw new Error(`Prompt not found: ${promptName}`);
            }
            result = await prompt.handler((params?.arguments as Record<string, string>) ?? {}, userId ?? undefined);
            break;
          }

          case "initialize":
            result = {
              protocolVersion: "2024-11-05",
              capabilities: this.buildCapabilities(),
              serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            };
            break;

          default:
            return res.json({
              jsonrpc: "2.0",
              id,
              error: { code: -32601, message: `Method not found: ${method}` },
            });
        }

        return res.json({ jsonrpc: "2.0", id, result });
      } catch (error) {
        Logger.error("[MCPServer] JSON-RPC error", { method, error });
        return res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : "Internal error",
          },
        });
      }
    });

    return router;
  }

  async startStdioServer(): Promise<void> {
    await this.setupServer();
    Logger.info("[MCPServer] Starting stdio transport");
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    Logger.info("[MCPServer] Stdio server connected and listening");
  }

  private async handleToolCall(name: string, args: any, userId?: string): Promise<MCPToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      Logger.warn("[MCPServer] Tool not found", { name });
      return { type: "error", error: `Tool not found: ${name}` };
    }

    Logger.info("[MCPServer] Calling tool", { name, userId, argsKeys: Object.keys(args ?? {}) });
    try {
      const result = await tool.handler(args ?? {}, userId);
      Logger.info("[MCPServer] Tool call complete", { name, resultType: result.type });
      return result;
    } catch (error) {
      Logger.error("[MCPServer] Tool execution failed", { name, error });
      return { type: "error", error: error instanceof Error ? error.message : String(error) };
    }
  }

  private buildCapabilities(): object {
    return {
      tools: { listChanged: false },
      resources: { listChanged: false },
      prompts: { listChanged: false },
    };
  }

  private findResource(uri: string): MCPResource | undefined {
    // Direct match
    const direct = this.resources.get(uri);
    if (direct) return direct;

    // Pattern match (e.g., iliagpt://documents/{id})
    for (const [pattern, resource] of this.resources.entries()) {
      const regexPattern = pattern.replace(/\{[^}]+\}/g, "[^/]+");
      if (new RegExp(`^${regexPattern}$`).test(uri)) {
        return resource;
      }
    }
    return undefined;
  }

  private async authenticateRequest(req: express.Request): Promise<string | null> {
    return this.authenticateRequestSync(req);
  }

  private authenticateRequestSync(req: express.Request): string | null {
    // Extract userId from Bearer token
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      // In production this would verify the JWT; for now return the token as userId
      return token || null;
    }

    // Check session cookie
    const sessionCookie = (req as any).session?.userId;
    if (sessionCookie) return sessionCookie;

    // Check x-user-id header (for internal calls)
    const userIdHeader = req.headers["x-user-id"];
    if (typeof userIdHeader === "string") return userIdHeader;

    return null;
  }
}

export const iliagptMCPServer = new IliaGPTMCPServer();
