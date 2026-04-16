/**
 * Orchestrator API Routes — Exposes state graph and tool capabilities.
 *
 * Endpoints:
 *   GET  /api/orchestrator/runs/:id/graph        - Get state graph status
 *   POST /api/orchestrator/runs/:id/escalate     - Respond to escalation
 *   POST /api/orchestrator/runs/:id/strategy     - Switch DOM/Visual mode
 *   GET  /api/orchestrator/runs/:id/citations     - Get research citations
 *   GET  /api/orchestrator/tools                  - List registered agentic tools
 *   GET  /api/orchestrator/graphs                 - List all active graphs
 */

import { Router, Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../types/express";
import {
  getActiveGraph,
  getGraphStatus,
  listActiveGraphs,
  switchStrategy,
  shouldEscalateAction,
  isBudgetExceeded,
  transitionToEscalate,
  transitionToCancelled,
} from "../agent/orchestrator/orchestratorBridge";
import { toolRegistry } from "../agent/toolRegistry";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

export function createOrchestratorRouter() {
  const router = Router();

  /**
   * GET /api/orchestrator/runs/:id/graph
   * Returns the state graph status for a run.
   */
  router.get("/runs/:id/graph", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const graph = getActiveGraph(id);
      if (!graph) {
        return res.status(404).json({ error: "No active graph for this run" });
      }

      return res.json({
        success: true,
        graph: graph.toJSON(),
        status: getGraphStatus(id),
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/orchestrator/runs/:id/escalate
   * Handle escalation response (approve or reject).
   */
  router.post("/runs/:id/escalate", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { action } = req.body; // "approve" or "reject"
      const graph = getActiveGraph(id);

      if (!graph) {
        return res.status(404).json({ error: "No active graph for this run" });
      }

      if (graph.getState() !== "ESCALATE") {
        return res.status(400).json({ error: `Graph is in state ${graph.getState()}, not ESCALATE` });
      }

      if (action === "approve") {
        graph.transition("ACT", "human_approved");
        return res.json({ success: true, newState: graph.getState() });
      } else if (action === "reject") {
        graph.transition("CANCELLED", "human_rejected");
        return res.json({ success: true, newState: graph.getState() });
      } else {
        return res.status(400).json({ error: 'action must be "approve" or "reject"' });
      }
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/orchestrator/runs/:id/strategy
   * Switch between DOM and Visual mode.
   */
  router.post("/runs/:id/strategy", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { mode } = req.body;

      if (mode !== "dom" && mode !== "visual") {
        return res.status(400).json({ error: 'mode must be "dom" or "visual"' });
      }

      const success = switchStrategy(id, mode);
      if (!success) {
        return res.status(404).json({ error: "No active graph for this run" });
      }

      return res.json({ success: true, mode });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/orchestrator/runs/:id/citations
   * Get accumulated research citations for a run.
   */
  router.get("/runs/:id/citations", requireAuth, async (req: Request, res: Response) => {
    try {
      // Citations are managed per-engine instance
      // For now, return empty array — would need run-scoped engine instances
      const graph = getActiveGraph(req.params.id);
      if (!graph) {
        return res.status(404).json({ error: "No active graph for this run" });
      }

      const ctx = graph.getContext();
      return res.json({
        success: true,
        citations: [],
        evidence: ctx.evidence.slice(-50), // Last 50 evidence entries
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/orchestrator/tools
   * List all registered tools with their capabilities.
   */
  router.get("/tools", requireAuth, async (_req: Request, res: Response) => {
    try {
      const tools = toolRegistry.list().map((t) => ({
        name: t.name,
        description: t.description,
        capabilities: t.capabilities || [],
      }));

      return res.json({
        success: true,
        tools,
        count: tools.length,
      });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/orchestrator/graphs
   * List all active state graphs.
   */
  router.get("/graphs", requireAuth, async (_req: Request, res: Response) => {
    try {
      const graphs = listActiveGraphs();
      return res.json({ success: true, graphs, count: graphs.length });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  return router;
}
