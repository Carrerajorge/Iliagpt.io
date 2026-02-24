/**
 * Automation Triggers Router
 *
 * REST API for managing persistent automation triggers.
 * CRUD + webhook receiver + execution log.
 */

import { Router, type Request, type Response } from "express";
import { triggerEngine, type TriggerKind, type ActionKind } from "../services/persistentTriggerEngine";

function getUserId(req: Request): string {
  const authReq = req as any;
  return (
    authReq?.user?.claims?.sub ||
    authReq?.user?.id ||
    (req as any).session?.authUserId ||
    (req as any).session?.passport?.user?.id ||
    "system"
  );
}

export function createAutomationTriggersRouter(): Router {
  const router = Router();

  // ── List triggers ──────────────────────────────────────────────────

  router.get("/", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    const triggers = triggerEngine.listTriggers(userId);
    res.json({
      success: true,
      triggers: triggers.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        kind: t.kind,
        isActive: t.isActive,
        config: t.config,
        action: { kind: t.action.kind, prompt: t.action.prompt },
        lastRunAt: t.lastRunAt,
        lastRunStatus: t.lastRunStatus,
        runCount: t.runCount,
        errorCount: t.errorCount,
        createdAt: t.createdAt,
      })),
      count: triggers.length,
    });
  });

  // ── Get single trigger ─────────────────────────────────────────────

  router.get("/:id", async (req: Request, res: Response) => {
    const trigger = triggerEngine.getTrigger(req.params.id);
    if (!trigger) return res.status(404).json({ success: false, error: "Trigger not found" });
    res.json({ success: true, trigger });
  });

  // ── Create trigger ─────────────────────────────────────────────────

  router.post("/", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const { name, description, kind, config, action, maxRuns } = req.body;

      if (!name || !kind || !config || !action) {
        return res.status(400).json({ success: false, error: "name, kind, config, action required" });
      }

      const trigger = await triggerEngine.createTrigger({
        userId,
        name,
        description,
        kind: kind as TriggerKind,
        isActive: true,
        config: { ...config, kind },
        action,
        maxRuns,
      });

      res.status(201).json({ success: true, trigger });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Update trigger ─────────────────────────────────────────────────

  router.patch("/:id", async (req: Request, res: Response) => {
    try {
      const updated = await triggerEngine.updateTrigger(req.params.id, req.body);
      if (!updated) return res.status(404).json({ success: false, error: "Trigger not found" });
      res.json({ success: true, trigger: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Toggle active/inactive ─────────────────────────────────────────

  router.post("/:id/toggle", async (req: Request, res: Response) => {
    const { active } = req.body;
    const ok = await triggerEngine.toggleTrigger(req.params.id, active ?? true);
    if (!ok) return res.status(404).json({ success: false, error: "Trigger not found" });
    res.json({ success: true, active });
  });

  // ── Delete trigger ─────────────────────────────────────────────────

  router.delete("/:id", async (req: Request, res: Response) => {
    const ok = await triggerEngine.deleteTrigger(req.params.id);
    res.json({ success: ok });
  });

  // ── Webhook receiver ───────────────────────────────────────────────

  router.post("/webhook/:hookId", async (req: Request, res: Response) => {
    const { hookId } = req.params;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers[k] = v;
    }

    const result = await triggerEngine.handleWebhook(hookId, req.body, headers);

    if (result.triggered) {
      res.json({ success: true, triggerId: result.triggerId });
    } else {
      res.status(404).json({ success: false, error: "No active trigger for this webhook" });
    }
  });

  return router;
}
