/**
 * Permission Profiles
 * 4 profiles that control which tools are accessible: minimal, coding, messaging, full.
 */

export type PermissionProfile = "minimal" | "coding" | "messaging" | "full";

export interface ProfileConfig {
  profile: PermissionProfile;
  description: string;
  allowedToolCategories: string[];
  blockedTools: string[];
  features: {
    codeExecution: boolean;
    fileWrite: boolean;
    shellAccess: boolean;
    browserControl: boolean;
    messaging: boolean;
    email: boolean;
    calendar: boolean;
    documentGeneration: boolean;
    academicSearch: boolean;
    webSearch: boolean;
    dataAnalysis: boolean;
    agentDelegation: boolean;
  };
}

const PROFILES: Record<PermissionProfile, ProfileConfig> = {
  minimal: {
    profile: "minimal",
    description: "Read-only mode. Search, basic chat, no code execution or file writes.",
    allowedToolCategories: ["search", "analysis", "memory", "reasoning"],
    blockedTools: [
      "shell_execute", "code_execute", "file_write", "file_delete",
      "email_send", "message_send", "whatsapp_send",
      "browser_navigate", "browser_click", "browser_type",
      "document_create", "spreadsheet_create", "slides_create",
    ],
    features: {
      codeExecution: false,
      fileWrite: false,
      shellAccess: false,
      browserControl: false,
      messaging: false,
      email: false,
      calendar: false,
      documentGeneration: false,
      academicSearch: true,
      webSearch: true,
      dataAnalysis: true,
      agentDelegation: false,
    },
  },
  coding: {
    profile: "coding",
    description: "Development tools. Code execution, file read/write, shell, dev tools.",
    allowedToolCategories: [
      "search", "analysis", "memory", "reasoning", "code", "file",
      "data", "document", "diagram", "development",
    ],
    blockedTools: [
      "email_send", "message_send", "whatsapp_send",
      "calendar_event", "reminder_set",
    ],
    features: {
      codeExecution: true,
      fileWrite: true,
      shellAccess: true,
      browserControl: true,
      messaging: false,
      email: false,
      calendar: false,
      documentGeneration: true,
      academicSearch: true,
      webSearch: true,
      dataAnalysis: true,
      agentDelegation: true,
    },
  },
  messaging: {
    profile: "messaging",
    description: "Communication tools. Gmail, WhatsApp, calendar, notifications.",
    allowedToolCategories: [
      "search", "analysis", "memory", "reasoning", "communication",
      "productivity", "document",
    ],
    blockedTools: [
      "shell_execute", "code_execute", "git_operation",
      "db_query", "db_migrate",
    ],
    features: {
      codeExecution: false,
      fileWrite: true,
      shellAccess: false,
      browserControl: true,
      messaging: true,
      email: true,
      calendar: true,
      documentGeneration: true,
      academicSearch: true,
      webSearch: true,
      dataAnalysis: true,
      agentDelegation: false,
    },
  },
  full: {
    profile: "full",
    description: "All tools enabled. Auto-confirm trusted tools.",
    allowedToolCategories: ["*"],
    blockedTools: [],
    features: {
      codeExecution: true,
      fileWrite: true,
      shellAccess: true,
      browserControl: true,
      messaging: true,
      email: true,
      calendar: true,
      documentGeneration: true,
      academicSearch: true,
      webSearch: true,
      dataAnalysis: true,
      agentDelegation: true,
    },
  },
};

// Active profile (per-process)
let activeProfile: PermissionProfile = "full";

export function setPermissionProfile(profile: PermissionProfile): ProfileConfig {
  if (!PROFILES[profile]) {
    throw new Error(`Invalid profile: ${profile}. Valid: ${Object.keys(PROFILES).join(", ")}`);
  }
  activeProfile = profile;
  console.log(`[PermissionProfiles] Profile set to: ${profile} — ${PROFILES[profile].description}`);
  return PROFILES[profile];
}

export function getPermissionProfile(): PermissionProfile {
  return activeProfile;
}

export function getProfileConfig(profile?: PermissionProfile): ProfileConfig {
  return PROFILES[profile || activeProfile];
}

export function getAllProfiles(): ProfileConfig[] {
  return Object.values(PROFILES);
}

export function isToolAllowedByProfile(
  toolName: string,
  toolCategory?: string,
  profile?: PermissionProfile
): boolean {
  const config = PROFILES[profile || activeProfile];

  // Check if tool is explicitly blocked
  if (config.blockedTools.includes(toolName)) {
    return false;
  }

  // Check if category is allowed
  if (config.allowedToolCategories.includes("*")) {
    return true;
  }

  if (toolCategory && config.allowedToolCategories.includes(toolCategory)) {
    return true;
  }

  // Default: allow if not explicitly blocked
  return !config.blockedTools.includes(toolName);
}

export function isFeatureEnabled(
  feature: keyof ProfileConfig["features"],
  profile?: PermissionProfile
): boolean {
  const config = PROFILES[profile || activeProfile];
  return config.features[feature];
}

/**
 * Get tools filtered by profile permissions.
 */
export function filterToolsByProfile<T extends { name: string; category?: string }>(
  tools: T[],
  profile?: PermissionProfile
): T[] {
  const config = PROFILES[profile || activeProfile];

  return tools.filter((tool) => {
    if (config.blockedTools.includes(tool.name)) return false;
    if (config.allowedToolCategories.includes("*")) return true;
    if (tool.category && config.allowedToolCategories.includes(tool.category)) return true;
    return !config.blockedTools.includes(tool.name);
  });
}
