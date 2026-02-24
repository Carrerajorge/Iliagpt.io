/**
 * ConnectorAccessControl — Comprehensive RBAC/ABAC policy engine for the Integration Kernel.
 *
 * Provides a unified access control layer combining:
 *  - Role-Based Access Control (RBAC) with hierarchical role inheritance
 *  - Attribute-Based Access Control (ABAC) with pluggable attribute resolvers
 *  - Policy engine with deny-override combining algorithm
 *  - Resource hierarchy with glob-pattern matching
 *  - Full audit trail with anomaly detection
 *  - Compliance export (JSON/CSV)
 *
 * Components:
 *  1. RoleManager          — Role CRUD, user-role assignment, permission resolution
 *  2. PolicyEngine         — Policy evaluation, batch eval, conflict detection
 *  3. AttributeBasedAccessControl — Attribute resolvers, condition operators, time/IP/rate checks
 *  4. ResourceHierarchy    — Resource tree, glob matching, permission inheritance
 *  5. AccessControlAuditLog — Ring buffer, query, patterns, anomalies, export
 *  6. ConnectorAccessControl — Facade singleton integrating all components
 *
 * Standalone module — zero imports from other kernel files.
 */

import { randomUUID } from "node:crypto";

const crypto = require("crypto");

// ─── Constants ──────────────────────────────────────────────────────

const MAX_ROLE_INHERITANCE_DEPTH = 10;
const AUDIT_BUFFER_CAPACITY = 5000;
const RATE_WINDOW_CLEANUP_INTERVAL_MS = 60_000;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_ANOMALY_DENIAL_RATE_THRESHOLD = 0.3;
const BUSINESS_HOURS_START = 9;
const BUSINESS_HOURS_END = 17;

// ─── Core Types ─────────────────────────────────────────────────────

/** A single condition predicate used in permission and policy evaluation. */
export interface ConditionPredicate {
  attribute: string;
  operator: ConditionOperator;
  value: unknown;
}

export type ConditionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "in"
  | "not_in"
  | "contains"
  | "matches"
  | "between"
  | "exists";

/** A permission grants an action on a resource, optionally with conditions. */
export interface Permission {
  action: string;
  resource: string;
  conditions?: ConditionPredicate[];
}

/** A role groups permissions and can inherit from other roles. */
export interface Role {
  id: string;
  name: string;
  permissions: Permission[];
  inherits: string[];
  priority: number;
}

export type PolicyEffect = "allow" | "deny";

/** A policy defines access rules for subjects on resources. */
export interface Policy {
  id: string;
  name: string;
  effect: PolicyEffect;
  subjects: string[];
  resources: string[];
  actions: string[];
  conditions: Array<(request: AccessRequest) => boolean>;
  priority: number;
}

/** An access request to be evaluated. */
export interface AccessRequest {
  userId: string;
  action: string;
  resource: string;
  context: Record<string, unknown>;
}

/** The result of evaluating an access request. */
export interface AccessDecision {
  allowed: boolean;
  matchedPolicies: string[];
  reason: string;
  evaluationTimeMs: number;
}

/** A single entry in the audit log. */
export interface AuditEntry {
  id: string;
  request: AccessRequest;
  decision: AccessDecision;
  timestamp: number;
  policyTrace: string[];
}

/** Filters for querying the audit log. */
export interface AuditQueryFilters {
  userId?: string;
  action?: string;
  resource?: string;
  allowed?: boolean;
  since?: number;
  until?: number;
  limit?: number;
}

/** Access pattern analysis for a user. */
export interface AccessPatterns {
  userId: string;
  totalAccesses: number;
  mostAccessedResources: Array<{ resource: string; count: number }>;
  actionDistribution: Record<string, number>;
  denialRate: number;
  windowMs: number;
}

/** An anomaly detected in access patterns. */
export interface AccessAnomaly {
  type: "unusual_time" | "high_denial_rate" | "new_resource_access" | "privilege_escalation";
  userId: string;
  description: string;
  timestamp: number;
  severity: "low" | "medium" | "high" | "critical";
}

/** Policy conflict description. */
export interface PolicyConflict {
  policyA: string;
  policyB: string;
  overlappingSubjects: string[];
  overlappingResources: string[];
  overlappingActions: string[];
  conflictType: "allow_deny_conflict";
}

/** A node in the resource hierarchy tree. */
export interface ResourceNode {
  path: string;
  parent: string | null;
  children: string[];
  metadata: Record<string, unknown>;
}

/** ABAC attribute definition. */
export interface AttributeDefinition {
  name: string;
  resolver: (userId: string, context: Record<string, unknown>) => unknown;
}

/** User access report. */
export interface UserAccessReport {
  userId: string;
  roles: Role[];
  effectivePermissions: Permission[];
  recentAccess: AuditEntry[];
  anomalies: AccessAnomaly[];
  accessPatterns: AccessPatterns;
}

/** System-wide access report. */
export interface SystemAccessReport {
  policyCount: number;
  roleCount: number;
  userCount: number;
  topDeniedResources: Array<{ resource: string; count: number }>;
  anomalySummary: Record<string, number>;
  totalEvaluations: number;
  totalDenials: number;
}

/** Custom error thrown by enforce(). */
export class AccessDeniedError extends Error {
  public readonly userId: string;
  public readonly action: string;
  public readonly resource: string;
  public readonly decision: AccessDecision;

  constructor(userId: string, action: string, resource: string, decision: AccessDecision) {
    super(`Access denied: user "${userId}" cannot perform "${action}" on "${resource}" — ${decision.reason}`);
    this.name = "AccessDeniedError";
    this.userId = userId;
    this.action = action;
    this.resource = resource;
    this.decision = decision;
  }
}

// ─── Ring Buffer ────────────────────────────────────────────────────

class RingBuffer<T> {
  private readonly _buffer: Array<T | undefined>;
  private readonly _capacity: number;
  private _head: number = 0;
  private _size: number = 0;

  constructor(capacity: number) {
    this._capacity = capacity;
    this._buffer = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this._buffer[this._head] = item;
    this._head = (this._head + 1) % this._capacity;
    if (this._size < this._capacity) this._size++;
  }

  get size(): number {
    return this._size;
  }

