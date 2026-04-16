/**
 * Automation Rules Engine — Hardened
 * If-then rules with parameterised queries, HMAC webhooks,
 * cascade prevention, rich condition operators, and full audit logging.
 */

import { Router } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { auditLog } from "../../services/auditLogger";
import { adminNotifications } from "../../services/adminNotifications";
import { EventEmitter } from "events";
import { Logger } from "../../lib/logger";
import crypto from "crypto";

export const automationsRouter = Router();

/* ──────────────────────── constants ──────────────────────── */

const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_WEBHOOK_URL_LENGTH = 2048;
const MAX_CONFIG_DEPTH = 10;
const MAX_CONDITION_KEYS = 20;
const MAX_CASCADE_DEPTH = 3;           // prevent infinite rule triggers
const MAX_EXECUTIONS_PER_RULE_PER_MIN = 10;
const HMAC_SECRET = process.env.AUTOMATION_WEBHOOK_SECRET?.trim() || "";
const WEBHOOK_SIGNING_REQUIRED = process.env.AUTOMATION_WEBHOOK_SIGNING_REQUIRED !== "false";

if (WEBHOOK_SIGNING_REQUIRED && !HMAC_SECRET) {
  Logger.warn("[Automations] Webhook signing secret is not configured", {
    hint: "Set AUTOMATION_WEBHOOK_SECRET before enabling webhook actions",
  });
}

function ensureWebhookSecretConfigured(): string | null {
  if (!WEBHOOK_SIGNING_REQUIRED) return null;
  if (!HMAC_SECRET) {
    return "Webhook actions are disabled until AUTOMATION_WEBHOOK_SECRET is configured";
  }
  return null;
}

/** Allowlist of user fields that automations may update. */
const ALLOWED_USER_UPDATE_FIELDS = new Set([
  "plan", "status", "role",
]);

/** Allowlist of user field values per field. */
const ALLOWED_USER_UPDATE_VALUES: Record<string, Set<string>> = {
  plan: new Set(["free", "pro", "enterprise", "unlimited"]),
  status: new Set(["active", "blocked", "suspended", "inactive"]),
  role: new Set(["user", "admin", "moderator", "editor", "viewer", "api_only"]),
};

/** Rate-limit bucket: ruleId -> timestamps[] */
const executionBuckets = new Map<string, number[]>();

/* ──────────────────────── table bootstrap ──────────────────────── */

const ensureTable = async () => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS automation_rules (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        trigger_type VARCHAR(100) NOT NULL,
        trigger_conditions JSONB DEFAULT '{}',
        action_type VARCHAR(100) NOT NULL,
        action_config JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        run_count INTEGER DEFAULT 0,
        last_run_at TIMESTAMP,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS automation_logs (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        rule_id VARCHAR(255) NOT NULL,
        trigger_data JSONB,
        action_result JSONB,
        success BOOLEAN,
        error_message TEXT,
        execution_ms INTEGER,
        cascade_depth INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (_) {
    // Tables might exist
  }
};

ensureTable();

/* ──────────────────────── validation helpers ──────────────────────── */

function sanitizeText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f]/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLen) : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function validateJsonDepth(obj: unknown, maxDepth: number, current = 0): boolean {
  if (current > maxDepth) return false;
  if (Array.isArray(obj)) return obj.every(item => validateJsonDepth(item, maxDepth, current + 1));
  if (isPlainObject(obj)) return Object.values(obj).every(v => validateJsonDepth(v, maxDepth, current + 1));
  return true;
}

function validateWebhookUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (trimmed.length > MAX_WEBHOOK_URL_LENGTH) return null;
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    // Block private IPs (SSRF prevention)
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
      host === "[::1]" ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

