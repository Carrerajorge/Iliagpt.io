/**
 * MCP Client Router — REST API for managing external MCP server connections.
 * Allows users to connect/disconnect MCP servers and browse/test discovered tools.
 *
 * Inspired by Rowboat's MCP-based tool extensibility.
 */

import { Router, type Request, type Response } from "express";
import { createLogger } from "../utils/logger";

const logger = createLogger("MCPClientRouter");

// Lazy imports to handle optional dependencies
let mcpAutoDiscovery: any = null;
let mcpRegistry: any = null;
let toolDiscovery: any = null;

async function loadMCPModules() {
  try {
    if (!mcpAutoDiscovery) {
      const mod = await import("../agent/mcp/mcpAutoDiscovery");
      mcpAutoDiscovery = mod.mcpAutoDiscovery;
    }
  } catch { /* optional */ }

  try {
    if (!mcpRegistry) {
      const mod = await import("../agent/mcp/mcpRegistry");
      mcpRegistry = mod.mcpRegistry;
    }
  } catch { /* optional */ }

  try {
    if (!toolDiscovery) {
      const mod = await import("../mcp/toolDiscovery");
      toolDiscovery = mod;
    }
  } catch { /* optional */ }
}

export function createMcpClientRouter(): Router {
  const router = Router();

  // ── List connected MCP servers ────────────────────────────────────

  router.get("/servers", async (_req: Request, res: Response) => {
    try {
      await loadMCPModules();

      const servers: any[] = [];

      if (mcpRegistry?.getAllServers) {
        const registryServers = mcpRegistry.getAllServers();
        for (const server of registryServers) {
          servers.push({
            id: server.id,
            name: server.name,
            url: server.url,
            transport: server.transport,
            status: server.status,
            toolCount: server.toolCount ?? 0,
            lastHealthCheck: server.lastHealthCheck,
            connectedAt: server.connectedAt,
          });
        }
      }

      if (mcpAutoDiscovery?.getDiscoveredServers) {
        const discovered = mcpAutoDiscovery.getDiscoveredServers();
        for (const server of discovered) {
          if (!servers.find((s) => s.id === server.id)) {
            servers.push({
              id: server.id,
              name: server.name,
              url: server.url,
              transport: server.transport ?? "unknown",
              status: server.status ?? "discovered",
              toolCount: server.tools?.length ?? 0,
            });
          }
        }
      }

      res.json({ success: true, servers, count: servers.length });
    } catch (error) {
      logger.error("Failed to list MCP servers", error);
      res.status(500).json({ success: false, error: "Failed to list servers" });
    }
  });

  // ── Connect to a new MCP server ───────────────────────────────────

  router.post("/servers", async (req: Request, res: Response) => {
    try {
      await loadMCPModules();

      const { name, url, command, args, transport } = req.body;

      if (!name) {
        return res.status(400).json({ success: false, error: "Server name is required" });
      }

      if (!url && !command) {
        return res.status(400).json({ success: false, error: "Either 'url' (for HTTP/SSE) or 'command' (for stdio) is required" });
      }

      let serverId: string | undefined;

      // Try toolDiscovery.connectMCPServer for HTTP
      if (url && toolDiscovery?.connectMCPServer) {
        const connectionId = await toolDiscovery.connectMCPServer(url);
        serverId = connectionId;
      }

      // Try mcpAutoDiscovery.addServer for all transports
      if (mcpAutoDiscovery?.addServer) {
        const config: any = {
          id: serverId ?? `mcp-${Date.now()}`,
          name,
          transport: transport ?? (url ? "sse" : "stdio"),
        };

        if (url) config.url = url;
        if (command) {
          config.command = command;
          config.args = args ?? [];
        }

        await mcpAutoDiscovery.addServer(config);
        serverId = config.id;
      }

      if (!serverId) {
        return res.status(500).json({
          success: false,
          error: "MCP modules not available. Ensure MCP dependencies are installed.",
        });
      }

      res.json({
        success: true,
        serverId,
        message: `Connected to MCP server '${name}'`,
      });
    } catch (error) {
      logger.error("Failed to connect MCP server", error);
      res.status(500).json({
        success: false,
        error: "Failed to connect",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ── Disconnect an MCP server ──────────────────────────────────────

  router.delete("/servers/:id", async (req: Request, res: Response) => {
    try {
      await loadMCPModules();

      const { id } = req.params;

      if (toolDiscovery?.disconnectMCPServer) {
        toolDiscovery.disconnectMCPServer(id);
      }

      if (mcpAutoDiscovery?.removeServer) {
        mcpAutoDiscovery.removeServer(id);
      }

      if (mcpRegistry?.removeServer) {
        mcpRegistry.removeServer(id);
      }

      res.json({ success: true, disconnected: id });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to disconnect server" });
    }
  });

  // ── List all discovered tools ─────────────────────────────────────

  router.get("/tools", async (req: Request, res: Response) => {
    try {
      await loadMCPModules();

      const { serverId } = req.query;
      let tools: any[] = [];

      if (mcpRegistry?.getAllTools) {
        const allTools = serverId
          ? mcpRegistry.getToolsByServer?.(serverId as string) ?? []
          : mcpRegistry.getAllTools();

        tools = allTools.map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          serverId: t.serverId,
          serverName: t.serverName,
          inputSchema: t.inputSchema,
          status: t.status,
          usageCount: t.usageCount ?? 0,
          reliabilityScore: t.reliabilityScore,
          avgLatencyMs: t.avgLatencyMs,
        }));
      } else if (toolDiscovery?.listTools) {
        const listed = toolDiscovery.listTools({ source: "mcp" });
        tools = listed.map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          inputSchema: t.parameters,
          status: "active",
        }));
      }

      res.json({ success: true, tools, count: tools.length });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to list tools" });
    }
  });

  // ── Test-run a tool ───────────────────────────────────────────────

  router.post("/tools/:id/test", async (req: Request, res: Response) => {
    try {
      await loadMCPModules();

      const { id } = req.params;
      const { params } = req.body;

      let result: any;

      if (toolDiscovery?.executeTool) {
        result = await toolDiscovery.executeTool(id, params ?? {});
      } else if (mcpRegistry?.getTool) {
        const tool = mcpRegistry.getTool(id);
        if (!tool) {
          return res.status(404).json({ success: false, error: "Tool not found" });
        }
        // Try to call via the tool's server connector
        result = { message: "Tool found but direct execution not available via registry" };
      } else {
        return res.status(500).json({ success: false, error: "No execution engine available" });
      }

      res.json({ success: true, toolId: id, result });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Tool execution failed",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // ── Get registry stats ────────────────────────────────────────────

  router.get("/stats", async (_req: Request, res: Response) => {
    try {
      await loadMCPModules();

      let stats: any = {
        totalServers: 0,
        totalTools: 0,
        activeTools: 0,
        avgReliability: 0,
      };

      if (mcpRegistry?.getStats) {
        stats = { ...stats, ...mcpRegistry.getStats() };
      }

      if (toolDiscovery?.getRegistryStats) {
        const tdStats = toolDiscovery.getRegistryStats();
        stats.toolDiscoveryTotal = tdStats.totalTools ?? 0;
        stats.toolDiscoveryMcp = tdStats.mcpTools ?? 0;
      }

      res.json({ success: true, ...stats });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to get stats" });
    }
  });

  return router;
}

export default createMcpClientRouter;
