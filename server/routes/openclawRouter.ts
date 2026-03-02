import { Router, type Request, type Response } from "express";
import {
  initializeOpenClawTools,
  getOpenClawToolsForUser,
  getOpenClawStatus,
  getCatalogSections,
  buildOpenClawSystemPromptSection,
  getToolsForPlan,
  isToolAvailableForPlan,
  handleCompaction,
  type UserPlan,
  type ConversationMessage,
} from "../agent/openclaw";
import { requireAuth } from "../middleware/auth";

export function createOpenClawRouter(): Router {
  const router = Router();

  initializeOpenClawTools();

  router.get("/status", (_req: Request, res: Response) => {
    res.json(getOpenClawStatus());
  });

  router.get("/tools", (req: Request, res: Response) => {
    const plan = (req.query.plan as UserPlan) || "free";
    const tools = getOpenClawToolsForUser(plan);
    res.json({
      plan,
      count: tools.length,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
    });
  });

  router.get("/catalog", (_req: Request, res: Response) => {
    res.json({
      sections: getCatalogSections(),
    });
  });

  router.get("/system-prompt", (req: Request, res: Response) => {
    const tier = (req.query.tier as any) || "pro";
    const citations = req.query.citations !== "false";
    res.json({
      prompt: buildOpenClawSystemPromptSection({
        tier,
        citationsEnabled: citations,
      }),
    });
  });

  router.post("/check-tool", requireAuth, (req: Request, res: Response) => {
    const { toolName, plan } = req.body || {};
    if (!toolName || !plan) {
      return res.status(400).json({ error: "toolName and plan are required" });
    }
    res.json({
      toolName,
      plan,
      allowed: isToolAvailableForPlan(toolName, plan),
      allTools: getToolsForPlan(plan),
    });
  });

  router.post("/compact", requireAuth, async (req: Request, res: Response) => {
    try {
      const { messages, overrides } = req.body || {};
      if (!Array.isArray(messages)) {
        return res.status(400).json({ error: "messages array is required" });
      }
      const result = await handleCompaction(
        messages as ConversationMessage[],
        overrides
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
