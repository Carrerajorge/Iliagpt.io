/**
 * Compliance Router — GDPR export, data retention, audit trail APIs.
 */

import { Router, type Request, type Response } from "express";
import { getUserId } from "../types/express";
import {
  exportUserData,
  deleteUserData,
  getAuditLog,
  setRetentionPolicy,
  getRetentionPolicy,
  applyRetention,
  audit,
} from "../compliance/dataGovernance";

export function createComplianceRouter(): Router {
  const router = Router();

  // GDPR: Export all user data
  router.get("/gdpr/export", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    try {
      const data = await exportUserData(userId);
      res.setHeader("Content-Disposition", `attachment; filename="iliagpt-data-export-${userId}.json"`);
      res.setHeader("Content-Type", "application/json");
      return res.json(data);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Export failed" });
    }
  });

  // GDPR: Delete all user data (right to be forgotten)
  router.delete("/gdpr/delete", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    try {
      const result = await deleteUserData(userId);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Deletion failed" });
    }
  });

  // Audit trail (admin only)
  router.get("/audit", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const { action, resource, limit, since } = req.query;
    const entries = getAuditLog({
      userId: req.query.userId as string || undefined,
      action: action as string || undefined,
      resource: resource as string || undefined,
      limit: limit ? parseInt(limit as string) : 100,
      since: since ? new Date(since as string) : undefined,
    });

    return res.json({ entries, total: entries.length });
  });

  // Data retention policy management
  router.get("/retention", async (req: Request, res: Response) => {
    const policy = getRetentionPolicy(req.query.orgId as string);
    return res.json({ policy });
  });

  router.post("/retention", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const { retentionDays, scope, orgId, applyToMessages, applyToFiles, applyToEmbeddings } = req.body;
    if (typeof retentionDays !== "number" || retentionDays < 0) {
      return res.status(400).json({ error: "retentionDays must be a non-negative number" });
    }

    audit({
      userId,
      action: "retention_policy_updated",
      resource: "policy",
      details: { retentionDays, scope, orgId },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    const policy = setRetentionPolicy({
      orgId,
      retentionDays,
      scope: scope || "all",
      applyToMessages: applyToMessages !== false,
      applyToFiles: applyToFiles !== false,
      applyToEmbeddings: applyToEmbeddings !== false,
    });

    return res.json({ policy });
  });

  // Trigger retention cleanup (admin/cron)
  router.post("/retention/apply", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const result = await applyRetention(req.body.orgId);
    return res.json(result);
  });

  return router;
}
