/**
 * Automation Triggers Router
 *
 * REST API for managing persistent automation triggers.
 * CRUD + webhook receiver + execution log.
 */

import { Router, type Request, type Response } from "express";
import { triggerEngine, type TriggerKind, type ActionKind } from "../services/persistentTriggerEngine";
import { db } from "../db";
import { sql } from "drizzle-orm";

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

  // ── List recent executions (all or by trigger) ─────────────────────

  router.get("/executions", async (req: Request, res: Response) => {
    try {
      const { triggerId, limit = "50", offset = "0" } = req.query;
      const limitNum = Math.min(Number(limit) || 50, 200);
      const offsetNum = Number(offset) || 0;

      const result = await db.execute(sql`
        SELECT e.id, e.trigger_id, e.fired_at, e.status, e.action_kind, e.result, e.error, e.duration_ms,
               t.name as trigger_name
        FROM trigger_executions e
        LEFT JOIN automation_triggers t ON t.id = e.trigger_id
        WHERE (${triggerId?.toString() ?? null} IS NULL OR e.trigger_id = ${triggerId?.toString() ?? null})
        ORDER BY e.fired_at DESC
        LIMIT ${limitNum} OFFSET ${offsetNum}
      `) as { rows: Array<Record<string, unknown>> };

      res.json({
        success: true,
        executions: result.rows.map((r) => ({
          id: r.id,
          triggerId: r.trigger_id,
          triggerName: r.trigger_name,
          firedAt: r.fired_at,
          status: r.status,
          actionKind: r.action_kind,
          result: r.result,
          error: r.error,
          durationMs: r.duration_ms,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Get executions for a specific trigger ─────────────────────────

  router.get("/:id/executions", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const limit = Math.min(Number(req.query.limit) || 20, 100);

      const result = await db.execute(sql`
        SELECT id, trigger_id, fired_at, status, action_kind, result, error, duration_ms
        FROM trigger_executions
        WHERE trigger_id = ${id}
        ORDER BY fired_at DESC
        LIMIT ${limit}
      `) as { rows: Array<Record<string, unknown>> };

      res.json({
        success: true,
        triggerId: id,
        executions: result.rows.map((r) => ({
          id: r.id,
          firedAt: r.fired_at,
          status: r.status,
          actionKind: r.action_kind,
          result: r.result,
          error: r.error,
          durationMs: r.duration_ms,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Manually run a trigger now ────────────────────────────────────

  router.post("/:id/run", async (req: Request, res: Response) => {
    try {
      const trigger = triggerEngine.getTrigger(req.params.id);
      if (!trigger) return res.status(404).json({ success: false, error: "Trigger not found" });

      // Fire the trigger via the engine's internal emit
      triggerEngine.emit("trigger:fired", {
        trigger,
        context: { manual: true, firedBy: getUserId(req) },
      });

      res.json({ success: true, message: `Trigger '${trigger.name}' fired manually` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Get preset templates ──────────────────────────────────────────

  router.get("/templates/presets", async (_req: Request, res: Response) => {
    res.json({
      success: true,
      templates: [
        {
          name: "Daily Summary",
          description: "Get a daily summary of your recent activity and conversations",
          kind: "cron",
          config: { cron: "0 9 * * *", kind: "cron" },
          action: { kind: "agent_chat", prompt: "Summarize my recent conversations and activity from the last 24 hours. Highlight key decisions, action items, and important topics." },
        },
        {
          name: "Meeting Preparation",
          description: "Prepare research and context before meetings",
          kind: "cron",
          config: { cron: "0 8 * * 1-5", kind: "cron" },
          action: { kind: "agent_chat", prompt: "Check my upcoming meetings for today and prepare briefing notes. Include relevant context from past conversations and any pending action items for each attendee." },
        },
        {
          name: "Email Monitor",
          description: "Periodically check and summarize important emails",
          kind: "cron",
          config: { cron: "0 */4 * * *", kind: "cron" },
          action: { kind: "agent_chat", prompt: "Check my recent emails and provide a summary of important messages. Flag any that require urgent attention or a response." },
        },
        {
          name: "Weekly Knowledge Review",
          description: "Review and consolidate knowledge graph insights weekly",
          kind: "cron",
          config: { cron: "0 10 * * 1", kind: "cron" },
          action: { kind: "agent_chat", prompt: "Review the knowledge graph and provide insights about new entities, relationships, and patterns discovered this week. Suggest connections I might have missed." },
        },
      ],
    });
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
