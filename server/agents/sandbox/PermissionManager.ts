import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import type { SandboxPermissions } from "./WASMSandbox.js";
import { PERMISSION_PRESETS } from "./WASMSandbox.js";

const logger = pino({ name: "PermissionManager" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type PermissionScope =
  | "filesystem:read"
  | "filesystem:write"
  | "network:fetch"
  | "network:websocket"
  | "shell:execute"
  | "browser:control"
  | "agent:spawn"
  | "memory:cross-user"
  | "model:invoke"
  | "tool:invoke"
  | `tool:${string}`
  | `model:${string}`
  | string;

export type PermissionStatus = "granted" | "denied" | "pending" | "revoked";

export interface PermissionGrant {
  grantId: string;
  agentId: string;
  scope: PermissionScope;
  grantedBy: string; // userId or "system" or "admin"
  grantedAt: number;
  expiresAt?: number;
  reason?: string;
  /** If true, this is an elevated/sensitive permission */
  sensitive: boolean;
  /** Scope-specific constraints, e.g. { paths: ["/tmp/*"] } for filesystem */
  constraints?: Record<string, unknown>;
}

export interface PermissionRequest {
  requestId: string;
  agentId: string;
  userId: string;
  scope: PermissionScope;
  reason: string;
  requestedAt: number;
  status: PermissionStatus;
  resolvedBy?: string;
  resolvedAt?: number;
}

export interface AuditLogEntry {
  entryId: string;
  agentId: string;
  userId?: string;
  scope: PermissionScope;
  action: "check" | "grant" | "deny" | "revoke" | "request" | "expire";
  outcome: "allowed" | "denied";
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface AgentPermissionProfile {
  agentId: string;
  basePreset: keyof typeof PERMISSION_PRESETS;
  grants: PermissionGrant[];
  denials: PermissionScope[];
  sandboxPermissions: SandboxPermissions;
  createdAt: number;
  updatedAt: number;
}

// ─── PermissionManager ────────────────────────────────────────────────────────

export class PermissionManager extends EventEmitter {
  private profiles = new Map<string, AgentPermissionProfile>();
  private grants = new Map<string, PermissionGrant[]>(); // agentId → grants
  private pendingRequests = new Map<string, PermissionRequest>();
  private auditLog: AuditLogEntry[] = [];
  private readonly maxAuditEntries = 100_000;

  constructor() {
    super();
    logger.info("[PermissionManager] Initialized");

    // Periodically expire grants
    setInterval(() => this.expireGrants(), 60_000);
  }

  // ── Profile management ────────────────────────────────────────────────────────

  createProfile(
    agentId: string,
    basePreset: keyof typeof PERMISSION_PRESETS = "standard",
    overrides: Partial<SandboxPermissions> = {}
  ): AgentPermissionProfile {
    const sandboxPermissions: SandboxPermissions = {
      ...PERMISSION_PRESETS[basePreset],
      ...overrides,
    };

    const profile: AgentPermissionProfile = {
      agentId,
      basePreset,
      grants: [],
      denials: [],
      sandboxPermissions,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.profiles.set(agentId, profile);
    this.grants.set(agentId, []);

    logger.info({ agentId, basePreset }, "[PermissionManager] Profile created");
    this.emit("profile:created", { agentId, basePreset });
    return profile;
  }

  getProfile(agentId: string): AgentPermissionProfile | null {
    return this.profiles.get(agentId) ?? null;
  }

  getSandboxPermissions(agentId: string): SandboxPermissions {
    const profile = this.profiles.get(agentId);
    return profile?.sandboxPermissions ?? PERMISSION_PRESETS.standard;
  }

  // ── Permission checks ─────────────────────────────────────────────────────────

  check(agentId: string, scope: PermissionScope): boolean {
    const profile = this.profiles.get(agentId);
    if (!profile) {
      this.logAudit(agentId, scope, "check", "denied", {
        reason: "No permission profile found",
      });
      return false;
    }

    // Explicit denials take precedence
    if (profile.denials.includes(scope)) {
      this.logAudit(agentId, scope, "check", "denied", { reason: "Explicit denial" });
      return false;
    }

    // Check granted scopes
    const agentGrants = this.grants.get(agentId) ?? [];
    const activeGrants = agentGrants.filter(
      (g) => !g.expiresAt || g.expiresAt > Date.now()
    );

    const hasGrant = activeGrants.some(
      (g) => g.scope === scope || this.scopeMatches(g.scope, scope)
    );

    if (hasGrant) {
      this.logAudit(agentId, scope, "check", "allowed");
      return true;
    }

    // Check if preset allows it
    const presetAllows = this.presetAllowsScope(profile.basePreset, scope);

    const outcome: "allowed" | "denied" = presetAllows ? "allowed" : "denied";
    this.logAudit(agentId, scope, "check", outcome, {
      reason: presetAllows ? `Allowed by preset '${profile.basePreset}'` : "Not in preset",
    });

    return presetAllows;
  }

  /** Throw if permission is denied */
  assert(agentId: string, scope: PermissionScope): void {
    if (!this.check(agentId, scope)) {
      throw new Error(
        `Permission denied: agent '${agentId}' does not have '${scope}' permission`
      );
    }
  }

  // ── Granting ──────────────────────────────────────────────────────────────────

  grant(
    agentId: string,
    scope: PermissionScope,
    grantedBy: string,
    opts: {
      reason?: string;
      expiresInMs?: number;
      sensitive?: boolean;
      constraints?: Record<string, unknown>;
    } = {}
  ): PermissionGrant {
    const profile = this.profiles.get(agentId);
    if (!profile) {
      throw new Error(`No permission profile for agent '${agentId}'`);
    }

    // Remove explicit denial if overriding
    profile.denials = profile.denials.filter((d) => d !== scope);

    const grant: PermissionGrant = {
      grantId: randomUUID(),
      agentId,
      scope,
      grantedBy,
      grantedAt: Date.now(),
      expiresAt: opts.expiresInMs ? Date.now() + opts.expiresInMs : undefined,
      reason: opts.reason,
      sensitive: opts.sensitive ?? this.isSensitiveScope(scope),
      constraints: opts.constraints,
    };

    const agentGrants = this.grants.get(agentId) ?? [];
    // Remove existing grants for same scope to avoid duplicates
    const filtered = agentGrants.filter((g) => g.scope !== scope);
    filtered.push(grant);
    this.grants.set(agentId, filtered);

    profile.updatedAt = Date.now();

    this.logAudit(agentId, scope, "grant", "allowed", {
      grantId: grant.grantId,
      grantedBy,
    });

    logger.info(
      { agentId, scope, grantedBy, sensitive: grant.sensitive },
      "[PermissionManager] Permission granted"
    );
    this.emit("permission:granted", { agentId, scope, grantedBy });
    return grant;
  }

  deny(agentId: string, scope: PermissionScope, reason?: string): void {
    const profile = this.profiles.get(agentId);
    if (!profile) return;

    // Remove any existing grants for this scope
    const agentGrants = this.grants.get(agentId) ?? [];
    this.grants.set(agentId, agentGrants.filter((g) => g.scope !== scope));

    if (!profile.denials.includes(scope)) {
      profile.denials.push(scope);
    }

    profile.updatedAt = Date.now();

    this.logAudit(agentId, scope, "deny", "denied", { reason });
    logger.info({ agentId, scope, reason }, "[PermissionManager] Permission denied");
    this.emit("permission:denied", { agentId, scope });
  }

  revoke(agentId: string, grantId: string, revokedBy: string): void {
    const agentGrants = this.grants.get(agentId) ?? [];
    const grant = agentGrants.find((g) => g.grantId === grantId);
    if (!grant) return;

    this.grants.set(
      agentId,
      agentGrants.filter((g) => g.grantId !== grantId)
    );

    this.logAudit(agentId, grant.scope, "revoke", "denied", {
      grantId,
      revokedBy,
    });
    logger.info({ agentId, grantId, revokedBy, scope: grant.scope }, "[PermissionManager] Grant revoked");
    this.emit("permission:revoked", { agentId, grantId, scope: grant.scope });
  }

  // ── Permission requests ───────────────────────────────────────────────────────

  requestPermission(
    agentId: string,
    userId: string,
    scope: PermissionScope,
    reason: string
  ): PermissionRequest {
    const request: PermissionRequest = {
      requestId: randomUUID(),
      agentId,
      userId,
      scope,
      reason,
      requestedAt: Date.now(),
      status: "pending",
    };

    this.pendingRequests.set(request.requestId, request);

    this.logAudit(agentId, scope, "request", "denied", { requestId: request.requestId, userId });
    this.emit("permission:requested", request);
    logger.info({ requestId: request.requestId, agentId, scope }, "[PermissionManager] Permission requested");
    return request;
  }

  resolveRequest(
    requestId: string,
    status: "granted" | "denied",
    resolvedBy: string
  ): PermissionRequest {
    const request = this.pendingRequests.get(requestId);
    if (!request) throw new Error(`Request '${requestId}' not found`);

    request.status = status;
    request.resolvedBy = resolvedBy;
    request.resolvedAt = Date.now();

    if (status === "granted") {
      this.grant(request.agentId, request.scope, resolvedBy, {
        reason: request.reason,
        sensitive: true,
      });
    }

    this.pendingRequests.delete(requestId);
    this.emit("permission:request:resolved", request);
    return request;
  }

  getPendingRequests(agentId?: string): PermissionRequest[] {
    const all = Array.from(this.pendingRequests.values());
    return agentId ? all.filter((r) => r.agentId === agentId) : all;
  }

  // ── Scope helpers ─────────────────────────────────────────────────────────────

  private scopeMatches(grantedScope: string, requestedScope: string): boolean {
    // Wildcard: "tool:*" matches "tool:web-search"
    if (grantedScope.endsWith(":*")) {
      const prefix = grantedScope.slice(0, -1);
      return requestedScope.startsWith(prefix);
    }
    return grantedScope === requestedScope;
  }

  private presetAllowsScope(
    preset: keyof typeof PERMISSION_PRESETS,
    scope: PermissionScope
  ): boolean {
    const p = PERMISSION_PRESETS[preset];
    switch (scope) {
      case "filesystem:read":
        return p.filesystem !== "none";
      case "filesystem:write":
        return p.filesystem === "readwrite";
      case "network:fetch":
        return p.networkAllowlist.length > 0;
      case "network:websocket":
        return p.networkAllowlist.length > 0;
      case "shell:execute":
        return p.allowChildProcesses;
      case "browser:control":
        return preset === "admin" || preset === "trusted";
      case "agent:spawn":
        return preset === "admin";
      case "memory:cross-user":
        return preset === "admin";
      default:
        if (scope.startsWith("tool:") || scope.startsWith("model:")) {
          return preset !== "minimal";
        }
        return false;
    }
  }

  private isSensitiveScope(scope: PermissionScope): boolean {
    const sensitiveScopes: PermissionScope[] = [
      "filesystem:write",
      "shell:execute",
      "browser:control",
      "agent:spawn",
      "memory:cross-user",
    ];
    return sensitiveScopes.includes(scope);
  }

  // ── Audit log ─────────────────────────────────────────────────────────────────

  private logAudit(
    agentId: string,
    scope: PermissionScope,
    action: AuditLogEntry["action"],
    outcome: AuditLogEntry["outcome"],
    details?: Record<string, unknown>
  ): void {
    const entry: AuditLogEntry = {
      entryId: randomUUID(),
      agentId,
      scope,
      action,
      outcome,
      timestamp: Date.now(),
      details,
    };

    this.auditLog.push(entry);
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog.shift();
    }
    this.emit("audit:entry", entry);
  }

  getAuditLog(
    agentId?: string,
    scope?: PermissionScope,
    limit = 100
  ): AuditLogEntry[] {
    let entries = [...this.auditLog];
    if (agentId) entries = entries.filter((e) => e.agentId === agentId);
    if (scope) entries = entries.filter((e) => e.scope === scope);
    return entries.slice(-limit).reverse();
  }

  // ── Grant expiry ──────────────────────────────────────────────────────────────

  private expireGrants(): void {
    const now = Date.now();
    for (const [agentId, agentGrants] of this.grants.entries()) {
      const before = agentGrants.length;
      const active = agentGrants.filter((g) => !g.expiresAt || g.expiresAt > now);
      if (active.length < before) {
        this.grants.set(agentId, active);
        this.logAudit(agentId, "*" as PermissionScope, "expire", "denied", {
          expired: before - active.length,
        });
        logger.debug(
          { agentId, expired: before - active.length },
          "[PermissionManager] Expired grants removed"
        );
      }
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────────

  getActiveGrants(agentId: string): PermissionGrant[] {
    const now = Date.now();
    return (this.grants.get(agentId) ?? []).filter(
      (g) => !g.expiresAt || g.expiresAt > now
    );
  }

  listGrantedScopes(agentId: string): PermissionScope[] {
    return this.getActiveGrants(agentId).map((g) => g.scope);
  }

  getStats() {
    return {
      totalProfiles: this.profiles.size,
      totalGrants: Array.from(this.grants.values()).reduce(
        (s, g) => s + g.length,
        0
      ),
      pendingRequests: this.pendingRequests.size,
      auditEntries: this.auditLog.length,
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
let _manager: PermissionManager | null = null;
export function getPermissionManager(): PermissionManager {
  if (!_manager) _manager = new PermissionManager();
  return _manager;
}
