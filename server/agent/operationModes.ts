/**
 * Agent Operation Modes
 * 8 modes that configure agent behavior: confirmation policy, sandbox, concurrency, tool restrictions.
 */

export type OperationMode =
  | "assisted"
  | "autonomous"
  | "supervised"
  | "safe"
  | "sandbox"
  | "production"
  | "testing"
  | "demo";

export interface ModeConfig {
  mode: OperationMode;
  description: string;
  autoConfirm: boolean;
  sandboxed: boolean;
  maxConcurrency: number;
  toolRestrictions: "none" | "safe_only" | "read_only";
  requiresApproval: boolean;
  maxTokenBudget: number;
  allowExternalCalls: boolean;
  logLevel: "verbose" | "normal" | "minimal";
}

const MODE_CONFIGS: Record<OperationMode, ModeConfig> = {
  assisted: {
    mode: "assisted",
    description: "User guides each step. Agent suggests actions, user approves.",
    autoConfirm: false,
    sandboxed: false,
    maxConcurrency: 3,
    toolRestrictions: "none",
    requiresApproval: true,
    maxTokenBudget: 50000,
    allowExternalCalls: true,
    logLevel: "normal",
  },
  autonomous: {
    mode: "autonomous",
    description: "Agent operates independently. Auto-confirms trusted tools.",
    autoConfirm: true,
    sandboxed: false,
    maxConcurrency: 10,
    toolRestrictions: "none",
    requiresApproval: false,
    maxTokenBudget: 200000,
    allowExternalCalls: true,
    logLevel: "normal",
  },
  supervised: {
    mode: "supervised",
    description: "Agent runs autonomously but logs all actions for review.",
    autoConfirm: true,
    sandboxed: false,
    maxConcurrency: 5,
    toolRestrictions: "none",
    requiresApproval: false,
    maxTokenBudget: 100000,
    allowExternalCalls: true,
    logLevel: "verbose",
  },
  safe: {
    mode: "safe",
    description: "Only safe tools allowed. No code execution, no file writes.",
    autoConfirm: false,
    sandboxed: true,
    maxConcurrency: 3,
    toolRestrictions: "safe_only",
    requiresApproval: true,
    maxTokenBudget: 30000,
    allowExternalCalls: false,
    logLevel: "normal",
  },
  sandbox: {
    mode: "sandbox",
    description: "Full capabilities but in isolated sandbox environment.",
    autoConfirm: true,
    sandboxed: true,
    maxConcurrency: 5,
    toolRestrictions: "none",
    requiresApproval: false,
    maxTokenBudget: 100000,
    allowExternalCalls: false,
    logLevel: "verbose",
  },
  production: {
    mode: "production",
    description: "Production mode. Conservative limits, full audit trail.",
    autoConfirm: false,
    sandboxed: false,
    maxConcurrency: 5,
    toolRestrictions: "none",
    requiresApproval: true,
    maxTokenBudget: 80000,
    allowExternalCalls: true,
    logLevel: "verbose",
  },
  testing: {
    mode: "testing",
    description: "Testing mode. All tools available, verbose logging, sandboxed.",
    autoConfirm: true,
    sandboxed: true,
    maxConcurrency: 10,
    toolRestrictions: "none",
    requiresApproval: false,
    maxTokenBudget: 200000,
    allowExternalCalls: true,
    logLevel: "verbose",
  },
  demo: {
    mode: "demo",
    description: "Demo mode. Safe tools only, minimal logging, limited budget.",
    autoConfirm: true,
    sandboxed: true,
    maxConcurrency: 2,
    toolRestrictions: "safe_only",
    requiresApproval: false,
    maxTokenBudget: 10000,
    allowExternalCalls: false,
    logLevel: "minimal",
  },
};

// Active mode state (in-memory, per-process)
let currentMode: OperationMode = "assisted";

export function setOperationMode(mode: OperationMode): ModeConfig {
  if (!MODE_CONFIGS[mode]) {
    throw new Error(`Invalid operation mode: ${mode}. Valid: ${Object.keys(MODE_CONFIGS).join(", ")}`);
  }
  currentMode = mode;
  console.log(`[OperationModes] Mode set to: ${mode} — ${MODE_CONFIGS[mode].description}`);
  return MODE_CONFIGS[mode];
}

export function getOperationMode(): OperationMode {
  return currentMode;
}

export function getModeConfig(mode?: OperationMode): ModeConfig {
  return MODE_CONFIGS[mode || currentMode];
}

export function getAllModes(): ModeConfig[] {
  return Object.values(MODE_CONFIGS);
}

export function shouldAutoConfirm(): boolean {
  return MODE_CONFIGS[currentMode].autoConfirm;
}

export function isSandboxed(): boolean {
  return MODE_CONFIGS[currentMode].sandboxed;
}

export function getMaxConcurrency(): number {
  return MODE_CONFIGS[currentMode].maxConcurrency;
}

export function getToolRestrictions(): ModeConfig["toolRestrictions"] {
  return MODE_CONFIGS[currentMode].toolRestrictions;
}

export function isToolAllowed(toolName: string, isSafe: boolean): boolean {
  const restrictions = getToolRestrictions();
  if (restrictions === "none") return true;
  if (restrictions === "safe_only") return isSafe;
  if (restrictions === "read_only") {
    const readOnlyTools = new Set([
      "web_search", "academic_search", "read_file", "list_files",
      "memory_retrieve", "memory_search", "data_analyze",
    ]);
    return readOnlyTools.has(toolName) || isSafe;
  }
  return true;
}
