import type { UserPlan } from "../contracts";
import {
  type ToolProfile,
  type SubscriptionTier,
  type CatalogEntry,
  type CoreToolProfilePolicy,
  resolveCoreToolProfilePolicy,
  getProfileForTier,
  getToolsForProfile,
  getCatalog,
} from "./toolCatalog";

export type PolicyMode = "allowlist" | "denylist";

export interface SessionToolPermissions {
  sessionId: string;
  userId: string;
  tier: SubscriptionTier;
  profile: ToolProfile;
  overrides: ToolOverride[];
  createdAt: Date;
  expiresAt: Date;
}

export interface ToolOverride {
  toolName: string;
  action: "allow" | "deny";
  reason?: string;
}

export interface ToolPolicyResult {
  allowed: boolean;
  reason: string;
  tier: SubscriptionTier;
  profile: ToolProfile;
  mode: PolicyMode;
}

export interface ToolPolicyPipelineConfig {
  defaultMode: PolicyMode;
  sessionTtlMs: number;
  enforceTierGating: boolean;
  allowAdminOverride: boolean;
}

const DEFAULT_CONFIG: ToolPolicyPipelineConfig = {
  defaultMode: "allowlist",
  sessionTtlMs: 3600000,
  enforceTierGating: true,
  allowAdminOverride: true,
};

const PLAN_TO_TIER: Record<UserPlan, SubscriptionTier> = {
  free: "go",
  pro: "plus",
  admin: "pro",
};

const GO_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "memory_search",
  "memory_get",
  "generate_document",
]);

const PLUS_TOOLS = new Set([
  ...GO_TOOLS,
  "read_file",
  "write_file",
  "list_files",
  "shell_command",
  "execute_code",
  "browse_url",
  "generate_image",
  "analyze_spreadsheet",
  "generate_chart",
  "create_presentation",
  "create_spreadsheet",
  "create_document",
]);

const PRO_TOOLS = new Set([
  ...PLUS_TOOLS,
  "subagent_spawn",
  "subagent_status",
  "send_email",
]);

const TIER_TOOL_SETS: Record<SubscriptionTier, Set<string>> = {
  go: GO_TOOLS,
  plus: PLUS_TOOLS,
  pro: PRO_TOOLS,
};

export class ToolPolicyPipeline {
  private config: ToolPolicyPipelineConfig;
  private sessions: Map<string, SessionToolPermissions> = new Map();

