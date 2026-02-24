import { Router } from "express";
import { getPublicSettings } from "../services/settingsConfigService";

export function createSettingsRouter() {
  const router = Router();

  // Public, non-authenticated settings consumed by the client.
  // NOTE: keep the payload shape in sync with client/src/contexts/PlatformSettingsContext.tsx
  router.get("/api/settings/public", async (_req, res) => {
    try {
      const result = await getPublicSettings();
      // Avoid caching stale admin-managed settings in proxies/CDNs.
      res.setHeader("Cache-Control", "no-store");
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
