import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

import { createHttpTestClient } from "../../tests/helpers/httpTestClient";

const queryAdminUsersMock = vi.fn();
const storageMock = {
  createAuditLog: vi.fn(async () => undefined),
  createImpersonationToken: vi.fn(async () => undefined),
};

vi.mock("../db", () => ({
  db: {},
  dbRead: {},
}));

vi.mock("../storage", () => ({
  storage: storageMock,
}));

vi.mock("../services/adminProjection", () => ({
  queryAdminUsers: (...args: any[]) => queryAdminUsersMock(...args),
}));

vi.mock("../middleware/jitElevation", () => ({
  requireRecentAuth: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../services/usageQuotaService", () => ({
  usageQuotaService: {
    getUserTokenReport: vi.fn(),
  },
}));

vi.mock("../services/auditLogger", () => ({
  auditLog: vi.fn(),
  AuditActions: {
    ADMIN_USER_CREATED: "admin_user_created",
    ADMIN_USER_UPDATED: "admin_user_updated",
    ADMIN_USER_DELETED: "admin_user_deleted",
  },
}));

describe("admin users routes hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryAdminUsersMock.mockResolvedValue({
      users: [{ id: "user-1", email: "alice@example.com", authProvider: "google" }],
      pagination: {
        page: 2,
        limit: 20,
        total: 31,
        totalPages: 2,
        hasNext: false,
        hasPrev: true,
      },
    });
  });

  async function buildApp() {
    const { usersRouter } = await import("../routes/admin/users");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { id: "admin-1", email: "admin@example.com" };
      (req as any).session = { lastPasswordVerifiedAt: Date.now() };
      next();
    });
    app.use("/api/admin/users", usersRouter);
    return app;
  }

  it("lists users through the centralized admin projection with server-side filters", async () => {
    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.get(
        "/api/admin/users?page=2&limit=20&search=alice&status=active&role=admin&plan=pro&authProvider=google&sortBy=email&sortOrder=asc",
      );

      expect(res.status).toBe(200);
      expect(queryAdminUsersMock).toHaveBeenCalledWith({
        page: 2,
        limit: 20,
        search: "alice",
        status: "active",
        role: "admin",
        plan: "pro",
        authProvider: "google",
        sortBy: "email",
        sortOrder: "asc",
      });
      expect(res.body.pagination.total).toBe(31);
      expect(res.body.users[0].email).toBe("alice@example.com");
    } finally {
      await close();
    }
  });

  it("blocks insecure impersonation tokens instead of returning unusable credentials", async () => {
    const app = await buildApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.post("/api/admin/users/user-77/impersonate").send({});

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("IMPERSONATION_DISABLED");
      expect(storageMock.createImpersonationToken).not.toHaveBeenCalled();
      expect(storageMock.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "admin_impersonation_blocked",
          resource: "users",
          resourceId: "user-77",
        }),
      );
    } finally {
      await close();
    }
  });
});