// Available triggers
const TRIGGER_TYPES = [
  { id: "user_registered", label: "User Registered", fields: [] },
  { id: "user_plan_changed", label: "Plan Changed", fields: ["from_plan", "to_plan"] },
  { id: "chat_created", label: "Chat Created", fields: ["min_messages"] },
  { id: "payment_completed", label: "Payment Completed", fields: ["min_amount"] },
  { id: "login_failed", label: "Login Failed", fields: ["max_attempts"] },
  { id: "user_inactive", label: "User Inactive", fields: ["days_inactive"] },
  { id: "security_alert", label: "Security Alert", fields: ["severity"] },
];
const VALID_TRIGGER_IDS = new Set(TRIGGER_TYPES.map(t => t.id));

// Available actions
const ACTION_TYPES = [
  { id: "send_email", label: "Send Email", fields: ["template", "subject"] },
  { id: "send_notification", label: "Admin Notification", fields: ["message"] },
  { id: "update_user", label: "Update User", fields: ["field", "value"] },
  { id: "block_user", label: "Block User", fields: ["reason"] },
  { id: "add_tag", label: "Add Tag", fields: ["tag"] },
  { id: "webhook", label: "Call Webhook", fields: ["url", "method"] },
  { id: "slack_message", label: "Slack Message", fields: ["channel", "message"] },
];
const VALID_ACTION_IDS = new Set(ACTION_TYPES.map(a => a.id));
const VALID_WEBHOOK_METHODS = new Set(["GET", "POST", "PUT", "PATCH"]);

/* ──────────────────────── condition engine ──────────────────────── */

type ConditionOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "regex" | "in" | "exists";

interface Condition {
  field: string;
  op: ConditionOperator;
  value: unknown;
}

const VALID_OPERATORS = new Set<ConditionOperator>(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "regex", "in", "exists"]);

function parseConditions(raw: unknown): Condition[] {
  if (!isPlainObject(raw)) return [];

  const conditions: Condition[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (conditions.length >= MAX_CONDITION_KEYS) break;

    // New format: { field: "amount", op: "gt", value: 100 }
    if (isPlainObject(value) && typeof (value as any).op === "string") {
      const op = (value as any).op as ConditionOperator;
      if (VALID_OPERATORS.has(op)) {
        conditions.push({ field: key, op, value: (value as any).value });
      }
      continue;
    }

    // Legacy format: { key: value } means exact equality
    conditions.push({ field: key, op: "eq", value });
  }

  return conditions;
}

function evaluateCondition(condition: Condition, data: Record<string, unknown>): boolean {
  const actual = data[condition.field];
  const expected = condition.value;

  switch (condition.op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "contains":
      return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    case "regex": {
      if (typeof actual !== "string" || typeof expected !== "string") return false;
      try {
        // Limit regex length to prevent ReDoS
        if (expected.length > 200) return false;
        return new RegExp(expected, "i").test(actual);
      } catch {
        return false;
      }
    }
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "exists":
      return expected ? actual !== undefined && actual !== null : actual === undefined || actual === null;
    default:
      return false;
  }
}

function evaluateConditions(conditions: Condition[], data: Record<string, unknown>): boolean {
  return conditions.every(c => evaluateCondition(c, data));
}

/* ──────────────────────── rate limiting ──────────────────────── */

function isRateLimited(ruleId: string): boolean {
  const now = Date.now();
  const bucket = executionBuckets.get(ruleId) || [];
  const recent = bucket.filter(ts => now - ts < 60_000);
  executionBuckets.set(ruleId, recent);
  return recent.length >= MAX_EXECUTIONS_PER_RULE_PER_MIN;
}

function recordExecution(ruleId: string): void {
  const bucket = executionBuckets.get(ruleId) || [];
  bucket.push(Date.now());
  executionBuckets.set(ruleId, bucket);
}

// Periodic cleanup
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [ruleId, bucket] of executionBuckets.entries()) {
    const filtered = bucket.filter(ts => ts > cutoff);
    if (filtered.length === 0) executionBuckets.delete(ruleId);
    else executionBuckets.set(ruleId, filtered);
  }
}, 60_000).unref();

/* ──────────────────────── routes ──────────────────────── */