  /** Return items newest-first, up to `limit`. */
  toArray(limit?: number): T[] {
    const result: T[] = [];
    const count = limit !== undefined ? Math.min(limit, this._size) : this._size;
    for (let i = 0; i < count; i++) {
      const idx = (this._head - 1 - i + this._capacity) % this._capacity;
      const item = this._buffer[idx];
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  /** Return items oldest-first. */
  toArrayOldestFirst(): T[] {
    const result: T[] = [];
    const start = this._size < this._capacity ? 0 : this._head;
    for (let i = 0; i < this._size; i++) {
      const idx = (start + i) % this._capacity;
      const item = this._buffer[idx];
      if (item !== undefined) result.push(item);
    }
    return result;
  }

  clear(): void {
    this._buffer.fill(undefined);
    this._head = 0;
    this._size = 0;
  }
}

// ─── Glob Matching Utilities ────────────────────────────────────────

/**
 * Match a pattern against a string using glob semantics.
 * `*` matches any single segment (non-separator characters).
 * `**` matches zero or more segments.
 * Separator is `/` for resource paths, or the pattern is treated as a flat string.
 */
function globMatch(pattern: string, value: string): boolean {
  // Exact match fast path
  if (pattern === value) return true;
  if (pattern === "*" || pattern === "**") return true;

  // Convert glob pattern to regex
  const regexStr = globToRegex(pattern);
  try {
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(value);
  } catch {
    return pattern === value;
  }
}

function globToRegex(pattern: string): string {
  let result = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (i + 1 < pattern.length && pattern[i + 1] === "*") {
        // ** matches everything including separators
        result += ".*";
        i += 2;
        // Skip trailing slash after **
        if (i < pattern.length && pattern[i] === "/") i++;
      } else {
        // * matches everything except /
        result += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      result += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(ch)) {
      result += "\\" + ch;
      i++;
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

/**
 * Match a resource path against a pattern supporting `*` and `**`.
 * Segments are split by `/`.
 */
function matchResourcePath(pattern: string, resourcePath: string): boolean {
  return globMatch(pattern, resourcePath);
}

// ─── CIDR Matching ──────────────────────────────────────────────────

/**
 * Check if an IPv4 address falls within a CIDR range.
 * Supports /8, /16, /24, /32.
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const parts = cidr.split("/");
  if (parts.length !== 2) return false;

  const cidrIp = parts[0];
  const prefixLen = parseInt(parts[1], 10);
  if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 32) return false;

  const ipNum = ipToNumber(ip);
  const cidrNum = ipToNumber(cidrIp);
  if (ipNum === null || cidrNum === null) return false;

  if (prefixLen === 0) return true;
  const mask = (~0 << (32 - prefixLen)) >>> 0;
  return (ipNum & mask) === (cidrNum & mask);
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const octet = parseInt(parts[i], 10);
    if (isNaN(octet) || octet < 0 || octet > 255) return null;
    num = (num * 256) + octet;
  }
  return num >>> 0;
}

// ─── Rate Tracking ──────────────────────────────────────────────────

interface RateEntry {
  timestamps: number[];
}

const rateTracker = new Map<string, RateEntry>();

function recordRateEvent(key: string): void {
  const entry = rateTracker.get(key);
  const now = Date.now();
  if (entry) {
    entry.timestamps.push(now);
  } else {
    rateTracker.set(key, { timestamps: [now] });
  }
}

function getOperationsInWindow(key: string, windowMs: number): number {
  const entry = rateTracker.get(key);
  if (!entry) return 0;
  const cutoff = Date.now() - windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  return entry.timestamps.length;
}

// Periodic cleanup of stale rate entries
const rateCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - DEFAULT_RATE_WINDOW_MS * 10;
  for (const [key, entry] of Array.from(rateTracker.entries())) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) {
      rateTracker.delete(key);
    }
  }
}, RATE_WINDOW_CLEANUP_INTERVAL_MS);
if (rateCleanupTimer && typeof rateCleanupTimer === "object" && "unref" in rateCleanupTimer) {
  (rateCleanupTimer as NodeJS.Timeout).unref();
}

// ─── Section 2: RoleManager ─────────────────────────────────────────

/**
 * Manages roles, user-role assignments, and hierarchical permission resolution.
 *
 * Built-in roles:
 *  - `admin`   — all permissions (`*` on `**`)
 *  - `operator` — read + write on all resources
 *  - `viewer`  — read-only on all resources
 *  - `auditor` — read + audit on all resources
 */
export class RoleManager {
  private readonly _roles = new Map<string, Role>();
  private readonly _userRoles = new Map<string, Set<string>>();

  constructor() {
    this._registerBuiltInRoles();
  }

  // ── Role CRUD ───────────────────────────────────────────────────────

  addRole(role: Role): void {
    this._roles.set(role.id, role);
    console.info(JSON.stringify({
      event: "acl_role_added",
      roleId: role.id,
      name: role.name,
      permissionCount: role.permissions.length,
      inherits: role.inherits,
      timestamp: Date.now(),
    }));
  }

  removeRole(roleId: string): boolean {
    const removed = this._roles.delete(roleId);
    if (removed) {
      // Remove this role from any user assignments
      for (const [, roleSet] of Array.from(this._userRoles.entries())) {
        roleSet.delete(roleId);
      }
      console.info(JSON.stringify({
        event: "acl_role_removed",
        roleId,
        timestamp: Date.now(),
      }));
    }
    return removed;
  }

  getRole(roleId: string): Role | undefined {
    return this._roles.get(roleId);
  }

  getAllRoles(): Role[] {
    return Array.from(this._roles.values());
  }

  // ── User-Role Assignment ────────────────────────────────────────────

  assignRole(userId: string, roleId: string): void {
    if (!this._roles.has(roleId)) {
      throw new Error(`Role "${roleId}" does not exist`);
    }
    let userSet = this._userRoles.get(userId);
    if (!userSet) {
      userSet = new Set<string>();
      this._userRoles.set(userId, userSet);
    }
    userSet.add(roleId);
    console.info(JSON.stringify({
      event: "acl_role_assigned",
      userId,
      roleId,
      timestamp: Date.now(),
    }));
  }

  revokeRole(userId: string, roleId: string): boolean {
    const userSet = this._userRoles.get(userId);
    if (!userSet) return false;
    const removed = userSet.delete(roleId);
    if (removed) {
      console.info(JSON.stringify({
        event: "acl_role_revoked",
        userId,
        roleId,
        timestamp: Date.now(),
      }));
    }
    return removed;
  }

  getUserRoles(userId: string): Role[] {
    const roleIds = this._userRoles.get(userId);
    if (!roleIds) return [];
    const roles: Role[] = [];
    for (const roleId of Array.from(roleIds.values())) {
      const role = this._roles.get(roleId);
      if (role) roles.push(role);
    }
    return roles;
  }

  getUserRoleIds(userId: string): string[] {
    const roleIds = this._userRoles.get(userId);
    if (!roleIds) return [];
    return Array.from(roleIds.values());
  }

  getAllUserIds(): string[] {
    return Array.from(this._userRoles.keys());
  }

  // ── Permission Resolution ───────────────────────────────────────────

  /**
   * Get all effective permissions for a role, traversing the inheritance chain.
   * Uses visited-set cycle detection with a max depth of 10.
   */
  getEffectivePermissions(roleId: string): Permission[] {
    const visited = new Set<string>();
    return this._resolvePermissions(roleId, visited, 0);
  }

  /**
   * Check if a user has a specific permission through any of their assigned roles.
   */
  hasPermission(userId: string, action: string, resource: string): boolean {
    const roleIds = this._userRoles.get(userId);
    if (!roleIds) return false;

    for (const roleId of Array.from(roleIds.values())) {
      const permissions = this.getEffectivePermissions(roleId);
      for (const perm of permissions) {
        if (globMatch(perm.action, action) && matchResourcePath(perm.resource, resource)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get all effective permissions for a user across all assigned roles.
   */
  getUserEffectivePermissions(userId: string): Permission[] {
    const roleIds = this._userRoles.get(userId);
    if (!roleIds) return [];

    const allPermissions: Permission[] = [];
    const seen = new Set<string>();

    for (const roleId of Array.from(roleIds.values())) {
      const permissions = this.getEffectivePermissions(roleId);
      for (const perm of permissions) {
        const key = `${perm.action}::${perm.resource}`;
        if (!seen.has(key)) {
          seen.add(key);
          allPermissions.push(perm);
        }
      }
    }
    return allPermissions;
  }

  /**
   * Reset all roles and user assignments, then re-register built-in roles.
   */
  reset(): void {
    this._roles.clear();
    this._userRoles.clear();
    this._registerBuiltInRoles();
  }

  // ── Private Helpers ─────────────────────────────────────────────────

  private _resolvePermissions(roleId: string, visited: Set<string>, depth: number): Permission[] {
    if (visited.has(roleId) || depth > MAX_ROLE_INHERITANCE_DEPTH) return [];
    visited.add(roleId);

    const role = this._roles.get(roleId);
    if (!role) return [];

    const permissions: Permission[] = [...role.permissions];

    // Resolve inherited role permissions
    for (const parentRoleId of role.inherits) {
      const inherited = this._resolvePermissions(parentRoleId, visited, depth + 1);
      permissions.push(...inherited);
    }

    return permissions;
  }

  private _registerBuiltInRoles(): void {
    // Admin: all permissions
    this._roles.set("admin", {
      id: "admin",
      name: "Administrator",
      permissions: [
        { action: "*", resource: "**" },
      ],
      inherits: [],
      priority: 100,
    });

    // Operator: read + write on all resources
    this._roles.set("operator", {
      id: "operator",
      name: "Operator",
      permissions: [
        { action: "read", resource: "**" },
        { action: "write", resource: "**" },
        { action: "create", resource: "**" },
        { action: "update", resource: "**" },
        { action: "list", resource: "**" },
      ],
      inherits: [],
      priority: 50,
    });

    // Viewer: read-only on all resources
    this._roles.set("viewer", {
      id: "viewer",
      name: "Viewer",
      permissions: [
        { action: "read", resource: "**" },
        { action: "list", resource: "**" },
      ],
      inherits: [],
      priority: 20,
    });

    // Auditor: read + audit on all resources
    this._roles.set("auditor", {
      id: "auditor",
      name: "Auditor",
      permissions: [
        { action: "read", resource: "**" },
        { action: "list", resource: "**" },
        { action: "audit", resource: "**" },
        { action: "export", resource: "**" },
      ],
      inherits: [],
      priority: 30,
    });
  }
}

// ─── Section 3: PolicyEngine ────────────────────────────────────────

/**
 * Evaluates access requests against a set of configurable policies.
 *
 * Uses deny-override combining: if ANY deny policy matches, the result is deny,
 * regardless of allow policies. Policies are sorted by priority (higher = more important).
 */
export class PolicyEngine {
  private readonly _policies = new Map<string, Policy>();
  private readonly _evaluationCache = new Map<string, { decision: AccessDecision; expiry: number }>();
  private readonly _cacheCleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Clean up expired cache entries every 30 seconds
    this._cacheCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of Array.from(this._evaluationCache.entries())) {
        if (entry.expiry < now) {
          this._evaluationCache.delete(key);
        }
      }
    }, 30_000);
    if (this._cacheCleanupTimer && typeof this._cacheCleanupTimer === "object" && "unref" in this._cacheCleanupTimer) {
      (this._cacheCleanupTimer as NodeJS.Timeout).unref();
    }
  }

  // ── Policy CRUD ─────────────────────────────────────────────────────

  addPolicy(policy: Policy): void {
    this._policies.set(policy.id, policy);
    this._evaluationCache.clear();
    console.info(JSON.stringify({
      event: "acl_policy_added",
      policyId: policy.id,
      name: policy.name,
      effect: policy.effect,
      priority: policy.priority,
      timestamp: Date.now(),
    }));
  }

  removePolicy(policyId: string): boolean {
    const removed = this._policies.delete(policyId);
    if (removed) {
      this._evaluationCache.clear();
      console.info(JSON.stringify({
        event: "acl_policy_removed",
        policyId,
        timestamp: Date.now(),
      }));
    }
    return removed;
  }

  getPolicy(policyId: string): Policy | undefined {
    return this._policies.get(policyId);
  }

  getAllPolicies(): Policy[] {
    return Array.from(this._policies.values());
  }

  // ── Evaluation ──────────────────────────────────────────────────────

  /**
   * Evaluate a single access request against all policies.
   *
   * Deny-override algorithm:
   *  1. Find all policies that match subject, resource, and action.
   *  2. Run condition predicates on matching policies.
   *  3. If ANY matching policy has effect=deny, result is deny.
   *  4. If at least one matching policy has effect=allow (and no denies), result is allow.
   *  5. If no policies match, default is deny (closed system).
   */
  evaluate(request: AccessRequest, userRoleIds?: string[]): AccessDecision {
    const startTime = performance.now();
    const matchedPolicies: string[] = [];
    let hasDeny = false;
    let hasAllow = false;
    let denyReason = "";
    let allowReason = "";

    // Sort policies by priority (higher first)
    const sortedPolicies = Array.from(this._policies.values()).sort(
      (a, b) => b.priority - a.priority,
    );

    for (const policy of sortedPolicies) {
      // Check subject match
      if (!this._matchesSubjects(policy.subjects, request.userId, userRoleIds ?? [])) {
        continue;
      }

      // Check resource match
      if (!this._matchesPatterns(policy.resources, request.resource)) {
        continue;
      }

      // Check action match
      if (!this._matchesPatterns(policy.actions, request.action)) {
        continue;
      }

      // Check conditions
      let conditionsMet = true;
      for (const condition of policy.conditions) {
        try {
          if (!condition(request)) {
            conditionsMet = false;
            break;
          }
        } catch {
          conditionsMet = false;
          break;
        }
      }
      if (!conditionsMet) continue;

      // Policy matches
      matchedPolicies.push(policy.id);

      if (policy.effect === "deny") {
        hasDeny = true;
        denyReason = `Denied by policy "${policy.name}" (${policy.id})`;
      } else if (policy.effect === "allow") {
        hasAllow = true;
        allowReason = `Allowed by policy "${policy.name}" (${policy.id})`;
      }
    }

    const evaluationTimeMs = performance.now() - startTime;

    // Deny-override: deny wins
    if (hasDeny) {
      return {
        allowed: false,
        matchedPolicies,
        reason: denyReason,
        evaluationTimeMs,
      };
    }

    if (hasAllow) {
      return {
        allowed: true,
        matchedPolicies,
        reason: allowReason,
        evaluationTimeMs,
      };
    }

    // No policies matched — default deny (closed system)
    return {
      allowed: false,
      matchedPolicies: [],
      reason: "No matching policies found — default deny",
      evaluationTimeMs,
    };
  }

  /**
   * Evaluate multiple access requests in batch. Uses a shared cache
   * for requests with the same (userId, action, resource) tuple.
   */
  evaluateBatch(requests: AccessRequest[], userRoleIds?: string[]): AccessDecision[] {
    const cache = new Map<string, AccessDecision>();
    const results: AccessDecision[] = [];

    for (const request of requests) {
      const cacheKey = `${request.userId}::${request.action}::${request.resource}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        results.push(cached);
      } else {
        const decision = this.evaluate(request, userRoleIds);
        cache.set(cacheKey, decision);
        results.push(decision);
      }
    }

    return results;
  }

  /**
   * Detect conflicts between policies: pairs that match the same
   * subject+resource+action patterns but have opposite effects.
   */
  detectConflicts(): PolicyConflict[] {
    const conflicts: PolicyConflict[] = [];
    const policyList = Array.from(this._policies.values());

    for (let i = 0; i < policyList.length; i++) {
      for (let j = i + 1; j < policyList.length; j++) {
        const a = policyList[i];
        const b = policyList[j];

        // Only care about allow/deny conflicts
        if (a.effect === b.effect) continue;

        const overlappingSubjects = this._findOverlaps(a.subjects, b.subjects);
        const overlappingResources = this._findOverlaps(a.resources, b.resources);
        const overlappingActions = this._findOverlaps(a.actions, b.actions);

        if (
          overlappingSubjects.length > 0 &&
          overlappingResources.length > 0 &&
          overlappingActions.length > 0
        ) {
          conflicts.push({
            policyA: a.id,
            policyB: b.id,
            overlappingSubjects,
            overlappingResources,
            overlappingActions,
            conflictType: "allow_deny_conflict",
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Reset all policies and clear cache.
   */
  reset(): void {
    this._policies.clear();
    this._evaluationCache.clear();
  }

  /**
   * Dispose the cache cleanup timer.
   */
  dispose(): void {
    clearInterval(this._cacheCleanupTimer);
  }

  // ── Private Helpers ─────────────────────────────────────────────────

  private _matchesSubjects(
    subjectPatterns: string[],
    userId: string,
    roleIds: string[],
  ): boolean {
    for (const pattern of subjectPatterns) {
      // Check against userId
      if (globMatch(pattern, userId)) return true;
      // Check against role IDs (prefixed with "role:")
      if (pattern.startsWith("role:")) {
        const rolePattern = pattern.slice(5);
        for (const roleId of roleIds) {
          if (globMatch(rolePattern, roleId)) return true;
        }
      }
      // Check bare role IDs
      for (const roleId of roleIds) {
        if (globMatch(pattern, `role:${roleId}`)) return true;
      }
    }
    return false;
  }

  private _matchesPatterns(patterns: string[], value: string): boolean {
    for (const pattern of patterns) {
      if (globMatch(pattern, value)) return true;
    }
    return false;
  }

  private _findOverlaps(patternsA: string[], patternsB: string[]): string[] {
    const overlaps: string[] = [];
    for (const a of patternsA) {
      for (const b of patternsB) {
        // Two patterns overlap if either could match the other, or both contain wildcards
        if (globMatch(a, b) || globMatch(b, a) || (a.includes("*") && b.includes("*"))) {
          overlaps.push(`${a} <-> ${b}`);
        }
      }
    }
    return overlaps;
  }
}

// ─── Section 4: AttributeBasedAccessControl ─────────────────────────

/**
 * Provides attribute resolution and condition evaluation for ABAC policies.
 *
 * Supports:
 *  - Pluggable attribute resolvers
 *  - Rich condition operators (eq, neq, gt, lt, gte, lte, in, not_in, contains, matches, between, exists)
 *  - Time-based conditions (timeOfDay, dayOfWeek, isBusinessHours)
 *  - IP-based conditions (CIDR matching for /8, /16, /24, /32)
 *  - Rate-based conditions (sliding window counter)
 */
export class AttributeBasedAccessControl {
  private readonly _attributes = new Map<string, AttributeDefinition>();

  constructor() {
    this._registerBuiltInAttributes();
  }

  // ── Attribute Registration ──────────────────────────────────────────

  /**
   * Register a custom attribute resolver.
   */
  registerAttribute(name: string, resolver: (userId: string, context: Record<string, unknown>) => unknown): void {
    this._attributes.set(name, { name, resolver });
  }

  /**
   * Resolve all registered attributes for a user in a given context.
   */
  resolveAttributes(userId: string, context: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [name, def] of Array.from(this._attributes.entries())) {
      try {
        result[name] = def.resolver(userId, context);
      } catch {
        result[name] = undefined;
      }
    }
    return result;
  }

  // ── Condition Evaluation ────────────────────────────────────────────

  /**
   * Evaluate a single condition predicate against a set of resolved attributes.
   */
  evaluateCondition(condition: ConditionPredicate, attributes: Record<string, unknown>): boolean {
    const attrValue = attributes[condition.attribute];

    switch (condition.operator) {
      case "eq":
        return attrValue === condition.value;

      case "neq":
        return attrValue !== condition.value;

      case "gt":
        return typeof attrValue === "number" && typeof condition.value === "number"
          && attrValue > condition.value;

      case "lt":
        return typeof attrValue === "number" && typeof condition.value === "number"
          && attrValue < condition.value;

      case "gte":
        return typeof attrValue === "number" && typeof condition.value === "number"
          && attrValue >= condition.value;

      case "lte":
        return typeof attrValue === "number" && typeof condition.value === "number"
          && attrValue <= condition.value;

      case "in": {
        if (!Array.isArray(condition.value)) return false;
        return (condition.value as unknown[]).includes(attrValue);
      }

      case "not_in": {
        if (!Array.isArray(condition.value)) return true;
        return !(condition.value as unknown[]).includes(attrValue);
      }

      case "contains": {
        if (typeof attrValue === "string" && typeof condition.value === "string") {
          return attrValue.includes(condition.value);
        }
        if (Array.isArray(attrValue)) {
          return attrValue.includes(condition.value);
        }
        return false;
      }

      case "matches": {
        if (typeof attrValue !== "string" || typeof condition.value !== "string") return false;
        try {
          const regex = new RegExp(condition.value);
          return regex.test(attrValue);
        } catch {
          return false;
        }
      }

      case "between": {
        if (typeof attrValue !== "number") return false;
        if (!Array.isArray(condition.value) || (condition.value as unknown[]).length !== 2) return false;
        const [low, high] = condition.value as [unknown, unknown];
        if (typeof low !== "number" || typeof high !== "number") return false;
        return attrValue >= low && attrValue <= high;
      }

      case "exists":
        return condition.value
          ? attrValue !== undefined && attrValue !== null
          : attrValue === undefined || attrValue === null;

      default:
        return false;
    }
  }

  /**
   * Evaluate multiple conditions (AND logic — all must pass).
   */
  evaluateConditions(conditions: ConditionPredicate[], attributes: Record<string, unknown>): boolean {
    for (const condition of conditions) {
      if (!this.evaluateCondition(condition, attributes)) return false;
    }
    return true;
  }

  // ── Time-Based Conditions ───────────────────────────────────────────

  /**
   * Get the current hour of day (0-23).
   */
  timeOfDay(): number {
    return new Date().getHours();
  }

  /**
   * Get the current day of week (0=Sunday, 6=Saturday).
   */
  dayOfWeek(): number {
    return new Date().getDay();
  }

  /**
   * Check if the current time is within business hours (9:00-17:00, Mon-Fri).
   */
  isBusinessHours(): boolean {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    return day >= 1 && day <= 5 && hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
  }

  // ── IP-Based Conditions ─────────────────────────────────────────────

  /**
   * Check if an IP address falls within a CIDR range.
   */
  ipInRange(ip: string, cidr: string): boolean {
    return ipInCidr(ip, cidr);
  }

  /**
   * Check if an IP address falls within any of the given CIDR ranges.
   */
  ipInRanges(ip: string, cidrs: string[]): boolean {
    for (const cidr of cidrs) {
      if (ipInCidr(ip, cidr)) return true;
    }
    return false;
  }

  // ── Rate-Based Conditions ───────────────────────────────────────────

  /**
   * Check if a user has exceeded the maximum number of operations within a sliding window.
   * Records the current operation as a side effect.
   */
  operationsInWindow(userId: string, windowMs: number, maxOps: number): boolean {
    const key = `rate:${userId}`;
    recordRateEvent(key);
    const count = getOperationsInWindow(key, windowMs);
    return count > maxOps;
  }

  /**
   * Get the current operation count for a user in the given window.
   */
  getOperationCount(userId: string, windowMs: number): number {
    const key = `rate:${userId}`;
    return getOperationsInWindow(key, windowMs);
  }

  /**
   * Reset all state.
   */
  reset(): void {
    this._attributes.clear();
    this._registerBuiltInAttributes();
  }

  // ── Private Helpers ─────────────────────────────────────────────────

  private _registerBuiltInAttributes(): void {
    this._attributes.set("timeOfDay", {
      name: "timeOfDay",
      resolver: () => new Date().getHours(),
    });

    this._attributes.set("dayOfWeek", {
      name: "dayOfWeek",
      resolver: () => new Date().getDay(),
    });

    this._attributes.set("isBusinessHours", {
      name: "isBusinessHours",
      resolver: () => {
        const now = new Date();
        const hour = now.getHours();
        const day = now.getDay();
        return day >= 1 && day <= 5 && hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
      },
    });

    this._attributes.set("timestamp", {
      name: "timestamp",
      resolver: () => Date.now(),
    });

    this._attributes.set("ip", {
      name: "ip",
      resolver: (_userId: string, context: Record<string, unknown>) => {
        return typeof context["ip"] === "string" ? context["ip"] : undefined;
      },
    });

    this._attributes.set("userAgent", {
      name: "userAgent",
      resolver: (_userId: string, context: Record<string, unknown>) => {
        return typeof context["userAgent"] === "string" ? context["userAgent"] : undefined;
      },
    });
  }
}

// ─── Section 5: ResourceHierarchy ───────────────────────────────────

/**
 * Manages a hierarchical resource tree. Resources are identified by paths
 * (e.g., `connectors/slack/channels`). Permissions on parent resources
 * inherit down to children unless explicitly overridden.
 */
export class ResourceHierarchy {
  private readonly _resources = new Map<string, ResourceNode>();

  // ── Registration ────────────────────────────────────────────────────

  /**
   * Register a resource in the hierarchy.
   */
  registerResource(path: string, parent?: string, metadata?: Record<string, unknown>): void {
    // Validate parent exists if specified
    if (parent !== undefined && !this._resources.has(parent)) {
      throw new Error(`Parent resource "${parent}" does not exist`);
    }

    const node: ResourceNode = {
      path,
      parent: parent ?? null,
      children: [],
      metadata: metadata ?? {},
    };

    this._resources.set(path, node);

    // Register as child of parent
    if (parent !== undefined) {
      const parentNode = this._resources.get(parent);
      if (parentNode && !parentNode.children.includes(path)) {
        parentNode.children.push(path);
      }
    }

    console.info(JSON.stringify({
      event: "acl_resource_registered",
      path,
      parent: parent ?? null,
      timestamp: Date.now(),
    }));
  }

  /**
   * Remove a resource and all its descendants.
   */
  removeResource(path: string): boolean {
    const node = this._resources.get(path);
    if (!node) return false;

    // Remove all descendants first
    const descendants = this.getDescendants(path);
    for (const desc of descendants) {
      this._resources.delete(desc);
    }

    // Remove from parent's children list
    if (node.parent !== null) {
      const parentNode = this._resources.get(node.parent);
      if (parentNode) {
        parentNode.children = parentNode.children.filter((c) => c !== path);
      }
    }

    this._resources.delete(path);
    return true;
  }

  /**
   * Get a resource node by path.
   */
  getResource(path: string): ResourceNode | undefined {
    return this._resources.get(path);
  }

  /**
   * Get all registered resource paths.
   */
  getAllResources(): string[] {
    return Array.from(this._resources.keys());
  }

  // ── Traversal ───────────────────────────────────────────────────────

  /**
   * Get all ancestor paths for a resource, from immediate parent to root.
   */
  getAncestors(resourcePath: string): string[] {
    const ancestors: string[] = [];
    let current = this._resources.get(resourcePath);
    const visited = new Set<string>();

    while (current && current.parent !== null) {
      if (visited.has(current.parent)) break;
      visited.add(current.parent);
      ancestors.push(current.parent);
      current = this._resources.get(current.parent);
    }

    return ancestors;
  }

  /**
   * Get all descendant paths for a resource (breadth-first).
   */
  getDescendants(resourcePath: string): string[] {
    const descendants: string[] = [];
    const queue: string[] = [resourcePath];
    const visited = new Set<string>();
    visited.add(resourcePath);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this._resources.get(current);
      if (!node) continue;

      for (const child of node.children) {
        if (!visited.has(child)) {
          visited.add(child);
          descendants.push(child);
          queue.push(child);
        }
      }
    }

    return descendants;
  }

  // ── Pattern Matching ────────────────────────────────────────────────

  /**
   * Match a resource path against a glob pattern.
   * `*` matches a single path segment, `**` matches zero or more segments.
   */
  matchResource(pattern: string, resourcePath: string): boolean {
    return matchResourcePath(pattern, resourcePath);
  }

  /**
   * Find all registered resources matching a pattern.
   */
  findMatchingResources(pattern: string): string[] {
    const matches: string[] = [];
    for (const path of Array.from(this._resources.keys())) {
      if (matchResourcePath(pattern, path)) {
        matches.push(path);
      }
    }
    return matches;
  }

  // ── Permission Inheritance ──────────────────────────────────────────

  /**
   * Get effective permissions for a user on a resource, considering hierarchy.
   *
   * Walks from the resource up to its root, collecting all permissions from the
   * role manager. The most specific (deepest) permissions take precedence.
   */
  getEffectivePermissionsForResource(
    userId: string,
    resourcePath: string,
    roleManager: RoleManager,
  ): Permission[] {
    const permissionMap = new Map<string, Permission>();

    // Start from ancestors (least specific) and work toward the resource itself
    const ancestors = this.getAncestors(resourcePath);
    const pathsToCheck = [...ancestors.reverse(), resourcePath];

    const userPermissions = roleManager.getUserEffectivePermissions(userId);

    for (const checkPath of pathsToCheck) {
      for (const perm of userPermissions) {
        if (matchResourcePath(perm.resource, checkPath)) {
          const key = `${perm.action}::${checkPath}`;
          // Later (more specific) entries overwrite earlier ones
          permissionMap.set(key, { ...perm, resource: checkPath });
        }
      }
    }

    return Array.from(permissionMap.values());
  }

  /**
   * Reset all resources.
   */
  reset(): void {
    this._resources.clear();
  }
}

// ─── Section 6: AccessControlAuditLog ───────────────────────────────

/**
 * Ring-buffer audit log for access control decisions.
 *
 * Features:
 *  - Ring buffer (max 5000 entries)
 *  - Filtered query (userId, action, resource, allowed, time range)
 *  - Access pattern analysis
 *  - Anomaly detection
 *  - CSV/JSON export
 */
export class AccessControlAuditLog {
  private readonly _buffer: RingBuffer<AuditEntry>;
  private _totalLogged: number = 0;

  // Track first-seen resources per user for anomaly detection
  private readonly _knownResources = new Map<string, Set<string>>();
  // Track access times per user
  private readonly _accessTimes = new Map<string, number[]>();

  constructor(capacity: number = AUDIT_BUFFER_CAPACITY) {
    this._buffer = new RingBuffer<AuditEntry>(capacity);
  }

  // ── Logging ─────────────────────────────────────────────────────────

  /**
   * Record an access evaluation in the audit log.
   */
  log(request: AccessRequest, decision: AccessDecision): AuditEntry {
    const entry: AuditEntry = {
      id: randomUUID(),
      request,
      decision,
      timestamp: Date.now(),
      policyTrace: [...decision.matchedPolicies],
    };

    this._buffer.push(entry);
    this._totalLogged++;

    // Track known resources for anomaly detection
    let resourceSet = this._knownResources.get(request.userId);
    if (!resourceSet) {
      resourceSet = new Set<string>();
      this._knownResources.set(request.userId, resourceSet);
    }
    resourceSet.add(request.resource);

    // Track access times
    let times = this._accessTimes.get(request.userId);
    if (!times) {
      times = [];
      this._accessTimes.set(request.userId, times);
    }
    times.push(entry.timestamp);
    // Keep only last 1000 timestamps
    if (times.length > 1000) {
      times.splice(0, times.length - 1000);
    }

    return entry;
  }

  // ── Query ───────────────────────────────────────────────────────────

  /**
   * Query audit entries with filters.
   */
  query(filters: AuditQueryFilters): AuditEntry[] {
    let entries = this._buffer.toArrayOldestFirst();

    if (filters.userId !== undefined) {
      entries = entries.filter((e) => e.request.userId === filters.userId);
    }
    if (filters.action !== undefined) {
      entries = entries.filter((e) => e.request.action === filters.action);
    }
    if (filters.resource !== undefined) {
      entries = entries.filter((e) => e.request.resource === filters.resource);
    }
    if (filters.allowed !== undefined) {
      entries = entries.filter((e) => e.decision.allowed === filters.allowed);
    }
    if (filters.since !== undefined) {
      entries = entries.filter((e) => e.timestamp >= filters.since!);
    }
    if (filters.until !== undefined) {
      entries = entries.filter((e) => e.timestamp <= filters.until!);
    }

    // Sort newest first for return
    entries.sort((a, b) => b.timestamp - a.timestamp);

    if (filters.limit !== undefined && filters.limit > 0) {
      entries = entries.slice(0, filters.limit);
    }

    return entries;
  }

  // ── Access Patterns ─────────────────────────────────────────────────

  /**
   * Analyze access patterns for a user.
   */
  getAccessPatterns(userId: string, windowMs?: number): AccessPatterns {
    const window = windowMs ?? DEFAULT_RATE_WINDOW_MS * 60; // Default 1 hour
    const cutoff = Date.now() - window;

    const entries = this._buffer.toArrayOldestFirst().filter(
      (e) => e.request.userId === userId && e.timestamp >= cutoff,
    );

    // Most accessed resources
    const resourceCounts = new Map<string, number>();
    const actionCounts: Record<string, number> = {};
    let denials = 0;

    for (const entry of entries) {
      const rCount = resourceCounts.get(entry.request.resource) ?? 0;
      resourceCounts.set(entry.request.resource, rCount + 1);

      actionCounts[entry.request.action] = (actionCounts[entry.request.action] ?? 0) + 1;

      if (!entry.decision.allowed) denials++;
    }

    const mostAccessedResources = Array.from(resourceCounts.entries())
      .map(([resource, count]) => ({ resource, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      userId,
      totalAccesses: entries.length,
      mostAccessedResources,
      actionDistribution: actionCounts,
      denialRate: entries.length > 0 ? denials / entries.length : 0,
      windowMs: window,
    };
  }

  // ── Anomaly Detection ───────────────────────────────────────────────

  /**
   * Detect anomalies across all users.
   *
   * Detects:
   *  - Unusual access times (outside business hours with write/delete actions)
   *  - High denial rates (>30%)
   *  - New resource access (resources not seen before in user's history)
   *  - Privilege escalation attempts (denied admin/delete actions)
   */
  getAnomalies(): AccessAnomaly[] {
    const anomalies: AccessAnomaly[] = [];
    const now = Date.now();
    const windowMs = 3600_000; // 1 hour
    const cutoff = now - windowMs;

    const recentEntries = this._buffer.toArrayOldestFirst().filter(
      (e) => e.timestamp >= cutoff,
    );

    // Group by userId
    const byUser = new Map<string, AuditEntry[]>();
    for (const entry of recentEntries) {
      let userEntries = byUser.get(entry.request.userId);
      if (!userEntries) {
        userEntries = [];
        byUser.set(entry.request.userId, userEntries);
      }
      userEntries.push(entry);
    }

    for (const [userId, entries] of Array.from(byUser.entries())) {
      // Check denial rate
      const denials = entries.filter((e) => !e.decision.allowed);
      const denialRate = entries.length > 0 ? denials.length / entries.length : 0;

      if (denialRate > DEFAULT_ANOMALY_DENIAL_RATE_THRESHOLD && entries.length >= 3) {
        anomalies.push({
          type: "high_denial_rate",
          userId,
          description: `User has a ${(denialRate * 100).toFixed(1)}% denial rate (${denials.length}/${entries.length} requests denied) in the last hour`,
          timestamp: now,
          severity: denialRate > 0.7 ? "high" : "medium",
        });
      }

      // Check for unusual access times
      for (const entry of entries) {
        const entryDate = new Date(entry.timestamp);
        const hour = entryDate.getHours();
        const day = entryDate.getDay();
        const isWeekend = day === 0 || day === 6;
        const isLateNight = hour < 6 || hour >= 22;
        const isWriteOrDelete = entry.request.action === "write"
          || entry.request.action === "delete"
          || entry.request.action === "admin";

        if ((isWeekend || isLateNight) && isWriteOrDelete) {
          anomalies.push({
            type: "unusual_time",
            userId,
            description: `Sensitive action "${entry.request.action}" on "${entry.request.resource}" performed at unusual time (${entryDate.toISOString()})`,
            timestamp: entry.timestamp,
            severity: isLateNight ? "high" : "medium",
          });
        }
      }

      // Check for privilege escalation attempts
      const adminDenials = denials.filter((e) =>
        e.request.action === "admin"
        || e.request.action === "delete"
        || e.request.resource.includes("admin")
        || e.request.resource.includes("config")
        || e.request.resource.includes("security"),
      );

      if (adminDenials.length >= 2) {
        anomalies.push({
          type: "privilege_escalation",
          userId,
          description: `User attempted ${adminDenials.length} denied admin/sensitive actions in the last hour`,
          timestamp: now,
          severity: adminDenials.length >= 5 ? "critical" : "high",
        });
      }

      // Check for new resource access (resources not previously seen)
      const knownResources = this._knownResources.get(userId);
      if (knownResources) {
        const allOlderEntries = this._buffer.toArrayOldestFirst().filter(
          (e) => e.request.userId === userId && e.timestamp < cutoff,
        );
        const olderResources = new Set<string>();
        for (const e of allOlderEntries) {
          olderResources.add(e.request.resource);
        }

        const newResources = new Set<string>();
        for (const entry of entries) {
          if (!olderResources.has(entry.request.resource)) {
            newResources.add(entry.request.resource);
          }
        }

        if (newResources.size >= 5) {
          anomalies.push({
            type: "new_resource_access",
            userId,
            description: `User accessed ${newResources.size} previously unseen resources in the last hour`,
            timestamp: now,
            severity: newResources.size >= 10 ? "high" : "low",
          });
        }
      }
    }

    return anomalies;
  }

  // ── Export ──────────────────────────────────────────────────────────

  /**
   * Export all audit entries as a JSON string.
   */
  exportJson(): string {
    const entries = this._buffer.toArrayOldestFirst();
    return JSON.stringify(entries.map((e) => ({
      id: e.id,
      timestamp: new Date(e.timestamp).toISOString(),
      userId: e.request.userId,
      action: e.request.action,
      resource: e.request.resource,
      allowed: e.decision.allowed,
      reason: e.decision.reason,
      matchedPolicies: e.decision.matchedPolicies.join(";"),
      evaluationTimeMs: e.decision.evaluationTimeMs.toFixed(3),
      policyTrace: e.policyTrace.join(";"),
    })), null, 2);
  }

  /**
   * Export all audit entries as CSV.
   */
  exportCsv(): string {
    const entries = this._buffer.toArrayOldestFirst();
    const header = "id,timestamp,userId,action,resource,allowed,reason,matchedPolicies,evaluationTimeMs,policyTrace";
    const rows = entries.map((e) => {
      const escapeCsv = (s: string) => `"${s.replace(/"/g, '""')}"`;
      return [
        escapeCsv(e.id),
        escapeCsv(new Date(e.timestamp).toISOString()),
        escapeCsv(e.request.userId),
        escapeCsv(e.request.action),
        escapeCsv(e.request.resource),
        e.decision.allowed ? "true" : "false",
        escapeCsv(e.decision.reason),
        escapeCsv(e.decision.matchedPolicies.join(";")),
        e.decision.evaluationTimeMs.toFixed(3),
        escapeCsv(e.policyTrace.join(";")),
      ].join(",");
    });

    return [header, ...rows].join("\n");
  }

  // ── Stats ──────────────────────────────────────────────────────────

  get size(): number {
    return this._buffer.size;
  }

  get totalLogged(): number {
    return this._totalLogged;
  }

  /**
   * Reset all audit state.
   */
  reset(): void {
    this._buffer.clear();
    this._totalLogged = 0;
    this._knownResources.clear();
    this._accessTimes.clear();
  }
}

// ─── Section 7: ConnectorAccessControl (Facade) ─────────────────────

/**
 * Unified facade integrating all access control components.
 *
 * Provides a simple API for:
 *  - `can()` — single access check
 *  - `canBatch()` — batch access check
 *  - `enforce()` — throws AccessDeniedError if denied
 *  - Permission, role, and policy management
 *  - Access reports and audit
 */
export class ConnectorAccessControl {
  public readonly roleManager: RoleManager;
  public readonly policyEngine: PolicyEngine;
  public readonly abac: AttributeBasedAccessControl;
  public readonly resourceHierarchy: ResourceHierarchy;
  public readonly auditLog: AccessControlAuditLog;

