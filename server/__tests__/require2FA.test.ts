import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const getSettingValueMock = vi.fn(async (_key: string, fallback: any) => fallback);
const is2FAEnabledMock = vi.fn(async (_userId: string) => false);

vi.mock("../services/settingsConfigService", () => ({
  getSettingValue: (...args: any[]) => getSettingValueMock(...args),
}));

vi.mock("../services/twoFactorAuth", () => ({
  is2FAEnabled: (...args: any[]) => is2FAEnabledMock(...args),
}));

describe("require2FA middleware", () => {
  const TEST_TIMEOUT_MS = 15_000;

  beforeEach(() => {
    getSettingValueMock.mockReset();
    is2FAEnabledMock.mockReset();
  });

  it("blocks admins when require_2fa_admins=true and 2FA is not enabled", async () => {
    getSettingValueMock.mockImplementation(async (key: string, fallback: any) => {
      if (key === "require_2fa_admins") return true;
      return fallback;
    });
    is2FAEnabledMock.mockResolvedValue(false);

    const { require2FA } = await import("../middleware/auth");
    const app = express();
    app.use((req, _res, next) => {
      (req as any).session = {};
      (req as any).user = { claims: { sub: "user-1" }, role: "admin" };
      next();
    });
    app.use(require2FA);
    app.get("/protected", (_req, res) => res.json({ ok: true }));

    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/protected");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("2FA_SETUP_REQUIRED");
    } finally {
      await close();
    }
  }, TEST_TIMEOUT_MS);

  it("requires verification when 2FA is enabled but session not verified", async () => {
    getSettingValueMock.mockImplementation(async (key: string, fallback: any) => {
      if (key === "require_2fa_admins") return true;
      return fallback;
    });
    is2FAEnabledMock.mockResolvedValue(true);

    const { require2FA } = await import("../middleware/auth");
    const app = express();
    app.use((req, _res, next) => {
      (req as any).session = {};
      (req as any).user = { claims: { sub: "user-1" }, role: "admin" };
      next();
    });
    app.use(require2FA);
    app.get("/protected", (_req, res) => res.json({ ok: true }));

    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/protected");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("2FA_REQUIRED");
    } finally {
      await close();
    }
  }, TEST_TIMEOUT_MS);

  it("allows access when 2FA enabled and session verified", async () => {
    getSettingValueMock.mockImplementation(async (key: string, fallback: any) => {
      if (key === "require_2fa_admins") return true;
      return fallback;
    });
    is2FAEnabledMock.mockResolvedValue(true);

    const { require2FA } = await import("../middleware/auth");
    const app = express();
    app.use((req, _res, next) => {
      (req as any).session = { is2FAVerified: true };
      (req as any).user = { claims: { sub: "user-1" }, role: "admin" };
      next();
    });
    app.use(require2FA);
    app.get("/protected", (_req, res) => res.json({ ok: true }));

    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/protected");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    } finally {
      await close();
    }
  }, TEST_TIMEOUT_MS);

  it("does not force setup for non-admins when require_2fa_admins=true", async () => {
    getSettingValueMock.mockImplementation(async (key: string, fallback: any) => {
      if (key === "require_2fa_admins") return true;
      return fallback;
    });
    is2FAEnabledMock.mockResolvedValue(false);

    const { require2FA } = await import("../middleware/auth");
    const app = express();
    app.use((req, _res, next) => {
      (req as any).session = {};
      (req as any).user = { claims: { sub: "user-1" }, role: "user" };
      next();
    });
    app.use(require2FA);
    app.get("/protected", (_req, res) => res.json({ ok: true }));

    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.get("/protected");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    } finally {
      await close();
    }
  }, TEST_TIMEOUT_MS);
});
