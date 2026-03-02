import { Router } from "express";
import { getPublicSettings } from "../services/settingsConfigService";

export function createSettingsRouter() {
  const router = Router();

  let settingsCache: { data: any; ts: number } | null = null;
  const SETTINGS_CACHE_TTL = 30_000;

  router.get("/api/settings/public", async (_req, res) => {
    try {
      const now = Date.now();
      if (settingsCache && (now - settingsCache.ts) < SETTINGS_CACHE_TTL) {
        res.setHeader("Cache-Control", "public, max-age=30");
        return res.json(settingsCache.data);
      }
      const result = await getPublicSettings();
      settingsCache = { data: result, ts: now };
      res.setHeader("Cache-Control", "public, max-age=30");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        error: "Failed to load public settings",
        message: err?.message || String(err),
      });
    }
  });

  return router;
}