  private _totalEvaluations: number = 0;
  private _totalDenials: number = 0;

  constructor() {
    this.roleManager = new RoleManager();
    this.policyEngine = new PolicyEngine();
    this.abac = new AttributeBasedAccessControl();
    this.resourceHierarchy = new ResourceHierarchy();
    this.auditLog = new AccessControlAuditLog();
  }

  // ── Primary API ─────────────────────────────────────────────────────

  /**
   * Check if a user is allowed to perform an action on a resource.
   *
   * Evaluation order:
   *  1. Resolve user's role IDs
   *  2. Check RBAC (role permissions) for a quick allow
   *  3. Evaluate all policies (deny-override)
   *  4. Resolve ABAC attributes and evaluate conditions on matched policies
   *  5. Record in audit log
   */
  can(userId: string, action: string, resource: string, context?: Record<string, unknown>): AccessDecision {
    const ctx = context ?? {};
    const request: AccessRequest = { userId, action, resource, context: ctx };
    const startTime = performance.now();

    this._totalEvaluations++;

    // Get user's role IDs for policy subject matching
    const userRoleIds = this.roleManager.getUserRoleIds(userId);

    // Check role-based permissions first (fast path)
    const hasRolePermission = this.roleManager.hasPermission(userId, action, resource);

    // Evaluate policies (deny-override)
    const policyDecision = this.policyEngine.evaluate(request, userRoleIds);

    // Determine final decision
    let decision: AccessDecision;

    if (policyDecision.matchedPolicies.length > 0) {
      // Policies were evaluated — use policy decision (deny-override)
      const evaluationTimeMs = performance.now() - startTime;
      decision = {
        ...policyDecision,
        evaluationTimeMs,
      };
    } else if (hasRolePermission) {
      // No explicit policies, but role grants permission
      const evaluationTimeMs = performance.now() - startTime;
      decision = {
        allowed: true,
        matchedPolicies: [],
        reason: `Allowed by role-based permission for user "${userId}"`,
        evaluationTimeMs,
      };
    } else {
      // No policies match and no role permission — deny
      const evaluationTimeMs = performance.now() - startTime;
      decision = {
        allowed: false,
        matchedPolicies: [],
        reason: `No matching policies or role permissions for user "${userId}" on "${action}" "${resource}"`,
        evaluationTimeMs,
      };
    }

    if (!decision.allowed) {
      this._totalDenials++;
    }

    // Record in audit log
    this.auditLog.log(request, decision);

    return decision;
  }

