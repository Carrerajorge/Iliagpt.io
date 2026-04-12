/**
 * Capability tests — Enterprise features (capability 16)
 *
 * Tests cover RBAC, spending limits, analytics API, OpenTelemetry
 * trace/span/metric instrumentation, and per-connector controls.
 * All external services (database, telemetry exporter) are mocked.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { assertHasShape } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

type Role = "super_admin" | "org_admin" | "team_lead" | "member" | "viewer";

interface RolePermissions {
  canManageUsers: boolean;
  canManageBilling: boolean;
  canViewAnalytics: boolean;
  canConfigureConnectors: boolean;
  canDeleteData: boolean;
  canInvokeAgents: boolean;
}

interface Permission {
  resource: string;
  action: "read" | "write" | "delete" | "admin";
}

interface RBACPolicy {
  roleId: Role;
  permissions: Permission[];
  inheritFrom?: Role;
  denyRules: Permission[];
}

interface SpendingLimit {
  userId: string;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  alertThresholdPct: number;
}

interface UsageRecord {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: number;
}

interface AnalyticsMetrics {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  byModel: Record<string, { requests: number; tokens: number; costUsd: number }>;
  byUser: Record<string, { requests: number; costUsd: number }>;
  periodStart: number;
  periodEnd: number;
}

interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime: number;
  attributes: Record<string, string | number | boolean>;
  status: "ok" | "error" | "unset";
}

interface ConnectorControl {
  connectorId: string;
  orgId: string;
  enabled: boolean;
  userOverridesAllowed: boolean;
  auditEnabled: boolean;
  updatedAt: number;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// RBAC engine
// ---------------------------------------------------------------------------

const ROLE_DEFAULTS: Record<Role, RolePermissions> = {
  super_admin: {
    canManageUsers: true,
    canManageBilling: true,
    canViewAnalytics: true,
    canConfigureConnectors: true,
    canDeleteData: true,
    canInvokeAgents: true,
  },
  org_admin: {
    canManageUsers: true,
    canManageBilling: true,
    canViewAnalytics: true,
    canConfigureConnectors: true,
    canDeleteData: false,
    canInvokeAgents: true,
  },
  team_lead: {
    canManageUsers: false,
    canManageBilling: false,
    canViewAnalytics: true,
    canConfigureConnectors: false,
    canDeleteData: false,
    canInvokeAgents: true,
  },
  member: {
    canManageUsers: false,
    canManageBilling: false,
    canViewAnalytics: false,
    canConfigureConnectors: false,
    canDeleteData: false,
    canInvokeAgents: true,
  },
  viewer: {
    canManageUsers: false,
    canManageBilling: false,
    canViewAnalytics: false,
    canConfigureConnectors: false,
    canDeleteData: false,
    canInvokeAgents: false,
  },
};

class RBACEngine {
  private policies = new Map<Role, RBACPolicy>();
  private userRoles = new Map<string, Role[]>();

  assignRole(userId: string, role: Role): void {
    const existing = this.userRoles.get(userId) ?? [];
    if (!existing.includes(role)) {
      this.userRoles.set(userId, [...existing, role]);
    }
  }

  getRoles(userId: string): Role[] {
    return this.userRoles.get(userId) ?? [];
  }

  hasPermission(userId: string, permission: keyof RolePermissions): boolean {
    const roles = this.getRoles(userId);
    for (const role of roles) {
      if (ROLE_DEFAULTS[role][permission]) return true;
    }
    return false;
  }

  getEffectivePermissions(userId: string): RolePermissions {
    const roles = this.getRoles(userId);
    const effective: RolePermissions = {
      canManageUsers: false,
      canManageBilling: false,
      canViewAnalytics: false,
      canConfigureConnectors: false,
      canDeleteData: false,
      canInvokeAgents: false,
    };

    for (const role of roles) {
      const defaults = ROLE_DEFAULTS[role];
      for (const key of Object.keys(effective) as (keyof RolePermissions)[]) {
        if (defaults[key]) effective[key] = true;
      }
    }

    return effective;
  }
}

// ---------------------------------------------------------------------------
// Spending limit engine
// ---------------------------------------------------------------------------

class BudgetEnforcer {
  private usage = new Map<string, { dailyUsd: number; monthlyUsd: number; dayKey: string }>();
  private limits = new Map<string, SpendingLimit>();
  private alerts: Array<{ userId: string; type: "daily" | "monthly"; pct: number; ts: number }> = [];

  setLimit(limit: SpendingLimit): void {
    this.limits.set(limit.userId, limit);
  }

  recordUsage(userId: string, costUsd: number): { allowed: boolean; reason?: string } {
    const limit = this.limits.get(userId);
    const dayKey = new Date().toISOString().slice(0, 10);

    const current = this.usage.get(userId) ?? { dailyUsd: 0, monthlyUsd: 0, dayKey };
    if (current.dayKey !== dayKey) {
      current.dailyUsd = 0;
      current.dayKey = dayKey;
    }

    if (limit) {
      if (current.dailyUsd + costUsd > limit.dailyBudgetUsd) {
        return { allowed: false, reason: `Daily budget of $${limit.dailyBudgetUsd} exceeded` };
      }
      if (current.monthlyUsd + costUsd > limit.monthlyBudgetUsd) {
        return { allowed: false, reason: `Monthly budget of $${limit.monthlyBudgetUsd} exceeded` };
      }

      const newDailyPct = ((current.dailyUsd + costUsd) / limit.dailyBudgetUsd) * 100;
      if (newDailyPct >= limit.alertThresholdPct) {
        this.alerts.push({ userId, type: "daily", pct: newDailyPct, ts: Date.now() });
      }
    }

    current.dailyUsd += costUsd;
    current.monthlyUsd += costUsd;
    this.usage.set(userId, current);

    return { allowed: true };
  }

  getDailyUsage(userId: string): number {
    return this.usage.get(userId)?.dailyUsd ?? 0;
  }

  getAlerts(): typeof this.alerts {
    return [...this.alerts];
  }
}

// ---------------------------------------------------------------------------
// Analytics aggregator
// ---------------------------------------------------------------------------

function aggregateUsage(records: UsageRecord[]): AnalyticsMetrics {
  const byModel: AnalyticsMetrics["byModel"] = {};
  const byUser: AnalyticsMetrics["byUser"] = {};
  let totalTokens = 0;
  let totalCostUsd = 0;

  for (const r of records) {
    const tokens = r.inputTokens + r.outputTokens;
    totalTokens += tokens;
    totalCostUsd += r.costUsd;

    if (!byModel[r.model]) byModel[r.model] = { requests: 0, tokens: 0, costUsd: 0 };
    byModel[r.model].requests++;
    byModel[r.model].tokens += tokens;
    byModel[r.model].costUsd += r.costUsd;

    if (!byUser[r.userId]) byUser[r.userId] = { requests: 0, costUsd: 0 };
    byUser[r.userId].requests++;
    byUser[r.userId].costUsd += r.costUsd;
  }

  const timestamps = records.map((r) => r.timestamp);
  return {
    totalRequests: records.length,
    totalTokens,
    totalCostUsd,
    byModel,
    byUser,
    periodStart: timestamps.length > 0 ? Math.min(...timestamps) : Date.now(),
    periodEnd: timestamps.length > 0 ? Math.max(...timestamps) : Date.now(),
  };
}

// ---------------------------------------------------------------------------
// OTel trace/span builder (mock)
// ---------------------------------------------------------------------------

let spanIdCounter = 0;

function createSpan(
  name: string,
  traceId: string,
  parentSpanId?: string,
  attributes: Record<string, string | number | boolean> = {},
): OtelSpan {
  const spanId = `span_${++spanIdCounter}`;
  return {
    traceId,
    spanId,
    parentSpanId,
    name,
    startTime: Date.now(),
    endTime: Date.now() + 50,
    attributes,
    status: "ok",
  };
}

// ---------------------------------------------------------------------------
// RBAC tests
// ---------------------------------------------------------------------------

describe("RBAC", () => {
  let engine: RBACEngine;

  beforeEach(() => {
    engine = new RBACEngine();
  });

  it("assigns roles to users and verifies correct permissions", () => {
    engine.assignRole("user_001", "member");
    engine.assignRole("user_002", "org_admin");
    engine.assignRole("user_003", "viewer");

    expect(engine.hasPermission("user_001", "canInvokeAgents")).toBe(true);
    expect(engine.hasPermission("user_001", "canManageUsers")).toBe(false);
    expect(engine.hasPermission("user_002", "canManageUsers")).toBe(true);
    expect(engine.hasPermission("user_002", "canManageBilling")).toBe(true);
    expect(engine.hasPermission("user_003", "canInvokeAgents")).toBe(false);
  });

  it("combines permissions when a user holds multiple roles", () => {
    engine.assignRole("user_multi", "member");
    engine.assignRole("user_multi", "team_lead");

    const perms = engine.getEffectivePermissions("user_multi");
    // team_lead adds canViewAnalytics
    expect(perms.canInvokeAgents).toBe(true);
    expect(perms.canViewAnalytics).toBe(true);
    // Neither role has these
    expect(perms.canManageUsers).toBe(false);
    expect(perms.canDeleteData).toBe(false);
  });

  it("super_admin has all permissions enabled", () => {
    engine.assignRole("admin_user", "super_admin");
    const perms = engine.getEffectivePermissions("admin_user");

    for (const key of Object.keys(perms) as (keyof RolePermissions)[]) {
      expect(perms[key]).toBe(true);
    }
  });

  it("returns empty role list for unknown users", () => {
    const roles = engine.getRoles("unknown_user");
    expect(roles).toHaveLength(0);
    expect(engine.hasPermission("unknown_user", "canInvokeAgents")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Spending limits
// ---------------------------------------------------------------------------

describe("Spending limits", () => {
  let enforcer: BudgetEnforcer;

  beforeEach(() => {
    enforcer = new BudgetEnforcer();
    enforcer.setLimit({
      userId: "user_001",
      dailyBudgetUsd: 5.0,
      monthlyBudgetUsd: 50.0,
      alertThresholdPct: 80,
    });
  });

  it("allows usage within daily budget", () => {
    const result = enforcer.recordUsage("user_001", 1.50);
    expect(result.allowed).toBe(true);
    expect(enforcer.getDailyUsage("user_001")).toBeCloseTo(1.50);
  });

  it("blocks usage when daily budget would be exceeded", () => {
    enforcer.recordUsage("user_001", 4.50); // cumulative: $4.50
    const result = enforcer.recordUsage("user_001", 1.00); // would reach $5.50 > $5.00

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily budget");
  });

  it("fires an alert when usage crosses the threshold percentage", () => {
    enforcer.recordUsage("user_001", 4.20); // 84% of $5.00 → over 80% threshold

    const alerts = enforcer.getAlerts();
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].userId).toBe("user_001");
    expect(alerts[0].pct).toBeGreaterThanOrEqual(80);
  });

  it("applies unlimited usage for users without a spending limit set", () => {
    // user_999 has no limit set
    const r1 = enforcer.recordUsage("user_999", 100.00);
    const r2 = enforcer.recordUsage("user_999", 200.00);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Analytics API
// ---------------------------------------------------------------------------

describe("Analytics API", () => {
  const now = Date.now();

  const sampleRecords: UsageRecord[] = [
    { userId: "user_001", model: "gpt-4o", inputTokens: 500, outputTokens: 300, costUsd: 0.024, timestamp: now - 3600 },
    { userId: "user_001", model: "claude-3-5-sonnet", inputTokens: 800, outputTokens: 400, costUsd: 0.036, timestamp: now - 1800 },
    { userId: "user_002", model: "gpt-4o", inputTokens: 200, outputTokens: 150, costUsd: 0.011, timestamp: now - 900 },
    { userId: "user_003", model: "gemini-1.5-pro", inputTokens: 1000, outputTokens: 600, costUsd: 0.016, timestamp: now },
  ];

  it("aggregates total requests, tokens and cost correctly", () => {
    const metrics = aggregateUsage(sampleRecords);

    expect(metrics.totalRequests).toBe(4);
    expect(metrics.totalTokens).toBe(500 + 300 + 800 + 400 + 200 + 150 + 1000 + 600);
    expect(metrics.totalCostUsd).toBeCloseTo(0.024 + 0.036 + 0.011 + 0.016, 5);
  });

  it("breaks down token consumption by model", () => {
    const metrics = aggregateUsage(sampleRecords);

    expect(metrics.byModel["gpt-4o"]).toBeDefined();
    expect(metrics.byModel["gpt-4o"].requests).toBe(2);
    expect(metrics.byModel["claude-3-5-sonnet"].requests).toBe(1);
    expect(metrics.byModel["gemini-1.5-pro"].requests).toBe(1);
  });

  it("attributes cost per user for charge-back reporting", () => {
    const metrics = aggregateUsage(sampleRecords);

    expect(metrics.byUser["user_001"]).toBeDefined();
    expect(metrics.byUser["user_001"].requests).toBe(2);
    expect(metrics.byUser["user_001"].costUsd).toBeCloseTo(0.024 + 0.036, 5);
    expect(metrics.byUser["user_002"].costUsd).toBeCloseTo(0.011, 5);
  });
});

// ---------------------------------------------------------------------------
// OpenTelemetry
// ---------------------------------------------------------------------------

describe("OpenTelemetry", () => {
  beforeEach(() => {
    spanIdCounter = 0;
  });

  it("propagates trace ID across parent and child spans", () => {
    const traceId = "trace_abc123";
    const root = createSpan("http.request", traceId, undefined, { "http.method": "POST" });
    const child1 = createSpan("llm.invoke", traceId, root.spanId, { "llm.model": "gpt-4o" });
    const child2 = createSpan("tool.execute", traceId, root.spanId, { "tool.name": "web_search" });

    expect(root.traceId).toBe(traceId);
    expect(child1.traceId).toBe(traceId);
    expect(child2.traceId).toBe(traceId);
    expect(child1.parentSpanId).toBe(root.spanId);
    expect(child2.parentSpanId).toBe(root.spanId);
  });

  it("creates spans with required OTel fields", () => {
    const span = createSpan("agent.run", "trace_xyz", undefined, {
      "agent.type": "research",
      "agent.model": "claude-3-5-sonnet",
    });

    assertHasShape(span, {
      traceId: "string",
      spanId: "string",
      name: "string",
      startTime: "number",
      endTime: "number",
      status: "string",
    });

    expect(span.attributes["agent.type"]).toBe("research");
  });

  it("exports spans in a format compatible with OTel JSON format", () => {
    const spans: OtelSpan[] = [
      createSpan("http.request", "trace_001", undefined, { "http.status_code": 200 }),
      createSpan("db.query", "trace_001", "span_1", { "db.system": "postgresql" }),
    ];

    // Simulate export to JSON (OTLP-like format)
    const exportPayload = {
      resourceSpans: [
        {
          resource: { attributes: { "service.name": "iliagpt", "service.version": "1.0.0" } },
          scopeSpans: [
            {
              scope: { name: "iliagpt.instrumentation", version: "1.0.0" },
              spans: spans.map((s) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                parentSpanId: s.parentSpanId,
                name: s.name,
                startTimeUnixNano: s.startTime * 1_000_000,
                endTimeUnixNano: s.endTime * 1_000_000,
                attributes: Object.entries(s.attributes).map(([k, v]) => ({ key: k, value: v })),
                status: { code: s.status === "ok" ? 1 : 2 },
              })),
            },
          ],
        },
      ],
    };

    expect(exportPayload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
    expect(exportPayload.resourceSpans[0].scopeSpans[0].spans[0].traceId).toBe("trace_001");
  });
});

// ---------------------------------------------------------------------------
// Per-connector controls
// ---------------------------------------------------------------------------

describe("Per-connector controls", () => {
  const connectors: ConnectorControl[] = [
    {
      connectorId: "slack",
      orgId: "org_001",
      enabled: true,
      userOverridesAllowed: false,
      auditEnabled: true,
      updatedAt: Date.now(),
      updatedBy: "admin_001",
    },
    {
      connectorId: "github",
      orgId: "org_001",
      enabled: true,
      userOverridesAllowed: true,
      auditEnabled: true,
      updatedAt: Date.now(),
      updatedBy: "admin_001",
    },
    {
      connectorId: "jira",
      orgId: "org_001",
      enabled: false,
      userOverridesAllowed: false,
      auditEnabled: false,
      updatedAt: Date.now(),
      updatedBy: "admin_001",
    },
  ];

  function getConnector(connectorId: string): ConnectorControl | undefined {
    return connectors.find((c) => c.connectorId === connectorId);
  }

  it("disables a specific connector for the organisation", () => {
    const jira = getConnector("jira");
    expect(jira?.enabled).toBe(false);

    // Verify that a disabled connector cannot be invoked
    function canInvokeConnector(connectorId: string): boolean {
      return getConnector(connectorId)?.enabled ?? false;
    }

    expect(canInvokeConnector("jira")).toBe(false);
    expect(canInvokeConnector("slack")).toBe(true);
  });

  it("respects per-connector user-override flags", () => {
    function userCanOverride(connectorId: string): boolean {
      return getConnector(connectorId)?.userOverridesAllowed ?? false;
    }

    expect(userCanOverride("github")).toBe(true);
    expect(userCanOverride("slack")).toBe(false);
    expect(userCanOverride("jira")).toBe(false);
  });

  it("logs connector invocation when audit is enabled for that connector", () => {
    const auditLog: Array<{ connectorId: string; userId: string; action: string; ts: number }> = [];

    function invokeConnector(connectorId: string, userId: string, action: string): boolean {
      const connector = getConnector(connectorId);
      if (!connector?.enabled) return false;

      if (connector.auditEnabled) {
        auditLog.push({ connectorId, userId, action, ts: Date.now() });
      }

      return true;
    }

    invokeConnector("slack", "user_001", "send_message");
    invokeConnector("github", "user_001", "create_pr");
    invokeConnector("jira", "user_001", "create_issue"); // should fail silently

    expect(auditLog).toHaveLength(2); // slack and github only
    expect(auditLog[0].connectorId).toBe("slack");
    expect(auditLog[1].connectorId).toBe("github");
  });
});
