import { MichatError } from "../errors";
import { sanitizeUserInput } from "../config";
import type { 
  AgentDefinition, 
  ToolDefinition, 
  UserIdentity, 
  PolicyDecision, 
  PolicyEngine 
} from "../types";

export interface PolicyRule {
  id: string;
  name: string;
  priority: number;
  condition: (args: PolicyCheckArgs) => boolean;
  decision: PolicyDecision;
}

export interface PolicyCheckArgs {
  agent: AgentDefinition;
  toolName: string;
  user?: UserIdentity;
  tool?: ToolDefinition<any, any>;
}

export interface RoleDefinition {
  name: string;
  capabilities: string[];
  allowedTools: string[];
  deniedTools: string[];
  inherits?: string[];
}

export class EnhancedPolicyEngine implements PolicyEngine {
  private rules: PolicyRule[] = [];
  private roles = new Map<string, RoleDefinition>();
  private toolTagRequirements = new Map<string, string[]>();

  constructor() {
    this.initializeDefaultRoles();
    this.initializeDefaultRules();
  }

  private initializeDefaultRoles(): void {
    this.roles.set("admin", {
      name: "admin",
      capabilities: ["all", "secrets", "dangerous", "admin"],
      allowedTools: ["*"],
      deniedTools: [],
    });

    this.roles.set("pro", {
      name: "pro",
      capabilities: ["read", "write", "execute", "network"],
      allowedTools: ["*"],
      deniedTools: ["secrets_manage", "shell_command"],
    });

    this.roles.set("free", {
      name: "free",
      capabilities: ["read", "basic"],
      allowedTools: ["web_search", "read_file", "list_files", "analyze_spreadsheet"],
      deniedTools: ["secrets_manage", "shell_command", "execute_code"],
    });
  }

  private initializeDefaultRules(): void {
    this.toolTagRequirements.set("secrets", ["admin"]);
    this.toolTagRequirements.set("dangerous", ["admin", "pro"]);
    this.toolTagRequirements.set("high_risk", ["admin", "pro"]);
  }

  registerRole(role: RoleDefinition): void {
    this.roles.set(role.name, role);
  }

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  removeRule(ruleId: string): boolean {
    const index = this.rules.findIndex((r) => r.id === ruleId);
    if (index !== -1) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  setToolTagRequirement(tag: string, requiredRoles: string[]): void {
    this.toolTagRequirements.set(tag, requiredRoles);
  }

  canUseTool(args: PolicyCheckArgs): PolicyDecision {
    for (const rule of this.rules) {
      try {
        if (rule.condition(args)) {
          return rule.decision;
        }
      } catch {
        continue;
      }
    }

    if (!args.agent.allowTools.includes(args.toolName) && !args.agent.allowTools.includes("*")) {
      return {
        allow: false,
        reason: `Tool not in agent's allow-list: ${args.toolName} (agent: ${args.agent.id})`,
      };
    }

    if (args.agent.denyTools?.includes(args.toolName)) {
      return {
        allow: false,
        reason: `Tool explicitly denied for agent: ${args.toolName} (agent: ${args.agent.id})`,
      };
    }

    const requiredCaps = args.agent.requiredCapabilities ?? [];
    if (requiredCaps.length > 0) {
      const userCaps = new Set([
        ...(args.user?.capabilities ?? []),
        ...(args.user?.roles ?? []),
      ]);

      for (const cap of requiredCaps) {
        if (!userCaps.has(cap) && !userCaps.has("all")) {
          return {
            allow: false,
            reason: `Missing required capability: ${cap}`,
          };
        }
      }
    }

    const toolTags = new Set(args.tool?.tags ?? []);
    for (const [tag, requiredRoles] of Array.from(this.toolTagRequirements.entries())) {
      if (toolTags.has(tag)) {
        const userRoles = new Set(args.user?.roles ?? []);
        const hasRequiredRole = requiredRoles.some((r) => userRoles.has(r));
        
        if (!hasRequiredRole) {
          return {
            allow: false,
            reason: `Tool with tag "${tag}" requires one of roles: ${requiredRoles.join(", ")}`,
          };
        }
      }
    }

    if (args.user?.plan) {
      const planRole = this.roles.get(args.user.plan);
      if (planRole) {
        if (planRole.deniedTools.includes(args.toolName)) {
          return {
            allow: false,
            reason: `Tool denied for plan "${args.user.plan}": ${args.toolName}`,
          };
        }

        if (!planRole.allowedTools.includes("*") && !planRole.allowedTools.includes(args.toolName)) {
          return {
            allow: false,
            reason: `Tool not allowed for plan "${args.user.plan}": ${args.toolName}`,
          };
        }
      }
    }

    return { allow: true };
  }

  sanitize(args: { userMessage: string }): string {
    return sanitizeUserInput(args.userMessage);
  }

  getUserCapabilities(user: UserIdentity): Set<string> {
    const capabilities = new Set(user.capabilities);

    for (const roleName of user.roles) {
      const role = this.roles.get(roleName);
      if (role) {
        for (const cap of role.capabilities) {
          capabilities.add(cap);
        }

        for (const inherited of role.inherits ?? []) {
          const inheritedRole = this.roles.get(inherited);
          if (inheritedRole) {
            for (const cap of inheritedRole.capabilities) {
              capabilities.add(cap);
            }
          }
        }
      }
    }

    const planRole = this.roles.get(user.plan);
    if (planRole) {
      for (const cap of planRole.capabilities) {
        capabilities.add(cap);
      }
    }

    return capabilities;
  }

  getAllowedTools(user: UserIdentity, agent: AgentDefinition): string[] {
    const allowed: string[] = [];

    for (const toolName of agent.allowTools) {
      if (toolName === "*") continue;

      const decision = this.canUseTool({
        agent,
        toolName,
        user,
      });

      if (decision.allow) {
        allowed.push(toolName);
      }
    }

    return allowed;
  }

  getRoles(): RoleDefinition[] {
    return Array.from(this.roles.values());
  }

  getRole(name: string): RoleDefinition | undefined {
    return this.roles.get(name);
  }
}

export const globalPolicyEngine = new EnhancedPolicyEngine();
