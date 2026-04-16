import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

vi.mock("../services/settingsConfigService", () => ({
  getSettingValue: vi.fn(async (key: string, fallback: any) => {
    if (key === "maintenance_mode") return true;
    return fallback;
  }),
  getActorEmailFromRequest: () => null,
  getActorIdFromRequest: () => null,
}));

describe("maintenanceModeMiddleware", () => {
  const TEST_TIMEOUT_MS = 15_000;

  beforeEach(() => {
    // Avoid cross-test pollution from other test files that may mock/unmock settingsConfigService.
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("blocks non-admin API routes with 503", async () => {
    const { maintenanceModeMiddleware } = await import("../middleware/maintenanceMode");

    const app = express();
    app.use(maintenanceModeMiddleware);
    app.get("/api/blocked", (_req, res) => res.json({ ok: true }));

    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/api/blocked");
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("MAINTENANCE_MODE");
      expect(res.body.maintenance).toBe(true);
    } finally {
      await close();
    }
  }, TEST_TIMEOUT_MS);

  it("allows exempt auth prefixes", async () => {
    const { maintenanceModeMiddleware } = await import("../middleware/maintenanceMode");

    const app = express();
    app.use(maintenanceModeMiddleware);
    app.get("/api/auth/user", (_req, res) => res.json({ ok: true }));

    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/api/auth/user");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    } finally {
      await close();
    }
  }, TEST_TIMEOUT_MS);

  it("allows non-API routes (SPA) even during maintenance", async () => {
    const { maintenanceModeMiddleware } = await import("../middleware/maintenanceMode");

    const app = express();
    app.use(maintenanceModeMiddleware);
    app.get("/", (_req, res) => res.status(200).send("ok"));

    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/");
      expect(res.status).toBe(200);
      expect(res.text).toBe("ok");
    } finally {
      await close();
    }
  }, TEST_TIMEOUT_MS);

  it("allows admin requests through", async () => {
    const { maintenanceModeMiddleware } = await import("../middleware/maintenanceMode");

    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { role: "admin" };
      next();
    });
    app.use(maintenanceModeMiddleware);
    app.get("/api/admin-ok", (_req, res) => res.json({ ok: true }));

    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/api/admin-ok");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    } finally {
      await close();
    }
  }, TEST_TIMEOUT_MS);
});
