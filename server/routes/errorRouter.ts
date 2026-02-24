import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";

import { InMemoryClientErrorLogStore } from "../core/errors/infrastructure/inMemoryClientErrorLogStore";
import { getClientErrorStats, getRecentClientErrors, logClientError } from "../core/errors/application/clientErrorService";

const router = Router();

const store = new InMemoryClientErrorLogStore({ maxLogs: 1000 });

const clientErrorLogRequestSchema = z.object({
  errorId: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
  componentStack: z.string().optional(),
  componentName: z.string().optional(),
  url: z.string(),
  userAgent: z.string(),
});

function requireAdmin(req: Request, res: Response): boolean {
  const user = (req as any).user;
  if (!user?.id) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

router.post("/log", async (req: Request, res: Response) => {
  try {
    const parsed = clientErrorLogRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const userId = typeof (req as any).user?.id === "number" ? (req as any).user.id : undefined;
    const sessionId = typeof (req as any).sessionID === "string" ? (req as any).sessionID : undefined;

    const result = await logClientError(store, { ...parsed.data, userId, sessionId });
    if (!result.ok) {
      return res.status(400).json({ error: result.error.code });
    }

    console.error("[CLIENT ERROR]", {
      errorId: result.value.errorId,
      component: parsed.data.componentName,
      message: parsed.data.message.slice(0, 200),
      url: parsed.data.url,
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true, errorId: result.value.errorId });
  } catch (error) {
    console.error("Error logging client error:", error);
    res.status(500).json({ error: "Failed to log error" });
  }
});

router.get("/recent", async (req: Request, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const rawLimit = parseInt(req.query.limit as string) || 50;
    const limit = Math.min(Math.max(rawLimit, 1), 200);
    const componentName = typeof req.query.component === "string" ? req.query.component : undefined;

    const payload = await getRecentClientErrors(store, { limit, componentName });
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch errors" });
  }
});

router.get("/stats", async (req: Request, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const payload = await getClientErrorStats(store);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
