import { EventEmitter } from "events";

export type GovernanceMode = "SAFE" | "SUPERVISED" | "AUTOPILOT" | "RESEARCH" | "EMERGENCY_STOP";

export interface ModePermissions {
  allowedToolCategories: string[];
  maxRiskLevel: "safe" | "moderate" | "dangerous" | "critical";
  requiresHumanApproval: boolean;
  humanApprovalThreshold: "safe" | "moderate" | "dangerous" | "critical";
  allowExternalAPIs: boolean;
  allowFileSystem: boolean;
  allowNetworkAccess: boolean;
  allowCodeExecution: boolean;
  riskTolerance: number;
  maxConcurrentAgents: number;
  autoApproveTimeout: number | null;
}

export interface ModeTransition {
  from: GovernanceMode;
  to: GovernanceMode;
  changedBy: string;
  reason: string;
  timestamp: number;
}

const MODE_PERMISSIONS: Record<GovernanceMode, ModePermissions> = {
  SAFE: {
    allowedToolCategories: ["read", "search", "analyze"],
    maxRiskLevel: "safe",
    requiresHumanApproval: true,
    humanApprovalThreshold: "safe",
    allowExternalAPIs: false,
    allowFileSystem: false,
    allowNetworkAccess: false,
    allowCodeExecution: false,
    riskTolerance: 0,
    maxConcurrentAgents: 1,
    autoApproveTimeout: null,
  },
  SUPERVISED: {
    allowedToolCategories: ["read", "search", "analyze", "write", "create"],
    maxRiskLevel: "moderate",
    requiresHumanApproval: true,
    humanApprovalThreshold: "moderate",
    allowExternalAPIs: true,
    allowFileSystem: true,
    allowNetworkAccess: true,
    allowCodeExecution: false,
    riskTolerance: 0.3,
    maxConcurrentAgents: 3,
    autoApproveTimeout: 300000,
  },
  AUTOPILOT: {
    allowedToolCategories: ["read", "search", "analyze", "write", "create", "execute", "deploy"],
    maxRiskLevel: "dangerous",
    requiresHumanApproval: false,
    humanApprovalThreshold: "dangerous",
    allowExternalAPIs: true,
    allowFileSystem: true,
    allowNetworkAccess: true,
    allowCodeExecution: true,
    riskTolerance: 0.7,
    maxConcurrentAgents: 10,
    autoApproveTimeout: 60000,
  },
  RESEARCH: {
    allowedToolCategories: ["read", "search", "analyze", "browse", "scrape", "summarize"],
    maxRiskLevel: "moderate",
    requiresHumanApproval: false,
    humanApprovalThreshold: "dangerous",
    allowExternalAPIs: true,
    allowFileSystem: false,
    allowNetworkAccess: true,
    allowCodeExecution: false,
    riskTolerance: 0.4,
    maxConcurrentAgents: 5,
    autoApproveTimeout: 120000,
  },
  EMERGENCY_STOP: {
    allowedToolCategories: [],
    maxRiskLevel: "safe",
    requiresHumanApproval: true,
    humanApprovalThreshold: "safe",
    allowExternalAPIs: false,
    allowFileSystem: false,
    allowNetworkAccess: false,
    allowCodeExecution: false,
    riskTolerance: 0,
    maxConcurrentAgents: 0,
    autoApproveTimeout: null,
  },
};

const VALID_TRANSITIONS: Record<GovernanceMode, GovernanceMode[]> = {
  SAFE: ["SUPERVISED", "RESEARCH", "EMERGENCY_STOP"],
  SUPERVISED: ["SAFE", "AUTOPILOT", "RESEARCH", "EMERGENCY_STOP"],
  AUTOPILOT: ["SUPERVISED", "SAFE", "EMERGENCY_STOP"],
  RESEARCH: ["SAFE", "SUPERVISED", "EMERGENCY_STOP"],
  EMERGENCY_STOP: ["SAFE"],
};

export class GovernanceModeManager extends EventEmitter {
  private currentMode: GovernanceMode = "SUPERVISED";
  private transitionHistory: ModeTransition[] = [];

  getMode(): GovernanceMode {
    return this.currentMode;
  }

  getPermissions(): ModePermissions {
    return { ...MODE_PERMISSIONS[this.currentMode] };
  }

  getModePermissions(mode: GovernanceMode): ModePermissions {
    return { ...MODE_PERMISSIONS[mode] };
  }

  getTransitionHistory(): ModeTransition[] {
    return [...this.transitionHistory];
  }

  getAllModes(): Array<{ mode: GovernanceMode; permissions: ModePermissions; isCurrent: boolean }> {
    return (Object.keys(MODE_PERMISSIONS) as GovernanceMode[]).map(mode => ({
      mode,
      permissions: { ...MODE_PERMISSIONS[mode] },
      isCurrent: mode === this.currentMode,
    }));
  }

  canTransition(to: GovernanceMode): boolean {
    if (to === this.currentMode) return false;
    return VALID_TRANSITIONS[this.currentMode].includes(to);
  }

  setMode(to: GovernanceMode, changedBy: string, reason: string): ModeTransition {
    if (to === this.currentMode) {
      throw new Error(`Already in ${to} mode`);
    }

    if (!VALID_TRANSITIONS[this.currentMode].includes(to)) {
      throw new Error(
        `Invalid transition from ${this.currentMode} to ${to}. Valid targets: ${VALID_TRANSITIONS[this.currentMode].join(", ")}`
      );
    }

    const transition: ModeTransition = {
      from: this.currentMode,
      to,
      changedBy,
      reason,
      timestamp: Date.now(),
    };

    this.currentMode = to;
    this.transitionHistory.push(transition);

    this.emit("modeChanged", transition);

    if (to === "EMERGENCY_STOP") {
      this.emit("emergencyStop", transition);
    }

    return transition;
  }

  isActionAllowed(riskLevel: string, toolCategory?: string): { allowed: boolean; reason?: string } {
    const perms = MODE_PERMISSIONS[this.currentMode];

    if (this.currentMode === "EMERGENCY_STOP") {
      return { allowed: false, reason: "System is in EMERGENCY_STOP mode. All actions are blocked." };
    }

    const riskOrder: Record<string, number> = { safe: 0, moderate: 1, dangerous: 2, critical: 3 };
    if ((riskOrder[riskLevel] ?? 0) > (riskOrder[perms.maxRiskLevel] ?? 0)) {
      return { allowed: false, reason: `Risk level "${riskLevel}" exceeds maximum "${perms.maxRiskLevel}" for ${this.currentMode} mode` };
    }

    if (toolCategory && !perms.allowedToolCategories.includes(toolCategory)) {
      return { allowed: false, reason: `Tool category "${toolCategory}" not allowed in ${this.currentMode} mode` };
    }

    return { allowed: true };
  }

  requiresApproval(riskLevel: string): boolean {
    const perms = MODE_PERMISSIONS[this.currentMode];
    if (!perms.requiresHumanApproval) return false;

    const riskOrder: Record<string, number> = { safe: 0, moderate: 1, dangerous: 2, critical: 3 };
    return (riskOrder[riskLevel] ?? 0) >= (riskOrder[perms.humanApprovalThreshold] ?? 0);
  }

  getStatus() {
    return {
      currentMode: this.currentMode,
      permissions: this.getPermissions(),
      transitionHistory: this.transitionHistory.slice(-20),
      validTransitions: VALID_TRANSITIONS[this.currentMode],
    };
  }
}

export const governanceModeManager = new GovernanceModeManager();
