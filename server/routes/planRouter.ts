/**
 * Plan Router - REST endpoints for the Agent Plan Mode system.
 *
 * POST /api/plans/generate    - Generate a draft plan from a user message
 * POST /api/plans/:id/approve - Approve a draft plan
 * POST /api/plans/:id/reject  - Reject a draft plan
 * POST /api/plans/:id/execute - Execute an approved plan (SSE progress)
 * GET  /api/plans/:id         - Retrieve a plan by ID
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { getSecureUserId } from "../lib/anonUserHelper";
import { generatePlan, approvePlan, rejectPlan, getPlan, executePlanAsync } from "../agent/planMode";
import { createLogger } from "../utils/logger";

const log = createLogger("plan-router");
const router = Router();

// ---------------------------------------------------------------------------
// POST /api/plans/generate
// ---------------------------------------------------------------------------
router.post("/generate", requireAuth, async (req: Request, res: Response) => {
  try {
    const { message, chatId, conversationHistory } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    const userId = getSecureUserId(req) || "anonymous";

    const plan = await generatePlan({
      userMessage: message,
      chatId: chatId || "adhoc",
      userId: String(userId),
      conversationHistory,
    });

    res.json(plan);
  } catch (err) {
    log.error({ err }, "Plan generation failed");
    res.status(500).json({ error: "Failed to generate plan" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/plans/:id/approve
// ---------------------------------------------------------------------------
router.post("/:id/approve", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = approvePlan(req.params.id);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }
    res.json(plan);
  } catch (err) {
    log.error({ err }, "Plan approval failed");
    res.status(500).json({ error: "Failed to approve plan" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/plans/:id/reject
// ---------------------------------------------------------------------------
router.post("/:id/reject", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = rejectPlan(req.params.id);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }
    res.json(plan);
  } catch (err) {
    log.error({ err }, "Plan rejection failed");
    res.status(500).json({ error: "Failed to reject plan" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/plans/:id/execute
// ---------------------------------------------------------------------------
router.post("/:id/execute", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = getPlan(req.params.id);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }
    if (plan.status !== "approved") {
      return res.status(400).json({ error: `Cannot execute plan in status '${plan.status}'` });
    }

    // Stream progress via SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const generator = executePlanAsync(req.params.id);
    for await (const update of generator) {
      res.write(`data: ${JSON.stringify(update)}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    log.error({ err }, "Plan execution failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to execute plan" });
    } else {
      res.end();
    }
  }
});

// ---------------------------------------------------------------------------
// GET /api/plans/:id
// ---------------------------------------------------------------------------
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const plan = getPlan(req.params.id);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }
    res.json(plan);
  } catch (err) {
    log.error({ err }, "Plan retrieval failed");
    res.status(500).json({ error: "Failed to retrieve plan" });
  }
});

export default router;
