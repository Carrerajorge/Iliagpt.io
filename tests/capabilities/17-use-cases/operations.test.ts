/**
 * Capability tests — Operations use cases (capability 17-operations)
 *
 * Tests cover daily briefing aggregation, project tracking, process
 * automation triggers, and resource management. No external service
 * calls are made; all logic operates on in-memory data structures.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { assertHasShape } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface DataSource {
  name: string;
  items: BriefingItem[];
}

interface BriefingItem {
  id: string;
  title: string;
  priority: "critical" | "high" | "medium" | "low";
  category: string;
  actionable: boolean;
  source: string;
  timestamp: number;
}

interface DailyBriefing {
  generatedAt: number;
  critical: BriefingItem[];
  high: BriefingItem[];
  medium: BriefingItem[];
  low: BriefingItem[];
  actionableCount: number;
  totalItems: number;
}

interface Ticket {
  id: string;
  title: string;
  status: "open" | "in_progress" | "blocked" | "done";
  assignee: string;
  priority: "p0" | "p1" | "p2" | "p3";
  estimatedDays: number;
  daysElapsed: number;
  blockers: string[];
  sprint: string;
}

interface ProjectStatus {
  projectId: string;
  name: string;
  onTrack: boolean;
  blockedTickets: Ticket[];
  completedPct: number;
  estimatedCompletionDate: string;
  riskLevel: "green" | "amber" | "red";
}

interface AutomationRule {
  id: string;
  name: string;
  trigger: {
    type: "threshold" | "schedule" | "event";
    condition: string;
    value?: number;
  };
  actions: Array<{ type: string; target: string; payload: Record<string, unknown> }>;
  enabled: boolean;
}

interface AutomationRun {
  ruleId: string;
  triggeredAt: number;
  actionsExecuted: number;
  status: "success" | "partial" | "failed";
  log: string[];
}

interface Resource {
  id: string;
  name: string;
  type: "person" | "server" | "license";
  capacityUnits: number;
  allocatedUnits: number;
  team: string;
}

interface AllocationConflict {
  resourceId: string;
  resourceName: string;
  requestedUnits: number;
  availableUnits: number;
  deficit: number;
}

// ---------------------------------------------------------------------------
// Operations utilities
// ---------------------------------------------------------------------------

function aggregateBriefings(sources: DataSource[]): DailyBriefing {
  const allItems = sources.flatMap((s) => s.items);
  allItems.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.priority] - order[b.priority];
  });

  return {
    generatedAt: Date.now(),
    critical: allItems.filter((i) => i.priority === "critical"),
    high: allItems.filter((i) => i.priority === "high"),
    medium: allItems.filter((i) => i.priority === "medium"),
    low: allItems.filter((i) => i.priority === "low"),
    actionableCount: allItems.filter((i) => i.actionable).length,
    totalItems: allItems.length,
  };
}

function assessProjectStatus(tickets: Ticket[], projectId: string, projectName: string): ProjectStatus {
  const total = tickets.length;
  const done = tickets.filter((t) => t.status === "done").length;
  const blocked = tickets.filter((t) => t.status === "blocked");
  const completedPct = total > 0 ? Math.round((done / total) * 100) : 0;

  const avgOverrun = tickets.reduce((sum, t) => {
    const overrun = t.daysElapsed - t.estimatedDays;
    return sum + (overrun > 0 ? overrun : 0);
  }, 0) / Math.max(1, total);

  const riskLevel: "green" | "amber" | "red" =
    blocked.length > 0 || avgOverrun > 5 ? "red" : avgOverrun > 2 ? "amber" : "green";

  const remainingDays = Math.ceil(
    tickets
      .filter((t) => t.status !== "done")
      .reduce((sum, t) => sum + Math.max(0, t.estimatedDays - t.daysElapsed), 0) / Math.max(1, total - done),
  );

  const completionDate = new Date(Date.now() + remainingDays * 86400_000).toISOString().slice(0, 10);

  return {
    projectId,
    name: projectName,
    onTrack: riskLevel === "green",
    blockedTickets: blocked,
    completedPct,
    estimatedCompletionDate: completionDate,
    riskLevel,
  };
}

function evaluateAutomationTrigger(
  rule: AutomationRule,
  context: Record<string, unknown>,
): boolean {
  if (!rule.enabled) return false;

  const { trigger } = rule;

  switch (trigger.type) {
    case "threshold": {
      const contextValue = context[trigger.condition];
      return typeof contextValue === "number" && typeof trigger.value === "number"
        ? contextValue >= trigger.value
        : false;
    }
    case "event": {
      return trigger.condition in context && Boolean(context[trigger.condition]);
    }
    case "schedule": {
      // Simplified: always returns true for test purposes
      return true;
    }
    default:
      return false;
  }
}

function checkAllocationConflicts(
  resources: Resource[],
  requests: Array<{ resourceId: string; requestedUnits: number }>,
): AllocationConflict[] {
  const conflicts: AllocationConflict[] = [];

  for (const req of requests) {
    const resource = resources.find((r) => r.id === req.resourceId);
    if (!resource) continue;

    const available = resource.capacityUnits - resource.allocatedUnits;
    if (req.requestedUnits > available) {
      conflicts.push({
        resourceId: resource.id,
        resourceName: resource.name,
        requestedUnits: req.requestedUnits,
        availableUnits: available,
        deficit: req.requestedUnits - available,
      });
    }
  }

  return conflicts;
}

function calculateUtilisation(resources: Resource[]): Array<{ resourceId: string; utilPct: number; status: string }> {
  return resources.map((r) => {
    const utilPct = r.capacityUnits > 0 ? Math.round((r.allocatedUnits / r.capacityUnits) * 100) : 0;
    const status = utilPct >= 90 ? "over-utilised" : utilPct >= 70 ? "healthy" : "under-utilised";
    return { resourceId: r.id, utilPct, status };
  });
}

// ---------------------------------------------------------------------------
// Daily briefings
// ---------------------------------------------------------------------------

describe("Daily briefings", () => {
  const sources: DataSource[] = [
    {
      name: "JIRA",
      items: [
        { id: "j1", title: "Production outage P0", priority: "critical", category: "incident", actionable: true, source: "JIRA", timestamp: Date.now() - 3600 },
        { id: "j2", title: "Deploy blocked by failing tests", priority: "high", category: "engineering", actionable: true, source: "JIRA", timestamp: Date.now() - 1800 },
      ],
    },
    {
      name: "Slack",
      items: [
        { id: "s1", title: "Client meeting at 3pm", priority: "medium", category: "meetings", actionable: true, source: "Slack", timestamp: Date.now() - 900 },
        { id: "s2", title: "Team lunch Friday", priority: "low", category: "social", actionable: false, source: "Slack", timestamp: Date.now() - 600 },
      ],
    },
    {
      name: "PagerDuty",
      items: [
        { id: "pd1", title: "CPU spike on prod-db-01", priority: "high", category: "infrastructure", actionable: true, source: "PagerDuty", timestamp: Date.now() - 300 },
      ],
    },
  ];

  it("aggregates items from multiple sources into a single briefing", () => {
    const briefing = aggregateBriefings(sources);

    expect(briefing.totalItems).toBe(5);
    assertHasShape(briefing, {
      generatedAt: "number",
      critical: "array",
      high: "array",
      medium: "array",
      low: "array",
      actionableCount: "number",
      totalItems: "number",
    });
  });

  it("sorts items by priority with critical items first", () => {
    const briefing = aggregateBriefings(sources);

    expect(briefing.critical).toHaveLength(1);
    expect(briefing.critical[0].id).toBe("j1");
    expect(briefing.high).toHaveLength(2);
  });

  it("counts only actionable items in the actionable summary", () => {
    const briefing = aggregateBriefings(sources);

    // j1, j2, s1, pd1 are actionable (4); s2 is not
    expect(briefing.actionableCount).toBe(4);
  });

  it("handles empty source lists gracefully", () => {
    const briefing = aggregateBriefings([]);
    expect(briefing.totalItems).toBe(0);
    expect(briefing.actionableCount).toBe(0);
    expect(briefing.critical).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Project tracking
// ---------------------------------------------------------------------------

describe("Project tracking", () => {
  const tickets: Ticket[] = [
    { id: "t1", title: "Design API", status: "done", assignee: "alice", priority: "p1", estimatedDays: 3, daysElapsed: 3, blockers: [], sprint: "S14" },
    { id: "t2", title: "Implement endpoint", status: "in_progress", assignee: "bob", priority: "p1", estimatedDays: 5, daysElapsed: 4, blockers: [], sprint: "S14" },
    { id: "t3", title: "Write tests", status: "blocked", assignee: "carol", priority: "p2", estimatedDays: 2, daysElapsed: 3, blockers: ["Waiting for API finalization"], sprint: "S14" },
    { id: "t4", title: "Deploy to staging", status: "open", assignee: "alice", priority: "p1", estimatedDays: 1, daysElapsed: 0, blockers: [], sprint: "S14" },
  ];

  it("generates project status from ticket data", () => {
    const status = assessProjectStatus(tickets, "proj_001", "API v2");

    assertHasShape(status, {
      projectId: "string",
      name: "string",
      onTrack: "boolean",
      blockedTickets: "array",
      completedPct: "number",
      estimatedCompletionDate: "string",
      riskLevel: "string",
    });

    expect(status.completedPct).toBe(25); // 1/4 tickets done
  });

  it("identifies blocked tickets from ticket status", () => {
    const status = assessProjectStatus(tickets, "proj_001", "API v2");

    expect(status.blockedTickets).toHaveLength(1);
    expect(status.blockedTickets[0].id).toBe("t3");
    expect(status.blockedTickets[0].blockers[0]).toContain("API finalization");
  });

  it("flags project as red risk when blockers exist", () => {
    const status = assessProjectStatus(tickets, "proj_001", "API v2");

    expect(status.riskLevel).toBe("red");
    expect(status.onTrack).toBe(false);
  });

  it("marks project green when all tickets are on time and unblocked", () => {
    const healthyTickets: Ticket[] = [
      { id: "h1", title: "Task 1", status: "done", assignee: "alice", priority: "p1", estimatedDays: 3, daysElapsed: 3, blockers: [], sprint: "S15" },
      { id: "h2", title: "Task 2", status: "in_progress", assignee: "bob", priority: "p2", estimatedDays: 5, daysElapsed: 2, blockers: [], sprint: "S15" },
    ];

    const status = assessProjectStatus(healthyTickets, "proj_002", "Healthy Project");
    expect(status.riskLevel).toBe("green");
    expect(status.onTrack).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Process automation
// ---------------------------------------------------------------------------

describe("Process automation", () => {
  const rules: AutomationRule[] = [
    {
      id: "rule_01",
      name: "Alert on high error rate",
      trigger: { type: "threshold", condition: "error_rate_pct", value: 5 },
      actions: [
        { type: "notify", target: "slack:#ops-alerts", payload: { message: "Error rate exceeded 5%" } },
        { type: "create_ticket", target: "JIRA", payload: { priority: "p0", title: "High error rate detected" } },
      ],
      enabled: true,
    },
    {
      id: "rule_02",
      name: "Weekly report",
      trigger: { type: "schedule", condition: "0 9 * * 1" },
      actions: [
        { type: "generate_report", target: "email:team@company.com", payload: { template: "weekly_summary" } },
      ],
      enabled: true,
    },
    {
      id: "rule_03",
      name: "Disabled rule",
      trigger: { type: "threshold", condition: "cpu_pct", value: 80 },
      actions: [],
      enabled: false,
    },
  ];

  it("fires a rule when its threshold condition is met", () => {
    const context = { error_rate_pct: 7.2 };
    const shouldFire = evaluateAutomationTrigger(rules[0], context);
    expect(shouldFire).toBe(true);
  });

  it("does not fire a rule when threshold is not reached", () => {
    const context = { error_rate_pct: 2.1 };
    const shouldFire = evaluateAutomationTrigger(rules[0], context);
    expect(shouldFire).toBe(false);
  });

  it("skips disabled rules regardless of context", () => {
    const context = { cpu_pct: 95 }; // Would trigger if enabled
    const shouldFire = evaluateAutomationTrigger(rules[2], context);
    expect(shouldFire).toBe(false);
  });

  it("executes multiple actions when a rule fires", () => {
    const executedActions: string[] = [];

    function executeRule(rule: AutomationRule, context: Record<string, unknown>): AutomationRun {
      const shouldFire = evaluateAutomationTrigger(rule, context);
      const log: string[] = [];
      let actionsExecuted = 0;

      if (shouldFire) {
        for (const action of rule.actions) {
          executedActions.push(`${action.type}:${action.target}`);
          log.push(`Executed ${action.type} → ${action.target}`);
          actionsExecuted++;
        }
      }

      return {
        ruleId: rule.id,
        triggeredAt: Date.now(),
        actionsExecuted,
        status: actionsExecuted === rule.actions.length ? "success" : "partial",
        log,
      };
    }

    const run = executeRule(rules[0], { error_rate_pct: 8 });

    expect(run.actionsExecuted).toBe(2);
    expect(run.status).toBe("success");
    expect(executedActions).toContain("notify:slack:#ops-alerts");
    expect(executedActions).toContain("create_ticket:JIRA");
  });
});

// ---------------------------------------------------------------------------
// Resource management
// ---------------------------------------------------------------------------

describe("Resource management", () => {
  const resources: Resource[] = [
    { id: "r1", name: "Alice Chen", type: "person", capacityUnits: 40, allocatedUnits: 32, team: "engineering" },
    { id: "r2", name: "Bob Smith", type: "person", capacityUnits: 40, allocatedUnits: 40, team: "engineering" },
    { id: "r3", name: "prod-server-01", type: "server", capacityUnits: 100, allocatedUnits: 85, team: "infra" },
    { id: "r4", name: "Figma license", type: "license", capacityUnits: 5, allocatedUnits: 3, team: "design" },
  ];

  it("identifies allocation conflicts when requests exceed available capacity", () => {
    const requests = [
      { resourceId: "r1", requestedUnits: 10 }, // Available: 8 → conflict
      { resourceId: "r2", requestedUnits: 5 },  // Available: 0 → conflict
      { resourceId: "r4", requestedUnits: 2 },  // Available: 2 → no conflict
    ];

    const conflicts = checkAllocationConflicts(resources, requests);

    expect(conflicts).toHaveLength(2);
    expect(conflicts.find((c) => c.resourceId === "r1")?.deficit).toBe(2);
    expect(conflicts.find((c) => c.resourceId === "r2")?.deficit).toBe(5);
    expect(conflicts.find((c) => c.resourceId === "r4")).toBeUndefined();
  });

  it("calculates utilisation percentage per resource", () => {
    const utilisation = calculateUtilisation(resources);

    expect(utilisation).toHaveLength(4);

    const bobUtil = utilisation.find((u) => u.resourceId === "r2");
    expect(bobUtil?.utilPct).toBe(100);
    expect(bobUtil?.status).toBe("over-utilised");

    const aliceUtil = utilisation.find((u) => u.resourceId === "r1");
    expect(aliceUtil?.utilPct).toBe(80);
    expect(aliceUtil?.status).toBe("healthy");
  });

  it("returns conflict details with required shape", () => {
    const requests = [{ resourceId: "r3", requestedUnits: 20 }]; // Only 15 available
    const conflicts = checkAllocationConflicts(resources, requests);

    expect(conflicts).toHaveLength(1);
    assertHasShape(conflicts[0], {
      resourceId: "string",
      resourceName: "string",
      requestedUnits: "number",
      availableUnits: "number",
      deficit: "number",
    });
    expect(conflicts[0].deficit).toBe(5);
  });
});
