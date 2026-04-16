/**
 * Plugin Router — CRUD for plugin management.
 */

import { Router, type Request, type Response } from "express";
import { getUserId } from "../types/express";
import { pluginManager } from "../plugins/pluginManager";

export function createPluginRouter(): Router {
  const router = Router();

  // List available plugins (marketplace)
  router.get("/", (_req: Request, res: Response) => {
    const available = pluginManager.listAvailable();
    const installed = pluginManager.listInstalled();
    const installedIds = new Set(installed.map(p => p.id));

    return res.json({
      available: available.map(p => ({
        ...p,
        installed: installedIds.has(p.id),
        enabled: installed.find(i => i.id === p.id)?.enabled,
      })),
      installed,
    });
  });

  // Install a plugin
  router.post("/install", (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Auth required" });

    const { pluginId, config } = req.body;
    if (!pluginId) return res.status(400).json({ error: "pluginId required" });

    try {
      const plugin = pluginManager.install(pluginId, userId, config);
      return res.status(201).json({ plugin });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message });
    }
  });

  // Uninstall a plugin
  router.delete("/:id", (req: Request, res: Response) => {
    const removed = pluginManager.uninstall(req.params.id);
    if (!removed) return res.status(404).json({ error: "Plugin not found" });
    return res.json({ success: true });
  });

  // Toggle plugin enabled/disabled
  router.patch("/:id/toggle", (req: Request, res: Response) => {
    const { enabled } = req.body;
    const success = pluginManager.setEnabled(req.params.id, enabled !== false);
    if (!success) return res.status(404).json({ error: "Plugin not found" });
    return res.json({ success: true, enabled: enabled !== false });
  });

  // Update plugin config
  router.patch("/:id/config", (req: Request, res: Response) => {
    const success = pluginManager.updateConfig(req.params.id, req.body.config || {});
    if (!success) return res.status(404).json({ error: "Plugin not found" });
    return res.json({ success: true });
  });

  return router;
}