  /**
   * Batch check multiple access requests.
   */
  canBatch(requests: AccessRequest[]): AccessDecision[] {
    const decisions: AccessDecision[] = [];
    for (const request of requests) {
      decisions.push(this.can(request.userId, request.action, request.resource, request.context));
    }
    return decisions;
  }

  /**
   * Check access and throw AccessDeniedError if denied.
   */
  enforce(userId: string, action: string, resource: string, context?: Record<string, unknown>): void {
    const decision = this.can(userId, action, resource, context);
    if (!decision.allowed) {
      throw new AccessDeniedError(userId, action, resource, decision);
    }
  }

  // ── Permission Introspection ────────────────────────────────────────

  /**
   * Get all effective permissions for a user across all assigned roles and policies.
   */
  getEffectivePermissions(userId: string): Permission[] {
    return this.roleManager.getUserEffectivePermissions(userId);
  }

  // ── Reports ─────────────────────────────────────────────────────────

  /**
   * Generate a comprehensive access report for a single user.
   */
  getUserAccessReport(userId: string): UserAccessReport {
    const roles = this.roleManager.getUserRoles(userId);
    const effectivePermissions = this.roleManager.getUserEffectivePermissions(userId);
    const recentAccess = this.auditLog.query({ userId, limit: 50 });
    const anomalies = this.auditLog.getAnomalies().filter((a) => a.userId === userId);
    const accessPatterns = this.auditLog.getAccessPatterns(userId);

    return {
      userId,
      roles,
      effectivePermissions,
      recentAccess,
      anomalies,
      accessPatterns,
    };
  }

