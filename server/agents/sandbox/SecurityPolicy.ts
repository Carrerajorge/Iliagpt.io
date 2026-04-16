import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import pino from "pino";

const logger = pino({ name: "SecurityPolicy" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type RuleAction = "allow" | "deny" | "log" | "sanitize" | "escalate";
export type RuleTarget = "command" | "network_egress" | "file_path" | "data" | "model_input" | "tool_call";
export type TrustLevel = "untrusted" | "low" | "medium" | "high" | "admin";

export interface SecurityRule {
  ruleId: string;
  name: string;
  description: string;
  target: RuleTarget;
  /** Regex pattern string to match against the target value */
  pattern: string;
  action: RuleAction;
  /** Priority: lower number = higher priority */
  priority: number;
  enabled: boolean;
  /** Minimum trust level to bypass this rule */
  bypassTrustLevel?: TrustLevel;
  /** Tags for grouping */
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** Number of times this rule was triggered */
  triggerCount: number;
}

export interface EgressRule {
  ruleId: string;
  name: string;
  /** CIDR or hostname pattern */
  destination: string;
  port?: number;
  protocol?: "http" | "https" | "tcp" | "udp" | "any";
  action: "allow" | "deny";
  /** Trust level required to use this rule */
  minTrustLevel: TrustLevel;
  priority: number;
  enabled: boolean;
}

export interface PolicyViolation {
  violationId: string;
  agentId: string;
  ruleId: string;
  ruleName: string;
  target: RuleTarget;
  value: string; // redacted if necessary
  action: RuleAction;
  timestamp: number;
  sessionId?: string;
  severity: "low" | "medium" | "high" | "critical";
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  action: RuleAction;
  violations: PolicyViolation[];
  matchedRules: string[];
  sanitizedValue?: string;
}

export interface DataExfiltrationPattern {
  patternId: string;
  name: string;
  /** Regex that detects sensitive data patterns */
  regex: string;
  category: "pii" | "credentials" | "financial" | "health" | "custom";
  severity: "low" | "medium" | "high" | "critical";
  action: "block" | "redact" | "warn";
}

// ─── Default data exfiltration patterns ──────────────────────────────────────

export const DEFAULT_EXFILTRATION_PATTERNS: DataExfiltrationPattern[] = [
  {
    patternId: "ssn",
    name: "US Social Security Number",
    regex: "\\b\\d{3}-\\d{2}-\\d{4}\\b",
    category: "pii",
    severity: "critical",
    action: "block",
  },
  {
    patternId: "credit_card",
    name: "Credit Card Number",
    regex: "\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9][0-9])[0-9]{12})\\b",
    category: "financial",
    severity: "critical",
    action: "block",
  },
  {
    patternId: "api_key",
    name: "API Key Pattern",
    regex: "(?:api[_-]?key|bearer|token)[\"']?\\s*[:=]\\s*[\"']?[A-Za-z0-9_\\-]{20,}",
    category: "credentials",
    severity: "high",
    action: "redact",
  },
  {
    patternId: "aws_key",
    name: "AWS Access Key",
    regex: "AKIA[0-9A-Z]{16}",
    category: "credentials",
    severity: "critical",
    action: "block",
  },
  {
    patternId: "private_key",
    name: "Private Key Block",
    regex: "-----BEGIN (?:RSA |EC )?PRIVATE KEY-----",
    category: "credentials",
    severity: "critical",
    action: "block",
  },
  {
    patternId: "email",
    name: "Email Address",
    regex: "[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}",
    category: "pii",
    severity: "medium",
    action: "warn",
  },
];

// ─── Default security rules ────────────────────────────────────────────────────

export const DEFAULT_SECURITY_RULES: Omit<SecurityRule, "ruleId" | "createdAt" | "updatedAt" | "triggerCount">[] = [
  {
    name: "Block shell injection",
    description: "Prevents shell injection patterns in commands",
    target: "command",
    pattern: "[;&|`$]|\\$\\(|eval|exec|spawn|system",
    action: "deny",
    priority: 1,
    enabled: true,
    tags: ["injection", "shell"],
  },
  {
    name: "Block path traversal",
    description: "Prevents directory traversal attacks",
    target: "file_path",
    pattern: "\\.\\./|\\.\\.\\\\|%2e%2e",
    action: "deny",
    priority: 1,
    enabled: true,
    tags: ["path-traversal", "filesystem"],
  },
  {
    name: "Block SSRF patterns",
    description: "Prevents Server-Side Request Forgery to internal networks",
    target: "network_egress",
    pattern: "(?:169\\.254\\.|10\\.|172\\.(?:1[6-9]|2\\d|3[01])\\.|192\\.168\\.|localhost|127\\.0\\.0\\.|::1)",
    action: "deny",
    priority: 1,
    enabled: true,
    tags: ["ssrf", "network"],
  },
  {
    name: "Warn on prompt injection attempt",
    description: "Detects common prompt injection patterns in model inputs",
    target: "model_input",
    pattern: "ignore (?:all )?(?:previous|prior|above) instructions?|you are now|act as|jailbreak|DAN mode",
    action: "log",
    priority: 5,
    enabled: true,
    tags: ["prompt-injection", "llm-security"],
  },
  {
    name: "Block crypto miner URLs",
    description: "Blocks requests to known crypto mining pools",
    target: "network_egress",
    pattern: "pool\\.|mining\\.|xmr\\.|monero\\.|nicehash",
    action: "deny",
    priority: 2,
    enabled: true,
    tags: ["malware", "cryptominer"],
  },
  {
    name: "Block exfiltration via DNS",
    description: "Detects potential DNS exfiltration patterns",
    target: "network_egress",
    pattern: "[a-f0-9]{32,}\\.(?:dnsbin|ceye|burpcollaborator|interact\\.sh)",
    action: "deny",
    priority: 2,
    enabled: true,
    tags: ["exfiltration", "dns"],
  },
];

// ─── SecurityPolicy ───────────────────────────────────────────────────────────

export class SecurityPolicy extends EventEmitter {
  private rules = new Map<string, SecurityRule>();
  private egressRules = new Map<string, EgressRule>();
  private exfiltrationPatterns = new Map<string, DataExfiltrationPattern>();
  private violations: PolicyViolation[] = [];

  /** agentId → trust level */
  private agentTrustLevels = new Map<string, TrustLevel>();

  /** Compiled regex cache */
  private compiledPatterns = new Map<string, RegExp>();

  constructor() {
    super();
    this.loadDefaultRules();
    this.loadDefaultExfiltrationPatterns();
    logger.info(
      { rules: this.rules.size, egressRules: this.egressRules.size },
      "[SecurityPolicy] Initialized"
    );
  }

  // ── Initialization ────────────────────────────────────────────────────────────

  private loadDefaultRules(): void {
    for (const rule of DEFAULT_SECURITY_RULES) {
      const fullRule: SecurityRule = {
        ...rule,
        ruleId: randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        triggerCount: 0,
      };
      this.rules.set(fullRule.ruleId, fullRule);
    }
  }

  private loadDefaultExfiltrationPatterns(): void {
    for (const pattern of DEFAULT_EXFILTRATION_PATTERNS) {
      this.exfiltrationPatterns.set(pattern.patternId, pattern);
    }
  }

  // ── Rule management ───────────────────────────────────────────────────────────

  addRule(rule: Omit<SecurityRule, "ruleId" | "createdAt" | "updatedAt" | "triggerCount">): SecurityRule {
    const fullRule: SecurityRule = {
      ...rule,
      ruleId: randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      triggerCount: 0,
    };
    this.rules.set(fullRule.ruleId, fullRule);
    // Compile regex eagerly
    this.compilePattern(fullRule.ruleId, fullRule.pattern);
    logger.info({ ruleId: fullRule.ruleId, name: fullRule.name }, "[SecurityPolicy] Rule added");
    return fullRule;
  }

  updateRule(ruleId: string, updates: Partial<Pick<SecurityRule, "pattern" | "action" | "enabled" | "priority">>): void {
    const rule = this.rules.get(ruleId);
    if (!rule) throw new Error(`Rule '${ruleId}' not found`);
    const updated = { ...rule, ...updates, updatedAt: Date.now() };
    this.rules.set(ruleId, updated);
    if (updates.pattern) {
      this.compiledPatterns.delete(ruleId); // invalidate cache
      this.compilePattern(ruleId, updates.pattern);
    }
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
    this.compiledPatterns.delete(ruleId);
  }

  addEgressRule(rule: Omit<EgressRule, "ruleId">): EgressRule {
    const full: EgressRule = { ...rule, ruleId: randomUUID() };
    this.egressRules.set(full.ruleId, full);
    return full;
  }

  // ── Evaluation ────────────────────────────────────────────────────────────────

  evaluate(
    agentId: string,
    target: RuleTarget,
    value: string,
    sessionId?: string
  ): PolicyEvaluationResult {
    if (!value || value.length === 0) {
      return { allowed: true, action: "allow", violations: [], matchedRules: [] };
    }

    const trustLevel = this.agentTrustLevels.get(agentId) ?? "untrusted";
    const applicableRules = this.getApplicableRules(target, trustLevel);

    const violations: PolicyViolation[] = [];
    const matchedRules: string[] = [];
    let finalAction: RuleAction = "allow";
    let sanitizedValue: string | undefined;

    for (const rule of applicableRules) {
      const regex = this.getCompiledPattern(rule.ruleId, rule.pattern);
      if (!regex) continue;

      if (regex.test(value)) {
        rule.triggerCount++;
        matchedRules.push(rule.ruleId);

        const severity = this.computeSeverity(rule);

        const violation: PolicyViolation = {
          violationId: randomUUID(),
          agentId,
          ruleId: rule.ruleId,
          ruleName: rule.name,
          target,
          value: this.redactSensitiveValue(value),
          action: rule.action,
          timestamp: Date.now(),
          sessionId,
          severity,
        };

        violations.push(violation);
        this.violations.push(violation);
        if (this.violations.length > 100_000) this.violations.shift();

        if (rule.action === "deny" || rule.action === "escalate") {
          finalAction = rule.action;
          break; // deny always stops evaluation
        }

        if (rule.action === "sanitize") {
          sanitizedValue = value.replace(regex, "[REDACTED]");
          finalAction = "sanitize";
        } else if (rule.action === "log" && finalAction === "allow") {
          finalAction = "log";
        }

        this.emit("policy:violation", violation);
        if (severity === "critical" || severity === "high") {
          logger.warn(
            { ruleId: rule.ruleId, agentId, severity, target },
            "[SecurityPolicy] Security rule triggered"
          );
        }
      }
    }

    const allowed = finalAction !== "deny" && finalAction !== "escalate";

    return {
      allowed,
      action: finalAction,
      violations,
      matchedRules,
      sanitizedValue,
    };
  }

  // ── Network egress enforcement ────────────────────────────────────────────────

  checkEgress(agentId: string, url: string): { allowed: boolean; reason: string } {
    const trustLevel = this.agentTrustLevels.get(agentId) ?? "untrusted";

    // First check egress rules
    const applicableEgressRules = Array.from(this.egressRules.values())
      .filter((r) => r.enabled && this.trustMeetsMinimum(trustLevel, r.minTrustLevel))
      .sort((a, b) => a.priority - b.priority);

    for (const rule of applicableEgressRules) {
      if (this.matchesDestination(url, rule.destination)) {
        if (rule.action === "deny") {
          return { allowed: false, reason: `Blocked by egress rule: ${rule.name}` };
        }
        if (rule.action === "allow") {
          return { allowed: true, reason: `Allowed by egress rule: ${rule.name}` };
        }
      }
    }

    // Then check general security rules for SSRF etc.
    const result = this.evaluate(agentId, "network_egress", url);
    if (!result.allowed) {
      return {
        allowed: false,
        reason: `Blocked by security rule: ${result.violations[0]?.ruleName ?? "unknown"}`,
      };
    }

    return { allowed: true, reason: "No egress rule matched (default allow)" };
  }

  // ── Data exfiltration detection ────────────────────────────────────────────────

  scanForExfiltration(
    agentId: string,
    data: string
  ): { safe: boolean; findings: Array<{ patternId: string; category: string; severity: string; action: string }> } {
    const findings: Array<{ patternId: string; category: string; severity: string; action: string }> = [];

    for (const pattern of this.exfiltrationPatterns.values()) {
      const regex = this.getCompiledPattern(
        `exfil:${pattern.patternId}`,
        pattern.regex
      );
      if (!regex) continue;

      if (regex.test(data)) {
        findings.push({
          patternId: pattern.patternId,
          category: pattern.category,
          severity: pattern.severity,
          action: pattern.action,
        });

        logger.warn(
          { agentId, patternId: pattern.patternId, category: pattern.category },
          "[SecurityPolicy] Data exfiltration pattern detected"
        );

        this.emit("exfiltration:detected", {
          agentId,
          patternId: pattern.patternId,
          severity: pattern.severity,
        });
      }
    }

    const hasBlock = findings.some((f) => f.action === "block");
    return { safe: !hasBlock, findings };
  }

  redactSensitiveData(data: string): string {
    let result = data;
    for (const pattern of this.exfiltrationPatterns.values()) {
      if (pattern.action === "redact" || pattern.action === "block") {
        const regex = this.getCompiledPattern(
          `exfil:${pattern.patternId}`,
          pattern.regex
        );
        if (regex) {
          result = result.replace(regex, `[${pattern.category.toUpperCase()}_REDACTED]`);
        }
      }
    }
    return result;
  }

  // ── Trust management ──────────────────────────────────────────────────────────

  setTrustLevel(agentId: string, level: TrustLevel): void {
    this.agentTrustLevels.set(agentId, level);
    logger.info({ agentId, level }, "[SecurityPolicy] Trust level set");
    this.emit("trust:updated", { agentId, level });
  }

  getTrustLevel(agentId: string): TrustLevel {
    return this.agentTrustLevels.get(agentId) ?? "untrusted";
  }

  private trustMeetsMinimum(current: TrustLevel, minimum: TrustLevel): boolean {
    const levels: TrustLevel[] = ["untrusted", "low", "medium", "high", "admin"];
    return levels.indexOf(current) >= levels.indexOf(minimum);
  }

  // ── Rule integrity ─────────────────────────────────────────────────────────────

  computePolicyHash(): string {
    const ruleData = Array.from(this.rules.values())
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map((r) => `${r.ruleId}:${r.pattern}:${r.action}`)
      .join("\n");

    return createHash("sha256").update(ruleData).digest("hex").slice(0, 16);
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private getApplicableRules(target: RuleTarget, trustLevel: TrustLevel): SecurityRule[] {
    return Array.from(this.rules.values())
      .filter((r) => r.enabled && r.target === target)
      .filter(
        (r) =>
          !r.bypassTrustLevel ||
          !this.trustMeetsMinimum(trustLevel, r.bypassTrustLevel)
      )
      .sort((a, b) => a.priority - b.priority);
  }

  private compilePattern(id: string, pattern: string): RegExp | null {
    try {
      const regex = new RegExp(pattern, "gi");
      this.compiledPatterns.set(id, regex);
      return regex;
    } catch (err) {
      logger.error({ err, pattern }, "[SecurityPolicy] Invalid regex pattern");
      return null;
    }
  }

  private getCompiledPattern(id: string, pattern: string): RegExp | null {
    if (!this.compiledPatterns.has(id)) {
      return this.compilePattern(id, pattern);
    }
    // Recreate to reset lastIndex (global regex is stateful)
    const cached = this.compiledPatterns.get(id)!;
    return new RegExp(cached.source, cached.flags);
  }

  private matchesDestination(url: string, pattern: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      if (pattern === "*") return true;
      if (pattern.startsWith("*.")) {
        const domain = pattern.slice(2);
        return hostname.endsWith(domain);
      }
      return hostname === pattern || url.includes(pattern);
    } catch {
      return url.includes(pattern);
    }
  }

  private computeSeverity(rule: SecurityRule): PolicyViolation["severity"] {
    if (rule.action === "deny" && rule.priority <= 2) return "critical";
    if (rule.action === "deny") return "high";
    if (rule.action === "escalate") return "high";
    if (rule.action === "sanitize") return "medium";
    return "low";
  }

  private redactSensitiveValue(value: string): string {
    if (value.length <= 20) return "[REDACTED]";
    return value.slice(0, 10) + "...[REDACTED]..." + value.slice(-5);
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getViolations(
    agentId?: string,
    severity?: PolicyViolation["severity"],
    limit = 100
  ): PolicyViolation[] {
    let entries = [...this.violations];
    if (agentId) entries = entries.filter((v) => v.agentId === agentId);
    if (severity) entries = entries.filter((v) => v.severity === severity);
    return entries.slice(-limit).reverse();
  }

  listRules(target?: RuleTarget): SecurityRule[] {
    const all = Array.from(this.rules.values());
    return target ? all.filter((r) => r.target === target) : all;
  }

  getStats() {
    const violations = this.violations;
    return {
      rules: this.rules.size,
      egressRules: this.egressRules.size,
      exfiltrationPatterns: this.exfiltrationPatterns.size,
      totalViolations: violations.length,
      violationsBySeverity: {
        critical: violations.filter((v) => v.severity === "critical").length,
        high: violations.filter((v) => v.severity === "high").length,
        medium: violations.filter((v) => v.severity === "medium").length,
        low: violations.filter((v) => v.severity === "low").length,
      },
      topTriggeredRules: Array.from(this.rules.values())
        .sort((a, b) => b.triggerCount - a.triggerCount)
        .slice(0, 5)
        .map((r) => ({ ruleId: r.ruleId, name: r.name, count: r.triggerCount })),
      policyHash: this.computePolicyHash(),
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
let _policy: SecurityPolicy | null = null;
export function getSecurityPolicy(): SecurityPolicy {
  if (!_policy) _policy = new SecurityPolicy();
  return _policy;
}