  constructor(config: Partial<ToolPolicyPipelineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  createSession(
    sessionId: string,
    userId: string,
    userPlan: UserPlan,
    overrides: ToolOverride[] = []
  ): SessionToolPermissions {
    const tier = PLAN_TO_TIER[userPlan] ?? "go";
    const profile = getProfileForTier(tier);
    const now = new Date();

    const session: SessionToolPermissions = {
      sessionId,
      userId,
      tier,
      profile,
      overrides,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.sessionTtlMs),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): SessionToolPermissions | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (new Date() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    return session;
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  checkToolAccess(toolName: string, sessionId: string): ToolPolicyResult {
    const session = this.getSession(sessionId);
    if (!session) {
      return {
        allowed: false,
        reason: "No active session found or session expired",
        tier: "go",
        profile: "minimal",
        mode: this.config.defaultMode,
      };
    }

    const denyOverride = session.overrides.find(
      (o) => o.toolName === toolName && o.action === "deny"
    );
    if (denyOverride) {
      return {
        allowed: false,
        reason: denyOverride.reason ?? `Tool ${toolName} denied by session override`,
        tier: session.tier,
        profile: session.profile,
        mode: this.config.defaultMode,
      };
    }

    const allowOverride = session.overrides.find(
      (o) => o.toolName === toolName && o.action === "allow"
    );
    if (allowOverride) {
      return {
        allowed: true,
        reason: allowOverride.reason ?? `Tool ${toolName} allowed by session override`,
        tier: session.tier,
        profile: session.profile,
        mode: this.config.defaultMode,
      };
    }

    if (this.config.enforceTierGating) {
      const tierTools = TIER_TOOL_SETS[session.tier];
      if (!tierTools || !tierTools.has(toolName)) {
        return {
          allowed: false,
          reason: `Tool ${toolName} not available for tier ${session.tier}. Upgrade to access this tool.`,
          tier: session.tier,
          profile: session.profile,
          mode: this.config.defaultMode,
        };
      }
    }

    const policy = resolveCoreToolProfilePolicy(session.profile);
    if (this.config.defaultMode === "allowlist") {
      const allowed = policy.allowedTools.includes(toolName);
      return {
        allowed,
        reason: allowed
          ? `Tool ${toolName} allowed for profile ${session.profile}`
          : `Tool ${toolName} not in allowlist for profile ${session.profile}`,
        tier: session.tier,
        profile: session.profile,
        mode: "allowlist",
      };
    }

    const denied = policy.deniedTools.includes(toolName);
    return {
      allowed: !denied,
      reason: denied
        ? `Tool ${toolName} in denylist for profile ${session.profile}`
        : `Tool ${toolName} not denied for profile ${session.profile}`,
      tier: session.tier,
      profile: session.profile,
      mode: "denylist",
    };
  }

  checkToolAccessByPlan(toolName: string, userPlan: UserPlan): ToolPolicyResult {
    const tier = PLAN_TO_TIER[userPlan] ?? "go";
    const profile = getProfileForTier(tier);

    if (this.config.allowAdminOverride && userPlan === "admin") {
      return {
        allowed: true,
        reason: `Admin override: all tools allowed`,
        tier,
        profile,
        mode: this.config.defaultMode,
      };
    }

    if (this.config.enforceTierGating) {
      const tierTools = TIER_TOOL_SETS[tier];
      if (!tierTools || !tierTools.has(toolName)) {
        return {
          allowed: false,
          reason: `Tool ${toolName} not available for tier ${tier}`,
          tier,
          profile,
          mode: this.config.defaultMode,
        };
      }
    }

    return {
      allowed: true,
      reason: `Tool ${toolName} allowed for tier ${tier}`,
      tier,
      profile,
      mode: this.config.defaultMode,
    };
  }

  getAvailableTools(sessionId: string): string[] {
    const session = this.getSession(sessionId);
    if (!session) return [];

    const tierTools = TIER_TOOL_SETS[session.tier];
    const available = Array.from(tierTools);

    for (const override of session.overrides) {
      if (override.action === "allow" && !available.includes(override.toolName)) {
        available.push(override.toolName);
      }
      if (override.action === "deny") {
        const idx = available.indexOf(override.toolName);
        if (idx !== -1) available.splice(idx, 1);
      }
    }

    return available;
  }

  getAvailableToolsByPlan(userPlan: UserPlan): string[] {
    const tier = PLAN_TO_TIER[userPlan] ?? "go";

    if (this.config.allowAdminOverride && userPlan === "admin") {
      return getCatalog().map((e) => e.name);
    }

    return Array.from(TIER_TOOL_SETS[tier]);
  }

  getToolTierRequirement(toolName: string): SubscriptionTier | null {
    if (GO_TOOLS.has(toolName)) return "go";
    if (PLUS_TOOLS.has(toolName)) return "plus";
    if (PRO_TOOLS.has(toolName)) return "pro";
    return null;
  }

  addSessionOverride(sessionId: string, override: ToolOverride): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;
    session.overrides = session.overrides.filter(
      (o) => o.toolName !== override.toolName
    );
    session.overrides.push(override);
    return true;
  }

  removeSessionOverride(sessionId: string, toolName: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;
    session.overrides = session.overrides.filter((o) => o.toolName !== toolName);
    return true;
  }

  getSessionSummary(sessionId: string): {
    tier: SubscriptionTier;
    profile: ToolProfile;
    availableCount: number;
    overrideCount: number;
    expiresIn: number;
  } | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    return {
      tier: session.tier,
      profile: session.profile,
      availableCount: this.getAvailableTools(sessionId).length,
      overrideCount: session.overrides.length,
      expiresIn: Math.max(0, session.expiresAt.getTime() - Date.now()),
    };
  }

  pruneExpiredSessions(): number {
    const now = new Date();
    let pruned = 0;
    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
        pruned++;
      }
    }
    return pruned;
  }
}

export const toolPolicyPipeline = new ToolPolicyPipeline();

export function resolveToolPolicyForPlan(userPlan: UserPlan): CoreToolProfilePolicy {
  const tier = PLAN_TO_TIER[userPlan] ?? "go";
  const profile = getProfileForTier(tier);
  return resolveCoreToolProfilePolicy(profile);
}

export function isToolAvailableForPlan(toolName: string, userPlan: UserPlan): boolean {
  return toolPolicyPipeline.checkToolAccessByPlan(toolName, userPlan).allowed;
}

export function getToolsForPlan(userPlan: UserPlan): string[] {
  return toolPolicyPipeline.getAvailableToolsByPlan(userPlan);
}
