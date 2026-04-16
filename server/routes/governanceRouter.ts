import { Router, Request, Response } from "express";
import { governanceModeManager, type GovernanceMode } from "../agent/governance/modeManager";
import { humanApprovalQueue } from "../agent/governance/humanApprovalQueue";
import { auditTrail } from "../agent/governance/auditTrail";

const VALID_MODES: GovernanceMode[] = ["SAFE", "SUPERVISED", "AUTOPILOT", "RESEARCH", "EMERGENCY_STOP"];

export function createGovernanceRouter(): Router {
  const router = Router();

  router.get("/mode", (_req: Request, res: Response) => {
    res.json(governanceModeManager.getStatus());
  });

  router.post("/mode", (req: Request, res: Response) => {
    const { mode, reason } = req.body;
    const userId = (req as any).user?.claims?.sub || (req as any).user?.id || (req.session as any)?.authUserId || "system";

    if (!mode || !VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `Invalid mode. Must be one of: ${VALID_MODES.join(", ")}` });
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({ error: "A reason is required for mode changes" });
    }

    try {
      const transition = governanceModeManager.setMode(mode, userId, reason.trim());

      auditTrail.record({
        action: "governance.mode_change",
        actor: userId,
        target: "governance_mode",
        details: { from: transition.from, to: transition.to, reason: reason.trim() },
        riskLevel: mode === "EMERGENCY_STOP" ? "critical" : mode === "AUTOPILOT" ? "dangerous" : "moderate",
        outcome: "success",
        governanceMode: mode,
      });

      res.json({ success: true, transition, status: governanceModeManager.getStatus() });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/modes", (_req: Request, res: Response) => {
    res.json(governanceModeManager.getAllModes());
  });

  router.get("/approvals", (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;

    if (status === "pending") {
      return res.json({ approvals: humanApprovalQueue.getPending(), stats: humanApprovalQueue.getStats() });
    }

    if (status === "history") {
      const limit = parseInt(req.query.limit as string) || 50;
      return res.json({ approvals: humanApprovalQueue.getHistory(limit), stats: humanApprovalQueue.getStats() });
    }

    res.json({
      pending: humanApprovalQueue.getPending(),
      stats: humanApprovalQueue.getStats(),
    });
  });

  router.post("/approvals", (req: Request, res: Response) => {
    const { action, description, riskLevel, impact, reversibility, metadata } = req.body;
    const userId = (req as any).user?.claims?.sub || (req as any).user?.id || (req.session as any)?.authUserId || "system";

    if (!action || !description) {
      return res.status(400).json({ error: "action and description are required" });
    }

    const request = humanApprovalQueue.submit({
      action,
      description,
      riskLevel: riskLevel || "moderate",
      impact: impact || "unknown",
      reversibility: reversibility || "reversible",
      requestedBy: userId,
      metadata: metadata || {},
    });

    auditTrail.record({
      action: "governance.approval_requested",
      actor: userId,
      target: request.id,
      details: { action, description, riskLevel: riskLevel || "moderate" },
      riskLevel: riskLevel || "moderate",
      outcome: "pending",
      governanceMode: governanceModeManager.getMode(),
    });

    res.status(201).json(request);
  });

  router.post("/approvals/:id/decide", (req: Request, res: Response) => {
    const { id } = req.params;
    const { decision, notes } = req.body;
    const userId = (req as any).user?.claims?.sub || (req as any).user?.id || (req.session as any)?.authUserId || "system";

    if (!decision || !["approved", "denied"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approved' or 'denied'" });
    }

    try {
      const result = humanApprovalQueue.decide({
        requestId: id,
        decision,
        reviewedBy: userId,
        notes: notes || "",
      });

      auditTrail.record({
        action: `governance.approval_${decision}`,
        actor: userId,
        target: id,
        details: { decision, notes: notes || "" },
        riskLevel: result.riskLevel,
        outcome: "success",
        governanceMode: governanceModeManager.getMode(),
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get("/audit", (req: Request, res: Response) => {
    const options: Record<string, any> = {};
    if (req.query.actor) options.actor = req.query.actor;
    if (req.query.action) options.action = req.query.action;
    if (req.query.riskLevel) options.riskLevel = req.query.riskLevel;
    if (req.query.outcome) options.outcome = req.query.outcome;
    if (req.query.governanceMode) options.governanceMode = req.query.governanceMode;
    if (req.query.startTime) options.startTime = parseInt(req.query.startTime as string);
    if (req.query.endTime) options.endTime = parseInt(req.query.endTime as string);
    if (req.query.limit) options.limit = parseInt(req.query.limit as string);
    if (req.query.offset) options.offset = parseInt(req.query.offset as string);

    const entries = auditTrail.query(options);
    res.json({
      entries,
      total: auditTrail.getEntryCount(),
      stats: auditTrail.getStats(),
    });
  });

  router.get("/audit/integrity", (_req: Request, res: Response) => {
    const report = auditTrail.verifyIntegrity();
    res.json(report);
  });

  router.get("/audit/export", (req: Request, res: Response) => {
    const startTime = req.query.startTime ? parseInt(req.query.startTime as string) : undefined;
    const endTime = req.query.endTime ? parseInt(req.query.endTime as string) : undefined;

    const exportData = auditTrail.exportForCompliance(startTime, endTime);
    res.json(exportData);
  });

  return router;
}
