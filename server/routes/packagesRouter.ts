import { Router } from "express";
import type { Request, Response } from "express";
import { packageManagerService } from "../services/packageManager";
import { Logger } from "../lib/logger";

export function createPackagesRouter(): Router {
  const router = Router();

  router.post("/plan", async (req: Request, res: Response) => {
    const { packageName, manager, action, version, options } = req.body || {};
    const userId = (req as any).user?.id || null;

    if (!packageName || typeof packageName !== "string") {
      return res.status(400).json({ success: false, error: "packageName is required" });
    }
    if (action && action !== "install" && action !== "uninstall") {
      return res.status(400).json({ success: false, error: "action must be either 'install' or 'uninstall'" });
    }

    try {
      const result = await packageManagerService.plan({
        packageName,
        manager,
        action,
        version,
        options,
        requestedBy: userId,
      });

      const status = result.policy.decision === "block" ? 403 : 200;
      return res.status(status).json({ success: true, data: result });
    } catch (error: any) {
      Logger.error("/api/packages/plan failed", error);
      return res.status(500).json({ success: false, error: error?.message || "Failed to generate plan" });
    }
  });

  router.post("/execute", async (req: Request, res: Response) => {
    const { confirmationId, confirm } = req.body || {};
    const userId = (req as any).user?.id || null;

    if (!confirmationId || typeof confirmationId !== "string") {
      return res.status(400).json({ success: false, error: "confirmationId is required" });
    }
    if (confirm !== true) {
      return res.status(400).json({ success: false, error: "confirm must be true" });
    }

    try {
      const data = await packageManagerService.execute({ confirmationId, confirm: true }, userId);
      return res.status(200).json({ success: true, data });
    } catch (error: any) {
      const msg = error?.message || "Failed to execute";
      // Map known errors
      const status =
        msg.startsWith("EXECUTION_DISABLED") ? 403 :
        msg === "POLICY_BLOCKED" ? 403 :
        msg === "CONFIRMATION_NOT_FOUND_OR_EXPIRED" ? 404 :
        msg === "CONFIRMATION_REQUIRED" ? 400 :
        500;

      Logger.error("/api/packages/execute failed", error);
      return res.status(status).json({ success: false, error: msg });
    }
  });

  return router;
}
