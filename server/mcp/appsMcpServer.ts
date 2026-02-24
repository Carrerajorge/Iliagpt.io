import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getUserId } from "../types/express";
import { storage } from "../storage";
import { aiLimiter } from "../middleware/rateLimiter";
import { connectorRegistry } from "../integrations/kernel/connectorRegistry";

type McpRequest = {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

type McpResponse = {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: Record<string, unknown>;
  };
};

const mcpRequestSchema = z.object({
  jsonrpc: z.literal("2.0").or(z.string().transform(() => "2.0" as const)),
  id: z.union([z.string().min(1), z.number().int(), z.null()]).optional(),
  method: z.string().trim().min(1).max(64),
  params: z.record(z.unknown()).optional(),
}).strict();

const toolCallSchema = z.object({
  tool: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(64).optional(),
  arguments: z.record(z.unknown()).optional().default({}),
  confirmed: z.boolean().optional(),
}).strict().refine((value) => Boolean(value.tool || value.name), {
  message: "tool or name is required",
}).transform((value) => ({
  tool: value.tool || value.name!,
  arguments: value.arguments || {},
  confirmed: value.confirmed === true,
}));

function resolveUserPlan(user: { role?: string | null; plan?: string | null } | undefined): "free" | "pro" | "admin" {
  if (user?.role === "admin") return "admin";
  const plan = String(user?.plan || "").toLowerCase().trim();
  if (plan === "pro" || plan === "enterprise") return "pro";
  return "free";
}

function listConnectorTools(): Array<{
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
}> {
  const tools: Array<{ name: string; description: string; inputSchema: unknown; outputSchema?: unknown }> = [];

  for (const manifest of connectorRegistry.listEnabled()) {
    for (const cap of manifest.capabilities || []) {
      tools.push({
        name: cap.operationId,
        description: cap.description || `${manifest.displayName || manifest.connectorId}: ${cap.operationId}`,
        inputSchema: cap.inputSchema || { type: "object", properties: {} },
        outputSchema: (cap as any).outputSchema,
      });
    }
  }

  return tools;
}

async function executeConnectorTool(
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
  confirmed: boolean
) {
  // Ensure the tool exists in the connector registry (apps MCP only exposes connector tools).
  const connectorId = connectorRegistry.resolveConnectorId(toolName);
  if (!connectorId) {
    const err = new Error("Unknown tool");
    (err as any).code = "UNKNOWN_TOOL";
    throw err;
  }

  const user = await storage.getUser(userId);
  const userPlan = resolveUserPlan(user);

  const { toolRegistry } = await import("../agent/toolRegistry");
  return await toolRegistry.execute(toolName, args, {
    userId,
    chatId: "mcp",
    runId: randomUUID(),
    userPlan,
    isConfirmed: confirmed,
  });
}

export function createAppsMcpRouter(): Router {
  const router = Router();

  router.get("/tools", aiLimiter, (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId || String(userId).startsWith("anon_")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.json({ tools: listConnectorTools() });
  });

  router.post("/tools/call", aiLimiter, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId || String(userId).startsWith("anon_")) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const params = toolCallSchema.parse(req.body || {});
      const toolResult = await executeConnectorTool(userId, params.tool, params.arguments, params.confirmed);
      if (!toolResult.success) {
        res.status(500).json({
          error: toolResult.error?.message || "Tool execution failed",
          code: toolResult.error?.code,
          retryable: toolResult.error?.retryable,
        });
        return;
      }

      res.json({ success: true, result: toolResult });
    } catch (err: any) {
      if (err?.message === "Unknown tool") {
        res.status(400).json({ error: "Unknown tool" });
        return;
      }
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid tool call payload" });
        return;
      }
      res.status(500).json({ error: err?.message || "Internal error" });
    }
  });

  router.post("/jsonrpc", aiLimiter, async (req: Request, res: Response) => {
    const response: McpResponse = {
      jsonrpc: "2.0",
      id: null,
    };

    try {
      const parsed = mcpRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        response.error = { code: -32600, message: "Invalid JSON-RPC request" };
        res.status(200).json(response);
        return;
      }

      const request = parsed.data as McpRequest;
      response.id = request.id ?? null;

      const userId = getUserId(req);
      if (!userId || String(userId).startsWith("anon_")) {
        response.error = { code: -32001, message: "Unauthorized" };
        res.status(200).json(response);
        return;
      }

      switch (request.method) {
        case "tools/list": {
          response.result = { tools: listConnectorTools() };
          res.status(200).json(response);
          return;
        }

        case "tools/call": {
          const params = toolCallSchema.parse(request.params || {});
          const toolName = params.tool;

          let toolResult: any;
          try {
            toolResult = await executeConnectorTool(userId, toolName, params.arguments, params.confirmed);
          } catch (err: any) {
            if (err?.message === "Unknown tool") {
              response.error = { code: -32602, message: "Unknown tool" };
              res.status(200).json(response);
              return;
            }
            throw err;
          }

          if (!toolResult.success) {
            response.error = {
              code: -32000,
              message: toolResult.error?.message || "Tool execution failed",
              data: {
                code: toolResult.error?.code,
                retryable: toolResult.error?.retryable,
              },
            };
            res.status(200).json(response);
            return;
          }

          response.result = toolResult;
          res.status(200).json(response);
          return;
        }

        default: {
          response.error = { code: -32601, message: `Unknown method: ${request.method}` };
          res.status(200).json(response);
          return;
        }
      }
    } catch (err: any) {
      response.error = {
        code: -32603,
        message: err?.message || "Internal error",
      };
      res.status(200).json(response);
    }
  });

  return router;
}