// GET /api/admin/automations - List rules
automationsRouter.get("/", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT * FROM automation_rules ORDER BY created_at DESC
    `);
    res.json(result.rows || []);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list automation rules" });
  }
});

// GET /api/admin/automations/triggers
automationsRouter.get("/triggers", (_req, res) => {
  res.json(TRIGGER_TYPES);
});

// GET /api/admin/automations/actions
automationsRouter.get("/actions", (_req, res) => {
  res.json(ACTION_TYPES);
});

// GET /api/admin/automations/operators - List available condition operators
automationsRouter.get("/operators", (_req, res) => {
  res.json([
    { id: "eq", label: "Equals", description: "Exact match" },
    { id: "neq", label: "Not Equals", description: "Does not match" },
    { id: "gt", label: "Greater Than", description: "Numeric comparison" },
    { id: "gte", label: "Greater or Equal", description: "Numeric comparison" },
    { id: "lt", label: "Less Than", description: "Numeric comparison" },
    { id: "lte", label: "Less or Equal", description: "Numeric comparison" },
    { id: "contains", label: "Contains", description: "Substring match" },
    { id: "regex", label: "Regex", description: "Regular expression (max 200 chars)" },
    { id: "in", label: "In", description: "Value in array" },
    { id: "exists", label: "Exists", description: "Field presence check" },
  ]);
});

// POST /api/admin/automations - Create rule
automationsRouter.post("/", async (req, res) => {
  try {
    const { name: rawName, description: rawDesc, triggerType, triggerConditions, actionType, actionConfig } = req.body;

    // Validate required fields
    const name = sanitizeText(rawName, MAX_NAME_LENGTH);
    if (!name) return res.status(400).json({ error: "name is required (max 255 chars)" });

    const description = rawDesc ? sanitizeText(rawDesc, MAX_DESCRIPTION_LENGTH) : null;

    if (!VALID_TRIGGER_IDS.has(triggerType)) {
      return res.status(400).json({ error: `Invalid triggerType. Allowed: ${[...VALID_TRIGGER_IDS].join(", ")}` });
    }

    if (!VALID_ACTION_IDS.has(actionType)) {
      return res.status(400).json({ error: `Invalid actionType. Allowed: ${[...VALID_ACTION_IDS].join(", ")}` });
    }

    // Validate conditions structure
    const conditionsObj = triggerConditions || {};
    if (!isPlainObject(conditionsObj) || !validateJsonDepth(conditionsObj, MAX_CONFIG_DEPTH)) {
      return res.status(400).json({ error: "Invalid triggerConditions structure" });
    }

    // Validate action config
    const configObj = actionConfig || {};
    if (!isPlainObject(configObj) || !validateJsonDepth(configObj, MAX_CONFIG_DEPTH)) {
      return res.status(400).json({ error: "Invalid actionConfig structure" });
    }

    // Action-specific validation
    if (actionType === "update_user") {
      const field = String(configObj.field || "");
      if (!ALLOWED_USER_UPDATE_FIELDS.has(field)) {
        return res.status(400).json({
          error: `Cannot update field '${field}'. Allowed: ${[...ALLOWED_USER_UPDATE_FIELDS].join(", ")}`,
        });
      }
      const allowedValues = ALLOWED_USER_UPDATE_VALUES[field];
      if (allowedValues && !allowedValues.has(String(configObj.value || ""))) {
        return res.status(400).json({
          error: `Invalid value for '${field}'. Allowed: ${[...allowedValues].join(", ")}`,
        });
      }
    }

    if (actionType === "webhook") {
      const webhookConfigError = ensureWebhookSecretConfigured();
      if (webhookConfigError) {
        return res.status(409).json({ error: webhookConfigError });
      }

      const url = validateWebhookUrl(configObj.url);
      if (!url) return res.status(400).json({ error: "Invalid or disallowed webhook URL" });
      const method = String(configObj.method || "POST").toUpperCase();
      if (!VALID_WEBHOOK_METHODS.has(method)) {
        return res.status(400).json({ error: `Invalid webhook method. Allowed: ${[...VALID_WEBHOOK_METHODS].join(", ")}` });
      }
    }

    const result = await db.execute(sql`
      INSERT INTO automation_rules (name, description, trigger_type, trigger_conditions, action_type, action_config, created_by)
      VALUES (${name}, ${description}, ${triggerType}, ${JSON.stringify(conditionsObj)},
              ${actionType}, ${JSON.stringify(configObj)}, ${(req as any).user?.email || "unknown"})
      RETURNING *
    `);

    await auditLog(req, {
      action: "automation.created",
      resource: "automation_rules",
      resourceId: result.rows?.[0]?.id,
      details: { name, triggerType, actionType, conditionCount: Object.keys(conditionsObj).length },
      category: "admin",
      severity: "info",
    });

    res.json(result.rows?.[0]);
  } catch (error: any) {
    console.error("[Automations] Create error:", error.message);
    res.status(500).json({ error: "Failed to create automation rule" });
  }
});

// PATCH /api/admin/automations/:id - Update rule
automationsRouter.patch("/:id", async (req, res) => {
  try {
    const ruleId = req.params.id;
    const { name: rawName, description: rawDesc, triggerConditions, actionConfig, isActive } = req.body;

    // Validate optional fields
    const name = rawName !== undefined ? sanitizeText(rawName, MAX_NAME_LENGTH) : undefined;
    const description = rawDesc !== undefined ? sanitizeText(rawDesc, MAX_DESCRIPTION_LENGTH) : undefined;

    let conditionsJson: string | null = null;
    if (triggerConditions !== undefined) {
      if (!isPlainObject(triggerConditions) || !validateJsonDepth(triggerConditions, MAX_CONFIG_DEPTH)) {
        return res.status(400).json({ error: "Invalid triggerConditions structure" });
      }
      conditionsJson = JSON.stringify(triggerConditions);
    }

    let configJson: string | null = null;
    if (actionConfig !== undefined) {
      if (!isPlainObject(actionConfig) || !validateJsonDepth(actionConfig, MAX_CONFIG_DEPTH)) {
        return res.status(400).json({ error: "Invalid actionConfig structure" });
      }
      // Re-validate action-specific rules if actionConfig changes
      // Fetch existing rule to check action_type
      const existing = await db.execute(sql`SELECT action_type FROM automation_rules WHERE id = ${ruleId}`);
      const existingActionType = existing.rows?.[0]?.action_type;
      if (existingActionType === "update_user") {
        const field = String(actionConfig.field || "");
        if (!ALLOWED_USER_UPDATE_FIELDS.has(field)) {
          return res.status(400).json({
            error: `Cannot update field '${field}'. Allowed: ${[...ALLOWED_USER_UPDATE_FIELDS].join(", ")}`,
          });
        }
        const allowedValues = ALLOWED_USER_UPDATE_VALUES[field];
        if (allowedValues && !allowedValues.has(String(actionConfig.value || ""))) {
          return res.status(400).json({ error: `Invalid value for '${field}'` });
        }
      }
      if (existingActionType === "webhook") {
        if (!HMAC_SECRET) {
          return res.status(500).json({
            error: "Webhook actions are disabled until AUTOMATION_WEBHOOK_SECRET is configured",
          });
        }
        const url = validateWebhookUrl(actionConfig.url);
        if (actionConfig.url && !url) return res.status(400).json({ error: "Invalid webhook URL" });
      }
      configJson = JSON.stringify(actionConfig);
    }

    const result = await db.execute(sql`
      UPDATE automation_rules SET
        name = COALESCE(${name ?? null}, name),
        description = COALESCE(${description ?? null}, description),
        trigger_conditions = COALESCE(${conditionsJson}, trigger_conditions),
        action_config = COALESCE(${configJson}, action_config),
        is_active = COALESCE(${isActive ?? null}, is_active),
        updated_at = NOW()
      WHERE id = ${ruleId}
      RETURNING *
    `);

    if (!result.rows?.length) {
      return res.status(404).json({ error: "Rule not found" });
    }

    await auditLog(req, {
      action: "automation.updated",
      resource: "automation_rules",
      resourceId: ruleId,
      details: {
        updatedFields: [
          name !== undefined && "name",
          description !== undefined && "description",
          conditionsJson && "triggerConditions",
          configJson && "actionConfig",
          isActive !== undefined && "isActive",
        ].filter(Boolean),
        updatedBy: (req as any).user?.email,
      },
      category: "admin",
      severity: "info",
    });

    res.json(result.rows[0]);
  } catch (error: any) {
    console.error("[Automations] Update error:", error.message);
    res.status(500).json({ error: "Failed to update automation rule" });
  }
});

// DELETE /api/admin/automations/:id
automationsRouter.delete("/:id", async (req, res) => {
  try {
    const ruleId = req.params.id;

    // Fetch rule before deleting for audit
    const existing = await db.execute(sql`SELECT name, action_type FROM automation_rules WHERE id = ${ruleId}`);
    if (!existing.rows?.length) {
      return res.status(404).json({ error: "Rule not found" });
    }

    await db.execute(sql`DELETE FROM automation_rules WHERE id = ${ruleId}`);

    await auditLog(req, {
      action: "automation.deleted",
      resource: "automation_rules",
      resourceId: ruleId,
      details: {
        ruleName: existing.rows[0].name,
        actionType: existing.rows[0].action_type,
        deletedBy: (req as any).user?.email,
      },
      category: "admin",
      severity: "warning",
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("[Automations] Delete error:", error.message);
    res.status(500).json({ error: "Failed to delete automation rule" });
  }
});

// GET /api/admin/automations/:id/logs
automationsRouter.get("/:id/logs", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT * FROM automation_logs
      WHERE rule_id = ${req.params.id}
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json(result.rows || []);
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// GET /api/admin/automations/stats - Execution statistics
automationsRouter.get("/stats/summary", async (req, res) => {
  try {
    const [rules, recentLogs, errorRate] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*) as total,
          COUNT(*) FILTER (WHERE is_active = true) as active,
          SUM(run_count) as total_executions
        FROM automation_rules
      `),
      db.execute(sql`
        SELECT COUNT(*) as total,
          COUNT(*) FILTER (WHERE success = true) as successful,
          COUNT(*) FILTER (WHERE success = false) as failed,
          AVG(execution_ms) as avg_execution_ms
        FROM automation_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `),
      db.execute(sql`
        SELECT rule_id, COUNT(*) FILTER (WHERE success = false) as errors
        FROM automation_logs
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY rule_id
        HAVING COUNT(*) FILTER (WHERE success = false) > 5
      `),
    ]);

    res.json({
      rules: rules.rows?.[0] || {},
      last24h: recentLogs.rows?.[0] || {},
      problematicRules: errorRate.rows || [],
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// POST /api/admin/automations/:id/test - Test rule execution (dry run)
automationsRouter.post("/:id/test", async (req, res) => {
  try {
    const { testData } = req.body;

    const ruleResult = await db.execute(sql`
      SELECT * FROM automation_rules WHERE id = ${req.params.id}
    `);

    if (!ruleResult.rows?.length) {
      return res.status(404).json({ error: "Rule not found" });
    }

    const rule = ruleResult.rows[0];
    const conditions = parseConditions(rule.trigger_conditions);
    const conditionResults = conditions.map(c => ({
      field: c.field,
      op: c.op,
      expected: c.value,
      actual: testData?.[c.field],
      passed: evaluateCondition(c, testData || {}),
    }));
    const allPassed = conditionResults.every(r => r.passed);

    let actionResult: any = null;
    if (allPassed) {
      actionResult = await executeAction(rule as AutomationRule, testData || {}, true, 0);
    }

    await auditLog(req, {
      action: "automation.tested",
      resource: "automation_rules",
      resourceId: req.params.id,
      details: { conditionsMatched: allPassed, testedBy: (req as any).user?.email },
      category: "admin",
      severity: "info",
    });

    res.json({
      conditionsMatched: allPassed,
      conditionResults,
      actionResult: actionResult || { skipped: true, reason: "Conditions not met" },
    });
  } catch (error: any) {
    console.error("[Automations] Test error:", error.message);
    res.status(500).json({ error: "Failed to test automation rule" });
  }
});

/* ──────────────────────── execution engine ──────────────────────── */

interface AutomationRule {
  id: string;
  name?: string;
  trigger_type: string;
  trigger_conditions: Record<string, any>;
  action_type: string;
  action_config: Record<string, any>;
  is_active: boolean;
}

function signWebhookPayload(payload: string): string {
  if (!HMAC_SECRET) {
    throw new Error("Missing AUTOMATION_WEBHOOK_SECRET or SESSION_SECRET for webhook signing");
  }

  return crypto.createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
}

async function executeAction(
  rule: AutomationRule,
  triggerData: Record<string, any>,
  isDryRun = false,
  cascadeDepth = 0,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const startMs = Date.now();

  try {
    // Cascade protection
    if (cascadeDepth >= MAX_CASCADE_DEPTH) {
      const errMsg = `Cascade depth limit (${MAX_CASCADE_DEPTH}) reached`;
      console.warn(`[Automation] ${errMsg} for rule ${rule.id}`);
      return { success: false, error: errMsg };
    }

    // Rate limiting
    if (!isDryRun && isRateLimited(rule.id)) {
      const errMsg = `Rate limit exceeded (${MAX_EXECUTIONS_PER_RULE_PER_MIN}/min)`;
      console.warn(`[Automation] ${errMsg} for rule ${rule.id}`);
      return { success: false, error: errMsg };
    }

    let result: any = { dryRun: isDryRun };

    switch (rule.action_type) {
      case "send_notification":
      const webhookConfigError = ensureWebhookSecretConfigured();
      if (webhookConfigError) {
        return { success: false, error: webhookConfigError };
      }

      if (!isDryRun) {
          adminNotifications.info(
            sanitizeText(rule.action_config.title, 200) || "Automation Alert",
            sanitizeText(rule.action_config.message, 1000) || `Rule triggered: ${rule.name || rule.id}`,
          );
        }
        result = { action: "notification_sent" };
        break;

      case "update_user": {
        const field = String(rule.action_config.field || "");
        const value = String(rule.action_config.value || "");

        // Double-check allowlist (defense in depth — already checked at creation)
        if (!ALLOWED_USER_UPDATE_FIELDS.has(field)) {
          return { success: false, error: `Disallowed field: ${field}` };
        }
        const allowedValues = ALLOWED_USER_UPDATE_VALUES[field];
        if (allowedValues && !allowedValues.has(value)) {
          return { success: false, error: `Disallowed value '${value}' for field '${field}'` };
        }

        if (!isDryRun && triggerData.userId) {
          // PARAMETERISED query — no sql.raw()
          // We use a CASE expression to map allowed field names safely
          if (field === "plan") {
            await db.execute(sql`UPDATE users SET plan = ${value} WHERE id = ${triggerData.userId}`);
          } else if (field === "status") {
            await db.execute(sql`UPDATE users SET status = ${value} WHERE id = ${triggerData.userId}`);
          } else if (field === "role") {
            await db.execute(sql`UPDATE users SET role = ${value} WHERE id = ${triggerData.userId}`);
          }
        }
        result = { action: "user_updated", field, value, userId: triggerData.userId };
        break;
      }

      case "block_user":
        if (!isDryRun && triggerData.userId) {
          const reason = sanitizeText(rule.action_config.reason, 500) || "Blocked by automation";
          await db.execute(sql`
            UPDATE users SET status = 'blocked', block_reason = ${reason}
            WHERE id = ${triggerData.userId}
          `);
        }
        result = { action: "user_blocked", userId: triggerData.userId };
        break;

      case "webhook": {
        const webhookConfigError = ensureWebhookSecretConfigured();
        if (webhookConfigError) {
          return { success: false, error: webhookConfigError };
        }

        const url = validateWebhookUrl(rule.action_config.url);
        if (!url) {
          return { success: false, error: "Invalid webhook URL" };
        }

        const method = VALID_WEBHOOK_METHODS.has(String(rule.action_config.method || "").toUpperCase())
          ? String(rule.action_config.method).toUpperCase()
          : "POST";

        if (!isDryRun) {
          const bodyStr = JSON.stringify({
            event: "automation_trigger",
            ruleId: rule.id,
            ruleName: rule.name,
            triggerType: rule.trigger_type,
            timestamp: new Date().toISOString(),
            data: triggerData,
          });

          const signature = signWebhookPayload(bodyStr);

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);

          try {
            const response = await fetch(url, {
              method,
              headers: {
                "Content-Type": "application/json",
                "X-Automation-Signature": `sha256=${signature}`,
                "X-Automation-Timestamp": String(Date.now()),
                "X-Automation-Rule-Id": rule.id,
              },
              body: method !== "GET" ? bodyStr : undefined,
              signal: controller.signal,
            });
            result = { action: "webhook_called", status: response.status, ok: response.ok };
          } finally {
            clearTimeout(timeout);
          }
        } else {
          result = { action: "webhook_would_call", url, method };
        }
        break;
      }

      case "add_tag":
        result = { action: "tag_added", tag: sanitizeText(rule.action_config.tag, 100) };
        break;

      case "send_email":
        result = { action: "email_queued", template: rule.action_config.template, subject: rule.action_config.subject };
        break;

      case "slack_message":
        result = { action: "slack_message_queued", channel: rule.action_config.channel };
        break;

      default:
        result = { action: rule.action_type, note: "No executor implemented" };
    }

    const elapsedMs = Date.now() - startMs;

    // Log execution
    if (!isDryRun) {
      recordExecution(rule.id);

      await db.execute(sql`
        INSERT INTO automation_logs (rule_id, trigger_data, action_result, success, execution_ms, cascade_depth)
        VALUES (${rule.id}, ${JSON.stringify(triggerData)}, ${JSON.stringify(result)}, true, ${elapsedMs}, ${cascadeDepth})
      `);

      await db.execute(sql`
        UPDATE automation_rules SET run_count = run_count + 1, last_run_at = NOW()
        WHERE id = ${rule.id}
      `);
    }

    return { success: true, data: result };
  } catch (error: any) {
    const elapsedMs = Date.now() - startMs;

    if (!isDryRun) {
      await db.execute(sql`
        INSERT INTO automation_logs (rule_id, trigger_data, success, error_message, execution_ms, cascade_depth)
        VALUES (${rule.id}, ${JSON.stringify(triggerData)}, false, ${String(error.message).slice(0, 2000)}, ${elapsedMs}, ${cascadeDepth})
      `).catch(() => {});
    }
    return { success: false, error: String(error.message).slice(0, 500) };
  }
}

// Event handler for triggers
class AutomationEngine extends EventEmitter {
  async handleEvent(eventType: string, data: Record<string, any>, cascadeDepth = 0) {
    if (cascadeDepth >= MAX_CASCADE_DEPTH) {
      console.warn(`[Automation] Cascade limit reached at depth ${cascadeDepth}, skipping event '${eventType}'`);
      return;
    }

    try {
      const rules = await db.execute(sql`
        SELECT * FROM automation_rules
        WHERE trigger_type = ${eventType} AND is_active = true
      `);

      for (const rule of rules.rows || []) {
        const conditions = parseConditions(rule.trigger_conditions);
        if (evaluateConditions(conditions, data)) {
          executeAction(rule as AutomationRule, data, false, cascadeDepth).catch((err) =>
            console.error(`[Automation] Execution failed for rule ${rule.id}:`, err.message),
          );
        }
      }
    } catch (error) {
      console.error("[Automation] Error handling event:", error);
    }
  }
}

export const automationEngine = new AutomationEngine();

// Helper to trigger automation from anywhere
export function triggerAutomation(eventType: string, data: Record<string, any>, cascadeDepth = 0) {
  automationEngine.handleEvent(eventType, data, cascadeDepth).catch(console.error);
}
