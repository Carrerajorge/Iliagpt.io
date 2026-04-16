import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock external dependencies before importing the module ───────────

vi.mock("../db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@shared/schema", () => ({
  users: { id: "id", email: "email", role: "role" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  sql: vi.fn((...args: any[]) => args),
}));

const mockGetSettingValue = vi.fn();
const mockGetActorEmailFromRequest = vi.fn();
const mockGetActorIdFromRequest = vi.fn();

vi.mock("../services/settingsConfigService", () => ({
  getSettingValue: (...args: any[]) => mockGetSettingValue(...args),
  getActorEmailFromRequest: (...args: any[]) => mockGetActorEmailFromRequest(...args),
  getActorIdFromRequest: (...args: any[]) => mockGetActorIdFromRequest(...args),
}));

import { maintenanceModeMiddleware } from "./maintenanceMode";

// ── Helpers ──────────────────────────────────────────────────────────

function mockReq(overrides: Record<string, any> = {}): any {
  return {
    originalUrl: "/api/data",
    baseUrl: "",
    path: "/api/data",
    headers: {},
    user: null,
    session: null,
    ...overrides,
  };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    body: null,
  };
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body: any) => {
    res.body = body;
    return res;
  });
  return res;
}

function mockNext(): any {
  return vi.fn();
}

// ── Tests ────────────────────────────────────────────────────────────

describe("maintenanceModeMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActorEmailFromRequest.mockReturnValue(null);
    mockGetActorIdFromRequest.mockReturnValue(null);
  });

  it("calls next when maintenance_mode is false", async () => {
    mockGetSettingValue.mockResolvedValue(false);
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 503 for non-exempt API routes during maintenance", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const res = mockRes();
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/api/data" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      error: "Maintenance mode enabled",
      code: "MAINTENANCE_MODE",
      maintenance: true,
    });
  });

  it("allows /api/auth routes during maintenance", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/api/auth/login" }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows /api/login routes during maintenance", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/api/login" }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows /api/health during maintenance", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/api/health" }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows /api/admin during maintenance", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/api/admin/settings" }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows /api/webhooks during maintenance", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/api/webhooks/stripe" }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows /api/settings/public during maintenance", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/api/settings/public" }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows non-API routes (static/SPA) during maintenance", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/dashboard" }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows admin users through during maintenance via role claim", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const req = mockReq({
      originalUrl: "/api/data",
      user: { claims: { role: "admin" } },
    });
    const next = mockNext();
    await maintenanceModeMiddleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows admin users through via session passport role", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const req = mockReq({
      originalUrl: "/api/data",
      session: { passport: { user: { role: "admin" } } },
    });
    const next = mockNext();
    await maintenanceModeMiddleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next when getSettingValue throws (fail-open)", async () => {
    mockGetSettingValue.mockRejectedValue(new Error("DB down"));
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("uses fallback URL from baseUrl + path when originalUrl is empty", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const next = mockNext();
    const req = mockReq({
      originalUrl: "",
      baseUrl: "/api",
      path: "/health",
    });
    await maintenanceModeMiddleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("blocks non-exempt API routes for non-admin users", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    mockGetActorEmailFromRequest.mockReturnValue("regular@example.com");
    mockGetActorIdFromRequest.mockReturnValue(null);
    const res = mockRes();
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/api/conversations" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });

  it("allows /api/callback during maintenance", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/api/callback/oauth" }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows /api/metrics during maintenance", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/api/metrics" }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows /api/status during maintenance", async () => {
    mockGetSettingValue.mockResolvedValue(true);
    const next = mockNext();
    await maintenanceModeMiddleware(mockReq({ originalUrl: "/api/status" }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
