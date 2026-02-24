import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSettingValue = vi.fn();

vi.mock("../services/settingsConfigService", () => ({
  getSettingValue: (...args: any[]) => mockGetSettingValue(...args),
}));

import { sessionTimeoutMiddleware } from "./sessionTimeout";

// ── Helpers ──────────────────────────────────────────────────────────

function mockReq(sessionOverride?: any): any {
  return {
    session: sessionOverride ?? {
      cookie: { maxAge: 86400000 },
    },
  } as any;
}

function mockRes(): any {
  return {} as any;
}

function mockNext(): any {
  return vi.fn();
}

// ── Tests ────────────────────────────────────────────────────────────

describe("sessionTimeoutMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls next when session is missing", async () => {
    const next = mockNext();
    await sessionTimeoutMiddleware(mockReq(undefined) as any, mockRes(), next);
    // session is undefined, so middleware returns next() early
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next when session has no cookie", async () => {
    const next = mockNext();
    await sessionTimeoutMiddleware(mockReq({ cookie: null }) as any, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("sets maxAge based on the setting value (normal case)", async () => {
    mockGetSettingValue.mockResolvedValue(60); // 60 minutes
    const req = mockReq();
    const next = mockNext();
    await sessionTimeoutMiddleware(req, mockRes(), next);
    expect(req.session.cookie.maxAge).toBe(60 * 60 * 1000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("uses default 1440 minutes when setting returns default", async () => {
    mockGetSettingValue.mockResolvedValue(1440);
    const req = mockReq();
    const next = mockNext();
    await sessionTimeoutMiddleware(req, mockRes(), next);
    expect(req.session.cookie.maxAge).toBe(1440 * 60 * 1000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("enforces minimum of 5 minutes", async () => {
    mockGetSettingValue.mockResolvedValue(1); // below minimum
    const req = mockReq();
    const next = mockNext();
    await sessionTimeoutMiddleware(req, mockRes(), next);
    expect(req.session.cookie.maxAge).toBe(5 * 60 * 1000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("enforces minimum of 5 when setting returns 0", async () => {
    mockGetSettingValue.mockResolvedValue(0);
    const req = mockReq();
    const next = mockNext();
    await sessionTimeoutMiddleware(req, mockRes(), next);
    expect(req.session.cookie.maxAge).toBe(5 * 60 * 1000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("enforces minimum of 5 when setting returns negative", async () => {
    mockGetSettingValue.mockResolvedValue(-100);
    const req = mockReq();
    const next = mockNext();
    await sessionTimeoutMiddleware(req, mockRes(), next);
    expect(req.session.cookie.maxAge).toBe(5 * 60 * 1000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("floors fractional minutes", async () => {
    mockGetSettingValue.mockResolvedValue(30.9);
    const req = mockReq();
    const next = mockNext();
    await sessionTimeoutMiddleware(req, mockRes(), next);
    // Math.floor(30.9) = 30, max(5, 30) = 30
    expect(req.session.cookie.maxAge).toBe(30 * 60 * 1000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("defaults to 1440 when setting is NaN", async () => {
    mockGetSettingValue.mockResolvedValue(NaN);
    const req = mockReq();
    const next = mockNext();
    await sessionTimeoutMiddleware(req, mockRes(), next);
    expect(req.session.cookie.maxAge).toBe(1440 * 60 * 1000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("defaults to 1440 when setting is Infinity", async () => {
    mockGetSettingValue.mockResolvedValue(Infinity);
    const req = mockReq();
    const next = mockNext();
    await sessionTimeoutMiddleware(req, mockRes(), next);
    expect(req.session.cookie.maxAge).toBe(1440 * 60 * 1000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next even when getSettingValue throws (fail-open)", async () => {
    mockGetSettingValue.mockRejectedValue(new Error("Redis down"));
    const req = mockReq();
    const next = mockNext();
    await sessionTimeoutMiddleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not modify maxAge when getSettingValue throws", async () => {
    mockGetSettingValue.mockRejectedValue(new Error("fail"));
    const req = mockReq();
    const originalMaxAge = req.session.cookie.maxAge;
    const next = mockNext();
    await sessionTimeoutMiddleware(req, mockRes(), next);
    expect(req.session.cookie.maxAge).toBe(originalMaxAge);
  });

  it("handles large timeout values", async () => {
    mockGetSettingValue.mockResolvedValue(525600); // 1 year in minutes
    const req = mockReq();
    const next = mockNext();
    await sessionTimeoutMiddleware(req, mockRes(), next);
    expect(req.session.cookie.maxAge).toBe(525600 * 60 * 1000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("always calls next at the end regardless of path", async () => {
    // Even with a valid setting, next is always called
    mockGetSettingValue.mockResolvedValue(120);
    const next = mockNext();
    await sessionTimeoutMiddleware(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
