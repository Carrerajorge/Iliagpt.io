import type { ToolDefinition } from "../toolRegistry";

export type ToolSection =
  | "files"
  | "runtime"
  | "web"
  | "memory"
  | "sessions"
  | "ui"
  | "messaging"
  | "automation"
  | "agents"
  | "media";

export type ToolProfile = "minimal" | "coding" | "messaging" | "full";

export type SubscriptionTier = "go" | "plus" | "pro";

export interface CatalogEntry {
  name: string;
  section: ToolSection;
  description: string;
  profiles: ToolProfile[];
}

const TOOL_CATALOG: CatalogEntry[] = [
  { name: "read_file", section: "files", description: "Read a file from workspace", profiles: ["coding", "full"] },
  { name: "write_file", section: "files", description: "Write a file to workspace", profiles: ["coding", "full"] },
  { name: "list_files", section: "files", description: "List files in workspace", profiles: ["coding", "full"] },

  { name: "shell_command", section: "runtime", description: "Execute a shell command", profiles: ["coding", "full"] },
  { name: "execute_code", section: "runtime", description: "Execute code in sandbox", profiles: ["coding", "full"] },

  { name: "web_search", section: "web", description: "Search the web", profiles: ["minimal", "coding", "messaging", "full"] },
  { name: "browse_url", section: "web", description: "Navigate to a URL with headless browser", profiles: ["coding", "full"] },
  { name: "web_fetch", section: "web", description: "Fetch and extract content from a URL", profiles: ["minimal", "coding", "messaging", "full"] },

  { name: "memory_search", section: "memory", description: "Search conversation memory", profiles: ["minimal", "coding", "messaging", "full"] },
  { name: "memory_get", section: "memory", description: "Retrieve a specific memory entry", profiles: ["minimal", "coding", "messaging", "full"] },

  { name: "sessions_spawn", section: "sessions", description: "Spawn a sub-agent session", profiles: ["full"] },

  { name: "generate_image", section: "media", description: "Generate an image via AI", profiles: ["coding", "messaging", "full"] },
  { name: "generate_document", section: "media", description: "Generate Word/PDF documents", profiles: ["minimal", "coding", "messaging", "full"] },
  { name: "analyze_spreadsheet", section: "media", description: "Analyze spreadsheet data", profiles: ["coding", "full"] },

  { name: "generate_chart", section: "ui", description: "Generate chart visualizations", profiles: ["coding", "full"] },

  { name: "send_email", section: "messaging", description: "Send an email", profiles: ["messaging", "full"] },

  { name: "create_presentation", section: "automation", description: "Create a PowerPoint presentation", profiles: ["coding", "messaging", "full"] },
  { name: "create_spreadsheet", section: "automation", description: "Create an Excel spreadsheet", profiles: ["coding", "messaging", "full"] },
  { name: "create_document", section: "automation", description: "Create a Word document", profiles: ["coding", "messaging", "full"] },

  { name: "subagent_spawn", section: "agents", description: "Spawn specialized sub-agents", profiles: ["full"] },
];

const TIER_TO_PROFILE: Record<SubscriptionTier, ToolProfile> = {
  go: "minimal",
  plus: "coding",
  pro: "full",
};

const LEGACY_PLAN_TO_TIER: Record<string, SubscriptionTier> = {
  free: "go",
  pro: "plus",
  admin: "pro",
};

export interface CoreToolProfilePolicy {
  mode: "allowlist" | "denylist";
  allowedTools: string[];
  deniedTools: string[];
}

export function resolveCoreToolProfilePolicy(profile: ToolProfile): CoreToolProfilePolicy {
  const allowed = TOOL_CATALOG
    .filter((entry) => entry.profiles.includes(profile))
    .map((entry) => entry.name);

  const denied = TOOL_CATALOG
    .filter((entry) => !entry.profiles.includes(profile))
    .map((entry) => entry.name);

  return {
    mode: "allowlist",
    allowedTools: allowed,
    deniedTools: denied,
  };
}

export function getProfileForTier(tier: SubscriptionTier): ToolProfile {
  return TIER_TO_PROFILE[tier];
}

export function getProfileForLegacyPlan(plan: string): ToolProfile {
  const tier = LEGACY_PLAN_TO_TIER[plan] || "go";
  return TIER_TO_PROFILE[tier];
}

export function getToolsForProfile(profile: ToolProfile): CatalogEntry[] {
  return TOOL_CATALOG.filter((entry) => entry.profiles.includes(profile));
}

export function getToolsBySection(section: ToolSection): CatalogEntry[] {
  return TOOL_CATALOG.filter((entry) => entry.section === section);
}

export function isToolAllowedForProfile(toolName: string, profile: ToolProfile): boolean {
  const entry = TOOL_CATALOG.find((e) => e.name === toolName);
  if (!entry) return false;
  return entry.profiles.includes(profile);
}

export function isToolAllowedForTier(toolName: string, tier: SubscriptionTier): boolean {
  const profile = getProfileForTier(tier);
  return isToolAllowedForProfile(toolName, profile);
}

export function filterToolDefinitions(
  tools: ToolDefinition[],
  profile: ToolProfile
): ToolDefinition[] {
  const policy = resolveCoreToolProfilePolicy(profile);
  return tools.filter((tool) => policy.allowedTools.includes(tool.name));
}

export function filterToolDefinitionsByTier(
  tools: ToolDefinition[],
  tier: SubscriptionTier
): ToolDefinition[] {
  const profile = getProfileForTier(tier);
  return filterToolDefinitions(tools, profile);
}

export function getCatalog(): CatalogEntry[] {
  return [...TOOL_CATALOG];
}

export function getCatalogSections(): ToolSection[] {
  const sections = new Set<ToolSection>();
  for (const entry of TOOL_CATALOG) {
    sections.add(entry.section);
  }
  return Array.from(sections);
}

export function getCatalogSummary(): Record<ToolSection, string[]> {
  const summary: Partial<Record<ToolSection, string[]>> = {};
  for (const entry of TOOL_CATALOG) {
    if (!summary[entry.section]) {
      summary[entry.section] = [];
    }
    summary[entry.section]!.push(entry.name);
  }
  return summary as Record<ToolSection, string[]>;
}
