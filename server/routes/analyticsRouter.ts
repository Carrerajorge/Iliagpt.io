/**
 * Analytics & Cost Tracking Router
 *
 * Dashboard API for usage stats, cost tracking, and performance metrics.
 */

import { Router, type Request, type Response } from "express";
import { analyticsService } from "../services/advancedAnalytics";

function getUserId(req: Request): string {
  const authReq = req as any;
  return (
    authReq?.user?.claims?.sub ||
    authReq?.user?.id ||
    (req as any).session?.authUserId ||
    "system"
  );
}

export function createAnalyticsRouter(): Router {
  const router = Router();

  // ── Usage Summary ──────────────────────────────────────────────────

  router.get("/summary", async (req: Request, res: Response) => {
    try {
      const userId = req.query.allUsers === "true" ? undefined : getUserId(req);
      const days = parseInt(req.query.days as string) || 30;

      const summary = await analyticsService.getSummary({ userId, days });
      res.json({ success: true, ...summary });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Real-time Performance Metrics ──────────────────────────────────

  router.get("/realtime", async (_req: Request, res: Response) => {
    const metrics = analyticsService.getRealtimeMetrics();
    res.json({ success: true, ...metrics });
  });

  // ── Cost by Model ──────────────────────────────────────────────────

  router.get("/cost/models", async (req: Request, res: Response) => {
    try {
      const userId = req.query.allUsers === "true" ? undefined : getUserId(req);
      const days = parseInt(req.query.days as string) || 30;

      const summary = await analyticsService.getSummary({ userId, days });
      res.json({
        success: true,
        models: summary.byModel,
        totalCostUsd: summary.totalCostUsd,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Cost by Day (time series) ──────────────────────────────────────

  router.get("/cost/daily", async (req: Request, res: Response) => {
    try {
      const userId = req.query.allUsers === "true" ? undefined : getUserId(req);
      const days = parseInt(req.query.days as string) || 30;

      const summary = await analyticsService.getSummary({ userId, days });
      res.json({
        success: true,
        daily: summary.byDay,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
