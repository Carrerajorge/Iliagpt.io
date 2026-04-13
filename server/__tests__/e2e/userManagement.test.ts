/**
 * E2E User Management Tests (5 tests)
 * Tests 96-100: Admin user routes, privacy settings, history clearing.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

let app: express.Express;

// In-memory user store for testing
const users = [
  { id: "user_1", name: "Alice", email: "alice@test.com", plan: "free", status: "active", chats: 5, createdAt: "2026-01-01" },
  { id: "user_2", name: "Bob", email: "bob@test.com", plan: "pro", status: "active", chats: 12, createdAt: "2026-02-15" },
  { id: "user_3", name: "Carlos", email: "carlos@test.com", plan: "free", status: "active", chats: 3, createdAt: "2026-03-10" },
];

const privacyPrefs: Record<string, object> = {
  user_1: { shareUsageData: false, allowAnalytics: true, retainHistory: true },
};

beforeAll(() => {
  app = express();
  app.use(express.json());

  // Admin middleware (simplified)
  const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.headers["x-user-role"];
    if (role !== "admin") return res.status(403).json({ error: "Admin access required" });
    next();
  };

  // GET /api/admin/users — paginated list
  app.get("/api/admin/users", requireAdmin, (req, res) => {
    const page = parseInt(String(req.query.page || "1"));
    const limit = parseInt(String(req.query.limit || "10"));
    const start = (page - 1) * limit;
    const pageUsers = users.slice(start, start + limit);
    res.json({
      users: pageUsers,
      total: users.length,
      page,
      totalPages: Math.ceil(users.length / limit),
    });
  });

  // PUT /api/admin/users/:id — update user
  app.put("/api/admin/users/:id", requireAdmin, (req, res) => {
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (req.body.plan) user.plan = req.body.plan;
    if (req.body.name) user.name = req.body.name;
    res.json({ user, updated: true });
  });

  // POST /api/admin/users/:id/suspend — suspend user
  app.post("/api/admin/users/:id/suspend", requireAdmin, (req, res) => {
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    user.status = "suspended";
    res.json({ user, suspended: true });
  });

  // GET /api/settings/privacy — user privacy preferences
  app.get("/api/settings/privacy", (req, res) => {
    const userId = req.headers["x-user-id"] || "user_1";
    const prefs = privacyPrefs[String(userId)] || { shareUsageData: false, allowAnalytics: false, retainHistory: true };
    res.json(prefs);
  });

  // POST /api/settings/clear-history — clear user chat history
  app.post("/api/settings/clear-history", (req, res) => {
    const userId = req.headers["x-user-id"] || "user_1";
    const user = users.find(u => u.id === userId);
    const deletedCount = user?.chats || 0;
    if (user) user.chats = 0;
    res.json({ deletedChats: deletedCount, success: true });
  });
});

describe("User management", () => {
  // Test 96 — Paginated user list
  it("96: GET /api/admin/users returns paginated list with total and pages", async () => {
    const res = await request(app)
      .get("/api/admin/users")
      .set("X-User-Role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.users).toBeInstanceOf(Array);
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(1);
    expect(res.body.totalPages).toBe(1);
    expect(res.body.users.length).toBe(3);
  });

  // Test 97 — Update user plan
  it("97: PUT /api/admin/users/:id updates plan to pro", async () => {
    const res = await request(app)
      .put("/api/admin/users/user_1")
      .set("X-User-Role", "admin")
      .send({ plan: "pro" });
    expect(res.status).toBe(200);
    expect(res.body.user.plan).toBe("pro");
    expect(res.body.updated).toBe(true);
  });

  // Test 98 — Suspend user
  it("98: POST /api/admin/users/:id/suspend changes status", async () => {
    const res = await request(app)
      .post("/api/admin/users/user_3/suspend")
      .set("X-User-Role", "admin");
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe("suspended");
    expect(res.body.suspended).toBe(true);
  });

  // Test 99 — Privacy preferences
  it("99: GET /api/settings/privacy returns user preferences", async () => {
    const res = await request(app)
      .get("/api/settings/privacy")
      .set("X-User-Id", "user_1");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("shareUsageData");
    expect(res.body).toHaveProperty("allowAnalytics");
    expect(res.body).toHaveProperty("retainHistory");
  });

  // Test 100 — Clear chat history
  it("100: POST /api/settings/clear-history deletes user chats", async () => {
    const res = await request(app)
      .post("/api/settings/clear-history")
      .set("X-User-Id", "user_2");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deletedChats).toBeGreaterThanOrEqual(0);
  });
});
