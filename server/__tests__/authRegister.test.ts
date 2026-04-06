import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const authStorageMock = {
  getUserByEmail: vi.fn(),
  upsertUser: vi.fn(),
};

const hashPasswordMock = vi.fn(async (password: string) => `hashed:${password}`);
const auditLogMock = vi.fn(async () => undefined);
const getSettingValueMock = vi.fn(async (_key: string, fallback: any) => fallback);

vi.mock("../replit_integrations/auth/storage", () => ({
  authStorage: authStorageMock,
}));

vi.mock("../replit_integrations/auth/replitAuth", () => ({
  isAuthenticated: (_req: any, _res: any, next: any) => next(),
  getSessionStats: () => ({}),
}));

vi.mock("../storage", () => ({
  storage: {},
}));

vi.mock("../utils/password", () => ({
  hashPassword: (...args: any[]) => hashPasswordMock(...args),
  verifyPassword: vi.fn(),
  isHashed: vi.fn(() => true),
}));

vi.mock("../middleware/userRateLimiter", () => ({
  rateLimiter: (_req: any, _res: any, next: any) => next(),
  getRateLimitStats: () => ({}),
}));

vi.mock("../services/genericEmailService", () => ({
  sendMagicLinkEmail: vi.fn(),
}));

vi.mock("../lib/anonUserHelper", () => ({
  getSecureUserId: vi.fn(() => null),
}));

vi.mock("../services/auditLogger", () => ({
  auditLog: (...args: any[]) => auditLogMock(...args),
  AuditActions: {
    AUTH_LOGIN: "auth.login",
    AUTH_LOGIN_FAILED: "auth.login_failed",
    USER_CREATED: "user.created",
    USER_UPDATED: "user.updated",
  },
}));

vi.mock("../lib/sessionUser", () => ({
  buildSessionUserFromDbUser: vi.fn(),
}));

vi.mock("../services/mfaLogin", () => ({
  computeMfaForUser: vi.fn(async () => ({ requiresMfa: false, totpEnabled: false, pushTargets: [] })),
  startMfaLoginChallenge: vi.fn(),
}));

vi.mock("../lib/structuredLogger", () => ({
  createLogger: () => ({
    withRequest: () => ({
      error: vi.fn(),
    }),
  }),
}));

vi.mock("../services/settingsConfigService", () => ({
  getSettingValue: (...args: any[]) => getSettingValueMock(...args),
}));

vi.mock("../lib/logoutMarker", () => ({
  setLogoutMarker: vi.fn(),
  clearLogoutMarker: vi.fn(),
}));

describe("registerAuthRoutes /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingValueMock.mockImplementation(async (_key: string, fallback: any) => fallback);
    authStorageMock.getUserByEmail.mockResolvedValue(undefined);
    authStorageMock.upsertUser.mockResolvedValue({ id: "user-1" });
  });

  async function buildApp() {
    const { registerAuthRoutes } = await import("../replit_integrations/auth/routes");
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);
    return app;
  }

  it("creates self-registered accounts as active standard users", async () => {
    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.post("/api/auth/register").send({
        email: "user@example.com",
        password: "SecurePass1",
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(authStorageMock.upsertUser).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          email: "user@example.com",
          role: "user",
          plan: "free",
          status: "active",
          password: "hashed:SecurePass1",
          authProvider: "email",
          emailVerified: "true",
        }),
      );
    } finally {
      await close();
    }
  });

  it("rejects weak passwords before provisioning the account", async () => {
    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.post("/api/auth/register").send({
        email: "user@example.com",
        password: "lowercase123",
      });

      expect(res.status).toBe(400);
      expect(authStorageMock.upsertUser).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
