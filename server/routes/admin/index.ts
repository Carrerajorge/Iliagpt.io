import { Router } from "express";
import { requireAdmin } from "./utils";
import { require2FA } from "../../middleware/auth";
import { adminActivityTracker } from "../../middleware/adminActivityTracker";
import { dashboardRouter } from "./dashboard";
import { usersRouter } from "./users";
import { analyticsRouter } from "./analytics";
import { securityRouter } from "./security";
import { modelsRouter } from "./models";
import { databaseRouter } from "./database";
import { settingsRouter } from "./settings";
import { reportsRouter } from "./reports";
import { conversationsRouter } from "./conversations";
import { agentRouter } from "./agent";
import { excelRouter } from "./excel";
import { financeRouter } from "./finance";
import { releasesAdminRouter } from "./releases";
import { setupBullBoard } from "../../lib/bullBoard";

export const adminRouter = Router();

// Apply admin middleware to all routes
adminRouter.use(requireAdmin);
adminRouter.use(require2FA);
adminRouter.use(adminActivityTracker); // Auto-log all admin actions

// Probe endpoint (useful for admin UI gates).
adminRouter.get("/probe", (_req, res) => {
  res.json({ ok: true });
});

adminRouter.use("/dashboard", dashboardRouter);
adminRouter.use("/users", usersRouter);
adminRouter.use("/analytics", analyticsRouter);
adminRouter.use("/security", securityRouter);
adminRouter.use("/models", modelsRouter);
adminRouter.use("/database", databaseRouter);
adminRouter.use("/settings", settingsRouter);
adminRouter.use("/reports", reportsRouter);
adminRouter.use("/conversations", conversationsRouter);
adminRouter.use("/agent", agentRouter);
adminRouter.use("/excel", excelRouter);
adminRouter.use("/finance", financeRouter);
adminRouter.use("/releases", releasesAdminRouter);
const bullBoardAdapter = setupBullBoard();
if (bullBoardAdapter) {
  adminRouter.use("/queues", bullBoardAdapter);
}

// Database status root endpoint for convenience
adminRouter.get("/db-status", (req, res) => {
  res.redirect("/api/admin/database/status");
});

// Seed status root endpoint (for backwards compatibility if needed)
adminRouter.get("/seed-status", (req, res) => {
  res.json({ seeded: true, message: "Use /api/admin/settings/seed to re-seed" });
});

export const createAdminRouter = () => adminRouter;