  /**
   * Generate a system-wide access report.
   */
  getSystemAccessReport(): SystemAccessReport {
    const policyCount = this.policyEngine.getAllPolicies().length;
    const roleCount = this.roleManager.getAllRoles().length;
    const userCount = this.roleManager.getAllUserIds().length;

    // Top denied resources
    const deniedEntries = this.auditLog.query({ allowed: false, limit: 1000 });
    const resourceDenialCounts = new Map<string, number>();
    for (const entry of deniedEntries) {
      const count = resourceDenialCounts.get(entry.request.resource) ?? 0;
      resourceDenialCounts.set(entry.request.resource, count + 1);
    }
    const topDeniedResources = Array.from(resourceDenialCounts.entries())
      .map(([resource, count]) => ({ resource, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Anomaly summary
    const anomalies = this.auditLog.getAnomalies();
    const anomalySummary: Record<string, number> = {};
    for (const anomaly of anomalies) {
      anomalySummary[anomaly.type] = (anomalySummary[anomaly.type] ?? 0) + 1;
    }

    return {
      policyCount,
      roleCount,
      userCount,
      topDeniedResources,
      anomalySummary,
      totalEvaluations: this._totalEvaluations,
      totalDenials: this._totalDenials,
    };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Reset all components to initial state.
   */
  reset(): void {
    this.roleManager.reset();
    this.policyEngine.reset();
    this.abac.reset();
    this.resourceHierarchy.reset();
    this.auditLog.reset();
    this._totalEvaluations = 0;
    this._totalDenials = 0;
    rateTracker.clear();
  }

  /**
   * Dispose timers and resources.
   */
  dispose(): void {
    this.policyEngine.dispose();
  }

  /**
   * Get a fingerprint hash of the current policy + role configuration.
   * Useful for cache invalidation.
   */
  getConfigFingerprint(): string {
    const policies = this.policyEngine.getAllPolicies().map((p) => `${p.id}:${p.effect}:${p.priority}`);
    const roles = this.roleManager.getAllRoles().map((r) => `${r.id}:${r.priority}:${r.inherits.join(",")}`);
    const combined = [...policies, ...roles].sort().join("|");
    return crypto.createHash("sha256").update(combined).digest("hex").slice(0, 16);
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const connectorAccessControl = new ConnectorAccessControl();
